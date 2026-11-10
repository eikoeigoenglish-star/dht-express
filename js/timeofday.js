/**
 * timeofday.js — 【v8】時間帯モード（MORNING / DAY / EVENING / NIGHT）
 * ---------------------------------------------------------------------------
 * 基準：日本標準時（JST, Asia/Tokyo）と、JST の基準子午線が通る兵庫県明石市の日出・日没。
 *   NIGHT   … 日没 〜 翌日の日出
 *   EVENING … 日没の 1 時間前 〜 日没
 *   MORNING … 日出 〜 10:00 JST
 *   DAY     … 10:00 JST 〜 EVENING の開始
 * 日出・日没は外部 API を使わず、明石市の緯度経度から「日出の方程式」（平均近点角・中心差・黄経・赤緯、
 * 大気差と太陽の視半径を含む高度 -0.833°）でその日ごとに計算する（誤差 1〜2 分程度）。
 *
 * 確認用：?timeMode=morning|day|evening|night で固定（通常は自動判定）。
 *   大文字・小文字は区別しない（night / NIGHT / Night）。不正な値（?timeMode=abc）はエラーにせず無視して自動判定。
 *   ?km=…&prev=… や ?debug=1 など他のパラメータと併用できる。優先順位：有効な timeMode > JST＋明石市の自動判定。
 *
 * 見た目のつなぎ：モードが変わったら約 4 秒かけてライト・空・霧・海・夜景の強さを補間する。
 * 夜景系のパラメータは TOD_UNIFORMS（各モジュールのシェーダが同じ uniform オブジェクトを参照）で配る。
 */
import * as THREE from 'three';

export const AKASHI = { name: '兵庫県明石市（明石市立天文科学館付近・東経135度子午線）', lat: 34.6492, lon: 135.0012 };
export const MODES = ['morning', 'day', 'evening', 'night'];

const D2R = Math.PI / 180;
const JST_MS = 9 * 3600 * 1000;
const DAY_MS = 86400000;

/** JST の暦日（年・月・日）。t は UTC ミリ秒 */
export function jstDate(t) {
  const d = new Date(t + JST_MS);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
}

/**
 * 日出・日没（UTC ミリ秒）。日出の方程式（Wikipedia "Sunrise equation" と同じ NOAA 系の近似）。
 * @param {{y,m,d}} date JST の暦日
 */
export function sunTimes(date, lat = AKASHI.lat, lon = AKASHI.lon) {
  // その日の JST 正午（= UTC 03:00）付近のユリウス日
  const noonUtc = Date.UTC(date.y, date.m - 1, date.d, 3, 0, 0);
  const J = noonUtc / DAY_MS + 2440587.5;
  const n = Math.round(J - 2451545.0 + 0.0008);
  const Jstar = n - lon / 360;
  const M = (((357.5291 + 0.98560028 * Jstar) % 360) + 360) % 360;
  const Mr = M * D2R;
  const C = 1.9148 * Math.sin(Mr) + 0.02 * Math.sin(2 * Mr) + 0.0003 * Math.sin(3 * Mr);
  const lam = ((M + C + 180 + 102.9372) % 360) * D2R;
  const Jtransit = 2451545.0 + Jstar + 0.0053 * Math.sin(Mr) - 0.0069 * Math.sin(2 * lam);
  const dec = Math.asin(Math.sin(lam) * Math.sin(23.4397 * D2R));
  const cosW = (Math.sin(-0.833 * D2R) - Math.sin(lat * D2R) * Math.sin(dec)) / (Math.cos(lat * D2R) * Math.cos(dec));
  const w0 = Math.acos(Math.max(-1, Math.min(1, cosW))) / D2R;
  const toMs = (jd) => (jd - 2440587.5) * DAY_MS;
  return { sunrise: toMs(Jtransit - w0 / 360), sunset: toMs(Jtransit + w0 / 360), noon: toMs(Jtransit) };
}

/** 時刻 t（UTC ms）の時間帯と、その日の境界時刻 */
export function modeAt(t = Date.now()) {
  const date = jstDate(t);
  const { sunrise, sunset } = sunTimes(date);
  const ten = Date.UTC(date.y, date.m - 1, date.d, 1, 0, 0); // 10:00 JST
  const eveningStart = sunset - 3600 * 1000;
  let mode;
  if (t < sunrise || t >= sunset) mode = 'night';
  else if (t < ten) mode = 'morning';
  else if (t < eveningStart) mode = 'day';
  else mode = 'evening';
  return { mode, date, sunrise, sunset, ten, eveningStart, sinceSunrise: t - sunrise };
}

