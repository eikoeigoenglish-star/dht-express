/**
 * interior/room1.js — 【v11】FOREST SCHOOL EXPRESS / Room 1（個室）
 * ---------------------------------------------------------------------------
 * MAP（日本全体）とは別の THREE.Scene。main.js からは boarding.js 経由で
 *   enter({ timeMode }) / exit() / update(dt) / render()
 * だけを呼ぶ。Room 1 表示中は MAP の地形・都市などは更新も描画もしない。
 *
 * 座標（メートル。MAP の km とは無関係）
 *   X … 列車の長手方向（列車は -X へ進む）    Room 1 は x = -2.1 … +2.1
 *   Z … 車体の幅方向                         z = 0 が車窓側の内壁、z = 3.0 が廊下側の壁
 *                                            廊下 z = 3.1 … 4.3（x = -8 … +8）、その外が反対側の車窓
 *   Y … 上（床 = 0、天井 = 2.6）。屋外：線路 y = -0.9（高架）、街の地面 y = -32
 *
 *   ┌──────────── 車窓（z = 0） ────────────┐
 *   │ ベンチ │   テーブル   │ ベンチ │
 *   │ (猿・リス)               (アヒル・柴犬) │
 *   │ 棚                          植物      │
 *   └──────────┬引き戸┬───────────────────┘ z = 3.0（天井まで届く壁）
 *        廊下（片側通路。Room 2 / Dining & Lounge へ続く想定）
 *
 * 構成
 *   _buildShell()     壁・床・天井・車窓・廊下（天井まで壁のある完全な個室。引き戸は初期状態で閉）
 *   _buildFurniture() ベンチ・テーブル・荷物棚・カーテン・照明・植物・本・小物
 *   _buildPlayer()    プレイヤー「葉っぱ」
 *   WindowScenery     車窓（scenery.js）
 *   ROOM1_CHARACTERS  4 匹（characters.js。仮置き → GLB 差し替え可）
 *   colliders         XZ の箱（プレイヤーの当たり判定・カメラの遮蔽判定）
 */
import * as THREE from 'three';
import { PartBin, roundedBox, roundedRectShape, box, cylinder, rodX, rodZ, trs, rng, Collider, pushOutCircle } from './kit.js';
import * as T from './textures.js';
import { WindowScenery } from './scenery.js';
import { ROOM1_CHARACTERS, Room1Character } from './characters.js';
import { resolveRoomLook } from './looks.js';

/* ---------------------------------------------------------------------- */
/* 寸法                                                                     */
/* ---------------------------------------------------------------------- */
export const ROOM = { x0: -2.1, x1: 2.1, z0: 0, z1: 3.0, h: 2.6 };
export const WALL = 0.12;
export const CORRIDOR = { x0: -8, x1: 8, z0: 3.1, z1: 4.3 };
export const WIN = { x0: -1.3, x1: 1.3, y0: 0.92, y1: 2.12 };
export const DOOR = { x0: 0.15, x1: 1.05, h: 2.05, slide: 0.98 };
const BENCH = { x0: 1.42, x1: 2.1, z1: 1.98, seatTop: 0.5 }; // 左右対称（左は x を反転）
const TABLE = { hx: 0.56, z1: 0.86, top: 0.76 };

/** 廊下の他の扉（将来の Room 2 / Dining & Lounge の入口。v11 は「準備中」表示だけ） */
export const CORRIDOR_DOORS = [
  { id: 'room2', label: 'Room 2', x: 4.9, note: 'Room 2 は準備中です。' },
  { id: 'lounge', label: 'Dining & Lounge', end: -1, note: 'Dining & Lounge は準備中です。' },
];

const PLAYER = { radius: 0.15, speed: 1.35, run: 2.3, accel: 10, head: 0.27 };
const CAM = { fov: 58, dist: 1.75, minDist: 1.1, maxDist: 2.8, pitch: THREE.MathUtils.degToRad(22), maxPitch: THREE.MathUtils.degToRad(68) };

const KEYS = {
  KeyW: 'f', ArrowUp: 'f',
  KeyS: 'b', ArrowDown: 'b',
  KeyA: 'l', ArrowLeft: 'l',
  KeyD: 'r', ArrowRight: 'r',
  ShiftLeft: 'run', ShiftRight: 'run',
};

