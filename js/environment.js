/**
 * environment.js — 空・海・海底・ライト・フォグ
 * ---------------------------------------------------------------------------
 * 海は地形とは別メッシュ（Y=0 の1枚板）。半透明にして、地形データ側の
 * 海底色（浅瀬はエメラルド、外洋は紺）を透かすことで
 * 瀬戸内海・東シナ海・太平洋・日本海の雰囲気を出す。
 * 深い海（地形タイルを持たない領域）は海底プレーンで受ける。
 *
 * draw call: 空1 + 海1 + 海底1
 */
import * as THREE from 'three';
import { metersToY } from './geo.js';

const SKY_HORIZON = new THREE.Color('#bcd6ea');
const SKY_ZENITH = new THREE.Color('#3f7fc0');
const WATER_SIZE = 40000; // km（地平線まで覆う）
const WAVE_TILE = 5; // km（波模様1周期）

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
        uHorizon: { value: SKY_HORIZON },
        uZenith: { value: SKY_ZENITH },
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
    const waterGeo = new THREE.PlaneGeometry(WATER_SIZE, WATER_SIZE, 1, 1);
    waterGeo.rotateX(-Math.PI / 2);
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
