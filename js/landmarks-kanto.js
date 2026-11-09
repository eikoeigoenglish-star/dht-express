/**
 * landmarks-kanto.js — 【v6】東京・神奈川・千葉のランドマーク 38 件（オリジナルの低ポリゴン・シンボリック表現）
 * ---------------------------------------------------------------------------
 * 方針（js/landmarks.js の既存ランドマークと同じ）
 *   ・Three.js の基本形状（箱・円柱・円錐台・押し出し）と、地表に沿わせた面（drape）だけで作る。
 *     外部の 3D モデル・テクスチャ・ロゴ・キャラクターは使っていない。
 *   ・精密な建築模型ではなく「広域 3D マップを飛んだとき、あれは○○だと分かる」シルエット優先。
 *     優先順位：シルエット > 位置 > 色・特徴 > 軽さ > 細部。
 *   ・小さなものは視認性のため実物より大きめ（塔：縦横 約 4 倍、小さな像・建物：〜10 倍）。
 *     ただし都市全体・山より大きくせず、近くの施設を隠さない大きさにとどめる。
 *   ・面積型（皇居・空港・明治神宮・テーマパーク・牧場など）は実寸に近い広さで、地表の起伏に沿わせて敷く。
 *   ・海上・埋立地で地形（1km 格子）が海になっている場所は、ランドマーク自身が低い「基盤（pad）」を持つ
 *     （地形データ自体は一切変更しない）。
 *   ・テーマパーク・テレビ局・球場・空港は、企業ロゴ・キャラクター・商標デザインを再現しない
 *     （城を想起させる一般的な塔、火山の形、色分けした区画、空港の滑走路など場所の識別に必要な要素だけ）。
 *
 * 1 件 = 部品をすべて GeoBuilder で 1 ジオメトリに結合 → draw call 1（共有マテリアル・頂点カラー）。
 *
 * ビルダー関数 (b, ctx) => { height }
 *   b   : GeoBuilder（minPart 付きで呼ばれると中距離用の簡略形になる）
 *   ctx : { ground(lx, lz) … モデル原点を基準にしたローカル位置の地表 Y（海は海面）,
 *           sea … 海面の Y（モデル原点基準）, it … landmarks.json の 1 件 }
 * ローカル座標：x = 東、z = 南（heading で回転、-Z が「正面」）。単位 km、Y はワールド単位（標高 m × 0.003）。
 */
import * as THREE from 'three';
import { GeoBuilder, mulberry32 } from './meshkit.js';

const C = {
  green: '#3f6b35', green2: '#4a7a3d', green3: '#58894a', forest: '#2f5a2c', lawn: '#7fa35a', pasture: '#93b864',
  water: '#3f7f98', moat: '#3b6f7e', stone: '#9a958c', stoneDark: '#6e6a63', gravel: '#cfc6ad', sand: '#d6c9a4',
  asphalt: '#4a4d52', apron: '#8d9095', airport: '#b9b8ae', white: '#f2f2ee', marking: '#f4f4ef',
  glass: '#5f7389', glassDark: '#46566a', glassLight: '#9fb6ca', steel: '#c6ccd0', silver: '#d3d8dc',
  concrete: '#cfcbc2', granite: '#c9c4ba', brick: '#b0482f', brickDark: '#8e3a27', roofGray: '#55606a', roofDark: '#3a3f44',
  copper: '#5f9e8a', vermilion: '#d4452b', wood: '#7a5a3c', cypress: '#5b4536', gold: '#f0c23a', black: '#26282b',
  bronze: '#5f7f73', redRoof: '#a8432e',
};

/* ====================================================================== */
/* 小道具                                                                  */
/* ====================================================================== */

const D2R = Math.PI / 180;
/** 方位（北=0°・時計回り、ローカル座標系）→ ローカルの単位ベクトル [x, z] */
const dirOf = (deg) => [Math.sin(deg * D2R), -Math.cos(deg * D2R)];

function inPoly(x, z, pts) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i];
    const [xj, zj] = pts[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

const ellipse = (cx, cz, rx, rz, n = 24, rot = 0) => {
  const out = [];
  const c = Math.cos(rot * D2R);
  const s = Math.sin(rot * D2R);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const x = Math.cos(a) * rx;
    const z = Math.sin(a) * rz;
    out.push([cx + x * c - z * s, cz + x * s + z * c]);
  }
  return out;
};

/** 中心 (cx, cz)・長さ方向の方位 deg・長さ L・幅 W の長方形 */
const rect = (cx, cz, deg, L, W) => {
  const [ux, uz] = dirOf(deg);
  const vx = -uz;
  const vz = ux;
  const h = L / 2;
  const w = W / 2;
  return [
    [cx - ux * h - vx * w, cz - uz * h - vz * w],
    [cx + ux * h - vx * w, cz + uz * h - vz * w],
    [cx + ux * h + vx * w, cz + uz * h + vz * w],
    [cx - ux * h + vx * w, cz - uz * h + vz * w],
  ];
};

/**
 * 地表に沿わせた面（滑走路・緑地・堀・広場など）。多角形を三角形分割し、各辺が step 以下になるまで二分して
 * 頂点ごとに高さ h(x, z) を与える。既定は地表 + off。
 */
function drape(b, ctx, pts, color, o = {}) {
  const off = o.off ?? 0.012;
  const step = o.step ?? 0.15;
  const H = o.h ?? ((x, z) => ctx.ground(x, z) + off);
  const contour = pts.map(([x, z]) => new THREE.Vector2(x, z));
  const tris = THREE.ShapeUtils.triangulateShape(contour, []);
  const out = [];
  const push = (a, c, d) => {
    const cy = (c[2] - a[2]) * (d[0] - a[0]) - (c[0] - a[0]) * (d[2] - a[2]);
    if (cy < 0) [c, d] = [d, c];
    for (const p of [a, c, d]) out.push(p[0], H(p[0], p[2]), p[2]);
  };
  const sub = (a, c, d, depth) => {
    const l1 = Math.hypot(c[0] - a[0], c[2] - a[2]);
    const l2 = Math.hypot(d[0] - c[0], d[2] - c[2]);
    const l3 = Math.hypot(a[0] - d[0], a[2] - d[2]);
    const m = Math.max(l1, l2, l3);
    if (m <= step || depth > 12) return push(a, c, d);
    const mid = (p, q) => [(p[0] + q[0]) / 2, 0, (p[2] + q[2]) / 2];
    if (m === l1) {
      const n = mid(a, c);
      sub(a, n, d, depth + 1);
      sub(n, c, d, depth + 1);
    } else if (m === l2) {
      const n = mid(c, d);
      sub(a, c, n, depth + 1);
      sub(a, n, d, depth + 1);
    } else {
      const n = mid(d, a);
      sub(a, c, n, depth + 1);
      sub(n, c, d, depth + 1);
    }
  };
  for (const [i, j, k] of tris) sub([pts[i][0], 0, pts[i][1]], [pts[j][0], 0, pts[j][1]], [pts[k][0], 0, pts[k][1]], 0);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  b.add(g, color);
}

/** 多角形の縁に沿った縦の帯（島・埋立地の護岸、海面下まで） */
function skirt(b, ctx, pts, color, H, bottom, step = 0.15) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const [x0, z0] = pts[i];
    const [x1, z1] = pts[(i + 1) % pts.length];
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / step));
    for (let k = 0; k < n; k++) {
      const ax = x0 + ((x1 - x0) * k) / n;
      const az = z0 + ((z1 - z0) * k) / n;
      const cx = x0 + ((x1 - x0) * (k + 1)) / n;
      const cz = z0 + ((z1 - z0) * (k + 1)) / n;
      const ya = H(ax, az);
      const yc = H(cx, cz);
      // 両面（向きを気にせず外からも内からも見える）
      out.push(ax, ya, az, ax, bottom, az, cx, yc, cz, cx, yc, cz, ax, bottom, az, cx, bottom, cz);
      out.push(ax, ya, az, cx, yc, cz, ax, bottom, az, cx, yc, cz, cx, bottom, cz, ax, bottom, az);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  b.add(g, color);
}

/** 埋立地・人工島の基盤：上面は「地表 + 少し」と「海面 + top」の高い方、縁は海面下までの護岸 */
function pad(b, ctx, pts, color, side, o = {}) {
  const top = o.top ?? 0.014;
  const H = (x, z) => Math.max(ctx.ground(x, z) + (o.off ?? 0.008), ctx.sea + top);
  drape(b, ctx, pts, color, { h: H, step: o.step ?? 0.2 });
  if (side) skirt(b, ctx, pts, side, H, ctx.sea - 0.07, o.step ?? 0.2);
  return H;
}

/** 楕円の筒（中空の輪）。rx, rz は外側の半径、w は肉厚 */
function ringE(b, rx, rz, w, h, color, x = 0, y = 0, z = 0, seg = 24) {
  const s = new THREE.Shape();
  s.absellipse(0, 0, rx, rz, 0, Math.PI * 2, false);
  const hole = new THREE.Path();
  hole.absellipse(0, 0, rx - w, rz - w, 0, Math.PI * 2, true);
  s.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false, curveSegments: seg });
  g.rotateX(-Math.PI / 2);
  b.add(g, color, GeoBuilder.mat(x, y, z));
}

/** 楕円柱・楕円錐台（底面中心） */
function cylE(b, rx, rz, h, topFrac, seg, color, x = 0, y = 0, z = 0, ry = 0) {
  const g = new THREE.CylinderGeometry(topFrac, 1, h, seg);
  g.translate(0, h / 2, 0);
  b.add(g, color, GeoBuilder.mat(x, y, z, ry, 0, 0, rx, 1, rz));
}

/** 半楕円体のドーム（底面中心） */
function dome(b, rx, h, rz, color, x = 0, y = 0, z = 0, seg = 20, rings = 7) {
  const g = new THREE.SphereGeometry(1, seg, rings, 0, Math.PI * 2, 0, Math.PI / 2);
  b.add(g, color, GeoBuilder.mat(x, y, z, 0, 0, 0, rx, h, rz));
}

/** 球（中心指定） */
function ball(b, r, color, x, y, z, seg = 14, sy = 1) {
  const g = new THREE.SphereGeometry(r, seg, Math.max(6, seg >> 1));
  b.add(g, color, GeoBuilder.mat(x, y, z, 0, 0, 0, 1, sy, 1));
}

/** a → c を結ぶ水平〜傾斜した板（桁・道路） */
function slab(b, ax, ay, az, cx, cy, cz, w, t, color) {
  const dx = cx - ax;
  const dz = cz - az;
  const h = Math.hypot(dx, dz);
  const dy = cy - ay;
  const len = Math.hypot(h, dy);
  if (len < 1e-6) return;
  const g = new THREE.BoxGeometry(w, t, len);
  g.translate(0, -t / 2, 0);
  b.add(g, color, GeoBuilder.mat((ax + cx) / 2, (ay + cy) / 2, (az + cz) / 2, Math.atan2(dx, dz), -Math.atan2(dy, h)));
}

/** 地表に沿った細い帯（道路・参道・柵）。区間ごとに地表へ合わせる */
function path(b, ctx, pts, w, color, off = 0.014, step = 0.1) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, z0] = pts[i];
    const [x1, z1] = pts[i + 1];
    const poly = rect((x0 + x1) / 2, (z0 + z1) / 2, Math.atan2(x1 - x0, -(z1 - z0)) / D2R, Math.hypot(x1 - x0, z1 - z0) + w * 0.6, w);
    drape(b, ctx, poly, color, { off, step });
  }
}

/** 多角形の中にランダムな木（円錐）を n 本 */
function trees(b, ctx, poly, n, seed, o = {}) {
  const rng = mulberry32(seed);
  const xs = poly.map((p) => p[0]);
  const zs = poly.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const z0 = Math.min(...zs);
  const z1 = Math.max(...zs);
  const r = o.r ?? 0.03;
  const h = o.h ?? 0.05;
  const cols = o.colors ?? [C.forest, C.green, C.green2];
  let placed = 0;
  for (let k = 0; k < n * 8 && placed < n; k++) {
    const x = x0 + (x1 - x0) * rng();
    const z = z0 + (z1 - z0) * rng();
    if (!inPoly(x, z, poly)) continue;
    if (o.avoid && o.avoid(x, z)) continue;
    const sc = 0.75 + rng() * 0.5;
    b.cyl(0, r * sc, h * sc, 6, cols[placed % cols.length], x, ctx.ground(x, z) - 0.004, z, rng() * 3);
    placed++;
  }
}

