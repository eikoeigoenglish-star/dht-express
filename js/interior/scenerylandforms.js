/**
 * interior/scenerylandforms.js — 【v18】3 区間専用の地形・配置（scenerythemes.js から必要になったときだけ呼ぶ）
 * ---------------------------------------------------------------------------
 * 対象 sceneId（km 帯・割り当ては変えない）
 *   sea_left_mountain_right（81–110 小田原〜熱海）
 *     左 coast_town … 線路から海へ落ちる急斜面＋斜面に建つ白いホテル・マンション＋海へ突き出す岬の緑＋近い海
 *     右 cliff_cut  … 線路沿いの切通し（岩肌・法面）＋生い茂る木々＋切れ目の奥に急峻な山
 *   fuji_right（111–170 富士・吉原〜三島）
 *     右 fuji_plain … 田畑・用水路と川・倉庫や工場・家がぽつぽつ。遠景に青く霞む富士山（広い裾野）＋右に愛鷹の山並み
 *     左 fuji_shore_plain … 平地に家がぽつぽつ、地平線にわずかな海、列車後方に伊豆半島の青い山影
 *   biwako_fields（401–450 米原〜京都）
 *     左 suzuka_fields … 田園・平地・工場の向こうに鈴鹿山脈
 *     右 biwa_plain … 田園・平地・家がぽつぽつ、控えめな比叡山系（従来の 1/4 の高さ）
 *
 * すべて既存の流儀のまま：LoopLayer（同じチャンクを並べ替えるだけ）・PartBin で 1 マテリアル 1 メッシュに結合・
 * 頂点カラーの低ポリ・影なし。動かない遠景（富士山・山影）は 1 メッシュ（MeshBasic・fog なし）。
 */
import * as THREE from 'three';
import { box, PartBin, trs, rng } from './kit.js';
import { LoopLayer, periodicNoise, canvasTex } from './scenery.js';

const sstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/** 周期 W の 0..1 のこぶ（中心 c・幅 w は W に対する割合） */
const bump = (x, W, c, w) => {
  let dx = Math.abs(x / W - c);
  dx = Math.min(dx, 1 - dx);
  return Math.exp(-((dx / w) ** 2));
};

/* ==================================================================== */
/* 共通：x（流れる向き）× d（窓からの距離）の格子の地形帯                    */
/* ==================================================================== */
/**
 * @param th SceneryThemes
 * @param {{ W:number, nx:number, rows:number[], y:(x:number,d:number,j:number)=>number, color:(x:number,d:number,y:number,j:number,c:THREE.Color)=>void, name:string }} o
 */
