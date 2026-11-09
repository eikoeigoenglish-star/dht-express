/**
 * vehicles.js — 【v7】FOREST SCHOOL の列車・船（GLB）の配置と「昨日 → 今日」の移動アニメーション
 * ---------------------------------------------------------------------------
 * 距離 → 位置は既存の距離エンジン（route.js）をそのまま使う。
 *   列車 : journey.rail.getPositionAtDistance(km)       … 陸路（東京 0 → 鹿児島中央 1325.9 km）
 *   船   : journey の ferry 区間（累積 1325.9 → 2060.9 km）を区間内 km に直して
 *          journey.ferry.getPositionAtDistance(segmentKm) … 海路（鹿児島新港 → 那覇）
 *   接続区間（鹿児島中央 → 鹿児島新港）はアニメーション対象外。
 *
 * 表示用距離（累積 km。prev = 昨日まで、cur = 今日）
 *   列車 start = min(prev, 1325.9)、end = min(cur, 1325.9)     → cur が海路なら鹿児島中央で停止
 *   船   start = clamp(max(prev, 1325.9), 1325.9, 2060.9)、end = clamp(max(cur, 1325.9), …)
 *        cur ≤ 1325.9 の間は鹿児島新港で出航待ち、那覇到達後は終点で停止
 *
 * 見え方
 *   ・向き：ルートの接線（km ± 車体長の 4 割の 2 点）。常に進行方向（東京 → 那覇）を向く。
 *   ・高さ：列車はルート線と同じ規則（周囲の最大標高 + 市街地の持ち上げ + 距離に応じた持ち上げ）の上に、
 *           車体の前・中・後の 3 点の最大値で置く（坂・山で端が地面にめり込まない）。
 *           船は海面（Y = 0）のわずかに上。
 *   ・大きさ：画面上で一定の長さ（列車 約 64px・船 約 58px）になるよう、カメラ距離に応じて
 *           車体長を 0.4〜44 km の範囲で変える（近景では実物に近い大きさ、遠景でも位置が分かる）。
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VERTICAL_EXAGGERATION } from './geo.js';
import { makeLiveryMaterial } from './livery.js';

const M2Y = VERTICAL_EXAGGERATION / 1000;
export const RAIL_END_KM = 1325.9;

const STYLE = {
  // px: 画面上の目標の長さ / min・max: 車体長 [km] / hover: 浮かせる量（車体長に対する比）
  train: { px: 64, min: 0.4, max: 44, hover: 0.015 },
  ship: { px: 58, min: 0.36, max: 40, hover: 0.006 },
};

const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class VehicleSystem {
  /**
   * @param {import('./terrain.js').TerrainSystem} terrain
   * @param {{ renderer?: THREE.WebGLRenderer, urbanAt?: (x:number, z:number)=>number }} [opts]
   */
  constructor(terrain, opts = {}) {
    this.terrain = terrain;
    this.renderer = opts.renderer ?? null;
    this.urbanAt = opts.urbanAt ?? null;
    this.group = new THREE.Group();
    this.group.name = 'dht-vehicles';
    this.train = null;
    this.ship = null;
    this.journey = null;
    this.plan = null;
    this.anim = null; // { t, timeline: [{kind, t0, t1}] }
    this.liveKm = null;
    this.onLive = null;
    this._p = {};
    this._q = {};
    this._v = new THREE.Vector3();
    this.tags = null; // 遠景用の小さな札（画面上で車体が小さいときだけ出す）
  }

  /** 遠景で位置が分かるように、車体の上に小さな札を出す（labels-layer に追加） */
  attachTags(layer) {
    const mk = (kind, text) => {
      const el = document.createElement('div');
      el.className = `vehicle-tag vehicle-tag--${kind}`;
      el.textContent = text;
      el.style.display = 'none';
      layer.appendChild(el);
      return el;
    };
    this.tags = { train: mk('train', '列車'), ship: mk('ship', '船') };
  }

  _tag(obj, camera, w, h, onScreenPx) {
    const el = this.tags?.[obj.userData.kind];
    if (!el) return;
    const v = this._v.copy(obj.position);
    v.y += obj.userData.lengthKm * 0.3;
    v.project(camera);
    const show = obj.visible && onScreenPx < 34 && v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05 && !(obj.userData.kind === 'ship' && this.plan?.ship.docked && this.plan.cur < 1200);
    if (!show) {
      if (el.style.display !== 'none') el.style.display = 'none';
      return;
    }
    el.style.display = 'block';
    el.style.transform = `translate(${((v.x + 1) * 0.5 * w).toFixed(1)}px, ${((1 - v.y) * 0.5 * h).toFixed(1)}px) translate(-50%, -100%) translateY(-6px)`;
  }

  /** GLB を読み込み、塗装マテリアルに差し替える */
  async load(urls) {
    const loader = new GLTFLoader();
    const [t, s] = await Promise.all([loader.loadAsync(urls.train), loader.loadAsync(urls.ship)]);
    this.train = this._wrap(t.scene, 'train');
    this.ship = this._wrap(s.scene, 'ship');
    this.group.add(this.train, this.ship);
  }

  _wrap(scene, kind) {
    const mat = makeLiveryMaterial(kind, this.renderer);
    scene.traverse((o) => {
      if (o.isMesh) {
        o.material = mat;
        o.castShadow = o.receiveShadow = false;
      }
    });
    // GLB は +Z が先頭。ルートの headingRad は -Z（北）向き = 0 なので、180° 回してから置く
    scene.rotation.y = Math.PI;
    const g = new THREE.Group();
    g.name = `vehicle-${kind}`;
    g.add(scene);
    g.visible = false;
    g.userData = { kind, km: null, lengthKm: 1 };
    return g;
  }

  setJourney(journey) {
    this.journey = journey;
    this.ferrySeg = journey.segments.find((s) => s.type === 'ferry') ?? null;
    this.railEnd = journey.transferKm ?? journey.rail?.totalKm ?? RAIL_END_KM;
    this.journeyEnd = journey.totalKm;
  }

  /**
   * 昨日・今日の累積 km から列車・船の始点と終点を決める
   * @param {{ previousKm:number, currentKm:number }} p
   */
  setProgress(p) {
    const E = this.railEnd;
    const END = this.journeyEnd;
    const prev = clamp(p.previousKm, 0, END);
    const cur = clamp(p.currentKm, 0, END);
    const train = { from: Math.min(prev, E), to: Math.min(cur, E) };
    train.moving = Math.abs(train.to - train.from) > 1e-6;
    const ship = { from: clamp(Math.max(prev, E), E, END), to: clamp(Math.max(cur, E), E, END) };
    ship.moving = Math.abs(ship.to - ship.from) > 1e-6;
    ship.active = cur > E; // 出航済み（cur ≤ 1325.9 は鹿児島新港で出航待ち）
    ship.docked = !ship.active;
    this.plan = { prev, cur, train, ship };
    this.train.userData.km = train.from;
    this.ship.userData.km = ship.from;
    this.train.visible = this.ship.visible = true;
    this.liveKm = prev;
    this.anim = null;
    return this.plan;
  }

  /** 1 回再生（約 4〜8 秒）。増分 0 km ならその場に静止 */
  play(delay = 0.8) {
    if (!this.plan) return;
    const { train, ship } = this.plan;
    const dur = (dk) => clamp(4.5 + Math.abs(dk) / 60, 4.5, 7.0);
    const timeline = [];
    let t = delay;
    if (train.moving && ship.moving) {
      // 陸路 → 海路の順に（合計 ≤ 8 秒）
      const total = Math.min(8, dur(train.to - train.from + ship.to - ship.from) + 1);
      const a = clamp(total * (Math.abs(train.to - train.from) / (Math.abs(train.to - train.from) + Math.abs(ship.to - ship.from))), 2.5, total - 2.5);
      timeline.push({ kind: 'train', t0: t, t1: t + a }, { kind: 'ship', t0: t + a, t1: t + total });
    } else if (train.moving) timeline.push({ kind: 'train', t0: t, t1: t + dur(train.to - train.from) });
    else if (ship.moving) timeline.push({ kind: 'ship', t0: t, t1: t + dur(ship.to - ship.from) });
    this.train.userData.km = train.from;
    this.ship.userData.km = ship.from;
    this.anim = timeline.length ? { t: 0, timeline, end: timeline[timeline.length - 1].t1 } : null;
    this.liveKm = this.plan.prev;
    if (!this.anim) this.liveKm = this.plan.cur;
  }

  get playing() {
    return !!this.anim && this.anim.t < this.anim.end;
  }

  /** 累積 km → 位置（列車は陸路、船は海路） */
  positionAt(kind, km, out = {}) {
    const J = this.journey;
    if (kind === 'train') return J.rail.getPositionAtDistance(clamp(km, 0, J.rail.totalKm), out);
    const seg = this.ferrySeg;
    const local = ((clamp(km, seg.fromKm, seg.toKm) - seg.fromKm) * seg.route.totalKm) / (seg.toKm - seg.fromKm);
    return seg.route.getPositionAtDistance(local, out);
  }

  /** ルート線と同じ高さの規則（詳細地形の周囲最大 + 市街地の持ち上げ） */
  _railBaseY(x, z) {
    const t = this.terrain;
    const R = 0.45;
    let m = t.getHeightMeters(x, z);
    m = Math.max(m, t.getHeightMeters(x + R, z), t.getHeightMeters(x - R, z), t.getHeightMeters(x, z + R), t.getHeightMeters(x, z - R));
    let y = Math.max(0, m * M2Y);
    if (this.urbanAt) y += this.urbanAt(x, z) * 0.42;
    return y;
  }

  _coarseY(x, z) {
    const t = this.terrain;
    return t.coarse ? Math.max(0, t.getCoarseHeightMeters(x, z) * M2Y) : 0;
  }

  /** 車両 1 台をカメラに合わせて配置 */
  _place(obj, camera, pxPerUnitAtDepth) {
    const kind = obj.userData.kind;
    const S = STYLE[kind];
    const km = obj.userData.km;
    const p = this.positionAt(kind, km, this._p);
    // 画面上で一定の長さになる車体長
    const d = Math.max(0.05, camera.position.distanceTo(new THREE.Vector3(p.x, p.y ?? 0, p.z)));
    const L = clamp(S.px / pxPerUnitAtDepth(d), S.min, S.max);
    obj.scale.setScalar(L);
    obj.userData.lengthKm = L;
    // 接線：km ± 0.4L
    const dk = Math.max(0.15, L * 0.4);
    const a = this.positionAt(kind, km - dk, this._q);
    const ax = a.x, az = a.z;
    const b = this.positionAt(kind, km + dk, this._q);
    let dx = b.x - ax;
    let dz = b.z - az;
    if (dx * dx + dz * dz < 1e-10) {
      obj.rotation.y = p.headingRad;
    } else {
      obj.rotation.y = Math.atan2(-dx, -dz);
    }
    // 高さ
    let y;
    if (kind === 'train') {
      const blend = THREE.MathUtils.smoothstep(d, 120, 200); // ルート線と同じく遠景では粗い地形も考慮
      const h = (x, z) => {
        const yh = this._railBaseY(x, z);
        return yh + (Math.max(yh, this._coarseY(x, z)) - yh) * blend;
      };
      y = Math.max(h(p.x, p.z), h(ax, az), h(b.x, b.z));
      y += clamp(d * 0.0022, 0.035, 3.0); // ルート線の持ち上げと同じ
    } else {
      // 海面（Y=0）。港の近くでステージの陸地にかかる場合も地表より上に
      y = Math.max(0, this.terrain.getSurfaceY(p.x, p.z)) + clamp(d * 0.0008, 0.004, 1.0);
    }
    obj.position.set(p.x, y + S.hover * L, p.z);
    return L * pxPerUnitAtDepth(d); // 画面上の長さ [px]
  }

  /** 毎フレーム */
  update(camera, dt, viewportH, viewportW) {
    if (!this.plan || !this.journey) return;
    if (this.anim && this.anim.t < this.anim.end) {
      this.anim.t += dt;
      const { train, ship } = this.plan;
      for (const seg of this.anim.timeline) {
        const u = easeInOutCubic(clamp((this.anim.t - seg.t0) / (seg.t1 - seg.t0), 0, 1));
        const P = seg.kind === 'train' ? train : ship;
        const obj = seg.kind === 'train' ? this.train : this.ship;
        obj.userData.km = P.from + (P.to - P.from) * u;
        if (this.anim.t >= seg.t0) this.liveKm = obj.userData.km;
      }
      // 列車が終わって船の番の間は「鹿児島中央 = 鹿児島新港 = 1325.9」
      if (this.anim.t >= this.anim.end) this.liveKm = this.plan.cur;
      this.onLive?.(this.liveKm);
    }
    const proj11 = camera.projectionMatrix.elements[5];
    const ppu = (depth) => (0.5 * viewportH * proj11) / depth;
    const pt = this._place(this.train, camera, ppu);
    const ps = this._place(this.ship, camera, ppu);
    const w = viewportW ?? innerWidth;
    this._tag(this.train, camera, w, viewportH, pt);
    this._tag(this.ship, camera, w, viewportH, ps);
  }

  /** カメラを向けるためのプリセット（緯度経度・距離） */
  focusPreset(kind) {
    const obj = kind === 'ship' ? this.ship : this.train;
    const km = this.plan ? (kind === 'ship' ? this.plan.ship.to : this.plan.train.to) : obj.userData.km ?? 0;
    const p = this.positionAt(kind, km);
    const az = (((p.headingRad * 180) / Math.PI + 35) % 360 + 360) % 360; // 進行方向の斜め後ろから（azimuth 0 = 南から北を見る）
    return { id: `dht-${kind}`, label: kind === 'ship' ? '船' : '列車', lat: p.lat, lon: p.lon, dist: 14, polar: 62, azimuth: az };
  }
}
