/**
 * interior/shiplayout.js — 【v16】FOREST SCHOOL の船の船内（Upper Deck）の配置
 * ---------------------------------------------------------------------------
 * 座標は列車（layout.js）と同じ約束（メートル）。
 *   X … 船の長手方向。船は -X へ進む（-X = 船首、+X = 船尾）
 *   Z … 幅方向。z = 0 が右舷（starboard）の外壁の内面、+Z が左舷（port）。-X を向くと左手が +Z
 *   Y … 上（床 = 0）。海面は y ≈ -10 m
 *
 * 見取り図（添付）どおり：
 *
 *   ← 船首(-X)                                                                  船尾(+X) →
 *        [VR バルコニー]   [R1 バルコニー]   [R2 バルコニー]                           右舷 (z < 0)
 *   ┌──────────────┐┌──── Room 1 ────┐┌──── Room 2 ────┐┌▤┐┌──── Dining & Lounge ────┐┌ Aft Observation ┐
 *   │  View Room   │└──────🚪──────┘└──────🚪──────┘└階┘│                        ││  Deck（屋外）    │
 *   │              ═══════════════ Corridor ══════════════🚪  ホログラム・食堂・ラウンジ 🚪  手すり・wake  │
 *   │              │┌──────🚪──────┐┌──────🚪──────┐     │                        ││                │
 *   └──────────────┘└──── Room 3 ────┘└──── Room 4 ────┘     └────────────────────────┘└────────────────┘
 *        [VR バルコニー]   [R3 バルコニー]   [R4 バルコニー]                           左舷 (z > 8.14)
 *
 *   Room 1：リンさん（ひざ掛け）・ベッド 2　Room 2：赤ちゃん猿・リス・ベッド 2
 *   Room 3：犬・猫・ウサギ・ベッド 3　　　　Room 4：アヒル・仔馬・赤ちゃん虎・ベッド 3
 *   各 Room：シャワー室・トイレ（扉だけ。入れない）・収納・小さなテーブル・バルコニー（ガラス戸から出られる）
 *   階段（▤）：廊下の後端の右舷側から Lower Deck へ降りる。チェーンで閉鎖（入れない）
 */

export const SH = 2.7; // 天井高
export const SW = 0.12; // 壁の厚さ
export const BEAM = 8.14; // 右舷の外壁の内面（z = 0）〜左舷の外壁の内面
export const WATER_Y = -10; // 海面の高さ（甲板 = 0）

/** 船室の共通寸法（ローカル：u = 船首側の壁から船尾へ、w = 外壁（バルコニー側）から廊下へ） */
export const CABIN = { len: 5.25, depth: 3.2 };
export const SCORR = { x0: -5.25, x1: 6.6, z0: 3.32, z1: 4.82 }; // 中央の廊下
export const SVIEW = { x0: -10.6, x1: -5.37, z0: 0, z1: BEAM, arch: { z0: 3.32, z1: 4.82, h: 2.25 } };
export const SLOUNGE = { x0: 6.72, x1: 14.6, z0: 0, z1: BEAM };
export const SAFT = { x0: 14.72, x1: 20.0, z0: -1.55, z1: BEAM + 1.55 }; // 屋外。船の全幅（手すりは外板の縁）
export const SSTAIR = { x0: 5.49, x1: 6.6, z0: 2.2, z1: SCORR.z0, steps: 5, run: 0.22, rise: 0.22 };
/** バルコニーの奥行き（外壁の外面から手すりまで）と船の左右の外板 */
export const BALC = { depth: 1.4, inset: 0.525 };
export const HULL = { z0: -1.75, z1: BEAM + 1.75, bow: -24, stern: 20.25 };

/**
 * 船室。side：-1 = 右舷（外壁 z = 0、廊下側 z = 3.2）、+1 = 左舷（外壁 z = 8.14、廊下側 z = 4.94）
 * beds：ベッドの数。bench：リンさん用（Room 1・2 はベッド C の場所にベンチ）
 */
