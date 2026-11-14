/**
 * interior/blanket.js — 【v13】ひざ掛け（座った人の膝〜太もも全体を覆う、固定メッシュの布）
 * ---------------------------------------------------------------------------
 * 目的：スカート姿で座った人（リンさん）を、葉っぱの低い視点から見てもスカートの内側が見えないようにする。
 *       「カメラ対策の板」ではなく、太もも・膝の丸みとソファーの座面に沿って垂れる布に見せる。
 *       布のシミュレーションはしない（約 1,800 三角形の固定メッシュ・draw call 1）。
 *
 * 形（座った人のローカル座標：原点 = 腰の真下の座面、-Z = 正面、+Y = 上、X = 左右）
 *
 *      横から見た図                         正面から見た図
 *        ┌──────── 太ももの上 ──╮              ╭──────────────╮  ← 上面（左右の太ももでわずかにくぼむ）
 *   お腹 │                      │膝の丸み      │   太もも × 2   │
 *   ─────┴── 座面 ──────┐       │            ─╯              ╰─  ← 脇は座面まで垂れ、座面の上に少し広がる
 *                       │ 座席  │← 前垂れ（膝より下、すねの中ほどまで）
 *
 *   ・上面 → 両脇は丸く折れて座面まで垂れる（座面に届いた余りは座面の上へ広がる。座面の端より前では下へ垂れる）
 *   ・膝を回り込んで前へ垂れる（前垂れ）。前垂れの両端は後ろへ回り込み、ベンチの前面まで届く
 *     → 横・斜め下から見ても、脚のまわりは布で閉じている
 *   ・内側の「ふさぎ布」：スカートの裾の位置に、座面〜上面の高さの暗い布を 1 枚。
 *     前垂れの下からのぞき込んでも、見えるのはこの布（ひざ掛けの裏）まで。
 *
 * @typedef {object} LapRig
 * @property {number} seatY    座面の高さ（ローカル y。通常 0）
 * @property {number} hipY     股関節の高さ
 * @property {number} kneeY    膝関節の高さ
 * @property {number} kneeZ    膝関節の前後位置（負 = 前）
 * @property {number} kneeX    膝関節の左右位置（中心からの距離）
 * @property {number} thighR   太ももの半径（股関節側）
 * @property {number} kneeR    膝の半径
 * @property {number} seatEdgeZ 座面の前の端（ローカル z。負 = 前）。ここより前では脇の布は座面に載らず、下へ垂れる
 * @property {Array<[number, number]>} [profile] 太もも・スカートの上面の高さ [[z, y], ...]（測った形に沿わせる）
 * @property {number} [lapHalf] 太もも・スカートの左右の広がり
 * @property {number} [hemZ]    スカートの裾の前端（ふさぎ布をそのすぐ前に置く）
 */
import * as THREE from 'three';

const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * @param {LapRig} rig
 * @param {{ halfWidth?: number, flap?: number, back?: number }} [o]
 *   halfWidth … 布の幅の半分 [m]（既定 0.42 = 幅 84 cm）
 *   flap      … 膝から前へ垂れる長さ [m]（既定 0.3 = 膝より下、すねの中ほど）
 *   back      … お腹側の端の前後位置（ローカル z。既定 -0.1 = お腹のすぐ前）
 * @returns {THREE.BufferGeometry} position / normal / uv / color（color：布 = 白、ふさぎ布 = 暗い色）
 */
