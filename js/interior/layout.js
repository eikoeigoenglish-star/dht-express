/**
 * interior/layout.js — 【v12】FOREST SCHOOL EXPRESS 車内の配置（寸法・部屋・ゾーン）
 * ---------------------------------------------------------------------------
 * 座標（メートル。MAP の km とは無関係）
 *   X … 列車の長手方向。列車は -X へ進む（-X = 先頭、+X = 最後部）
 *   Z … 車体の幅方向。z = 0 が右舷（starboard）側の車窓、+Z 側が左舷（port side）
 *       ※ -X を向くと左手が +Z。廊下は左舷側（z = 3.1〜4.3）を通る
 *   Y … 上（床 = 0）
 *
 *   ← 先頭(-X)                                                              最後部(+X) →
 *   ┌CREW┐┌──Room 1──┐┌──Room 2──┐┌──Room 3──┐┌(配膳室)┐┌──── Dining & Lounge ────┐
 *   │ROOM││ リンさん ││  4 匹    ││ (空き)   ││        ││ 大テーブル 6 席 ラウンジ 4 席│
 *   └────┘└───🚪───┘└───🚪───┘└───🚪───┘└────────┘│ ホログラム  カウンター   │パノラマ
 *   ═══════════════════ 廊下（左舷側）══════════════════🚪 ← 入口（左舷・先頭側）   │ 車窓
 *                                                          └──────────────────────────┘
 *
 * Room 2 は v11 の「Room 1」をそのまま（座標も同じ x = -2.1〜+2.1）。
 */

export const H = 2.6; // 個室・廊下の天井高
export const WALL = 0.12; // 壁の厚さ

/** 個室の共通寸法（cx = 部屋の中心 x からの相対） */
export const COMP = {
  hw: 2.1, // 半幅（x 方向）
  depth: 3.0, // z = 0〜3.0
  pitch: 4.32, // 部屋の間隔（4.2 + 壁 0.12）
};
export const WIN = { rx0: -1.3, rx1: 1.3, y0: 0.92, y1: 2.12 }; // 個室の車窓（cx 相対）
export const DOOR = { rx0: 0.15, rx1: 1.05, h: 2.05, slide: 0.98 }; // 個室の引き戸（cx 相対）。+X へスライド
export const BENCH = { x0: 1.42, x1: 2.1, z1: 1.98, seatTop: 0.5 }; // 左右対称（cx 相対、左は反転）
export const TABLE = { hx: 0.56, z1: 0.86, top: 0.76 };

/** 個室の一覧（住人は characters.js の ROOM_CHARACTERS[id]） */
export const COMPARTMENTS = [
  { id: 'room1', label: 'Room 1', cx: -COMP.pitch, seed: 11 },
  { id: 'room2', label: 'Room 2', cx: 0, seed: 2024 },
  { id: 'room3', label: 'Room 3', cx: COMP.pitch, seed: 37 },
];

export const CORRIDOR = { x0: -8, x1: 9.0, z0: 3.1, z1: 4.3 };

/** Dining & Lounge（最後部の車両。車体の全幅） */
export const LOUNGE = {
  x0: 9.12, // 前の壁（x = 9.0〜9.12）の内面
  x1: 21.12, // 最後部の壁の内面
  z0: 0,
  z1: 4.3,
  wallTop: 2.35, // 側壁の上端（ここから丸い天井）
  crown: 2.98, // 天井の頂
};
/** 入口：前の壁の左舷側（廊下の突き当たり）。ラウンジ側の面を -Z へスライド */
export const LOUNGE_DOOR = { z0: 3.25, z1: 4.15, h: 2.05, slide: 0.98 };

/** ラウンジの丸い天井の高さ（z の関数） */
export function loungeCeil(z) {
  // 円筒の一部（lounge.js の天井と同じ円）
  const zc = (LOUNGE.z0 + LOUNGE.z1) / 2;
  const chord = LOUNGE.z1 - LOUNGE.z0 + 2 * WALL;
  const s = LOUNGE.crown - LOUNGE.wallTop;
  const R = (chord * chord) / 4 / (2 * s) + s / 2;
  const dz = Math.min(chord / 2, Math.abs(z - zc));
  return LOUNGE.crown - R + Math.sqrt(R * R - dz * dz);
}

/** 歩けるゾーン（HUD の表示名・カメラの天井・照明の切替に使う） */
export const ZONES = [
  ...COMPARTMENTS.map((c) => ({ id: c.id, label: c.label, x0: c.cx - COMP.hw, x1: c.cx + COMP.hw, z0: 0, z1: COMP.depth, ceil: () => H })),
  { id: 'corridor', label: 'Corridor', x0: CORRIDOR.x0, x1: CORRIDOR.x1, z0: CORRIDOR.z0 - 0.12, z1: CORRIDOR.z1, ceil: () => H },
  { id: 'lounge', label: 'Dining & Lounge', x0: LOUNGE.x0 - 0.13, x1: LOUNGE.x1, z0: LOUNGE.z0, z1: LOUNGE.z1, ceil: loungeCeil },
];

export function zoneAt(x, z) {
  for (const zn of ZONES) if (x >= zn.x0 && x <= zn.x1 && z >= zn.z0 && z <= zn.z1) return zn;
  // 境目（扉の敷居など）：いちばん近いゾーン
  let best = ZONES[0];
  let bd = Infinity;
  for (const zn of ZONES) {
    const dx = Math.max(zn.x0 - x, 0, x - zn.x1);
    const dz = Math.max(zn.z0 - z, 0, z - zn.z1);
    const d = dx * dx + dz * dz;
    if (d < bd) {
      bd = d;
      best = zn;
    }
  }
  return best;
}

/** 廊下の入れない扉（先頭側の乗務員室） */
export const CREW_DOOR = { id: 'crew', label: 'CREW ROOM', note: '乗務員室です。関係者以外は入れません。' };

/** 乗車したときの出発点（Room 2 の扉の前） */
export const SPAWN = { x: 0.6, z: 1.75, heading: 0 };

/**
 * 【v14】左上の現在地メニューから瞬時に移動する先（葉っぱの位置と、見る方向の点）
 *   id は ZONES の id。heading は (lookX, lookZ) を向く向きとして train.js が計算する。pitch は視線の上下 [度]（省略 = 既定の -14°）
 *   Room 2 は乗車したときの出発点（SPAWN）と同じ。
 */
export const JUMP_POINTS = {
  room1: { x: COMPARTMENTS[0].cx + 0.15, z: 1.95, lookX: COMPARTMENTS[0].cx + 1.72, lookZ: 1.3 }, // リンさんの方へ
  room2: { x: SPAWN.x, z: SPAWN.z, heading: SPAWN.heading },
  room3: { x: COMPARTMENTS[2].cx + 0.9, z: 2.25, lookX: COMPARTMENTS[2].cx - 0.9, lookZ: 1.0 }, // 扉から入ったところ。本棚の前の仔馬・窓側の猫の方へ
  corridor: { x: 0.6, z: (CORRIDOR.z0 + CORRIDOR.z1) / 2, lookX: CORRIDOR.x1, lookZ: (CORRIDOR.z0 + CORRIDOR.z1) / 2 }, // ラウンジの方へ
  lounge: { x: 10.75, z: 2.6, lookX: 10.75, lookZ: 0.6, pitch: -3 }, // ホログラム投影機の前。1.4 倍の像の上端まで入るよう視線は水平に近く
};
