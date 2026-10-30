/**
 * landmarks.js — 旅の目印となるランドマーク（オリジナルの簡略モデル）
 * ---------------------------------------------------------------------------
 * すべて Three.js の基本形状（箱・円柱・円錐台・押し出し形状）の組み合わせで作った
 * オリジナルの低ポリゴンモデル。外部の 3D モデルやテクスチャは使っていない。
 *
 * ・1 件ごとに部品を GeoBuilder で 1 ジオメトリへまとめ、共有マテリアル（頂点カラー）で描く
 *   → ランドマーク 1 件 = draw call 1。三角形は 1 件あたり数百〜数千。
 * ・遠くからでも何か分かるよう、シルエットを強調し、実物より大きめに作っている
 *   （塔はおおむね 地形と同じ縦3倍 × 1.2 程度、小さな建物は 6〜30 倍）。
 *   ただし富士山（Y≒11）や都市全体より目立たない範囲にとどめている。
 * ・カメラが近づいたら（tier1: 460km / tier2: 190km 以内）その場所の詳細地形を読み込んでから生成する。
 *
 * ローカル座標：原点 = 地表の中心、-Z = 「正面」（heading で回転。北=0°・時計回り）。
 * 寸法は実物の m に倍率 s を掛けてワールド単位（km）にしている。
 *
 * 将来の参照：mesh.userData = { kind:'landmark', id, name, type:'landmark', lat, lon, ... }
 */
import * as THREE from 'three';
import { latLonToWorld, VERTICAL_EXAGGERATION } from './geo.js';
import { GeoBuilder } from './meshkit.js';

const M2Y = VERTICAL_EXAGGERATION / 1000;
const D2R = Math.PI / 180;
const DIST = { 1: 460, 2: 190 }; // モデルを表示する距離 [km]
const LABEL_DIST = { 1: 420, 2: 120 };

const COL = {
  white: '#f4f2ec',
  plaster: '#f7f7f2',
  stone: '#8f8b83',
  stoneDark: '#6e6a63',
  roofGray: '#55606a',
  roofDark: '#3a3f44',
  copper: '#5f9e8a',
  gold: '#f4c53a',
  black: '#2a2928',
  vermilion: '#d4452b',
  wood: '#7a5a3c',
  cypress: '#5b4536',
  glass: '#5f7389',
  glassLight: '#9fb6ca',
  green: '#3f6b35',
  green2: '#4a7a3d',
  green3: '#58894a',
  bank: '#7a9a5c',
  water: '#3f7686',
  pond: '#2f5e5a',
  orange: '#e9561f',
  red: '#cf3b2c',
  steel: '#c6ccd0',
  akashi: '#9fb3ad',
};

/* ====================================================================== */
/* モデル                                                                  */
/* ====================================================================== */

/** 東京スカイツリー：白い細長い塔、2 つの展望台、長いアンテナ */
function skytree(b) {
  const s = 0.0036;
  const W = '#e6edf4';
  b.cyl(24 * s, 40 * s, 120 * s, 3, W, 0, 0, 0, Math.PI / 6); // 三角形の脚部
  b.cyl(18 * s, 24 * s, 225 * s, 12, W, 0, 115 * s);
  b.cyl(28 * s, 25 * s, 33 * s, 16, COL.glass, 0, 340 * s); // 天望デッキ
  b.cyl(28 * s, 28 * s, 4 * s, 16, W, 0, 373 * s);
  b.cyl(14 * s, 16 * s, 68 * s, 12, W, 0, 376 * s);
  b.cyl(19 * s, 17 * s, 14 * s, 16, COL.glass, 0, 443 * s); // 天望回廊
  b.cyl(9 * s, 12 * s, 42 * s, 10, W, 0, 456 * s);
  b.cyl(2 * s, 6 * s, 140 * s, 8, '#d5dbe0', 0, 496 * s); // ゲイン塔
  return { height: 636 * s, exclude: 0.3 };
}

/** 東京タワー：赤白の格子塔（4 本脚 + 段々に細くなる角錐台） */
function tokyoTower(b) {
  const s = 0.0042;
  const O = COL.orange;
  const W = '#f3f1ec';
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) b.beam(sx * 40 * s, 0, sz * 40 * s, sx * 23 * s, 64 * s, sz * 23 * s, 11 * s, O);
  const band = (y0, y1, h0, h1, c) => b.hip(2 * h0 * s, 2 * h0 * s, (y1 - y0) * s, h1 / h0, c, 0, y0 * s);
  band(58, 80, 24, 20, W);
  band(80, 102, 20, 17, O);
  band(102, 124, 17, 14.5, W);
  b.box(32 * s, 22 * s, 32 * s, '#d6dde2', 0, 124 * s); // メインデッキ
  band(146, 168, 12, 10, O);
  band(168, 190, 10, 8.2, W);
  band(190, 212, 8.2, 6.5, O);
  band(212, 224, 6.5, 5.6, W);
  b.box(13 * s, 22 * s, 13 * s, '#d6dde2', 0, 224 * s); // トップデッキ
  band(246, 268, 4.2, 3.2, O);
  band(268, 290, 3.2, 2.2, W);
  band(290, 312, 2.2, 1.3, O);
  band(312, 333, 1.3, 0.3, W);
  return { height: 333 * s, exclude: 0.32 };
}

