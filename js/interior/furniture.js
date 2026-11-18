/**
 * interior/furniture.js — 【v16】列車・船で共有する家具と階段（View Room・船内で使う）
 * ---------------------------------------------------------------------------
 * 既存の部品（kit.js の roundedBox / cylinder、builder.js の PartBin・当たり判定、compartment.js の本・花瓶・ランタン、
 * lounge.js のアームチェア・食堂の椅子）と同じマテリアル・同じ作り方で、次を追加する。
 *   sofa()        … 深緑のベルベットのソファー（アームチェアと同じ意匠を横へ延ばしたもの）
 *   bench()       … 個室の向かい合わせベンチと同じ寸法・意匠のベンチ（座面 0.5 m。リンさんのひざ掛けがそのまま合う）
 *   bed()         … 木枠・アイボリーのリネン・深緑の掛け布団・真鍮の縁のヘッドボード
 *   wardrobe()    … 収納（観音開きの木のクローゼット）
 *   stairWell()   … 下の階へ降りる階段（井戸・手すり・下の扉）と、途中に張ったチェーン・CREW ONLY の札
 *   bigPlant()    … 大きな鉢植え
 * yaw はアームチェアと同じく「座った人の正面の方位角（0 = -Z、+π/2 = -X）」。
 */
import * as THREE from 'three';
import { box, cylinder, rodX, rodZ, trs, rng } from './kit.js';

const _q = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);

/** (x, z, yaw) の座標系で部品を置く関数を返す */
function framer(b, x, z, yaw, y = 0) {
  const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), _q.setFromAxisAngle(_up, yaw).clone(), new THREE.Vector3(1, 1, 1));
  return (key, geo, lx, ly, lz, rx = 0, ry = 0, rz = 0, color, s = 1) => {
    geo.applyMatrix4(trs(lx, ly, lz, rx, ry, rz, s));
    b.add(key, geo, m, color);
  };
}

/** 回した箱（半幅 hx × 半奥行き hz）を包む軸平行の範囲 */
function aabb(x, z, yaw, hx, hz) {
  const c = Math.abs(Math.cos(yaw));
  const s = Math.abs(Math.sin(yaw));
  const ex = c * hx + s * hz;
  const ez = s * hx + c * hz;
  return [x - ex, x + ex, z - ez, z + ez];
}

/**
 * ソファー（長さ len。背は座った人の後ろ = ローカル +Z）
 * @returns {{ seatTop: number }}
 */
export function sofa(b, x, z, yaw, len = 1.8, { name = 'sofa', block = true } = {}) {
  const put = framer(b, x, z, yaw);
  const hw = len / 2;
  for (const lx of [-hw + 0.08, hw - 0.08]) for (const lz of [-0.3, 0.3]) put('woodDark', cylinder(0.025, 0.02, 0.1, 8), lx, 0.05, lz);
  put('velvet', b.rbGeo(len, 0.28, 0.78, 0.06), 0, 0.24, 0);
  // 座面のクッション（2〜3 枚）
  const n = len > 1.5 ? 3 : 2;
  const cw = (len - 0.26) / n;
  for (let i = 0; i < n; i++) put('velvet', b.rbGeo(cw - 0.02, 0.12, 0.6, 0.05), -hw + 0.13 + cw * (i + 0.5), 0.43, -0.04);
  put('velvet', b.rbGeo(len - 0.02, 0.62, 0.18, 0.08), 0, 0.68, 0.31, -0.12);
  for (const lx of [-hw + 0.06, hw - 0.06]) put('velvet', b.rbGeo(0.12, 0.4, 0.76, 0.05), lx, 0.5, 0);
  // 背の真鍮のボタン・クッション
  for (let i = 0; i < n * 2; i++) put('button', new THREE.SphereGeometry(0.014, 8, 6), -hw + 0.2 + ((len - 0.4) * (i + 0.5)) / (n * 2), 0.78, 0.22);
  put('cushion', b.rbGeo(0.36, 0.34, 0.1, 0.05), -hw + 0.32, 0.68, 0.17, -0.2, 0.15);
  put('cushion', b.rbGeo(0.36, 0.34, 0.1, 0.05), hw - 0.32, 0.68, 0.17, -0.2, -0.15);
  const [a0, a1, c0, c1] = aabb(x, z, yaw, hw, 0.4);
  if (block) b.coll(a0, a1, c0, c1, { y1: 1.0, occlude: true, name });
  return { seatTop: 0.49 };
}

