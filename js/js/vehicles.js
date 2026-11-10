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
 *
 * 【v10】
 *   ・浮遊感：列車はリニアモーターカーのように上下 0.5% 車体長・周期 2.4 秒でふわふわ（わずかなピッチ）。
 *           船は海面で上下（周期 3.6 秒）＋ピッチ（4.3 秒）＋ロール（5.6 秒）の「ぷかぷか」。
 *           VEHICLE VIEW のカメラは揺れを含まない高さ（userData.baseY）を追うので画面は揺れない。
 *   ・夕方・夜：車体の塗装は昼と同じように読める（livery.js）。さらに
 *           足元の淡い光（地面・海面に落ちる楕円の光）、前方を照らす光（列車のヘッドライト・船の前照灯）、
 *           ヘッドライトの小さな光芒、船の航海灯（左舷 赤・右舷 緑・マスト 白）を加算合成で描く。
 *           PointLight は使わない（全マテリアルの再コンパイル・負荷を避ける）。明るさは TOD_UNIFORMS.uVehicleLit。
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VERTICAL_EXAGGERATION } from './geo.js';
import { makeLiveryMaterial } from './livery.js';
import { TOD_UNIFORMS } from './timeofday.js';

const M2Y = VERTICAL_EXAGGERATION / 1000;
export const RAIL_END_KM = 1325.9;
const TRANSFER_SEC = 1.6; // v8: 陸 → 海をまたぐ日の乗換区間（VEHICLE VIEW のカメラが鹿児島中央 → 鹿児島新港へ移る時間）

const STYLE = {
  // px: 画面上の目標の長さ / min・max: 車体長 [km] / hover: 浮かせる量（車体長に対する比）
  train: { px: 64, min: 0.4, max: 44, hover: 0.015 },
  ship: { px: 58, min: 0.36, max: 40, hover: 0.006 },
};

/** v10: 浮遊感（振幅は車体長に対する比、角度は rad、周期は秒） */
const FLOAT = {
  train: { bob: 0.005, bobT: 2.4, pitch: 0.0035, pitchT: 3.1, roll: 0.0, rollT: 1 },
  ship: { bob: 0.0055, bobT: 3.6, pitch: 0.016, pitchT: 4.3, roll: 0.024, rollT: 5.6 },
};

/* ---------------------------------------------------------------------- */
/* v10: 夕方・夜の照明（足元の光・前方の光・ヘッドライト・航海灯）              */
/* ---------------------------------------------------------------------- */
const POOL_VERT = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    #include <logdepthbuf_vertex>
  }
`;
const POOL_FRAG = /* glsl */ `
  #include <logdepthbuf_pars_fragment>
  uniform float uVehicleLit;
  uniform vec3 uColor;
  uniform float uGain;
  uniform float uBeam; // 0 = 楕円の光だまり、1 = 前方へ広がる光（台形）
  varying vec2 vUv;
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float a;
    if ( uBeam > 0.5 ) {
      // v = 0（車体側）→ 1（先端）。先へ行くほど広く・弱く
      float w = mix( 0.28, 1.0, vUv.y );
      float across = 1.0 - smoothstep( 0.55 * w, w, abs( p.x ) );
      a = across * ( 1.0 - smoothstep( 0.15, 1.0, vUv.y ) ) * smoothstep( 0.0, 0.08, vUv.y );
    } else {
      float r = length( p );
      a = exp( -r * r * 2.6 ) * ( 1.0 - smoothstep( 0.75, 1.0, r ) );
    }
    a *= uVehicleLit * uGain;
    gl_FragColor = vec4( uColor * a, a );
    #include <logdepthbuf_fragment>
  }
