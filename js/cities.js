/**
 * cities.js — 人口10万人以上の都市を「都市クラスター」として表示する
 * ---------------------------------------------------------------------------
 * 3 段の見え方
 *   遠景  : 地形の頂点色を灰色寄りにした「市街地の色」（terrain.js の setUrbanField）
 *           → draw call・三角形の追加ゼロ。全体俯瞰でも都市の広がりが分かる。
 *   中景  : 高い建物から順に一部だけ描く（InstancedMesh.count を距離で減らす）
 *           → 遠くからは超高層の核（スカイライン）だけが見える。
 *   近景  : チャンク内の全建物（低層の街区まで）
 *
 * データ構造
 *   ・建物の生成は 64km チャンク（地形と同じ区切り）単位、表示は 32km タイルごとに 1 つの InstancedMesh。
 *     geometry（底なしの単位直方体）と material（Lambert 1 枚）は全チャンクで共有。
 *   ・インスタンスは「高い順」に並べてあるので、count を減らすだけで距離 LOD になる。
 *   ・チャンクはカメラが近づいたときに、地形の詳細標高（1km）を読み込んでから生成する。
 *     生成は 1 フレームあたり数ミリ秒に分割（カクつき防止）。
 *   ・タイルごとに boundingSphere があり frustum culling が効く。
 *
 * 配置のルール
 *   ・全国共通の 0.37km 格子。各セルは「その地点で最も影響の強い都市」が担当（重複生成なし）
 *   ・都市中心（と副都心 cores）からの距離で密度・高さが下がる。輪郭は値ノイズで不規則に。
 *   ・海（標高 ≦ 0.5m）・海岸線際・急斜面には建てない。底面は斜面の低い側に合わせ、
 *     地中へ基礎を伸ばして浮きを防ぐ。
 *   ・ランドマークと駅の周囲は建てない（exclusions）。
 *   ・v3: 湖面・川面と岸の近く（WATER_MARGIN）には建てない（setWaterMask ← js/water.js）。
 *
 * 将来の参照
 *   ・this.cities[i] … {id, name, rank, lat, lon, x, z, r, pop, ...}
 *   ・タイル mesh.userData = { kind:'city-buildings', tile, cityOf: Uint16Array }
 *     Raycaster で instanceId が取れたら cities[cityOf[instanceId]] でどの都市か分かる。
 */
import * as THREE from 'three';
import { latLonToWorld, VERTICAL_EXAGGERATION } from './geo.js';
import { hash2i, hashString, valueNoise } from './meshkit.js';

const M2Y = VERTICAL_EXAGGERATION / 1000;
const CELL = 0.37; // km  建物格子
const TILE = 32; // km  表示タイル（地形チャンク 64km を 2×2 に分割して距離 LOD を細かくする）
const BUCKET = 32; // km  都市検索用バケット
const FOUNDATION = 0.12; // world units 地中へ伸ばす基礎
const WATER_MARGIN = 0.22; // km  v3: 水際からこの距離以内のセルには建てない

// 距離 LOD [km]（カメラからチャンク境界箱までの 3D 距離）
const LOD_FULL = 14; // これより近いと全建物
const LOD_HIDE = 320; // これより遠いと非表示（地形の市街地色だけ）
const LOD_PREPARE = 300; // これより近いチャンクは生成を始める
const GEN_BUDGET_MS = 5; // 1 フレームの生成予算

/** ランク別の街のつくり（高さは実際の m。表示時に地形と同じ縦倍率をかける） */
const RANK = {
  metro: { rMul: 1.0, tallM: 210, midM: 45, baseM: 13, coreR: 0.11, labelDist: 3400, prio: 4.6 },
  major: { rMul: 1.0, tallM: 120, midM: 30, baseM: 11, coreR: 0.2, labelDist: 900, prio: 3.4 },
  city: { rMul: 1.0, tallM: 55, midM: 18, baseM: 9, coreR: 0.24, labelDist: 170, prio: 2.1 },
};

