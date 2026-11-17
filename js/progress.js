/**
 * progress.js — 【v7】DHT 進捗 API（Google Apps Script）の読み込みと、進捗パネル（HUD）
 * ---------------------------------------------------------------------------
 * 取得方式（クライアントだけで完結。GitHub Pages でそのまま動く）
 *   1) 通常の fetch（GET・カスタムヘッダなし＝CORS のプリフライトが発生しない「単純リクエスト」）
 *   2) fetch が失敗した場合（CORS・ネットワーク・JSON でない応答）は JSONP（?callback=…）に切り替える
 *   URL パラメータ ?apiMode=fetch|jsonp|auto で方式を固定できる（既定 auto）。
 *
 * 使う値（API の JSON）
 *   progress.currentKm            … 今日の終点（東京からの累積 km）
 *   progress.previousProgressKm   … 昨日までの始点（無ければ progress.yesterdayKm、それも無ければ 0）
 *   progress.yesterdayKm / progress.todayDeltaKm … 表示用
 *
 * 確認用の上書き（API を呼ばない）: ?km=1500&prev=1450
 */
import { displayKm } from './route.js';

export const PROGRESS_API_URL =
  'https://script.google.com/macros/s/AKfycbxsONUT6yWRWFNE2KYs3tcagDWqtWEVcg-GDlFN5YJCOoDOolCMphfs0gXYDR1jW-le/exec';

/** 数値化（"1,234.5" のような文字列も可）。数値にならなければ null */
export function toKm(v) {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[,\s]/g, '').replace(/km$/i, ''));
  return Number.isFinite(n) ? n : null;
}

/** API の JSON → { currentKm, previousKm, previousFrom, yesterdayKm, todayDeltaKm } */
export function parseProgress(json) {
  const p = (json && (json.progress ?? json.data?.progress)) || json || {};
  const currentKm = toKm(p.currentKm);
  const prevP = toKm(p.previousProgressKm);
  const yest = toKm(p.yesterdayKm);
  const previousKm = prevP ?? yest ?? 0;
  const previousFrom = prevP != null ? 'previousProgressKm' : yest != null ? 'yesterdayKm' : 'default-0';
  return {
    currentKm: currentKm ?? previousKm,
    previousKm,
    previousFrom,
    yesterdayKm: yest,
    todayDeltaKm: toKm(p.todayDeltaKm),
    hasCurrent: currentKm != null,
  };
}

function withTimeout(promise, ms, label) {
  let id;
  const t = new Promise((_, rej) => {
    id = setTimeout(() => rej(new Error(`${label} timeout`)), ms);
  });
  return Promise.race([promise, t]).finally(() => clearTimeout(id));
}

async function viaFetch(url, ms) {
  const res = await withTimeout(fetch(url, { method: 'GET', redirect: 'follow', cache: 'no-store' }), ms, 'fetch');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  return JSON.parse(text); // HTML（ログイン画面など）が返ったら例外 → JSONP へ
}

let jsonpSeq = 0;
function viaJsonp(url, ms) {
  return new Promise((resolve, reject) => {
    const cb = `__dhtProgressCb${Date.now().toString(36)}${jsonpSeq++}`;
    const s = document.createElement('script');
    let done = false;
    const cleanup = () => {
      done = true;
      clearTimeout(timer);
      try {
        delete window[cb];
      } catch {
        window[cb] = undefined;
      }
      s.remove();
    };
    const timer = setTimeout(() => {
      if (done) return;
      cleanup();
      reject(new Error('jsonp timeout'));
    }, ms);
    window[cb] = (data) => {
      if (done) return;
      cleanup();
      resolve(typeof data === 'string' ? JSON.parse(data) : data);
    };
    s.onerror = () => {
      if (done) return;
      cleanup();
      reject(new Error('jsonp load error'));
    };
    s.async = true;
    s.src = `${url}${url.includes('?') ? '&' : '?'}callback=${cb}&_=${Date.now()}`;
    document.head.appendChild(s);
  });
}

/**
 * 進捗を取得する。
 * @returns {Promise<{ progress:object, raw:any, source:'fetch'|'jsonp'|'url' }>}
 */
