/**
 * interior/wake.js — 【v16】船の航跡（wake）。Aft Observation Deck から見る演出
 * ---------------------------------------------------------------------------
 * 海面のすぐ上に置いた 1 枚の半透明の帯（draw call 1）に、軽いシェーダで泡を描く。
 *   ・船尾の直後：白い泡・太い航跡・強い乱れ（プロペラの撹拌）
 *   ・後方へ伸びるにつれて：細く・薄く・左右へ広がり、徐々に海へ馴染む
 *   ・ケルビン波（左右に約 19.5° で開く 2 本の筋）を薄く重ねる
 * ※ 描画は MAP と同じ renderer（logarithmicDepthBuffer: true）なので、logdepthbuf の chunk を必ず入れる。
 * 泡の模様は「海に固定」：船から見ると後方（+X）へ流れる（scenery の offset と同じ速さ）。
 * ノイズは 1 枚の小さなテクスチャ（128×128）を 3 回引くだけ。パーティクル・追加の描画パスは使わない。
 * 帯は船尾（x = stern）から後方へ len m、幅はケルビン波の外側まで。後方ほど頂点を粗く（距離の 1.6 乗）。
 */
import * as THREE from 'three';
import { rng } from './kit.js';

function noiseTexture(size = 128) {
  const r = rng(9191);
  // 格子の値ノイズを 2 段重ねて、なめらかに繰り返すテクスチャを作る
  const data = new Uint8Array(size * size * 4);
  const grid = (n) => {
    const g = new Float32Array(n * n);
    for (let i = 0; i < g.length; i++) g[i] = r();
    return (x, y) => {
      const fx = (x / size) * n;
      const fy = (y / size) * n;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const tx = fx - x0;
      const ty = fy - y0;
      const sx = tx * tx * (3 - 2 * tx);
      const sy = ty * ty * (3 - 2 * ty);
      const at = (i, j) => g[((j + n) % n) * n + ((i + n) % n)];
      const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
      const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
      return a + (b - a) * sy;
    };
  };
  const g1 = grid(8);
  const g2 = grid(16);
  const g3 = grid(32);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = g1(x, y) * 0.5 + g2(x, y) * 0.3 + g3(x, y) * 0.2;
      const k = (y * size + x) * 4;
      data[k] = data[k + 1] = data[k + 2] = Math.round(v * 255);
      data[k + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, size, size);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

const VERT = /* glsl */ `
  varying vec2 vP;
  #include <common>
  #include <fog_pars_vertex>
  #include <logdepthbuf_pars_vertex>
  void main() {
    vP = position.xz; // x = 船尾からの距離 [m]、z = 中心線からの横 [m]
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <logdepthbuf_vertex>
    #include <fog_vertex>
  }
`;

const FRAG = /* glsl */ `
  uniform sampler2D uNoise;
  uniform float uTime;
  uniform float uOffset;
  uniform float uLight;
  uniform float uOpacity;
  uniform vec3 uFoam;
  uniform vec3 uChurn;
  varying vec2 vP;
  #include <common>
  #include <fog_pars_fragment>
  #include <logdepthbuf_pars_fragment>
  float nz(vec2 p) { return texture2D(uNoise, p).r; }
  void main() {
    #include <logdepthbuf_fragment>
    float d = max(vP.x, 0.0);
    float z = vP.y;
    float az = abs(z);
    // 海に固定した座標（船から見ると後方へ流れる）
    float wx = d - uOffset;
    // ---- 中央の太い航跡：船尾で幅 ~3.4 m → 後方へゆっくり広がる ----
    float hw = 3.2 + 2.2 * (1.0 - exp(-d / 25.0)) + 0.05 * d; // 撹拌された水の幅（後方へ広がる）
    float fw = (3.0 + 2.4 * (1.0 - exp(-d / 20.0))) * (0.45 + 0.55 * exp(-d / 260.0)) + 0.012 * d; // 白い泡の幅（後方ほど細く）
    float core = 1.0 - smoothstep(0.3 * fw, fw, az);
    float wide = 1.0 - smoothstep(0.2 * hw, hw, az);
    vec2 q = vec2(wx * 0.04, z * 0.09);
    float t1 = nz(q + vec2(uTime * 0.012, 0.0));
    float t2 = nz(q * 3.0 + vec2(uTime * 0.05, -uTime * 0.03));
    float t3 = nz(q * 8.0 + vec2(-uTime * 0.13, uTime * 0.07));
    float turb = t1 * 0.5 + t2 * 0.32 + t3 * 0.18;
    float near = exp(-d / 85.0); // 船尾の直後ほど白い
    float far = exp(-d / 380.0); // 後方は薄く海へ馴染む
    // 泡：近いほど面で白く、遠いほど筋（ノイズのしきい値を上げる）
    float th = mix(0.62, 0.36, near);
    float foam = core * smoothstep(th - 0.12, th + 0.1, turb) * (near * 1.15 + far * 0.55);
    foam += core * exp(-d / 16.0) * (0.55 + 0.45 * t3); // プロペラの撹拌（船尾のすぐ後ろ）
    // 縁の細い泡の筋（航跡の両端が少し崩れる）
    float edge = exp(-pow((az - fw * 0.9) / (0.6 + d * 0.012), 2.0)) * far * smoothstep(0.45, 0.7, t2) * 0.6;
    // ---- ケルビン波：左右に約 19.5° で開く 2 本の筋。後方ほど薄く・太く ----
    float arm = d * 0.354 + 3.6;
    float aw = 0.7 + d * 0.022;
    float kel = exp(-pow((az - arm) / aw, 2.0)) * exp(-d / 240.0) * (0.3 + 0.7 * nz(vec2(wx * 0.08, z * 0.05)));
    // 撹拌された水の明るい青緑（泡の下の色）
    float churn = wide * (0.55 * near + 0.4 * far);
    float a = clamp(foam + edge + kel * 0.5, 0.0, 1.0);
    vec3 col = mix(uChurn, uFoam, clamp(a * 1.3, 0.0, 1.0)) * uLight;
    float alpha = clamp(a + churn * 0.28, 0.0, 0.96) * uOpacity;
    // 帯の端で 0 へ（ポリゴンの縁を見せない）
    alpha *= 1.0 - smoothstep(0.82, 1.0, az / (arm + aw * 3.0 + 6.0));
    gl_FragColor = vec4(col, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

export class ShipWake {
  /**
   * @param {{ x: number, y: number, z: number, len?: number }} o  x = 船尾、y = 海面の少し上、z = 中心線
   */
  constructor(o) {
    const len = o.len ?? 760;
    const N = 72;
    const pos = [];
    const idx = [];
    for (let i = 0; i <= N; i++) {
      const d = len * Math.pow(i / N, 1.6);
      const half = d * 0.354 + 3.6 + (0.7 + d * 0.022) * 3 + 6;
      pos.push(d, 0, -half, d, 0, half);
      if (i < N) {
        const k = i * 2;
        idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    this.tex = noiseTexture();
    this.material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uNoise: { value: null },
          uTime: { value: 0 },
          uOffset: { value: 0 },
          uLight: { value: 1 },
          uOpacity: { value: 0.92 },
          uFoam: { value: new THREE.Color('#ffffff') },
          uChurn: { value: new THREE.Color('#9fdcd6') },
        },
      ]),
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      fog: true,
      side: THREE.DoubleSide,
    });
    this.material.uniforms.uNoise.value = this.tex;
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.name = 'ship-wake';
    this.mesh.position.set(o.x, o.y, o.z);
    this.mesh.renderOrder = 1;
    this.group = this.mesh;
    this.t = 0;
  }

  /** 時間帯（looks.js の値）：泡の明るさ・撹拌された水の色 */
  applyLook(L) {
    const day = Math.min(1, L.sun / 2.1);
    const u = this.material.uniforms;
    u.uLight.value = 0.22 + 0.78 * day + 0.06 * (L.interiorFill ?? 0);
    u.uChurn.value.set('#9fdcd6').lerp(L.haze, 0.25);
    u.uFoam.value.set('#ffffff').lerp(L.sunColor ?? new THREE.Color(1, 1, 1), 0.15);
    u.uOpacity.value = 0.6 + 0.32 * day;
  }

  /** offset = 景色の累積の流れ [m]（WindowScenery.offset） */
  update(dt, offset) {
    this.t += dt;
    const u = this.material.uniforms;
    u.uTime.value = this.t;
    // 模様の周期（x 方向 25 m。ノイズの倍率 0.04・0.12・0.32・0.08 はすべて 25 m で一巡）で折り返して精度を保つ
    u.uOffset.value = ((offset % 25) + 25) % 25;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.tex.dispose();
  }
}
