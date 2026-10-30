/**
 * main.js — エントリポイント
 * ---------------------------------------------------------------------------
 * 構成（モジュール分離）
 *   geo.js         座標変換（緯度経度 ⇔ ワールド）
 *   config.js      アセットパス・カメラプリセット
 *   terrain.js     地形タイル・LOD・標高サンプリング
 *   environment.js 空・海・ライト・フォグ
 *   camera.js      カメラ生成・プリセット変換・滑らか移動
 *   controls.js    MAP VIEW / EXPLORE VIEW の操作
 *   labels.js      地名ラベル（HTML）
 *   cities.js      都市メッシュ（InstancedMesh・距離LOD）と市街地の色付け
 *   stations.js    新幹線駅（東京〜鹿児島中央 46駅）のマーカーとデータ
 *   landmarks.js   ランドマーク（基本形状で作った簡略モデル）
 *   meshkit.js     部品の結合・乱数などの小道具
 *   ui.js          HUD
 *   route.js       （将来用）km → ルート上の位置
 *
 * シーングラフ
 *   scene
 *    ├─ environment (sky, sea-surface, seabed, lights)
 *    ├─ terrain     (coarse_*, hi_* タイル)
 *    ├─ cities      (city_* … 64km チャンクごとの InstancedMesh)
 *    ├─ stations    (station-platforms, station-pins … InstancedMesh 2つ)
 *    ├─ landmarks   (landmark_* … 1件 = 1 Mesh)
 *    ├─ actors      ← 将来：列車・9体のキャラクター GLB をここへ
 *    └─ fx          ← 将来：演出・パーティクル
 */
import * as THREE from 'three';
import { ASSETS, CAMERA_PRESETS } from './config.js';
import { TerrainSystem, setUrbanField } from './terrain.js';
import { CitySystem } from './cities.js';
import { StationSystem } from './stations.js';
import { LandmarkSystem } from './landmarks.js';
import { Environment } from './environment.js';
import { createCamera, CameraRig, presetToView, presetToExploreView } from './camera.js';
import { MapController, ExploreController } from './controls.js';
import { PlaceLabels } from './labels.js';
import { UI } from './ui.js';
import * as geo from './geo.js';

const canvas = document.getElementById('scene');

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
  logarithmicDepthBuffer: true, // 地表 10m 〜 地平線 数千km を1つのカメラで扱うため
});
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.setSize(innerWidth, innerHeight, false);

const scene = new THREE.Scene();
const camera = createCamera();
scene.add(camera);

const env = new Environment(scene);
const terrain = new TerrainSystem({ dir: ASSETS.terrainDir, manifestUrl: ASSETS.terrainManifest });
scene.add(terrain.group);

// 都市・駅・ランドマーク（地形とは別グループ：将来の Raycaster で対象を選びやすい）
const cities = new CitySystem(terrain);
const stations = new StationSystem(terrain);
const landmarks = new LandmarkSystem(terrain);
scene.add(cities.group, stations.group, landmarks.group);

const actors = new THREE.Group();
actors.name = 'actors';
const fx = new THREE.Group();
fx.name = 'fx';
scene.add(actors, fx);

const rig = new CameraRig(camera);
const mapCtl = new MapController(camera, canvas, terrain);
const exploreCtl = new ExploreController(camera, canvas, terrain);
const labels = new PlaceLabels(document.getElementById('labels-layer'), terrain);

let mode = 'map';

const ui = new UI({
  presets: CAMERA_PRESETS,
  onMode: (m) => setMode(m),
  onPreset: (p) => goPreset(p),
  onToggleLabels: () => {
    labels.setVisible(!labels.visible);
    return labels.visible;
  },
  onToggleCity: () => {
    cities.setVisible(!cities.visible);
    return cities.visible;
  },
});
exploreCtl.onLockChange = (l) => ui.setLocked(l);

/* ---------------------------------------------------------------------- */
/* モード切替                                                               */
/* ---------------------------------------------------------------------- */

function setMode(next) {
  if (next === mode || rig.animating) return;
  ui.setActivePreset(null);
  if (next === 'explore') {
    mapCtl.disable();
    mode = 'explore';
    ui.setMode(mode);
    const T = mapCtl.target.clone();
    const cam = camera.position;
    const agl = cam.y - terrain.getSurfaceY(cam.x, cam.z);
    if (agl > 25) {
      // 高空から：注視点の手前の低空へ降りていく
      const d = new THREE.Vector3(T.x - cam.x, 0, T.z - cam.z);
      if (d.lengthSq() < 1e-6) d.set(0, 0, -1);
      d.normalize();
      const pos = T.clone().addScaledVector(d, -16);
      pos.y = terrain.getSurfaceY(pos.x, pos.z) + 3.2;
      const look = T.clone().addScaledVector(d, 30);
      look.y = terrain.getSurfaceY(look.x, look.z) + 0.6;
      terrain.prefetchAround(pos.x, pos.z);
      rig.flyTo(pos, look, {
        fromTarget: T,
        duration: 1.8,
        getGround: (x, z) => terrain.getSurfaceY(x, z),
        onDone: () => exploreCtl.enable(),
      });
    } else {
      exploreCtl.enable();
    }
  } else {
    exploreCtl.disable();
    mode = 'map';
    ui.setMode(mode);
    mapCtl.enable(groundPointAhead());
  }
}

