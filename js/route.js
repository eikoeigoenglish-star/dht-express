/**
 * route.js — 距離ベースのルートエンジン（v5 で実装。v2 の GeoPolyline もそのまま残す）
 * ===========================================================================
 * v5: DHT EXPRESS の全行程（東京 → 鹿児島中央 → 鹿児島新港 → 那覇）を
 *     「1 DHT = 1 km」の論理距離で引けるようにした。下の DistanceRoute / Journey を参照。
 *
 *   const journey = await loadJourney(asset('data/routes/journey.json'));
 *   const rail = journey.rail;                         // 新幹線（論理 km = 実キロ 1325.9）
 *   rail.getPositionAtDistance(500)                    // → { x, z, lat, lon, headingRad, ... }
 *   journey.ferry.getPositionAtDistance(383)           // → 名瀬港
 *   journey.getJourneyPosition(totalDht)               // → どの区間の何 km か + 位置
 *
 * ---------------------------------------------------------------------------
 * 以下は v2 の説明（GeoPolyline は互換のため残している）
 * 【将来拡張用】
 * ---------------------------------------------------------------------------
 * 「DHT 1回 = 1km」の進行量 (progressKm) をワールド座標へ変換するための土台。
 * ルートデータ（東京→鹿児島中央→沖縄）は今回まだ定義しない。
 *
 * 想定する使い方（将来）:
 *
 *   import { GeoPolyline } from './route.js';
 *   const route = new GeoPolyline(ROUTE_LATLON, { totalKm: 1395 });
 *   // totalKm を与えると、実測の折れ線長をその値に合わせて正規化する
 *   //（営業キロ 1395km とポリライン長の差を吸収）
 *
 *   const progressKm = totalCount;              // DHT 回数 = km
 *   const p = route.getPointAtKm(progressKm);   // {lat, lon, x, z, headingRad, segmentIndex}
 *   train.position.set(p.x, terrain.getSurfaceY(p.x, p.z) + 0.05, p.z);
 *   train.rotation.y = p.headingRad;
 *
 * 駅データとの接続（data/stations.json → js/stations.js）:
 *   const nodes = attachStationsToRoute(route, DHT.stations.list);
 *   // nodes[i].routeKm … その駅がルート上の何 km 地点か（公称 km）
 *   // nodes[i].offsetKm … ルート線から駅までのずれ（データ確認用）
 *   // progressKm が nodes[i].routeKm を越えた瞬間 = 駅到着イベント
 *   ランドマーク通過も同様に locate(lat, lon) で km を求めておけばよい。
 *
 * 関係の整理:
 *   緯度経度 ─latLonToWorld()→ ワールド(x,z) [1unit = 1km]
 *   実距離   ─haversineKm()   → 区間ごとの km（ルート上の位置 = 累積 km）
 *   ルート上の位置 (km) ─getPointAtKm()→ 緯度経度 / ワールド座標 / 進行方向
 */
import { latLonToWorld, haversineKm, worldToLatLon } from './geo.js';

export class GeoPolyline {
  /**
   * @param {Array<[number, number]>} latLonPoints [[lat, lon], ...]
   * @param {{ totalKm?: number }} [opts]
   */
  constructor(latLonPoints, opts = {}) {
    if (!latLonPoints || latLonPoints.length < 2) throw new Error('GeoPolyline needs >= 2 points');
    this.points = latLonPoints.map(([lat, lon]) => {
      const w = latLonToWorld(lat, lon);
      return { lat, lon, x: w.x, z: w.z };
    });
    this.cum = [0];
    for (let i = 1; i < this.points.length; i++) {
      const a = this.points[i - 1];
      const b = this.points[i];
      this.cum.push(this.cum[i - 1] + haversineKm(a.lat, a.lon, b.lat, b.lon));
    }
    this.measuredKm = this.cum[this.cum.length - 1];
    this.totalKm = opts.totalKm ?? this.measuredKm;
    this.scale = this.measuredKm / this.totalKm; // 公称km → 実測km
  }