/** 足元の地表（周囲 r の最小値）。斜面でも浮かないように少し沈める */
const footY = (ctx, x, z, r = 0.03) =>
  Math.min(ctx.ground(x, z), ctx.ground(x + r, z), ctx.ground(x - r, z), ctx.ground(x, z + r), ctx.ground(x, z - r)) - 0.006;

/** 船体の平面形（-Z が船首）。L 長さ・W 幅 */
const hullPlan = (L, W, x = 0, z = 0) => [
  [x, z - L / 2],
  [x + W * 0.42, z - L * 0.3],
  [x + W / 2, z - L * 0.05],
  [x + W / 2, z + L * 0.38],
  [x + W * 0.32, z + L / 2],
  [x - W * 0.32, z + L / 2],
  [x - W / 2, z + L * 0.38],
  [x - W / 2, z - L * 0.05],
  [x - W * 0.42, z - L * 0.3],
];

/** 平面形 pts を y から高さ h だけ立ち上げる（plate の任意高さ版） */
const prism = (b, pts, h, color, y) => b.plate(pts, h, color, y);

/** 観覧車（コスモクロック21・八景島） */
function wheel(b, o) {
  const { R, cy, rim, rim2, spoke, gondolas, gCols, gSize, x = 0, z = 0, legSpan, legColor, hub } = o;
  const m = GeoBuilder.mat(x, cy, z);
  b.add(new THREE.TorusGeometry(R, R * 0.035, 6, 48), rim, m);
  b.add(new THREE.TorusGeometry(R * 0.93, R * 0.024, 5, 48), rim2, GeoBuilder.mat(x, cy, z));
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    b.beam(x, cy, z, x + Math.cos(a) * R, cy + Math.sin(a) * R, z, R * 0.018, spoke);
  }
  for (let i = 0; i < gondolas; i++) {
    const a = (i / gondolas) * Math.PI * 2;
    b.box(gSize, gSize, gSize, gCols[i % gCols.length], x + Math.cos(a) * (R + gSize * 0.6), cy + Math.sin(a) * (R + gSize * 0.6) - gSize / 2, z);
  }
  for (const sz of [-1, 1]) {
    b.beam(x - legSpan, 0, z + sz * R * 0.28, x, cy, z + sz * R * 0.06, R * 0.06, legColor);
    b.beam(x + legSpan, 0, z + sz * R * 0.28, x, cy, z + sz * R * 0.06, R * 0.06, legColor);
  }
  if (hub) hub(cy);
}

/** 和風の多層塔（三重塔など） */
function pagodaK(b, x, y0, z, s, tiers, base, tierH, wall, roof) {
  let y = 1.5;
  b.box(base * 1.25 * s, 1.5 * s, base * 1.25 * s, C.stone, x, y0, z);
  for (let i = 0; i < tiers; i++) {
    const w = base * (1 - i * 0.08);
    b.box(w * s, (tierH - 1.8) * s, w * s, wall, x, y0 + y * s, z);
    y += tierH - 1.8;
    b.hip(w * 1.95 * s, w * 1.95 * s, 1.8 * s, 0.5, roof, x, y0 + y * s, z);
    y += 1.8;
  }
  b.cyl(0.3 * s, 0.8 * s, 10 * s, 6, '#b89647', x, y0 + y * s, z);
  return y0 + (y + 10) * s;
}

/** 鳥居（明神鳥居の簡略形）。幅方向 = ローカル x（ry で回転） */
function torii(b, x, y, z, w, h, color, ry = 0, kasagi = C.black) {
  const c = Math.cos(ry);
  const s = Math.sin(ry);
  const P = (u) => [x + u * c, z - u * s];
  const t = w * 0.07;
  for (const u of [-w * 0.36, w * 0.36]) {
    const [px, pz] = P(u);
    b.cyl(t * 0.55, t * 0.62, h, 8, color, px, y, pz);
  }
  b.box(w * 0.86, t * 0.7, t * 0.7, color, x, y + h * 0.72, z, ry);
  b.box(w * 1.1, t * 0.9, t * 1.2, kasagi, x, y + h, z, ry);
  b.box(w * 1.0, t * 0.6, t, color, x, y + h - t * 0.6, z, ry);
}

/* ====================================================================== */
/* 東京                                                                    */
/* ====================================================================== */

/** 皇居：堀・石垣・森・宮殿（面積型）。都心の市街地の中に「緑と堀の大きな島」として見える */
function imperialPalace(b, ctx) {
  const G = [[0, -0.7], [0.42, -0.62], [0.56, -0.2], [0.53, 0.3], [0.36, 0.62], [0.0, 0.7], [-0.38, 0.6], [-0.6, 0.18], [-0.56, -0.42], [-0.26, -0.67]];
  const moat = G.map(([x, z]) => [x * 1.13, z * 1.11]);
  drape(b, ctx, moat, C.moat, { off: 0.006, step: 0.12 });
  drape(b, ctx, G, C.green2, { off: 0.014, step: 0.12 });
  // 石垣（縁に沿った低い壁）
  for (let i = 0; i < G.length; i++) {
    const [x0, z0] = G[i];
    const [x1, z1] = G[(i + 1) % G.length];
    const n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.12);
    for (let k = 0; k < n; k++) {
      const ax = x0 + ((x1 - x0) * k) / n;
      const az = z0 + ((z1 - z0) * k) / n;
      const cx = x0 + ((x1 - x0) * (k + 1)) / n;
      const cz = z0 + ((z1 - z0) * (k + 1)) / n;
      const ya = ctx.ground(ax, az) + 0.026;
      const yc = ctx.ground(cx, cz) + 0.026;
      slab(b, ax, ya, az, cx, yc, cz, 0.022, 0.03, C.stone);
    }
  }
  // 皇居外苑（堀の東・南東の広場と松）
  const gaien = [[0.7, -0.05], [0.95, -0.02], [0.95, 0.62], [0.62, 0.86], [0.42, 0.82], [0.62, 0.38]];
  drape(b, ctx, gaien, C.gravel, { off: 0.012, step: 0.12 });
  trees(b, ctx, gaien, 22, 41, { r: 0.018, h: 0.03, colors: ['#3d6338', '#47703f'] });
  // 森（宮殿の周りを除く）
  const palace = [-0.12, 0.08];
  trees(b, ctx, G, 70, 7, { r: 0.04, h: 0.055, avoid: (x, z) => Math.hypot(x - palace[0], z - palace[1]) < 0.2 || Math.hypot(x - 0.28, z + 0.42) < 0.12 });
  // 宮殿（低く横に長い建物群・緑青の屋根）
  const py = footY(ctx, palace[0], palace[1], 0.1);
  drape(b, ctx, ellipse(palace[0], palace[1], 0.17, 0.12, 16), C.gravel, { off: 0.016, step: 0.08 });
  b.box(0.2, 0.03, 0.06, C.concrete, palace[0], py, palace[1] - 0.04);
  b.hip(0.23, 0.085, 0.028, 0.35, C.copper, palace[0], py + 0.03, palace[1] - 0.04);
  for (const sx of [-1, 1]) {
    b.box(0.05, 0.025, 0.14, C.concrete, palace[0] + sx * 0.09, py, palace[1] + 0.05);
    b.hip(0.07, 0.16, 0.022, 0.3, C.copper, palace[0] + sx * 0.09, py + 0.025, palace[1] + 0.05);
  }
  // 伏見櫓（南西の隅の白い櫓）
  const fx = -0.36;
  const fz = 0.5;
  const fy = footY(ctx, fx, fz) + 0.02;
  b.box(0.05, 0.03, 0.035, C.white, fx, fy, fz);
  b.hip(0.065, 0.05, 0.02, 0.3, C.roofDark, fx, fy + 0.03, fz);
  // 二重橋（正門の石橋）
  const by = ctx.ground(0.02, 0.75) + 0.02;
  b.box(0.04, 0.015, 0.11, C.stone, 0.02, by, 0.75);
  // 東御苑の天守台
  b.hip(0.08, 0.07, 0.035, 0.85, C.stone, 0.28, footY(ctx, 0.28, -0.42), -0.42);
  return { height: 0.1 };
}

/** 東京ドーム：白い大きなドーム屋根 */
function tokyoDome(b, ctx) {
  drape(b, ctx, ellipse(0, 0, 0.33, 0.31, 28), '#bfc1c2', { off: 0.014, step: 0.1 });
  const y = footY(ctx, 0, 0, 0.2);
  cylE(b, 0.235, 0.235, 0.075, 1, 32, '#d9dcde', 0, y, 0);
  b.cyl(0.24, 0.24, 0.012, 32, '#9aa2a8', 0, y + 0.07, 0);
  dome(b, 0.232, 0.095, 0.232, '#f7f8f9', 0, y + 0.08, 0, 32, 8);
  // 屋根の継ぎ目（膜屋根を想起させる薄い線）
  for (const r of [0.12, 0.19]) {
    const hy = 0.095 * Math.sqrt(1 - (r / 0.232) ** 2);
    b.add(new THREE.TorusGeometry(r, 0.0035, 4, 40), '#cfd5da', GeoBuilder.mat(0, y + 0.08 + hy, 0, 0, Math.PI / 2));
  }
  return { height: 0.18 };
}

/** 空港の共通部品：滑走路（舗装 + 白い標識） */
function runway(b, ctx, H, cx, cz, deg, L, W) {
  drape(b, ctx, rect(cx, cz, deg, L, W), C.asphalt, { h: (x, z) => H(x, z) + 0.006, step: 0.25 });
  const [ux, uz] = dirOf(deg);
  const mark = (t, len, wd, k = 0) => {
    const x = cx + ux * t + -uz * k;
    const z = cz + uz * t + ux * k;
    b.box(wd, 0.003, len, C.marking, x, H(x, z) + 0.006, z, Math.atan2(ux, uz));
  };
  // 中心線の破線
  const n = Math.floor(L / 0.25);
  for (let i = 1; i < n; i++) mark(-L / 2 + i * 0.25, 0.11, 0.008);
  // 両端の閾値標識（縞）
  for (const e of [-1, 1]) for (const k of [-0.36, -0.2, 0.2, 0.36]) mark(e * (L / 2 - 0.08), 0.1, 0.012, k * W);
}

/** 管制塔 */
function tower(b, x, y, z, h, cab = C.glassDark) {
  b.cyl(0.012, 0.016, h, 10, C.white, x, y, z);
  b.cyl(0.03, 0.022, 0.03, 12, cab, x, y + h, z);
  b.cyl(0.032, 0.032, 0.008, 12, C.white, x, y + h + 0.03, z);
  b.cyl(0.002, 0.002, 0.04, 4, C.white, x, y + h + 0.038, z);
}

