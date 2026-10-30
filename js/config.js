/**
 * config.js — アセットパス・カメラプリセットなど「データ的な設定」を集約
 *
 * パスはすべて import.meta.url 基準の相対URLで解決する。
 * → GitHub Pages のプロジェクトサイト（https://<user>.github.io/<repo>/）でも、
 *   ルート直下でも、ローカルの python -m http.server でも同じように動く。
 */

const ROOT = new URL('../', import.meta.url); // js/ の 1 つ上 = サイトのルート

/** サイトルートからの相対パス → 絶対URL文字列 */
export const asset = (rel) => new URL(rel, ROOT).href;

export const ASSETS = {
  terrainManifest: asset('data/terrain/manifest.json'),
  terrainDir: asset('data/terrain/'),
  places: asset('data/places.json'),

  // ---- 将来追加予定（今回は読み込まない）----
  // models: {
  //   train:    asset('models/train.glb'),
  //   squirrel: asset('models/characters/squirrel.glb'),
  //   duck:     asset('models/characters/duck.glb'),
  //   monkey:   asset('models/characters/monkey.glb'),
  // },
};

/**
 * カメラプリセット
 *  lat/lon  : 注視点
 *  dist     : 俯瞰時のカメラ距離 [km]
 *  polar    : 俯瞰角（真上=0°, 水平=90°）
 *  azimuth  : 方位（0° = 南から北を見る, 90° = 東から西を見る）
 */
export const CAMERA_PRESETS = [
  { id: 'all', label: '全体俯瞰', lat: 30.9, lon: 132.4, dist: 1800, polar: 30, azimuth: 0 },
  { id: 'tokyo', label: '東京付近', lat: 35.62, lon: 139.72, dist: 150, polar: 58, azimuth: 205 },
  { id: 'tokai', label: '名古屋〜東海', lat: 35.0, lon: 137.6, dist: 260, polar: 56, azimuth: 175 },
  { id: 'kansai', label: '関西', lat: 34.72, lon: 135.55, dist: 190, polar: 56, azimuth: 195 },
  { id: 'chugoku', label: '中国地方', lat: 34.85, lon: 132.9, dist: 330, polar: 52, azimuth: 170 },
  { id: 'nkyushu', label: '北部九州', lat: 33.55, lon: 130.6, dist: 200, polar: 56, azimuth: 160 },
  { id: 'kagoshima', label: '鹿児島', lat: 31.6, lon: 130.62, dist: 110, polar: 60, azimuth: 200 },
  { id: 'amami', label: '鹿児島〜奄美', lat: 29.75, lon: 129.95, dist: 720, polar: 48, azimuth: 205 },
  { id: 'okinawa', label: '沖縄', lat: 26.5, lon: 127.95, dist: 170, polar: 58, azimuth: 200 },
];

export const WORLD_BOUNDS = { minX: -1100, maxX: 1000, minZ: -900, maxZ: 900 };
