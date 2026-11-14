/**
 * interior/lounge.js — 【v12】Dining & Lounge（列車の最後部の車両）
 * ---------------------------------------------------------------------------
 * 参考画像の「木 + 深緑 + アイボリー + 真鍮 + 暖色の照明」の上品で暖かい食堂・ラウンジ。
 *
 *   x = 9.12（前）〜 21.12（最後部）、z = 0（右舷）〜 4.3（左舷）、丸い天井（頂 2.98 m）
 *
 *          右舷（z = 0）： 大きな窓 × 3
 *   ┌───────────────────────────────────────────────────────┐
 *   │棚 ◎ホログラム   椅子 椅子 椅子      椅子▸◂椅子           │ ┌
 *   │本   ┌──── 大テーブル ────┐          (窓辺の 2 席)       │ │ 最後部
 *   │棚   └───────────────────┘                   椅子       │ │ パノラマ
 *   │     椅子 椅子 椅子                          ○ 丸テーブル │ │ 車窓
 *   🚪入口       ┌──── サービスカウンター ────┐     椅子       │ │
 *   └───────────────────────────────────────────────────────┘ └
 *          左舷（z = 4.3）： 窓 × 2・カウンターの上に棚
 *
 * 入口：前の壁の左舷側（廊下の突き当たり。進行方向左側の先頭側）
 * 座席：大テーブル 6 席 + ラウンジ 4 席（窓辺の向かい合わせ 2 席 × 2 組）= 10 席
 *       将来の集合場所（8 匹 + リンさん + ゲスト）。座る位置は LOUNGE_SEATS に書き出してある。
 */
import * as THREE from 'three';
import { box, cylinder, rodX, rodZ, trs, rng } from './kit.js';
import { WALL, LOUNGE, LOUNGE_DOOR, CORRIDOR, loungeCeil } from './layout.js';
import { books, vaseWithFlowers, lantern } from './compartment.js';

const T = LOUNGE.wallTop;
const ZC = (LOUNGE.z0 + LOUNGE.z1) / 2;

export const LOUNGE_WINDOWS = {
  starboard: [
    { x0: 10.4, x1: 12.8 },
    { x0: 13.8, x1: 16.2 },
    { x0: 17.4, x1: 19.8 },
  ],
  port: [
    { x0: 9.9, x1: 11.5 },
    { x0: 17.6, x1: 20.0 },
  ],
  y0: 0.85,
  y1: 2.2,
  rear: { z0: 0.35, z1: 3.95, y0: 0.7, y1: 2.45 },
};

export const DINING_TABLE = { x0: 11.9, x1: 14.9, z0: 1.42, z1: 2.48, top: 0.76 };

/** 10 席（x, z, 向き = 座った人の正面の方位角。0 = -Z） */
export const LOUNGE_SEATS = [
  // 大テーブル 6 席
  ...[12.35, 13.4, 14.45].map((x, i) => ({ id: `dining-s${i + 1}`, kind: 'dining', x, z: 0.95, yaw: Math.PI })),
  ...[12.35, 13.4, 14.45].map((x, i) => ({ id: `dining-p${i + 1}`, kind: 'dining', x, z: 2.95, yaw: 0 })),
  // ラウンジ 4 席（窓辺）
  { id: 'lounge-1', kind: 'lounge', x: 17.15, z: 0.85, yaw: -Math.PI / 2 },
  { id: 'lounge-2', kind: 'lounge', x: 18.75, z: 0.85, yaw: Math.PI / 2 },
  { id: 'lounge-3', kind: 'lounge', x: 20.3, z: 1.2, yaw: Math.PI },
  { id: 'lounge-4', kind: 'lounge', x: 20.3, z: 3.1, yaw: 0 },
];

export const HOLOGRAM_POS = new THREE.Vector3(10.75, 0, 0.6);

/**
 * @param {import('./builder.js').Builder} b
 */
