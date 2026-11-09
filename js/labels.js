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

export class PlaceLabels {
  constructor(container, terrain) {
    this.root = document.createElement('div');
    this.root.className = 'labels';
    container.appendChild(this.root);
    this.terrain = terrain;
    this.items = [];
    this.visible = true;
    this.frame = 0;
    this.stats = { shown: 0, total: 0 };
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
      if (refreshY || it.y == null) it.y = this._itemY(it);
      _v.set(it.x, it.y, it.z);
      it.dist = cp.distanceTo(_v);
      let ok = it.dist < it.maxDist && it.dist > (it.type === 'sea' ? 250 : (it.minDist ?? 2));
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
    for (const it of cand) {
      const r = { x0: it.sx - it.wPx / 2, x1: it.sx + it.wPx / 2, y0: it.sy - it.hPx, y1: it.sy };
      const hit = placed.some((q) => r.x0 < q.x1 && r.x1 > q.x0 && r.y0 < q.y1 && r.y1 > q.y0);
      if (hit) {
        this._set(it, false);
        continue;
      }
      placed.push(r);
      it.el.style.transform = `translate(${it.sx.toFixed(1)}px, ${it.sy.toFixed(1)}px) translate(-50%, -100%)`;
      it.el.style.opacity = Math.min(1, (it.maxDist - it.dist) / (it.maxDist * 0.25)).toFixed(2);
      this._set(it, true);
      shown++;
    }
    this.stats.shown = shown;
  }

  _set(it, show) {
    if (show !== it.shown) {
      it.el.style.display = show ? 'block' : 'none';
      it.shown = show;
    }
  }
}
