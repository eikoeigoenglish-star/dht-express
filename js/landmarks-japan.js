/**
 * landmarks-japan.js — 【v8】全国ランドマーク（東京・神奈川・千葉以外、北緯 37°40′23″ 以南）と灯台 13 件のモデル
 * ---------------------------------------------------------------------------
 * 1 件ずつ専用モデルを書く代わりに、「城」「神社」「寺・塔」「像」「塔」「滝」「峡谷」「庭園」「町並み」「海岸の岩」
 * 「山頂の目印」「建物」「空港」「橋」などの**パラメータ付きビルダー**を用意し、data/landmarks-v8.json の各件が
 * kind（ビルダー名）と p（寸法・色・本数など）を指定する。シルエット・色・高さ・配置で「あそこだ」と分かることを優先。
 *
 * ・座標・単位・LOD・ラベル・建物除外は既存の LandmarkSystem（landmarks.js）と同じ（1 件 = draw call 1、
 *   完全形 / 簡略形（小部品を省く）/ 非表示の 3 段）。
 * ・寸法は実物の m × 倍率 s（既定 0.005 km/m ＝ 5 倍。像・塔は高さを強調、面積型はほぼ実寸）。
 * ・外部モデル・テクスチャ・商標ロゴ・キャラクターは使っていない（境港は街区、ハウステンボスは欧風の街区として表現）。
 */
import * as THREE from 'three';
import { GeoBuilder, mulberry32 } from './meshkit.js';
import { KANTO_COLORS as K, drape, skirt, pad, ringE, cylE, dome, ball, drapePath, trees, wheel, pagodaK, torii, footY, ellipse, rect } from './landmarks-kanto.js';

const C = {
  ...K,
  plaster: '#f5f3ec', blackWall: '#2b2b2e', roofCopper: '#5c9a86', roofTile: '#4f5862', thatch: '#8a7550', thatchDark: '#6f5d40',
  sandstone: '#c8b98f', granite: '#b8b2a6', rock: '#857d72', rockDark: '#5f5850', cliff: '#7c7468', moss: '#5f7a45',
  pine: '#2f5a33', plum: '#d98aa6', red: '#c73a2a', shrineRed: '#d24a2c', whiteStone: '#ecebe6', lamp: '#fff2c4',
  sea: '#2f7f98', foam: '#f2f6f6', waterfall: '#eaf4f7', steam: '#f1f1ee', dune: '#e2cf9c', sand: '#d9c8a0', lawn: '#7fa35a',
  glassBlue: '#6f93b5', silver: '#c9ced3', brass: '#b89647', bronze: '#5d7a6c', copperGreen: '#6aa38d', limestone: '#d9d6cc',
};

const P = (ctx) => ctx.it.p ?? {};
const D2R = Math.PI / 180;

/* ====================================================================== */
/* 共通部品                                                                */
/* ====================================================================== */

/** 天守（層ごとに縮む白壁／黒壁と寄棟屋根、千鳥破風、金の鯱）。戻り値は頂部 Y */
function keep(b, x, y0, z, s, o) {
  const tiers = o.tiers ?? 4;
  const base = o.base ?? 22;
  const stoneH = o.stoneH ?? 9;
  b.hip(base * 1.32 * s, base * 1.18 * s, stoneH * s, 0.86, o.stone ?? C.stone, x, y0, z);
  let y = y0 + stoneH * s;
  let w = base;
  for (let i = 0; i < tiers; i++) {
    const last = i === tiers - 1;
    const h = (last ? 5.5 : 4.6) + w * 0.06;
    b.box(w * s, h * s, w * 0.82 * s, o.wall ?? C.plaster, x, y, z);
    if (o.wall2) b.box(w * 1.01 * s, h * 0.45 * s, w * 0.83 * s, o.wall2, x, y, z);
    y += h * s;
    const rh = (last ? 5.2 : 2.6) * s;
    b.hip((w + 5) * s, (w * 0.82 + 5) * s, rh, last ? 0.2 : 0.62, o.roof ?? C.roofTile, x, y, z);
    if (!last && i > 0 && o.gables !== false) b.gable(w * 0.45 * s, 2.5 * s, rh * 1.7, o.roof ?? C.roofTile, x, y, z - (w * 0.41 + 2) * s, 0);
    y += last ? rh : rh * 0.5;
    w *= o.shrink ?? 0.78;
  }
  if (o.gold) for (const sx of [-1, 1]) b.box(1.4 * s, 3.2 * s, 1.1 * s, C.gold, x + sx * w * 0.35 * s, y - 1.1 * s, z);
  return y;
}

/** 寄棟・入母屋風の和風建築（壁 + 大屋根） */
function hall(b, x, y, z, w, d, h, wall, roof, s, ry = 0, roofH = 0.55, top = 0.35) {
  b.box(w * s, h * s, d * s, wall, x, y, z, ry);
  b.hip((w + 6) * s, (d + 6) * s, Math.max(w, d) * roofH * s, top, roof, x, y + h * s, z, ry);
  return y + (h + Math.max(w, d) * roofH) * s;
}

/** 針葉樹（松・杉）の簡易形 */
function pineTree(b, x, y, z, h, col = C.pine) {
  b.cyl(h * 0.03, h * 0.04, h * 0.35, 5, C.wood, x, y, z);
  b.cyl(0, h * 0.28, h * 0.75, 7, col, x, y + h * 0.25, z);
}

/** 白い湯気・煙（球を縦に重ねる） */
function plume(b, x, y, z, r, n, seed = 1) {
  const rng = mulberry32(seed);
  for (let i = 0; i < n; i++) ball(b, r * (0.7 + i * 0.25), C.steam, x + (rng() - 0.5) * r, y + r * (0.6 + i * 1.3), z + (rng() - 0.5) * r, 8, 0.85);
}

/**
 * 岬の先端・埋立地など、1km 格子の地形では海になってしまう場所の足元：海面より低ければ岩と草の基盤を置き、その上面を返す
 */
function landY(b, ctx, r, y) {
  if (y > ctx.sea + 0.004) return y;
  const top = ctx.sea + 0.018;
  b.cyl(r * 0.92, r * 1.15, top - (ctx.sea - 0.06), 12, C.rock, 0, ctx.sea - 0.06, 0);
  b.cyl(r * 0.9, r * 0.92, 0.004, 12, C.moss, 0, top, 0);
  return top + 0.004;
}

/** 地表に沿った円形の面 */
const disc = (b, ctx, r, col, off = 0.012, cx = 0, cz = 0, rz = r) => drape(b, ctx, ellipse(cx, cz, r, rz, 18), col, { off, step: Math.max(0.03, r / 3) });

/* ====================================================================== */
/* 城                                                                      */
/* ====================================================================== */

/** 天守のある城（白壁 / 黒壁、層数、石垣、堀、櫓） */
function castle(b, ctx) {
  const p = P(ctx);
  const s = p.s ?? 0.0058;
  const y = footY(ctx, 0, 0, 0.06);
  if (p.moat) {
    const r = p.moat;
    drape(b, ctx, ellipse(0, 0, r, r * 0.85, 20), C.moat, { off: 0.006, step: r / 4 });
    drape(b, ctx, rect(0, 0, 0, r * 1.25, r * 1.05), C.lawn, { off: 0.01, step: r / 4 });
  }
  const yk = landY(b, ctx, (p.base ?? 22) * s * 1.1, y);
  const top = keep(b, 0, yk, 0, s, p);
  // 付属の小天守・櫓
  for (let i = 0; i < (p.yagura ?? 0); i++) {
    const a = (i / (p.yagura ?? 1)) * Math.PI * 2 + 0.6;
    const r = (p.base ?? 22) * s * 1.8;
    keep(b, Math.cos(a) * r, y, Math.sin(a) * r, s * 0.55, { tiers: 2, base: 14, stoneH: 5, wall: p.wall, roof: p.roof, gables: false });
  }
  return { height: top - y + 0.02 };
}

/** 石垣だけの城跡（段々の石垣と草地。竹田城・安土城など） */
function castleRuins(b, ctx) {
  const p = P(ctx);
  const y = footY(ctx, 0, 0, 0.08);
  const L = p.L ?? 0.36;
  const n = p.levels ?? 3;
  for (let i = 0; i < n; i++) {
    const w = L * (1 - i * 0.22);
    const h = 0.016 + i * 0.002;
    b.box(w, h, w * 0.42, C.stone, 0, y + i * 0.016, -i * 0.02);
    b.box(w * 0.96, 0.003, w * 0.4, C.lawn, 0, y + i * 0.016 + h, -i * 0.02);
  }
  if (p.stairs) for (let k = 0; k < 6; k++) b.box(0.012, 0.004, 0.02, C.stone, 0, y + k * 0.006, L * 0.25 + k * 0.02);
  return { height: n * 0.018 + 0.03 };
}

/* ====================================================================== */
/* 神社・寺                                                                 */
/* ====================================================================== */

/** 神社：本殿・拝殿・鳥居（朱塗り or 白木）、社叢の森 */
function shrine(b, ctx) {
  const p = P(ctx);
  const s = p.s ?? 0.005;
  const red = p.plain ? C.wood : C.shrineRed;
  const roof = p.roof ?? (p.plain ? C.thatchDark : C.roofCopper);
  const y = landY(b, ctx, 0.09 * (p.size ?? 1), footY(ctx, 0, 0, 0.05));
  drape(b, ctx, rect(0, 0.02, 0, 0.26 * (p.size ?? 1), 0.18 * (p.size ?? 1)), C.gravel, { off: 0.008, step: 0.06 });
  const k = p.size ?? 1;
  hall(b, 0, y, -0.04 * k, 22 * k, 16 * k, 8 * k, red, roof, s, 0, p.tall ? 0.95 : 0.5, p.plain ? 0.08 : 0.3);
  hall(b, 0, y, 0.035 * k, 26 * k, 12 * k, 6 * k, red, roof, s);
  if (p.chigi) for (const sz of [-1, 1]) b.box(1 * s, 6 * s, 1 * s, C.wood, 0, y + (8 + 22 * 0.95) * k * s, -0.04 * k + sz * 9 * k * s);
  const tw = (p.torii ?? 24) * s;
  torii(b, 0, footY(ctx, 0, 0.13 * k), 0.13 * k, tw, tw * 0.75, p.toriiColor ?? red, 0, p.plain ? C.wood : C.black);
  if (p.forest) trees(b, ctx, ellipse(0, -0.02, 0.24 * k, 0.2 * k, 12), Math.round(14 * k), 7 + k * 3, { r: 0.022, h: 0.06, avoid: (x, z) => Math.abs(x) < 0.09 * k && Math.abs(z) < 0.16 * k });
  if (p.pagoda) pagodaK(b, -0.1 * k, y, 0.02, s, 3, 7, 6, red, C.roofDark);
  return { height: (8 + 26 * (p.tall ? 0.95 : 0.5)) * k * s + 0.02 };
}