/** 和風の多層塔（五重塔など） */
function pagoda(b, x, z, s, tiers = 5, base = 10, tierH = 6.2) {
  let y = 0;
  b.box(base * 1.25 * s, 1.5 * s, base * 1.25 * s, COL.stone, x, 0, z);
  y = 1.5;
  for (let i = 0; i < tiers; i++) {
    const w = base * (1 - i * 0.07);
    b.box(w * s, (tierH - 1.8) * s, w * s, COL.vermilion, x, y * s, z);
    y += tierH - 1.8;
    b.hip(w * 1.95 * s, w * 1.95 * s, 1.8 * s, 0.5, COL.roofDark, x, y * s, z);
    y += 1.8;
  }
  b.cyl(0.3 * s, 0.8 * s, 12 * s, 6, '#b89647', x, y * s, z);
  return (y + 12) * s;
}

/** 浅草寺：朱色の本堂・五重塔・宝蔵門・雷門（大提灯）と仲見世 */
function temple(b) {
  const s = 0.007;
  const L = 0.0024; // 配置の縮尺（建物より少し詰める）
  // 本堂
  b.box(42 * s, 2 * s, 38 * s, COL.stone, 0, 0, 0);
  b.box(33 * s, 11 * s, 29 * s, COL.vermilion, 0, 2 * s, 0);
  b.hip(48 * s, 43 * s, 14 * s, 0.32, COL.roofGray, 0, 13 * s, 0);
  b.box(13 * s, 3 * s, 2 * s, COL.roofGray, 0, 27 * s, 0);
  // 五重塔（本堂の南西）
  pagoda(b, -60 * L, 70 * L, s);
  // 宝蔵門
  const hz = 110 * L;
  b.box(22 * s, 13 * s, 9 * s, COL.vermilion, 0, 0, hz);
  b.hip(28 * s, 15 * s, 5 * s, 0.35, COL.roofGray, 0, 13 * s, hz);
  b.box(20 * s, 3 * s, 7 * s, COL.vermilion, 0, 18 * s, hz);
  b.hip(27 * s, 14 * s, 5 * s, 0.3, COL.roofGray, 0, 21 * s, hz);
  // 仲見世（左右に低い店の列）
  for (let i = 0; i < 9; i++) {
    const z = (140 + i * 22) * L;
    for (const sx of [-1, 1]) {
      b.box(7 * s, 4 * s, 8 * s, '#e8dccb', sx * 9 * s, 0, z);
      b.hip(8.5 * s, 9 * s, 2 * s, 0.4, COL.vermilion, sx * 9 * s, 4 * s, z);
    }
  }
  // 雷門と大提灯
  const kz = 350 * L;
  b.box(14 * s, 9 * s, 8 * s, COL.vermilion, 0, 0, kz);
  b.hip(19 * s, 13 * s, 4 * s, 0.3, COL.roofGray, 0, 9 * s, kz);
  b.cyl(2.3 * s, 2.3 * s, 4 * s, 10, '#b81d1a', 0, 3.5 * s, kz - 4.2 * s);
  return { height: 50 * s, exclude: 0.55 };
}

/**
 * 天守（城）の共通ビルダー
 * @param spec { base:[w,d,h], stone, tiers:[[w,d,h]], wall, roof, roofOver, roofH, topH, gables, shachi }
 */
function keep(b, x, z, y0, s, spec) {
  const [bw, bd, bh] = spec.base;
  b.hip(bw * 1.12 * s, bd * 1.12 * s, bh * s, spec.baseTop ?? 0.88, spec.stone, x, y0, z); // 石垣
  let y = y0 + bh * s;
  spec.tiers.forEach(([w, d, h], i) => {
    b.box(w * s, h * s, d * s, spec.wall, x, y, z);
    if (spec.band) b.box(w * 1.01 * s, h * 0.25 * s, d * 1.01 * s, spec.band, x, y + h * 0.75 * s, z);
    y += h * s;
    const last = i === spec.tiers.length - 1;
    const rh = (last ? spec.topH : spec.roofH) * s;
    const o = spec.roofOver;
    b.hip((w + o) * s, (d + o) * s, rh, last ? 0.18 : 0.62, spec.roof, x, y, z);
    // 破風（三角の妻）：正面と側面に交互に
    if (spec.gables && !last && i > 0) {
      if (i % 2) b.gable(w * 0.5 * s, 3 * s, rh * 1.6, spec.roof, x, y, z - (d + o) * 0.42 * s, 0);
      else b.gable(d * 0.5 * s, 3 * s, rh * 1.6, spec.roof, x - (w + o) * 0.42 * s, y, z, Math.PI / 2);
    }
    y += last ? rh : rh * 0.55;
  });
  if (spec.shachi) {
    const ww = spec.tiers[spec.tiers.length - 1][0] * 0.32 * s;
    for (const sx of [-1, 1]) b.box(1.6 * s, 3.6 * s, 1.2 * s, COL.gold, x + sx * ww, y - 1.2 * s, z);
  }
  return y;
}