const PALETTE_LOW = ['#d8d3c8', '#cdc6b9', '#c2bcb1', '#e2ddd3', '#c9c3b8', '#b9b4ab', '#d4cdc0', '#bdb3a4'];
const PALETTE_MID = ['#c9cdd2', '#b7bdc4', '#d3d4d4', '#c2c0ba', '#aeb5bd'];
const PALETTE_TALL = ['#8ea6be', '#9cb2c6', '#7c92aa', '#b7c3ce', '#a4b0bb', '#cfd5da'];

const smooth = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** 人口 → 市街地の代表半径 [km]（10万→2.4km, 100万→6.8km, 東京23区→17km） */
function radiusFromPop(pop) {
  return 2.4 * Math.pow(pop / 100000, 0.45);
}

export class CitySystem {
  constructor(terrain) {
    this.terrain = terrain;
    this.group = new THREE.Group();
    this.group.name = 'cities';
    this.cities = [];
    this.chunks = []; // 生成単位 {cx, cz, key, minX..., cities[], state}
    this.tiles = []; // 表示単位 {key, minX..., mesh, total, maxY}
    this.exclusions = [];
    this.waterMask = null; // v3: (x, z, margin) => boolean（js/water.js の isWater）
    this.genQueue = [];
    this.gen = null;
    this.visible = true;
    this.stats = { chunks: 0, tiles: 0, chunksVisible: 0, instancesDrawn: 0, instancesTotal: 0 };

    // 共有ジオメトリ：底面なしの単位直方体（x,z: -0.5..0.5 / y: 0..1）。
    // 頂点色で屋上をやや暗く、壁の足元を少し暗く（簡易 AO）。
    const box = new THREE.BoxGeometry(1, 1, 1);
    box.translate(0, 0.5, 0);
    const idx = Array.from(box.index.array);
    idx.splice(18, 6); // -Y 面（底）を除去 → 10 三角形
    box.setIndex(idx);
    const pos = box.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const nor = box.attributes.normal;
    for (let i = 0; i < pos.count; i++) {
      const top = nor.getY(i) > 0.5;
      const v = top ? 0.82 : pos.getY(i) < 0.5 ? 0.78 : 1.0;
      col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = v;
    }
    box.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.geometry = box;
    this.material = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
    this.material.name = 'city-buildings-shared';
  }

  async load(url) {
    const json = await (await fetch(url)).json();
    this.meta = json;
    this.cities = json.cities.map((c, i) => {
      const w = latLonToWorld(c.lat, c.lon);
      const rk = RANK[c.rank] ?? RANK.city;
      const r = radiusFromPop(c.pop) * rk.rMul;
      const cores = (c.cores ?? [[c.lat, c.lon, 1]]).map(([la, lo, wgt]) => {
        const p = latLonToWorld(la, lo);
        return { x: p.x, z: p.z, w: wgt };
      });
      // 中小都市でも人口に応じて核の高さを少し変える
      const tallM = c.rank === 'city' ? rk.tallM * (0.75 + 0.35 * Math.min(1, (c.pop - 100000) / 400000)) : rk.tallM;
      return {
        ...c,
        index: i,
        x: w.x,
        z: w.z,
        r,
        reach: r * 1.7 + 1,
        reach2: (r * 1.7 + 1) ** 2,
        coreR: Math.max(c.rank === 'metro' ? 1.1 : 0.7, r * rk.coreR),
        cores,
        tallM: tallM * (c.heightScale ?? 1),
        midM: rk.midM * (c.heightScale ?? 1),
        baseM: rk.baseM,
        seed: hashString(c.id),
        angle: ((hashString(c.id + ':a') % 1000) / 1000) * (Math.PI / 2),
      };
    });
    this._buildBuckets();
    return this;
  }

  /* ------------------------------------------------------------------ */
  /* 密度フィールド                                                        */
  /* ------------------------------------------------------------------ */

