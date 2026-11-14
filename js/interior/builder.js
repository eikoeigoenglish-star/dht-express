/**
 * interior/builder.js — 【v12】車内の組み立て道具（個室・廊下・ラウンジで共通）
 * ---------------------------------------------------------------------------
 * ・部品は「区画（section）」ごとの PartBin に入れ、最後に区画 × マテリアルごとに 1 メッシュへ結合する
 *   【v13】区画 = 'shell'（仕切り壁など常に見える部分）/ 'room1'〜'room3' / 'corridor' / 'lounge'。
 *   train.js が「いま見える区画」だけを描く（閉じた扉の向こうの部屋は描かない）ための単位。
 *   b.section('room2') で以降の add() の入れ先を切り替える。
 * ・当たり判定は Collider（XZ の箱 + 高さ）。用途のフラグ：
 *     block   … 葉っぱが通れない
 *     wall    … カメラが突き抜けない（壁・閉じた扉）
 *     occlude … カメラ → 葉っぱの視線を遮る大きな家具（カメラを手前へ寄せる）
 */
import * as THREE from 'three';
import { PartBin, roundedBox, roundedRectShape, box, trs, Collider } from './kit.js';
import { plateTexture } from './textures.js';
import { H } from './layout.js';

export class Builder {
  constructor(mats) {
    this.mats = mats;
    this.bins = new Map(); // section id -> PartBin
    this.colliders = [];
    this.section('shell');
  }

  /** 【v13】以降の部品を入れる区画を切り替える（戻り値は直前の区画 id） */
  section(id) {
    const prev = this.sectionId;
    this.sectionId = id;
    if (!this.bins.has(id)) this.bins.set(id, new PartBin());
    this.P = this.bins.get(id);
    return prev;
  }

  add(key, geo, m, color) {
    this.P.add(key, geo, m, color);
  }