export function fmtJst(t) {
  const d = new Date(t + JST_MS);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

/* ---------------------------------------------------------------------- */
/* モードごとの見た目                                                         */
/* ---------------------------------------------------------------------- */
const c = (hex) => new THREE.Color(hex);
const v3 = (x, y, z) => new THREE.Vector3(x, y, z).normalize();

/**
 * 各値：hemi(空・地面・強さ)、sun(色・強さ・向き)、空(地平・天頂)、霧、海(色・不透明度・鏡面)、
 * 夜景（city: 点灯の強さ, coverage: 点灯する建物の割合, glow: 遠景の市街地の光, lighthouse: 灯台,
 *       landmark: ランドマークのライトアップ）、南国の浅瀬（reef 色 3 段階と強さ）
 */
export const LOOKS = {
  morning: {
    hemiSky: c('#d9e9fb'), hemiGround: c('#46523d'), hemi: 1.18,
    sunColor: c('#ffe6c4'), sun: 2.05, sunDir: v3(0.85, 0.62, -0.32),
    horizon: c('#d3e4f1'), zenith: c('#4a8fd2'), fog: c('#cfe1ef'),
    water: c('#2a78a2'), waterOpacity: 0.72, waterSpec: c('#1c2a33'),
    city: 0, coverage: 0, glow: 0, lighthouse: 0, landmark: 0, cityDim: 0,
    reef0: c('#62e6cc'), reef1: c('#36c4cc'), reef2: c('#2a8fb6'), reefAmt: 0.92,
  },
  day: {
    hemiSky: c('#dfeeff'), hemiGround: c('#3b4a36'), hemi: 1.35,
    sunColor: c('#fff2dd'), sun: 2.3, sunDir: v3(-0.9, 1.25, -0.55),
    horizon: c('#bcd6ea'), zenith: c('#3f7fc0'), fog: c('#bcd6ea'),
    water: c('#1f6a96'), waterOpacity: 0.74, waterSpec: c('#0e1820'),
    city: 0, coverage: 0, glow: 0, lighthouse: 0, landmark: 0, cityDim: 0,
    reef0: c('#3fe0a0'), reef1: c('#1fc4b4'), reef2: c('#1a8fae'), reefAmt: 1.0,
  },
  evening: {
    hemiSky: c('#f6c7a2'), hemiGround: c('#3a2e2a'), hemi: 0.82,
    sunColor: c('#ff9a4f'), sun: 2.2, sunDir: v3(-0.95, 0.3, 0.2),
    horizon: c('#f0a46d'), zenith: c('#3b5890'), fog: c('#d9a07c'),
    water: c('#25587c'), waterOpacity: 0.76, waterSpec: c('#4a2a14'),
    city: 1.0, coverage: 0.5, glow: 0.75, lighthouse: 1, landmark: 0.35, cityDim: 0.18,
    reef0: c('#58b9a2'), reef1: c('#3a9a9e'), reef2: c('#2a6f8f'), reefAmt: 0.8,
  },
  night: {
    hemiSky: c('#4a6aa0'), hemiGround: c('#1a2234'), hemi: 0.62,
    sunColor: c('#a9bfe8'), sun: 0.5, sunDir: v3(-0.6, 1.1, -0.5),
    horizon: c('#1d2d4c'), zenith: c('#070d20'), fog: c('#17233d'),
    water: c('#0f3150'), waterOpacity: 0.8, waterSpec: c('#1b2a40'),
    city: 1.25, coverage: 1, glow: 1, lighthouse: 1, landmark: 0.6, cityDim: 0.62,
    reef0: c('#1f6f6a'), reef1: c('#195c62'), reef2: c('#14445a'), reefAmt: 0.75,
  },
};

/** 夜景・浅瀬のシェーダが共有する uniform（cities / terrain / landmarks / lighthouses が参照） */
export const TOD_UNIFORMS = {
  uCityLight: { value: 0 }, // 窓の明るさ
  uCityCoverage: { value: 0 }, // 点灯する建物の割合（決定的ハッシュ < coverage で点灯）
  uCityGlow: { value: 0 }, // 街明かりの光点（地形）
  uCityDim: { value: 0 }, // 夜は建物の壁を暗くして窓の灯りを際立たせる
  uLighthouse: { value: 0 },
  uLandmarkGlow: { value: 0 },
  uReef0: { value: new THREE.Color() },
  uReef1: { value: new THREE.Color() },
  uReef2: { value: new THREE.Color() },
  uReefAmt: { value: 1 },
  uTime: { value: 0 },
};

/** 文字列の数値パラメータを補間する */
function lerpLook(out, a, b, t) {
  for (const k of Object.keys(a)) {
    const va = a[k];
    const vb = b[k];
    if (va instanceof THREE.Color) (out[k] ??= new THREE.Color()).copy(va).lerp(vb, t);
    else if (va instanceof THREE.Vector3) (out[k] ??= new THREE.Vector3()).copy(va).lerp(vb, t).normalize();
    else out[k] = va + (vb - va) * t;
  }
  return out;
}
function copyLook(out, a) {
  return lerpLook(out, a, a, 0);
}

export class TimeOfDay {
  /**
   * @param {import('./environment.js').Environment} env
   */
  constructor(env) {
    this.env = env;
    const q = new URLSearchParams(location.search).get('timeMode');
    this.forced = q && MODES.includes(q.toLowerCase()) ? q.toLowerCase() : null;
    this.info = modeAt();
    this.mode = this.forced ?? this.info.mode;
    this.look = copyLook({}, LOOKS[this.mode]);
    this.from = null;
    this.target = this.mode;
    this.t = 1;
    this.checkTimer = 0;
    this.listeners = [];
    this._apply();
  }

  onChange(fn) {
    this.listeners.push(fn);
    fn(this.mode, this);
  }

  /** モードを再判定（30 秒ごと）。変わったら補間を開始 */
  _check() {
    this.info = modeAt();
    const next = this.forced ?? this.info.mode;
    if (next !== this.target) {
      this.from = copyLook({}, this.look);
      this.target = next;
      this.t = 0;
      this.mode = next;
      for (const fn of this.listeners) fn(next, this);
    }
  }

  /** 朝：日出直後の 30 分は夕方と同じ 50% の建物から徐々に消す（暗い時間帯との境界をなめらかに） */
  _morningResidual() {
    if (this.forced || this.target !== 'morning') return 0;
    const s = this.info.sinceSunrise / (30 * 60 * 1000);
    return Math.max(0, 1 - s);
  }

  update(dt) {
    TOD_UNIFORMS.uTime.value += dt;
    this.checkTimer -= dt;
    if (this.checkTimer <= 0) {
      this.checkTimer = 30;
      this._check();
    }
    if (this.t < 1) {
      this.t = Math.min(1, this.t + dt / 4);
      const e = this.t * this.t * (3 - 2 * this.t);
      lerpLook(this.look, this.from, LOOKS[this.target], e);
      this._apply();
    } else if (this._morningResidual() > 0) this._apply();
  }

  _apply() {
    const L = this.look;
    this.env.applyLook(L);
    const res = this._morningResidual();
    TOD_UNIFORMS.uCityLight.value = Math.max(L.city, res * 0.8);
    TOD_UNIFORMS.uCityCoverage.value = Math.max(L.coverage, res * 0.5);
    TOD_UNIFORMS.uCityGlow.value = Math.max(L.glow, res * 0.3);
    TOD_UNIFORMS.uCityDim.value = L.cityDim;
    TOD_UNIFORMS.uLighthouse.value = L.lighthouse;
    TOD_UNIFORMS.uLandmarkGlow.value = L.landmark;
    TOD_UNIFORMS.uReef0.value.copy(L.reef0);
    TOD_UNIFORMS.uReef1.value.copy(L.reef1);
    TOD_UNIFORMS.uReef2.value.copy(L.reef2);
    TOD_UNIFORMS.uReefAmt.value = L.reefAmt;
  }

  /** パネル表示用 */
  describe() {
    const i = this.info;
    return {
      mode: this.mode,
      forced: !!this.forced,
      sunrise: fmtJst(i.sunrise),
      sunset: fmtJst(i.sunset),
      eveningStart: fmtJst(i.eveningStart),
    };
  }
}
