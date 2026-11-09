/**
 * lighthouses.js — 【v8】灯台 13 件の灯火（夕方・夜に点灯）
 * ---------------------------------------------------------------------------
 * 灯台の建物そのものは landmarks-v8.json のランドマーク（kind: lighthouseV8。犬吠埼は v6 の既存モデル）として
 * LandmarkSystem が作る（LOD・ラベル・建物除外は他のランドマークと同じ）。ここでは「光」だけを描く。
 *
 *   ・灯火の光点：13 個を 1 つの InstancedMesh（カメラを向く板 + 自前シェーダ、加算合成）。
 *     近くでは灯室の大きさ、遠くでも最小 3px の光点（全国俯瞰でも海岸線に点々と見える）。
 *   ・回転する光芒：灯台ごとに反対向き 2 本 × 縦横 2 面 = 4 枚の細長い板を 1 つの InstancedMesh（52 枚）。
 *     毎フレーム 52 個の行列を更新するだけ（PointLight・影・ポストプロセスなし）。
 *   ・光芒がカメラの方を向いた瞬間に光点が明るくなる（閃光）。
 *   ・明るさは timeofday.js の uLighthouse（MORNING / DAY = 0、EVENING / NIGHT = 1）。0 のときは描画しない。
 * draw call：+2（点灯時のみ）
 */
import * as THREE from 'three';
import { latLonToWorld } from './geo.js';
import { TOD_UNIFORMS } from './timeofday.js';

const GLOW_VERT = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  attribute vec3 iPos;
  attribute float iFlash;
  uniform float uViewportH;
  uniform float uLighthouse;
  varying vec2 vUv;
  varying float vA;
  void main() {
    vec4 mv = modelViewMatrix * vec4( iPos, 1.0 );
    float depth = max( 0.001, -mv.z );
    float pxPerUnit = 0.5 * uViewportH * projectionMatrix[ 1 ][ 1 ] / depth;
    float px = clamp( 0.03 * pxPerUnit, 4.2, 11.0 ) * ( 1.0 + 0.7 * iFlash );
    float half_ = px / pxPerUnit * 3.0;
    if ( uLighthouse < 0.01 ) half_ = 0.0;
    mv.xy += position.xy * half_;
    vUv = position.xy * 3.0;
    vA = uLighthouse * ( 0.8 + 0.6 * iFlash );
    gl_Position = projectionMatrix * mv;
    #include <logdepthbuf_vertex>
    #ifdef USE_LOGARITHMIC_DEPTH_BUFFER
      vFragDepth = 1.0 + max( 0.0001, gl_Position.w - half_ );
    #endif
  }
`;
const GLOW_FRAG = /* glsl */ `
  #include <logdepthbuf_pars_fragment>
  varying vec2 vUv;
  varying float vA;
  void main() {
    float r = length( vUv );
    if ( r > 3.0 ) discard;
    float core = 1.0 - smoothstep( 0.6, 1.0, r );
    float glow = exp( -r * r * 1.1 ) * 0.55 + exp( -r * 1.5 ) * 0.25;
    vec3 col = mix( vec3( 1.0, 0.78, 0.42 ), vec3( 1.0, 0.97, 0.86 ), core );
    float a = clamp( core + glow, 0.0, 1.0 ) * vA;
    gl_FragColor = vec4( col * a, a );
    #include <logdepthbuf_fragment>
  }
`;

const BEAM_VERT = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4( position, 1.0 );
    #include <logdepthbuf_vertex>
  }
`;
const BEAM_FRAG = /* glsl */ `
  #include <logdepthbuf_pars_fragment>
  uniform float uLighthouse;
  varying vec2 vUv;
  void main() {
    // u = 0（灯室）→ 1（先端）、v = 0..1（幅方向）
    float along = 1.0 - smoothstep( 0.0, 1.0, vUv.x );
    float across = 1.0 - abs( vUv.y * 2.0 - 1.0 );
    float a = along * along * pow( across, 1.6 ) * 0.42 * uLighthouse;
    gl_FragColor = vec4( vec3( 1.0, 0.92, 0.72 ) * a, a );
    #include <logdepthbuf_fragment>
  }
`;

export class LighthouseBeacons {
  /**
   * @param {import('./terrain.js').TerrainSystem} terrain
   * @param {import('./landmarks.js').LandmarkSystem} landmarks
   */
  constructor(terrain, landmarks) {
    this.terrain = terrain;
    this.landmarks = landmarks;
    this.group = new THREE.Group();
    this.group.name = 'lighthouse-beacons';
    this.items = [];
    this.phase = 0;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    this._p = new THREE.Vector3();
    this._e = new THREE.Euler();
  }

