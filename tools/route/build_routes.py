#!/usr/bin/env python3
"""build_routes.py — DHT EXPRESS のルートデータ（data/routes/*.json）を事前生成する（v5）

公開には不要（生成済みの JSON をリポジトリに同梱済み）。開発時に 1 回だけ実行する。

  1) 新幹線（東京 → 新大阪 → 博多 → 鹿児島中央）
     国土数値情報「鉄道データ（N02）」の RailroadSection（東海道・山陽・九州新幹線）を
     路線ごとに最短経路で 1 本につなぎ（車両基地への引込線などの分岐を除外）、
     Douglas-Peucker で間引いて緯度経度の折れ線にする。
     駅は折れ線へ射影し、「幾何 km（折れ線上の実測長）」と「論理 km（実キロ）」の対応点（アンカー）にする。

  2) 鹿児島中央 → 鹿児島新港（接続区間・鉄道ではない）
     道路沿いの概略制御点（手作業）を滑らかにつないだ地上連絡ルート。

  3) 鹿児島新港 → 名瀬 → 亀徳 → 和泊 → 与論 → 本部 → 那覇（マルエーフェリー鹿児島航路に準じた海上ルート）
     島・海岸線を避ける制御点（手作業）を Catmull-Rom 曲線でつなぐ。論理 km は公式航路距離。
     data/terrain の海陸判定で「港の近傍以外で陸地を通らない」ことを検証する。

使い方:
  # N02 の RailroadSection を JSON 化したもの（https://github.com/antfu/mlit-json の data/sections.json）
  python3 tools/route/build_routes.py --sections ../src_data/mlit-json/sections.json \
      [--n02-stations ../src_data/mlit-json/stations.json]
"""
import argparse
import heapq
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
from terrain_sample import Terrain, haversine_km, latlon_to_world, world_to_latlon  # noqa: E402

# --------------------------------------------------------------------------
# 距離の定義（README §14.4）
# --------------------------------------------------------------------------
# 採用：実キロ（線路の実際の長さ）。各路線の総延長と、公表値が確認できた駅はその値をアンカーにする。
LINES = [
    # id, N02 路線名, 起点駅, 終点駅, 実キロ（路線総延長）, 営業キロ（参考）
    ("tokaido", "東海道新幹線", "tokyo", "shin-osaka", 515.4, 552.6),
    ("sanyo", "山陽新幹線", "shin-osaka", "hakata", 553.7, 644.0),
    ("kyushu", "九州新幹線", "hakata", "kagoshima-chuo", 256.8, 288.9),
]
# 路線起点からの実キロの公表値（README §14.4 の出典）。ここに無い駅は N02 幾何長を前後のアンカーで較正して求める。
PUBLISHED_JITSU_KM = {
    "tokaido": {"tokyo": 0.0, "shin-osaka": 515.4},
    "sanyo": {
        "shin-osaka": 0.0, "shin-kobe": 32.6, "nishi-akashi": 54.8, "himeji": 85.9, "aioi": 105.9,
        "okayama": 160.9, "shin-kurashiki": 186.7, "fukuyama": 217.7, "shin-onomichi": 235.1,
        "mihara": 245.6, "higashi-hiroshima": 276.5, "hakata": 553.7,
    },
    "kyushu": {
        "hakata": 0.0, "shin-tosu": 26.3, "kurume": 32.0, "chikugo-funagoya": 47.9, "shin-omuta": 59.7,
        "shin-tamana": 76.3, "kumamoto": 98.2, "shin-yatsushiro": 130.0, "shin-minamata": 172.8,
        "izumi": 188.8, "sendai": 221.5, "kagoshima-chuo": 256.8,
    },
}
# 営業キロ（参考値。ゲームの進行には使わない）
EIGYO_KM_NOTE = {"tokaido": 552.6, "sanyo": 644.0, "kyushu": 288.9}

# stations.json の座標を N02 の駅位置に合わせ直す駅（v2 で「地図上の位置から作成」した新幹線単独駅のうち、
# ルート線から 0.3km 以上ずれていたもの）
FIX_STATIONS_FROM_N02 = {"shin-onomichi": "新尾道", "higashi-hiroshima": "東広島", "shin-omuta": "新大牟田",
                         "shin-tamana": "新玉名", "shin-iwakuni": "新岩国"}

