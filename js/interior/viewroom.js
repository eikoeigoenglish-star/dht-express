/**
 * interior/viewroom.js — 【v16】列車の View Room（Upper Deck の前面展望室）・先頭側の横通路・Lower Deck への階段
 * ---------------------------------------------------------------------------
 * 見取り図（After）どおり、既存の Room 1 よりさらに先頭側（-X）に追加する。
 *   ・主役は前方の景色：大きな前面展望窓（x = -13.3）と左右の窓。家具は前向きのソファー 1・アームチェア 2・小卓 1・棚 1 だけ
 *   ・運転席は置かない（運転席はこの下の Lower Deck にある設定。Upper Deck の View Room は乗客用の展望室）
 *   ・後ろの左舷の角に Lower Deck へ降りる階段（廊下の突き当たりから -X へ降りる）。1 段目の上にチェーンと CREW ONLY の札
 *   ・後ろの右舷の角（見取り図の右上の四角）は造り付けの飾り棚
 * 区画：View Room の内装 = 'viewroom'、横通路と階段 = 'corridor'、両側から見える後ろの壁 = 'shell'
 */
import * as THREE from 'three';
import { box, cylinder, rodX, rodZ, trs, rng } from './kit.js';
import { H, WALL, VIEW, STAIR, CROSS, COMP, CORRIDOR, DOOR } from './layout.js';
import { books, vaseWithFlowers, lantern } from './compartment.js';
import { armchair } from './lounge.js';
import { sofa, bigPlant, roundTable, sconce, ceilingLamp, stairWell } from './furniture.js';

const ZC = (VIEW.z0 + VIEW.z1) / 2;

/**
 * @param {import('./builder.js').Builder} b
 * @returns {{ lights: THREE.Vector3[], windows: object[], plates: THREE.Object3D[], stair: object }}
 */
