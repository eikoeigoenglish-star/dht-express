/**
 * interior/ship.js — 【v16】FOREST SCHOOL の船の船内（ShipInterior）
 * ---------------------------------------------------------------------------
 * 列車の車内（train.js の TrainInterior）を継承し、操作・カメラ・当たり判定・会話・ホログラム・
 * 時間帯・タッチ操作・現在地メニュー・自動解像度はすべてそのまま使う（船だけの別操作は作らない）。
 * 差し替えるのは「何を作るか（_buildWorld）」「どの区画が見えるか（_updateVisibility）」「電灯の位置（_placeLamps）」
 * 「景色（_buildScenery：海の景観テーマ + 航跡）」だけ。
 *
 * 区画（= zone）：viewroom / vrbalc / room1〜4 / room1b〜room4b / corridor / lounge / aft（+ 常に描く shell）
 * 見える区画のたどり方（_updateVisibility）
 *   viewroom ⇔ vrbalc（ガラス戸）・viewroom ⇔ corridor（扉の無いアーチ）
 *   roomN ⇔ roomNb（ガラス）・roomN ⇔ corridor（引き戸が開いているときだけ）
 *   lounge ⇔ aft（ガラス戸）・lounge ⇔ corridor（引き戸が開いているときだけ）
 *   → Room 1 にいて扉が閉まっていれば、Room 4 の仔馬・アヒル・赤ちゃん虎は描画もアニメーションの更新もしない
 */
import * as THREE from 'three';
import { TrainInterior } from './train.js';
import { Builder } from './builder.js';
import { Collider } from './kit.js';
import { WindowScenery } from './scenery.js';
import { ShipWake } from './wake.js';
import { buildShipShell, buildShipViewRoom, buildCabin, buildShipCorridor, buildShipLounge, buildAftDeck, SHIP_LOUNGE_DOOR, SHIP_AFT_DOOR } from './shipbuild.js';
import { SHIP_CHARACTERS } from './shipcharacters.js';
import { SH, SW, BEAM, CABINS, CAB, SCORR, SVIEW, SLOUNGE, SAFT, HULL, WATER_Y, SHIP_ZONES, SHIP_MENU, SHIP_SPAWN, SHIP_JUMP, SHIP_HOLO, shipZoneAt } from './shiplayout.js';

/**
 * 船の旅の始まり（鹿児島新港 = 累積 1325.9 km）。これより手前の km（列車の区間）では港を出たところの景色にする。
 * 1326 km ちょうどは「鹿児島（都心）→ 鹿児島湾」のクロスフェード（±1 km）の途中で街が混ざるため、境界の外の 1328 km から。
 */
export const SHIP_START_KM = 1328;
const ZC = BEAM / 2;

export class ShipInterior extends TrainInterior {
  constructor(opts) {
    super(opts);
    this.kind = 'ship';
    this.scene.name = 'forest-school-ship';
    this.zoneAt = shipZoneAt;
    this.zones = SHIP_ZONES;
    this.menuZones = SHIP_MENU;
    this.spawn = SHIP_SPAWN;
    this.jumpPoints = SHIP_JUMP;
    this.holoPos = new THREE.Vector3(SHIP_HOLO.x, 0, SHIP_HOLO.z);
    this.characterTable = SHIP_CHARACTERS;
  }

  /* ==================================================================== */
  /* 構築                                                                  */
  /* ==================================================================== */
  _buildWorld() {
    const b = new Builder(this.mats);
    buildShipShell(b);
    this.view = buildShipViewRoom(b);
    this.cabins = CABINS.map((c) => ({ def: c, ...buildCabin(b, c) }));
    this.corr = buildShipCorridor(b);
    this.loungeS = buildShipLounge(b);
    this.aftDeck = buildAftDeck(b);
    this.scene.add(b.build('ship'));
    this.sections = b.sections;
    this.colliders.push(...b.colliders);
    // 札（プレート）は区画の Group にぶら下げる（区画と一緒に出し入れ）
    const plates = [...this.cabins.flatMap((c) => c.plates), ...this.corr.plates, ...this.loungeS.plates, ...this.aftDeck.plates];
    for (const { section, mesh } of plates) (this.sections[section] ?? this.scene).add(mesh);
    // 調べられるもの（シャワー室・トイレ・階段）
    for (const t of [...this.cabins.flatMap((c) => c.targets), this.corr.target]) {
      const head = t.head;
      this.targets.push({ ...t, head: () => head });
    }
    this._buildShipDoors(b);
    this.sunWindows = [...this.view.windows, ...this.cabins.filter((c) => c.def.side < 0).map((c) => c.window), ...this.loungeS.windows];
    // ゾーンごとの電灯の位置（PointLight 6 つを移す先）
    const V = this.view.lights;
    const LL = this.loungeS.lights;
    const AL = this.aftDeck.lights;
    this.zoneLights = { viewroom: V, vrbalc: V, lounge: [...LL, new THREE.Vector3(16.2, 2.4, ZC)], aft: [...AL, LL[0]] };
    for (const c of this.cabins) this.zoneLights[c.def.id] = this.zoneLights[`${c.def.id}b`] = c.lights;
    this.sun.target.position.set(4, 0, ZC);
  }