/** 大鳥居だけ（湖・海の中に立つものも） */
function bigTorii(b, ctx) {
  const p = P(ctx);
  const s = p.s ?? 0.006;
  const y = p.water ? ctx.sea - 0.01 : footY(ctx, 0, 0, 0.03);
  const w = (p.w ?? 22) * s;
  torii(b, 0, y, 0, w, w * 0.78, p.color ?? C.shrineRed, 0);
  if (p.island) {
    drape(b, ctx, ellipse(0.06, -0.05, 0.05, 0.04, 10), C.sand, { h: () => ctx.sea + 0.006, step: 0.03 });
    b.cyl(0.03, 0.045, 0.02, 10, C.rock, 0.06, ctx.sea - 0.01, -0.05);
    pineTree(b, 0.06, ctx.sea + 0.01, -0.05, 0.06);
  }
  return { height: w * 0.85 };
}

/** 寺：本堂の大屋根、塔（任意）、山門 */
function temple(b, ctx) {
  const p = P(ctx);
  const s = p.s ?? 0.005;
  const k = p.size ?? 1;
  const y = footY(ctx, 0, 0, 0.06);
  drape(b, ctx, rect(0, 0.03, 0, 0.3 * k, 0.24 * k), C.gravel, { off: 0.008, step: 0.06 });
  const wall = p.wall ?? (p.red ? C.vermilion : C.wood);
  const roof = p.roof ?? C.roofTile;
  let top = hall(b, 0, y, -0.04 * k, 34 * k, 24 * k, 12 * k, wall, roof, s, 0, 0.42, 0.3);
  if (p.twoStory) top = hall(b, 0, top - 4 * s, -0.04 * k, 24 * k, 16 * k, 6 * k, wall, roof, s);
  hall(b, 0, y, 0.11 * k, 16 * k, 8 * k, 7 * k, wall, roof, s); // 山門
  if (p.pagoda) top = Math.max(top, pagodaK(b, p.pagoda * 0.12 * k, y, 0.04 * k, s * 1.2, p.tiers ?? 5, 9, 6.2, p.red ? C.vermilion : C.wood, C.roofDark));
  if (p.gold) b.box(4 * s, 3 * s, 2 * s, C.gold, 0, top - 1 * s, -0.04 * k);
  if (p.forest) trees(b, ctx, ellipse(0, 0, 0.3 * k, 0.26 * k, 12), 16, 31, { avoid: (x, z) => Math.abs(x) < 0.17 * k && Math.abs(z) < 0.17 * k });
  return { height: top - y + 0.02 };
}

/** 五重塔など単独の塔 */
function pagoda(b, ctx) {
  const p = P(ctx);
  const s = p.s ?? 0.0075;
  const y = footY(ctx, 0, 0, 0.03);
  const top = pagodaK(b, 0, y, 0, s, p.tiers ?? 5, p.base ?? 10, p.tierH ?? 6.4, p.wall ?? C.wood, p.roof ?? C.roofDark);
  if (p.hall) hall(b, 0.09, y, 0.04, 26, 18, 9, p.wall ?? C.wood, C.roofTile, 0.005);
  if (p.trees) trees(b, ctx, ellipse(0, 0, 0.14, 0.14, 10), 8, 5, { avoid: (x, z) => Math.hypot(x, z) < 0.06 });
  return { height: top - y };
}

/** 清水寺：崖にせり出した舞台（懸造）と三重塔 */
function kiyomizu(b, ctx) {
  const s = 0.006;
  const y = footY(ctx, 0, -0.04, 0.04);
  hall(b, 0, y, -0.05, 36, 30, 12, C.wood, C.cypress, s, 0, 0.4, 0.3);
  // 舞台と柱
  const yd = y + 0.012;
  b.box(0.2, 0.008, 0.1, C.wood, 0, yd, 0.06);
  for (let i = -3; i <= 3; i++) for (const zz of [0.02, 0.06, 0.1]) {
    const g = ctx.ground(i * 0.03, zz);
    b.box(0.006, yd - g, 0.006, C.cypress, i * 0.03, g, zz);
  }
  pagodaK(b, 0.14, footY(ctx, 0.14, -0.05), -0.05, s, 3, 8, 6, C.vermilion, C.roofDark);
  hall(b, -0.13, footY(ctx, -0.13, 0.1), 0.1, 14, 8, 8, C.vermilion, C.roofDark, s); // 仁王門
  trees(b, ctx, ellipse(0, 0, 0.3, 0.26, 12), 18, 3, { avoid: (x, z) => Math.abs(x) < 0.17 && Math.abs(z) < 0.14 });
  return { height: 0.16 };
}

/** 伏見稲荷：山へ続く千本鳥居の列と本殿 */
function fushimiInari(b, ctx) {
  const s = 0.005;
  const y = footY(ctx, 0, 0.1, 0.04);
  hall(b, 0, y, 0.1, 24, 14, 8, C.shrineRed, C.roofCopper, s);
  torii(b, 0, footY(ctx, 0, 0.2), 0.2, 0.13, 0.1, C.shrineRed);
  for (const off of [-0.012, 0.012])
    for (let i = 0; i < 26; i++) {
      const t = i / 25;
      const x = off + Math.sin(t * 3) * 0.04;
      const z = 0.04 - t * 0.32;
      torii(b, x, ctx.ground(x, z) - 0.002, z, 0.018, 0.022, C.shrineRed, 0.2);
    }
  trees(b, ctx, ellipse(0, -0.15, 0.2, 0.24, 12), 16, 9, { avoid: (x, z) => Math.abs(x) < 0.06 });
  return { height: 0.1 };
}

/** 平等院鳳凰堂：池に映る左右対称の朱の堂（中堂 + 翼廊） */
function byodoin(b, ctx) {
  const s = 0.006;
  const y = footY(ctx, 0, 0, 0.05);
  drape(b, ctx, ellipse(0, 0.06, 0.2, 0.08, 18), C.pond, { off: 0.006, step: 0.04 });
  hall(b, 0, y, -0.02, 14, 12, 8, C.vermilion, C.roofDark, s, 0, 0.6, 0.25);
  for (const sx of [-1, 1]) {
    b.box(26 * s, 6 * s, 4 * s, C.vermilion, sx * 0.1, y, -0.02);
    b.hip(28 * s, 7 * s, 3 * s, 0.3, C.roofDark, sx * 0.1, y + 6 * s, -0.02);
    b.box(4 * s, 10 * s, 4 * s, C.vermilion, sx * 0.17, y, -0.02);
    b.hip(7 * s, 7 * s, 4 * s, 0.1, C.roofDark, sx * 0.17, y + 10 * s, -0.02);
  }
  for (const sx of [-1, 1]) b.box(1.2 * s, 2.2 * s, 0.8 * s, C.gold, sx * 2.5 * s, y + 17 * s, -0.02);
  return { height: 0.13 };
}

/** 出雲大社：高い大社造の本殿と巨大な注連縄 */
function izumoTaisha(b, ctx) {
  const s = 0.006;
  const y = footY(ctx, 0, 0, 0.06);
  drape(b, ctx, rect(0, 0.03, 0, 0.32, 0.24), C.gravel, { off: 0.008, step: 0.06 });
  b.box(13 * s, 16 * s, 13 * s, C.wood, 0, y, -0.06);
  b.gable(17 * s, 17 * s, 10 * s, C.thatchDark, 0, y + 16 * s, -0.06, Math.PI / 2);
  for (const sz of [-1, 1]) b.box(1 * s, 6 * s, 1 * s, C.wood, 0, y + 24 * s, -0.06 + sz * 8 * s);
  hall(b, 0, y, 0.05, 22, 14, 7, C.wood, C.thatchDark, s); // 神楽殿
  b.cyl(2.2 * s, 2.2 * s, 13 * s, 10, '#d9c27a', 0, y + 6 * s, 0.05 - 9 * s, 0); // 注連縄（横向き）
  torii(b, 0, footY(ctx, 0, 0.17), 0.17, 0.14, 0.11, '#7d7a73');
  trees(b, ctx, ellipse(0, -0.02, 0.3, 0.24, 12), 16, 4, { avoid: (x, z) => Math.abs(x) < 0.1 && Math.abs(z) < 0.18 });
  return { height: 0.17 };
}

/** 伊勢神宮：森に囲まれた白木の唯一神明造（茅葺・千木・鰹木） */
function iseJingu(b, ctx) {
  const s = 0.006;
  const y = footY(ctx, 0, 0, 0.06);
  drape(b, ctx, rect(0, 0, 0, 0.16, 0.2), C.gravel, { off: 0.008, step: 0.05 });
  for (const zz of [-0.03, 0.04]) {
    b.box(10 * s, 6 * s, 6 * s, '#d8c7a4', 0, y + 2 * s, zz);
    b.gable(9 * s, 13 * s, 6 * s, C.thatch, 0, y + 8 * s, zz, Math.PI / 2);
    for (const sx of [-1, 1]) b.box(0.7 * s, 5 * s, 0.7 * s, C.gold, sx * 5 * s, y + 12 * s, zz);
  }
  b.box(0.18, 0.006, 0.006, '#d8c7a4', 0, y, 0.11); // 板垣
  torii(b, 0, footY(ctx, 0, 0.16), 0.16, 0.1, 0.08, '#d8c7a4', 0, '#d8c7a4');
  trees(b, ctx, ellipse(0, 0, 0.34, 0.32, 14), 26, 12, { r: 0.03, h: 0.09, avoid: (x, z) => Math.abs(x) < 0.12 && Math.abs(z) < 0.2 });
  return { height: 0.12 };
}

/** 東大寺大仏殿（巨大な寄棟の堂と金の鴟尾）、中門 */
function daibutsuden(b, ctx) {
  const s = 0.006;
  const y = footY(ctx, 0, 0, 0.08);
  drape(b, ctx, rect(0, 0.06, 0, 0.36, 0.34), C.gravel, { off: 0.008, step: 0.06 });
  b.box(57 * s, 22 * s, 50 * s, C.wood, 0, y, -0.03);
  b.hip(66 * s, 58 * s, 12 * s, 0.5, C.roofTile, 0, y + 22 * s, -0.03);
  b.box(42 * s, 6 * s, 34 * s, C.wood, 0, y + 34 * s, -0.03);
  b.hip(52 * s, 44 * s, 10 * s, 0.25, C.roofTile, 0, y + 40 * s, -0.03);
  for (const sx of [-1, 1]) b.box(1.5 * s, 4 * s, 1.5 * s, C.gold, sx * 10 * s, y + 50 * s, -0.03);
  hall(b, 0, y, 0.2, 26, 10, 9, C.vermilion, C.roofTile, s); // 中門
  return { height: 54 * s + 0.01 };
}

/* ====================================================================== */
/* 像・塔                                                                  */
/* ====================================================================== */

