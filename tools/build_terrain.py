#!/usr/bin/env python3
"""
DHT EXPRESS STAGE — terrain data builder (offline / one-time)
=============================================================

GitHub Pages では一切実行しない「事前生成」用スクリプト。
生成物 (data/terrain/*) をリポジトリにコミットすれば、公開時は静的ファイル配信のみで動く。

入力:
  Natural Earth 1:10m  (Public Domain)
    - ne_10m_land.geojson
    - ne_10m_minor_islands.geojson
    - ne_10m_lakes.geojson         (琵琶湖のみ使用)
  取得元: https://github.com/nvkelso/natural-earth-vector/tree/master/geojson

出力:
  data/terrain/manifest.json      グリッド定義・投影定数・チャンク一覧
  data/terrain/coarse.bin         全域 4km 間隔の高さ (Int16 LE, メートル)
  data/terrain/hi/h_{cx}_{cz}.bin 64km四方チャンク 1km間隔 (Int16 LE, 67x67, 外周1サンプルの縁付き)

標高について:
  外部DEMは使わず、実在の山脈・火山・平野の位置と標高（一般的な地理知識）を
  パラメータとして手で配置し、海岸からの距離 + ノイズで「それらしい」地形を合成している。
  → データ由来の権利制約なし（本リポジトリの成果物として CC0 扱い）。
  「リアル地図」ではなく「広域3Dステージ」用の簡略地形。

使い方:
  pip install numpy scipy pillow
  python3 tools/build_terrain.py --src ../src_data --out data/terrain
"""
import argparse
import json
import math
import os

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

# ---------------------------------------------------------------------------
# 投影（js/geo.js と完全一致させること）
#   正弦図法 (Sinusoidal) を日本南部向けに原点調整したもの
#   x [km] =  (lon - LON0) * KM_PER_DEG * cos(lat)   … 東が +X
#   z [km] = -(lat - LAT0) * KM_PER_DEG              … 北が -Z（Three.js の「奥」）
#   1 world unit (水平) = 1 km
# ---------------------------------------------------------------------------
LON0 = 132.5
LAT0 = 31.0
EARTH_R = 6371.0088
KM_PER_DEG = EARTH_R * math.pi / 180.0

NORTH_LIMIT = 37 + 40 / 60 + 23 / 3600  # 37.67306°  北緯37°40'23''
FADE_END = 38.30                         # これより北は海に沈める（境界のなじませ帯）

# ワールドグリッド (km)
X0, Z0 = -1024.0, -832.0
CHUNK = 64            # km
NCX, NCZ = 30, 26     # チャンク数
HI_STEP = 1.0         # km
COARSE_STEP = 4.0     # km
RASTER = 0.5          # km  海岸線ラスタ解像度

SEA_FLOOR = -250      # m  これより深い所は扱わない（海底面メッシュで代用）


def ll2w(lat, lon):
    return ((lon - LON0) * KM_PER_DEG * np.cos(np.radians(lat)), -(lat - LAT0) * KM_PER_DEG)


def w2ll(x, z):
    lat = LAT0 - z / KM_PER_DEG
    lon = LON0 + x / (KM_PER_DEG * np.cos(np.radians(lat)))
    return lat, lon


