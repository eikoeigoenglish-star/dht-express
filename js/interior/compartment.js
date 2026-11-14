/**
 * interior/compartment.js — 【v12】個室（Room 1 / 2 / 3）の組み立て
 * ---------------------------------------------------------------------------
 * v11 の Room（現 Room 2）と同じ内装を、部屋の中心 cx だけずらして作る。
 *   完全な個室（天井まで届く壁）・廊下側に閉じた引き戸・大きな車窓・向かい合わせの緑のベンチ・
 *   中央テーブル・荷物棚・カーテン・壁のランプ・天井灯・額・本棚・植物
 * 部屋ごとに荷物・本・絵の並びを seed で少し変える。
 *
 * 仕切り壁（部屋と部屋の間の漆喰の箱）と廊下側の壁の廊下側の面は corridor 側（train.js）で作る。
 * ここで作るのは「室内の面」と家具。
 */
import * as THREE from 'three';
import { box, cylinder, rodX, trs, rng } from './kit.js';
import { H, WALL, COMP, WIN, DOOR, BENCH, TABLE, CORRIDOR } from './layout.js';

/**
 * @param {import('./builder.js').Builder} b
 * @param {{ id: string, label: string, cx: number, seed: number }} def
 * @returns {{ lights: THREE.Vector3[], window: object, doorRange: [number, number] }}
 */