# --------------------------------------------------------------------------
# フェリー（マルエーフェリー 鹿児島航路）
# --------------------------------------------------------------------------
# 公式航路距離（鹿児島新港からの累積 km）
PORTS = [
    # id, 名前, 島・地域, lat, lon, 鹿児島新港からの km
    ("kagoshima-shinko", "鹿児島新港", "鹿児島", 31.5848, 130.5665, 0),
    ("naze", "名瀬", "奄美大島", 28.3858, 129.5003, 383),
    ("kametoku", "亀徳", "徳之島", 27.7262, 129.0185, 492),
    ("wadomari", "和泊", "沖永良部島", 27.3925, 128.6625, 546),
    ("yoron", "与論", "与論島", 27.0395, 128.4085, 594),
    ("motobu", "本部", "沖縄本島", 26.6555, 127.8800, 679),
    ("naha", "那覇", "沖縄本島", 26.2405, 127.6795, 735),
]
# 港と港の間の制御点（lat, lon）。島を横切らないよう、港へは海側から入り、海側へ出る。
FERRY_LEGS = [
    # 鹿児島新港 → 名瀬：錦江湾を南下 → 佐多岬沖 → 屋久島と口永良部島の間 → 吐噶喇列島の東側 → 奄美大島北西から名瀬湾へ
    [(31.578, 130.585), (31.50, 130.615), (31.38, 130.655), (31.25, 130.69), (31.17, 130.68),
     (31.08, 130.61), (30.93, 130.53), (30.79, 130.49), (30.62, 130.36), (30.40, 130.29), (30.12, 130.16), (29.70, 129.99),
     (29.25, 129.82), (28.80, 129.64), (28.55, 129.53)],
    # 名瀬 → 亀徳：名瀬湾を出て奄美大島の西岸沖を南西へ → 徳之島の東岸から亀徳へ
    [(28.47, 129.45), (28.41, 129.28), (28.30, 129.08), (28.10, 129.05), (27.88, 129.08), (27.76, 129.06)],
    # 亀徳 → 和泊：徳之島の東岸沖を南へ → 沖永良部島の北東から和泊へ
    [(27.70, 129.06), (27.62, 129.02), (27.50, 128.86), (27.42, 128.72)],
    # 和泊 → 与論：沖永良部島の東沖を回って南西へ → 与論島の北を回り西岸の港へ
    [(27.37, 128.705), (27.25, 128.60), (27.10, 128.47), (27.065, 128.415), (27.05, 128.392)],
    # 与論 → 本部：与論島の西沖 → 沖縄本島北端（辺戸岬）の西沖を南西へ → 本部半島と伊江島の間 → 本部港
    [(27.025, 128.385), (26.95, 128.25), (26.84, 128.09), (26.76, 127.95), (26.715, 127.86), (26.67, 127.86)],
    # 本部 → 那覇：本部半島の西沖 → 残波岬の西沖 → 那覇港へ北西から
    [(26.63, 127.845), (26.52, 127.72), (26.42, 127.66), (26.31, 127.635), (26.255, 127.665)],
]

# 鹿児島中央駅 → 鹿児島新港（地上の接続区間。道路沿いの概略）
CONNECTOR_POINTS = [
    (31.5840, 130.5414),  # 鹿児島中央駅
    (31.5853, 130.5455),  # 中央駅東口 → ナポリ通り
    (31.5870, 130.5508),  # 加治屋町
    (31.5889, 130.5560),  # 天文館
    (31.5878, 130.5600),  # 南林寺
    (31.5862, 130.5635),  # 新港入口
    (31.5848, 130.5665),  # 鹿児島新港（フェリーターミナル）
]


# --------------------------------------------------------------------------
# 幾何ユーティリティ
# --------------------------------------------------------------------------
def poly_cum(pts):
    cum = [0.0]
    for a, b in zip(pts, pts[1:]):
        cum.append(cum[-1] + haversine_km(a[0], a[1], b[0], b[1]))
    return cum


