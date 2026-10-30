/**
 * ui.js — 最小限の HUD（モード切替・プリセット・操作説明・情報表示）
 * 3D 側のロジックは持たず、main.js から渡されたコールバックを呼ぶだけ。
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

    document.querySelectorAll('.mode').forEach((b) =>
      b.addEventListener('click', () => {
        b.blur();
        opts.onMode(b.dataset.mode);
      }),
    );

    const list = this.$('preset-list');
    const sel = this.$('preset-select');
    opts.presets.forEach((p, i) => {
      const b = document.createElement('button');
      b.className = 'preset';
      b.dataset.id = p.id;
      b.innerHTML = `<span>${p.label}</span><small>${String(i + 1).padStart(2, '0')}</small>`;
      b.addEventListener('click', () => {
        b.blur();
        opts.onPreset(p);
      });
      list.appendChild(b);
      const o = document.createElement('option');
      o.value = p.id;
      o.textContent = p.label;
      sel.appendChild(o);
    });
    sel.addEventListener('change', () => {
      const p = opts.presets.find((x) => x.id === sel.value);
      if (p) opts.onPreset(p);
      sel.blur();
    });

    const help = this.$('help');
    const toggleHelp = () => {
      help.classList.toggle('is-collapsed');
      this.$('help-toggle').textContent = help.classList.contains('is-collapsed') ? '表示' : '隠す';
    };
    this.$('help-toggle').addEventListener('click', toggleHelp);

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
        case 'KeyH':
          toggleHelp();
          break;
        case 'KeyI':
          this.$('info').classList.toggle('is-hidden');
          break;
        case 'KeyL':
          opts.onToggleLabels();
          break;
      }
    });
  }

  setMode(mode) {
    document.body.classList.toggle('mode-explore', mode === 'explore');
    document.body.classList.toggle('mode-map', mode === 'map');
    document.querySelectorAll('.mode').forEach((b) => {
      const on = b.dataset.mode === mode;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', on);
    });
  }

  setLocked(locked) {
    document.body.classList.toggle('is-locked', locked);
  }

  setActivePreset(id) {
    document.querySelectorAll('.preset').forEach((b) => b.classList.toggle('is-active', b.dataset.id === id));
    this.$('preset-select').value = id ?? '';
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
  tick(dt, { renderer, camera, terrain, speed }) {
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
    this.$('r-pos').textContent = formatLatLon(ll.lat, ll.lon);
    // 対地高度（ワールド単位 = km。地形の標高誇張とは独立した“カメラの高さ”）
    const agl = p.y - ground;
    this.$('r-alt').textContent = agl < 1 ? `${(agl * 1000).toFixed(0)} m` : `${agl.toFixed(agl < 100 ? 1 : 0)} km`;
    if (speed != null) this.$('r-spd').textContent = `${(speed * 3600).toFixed(0)} km/h`;
  }
}