  /** 扉：船室の廊下側（引き戸）・バルコニーのガラス戸・View Room のガラス戸・ラウンジの入口・Aft Observation Deck のガラス戸 */
  _buildShipDoors(b) {
    const mk = (id, mesh, axis, sign, slide, collider, anchor, head, adj) => {
      const base = mesh.position[axis];
      const d = { id, label: id, mesh, axis, sign, slide, base, collider, open: 0, target: 0, adj };
      this.doors.push(d);
      this.colliders.push(collider);
      this.scene.add(mesh);
      this.targets.push({ kind: 'door', id, door: d, anchor, radius: 0.85, head: () => head });
      return d;
    };
    const glassPanel = (w, h) => {
      const g = new THREE.Group();
      const fr = this.mats.woodDark;
      const add = (geo, m, x, y, z) => {
        const o = new THREE.Mesh(geo, m);
        o.position.set(x, y, z);
        g.add(o);
      };
      add(new THREE.BoxGeometry(w, 0.08, 0.05), fr, 0, 0.04, 0);
      add(new THREE.BoxGeometry(w, 0.08, 0.05), fr, 0, h - 0.04, 0);
      add(new THREE.BoxGeometry(0.07, h, 0.05), fr, -w / 2 + 0.035, h / 2, 0);
      add(new THREE.BoxGeometry(0.07, h, 0.05), fr, w / 2 - 0.035, h / 2, 0);
      add(new THREE.BoxGeometry(w - 0.1, 0.05, 0.04), fr, 0, 1.0, 0);
      add(new THREE.PlaneGeometry(w - 0.12, h - 0.14), this.mats.glassPane, 0, h / 2, 0);
      add(new THREE.BoxGeometry(0.03, 0.3, 0.07), this.mats.brass, -w / 2 + 0.12, 1.05, 0);
      g.traverse((o) => (o.matrixAutoUpdate = true));
      return g;
    };
    for (const c of this.cabins) {
      const side = c.def.side;
      for (const dd of c.doors) {
        const w = dd.a1 - dd.a0 + 0.1;
        const mx = (dd.a0 + dd.a1) / 2;
        if (dd.kind === 'corridor') {
          // 廊下側の引き戸：廊下側の面を船尾（+X）へスライド
          const m = b.doorPanel(w, CAB.door.h + 0.03, '');
          const zf = side < 0 ? SCORR.z0 + 0.06 : SCORR.z1 - 0.06;
          m.position.set(mx, 0, zf);
          if (side > 0) m.rotation.y = Math.PI;
          const [z0, z1] = side < 0 ? [CABIN_DEPTH - 0.06, SCORR.z0 + 0.1] : [SCORR.z1 - 0.1, BEAM - CABIN_DEPTH + 0.06];
          const col = new Collider(dd.a0 - 0.02, dd.a1 + 0.02, z0, z1, 0, SH, { name: dd.id });
          col.wall = true;
          const az = side < 0 ? CABIN_DEPTH + 0.05 : BEAM - CABIN_DEPTH - 0.05;
          mk(dd.id, m, 'x', 1, CAB.door.slide, col, new THREE.Vector3(mx, 0, az), new THREE.Vector3(mx, 1.3, az), [c.def.id, 'corridor']);
        } else {
          // バルコニーのガラス戸：室内側の面を船首（-X、ガラスの前）へスライド
          const m = glassPanel(w, CAB.balcDoor.h + 0.02);
          const zf = side < 0 ? 0.04 : BEAM - 0.04;
          m.position.set(mx, 0, zf);
          const [z0, z1] = side < 0 ? [-SW - 0.06, 0.08] : [BEAM - 0.08, BEAM + SW + 0.06];
          const col = new Collider(dd.a0 - 0.02, dd.a1 + 0.02, z0, z1, 0, SH, { name: dd.id });
          col.wall = true;
          const az = side < 0 ? -0.02 : BEAM + 0.02;
          mk(dd.id, m, 'x', -1, CAB.balcDoor.slide, col, new THREE.Vector3(mx, 0, az), new THREE.Vector3(mx, 1.5, az), [c.def.id, `${c.def.id}b`]);
        }
      }
    }
    // View Room の両舷のガラス戸
    for (const dd of this.view.doors) {
      const w = dd.x1 - dd.x0 + 0.1;
      const mx = (dd.x0 + dd.x1) / 2;
      const m = glassPanel(w, dd.h + 0.02);
      m.position.set(mx, 0, dd.zi - dd.out * 0.04);
      const [z0, z1] = dd.out < 0 ? [-SW - 0.06, 0.08] : [BEAM - 0.08, BEAM + SW + 0.06];
      const col = new Collider(dd.x0 - 0.02, dd.x1 + 0.02, z0, z1, 0, SH, { name: dd.id });
      col.wall = true;
      const az = dd.zi + dd.out * 0.02;
      mk(dd.id, m, 'x', 1, 0.8, col, new THREE.Vector3(mx, 0, az), new THREE.Vector3(mx, 1.5, az), ['viewroom', 'vrbalc']);
    }
    // Dining & Lounge の入口（前の壁。ラウンジ側の面を -Z へスライド）
    {
      const D = SHIP_LOUNGE_DOOR;
      const w = D.z1 - D.z0 + 0.1;
      const m = b.doorPanel(w, D.h + 0.03, '');
      const mz = (D.z0 + D.z1) / 2;
      m.rotation.y = Math.PI / 2;
      m.position.set(SLOUNGE.x0 + 0.065, 0, mz);
      const col = new Collider(SLOUNGE.x0 - SW - 0.06, SLOUNGE.x0 + 0.1, D.z0 - 0.02, D.z1 + 0.02, 0, 3, { name: 'lounge:door' });
      col.wall = true;
      mk('lounge-door', m, 'z', -1, D.slide, col, new THREE.Vector3(SLOUNGE.x0 - 0.06, 0, mz), new THREE.Vector3(SLOUNGE.x0 - 0.06, 1.3, mz), ['corridor', 'lounge']);
    }
    // Aft Observation Deck へのガラス戸（後ろの壁。ラウンジ側の面を +Z へスライド）
    {
      const D = SHIP_AFT_DOOR;
      const w = D.z1 - D.z0 + 0.1;
      const m = glassPanel(w, D.h + 0.02);
      const mz = (D.z0 + D.z1) / 2;
      m.rotation.y = Math.PI / 2;
      m.position.set(SLOUNGE.x1 - 0.04, 0, mz);
      const col = new Collider(SLOUNGE.x1 - 0.08, SLOUNGE.x1 + SW + 0.06, D.z0 - 0.02, D.z1 + 0.02, 0, 3, { name: 'aft:door' });
      col.wall = true;
      mk('aft-door', m, 'z', 1, D.slide, col, new THREE.Vector3(SLOUNGE.x1 + 0.06, 0, mz), new THREE.Vector3(SLOUNGE.x1 + 0.06, 1.5, mz), ['lounge', 'aft']);
    }
  }

