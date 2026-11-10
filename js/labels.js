/**
 * labels.js — 地名ラベル（HTML オーバーレイ, WebGL の draw call を消費しない）
 * 画面上で重なるラベルは優先度の低いものから隠す。
 *
 * 追加（都市・駅・ランドマーク）
 *   addItems([{ name, type, x, z, maxDist, prio, nearDist?, prioNear?, yOffset?, getY?, sub?, cls?, wExtra? }])
 *   ・maxDist  … これより遠いと表示しない [km]（広域＝主要なものだけ、近づくほど詳細）
 *   ・prio     … 重なった時の優先度（大きいほど残る）
 *   ・nearDist / prioNear … 近距離（nearDist 以内）での優先度。駅・ランドマークを近くで優先するため
 *   ・nearBoost … v6：近距離での追加優先度（近いほど最大 nearBoost 加算。同種の重なりで近いものを残す）
 *   ・getY(ground) … ラベルの高さ（ランドマークの頂部など）。省略時は 地表 + 0.4 + yOffset
 *   ・sub      … 2 行目の小さな補足（橋が結ぶ陸地など）
 *   ・minDist  … これより近いと表示しない [km]（v3：富士五湖のまとめラベルなど広域専用のもの）
 *
 * v3：湖沼（type 'lake'）・河川（type 'river'）も同じ仕組みで追加（js/water.js の labelItems）。
 *   優先度の目安：ランドマーク・主要駅(3.7〜6.5) > 都市(2.1〜4.6) > 湖沼(1.3〜1.75) > 河川(0.8)
 *   表示距離：主要湖 420km・その他の湖 75〜170km・河川 55km（広域では主要湖だけ、近距離で河川名）
 *
 * v10：カメラの高度による表示距離（見通し距離 3.57√h）・地平線付近の過密抑制（LABEL_VIEW_RULES）。
 */
import * as THREE from 'three';
import { latLonToWorld } from './geo.js';

const _v = new THREE.Vector3();

/**
 * v6: 近距離（各ラベルの nearDist 以内）での優先度の帯。東京都心・横浜・湾岸のような密集地は近距離で見るので、
 * ここで種類の順位を固定する：DHT ROUTE 重要ノード > 新幹線駅 > ランドマーク > 都市 > 河川・湖沼。
 * 同じ帯の中は重要度（imp）と近さ（nearBoost）で決まる（ランドマーク同士の重なり回避）。
 * 遠距離（nearDist より遠い）は従来どおり prio を使う（全国俯瞰では都市名を優先）。
 */
export const PRIO_NEAR = {
  routeend: 9.6, // DHT EXPRESS 0 km / RAIL END
  port: 9.3, // 寄港地（累積 km）
  routekm: 9.0, // 100km ノードの距離ラベル（新幹線・海路）
  stationMajor: 8.6,
  station: 8.2,
  landmark: 7.0, // + 重要度 0〜0.6 + 近さ 0〜0.3
  city: 6.0, // + 0〜0.5
  // 湖沼・河川は nearDist を持たない（1.3〜1.75 / 0.8 のまま＝常に最下位）
};
const PRIORITY = { city: 2, island: 2.5, peak: 1, sea: 0 };

/**
 * v10: 高度に応じた表示距離（見通し距離）
 *   見える距離 D [km] = 3.57 × √(カメラの高さ[m])   … 地球の曲率による見通し距離の目安（高度 1000m → 約 113km）
 *   カメラの高さはワールドの Y（1 単位 = 1km）をそのまま m に換算（VEHICLE VIEW の高度 1.0km → 約 113km）。
 *   モードごとに倍率 k を掛け（VEHICLE 0.85＝厳しめ / EXPLORE 1.2 / MAP 1.6＝広め）、
 *   さらに各ラベルの重要度 f（0.45〜1.0）を掛けた距離より遠いラベルは出さない（重要度の低いものほど早く消える）。
 *   地平線付近の過密対策：
 *     ・カメラから見た俯角が horizonDeg より浅い（地平線に近い）ラベルは、重要度 0.95 未満なら出さない（近く 12km 以内は除く）
 *     ・表示距離の半分より遠いラベルは、優先度の高い順に farMax 件まで
 */
