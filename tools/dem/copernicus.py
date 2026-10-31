#!/usr/bin/env python3
"""
Copernicus DEM GLO-90（90m）タイルの取得と読み出し（オフライン専用）
=====================================================================

DEM 原データはリポジトリにも GitHub Pages にも置かない。開発機のキャッシュ
（既定 ../src_data/dem/cop90/）にだけ保存し、tools/build_terrain.py が
1km / 4km の地形グリッドへ縮約した結果（data/terrain/）だけを配信する。

データ
  名称     : Copernicus DEM GLO-90（Copernicus WorldDEM-90, DSM）
  配布元   : Copernicus（ESA / EU）。AWS Open Data: s3://copernicus-dem-90m/
             https://registry.opendata.aws/copernicus-dem/
  解像度   : 3 秒角（北緯 50° 未満は 1200×1200 / 1°タイル）≒ 南北 92m × 東西 75m（北緯 35°）
  鉛直基準 : EGM2008（m）
  ライセンス: Copernicus DEM licence（GLO-90 は無償・全世界・再配布/加工可。帰属表示が必要）
  帰属表示 : "produced using Copernicus WorldDEM-90 © DLR e.V. 2010-2014 and
              © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS
              by the European Union and ESA; all rights reserved"

使い方（単体）
  python3 tools/dem/copernicus.py --src ../src_data          # 必要タイルを取得
  python3 tools/dem/copernicus.py --src ../src_data --list   # 必要タイル一覧のみ
"""
import argparse
import json
import math
import os
import sys
import time
import urllib.error
import urllib.request
from collections import OrderedDict

import numpy as np

BUCKET_URL = "https://copernicus-dem-90m.s3.amazonaws.com"


def tile_name(lat, lon):
    ns = "N" if lat >= 0 else "S"
    ew = "E" if lon >= 0 else "W"
    return f"Copernicus_DSM_COG_30_{ns}{abs(lat):02d}_00_{ew}{abs(lon):03d}_00_DEM"


def tile_url(lat, lon):
    n = tile_name(lat, lon)
    return f"{BUCKET_URL}/{n}/{n}.tif"


def tile_path(cache, lat, lon):
    return os.path.join(cache, tile_name(lat, lon) + ".tif")


def needed_tiles(land_mask_fn):
    """land_mask_fn(lat0, lon0) -> bool：1°タイルが日本の陸地（ステージ範囲）に掛かるか"""
    out = []
    for lat in range(24, 39):
        for lon in range(122, 146):
            if land_mask_fn(lat, lon):
                out.append((lat, lon))
    return out


def fetch(tiles, cache, retries=3):
    os.makedirs(cache, exist_ok=True)
    got, missing, failed = 0, [], []
    for k, (lat, lon) in enumerate(tiles):
        p = tile_path(cache, lat, lon)
        if os.path.exists(p) and os.path.getsize(p) > 1000:
            got += 1
            continue
        if os.path.exists(p + ".missing"):
            missing.append((lat, lon))
            continue
        url = tile_url(lat, lon)
        for attempt in range(retries):
            try:
                with urllib.request.urlopen(url, timeout=120) as r:
                    data = r.read()
                with open(p + ".part", "wb") as f:
                    f.write(data)
                os.replace(p + ".part", p)
                got += 1
                print(f"  [{k + 1}/{len(tiles)}] {os.path.basename(p)} {len(data) / 1e6:.1f} MB", flush=True)
                break
            except urllib.error.HTTPError as e:
                if e.code in (403, 404):  # 海だけのタイルはバケットに存在しない
                    open(p + ".missing", "w").close()
                    missing.append((lat, lon))
                    print(f"  [{k + 1}/{len(tiles)}] {os.path.basename(p)} not in bucket (sea-only)")
                    break
                time.sleep(2 * (attempt + 1))
            except Exception as e:  # noqa
                if attempt == retries - 1:
                    failed.append((lat, lon, str(e)))
                    print("  FAILED", url, e)
                time.sleep(2 * (attempt + 1))
    return got, missing, failed


