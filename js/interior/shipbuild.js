/**
 * interior/shipbuild.js — 【v16】FOREST SCHOOL の船の船内（Upper Deck）の組み立て
 * ---------------------------------------------------------------------------
 * 列車と同じ部品・マテリアル（木・深緑・アイボリー・真鍮）で、小〜中規模の上質な旅客船として作る。
 *   豪華客船のような吹き抜け・シャンデリア・大理石・カジノは作らない。
 * 区画（Builder.section）は zone と同じ id：
 *   shell（船体・外壁・屋根・仕切り壁など、どこからでも見える部分）
 *   viewroom / vrbalc / room1〜4 / room1b〜room4b / corridor / lounge / aft
 * 座標・寸法は shiplayout.js。
 */
import * as THREE from 'three';
import { box, cylinder, rodX, rodZ, trs, rng } from './kit.js';
import { books, vaseWithFlowers, lantern } from './compartment.js';
import { armchair, diningChair } from './lounge.js';
import { sofa, bench, bed, wardrobe, bigPlant, roundTable, sconce, ceilingLamp, stairWell, pendant, deckBench, rodBetween } from './furniture.js';
import { SH, SW, BEAM, CABIN, CABINS, CAB, SCORR, SVIEW, SLOUNGE, SAFT, SSTAIR, BALC, HULL, SHIP_HOLO, SHIP_NOTES, cabinXZ, cabinRect, cabinFacing } from './shiplayout.js';

const ZC = BEAM / 2;
const RAIL_H = 1.08;

/* ====================================================================== */
/* 壁・窓の道具                                                              */
/* ====================================================================== */
/** z = 一定の壁（x に沿う。厚み za〜zb）。holes: [{ a0, a1, y0, y1 }]（x の範囲・高さ） */
function wallZ(b, key, x0, x1, za, zb, holes = [], h = SH) {
  let px = x0;
  for (const o of [...holes].sort((p, q) => p.a0 - q.a0)) {
    if (o.a0 > px) b.B(key, px, o.a0, 0, h, za, zb);
    if (o.y0 > 0) b.B(key, o.a0, o.a1, 0, o.y0, za, zb);
    if (o.y1 < h) b.B(key, o.a0, o.a1, o.y1, h, za, zb);
    px = o.a1;
  }
  if (x1 > px) b.B(key, px, x1, 0, h, za, zb);
}
/** x = 一定の壁（z に沿う。厚み xa〜xb）。holes の a0, a1 は z の範囲 */
function wallX(b, key, z0, z1, xa, xb, holes = [], h = SH) {
  let pz = z0;
  for (const o of [...holes].sort((p, q) => p.a0 - q.a0)) {
    if (o.a0 > pz) b.B(key, xa, xb, 0, h, pz, o.a0);
    if (o.y0 > 0) b.B(key, xa, xb, 0, o.y0, o.a0, o.a1);
    if (o.y1 < h) b.B(key, xa, xb, o.y1, h, o.a0, o.a1);
    pz = o.a1;
  }
  if (z1 > pz) b.B(key, xa, xb, 0, h, pz, z1);
}

/** z = zi の壁の窓枠（室内側）。out = 外向きの z の符号（右舷の外壁は -1） */
function frameZ(b, a0, a1, y0, y1, zi, out, { glass = true, sill = true } = {}) {
  const ww = a1 - a0;
  const wh = y1 - y0;
  const wx = (a0 + a1) / 2;
  const wy = (y0 + y1) / 2;
  const ry = out < 0 ? 0 : Math.PI;
  b.add('wood', b.ring(ww + 0.28, wh + 0.28, 0.2, ww, wh, 0.12, 0.06), trs(wx, wy, zi, 0, ry, 0));
  b.add('brass', b.ring(ww + 0.04, wh + 0.04, 0.14, ww, wh, 0.12, 0.075), trs(wx, wy, zi + out * 0.01, 0, ry, 0));
  if (sill) b.RB('wood', ww + 0.34, 0.05, 0.2, 0.015, wx, y0 - 0.02, zi - out * 0.06);
  if (glass) b.add('glassPane', new THREE.PlaneGeometry(ww, wh), trs(wx, wy, zi + out * 0.06));
}
/** x = xi の壁の窓枠（室内側）。out = 外向きの x の符号 */
function frameX(b, a0, a1, y0, y1, xi, out, { glass = true, sill = true } = {}) {
  const ww = a1 - a0;
  const wh = y1 - y0;
  const wz = (a0 + a1) / 2;
  const wy = (y0 + y1) / 2;
  const ry = out < 0 ? Math.PI / 2 : -Math.PI / 2;
  b.add('wood', b.ring(ww + 0.28, wh + 0.28, 0.2, ww, wh, 0.12, 0.06), trs(xi, wy, wz, 0, ry, 0));
  b.add('brass', b.ring(ww + 0.04, wh + 0.04, 0.14, ww, wh, 0.12, 0.075), trs(xi + out * 0.01, wy, wz, 0, ry, 0));
  if (sill) b.RB('wood', 0.2, 0.05, ww + 0.34, 0.015, xi - out * 0.06, y0 - 0.02, wz);
  if (glass) {
    const g = new THREE.PlaneGeometry(ww, wh);
    g.rotateY(Math.PI / 2);
    b.add('glassPane', g, trs(xi + out * 0.06, wy, wz));
  }
}
/** 窓の両脇のタッセルで絞った深緑のカーテン（z = zi の壁） */
function curtainsZ(b, a0, a1, y0, y1, zi, out) {
  const ww = a1 - a0;
  const wx = (a0 + a1) / 2;
  for (const s of [-1, 1]) {
    const g = b.curtain(0.38, y1 - y0 + 0.1, out > 0 ? -s : s, 0.45);
    if (out > 0) g.rotateY(Math.PI);
    b.add('velvet', g, trs(wx + s * (ww / 2 + 0.06), y0 - 0.02, zi - out * 0.11));
  }
  b.add('brass', rodX(ww + 0.6, 0.012), trs(wx, y1 + 0.1, zi - out * 0.12));
}
/** 腰壁などの仕上げ（窓台が低い部分は腰壁を低く）。z = zi の面、inward = 室内への z の符号 */
function finishZ(b, zi, inward, x0, x1, gaps = []) {
  let px = x0;
  for (const g of [...gaps].sort((p, q) => p.a0 - q.a0)) {
    if (g.a0 > px) b.finish('z', zi, inward, px, g.a0, { h: SH });
    if (g.low != null) lowFinish(b, 'z', zi, inward, g.a0, g.a1, g.low);
    else topOnly(b, 'z', zi, inward, g.a0, g.a1);
    px = g.a1;
  }
  if (x1 > px) b.finish('z', zi, inward, px, x1, { h: SH });
}
function finishX(b, xi, inward, z0, z1, gaps = []) {
  let pz = z0;
  for (const g of [...gaps].sort((p, q) => p.a0 - q.a0)) {
    if (g.a0 > pz) b.finish('x', xi, inward, pz, g.a0, { h: SH });
    if (g.low != null) lowFinish(b, 'x', xi, inward, g.a0, g.a1, g.low);
    else topOnly(b, 'x', xi, inward, g.a0, g.a1);
    pz = g.a1;
  }
  if (z1 > pz) b.finish('x', xi, inward, pz, z1, { h: SH });
}
function seg(b, axis, at, sgn, a0, a1, d0, d1, y0, y1, key) {
  const [p0, p1] = sgn > 0 ? [at + d0, at + d1] : [at - d1, at - d0];
  if (axis === 'x') b.B(key, p0, p1, y0, y1, a0, a1);
  else b.B(key, a0, a1, y0, y1, p0, p1);
}
function lowFinish(b, axis, at, sgn, a0, a1, top) {
  if (top > 0.2) {
    seg(b, axis, at, sgn, a0, a1, 0, 0.018, 0.1, top - 0.04, 'wainscot');
    seg(b, axis, at, sgn, a0, a1, 0, 0.025, 0, 0.11, 'woodDark');
  }
  topOnly(b, axis, at, sgn, a0, a1);
}
function topOnly(b, axis, at, sgn, a0, a1) {
  seg(b, axis, at, sgn, a0, a1, 0, 0.06, SH - 0.12, SH, 'wood');
  seg(b, axis, at, sgn, a0, a1, 0, 0.03, SH - 0.16, SH - 0.12, 'wood');
}

/** 扉・アーチの枠（z = zi の面。sgn = 室内への向き）と敷居 */
function doorFrameZ(b, a0, a1, h, zi, sgn) {
  const [p0, p1] = sgn > 0 ? [zi, zi + 0.035] : [zi - 0.035, zi];
  b.B('wood', a0 - 0.08, a0, 0, h + 0.08, p0, p1);
  b.B('wood', a1, a1 + 0.08, 0, h + 0.08, p0, p1);
  b.B('wood', a0 - 0.08, a1 + 0.08, h, h + 0.08, p0, p1);
}
function doorFrameX(b, a0, a1, h, xi, sgn) {
  const [p0, p1] = sgn > 0 ? [xi, xi + 0.035] : [xi - 0.035, xi];
  b.B('wood', p0, p1, 0, h + 0.08, a0 - 0.08, a0);
  b.B('wood', p0, p1, 0, h + 0.08, a1, a1 + 0.08);
  b.B('wood', p0, p1, h, h + 0.08, a0 - 0.08, a1 + 0.08);
}

/** 天井（漆喰）と木の梁 */
function ceiling(b, x0, x1, z0, z1, along = 'z', step = 0.8) {
  b.B('plaster', x0, x1, SH, SH + 0.1, z0, z1);
  if (along === 'z') for (let x = x0 + step / 2; x < x1; x += step) b.B('wood', x - 0.035, x + 0.035, SH - 0.06, SH, z0, z1);
  else for (let z = z0 + step / 2; z < z1; z += step) b.B('wood', x0, x1, SH - 0.06, SH, z - 0.035, z + 0.035);
}