def project(pts, cum, lat, lon):
    """点を折れ線（lat, lon 列）へ射影 → (幾何 km, ずれ km, 射影点 lat, lon)"""
    px, pz = latlon_to_world(lat, lon)
    best = (1e18, 0, 0.0)
    W = [latlon_to_world(a, b) for a, b in pts]
    for i in range(len(W) - 1):
        ax, az = W[i]
        bx, bz = W[i + 1]
        vx, vz = bx - ax, bz - az
        l2 = vx * vx + vz * vz or 1e-12
        t = max(0.0, min(1.0, ((px - ax) * vx + (pz - az) * vz) / l2))
        dx, dz = ax + vx * t - px, az + vz * t - pz
        d2 = dx * dx + dz * dz
        if d2 < best[0]:
            best = (d2, i, t)
    d2, i, t = best
    km = cum[i] + (cum[i + 1] - cum[i]) * t
    x = W[i][0] + (W[i + 1][0] - W[i][0]) * t
    z = W[i][1] + (W[i + 1][1] - W[i][1]) * t
    la, lo = world_to_latlon(x, z)
    return km, math.sqrt(d2), la, lo


def douglas_peucker(pts, tol_km):
    W = [latlon_to_world(a, b) for a, b in pts]
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        i0, i1 = stack.pop()
        ax, az = W[i0]
        bx, bz = W[i1]
        vx, vz = bx - ax, bz - az
        l2 = vx * vx + vz * vz or 1e-12
        dmax, imax = -1, -1
        for k in range(i0 + 1, i1):
            px, pz = W[k]
            t = max(0, min(1, ((px - ax) * vx + (pz - az) * vz) / l2))
            dx, dz = ax + vx * t - px, az + vz * t - pz
            d = dx * dx + dz * dz
            if d > dmax:
                dmax, imax = d, k
        if imax > 0 and dmax > tol_km * tol_km:
            keep[imax] = True
            stack.append((i0, imax))
            stack.append((imax, i1))
    return [p for p, k in zip(pts, keep) if k]


def catmull_rom(points_ll, step_km=0.25, alpha=0.5):
    """centripetal Catmull-Rom（ワールド xz 平面）で制御点を滑らかにつなぐ → lat, lon の列"""
    P = [latlon_to_world(a, b) for a, b in points_ll]
    P = [(2 * P[0][0] - P[1][0], 2 * P[0][1] - P[1][1])] + P + [(2 * P[-1][0] - P[-2][0], 2 * P[-1][1] - P[-2][1])]
    out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]

        def tj(ti, a, b):
            return ti + max(1e-6, math.hypot(b[0] - a[0], b[1] - a[1])) ** alpha

        t0 = 0.0
        t1 = tj(t0, p0, p1)
        t2 = tj(t1, p1, p2)
        t3 = tj(t2, p2, p3)
        seg = math.hypot(p2[0] - p1[0], p2[1] - p1[1])
        n = max(2, int(math.ceil(seg / step_km)))
        for k in range(n):
            t = t1 + (t2 - t1) * k / n

            def lerp(a, b, ta, tb):
                if tb - ta < 1e-9:
                    return a
                w = (t - ta) / (tb - ta)
                return (a[0] * (1 - w) + b[0] * w, a[1] * (1 - w) + b[1] * w)

            a1 = lerp(p0, p1, t0, t1)
            a2 = lerp(p1, p2, t1, t2)
            a3 = lerp(p2, p3, t2, t3)
            b1 = lerp(a1, a2, t0, t2)
            b2 = lerp(a2, a3, t1, t3)
            c = lerp(b1, b2, t1, t2)
            out.append(world_to_latlon(*c))
    out.append(world_to_latlon(*P[-2]))
    return out


def r5(v):
    return round(v, 5)


# --------------------------------------------------------------------------
# 新幹線
# --------------------------------------------------------------------------
def line_path(sections, line_name, start, end):
    """N02 の区間群から start→end の最短経路（分岐・引込線を除外した本線）"""
    key = lambda p: (round(p[0], 5), round(p[1], 5))  # (lon, lat)
    adj = {}
    for s in sections:
        if s["line"] != line_name or s["type"] != 11:
            continue
        c = s["coordinates"]
        for a, b in zip(c, c[1:]):
            ka, kb = key(a), key(b)
            w = haversine_km(a[1], a[0], b[1], b[0])
            adj.setdefault(ka, []).append((kb, w))
            adj.setdefault(kb, []).append((ka, w))
    nodes = list(adj)
    near = lambda q: min(nodes, key=lambda k: haversine_km(k[1], k[0], q[0], q[1]))
    s, e = near(start), near(end)
    dist, prev, pq = {s: 0.0}, {}, [(0.0, s)]
    while pq:
        d, u = heapq.heappop(pq)
        if u == e:
            break
        if d > dist[u]:
            continue
        for v, w in adj[u]:
            nd = d + w
            if nd < dist.get(v, 1e18):
                dist[v] = nd
                prev[v] = u
                heapq.heappush(pq, (nd, v))
    p = [e]
    while p[-1] != s:
        p.append(prev[p[-1]])
    p.reverse()
    return [(lat, lon) for lon, lat in p]