/** 羽田空港：海に張り出した島。平行な A・C 滑走路、南の B、沖合の D、間にターミナル */
function haneda(b, ctx) {
  const base = [[-2.3, -1.95], [-0.7, -2.1], [1.75, -1.85], [2.05, -0.6], [2.05, 1.15], [1.45, 2.35], [-0.95, 2.45], [-2.45, 1.45]];
  const H = pad(b, ctx, base, C.airport, C.stone, { top: 0.014, step: 0.3 });
  // D 滑走路の島と連絡誘導路
  const dPad = rect(3.4, 2.45, 42.5, 3.3, 0.55);
  const HD = pad(b, ctx, dPad, C.airport, C.stone, { top: 0.014, step: 0.3 });
  drape(b, ctx, rect(2.45, 1.85, 120, 1.0, 0.12), C.apron, { h: (x, z) => Math.max(ctx.ground(x, z) + 0.008, ctx.sea + 0.016), step: 0.2 });
  // 芝地（滑走路の周り）
  drape(b, ctx, [[-1.95, -1.6], [-0.2, -1.75], [-0.25, 1.2], [-1.95, 1.2]], '#9db36d', { h: (x, z) => H(x, z) + 0.002, step: 0.3 });
  drape(b, ctx, [[0.8, -1.7], [1.7, -1.6], [1.75, 1.1], [0.75, 1.2]], '#9db36d', { h: (x, z) => H(x, z) + 0.002, step: 0.3 });
  // 滑走路（幅は視認性のため実物の約 2 倍）
  runway(b, ctx, H, -1.1, -0.2, 332, 3.0, 0.12); // A
  runway(b, ctx, H, 1.2, -0.1, 332, 3.36, 0.12); // C
  runway(b, ctx, H, -0.2, 1.85, 32.5, 2.5, 0.12); // B
  runway(b, ctx, HD, 3.4, 2.45, 42.5, 3.0, 0.12); // D（沖合）
  // エプロンとターミナル（T1・T2 は A と C の間、T3 は A の西）
  const apron = (cx, cz, L, W) => drape(b, ctx, rect(cx, cz, 332, L, W), C.apron, { h: (x, z) => H(x, z) + 0.004, step: 0.3 });
  apron(-0.15, -0.05, 1.3, 0.55);
  apron(0.45, -0.1, 1.2, 0.5);
  apron(-1.85, 0.75, 0.9, 0.45);
  const term = (cx, cz, L, h) => {
    const y = H(cx, cz);
    const ry = -332 * D2R;
    b.box(0.09, h, L, '#dfe3e6', cx, y, cz, ry);
    b.box(0.1, 0.008, L * 1.02, '#7f9aa8', cx, y + h, cz, ry); // 屋根
    // フィンガー（搭乗橋の桟橋）
    const [ux, uz] = dirOf(332);
    for (const t of [-0.35, 0, 0.35]) {
      const px = cx + ux * t * L;
      const pz = cz + uz * t * L;
      b.box(0.24, h * 0.55, 0.03, '#e7eaec', px, y, pz, ry);
    }
  };
  term(-0.3, -0.05, 0.75, 0.045); // T1
  term(0.6, -0.1, 0.7, 0.045); // T2
  term(-2.0, 0.75, 0.6, 0.05); // T3
  tower(b, 0.15, H(0.15, 0.45), 0.45, 0.33);
  // 駐車場・ビル（ターミナル間）
  b.box(0.18, 0.03, 0.12, '#c3c6c8', 0.15, H(0.15, 0.2), 0.2);
  return { height: 0.4 };
}

/** 成田空港：内陸の台地。平行な A（4000m）と B（2500m、北東にずれる）、間にターミナル。周りは緑地 */
function narita(b, ctx) {
  const fields = [[-2.6, -3.6], [1.2, -3.9], [2.9, -2.4], [2.6, 2.9], [-0.6, 3.3], [-2.9, 2.0]];
  drape(b, ctx, fields, '#a3b97b', { off: 0.01, step: 0.35 });
  const core = [[-1.65, -1.2], [-0.2, -2.6], [2.15, -3.3], [2.4, -0.6], [0.4, 2.6], [-1.6, 2.7]];
  drape(b, ctx, core, C.airport, { off: 0.013, step: 0.35 });
  const H = (x, z) => ctx.ground(x, z) + 0.013;
  runway(b, ctx, H, -1.0, 0.45, 333, 4.0, 0.12); // A
  runway(b, ctx, H, 1.55, -1.75, 333, 2.5, 0.12); // B
  const apron = (cx, cz, L, W) => drape(b, ctx, rect(cx, cz, 333, L, W), C.apron, { h: (x, z) => H(x, z) + 0.004, step: 0.3 });
  apron(0.25, -0.55, 1.1, 0.6);
  apron(0.05, 0.75, 1.0, 0.55);
  const ry = -333 * D2R;
  // 第1ターミナル：本館 + 円形のサテライト 2 つ
  const t1 = [0.35, -0.75];
  b.box(0.1, 0.05, 0.45, '#dfe3e6', t1[0], H(...t1), t1[1], ry);
  for (const [dx, dz] of [[0.32, -0.25], [0.22, 0.28]]) {
    const x = t1[0] + dx;
    const z = t1[1] + dz;
    b.cyl(0.075, 0.075, 0.03, 16, '#e3e6e8', x, H(x, z), z);
    b.cyl(0.078, 0.078, 0.006, 16, '#7f9aa8', x, H(x, z) + 0.03, z);
    slab(b, t1[0], H(...t1) + 0.03, t1[1], x, H(x, z) + 0.03, z, 0.025, 0.02, '#e7eaec');
  }
  // 第2ターミナル：本館 + 細長いサテライト
  const t2 = [0.1, 0.65];
  b.box(0.1, 0.05, 0.5, '#dfe3e6', t2[0], H(...t2), t2[1], ry);
  b.box(0.08, 0.008, 0.52, '#7f9aa8', t2[0], H(...t2) + 0.05, t2[1], ry);
  b.box(0.05, 0.03, 0.42, '#e7eaec', t2[0] + 0.33, H(t2[0] + 0.33, t2[1] + 0.1), t2[1] + 0.1, ry);
  // 第3ターミナル（LCC、低い横長）
  b.box(0.08, 0.03, 0.3, '#e9e4dc', -0.15, H(-0.15, 1.35), 1.35, ry);
  tower(b, 0.75, H(0.75, 0.15), 0.15, 0.27);
  // 周囲の森
  trees(b, ctx, fields, 60, 77, { r: 0.05, h: 0.06, avoid: (x, z) => inPoly(x, z, core) });
  return { height: 0.33 };
}

/** 東京都庁：2 本に分かれたツインタワー（第一本庁舎）＋ 第二本庁舎・議会棟・都民広場 */
function tocho(b, ctx) {
  const y = footY(ctx, 0, 0, 0.15);
  const G = C.granite;
  const band = (w, d, y0, y1, step, x = 0, z = 0) => {
    for (let yy = y0 + step * 0.6; yy < y1 - 0.01; yy += step) b.box(w + 0.006, 0.012, d + 0.006, C.glassDark, x, yy, z);
  };
  // 第一本庁舎：低層部〜33 階（幅広）→ 北塔・南塔（間を大きく空けて 2 本に分かれて見えるように）
  b.box(0.2, 0.66, 0.44, G, 0, y, 0);
  band(0.2, 0.44, y, y + 0.66, 0.075);
  b.box(0.16, 0.012, 0.46, '#9f9b93', 0, y + 0.66, 0); // 33 階の分岐部
  for (const sz of [-1, 1]) {
    const z = sz * 0.15;
    b.box(0.15, 0.32, 0.14, G, 0, y + 0.66, z);
    band(0.15, 0.14, y + 0.66, y + 0.98, 0.075, 0, z);
    b.box(0.11, 0.32, 0.1, C.glassDark, 0, y + 0.66, z - sz * 0.022); // 塔の内側の濃いガラス面
    b.cyl(0.065, 0.08, 0.04, 8, '#b9b5ad', 0, y + 0.98, z, Math.PI / 8); // 角を落とした頂部
    b.cyl(0.045, 0.065, 0.025, 8, '#a8a49c', 0, y + 1.02, z, Math.PI / 8);
  }
  // 第二本庁舎（南、段状）
  b.box(0.16, 0.48, 0.2, G, 0.05, y, 0.42);
  band(0.16, 0.2, y, y + 0.48, 0.075, 0.05, 0.42);
  b.box(0.12, 0.16, 0.14, G, 0.05, y + 0.48, 0.42);
  b.cyl(0.05, 0.06, 0.03, 8, '#b9b5ad', 0.05, y + 0.64, 0.42, Math.PI / 8);
  // 都民広場（半円）と議会棟（西）
  const plaza = [];
  for (let i = 0; i <= 12; i++) {
    const a = Math.PI / 2 + (i / 12) * Math.PI;
    plaza.push([-0.14 + Math.cos(a) * 0.16, Math.sin(a) * 0.16]);
  }
  drape(b, ctx, plaza, '#d2cbbb', { off: 0.014, step: 0.06 });
  b.box(0.12, 0.13, 0.3, G, -0.4, footY(ctx, -0.4, 0), 0);
  b.box(0.05, 0.05, 0.05, '#b9b5ad', -0.4, footY(ctx, -0.4, 0) + 0.13, 0);
  return { height: 1.06 };
}

/** 東京駅（丸の内駅舎）：赤レンガの長い 3 階建て、南北 2 つのドーム。長軸 = ローカル z */
function tokyoStation(b, ctx) {
  const y = footY(ctx, 0, 0, 0.2);
  const L = 0.62;
  const W = 0.065;
  b.box(W, 0.075, L, C.brick, 0, y, 0);
  // 白い帯（石材の水平線）
  for (const yy of [0.025, 0.05]) b.box(W + 0.004, 0.005, L + 0.004, '#ece5d6', 0, y + yy, 0);
  b.hip(W + 0.012, L + 0.012, 0.018, 0.4, '#4a5057', 0, y + 0.075, 0);
  // 南北のドーム（八角形）と中央部
  for (const sz of [-1, 1]) {
    const z = sz * 0.24;
    b.cyl(0.05, 0.05, 0.095, 8, C.brick, 0, y, z, Math.PI / 8);
    b.cyl(0.052, 0.052, 0.006, 8, '#ece5d6', 0, y + 0.06, z, Math.PI / 8);
    b.cyl(0.018, 0.053, 0.05, 8, '#3f454b', 0, y + 0.095, z, Math.PI / 8);
    b.cyl(0.0, 0.01, 0.02, 6, '#3f454b', 0, y + 0.145, z);
  }
  b.box(0.08, 0.085, 0.08, C.brick, 0, y, 0);
  b.hip(0.09, 0.09, 0.03, 0.2, '#4a5057', 0, y + 0.085, 0);
  // 駅前広場（丸の内側 = 西 = ローカル -x）
  drape(b, ctx, rect(-0.12, 0, 0, 0.3, 0.16), '#d5cfc2', { off: 0.014, step: 0.06 });
  return { height: 0.165 };
}

/** 国立競技場：上空から楕円のリング。木の軒（庇）が重なる外周、銀の屋根、トラックとフィールド */
function nationalStadium(b, ctx) {
  const y = footY(ctx, 0, 0, 0.25);
  const rx = 0.3;
  const rz = 0.25;
  drape(b, ctx, ellipse(0, 0, rx + 0.07, rz + 0.07, 32), '#cdc8bd', { off: 0.014, step: 0.1 });
  ringE(b, rx, rz, 0.1, 0.16, '#c7c3ba', 0, y, 0);
  // 3 段の木の庇と緑
  for (const [k, yy] of [[0, 0.05], [1, 0.1], [2, 0.15]]) {
    ringE(b, rx + 0.02 - k * 0.006, rz + 0.02 - k * 0.006, 0.035, 0.008, '#8b6a45', 0, y + yy, 0);
    ringE(b, rx + 0.022 - k * 0.006, rz + 0.022 - k * 0.006, 0.006, 0.012, C.green2, 0, y + yy + 0.008, 0);
  }
  ringE(b, rx - 0.01, rz - 0.01, 0.13, 0.012, '#d8dcdf', 0, y + 0.16, 0); // 屋根
  ringE(b, rx - 0.1, rz - 0.1, 0.06, 0.08, '#5d6670', 0, y, 0); // スタンド
  cylE(b, rx - 0.14, rz - 0.14, 0.012, 1, 32, '#b0563d', 0, y, 0); // トラック
  cylE(b, rx - 0.17, rz - 0.165, 0.014, 1, 32, '#4f8f3c', 0, y, 0); // フィールド
  return { height: 0.18 };
}

/** 東京ビッグサイト：4 つの逆ピラミッド（会議棟）＋ 横長の展示棟 */
function bigSight(b, ctx) {
  const y = footY(ctx, 0, 0, 0.15);
  drape(b, ctx, rect(0, 0.05, 0, 0.5, 0.42), '#c9c6bf', { off: 0.014, step: 0.1 });
  b.box(0.3, 0.06, 0.26, '#d9dcdf', 0, y, 0);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const x = sx * 0.075;
      const z = sz * 0.07;
      b.cyl(0.01, 0.01, 0.07, 8, '#8f979e', x * 1.25, y + 0.06, z * 1.25);
      b.hip(0.06, 0.06, 0.14, 2.6, sx * sz > 0 ? '#d3d8dc' : '#c3c9ce', x * 1.25, y + 0.11, z * 1.25); // 逆ピラミッド（上ほど広い）
      b.hip(0.155, 0.155, 0.008, 1.0, '#e4e7ea', x * 1.25, y + 0.25, z * 1.25);
    }
  // 東展示棟（東）・西展示棟（北西）
  for (let i = 0; i < 3; i++) {
    const x = 0.42 + i * 0.2;
    b.box(0.18, 0.055, 0.42, '#e3e5e6', x, footY(ctx, x, 0.05, 0.12), 0.05);
    b.hip(0.19, 0.43, 0.02, 0.2, '#b9c0c6', x, footY(ctx, x, 0.05, 0.12) + 0.055, 0.05);
  }
  b.box(0.3, 0.06, 0.22, '#e3e5e6', -0.38, footY(ctx, -0.38, -0.12, 0.12), -0.12);
  b.box(0.12, 0.08, 0.12, '#c6ccd2', -0.38, footY(ctx, -0.38, -0.12, 0.12) + 0.06, -0.12); // 西展示棟のアトリウム
  return { height: 0.27 };
}