export function buildCompartment(b, def) {
  const cx = def.cx;
  const x0 = cx - COMP.hw;
  const x1 = cx + COMP.hw;
  const Z1 = COMP.depth;
  const R = rng(def.seed);
  const wx0 = cx + WIN.rx0;
  const wx1 = cx + WIN.rx1;
  const dx0 = cx + DOOR.rx0;
  const dx1 = cx + DOOR.rx1;
  const paintA = def.seed % 2 ? 'paintR' : 'paintL';
  const paintB = def.seed % 2 ? 'paintL' : 'paintR';

  // ---- 床・天井・梁・絨毯 ----
  b.B('floor', x0, x1, -0.06, 0, 0, Z1);
  b.B('plaster', x0, x1, H, H + 0.1, -WALL, Z1 + 0.1);
  for (let z = 0.45; z < Z1; z += 0.7) b.B('wood', x0, x1, H - 0.05, H, z - 0.03, z + 0.03);
  const rug = new THREE.PlaneGeometry(2.7, 2.75);
  rug.rotateX(-Math.PI / 2);
  b.add('carpet', rug, trs(cx, 0.004, 1.47));

  // ---- 左右の仕切り壁の室内側 ----
  for (const s of [-1, 1]) {
    const xi = cx + s * COMP.hw;
    b.finish('x', xi, -s, 0, Z1);
    for (const z of [0.03, BENCH.z1 + 0.03, Z1 - 0.03]) b.B('wood', Math.min(xi, xi - s * 0.03), Math.max(xi, xi - s * 0.03), 0.94, H - 0.12, z - 0.03, z + 0.03);
  }

  // ---- 車窓側の壁（大きな窓の穴）----
  b.B('plaster', x0, x1, 0, WIN.y0, -WALL, 0);
  b.B('plaster', x0, x1, WIN.y1, H, -WALL, 0);
  b.B('plaster', x0, wx0, WIN.y0, WIN.y1, -WALL, 0);
  b.B('plaster', wx1, x1, WIN.y0, WIN.y1, -WALL, 0);
  b.finish('z', 0, 1, x0, x1);
  b.coll(x0 - 0.3, x1 + 0.3, -0.5, 0, { wall: true, name: `${def.id}:window-wall` });
  const ww = WIN.rx1 - WIN.rx0;
  const wh = WIN.y1 - WIN.y0;
  const wy = (WIN.y0 + WIN.y1) / 2;
  b.add('wood', b.ring(ww + 0.3, wh + 0.3, 0.22, ww, wh, 0.14, 0.06), trs(cx, wy, 0));
  b.add('brass', b.ring(ww + 0.04, wh + 0.04, 0.16, ww, wh, 0.14, 0.075), trs(cx, wy, -0.01));
  b.RB('wood', ww + 0.36, 0.05, 0.2, 0.015, cx, WIN.y0 - 0.02, 0.06);

  // ---- 廊下側の壁の室内側の面（扉の開口部を除く）と枠 ----
  b.finish('z', Z1, -1, x0, dx0);
  b.finish('z', Z1, -1, dx1, x1);
  b.B('wood', dx0 - 0.08, dx0, 0, DOOR.h + 0.08, Z1 - 0.035, Z1);
  b.B('wood', dx1, dx1 + 0.08, 0, DOOR.h + 0.08, Z1 - 0.035, Z1);
  b.B('wood', dx0 - 0.08, dx1 + 0.08, DOOR.h, DOOR.h + 0.08, Z1 - 0.035, Z1);

  // ---- ベンチ（向かい合わせ。座面 0.5 m） ----
  for (const s of [-1, 1]) {
    const xin = cx + s * BENCH.x0;
    const xw = cx + s * BENCH.x1;
    const bcx = (xin + xw) / 2;
    const w = BENCH.x1 - BENCH.x0;
    const len = BENCH.z1;
    const zc = len / 2;
    b.RB('woodDark', w - 0.04, 0.36, len - 0.06, 0.02, bcx, 0.18, zc);
    b.RB('fabric', w, 0.16, len - 0.1, 0.055, bcx, 0.42, zc);
    const bx = xw - s * 0.09;
    for (let i = 0; i < 3; i++) {
      const z = 0.08 + (len - 0.16) * ((i + 0.5) / 3);
      b.RB('fabric', 0.17, 0.62, (len - 0.2) / 3 - 0.02, 0.065, bx, 0.84, z, 0, 0, -s * 0.07);
      for (const [dy, dz] of [[0.14, 0], [-0.1, -0.12], [-0.1, 0.12]]) b.add('button', new THREE.SphereGeometry(0.014, 8, 6), trs(bx - s * 0.085, 0.84 + dy, z + dz));
    }
    b.RB('wood', 0.2, 0.05, len, 0.02, xw - s * 0.1, 1.18, zc);
    for (const z of [0.03, len - 0.03]) b.RB('wood', w + 0.02, z < 0.1 ? 0.62 : 0.66, 0.06, 0.02, bcx, z < 0.1 ? 0.31 : 0.33, z);
    for (let i = 0; i < 6; i++) b.add('button', new THREE.SphereGeometry(0.012, 8, 6), trs(bcx, 0.502, 0.2 + i * 0.3));
    for (const z of [0.92, 1.8]) b.RB('cushion', 0.1, 0.34, 0.34, 0.05, xw - s * 0.24, 0.66, z, 0, s * 0.1, -s * 0.28);
    b.coll(Math.min(xin, xw), Math.max(xin, xw), 0, len, { y1: 1.2, occlude: true, name: `${def.id}:bench` });
  }

  // ---- テーブル（窓際の中央） ----
  {
    const tz = TABLE.z1 / 2;
    b.RB('woodDark', TABLE.hx * 2, 0.05, TABLE.z1, 0.022, cx, TABLE.top - 0.025, tz);
    b.add('brass', rodX(TABLE.hx * 2 - 0.08, 0.008), trs(cx, TABLE.top - 0.03, TABLE.z1 + 0.003));
    b.add('woodDark', cylinder(0.045, 0.06, TABLE.top - 0.06, 12), trs(cx, (TABLE.top - 0.06) / 2, tz + 0.05));
    b.add('brass', cylinder(0.24, 0.27, 0.035, 20), trs(cx, 0.018, tz + 0.05));
    b.RB('woodDark', 0.5, 0.08, 0.1, 0.02, cx, TABLE.top - 0.09, 0.05);
    const cloth = new THREE.PlaneGeometry(0.56, 0.56);
    cloth.rotateX(-Math.PI / 2);
    const cu = cloth.attributes.uv;
    for (let i = 0; i < cu.count; i++) cu.setXY(i, cu.getX(i) * 0.56, cu.getY(i) * 0.56);
    b.add('gingham', cloth, trs(cx, TABLE.top + 0.002, tz, 0, Math.PI / 4, 0));
    vaseWithFlowers(b, R, cx - 0.06, TABLE.top, 0.3, 0.035);
    lantern(b, cx + 0.24, TABLE.top, 0.28, 1);
    b.RB('fabric', 0.2, 0.035, 0.27, 0.008, cx - 0.12, TABLE.top + 0.02, 0.62, 0, 0.35, 0, 0x2f5a37);
    b.add('brass', box(0.06, 0.004, 0.06), trs(cx - 0.12, TABLE.top + 0.039, 0.62, 0, 0.35, 0));
    b.coll(cx - TABLE.hx - 0.02, cx + TABLE.hx + 0.02, 0, TABLE.z1 + 0.02, { y1: TABLE.top + 0.25, occlude: true, name: `${def.id}:table` });
  }

  // ---- 荷物棚（窓の上）----
  {
    const y = 2.3;
    for (const z of [0.07, 0.19, 0.31, 0.42]) b.add('brass', rodX(3.9, 0.012), trs(cx, y, z));
    b.add('brass', rodX(3.9, 0.012), trs(cx, y + 0.07, 0.44));
    for (const x of [-1.9, -0.65, 0.65, 1.9]) {
      b.add('brass', box(0.025, 0.025, 0.46), trs(cx + x, y - 0.01, 0.23));
      b.add('brass', box(0.02, 0.32, 0.02), trs(cx + x, y - 0.15, 0.2, 0.95, 0, 0));
      b.add('brass', box(0.02, 0.09, 0.02), trs(cx + x, y + 0.035, 0.44));
    }
    const suitcase = (x, w, h, d, col) => {
      b.RB('leather', w, h, d, 0.03, x, y + 0.012 + h / 2, 0.22, 0, 0, 0, col);
      for (const dx of [-w / 2 + 0.07, w / 2 - 0.07]) b.add('woodDark', box(0.03, h + 0.006, d + 0.006), trs(x + dx, y + 0.012 + h / 2, 0.22), 0x4a2a17);
      b.add('brass', box(0.08, 0.02, 0.015), trs(x, y + 0.012 + h * 0.75, 0.22 + d / 2 + 0.006));
      b.add('brass', new THREE.TorusGeometry(0.045, 0.008, 6, 10, Math.PI), trs(x, y + 0.012 + h, 0.22));
    };
    const leathers = [0x7b4a2e, 0x5e3a26, 0x8a5634, 0x6b4430, 0x4f3a2c];
    // 部屋ごとに並びを変える
    const slots = [-1.35, -0.62, 0.42, 1.32];
    slots.forEach((x, i) => {
      const kind = (i + def.seed) % 4;
      if (kind === 2) {
        b.RB('wicker', 0.52, 0.22, 0.32, 0.03, cx + x, y + 0.122, 0.22);
        b.add('brass', new THREE.TorusGeometry(0.16, 0.008, 6, 14, Math.PI), trs(cx + x, y + 0.23, 0.22, 0, Math.PI / 2, 0), 0xb9884a);
      } else if (kind === 3 && R() < 0.5) {
        // 空き
      } else suitcase(cx + x, 0.48 + R() * 0.16, 0.2 + R() * 0.08, 0.32 + R() * 0.05, leathers[Math.floor(R() * leathers.length)]);
    });
    b.coll(x0, x1, 0, 0.5, { y0: y - 0.05, y1: H, block: false, occlude: true, name: `${def.id}:rack` });
  }

  // ---- カーテン + レール ----
  {
    const rodY = WIN.y1 + 0.08;
    b.add('brass', rodX(ww + 0.7, 0.014), trs(cx, rodY, 0.14));
    for (const s of [-1, 1]) b.add('brass', new THREE.SphereGeometry(0.028, 10, 8), trs(cx + s * (ww / 2 + 0.36), rodY, 0.14));
    for (const s of [-1, 1]) {
      const ccx = cx + s * (WIN.rx1 + 0.08);
      b.add('curtain', b.curtain(0.46, rodY - (WIN.y0 + 0.02), s), trs(ccx, WIN.y0 + 0.02, 0.12));
      b.RB('brass', 0.15, 0.03, 0.09, 0.012, ccx - s * 0.02, WIN.y0 + 0.5, 0.14);
    }
  }

  // ---- 壁のランプ・天井灯 ----
  for (const s of [-1, 1]) {
    for (const z of [0.42, 2.48]) {
      const x = cx + s * (COMP.hw - 0.01);
      b.add('brass', cylinder(0.05, 0.05, 0.02, 14), trs(x, 1.72, z, 0, 0, Math.PI / 2));
      b.add('brass', box(0.13, 0.018, 0.018), trs(x - s * 0.07, 1.72, z));
      b.add('brass', box(0.018, 0.08, 0.018), trs(x - s * 0.13, 1.76, z));
      b.add('brass', cylinder(0.035, 0.025, 0.03, 12), trs(x - s * 0.13, 1.8, z));
      b.add('glow', new THREE.SphereGeometry(0.055, 14, 10), trs(x - s * 0.13, 1.86, z, 0, 0, 0, [1, 1.15, 1]));
    }
  }
  b.add('brass', cylinder(0.16, 0.12, 0.04, 20), trs(cx, H - 0.02, 1.5));
  b.add('glow', new THREE.SphereGeometry(0.15, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), trs(cx, H - 0.04, 1.5, Math.PI, 0, 0, [1, 0.55, 1]));

  // ---- 額の絵（左右の壁、ベンチの上） ----
  for (const s of [-1, 1]) {
    const x = cx + s * (COMP.hw - 0.015);
    const z = 1.22;
    const w = 0.66;
    const h = 0.48;
    const y = 1.62;
    const fr = 0.045;
    const pl = new THREE.PlaneGeometry(w, h);
    pl.rotateY(-s * Math.PI / 2);
    b.add(s < 0 ? paintA : paintB, pl, trs(x - s * 0.012, y, z));
    for (const [dy, dz, wz, hy] of [[h / 2, 0, w + fr * 2, fr], [-h / 2, 0, w + fr * 2, fr], [0, w / 2, fr, h], [0, -w / 2, fr, h]]) {
      b.add('wood', box(0.03, hy, wz), trs(x - s * 0.015, y + dy + (dy > 0 ? fr / 2 : dy < 0 ? -fr / 2 : 0), z + dz + (dz > 0 ? fr / 2 : dz < 0 ? -fr / 2 : 0)));
    }
  }

  // ---- 左前：本棚（上に鉢植え） ----
  {
    const bx0 = x0;
    const bx1 = x0 + 0.42;
    const z0 = 2.1;
    const z1 = 2.76;
    const bcx = (bx0 + bx1) / 2;
    const cz = (z0 + z1) / 2;
    const Hc = 0.9;
    b.add('wood', box(0.03, Hc, z1 - z0), trs(bx0 + 0.015, Hc / 2, cz));
    for (const z of [z0 + 0.015, z1 - 0.015]) b.add('wood', box(bx1 - bx0, Hc, 0.03), trs(bcx, Hc / 2, z));
    for (const y of [0.04, 0.46]) b.add('wood', box(bx1 - bx0 - 0.03, 0.03, z1 - z0 - 0.03), trs(bcx + 0.015, y, cz));
    b.RB('woodDark', bx1 - bx0 + 0.04, 0.045, z1 - z0 + 0.04, 0.012, bcx, Hc + 0.02, cz);
    books(b, R, bx0 + 0.15, [0.055, 0.475], z0 + 0.04, z1 - 0.06, 'z');
    const py = Hc + 0.045;
    b.add('ceramic', cylinder(0.11, 0.08, 0.16, 16), trs(bcx + 0.02, py + 0.08, cz));
    b.add('woodDark', cylinder(0.1, 0.1, 0.01, 14), trs(bcx + 0.02, py + 0.155, cz), 0x3a2a1c);
    b.foliage(R, bcx + 0.02, py + 0.16, cz, 0.24, 26);
    b.coll(bx0, bx1 + 0.02, z0, z1, { y1: 1.3, occlude: true, name: `${def.id}:shelf` });
  }

  // ---- 右前：植物スタンド ----
  {
    const pcx = x1 - 0.2;
    const cz = 2.5;
    b.add('woodDark', cylinder(0.16, 0.16, 0.03, 18), trs(pcx, 0.45, cz));
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.4;
      b.add('woodDark', cylinder(0.014, 0.014, 0.45, 6), trs(pcx + Math.cos(a) * 0.11, 0.225, cz + Math.sin(a) * 0.11));
    }
    b.add('ceramic', cylinder(0.12, 0.09, 0.2, 16), trs(pcx, 0.565, cz), 0xe9e1cf);
    b.add('woodDark', cylinder(0.11, 0.11, 0.01, 14), trs(pcx, 0.66, cz), 0x3a2a1c);
    b.foliage(R, pcx, 0.665, cz, 0.42, 30);
    b.coll(pcx - 0.2, x1, cz - 0.2, cz + 0.2, { y1: 1.3, occlude: true, name: `${def.id}:plant` });
  }

  return {
    lights: [new THREE.Vector3(cx - 1.75, 1.95, 1.2), new THREE.Vector3(cx + 1.75, 1.95, 1.2), new THREE.Vector3(cx, 2.3, 1.9)],
    window: { x0: wx0, x1: wx1, y0: WIN.y0, y1: WIN.y1, z: 0, maxDepth: COMP.depth - 0.1 },
    doorRange: [dx0, dx1],
  };
}