def build_shinkansen(sections, n02_stations, stations_json):
    st = stations_json
    S = {s["id"]: s for s in st["stations"]}
    fixed = []
    if n02_stations:
        for sid, name in FIX_STATIONS_FROM_N02.items():
            cand = [s for s in n02_stations if s["name"] == name and s["type"] == 11 and "新幹線" in s["line"]]
            if cand:
                old = (S[sid]["lat"], S[sid]["lon"])
                S[sid]["lat"], S[sid]["lon"] = round(cand[0]["lat"], 4), round(cand[0]["lng"], 4)
                fixed.append({"id": sid, "from": old, "to": (S[sid]["lat"], S[sid]["lon"]),
                              "movedKm": round(haversine_km(*old, S[sid]["lat"], S[sid]["lon"]), 3)})

    all_pts = []
    line_meta = []
    anchors = []
    offset_logical = 0.0
    for lid, lname, a, b, jitsu, eigyo in LINES:
        raw = line_path(sections, lname, (S[a]["lat"], S[a]["lon"]), (S[b]["lat"], S[b]["lon"]))
        raw_len = poly_cum(raw)[-1]
        simp = douglas_peucker(raw, 0.012)
        if all_pts and haversine_km(*all_pts[-1], *simp[0]) < 0.6:
            simp = simp[1:] if haversine_km(*all_pts[-1], *simp[0]) < 0.02 else simp
        all_pts.extend(simp)
        line_meta.append({"id": lid, "name": lname, "rawPoints": len(raw), "rawGeomKm": round(raw_len, 2),
                          "jitsuKm": jitsu, "eigyoKmReference": eigyo})
        offset_logical += jitsu

    pts = [(r5(a), r5(b)) for a, b in all_pts]
    cum = poly_cum(pts)

    # 駅 → 幾何 km（全線通しの折れ線上）
    stations_out = []
    for s in sorted(st["stations"], key=lambda s: s["seq"]):
        gk, off, la, lo = project(pts, cum, s["lat"], s["lon"])
        stations_out.append({"id": s["id"], "geomKm": gk, "offsetKm": off, "routeLat": la, "routeLon": lo})
    # 東京・鹿児島中央はルートの端点そのものを使う（0 km / 全長）
    stations_out[0]["geomKm"] = 0.0
    stations_out[-1]["geomKm"] = cum[-1]
    G = {s["id"]: s for s in stations_out}

    # 論理 km（実キロ, 東京起点の通し）
    line_start_logical = {}
    acc = 0.0
    for lid, *_rest in LINES:
        line_start_logical[lid] = acc
        acc += _rest[3]
    total_logical = round(acc, 1)
    logical = {}
    source = {}
    for lid, lname, a, b, jitsu, eigyo in LINES:
        line = next(l for l in st["lines"] if l["id"] == lid)
        pub = PUBLISHED_JITSU_KM[lid]
        ids = line["stations"]
        known = [(i, sid) for i, sid in enumerate(ids) if sid in pub]
        for i, sid in enumerate(ids):
            if sid in logical:
                continue
            if sid in pub:
                logical[sid] = line_start_logical[lid] + pub[sid]
                source[sid] = "published"
                continue
            # 前後の公表アンカーの間を幾何長の比で配分
            lo_i, lo_id = max((k for k in known if k[0] < i), key=lambda k: k[0])
            hi_i, hi_id = min((k for k in known if k[0] > i), key=lambda k: k[0])
            g0, g1 = G[lo_id]["geomKm"], G[hi_id]["geomKm"]
            l0, l1 = line_start_logical[lid] + pub[lo_id], line_start_logical[lid] + pub[hi_id]
            logical[sid] = round(l0 + (G[sid]["geomKm"] - g0) / (g1 - g0) * (l1 - l0), 1)
            source[sid] = "derived-n02-geometry"

    out_st = []
    prev = None
    for s0 in sorted(st["stations"], key=lambda s: s["seq"]):
        g = G[s0["id"]]
        lk = round(logical[s0["id"]], 1)
        rec = {
            "id": s0["id"], "name": s0["name"], "seq": s0["seq"], "major": s0["major"], "lines": s0["lines"],
            "lat": s0["lat"], "lon": s0["lon"],
            "routeLat": r5(g["routeLat"]), "routeLon": r5(g["routeLon"]),
            "km": lk, "kmSource": source[s0["id"]],
            "geomKm": round(g["geomKm"], 3), "offsetKm": round(g["offsetKm"], 3),
            "segmentKm": None if prev is None else round(lk - prev, 1),
        }
        if s0["id"] == "tokyo":
            rec["role"] = "start"
        if s0["id"] == "kagoshima-chuo":
            rec["role"] = "rail-end"
        out_st.append(rec)
        prev = lk

    return {
        "id": "shinkansen-tokyo-kagoshima",
        "name": "DHT EXPRESS 新幹線ルート（東京 → 鹿児島中央）",
        "type": "rail",
        "distanceDefinition": "jitsu-km",
        "distanceNote": "論理 km = 実キロ（線路の実長）。各路線の総延長（東海道 515.4 / 山陽 553.7 / 九州 256.8 km）と、公表値を確認できた駅の実キロをアンカーにし、それ以外の駅は N02 の線形の長さを前後のアンカー間で比例配分して求めた（kmSource）。営業キロ（運賃計算用）は使わない。",
        "totalKm": total_logical,
        "geomKm": round(cum[-1], 3),
        "lines": [dict(m, fromKm=round(line_start_logical[m["id"]], 1),
                       toKm=round(line_start_logical[m["id"]] + m["jitsuKm"], 1)) for m in line_meta],
        "stations": out_st,
        "points": [[a, b] for a, b in pts],
        "source": {
            "geometry": "国土数値情報（鉄道データ N02, 令和6年度 / 2024）国土交通省 — RailroadSection の東海道・山陽・九州新幹線を加工（最短経路で 1 本化・Douglas-Peucker 12m で間引き）",
            "geometryVia": "https://github.com/antfu/mlit-json （N02 を JSON 化したもの。data/sections.json）",
            "license": "国土数値情報利用約款に基づくオープンデータ（CC BY 4.0 互換）。出典：「国土数値情報（鉄道データ）」（国土交通省）を加工して作成",
            "distance": "実キロ：各路線の総延長と駅の実キロは README §14.4 の出典による。",
        },
        "_fixedStations": fixed,
    }


