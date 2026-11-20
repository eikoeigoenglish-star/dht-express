/**
 * interior/train.js — 【v12】FOREST SCHOOL EXPRESS の車内（TrainInterior）
 * ---------------------------------------------------------------------------
 * v11 の room1.js（Room 1 だけ）を、車両全体へ拡張したもの。
 *   Room 1（リンさん）・Room 2（4 匹 = v11 の部屋）・Room 3（空き）・左舷の廊下・最後部の Dining & Lounge
 *
 * main.js からは boarding.js 経由で enter({ timeMode }) / exit() / update(dt) / render() / setTimeMode() を呼ぶ。
 * 車内表示中は MAP の地形・都市などは更新も描画もしない（別の THREE.Scene）。
 *
 * 操作（室内だけ。MAP の操作は変えない）
 *   ↑ / W 前進　↓ / S 後退　← / A 左旋回　→ / D 右旋回（左右は平行移動ではなく向きを変える）　Shift 走る
 *   E 話す / 調べる / ドアの開閉　V 見渡す　ドラッグ 視点（左右・上下：見上げ +32° 〜 見下ろし -45°）　ホイール 距離
 * 【v13】タッチ端末（touch.js）
 *   左下の仮想スティック（上下 = 前進・後退、左右 = 旋回）　画面のドラッグ = 視点　2 本指のピンチ = 距離
 *   右下のボタン / 相手の上の表示をタップ = 話す・調べる・ドアの開閉
 *
 * 構成
 *   layout.js       寸法・部屋・ゾーン
 *   builder.js      部品の結合・壁の仕上げ・扉・当たり判定
 *   compartment.js  個室（Room 1〜3）
 *   lounge.js       Dining & Lounge
 *   hologram.js     ホログラム投影機（data/signage.js・data/dohentai.js）
 *   characters.js   住人（ROOM_CHARACTERS）
 *   scenery.js      車窓（4 時間帯・無限スクロール）
 *   looks.js        時間帯の見た目
 */
import * as THREE from 'three';
import { pushOutCircle, trs, rodX, rodZ, box, Collider } from './kit.js';
import * as T from './textures.js';
import { WindowScenery } from './scenery.js';
import { RoomCharacter, listCharacters } from './characters.js';
import { resolveRoomLook } from './looks.js';
import { Builder } from './builder.js';
import { buildCompartment } from './compartment.js';
import { buildLounge, HOLOGRAM_POS } from './lounge.js';
import { buildViewRoom } from './viewroom.js';
import { Hologram } from './hologram.js';
import { signageFor } from './data/signage.js';
import { DohentaiSource } from './data/dohentai.js';
import { H, WALL, COMP, COMPARTMENTS, CORRIDOR, DOOR, LOUNGE, LOUNGE_DOOR, CREW_DOOR, SPAWN, ZONES, JUMP_POINTS, MENU_ZONES, VIEW, STAIR, CROSS, zoneAt } from './layout.js';
import { TouchControls } from './touch.js';
import { isTouchUI, onTouchUIChange } from '../device.js';

const PLAYER = { radius: 0.15, walk: 1.4, run: 2.4, back: 0.8, turn: 2.2, turnRun: 2.6 };
const CAM = {
  fov: 58,
  pivotY: 0.58, // カメラが回る中心（葉っぱの少し上）
  dist: 1.9,
  minDist: 0.9,
  maxDist: 3.0,
  pitch: THREE.MathUtils.degToRad(-14), // 視線の上下（正 = 見上げ）
  pitchMin: THREE.MathUtils.degToRad(-45),
  pitchMax: THREE.MathUtils.degToRad(32),
  wallGap: 0.16, // 壁・天井・床からのすき間
};

/** 【v13】自動解像度の段階（乗車時の pixelRatio に掛ける。下限は pixelRatio 1.0） */
const RES_LEVELS = [1, 0.87, 0.75, 0.65, 0.57];

const KEYS = {
  KeyW: 'f', ArrowUp: 'f',
  KeyS: 'b', ArrowDown: 'b',
  KeyA: 'l', ArrowLeft: 'l',
  KeyD: 'r', ArrowRight: 'r',
  ShiftLeft: 'run', ShiftRight: 'run',
};

