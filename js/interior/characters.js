/**
 * interior/characters.js — 【v11】Room 1 の 4 匹（赤ちゃん猿・リス・アヒル・柴犬）
 * ---------------------------------------------------------------------------
 * dht-express-main には動物の 3D モデルが無いので、v11 では「仮置き（placeholder）」を表示する。
 *   仮置き = やわらかいカプセル（各キャラのテーマ色）＋ 名札 ＋「…」の吹き出し
 *
 * ★ 正式モデル（GLB）への差し替え箇所はこのファイルの ROOM1_CHARACTERS だけ：
 *     model: 'models/characters/shiba.glb'   … サイトルートからの相対パス（null なら仮置き）
 *     height: 0.62                           … 読み込んだモデルをこの高さ [m] に合わせる
 *     yaw / offset                           … 向き・位置の微調整
 *   GLB の読み込みに失敗した場合は仮置きのまま（コンソールに警告）。
 *   実行中に差し替える場合：window.DHT.room1.setCharacterModel('dog', 'models/characters/shiba.glb')
 *
 * ★ 会話の差し替え：lines（配列。E キーで 1 行ずつ進む）を書き換えるだけ。
 *   将来、長い会話・選択肢を入れる場合は lines を { text, choices } などのオブジェクトに拡張し、
 *   room1.js の _openTalk() / _advanceTalk() を差し替える。
 *
 * 座標は Room 1 のローカル（メートル）。seat = 座面の上の座る位置、facing = 向く方向（rad, 0 = -Z = 車窓）。
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { asset } from '../config.js';
import { bubbleTexture, nameTagTexture, radialTexture } from './textures.js';

const SEAT_Y = 0.5; // ベンチ座面の高さ（room1.js の BENCH.seatTop と合わせる）

export const ROOM1_CHARACTERS = {
  monkey: {
    name: '赤ちゃん猿',
    model: 'models/characters/monkey.glb',
    height: 0.5,
    color: '#b07a4f',
    seat: { x: -1.74, y: SEAT_Y, z: 1.42 },
    facing: -Math.PI / 2, // +X（通路）向き
    lines: [
      'やあ、葉っぱくん！ FOREST SCHOOL EXPRESS へようこそ。',
      'この列車、窓から見える木がたくさんで楽しいんだ。',
      '（仮のセリフです。characters.js の lines で差し替えできます）',
    ],
  },
  squirrel: {
    name: 'リス',
    model: 'models/characters/squirrel.glb',
    height: 0.46,
    color: '#c08a52',
    seat: { x: -1.74, y: SEAT_Y, z: 0.42 },
    facing: -Math.PI / 2,
    lines: ['どんぐり、ひとつ食べる？', '窓際の席、いちばん景色がいいんだよ。'],
  },
  duck: {
    name: 'アヒル',
    model: 'models/characters/duck.glb',
    height: 0.48,
    color: '#f2ead2',
    seat: { x: 1.74, y: SEAT_Y, z: 0.42 },
    facing: Math.PI / 2, // -X 向き
    lines: ['ガァ！ 次の駅はどこかなあ。', '青いスカーフ、似合ってる？'],
  },
  dog: {
    name: '柴犬',
    model: 'models/characters/dog.glb',
    height: 0.58,
    color: '#d99a52',
    seat: { x: 1.74, y: SEAT_Y, z: 1.42 },
    facing: Math.PI / 2,
    lines: ['ワン！ ぼくはこの部屋の見張り番。', 'ドアの向こうは廊下だよ。E で開けられるよ。'],
  },
};

/** 名前を付けて話しかけられる対象（interaction の共通形） */
export class Room1Character {
  constructor(id, def) {
    this.id = id;
    this.def = def;
    this.group = new THREE.Group();
    this.group.name = `room1-char-${id}`;
    this.group.position.set(def.seat.x, def.seat.y, def.seat.z);
    this.group.rotation.y = def.facing ?? 0;
    this.body = null; // 仮置き or GLB
    this.isPlaceholder = true;
    this.bubble = null;
    this.time = Math.random() * 10;
    this._buildMarkers();
    this.setBody(makePlaceholder(def));
  }

  get name() {
    return this.def.name;
  }
  get lines() {
    return this.def.lines ?? ['……'];
  }
  /** 話しかけ判定に使う床上の点（座席の前） */
  get anchor() {
    return new THREE.Vector3(this.def.seat.x, 0, this.def.seat.z);
  }
  /** 吹き出し・UI を出す高さ（ワールド） */
  get headWorld() {
    return new THREE.Vector3(this.def.seat.x, this.def.seat.y + (this.def.height ?? 0.5) + 0.22, this.def.seat.z);
  }

