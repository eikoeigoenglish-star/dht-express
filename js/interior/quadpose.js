/**
 * interior/quadpose.js — 【v14】座り / 伏せのクリップが無い四足の GLB に、骨を回して休んだ姿勢を付ける
 * ---------------------------------------------------------------------------
 * Room 3 の仔馬（kouma.glb）は立ち姿（idle）のクリップしか無いので、characters.js の def.pose
 * （下の POSES のキー）で四肢を折りたたんで床に伏せた姿勢にする。猫・赤ちゃん虎・ウサギは GLB の idle のまま。
 *
 *   ・骨のローカル軸に依存しないよう、「骨の向き（関節 → 子の関節）」をモデル空間（glTF：+Z = 前、+Y = 上）で
 *     目標の向きへ回す（リンさんの _poseHuman と同じ考え方）。
 *   ・左右は骨の位置（モデル空間の x の符号）で判定するので、_L / _R の付け方がモデルごとに違っても良い。
 *   ・脚としっぽの骨を回すだけ。背骨・首・頭・耳は GLB の idle クリップがそのまま動かす（filterIdle で脚・
 *     しっぽのトラックを外す）ので、まばたき・呼吸・耳の動きは残る。
 */
import * as THREE from 'three';

/**
 * 姿勢の定義。値は [骨, 子の骨, 目標の向き(sx, y, z)]。sx は外側への開き（左右で符号を反転）
 * 骨の名前は候補を | で並べる（モデルごとに名前が違う）。
 */
export const POSES = {
  // 馬の休み方（胸を床に付け、前脚は膝を前へ折って蹄を胸の下へ、後脚は横へ流してたたむ）：仔馬
  foalRest: {
    legs: [
      ['upperArm', 'lowerArm', [0.03, -0.5, -0.87]],
      ['lowerArm', 'hand', [0.06, -0.08, 1]],
      ['hand', 'hoof', [-0.02, 0.15, -1]],
      ['upperLeg', 'lowerLeg', [0.35, -0.2, 1]],
      ['lowerLeg', 'foot', [0.25, -0.12, -1]],
      ['foot', 'toes', [0.05, -0.05, 1]],
    ],
    tail: { curl: 0.16 }, // しっぽは床へ流す
  },
};

/** 脚・腰のトラック（姿勢を上書きしてしまうもの）を外した idle クリップ */
export function filterIdle(clip, keep = /^(spine|chest|neck|head|ear)/i) {
  const tracks = clip.tracks.filter((t) => {
    const [node, prop] = splitTrack(t.name);
    if (prop === 'morphTargetInfluences') return true;
    return prop === 'quaternion' && keep.test(node);
  });
  return new THREE.AnimationClip(`${clip.name}-upper`, clip.duration, tracks);
}

function splitTrack(name) {
  const i = name.lastIndexOf('.');
  return [name.slice(0, i), name.slice(i + 1)];
}

/**
 * root（gltf.scene）の骨を回して姿勢を付ける。frame = モデル空間 → ワールド（holder.matrixWorld）の回転
 * @returns {number} 回した骨の数
 */
export function applyQuadPose(root, poseName, frameQ = new THREE.Quaternion()) {
  const pose = POSES[poseName];
  if (!pose) return 0;
  const bones = [];
  root.traverse((o) => {
    if (o.isBone) bones.push(o);
  });
  const inv = frameQ.clone().invert();
  let n = 0;
  root.updateMatrixWorld(true);
  const sideX = (b) => b.getWorldPosition(new THREE.Vector3()).applyQuaternion(inv).x;
  for (const side of ['l', 'r']) {
    for (const [bn, cn, [sx, y, z]] of pose.legs) {
      const b = pickSide(bones, bn, side);
      if (!b) continue;
      const c = b.children.find((k) => k.isBone && matches(k.name, cn));
      if (!c) continue;
      // 外側への開き：骨がモデルの +X 側にあれば +X へ
      const s = Math.sign(sideX(b)) || (side === 'l' ? 1 : -1);
      const target = new THREE.Vector3(s * sx, y, z).normalize().applyQuaternion(frameQ);
      aim(b, c, target);
      n++;
    }
  }
  return n;
}

