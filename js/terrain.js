/**
 * terrain.js — チャンク分割＋2段LODの地形システム
 * ---------------------------------------------------------------------------
 * データ (data/terrain/)
 *   manifest.json  … グリッド定義・チャンク一覧
 *   coarse.bin     … 全域 4km 間隔の標高 (Int16, m)。起動時に一括読込（約400KB）
 *   hi/h_X_Z.bin   … 64km 四方 1km 間隔の標高 (Int16, 67×67, 縁1サンプル付き)
 *                    カメラが近づいたチャンクだけ遅延読込（各 約9KB）
 *
 * LOD 構成
 *   粗タイル  : 128km 四方 / 4km 間隔 (32×32 セル)  … 遠景・全体俯瞰
 *   詳細タイル: 64km  四方 / 1km 間隔 (64×64 セル)  … 粗タイル 1 枚を 4 枚に分割
 *   距離に応じて粗タイル単位で分割／統合（ヒステリシス付き）。
 *   LOD 境界の隙間は「スカート」（縁から下へ垂らした帯）で隠す。
 *
 * 描画コスト
 *   すべてのタイルで 1 つのマテリアル（頂点カラー）を共有。
 *   タイルごとに boundingSphere があるので frustum culling が自然に効く。
 */
import * as THREE from 'three';
import { NORTH_LIMIT_LAT, VERTICAL_EXAGGERATION, worldToLatLon } from './geo.js';
import { TOD_UNIFORMS } from './timeofday.js';
import { TROPIC_Z0, TROPIC_Z1 } from './environment.js';

const SPLIT_DIST = 170; // km : これより近い粗タイルは詳細化
const MERGE_DIST = 215; // km : これより遠ければ粗に戻す
const MAX_CONCURRENT_FETCH = 6;
const MAX_CACHED_HI_MESHES = 160;
const SKIRT_DEPTH = 4; // world units
const UNDERWATER_Y = -0.12; // これより深い縁にはスカートを付けない

const M2Y = VERTICAL_EXAGGERATION / 1000;

/* ---------------------------------------------------------------------- */
/* 市街地の色付け（cities.js から登録。遠景で「ここに都市がある」と分かるように）   */
/* ---------------------------------------------------------------------- */
let urbanField = null;
/**
 * 市街地密度フィールドを登録する。(x, z) → 0..1。
 * タイルの頂点色を計算する時に参照されるので、terrain.init() より前に呼ぶこと。
 * @param {((x:number, z:number) => number) | null} fn
 */
export function setUrbanField(fn) {
  urbanField = fn;
}

export class TerrainSystem {
  /**
   * @param {{ dir: string, manifestUrl: string }} opts
   */
  constructor(opts) {
    this.dir = opts.dir;
    this.manifestUrl = opts.manifestUrl;
    this.group = new THREE.Group();
    this.group.name = 'terrain';

    this.material = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.material.name = 'terrain-shared';
    patchTerrainMaterial(this.material); // v8: 夜の市街地の光・沖永良部島以南のエメラルドの浅瀬

    this.coarseTiles = []; // {tx,tz, mesh, children:[4], split:bool, hasHi:bool, minX..}
    this.hiData = new Map(); // key -> Int16Array (読み込み済み)
    this.hiPending = new Map(); // key -> Promise
    this.fetchQueue = [];
    this.activeFetches = 0;
    this.hiMeshCache = new Map(); // key -> {mesh, lastUsed}
    this.frame = 0;
    this.stats = { coarseVisible: 0, hiVisible: 0, hiLoaded: 0 };
  }

  async init() {
    const m = await (await fetch(this.manifestUrl)).json();
    this.manifest = m;
    const g = m.grid;
    this.x0 = g.x0;
    this.z0 = g.z0;
    this.chunk = g.chunkKm;
    this.ncx = g.ncx;
    this.ncz = g.ncz;
    this.seaFloorM = m.seaFloorM;
    this.hiSamples = m.hi.samples; // 67
    this.hiN = this.hiSamples - 3; // 64 セル
    this.hiStep = m.hi.stepKm;
    this.hiSet = new Set(m.hi.chunks.map(([cx, cz]) => `${cx}_${cz}`));
    this.childByKey = new Map(); // key -> 粗タイルの子チャンク情報（requestChunkData 用）

    const buf = await (await fetch(this.dir + m.coarse.file)).arrayBuffer();
    this.coarse = new Int16Array(buf);
    this.cnx = m.coarse.nx;
    this.cnz = m.coarse.nz;
    this.cstep = m.coarse.stepKm;

    this._buildCoarseTiles();
    return this;
  }