/** フジテレビ本社：2 棟を格子状の通路でつなぎ、間に銀の球体展望室 */
function fujiTV(b, ctx) {
  const y = footY(ctx, 0, 0, 0.15);
  b.box(0.48, 0.05, 0.18, '#d5d9dd', 0, y, 0); // 基壇
  const Wc = '#e1e5e8';
  b.box(0.15, 0.42, 0.14, Wc, -0.16, y + 0.05, 0); // 西棟
  b.box(0.17, 0.46, 0.14, Wc, 0.16, y + 0.05, 0); // 東棟
  // 格子（空中回廊）
  for (const yy of [0.14, 0.24, 0.34, 0.44]) {
    b.box(0.17, 0.02, 0.03, '#b9c1c8', 0, y + yy, -0.05);
    b.box(0.17, 0.02, 0.03, '#b9c1c8', 0, y + yy, 0.05);
  }
  for (const x of [-0.04, 0.04]) for (const z of [-0.05, 0.05]) b.box(0.02, 0.32, 0.02, '#b9c1c8', x, y + 0.14, z);
  for (const x of [-0.16, 0.16]) for (const yy of [0.12, 0.22, 0.32]) b.box(x < 0 ? 0.155 : 0.175, 0.012, 0.145, '#6f8496', x, y + yy, 0);
  ball(b, 0.075, '#d2d6da', 0, y + 0.43, 0, 18); // 球体展望室
  return { height: 0.51 };
}

/** お台場の自由の女神像：台座 + 小さな像のシルエット（松明を掲げた姿） */
function libertyStatue(b, ctx) {
  const y = footY(ctx, 0, 0, 0.04);
  drape(b, ctx, ellipse(0, 0, 0.06, 0.06, 12), '#cfc8b8', { off: 0.014, step: 0.05 });
  b.box(0.04, 0.05, 0.04, C.stone, 0, y, 0);
  b.box(0.032, 0.012, 0.032, '#b3ada2', 0, y + 0.05, 0);
  const G = '#6fa898';
  b.cyl(0.008, 0.013, 0.055, 8, G, 0, y + 0.062, 0); // ローブ
  b.cyl(0.0075, 0.008, 0.012, 8, G, 0, y + 0.117, 0); // 肩
  ball(b, 0.0065, G, 0, y + 0.135, 0, 8); // 頭
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI - Math.PI / 2;
    b.beam(0, y + 0.138, 0, Math.sin(a) * 0.01, y + 0.146, -Math.cos(a) * 0.004 - 0.002, 0.0018, G); // 冠
  }
  b.beam(0.006, y + 0.12, 0, 0.011, y + 0.162, 0, 0.0045, G); // 掲げた右腕
  b.cyl(0.004, 0.003, 0.008, 6, G, 0.011, y + 0.162, 0);
  b.cyl(0.0, 0.004, 0.008, 6, C.gold, 0.011, y + 0.17, 0); // 松明
  b.box(0.008, 0.01, 0.004, '#8fb5a8', -0.008, y + 0.1, -0.006); // 書板
  return { height: 0.18 };
}

/** 渋谷スクランブル交差点：大きな交差点（横断歩道の縞）＋ 周囲の密な街並み */
function shibuyaCrossing(b, ctx) {
  const off = 0.016;
  drape(b, ctx, ellipse(0, 0, 0.17, 0.17, 16), C.asphalt, { off, step: 0.06 });
  // 放射状の道路
  for (const [deg, len] of [[320, 0.5], [20, 0.4], [95, 0.45], [205, 0.5], [255, 0.45]]) {
    const [ux, uz] = dirOf(deg);
    path(b, ctx, [[ux * 0.12, uz * 0.12], [ux * len, uz * len]], 0.075, C.asphalt, off - 0.001, 0.08);
  }
  // 横断歩道（4 辺 + 対角線の X）
  const stripe = (x, z, deg, len, w = 0.009) => b.box(w, 0.003, len, C.marking, x, ctx.ground(x, z) + off + 0.001, z, -deg * D2R + Math.PI / 2);
  const side = (cx, cz, deg) => {
    const [ux, uz] = dirOf(deg);
    for (let i = -4; i <= 4; i++) stripe(cx + ux * i * 0.022, cz + uz * i * 0.022, deg, 0.055);
  };
  side(0, -0.13, 90);
  side(0, 0.13, 90);
  side(-0.13, 0, 0);
  side(0.13, 0, 0);
  for (const deg of [45, 135]) {
    const [ux, uz] = dirOf(deg);
    for (let i = -5; i <= 5; i++) stripe(ux * i * 0.022, uz * i * 0.022, deg, 0.045, 0.008);
  }
  // 周囲の建物（色の付いた大型ビジョンは一般的な発光パネル。ロゴは描かない）
  const bld = (x, z, w, d, h, col, screen) => {
    const y = footY(ctx, x, z, 0.03);
    b.box(w, h, d, col, x, y, z);
    if (screen) b.box(w * 0.7, h * 0.35, 0.004, screen, x, y + h * 0.5, z + (z < 0 ? d / 2 : -d / 2) + (z < 0 ? 0.002 : -0.002));
  };
  bld(-0.22, -0.22, 0.12, 0.1, 0.12, '#cfd3d6', '#3fd0e8'); // 北西角（ガラスのビル＋大型ビジョン）
  bld(0.22, -0.22, 0.12, 0.11, 0.1, '#b9a98f', '#f05a8c');
  bld(-0.24, 0.2, 0.1, 0.1, 0.14, '#9aa7b3', '#ffc94a');
  b.cyl(0.05, 0.05, 0.12, 16, '#c8ccd0', -0.13, footY(ctx, -0.13, 0.27), 0.27); // 円筒形のビル（南西の角）
  b.box(0.012, 0.16, 0.012, '#e4e6e8', -0.13, footY(ctx, -0.13, 0.27), 0.218);
  bld(0.27, 0.12, 0.2, 0.1, 0.06, '#c2c5c7'); // 駅ビル（東）
  // 駅の東の超高層（展望施設のある高層ビル）
  const tx = 0.33;
  const tz = 0.02;
  const ty = footY(ctx, tx, tz, 0.05);
  b.box(0.1, 0.5, 0.09, '#8ea6be', tx, ty, tz);
  b.box(0.08, 0.06, 0.07, '#b7c3ce', tx, ty + 0.5, tz);
  // 細かい街区
  const rng = mulberry32(99);
  for (let i = 0; i < 26; i++) {
    const a = rng() * Math.PI * 2;
    const r = 0.3 + rng() * 0.22;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (Math.hypot(x - tx, z - tz) < 0.12) continue;
    const h = 0.04 + rng() * 0.1;
    bld(x, z, 0.06 + rng() * 0.04, 0.06 + rng() * 0.04, h, ['#d8d3c8', '#c9cdd2', '#b7bdc4', '#cfd5da'][i % 4]);
  }
  return { height: 0.58 };
}

/** 六本木ヒルズ森タワー：濃いガラスの太い高層塔、頂部の明るい冠 */
function moriTower(b, ctx) {
  const y = footY(ctx, 0, 0, 0.18);
  drape(b, ctx, rect(0, 0.05, 0, 0.55, 0.45), '#cbc6bb', { off: 0.014, step: 0.1 });
  b.box(0.42, 0.07, 0.34, '#bfc4c8', 0, y, 0.04);
  b.cyl(0.13, 0.155, 0.86, 12, '#56667a', 0, y + 0.07, 0, Math.PI / 12);
  for (let yy = 0.17; yy < 0.9; yy += 0.09) {
    const r = 0.155 - (0.025 * (yy - 0.07)) / 0.86 + 0.004;
    b.cyl(r, r, 0.012, 12, '#9aa9b8', 0, y + yy, 0, Math.PI / 12);
  }
  b.cyl(0.12, 0.13, 0.05, 12, '#c5ced6', 0, y + 0.93, 0, Math.PI / 12); // 展望部の冠
  b.cyl(0.09, 0.12, 0.03, 12, '#9aa6b2', 0, y + 0.98, 0, Math.PI / 12);
  b.box(0.06, 0.02, 0.06, '#d9dde0', 0, y + 1.01, 0);
  return { height: 1.04 };
}

/** 明治神宮：森（面積型）・参道・鳥居・本殿（回廊で囲まれた社殿） */
function meijiJingu(b, ctx) {
  const F = [[-0.45, -0.72], [0.1, -0.78], [0.45, -0.55], [0.5, 0.0], [0.44, 0.55], [0.28, 0.76], [-0.1, 0.7], [-0.45, 0.35], [-0.56, -0.2]];
  drape(b, ctx, F, '#2f5a2c', { off: 0.014, step: 0.12 });
  const route = [[0.32, 0.74], [0.29, 0.32], [0.06, 0.22], [0.0, 0.1]];
  path(b, ctx, route, 0.04, C.sand, 0.017, 0.06);
  path(b, ctx, [[0.06, 0.22], [-0.25, 0.3], [-0.42, 0.33]], 0.035, C.sand, 0.017, 0.06); // 北参道・西参道方向
  // 鳥居（木の色）
  const T = '#7a6a55';
  torii(b, 0.305, ctx.ground(0.305, 0.58) + 0.012, 0.58, 0.07, 0.065, T, 0, '#5d5244');
  torii(b, 0.17, ctx.ground(0.17, 0.27) + 0.012, 0.27, 0.08, 0.075, T, Math.PI / 2, '#5d5244'); // 大鳥居
  // 社殿（回廊で囲まれた中庭・楼門・本殿）
  const y = footY(ctx, 0, -0.05, 0.1) + 0.012;
  drape(b, ctx, rect(0, -0.05, 0, 0.17, 0.2), C.gravel, { off: 0.018, step: 0.05 });
  const R = 0.012;
  for (const [x, z, w, d] of [[0, -0.15, 0.2, R], [0, 0.05, 0.2, R], [-0.095, -0.05, R, 0.2], [0.095, -0.05, R, 0.2]]) {
    b.box(w, 0.018, d, '#e2d9c7', x, y, z);
    b.hip(w + 0.012, d + 0.012, 0.01, 0.3, C.copper, x, y + 0.018, z);
  }
  b.box(0.05, 0.03, 0.03, '#e2d9c7', 0, y, 0.05); // 南神門
  b.hip(0.07, 0.05, 0.016, 0.3, C.copper, 0, y + 0.03, 0.05);
  b.box(0.08, 0.03, 0.05, '#d8ccb4', 0, y, -0.08); // 本殿
  b.gable(0.075, 0.1, 0.035, C.copper, 0, y + 0.03, -0.08, Math.PI / 2);
  // 森の木
  trees(b, ctx, F, 90, 23, { r: 0.04, h: 0.06, avoid: (x, z) => (Math.abs(x) < 0.13 && z > -0.2 && z < 0.12) || Math.hypot(x - 0.3, z - 0.5) < 0.08 || Math.abs(x - 0.31) < 0.04 });
  return { height: 0.1 };
}

