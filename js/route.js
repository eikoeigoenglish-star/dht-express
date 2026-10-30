/**
 * route.js — 【将来拡張用・今回は未使用】
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