/** 像：buddha（立像）/ kannon（白い観音）/ figure（銅像）/ seated（座像）/ moai（石像の列） */
function statue(b, ctx) {
  const p = P(ctx);
  const t = p.type ?? 'figure';
  const y = footY(ctx, 0, 0, 0.04);
  if (t === 'moai') {
    const n = p.n ?? 7;
    const s = 0.012;
    for (let i = 0; i < n; i++) {
      const x = (i - (n - 1) / 2) * 0.03;
      b.box(0.022, 0.004, 0.016, C.stone, x, y, 0);
      b.box(0.016, 0.05, 0.012, '#7d766b', x, y + 0.004, 0);
      b.box(0.018, 0.004, 0.018, '#7d766b', x, y + 0.054, 0);
      b.box(0.004, 0.02, 0.006, '#6c665d', x, y + 0.028, -0.008);
    }
    drape(b, ctx, rect(0, 0, 90, 0.26, 0.06), C.lawn, { off: 0.008, step: 0.05 });
    return { height: 0.07 + 0 * s };
  }
  const H = (p.hM ?? 20) * (p.s ?? 0.0045);
  const col = p.color ?? (t === 'kannon' ? C.whiteStone : t === 'buddha' ? '#a9a59b' : t === 'seated' ? '#ece9e0' : C.bronze);
  const ped = H * (p.ped ?? 0.18);
  b.box(H * 0.32, ped, H * 0.32, p.pedColor ?? C.granite, 0, y, 0);
  const y1 = y + ped;
  const hh = H - ped;
  if (t === 'seated') {
    b.box(hh * 0.5, hh * 0.25, hh * 0.38, col, 0, y1, 0);
    cylE(b, hh * 0.17, hh * 0.13, hh * 0.45, 0.8, 10, col, 0, y1 + hh * 0.25, 0.02 * hh);
    ball(b, hh * 0.1, col, 0, y1 + hh * 0.8, 0.02 * hh, 10);
    b.beam(hh * 0.12, y1 + hh * 0.6, 0, hh * 0.18, y1 + hh * 0.98, 0, hh * 0.06, col); // 天を指す右手
    b.beam(-hh * 0.12, y1 + hh * 0.55, 0, -hh * 0.38, y1 + hh * 0.55, 0, hh * 0.06, col); // 水平の左手
    return { height: H + 0.01 };
  }
  // 立像：裾広がりの衣（円錐台）・肩・頭
  const robe = t === 'figure' ? 0.5 : 0.72;
  if (t === 'figure') {
    for (const sx of [-1, 1]) b.box(hh * 0.07, hh * 0.45, hh * 0.08, col, sx * hh * 0.05, y1, 0);
  }
  cylE(b, hh * 0.13, hh * 0.1, hh * robe, 0.62, 10, col, 0, y1 + (t === 'figure' ? hh * 0.42 : 0), 0);
  const sh = y1 + (t === 'figure' ? hh * 0.42 : 0) + hh * robe * 0.97;
  b.box(hh * 0.22, hh * 0.05, hh * 0.1, col, 0, sh - hh * 0.04, 0);
  ball(b, hh * (t === 'figure' ? 0.07 : 0.085), col, 0, sh + hh * 0.07, 0, 10);
  if (t === 'buddha') b.cyl(hh * 0.04, hh * 0.05, hh * 0.05, 8, col, 0, sh + hh * 0.12, 0); // 肉髻
  if (t === 'kannon') ball(b, hh * 0.06, col, 0, sh + hh * 0.16, 0, 8, 1.2);
  return { height: H + 0.01 };
}

/** 塔：lattice（鉄骨・展望台付き）/ hyper（双曲面の赤い塔）/ slab（段状のガラス超高層）/ obs（展望塔）/ antenna（電波塔群） */
function tower(b, ctx) {
  const p = P(ctx);
  const t = p.type ?? 'obs';
  const y = landY(b, ctx, 0.06, footY(ctx, 0, 0, 0.04));
  const H = (p.hM ?? 100) * (p.s ?? 0.0042);
  const col = p.color ?? C.silver;
  if (t === 'lattice') {
    const w = H * 0.22;
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) b.beam(sx * w, y, sz * w, sx * w * 0.35, y + H * 0.62, sz * w * 0.35, H * 0.025, col);
    b.box(w * 0.85, H * 0.12, w * 0.85, p.cab ?? '#d9c79a', 0, y + H * 0.58, 0);
    b.cyl(w * 0.1, w * 0.2, H * 0.3, 6, col, 0, y + H * 0.7, 0);
    if (p.base) b.box(w * 2.4, H * 0.08, w * 2.4, C.concrete, 0, y, 0);
  } else if (t === 'hyper') {
    const pts = [];
    for (let i = 0; i <= 12; i++) {
      const v = i / 12;
      const r = H * 0.075 * Math.sqrt(1 + ((v - 0.55) / 0.22) ** 2) * 0.55;
      pts.push(new THREE.Vector2(r, v * H));
    }
    b.add(new THREE.LatheGeometry(pts, 16), col, GeoBuilder.mat(0, y, 0));
    b.cyl(H * 0.07, H * 0.07, H * 0.08, 14, '#f0eee8', 0, y + H * 0.8, 0);
  } else if (t === 'slab') {
    const w = H * 0.24;
    b.box(w, H * 0.42, w * 0.8, p.glass ?? C.glassBlue, 0, y, 0);
    b.box(w * 0.82, H * 0.32, w * 0.7, p.glass ?? C.glassBlue, w * 0.06, y + H * 0.42, 0);
    b.box(w * 0.6, H * 0.26, w * 0.56, p.glass ?? C.glassBlue, w * 0.12, y + H * 0.74, 0);
  } else if (t === 'antenna') {
    for (let i = 0; i < (p.n ?? 3); i++) {
      const x = (i - 1) * H * 0.35;
      b.beam(x, y, 0, x, y + H * (0.8 + 0.2 * (i % 2)), 0, H * 0.025, i % 2 ? C.red : C.white);
    }
    b.box(H * 0.3, H * 0.12, H * 0.2, C.white, 0, y, H * 0.1);
  } else {
    b.cyl(H * 0.05, H * 0.07, H * 0.85, 10, col, 0, y, 0);
    b.cyl(H * 0.14, H * 0.12, H * 0.1, 14, p.cab ?? C.glassLight, 0, y + H * 0.72, 0);
    b.cyl(0, H * 0.02, H * 0.15, 6, col, 0, y + H * 0.85, 0);
  }
  return { height: H };
}

/** 太陽の塔：白い円錐の胴、両腕、金の顔 */
function sunTower(b, ctx) {
  const y = footY(ctx, 0, 0, 0.05);
  const H = 0.24;
  disc(b, ctx, 0.16, C.lawn);
  cylE(b, H * 0.22, H * 0.18, H * 0.85, 0.45, 14, '#f3f1ea', 0, y, 0);
  for (const sx of [-1, 1]) b.beam(sx * H * 0.08, y + H * 0.5, 0, sx * H * 0.36, y + H * 0.66, 0, H * 0.07, '#f3f1ea');
  ball(b, H * 0.07, C.gold, 0, y + H * 0.92, -H * 0.02, 12);
  b.cyl(H * 0.06, H * 0.06, H * 0.01, 12, '#c43b2b', 0, y + H * 0.5, -H * 0.12);
  return { height: H };
}

/** 原爆ドーム：鉄骨のドームを載せたれんが造の残る建物（川沿い） */
function genbakuDome(b, ctx) {
  const s = 0.006;
  const y = footY(ctx, 0, 0, 0.04);
  b.box(24 * s, 11 * s, 18 * s, '#a59885', 0, y, 0);
  b.box(10 * s, 16 * s, 10 * s, '#9d907d', 0, y, 0);
  const g = new THREE.SphereGeometry(5 * s, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2);
  b.add(g, '#4b4741', GeoBuilder.mat(0, y + 16 * s, 0, 0, 0, 0, 1, 1.4, 1));
  drape(b, ctx, rect(0, 0.08, 0, 0.12, 0.08), C.lawn, { off: 0.008, step: 0.04 });
  return { height: 23 * s };
}

/* ====================================================================== */
/* 建物                                                                    */
/* ====================================================================== */

/**
 * 汎用の建物：roof = hip | gable | flat | arc | dome | wave、n 棟を間隔 gap で並べる。
 * p: w, d, h（m）, wall, roofColor, n, gap(km), s, accent（正面の色帯）
 */
function building(b, ctx) {
  const p = P(ctx);
  const s = p.s ?? 0.005;
  const n = p.n ?? 1;
  const y0 = footY(ctx, 0, 0, 0.05);
  let top = 0;
  for (let i = 0; i < n; i++) {
    const x = (i - (n - 1) / 2) * (p.gap ?? 0.1);
    const y = footY(ctx, x, 0, 0.04);
    const w = (p.w ?? 60) * s;
    const d = (p.d ?? 30) * s;
    const h = (p.h ?? 15) * s;
    const wall = p.wall ?? C.concrete;
    const rc = p.roofColor ?? C.roofDark;
    b.box(w, h, d, wall, x, y, 0);
    if (p.accent) b.box(w * 1.005, h * 0.25, d * 1.005, p.accent, x, y + h * 0.55, 0);
    const r = p.roof ?? 'flat';
    let ty = y + h;
    if (r === 'hip') {
      b.hip(w * 1.1, d * 1.15, Math.min(w, d) * 0.35, 0.3, rc, x, ty, 0);
      ty += Math.min(w, d) * 0.35;
    } else if (r === 'gable') {
      b.gable(d * 1.1, w * 1.02, d * 0.38, rc, x, ty, 0, Math.PI / 2);
      ty += d * 0.38;
    } else if (r === 'arc' || r === 'wave') {
      const g = new THREE.CylinderGeometry(d * 0.6, d * 0.6, w, 16, 1, false, 0, Math.PI);
      g.rotateZ(Math.PI / 2);
      g.rotateX(Math.PI / 2);
      b.add(g, rc, GeoBuilder.mat(x, ty, 0, 0, 0, 0, 1, r === 'wave' ? 0.45 : 0.6, 1));
      ty += d * 0.36;
      if (r === 'wave') b.box(w * 0.3, h * 0.6, d * 0.4, C.glassBlue, x + w * 0.45, y, d * 0.4);
    } else if (r === 'dome') {
      dome(b, w * 0.5, Math.min(w, d) * 0.4, d * 0.5, rc, x, ty, 0, 20, 6);
      ty += Math.min(w, d) * 0.4;
    } else if (r === 'mansard') {
      b.hip(w * 1.02, d * 1.04, h * 0.5, 0.75, rc, x, ty, 0);
      b.box(w * 0.12, h * 0.9, d * 0.3, wall, x, ty, 0);
      b.hip(w * 0.16, d * 0.36, h * 0.3, 0.1, rc, x, ty + h * 0.9, 0);
      ty += h * 1.2;
    }
    top = Math.max(top, ty - y0);
  }
  if (p.lawn) drape(b, ctx, rect(0, 0, 0, p.lawn, p.lawn * 0.7), C.lawn, { off: 0.006, step: 0.06 });
  return { height: top + 0.01 };
}

