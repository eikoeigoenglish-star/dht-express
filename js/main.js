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
 *   water.js       湖沼・河川（v3。水面メッシュ 2 つ・水域マスク・ラベル）
 *   meshkit.js     部品の結合・乱数などの小道具
 *   ui.js          HUD
 *   route.js       v5: 距離ベースのルートエンジン（論理 km → 3D 位置。Journey / RailRoute / FerryRoute）
 *   journey.js     v5: ルート線・10km 発光ノード・寄港地の表示
 *   livery.js      v7: FOREST SCHOOL の列車・船の塗装（GLB 読み込み後にマテリアルを差し替え）
 *   vehicles.js    v7: 列車・船の配置と「昨日 → 今日」の移動アニメーション
 *   progress.js    v7: DHT 進捗 API（GAS。fetch → 失敗時 JSONP）と進捗パネル
 *   boarding.js    v11: 列車クリック → 乗車確認 → FOREST SCHOOL EXPRESS / Room 1（interior/*）⇔ MAP
 *
 * シーングラフ
 *   scene
 *    ├─ environment (sky, sea-surface, seabed, lights)
 *    ├─ terrain     (coarse_*, hi_* タイル)
 *    ├─ cities      (city_* … 64km チャンクごとの InstancedMesh)
 *    ├─ stations    (station-platforms, station-pins … InstancedMesh 2つ)
 *    ├─ landmarks   (landmark_* … 1件 = 1 Mesh)
 *    ├─ water       (lakes, rivers … 全湖・全河川で Mesh 2 つ)   ← v3
 *    ├─ journey     (route-* 線 5 本 + route-nodes 1 つ)          ← v5 DHT EXPRESS ルート
 *    ├─ actors      (dht-vehicles: vehicle-train / vehicle-ship)  ← v7。将来：9体のキャラクター GLB もここへ
 *    └─ fx          ← 将来：演出・パーティクル
 */
import * as THREE from 'three';
import { ASSETS, CAMERA_PRESETS, HUD_PRESET_IDS } from './config.js';
import { TerrainSystem, setUrbanField } from './terrain.js';
import { CitySystem } from './cities.js';
import { StationSystem } from './stations.js';
import { LandmarkSystem } from './landmarks.js';
import { WaterSystem } from './water.js';
import { loadJourney } from './route.js';
import { JourneyLayer } from './journey.js';
import { Environment } from './environment.js';
import { createCamera, CameraRig, presetToView, presetToExploreView } from './camera.js';
import { MapController, ExploreController } from './controls.js';
import { PlaceLabels } from './labels.js';
import { UI } from './ui.js';
import { VehicleSystem } from './vehicles.js';
import { loadProgress, ProgressHud } from './progress.js';
import { TimeOfDay } from './timeofday.js';
import { VehicleFollowController } from './vehiclecam.js';
import { LighthouseBeacons } from './lighthouses.js';
import * as geo from './geo.js';
import { Boarding } from './boarding.js';

const canvas = document.getElementById('scene');

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
  logarithmicDepthBuffer: true, // 地表 10m 〜 地平線 数千km を1つのカメラで扱うため
  stencil: true, // v5: ルートの発光帯を 1 ピクセル 1 回だけ描く（細かい線分の重なりで白飛びしないように）
});
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.setSize(innerWidth, innerHeight, false);

const scene = new THREE.Scene();
const camera = createCamera();
scene.add(camera);

const env = new Environment(scene);
const tod = new TimeOfDay(env); // v8: MORNING / DAY / EVENING / NIGHT（明石市の日出・日没、JST）
const terrain = new TerrainSystem({ dir: ASSETS.terrainDir, manifestUrl: ASSETS.terrainManifest, detailManifestUrl: ASSETS.terrainDetail });
scene.add(terrain.group);

// 都市・駅・ランドマーク（地形とは別グループ：将来の Raycaster で対象を選びやすい）
const cities = new CitySystem(terrain);
const stations = new StationSystem(terrain);
const landmarks = new LandmarkSystem(terrain);
const water = new WaterSystem(terrain);
const journeyLayer = new JourneyLayer(terrain, { urbanAt: (x, z) => cities.densityAt(x, z) }); // v5
scene.add(cities.group, stations.group, landmarks.group, water.group, journeyLayer.group);
const beacons = new LighthouseBeacons(terrain, landmarks); // v8: 灯台 13 件の灯火（夕方・夜）
scene.add(beacons.group);

const actors = new THREE.Group();
actors.name = 'actors';
const fx = new THREE.Group();
fx.name = 'fx';
scene.add(actors, fx);