const damp = (k, dt) => 1 - Math.exp(-k * dt);
const wrapA = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export class TrainInterior {
  /**
   * @param {{ renderer: THREE.WebGLRenderer, canvas: HTMLCanvasElement, hud: HTMLElement }} opts
   */
  constructor(opts) {
    this.renderer = opts.renderer;
    this.canvas = opts.canvas;
    this.hud = opts.hud;
    this.scene = new THREE.Scene();
    this.scene.name = 'forest-school-express';
    this.scene.background = new THREE.Color('#2a1e16');
    this.camera = new THREE.PerspectiveCamera(CAM.fov, innerWidth / innerHeight, 0.03, 26000);
    this.active = false;
    this.colliders = [];
    this.targets = [];
    this.characters = {};
    this.doors = [];
    this.keys = new Set();
    this.talk = null;
    this.holoOpen = false;
    this.timeMode = 'day';
    this.lookKey = 'day';
    this.stats = { fps: 0, frames: 0, t: 0, draw: 0, tris: 0 };
    this.overview = false;
    this.zone = null;
    this._built = false;
    // 【v13】描画の切り分け・確認用スイッチ（?off=animals,scenery,nightfx,lights,holo,cull,res または DHT.interior.ab()）
    this.off = new Set((new URLSearchParams(location.search).get('off') ?? '').split(',').map((v) => v.trim()).filter(Boolean));
    this.visible = new Set(); // いま見えている区画（room1〜3 / corridor / lounge）
    this._visKey = null;
    this.res = { base: 1, level: 0, low: 0, high: 0, lockUntil: 0, raisedAt: -1e9 };
    // 【v16】乗り物ごとの配置（船内 ship.js は同じクラスを継承して差し替える）
    this.kind = 'train';
    this.zoneAt = zoneAt;
    this.zones = ZONES;
    this.menuZones = MENU_ZONES;
    this.spawn = SPAWN;
    this.jumpPoints = JUMP_POINTS;
    this.holoPos = HOLOGRAM_POS;
    this.characterTable = undefined; // characters.js の ROOM_CHARACTERS（列車）
    this._v1 = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._ray = new THREE.Ray();
  }

  /* ==================================================================== */
  /* 構築（初回の enter 前に 1 回だけ）                                      */
  /* ==================================================================== */
  build() {
    if (this._built) return;
    const t0 = performance.now();
    this._makeMaterials();
    this._buildLights();
    this._buildWorld();
    this._buildSunPatch();
    this._buildPlayer();
    this._buildScenery();
    this._buildHologram();
    this._buildCharacters();
    this.doorById = Object.fromEntries(this.doors.map((d) => [d.id, d]));
    this.walls = this.colliders.filter((c) => c.wall);
    this.modestChars = Object.values(this.characters).filter((c) => c.def.modestyRadius);
    this.occluders = this.colliders.filter((c) => c.occlude && !c.wall);
    this._makeEnvironment();
    this._bindDom();
    this._built = true;
    this.buildMs = Math.round(performance.now() - t0);
    console.info(`[interior:${this.kind}] built in ${this.buildMs} ms`);
  }

  /** 列車の内装（区画ごとに結合）・扉 */
  _buildWorld() {
    // 【v13】部品は区画（shell / room1〜3 / corridor / lounge）ごとに結合し、見える区画だけを描く（_updateVisibility）
    // 【v16】View Room（viewroom）・横通路・Lower Deck への階段を追加
    const b = new Builder(this.mats);
    this.comps = COMPARTMENTS.map((def) => {
      b.section(def.id);
      return { def, ...buildCompartment(b, def) };
    });
    b.section('corridor');
    this._buildCorridor(b);
    this.view = buildViewRoom(b);
    for (const p of this.view.plates) this.scene.add(p);
    b.section('lounge');
    this.lounge = buildLounge(b);
    this.scene.add(b.build('train'));
    this.sections = b.sections;
    this.colliders.push(...b.colliders);
    this._buildDoors(b);
    this.sunWindows = [...this.comps.map((c) => c.window), ...this.lounge.windows, ...this.view.windows];
  }

  /** 車窓（右舷・左舷）。【v16】View Room の前面展望窓から前方 front m 先まで景色を置く */
  _buildScenery() {
    this.scenery = new WindowScenery({
      reach: 3200, // 最後部のパノラマ車窓から見える後方
      front: 1600, // 【v16】View Room の前面展望窓から見える前方
      sides: [
        { facing: -1, z0: -WALL, xc: 4 }, // 右舷（個室・ラウンジの大きな窓）
        { facing: 1, z0: CORRIDOR.z1 + WALL, xc: 4, lite: true }, // 左舷（廊下・ラウンジの左舷の窓）
      ],
    });
    this.scene.add(this.scenery.group);
  }

  /** ホログラム投影機（Dining & Lounge） */
  _buildHologram() {
    const P = this.holoPos;
    this.holoSource = new DohentaiSource();
    this.hologram = new Hologram({ position: P, mats: this.mats, source: this.holoSource, signage: signageFor(this.kind) }); // 【v17】案内図は乗り物ごと
    this.scene.add(this.hologram.group);
    this.colliders.push(new Collider(P.x - 0.42, P.x + 0.42, P.z - 0.42, P.z + 0.42, 0, 1.0, { occlude: false, name: 'hologram' }));
    this.targets.push({ kind: 'holo', id: 'hologram', anchor: this.hologram.anchor, radius: 1.05, label: 'E：調べる', head: () => this.hologram.head });
  }

  /** 住人（characters.js の表。列車 = ROOM_CHARACTERS） */
  _buildCharacters() {
    for (const { id, roomId, def } of listCharacters(this.characterTable)) {
      if (def.enabled === false) continue; // まだ乗っていない
      const c = new RoomCharacter(id, def, roomId);
      this.characters[id] = c;
      this.scene.add(c.group);
      this.targets.push({ kind: 'char', id, char: c, anchor: c.anchor, radius: def.radius ? 0.75 : 0.95, label: 'E：話しかける', head: () => c.headWorld });
      // 【v13】ソファーに座る人（リンさん）：膝・すね・ひざ掛けの前垂れを葉っぱとカメラがすり抜けないように
      if (def.kind === 'human' && def.pose === 'sit') {
        const fx = -Math.sin(c.facing);
        const fz = -Math.cos(c.facing);
        const boxAhead = (a0, a1, half, y0, y1, block, name) => {
          const xs = [def.seat.x + fx * a0 - Math.abs(fz) * half, def.seat.x + fx * a1 + Math.abs(fz) * half, def.seat.x + fx * a0 + Math.abs(fz) * half, def.seat.x + fx * a1 - Math.abs(fz) * half];
          const zs = [def.seat.z + fz * a0 - Math.abs(fx) * half, def.seat.z + fz * a1 + Math.abs(fx) * half, def.seat.z + fz * a0 + Math.abs(fx) * half, def.seat.z + fz * a1 - Math.abs(fx) * half];
          const col = new Collider(Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs), y0, y1, { block, occlude: false, name });
          col.wall = true; // カメラも体・ひざ掛けの中へ入れない
          this.colliders.push(col);
        };
        boxAhead(0.24, 0.8, 0.27, 0, 0.86, true, `${id}:legs`);
        boxAhead(-0.22, 0.24, 0.27, 0.45, 1.6, false, `${id}:torso`);
      }
      // ひざ掛けは室内の布と同じく、夕方・夜の「電灯の回り込み光」で明るくする
      if (def.blanket) {
        const m = c.blanketMaterial();
        m.emissiveMap = m.map;
        m.emissive = new THREE.Color(0, 0, 0);
        m.userData.fillScale = 1;
        this.fillMats.push(m);
      }
      // 床に立つ人は葉っぱがすり抜けないよう当たり判定を置く
      if (def.radius) {
        const r = def.radius;
        const col = new Collider(def.seat.x - r, def.seat.x + r, def.seat.z - r, def.seat.z + r, 0, 1.7, { occlude: false, name: `${id}:body` });
        col.wall = true; // カメラも体の中へ入れない
        this.colliders.push(col);
      }
      // 【v14】床に伏せる動物（仔馬）：体の範囲に当たり判定（葉っぱもカメラも体の中へ入らない）
      if (def.footprint) {
        const f = def.footprint;
        const ca = Math.abs(Math.cos(c.facing));
        const sa = Math.abs(Math.sin(c.facing));
        // 前後 = facing の向き、左右 = その直角。回した箱を軸にそろえた箱で包む
        const ex = sa * f.hx + ca * f.hz;
        const ez = ca * f.hx + sa * f.hz;
        const y0 = def.seat.y ?? 0;
        const col = new Collider(def.seat.x - ex, def.seat.x + ex, def.seat.z - ez, def.seat.z + ez, 0, y0 + f.h, { occlude: false, name: `${id}:body` });
        col.wall = true;
        this.colliders.push(col);
      }
      if (def.model) c.loadModel(def.model);
    }
  }

  _makeMaterials() {
    const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0, vertexColors: true, ...o });
    const tx = (this.tex = {
      wood: T.woodTexture('#8a5530', 3),
      woodDark: T.woodTexture('#6f3f22', 9),
      plank: T.plankTexture(),
      fabric: T.fabricTexture('#3f6b45'),
      velvet: T.fabricTexture('#2f5a3a'),
      carpet: T.carpetTexture(),
      runner: T.runnerTexture(),
      runnerLeaf: T.runnerLeafTexture(),
      plaster: T.plasterTexture(),
      wainscot: T.wainscotTexture(),
      gingham: T.ginghamTexture(),
      paintL: T.forestPaintingTexture(5),
      paintR: T.forestPaintingTexture(17),
      cushion: T.cushionTexture(),
      frost: T.frostedLeafTexture(),
      spine: T.bookSpineTexture(),
      wicker: T.wickerTexture(),
      leaf: T.leafVeinTexture(),
      soft: T.softRectTexture(),
      blob: T.radialTexture(0, 1),
      ring: T.radialTexture(0, 1, true),
      banner: T.bannerTexture(),
      emblem: T.emblemTexture(),
      quilt: T.fabricTexture('#ece6d8'), // 【v16】掛け布団（頂点カラーで深緑・アイボリーなどに）
      deck: T.deckTexture(), // 【v16】船のチーク材の甲板
    });
    this.mats = {
      wood: std({ map: tx.wood, roughness: 0.55 }),
      woodDark: std({ map: tx.woodDark, roughness: 0.45 }),
      floor: std({ map: tx.plank, roughness: 0.6 }),
      plaster: std({ map: tx.plaster, roughness: 0.95 }),
      vault: std({ map: tx.plaster, roughness: 0.95, side: THREE.BackSide }),
      vaultWood: std({ map: tx.wood, roughness: 0.55, side: THREE.BackSide }),
      wainscot: std({ map: tx.wainscot, roughness: 0.7 }),
      fabric: std({ map: tx.fabric, roughness: 0.95 }),
      velvet: std({ map: tx.velvet, roughness: 0.9, side: THREE.DoubleSide }),
      leatherGreen: std({ map: tx.velvet, roughness: 0.55 }),
      button: std({ color: '#2c4a31', roughness: 0.7 }),
      brass: std({ color: '#c9a35a', metalness: 0.85, roughness: 0.32 }),
      curtain: std({ color: '#f1e6c9', roughness: 0.92, side: THREE.DoubleSide, emissive: new THREE.Color('#3a2f1c'), emissiveIntensity: 0.35 }),
      carpet: std({ map: tx.carpet, roughness: 1 }),
      runner: std({ map: tx.runner, roughness: 1 }),
      runnerLeaf: std({ map: tx.runnerLeaf, roughness: 0.85, side: THREE.DoubleSide }),
      gingham: std({ map: tx.gingham, roughness: 0.9, side: THREE.DoubleSide }),
      glow: new THREE.MeshStandardMaterial({ color: '#fff4dc', emissive: new THREE.Color('#ffc985'), emissiveIntensity: 1.6, roughness: 0.3 }),
      shade: new THREE.MeshStandardMaterial({ color: '#f4e6c8', emissive: new THREE.Color('#ffc985'), emissiveIntensity: 0.6, roughness: 0.8, side: THREE.DoubleSide }),
      leather: std({ color: '#ffffff', roughness: 0.55 }),
      wicker: std({ map: tx.wicker, roughness: 0.9 }),
      book: std({ map: tx.spine, roughness: 0.7 }),
      ceramic: std({ color: '#b9663d', roughness: 0.7 }),
      ceramicWhite: std({ color: '#f6f1e6', roughness: 0.35 }),
      cake: std({ color: '#d9a55a', roughness: 0.8 }),
      plant: std({ roughness: 0.75, side: THREE.DoubleSide }),
      glass: std({ color: '#d6ece6', roughness: 0.08, metalness: 0.1 }),
      glassDome: new THREE.MeshStandardMaterial({ color: '#e8f4f0', roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.28, depthWrite: false }),
      frost: std({ map: tx.frost, roughness: 0.35, emissive: new THREE.Color('#dfe9dc'), emissiveIntensity: 0.25 }),
      frostPlain: std({ map: tx.frost, roughness: 0.35, emissive: new THREE.Color('#dfe9dc'), emissiveIntensity: 0.25 }),
      paintL: std({ map: tx.paintL, roughness: 0.8 }),
      paintR: std({ map: tx.paintR, roughness: 0.8 }),
      cushion: std({ map: tx.cushion, roughness: 0.95 }),
      banner: std({ map: tx.banner, roughness: 0.9, transparent: false, alphaTest: 0.5, side: THREE.DoubleSide }),
      emblem: std({ map: tx.emblem, roughness: 0.4, metalness: 0.6, alphaTest: 0.5, side: THREE.DoubleSide }),
      // 【v16】ベッド・船の外装（View Room・船内で使う。使わない区画では描かれない）
      linen: std({ color: '#f3ecdc', roughness: 0.95 }),
      quilt: std({ map: tx.quilt, roughness: 0.95 }),
      exterior: std({ map: tx.plaster, color: '#f4f1ea', roughness: 0.7 }),
      deck: std({ map: tx.deck, roughness: 0.75 }),
      paint: std({ color: '#ffffff', roughness: 0.55 }),
      glassPane: new THREE.MeshStandardMaterial({ color: '#dceee8', roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }),
    };
    // 室内の「電灯の回り込み光」：夕方・夜は室内の面だけを暖色で持ち上げる（車窓の景色は暗いまま）。
    // emissive にそのマテリアルの模様（map）を掛けるので、木目や布の柄はそのまま明るくなる。
    const own = ['glow', 'shade', 'frost', 'frostPlain', 'curtain', 'glassDome', 'glassPane'];
    this.fillMats = Object.entries(this.mats).filter(([k]) => !own.includes(k)).map(([, m]) => m);
    for (const m of this.fillMats) {
      if (m.map) m.emissiveMap = m.map;
      m.emissive = new THREE.Color(0, 0, 0);
      m.userData.fillScale = m.map ? 1 : 0.55; // 模様の無い面（真鍮など）は控えめに
    }
    // 色を頂点カラーで付けている部品（本の背・かばん・植物・お菓子など）は回り込み光で白っぽくならないよう弱く
    for (const k of ['book', 'leather', 'plant', 'cake', 'button', 'ceramic', 'ceramicWhite', 'paint', 'deck', 'linen', 'quilt']) {
      const m = this.mats[k];
      if (m.emissiveMap) m.emissiveMap = null;
      m.userData.fillScale = 0.12;
    }
  }

  /** 金属・艶のある木の映り込み用の簡易環境（一度だけ PMREM に焼く） */
  _makeEnvironment() {
    const env = new THREE.Scene();
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const room = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: '#6b5440', side: THREE.BackSide }));
    room.scale.set(12, 6, 12);
    room.position.y = 2;
    env.add(room);
    const panel = (c, i, x, y, z, sx, sy, sz) => {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(i) }));
      m.position.set(x, y, z);
      m.scale.set(sx, sy, sz);
      env.add(m);
    };
    panel('#cfe6f4', 3.2, 0, 2.2, -5.9, 6, 2.2, 0.1);
    panel('#ffd9a0', 4, -5.9, 2.5, 0, 0.1, 0.6, 3);
    panel('#ffd9a0', 4, 5.9, 2.5, 0, 0.1, 0.6, 3);
    panel('#fff0d8', 1.6, 0, 4.9, 0, 4, 0.1, 4);
    panel('#3d5a3c', 1, 0, -0.9, 0, 12, 0.1, 12);
    const pm = new THREE.PMREMGenerator(this.renderer);
    this.envMap = pm.fromScene(env, 0.035).texture;
    pm.dispose();
    env.traverse((o) => {
      if (o.isMesh) o.material.dispose();
    });
    geo.dispose();
    this.scene.environment = this.envMap;
    this.scene.environmentIntensity = 0.55;
  }

  /**
   * 照明：環境光 + 太陽（月） + PointLight 6 つ + 夕方・夜の室内の回り込み光（interiorFill）。
   * PointLight は「葉っぱがいるゾーン」の照明の位置へ移す（数を変えないのでシェーダの再コンパイルなし）。
   */
  _buildLights() {
    this.hemi = new THREE.HemisphereLight(0xfff4e2, 0x6b5440, 1.05);
    this.sun = new THREE.DirectionalLight(0xfff1d8, 2.1);
    this.sun.target.position.set(6, 0.5, 1.5);
    this.scene.add(this.hemi, this.sun, this.sun.target);
    this.lamps = [];
    for (let i = 0; i < 6; i++) {
      const l = new THREE.PointLight(0xffc985, 2.4, 9, 2);
      this.scene.add(l);
      this.lamps.push(l);
    }
  }

  /** 照明の配置をゾーンに合わせる */
  _placeLamps(zone) {
    const L = this._lookApplied ?? this.look;
    const p = this.player.pos;
    let pts;
    if (zone.id === 'lounge') pts = [...this.lounge.lights, new THREE.Vector3(10.3, 2.3, 1.6), new THREE.Vector3(20.2, 2.2, 2.6)];
    else if (zone.id === 'viewroom') pts = [...this.view.lights, new THREE.Vector3(-5.5, 2.35, 3.7), new THREE.Vector3(-12.6, 1.4, 2.15)];
    else if (zone.id === 'corridor' && p.x < CROSS.x1 + 0.6) {
      // 【v16】先頭側の横通路・階段の降り口：横通路 + View Room の後ろ + 廊下の先頭
      const V = this.view.lights;
      pts = [new THREE.Vector3(-7.3, 2.35, 0.7), new THREE.Vector3(-7.3, 2.35, 2.4), new THREE.Vector3(-7.4, 2.35, 3.7), new THREE.Vector3(-4.6, 2.35, 3.7), V[1], V[2]];
    } else if (zone.id === 'corridor') {
      // 廊下：葉っぱの前後の天井 + いちばん近い個室
      const near = this.comps.reduce((a, c) => (Math.abs(c.def.cx - p.x) < Math.abs(a.def.cx - p.x) ? c : a));
      const x = THREE.MathUtils.clamp(p.x, CORRIDOR.x0 + 1, CORRIDOR.x1 - 1);
      pts = [new THREE.Vector3(x - 3, 2.35, 3.7), new THREE.Vector3(x + 3, 2.35, 3.7), new THREE.Vector3(x, 2.35, 3.7), new THREE.Vector3(x - 6, 2.35, 3.7), new THREE.Vector3(x + 6, 2.35, 3.7), near.lights[2]];
    } else {
      const c = this.comps.find((q) => q.def.id === zone.id);
      const cx = c.def.cx;
      pts = [...c.lights, new THREE.Vector3(cx + 0.6, 2.35, 3.7), new THREE.Vector3(cx - 1.75, 1.95, 2.48), new THREE.Vector3(cx + 1.75, 1.95, 2.48)];
    }
    this.lamps.forEach((l, i) => {
      const q = pts[i];
      if (q) {
        l.position.copy(q);
        l.intensity = L.lamp;
      } else l.intensity = 0;
    });
  }

  /* ==================================================================== */
  /* 廊下（左舷側）・仕切り壁                                                 */
  /* ==================================================================== */
  _buildCorridor(b) {
    const { x0, x1, z0, z1 } = CORRIDOR;
    const Z1 = COMP.depth; // 個室側の壁の内面
    // 床・天井・梁・ランナー
    b.B('floor', x0, x1, -0.06, 0, z0, z1);
    b.B('plaster', x0 - WALL, x1, H, H + 0.1, Z1, z1 + WALL);
    for (let x = x0 + 0.8; x < x1; x += 1.6) b.B('wood', x - 0.03, x + 0.03, H - 0.05, H, z0, z1);
    const len = x1 - x0 - 0.4;
    const run = new THREE.PlaneGeometry(len, 0.66);
    run.rotateX(-Math.PI / 2);
    const ru = run.attributes.uv;
    for (let i = 0; i < ru.count; i++) ru.setX(i, ru.getX(i) * len);
    b.add('runner', run, trs((x0 + x1) / 2 - 0.1, 0.004, (z0 + z1) / 2));

    // 個室どうしの仕切り壁（天井まで）と、両端の部屋の外側の壁
    const bounds = [];
    for (const c of COMPARTMENTS) bounds.push(c.cx - COMP.hw - WALL, c.cx + COMP.hw);
    const uniq = [...new Set(bounds.map((v) => +v.toFixed(3)))].sort((a, b2) => a - b2);
    b.section('shell'); // 仕切り壁・個室と廊下の間の壁は両側から見えるので、常に描く区画へ
    for (const xa of uniq) {
      b.B('plaster', xa, xa + WALL, 0, H, -WALL, Z1);
      b.coll(xa - 0.02, xa + WALL + 0.02, -0.5, Z1, { wall: true, name: 'partition' });
    }
    b.section('corridor');

    // 個室側の壁（z = 3.0〜3.1）。各個室の扉の開口部だけ空ける
    const openings = COMPARTMENTS.map((c) => [c.cx + DOOR.rx0, c.cx + DOOR.rx1]);
    // 【v16】先頭側（x < -6.54）は横通路へ開いているので、個室側の壁は Room 1 の前の仕切り壁から
    const innerStart = CROSS.x1;
    let px = innerStart;
    for (const [a, c] of openings) {
      b.section('shell');
      b.B('plaster', px, a, 0, H, Z1, z0);
      b.B('plaster', a, c, DOOR.h, H, Z1, z0);
      b.B('wood', a, a + 0.02, 0, DOOR.h, Z1, z0);
      b.B('wood', c - 0.02, c, 0, DOOR.h, Z1, z0);
      b.B('wood', a, c, DOOR.h - 0.02, DOOR.h, Z1, z0);
      b.B('brass', a, c, -0.03, 0.006, Z1 - 0.02, z0 + 0.02);
      b.B('floor', a - 0.1, c + 0.1, -0.06, 0, z0, z0 + 0.14); // 扉の足元（閉じた扉と壁のすき間から見える床。廊下を描かないときも残す）
      b.section('corridor');
      b.finish('z', z0, 1, px, a);
      b.coll(px, a, Z1 - 0.04, z0, { wall: true, name: 'corridor-inner' });
      // 開口部の枠（廊下側）・レール・敷居
      b.B('wood', a - 0.08, a, 0, DOOR.h + 0.08, z0, z0 + 0.035);
      b.B('wood', c, c + 0.08, 0, DOOR.h + 0.08, z0, z0 + 0.035);
      b.B('wood', a - 0.08, c + 0.08, DOOR.h, DOOR.h + 0.08, z0, z0 + 0.035);
      b.B('brass', a - 0.05, c + DOOR.slide + 0.1, DOOR.h + 0.1, DOOR.h + 0.13, z0 + 0.035, z0 + 0.065);
      px = c;
    }
    b.section('shell');
    b.B('plaster', px, x1, 0, H, Z1, z0);
    b.section('corridor');
    b.finish('z', z0, 1, px, x1);
    b.coll(px, x1, Z1 - 0.04, z0, { wall: true, name: 'corridor-inner' });

    // 外壁（左舷の窓）
    const zo0 = z1;
    const zo1 = z1 + WALL;
    const wins = [-6.6, -4.4, -2.2, 0, 2.2, 4.4, 6.6, 8.2];
    const cw = 0.65;
    const cy0 = 0.95;
    const cy1 = 2.05;
    b.B('plaster', x0, x1, 0, cy0, zo0, zo1);
    b.B('plaster', x0, x1, cy1, H, zo0, zo1);
    px = x0;
    for (const xc of wins) {
      b.B('plaster', px, xc - cw, cy0, cy1, zo0, zo1);
      px = xc + cw;
      b.add('wood', b.ring(cw * 2 + 0.2, cy1 - cy0 + 0.2, 0.14, cw * 2, cy1 - cy0, 0.09, 0.05), trs(xc, (cy0 + cy1) / 2, zo0 - 0.05));
    }
    b.B('plaster', px, x1, cy0, cy1, zo0, zo1);
    b.finish('z', zo0, -1, x0, x1);
    b.add('brass', rodX(x1 - x0 - 0.3, 0.022), trs((x0 + x1) / 2, 0.99, zo0 - 0.085));
    for (let x = x0 + 0.5; x < x1; x += 1.25) b.add('brass', rodZ(0.07, 0.012), trs(x, 0.99, zo0 - 0.045));
    b.coll(x0 - 0.3, x1, zo0 - 0.1, zo1 + 0.4, { wall: true, name: 'corridor-outer' });

    // 【v16】先頭側の端：v15 までの CREW ROOM の扉の壁は撤去。突き当たりは Lower Deck への階段（viewroom.js）

    // 壁のランプ・額・部屋のプレート
    for (const x of [-5.3, -1.6, 2.6, 3.4, 6.9, 8.5]) {
      b.add('brass', box(0.12, 0.12, 0.02), trs(x, 1.85, z0 + 0.02));
      b.add('glow', new THREE.SphereGeometry(0.05, 12, 8), trs(x, 1.92, z0 + 0.1));
      b.add('brass', box(0.018, 0.08, 0.08), trs(x, 1.85, z0 + 0.06));
    }
    for (const [x, key] of [[-1.0, 'paintR'], [7.6, 'paintL']]) {
      b.add(key, new THREE.PlaneGeometry(0.5, 0.36), trs(x, 1.6, z0 + 0.04));
      for (const [dy, dx, w, h] of [[0.2, 0, 0.6, 0.04], [-0.2, 0, 0.6, 0.04], [0, 0.27, 0.04, 0.4], [0, -0.27, 0.04, 0.4]]) b.add('wood', box(w, h, 0.03), trs(x + dx, 1.6 + dy, z0 + 0.03));
    }
    for (const c of COMPARTMENTS) {
      const pl = b.plate(c.label);
      pl.position.set(c.cx + DOOR.rx0 - 0.36, 1.55, z0 + 0.04);
      this.scene.add(pl);
    }
    // Dining & Lounge の入口のプレート（廊下の突き当たり、扉の上）
    const lp = b.plate('Dining & Lounge', 0.62, 0.17);
    lp.position.set(LOUNGE.x0 - WALL - 0.04, DOOR.h + 0.3, (LOUNGE_DOOR.z0 + LOUNGE_DOOR.z1) / 2);
    lp.rotation.y = -Math.PI / 2;
    this.scene.add(lp);
  }

  /* ==================================================================== */
  /* 引き戸（Room 1〜3・Dining & Lounge は開閉できる。CREW ROOM は入れない）   */
  /* ==================================================================== */
  _buildDoors(b) {
    const mk = (id, label, mesh, axis, sign, slide, collider, anchor, head) => {
      const base = mesh.position[axis];
      const d = { id, label, mesh, axis, sign, slide, base, collider, open: 0, target: 0 };
      this.doors.push(d);
      this.colliders.push(collider);
      this.scene.add(mesh);
      this.targets.push({ kind: 'door', id, door: d, anchor, radius: 0.85, head: () => head });
      return d;
    };
    for (const c of COMPARTMENTS) {
      const w = DOOR.rx1 - DOOR.rx0 + 0.1;
      const m = b.doorPanel(w, DOOR.h + 0.03, '');
      const mx = c.cx + (DOOR.rx0 + DOOR.rx1) / 2;
      m.position.set(mx, 0, CORRIDOR.z0 + 0.06);
      const col = new Collider(c.cx + DOOR.rx0 - 0.02, c.cx + DOOR.rx1 + 0.02, COMP.depth - 0.06, CORRIDOR.z0 + 0.1, 0, H, { name: `${c.id}:door` });
      col.wall = true;
      mk(`${c.id}-door`, c.label, m, 'x', 1, DOOR.slide, col, new THREE.Vector3(mx, 0, COMP.depth + 0.05), new THREE.Vector3(mx, 1.3, COMP.depth + 0.05));
    }
    // Dining & Lounge の入口（前の壁の左舷側。ラウンジ側の面を -Z へスライド）
    {
      const D = LOUNGE_DOOR;
      const w = D.z1 - D.z0 + 0.1;
      const m = b.doorPanel(w, D.h + 0.03, '');
      const mz = (D.z0 + D.z1) / 2;
      m.rotation.y = Math.PI / 2; // ローカル +X → ワールド -Z
      m.position.set(LOUNGE.x0 + 0.065, 0, mz);
      const col = new Collider(LOUNGE.x0 - WALL - 0.06, LOUNGE.x0 + 0.1, D.z0 - 0.02, D.z1 + 0.02, 0, 3, { name: 'lounge:door' });
      col.wall = true;
      mk('lounge-door', 'Dining & Lounge', m, 'z', -1, D.slide, col, new THREE.Vector3(LOUNGE.x0 - 0.06, 0, mz), new THREE.Vector3(LOUNGE.x0 - 0.06, 1.3, mz));
    }
    // 【v16】Lower Deck への階段（チェーンで閉鎖。入れない）。v15 までの CREW ROOM の扉の代わり
    {
      const mz = (STAIR.z0 + STAIR.z1) / 2;
      const head = this.view.stair.plate.position.clone();
      this.targets.push({ kind: 'future', id: CREW_DOOR.id, note: CREW_DOOR.note, anchor: new THREE.Vector3(STAIR.x1 + 0.3, 0, mz), radius: 0.8, label: 'E：調べる', head: () => head });
    }
  }

  _applyDoor(d) {
    const e = d.open * d.open * (3 - 2 * d.open);
    d.mesh.position[d.axis] = d.base + d.sign * e * d.slide;
    d.collider.enabled = d.open < 0.6;
  }

  /* ==================================================================== */
  /* 窓から床に落ちる光だまり（個室 3 + ラウンジ右舷 3）                     */
  /* ==================================================================== */
  _buildSunPatch() {
    this.sunPatch = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ map: this.tex.soft, color: '#fff2cf', transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.sunPatch.name = 'sun-patch';
    this.sunPatch.renderOrder = 2;
    this.scene.add(this.sunPatch);
  }

  _layoutSunPatch(L) {
    const d = L.sunDir;
    const wins = this.sunWindows ?? [];
    const pos = [];
    const uvs = [];
    for (const w of wins) {
      const p = [[w.x0, w.y0], [w.x1, w.y0], [w.x1, w.y1], [w.x0, w.y1]].map(([x, y]) => {
        const k = y / Math.max(0.15, d.y);
        return new THREE.Vector3(x - d.x * k, 0.006, THREE.MathUtils.clamp(-d.z * k, 0, w.maxDepth));
      });
      pos.push(...[p[0], p[1], p[2], p[0], p[2], p[3]].flatMap((v) => [v.x, v.y, v.z]));
      uvs.push(0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    this.sunPatch.geometry.dispose();
    this.sunPatch.geometry = g;
    this.sunPatch.material.opacity = L.sunPatch;
    this.sunPatch.material.color.copy(L.sunPatchColor);
    this.sunPatch.visible = L.sunPatch > 0.01;
  }

  /* ==================================================================== */
  /* プレイヤー「葉っぱ」                                                    */
  /* ==================================================================== */
  _buildPlayer() {
    const g = new THREE.Group();
    g.name = 'player-leaf';
    const s = new THREE.Shape();
    s.moveTo(0, 0);
    s.bezierCurveTo(0.13, 0.03, 0.15, 0.2, 0, 0.31);
    s.bezierCurveTo(-0.15, 0.2, -0.13, 0.03, 0, 0);
    const geo = new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.01, bevelSegments: 3, curveSegments: 16 });
    geo.translate(0, 0, -0.006);
    const p = geo.attributes.position;
    const uv = geo.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const y = p.getY(i);
      p.setZ(i, p.getZ(i) + 3.2 * x * x + 0.03 * (y / 0.31) * (y / 0.31));
      uv.setXY(i, (x + 0.16) / 0.32, y / 0.31);
    }
    geo.computeVertexNormals();
    const leafMat = new THREE.MeshStandardMaterial({ map: this.tex.leaf, roughness: 0.55, emissive: new THREE.Color('#2c5a12'), emissiveIntensity: 0.25 });
    const body = new THREE.Mesh(geo, leafMat);
    body.position.y = 0.13;
    body.rotation.y = Math.PI;
    const bodyPivot = new THREE.Group();
    bodyPivot.add(body);
    g.add(bodyPivot);
    const brown = new THREE.MeshStandardMaterial({ color: '#7a5233', roughness: 0.7 });
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.01, 0.05, 6), new THREE.MeshStandardMaterial({ color: '#5f9a3a', roughness: 0.6 }));
    stem.position.y = 0.115;
    bodyPivot.add(stem);
    const legs = [];
    for (const sx of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(sx * 0.035, 0.12, 0);
      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.014, 0.075, 4, 8), brown);
      leg.position.y = -0.05;
      const foot = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 8), brown);
      foot.scale.set(1, 0.6, 1.4);
      foot.position.set(0, -0.1, -0.01);
      pivot.add(leg, foot);
      g.add(pivot);
      legs.push(pivot);
    }
    const blob = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.4), new THREE.MeshBasicMaterial({ map: this.tex.blob, color: '#000000', transparent: true, opacity: 0.28, depthWrite: false }));
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.007;
    const ring = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.46), new THREE.MeshBasicMaterial({ map: this.tex.ring, color: '#c9f27a', transparent: true, opacity: 0.75, depthWrite: false, blending: THREE.AdditiveBlending }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.009;
    blob.renderOrder = ring.renderOrder = 3;
    g.add(blob, ring);
    this.player = { group: g, body: bodyPivot, legs, ring, pos: g.position, speed: 0, angVel: 0, heading: 0, walk: 0, t: 0 };
    this.scene.add(g);
  }

  /* ==================================================================== */
  /* 【v13】見える区画だけを更新・描画する                                     */
  /* ==================================================================== */
  /**
   * 個室は天井まで届く壁と不透明な引き戸で囲まれているので、「葉っぱ（とカメラ）がいる区画」から
   * 「開いている扉」をたどって届く区画だけが見える。届かない区画の内装・住人・ホログラム・
   * 反対舷の車窓は、描画も毎フレームの更新もしない（見た目は変わらない）。
   *   Room 2（扉は閉）→ Room 2 の内装 + 4 匹 + 右舷の車窓だけ
   *   廊下（扉はすべて閉）→ 廊下 + 左舷の車窓だけ
   */
  _updateVisibility() {
    const vis = this.visible;
    vis.clear();
    const open = (id) => this.doorById[id].open > 0.001;
    this._facingFront = this.camera.getWorldDirection(this._v1).x < -0.2; // 【v16】カメラが先頭側（-X）を向いている
    const visit = (id) => {
      if (vis.has(id)) return;
      vis.add(id);
      if (id === 'corridor') {
        for (const c of COMPARTMENTS) if (open(`${c.id}-door`)) visit(c.id);
        if (open('lounge-door')) visit('lounge');
        // 【v16】扉の無いアーチと階段の上の手すり壁越しに見える。ただし廊下で後ろ（+X・ラウンジの方）を向いているときは見えないので描かない
        if (this._facingFront || this.player.pos.x < CROSS.x1 + 0.4) visit('viewroom');
      } else if (id === 'viewroom') visit('corridor');
      else if (open(`${id}-door`)) visit('corridor');
    };
    if (this.off.has('cull')) for (const id of Object.keys(this.sections)) vis.add(id); // 切り分け用：v12 と同じく全部描く
    else {
      visit(this.zone.id);
      visit(this.zoneAt(this.camera.position.x, this.camera.position.z).id);
    }
    const key = [...vis].sort().join('+');
    // 個室の中だけが見えているとき：車窓は「その部屋の窓枠」を通して見える範囲だけ（scenery.cull）
    this._portal = null;
    if (vis.size === 1 && !this.off.has('cull')) {
      const c = this.comps.find((q) => q.def.id === this.zone.id);
      if (c) this._portal = c.window;
    }
    if (key === this._visKey) return;
    this._visKey = key;
    const off = this.off;
    for (const [id, g] of Object.entries(this.sections)) g.visible = id === 'shell' || vis.has(id);
    for (const d of this.doors) d.mesh.visible = vis.has('corridor') || vis.has(d.id.replace('-door', ''));
    for (const c of Object.values(this.characters)) {
      const kindOff = c.def.kind === 'human' ? off.has('rin') : off.has('animals');
      c.group.visible = vis.has(c.roomId) && !kindOff && !off.has('chars');
    }
    this.hologram.group.visible = vis.has('lounge') && !off.has('holo');
    const rooms = COMPARTMENTS.some((c) => vis.has(c.id));
    const lounge = vis.has('lounge');
    const view = vis.has('viewroom'); // 【v16】前面展望窓からは両舷の景色が見える
    this.scenery.group.visible = !off.has('scenery');
    this.scenery.setVisibleSides(rooms || lounge || view, vis.has('corridor') || lounge || view);
  }

  /**
   * 【v13】切り分け用スイッチ。例：DHT.interior.ab('animals', false) で 4 匹を描かない。
   *   animals / rin / chars … 住人　　scenery … 車窓　　nightfx … 夜景の追加要素（窓明かり・街路灯・航空障害灯・星・遠景の光）
   *   lights … 室内の電灯（PointLight と回り込み光）　　holo … ホログラム
   *   cull … v13 の「見える区画だけ描く」を無効にして v12 と同じ描き方にする　　res … 自動解像度を無効にする
   * URL でも指定できる：?stats=1&off=animals,scenery
   */
  ab(name, on) {
    if (on ?? this.off.has(name)) this.off.delete(name);
    else this.off.add(name);
    this._visKey = null;
    if (this._built && this.look) this.setTimeMode(this.timeMode);
    if (this.off.has('res')) this._setResLevel(0);
    return [...this.off];
  }

  /**
   * 【v13】自動解像度（車内だけ）。見える区画だけ描いてもなお 45 fps を下回る端末では、
   * 描画解像度（pixelRatio）を段階的に下げて操作感を保つ。余裕があれば元へ戻す。
   * 下限は CSS ピクセル等倍（pixelRatio 1.0）。MAP へ戻るときに元の値へ戻す。
   */
  _adaptResolution(fps) {
    const r = this.res;
    if (this.off.has('res') || r.base <= 1) return;
    const now = performance.now();
    if (now < r.settleUntil) return; // 乗車直後・モデル読み込み直後のひっかかりは数えない
    r.low = fps < 45 ? r.low + 1 : 0;
    r.high = fps >= 58 ? r.high + 1 : 0;
    if (r.low >= 4 && r.level < RES_LEVELS.length - 1) {
      // 上げた直後にまた落ちた → しばらく上げない（行ったり来たりを防ぐ）
      if (now - r.raisedAt < 12000) r.lockUntil = now + 90000;
      this._setResLevel(r.level + 1);
    } else if (r.high >= 12 && r.level > 0 && now > r.lockUntil) {
      r.raisedAt = now;
      this._setResLevel(r.level - 1);
    }
  }

  _setResLevel(level) {
    const r = this.res;
    r.level = level;
    r.low = r.high = 0;
    r.settleUntil = performance.now() + 1500;
    const pr = Math.max(Math.min(r.base, 1), r.base * RES_LEVELS[level]);
    if (Math.abs(this.renderer.getPixelRatio() - pr) > 1e-3) this.renderer.setPixelRatio(pr);
  }

  /* ==================================================================== */
  /* 入退室・時間帯                                                          */
  /* ==================================================================== */
  /**
   * @param {{ timeMode?: string, km?: number, sceneryPlan?: import('../sceneryplan.js').SceneryPlan }} [opts]
   *   timeMode は MAP の tod.mode。km は【v15】いまの累積 km（車窓の景観 scene を決める。timeMode とは独立）
   */
  enter(opts = {}) {
    this.build();
    this.active = true;
    this.setTimeMode(opts.timeMode ?? 'day');
    if (opts.sceneryPlan) this.sceneryPlan = opts.sceneryPlan;
    this.setJourneyKm(opts.km ?? this.journeyKm ?? 0, { instant: true });
    const p = this.player;
    p.pos.set(this.spawn.x, 0, this.spawn.z);
    p.speed = p.angVel = 0;
    p.heading = this.spawn.heading;
    p.group.rotation.y = p.heading;
    this.camYaw = p.heading;
    this.yawOffset = 0;
    // 【v17】出発点（Dining & Lounge）はホログラムの像が入るよう視線を水平に近く（現在地メニューの lounge と同じ）
    this.viewPitch = this.spawn.pitch != null ? THREE.MathUtils.degToRad(this.spawn.pitch) : CAM.pitch;
    this.camDist = CAM.dist;
    this.armLen = null;
    this.overview = false;
    for (const d of this.doors) {
      d.open = d.target = 0; // 扉はすべて閉じた状態から
      this._applyDoor(d);
    }
    this._closeTalk();
    this._closeHolo();
    this.keys.clear();
    this._camInit = true;
    this.zone = null;
    this._visKey = null;
    this.res.base = this.renderer.getPixelRatio();
    this.res.lockUntil = 0;
    this._setResLevel(0);
    this.res.settleUntil = performance.now() + 4000;
    this._prevTone = { tm: this.renderer.toneMapping, ex: this.renderer.toneMappingExposure };
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = this.look.exposure;
    this.resize();
    this._listen(true);
    this.touch._label = undefined; // 【v16】HUD を共有するもう一方の室内が最後に出したボタンの表示を引き継がない
    this.touch.setAction(null);
    this._renderZoneMenu(); // 【v16】列車と船で HUD を共有するので、乗るたびにメニューを作り直す
    this.hud.dataset.vehicle = this.kind;
    const brand = this.hud.querySelector('[data-room1="brand"]');
    if (brand) brand.textContent = this.kind === 'ship' ? 'FOREST SCHOOL EXPRESS · SHIP' : 'FOREST SCHOOL EXPRESS';
    this.hud.hidden = false;
    this.touch.showGuide(true, 7000); // タッチ端末：乗車直後だけ操作ガイド（? ボタンでいつでも出せる）
    this.update(0);
  }

  exit() {
    if (!this.active) return;
    this.active = false;
    this._listen(false);
    this._closeTalk();
    this._closeHolo();
    this._toggleZoneMenu(false);
    this.keys.clear();
    this.hud.hidden = true;
    this.$prompt.classList.remove('is-on');
    if (Math.abs(this.renderer.getPixelRatio() - this.res.base) > 1e-3) this.renderer.setPixelRatio(this.res.base); // 自動解像度を元へ
    if (this._prevTone) {
      this.renderer.toneMapping = this._prevTone.tm;
      this.renderer.toneMappingExposure = this._prevTone.ex;
    }
  }

  /**
   * 【v15】累積 km → 車窓の景観（data/scenery の区間・preset。境界 ±1 km はクロスフェード）。
   * 乗車時は即座に、乗車中に変えたとき（DHT.interior.setJourneyKm(…) など）は約 1.2 秒で入れ替える。
   */
  setJourneyKm(km, { instant = false } = {}) {
    this.journeyKm = Number(km) || 0;
    const plan = this.sceneryPlan;
    if (!plan?.ready || !this.scenery?.themes) return null;
    const r = plan.resolve(this.journeyKm);
    this.scenery.themes.setScene(r, { instant });
    this.sceneId = r.t > 0 && r.t < 1 ? `${r.from.id}→${r.to.id}` : r.sceneId;
    return r;
  }

  /** 時間帯（MAP と同じ 4 モード名）。車窓・室内の照明・住人の明るさを切り替える */
  setTimeMode(mode) {
    const r = resolveRoomLook(mode);
    this.timeMode = r.requested;
    this.lookKey = r.key;
    this.look = r.look;
    let L = this.look;
    // 【v13】切り分け用：夜景の追加要素・室内の電灯を消した見た目
    if (this.off.has('nightfx')) L = { ...L, windowLit: 0, windowGlow: 0, streetGlow: 0, beacons: false, stars: 0, sunGlow: { ...L.sunGlow, opacity: 0 } };
    if (this.off.has('lights')) L = { ...L, lamp: 0, interiorFill: 0 };
    this._lookApplied = L;
    this.hemi.color.copy(L.hemiSky);
    this.hemi.groundColor.copy(L.hemiGround);
    this.hemi.intensity = L.hemi;
    this.sun.color.copy(L.sunColor);
    this.sun.intensity = L.sun;
    this.sun.position.copy(L.sunDir).multiplyScalar(30).add(this.sun.target.position);
    for (const l of this.lamps) {
      l.color.copy(L.lampColor);
      l.visible = !this.off.has('lights');
    }
    // 室内の回り込み光（夕方・夜は電灯をつけて明るく）
    const fill = new THREE.Color(L.fillColor ?? L.lampColor);
    for (const m of this.fillMats) m.emissive.copy(fill).multiplyScalar((L.interiorFill ?? 0) * m.userData.fillScale);
    this.mats.glow.emissive.copy(L.lampColor);
    this.mats.glow.emissiveIntensity = 1.6 * L.lampGlow;
    this.mats.shade.emissive.copy(L.lampColor);
    this.mats.shade.emissiveIntensity = 0.6 * L.lampGlow;
    this.scene.fog = new THREE.Fog(L.haze, L.hazeNear, L.hazeFar);
    this.scenery.applyLook(L);
    this._layoutSunPatch(L);
    for (const c of Object.values(this.characters)) c.applyTint(L.charTint);
    if (this.zone) this._placeLamps(this.zone);
    if (this.active) this.renderer.toneMappingExposure = L.exposure;
  }

  /* ==================================================================== */
  /* 入力                                                                    */
  /* ==================================================================== */
  _bindDom() {
    const $ = (sel) => this.hud.querySelector(sel);
    this.$prompt = $('[data-room1="prompt"]');
    this.$talk = $('[data-room1="talk"]');
    this.$talkName = $('[data-room1="talk-name"]');
    this.$talkText = $('[data-room1="talk-text"]');
    this.$toast = $('[data-room1="toast"]');
    this.$zone = $('[data-room1="zone"]');
    this.$holo = $('[data-room1="holo"]');
    this.$stats = $('[data-room1="stats"]');
    if (this.$stats) this.$stats.hidden = !new URLSearchParams(location.search).has('stats');
    if (this.$stats?.hidden) this.$stats = null;
    this.$talk.addEventListener('click', () => this.active && this._advanceTalk());
    // 【v14】現在地メニュー（部屋名の ▾ から Room 1〜3・Corridor・Dining & Lounge へ瞬時に移動）
    this.$zoneBtn = $('[data-room1="zone-btn"]');
    this.$zoneMenu = $('[data-room1="zone-menu"]');
    if (this.$zoneBtn && this.$zoneMenu) {
      this.$zoneBtn.addEventListener('click', (e) => {
        if (!this.active) return;
        e.stopPropagation();
        this._toggleZoneMenu();
      });
      this.$zoneMenu.addEventListener('click', (e) => {
        if (!this.active) return;
        const b = e.target.closest('[data-zone]');
        if (!b) return;
        e.stopPropagation();
        this._toggleZoneMenu(false);
        this.jumpTo(b.dataset.zone);
        b.blur();
        this.$zoneBtn.blur();
        this.canvas.focus?.({ preventScroll: true });
      });
      this.$zoneMenu.addEventListener('keydown', (e) => {
        if (!this.active) return;
        const items = [...this.$zoneMenu.querySelectorAll('[data-zone]')];
        const i = items.indexOf(document.activeElement);
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
        } else if (e.key === 'Escape') {
          this._toggleZoneMenu(false);
          this.$zoneBtn.focus();
        } else return;
        e.preventDefault();
        e.stopPropagation();
      });
      // メニューの外を押したら閉じる
      document.addEventListener('pointerdown', (e) => {
        if (this.active && this._zoneMenuOpen && !e.target.closest?.('[data-room1="zone-menu"], [data-room1="zone-btn"]')) this._toggleZoneMenu(false);
      });
    }
    this.$holo.querySelector('[data-act="close"]').addEventListener('click', () => this.active && this._closeHolo());
    // 【v13】タッチ端末：仮想スティック・右下のボタン。相手の上の表示（話しかける など）もタップできる
    this.touch = new TouchControls({
      hud: this.hud,
      onAction: () => this.active && this._primaryAction(),
      onOverview: () => this.active && (this.overview = !this.overview),
      isActive: () => this.active,
    });
    this.$prompt.addEventListener('click', () => this.active && this.touchUI && this._primaryAction());
    this._setTouchUI(isTouchUI());
    onTouchUIChange((t) => this._setTouchUI(t));

    this._onKeyDown = (e) => {
      if (!this.active) return;
      if (e.target instanceof HTMLInputElement) return;
      // 【v14】現在地メニューを開いている間は、矢印キー・Enter・Space はメニューの操作に使う
      if (this._zoneMenuOpen || e.target.closest?.('[data-room1="zone-btn"]')) {
        if (e.code === 'Escape' && this._zoneMenuOpen) this._toggleZoneMenu(false);
        if (this._zoneMenuOpen || ['Enter', 'Space'].includes(e.code)) return;
      }
      const k = KEYS[e.code];
      if (k) {
        this.keys.add(k);
        e.preventDefault();
      }
      if (e.repeat) return;
      if (e.code === 'KeyE' || ((e.code === 'Enter' || e.code === 'Space') && (this.talk || this.holoOpen))) {
        e.preventDefault();
        this._primaryAction();
      } else if (e.code === 'Escape') {
        if (this.talk) this._closeTalk();
        if (this.holoOpen) this._closeHolo();
      } else if (e.code === 'KeyV') {
        this.overview = !this.overview;
      }
    };
    this._onKeyUp = (e) => {
      const k = KEYS[e.code];
      if (k) this.keys.delete(k);
    };
    this._onBlur = () => {
      this.keys.clear();
      this._ptrs.clear(); // 離した通知が届かなかった指を残さない
      this._drag = this._pinch = null;
      this.touch.release();
    };
    // 視点のドラッグ。【v13】canvas の上で始まった指（pointerId）だけを追う
    //   → スティックやボタンに触れている別の指の動きでは視点は動かない（マルチタッチの競合を防ぐ）。
    //   canvas に 2 本の指があるときはピンチ（カメラの距離。PC のホイールと同じ）。
    this._ptrs = new Map();
    const startDrag = (id, p) => (this._drag = { id, x: p.x, y: p.y, yaw: this.yawOffset, pitch: this.viewPitch });
    const pinchDist = () => {
      const [a, b] = [...this._ptrs.values()];
      return Math.max(8, Math.hypot(a.x - b.x, a.y - b.y));
    };
    this._onPointerDown = (e) => {
      if (e.button !== 0 && e.button !== 2) return;
      if (this._ptrs.size >= 2) return;
      this._ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.canvas.setPointerCapture?.(e.pointerId);
      if (this._ptrs.size === 1) startDrag(e.pointerId, { x: e.clientX, y: e.clientY });
      else {
        this._drag = null;
        this._pinch = { d0: pinchDist(), dist0: this.camDist };
      }
    };
    this._onPointerMove = (e) => {
      const p = this._ptrs.get(e.pointerId);
      if (!p) return; // canvas で始まっていない指（スティック・ボタン）は無視
      p.x = e.clientX;
      p.y = e.clientY;
      if (this._pinch && this._ptrs.size === 2) {
        this.camDist = THREE.MathUtils.clamp((this._pinch.dist0 * this._pinch.d0) / pinchDist(), CAM.minDist, CAM.maxDist);
        return;
      }
      if (!this._drag || this._drag.id !== e.pointerId) return;
      // 左右：葉っぱのまわりを回る（離すと少しずつ葉っぱの後ろへ戻る）／上下：上へドラッグで見上げる
      this.yawOffset = this._drag.yaw - (e.clientX - this._drag.x) * 0.006;
      this.viewPitch = THREE.MathUtils.clamp(this._drag.pitch - (e.clientY - this._drag.y) * 0.0045, CAM.pitchMin, CAM.pitchMax);
    };
    this._onPointerUp = (e) => {
      if (!this._ptrs.delete(e.pointerId)) return;
      this._pinch = null;
      this._drag = null;
      // ピンチの片方の指を離した → 残った指でそのまま視点のドラッグを続ける（視点が飛ばないよう今の位置から）
      for (const [id, p] of this._ptrs) startDrag(id, p);
    };
    this._onWheel = (e) => {
      e.preventDefault();
      this.camDist = THREE.MathUtils.clamp(this.camDist * Math.exp(e.deltaY * 0.0012), CAM.minDist, CAM.maxDist);
    };
    this._onContext = (e) => e.preventDefault();
  }

  _listen(on) {
    const f = on ? 'addEventListener' : 'removeEventListener';
    window[f]('keydown', this._onKeyDown);
    window[f]('keyup', this._onKeyUp);
    window[f]('blur', this._onBlur);
    this.canvas[f]('pointerdown', this._onPointerDown);
    window[f]('pointermove', this._onPointerMove);
    window[f]('pointerup', this._onPointerUp);
    window[f]('pointercancel', this._onPointerUp);
    this.canvas[f]('wheel', this._onWheel, { passive: false });
    this.canvas[f]('contextmenu', this._onContext);
    if (!on) {
      this._drag = null;
      this._pinch = null;
      this._ptrs.clear();
      this.touch.release();
    }
  }

  /** 【v13】タッチ UI の切替（device.js の判定）。PC の UI では仮想スティック・ボタンは出さない */
  _setTouchUI(on) {
    this.touchUI = on;
    this.touch.setEnabled(on);
    this.resize();
  }

  /** E キー / 右下のボタン / 表示のタップ：会話を進める・ホログラムを閉じる・近くの相手へ話しかける（調べる） */
  _primaryAction() {
    if (this.talk) this._advanceTalk();
    else if (this.holoOpen) this._closeHolo();
    else this._interact();
  }

  /* ==================================================================== */
  /* 話しかける・調べる                                                      */
  /* ==================================================================== */
  _nearestTarget() {
    const p = this.player.pos;
    let best = null;
    let bd = Infinity;
    let char = null; // 【v17】範囲内でいちばん近い住人
    let cd = Infinity;
    for (const t of this.targets) {
      const d = Math.hypot(t.anchor.x - p.x, t.anchor.z - p.z);
      if (d < t.radius && d < bd) {
        best = t;
        bd = d;
      }
      if (t.kind === 'char' && d < t.radius && d < cd) {
        char = t;
        cd = d;
      }
    }
    // 【v17】住人に話しかけられる距離にいるときは、扉の前に立っていない限り「調べる」（シャワー室・トイレの札など）より会話を優先
    //   （船の Room 3 のウサギはトイレの扉のすぐ横のベッドにいて、v16 では近づいても「E：調べる」になっていた）
    if (char && best?.kind === 'future' && bd > 0.25) return char;
    return best;
  }

  _promptLabel(t) {
    const s = t.kind === 'door' ? (t.door.target > 0.5 ? 'E：ドアを閉める' : 'E：ドアを開ける') : t.label;
    return this.touchUI ? s.replace(/^E：/, '') : s; // タッチ端末には E キーが無い（表示そのものをタップ）
  }

  _interact() {
    const t = this._nearestTarget();
    if (!t) return;
    if (t.kind === 'char') this._openTalk(t.char);
    else if (t.kind === 'door') t.door.target = t.door.target > 0.5 ? 0 : 1;
    else if (t.kind === 'holo') this._openHolo();
    else if (t.kind === 'future') this._toast(t.note);
  }

  _faceTo(x, z) {
    const p = this.player;
    p.heading = p.group.rotation.y + wrapA(Math.atan2(-(x - p.pos.x), -(z - p.pos.z)) - p.group.rotation.y);
  }

  _openTalk(ch) {
    this.talk = { ch, i: 0 };
    this._faceTo(ch.def.seat.x, ch.def.seat.z);
    this.yawOffset = 0;
    this._showLine();
    this.$talk.classList.add('is-on');
  }

  _showLine() {
    const { ch, i } = this.talk;
    this.$talkName.textContent = ch.name;
    this.$talkText.textContent = ch.lines[i];
  }

  _advanceTalk() {
    if (!this.talk) return;
    this.talk.i++;
    if (this.talk.i >= this.talk.ch.lines.length) this._closeTalk();
    else this._showLine();
  }

  _closeTalk() {
    this.talk = null;
    this.$talk?.classList.remove('is-on');
  }

  /** ホログラム：情報 UI（ド変態カウンター）へ切り替え */
  async _openHolo() {
    this.holoOpen = true;
    this._faceTo(this.holoPos.x, this.holoPos.z);
    this.hologram.setMode('stats');
    this.$holo.classList.add('is-on');
    this._renderHoloPanel(this.holoSource.last, true);
    const d = await this.holoSource.load();
    if (!this.holoOpen) return;
    this.hologram.setData(d);
    this._renderHoloPanel(d, false);
    clearInterval(this._holoTimer);
    this._holoTimer = setInterval(async () => {
      const d2 = await this.holoSource.load();
      if (!this.holoOpen) return;
      this.hologram.setData(d2);
      this._renderHoloPanel(d2, false);
    }, this.holoSource.config.refreshSec * 1000);
  }

  _renderHoloPanel(d, loading) {
    const max = Math.max(1, ...d.entries.map((e) => e.count));
    const list = this.$holo.querySelector('[data-holo="list"]');
    list.replaceChildren(
      ...d.entries.map((e, i) => {
        const li = document.createElement('li');
        li.innerHTML = `<span class="rk">${i + 1}</span><span class="nm"></span><span class="bar"><i style="width:${((e.count / max) * 100).toFixed(1)}%"></i></span><b class="ct">${e.count}</b>`;
        li.querySelector('.nm').textContent = e.name;
        return li;
      }),
    );
    const t = new Date(d.updatedAt);
    this.$holo.querySelector('[data-holo="target"]').textContent = d.target;
    this.$holo.querySelector('[data-holo="meta"]').textContent = `${loading ? '読み込み中… ' : ''}${d.isMock ? '仮データ（js/interior/data/dohentai.js）' : 'ライブデータ'} ・ 更新 ${Number.isNaN(t.getTime()) ? d.updatedAt : t.toLocaleString('ja-JP')}`;
  }

  _closeHolo() {
    if (!this.holoOpen) return;
    this.holoOpen = false;
    clearInterval(this._holoTimer);
    this.hologram?.setMode('signage');
    this.$holo?.classList.remove('is-on');
  }

  _toast(msg) {
    this.$toast.textContent = msg;
    this.$toast.classList.add('is-on');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => this.$toast.classList.remove('is-on'), 2200);
  }

  /** 外部から：キャラクターの GLB を差し替える */
  setCharacterModel(id, url) {
    this.build();
    const c = this.characters[id];
    if (!c) throw new Error(`unknown or disabled character: ${id}`);
    return c.loadModel(url);
  }

  /* ==================================================================== */
  /* 移動（↑↓ 前進・後退、←→ 旋回）                                          */
  /* ==================================================================== */
  _movePlayer(dt) {
    const p = this.player;
    const K = this.keys;
    const busy = this.talk || this.holoOpen;
    // キーボード（-1 / 0 / +1）+ 【v13】仮想スティック（-1〜+1 のアナログ）。PC ではスティックは常に 0
    const A = this.touch.axes;
    const clamp1 = (v) => Math.max(-1, Math.min(1, v));
    const turn = busy ? 0 : clamp1((K.has('l') ? 1 : 0) - (K.has('r') ? 1 : 0) + A.turn);
    const fwd = busy ? 0 : clamp1((K.has('f') ? 1 : 0) - (K.has('b') ? 1 : 0) + A.fwd);
    const run = K.has('run') || A.run;
    // 旋回（左 = 正）。角速度をなめらかに
    const wTarget = turn * (run ? PLAYER.turnRun : PLAYER.turn);
    p.angVel += (wTarget - p.angVel) * damp(14, dt);
    p.heading += p.angVel * dt;
    // 前進・後退
    const sTarget = fwd > 0 ? fwd * (run ? PLAYER.run : PLAYER.walk) : fwd * PLAYER.back;
    p.speed += (sTarget - p.speed) * damp(fwd !== 0 ? 9 : 12, dt);
    const vx = -Math.sin(p.heading) * p.speed;
    const vz = -Math.cos(p.heading) * p.speed;
    // 当たり判定（低 FPS でも薄い壁をすり抜けないよう 4 cm ごと）
    const n = Math.max(1, Math.ceil((Math.abs(p.speed) * dt) / 0.04));
    for (let k = 0; k < n; k++) {
      p.pos.x += (vx * dt) / n;
      p.pos.z += (vz * dt) / n;
      for (let it = 0; it < 3; it++) {
        let hit = false;
        for (const c of this.colliders) if (c.enabled && c.block && pushOutCircle(p.pos, PLAYER.radius, c)) hit = true;
        if (!hit) break;
      }
    }
    // 向き（話しかけたときは相手の方へなめらかに）
    p.group.rotation.y += (p.heading - p.group.rotation.y) * damp(busy ? 8 : 40, dt);
    // 歩き・その場旋回のアニメーション
    p.t += dt;
    const w = Math.min(1, Math.max(Math.abs(p.speed) / PLAYER.walk, (Math.abs(p.angVel) / PLAYER.turn) * 0.55));
    p.walk += dt * (6 + Math.abs(p.speed) * 5.5 + Math.abs(p.angVel) * 2) * Math.sign(p.speed || 1);
    const sw = Math.sin(p.walk) * 0.65 * w;
    p.legs[0].rotation.x = sw;
    p.legs[1].rotation.x = -sw;
    p.body.position.y = Math.abs(Math.sin(p.walk)) * 0.018 * w + Math.sin(p.t * 2.2) * 0.004 * (1 - w);
    p.body.rotation.x = -0.12 * Math.min(1, p.speed / PLAYER.walk) + 0.06 * Math.max(0, -p.speed / PLAYER.back);
    p.body.rotation.z = Math.sin(p.walk) * 0.06 * w + Math.sin(p.t * 1.6) * 0.03 * (1 - w) - p.angVel * 0.05;
    p.ring.material.opacity = 0.55 + Math.sin(p.t * 3) * 0.15;
  }

  /* ==================================================================== */
  /* カメラ：葉っぱを中心に円弧を描く第三者視点（壁・天井・床で縮む）          */
  /* ==================================================================== */
  /** 原点 o から方向 dir（単位）へ進んで、最初に当たる箱までの距離 */
  _castBoxes(o, dir, list, maxD) {
    let best = maxD;
    this._ray.set(o, dir);
    for (const c of list) {
      if (!c.enabled) continue;
      if (c.box.containsPoint(o)) continue;
      const hit = this._ray.intersectBox(c.box, this._v2);
      if (hit) {
        const d = hit.distanceTo(o);
        if (d < best) best = d;
      }
    }
    return best;
  }

  _updateCamera(dt) {
    const p = this.player;
    const pivot = new THREE.Vector3(p.pos.x, CAM.pivotY, p.pos.z);
    const zone = this.zoneAt(p.pos.x, p.pos.z);
    // 左右：葉っぱの向き + ドラッグのずれ。少し遅れて追従（急に回らない）
    const moving = Math.abs(p.speed) > 0.05 || Math.abs(p.angVel) > 0.05;
    if (moving && !this._drag) this.yawOffset *= Math.exp(-dt * 1.2);
    const want = p.group.rotation.y + this.yawOffset;
    this.camYaw += wrapA(want - this.camYaw) * damp(this._drag ? 20 : 4.5, dt);
    let pos;
    let look;
    if (this.overview) {
      ({ pos, look } = this._overviewCam(zone, pivot));
    } else {
      const th = this.viewPitch;
      const dir = new THREE.Vector3(-Math.sin(this.camYaw) * Math.cos(th), Math.sin(th), -Math.cos(this.camYaw) * Math.cos(th));
      const back = dir.clone().negate();
      // 床・天井
      let L = this.camDist;
      const ceil = zone.ceil(p.pos.z) - CAM.wallGap;
      if (back.y < -1e-4) L = Math.min(L, (pivot.y - 0.12) / -back.y);
      if (back.y > 1e-4) L = Math.min(L, (ceil - pivot.y) / back.y);
      // 壁・閉じた扉（突き抜けない）
      L = Math.min(L, this._castBoxes(pivot, back, this.walls, L + CAM.wallGap) - CAM.wallGap);
      // 大きな家具（葉っぱが隠れないよう手前へ）
      L = Math.min(L, this._castBoxes(pivot, back, this.occluders, L + 0.08) - 0.08);
      L = Math.max(0.05, L); // 壁際でも壁の中へは入れない
      // 縮むときはすぐ、伸びるときはゆっくり
      if (this.armLen == null || L < this.armLen) this.armLen = L;
      else this.armLen += (L - this.armLen) * damp(2.5, dt);
      pos = pivot.clone().addScaledVector(back, this.armLen);
      // 立っている人（リンさん）の近くでは、カメラをスカートの裾より下げない
      for (const c of this.modestChars) {
        const s = c.def.seat;
        if (Math.hypot(pos.x - s.x, pos.z - s.z) < c.def.modestyRadius) pos.y = Math.max(pos.y, c.def.modestyMinY);
      }
      // 丸い天井（ラウンジ）など場所で天井が変わるので念のため
      const zc = this.zoneAt(pos.x, pos.z);
      pos.y = THREE.MathUtils.clamp(pos.y, 0.1, zc.ceil(pos.z) - 0.1);
      look = pivot.clone().addScaledVector(dir, 2.0);
    }
    if (this._camInit || this.overview !== this._lastOverview) {
      this.camPos = pos.clone();
      this.camLook = look.clone();
      this._camInit = false;
      this._lastOverview = this.overview;
    } else if (this.overview) {
      this.camPos.lerp(pos, damp(4, dt));
      this.camLook.lerp(look, damp(8, dt));
    } else {
      // 追従は計算済み（腕の長さ・角度をなめらかにしている）。壁を抜けないよう位置はそのまま
      this.camPos.copy(pos);
      this.camLook.lerp(look, damp(30, dt));
    }
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
  }

  /** V：ゾーンを見渡す固定の視点 */
  _overviewCam(zone, pivot) {
    let pos;
    if (zone.id === 'lounge') pos = new THREE.Vector3(LOUNGE.x0 + 0.5, 2.5, 0.45);
    else if (zone.id === 'viewroom') pos = new THREE.Vector3(VIEW.x1 - 0.25, 2.35, 1.0);
    else if (zone.id === 'corridor' && pivot.x < CROSS.x1) pos = new THREE.Vector3(CROSS.x1 - 0.2, 2.3, 0.3);
    else if (zone.id === 'corridor') pos = new THREE.Vector3(THREE.MathUtils.clamp(pivot.x - 3, CORRIDOR.x0 + 0.3, CORRIDOR.x1 - 0.3), 2.3, CORRIDOR.z0 + 0.25);
    else {
      const c = this.comps.find((q) => q.def.id === zone.id);
      const sx = pivot.x > c.def.cx ? -1 : 1;
      pos = new THREE.Vector3(c.def.cx + sx * 1.85, 2.3, COMP.depth - 0.14);
    }
    return { pos, look: pivot.clone().setY(0.4) };
  }

  _updatePrompt() {
    const t = this.talk || this.holoOpen ? null : this._nearestTarget();
    this.focus = t;
    for (const c of Object.values(this.characters)) c._hl = t?.char === c;
    // 【v13】タッチ端末：右下のボタン（会話中は「次へ」、ホログラム表示中は「閉じる」）
    if (this.touchUI) this.touch.setAction(this.talk ? '次へ' : this.holoOpen ? '閉じる' : t ? this._promptLabel(t) : null);
    if (!t) {
      this.$prompt.classList.remove('is-on');
      return;
    }
    const v = t.head().project(this.camera);
    if (v.z > 1) {
      this.$prompt.classList.remove('is-on');
      return;
    }
    // 相手の頭が画面の外（立っている人に近づいたときなど）でも、表示は画面の端に寄せて出す
    v.x = THREE.MathUtils.clamp(v.x, -0.9, 0.9);
    v.y = THREE.MathUtils.clamp(v.y, -0.75, 0.82);
    const x = (v.x + 1) * 0.5 * innerWidth;
    const y = (1 - v.y) * 0.5 * innerHeight;
    const label = this._promptLabel(t);
    if (this.$prompt.textContent !== label) this.$prompt.textContent = label;
    this.$prompt.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
    this.$prompt.classList.add('is-on');
  }

  update(dt) {
    if (!this.active) return;
    for (const d of this.doors) {
      if (d.open !== d.target) {
        d.open = THREE.MathUtils.clamp(d.open + Math.sign(d.target - d.open) * dt * 1.6, 0, 1);
        this._applyDoor(d);
      }
    }
    this._movePlayer(dt);
    // ゾーン（HUD の部屋名・照明）
    const zone = this.zoneAt(this.player.pos.x, this.player.pos.z);
    if (zone !== this.zone) {
      this.zone = zone;
      if (this.$zone) this.$zone.textContent = zone.label;
      this._placeLamps(zone);
    } else if (zone.id === 'corridor') this._placeLamps(zone);
    if (!this._freeze) this._updateCamera(dt); // _freeze: QA 用（DHT.interior._freeze = true でカメラを手動に）
    // 【v13】見える区画だけを描く・動かす（閉じた扉の向こうの部屋・住人・反対舷の車窓は止める）
    this._updateVisibility();
    this.scenery.update(dt);
    if (this.off.has('cull')) this.scenery.showAll();
    else if (this.scenery.group.visible) this.scenery.cull(this.camera, this._portal);
    this.hologram.update(dt, this.camera, this.hologram.group.visible);
    const pp = this.player.pos;
    for (const c of Object.values(this.characters)) {
      if (!c.group.visible) continue; // 見えない部屋の住人はアニメーションも止める
      const talking = this.talk?.ch === c;
      c.update(dt, c._hl || talking);
      const toLeaf = Math.atan2(-(pp.x - c.def.seat.x), -(pp.z - c.def.seat.z));
      if (c.turnsBody) {
        let want = talking ? toLeaf : c.facing;
        // 【v14】ソファーの背・本棚へめり込まないよう、向きを変える角度に上限（Room 3 の 4 匹）
        if (talking && c.def.turnLimit != null) want = c.facing + THREE.MathUtils.clamp(wrapA(toLeaf - c.facing), -c.def.turnLimit, c.def.turnLimit);
        c.group.rotation.y += wrapA(want - c.group.rotation.y) * damp(5, dt);
      } else {
        // 人は首だけ：近くにいる・話しているときは葉っぱの方へ
        const near = Math.hypot(pp.x - c.def.seat.x, pp.z - c.def.seat.z) < 1.8;
        c.lookYaw(talking || near ? wrapA(toLeaf - c.facing) : 0, dt);
      }
    }
    this._updatePrompt();
    const st = this.stats;
    st.frames++;
    st.t += dt;
    if (st.t >= 0.5) {
      st.fps = Math.round(st.frames / st.t);
      st.frames = 0;
      st.t = 0;
      // ?stats=1 のとき右上に FPS・draw call・三角形数（実機の GPU での確認用）
      if (this.$stats) {
        const pr = this.renderer.getPixelRatio();
        this.$stats.textContent = `${st.fps} fps · ${st.draw} draws · ${(st.tris / 1000).toFixed(0)}k tris · x${pr.toFixed(2)}${this.off.size ? ` · off: ${[...this.off].join(',')}` : ''}`;
      }
      this._adaptResolution(st.fps);
    }
  }

  render() {
    this.renderer.render(this.scene, this.camera);
    const i = this.renderer.info.render;
    this.stats.draw = i.calls;
    this.stats.tris = i.triangles;
  }

  resize() {
    const aspect = innerWidth / innerHeight;
    this.camera.aspect = aspect;
    // 【v13】タッチ端末の縦持ち：そのままでは左右の視野が狭すぎるので、上下の視野を広げて補う（PC は変えない）
    let fov = CAM.fov;
    if (this.touchUI && aspect < 1.2) {
      const half = Math.atan((Math.tan(THREE.MathUtils.degToRad(CAM.fov / 2)) * 1.2) / aspect);
      fov = Math.min(78, THREE.MathUtils.radToDeg(half * 2));
    }
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  /**
   * 【v14】左上の現在地メニュー：Room 1 / Room 2 / Room 3 / Corridor / Dining & Lounge へ瞬時に移動（フェードなし）。
   *   扉の開閉はそのまま。見える区画・照明・部屋名は次のフレームの update で新しい場所に合わせて切り替わる。
   */
  jumpTo(zoneId) {
    const j = this.jumpPoints[zoneId];
    if (!j || !this._built) return false;
    this._closeTalk();
    this._closeHolo();
    this.overview = false;
    this.keys.clear();
    const heading = j.heading ?? Math.atan2(-(j.lookX - j.x), -(j.lookZ - j.z));
    this.teleport(j.x, j.z, heading);
    // 視線の上下（度）。指定が無ければ既定の見下ろし（ラウンジは大きなホログラムが入るよう水平に近く）
    this.viewPitch = j.pitch != null ? THREE.MathUtils.degToRad(j.pitch) : CAM.pitch;
    this.camDist = CAM.dist;
    // 部屋名・照明をすぐ切り替える（update を待たない）
    this.zone = null;
    this._visKey = null;
    if (this.active) this.update(0);
    return true;
  }

  /** 【v16】現在地メニューの項目（列車：View Room〜Dining & Lounge、船：View Room〜Aft Observation Deck） */
  _renderZoneMenu() {
    if (!this.$zoneMenu) return;
    this.$zoneMenu.innerHTML = this.menuZones.map((z) => `<li><button type="button" role="menuitem" data-zone="${z.id}">${z.label}</button></li>`).join('');
    this._toggleZoneMenu(false);
  }

  /** 【v14】左上の現在地メニューの開閉 */
  _toggleZoneMenu(open = !this._zoneMenuOpen) {
    if (!this.$zoneMenu) return;
    this._zoneMenuOpen = open;
    this.$zoneMenu.hidden = !open;
    this.$zoneBtn.setAttribute('aria-expanded', String(open));
    if (open) {
      const cur = this.zone?.id;
      for (const li of this.$zoneMenu.querySelectorAll('[data-zone]')) {
        const here = li.dataset.zone === cur;
        li.classList.toggle('is-here', here);
        li.setAttribute('aria-current', here ? 'location' : 'false');
      }
      (this.$zoneMenu.querySelector('.is-here') ?? this.$zoneMenu.querySelector('[data-zone]'))?.focus({ preventScroll: true });
    }
  }

  /** QA・確認用：葉っぱを任意の位置へ（x, z, heading） */
  teleport(x, z, heading = this.player.heading) {
    const p = this.player;
    p.pos.set(x, 0, z);
    p.speed = p.angVel = 0;
    p.heading = heading;
    p.group.rotation.y = heading;
    this.camYaw = heading;
    this.yawOffset = 0;
    this.armLen = null;
    this._camInit = true;
  }

  /** 完全に破棄する（通常は再乗車を速くするため残しておく） */
  dispose() {
    this.exit();
    this.scene.traverse((o) => {
      if (o.isMesh || o.isSprite || o.isPoints) {
        o.geometry?.dispose();
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        ms.forEach((m) => m?.dispose());
      }
    });
    Object.values(this.tex ?? {}).forEach((t) => t.dispose());
    this.scenery?.dispose();
    this.hologram?.tex.dispose();
    this.envMap?.dispose();
    this._built = false;
  }
}