export const CABINS = [
  { id: 'room1', label: 'Room 1', x0: -5.25, side: -1, beds: 2, seed: 101 },
  { id: 'room2', label: 'Room 2', x0: 0.12, side: -1, beds: 2, seed: 202 },
  { id: 'room3', label: 'Room 3', x0: -5.25, side: 1, beds: 3, seed: 303 },
  { id: 'room4', label: 'Room 4', x0: 0.12, side: 1, beds: 3, seed: 404, roomy: true },
];

/** 船室のローカル (u, w) → ワールド (x, z) */
export function cabinXZ(c, u, w) {
  return { x: c.x0 + u, z: c.side < 0 ? w : BEAM - w };
}
/** ローカルの範囲 → ワールドの範囲 [x0, x1, z0, z1] */
export function cabinRect(c, u0, u1, w0, w1) {
  const a = cabinXZ(c, u0, w0);
  const b = cabinXZ(c, u1, w1);
  return [Math.min(a.x, b.x), Math.max(a.x, b.x), Math.min(a.z, b.z), Math.max(a.z, b.z)];
}
/** ローカルの向き（u 方向 = +X、w 方向 = 廊下へ）→ facing（0 = -Z、+π/2 = -X） */
export function cabinFacing(c, du, dw) {
  const dz = c.side < 0 ? dw : -dw;
  return Math.atan2(-du, -dz);
}

/** 船室の中の寸法（ローカル） */
export const CAB = {
  bedA: { u0: 0.08, u1: 1.9, w0: 0.3, w1: 1.25 },
  bedB: { u0: 0.08, u1: 1.9, w0: 1.65, w1: 2.6 },
  bedC: { u0: 2.1, u1: 3.02, w0: 1.3, w1: 3.13 },
  bench: { u0: 2.0, u1: 3.02 }, // ベンチ（背は廊下側の壁 w = 3.2）
  bath: { u0: 4.05, w0: 0.95, wSplit: 2.08 }, // シャワー室（w 0.95〜2.05）・トイレ（w 2.1〜3.2）
  wardrobe: { u0: 4.55, u1: 5.2, w0: 0.08, w1: 0.82 },
  door: { u0: 3.08, u1: 3.88, h: 2.05, slide: 0.86 }, // 廊下からの引き戸
  balcDoor: { u0: 3.06, u1: 3.9, h: 2.2, slide: 0.82 }, // バルコニーへのガラス戸
  glass: { u0: 0.32, u1: 2.92, y0: 0.42, y1: 2.42 }, // バルコニー側の大きなガラス
  table: { u: 2.5, w: 0.5, r: 0.26 },
};

/** 歩けるゾーン（HUD の表示名・カメラの天井・照明・見える区画の切替） */
const flat = (h) => () => h;
export const SHIP_ZONES = [
  { id: 'viewroom', label: 'View Room', x0: SVIEW.x0, x1: SVIEW.x1 + 0.06, z0: 0, z1: BEAM, ceil: flat(SH) },
  { id: 'vrbalc', label: 'View Room Balcony', x0: SVIEW.x0, x1: SVIEW.x1, z0: -SW - BALC.depth - 0.2, z1: -0.06, ceil: flat(SH) },
  { id: 'vrbalc', label: 'View Room Balcony', x0: SVIEW.x0, x1: SVIEW.x1, z0: BEAM + 0.06, z1: BEAM + SW + BALC.depth + 0.2, ceil: flat(SH) },
  ...CABINS.flatMap((c) => {
    const [x0, x1, z0, z1] = cabinRect(c, 0, CABIN.len, 0, CABIN.depth);
    const [bx0, bx1, bz0, bz1] = cabinRect(c, BALC.inset, CABIN.len - BALC.inset, -SW - BALC.depth - 0.2, -0.06);
    return [
      { id: c.id, label: c.label, x0, x1, z0, z1, ceil: flat(SH) },
      { id: `${c.id}b`, label: `${c.label} Balcony`, x0: bx0, x1: bx1, z0: bz0, z1: bz1, ceil: flat(SH) },
    ];
  }),
  { id: 'corridor', label: 'Corridor', x0: SCORR.x0, x1: SCORR.x1 + 0.06, z0: SCORR.z0 - 0.12, z1: SCORR.z1 + 0.12, ceil: flat(SH) },
  { id: 'lounge', label: 'Dining & Lounge', x0: SLOUNGE.x0 - 0.06, x1: SLOUNGE.x1 + 0.06, z0: 0, z1: BEAM, ceil: flat(SH) },
  { id: 'aft', label: 'Aft Observation Deck', x0: SAFT.x0, x1: SAFT.x1 + 0.4, z0: SAFT.z0 - 0.3, z1: SAFT.z1 + 0.3, ceil: flat(4.2) },
];

