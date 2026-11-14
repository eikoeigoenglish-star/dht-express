/**
 * interior/textures.js — 【v11】室内用の手続きテクスチャ（Canvas 2D・外部画像なし）
 * ---------------------------------------------------------------------------
 * すべて 512px 以下。木目・布・絨毯・腰壁・テーブルクロス・額の絵・ドアの曇りガラスなど。
 * UV はメートル単位なので、tile（1 枚が何 m か）を userData.tile に持たせ repeat を合わせる。
 */
import * as THREE from 'three';
import { rng } from './kit.js';

function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function tex(c, tile = 1, { repeat = true, srgb = true, aniso = 4 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    const [tx, ty] = Array.isArray(tile) ? tile : [tile, tile];
    t.repeat.set(1 / tx, 1 / ty);
  }
  t.anisotropy = aniso;
  t.userData.tile = tile;
  return t;
}

function noise(g, w, h, amt, seed = 7, size = 1) {
  const r = rng(seed);
  for (let i = 0; i < (w * h) / (size * size * 3); i++) {
    const a = (r() - 0.5) * amt;
    g.fillStyle = a > 0 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${-a})`;
    g.fillRect(r() * w, r() * h, size, size);
  }
}

/** 木目（縦方向 = v に沿う）。tile 0.9 m */
export function woodTexture(base = '#8a5530', seed = 3) {
  const S = 512;
  const [c, g] = canvas(S);
  g.fillStyle = base;
  g.fillRect(0, 0, S, S);
  const r = rng(seed);
  for (let i = 0; i < 70; i++) {
    const x = r() * S;
    const w = 1 + r() * 4;
    const dark = r() < 0.6;
    g.strokeStyle = dark ? `rgba(60,30,12,${0.08 + r() * 0.16})` : `rgba(255,220,170,${0.05 + r() * 0.08})`;
    g.lineWidth = w;
    g.beginPath();
    const amp = 2 + r() * 6;
    const f = 0.004 + r() * 0.01;
    const ph = r() * 6;
    for (let y = -4; y <= S + 4; y += 8) {
      const xx = x + Math.sin(y * f + ph) * amp;
      if (y < 0) g.moveTo(xx, y);
      else g.lineTo(xx, y);
    }
    g.stroke();
  }
  noise(g, S, S, 0.06, seed + 1, 2);
  return tex(c, 0.9);
}

/** 床の板張り（板幅 0.16 m）。tile 1.28 m */
export function plankTexture() {
  const S = 512;
  const [c, g] = canvas(S);
  const r = rng(11);
  const n = 8;
  const pw = S / n;
  for (let i = 0; i < n; i++) {
    const l = 0.86 + r() * 0.2;
    g.fillStyle = `rgb(${Math.round(128 * l)},${Math.round(82 * l)},${Math.round(46 * l)})`;
    g.fillRect(0, i * pw, S, pw);
    for (let k = 0; k < 14; k++) {
      g.strokeStyle = `rgba(60,30,10,${0.06 + r() * 0.1})`;
      g.lineWidth = 1 + r() * 2;
      const y = i * pw + r() * pw;
      g.beginPath();
      g.moveTo(0, y);
      g.bezierCurveTo(S * 0.3, y + (r() - 0.5) * 6, S * 0.6, y + (r() - 0.5) * 6, S, y);
      g.stroke();
    }
    // 継ぎ目
    g.fillStyle = 'rgba(40,20,8,0.55)';
    g.fillRect(0, i * pw, S, 2);
    const jx = r() * S;
    g.fillRect(jx, i * pw, 2, pw);
  }
  noise(g, S, S, 0.05, 12, 2);
  return tex(c, 1.28);
}

/** 緑の布（ベンチ）：細かい織り目とわずかなムラ。tile 0.5 m */
export function fabricTexture(base = '#3f6b45') {
  const S = 256;
  const [c, g] = canvas(S);
  g.fillStyle = base;
  g.fillRect(0, 0, S, S);
  for (let y = 0; y < S; y += 2) {
    g.fillStyle = `rgba(255,255,255,${y % 4 === 0 ? 0.035 : 0})`;
    g.fillRect(0, y, S, 1);
  }
  for (let x = 0; x < S; x += 2) {
    g.fillStyle = `rgba(0,0,0,${x % 4 === 0 ? 0.04 : 0})`;
    g.fillRect(x, 0, 1, S);
  }
  noise(g, S, S, 0.08, 21, 2);
  return tex(c, 0.5);
}

/** 絨毯（深緑の地にアイボリーの縁取りと小さな唐草）。UV 0..1 で 1 枚貼り */
export function carpetTexture() {
  const W = 512;
  const H = 384;
  const [c, g] = canvas(W, H);
  g.fillStyle = '#4c6b4a';
  g.fillRect(0, 0, W, H);
  // 地模様（小さな菱形）
  g.strokeStyle = 'rgba(220,226,190,0.13)';
  g.lineWidth = 1.5;
  for (let y = 0; y < H; y += 24) {
    for (let x = (y / 24) % 2 ? 12 : 0; x < W; x += 24) {
      g.beginPath();
      g.moveTo(x, y - 6);
      g.lineTo(x + 6, y);
      g.lineTo(x, y + 6);
      g.lineTo(x - 6, y);
      g.closePath();
      g.stroke();
    }
  }
  // 縁
  const bd = (inset, w, col) => {
    g.strokeStyle = col;
    g.lineWidth = w;
    g.strokeRect(inset, inset, W - inset * 2, H - inset * 2);
  };
  g.fillStyle = '#365236';
  g.fillRect(0, 0, W, 30);
  g.fillRect(0, H - 30, W, 30);
  g.fillRect(0, 0, 30, H);
  g.fillRect(W - 30, 0, 30, H);
  bd(8, 3, '#d9d3ae');
  bd(26, 2, '#c9b77a');
  bd(36, 1.5, 'rgba(217,211,174,0.6)');
  // 葉の模様（縁の中）
  g.fillStyle = 'rgba(217,211,174,0.55)';
  const leaf = (x, y, a) => {
    g.save();
    g.translate(x, y);
    g.rotate(a);
    g.beginPath();
    g.ellipse(0, 0, 6, 2.6, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  };
  for (let x = 44; x < W - 40; x += 22) {
    leaf(x, 17, 0.5);
    leaf(x + 9, 17, -0.5);
    leaf(x, H - 17, -0.5);
    leaf(x + 9, H - 17, 0.5);
  }
  for (let y = 44; y < H - 40; y += 22) {
    leaf(17, y, 1.1);
    leaf(W - 17, y, -1.1);
  }
  noise(g, W, H, 0.09, 31, 2);
  return tex(c, 1, { repeat: false });
}

/** アイボリーの壁（漆喰風のわずかなムラ）。tile 1 m */
export function plasterTexture() {
  const S = 256;
  const [c, g] = canvas(S);
  g.fillStyle = '#f1e9d6';
  g.fillRect(0, 0, S, S);
  noise(g, S, S, 0.05, 41, 3);
  noise(g, S, S, 0.03, 42, 1);
  return tex(c, 1);
}

/** 緑の腰壁（縦板の溝）。tile 0.6 m（横）× 0.9 m（縦） */
export function wainscotTexture() {
  const W = 256;
  const H = 384;
  const [c, g] = canvas(W, H);
  g.fillStyle = '#365a3c';
  g.fillRect(0, 0, W, H);
  const n = 4;
  for (let i = 0; i < n; i++) {
    const x = (i * W) / n;
    g.fillStyle = 'rgba(0,0,0,0.28)';
    g.fillRect(x, 0, 3, H);
    g.fillStyle = 'rgba(255,255,255,0.08)';
    g.fillRect(x + 3, 0, 2, H);
  }
  // 上下の框
  g.fillStyle = 'rgba(0,0,0,0.18)';
  g.fillRect(0, 0, W, 10);
  g.fillRect(0, H - 14, W, 14);
  noise(g, W, H, 0.06, 51, 2);
  return tex(c, [0.6, 0.9]);
}

/** テーブルクロス（緑とアイボリーのギンガム）。tile 0.24 m */
export function ginghamTexture() {
  const S = 128;
  const [c, g] = canvas(S);
  g.fillStyle = '#efe9d6';
  g.fillRect(0, 0, S, S);
  g.fillStyle = 'rgba(58,104,70,0.55)';
  for (let i = 0; i < 4; i++) {
    g.fillRect(i * 32, 0, 16, S);
    g.fillRect(0, i * 32, S, 16);
  }
  noise(g, S, S, 0.06, 61, 1);
  return tex(c, 0.24);
}

/** 額の絵（森）。UV 0..1 */
export function forestPaintingTexture(seed = 5) {
  const W = 256;
  const H = 192;
  const [c, g] = canvas(W, H);
  const sky = g.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#cfe3e6');
  sky.addColorStop(0.6, '#e9efe0');
  sky.addColorStop(1, '#b9cf9e');
  g.fillStyle = sky;
  g.fillRect(0, 0, W, H);
  const r = rng(seed);
  const tree = (x, base, h, col) => {
    g.fillStyle = '#5d4128';
    g.fillRect(x - 2, base - h * 0.25, 4, h * 0.25);
    g.fillStyle = col;
    for (let k = 0; k < 3; k++) {
      const y = base - h * 0.2 - k * h * 0.25;
      const w = h * (0.32 - k * 0.07);
      g.beginPath();
      g.moveTo(x, y - h * 0.35);
      g.lineTo(x + w, y);
      g.lineTo(x - w, y);
      g.closePath();
      g.fill();
    }
  };
  g.fillStyle = '#9bb98a';
  g.beginPath();
  g.moveTo(0, H * 0.62);
  g.quadraticCurveTo(W * 0.4, H * 0.45, W, H * 0.6);
  g.lineTo(W, H);
  g.lineTo(0, H);
  g.fill();
  for (let i = 0; i < 9; i++) tree(r() * W, H * (0.68 + r() * 0.1), 50 + r() * 40, ['#3f6e46', '#2f5a3a', '#4f8152'][i % 3]);
  for (let i = 0; i < 5; i++) tree(r() * W, H * (0.9 + r() * 0.08), 80 + r() * 40, ['#2c5235', '#3a6a40'][i % 2]);
  noise(g, W, H, 0.08, seed + 3, 2);
  return tex(c, 1, { repeat: false });
}

/** 小さな花柄（クッション）。tile 0.3 m */
export function cushionTexture() {
  const S = 128;
  const [c, g] = canvas(S);
  g.fillStyle = '#f2ecdb';
  g.fillRect(0, 0, S, S);
  g.fillStyle = 'rgba(86,130,88,0.55)';
  const r = rng(71);
  for (let i = 0; i < 10; i++) {
    const x = r() * S;
    const y = r() * S;
    for (let k = 0; k < 5; k++) {
      g.save();
      g.translate(x, y);
      g.rotate((k / 5) * Math.PI * 2 + r());
      g.beginPath();
      g.ellipse(6, 0, 6, 2.4, 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
  }
  noise(g, S, S, 0.05, 72, 1);
  return tex(c, 0.3);
}

/** ドアの曇りガラス（葉の紋章）。UV 0..1 */
export function frostedLeafTexture() {
  const W = 128;
  const H = 192;
  const [c, g] = canvas(W, H);
  const gr = g.createLinearGradient(0, 0, 0, H);
  gr.addColorStop(0, '#e8efe6');
  gr.addColorStop(1, '#d4dfd2');
  g.fillStyle = gr;
  g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(60,110,70,0.55)';
  g.fillStyle = 'rgba(80,130,85,0.35)';
  g.lineWidth = 2;
  g.save();
  g.translate(W / 2, H / 2 + 10);
  for (const [a, s] of [[0, 1], [-0.7, 0.75], [0.7, 0.75], [-1.25, 0.55], [1.25, 0.55]]) {
    g.save();
    g.rotate(a);
    g.beginPath();
    g.ellipse(0, -26 * s, 9 * s, 24 * s, 0, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.restore();
  }
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(0, 26);
  g.stroke();
  g.restore();
  noise(g, W, H, 0.06, 81, 2);
  return tex(c, 1, { repeat: false });
}

/** 真鍮の部屋番号プレート（「Room 1」など）。UV 0..1 */
export function plateTexture(text = 'Room 1') {
  const W = 256;
  const H = 96;
  const [c, g] = canvas(W, H);
  const gr = g.createLinearGradient(0, 0, 0, H);
  gr.addColorStop(0, '#3a5a3e');
  gr.addColorStop(1, '#2a4630');
  g.fillStyle = gr;
  g.fillRect(0, 0, W, H);
  g.strokeStyle = '#d6b46a';
  g.lineWidth = 6;
  g.strokeRect(5, 5, W - 10, H - 10);
  g.fillStyle = '#ecd69a';
  g.font = '600 46px Georgia, "Times New Roman", serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, W / 2 + 12, H / 2 + 3);
  // 小さな葉
  g.save();
  g.translate(38, H / 2);
  g.rotate(-0.5);
  g.beginPath();
  g.ellipse(0, 0, 7, 15, 0, 0, Math.PI * 2);
  g.fill();
  g.restore();
  return tex(c, 1, { repeat: false });
}

/** 本の背（色違い）は頂点カラーで塗るので、背の帯だけのテクスチャ。tile 0.04 m（幅）× 0.25 m */
export function bookSpineTexture() {
  const W = 32;
  const H = 128;
  const [c, g] = canvas(W, H);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(214,180,106,0.9)';
  g.fillRect(0, 14, W, 5);
  g.fillRect(0, H - 22, W, 5);
  g.fillStyle = 'rgba(0,0,0,0.12)';
  g.fillRect(0, 0, 2, H);
  return tex(c, [0.04, 0.25], { aniso: 2 });
}

/** 籐かご */
export function wickerTexture() {
  const S = 128;
  const [c, g] = canvas(S);
  g.fillStyle = '#b98a50';
  g.fillRect(0, 0, S, S);
  for (let y = 0; y < S; y += 8) {
    for (let x = 0; x < S; x += 16) {
      const o = (y / 8) % 2 ? 8 : 0;
      g.fillStyle = 'rgba(255,230,180,0.25)';
      g.fillRect(x + o, y, 10, 6);
      g.fillStyle = 'rgba(70,40,10,0.35)';
      g.fillRect(x + o + 10, y, 2, 8);
    }
  }
  noise(g, S, S, 0.07, 91, 1);
  return tex(c, 0.12);
}

/** 放射状のやわらかい円（影・光だまり・接地リング）。UV 0..1 */
export function radialTexture(inner = 0, outer = 1, ring = false) {
  const S = 128;
  const [c, g] = canvas(S);
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  if (ring) {
    gr.addColorStop(0, 'rgba(255,255,255,0)');
    gr.addColorStop(0.62, 'rgba(255,255,255,0.05)');
    gr.addColorStop(0.8, 'rgba(255,255,255,1)');
    gr.addColorStop(0.9, 'rgba(255,255,255,0.35)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
  } else {
    gr.addColorStop(inner, 'rgba(255,255,255,1)');
    gr.addColorStop((inner + outer) / 2, 'rgba(255,255,255,0.45)');
    gr.addColorStop(outer, 'rgba(255,255,255,0)');
  }
  g.fillStyle = gr;
  g.fillRect(0, 0, S, S);
  return tex(c, 1, { repeat: false, srgb: false });
}

/** 葉っぱ（プレイヤー）の葉脈。UV 0..1（葉の外形の外接矩形） */
export function leafVeinTexture() {
  const W = 128;
  const H = 192;
  const [c, g] = canvas(W, H);
  const gr = g.createLinearGradient(0, H, W, 0);
  gr.addColorStop(0, '#5fae3c');
  gr.addColorStop(1, '#93d14f');
  g.fillStyle = gr;
  g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(214,240,160,0.85)';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(W / 2, H);
  g.quadraticCurveTo(W / 2 + 4, H / 2, W / 2, 8);
  g.stroke();
  g.lineWidth = 1.6;
  for (let i = 1; i <= 5; i++) {
    const y = H - i * (H / 6.2);
    g.beginPath();
    g.moveTo(W / 2 + 1, y);
    g.quadraticCurveTo(W * 0.72, y - 12, W * 0.9, y - 28);
    g.moveTo(W / 2 - 1, y);
    g.quadraticCurveTo(W * 0.28, y - 12, W * 0.1, y - 28);
    g.stroke();
  }
  return tex(c, 1, { repeat: false });
}

/** 吹き出し・名札のスプライト用 Canvas テクスチャ */
export function bubbleTexture() {
  const W = 128;
  const H = 96;
  const [c, g] = canvas(W, H);
  g.fillStyle = 'rgba(0,0,0,0)';
  g.clearRect(0, 0, W, H);
  g.fillStyle = '#fbf8ef';
  g.strokeStyle = 'rgba(40,70,46,0.35)';
  g.lineWidth = 3;
  g.beginPath();
  g.roundRect(8, 8, W - 16, H - 34, 26);
  g.moveTo(W / 2 - 10, H - 27);
  g.lineTo(W / 2, H - 10);
  g.lineTo(W / 2 + 10, H - 27);
  g.fill();
  g.stroke();
  g.fillStyle = '#3d5f45';
  for (let i = -1; i <= 1; i++) {
    g.beginPath();
    g.arc(W / 2 + i * 18, (H - 26) / 2 + 4, 5, 0, Math.PI * 2);
    g.fill();
  }
  return tex(c, 1, { repeat: false });
}

export function nameTagTexture(text) {
  const W = 256;
  const H = 64;
  const [c, g] = canvas(W, H);
  g.font = '700 26px "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic UI", sans-serif';
  const tw = Math.min(W - 16, g.measureText(text).width + 32);
  g.fillStyle = 'rgba(38,68,45,0.88)';
  g.beginPath();
  g.roundRect((W - tw) / 2, 10, tw, H - 20, 20);
  g.fill();
  g.fillStyle = '#f6efd8';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, W / 2, H / 2 + 1);
  return tex(c, 1, { repeat: false });
}

/** 廊下のランナー（深緑の地にアイボリーの縁線）。U = 長手方向 tile 1 m、V = 幅 0..1 */
export function runnerTexture() {
  const W = 256;
  const H = 128;
  const [c, g] = canvas(W, H);
  g.fillStyle = '#466a48';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#d9d3ae';
  g.fillRect(0, 10, W, 4);
  g.fillRect(0, H - 14, W, 4);
  g.fillStyle = 'rgba(217,211,174,0.35)';
  for (let x = 0; x < W; x += 32) {
    g.save();
    g.translate(x + 16, H / 2);
    g.rotate(Math.PI / 4);
    g.fillRect(-7, -7, 14, 14);
    g.restore();
  }
  noise(g, W, H, 0.08, 111, 2);
  return tex(c, [1, 1]);
}

/** 窓の光だまり（四辺がやわらかい矩形）。UV 0..1 */
export function softRectTexture() {
  const S = 128;
  const [c, g] = canvas(S);
  const img = g.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const e = Math.min(x, y, S - 1 - x, S - 1 - y) / (S * 0.18);
      const a = Math.max(0, Math.min(1, e));
      const k = (y * S + x) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = 255;
      img.data[k + 3] = Math.round(a * a * (3 - 2 * a) * 255);
    }
  }
  g.putImageData(img, 0, 0);
  return tex(c, 1, { repeat: false, srgb: false });
}