/** 代々木第一体育館：2 本の主柱から吊った曲面屋根（サドル形） */
function yoyogiGym(b, ctx) {
  const y = footY(ctx, 0, 0, 0.18);
  drape(b, ctx, ellipse(0, 0, 0.33, 0.2, 24), '#cfcabf', { off: 0.014, step: 0.08 });
  const A = 0.25;
  const Bw = 0.13;
  const UM = 0.66;
  const YM = 0.17;
  const ridge = (u) => (Math.abs(u) < UM ? 0.12 + (YM - 0.12) * (u / UM) ** 2 : YM * (1 - (Math.abs(u) - UM) / (1 - UM)) + 0.035 * ((Math.abs(u) - UM) / (1 - UM)));
  const NU = 30;
  const NV = 12;
  const P = [];
  for (let i = 0; i <= NU; i++) {
    const u = -1 + (2 * i) / NU;
    const half = Bw * Math.sqrt(Math.max(0.02, 1 - u * u));
    const row = [];
    for (let j = 0; j <= NV; j++) {
      const v = -1 + (2 * j) / NV;
      const swirl = 0.035 * Math.sin(Math.PI * u) * Math.sign(v); // 平面の「ねじれ」を少しだけ
      const yy = 0.035 + (ridge(u) - 0.035) * (1 - Math.abs(v) ** 1.7);
      row.push([A * u, y + yy, half * v + swirl]);
    }
    P.push(row);
  }
  const out = [];
  const tri = (a, c, d) => out.push(...a, ...c, ...d);
  for (let i = 0; i < NU; i++)
    for (let j = 0; j < NV; j++) {
      const p00 = P[i][j];
      const p10 = P[i + 1][j];
      const p01 = P[i][j + 1];
      const p11 = P[i + 1][j + 1];
      tri(p00, p01, p10);
      tri(p10, p01, p11);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  b.add(g, '#a9b4bb');
  // 外周の壁（屋根の縁から地面へ）
  const wall = [];
  for (const j of [0, NV]) {
    for (let i = 0; i < NU; i++) {
      const a = P[i][j];
      const c = P[i + 1][j];
      wall.push(a[0], a[1], a[2], a[0], y, a[2], c[0], c[1], c[2], c[0], c[1], c[2], a[0], y, a[2], c[0], y, c[2]);
      wall.push(a[0], a[1], a[2], c[0], c[1], c[2], a[0], y, a[2], c[0], c[1], c[2], c[0], y, c[2], a[0], y, a[2]);
    }
  }
  const gw = new THREE.BufferGeometry();
  gw.setAttribute('position', new THREE.Float32BufferAttribute(wall, 3));
  b.add(gw, '#d9d4ca');
  // 主柱と主ケーブル
  for (const s of [-1, 1]) {
    const x = s * A * UM;
    b.beam(x, y, -0.012, x, y + YM + 0.03, 0, 0.014, '#cfcac0');
    b.beam(x, y, 0.012, x, y + YM + 0.03, 0, 0.014, '#cfcac0');
    b.beam(x, y + YM + 0.03, 0, s * (A + 0.05), y, 0, 0.007, '#55606a');
  }
  for (let i = 0; i < NU; i++) {
    const u0 = -UM + (2 * UM * i) / NU;
    const u1 = -UM + (2 * UM * (i + 1)) / NU;
    b.beam(A * u0, y + ridge(u0) + 0.006, 0, A * u1, y + ridge(u1) + 0.006, 0, 0.007, '#55606a');
  }
  return { height: 0.21 };
}

/* ====================================================================== */
/* 神奈川                                                                  */
/* ====================================================================== */

/** 横浜ランドマークタワー：わずかに細くなる角柱と段状の頂部。市街地より明確に高い */
function lmTower(b, ctx) {
  const y = footY(ctx, 0, 0, 0.2);
  drape(b, ctx, rect(0.05, 0.05, 0, 0.6, 0.45), '#cfc8bb', { off: 0.014, step: 0.1 });
  b.box(0.5, 0.1, 0.32, '#cdbfae', 0.05, y, 0.06); // ランドマークプラザ
  const Gr = '#c9b8a8';
  b.hip(0.26, 0.26, 0.55, 0.88, Gr, 0, y + 0.1, 0);
  b.hip(0.229, 0.229, 0.4, 0.85, Gr, 0, y + 0.65, 0);
  for (let yy = 0.16; yy < 1.03; yy += 0.065) {
    const w = yy < 0.65 ? 0.262 - (yy - 0.1) * 0.06 : 0.229 - (yy - 0.65) * 0.085;
    b.box(w + 0.004, 0.014, w + 0.004, C.glassDark, 0, y + yy, 0);
  }
  b.box(0.17, 0.07, 0.17, C.glassDark, 0, y + 1.05, 0); // 段状の頂部
  b.box(0.13, 0.06, 0.13, Gr, 0, y + 1.12, 0);
  b.box(0.1, 0.03, 0.1, '#b7a796', 0, y + 1.18, 0);
  b.cyl(0.035, 0.035, 0.012, 12, '#e6e1d8', 0, y + 1.21, 0); // ヘリポート
  return { height: 1.24 };
}

/** コスモクロック21：大観覧車。中心に大きな時計盤（文字のない円盤）、色とりどりのゴンドラ */
function cosmoClock(b, ctx) {
  const y = footY(ctx, 0, 0, 0.1);
  const s = 0.0062;
  const R = 50 * s;
  b.box(0.32, 0.04, 0.16, '#e7e1d6', 0, y, 0);
  wheel(b, {
    R, cy: y + 62.5 * s, rim: '#eaf6f0', rim2: '#c9e3da', spoke: '#d5e3df', gondolas: 40,
    gCols: ['#e5483b', '#f08a2c', '#f3c63a', '#46b36a', '#3b8de5', '#8d5ad8'], gSize: 4.6 * s,
    legSpan: 28 * s, legColor: '#bccbc6',
    hub: (cy) => {
      b.add(new THREE.CylinderGeometry(16 * s, 16 * s, 5 * s, 24), '#f4f6f6', GeoBuilder.mat(0, cy, 0, 0, Math.PI / 2));
      b.add(new THREE.TorusGeometry(16 * s, 1.4 * s, 4, 24), '#2a6f8f', GeoBuilder.mat(0, cy, 0));
      b.box(1.5 * s, 12 * s, 6 * s, '#2a3a44', 0, cy - 1 * s, 0); // 針
      b.box(9 * s, 1.5 * s, 6 * s, '#2a3a44', 4 * s, cy, 0);
    },
  });
  return { height: 113 * s + 0.04 };
}

/** 横浜赤レンガ倉庫：赤レンガの横長倉庫 2 棟（長軸 = ローカル z） */
function akarenga(b, ctx) {
  drape(b, ctx, rect(0, 0, 0, 0.62, 0.34), '#cbbfae', { off: 0.014, step: 0.08 });
  const wh = (x, z, L) => {
    const y = footY(ctx, x, z, 0.1);
    const W = 0.065;
    b.box(W, 0.07, L, C.brick, x, y, z);
    for (const yy of [0.025, 0.05]) b.box(W + 0.004, 0.004, L, '#e9e1d2', x, y + yy, z); // 窓の並び
    for (const sx of [-1, 1]) b.box(0.006, 0.004, L * 0.96, '#4a4a48', x + sx * (W / 2 + 0.004), y + 0.035, z); // 鉄のバルコニー
    b.gable(W + 0.01, L + 0.006, 0.025, '#5a5f63', x, y + 0.07, z);
  };
  wh(-0.075, -0.06, 0.4); // 2 号館
  wh(0.075, 0.12, 0.22); // 1 号館
  return { height: 0.1 };
}

/** 横浜マリンタワー：細長い十角形の塔、上部の展望台 */
function marineTower(b, ctx) {
  const y = footY(ctx, 0, 0, 0.06);
  const W = '#e9edf0';
  b.cyl(0.032, 0.05, 0.12, 10, W, 0, y, 0);
  b.cyl(0.022, 0.032, 0.22, 10, W, 0, y + 0.12, 0);
  b.cyl(0.03, 0.022, 0.06, 10, W, 0, y + 0.34, 0);
  for (let yy = 0.06; yy < 0.4; yy += 0.06) b.cyl(0.036 - yy * 0.035, 0.036 - yy * 0.035, 0.006, 10, '#9aa7b2', 0, y + yy, 0); // 格子の帯
  b.cyl(0.037, 0.035, 0.035, 12, '#5c7084', 0, y + 0.4, 0); // 展望台
  b.cyl(0.032, 0.037, 0.01, 12, '#c8323a', 0, y + 0.435, 0);
  b.cyl(0.003, 0.006, 0.05, 6, W, 0, y + 0.445, 0);
  return { height: 0.5 };
}

/** 山下公園・氷川丸：海岸沿いの公園と係留された船（長軸 = ローカル z、陸 = +x 側） */
function hikawaMaru(b, ctx) {
  const sea = ctx.sea;
  // 船の周りの水面（1km 格子の地形では海岸線が粗いため）
  drape(b, ctx, rect(-0.03, 0, 0, 0.62, 0.2), '#3f7f98', { h: () => sea + 0.003, step: 0.2 });
  // 公園（海沿いの帯）
  const park = rect(0.2, 0.05, 0, 0.9, 0.2);
  drape(b, ctx, park, C.lawn, { h: (x, z) => Math.max(ctx.ground(x, z), sea + 0.01) + 0.006, step: 0.08 });
  trees(b, ctx, park, 18, 5, { r: 0.02, h: 0.035 });
  // 岸壁
  b.box(0.014, 0.02, 0.9, C.stone, 0.075, sea - 0.005, 0.05);
  // 船体：黒い船体・赤い喫水線・白い上部構造・煙突
  const L = 0.4;
  const Wd = 0.055;
  prism(b, hullPlan(L, Wd), 0.008, '#a8392e', sea - 0.004);
  prism(b, hullPlan(L, Wd), 0.026, '#1f2224', sea + 0.004);
  prism(b, hullPlan(L * 0.62, Wd * 0.78, 0, 0.03), 0.016, C.white, sea + 0.03);
  prism(b, hullPlan(L * 0.38, Wd * 0.62, 0, 0.03), 0.012, '#f6f4ee', sea + 0.046);
  b.cyl(0.008, 0.009, 0.03, 10, '#e9dcc0', 0, sea + 0.058, 0.03);
  b.cyl(0.0085, 0.0085, 0.008, 10, '#2a2a2a', 0, sea + 0.088, 0.03);
  b.cyl(0.0086, 0.0086, 0.005, 10, '#c8323a', 0, sea + 0.074, 0.03);
  for (const z of [-0.13, 0.14]) b.cyl(0.0015, 0.002, 0.07, 4, '#3a3a3a', 0, sea + 0.03, z); // マスト
  return { height: 0.11 };
}

/** パシフィコ横浜：帆の形のホテル（三日月形）・波打つ屋根の展示ホール・貝殻屋根の国立大ホール */
function pacifico(b, ctx) {
  // 帆の形のホテル（海側の先端）
  const hy = footY(ctx, 0.22, -0.18, 0.08);
  const sail = [];
  for (let i = 0; i <= 10; i++) {
    const a = -1.0 + (i / 10) * 2.0;
    sail.push([0.22 + Math.sin(a) * 0.1, -0.18 - Math.cos(a) * 0.1 + 0.1]);
  }
  for (let i = 10; i >= 0; i--) {
    const a = -1.0 + (i / 10) * 2.0;
    sail.push([0.22 + Math.sin(a) * 0.08, -0.18 - Math.cos(a) * 0.06 + 0.1]);
  }
  prism(b, sail, 0.36, '#f1f2f3', hy);
  for (let yy = 0.05; yy < 0.36; yy += 0.05) {
    const s2 = sail.map(([x, z]) => [0.22 + (x - 0.22) * 1.02, -0.08 + (z + 0.08) * 1.02]);
    prism(b, s2, 0.006, '#8fa9bf', hy + yy);
  }
  prism(b, sail.map(([x, z]) => [0.22 + (x - 0.22) * 0.75, -0.1 + (z + 0.1) * 0.75]), 0.04, '#f1f2f3', hy + 0.36);
  // 展示ホール（波打つ屋根）
  const ex = -0.15;
  const ez = 0.08;
  const ey = footY(ctx, ex, ez, 0.15);
  b.box(0.42, 0.04, 0.2, '#e4e6e7', ex, ey, ez);
  for (let i = 0; i < 5; i++) {
    // 半円筒（軸 = ローカル z、上に凸）。変換後 X = 元の z、Y = 元の x、Z = 元の y
    const g = new THREE.CylinderGeometry(0.042, 0.042, 0.2, 10, 1, false, 0, Math.PI);
    b.add(g, '#bcc6cd', GeoBuilder.mat(ex - 0.168 + i * 0.084, ey + 0.04, ez, Math.PI / 2, 0, Math.PI / 2, 0.55, 1, 1));
  }
  // 国立大ホール（貝殻形の屋根）
  const cx = 0.17;
  const cz = 0.15;
  const cy = footY(ctx, cx, cz, 0.08);
  b.box(0.14, 0.05, 0.12, '#e8e6e1', cx, cy, cz);
  dome(b, 0.08, 0.05, 0.07, '#d3d9dd', cx, cy + 0.05, cz, 16, 5);
  drape(b, ctx, rect(0.02, 0.02, 0, 0.6, 0.5), '#cbc6bb', { off: 0.013, step: 0.1 });
  return { height: 0.4 };
}

/** 鎌倉大仏：台座の上の坐像のシルエット（青銅色）。視認性のため大きめ */
function daibutsu(b, ctx) {
  drape(b, ctx, ellipse(0, 0.02, 0.12, 0.13, 16), '#cfc6b2', { off: 0.014, step: 0.05 });
  const y = footY(ctx, 0, 0, 0.06);
  b.box(0.13, 0.012 + 0.04, 0.11, C.stone, 0, y - 0.04, 0);
  b.box(0.11, 0.012, 0.09, '#a29d93', 0, y + 0.012, 0);
  const Br = C.bronze;
  const y0 = y + 0.024;
  // 組んだ脚（横長の楕円体）・胴・肩・頭・螺髪
  b.add(new THREE.SphereGeometry(1, 16, 8), Br, GeoBuilder.mat(0, y0 + 0.022, 0.0, 0, 0, 0, 0.055, 0.026, 0.04));
  cylE(b, 0.034, 0.025, 0.065, 0.82, 14, Br, 0, y0 + 0.025, 0.008);
  b.add(new THREE.SphereGeometry(1, 14, 7), Br, GeoBuilder.mat(0, y0 + 0.085, 0.008, 0, 0, 0, 0.034, 0.016, 0.024));
  b.cyl(0.009, 0.01, 0.012, 8, Br, 0, y0 + 0.094, 0.008);
  b.add(new THREE.SphereGeometry(1, 14, 8), Br, GeoBuilder.mat(0, y0 + 0.122, 0.006, 0, 0, 0, 0.021, 0.025, 0.021));
  ball(b, 0.009, '#556f64', 0, y0 + 0.146, 0.008, 8);
  for (const sx of [-1, 1]) b.box(0.005, 0.02, 0.006, Br, sx * 0.022, y0 + 0.108, 0.006); // 耳
  b.box(0.04, 0.008, 0.016, '#556f64', 0, y0 + 0.04, -0.03); // 組んだ手
  // 境内の木
  trees(b, ctx, ellipse(0, 0.02, 0.2, 0.2, 12), 14, 31, { r: 0.022, h: 0.04, avoid: (x, z) => Math.hypot(x, z - 0.02) < 0.12 });
  return { height: 0.19 };
}

/** 鶴岡八幡宮：段葛（参道）・二の鳥居・舞殿・大石段・楼門・本宮。前（-Z）が参道 */
function tsurugaoka(b, ctx) {
  const V = C.vermilion;
  // 段葛：両側に桜並木
  const pts = [[0, -0.1], [0, -0.85]];
  path(b, ctx, pts, 0.03, C.sand, 0.02, 0.05);
  for (let z = -0.15; z > -0.85; z -= 0.06)
    for (const sx of [-1, 1]) b.cyl(0, 0.012, 0.025, 5, z > -0.5 ? '#e8b6c4' : '#4a7a3d', sx * 0.028, ctx.ground(sx * 0.028, z) + 0.006, z);
  torii(b, 0, ctx.ground(0, -0.84) + 0.012, -0.84, 0.09, 0.08, V);
  torii(b, 0, ctx.ground(0, -0.42) + 0.012, -0.42, 0.075, 0.07, V);
  torii(b, 0, ctx.ground(0, -0.16) + 0.012, -0.16, 0.065, 0.06, V);
  // 境内
  drape(b, ctx, rect(0, 0.0, 0, 0.26, 0.24), C.gravel, { off: 0.015, step: 0.05 });
  const my = footY(ctx, 0, -0.08) + 0.012;
  b.box(0.04, 0.012, 0.03, V, 0, my, -0.08); // 舞殿
  b.hip(0.05, 0.04, 0.015, 0.3, C.cypress, 0, my + 0.012, -0.08);
  // 大石段と本宮（高台）
  const hy = Math.max(footY(ctx, 0, 0.06, 0.06), my) + 0.04;
  for (let k = 0; k < 6; k++) b.box(0.05, (hy - my) * ((k + 1) / 6), 0.012, C.stone, 0, my, -0.035 + k * 0.012);
  b.box(0.22, hy - my + 0.01, 0.12, C.stone, 0, my - 0.01, 0.09); // 石垣の台
  // 楼門（二重）
  b.box(0.06, 0.03, 0.025, V, 0, hy, 0.035);
  b.hip(0.08, 0.04, 0.012, 0.35, C.cypress, 0, hy + 0.03, 0.035);
  b.box(0.05, 0.015, 0.02, V, 0, hy + 0.042, 0.035);
  b.hip(0.075, 0.04, 0.016, 0.25, C.cypress, 0, hy + 0.057, 0.035);
  // 回廊と本殿
  for (const [x, z, w, d] of [[-0.08, 0.09, 0.012, 0.1], [0.08, 0.09, 0.012, 0.1], [0, 0.135, 0.17, 0.012]]) b.box(w, 0.018, d, V, x, hy, z);
  b.box(0.07, 0.03, 0.05, V, 0, hy, 0.095);
  b.hip(0.09, 0.07, 0.02, 0.3, C.cypress, 0, hy + 0.03, 0.095);
  trees(b, ctx, rect(0, 0.08, 0, 0.5, 0.5), 30, 13, { r: 0.03, h: 0.05, avoid: (x, z) => Math.abs(x) < 0.15 && z < 0.16 });
  return { height: hy - footY(ctx, 0, 0) + 0.08 };
}

/** 江の島シーキャンドル：江の島（ランドマーク側で小さな島の起伏を持つ。地形データは変更しない）と展望灯台 */
function seaCandle(b, ctx) {
  const sea = ctx.sea;
  // 島（岩の縁 → 緑の起伏 → 山頂）
  cylE(b, 0.5, 0.29, 0.1, 0.94, 28, '#8f8574', 0, sea - 0.07, 0);
  cylE(b, 0.47, 0.27, 0.1, 0.7, 28, '#4f7d3f', 0, sea + 0.03, 0);
  cylE(b, 0.33, 0.19, 0.05, 0.6, 24, '#5a8a48', 0.04, sea + 0.13, 0);
  const top = sea + 0.18;
  trees(b, { ground: () => top - 0.03 }, ellipse(0.04, 0, 0.18, 0.1, 12), 12, 3, { r: 0.025, h: 0.035, avoid: (x, z) => Math.hypot(x - 0.04, z) < 0.05 });
  // 展望灯台（塔 + ガラスの展望台 + 頂部）
  const x = 0.04;
  b.cyl(0.03, 0.035, 0.02, 12, '#e8e8e4', x, top, 0);
  b.cyl(0.011, 0.013, 0.24, 10, '#dfe2e4', x, top + 0.02, 0);
  for (let yy = 0.04; yy < 0.24; yy += 0.04) b.cyl(0.02, 0.02, 0.004, 10, '#b9c0c5', x, top + yy, 0); // 外周の格子
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    b.beam(x + Math.cos(a) * 0.02, top + 0.02, Math.sin(a) * 0.02, x + Math.cos(a + 1) * 0.018, top + 0.22, Math.sin(a + 1) * 0.018, 0.003, '#c9ced2');
  }
  b.cyl(0.03, 0.026, 0.03, 14, '#6f8aa0', x, top + 0.22, 0); // 展望台
  dome(b, 0.03, 0.02, 0.03, '#f2f2ef', x, top + 0.25, 0, 14, 5);
  b.cyl(0.002, 0.004, 0.02, 6, '#f2f2ef', x, top + 0.268, 0);
  // 江の島弁天橋（北の陸へ）と朱の鳥居
  const z0 = -0.27;
  const z1 = -0.72;
  slab(b, -0.08, sea + 0.016, z0, -0.08, Math.max(sea, ctx.ground(-0.08, z1)) + 0.016, z1, 0.03, 0.008, '#c9c6bd');
  for (let z = z0; z > z1; z -= 0.08) b.box(0.012, 0.03, 0.012, '#a9a59d', -0.08, sea - 0.015, z);
  torii(b, -0.08, sea + 0.02, -0.22, 0.05, 0.045, C.vermilion);
  return { height: 0.47 };
}