  /** 公称 km（DHT カウント）→ ルート上の位置 */
  getPointAtKm(km) {
    const d = Math.max(0, Math.min(this.measuredKm, km * this.scale));
    let lo = 0;
    let hi = this.cum.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.cum[mid] <= d) lo = mid;
      else hi = mid;
    }
    const a = this.points[lo];
    const b = this.points[hi];
    const seg = this.cum[hi] - this.cum[lo] || 1;
    const t = (d - this.cum[lo]) / seg;
    const x = a.x + (b.x - a.x) * t;
    const z = a.z + (b.z - a.z) * t;
    const ll = worldToLatLon(x, z);
    // Three.js の rotation.y：-Z（北）向きを 0 とした進行方向
    const headingRad = Math.atan2(-(b.x - a.x), -(b.z - a.z));
    return { lat: ll.lat, lon: ll.lon, x, z, headingRad, segmentIndex: lo, t };
  }

  /**
   * 緯度経度の点をルート上へ射影する（駅・ランドマークの「ルート上の km」を求める）
   * @returns {{ km:number, measuredKm:number, offsetKm:number, segmentIndex:number }}
   *   km は公称 km（getPointAtKm に渡せる値）、offsetKm はルートからの距離
   */
  locate(lat, lon) {
    const p = latLonToWorld(lat, lon);
    let best = { d2: Infinity, i: 0, t: 0 };
    for (let i = 0; i < this.points.length - 1; i++) {
      const a = this.points[i];
      const b = this.points[i + 1];
      const vx = b.x - a.x;
      const vz = b.z - a.z;
      const l2 = vx * vx + vz * vz || 1e-9;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.z - a.z) * vz) / l2));
      const dx = a.x + vx * t - p.x;
      const dz = a.z + vz * t - p.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < best.d2) best = { d2, i, t };
    }
    const measuredKm = this.cum[best.i] + (this.cum[best.i + 1] - this.cum[best.i]) * best.t;
    return { km: measuredKm / this.scale, measuredKm, offsetKm: Math.sqrt(best.d2), segmentIndex: best.i };
  }
}

/**
 * 駅リスト（stations.js の list）にルート上の km を付ける。
 * @param {GeoPolyline} route
 * @param {Array<{id:string, lat:number, lon:number}>} stations
 * @returns {Array<object>} 各駅 + { routeKm, offsetKm }（routeKm の昇順）
 */
export function attachStationsToRoute(route, stations) {
  return stations
    .map((s) => {
      const r = route.locate(s.lat, s.lon);
      return { ...s, routeKm: r.km, offsetKm: r.offsetKm };
    })
    .sort((a, b) => a.routeKm - b.routeKm);
}


/* ========================================================================== */
/* v5: 距離ベースのルートエンジン                                                */
/* ========================================================================== */
/*
 * 2 つの距離を分けて持つ。
 *   幾何 km（geomKm）… 折れ線の実測長（haversine の累積）。3D 上の曲線長。
 *   論理 km（km）    … DHT の進行に使う距離（新幹線 = 実キロ、フェリー = 公式航路距離）。
 * 駅・港を「論理 km ↔ 幾何 km」の対応点（アンカー）として区分線形に対応させるので、
 * 駅・港の位置では必ず公式の km と一致し、折れ線の誤差は駅間にだけ薄く分配される。
 *
 *   論理 km ──logicalToGeom()──▶ 幾何 km ──折れ線──▶ 緯度経度・ワールド座標・進行方向
 */

/** 数値化：NaN・undefined → 0、+Infinity → 大きな値（終点へクランプ）、-Infinity → 0 */
function _num(v) {
  const n = Number(v);
  if (Number.isNaN(n)) return 0;
  if (n === Infinity) return Number.MAX_VALUE;
  if (n === -Infinity) return -Number.MAX_VALUE;
  return n;
}

/** 二分探索：sorted[i] <= v となる最大の i（0..n-2 にクランプ） */
function _seg(sorted, v) {
  let lo = 0;
  let hi = sorted.length - 1;
  if (v <= sorted[0]) return 0;
  if (v >= sorted[hi]) return Math.max(0, hi - 1);
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] <= v) lo = mid;
    else hi = mid;
  }
  return lo;
}

