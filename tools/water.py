#!/usr/bin/env python3
"""
DHT EXPRESS STAGE — 湖沼・河川の地形加工と水域データの書き出し（v3）
=====================================================================

tools/build_terrain.py から呼ばれる（単体実行は不可。地形の合成直後の標高配列 Hm を加工する）。

入力
  tools/water_defs.json   湖の外周（[緯度, 経度] のリング、2 本目以降は島）・河川の流路（源流→河口）
  ne_10m_rivers_lake_centerlines.geojson （利根川の流路のみ。Natural Earth = Public Domain）

処理
  1) 湖：湖の範囲（＋1km 格子のセルが掛かる範囲）の標高を「水面 − 7m」に平らにならし、
     外側へなめらかに元の地形へ戻す（盛土・切土の両方）。水面標高 L は湖周辺の元地形の下位 20% 値（主に切土＝くぼ地に水がたまって見える）。
     → 地形が手続き生成なので、実際の湖面標高ではなく「この地形で自然に見える高さ」に置く。
  2) 河川：流路を 0.25km 間隔に細分化（Catmull-Rom）。各点の「周囲 1.2km の最低標高」から
     上流→下流の累積最小値を取り、単調に下る水面高 p(s) を作る（＝水が山を登らない）。
     流路沿いの地形を p − 6m まで掘り下げ、両側は深さに応じた幅でなだらかに元地形へ戻す（谷）。
  3) 粗い地形（4km 間隔）は湖だけを同様に加工（遠景で湖が地形に埋もれないように）。
     河川の遠景は JS 側（js/water.js）で粗地形の上に乗せて描く。
  4) data/water.json に、湖のポリゴンと水面標高、河川の中心線・水面標高・川幅を書き出す。

単位：水平 km（ワールド座標＝ js/geo.js と同じ正弦図法）、標高 m（Y = m/1000*3）。

v4（実測 DEM 使用時。dem_cache / f025 を渡すと有効。README §13.5）
  ・湖面標高 = 湖内の Copernicus DEM 画素の最頻値（DEM は水面を一定の高さに編集済み）
  ・内陸の湖（湖面 20m 以上）は湖岸線も DEM の水面から作り直す
  ・湖の加工は「湖面に掛かる 1km セルの 4 隅」＋外側 0.4〜1km の戻しだけ（実在の山を削らない）
  ・河川は流路を DEM の谷筋へ補正（回廊 ±7km の最小コスト経路）し、実 DEM の谷底に合わせた
    単調な水面（isotonic 回帰）を作る。掘るのは中心線 0.55km 以内、源流付近は浅く
  ・上記 1)〜3) の v3 の動作は、DEM を渡さない場合（--elevation procedural）にそのまま残っている
"""
import json
import math
import os

import numpy as np
from scipy import ndimage
from scipy.spatial import cKDTree

LAKE_EPS = 7.0        # m  湖底（湖岸の平坦部）を水面よりこれだけ下げる（Z ファイティング回避 ≒ Y 0.021）
RIVER_EPS = 6.0       # m  河床を水面よりこれだけ下げる
LAKE_MIN_LEVEL = 12.0 # m  陸の湖の水面の下限（海面 Y=0 の板と十分離す）
RIVER_MIN_LEVEL = 3.0 # m  河川水面の下限（河口）  ※v4: 実 DEM の低地（下限 10m）に合わせて 7 → 3
RIVER_LAND_LEVEL = 9.0 # m 河口付近以外の河川水面の下限  ※v4: 25 → 9（低地の陸の下限 10m より下）
LOW_LAKE_LEVEL = 3.0  # m  v4: 海抜 0m 付近の湖（霞ヶ浦・宍道湖など）の水面の下限（海面 Y=0 の板と離す）
SNAP_MAX_KM = float(os.environ.get("DHT_SNAP_KM", 7.0))     # km v4: 河川流路を実 DEM の谷筋へ寄せる最大距離（回廊の半幅。別の流域へ飛ばさない）
SNAP_STEP_KM = 0.25
RIVER_CORE_DEM = float(os.environ.get("DHT_RIVER_CORE", 0.55))  # km v4: 川の中心線からこの距離（＋川幅/2）の頂点だけを河床の高さへ下げる
LAKE_REACH_DEM = 0.7   # km v4: 湖岸からこの距離までを湖底の高さにならす（1km 格子のセルが湖面を突き抜けない最小限）
MOUTH_RAMP_KM = 4.0   # km 河口からこの距離で RIVER_LAND_LEVEL → RIVER_MIN_LEVEL に下げる
CELL_REACH = 1.45     # km 1km 格子のセルが水面に掛かる頂点までの距離（√2 + 余裕）
NORTH_CLIP = 37.74    # 北限の外（地形が海へ沈む帯）では河川を描かない


# ---------------------------------------------------------------------------
# 幾何ユーティリティ（numpy のみ）
# ---------------------------------------------------------------------------
def points_in_ring(px, pz, ring):
    """ray casting。ring: (N,2) world xz"""
    inside = np.zeros(px.shape, bool)
    n = len(ring)
    for k in range(n):
        x1, z1 = ring[k]
        x2, z2 = ring[(k + 1) % n]
        cond = (z1 > pz) != (z2 > pz)
        with np.errstate(divide="ignore", invalid="ignore"):
            xi = (x2 - x1) * (pz - z1) / (z2 - z1) + x1
        inside ^= cond & (px < xi)
    return inside