export async function loadProgress({ url = PROGRESS_API_URL, mode = 'auto', timeoutMs = 12000 } = {}) {
  const q = new URLSearchParams(location.search);
  // 確認用：?km=…&prev=…（API を呼ばない）
  if (q.has('km')) {
    const raw = { progress: { currentKm: q.get('km'), previousProgressKm: q.get('prev') ?? undefined } };
    return { progress: parseProgress(raw), raw, source: 'url' };
  }
  url = q.get('api') || url;
  mode = q.get('apiMode') || mode;
  if (mode !== 'jsonp') {
    try {
      const raw = await viaFetch(url, timeoutMs);
      return { progress: parseProgress(raw), raw, source: 'fetch' };
    } catch (e) {
      if (mode === 'fetch') throw e;
      console.info('[progress] fetch で取得できなかったため JSONP に切り替えます:', e.message);
    }
  }
  const raw = await viaJsonp(url, timeoutMs);
  return { progress: parseProgress(raw), raw, source: 'jsonp' };
}

/* ---------------------------------------------------------------------- */
/* 進捗パネル（v15: Journey Progress。画面右上の厚みのあるアクリルパネル）     */
/* ---------------------------------------------------------------------- */
const fmt = (km) => displayKm(km).toLocaleString('ja-JP');
const MIN_KEY = 'dht.journeyProgress.minimized';

export class ProgressHud {
  /**
   * v15: Journey Progress
   *   ・Yesterday → Today（Today を大きく）
   *   ・電光掲示板：1 行目「次は / まもなく / ただ今 ＋ 駅・港」、2 行目「現在地：…」（js/guide.js）
   *   ・再生ボタン（既存の vehicles.play をそのまま呼ぶ）・最小化（今日の km と再展開ボタンだけ）
   * API の取得方式・区間・増分・再生中の km・scene は ?debug=1 のときだけ（.dht-hud__debug）。
   * DOM は値が変わったときだけ書き換える（アニメーション中も 1 フレームあたり数回の比較だけ）。
   * @param {HTMLElement} el
   * @param {{ onReplay:()=>void, guide?: import('./guide.js').LocationGuide }} opts
   */
  constructor(el, opts) {
    this.el = el;
    this.guide = opts.guide ?? null;
    this.$ = (sel) => el.querySelector(sel);
    this.$led = this.$('.jp__led');
    this.$ann = this.$('[data-led=ann]');
    this.$tgt = this.$('[data-led=target]');
    this.$place = this.$('[data-led=place]');
    this.$mini = this.$('.jp__mini');
    this.$miniKm = this.$('.jp__mini-km');
    this.$body = this.$('.jp__body');
    this._last = {};
    this.$('[data-act=replay]').addEventListener('click', (e) => {
      e.currentTarget.blur();
      opts.onReplay();
    });
    this.$('[data-act=minimize]').addEventListener('click', () => this.setMinimized(true, true));
    this.$mini.addEventListener('click', () => this.setMinimized(false, true));
    let saved = null;
    try {
      saved = localStorage.getItem(MIN_KEY);
    } catch {
      /* プライベートモードなど */
    }
    this.setMinimized(saved === '1', false);
  }

  /** 最小化（true）／再展開（false）。focus：キーボード操作のとき反対側のボタンへフォーカスを移す */
  setMinimized(on, focus) {
    this.minimized = on;
    this.el.classList.toggle('is-min', on);
    this.$body.hidden = on;
    this.$mini.hidden = !on;
    this.$('[data-act=minimize]').setAttribute('aria-expanded', String(!on));
    try {
      localStorage.setItem(MIN_KEY, on ? '1' : '0');
    } catch {
      /* 保存できなくても動作は同じ */
    }
    this._w = null; // 大きさを測り直す
    if (this._st) this._st.init = false; // 位置は次のフレームで直接置く
    if (focus) (on ? this.$mini : this.$('[data-act=minimize]')).focus({ preventScroll: true });
  }