/** 八景島シーパラダイス：人工島に水族館のガラスのピラミッド・高い塔・観覧車・施設群 */
function hakkeijima(b, ctx) {
  const isl = ellipse(0, 0, 0.3, 0.28, 24);
  const H = pad(b, ctx, isl, '#c9c3b3', C.stone, { top: 0.014 });
  drape(b, ctx, ellipse(0, 0, 0.29, 0.27, 24).map(([x, z]) => [x, z]), C.lawn, { h: (x, z) => H(x, z) + 0.002, step: 0.1 });
  drape(b, ctx, ellipse(0.02, 0.0, 0.2, 0.18, 20), '#d9d1bf', { h: (x, z) => H(x, z) + 0.004, step: 0.08 });
  // 水族館（ガラスのピラミッド）
  b.hip(0.14, 0.14, 0.11, 0.02, '#8fc3dc', -0.06, H(-0.06, 0.06), 0.06);
  // 高い塔（白い細塔 + 頂部）
  const ty = H(0.13, -0.1);
  b.cyl(0.009, 0.012, 0.32, 8, '#f2f2f0', 0.13, ty, -0.1);
  b.cyl(0.02, 0.02, 0.02, 10, '#e84d4d', 0.13, ty + 0.3, -0.1);
  // 観覧車（コスモクロック 21 より小さく、色も違う）
  const wy = H(0.13, 0.1);
  b.box(0.06, 0.012, 0.03, '#e6e2d8', 0.13, wy, 0.1);
  wheel(b, {
    R: 0.07, cy: wy + 0.085, x: 0.13, z: 0.1, rim: '#5ec2e6', rim2: '#f5a6c8', spoke: '#d9e2e6', gondolas: 16,
    gCols: ['#f5a6c8', '#5ec2e6', '#ffe08a'], gSize: 0.012, legSpan: 0.04, legColor: '#c8d0d4',
  });
  // 施設群
  for (const [x, z, w, d, h, c] of [[-0.12, -0.12, 0.12, 0.07, 0.04, '#f0ece2'], [0.02, -0.18, 0.08, 0.06, 0.03, '#e3eef4'], [-0.18, 0.12, 0.07, 0.07, 0.03, '#f4e4d4']]) b.box(w, h, d, c, x, H(x, z), z);
  // 対岸（西）への橋
  slab(b, -0.29, H(-0.29, 0) + 0.004, 0, -0.78, Math.max(ctx.sea + 0.014, ctx.ground(-0.78, 0)) + 0.004, 0, 0.035, 0.008, '#cfccc4');
  return { height: 0.36 };
}

/** 横須賀軍港：岸壁・桟橋・クレーン・灰色の抽象化した艦船（-Z = 沖） */
function yokosukaPort(b, ctx) {
  const sea = ctx.sea;
  const H = pad(b, ctx, [[-0.6, 0.0], [0.6, 0.0], [0.6, 0.3], [-0.6, 0.3]], '#a9aaa6', C.stone, { top: 0.012 });
  // 桟橋 3 本
  const piers = [-0.32, 0.02, 0.36];
  for (const x of piers) {
    const P = rect(x, -0.22, 0, 0.44, 0.045);
    drape(b, ctx, P, '#b3b4b0', { h: () => sea + 0.012, step: 0.2 });
    skirt(b, ctx, P, '#8d8e8a', () => sea + 0.012, sea - 0.05, 0.2);
  }
  // 艦船：灰色の船体 + 艦橋・煙突・マスト（実在艦の再現ではない）
  const G = '#7d8790';
  const ship = (x, z, L, W, big) => {
    prism(b, hullPlan(L, W, x, z), 0.018, G, sea - 0.006);
    if (big) {
      prism(b, [[x - W * 0.62, z - L * 0.45], [x + W * 0.62, z - L * 0.45], [x + W * 0.62, z + L * 0.48], [x - W * 0.62, z + L * 0.48]], 0.006, '#6a737b', sea + 0.012);
      b.box(W * 0.25, 0.035, L * 0.14, '#8e979f', x + W * 0.5, sea + 0.018, z + 0.04);
      b.cyl(0.0015, 0.0015, 0.03, 4, '#5e6870', x + W * 0.5, sea + 0.053, z + 0.04);
    } else {
      b.box(W * 0.55, 0.022, L * 0.2, '#8e979f', x, sea + 0.012, z - L * 0.08);
      b.box(W * 0.4, 0.014, L * 0.12, '#8e979f', x, sea + 0.012, z + L * 0.12);
      b.cyl(0.0015, 0.0015, 0.035, 4, '#5e6870', x, sea + 0.034, z - L * 0.08);
      b.cyl(0.004, 0.004, 0.006, 6, '#5e6870', x, sea + 0.018, z - L * 0.32); // 主砲
    }
  };
  ship(-0.24, -0.22, 0.3, 0.035);
  ship(-0.4, -0.24, 0.26, 0.032);
  ship(0.1, -0.24, 0.32, 0.036);
  ship(0.48, -0.3, 0.46, 0.07, true);
  // クレーン 2 基・倉庫
  for (const x of [-0.12, 0.22]) {
    const y = H(x, 0.04);
    for (const sx of [-1, 1]) b.beam(x + sx * 0.02, y, 0.04, x + sx * 0.02, y + 0.09, 0.04, 0.006, '#d6c04a');
    b.beam(x - 0.02, y + 0.09, 0.04, x - 0.02, y + 0.09, -0.06, 0.006, '#d6c04a');
    b.beam(x + 0.02, y + 0.09, 0.04, x + 0.02, y + 0.09, -0.06, 0.006, '#d6c04a');
  }
  for (const [x, z] of [[-0.45, 0.18], [-0.25, 0.2], [0.05, 0.2], [0.3, 0.18], [0.5, 0.2]]) b.box(0.12, 0.03, 0.07, '#c9c6bd', x, H(x, z), z);
  return { height: 0.12 };
}

