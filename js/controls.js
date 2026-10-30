/**
 * controls.js — 俯瞰モード (MAP VIEW) と 一人称探索モード (EXPLORE VIEW)
 * ---------------------------------------------------------------------------
 * MapController     : OrbitControls ベース。左ドラッグ回転／右ドラッグ・Shift+左でパン／
 *                     ホイール・中ドラッグでズーム（カーソル位置へ）。慣性あり。
 *                     地面・海面より下に潜らないよう毎フレーム補正。
 * ExploreController : 自由飛行カメラ。PointerLock でマウス視点、WASD/矢印で移動、
 *                     Q/E で下降・上昇、Shift で高速、ホイールで基準速度変更。
 *                     速度は「対地高度」に比例するので、低空ではゆっくり、
 *                     高空では一気に九州→沖縄まで飛べる。
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
    this.yaw = 0;
    this.pitch = 0;
    this.keys = new Set();
    this.velocity = new THREE.Vector3();
    this.speedMul = 1;
    this.sensitivity = 0.0022;
    this.locked = false;
    this.dragging = false;
    this.lastSpeed = 0;
    this.onLockChange = null;

    this._onKeyDown = (e) => {
      if (!this.enabled) return;
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
      this.yaw -= e.movementX * this.sensitivity;
      this.pitch -= e.movementY * this.sensitivity;
      this.pitch = clamp(this.pitch, -1.5, 1.5);
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
    this._onWheel = (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      this.speedMul = clamp(this.speedMul * (e.deltaY > 0 ? 1 / 1.15 : 1.15), 0.1, 12);
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
    this.pitch = clamp(e.x, -1.5, 1.5);
  }

  enable() {
    this.enabled = true;
    this.syncFromCamera();
    this.velocity.set(0, 0, 0);
  }

  disable() {
    this.enabled = false;
    this.keys.clear();
    this.dragging = false;
    if (document.pointerLockElement === this.dom) document.exitPointerLock();
  }

  altitude() {
    const p = this.camera.position;
    return p.y - this.terrain.getSurfaceY(p.x, p.z);
  }

  update(dt) {
    if (!this.enabled) return;
    const cam = this.camera;
    cam.rotation.set(this.pitch, this.yaw, 0, 'YXZ');

    const agl = Math.max(0.02, this.altitude());
    // 対地高度比例の速度 [km/s]（地表すれすれ ≒ 時速300km、高度10km ≒ 秒速4km）
    let speed = clamp(0.08 + agl * 0.4, 0.08, 400) * this.speedMul;
    if (this.keys.has('boost')) speed *= 4;

    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const wish = new THREE.Vector3();
    if (this.keys.has('fwd')) wish.add(fwd);
    if (this.keys.has('back')) wish.sub(fwd);
    if (this.keys.has('right')) wish.add(right);
    if (this.keys.has('left')) wish.sub(right);
    if (this.keys.has('up')) wish.y += 1;
    if (this.keys.has('down')) wish.y -= 1;
    if (wish.lengthSq() > 0) wish.normalize().multiplyScalar(speed);

    // 慣性（加速・減速を指数補間）
    const k = 1 - Math.exp(-dt * (wish.lengthSq() > 0 ? 5 : 3.5));
    this.velocity.lerp(wish, k);
    cam.position.addScaledVector(this.velocity, dt);

    // 地表・海面すれすれまで（潜らない）、ワールド外に出過ぎない
    const p = cam.position;
    p.x = clamp(p.x, WORLD_BOUNDS.minX - 300, WORLD_BOUNDS.maxX + 300);
    p.z = clamp(p.z, WORLD_BOUNDS.minZ - 300, WORLD_BOUNDS.maxZ + 300);
    const floor = this.terrain.getSurfaceY(p.x, p.z) + 0.03;
    if (p.y < floor) {
      p.y = floor;
      if (this.velocity.y < 0) this.velocity.y = 0;
    }
    if (p.y > 4000) p.y = 4000;
    this.lastSpeed = this.velocity.length();
  }

  /** ポインタロック中でなければ、canvas クリックで取得できる */
  requestLock() {
    this.dom.requestPointerLock?.()?.catch?.(() => {});
  }
}