def dist_to_rings(px, pz, rings):
    d = np.full(px.shape, 1e9)
    for ring in rings:
        n = len(ring)
        for k in range(n):
            ax, az = ring[k]
            bx, bz = ring[(k + 1) % n]
            dx, dz = bx - ax, bz - az
            L2 = dx * dx + dz * dz
            t = np.clip(((px - ax) * dx + (pz - az) * dz) / max(L2, 1e-12), 0, 1)
            d = np.minimum(d, np.hypot(px - (ax + t * dx), pz - (az + t * dz)))
    return d


def in_polygon(px, pz, rings):
    ins = points_in_ring(px, pz, rings[0])
    for hole in rings[1:]:
        ins &= ~points_in_ring(px, pz, hole)
    return ins


def smoothstep(t):
    t = np.clip(t, 0, 1)
    return t * t * (3 - 2 * t)


def catmull_rom(pts, spacing):
    """pts: (N,2) → 約 spacing 間隔の滑らかな折れ線（端点を通る）"""
    pts = np.asarray(pts, float)
    if len(pts) < 3:
        seg = [pts[0]]
        for k in range(len(pts) - 1):
            L = np.hypot(*(pts[k + 1] - pts[k]))
            n = max(1, int(math.ceil(L / spacing)))
            for i in range(1, n + 1):
                seg.append(pts[k] + (pts[k + 1] - pts[k]) * i / n)
        return np.array(seg)
    P = np.vstack([2 * pts[0] - pts[1], pts, 2 * pts[-1] - pts[-2]])
    out = [pts[0]]
    for k in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[k - 1], P[k], P[k + 1], P[k + 2]
        L = np.hypot(*(p2 - p1))
        n = max(1, int(math.ceil(L / spacing)))
        for i in range(1, n + 1):
            t = i / n
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    return np.array(out)


def simplify(points, tol_xy, tol_h):
    """Douglas-Peucker（水平 tol_xy km・水面高 tol_h m の両方を満たす）。points: (N,4) x,z,h,w"""
    keep = np.zeros(len(points), bool)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        a, b = stack.pop()
        if b <= a + 1:
            continue
        A, B = points[a], points[b]
        seg = B[:2] - A[:2]
        L2 = max(seg @ seg, 1e-12)
        mid = points[a + 1 : b]
        t = np.clip(((mid[:, :2] - A[:2]) @ seg) / L2, 0, 1)
        proj = A[:2] + t[:, None] * seg
        dxy = np.hypot(*(mid[:, :2] - proj).T)
        # 水面高・川幅は弧長で線形補間した値との差
        s = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(points[a : b + 1, :2], axis=0).T))])
        u = s[1:-1] / max(s[-1], 1e-9)
        dh = np.abs(mid[:, 2] - (A[2] + (B[2] - A[2]) * u))
        dw = np.abs(mid[:, 3] - (A[3] + (B[3] - A[3]) * u)) * 1000 / 40  # 40m の幅誤差 ≒ 1
        err = np.maximum(dxy / tol_xy, np.maximum(dh / tol_h, dw))
        k = int(np.argmax(err))
        if err[k] > 1:
            m = a + 1 + k
            keep[m] = True
            stack += [(a, m), (m, b)]
    return points[keep]


def cell_corners_touching(X, Z, rings, sub=10):
    """頂点格子 X, Z（1km 間隔）のうち、湖ポリゴンに掛かるセルの 4 隅にあたる頂点"""
    nz, nx = X.shape
    step = X[0, 1] - X[0, 0]
    fx = X[0, 0] + (np.arange((nx - 1) * sub) + 0.5) * step / sub
    fz = Z[0, 0] + (np.arange((nz - 1) * sub) + 0.5) * step / sub
    FX, FZ = np.meshgrid(fx, fz)
    ins = in_polygon(FX, FZ, rings).reshape(nz - 1, sub, nx - 1, sub).any(axis=(1, 3))
    out = np.zeros((nz, nx), bool)
    out[:-1, :-1] |= ins
    out[1:, :-1] |= ins
    out[:-1, 1:] |= ins
    out[1:, 1:] |= ins
    return out


def L_guess(wb, lk, h0, core):
    """湖面標高（DEM の最頻値）。carve_lakes 内で L を決める前に core の判定に使う"""
    if not hasattr(wb, "_lv_cache"):
        wb._lv_cache = {}
    if lk["id"] not in wb._lv_cache:
        v = wb.dem_lake_level(lk["rings"])
        wb._lv_cache[lk["id"]] = v[0] if v else float(np.percentile(h0[core], 20))
    return wb._lv_cache[lk["id"]]


def isotonic_decreasing(y):
    """単調非増加の最小二乗近似（Pool Adjacent Violators）"""
    vals, wts, lens = [], [], []
    for v in y:
        vals.append(float(v))
        wts.append(1.0)
        lens.append(1)
        while len(vals) > 1 and vals[-2] < vals[-1]:
            w = wts[-2] + wts[-1]
            m = (vals[-2] * wts[-2] + vals[-1] * wts[-1]) / w
            n = lens[-2] + lens[-1]
            vals[-2:] = [m]
            wts[-2:] = [w]
            lens[-2:] = [n]
    return np.repeat(vals, lens)