export const LABEL_VIEW_RULES = {
  vehicle: { k: 0.85, minRange: 16, horizonDeg: 1.0, farMax: 4 },
  explore: { k: 1.2, minRange: 20, horizonDeg: 0.7, farMax: 6 },
  map: { k: 1.6, minRange: 28, horizonDeg: 0.4, farMax: 10 },
};
export const horizonKm = (heightM) => 3.57 * Math.sqrt(Math.max(1, heightM));

/** ラベルの重要度（0.45〜1.0）。表示距離の倍率になる */
function importance(it) {
  if (it.importance != null) return it.importance;
  const m = it.meta ?? {};
  switch (it.type) {
    case 'routeend':
    case 'port':
    case 'sea':
      return 1.0;
    case 'routekm':
      return 0.8;
    case 'station':
      return m.major ? 0.9 : 0.65;
    case 'city':
      if (it.maxDist >= 3000) return 1.0; // places.json の主要都市
      return { metro: 1.0, major: 0.9, city: 0.72, town: 0.55 }[m.rank] ?? (it.maxDist >= 400 ? 0.85 : 0.7);
    case 'island':
    case 'peak':
      return 0.85;
    case 'landmark':
      return m.tier === 1 ? 0.75 : 0.5;
    case 'lake':
      return Number(m.rank) === 1 ? 0.8 : 0.55;
    case 'river':
      return 0.45;
    default:
      return 0.7;
  }
}

export class PlaceLabels {
  constructor(container, terrain) {
    this.root = document.createElement('div');
    this.root.className = 'labels';
    container.appendChild(this.root);
    this.terrain = terrain;
    this.items = [];
    this.visible = true;
    this.frame = 0;
    this.stats = { shown: 0, total: 0, rangeKm: 0, culledRange: 0, culledHorizon: 0, culledFar: 0 };
    this.viewMode = 'map'; // v10: 'vehicle' | 'map' | 'explore'（表示距離の規則）
  }

  /** v10: 表示距離の規則を切り替える（main.js がモード変更のたびに呼ぶ） */
  setViewMode(m) {
    this.viewMode = LABEL_VIEW_RULES[m] ? m : 'map';
  }

  async load(url) {
    const json = await (await fetch(url)).json();
    for (const p of json.places) {
      const w = latLonToWorld(p.lat, p.lon);
      const el = document.createElement('div');
      el.className = `label label--${p.type}`;
      el.textContent = p.name;
      this.root.appendChild(el);
      // 主要都市（maxDist が大きいもの）を優先
      const prio = (PRIORITY[p.type] ?? 1) + (p.maxDist >= 3000 ? 2 : 0);
      const wPx = p.name.length * (p.type === 'sea' ? 22 : 13) + 14;
      this.items.push({ ...p, x: w.x, z: w.z, el, prio, wPx, hPx: 22, shown: false, sx: 0, sy: 0, dist: 0, y: null });
    }
    this.stats.total = this.items.length;
  }

  /** 既存ラベルのうち type が一致し、(x, z) から r [km] 以内にあるもの */
  findNear(x, z, r, type = 'city') {
    return this.items.find((it) => it.type === type && Math.hypot(it.x - x, it.z - z) < r);
  }

  /** 都市・駅・ランドマークのラベルを追加 */
  addItems(list) {
    for (const p of list) {
      const el = document.createElement('div');
      el.className = `label label--${p.type}${p.cls ? ' ' + p.cls : ''}`;
      if (p.sub) {
        el.innerHTML = '';
        el.append(p.name);
        const s = document.createElement('small');
        s.textContent = p.sub;
        el.append(s);
      } else el.textContent = p.name;
      this.root.appendChild(el);
      const wName = p.name.length * 13 + 14 + (p.wExtra ?? 0);
      const wSub = p.sub ? p.sub.length * 10 + 14 : 0;
      this.items.push({
        ...p,
        el,
        wPx: Math.max(wName, wSub),
        hPx: p.sub ? 36 : 22,
        shown: false,
        sx: 0,
        sy: 0,
        dist: 0,
        y: null,
      });
    }
    this.stats.total = this.items.length;
  }

  setVisible(v) {
    this.visible = v;
    this.root.style.display = v ? '' : 'none';
  }

  /** v5: 種類ごとの表示 ON/OFF（ルート表示の R キー用） */
  setTypeVisible(types, v) {
    for (const it of this.items) if (types.includes(it.type)) it.hidden = !v;
  }