/** 名古屋城：白壁・緑青の屋根・金鯱 */
function castleNagoya(b) {
  const s = 0.0082;
  const spec = {
    base: [46, 40, 19], stone: COL.stone, wall: COL.plaster, roof: COL.copper,
    tiers: [[36, 31, 8], [32, 27, 7], [27, 22, 6.5], [21, 17, 6], [15, 12, 6]],
    roofOver: 6, roofH: 3.2, topH: 6.5, gables: true, shachi: true,
  };
  const top = keep(b, 0, 0, 0, s, spec);
  // 小天守（南）と渡り
  keep(b, 0, 48 * s, 0, s, {
    base: [28, 24, 12], stone: COL.stone, wall: COL.plaster, roof: COL.copper,
    tiers: [[22, 19, 7], [17, 14, 6]], roofOver: 5, roofH: 3, topH: 5, gables: false,
  });
  b.box(12 * s, 10 * s, 18 * s, COL.stone, 0, 0, 26 * s);
  return { height: top + 0.01, exclude: 0.45 };
}

/** 姫路城：白漆喰の連立式天守（大天守 + 小天守 3 + 渡櫓）、姫山の上 */
function castleHimeji(b) {
  const s = 0.0085;
  const hill = 0.15;
  b.hip(1.0, 0.8, hill, 0.55, '#5f7a4b', 0, -0.06, 0); // 姫山
  const y0 = hill - 0.06;
  const W = COL.plaster;
  const R = COL.roofGray;
  const top = keep(b, 0, 0, y0, s, {
    base: [28, 24, 15], stone: COL.stone, wall: W, roof: R,
    tiers: [[24, 20, 6.5], [22, 18, 6], [19, 15.5, 5.5], [15.5, 12.5, 5.2], [12, 10, 5], [9, 7.5, 4.5]],
    roofOver: 5.5, roofH: 2.8, topH: 5, gables: true, shachi: false,
  });
  const small = (x, z) =>
    keep(b, x, z, y0, s, {
      base: [16, 14, 11], stone: COL.stone, wall: W, roof: R,
      tiers: [[13, 11, 5], [11, 9, 4.5], [8, 7, 4]], roofOver: 4.5, roofH: 2.4, topH: 4, gables: true,
    });
  small(-36 * s, -4 * s); // 西小天守
  small(-34 * s, -34 * s); // 乾小天守
  small(-4 * s, -36 * s); // 東小天守
  // 渡櫓（ロの字に結ぶ）
  b.box(26 * s, 8 * s, 8 * s, W, -18 * s, y0 + 11 * s, -36 * s);
  b.box(8 * s, 8 * s, 26 * s, W, -36 * s, y0 + 11 * s, -18 * s);
  b.hip(30 * s, 11 * s, 3 * s, 0.3, R, -18 * s, y0 + 19 * s, -36 * s);
  b.hip(11 * s, 30 * s, 3 * s, 0.3, R, -36 * s, y0 + 19 * s, -18 * s);
  return { height: top + 0.01, exclude: 0.7 };
}

/** 熊本城：黒い下見板の大天守・小天守、反りの強い石垣（武者返し） */
function castleKumamoto(b) {
  const s = 0.0082;
  const B = COL.black;
  const R = COL.roofDark;
  const top = keep(b, 0, 0, 0, s, {
    base: [44, 40, 18], baseTop: 0.74, stone: COL.stoneDark, wall: B, band: '#e9e6df', roof: R,
    tiers: [[34, 30, 8], [30, 26, 7], [24, 20, 6.5], [18, 15, 6], [13, 11, 5.5]],
    roofOver: 6, roofH: 3.2, topH: 6, gables: true, shachi: false,
  });
  keep(b, 34 * s, 22 * s, 0, s, {
    base: [30, 26, 15], baseTop: 0.76, stone: COL.stoneDark, wall: B, band: '#e9e6df', roof: R,
    tiers: [[23, 20, 7], [19, 16, 6], [14, 12, 5]], roofOver: 5, roofH: 3, topH: 5, gables: true,
  });
  // 本丸の広い石垣
  b.hip(140 * s, 120 * s, 6 * s, 0.9, COL.stoneDark, 6 * s, -6 * s, 8 * s);
  return { height: top + 0.01, exclude: 0.65 };
}

/** JRセントラルタワーズ：名古屋駅上のツインタワー（オフィス棟 + ホテル棟） */
function twinTowers(b) {
  const s = 0.0033;
  b.box(110 * s, 60 * s, 230 * s, '#c9ccd0', 0, 0, 0); // 駅ビル低層部
  b.box(112 * s, 3 * s, 232 * s, '#9ea4aa', 0, 60 * s, 0);
  b.cyl(31 * s, 33 * s, 245 * s, 18, '#9db3c7', 0, 0, -55 * s); // オフィスタワー
  b.cyl(27 * s, 29 * s, 8 * s, 18, '#e3e6e8', 0, 245 * s, -55 * s);
  b.cyl(28 * s, 30 * s, 226 * s, 18, '#b7c6d2', 0, 0, 52 * s); // ホテルタワー
  b.cyl(25 * s, 27 * s, 8 * s, 18, '#e3e6e8', 0, 226 * s, 52 * s);
  return { height: 253 * s, exclude: 0.35 };
}

/** 京都タワー：白い円筒の塔＋赤い展望部、足元のタワービル */
function kyotoTower(b) {
  const s = 0.0045;
  b.box(70 * s, 31 * s, 42 * s, '#efeee9', 0, 0, 0);
  b.cyl(6.5 * s, 8 * s, 70 * s, 16, '#f7f6f2', 0, 31 * s);
  b.cyl(11 * s, 9 * s, 4 * s, 16, '#f7f6f2', 0, 100 * s);
  b.cyl(11.5 * s, 11 * s, 9 * s, 16, '#d8412f', 0, 104 * s); // 展望室
  b.cyl(9 * s, 11.5 * s, 3 * s, 16, '#f7f6f2', 0, 113 * s);
  b.cyl(0.6 * s, 4.5 * s, 15 * s, 12, '#f7f6f2', 0, 116 * s);
  b.cyl(0.3 * s, 0.6 * s, 3 * s, 6, '#d8412f', 0, 131 * s);
  return { height: 134 * s, exclude: 0.28 };
}