# ---------------------------------------------------------------------------
class WaterBuilder:
    def __init__(self, defs_path, src_dir, ll2w, w2ll, X0, Z0, step=1.0, dem_cache=None, f025=None):
        self.defs = json.load(open(defs_path, encoding="utf-8"))
        # v4: 実 DEM（湖面標高の算出）と 0.25km 平均標高ラスタ（河川の谷筋探索）
        self.dem = None
        if dem_cache:
            import sys
            sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "dem"))
            from copernicus import DemMosaic
            self.dem = DemMosaic(dem_cache)
        self.f025 = None if f025 is None else np.nan_to_num(f025, nan=0.0).astype(np.float32)
        self.ll2w, self.w2ll = ll2w, w2ll
        self.X0, self.Z0, self.step = X0, Z0, step
        ne = os.path.join(src_dir, "ne_10m_rivers_lake_centerlines.geojson")
        self.tone = None
        if os.path.exists(ne):
            for f in json.load(open(ne))["features"]:
                if f["properties"].get("name") == "Tone":
                    g = f["geometry"]
                    cs = g["coordinates"][0] if g["type"] == "MultiLineString" else g["coordinates"]
                    self.tone = [[c[1], c[0]] for c in cs]
        self.lakes = []
        self.rivers = []
        self.lake_log = []
        self.river_log = []

    # 緯度経度リスト → world (N,2)
    def W(self, lls):
        a = np.array(lls, float)
        x, z = self.ll2w(a[:, 0], a[:, 1])
        return np.stack([x, z], 1)

    # Hm（縁 1 サンプル付き、Hm[J][I] ↔ x = X0 + (I-1)*step）の双線形サンプル
    def sample(self, Hm, x, z):
        fi = (np.asarray(x) - self.X0) / self.step + 1
        fj = (np.asarray(z) - self.Z0) / self.step + 1
        return ndimage.map_coordinates(Hm.astype(np.float32), [np.atleast_1d(fj), np.atleast_1d(fi)], order=1, mode="nearest")

    def _window(self, Hm, bx0, bz0, bx1, bz1, step, x0, z0, border):
        """bbox を覆う頂点インデックス範囲と座標格子"""
        nz, nx = Hm.shape
        i0 = max(0, int(math.floor((bx0 - x0) / step)) + border)
        i1 = min(nx - 1, int(math.ceil((bx1 - x0) / step)) + border)
        j0 = max(0, int(math.floor((bz0 - z0) / step)) + border)
        j1 = min(nz - 1, int(math.ceil((bz1 - z0) / step)) + border)
        I = np.arange(i0, i1 + 1)
        J = np.arange(j0, j1 + 1)
        X, Z = np.meshgrid(x0 + (I - border) * step, z0 + (J - border) * step)
        return (slice(j0, j1 + 1), slice(i0, i1 + 1)), X, Z

    # ------------------------------------------------------------------
    def carve_lakes(self, Hm):
        H0 = Hm.astype(np.float32).copy()
        self.lake_mask = np.zeros(Hm.shape, bool)  # 湖の平坦部（河川の盛土で埋めないため）
        for lk0 in self.defs["lakes"]:
            lk = dict(lk0)
            lk["ringSource"] = "hand-digitized"
            if self.dem is not None:
                rr = self.dem_lake_rings(lk)
                if rr is not None:
                    lk["rings"] = rr
                    lk["ringSource"] = "Copernicus DEM GLO-90 water surface"
            rings = [self.W(r) for r in lk["rings"]]
            ext = rings[0]
            pad = 12.0
            bx0, bz0 = ext.min(0) - pad
            bx1, bz1 = ext.max(0) + pad
            sl, X, Z = self._window(Hm, bx0, bz0, bx1, bz1, self.step, self.X0, self.Z0, 1)
            h0 = H0[sl]                       # 元の地形（水面標高の決定用）
            hc = Hm[sl].astype(np.float32)    # 現在の地形（先に処理した近くの湖の加工を壊さない）
            prev = self.lake_mask[sl]
            ins = in_polygon(X, Z, rings)
            d = np.where(ins, 0.0, dist_to_rings(X, Z, rings))
            # v4（実 DEM）: 周囲は実際の湖岸の地形なので、ならす範囲を湖内＋0.7km、戻す幅を 0.4〜1.0km に縮める
            #  （v3 の 1.45km＋2〜8km だと、河口湖の北岸に迫る御坂山地などの実在の山腹まで削ってしまう）
            reach = LAKE_REACH_DEM if self.dem is not None else CELL_REACH
            core = ins | (d <= reach)
            if self.dem is not None:
                # v4: 湖面に掛かる 1km セルの 4 隅だけを湖底へ（湖が地形に隠れない最小限）。
                #     それ以外は湖岸 0.7km 以内でも、実 DEM が湖面より 120m 以上高ければ残す
                core = ins | cell_corners_touching(X, Z, rings) | ((d <= reach) & (h0 <= L_guess(self, lk, h0, core) + 120.0))
            inner = ins | (d <= 0.6)
            sea_frac = float((h0[inner] <= 0).mean()) if inner.any() else 0
            sea = sea_frac > 0.5
            dem_level = self.dem_lake_level(lk["rings"]) if self.dem is not None else None   # （L_guess と同じ値）
            if sea:
                L = 2.0
                bed = -3.0
            elif dem_level is not None:
                # v4: 実 DEM（Copernicus は水面を一定の高さに編集済み）の湖内画素の最頻値＝湖面標高
                L = float(max(LOW_LAKE_LEVEL, dem_level[0]))
                bed = L - LAKE_EPS
            else:
                L = float(max(LAKE_MIN_LEVEL, np.percentile(h0[core], 20)))
                bed = L - LAKE_EPS
            # 湖の周囲：切土・盛土で水面直下の平坦面にならし、外側は高低差に応じた幅で元地形へ戻す
            if self.dem is not None:
                R = np.clip(0.4 + np.abs(hc - bed) / 1500.0, 0.4, 1.0)
            else:
                R = np.clip(2.0 + np.abs(hc - bed) / 150.0, 2.0, 8.0)
            t = (d - reach) / R
            s = smoothstep(t)
            target = bed + (hc - bed) * s
            new = np.where(core, bed, target)
            if sea:
                new = np.where(core, np.minimum(hc, bed), np.minimum(hc, target))
            if self.dem is not None:
                # v4: 湖の外で、実 DEM が湖面より 120m 以上高い頂点（湖岸に迫る山・カルデラ壁）はならさない
                #     （手描きの湖岸線のずれで、芦ノ湖の東の神山などの実在の山を削らないため）
                protect = (~core) & (h0 > L + 120.0)
                new = np.where(protect, hc, new)
            # 先に処理した湖（富士五湖・霞ヶ浦と北浦など隣り合う湖）の湖底は高くしない
            new = np.where(prev, np.minimum(hc, new), new)
            Hm[sl] = np.round(new).astype(Hm.dtype)
            self.lake_mask[sl] |= core
            area = self._area(rings)
            c = self.w2ll(*ext.mean(0))
            self.lakes.append({
                "id": lk["id"], "name": lk["name"], "nameEn": lk.get("nameEn"), "type": "lake",
                "rank": lk.get("rank", 2), **({"group": lk["group"]} if lk.get("group") else {}),
                "levelM": round(L, 1), "seaLevel": sea, "areaKm2": round(area, 1), "ringSource": lk["ringSource"],
                **({"demLevelM": round(dem_level[0], 1), "levelSource": "Copernicus DEM GLO-90: " + dem_level[1]} if dem_level is not None else {"levelSource": "fitted to procedural terrain"}),
                "center": [round(float(c[0]), 4), round(float(c[1]), 4)],
                "rings": [[[round(p[0], 4), round(p[1], 4)] for p in r] for r in lk["rings"]],
            })
            self.lake_log.append({"id": lk["id"], "name": lk["name"], "levelM": round(L, 1), "demLevelM": None if dem_level is None else round(dem_level[0], 1),
                                  "cutFillMaxM": round(float(np.abs(new - h0)[core].max()), 0)})
            print(f"  lake {lk['name']:<6} dem {dem_level[0] if dem_level else float('nan'):7.1f}  level {L:7.1f} m  area {area:6.1f} km2  sea={sea}  cut/fill max {np.abs(new - h0)[core].max():6.0f} m")
        return Hm

    def dem_lake_level(self, rings_ll):
        """湖面標高を実 DEM から求める。Copernicus DEM は水面を一定の高さに編集してあるので、
        湖内の画素で最も多い値（0.5m 単位の最頻値）＝湖面。
          1) ポリゴン内の最頻値（ポリゴン内画素の 15% 以上を占める場合）
          2) ポリゴン外接矩形＋約 1km の最頻値（8% 以上。手描きポリゴンが小さな湖からずれている場合）
          3) それ以外はポリゴン内の 10 パーセンタイル
        → (level, method, nPixels)"""
        ext = np.array(rings_ll[0], float)
        m = 0.01
        A, top, left, dlat, dlon = self.dem.window(ext[:, 0].min() - m, ext[:, 0].max() + m, ext[:, 1].min() - m, ext[:, 1].max() + m, pad_px=2)
        r = np.arange(A.shape[0])
        c = np.arange(A.shape[1])
        C, R = np.meshgrid(c, r)
        lat = top - (R + 0.5) * dlat
        lon = left + (C + 0.5) * dlon
        x, z = self.ll2w(lat, lon)
        rings = [self.W(rr) for rr in rings_ll]
        ins = in_polygon(x, z, rings) & np.isfinite(A)
        v = A[ins]
        if len(v) < 4:
            return None

        def mode(a):
            vals, cnt = np.unique(np.round(a * 2) / 2, return_counts=True)
            k = int(np.argmax(cnt))
            return float(vals[k]), cnt[k] / len(a)

        lv, share = mode(v)
        if share >= 0.15:
            return lv, f"mode inside polygon ({share:.0%} of {len(v)} px)", int(len(v))
        vb = A[np.isfinite(A)]
        lv, share = mode(vb)
        if share >= 0.08:
            return lv, f"mode in polygon bbox+1km ({share:.0%})", int(len(v))
        return float(np.percentile(v, 10)), "p10 inside polygon", int(len(v))

    def dem_lake_rings(self, lk, min_level=20.0):
        """v4: 内陸の湖（湖面 20m 以上）は、手描きの湖岸線の代わりに実 DEM の水面
        （Copernicus DEM は湖面を一定の高さに編集してある）から湖岸線を作る。
        湖面標高 ±0.6m の画素の連結成分のうち手描きポリゴンと最も重なるもの → 輪郭 → 約 40m で簡略化。
        海抜 0m 付近の湖（霞ヶ浦・宍道湖など）は海と区別できないので手描きのまま。→ rings or None"""
        from skimage import measure
        lv = self.dem_lake_level(lk["rings"])
        if lv is None or lv[0] < min_level:
            return None
        L = lv[0]
        ext = np.array(lk["rings"][0], float)
        m = 0.02
        A, top, left, dlat, dlon = self.dem.window(ext[:, 0].min() - m, ext[:, 0].max() + m, ext[:, 1].min() - m, ext[:, 1].max() + m, pad_px=3)
        water = np.isfinite(A) & (np.abs(A - L) <= 0.6)
        water = ndimage.binary_opening(water, iterations=1)
        lab, n = ndimage.label(water)
        if n == 0:
            return None
        R_, C_ = np.mgrid[0:A.shape[0], 0:A.shape[1]]
        x, z = self.ll2w(top - (R_ + 0.5) * dlat, left + (C_ + 0.5) * dlon)
        hand = in_polygon(x, z, [self.W(r) for r in lk["rings"]]) | (dist_to_rings(x, z, [self.W(lk["rings"][0])]) < 0.3)
        ov = ndimage.sum(hand, lab, index=np.arange(1, n + 1))
        k = int(np.argmax(ov)) + 1
        if ov[k - 1] < 20:
            return None
        comp = ndimage.binary_fill_holes(lab == k)
        if comp.sum() * (dlat * 111.0) * (dlon * 111.0 * math.cos(math.radians(ext[:, 0].mean()))) < 0.3:
            return None
        cs = measure.find_contours(np.pad(comp, 1).astype(float), 0.5)
        c = max(cs, key=len) - 1  # pad を戻す
        lat = top - (c[:, 0] + 0.5) * dlat
        lon = left + (c[:, 1] + 0.5) * dlon
        xx, zz = self.ll2w(lat, lon)
        pts = np.column_stack([xx, zz, np.zeros(len(xx)), np.zeros(len(xx))])
        simp = simplify(pts, 0.04, 1e9)
        la, lo = self.w2ll(simp[:, 0], simp[:, 1])
        ring = [[round(float(a), 5), round(float(b), 5)] for a, b in zip(la, lo)]
        if len(ring) > 3 and ring[0] == ring[-1]:
            ring = ring[:-1]
        return [ring] if len(ring) >= 4 else None

    def _area(self, rings):
        def a(r):
            x, z = r[:, 0], r[:, 1]
            return 0.5 * abs(np.dot(x, np.roll(z, -1)) - np.dot(z, np.roll(x, -1)))
        return a(rings[0]) - sum(a(h) for h in rings[1:])

    def carve_lakes_coarse(self, C, cstep):
        """粗データ（4km, 縁なし, C[j][i] ↔ x = X0 + i*cstep）も湖の範囲をならす"""
        C0 = C.astype(np.float32).copy()
        for lk in self.lakes:
            rings = [self.W(r) for r in lk["rings"]]
            ext = rings[0]
            pad = 20.0
            sl, X, Z = self._window(C, *(ext.min(0) - pad), *(ext.max(0) + pad), cstep, self.X0, self.Z0, 0)
            h0 = C0[sl]
            ins = in_polygon(X, Z, rings)
            d = np.where(ins, 0.0, dist_to_rings(X, Z, rings))
            # v4（実 DEM）: 4km 格子でも湖の周りの実在の山（河口湖の北の御坂山地など）を削り過ぎない
            reach = 1.5 if self.dem is not None else cstep * 1.42
            width = 3.0 if self.dem is not None else 6.0
            core = ins | (d <= reach)
            bed = -3.0 if lk["seaLevel"] else lk["levelM"] - LAKE_EPS
            s = smoothstep((d - reach) / width)
            new = np.where(core, bed, bed + (h0 - bed) * s)
            if lk["seaLevel"]:
                new = np.minimum(h0, new)
            C[sl] = np.round(new).astype(C.dtype)
        return C

    # ------------------------------------------------------------------
    def carve_rivers(self, Hm):
        lake_polys = [(lk, [self.W(r) for r in lk["rings"]]) for lk in self.lakes]
        for rv in self.defs["rivers"]:
            line = rv["line"] or (self.tone if rv.get("source") == "naturalearth" else None)
            if not line:
                print("  river", rv["name"], "skipped (no data)")
                continue
            P = catmull_rom(self.W(line), 0.25)
            P_orig = P.copy()
            shift = np.zeros(len(P))
            if self.f025 is not None and not os.environ.get("DHT_NO_SNAP"):
                P, shift = self.snap_to_valley(P)   # v4: 実 DEM の谷筋へ流路を寄せる（地形を削る代わりに）
            # 河口の点が海岸線のわずかに内側にあっても海までつながるよう、最後の向きのまま 4km 延長する
            # （延長部分は海・湖に入った所で下の処理により切り落とされる）
            tdir = P[-1] - P[-5]
            tdir /= max(np.hypot(*tdir), 1e-9)
            P = np.vstack([P, P[-1] + tdir[None, :] * (0.25 * np.arange(1, 17))[:, None]])
            lat, lon = self.w2ll(P[:, 0], P[:, 1])
            # 湖の中の部分を除く（湖とつながる川）、北限の外を除く
            inlake = np.zeros(len(P), bool)
            lake_level = np.full(len(P), np.inf)
            for lk, rings in lake_polys:
                m = in_polygon(P[:, 0], P[:, 1], rings)
                inlake |= m
                # 湖岸近く（1km）では水面を湖面以下にそろえる
                near = dist_to_rings(P[:, 0], P[:, 1], rings) < 1.0
                lake_level[near | m] = np.minimum(lake_level[near | m], lk["levelM"])
            # 断面（左右 ±1.2km）の最低標高
            tang = np.gradient(P, axis=0)
            tang /= np.maximum(np.hypot(*tang.T), 1e-9)[:, None]
            nrm = np.stack([-tang[:, 1], tang[:, 0]], 1)
            hs = [self.sample(Hm, P[:, 0] + nrm[:, 0] * o, P[:, 1] + nrm[:, 1] * o) for o in (-1.2, -0.6, 0, 0.6, 1.2)]
            hc = hs[2]
            hmin = np.min(hs, axis=0)
            real_floor = None
            if self.f025 is not None:
                # v4: 水面の基準は「実 DEM（0.25km 平均）の谷底」＝流路の左右 ±0.5km の最低標高。
                #     1km 格子の地形（尾根保存で谷が浅く見える）ではなく、実際の川の高さに合わせる
                rf = [self._f025(P[:, 0] + nrm[:, 0] * o, P[:, 1] + nrm[:, 1] * o) for o in (-0.5, -0.25, 0, 0.25, 0.5)]
                real_floor = np.min(rf, axis=0)
                hmin = np.where(hc > 1.0, np.maximum(real_floor, 0.0), hmin)
            # 陸上だけを使う：先頭の海・湖（例：淀川の起点＝琵琶湖）を飛ばし、その後最初に海へ出た所で終える
            land = (hc > 1.0) & ~inlake & (lat <= NORTH_CLIP)
            idx = np.nonzero(land)[0]
            if len(idx) < 4:
                print("  river", rv["name"], "skipped (no land)")
                continue
            a = idx[0]
            b = a
            while b + 1 < len(P) and land[b + 1]:
                b += 1
            # 北限で切れた川（信濃川・阿賀野川・阿武隈川）は北限側が途中で終わる
            seg = slice(a, b + 1)
            P2 = P[seg]
            n = len(P2)
            p = hmin[seg].astype(float).copy()
            p = np.minimum(p, lake_level[seg])
            if real_floor is not None:
                # v4: 累積最小値（上流で一度でも低い点があると下流全体を掘る）ではなく、
                #     実 DEM の谷底に最も近い「単調に下る」水面（isotonic 回帰）を求め、
                #     1km 格子の地形より上に浮く所（尾根を横切る所）だけを局所的に下げる
                p = isotonic_decreasing(p)
                p = np.minimum(p, np.maximum(hc[seg] - 4.0, 0.0))
            p = np.minimum.accumulate(p)                      # 単調に下る
            # 平滑化（窓 2km）→ 再び単調化
            k = 9
            pp = np.convolve(np.pad(p, (k, k), mode="edge"), np.ones(2 * k + 1) / (2 * k + 1), mode="same")[k:-k]
            p = np.minimum.accumulate(np.minimum(pp, p + 0))
            s = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(P2, axis=0).T))])
            # 水面の下限：陸上では 25m（低地を掘り下げ過ぎて海岸の砂色の帯にしない）、海に出る川は河口 4km で 7m へ
            ends_at_sea = b + 1 < len(P) and hc[b + 1] <= 1.0 and not inlake[b + 1] and lat[b + 1] <= NORTH_CLIP
            # v3（手続き地形）は 25m / 7m のまま
            land_lv, min_lv = (RIVER_LAND_LEVEL, RIVER_MIN_LEVEL) if self.dem is not None else (25.0, 7.0)
            floor = np.full(n, land_lv)
            if ends_at_sea:
                floor = min_lv + (land_lv - min_lv) * np.clip((s[-1] - s) / MOUTH_RAMP_KM, 0, 1)
            p = np.maximum(p, floor)  # 下限も下流へ単調に下がるので、p は単調のまま
            # 全長に対する位置（北限で切れた川も本来の全長基準で幅を決める）
            s_full = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(P, axis=0).T))])
            u = (s_full[a:b + 1]) / s_full[-1]
            width = 0.15 + (rv["width"] - 0.15) * np.power(u, 0.7)
            hw = width / 2
            depth = hc[seg] - p
            # 実 DEM の谷底より何 m 低く掘ったか（＝実在しない人工の峡谷の深さ）
            below_real = (real_floor[seg] - p) if real_floor is not None else np.zeros(n)
            if os.environ.get("DHT_RIVER_DEBUG"):
                np.savez(os.path.join(os.environ["DHT_RIVER_DEBUG"], rv["id"] + ".npz"), P=P2, p=p, hc=hc[seg],
                         floor=(real_floor[seg] if real_floor is not None else hmin[seg]), shift=shift[a:b + 1] if len(shift) > b else shift[a:a + n] if len(shift) else np.zeros(n))
            self._carve_along(Hm, P2, p, hw, s_src=s_full[a:b + 1])
            pts = np.column_stack([P2, p, width])
            simp = simplify(pts, 0.05, 1.5)
            la, lo = self.w2ll(simp[:, 0], simp[:, 1])
            self.rivers.append({
                "id": rv["id"], "name": rv["name"], "nameEn": rv.get("nameEn"), "type": "river",
                "widthKm": rv["width"], "lengthKm": round(float(s[-1]), 1),
                "source": "Natural Earth" if rv.get("source") == "naturalearth" else "hand-digitized",
                "points": [[round(float(la[i]), 5), round(float(lo[i]), 5), round(float(simp[i, 2]), 1), round(float(simp[i, 3]), 3)] for i in range(len(simp))],
            })
            self.rivers[-1]["valleySnap"] = {"maxShiftKm": round(float(np.abs(shift).max()), 2), "meanShiftKm": round(float(np.abs(shift).mean()), 2)}
            self.river_log.append({"id": rv["id"], "name": rv["name"], "lengthKm": round(float(s[-1]), 1),
                                   "cutMaxM": round(float(depth.max()), 0), "cutMeanM": round(float(depth.mean()), 1),
                                   "cutP95M": round(float(np.percentile(depth, 95)), 0),
                                   "maxShiftKm": round(float(np.abs(shift).max()), 2),
                                   "belowRealFloorMaxM": round(float(below_real.max()), 0), "belowRealFloorP95M": round(float(np.percentile(below_real, 95)), 0)})
            print(f"  river {rv['name']:<5} {s[-1]:6.1f} km  pts {len(simp):4d}  surf {p[0]:6.0f}→{p[-1]:4.0f} m  cut max {depth.max():5.0f} m  p95 {np.percentile(depth, 95):4.0f}  mean {depth.mean():4.0f} m  shift max {np.abs(shift).max():.2f} km  below-real max {below_real.max():4.0f} p95 {np.percentile(below_real, 95):4.0f}")
        return Hm

    def _f025(self, x, z):
        """0.25km 平均標高ラスタ（縁付き頂点配列と同じ原点: 画素中心 x = X0 - 1.5 + (k + 0.5) * 0.25）"""
        c = (np.asarray(x) - (self.X0 - 1.5)) / 0.25 - 0.5
        r = (np.asarray(z) - (self.Z0 - 1.5)) / 0.25 - 0.5
        return ndimage.map_coordinates(self.f025, [r, c], order=1, mode="nearest")

    def snap_to_valley(self, P):
        """流路を実 DEM の谷底へ寄せる（回廊内の最小コスト経路）。
        手描き流路から ±SNAP_MAX_KM の「回廊」の中だけで、0.25km 平均標高ラスタ上の
          コスト = (標高 − 回廊内の最低標高 + 10m) + 8m/km × 手描き流路からの距離
        を最小にする源流→河口の経路（8 近傍・幾何距離つき）を求める。
        谷底は標高が低いので経路は谷筋をたどり、回廊の外（別の流域）へは出ない。
        → 地形を削って川に合わせる代わりに、川を実際の谷へ合わせる。"""
        from skimage.graph import route_through_array
        ox, oz = self.X0 - 1.5, self.Z0 - 1.5   # f025 の画素の縁の原点
        R = SNAP_MAX_KM + 1.0
        c0 = int(np.floor((P[:, 0].min() - R - ox) / 0.25))
        c1 = int(np.ceil((P[:, 0].max() + R - ox) / 0.25))
        r0 = int(np.floor((P[:, 1].min() - R - oz) / 0.25))
        r1 = int(np.ceil((P[:, 1].max() + R - oz) / 0.25))
        c0, r0 = max(c0, 0), max(r0, 0)
        c1, r1 = min(c1, self.f025.shape[1]), min(r1, self.f025.shape[0])
        H = self.f025[r0:r1, c0:c1].astype(np.float64)
        # 手描き流路からの距離（km）
        line = np.zeros(H.shape, bool)
        Pd = catmull_rom(P, 0.1) if len(P) > 2 else P
        lc = np.clip(((Pd[:, 0] - ox) / 0.25 - c0).astype(int), 0, H.shape[1] - 1)
        lr = np.clip(((Pd[:, 1] - oz) / 0.25 - r0).astype(int), 0, H.shape[0] - 1)
        line[lr, lc] = True
        dist = ndimage.distance_transform_edt(~line) * 0.25
        corr = dist <= SNAP_MAX_KM
        hmin = H[corr].min()
        cost = (H - hmin + 10.0) + 8.0 * dist
        cost[~corr] = 1e7
        start = (lr[0], lc[0])
        end = (lr[-1], lc[-1])
        path, _ = route_through_array(cost, start, end, fully_connected=True, geometric=True)
        path = np.array(path, float)
        Q = np.stack([ox + (path[:, 1] + c0 + 0.5) * 0.25, oz + (path[:, 0] + r0 + 0.5) * 0.25], 1)
        # 階段状の経路をなめらかに（端点は固定）
        Qs = Q.copy()
        Qs[:, 0] = ndimage.gaussian_filter1d(Q[:, 0], 2.5, mode="nearest")
        Qs[:, 1] = ndimage.gaussian_filter1d(Q[:, 1], 2.5, mode="nearest")
        Qs[0], Qs[-1] = P[0], P[-1]
        # 0.25km 間隔に再標本化
        sq = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(Qs, axis=0).T))])
        n = max(4, int(np.ceil(sq[-1] / 0.25)) + 1)
        u = np.linspace(0, sq[-1], n)
        Pn = np.stack([np.interp(u, sq, Qs[:, 0]), np.interp(u, sq, Qs[:, 1])], 1)
        from scipy.spatial import cKDTree as _T
        shift, _ = _T(Pd).query(Pn)
        return Pn, shift

    def _carve_along(self, Hm, P, p, hw, s_src=None):
        tree = cKDTree(P)
        reach_max = hw.max() + CELL_REACH + 8.0
        bx0, bz0 = P.min(0) - reach_max
        bx1, bz1 = P.max(0) + reach_max
        sl, X, Z = self._window(Hm, bx0, bz0, bx1, bz1, self.step, self.X0, self.Z0, 1)
        q = np.stack([X.ravel(), Z.ravel()], 1)
        d, k = tree.query(q, distance_upper_bound=reach_max)
        ok = np.isfinite(d)
        h = Hm[sl].astype(np.float32).ravel()
        lakem = self.lake_mask[sl].ravel()[ok] if hasattr(self, "lake_mask") else np.zeros(ok.sum(), bool)
        kk = k[ok]
        dd = d[ok]
        # 最寄りの細分点だけで決めると急流部で水面（隣の点との間を補間）より地形が高くなるので、
        # 前後 ±1km の水面の最小値を基準にする
        p_loc = ndimage.minimum_filter1d(p, size=9, mode="nearest")
        bed = p_loc[kk] - RIVER_EPS
        hv = h[ok]
        if self.dem is not None:
            # v4（実 DEM）: 谷の両側を戻す幅を 2〜7km → 0.4〜1km に（谷壁は実 DEM のまま残す）、掘る範囲を 1.45km → 0.55km に縮める
            #   （近くの実在の山頂＝三ツ峠山・大台ヶ原などを川の加工で削らない）
            core = hw[kk] + RIVER_CORE_DEM
            R = np.clip(0.4 + np.abs(hv - bed) / 1500.0, 0.4, 1.0)
        else:
            core = hw[kk] + CELL_REACH
            R = np.clip(2.0 + np.abs(hv - bed) / 150.0, 2.0, 7.0)
        s = smoothstep((dd - core) / R)
        target = np.where(dd <= core, bed, bed + (hv - bed) * s)
        if self.dem is not None and s_src is not None:
            # 源流付近は浅く：源流からの距離 1km ごとに最大 40m ずつ深く掘れる（源流＝山頂を削らない）
            target = np.maximum(target, hv - (40.0 + 40.0 * s_src[kk]))
        target = np.maximum(target, 1.0)  # 陸の川沿いを海面下にしない
        # 高い所は削り（谷）、水面の下限で川が周囲より高くなる低地だけ少し盛る（自然堤防程度：最大 +25m。
        # 海・湖の平坦部は埋めない）
        fill = np.minimum(np.maximum(hv, target), hv + 25.0)
        h[ok] = np.where(hv >= bed, np.minimum(hv, target), np.where((hv > 0) & ~lakem, fill, hv))
        Hm[sl] = np.round(h.reshape(X.shape)).astype(Hm.dtype)

    # ------------------------------------------------------------------
    def export(self, path, verts_exag=3.0, elevation_source="procedural"):
        labels = self.defs.get("labelOnly", [])
        out = {
            "version": 1,
            "_comment": "DHT EXPRESS STAGE 水域データ（tools/water.py が生成）。levelM / 河川 points[i][2] は水面標高 [m]（Y = m/1000*3）。v4: 湖面は Copernicus DEM GLO-90 の湖内画素の中央値、河川は DEM の谷筋へ寄せた流路と、地形（DEM 1km）から求めた単調な水面。points = [lat, lon, 水面標高m, 川幅km]。",
            "elevationSource": "Copernicus DEM GLO-90" if elevation_source == "dem" else "procedural",
            "license": "湖沼・河川（利根川以外）の形状: 本リポジトリで作成（CC0）。利根川の流路: Natural Earth（Public Domain）。湖面標高・谷筋補正: produced using Copernicus WorldDEM-90 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved",
            "lakes": self.lakes,
            "rivers": self.rivers,
            "labels": labels,
        }
        with open(path, "w", encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
        with open(os.path.join(os.path.dirname(os.path.abspath(path)), "..", "qa", "water_build_log.json"), "w", encoding="utf-8") as f:
            json.dump({"lakes": self.lake_log, "rivers": self.river_log}, f, ensure_ascii=False, indent=1)
        print("water.json", os.path.getsize(path), "bytes,", len(self.lakes), "lakes,", len(self.rivers), "rivers")
