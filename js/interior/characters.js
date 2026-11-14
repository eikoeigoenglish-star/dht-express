/**
 * interior/characters.js — 【v12】車内の住人（Room 1：リンさん / Room 2：4 匹 / Room 3：将来の 4 匹）
 * ---------------------------------------------------------------------------
 * ★ 差し替え箇所はこのファイルの ROOM_CHARACTERS だけ（部屋 id → キャラクター id → 定義）
 *     model    … GLB のパス（サイトルートから）。null なら仮置き（カプセル + 名札）
 *     enabled  … false ならまだ乗っていない（Room 3 の 4 匹）。true にして model を入れれば座る
 *     kind     … 'animal'（SitIdle などのクリップで座る） / 'human'（骨を回して座らせる。リンさん）
 *     height   … animal：座った姿勢での高さ [m]。human：使わない（モデルの実寸）
 *     seat     … seatAt(部屋, 'L'|'R', 'window'|'center'|'aisle') で座席の位置と向き
 *     lines    … 会話（E で 1 行ずつ）
 *   実行中の差し替え：DHT.interior.setCharacterModel('cat', 'models/characters/cat.glb')
 *
 * 向き：facing = 正面の方位角（0 = -Z = 車窓、+π/2 = -X、-π/2 = +X）。glTF の前（+Z）を正面にする。
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { asset } from '../config.js';
import { bubbleTexture, nameTagTexture, radialTexture } from './textures.js';
import { COMPARTMENTS, BENCH } from './layout.js';

const SEAT_Y = BENCH.seatTop;

/** 個室のベンチの座席。side：L = -X 側のベンチ（+X を向く）、R = +X 側（-X を向く） */
export function seatAt(roomId, side, slot) {
  const cx = COMPARTMENTS.find((c) => c.id === roomId).cx;
  const z = { window: 0.42, center: 0.95, aisle: 1.42 }[slot];
  const s = side === 'L' ? -1 : 1;
  return { x: cx + s * 1.74, y: SEAT_Y, z, facing: s < 0 ? -Math.PI / 2 : Math.PI / 2 };
}

export const ROOM_CHARACTERS = {
  room1: {
    rin: {
      name: 'リンさん',
      kind: 'human',
      // 立ち姿（座らせるとスカートの中が見える角度があるため、座らせない）
      pose: 'stand',
      model: 'models/characters/rin.glb',
      // Room 1 の窓際・テーブルの横に立ち、扉（廊下）の方を向く
      seat: { x: COMPARTMENTS[0].cx - 0.95, y: 0, z: 1.45, facing: Math.atan2(-0.35, -1) },
      radius: 0.24, // 葉っぱがすり抜けない当たり判定
      // スカートの中が映らないよう、近く（半径 modestyRadius m）ではカメラを modestyMinY m より下げない
      modestyRadius: 1.4,
      modestyMinY: 0.85,
      hideMeshes: ['InnerBrief'], // スカートの内側の部品は描かない
      promptY: 1.82, // 床からの「E：話しかける」・吹き出しの高さ
      color: '#e8c8b0',
      lines: [
        'あら、葉っぱくん。Room 1 へようこそ。',
        'この列車のいちばん後ろには Dining & Lounge があるの。廊下の突き当たりのドアから入れるわ。',
        '（仮のセリフです。characters.js の lines で差し替えできます）',
      ],
    },
  },
  room2: {
    monkey: {
      name: '赤ちゃん猿',
      model: 'models/characters/monkey.glb',
      height: 0.5,
      color: '#b07a4f',
      seat: seatAt('room2', 'L', 'aisle'),
      lines: ['やあ、葉っぱくん！ FOREST SCHOOL EXPRESS へようこそ。', 'この列車、窓から見える木がたくさんで楽しいんだ。', '（仮のセリフです。characters.js の lines で差し替えできます）'],
    },
    squirrel: {
      name: 'リス',
      model: 'models/characters/squirrel.glb',
      height: 0.46,
      color: '#c08a52',
      seat: seatAt('room2', 'L', 'window'),
      lines: ['どんぐり、ひとつ食べる？', '窓際の席、いちばん景色がいいんだよ。'],
    },
    duck: {
      name: 'アヒル',
      model: 'models/characters/duck.glb',
      height: 0.48,
      color: '#f2ead2',
      seat: seatAt('room2', 'R', 'window'),
      lines: ['ガァ！ 次の駅はどこかなあ。', '青いスカーフ、似合ってる？'],
    },
    dog: {
      name: '柴犬',
      model: 'models/characters/dog.glb',
      height: 0.58,
      color: '#d99a52',
      seat: seatAt('room2', 'R', 'aisle'),
      lines: ['ワン！ ぼくはこの部屋の見張り番。', 'ドアの向こうは廊下だよ。E で開けられるよ。'],
    },
  },
  // 将来の住人（今は乗っていない）。enabled: true + model を入れるだけで座る
  room3: {
    cat: { name: '猫', enabled: false, model: null, height: 0.46, color: '#9a8a7a', seat: seatAt('room3', 'L', 'aisle'), lines: ['にゃあ。'] },
    pony: { name: '仔馬', enabled: false, model: null, height: 0.62, color: '#b88a5a', seat: seatAt('room3', 'L', 'window'), lines: ['ヒヒン。'] },
    tiger: { name: '赤ちゃん虎', enabled: false, model: null, height: 0.5, color: '#e09a4a', seat: seatAt('room3', 'R', 'window'), lines: ['がおー（小声）'] },
    rabbit: { name: 'ウサギ', enabled: false, model: null, height: 0.44, color: '#efe8e0', seat: seatAt('room3', 'R', 'aisle'), lines: ['ぴょん。'] },
  },
};