  /** 海の景色（既存の景観テーマ：海・島影・浅瀬）と航跡。高架・街の層は作らない */
  _buildScenery() {
    this.scenery = new WindowScenery({
      viaduct: false,
      base: false,
      speedScale: 0.4, // 24 m/s × 0.4 ≒ 9.6 m/s（約 19 ノット）
      cityY: WATER_Y - 1.5, // 景観テーマの海面（cy + 1.5）が y = -10 に来る
      reach: 0,
      sides: [
        { facing: -1, z0: HULL.z0, xc: 4 }, // 右舷
        { facing: 1, z0: HULL.z1, xc: 4 }, // 左舷
      ],
    });
    this.scene.add(this.scenery.group);
    // 海面（右舷 -10.0 / 左舷 -9.9）より 0.6 m 上。巨大な海面の板と対数深度の精度で、近くの航跡が海面に隠れないように
    this.wake = new ShipWake({ x: HULL.stern, y: WATER_Y + 0.7, z: ZC, len: 760 });
    this.scene.add(this.wake.group);
  }

  /** 累積 km → 海の景観（鹿児島新港より手前の km では港を出たところの景色） */
  setJourneyKm(km, opt) {
    return super.setJourneyKm(Math.max(Number(km) || 0, SHIP_START_KM), opt);
  }

  setTimeMode(mode) {
    super.setTimeMode(mode);
    this.wake?.applyLook(this._lookApplied ?? this.look);
  }

  /* ==================================================================== */
  /* 照明・見える区画                                                        */
  /* ==================================================================== */
  _placeLamps(zone) {
    const L = this._lookApplied ?? this.look;
    let pts = this.zoneLights?.[zone.id];
    if (zone.id === 'corridor') {
      const x = THREE.MathUtils.clamp(this.player.pos.x, SCORR.x0 + 1, SCORR.x1 - 1);
      const zc = (SCORR.z0 + SCORR.z1) / 2;
      pts = [-3, 3, 0, -6, 6].map((dx) => new THREE.Vector3(x + dx, 2.4, zc));
      pts.push(x < -2 ? this.view.lights[2] : this.loungeS.lights[0]);
    }
    this.lamps.forEach((l, i) => {
      const q = pts?.[i];
      if (q) {
        l.position.copy(q);
        l.intensity = L.lamp;
      } else l.intensity = 0;
    });
  }

