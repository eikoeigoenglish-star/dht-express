/**
 * camera.js — カメラ本体・プリセット・滑らかな移動（トゥイーン）
 * ---------------------------------------------------------------------------
 * CameraRig は「カメラ位置」と「注視点」を一緒に補間する。
 * 遠距離の移動では途中で高度を上げる弧を描き、地形にめり込まず、
 * 移動先の位置関係が分かるようにしている。
 *
 * 将来の列車追尾カメラは、このクラスに follow(target) モードを追加するか、
 * controls.js に FollowController を足して ModeManager に登録する想定。
 */
import * as THREE from 'three';
import { latLonToWorld } from './geo.js';

const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const D2R = Math.PI / 180;

export function createCamera() {
  const cam = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.01, 50000);
  cam.rotation.order = 'YXZ';
  return cam;
}

/** プリセット（緯度経度・距離・角度）→ { position, target } */
export function presetToView(preset, terrain) {
  const w = latLonToWorld(preset.lat, preset.lon);
  const target = new THREE.Vector3(w.x, terrain.getSurfaceY(w.x, w.z), w.z);
  const pol = preset.polar * D2R;
  const az = preset.azimuth * D2R;
  const r = preset.dist;
  const offset = new THREE.Vector3(Math.sin(az) * Math.sin(pol) * r, Math.cos(pol) * r, Math.cos(az) * Math.sin(pol) * r);
  return { position: target.clone().add(offset), target };
}

/** 一人称用：プリセットの注視点を、低空から眺める位置に変換 */
export function presetToExploreView(preset, terrain) {
  const w = latLonToWorld(preset.lat, preset.lon);
  const target = new THREE.Vector3(w.x, terrain.getSurfaceY(w.x, w.z), w.z);
  const az = preset.azimuth * D2R;
  const back = Math.min(preset.dist * 0.45, 140);
  const px = w.x + Math.sin(az) * back;
  const pz = w.z + Math.cos(az) * back;
  const ground = terrain.getSurfaceY(px, pz);
  const position = new THREE.Vector3(px, ground + Math.max(1.5, back * 0.09), pz);
  return { position, target };
}

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.anim = null;
    this.lookTarget = new THREE.Vector3();
  }

  get animating() {
    return !!this.anim;
  }

  /**
   * カメラを滑らかに移動
   * @param {THREE.Vector3} toPos
   * @param {THREE.Vector3} toTarget
   * @param {{ fromTarget?: THREE.Vector3, duration?: number, onDone?: Function, getGround?: (x,z)=>number }} [opts]
   */
  flyTo(toPos, toTarget, opts = {}) {
    const cam = this.camera;
    const fromPos = cam.position.clone();
    let fromTarget = opts.fromTarget?.clone();
    if (!fromTarget) {
      const dir = new THREE.Vector3();
      cam.getWorldDirection(dir);
      fromTarget = fromPos.clone().addScaledVector(dir, Math.max(10, fromPos.distanceTo(toTarget) * 0.3));
    }
    const travel = Math.hypot(toPos.x - fromPos.x, toPos.z - fromPos.z);
    const duration = opts.duration ?? THREE.MathUtils.clamp(1.1 + Math.log10(1 + travel) * 0.7, 1.1, 3.2);
    const peak = Math.max(fromPos.y, toPos.y);
    const lift = Math.max(0, Math.min(900, travel * 0.35) - peak * 0.5);
    this.anim = { fromPos, toPos: toPos.clone(), fromTarget, toTarget: toTarget.clone(), t: 0, duration, lift, onDone: opts.onDone, getGround: opts.getGround };
  }

  cancel() {
    this.anim = null;
  }

  update(dt) {
    const a = this.anim;
    if (!a) return false;
    a.t = Math.min(1, a.t + dt / a.duration);
    const e = easeInOutCubic(a.t);
    const cam = this.camera;
    cam.position.lerpVectors(a.fromPos, a.toPos, e);
    cam.position.y += a.lift * Math.sin(Math.PI * e);
    if (a.getGround) {
      const g = a.getGround(cam.position.x, cam.position.z) + 0.3;
      if (cam.position.y < g) cam.position.y = g;
    }
    this.lookTarget.lerpVectors(a.fromTarget, a.toTarget, e);
    cam.lookAt(this.lookTarget);
    if (a.t >= 1) {
      this.anim = null;
      a.onDone?.();
    }
    return true;
  }
}
