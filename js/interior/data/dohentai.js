/**
 * interior/data/dohentai.js — 【v12】「各動物がリンさんへ『ド変態』と言った回数」のデータ
 * ---------------------------------------------------------------------------
 * 表示（hologram.js / HUD のパネル）とデータを分けている。表示側は DohentaiSource.load() の戻り値
 *   { updatedAt: string(ISO), target: string, isMock: boolean, entries: [{ id, name, count }] }
 * だけを見る。
 *
 * ★ 実データへの接続（Google Sheets / GAS など）
 *   DOHENTAI_CONFIG.endpoint に URL を入れる。受け取れる JSON の形：
 *     A) { "updatedAt": "...", "entries": [ { "id": "monkey", "name": "赤ちゃん猿", "count": 12 }, ... ] }
 *     B) { "rows": [ ["赤ちゃん猿", 12], ["リス", 7], ... ] }        ← シートの 2 列をそのまま返す場合
 *     C) [ ["赤ちゃん猿", 12], ... ]                                   ← 配列だけ
 *   取得に失敗したら仮データ（DOHENTAI_MOCK）を表示し、コンソールに警告を出す。
 */

export const DOHENTAI_CONFIG = {
  endpoint: null, // 例：'https://script.google.com/macros/s/XXXXXXXX/exec?sheet=dohentai'
  refreshSec: 60, // 開いている間の再取得間隔
  timeoutMs: 8000,
};

/** 8 匹（Room 2 の 4 匹 + Room 3 に来る予定の 4 匹）。id は characters.js と合わせる */
export const DOHENTAI_ANIMALS = [
  { id: 'monkey', name: '赤ちゃん猿' },
  { id: 'squirrel', name: 'リス' },
  { id: 'duck', name: 'アヒル' },
  { id: 'dog', name: '柴犬' },
  { id: 'cat', name: '猫' },
  { id: 'pony', name: '仔馬' },
  { id: 'tiger', name: '赤ちゃん虎' },
  { id: 'rabbit', name: 'ウサギ' },
];

/** 仮データ（実データがつながるまで） */
export const DOHENTAI_MOCK = {
  updatedAt: '2026-11-14T21:00:00+09:00',
  target: 'リンさん',
  entries: [
    { id: 'monkey', count: 42 },
    { id: 'dog', count: 35 },
    { id: 'squirrel', count: 28 },
    { id: 'duck', count: 21 },
    { id: 'cat', count: 17 },
    { id: 'rabbit', count: 12 },
    { id: 'tiger', count: 9 },
    { id: 'pony', count: 4 },
  ],
};

const nameOf = (id) => DOHENTAI_ANIMALS.find((a) => a.id === id)?.name ?? id;
const idOf = (name) => DOHENTAI_ANIMALS.find((a) => a.name === name)?.id ?? name;

/** いろいろな形の JSON を共通の形へ */
export function normalizeDohentai(json, { isMock = false } = {}) {
  let rows = [];
  if (Array.isArray(json)) rows = json.map(([name, count]) => ({ id: idOf(String(name)), name: String(name), count: Number(count) || 0 }));
  else if (Array.isArray(json?.rows)) rows = json.rows.map(([name, count]) => ({ id: idOf(String(name)), name: String(name), count: Number(count) || 0 }));
  else if (Array.isArray(json?.entries)) rows = json.entries.map((e) => ({ id: e.id ?? idOf(e.name), name: e.name ?? nameOf(e.id), count: Number(e.count) || 0 }));
  rows.sort((a, b) => b.count - a.count);
  return {
    updatedAt: json?.updatedAt ?? new Date().toISOString(),
    target: json?.target ?? 'リンさん',
    isMock,
    entries: rows,
  };
}

export class DohentaiSource {
  constructor(config = DOHENTAI_CONFIG) {
    this.config = config;
    this.last = normalizeDohentai(DOHENTAI_MOCK, { isMock: true });
    this._t = 0;
  }

  /** 最新のデータ（endpoint が無ければ仮データ） */
  async load() {
    const url = this.config.endpoint;
    if (!url) return (this.last = normalizeDohentai(DOHENTAI_MOCK, { isMock: true }));
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), this.config.timeoutMs);
      const res = await fetch(url, { signal: ctl.signal, cache: 'no-store' });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.last = normalizeDohentai(await res.json());
    } catch (e) {
      console.warn('[dohentai] 実データを取得できませんでした（仮データを表示）', e);
      this.last = normalizeDohentai(DOHENTAI_MOCK, { isMock: true });
    }
    return this.last;
  }
}