  /* ------------------------------------------------------------------ */
  /* 標高サンプリング                                                      */
  /* ------------------------------------------------------------------ */

  _coarseAt(i, j) {
    i = i < 0 ? 0 : i >= this.cnx ? this.cnx - 1 : i;
    j = j < 0 ? 0 : j >= this.cnz ? this.cnz - 1 : j;
    return this.coarse[j * this.cnx + i];
  }

  /** 標高[m]（読み込み済みの最良データで双線形補間） */
  getHeightMeters(x, z) {
    const lx = x - this.x0;
    const lz = z - this.z0;
    const cx = Math.floor(lx / this.chunk);
    const cz = Math.floor(lz / this.chunk);
    const hd = this.hiData.get(`${cx}_${cz}`);
    if (hd) {
      const S = this.hiSamples;
      const fx = (lx - cx * this.chunk) / this.hiStep + 1;
      const fz = (lz - cz * this.chunk) / this.hiStep + 1;
      const i = Math.min(S - 2, Math.floor(fx));
      const j = Math.min(S - 2, Math.floor(fz));
      const tx = fx - i;
      const tz = fz - j;
      const a = hd[j * S + i];
      const b = hd[j * S + i + 1];
      const c = hd[(j + 1) * S + i];
      const d = hd[(j + 1) * S + i + 1];
      return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
    }
    return this.getCoarseHeightMeters(x, z);
  }

  /** 標高[m]（粗データ 4km 間隔のみ。粗タイルの表面と一致する。河川の遠景表示用） */
  getCoarseHeightMeters(x, z) {
    if (!this.coarse) return this.seaFloorM ?? -250;
    const lx = x - this.x0;
    const lz = z - this.z0;
    const fx = lx / this.cstep;
    const fz = lz / this.cstep;
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const tx = fx - i;
    const tz = fz - j;
    const a = this._coarseAt(i, j);
    const b = this._coarseAt(i + 1, j);
    const c = this._coarseAt(i, j + 1);
    const d = this._coarseAt(i + 1, j + 1);
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  }

  /** 地形表面のワールド Y（海底を含む） */
  getHeightAt(x, z) {
    return this.getHeightMeters(x, z) * M2Y;
  }

  /** 地表または海面のうち高い方の Y（カメラ・列車・キャラ配置用） */
  getSurfaceY(x, z) {
    const y = this.getHeightAt(x, z);
    return y > 0 ? y : 0;
  }

  /* ------------------------------------------------------------------ */
  /* メッシュ構築                                                          */
  /* ------------------------------------------------------------------ */

  _buildCoarseTiles() {
    const tilesX = this.ncx / 2;
    const tilesZ = Math.ceil(this.ncz / 2);
    const N = (this.chunk * 2) / this.cstep; // 32
    for (let tz = 0; tz < tilesZ; tz++) {
      for (let tx = 0; tx < tilesX; tx++) {
        const i0 = tx * N;
        const j0 = tz * N;
        let maxH = -Infinity;
        for (let j = 0; j <= N; j++)
          for (let i = 0; i <= N; i++) maxH = Math.max(maxH, this._coarseAt(i0 + i, j0 + j));
        const children = [];
        let hasHi = false;
        for (let dz = 0; dz < 2; dz++)
          for (let dx = 0; dx < 2; dx++) {
            const cx = tx * 2 + dx;
            const cz = tz * 2 + dz;
            if (cz >= this.ncz) continue;
            const key = `${cx}_${cz}`;
            const hi = this.hiSet.has(key);
            hasHi ||= hi;
            const child = { cx, cz, key, hi };
            children.push(child);
            this.childByKey.set(key, child);
          }
        // 全面が深い海のタイルは作らない（海底面メッシュで代用）
        if (maxH <= this.seaFloorM + 15 && !hasHi) continue;

        const ox = this.x0 + tx * this.chunk * 2;
        const oz = this.z0 + tz * this.chunk * 2;
        const geo = buildTileGeometry(N, this.cstep, ox, oz, (i, j) => this._coarseAt(i0 + i, j0 + j));
        const mesh = new THREE.Mesh(geo, this.material);
        mesh.name = `coarse_${tx}_${tz}`;
        mesh.matrixAutoUpdate = false;
        this.group.add(mesh);
        this.coarseTiles.push({
          tx, tz, mesh, children, hasHi, split: false,
          minX: ox, maxX: ox + this.chunk * 2, minZ: oz, maxZ: oz + this.chunk * 2,
          maxY: Math.max(0, maxH * M2Y),
        });
      }
    }
  }