  /* ------------------------------------------------------------------ */
  /* v15: 列車／船に紐づく 3D アクリルの吹き出し                              */
  /* ------------------------------------------------------------------ */
  /**
   * 毎フレーム main.js から。乗り物のスクリーン座標 (sx, sy) の少し上にパネルを浮かべ、
   * 下部のノッチの先端を乗り物へ向ける。上に余白が無ければ下側へ回り（ノッチは上向き）、
   * 画面端・左上のアイコン／CAMERA にかかるときだけ安全な位置へ寄せる。
   * 最小化中・乗り物が画面の後ろ側のときは右上に退避（ノッチなし）。
   * @param {{ x:number, y:number, behind:boolean } | null} v 乗り物の画面座標（px）
   * @param {number} dt
   */
  anchor(v, dt, vw, vh) {
    const el = this.el;
    if (this._w == null || this._sizeT++ > 30) this._measure();
    const w = this._w;
    const h = this._h;
    const M = vw < 520 ? 8 : 12;
    const st = this._st ?? (this._st = { x: vw - w - M, y: M, init: false });
    let tx;
    let ty;
    let flip = false;
    let notch = null;
    if (this.minimized || !v || v.behind) {
      // 右上に退避（最小化表示はここ）
      const mw = this.minimized ? this._miniW : w;
      tx = vw - mw - M;
      ty = vh > 0 && document.body.classList.contains('is-touch') ? Math.max(M, this._safeTop) : M;
    } else {
      const TIP = vw < 520 ? 30 : 26; // 乗り物の少し上（車体・選択リングを隠さない）
      const tipX = Math.max(M, Math.min(vw - M, v.x));
      const tipY = Math.max(M, Math.min(vh - M, v.y - TIP));
      const GAP = vw < 520 ? 34 : 44; // パネル下端 → ノッチ先端
      // 乗り物の真上に中心を置かず、少し横へずらす（右に余白があれば右、無ければ左）
      const bias = (tipX + w * 0.7 + M < vw ? 1 : -1) * w * 0.18;
      tx = tipX - w / 2 + bias;
      ty = tipY - GAP - h;
      if (ty < M) {
        // 上に入らない → 乗り物の下へ（ノッチは上向き）
        flip = true;
        ty = v.y + 34 + GAP;
      }
      tx = Math.max(M, Math.min(vw - w - M, tx));
      ty = Math.max(M, Math.min(vh - h - M, ty));
      // 左上のアイコン・CAMERA・左下の CONTROLS を避ける
      for (const r of this._keep) {
        if (tx < r.right + 8 && tx + w > r.left - 8 && ty < r.bottom + 8 && ty + h > r.top - 8) {
          if (r.right + 8 + w + M <= vw) tx = r.right + 8;
          else ty = flip ? r.top - h - 8 : r.bottom + 8;
        }
      }
      notch = { tipX, tipY: flip ? v.y + 30 : tipY };
    }
    // 滑らかに追従（初回はそのまま）
    const k = st.init ? 1 - Math.exp(-(dt || 0.016) * 9) : 1;
    st.x += (tx - st.x) * k;
    st.y += (ty - st.y) * k;
    st.init = true;
    const X = Math.round(st.x * 2) / 2;
    const Y = Math.round(st.y * 2) / 2;
    if (X !== this._lx || Y !== this._ly) {
      this._lx = X;
      this._ly = Y;
      el.style.transform = `translate3d(${X}px, ${Y}px, 0)`;
    }
    // ノッチ：パネルの下辺（flip なら上辺）から先端へ。横位置は乗り物の方へ寄せる
    const st2 = this._ns ?? (this._ns = {});
    let nx = w / 2;
    let na = 0;
    let nl = 16;
    let ry = 4;
    const on = !!notch && !this.minimized;
    if (on) {
      nx = Math.max(34, Math.min(w - 34, notch.tipX - X));
      const bx = X + nx;
      const by = flip ? Y : Y + h;
      const dx = notch.tipX - bx;
      const dy = notch.tipY - by;
      const L = Math.hypot(dx, dy);
      nl = Math.max(14, Math.min(flip ? 72 : 84, L));
      na = flip ? Math.atan2(dx, -dy) : -Math.atan2(dx, dy);
      na = Math.max(-1.05, Math.min(1.05, na));
      // パネルの向き：乗り物のある側へごく軽く振る（rotateY 3〜6°）
      const side = (notch.tipX - (X + w / 2)) / w; // −0.5（左）〜 +0.5（右）
      ry = Math.max(-6, Math.min(6, (side >= 0 ? -1 : 1) * (3.2 + Math.min(2.6, Math.abs(side) * 6))));
    }
    const key = `${on}|${flip}|${Math.round(nx)}|${na.toFixed(3)}|${Math.round(nl)}|${ry.toFixed(1)}`;
    if (key !== st2.key) {
      st2.key = key;
      el.classList.toggle('is-anchored', on);
      el.classList.toggle('is-flip', flip);
      el.style.setProperty('--nx', `${nx.toFixed(1)}px`);
      el.style.setProperty('--na', `${na.toFixed(3)}rad`);
      el.style.setProperty('--nl', `${nl.toFixed(1)}px`);
      el.style.setProperty('--ry', `${ry.toFixed(2)}deg`);
      el.style.setProperty('--sx', ry > 0 ? '-1' : '1'); // 厚み（側面）が見える側
    }
  }

