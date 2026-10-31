"""terrain_sample.py — data/terrain/ の配信データ（1km / 4km 格子）を Python から読むための小道具。

js/terrain.js と同じ規則で標高[m]を双線形補間する（QA・ルート検証用。公開には不要）。
"""
import json
import math
import os

import numpy as np

LON0 = 132.5
LAT0 = 31.0
EARTH_RADIUS_KM = 6371.0088
KM_PER_DEG = EARTH_RADIUS_KM * math.pi / 180
V_EXAG = 3.0


def latlon_to_world(lat, lon):
    return (lon - LON0) * KM_PER_DEG * math.cos(math.radians(lat)), -(lat - LAT0) * KM_PER_DEG


def world_to_latlon(x, z):
    lat = LAT0 - z / KM_PER_DEG
    return lat, LON0 + x / (KM_PER_DEG * math.cos(math.radians(lat)))


def haversine_km(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(min(1.0, math.sqrt(a)))


class Terrain:
    def __init__(self, terrain_dir):
        self.dir = terrain_dir
        m = json.load(open(os.path.join(terrain_dir, "manifest.json")))
        g = m["grid"]
        self.x0, self.z0, self.chunk = g["x0"], g["z0"], g["chunkKm"]
        c = m["coarse"]
        self.cnx, self.cnz, self.cstep = c["nx"], c["nz"], c["stepKm"]
        self.coarse = np.fromfile(os.path.join(terrain_dir, c["file"]), dtype="<i2").reshape(self.cnz, self.cnx)
        self.S = m["hi"]["samples"]
        self.hstep = m["hi"]["stepKm"]
        self.hiset = {(a, b) for a, b, *_ in m["hi"]["chunks"]}
        self.cache = {}

    def _hi(self, cx, cz):
        k = (cx, cz)
        if k not in self.cache:
            p = os.path.join(self.dir, "hi", f"h_{cx}_{cz}.bin")
            self.cache[k] = np.fromfile(p, dtype="<i2").reshape(self.S, self.S) if k in self.hiset and os.path.exists(p) else None
        return self.cache[k]

    def coarse_m(self, x, z):
        fx = (x - self.x0) / self.cstep
        fz = (z - self.z0) / self.cstep
        i, j = math.floor(fx), math.floor(fz)
        tx, tz = fx - i, fz - j

        def at(a, b):
            a = min(max(a, 0), self.cnx - 1)
            b = min(max(b, 0), self.cnz - 1)
            return float(self.coarse[b, a])

        return (at(i, j) * (1 - tx) + at(i + 1, j) * tx) * (1 - tz) + (at(i, j + 1) * (1 - tx) + at(i + 1, j + 1) * tx) * tz

    def height_m(self, x, z):
        """読み込み可能な最良データ（詳細 1km があればそれ）での標高[m]。JS の getHeightMeters と同じ"""
        lx, lz = x - self.x0, z - self.z0
        cx, cz = math.floor(lx / self.chunk), math.floor(lz / self.chunk)
        hd = self._hi(cx, cz)
        if hd is None:
            return self.coarse_m(x, z)
        S = self.S
        fx = (lx - cx * self.chunk) / self.hstep + 1
        fz = (lz - cz * self.chunk) / self.hstep + 1
        i = min(S - 2, math.floor(fx))
        j = min(S - 2, math.floor(fz))
        tx, tz = fx - i, fz - j
        a, b, c, d = float(hd[j, i]), float(hd[j, i + 1]), float(hd[j + 1, i]), float(hd[j + 1, i + 1])
        return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz

    def height_ll(self, lat, lon):
        return self.height_m(*latlon_to_world(lat, lon))