/** スタジアム・アリーナ：楕円リングのスタンドと屋根、または銀のドーム */
function stadium(b, ctx) {
  const p = P(ctx);
  const y = footY(ctx, 0, 0, 0.08);
  const rx = p.rx ?? 0.14;
  const rz = p.rz ?? 0.12;
  if (p.dome) {
    cylE(b, rx, rz, p.wallH ?? 0.03, 1, 32, C.concrete, 0, y, 0);
    dome(b, rx, p.domeH ?? 0.06, rz, p.domeColor ?? C.silver, 0, y + (p.wallH ?? 0.03), 0, 32, 8);
    return { height: (p.wallH ?? 0.03) + (p.domeH ?? 0.06) };
  }
  disc(b, ctx, rx * 0.7, '#5b8c3f', 0.01, 0, 0, rz * 0.65);
  ringE(b, rx, rz, rx * 0.3, p.h ?? 0.035, p.color ?? C.concrete, 0, y, 0, 32);
  if (p.arch) for (const sx of [-1, 1]) {
    const pts = [];
    for (let i = 0; i <= 10; i++) pts.push([sx * rx * 0.85, Math.sin((i / 10) * Math.PI) * 0.09, -rz + (i / 10) * rz * 2]);
    for (let i = 0; i < 10; i++) b.beam(pts[i][0], y + 0.03 + pts[i][1], pts[i][2], pts[i + 1][0], y + 0.03 + pts[i + 1][1], pts[i + 1][2], 0.008, C.white);
  }
  if (p.roofRing) ringE(b, rx * 1.02, rz * 1.02, rx * 0.22, 0.006, C.silver, 0, y + (p.h ?? 0.035), 0, 32);
  return { height: (p.h ?? 0.035) + (p.arch ? 0.12 : 0.01) };
}

/** 卵形の銀のドーム（恐竜博物館） */
function eggDome(b, ctx) {
  const y = footY(ctx, 0, 0, 0.06);
  dome(b, 0.07, 0.06, 0.1, C.silver, 0, y, 0, 24, 8);
  b.box(0.2, 0.025, 0.06, C.concrete, 0.04, y, 0.08);
  for (let i = 0; i < 3; i++) {
    const x = -0.12 - i * 0.04;
    b.box(0.012, 0.03, 0.035, '#6f8a47', x, y, 0.05); // 恐竜（緑の象徴的な形）
    b.beam(x, y + 0.03, 0.05 - 0.015, x, y + 0.055, 0.02, 0.008, '#6f8a47');
  }
  return { height: 0.07 };
}

/** 空港：海上の人工島または陸上の基盤、滑走路、ターミナル */
function airport(b, ctx) {
  const p = P(ctx);
  const L = p.L ?? 4.0;
  const W = p.W ?? 1.4;
  const poly = rect(0, 0, 0, W, L);
  if (p.island) pad(b, ctx, poly, C.airport, C.stoneDark, { top: 0.016, step: 0.3 });
  else drape(b, ctx, poly, C.airport, { off: 0.01, step: 0.3 });
  const yTop = (x, z) => Math.max(ctx.ground(x, z) + 0.012, ctx.sea + 0.02);
  for (let r = 0; r < (p.runways ?? 1); r++) {
    const x = W * 0.3 - r * W * 0.35;
    drape(b, ctx, rect(x, 0, 0, 0.06, L * 0.9), C.asphalt, { h: (a, c) => yTop(a, c) + 0.003, step: 0.3 });
  }
  const yt = yTop(-W * 0.3, 0);
  b.box(W * 0.22, 0.03, L * 0.3, p.terminal ?? C.silver, -W * 0.3, yt, 0);
  b.cyl(0.015, 0.02, 0.09, 8, C.concrete, -W * 0.15, yt, -L * 0.2);
  b.box(0.04, 0.02, 0.04, C.glassDark, -W * 0.15, yt + 0.09, -L * 0.2);
  return { height: 0.12 };
}

/* ====================================================================== */
/* 自然                                                                    */
/* ====================================================================== */

/** 滝：岩壁・白い落水・滝壺・しぶき */
function waterfall(b, ctx) {
  const p = P(ctx);
  const H = (p.hM ?? 100) * (p.s ?? 0.0022);
  const W = (p.wM ?? 13) * 0.004 + 0.012;
  const y = footY(ctx, 0, 0, 0.04);
  b.box(W * 4, H * 1.15, 0.05, C.cliff, 0, y, -0.03);
  b.box(W * 3, 0.02, 0.06, C.forest, 0, y + H * 1.15, -0.03);
  if (p.steps) for (let i = 0; i < p.steps; i++) b.box(W * (1.4 - i * 0.12), 0.008, 0.04 + i * 0.01, C.rock, 0, y + (i / p.steps) * H, 0.005);
  b.box(W, H, 0.012, C.waterfall, 0, y, 0.0);
  disc(b, ctx, W * 1.4, C.pond, 0.006, 0, 0.03);
  plume(b, 0, y, 0.025, W * 0.5, 2, 3);
  trees(b, ctx, ellipse(0, 0.02, 0.16, 0.1, 10), 10, 11, { avoid: (x, z) => Math.abs(x) < W * 1.8 });
  return { height: H * 1.2 };
}

/** 峡谷：両岸の岩壁と川、遊歩道／トンネル口（清津峡・昇仙峡・高千穂峡・秋芳洞） */
function gorge(b, ctx) {
  const p = P(ctx);
  const L = p.L ?? 0.4;
  const y = footY(ctx, 0, 0, 0.05);
  drape(b, ctx, rect(0, 0, 0, 0.03, L), C.water, { off: 0.004, step: 0.05 });
  const H = p.h ?? 0.07;
  const rng = mulberry32(7);
  for (const sx of [-1, 1])
    for (let i = 0; i < 7; i++) {
      const z = -L / 2 + (i + 0.5) * (L / 7);
      b.box(0.03 + rng() * 0.015, H * (0.75 + rng() * 0.5), L / 7, p.rock ?? C.cliff, sx * 0.03, ctx.ground(sx * 0.03, z) - 0.01, z);
    }
  if (p.peak) b.cyl(0.01, 0.025, H * 1.8, 6, C.rockDark, 0.05, ctx.ground(0.05, -L * 0.3), -L * 0.3); // 覚円峰
  if (p.cave) b.box(0.03, 0.025, 0.006, '#1e1d1c', 0, y, -L / 2 + 0.03);
  if (p.boat) b.box(0.008, 0.004, 0.02, C.vermilion, 0, y + 0.004, 0.02);
  if (p.fall) b.box(0.008, H * 0.9, 0.006, C.waterfall, -0.026, ctx.ground(-0.026, 0.05), 0.05);
  trees(b, ctx, rect(0, 0, 0, 0.2, L), 14, 21, { avoid: (x) => Math.abs(x) < 0.05 });
  return { height: H * 1.3 };
}

/** ダム：弧を描くコンクリートの壁、放水、湖 */
function dam(b, ctx) {
  const y = footY(ctx, 0, 0, 0.05);
  const R = 0.22;
  for (let i = 0; i < 12; i++) {
    const a0 = (-0.55 + (i / 12) * 1.1) * Math.PI * 0.5;
    const a1 = (-0.55 + ((i + 1) / 12) * 1.1) * Math.PI * 0.5;
    const x0 = Math.sin(a0) * R;
    const z0 = -Math.cos(a0) * R + R;
    const x1 = Math.sin(a1) * R;
    const z1 = -Math.cos(a1) * R + R;
    const g = Math.min(ctx.ground(x0, z0), ctx.ground(x1, z1));
    b.beam(x0, g + 0.02, z0, x1, g + 0.02, z1, 0.03, C.concrete);
    b.box(Math.hypot(x1 - x0, z1 - z0), 0.12, 0.025, '#c2beb5', (x0 + x1) / 2, g - 0.08, (z0 + z1) / 2, Math.atan2(x1 - x0, z1 - z0) + Math.PI / 2);
  }
  drape(b, ctx, ellipse(0, -0.12, 0.2, 0.12, 14), '#3f7f90', { h: () => y + 0.03, step: 0.05 });
  b.box(0.02, 0.1, 0.03, C.waterfall, 0.02, y - 0.06, 0.04);
  plume(b, 0.02, y - 0.07, 0.07, 0.025, 2, 5);
  return { height: 0.08 };
}

/** 庭園：芝生・池・松・茶屋（兼六園・後楽園・栗林公園・偕楽園の梅・水前寺・足立美術館） */
function garden(b, ctx) {
  const p = P(ctx);
  const R = p.r ?? 0.22;
  drape(b, ctx, ellipse(0, 0, R, R * 0.8, 16), C.lawn, { off: 0.008, step: 0.06 });
  drape(b, ctx, ellipse(R * 0.15, R * 0.1, R * 0.38, R * 0.24, 14, 20), C.pond, { off: 0.011, step: 0.05 });
  const y = footY(ctx, -R * 0.4, -R * 0.3);
  hall(b, -R * 0.4, y, -R * 0.3, 12, 8, 4, C.wood, p.roof ?? C.thatch, 0.005);
  if (p.hill) b.cyl(0.01, R * 0.18, 0.025, 8, C.green2, R * 0.45, footY(ctx, R * 0.45, -R * 0.35), -R * 0.35); // 築山
  if (p.lantern) {
    const yl = footY(ctx, R * 0.05, R * 0.25);
    b.beam(R * 0.05, yl, R * 0.25, R * 0.05, yl + 0.025, R * 0.25, 0.004, C.stone);
    b.hip(0.02, 0.014, 0.008, 0.2, C.stone, R * 0.05, yl + 0.025, R * 0.25);
  }
  trees(b, ctx, ellipse(0, 0, R * 0.95, R * 0.78, 14), p.trees ?? 18, 17, {
    r: 0.02, h: 0.045, colors: p.plum ? [C.plum, '#f0c2d0', C.green] : [C.pine, C.green, C.green2],
    avoid: (x, z) => Math.hypot((x - R * 0.15) / (R * 0.4), (z - R * 0.1) / (R * 0.26)) < 1,
  });
  if (p.castle) keep(b, R * 0.9, footY(ctx, R * 0.9, -R * 0.6), -R * 0.6, 0.004, { tiers: 3, base: 18, wall: C.blackWall, roof: C.roofTile });
  return { height: 0.06 };
}

/** 町並み：gassho（合掌造り）/ kura（白壁と黒の蔵）/ machiya（町家）/ thatch（茅葺の宿場）/ samurai（武家屋敷と生垣）/
 *  chinatown（中華街と赤い門）/ canal（水路と舟）/ onsen（湯畑と湯けむり）/ euro（欧風の街並みと塔）/ mining（鉱山町）/ street（観光の通り） */