// v7: FOREST SCHOOL の列車・船。進捗 API は起動と同時に取りに行く（地形の読み込みを待たない）
const vehicles = new VehicleSystem(terrain, { renderer, urbanAt: (x, z) => cities.densityAt(x, z) });
actors.add(vehicles.group);
vehicles.attachTags(document.getElementById('labels-layer'));
const progressPromise = loadProgress().then(
  (r) => r,
  (e) => ({ error: e }),
);

const rig = new CameraRig(camera);
const mapCtl = new MapController(camera, canvas, terrain);
const exploreCtl = new ExploreController(camera, canvas, terrain);
const follow = new VehicleFollowController(camera, canvas, terrain, vehicles); // v8: VEHICLE VIEW
const labels = new PlaceLabels(document.getElementById('labels-layer'), terrain);

let mode = 'vehicle'; // v8: 初期表示は VEHICLE VIEW（列車・船の準備ができたら追跡を開始）
let vehicleReady = false;

const ui = new UI({
  // v9: 通常 UI の CAMERA は 6 件だけ（全プリセットは DHT.presets に残す）
  presets: HUD_PRESET_IDS.map((id) => CAMERA_PRESETS.find((p) => p.id === id)).filter(Boolean),
  onMode: (m) => setMode(m),
  onVehicle: (kind) => followVehicle(kind),
  onPreset: (p) => goPreset(p),
  onToggleLabels: () => {
    labels.setVisible(!labels.visible);
    return labels.visible;
  },
  onToggleCity: () => {
    cities.setVisible(!cities.visible);
    return cities.visible;
  },
  onToggleRoute: () => {
    journeyLayer.setVisible(!journeyLayer.visible);
    labels.setTypeVisible(['routekm', 'routeend', 'port'], journeyLayer.visible);
    return journeyLayer.visible;
  },
});
exploreCtl.onLockChange = (l) => ui.setLocked(l);

/* ---------------------------------------------------------------------- */
/* v11: FOREST SCHOOL EXPRESS / Room 1（列車クリック → 乗車確認 → 車内）      */
/*      Room 1 表示中は MAP の更新・描画を止め、入力だけを一時停止して戻す     */
/* ---------------------------------------------------------------------- */
let mapPaused = null;
const boarding = new Boarding({
  renderer,
  canvas,
  camera,
  vehicles,
  canBoard: () => vehicleReady && !rig.animating && (mode === 'map' || mode === 'vehicle'),
  timeMode: () => tod.mode, // v11: Room 1 は day のみ実装（他は day で表示。interior/looks.js）
  suspendMap: () => {
    mapPaused = { map: mapCtl.controls.enabled, follow: follow.enabled };
    mapCtl.disable();
    follow.enabled = false; // 追跡の状態（向き・ずらし・距離）は保持したまま止める
  },
  resumeMap: () => {
    if (!mapPaused) return;
    if (mapPaused.map) mapCtl.controls.enabled = true;
    if (mapPaused.follow && mode === 'vehicle') follow.enabled = true;
    mapPaused = null;
  },
});

/* ---------------------------------------------------------------------- */
/* モード切替                                                               */
/* ---------------------------------------------------------------------- */

