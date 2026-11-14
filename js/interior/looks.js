/**
 * interior/looks.js — 【v12】車内の時間帯ごとの見た目（車窓・室内照明）
 * ---------------------------------------------------------------------------
 * MAP 側の timeofday.js と同じ 4 モード（morning / day / evening / night）。
 * 乗車時・乗車中に MAP の tod.mode を TrainInterior.setTimeMode() へ渡す。
 *
 * 車窓（scenery.js）が使う値
 *   skyHorizon / skyMid / skyZenith … 空のグラデーション（地平 → 中ほど → 天頂）
 *   sunGlow   … 太陽（朝日・夕日）のにじみ { color, opacity, size, dir }
 *   cloud / cloudOpacity / haze*      … 雲の色・かすみ（scene.fog）
 *   windowLit … ビルの窓明かりの密度 0（なし）〜 3（多い）。windowGlow = 明るさ、windowColor = 色
 *   streetGlow … 道路・街路灯の光（地面の発光）。beacons … 高い建物の赤い航空障害灯
 *   stars     … 星の明るさ。cityGround / mountainTint / ridgeTint / buildingTint … 掛け色
 * 室内が使う値
 *   hemi* / sun* … 環境光と太陽（月）の光。lamp* … 室内のランプ。sunPatch … 床の光だまり
 *   interiorFill / fillColor … 夕方・夜に電灯をつけた室内の明るさ（室内の面だけ。車窓は暗いまま）
 *   charTint … unlit のモデル（リンさん）の明るさ。exposure … 露出
 */
import * as THREE from 'three';

const c = (hex) => new THREE.Color(hex);
const v = (x, y, z) => new THREE.Vector3(x, y, z).normalize();

const DAY = {
  skyHorizon: c('#d6e6f0'),
  skyMid: c('#86b6e2'),
  skyZenith: c('#2f72c4'),
  sunGlow: { color: c('#fff6dc'), opacity: 0, size: 2600, dir: v(0.3, 0.55, -1) },
  cloud: c('#ffffff'),
  cloudOpacity: 0.95,
  haze: c('#c8d9e6'),
  hazeNear: 220,
  hazeFar: 9500,
  cityGround: c('#e2ded6'),
  buildingTint: c('#ffffff'),
  mountainTint: c('#ffffff'),
  ridgeTint: c('#ffffff'),
  windowLit: 0,
  windowGlow: 0,
  windowColor: c('#ffe2a8'),
  streetGlow: 0,
  beacons: false,
  stars: 0,
  hemiSky: c('#fff4e2'),
  hemiGround: c('#6b5440'),
  hemi: 1.05,
  sunColor: c('#fff1d8'),
  sun: 2.1,
  sunDir: v(-0.35, 1.0, -0.8), // 右舷（-Z）の上空から差し込む
  lamp: 2.4,
  lampColor: c('#ffc985'),
  lampGlow: 1.0,
  interiorFill: 0, // 室内の面だけを電灯の色で持ち上げる量（夕方・夜は電灯をつけて明るく）
  fillColor: c('#ffd7a6'),
  sunPatch: 0.32,
  sunPatchColor: c('#fff2cf'),
  charTint: c('#ffffff'),
  exposure: 1.0,
  speed: 24, // 24 m/s ≒ 86 km/h
};

