/**
 * geo.js — 緯度経度 ⇔ Three.js ワールド座標の変換（ステージ全体の“ものさし”）
 * ---------------------------------------------------------------------------
 *
 *  座標系（右手系・Three.js 標準）
 *    +X : 東        -X : 西
 *    -Z : 北        +Z : 南      （カメラの「奥」= 北）
 *    +Y : 上（標高）
 *
 *  水平スケール
 *    1 world unit = 1 km （実距離そのまま）
 *    → 東京〜鹿児島中央 約1395km の進行も、ワールド上でほぼ等身大の距離になる。
 *
 *  垂直スケール
 *    Y = 標高[m] / 1000 * VERTICAL_EXAGGERATION
 *    既定は 3 倍誇張（広域ステージとして山が見えるように）。海面は Y = 0。
 *
 *  投影法：正弦図法 (Sinusoidal, 中央経線 LON0)
 *    x =  (lon - LON0) * KM_PER_DEG * cos(lat)
 *    z = -(lat - LAT0) * KM_PER_DEG
 *    ・南北方向の距離は正確、各緯線に沿った東西方向の距離も正確。
 *    ・逆変換が厳密に計算できる。
 *    ・対象範囲（北緯24°〜38°、東経122°〜142°）での歪みは数%以内。
 *
 *  ※ tools/build_terrain.py と定数を必ず一致させること（manifest.json にも記録）。
 */

export const LON0 = 132.5;
export const LAT0 = 31.0;
export const EARTH_RADIUS_KM = 6371.0088;
export const KM_PER_DEG = (EARTH_RADIUS_KM * Math.PI) / 180;

/** 北緯37°40'23'' — ステージの北限 */
export const NORTH_LIMIT_LAT = 37 + 40 / 60 + 23 / 3600; // 37.673055…

/** 標高の誇張率（Y = m / 1000 * VERTICAL_EXAGGERATION） */
export const VERTICAL_EXAGGERATION = 3.0;

/** 1 world unit あたりの km（水平） */
export const KM_PER_UNIT = 1.0;

const D2R = Math.PI / 180;

/**
 * 緯度経度 → ワールド座標 (x, z)。
 * @param {number} lat 緯度（度, 北が正）
 * @param {number} lon 経度（度, 東が正）
 * @param {object} [out] {x, z} を書き込む先（GC削減用）
 * @returns {{x:number, z:number}}
 */
export function latLonToWorld(lat, lon, out = { x: 0, z: 0 }) {
  out.x = (lon - LON0) * KM_PER_DEG * Math.cos(lat * D2R);
  out.z = -(lat - LAT0) * KM_PER_DEG;
  return out;
}

/**
 * ワールド座標 (x, z) → 緯度経度。latLonToWorld の厳密な逆変換。
 * @returns {{lat:number, lon:number}}
 */
export function worldToLatLon(x, z, out = { lat: 0, lon: 0 }) {
  const lat = LAT0 - z / KM_PER_DEG;
  out.lat = lat;
  out.lon = LON0 + x / (KM_PER_DEG * Math.cos(lat * D2R));
  return out;
}

/** 標高[m] → ワールド Y */
export function metersToY(m) {
  return (m / 1000) * VERTICAL_EXAGGERATION;
}

/** ワールド Y → 標高[m] */
export function yToMeters(y) {
  return (y * 1000) / VERTICAL_EXAGGERATION;
}

/** 2点間の大圏距離 [km]（ルート上の実距離計算用） */
export function haversineKm(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * D2R;
  const dLon = (lon2 - lon1) * D2R;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * D2R) * Math.cos(lat2 * D2R) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** 度分秒 → 度 */
export function dmsToDeg(d, m = 0, s = 0) {
  return Math.sign(d || 1) * (Math.abs(d) + m / 60 + s / 3600);
}

/** 表示用 "35.681°N 139.767°E" */
export function formatLatLon(lat, lon) {
  return `${Math.abs(lat).toFixed(3)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(3)}°${lon >= 0 ? 'E' : 'W'}`;
}