function setMode(next) {
  if (next === mode || rig.animating) return;
  ui.setActivePreset(null);
  if (mode === 'vehicle') follow.disable();
  if (next === 'vehicle') {
    mapCtl.disable();
    exploreCtl.disable();
    mode = 'vehicle';
    ui.setMode(mode);
    enterVehicleView();
    return;
  }
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

/**
 * v9: 左上の新幹線・船アイコン。VEHICLE VIEW に切り替えてその乗り物を追跡する。
 * VEHICLE VIEW 中に遠くの乗り物へ切り替えるときは、ワープせず既存の滑らか移動で後ろへ飛ぶ。
 */
function followVehicle(kind) {
  if (rig.animating) return;
  vehicles.followOverride = kind;
  ui.setVehicleKind(kind);
  if (mode !== 'vehicle') {
    setMode('vehicle');
    return;
  }
  const v = follow.desiredPose();
  if (vehicleReady && v && camera.position.distanceTo(v.pos) > 6) {
    follow.disable();
    enterVehicleView();
  }
}

/**
 * v8: VEHICLE VIEW に入る。カメラが遠ければ既存の滑らか移動（rig.flyTo）で追跡位置まで飛んでから追跡を始める。
 * 列車・船の準備前なら、準備ができた時点（setupVehicles）で呼び直す。
 */
function enterVehicleView() {
  if (!vehicleReady) return 0;
  const v = follow.desiredPose();
  if (!v) return 0;
  terrain.prefetchAround(v.look.x, v.look.z);
  if (camera.position.distanceTo(v.pos) > 6) {
    const duration = camera.position.distanceTo(v.pos) > 300 ? 3.2 : 2.0;
    rig.flyTo(v.pos, v.look, {
      fromTarget: mapCtl.target.clone(),
      duration,
      getGround: (x, z) => terrain.getSurfaceY(x, z),
      onDone: () => mode === 'vehicle' && follow.enable(),
    });
    return duration;
  }
  follow.enable();
  return 0;
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
  // v8: VEHICLE VIEW 中にプリセットを選んだら MAP VIEW に切り替えて移動
  if (mode === 'vehicle') {
    follow.disable();
    mode = 'map';
    ui.setMode(mode);
  }
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

/** v3: 湖沼・河川。都市の建物生成（prepareChunks）より前に水域マスクを登録する */
async function setupWater() {
  try {
    await water.load(ASSETS.water);
    water.suppressLakes(terrain.patches.flatMap((p) => p.suppressLakes ?? [])); // v10: 中海は詳細地形の海面で描く
    water.build();
    cities.setWaterMask((x, z, m) => water.isWater(x, z, m));
  } catch (e) {
    console.warn('water', e);
  }
}

async function setupOverlays() {
  const [st, lm] = await Promise.allSettled([stations.load(ASSETS.stations), landmarks.load(ASSETS.landmarks, ASSETS.landmarksV8, ASSETS.landmarksV10)]);
  if (st.status === 'rejected') console.warn('stations', st.reason);
  if (lm.status === 'rejected') console.warn('landmarks', lm.reason);
  // 駅・ランドマークの周りには建物を建てない
  if (st.status === 'fulfilled') cities.addExclusions(stations.exclusions());
  if (lm.status === 'fulfilled') cities.addExclusions(landmarks.exclusions());
  if (cities.cities.length) {
    cities.prepareChunks();
    // places.json に同じ都市のラベルがあれば重複させない
    // v5: 島名ラベルと同じ名前の都市（宮古島・石垣島）も二重にしない
    labels.addItems(
      cities
        .labelItems()
        .filter((c) => !labels.findNear(c.x, c.z, 9) && !labels.items.some((it) => it.name === c.name && Math.hypot(it.x - c.x, it.z - c.z) < 40)),
    );
  }
  if (st.status === 'fulfilled') labels.addItems(stations.labelItems());
  if (lm.status === 'fulfilled') {
    labels.addItems(landmarks.labelItems());
    beacons.build(); // v8
  }
  if (water.lakes.length) labels.addItems(water.labelItems());
}

/** v5: DHT EXPRESS のルート（新幹線・鹿児島接続・フェリー）。距離エンジンは window.DHT.journey */
async function setupJourney() {
  try {
    const j = await loadJourney(ASSETS.journey, { getSurfaceY: (x, z) => terrain.getSurfaceY(x, z) });
    app.journey = j;
    app.route = { rail: j.rail, connector: j.connector, ferry: j.ferry };
    journeyLayer.build(j);
    labels.addItems(journeyLayer.labelItems());
  } catch (e) {
    console.warn('journey', e);
  }
}

/** v7: 列車・船の GLB を読み込み、進捗 API の結果で「昨日 → 今日」を再生する */
const hud = new ProgressHud(document.getElementById('dht-progress'), {
  onReplay: () => vehicles.play(0.2),
});
hud.setLoading();
vehicles.onLive = (km) => hud.setLive(km);
// v8: 右上パネルに現在の時間帯（明石市の日出・日没基準）
tod.onChange((m, t) => {
  const el = document.querySelector('.dht-hud__tod');
  if (!el) return;
  const d = t.describe();
  el.textContent = `${m.toUpperCase()} (${d.forced ? 'forced by URL' : 'auto'})`; // v9: ?debug=1 のときだけ見える
  console.info(`[timeofday] ${m.toUpperCase()}（明石市 日出 ${d.sunrise} / 日没 ${d.sunset}${d.forced ? '・URL で固定' : ''}）`);
  el.dataset.mode = m;
  el.title = `明石市 日出 ${d.sunrise} / 日没 ${d.sunset}（夕方 ${d.eveningStart}〜）${d.forced ? '・URL で固定' : ''}`;
});

async function setupVehicles() {
  if (!app.journey) return;
  try {
    await vehicles.load(ASSETS.models);
    vehicles.setJourney(app.journey);
  } catch (e) {
    console.warn('vehicles', e);
    hud.setError('列車・船のモデルを読み込めませんでした');
    return;
  }
  const r = await progressPromise;
  let p;
  if (r.error) {
    console.warn('[progress] 進捗 API を取得できませんでした', r.error);
    hud.setError('進捗データを取得できませんでした（0 km 表示）');
    p = { previousKm: 0, currentKm: 0 };
    vehicles.setProgress(p);
  } else {
    p = r.progress;
    const plan = vehicles.setProgress(p);
    hud.setProgress(p, plan, r.source);
    console.info(`[progress] ${r.source.toUpperCase()} 昨日 ${p.previousKm} km（${p.previousFrom}）→ 今日 ${p.currentKm} km`, plan);
    app.progress = { ...r, plan };
  }
  hud.setLive(p.previousKm);
  // v8: 1 度配置してから VEHICLE VIEW の追跡を始める（初期表示）。
  //     カメラが乗り物の後ろへ飛び終わってから「昨日 → 今日」を再生する（飛行中に動いて追跡位置がずれないように）
  vehicles.update(camera, 0, innerHeight, innerWidth);
  vehicleReady = true;
  const fly = mode === 'vehicle' ? enterVehicleView() : 0;
  vehicles.play(1.2 + fly);
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
    await setupWater();
    await setupOverlays();
    await setupJourney();
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
  if (mode === 'map') mapCtl.enable(v.target);
  else mapCtl.target.copy(v.target); // v8: VEHICLE VIEW の準備ができるまで全体俯瞰のまま待つ
  ui.setMode(mode);
  if (mode === 'map') ui.setActivePreset(first.id);

  // 最初のフレームを描いてからローディングを消す
  renderer.render(scene, camera);
  requestAnimationFrame(() => ui.loaded());
  setupVehicles(); // v7（待たない：モデルと API がそろった時点で表示・再生）

  const timer = new THREE.Timer();
  timer.connect(document);
  renderer.setAnimationLoop(() => {
    timer.update();
    const rawDt = timer.getDelta();
    const dt = Math.min(0.1, rawDt);
    // v11: Room 1 表示中は Room 1 だけを更新・描画（MAP の地形・都市・列車の再生は止めたまま保持）
    if (boarding.frame(dt)) return;
    if (!rig.update(dt)) {
      if (mode === 'map') mapCtl.update(dt);
      else if (mode === 'vehicle') {
        /* v8: VEHICLE VIEW は乗り物の配置の後で更新する（下） */
      }
      // 飛空艇は速度を km/h で固定しているので、低 FPS（〜4fps）でも実時間どおりに進める
      else exploreCtl.update(Math.min(0.25, rawDt));
    }
    terrain.update(camera);
    cities.update(camera);
    stations.update();
    landmarks.update(camera);
    beacons.update(camera, dt, innerHeight); // v8
    water.update();
    journeyLayer.update(camera, innerWidth, innerHeight);
    // v8: 列車・船の再生は実時間（低 FPS の端末でも 4〜8 秒で終わるように。1 フレーム最大 0.25 秒）
    const vdt = Math.min(0.25, rawDt);
    vehicles.update(camera, vdt, innerHeight, innerWidth); // v7
    if (mode === 'vehicle' && !rig.animating) follow.update(vdt); // v8
    if (mode === 'vehicle' && vehicleReady) {
      const k = vehicles.followTarget()?.kind;
      ui.setVehicleKind(k === 'transfer' ? 'ship' : k); // v9: 左上の新幹線／船アイコン
    }
    const p = camera.position;
    tod.update(dt); // v8
    env.update(camera, dt, p.y - terrain.getSurfaceY(p.x, p.z));
    renderer.render(scene, camera);
    labels.setViewMode(mode); // v10: 高度による表示距離（VEHICLE は厳しめ・MAP は広め）
    labels.update(camera, innerWidth, innerHeight);
    ui.tick(dt, { renderer, camera, terrain, speed: mode === 'explore' ? exploreCtl.lastSpeed : null, cities, labels });
  });
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight, false);
  boarding.resize(); // v11
});

// 将来の拡張・デバッグ用ハンドル（コンソールから window.DHT で触れる）
export const app = { renderer, scene, camera, terrain, env, rig, mapCtl, exploreCtl, labels, cities, stations, landmarks, water, journeyLayer, journey: null, route: null, vehicles, follow, beacons, progress: null, tod, boarding, get room1() { return boarding.room; }, mode: () => mode, layers: { actors, fx }, geo, presets: CAMERA_PRESETS, setMode, goPreset };
window.DHT = app;

start();