export function buildLounge(b) {
  const R = rng(909);
  const { x0, x1, z0, z1 } = LOUNGE;
  const W = LOUNGE_WINDOWS;
  const D = LOUNGE_DOOR;

  // ================= 床・天井 =================
  b.B('floor', x0, x1, -0.06, 0, z0, z1);
  const rugA = new THREE.PlaneGeometry(4.3, 3.0);
  rugA.rotateX(-Math.PI / 2);
  b.add('carpet', rugA, trs(13.4, 0.004, 1.95));
  const rugB = new THREE.PlaneGeometry(3.4, 2.6);
  rugB.rotateX(-Math.PI / 2);
  b.add('carpet', rugB, trs(19.2, 0.004, 1.95, 0, Math.PI / 2, 0));

  // 丸い天井（円筒の一部。内側から見るので BackSide のマテリアル）
  {
    const chord = z1 - z0 + 2 * WALL;
    const s = LOUNGE.crown - T;
    const Rv = (chord * chord) / 4 / (2 * s) + s / 2;
    const a = Math.asin(chord / 2 / Rv);
    const len = x1 - x0 + 0.24;
    const vault = (r, h, key, xc) => {
      const g = new THREE.CylinderGeometry(r, r, h, 28, 1, true, -Math.PI / 2 - a, 2 * a);
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * r * 2 * a, uv.getY(i) * h);
      g.rotateZ(-Math.PI / 2);
      b.add(key, g, trs(xc, LOUNGE.crown - Rv, ZC));
    };
    vault(Rv, len, 'vault', (x0 + x1) / 2);
    for (let x = x0 + 0.75; x < x1; x += 1.5) vault(Rv - 0.035, 0.1, 'vaultWood', x);
    // 中央の梁・真鍮の帯・小さな埋め込み灯
    b.B('wood', x0, x1, LOUNGE.crown - 0.07, LOUNGE.crown - 0.01, ZC - 0.12, ZC + 0.12);
    for (const dz of [-0.13, 0.13]) b.B('brass', x0, x1, LOUNGE.crown - 0.06, LOUNGE.crown - 0.04, ZC + dz - 0.01, ZC + dz + 0.01);
    for (let x = x0 + 1.5; x < x1; x += 1.5) {
      for (const zz of [0.75, z1 - 0.75]) b.add('glow', cylinder(0.04, 0.04, 0.01, 10), trs(x, loungeCeil(zz) - 0.02, zz));
    }
    // 側壁の上端のコーニス
    for (const [zz, s2] of [[z0, 1], [z1, -1]]) b.B('wood', x0, x1, T - 0.08, T + 0.04, s2 > 0 ? zz : zz - 0.07, s2 > 0 ? zz + 0.07 : zz);
  }

  // ================= 壁 =================
  // 前の壁（x = 9.0〜9.12）。入口の開口部は左舷側
  {
    const xa = x0 - WALL;
    b.B('plaster', xa, x0, 0, 3.05, z0 - WALL, D.z0);
    b.B('plaster', xa, x0, 0, 3.05, D.z1, z1 + WALL);
    b.B('plaster', xa, x0, D.h, 3.05, D.z0, D.z1);
    b.finish('x', x0, 1, z0, D.z0, { h: T });
    b.finish('x', x0, 1, D.z1, z1, { h: T });
    // 開口部の枠（ラウンジ側・廊下側）
    for (const [xf, s] of [[x0, 1], [xa, -1]]) {
      const xA = s > 0 ? xf : xf - 0.035;
      const xB = s > 0 ? xf + 0.035 : xf;
      b.B('wood', xA, xB, 0, D.h + 0.08, D.z0 - 0.08, D.z0);
      b.B('wood', xA, xB, 0, D.h + 0.08, D.z1, D.z1 + 0.08);
      b.B('wood', xA, xB, D.h, D.h + 0.08, D.z0 - 0.08, D.z1 + 0.08);
    }
    b.B('brass', x0 + 0.035, x0 + 0.065, D.h + 0.1, D.h + 0.13, D.z0 - D.slide - 0.1, D.z1 + 0.05); // 引き戸のレール
    b.B('brass', xa - 0.02, x0 + 0.02, -0.03, 0.006, D.z0, D.z1); // 敷居
    b.coll(xa - 0.02, x0, z0 - 0.4, D.z0, { wall: true, name: 'lounge:front-a', y1: 3.1 });
    b.coll(xa - 0.02, x0, D.z1, z1 + 0.4, { wall: true, name: 'lounge:front-b', y1: 3.1 });
  }
  // 右舷の壁（z = -0.12〜0）：大きな窓 × 3
  sideWall(b, 0, -1, W.starboard);
  // 左舷の壁（z = 4.3〜4.42）：窓 × 2
  sideWall(b, z1, 1, W.port);
  // 最後部の壁：パノラマ車窓
  {
    const rw = W.rear;
    const xb = x1 + WALL;
    b.B('plaster', x1, xb, 0, rw.y0, z0 - WALL, z1 + WALL);
    b.B('plaster', x1, xb, rw.y1, 3.05, z0 - WALL, z1 + WALL);
    b.B('plaster', x1, xb, rw.y0, rw.y1, z0 - WALL, rw.z0);
    b.B('plaster', x1, xb, rw.y0, rw.y1, rw.z1, z1 + WALL);
    b.finish('x', x1, -1, z0, z1, { h: T });
    const ww = rw.z1 - rw.z0;
    const wh = rw.y1 - rw.y0;
    const wy = (rw.y0 + rw.y1) / 2;
    b.add('wood', b.ring(ww + 0.34, wh + 0.34, 0.26, ww, wh, 0.16, 0.07), trs(x1, wy, ZC, 0, -Math.PI / 2, 0));
    b.add('brass', b.ring(ww + 0.05, wh + 0.05, 0.18, ww, wh, 0.16, 0.085), trs(x1 + 0.01, wy, ZC, 0, -Math.PI / 2, 0));
    // 縦の桟（3 枚の大きなガラス）
    for (const z of [rw.z0 + ww / 3, rw.z0 + (2 * ww) / 3]) {
      b.B('wood', x1 - 0.03, x1 + 0.04, rw.y0, rw.y1, z - 0.045, z + 0.045);
      b.B('brass', x1 - 0.04, x1 - 0.03, rw.y0, rw.y1, z - 0.012, z + 0.012);
    }
    b.RB('wood', 0.22, 0.05, ww + 0.4, 0.015, x1 - 0.08, rw.y0 - 0.02, ZC); // 窓台
    // 緑のバランス（葉の紋章）とカーテン
    b.RB('velvet', 0.08, 0.2, ww + 0.5, 0.02, x1 - 0.12, rw.y1 + 0.17, ZC);
    b.add('brass', rodZ(ww + 0.5, 0.008), trs(x1 - 0.165, rw.y1 + 0.075, ZC));
    const em = new THREE.PlaneGeometry(0.2, 0.2);
    em.rotateY(-Math.PI / 2);
    b.add('emblem', em, trs(x1 - 0.165, rw.y1 + 0.17, ZC));
    for (const s of [-1, 1]) {
      const cz = s < 0 ? rw.z0 - 0.06 : rw.z1 + 0.06;
      const g = b.curtain(0.6, rw.y1 - rw.y0 + 0.08, s, 0.45);
      g.rotateY(-Math.PI / 2);
      b.add('velvet', g, trs(x1 - 0.1, rw.y0 - 0.02, cz));
      b.RB('brass', 0.08, 0.03, 0.14, 0.01, x1 - 0.12, rw.y0 + 0.62, cz);
    }
    b.coll(x1, x1 + 0.5, z0 - 0.4, z1 + 0.4, { wall: true, name: 'lounge:rear', y1: 3.1 });
  }

  // ================= 照明（吊りランプ・壁ランプ）=================
  const pendant = (x, z, r = 0.24) => {
    const top = loungeCeil(z);
    const y = top - 0.62;
    b.add('brass', cylinder(0.008, 0.008, top - y - 0.1, 6), trs(x, (top + y) / 2 + 0.05, z));
    b.add('brass', cylinder(0.07, 0.05, 0.03, 14), trs(x, top - 0.02, z));
    b.add('brass', new THREE.TorusGeometry(r, 0.012, 8, 32), trs(x, y, z, Math.PI / 2, 0, 0));
    b.add('brass', cylinder(r * 0.45, r * 0.25, 0.06, 18), trs(x, y + 0.06, z));
    b.add('glow', new THREE.SphereGeometry(r * 0.9, 22, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), trs(x, y, z, 0, 0, 0, [1, 0.42, 1]));
  };
  pendant(12.65, ZC);
  pendant(14.15, ZC);
  pendant(18.95, ZC, 0.2);
  const sconce = (x, z, s) => {
    b.add('brass', cylinder(0.05, 0.05, 0.02, 14), trs(x, 1.78, z, Math.PI / 2, 0, 0));
    b.add('brass', box(0.018, 0.018, 0.14), trs(x, 1.78, z + s * 0.07));
    b.add('brass', cylinder(0.035, 0.025, 0.03, 12), trs(x, 1.86, z + s * 0.14));
    b.add('glow', new THREE.SphereGeometry(0.06, 14, 10), trs(x, 1.93, z + s * 0.14, 0, 0, 0, [1, 1.2, 1]));
  };
  for (const x of [13.3, 16.8, 20.6]) sconce(x, z0 + 0.01, 1);
  for (const x of [12.0, 17.0, 20.6]) sconce(x, z1 - 0.01, -1);
  // 前の壁（低い棚の上）のランプ：x 方向へ出す
  b.add('brass', cylinder(0.05, 0.05, 0.02, 14), trs(x0 + 0.01, 1.78, 0.6, 0, 0, Math.PI / 2));
  b.add('brass', box(0.14, 0.018, 0.018), trs(x0 + 0.07, 1.78, 0.6));
  b.add('brass', cylinder(0.035, 0.025, 0.03, 12), trs(x0 + 0.14, 1.86, 0.6));
  b.add('glow', new THREE.SphereGeometry(0.06, 14, 10), trs(x0 + 0.14, 1.93, 0.6, 0, 0, 0, [1, 1.2, 1]));

  // ================= 大テーブル（6 席） =================
  const T0 = DINING_TABLE;
  {
    const tx = (T0.x0 + T0.x1) / 2;
    const tz = (T0.z0 + T0.z1) / 2;
    const tw = T0.x1 - T0.x0;
    const td = T0.z1 - T0.z0;
    b.RB('woodDark', tw, 0.06, td, 0.03, tx, T0.top - 0.03, tz);
    b.RB('wood', tw - 0.06, 0.03, td - 0.06, 0.01, tx, T0.top - 0.075, tz);
    for (const px of [T0.x0 + 0.7, T0.x1 - 0.7]) {
      b.add('woodDark', cylinder(0.11, 0.14, T0.top - 0.12, 16), trs(px, (T0.top - 0.12) / 2 + 0.05, tz));
      b.add('brass', cylinder(0.15, 0.15, 0.04, 18), trs(px, T0.top * 0.62, tz));
      b.RB('woodDark', 0.75, 0.07, 0.5, 0.03, px, 0.035, tz);
      b.add('brass', cylinder(0.17, 0.2, 0.05, 20), trs(px, 0.09, tz));
    }
    // ランナー（深緑 + 金の縁 + 葉の紋章）。両端は垂らす
    const run = new THREE.PlaneGeometry(tw + 0.1, 0.44);
    run.rotateX(-Math.PI / 2);
    b.add('runnerLeaf', run, trs(tx, T0.top + 0.003, tz));
    for (const s of [-1, 1]) {
      const d = new THREE.PlaneGeometry(0.44, 0.2);
      d.rotateY(s * Math.PI / 2);
      b.add('runnerLeaf', d, trs(tx + s * (tw / 2 + 0.052), T0.top - 0.1, tz));
    }
    lantern(b, tx - 0.35, T0.top, tz, 1.25);
    vaseWithFlowers(b, R, tx + 0.35, T0.top, tz, 0.05, 11);
    // 食器（白い皿）
    for (const s of LOUNGE_SEATS.filter((q) => q.kind === 'dining')) {
      const pz = s.z < tz ? T0.z0 + 0.2 : T0.z1 - 0.2;
      b.add('ceramicWhite', cylinder(0.11, 0.08, 0.015, 20), trs(s.x, T0.top + 0.008, pz));
      b.add('ceramicWhite', cylinder(0.035, 0.03, 0.06, 12), trs(s.x + 0.17, T0.top + 0.03, pz));
    }
    b.coll(T0.x0 - 0.02, T0.x1 + 0.02, T0.z0 - 0.02, T0.z1 + 0.02, { y1: 1.0, occlude: true, name: 'lounge:table' });
  }
  for (const s of LOUNGE_SEATS) {
    if (s.kind === 'dining') diningChair(b, s.x, s.z, s.yaw);
    else armchair(b, s.x, s.z, s.yaw);
  }

  // ================= ラウンジの小テーブル =================
  const roundTable = (x, z, r, h) => {
    b.add('woodDark', cylinder(r, r, 0.04, 28), trs(x, h - 0.02, z));
    b.add('brass', new THREE.TorusGeometry(r, 0.01, 6, 28), trs(x, h - 0.02, z, Math.PI / 2, 0, 0));
    b.add('woodDark', cylinder(0.035, 0.05, h - 0.05, 10), trs(x, (h - 0.05) / 2 + 0.02, z));
    b.add('brass', cylinder(0.18, 0.2, 0.03, 18), trs(x, 0.015, z));
    b.coll(x - r, x + r, z - r, z + r, { y1: h + 0.2, name: 'lounge:side-table' });
  };
  roundTable(17.95, 0.85, 0.3, 0.55);
  roundTable(20.3, 2.15, 0.34, 0.6);
  lantern(b, 20.3 - 0.12, 0.6, 2.15 + 0.05, 1);
  vaseWithFlowers(b, R, 20.3 + 0.12, 0.6, 2.15 - 0.06, 0.035, 7);
  b.add('ceramicWhite', cylinder(0.04, 0.03, 0.07, 12), trs(17.95, 0.585, 0.82));
  b.add('ceramicWhite', cylinder(0.08, 0.06, 0.012, 16), trs(17.95, 0.556, 0.82));

  // ================= サービスカウンター（左舷） =================
  {
    const cx0 = 12.3;
    const cx1 = 16.9;
    const cz0 = 3.72;
    const ch = 0.98;
    const ccx = (cx0 + cx1) / 2;
    b.B('woodDark', cx0, cx1, 0.08, ch - 0.04, cz0 + 0.03, z1);
    b.B('woodDark', cx0 + 0.02, cx1 - 0.02, 0, 0.08, cz0 + 0.08, z1, 0x5a3a24); // 蹴込み
    // 前面の緑の鏡板（真鍮の縁）
    const n = 6;
    for (let i = 0; i < n; i++) {
      const px0 = cx0 + 0.08 + ((cx1 - cx0 - 0.16) * i) / n + 0.03;
      const px1 = cx0 + 0.08 + ((cx1 - cx0 - 0.16) * (i + 1)) / n - 0.03;
      b.B('wainscot', px0, px1, 0.2, ch - 0.16, cz0 + 0.012, cz0 + 0.032);
      b.B('brass', px0 - 0.01, px1 + 0.01, ch - 0.165, ch - 0.15, cz0 + 0.01, cz0 + 0.035);
      b.B('brass', px0 - 0.01, px1 + 0.01, 0.185, 0.2, cz0 + 0.01, cz0 + 0.035);
      b.add('brass', new THREE.SphereGeometry(0.014, 8, 6), trs((px0 + px1) / 2, (ch + 0.04) / 2, cz0 + 0.03));
    }
    b.RB('wood', cx1 - cx0 + 0.12, 0.05, z1 - cz0 + 0.06, 0.015, ccx, ch, (cz0 + z1) / 2 - 0.03);
    b.add('brass', rodX(cx1 - cx0, 0.014), trs(ccx, 0.16, cz0 - 0.07));
    for (const x of [cx0 + 0.2, ccx, cx1 - 0.2]) b.add('brass', box(0.02, 0.02, 0.09), trs(x, 0.16, cz0 - 0.03));
    // カウンターの上：ケトル・ケーキドーム・瓶・カップ
    const top = ch + 0.025;
    const kx = cx1 - 0.35;
    const kz = 4.0;
    b.add('brass', new THREE.SphereGeometry(0.11, 18, 12), trs(kx, top + 0.11, kz, 0, 0, 0, [1, 1.1, 1]));
    b.add('brass', cylinder(0.05, 0.08, 0.05, 14), trs(kx, top + 0.24, kz));
    b.add('brass', cylinder(0.012, 0.022, 0.16, 8), trs(kx - 0.13, top + 0.14, kz, 0, 0, 0.9));
    b.add('woodDark', new THREE.TorusGeometry(0.08, 0.012, 6, 14, Math.PI), trs(kx + 0.03, top + 0.23, kz, 0, 0, -0.3));
    b.add('woodDark', cylinder(0.14, 0.12, 0.02, 20), trs(14.0, top + 0.01, 4.02));
    b.add('brass', cylinder(0.015, 0.015, 0.12, 8), trs(14.0, top + 0.07, 4.02));
    b.add('ceramicWhite', cylinder(0.16, 0.16, 0.012, 22), trs(14.0, top + 0.135, 4.02));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      b.add('cake', new THREE.SphereGeometry(0.035, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), trs(14.0 + Math.cos(a) * 0.08, top + 0.14, 4.02 + Math.sin(a) * 0.08));
    }
    b.add('glassDome', new THREE.SphereGeometry(0.17, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), trs(14.0, top + 0.14, 4.02));
    b.add('brass', new THREE.SphereGeometry(0.018, 8, 6), trs(14.0, top + 0.32, 4.02));
    for (let i = 0; i < 3; i++) {
      const jx = 12.7 + i * 0.22;
      b.add('glass', cylinder(0.06, 0.06, 0.18, 14), trs(jx, top + 0.09, 4.05));
      b.add('cake', cylinder(0.052, 0.052, 0.1, 12), trs(jx, top + 0.06, 4.05), [0xc89a5a, 0x7a4a2a, 0xe0c080][i]);
      b.add('brass', cylinder(0.063, 0.063, 0.025, 14), trs(jx, top + 0.19, 4.05));
    }
    for (let i = 0; i < 4; i++) {
      const ux = 14.55 + i * 0.2;
      b.add('ceramicWhite', cylinder(0.065, 0.05, 0.012, 16), trs(ux, top + 0.006, 3.95));
      b.add('ceramicWhite', cylinder(0.04, 0.032, 0.07, 14), trs(ux, top + 0.045, 3.95));
    }
    b.RB('woodDark', 0.36, 0.04, 0.24, 0.01, 13.4, top + 0.02, 3.95);
    // 壁の棚（2 段・真鍮の腕木）とカップ・瓶・本・小さな鉢
    for (const y of [1.52, 1.94]) {
      b.RB('wood', cx1 - cx0 - 0.3, 0.035, 0.26, 0.01, ccx, y, z1 - 0.13);
      for (const x of [cx0 + 0.3, ccx, cx1 - 0.3]) {
        b.add('brass', box(0.018, 0.018, 0.22), trs(x, y - 0.03, z1 - 0.12));
        b.add('brass', box(0.018, 0.16, 0.018), trs(x, y - 0.1, z1 - 0.03, -0.75, 0, 0));
      }
    }
    for (let i = 0; i < 9; i++) {
      const ux = cx0 + 0.35 + i * 0.22;
      b.add('ceramicWhite', cylinder(0.045, 0.036, 0.085, 14), trs(ux, 1.52 + 0.06, z1 - 0.13));
      b.add('ceramicWhite', new THREE.TorusGeometry(0.022, 0.007, 6, 10), trs(ux + 0.05, 1.52 + 0.065, z1 - 0.13));
    }
    for (let i = 0; i < 4; i++) {
      const jx = cx0 + 0.4 + i * 0.28;
      b.add('glass', cylinder(0.05, 0.05, 0.2, 12), trs(jx, 1.94 + 0.12, z1 - 0.13));
      b.add('cake', cylinder(0.044, 0.044, 0.12, 10), trs(jx, 1.94 + 0.08, z1 - 0.13), [0x9a6a3a, 0xd8b070, 0x6a8a4a, 0xb05a3a][i]);
      b.add('brass', cylinder(0.052, 0.052, 0.02, 12), trs(jx, 1.94 + 0.225, z1 - 0.13));
    }
    books(b, R, z1 - 0.14, [1.94 + 0.018], cx0 + 1.6, cx0 + 2.4, 'x', 0.18);
    b.add('ceramic', cylinder(0.08, 0.06, 0.12, 14), trs(cx1 - 0.55, 1.94 + 0.08, z1 - 0.13));
    b.foliage(R, cx1 - 0.55, 1.94 + 0.14, z1 - 0.13, 0.2, 16);
    b.ivy(R, cx1 - 0.55, 1.94 + 0.05, z1 - 0.15, 0.6, 26);
    b.coll(cx0 - 0.02, cx1 + 0.02, cz0 - 0.08, z1, { y1: 1.05, occlude: true, name: 'lounge:counter' });
  }

  // ================= 前の壁際：低い棚・本棚・天球儀 =================
  {
    // 低い棚（右舷側の角、窓の手前）
    const sx0 = x0;
    const sx1 = x0 + 0.45;
    const sz0 = 0.08;
    const sz1 = 1.55;
    b.B('woodDark', sx0, sx1, 0.06, 0.82, sz0, sz1);
    for (let i = 0; i < 3; i++) {
      const z0b = sz0 + 0.05 + ((sz1 - sz0 - 0.1) * i) / 3 + 0.02;
      const z1b = sz0 + 0.05 + ((sz1 - sz0 - 0.1) * (i + 1)) / 3 - 0.02;
      b.B('wainscot', sx1, sx1 + 0.015, 0.14, 0.74, z0b, z1b);
      b.add('brass', new THREE.SphereGeometry(0.014, 8, 6), trs(sx1 + 0.025, 0.66, (z0b + z1b) / 2));
    }
    b.RB('wood', sx1 - sx0 + 0.06, 0.04, sz1 - sz0 + 0.06, 0.012, (sx0 + sx1) / 2 + 0.02, 0.84, (sz0 + sz1) / 2);
    books(b, R, x0 + 0.2, [0.86], 0.6, 1.1, 'z', 0.2);
    // 天球儀（真鍮）
    const gx = x0 + 0.24;
    const gz = 0.32;
    b.add('woodDark', cylinder(0.08, 0.1, 0.04, 14), trs(gx, 0.88, gz));
    b.add('brass', cylinder(0.01, 0.01, 0.16, 6), trs(gx, 0.98, gz));
    for (const [rx, ry] of [[0, 0], [Math.PI / 2, 0], [Math.PI / 2, Math.PI / 2], [0.4, 0.8]]) b.add('brass', new THREE.TorusGeometry(0.13, 0.006, 6, 28), trs(gx, 1.18, gz, rx, ry, 0));
    b.add('glass', new THREE.SphereGeometry(0.045, 12, 8), trs(gx, 1.18, gz), 0x6fa8a0);
    b.coll(sx0, sx1 + 0.04, sz0, sz1, { y1: 1.35, occlude: true, name: 'lounge:sideboard' });
    // 背の高い本棚（前の壁の中央）
    const bz0 = 1.75;
    const bz1 = 2.95;
    const bh = 2.05;
    b.B('woodDark', x0, x0 + 0.03, 0, bh, bz0, bz1);
    for (const z of [bz0, bz1 - 0.03]) b.B('woodDark', x0, x0 + 0.36, 0, bh, z, z + 0.03);
    for (const y of [0.05, 0.5, 0.95, 1.4, bh - 0.04]) b.B('woodDark', x0, x0 + 0.36, y, y + 0.03, bz0 + 0.03, bz1 - 0.03);
    books(b, R, x0 + 0.17, [0.08, 0.53, 0.98], bz0 + 0.05, bz1 - 0.08, 'z', 0.22);
    b.add('ceramic', cylinder(0.08, 0.06, 0.12, 14), trs(x0 + 0.18, 1.49, bz0 + 0.3));
    b.foliage(R, x0 + 0.18, 1.55, bz0 + 0.3, 0.18, 14);
    b.ivy(R, x0 + 0.18, 1.52, bz0 + 0.3, 0.5, 18);
    b.add('glass', new THREE.SphereGeometry(0.06, 12, 8), trs(x0 + 0.18, 1.49, bz1 - 0.3), 0x8fb4a8);
    b.coll(x0, x0 + 0.38, bz0, bz1, { y1: bh, occlude: true, name: 'lounge:bookcase' });
    // 額の絵（本棚の上の壁）と葉の紋章のバナー
    const pl = new THREE.PlaneGeometry(0.9, 0.6);
    pl.rotateY(Math.PI / 2);
    b.add('paintL', pl, trs(x0 + 0.012, 2.6, 1.2));
    for (const [dy, dz, wz, hy] of [[0.32, 0, 1.0, 0.05], [-0.32, 0, 1.0, 0.05], [0, 0.475, 0.05, 0.6], [0, -0.475, 0.05, 0.6]]) b.add('wood', box(0.03, hy, wz), trs(x0 + 0.015, 2.6 + dy, 1.2 + dz));
  }
  // 右舷の窓の間の紋章バナー
  for (const x of [13.3, 16.8]) {
    const g = new THREE.PlaneGeometry(0.42, 0.62);
    b.add('banner', g, trs(x, 1.35, 0.025));
    b.add('brass', rodX(0.5, 0.008), trs(x, 1.68, 0.03));
  }

  // ================= 植物・フロアランプ =================
  const bigPlant = (x, z, s = 1) => {
    b.add('ceramic', cylinder(0.17 * s, 0.13 * s, 0.32 * s, 18), trs(x, 0.16 * s, z), 0xe9e1cf);
    b.add('brass', new THREE.TorusGeometry(0.17 * s, 0.01, 6, 20), trs(x, 0.3 * s, z, Math.PI / 2, 0, 0));
    b.foliage(R, x, 0.31 * s, z, 0.62 * s, 34);
    b.coll(x - 0.2 * s, x + 0.2 * s, z - 0.2 * s, z + 0.2 * s, { y1: 1.2, name: 'lounge:plant' });
  };
  bigPlant(20.8, 0.32);
  bigPlant(17.0, 3.95, 0.9);
  bigPlant(11.85, 3.98, 0.8);
  {
    const fx = 20.75;
    const fz = 3.95;
    b.add('brass', cylinder(0.14, 0.16, 0.03, 18), trs(fx, 0.015, fz));
    b.add('brass', cylinder(0.012, 0.012, 1.45, 8), trs(fx, 0.75, fz));
    b.add('shade', cylinder(0.12, 0.2, 0.24, 20, true), trs(fx, 1.52, fz));
    b.add('glow', new THREE.SphereGeometry(0.05, 10, 8), trs(fx, 1.45, fz));
    b.coll(fx - 0.18, fx + 0.18, fz - 0.18, fz + 0.18, { y1: 1.7, name: 'lounge:floor-lamp' });
  }
  // 壁の上の蔦（角）
  b.ivy(R, x0 + 0.1, T - 0.05, 0.12, 0.9, 30);
  b.ivy(R, x1 - 0.12, T - 0.05, z1 - 0.12, 0.8, 26);
  b.ivy(R, x1 - 0.12, T - 0.05, 0.12, 0.7, 22);

  // ================= 廊下側（前の壁の廊下面）のプレート =================
  return {
    lights: [new THREE.Vector3(12.65, 2.35, ZC), new THREE.Vector3(14.15, 2.35, ZC), new THREE.Vector3(18.95, 2.3, ZC), new THREE.Vector3(14.6, 2.0, 3.85)],
    windows: [
      ...W.starboard.map((w) => ({ x0: w.x0, x1: w.x1, y0: W.y0, y1: W.y1, z: 0, maxDepth: z1 - 0.1 })),
    ],
  };
}

