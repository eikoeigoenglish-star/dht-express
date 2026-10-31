#!/usr/bin/env python3
"""
DHT EXPRESS STAGE — terrain data builder (offline / one-time)
=============================================================

GitHub Pages では一切実行しない「事前生成」用スクリプト。
生成物 (data/terrain/*) をリポジトリにコミットすれば、公開時は静的ファイル配信のみで動く。

入力:
  Natural Earth 1:10m  (Public Domain) … 海岸線・島・琵琶湖（陸と海の境界は v3 と同じ）
    - ne_10m_land.geojson / ne_10m_minor_islands.geojson / ne_10m_lakes.geojson
    - ne_10m_rivers_lake_centerlines.geojson（利根川）
    取得元: https://github.com/nvkelso/natural-earth-vector/tree/master/geojson
  v4: Copernicus DEM GLO-90（実測 DSM, 3 秒角 ≒ 90m）… 陸地の標高
    取得: python3 tools/dem/copernicus.py --src ../src_data   （../src_data/dem/cop90/ にキャッシュ）
    「produced using Copernicus WorldDEM-90 © DLR e.V. 2010-2014 and © Airbus Defence and Space
      GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved」

出力:
  data/terrain/manifest.json      グリッド定義・投影定数・チャンク一覧・標高ソース
  data/terrain/coarse.bin         全域 4km 間隔の高さ (Int16 LE, メートル)
  data/terrain/hi/h_{cx}_{cz}.bin 64km四方チャンク 1km間隔 (Int16 LE, 67x67, 外周1サンプルの縁付き)

標高（v4）:
  陸地 … Copernicus DEM を 1km 頂点へ「尾根保存ブレンド」で縮約（tools/dem/resample.py）
          h = mean + 0.5 × (p90 − mean)   ※ 1km 四方 64 サンプル、DSM の細い突起は事前にオープニングで除去
  海岸 … 海岸線は Natural Earth のまま。陸側 0.6km で DEM 標高へなじませ、低地は 2〜10m を下限にする
          （海面 Y=0 の板が海抜 0m 以下の低地へ透けて見えないように）
  海底 … DEM に水深はないので v3 と同じ「海岸からの距離」による簡易水深
  欠損 … DEM タイルが無い陸地だけ v3 の手続き生成で補完（件数を manifest に記録）
  --elevation procedural で v3 と同じ手続き生成地形も作れる（比較・フォールバック用）

使い方:
  pip install numpy scipy pillow tifffile imagecodecs
  python3 tools/dem/copernicus.py --src ../src_data          # DEM 取得（初回のみ・約 100 タイル）
  python3 tools/build_terrain.py --src ../src_data --out data/terrain
"""
import argparse
import json
import math
import os
import sys
import time

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


def procedural_heights(VX, VZ, S, shape):
    """v1〜v3 の手続き生成標高（陸 land_h・海 sea_h）。
    v4 では (1) --elevation procedural、(2) DEM タイルが欠損した陸地の補完、(3) 海底（水深）にだけ使う。"""
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
    return land_h, sea_h, Hm


def japan_tile_mask(src):
    """1°タイル (lat, lon) がステージ内の日本の陸地に掛かるか（DEM の取得タイル選定用）"""
    WX, WZ = NCX * CHUNK, NCZ * CHUNK
    R = 2.0
    W, H = int(WX / R), int(WZ / R)
    global RASTER
    keep = RASTER
    RASTER = R
    try:
        land = rasterize(load_polys(os.path.join(src, "ne_10m_land.geojson")), W, H)
        land |= rasterize(load_polys(os.path.join(src, "ne_10m_minor_islands.geojson")), W, H)
    finally:
        RASTER = keep
    px = X0 + (np.arange(W) + 0.5) * R
    pz = Z0 + (np.arange(H) + 0.5) * R
    PX, PZ = np.meshgrid(px, pz)
    LAT, LON = w2ll(PX, PZ)
    land = (land > 0) & ~foreign_mask(LAT, LON) & (LAT <= FADE_END + 0.25)
    land = ndimage.binary_dilation(land, iterations=2)
    la = np.floor(LAT[land]).astype(int)
    lo = np.floor(LON[land]).astype(int)
    S = set(zip(la.tolist(), lo.tolist()))
    return lambda lat, lon: (lat, lon) in S