function town(b, ctx) {
  const p = P(ctx);
  const st = p.style ?? 'machiya';
  const n = p.n ?? 18;
  const R = p.r ?? 0.2;
  const rng = mulberry32(p.seed ?? 3);
  const sty = {
    gassho: { w: 0.03, d: 0.05, h: 0.012, wall: '#6d5a44', roof: C.thatch, gable: 0.05 },
    kura: { w: 0.03, d: 0.04, h: 0.018, wall: C.plaster, roof: C.roofDark, gable: 0.016, band: C.blackWall },
    machiya: { w: 0.026, d: 0.036, h: 0.014, wall: '#5a4434', roof: C.roofDark, gable: 0.014 },
    thatch: { w: 0.03, d: 0.04, h: 0.012, wall: '#6d5a44', roof: C.thatch, gable: 0.026 },
    samurai: { w: 0.034, d: 0.03, h: 0.012, wall: C.plaster, roof: C.roofTile, gable: 0.016 },
    chinatown: { w: 0.024, d: 0.03, h: 0.022, wall: '#c9452f', roof: '#2f6f4f', gable: 0.012 },
    canal: { w: 0.028, d: 0.034, h: 0.014, wall: C.plaster, roof: C.roofDark, gable: 0.014 },
    onsen: { w: 0.03, d: 0.035, h: 0.018, wall: '#6a4c35', roof: C.roofDark, gable: 0.014 },
    euro: { w: 0.03, d: 0.03, h: 0.03, wall: '#b8583c', roof: '#5b3b2e', gable: 0.024 },
    mining: { w: 0.026, d: 0.034, h: 0.012, wall: '#5a4434', roof: '#8a4b33', gable: 0.014 },
    street: { w: 0.024, d: 0.03, h: 0.016, wall: '#c9c1b2', roof: C.roofTile, gable: 0.012 },
  }[st];
  const along = p.linear; // 通り沿いに 2 列
  for (let i = 0; i < n; i++) {
    let x;
    let z;
    if (along) {
      x = (i % 2 ? 1 : -1) * 0.035;
      z = -R + (Math.floor(i / 2) / Math.max(1, Math.floor(n / 2) - 1)) * R * 2;
    } else {
      const a = rng() * Math.PI * 2;
      const r = Math.sqrt(rng()) * R;
      x = Math.cos(a) * r;
      z = Math.sin(a) * r;
    }
    if (st === 'onsen' && Math.hypot(x, z) < 0.06) continue;
    if (st === 'canal' && Math.abs(z) < 0.03) continue;
    const g = footY(ctx, x, z, 0.015);
    const ry = along ? 0 : (rng() < 0.5 ? 0 : Math.PI / 2) + (rng() - 0.5) * 0.3;
    b.box(sty.w, sty.h, sty.d, sty.wall, x, g, z, ry);
    if (sty.band) b.box(sty.w * 1.01, sty.h * 0.3, sty.d * 1.01, sty.band, x, g, z, ry);
    b.gable(sty.w * 1.2, sty.d * 1.08, sty.gable, sty.roof, x, g + sty.h, z, ry);
  }
  if (p.road) drapePath(b, ctx, [[0, -R], [0, R]], 0.02, '#8e8a82', 0.009, 0.05);
  if (st === 'onsen') {
    drape(b, ctx, rect(0, 0, 0, 0.05, 0.08), '#7fc9b8', { off: 0.01, step: 0.03 });
    for (let k = 0; k < 4; k++) plume(b, -0.015 + k * 0.01, footY(ctx, 0, 0), -0.03 + k * 0.02, 0.012, 3, k + 1);
  }
  if (st === 'canal') {
    drape(b, ctx, rect(0, 0, 90, R * 2.1, 0.04), C.water, { off: 0.006, step: 0.05 });
    for (let k = 0; k < 3; k++) b.box(0.03, 0.004, 0.008, C.wood, -R * 0.5 + k * R * 0.5, footY(ctx, 0, 0) + 0.006, 0, Math.PI / 2);
  }
  if (st === 'chinatown') {
    const g = footY(ctx, 0, R);
    for (const sx of [-1, 1]) b.box(0.006, 0.05, 0.006, '#c43b2b', sx * 0.03, g, R);
    b.box(0.08, 0.008, 0.01, '#c43b2b', 0, g + 0.045, R);
    b.gable(0.09, 0.016, 0.014, '#2f6f4f', 0, g + 0.053, R, Math.PI / 2);
    b.box(0.02, 0.025, 0.02, '#c43b2b', 0, footY(ctx, 0, 0), 0);
    b.hip(0.035, 0.035, 0.015, 0.1, '#e1b23a', 0, footY(ctx, 0, 0) + 0.025, 0);
  }
  if (st === 'euro' && p.tower) {
    const g = footY(ctx, 0, 0);
    b.box(0.03, 0.2, 0.03, '#a74b33', 0, g, 0);
    b.cyl(0, 0.022, 0.06, 8, '#4c3a2e', 0, g + 0.2, 0);
    drape(b, ctx, rect(0, R * 0.6, 90, R * 2, 0.03), C.water, { off: 0.006, step: 0.05 });
    if (p.windmill) {
      const gx = footY(ctx, R * 0.8, -R * 0.6);
      b.cyl(0.012, 0.018, 0.05, 8, C.white, R * 0.8, gx, -R * 0.6);
      for (let k = 0; k < 4; k++) b.box(0.004, 0.05, 0.002, '#6b4a33', R * 0.8, gx + 0.05, -R * 0.6 - 0.02, 0, 0, (k * Math.PI) / 2);
    }
  }
  if (p.plumes) {
    const r2 = mulberry32(21);
    for (let k = 0; k < p.plumes; k++) {
      const a = r2() * Math.PI * 2;
      const rr = Math.sqrt(r2()) * R;
      plume(b, Math.cos(a) * rr, footY(ctx, Math.cos(a) * rr, Math.sin(a) * rr), Math.sin(a) * rr, 0.014, 3, k + 3);
    }
  }
  if (st === 'samurai') trees(b, ctx, ellipse(0, 0, R, R, 12), 10, 19, { r: 0.012, h: 0.02, colors: [C.green, C.green2] });
  if (st === 'mining') b.box(0.04, 0.02, 0.006, '#2a2826', 0, footY(ctx, 0, -R), -R); // 間歩の入口
  return { height: (sty.h + sty.gable) * (st === 'euro' && p.tower ? 9 : 1) + 0.02 };
}

/** 海岸の岩：pillars（柱状節理の断崖）/ washboard（鬼の洗濯板）/ couple（夫婦岩と注連縄）/ arch（円月島）/
 *  cape（万座毛の崖）/ island（鳥居のある小島）/ rocks（雨晴の岩と松） */
function coastRock(b, ctx) {
  const p = P(ctx);
  const t = p.type ?? 'rocks';
  const sea = ctx.sea;
  const rng = mulberry32(p.seed ?? 5);
  if (t === 'pillars') {
    for (let i = 0; i < 26; i++) {
      const x = (rng() - 0.5) * 0.24;
      const z = (rng() - 0.5) * 0.12;
      const g = Math.max(ctx.ground(x, z), sea);
      b.cyl(0.01, 0.012, g - sea + 0.05 + rng() * 0.03, 6, i % 3 ? C.rockDark : C.rock, x, sea - 0.02, z);
    }
    return { height: 0.08 };
  }
  if (t === 'washboard') {
    for (let i = 0; i < 14; i++) b.box(0.3, 0.004, 0.008, i % 2 ? '#6f6a5f' : '#8d8676', 0, sea + 0.001, -0.1 + i * 0.016, 0.3);
    return { height: 0.02 };
  }
  if (t === 'couple') {
    b.cyl(0.012, 0.022, 0.05, 7, C.rock, -0.02, sea - 0.01, 0);
    b.cyl(0.006, 0.012, 0.025, 7, C.rock, 0.025, sea - 0.01, 0.01);
    b.beam(-0.016, sea + 0.035, 0, 0.022, sea + 0.012, 0.01, 0.003, '#d9c27a');
    torii(b, -0.018, sea + 0.04, 0, 0.012, 0.012, C.white);
    return { height: 0.06 };
  }
  if (t === 'arch') {
    b.box(0.03, 0.05, 0.035, C.rock, -0.03, sea - 0.01, 0);
    b.box(0.03, 0.05, 0.035, C.rock, 0.03, sea - 0.01, 0);
    b.box(0.09, 0.025, 0.035, C.rock, 0, sea + 0.04, 0);
    b.cyl(0, 0.03, 0.03, 6, C.pine, 0, sea + 0.065, 0);
    return { height: 0.1 };
  }
  if (t === 'cape') {
    const g = footY(ctx, 0, 0, 0.03);
    drape(b, ctx, ellipse(0, 0, 0.12, 0.08, 14), C.lawn, { off: 0.008, step: 0.04 });
    b.box(0.14, g - sea + 0.01, 0.03, C.limestone, 0, sea - 0.02, 0.07);
    b.box(0.03, g - sea - 0.01, 0.03, C.limestone, 0.05, sea - 0.02, 0.1); // 象の鼻
    return { height: 0.05 };
  }
  if (t === 'island') {
    drape(b, ctx, ellipse(0, 0, 0.08, 0.07, 14), C.sand, { h: () => sea + 0.008, step: 0.03 });
    skirt(b, ctx, ellipse(0, 0, 0.08, 0.07, 14), C.sand, () => sea + 0.008, sea - 0.05, 0.03);
    trees(b, { ...ctx, ground: () => sea + 0.008 }, ellipse(0, 0, 0.065, 0.055, 10), 16, 3, { r: 0.012, h: 0.035, colors: ['#2f6b2c', '#3f8a3a'] });
    hall(b, 0, sea + 0.008, -0.02, 12, 8, 5, C.shrineRed, C.roofCopper, 0.004);
    torii(b, 0, ctx.ground(0, 0.12) - 0.002, 0.12, 0.03, 0.025, C.shrineRed);
    return { height: 0.05 };
  }
  for (let i = 0; i < 4; i++) {
    const x = -0.05 + i * 0.035;
    b.cyl(0.006, 0.014, 0.02 + rng() * 0.02, 6, C.rock, x, sea - 0.01, 0.03 * (i % 2));
    pineTree(b, x, sea + 0.015, 0.03 * (i % 2), 0.03);
  }
  return { height: 0.05 };
}