/** 側壁（窓の穴・枠・窓台・カーテン） side: -1 = 右舷 z=0（内面 z0）, +1 = 左舷（内面 z1） */
function sideWall(b, zi, side, wins) {
  const W = LOUNGE_WINDOWS;
  const { x0, x1 } = LOUNGE;
  const zo = zi + side * WALL;
  const za = Math.min(zi, zo);
  const zb = Math.max(zi, zo);
  b.B('plaster', x0, x1, 0, W.y0, za, zb);
  b.B('plaster', x0, x1, W.y1, T + 0.1, za, zb);
  let px = x0;
  for (const w of wins) {
    b.B('plaster', px, w.x0, W.y0, W.y1, za, zb);
    px = w.x1;
  }
  b.B('plaster', px, x1, W.y0, W.y1, za, zb);
  b.finish('z', zi, -side, x0, x1, { h: T });
  const wh = W.y1 - W.y0;
  const wy = (W.y0 + W.y1) / 2;
  for (const w of wins) {
    const ww = w.x1 - w.x0;
    const wx = (w.x0 + w.x1) / 2;
    const ry = side < 0 ? 0 : Math.PI;
    b.add('wood', b.ring(ww + 0.3, wh + 0.3, 0.22, ww, wh, 0.14, 0.06), trs(wx, wy, zi, 0, ry, 0));
    b.add('brass', b.ring(ww + 0.04, wh + 0.04, 0.16, ww, wh, 0.14, 0.075), trs(wx, wy, zi + side * 0.01, 0, ry, 0));
    b.RB('wood', ww + 0.36, 0.05, 0.2, 0.015, wx, W.y0 - 0.02, zi - side * 0.06);
    // 深緑のカーテン（両脇）
    for (const s of [-1, 1]) {
      const g = b.curtain(0.42, W.y1 - W.y0 + 0.12, side > 0 ? -s : s, 0.45);
      if (side > 0) g.rotateY(Math.PI);
      b.add('velvet', g, trs(wx + s * (ww / 2 + 0.06), W.y0 - 0.02, zi - side * 0.11));
    }
    b.add('brass', rodX(ww + 0.6, 0.012), trs(wx, W.y1 + 0.1, zi - side * 0.12));
  }
  b.coll(x0 - 0.3, x1 + 0.3, side < 0 ? zi - 0.5 : zi, side < 0 ? zi : zi + 0.5, { wall: true, name: side < 0 ? 'lounge:starboard' : 'lounge:port', y1: 3.1 });
}