export class DistanceRoute {
  /**
   * @param {object} data  data/routes/*.json（points: [[lat, lon]...], totalKm, geomKm）
   * @param {{ stops?: Array<{id, name, km, geomKm?, lat, lon}>, getSurfaceY?: (x:number, z:number)=>number }} [opts]
   *   stops … 駅・港（論理 km の昇順）。geomKm を持つものはアンカーになる。
   */
  constructor(data, opts = {}) {
    this.id = data.id;
    this.name = data.name;
    this.type = data.type; // 'rail' | 'ferry' | 'connector'
    this.data = data;
    this.getSurfaceY = opts.getSurfaceY ?? null;
    this.points = data.points.map(([lat, lon]) => {
      const w = latLonToWorld(lat, lon);
      return { lat, lon, x: w.x, z: w.z };
    });
    this.cum = [0];
    for (let i = 1; i < this.points.length; i++) {
      const a = this.points[i - 1];
      const b = this.points[i];
      this.cum.push(this.cum[i - 1] + haversineKm(a.lat, a.lon, b.lat, b.lon));
    }
    this.geomKm = this.cum[this.cum.length - 1];
    this.totalKm = data.totalKm ?? this.geomKm;

    // 駅・港（論理 km 順）
    this.stops = (opts.stops ?? []).slice().sort((a, b) => a.km - b.km);
    // アンカー：始点・終点 + geomKm を持つ停車地
    const anc = [{ km: 0, g: 0 }];
    for (const s of this.stops) {
      if (s.geomKm == null || s.km <= 0 || s.km >= this.totalKm) continue;
      anc.push({ km: s.km, g: Math.min(this.geomKm, s.geomKm) });
    }
    anc.push({ km: this.totalKm, g: this.geomKm });
    anc.sort((a, b) => a.km - b.km);
    this.anchorKm = anc.map((a) => a.km);
    this.anchorGeom = anc.map((a) => a.g);
    for (let i = 1; i < anc.length; i++) {
      if (!(this.anchorKm[i] > this.anchorKm[i - 1]) || !(this.anchorGeom[i] >= this.anchorGeom[i - 1]))
        console.warn(`[route] ${this.id}: アンカーが単調増加でない`, anc[i - 1], anc[i]);
    }
  }

  /** 論理 km → 幾何 km（区分線形。範囲外はクランプ） */
  logicalToGeom(km) {
    const k = Math.max(0, Math.min(this.totalKm, km));
    const i = _seg(this.anchorKm, k);
    const k0 = this.anchorKm[i];
    const k1 = this.anchorKm[i + 1];
    const t = k1 > k0 ? (k - k0) / (k1 - k0) : 0;
    return this.anchorGeom[i] + (this.anchorGeom[i + 1] - this.anchorGeom[i]) * t;
  }

  /** 幾何 km → 論理 km */
  geomToLogical(g) {
    const v = Math.max(0, Math.min(this.geomKm, g));
    const i = _seg(this.anchorGeom, v);
    const g0 = this.anchorGeom[i];
    const g1 = this.anchorGeom[i + 1];
    const t = g1 > g0 ? (v - g0) / (g1 - g0) : 0;
    return this.anchorKm[i] + (this.anchorKm[i + 1] - this.anchorKm[i]) * t;
  }

  /** 幾何 km → 折れ線上の点 */
  getPointAtGeom(g, out = {}) {
    const d = Math.max(0, Math.min(this.geomKm, g));
    const i = _seg(this.cum, d);
    const a = this.points[i];
    const b = this.points[i + 1];
    const seg = this.cum[i + 1] - this.cum[i] || 1;
    const t = (d - this.cum[i]) / seg;
    out.x = a.x + (b.x - a.x) * t;
    out.z = a.z + (b.z - a.z) * t;
    const ll = worldToLatLon(out.x, out.z);
    out.lat = ll.lat;
    out.lon = ll.lon;
    // Three.js の rotation.y：-Z（北）向きを 0 とした進行方向
    out.headingRad = Math.atan2(-(b.x - a.x), -(b.z - a.z));
    out.segmentIndex = i;
    out.t = t;
    out.geomKm = d;
    return out;
  }

  /**
   * ★ 論理 km（DHT の累積 = km）→ 3D 位置
   * 範囲外（負・全長超え）でも破綻しない：始点 / 終点にクランプし inRange=false を返す。
   * @returns {{ km:number, requestedKm:number, inRange:boolean, progress:number, geomKm:number,
   *            x:number, y:number|null, z:number, lat:number, lon:number, headingRad:number, segmentIndex:number }}
   */
  getPositionAtDistance(km, out = {}) {
    const req = _num(km);
    const k = Math.max(0, Math.min(this.totalKm, req));
    this.getPointAtGeom(this.logicalToGeom(k), out);
    out.km = k;
    out.requestedKm = req;
    out.inRange = Number.isFinite(km) && req >= 0 && req <= this.totalKm;
    out.progress = this.totalKm > 0 ? k / this.totalKm : 0;
    out.y = this.getSurfaceY ? this.getSurfaceY(out.x, out.z) : null;
    out.routeId = this.id;
    return out;
  }