const matches = (name, cands) => {
  const n = name.toLowerCase();
  return cands.split('|').some((c) => n.startsWith(c.toLowerCase()));
};

/** 名前が候補のどれかで始まり、左右の印（_L / .L / L）が side の骨 */
function pickSide(bones, cands, side) {
  return bones.find((b) => {
    if (!matches(b.name, cands)) return false;
    const m = b.name.match(/[._]?([LRlr])(_?\d+)?$/);
    return m && m[1].toLowerCase() === side;
  });
}

/** 骨 b の向き（b → c）をワールドの target へ回す */
function aim(b, c, target) {
  b.updateMatrixWorld(true);
  const a = b.getWorldPosition(new THREE.Vector3());
  const cur = c.getWorldPosition(new THREE.Vector3()).sub(a).normalize();
  const dq = new THREE.Quaternion().setFromUnitVectors(cur, target);
  const qW = b.getWorldQuaternion(new THREE.Quaternion());
  const qP = b.parent.getWorldQuaternion(new THREE.Quaternion());
  b.quaternion.copy(qP.invert().multiply(dq.multiply(qW)));
  b.updateMatrixWorld(true);
}

const TAIL_RE = /^tail/i;

/** 骨 b が「しっぽ」の骨か（その頂点を接地の計測から外す） */
const isTail = (b) => TAIL_RE.test(b.name);

/**
 * スキニング後の頂点のいちばん低い y（ワールド）。しっぽの骨に付いた頂点は除く
 *   （しっぽが垂れて床に届いていても、体の接地の高さを測れるように）
 */
export function bodyMinY(root) {
  root.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  let min = Infinity;
  root.traverse((o) => {
    if (!o.isSkinnedMesh || !o.visible) return;
    const g = o.geometry;
    const si = g.attributes.skinIndex;
    const sw = g.attributes.skinWeight;
    const tail = o.skeleton.bones.map(isTail);
    const n = g.attributes.position.count;
    // 頂点が多いモデルは間引いて測る（数 mm の差しか出ない）
    const step = n > 60000 ? 3 : 1;
    for (let i = 0; i < n; i += step) {
      let best = 0;
      let bw = -1;
      for (let k = 0; k < 4; k++) {
        const w = sw.getComponent(i, k);
        if (w > bw) {
          bw = w;
          best = si.getComponent(i, k);
        }
      }
      if (tail[best]) continue;
      o.getVertexPosition(i, v).applyMatrix4(o.matrixWorld);
      if (v.y < min) min = v.y;
    }
  });
  return min;
}

/**
 * しっぽを床（座面）へ沿わせる：付け根から順に、次の関節が floorY + lift の高さに来るよう向けながら、
 * 後ろ（-Z）から体の横（curl の向き）へ少しずつ曲げる。
 */
export function poseTail(root, poseName, floorY, lift, frameQ = new THREE.Quaternion()) {
  const spec = POSES[poseName]?.tail;
  if (!spec) return 0;
  let base = null;
  root.traverse((o) => {
    if (!base && o.isBone && isTail(o) && !isTail(o.parent)) base = o;
  });
  if (!base) return 0;
  let b = base;
  let i = 0;
  const side = spec.side ?? 1;
  while (b) {
    const c = b.children.find((k) => k.isBone && isTail(k));
    if (!c) break;
    b.updateMatrixWorld(true);
    const p = b.getWorldPosition(new THREE.Vector3());
    const L = c.getWorldPosition(new THREE.Vector3()).distanceTo(p);
    const dy = THREE.MathUtils.clamp(floorY + lift - p.y, -L * 0.97, L * 0.6);
    const h = Math.sqrt(Math.max(0, L * L - dy * dy));
    const a = spec.curl * i;
    const dir = new THREE.Vector3(side * Math.sin(a) * h, 0, -Math.cos(a) * h).applyQuaternion(frameQ);
    dir.y = dy;
    aim(b, c, dir.normalize());
    b = c;
    i++;
  }
  return i;
}
