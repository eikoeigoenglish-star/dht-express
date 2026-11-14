/**
 * interior/scenery.js — 【v11】Room 1 の車窓（無限スクロールする軽量な景色）
 * ---------------------------------------------------------------------------
 * イメージ：高架を走る列車から街を見下ろす眺め。
 *   ・眼下〜地平線まで低層の住宅・中層マンションが広がる街並み（ところどころ公園の緑）
 *   ・地平線にはかすんだ青い山並み（常に見える）
 *   ・区間によっては、街のすぐ向こうに緑の山々が迫る（数分ごとに現れたり消えたりして飽きない）
 * MAP の巨大な地形は使わず、室内シーン専用の景色を窓の外に置いて流す。
 *
 * 高さ：線路（架線柱の根元）= trackY（-0.9 m）、街の地面 = cityY（-45 m。高い高架の上から見下ろす）
 *
 * 層（窓からの距離 d [m]。すべて同じ実速度 speed [m/s] で +X へ流れる → 距離の差で自然な視差）
 *   架線柱   d 3.4           高架上の架線柱（速く流れる）。架線・隣の線路は連続なので固定
 *   近い街   d 18〜260       住宅・マンション（窓のテクスチャ）・公園の木
 *   遠い街   d 260〜1000     建物の塊（かすみ = scene.fog）
 *   緑の山   d 1500〜3800    チャンク長 9 km のうち 2 か所に、なだらかな山並み（それ以外は平野）
 *   遠い山並 d 7000          青くかすんだ稜線（チャンク長 40 km）
 *   雲・空   半透明の板 1 枚 / ドーム
 *   地面     屋根の並ぶ街のテクスチャ（オフセットを流す）
 *
 * 各層は「長さ W のチャンク（1 ジオメトリに結合）× 2 枚」を交互に並べ替えるだけ
 *   → 毎フレームの更新は Mesh の position.x を 2 つ動かすだけ。影なし。透明は雲だけ。
 *
 * 進行方向：列車は -X へ進む（景色は +X へ流れる）。
 * 2 つの側（facing = -1：Room 1 の車窓側、+1：廊下の窓側 = lite で軽量）を同じクラスで作る。
 */
import * as THREE from 'three';
import { box, PartBin, trs, rng } from './kit.js';

export const TRAIN_DIR = -1; // 列車の進行方向（-X）。景色は逆向き（+X）へ流れる
export const SCENERY = {
  trackY: -0.9,
  cityY: -45,
  skyR: 12000,
};

function canvasTex(w, h, draw, { repeat = true, tile = 1 } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    const [tx, ty] = Array.isArray(tile) ? tile : [tile, tile];
    t.repeat.set(1 / tx, 1 / ty);
  }
  t.userData.tile = tile;
  t.anisotropy = 8;
  return t;
}

/** 建物の壁（1 タイル = 幅 3m × 1 階 3m）。白地 → 頂点カラーで色付け */
function windowsTexture() {
  return canvasTex(64, 64, (g, S) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, S, S);
    g.fillStyle = '#7d98ad';
    g.fillRect(10, 18, 44, 28);
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.fillRect(12, 20, 10, 24);
    g.fillStyle = 'rgba(0,0,0,0.16)';
    g.fillRect(0, 52, S, 5); // ベランダの影
  }, { tile: 3 });
}

