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
RIVER_MIN_LEVEL = 7.0 # m  河川水面の下限（河口）
RIVER_LAND_LEVEL = 25.0 # m 河口付近以外の河川水面の下限（河床 19m 以上＝地形色が「砂浜」にならない）
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


# ---------------------------------------------------------------------------
class WaterBuilder:
    def __init__(self, defs_path, src_dir, ll2w, w2ll, X0, Z0, step=1.0):
        self.defs = json.load(open(defs_path, encoding="utf-8"))
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
        for lk in self.defs["lakes"]:
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
            core = d <= CELL_REACH
            inner = ins | (d <= 0.6)
            sea_frac = float((h0[inner] <= 0).mean()) if inner.any() else 0
            sea = sea_frac > 0.5
            if sea:
                L = 2.0
                bed = -3.0
            else:
                L = float(max(LAKE_MIN_LEVEL, np.percentile(h0[core], 20)))
                bed = L - LAKE_EPS
            # 湖の周囲：切土・盛土で水面直下の平坦面にならし、外側は高低差に応じた幅で元地形へ戻す
            R = np.clip(2.0 + np.abs(hc - bed) / 150.0, 2.0, 8.0)
            t = (d - CELL_REACH) / R
            s = smoothstep(t)
            target = bed + (hc - bed) * s
            new = np.where(core, bed, target)
            if sea:
                new = np.where(core, np.minimum(hc, bed), np.minimum(hc, target))
            # 先に処理した湖（富士五湖・霞ヶ浦と北浦など隣り合う湖）の湖底は高くしない
            new = np.where(prev, np.minimum(hc, new), new)
            Hm[sl] = np.round(new).astype(Hm.dtype)
            self.lake_mask[sl] |= core
            area = self._area(rings)
            c = self.w2ll(*ext.mean(0))
            self.lakes.append({
                "id": lk["id"], "name": lk["name"], "nameEn": lk.get("nameEn"), "type": "lake",
                "rank": lk.get("rank", 2), **({"group": lk["group"]} if lk.get("group") else {}),
                "levelM": round(L, 1), "seaLevel": sea, "areaKm2": round(area, 1),
                "center": [round(float(c[0]), 4), round(float(c[1]), 4)],
                "rings": [[[round(p[0], 4), round(p[1], 4)] for p in r] for r in lk["rings"]],
            })
            print(f"  lake {lk['name']:<6} level {L:7.1f} m  area {area:6.1f} km2  sea={sea}  cut/fill max {np.abs(new - h0)[core].max():6.0f} m")
        return Hm

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
            reach = cstep * 1.42
            core = d <= reach
            bed = -3.0 if lk["seaLevel"] else lk["levelM"] - LAKE_EPS
            s = smoothstep((d - reach) / 6.0)
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
            p = np.minimum.accumulate(p)                      # 単調に下る
            # 平滑化（窓 2km）→ 再び単調化
            k = 9
            pp = np.convolve(np.pad(p, (k, k), mode="edge"), np.ones(2 * k + 1) / (2 * k + 1), mode="same")[k:-k]
            p = np.minimum.accumulate(np.minimum(pp, p + 0))
            s = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(P2, axis=0).T))])
            # 水面の下限：陸上では 25m（低地を掘り下げ過ぎて海岸の砂色の帯にしない）、海に出る川は河口 4km で 7m へ
            ends_at_sea = b + 1 < len(P) and hc[b + 1] <= 1.0 and not inlake[b + 1] and lat[b + 1] <= NORTH_CLIP
            floor = np.full(n, RIVER_LAND_LEVEL)
            if ends_at_sea:
                floor = RIVER_MIN_LEVEL + (RIVER_LAND_LEVEL - RIVER_MIN_LEVEL) * np.clip((s[-1] - s) / MOUTH_RAMP_KM, 0, 1)
            p = np.maximum(p, floor)  # 下限も下流へ単調に下がるので、p は単調のまま
            # 全長に対する位置（北限で切れた川も本来の全長基準で幅を決める）
            s_full = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(P, axis=0).T))])
            u = (s_full[a:b + 1]) / s_full[-1]
            width = 0.15 + (rv["width"] - 0.15) * np.power(u, 0.7)
            hw = width / 2
            depth = hc[seg] - p
            self._carve_along(Hm, P2, p, hw)
            pts = np.column_stack([P2, p, width])
            simp = simplify(pts, 0.05, 1.5)
            la, lo = self.w2ll(simp[:, 0], simp[:, 1])
            self.rivers.append({
                "id": rv["id"], "name": rv["name"], "nameEn": rv.get("nameEn"), "type": "river",
                "widthKm": rv["width"], "lengthKm": round(float(s[-1]), 1),
                "source": "Natural Earth" if rv.get("source") == "naturalearth" else "hand-digitized",
                "points": [[round(float(la[i]), 5), round(float(lo[i]), 5), round(float(simp[i, 2]), 1), round(float(simp[i, 3]), 3)] for i in range(len(simp))],
            })
            print(f"  river {rv['name']:<5} {s[-1]:6.1f} km  pts {len(simp):4d}  surf {p[0]:6.0f}→{p[-1]:4.0f} m  cut max {depth.max():5.0f} m  mean {depth.mean():4.0f} m")
        return Hm

    def _carve_along(self, Hm, P, p, hw):
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
        core = hw[kk] + CELL_REACH
        hv = h[ok]
        R = np.clip(2.0 + np.abs(hv - bed) / 150.0, 2.0, 7.0)
        s = smoothstep((dd - core) / R)
        target = np.where(dd <= core, bed, bed + (hv - bed) * s)
        target = np.maximum(target, 1.0)  # 陸の川沿いを海面下にしない
        # 高い所は削り（谷）、水面の下限で川が周囲より高くなる低地だけ少し盛る（自然堤防程度：最大 +25m。
        # 海・湖の平坦部は埋めない）
        fill = np.minimum(np.maximum(hv, target), hv + 25.0)
        h[ok] = np.where(hv >= bed, np.minimum(hv, target), np.where((hv > 0) & ~lakem, fill, hv))
        Hm[sl] = np.round(h.reshape(X.shape)).astype(Hm.dtype)

    # ------------------------------------------------------------------
    def export(self, path, verts_exag=3.0):
        labels = self.defs.get("labelOnly", [])
        out = {
            "version": 1,
            "_comment": "DHT EXPRESS STAGE 水域データ（tools/water.py が生成）。levelM / 河川 points[i][2] は地形（手続き生成）に合わせた水面標高 [m]（Y = m/1000*3）。points = [lat, lon, 水面標高m, 川幅km]。",
            "license": "湖沼・河川（利根川以外）の形状: 本リポジトリで作成（CC0）。利根川の流路: Natural Earth（Public Domain）。",
            "lakes": self.lakes,
            "rivers": self.rivers,
            "labels": labels,
        }
        with open(path, "w", encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
        print("water.json", os.path.getsize(path), "bytes,", len(self.lakes), "lakes,", len(self.rivers), "rivers")