function strip(th, z, xc, o) {
  const vtx = [];
  const c = new THREE.Color();
  for (let j = 0; j < o.rows.length; j++) {
    const row = [];
    for (let i = 0; i <= o.nx; i++) {
      const x = (i / o.nx) * o.W;
      const d = o.rows[j];
      const y = o.y(x, d, j);
      o.color(x, d, y, j, c);
      row.push([x, y, z(d), c.r, c.g, c.b]);
    }
    vtx.push(row);
  }
  const pos = [];
  const col = [];
  // 右舷（窓の外が -Z）は巻き順を逆に：窓から見える面を表面にする（裏面だと DoubleSide の法線反転で下向き＝暗くなる）
  const flip = z(1) < z(0);
  for (let j = 0; j < o.rows.length - 1; j++) {
    for (let i = 0; i < o.nx; i++) {
      const a = vtx[j][i];
      const b = vtx[j][i + 1];
      const d = vtx[j + 1][i];
      const e = vtx[j + 1][i + 1];
      for (const t of flip ? [a, b, d, b, e, d] : [a, d, b, b, d, e]) {
        pos.push(t[0], t[1], t[2]);
        col.push(t[3], t[4], t[5]);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  // 法線を上向きへ寄せる：窓を向いた急斜面が日陰色（半球光の地面色）で灰色にくすまないように。
  // 面ごとの陰影は 4 割残す（低ポリの立体感）
  const nr = g.attributes.normal;
  const v = new THREE.Vector3();
  for (let i = 0; i < nr.count; i++) {
    v.fromBufferAttribute(nr, i);
    if (v.y < 0) v.negate();
    v.multiplyScalar(o.shade ?? 0.4).y += 1 - (o.shade ?? 0.4);
    v.normalize();
    nr.setXYZ(i, v.x, v.y, v.z);
  }
  const sc = th.sc;
  const L = new LoopLayer(g, th.mats.hill, o.W, o.name, { reach: sc.reach, front: sc.front });
  sc.layers.push({ layer: L, xc });
  sc.group.add(L.group);
}

/** 窓テクスチャの壁（屋上・底面は窓なし） */
function wallBox(w, h, dep) {
  const g = box(w, h, dep);
  const u = g.attributes.uv;
  for (let k = 8; k < 16; k++) u.setXY(k, 0.05, 0.05);
  return g;
}

/* ==================================================================== */
/* 81–110 左：海沿いの急斜面と斜面の街（小田原〜熱海）                         */
/* ==================================================================== */
const COAST_W = 6000;
/** 斜面の高さ（街の地面 cy からの高さ）。線路際 ≒ 線路の高さ → 海岸線 cl(x) で崖になって海へ */
function coastField(seed) {
  const W = COAST_W;
  const nCl = periodicNoise(W, seed + 11, [[4, 0.5], [9, 0.3], [21, 0.15]]);
  const nR = periodicNoise(W, seed + 12, [[13, 0.5], [29, 0.3], [57, 0.2]]);
  const heads = [
    { c: 0.1, w: 0.045, h: 125 },
    { c: 0.43, w: 0.06, h: 95 },
    { c: 0.76, w: 0.04, h: 150 },
  ];
  const head = (x) => heads.reduce((m, H) => Math.max(m, bump(x, W, H.c, H.w) * H.h), 0);
  const headK = (x) => heads.reduce((m, H) => Math.max(m, bump(x, W, H.c, H.w * 1.25)), 0);
  /** 海岸線までの距離：入り江（街）は近く、岬は沖へ張り出す */
  const cl = (x) => 360 + 90 * nCl(x) + 520 * headK(x);
  const h = (x, d) => {
    const C = cl(x);
    if (d > C) return -4;
    const t = d / C;
    // 線路際（≒ 44 m）から海へ。上の方は急、下の方は少し緩く
    let y = 43 * Math.pow(1 - sstep(0, 1, t), 1.25) + 7 * nR(x) * (1 - t);
    // 岬：線路の後ろから海へ下る緑の尾根（線路より高く盛り上がる）
    const hk = head(x);
    if (hk > 1) y = Math.max(y, hk * (1 - 0.75 * sstep(0.05, 1, t)) + 18 * (1 - t));
    // 海岸の崖：最後の 50 m で落ちる
    y *= 1 - sstep(C - 55, C, d) * 0.92;
    return Math.max(-4, y);
  };
  return { W, h, cl, headK };
}

export function buildCoastSlope(th, s, z, cy, xc, seed) {
  const F = coastField(seed);
  const rows = [3, 15, 40, 80, 130, 190, 260, 340, 430, 530, 640, 760, 900, 1040, 1160];
  const cGrass = new THREE.Color('#7f9f58');
  const cGreen = new THREE.Color('#4f7d43');
  const cDark = new THREE.Color('#355f36');
  const cTown = new THREE.Color('#a9a79d');
  const cRock = new THREE.Color('#8b8676');
  strip(th, z, xc, {
    name: 'coast-slope',
    W: F.W,
    nx: 600,
    rows,
    y: (x, d) => cy + F.h(x, d),
    color: (x, d, y, j, c) => {
      const hh = y - cy;
      const town = (1 - F.headK(x)) * (d < F.cl(x) - 60 ? 1 : 0);
      if (j === 0) c.copy(cGrass);
      else if (hh < 7) c.copy(cRock); // 海岸の岩・護岸
      else c.copy(cGreen).lerp(cDark, Math.min(1, hh / 140));
      if (j > 0 && hh >= 7) c.lerp(cTown, 0.55 * town); // 斜面の街（建物の足元は灰色がち）
      if ((Math.floor(x / 23) + j * 3) % 7 === 0) c.multiplyScalar(0.92);
    },
  });
}

export function buildSlopeTown(th, s, z, cy, xc, seed, lite) {
  const F = coastField(seed);
  const sc = th.sc;
  const r = rng(seed * 41 + 3);
  const bin = new PartBin();
  const walls = [0xf4f1e8, 0xece6d6, 0xe2dccc, 0xd5d8d6, 0xf7f4ec, 0xd9cdb8, 0xc6ccce];
  const roofs = [0x6b6b66, 0x5b6168, 0x7a5a4c, 0x8a8478];
  const n = lite ? 900 : 1100;
  for (let i = 0; i < n; i++) {
    const x = r() * F.W;
    const C = F.cl(x);
    const town = 1 - F.headK(x);
    if (r() > 0.1 + 0.9 * town) continue; // 岬の上はまばら
    const d = 26 + Math.pow(r(), 1.15) * Math.max(40, C - 80);
    const g0 = F.h(x, d);
    if (g0 < 3) continue;
    const roll = r();
    // 斜面の下（海寄り）ほど中高層のホテル・マンション
    const low = d / C;
    let floors;
    if (roll < 0.1 + 0.25 * low) floors = 7 + Math.floor(r() * 9);
    else if (roll < 0.45) floors = 3 + Math.floor(r() * 4);
    else floors = 2 + Math.floor(r() * 2);
    if (d < 70) floors = Math.min(floors, 5); // 窓のすぐ下は低く（海を隠さない）
    const w = floors > 6 ? 18 + r() * 22 : 9 + r() * 10;
    const dep = floors > 6 ? 12 + r() * 10 : 8 + r() * 6;
    const hgt = floors * 3;
    const base = cy + g0 - 7; // 斜面に食い込ませる
    bin.add('building', wallBox(w, hgt + 7, dep), trs(x, base + (hgt + 7) / 2, z(d), 0, (r() - 0.5) * 0.25, 0), walls[Math.floor(r() * walls.length)]);
    if (floors <= 3) bin.add('solid', box(w + 0.6, 0.8, dep + 0.6), trs(x, base + hgt + 7.4, z(d)), roofs[Math.floor(r() * roofs.length)]);
    else if (r() < 0.5) bin.add('solid', box(w * 0.3, 2.6, dep * 0.3), trs(x, base + hgt + 8.3, z(d)), 0xbab8b0);
  }
  // 岬・斜面の木々（照葉樹のこんもりした緑）
  const nt = lite ? 170 : 240;
  for (let i = 0; i < nt; i++) {
    const x = r() * F.W;
    const C = F.cl(x);
    const hk = F.headK(x);
    if (r() > 0.25 + 0.75 * hk) continue;
    const d = 10 + r() * (C - 40);
    const g0 = F.h(x, d);
    if (g0 < 4) continue;
    const rr = 5 + r() * 7;
    bin.add('foliage', new THREE.IcosahedronGeometry(1, 1), trs(x, cy + g0 + rr * 0.45, z(d), 0, r() * 6, 0, [rr, rr * 0.8, rr]), [0x3f6f3d, 0x4f7f45, 0x2f5f35, 0x5b8a48][i % 4]);
  }
  sc._addLayer(bin, F.W, 'slope-town', xc);
}

/* ==================================================================== */
/* 81–110 右：切通し（岩肌・法面）と急峻な山                                  */
/* ==================================================================== */
const CUT_W = 4800;
function cutField(seed, ty, cy) {
  const W = CUT_W;
  const nEnv = periodicNoise(W, seed + 21, [[3, 0.45], [5, 0.3], [11, 0.2]]);
  const nR = periodicNoise(W, seed + 22, [[37, 0.5], [71, 0.3], [131, 0.2]]);
  const nH = periodicNoise(W, seed + 23, [[2, 0.35], [5, 0.3], [9, 0.2], [19, 0.1], [41, 0.05]]);
  const nP = periodicNoise(W, seed + 24, [[7, 0.5], [17, 0.3], [31, 0.2]]);
  /** 切通しの高さの係数：ときどき切れて谷が開く */
  const env = (x) => THREE.MathUtils.clamp(0.7 + 0.75 * nEnv(x), 0.08, 1);
  /** 線路の高さ ty からの高さ */
  const cut = (x, d) => {
    if (d <= 13) return -0.3;
    const k = env(x);
    // 線路際の砂利（d 13〜20）→ 擁壁・岩肌（d 20〜23 で 2.5〜4.7 m。View Room の窓は仰角 −8°〜+15° しか見えないので低めに）＋その上の木々に覆われた斜面（約 30°）
    const wall = (2.5 + 2.2 * k) * sstep(20, 23, d);
    const slope = Math.min(Math.max(0, d - 23), 110) * 0.22 * k; // 斜面は 110 m 先で頭打ち（その奥は hill）
    return wall + slope + 2.5 * nR(x) * sstep(23, 33, d);
  };
  /** 奥の急峻な山（街の地面 cy からの高さ） */
  const hill = (x, d) => {
    const prof = sstep(300, 1500, d) * (1 - 0.18 * sstep(1800, 2800, d));
    return 320 * prof * (0.72 + 0.32 * nH(x) + 0.12 * nP(x));
  };
  const y = (x, d) => (d <= 12.6 ? cy : ty + Math.max(cut(x, d), hill(x, d) - (ty - cy)));
  return { W, env, cut, y };
}

export function buildCliffCut(th, s, z, cy, xc, seed, ty, lite) {
  const F = cutField(seed, ty, cy);
  const rows = [12.6, 13, 19.8, 20.6, 23, 27, 33, 42, 54, 70, 92, 120, 160, 220, 300, 450, 700, 1050, 1500, 2100, 2800];
  const cRock = new THREE.Color('#5f6158');
  const cRock2 = new THREE.Color('#6d6b60');
  const cGravel = new THREE.Color('#8a8478');
  const cFrame = new THREE.Color('#a4a398'); // 法面のコンクリート枠
  const cMoss = new THREE.Color('#566a45');
  const cGreens = ['#66a253', '#56924a', '#74ad5c', '#5e9a4f'].map((h) => new THREE.Color(h));
  const cFar = new THREE.Color('#47714a');
  strip(th, z, xc, {
    name: 'cliff-cut',
    W: F.W,
    nx: 480,
    rows,
    y: (x, d) => F.y(x, d),
    color: (x, d, y, j, c) => {
      const prev = rows[Math.max(0, j - 1)];
      const steep = j > 1 ? (y - F.y(x, prev)) / Math.max(1, d - prev) : 0;
      const blk = Math.floor(x / 11);
      if (j <= 2) c.copy(cGravel); // 線路際の砂利（隣の線路の道床）
      else if (d <= 23.5 && steep > 0.3) {
        // 切通しの面：岩肌・苔・ところどころ法面の枠
        if (blk % 9 === 0 || blk % 9 === 1) c.copy(cFrame);
        else c.copy(blk % 3 ? cRock : cRock2).lerp(cMoss, ((blk * 7) % 5) / 9);
      } else if (d < 450) c.copy(cGreens[(blk + j) % cGreens.length]);
      else c.copy(cGreens[(blk + j) % 2]).lerp(cFar, Math.min(1, (d - 450) / 1600));
    },
  });
  // 生い茂る木々：切通しの肩・斜面・上の林
  const bin = new PartBin();
  const r = rng(seed * 43 + 9);
  const n = lite ? 260 : 420;
  for (let i = 0; i < n; i++) {
    const x = r() * F.W;
    const d = 26 + Math.pow(r(), 1.4) * 200;
    const yy = F.y(x, d);
    const rr = d < 40 ? 2.5 + r() * 2.5 : 4 + r() * 5;
    bin.add('foliage', new THREE.IcosahedronGeometry(1, 1), trs(x, yy + rr * 0.4, z(d), 0, r() * 6, 0, [rr, rr * 0.85, rr]), [0x3f6f3d, 0x4f7f45, 0x2f5f35, 0x5b8a48, 0x6a9450][i % 5]);
  }
  // 切通しの面を覆う低い茂み（草木に覆われた法面。三角形の少ない 20 面体）
  for (let i = 0; i < (lite ? 380 : 620); i++) {
    const x = r() * F.W;
    const d = 22 + r() * 40;
    const rr = 2.2 + r() * 2.8;
    bin.add('foliage', new THREE.IcosahedronGeometry(1, 0), trs(x, F.y(x, d) + rr * 0.2, z(d), r() * 0.5, r() * 6, 0, [rr * 1.4, rr, rr]), [0x5f9a4c, 0x4f8a44, 0x6fa85a, 0x3f7a3a, 0x7aa860][i % 5]);
  }
  // 線路際の草むら（切通しの足元）
  for (let i = 0; i < (lite ? 50 : 80); i++) {
    const x = r() * F.W;
    const rr = 1.2 + r() * 1.6;
    bin.add('foliage', new THREE.IcosahedronGeometry(1, 0), trs(x, ty - 0.2 + rr * 0.3, z(19 + r() * 1.5), 0, r() * 6, 0, [rr * 1.6, rr * 0.7, rr]), [0x6f9a4c, 0x5f8f4c][i % 2]);
  }
  th.sc._addLayer(bin, F.W, 'cliff-trees', xc);
}

/* ==================================================================== */
/* 富士の平地：用水路・川・倉庫・家                                            */
/* ==================================================================== */
export function buildCanals(th, s, z, cy, xc, seed, lite) {
  const sc = th.sc;
  const W = sc._W(900, s);
  const r = rng(seed * 47 + 1);
  const bin = new PartBin();
  const water = 0x3f6f8e;
  const edge = 0xbdbab0;
  const bank = 0x86a35a;
  // 線路に沿う用水路（コンクリート護岸）
  const dc = 42;
  bin.add('factory', box(W, 0.5, 7), trs(W / 2, cy + 1.45, z(dc)), water);
  for (const o of [-4, 4]) bin.add('factory', box(W, 1.0, 1.0), trs(W / 2, cy + 1.6, z(dc + o)), edge);
  // 線路から離れていく川（土手と葦）。チャンクに 2 本
  for (const fx of [0.27, 0.71]) {
    const x0 = fx * W;
    const len = 1100;
    const ang = (r() - 0.5) * 0.35;
    const cxm = x0 + Math.sin(ang) * len * 0.5;
    const dm = 50 + len / 2;
    const zz = z(dm);
    bin.add('factory', box(14, 0.5, len), trs(cxm, cy + 1.5, zz, 0, ang, 0), water);
    for (const o of [-10, 10]) bin.add('factory', box(6, 2.2, len), trs(cxm + o * Math.cos(ang), cy + 2.0, zz - o * Math.sin(ang) * s.facing, 0, ang, 0), bank);
    for (let k = 0; k < (lite ? 14 : 22); k++) {
      const t = r();
      const o = (r() < 0.5 ? -1 : 1) * (6 + r() * 3);
      const rr = 2 + r() * 2.5;
      bin.add('foliage', new THREE.IcosahedronGeometry(1, 0), trs(x0 + Math.sin(ang) * len * t + o, cy + 3 + rr * 0.3, z(50 + len * t), 0, r() * 6, 0, [rr, rr * 0.8, rr]), [0x9aa860, 0x7f9a4f, 0x5f8f4c][k % 3]);
    }
  }
  // 用水路沿いの並木
  for (let k = 0; k < (lite ? 18 : 30); k++) {
    const rr = 3 + r() * 3;
    bin.add('foliage', new THREE.IcosahedronGeometry(1, 1), trs(r() * W, cy + 1.5 + rr * 0.9, z(dc + 7 + r() * 4), 0, r() * 6, 0, [rr, rr * 1.1, rr]), [0x4f7f45, 0x5f8f4c, 0x6f9a4c][k % 3]);
  }
  sc.mats.factory = th.mats.factory;
  sc._addLayer(bin, W, 'canals', xc);
}

/** 倉庫・物流センター・工場の低い建屋（平地にまばら） */
export function buildWarehouses(th, s, z, cy, xc, seed, lite, o = {}) {
  const sc = th.sc;
  const d0 = o.d0 ?? 220;
  const d1 = o.d1 ?? 1600;
  const W = sc._W(d1, s);
  const r = rng(seed * 53 + (o.seedAdd ?? 0));
  const bin = new PartBin();
  const sheds = [0xe6e6e0, 0xd2d6d8, 0xc9ccce, 0xb8c4cc, 0xeeeeea, 0xa9b6c2];
  const n = Math.round((o.n ?? 26) * (lite ? 0.7 : 1));
  for (let i = 0; i < n; i++) {
    const x = r() * W;
    const d = d0 + Math.pow(r(), 0.8) * (d1 - d0);
    const w = 50 + r() * 110;
    const dep = 30 + r() * 50;
    const h = 9 + r() * 12;
    bin.add('factory', box(w, h, dep), trs(x, cy + h / 2, z(d)), sheds[Math.floor(r() * sheds.length)]);
    bin.add('factory', box(w + 1.5, 1.2, dep + 1.5), trs(x, cy + h + 0.6, z(d)), r() < 0.7 ? 0x7f8c96 : 0x5d7a8c);
    if (r() < 0.35) {
      // 事務棟
      const h2 = h + 6 + r() * 8;
      bin.add('factory', box(20, h2, 14), trs(x + w / 2 + 12, cy + h2 / 2, z(d)), 0xf2f1ec);
    }
  }
  sc.mats.factory = th.mats.factory;
  sc._addLayer(bin, W, o.name ?? 'warehouses', xc);
}

/** 平地に家がぽつぽつ（2 階建て中心、ときどき 3〜5 階のアパート）。o.n = チャンクあたりの軒数 */
export function buildHouses(th, s, z, cy, xc, seed, lite, o = {}) {
  const sc = th.sc;
  const d0 = o.d0 ?? 60;
  const d1 = o.d1 ?? 2400;
  const W = sc._W(Math.min(d1, 1800), s);
  const r = rng(seed * 59 + 7);
  const bin = new PartBin();
  const walls = [0xf0eee8, 0xe4e1da, 0xd9d0c2, 0xcfc8bb, 0xe8dfd0];
  const roofs = [0x5b6168, 0x4f5f70, 0x7a5a4c, 0x6b6b66, 0x8e4a3c];
  const n = Math.round((o.n ?? 260) * (lite ? 0.8 : 1));
  // 集落のまとまり（周期 W）
  const zone = periodicNoise(W, seed + 61, [[3, 0.5], [7, 0.3], [13, 0.2]]);
  for (let i = 0; i < n; i++) {
    const x = r() * W;
    if (r() > 0.45 + 0.5 * zone(x)) continue;
    const d = d0 + Math.pow(r(), 1.5) * (d1 - d0);
    const apt = r() < 0.08;
    const floors = apt ? 3 + Math.floor(r() * 3) : 1 + Math.floor(r() * 2);
    const w = apt ? 22 + r() * 14 : 8 + r() * 5;
    const dep = apt ? 10 + r() * 4 : 7 + r() * 4;
    const h = floors * 3;
    bin.add('building', wallBox(w, h, dep), trs(x, cy + h / 2, z(d)), walls[Math.floor(r() * walls.length)]);
    if (!apt) bin.add('solid', box(w + 0.8, 1.1, dep + 0.8), trs(x, cy + h + 0.55, z(d)), roofs[Math.floor(r() * roofs.length)]);
  }
  sc._addLayer(bin, W, o.name ?? 'houses', xc);
}

/* ==================================================================== */
/* 401–450 左：鈴鹿山脈（田園の向こうに連なる）                                */
/* ==================================================================== */
export function buildSuzuka(th, s, z, cy, xc, seed) {
  const W = 12000;
  const n1 = periodicNoise(W, seed + 71, [[2, 0.3], [5, 0.3], [11, 0.2], [23, 0.12], [47, 0.06]]);
  const n2 = periodicNoise(W, seed + 72, [[17, 0.5], [37, 0.3], [79, 0.2]]);
  const n3 = periodicNoise(W, seed + 73, [[3, 0.5], [7, 0.3], [15, 0.2]]);
  const rows = [1500, 1900, 2350, 2800, 3300, 3900, 4600, 5500];
  const prof = [0, 0.14, 0.22, 0.42, 0.78, 1.0, 0.92, 0.7];
  const cLow = new THREE.Color('#5a7d52');
  const cMid = new THREE.Color('#4a6a68');
  const cHigh = new THREE.Color('#4d6684');
  strip(th, z, xc, {
    name: 'suzuka',
    W,
    nx: 480,
    rows,
    y: (x, d, j) => {
      // 手前は低い丘（里山）、奥に主稜線。ところどころ高い峰（御在所・釈迦ヶ岳のイメージ）
      const H = 470 * (0.8 + 0.28 * n1(x) + 0.1 * n2(x));
      const foot = j >= 1 && j <= 3 ? 60 * Math.max(0, 0.4 + n3(x)) : 0;
      return cy + Math.max(0, H * prof[j] + foot) - (j === 0 ? 2 : 0);
    },
    color: (x, d, y, j, c) => {
      const t = Math.min(1, (y - cy) / 480);
      c.copy(cLow).lerp(cMid, Math.min(1, t * 1.6));
      if (j >= 4) c.lerp(cHigh, 0.35 + 0.15 * (j - 4));
    },
  });
}

/* ==================================================================== */
/* 富士山（遠景・動かない）：広い裾野の凹んだ輪郭。青く霞む山体＋春の雪          */
/* ==================================================================== */
/**
 * 雪冠のマスク（0 = 山肌 … 1 = 雪）。h = 高さの割合、a = 山の周りの角度 [rad]
 *   ・山頂付近はまとまって白い／雪線は左右非対称で低周波にうねる（円形・対称にしない）
 *   ・谷筋に沿って長さ・幅の違う雪の舌がところどころ下へ伸びる（本数は少なく、間隔は不規則）
 *   ・尾根の岩が出て雪が途切れる所がある
 *   境界は smoothstep でぼかし、頂点カラーの補間でなめらかに（三角形 1 枚ごとの色の段差を出さない）
 */
const FUJI_GULLIES = [
  // [角度, 幅, 下へ伸びる量]（角度は不規則に。手前（+Z ≒ π/2 付近）に多め）
  [0.55, 0.07, 0.15], [0.98, 0.045, 0.21], [1.27, 0.1, 0.09], [1.62, 0.05, 0.18],
  [1.86, 0.035, 0.12], [2.31, 0.085, 0.16], [2.74, 0.05, 0.1], [3.6, 0.09, 0.13], [4.9, 0.07, 0.15], [5.7, 0.06, 0.11],
];
const FUJI_OUTCROPS = [[1.12, 0.06, 0.07], [2.05, 0.08, 0.06], [2.52, 0.05, 0.08]]; // 雪が途切れる岩尾根
const angDist = (a, b) => {
  let d = Math.abs(a - b) % (Math.PI * 2);
  return d > Math.PI ? Math.PI * 2 - d : d;
};
function fujiSnow(h, a) {
  let edge = 0.795 + 0.05 * Math.sin(a + 0.7) + 0.026 * Math.sin(2 * a + 2.1) + 0.012 * Math.sin(5 * a + 0.3);
  let tongue = 0;
  for (const [c, w, L] of FUJI_GULLIES) tongue = Math.max(tongue, L * Math.exp(-((angDist(a, c) / w) ** 2)));
  // 輪郭（左右の稜線）の上には雪の舌を出さない（空を背にした細い白いギザギザになるため）
  const sA = Math.abs(Math.sin(a));
  tongue *= Math.min(1, Math.max(0, (sA - 0.3) / 0.35));
  // 雪の舌は先へ行くほど細く・まだらに（下端で切れ切れに）
  edge -= tongue * (0.75 + 0.25 * Math.sin(h * 60 + a * 9));
  for (const [c, w, k] of FUJI_OUTCROPS) edge += k * Math.exp(-((angDist(a, c) / w) ** 2)) * (h < 0.9 ? 1 : 0.2);
  const soft = 0.018 + 0.02 * tongue; // 雪線のぼかし幅
  const t = Math.min(1, Math.max(0, (h - (edge - soft)) / (2 * soft)));
  return t * t * (3 - 2 * t);
}

export function buildFuji(th, z, cy, xc, o) {
  const pts = [];
  const N = 72; // 【v18】山頂付近に輪を寄せて増やす（輪郭の式は同じ。雪線をなめらかにするため）
  const ut = 0.028; // 山頂の平らな部分（火口）の半径の割合
  const p = 2.05; // 裾野の広がり（大きいほど裾が平らに広がる）
  pts.push(new THREE.Vector2(o.R * 1.02, -40));
  for (let i = 0; i <= N; i++) {
    const sN = 1 - i / N; // 1（裾）→ 0（山頂）
    const u = ut + (1 - ut) * Math.pow(sN, 1.7); // 山頂側ほど細かく
    const y = o.H * Math.pow((1 - u) / (1 - ut), p);
    pts.push(new THREE.Vector2(o.R * u, y));
  }
  pts.push(new THREE.Vector2(o.R * ut * 0.55, o.H * 0.985)); // 火口のくぼみ
  pts.push(new THREE.Vector2(0.01, o.H * 0.985));
  const g = new THREE.LatheGeometry(pts, 144);
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const base = new THREE.Color('#9db0cb');
  const top = new THREE.Color('#7f95b8');
  // 雪：遠景の青みを受けた 3 段（明部・中間・影）。純白は使わない
  const snowLight = new THREE.Color('#e8eef6');
  const snowMid = new THREE.Color('#d0dae8');
  const snowShade = new THREE.Color('#b4c3d8');
  const c = new THREE.Color();
  const sc0 = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const h = pos.getY(i) / o.H;
    const a = Math.atan2(pos.getZ(i), pos.getX(i));
    const lit = Math.cos(a - 0.6); // -1..1（片側の斜面を明るく）
    c.copy(base).lerp(top, Math.min(1, Math.max(0, h) * 1.3));
    c.multiplyScalar(0.93 + 0.09 * lit);
    const k = h > 0.45 ? fujiSnow(h, a) : 0;
    if (k > 0) {
      if (lit > 0.2) sc0.copy(snowMid).lerp(snowLight, Math.min(1, (lit - 0.2) / 0.6));
      else sc0.copy(snowMid).lerp(snowShade, Math.min(1, (0.2 - lit) / 0.9));
      sc0.lerp(snowShade, 0.35 * (1 - Math.min(1, (h - 0.6) / 0.3))); // 下の方の雪は薄く山肌の青を受ける
      c.lerp(sc0, k);
    }
    col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, th.mats.far);
  m.position.set(xc + (o.dx ?? 0), cy, z(o.d));
  m.scale.set(1, 1, o.zs ?? 0.4); // 奥行きを縮める（手前の裾が平野へ出てこないように）
  m.name = 'theme-fuji';
  m.renderOrder = -3;
  th.sc.group.add(m);
  return m;
}

/* ==================================================================== */
/* 春の田園（田植え前後：苗の緑・水を張った田・耕した土・麦）                     */
/* ==================================================================== */
export function springFieldsTexture() {
  return canvasTex(512, 512, (g, S) => {
    const r = rng(7313);
    g.fillStyle = '#86a85c';
    g.fillRect(0, 0, S, S);
    const kinds = [
      ['#8cb05e', 0.24], ['#7fa758', 0.18], ['#97b866', 0.14], // 苗・草の緑
      ['#a3b9a8', 0.08], ['#9db3a6', 0.05], // 水を張った田（空を映す。淡く）
      ['#a08a66', 0.09], ['#937d5c', 0.06], // 耕した土
      ['#adbd6a', 0.09], ['#b7bf74', 0.07], // 麦の黄緑
    ];
    const pick = () => {
      let t = r();
      for (const [c, p] of kinds) if ((t -= p) <= 0) return c;
      return kinds[0][0];
    };
    let y = 0;
    while (y < S) {
      const h = 16 + Math.floor(r() * 24);
      let x = 0;
      while (x < S) {
        const w = 24 + Math.floor(r() * 46);
        const col = pick();
        g.fillStyle = col;
        g.fillRect(x, y, w, h);
        if (col === '#7aa653' || col === '#8fb35e') {
          // 苗の列
          g.fillStyle = 'rgba(60, 90, 40, 0.18)';
          for (let k = 2; k < w; k += 3) g.fillRect(x + k, y, 1, h);
        }
        g.fillStyle = 'rgba(80, 70, 45, 0.38)'; // あぜ道
        g.fillRect(x, y, w, 1.5);
        g.fillRect(x, y, 1.5, h);
        x += w;
      }
      y += h;
    }
    g.fillStyle = 'rgba(214, 205, 176, 0.65)'; // 農道
    for (let k = 0; k < 4; k++) g.fillRect(0, Math.floor(r() * S), S, 3);
    g.fillStyle = 'rgba(80, 125, 155, 0.6)'; // 水路
    for (let k = 0; k < 3; k++) g.fillRect(Math.floor(r() * S), 0, 2, S);
  }, { tile: 460 });
}
