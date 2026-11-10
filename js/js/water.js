/**
 * water.js — 湖沼・河川（v3）
 * ---------------------------------------------------------------------------
 * データ : data/water.json（tools/water.py が地形の加工と同時に生成）
 *   lakes[]  {id, name, type:'lake', rank, levelM, rings:[[[lat,lon]…]…], center, …}
 *   rivers[] {id, name, type:'river', widthKm, points:[[lat, lon, 水面標高m, 川幅km]…]}
 *   labels[] ラベルだけの項目（琵琶湖・富士五湖のまとめ）
 *
 * 描画（すべて共有ジオメトリ 2 つ＝ draw call 2）
 *   湖   : 全湖を 1 つの BufferGeometry に結合した水平な面（水面標高 levelM）。
 *          地形側は湖の範囲を水面 −7m に平らにならしてある（tools/water.py）ので、
 *          山や丘が湖面を突き抜けず、Z ファイティングもしない。
 *   河川 : 中心線から左右に川幅/2 だけ広げたリボン（三角形ストリップ）を全河川で 1 つに結合。
 *          地形の LOD に合わせて頂点の高さを切り替える：
 *            詳細タイル表示中 → 掘り下げた河床の上の水面高（単調に下る＝水が山を登らない）
 *            粗タイル表示中   → 粗地形（4km 間隔）の表面より少し上
 *          切り替えは粗タイルごとの「詳細化フラグ」を 16×16 のテクスチャに入れ、
 *          頂点シェーダで参照する（ジオメトリの作り直し・draw call の増加なし）。
 *
 * 都市との干渉 : isWater(x, z, margin) を cities.js が建物配置のたびに参照（水上・河岸に建てない）。
 * 将来のクリック : mesh.userData.items（id・name・type・lat・lon）と、三角形 → 項目の対応 triItem。
 */
import * as THREE from 'three';
import { latLonToWorld, VERTICAL_EXAGGERATION } from './geo.js';

const M2Y = VERTICAL_EXAGGERATION / 1000;
const COARSE_LIFT_M = 12; // 粗地形表示時に、粗地形（セルの 4 隅の最大値）からこれだけ上に川を描く [m]
const BUCKET = 8; // km  isWater 用の空間ハッシュ
const SPLIT_TEX = 16; // 粗タイル (tx, tz) → 詳細化フラグ のテクスチャ一辺

// 海（#1f6a96 半透明 + 浅瀬の海底色）と喧嘩しない、少しだけ明るく緑みのある水色
const LAKE_COLOR = 0x2f7fa6;
const RIVER_COLOR = 0x3f8fb8;

const LABEL = {
  lake: {
    1: { maxDist: 420, prio: 1.75 },
    2: { maxDist: 170, prio: 1.5 },
    3: { maxDist: 75, prio: 1.3 },
  },
  river: { maxDist: 55, prio: 0.8 },
};

export class WaterSystem {
  constructor(terrain) {
    this.terrain = terrain;
    this.group = new THREE.Group();
    this.group.name = 'water';
    this.lakes = [];
    this.rivers = [];
    this.labels = [];
    this.items = []; // クリック用：湖・河川の一覧
    this.visible = true;
    this._splitState = null;
    this.stats = { lakeTris: 0, riverTris: 0 };
  }