/** 砂浜・砂州・松原（天橋立・虹の松原・海の中道・千里浜・桂浜・鳥取砂丘） */
function beach(b, ctx) {
  const p = P(ctx);
  const L = p.L ?? 1.5;
  const W = p.W ?? 0.12;
  const deg = p.deg ?? 0;
  const poly = rect(0, 0, deg, W, L);
  const H = (x, z) => Math.max(ctx.ground(x, z) + 0.008, ctx.sea + 0.008);
  drape(b, ctx, poly, p.dune ? C.dune : C.sand, { h: H, step: 0.08 });
  if (p.spit) skirt(b, ctx, poly, C.sand, H, ctx.sea - 0.04, 0.1);
  if (p.pines) trees(b, { ...ctx, ground: H }, rect(0, 0, deg, W * 0.55, L * 0.95), p.pines, 13, { r: 0.016, h: 0.04, colors: [C.pine, '#3a6b3c'] });
  if (p.dune) for (let i = 0; i < 5; i++) {
    const t = (i / 4 - 0.5) * L * 0.8;
    const [ux, uz] = [Math.sin(deg * D2R), -Math.cos(deg * D2R)];
    b.cyl(0.01, W * 0.5, 0.02 + (i % 2) * 0.012, 10, '#e8d6a6', ux * t, H(ux * t, uz * t) - 0.006, uz * t);
  }
  if (p.cars) for (let i = 0; i < 6; i++) {
    const t = (i / 5 - 0.5) * L * 0.8;
    const [ux, uz] = [Math.sin(deg * D2R), -Math.cos(deg * D2R)];
    b.box(0.008, 0.005, 0.014, [C.red, C.white, '#3c5f9a'][i % 3], ux * t + 0.02, H(ux * t, uz * t), uz * t, deg * D2R);
  }
  return { height: 0.05 };
}

/** 鳴門の渦潮：海面の白い渦（同心のらせん） */
function whirlpool(b, ctx) {
  const y = ctx.sea + 0.004;
  for (const [cx, cz, R] of [[0, 0, 0.09], [0.15, 0.06, 0.06], [-0.13, -0.05, 0.05]]) {
    const pts = [];
    for (let i = 0; i <= 60; i++) {
      const a = i * 0.35;
      const r = R * (i / 60);
      pts.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
    }
    for (let i = 0; i < pts.length - 1; i++) b.beam(pts[i][0], y, pts[i][1], pts[i + 1][0], y, pts[i + 1][1], 0.006, i % 4 ? C.foam : '#cfe7ee');
    b.cyl(R * 0.25, R * 0.12, 0.002, 12, '#1f5f78', cx, y - 0.003, cz);
  }
  return { height: 0.02 };
}

/** 山頂・火口の目印：小さな祠・ケルン、type: crater（火口と噴煙）/ twin（双耳峰）/ antenna（電波塔） */
function summit(b, ctx) {
  const p = P(ctx);
  const y = footY(ctx, 0, 0, 0.05);
  if (p.crater) {
    ringE(b, 0.16, 0.12, 0.05, 0.02, C.rockDark, 0, y - 0.02, 0, 24);
    disc(b, ctx, 0.08, '#6f9a8f', -0.01, 0, 0, 0.06);
    plume(b, 0.02, y, 0, 0.04, 4, 9);
    return { height: 0.2 };
  }
  b.box(0.012, 0.012, 0.012, C.stone, 0, y, 0);
  b.hip(0.018, 0.018, 0.008, 0.1, C.roofCopper, 0, y + 0.012, 0);
  b.beam(0.02, y, 0, 0.02, y + 0.04, 0, 0.003, C.white);
  b.box(0.012, 0.008, 0.001, C.red, 0.026, y + 0.03, 0);
  if (p.lake) disc(b, ctx, p.lake, C.pond, 0.01, p.lakeX ?? 0.25, p.lakeZ ?? 0.1);
  if (p.antenna) for (let i = 0; i < 3; i++) b.beam(-0.04 + i * 0.03, y, 0.03, -0.04 + i * 0.03, y + 0.1 + (i % 2) * 0.04, 0.03, 0.006, i % 2 ? C.red : C.white);
  if (p.ropeway) b.beam(0, y + 0.01, 0, 0.3, ctx.ground(0.3, 0.3) + 0.02, 0.3, 0.002, '#3a3a3a');
  return { height: 0.05 };
}

/** 木造・石造の小さな橋：kintai（錦帯橋の 5 連アーチ）/ vine（かずら橋）/ chinka（沈下橋）/ stoneArch（通潤橋）/
 *  skyway（九重夢大吊橋）/ small（はりまや橋）。長さ L・向き deg */
function smallBridge(b, ctx) {
  const p = P(ctx);
  const t = p.type ?? 'small';
  const L = p.L ?? 0.2;
  const deg = (p.deg ?? 0) * D2R;
  const ux = Math.sin(deg);
  const uz = -Math.cos(deg);
  const g0 = ctx.ground(-ux * L / 2, -uz * L / 2);
  const g1 = ctx.ground(ux * L / 2, uz * L / 2);
  const yb = Math.max(g0, g1);
  const N = 20;
  const pt = (t2) => [ux * L * (t2 - 0.5), uz * L * (t2 - 0.5)];
  if (t === 'kintai') {
    drape(b, ctx, rect(0, 0, (p.deg ?? 0) + 90, 0.08, L * 1.2), C.water, { off: 0.006, step: 0.05 });
    for (let i = 0; i < N; i++) {
      const a = pt(i / N);
      const c = pt((i + 1) / N);
      const h = (q) => yb + 0.012 + Math.abs(Math.sin(q * 5 * Math.PI)) * 0.02;
      b.beam(a[0], h(i / N), a[1], c[0], h((i + 1) / N), c[1], 0.014, C.wood);
    }
    for (let k = 1; k < 5; k++) {
      const [x, z] = pt(k / 5);
      b.box(0.02, 0.016, 0.02, C.stone, x, yb - 0.004, z);
    }
    return { height: 0.04 };
  }
  if (t === 'vine') {
    const sag = 0.02;
    for (let i = 0; i < N; i++) {
      const a = pt(i / N);
      const c = pt((i + 1) / N);
      const h = (q) => yb + 0.03 - sag * Math.sin(q * Math.PI);
      b.beam(a[0], h(i / N), a[1], c[0], h((i + 1) / N), c[1], 0.008, '#8a6f45');
    }
    drape(b, ctx, rect(0, 0, (p.deg ?? 0) + 90, 0.04, L * 1.2), C.water, { off: 0.006, step: 0.04 });
    return { height: 0.04 };
  }
  if (t === 'skyway') {
    const yy = yb + 0.12;
    for (const e of [0, 1]) {
      const [x, z] = pt(e);
      b.beam(x, ctx.ground(x, z), z, x, yy + 0.03, z, 0.008, C.silver);
    }
    for (let i = 0; i < N; i++) {
      const a = pt(i / N);
      const c = pt((i + 1) / N);
      b.beam(a[0], yy - 0.01 * Math.sin((i / N) * Math.PI), a[1], c[0], yy - 0.01 * Math.sin(((i + 1) / N) * Math.PI), c[1], 0.008, C.silver);
    }
    b.box(0.01, 0.1, 0.008, C.waterfall, ux * L * 0.3 + 0.05, yb - 0.08, uz * L * 0.3 + 0.05);
    return { height: 0.16 };
  }
  if (t === 'stoneArch') {
    const yy = yb + 0.03;
    b.box(0.03, 0.012, L, C.stone, 0, yy, 0, deg);
    for (let i = 0; i <= 6; i++) {
      const [x, z] = pt(i / 6);
      if (i === 3) continue;
      b.box(0.03, yy - ctx.ground(x, z), 0.02, C.stone, x, ctx.ground(x, z), z, deg);
    }
    if (p.spray) plume(b, 0, yy - 0.01, 0.03, 0.01, 2, 2);
    return { height: 0.05 };
  }
  // chinka / small
  const yy = yb + (t === 'chinka' ? 0.004 : 0.01);
  b.box(t === 'chinka' ? 0.016 : 0.02, 0.006, L, p.color ?? (t === 'small' ? C.shrineRed : C.concrete), 0, yy, 0, deg);
  for (let i = 1; i < 5; i++) {
    const [x, z] = pt(i / 5);
    b.box(0.012, yy - ctx.ground(x, z) + 0.02, 0.006, C.concrete, x, ctx.ground(x, z) - 0.02, z, deg);
  }
  drape(b, ctx, rect(0, 0, (p.deg ?? 0) + 90, 0.07, L * 1.1), C.water, { off: 0.005, step: 0.05 });
  return { height: 0.03 };
}

/** 気球（佐賀バルーンフェスタの象徴） */
function balloons(b, ctx) {
  const rng = mulberry32(11);
  const cols = ['#e64a3c', '#f2b630', '#3f8fd1', '#56b36b', '#f07f2e'];
  disc(b, ctx, 0.25, C.lawn);
  for (let i = 0; i < 5; i++) {
    const x = (rng() - 0.5) * 0.4;
    const z = (rng() - 0.5) * 0.3;
    const y = ctx.ground(x, z) + 0.06 + rng() * 0.08;
    ball(b, 0.025, cols[i], x, y + 0.03, z, 12, 1.15);
    b.box(0.008, 0.008, 0.008, C.wood, x, y, z);
  }
  return { height: 0.2 };
}

/** 巨大な樹（縄文杉） */
function bigTree(b, ctx) {
  const y = footY(ctx, 0, 0, 0.03);
  b.cyl(0.02, 0.035, 0.08, 9, '#6b4d36', 0, y, 0);
  for (let i = 0; i < 5; i++) {
    const a = i * 1.3;
    ball(b, 0.035, i % 2 ? '#2f5a2c' : '#3e6b35', Math.cos(a) * 0.03, y + 0.09 + (i % 3) * 0.02, Math.sin(a) * 0.03, 10, 0.8);
  }
  b.box(0.08, 0.006, 0.02, C.wood, 0, y, 0.06); // 展望デッキ
  trees(b, ctx, ellipse(0, 0, 0.18, 0.18, 10), 14, 7, { avoid: (x, z) => Math.hypot(x, z) < 0.06, r: 0.02, h: 0.06 });
  return { height: 0.15 };
}

/** 都井岬：草地の岬と放牧の馬 */
function grassCape(b, ctx) {
  const rng = mulberry32(4);
  const nH = P(ctx).horses ?? 9;
  drape(b, ctx, ellipse(0, 0, 0.22, 0.16, 14), '#8db35e', { off: 0.008, step: 0.05 });
  if (P(ctx).monument) b.box(0.012, 0.035, 0.008, C.granite, 0, footY(ctx, 0, 0), 0);
  for (let i = 0; i < nH; i++) {
    const x = (rng() - 0.5) * 0.3;
    const z = (rng() - 0.5) * 0.2;
    const g = ctx.ground(x, z);
    b.box(0.012, 0.007, 0.004, '#6b4a2f', x, g + 0.006, z, rng() * 3);
    for (const sx of [-1, 1]) b.box(0.002, 0.006, 0.002, '#4a3322', x + sx * 0.004, g, z);
  }
  return { height: 0.03 };
}

/** カルスト台地（秋吉台）：草原に点々と白い石灰岩 */
function karst(b, ctx) {
  const rng = mulberry32(8);
  drape(b, ctx, ellipse(0, 0, 0.5, 0.4, 16), '#9db86a', { off: 0.008, step: 0.08 });
  for (let i = 0; i < 60; i++) {
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * 0.45;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r * 0.8;
    b.cyl(0.004, 0.008, 0.008 + rng() * 0.01, 5, C.limestone, x, ctx.ground(x, z), z);
  }
  return { height: 0.03 };
}