  /** 軸平行の箱（範囲で指定） */
  B(key, x0, x1, y0, y1, z0, z1, color) {
    this.add(key, box(x1 - x0, y1 - y0, z1 - z0), trs((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), color);
  }

  /** 角丸の箱（中心・回転で指定） */
  RB(key, w, h, d, r, x, y, z, rx = 0, ry = 0, rz = 0, color) {
    this.add(key, roundedBox(w, h, d, r), trs(x, y, z, rx, ry, rz), color);
  }

  /** 角丸の箱のジオメトリ（中心原点）。部品をローカル座標で組むとき用 */
  rbGeo(w, h, d, r) {
    return roundedBox(w, h, d, r);
  }

  /** 当たり判定。opts: { y0, y1, block, wall, occlude, name } */
  coll(x0, x1, z0, z1, opts = {}) {
    const c = new Collider(x0, x1, z0, z1, opts.y0 ?? 0, opts.y1 ?? H, { block: opts.block ?? true, occlude: opts.occlude ?? false, name: opts.name });
    c.wall = opts.wall ?? false;
    this.colliders.push(c);
    return c;
  }

  /**
   * 壁の室内側の仕上げ（腰壁・幅木・チェアレール・コーニス）
   * @param {'x'|'z'} axis  x = 一定の面か z = 一定の面か
   * @param {number} at     面の位置
   * @param {1|-1} sgn      面の法線の向き（室内側）
   * @param {number} a0     面に沿った範囲
   */
  finish(axis, at, sgn, a0, a1, { top = true, h = H } = {}) {
    const t = (d0, d1) => (sgn > 0 ? [at + d0, at + d1] : [at - d1, at - d0]);
    const seg = (key, d0, d1, y0, y1) => {
      const [p0, p1] = t(d0, d1);
      if (axis === 'x') this.B(key, p0, p1, y0, y1, a0, a1);
      else this.B(key, a0, a1, y0, y1, p0, p1);
    };
    seg('wainscot', 0, 0.018, 0.1, 0.9);
    seg('woodDark', 0, 0.025, 0, 0.11);
    seg('wood', 0, 0.035, 0.89, 0.94);
    seg('brass', 0.035, 0.045, 0.905, 0.925);
    if (top) {
      seg('wood', 0, 0.06, h - 0.12, h);
      seg('wood', 0, 0.03, h - 0.16, h - 0.12);
    }
  }

  /** 角丸の枠（外形 − 穴）。z = 0〜depth に押し出し */
  ring(ow, oh, or, iw, ih, ir, depth) {
    const s = roundedRectShape(ow, oh, or);
    s.holes.push(roundedRectShape(iw, ih, ir));
    return new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 6 });
  }

  /** 鉢植えの葉 */
  foliage(R, x, y, z, size, n) {
    const cols = [0x4f8f45, 0x5f9e4c, 0x3f7a3d, 0x6aa553];
    for (let i = 0; i < n; i++) {
      const a = R() * Math.PI * 2;
      const tilt = 0.35 + R() * 0.9;
      const len = size * (0.55 + R() * 0.5);
      const g = new THREE.SphereGeometry(1, 8, 6);
      g.scale(len * 0.22, len * 0.5, 0.012 + len * 0.02);
      g.translate(0, len * 0.5, 0);
      this.add('plant', g, trs(x, y, z, Math.cos(a) * tilt, R() * 6, Math.sin(a) * tilt), cols[i % cols.length]);
    }
  }

  /** 垂れ下がる蔦（壁の上から） */
  ivy(R, x, y, z, len, n) {
    const cols = [0x4f8f45, 0x5f9e4c, 0x3f7a3d, 0x6aa553];
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const g = new THREE.SphereGeometry(1, 6, 4);
      const s = 0.045 + R() * 0.03;
      g.scale(s, s * 0.7, s * 0.35);
      const ox = (R() - 0.5) * 0.35 * (0.4 + t);
      this.add('plant', g, trs(x + ox, y - t * len, z + (R() - 0.5) * 0.12, R() * 3, R() * 6, R() * 3), cols[i % cols.length]);
    }
  }

  /** タッセルで絞ったカーテン（上が広く、タッセルで細く、裾で少し広がる）。side: ±1 で寄せる向き */
  curtain(w, h, side, tie = 0.4) {
    const g = new THREE.PlaneGeometry(w, h, 14, 20);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const u = p.getX(i) / w + 0.5;
      const v = p.getY(i) / h + 0.5;
      let f;
      if (v > tie) f = 0.32 + 0.68 * Math.pow((v - tie) / (1 - tie), 0.8);
      else f = 0.32 + 0.22 * Math.pow((tie - v) / tie, 1.2);
      const x = side * ((u - 0.5) * w * f + (1 - f) * w * 0.32);
      const fold = Math.sin(u * Math.PI * 7) * 0.022 * (0.4 + f);
      const z = fold + 0.03 * Math.sin(v * Math.PI) * (1 - f);
      p.setXYZ(i, x, v * h, z);
    }
    g.computeVertexNormals();
    return g;
  }

  /**
   * 引き戸 1 枚（ローカル：幅は x、厚みは z、下端 y = 0）。label があれば真鍮のプレート付き。
   * 戻り値は Group（扉ごとに動かすので結合はこの中だけ）
   */
  doorPanel(width, height, label, { emblem = true } = {}) {
    const P = new PartBin();
    P.add('woodDark', roundedBox(width, height, 0.05, 0.012), trs(0, height / 2, 0));
    for (const s of [-1, 1]) {
      const pl = new THREE.PlaneGeometry(0.5, 0.72);
      if (s < 0) pl.rotateY(Math.PI);
      P.add(emblem ? 'frost' : 'frostPlain', pl, trs(0.04, 1.42, s * 0.027));
      P.add('wood', roundedBox(0.58, 0.8, 0.012, 0.004), trs(0.04, 1.42, s * 0.024));
      P.add('wood', roundedBox(0.58, 0.62, 0.012, 0.004), trs(0.04, 0.5, s * 0.026));
      P.add('brass', roundedBox(0.04, 0.2, 0.02, 0.006), trs(-width / 2 + 0.08, 1.02, s * 0.035));
    }
    const g = P.build(this.mats, `door-${label || 'plain'}`);
    if (label) {
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.12), new THREE.MeshStandardMaterial({ map: plateTexture(label), roughness: 0.4, metalness: 0.2 }));
      plate.position.set(0.04, 1.92, 0.03);
      g.add(plate);
    }
    return g;
  }

  /** 壁の真鍮プレート（文字） */
  plate(text, w = 0.34, h = 0.13) {
    return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: plateTexture(text), roughness: 0.4, metalness: 0.2 }));
  }

  /**
   * 区画ごとに結合する。戻り値の Group の子 = 区画（name = 区画 id）、孫 = マテリアルごとの Mesh。
   * sections[id] で区画の Group を引ける。
   */
  build(name) {
    const root = new THREE.Group();
    root.name = name;
    this.sections = {};
    for (const [id, bin] of this.bins) {
      const g = bin.build(this.mats, `${name}:${id}`);
      g.userData.section = id;
      this.sections[id] = g;
      root.add(g);
    }
    return root;
  }
}