/**
 * 個室のベンチと同じ寸法・意匠のベンチ（座面の高さ 0.5 m・奥行き 0.68 m・背の厚み 0.17 m）。
 * リンさんの座り方（座面の上の腰・ひざ掛け）が列車の Room 1 とそのまま同じになる。
 *   x, z は「背の壁の面の中央」。yaw = 座った人の正面。len = 幅
 */
export function bench(b, x, z, yaw, len = 1.6, { name = 'bench' } = {}) {
  const put = framer(b, x, z, yaw);
  const w = 0.68; // BENCH.x1 - BENCH.x0
  const bz = -w / 2; // 座面の中央（ローカル -Z が正面）
  put('woodDark', b.rbGeo(len - 0.06, 0.36, w - 0.04, 0.02), 0, 0.18, bz);
  put('fabric', b.rbGeo(len - 0.1, 0.16, w, 0.055), 0, 0.42, bz);
  const nb = Math.max(2, Math.round(len / 0.6));
  for (let i = 0; i < nb; i++) {
    const lx = -len / 2 + 0.08 + (len - 0.16) * ((i + 0.5) / nb);
    put('fabric', b.rbGeo((len - 0.2) / nb - 0.02, 0.62, 0.17, 0.065), lx, 0.84, -0.09, 0.07);
    for (const [dy, dx] of [[0.14, 0], [-0.1, -0.12], [-0.1, 0.12]]) put('button', new THREE.SphereGeometry(0.014, 8, 6), lx + dx, 0.84 + dy, -0.175);
  }
  put('wood', b.rbGeo(len, 0.05, 0.2, 0.02), 0, 1.18, -0.1);
  for (const s of [-1, 1]) put('wood', b.rbGeo(0.06, 0.64, w + 0.02, 0.02), s * (len / 2 - 0.03), 0.32, bz);
  for (const s of [-1, 1]) put('cushion', b.rbGeo(0.34, 0.34, 0.1, 0.05), s * (len / 2 - 0.3), 0.66, -0.24, -0.28, s * 0.1);
  const [a0, a1, c0, c1] = aabb(x + Math.sin(yaw) * bz, z + Math.cos(yaw) * bz, yaw, len / 2, w / 2);
  b.coll(a0, a1, c0, c1, { y1: 1.2, occlude: true, name });
  return { seatTop: 0.5, depth: w };
}

/**
 * ベッド（軸平行）。head：ヘッドボードの向き 'x-' | 'x+' | 'z-' | 'z+'
 * @returns {{ top: number, x: number, z: number, footYaw: number }} top = 掛け布団の上面
 */