def foreign_mask(LAT, LON):
    """日本以外（朝鮮半島・済州島・台湾・大陸）"""
    return (LON < 122.3) | ((LON < 129.0) & (LAT > 34.0)) | ((LON < 128.5) & (LAT > 32.9)) | ((LON < 130.0) & (LAT > 34.75))


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


# 海岸のなじませ（v4・DEM 使用時）
COAST_TAPER_KM = 0.6    # 海岸線からこの距離で DEM 標高へ完全に移行
LOW_FLOOR_COAST = 2.0   # m  海岸線上の陸の下限
LOW_FLOOR_IN = 10.0     # m  内陸（1.5km 以上）の陸の下限（海抜 0m 以下の干拓地なども 10m に持ち上げる）
LOW_FLOOR_KM = 1.5


def dem_land_heights(a, VX, VZ, S, land_proc, shape, src):
    """Copernicus DEM → 1km 頂点の陸地標高。→ (land_h, info dict, grids, f025)"""
    here = os.path.dirname(os.path.abspath(__file__))
    sys.path.insert(0, os.path.join(here, "dem"))
    from copernicus import DemMosaic  # noqa
    from resample import build_dem_grids, ridge_blend, RIDGE_W  # noqa

    cache = a.dem_cache or os.path.join(src, "dem", "cop90")
    npz = os.path.join(cache, "_grids_cache.npz")
    t0 = time.time()
    if a.reuse_dem and os.path.exists(npz):
        z = np.load(npz)
        grids = {k: z[k] for k in z.files if k != "f025"}
        f025 = z["f025"]
        print("dem grids: reuse", npz)
    else:
        mosaic = DemMosaic(cache)
        # チャンク（＋2km）に日本の陸地があるか
        landv = (S > -2.5)
        N = CHUNK

        def has_land(cx, cz):
            blk = landv[cz * N:(cz + 1) * N + 3, cx * N:(cx + 1) * N + 3]
            return bool(blk.any())

        grids, f025 = build_dem_grids(mosaic, w2ll, X0, Z0, shape[1], shape[0], CHUNK, has_land)
        np.savez(npz, f025=f025, **grids)
        print(f"dem grids: {time.time() - t0:.0f}s")
    method = a.dem_method
    if method == "ridge":
        Hd = ridge_blend(grids, RIDGE_W)
    else:
        Hd = grids[method].copy()
    valid = grids["valid"] >= 0.5
    land = S > 0
    fallback = land & ~valid
    Hd = np.where(valid, Hd, land_proc)
    # 海岸：NE の海岸線へなじませる＋低地の下限
    floor = LOW_FLOOR_COAST + (LOW_FLOOR_IN - LOW_FLOOR_COAST) * smoothstep(0, LOW_FLOOR_KM, S)
    taper = smoothstep(0.0, COAST_TAPER_KM, S)
    Hl = floor + (np.maximum(Hd, floor) - floor) * taper
    info = {
        "method": method, "ridgeW": RIDGE_W if method == "ridge" else None,
        "landVertices": int(land.sum()), "fallbackVertices": int(fallback.sum()),
        "flooredVertices": int((land & valid & (Hd < floor)).sum()),
    }
    print("dem land vertices", info)
    return Hl.astype(np.float32), info, grids, f025


LM_PAD_CORE = 0.6   # km  ランドマーク中心からこの距離の頂点を「実際の地盤高」にそろえる
LM_PAD_RAMP = 0.7   # km  その外側で元の地形へ戻す幅


