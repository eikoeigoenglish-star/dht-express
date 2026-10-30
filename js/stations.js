/**
 * stations.js — 東京〜鹿児島中央の新幹線駅（東海道・山陽・九州新幹線 全46駅）
 * ---------------------------------------------------------------------------
 * 表示
 *   ・小さな駅マーカー（ホームを表す白い板 + 色付きのピン）。
 *     主要駅（major）は金色・一回り大きい。巨大にはしない。
 *   ・板とピンはそれぞれ 1 つの InstancedMesh → 全駅で draw call 2。
 *   ・板の向きは前後の駅を結ぶ方向（線路の向き）に合わせる。
 *
 * データ（将来の DHT EXPRESS 用）
 *   stations.list      … seq 順（東京=0 → 鹿児島中央=45）の配列
 *   stations.byId      … Map<id, station>
 *   stations.major     … 主要駅（到着イベントの重要ノード）
 *   stations.latLons() … [[lat, lon], ...]（seq 順）
 *   各 station: { id, name, type:'station', lat, lon, lines[], major, seq, x, z, y }
 *
 *   route.js と組み合わせる例:
 *     const route = new GeoPolyline(ROUTE_LATLON, { totalKm });
 *     const nodes = attachStationsToRoute(route, stations.list); // 各駅の routeKm
 *     // progressKm が nodes[i].routeKm を越えたら到着イベント
 *
 *   Raycaster: mesh.userData.items[instanceId] で駅データが引ける。
 */
import * as THREE from 'three';
import { latLonToWorld } from './geo.js';

const COLOR_MAJOR = new THREE.Color('#ffc24a');
const COLOR_NORMAL = new THREE.Color('#3f8fe0');

export class StationSystem {
  constructor(terrain) {
    this.terrain = terrain;
    this.group = new THREE.Group();
    this.group.name = 'stations';
    this.list = [];
    this.byId = new Map();
    this.lines = [];
    this.frame = 0;
  }

  async load(url) {
    const json = await (await fetch(url)).json();
    this.lines = json.lines;
    this.list = json.stations
      .slice()
      .sort((a, b) => a.seq - b.seq)
      .map((s) => {
        const w = latLonToWorld(s.lat, s.lon);
        return { ...s, x: w.x, z: w.z, y: 0 };
      });
    for (const s of this.list) this.byId.set(s.id, s);
    this.major = this.list.filter((s) => s.major);
    this._build();
    return this;
  }

  getById(id) {
    return this.byId.get(id);
  }

  /** seq 順の [[lat, lon], ...] */
  latLons() {
    return this.list.map((s) => [s.lat, s.lon]);
  }

  /** 線路の向き（前後の駅を結ぶ方向）[rad]。Three.js rotation.y 用 */
  _heading(i) {
    const a = this.list[Math.max(0, i - 1)];
    const b = this.list[Math.min(this.list.length - 1, i + 1)];
    return Math.atan2(-(b.x - a.x), -(b.z - a.z));
  }

  _build() {
    const n = this.list.length;
    // ホーム：長さ 0.42km × 幅 0.09km × 高さ 0.03（視認性のため実物より大きめ）
    const plat = new THREE.BoxGeometry(0.09, 0.035, 0.42);
    plat.translate(0, 0.0175, 0);
    // ピン：細い柱 + 上に菱形（八面体）
    const pole = new THREE.CylinderGeometry(0.012, 0.012, 0.26, 6);
    pole.translate(0, 0.13, 0);
    const head = new THREE.OctahedronGeometry(0.055, 0);
    head.scale(1, 1.35, 1);
    head.translate(0, 0.33, 0);
    const pin = mergeSimple([pole, head]);

    const matPlat = new THREE.MeshLambertMaterial({ color: 0xf2f4f6 });
    const matPin = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x111111 });
    this.platform = new THREE.InstancedMesh(plat, matPlat, n);
    this.pins = new THREE.InstancedMesh(pin, matPin, n);
    this.platform.name = 'station-platforms';
    this.pins.name = 'station-pins';
    for (const m of [this.platform, this.pins]) {
      m.matrixAutoUpdate = false;
      m.userData = { kind: 'stations', items: this.list };
      this.group.add(m);
    }
    this.list.forEach((s, i) => {
      s.heading = this._heading(i);
      s.scale = s.major ? 1.55 : 1.0;
      this.pins.setColorAt(i, s.major ? COLOR_MAJOR : COLOR_NORMAL);
    });
    this.pins.instanceColor.needsUpdate = true;
    this.snap(true);
  }

  /** 地表の高さに合わせて置き直す（詳細地形の読み込みで高さが変わるため定期的に呼ぶ） */
  snap(force = false) {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const p = new THREE.Vector3();
    const sc = new THREE.Vector3();
    let changed = false;
    this.list.forEach((s, i) => {
      const y = this.terrain.getSurfaceY(s.x, s.z);
      if (!force && Math.abs(y - s.y) < 0.004) return;
      s.y = y;
      changed = true;
      q.setFromAxisAngle(up, s.heading);
      sc.setScalar(s.scale);
      m.compose(p.set(s.x, y - 0.01, s.z), q, sc);
      this.platform.setMatrixAt(i, m);
      m.compose(p.set(s.x, y + 0.02, s.z), q, sc);
      this.pins.setMatrixAt(i, m);
    });
    if (changed) {
      this.platform.instanceMatrix.needsUpdate = true;
      this.pins.instanceMatrix.needsUpdate = true;
      this.platform.computeBoundingSphere();
      this.pins.computeBoundingSphere();
    }
  }

  update() {
    if (++this.frame % 30 === 0) this.snap();
  }

  /** 駅の周りに建物を建てないための除外円 */
  exclusions() {
    return this.list.map((s) => ({ x: s.x, z: s.z, r: s.major ? 0.36 : 0.26 }));
  }

  /** ラベル項目（labels.js の addItems 形式）。近距離では都市名より駅名を優先 */
  labelItems() {
    return this.list.map((s) => ({
      id: s.id,
      name: s.name,
      type: 'station',
      cls: s.major ? 'label--station-major' : '',
      x: s.x,
      z: s.z,
      yOffset: (s.major ? 0.62 : 0.42) - 0.4,
      maxDist: s.major ? 700 : 150,
      prio: s.major ? 3.9 : 1.9,
      nearDist: 70,
      prioNear: s.major ? 6.5 : 5.2,
      wExtra: 14,
      meta: s,
    }));
  }
}

/** 位置・法線だけの簡易結合（インデックス付きジオメトリ同士） */
function mergeSimple(list) {
  const pos = [];
  const nor = [];
  for (const g0 of list) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    pos.push(...g.attributes.position.array);
    nor.push(...g.attributes.normal.array);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
}