  _buildChildMesh(c) {
    let geo;
    const ox = this.x0 + c.cx * this.chunk;
    const oz = this.z0 + c.cz * this.chunk;
    const hd = this.hiData.get(c.key);
    if (hd) {
      const S = this.hiSamples;
      geo = buildTileGeometry(this.hiN, this.hiStep, ox, oz, (i, j) => hd[(j + 1) * S + (i + 1)]);
    } else {
      // 詳細データなし（深い海など）→ 粗データから 16 セルで作る
      const N = this.chunk / this.cstep;
      const i0 = c.cx * N;
      const j0 = c.cz * N;
      geo = buildTileGeometry(N, this.cstep, ox, oz, (i, j) => this._coarseAt(i0 + i, j0 + j));
    }
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.name = `hi_${c.key}`;
    mesh.matrixAutoUpdate = false;
    return mesh;
  }

  /* ------------------------------------------------------------------ */
  /* 遅延読み込み                                                          */
  /* ------------------------------------------------------------------ */

  _requestHi(c, priority) {
    if (!c.hi || this.hiData.has(c.key) || this.hiPending.has(c.key)) return;
    let resolveFn;
    const p = new Promise((r) => (resolveFn = r));
    this.hiPending.set(c.key, p);
    this.fetchQueue.push({ c, priority, resolve: resolveFn });
    this._pumpQueue();
  }