/** 金閣寺：鏡湖池のほとりの金色の三層楼閣 */
function kinkaku(b) {
  const s = 0.02;
  b.plate([[-0.32, 0.02], [-0.12, -0.06], [0.2, -0.04], [0.36, 0.08], [0.3, 0.3], [0.05, 0.38], [-0.25, 0.3], [-0.38, 0.15]], 0.01, COL.pond, 0.0);
  b.cyl(0.03, 0.05, 0.03, 7, COL.green3, -0.05, 0.005, 0.2); // 葦原島
  b.cyl(0.0, 0.025, 0.07, 6, COL.green, -0.05, 0.03, 0.2);
  b.cyl(0.0, 0.02, 0.06, 6, COL.green, 0.15, 0.005, 0.24);
  const z = -0.02;
  b.box(16 * s, 1 * s, 13 * s, COL.stone, 0, 0, z);
  b.box(14 * s, 4 * s, 11 * s, '#d9cfb6', 0, 1 * s, z); // 一層（法水院）
  b.hip(17 * s, 14.5 * s, 1.0 * s, 0.72, COL.cypress, 0, 5 * s, z);
  b.box(12.5 * s, 3.8 * s, 9.5 * s, COL.gold, 0, 6.0 * s, z); // 二層（金箔）
  b.hip(15.5 * s, 12.5 * s, 0.9 * s, 0.7, COL.cypress, 0, 9.8 * s, z);
  b.box(7.5 * s, 3.4 * s, 7.5 * s, COL.gold, 0, 10.5 * s, z); // 三層（金箔）
  b.hip(10 * s, 10 * s, 2.2 * s, 0.08, COL.cypress, 0, 13.9 * s, z);
  b.box(0.9 * s, 1.8 * s, 0.5 * s, COL.gold, 0, 16.0 * s, z); // 鳳凰
  return { height: 18.5 * s, exclude: 0.4 };
}

/** 天保山大観覧車：直径 100m・高さ 112.5m */
function ferrisWheel(b) {
  const s = 0.0055;
  const R = 50 * s;
  const cy = 62.5 * s;
  const rim = new THREE.TorusGeometry(R, 1.8 * s, 6, 48);
  b.add(rim, '#eef2f4', GeoBuilder.mat(0, cy, 0));
  const rim2 = new THREE.TorusGeometry(R * 0.93, 1.2 * s, 5, 48);
  b.add(rim2, '#d9e1e6', GeoBuilder.mat(0, cy, 0));
  b.beam(0, cy, -7 * s, 0, cy, 7 * s, 8 * s, '#a8b2b8'); // ハブ
  const cols = ['#e5483b', '#f3c63a', '#3b8de5', '#46b36a', '#f08a2c', '#f5f5f5'];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    b.beam(0, cy, 0, Math.cos(a) * R, cy + Math.sin(a) * R, 0, 0.9 * s, '#cfd6db');
  }
  for (let i = 0; i < 30; i++) {
    const a = (i / 30) * Math.PI * 2;
    b.box(4.5 * s, 4.5 * s, 4.5 * s, cols[i % cols.length], Math.cos(a) * (R + 3 * s), cy + Math.sin(a) * (R + 3 * s) - 2.2 * s, 0);
  }
  for (const sz of [-1, 1]) {
    b.beam(-26 * s, 0, sz * 14 * s, 0, cy, sz * 3 * s, 3.2 * s, '#b9c2c8');
    b.beam(26 * s, 0, sz * 14 * s, 0, cy, sz * 3 * s, 3.2 * s, '#b9c2c8');
  }
  b.box(40 * s, 6 * s, 26 * s, '#e3e1db', 0, 0, 0);
  return { height: 113 * s, exclude: 0.35 };
}

/** 前方後円墳の輪郭（ローカル [x, z]、前方部が -Z）。o: 外側へのオフセット [m] */
function keyhole(o, s) {
  const R = 124.5 + o;
  const zc = 118.5; // 後円部の中心
  const zn = 42; // くびれ
  const zf = -243 - o; // 前方部の先端
  const wf = 153.5 + o; // 前方部先端の半幅
  const cosP = Math.min(0.999, (zc - zn) / R);
  const p0 = Math.acos(cosP);
  const pts = [[-wf * s, zf * s], [wf * s, zf * s]];
  const N = 28;
  for (let k = 0; k <= N; k++) {
    const p = p0 + ((2 * Math.PI - 2 * p0) * k) / N;
    pts.push([R * Math.sin(p) * s, (zc - R * Math.cos(p)) * s]);
  }
  return pts;
}