export function shipZoneAt(x, z) {
  for (const zn of SHIP_ZONES) if (x >= zn.x0 && x <= zn.x1 && z >= zn.z0 && z <= zn.z1) return zn;
  let best = SHIP_ZONES[0];
  let bd = Infinity;
  for (const zn of SHIP_ZONES) {
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

/** 現在地メニュー（バルコニーは独立の項目にしない。各 Room から歩いて出る） */
export const SHIP_MENU = ['viewroom', 'room1', 'room2', 'room3', 'room4', 'corridor', 'lounge', 'aft'].map((id) => SHIP_ZONES.find((z) => z.id === id));

/** 乗船したときの出発点（View Room の中央。船首の方を向く） */
export const SHIP_SPAWN = { x: -6.6, z: BEAM / 2, heading: Math.PI / 2 };

const cab = (i) => CABINS[i];
const jp = (c, u, w, lu, lw, pitch) => {
  const p = cabinXZ(c, u, w);
  const l = cabinXZ(c, lu, lw);
  return { x: p.x, z: p.z, lookX: l.x, lookZ: l.z, pitch };
};
/** 現在地メニューから瞬時に移動する先 */
export const SHIP_JUMP = {
  viewroom: { x: -9.25, z: BEAM / 2, lookX: -14, lookZ: BEAM / 2, pitch: -6 },
  room1: jp(cab(0), 2.05, 1.32, 2.51, 2.82, -20), // ベッドの足元から、ベンチに座るリンさんの方へ
  room2: jp(cab(1), 3.45, 0.75, 0.5, 2.2, -18), // バルコニーのガラス戸の前から、ベッド 2 台（赤ちゃん猿・リス）の方へ
  room3: jp(cab(2), 3.45, 0.75, 0.5, 2.2, -18), // 同じく、ベッド 3 台（犬・猫・ウサギ）の方へ
  room4: jp(cab(3), 3.45, 0.75, 0.5, 2.2, -18), // 同じく、ベッド 3 台（アヒル・赤ちゃん虎・仔馬）の方へ
  corridor: { x: -3.6, z: (SCORR.z0 + SCORR.z1) / 2, lookX: 6, lookZ: (SCORR.z0 + SCORR.z1) / 2 },
  lounge: { x: 10.4, z: 2.75, lookX: 10.4, lookZ: 0.6, pitch: -3 }, // ホログラムの前
  aft: { x: 19.2, z: BEAM / 2, lookX: 40, lookZ: BEAM / 2, pitch: -26 }, // 船尾の手すりの手前。見下ろすと航跡
};

/** ホログラム投影機（Dining & Lounge の右舷側、2 つの食卓の間） */
export const SHIP_HOLO = { x: 10.4, z: 0.62 };

/** 乗れない扉（シャワー室・トイレ・Lower Deck の階段） */
export const SHIP_NOTES = {
  shower: 'シャワー室です。（中には入れません）',
  wc: 'トイレです。（中には入れません）',
  stair: 'この先は Lower Deck（乗務員区画）です。乗務員以外は立ち入れません。',
};