export function buildViewRoom(b) {
  const R = rng(1601);
  const { x0, x1, z0, z1, win } = VIEW;
  const xr = VIEW.rearWall; // -8.0
  const D = VIEW.door;
  const plates = [];

  /* ================= 横通路（Room 1 の前の壁と View Room の後ろの壁の間） ================= */
  b.section('corridor');
  {
    const { x0: c0, x1: c1 } = CROSS;
    b.B('floor', c0, c1, -0.06, 0, 0, CORRIDOR.z0);
    b.B('plaster', c0, c1, H, H + 0.1, -WALL, CORRIDOR.z0);
    for (let x = c0 + 0.4; x < c1; x += 0.7) b.B('wood', x - 0.03, x + 0.03, H - 0.05, H, 0, CORRIDOR.z0);
    // 右舷の外壁（小さな窓 1 つ）
    const wx0 = -7.62;
    const wx1 = -6.92;
    const wy0 = 0.95;
    const wy1 = 2.05;
    b.B('plaster', c0, c1, 0, wy0, -WALL, 0);
    b.B('plaster', c0, c1, wy1, H, -WALL, 0);
    b.B('plaster', c0, wx0, wy0, wy1, -WALL, 0);
    b.B('plaster', wx1, c1, wy0, wy1, -WALL, 0);
    b.finish('z', 0, 1, c0, c1);
    b.add('wood', b.ring(wx1 - wx0 + 0.2, wy1 - wy0 + 0.2, 0.14, wx1 - wx0, wy1 - wy0, 0.09, 0.05), trs((wx0 + wx1) / 2, (wy0 + wy1) / 2, 0));
    b.coll(c0 - 0.2, c1 + 0.2, -0.5, 0, { wall: true, name: 'cross:outer' });
    // Room 1 の前の仕切り壁の横通路側の面（v15 までは見えなかった面）
    b.finish('x', c1, -1, 0, COMP.depth);
    // ランナー（廊下の続き）
    const rl = CORRIDOR.z0 - 0.3;
    const run = new THREE.PlaneGeometry(rl, 0.66);
    run.rotateX(-Math.PI / 2);
    const ru = run.attributes.uv;
    for (let i = 0; i < ru.count; i++) ru.setX(i, ru.getX(i) * rl);
    b.add('runner', run, trs((c0 + c1) / 2, 0.004, rl / 2 + 0.15, 0, Math.PI / 2, 0));
    sconce(b, c1 - 0.01, 1.72, 0.55, -1, 0);
    sconce(b, c1 - 0.01, 1.72, 2.55, -1, 0);
    // 先頭の床（階段の降り口まで）：廊下の床は x = -8.0 から
  }

  /* ================= 後ろの壁（View Room ⇔ 横通路・階段の降り口）。両側から見えるので shell ================= */
  b.section('shell');
  {
    const w0 = x1; // -8.12
    const w1 = xr; // -8.0
    b.B('plaster', w0, w1, 0, H, z0 - WALL, D.z0);
    b.B('plaster', w0, w1, D.h, H, D.z0, D.z1);
    b.B('plaster', w0, w1, 0, H, D.z1, STAIR.z0);
    b.B('plaster', w0, w1, D.h, H, STAIR.z0, z1 + WALL); // 階段の降り口の上（まぐさ）
    // アーチの枠（両面）と敷居
    for (const xf of [w0 - 0.035, w1]) {
      b.B('wood', xf, xf + 0.035, 0, D.h + 0.08, D.z0 - 0.08, D.z0);
      b.B('wood', xf, xf + 0.035, 0, D.h + 0.08, D.z1, D.z1 + 0.08);
      b.B('wood', xf, xf + 0.035, D.h, D.h + 0.08, D.z0 - 0.08, D.z1 + 0.08);
      b.B('brass', xf - 0.003, xf + 0.038, D.h + 0.02, D.h + 0.035, D.z0, D.z1);
      b.B('wood', xf, xf + 0.035, D.h - 0.04, D.h + 0.08, STAIR.z0, z1); // 降り口の上の見切り
    }
    b.B('brass', w0 - 0.02, w1 + 0.02, -0.03, 0.006, D.z0, D.z1);
    b.B('floor', w0 - 0.02, w1 + 0.02, -0.06, 0, D.z0, D.z1);
    b.B('floor', w0 - 0.02, w1 + 0.02, -0.06, 0, z0, D.z0); // 壁の足元（両側の床の継ぎ目）
    b.coll(w0 - 0.02, w1 + 0.02, z0 - 0.4, D.z0, { wall: true, name: 'view:rear-a' });
    b.coll(w0 - 0.02, w1 + 0.02, D.z1, STAIR.z0, { wall: true, name: 'view:rear-b' });
  }
  // 横通路側の仕上げとプレート
  b.section('corridor');
  b.finish('x', xr, 1, z0, D.z0);
  b.finish('x', xr, 1, D.z1, STAIR.z0 - 0.1);
  {
    const p = b.plate('View Room', 0.5, 0.15);
    p.position.set(xr + 0.04, D.h + 0.22, (D.z0 + D.z1) / 2);
    p.rotation.y = Math.PI / 2;
    plates.push(p);
    const p2 = b.plate('UPPER DECK', 0.34, 0.1);
    p2.position.set(xr + 0.04, 1.55, D.z0 - 0.42);
    p2.rotation.y = Math.PI / 2;
    plates.push(p2);
  }

  /* ================= Lower Deck への階段（廊下の突き当たりから -X へ降りる） ================= */
  const stair = stairWell(b, STAIR.x1, (STAIR.z0 + STAIR.z1) / 2, '-x', { width: STAIR.z1 - STAIR.z0, run: STAIR.run, rise: STAIR.rise, steps: STAIR.steps, chainU: STAIR.x1 - STAIR.chainX, name: 'lower-deck-stair' });
  plates.push(stair.plate);
  // 降り口の脇の小さな立入禁止プレート（壁）
  {
    const p = b.plate('関係者以外立入禁止', 0.34, 0.09);
    p.position.set(xr + 0.04, 1.3, STAIR.z0 - 0.24);
    p.rotation.y = Math.PI / 2;
    plates.push(p);
  }

  /* ================= View Room 本体 ================= */
  b.section('viewroom');
  // ---- 床（階段の穴を除く）・絨毯・天井 ----
  b.B('floor', x0 - 0.02, STAIR.x0, -0.06, 0, z0, z1);
  b.B('floor', STAIR.x0, x1, -0.06, 0, z0, STAIR.z0 - 0.1);
  const rug = new THREE.PlaneGeometry(3.1, 2.5);
  rug.rotateX(-Math.PI / 2);
  b.add('carpet', rug, trs(-11.4, 0.004, 2.0));
  b.B('plaster', x0 - WALL, x1, H, H + 0.1, z0 - WALL, z1 + WALL);
  for (let x = x0 + 0.5; x < x1; x += 0.8) b.B('wood', x - 0.035, x + 0.035, H - 0.06, H, z0, z1);
  b.B('wood', x0, x1, H - 0.06, H, ZC - 0.1, ZC + 0.1);
  for (const dz of [-0.11, 0.11]) b.B('brass', x0, x1, H - 0.05, H - 0.035, ZC + dz - 0.008, ZC + dz + 0.008);

  // ---- 前面展望窓（x = -13.3）。窓台は低く、ガラスは天井近くまで ----
  const fy0 = 0.6;
  const fy1 = 2.42;
  const fz0 = z0 + 0.22;
  const fz1 = z1 - 0.22;
  {
    const xa = x0 - WALL;
    b.B('plaster', xa, x0, 0, fy0, z0 - WALL, z1 + WALL);
    b.B('plaster', xa, x0, fy1, H, z0 - WALL, z1 + WALL);
    b.B('plaster', xa, x0, fy0, fy1, z0 - WALL, fz0);
    b.B('plaster', xa, x0, fy0, fy1, fz1, z1 + WALL);
    // 窓台が低いので、腰壁は窓台の下まで（b.finish の腰壁 0.9 m では窓の下が隠れる）
    b.B('wainscot', x0, x0 + 0.018, 0.1, fy0 - 0.04, z0, z1);
    b.B('woodDark', x0, x0 + 0.025, 0, 0.11, z0, z1);
    b.B('wood', x0, x0 + 0.06, H - 0.12, H, z0, z1);
    b.B('wood', x0, x0 + 0.03, H - 0.16, H - 0.12, z0, z1);
    const ww = fz1 - fz0;
    const wh = fy1 - fy0;
    const wy = (fy0 + fy1) / 2;
    b.add('wood', b.ring(ww + 0.3, wh + 0.26, 0.24, ww, wh, 0.14, 0.07), trs(x0, wy, ZC, 0, Math.PI / 2, 0));
    b.add('brass', b.ring(ww + 0.05, wh + 0.05, 0.16, ww, wh, 0.14, 0.085), trs(x0 - 0.01, wy, ZC, 0, Math.PI / 2, 0));
    // 細い縦の桟 2 本（景色を邪魔しない）
    for (const z of [fz0 + ww / 3, fz0 + (2 * ww) / 3]) {
      b.B('wood', x0 - 0.04, x0 + 0.03, fy0, fy1, z - 0.035, z + 0.035);
      b.B('brass', x0 + 0.03, x0 + 0.04, fy0, fy1, z - 0.01, z + 0.01);
    }
    // 窓台（低い木の棚）と真鍮の手すり
    b.RB('wood', 0.3, 0.05, ww + 0.4, 0.015, x0 + 0.13, fy0 - 0.02, ZC);
    b.add('brass', rodZ(ww - 0.2, 0.02), trs(x0 + 0.24, 0.9, ZC));
    for (const z of [fz0 + 0.2, ZC, fz1 - 0.2]) {
      b.add('brass', box(0.12, 0.018, 0.018), trs(x0 + 0.18, 0.9, z));
      b.add('brass', cylinder(0.014, 0.014, 0.3, 8), trs(x0 + 0.24, 0.75, z));
    }
    // 上の深緑のバランス（葉の紋章）
    b.RB('velvet', 0.08, 0.16, ww + 0.4, 0.02, x0 + 0.12, fy1 + 0.1, ZC);
    const em = new THREE.PlaneGeometry(0.18, 0.18);
    em.rotateY(Math.PI / 2);
    b.add('emblem', em, trs(x0 + 0.165, fy1 + 0.1, ZC));
    b.coll(x0 - 0.5, x0 + 0.02, z0 - 0.4, z1 + 0.4, { wall: true, name: 'view:front', y1: 3.1 });
    // 窓の手前（手すりまで）は葉っぱが行ける。手すりの下の窓台だけ当たる
    b.coll(x0, x0 + 0.16, z0, z1, { y1: 0.62, name: 'view:sill' });
  }

  // ---- 左右の窓（右舷は長く、左舷は階段の手前まで） ----
  sidePanorama(b, 0, -1, VIEW.winS, win, x0, x1);
  sidePanorama(b, z1, 1, VIEW.winP, win, x0, x1);

  // ---- 階段の囲い（View Room 側は腰の高さの木の手すり壁。上から階段を見下ろせる） ----
  {
    const pz0 = STAIR.z0 - 0.1;
    const pz1 = STAIR.z0;
    const top = 1.0;
    b.B('wainscot', STAIR.x0, x1, 0, top, pz0, pz1);
    b.B('wood', STAIR.x0 - 0.02, x1, top, top + 0.05, pz0 - 0.03, pz1 + 0.03);
    b.add('brass', rodX(x1 - STAIR.x0, 0.016), trs((STAIR.x0 + x1) / 2, top + 0.07, (pz0 + pz1) / 2));
    b.B('woodDark', STAIR.x0, x1, 0, 0.1, pz0 - 0.015, pz0);
    // 先頭側の端（階段の先の手すり壁）
    b.B('wainscot', STAIR.x0 - 0.12, STAIR.x0, 0, top, pz0, z1);
    b.B('wood', STAIR.x0 - 0.14, STAIR.x0 + 0.02, top, top + 0.05, pz0 - 0.03, z1);
    b.add('brass', rodZ(z1 - pz0, 0.016), trs(STAIR.x0 - 0.06, top + 0.07, (pz0 + z1) / 2));
    b.coll(STAIR.x0, x1, pz0 - 0.02, pz1 + 0.02, { y1: top + 0.1, name: 'view:stair-rail' });
    b.coll(STAIR.x0 - 0.14, STAIR.x0 + 0.02, pz0, z1, { y1: top + 0.1, name: 'view:stair-rail-front' });
  }

  // ---- 後ろの右舷の角：造り付けの飾り棚（見取り図の右上の四角） ----
  {
    const C = VIEW.cabinet;
    const cx0 = C.x0;
    const cx1 = x1;
    const cz0 = C.z0;
    const cz1 = C.z1;
    const h = 2.05;
    b.B('woodDark', cx0, cx0 + 0.04, 0, h, cz0, cz1);
    b.B('woodDark', cx0, cx1, 0, h, cz1 - 0.04, cz1);
    b.B('woodDark', cx0, cx1, h - 0.05, h, cz0, cz1);
    for (const y of [0.05, 0.85, 1.35]) b.B('woodDark', cx0 + 0.04, cx1, y, y + 0.035, cz0, cz1 - 0.04);
    // 下段は扉（緑の鏡板）
    b.B('woodDark', cx0 - 0.005, cx0 + 0.04, 0.08, 0.84, cz0 + 0.02, cz1 - 0.06);
    b.B('wainscot', cx0 - 0.015, cx0, 0.16, 0.76, cz0 + 0.08, cz1 - 0.12);
    b.add('brass', new THREE.SphereGeometry(0.014, 8, 6), trs(cx0 - 0.02, 0.6, cz1 - 0.2));
    books(b, R, cx0 + 0.45, [0.885], cz0 + 0.08, cz1 - 0.12, 'z', 0.22);
    // 中段：真鍮の望遠鏡と地球儀
    b.add('brass', cylinder(0.03, 0.045, 0.42, 14), trs(-8.6, 1.52, 0.42, 0, 0, 1.2));
    b.add('woodDark', cylinder(0.008, 0.008, 0.16, 6), trs(-8.62, 1.45, 0.42));
    b.add('glass', new THREE.SphereGeometry(0.1, 16, 10), trs(-8.42, 1.5, 0.7), 0x6fa8a0);
    b.add('brass', new THREE.TorusGeometry(0.11, 0.006, 6, 24), trs(-8.42, 1.5, 0.7, 0.4, 0.8, 0));
    b.add('woodDark', cylinder(0.05, 0.07, 0.04, 12), trs(-8.42, 1.4, 0.7));
    // 上：鉢植え（蔦が垂れる）
    b.add('ceramic', cylinder(0.11, 0.08, 0.16, 16), trs(-8.55, h + 0.08, 0.45));
    b.foliage(R, -8.55, h + 0.16, 0.45, 0.24, 22);
    b.ivy(R, -8.98, h, 0.3, 0.6, 22);
    b.coll(cx0 - 0.02, cx1, cz0, cz1, { y1: h, occlude: true, name: 'view:cabinet' });
  }

  // ---- 家具（主役は景色。前向きのソファー・アームチェア 2・小卓だけ） ----
  sofa(b, -10.6, 1.95, Math.PI / 2, 1.9, { name: 'view:sofa' });
  armchair(b, -12.35, 0.78, Math.PI / 2 - 0.3);
  armchair(b, -12.35, 3.5, Math.PI / 2 + 0.3);
  roundTable(b, -10.6, 3.25, 0.2, 0.55, 'view:side-table');
  lantern(b, -10.66, 0.55, 3.22, 0.9);
  vaseWithFlowers(b, R, -10.52, 0.55, 3.3, 0.028, 6);
  bigPlant(b, R, -9.55, 0.4, 0.85, 'view:plant');

  // ---- 照明 ----
  ceilingLamp(b, -12.1, H - 0.06, ZC);
  ceilingLamp(b, -9.9, H - 0.06, 1.55);
  ceilingLamp(b, -9.1, H - 0.06, 3.7, 0.12);
  sconce(b, x1 - 0.01, 1.78, 2.82, -1, 0);
  // 前面の蔦（窓の両端の上から）
  b.ivy(R, x0 + 0.12, H - 0.15, 0.18, 0.7, 24);
  b.ivy(R, x0 + 0.12, H - 0.15, z1 - 0.18, 0.6, 20);

  return {
    lights: [new THREE.Vector3(-12.1, 2.3, ZC), new THREE.Vector3(-10.0, 2.3, 1.6), new THREE.Vector3(-9.0, 2.2, 3.7), new THREE.Vector3(-7.3, 2.3, 1.6)],
    windows: [{ x0: VIEW.winS.x0, x1: VIEW.winS.x1, y0: win.y0, y1: win.y1, z: 0, maxDepth: z1 - 0.1 }],
    plates,
    stair,
  };
}

