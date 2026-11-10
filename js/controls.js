/**
 * controls.js — 俯瞰モード (MAP VIEW) と 一人称探索モード (EXPLORE VIEW)
 * ---------------------------------------------------------------------------
 * MapController     : OrbitControls ベース。左ドラッグ回転／右ドラッグ・Shift+左でパン／
 *                     ホイール・中ドラッグでズーム（カーソル位置へ）。慣性あり。
 *                     地面・海面より下に潜らないよう毎フレーム補正。（v3 でも変更なし）
 * ExploreController : v3「飛空艇」操作（FF6 の飛空艇・聖剣伝説のフラミーのイメージ）
 *                     ・W/↑ 前進・S/↓ 後退 … 機首方位（Yaw）へ水平に飛ぶ（視線の上下とは無関係）
 *                     ・A/← 左旋回・D/→ 右旋回 … Yaw 操作（横移動＝ストレイフはしない）
 *                     ・Q 下降・E 上昇 … 高度は独立して操作
 *                     ・Shift … 高速（水平 30,000 → 90,000 km/h、垂直 10,000 → 30,000 km/h）
 *                     ・マウス（クリックでポインタロック）… 見回し。X・Y とも反転
 *                       （右へ動かす → 左を見る、下へ動かす → 上を見る）。Yaw は機首方位と共通
 *                     ・ホイールで速度は変わらない（固定速度）。慣性なし（押せば即移動・離せば即停止）
 *                     ・最低高度 1,000m（地表＝周囲の最も高い地点から 1.0 unit）。山に近づくと先読みで上昇
 *
 * どちらも enable()/disable()/update(dt) を持ち、main.js から同じ形で扱う。
 * 将来、列車追尾 (FollowController) も同じインターフェースで追加できる。
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { WORLD_BOUNDS } from './config.js';

const clamp = THREE.MathUtils.clamp;

/* ====================================================================== */
export class MapController {
  constructor(camera, dom, terrain) {
    this.camera = camera;
    this.terrain = terrain;
    const c = new OrbitControls(camera, dom);
    c.enableDamping = true;
    c.dampingFactor = 0.075;
    c.screenSpacePanning = false; // 地面に沿ってパン
    c.zoomToCursor = true;
    c.minDistance = 1.2;
    c.maxDistance = 3400;
    c.maxPolarAngle = THREE.MathUtils.degToRad(80);
    c.rotateSpeed = 0.55;
    c.zoomSpeed = 1.15;
    c.panSpeed = 1.0;
    c.keyPanSpeed = 25;
    c.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    c.enabled = false;
    this.controls = c;
    this._keysBound = false;
  }

  get target() {
    return this.controls.target;
  }

  enable(target) {
    if (target) this.controls.target.copy(target);
    this.controls.enabled = true;
    if (!this._keysBound) {
      this.controls.listenToKeyEvents(window); // 矢印キーでパン
      this._keysBound = true;
    }
    this.controls.update();
  }

  disable() {
    this.controls.enabled = false;
  }

  update() {
    const c = this.controls;
    const t = c.target;
    // 注視点はワールド範囲内・地表付近にとどめる
    t.x = clamp(t.x, WORLD_BOUNDS.minX, WORLD_BOUNDS.maxX);
    t.z = clamp(t.z, WORLD_BOUNDS.minZ, WORLD_BOUNDS.maxZ);
    const gy = this.terrain.getSurfaceY(t.x, t.z);
    t.y += (gy - t.y) * 0.08;

    c.update();

    // 地面に潜らない（距離に応じた余裕を持たせる）
    const cam = this.camera.position;
    const dist = cam.distanceTo(t);
    const ground = this.terrain.getSurfaceY(cam.x, cam.z);
    const minY = ground + 0.25 + dist * 0.015;
    if (cam.y < minY) cam.y = minY;
  }
}

/* ====================================================================== */
/* EXPLORE VIEW（飛空艇）の定数 — 1 world unit = 1 km                         */
/* ====================================================================== */
export const AIRSHIP = {
  CRUISE_KMH: 30000, // 通常の水平速度
  BOOST_KMH: 90000, // Shift 中の水平速度
  CLIMB_KMH: 10000, // 通常の上昇・下降速度
  CLIMB_BOOST_KMH: 30000, // Shift 中の上昇・下降速度
  YAW_DEG_PER_SEC: 72, // A/D・←/→ の旋回角速度（Shift の影響なし）。90° ≒ 1.25 秒
  YAW_SMOOTH: 14, // 旋回の立ち上がり・止まりのなめらかさ [1/s]（約 0.07 秒で追従）
  MIN_AGL: 1.0, // 最低高度 [km]（＝1,000m）。周囲 0.8km の最も高い地表から測る
  PROBE_R: 0.8, // 最低高度の判定に使う周囲の半径 [km]
  LOOKAHEAD: [1.5, 3, 5], // 進行方向の先読み距離 [km]（山の手前で前もって上昇）
  AUTO_CLIMB: 14, // 先読みによる自動上昇の上限速度 [units/s]
  RECOVER_RATE: 20, // 最低高度より下でモードに入ったときの上昇速度 [units/s]
  MAX_Y: 4000,
  MOUSE_SENS: 0.0022, // rad / px（v2 と同じ感度、向きだけ反転）
  PITCH_LIMIT: 1.5, // rad（±86°。カメラが上下反転しない）
};
const KMH = 1 / 3600; // km/h → units/s