/** 屋外の手すり（ガラスの腰板 + チークの笠木 + 真鍮の支柱）。x に沿う。out = 海側の z の符号 */
function railAlongX(b, x0, x1, z, out, name) {
  b.B('wood', x0, x1, RAIL_H - 0.05, RAIL_H + 0.02, z - 0.055, z + 0.055);
  b.B('brass', x0, x1, RAIL_H - 0.075, RAIL_H - 0.05, z - 0.02, z + 0.02);
  b.B('paint', x0, x1, 0, 0.1, z - 0.04, z + 0.04, 0xe8e6df);
  const n = Math.max(1, Math.round((x1 - x0) / 1.1));
  for (let i = 0; i <= n; i++) b.add('brass', box(0.04, RAIL_H - 0.05, 0.04), trs(x0 + ((x1 - x0) * i) / n, (RAIL_H - 0.05) / 2, z));
  const g = new THREE.PlaneGeometry(x1 - x0, RAIL_H - 0.2);
  b.add('glassPane', g, trs((x0 + x1) / 2, (RAIL_H - 0.2) / 2 + 0.1, z));
  b.coll(x0, x1, out < 0 ? z - 0.5 : z - 0.07, out < 0 ? z + 0.07 : z + 0.5, { y1: RAIL_H, block: true, name });
}
function railAlongZ(b, z0, z1, x, out, name) {
  b.B('wood', x - 0.055, x + 0.055, RAIL_H - 0.05, RAIL_H + 0.02, z0, z1);
  b.B('brass', x - 0.02, x + 0.02, RAIL_H - 0.075, RAIL_H - 0.05, z0, z1);
  b.B('paint', x - 0.04, x + 0.04, 0, 0.1, z0, z1, 0xe8e6df);
  const n = Math.max(1, Math.round((z1 - z0) / 1.1));
  for (let i = 0; i <= n; i++) b.add('brass', box(0.04, RAIL_H - 0.05, 0.04), trs(x, (RAIL_H - 0.05) / 2, z0 + ((z1 - z0) * i) / n));
  const g = new THREE.PlaneGeometry(z1 - z0, RAIL_H - 0.2);
  g.rotateY(Math.PI / 2);
  b.add('glassPane', g, trs(x, (RAIL_H - 0.2) / 2 + 0.1, (z0 + z1) / 2));
  b.coll(out < 0 ? x - 0.5 : x - 0.07, out < 0 ? x + 0.07 : x + 0.5, z0, z1, { y1: RAIL_H, block: true, name });
}

/** 屋外の壁のランプ（真鍮の籠 + 光る球）。nx, nz = 壁から外への向き */
function deckLamp(b, x, y, z, nx, nz) {
  b.add('brass', box(nx ? 0.04 : 0.14, 0.2, nz ? 0.04 : 0.14), trs(x + nx * 0.02, y, z + nz * 0.02));
  b.add('glow', new THREE.SphereGeometry(0.06, 12, 8), trs(x + nx * 0.1, y, z + nz * 0.1, 0, 0, 0, [1, 1.3, 1]));
  for (const a of [0, Math.PI / 2]) b.add('brass', new THREE.TorusGeometry(0.07, 0.006, 5, 14), trs(x + nx * 0.1, y, z + nz * 0.1, 0, a, 0, [1, 1.3, 1]));
  b.add('brass', cylinder(0.05, 0.07, 0.03, 12), trs(x + nx * 0.1, y + 0.1, z + nz * 0.1));
}

/* ====================================================================== */
/* 船体・外壁・屋根（shell）                                                 */
/* ====================================================================== */
function hullShape(e = 0, xStart = HULL.stern) {
  // (X, Y) = (x, -z)。rotateX(-π/2) で Y → z = -Y
  const z0 = HULL.z0 - e;
  const z1 = HULL.z1 + e;
  const s = new THREE.Shape();
  s.moveTo(xStart + e, -(z0 + 0.3));
  s.lineTo(xStart + e - 0.3, -z0);
  s.lineTo(-10.8, -z0);
  s.quadraticCurveTo(-19.5, -z0, HULL.bow - e, -ZC);
  s.quadraticCurveTo(-19.5, -z1, -10.8, -z1);
  s.lineTo(xStart + e - 0.3, -z1);
  s.lineTo(xStart + e, -(z1 - 0.3));
  s.closePath();
  return s;
}
/** 船首のカーブ上の点（舷側 side = -1 右舷 / +1 左舷、t = 0 … x = -10.8、1 … 船首） */
function bowPoint(side, t) {
  const z0 = side < 0 ? HULL.z0 : HULL.z1;
  const P0 = [-10.8, z0];
  const P1 = [-19.5, z0];
  const P2 = [HULL.bow, ZC];
  const u = 1 - t;
  return [u * u * P0[0] + 2 * u * t * P1[0] + t * t * P2[0], u * u * P0[1] + 2 * u * t * P1[1] + t * t * P2[1]];
}

function extrudeUp(shape, y0, h) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, curveSegments: 24 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, y0, 0);
  return g;
}

export function buildShipShell(b) {
  b.section('shell');
  const R = rng(1616);
  const FORE = -2.6; // 前甲板（船首）の高さ
  const BASE = -0.13; // 上甲板の外周の通路の高さ
  // ---- 船体（白）・喫水の上の深緑の帯・ボトム ----
  b.add('paint', extrudeUp(hullShape(0), -11.5, -11.5 * -1 + FORE), null, 0xf6f5f0);
  b.add('paint', extrudeUp(hullShape(0.03), -8.75, 0.42), null, 0x2f5a3a);
  b.add('paint', extrudeUp(hullShape(0.02), -10.55, 0.75), null, 0x1f3a2a);
  b.add('paint', extrudeUp(hullShape(0.02), FORE - 0.12, 0.12), null, 0x2f5a3a); // 前甲板の縁の帯
  // 舷側の丸窓（下の階。暗いガラス）
  for (const z of [HULL.z0 - 0.01, HULL.z1 + 0.01]) {
    for (let x = -9.4; x < 19; x += 1.6) b.add('paint', new THREE.CylinderGeometry(0.19, 0.19, 0.04, 14), trs(x, -5.2, z, Math.PI / 2, 0, 0), 0x2a3640);
    for (let x = -8.6; x < 19; x += 3.2) b.add('paint', new THREE.CylinderGeometry(0.19, 0.19, 0.04, 14), trs(x, -2.0, z, Math.PI / 2, 0, 0), 0x2a3640);
  }
  // 上甲板の土台（前甲板より上）と外周の通路（チーク）
  b.B('paint', -10.8, HULL.stern, FORE, BASE, HULL.z0, HULL.z1, 0xf6f5f0);
  b.B('paint', -10.82, HULL.stern + 0.02, BASE - 0.32, BASE - 0.2, HULL.z0 - 0.02, HULL.z1 + 0.02, 0x2f5a3a);
  b.B('deck', SVIEW.x0 - 0.12, SAFT.x0, BASE, BASE + 0.003, HULL.z0, -SW);
  b.B('deck', SVIEW.x0 - 0.12, SAFT.x0, BASE, BASE + 0.003, BEAM + SW, HULL.z1);
  // 外周の通路の縁の白いブルワーク（低い壁）
  for (const z of [HULL.z0 + 0.04, HULL.z1 - 0.04]) b.B('paint', SVIEW.x0 - 0.12, SAFT.x0, BASE, BASE + 0.32, z - 0.04, z + 0.04, 0xf2f1ec);
  // ---- 前甲板（船首）：チーク・白い手すり・ウインドラス・マスト ----
  {
    const g = new THREE.ShapeGeometry(hullShape(-0.08, -10.7), 24);
    g.rotateX(-Math.PI / 2);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 1, uv.getY(i) * 1);
    b.add('deck', g, trs(0, FORE + 0.003, 0));
    const N = 14;
    for (const side of [-1, 1]) {
      let prev = null;
      for (let i = 0; i <= N; i++) {
        const [x, zz] = bowPoint(side, i / N);
        const z = zz - side * 0.12;
        b.add('paint', cylinder(0.025, 0.025, 1.0, 8), trs(x, FORE + 0.5, z), 0xf4f3ee);
        if (prev) {
          rodBetween(b, 'paint', prev[0], FORE + 1.0, prev[1], x, FORE + 1.0, z, 0.03, 0xf4f3ee);
          rodBetween(b, 'paint', prev[0], FORE + 0.55, prev[1], x, FORE + 0.55, z, 0.018, 0xf4f3ee);
        }
        prev = [x, z];
      }
    }
    for (const s of [-1, 1]) {
      b.add('paint', cylinder(0.32, 0.32, 0.55, 18), trs(-16.2, FORE + 0.45, ZC + s * 1.1, Math.PI / 2, 0, 0), 0x3d4a44);
      b.add('paint', box(0.6, 0.4, 0.5), trs(-16.2, FORE + 0.2, ZC + s * 1.1), 0x2f5a3a);
      b.add('paint', cylinder(0.12, 0.15, 0.4, 12), trs(-13.0, FORE + 0.2, ZC + s * 2.6), 0x3d4a44);
    }
    b.add('paint', cylinder(0.06, 0.08, 4.2, 10), trs(-21.2, FORE + 2.1, ZC), 0xf4f3ee);
    b.add('glow', new THREE.SphereGeometry(0.08, 10, 8), trs(-21.2, FORE + 4.25, ZC));
    // 上甲板の土台の正面（View Room の下）の窓（下の階）
    for (let z = 0.9; z < BEAM; z += 1.6) b.add('paint', box(0.03, 0.55, 0.9), trs(-10.815, -1.35, z), 0x2a3640);
  }
  // ---- 屋根（バルコニーの庇を兼ねる）と縁の深緑の帯 ----
  const rx0 = SVIEW.x0 - 0.2;
  const rx1 = SLOUNGE.x1 + 0.9;
  const rz0 = HULL.z0 + 0.1;
  const rz1 = HULL.z1 - 0.1;
  b.B('exterior', rx0, rx1, SH + 0.1, SH + 0.3, rz0, rz1);
  b.B('paint', rx0 - 0.02, rx1 + 0.02, SH + 0.14, SH + 0.3, rz0 - 0.02, rz0 + 0.02, 0x2f5a3a);
  b.B('paint', rx0 - 0.02, rx1 + 0.02, SH + 0.14, SH + 0.3, rz1 - 0.02, rz1 + 0.02, 0x2f5a3a);
  b.B('paint', rx0 - 0.02, rx0 + 0.02, SH + 0.14, SH + 0.3, rz0, rz1, 0x2f5a3a);
  b.B('paint', rx1 - 0.02, rx1 + 0.02, SH + 0.14, SH + 0.3, rz0, rz1, 0x2f5a3a);
  // 屋根の上：煙突（白・深緑の帯・葉の紋章）とマスト
  {
    const fx = 9.6;
    const g = new THREE.CylinderGeometry(0.75, 1.0, 3.2, 4, 1);
    g.rotateY(Math.PI / 4);
    g.scale(1.25, 1, 0.95);
    b.add('paint', g, trs(fx, SH + 0.3 + 1.6, ZC), 0xf6f5f0);
    const band = new THREE.CylinderGeometry(0.79, 0.84, 0.7, 4, 1);
    band.rotateY(Math.PI / 4);
    band.scale(1.25, 1, 0.95);
    b.add('paint', band, trs(fx, SH + 0.3 + 2.7, ZC), 0x2f5a3a);
    const cap = new THREE.CylinderGeometry(0.72, 0.76, 0.18, 4, 1);
    cap.rotateY(Math.PI / 4);
    cap.scale(1.25, 1, 0.95);
    b.add('paint', cap, trs(fx, SH + 0.3 + 3.25, ZC), 0x24282a);
    for (const s of [-1, 1]) {
      const em = new THREE.PlaneGeometry(0.62, 0.62);
      if (s < 0) em.rotateY(Math.PI);
      b.add('emblem', em, trs(fx, SH + 0.3 + 1.7, ZC + s * 0.74));
    }
    b.add('paint', cylinder(0.05, 0.07, 3.8, 10), trs(-6.4, SH + 0.3 + 1.9, ZC), 0xf4f3ee);
    b.add('paint', box(0.06, 0.06, 1.6), trs(-6.4, SH + 0.3 + 3.0, ZC), 0xf4f3ee);
    b.add('glow', new THREE.SphereGeometry(0.07, 10, 8), trs(-6.4, SH + 0.3 + 3.85, ZC));
  }
  void R;
}

