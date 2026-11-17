/**
 * guide.js — 【v15】1 km ごとの現在地データと「次は / まもなく / ただ今」の駅・港案内
 * ---------------------------------------------------------------------------
 * データ：data/routes/locations-1km.json（tools/route/build_locations.py が既存ルートから生成。0〜2061 km の 2062 件）
 *   rows[i] は km = i。現在地の検索は Math.round(km) で配列を直接引く（O(1)）。
 *
 * 次の駅・港：既存の Journey.stops（js/route.js。shinkansen.json の 46 駅・ferry の 7 港。新しい駅データは作らない）から、
 *   生成スクリプトと同じ規則で、連続値の km について計算する（二分探索 O(log n)。毎フレーム呼んでも軽い）。
 *     rail（km <= 1325.9）は駅だけ、ship は港だけを対象にする
 *     目的地 = 「距離 d = 目的地 km − 現在 km が −3 以上」の最初の駅・港（通過して 3 km を越えたら次へ）
 *     |d| <= 3 → ただ今、d <= 10 → まもなく、それ以外 → 次は
 */

export const ARRIVE_KM = 3;
export const SOON_KM = 10;

export class LocationGuide {
  constructor() {
    this.rows = null;
    this.fields = null;
    this.targets = { rail: [], ship: [] };
    this.transferKm = 1325.9;
    this.endKm = 2060.9;
    this._obj = new Map(); // km → 行オブジェクト（必要になった km だけ作る）
  }

  /** @param {string} url locations-1km.json */
  async load(url) {
    const d = await (await fetch(url)).json();
    this.fields = d.fields;
    this.rows = d.rows;
    this.transferKm = d.transferKm ?? this.transferKm;
    this.endKm = d.endKm ?? this.endKm;
    this._fi = Object.fromEntries(this.fields.map((f, i) => [f, i]));
    return this;
  }

  /**
   * 既存 Journey の停車地（駅・港）から案内対象を作る。
   * @param {import('./route.js').Journey} journey
   */
  setJourney(journey) {
    this.transferKm = journey.transferKm ?? this.transferKm;
    this.endKm = journey.totalKm ?? this.endKm;
    const label = (s) => (s.type === 'station' ? `${s.name}駅` : s.name.endsWith('港') ? s.name : `${s.name}港`);
    const mk = (s) => ({ id: s.id, name: s.name, label: label(s), type: s.type === 'station' ? 'station' : 'port', km: s.journeyKm });
    this.targets.rail = journey.stops.filter((s) => s.segmentType === 'rail').map(mk);
    this.targets.ship = journey.stops.filter((s) => s.segmentType === 'ferry').map(mk);
    this.targets.rail.sort((a, b) => a.km - b.km);
    this.targets.ship.sort((a, b) => a.km - b.km);
    return this;
  }

  get ready() {
    return !!this.rows;
  }

  /** km → 'rail' | 'ship'（1325.9 ちょうどは鹿児島中央＝rail） */
  modeAt(km) {
    return km <= this.transferKm + 1e-9 ? 'rail' : 'ship';
  }

  /** 1 km データ（O(1)）。範囲外は 0 / 2061 へクランプ。rail / ship の境界（1325.9）をまたいで丸めない */
  at(km) {
    if (!this.rows) return null;
    const v = Number(km) || 0;
    let i = Math.round(v);
    const T = this.transferKm;
    if (v <= T + 1e-9 && i > T) i = Math.floor(T); // 1325.9（鹿児島中央）→ 1325 の行（rail）
    else if (v > T + 1e-9 && i <= T) i = Math.ceil(T); // 1325.9 を越えた直後 → 1326 の行（ship）
    i = Math.max(0, Math.min(this.rows.length - 1, i));
    let o = this._obj.get(i);
    if (!o) {
      o = {};
      const r = this.rows[i];
      for (let k = 0; k < this.fields.length; k++) if (r[k] != null) o[this.fields[k]] = r[k];
      this._obj.set(i, o);
    }
    return o;
  }

  /**
   * 次の駅・港と案内（連続値の km。アニメーション中の km をそのまま渡せる）
   * @returns {{ announce:'ただ今'|'まもなく'|'次は', target:{id,label,type,km}, distanceKm:number, mode:'rail'|'ship' } | null}
   */
  announce(km) {
    const mode = this.modeAt(km);
    const list = this.targets[mode];
    if (!list.length) return null;
    // 二分探索：t.km >= km − 3 の最初
    const v = km - ARRIVE_KM - 1e-9;
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid].km >= v) hi = mid;
      else lo = mid + 1;
    }
    const target = list[Math.min(lo, list.length - 1)];
    const d = target.km - km;
    const announce = Math.abs(d) <= ARRIVE_KM ? 'ただ今' : d <= SOON_KM ? 'まもなく' : '次は';
    return { announce, target, distanceKm: Math.round(d * 10) / 10, mode };
  }

  /** 電光掲示板の 2 行（現在地は 1 km データ、案内は連続値で計算） */
  board(km) {
    const a = this.announce(km);
    const p = this.at(km);
    return {
      mode: a?.mode ?? p?.mode ?? 'rail',
      line1: a ? `${a.announce}　${a.target.label}` : '',
      announce: a?.announce ?? '',
      target: a?.target.label ?? '',
      place: p?.place ?? '',
      sceneId: p?.sceneId ?? null,
      row: p,
    };
  }
}