  /** landmarks（読み込み済み）から灯台を拾って光を作る */
  build() {
    const lms = this.landmarks.items.filter((it) => it.lighthouse);
    this.items = lms.map((it, i) => {
      const w = latLonToWorld(it.lat, it.lon);
      return { id: it.id, name: it.name, lm: it, x: w.x, z: w.z, y: 0.2, h: it.lighthouse.heightKm, period: it.lighthouse.periodSec ?? 10, phase0: (i * 0.37) % 1 };
    });
    const n = this.items.length;
    // 光点
    const quad = new THREE.PlaneGeometry(2, 2);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    this.iPos = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    this.iFlash = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
    geo.setAttribute('iPos', this.iPos);
    geo.setAttribute('iFlash', this.iFlash);
    geo.instanceCount = n;
    this.glowUniforms = { uViewportH: { value: 800 }, uLighthouse: TOD_UNIFORMS.uLighthouse };
    const gm = new THREE.ShaderMaterial({
      uniforms: this.glowUniforms,
      vertexShader: GLOW_VERT,
      fragmentShader: GLOW_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.glow = new THREE.Mesh(geo, gm);
    this.glow.name = 'lighthouse-glow';
    this.glow.frustumCulled = false;
    this.glow.renderOrder = 6;
    // 光芒：+X 方向へ伸びる細長い板（長さ 1、幅 1 を行列で拡大）
    const beamGeo = new THREE.PlaneGeometry(1, 1);
    beamGeo.translate(0.5, 0, 0);
    const bm = new THREE.ShaderMaterial({
      uniforms: { uLighthouse: TOD_UNIFORMS.uLighthouse },
      vertexShader: BEAM_VERT,
      fragmentShader: BEAM_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    this.beams = new THREE.InstancedMesh(beamGeo, bm, n * 4);
    this.beams.name = 'lighthouse-beams';
    this.beams.frustumCulled = false;
    this.beams.renderOrder = 5;
    this.group.add(this.beams, this.glow);
    return this;
  }

  /** 灯室の高さ：ランドマークのモデルができていればその頂部、なければ地表 + 灯台の高さ */
  _topY(it) {
    const m = it.lm.mesh;
    const base = m ? m.position.y : Math.max(0, this.terrain.getSurfaceY(it.x, it.z));
    const top = m ? (it.lm.lampY ?? it.lm.lighthouse.lampY ?? it.h * 0.86) : it.h * 0.9;
    return base + top;
  }

  update(camera, dt, viewportH) {
    if (!this.items.length) return;
    const on = TOD_UNIFORMS.uLighthouse.value;
    this.group.visible = on > 0.01;
    if (!this.group.visible) return;
    this.glowUniforms.uViewportH.value = viewportH;
    const cam = camera.position;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      it.y = this._topY(it);
      this.iPos.setXYZ(i, it.x, it.y, it.z);
      const ang = ((TOD_UNIFORMS.uTime.value / it.period + it.phase0) % 1) * Math.PI * 2;
      // カメラの方向と光芒の向きが揃ったら閃光
      const toCam = Math.atan2(-(cam.z - it.z), cam.x - it.x);
      let flash = 0;
      for (const k of [0, Math.PI]) {
        const d = Math.atan2(Math.sin(ang + k - toCam), Math.cos(ang + k - toCam));
        flash = Math.max(flash, Math.exp(-(d * d) / 0.02));
      }
      this.iFlash.setX(i, flash);
      // 光芒の長さ・太さは距離に応じて（近景 2.5km、遠景は最大 14km）
      const dist = Math.hypot(cam.x - it.x, cam.y - it.y, cam.z - it.z);
      const L = THREE.MathUtils.clamp(dist * 0.06, 2.5, 14);
      const W = L * 0.07;
      for (let k = 0; k < 2; k++) {
        const a = ang + k * Math.PI;
        for (let pl = 0; pl < 2; pl++) {
          this._e.set(pl ? Math.PI / 2 : 0, a, 0, 'YXZ');
          this._q.setFromEuler(this._e);
          this._s.set(L, W, 1);
          this._p.set(it.x, it.y, it.z);
          this._m.compose(this._p, this._q, this._s);
          this.beams.setMatrixAt(i * 4 + k * 2 + pl, this._m);
        }
      }
    }
    this.iPos.needsUpdate = true;
    this.iFlash.needsUpdate = true;
    this.beams.instanceMatrix.needsUpdate = true;
  }
}