/* ====================================================================== */
/* View Room と両舷のバルコニー                                              */
/* ====================================================================== */
export function buildShipViewRoom(b) {
  const R = rng(1660);
  const { x0, x1 } = SVIEW;
  const A = SVIEW.arch;
  const fw = { z0: 0.45, z1: BEAM - 0.45, y0: 0.55, y1: 2.45 }; // 前面の大きな窓
  const sw = { x0: -10.25, x1: -7.6, y0: 0.42, y1: 2.42 }; // 側面の窓
  const sd = { x0: -7.3, x1: -6.46, h: 2.2 }; // バルコニーへのガラス戸
  // ---- 壁（shell：外からも見える） ----
  b.section('shell');
  wallX(b, 'exterior', -SW, BEAM + SW, x0 - SW, x0, [{ a0: fw.z0, a1: fw.z1, y0: fw.y0, y1: fw.y1 }]);
  for (const [zi, out] of [[0, -1], [BEAM, 1]]) {
    const za = out < 0 ? -SW : BEAM;
    const zb = out < 0 ? 0 : BEAM + SW;
    wallZ(b, 'exterior', x0 - SW, x1, za, zb, [
      { a0: sw.x0, a1: sw.x1, y0: sw.y0, y1: sw.y1 },
      { a0: sd.x0, a1: sd.x1, y0: 0, y1: sd.h },
    ]);
    b.coll(x0 - 0.3, sd.x0, out < 0 ? za - 0.1 : za, out < 0 ? zb : zb + 0.1, { wall: true, name: `sv:side-a${out}` });
    b.coll(sd.x1, x1 + 0.02, out < 0 ? za - 0.1 : za, out < 0 ? zb : zb + 0.1, { wall: true, name: `sv:side-b${out}` });
    void zi;
  }
  b.coll(x0 - 0.5, x0, -0.5, BEAM + 0.5, { wall: true, name: 'sv:front' });
  // 後ろの壁（Room 1・Room 3 の船首側の壁。中央の廊下へのアーチ）
  wallX(b, 'plaster', -SW, BEAM + SW, x1, x1 + SW, [{ a0: A.z0, a1: A.z1, y0: 0, y1: A.h }]);
  b.coll(x1 - 0.02, x1 + SW + 0.02, -0.4, A.z0, { wall: true, name: 'sv:rear-a' });
  b.coll(x1 - 0.02, x1 + SW + 0.02, A.z1, BEAM + 0.4, { wall: true, name: 'sv:rear-b' });
  for (const xf of [x1 - 0.035, x1 + SW]) {
    b.B('wood', xf, xf + 0.035, 0, A.h + 0.08, A.z0 - 0.08, A.z0);
    b.B('wood', xf, xf + 0.035, 0, A.h + 0.08, A.z1, A.z1 + 0.08);
    b.B('wood', xf, xf + 0.035, A.h, A.h + 0.08, A.z0 - 0.08, A.z1 + 0.08);
    b.B('brass', xf - 0.003, xf + 0.038, A.h + 0.02, A.h + 0.035, A.z0, A.z1);
  }
  b.B('brass', x1 - 0.02, x1 + SW + 0.02, -0.03, 0.006, A.z0, A.z1);
  b.B('floor', x1 - 0.02, x1 + SW + 0.02, -0.06, 0, A.z0, A.z1);

  // ---- 室内 ----
  b.section('viewroom');
  b.B('floor', x0, x1, -0.06, 0, 0, BEAM);
  const rug = new THREE.PlaneGeometry(3.4, 6.6);
  rug.rotateX(-Math.PI / 2);
  b.add('carpet', rug, trs(-8.3, 0.004, ZC));
  ceiling(b, x0 - SW, x1, -SW, BEAM + SW, 'z', 0.85);
  b.B('wood', x0, x1, SH - 0.07, SH, ZC - 0.12, ZC + 0.12);
  for (const dz of [-0.13, 0.13]) b.B('brass', x0, x1, SH - 0.06, SH - 0.045, ZC + dz - 0.008, ZC + dz + 0.008);
  // 前面の窓（低い窓台・細い縦の桟 3 本・真鍮の手すり）
  finishX(b, x0, 1, 0, BEAM, [{ a0: fw.z0, a1: fw.z1, low: fw.y0 }]);
  frameX(b, fw.z0, fw.z1, fw.y0, fw.y1, x0, -1);
  {
    const ww = fw.z1 - fw.z0;
    for (let i = 1; i < 4; i++) {
      const z = fw.z0 + (ww * i) / 4;
      b.B('wood', x0 - 0.04, x0 + 0.03, fw.y0, fw.y1, z - 0.035, z + 0.035);
      b.B('brass', x0 + 0.03, x0 + 0.04, fw.y0, fw.y1, z - 0.01, z + 0.01);
    }
    b.add('brass', rodZ(ww - 0.3, 0.02), trs(x0 + 0.26, 0.92, ZC));
    for (let i = 0; i <= 6; i++) {
      const z = fw.z0 + 0.15 + ((ww - 0.3) * i) / 6;
      b.add('brass', box(0.14, 0.018, 0.018), trs(x0 + 0.19, 0.92, z));
      b.add('brass', cylinder(0.014, 0.014, 0.34, 8), trs(x0 + 0.26, 0.75, z));
    }
    b.RB('velvet', 0.08, 0.16, ww + 0.4, 0.02, x0 + 0.12, fw.y1 + 0.11, ZC);
    const em = new THREE.PlaneGeometry(0.2, 0.2);
    em.rotateY(Math.PI / 2);
    b.add('emblem', em, trs(x0 + 0.165, fw.y1 + 0.11, ZC));
    b.coll(x0, x0 + 0.16, 0, BEAM, { y1: 0.6, name: 'sv:sill' });
  }
  // 側面の窓・ガラス戸の枠
  for (const [zi, out] of [[0, -1], [BEAM, 1]]) {
    finishZ(b, zi, -out, x0, x1, [{ a0: sw.x0, a1: sw.x1, low: sw.y0 }, { a0: sd.x0, a1: sd.x1, low: 0 }]);
    frameZ(b, sw.x0, sw.x1, sw.y0, sw.y1, zi, out);
    curtainsZ(b, sw.x0, sw.x1, sw.y0, sw.y1, zi, out);
    doorFrameZ(b, sd.x0, sd.x1, sd.h, zi, -out);
  }
  // 後ろの壁の室内側
  finishX(b, x1, -1, 0, BEAM, [{ a0: A.z0 - 0.08, a1: A.z1 + 0.08, low: 0 }]);
  // ---- 家具（主役は海。前向きのソファー 2・アームチェア 2・小卓・本棚） ----
  sofa(b, -8.2, 2.2, Math.PI / 2, 2.1, { name: 'sv:sofa-s' });
  sofa(b, -8.2, BEAM - 2.2, Math.PI / 2, 2.1, { name: 'sv:sofa-p' });
  armchair(b, -9.55, 0.95, Math.PI / 2 - 0.35);
  armchair(b, -9.55, BEAM - 0.95, Math.PI / 2 + 0.35);
  roundTable(b, -8.2, 0.62, 0.2, 0.55, 'sv:side-table-s');
  lantern(b, -8.26, 0.55, 0.6, 0.9);
  roundTable(b, -8.2, BEAM - 0.62, 0.2, 0.55, 'sv:side-table-p');
  vaseWithFlowers(b, R, -8.2, 0.55, BEAM - 0.62, 0.03, 7);
  // 後ろの壁の本棚（右舷側）と飾り棚（左舷側：天球儀）
  {
    const bz0 = 0.7;
    const bz1 = 2.5;
    const bh = 2.05;
    const xb = x1 - 0.38;
    b.B('woodDark', x1 - 0.03, x1, 0, bh, bz0, bz1);
    for (const z of [bz0, bz1 - 0.03]) b.B('woodDark', xb, x1, 0, bh, z, z + 0.03);
    for (const y of [0.05, 0.5, 0.95, 1.4, bh - 0.04]) b.B('woodDark', xb, x1, y, y + 0.03, bz0 + 0.03, bz1 - 0.03);
    books(b, R, x1 - 0.19, [0.08, 0.53, 0.98], bz0 + 0.05, bz1 - 0.08, 'z', 0.22);
    b.add('ceramic', cylinder(0.08, 0.06, 0.12, 14), trs(x1 - 0.19, 1.49, bz0 + 0.3));
    b.foliage(R, x1 - 0.19, 1.55, bz0 + 0.3, 0.18, 14);
    b.add('brass', cylinder(0.03, 0.045, 0.42, 14), trs(x1 - 0.19, 1.55, bz1 - 0.45, 0, 0, 1.2));
    b.coll(xb, x1, bz0, bz1, { y1: bh, occlude: true, name: 'sv:bookcase' });
    const sz0 = BEAM - 2.4;
    const sz1 = BEAM - 0.9;
    b.B('woodDark', x1 - 0.42, x1, 0.06, 0.82, sz0, sz1);
    b.B('wainscot', x1 - 0.435, x1 - 0.42, 0.14, 0.74, sz0 + 0.06, sz1 - 0.06);
    b.RB('wood', 0.48, 0.04, sz1 - sz0 + 0.06, 0.012, x1 - 0.21, 0.84, (sz0 + sz1) / 2);
    const gx = x1 - 0.22;
    const gz = (sz0 + sz1) / 2 - 0.3;
    b.add('woodDark', cylinder(0.08, 0.1, 0.04, 14), trs(gx, 0.88, gz));
    b.add('brass', cylinder(0.01, 0.01, 0.16, 6), trs(gx, 0.98, gz));
    for (const [rx, ry] of [[0, 0], [Math.PI / 2, 0], [Math.PI / 2, Math.PI / 2], [0.4, 0.8]]) b.add('brass', new THREE.TorusGeometry(0.13, 0.006, 6, 28), trs(gx, 1.18, gz, rx, ry, 0));
    b.add('glass', new THREE.SphereGeometry(0.045, 12, 8), trs(gx, 1.18, gz), 0x6fa8a0);
    lantern(b, gx, 0.86, gz + 0.65, 1.1);
    b.coll(x1 - 0.44, x1, sz0, sz1, { y1: 1.3, occlude: true, name: 'sv:sideboard' });
  }
  bigPlant(b, R, x1 - 0.32, 0.36, 0.85, 'sv:plant-s');
  bigPlant(b, R, x1 - 0.32, BEAM - 0.36, 0.85, 'sv:plant-p');
  // 照明
  for (const [x, z] of [[-9.3, 2.2], [-9.3, BEAM - 2.2], [-6.6, 2.2], [-6.6, BEAM - 2.2]]) ceilingLamp(b, x, SH - 0.06, z);
  for (const z of [A.z0 - 0.5, A.z1 + 0.5]) sconce(b, x1 - 0.01, 1.8, z, -1, 0);
  b.ivy(R, x0 + 0.12, SH - 0.15, 0.2, 0.7, 24);
  b.ivy(R, x0 + 0.12, SH - 0.15, BEAM - 0.2, 0.6, 20);

  // ---- 両舷のバルコニー（屋外。船首側は手すりだけで前方が見える） ----
  b.section('vrbalc');
  const bx0 = x0 + BALC.inset;
  const bx1 = x1 - BALC.inset;
  const lamps = [];
  for (const out of [-1, 1]) {
    const zw = out < 0 ? -SW : BEAM + SW; // 外壁の外面
    const zr = zw + out * BALC.depth; // 手すり
    const za = Math.min(zw, zr);
    const zb = Math.max(zw, zr);
    b.B('deck', bx0, bx1, -0.1, 0, za, zb);
    railAlongX(b, bx0, bx1, zr, out, `sv:balc-rail${out}`);
    railAlongZ(b, za, zb, bx0, -1, `sv:balc-front${out}`); // 船首側（手すり。前方の海が見える）
    deckLamp(b, (sd.x0 + sd.x1) / 2 + 0.9, 2.15, zw, 0, out);
    deckLamp(b, sw.x0 + 0.4, 2.15, zw, 0, out);
    lamps.push(new THREE.Vector3(-7.8, 2.3, zw + out * 0.8));
    // 船尾側の仕切り壁（外装）
    b.section('shell');
    b.B('exterior', bx1, bx1 + SW, 0, SH + 0.1, za, zb);
    b.coll(bx1 - 0.02, bx1 + SW + 0.02, za, zb, { wall: true, name: `sv:balc-wall${out}` });
    b.section('vrbalc');
  }
  return {
    lights: [new THREE.Vector3(-9.3, 2.35, 2.2), new THREE.Vector3(-9.3, 2.35, BEAM - 2.2), new THREE.Vector3(-6.6, 2.35, ZC), ...lamps, new THREE.Vector3(-4.2, 2.35, ZC)],
    windows: [{ x0: sw.x0, x1: sw.x1, y0: sw.y0, y1: sw.y1, z: 0, maxDepth: 3.0 }],
    doors: [
      { id: 'vr-bdoor-s', zi: 0, out: -1, ...sd },
      { id: 'vr-bdoor-p', zi: BEAM, out: 1, ...sd },
    ],
  };
}