/** 吉野ヶ里：高床の倉・物見櫓・環濠 */
function yoshinogari(b, ctx) {
  const rng = mulberry32(6);
  ringE(b, 0.22, 0.17, 0.012, 0.004, C.water, 0, footY(ctx, 0, 0) + 0.004, 0, 24);
  for (let i = 0; i < 10; i++) {
    const a = rng() * Math.PI * 2;
    const r = 0.04 + rng() * 0.12;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r * 0.75;
    const g = footY(ctx, x, z, 0.01);
    b.cyl(0.014, 0.016, 0.008, 8, '#7a6248', x, g, z);
    b.cyl(0, 0.022, 0.025, 8, C.thatch, x, g + 0.008, z);
  }
  for (const [x, z] of [[0.1, -0.06], [-0.12, 0.05]]) {
    const g = footY(ctx, x, z);
    for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) b.beam(x + dx * 0.008, g, z + dz * 0.008, x + dx * 0.006, g + 0.05, z + dz * 0.006, 0.003, '#6b5237');
    b.box(0.02, 0.008, 0.02, '#6b5237', x, g + 0.05, z);
    b.hip(0.028, 0.028, 0.014, 0.1, C.thatch, x, g + 0.058, z);
  }
  return { height: 0.08 };
}

/** 平城宮跡：朱の大極殿と朱雀門、広い草地 */
function heijo(b, ctx) {
  const s = 0.0055;
  drape(b, ctx, rect(0, 0.05, 0, 0.5, 0.7), '#93b864', { off: 0.008, step: 0.1 });
  const y = footY(ctx, 0, -0.18, 0.05);
  b.box(50 * s, 3 * s, 26 * s, C.stone, 0, y, -0.18);
  hall(b, 0, y + 3 * s, -0.18, 44, 20, 12, C.vermilion, C.roofTile, s, 0, 0.42, 0.28);
  const y2 = footY(ctx, 0, 0.32, 0.04);
  b.box(25 * s, 10 * s, 10 * s, C.vermilion, 0, y2, 0.32);
  b.hip(30 * s, 15 * s, 4 * s, 0.4, C.roofTile, 0, y2 + 10 * s, 0.32);
  b.box(22 * s, 4 * s, 8 * s, C.vermilion, 0, y2 + 14 * s, 0.32);
  b.hip(28 * s, 13 * s, 5 * s, 0.3, C.roofTile, 0, y2 + 18 * s, 0.32);
  return { height: 0.14 };
}

/** 首里城：朱の正殿と御庭（うなー） */
function shuri(b, ctx) {
  const s = 0.006;
  const y = footY(ctx, 0, 0, 0.06);
  b.box(0.26, 0.02, 0.2, '#d8cdb0', 0, y - 0.01, 0.0); // 城壁の上面
  for (const [x, z, w, d] of [[0, -0.1, 0.27, 0.012], [0, 0.1, 0.27, 0.012], [-0.13, 0, 0.012, 0.2], [0.13, 0, 0.012, 0.2]]) b.box(w, 0.03, d, '#cdbf9a', x, y - 0.01, z);
  drape(b, ctx, rect(0, 0.02, 0, 0.1, 0.08), '#c8463a', { off: 0.012, step: 0.03 }); // 御庭の縞
  b.box(26 * s, 9 * s, 14 * s, '#c8352a', 0, y + 0.01, -0.05);
  b.hip(32 * s, 20 * s, 5 * s, 0.6, '#b8432f', 0, y + 0.01 + 9 * s, -0.05);
  b.box(22 * s, 5 * s, 11 * s, '#c8352a', 0, y + 0.01 + 12 * s, -0.05);
  b.hip(28 * s, 16 * s, 6 * s, 0.25, '#b8432f', 0, y + 0.01 + 17 * s, -0.05);
  b.gable(10 * s, 3 * s, 5 * s, '#e3b23c', 0, y + 0.01 + 9 * s, -0.05 + 9 * s, 0);
  return { height: 25 * s + 0.02 };
}

/** 守礼門：二重の赤い瓦屋根の門 */
function shureimon(b, ctx) {
  const s = 0.006;
  const y = footY(ctx, 0, 0, 0.03);
  for (const sx of [-1.5, -0.5, 0.5, 1.5]) b.box(1 * s, 6 * s, 1 * s, '#b8352b', sx * 4 * s, y, 0);
  b.hip(20 * s, 5 * s, 2 * s, 0.4, '#b8432f', 0, y + 6 * s, 0);
  b.box(10 * s, 2 * s, 3 * s, '#b8352b', 0, y + 8 * s, 0);
  b.hip(14 * s, 4.5 * s, 2 * s, 0.3, '#b8432f', 0, y + 10 * s, 0);
  drapePath(b, ctx, [[0, -0.1], [0, 0.1]], 0.015, C.stone, 0.008, 0.04);
  return { height: 13 * s };
}

/** 斎場御嶽：巨岩が寄りかかる三角の空間と森 */
function sefaUtaki(b, ctx) {
  const y = landY(b, ctx, 0.06, footY(ctx, 0, 0, 0.04));
  b.box(0.05, 0.08, 0.02, C.limestone, -0.02, y, 0, 0, 0, 0.35);
  b.box(0.05, 0.08, 0.02, C.limestone, 0.02, y, 0, 0, 0, -0.35);
  trees(b, ctx, ellipse(0, 0, 0.16, 0.14, 10), 16, 6, { avoid: (x, z) => Math.hypot(x, z) < 0.05, colors: ['#2f6b2c', '#3f8a3a'] });
  return { height: 0.09 };
}

/** 沖縄・平和祈念公園：海へ向かって放射状に並ぶ刻銘碑の屏風と白い塔 */
function peaceParkOkinawa(b, ctx) {
  const y = footY(ctx, 0, 0, 0.05);
  drape(b, ctx, ellipse(0, 0, 0.26, 0.2, 18), C.lawn, { off: 0.008, step: 0.05 });
  for (let r = 0; r < 4; r++)
    for (let k = -4; k <= 4; k++) {
      const a = k * 0.18;
      const R = 0.06 + r * 0.035;
      const x = Math.sin(a) * R;
      const z = Math.cos(a) * R;
      b.box(0.022, 0.012, 0.004, '#2f2f32', x, ctx.ground(x, z), z, a);
    }
  b.box(0.025, 0.12, 0.025, C.whiteStone, 0, y, -0.12);
  b.hip(0.03, 0.03, 0.02, 0.1, '#b8432f', 0, y + 0.12, -0.12);
  return { height: 0.15 };
}

/** 軍艦島：高層アパート群が並ぶ護岸の島 */
function gunkanjima(b, ctx) {
  const poly = rect(0, 0, 160, 0.16, 0.5);
  const top = 0.025;
  pad(b, ctx, poly, '#8f8b84', '#77736c', { top, step: 0.08 });
  const rng = mulberry32(12);
  for (let i = 0; i < 14; i++) {
    const t = (i / 13 - 0.5) * 0.42;
    const [ux, uz] = [Math.sin(160 * D2R), -Math.cos(160 * D2R)];
    const x = ux * t + (rng() - 0.5) * 0.06;
    const z = uz * t + (rng() - 0.5) * 0.06;
    b.box(0.04, 0.03 + rng() * 0.05, 0.03, i % 3 ? '#8c877e' : '#a29c90', x, ctx.sea + top, z, 160 * D2R);
  }
  return { height: 0.1 };
}

/** テーマパーク：coaster（富士急：巨大な白いコースターと観覧車）/ spanish（志摩スペイン村：白い城） */
function themePark(b, ctx) {
  const p = P(ctx);
  const y = footY(ctx, 0, 0, 0.06);
  if (p.type === 'spanish') {
    drape(b, ctx, rect(0, 0, 0, 0.3, 0.3), '#cdbf9a', { off: 0.008, step: 0.06 });
    b.box(0.12, 0.05, 0.08, '#f2ece0', 0, y, 0);
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      b.cyl(0.014, 0.016, 0.09, 10, '#f2ece0', sx * 0.06, y, sz * 0.04);
      b.cyl(0, 0.018, 0.04, 10, '#b4462e', sx * 0.06, y + 0.09, sz * 0.04);
    }
    return { height: 0.13 };
  }
  // ローラーコースター（白い大きな山）と観覧車
  const pts = [];
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    pts.push([Math.cos(t * Math.PI * 2) * 0.16, 0.02 + Math.max(0, Math.sin(t * Math.PI * 2 * 1.5)) * 0.18 * (1 - t * 0.5), Math.sin(t * Math.PI * 2) * 0.1]);
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay, az] = pts[i];
    const [cx, cy, cz] = pts[i + 1];
    b.beam(ax, y + ay, az, cx, y + cy, cz, 0.008, C.white);
    if (i % 3 === 0) b.beam(ax, y, az, ax, y + ay, az, 0.004, '#c8c8c8');
  }
  wheel(b, { R: 0.05, cy: y + 0.06, rim: C.white, rim2: '#e3e3e3', spoke: '#d8d8d8', gondolas: 12, gCols: ['#e64a3c', '#3f8fd1', '#f2b630'], gSize: 0.008, x: 0.2, z: 0.05, legSpan: 0.03, legColor: '#cfcfcf' });
  return { height: 0.22 };
}

/** 金沢駅：木組みの鼓門とガラスのドーム */
function tsuzumimon(b, ctx) {
  const y = footY(ctx, 0, 0, 0.05);
  for (const sx of [-1, 1]) {
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      b.beam(sx * 0.03 + Math.cos(a) * 0.008, y, Math.sin(a) * 0.008, sx * 0.03 + Math.cos(a + 1.2) * 0.008, y + 0.07, Math.sin(a + 1.2) * 0.008, 0.005, C.wood);
    }
  }
  b.box(0.09, 0.012, 0.025, C.wood, 0, y + 0.07, 0);
  dome(b, 0.12, 0.05, 0.08, '#b9d0e2', 0, y, 0.12, 20, 6);
  b.box(0.3, 0.03, 0.06, C.concrete, 0, y, 0.24);
  return { height: 0.085 };
}

/** 道後温泉本館：木造三層の屋根と振鷺閣 */
function dogoOnsen(b, ctx) {
  const s = 0.005;
  const y = footY(ctx, 0, 0, 0.04);
  let top = hall(b, 0, y, 0, 30, 24, 8, '#7a5a3c', C.roofTile, s, 0, 0.25, 0.6);
  top = hall(b, 0, top - 2 * s, 0, 22, 18, 6, '#7a5a3c', C.roofTile, s, 0, 0.3, 0.5);
  b.box(5 * s, 5 * s, 5 * s, '#c43b2b', 0, top - 1 * s, 0);
  b.hip(7 * s, 7 * s, 3 * s, 0.1, C.roofCopper, 0, top + 4 * s, 0);
  return { height: top - y + 8 * s };
}