export function bed(b, x0, x1, z0, z1, head, { name = 'bed', duvet = 0xffffff, seed = 1 } = {}) {
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const alongX = head[0] === 'x';
  const sgn = head[1] === '-' ? -1 : 1; // ヘッドボードの側
  const L = alongX ? x1 - x0 : z1 - z0; // 長さ
  const Wd = alongX ? z1 - z0 : x1 - x0; // 幅
  // ローカル：u = 足 → 頭（+）、v = 幅。yaw でワールドへ
  const yaw = alongX ? (sgn > 0 ? Math.PI / 2 : -Math.PI / 2) : sgn > 0 ? 0 : Math.PI;
  // ローカル -Z（yaw の正面）= 足の方向。頭 = ローカル +Z
  const put = framer(b, cx, cz, yaw);
  const hl = L / 2;
  const hwd = Wd / 2;
  for (const lu of [-hl + 0.06, hl - 0.06]) for (const lv of [-hwd + 0.06, hwd - 0.06]) put('woodDark', cylinder(0.03, 0.025, 0.14, 8), lv, 0.07, lu);
  put('woodDark', b.rbGeo(Wd, 0.16, L, 0.02), 0, 0.22, 0);
  put('linen', b.rbGeo(Wd - 0.06, 0.18, L - 0.08, 0.06), 0, 0.39, 0.0);
  // 掛け布団（足元 2/3、両脇へ少し垂らす）
  const dl = (L - 0.08) * 0.66;
  put('quilt', b.rbGeo(Wd + 0.02, 0.07, dl, 0.035), 0, 0.485, -hl + 0.04 + dl / 2, 0, 0, 0, duvet);
  put('quilt', b.rbGeo(Wd + 0.04, 0.22, 0.04, 0.015), 0, 0.4, -hl + 0.03, 0, 0, 0, duvet);
  for (const s of [-1, 1]) put('quilt', b.rbGeo(0.03, 0.2, dl, 0.012), s * (hwd + 0.01), 0.41, -hl + 0.04 + dl / 2, 0, 0, 0, duvet);
  // 折り返し（アイボリー）
  put('linen', b.rbGeo(Wd + 0.025, 0.075, 0.16, 0.03), 0, 0.49, -hl + 0.04 + dl + 0.06);
  // 枕
  put('linen', b.rbGeo(Math.min(0.62, Wd - 0.18), 0.12, 0.34, 0.06), 0, 0.53, hl - 0.24, -0.25);
  // ヘッドボード（木 + 真鍮の縁 + 深緑の張り地）
  put('woodDark', b.rbGeo(Wd + 0.08, 1.0, 0.07, 0.02), 0, 0.5, hl + 0.035);
  put('leatherGreen', b.rbGeo(Wd - 0.12, 0.42, 0.03, 0.02), 0, 0.72, hl - 0.005);
  put('brass', b.rbGeo(Wd + 0.1, 0.025, 0.09, 0.008), 0, 1.0, hl + 0.035);
  b.coll(x0 - 0.02, x1 + 0.02, z0 - 0.02, z1 + 0.02, { y1: 0.62, occlude: false, name });
  const R = rng(seed);
  void R;
  return { top: 0.52, x: cx, z: cz, yaw, length: L, width: Wd };
}

/** 収納（観音開きのクローゼット）。軸平行。front：扉の向き 'x-' | 'x+' | 'z-' | 'z+' */
export function wardrobe(b, x0, x1, z0, z1, front, h = 2.0, name = 'wardrobe') {
  b.B('woodDark', x0, x1, 0.06, h, z0, z1);
  b.B('woodDark', x0 + 0.02, x1 - 0.02, 0, 0.06, z0 + 0.02, z1 - 0.02, 0x4a2a17);
  const alongX = front[0] === 'z';
  const sgn = front[1] === '-' ? -1 : 1;
  const face = alongX ? (sgn < 0 ? z0 : z1) : sgn < 0 ? x0 : x1;
  const a0 = alongX ? x0 : z0;
  const a1 = alongX ? x1 : z1;
  const mid = (a0 + a1) / 2;
  const panel = (p0, p1, y0, y1, key, t) => {
    if (alongX) b.B(key, p0, p1, y0, y1, sgn < 0 ? face - t : face, sgn < 0 ? face : face + t);
    else b.B(key, sgn < 0 ? face - t : face, sgn < 0 ? face : face + t, y0, y1, p0, p1);
  };
  for (const [p0, p1] of [[a0 + 0.05, mid - 0.01], [mid + 0.01, a1 - 0.05]]) {
    panel(p0 + 0.05, p1 - 0.05, 1.1, h - 0.15, 'wainscot', 0.012);
    panel(p0 + 0.05, p1 - 0.05, 0.2, 0.95, 'wainscot', 0.012);
  }
  for (const s of [-1, 1]) {
    const p = mid + s * 0.05;
    if (alongX) b.add('brass', box(0.02, 0.22, 0.03), trs(p, 1.05, face + sgn * 0.025));
    else b.add('brass', box(0.03, 0.22, 0.02), trs(face + sgn * 0.025, 1.05, p));
  }
  b.coll(x0, x1, z0, z1, { y1: h, occlude: true, name });
}