/* ====================================================================== */
/* 船室（Room 1〜4）とバルコニー                                             */
/* ====================================================================== */
/**
 * @returns {{ lights, window, plates: Array<{ section, mesh }>, targets: object[], doors: object[] }}
 */
export function buildCabin(b, c) {
  const R = rng(c.seed);
  const L = CABIN.len;
  const D = CABIN.depth;
  const out = c.side < 0 ? -1 : 1; // 外（バルコニー）への z の符号
  const inward = -out;
  const X = (u) => c.x0 + u;
  const Z = (w) => (c.side < 0 ? w : BEAM - w);
  const BU = (key, u0, u1, y0, y1, w0, w1, color) => {
    const [x0, x1, z0, z1] = cabinRect(c, u0, u1, w0, w1);
    b.B(key, x0, x1, y0, y1, z0, z1, color);
  };
  const CU = (u0, u1, w0, w1, opts) => {
    const [x0, x1, z0, z1] = cabinRect(c, u0, u1, w0, w1);
    return b.coll(x0, x1, z0, z1, opts);
  };
  const G = CAB.glass;
  const BD = CAB.balcDoor;
  const DD = CAB.door;
  const plates = [];
  const targets = [];
  const zo = Z(0); // 外壁の内面
  const zc = Z(D); // 廊下側の壁の内面

  // ---- 外壁（バルコニー側）・廊下側の壁は shell（外からも廊下からも見える） ----
  b.section('shell');
  {
    const [za, zb] = [Math.min(Z(0), Z(-SW)), Math.max(Z(0), Z(-SW))];
    wallZ(b, 'exterior', X(0), X(L), za, zb, [
      { a0: X(G.u0), a1: X(G.u1), y0: G.y0, y1: G.y1 },
      { a0: X(BD.u0), a1: X(BD.u1), y0: 0, y1: BD.h },
    ]);
    CU(-0.02, BD.u0, -SW - 0.1, 0, { wall: true, name: `${c.id}:outer-a` });
    CU(BD.u1, L + 0.02, -SW - 0.1, 0, { wall: true, name: `${c.id}:outer-b` });
    // 外の壁のランプ（バルコニー）
    b.section(`${c.id}b`);
    deckLamp(b, X(G.u0 + 0.2), 2.2, Z(-SW), 0, out);
    deckLamp(b, X(BD.u1 + 0.35), 2.2, Z(-SW), 0, out);
  }
  // ---- 室内 ----
  b.section(c.id);
  BU('floor', 0, L, -0.06, 0, 0, D);
  {
    const rug = new THREE.PlaneGeometry(2.0, 1.4);
    rug.rotateX(-Math.PI / 2);
    const p = cabinXZ(c, 2.95, 1.55);
    b.add('carpet', rug, trs(p.x, 0.004, p.z, 0, Math.PI / 2, 0));
  }
  {
    const [x0, x1, z0, z1] = cabinRect(c, 0, L, -SW, D + SW);
    ceiling(b, x0, x1, z0, z1, 'x', 0.75);
  }
  // 壁の仕上げ：外壁（ガラスの下は低い腰壁）、廊下側（扉の開口を除く）、船首側・船尾側
  finishZ(b, zo, inward, X(0), X(L), [
    { a0: X(G.u0), a1: X(G.u1), low: G.y0 },
    { a0: X(BD.u0) - 0.08, a1: X(BD.u1) + 0.08, low: 0 },
  ]);
  frameZ(b, X(G.u0), X(G.u1), G.y0, G.y1, zo, out);
  curtainsZ(b, X(G.u0), X(G.u1), G.y0, G.y1, zo, out);
  doorFrameZ(b, X(BD.u0), X(BD.u1), BD.h, zo, inward);
  finishZ(b, zc, out, X(0), X(L), [{ a0: X(DD.u0) - 0.08, a1: X(DD.u1) + 0.08, low: 0 }]);
  doorFrameZ(b, X(DD.u0), X(DD.u1), DD.h, zc, out);
  const [fz0, fz1] = [Math.min(Z(0), Z(D)), Math.max(Z(0), Z(D))];
  b.finish('x', X(0), 1, fz0, fz1, { h: SH });
  b.finish('x', X(L), -1, fz0, fz1, { h: SH });

  // ---- シャワー室・トイレ（扉だけ。入れない） ----
  {
    const bt = CAB.bath;
    BU('plaster', bt.u0 - 0.1, bt.u0, 0, SH, bt.w0, D);
    BU('plaster', bt.u0 - 0.1, L, 0, SH, bt.w0 - 0.1, bt.w0);
    // 室内側の仕上げ
    const [px0, px1, pz0, pz1] = cabinRect(c, bt.u0 - 0.1, L, bt.w0 - 0.1, D);
    b.finish('x', px0, -1, pz0, pz1, { h: SH });
    const zf = Z(bt.w0 - 0.1);
    b.finish('z', zf, out, px0, px1, { h: SH });
    CU(bt.u0 - 0.12, L, bt.w0 - 0.12, D, { wall: true, name: `${c.id}:bath` });
    // 扉 2 枚（船尾向きの壁の面 u = bt.u0 - 0.1、室内 = -u 側）。真鍮の札・すりガラス
    const doorAt = (w0, w1, label, note, id) => {
      const wm = (w0 + w1) / 2;
      const p = cabinXZ(c, bt.u0 - 0.1, wm);
      const width = Math.abs(w1 - w0) - 0.16;
      const xf = p.x - 0.03;
      const [zA, zB] = [Math.min(Z(w0 + 0.08), Z(w1 - 0.08)), Math.max(Z(w0 + 0.08), Z(w1 - 0.08))];
      b.B('woodDark', xf, xf + 0.035, 0, 2.0, zA, zB);
      b.B('frostPlain', xf - 0.004, xf, 1.15, 1.75, (zA + zB) / 2 - 0.2, (zA + zB) / 2 + 0.2);
      b.B('wood', xf - 0.012, xf, 0.3, 0.95, (zA + zB) / 2 - 0.24, (zA + zB) / 2 + 0.24);
      b.B('wood', xf - 0.04, xf + 0.035, 0, 2.08, zA - 0.06, zA);
      b.B('wood', xf - 0.04, xf + 0.035, 0, 2.08, zB, zB + 0.06);
      b.B('wood', xf - 0.04, xf + 0.035, 2.0, 2.08, zA - 0.06, zB + 0.06);
      const hz = c.side < 0 ? zB - 0.08 : zA + 0.08;
      b.add('brass', box(0.03, 0.18, 0.02), trs(xf - 0.02, 1.0, hz));
      const pl = b.plate(label, 0.24, 0.085);
      pl.position.set(xf - 0.006, 1.88, (zA + zB) / 2);
      pl.rotation.y = -Math.PI / 2;
      plates.push({ section: c.id, mesh: pl });
      targets.push({ kind: 'future', id, note, anchor: new THREE.Vector3(xf - 0.3, 0, (zA + zB) / 2), radius: 0.5, label: 'E：調べる', head: new THREE.Vector3(xf - 0.05, 1.5, (zA + zB) / 2) });
      void width;
    };
    doorAt(bt.w0, bt.wSplit, 'SHOWER', SHIP_NOTES.shower, `${c.id}-shower`);
    doorAt(bt.wSplit + 0.05, D, 'WC', SHIP_NOTES.wc, `${c.id}-wc`);
    // 浴室の壁の額（扉の上ではなく、テーブルの見える面）
  }
  // ---- 収納（観音開きのクローゼット。船尾の壁際） ----
  {
    const W = CAB.wardrobe;
    const [x0, x1, z0, z1] = cabinRect(c, W.u0, W.u1, W.w0, W.w1);
    wardrobe(b, x0, x1, z0, z1, 'x-', 2.0, `${c.id}:wardrobe`);
  }
  // ---- ベッド ----
  const duvets = { room1: 0x3f6b45, room2: 0x6f8f5a, room3: 0x3f6b45, room4: 0x5a7a4a };
  const beds = {};
  const mkBed = (key, Bd, head) => {
    const [x0, x1, z0, z1] = cabinRect(c, Bd.u0, Bd.u1, Bd.w0, Bd.w1);
    const h = head === 'u-' ? 'x-' : head === 'w+' ? (c.side < 0 ? 'z+' : 'z-') : head;
    beds[key] = bed(b, x0, x1, z0, z1, h, { name: `${c.id}:bed-${key}`, duvet: duvets[c.id] });
  };
  mkBed('A', CAB.bedA, 'u-');
  mkBed('B', CAB.bedB, 'u-');
  // ベッドの間のナイトテーブルとランプ
  {
    const [x0, x1, z0, z1] = cabinRect(c, 0.05, 0.5, 1.3, 1.6);
    b.B('woodDark', x0, x1, 0, 0.55, z0, z1);
    b.B('wood', x0 - 0.01, x1 + 0.01, 0.55, 0.58, z0 - 0.01, z1 + 0.01);
    b.add('brass', new THREE.SphereGeometry(0.012, 8, 6), trs(x1 + 0.01, 0.4, (z0 + z1) / 2));
    const lx = (x0 + x1) / 2;
    const lz = (z0 + z1) / 2;
    b.add('brass', cylinder(0.06, 0.07, 0.03, 14), trs(lx, 0.595, lz));
    b.add('brass', cylinder(0.01, 0.01, 0.3, 6), trs(lx, 0.75, lz));
    b.add('shade', cylinder(0.08, 0.13, 0.16, 18, true), trs(lx, 0.92, lz));
    b.add('glow', new THREE.SphereGeometry(0.04, 10, 8), trs(lx, 0.88, lz));
    b.coll(x0, x1, z0, z1, { y1: 0.7, name: `${c.id}:nightstand` });
  }
  // 船首側の壁：ベッドの上の額（2 枚）と壁のランプ
  for (const [wm, key] of [[0.78, 'paintL'], [2.12, 'paintR']]) {
    const p = cabinXZ(c, 0.015, wm);
    const pl = new THREE.PlaneGeometry(0.62, 0.44);
    pl.rotateY(Math.PI / 2);
    b.add(key, pl, trs(p.x + 0.012, 1.62, p.z));
    for (const [dy, dz, wz, hy] of [[0.24, 0, 0.7, 0.04], [-0.24, 0, 0.7, 0.04], [0, 0.33, 0.04, 0.48], [0, -0.33, 0.04, 0.48]]) b.add('wood', box(0.03, hy, wz), trs(p.x + 0.015, 1.62 + dy, p.z + dz));
  }
  {
    const p = cabinXZ(c, 0, 1.45);
    sconce(b, p.x + 0.01, 1.62, p.z, 1, 0);
  }
  // ---- ベッド C（Room 3・4）／ ベンチ（Room 1・2） ----
  let benchSeat = null;
  if (c.beds >= 3) mkBed('C', CAB.bedC, 'w+');
  else {
    const bu = (CAB.bench.u0 + CAB.bench.u1) / 2;
    const p = cabinXZ(c, bu, D);
    const yaw = cabinFacing(c, 0, -1); // 窓（バルコニー）の方を向く
    bench(b, p.x, p.z, yaw, CAB.bench.u1 - CAB.bench.u0, { name: `${c.id}:bench` });
    benchSeat = { ...cabinXZ(c, bu, D - 0.38), y: 0.5, facing: yaw };
    // ベンチの上の額
    const q = cabinXZ(c, bu, D - 0.015);
    const pl = new THREE.PlaneGeometry(0.62, 0.42);
    if (c.side < 0) pl.rotateY(Math.PI);
    b.add('paintR', pl, trs(q.x, 1.75, q.z));
    for (const [dy, dx, w, h] of [[0.23, 0, 0.7, 0.04], [-0.23, 0, 0.7, 0.04], [0, 0.33, 0.04, 0.46], [0, -0.33, 0.04, 0.46]]) b.add('wood', box(w, h, 0.03), trs(q.x + dx, 1.75 + dy, q.z + out * 0.0));
  }
  // ---- 窓辺の小さなテーブル（Room 4 は仔馬のため椅子を置かず広く） ----
  {
    const T = CAB.table;
    const p = cabinXZ(c, T.u, T.w);
    roundTable(b, p.x, p.z, T.r, 0.62, `${c.id}:table`);
    lantern(b, p.x - 0.08, 0.62, p.z, 0.9);
    vaseWithFlowers(b, R, p.x + 0.1, 0.62, p.z + 0.04, 0.026, 6);
    if (!c.roomy) {
      const q = cabinXZ(c, T.u, T.w + 0.55);
      diningChair(b, q.x, q.z, cabinFacing(c, 0, -1));
    }
  }
  // ---- 天井灯・扉の横の植物 ----
  {
    const p = cabinXZ(c, 2.6, 1.6);
    ceilingLamp(b, p.x, SH - 0.06, p.z);
  }
  // ---- 廊下側の扉の室内側のプレート（部屋の名前） ----
  // ---- バルコニー（屋外。ガラス戸から出られる） ----
  b.section(`${c.id}b`);
  const bu0 = BALC.inset;
  const bu1 = L - BALC.inset;
  {
    const zw = Z(-SW);
    const zr = zw + out * BALC.depth;
    const [za, zb] = [Math.min(zw, zr), Math.max(zw, zr)];
    b.B('deck', X(bu0), X(bu1), -0.1, 0, za, zb);
    railAlongX(b, X(bu0), X(bu1), zr, out, `${c.id}:balc-rail`);
    // 小さな鉢植え（家具は置かない）
    const pp = cabinXZ(c, bu0 + 0.3, -SW - 0.3);
    b.add('ceramic', cylinder(0.13, 0.1, 0.26, 14), trs(pp.x, 0.13, pp.z), 0xe9e1cf);
    b.foliage(R, pp.x, 0.26, pp.z, 0.38, 20);
    b.coll(pp.x - 0.15, pp.x + 0.15, pp.z - 0.15, pp.z + 0.15, { y1: 0.7, name: `${c.id}:balc-plant` });
    // 両端の仕切り壁（外装。隣のバルコニーは見えない）
    b.section('shell');
    for (const [u0, u1] of [[bu0 - SW, bu0], [bu1, bu1 + SW]]) {
      b.B('exterior', X(u0), X(u1), 0, SH + 0.1, za, zb);
      b.coll(X(u0) - 0.02, X(u1) + 0.02, za, zb, { wall: true, name: `${c.id}:balc-wall` });
    }
  }
  b.section(c.id);
  // ---- 光の位置（PointLight を移す先） ----
  const at = (u, w, y) => {
    const p = cabinXZ(c, u, w);
    return new THREE.Vector3(p.x, y, p.z);
  };
  return {
    lights: [at(2.6, 1.6, 2.35), at(0.4, 1.45, 1.9), at(3.4, 2.4, 2.3), at(2.6, -0.9, 2.3), at(1.2, 1.0, 2.2), at(3.5, 4.07 - (c.side < 0 ? 0 : 0), 2.4)],
    window: { x0: X(G.u0), x1: X(G.u1), y0: G.y0, y1: G.y1, z: zo, maxDepth: D - 0.1 },
    plates,
    targets,
    beds,
    benchSeat,
    doors: [
      { id: `${c.id}-door`, kind: 'corridor', a0: X(DD.u0), a1: X(DD.u1), zi: zc, side: c.side },
      { id: `${c.id}-bdoor`, kind: 'balcony', a0: X(BD.u0), a1: X(BD.u1), zi: zo, side: c.side },
    ],
  };
}