  _buildMarkers() {
    _tex.bubble ??= bubbleTexture();
    const b = new THREE.Sprite(new THREE.SpriteMaterial({ map: _tex.bubble, transparent: true, depthWrite: false }));
    b.scale.set(0.22, 0.165, 1);
    b.position.y = (this.def.height ?? 0.5) + 0.2;
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

  /**
   * GLB を読み込んで差し替え（失敗したら仮置きのまま）。
   *   ・アニメーション：def.clips の優先順（既定 SitIdle → Sit → Idle）でループ再生。
   *     表情のクリップ（Expr_Blink）があれば重ねて再生。
   *   ・座らせる：座りポーズを当てた状態で実際の形（スキニング後の頂点）を測り、
   *     高さを def.height [m] に合わせ、いちばん下を座面に、水平の中心を座席の位置に置く。
   *   ・向き：glTF の前（+Z）を Room 1 の「前」（-Z）へ（def.yaw で微調整）。
   */
  async loadModel(url) {
    if (!url) return false;
    try {
      const gltf = await _loader().loadAsync(url.startsWith('http') || url.startsWith('blob:') ? url : asset(url));
      const root = gltf.scene;
      root.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = o.receiveShadow = false;
          if (o.isSkinnedMesh) o.frustumCulled = false; // 座りポーズで外れる bind pose の境界球を使わない
        }
      });
      const holder = new THREE.Group();
      const yawed = new THREE.Group();
      yawed.rotation.y = (this.def.yaw ?? 0) + Math.PI; // glTF の +Z（前）→ -Z
      yawed.add(root);
      holder.add(yawed);
      const clips = gltf.animations ?? [];
      const pick = (names) => names.map((n) => clips.find((c) => c.name === n)).find(Boolean);
      const body = pick(this.def.clips ?? ['SitIdle', 'Sit', 'Idle']) ?? clips[0];
      if (body) {
        const mixer = new THREE.AnimationMixer(root);
        mixer.clipAction(body).play();
        const blink = pick(['Expr_Blink']);
        if (blink && blink !== body) {
          // まばたきは数秒に 1 回だけ（ループさせると目を閉じたままの時間が長くなる）
          const act = mixer.clipAction(blink);
          act.setLoop(THREE.LoopOnce, 1);
          holder.userData.blink = act;
          holder.userData.blinkIn = 1 + Math.random() * 3;
        }
        mixer.update(0.05);
        holder.userData.mixer = mixer;
        holder.userData.clip = body.name;
      }
      // ポーズを当てた形で測る
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
      this.setBody(holder, false);
      this.topY = this.def.height ?? 0.5;
      return true;
    } catch (e) {
      console.warn(`[room1] ${this.def.name} のモデルを読み込めませんでした（仮置きのまま）`, url, e);
      return false;
    }
  }

  update(dt, highlighted) {
    this.time += dt;
    const t = this.time;
    if (this.isPlaceholder) {
      // ゆっくり呼吸
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
    }
    this.bubble.position.y = (this.def.height ?? 0.5) + 0.2 + Math.sin(t * 2.4) * 0.015;
    this.bubble.visible = !highlighted; // 近づいたら HTML の「E：話しかける」に置き換え
  }
}

const _tex = {};
let _gltf = null;
const _loader = () => (_gltf ??= new GLTFLoader());

/** 仮置き：カプセル（テーマ色）＋ 名札 ＋ 足元のリング */
function makePlaceholder(def) {
  const g = new THREE.Group();
  g.name = 'placeholder';
  const H = def.height ?? 0.5;
  const R = H * 0.3;
  const geo = new THREE.CapsuleGeometry(R, Math.max(0.01, H - 2 * R), 6, 16);
  geo.translate(0, H / 2, 0);
  const mat = new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.75, metalness: 0 });
  const body = new THREE.Mesh(geo, mat);
  body.userData.ownGeo = true;
  g.add(body);
  // 前を示す小さな点（向きが分かるように）
  const dot = new THREE.Mesh(new THREE.SphereGeometry(R * 0.18, 10, 8), new THREE.MeshStandardMaterial({ color: '#2e3b30', roughness: 0.5 }));
  dot.position.set(0, H * 0.68, -R * 0.95);
  dot.userData.ownGeo = true;
  g.add(dot);
  // 名札
  const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: nameTagTexture(`${def.name}（仮）`), transparent: true, depthWrite: false }));
  tag.scale.set(0.42, 0.105, 1);
  tag.position.y = H * 0.55;
  tag.position.z = -R - 0.02;
  tag.renderOrder = 4;
  g.add(tag);
  // 足元のリング
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