  _updateVisibility() {
    const vis = this.visible;
    vis.clear();
    const open = (id) => (this.doorById[id]?.open ?? 0) > 0.001;
    const front = this.camera.getWorldDirection(this._v1).x < -0.2;
    const visit = (id) => {
      if (!id || vis.has(id)) return;
      vis.add(id);
      if (id === 'viewroom') {
        visit('vrbalc');
        visit('corridor');
      } else if (id === 'vrbalc') visit('viewroom');
      else if (id === 'corridor') {
        // 廊下から View Room はアーチ越しに見える。後ろ（+X・ラウンジの方）を向いているときは見えないので描かない
        if (front || this.player.pos.x < SCORR.x0 + 1.5) visit('viewroom');
        for (const c of CABINS) if (open(`${c.id}-door`)) visit(c.id);
        if (open('lounge-door')) visit('lounge');
      } else if (id === 'lounge') {
        visit('aft');
        if (open('lounge-door')) visit('corridor');
      } else if (id === 'aft') visit('lounge');
      else if (id.endsWith('b')) visit(id.slice(0, -1));
      else {
        visit(`${id}b`);
        if (open(`${id}-door`)) visit('corridor');
      }
    };
    if (this.off.has('cull')) for (const id of Object.keys(this.sections)) vis.add(id);
    else {
      visit(this.zone.id);
      visit(this.zoneAt(this.camera.position.x, this.camera.position.z).id);
    }
    vis.delete('shell');
    this._portal = null;
    const key = [...vis].sort().join('+');
    if (key === this._visKey) return;
    this._visKey = key;
    const off = this.off;
    for (const [id, g] of Object.entries(this.sections)) g.visible = id === 'shell' || vis.has(id);
    for (const d of this.doors) d.mesh.visible = d.adj.some((a) => vis.has(a));
    for (const c of Object.values(this.characters)) {
      const kindOff = c.def.kind === 'human' ? off.has('rin') : off.has('animals');
      c.group.visible = vis.has(c.roomId) && !kindOff && !off.has('chars');
    }
    this.hologram.group.visible = vis.has('lounge') && !off.has('holo');
    const S = ['viewroom', 'vrbalc', 'lounge', 'aft', 'room1', 'room1b', 'room2', 'room2b'].some((id) => vis.has(id));
    const P = ['viewroom', 'vrbalc', 'lounge', 'aft', 'room3', 'room3b', 'room4', 'room4b'].some((id) => vis.has(id));
    this.scenery.group.visible = !off.has('scenery');
    this.scenery.setVisibleSides(S, P);
    // 航跡：後方の海が見える区画（デッキ・ラウンジ・バルコニー・船室の窓）
    this.wake.mesh.visible = !off.has('scenery') && !off.has('wake') && [...vis].some((id) => id !== 'corridor' && id !== 'viewroom');
  }

  update(dt) {
    super.update(dt);
    if (!this.active) return;
    if (this.wake.mesh.visible) this.wake.update(dt, this.scenery.offset);
  }

  /** V：ゾーンを見渡す固定の視点 */
  _overviewCam(zone, pivot) {
    let pos;
    const id = zone.id;
    if (id === 'viewroom') pos = new THREE.Vector3(SVIEW.x1 - 0.3, 2.4, 0.5);
    else if (id === 'vrbalc') pos = new THREE.Vector3(SVIEW.x1 - 0.8, 2.3, pivot.z < ZC ? -0.4 : BEAM + 0.4);
    else if (id === 'corridor') pos = new THREE.Vector3(THREE.MathUtils.clamp(pivot.x - 3, SCORR.x0 + 0.3, SCORR.x1 - 0.3), 2.4, SCORR.z0 + 0.25);
    else if (id === 'lounge') pos = new THREE.Vector3(SLOUNGE.x0 + 0.5, 2.5, 0.45);
    else if (id === 'aft') pos = new THREE.Vector3(SAFT.x0 + 0.4, 2.8, 0.2);
    else {
      const c = this.cabins.find((q) => q.def.id === id.replace(/b$/, ''));
      const side = c.def.side;
      const zIn = side < 0 ? 3.05 : BEAM - 3.05;
      pos = id.endsWith('b') ? new THREE.Vector3(c.def.x0 + 0.8, 2.3, side < 0 ? 0.3 : BEAM - 0.3) : new THREE.Vector3(c.def.x0 + 4.0, 2.4, zIn);
    }
    return { pos, look: pivot.clone().setY(0.4) };
  }

  dispose() {
    this.wake?.dispose();
    super.dispose();
  }
}

const CABIN_DEPTH = 3.2;