/* ====================================================================== */
/* 中央の廊下・仕切り壁・Lower Deck への階段                                 */
/* ====================================================================== */
export function buildShipCorridor(b) {
  const R = rng(1690);
  const { x0, x1, z0, z1 } = SCORR;
  const plates = [];
  // ---- 仕切り壁・廊下の両側の壁（shell） ----
  b.section('shell');
  for (const xa of [0, 5.37]) {
    b.B('plaster', xa, xa + SW, 0, SH, -SW, z0);
    b.B('plaster', xa, xa + SW, 0, SH, z1, BEAM + SW);
    b.coll(xa - 0.02, xa + SW + 0.02, -0.5, z0, { wall: true, name: 'ship:partition' });
    b.coll(xa - 0.02, xa + SW + 0.02, z1, BEAM + 0.5, { wall: true, name: 'ship:partition' });
  }
  const sDoors = CABINS.filter((c) => c.side < 0).map((c) => ({ a0: c.x0 + CAB.door.u0, a1: c.x0 + CAB.door.u1, y0: 0, y1: CAB.door.h }));
  const pDoors = CABINS.filter((c) => c.side > 0).map((c) => ({ a0: c.x0 + CAB.door.u0, a1: c.x0 + CAB.door.u1, y0: 0, y1: CAB.door.h }));
  // 右舷側（z = 3.2〜3.32）。後端は階段の降り口（x 5.49〜6.6）
  wallZ(b, 'plaster', x0, SSTAIR.x0, CABIN.depth, z0, sDoors);
  b.B('plaster', SSTAIR.x0, x1, 2.2, SH, CABIN.depth, z0); // 降り口の上
  wallZ(b, 'plaster', x0, x1, z1, z1 + SW, pDoors);
  // 当たり判定（扉の間の壁）
  const segs = (list, a, z) => {
    let px = x0;
    for (const d of list) {
      b.coll(px, d.a0, z[0], z[1], { wall: true, name: a });
      px = d.a1;
    }
    return px;
  };
  {
    const px = segs(sDoors, 'corr:s', [CABIN.depth - 0.04, z0]);
    b.coll(px, SSTAIR.x0, CABIN.depth - 0.04, z0, { wall: true, name: 'corr:s' });
    const qx = segs(pDoors, 'corr:p', [z1, z1 + SW + 0.04]);
    b.coll(qx, x1, z1, z1 + SW + 0.04, { wall: true, name: 'corr:p' });
  }
  // 階段の井戸の奥の壁（外から見える面は外装）
  b.B('exterior', SSTAIR.x0, x1, 0, SH, SSTAIR.z0 - SW, SSTAIR.z0);
  // 敷居（扉の足元の床。廊下を描かないときも残す）
  for (const d of [...sDoors.map((d) => [d, CABIN.depth]), ...pDoors.map((d) => [d, z1])]) {
    const [dd, zz] = d;
    b.B('floor', dd.a0 - 0.1, dd.a1 + 0.1, -0.06, 0, zz === CABIN.depth ? zz : zz, zz === CABIN.depth ? z0 : zz + SW);
    b.B('brass', dd.a0, dd.a1, -0.03, 0.006, zz === CABIN.depth ? zz : zz, zz === CABIN.depth ? z0 : zz + SW);
  }

  // ---- 廊下（corridor） ----
  b.section('corridor');
  b.B('floor', x0, x1, -0.06, 0, z0, z1);
  ceiling(b, x0, x1, z0 - SW, z1 + SW, 'z', 1.4);
  {
    const len = x1 - x0 - 0.5;
    const run = new THREE.PlaneGeometry(len, 0.7);
    run.rotateX(-Math.PI / 2);
    const ru = run.attributes.uv;
    for (let i = 0; i < ru.count; i++) ru.setX(i, ru.getX(i) * len);
    b.add('runner', run, trs((x0 + x1) / 2 - 0.1, 0.004, (z0 + z1) / 2));
  }
  finishZ(b, z0, 1, x0, SSTAIR.x0 - 0.12, sDoors.map((d) => ({ a0: d.a0 - 0.08, a1: d.a1 + 0.08, low: 0 })));
  finishZ(b, z1, -1, x0, x1, pDoors.map((d) => ({ a0: d.a0 - 0.08, a1: d.a1 + 0.08, low: 0 })));
  for (const d of sDoors) {
    doorFrameZ(b, d.a0, d.a1, d.y1, z0, 1);
    b.B('brass', d.a0 - 0.05, d.a1 + CAB.door.slide + 0.1, d.y1 + 0.1, d.y1 + 0.13, z0 + 0.035, z0 + 0.065);
  }
  for (const d of pDoors) {
    doorFrameZ(b, d.a0, d.a1, d.y1, z1, -1);
    b.B('brass', d.a0 - 0.05, d.a1 + CAB.door.slide + 0.1, d.y1 + 0.1, d.y1 + 0.13, z1 - 0.065, z1 - 0.035);
  }
  // 部屋のプレート（扉の船首側の壁）
  for (const c of CABINS) {
    const pl = b.plate(c.label);
    const zz = c.side < 0 ? z0 + 0.04 : z1 - 0.04;
    pl.position.set(c.x0 + CAB.door.u0 - 0.36, 1.55, zz);
    if (c.side > 0) pl.rotation.y = Math.PI;
    plates.push({ section: 'corridor', mesh: pl });
  }
  // 壁のランプ・額・天井灯
  for (const x of [-3.2, 1.2, 4.4]) {
    sconce(b, x, 1.8, z0 + 0.01, 0, 1);
    sconce(b, x, 1.8, z1 - 0.01, 0, -1);
  }
  for (const [x, key, z, s] of [[-1.3, 'paintR', z0, 1], [-1.3, 'paintL', z1, -1], [3.0, 'paintL', z0, 1]]) {
    const pl = new THREE.PlaneGeometry(0.5, 0.36);
    if (s < 0) pl.rotateY(Math.PI);
    b.add(key, pl, trs(x, 1.6, z + s * 0.04));
    for (const [dy, dx, w, h] of [[0.2, 0, 0.6, 0.04], [-0.2, 0, 0.6, 0.04], [0, 0.27, 0.04, 0.4], [0, -0.27, 0.04, 0.4]]) b.add('wood', box(w, h, 0.03), trs(x + dx, 1.6 + dy, z + s * 0.03));
  }
  for (let x = x0 + 1.2; x < x1; x += 2.4) ceilingLamp(b, x, SH - 0.06, (z0 + z1) / 2, 0.12);
  // 船尾の突き当たり（Dining & Lounge の扉のある壁）の廊下側
  // ---- Lower Deck への階段（廊下の後端の右舷側。廊下から右舷へ降りる） ----
  const stair = stairWell(b, (SSTAIR.x0 + SSTAIR.x1) / 2, z0, '-z', {
    width: SSTAIR.x1 - SSTAIR.x0,
    run: SSTAIR.run,
    rise: SSTAIR.rise,
    steps: SSTAIR.steps,
    chainU: 0.14,
    landing: 0.0,
    door: false,
    name: 'ship-stair',
  });
  plates.push({ section: 'corridor', mesh: stair.plate });
  // 降り口の両側の壁の廊下側の面（仕切り壁・ラウンジの前の壁）
  b.finish('x', SSTAIR.x0, 1, SSTAIR.z0, z0, { h: SH });
  b.finish('x', SSTAIR.x1, -1, SSTAIR.z0, z0, { h: SH });
  {
    const pl = b.plate('関係者以外立入禁止', 0.34, 0.09);
    pl.position.set((SSTAIR.x0 + SSTAIR.x1) / 2, 1.6, SSTAIR.z0 + 0.012);
    plates.push({ section: 'corridor', mesh: pl });
  }
  void R;
  return {
    plates,
    stair,
    target: { kind: 'future', id: 'ship-stair', note: SHIP_NOTES.stair, anchor: new THREE.Vector3((SSTAIR.x0 + SSTAIR.x1) / 2, 0, z0 + 0.35), radius: 0.75, label: 'E：調べる', head: stair.plate.position.clone() },
  };
}

