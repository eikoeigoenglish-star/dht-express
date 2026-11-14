/**
 * interior/kit.js — 【v11】室内（FOREST SCHOOL EXPRESS）用のジオメトリ道具
 * ---------------------------------------------------------------------------
 * ・単位はメートル（MAP の 1 unit = 1 km とは別の、室内専用シーン）
 * ・UV はメートル単位（テクスチャの repeat = 1 / タイル長 [m] で貼る）
 * ・PartBin：同じマテリアルの部品を 1 つのジオメトリへ結合して draw call を減らす
 *   （部品ごとの色は頂点カラーで持つ。既定は白 = マテリアルの色そのまま）
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** 角丸の矩形 Shape（中心原点） */
export function roundedRectShape(w, h, r) {
  r = Math.max(0, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4));
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  if (r > 0) s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  if (r > 0) s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  if (r > 0) s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  if (r > 0) s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/**
 * 角の丸い箱（中心原点・w×h×d）。家具・クッション・額縁などに使う。
 * ExtrudeGeometry のベベルで角を丸める（UV はメートル単位）。
 */
export function roundedBox(w, h, d, r = 0.03, seg = 2) {
  r = Math.max(0.002, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3));
  const shape = roundedRectShape(w - 2 * r, h - 2 * r, r * 0.6);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(1e-4, d - 2 * r),
    bevelEnabled: true,
    bevelThickness: r,
    bevelSize: r,
    bevelSegments: seg,
    curveSegments: 3,
  });
  g.translate(0, 0, -(d - 2 * r) / 2);
  g.clearGroups();
  return g;
}

/** 普通の箱。UV を面ごとにメートル単位へ */
export function box(w, h, d) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  // 面の順：+x, -x, +y, -y, +z, -z（各 4 頂点）
  const dims = [
    [d, h], [d, h],
    [w, d], [w, d],
    [w, h], [w, h],
  ];
  for (let f = 0; f < 6; f++) {
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      uv.setXY(k, uv.getX(k) * dims[f][0], uv.getY(k) * dims[f][1]);
    }
  }
  return g;
}

/** 円柱（UV をメートル単位へ） */
export function cylinder(rTop, rBot, h, seg = 16, open = false) {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, open);
  const uv = g.attributes.uv;
  const circ = Math.PI * 2 * Math.max(rTop, rBot);
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * circ, uv.getY(i) * h);
  return g;
}

/** x 軸方向の円柱（手すり・カーテンレールなど）。中心原点 */
export function rodX(len, r, seg = 10) {
  const g = cylinder(r, r, len, seg);
  g.rotateZ(Math.PI / 2);
  return g;
}
export function rodZ(len, r, seg = 10) {
  const g = cylinder(r, r, len, seg);
  g.rotateX(Math.PI / 2);
  return g;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

/** 位置・回転（Euler, rad）・スケールから行列 */
export function trs(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1) {
  _q.setFromEuler(_e.set(rx, ry, rz));
  if (typeof s === 'number') _s.setScalar(s);
  else _s.set(s[0], s[1], s[2]);
  return _m.clone().compose(_p.set(x, y, z), _q, _s);
}

/**
 * マテリアル別の部品入れ。add() した部品を build() で 1 マテリアル = 1 Mesh に結合する。
 */
export class PartBin {
  constructor() {
    this.bins = new Map(); // key -> geometries[]
  }

  /**
   * @param {string} key マテリアルのキー
   * @param {THREE.BufferGeometry} geo
   * @param {THREE.Matrix4} [matrix]
   * @param {THREE.ColorRepresentation} [color] 頂点カラー（既定は白）
   */
  add(key, geo, matrix, color) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!g.attributes.normal) g.computeVertexNormals();
    g.clearGroups();
    g.morphAttributes = {};
    if (matrix) g.applyMatrix4(matrix);
    const c = new THREE.Color(color ?? 0xffffff);
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    if (!this.bins.has(key)) this.bins.set(key, []);
    this.bins.get(key).push(g);
    return this;
  }

  /**
   * @param {Record<string, THREE.Material>} materials
   * @returns {THREE.Group}
   */
  build(materials, name = 'parts') {
    const group = new THREE.Group();
    group.name = name;
    for (const [key, list] of this.bins) {
      const mat = materials[key];
      if (!mat) {
        console.warn('[interior] material missing:', key);
        continue;
      }
      const merged = mergeGeometries(list, false);
      list.forEach((g) => g.dispose());
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, mat);
      mesh.name = `${name}:${key}`;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      group.add(mesh);
    }
    this.bins.clear();
    return group;
  }
}

/** 決定的な乱数（同じ見た目を毎回再現する） */
export function rng(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

/** XZ 平面の軸平行な箱（当たり判定・カメラの遮蔽判定） */
export class Collider {
  constructor(x0, x1, z0, z1, y0 = 0, y1 = 2.5, opts = {}) {
    this.min = new THREE.Vector3(Math.min(x0, x1), y0, Math.min(z0, z1));
    this.max = new THREE.Vector3(Math.max(x0, x1), y1, Math.max(z0, z1));
    this.block = opts.block ?? true; // プレイヤーが通れない
    this.occlude = opts.occlude ?? false; // カメラ → プレイヤーの視線を遮る
    this.enabled = true;
    this.name = opts.name ?? '';
    this.box = new THREE.Box3(this.min, this.max);
  }
}

/** 円（中心 p、半径 r）を箱の外へ押し出す。押し出したら true */
export function pushOutCircle(p, r, c) {
  const cx = Math.max(c.min.x, Math.min(p.x, c.max.x));
  const cz = Math.max(c.min.z, Math.min(p.z, c.max.z));
  let dx = p.x - cx;
  let dz = p.z - cz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return false;
  if (d2 > 1e-10) {
    const d = Math.sqrt(d2);
    p.x = cx + (dx / d) * r;
    p.z = cz + (dz / d) * r;
    return true;
  }
  // 中心が箱の中：最も近い辺の外へ
  const opts = [
    [p.x - c.min.x + r, -1, 0],
    [c.max.x - p.x + r, 1, 0],
    [p.z - c.min.z + r, 0, -1],
    [c.max.z - p.z + r, 0, 1],
  ].sort((a, b) => a[0] - b[0]);
  p.x += opts[0][1] * opts[0][0];
  p.z += opts[0][2] * opts[0][0];
  return true;
}