/** 大きな鉢植え（ラウンジと同じ） */
export function bigPlant(b, R, x, z, s = 1, name = 'plant') {
  b.add('ceramic', cylinder(0.17 * s, 0.13 * s, 0.32 * s, 18), trs(x, 0.16 * s, z), 0xe9e1cf);
  b.add('brass', new THREE.TorusGeometry(0.17 * s, 0.01, 6, 20), trs(x, 0.3 * s, z, Math.PI / 2, 0, 0));
  b.foliage(R, x, 0.31 * s, z, 0.62 * s, 34);
  b.coll(x - 0.2 * s, x + 0.2 * s, z - 0.2 * s, z + 0.2 * s, { y1: 1.2, name });
}

/** 小さな丸テーブル（ラウンジと同じ意匠） */
export function roundTable(b, x, z, r, h, name = 'side-table') {
  b.add('woodDark', cylinder(r, r, 0.04, 28), trs(x, h - 0.02, z));
  b.add('brass', new THREE.TorusGeometry(r, 0.01, 6, 28), trs(x, h - 0.02, z, Math.PI / 2, 0, 0));
  b.add('woodDark', cylinder(0.035, 0.05, h - 0.05, 10), trs(x, (h - 0.05) / 2 + 0.02, z));
  b.add('brass', cylinder(0.18, 0.2, 0.03, 18), trs(x, 0.015, z));
  b.coll(x - r, x + r, z - r, z + r, { y1: h + 0.2, name });
}

/** 壁付けのランプ（真鍮 + 光る球）。nx, nz = 壁から室内への向き */
export function sconce(b, x, y, z, nx, nz) {
  b.add('brass', cylinder(0.05, 0.05, 0.02, 14), trs(x, y, z, nz ? Math.PI / 2 : 0, 0, nx ? Math.PI / 2 : 0));
  b.add('brass', box(nx ? 0.14 : 0.018, 0.018, nz ? 0.14 : 0.018), trs(x + nx * 0.07, y, z + nz * 0.07));
  b.add('brass', cylinder(0.035, 0.025, 0.03, 12), trs(x + nx * 0.14, y + 0.08, z + nz * 0.14));
  b.add('glow', new THREE.SphereGeometry(0.06, 14, 10), trs(x + nx * 0.14, y + 0.15, z + nz * 0.14, 0, 0, 0, [1, 1.2, 1]));
}

/** 天井の埋め込み灯（真鍮の縁 + 光る半球） */
export function ceilingLamp(b, x, y, z, r = 0.15) {
  b.add('brass', cylinder(r + 0.01, r - 0.03, 0.04, 20), trs(x, y - 0.02, z));
  b.add('glow', new THREE.SphereGeometry(r, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), trs(x, y - 0.04, z, Math.PI, 0, 0, [1, 0.55, 1]));
}

/**
 * 下の階へ降りる階段（入れない）。
 *   (x, z) = 降り口の縁の中央、dir = 降りていく向き（'-x' | '+x' | '-z' | '+z'）、width = 階段の幅
 *   段は steps 段（踏面 run・蹴上 rise）見え、その先は踊り場と Lower Deck へ通じる扉（閉じた扉）で終わる。
 *   1 段目の上に真鍮のポール 2 本とチェーンを張り、中央に小さな「CREW ONLY」の札を下げる。
 *   当たり判定：降り口の縁（チェーンの手前）に葉っぱが通れない箱（カメラは通れる）。
 * @returns {{ chainCollider: object, wellBox: number[], plateAt: THREE.Vector3, plateYaw: number }}
 */