const KEYMAP = {
  KeyW: 'fwd', ArrowUp: 'fwd',
  KeyS: 'back', ArrowDown: 'back',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  KeyE: 'up', Space: 'up',
  KeyQ: 'down',
  ShiftLeft: 'boost', ShiftRight: 'boost',
};

export class ExploreController {
  constructor(camera, dom, terrain) {
    this.camera = camera;
    this.dom = dom;
    this.terrain = terrain;
    this.enabled = false;
    this.yaw = 0; // 機首方位（＝進行方向＝視線の左右）
    this.pitch = 0; // 視線の上下だけ（移動には影響しない）
    this.yawRate = 0; // 現在の旋回角速度 [rad/s]
    this.keys = new Set();
    this.sensitivity = AIRSHIP.MOUSE_SENS;
    this.locked = false;
    this.dragging = false;
    this.recovering = false;
    this.lastSpeed = 0; // 水平速度 [units/s]（HUD 用）
    this.lastVSpeed = 0; // 垂直速度 [units/s]
    this.onLockChange = null;

    this._onKeyDown = (e) => {
      if (!this.enabled) return;
      // Esc でマウス視点を解除（ブラウザ標準の解除に加え、念のため明示的にも解除する）
      if (e.code === 'Escape' && document.pointerLockElement === this.dom) document.exitPointerLock();
      const k = KEYMAP[e.code];
      if (k) {
        this.keys.add(k);
        e.preventDefault();
      }
    };
    this._onKeyUp = (e) => {
      const k = KEYMAP[e.code];
      if (k) this.keys.delete(k);
    };
    this._onBlur = () => this.keys.clear();
    this._onMouseMove = (e) => {
      if (!this.enabled) return;
      if (!this.locked && !this.dragging) return;
      // v3: X・Y とも反転（右へ → 左を見る / 下へ → 上を見る）
      this.yaw += e.movementX * this.sensitivity;
      this.pitch += e.movementY * this.sensitivity;
      this.pitch = clamp(this.pitch, -AIRSHIP.PITCH_LIMIT, AIRSHIP.PITCH_LIMIT);
    };
    this._onMouseDown = (e) => {
      if (!this.enabled) return;
      if (e.button === 0 && !this.locked) {
        // クリックでマウスロック（ロックできない環境ではドラッグで視点操作）
        this.dragging = true;
        this.dom.requestPointerLock?.()?.catch?.(() => {});
      }
    };
    this._onMouseUp = () => (this.dragging = false);
    // v3: ホイールによる速度変更は廃止（固定速度）。ページのスクロールだけ止める
    this._onWheel = (e) => {
      if (this.enabled) e.preventDefault();
    };
    this._onLock = () => {
      this.locked = document.pointerLockElement === this.dom;
      if (this.locked) this.dragging = false;
      this.onLockChange?.(this.locked);
    };
    this._onContext = (e) => this.enabled && e.preventDefault();

    addEventListener('keydown', this._onKeyDown);
    addEventListener('keyup', this._onKeyUp);
    addEventListener('blur', this._onBlur);
    addEventListener('mousemove', this._onMouseMove);
    addEventListener('mouseup', this._onMouseUp);
    dom.addEventListener('mousedown', this._onMouseDown);
    dom.addEventListener('wheel', this._onWheel, { passive: false });
    dom.addEventListener('contextmenu', this._onContext);
    document.addEventListener('pointerlockchange', this._onLock);
  }

  /** カメラの現在の向きから yaw/pitch を取り出す */
  syncFromCamera() {
    const e = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
    this.yaw = e.y;
    this.pitch = clamp(e.x, -AIRSHIP.PITCH_LIMIT, AIRSHIP.PITCH_LIMIT);
  }

  enable() {
    this.enabled = true;
    this.syncFromCamera();
    this.yawRate = 0;
    this.lastSpeed = 0;
    this.lastVSpeed = 0;
    // 最低高度より低い所でモードに入ったら、なめらかに 1km まで上がる
    const p = this.camera.position;
    this.recovering = p.y < this.floorAt(p.x, p.z) - 1e-3;
  }