# --------------------------------------------------------------------------
# フェリー・接続区間
# --------------------------------------------------------------------------
def stage_port(terrain, lat, lon, depth_m=-3.0):
    """港の実座標 → ステージの海岸線（Natural Earth 1:10m・1km 格子）で海に面した最寄りの点。
    ステージの海岸線は実際より粗く、名瀬湾のような小さな湾が陸地になっているため、
    船の発着点を「最寄りの海（標高 depth_m 以下）」へ寄せる。"""
    if terrain.height_ll(lat, lon) <= depth_m:
        return lat, lon, 0.0
    best = None
    for r in [k * 0.1 for k in range(1, 81)]:
        for a in range(0, 360, 6):
            la = lat + r * math.cos(math.radians(a)) / 111.195
            lo = lon + r * math.sin(math.radians(a)) / (111.195 * math.cos(math.radians(lat)))
            if terrain.height_ll(la, lo) <= depth_m:
                best = (la, lo, r)
                break
        if best:
            break
    return round(best[0], 4), round(best[1], 4), round(best[2], 2)


def build_ferry(terrain):
    ctrl = []
    stage = {}
    for i, (pid, name, island, lat, lon, km) in enumerate(PORTS):
        sl, so, moved = stage_port(terrain, lat, lon)
        stage[pid] = (sl, so, moved)
        ctrl.append((sl, so))
        if i < len(FERRY_LEGS):
            ctrl.extend(FERRY_LEGS[i])
    dense = catmull_rom(ctrl, step_km=0.25)
    # 港の位置（制御点そのもの）を通る点の index を求める
    simp = douglas_peucker(dense, 0.03)
    pts = [(r5(a), r5(b)) for a, b in simp]
    cum = poly_cum(pts)
    ports = []
    for pid, name, island, lat, lon, km in PORTS:
        sl, so, moved = stage[pid]
        gk, off, la, lo = project(pts, cum, sl, so)
        ports.append({"id": pid, "name": name, "island": island, "type": "ferry-port", "lat": lat, "lon": lon,
                      "stageLat": sl, "stageLon": so, "stageShiftKm": moved,
                      "km": km, "geomKm": round(gk, 3), "offsetKm": round(off, 3)})
    ports[0]["geomKm"] = 0.0
    ports[-1]["geomKm"] = round(cum[-1], 3)
    for i, p in enumerate(ports):
        p["seq"] = i
        p["segmentKm"] = None if i == 0 else p["km"] - ports[i - 1]["km"]
    ports[0]["role"] = "ferry-start"
    ports[-1]["role"] = "ferry-end"

    # 検証：港の近く（2.5km）以外で陸を通らない
    land = []
    for a, b in zip(pts, pts[1:]):
        L = haversine_km(*a, *b)
        n = max(1, int(L / 0.2))
        for k in range(n):
            t = k / n
            lat, lon = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t
            dport = min(haversine_km(lat, lon, p["stageLat"], p["stageLon"]) for p in ports)
            h = terrain.height_ll(lat, lon)
            hc = terrain.coarse_m(*latlon_to_world(lat, lon))
            if dport > 1.5 and h > 0.5:
                land.append({"lat": round(lat, 4), "lon": round(lon, 4), "hiM": round(h, 1), "coarseM": round(hc, 1),
                             "nearestPortKm": round(dport, 2)})
    return {
        "id": "ferry-kagoshima-naha",
        "name": "マルエーフェリー 鹿児島航路（鹿児島新港 → 那覇）に準じた海上ルート",
        "type": "ferry",
        "distanceDefinition": "official-route-km",
        "distanceNote": "論理 km = マルエーフェリー公式の鹿児島航路の航路距離（鹿児島新港からの累積）。3D の曲線長（geomKm）とは別。",
        "totalKm": PORTS[-1][5],
        "geomKm": round(cum[-1], 3),
        "ports": ports,
        "points": [[a, b] for a, b in pts],
        "source": {
            "distance": "マルエーフェリー株式会社 公式サイト「鹿児島航路」の航路距離（鹿児島→名瀬 383km / 名瀬→亀徳 109km / 亀徳→和泊 54km / 和泊→与論 48km / 与論→本部 85km / 本部→那覇 56km）",
            "geometry": "本リポジトリで作成（CC0 相当）。寄港順と島・海岸線（Natural Earth 1:10m, パブリックドメイン）を参考に制御点を手で置き、Catmull-Rom で平滑化。航海用の実航路ではない。",
            "ports": "港の座標は概略（±0.5km 程度）。本リポジトリで作成（CC0 相当）。",
        },
        "_landCheck": land,
    }