export function stairWell(b, x, z, dir, o = {}) {
  const width = o.width ?? 1.2;
  const run = o.run ?? 0.22;
  const rise = o.rise ?? 0.22;
  const steps = o.steps ?? 9;
  const chainU = o.chainU ?? 0.14; // 縁からチェーンまで
  const wall = 0.1;
  const name = o.name ?? 'stair';
  const landing = o.landing ?? 1.0; // 段の先の踊り場の長さ
  const hasDoor = o.door ?? true; // 踊り場の先に Lower Deck の扉
  const axis = dir[1];
  const sgn = dir[0] === '-' ? -1 : 1;
  // ローカル：u = 降りる向き、v = 横、y = 上。yaw でワールドへ（ローカル -Z = 降りる向き）
  const yaw = axis === 'x' ? (sgn < 0 ? Math.PI / 2 : -Math.PI / 2) : sgn < 0 ? 0 : Math.PI;
  const put = framer(b, x, z, yaw);
  const P = (key, w, h, d, u, y, v, color) => put(key, box(w, h, d), v, y, -u, 0, 0, 0, color);
  const len = steps * run;
  const hv = width / 2;
  const depth = steps * rise;
  // 段（踏面は木、蹴込みは濃い木。段鼻に真鍮）
  for (let i = 1; i <= steps; i++) {
    const u0 = (i - 1) * run;
    const yTop = -i * rise;
    P('wood', width, 0.04, run + 0.02, u0 + run / 2, yTop - 0.02, 0);
    P('woodDark', width, rise, 0.03, u0 + 0.015, yTop + rise / 2, 0, 0x4a2a17);
    P('brass', width - 0.06, 0.012, 0.03, u0 + 0.02, yTop + 0.006, 0);
  }
  // 段の先の踊り場と、Lower Deck へ通じる扉のある壁
  P('floor', width, 0.06, landing, len + landing / 2, -depth - 0.03, 0);
  P('plaster', width + 2 * wall, depth + 0.1, wall, len + landing + wall / 2, -(depth + 0.1) / 2 - 0.006, 0);
  // 井戸の両側の壁（床下まで）。上は床の高さで終わる（上の階の壁は各階の建物側で作る）
  for (const s of [-1, 1]) {
    P('plaster', wall, depth + 0.1, len + landing, (len + landing) / 2, -(depth + 0.1) / 2 - 0.006, s * (hv + wall / 2));
    P('wainscot', 0.02, 0.8, len + landing, (len + landing) / 2, -depth + 0.4, s * (hv - 0.01));
    // 手すり（段に沿って斜め）
    const ang = Math.atan2(rise, run);
    const hyp = Math.hypot(len, depth);
    put('brass', rodZ(hyp, 0.02), s * (hv - 0.06), -depth / 2 + 0.86, -len / 2, -ang, 0, 0);
    for (const t of [0.15, 0.5, 0.85]) put('brass', box(0.07, 0.02, 0.02), s * (hv - 0.035), -depth * t + 0.86, -len * t, 0, 0, 0);
  }
  // 段の下の暗い影（井戸の底）
  P('woodDark', width, 0.02, len, len / 2, -depth - 0.08, 0, 0x2a1c12);
  // Lower Deck の扉（閉じた扉。暗い木 + 真鍮）
  if (hasDoor) {
    const du = len + landing - 0.03;
    P('woodDark', 0.9, 2.0, 0.05, du, -depth + 1.0, 0);
    P('brass', 0.04, 0.2, 0.02, du - 0.04, -depth + 1.02, -0.32);
    P('frostPlain', 0.42, 0.36, 0.01, du - 0.03, -depth + 1.5, 0);
  }
  // 降り口の縁の見切り（真鍮）
  P('brass', width, 0.012, 0.04, 0.0, -0.006, 0);
  // ---- チェーン（1 段目の上に立つ 2 本のポール） ----
  const cu = chainU;
  const postH = 0.95;
  const vy = -rise; // 1 段目の踏面
  for (const s of [-1, 1]) {
    const pv = s * (hv - 0.1);
    put('brass', cylinder(0.022, 0.026, postH, 12), pv, vy + postH / 2, -cu);
    put('brass', new THREE.SphereGeometry(0.04, 12, 8), pv, vy + postH + 0.02, -cu);
    put('woodDark', cylinder(0.08, 0.09, 0.04, 16), pv, vy + 0.02, -cu);
  }
  // チェーンの輪（たるんだ懸垂線）。輪を交互に 90° ひねる
  const span = 2 * (hv - 0.1);
  const nLinks = Math.round(span / 0.045);
  const topY = vy + postH - 0.06;
  const sag = 0.16;
  for (let i = 0; i <= nLinks; i++) {
    const t = i / nLinks;
    const v = -hv + 0.1 + span * t;
    const y = topY - sag * (1 - (2 * t - 1) ** 2);
    const slope = -sag * (-4 * (2 * t - 1)) / span;
    const g = new THREE.TorusGeometry(0.018, 0.005, 5, 10);
    g.scale(1.45, 1, 1);
    put('brass', g, v, y, -cu, i % 2 ? Math.PI / 2 : 0, 0, Math.atan(slope), 0x8a6a3a);
  }
  // 札を下げる短い輪
  const plateY = topY - sag - 0.12;
  // ---- 札（CREW ONLY）。メッシュ 1 枚（プレートのテクスチャ） ----
  const plate = b.plate(o.plate ?? 'CREW ONLY', 0.26, 0.09);
  const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)); // 降りる向き
  plate.position.set(x + fwd.x * (cu - 0.012), plateY, z + fwd.z * (cu - 0.012));
  plate.rotation.y = yaw; // 降り口の側（上の階）を向く
  // ---- 当たり判定 ----
  // 葉っぱ：降り口の縁から先へ行けない（チェーンの手前で止まる）。カメラは通れる（block だけ）
  const far = len + landing + 0.2;
  const pts = [
    [x, z],
    [x + fwd.x * far, z + fwd.z * far],
  ];
  const side = new THREE.Vector3(fwd.z, 0, -fwd.x).multiplyScalar(hv + wall);
  const xs = pts.flatMap(([px]) => [px + side.x, px - side.x]);
  const zs = pts.flatMap(([, pz]) => [pz + side.z, pz - side.z]);
  const well = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  const chainCollider = b.coll(well[0], well[1], well[2], well[3], { y0: -3, y1: 1.0, block: true, occlude: false, name: `${name}:chain` });
  return { chainCollider, wellBox: well, plate, depth, length: len, fwd };
}