/** 本の列（axis = 本が並ぶ向き） */
export function books(b, R, at, levels, a0, a1, axis = 'z', depth = 0.2) {
  const bookCols = [0x2f5a37, 0x7a2e2a, 0xd9cfae, 0x3b5d7a, 0x8a6a3a, 0x4f7a4a, 0xa64b2a];
  for (const y0 of levels) {
    let a = a0;
    while (a < a1) {
      const bw = 0.025 + R() * 0.025;
      const bh = 0.24 + R() * 0.12;
      const lean = R() < 0.12 ? 0.18 : 0;
      const col = bookCols[Math.floor(R() * bookCols.length)];
      if (axis === 'z') b.add('book', box(depth, bh, bw), trs(at, y0 + bh / 2, a + bw / 2, lean, 0, 0), col);
      else b.add('book', box(bw, bh, depth), trs(a + bw / 2, y0 + bh / 2, at, 0, 0, lean), col);
      a += bw + 0.004;
    }
  }
}

/** 花瓶と白い花 */
export function vaseWithFlowers(b, R, x, top, z, r = 0.035, n = 7) {
  b.add('glass', cylinder(r, r * 1.4, r * 4.3, 14), trs(x, top + r * 2.15, z));
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = r * (0.9 + R() * 0.9);
    const fx = x + Math.cos(a) * rr;
    const fz = z + Math.sin(a) * rr;
    const fy = top + r * 5.7 + R() * r * 1.7;
    b.add('plant', cylinder(0.003, 0.003, r * 3.4, 4), trs(fx, fy - r * 1.7, fz, Math.sin(a) * 0.2, 0, -Math.cos(a) * 0.2), 0x5a8d3e);
    b.add('plant', new THREE.IcosahedronGeometry(r * 0.63, 0), trs(fx, fy, fz, R(), R(), R(), [1, 0.6, 1]), 0xfdfbf2);
    b.add('plant', new THREE.SphereGeometry(r * 0.23, 6, 4), trs(fx, fy + 0.01, fz), 0xf2c94c);
  }
}

/** ランタン（真鍮 + 光るガラス）。s = 大きさの倍率 */
export function lantern(b, x, top, z, s = 1) {
  b.add('brass', cylinder(0.05 * s, 0.055 * s, 0.02 * s, 12), trs(x, top + 0.01 * s, z));
  for (const [dx, dz] of [[-0.04, -0.04], [0.04, -0.04], [-0.04, 0.04], [0.04, 0.04]]) b.add('brass', cylinder(0.005 * s, 0.005 * s, 0.14 * s, 5), trs(x + dx * s, top + 0.09 * s, z + dz * s));
  b.add('glow', cylinder(0.032 * s, 0.032 * s, 0.11 * s, 12), trs(x, top + 0.08 * s, z));
  b.add('brass', new THREE.ConeGeometry(0.06 * s, 0.05 * s, 4), trs(x, top + 0.185 * s, z, 0, Math.PI / 4, 0));
  b.add('brass', new THREE.TorusGeometry(0.018 * s, 0.004 * s, 6, 12), trs(x, top + 0.225 * s, z));
}

export { CORRIDOR };
