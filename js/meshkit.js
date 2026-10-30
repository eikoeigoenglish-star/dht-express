/**
 * meshkit.js — 低ポリゴンの部品を「頂点カラー付きの 1 ジオメトリ」へまとめる小さな道具
 * ---------------------------------------------------------------------------
 * ランドマークは数十個の箱・円柱・円錐の組み合わせでできているが、
 * そのまま Mesh にすると部品ごとに draw call が増える。
 * GeoBuilder で部品を追加 → build() で 1 本の BufferGeometry（position / normal / color）にまとめ、
 * 共有マテリアル（MeshLambertMaterial({ vertexColors: true })）1 つで描く。
 * → ランドマーク 1 件 = draw call 1。
 *
 * 単位はワールド単位（1 = 1 km）。y は「部品の底面」の高さで指定する。
 */
import * as THREE from 'three';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

export class GeoBuilder {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.col = [];
  }

  /**
   * 任意のジオメトリを追加（内部で非インデックス化して連結）
   * @param {THREE.BufferGeometry} g
   * @param {string|number} color
   * @param {THREE.Matrix4} [matrix]
   */
  add(g, color, matrix) {
    let geo = g.index ? g.toNonIndexed() : g;
    if (matrix) geo.applyMatrix4(matrix);
    if (!geo.attributes.normal) geo.computeVertexNormals();
    const p = geo.attributes.position.array;
    const n = geo.attributes.normal.array;
    _c.set(color);
    for (let i = 0; i < p.length; i += 3) {
      this.pos.push(p[i], p[i + 1], p[i + 2]);
      this.nor.push(n[i], n[i + 1], n[i + 2]);
      this.col.push(_c.r, _c.g, _c.b);
    }
    if (geo !== g) geo.dispose();
    g.dispose();
    return this;
  }

  /** 変換行列：位置 (x, y, z)・回転 (rx, ry, rz)・拡大 (sx, sy, sz) */
  static mat(x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    _e.set(rx, ry, rz, 'YXZ');
    _q.setFromEuler(_e);
    return _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz)).clone();
  }

  /** 直方体（底面中心が (x, y, z)） */
  box(w, h, d, color, x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0) {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(0, h / 2, 0);
    return this.add(g, color, GeoBuilder.mat(x, y, z, ry, rx, rz));
  }

  /** 円柱・円錐台（底面中心が (x, y, z)） */
  cyl(rTop, rBottom, h, seg, color, x = 0, y = 0, z = 0, ry = 0, open = false) {
    const g = new THREE.CylinderGeometry(rTop, rBottom, h, seg, 1, open);
    g.translate(0, h / 2, 0);
    return this.add(g, color, GeoBuilder.mat(x, y, z, ry));
  }

  /** 2 点 a→b を結ぶ細い角材（ケーブル・脚・梁） */
  beam(ax, ay, az, bx, by, bz, t, color) {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-6) return this;
    const g = new THREE.BoxGeometry(t, len, t);
    const dir = _p.set(dx / len, dy / len, dz / len);
    _q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    const m = new THREE.Matrix4().compose(new THREE.Vector3((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2), _q, _s.set(1, 1, 1));
    return this.add(g, color, m);
  }

  /**
   * 寄棟屋根（四角錐台）。w×d の底面から高さ h、上端は topFrac 倍に絞る。
   * 和風建築の屋根・城の屋根・石垣（下が広い台形）にも使う。
   */
  hip(w, d, h, topFrac, color, x = 0, y = 0, z = 0, ry = 0) {
    const g = new THREE.CylinderGeometry(Math.SQRT1_2 * topFrac, Math.SQRT1_2, h, 4, 1, false);
    g.rotateY(Math.PI / 4);
    g.translate(0, h / 2, 0);
    g.scale(w, 1, d);
    return this.add(g, color, GeoBuilder.mat(x, y, z, ry));
  }

  /** 切妻屋根（三角柱）。棟は長さ len 方向（ローカル Z）に通る */
  gable(w, len, h, color, x = 0, y = 0, z = 0, ry = 0) {
    const s = new THREE.Shape();
    s.moveTo(-w / 2, 0);
    s.lineTo(w / 2, 0);
    s.lineTo(0, h);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: len, bevelEnabled: false });
    g.translate(0, 0, -len / 2);
    return this.add(g, color, GeoBuilder.mat(x, y, z, ry));
  }

  /** 平らな多角形の板（池・堀など）。pts は [x, z] の配列（ローカル） */
  plate(pts, thick, color, y = 0) {
    const s = new THREE.Shape();
    // Shape の (u, v) → ワールド (x, -z) で回すので v には -z を入れる
    pts.forEach(([x, z], i) => (i ? s.lineTo(x, -z) : s.moveTo(x, -z)));
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: false, curveSegments: 1 });
    g.rotateX(-Math.PI / 2);
    g.translate(0, y, 0);
    return this.add(g, color);
  }

  get vertexCount() {
    return this.pos.length / 3;
  }

  /** @returns {THREE.BufferGeometry} */
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    this.pos = this.nor = this.col = null;
    return g;
  }
}

/** 決定的な疑似乱数（同じ seed なら毎回同じ街並み・配置になる） */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 文字列 → 32bit ハッシュ */
export function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 整数格子のハッシュ → 0..1 */
export function hash2i(i, j, seed = 0) {
  let h = Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(seed, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** 滑らかな値ノイズ 0..1（市街地の輪郭を不規則にするため） */
export function valueNoise(x, z, seed = 0) {
  const i = Math.floor(x);
  const j = Math.floor(z);
  const fx = x - i;
  const fz = z - j;
  const u = fx * fx * (3 - 2 * fx);
  const v = fz * fz * (3 - 2 * fz);
  const a = hash2i(i, j, seed);
  const b = hash2i(i + 1, j, seed);
  const c = hash2i(i, j + 1, seed);
  const d = hash2i(i + 1, j + 1, seed);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}
