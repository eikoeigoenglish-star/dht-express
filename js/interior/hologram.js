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
/** 【v14.1】像の大きさ（v14 までの 1.06 m 幅の 1.4 倍）。下端の高さは据え置き（光の輪 0.98 m のすぐ上） */
const SCREEN_SCALE = 1.4;
const SCREEN_W = 1.06 * SCREEN_SCALE;
const SCREEN_H = SCREEN_W * (CH / CW);
const SCREEN_Y = 0.956 + SCREEN_H / 2; // 像の中心の高さ（v14 までは 1.32）
/** Canvas の解像度の倍率（像を大きくしても文字がにじまないよう 2 倍で描く。描画の座標は CW × CH のまま） */
const RES = 2;

export class Hologram {
  /**
   * @param {{ position: THREE.Vector3, mats: Record<string, THREE.Material>, source: import('./data/dohentai.js').DohentaiSource, signage?: typeof SIGNAGE }} o
   *   signage … 【v17】表示データ（data/signage.js の signageFor(kind)。省略 = 列車）
   */
  constructor(o) {
    this.source = o.source;
    this.data = o.source.last;
    // 【v17】表示データ（列車／船で案内図・News が違う）。部品と描画は共用
    this.signage = o.signage ?? SIGNAGE;
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
    this.cone = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.17, 0.62, 32, 1, true), add(MINT, 0.07));
    this.cone.position.y = 0.93;
    this.ringA = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.006, 6, 64), add(AQUA, 0.55));
    this.ringA.position.y = 0.98;
    this.ringB = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.004, 6, 48), add(GOLD, 0.45));
    this.ringB.position.y = SCREEN_Y + SCREEN_H * 0.41; // 像の上の方（v14 までは 1.62）
    this.tabletScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.14), add(AQUA, 0.6));
    this.tabletScreen.position.set(0.33, 0.525, 0.24);
    this.tabletScreen.rotation.set(-Math.PI / 2 + 0.5, 0, 0.6);
    // 像（Canvas）
    this.canvas = document.createElement('canvas');
    this.canvas.width = CW * RES;
    this.canvas.height = CH * RES;
    this.ctx = this.canvas.getContext('2d');
    this.ctx.scale(RES, RES);
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.screenMat = add('#ffffff', 1);
    this.screenMat.map = this.tex;
    this.screen = new THREE.Mesh(new THREE.PlaneGeometry(SCREEN_W, SCREEN_H), this.screenMat);
    this.screen.position.y = SCREEN_Y;
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
    return new THREE.Vector3(this.group.position.x, SCREEN_Y + SCREEN_H / 2 + 0.17, this.group.position.z); // 像の上端の少し上
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

  /**
   * @param {THREE.Camera} camera
   * @param {boolean} [visible] 【v13】false（ラウンジが見えていない）なら時刻・スライドだけ進め、
   *   Canvas の描き直しとテクスチャの転送（0.5 秒ごと）はしない。見えるようになった時点で描き直す。
   */
  update(dt, camera, visible = true) {
    this.t += dt;
    if (this.mode === 'signage') {
      this.slideT += dt;
      if (this.slideT >= this.signage.interval) {
        this.slideT = 0;
        this.slide = (this.slide + 1) % this.signage.slides.length;
        this.fade = 0;
        this._dirty = true;
      } else if (Math.floor(this.t * 2) !== this._tick) {
        this._tick = Math.floor(this.t * 2);
        this._dirty = true; // 時計・進行バー
      }
    }
    if (!visible) return;
    if (this._dirty) {
      this._dirty = false;
      this._draw();
    }
    // 切替時のやわらかいフェード + ゆらぎ
    this.fade = Math.min(1, this.fade + dt * 2.5);
    const flicker = 0.92 + Math.sin(this.t * 13) * 0.03 + Math.sin(this.t * 37) * 0.02;
    this.screenMat.opacity = this.fade * flicker;
    this.screen.position.y = SCREEN_Y + Math.sin(this.t * 1.3) * 0.012;
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
      const s = this.signage.slides[this.slide];
      (this[`_slide_${s.kind}`] ?? this._slide_brand).call(this, g, s);
      // 進行（ページの点 + 10 秒のバー）
      const n = this.signage.slides.length;
      for (let i = 0; i < n; i++) {
        g.fillStyle = i === this.slide ? MINT : 'rgba(166,243,226,0.3)';
        g.beginPath();
        g.arc(CW / 2 - (n - 1) * 9 + i * 18, CH - 30, 4, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = 'rgba(166,243,226,0.25)';
      g.fillRect(40, CH - 20, CW - 80, 2);
      g.fillStyle = GOLD;
      g.fillRect(40, CH - 20, (CW - 80) * Math.min(1, this.slideT / this.signage.interval), 2);
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

  /**
   * 【v17】案内図：見取り図（data/signage.js の plan）をそのまま枠に収めて描く。
   *   v16 までは車両を横一列の箱で並べるだけで、View Room・船の Room 4・Aft Observation Deck などを表せなかった。
   *   線・色・書体は既存のスライドと同じ（ミントの線、現在地は金、注記はアクア）。
   */
  _slide_guide(g, s) {
    this._title(g, s.title);
    // 進行方向（左 = 先頭／船首）
    g.font = this._font(500, 14);
    g.fillStyle = AQUA;
    g.textAlign = 'left';
    g.fillText(s.dir?.[0] ?? '← 先頭', 34, 106);
    g.textAlign = 'right';
    g.fillText(s.dir?.[1] ?? '最後部 →', CW - 34, 106);
    const P = s.plan;
    if (!P) return;
    // 枠：x 30〜482、y 120〜（凡例の上）
    const bx = 30;
    const bw = CW - 60;
    const by = 120;
    const bh = 162;
    const sx = bw / P.w;
    const sy = Math.min(sx * (P.stretchY ?? 1), bh / P.h);
    const oy = by + (bh - P.h * sy) / 2;
    const X = (v) => bx + v * sx;
    const Y = (v) => oy + v * sy;
    const pathOf = (a) => {
      g.beginPath();
      if (a.poly) a.poly.forEach(([px, py], i) => (i ? g.lineTo(X(px), Y(py)) : g.moveTo(X(px), Y(py))));
      else g.rect(X(a.x), Y(a.y), a.w * sx, a.h * sy);
      g.closePath();
    };
    // 下地 → 廊下・デッキ → 部屋 → 階段 の順に重ねる
    const order = { balcony: 0, corridor: 1, deck: 2, room: 3, stair: 4 };
    const areas = [...P.areas].sort((p, q) => (order[p.type] ?? 3) - (order[q.type] ?? 3));
    for (const a of areas) {
      const here = a.note === '現在地';
      pathOf(a);
      if (a.type === 'balcony') {
        g.fillStyle = 'rgba(166,243,226,0.05)';
        g.fill();
        g.setLineDash([4, 3]);
        g.strokeStyle = 'rgba(166,243,226,0.6)';
        g.lineWidth = 1.2;
        g.stroke();
        g.setLineDash([]);
        continue;
      }
      if (a.type === 'stair') {
        g.fillStyle = 'rgba(166,243,226,0.16)';
        g.fill();
        g.strokeStyle = MINT;
        g.lineWidth = 1.4;
        g.stroke();
        // 段の線（▤）
        g.save();
        g.clip();
        g.strokeStyle = 'rgba(166,243,226,0.75)';
        g.lineWidth = 1;
        const n = 4;
        for (let i = 1; i < n; i++) {
          g.beginPath();
          g.moveTo(X(a.x) + (a.w * sx * i) / n, Y(a.y));
          g.lineTo(X(a.x) + (a.w * sx * i) / n, Y(a.y + a.h));
          g.stroke();
        }
        g.restore();
        continue;
      }
      if (a.type === 'corridor') {
        g.fillStyle = 'rgba(143,220,255,0.08)';
        g.fill();
        g.strokeStyle = 'rgba(166,243,226,0.55)';
        g.lineWidth = 1.4;
        g.stroke();
      } else if (a.type === 'deck') {
        g.fillStyle = 'rgba(143,220,255,0.1)';
        g.fill();
        g.setLineDash([7, 4]);
        g.strokeStyle = MINT;
        g.lineWidth = 2;
        g.stroke();
        g.setLineDash([]);
      } else {
        g.fillStyle = here ? 'rgba(243,213,140,0.2)' : 'rgba(166,243,226,0.1)';
        g.fill();
        g.strokeStyle = here ? GOLD : MINT;
        g.lineWidth = here ? 3 : 2;
        g.stroke();
      }
    }
    // 名前と注記（部屋の中央。小さい部屋は文字を小さく）
    g.textAlign = 'center';
    for (const a of areas) {
      if (!a.label) continue;
      const here = a.note === '現在地';
      const lines = Array.isArray(a.label) ? a.label : [a.label];
      let cx;
      let cy;
      let wpx;
      if (a.labelAt) {
        cx = X(a.labelAt[0]);
        cy = Y(a.labelAt[1]);
        wpx = 200;
      } else {
        cx = X(a.x + a.w / 2);
        cy = Y(a.y + a.h / 2);
        wpx = a.w * sx;
      }
      if (a.type === 'corridor') {
        g.font = this._font(500, 11);
        g.fillStyle = AQUA;
        g.fillText(lines[0], cx, cy + 4);
        continue;
      }
      let px = 15;
      const longest = Math.max(...lines.map((t) => t.length));
      while (px > 10 && longest * px * 0.62 > wpx - 10) px--;
      const lh = px + 2;
      const noteH = a.note ? 15 : 0;
      let y = cy - ((lines.length - 1) * lh + noteH) / 2 + px * 0.36;
      g.font = this._font(700, px);
      g.fillStyle = here ? GOLD : MINT;
      for (const t of lines) {
        g.fillText(t, cx, y);
        y += lh;
      }
      if (a.note) {
        g.font = this._font(500, 11);
        g.fillStyle = here ? GOLD : AQUA;
        g.fillText(a.note, cx, y + 1);
      }
    }
    if (s.legend) {
      g.font = this._font(500, 11);
      g.fillStyle = AQUA;
      g.textAlign = 'center';
      g.fillText(s.legend, CW / 2, by + bh + 16);
    }
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

  /** 【v14】車内 CM：スポンサー名・新発売の品・「リンさんだけ」の特典（右に線画のアイコン） */
  _slide_cm(g, s) {
    g.textAlign = 'left';
    g.fillStyle = GOLD;
    g.font = `700 13px ui-monospace, Menlo, monospace`;
    g.fillText('FOREST SCHOOL EXPRESS · CM', 34, 44);
    g.fillStyle = MINT;
    g.font = this._font(700, s.sponsor.length > 8 ? 26 : 30);
    g.fillText(s.sponsor, 34, 82);
    // 新発売の品（金の小さな帯）
    g.font = this._font(700, 18);
    const pw = g.measureText(s.product).width + 24;
    g.fillStyle = 'rgba(243,213,140,0.16)';
    g.strokeStyle = GOLD;
    g.lineWidth = 1.5;
    g.beginPath();
    g.roundRect(34, 96, pw, 30, 15);
    g.fill();
    g.stroke();
    g.fillStyle = GOLD;
    g.fillText(s.product, 46, 118);
    if (s.sub) {
      g.font = this._font(500, 14);
      g.fillStyle = AQUA;
      g.fillText(s.sub, 34, 150);
    }
    this._cmIcon(g, s.icon, CW - 104, 112);
    // 特典の枠（リンさんだけ）
    const bx = 34;
    const by = 170;
    const bw = CW - 68;
    const lines = s.offer ?? [];
    const bh = 34 + lines.length * 32;
    g.fillStyle = 'rgba(166,243,226,0.1)';
    g.strokeStyle = MINT;
    g.lineWidth = 2;
    g.beginPath();
    g.roundRect(bx, by, bw, bh, 12);
    g.fill();
    g.stroke();
    g.font = this._font(700, 14);
    const lw = g.measureText(s.offerLabel).width + 20;
    g.fillStyle = GOLD;
    g.beginPath();
    g.roundRect(bx + 14, by - 11, lw, 24, 12);
    g.fill();
    g.fillStyle = '#123430';
    g.fillText(s.offerLabel, bx + 24, by + 6);
    g.fillStyle = MINT;
    lines.forEach((t, i) => {
      // 枠に収まる大きさで（長い行は少し小さく）
      let px = 24;
      g.font = this._font(700, px);
      while (g.measureText(t).width > bw - 40 && px > 16) g.font = this._font(700, --px);
      g.fillText(t, bx + 20, by + 44 + i * 32);
    });
  }

  /** CM の線画アイコン（ホログラムらしく線と淡い塗りだけ） */
  _cmIcon(g, kind, x, y) {
    g.save();
    g.translate(x, y);
    g.strokeStyle = MINT;
    g.fillStyle = 'rgba(166,243,226,0.16)';
    g.lineWidth = 2.4;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    const steam = (xs, y0) => {
      g.strokeStyle = AQUA;
      for (const sx of xs) {
        g.beginPath();
        g.moveTo(sx, y0);
        g.bezierCurveTo(sx - 8, y0 - 10, sx + 8, y0 - 18, sx, y0 - 30);
        g.stroke();
      }
      g.strokeStyle = MINT;
    };
    if (kind === 'bowl') {
      // どんぶり + 湯気 + 唐辛子
      g.beginPath();
      g.moveTo(-46, 4);
      g.lineTo(46, 4);
      g.bezierCurveTo(44, 38, 22, 50, 0, 50);
      g.bezierCurveTo(-22, 50, -44, 38, -46, 4);
      g.fill();
      g.stroke();
      g.beginPath();
      g.moveTo(-16, 52);
      g.lineTo(16, 52);
      g.stroke();
      steam([-18, 0, 18], -4);
      g.strokeStyle = GOLD;
      g.beginPath();
      g.moveTo(30, -2);
      g.quadraticCurveTo(48, -14, 54, -36);
      g.stroke();
      g.beginPath();
      g.moveTo(54, -36);
      g.lineTo(58, -44);
      g.stroke();
    } else if (kind === 'soft') {
      // ソフトクリーム（渦 3 段 + コーン）
      g.beginPath();
      g.moveTo(-20, 8);
      g.lineTo(0, 56);
      g.lineTo(20, 8);
      g.closePath();
      g.fill();
      g.stroke();
      g.beginPath();
      g.moveTo(-10, 18);
      g.lineTo(6, 34);
      g.moveTo(10, 18);
      g.lineTo(-4, 32);
      g.stroke();
      for (const [w, yy] of [[30, 2], [24, -16], [16, -32]]) {
        g.beginPath();
        g.ellipse(0, yy, w, 11, 0, 0, Math.PI * 2);
        g.fill();
        g.stroke();
      }
      g.beginPath();
      g.moveTo(0, -42);
      g.quadraticCurveTo(4, -52, -2, -58);
      g.stroke();
    } else {
      // カレー皿（ごはんの丘 + ルウ + スプーン）
      g.beginPath();
      g.ellipse(0, 24, 56, 18, 0, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.beginPath();
      g.ellipse(0, 20, 44, 12, 0, 0, Math.PI * 2);
      g.stroke();
      g.beginPath();
      g.moveTo(-34, 18);
      g.bezierCurveTo(-30, -6, -6, -8, 2, 12);
      g.stroke();
      g.strokeStyle = GOLD;
      g.beginPath();
      g.ellipse(18, 16, 4, 6, 0.6, 0, Math.PI * 2);
      g.stroke();
      g.beginPath();
      g.moveTo(22, 10);
      g.lineTo(26, 4);
      g.stroke();
      g.strokeStyle = MINT;
      g.beginPath();
      g.moveTo(40, -2);
      g.lineTo(62, -30);
      g.stroke();
      g.beginPath();
      g.ellipse(38, 2, 6, 9, 0.65, 0, Math.PI * 2);
      g.stroke();
      steam([-14, 4], 2);
    }
    g.restore();
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