  _buildBuckets() {
    this.bx0 = -1100;
    this.bz0 = -900;
    this.bnx = Math.ceil(2200 / BUCKET);
    this.bnz = Math.ceil(1900 / BUCKET);
    this.buckets = Array.from({ length: this.bnx * this.bnz }, () => []);
    for (const c of this.cities) {
      const i0 = Math.max(0, Math.floor((c.x - c.reach - this.bx0) / BUCKET));
      const i1 = Math.min(this.bnx - 1, Math.floor((c.x + c.reach - this.bx0) / BUCKET));
      const j0 = Math.max(0, Math.floor((c.z - c.reach - this.bz0) / BUCKET));
      const j1 = Math.min(this.bnz - 1, Math.floor((c.z + c.reach - this.bz0) / BUCKET));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) this.buckets[j * this.bnx + i].push(c);
    }
  }

  _bucketAt(x, z) {
    const i = Math.floor((x - this.bx0) / BUCKET);
    const j = Math.floor((z - this.bz0) / BUCKET);
    if (i < 0 || j < 0 || i >= this.bnx || j >= this.bnz) return null;
    return this.buckets[j * this.bnx + i];
  }

  /** 輪郭を不規則にする値ノイズ 0..1（全都市共通。1 地点 1 回だけ計算する） */
  _noise(x, z) {
    return valueNoise(x / 2.6, z / 2.6, 7);
  }

  /** 都市 c の (x, z) における市街地密度 0..1 と 核の強さ 0..1（n = _noise(x, z)） */
  _cityField(c, x, z, out, n) {
    const dx = x - c.x;
    const dz = z - c.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > c.reach2) {
      out.d = 0;
      out.core = 0;
      return out;
    }
    let dens = Math.exp(-(d2 / (c.r * c.r)) * 1.25) * (0.5 + 0.95 * n);
    let core = 0;
    const cr2 = c.coreR * c.coreR;
    for (const k of c.cores) {
      const ex = x - k.x;
      const ez = z - k.z;
      const e2 = ex * ex + ez * ez;
      if (e2 > cr2 * 9) continue; // 核から 3 半径以上離れたら影響なし
      const v = k.w * Math.exp(-e2 / cr2);
      if (v > core) core = v;
    }
    dens = Math.max(dens, core * 0.95);
    out.d = dens > 1 ? 1 : dens;
    out.core = core;
    return out;
  }

  /** 地形の色付け用：その地点の市街地らしさ 0..1（最も強い都市の値） */
  densityAt(x, z) {
    const b = this._bucketAt(x, z);
    if (!b || !b.length) return 0;
    let best = 0;
    let n = -1;
    for (const c of b) {
      const dx = x - c.x;
      const dz = z - c.z;
      if (dx * dx + dz * dz > c.reach2) continue;
      if (n < 0) n = this._noise(x, z);
      this._cityField(c, x, z, _f, n);
      if (_f.d > best) best = _f.d;
    }
    // 生成時に建物が建ち始める密度(≈0.1)から色を付け始める
    return smooth(0.1, 0.75, best);
  }

  /** v3: 湖面・川面・河岸のごく近傍には建てない（海岸・急斜面の判定と同じ考え方） */
  setWaterMask(fn) {
    this.waterMask = fn;
  }

  /** ランドマーク・駅の周囲には建てない。{x, z, r} の配列 */
  addExclusions(list) {
    this.exclusions.push(...list);
  }

  setVisible(v) {
    this.visible = v;
    this.group.visible = v;
  }

  /* ------------------------------------------------------------------ */
  /* チャンク                                                              */
  /* ------------------------------------------------------------------ */

  /** terrain.init() 後に呼ぶ：都市を含む 64km チャンクの一覧を作る */
  prepareChunks() {
    const t = this.terrain;
    const map = new Map();
    for (const c of this.cities) {
      const a = t.chunkOf(c.x - c.reach, c.z - c.reach);
      const b = t.chunkOf(c.x + c.reach, c.z + c.reach);
      for (let cz = a.cz; cz <= b.cz; cz++)
        for (let cx = a.cx; cx <= b.cx; cx++) {
          const key = `${cx}_${cz}`;
          let ch = map.get(key);
          if (!ch) {
            const minX = t.x0 + cx * t.chunk;
            const minZ = t.z0 + cz * t.chunk;
            ch = { cx, cz, key, minX, minZ, maxX: minX + t.chunk, maxZ: minZ + t.chunk, cities: [], state: 'idle', maxY: 1 };
            map.set(key, ch);
          }
          ch.cities.push(c);
        }
    }
    this.chunks = [...map.values()];
    this.stats.chunks = this.chunks.length;
  }

  update(camera) {
    const p = camera.position;
    const boxDist = (o) => {
      const dx = Math.max(o.minX - p.x, 0, p.x - o.maxX);
      const dz = Math.max(o.minZ - p.z, 0, p.z - o.maxZ);
      const dy = Math.max(0, p.y - o.maxY);
      return Math.sqrt(dx * dx + dz * dz + dy * dy);
    };
    for (const ch of this.chunks) {
      if (ch.state !== 'idle' && ch.state !== 'queued') continue;
      ch.dist = boxDist(ch);
      if (ch.state === 'idle' && ch.dist < LOD_PREPARE) {
        ch.state = 'loading';
        this.terrain.requestChunkData(ch.cx, ch.cz, ch.dist).then(() => {
          ch.state = 'queued';
          this.genQueue.push(ch);
        });
      }
    }
    let drawn = 0;
    let vis = 0;
    for (const tl of this.tiles) {
      const d = boxDist(tl);
      let frac = 0;
      if (d < LOD_FULL) frac = 1;
      else if (d < LOD_HIDE) frac = Math.max(0.03, Math.pow(LOD_FULL / d, 1.35)) * (1 - smooth(LOD_HIDE * 0.8, LOD_HIDE, d) * 0.6);
      let n = Math.ceil(tl.total * frac);
      if (frac > 0) n = Math.max(n, Math.min(tl.total, 16));
      tl.mesh.count = n;
      tl.mesh.visible = n > 0 && this.visible;
      if (tl.mesh.visible) {
        vis++;
        drawn += n;
      }
    }
    this._runGenerator();
    this.stats.chunksVisible = vis;
    this.stats.instancesDrawn = drawn;
  }

  /** 生成待ちチャンクを、近いものから時間予算内で少しずつ処理 */
  _runGenerator() {
    const t0 = performance.now();
    while (performance.now() - t0 < GEN_BUDGET_MS) {
      if (!this.gen) {
        if (!this.genQueue.length) return;
        this.genQueue.sort((a, b) => a.dist - b.dist);
        const ch = this.genQueue.shift();
        this.gen = { ch, it: this._generate(ch) };
      }
      const r = this.gen.it.next();
      if (r.done) {
        this._finish(this.gen.ch, r.value);
        this.gen = null;
      }
    }
  }

  /** 1 チャンク分の建物を生成（ジェネレータ：途中で処理を譲る） */
  *_generate(ch) {
    const t = this.terrain;
    const hd = t.hiData.get(ch.key) ?? null;
    const S = t.hiSamples;
    const step = t.hiStep;
    // チャンク内の標高[m]（詳細データがあれば直接参照、なければ全体サンプラ）
    const H = hd
      ? (x, z) => {
          const fx = (x - ch.minX) / step + 1;
          const fz = (z - ch.minZ) / step + 1;
          const i = Math.min(S - 2, Math.max(0, Math.floor(fx)));
          const j = Math.min(S - 2, Math.max(0, Math.floor(fz)));
          const tx = fx - i;
          const tz = fz - j;
          const a = hd[j * S + i];
          const b = hd[j * S + i + 1];
          const c = hd[(j + 1) * S + i];
          const d = hd[(j + 1) * S + i + 1];
          return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
        }
      : (x, z) => t.getHeightMeters(x, z);

    const waterMask = this.waterMask;
    const excl = this.exclusions.filter(
      (e) => e.x + e.r > ch.minX && e.x - e.r < ch.maxX && e.z + e.r > ch.minZ && e.z - e.r < ch.maxZ,
    );
    const out = []; // [x, y, z, w, h, d, rot, r, g, b, prio, city]
    const col = new THREE.Color();
    const f = { d: 0, core: 0 };
    const g = { d: 0, core: 0 };
    let work = 0;

    for (const c of ch.cities) {
      const i0 = Math.ceil((Math.max(ch.minX, c.x - c.reach) ) / CELL);
      const i1 = Math.floor((Math.min(ch.maxX, c.x + c.reach) - 1e-6) / CELL);
      const j0 = Math.ceil((Math.max(ch.minZ, c.z - c.reach)) / CELL);
      const j1 = Math.floor((Math.min(ch.maxZ, c.z + c.reach) - 1e-6) / CELL);
      const cosA = Math.cos(c.angle);
      const sinA = Math.sin(c.angle);
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          if (++work % 2500 === 0) yield;
          const cx = i * CELL;
          const cz = j * CELL;
          const nz = this._noise(cx, cz);
          this._cityField(c, cx, cz, f, nz);
          if (f.d < 0.07) continue;
          // このセルの担当は最も影響の強い都市（重複生成を避ける）
          const bucket = this._bucketAt(cx, cz);
          let owner = true;
          if (bucket)
            for (const o of bucket) {
              if (o === c) continue;
              this._cityField(o, cx, cz, g, nz);
              if (g.d > f.d || (g.d === f.d && o.index < c.index)) {
                owner = false;
                break;
              }
            }
          if (!owner) continue;

          const r0 = hash2i(i, j, 11);
          const pBuild = smooth(0.08, 0.7, f.d) * (0.72 + 0.28 * Math.min(1, f.core * 2.5));
          if (r0 > pBuild) continue;

          // 地形チェック：海・海岸際・急斜面を避ける
          const hc = H(cx, cz);
          if (hc < 2) continue;
          const e = CELL * 0.5;
          const h1 = H(cx - e, cz - e);
          const h2 = H(cx + e, cz - e);
          const h3 = H(cx - e, cz + e);
          const h4 = H(cx + e, cz + e);
          const hmin = Math.min(h1, h2, h3, h4);
          if (hmin < 0.5) continue;
          const slope = (Math.max(h1, h2, h3, h4) - hmin) / (CELL * 1.414); // m / km
          if (slope > 95) continue;
          if (slope > 45 && hash2i(i, j, 13) < (slope - 45) / 50) continue;

          let skip = false;
          for (const x of excl) {
            const ddx = cx - x.x;
            const ddz = cz - x.z;
            if (ddx * ddx + ddz * ddz < x.r * x.r) {
              skip = true;
              break;
            }
          }
          if (skip) continue;
          // 水域（湖・河川）とその岸 0.22km 以内には建てない（セル半幅 0.185km を含む）
          if (waterMask && waterMask(cx, cz, WATER_MARGIN)) continue;

          // 核に近いほど 1 セルに複数棟・高層
          const core = f.core;
          const nb = core > 0.32 ? 2 : 1;
          for (let k = 0; k < nb; k++) {
            const ra = hash2i(i * 7 + k, j * 13 - k, 17);
            const rb = hash2i(i * 3 - k, j * 5 + k, 19);
            const rc = hash2i(i + k * 31, j - k * 17, 23);
            const rd = hash2i(i - k * 11, j + k * 29, 29);
            // セル内の位置（都市の街路方向に沿って並べる）
            const sub = nb === 1 ? 0 : (k - (nb - 1) / 2) * (CELL / nb);
            const ox = sub + (ra - 0.5) * CELL * (nb === 1 ? 0.35 : 0.15);
            const oz = (rb - 0.5) * CELL * 0.35;
            const x = cx + ox * cosA - oz * sinA;
            const z = cz + ox * sinA + oz * cosA;

            // 高さ [m]
            let hm = c.baseM * (0.55 + 0.9 * rc);
            hm += c.midM * f.d * f.d * (0.3 + 0.7 * rd);
            hm += c.tallM * Math.pow(core, 1.6) * (0.3 + 0.7 * Math.pow(rc, 0.6));
            if (core > 0.25 && rd > 0.93) hm *= 1.35; // ところどころ突出したタワー
            hm *= 1 - smooth(45, 95, slope) * 0.5;

            // 平面寸法 [km]（高い建物ほど細く、郊外の低層は面で広く）
            const tall = smooth(40, 160, hm);
            const span = CELL / nb;
            const w = span * (0.88 - 0.38 * tall) * (0.75 + 0.25 * ra);
            const dd = CELL * (0.82 - 0.4 * tall) * (0.7 + 0.3 * rb) * (nb === 1 ? 1 : 0.85);

            const pal = hm > 60 ? PALETTE_TALL : hm > 24 ? PALETTE_MID : PALETTE_LOW;
            col.set(pal[Math.floor(rd * pal.length) % pal.length]);
            const shade = 0.9 + 0.2 * ra;
            const rot = c.angle + (rb - 0.5) * 0.16;
            const y = hmin * M2Y - FOUNDATION;
            out.push(x, y, z, w, hm * M2Y + FOUNDATION + (hc - hmin) * M2Y, dd, rot, col.r * shade, col.g * shade, col.b * shade, hm + rd * 4, c.index);
          }
        }
      }
    }
    return out;
  }

  _finish(ch, out) {
    const STR = 12;
    const n = out.length / STR;
    ch.state = 'ready';
    if (!n) return;
    // 高い順（＝遠景で残す順）に並べ替え、32km タイルへ振り分け
    const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => out[b * STR + 10] - out[a * STR + 10]);
    const parts = new Map();
    for (const k of order) {
      const tx = Math.floor((out[k * STR] - ch.minX) / TILE);
      const tz = Math.floor((out[k * STR + 2] - ch.minZ) / TILE);
      const key = `${Math.min(1, Math.max(0, tx))}${Math.min(1, Math.max(0, tz))}`;
      if (!parts.has(key)) parts.set(key, []);
      parts.get(key).push(k);
    }
    for (const [sub, idx] of parts) {
      const tile = this._makeTile(`${ch.key}_${sub}`, idx, out, STR);
      tile.minX = ch.minX + Number(sub[0]) * TILE;
      tile.minZ = ch.minZ + Number(sub[1]) * TILE;
      tile.maxX = tile.minX + TILE;
      tile.maxZ = tile.minZ + TILE;
      this.tiles.push(tile);
      this.group.add(tile.mesh);
    }
    this.stats.tiles = this.tiles.length;
  }

  _makeTile(key, idx, out, STR) {
    const n = idx.length;
    const mesh = new THREE.InstancedMesh(this.geometry, this.material, n);
    mesh.name = `city_${key}`;
    mesh.matrixAutoUpdate = false;
    const m = mesh.instanceMatrix.array;
    const colors = new Float32Array(n * 3);
    const cityOf = new Uint16Array(n);
    let maxY = 0;
    for (let k = 0; k < n; k++) {
      const s = idx[k] * STR;
      const x = out[s], y = out[s + 1], z = out[s + 2], w = out[s + 3], h = out[s + 4], d = out[s + 5], r = out[s + 6];
      const cs = Math.cos(r);
      const sn = Math.sin(r);
      const o = k * 16;
      m[o] = w * cs; m[o + 1] = 0; m[o + 2] = -w * sn; m[o + 3] = 0;
      m[o + 4] = 0; m[o + 5] = h; m[o + 6] = 0; m[o + 7] = 0;
      m[o + 8] = d * sn; m[o + 9] = 0; m[o + 10] = d * cs; m[o + 11] = 0;
      m[o + 12] = x; m[o + 13] = y; m[o + 14] = z; m[o + 15] = 1;
      colors[k * 3] = out[s + 7];
      colors[k * 3 + 1] = out[s + 8];
      colors[k * 3 + 2] = out[s + 9];
      cityOf[k] = out[s + 11];
      maxY = Math.max(maxY, y + h);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
    mesh.computeBoundingSphere();
    mesh.userData = { kind: 'city-buildings', tile: key, cityOf };
    mesh.count = 0;
    mesh.visible = false;
    this.stats.instancesTotal += n;
    return { key, mesh, total: n, maxY };
  }

  /** 都市ラベル用の項目（labels.js の addItems 形式） */
  labelItems() {
    return this.cities.map((c) => {
      const rk = RANK[c.rank] ?? RANK.city;
      const big = c.rank === 'city' && c.pop >= 300000;
      return {
        id: c.id,
        name: c.name,
        type: 'city',
        x: c.x,
        z: c.z,
        maxDist: c.rank === 'city' ? (big ? 300 : rk.labelDist) : rk.labelDist,
        prio: rk.prio + (big ? 0.4 : 0),
        meta: c,
      };
    });
  }
}

const _f = { d: 0, core: 0 };