`;

function glowTexture() {
  const S = 64;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.18, 'rgba(255,255,255,0.85)');
  gr.addColorStop(0.45, 'rgba(255,255,255,0.22)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
let _glowTex = null;

/** 車両のローカル座標（長さ 1、前 = -Z）で照明を作る。地面の光は毎フレーム地表の高さへ下ろす */
function makeVehicleLights(kind) {
  const g = new THREE.Group();
  g.name = `${kind}-lights`;
  const mkPool = (w, l, color, gain, beam) => {
    const m = new THREE.ShaderMaterial({
      uniforms: { uVehicleLit: TOD_UNIFORMS.uVehicleLit, uColor: { value: new THREE.Color(color) }, uGain: { value: gain }, uBeam: { value: beam ? 1 : 0 } },
      vertexShader: POOL_VERT,
      fragmentShader: POOL_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    const geo = new THREE.PlaneGeometry(w, l);
    geo.rotateX(-Math.PI / 2); // 水平（uv.y = 1 が -Z ＝ 前方）
    const mesh = new THREE.Mesh(geo, m);
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    return mesh;
  };
  const ground = new THREE.Group(); // 地表（海面）の高さへ下ろすもの
  ground.name = 'ground-lights';
  if (kind === 'train') {
    const pool = mkPool(1.5, 2.2, '#ffd29a', 0.62, false);
    const beam = mkPool(0.9, 3.0, '#fff1d0', 0.6, true);
    beam.position.z = -0.5 - 1.5 + 0.05;
    ground.add(pool, beam);
  } else {
    const pool = mkPool(1.6, 2.4, '#ffd6a4', 0.6, false);
    const beam = mkPool(0.8, 2.2, '#fff4dc', 0.45, true);
    beam.position.z = -0.5 - 1.1 + 0.04;
    ground.add(pool, beam);
  }
  g.add(ground);
  // 小さな光芒（スプライト）：位置はモデル座標を 180° 回した後の座標（前 = -Z）
  _glowTex ??= glowTexture();
  const sprites = [];
  const sp = (x, y, z, color, size) => {
    const m = new THREE.SpriteMaterial({ map: _glowTex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
    const s = new THREE.Sprite(m);
    s.position.set(x, y, z);
    s.scale.setScalar(size);
    s.userData.size = size;
    s.renderOrder = 7;
    g.add(s);
    sprites.push(s);
  };
  if (kind === 'train') {
    sp(0.09, 0.093, -0.5, '#fff0d2', 0.16);
    sp(-0.09, 0.093, -0.5, '#fff0d2', 0.16);
  } else {
    sp(0.0, 0.11, -0.49, '#fff0d2', 0.13); // 前照灯
    sp(0.155, 0.2, -0.05, '#3cff7a', 0.07); // 右舷灯（緑）
    sp(-0.155, 0.2, -0.05, '#ff3b3b', 0.07); // 左舷灯（赤）
    sp(0.0, 0.345, -0.12, '#ffffff', 0.07); // マスト灯（白）
  }
  return { group: g, ground, sprites };
}

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
    this.time = 0; // v10: 浮遊感の時刻
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
    g.userData = { kind, km: null, lengthKm: 1, baseY: 0 };
    const lights = makeVehicleLights(kind); // v10
    g.add(lights.group);
    g.userData.lights = lights;
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
      // v8: 列車（→ 鹿児島中央）と船（鹿児島新港 →）の間に乗換区間（接続線上を 1.6 秒。距離は 1325.9 km のまま）
      const tr = TRANSFER_SEC;
      timeline.push({ kind: 'train', t0: t, t1: t + a }, { kind: 'transfer', t0: t + a, t1: t + a + tr }, { kind: 'ship', t0: t + a + tr, t1: t + total + tr });
    } else if (train.moving) timeline.push({ kind: 'train', t0: t, t1: t + dur(train.to - train.from) });
    else if (ship.moving) timeline.push({ kind: 'ship', t0: t, t1: t + dur(ship.to - ship.from) });
    this.train.userData.km = train.from;
    this.ship.userData.km = ship.from;
    this.anim = timeline.length ? { t: 0, timeline, end: timeline[timeline.length - 1].t1 } : null;
    this.followOverride = null;
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
    const baseY = y + S.hover * L;
    obj.userData.baseY = baseY;
    // v10: 浮遊感（カメラの追跡は baseY を使う）
    const F = FLOAT[kind];
    const T = this.time;
    const ph = kind === 'ship' ? 1.3 : 0;
    const bob = F.bob * L * (Math.sin((T / F.bobT) * Math.PI * 2 + ph) * 0.8 + Math.sin((T / (F.bobT * 0.53)) * Math.PI * 2) * 0.2);
    obj.position.set(p.x, baseY + bob, p.z);
    obj.rotation.order = 'YXZ';
    obj.rotation.x = F.pitch * Math.sin((T / F.pitchT) * Math.PI * 2 + 0.7);
    obj.rotation.z = F.roll * Math.sin((T / F.rollT) * Math.PI * 2 + 2.1);
    // v10: 夕方・夜の照明（足元・前方の光は地表／海面の少し上へ下ろす。光芒は画面上で小さくなりすぎないように）
    const lt = obj.userData.lights;
    const lit = TOD_UNIFORMS.uVehicleLit.value;
    lt.group.visible = lit > 0.01;
    if (lt.group.visible) {
      const gy = kind === 'ship' ? 0 : Math.max(0, this.terrain.getSurfaceY(p.x, p.z));
      lt.ground.position.y = (gy + 0.004 - obj.position.y) / L;
      lt.ground.rotation.set(-obj.rotation.x, 0, -obj.rotation.z); // 揺れても光は水平のまま
      const px = L * pxPerUnitAtDepth(d);
      const k = clamp(26 / Math.max(1, px), 1, 4); // 遠景（車体が小さい）ほど光芒を相対的に大きく
      for (const sp of lt.sprites) {
        sp.scale.setScalar(sp.userData.size * k);
        sp.material.opacity = lit * 0.95;
      }
    }
    return L * pxPerUnitAtDepth(d); // 画面上の長さ [px]
  }

  /** 毎フレーム */
  update(camera, dt, viewportH, viewportW) {
    if (!this.plan || !this.journey) return;
    this.time += dt;
    if (this.anim && this.anim.t < this.anim.end) {
      this.anim.t += dt;
      const { train, ship } = this.plan;
      for (const seg of this.anim.timeline) {
        if (seg.kind === 'transfer') continue;
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

  /**
   * v8: VEHICLE VIEW の追跡対象（位置・進行方向）。
   *   再生中は「今動いている区間」の乗り物、乗換区間では鹿児島中央 → 鹿児島新港の接続線上の点、
   *   再生していなければ今日の担当（海路に入っていれば船、そうでなければ列車）。followOverride で固定も可。
   */
  followTarget() {
    if (!this.plan || !this.journey) return null;
    let kind = this.followOverride;
    let u = 0;
    if (!kind) {
      if (this.anim && this.anim.t < this.anim.end) {
        let cur = this.anim.timeline[0];
        for (const s of this.anim.timeline) if (this.anim.t >= s.t0) cur = s;
        kind = cur.kind;
        u = clamp((this.anim.t - cur.t0) / (cur.t1 - cur.t0), 0, 1);
      } else kind = this.plan.ship.active ? 'ship' : 'train';
    }
    if (kind === 'transfer') {
      const e = easeInOutCubic(u);
      const q = this.journey.getTransferPosition(e, this._tq ?? (this._tq = {}));
      const r = this.journey.getTransferPosition(Math.min(1, e + 0.05), this._tr ?? (this._tr = {}));
      const dx = r.x - q.x;
      const dz = r.z - q.z;
      // 乗換線の向き → 終盤は船の向きへなめらかに
      const hShip = this.ship.rotation.y;
      const hLine = dx * dx + dz * dz > 1e-8 ? Math.atan2(-dx, -dz) : hShip;
      const w = THREE.MathUtils.smoothstep(u, 0.55, 1);
      const heading = hLine + Math.atan2(Math.sin(hShip - hLine), Math.cos(hShip - hLine)) * w;
      return { kind, x: q.x, y: Math.max(0, this.terrain.getSurfaceY(q.x, q.z)) + 0.05, z: q.z, heading, lengthKm: 0.4 };
    }
    const obj = kind === 'ship' ? this.ship : this.train;
    // v10: 浮遊の揺れを含まない高さ（追跡カメラが揺れないように）
    return { kind, x: obj.position.x, y: obj.userData.baseY ?? obj.position.y, z: obj.position.z, heading: obj.rotation.y, lengthKm: obj.userData.lengthKm };
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
