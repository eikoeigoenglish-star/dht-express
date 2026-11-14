/**
 * interior/hologram.js — 【v12】Dining & Lounge のホログラム投影機
 * ---------------------------------------------------------------------------
 * 「古典的な鉄道内装に、やさしい未来技術が混ざっている」程度の装置：
 *   木の胴 + 深緑の帯 + 真鍮の輪 + 葉の紋章。上面のレンズからミント色のやわらかい光の像。
 *
 * モード
 *   signage … 街のサイネージのように SIGNAGE.interval（10 秒）ごとに内容を切り替える（data/signage.js）
 *   stats   … E で切り替え。各動物がリンさんへ「ド変態」と言った回数（data/dohentai.js）
 *
 * 表示（このファイル）とデータ（data/*）は分離。描画は Canvas → CanvasTexture（加算合成の板 1 枚）。
 */
import * as THREE from 'three';
import { cylinder, trs, PartBin } from './kit.js';
import { SIGNAGE } from './data/signage.js';

const MINT = '#a6f3e2';
const AQUA = '#8fdcff';
const GOLD = '#f3d58c';
const CW = 512;
const CH = 352;

export class Hologram {
  /**
   * @param {{ position: THREE.Vector3, mats: Record<string, THREE.Material>, source: import('./data/dohentai.js').DohentaiSource }} o
   */
  constructor(o) {
    this.source = o.source;
    this.data = o.source.last;
    this.mode = 'signage';
    this.slide = 0;
    this.slideT = 0;
    this.t = 0;
    this.fade = 1;
    this.group = new THREE.Group();
    this.group.name = 'hologram-projector';
    this.group.position.copy(o.position);

    // ---- 本体（木 + 深緑 + 真鍮） ----
    const P = new PartBin();
    P.add('woodDark', cylinder(0.36, 0.4, 0.5, 32), trs(0, 0.27, 0));
    P.add('wainscot', cylinder(0.372, 0.395, 0.26, 32, true), trs(0, 0.28, 0));
    for (const y of [0.02, 0.15, 0.41, 0.52]) P.add('brass', new THREE.TorusGeometry(y < 0.3 ? 0.4 : 0.37, 0.014, 8, 40), trs(0, y, 0, Math.PI / 2, 0, 0));
    P.add('woodDark', cylinder(0.33, 0.36, 0.06, 32), trs(0, 0.55, 0));
    P.add('brass', cylinder(0.24, 0.27, 0.03, 32), trs(0, 0.595, 0));
    // 正面（部屋の中央側 = +Z）の葉の紋章
    const em = new THREE.CircleGeometry(0.085, 24);
    P.add('brass', cylinder(0.1, 0.1, 0.012, 24), trs(0, 0.28, 0.392, Math.PI / 2, 0, 0));
    P.add('emblem', em, trs(0, 0.28, 0.4));
    // 小さな操作卓（斜めの画面）
    P.add('woodDark', new THREE.BoxGeometry(0.26, 0.04, 0.18), trs(0.33, 0.5, 0.24, -0.5, -0.6, 0));
    this.body = P.build(o.mats, 'hologram-body');
    this.group.add(this.body);

    // ---- 光（レンズ・光の円錐・像・輪） ----
    const add = (c, op) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    this.lens = new THREE.Mesh(new THREE.CircleGeometry(0.2, 32), add(MINT, 0.9));
    this.lens.rotation.x = -Math.PI / 2;
    this.lens.position.y = 0.613;
    this.cone = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.17, 0.62, 32, 1, true), add(MINT, 0.07));
    this.cone.position.y = 0.93;
    this.ringA = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.006, 6, 64), add(AQUA, 0.55));
    this.ringA.position.y = 0.98;
    this.ringB = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.004, 6, 48), add(GOLD, 0.45));
    this.ringB.position.y = 1.62;
    this.tabletScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.14), add(AQUA, 0.6));
    this.tabletScreen.position.set(0.33, 0.525, 0.24);
    this.tabletScreen.rotation.set(-Math.PI / 2 + 0.5, 0, 0.6);
    // 像（Canvas）
    this.canvas = document.createElement('canvas');
    this.canvas.width = CW;
    this.canvas.height = CH;
    this.ctx = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.screenMat = add('#ffffff', 1);
    this.screenMat.map = this.tex;
    this.screen = new THREE.Mesh(new THREE.PlaneGeometry(1.06, 1.06 * (CH / CW)), this.screenMat);
    this.screen.position.y = 1.32;
    this.screenPivot = new THREE.Group();
    this.screenPivot.add(this.screen);
    for (const m of [this.lens, this.cone, this.ringA, this.ringB, this.tabletScreen]) m.renderOrder = 6;
    this.screen.renderOrder = 7;
    this.group.add(this.lens, this.cone, this.ringA, this.ringB, this.tabletScreen, this.screenPivot);
    this._draw();
  }

  /** 葉っぱが話しかける位置・「E：調べる」を出す位置 */
  get anchor() {
    return new THREE.Vector3(this.group.position.x, 0, this.group.position.z + 0.15);
  }
  get head() {
    return new THREE.Vector3(this.group.position.x, 1.95, this.group.position.z);
  }

  setMode(mode) {
    if (this.mode === mode) return;
    this.mode = mode;
    this.fade = 0;
    this._draw();
  }

  setData(d) {
    this.data = d;
    this._draw();
  }

  /** @param {THREE.Camera} camera */
  update(dt, camera) {
    this.t += dt;
    if (this.mode === 'signage') {
      this.slideT += dt;
      if (this.slideT >= SIGNAGE.interval) {
        this.slideT = 0;
        this.slide = (this.slide + 1) % SIGNAGE.slides.length;
        this.fade = 0;
        this._draw();
      } else if (Math.floor(this.t * 2) !== this._tick) {
        this._tick = Math.floor(this.t * 2);
        this._draw(); // 時計・進行バー
      }
    }
    // 切替時のやわらかいフェード + ゆらぎ
    this.fade = Math.min(1, this.fade + dt * 2.5);
    const flicker = 0.92 + Math.sin(this.t * 13) * 0.03 + Math.sin(this.t * 37) * 0.02;
    this.screenMat.opacity = this.fade * flicker;
    this.screen.position.y = 1.32 + Math.sin(this.t * 1.3) * 0.012;
    this.ringA.rotation.z = this.t * 0.4;
    this.ringA.rotation.x = Math.PI / 2 + Math.sin(this.t * 0.7) * 0.08;
    this.ringB.rotation.x = Math.PI / 2;
    this.ringB.rotation.z = -this.t * 0.6;
    this.cone.material.opacity = 0.06 + Math.sin(this.t * 2) * 0.012;
    // 像は見る人の方へゆっくり向く（Y 軸だけ）
    if (camera) {
      const p = this.group.position;
      const want = Math.atan2(camera.position.x - p.x, camera.position.z - p.z);
      const d = Math.atan2(Math.sin(want - this.screenPivot.rotation.y), Math.cos(want - this.screenPivot.rotation.y));
      this.screenPivot.rotation.y += d * (1 - Math.exp(-dt * 3));
    }
  }

  /* ------------------------------------------------------------------ */
  /* 描画                                                                */
  /* ------------------------------------------------------------------ */
  _draw() {
    const g = this.ctx;
    g.clearRect(0, 0, CW, CH);
    g.save();
    // 枠（角の真鍮色のかぎ・細い線）
    g.strokeStyle = 'rgba(166,243,226,0.55)';
    g.lineWidth = 2;
    g.strokeRect(10, 10, CW - 20, CH - 20);
    g.strokeStyle = GOLD;
    g.lineWidth = 3;
    for (const [x, y, sx, sy] of [[10, 10, 1, 1], [CW - 10, 10, -1, 1], [10, CH - 10, 1, -1], [CW - 10, CH - 10, -1, -1]]) {
      g.beginPath();
      g.moveTo(x, y + sy * 26);
      g.lineTo(x, y);
      g.lineTo(x + sx * 26, y);
      g.stroke();
    }
    // 走査線
    g.fillStyle = 'rgba(166,243,226,0.05)';
    for (let y = 14; y < CH - 14; y += 4) g.fillRect(12, y, CW - 24, 1);
    if (this.mode === 'stats') this._drawStats(g);
    else {
      const s = SIGNAGE.slides[this.slide];
      (this[`_slide_${s.kind}`] ?? this._slide_brand).call(this, g, s);
      // 進行（ページの点 + 10 秒のバー）
      const n = SIGNAGE.slides.length;
      for (let i = 0; i < n; i++) {
        g.fillStyle = i === this.slide ? MINT : 'rgba(166,243,226,0.3)';
        g.beginPath();
        g.arc(CW / 2 - (n - 1) * 9 + i * 18, CH - 30, 4, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = 'rgba(166,243,226,0.25)';
      g.fillRect(40, CH - 20, CW - 80, 2);
      g.fillStyle = GOLD;
      g.fillRect(40, CH - 20, (CW - 80) * Math.min(1, this.slideT / SIGNAGE.interval), 2);
    }
    g.restore();
    this.tex.needsUpdate = true;
  }

  _font(w, px) {
    return `${w} ${px}px "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic UI", sans-serif`;
  }

  _title(g, text, sub) {
    g.fillStyle = GOLD;
    g.font = `700 13px ui-monospace, Menlo, monospace`;
    g.textAlign = 'left';
    g.fillText('FOREST SCHOOL EXPRESS', 34, 44);
    g.fillStyle = MINT;
    g.font = this._font(700, 30);
    g.fillText(text, 34, 82);
    if (sub) {
      g.font = this._font(500, 15);
      g.fillStyle = AQUA;
      g.fillText(sub, 34, 106);
    }
  }

  _leaf(g, x, y, s, col = MINT) {
    g.save();
    g.translate(x, y);
    g.strokeStyle = col;
    g.fillStyle = 'rgba(166,243,226,0.18)';
    g.lineWidth = 2.2;
    for (const [a, k] of [[0, 1], [-0.75, 0.75], [0.75, 0.75]]) {
      g.save();
      g.rotate(a);
      g.beginPath();
      g.ellipse(0, -s * 0.5 * k, s * 0.2 * k, s * 0.5 * k, 0, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.restore();
    }
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(0, s * 0.45);
    g.stroke();
    g.restore();
  }

  _slide_brand(g, s) {
    this._leaf(g, CW / 2, 150, 92);
    g.textAlign = 'center';
    g.fillStyle = MINT;
    g.font = `700 30px Georgia, "Times New Roman", serif`;
    g.fillText(s.title, CW / 2, 232);
    g.font = this._font(500, 17);
    g.fillStyle = AQUA;
    g.fillText(s.sub, CW / 2, 262);
    const d = new Date();
    g.font = `700 18px ui-monospace, Menlo, monospace`;
    g.fillStyle = GOLD;
    g.fillText(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`, CW / 2, 292);
  }

  _slide_guide(g, s) {
    this._title(g, s.title, '← 先頭　　　　　　　　　　　　　最後部 →');
    const cars = s.cars;
    const x0 = 30;
    const w = CW - 60;
    const y = 140;
    const ws = cars.map((c) => (c.id === 'lounge' ? 1.6 : c.id === 'crew' ? 0.6 : 1));
    const tot = ws.reduce((a, b) => a + b, 0);
    let x = x0;
    g.textAlign = 'center';
    cars.forEach((c, i) => {
      const cw = (w * ws[i]) / tot - 6;
      const here = c.note === '現在地';
      g.strokeStyle = here ? GOLD : MINT;
      g.lineWidth = here ? 3 : 2;
      g.fillStyle = here ? 'rgba(243,213,140,0.18)' : 'rgba(166,243,226,0.1)';
      g.beginPath();
      g.roundRect(x, y, cw, 74, 10);
      g.fill();
      g.stroke();
      g.fillStyle = here ? GOLD : MINT;
      g.font = this._font(700, c.label.length > 8 ? 13 : 15);
      g.fillText(c.label, x + cw / 2, y + 32);
      if (c.note) {
        g.font = this._font(500, 12);
        g.fillStyle = AQUA;
        g.fillText(c.note, x + cw / 2, y + 54);
      }
      x += cw + 6;
    });
    g.strokeStyle = 'rgba(166,243,226,0.5)';
    g.setLineDash([6, 6]);
    g.beginPath();
    g.moveTo(x0, y + 100);
    g.lineTo(x0 + w, y + 100);
    g.stroke();
    g.setLineDash([]);
    g.font = this._font(500, 13);
    g.fillStyle = AQUA;
    g.fillText('廊下（左舷側）── Room 1〜3 ── Dining & Lounge', CW / 2, y + 126);
  }

  _slide_news(g, s) {
    this._title(g, s.title);
    g.textAlign = 'left';
    s.items.forEach((t, i) => {
      const y = 140 + i * 54;
      g.fillStyle = GOLD;
      g.beginPath();
      g.arc(42, y - 6, 4, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = MINT;
      g.font = this._font(500, 16);
      this._wrap(g, t, 56, y, CW - 90, 21);
    });
  }

  _slide_ranking(g, s) {
    this._title(g, s.title, `各動物が${this.data.target}へ「ド変態」と言った回数${this.data.isMock ? '（仮）' : ''}`);
    this._bars(g, this.data.entries.slice(0, 3), 130, 52, true);
    g.textAlign = 'right';
    g.font = this._font(500, 12);
    g.fillStyle = AQUA;
    g.fillText('近づいて E：すべての記録を見る', CW - 34, CH - 44);
  }

  _drawStats(g) {
    this._title(g, 'ド変態カウンター', `${this.data.target}への「ド変態」の回数${this.data.isMock ? '（仮データ）' : ''}`);
    this._bars(g, this.data.entries, 122, 26, false);
  }

  _bars(g, rows, y0, step, big) {
    const max = Math.max(1, ...rows.map((r) => r.count));
    const labelW = big ? 150 : 120;
    rows.forEach((r, i) => {
      const y = y0 + i * step;
      g.textAlign = 'left';
      g.font = this._font(700, big ? 18 : 14);
      g.fillStyle = i === 0 ? GOLD : MINT;
      g.fillText(`${i + 1}. ${r.name}`, 34, y + (big ? 20 : 15));
      const bw = (CW - 34 - labelW - 80) * (r.count / max);
      g.fillStyle = i === 0 ? 'rgba(243,213,140,0.55)' : 'rgba(166,243,226,0.4)';
      g.fillRect(34 + labelW, y + 4, bw, big ? 22 : 15);
      g.textAlign = 'right';
      g.fillStyle = i === 0 ? GOLD : MINT;
      g.font = `700 ${big ? 18 : 14}px ui-monospace, Menlo, monospace`;
      g.fillText(`${r.count}`, CW - 34, y + (big ? 20 : 15));
    });
  }

  _wrap(g, text, x, y, w, lh) {
    let line = '';
    let yy = y;
    for (const ch of text) {
      if (g.measureText(line + ch).width > w) {
        g.fillText(line, x, yy);
        line = ch;
        yy += lh;
      } else line += ch;
    }
    g.fillText(line, x, yy);
  }

  dispose() {
    this.tex.dispose();
    for (const m of [this.lens, this.cone, this.ringA, this.ringB, this.tabletScreen, this.screen]) {
      m.geometry.dispose();
      m.material.dispose();
    }
    this.body.traverse((o) => o.isMesh && o.geometry.dispose()); // マテリアルは車内と共有
  }
}