# ---------------------------------------------------------------------------
# 読み出し
# ---------------------------------------------------------------------------
def read_tile(path):
    """→ (array float32 [rows, cols], lat_top, lon_left, dlat, dlon)
    配列 [r, c] の画素中心 = (lat_top - (r + 0.5) * dlat, lon_left + (c + 0.5) * dlon)"""
    import tifffile

    with tifffile.TiffFile(path) as tf:
        page = tf.pages[0]
        a = page.asarray().astype(np.float32)
        tags = page.tags
        scale = tags["ModelPixelScaleTag"].value
        tie = tags["ModelTiepointTag"].value
        geokeys = tf.geotiff_metadata or {}
    dlon, dlat = float(scale[0]), float(scale[1])
    # tiepoint: (I, J, K, X, Y, Z)
    I, J, X, Y = tie[0], tie[1], tie[3], tie[4]
    lon_left = X - I * dlon
    lat_top = Y + J * dlat
    # RasterPixelIsPoint(2) の場合、タイポイントは画素中心
    if geokeys.get("GTRasterTypeGeoKey") in (2, "RasterPixelIsPoint") or str(geokeys.get("GTRasterTypeGeoKey", "")).endswith("Point"):
        lon_left -= dlon / 2
        lat_top += dlat / 2
    nod = tags.get("GDAL_NODATA")
    if nod is not None:
        try:
            v = float(str(nod.value).strip("\x00 "))
            a[a == v] = np.nan
        except ValueError:
            pass
    a[a < -1000] = np.nan
    return a, lat_top, lon_left, dlat, dlon


class DemMosaic:
    """1°タイル群を必要な範囲だけ貼り合わせ、緯度経度で双線形サンプリングする。"""

    def __init__(self, cache, max_tiles=24):
        self.cache = cache
        self.lru = OrderedDict()
        self.max_tiles = max_tiles
        self.res = None  # (dlat, dlon)

    def tile(self, lat, lon):
        key = (lat, lon)
        if key in self.lru:
            self.lru.move_to_end(key)
            return self.lru[key]
        p = tile_path(self.cache, lat, lon)
        t = read_tile(p) if os.path.exists(p) else None
        if t is not None and self.res is None:
            self.res = (t[3], t[4])
        self.lru[key] = t
        while len(self.lru) > self.max_tiles:
            self.lru.popitem(last=False)
        return t

    def window(self, lat0, lat1, lon0, lon1, pad_px=4):
        """緯度経度範囲を覆う貼り合わせ配列。→ (A, lat_top, lon_left, dlat, dlon)。
        タイルが無い所（海だけのタイル）は NaN。"""
        if self.res is None:
            # 解像度を知るため最初の存在タイルを読む
            for la in range(int(math.floor(lat0)), int(math.floor(lat1)) + 1):
                for lo in range(int(math.floor(lon0)), int(math.floor(lon1)) + 1):
                    self.tile(la, lo)
            if self.res is None:
                self.res = (1 / 1200, 1 / 1200)
        dlat, dlon = self.res
        # Copernicus は画素中心が k*dlat（PixelIsPoint）なので、画素の縁は (k ± 0.5)*dlat
        top = (math.ceil(lat1 / dlat) + pad_px + 0.5) * dlat
        left = (math.floor(lon0 / dlon) - pad_px - 0.5) * dlon
        rows = int(round((top - (lat0 - pad_px * dlat)) / dlat))
        cols = int(round(((lon1 + pad_px * dlon) - left) / dlon))
        A = np.full((rows, cols), np.nan, np.float32)
        for la in range(int(math.floor(lat0 - pad_px * dlat)), int(math.floor(lat1 + pad_px * dlat)) + 1):
            for lo in range(int(math.floor(lon0 - pad_px * dlon)), int(math.floor(lon1 + pad_px * dlon)) + 1):
                t = self.tile(la, lo)
                if t is None:
                    continue
                a, ttop, tleft, tdlat, tdlon = t
                if abs(tdlon - dlon) > 1e-9:
                    # 経度方向の解像度が違うタイル（北緯 50° 以上）は本ステージでは使わない
                    continue
                r0 = int(round((top - ttop) / dlat))
                c0 = int(round((tleft - left) / dlon))
                rs0, cs0 = max(0, -r0), max(0, -c0)
                rd0, cd0 = max(0, r0), max(0, c0)
                rn = min(a.shape[0] - rs0, rows - rd0)
                cn = min(a.shape[1] - cs0, cols - cd0)
                if rn > 0 and cn > 0:
                    A[rd0:rd0 + rn, cd0:cd0 + cn] = a[rs0:rs0 + rn, cs0:cs0 + cn]
        return A, top, left, dlat, dlon


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default="../src_data")
    ap.add_argument("--cache", default=None)
    ap.add_argument("--list", action="store_true")
    a = ap.parse_args()
    here = os.path.dirname(os.path.abspath(__file__))
    sys.path.insert(0, os.path.dirname(here))
    from build_terrain import japan_tile_mask  # noqa

    cache = a.cache or os.path.join(a.src, "dem", "cop90")
    tiles = needed_tiles(japan_tile_mask(a.src))
    print(len(tiles), "tiles")
    if a.list:
        for t in tiles:
            print(tile_url(*t))
        return
    got, missing, failed = fetch(tiles, cache)
    print(f"ok {got}  sea-only {len(missing)}  failed {len(failed)}")
    json.dump({"tiles": tiles, "missing": missing, "failed": failed}, open(os.path.join(cache, "index.json"), "w"))
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