# ---------------------------------------------------------------------------
# 地形パラメータ (lat, lon) — 実在地形をざっくり配置
# ---------------------------------------------------------------------------
# 尾根: [(lat,lon),...], 標高m, 半幅km
RIDGES = [
    # 北アルプス（飛騨山脈）
    ([(36.80, 137.70), (36.57, 137.62), (36.34, 137.65), (36.11, 137.55), (35.90, 137.48)], 2900, 14),
    # 中央アルプス（木曽山脈）
    ([(35.95, 137.83), (35.79, 137.80), (35.55, 137.72)], 2700, 9),
    # 南アルプス（赤石山脈）
    ([(35.85, 138.20), (35.67, 138.24), (35.46, 138.16), (35.25, 138.08)], 2950, 12),
    # 八ヶ岳
    ([(36.05, 138.33), (35.97, 138.37), (35.90, 138.38)], 2700, 8),
    # 関東山地（奥秩父）
    ([(36.05, 138.65), (35.90, 138.80), (35.80, 139.10)], 2000, 15),
    # 越後山脈・上越国境
    ([(37.30, 139.40), (37.00, 139.20), (36.84, 138.93), (36.70, 138.60)], 1900, 18),
    # 日光・尾瀬
    ([(36.95, 139.25), (36.80, 139.38), (36.75, 139.50)], 2300, 10),
    # 奥羽・阿武隈方面（境界付近）
    ([(37.65, 140.10), (37.60, 140.07), (37.40, 140.15)], 1700, 10),
    ([(37.60, 140.60), (37.20, 140.60), (36.90, 140.55)], 900, 18),
    # 両白山地・白山
    ([(36.40, 136.70), (36.15, 136.77), (35.85, 136.70)], 2300, 12),
    # 美濃・飛騨高地
    ([(36.00, 137.10), (35.70, 137.20), (35.50, 137.40)], 1300, 22),
    # 丹沢
    ([(35.50, 139.05), (35.47, 139.16)], 1500, 7),
    # 伊吹・鈴鹿
    ([(35.42, 136.40), (35.15, 136.42), (34.90, 136.35)], 1150, 7),
    # 比良
    ([(35.30, 135.92), (35.15, 135.88)], 1100, 5),
    # 紀伊山地
    ([(34.45, 135.90), (34.17, 135.90), (33.90, 135.85)], 1850, 16),
    ([(34.30, 136.10), (34.18, 136.10), (34.00, 135.70)], 1600, 14),
    ([(34.25, 135.40), (34.20, 135.60)], 1000, 10),
    # 六甲
    ([(34.80, 135.15), (34.76, 135.30)], 900, 5),
    # 中国山地（脊梁）
    ([(35.40, 135.00), (35.35, 134.50), (35.30, 134.10), (35.37, 133.55), (35.15, 133.00), (35.10, 132.60), (34.70, 132.10), (34.40, 131.70)], 1250, 16),
    # 大山
    ([(35.38, 133.48), (35.37, 133.55), (35.36, 133.62)], 1650, 7),
    # 四国山地
    ([(33.55, 132.80), (33.77, 133.12), (33.80, 133.60), (33.85, 134.09), (33.85, 134.40)], 1850, 16),
    ([(33.30, 132.70), (33.40, 133.20), (33.55, 133.60)], 1000, 18),
    # 九州山地
    ([(32.83, 131.35), (32.55, 131.10), (32.30, 131.00), (32.05, 130.95)], 1650, 16),
    ([(33.43, 130.20), (33.43, 130.37), (33.50, 130.60)], 950, 7),   # 脊振
    ([(33.48, 130.92), (33.35, 131.00)], 1100, 7),                  # 英彦山
    # 屋久島（島全体が山）
    ([(30.36, 130.45), (30.34, 130.50), (30.33, 130.56)], 1850, 7),
    # 奄美大島
    ([(28.38, 129.40), (28.30, 129.33), (28.22, 129.30)], 650, 6),
    # 徳之島
    ([(27.85, 128.95), (27.75, 128.95)], 600, 4),
    # 沖縄本島北部（やんばる）
    ([(26.80, 128.25), (26.72, 128.20), (26.62, 128.10)], 480, 5),
    # 石垣・西表
    ([(24.43, 124.18)], 500, 5),
    ([(24.33, 123.80)], 450, 7),
]