/* ====================================================================== */
/* 千葉                                                                    */
/* ====================================================================== */

/** 成田山新勝寺：大本堂・三重塔・平和大塔・仁王門（-Z = 正面） */
function shinshoji(b, ctx) {
  drape(b, ctx, rect(0, 0.02, 0, 0.5, 0.42), C.gravel, { off: 0.014, step: 0.06 });
  const y = footY(ctx, 0, 0, 0.1);
  // 大本堂
  b.box(0.18, 0.012, 0.13, C.stone, 0, y, 0);
  b.box(0.14, 0.045, 0.1, '#c9a46a', 0, y + 0.012, 0);
  b.hip(0.2, 0.15, 0.05, 0.35, C.roofDark, 0, y + 0.057, 0);
  // 三重塔（朱）
  pagodaK(b, -0.15, footY(ctx, -0.15, -0.06), -0.06, 0.0055, 3, 9, 7, C.vermilion, C.roofDark);
  // 平和大塔（北の大きな塔）
  const px = 0.0;
  const pz = 0.2;
  const py = footY(ctx, px, pz, 0.06);
  b.box(0.1, 0.06, 0.1, '#efece4', px, py, pz);
  b.hip(0.14, 0.14, 0.03, 0.5, C.roofDark, px, py + 0.06, pz);
  b.cyl(0.04, 0.045, 0.05, 12, C.vermilion, px, py + 0.09, pz);
  b.hip(0.12, 0.12, 0.03, 0.2, C.roofDark, px, py + 0.14, pz);
  b.cyl(0.003, 0.008, 0.07, 6, '#b89647', px, py + 0.17, pz);
  // 仁王門と石段
  const gz = -0.2;
  const gy = footY(ctx, 0, gz);
  b.box(0.07, 0.04, 0.03, C.vermilion, 0, gy, gz);
  b.hip(0.09, 0.05, 0.02, 0.3, C.roofDark, 0, gy + 0.04, gz);
  for (let k = 0; k < 4; k++) b.box(0.05, 0.006 * (k + 1), 0.012, C.stone, 0, gy, gz + 0.03 + k * 0.012);
  trees(b, ctx, rect(0, 0.0, 0, 0.75, 0.7), 40, 17, { r: 0.03, h: 0.05, avoid: (x, z) => Math.abs(x) < 0.26 && Math.abs(z - 0.02) < 0.22 });
  return { height: 0.25 };
}

/** 幕張メッセ：横長・低層の大きな展示ホール群（波打つ屋根）・イベントホール・国際会議場（長軸 = ローカル x） */
function makuhariMesse(b, ctx) {
  drape(b, ctx, rect(0, 0.04, 90, 1.5, 0.42), '#c5c2b8', { off: 0.013, step: 0.12 });
  const y = footY(ctx, 0, 0, 0.3);
  b.box(1.0, 0.045, 0.2, '#e4e6e7', -0.05, y, 0);
  for (let i = 0; i < 8; i++) {
    const g = new THREE.CylinderGeometry(0.0625, 0.0625, 0.2, 12, 1, false, 0, Math.PI);
    b.add(g, i % 2 ? '#b9c3ca' : '#c9d1d7', GeoBuilder.mat(-0.49 + i * 0.125, y + 0.045, 0, Math.PI / 2, 0, Math.PI / 2, 0.45, 1, 1));
  }
  // イベントホール（東の貝殻ドーム）・国際会議場（西）
  dome(b, 0.12, 0.07, 0.1, '#d6dce0', 0.6, footY(ctx, 0.6, 0.02, 0.1), 0.02, 18, 6);
  b.box(0.16, 0.08, 0.12, '#dcd8cf', -0.66, footY(ctx, -0.66, 0.08, 0.08), 0.08);
  b.hip(0.18, 0.14, 0.03, 0.2, '#9aa6ae', -0.66, footY(ctx, -0.66, 0.08, 0.08) + 0.08, 0.08);
  // 駅側の歩行者デッキ（北東側の帯）
  path(b, ctx, [[-0.5, -0.16], [0.5, -0.16]], 0.03, '#d9d6cd', 0.03, 0.12);
  return { height: 0.12 };
}

/** ZOZOマリンスタジアム：海沿いの屋外野球場（スタンドの輪・芝・内野・照明塔）。ロゴ・広告は描かない */
function baseballStadium(b, ctx) {
  const H = pad(b, ctx, ellipse(0, 0, 0.27, 0.25, 24), '#c8c4b8', C.stone, { top: 0.012 });
  const y = H(0, 0);
  ringE(b, 0.22, 0.2, 0.06, 0.08, '#e6e6e2', 0, y, 0);
  ringE(b, 0.225, 0.205, 0.012, 0.1, '#a9b0b6', 0, y, 0);
  ringE(b, 0.17, 0.15, 0.04, 0.04, '#5f6c78', 0, y, 0); // 客席
  cylE(b, 0.15, 0.135, 0.008, 1, 28, '#4f8f3c', 0, y, 0); // 外野の芝
  // 内野（菱形の土）とマウンド：本塁は南（+z）
  b.add(new THREE.CylinderGeometry(0.06, 0.06, 0.004, 4), '#b88a5c', GeoBuilder.mat(0, y + 0.01, 0.06));
  b.add(new THREE.CylinderGeometry(0.035, 0.035, 0.005, 4), '#5d9a48', GeoBuilder.mat(0, y + 0.011, 0.06));
  b.cyl(0.007, 0.007, 0.007, 8, '#b88a5c', 0, y + 0.008, 0.06);
  for (const a of [-2.2, -1.4, -0.6, 0.6, 1.4, 2.2]) {
    const x = Math.sin(a) * 0.23;
    const z = -Math.cos(a) * 0.21;
    b.box(0.006, 0.12, 0.006, '#cfd3d6', x, y, z);
    b.box(0.03, 0.015, 0.01, '#f4f2d8', x, y + 0.12, z);
  }
  return { height: 0.14 };
}

/** 千葉ポートタワー：菱形断面の細長いハーフミラーの塔 */
function chibaPortTower(b, ctx) {
  const y = footY(ctx, 0, 0, 0.06);
  drape(b, ctx, ellipse(0, 0, 0.12, 0.1, 14), C.lawn, { off: 0.013, step: 0.05 });
  b.box(0.08, 0.025, 0.06, '#d9dbdc', 0, y, 0);
  const g = new THREE.CylinderGeometry(0.03, 0.034, 0.5, 4);
  g.translate(0, 0.25, 0);
  b.add(g, '#5d7890', GeoBuilder.mat(0, y + 0.02, 0, 0, 0, 0, 1, 1, 0.62));
  const g2 = new THREE.CylinderGeometry(0.034, 0.03, 0.06, 4);
  g2.translate(0, 0.03, 0);
  b.add(g2, '#6f8ba0', GeoBuilder.mat(0, y + 0.47, 0, 0, 0, 0, 1, 1, 0.62)); // 展望部
  b.add(new THREE.CylinderGeometry(0.02, 0.034, 0.03, 4).translate(0, 0.015, 0), '#3e5060', GeoBuilder.mat(0, y + 0.53, 0, 0, 0, 0, 1, 1, 0.62));
  return { height: 0.58 };
}

/** 東京ディズニーランド：城を想起させる一般的な塔のシルエット + 色分けしたテーマパーク区画（キャラクター・ロゴなし） */
function themeParkCastle(b, ctx) {
  const P = ellipse(0, 0, 0.42, 0.38, 28);
  const H = pad(b, ctx, P, '#d8cfba', null, { top: 0.012, off: 0.012 });
  // 外周の緑の土手
  drape(b, ctx, ellipse(0, 0, 0.46, 0.42, 28), C.green3, { h: (x, z) => H(x, z) - 0.002, step: 0.15 });
  drape(b, ctx, P, '#d8cfba', { h: (x, z) => H(x, z) + 0.002, step: 0.12 });
  // 区画（扇形に色分け）
  const cols = ['#c9d9b0', '#e3c9a8', '#c4d4e4', '#e6d4e0', '#d9e2b8'];
  for (let k = 0; k < 5; k++) {
    const a0 = -Math.PI / 2 + 0.5 + k * 1.15;
    const pts = [[Math.cos(a0) * 0.12, Math.sin(a0) * 0.11]];
    for (let i = 0; i <= 6; i++) {
      const a = a0 + (i / 6) * 1.05;
      pts.push([Math.cos(a) * 0.37, Math.sin(a) * 0.335]);
    }
    pts.push([Math.cos(a0 + 1.05) * 0.12, Math.sin(a0 + 1.05) * 0.11]);
    drape(b, ctx, pts, cols[k], { h: (x, z) => H(x, z) + 0.004, step: 0.1 });
  }
  // 水路（西側の川）
  drape(b, ctx, ellipse(-0.22, -0.08, 0.1, 0.05, 14, 30), '#5d9fb8', { h: (x, z) => H(x, z) + 0.006, step: 0.06 });
  // 中央の城（一般的な西洋風の塔の集まり）
  const y = H(0, 0);
  ringE(b, 0.075, 0.075, 0.012, 0.006, '#6aa9c4', 0, y + 0.002, 0); // 堀
  b.box(0.08, 0.04, 0.08, '#e9e3d8', 0, y, 0);
  b.cyl(0.024, 0.026, 0.12, 12, '#f2ece2', 0, y + 0.04, 0);
  b.cyl(0.0, 0.032, 0.075, 12, '#5f86c4', 0, y + 0.16, 0);
  b.cyl(0.0, 0.002, 0.02, 4, C.gold, 0, y + 0.235, 0);
  const tw = [[0.035, -0.03, 0.07], [-0.035, -0.03, 0.08], [0.035, 0.03, 0.06], [-0.035, 0.03, 0.065], [0, -0.042, 0.09], [0.0, 0.042, 0.05]];
  tw.forEach(([x, z, h], i) => {
    b.cyl(0.011, 0.012, h, 8, '#f2ece2', x, y + 0.04, z);
    b.cyl(0.0, 0.016, 0.04, 8, i % 2 ? '#d9899f' : '#5f86c4', x, y + 0.04 + h, z);
  });
  // 抽象化したアトラクション（岩山・白い円錐ドーム・入口の大屋根）
  b.cyl(0.02, 0.08, 0.08, 7, '#9a6a48', -0.24, H(-0.24, 0.15), 0.15);
  b.cyl(0.0, 0.07, 0.07, 10, '#eef0f2', 0.25, H(0.25, -0.1), -0.1);
  b.box(0.1, 0.03, 0.16, '#e4dccd', 0, H(0, 0.25), 0.25);
  b.box(0.11, 0.008, 0.17, '#9fb4c2', 0, H(0, 0.25) + 0.03, 0.25);
  return { height: 0.25 };
}