  async load(url) {
    const json = await (await fetch(url)).json();
    this.meta = json;
    for (const lk of json.lakes) {
      const rings = lk.rings.map((r) => r.map(([la, lo]) => latLonToWorld(la, lo)));
      const xs = rings[0].map((p) => p.x);
      const zs = rings[0].map((p) => p.z);
      this.lakes.push({
        ...lk,
        lat: lk.center[0],
        lon: lk.center[1],
        y: lk.levelM * M2Y,
        wrings: rings,
        minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs),
      });
    }
    for (const rv of json.rivers) {
      const pts = rv.points.map(([la, lo, h, w]) => {
        const p = latLonToWorld(la, lo);
        return { x: p.x, z: p.z, h, hw: w / 2, lat: la, lon: lo };
      });
      const mid = pts[Math.floor(pts.length / 2)];
      this.rivers.push({ ...rv, pts, lat: mid.lat, lon: mid.lon });
    }
    this.labels = json.labels ?? [];
    this.items = [...this.lakes, ...this.rivers].map(({ id, name, type, lat, lon }) => ({ id, name, type, lat, lon }));
    this._buildIndex();
    return this;
  }

  /**
   * v10: 詳細地形パッチの中では DEM の水域（海面）として描く湖（中海）。湖面メッシュと isWater から外し、ラベルだけ残す。
   * load() の後・build() の前に呼ぶ。
   */
  suppressLakes(ids) {
    const set = new Set(ids);
    for (const lk of this.lakes) if (set.has(lk.id)) lk.hidden = true;
    this._buildIndex();
  }

  /** terrain.init() の後に呼ぶ（河川の遠景用の高さに粗地形を使うため） */
  build() {
    this._buildLakes();
    this._buildRivers();
  }

  setVisible(v) {
    this.visible = v;
    this.group.visible = v;
  }

  /* ------------------------------------------------------------------ */
  /* 湖                                                                   */
  /* ------------------------------------------------------------------ */
  _buildLakes() {
    const pos = [];
    const idx = [];
    const triItem = [];
    this.lakes.forEach((lk, li) => {
      if (lk.hidden) return; // v10
      const contour = lk.wrings[0].map((p) => new THREE.Vector2(p.x, p.z));
      const holes = lk.wrings.slice(1).map((r) => r.map((p) => new THREE.Vector2(p.x, p.z)));
      const tris = THREE.ShapeUtils.triangulateShape(contour, holes);
      const all = [contour, ...holes].flat();
      const base = pos.length / 3;
      for (const v of all) pos.push(v.x, lk.y, v.y);
      // ラベル位置：面積重心に最も近い三角形の重心（くびれた湖でも湖面の上に置く）
      let cx = 0;
      let cz = 0;
      let A = 0;
      const tc = [];
      for (const [a, b, c] of tris) {
        // 上から見て反時計回り（法線 +Y）にそろえる
        const pa = all[a], pb = all[b], pc = all[c];
        const cross = (pb.x - pa.x) * (pc.y - pa.y) - (pb.y - pa.y) * (pc.x - pa.x);
        if (cross > 0) idx.push(base + a, base + c, base + b);
        else idx.push(base + a, base + b, base + c);
        triItem.push(li);
        const ar = Math.abs(cross) / 2;
        const gx = (pa.x + pb.x + pc.x) / 3;
        const gz = (pa.y + pb.y + pc.y) / 3;
        cx += gx * ar;
        cz += gz * ar;
        A += ar;
        tc.push([gx, gz, ar]);
      }
      cx /= A;
      cz /= A;
      let best = tc[0];
      let bd = Infinity;
      for (const t of tc) {
        const d = Math.hypot(t[0] - cx, t[1] - cz) / Math.sqrt(t[2] + 0.05);
        if (d < bd) {
          bd = d;
          best = t;
        }
      }
      lk.labelX = best[0];
      lk.labelZ = best[1];
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(pos.length).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    g.setIndex(idx);
    g.computeBoundingSphere();
    const mat = new THREE.MeshPhongMaterial({ color: LAKE_COLOR, specular: 0x3a4a55, shininess: 90 });
    mat.name = 'water-lakes';
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = 'lakes';
    mesh.matrixAutoUpdate = false;
    mesh.userData = { kind: 'lakes', items: this.lakes.map(({ id, name, type, lat, lon }) => ({ id, name, type, lat, lon })), triItem: Uint8Array.from(triItem) };
    this.lakeMesh = mesh;
    this.group.add(mesh);
    this.stats.lakeTris = idx.length / 3;
  }

  /* ------------------------------------------------------------------ */
  /* 河川                                                                 */
  /* ------------------------------------------------------------------ */
  _buildRivers() {
    const t = this.terrain;
    const pos = [];
    const coarseY = [];
    const tile = [];
    const idx = [];
    const triItem = [];
    // 粗タイルは 4km セルを 2 枚の三角形で描くので、セルの 4 隅の最大値を上限として使う
    const coarseM = (x, z) => {
      const i = Math.floor((x - t.x0) / t.cstep);
      const j = Math.floor((z - t.z0) / t.cstep);
      return Math.max(t._coarseAt(i, j), t._coarseAt(i + 1, j), t._coarseAt(i, j + 1), t._coarseAt(i + 1, j + 1));
    };
    const tileSize = t.chunk * 2;
    this.rivers.forEach((rv, ri) => {
      const P = rv.pts;
      const n = P.length;
      if (n < 2) return;
      const base = pos.length / 3;
      for (let i = 0; i < n; i++) {
        const a = P[Math.max(0, i - 1)];
        const b = P[Math.min(n - 1, i + 1)];
        let tx = b.x - a.x;
        let tz = b.z - a.z;
        const tl = Math.hypot(tx, tz) || 1;
        tx /= tl;
        tz /= tl;
        // 角でも川幅が極端に変わらないよう、前後の線分の法線の平均（マイター長は 1.6 倍まで）
        let mx = -tz;
        let mz = tx;
        let miter = 1;
        if (i > 0 && i < n - 1) {
          const ax = P[i].x - P[i - 1].x, az = P[i].z - P[i - 1].z;
          const al = Math.hypot(ax, az) || 1;
          const nx1 = -az / al, nz1 = ax / al;
          miter = Math.min(1.6, 1 / Math.max(0.2, mx * nx1 + mz * nz1));
        }
        const hw = P[i].hw * miter;
        const lx = P[i].x + mx * hw, lz = P[i].z + mz * hw;
        const rx = P[i].x - mx * hw, rz = P[i].z - mz * hw;
        const y = P[i].h * M2Y;
        pos.push(lx, y, lz, rx, y, rz);
        // 遠景（粗タイル）用：川の中心・両岸の粗地形のうち最も高い所より少し上
        const cm = Math.max(P[i].h, coarseM(P[i].x, P[i].z), coarseM(lx, lz), coarseM(rx, rz)) + COARSE_LIFT_M;
        coarseY.push(cm * M2Y, cm * M2Y);
        const ti = Math.floor((P[i].x - t.x0) / tileSize);
        const tj = Math.floor((P[i].z - t.z0) / tileSize);
        tile.push(ti, tj, ti, tj);
        if (i < n - 1) {
          const k = base + i * 2;
          // 上から見て反時計回り（左岸 L, 右岸 R の順で並べたストリップ）
          idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
          triItem.push(ri, ri);
        }
      }
    });
    // 向きをそろえる（流れの向きによって裏返る区間があるので法線 +Y 側を表に）
    for (let q = 0; q < idx.length; q += 3) {
      const a = idx[q] * 3, b = idx[q + 1] * 3, c = idx[q + 2] * 3;
      const cross = (pos[b] - pos[a]) * (pos[c + 2] - pos[a + 2]) - (pos[b + 2] - pos[a + 2]) * (pos[c] - pos[a]);
      if (cross > 0) {
        const tmp = idx[q + 1];
        idx[q + 1] = idx[q + 2];
        idx[q + 2] = tmp;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(pos.length).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    g.setAttribute('aCoarseY', new THREE.Float32BufferAttribute(coarseY, 1));
    g.setAttribute('aTile', new THREE.Float32BufferAttribute(tile, 2));
    g.setIndex(idx);
    g.computeBoundingSphere();

    // 粗タイル (tx, tz) の詳細化フラグ（1 = 詳細タイル表示中）
    const data = new Uint8Array(SPLIT_TEX * SPLIT_TEX);
    const tex = new THREE.DataTexture(data, SPLIT_TEX, SPLIT_TEX, THREE.RedFormat, THREE.UnsignedByteType);
    tex.minFilter = tex.magFilter = THREE.NearestFilter;
    tex.needsUpdate = true;
    this.splitTex = tex;
    this.splitData = data;

    const mat = new THREE.MeshPhongMaterial({ color: RIVER_COLOR, specular: 0x3a4a55, shininess: 70 });
    mat.name = 'water-rivers';
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uSplit = { value: tex };
      sh.vertexShader = sh.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          attribute float aCoarseY;
          attribute vec2 aTile;
          uniform sampler2D uSplit;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          float split = texelFetch(uSplit, ivec2(clamp(aTile, 0.0, ${SPLIT_TEX - 1}.0)), 0).r;
          if (split < 0.5) transformed.y = aCoarseY;`,
        );
    };
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = 'rivers';
    mesh.matrixAutoUpdate = false;
    mesh.userData = { kind: 'rivers', items: this.rivers.map(({ id, name, type, lat, lon }) => ({ id, name, type, lat, lon })), triItem: Uint8Array.from(triItem) };
    this.riverMesh = mesh;
    this.group.add(mesh);
    this.stats.riverTris = idx.length / 3;
  }

  /** 毎フレーム：地形 LOD（粗タイルの詳細化状態）を河川のシェーダへ渡す */
  update() {
    if (!this.splitData) return;
    let changed = false;
    for (const tl of this.terrain.coarseTiles) {
      if (tl.tx >= SPLIT_TEX || tl.tz >= SPLIT_TEX) continue;
      const k = tl.tz * SPLIT_TEX + tl.tx;
      const v = tl.split ? 255 : 0;
      if (this.splitData[k] !== v) {
        this.splitData[k] = v;
        changed = true;
      }
    }
    if (changed) this.splitTex.needsUpdate = true;
  }

  /* ------------------------------------------------------------------ */
  /* 水域マスク（都市の建物配置用）                                         */
  /* ------------------------------------------------------------------ */
  _buildIndex() {
    this.bx0 = -1100;
    this.bz0 = -900;
    this.bnx = Math.ceil(2200 / BUCKET);
    this.bnz = Math.ceil(1900 / BUCKET);
    this.buckets = new Map();
    const add = (i, j, o) => {
      const k = j * this.bnx + i;
      let b = this.buckets.get(k);
      if (!b) this.buckets.set(k, (b = []));
      if (b[b.length - 1] !== o) b.push(o);
    };
    const M = 1.0; // 余裕
    for (const lk of this.lakes) {
      if (lk.hidden) continue; // v10
      for (let j = Math.floor((lk.minZ - M - this.bz0) / BUCKET); j <= Math.floor((lk.maxZ + M - this.bz0) / BUCKET); j++)
        for (let i = Math.floor((lk.minX - M - this.bx0) / BUCKET); i <= Math.floor((lk.maxX + M - this.bx0) / BUCKET); i++)
          add(i, j, { lake: lk });
    }
    for (const rv of this.rivers) {
      const P = rv.pts;
      for (let k = 0; k < P.length - 1; k++) {
        const a = P[k], b = P[k + 1];
        const seg = { ax: a.x, az: a.z, bx: b.x, bz: b.z, hw: Math.max(a.hw, b.hw) };
        const r = seg.hw + M;
        for (let j = Math.floor((Math.min(a.z, b.z) - r - this.bz0) / BUCKET); j <= Math.floor((Math.max(a.z, b.z) + r - this.bz0) / BUCKET); j++)
          for (let i = Math.floor((Math.min(a.x, b.x) - r - this.bx0) / BUCKET); i <= Math.floor((Math.max(a.x, b.x) + r - this.bx0) / BUCKET); i++)
            add(i, j, { seg });
      }
    }
  }

  /**
   * (x, z) が湖面・川面の上、またはその岸から margin [km] 以内なら true
   * @param {number} x
   * @param {number} z
   * @param {number} [margin]
   */
  isWater(x, z, margin = 0.25) {
    if (!this.buckets) return false;
    const b = this.buckets.get(Math.floor((z - this.bz0) / BUCKET) * this.bnx + Math.floor((x - this.bx0) / BUCKET));
    if (!b) return false;
    for (const o of b) {
      if (o.seg) {
        const s = o.seg;
        const dx = s.bx - s.ax, dz = s.bz - s.az;
        const L2 = dx * dx + dz * dz || 1e-9;
        let t = ((x - s.ax) * dx + (z - s.az) * dz) / L2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = x - (s.ax + t * dx), ez = z - (s.az + t * dz);
        const r = s.hw + margin;
        if (ex * ex + ez * ez < r * r) return true;
      } else {
        const lk = o.lake;
        if (x < lk.minX - margin || x > lk.maxX + margin || z < lk.minZ - margin || z > lk.maxZ + margin) continue;
        if (inRings(x, z, lk.wrings) || nearRings(x, z, lk.wrings, margin)) return true;
      }
    }
    return false;
  }

  /* ------------------------------------------------------------------ */
  /* ラベル                                                               */
  /* ------------------------------------------------------------------ */
  labelItems() {
    const out = [];
    for (const lk of this.lakes) {
      const L = LABEL.lake[lk.rank] ?? LABEL.lake[2];
      const y = lk.y;
      out.push({
        id: lk.id, name: lk.name, type: 'lake', x: lk.labelX, z: lk.labelZ,
        // 富士五湖は近づいたときだけ個別名（遠景はまとめラベル）
        maxDist: lk.group ? 95 : L.maxDist, prio: L.prio, getY: () => y + 0.25, meta: lk,
      });
    }
    for (const it of this.labels) {
      const w = latLonToWorld(it.lat, it.lon);
      const L = LABEL.lake[it.rank] ?? LABEL.lake[1];
      out.push({
        id: it.id, name: it.name, type: 'lake', x: w.x, z: w.z,
        maxDist: it.farOnly ? 420 : L.maxDist, minDist: it.farOnly ? 95 : 0, prio: L.prio, meta: it,
      });
    }
    for (const rv of this.rivers) {
      const P = rv.pts;
      // 河川名は近距離だけ。長い川は 2 か所（上流寄り・下流寄り）
      const fr = rv.lengthKm > 140 ? [0.35, 0.75] : [0.55];
      let s = 0;
      const acc = [0];
      for (let k = 1; k < P.length; k++) acc.push((s += Math.hypot(P[k].x - P[k - 1].x, P[k].z - P[k - 1].z)));
      for (const f of fr) {
        const target = s * f;
        let k = acc.findIndex((v) => v >= target);
        if (k < 0) k = P.length - 1;
        const p = P[k];
        const y = p.h * M2Y;
        out.push({
          id: `${rv.id}#${f}`, name: rv.name, type: 'river', x: p.x, z: p.z,
          maxDist: LABEL.river.maxDist, prio: LABEL.river.prio, getY: (g) => Math.max(g, y) + 0.3, meta: rv,
        });
      }
    }
    return out;
  }
}

function inRing(x, z, ring) {
  let ins = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) ins = !ins;
  }
  return ins;
}

function inRings(x, z, rings) {
  if (!inRing(x, z, rings[0])) return false;
  for (let k = 1; k < rings.length; k++) if (inRing(x, z, rings[k])) return false;
  return true;
}

function nearRings(x, z, rings, r) {
  const r2 = r * r;
  for (const ring of rings)
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[j], b = ring[i];
      const dx = b.x - a.x, dz = b.z - a.z;
      let t = ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1e-9);
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = x - (a.x + t * dx), ez = z - (a.z + t * dz);
      if (ex * ex + ez * ez < r2) return true;
    }
  return false;
}