  _measure() {
    this._sizeT = 0;
    this._w = this.$body.offsetWidth || this.el.offsetWidth || 300;
    this._h = this.$body.offsetHeight || 240;
    this._miniW = this.$mini.offsetWidth || 160;
    this._safeTop = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sat')) || 12;
    this._keep = ['.panel--top', '#presets', '#help']
      .map((q) => document.querySelector(q))
      .filter((n) => n && n.offsetParent !== null)
      .map((n) => n.getBoundingClientRect());
  }

  setGuide(guide) {
    this.guide = guide;
    if (this._liveKm != null) this.setLive(this._liveKm);
  }

  setLoading() {
    this.el.classList.remove('is-error');
    this.$('.dht-hud__today b').textContent = '…';
    this.$miniKm.textContent = '…';
  }

  setError(msg) {
    this.el.classList.add('is-error');
    this.$('.dht-hud__msg').textContent = msg;
    this.el.title = msg;
  }

  /** @param {object} p parseProgress の結果 @param {object} plan VehicleSystem の plan */
  setProgress(p, plan, source) {
    this.el.classList.remove('is-error');
    this.el.title = '';
    this.$('.dht-hud__prev b').textContent = fmt(p.previousKm);
    this.$('.dht-hud__today b').textContent = fmt(p.currentKm);
    this.$miniKm.textContent = fmt(p.currentKm);
    this.el.setAttribute('aria-label', `Journey Progress：昨日 ${fmt(p.previousKm)} km、今日 ${fmt(p.currentKm)} km`);
    // 以下はデバッグ表示（?debug=1）
    const delta = p.currentKm - p.previousKm;
    this.$('.dht-hud__delta').textContent = `${delta >= 0 ? '+' : '−'}${Math.abs(Math.round(delta * 10) / 10).toLocaleString('ja-JP')} km`;
    this.$('.dht-hud__mode').textContent = plan.ship.active ? (plan.train.moving ? '列車→船' : '船') : '列車';
    this.$('.dht-hud__src').textContent = source === 'url' ? 'URL' : source.toUpperCase();
  }

  /** アニメーション中の現在 km（電光掲示板・デバッグ表示） */
  setLive(km) {
    this._liveKm = km;
    this._set(this.$('.dht-hud__live'), 'live', `now ${fmt(km)} km`);
    const g = this.guide;
    if (!g?.ready || km == null) return;
    const b = g.board(km);
    if (b.mode !== this._last.mode) {
      this._last.mode = b.mode;
      this.$led.dataset.mode = b.mode;
    }
    this._set(this.$ann, 'ann', b.announce);
    this._set(this.$tgt, 'tgt', b.target);
    this._set(this.$place, 'place', b.place);
    if (b.announce !== this._last.annCls) {
      this._last.annCls = b.announce;
      this.$led.dataset.announce = b.announce === 'ただ今' ? 'now' : b.announce === 'まもなく' ? 'soon' : 'next';
    }
    // 長い地名は少し小さく（幅に収める）
    const long = b.place.length > 9 || b.target.length > 7;
    if (long !== this._last.long) {
      this._last.long = long;
      this.$led.classList.toggle('is-long', long);
    }
    this._set(this.$('.dht-hud__scene'), 'scene', b.sceneId ? `scene ${b.sceneId}` : '');
  }

  _set(node, key, text) {
    if (this._last[key] === text || !node) return;
    this._last[key] = text;
    node.textContent = text;
  }
}