/* ====================================================================== */
/* Dining & Lounge                                                          */
/* ====================================================================== */
const LD = { z0: 3.47, z1: 4.67, h: 2.05, slide: 1.1 }; // 廊下からの扉（前の壁）
const AD = { z0: 3.47, z1: 4.67, h: 2.2, slide: 1.1 }; // Aft Observation Deck へのガラス戸（後ろの壁）
export const SHIP_LOUNGE_DOOR = LD;
export const SHIP_AFT_DOOR = AD;

export function buildShipLounge(b) {
  const R = rng(1700);
  const { x0, x1 } = SLOUNGE;
  const plates = [];
  const swS = [{ a0: 7.6, a1: 9.6 }, { a0: 11.3, a1: 13.9 }];
  const swP = [{ a0: 7.9, a1: 9.9 }, { a0: 11.2, a1: 13.8 }];
  const wy = { y0: 0.85, y1: 2.25 };
  const rw = [{ a0: 0.45, a1: 3.15 }, { a0: BEAM - 3.15, a1: BEAM - 0.45 }];
  const ry = { y0: 0.45, y1: 2.45 };
  // ---- 壁（shell） ----
  b.section('shell');
  wallX(b, 'exterior', -SW, BEAM + SW, x0 - SW, x0, [{ a0: LD.z0, a1: LD.z1, y0: 0, y1: LD.h }]);
  b.coll(x0 - SW - 0.02, x0, -0.5, LD.z0, { wall: true, name: 'sl:front-a' });
  b.coll(x0 - SW - 0.02, x0, LD.z1, BEAM + 0.5, { wall: true, name: 'sl:front-b' });
  for (const xf of [x0 - SW - 0.035, x0]) {
    b.B('wood', xf, xf + 0.035, 0, LD.h + 0.08, LD.z0 - 0.08, LD.z0);
    b.B('wood', xf, xf + 0.035, 0, LD.h + 0.08, LD.z1, LD.z1 + 0.08);
    b.B('wood', xf, xf + 0.035, LD.h, LD.h + 0.08, LD.z0 - 0.08, LD.z1 + 0.08);
  }
  b.B('brass', x0 - SW - 0.02, x0 + 0.02, -0.03, 0.006, LD.z0, LD.z1);
  b.B('floor', x0 - 0.16, x0 + 0.16, -0.06, 0, LD.z0 - 0.1, LD.z1 + 0.1);
  for (const [za, zb, wins, out] of [[-SW, 0, swS, -1], [BEAM, BEAM + SW, swP, 1]]) {
    wallZ(b, 'exterior', x0 - SW, x1 + SW, za, zb, wins.map((w) => ({ ...w, ...wy })));
    b.coll(x0 - 0.3, x1 + 0.3, out < 0 ? za - 0.4 : za, out < 0 ? zb : zb + 0.4, { wall: true, name: `sl:side${out}` });
  }
  wallX(b, 'exterior', -SW, BEAM + SW, x1, x1 + SW, [...rw.map((w) => ({ ...w, ...ry })), { a0: AD.z0, a1: AD.z1, y0: 0, y1: AD.h }]);
  b.coll(x1 - 0.02, x1 + SW + 0.02, -0.5, AD.z0, { wall: true, name: 'sl:rear-a' });
  b.coll(x1 - 0.02, x1 + SW + 0.02, AD.z1, BEAM + 0.5, { wall: true, name: 'sl:rear-b' });
  // 前の壁の廊下側の仕上げ・プレート
  b.section('corridor');
  finishX(b, x0 - SW, -1, SCORR.z0, SCORR.z1, [{ a0: LD.z0 - 0.08, a1: LD.z1 + 0.08, low: 0 }]);
  b.B('brass', x0 - SW - 0.065, x0 - SW - 0.035, LD.h + 0.1, LD.h + 0.13, LD.z0 - 0.05, LD.z1 + LD.slide + 0.1);
  {
    const lp = b.plate('Dining & Lounge', 0.62, 0.17);
    lp.position.set(x0 - SW - 0.04, LD.h + 0.3, (LD.z0 + LD.z1) / 2);
    lp.rotation.y = -Math.PI / 2;
    plates.push({ section: 'corridor', mesh: lp });
  }

  // ---- 室内 ----
  b.section('lounge');
  b.B('floor', x0, x1, -0.06, 0, 0, BEAM);
  ceiling(b, x0 - SW, x1 + SW, -SW, BEAM + SW, 'z', 1.0);
  b.B('wood', x0, x1, SH - 0.08, SH, ZC - 0.14, ZC + 0.14);
  for (const dz of [-0.15, 0.15]) b.B('brass', x0, x1, SH - 0.07, SH - 0.05, ZC + dz - 0.01, ZC + dz + 0.01);
  for (const [xr, zr, w, d] of [[10.4, 2.0, 6.4, 2.8], [11.95, 6.35, 3.6, 2.9]]) {
    const rug = new THREE.PlaneGeometry(w, d);
    rug.rotateX(-Math.PI / 2);
    b.add('carpet', rug, trs(xr, 0.004, zr));
  }
  // 壁の仕上げ・窓
  finishX(b, x0, 1, 0, BEAM, [{ a0: LD.z0 - 0.08, a1: LD.z1 + 0.08, low: 0 }]);
  b.B('brass', x0 + 0.035, x0 + 0.065, LD.h + 0.1, LD.h + 0.13, LD.z0 - LD.slide - 0.1, LD.z1 + 0.05);
  for (const [zi, wins, out] of [[0, swS, -1], [BEAM, swP, 1]]) {
    finishZ(b, zi, -out, x0, x1, []);
    for (const w of wins) {
      frameZ(b, w.a0, w.a1, wy.y0, wy.y1, zi, out);
      curtainsZ(b, w.a0, w.a1, wy.y0, wy.y1, zi, out);
    }
  }
  finishX(b, x1, -1, 0, BEAM, [...rw.map((w) => ({ ...w, low: ry.y0 })), { a0: AD.z0 - 0.08, a1: AD.z1 + 0.08, low: 0 }]);
  for (const w of rw) frameX(b, w.a0, w.a1, ry.y0, ry.y1, x1, 1);
  {
    // 後ろのガラス戸の枠と上の深緑のバランス・紋章
    for (const xf of [x1 - 0.035, x1 + SW]) {
      b.B('wood', xf, xf + 0.035, 0, AD.h + 0.08, AD.z0 - 0.08, AD.z0);
      b.B('wood', xf, xf + 0.035, 0, AD.h + 0.08, AD.z1, AD.z1 + 0.08);
      b.B('wood', xf, xf + 0.035, AD.h, AD.h + 0.08, AD.z0 - 0.08, AD.z1 + 0.08);
    }
    b.B('brass', x1 - 0.02, x1 + SW + 0.02, -0.03, 0.006, AD.z0, AD.z1);
    b.B('floor', x1 - 0.02, x1 + SW + 0.02, -0.06, 0, AD.z0, AD.z1);
    b.RB('velvet', 0.08, 0.18, AD.z1 - AD.z0 + 0.4, 0.02, x1 - 0.12, AD.h + 0.24, (AD.z0 + AD.z1) / 2);
    const em = new THREE.PlaneGeometry(0.2, 0.2);
    em.rotateY(-Math.PI / 2);
    b.add('emblem', em, trs(x1 - 0.165, AD.h + 0.24, (AD.z0 + AD.z1) / 2));
  }
  // ---- 食卓（右舷側に 4 人掛け × 2） ----
  const table4 = (cx, cz) => {
    const tw = 1.3;
    const td = 0.9;
    const top = 0.76;
    b.RB('woodDark', tw, 0.06, td, 0.03, cx, top - 0.03, cz);
    b.RB('wood', tw - 0.06, 0.03, td - 0.06, 0.01, cx, top - 0.075, cz);
    b.add('woodDark', cylinder(0.1, 0.13, top - 0.12, 16), trs(cx, (top - 0.12) / 2 + 0.05, cz));
    b.add('brass', cylinder(0.14, 0.14, 0.04, 18), trs(cx, top * 0.62, cz));
    b.add('brass', cylinder(0.3, 0.34, 0.05, 20), trs(cx, 0.03, cz));
    const run = new THREE.PlaneGeometry(tw + 0.08, 0.36);
    run.rotateX(-Math.PI / 2);
    b.add('runnerLeaf', run, trs(cx, top + 0.003, cz));
    lantern(b, cx - 0.22, top, cz, 1.05);
    vaseWithFlowers(b, R, cx + 0.24, top, cz, 0.04, 9);
    for (const dx of [-0.32, 0.32]) {
      for (const s of [-1, 1]) {
        b.add('ceramicWhite', cylinder(0.1, 0.075, 0.015, 20), trs(cx + dx, top + 0.008, cz + s * (td / 2 - 0.18)));
        diningChair(b, cx + dx, cz + s * (td / 2 + 0.3), s < 0 ? Math.PI : 0);
      }
    }
    b.coll(cx - tw / 2 - 0.02, cx + tw / 2 + 0.02, cz - td / 2 - 0.02, cz + td / 2 + 0.02, { y1: 1.0, occlude: true, name: 'sl:table' });
  };
  table4(8.3, 2.05);
  table4(12.6, 2.05);
  // ---- ラウンジ（左舷側：ソファー・アームチェア 2・コーヒーテーブル） ----
  sofa(b, 13.25, 6.35, Math.PI / 2, 1.9, { name: 'sl:sofa' });
  armchair(b, 10.65, 5.65, -Math.PI / 2);
  armchair(b, 10.65, 7.05, -Math.PI / 2);
  roundTable(b, 11.95, 6.35, 0.36, 0.46, 'sl:coffee');
  b.add('ceramicWhite', cylinder(0.04, 0.03, 0.07, 12), trs(11.85, 0.495, 6.3));
  b.add('ceramicWhite', cylinder(0.08, 0.06, 0.012, 16), trs(11.85, 0.466, 6.3));
  books(b, R, 12.05, [0.46], 6.25, 6.45, 'z', 0.15);
  // ---- サービスカウンター（前の壁の左舷側） ----
  {
    const cx0 = x0;
    const cx1 = x0 + 0.62;
    const cz0 = 4.98;
    const cz1 = 7.6;
    const ch = 0.98;
    b.B('woodDark', cx0, cx1 - 0.03, 0.08, ch - 0.04, cz0, cz1);
    b.B('woodDark', cx0, cx1 - 0.08, 0, 0.08, cz0 + 0.02, cz1 - 0.02, 0x5a3a24);
    const n = 4;
    for (let i = 0; i < n; i++) {
      const pz0 = cz0 + 0.08 + ((cz1 - cz0 - 0.16) * i) / n + 0.03;
      const pz1 = cz0 + 0.08 + ((cz1 - cz0 - 0.16) * (i + 1)) / n - 0.03;
      b.B('wainscot', cx1 - 0.032, cx1 - 0.012, 0.2, ch - 0.16, pz0, pz1);
      b.B('brass', cx1 - 0.035, cx1 - 0.01, ch - 0.165, ch - 0.15, pz0 - 0.01, pz1 + 0.01);
      b.B('brass', cx1 - 0.035, cx1 - 0.01, 0.185, 0.2, pz0 - 0.01, pz1 + 0.01);
    }
    b.RB('wood', cx1 - cx0 + 0.06, 0.05, cz1 - cz0 + 0.12, 0.015, (cx0 + cx1) / 2 + 0.03, ch, (cz0 + cz1) / 2);
    b.add('brass', rodZ(cz1 - cz0, 0.014), trs(cx1 + 0.07, 0.16, (cz0 + cz1) / 2));
    const top = ch + 0.025;
    b.add('brass', new THREE.SphereGeometry(0.11, 18, 12), trs(x0 + 0.3, top + 0.11, 7.2, 0, 0, 0, [1, 1.1, 1]));
    b.add('brass', cylinder(0.05, 0.08, 0.05, 14), trs(x0 + 0.3, top + 0.24, 7.2));
    b.add('woodDark', cylinder(0.14, 0.12, 0.02, 20), trs(x0 + 0.3, top + 0.01, 6.1));
    b.add('ceramicWhite', cylinder(0.16, 0.16, 0.012, 22), trs(x0 + 0.3, top + 0.03, 6.1));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      b.add('cake', new THREE.SphereGeometry(0.035, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), trs(x0 + 0.3 + Math.cos(a) * 0.08, top + 0.04, 6.1 + Math.sin(a) * 0.08));
    }
    b.add('glassDome', new THREE.SphereGeometry(0.17, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), trs(x0 + 0.3, top + 0.04, 6.1));
    for (let i = 0; i < 4; i++) {
      b.add('ceramicWhite', cylinder(0.065, 0.05, 0.012, 16), trs(x0 + 0.3, top + 0.006, 5.2 + i * 0.2));
      b.add('ceramicWhite', cylinder(0.04, 0.032, 0.07, 14), trs(x0 + 0.3, top + 0.045, 5.2 + i * 0.2));
    }
    // 壁の棚とカップ・瓶
    for (const y of [1.55, 1.95]) {
      b.RB('wood', 0.26, 0.035, cz1 - cz0 - 0.3, 0.01, x0 + 0.13, y, (cz0 + cz1) / 2);
      for (const z of [cz0 + 0.3, cz1 - 0.3]) b.add('brass', box(0.22, 0.018, 0.018), trs(x0 + 0.12, y - 0.03, z));
    }
    for (let i = 0; i < 8; i++) {
      const uz = cz0 + 0.35 + i * 0.25;
      b.add('ceramicWhite', cylinder(0.045, 0.036, 0.085, 14), trs(x0 + 0.13, 1.55 + 0.06, uz));
    }
    for (let i = 0; i < 4; i++) {
      const jz = cz0 + 0.45 + i * 0.32;
      b.add('glass', cylinder(0.05, 0.05, 0.2, 12), trs(x0 + 0.13, 1.95 + 0.12, jz));
      b.add('cake', cylinder(0.044, 0.044, 0.12, 10), trs(x0 + 0.13, 1.95 + 0.08, jz), [0x9a6a3a, 0xd8b070, 0x6a8a4a, 0xb05a3a][i]);
    }
    b.ivy(R, x0 + 0.13, 1.98, cz1 - 0.3, 0.6, 22);
    b.coll(cx0, cx1 + 0.04, cz0, cz1, { y1: 1.05, occlude: true, name: 'sl:counter' });
  }
  // ---- 前の壁の本棚（右舷側） ----
  {
    const bz0 = 0.35;
    const bz1 = 1.75;
    const bh = 2.05;
    const xb = x0 + 0.36;
    b.B('woodDark', x0, x0 + 0.03, 0, bh, bz0, bz1);
    for (const z of [bz0, bz1 - 0.03]) b.B('woodDark', x0, xb, 0, bh, z, z + 0.03);
    for (const y of [0.05, 0.5, 0.95, 1.4, bh - 0.04]) b.B('woodDark', x0, xb, y, y + 0.03, bz0 + 0.03, bz1 - 0.03);
    books(b, R, x0 + 0.17, [0.08, 0.53, 0.98], bz0 + 0.05, bz1 - 0.08, 'z', 0.22);
    b.add('ceramic', cylinder(0.08, 0.06, 0.12, 14), trs(x0 + 0.18, 1.49, bz0 + 0.3));
    b.foliage(R, x0 + 0.18, 1.55, bz0 + 0.3, 0.18, 14);
    b.ivy(R, x0 + 0.18, 1.52, bz0 + 0.3, 0.5, 18);
    b.coll(x0, xb + 0.02, bz0, bz1, { y1: bh, occlude: true, name: 'sl:bookcase' });
  }
  // 窓の間の紋章バナー
  for (const [x, z, s] of [[10.45, 0.025, 1], [10.55, BEAM - 0.025, -1]]) {
    const g = new THREE.PlaneGeometry(0.42, 0.62);
    if (s < 0) g.rotateY(Math.PI);
    b.add('banner', g, trs(x, 1.62, z));
    b.add('brass', rodX(0.5, 0.008), trs(x, 1.95, z + s * 0.005));
  }
  // 植物・フロアランプ・照明
  bigPlant(b, R, x1 - 0.3, 0.35, 1, 'sl:plant-a');
  bigPlant(b, R, x1 - 0.3, BEAM - 0.35, 0.9, 'sl:plant-b');
  bigPlant(b, R, x0 + 0.3, 2.25, 0.8, 'sl:plant-c');
  {
    const fx = 14.15;
    const fz = 7.75;
    b.add('brass', cylinder(0.14, 0.16, 0.03, 18), trs(fx, 0.015, fz));
    b.add('brass', cylinder(0.012, 0.012, 1.45, 8), trs(fx, 0.75, fz));
    b.add('shade', cylinder(0.12, 0.2, 0.24, 20, true), trs(fx, 1.52, fz));
    b.add('glow', new THREE.SphereGeometry(0.05, 10, 8), trs(fx, 1.45, fz));
    b.coll(fx - 0.18, fx + 0.18, fz - 0.18, fz + 0.18, { y1: 1.7, name: 'sl:floor-lamp' });
  }
  pendant(b, 8.3, 2.05, SH, 0.24, 0.62);
  pendant(b, 12.6, 2.05, SH, 0.24, 0.62);
  pendant(b, 11.95, 6.35, SH, 0.2, 0.55);
  for (const x of [7.2, 14.2]) {
    sconce(b, x, 1.8, 0.01, 0, 1);
    sconce(b, x, 1.8, BEAM - 0.01, 0, -1);
  }
  b.ivy(R, x1 - 0.12, SH - 0.05, 0.15, 0.8, 26);
  b.ivy(R, x1 - 0.12, SH - 0.05, BEAM - 0.15, 0.7, 22);

  return {
    plates,
    lights: [new THREE.Vector3(8.3, 2.3, 2.05), new THREE.Vector3(12.6, 2.3, 2.05), new THREE.Vector3(11.95, 2.3, 6.35), new THREE.Vector3(7.4, 2.1, 6.2), new THREE.Vector3(SHIP_HOLO.x, 2.2, 1.3)],
    windows: swS.map((w) => ({ x0: w.a0, x1: w.a1, y0: wy.y0, y1: wy.y1, z: 0, maxDepth: BEAM - 0.2 })),
  };
}