/** 大仙陵古墳：上空から前方後円墳と分かる、樹木に覆われた墳丘と三重の濠 */
function kofun(b) {
  const s = 0.0021; // 水平 約2倍（実長 486m → 約1.0km）
  b.plate(keyhole(200, s), 0.05, COL.bank, -0.045); // 外周の緑地
  b.plate(keyhole(170, s), 0.05, COL.water, -0.04); // 三重目の濠
  b.plate(keyhole(140, s), 0.05, COL.bank, -0.035);
  b.plate(keyhole(115, s), 0.05, COL.water, -0.03); // 二重目の濠
  b.plate(keyhole(88, s), 0.05, COL.bank, -0.025);
  b.plate(keyhole(62, s), 0.05, COL.water, -0.02); // 内濠
  // 三段築成の墳丘（森）
  b.plate(keyhole(0, s), 0.06, COL.green, -0.015);
  b.plate(keyhole(-38, s), 0.045, COL.green2, 0.045);
  b.plate(keyhole(-72, s), 0.04, COL.green3, 0.09);
  return { height: 0.14, exclude: 0.95 };
}

/** 厳島神社：海上の大鳥居（両部鳥居）と朱塗りの社殿 */
function itsukushima(b) {
  // 海面（地形の解像度では干潟が陸に見えるため、周囲に海の板を敷く）
  b.plate([[-0.55, -0.75], [0.55, -0.75], [0.6, 0.1], [0.3, 0.16], [-0.3, 0.16], [-0.6, 0.1]], 0.02, '#3f8ea2', -0.005);
  // 大鳥居（実物 16.6m を約30倍）
  const s = 0.03;
  const tz = -0.45;
  const V = COL.vermilion;
  for (const sx of [-1, 1]) {
    b.cyl(1.4 * s, 1.6 * s, 14.5 * s, 10, V, sx * 5.5 * s, 0, tz);
    for (const sz of [-1, 1]) {
      b.cyl(0.8 * s, 0.9 * s, 9 * s, 8, V, sx * 5.5 * s, 0, tz + sz * 4 * s);
      b.box(0.8 * s, 0.8 * s, 8 * s, V, sx * 5.5 * s, 7.5 * s, tz);
    }
  }
  b.box(17 * s, 1.1 * s, 1.1 * s, V, 0, 10.5 * s, tz); // 貫
  b.box(1.4 * s, 2.2 * s, 0.9 * s, V, 0, 11.6 * s, tz); // 額束
  b.box(21 * s, 1.0 * s, 1.8 * s, V, 0, 13.8 * s, tz); // 島木
  b.box(25 * s, 1.3 * s, 2.4 * s, COL.black, 0, 14.8 * s, tz); // 笠木
  for (const sx of [-1, 1]) b.box(2.4 * s, 1.0 * s, 2.4 * s, COL.black, sx * 12.4 * s, 15.6 * s, tz, 0, 0, sx * 0.35);
  // 社殿：海の上に張り出した床（高床）と朱塗りの本社・左右の短い回廊
  const k = 0.006;
  const fy = 0.03; // 床の高さ
  for (const px of [-0.24, -0.12, 0, 0.12, 0.24])
    for (const pz of [-0.07, 0.07]) b.box(0.012, fy + 0.02, 0.012, V, px, -0.02, 0.05 + pz);
  b.box(90 * k, 1.2 * k, 30 * k, '#b99c70', 0, fy, 0.05);
  b.box(30 * k, 8 * k, 20 * k, V, 0, fy + 1.2 * k, 0.07);
  b.box(28 * k, 6 * k, 18 * k, '#f2efe6', 0, fy + 1.2 * k + 0.002, 0.07);
  b.gable(24 * k, 34 * k, 8 * k, COL.cypress, 0, fy + 9.2 * k, 0.07, Math.PI / 2);
  for (const sx of [-1, 1]) {
    const cx = sx * 52 * k;
    b.box(40 * k, 4 * k, 6 * k, V, cx, fy + 1.2 * k, -0.01, sx * 0.25);
    b.gable(9 * k, 42 * k, 3 * k, COL.cypress, cx, fy + 5.2 * k, -0.01, Math.PI / 2 + sx * 0.25);
  }
  b.box(16 * k, 1.5 * k, 14 * k, '#b99c70', 0, fy, -0.09); // 平舞台
  b.box(8 * k, 2 * k, 7 * k, V, 0, fy + 1.5 * k, -0.09); // 高舞台
  return { height: 16.6 * s, exclude: 0.6 };
}

/** 吉備津神社：比翼入母屋造の本殿・拝殿と、南へまっすぐ延びる長い回廊 */
function kibitsu(b, ctx) {
  const s = 0.0068;
  const V = COL.vermilion;
  b.hip(34 * s, 40 * s, 4 * s, 0.85, '#efece4', 0, 0, 0); // 亀腹（白漆喰の基壇）
  b.box(24 * s, 8 * s, 30 * s, V, 0, 4 * s, 0);
  b.box(26 * s, 1.2 * s, 32 * s, '#efece4', 0, 12 * s, 0);
  for (const sx of [-1, 1]) {
    b.gable(15 * s, 34 * s, 10 * s, COL.cypress, sx * 6.8 * s, 13 * s, 0); // 比翼の 2 つの棟
    b.box(1 * s, 1.2 * s, 34 * s, COL.roofDark, sx * 6.8 * s, 22.6 * s, 0);
  }
  b.box(16 * s, 6 * s, 11 * s, V, 0, 0, 24 * s); // 拝殿
  b.gable(14 * s, 19 * s, 6 * s, COL.cypress, 0, 6 * s, 24 * s, Math.PI / 2);
  // 回廊（実長 約360m → 約0.9km、南へ）
  // 斜面に沿って段々に下る（地形の高さに合わせて区間ごとに置く）
  const L = 0.0025;
  const z0 = 30 * s;
  const len = 360 * L;
  const N = 12;
  const seg = len / N;
  for (let k = 0; k < N; k++) {
    const zc = z0 + seg * (k + 0.5);
    const gy = ctx.ground(0, zc) - 0.004;
    b.box(5 * s, 1.5 * s + 0.004, seg * 1.02, '#b59a73', 0, gy, zc);
    b.box(3.4 * s, 3 * s, seg * 1.02, V, 0, gy + 1.5 * s + 0.004, zc);
    b.gable(7 * s, seg * 1.04, 2.6 * s, COL.cypress, 0, gy + 4.5 * s + 0.004, zc);
  }
  return { height: 23 * s, exclude: 0.45 };
}

