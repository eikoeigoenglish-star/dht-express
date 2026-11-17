/**
 * interior/scenerythemes.js — 【v15】車窓の景観テーマ（累積 km の scene → 左右の景色）
 * ---------------------------------------------------------------------------
 * 既存の車窓（scenery.js の WindowScenery：高架・街・ときどきの山・遠い山並み・雲・空）はそのままに、
 * 区間ごとの景観 preset（data/scenery/presets.json）に応じて「層」を出し入れする。
 *
 *   左右（進行方向に対して）… 左 = 左舷（facing +1・廊下側）、右 = 右舷（facing −1・個室の窓）
 *   近景〜中景の種類（left / right）… KIND_THEMES の組み合わせ（街・海・田園・山・工場…）
 *   遠景（*Background / *FarBackground）… 富士山・琵琶湖・比叡山系・桜島・半島・島影（動かない遠景）
 *   海の色（*Water: 'emerald'）… 島の手前のエメラルドグリーンの浅瀬
 *
 * 出し入れ：各層の presence（0〜1）を目標値へ約 1.2 秒で近づけ、0 側は地面の下へ沈める（不透明のまま。透明の並べ替えを増やさない）。
 *   presence 0 の層は visible = false（draw call なし・WindowScenery.cull も飛ばす）。
 *   区間の境界（± crossfadeKm/2）では sceneryplan.js の t で 2 つの preset の目標値を混ぜる。
 * 新しい層は「その景観が初めて必要になったとき」に作る（乗車時の構築時間・メモリを増やさない）。
 *
 * 時間帯（timeMode）とは独立：ここは「何が見えるか」だけ。光・空・夜景は looks.js（applyLook で色だけ合わせる）。
 */
import * as THREE from 'three';
import { box, PartBin, trs, rng } from './kit.js';
import { LoopLayer, periodicNoise, canvasTex } from './scenery.js';

/** 近景〜中景の種類 → 層（presence 1） */
export const KIND_THEMES = {
  default: { cityNear: 1, cityFar: 1, defMountains: 1, farLights: 1, ridge: 1 },
  urban: { cityNear: 1, cityFar: 1, towers: 1, farLights: 1, ridge: 1 },
  sea: { water: 1 },
  mountain: { green: 1, farmhouses: 1, hillsNear: 1, ridge: 1 },
  gentle_hills: { green: 1, farmhouses: 1, gentleHills: 1, ridge: 1 },
  fuji_foothills: { green: 1, cityNear: 1, pulpMill: 1, gentleHills: 1, farLights: 1 },
  lake_shore: { lakeWater: 1, shoreTown: 1, farLights: 1, ridge: 1 },
  mountain_fields: { green: 1, farmhouses: 1, hillsFar: 1, ridge: 1 },
  fields_plain: { green: 1, farmhouses: 1, ridge: 1 },
  mountain_plain: { green: 1, hillsFar: 1, ridge: 1 },
  plain_fields_residential: { green: 1, farmhouses: 1, cityFar: 1, farLights: 1, ridge: 1 },
  factory: { factory: 1, farLights: 1 },
};

/** 遠景 → 層 */
const BG_THEMES = {
  mt_fuji: ['bg:mt_fuji'],
  lake_biwa: ['bg:lake_biwa'],
  hiei_range: ['bg:hiei_range'],
  sea: ['farWater'],
  sakurajima_osumi: ['bg:sakurajima', 'bg:osumi'],
  osumi: ['bg:osumi'],
  satsuma: ['bg:satsuma'],
  island_amami: ['bg:island_amami'],
  island_tokunoshima: ['bg:island_tokunoshima'],
  island_okinoerabu: ['bg:island_okinoerabu'],
  island_yoron: ['bg:island_yoron'],
  island_okinawa: ['bg:island_okinawa'],
};