/** すべての定義を { id, roomId, def } の配列に */
export function listCharacters() {
  const out = [];
  for (const [roomId, chars] of Object.entries(ROOM_CHARACTERS)) for (const [id, def] of Object.entries(chars)) out.push({ id, roomId, def });
  return out;
}

/** 名前を付けて話しかけられる対象（interaction の共通形） */
export class RoomCharacter {
  constructor(id, def, roomId) {
    this.id = id;
    this.def = def;
    this.roomId = roomId;
    this.group = new THREE.Group();
    this.group.name = `char-${id}`;
    this.group.position.set(def.seat.x, def.seat.y, def.seat.z);
    this.facing = def.seat.facing ?? def.facing ?? 0;
    this.group.rotation.y = this.facing;
    this.body = null;
    this.isPlaceholder = true;
    this.bubble = null;
    this.time = Math.random() * 10;
    this.tint = new THREE.Color(1, 1, 1);
    this._buildMarkers();
    this.setBody(makePlaceholder(def));
  }

  get name() {
    return this.def.name;
  }
  get lines() {
    return this.def.lines ?? ['……'];
  }
  get anchor() {
    return new THREE.Vector3(this.def.seat.x, 0, this.def.seat.z);
  }
  get promptY() {
    return this.def.promptY ?? (this.def.height ?? 0.5) + 0.22;
  }
  get headWorld() {
    return new THREE.Vector3(this.def.seat.x, this.def.seat.y + this.promptY, this.def.seat.z);
  }
  /** 話すとき体ごと向きを変えるか（人は首だけ） */
  get turnsBody() {
    return this.def.kind !== 'human';
  }

  _buildMarkers() {
    _tex.bubble ??= bubbleTexture();
    const b = new THREE.Sprite(new THREE.SpriteMaterial({ map: _tex.bubble, transparent: true, depthWrite: false }));
    b.scale.set(0.22, 0.165, 1);
    b.position.y = this.promptY - 0.02;
    b.renderOrder = 5;
    this.bubble = b;
    this.group.add(b);
  }

