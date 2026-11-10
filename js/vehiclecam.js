/**
 * vehiclecam.js — 【v8】VEHICLE VIEW：FOREST SCHOOL の列車・船を斜め後方から追う三人称カメラ
 * ---------------------------------------------------------------------------
 * ・追跡対象は vehicles.followTarget()（vehicles.js）：
 *     陸路（〜1325.9 km）は列車、海路（1325.9 km 超）は船。陸 → 海をまたぐ日は
 *     列車（→ 鹿児島中央）→ 乗換区間（鹿児島中央 → 鹿児島新港の接続線上を移動）→ 船、の順に切り替わる。
 * ・カメラ：乗り物の後方 BACK km・斜め（右後方 SIDE_DEG）、対地高度 ALT km（= 1.0 km）。
 *   注視点は乗り物の少し前方（進行方向の先も見える）。乗り物は画面中央のやや下に来る。
 * ・スムージング：
 *     位置 … 乗り物の位置にはほぼ遅れずに付いていく（高速の再生中でも画面から逃げない）
 *     向き … 進行方向の角度を時定数 0.9 秒で追い、旋回速度は毎秒 50° まで（急カーブでも急に回り込まない）
 *     高さ … カメラ直下と乗り物直下の地表の高い方 + ALT を時定数 0.5 秒で追う（山で地面に潜らない）
 * ・操作：ドラッグで追跡の方位を左右にずらす（離すとゆっくり真後ろへ戻る）、ホイールで距離 0.5〜4 倍。
 */
import * as THREE from 'three';

export const VEHICLE_VIEW = {
  ALT: 1.0, // 対地高度 [km]
  BACK: 2.6, // 後方距離 [km]
  SIDE_DEG: 18, // 斜め後方（右後ろ）
  AHEAD: 1.4, // 注視点：乗り物の前方 [km]
  YAW_TAU: 0.9,
  YAW_RATE: (50 * Math.PI) / 180,
  Y_TAU: 0.5,
};

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export class VehicleFollowController {
  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {HTMLElement} dom
   * @param {import('./terrain.js').TerrainSystem} terrain
   * @param {import('./vehicles.js').VehicleSystem} vehicles
   */
  constructor(camera, dom, terrain, vehicles) {
    this.camera = camera;
    this.dom = dom;
    this.terrain = terrain;
    this.vehicles = vehicles;
    this.enabled = false;
    this.yaw = 0; // 追跡の基準方位（乗り物の進行方向をなめらかに追った値）
    this.userYaw = 0; // ドラッグでのずらし
    this.zoom = 1;
    this.camY = null;
    this.look = new THREE.Vector3();
    this.pos = new THREE.Vector3();
    this._drag = null;
    this._bind();
  }

  _bind() {
    const d = this.dom;
    d.addEventListener('pointerdown', (e) => {
      if (!this.enabled || e.button !== 0) return;
      this._drag = { x: e.clientX, yaw: this.userYaw };
    });
    addEventListener('pointermove', (e) => {
      if (!this.enabled || !this._drag) return;
      this.userYaw = THREE.MathUtils.clamp(this._drag.yaw - (e.clientX - this._drag.x) * 0.006, -Math.PI, Math.PI);
    });
    addEventListener('pointerup', () => (this._drag = null));
    d.addEventListener(
      'wheel',
      (e) => {
        if (!this.enabled) return;
        e.preventDefault();
        this.zoom = THREE.MathUtils.clamp(this.zoom * Math.exp(e.deltaY * 0.0012), 0.5, 4);
      },
      { passive: false },
    );
  }

  /** 対象の現在の向きから、補間なしの理想の視点を求める（モード切替時の移動先） */
  desiredPose() {
    const t = this.vehicles.followTarget();
    if (!t) return null;
    return this._pose(t, t.heading + this.userYaw, null);
  }

  _pose(t, yaw, camYPrev, dt = 0) {
    const V = VEHICLE_VIEW;
    const z = this.zoom;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const side = (V.SIDE_DEG * Math.PI) / 180;
    const bx = -Math.sin(yaw + side);
    const bz = -Math.cos(yaw + side);
    const cx = t.x - bx * V.BACK * z;
    const cz = t.z - bz * V.BACK * z;
    const ground = Math.max(this.terrain.getSurfaceY(cx, cz), this.terrain.getSurfaceY(t.x, t.z), t.y - 0.05);
    let cy = ground + V.ALT * z;
    if (camYPrev != null && dt > 0) cy = camYPrev + (cy - camYPrev) * (1 - Math.exp(-dt / V.Y_TAU));
    // 急な斜面：カメラ直下の地表 + 0.25km は必ず確保
    cy = Math.max(cy, this.terrain.getSurfaceY(cx, cz) + 0.25);
    const pos = new THREE.Vector3(cx, cy, cz);
    const look = new THREE.Vector3(t.x + fx * V.AHEAD * z, t.y + 0.05, t.z + fz * V.AHEAD * z);
    return { pos, look, ground };
  }

  enable() {
    const t = this.vehicles.followTarget();
    this.enabled = true;
    this._drag = null;
    if (t) {
      this.yaw = t.heading;
      this.camY = null;
      this.terrain.prefetchAround?.(t.x, t.z);
    }
  }

  disable() {
    this.enabled = false;
    this._drag = null;
  }

  update(dt) {
    if (!this.enabled) return;
    const t = this.vehicles.followTarget();
    if (!t) return;
    const V = VEHICLE_VIEW;
    // 向き：時定数 + 最大旋回速度
    let d = wrap(t.heading - this.yaw);
    let step = d * (1 - Math.exp(-dt / V.YAW_TAU));
    const maxStep = V.YAW_RATE * dt;
    step = THREE.MathUtils.clamp(step, -maxStep, maxStep);
    this.yaw = wrap(this.yaw + step);
    if (!this._drag) this.userYaw *= Math.exp(-dt / 2.5); // 手を離すとゆっくり真後ろへ
    const p = this._pose(t, this.yaw + this.userYaw, this.camY, dt);
    this.camY = p.pos.y;
    this.camera.position.copy(p.pos);
    this.camera.lookAt(p.look);
    this.pos.copy(p.pos);
    this.look.copy(p.look);
  }
}