  _pumpQueue() {
    this.fetchQueue.sort((a, b) => a.priority - b.priority);
    while (this.activeFetches < MAX_CONCURRENT_FETCH && this.fetchQueue.length) {
      const job = this.fetchQueue.shift();
      this.activeFetches++;
      fetch(`${this.dir}${this.manifest.hi.dir}h_${job.c.key}.bin`)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(r.status)))
        .then((buf) => {
          this.hiData.set(job.c.key, new Int16Array(buf));
          this.stats.hiLoaded = this.hiData.size;
        })
        .catch((e) => {
          console.warn('terrain chunk failed', job.c.key, e);
          job.c.hi = false; // 粗データで代用
        })
        .finally(() => {
          this.activeFetches--;
          this.hiPending.delete(job.c.key);
          job.resolve();
          this._pumpQueue();
        });
    }
  }

  _childReady(c) {
    return !c.hi || this.hiData.has(c.key);
  }

  /* ------------------------------------------------------------------ */
  /* 毎フレーム更新                                                        */
  /* ------------------------------------------------------------------ */

  /** @param {THREE.Camera} camera */
  update(camera) {
    this.frame++;
    const p = camera.position;
    let coarseVisible = 0;
    let hiVisible = 0;

    for (const t of this.coarseTiles) {
      const dx = Math.max(t.minX - p.x, 0, p.x - t.maxX);
      const dz = Math.max(t.minZ - p.z, 0, p.z - t.maxZ);
      const dy = Math.max(0, p.y - t.maxY);
      const d = Math.sqrt(dx * dx + dz * dz + dy * dy);

      const wantSplit = t.hasHi && (t.split ? d < MERGE_DIST : d < SPLIT_DIST);

      if (wantSplit) {
        for (const c of t.children) this._requestHi(c, d);
        const ready = t.children.every((c) => this._childReady(c));
        if (ready) {
          if (!t.split) {
            t.split = true;
          }
          for (const c of t.children) {
            let entry = this.hiMeshCache.get(c.key);
            if (!entry) {
              entry = { mesh: this._buildChildMesh(c), lastUsed: 0 };
              this.hiMeshCache.set(c.key, entry);
              this.group.add(entry.mesh);
            }
            entry.mesh.visible = true;
            entry.lastUsed = this.frame;
            hiVisible++;
          }
          t.mesh.visible = false;
          continue;
        }
      }
      // 粗表示
      if (t.split) {
        t.split = false;
        for (const c of t.children) {
          const e = this.hiMeshCache.get(c.key);
          if (e) e.mesh.visible = false;
        }
      }
      t.mesh.visible = true;
      coarseVisible++;
    }

    // キャッシュ溢れの破棄（最も長く使っていないものから）
    if (this.hiMeshCache.size > MAX_CACHED_HI_MESHES && this.frame % 30 === 0) {
      const entries = [...this.hiMeshCache.entries()]
        .filter(([, e]) => !e.mesh.visible)
        .sort((a, b) => a[1].lastUsed - b[1].lastUsed);
      const excess = this.hiMeshCache.size - MAX_CACHED_HI_MESHES;
      for (let k = 0; k < excess && k < entries.length; k++) {
        const [key, e] = entries[k];
        this.group.remove(e.mesh);
        e.mesh.geometry.dispose();
        this.hiMeshCache.delete(key);
      }
    }
    this.stats.coarseVisible = coarseVisible;
    this.stats.hiVisible = hiVisible;
  }

  /** 64km チャンク (cx, cz) の詳細標高データ。未読込なら null */
  hasChunkData(cx, cz) {
    return this.hiData.has(`${cx}_${cz}`);
  }

  /**
   * 64km チャンク (cx, cz) の詳細標高データを読み込む（都市・ランドマーク配置用）。
   * 詳細データを持たないチャンクでは即座に解決する。
   * @returns {Promise<boolean>} 詳細データが使えるなら true
   */
  requestChunkData(cx, cz, priority = 0) {
    const key = `${cx}_${cz}`;
    if (this.hiData.has(key)) return Promise.resolve(true);
    const c = this.childByKey.get(key);
    if (!c || !c.hi) return Promise.resolve(false);
    this._requestHi(c, priority);
    return (this.hiPending.get(key) ?? Promise.resolve()).then(() => this.hiData.has(key));
  }

  /** ワールド座標 → 64km チャンク番号 */
  chunkOf(x, z) {
    return { cx: Math.floor((x - this.x0) / this.chunk), cz: Math.floor((z - this.z0) / this.chunk) };
  }

  /** 読み込み済みでない近傍チャンクをまとめて先読みする（プリセット移動の直前など） */
  prefetchAround(x, z, radiusKm = 150) {
    for (const t of this.coarseTiles) {
      const cx = (t.minX + t.maxX) / 2;
      const cz = (t.minZ + t.maxZ) / 2;
      const d = Math.hypot(cx - x, cz - z);
      if (d < radiusKm + 90) for (const c of t.children) this._requestHi(c, d);
    }
  }
}

/* ====================================================================== */
/* ジオメトリ生成                                                           */
/* ====================================================================== */

const _ll = { lat: 0, lon: 0 };

/**
 * 規則グリッドのタイルを作る（スカート付き）
 * @param {number} n       セル数（頂点は n+1）
 * @param {number} step    頂点間隔 [km]
 * @param {number} ox,oz   左上（北西）角のワールド座標
 * @param {(i:number,j:number)=>number} hAt  標高[m]。i,j は -1..n+1 を受け付けること
 */