  setBody(obj, placeholder = true) {
    if (this.body) {
      this.group.remove(this.body);
      this.body.traverse?.((o) => {
        if (o.isMesh && o.userData.ownGeo) o.geometry.dispose();
      });
    }
    this.body = obj;
    this.isPlaceholder = placeholder;
    this.group.add(obj);
  }

  async loadModel(url) {
    if (!url) return false;
    try {
      const gltf = await _loader().loadAsync(url.startsWith('http') || url.startsWith('blob:') ? url : asset(url));
      const root = gltf.scene;
      root.traverse((o) => {
        if (o.isMesh) {
          if (this.def.hideMeshes?.some((n) => o.name.startsWith(n) || o.parent?.name?.startsWith(n))) o.visible = false;
          o.castShadow = o.receiveShadow = false;
          if (o.isSkinnedMesh) o.frustumCulled = false;
          // 明るさを時間帯で調整できるよう元の色を覚えておく（unlit = MeshBasicMaterial も含む）
          for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.userData.baseColor ??= m.color?.clone();
        }
      });
      const holder = new THREE.Group();
      const yawed = new THREE.Group();
      yawed.rotation.y = (this.def.yaw ?? 0) + Math.PI; // glTF の +Z（前）→ -Z
      yawed.add(root);
      holder.add(yawed);
      if (this.def.kind === 'human') this._poseHuman(holder, yawed, root, this.def.pose ?? 'stand');
      else this._seatAnimal(holder, yawed, root, gltf.animations ?? []);
      this.setBody(holder, false);
      this.applyTint(this.tint);
      return true;
    } catch (e) {
      console.warn(`[interior] ${this.def.name} のモデルを読み込めませんでした（仮置きのまま）`, url, e);
      return false;
    }
  }

  /** 動物：座りのクリップを再生し、ポーズを当てた形を測って座面に置く */
  _seatAnimal(holder, yawed, root, clips) {
    const pick = (names) => names.map((n) => clips.find((c) => c.name === n)).find(Boolean);
    const body = pick(this.def.clips ?? ['SitIdle', 'Sit', 'Idle']) ?? clips[0];
    if (body) {
      const mixer = new THREE.AnimationMixer(root);
      mixer.clipAction(body).play();
      const blink = pick(['Expr_Blink']);
      if (blink && blink !== body) {
        const act = mixer.clipAction(blink);
        act.setLoop(THREE.LoopOnce, 1);
        holder.userData.blink = act;
        holder.userData.blinkIn = 1 + Math.random() * 3;
      }
      mixer.update(0.05);
      holder.userData.mixer = mixer;
      holder.userData.clip = body.name;
    }
    const measure = () => {
      holder.updateMatrixWorld(true);
      return new THREE.Box3().setFromObject(holder, true);
    };
    let bb = measure();
    const s = (this.def.height ?? 0.5) / Math.max(1e-3, bb.max.y - bb.min.y);
    root.scale.multiplyScalar(s);
    bb = measure();
    const c = bb.getCenter(new THREE.Vector3());
    yawed.position.set(-c.x, -bb.min.y - 0.01, -c.z);
    if (this.def.offset) yawed.position.add(new THREE.Vector3(...this.def.offset));
  }

