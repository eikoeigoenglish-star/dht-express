/**
 * interior/looks.js — 【v11】Room 1 の時間帯ごとの見た目（車窓・室内照明）
 * ---------------------------------------------------------------------------
 * MAP 側の timeofday.js と同じ 4 モード名（morning / day / evening / night）をキーにする。
 * v11 で実装したのは day だけ。morning / evening / night は null（未実装）で、
 * resolveRoomLook() が day にフォールバックする。
 *
 * 将来の追加手順：ROOM1_LOOKS.night = { ...ROOM1_LOOKS.day, ...夜の値 } のように埋めるだけで、
 *   Room1.setTimeMode('night')（＝MAP の tod.mode をそのまま渡している）で車窓・照明に反映される。
 */
import * as THREE from 'three';

const c = (hex) => new THREE.Color(hex);

export const ROOM1_LOOKS = {
  day: {
    // 空（ドームの頂点カラー：地平 → 天頂）と雲
    skyHorizon: c('#d6e6f0'),
    skyZenith: c('#2f72c4'),
    cloud: c('#ffffff'),
    cloudOpacity: 0.95,
    // 遠景のかすみ（scene.fog。室内の距離 < 10m には効かない）。地平線の街と山並みを青白く
    haze: c('#c8d9e6'),
    hazeNear: 220,
    hazeFar: 9500,
    // 屋外の色味（建物の色は scenery.js の頂点カラー。ここは全体の掛け色）
    cityGround: c('#e2ded6'),
    mountainTint: c('#ffffff'),
    ridgeTint: c('#ffffff'),
    // 光
    hemiSky: c('#fff4e2'),
    hemiGround: c('#6b5440'),
    hemi: 1.05,
    sunColor: c('#fff1d8'),
    sun: 2.1,
    sunDir: new THREE.Vector3(-0.35, 1.0, -0.8).normalize(), // 車窓側（-Z）の上空から差し込む
    lamp: 2.4, // 室内のランプ（PointLight の強さ）
    lampColor: c('#ffc985'),
    lampGlow: 1.0, // ランプのガラスの発光
    sunPatch: 0.32, // 床に落ちる窓の光だまり
    exposure: 1.0,
    // 列車の速度（車窓の流れ） [m/s]。24 m/s ≒ 86 km/h（緑の山の区間は 9 km ごとに 2 回 ≒ 3 分おき）
    speed: 24,
  },
  morning: null, // TODO(v12+): 朝の車窓・照明
  evening: null, // TODO(v12+): 夕方の車窓・照明（ランプを強く、空を橙に）
  night: null, // TODO(v12+): 夜の車窓（街明かり）・照明
};

/** モード名 → 実際に使う見た目（未実装のモードは day） */
export function resolveRoomLook(mode) {
  const key = mode && ROOM1_LOOKS[mode] ? mode : 'day';
  return { key, look: ROOM1_LOOKS[key], requested: mode ?? 'day', fallback: key !== (mode ?? 'day') };
}