/** 福岡タワー：ハーフミラーの細長い三角柱 */
function fukuokaTower(b) {
  const s = 0.0036;
  b.box(60 * s, 12 * s, 44 * s, '#eceae5', 0, 0, 0);
  b.cyl(12 * s, 15 * s, 116 * s, 3, '#8fb4d8', 0, 12 * s, 0, Math.PI / 6);
  b.cyl(16 * s, 15 * s, 9 * s, 3, '#4f6f8e', 0, 116 * s, 0, Math.PI / 6); // 展望室
  b.cyl(10 * s, 13 * s, 70 * s, 3, '#9cc0e0', 0, 125 * s, 0, Math.PI / 6);
  b.cyl(4 * s, 10 * s, 39 * s, 3, '#e8ecef', 0, 195 * s, 0, Math.PI / 6);
  return { height: 234 * s, exclude: 0.3 };
}

const BUILDERS = { skytree, tokyoTower, temple, castleNagoya, castleHimeji, castleKumamoto, twinTowers, kyotoTower, kinkaku, ferrisWheel, kofun, itsukushima, kibitsu, fukuokaTower };

/* ====================================================================== */
/* 橋（海峡を跨ぐ構造物。path の両端が結ぶ陸地）                                */
/* ====================================================================== */

const BV = 1.25; // 橋の縦方向の強調（地形の縦3倍 × 1.25）

/**
 * @param {GeoBuilder} b
 * @param {object} lm  landmarks.json の 1 件（path, spans）
 * @param {(x,z)=>number} groundY
 * @param {{x,z}} o 原点（ワールド）
 */