  /**
   * 人（リンさん）：アニメーションが無い（T ポーズの）モデルの骨を回してポーズを付ける。
   *   骨のローカル軸に依存しないよう、「骨の向き（関節 → 次の関節）」をワールド空間で目標の向きへ回す。
   *   pose = 'stand'：腕を体の横へ自然に下ろして立つ（足の裏を床に、腰を真上に）
   *   pose = 'sit'  ：左右の太ももを平行にそろえて座る（座面の上に腰）※ 現在は使っていない
   */
  _poseHuman(holder, yawed, root, pose) {
    holder.updateMatrixWorld(true);
    // GLTFLoader はノード名の「.」などを取り除く（upper_leg.L → upper_legL）ので両方で探す
    const bone = (n) => root.getObjectByName(n) ?? root.getObjectByName(n.replace(/[.\[\]:/]/g, ''));
    const yq = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yawed.rotation.y);
    const dir = (x, y, z) => new THREE.Vector3(x, y, z).applyQuaternion(yq).normalize();
    const aim = (name, childName, target) => {
      const b = bone(name);
      const c = bone(childName);
      if (!b || !c) return;
      holder.updateMatrixWorld(true);
      const a = b.getWorldPosition(new THREE.Vector3());
      const cur = c.getWorldPosition(new THREE.Vector3()).sub(a).normalize();
      const dq = new THREE.Quaternion().setFromUnitVectors(cur, target);
      const qW = b.getWorldQuaternion(new THREE.Quaternion());
      const qP = b.parent.getWorldQuaternion(new THREE.Quaternion());
      b.quaternion.copy(qP.invert().multiply(dq.multiply(qW)));
      b.updateMatrixWorld(true);
    };
    if (pose === 'stand') {
      for (const s of [1, -1]) {
        const L = s > 0 ? 'L' : 'R';
        aim(`upper_arm.${L}`, `lower_arm.${L}`, dir(s * 0.16, -1, 0.04));
        aim(`lower_arm.${L}`, `hand.${L}`, dir(s * 0.08, -1, 0.2));
        aim(`hand.${L}`, `middle_proximal.${L}`, dir(s * 0.03, -1, 0.12));
      }
      holder.updateMatrixWorld(true);
      // 足の裏を床（グループ原点）に、腰を真上に
      const bb = new THREE.Box3().setFromObject(holder, true);
      const hl = bone('upper_leg.L')?.getWorldPosition(new THREE.Vector3());
      const hr = bone('upper_leg.R')?.getWorldPosition(new THREE.Vector3());
      const hip = hl && hr ? hl.add(hr).multiplyScalar(0.5) : bb.getCenter(new THREE.Vector3());
      yawed.position.set(-hip.x, -bb.min.y, -hip.z);
      this._posed = !!(hl && hr);
      const head = bone('head');
      if (head) this._head = { bone: head, rest: head.quaternion.clone(), yaw: 0 };
      return;
    }
    for (const s of [1, -1]) {
      const L = s > 0 ? 'L' : 'R'; // L はモデルの +X 側
      // 左右の太ももを平行にそろえて、側面どうしがくっつくように（脚を開かない・1 本に重ねない）
      //   股関節は左右 ±0.085 m。膝を ±0.065 m（太ももの太さ分）へ寄せる → 太ももの内側どうしが接する
      //   すねは真下へ平行に、足も左右に分かれたまま
      aim(`upper_leg.${L}`, `lower_leg.${L}`, dir(-s * 0.048, 0.03, 1));
      aim(`lower_leg.${L}`, `foot.${L}`, dir(0, -1, 0.06));
      aim(`foot.${L}`, `toes.${L}`, dir(0, -0.3, 1));
      aim(`upper_arm.${L}`, `lower_arm.${L}`, dir(s * 0.22, -1, 0.3));
      aim(`lower_arm.${L}`, `hand.${L}`, dir(-s * 0.35, -0.3, 1));
      aim(`hand.${L}`, `middle_proximal.${L}`, dir(-s * 0.3, -0.5, 1));
    }
    holder.updateMatrixWorld(true);
    const hl = bone('upper_leg.L')?.getWorldPosition(new THREE.Vector3());
    const hr = bone('upper_leg.R')?.getWorldPosition(new THREE.Vector3());
    const hip = hl && hr ? hl.add(hr).multiplyScalar(0.5) : new THREE.Vector3();
    yawed.position.set(-hip.x, -hip.y + 0.09, -hip.z);
    // 首だけ葉っぱの方を向くため、頭の骨の元の向きを覚える
    const head = bone('head');
    this._posed = !!(hl && hr);
    if (!this._posed) console.warn('[interior] リンさんの骨が見つからないため座らせられませんでした');
    if (head) {
      holder.updateMatrixWorld(true);
      this._head = { bone: head, rest: head.quaternion.clone(), yaw: 0 };
    }
  }

  /** 時間帯に合わせた明るさ（unlit のモデルは照明が効かないので色で調整） */
  applyTint(c) {
    this.tint.copy(c);
    this.body?.traverse?.((o) => {
      if (!o.isMesh) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (m.isMeshBasicMaterial && m.userData.baseColor) m.color.copy(m.userData.baseColor).multiply(c);
      }
    });
  }

  /** 人：首を左右に（rad、正 = 左）。体の正面からの角度 */
  lookYaw(angle, dt) {
    const h = this._head;
    if (!h) return;
    h.yaw += (THREE.MathUtils.clamp(angle, -0.7, 0.7) - h.yaw) * (1 - Math.exp(-dt * 4));
    // 骨のローカル軸は不揃いなので、ワールドの上方向まわりに回してからローカルへ戻す
    const b = h.bone;
    b.quaternion.copy(h.rest);
    b.updateMatrixWorld(true);
    const qW = b.getWorldQuaternion(new THREE.Quaternion());
    const qP = b.parent.getWorldQuaternion(new THREE.Quaternion());
    const dq = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), h.yaw);
    b.quaternion.copy(qP.invert().multiply(dq.multiply(qW)));
  }

  update(dt, highlighted) {
    this.time += dt;
    const t = this.time;
    if (this.isPlaceholder) {
      const s = 1 + Math.sin(t * 2.1) * 0.025;
      this.body.scale.set(1 / Math.sqrt(s), s, 1 / Math.sqrt(s));
      this.body.userData.ring.material.opacity = highlighted ? 0.85 : 0.35;
    } else {
      const u = this.body.userData;
      if (u.blink) {
        u.blinkIn -= dt;
        if (u.blinkIn <= 0) {
          u.blink.reset().play();
          u.blinkIn = 2.5 + Math.random() * 3.5;
        }
      }
      u.mixer?.update(dt);
      if (this.def.kind === 'human') this.body.position.y = Math.sin(t * 1.6) * 0.003; // 呼吸
    }
    this.bubble.position.y = this.promptY - 0.02 + Math.sin(t * 2.4) * 0.015;
    this.bubble.visible = !highlighted;
  }
}