export function lapBlanketGeometry(rig, o = {}) {
  const S = o.halfWidth ?? 0.42;
  const flap = o.flap ?? 0.3;
  const zBack = o.back ?? -0.1;
  const gap = 0.014; // 体から浮かせる厚み
  const a = Math.max(rig.kneeX + rig.thighR * 0.92, (rig.lapHalf ?? 0) - 0.03); // 上面の半幅（太もも・スカートの外側まで）
  const r = 0.05; // 脇の折れの丸み
  const rK = rig.kneeR + gap; // 膝の丸み
  const zKnee = rig.kneeZ - 0.02; // 膝の丸みが始まる位置（ここから前へ rK 張り出す）
  // 上面の高さ：測った形（太もも・スカートの上面）があればそれに沿わせる。無ければ腰 → 膝の直線
  const yLine = (z) => {
    const k = Math.max(0, Math.min(1, (zBack - z) / (zBack - zKnee)));
    return rig.hipY + rig.thighR + (rig.kneeY + rig.kneeR - rig.hipY - rig.thighR) * k;
  };
  const prof = (rig.profile ?? []).slice().sort((p, q) => p[0] - q[0]);
  const yBody = (z) => {
    if (prof.length < 2) return yLine(z);
    // 前後 4.5 cm の範囲でいちばん高い所（布は出っ張りの間に張る）→ 前後をなめらかに補間
    const env = (zz) => {
      let m = -Infinity;
      for (const [pz, py] of prof) if (Math.abs(pz - zz) <= 0.045) m = Math.max(m, py);
      return m > -Infinity ? m : yLine(zz);
    };
    const zc = Math.max(prof[0][0], Math.min(prof[prof.length - 1][0], z));
    return (env(zc - 0.03) + 2 * env(zc) + env(zc + 0.03)) / 4;
  };
  const yTopAt = (z) => Math.max(yBody(z), rig.kneeY + rig.kneeR) + gap;
  const yHip = yTopAt(zBack); // 上面の高さ（お腹側）
  const yKnee = yTopAt(zKnee); // 上面の高さ（膝側）
  const edge = rig.seatEdgeZ ?? rig.kneeZ + 0.04; // 座面の前の端
  const wing = Math.max(0.06, edge - (zKnee - rK) - 0.006); // 前垂れの両端が後ろへ回り込む深さ（ベンチの前面まで）

  // ---- 中心線（お腹 → 太ももの上 → 膝の丸み → 前垂れ）：弧長 t → 位置・外向きの法線 ----
  const lapLen = zBack - zKnee;
  const arcLen = (Math.PI / 2) * rK;
  const total = lapLen + arcLen + flap;
  const path = (t) => {
    if (t <= lapLen) {
      const k = t / lapLen;
      // お腹の際は少し持ち上がる（体に寄せた端）
      const y = yTopAt(zBack - t) + 0.015 * (1 - smooth(0, 0.2, k));
      return { z: zBack - t, y, nz: 0, ny: 1 };
    }
    if (t <= lapLen + arcLen) {
      const th = (t - lapLen) / rK;
      return { z: zKnee - rK * Math.sin(th), y: yKnee - rK + rK * Math.cos(th), nz: -Math.sin(th), ny: Math.cos(th) };
    }
    const d = t - lapLen - arcLen;
    // 前垂れはわずかに手前へ戻る（重さで垂直より少し内側へ）
    return { z: zKnee - rK + 0.02 * smooth(0, flap, d), y: yKnee - rK - d, nz: -1, ny: 0 };
  };

  const NU = 34;
  const NV = 40;
  const pos = [];
  const uv = [];
  const col = [];
  const idx = [];
  for (let j = 0; j <= NV; j++) {
    const v = j / NV;
    for (let i = 0; i <= NU; i++) {
      const u = i / NU;
      const s = (u * 2 - 1) * S; // 布の横方向の位置（中心 0）
      const as = Math.abs(s);
      const sg = Math.sign(s) || 1;
      // 前垂れの裾は波打ち、両端は少し長く垂れる
      const hem = 1 + 0.035 * Math.cos(s * 11) + 0.05 * smooth(a * 0.6, a + r, as);
      const t = Math.min(total * hem, v * total * hem);
      const p = path(Math.min(t, total));
      const over = Math.max(0, t - total); // 裾の伸びたぶん（まっすぐ下へ）
      const k = smooth(lapLen, lapLen + arcLen, t); // 0 = 太ももの上、1 = 前垂れ（しわ・広がりの切替）
      // 脇が垂れられる深さ（脇の面 x = ±(a + r) を重なりなく 1 回だけ覆うよう、区間ごとに決める）
      //   太ももの上：座面まで（膝の丸みの中心より下へは下げない）
      //   膝の丸み　：丸みの半径まで（扇形）
      //   前垂れ　　：後ろへ回り込んでベンチの前面まで（裾へ向かって少し浅く）
      const hang = smooth(edge + 0.012, edge - 0.03, p.z); // 0 = 座面の上、1 = 座面の端より前
      let dMax;
      if (t <= lapLen) dMax = Math.max(0.03, p.y - Math.max(rig.seatY + 0.004, yKnee - rK + 0.002));
      else if (t <= lapLen + arcLen) dMax = rK * 0.98;
      else dMax = wing * (1 - 0.3 * smooth(0, flap, t - lapLen - arcLen));
      // ---- 断面：平らな上面 → 丸い肩 → まっすぐ垂れる → （座面に届いたら）外へ広がる ----
      let x;
      let d;
      if (as <= a) {
        x = as;
        // 左右の太ももの間はわずかにくぼみ、外側へ向かってなだらかに下がる
        d = (0.011 * Math.exp(-((as / 0.04) ** 2)) + 0.012 * (as / a) ** 2) * (1 - k);
      } else if (as <= a + (Math.PI / 2) * r) {
        const th = (as - a) / r;
        x = a + r * Math.sin(th);
        d = 0.012 * (1 - k) + r * (1 - Math.cos(th));
      } else {
        x = a + r;
        d = 0.012 * (1 - k) + r + (as - a - (Math.PI / 2) * r);
      }
      let flat = 0;
      if (d > dMax) {
        flat = (d - dMax) * (1 - k) * (1 - hang); // 座面の上へ広がる（前垂れ・座面の端より前では広がらない）
        d = dMax;
      }
      // 布のしわ：前垂れは縦のひだ、上面はごく浅いうねり
      const fold = 0.007 * Math.sin(s * 34 + 1.3) * k * smooth(0, 0.1, t - lapLen) + 0.0025 * Math.sin(s * 21 + v * 17) * (1 - k);
      const px = sg * (x + flat * 0.92);
      const py = p.y - p.ny * d + p.ny * fold - over + flat * 0.004;
      const pz = p.z - p.nz * d + p.nz * fold + flat * 0.02 * Math.sin(v * 9 + sg);
      pos.push(px, Math.max(py, k < 0.5 && hang < 0.5 ? rig.seatY + 0.004 : -1e9), pz);
      uv.push(u, 1 - v);
      col.push(1, 1, 1);
    }
  }
  for (let j = 0; j < NV; j++) {
    for (let i = 0; i < NU; i++) {
      const p0 = j * (NU + 1) + i;
      const p1 = p0 + 1;
      const p2 = p0 + NU + 1;
      const p3 = p2 + 1;
      idx.push(p0, p2, p1, p1, p2, p3);
    }
  }

  // ---- 内側のふさぎ布（裾の位置。座面〜上面のすぐ下、太ももの外側まで） ----
  {
    const base = pos.length / 3;
    const zs = rig.hemZ != null ? rig.hemZ - 0.012 : rig.kneeZ + (o.sealBack ?? 0.08);
    const w = a + r - 0.012;
    const y0 = rig.seatY - 0.09; // 座面の端より前では、裾の下側も隠れるよう少し下まで
    const y1 = yTopAt(zs) - 0.012;
    for (const [x, y] of [[-w, y0], [w, y0], [-w, y1], [w, y1]]) {
      pos.push(x, y, zs);
      uv.push(0.5, 0.5);
      col.push(0.16, 0.2, 0.16);
    }
    idx.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.userData.top = { yHip, yKnee, zBack, zKnee, a };
  return g;
}