/** 側壁の大きな窓 1 枚（内面 zi、side：-1 = 右舷、+1 = 左舷）。窓の外のカーテンは両脇に寄せたまま */
function sidePanorama(b, zi, side, w, win, x0, x1) {
  const zo = zi + side * WALL;
  const za = Math.min(zi, zo);
  const zb = Math.max(zi, zo);
  const xa = x0 - WALL;
  b.B('plaster', xa, x1, 0, win.y0, za, zb);
  b.B('plaster', xa, x1, win.y1, H, za, zb);
  b.B('plaster', xa, w.x0, win.y0, win.y1, za, zb);
  b.B('plaster', w.x1, x1, win.y0, win.y1, za, zb);
  b.finish('z', zi, -side, x0, x1);
  const ww = w.x1 - w.x0;
  const wh = win.y1 - win.y0;
  const wx = (w.x0 + w.x1) / 2;
  const wy = (win.y0 + win.y1) / 2;
  const ry = side < 0 ? 0 : Math.PI;
  b.add('wood', b.ring(ww + 0.3, wh + 0.3, 0.22, ww, wh, 0.14, 0.06), trs(wx, wy, zi, 0, ry, 0));
  b.add('brass', b.ring(ww + 0.04, wh + 0.04, 0.16, ww, wh, 0.14, 0.075), trs(wx, wy, zi + side * 0.01, 0, ry, 0));
  b.RB('wood', ww + 0.36, 0.05, 0.2, 0.015, wx, win.y0 - 0.02, zi - side * 0.06);
  // 縦の桟 1 本
  b.B('wood', wx - 0.035, wx + 0.035, win.y0, win.y1, za - 0.02, zb + 0.02);
  for (const s of [-1, 1]) {
    const g = b.curtain(0.4, win.y1 - win.y0 + 0.12, side > 0 ? -s : s, 0.45);
    if (side > 0) g.rotateY(Math.PI);
    b.add('velvet', g, trs(wx + s * (ww / 2 + 0.06), win.y0 - 0.02, zi - side * 0.11));
  }
  b.add('brass', rodX(ww + 0.6, 0.012), trs(wx, win.y1 + 0.1, zi - side * 0.12));
  b.coll(xa - 0.3, x1, side < 0 ? zi - 0.5 : zi, side < 0 ? zi : zi + 0.5, { wall: true, name: side < 0 ? 'view:starboard' : 'view:port', y1: 3.1 });
}

export { DOOR };