/** 島影：長さ L [m]・高さ H [m]・距離 d [m]・形（峰の数・平らさ） */
const ISLANDS = {
  island_amami: { L: 15000, H: 420, d: 7600, peaks: 5, flat: 0.15, seed: 11 },
  island_tokunoshima: { L: 9000, H: 430, d: 6600, peaks: 3, flat: 0.2, seed: 12 },
  island_okinoerabu: { L: 6400, H: 170, d: 5600, peaks: 2, flat: 0.55, seed: 13 },
  island_yoron: { L: 2600, H: 70, d: 4200, peaks: 1, flat: 0.7, seed: 14 },
  island_okinawa: { L: 20000, H: 380, d: 7800, peaks: 6, flat: 0.25, seed: 15 },
  osumi: { L: 22000, H: 520, d: 7200, peaks: 5, flat: 0.1, seed: 21 },
  satsuma: { L: 22000, H: 420, d: 7000, peaks: 4, flat: 0.2, seed: 22 },
};

const SINK = 1; // 沈める量の倍率
const FADE_S = 1.2; // 目標までの時間 [s]

export class SceneryThemes {
  /** @param {import('./scenery.js').WindowScenery} sc */
  constructor(sc) {
    this.sc = sc;
    this.cy = sc.cityY;
    this.offset = 0;
    this.sceneKey = null;
    // 共有のマテリアル（Lambert = 既存と同じ。時間帯の光は室内シーンのライトと applyLook の色で決まる）
    const fieldsTex = fieldsTexture();
    const waveTex = waterTexture();
    this.tex = { fields: fieldsTex, water: waveTex };
    this.mats = {
      water: new THREE.MeshLambertMaterial({ color: '#2d6e9c', map: waveTex }),
      emerald: new THREE.MeshLambertMaterial({ color: '#36c2b0', map: waveTex, transparent: true, opacity: 0.92, depthWrite: false }),
      green: new THREE.MeshLambertMaterial({ color: '#ffffff', map: fieldsTex }),
      hill: new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }),
      far: new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: false }), // 遠景（光を受けない。かすみ・時間帯は色で）
      snow: new THREE.MeshLambertMaterial({ vertexColors: true, fog: false }),
      factory: new THREE.MeshLambertMaterial({ vertexColors: true }),
    };
    this._look = null;
    // 舷ごとの層：name → { objs:[Object3D], presence, target, sink, built }
    for (const side of sc.sides) {
      side.items = new Map();
      for (const e of side.layers) {
        if (!e.theme) continue;
        let it = side.items.get(e.theme);
        if (!it) side.items.set(e.theme, (it = { objs: [], presence: 1, target: 1, sink: e.theme === 'ridge' ? 900 : 300 }));
        it.objs.push(e.layer.group);
      }
    }
    this.coverBoth = false;
  }

  /* ------------------------------------------------------------------ */
  /* 景観の指定                                                           */
  /* ------------------------------------------------------------------ */

  /**
   * sceneryplan.js の resolve(km) の結果を反映する。
   * @param {{ from: object, to: object, t: number, sceneId: string }} r
   * @param {{ instant?: boolean }} [opt] instant：フェードせずに切り替え（乗車直後）
   */
  setScene(r, opt = {}) {
    if (!r?.from) return;
    const key = `${r.from.id}>${r.to.id}@${r.t.toFixed(2)}`;
    if (key === this.sceneKey && !opt.instant) return;
    this.sceneKey = key;
    this.scene = r;
    for (const side of this.sc.sides) {
      const which = side.facing < 0 ? 'right' : 'left';
      const a = this._targets(r.from, which);
      const b = this._targets(r.to, which);
      const names = new Set([...side.items.keys(), ...Object.keys(a), ...Object.keys(b)]);
      for (const n of names) {
        const v = (a[n] ?? 0) * (1 - r.t) + (b[n] ?? 0) * r.t;
        let it = side.items.get(n);
        if (!it && v > 0) it = this._build(side, n);
        if (!it) continue;
        it.target = v;
        if (opt.instant) it.presence = v;
      }
    }
    if (opt.instant) this.update(0);
  }

  /** preset の片側 → { 層: presence } */
  _targets(p, which) {
    const out = { ...(KIND_THEMES[p[which]] ?? KIND_THEMES.default) };
    for (const k of [p[`${which}Background`], p[`${which}FarBackground`]]) {
      if (!k) continue;
      for (const n of BG_THEMES[k] ?? []) out[n] = 1;
      if (p[`${which}Water`] === 'emerald' && k.startsWith('island_')) out[`emerald:${k}`] = 1;
    }
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* 毎フレーム                                                           */
  /* ------------------------------------------------------------------ */

  update(dt) {
    const sc = this.sc;
    const k = dt > 0 ? Math.min(1, dt / FADE_S) : 0;
    let cover = 0;
    for (const side of sc.sides) {
      let sideCover = 0;
      for (const [name, it] of side.items) {
        if (it.presence !== it.target) {
          const d = it.target - it.presence;
          it.presence = Math.abs(d) <= k ? it.target : it.presence + Math.sign(d) * k;
        }
        const p = it.presence;
        const vis = p > 0.002;
        const y = -(1 - smooth(p)) * it.sink * SINK;
        for (const o of it.objs) {
          o.visible = vis;
          o.position.y = (o.userData.baseY ?? 0) + y;
        }
        if ((name === 'water' || name === 'green') && p >= 0.999) sideCover = 1;
      }
      cover += sideCover;
    }
    // 両舷とも海・田園で覆われているときは街の地面（共有の 1 枚）を描かない
    const both = cover >= sc.sides.length;
    if (both !== this.coverBoth) {
      this.coverBoth = both;
      sc.ground.visible = !both;
    }
    // 水面・田園を列車の速さで流す（WindowScenery の offset と同じ）
    const off = sc.offset;
    this.tex.water.offset.x = (((-off / this.tex.water.userData.tile) % 1) + 1) % 1;
    this.tex.fields.offset.x = (((-off / this.tex.fields.userData.tile) % 1) + 1) % 1;
    // 新しく作った流れる層（LoopLayer）は WindowScenery.update が side.layers 経由で動かす
  }

  /** 時間帯の色（looks.js の値）を新しい層へ */
  applyLook(L) {
    this._look = L;
    const M = this.mats;
    const night = 1 - Math.min(1, L.sun / 2.1); // 0 = 昼 … 1 = 夜
    M.water.color.set('#2d6e9c').lerp(L.haze, 0.18).multiply(L.mountainTint);
    M.emerald.color.set('#42d6bd').multiply(L.mountainTint);
    // 水面は空の色を少し映す（夕方・夜に真っ黒にならないように）
    M.water.emissive.copy(L.skyHorizon).multiplyScalar(0.06 + 0.16 * night);
    M.emerald.emissive.copy(L.skyHorizon).multiplyScalar(0.05 + 0.1 * night);
    M.green.color.copy(L.mountainTint);
    M.hill.color.copy(L.mountainTint);
    M.factory.color.copy(L.buildingTint);
    // 遠景は fog を使わないので、空気遠近（かすみの色へ寄せる）を色で付ける
    const far = new THREE.Color(L.ridgeTint).lerp(L.haze, 0.35 + 0.15 * (1 - night));
    M.far.color.copy(far);
    M.snow.color.copy(far);
  }

  dispose() {
    for (const m of Object.values(this.mats)) m.dispose();
    for (const t of Object.values(this.tex)) t.dispose();
  }

  /* ------------------------------------------------------------------ */
  /* 層を作る（必要になったときだけ）                                        */
  /* ------------------------------------------------------------------ */

  _build(side, name) {
    const s = side.spec;
    const f = s.facing;
    const z = (d) => s.z0 + f * d;
    const xc = s.xc ?? 0;
    const cy = this.cy;
    const lite = !!s.lite;
    const sc = this.sc;
    const it = { objs: [], presence: 0, target: 0, sink: 300 };
    const root = sc.group;
    sc.group = side.group; // _addLayer は sc.group へ追加する
    const a = sc.layers.length;
    const seed = (f > 0 ? 500 : 0) + 7;
    try {
      if (name === 'water') it.objs.push(this._plane(side, 'water', -10, 14000, f < 0 ? 1.5 : 1.6));
      else if (name === 'lakeWater') it.objs.push(this._plane(side, 'water', -10, 1150, f < 0 ? 1.5 : 1.6));
      else if (name === 'farWater') it.objs.push(this._plane(side, 'water', 1100, 14000, 2.0));
      else if (name === 'green') it.objs.push(this._plane(side, 'green', -10, 9000, f < 0 ? 1.2 : 1.3));
      else if (name === 'shoreTown') sc._city(s, rng(seed * 3 + 1), { d0: 1180, d1: 1900, W: sc._W(1900, s), density: lite ? 0.6 : 0.85, near: false }, z, cy, xc); // 湖の対岸の住宅
      else if (name === 'towers') this._towers(s, z, cy, xc, seed, lite);
      else if (name === 'farmhouses') this._farmhouses(s, z, cy, xc, seed, lite);
      else if (name === 'hillsNear') this._hills(z, cy, xc, seed + 1, [260, 520, 900, 1500, 2400], 520, 0.75);
      else if (name === 'hillsFar') this._hills(z, cy, xc, seed + 2, [1500, 1900, 2500, 3200, 4200], 430, 0.6);
      else if (name === 'gentleHills') this._hills(z, cy, xc, seed + 3, [500, 900, 1500, 2300, 3200], 190, 0.5);
      else if (name === 'factory') this._factory(s, z, cy, xc, seed, lite, false);
      else if (name === 'pulpMill') this._factory(s, z, cy, xc, seed + 9, lite, true);
      else if (name === 'bg:mt_fuji') it.objs.push(this._cone(z, cy, xc, { d: 8200, H: 1150, R: 3300, snow: 0.3, seed: 31 }));
      else if (name === 'bg:sakurajima') it.objs.push(this._cone(z, cy, xc - 1500, { d: 4200, H: 620, R: 2400, snow: 0, seed: 32, ash: true }));
      else if (name === 'bg:hiei_range') it.objs.push(this._island(z, cy, xc, { L: 26000, H: 700, d: 6100, peaks: 5, flat: 0.05, seed: 41 }, false));
      else if (name === 'bg:lake_biwa') it.objs.push(this._plane(side, 'water', 2600, 5600, 2.0));
      else if (name.startsWith('bg:')) {
        const k = name.slice(3);
        const spec = ISLANDS[k];
        if (spec) it.objs.push(this._island(z, cy, xc, spec, true));
      } else if (name.startsWith('emerald:')) {
        const spec = ISLANDS[name.slice(8)];
        if (spec) it.objs.push(this._emerald(z, cy, xc, spec));
      } else {
        return null;
      }
    } finally {
      sc.group = root;
    }
    // 新しい LoopLayer（流れる層）は side.layers に加え、WindowScenery の update / cull に乗せる
    for (let i = a; i < sc.layers.length; i++) {
      const e = sc.layers[i];
      e.theme = name;
      side.layers.push(e);
      it.objs.push(e.layer.group);
    }
    // 沈める量：平面は少しだけ（地面の下へ）、山・遠景は高さぶん
    it.sink = name.startsWith('bg:') ? 2600 : name.startsWith('hills') || name === 'gentleHills' ? 700 : name === 'towers' ? 260 : name.includes('ater') || name === 'green' || name.startsWith('emerald') ? 6 : 120;
    for (const o of it.objs) {
      o.visible = false;
      o.userData.baseY = o.position.y; // 平面・遠景は作った高さから沈める（LoopLayer の group は 0）
    }
    side.items.set(name, it);
    return it;
  }

  /** 片側の地面を覆う平面（海・湖・田園）。UV はメートル（テクスチャを流す） */
  _plane(side, kind, d0, d1, lift) {
    const s = side.spec;
    const len = 30000;
    const dep = d1 - d0;
    const g = new THREE.PlaneGeometry(len, dep, 1, 1);
    g.rotateX(-Math.PI / 2);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * len, uv.getY(i) * dep);
    const m = new THREE.Mesh(g, this.mats[kind]);
    m.position.set(s.xc ?? 0, this.cy + lift, s.z0 + s.facing * (d0 + dep / 2));
    m.name = `theme-${kind}`;
    m.renderOrder = -1;
    side.group.add(m);
    return m;
  }

  /** 都心：高層ビル（d 300〜1600 m）。既存の窓テクスチャのビルと同じマテリアル */
  _towers(s, z, cy, xc, seed, lite) {
    const sc = this.sc;
    const W = sc._W(1600, s);
    const r = rng(seed * 13 + 3);
    const bin = new PartBin();
    const walls = [0xdfe5ea, 0xc8d2da, 0xb9c4ce, 0xe8e4dc, 0xa9b6c2, 0xd0d6d8];
    const n = lite ? 70 : 120;
    for (let i = 0; i < n; i++) {
      const x = r() * W;
      const d = 300 + Math.pow(r(), 0.8) * 1300;
      const w = 22 + r() * 30;
      const dep = 22 + r() * 30;
      const h = (18 + Math.floor(r() * 40)) * 3.6;
      const g = box(w, h, dep);
      const u = g.attributes.uv;
      for (let k = 8; k < 16; k++) u.setXY(k, 0.05, 0.05);
      bin.add('building', g, trs(x, cy + h / 2, z(d)), walls[Math.floor(r() * walls.length)]);
      if (r() < 0.5) bin.add('solid', box(w * 0.4, 6, dep * 0.4), trs(x, cy + h + 3, z(d)), 0xb0b4b8);
      for (const [ox, oz] of [[-1, -1], [1, 1]]) bin.add('beacon', box(1.4, 1.4, 1.4), trs(x + ox * (w / 2 - 1), cy + h + 0.9, z(d) + oz * (dep / 2 - 1)));
    }
    sc._addLayer(bin, W, 'towers', s.xc ?? 0);
  }

  /** 田園の家並み・屋敷林（d 30〜1300 m、まばら） */
  _farmhouses(s, z, cy, xc, seed, lite) {
    const sc = this.sc;
    const W = sc._W(1300, s);
    const r = rng(seed * 17 + 5);
    const bin = new PartBin();
    const walls = [0xf0eee8, 0xe4e1da, 0xd9d0c2, 0xcfc8bb];
    const roofs = [0x5b6168, 0x4f5f70, 0x7a5a4c, 0x6b6b66];
    const clusters = lite ? 26 : 40;
    for (let c = 0; c < clusters; c++) {
      const cx = r() * W;
      const cd = 40 + Math.pow(r(), 1.3) * 1250;
      const k = 2 + Math.floor(r() * 6);
      for (let i = 0; i < k; i++) {
        const x = cx + (r() - 0.5) * 70;
        const d = cd + (r() - 0.5) * 50;
        const w = 8 + r() * 6;
        const dep = 7 + r() * 5;
        const h = 3 * (1 + Math.floor(r() * 2));
        const g = box(w, h, dep);
        const u = g.attributes.uv;
        for (let q = 8; q < 16; q++) u.setXY(q, 0.05, 0.05);
        bin.add('building', g, trs(x, cy + h / 2, z(d)), walls[Math.floor(r() * walls.length)]);
        bin.add('solid', box(w + 0.8, 1.2, dep + 0.8), trs(x, cy + h + 0.6, z(d)), roofs[Math.floor(r() * roofs.length)]);
      }
      // 屋敷林
      for (let t = 0; t < 3; t++) {
        const rr = 4 + r() * 5;
        bin.add('foliage', new THREE.IcosahedronGeometry(1, 1), trs(cx + (r() - 0.5) * 80, cy + rr * 0.8, z(cd + 25 + r() * 20), 0, r() * 6, 0, [rr, rr * 0.85, rr]), [0x3f6f3d, 0x4f7f45][t % 2]);
      }
    }
    sc._addLayer(bin, W, 'farmhouses', s.xc ?? 0);
  }

  /** 連なる山（rows = 手前 → 奥の距離、H = 稜線の高さ）。周期 9 km でつながる */
  _hills(z, cy, xc, seed, rows, H, rough) {
    const W = 9000;
    const nx = 300;
    const prof = [0.05, 0.55, 1.0, 0.9, 0.7];
    const n1 = periodicNoise(W, seed + 301, [[3, 0.3], [7, 0.22], [13, 0.14], [29, 0.07], [53, 0.03]]);
    const n2 = periodicNoise(W, seed + 302, [[5, 0.2], [11, 0.12], [23, 0.06]]);
    const cLow = new THREE.Color('#5a8a4a');
    const cHigh = new THREE.Color('#2f5a33');
    const c = new THREE.Color();
    const vtx = [];
    for (let j = 0; j < rows.length; j++) {
      vtx.push([]);
      for (let i = 0; i <= nx; i++) {
        const x = (i / nx) * W;
        const h = Math.max(0, H * prof[j] * (0.72 + rough * 0.5 * n1(x) + (j % 2 ? 0.3 * n2(x) : 0)));
        c.copy(cLow).lerp(cHigh, Math.min(1, h / (H * 1.1)));
        vtx[j].push([x, cy + h - (j === 0 ? 2 : 0), z(rows[j]), c.r, c.g, c.b]);
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
    const L = new LoopLayer(g, this.mats.hill, W, 'theme-hills', { reach: this.sc.reach });
    this.sc.layers.push({ layer: L, xc });
    this.sc.group.add(L.group);
  }

  /** 工場群（倉庫・タンク・煙突・配管）。pulp = 富士のパルプ工場（煙突を高く、まばらに） */
  _factory(s, z, cy, xc, seed, lite, pulp) {
    const sc = this.sc;
    const d1 = pulp ? 1400 : 950;
    const W = sc._W(d1, s);
    const r = rng(seed * 23 + (pulp ? 7 : 1));
    const bin = new PartBin();
    const sheds = [0xc9ccce, 0xb8c0c6, 0xd9d6cf, 0x9fb0bd, 0xe2e2dc];
    const n = pulp ? (lite ? 6 : 9) : lite ? 22 : 34;
    for (let i = 0; i < n; i++) {
      const x = r() * W;
      const d = (pulp ? 500 : 60) + r() * (d1 - (pulp ? 500 : 60));
      const w = 40 + r() * 70;
      const dep = 30 + r() * 50;
      const h = 10 + r() * 16;
      bin.add('factory', box(w, h, dep), trs(x, cy + h / 2, z(d)), sheds[Math.floor(r() * sheds.length)]);
      bin.add('factory', box(w + 1, 1.5, dep + 1), trs(x, cy + h + 0.7, z(d)), 0x6f7f8c);
      // タンク
      if (r() < 0.6) {
        const tr = 9 + r() * 10;
        const th = 10 + r() * 14;
        const g = new THREE.CylinderGeometry(tr, tr, th, 16);
        bin.add('factory', g, trs(x + w / 2 + tr + 6, cy + th / 2, z(d + (r() - 0.5) * 20)), 0xe9ebe8);
      }
      // 煙突（紅白）
      if (r() < (pulp ? 0.9 : 0.45)) {
        const ch = pulp ? 90 + r() * 60 : 45 + r() * 50;
        const cr = pulp ? 3.4 : 2.2;
        const seg = 6;
        for (let k = 0; k < seg; k++) {
          const g = new THREE.CylinderGeometry(cr * (1 - 0.04 * (k + 1)), cr * (1 - 0.04 * k), ch / seg, 10);
          bin.add('factory', g, trs(x - w / 3, cy + (k + 0.5) * (ch / seg), z(d)), k % 2 ? 0xffffff : 0xd8452f);
        }
        bin.add('beacon', box(1.4, 1.4, 1.4), trs(x - w / 3, cy + ch + 0.8, z(d)));
      }
      // 配管ラック
      if (!pulp && r() < 0.4) bin.add('factory', box(w * 0.9, 1.2, 2), trs(x, cy + 7, z(d - dep / 2 - 6)), 0x8a8f94);
    }
    sc.mats.factory = this.mats.factory;
    sc._addLayer(bin, W, pulp ? 'pulp-mill' : 'factory', s.xc ?? 0);
  }

  /** 円錐の山（富士山・桜島）。動かない遠景 */
  _cone(z, cy, xc, o) {
    const pts = [];
    const N = 24;
    for (let i = 0; i <= N; i++) {
      const t = i / N; // 0 = 頂上 → 1 = 裾
      const rr = o.R * (0.06 + 0.94 * Math.pow(t, 1.65));
      const y = o.H * (1 - t);
      pts.push(new THREE.Vector2(rr, y));
    }
    pts.push(new THREE.Vector2(o.R * 1.05, -30));
    pts.reverse();
    const g = new THREE.LatheGeometry(pts, 48);
    const pos = g.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const r = rng(o.seed);
    const base = new THREE.Color(o.ash ? '#5c6a5e' : '#5d7390');
    const top = new THREE.Color(o.ash ? '#7c7a72' : '#6d82a0');
    const snow = new THREE.Color('#f4f7fb');
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const h = pos.getY(i) / o.H;
      c.copy(base).lerp(top, Math.max(0, h));
      if (o.snow > 0) {
        const edge = 1 - o.snow + 0.05 * Math.sin(Math.atan2(pos.getZ(i), pos.getX(i)) * 9 + r() * 0.5);
        if (h > edge) c.copy(snow);
      }
      col.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, this.mats.snow);
    m.position.set(xc, cy, z(o.d));
    m.scale.set(1, 1, 0.8);
    m.name = 'theme-cone';
    m.renderOrder = -3;
    this.sc.group.add(m);
    return m;
  }

  /** 島影・半島・山系（長さ L、峰の数 peaks の稜線）。前面と奥の 2 列でゆるい立体に。動かない遠景 */
  _island(z, cy, xc, o, isIsland) {
    const nx = 160;
    const n = periodicNoise(1, o.seed, [[3, 0.3], [7, 0.2], [13, 0.12], [29, 0.06]]);
    const env = (u) => {
      // 両端を海へ落とす（島）／半島・山系はゆるく
      const e = isIsland ? Math.pow(Math.sin(Math.PI * u), o.flat > 0.5 ? 0.25 : 0.55) : Math.pow(Math.sin(Math.PI * u), 0.3);
      let p = 0;
      for (let k = 0; k < o.peaks; k++) {
        const c = (k + 0.5) / o.peaks;
        p = Math.max(p, Math.exp(-(((u - c) / (0.6 / o.peaks)) ** 2)));
      }
      return e * (o.flat + (1 - o.flat) * p);
    };
    const rows = [0, 0.12];
    const cTop = new THREE.Color('#47604f');
    const cBot = new THREE.Color('#6f8a84');
    const pos = [];
    const col = [];
    const v = [];
    for (let j = 0; j < rows.length; j++) {
      v.push([]);
      for (let i = 0; i <= nx; i++) {
        const u = i / nx;
        const h = Math.max(0, o.H * env(u) * (0.85 + 0.3 * n(u)) * (j ? 0.92 : 1));
        v[j].push([xc + (u - 0.5) * o.L, cy + h, z(o.d + rows[j] * o.L * 0.25), h]);
      }
    }
    const push = (p, c) => {
      pos.push(p[0], p[1], p[2]);
      col.push(c.r, c.g, c.b);
    };
    const c = new THREE.Color();
    for (let i = 0; i < nx; i++) {
      // 前面（水面から稜線まで）
      const a = v[0][i];
      const b = v[0][i + 1];
      const lowA = [a[0], cy - 4, a[2]];
      const lowB = [b[0], cy - 4, b[2]];
      for (const [p, isTop] of [[lowA, 0], [a, 1], [lowB, 0], [lowB, 0], [a, 1], [b, 1]]) push(p, isTop ? c.copy(cBot).lerp(cTop, Math.min(1, p[1] - cy > 0 ? (p[1] - cy) / (o.H * 0.7) : 0)) : cBot);
      // 稜線から奥へ（上面）
      const d = v[1][i];
      const e = v[1][i + 1];
      for (const p of [a, d, b, b, d, e]) push(p, cTop);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, this.mats.far);
    m.name = 'theme-island';
    m.renderOrder = -3;
    this.sc.group.add(m);
    return m;
  }

  /** 島の手前のエメラルドグリーンの浅瀬（水面の少し上の半透明の帯） */
  _emerald(z, cy, xc, o) {
    const len = o.L * 1.15;
    const dep = Math.min(4800, o.d * 0.62);
    const g = new THREE.PlaneGeometry(len, dep, 1, 1);
    g.rotateX(-Math.PI / 2);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * len, uv.getY(i) * dep);
    const m = new THREE.Mesh(g, this.mats.emerald);
    m.position.set(xc, cy + 1.9, z(o.d - dep / 2 + 60));
    m.name = 'theme-emerald';
    this.sc.group.add(m);
    return m;
  }
}