# 火山・独立峰: (lat, lon, 標高m, 半径km)
CONES = [
    (35.3606, 138.7274, 3776, 20),  # 富士山
    (36.4060, 138.5230, 2560, 11),  # 浅間山
    (35.8930, 137.4800, 3060, 10),  # 御嶽山
    (36.1030, 137.5540, 3020, 8),   # 乗鞍岳
    (36.1550, 136.7710, 2700, 10),  # 白山
    (35.3710, 133.5460, 1720, 9),   # 大山
    (36.7990, 139.3760, 2570, 8),   # 日光白根
    (36.7650, 139.4900, 2480, 8),   # 男体山
    (37.6010, 140.0720, 1810, 9),   # 磐梯山
    (35.2330, 139.0210, 1400, 12),  # 箱根
    (34.8650, 139.0000, 1380, 10),  # 天城
    (32.8840, 131.1040, 1590, 14),  # 阿蘇（中岳）
    (33.0860, 131.2490, 1780, 9),   # くじゅう
    (32.7610, 130.2990, 1480, 9),   # 雲仙
    (31.9340, 130.8620, 1700, 11),  # 霧島
    (31.5850, 130.6570, 1110, 6),   # 桜島
    (31.1800, 130.5280, 920, 4),    # 開聞岳
    (33.1100, 139.7900, 850, 4),    # 八丈富士
    (34.7230, 139.3950, 760, 5),    # 伊豆大島 三原山
    (28.3000, 129.3300, 690, 6),    # 湯湾岳
    (27.7600, 128.9800, 640, 4),    # 井之川岳
    (27.3700, 128.5700, 240, 4),    # 沖永良部 大山
    (27.0400, 128.4200, 100, 3),    # 与論島
    (30.4800, 130.9600, 280, 6),    # 種子島
    (34.0800, 133.0000, 900, 10),   # しまなみ周辺の島々を少し
]

# 平野・盆地（標高を抑える）: (lat, lon, 半径km, 強さ0..1)
PLAINS = [
    (35.90, 139.65, 70, 1.0),   # 関東平野
    (36.15, 140.05, 45, 1.0),
    (35.65, 140.20, 30, 0.8),   # 下総台地
    (35.20, 136.80, 32, 1.0),   # 濃尾平野
    (34.95, 137.20, 20, 0.8),   # 岡崎・豊橋
    (34.72, 135.55, 22, 1.0),   # 大阪平野
    (35.00, 135.75, 8, 0.8),    # 京都盆地
    (34.60, 135.80, 10, 0.8),   # 奈良盆地
    (35.15, 136.05, 22, 0.9),   # 近江盆地（琵琶湖岸）
    (37.45, 138.85, 30, 1.0),   # 越後平野
    (36.65, 138.20, 15, 0.7),   # 長野盆地
    (36.25, 137.95, 12, 0.7),   # 松本盆地
    (35.65, 138.55, 12, 0.8),   # 甲府盆地
    (36.65, 137.20, 20, 0.9),   # 富山平野
    (36.55, 136.62, 15, 0.9),   # 金沢平野
    (36.05, 136.25, 15, 0.9),   # 福井平野
    (34.70, 133.90, 18, 0.8),   # 岡山平野
    (34.40, 132.45, 6, 0.6),    # 広島
    (33.55, 130.45, 14, 0.9),   # 福岡平野
    (33.25, 130.40, 22, 1.0),   # 筑紫平野
    (32.80, 130.72, 14, 0.9),   # 熊本平野
    (31.90, 131.40, 18, 0.9),   # 宮崎平野
    (33.60, 133.55, 8, 0.7),    # 高知平野
    (34.25, 133.95, 12, 0.7),   # 讃岐平野
    (34.05, 134.45, 12, 0.8),   # 徳島平野
    (33.85, 132.80, 10, 0.7),   # 松山平野
    (37.40, 140.35, 15, 0.6),   # 郡山盆地
    (31.60, 130.55, 8, 0.5),    # 鹿児島
    (26.25, 127.75, 15, 0.6),   # 沖縄本島中南部
]

# 南西諸島などの低平な島（標高を抑える）
LOWISLANDS = [
    (30.55, 131.00, 35, 0.6),   # 種子島
    (27.36, 128.60, 12, 0.6),   # 沖永良部
    (27.04, 128.42, 6, 0.7),    # 与論
    (24.78, 125.30, 15, 0.8),   # 宮古島
]