/** 東京ディズニーシー：大きな内海（水域）と火山の形の山 + 区画（キャラクター・ロゴなし） */
function themeParkVolcano(b, ctx) {
  const P = ellipse(0, 0, 0.42, 0.36, 28);
  const H = pad(b, ctx, P, '#d6cdb7', C.stone, { top: 0.014 });
  drape(b, ctx, ellipse(0, 0, 0.46, 0.4, 28), C.green3, { h: (x, z) => H(x, z) - 0.002, step: 0.15 });
  drape(b, ctx, P, '#d6cdb7', { h: (x, z) => H(x, z) + 0.002, step: 0.12 });
  // 区画
  const zones = [[[0.13, 0.04], [0.38, -0.04], [0.36, 0.21], [0.13, 0.25]], [[-0.38, -0.08], [-0.17, -0.27], [0.0, -0.3], [-0.04, -0.1], [-0.25, 0.0]], [[0.13, -0.32], [0.34, -0.19], [0.25, -0.04], [0.08, -0.1]]];
  ['#e7d1b8', '#c9dccf', '#d9cde3'].forEach((c, i) => drape(b, ctx, zones[i], c, { h: (x, z) => H(x, z) + 0.004, step: 0.1 }));
  // 内海（大きな水域）
  drape(b, ctx, ellipse(-0.08, 0.1, 0.17, 0.12, 20), '#4c95b6', { h: (x, z) => H(x, z) + 0.006, step: 0.06 });
  drape(b, ctx, ellipse(-0.28, 0.17, 0.07, 0.045, 12), '#4c95b6', { h: (x, z) => H(x, z) + 0.006, step: 0.05 });
  // 内海を囲む港町の建物
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const x = -0.08 + Math.cos(a) * 0.2;
    const z = 0.1 + Math.sin(a) * 0.145;
    b.box(0.04, 0.025 + (i % 3) * 0.008, 0.03, ['#e9c9a8', '#f0dcc0', '#d9a88a'][i % 3], x, H(x, z), z, -a);
  }
  // 火山（赤茶の円錐 + 火口）
  const vx = 0.04;
  const vz = -0.1;
  const vy = H(vx, vz);
  b.cyl(0.045, 0.14, 0.11, 12, '#8a4b3a', vx, vy, vz);
  b.cyl(0.03, 0.045, 0.025, 12, '#6f3a2c', vx, vy + 0.11, vz);
  b.cyl(0.028, 0.028, 0.004, 12, '#3a2420', vx, vy + 0.132, vz);
  b.cyl(0.02, 0.07, 0.06, 9, '#7a4434', vx + 0.11, vy, vz - 0.05);
  // 灯台・塔
  b.cyl(0.008, 0.011, 0.07, 8, '#f2efe8', -0.27, H(-0.27, 0.1), 0.1);
  b.cyl(0.012, 0.012, 0.012, 8, '#c8323a', -0.27, H(-0.27, 0.1) + 0.07, 0.1);
  return { height: 0.16 };
}

/** 海ほたる PA：アクアライン上の細長い人工島（白い船のような建物）と道路。-Z = 木更津方向の橋 */
function umihotaru(b, ctx, L = 4.9) {
  const sea = ctx.sea;
  const isl = [[0, -0.34], [0.07, -0.29], [0.085, 0.0], [0.08, 0.28], [0.05, 0.36], [-0.05, 0.36], [-0.08, 0.28], [-0.085, 0.0], [-0.07, -0.29]];
  const H = pad(b, ctx, isl, '#bdb9ae', '#8d897f', { top: 0.016, step: 0.1 });
  // 建物（5 層の船形）
  const y = sea + 0.016;
  prism(b, hullPlan(0.36, 0.1, 0, -0.02), 0.02, '#e6e8ea', y);
  prism(b, hullPlan(0.32, 0.09, 0, -0.02), 0.02, '#cdd3d8', y + 0.02);
  prism(b, hullPlan(0.27, 0.075, 0, -0.03), 0.018, '#f2f3f4', y + 0.04);
  prism(b, hullPlan(0.18, 0.06, 0, -0.04), 0.014, '#7fa1bb', y + 0.058);
  b.cyl(0.006, 0.006, 0.04, 6, '#f2f3f4', 0, y + 0.072, -0.05);
  // 島の上の道路（中央）と西端のトンネル口
  path(b, ctx, [[0.0, 0.34], [0.0, 0.12]], 0.035, C.asphalt, 0.0, 0.1);
  b.box(0.05, 0.02, 0.04, '#55595e', 0, y - 0.004, 0.34);
  // アクアブリッジ（木更津へ）：海上の低い桁と橋脚、木更津側で陸へ
  const ze = -L;
  const land = Math.max(sea, ctx.ground(0, ze)) + 0.016;
  const prof = (t) => sea + 0.03 + 0.05 * Math.exp(-(((t - 0.12) / 0.06) ** 2)); // 航路部で少し高く
  const N = 24;
  for (let k = 0; k < N; k++) {
    const t0 = k / N;
    const t1 = (k + 1) / N;
    const ya = k === N - 1 ? prof(t0) : prof(t0);
    const yc = k === N - 1 ? land : prof(t1);
    slab(b, 0, ya, -0.34 + (ze + 0.34) * t0, 0, yc, -0.34 + (ze + 0.34) * t1, 0.05, 0.012, '#d3d5d6');
    if (k > 0) b.box(0.03, prof(t0) - sea + 0.06, 0.012, '#b3b6b8', 0, sea - 0.06, -0.34 + (ze + 0.34) * t0);
  }
  return { height: 0.14 };
}

/** マザー牧場：丘の上の草地（牧場の区画・柵・花畑）と小さな建物（面積型） */
function motherFarm(b, ctx) {
  const P = [[-0.6, -0.35], [-0.1, -0.5], [0.5, -0.42], [0.62, 0.1], [0.4, 0.45], [-0.2, 0.48], [-0.6, 0.15]];
  drape(b, ctx, P, '#9cc46a', { off: 0.012, step: 0.1 });
  const pad1 = [[-0.5, -0.3], [-0.1, -0.4], [-0.05, -0.05], [-0.48, 0.05]];
  const pad2 = [[0.05, -0.35], [0.45, -0.32], [0.5, 0.05], [0.08, 0.02]];
  drape(b, ctx, pad1, '#b6d47e', { off: 0.014, step: 0.08 });
  drape(b, ctx, pad2, '#a9cc72', { off: 0.014, step: 0.08 });
  drape(b, ctx, [[-0.35, 0.12], [0.05, 0.12], [0.02, 0.4], [-0.3, 0.4]], '#f1d34a', { off: 0.015, step: 0.08 }); // 花畑
  // 柵
  for (const poly of [pad1, pad2])
    for (let i = 0; i < poly.length; i++) {
      const [x0, z0] = poly[i];
      const [x1, z1] = poly[(i + 1) % poly.length];
      const n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.08);
      for (let k = 0; k < n; k++) {
        const ax = x0 + ((x1 - x0) * k) / n;
        const az = z0 + ((z1 - z0) * k) / n;
        const cx = x0 + ((x1 - x0) * (k + 1)) / n;
        const cz = z0 + ((z1 - z0) * (k + 1)) / n;
        slab(b, ax, ctx.ground(ax, az) + 0.024, az, cx, ctx.ground(cx, cz) + 0.024, cz, 0.004, 0.004, '#f4f2ea');
      }
    }
  // 羊（白い点）
  const rng = mulberry32(8);
  for (let i = 0; i < 30; i++) {
    const poly = i % 2 ? pad1 : pad2;
    const x = -0.5 + rng() * 1.0;
    const z = -0.4 + rng() * 0.45;
    if (!inPoly(x, z, poly)) continue;
    b.box(0.012, 0.008, 0.008, '#f7f7f2', x, ctx.ground(x, z) + 0.012, z, rng() * 3);
  }
  // 赤い屋根の牧舎・売店
  for (const [x, z, ry] of [[0.3, 0.25, 0.3], [0.42, 0.18, 0.3], [0.2, 0.36, -0.2], [-0.45, 0.25, 0.5], [0.55, -0.15, 0]]) {
    const y = footY(ctx, x, z);
    b.box(0.05, 0.022, 0.03, '#efe9dc', x, y, z, ry);
    b.gable(0.05, 0.034, 0.018, C.redRoof, x, y + 0.022, z, ry + Math.PI / 2);
  }
  trees(b, ctx, P, 30, 61, { r: 0.03, h: 0.05, avoid: (x, z) => inPoly(x, z, pad1) || inPoly(x, z, pad2) || (x > -0.36 && x < 0.06 && z > 0.1 && z < 0.42) });
  return { height: 0.06 };
}

/** 鋸山・地獄のぞき：山頂付近の目印。石切場の垂直な岩壁と、崖から突き出した展望の岩（地形は変更しない） */
function nokogiri(b, ctx) {
  const y = ctx.ground(0, 0);
  // 石切場の岩壁（明るい灰色の垂直面）を斜面に沿って 3 枚
  for (const [x, z, w, h, ry] of [[-0.12, 0.08, 0.16, 0.12, 0.2], [0.08, 0.12, 0.12, 0.09, -0.3], [-0.02, 0.2, 0.2, 0.08, 0.05]]) {
    const gy = Math.min(ctx.ground(x, z), ctx.ground(x - 0.05, z), ctx.ground(x + 0.05, z)) - 0.03;
    b.box(w, h + 0.03, 0.03, '#cfc8b8', x, gy, z, ry);
    b.box(w * 0.95, 0.008, 0.035, '#b9b2a2', x, gy + h * 0.6, z, ry);
  }
  // 地獄のぞき：岩の台と、崖の外へ突き出した細い岩
  const rx = 0.0;
  const rz = 0.0;
  b.box(0.06, 0.05, 0.05, '#a39c8e', rx, y - 0.02, rz);
  const t = new THREE.BoxGeometry(0.018, 0.012, 0.075);
  t.translate(0, 0, -0.03);
  b.add(t, '#b3ac9e', GeoBuilder.mat(rx, y + 0.03, rz - 0.02, 0.3, 0.12));
  // 手すり（白）と山頂の展望台
  b.beam(rx - 0.008, y + 0.05, rz - 0.04, rx + 0.004, y + 0.05, rz - 0.085, 0.002, '#f4f4ef');
  b.beam(rx + 0.008, y + 0.05, rz - 0.035, rx + 0.02, y + 0.05, rz - 0.08, 0.002, '#f4f4ef');
  b.box(0.04, 0.008, 0.03, '#d8d4ca', 0.06, ctx.ground(0.06, -0.06) + 0.004, -0.06);
  trees(b, ctx, ellipse(0, 0.05, 0.3, 0.25, 12), 18, 91, { r: 0.03, h: 0.05, avoid: (x, z) => Math.hypot(x, z) < 0.07 || (z > 0.0 && z < 0.26 && Math.abs(x + 0.03) < 0.15) });
  return { height: 0.08 };
}

/** 犬吠埼灯台：白い円筒形の灯台（太平洋岸） */
function lighthouse(b, ctx) {
  const y = footY(ctx, 0, 0, 0.03);
  drape(b, ctx, ellipse(0, 0, 0.07, 0.07, 12), '#cfc9bb', { off: 0.014, step: 0.04 });
  b.box(0.045, 0.02, 0.03, '#f4f4f0', 0.04, y, 0.02); // 付属舎
  b.cyl(0.017, 0.024, 0.15, 14, '#fbfbf8', 0, y, 0);
  b.cyl(0.026, 0.026, 0.006, 14, '#3a3d40', 0, y + 0.15, 0); // 回廊
  b.cyl(0.014, 0.014, 0.02, 10, '#e9e2b0', 0, y + 0.156, 0); // 灯室
  dome(b, 0.016, 0.014, 0.016, '#3a3d40', 0, y + 0.176, 0, 12, 4);
  b.cyl(0.0, 0.003, 0.012, 4, '#3a3d40', 0, y + 0.19, 0);
  return { height: 0.2 };
}

export const KANTO_BUILDERS = {
  imperialPalace, tokyoDome, haneda, narita, tocho, tokyoStation, nationalStadium, bigSight, fujiTV, libertyStatue,
  shibuyaCrossing, moriTower, meijiJingu, yoyogiGym, lmTower, cosmoClock, akarenga, marineTower, hikawaMaru, pacifico,
  daibutsu, tsurugaoka, seaCandle, hakkeijima, yokosukaPort, shinshoji, makuhariMesse, baseballStadium, chibaPortTower,
  themeParkCastle, themeParkVolcano, umihotaru, motherFarm, nokogiri, lighthouse,
};