function buildTileGeometry(n, step, ox, oz, hAt) {
  const V = n + 1;
  const mainCount = V * V;
  const skirtCount = 4 * V;
  const total = mainCount + skirtCount;
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  const urb = new Float32Array(total); // v8: 市街地の度合い（夜の光）

  // 北限付近の色フェード計算のため、タイル中央の緯度で十分（タイル内での変化は小さい）
  const inv2s = 1 / (2 * step);
  const tmp = [0, 0, 0];

  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const k = j * V + i;
      const hm = hAt(i, j);
      const x = ox + i * step;
      const z = oz + j * step;
      const y = hm * M2Y;
      pos[k * 3] = x;
      pos[k * 3 + 1] = y;
      pos[k * 3 + 2] = z;
      const dX = (hAt(i + 1, j) - hAt(i - 1, j)) * M2Y * inv2s;
      const dZ = (hAt(i, j + 1) - hAt(i, j - 1)) * M2Y * inv2s;
      const il = 1 / Math.sqrt(dX * dX + 1 + dZ * dZ);
      const ny = il;
      nor[k * 3] = -dX * il;
      nor[k * 3 + 1] = ny;
      nor[k * 3 + 2] = -dZ * il;
      worldToLatLon(x, z, _ll);
      terrainColor(hm, ny, _ll.lat, x, z, tmp);
      col[k * 3] = tmp[0];
      col[k * 3 + 1] = tmp[1];
      col[k * 3 + 2] = tmp[2];
      if (urbanField && hm > 0) {
        const u = urbanField(x, z);
        urb[k] = u > 0.02 ? Math.min(1, u * 1.15) * smooth(0.8, 0.95, ny) : 0;
      }
    }
  }

  // スカート頂点：外周の頂点をコピーして下へずらす
  const edge = []; // 各辺の main 頂点 index 列（時計回りの向きは後で考慮）
  const top = [], bottom = [], left = [], right = [];
  for (let i = 0; i <= n; i++) {
    top.push(i);
    bottom.push(n * V + i);
  }
  for (let j = 0; j <= n; j++) {
    left.push(j * V);
    right.push(j * V + n);
  }
  edge.push(top, bottom, left, right);
  let s = mainCount;
  const skirtStart = [];
  for (const e of edge) {
    skirtStart.push(s);
    for (const k of e) {
      pos[s * 3] = pos[k * 3];
      // 海中の縁はスカート不要（水面下で見えず、遠景で筋になるため）
      pos[s * 3 + 1] = pos[k * 3 + 1] - (pos[k * 3 + 1] > UNDERWATER_Y ? SKIRT_DEPTH : 0);
      pos[s * 3 + 2] = pos[k * 3 + 2];
      nor[s * 3] = nor[k * 3];
      nor[s * 3 + 1] = nor[k * 3 + 1];
      nor[s * 3 + 2] = nor[k * 3 + 2];
      col[s * 3] = col[k * 3];
      col[s * 3 + 1] = col[k * 3 + 1];
      col[s * 3 + 2] = col[k * 3 + 2];
      urb[s] = urb[k];
      s++;
    }
  }

  const triCount = n * n * 2 + 4 * n * 2;
  const idx = total > 65535 ? new Uint32Array(triCount * 3) : new Uint16Array(triCount * 3);
  let q = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * V + i;
      const b = a + 1;
      const c = a + V;
      const d = c + 1;
      // 上から見て反時計回り（法線 +Y）
      idx[q++] = a; idx[q++] = c; idx[q++] = b;
      idx[q++] = b; idx[q++] = c; idx[q++] = d;
    }
  }
  // スカート（両面に見えるよう向きは外向き。material は FrontSide のため外側から見える向きに）
  const addStrip = (mainIdx, sStart, flip) => {
    for (let k = 0; k < n; k++) {
      const a = mainIdx[k];
      const b = mainIdx[k + 1];
      const c = sStart + k;
      const d = sStart + k + 1;
      if (flip) {
        idx[q++] = a; idx[q++] = b; idx[q++] = c;
        idx[q++] = b; idx[q++] = d; idx[q++] = c;
      } else {
        idx[q++] = a; idx[q++] = c; idx[q++] = b;
        idx[q++] = b; idx[q++] = c; idx[q++] = d;
      }
    }
  };
  addStrip(top, skirtStart[0], true); // 北辺：外 = -Z
  addStrip(bottom, skirtStart[1], false); // 南辺：外 = +Z
  addStrip(left, skirtStart[2], false); // 西辺：外 = -X
  addStrip(right, skirtStart[3], true); // 東辺：外 = +X

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('urban', new THREE.BufferAttribute(urb, 1));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  return geo;
}

/* ====================================================================== */
/* 地表色（sRGB で考えて最後にリニア化）                                     */
/* ====================================================================== */