const smooth = (t) => t * t * (3 - 2 * t);

/** 田園（田んぼ・畑の区画とあぜ道）。1 タイル = 420 m */
function fieldsTexture() {
  return canvasTex(512, 512, (g, S) => {
    const r = rng(9091);
    g.fillStyle = '#7fa35a';
    g.fillRect(0, 0, S, S);
    const greens = ['#8fb35e', '#7aa653', '#9cbf6a', '#6f9a4c', '#a7c47a', '#86ac58', '#b0b87a'];
    let y = 0;
    while (y < S) {
      const h = 18 + Math.floor(r() * 26);
      let x = 0;
      while (x < S) {
        const w = 22 + Math.floor(r() * 40);
        g.fillStyle = greens[Math.floor(r() * greens.length)];
        g.fillRect(x, y, w, h);
        g.fillStyle = 'rgba(70, 60, 40, 0.35)'; // あぜ道
        g.fillRect(x, y, w, 1.5);
        g.fillRect(x, y, 1.5, h);
        x += w;
      }
      y += h;
    }
    // ところどころの農道・水路
    g.fillStyle = 'rgba(210, 200, 170, 0.6)';
    for (let k = 0; k < 4; k++) g.fillRect(0, Math.floor(r() * S), S, 3);
    g.fillStyle = 'rgba(90, 130, 160, 0.5)';
    for (let k = 0; k < 2; k++) g.fillRect(Math.floor(r() * S), 0, 2, S);
  }, { tile: 420 });
}

/** 水面のさざ波（白地に淡い濃淡。material.color で海・湖・浅瀬の色を付ける）。1 タイル = 160 m */
function waterTexture() {
  return canvasTex(256, 256, (g, S) => {
    const r = rng(4242);
    g.fillStyle = '#e6edf2';
    g.fillRect(0, 0, S, S);
    for (let i = 0; i < 900; i++) {
      const x = r() * S;
      const y = r() * S;
      const w = 6 + r() * 22;
      g.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.55)' : 'rgba(120,140,160,0.18)';
      g.fillRect(x, y, w, 1 + r() * 1.2);
    }
  }, { tile: 160 });
}