/** 地面：上から見た街（屋根・道路）。tile 320 m */
function cityGroundTexture() {
  return canvasTex(512, 512, (g, S) => {
    g.fillStyle = '#9d9a92';
    g.fillRect(0, 0, S, S);
    const r = rng(501);
    const cols = ['#d9d6cf', '#c9c6be', '#e6e3dc', '#b8b4ab', '#8e8a83', '#a6a29a', '#7a8b98', '#9a6b5c', '#c4c9cc'];
    for (let by = 0; by < S; by += 64) {
      for (let bx = 0; bx < S; bx += 64) {
        // 1 ブロック（道路で囲まれる）に小さな屋根を詰める
        for (let i = 0; i < 26; i++) {
          const w = 6 + r() * 14;
          const h = 6 + r() * 12;
          g.fillStyle = cols[Math.floor(r() * cols.length)];
          g.fillRect(bx + 4 + r() * (56 - w), by + 4 + r() * (56 - h), w, h);
        }
        if (r() < 0.12) {
          g.fillStyle = '#5f7d4f';
          g.fillRect(bx + 6, by + 6, 30 + r() * 20, 26 + r() * 22);
        }
      }
    }
    g.fillStyle = '#6f6d69';
    for (let k = 0; k < S; k += 64) {
      g.fillRect(k, 0, 3, S);
      g.fillRect(0, k, S, 3);
    }
  }, { tile: 320 });
}

function cloudTexture() {
  return canvasTex(1024, 256, (g, W) => {
    const r = rng(401);
    const puff = (x, y, rx, ry, a) => {
      for (const dx of [-W, 0, W]) {
        g.save();
        g.translate(x + dx, y);
        g.scale(1, ry / rx);
        const gr = g.createRadialGradient(0, 0, 0, 0, 0, rx);
        gr.addColorStop(0, `rgba(255,255,255,${a})`);
        gr.addColorStop(0.55, `rgba(255,255,255,${a * 0.5})`);
        gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr;
        g.beginPath();
        g.arc(0, 0, rx, 0, Math.PI * 2);
        g.fill();
        g.restore();
      }
    };
    // 横に流れる薄い筋雲（高い空） + ところどころ積雲
    for (let k = 0; k < 9; k++) {
      const cx = (k + r()) * (W / 9);
      const cy = 50 + r() * 140;
      for (let i = 0; i < 9; i++) puff(cx + (r() - 0.5) * 160, cy + (r() - 0.5) * 14, 30 + r() * 50, 6 + r() * 8, 0.55);
    }
    for (let k = 0; k < 4; k++) {
      const cx = (k + r()) * (W / 4);
      const cy = 170 + r() * 50;
      for (let i = 0; i < 10; i++) puff(cx + (r() - 0.5) * 90, cy - i * 3 + (r() - 0.5) * 20, 18 + r() * 26, 14 + r() * 16, 0.7);
    }
  }, { repeat: false });
}

/** ループする 1 層（同じ内容のチャンク × 2） */
class LoopLayer {
  constructor(geometry, material, W, name) {
    this.W = W;
    this.a = new THREE.Mesh(geometry, material);
    this.b = new THREE.Mesh(geometry, material);
    this.a.name = `${name}-a`;
    this.b.name = `${name}-b`;
    this.group = new THREE.Group();
    this.group.add(this.a, this.b);
  }
  /** offset [m]（累積の流れ）。xc の周り ±W/2 を常に覆う */
  set(offset, xc) {
    const W = this.W;
    const ph = ((((offset + W / 2) % W) + W) % W) - W / 2; // [-W/2, W/2)
    this.a.position.x = xc - W + ph;
    this.b.position.x = xc + ph;
  }
}

/** 周期 W で滑らかにつながる 1 次元ノイズ（整数倍の周波数の正弦の和） */
function periodicNoise(W, seed, terms) {
  const r = rng(seed);
  const t = terms.map(([k, a]) => ({ k, a, ph: r() * Math.PI * 2 }));
  return (x) => t.reduce((s, { k, a, ph }) => s + a * Math.sin((x / W) * Math.PI * 2 * k + ph), 0);
}