export const ROOM_LOOKS = {
  day: DAY,

  // 朝：淡い青〜少し暖色の空、やわらかい光、窓明かりがまだ少し残る
  morning: {
    ...DAY,
    skyHorizon: c('#f6d9b8'),
    skyMid: c('#bcd3e6'),
    skyZenith: c('#6f9fd4'),
    sunGlow: { color: c('#ffd9a0'), opacity: 0.75, size: 3200, dir: v(-0.55, 0.1, -1) },
    cloud: c('#fff1e2'),
    cloudOpacity: 0.85,
    haze: c('#e6d8cc'),
    hazeNear: 160,
    hazeFar: 7600,
    cityGround: c('#d9d1c6'),
    buildingTint: c('#f4ece2'),
    mountainTint: c('#d8dcd2'),
    ridgeTint: c('#d4c6c8'),
    windowLit: 1,
    windowGlow: 0.55,
    windowColor: c('#ffe6b8'),
    streetGlow: 0.08,
    hemiSky: c('#fff0dc'),
    hemiGround: c('#6b5848'),
    hemi: 0.95,
    sunColor: c('#ffe2bc'),
    sun: 1.7,
    sunDir: v(-0.75, 0.42, -0.6),
    lamp: 2.6,
    interiorFill: 0.06,
    sunPatch: 0.3,
    sunPatchColor: c('#ffe6c2'),
    charTint: c('#fbf3ea'),
    exposure: 1.0,
  },

  // 夕方：オレンジ・ピンク・紫の夕焼け、窓明かりが少しずつ点灯
  evening: {
    ...DAY,
    skyHorizon: c('#ff9a5a'),
    skyMid: c('#e77fa0'),
    skyZenith: c('#4a3f86'),
    sunGlow: { color: c('#ffb070'), opacity: 0.95, size: 4200, dir: v(0.65, 0.06, -1) },
    cloud: c('#ffb8a8'),
    cloudOpacity: 0.95,
    haze: c('#d9908e'),
    hazeNear: 120,
    hazeFar: 6800,
    cityGround: c('#a78f8a'),
    buildingTint: c('#e2b8a8'),
    mountainTint: c('#8a6f86'),
    ridgeTint: c('#b88aa6'),
    windowLit: 2,
    windowGlow: 1.15,
    windowColor: c('#ffd28a'),
    streetGlow: 0.45,
    beacons: true,
    stars: 0.08,
    hemiSky: c('#ffc8a8'),
    hemiGround: c('#5a3a40'),
    hemi: 0.8,
    sunColor: c('#ffa868'),
    sun: 1.6,
    sunDir: v(0.75, 0.22, -0.62),
    lamp: 5.2,
    lampColor: c('#ffc27e'),
    lampGlow: 1.35,
    interiorFill: 0.34,
    fillColor: c('#ffd2a0'),
    sunPatch: 0.42,
    sunPatchColor: c('#ffb680'),
    charTint: c('#ffe0cc'),
    exposure: 1.02,
  },

  // 夜：深い青〜黒の夜空、たくさんの窓明かり、街路灯、赤い航空障害灯、遠くの光
  night: {
    ...DAY,
    skyHorizon: c('#1c2a4a'),
    skyMid: c('#0f1a36'),
    skyZenith: c('#04070f'),
    sunGlow: { color: c('#c8d6ff'), opacity: 0.12, size: 900, dir: v(-0.2, 0.55, -1) }, // 月のにじみ
    cloud: c('#2a3550'),
    cloudOpacity: 0.55,
    haze: c('#1a2440'),
    hazeNear: 160,
    hazeFar: 8200,
    cityGround: c('#4a4c58'),
    buildingTint: c('#5a6070'),
    mountainTint: c('#2a3040'),
    ridgeTint: c('#3a4460'),
    windowLit: 3,
    windowGlow: 1.6,
    windowColor: c('#ffe4b0'),
    streetGlow: 1.0,
    beacons: true,
    stars: 0.9,
    hemiSky: c('#8a92b8'),
    hemiGround: c('#2a2028'),
    hemi: 0.42,
    sunColor: c('#9fb4e8'),
    sun: 0.35,
    sunDir: v(-0.2, 1.0, -0.6),
    lamp: 6.4,
    lampColor: c('#ffc074'),
    lampGlow: 1.6,
    interiorFill: 0.42,
    fillColor: c('#ffcf98'),
    sunPatch: 0,
    sunPatchColor: c('#b8c8ff'),
    charTint: c('#e8d4c4'),
    exposure: 1.06,
  },
};

/** モード名 → 見た目（不明なモードは day） */
export function resolveRoomLook(mode) {
  const key = mode && ROOM_LOOKS[mode] ? mode : 'day';
  return { key, look: ROOM_LOOKS[key], requested: mode ?? 'day', fallback: key !== (mode ?? 'day') };
}