  disable() {
    this.enabled = false;
    this.keys.clear();
    this.dragging = false;
    this.yawRate = 0;
    if (document.pointerLockElement === this.dom) document.exitPointerLock();
  }

  altitude() {
    const p = this.camera.position;
    return p.y - this.terrain.getSurfaceY(p.x, p.z);
  }

  /** (x, z) で許される最低の Y：周囲 PROBE_R の最も高い地表（海面）＋ 1.0 */
  floorAt(x, z) {
    const t = this.terrain;
    const r = AIRSHIP.PROBE_R;
    let g = t.getSurfaceY(x, z);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      g = Math.max(g, t.getSurfaceY(x + Math.cos(a) * r, z + Math.sin(a) * r));
    }
    return g + AIRSHIP.MIN_AGL;
  }

  update(dt) {
    if (!this.enabled) return;
    const cam = this.camera;
    const K = this.keys;
    const boost = K.has('boost');

    // ---- 旋回（Yaw）: 固定角速度。ごく短いなめらかさだけ入れる ----
    const turn = (K.has('left') ? 1 : 0) - (K.has('right') ? 1 : 0);
    const targetRate = turn * THREE.MathUtils.degToRad(AIRSHIP.YAW_DEG_PER_SEC);
    this.yawRate += (targetRate - this.yawRate) * (1 - Math.exp(-dt * AIRSHIP.YAW_SMOOTH));
    if (!turn && Math.abs(this.yawRate) < 1e-3) this.yawRate = 0;
    this.yaw += this.yawRate * dt;

    cam.rotation.set(this.pitch, this.yaw, 0, 'YXZ');

    // ---- 水平移動：機首方位へ。視線の上下（pitch）は無関係 → 地面を見下ろしても突っ込まない ----
    const fb = (K.has('fwd') ? 1 : 0) - (K.has('back') ? 1 : 0);
    const hSpeed = (boost ? AIRSHIP.BOOST_KMH : AIRSHIP.CRUISE_KMH) * KMH; // units/s
    const p = cam.position;
    if (fb) {
      // Three.js のカメラは -Z を向く。yaw 回転後の前方 = (-sin yaw, 0, -cos yaw)
      p.x += -Math.sin(this.yaw) * fb * hSpeed * dt;
      p.z += -Math.cos(this.yaw) * fb * hSpeed * dt;
    }
    this.lastSpeed = fb ? hSpeed : 0;

    // ---- 高度：Q/E で独立して上下 ----
    const ud = (K.has('up') ? 1 : 0) - (K.has('down') ? 1 : 0);
    const vSpeed = (boost ? AIRSHIP.CLIMB_BOOST_KMH : AIRSHIP.CLIMB_KMH) * KMH;
    p.y += ud * vSpeed * dt;
    this.lastVSpeed = ud * vSpeed;

    // ---- ワールド範囲・最低高度 ----
    p.x = clamp(p.x, WORLD_BOUNDS.minX - 300, WORLD_BOUNDS.maxX + 300);
    p.z = clamp(p.z, WORLD_BOUNDS.minZ - 300, WORLD_BOUNDS.maxZ + 300);
    const floor = this.floorAt(p.x, p.z);
    if (this.recovering) {
      // モード切替直後：最低高度までなめらかに上昇（地表には潜らせない）
      p.y = Math.max(p.y, Math.min(floor, p.y + AIRSHIP.RECOVER_RATE * dt), this.terrain.getSurfaceY(p.x, p.z) + 0.05);
      if (p.y >= floor - 1e-3) this.recovering = false;
    } else {
      // 進行方向の先を読み、山が迫っていれば前もって上昇（急に持ち上げられる感じを減らす）
      if (fb) {
        let ahead = -Infinity;
        for (const d of AIRSHIP.LOOKAHEAD) {
          const ax = p.x - Math.sin(this.yaw) * fb * d;
          const az = p.z - Math.cos(this.yaw) * fb * d;
          ahead = Math.max(ahead, this.floorAt(ax, az));
        }
        if (ahead > p.y) p.y += Math.min(ahead - p.y, AIRSHIP.AUTO_CLIMB * dt);
      }
      if (p.y < floor) p.y = floor; // 1,000m 未満には絶対に下がらない
    }
    if (p.y > AIRSHIP.MAX_Y) p.y = AIRSHIP.MAX_Y;
  }

  /** ポインタロック中でなければ、canvas クリックで取得できる */
  requestLock() {
    this.dom.requestPointerLock?.()?.catch?.(() => {});
  }
}