def landmark_pads(Hm, a, path):
    """v4: ランドマーク（橋を除く）の足元の 1km 頂点を、その地点の実際の地盤高（DEM 90m の半径 300m の下位 20% 値＝DSM の樹木・建物を避ける）にそろえる。
    1km の尾根保存ブレンドは周囲の山の高さを拾うので、海辺の厳島神社が山腹（80m）に乗るなどを防ぐ。"""
    if not os.path.exists(path):
        return
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "dem"))
    from copernicus import DemMosaic  # noqa
    mos = DemMosaic(a.dem_cache or os.path.join(a.src, "dem", "cop90"))
    L = json.load(open(path, encoding="utf-8"))
    items = L["landmarks"] if isinstance(L, dict) else L
    for it in items:
        if it.get("kind") == "bridge":
            continue
        lat, lon = it["lat"], it["lon"]
        A, top, left, dlat, dlon = mos.window(lat - 0.005, lat + 0.005, lon - 0.005, lon + 0.005, pad_px=2)
        R_, C_ = np.mgrid[0:A.shape[0], 0:A.shape[1]]
        la = top - (R_ + 0.5) * dlat
        lo = left + (C_ + 0.5) * dlon
        dk = np.hypot((la - lat) * 111.0, (lo - lon) * 111.0 * math.cos(math.radians(lat)))
        v = A[(dk < 0.3) & np.isfinite(A)]
        if len(v) == 0:
            continue
        target = max(float(np.percentile(v, 20)), LOW_FLOOR_COAST + 1)   # DSM の樹木・建物を拾わないよう下位 20%
        x, z = ll2w(lat, lon)
        i0, i1 = int(x - X0) - 2, int(x - X0) + 5
        j0, j1 = int(z - Z0) - 2, int(z - Z0) + 5
        J, I = np.mgrid[j0:j1, i0:i1]
        d = np.hypot(X0 + (I - 1) - x, Z0 + (J - 1) - z)
        h = Hm[j0:j1, i0:i1].astype(np.float32)
        land = h > 0
        t = smoothstep(LM_PAD_CORE, LM_PAD_CORE + LM_PAD_RAMP, d)
        new = np.where(land, target + (h - target) * t, h)
        Hm[j0:j1, i0:i1] = np.round(new).astype(Hm.dtype)
        print(f"  landmark pad {it['id']:<22} ground {target:6.1f} m  (1km grid before {h[land].max() if land.any() else 0:6.0f} m max nearby)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default="../src_data")
    ap.add_argument("--out", default="data/terrain")
    ap.add_argument("--elevation", choices=["dem", "procedural"], default="dem")
    ap.add_argument("--dem-cache", default=None, help="Copernicus GLO-90 タイルの置き場（既定 SRC/dem/cop90）")
    ap.add_argument("--dem-method", default="ridge", choices=["ridge", "mean", "median", "p75", "p90", "max"])
    ap.add_argument("--reuse-dem", action="store_true", help="前回の DEM 縮約結果（キャッシュ）を再利用")
    # v3: 湖沼・河川（tools/water.py）。--no-water で湖沼・河川の加工なし
    here = os.path.dirname(os.path.abspath(__file__))
    ap.add_argument("--water-defs", default=os.path.join(here, "water_defs.json"))
    ap.add_argument("--water-out", default=os.path.join(here, "..", "data", "water.json"))
    ap.add_argument("--no-water", action="store_true")
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
    land[foreign_mask(LAT, LON)] = 0
    land[LAT > FADE_END + 0.25] = 0
    land_b = land > 0
    land_b &= ~(lake > 0)
    del PX, PZ, LAT, LON

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

    land_proc, sea_h, Hm_proc = procedural_heights(VX, VZ, S, shape)
    dem_info = None
    grids = f025 = None
    if a.elevation == "dem":
        land_dem, dem_info, grids, f025 = dem_land_heights(a, VX, VZ, S, land_proc, shape, a.src)
        Hm = np.where(S > 0, land_dem, Hm_proc)
    else:
        Hm = Hm_proc

    # 北限より北はなじませながら海へ沈める
    fade = np.clip((VLAT - NORTH_LIMIT - 0.03) / (FADE_END - NORTH_LIMIT), 0, 1)
    fade = fade * fade * (3 - 2 * fade)
    Hm = Hm * (1 - fade) + SEA_FLOOR * fade * 0.6 + np.minimum(Hm, 0) * fade * 0.4
    Hm = np.clip(Hm, SEA_FLOOR, 4000).astype(np.int16)
    print("height range", Hm.min(), Hm.max())
    if a.elevation == "dem":
        landmark_pads(Hm, a, os.path.join(here, "..", "data", "landmarks.json"))
    Hm_pre_water = Hm.copy()

    # ---- v3: 湖沼・河川で地形を加工し、水域データを書き出す ----
    water = None
    if not a.no_water and os.path.exists(a.water_defs):
        sys.path.insert(0, here)
        from water import WaterBuilder
        water = WaterBuilder(a.water_defs, a.src, ll2w, w2ll, X0, Z0, HI_STEP,
                             dem_cache=(a.dem_cache or os.path.join(a.src, "dem", "cop90")) if a.elevation == "dem" else None,
                             f025=f025)
        print("water: lakes")
        water.carve_lakes(Hm)
        print("water: rivers")
        water.carve_rivers(Hm)
        Hm = np.clip(Hm, SEA_FLOOR, 4000).astype(np.int16)

    os.makedirs(os.path.join(a.out, "hi"), exist_ok=True)
    # 既存チャンク削除
    for f in os.listdir(os.path.join(a.out, "hi")):
        os.remove(os.path.join(a.out, "hi", f))

    # coarse (4km)  … 縁なし。index: [j][i] , x = X0 + i*4
    st = int(COARSE_STEP / HI_STEP)
    point = Hm[1:-1:st, 1:-1:st].astype(np.float32)
    if a.elevation == "dem":
        # v4: 4km 頂点は「周囲 4km の尾根保存ブレンド」（点の間引きだと 4km 未満の山地・尾根が消える）
        Hp = np.maximum(Hm.astype(np.float32), 0)
        k = np.array([0.5, 1, 1, 1, 0.5], np.float32)
        K = np.outer(k, k)
        K /= K.sum()
        mean4 = ndimage.convolve(Hp, K, mode="nearest")
        p90_4 = ndimage.percentile_filter(Hp, 90, size=5, mode="nearest")
        blend = mean4 + 0.5 * (p90_4 - mean4)
        blend = blend[1:-1:st, 1:-1:st]
        coarse = np.where(point > 0, np.maximum(np.maximum(blend, 2.0), np.minimum(point, 2.0)), point)
    else:
        coarse = point
    coarse = np.ascontiguousarray(np.round(coarse)).astype("<i2")
    if water is not None:
        coarse = water.carve_lakes_coarse(coarse, COARSE_STEP)
        water.export(a.water_out, elevation_source=a.elevation)
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

    elev = {"source": "procedural", "note": "v1-v3 procedural terrain (not measured)"}
    if a.elevation == "dem":
        elev = {
            "source": "Copernicus DEM GLO-90",
            "attribution": "produced using Copernicus WorldDEM-90 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved",
            "sourceResolution": "3 arc-second (~90 m), EGM2008 heights, DSM",
            "resampling": "3x3 grey opening, then per 1 km vertex: mean + 0.5*(p90-mean) of 64 samples (0.125 km) in the 1 km footprint; coarse 4 km = same blend over 5x5 of the 1 km grid",
            "coastline": "Natural Earth 1:10m (land/sea mask unchanged); land floor 2-10 m; 0.6 km coastal taper",
            "seaFloor": "synthetic (distance from coast), not measured",
            **(dem_info or {}),
        }
    manifest = {
        "version": 2,
        "projection": {
            "type": "sinusoidal",
            "lon0": LON0, "lat0": LAT0, "earthRadiusKm": EARTH_R,
            "note": "x=(lon-lon0)*kmPerDeg*cos(lat), z=-(lat-lat0)*kmPerDeg, 1 unit = 1 km",
        },
        "northLimitLat": NORTH_LIMIT,
        "fadeEndLat": FADE_END,
        "seaFloorM": SEA_FLOOR,
        "elevation": elev,
        "grid": {"x0": X0, "z0": Z0, "chunkKm": CHUNK, "ncx": NCX, "ncz": NCZ},
        "coarse": {"file": "coarse.bin", "stepKm": COARSE_STEP, "nx": int(coarse.shape[1]), "nz": int(coarse.shape[0])},
        "hi": {"dir": "hi/", "stepKm": HI_STEP, "samples": N + 3, "border": 1,
               "chunks": chunks},
        "format": "Int16 little-endian, metres above sea level, row-major [z][x]",
    }
    with open(os.path.join(a.out, "manifest.json"), "w") as f:
        json.dump(manifest, f, separators=(",", ":"), ensure_ascii=False)

    # プレビュー・検証用（配信には不要）
    prev = coarse.astype(np.float32)
    img = np.zeros(prev.shape + (3,), np.uint8)
    land_m = prev > 0
    img[~land_m] = (20, 60, 120)
    g = np.clip(prev / 3000, 0, 1)
    img[land_m] = (np.stack([60 + 180 * g, 140 + 60 * g, 60 + 150 * g], -1)[land_m]).astype(np.uint8)
    Image.fromarray(img).save(os.path.join(a.src, "preview.png"))
    np.save(os.path.join(a.src, "hm_full.npy"), Hm)
    np.save(os.path.join(a.src, "hm_prewater.npy"), Hm_pre_water)
    np.save(os.path.join(a.src, "signed_dist.npy"), S)


if __name__ == "__main__":
    main()