export class WindowScenery {
  /**
   * @param {{ sides: Array<{ facing: -1|1, z0: number, lite?: boolean, xc?: number }>, seed?: number, trackY?: number, cityY?: number }} opts
   *   z0 … 外壁の外側の面（そこから外向きに d を測る）
   */
  constructor(opts) {
    this.trackY = opts.trackY ?? SCENERY.trackY;
    this.cityY = opts.cityY ?? SCENERY.cityY;
    this.offset = 0;
    this.speed = 24;
    this.group = new THREE.Group();
    this.group.name = 'window-scenery';
    this.layers = [];
    this.clouds = [];

    // ---- マテリアル（屋外は Lambert で軽く。かすみは scene.fog） ----
    this.mats = {
      building: new THREE.MeshLambertMaterial({ vertexColors: true, map: windowsTexture() }),
      solid: new THREE.MeshLambertMaterial({ vertexColors: true }),
      foliage: new THREE.MeshLambertMaterial({ vertexColors: true }),
      mountain: new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }),
      ridge: new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }),
      pole: new THREE.MeshLambertMaterial({ color: '#8d9399' }),
      concrete: new THREE.MeshLambertMaterial({ color: '#b9b7b0' }),
      ground: new THREE.MeshLambertMaterial({ color: '#ffffff', map: cityGroundTexture() }),
      cloud: new THREE.MeshBasicMaterial({ map: cloudTexture(), transparent: true, depthWrite: false, fog: false }),
      sky: new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, depthWrite: false, fog: false }),
    };

    // ---- 空（ドーム） ----
    const skyGeo = new THREE.SphereGeometry(SCENERY.skyR, 24, 12);
    skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(skyGeo.attributes.position.count * 3), 3));
    this.sky = new THREE.Mesh(skyGeo, this.mats.sky);
    this.sky.name = 'sky-dome';
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    this.group.add(this.sky);

    // ---- 地面（街。全体で 1 枚。UV をメートルに） ----
    const G = 30000;
    const gg = new THREE.PlaneGeometry(G, G, 1, 1);
    gg.rotateX(-Math.PI / 2);
    const uv = gg.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * G, uv.getY(i) * G);
    this.ground = new THREE.Mesh(gg, this.mats.ground);
    this.ground.position.y = this.cityY;
    this.ground.name = 'city-ground';
    this.group.add(this.ground);

    for (const s of opts.sides) this._buildSide(s, opts.seed ?? 1);
  }

  _W(dmax, s) {
    // 窓から見える横の範囲（カメラが窓に近い廊下側は広めに）
    return Math.round(2 * (s.lite ? 12 + 2.6 * dmax : 8 + 1.6 * dmax));
  }

  _addLayer(bin, W, name, xc) {
    const grp = bin.build(this.mats, name);
    for (const m of [...grp.children]) {
      const L = new LoopLayer(m.geometry, m.material, W, `${name}:${m.name}`);
      this.layers.push({ layer: L, xc });
      this.group.add(L.group);
    }
  }

  _buildSide(s, seed) {
    const f = s.facing;
    const z = (d) => s.z0 + f * d;
    const ty = this.trackY;
    const cy = this.cityY;
    const xc = s.xc ?? 0;
    const r = rng(seed * 97 + (f > 0 ? 13 : 0));

    // ---- 高架：架線柱（流れる）・架線と隣の線路（連続なので固定） ----
    if (!s.lite) {
      const W = 240;
      const bin = new PartBin();
      for (let x = 0; x < W; x += 40) {
        bin.add('pole', box(0.3, 8.2, 0.3), trs(x, ty + 3.5, z(3.4)));
        bin.add('pole', box(0.16, 0.16, 3.2), trs(x, ty + 7.0, z(3.4) - f * 1.5));
        bin.add('pole', box(0.1, 0.9, 0.1), trs(x, ty + 6.55, z(3.4) - f * 2.6));
      }
      this._addLayer(bin, W, 'poles', xc);
      const fixed = new PartBin();
      fixed.add('pole', box(8000, 0.03, 0.03), trs(0, ty + 6.4, z(3.4) - f * 2.6));
      fixed.add('pole', box(8000, 0.025, 0.025), trs(0, ty + 7.0, z(3.4) - f * 2.6));
      fixed.add('concrete', box(8000, 0.9, 7), trs(0, ty - 0.75, z(8.5))); // 隣の線路の高架橋
      fixed.add('concrete', box(8000, 0.9, 0.2), trs(0, ty - 0.1, z(12))); // 外側の壁高欄
      fixed.add('pole', box(8000, 0.08, 0.08), trs(0, ty - 0.22, z(7.6)));
      fixed.add('pole', box(8000, 0.08, 0.08), trs(0, ty - 0.22, z(9.1)));
      this.group.add(fixed.build(this.mats, 'viaduct'));
    }

    // ---- 街（近い） ----
    this._city(s, r, { d0: 18, d1: 260, W: this._W(260, s), density: s.lite ? 0.5 : 1, near: true }, z, cy, xc);
    // ---- 街（遠い）・緑の山（廊下側は省略して軽く） ----
    if (!s.lite) {
      this._city(s, r, { d0: 260, d1: 1000, W: this._W(1000, s), density: 1, near: false }, z, cy, xc);
      this._mountains(z, cy, xc, seed);
    }
    // ---- 遠い山並み（両側） ----
    this._ridge(s, z, cy, xc, seed);

    // ---- 雲（1 枚の半透明板。テクスチャを流す） ----
    {
      const len = 30000;
      const g = new THREE.PlaneGeometry(len, 2200);
      const m = new THREE.Mesh(g, this.mats.cloud.clone());
      m.material.map = this.mats.cloud.map.clone();
      m.material.map.wrapS = THREE.RepeatWrapping;
      m.material.map.needsUpdate = true;
      m.material.map.repeat.set(len / 7000, 1);
      m.position.set(xc, cy + 1500, z(5200));
      if (f > 0) m.rotation.y = Math.PI; // 室内側を向ける
      m.name = 'clouds';
      m.renderOrder = -5;
      this.clouds.push({ mesh: m, facing: f, tile: 7000 });
      this.group.add(m);
    }
  }

  /** 建物の塊。低層の住宅＋ところどころ中層マンション・公園の緑 */
  _city(s, r, o, z, cy, xc) {
    const bin = new PartBin();
    const W = o.W;
    // 区間ごとの密度・高さの変化（周期 W でつながる）
    const zone = periodicNoise(W, 77 + (s.facing > 0 ? 5 : 0) + (o.near ? 0 : 9), [[2, 0.5], [5, 0.3], [9, 0.2]]);
    const walls = [0xf0eee8, 0xe4e1da, 0xd6d3cc, 0xc9ccce, 0xe8dfd0, 0xbfc3c4, 0xd9d0c2, 0xa9a49b];
    const roofs = [0x5b6168, 0x7a5a4c, 0x4f5f70, 0x8a8478, 0x6b6b66, 0x8e4a3c];
    const street = o.near ? 70 : 110;
    const cell = o.near ? 15 : 26;
    for (let d = o.d0; d < o.d1; d += cell * (0.9 + r() * 0.3)) {
      if (r() < 0.12) continue; // 東西方向の道路
      for (let x = 0; x < W; ) {
        const zv = zone(x); // -1..1
        if (x % street < 9) {
          x += 9; // 南北方向の道路
          continue;
        }
        const keep = 0.72 + 0.25 * zv;
        const w = cell * (0.5 + r() * 0.5);
        if (r() < keep * o.density) {
          const dep = cell * (0.5 + r() * 0.45);
          const roll = r();
          let floors;
          if (!o.near && roll < 0.015 + 0.025 * Math.max(0, zv)) floors = 14 + Math.floor(r() * 10); // 塔状のマンション（遠くにぽつぽつ）
          else if (roll < (o.near ? 0.05 : 0.09) + 0.06 * Math.max(0, zv)) floors = 5 + Math.floor(r() * (o.near ? 5 : 8)); // 中層マンション
          else floors = 2 + Math.floor(r() * 2.6); // 住宅（2〜4 階）
          const h = floors * 3;
          const dd = d + (r() - 0.5) * cell * 0.3;
          const g = box(w, h, dep);
          const u = g.attributes.uv;
          for (let k = 8; k < 16; k++) u.setXY(k, 0.05, 0.05); // 屋上・底面は窓なし
          bin.add('building', g, trs(x + w / 2, cy + h / 2, z(dd)), walls[Math.floor(r() * walls.length)]);
          if (floors <= 3 && o.near) {
            // 住宅の屋根（色付きの薄い箱）
            bin.add('solid', box(w + 0.6, 0.7, dep + 0.6), trs(x + w / 2, cy + h + 0.35, z(dd)), roofs[Math.floor(r() * roofs.length)]);
          } else if (floors >= 6 && r() < 0.6) {
            bin.add('solid', box(w * 0.3, 2.4, dep * 0.3), trs(x + w / 2 + (r() - 0.5) * w * 0.4, cy + h + 1.2, z(dd)), 0xb8b6b0); // 屋上の塔屋
          }
        } else if (o.near && r() < 0.35) {
          // 公園・屋敷林の緑
          for (let k = 0; k < 3; k++) {
            const rr = 3 + r() * 4;
            bin.add('foliage', new THREE.IcosahedronGeometry(1, 1), trs(x + r() * w, cy + rr * 0.8, z(d + (r() - 0.5) * cell * 0.6), 0, r() * 6, 0, [rr, rr * 0.85, rr]), [0x4f7f45, 0x5f8f4c, 0x3f6f3d][k % 3]);
          }
        }
        x += w + 2 + r() * 4;
      }
    }
    this._addLayer(bin, W, o.near ? 'city-near' : 'city-far', xc);
  }

  /** 街の向こうに迫る緑の山並み。チャンク長 9 km のうち 2 か所に現れる（それ以外は平野） */
  _mountains(z, cy, xc, seed) {
    const W = 9000;
    const nx = 360;
    const rows = [1500, 1900, 2400, 3000, 3800];
    const prof = [0.04, 0.6, 1.0, 0.92, 0.6]; // 手前の裾 → 稜線 → 奥
    const ranges = [
      { c: 0.22, w: 0.22, h: 380 },
      { c: 0.68, w: 0.18, h: 310 },
    ];
    const n1 = periodicNoise(W, seed + 301, [[7, 0.22], [13, 0.14], [29, 0.07], [53, 0.03]]);
    const n2 = periodicNoise(W, seed + 302, [[11, 0.16], [23, 0.08], [41, 0.04]]);
    const env = (x) => {
      let e = 0;
      for (const R of ranges) {
        let dx = Math.abs(x / W - R.c);
        dx = Math.min(dx, 1 - dx); // 周期
        e = Math.max(e, R.h * Math.exp(-((dx / R.w) ** 2) * 2.2));
      }
      return e;
    };
    const cLow = new THREE.Color('#4f7a43');
    const cHigh = new THREE.Color('#2f5a33');
    const cRock = new THREE.Color('#5d6e52');
    const c = new THREE.Color();
    const vtx = [];
    for (let j = 0; j < rows.length; j++) {
      vtx.push([]);
      for (let i = 0; i <= nx; i++) {
        const x = (i / nx) * W;
        const e = env(x);
        const h = e > 1 ? e * prof[j] * (1 + n1(x) * 0.6 + (j % 2 ? n2(x) * 0.4 : 0)) : 0;
        const y = cy + Math.max(0, h) - (h > 1 ? 0 : 40); // 山の無い所は地面より下へ隠す
        const k = THREE.MathUtils.clamp(h / 400, 0, 1);
        c.copy(cLow).lerp(cHigh, k);
        if ((i * 7 + j * 3) % 11 === 0) c.lerp(cRock, 0.25);
        vtx[j].push([x, y, z(rows[j]), c.r, c.g, c.b]);
      }
    }
    const pos = [];
    const col = [];
    for (let j = 0; j < rows.length - 1; j++) {
      for (let i = 0; i < nx; i++) {
        const a = vtx[j][i];
        const b = vtx[j][i + 1];
        const d = vtx[j + 1][i];
        const e = vtx[j + 1][i + 1];
        for (const t of [a, d, b, b, d, e]) {
          pos.push(t[0], t[1], t[2]);
          col.push(t[3], t[4], t[5]);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    const L = new LoopLayer(g, this.mats.mountain, W, 'mountains');
    this.layers.push({ layer: L, xc });
    this.group.add(L.group);
  }

  /** 地平線のかすんだ山並み。常に見える */
  _ridge(s, z, cy, xc, seed) {
    const W = 40000;
    const nx = 500;
    const n = periodicNoise(W, seed + 401 + (s.facing > 0 ? 7 : 0), [[3, 0.35], [7, 0.25], [13, 0.2], [29, 0.12], [61, 0.06], [113, 0.03]]);
    const pos = [];
    const col = [];
    const d = 7000;
    const cTop = new THREE.Color('#7f93a8');
    const cBot = new THREE.Color('#9fb0c0');
    for (let i = 0; i < nx; i++) {
      const x0 = (i / nx) * W;
      const x1 = ((i + 1) / nx) * W;
      const h0 = cy + 260 + n(x0) * 300;
      const h1 = cy + 260 + n(x1) * 300;
      const b = cy - 60;
      const quad = [[x0, b, cBot], [x0, h0, cTop], [x1, b, cBot], [x1, b, cBot], [x0, h0, cTop], [x1, h1, cTop]];
      for (const [x, y, cc] of quad) {
        pos.push(x, y, z(d));
        col.push(cc.r, cc.g, cc.b);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    const L = new LoopLayer(g, this.mats.ridge, W, 'ridge');
    this.layers.push({ layer: L, xc });
    this.group.add(L.group);
  }

  /** 見た目（looks.js）を反映 */
  applyLook(L) {
    const pos = this.sky.geometry.attributes.position;
    const col = this.sky.geometry.attributes.color;
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const h = Math.max(0, pos.getY(i) / SCENERY.skyR);
      c.copy(L.skyHorizon).lerp(L.skyZenith, Math.pow(h, 0.5));
      col.setXYZ(i, c.r, c.g, c.b);
    }
    col.needsUpdate = true;
    this.mats.ground.color.copy(L.cityGround);
    this.mats.mountain.color.copy(L.mountainTint);
    this.mats.ridge.color.copy(L.ridgeTint);
    for (const cl of this.clouds) {
      cl.mesh.material.color.copy(L.cloud);
      cl.mesh.material.opacity = L.cloudOpacity;
    }
    this.speed = L.speed ?? this.speed;
  }

  /** QA・演出用：景色の位置を任意の距離へ（例：山の区間を確認） */
  seek(meters) {
    this.offset = meters;
    this.update(0);
  }

  update(dt) {
    this.offset += this.speed * dt * -TRAIN_DIR;
    for (const { layer, xc } of this.layers) layer.set(this.offset, xc);
    // 地面：テクスチャのオフセット（+X へ流れる → offset.x を減らす）
    const gt = this.mats.ground.map;
    gt.offset.x = (((-this.offset / gt.userData.tile) % 1) + 1) % 1;
    for (const cl of this.clouds) {
      const t = cl.mesh.material.map;
      // 板の向きで UV の向きが反転する（facing +1 は 180° 回している）
      t.offset.x = ((((cl.facing < 0 ? -1 : 1) * this.offset) / cl.tile) % 1 + 1) % 1;
    }
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.isMesh) o.geometry.dispose();
    });
    for (const m of Object.values(this.mats)) {
      m.map?.dispose();
      m.dispose();
    }
    for (const cl of this.clouds) {
      cl.mesh.material.map.dispose();
      cl.mesh.material.dispose();
    }
  }
}
