#!/usr/bin/env python3
"""
DEM（緯度経度 3 秒角）→ ステージのワールド格子（正弦図法・1km 頂点）への縮約
=========================================================================

流れ（64km チャンクごとに処理。メモリは常に数十 MB）
  1. チャンク範囲（＋縁）を覆う DEM を貼り合わせる（DemMosaic.window）
  2. 3×3 画素（約 270m × 225m）のグレースケール・オープニング
     → DSM に含まれる超高層ビル・鉄塔などの「細い突起」だけを取り除く
       （幅 300m 以上の尾根・山頂はほぼそのまま残る）
  3. ワールド座標 0.125km 間隔の細格子へ双線形で再標本化
  4. 1km 頂点ごとに「頂点を中心とする 1km 四方」の 8×8 = 64 サンプルの統計
       mean / median / p75 / p90 / max / valid（DEM がある割合）
  5. 0.25km 間隔の平均標高ラスタ（全域）… 河川の谷筋探索・湖面標高の確認用（配信しない）

縮約方法の選択（tools/dem/compare_methods.py で比較）
  単純平均は細い尾根（御坂山地・三浦丘陵など）を数百 m 単位で削る。最大値は尖りすぎ、
  DSM のビルも拾う。採用した「尾根保存ブレンド」は
      h = mean + RIDGE_W * (p90 − mean)
  （p90 は 1km 四方で上位 10% の高さ。オープニング後なのでビルの影響は受けにくい）
"""
import math

import numpy as np
from scipy import ndimage

FINE = 0.125            # km  細格子
SUB = int(round(1.0 / FINE))  # 1km 頂点あたりの細格子数（8）
OPEN_PX = 3             # オープニングの窓（DEM 画素）
RIDGE_W = 0.5           # 尾根保存ブレンドの重み（0 = 平均, 1 = p90）

STATS = ("mean", "median", "p75", "p90", "max", "valid")


def _sample_bilinear(A, rows, cols):
    """A の (rows, cols)（実数インデックス）を双線形補間。NaN を含む所は NaN。"""
    valid = np.isfinite(A)
    A0 = np.where(valid, A, 0.0).astype(np.float32)
    v = ndimage.map_coordinates(A0, [rows, cols], order=1, mode="nearest")
    w = ndimage.map_coordinates(valid.astype(np.float32), [rows, cols], order=1, mode="nearest")
    out = np.where(w > 0.5, v / np.maximum(w, 1e-6), np.nan)
    return out.astype(np.float32)


def resample_block(mosaic, w2ll, x_first, z_first, nxv, nzv, opening=True):
    """頂点 (x_first + i, z_first + j)（i<nxv, j<nzv）の 1km 足場統計を返す。
    → dict(stat -> (nzv, nxv) float32), fine025 (nzv*4, nxv*4) 平均ラスタ"""
    nfx, nfz = nxv * SUB, nzv * SUB
    fx = x_first - 0.5 + (np.arange(nfx) + 0.5) * FINE
    fz = z_first - 0.5 + (np.arange(nfz) + 0.5) * FINE
    FX, FZ = np.meshgrid(fx, fz)
    LAT, LON = w2ll(FX, FZ)
    lat0, lat1 = float(LAT.min()), float(LAT.max())
    lon0, lon1 = float(LON.min()), float(LON.max())
    A, top, left, dlat, dlon = mosaic.window(lat0, lat1, lon0, lon1, pad_px=6)
    if opening:
        miss = ~np.isfinite(A)
        A2 = np.where(miss, 0.0, A)
        A2 = ndimage.grey_opening(A2, size=(OPEN_PX, OPEN_PX))
        A = np.where(miss, np.nan, A2).astype(np.float32)
    rows = (top - LAT) / dlat - 0.5
    cols = (LON - left) / dlon - 0.5
    F = _sample_bilinear(A, rows, cols)

    blk = F.reshape(nzv, SUB, nxv, SUB).transpose(0, 2, 1, 3).reshape(nzv, nxv, SUB * SUB)
    valid = np.isfinite(blk).mean(-1).astype(np.float32)
    with np.errstate(all="ignore"):
        import warnings
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)
            mean = np.nanmean(blk, -1)
            q = np.nanpercentile(blk, [50, 75, 90], axis=-1)
            mx = np.nanmax(blk, -1)
    out = {"mean": mean, "median": q[0], "p75": q[1], "p90": q[2], "max": mx, "valid": valid}
    out = {k: v.astype(np.float32) for k, v in out.items()}
    r = SUB // 4  # 0.25km ブロック
    b4 = F.reshape(nzv * 4, r, nxv * 4, r)
    with np.errstate(all="ignore"):
        import warnings
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)
            f025 = np.nanmean(b4, axis=(1, 3)).astype(np.float32)
    return out, f025


def build_dem_grids(mosaic, w2ll, X0, Z0, NXb, NZb, CHUNK, chunk_has_land, log=print):
    """縁付き頂点配列（Hm と同じ形 (NZb, NXb)、Hm[J][I] ↔ x = X0 + (I-1)）の DEM 統計を作る。
    chunk_has_land(cx, cz) が False のチャンクは計算しない（NaN = DEM なし）。"""
    grids = {k: np.full((NZb, NXb), np.nan, np.float32) for k in STATS}
    grids["valid"][:] = 0
    f025 = np.full((NZb * 4, NXb * 4), np.nan, np.float32)
    ncx = int(math.ceil((NXb - 3) / CHUNK))
    ncz = int(math.ceil((NZb - 3) / CHUNK))
    done = 0
    for cz in range(ncz):
        for cx in range(ncx):
            a = cx * CHUNK
            b = NXb if cx == ncx - 1 else (cx + 1) * CHUNK
            c = cz * CHUNK
            d = NZb if cz == ncz - 1 else (cz + 1) * CHUNK
            if not chunk_has_land(cx, cz):
                continue
            st, ff = resample_block(mosaic, w2ll, X0 + (a - 1), Z0 + (c - 1), b - a, d - c)
            for k in STATS:
                grids[k][c:d, a:b] = st[k]
            f025[c * 4:d * 4, a * 4:b * 4] = ff
            done += 1
            if done % 25 == 0:
                log(f"  dem chunks {done}")
    log(f"  dem chunks {done} (done)")
    return grids, f025


def ridge_blend(g, w=RIDGE_W):
    return g["mean"] + w * (g["p90"] - g["mean"])
