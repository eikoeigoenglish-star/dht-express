#!/usr/bin/env python3
"""
DEM 縮約方法の比較（mean / median / p75 / p90 / max / ridge = mean+0.5(p90-mean)）
build_terrain.py を一度実行して ../src_data/dem/cop90/_grids_cache.npz ができてから使う。

  python3 tools/dem/compare_methods.py --src ../src_data [--out qa/dem_methods.md] [--png qa/dem_profiles.png]

指標
  ・断面（甲府→河口湖、房総南部、三浦、六甲、鈴鹿、丹沢）ごとに
      尾根の高さ（断面の最大値）… 90m 原データとの差
      盆地・谷の低さ（断面の最小値）… 原データとの差（盆地を埋めていないか）
  ・陸地全体の平均バイアス（各方法 − 1km 平均）… 山の「体積」をどれだけ水増ししているか
"""
import argparse
import os
import sys

import numpy as np
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))
from copernicus import DemMosaic  # noqa
from build_terrain import ll2w, X0, Z0  # noqa

TRANSECTS = [
    ("甲府盆地→御坂山地→河口湖", (35.665, 138.555), (35.505, 138.760)),
    ("房総半島南部（南北）", (35.26, 140.00), (34.93, 139.93)),
    ("三浦半島（南北）", (35.35, 139.62), (35.14, 139.66)),
    ("六甲山地（南北）", (34.84, 135.24), (34.69, 135.24)),
    ("鈴鹿山脈（東西）", (35.02, 136.25), (35.02, 136.62)),
    ("丹沢山地（南北）", (35.56, 139.16), (35.38, 139.19)),
    ("箱根（東西）", (35.23, 138.95), (35.23, 139.15)),
]
METHODS = ["mean", "median", "p75", "p90", "max", "ridge"]


def raw_profile(mos, a, b, n):
    lats = np.linspace(a[0], b[0], n)
    lons = np.linspace(a[1], b[1], n)
    A, top, left, dlat, dlon = mos.window(lats.min(), lats.max(), lons.min(), lons.max(), pad_px=4)
    r = (top - lats) / dlat - 0.5
    c = (lons - left) / dlon - 0.5
    return ndimage.map_coordinates(np.nan_to_num(A), [r, c], order=1), lats, lons


def grid_profile(G, lats, lons):
    x, z = ll2w(lats, lons)
    return ndimage.map_coordinates(G, [z - Z0 + 1, x - X0 + 1], order=1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default="../src_data")
    ap.add_argument("--out", default=None)
    ap.add_argument("--png", default=None)
    a = ap.parse_args()
    cache = os.path.join(a.src, "dem", "cop90")
    z = np.load(os.path.join(cache, "_grids_cache.npz"))
    G = {k: z[k] for k in ("mean", "median", "p75", "p90", "max")}
    G["ridge"] = G["mean"] + 0.5 * (G["p90"] - G["mean"])
    for k in G:
        G[k] = np.nan_to_num(G[k])
    mos = DemMosaic(cache)
    lines = ["| 断面 | 指標 | 90m原データ | " + " | ".join(METHODS) + " |", "|---|---|---|" + "---|" * len(METHODS)]
    profiles = []
    for name, p, q in TRANSECTS:
        raw, lats, lons = raw_profile(mos, p, q, 600)
        pr = {m: grid_profile(G[m], lats, lons) for m in METHODS}
        profiles.append((name, raw, pr))
        lines.append(f"| {name} | 最高点 m | {raw.max():.0f} | " + " | ".join(f"{pr[m].max():.0f} ({pr[m].max() - raw.max():+.0f})" for m in METHODS) + " |")
        lines.append(f"| | 最低点 m | {raw.min():.0f} | " + " | ".join(f"{pr[m].min():.0f} ({pr[m].min() - raw.min():+.0f})" for m in METHODS) + " |")
        lines.append(f"| | 断面平均 m | {raw.mean():.0f} | " + " | ".join(f"{pr[m].mean():.0f}" for m in METHODS) + " |")
    land = G["mean"] > 5
    lines.append("")
    lines.append("| 陸地全体（1km 頂点 %d 点） | " % land.sum() + " | ".join(METHODS) + " |")
    lines.append("|---|" + "---|" * len(METHODS))
    lines.append("| 1km 平均からの平均差 m | " + " | ".join(f"{(G[m][land] - G['mean'][land]).mean():+.1f}" for m in METHODS) + " |")
    mt = G["mean"] > 600
    lines.append("| 同・山地（平均 600m 超） m | " + " | ".join(f"{(G[m][mt] - G['mean'][mt]).mean():+.1f}" for m in METHODS) + " |")
    txt = "\n".join(lines)
    print(txt)
    if a.out:
        open(a.out, "w").write(txt + "\n")
    if a.png:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        plt.rcParams["font.family"] = ["Noto Sans CJK JP", "IPAexGothic", "DejaVu Sans"]
        fig, axs = plt.subplots(len(profiles), 1, figsize=(10, 2.6 * len(profiles)))
        for ax, (name, raw, pr) in zip(axs, profiles):
            s = np.linspace(0, 1, len(raw))
            ax.plot(s, raw, color="#999", lw=0.8, label="90m 原データ")
            for m, c in (("mean", "#1f77b4"), ("max", "#d62728"), ("ridge", "#2ca02c")):
                ax.plot(s, pr[m], color=c, lw=1.4, label=m)
            ax.set_title(name, fontsize=10)
            ax.set_ylabel("m")
            ax.legend(fontsize=7, loc="upper right")
        fig.tight_layout()
        fig.savefig(a.png, dpi=90)


if __name__ == "__main__":
    main()
