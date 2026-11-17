/**
 * sceneryplan.js — 【v15】累積 km → 車窓景観（scene ID・preset）と境界のクロスフェード
 * ---------------------------------------------------------------------------
 * データ（3 つに分離）
 *   data/routes/locations-1km.json … 1 km ごとの地点（sceneId を参照として持つ）
 *   data/scenery/segments.json      … 区間 { startKm, endKm, sceneId }（両端を含む整数 km。0〜2061 を欠落・重複なく覆う）
 *   data/scenery/presets.json       … 景観の中身 { id, left, right, leftBackground, rightBackground, …Water }
 *
 * 検索：km 0〜2061 → 区間番号の Int16Array を一度だけ作る（O(1)）。
 * クロスフェード：区間の境界（endKm と次の startKm の間 = endKm + 0.5）の前後 crossfadeKm/2 で
 *   from → to を t = 0..1 で補間する（既定 crossfadeKm = 2 → 境界の ±1 km）。
 *
 * 景観（地形・車窓の中身）だけを決める。光・空・夜景・色調は既存の timeMode（interior/looks.js）が決めるので、
 * どの scene とどの timeMode も独立に組み合わせられる。
 */

export class SceneryPlan {
  async load(segmentsUrl, presetsUrl) {
    const [s, p] = await Promise.all([fetch(segmentsUrl).then((r) => r.json()), fetch(presetsUrl).then((r) => r.json())]);
    this.segments = s.segments.slice().sort((a, b) => a.startKm - b.startKm);
    this.crossfadeKm = s.crossfadeKm ?? 2;
    this.presets = new Map(p.presets.map((x) => [x.id, x]));
    const maxKm = this.segments[this.segments.length - 1].endKm;
    this.index = new Int16Array(maxKm + 1).fill(-1);
    this.segments.forEach((g, i) => {
      for (let k = g.startKm; k <= g.endKm; k++) this.index[k] = i;
    });
    return this;
  }

  get ready() {
    return !!this.index;
  }

  /** 整数 km の区間番号（範囲外はクランプ） */
  _seg(km) {
    const i = Math.max(0, Math.min(this.index.length - 1, Math.round(km)));
    return this.index[i];
  }

  /** km → { sceneId, preset, segment } */
  sceneAt(km) {
    const g = this.segments[this._seg(km)];
    return { sceneId: g.sceneId, preset: this.presets.get(g.sceneId), segment: g };
  }

  /**
   * km → クロスフェード込みの景観。
   * @returns {{ from: object, to: object, t: number, sceneId: string, segment: object }}
   *   t = 0 なら from だけ。境界の手前では from = 今の区間・to = 次、境界を越えた直後は from = 前・to = 今の区間
   */
  resolve(km) {
    const si = this._seg(km);
    const g = this.segments[si];
    const cur = this.presets.get(g.sceneId);
    const half = this.crossfadeKm / 2;
    const out = { from: cur, to: cur, t: 0, sceneId: g.sceneId, segment: g };
    const next = this.segments[si + 1];
    const prev = this.segments[si - 1];
    const bEnd = g.endKm + 0.5; // 次の区間との境界
    const bStart = g.startKm - 0.5; // 前の区間との境界
    if (next && km > bEnd - half && next.sceneId !== g.sceneId) {
      out.to = this.presets.get(next.sceneId);
      out.t = (km - (bEnd - half)) / (2 * half); // 0 → 0.5（境界）
    } else if (prev && km < bStart + half && prev.sceneId !== g.sceneId) {
      out.from = this.presets.get(prev.sceneId);
      out.to = cur;
      out.t = 0.5 + (km - bStart) / (2 * half); // 0.5（境界）→ 1
    }
    out.t = Math.max(0, Math.min(1, out.t));
    return out;
  }
}
