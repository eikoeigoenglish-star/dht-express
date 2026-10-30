/**
 * labels.js — 地名ラベル（HTML オーバーレイ, WebGL の draw call を消費しない）
 * 画面上で重なるラベルは優先度の低いものから隠す。
 */
import * as THREE from 'three';
import { latLonToWorld } from './geo.js';

const _v = new THREE.Vector3();
const PRIORITY = { city: 2, island: 2.5, peak: 1, sea: 0 };

export class PlaceLabels {
  constructor(container, terrain) {
    this.root = document.createElement('div');
    this.root.className = 'labels';
    container.appendChild(this.root);
    this.terrain = terrain;
    this.items = [];
    this.visible = true;
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
      this.items.push({ ...p, x: w.x, z: w.z, el, prio, wPx, shown: false, sx: 0, sy: 0, dist: 0 });
    }
  }

  setVisible(v) {
    this.visible = v;
    this.root.style.display = v ? '' : 'none';
  }

  update(camera, width, height) {
    if (!this.visible) return;
    const cp = camera.position;
    const cand = [];
    for (const it of this.items) {
      const y = it.type === 'sea' ? 0 : this.terrain.getSurfaceY(it.x, it.z) + 0.4;
      _v.set(it.x, y, it.z);
      it.dist = cp.distanceTo(_v);
      let ok = it.dist < it.maxDist && it.dist > (it.type === 'sea' ? 250 : 2);
      if (ok) {
        _v.project(camera);
        ok = _v.z < 1 && _v.z > -1 && Math.abs(_v.x) < 1.1 && Math.abs(_v.y) < 1.1;
      }
      if (ok) {
        it.sx = (_v.x * 0.5 + 0.5) * width;
        it.sy = (-_v.y * 0.5 + 0.5) * height;
        cand.push(it);
      } else this._set(it, false);
    }
    // 重なり除去（優先度 → 近い順）
    cand.sort((a, b) => b.prio - a.prio || a.dist - b.dist);
    const placed = [];
    for (const it of cand) {
      const r = { x0: it.sx - it.wPx / 2, x1: it.sx + it.wPx / 2, y0: it.sy - 22, y1: it.sy };
      const hit = placed.some((q) => r.x0 < q.x1 && r.x1 > q.x0 && r.y0 < q.y1 && r.y1 > q.y0);
      if (hit) {
        this._set(it, false);
        continue;
      }
      placed.push(r);
      it.el.style.transform = `translate(${it.sx.toFixed(1)}px, ${it.sy.toFixed(1)}px) translate(-50%, -100%)`;
      it.el.style.opacity = Math.min(1, (it.maxDist - it.dist) / (it.maxDist * 0.25)).toFixed(2);
      this._set(it, true);
    }
  }

  _set(it, show) {
    if (show !== it.shown) {
      it.el.style.display = show ? 'block' : 'none';
      it.shown = show;
    }
  }
}