/** 大浦天主堂・グラバー邸など洋館：church（尖塔）/ villa（ベランダのある洋館） */
function western(b, ctx) {
  const p = P(ctx);
  const s = 0.005;
  const y = footY(ctx, 0, 0, 0.04);
  if (p.type === 'church') {
    b.box(14 * s, 10 * s, 30 * s, C.plaster, 0, y, 0);
    b.gable(15 * s, 31 * s, 6 * s, '#56606b', 0, y + 10 * s, 0);
    b.box(6 * s, 18 * s, 6 * s, C.plaster, 0, y, -15 * s);
    b.cyl(0, 4 * s, 10 * s, 8, '#56606b', 0, y + 18 * s, -15 * s);
    drape(b, ctx, rect(0, 0.04, 0, 0.12, 0.12), C.gravel, { off: 0.008, step: 0.04 });
    return { height: 28 * s };
  }
  b.box(26 * s, 8 * s, 18 * s, '#f1ece0', 0, y, 0);
  b.box(28 * s, 1 * s, 20 * s, '#7c8c6a', 0, y + 7 * s, 0);
  b.hip(28 * s, 20 * s, 6 * s, 0.3, '#5e646b', 0, y + 8 * s, 0);
  drape(b, ctx, ellipse(0, 0.03, 0.12, 0.1, 12), C.lawn, { off: 0.008, step: 0.04 });
  trees(b, ctx, ellipse(0, 0.03, 0.12, 0.1, 10), 6, 2, { avoid: (x, z) => Math.abs(x) < 0.08 && Math.abs(z) < 0.06 });
  return { height: 14 * s };
}

/** 首都圏外郭放水路：地上の排水機場と立坑の円 */
function floodway(b, ctx) {
  const y = footY(ctx, 0, 0, 0.05);
  b.box(0.08, 0.025, 0.05, C.concrete, 0, y, 0);
  ringE(b, 0.03, 0.03, 0.006, 0.01, '#9a9890', 0.1, y, 0.02, 20);
  disc(b, ctx, 0.024, '#2c3236', 0.008, 0.1, 0.02);
  drape(b, ctx, rect(0.05, 0.08, 90, 0.4, 0.03), C.water, { off: 0.006, step: 0.05 });
  return { height: 0.04 };
}

/** 水族館：波形の屋根と大水槽のガラス（美ら海・名古屋港・鳥羽） */
function aquarium(b, ctx) {
  const p = P(ctx);
  const y = footY(ctx, 0, 0, 0.05);
  const w = p.w ?? 0.16;
  b.box(w, 0.03, w * 0.5, p.wall ?? '#e7ebee', 0, y, 0);
  for (let i = 0; i < 4; i++) {
    const g = new THREE.CylinderGeometry(w * 0.13, w * 0.13, w * 0.5, 10, 1, false, 0, Math.PI);
    g.rotateZ(Math.PI / 2);
    g.rotateY(Math.PI / 2);
    b.add(g, p.roof ?? '#4f86b8', GeoBuilder.mat(-w * 0.38 + i * w * 0.25, y + 0.03, 0, 0, 0, 0, 1, 0.6, 1));
  }
  b.box(w * 0.4, 0.022, 0.004, '#2f6f98', 0, y + 0.004, -w * 0.25 - 0.002);
  if (p.dolphin) disc(b, ctx, w * 0.25, '#3f8fb8', 0.012, w * 0.55, 0.05);
  return { height: 0.05 };
}

/** 灯台（v8：13 件）。白い（または石の）円筒の塔、回廊、灯室、ドーム。海上・岬の先でも岩の基盤に立つ */
function lighthouseV8(b, ctx) {
  const p = P(ctx);
  const H = p.hKm ?? 0.15;
  const col = p.color ?? '#fbfbf8';
  let y = footY(ctx, 0, 0, 0.03);
  if (y < ctx.sea + 0.004) {
    // 岬の先端・離島：1km 格子の地形では海になっているので岩の基盤を置く
    const top = ctx.sea + 0.02;
    b.cyl(0.05, 0.075, top - (ctx.sea - 0.08), 10, C.rock, 0, ctx.sea - 0.08, 0);
    b.cyl(0.048, 0.05, 0.004, 10, C.moss, 0, top, 0);
    y = top + 0.004;
  } else drape(b, ctx, ellipse(0, 0, 0.07, 0.07, 12), '#cfc9bb', { off: 0.014, step: 0.04 });
  b.box(0.045, 0.02, 0.03, '#f4f4f0', 0.045, y, 0.02);
  const r0 = H * (p.stout ? 0.2 : 0.15);
  b.cyl(r0 * 0.68, r0, H, 14, col, 0, y, 0);
  if (p.band) b.cyl(r0 * 0.74, r0 * 0.78, H * 0.08, 14, p.band, 0, y + H * 0.55, 0);
  b.cyl(r0 * 1.1, r0 * 1.1, H * 0.04, 14, '#3a3d40', 0, y + H, 0);
  b.cyl(r0 * 0.58, r0 * 0.58, H * 0.13, 10, '#f3e7b0', 0, y + H * 1.04, 0);
  dome(b, r0 * 0.66, H * 0.1, r0 * 0.66, '#3a3d40', 0, y + H * 1.17, 0, 12, 4);
  return { height: y + H * 1.3, lampY: y + H * 1.1 };
}

/** 鈴鹿サーキット：立体交差のある 8 の字のコースとグランドスタンド、観覧車 */
function circuit(b, ctx) {
  const pts = [];
  for (let i = 0; i <= 64; i++) {
    const t = (i / 64) * Math.PI * 2;
    pts.push([Math.sin(t) * 0.55, Math.sin(t) * Math.cos(t) * 0.36]);
  }
  for (let i = 0; i < pts.length - 1; i++) drapePath(b, ctx, [pts[i], pts[i + 1]], 0.025, C.asphalt, 0.01, 0.06);
  const y = footY(ctx, 0.05, 0.08);
  b.box(0.2, 0.025, 0.04, C.concrete, 0.0, y, 0.08);
  b.box(0.06, 0.01, 0.06, C.asphalt, 0, footY(ctx, 0, 0) + 0.012, 0); // 立体交差
  wheel(b, { R: 0.045, cy: footY(ctx, -0.35, 0.25) + 0.055, rim: C.white, rim2: '#ddd', spoke: '#ccc', gondolas: 12, gCols: ['#e64a3c', '#f2b630', '#3f8fd1'], gSize: 0.007, x: -0.35, z: 0.25, legSpan: 0.025, legColor: '#ccc' });
  return { height: 0.1 };
}

/** 断崖に建つ堂（三徳山投入堂・祐徳稲荷神社） */
function cliffHall(b, ctx) {
  const p = P(ctx);
  const s = p.s ?? 0.005;
  const y = footY(ctx, 0, 0, 0.04);
  b.box(0.16, 0.1 * (p.size ?? 1), 0.04, C.cliff, 0, y - 0.02, -0.04);
  const yd = y + 0.03 * (p.size ?? 1);
  const k = p.size ?? 1;
  hall(b, 0, yd, 0.0, 20 * k, 12 * k, 7 * k, p.red ? C.shrineRed : '#5a4434', p.red ? C.roofCopper : C.cypress, s);
  for (const sx of [-1, 0, 1]) for (const sz of [0.01, 0.03]) b.box(0.004, yd - ctx.ground(sx * 0.03, sz) + 0.01, 0.004, p.red ? C.shrineRed : '#4a3a2c', sx * 0.03, ctx.ground(sx * 0.03, sz) - 0.01, sz);
  trees(b, ctx, ellipse(0, 0, 0.18, 0.15, 10), 12, 23, { avoid: (x, z) => Math.abs(x) < 0.1 && Math.abs(z) < 0.07 });
  return { height: (yd - y) + 12 * k * s + 0.04 };
}

/** 川平湾：エメラルドの湾に浮かぶ緑の小島とグラスボート */
function kabira(b, ctx) {
  const sea = ctx.sea;
  const rng = mulberry32(14);
  for (let i = 0; i < 6; i++) {
    const x = (rng() - 0.5) * 0.6;
    const z = (rng() - 0.5) * 0.4;
    const r = 0.02 + rng() * 0.03;
    b.cyl(r * 0.8, r, 0.03, 9, '#c9c1a9', x, sea - 0.02, z);
    dome(b, r * 0.85, 0.025, r * 0.85, '#2f7a3a', x, sea + 0.01, z, 10, 4);
  }
  for (let i = 0; i < 4; i++) b.box(0.006, 0.004, 0.018, i % 2 ? C.white : '#3f8fd1', -0.1 + i * 0.06, sea + 0.001, 0.12, 0.4);
  return { height: 0.04 };
}

export const JAPAN_BUILDERS = {
  circuit, cliffHall, kabira,
  castle, castleRuins, shrine, bigTorii, temple, pagoda, kiyomizu, fushimiInari, byodoin, izumoTaisha, iseJingu, daibutsuden,
  statue, tower, sunTower, genbakuDome, building, stadium, eggDome, airport, waterfall, gorge, dam, garden, town, coastRock,
  beach, whirlpool, summit, smallBridge, balloons, bigTree, grassCape, karst, yoshinogari, heijo, shuri, shureimon, sefaUtaki,
  peaceParkOkinawa, gunkanjima, themePark, tsuzumimon, dogoOnsen, western, floodway, aquarium, lighthouseV8,
};

/** 生成前の建物除外半径の目安 [km] */
export const JAPAN_EXCLUDE = {
  circuit: 0.6, cliffHall: 0.2, kabira: 0.05,
  castle: 0.35, castleRuins: 0.3, shrine: 0.3, bigTorii: 0.12, temple: 0.32, pagoda: 0.12, kiyomizu: 0.3, fushimiInari: 0.3,
  byodoin: 0.25, izumoTaisha: 0.32, iseJingu: 0.35, daibutsuden: 0.32, statue: 0.12, tower: 0.14, sunTower: 0.18, genbakuDome: 0.15,
  building: 0.25, stadium: 0.25, eggDome: 0.22, airport: 0.5, waterfall: 0.2, gorge: 0.25, dam: 0.3, garden: 0.28, town: 0.25,
  coastRock: 0.15, beach: 0.2, whirlpool: 0.05, summit: 0.08, smallBridge: 0.15, balloons: 0.3, bigTree: 0.2, grassCape: 0.25,
  karst: 0.5, yoshinogari: 0.28, heijo: 0.5, shuri: 0.28, shureimon: 0.12, sefaUtaki: 0.18, peaceParkOkinawa: 0.3, gunkanjima: 0.1,
  themePark: 0.3, tsuzumimon: 0.3, dogoOnsen: 0.15, western: 0.14, floodway: 0.2, aquarium: 0.2, lighthouseV8: 0.12,
};