/** 食堂の椅子（緑の革・木の枠・背に葉の紋章）。yaw = 座った人の正面（0 = -Z） */
function diningChair(b, x, z, yaw) {
  const m = new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, 1, 1));
  const put = (key, geo, lx, ly, lz, rx = 0, color) => {
    const g = geo;
    g.applyMatrix4(trs(lx, ly, lz, rx, 0, 0));
    b.add(key, g, m, color);
  };
  // 脚
  for (const [lx, lz] of [[-0.2, -0.19], [0.2, -0.19], [-0.2, 0.19], [0.2, 0.19]]) put('woodDark', cylinder(0.018, 0.022, 0.44, 8), lx, 0.22, lz);
  put('woodDark', box(0.44, 0.06, 0.44), 0, 0.43, 0);
  put('leatherGreen', b.rbGeo(0.46, 0.07, 0.46, 0.025), 0, 0.49, 0);
  // 背（座った人の背中側 = +Z ローカル）
  for (const lx of [-0.2, 0.2]) put('woodDark', box(0.035, 0.56, 0.035), lx, 0.74, 0.21, -0.08);
  put('leatherGreen', b.rbGeo(0.36, 0.42, 0.05, 0.02), 0, 0.76, 0.215, -0.08);
  put('woodDark', b.rbGeo(0.46, 0.05, 0.05, 0.015), 0, 1.03, 0.235, -0.08);
  put('brass', cylinder(0.035, 0.035, 0.006, 14), 0, 0.82, 0.185, Math.PI / 2 - 0.08);
  b.coll(x - 0.24, x + 0.24, z - 0.24, z + 0.24, { y1: 1.0, name: 'lounge:chair' });
}