def load_polys(path):
    d = json.load(open(path))
    out = []
    for f in d["features"]:
        g = f["geometry"]
        if g is None:
            continue
        polys = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
        for p in polys:
            xs = [c[0] for c in p[0]]
            ys = [c[1] for c in p[0]]
            if max(xs) < 120 or min(xs) > 147 or max(ys) < 22 or min(ys) > 40:
                continue
            out.append((p, f["properties"]))
    return out


def rasterize(polys, W, H, value_fill=1):
    img = Image.new("L", (W, H), 0)
    dr = ImageDraw.Draw(img)

    def tr(ring):
        pts = []
        for lon, lat in ring:
            x, z = ll2w(lat, lon)
            pts.append(((x - X0) / RASTER, (z - Z0) / RASTER))
        return pts

    for p, _ in polys:
        ext = tr(p[0])
        if len(ext) >= 3:
            dr.polygon(ext, fill=value_fill)
        for hole in p[1:]:
            h = tr(hole)
            if len(h) >= 3:
                dr.polygon(h, fill=0)
    return np.array(img, dtype=np.uint8)


def fbm(shape, base_cells, octaves, seed):
    """滑らかな値ノイズfBm（-1..1付近）"""
    rng = np.random.default_rng(seed)
    out = np.zeros(shape, np.float32)
    amp, tot = 1.0, 0.0
    cells = base_cells
    for _ in range(octaves):
        gh = max(2, int(shape[0] / cells) + 3)
        gw = max(2, int(shape[1] / cells) + 3)
        g = rng.standard_normal((gh, gw)).astype(np.float32)
        z = ndimage.zoom(g, (shape[0] / (gh - 3) * 1.0, shape[1] / (gw - 3) * 1.0), order=3)
        out += amp * z[: shape[0], : shape[1]]
        tot += amp
        amp *= 0.5
        cells /= 2.0
    return out / tot


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default="../src_data")
    ap.add_argument("--out", default="data/terrain")
    a = ap.parse_args()

    WX = NCX * CHUNK
    WZ = NCZ * CHUNK
    W, H = int(WX / RASTER), int(WZ / RASTER)
    print("raster", W, H)

    land = rasterize(load_polys(os.path.join(a.src, "ne_10m_land.geojson")), W, H)
    land |= rasterize(load_polys(os.path.join(a.src, "ne_10m_minor_islands.geojson")), W, H)
    lakes = [p for p in load_polys(os.path.join(a.src, "ne_10m_lakes.geojson")) if "Biwa" in str(p[1].get("name"))]
    lake = rasterize(lakes, W, H)

    # 画素中心の緯度経度
    px = X0 + (np.arange(W) + 0.5) * RASTER
    pz = Z0 + (np.arange(H) + 0.5) * RASTER
    PX, PZ = np.meshgrid(px, pz)
    LAT, LON = w2ll(PX, PZ)

    # 日本以外を除外（朝鮮半島・済州島・台湾・大陸）
    foreign = (LON < 122.3) | ((LON < 129.0) & (LAT > 34.0)) | ((LON < 128.5) & (LAT > 32.9)) | ((LON < 130.0) & (LAT > 34.75))
    land[foreign] = 0
    land[LAT > FADE_END + 0.25] = 0
    land_b = land > 0
    land_b &= ~(lake > 0)

    # 符号付き距離 (km)  陸:+  海:-
    d_in = ndimage.distance_transform_edt(land_b) * RASTER
    d_out = ndimage.distance_transform_edt(~land_b) * RASTER
    sd = np.where(land_b, d_in - RASTER * 0.5, -(d_out - RASTER * 0.5)).astype(np.float32)
    sd = ndimage.gaussian_filter(sd, 1.0)
    del d_in, d_out
    print("signed distance done")

    # 1km 頂点グリッドへサンプリング
    NXv, NZv = int(WX / HI_STEP) + 1, int(WZ / HI_STEP) + 1
    vx = X0 + np.arange(-1, NXv + 1) * HI_STEP   # 縁 1 サンプル付き
    vz = Z0 + np.arange(-1, NZv + 1) * HI_STEP
    VX, VZ = np.meshgrid(vx, vz)
    ci = (VX - X0) / RASTER - 0.5
    cj = (VZ - Z0) / RASTER - 0.5
    S = ndimage.map_coordinates(sd, [cj, ci], order=1, mode="nearest").astype(np.float32)
    VLAT, VLON = w2ll(VX, VZ)
    shape = S.shape
    print("vertex grid", shape)

    # ---- 標高合成 (m) ----
    def wdist(lat, lon):
        x, z = ll2w(lat, lon)
        return x, z

    def seg_dist(px_, pz_, ax, az, bx, bz):
        dx, dz = bx - ax, bz - az
        L2 = dx * dx + dz * dz
        if L2 < 1e-9:
            return np.hypot(px_ - ax, pz_ - az), np.zeros_like(px_)
        t = np.clip(((px_ - ax) * dx + (pz_ - az) * dz) / L2, 0, 1)
        return np.hypot(px_ - (ax + t * dx), pz_ - (az + t * dz)), t

    n_large = fbm(shape, 90, 4, 1)          # 大きなうねり
    n_mid = fbm(shape, 22, 4, 2)            # 中規模の起伏
    n_ridge = 1.0 - np.abs(fbm(shape, 14, 4, 3)) * 1.6  # 尾根っぽさ
    n_ridge = np.clip(n_ridge, -0.2, 1.0)

    mountain = np.zeros(shape, np.float32)
    for pts, hgt, hw in RIDGES:
        w = [ll2w(la, lo) for la, lo in pts]
        dmin = np.full(shape, 1e9, np.float32)
        if len(w) == 1:
            dmin = np.hypot(VX - w[0][0], VZ - w[0][1])
        for k in range(len(w) - 1):
            dd, _ = seg_dist(VX, VZ, w[k][0], w[k][1], w[k + 1][0], w[k + 1][1])
            dmin = np.minimum(dmin, dd)
        prof = np.exp(-((dmin / hw) ** 2)) * (0.82 + 0.22 * n_ridge)
        mountain = np.maximum(mountain, hgt * prof)

    cones = np.zeros(shape, np.float32)
    for la, lo, hgt, r in CONES:
        cx, cz = ll2w(la, lo)
        d = np.hypot(VX - cx, VZ - cz)
        t = np.clip(1 - d / r, 0, 1)
        prof = t ** 1.8 * (1 - 0.15 * t) + 0.15 * t ** 6   # 裾広がり＋尖った山頂
        cones = np.maximum(cones, hgt * prof)

    plain = np.zeros(shape, np.float32)
    for la, lo, r, s in PLAINS + LOWISLANDS:
        cx, cz = ll2w(la, lo)
        d = np.hypot(VX - cx, VZ - cz)
        plain = np.maximum(plain, s * np.clip(1.2 - d / r, 0, 1).clip(0, 1))
    plain = np.clip(plain, 0, 1)

    inland = np.clip(S, 0, None)
    coast = np.clip(S / 3.0, 0, 1)
    coast = coast * coast * (3 - 2 * coast)                 # smoothstep 0..3km
    hills = (60 + 520 * np.clip(inland / 35.0, 0, 1)) * (0.55 + 0.45 * n_large) * (0.6 + 0.6 * np.abs(n_mid) + 0.25 * n_ridge)
    hills *= 1 - 0.88 * plain
    mount = np.maximum(mountain * (1 - 0.6 * plain), cones)
    mfac = np.clip(0.35 + inland / 6.0, 0, 1)
    land_h = coast * (8 + hills * (1 - np.clip(mount / 1800.0, 0, 0.75)) + mount * mfac)
    land_h += 6 * coast                                     # 海岸のごく低い段丘

    sea_h = -np.minimum(-SEA_FLOOR, 4 + (-S) * 7.0 + np.clip(-S - 20, 0, None) * 8)
    Hm = np.where(S > 0, land_h, sea_h + np.clip(S, -1, 0) * 0)
    # 海岸線直上は 0 を跨ぐように（-S 小さいところは浅瀬）
    Hm = np.where((S <= 0) & (S > -1.5), -2 + S * 3, Hm)
    # 湖（琵琶湖）は浅く沈める
    # 北限より北はなじませながら海へ沈める
    fade = np.clip((VLAT - NORTH_LIMIT - 0.03) / (FADE_END - NORTH_LIMIT), 0, 1)
    fade = fade * fade * (3 - 2 * fade)
    Hm = Hm * (1 - fade) + SEA_FLOOR * fade * 0.6 + np.minimum(Hm, 0) * fade * 0.4
    Hm = np.clip(Hm, SEA_FLOOR, 4000).astype(np.int16)
    print("height range", Hm.min(), Hm.max())

    os.makedirs(os.path.join(a.out, "hi"), exist_ok=True)
    # 既存チャンク削除
    for f in os.listdir(os.path.join(a.out, "hi")):
        os.remove(os.path.join(a.out, "hi", f))

    # coarse (4km)  … 縁なし。index: [j][i] , x = X0 + i*4
    st = int(COARSE_STEP / HI_STEP)
    coarse = Hm[1:-1:st, 1:-1:st]
    coarse = np.ascontiguousarray(coarse).astype("<i2")
    coarse.tofile(os.path.join(a.out, "coarse.bin"))
    print("coarse", coarse.shape, coarse.nbytes)

    chunks = []
    total = 0
    N = int(CHUNK / HI_STEP)
    for cz in range(NCZ):
        for cx in range(NCX):
            i0, j0 = cx * N, cz * N   # 縁付き配列では i0 が x=X0+cx*64-1 に相当
            blk = Hm[j0 : j0 + N + 3, i0 : i0 + N + 3]
            if blk.max() <= -120:
                continue
            blk = np.ascontiguousarray(blk).astype("<i2")
            blk.tofile(os.path.join(a.out, "hi", f"h_{cx}_{cz}.bin"))
            total += blk.nbytes
            chunks.append([cx, cz, int(blk.max())])
    print("hi chunks", len(chunks), "bytes", total)

    manifest = {
        "version": 1,
        "projection": {
            "type": "sinusoidal",
            "lon0": LON0, "lat0": LAT0, "earthRadiusKm": EARTH_R,
            "note": "x=(lon-lon0)*kmPerDeg*cos(lat), z=-(lat-lat0)*kmPerDeg, 1 unit = 1 km",
        },
        "northLimitLat": NORTH_LIMIT,
        "fadeEndLat": FADE_END,
        "seaFloorM": SEA_FLOOR,
        "grid": {"x0": X0, "z0": Z0, "chunkKm": CHUNK, "ncx": NCX, "ncz": NCZ},
        "coarse": {"file": "coarse.bin", "stepKm": COARSE_STEP, "nx": int(coarse.shape[1]), "nz": int(coarse.shape[0])},
        "hi": {"dir": "hi/", "stepKm": HI_STEP, "samples": N + 3, "border": 1,
               "chunks": chunks},
        "format": "Int16 little-endian, metres above sea level, row-major [z][x]",
    }
    with open(os.path.join(a.out, "manifest.json"), "w") as f:
        json.dump(manifest, f, separators=(",", ":"))

    # プレビュー画像（確認用、配信には不要）
    prev = coarse.astype(np.float32)
    img = np.zeros(prev.shape + (3,), np.uint8)
    land_m = prev > 0
    img[~land_m] = (np.array([20, 60, 120]) + (prev[~land_m, None] / SEA_FLOOR * -0 + 0)).clip(0, 255)
    g = np.clip(prev / 3000, 0, 1)
    img[land_m] = (np.stack([60 + 180 * g, 140 + 60 * g, 60 + 150 * g], -1)[land_m]).astype(np.uint8)
    Image.fromarray(img).save(os.path.join(a.src, "preview.png"))


if __name__ == "__main__":
    main()