  /** 緯度経度 → ルート上の最寄り位置（論理 km・幾何 km・ずれ） */
  locate(lat, lon) {
    const p = latLonToWorld(lat, lon);
    let best = { d2: Infinity, i: 0, t: 0 };
    for (let i = 0; i < this.points.length - 1; i++) {
      const a = this.points[i];
      const b = this.points[i + 1];
      const vx = b.x - a.x;
      const vz = b.z - a.z;
      const l2 = vx * vx + vz * vz || 1e-9;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.z - a.z) * vz) / l2));
      const dx = a.x + vx * t - p.x;
      const dz = a.z + vz * t - p.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < best.d2) best = { d2, i, t };
    }
    const g = this.cum[best.i] + (this.cum[best.i + 1] - this.cum[best.i]) * best.t;
    return { km: this.geomToLogical(g), geomKm: g, offsetKm: Math.sqrt(best.d2), segmentIndex: best.i };
  }

  /**
   * 一定間隔（論理 km）のノード。0 km と終点を含む（終点が間隔の倍数でなくても最後に追加）。
   * @param {number} intervalKm
   * @param {(km:number)=>string} [tierOf]
   */
  makeNodes(intervalKm = 10, tierOf = () => 'minor') {
    const nodes = [];
    const n = Math.floor(this.totalKm / intervalKm + 1e-9);
    for (let i = 0; i <= n; i++) {
      const km = Math.round(i * intervalKm * 1000) / 1000;
      const p = this.getPositionAtDistance(km);
      nodes.push({ km, tier: tierOf(km, i), x: p.x, z: p.z, lat: p.lat, lon: p.lon, headingRad: p.headingRad });
    }
    return nodes;
  }

  /* ---- 駅・港 ---- */

  /** progressKm より先（> progressKm）の最初の停車地。なければ null */
  getNextStop(progressKm) {
    return this.stops.find((s) => s.km > progressKm + 1e-9) ?? null;
  }

  /** progressKm 以前（<= progressKm）の最後の停車地。なければ null */
  getPreviousStop(progressKm) {
    let r = null;
    for (const s of this.stops) {
      if (s.km <= progressKm + 1e-9) r = s;
      else break;
    }
    return r;
  }

  /** 次の停車地までの論理 km（次がなければ null） */
  getDistanceToNextStop(progressKm) {
    const s = this.getNextStop(progressKm);
    return s ? s.km - progressKm : null;
  }

  /** (prevKm, curKm] の間に通過・到着した停車地（到着イベントの判定用） */
  stopsBetween(prevKm, curKm) {
    return this.stops.filter((s) => s.km > prevKm && s.km <= curKm);
  }

  getStop(id) {
    return this.stops.find((s) => s.id === id) ?? null;
  }
}

/** 新幹線ルート：停車地 = 駅（data/routes/shinkansen.json の stations[]） */
export class RailRoute extends DistanceRoute {
  constructor(data, opts = {}) {
    const stations = data.stations.map((s) => ({ ...s, type: 'station' }));
    super(data, { ...opts, stops: stations });
    this.stations = this.stops;
    this.startStation = this.stations.find((s) => s.role === 'start') ?? this.stations[0];
    this.endStation = this.stations.find((s) => s.role === 'rail-end') ?? this.stations[this.stations.length - 1];
  }
  getNextStation(km) {
    return this.getNextStop(km);
  }
  getPreviousStation(km) {
    return this.getPreviousStop(km);
  }
  getDistanceToNextStation(km) {
    return this.getDistanceToNextStop(km);
  }
  getStation(id) {
    return this.getStop(id);
  }
}

/** フェリー航路：停車地 = 寄港地（ports[]。lat/lon は実際の港、stageLat/stageLon はステージ上の発着点） */
export class FerryRoute extends DistanceRoute {
  constructor(data, opts = {}) {
    super(data, { ...opts, stops: data.ports });
    this.ports = this.stops;
  }
  getNextPort(km) {
    return this.getNextStop(km);
  }
  getPreviousPort(km) {
    return this.getPreviousStop(km);
  }
  getDistanceToNextPort(km) {
    return this.getDistanceToNextStop(km);
  }
}

