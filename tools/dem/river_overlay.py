#!/usr/bin/env python3
"""河川流路の確認図：DEM の陰影図に手描き流路（赤）と谷筋補正後（青）を重ねる（QA 用、配信しない）
  python3 tools/dem/river_overlay.py --src ../src_data --water data/water.json --out qa/rivers_overlay.png
"""
import argparse
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from build_terrain import ll2w, X0, Z0  # noqa


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default="../src_data")
    ap.add_argument("--water", default="data/water.json")
    ap.add_argument("--defs", default=os.path.join(os.path.dirname(HERE), "water_defs.json"))
    ap.add_argument("--out", default="qa/rivers_overlay.png")
    a = ap.parse_args()
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    plt.rcParams["font.family"] = ["Noto Sans CJK JP", "DejaVu Sans"]
    f025 = np.load(os.path.join(a.src, "dem", "cop90", "_grids_cache.npz"))["f025"]
    f025 = np.nan_to_num(f025)
    ox, oz = X0 - 1.5, Z0 - 1.5
    gy, gx = np.gradient(f025, 250.0)
    shade = np.clip(0.6 + 0.9 * (-gx * 0.7 - gy * 0.7) / np.sqrt(1 + gx ** 2 + gy ** 2), 0, 1)
    W = json.load(open(a.water, encoding="utf-8"))
    D = {r["id"]: r for r in json.load(open(a.defs, encoding="utf-8"))["rivers"]}
    rivers = W["rivers"]
    n = len(rivers)
    cols = 6
    rows = int(np.ceil(n / cols))
    fig, axs = plt.subplots(rows, cols, figsize=(cols * 3.4, rows * 3.4))
    for ax, rv in zip(axs.ravel(), rivers):
        pts = np.array([[p[0], p[1]] for p in rv["points"]])
        x, z = ll2w(pts[:, 0], pts[:, 1])
        line = D[rv["id"]]["line"]
        if line:
            o = np.array(line)
            x0, z0 = ll2w(o[:, 0], o[:, 1])
        else:
            x0, z0 = x, z
        pad = 8
        bx0, bx1 = min(x.min(), x0.min()) - pad, max(x.max(), x0.max()) + pad
        bz0, bz1 = min(z.min(), z0.min()) - pad, max(z.max(), z0.max()) + pad
        c0, c1 = int((bx0 - ox) / 0.25), int((bx1 - ox) / 0.25)
        r0, r1 = int((bz0 - oz) / 0.25), int((bz1 - oz) / 0.25)
        H = f025[r0:r1, c0:c1]
        S = shade[r0:r1, c0:c1]
        img = plt.cm.terrain(np.clip(H / 2500 * 0.75 + 0.25, 0, 1))[..., :3] * (0.45 + 0.55 * S[..., None])
        img[H <= 0.5] = (0.55, 0.7, 0.85)
        ax.imshow(img, extent=(bx0, bx1, bz1, bz0))
        if line:
            ax.plot(x0, z0, color="#e0262b", lw=1.0, label="手描き(v3)")
        ax.plot(x, z, color="#0b3cff", lw=1.3, label="谷筋補正(v4)")
        ax.set_title(f"{rv['name']}  ずれ最大 {rv.get('valleySnap', {}).get('maxShiftKm', 0)}km", fontsize=9)
        ax.set_xticks([])
        ax.set_yticks([])
    for ax in axs.ravel()[n:]:
        ax.axis("off")
    axs.ravel()[0].legend(fontsize=7, loc="lower left")
    fig.tight_layout()
    fig.savefig(a.out, dpi=80)


if __name__ == "__main__":
    main()
