/**
 * ui.js — 最小限の HUD（モード切替・プリセット・操作説明・情報表示）
 * 3D 側のロジックは持たず、main.js から渡されたコールバックを呼ぶだけ。
 *
 * v9: 3D 世界を主役にするため、通常時の表示を最小限に。
 *   ・左上はアイコンだけ（新幹線 = 列車を追跡 / 船 = 船を追跡 / 地図 = MAP VIEW / 目玉 = EXPLORE VIEW）
 *   ・CAMERA（6 件）と CONTROLS は折りたたみ（通常は閉じる）
 *   ・開発者向けの数値パネルは ?debug=1 または I キーのときだけ
 */
import { formatLatLon, worldToLatLon } from './geo.js';

export class UI {
  /**
   * @param {{ presets: Array, onMode: (m:string)=>void, onPreset: (p:object)=>void, onToggleLabels: ()=>boolean }} opts
   */
  constructor(opts) {
    this.opts = opts;
    this.$ = (id) => document.getElementById(id);
    this.fpsFrames = 0;
    this.fpsTime = 0;
    this.fps = 0;

    this.mode = null;
    this.vehicleKind = 'train';
    document.querySelectorAll('.mode').forEach((b) =>
      b.addEventListener('click', () => {
        b.blur();
        // 新幹線・船のアイコン → VEHICLE VIEW でその乗り物を追跡
        if (b.dataset.vehicle) opts.onVehicle?.(b.dataset.vehicle);
        else opts.onMode(b.dataset.mode);
      }),
    );

    // CAMERA：通常は「CAMERA ▼」だけ。開くと 6 件（opts.presets は表示する分だけ渡される）
    const list = this.$('preset-list');
    opts.presets.forEach((p) => {
      const b = document.createElement('button');
      b.className = 'preset';
      b.dataset.id = p.id;
      b.textContent = p.label;
      b.addEventListener('click', () => {
        b.blur();
        opts.onPreset(p);
        this.setFold('presets', false); // 選んだら閉じて景色を広く
      });
      list.appendChild(b);
    });
    this.$('presets-toggle').addEventListener('click', (e) => {
      e.currentTarget.blur();
      this.setFold('presets');
    });

    // CONTROLS：通常は「CONTROLS ▼」だけ。開くと今のモードの操作説明
    const toggleHelp = () => this.setFold('help');
    this.$('help-toggle').addEventListener('click', (e) => {
      e.currentTarget.blur();
      toggleHelp();
    });

    // 開発者向け：?debug=1 で数値パネルと進捗パネルの詳細（API 方式・時間帯など）を表示
    this.debug = new URLSearchParams(location.search).get('debug') === '1';
    document.body.classList.toggle('debug', this.debug);
    if (this.debug) this.$('info').classList.remove('is-hidden');

    addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.repeat) return;
      switch (e.code) {
        case 'Digit1':
        case 'Numpad1':
          opts.onMode('map');
          break;
        case 'Digit2':
        case 'Numpad2':
          opts.onMode('explore');
          break;
        case 'Digit3': // v8: VEHICLE VIEW
        case 'Numpad3':
          opts.onMode('vehicle');
          break;
        case 'KeyH':
          toggleHelp();
          break;
        case 'KeyI':
          this.$('info').classList.toggle('is-hidden');
          break;
        case 'KeyL':
          opts.onToggleLabels();
          break;
        case 'KeyB':
          opts.onToggleCity?.();
          break;
        case 'KeyR': // v5: DHT EXPRESS ルート（線・ノード・ラベル）の表示 ON/OFF
          opts.onToggleRoute?.();
          break;
      }
    });
  }

  /** 折りたたみ（id: 'presets' | 'help'）。open を省略すると切り替え */
  setFold(id, open) {
    const el = this.$(id);
    const on = open ?? !el.classList.contains('is-open');
    el.classList.toggle('is-open', on);
    const head = el.querySelector('.fold__head');
    head.setAttribute('aria-expanded', on);
    head.querySelector('.fold__arrow').textContent = on ? '▲' : '▼';
  }

  setMode(mode) {
    this.mode = mode;
    document.body.classList.toggle('mode-explore', mode === 'explore');
    document.body.classList.toggle('mode-map', mode === 'map');
    document.body.classList.toggle('mode-vehicle', mode === 'vehicle'); // v8
    this._paintModes();
  }

  /** v9: VEHICLE VIEW で今追っている乗り物（'train' | 'ship'）。左上のアイコンの明るさに反映 */
  setVehicleKind(kind) {
    if (!kind || kind === this.vehicleKind) return;
    this.vehicleKind = kind;
    this._paintModes();
  }

  _paintModes() {
    document.querySelectorAll('.mode').forEach((b) => {
      const on = b.dataset.mode === this.mode && (!b.dataset.vehicle || b.dataset.vehicle === this.vehicleKind);
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', on);
    });
  }

  setLocked(locked) {
    document.body.classList.toggle('is-locked', locked);
  }

  setActivePreset(id) {
    document.querySelectorAll('.preset').forEach((b) => b.classList.toggle('is-active', b.dataset.id === id));
  }

  loaded() {
    this.$('loading').classList.add('is-done');
  }

  error(msg) {
    const l = this.$('loading');
    l.classList.add('is-error');
    l.querySelector('p').textContent = msg;
  }

  /** 情報表示（4Hz 程度で十分） */
  tick(dt, { renderer, camera, terrain, speed, cities, labels }) {
    this.fpsFrames++;
    this.fpsTime += dt;
    if (this.fpsTime < 0.25) return;
    this.fps = this.fpsFrames / this.fpsTime;
    this.fpsFrames = 0;
    this.fpsTime = 0;
    if (this.$('info').classList.contains('is-hidden')) return;
    const info = renderer.info.render;
    const p = camera.position;
    const ll = worldToLatLon(p.x, p.z);
    const ground = terrain.getSurfaceY(p.x, p.z);
    this.$('r-fps').textContent = this.fps.toFixed(0);
    this.$('r-draw').textContent = info.calls;
    this.$('r-tris').textContent = (info.triangles / 1000).toFixed(0) + 'k';
    const s = terrain.stats;
    this.$('r-tiles').textContent = `${s.coarseVisible}+${s.hiVisible}`;
    if (cities) {
      const c = cities.stats;
      this.$('r-city').textContent = cities.visible ? `${(c.instancesDrawn / 1000).toFixed(1)}k / ${c.chunksVisible}` : 'OFF';
    }
    this.$('r-pos').textContent = formatLatLon(ll.lat, ll.lon);
    // 対地高度（ワールド単位 = km。地形の標高誇張とは独立した“カメラの高さ”）
    const agl = p.y - ground;
    this.$('r-alt').textContent = agl < 1 ? `${(agl * 1000).toFixed(0)} m` : `${agl.toFixed(agl < 100 ? 1 : 0)} km`;
    // v10: ラベルの表示数と高度による表示距離
    if (labels) this.$('r-lab').textContent = `${labels.stats.shown} / ${labels.stats.rangeKm} km`;
    // v3: 飛空艇の水平速度（通常 30,000 / Shift 90,000 km/h、停止中 0）
    if (speed != null) this.$('r-spd').textContent = `${Math.round(speed * 3600).toLocaleString('en-US')} km/h`;
  }
}