function buildBridge(b, lm, groundY, o) {
  const P = lm.path.map(([lat, lon, kind]) => {
    const w = latLonToWorld(lat, lon);
    return { x: w.x - o.x, z: w.z - o.z, wx: w.x, wz: w.z, kind, deck: null };
  });
  const isSeto = lm.id === 'seto-ohashi';
  const deckColor = lm.id === 'akashi-kaikyo-bridge' ? COL.akashi : COL.steel;
  const W = isSeto ? 0.075 : 0.07; // 幅（実物の約2倍）
  const T = isSeto ? 0.05 : 0.03; // 桁の厚さ（瀬戸大橋は道路鉄道併用の2層トラス）
  const spans = lm.spans ?? [];
  for (const sp of spans) {
    const dy = sp.deckM * M2Y * BV;
    for (const k of [sp.from, sp.to]) P[k].deck = Math.max(P[k].deck ?? 0, dy);
  }
  // 陸側の端は地表へ（取付部）
  for (const p of P) if (p.deck == null) p.deck = Math.max(0.02, groundY(p.wx, p.wz) + 0.02);

  const deckSeg = (a, c) => {
    const dx = c.x - a.x;
    const dz = c.z - a.z;
    const h = Math.hypot(dx, dz);
    const dy = c.deck - a.deck;
    const len = Math.hypot(h, dy);
    const g = new THREE.BoxGeometry(W, T, len);
    g.translate(0, -T / 2, 0);
    b.add(g, deckColor, GeoBuilder.mat((a.x + c.x) / 2, (a.deck + c.deck) / 2, (a.z + c.z) / 2, Math.atan2(dx, dz), -Math.atan2(dy, h)));
  };
  const lerp = (a, c, t) => ({ x: a.x + (c.x - a.x) * t, z: a.z + (c.z - a.z) * t, deck: a.deck + (c.deck - a.deck) * t });
  const perp = (a, c) => {
    const dx = c.x - a.x;
    const dz = c.z - a.z;
    const l = Math.hypot(dx, dz) || 1;
    return { x: -dz / l, z: dx / l };
  };

  let maxTop = 0;
  const spanAt = (i) => spans.find((sp) => sp.from === i);
  for (let i = 0; i < P.length - 1; i++) {
    const a = P[i];
    const c = P[i + 1];
    deckSeg(a, c);
    const sp = spanAt(i);
    const n = perp(a, c);
    const segLen = Math.hypot(c.x - a.x, c.z - a.z);
    const towers = sp?.towers ?? [];
    // 橋脚（吊橋の中央径間を除く海上部）
    const overWater = a.kind !== 'land' || c.kind !== 'land';
    if (overWater) {
      const cnt = Math.max(1, Math.round(segLen / 0.4));
      for (let k = 0; k <= cnt; k++) {
        const t = k / cnt;
        if (sp?.type === 'suspension' && t > towers[0] && t < towers[1]) continue;
        if (sp?.type === 'stayed' && t > towers[0] + 0.04 && t < towers[1] - 0.04) continue;
        const q = lerp(a, c, t);
        const g = groundY(q.x + o.x, q.z + o.z);
        const bottom = Math.min(g, 0) - 0.3;
        if (q.deck - T - bottom > 0.02) b.box(W * 0.55, q.deck - T - bottom, 0.05, '#b8bcbf', q.x, bottom, q.z, Math.atan2(c.x - a.x, c.z - a.z));
      }
    }
    for (const p of [a, c])
      if (p.kind === 'anchor') b.box(0.13, p.deck + 0.3, 0.14, '#c2c3c0', p.x, -0.3, p.z, Math.atan2(c.x - a.x, c.z - a.z));

    if (!sp) continue;
    const top = sp.towerM ? sp.towerM * M2Y * BV : 0;
    const tw = towers.map((t) => lerp(a, c, t));
    // 主塔
    for (const q of tw) {
      const yTop = q.deck + (top - q.deck);
      maxTop = Math.max(maxTop, yTop);
      for (const sg of [-1, 1]) {
        const lx = q.x + n.x * sg * (W * 0.62);
        const lz = q.z + n.z * sg * (W * 0.62);
        b.beam(lx, -0.3, lz, lx, yTop, lz, 0.028, deckColor);
      }
      for (const fy of [0.45, 0.8, 1.0]) {
        const yy = Math.min(yTop - 0.012, q.deck + (yTop - q.deck) * fy);
        b.beam(q.x - n.x * W * 0.62, yy, q.z - n.z * W * 0.62, q.x + n.x * W * 0.62, yy, q.z + n.z * W * 0.62, 0.022, deckColor);
      }
    }
    if (sp.type === 'suspension' && tw.length === 2) {
      // 主ケーブル：アンカー → 主塔 → 放物線 → 主塔 → アンカー（両側）
      for (const sg of [-1, 1]) {
        const off = (q) => ({ x: q.x + n.x * sg * W * 0.62, z: q.z + n.z * sg * W * 0.62 });
        const A = off(a);
        const C = off(c);
        const T1 = off(tw[0]);
        const T2 = off(tw[1]);
        b.beam(A.x, a.deck + 0.01, A.z, T1.x, top, T1.z, 0.011, '#e6e9eb');
        b.beam(T2.x, top, T2.z, C.x, c.deck + 0.01, C.z, 0.011, '#e6e9eb');
        const N = 16;
        let prev = null;
        for (let k = 0; k <= N; k++) {
          const t = k / N;
          const q = lerp(tw[0], tw[1], t);
          const qq = off(q);
          const y = q.deck + 0.025 + (top - q.deck - 0.025) * (2 * t - 1) ** 2;
          if (prev) b.beam(prev.x, prev.y, prev.z, qq.x, y, qq.z, 0.011, '#e6e9eb');
          if (k > 0 && k < N && k % 2 === 0) b.beam(qq.x, y, qq.z, qq.x, q.deck, qq.z, 0.004, '#d5d9dc'); // ハンガー
          prev = { x: qq.x, y, z: qq.z };
        }
      }
    } else if (sp.type === 'stayed') {
      // 斜張橋：主塔頂部から扇形のケーブル
      for (const q of tw)
        for (const sg of [-1, 1])
          for (const dir of [-1, 1])
            for (const dd of [0.12, 0.25, 0.38]) {
              const ux = (c.x - a.x) / segLen;
              const uz = (c.z - a.z) / segLen;
              const ox = q.x + n.x * sg * W * 0.62;
              const oz = q.z + n.z * sg * W * 0.62;
              b.beam(ox, top - 0.02, oz, ox + ux * dir * dd, q.deck, oz + uz * dir * dd, 0.005, '#e6e9eb');
            }
    } else if (sp.type === 'truss') {
      // トラス：桁の上に上弦材と束
      const h = 0.045;
      for (const sg of [-1, 1]) {
        const off = (q, y) => ({ x: q.x + n.x * sg * W * 0.5, y, z: q.z + n.z * sg * W * 0.5 });
        const A = off(a, a.deck + h);
        const C = off(c, c.deck + h);
        b.beam(A.x, A.y, A.z, C.x, C.y, C.z, 0.012, deckColor);
        const cnt = Math.max(2, Math.round(segLen / 0.12));
        for (let k = 0; k <= cnt; k++) {
          const q = lerp(a, c, k / cnt);
          const B0 = off(q, q.deck);
          b.beam(B0.x, B0.y, B0.z, B0.x, B0.y + h, B0.z, 0.008, deckColor);
        }
      }
    }
  }
  return { height: maxTop };
}

/* ====================================================================== */
/* システム                                                                */
/* ====================================================================== */

export class LandmarkSystem {
  constructor(terrain) {
    this.terrain = terrain;
    this.group = new THREE.Group();
    this.group.name = 'landmarks';
    this.material = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.material.name = 'landmarks-shared';
    this.items = [];
    this.byId = new Map();
    this.frame = 0;
    this.building = false;
    this.stats = { built: 0, visible: 0 };
  }