/* ====================================================================== */
/* Aft Observation Deck（屋外の後方展望デッキ）                              */
/* ====================================================================== */
export function buildAftDeck(b) {
  const R = rng(1720);
  const { x0, x1, z0, z1 } = SAFT;
  b.section('aft');
  b.B('deck', x0, x1 + 0.1, -0.1, 0, z0 - 0.1, z1 + 0.1);
  // 手すり：両舷・船尾。前（ラウンジの横の通路）への出口はゲートで閉じる
  railAlongX(b, x0, x1, z0, -1, 'aft:rail-s');
  railAlongX(b, x0, x1, z1, 1, 'aft:rail-p');
  railAlongZ(b, z0, z1, x1, 1, 'aft:rail-stern');
  railAlongZ(b, z0, -SW, x0 + 0.06, -1, 'aft:gate-s');
  railAlongZ(b, BEAM + SW, z1, x0 + 0.06, -1, 'aft:gate-p');
  // ベンチ 2（船尾の海を向く）
  deckBench(b, 15.75, 1.7, -Math.PI / 2, 1.8, 'aft:bench-s');
  deckBench(b, 15.75, BEAM - 1.7, -Math.PI / 2, 1.8, 'aft:bench-p');
  // 足元の灯り（ボラード）
  for (const [x, z] of [[15.1, z0 + 0.35], [15.1, z1 - 0.35], [x1 - 0.35, z0 + 0.35], [x1 - 0.35, z1 - 0.35], [x1 - 0.35, ZC - 1.6], [x1 - 0.35, ZC + 1.6]]) {
    b.add('paint', cylinder(0.07, 0.08, 0.5, 12), trs(x, 0.25, z), 0x2f3a34);
    b.add('glow', cylinder(0.065, 0.065, 0.08, 12), trs(x, 0.46, z));
    b.add('brass', cylinder(0.08, 0.08, 0.025, 12), trs(x, 0.515, z));
    b.coll(x - 0.1, x + 0.1, z - 0.1, z + 0.1, { y1: 0.55, name: 'aft:bollard' });
  }
  // ラウンジの後ろの外壁のランプ
  for (const z of [1.9, BEAM - 1.9]) deckLamp(b, x0, 2.2, z, 1, 0);
  // 救命浮き輪（船尾の手すり）
  for (const z of [1.2, BEAM - 1.2]) {
    const g = new THREE.TorusGeometry(0.3, 0.07, 10, 24);
    g.rotateY(Math.PI / 2);
    b.add('paint', g, trs(x1 - 0.1, 0.72, z), 0xd9552b);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      b.add('paint', box(0.15, 0.12, 0.17), trs(x1 - 0.1, 0.72 + Math.sin(a) * 0.3, z + Math.cos(a) * 0.3, a, 0, 0), 0xf6f5f0);
    }
  }
  // 船尾の旗竿（深緑の紋章の旗）
  {
    // 景色の邪魔にならないよう、船尾の右舷の角に立てる
    const fx = x1 - 0.3;
    const fz = z0 + 0.35;
    b.add('paint', cylinder(0.035, 0.05, 3.4, 10), trs(fx, 1.7, fz), 0xf4f3ee);
    b.add('brass', new THREE.SphereGeometry(0.06, 10, 8), trs(fx, 3.45, fz));
    const flag = new THREE.PlaneGeometry(0.56, 0.8, 1, 8);
    flag.rotateZ(Math.PI / 2);
    const p = flag.attributes.position;
    for (let i = 0; i < p.count; i++) p.setZ(i, 0.05 * Math.sin((p.getX(i) + 0.4) * 5));
    b.add('banner', flag, trs(fx + 0.42, 3.05, fz));
    b.coll(fx - 0.08, fx + 0.08, fz - 0.08, fz + 0.08, { y1: 3.4, name: 'aft:flagpole' });
  }
  // 名称のプレート（ラウンジの後ろの壁の外）
  const plates = [];
  {
    const pl = b.plate('Aft Observation Deck', 0.7, 0.16);
    pl.position.set(x0 + 0.01, AD.h + 0.25, ZC);
    pl.rotation.y = Math.PI / 2;
    plates.push({ section: 'aft', mesh: pl });
  }
  void R;
  return {
    plates,
    lights: [new THREE.Vector3(x0 + 0.5, 2.3, 1.9), new THREE.Vector3(x0 + 0.5, 2.3, BEAM - 1.9), new THREE.Vector3(x1 - 0.5, 1.0, ZC), new THREE.Vector3(x1 - 0.4, 0.8, z0 + 0.4), new THREE.Vector3(x1 - 0.4, 0.8, z1 - 0.4)],
  };
}

export { SHIP_HOLO, rodX };