def build_connector(terrain):
    # 終点 = フェリーの発着点（鹿児島新港をステージの海岸線に寄せた点）
    k = PORTS[0]
    sl, so, _ = stage_port(terrain, k[3], k[4])
    ctrl = list(CONNECTOR_POINTS) + ([(sl, so)] if haversine_km(sl, so, k[3], k[4]) > 0.05 else [])
    dense = catmull_rom(ctrl, step_km=0.05, alpha=0.5)
    pts = [(r5(a), r5(b)) for a, b in douglas_peucker(dense, 0.005)]
    L = poly_cum(pts)[-1]
    return {
        "id": "connector-kagoshima",
        "name": "鹿児島中央 → 鹿児島新港（接続区間）",
        "type": "connector",
        "distanceDefinition": "geometry-km",
        "distanceNote": "鉄道ではない地上の接続区間。論理 km = 概略道路線形の長さ（0.1km 単位に丸め）。",
        "totalKm": round(L, 1),
        "geomKm": round(L, 3),
        "from": {"id": "kagoshima-chuo", "name": "鹿児島中央", "lat": CONNECTOR_POINTS[0][0], "lon": CONNECTOR_POINTS[0][1]},
        "to": {"id": "kagoshima-shinko", "name": "鹿児島新港", "lat": ctrl[-1][0], "lon": ctrl[-1][1]},
        "points": [[a, b] for a, b in pts],
        "source": {"geometry": "本リポジトリで作成（CC0 相当）。道路沿いの概略線形（中央駅 → 天文館 → 新港）。"},
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sections", required=True, help="N02 RailroadSection を JSON 化したもの（mlit-json の data/sections.json）")
    ap.add_argument("--n02-stations", help="N02 Station（mlit-json の data/stations.json）。新幹線単独駅の座標補正に使う")
    ap.add_argument("--out", default=os.path.join(ROOT, "data", "routes"))
    ap.add_argument("--update-stations", action="store_true", help="data/stations.json の座標補正を書き戻す")
    a = ap.parse_args()

    sections = json.load(open(a.sections))
    n02 = json.load(open(a.n02_stations)) if a.n02_stations else None
    st_path = os.path.join(ROOT, "data", "stations.json")
    stations_json = json.load(open(st_path))
    terrain = Terrain(os.path.join(ROOT, "data", "terrain"))

    shin = build_shinkansen(sections, n02, stations_json)
    conn = build_connector(terrain)
    ferry = build_ferry(terrain)

    os.makedirs(a.out, exist_ok=True)
    fixed = shin.pop("_fixedStations")
    land = ferry.pop("_landCheck")

    journey = {
        "_comment": "DHT EXPRESS 全行程（1 DHT = 1 km）。区間を順につなぎ、累積 km（論理距離）で位置を引く。js/route.js の Journey が読む。",
        "unit": "km",
        "segments": [
            {"id": shin["id"], "type": "rail", "file": "shinkansen.json", "fromKm": 0.0, "toKm": shin["totalKm"]},
            {"id": conn["id"], "type": "connector", "file": "connector-kagoshima.json", "fromKm": shin["totalKm"],
             "toKm": round(shin["totalKm"] + conn["totalKm"], 1)},
            {"id": ferry["id"], "type": "ferry", "file": "ferry-kagoshima-naha.json",
             "fromKm": round(shin["totalKm"] + conn["totalKm"], 1),
             "toKm": round(shin["totalKm"] + conn["totalKm"] + ferry["totalKm"], 1)},
        ],
        "totalKm": round(shin["totalKm"] + conn["totalKm"] + ferry["totalKm"], 1),
        "nodes": {"railIntervalKm": 10, "railMajorKm": 100, "railMidKm": 50, "ferryIntervalKm": 10},
    }

    def dump(name, obj, compact_key="points"):
        path = os.path.join(a.out, name)
        pts = obj.get(compact_key)
        if pts is not None:
            o = dict(obj)
            o[compact_key] = "__PTS__"
            s = json.dumps(o, ensure_ascii=False, indent=1)
            s = s.replace('"__PTS__"', "[" + ",".join(f"[{p[0]},{p[1]}]" for p in pts) + "]")
        else:
            s = json.dumps(obj, ensure_ascii=False, indent=1)
        open(path, "w", encoding="utf-8").write(s + "\n")
        print(f"wrote {path} ({os.path.getsize(path) / 1024:.1f} KB)")

    dump("shinkansen.json", shin)
    dump("connector-kagoshima.json", conn)
    dump("ferry-kagoshima-naha.json", ferry)
    dump("journey.json", journey)

    print("shinkansen points", len(shin["points"]), "geomKm", shin["geomKm"], "logical", shin["totalKm"])
    for m in shin["lines"]:
        print("  ", m)
    print("fixed stations", fixed)
    print("connector", conn["totalKm"], "km")
    print("ferry points", len(ferry["points"]), "geomKm", ferry["geomKm"], "logical", ferry["totalKm"])
    for p in ferry["ports"]:
        print("  ", p["name"], p["km"], p["geomKm"], "off", p["offsetKm"], "shift", p["stageShiftKm"], "h", round(terrain.height_ll(p["stageLat"], p["stageLon"]), 1))
    print("ferry land hits:", len(land))
    for h in land[:40]:
        print("   ", h)
    json.dump({"fixedStations": fixed, "ferryLandHits": land}, open(os.path.join(ROOT, "qa", "v5", "route_build_log.json"), "w"),
              ensure_ascii=False, indent=1)

    if a.update_stations and fixed:
        for s in stations_json["stations"]:
            for f in fixed:
                if s["id"] == f["id"]:
                    s["lat"], s["lon"] = f["to"]
        txt = json.dumps(stations_json, ensure_ascii=False, indent=1)
        open(st_path, "w", encoding="utf-8").write(txt + "\n")
        print("updated", st_path)


if __name__ == "__main__":
    main()