/** カメラの視線が地表（海面）に当たる点。当たらなければ前方の地表点 */
function groundPointAhead() {
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  const p = camera.position.clone();
  const agl = Math.max(0.05, p.y - terrain.getSurfaceY(p.x, p.z));
  let step = Math.max(0.05, agl * 0.05);
  const q = p.clone();
  for (let i = 0; i < 400; i++) {
    q.addScaledVector(dir, step);
    const g = terrain.getSurfaceY(q.x, q.z);
    if (q.y <= g) {
      q.y = g;
      if (q.distanceTo(p) < 600) return q;
      break;
    }
    step *= 1.04;
  }
  const f = new THREE.Vector3(dir.x, 0, dir.z);
  if (f.lengthSq() < 1e-6) f.set(0, 0, -1);
  f.normalize();
  const t = p.clone().addScaledVector(f, THREE.MathUtils.clamp(agl * 2.5, 6, 300));
  t.y = terrain.getSurfaceY(t.x, t.z);
  return t;
}

/* ---------------------------------------------------------------------- */
/* プリセット                                                               */
/* ---------------------------------------------------------------------- */

function goPreset(p) {
  ui.setActivePreset(p.id);
  const ground = (x, z) => terrain.getSurfaceY(x, z);
  if (mode === 'map') {
    const v = presetToView(p, terrain);
    terrain.prefetchAround(v.target.x, v.target.z, Math.min(400, p.dist));
    const from = mapCtl.target.clone();
    mapCtl.disable();
    rig.flyTo(v.position, v.target, {
      fromTarget: from,
      getGround: ground,
      onDone: () => mapCtl.enable(v.target),
    });
  } else {
    const v = presetToExploreView(p, terrain);
    terrain.prefetchAround(v.position.x, v.position.z);
    exploreCtl.enabled = false;
    rig.flyTo(v.position, v.target, {
      getGround: ground,
      onDone: () => exploreCtl.enable(),
    });
  }
}

/* ---------------------------------------------------------------------- */
/* 都市・駅・ランドマーク                                                    */
/* ---------------------------------------------------------------------- */

async function setupOverlays() {
  const [st, lm] = await Promise.allSettled([stations.load(ASSETS.stations), landmarks.load(ASSETS.landmarks)]);
  if (st.status === 'rejected') console.warn('stations', st.reason);
  if (lm.status === 'rejected') console.warn('landmarks', lm.reason);
  // 駅・ランドマークの周りには建物を建てない
  if (st.status === 'fulfilled') cities.addExclusions(stations.exclusions());
  if (lm.status === 'fulfilled') cities.addExclusions(landmarks.exclusions());
  if (cities.cities.length) {
    cities.prepareChunks();
    // places.json に同じ都市のラベルがあれば重複させない
    labels.addItems(cities.labelItems().filter((c) => !labels.findNear(c.x, c.z, 9)));
  }
  if (st.status === 'fulfilled') labels.addItems(stations.labelItems());
  if (lm.status === 'fulfilled') labels.addItems(landmarks.labelItems());
}

/* ---------------------------------------------------------------------- */
/* 起動                                                                     */
/* ---------------------------------------------------------------------- */

async function start() {
  try {
    // 都市データは地形タイルの色付け（市街地色）に使うので地形より先に読む
    await cities
      .load(ASSETS.cities)
      .then(() => setUrbanField((x, z) => cities.densityAt(x, z)))
      .catch((e) => console.warn('cities', e));
    await terrain.init();
    await labels.load(ASSETS.places).catch((e) => console.warn('labels', e));
    await setupOverlays();
  } catch (e) {
    console.error(e);
    ui.error(
      location.protocol === 'file:'
        ? 'file:// では読み込めません。README の手順でローカルHTTPサーバー経由で開いてください。'
        : '地形データの読み込みに失敗しました。',
    );
    return;
  }

  const first = CAMERA_PRESETS[0];
  const v = presetToView(first, terrain);
  camera.position.copy(v.position);
  camera.lookAt(v.target);
  mapCtl.enable(v.target);
  ui.setMode(mode);
  ui.setActivePreset(first.id);

  // 最初のフレームを描いてからローディングを消す
  renderer.render(scene, camera);
  requestAnimationFrame(() => ui.loaded());

  const timer = new THREE.Timer();
  timer.connect(document);
  renderer.setAnimationLoop(() => {
    timer.update();
    const dt = Math.min(0.1, timer.getDelta());
    if (!rig.update(dt)) {
      if (mode === 'map') mapCtl.update(dt);
      else exploreCtl.update(dt);
    }
    terrain.update(camera);
    cities.update(camera);
    stations.update();
    landmarks.update(camera);
    const p = camera.position;
    env.update(camera, dt, p.y - terrain.getSurfaceY(p.x, p.z));
    renderer.render(scene, camera);
    labels.update(camera, innerWidth, innerHeight);
    ui.tick(dt, { renderer, camera, terrain, speed: mode === 'explore' ? exploreCtl.lastSpeed : null, cities });
  });
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight, false);
});

// 将来の拡張・デバッグ用ハンドル（コンソールから window.DHT で触れる）
export const app = { renderer, scene, camera, terrain, env, rig, mapCtl, exploreCtl, labels, cities, stations, landmarks, layers: { actors, fx }, geo, presets: CAMERA_PRESETS, setMode, goPreset };
window.DHT = app;

start();
