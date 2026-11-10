/**
 * environment.js — 空・海・海底・ライト・フォグ
 * ---------------------------------------------------------------------------
 * 海は地形とは別メッシュ（Y=0 の1枚板）。半透明にして、地形データ側の
 * 海底色（浅瀬はエメラルド、外洋は紺）を透かすことで
 * 瀬戸内海・東シナ海・太平洋・日本海の雰囲気を出す。
 * 深い海（地形タイルを持たない領域）は海底プレーンで受ける。
 *
 * draw call: 空1 + 海1 + 海底1
 * 海面は同心円分割の円板（約2千三角形）。カメラ近くの深度精度のため。
 */
import * as THREE from 'three';
import { metersToY } from './geo.js';

const SKY_HORIZON = new THREE.Color('#bcd6ea');
const SKY_ZENITH = new THREE.Color('#3f7fc0');
const WATER_SIZE = 40000; // km（地平線まで覆う）
const WAVE_TILE = 5; // km（波模様1周期）
// v8: 南国の浅瀬を出す範囲（ワールド z。北緯 27.58° → 27.47°でなめらかに。徳之島の南端 27.66° は含まない）
export const TROPIC_Z0 = -(27.58 - 31.0) * ((6371.0088 * Math.PI) / 180);
export const TROPIC_Z1 = -(27.47 - 31.0) * ((6371.0088 * Math.PI) / 180);

export class Environment {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'environment';
    scene.add(this.group);

    // ---- ライト（陰影図の慣例どおり北西上空から）----
    this.hemi = new THREE.HemisphereLight(0xdfeeff, 0x3b4a36, 1.35);
    this.sun = new THREE.DirectionalLight(0xfff2dd, 2.3);
    this.sun.position.set(-0.9, 1.25, -0.55).multiplyScalar(1000);
    this.group.add(this.hemi, this.sun, this.sun.target);

    // ---- フォグ（高度に応じて距離を変える）----
    scene.fog = new THREE.Fog(SKY_HORIZON.clone(), 200, 2000);
    scene.background = SKY_HORIZON.clone();

    // ---- 空（グラデーションドーム）----
    const skyGeo = new THREE.SphereGeometry(1, 32, 16);
    const skyMat = new THREE.ShaderMaterial({
      uniforms: {
        uHorizon: { value: SKY_HORIZON.clone() },
        uZenith: { value: SKY_ZENITH.clone() },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main(){
          vDir = normalize(position);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;   // 常に最遠
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uHorizon; uniform vec3 uZenith;
        varying vec3 vDir;
        void main(){
          float h = clamp(vDir.y, 0.0, 1.0);
          vec3 c = mix(uHorizon, uZenith, pow(h, 0.55));
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });
    this.sky = new THREE.Mesh(skyGeo, skyMat);
    this.sky.name = 'sky';
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    this.sky.scale.setScalar(5000);
    this.group.add(this.sky);

    // ---- 海面 ----
    const normalTex = makeWaveNormalTexture(128);
    normalTex.wrapS = normalTex.wrapT = THREE.RepeatWrapping;
    normalTex.repeat.set(WATER_SIZE / WAVE_TILE, WATER_SIZE / WAVE_TILE);
    this.waterNormal = normalTex;
    const waterMat = new THREE.MeshPhongMaterial({
      color: 0x1f6a96,
      specular: 0x0e1820,
      shininess: 220,
      transparent: true,
      opacity: 0.74,
      normalMap: normalTex,
      normalScale: new THREE.Vector2(0.35, 0.35),
      depthWrite: false,
    });
    // 2 枚の巨大な三角形だと、カメラ近くで深度の補間精度が足りず海面が陸地の上に描かれることがあるため、
    // カメラ中心の同心円状に分割した板にする（見た目・UV は従来の 1 枚板と同じ）
    const waterGeo = makeRadialPlane(WATER_SIZE);
    // v8: 沖永良部島以南（北緯 27.5° 付近より南）は海面を少し透明にして、地形側のエメラルドの浅瀬（terrain.js）を見せる。
    //     沖合は地形の海底色が深い紺なので、透明にしても深い青のまま。
    waterMat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vTodW;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvTodW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vTodW;')
        .replace('vec4 diffuseColor = vec4( diffuse, opacity );', `vec4 diffuseColor = vec4( diffuse, opacity );
          float todTropic = smoothstep( ${TROPIC_Z0.toFixed(1)}, ${TROPIC_Z1.toFixed(1)}, vTodW.z );
          diffuseColor.a *= mix( 1.0, 0.62, todTropic );`);
    };
    waterMat.customProgramCacheKey = () => 'dht-sea-v8';
    this.water = new THREE.Mesh(waterGeo, waterMat);
    this.water.name = 'sea-surface';
    this.water.renderOrder = 2;
    this.group.add(this.water);

    // ---- 海底プレーン（地形タイルがない深海部）----
    const bedGeo = new THREE.PlaneGeometry(WATER_SIZE, WATER_SIZE, 1, 1);
    bedGeo.rotateX(-Math.PI / 2);
    // 地形側の深海色 (terrain.js C.deep を γ2.2 でリニア化) と同じ色・同じライティング
    const bedMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(0.05 ** 2.2, 0.16 ** 2.2, 0.3 ** 2.2) });
    this.seabed = new THREE.Mesh(bedGeo, bedMat);
    this.seabed.position.y = metersToY(-420); // タイルの海底(-250m)より下に置き、Zファイティングを避ける
    this.seabed.name = 'seabed';
    this.group.add(this.seabed);
  }

  /** v8: 時間帯の見た目（timeofday.js の LOOKS を補間した値）を反映 */
  applyLook(L) {
    this.hemi.color.copy(L.hemiSky);
    this.hemi.groundColor.copy(L.hemiGround);
    this.hemi.intensity = L.hemi;
    this.sun.color.copy(L.sunColor);
    this.sun.intensity = L.sun;
    this.sun.position.copy(L.sunDir).multiplyScalar(1000);
    const u = this.sky.material.uniforms;
    u.uHorizon.value.copy(L.horizon);
    u.uZenith.value.copy(L.zenith);
    this.scene.fog.color.copy(L.fog);
    this.scene.background.copy(L.horizon);
    const wm = this.water.material;
    wm.color.copy(L.water);
    wm.opacity = L.waterOpacity;
    wm.specular.copy(L.waterSpec);
  }

  /** 毎フレーム：空と海をカメラに追従させ、高度に応じてフォグを調整 */
  update(camera, dt, altitudeAboveSurface) {
    const p = camera.position;
    this.sky.position.copy(p);
    // 波テクスチャの1周期単位で追従させ、模様が世界に対して動かないようにする
    this.water.position.x = Math.round(p.x / WAVE_TILE) * WAVE_TILE;
    this.water.position.z = Math.round(p.z / WAVE_TILE) * WAVE_TILE;
    this.seabed.position.x = this.water.position.x;
    this.seabed.position.z = this.water.position.z;
    this.waterNormal.offset.x = (this.waterNormal.offset.x + dt * 0.012) % 1;
    this.waterNormal.offset.y = (this.waterNormal.offset.y + dt * 0.007) % 1;

    const alt = Math.max(0.05, altitudeAboveSurface);
    const far = THREE.MathUtils.clamp(260 + alt * 6.0, 260, 9000);
    this.scene.fog.far = far;
    this.scene.fog.near = far * 0.18;
  }
}