  async load(url) {
    const json = await (await fetch(url)).json();
    this.items = json.landmarks.map((l) => {
      const w = latLonToWorld(l.lat, l.lon);
      const it = { ...l, type: 'landmark', x: w.x, z: w.z, mesh: null, state: 'idle', height: 0.5, labelY: null };
      // 建物を建てない範囲（橋は両岸の取付部）
      it.exclusions = l.path
        ? l.path.map(([la, lo]) => ({ ...latLonToWorld(la, lo), r: 0.25 }))
        : [{ x: w.x, z: w.z, r: EXCLUDE_GUESS[l.kind] ?? 0.4 }];
      if (l.kind === 'kofun') {
        // 前方後円墳は細長いので前方部・後円部の 2 点で覆う
        const h = (l.heading ?? 0) * D2R;
        const fx = Math.sin(h) * 0.3;
        const fz = -Math.cos(h) * 0.3;
        it.exclusions = [{ x: w.x + fx, z: w.z + fz, r: 0.75 }, { x: w.x - fx, z: w.z - fz, r: 0.75 }];
      }
      this.byId.set(l.id, it);
      return it;
    });
    return this;
  }

  getById(id) {
    return this.byId.get(id);
  }

  exclusions() {
    return this.items.flatMap((it) => it.exclusions);
  }

  _build(it) {
    const b = new GeoBuilder();
    const t = this.terrain;
    let res;
    let y = 0;
    if (it.kind === 'bridge') {
      res = buildBridge(b, it, (x, z) => t.getSurfaceY(x, z), it);
      it.labelY = res.height + 0.1;
    } else {
      // 足元：周囲の低い方の地表に合わせる（斜面でも浮かない）
      y = this._groundY(it);
      const rot = -(it.heading ?? 0) * D2R;
      const cs = Math.cos(rot);
      const sn = Math.sin(rot);
      // ローカル座標 (lx, lz) の地表高さ（モデル原点からの相対 Y）
      const ctx = { ground: (lx, lz) => t.getSurfaceY(it.x + lx * cs + lz * sn, it.z - lx * sn + lz * cs) - y };
      res = BUILDERS[it.kind](b, ctx);
      it.labelY = null;
    }
    const geo = b.build();
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.name = `landmark_${it.id}`;
    mesh.position.set(it.x, y, it.z);
    if (it.kind !== 'bridge') mesh.rotation.y = -(it.heading ?? 0) * D2R;
    mesh.userData = { kind: 'landmark', id: it.id, name: it.name, type: 'landmark', lat: it.lat, lon: it.lon, region: it.region, connects: it.connects };
    mesh.updateMatrix();
    mesh.matrixAutoUpdate = false;
    it.mesh = mesh;
    it.height = res.height;
    it.state = 'ready';
    this.group.add(mesh);
    this.stats.built++;
  }

  /** モデル中心と周囲 4 点の低い方の地表に合わせる */
  _groundY(it) {
    const t = this.terrain;
    const e = 0.08;
    let m = t.getSurfaceY(it.x, it.z);
    for (const [dx, dz] of [[e, 0], [-e, 0], [0, e], [0, -e]]) m = Math.min(m, t.getSurfaceY(it.x + dx, it.z + dz));
    return m;
  }

  update(camera) {
    this.frame++;
    const p = camera.position;
    let vis = 0;
    for (const it of this.items) {
      const d = Math.hypot(p.x - it.x, p.y, p.z - it.z);
      const maxD = DIST[it.tier] ?? 200;
      if (it.state === 'idle' && d < maxD + 40) {
        it.state = 'loading';
        const c = this.terrain.chunkOf(it.x, it.z);
        this.terrain.requestChunkData(c.cx, c.cz, d).then(() => (it.state = 'queued'));
      }
      if (it.state === 'queued' && !this.building) {
        this.building = true; // 1 フレーム 1 件まで
        this._build(it);
      }
      if (it.mesh) {
        it.mesh.visible = d < maxD;
        if (it.mesh.visible) vis++;
        // 詳細地形の読み込みで地表が変わったら置き直す
        if (it.kind !== 'bridge' && this.frame % 60 === 0) {
          const y = this._groundY(it);
          if (Math.abs(y - it.mesh.position.y) > 0.003) {
            it.mesh.position.y = y;
            it.mesh.updateMatrix();
          }
        }
      }
    }
    this.building = false;
    this.stats.visible = vis;
  }

  /** ラベル項目（labels.js の addItems 形式） */
  labelItems() {
    return this.items.map((it) => ({
      id: it.id,
      name: it.name,
      sub: it.connects ? it.connects.map((s) => s.replace(/（.*）/, '')).join(' – ') : null,
      type: 'landmark',
      x: it.x,
      z: it.z,
      // ラベルはモデルの頂部の少し上
      getY: (ground) => (it.labelY != null ? it.labelY : ground + (it.mesh ? it.height : 0.3) + 0.06),
      maxDist: LABEL_DIST[it.tier] ?? 120,
      prio: it.tier === 1 ? 3.7 : 2.6,
      nearDist: 40,
      prioNear: 5.6,
      wExtra: 16,
      meta: it,
    }));
  }
}

/** 生成前に使う除外半径の目安 [km]（都市メッシュより先に決める必要があるため） */
const EXCLUDE_GUESS = {
  skytree: 0.3, tokyoTower: 0.32, temple: 0.6, castleNagoya: 0.5, castleHimeji: 0.7, castleKumamoto: 0.7,
  twinTowers: 0.38, kyotoTower: 0.28, kinkaku: 0.42, ferrisWheel: 0.35, itsukushima: 0.7, kibitsu: 0.5, fukuokaTower: 0.32,
};