function hash2(x, z) {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

function mix(a, b, t, out) {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
  return out;
}

const C = {
  deep: [0.05, 0.16, 0.3],
  shelf: [0.16, 0.42, 0.52],
  shallow: [0.42, 0.74, 0.72],
  reef: [0.55, 0.86, 0.8],
  sand: [0.86, 0.8, 0.62],
  sandTrop: [0.94, 0.9, 0.78],
  farm: [0.56, 0.63, 0.34],
  grass: [0.38, 0.56, 0.27],
  forest: [0.2, 0.38, 0.18],
  highForest: [0.24, 0.33, 0.2],
  scrub: [0.45, 0.43, 0.32],
  urban: [0.6, 0.59, 0.56],
  urbanCore: [0.7, 0.69, 0.67],
  rock: [0.55, 0.52, 0.48],
  snow: [0.93, 0.94, 0.96],
  tropic: [0.3, 0.6, 0.3],
};
const _a = [0, 0, 0];
const _b = [0, 0, 0];

function smooth(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

function terrainColor(h, ny, lat, x, z, out) {
  const tropical = smooth(30.5, 28.0, lat); // 0:本土 1:南西諸島
  // 深海は海底プレーンと同じ色に揃える（タイル境界を目立たせない）
  const jitter = h < -120 ? 0 : (hash2(Math.round(x * 2), Math.round(z * 2)) - 0.5) * 0.06;

  if (h <= 0) {
    // 海底（半透明の海面越しに見える）
    const d = -h;
    if (d < 25) mix(tropical > 0.5 ? C.reef : C.shallow, C.shelf, d / 25, out);
    else mix(C.shelf, C.deep, Math.min(1, (d - 25) / 120), out);
  } else if (h < 7) {
    // v4: 実 DEM の低地は陸の下限 10m（tools/build_terrain.py）。砂浜色は海岸線際（2〜9m）だけにする
    mix(C.sand, C.sandTrop, tropical, _a);
    mix(_a, C.farm, smooth(2.5, 7, h), out);
  } else {
    // 低地 → 森林 → 亜高山 → 岩 → 雪
    mix(C.farm, C.grass, smooth(30, 180, h), _a);
    mix(_a, C.forest, smooth(150, 700, h), _a);
    // v4: 実 DEM の丘陵（房総・三浦など数百 m の起伏）は標高が低くても斜面なら森の色に
    //     （平らな低地＝田畑・市街地との差が遠景でも分かる）
    mix(_a, C.forest, smooth(0.995, 0.95, ny) * smooth(20, 80, h) * 0.8, _a);
    mix(_a, C.highForest, smooth(900, 1600, h), _a);
    mix(_a, C.scrub, smooth(1700, 2300, h), _a);
    mix(_a, C.rock, smooth(2300, 2800, h), _a);
    // 斜面が急なら岩
    const steep = smooth(0.82, 0.55, ny) * smooth(400, 1200, h);
    mix(_a, C.rock, steep * 0.7, _a);
    mix(_a, C.snow, smooth(2850, 3300, h), _a);
    // 南国は明るい緑に
    mix(_a, C.tropic, tropical * smooth(30, 120, h) * (1 - smooth(300, 700, h)) * 0.6, out);
  }

  // 市街地：灰色寄りに（急斜面には広げない）
  if (urbanField && h > 0) {
    const u = urbanField(x, z);
    if (u > 0.02) {
      const flat = smooth(0.8, 0.95, ny);
      mix(C.urban, C.urbanCore, smooth(0.45, 0.9, u), _b);
      mix(out, _b, Math.min(0.85, u * 1.15) * flat * smooth(0, 4, h), out);
    }
  }

  // 北限より北：彩度・明度を落として「範囲外」とわかるように
  const outside = h > -60 ? smooth(NORTH_LIMIT_LAT, NORTH_LIMIT_LAT + 0.18, lat) : 0;
  if (outside > 0) {
    const g = (out[0] + out[1] + out[2]) / 3;
    _b[0] = _b[1] = _b[2] = g * 0.75;
    _b[2] += 0.04;
    mix(out, _b, outside * 0.85, out);
  }

  // jitter + sRGB→linear（近似 γ2.2）
  for (let k = 0; k < 3; k++) {
    const v = Math.min(1, Math.max(0, out[k] + jitter));
    out[k] = Math.pow(v, 2.2);
  }
  return out;
}

/* ====================================================================== */
/* v8: 時間帯（夜の市街地の光・南国の浅瀬）                                     */
/* ====================================================================== */

/**
 * 地形の共有マテリアルに 2 つの表現を足す（どちらも頂点数・draw call は増えない）
 *  ・夜の市街地の光：頂点属性 urban（都市密度 × 平坦さ）に応じて暖色の発光。遠景ほど強く（建物が描かれない距離でも都市の灯りが見える）。
 *  ・沖永良部島以南の浅瀬：海面下の地形を、水深（＝海岸からの距離で作った合成海底の深さ）でエメラルド → ターコイズ → 青緑へ。
 *    水深 0〜7m（海岸から約 1.5km）がエメラルド、〜22m（約 3km）ターコイズ、〜40m 青緑、それより深いと既存の紺のまま。
 */
function patchTerrainMaterial(mat) {
  const U = TOD_UNIFORMS;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { uCityGlow: U.uCityGlow, uCityCoverage: U.uCityCoverage, uReef0: U.uReef0, uReef1: U.uReef1, uReef2: U.uReef2, uReefAmt: U.uReefAmt });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float urban;\nvarying float vUrban;\nvarying vec3 vTodW;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvUrban = urban;\nvTodW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying float vUrban;
        varying vec3 vTodW;
        uniform float uCityGlow;
        uniform float uCityCoverage;
        float tdHash( vec2 p ) {
          vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
          p3 += dot( p3, p3.yzx + 33.33 );
          return fract( ( p3.x + p3.y ) * p3.z );
        }
        // 1 段分の光点（格子 cell [km] ごとに最大 1 点。点灯は 密度 × 点灯率 未満のハッシュ）
        float tdCityDots( vec2 p, float cell, float dens ) {
          vec2 g = p / cell;
          vec2 id = floor( g );
          vec2 f = fract( g );
          float h = tdHash( id + cell * 0.37 );
          if ( h > dens * uCityCoverage * 0.95 ) return 0.0;
          vec2 c = vec2( 0.2 + 0.6 * tdHash( id + 3.1 ), 0.2 + 0.6 * tdHash( id + 7.7 ) );
          float d = length( f - c );
          float cellPx = 1.0 / max( max( fwidth( g.x ), fwidth( g.y ) ), 1e-5 );
          float r = clamp( 1.5 / cellPx, 0.02, 0.22 );
          return ( 1.0 - smoothstep( r * 0.45, r, d ) ) * ( 0.65 + 0.35 * tdHash( id + 11.0 ) );
        }
        uniform vec3 uReef0; uniform vec3 uReef1; uniform vec3 uReef2; uniform float uReefAmt;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          float tropic = smoothstep( ${TROPIC_Z0.toFixed(1)}, ${TROPIC_Z1.toFixed(1)}, vTodW.z );
          if ( tropic > 0.0 && vTodW.y < 0.0 ) {
            float depthM = -vTodW.y / ${M2Y.toFixed(6)};
            vec3 rc = mix( uReef0, uReef1, smoothstep( 5.0, 15.0, depthM ) );
            rc = mix( rc, uReef2, smoothstep( 16.0, 32.0, depthM ) );
            float amt = tropic * uReefAmt * ( 1.0 - smoothstep( 32.0, 48.0, depthM ) );
            diffuseColor.rgb = mix( diffuseColor.rgb, rc, amt );
          }
        }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        if ( uCityGlow > 0.001 && vUrban > 0.02 ) {
          // v8: 街明かりの「点」。街区ごとの決定的ハッシュで点灯（チラつかない）、点は画面上 1〜2px。
          //     格子の大きさはカメラ距離で 2 倍ずつ切り替え（近景 0.15km 〜 遠景 4.8km）、隣の段となめらかに混ぜる。
          float camD = distance( cameraPosition, vTodW );
          float lv = clamp( log2( camD / 14.0 ), 0.0, 5.0 );
          float k = floor( lv );
          float t = lv - k;
          float dens = smoothstep( 0.04, 0.75, vUrban );
          float a0 = tdCityDots( vTodW.xz, 0.15 * exp2( k ), dens );
          float a1 = tdCityDots( vTodW.xz, 0.15 * exp2( k + 1.0 ), dens );
          float lights = mix( a0, a1, t );
          vec3 warm = vec3( 1.0, 0.66, 0.32 );
          vec3 white = vec3( 0.95, 0.93, 0.88 );
          vec3 lc = mix( warm, white, step( 0.62, tdHash( floor( vTodW.xz / 0.6 ) + 5.0 ) ) );
          totalEmissiveRadiance += lc * lights * uCityGlow * 3.2;
        }`,
      );
  };
  mat.customProgramCacheKey = () => 'dht-terrain-v8';
}