const damp = (k, dt) => 1 - Math.exp(-k * dt);
const wrapA = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export class Room1 {
  /**
   * @param {{ renderer: THREE.WebGLRenderer, canvas: HTMLCanvasElement, hud: HTMLElement }} opts
   */
  constructor(opts) {
    this.renderer = opts.renderer;
    this.canvas = opts.canvas;
    this.hud = opts.hud;
    this.scene = new THREE.Scene();
    this.scene.name = 'room1';
    this.scene.background = new THREE.Color('#2a1e16');
    this.camera = new THREE.PerspectiveCamera(CAM.fov, innerWidth / innerHeight, 0.03, 20000);
    this.camera.rotation.order = 'YXZ';
    this.active = false;
    this.colliders = [];
    this.occluders = [];
    this.targets = []; // 話しかける・調べる対象
    this.characters = {};
    this.keys = new Set();
    this.talk = null;
    this.timeMode = 'day';
    this.lookKey = 'day';
    this.stats = { fps: 0, frames: 0, t: 0, draw: 0, tris: 0 };
    this.overview = false;
    this.door = { open: 0, target: 0 };
    this._built = false;
  }

  /* ==================================================================== */
  /* 構築（初回の enter 前に 1 回だけ）                                      */
  /* ==================================================================== */
  build() {
    if (this._built) return;
    const t0 = performance.now();
    this._makeMaterials();
    this._buildLights();
    this._buildShell();
    this._buildFurniture();
    this._buildDoors();
    this._buildPlayer();
    this.scenery = new WindowScenery({
      sides: [
        { facing: -1, z0: -WALL, xc: 0 }, // Room 1 の車窓
        { facing: 1, z0: CORRIDOR.z1 + WALL, xc: 0, lite: true }, // 廊下の窓（反対側）
      ],
    });
    this.scene.add(this.scenery.group);
    for (const [id, def] of Object.entries(ROOM1_CHARACTERS)) {
      const c = new Room1Character(id, def);
      this.characters[id] = c;
      this.scene.add(c.group);
      this.targets.push({ kind: 'char', id, char: c, anchor: c.anchor, radius: 0.95, label: 'E：話しかける', head: () => c.headWorld });
      if (def.model) c.loadModel(def.model);
    }
    this._makeEnvironment();
    this._bindDom();
    this._built = true;
    this.buildMs = Math.round(performance.now() - t0);
    console.info(`[room1] built in ${this.buildMs} ms`);
  }

  _makeMaterials() {
    const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0, vertexColors: true, ...o });
    const tx = this.tex = {
      wood: T.woodTexture('#8a5530', 3),
      woodDark: T.woodTexture('#6f3f22', 9),
      plank: T.plankTexture(),
      fabric: T.fabricTexture('#3f6b45'),
      carpet: T.carpetTexture(),
      runner: T.runnerTexture(),
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
    };
    this.mats = {
      wood: std({ map: tx.wood, roughness: 0.55 }),
      woodDark: std({ map: tx.woodDark, roughness: 0.45 }),
      floor: std({ map: tx.plank, roughness: 0.6 }),
      plaster: std({ map: tx.plaster, roughness: 0.95 }),
      wainscot: std({ map: tx.wainscot, roughness: 0.7 }),
      fabric: std({ map: tx.fabric, roughness: 0.95 }),
      button: std({ color: '#2c4a31', roughness: 0.7 }),
      brass: std({ color: '#c9a35a', metalness: 0.85, roughness: 0.32 }),
      curtain: std({ color: '#f1e6c9', roughness: 0.92, side: THREE.DoubleSide, emissive: new THREE.Color('#3a2f1c'), emissiveIntensity: 0.35 }),
      carpet: std({ map: tx.carpet, roughness: 1 }),
      runner: std({ map: tx.runner, roughness: 1 }),
      gingham: std({ map: tx.gingham, roughness: 0.9, side: THREE.DoubleSide }),
      glow: new THREE.MeshStandardMaterial({ color: '#fff4dc', emissive: new THREE.Color('#ffc985'), emissiveIntensity: 1.6, roughness: 0.3 }),
      leather: std({ color: '#ffffff', roughness: 0.55 }),
      wicker: std({ map: tx.wicker, roughness: 0.9 }),
      book: std({ map: tx.spine, roughness: 0.7 }),
      ceramic: std({ color: '#b9663d', roughness: 0.7 }),
      plant: std({ roughness: 0.75, side: THREE.DoubleSide }),
      glass: std({ color: '#d6ece6', roughness: 0.08, metalness: 0.1 }),
      frost: std({ map: tx.frost, roughness: 0.35, emissive: new THREE.Color('#dfe9dc'), emissiveIntensity: 0.25 }),
      paintL: std({ map: tx.paintL, roughness: 0.8 }),
      paintR: std({ map: tx.paintR, roughness: 0.8 }),
      cushion: std({ map: tx.cushion, roughness: 0.95 }),
    };
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
    panel('#cfe6f4', 3.2, 0, 2.2, -5.9, 6, 2.2, 0.1); // 車窓の明るさ
    panel('#ffd9a0', 4, -5.9, 2.5, 0, 0.1, 0.6, 3); // ランプ
    panel('#ffd9a0', 4, 5.9, 2.5, 0, 0.1, 0.6, 3);
    panel('#fff0d8', 1.6, 0, 4.9, 0, 4, 0.1, 4); // 天井
    panel('#3d5a3c', 1, 0, -0.9, 0, 12, 0.1, 12); // 床
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

  _buildLights() {
    this.hemi = new THREE.HemisphereLight(0xfff4e2, 0x6b5440, 1.05);
    this.sun = new THREE.DirectionalLight(0xfff1d8, 2.1);
    this.sun.target.position.set(0, 0.5, 1.5);
    this.scene.add(this.hemi, this.sun, this.sun.target);
    this.lamps = [];
    const lamp = (x, y, z, dist) => {
      const l = new THREE.PointLight(0xffc985, 2.4, dist, 2);
      l.position.set(x, y, z);
      this.scene.add(l);
      this.lamps.push(l);
    };
    lamp(-1.75, 1.95, 1.2, 6); // 左の壁ランプ
    lamp(1.75, 1.95, 1.2, 6); // 右の壁ランプ
    lamp(0, 2.3, 1.9, 6); // 天井灯
    lamp(0.6, 2.3, 3.7, 7); // 廊下
  }

  /* ==================================================================== */
  /* 壁・床・天井・窓・廊下                                                  */
  /* ==================================================================== */
  _buildShell() {
    const P = new PartBin();
    const B = (key, x0, x1, y0, y1, z0, z1, color) => P.add(key, box(x1 - x0, y1 - y0, z1 - z0), trs((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), color);
    const H = ROOM.h;
    const coll = (x0, x1, z0, z1, opts) => {
      const c = new Collider(x0, x1, z0, z1, 0, H, opts);
      this.colliders.push(c);
      return c;
    };

    // ---- 床・天井 ----
    B('floor', ROOM.x0, ROOM.x1, -0.06, 0, ROOM.z0, ROOM.z1);
    B('floor', CORRIDOR.x0, CORRIDOR.x1, -0.06, 0, CORRIDOR.z0, CORRIDOR.z1);
    B('brass', DOOR.x0, DOOR.x1, -0.03, 0.006, ROOM.z1 - 0.02, CORRIDOR.z0 + 0.02); // 敷居
    B('plaster', ROOM.x0 - WALL, ROOM.x1 + WALL, H, H + 0.1, -WALL, ROOM.z1 + 0.1);
    B('plaster', CORRIDOR.x0 - WALL, CORRIDOR.x1 + WALL, H, H + 0.1, ROOM.z1, CORRIDOR.z1 + WALL);
    // 天井の木の梁（室内・廊下）
    for (let z = 0.45; z < ROOM.z1; z += 0.7) B('wood', ROOM.x0, ROOM.x1, H - 0.05, H, z - 0.03, z + 0.03);
    for (let x = CORRIDOR.x0 + 0.8; x < CORRIDOR.x1; x += 1.6) B('wood', x - 0.03, x + 0.03, H - 0.05, H, CORRIDOR.z0, CORRIDOR.z1);
    // 絨毯
    const rug = new THREE.PlaneGeometry(2.7, 2.75);
    rug.rotateX(-Math.PI / 2);
    P.add('carpet', rug, trs(0, 0.004, 1.47));
    const run = new THREE.PlaneGeometry(CORRIDOR.x1 - CORRIDOR.x0 - 0.4, 0.66);
    run.rotateX(-Math.PI / 2);
    const ru = run.attributes.uv;
    for (let i = 0; i < ru.count; i++) ru.setX(i, ru.getX(i) * (CORRIDOR.x1 - CORRIDOR.x0 - 0.4));
    P.add('runner', run, trs(0, 0.004, (CORRIDOR.z0 + CORRIDOR.z1) / 2));

    // ---- 壁の仕上げ（腰壁・幅木・チェアレール・コーニス）を 1 面ずつ ----
    // face: 壁の室内側の面。axis 'x' は x = 一定の面（法線 ±X）、'z' は z = 一定の面
    const finish = (axis, at, sgn, a0, a1, { top = true } = {}) => {
      // sgn: 面の法線の向き（室内側へ +1 / -1）
      const t = (d0, d1) => (sgn > 0 ? [at + d0, at + d1] : [at - d1, at - d0]);
      const seg = (key, d0, d1, y0, y1) => {
        const [p0, p1] = t(d0, d1);
        if (axis === 'x') B(key, p0, p1, y0, y1, a0, a1);
        else B(key, a0, a1, y0, y1, p0, p1);
      };
      seg('wainscot', 0, 0.018, 0.1, 0.9);
      seg('woodDark', 0, 0.025, 0, 0.11); // 幅木
      seg('wood', 0, 0.035, 0.89, 0.94); // チェアレール
      seg('brass', 0.035, 0.045, 0.905, 0.925);
      if (top) {
        seg('wood', 0, 0.06, H - 0.12, H); // コーニス
        seg('wood', 0, 0.03, H - 0.16, H - 0.12);
      }
    };

    // 左右の仕切り壁（Room 1 の両側。天井まで）
    for (const s of [-1, 1]) {
      const xi = s * ROOM.x1; // 内面
      const xo = xi + s * WALL;
      B('plaster', Math.min(xi, xo), Math.max(xi, xo), 0, H, -WALL, ROOM.z1);
      finish('x', xi, -s, 0, ROOM.z1);
      // 付け柱
      for (const z of [0.03, BENCH.z1 + 0.03, ROOM.z1 - 0.03]) B('wood', Math.min(xi, xi - s * 0.03), Math.max(xi, xi - s * 0.03), 0.94, H - 0.12, z - 0.03, z + 0.03);
      coll(Math.min(xi, xo + s * 0.3), Math.max(xi, xo + s * 0.3), -0.4, ROOM.z1, { name: 'side-wall' });
    }

    // 車窓側の壁（大きな窓の穴）
    const zw0 = -WALL;
    const zw1 = 0;
    B('plaster', ROOM.x0, ROOM.x1, 0, WIN.y0, zw0, zw1);
    B('plaster', ROOM.x0, ROOM.x1, WIN.y1, H, zw0, zw1);
    B('plaster', ROOM.x0, WIN.x0, WIN.y0, WIN.y1, zw0, zw1);
    B('plaster', WIN.x1, ROOM.x1, WIN.y0, WIN.y1, zw0, zw1);
    finish('z', 0, 1, ROOM.x0, ROOM.x1);
    coll(ROOM.x0 - 0.3, ROOM.x1 + 0.3, -0.4, 0, { name: 'window-wall' });
    // 窓枠（角丸の木枠 + 真鍮の縁）と窓台
    const ring = (ow, oh, or, iw, ih, ir, depth) => {
      const s = roundedRectShape(ow, oh, or);
      s.holes.push(roundedRectShape(iw, ih, ir));
      const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 6 });
      return g;
    };
    const ww = WIN.x1 - WIN.x0;
    const wh = WIN.y1 - WIN.y0;
    const wy = (WIN.y0 + WIN.y1) / 2;
    P.add('wood', ring(ww + 0.3, wh + 0.3, 0.22, ww, wh, 0.14, 0.06), trs(0, wy, 0));
    P.add('brass', ring(ww + 0.04, wh + 0.04, 0.16, ww, wh, 0.14, 0.075), trs(0, wy, -0.01));
    P.add('wood', roundedBox(ww + 0.36, 0.05, 0.2, 0.015), trs(0, WIN.y0 - 0.02, 0.06));
    // 窓の外の車体（窓の下の外壁が少しだけ見える）
    B('plaster', WIN.x0 - 0.2, WIN.x1 + 0.2, WIN.y0 - 0.5, WIN.y0, zw0 - 0.02, zw0, 0xd9dcd6);

    // 廊下側の壁（天井まで。引き戸の開口部だけ空ける）
    const zc0 = ROOM.z1;
    const zc1 = CORRIDOR.z0;
    B('plaster', CORRIDOR.x0, DOOR.x0, 0, H, zc0, zc1);
    B('plaster', DOOR.x1, CORRIDOR.x1, 0, H, zc0, zc1);
    B('plaster', DOOR.x0, DOOR.x1, DOOR.h, H, zc0, zc1);
    finish('z', zc0, -1, ROOM.x0, DOOR.x0);
    finish('z', zc0, -1, DOOR.x1, ROOM.x1);
    finish('z', zc1, 1, CORRIDOR.x0, DOOR.x0);
    finish('z', zc1, 1, DOOR.x1, CORRIDOR.x1);
    // 開口部の枠（両面）
    for (const [z, s] of [[zc0, -1], [zc1, 1]]) {
      const z0 = s > 0 ? z : z - 0.035;
      const z1 = s > 0 ? z + 0.035 : z;
      B('wood', DOOR.x0 - 0.08, DOOR.x0, 0, DOOR.h + 0.08, z0, z1);
      B('wood', DOOR.x1, DOOR.x1 + 0.08, 0, DOOR.h + 0.08, z0, z1);
      B('wood', DOOR.x0 - 0.08, DOOR.x1 + 0.08, DOOR.h, DOOR.h + 0.08, z0, z1);
    }
    B('wood', DOOR.x0, DOOR.x0 + 0.02, 0, DOOR.h, zc0, zc1);
    B('wood', DOOR.x1 - 0.02, DOOR.x1, 0, DOOR.h, zc0, zc1);
    B('wood', DOOR.x0, DOOR.x1, DOOR.h - 0.02, DOOR.h, zc0, zc1);
    B('brass', DOOR.x0 - 0.05, DOOR.x1 + DOOR.slide + 0.1, DOOR.h + 0.1, DOOR.h + 0.13, zc1 + 0.035, zc1 + 0.065); // 引き戸のレール
    coll(CORRIDOR.x0 - 0.3, DOOR.x0, zc0 - 0.04, zc1, { name: 'corridor-wall-a', occlude: true });
    coll(DOOR.x1, CORRIDOR.x1 + 0.3, zc0 - 0.04, zc1, { name: 'corridor-wall-b', occlude: true });

    // ---- 廊下の外壁（反対側の車窓）----
    const zo0 = CORRIDOR.z1;
    const zo1 = CORRIDOR.z1 + WALL;
    const wins = [-6.6, -4.4, -2.2, 0, 2.2, 4.4, 6.6];
    const cw = 0.7;
    const cy0 = 0.95;
    const cy1 = 2.05;
    B('plaster', CORRIDOR.x0, CORRIDOR.x1, 0, cy0, zo0, zo1);
    B('plaster', CORRIDOR.x0, CORRIDOR.x1, cy1, H, zo0, zo1);
    let px = CORRIDOR.x0;
    for (const xc of wins) {
      B('plaster', px, xc - cw, cy0, cy1, zo0, zo1);
      px = xc + cw;
      P.add('wood', ring(cw * 2 + 0.2, cy1 - cy0 + 0.2, 0.14, cw * 2, cy1 - cy0, 0.09, 0.05), trs(xc, (cy0 + cy1) / 2, zo0 - 0.05));
    }
    B('plaster', px, CORRIDOR.x1, cy0, cy1, zo0, zo1);
    finish('z', zo0, -1, CORRIDOR.x0, CORRIDOR.x1);
    P.add('brass', rodX(CORRIDOR.x1 - CORRIDOR.x0 - 0.3, 0.022), trs(0, 0.99, zo0 - 0.085));
    for (let x = CORRIDOR.x0 + 0.5; x < CORRIDOR.x1; x += 1.25) P.add('brass', rodZ(0.07, 0.012), trs(x, 0.99, zo0 - 0.045));
    coll(CORRIDOR.x0 - 0.3, CORRIDOR.x1 + 0.3, zo0 - 0.1, zo1 + 0.3, { name: 'corridor-outer' });
    // 廊下の両端（貫通路の壁）
    for (const s of [-1, 1]) {
      const xi = s * CORRIDOR.x1;
      B('plaster', Math.min(xi, xi + s * WALL), Math.max(xi, xi + s * WALL), 0, H, zc0, zo1);
      finish('x', xi, -s, zc1, zo0);
      coll(Math.min(xi, xi + s * 0.4), Math.max(xi, xi + s * 0.4), zc0, zo1, { name: 'corridor-end' });
    }

    this.scene.add(P.build(this.mats, 'shell'));
  }

  /* ==================================================================== */
  /* 家具・小物・照明                                                        */
  /* ==================================================================== */
  _buildFurniture() {
    const P = new PartBin();
    const R = rng(2024);
    const RB = (key, w, h, d, r, x, y, z, rx = 0, ry = 0, rz = 0, color) => P.add(key, roundedBox(w, h, d, r), trs(x, y, z, rx, ry, rz), color);
    const coll = (x0, x1, z0, z1, y1, opts = {}) => {
      const c = new Collider(x0, x1, z0, z1, 0, y1, { occlude: true, ...opts });
      this.colliders.push(c);
      this.occluders.push(c);
      return c;
    };

    // ---- ベンチ（向かい合わせ。座面 0.5 m、背もたれは窓と垂直な壁際） ----
    for (const s of [-1, 1]) {
      const xin = s * BENCH.x0; // 通路側の端
      const xw = s * BENCH.x1; // 壁
      const cx = (xin + xw) / 2;
      const w = BENCH.x1 - BENCH.x0;
      const len = BENCH.z1;
      const zc = len / 2;
      RB('woodDark', w - 0.04, 0.36, len - 0.06, 0.02, cx, 0.18, zc); // 台座
      RB('fabric', w, 0.16, len - 0.1, 0.055, cx, 0.42, zc); // 座面
      // 背もたれ（3 つのクッション。上がわずかに壁側へ）
      const bx = xw - s * 0.09;
      for (let i = 0; i < 3; i++) {
        const z = 0.08 + (len - 0.16) * ((i + 0.5) / 3);
        RB('fabric', 0.17, 0.62, (len - 0.2) / 3 - 0.02, 0.065, bx, 0.84, z, 0, 0, -s * 0.07);
        for (const [dy, dz] of [[0.14, 0], [-0.1, -0.12], [-0.1, 0.12]]) P.add('button', new THREE.SphereGeometry(0.014, 8, 6), trs(bx - s * 0.085, 0.84 + dy, z + dz));
      }
      RB('wood', 0.2, 0.05, len, 0.02, xw - s * 0.1, 1.18, zc); // 背もたれの笠木
      // 両端の木の袖
      for (const z of [0.03, len - 0.03]) RB('wood', w + 0.02, z < 0.1 ? 0.62 : 0.66, 0.06, 0.02, cx, z < 0.1 ? 0.31 : 0.33, z);
      // 座面のボタン
      for (let i = 0; i < 6; i++) P.add('button', new THREE.SphereGeometry(0.012, 8, 6), trs(cx, 0.502, 0.2 + i * 0.3));
      // クッション（花柄）
      for (const z of [0.92, 1.8]) RB('cushion', 0.1, 0.34, 0.34, 0.05, xw - s * 0.24, 0.66, z, 0, s * 0.1, -s * 0.28);
      coll(Math.min(xin, xw), Math.max(xin, xw), 0, len, 1.2, { name: s < 0 ? 'bench-left' : 'bench-right' });
    }

    // ---- テーブル（窓際の中央） ----
    {
      const tz = TABLE.z1 / 2;
      RB('woodDark', TABLE.hx * 2, 0.05, TABLE.z1, 0.022, 0, TABLE.top - 0.025, tz);
      P.add('brass', rodX(TABLE.hx * 2 - 0.08, 0.008), trs(0, TABLE.top - 0.03, TABLE.z1 + 0.003));
      P.add('woodDark', cylinder(0.045, 0.06, TABLE.top - 0.06, 12), trs(0, (TABLE.top - 0.06) / 2, tz + 0.05));
      P.add('brass', cylinder(0.24, 0.27, 0.035, 20), trs(0, 0.018, tz + 0.05));
      RB('woodDark', 0.5, 0.08, 0.1, 0.02, 0, TABLE.top - 0.09, 0.05); // 壁の受け
      // テーブルクロス（ギンガム。菱形に）
      const cloth = new THREE.PlaneGeometry(0.56, 0.56);
      cloth.rotateX(-Math.PI / 2);
      const cu = cloth.attributes.uv;
      for (let i = 0; i < cu.count; i++) cu.setXY(i, cu.getX(i) * 0.56, cu.getY(i) * 0.56);
      P.add('gingham', cloth, trs(0, TABLE.top + 0.002, tz, 0, Math.PI / 4, 0));
      // 花瓶と花
      P.add('glass', cylinder(0.035, 0.05, 0.15, 14), trs(-0.06, TABLE.top + 0.075, 0.3));
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        const rr = 0.03 + R() * 0.03;
        const fx = -0.06 + Math.cos(a) * rr;
        const fz = 0.3 + Math.sin(a) * rr;
        const fy = TABLE.top + 0.2 + R() * 0.06;
        P.add('plant', cylinder(0.003, 0.003, 0.12, 4), trs(fx, fy - 0.06, fz, Math.sin(a) * 0.2, 0, -Math.cos(a) * 0.2), 0x5a8d3e);
        P.add('plant', new THREE.IcosahedronGeometry(0.022, 0), trs(fx, fy, fz, R(), R(), R(), [1, 0.6, 1]), 0xfdfbf2);
        P.add('plant', new THREE.SphereGeometry(0.008, 6, 4), trs(fx, fy + 0.01, fz), 0xf2c94c);
      }
      // ランタン（真鍮 + 光るガラス）
      const lx = 0.24;
      const lz = 0.28;
      P.add('brass', cylinder(0.05, 0.055, 0.02, 12), trs(lx, TABLE.top + 0.01, lz));
      for (const [dx, dz] of [[-0.04, -0.04], [0.04, -0.04], [-0.04, 0.04], [0.04, 0.04]]) P.add('brass', cylinder(0.005, 0.005, 0.14, 5), trs(lx + dx, TABLE.top + 0.09, lz + dz));
      P.add('glow', cylinder(0.032, 0.032, 0.11, 12), trs(lx, TABLE.top + 0.08, lz));
      P.add('brass', new THREE.ConeGeometry(0.06, 0.05, 4), trs(lx, TABLE.top + 0.185, lz, 0, Math.PI / 4, 0));
      P.add('brass', new THREE.TorusGeometry(0.018, 0.004, 6, 12), trs(lx, TABLE.top + 0.225, lz));
      // 本（緑の表紙 + 金の紋章）
      RB('fabric', 0.2, 0.035, 0.27, 0.008, -0.12, TABLE.top + 0.02, 0.62, 0, 0.35, 0, 0x2f5a37);
      P.add('brass', box(0.06, 0.004, 0.06), trs(-0.12, TABLE.top + 0.039, 0.62, 0, 0.35, 0));
      coll(-TABLE.hx - 0.02, TABLE.hx + 0.02, 0, TABLE.z1 + 0.02, TABLE.top + 0.25, { name: 'table' });
    }

    // ---- 荷物棚（窓の上。真鍮の棒 + 腕木） ----
    {
      const y = 2.3;
      for (const z of [0.07, 0.19, 0.31, 0.42]) P.add('brass', rodX(3.9, 0.012), trs(0, y, z));
      P.add('brass', rodX(3.9, 0.012), trs(0, y + 0.07, 0.44));
      for (const x of [-1.9, -0.65, 0.65, 1.9]) {
        P.add('brass', box(0.025, 0.025, 0.46), trs(x, y - 0.01, 0.23));
        P.add('brass', box(0.02, 0.32, 0.02), trs(x, y - 0.15, 0.2, 0.95, 0, 0));
        P.add('brass', box(0.02, 0.09, 0.02), trs(x, y + 0.035, 0.44));
      }
      // 旅行かばん・籐かご・小さな鉢
      const suitcase = (x, w, h, d, col) => {
        RB('leather', w, h, d, 0.03, x, y + 0.012 + h / 2, 0.22, 0, 0, 0, col);
        for (const dx of [-w / 2 + 0.07, w / 2 - 0.07]) P.add('woodDark', box(0.03, h + 0.006, d + 0.006), trs(x + dx, y + 0.012 + h / 2, 0.22), 0x4a2a17);
        P.add('brass', box(0.08, 0.02, 0.015), trs(x, y + 0.012 + h * 0.75, 0.22 + d / 2 + 0.006));
        P.add('brass', new THREE.TorusGeometry(0.045, 0.008, 6, 10, Math.PI), trs(x, y + 0.012 + h, 0.22));
      };
      suitcase(-1.35, 0.62, 0.22, 0.36, 0x7b4a2e);
      suitcase(-0.62, 0.5, 0.27, 0.32, 0x5e3a26);
      RB('wicker', 0.52, 0.22, 0.32, 0.03, 0.42, y + 0.122, 0.22);
      P.add('brass', new THREE.TorusGeometry(0.16, 0.008, 6, 14, Math.PI), trs(0.42, y + 0.23, 0.22, 0, Math.PI / 2, 0), 0xb9884a);
      suitcase(1.32, 0.56, 0.2, 0.34, 0x8a5634);
      this.occluders.push(new Collider(-2.1, 2.1, 0, 0.5, y - 0.05, 2.6, { block: false, occlude: true, name: 'rack' }));
    }

    // ---- カーテン（両脇でタッセル留め） + カーテンレール ----
    {
      const rodY = WIN.y1 + 0.08;
      P.add('brass', rodX(WIN.x1 - WIN.x0 + 0.7, 0.014), trs(0, rodY, 0.14));
      for (const s of [-1, 1]) P.add('brass', new THREE.SphereGeometry(0.028, 10, 8), trs(s * ((WIN.x1 - WIN.x0) / 2 + 0.36), rodY, 0.14));
      for (const s of [-1, 1]) {
        const cx = s * (WIN.x1 + 0.08);
        const g = this._curtainGeometry(0.46, rodY - (WIN.y0 + 0.02), s);
        P.add('curtain', g, trs(cx, WIN.y0 + 0.02, 0.12));
        RB('brass', 0.15, 0.03, 0.09, 0.012, cx - s * 0.02, WIN.y0 + 0.5, 0.14); // タッセル（真鍮の留め具）
      }
    }

    // ---- 壁のランプ（左右 2 つずつ）と天井灯 ----
    for (const s of [-1, 1]) {
      for (const z of [0.42, 2.48]) {
        const x = s * (ROOM.x1 - 0.01);
        P.add('brass', cylinder(0.05, 0.05, 0.02, 14), trs(x, 1.72, z, 0, 0, Math.PI / 2));
        P.add('brass', box(0.13, 0.018, 0.018), trs(x - s * 0.07, 1.72, z));
        P.add('brass', box(0.018, 0.08, 0.018), trs(x - s * 0.13, 1.76, z));
        P.add('brass', cylinder(0.035, 0.025, 0.03, 12), trs(x - s * 0.13, 1.8, z));
        P.add('glow', new THREE.SphereGeometry(0.055, 14, 10), trs(x - s * 0.13, 1.86, z, 0, 0, 0, [1, 1.15, 1]));
      }
    }
    P.add('brass', cylinder(0.16, 0.12, 0.04, 20), trs(0, ROOM.h - 0.02, 1.5));
    P.add('glow', new THREE.SphereGeometry(0.15, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), trs(0, ROOM.h - 0.04, 1.5, Math.PI, 0, 0, [1, 0.55, 1]));
    // 廊下の壁ランプ
    for (const x of [-6.0, -3.3, 2.6, 6.2]) {
      P.add('brass', box(0.12, 0.12, 0.02), trs(x, 1.85, CORRIDOR.z0 + 0.02));
      P.add('glow', new THREE.SphereGeometry(0.05, 12, 8), trs(x, 1.92, CORRIDOR.z0 + 0.1));
      P.add('brass', box(0.018, 0.08, 0.08), trs(x, 1.85, CORRIDOR.z0 + 0.06));
    }

    // ---- 額の絵（左右の壁、ベンチの上） ----
    for (const s of [-1, 1]) {
      const x = s * (ROOM.x1 - 0.015);
      const z = 1.22;
      const w = 0.66;
      const h = 0.48;
      const y = 1.62;
      const fr = 0.045;
      const pl = new THREE.PlaneGeometry(w, h);
      pl.rotateY(-s * Math.PI / 2);
      P.add(s < 0 ? 'paintL' : 'paintR', pl, trs(x - s * 0.012, y, z));
      for (const [dy, dz, ww, hh] of [[h / 2, 0, w + fr * 2, fr], [-h / 2, 0, w + fr * 2, fr], [0, w / 2, fr, h], [0, -w / 2, fr, h]]) {
        P.add('wood', box(0.03, hh, ww), trs(x - s * 0.015, y + dy + (dy > 0 ? fr / 2 : dy < 0 ? -fr / 2 : 0), z + dz + (dz > 0 ? fr / 2 : dz < 0 ? -fr / 2 : 0)));
      }
    }
    // 廊下にも小さな額（Room 1 の扉の左）
    {
      const pl = new THREE.PlaneGeometry(0.5, 0.36);
      P.add('paintR', pl, trs(-1.2, 1.6, CORRIDOR.z0 + 0.04));
      for (const [dy, dx, w, h] of [[0.2, 0, 0.6, 0.04], [-0.2, 0, 0.6, 0.04], [0, 0.27, 0.04, 0.4], [0, -0.27, 0.04, 0.4]]) P.add('wood', box(w, h, 0.03), trs(-1.2 + dx, 1.6 + dy, CORRIDOR.z0 + 0.03));
    }

    // ---- 左前：本棚（上に鉢植え） ----
    {
      const x0 = ROOM.x0;
      const x1 = ROOM.x0 + 0.42;
      const z0 = 2.1;
      const z1 = 2.76;
      const cx = (x0 + x1) / 2;
      const cz = (z0 + z1) / 2;
      const Hc = 0.9;
      P.add('wood', box(0.03, Hc, z1 - z0), trs(x0 + 0.015, Hc / 2, cz));
      for (const z of [z0 + 0.015, z1 - 0.015]) P.add('wood', box(x1 - x0, Hc, 0.03), trs(cx, Hc / 2, z));
      for (const y of [0.04, 0.46]) P.add('wood', box(x1 - x0 - 0.03, 0.03, z1 - z0 - 0.03), trs(cx + 0.015, y, cz));
      RB('woodDark', x1 - x0 + 0.04, 0.045, z1 - z0 + 0.04, 0.012, cx, Hc + 0.02, cz);
      const bookCols = [0x2f5a37, 0x7a2e2a, 0xd9cfae, 0x3b5d7a, 0x8a6a3a, 0x4f7a4a, 0xa64b2a];
      for (const y0 of [0.055, 0.475]) {
        let z = z0 + 0.04;
        while (z < z1 - 0.06) {
          const bw = 0.025 + R() * 0.025;
          const bh = 0.24 + R() * 0.12;
          const lean = R() < 0.12 ? 0.18 : 0;
          P.add('book', box(0.2, bh, bw), trs(x0 + 0.15, y0 + bh / 2, z + bw / 2, lean, 0, 0), bookCols[Math.floor(R() * bookCols.length)]);
          z += bw + 0.004;
        }
      }
      // 鉢植え
      const py = Hc + 0.045;
      P.add('ceramic', cylinder(0.11, 0.08, 0.16, 16), trs(cx + 0.02, py + 0.08, cz));
      P.add('woodDark', cylinder(0.1, 0.1, 0.01, 14), trs(cx + 0.02, py + 0.155, cz), 0x3a2a1c);
      this._foliage(P, R, cx + 0.02, py + 0.16, cz, 0.24, 26);
      coll(x0, x1 + 0.02, z0, z1, 1.3, { name: 'shelf' });
    }

    // ---- 右前：植物スタンド ----
    {
      const cx = ROOM.x1 - 0.2;
      const cz = 2.5;
      P.add('woodDark', cylinder(0.16, 0.16, 0.03, 18), trs(cx, 0.45, cz));
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + 0.4;
        P.add('woodDark', cylinder(0.014, 0.014, 0.45, 6), trs(cx + Math.cos(a) * 0.11, 0.225, cz + Math.sin(a) * 0.11));
      }
      P.add('ceramic', cylinder(0.12, 0.09, 0.2, 16), trs(cx, 0.565, cz), 0xe9e1cf);
      P.add('woodDark', cylinder(0.11, 0.11, 0.01, 14), trs(cx, 0.66, cz), 0x3a2a1c);
      this._foliage(P, R, cx, 0.665, cz, 0.42, 30);
      coll(cx - 0.2, ROOM.x1, cz - 0.2, cz + 0.2, 1.3, { name: 'plant-stand' });
    }

    // ---- 窓の光だまり（床。見た目だけ） ----
    this.sunPatch = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ map: this.tex.soft, color: '#fff2cf', transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.sunPatch.name = 'sun-patch';
    this.sunPatch.renderOrder = 2;
    this.scene.add(this.sunPatch);

    this.scene.add(P.build(this.mats, 'furniture'));
  }

  /** 鉢植えの葉（細長い葉を放射状に） */
  _foliage(P, R, x, y, z, size, n) {
    const cols = [0x4f8f45, 0x5f9e4c, 0x3f7a3d, 0x6aa553];
    for (let i = 0; i < n; i++) {
      const a = R() * Math.PI * 2;
      const tilt = 0.35 + R() * 0.9;
      const len = size * (0.55 + R() * 0.5);
      const g = new THREE.SphereGeometry(1, 8, 6);
      g.scale(len * 0.22, len * 0.5, 0.012 + len * 0.02);
      g.translate(0, len * 0.5, 0);
      P.add('plant', g, trs(x, y, z, Math.cos(a) * tilt, R() * 6, Math.sin(a) * tilt), cols[i % cols.length]);
    }
  }

  /** タッセルで絞ったカーテン（上が広く、タッセルで細く、裾で少し広がる） */
  _curtainGeometry(w, h, side) {
    const g = new THREE.PlaneGeometry(w, h, 14, 20);
    const p = g.attributes.position;
    const tie = 0.4; // 下から 4 割の高さで絞る
    for (let i = 0; i < p.count; i++) {
      const u = p.getX(i) / w + 0.5; // 0..1
      const v = p.getY(i) / h + 0.5; // 0（裾）..1（上）
      let f;
      if (v > tie) f = 0.32 + 0.68 * Math.pow((v - tie) / (1 - tie), 0.8);
      else f = 0.32 + 0.22 * Math.pow((tie - v) / tie, 1.2);
      // 窓側（内側）の端を固定して外へ寄せる
      const x = side * ((u - 0.5) * w * f + (1 - f) * w * 0.32);
      const fold = Math.sin(u * Math.PI * 7) * 0.022 * (0.4 + f);
      const z = fold + 0.03 * Math.sin(v * Math.PI) * (1 - f);
      p.setXYZ(i, x, v * h, z);
    }
    g.computeVertexNormals();
    return g;
  }

  /* ==================================================================== */
  /* 引き戸（Room 1 は開閉できる。他の扉は将来用で閉じたまま）                */
  /* ==================================================================== */
  _doorPanel(label) {
    const P = new PartBin();
    const w = DOOR.x1 - DOOR.x0 + 0.1;
    const h = DOOR.h + 0.03;
    P.add('woodDark', roundedBox(w, h, 0.05, 0.012), trs(0, h / 2, 0));
    // 曇りガラス（両面）・下の鏡板・取っ手
    for (const s of [-1, 1]) {
      const pl = new THREE.PlaneGeometry(0.5, 0.72);
      if (s < 0) pl.rotateY(Math.PI);
      P.add('frost', pl, trs(0.04, 1.42, s * 0.027));
      P.add('wood', roundedBox(0.58, 0.8, 0.012, 0.004), trs(0.04, 1.42, s * 0.024));
      P.add('wood', roundedBox(0.58, 0.62, 0.012, 0.004), trs(0.04, 0.5, s * 0.026));
      P.add('brass', roundedBox(0.04, 0.2, 0.02, 0.006), trs(-w / 2 + 0.08, 1.02, s * 0.035));
    }
    const g = P.build(this.mats, `door-${label}`);
    if (label) {
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.11), new THREE.MeshStandardMaterial({ map: T.plateTexture(label), roughness: 0.4, metalness: 0.2 }));
      plate.position.set(0.04, 1.9, 0.03);
      g.add(plate);
    }
    return g;
  }

  _buildDoors() {
    // Room 1 の引き戸（廊下側の面をスライド。閉じた状態から開始）
    const d = this._doorPanel('');
    d.name = 'room1-door';
    this.doorMesh = d;
    this.doorBaseX = (DOOR.x0 + DOOR.x1) / 2;
    d.position.set(this.doorBaseX, 0, CORRIDOR.z0 + 0.06);
    this.scene.add(d);
    this.doorCollider = new Collider(DOOR.x0 - 0.02, DOOR.x1 + 0.02, ROOM.z1 - 0.06, CORRIDOR.z0 + 0.1, 0, ROOM.h, { occlude: true, name: 'door' });
    this.colliders.push(this.doorCollider);
    this.occluders.push(this.doorCollider);
    // 廊下側の「Room 1」プレート
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.13), new THREE.MeshStandardMaterial({ map: T.plateTexture('Room 1'), roughness: 0.4, metalness: 0.2 }));
    plate.position.set(DOOR.x0 - 0.36, 1.55, CORRIDOR.z0 + 0.04);
    this.scene.add(plate);
    this.targets.push({
      kind: 'door',
      id: 'room1-door',
      anchor: new THREE.Vector3((DOOR.x0 + DOOR.x1) / 2, 0, ROOM.z1 + 0.05),
      radius: 0.85,
      get label() {
        return null; // _promptLabel() で開閉に応じて決める
      },
      head: () => new THREE.Vector3((DOOR.x0 + DOOR.x1) / 2, 1.3, ROOM.z1 + 0.05),
    });

    // 将来の扉（Room 2 / Dining & Lounge）
    for (const cd of CORRIDOR_DOORS) {
      const g = this._doorPanel(cd.label);
      let anchor;
      let head;
      if (cd.end) {
        const x = cd.end * CORRIDOR.x1 - cd.end * 0.04;
        g.position.set(x, 0, (CORRIDOR.z0 + CORRIDOR.z1) / 2);
        g.rotation.y = -cd.end * Math.PI / 2;
        anchor = new THREE.Vector3(x - cd.end * 0.5, 0, (CORRIDOR.z0 + CORRIDOR.z1) / 2);
        head = new THREE.Vector3(x - cd.end * 0.1, 1.3, (CORRIDOR.z0 + CORRIDOR.z1) / 2);
      } else {
        g.position.set(cd.x, 0, CORRIDOR.z0 + 0.04);
        anchor = new THREE.Vector3(cd.x, 0, CORRIDOR.z0 + 0.45);
        head = new THREE.Vector3(cd.x, 1.3, CORRIDOR.z0 + 0.1);
      }
      this.scene.add(g);
      this.targets.push({ kind: 'future', id: cd.id, note: cd.note, anchor, radius: 0.8, label: 'E：調べる', head: () => head });
    }
  }

  /* ==================================================================== */
  /* プレイヤー「葉っぱ」                                                    */
  /* ==================================================================== */
  _buildPlayer() {
    const g = new THREE.Group();
    g.name = 'player-leaf';
    // 葉の外形（根元 = 原点、先端が上）
    const s = new THREE.Shape();
    s.moveTo(0, 0);
    s.bezierCurveTo(0.13, 0.03, 0.15, 0.2, 0, 0.31);
    s.bezierCurveTo(-0.15, 0.2, -0.13, 0.03, 0, 0);
    const geo = new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.01, bevelSegments: 3, curveSegments: 16 });
    geo.translate(0, 0, -0.006);
    // 少し反らせる（横方向に湾曲 + 先端を前へ）、UV を外接矩形へ
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
    body.rotation.y = Math.PI; // 表（反らせた凹面）を前へ
    const bodyPivot = new THREE.Group();
    bodyPivot.add(body);
    g.add(bodyPivot);
    // 茎
    const brown = new THREE.MeshStandardMaterial({ color: '#7a5233', roughness: 0.7 });
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.01, 0.05, 6), new THREE.MeshStandardMaterial({ color: '#5f9a3a', roughness: 0.6 }));
    stem.position.y = 0.115;
    bodyPivot.add(stem);
    // 足（2 本）
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
    // 接地の影とリング
    const blob = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.4), new THREE.MeshBasicMaterial({ map: this.tex.blob, color: '#000000', transparent: true, opacity: 0.28, depthWrite: false }));
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.007;
    const ring = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.46), new THREE.MeshBasicMaterial({ map: this.tex.ring, color: '#c9f27a', transparent: true, opacity: 0.75, depthWrite: false, blending: THREE.AdditiveBlending }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.009;
    blob.renderOrder = ring.renderOrder = 3;
    g.add(blob, ring);
    this.player = { group: g, body: bodyPivot, legs, ring, pos: g.position, vel: new THREE.Vector3(), heading: 0, walk: 0, t: 0 };
    this.scene.add(g);
  }

  /* ==================================================================== */
  /* 入退室                                                                  */
  /* ==================================================================== */
  /**
   * @param {{ timeMode?: string }} [opts] timeMode は MAP の tod.mode（v11 は day 以外も day で表示）
   */
  enter(opts = {}) {
    this.build();
    this.active = true;
    this.setTimeMode(opts.timeMode ?? 'day');
    // 毎回、扉の前（室内側）から窓の方を向いて始める
    const p = this.player;
    p.pos.set(0.6, 0, 2.1);
    p.vel.set(0, 0, 0);
    p.heading = 0;
    p.group.rotation.y = 0;
    this.camYaw = 0.35;
    this.camPitch = CAM.pitch;
    this.camDist = CAM.dist;
    this.overview = false;
    this.door.open = this.door.target = 0; // 扉は閉じた状態から
    this._applyDoor();
    this._closeTalk();
    this.keys.clear();
    this._camInit = true;
    this._prevTone = { tm: this.renderer.toneMapping, ex: this.renderer.toneMappingExposure };
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = this.look.exposure;
    this.resize();
    this._listen(true);
    this.hud.hidden = false;
    this.update(0);
  }

  exit() {
    if (!this.active) return;
    this.active = false;
    this._listen(false);
    this._closeTalk();
    this.keys.clear();
    this.hud.hidden = true;
    this.$prompt.classList.remove('is-on');
    if (this._prevTone) {
      this.renderer.toneMapping = this._prevTone.tm;
      this.renderer.toneMappingExposure = this._prevTone.ex;
    }
  }

  /** 時間帯（MAP と同じ 4 モード名）。v11 は day のみ実装、それ以外は day で表示 */
  setTimeMode(mode) {
    const r = resolveRoomLook(mode);
    this.timeMode = r.requested;
    this.lookKey = r.key;
    this.look = r.look;
    if (r.fallback && this._warnedMode !== mode) {
      this._warnedMode = mode;
      console.info(`[room1] timeMode "${mode}" は Room 1 では未実装のため day で表示します（interior/looks.js）`);
    }
    const L = this.look;
    this.hemi.color.copy(L.hemiSky);
    this.hemi.groundColor.copy(L.hemiGround);
    this.hemi.intensity = L.hemi;
    this.sun.color.copy(L.sunColor);
    this.sun.intensity = L.sun;
    this.sun.position.copy(L.sunDir).multiplyScalar(20).add(this.sun.target.position);
    for (const l of this.lamps) {
      l.color.copy(L.lampColor);
      l.intensity = L.lamp;
    }
    this.mats.glow.emissive.copy(L.lampColor);
    this.mats.glow.emissiveIntensity = 1.6 * L.lampGlow;
    this.scene.fog = new THREE.Fog(L.haze, L.hazeNear, L.hazeFar);
    this.scenery.applyLook(L);
    this._layoutSunPatch(L);
    if (this.active) this.renderer.toneMappingExposure = L.exposure;
  }

  /** 窓から床に落ちる光だまり（太陽の向きから窓の 4 隅を床へ投影） */
  _layoutSunPatch(L) {
    const d = L.sunDir; // 光源の方向（光は -d へ進む）
    const k = (y) => [-d.x / d.y * y, -d.z / d.y * y];
    const pts = [
      [WIN.x0, WIN.y0], [WIN.x1, WIN.y0], [WIN.x1, WIN.y1], [WIN.x0, WIN.y1],
    ].map(([x, y]) => {
      const [dx, dz] = k(y);
      return new THREE.Vector3(x + dx, 0.006, Math.max(0, dz));
    });
    const g = new THREE.BufferGeometry();
    const pos = [pts[0], pts[1], pts[2], pts[0], pts[2], pts[3]].flatMap((v) => [v.x, v.y, v.z]);
    const uvs = [0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1];
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    this.sunPatch.geometry.dispose();
    this.sunPatch.geometry = g;
    this.sunPatch.material.opacity = L.sunPatch;
    this.sunPatch.visible = L.sunPatch > 0.01;
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
    this.$talk.addEventListener('click', () => this._advanceTalk());

    this._onKeyDown = (e) => {
      if (!this.active) return;
      if (e.target instanceof HTMLInputElement) return;
      const k = KEYS[e.code];
      if (k) {
        this.keys.add(k);
        e.preventDefault();
      }
      if (e.repeat) return;
      if (e.code === 'KeyE' || ((e.code === 'Enter' || e.code === 'Space') && this.talk)) {
        e.preventDefault();
        if (this.talk) this._advanceTalk();
        else this._interact();
      } else if (e.code === 'Escape') {
        if (this.talk) this._closeTalk();
      } else if (e.code === 'KeyV') {
        this.overview = !this.overview;
      }
    };
    this._onKeyUp = (e) => {
      const k = KEYS[e.code];
      if (k) this.keys.delete(k);
    };
    this._onBlur = () => this.keys.clear();
    this._onPointerDown = (e) => {
      if (e.button !== 0 && e.button !== 2) return;
      this._drag = { x: e.clientX, y: e.clientY, yaw: this.camYaw, pitch: this.camPitch };
      this.canvas.setPointerCapture?.(e.pointerId);
    };
    this._onPointerMove = (e) => {
      if (!this._drag) return;
      this.camYaw = this._drag.yaw - (e.clientX - this._drag.x) * 0.006;
      this.camPitch = THREE.MathUtils.clamp(this._drag.pitch + (e.clientY - this._drag.y) * 0.004, THREE.MathUtils.degToRad(8), THREE.MathUtils.degToRad(60));
    };
    this._onPointerUp = () => (this._drag = null);
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
    this.canvas[f]('wheel', this._onWheel, { passive: false });
    this.canvas[f]('contextmenu', this._onContext);
    if (!on) this._drag = null;
  }

  /* ==================================================================== */
  /* 話しかける・調べる                                                      */
  /* ==================================================================== */
  _nearestTarget() {
    const p = this.player.pos;
    let best = null;
    let bd = Infinity;
    for (const t of this.targets) {
      const d = Math.hypot(t.anchor.x - p.x, t.anchor.z - p.z);
      if (d < t.radius && d < bd) {
        best = t;
        bd = d;
      }
    }
    return best;
  }

  _promptLabel(t) {
    if (t.kind === 'door') return this.door.target > 0.5 ? 'E：ドアを閉める' : 'E：ドアを開ける';
    return t.label;
  }

  _interact() {
    const t = this._nearestTarget();
    if (!t) return;
    if (t.kind === 'char') this._openTalk(t.char);
    else if (t.kind === 'door') {
      this.door.target = this.door.target > 0.5 ? 0 : 1;
    } else if (t.kind === 'future') this._toast(t.note);
  }

  _openTalk(ch) {
    this.talk = { ch, i: 0 };
    // 向き合う
    const p = this.player;
    p.heading = Math.atan2(-(ch.def.seat.x - p.pos.x), -(ch.def.seat.z - p.pos.z));
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

  _toast(msg) {
    this.$toast.textContent = msg;
    this.$toast.classList.add('is-on');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => this.$toast.classList.remove('is-on'), 2200);
  }

  /** 外部から：キャラクターの GLB を差し替える（例：DHT.room1.setCharacterModel('dog', 'models/characters/shiba.glb')） */
  setCharacterModel(id, url) {
    this.build();
    const c = this.characters[id];
    if (!c) throw new Error(`unknown character: ${id}`);
    return c.loadModel(url);
  }

  /* ==================================================================== */
  /* 毎フレーム                                                              */
  /* ==================================================================== */
  _applyDoor() {
    const e = this.door.open * this.door.open * (3 - 2 * this.door.open);
    this.doorMesh.position.x = this.doorBaseX + e * DOOR.slide;
    // 半分以上開いたら通れる
    this.doorCollider.enabled = this.door.open < 0.6;
  }

  _movePlayer(dt) {
    const p = this.player;
    const K = this.keys;
    let ix = 0;
    let iz = 0;
    if (!this.talk) {
      if (K.has('f')) iz -= 1;
      if (K.has('b')) iz += 1;
      if (K.has('l')) ix -= 1;
      if (K.has('r')) ix += 1;
    }
    // カメラの向き基準（W = 画面の奥）
    const yaw = this.overview ? this._ovYaw ?? 0 : this.camYaw;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    let dx = fx * -iz + rx * ix;
    let dz = fz * -iz + rz * ix;
    const len = Math.hypot(dx, dz);
    const speed = K.has('run') ? PLAYER.run : PLAYER.speed;
    if (len > 1e-6) {
      dx = (dx / len) * speed;
      dz = (dz / len) * speed;
    }
    const a = damp(PLAYER.accel, dt);
    p.vel.x += (dx - p.vel.x) * a;
    p.vel.z += (dz - p.vel.z) * a;
    // 当たり判定（家具・壁・閉じた扉）。低 FPS でも薄い壁をすり抜けないよう 4 cm ごとに分割して進める
    const step = Math.hypot(p.vel.x, p.vel.z) * dt;
    const n = Math.max(1, Math.ceil(step / 0.04));
    for (let k = 0; k < n; k++) {
      p.pos.x += (p.vel.x * dt) / n;
      p.pos.z += (p.vel.z * dt) / n;
      for (let it = 0; it < 3; it++) {
        let hit = false;
        for (const c of this.colliders) if (c.enabled && c.block && pushOutCircle(p.pos, PLAYER.radius, c)) hit = true;
        if (!hit) break;
      }
    }
    // 万一の抜け防止：室内 + 廊下 + 開口部の外には出さない
    p.pos.x = THREE.MathUtils.clamp(p.pos.x, CORRIDOR.x0 + PLAYER.radius, CORRIDOR.x1 - PLAYER.radius);
    p.pos.z = THREE.MathUtils.clamp(p.pos.z, ROOM.z0 + PLAYER.radius, CORRIDOR.z1 - PLAYER.radius);
    if (p.pos.z < ROOM.z1 - 0.05) p.pos.x = THREE.MathUtils.clamp(p.pos.x, ROOM.x0 + PLAYER.radius, ROOM.x1 - PLAYER.radius);

    // 向き・歩きのアニメーション
    const sp = Math.hypot(p.vel.x, p.vel.z);
    if (sp > 0.05) p.heading = Math.atan2(-p.vel.x, -p.vel.z);
    p.group.rotation.y += wrapA(p.heading - p.group.rotation.y) * damp(12, dt);
    p.t += dt;
    const w = Math.min(1, sp / PLAYER.speed);
    p.walk += dt * (6 + sp * 5.5);
    const sw = Math.sin(p.walk) * 0.65 * w;
    p.legs[0].rotation.x = sw;
    p.legs[1].rotation.x = -sw;
    p.body.position.y = Math.abs(Math.sin(p.walk)) * 0.018 * w + Math.sin(p.t * 2.2) * 0.004 * (1 - w);
    p.body.rotation.x = -0.12 * w;
    p.body.rotation.z = Math.sin(p.walk) * 0.06 * w + Math.sin(p.t * 1.6) * 0.03 * (1 - w);
    p.ring.material.opacity = 0.55 + Math.sin(p.t * 3) * 0.15;
  }

  /** 線分 a→b が箱 box の中に収まる最大の割合 t（a は箱の中） */
  _clipT(a, b, bx) {
    let t = 1;
    for (const ax of ['x', 'y', 'z']) {
      const d = b[ax] - a[ax];
      if (b[ax] > bx.max[ax] && d > 1e-6) t = Math.min(t, (bx.max[ax] - a[ax]) / d);
      if (b[ax] < bx.min[ax] && d < -1e-6) t = Math.min(t, (bx.min[ax] - a[ax]) / d);
    }
    return Math.max(0, t);
  }

  _occluded(from, to) {
    const dir = this._v1.subVectors(to, from);
    const L = dir.length();
    if (L < 1e-4) return false;
    this._ray.set(from, dir.multiplyScalar(1 / L));
    for (const c of this.occluders) {
      if (!c.enabled) continue;
      const hit = this._ray.intersectBox(c.box, this._v2);
      if (hit && hit.distanceTo(from) < L - 0.06) return true;
    }
    return false;
  }

  _updateCamera(dt) {
    this._v1 ??= new THREE.Vector3();
    this._v2 ??= new THREE.Vector3();
    this._ray ??= new THREE.Ray();
    const p = this.player.pos;
    const head = new THREE.Vector3(p.x, PLAYER.head, p.z);
    const inRoom = p.z < ROOM.z1 + 0.02;
    const box = inRoom
      ? new THREE.Box3(new THREE.Vector3(ROOM.x0 + 0.14, 0.12, ROOM.z0 + 0.14), new THREE.Vector3(ROOM.x1 - 0.14, ROOM.h - 0.2, ROOM.z1 - 0.1))
      : new THREE.Box3(new THREE.Vector3(CORRIDOR.x0 + 0.14, 0.12, CORRIDOR.z0 + 0.1), new THREE.Vector3(CORRIDOR.x1 - 0.14, ROOM.h - 0.18, CORRIDOR.z1 - 0.14));
    const a = head.clone().clamp(box.min, box.max);
    let pos;
    let look;
    if (this.overview && inRoom) {
      // 見渡し：廊下側の上の角から部屋全体
      const sx = p.x > 0 ? -1 : 1;
      pos = new THREE.Vector3(sx * 1.85, 2.3, 2.86);
      look = new THREE.Vector3(p.x * 0.5, 0.45, Math.min(p.z, 1.6) * 0.6);
      this._ovYaw = Math.atan2(pos.x - look.x, pos.z - look.z);
    } else {
      // 後方・上方から追う。後ろの壁で水平距離が足りないときは「近づく」代わりに「上がる」
      //（狭い個室でも葉っぱの大きさが変わりにくく、窓の外も見える）
      const yaw = this.camYaw;
      const D = this.camDist;
      const hx = Math.sin(yaw);
      const hz = Math.cos(yaw);
      const avail = this._clipT(a, new THREE.Vector3(a.x + hx * D, a.y, a.z + hz * D), box) * D; // 後ろへ取れる水平距離
      const yMax = Math.min(box.max.y, 1.62) - a.y; // 高すぎると窓の外（空）が見えないので 1.6 m 程度まで
      let hd = Math.min(D * Math.cos(this.camPitch), avail);
      let vd = Math.min(Math.sqrt(Math.max(0, D * D - hd * hd)), yMax);
      vd = Math.max(vd, D * Math.sin(this.camPitch) * 0.6);
      let c = new THREE.Vector3(a.x + hx * hd, a.y + vd, a.z + hz * hd);
      // 家具で隠れるなら、さらに上げる → それでも隠れるなら近づく
      for (let i = 0; i < 6 && this._occluded(head, c); i++) {
        if (c.y < box.max.y - 0.02) c.y = Math.min(box.max.y, c.y + 0.25);
        else {
          hd *= 0.75;
          c.set(a.x + hx * hd, c.y, a.z + hz * hd);
        }
      }
      pos = c;
      const steep = THREE.MathUtils.clamp((Math.atan2(c.y - a.y, Math.max(0.05, hd)) - this.camPitch) / 0.9, 0, 1);
      const fwd = new THREE.Vector3(-hx, 0, -hz);
      look = head.clone().addScaledVector(fwd, 0.45 + 0.45 * steep);
      look.y += 0.1 + 0.12 * steep;
    }
    if (this._camInit) {
      this.camPos = pos.clone();
      this.camLook = look.clone();
      this._camInit = false;
    } else {
      this.camPos.lerp(pos, damp(this.overview ? 4 : 9, dt));
      this.camLook.lerp(look, damp(10, dt));
    }
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
  }

  _updatePrompt() {
    const t = this.talk ? null : this._nearestTarget();
    this.focus = t;
    for (const c of Object.values(this.characters)) c._hl = t?.char === c;
    if (!t) {
      this.$prompt.classList.remove('is-on');
      return;
    }
    const v = t.head().project(this.camera);
    if (v.z > 1) {
      this.$prompt.classList.remove('is-on');
      return;
    }
    const x = (v.x + 1) * 0.5 * innerWidth;
    const y = (1 - v.y) * 0.5 * innerHeight;
    const label = this._promptLabel(t);
    if (this.$prompt.textContent !== label) this.$prompt.textContent = label;
    this.$prompt.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
    this.$prompt.classList.add('is-on');
  }

  update(dt) {
    if (!this.active) return;
    // 扉
    if (this.door.open !== this.door.target) {
      const s = Math.sign(this.door.target - this.door.open);
      this.door.open = THREE.MathUtils.clamp(this.door.open + s * dt * 1.6, 0, 1);
      this._applyDoor();
    }
    this._movePlayer(dt);
    if (!this._freeze) this._updateCamera(dt); // _freeze: QA 用（DHT.room1._freeze = true でカメラを手動に）
    this.scenery.update(dt);
    for (const c of Object.values(this.characters)) {
      c.update(dt, c._hl || this.talk?.ch === c);
      // 話している間は葉っぱの方を向く
      const want = this.talk?.ch === c ? Math.atan2(-(this.player.pos.x - c.def.seat.x), -(this.player.pos.z - c.def.seat.z)) : c.def.facing;
      c.group.rotation.y += wrapA(want - c.group.rotation.y) * damp(5, dt);
    }
    this._updatePrompt();
    // FPS（QA 用：DHT.room1.stats）
    const st = this.stats;
    st.frames++;
    st.t += dt;
    if (st.t >= 0.5) {
      st.fps = Math.round(st.frames / st.t);
      st.frames = 0;
      st.t = 0;
    }
  }

  render() {
    this.renderer.render(this.scene, this.camera);
    const i = this.renderer.info.render;
    this.stats.draw = i.calls;
    this.stats.tris = i.triangles;
  }

  resize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }

  /** 完全に破棄する（通常は再入室を速くするため残しておく） */
  dispose() {
    this.exit();
    this.scene.traverse((o) => {
      if (o.isMesh || o.isSprite) {
        o.geometry?.dispose();
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        ms.forEach((m) => m?.dispose());
      }
    });
    Object.values(this.tex ?? {}).forEach((t) => t.dispose());
    this.scenery?.dispose();
    this.envMap?.dispose();
    this._built = false;
  }
}