/**
 * 全行程：区間（新幹線 → 接続 → フェリー）を論理 km で直列につなぐ。
 *   totalDht（= 累積 km）→ どの区間の何 km 地点か → 3D 位置
 */
export class Journey {
  /**
   * @param {object} meta journey.json
   * @param {Array<DistanceRoute>} routes meta.segments と同じ順
   */
  constructor(meta, routes) {
    this.meta = meta;
    this.segments = meta.segments.map((s, i) => ({ ...s, route: routes[i] }));
    this.totalKm = this.segments[this.segments.length - 1].toKm;
    this.rail = routes.find((r) => r.type === 'rail');
    this.connector = routes.find((r) => r.type === 'connector');
    this.ferry = routes.find((r) => r.type === 'ferry');
    // 全停車地（駅・港）を全行程 km 付きで
    this.stops = [];
    for (const seg of this.segments)
      for (const s of seg.route.stops) {
        const jk = Math.round((seg.fromKm + s.km) * 1000) / 1000;
        if (this.stops.length && Math.abs(this.stops[this.stops.length - 1].journeyKm - jk) < 1e-6) continue;
        this.stops.push({ ...s, journeyKm: jk, segmentId: seg.id, segmentType: seg.type });
      }
  }

  /** 全行程 km → 区間 */
  segmentAt(totalKm) {
    for (const s of this.segments) if (totalKm < s.toKm) return s;
    return this.segments[this.segments.length - 1];
  }

  /**
   * ★ 累積 DHT（1 DHT = 1 km）→ 区間と 3D 位置
   * 区間境界ちょうど（例：1325.9 km）は「前の区間の終点」ではなく次の区間の 0 km として扱う
   *（位置は同じ点。区間の種類だけが切り替わる）。全行程の終点は最後の区間に含める。
   */
  getJourneyPosition(totalDht, out = {}) {
    const req = _num(totalDht);
    const k = Math.max(0, Math.min(this.totalKm, req));
    const seg = this.segmentAt(k);
    const local = Math.min(seg.route.totalKm, Math.max(0, k - seg.fromKm));
    seg.route.getPositionAtDistance(local, out);
    out.totalKm = k;
    out.requestedKm = req;
    out.inRange = Number.isFinite(totalDht) && req >= 0 && req <= this.totalKm;
    out.finished = req >= this.totalKm;
    out.segmentId = seg.id;
    out.segmentType = seg.type; // 'rail' | 'connector' | 'ferry'
    out.segmentKm = local;
    out.journeyProgress = this.totalKm > 0 ? k / this.totalKm : 0;
    out.nextStop = this.getNextStop(k);
    out.previousStop = this.getPreviousStop(k);
    return out;
  }

  getNextStop(totalKm) {
    return this.stops.find((s) => s.journeyKm > totalKm + 1e-9) ?? null;
  }
  getPreviousStop(totalKm) {
    let r = null;
    for (const s of this.stops) {
      if (s.journeyKm <= totalKm + 1e-9) r = s;
      else break;
    }
    return r;
  }
  getDistanceToNextStop(totalKm) {
    const s = this.getNextStop(totalKm);
    return s ? s.journeyKm - totalKm : null;
  }
  /** (prevKm, curKm] の間に到着した駅・港（将来の到着イベント用） */
  stopsBetween(prevKm, curKm) {
    return this.stops.filter((s) => s.journeyKm > prevKm && s.journeyKm <= curKm);
  }
}

/**
 * journey.json と各区間の JSON を読み込んで Journey を作る（すべて相対 URL）
 * @param {string} journeyUrl
 * @param {{ getSurfaceY?: Function }} [opts]
 */
export async function loadJourney(journeyUrl, opts = {}) {
  const meta = await (await fetch(journeyUrl)).json();
  const base = new URL('./', journeyUrl);
  const datas = await Promise.all(meta.segments.map(async (s) => (await fetch(new URL(s.file, base))).json()));
  const routes = datas.map((d) =>
    d.type === 'rail' ? new RailRoute(d, opts) : d.type === 'ferry' ? new FerryRoute(d, opts) : new DistanceRoute(d, opts),
  );
  return new Journey(meta, routes);
}