/**
 * 原点中心・半径 size/2 の水平な円板（中心付近ほど細かい同心円分割）。
 * UV は PlaneGeometry(size, size) を X 軸回転したものと同じ対応（u = x/size + 0.5, v = 0.5 - z/size）。
 */
function makeRadialPlane(size) {
  const R = size / 2;
  const SEG = 48;
  const radii = [0];
  for (let r = 0.25; r < R; r *= 1.45) radii.push(r);
  radii.push(R);
  const pos = [];
  const uv = [];
  for (const r of radii)
    for (let k = 0; k < SEG; k++) {
      const a = (k / SEG) * Math.PI * 2;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      pos.push(x, 0, z);
      uv.push(x / size + 0.5, 0.5 - z / size);
    }
  const idx = [];
  for (let i = 0; i < radii.length - 1; i++)
    for (let k = 0; k < SEG; k++) {
      const a = i * SEG + k;
      const b = i * SEG + ((k + 1) % SEG);
      const c = a + SEG;
      const d = b + SEG;
      idx.push(a, b, c, b, d, c);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length / 3).fill([0, 1, 0]).flat(), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/** 小さな波の法線マップ（タイル可能）を手続き生成。テクスチャはこれ1枚のみ */
function makeWaveNormalTexture(size) {
  const h = new Float32Array(size * size);
  const waves = [
    [1, 2, 0.6], [3, -1, 0.35], [-2, 3, 0.3], [5, 4, 0.18], [-6, 2, 0.12], [7, -5, 0.1], [2, 9, 0.08],
  ];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let v = 0;
      for (const [kx, ky, a] of waves) v += a * Math.sin(((kx * x + ky * y) / size) * Math.PI * 2 + kx * 1.3);
      h[y * size + x] = v;
    }
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const l = h[y * size + ((x - 1 + size) % size)];
      const r = h[y * size + ((x + 1) % size)];
      const u = h[((y - 1 + size) % size) * size + x];
      const d = h[((y + 1) % size) * size + x];
      const nx = (l - r) * 0.5;
      const ny = (u - d) * 0.5;
      const nz = 1;
      const il = 1 / Math.hypot(nx, ny, nz);
      const k = (y * size + x) * 4;
      data[k] = (nx * il * 0.5 + 0.5) * 255;
      data[k + 1] = (ny * il * 0.5 + 0.5) * 255;
      data[k + 2] = (nz * il * 0.5 + 0.5) * 255;
      data[k + 3] = 255;
    }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}