/** 窓辺のアームチェア */
function armchair(b, x, z, yaw) {
  const m = new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, 1, 1));
  const put = (key, geo, lx, ly, lz, rx = 0, color) => {
    geo.applyMatrix4(trs(lx, ly, lz, rx, 0, 0));
    b.add(key, geo, m, color);
  };
  for (const [lx, lz] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) put('woodDark', cylinder(0.025, 0.02, 0.1, 8), lx, 0.05, lz);
  put('velvet', b.rbGeo(0.78, 0.28, 0.76, 0.06), 0, 0.24, 0);
  put('velvet', b.rbGeo(0.6, 0.12, 0.6, 0.05), 0, 0.43, -0.04);
  put('velvet', b.rbGeo(0.76, 0.62, 0.18, 0.08), 0, 0.68, 0.3, -0.12);
  for (const lx of [-0.34, 0.34]) put('velvet', b.rbGeo(0.12, 0.4, 0.74, 0.05), lx, 0.5, 0);
  put('cushion', b.rbGeo(0.36, 0.34, 0.1, 0.05), 0, 0.68, 0.17, -0.2);
  b.coll(x - 0.4, x + 0.4, z - 0.4, z + 0.4, { y1: 1.0, name: 'lounge:armchair' });
}

export { CORRIDOR };