  _itemY(it) {
    if (it.type === 'sea') return 0;
    const g = this.terrain.getSurfaceY(it.x, it.z);
    if (it.getY) return it.getY(g);
    return g + 0.4 + (it.yOffset ?? 0);
  }

  update(camera, width, height) {
    if (!this.visible) return;
    const refreshY = this.frame++ % 20 === 0; // 地表の高さは時々だけ計算し直す
    const cp = camera.position;
    const cand = [];
    // v10: 高度に応じた表示距離
    const rule = LABEL_VIEW_RULES[this.viewMode] ?? LABEL_VIEW_RULES.map;
    const range = Math.max(rule.minRange, horizonKm(cp.y * 1000) * rule.k);
    const hTan = Math.tan((rule.horizonDeg * Math.PI) / 180);
    let cRange = 0;
    let cHor = 0;
    for (const it of this.items) {
      // 遠すぎるものは高さ計算・投影の前に除外（水平距離で粗く判定）
      if (it.hidden) {
        this._set(it, false);
        continue;
      }
      const hx = it.x - cp.x;
      const hz = it.z - cp.z;
      if (hx * hx + hz * hz > it.maxDist * it.maxDist) {
        this._set(it, false);
        continue;
      }
      const f = importance(it);
      it.range = range * f;
      if (hx * hx + hz * hz > it.range * it.range) {
        this._set(it, false);
        cRange++;
        continue;
      }
      if (refreshY || it.y == null) it.y = this._itemY(it);
      _v.set(it.x, it.y, it.z);
      it.dist = cp.distanceTo(_v);
      let ok = it.dist < it.maxDist && it.dist > (it.type === 'sea' ? 250 : (it.minDist ?? 2));
      // v10: 地平線に近い（俯角が浅い）遠方のラベルは重要なものだけ
      if (ok && f < 0.95 && it.type !== 'sea') {
        const hd = Math.sqrt(hx * hx + hz * hz);
        if (hd > 12 && cp.y - it.y < hd * hTan) {
          ok = false;
          cHor++;
        }
      }
      if (ok) {
        _v.project(camera);
        ok = _v.z < 1 && _v.z > -1 && Math.abs(_v.x) < 1.1 && Math.abs(_v.y) < 1.1;
      }
      if (ok) {
        it.sx = (_v.x * 0.5 + 0.5) * width;
        it.sy = (-_v.y * 0.5 + 0.5) * height;
        it.p = it.nearDist && it.dist < it.nearDist ? it.prioNear + (it.nearBoost ? it.nearBoost * (1 - it.dist / it.nearDist) : 0) : it.prio;
        cand.push(it);
      } else this._set(it, false);
    }
    // 重なり除去（優先度 → 近い順）
    cand.sort((a, b) => b.p - a.p || a.dist - b.dist);
    const placed = [];
    let shown = 0;
    let far = 0;
    let cFar = 0;
    for (const it of cand) {
      // v10: 表示距離の半分より遠いものは farMax 件まで（優先度の高い順）
      if (it.dist > range * 0.5 && it.type !== 'sea') {
        if (far >= rule.farMax) {
          this._set(it, false);
          cFar++;
          continue;
        }
      }
      const r = { x0: it.sx - it.wPx / 2, x1: it.sx + it.wPx / 2, y0: it.sy - it.hPx, y1: it.sy };
      const hit = placed.some((q) => r.x0 < q.x1 && r.x1 > q.x0 && r.y0 < q.y1 && r.y1 > q.y0);
      if (hit) {
        this._set(it, false);
        continue;
      }
      placed.push(r);
      if (it.dist > range * 0.5 && it.type !== 'sea') far++;
      it.el.style.transform = `translate(${it.sx.toFixed(1)}px, ${it.sy.toFixed(1)}px) translate(-50%, -100%)`;
      // 表示距離の端（maxDist・v10 の高度による距離の近い方）で徐々に消す
      const lim = Math.min(it.maxDist, it.range ?? it.maxDist);
      it.el.style.opacity = Math.max(0, Math.min(1, (lim - it.dist) / (lim * 0.25))).toFixed(2);
      this._set(it, true);
      shown++;
    }
    this.stats.shown = shown;
    Object.assign(this.stats, { rangeKm: Math.round(range), culledRange: cRange, culledHorizon: cHor, culledFar: cFar });
  }

  _set(it, show) {
    if (show !== it.shown) {
      it.el.style.display = show ? 'block' : 'none';
      it.shown = show;
    }
  }
}