/** 吊りランプ（真鍮の輪 + 光る半球）。ceilY = 天井の高さ */
export function pendant(b, x, z, ceilY, r = 0.22, drop = 0.6) {
  const y = ceilY - drop;
  b.add('brass', cylinder(0.008, 0.008, drop - 0.1, 6), trs(x, (ceilY + y) / 2 + 0.05, z));
  b.add('brass', cylinder(0.07, 0.05, 0.03, 14), trs(x, ceilY - 0.02, z));
  b.add('brass', new THREE.TorusGeometry(r, 0.012, 8, 32), trs(x, y, z, Math.PI / 2, 0, 0));
  b.add('brass', cylinder(r * 0.45, r * 0.25, 0.06, 18), trs(x, y + 0.06, z));
  b.add('glow', new THREE.SphereGeometry(r * 0.9, 22, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), trs(x, y, z, 0, 0, 0, [1, 0.42, 1]));
}

/** 甲板のベンチ（チーク材の座面と背・真鍮の脚）。yaw = 座った人の正面 */
export function deckBench(b, x, z, yaw, len = 1.8, name = 'deck-bench') {
  const put = framer(b, x, z, yaw);
  for (let i = 0; i < 4; i++) put('deck', box(len, 0.035, 0.09), 0, 0.45, -0.18 + i * 0.11);
  for (let i = 0; i < 3; i++) put('deck', box(len, 0.08, 0.03), 0, 0.62 + i * 0.12, 0.2, -0.12);
  for (const lx of [-len / 2 + 0.12, len / 2 - 0.12]) {
    put('brass', box(0.04, 0.45, 0.04), lx, 0.225, -0.18);
    put('brass', box(0.04, 0.82, 0.04), lx, 0.41, 0.2, -0.12);
    put('brass', box(0.04, 0.04, 0.44), lx, 0.43, 0.0);
    put('brass', box(0.05, 0.03, 0.4), lx, 0.66, 0.0);
  }
  const [a0, a1, c0, c1] = aabb(x, z, yaw, len / 2, 0.3);
  b.coll(a0, a1, c0, c1, { y1: 0.9, name });
}

/** 2 点の間の棒（手すりなど） */
export function rodBetween(b, key, ax, ay, az, bx, by, bz, r = 0.02, color) {
  const d = new THREE.Vector3(bx - ax, by - ay, bz - az);
  const L = d.length();
  if (L < 1e-4) return;
  const g = cylinder(r, r, L, 8);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  const m = new THREE.Matrix4().compose(new THREE.Vector3((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2), q, new THREE.Vector3(1, 1, 1));
  b.add(key, g, m, color);
}

export { rodX, rodZ };