const _tex = {};
let _gltf = null;
const _loader = () => (_gltf ??= new GLTFLoader());

/** 仮置き：カプセル（テーマ色）＋ 名札 ＋ 足元のリング */
function makePlaceholder(def) {
  const g = new THREE.Group();
  g.name = 'placeholder';
  const H = def.kind === 'human' ? (def.pose === 'stand' ? 1.55 : 0.8) : def.height ?? 0.5;
  const R = H * 0.3;
  const geo = new THREE.CapsuleGeometry(R, Math.max(0.01, H - 2 * R), 6, 16);
  geo.translate(0, H / 2, 0);
  const body = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.75, metalness: 0 }));
  body.userData.ownGeo = true;
  g.add(body);
  const dot = new THREE.Mesh(new THREE.SphereGeometry(R * 0.18, 10, 8), new THREE.MeshStandardMaterial({ color: '#2e3b30', roughness: 0.5 }));
  dot.position.set(0, H * 0.68, -R * 0.95);
  dot.userData.ownGeo = true;
  g.add(dot);
  const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: nameTagTexture(`${def.name}（仮）`), transparent: true, depthWrite: false }));
  tag.scale.set(0.42, 0.105, 1);
  tag.position.y = H * 0.55;
  tag.position.z = -R - 0.02;
  tag.renderOrder = 4;
  g.add(tag);
  _tex.ring ??= radialTexture(0, 1, true);
  const ring = new THREE.Mesh(
    new THREE.PlaneGeometry(R * 3.2, R * 3.2),
    new THREE.MeshBasicMaterial({ map: _tex.ring, color: '#d6f2a0', transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.006;
  ring.userData.ownGeo = true;
  g.add(ring);
  g.userData.ring = ring;
  return g;
}
