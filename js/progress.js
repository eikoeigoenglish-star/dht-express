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
/* 進捗パネル（画面右上。既存パネルとは重ならない位置）                        */
/* ---------------------------------------------------------------------- */
const fmt = (km) => displayKm(km).toLocaleString('ja-JP');

export class ProgressHud {
  /**
   * v9: 通常表示は「昨日 → 今日（いちばん大きく）」と再生ボタンだけ。
   * API の取得方式・区間・増分・再生中の km は ?debug=1 のときだけ（.dht-hud__debug）。
   * @param {HTMLElement} el
   * @param {{ onReplay:()=>void }} opts
   */
  constructor(el, opts) {
    this.el = el;
    this.$ = (sel) => el.querySelector(sel);
    this.$('[data-act=replay]').addEventListener('click', (e) => {
      e.currentTarget.blur();
      opts.onReplay();
    });
  }

  setLoading() {
    this.el.classList.remove('is-error');
    this.$('.dht-hud__today b').textContent = '…';
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
    this.$('.dht-hud__prev').textContent = fmt(p.previousKm);
    this.$('.dht-hud__today b').textContent = fmt(p.currentKm);
    // 以下はデバッグ表示（?debug=1）
    const delta = p.currentKm - p.previousKm;
    this.$('.dht-hud__delta').textContent = `${delta >= 0 ? '+' : '−'}${Math.abs(Math.round(delta * 10) / 10).toLocaleString('ja-JP')} km`;
    this.$('.dht-hud__mode').textContent = plan.ship.active ? (plan.train.moving ? '列車→船' : '船') : '列車';
    this.$('.dht-hud__src').textContent = source === 'url' ? 'URL' : source.toUpperCase();
  }

  /** アニメーション中の現在 km（デバッグ表示） */
  setLive(km) {
    this.$('.dht-hud__live').textContent = `now ${fmt(km)} km`;
  }
}
