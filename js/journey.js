/**
 * journey.js — 【v5】DHT EXPRESS のルート表示（新幹線・鹿児島接続区間・フェリー航路・距離ノード）
 * ---------------------------------------------------------------------------
 * 距離の計算は route.js（DistanceRoute / Journey）が担当し、ここは「見せ方」だけを持つ。
 *
 * 描画（すべて共有ジオメトリ・共有マテリアル。合計 draw call 7）
 *   ・新幹線     : Line2 ×2（芯 = 明るいシアンの細線 / 外側 = 加算合成の柔らかい発光帯）
 *   ・接続区間   : Line2 ×1（鹿児島中央 → 鹿児島新港。暖色の点線＝鉄道ではない）
 *   ・フェリー   : Line2 ×2（芯 = アクア〜白の破線 / 外側 = 淡い発光帯）
 *   ・ノード     : 1 つの InstancedMesh（カメラを向く板 + 自前シェーダ）に
 *                  新幹線 10km ノード 133 個・フェリー 10km 航路灯 74 個・寄港地 7・始点/終点 を全部入れる
 *                  → draw call 1。発光は加算合成（ポストプロセスなし）
 *
 * 高さ
 *   ・ルート線とノードは「地表の少し上」。頂点ごとに 2 つの高さを持つ：
 *       yHi     … 詳細地形（1km）の地表（未読込なら粗い地形）。周囲の最大値で、細い谷に沈まない
 *       yCoarse … 粗い地形（4km。遠景で表示される地形）と yHi の大きい方
 *     シェーダでカメラからの距離に応じて切り替え、さらに距離に比例して少し持ち上げる（遠景でも地形に埋もれない）。
 *   ・トンネル区間も地形は削らず、山の上を地表に沿って通す（ルート表示としての線）。
 *   ・詳細地形が読み込まれたら（terrain.hiData の数が変わったら）高さを計算し直す。
 *
 * ノードの LOD（シェーダ内でカメラ距離から計算。データは全ノードを常に保持）
 *   ・10km      : 〜160km で表示、300km で消える
 *   ・50km      : 〜450km、700km で消える
 *   ・100km     : 常時（遠景では小さな光点、近景では球 + リング）
 *   ・始点・終点 : 常時（大きめ、二重リング）
 *   ・航路灯     : 〜130km（白〜アクアの小さな光）
 *   ・寄港地     : 常時（アクアの球 + リング）
 *
 * データ参照（window.DHT.journey）
 *   journey.journey          … route.js の Journey（getJourneyPosition など）
 *   journey.railNodes        … 新幹線 10km ノード [{ km, tier:'minor'|'mid'|'major'|'start'|'rail-end', x, z, lat, lon }]
 *   journey.ferryNodes       … フェリー 10km 航路灯
 *   journey.nodeMesh.userData.items[instanceId] … Raycaster でノードのデータ
 */
import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { VERTICAL_EXAGGERATION, latLonToWorld } from './geo.js';

const M2Y = VERTICAL_EXAGGERATION / 1000;

/** ノードの種類（シェーダの tier 番号と見た目） */
const TIER = {
  minor: { id: 0, color: '#2fd8ff', r: 0.32, minPx: 2.6, maxPx: 22 }, // 新幹線 10km
  mid: { id: 1, color: '#4fe6ff', r: 0.4, minPx: 3.4, maxPx: 26 }, // 新幹線 50km
  major: { id: 2, color: '#8ff4ff', r: 0.55, minPx: 4.6, maxPx: 34 }, // 新幹線 100km
  start: { id: 3, color: '#ffe27a', r: 0.8, minPx: 7, maxPx: 46 }, // 0km（東京）
  'rail-end': { id: 4, color: '#ffb35c', r: 0.8, minPx: 7, maxPx: 46 }, // RAIL END（鹿児島中央）
  ferry: { id: 5, color: '#d6fff4', r: 0.24, minPx: 2.2, maxPx: 16 }, // 航路灯 10km
  port: { id: 6, color: '#6ff5d6', r: 0.62, minPx: 5.5, maxPx: 38 }, // 寄港地
};

/* 共通 GLSL：カメラ距離に応じた高さの選択と持ち上げ */
const LIFT_GLSL = /* glsl */ `
  uniform float dhtLiftK;
  uniform float dhtLiftMin;
  uniform float dhtLiftMax;
  float dhtCamDist( vec3 p ) { return distance( p, cameraPosition ); }
  // yHi: 詳細地形基準 / yC: 粗い地形基準。170km 前後で粗い地形のタイルに切り替わるので、それより手前から混ぜる
  float dhtY( vec3 p, float yC ) {
    float d = dhtCamDist( p );
    float y = mix( p.y, max( p.y, yC ), smoothstep( 120.0, 200.0, d ) );
    return y + clamp( d * dhtLiftK, dhtLiftMin, dhtLiftMax );
  }
`;

function liftUniforms() {
  return {
    dhtLiftK: { value: 0.0022 },
    dhtLiftMin: { value: 0.035 },
    dhtLiftMax: { value: 3.0 },
  };
}

/** LineMaterial に「高さの切替 + 距離による持ち上げ」を足す */
function patchLineMaterial(mat, key) {
  const lift = liftUniforms();
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, lift);
    shader.vertexShader = shader.vertexShader
      .replace('uniform float linewidth;', `uniform float linewidth;\nattribute float instanceYcStart;\nattribute float instanceYcEnd;\n${LIFT_GLSL}`)
      .replace(
        'vec4 start = modelViewMatrix * vec4( instanceStart, 1.0 );',
        'vec3 dhtS = instanceStart; dhtS.y = dhtY( instanceStart, instanceYcStart );\n\t\t\tvec4 start = modelViewMatrix * vec4( dhtS, 1.0 );',
      )
      .replace(
        'vec4 end = modelViewMatrix * vec4( instanceEnd, 1.0 );',
        'vec3 dhtE = instanceEnd; dhtE.y = dhtY( instanceEnd, instanceYcEnd );\n\t\t\tvec4 end = modelViewMatrix * vec4( dhtE, 1.0 );',
      );
  };
  mat.customProgramCacheKey = () => `dht-route-line-${key}`;
  mat.userData.lift = lift;
  return mat;
}

/* ---------------------------------------------------------------------- */
/* 発光ノードのシェーダ（カメラを向く板。中心に球のような陰影、外側に柔らかい glow、強調ノードにリング） */
/* ---------------------------------------------------------------------- */
const NODE_VERT = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  attribute vec3 iPos;      // x, yHi, z
  attribute float iYc;      // 粗い地形基準の Y
  attribute vec4 iStyle;    // tier, 半径[km], 最小px, 最大px
  attribute vec3 iColor;
  uniform float uViewportH;
  uniform float uVisible;
  ${LIFT_GLSL}
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vTier;
  varying float vPx;

  // ノードの種類ごとの LOD（カメラ距離 d [km] → 不透明度）
  float tierAlpha( float t, float d ) {
    if ( t < 0.5 ) return 1.0 - smoothstep( 160.0, 300.0, d );           // 10km
    if ( t < 1.5 ) return 1.0 - smoothstep( 450.0, 700.0, d );           // 50km
    if ( t < 4.5 ) return 1.0;                                            // 100km・始点・終点
    if ( t < 5.5 ) return 0.85 * ( 1.0 - smoothstep( 130.0, 230.0, d ) ); // 航路灯
    return 1.0;                                                           // 寄港地
  }

  void main() {
    vec3 c = iPos;
    float d = dhtCamDist( c );
    c.y = dhtY( iPos, iYc ) + 0.02;
    vAlpha = tierAlpha( iStyle.x, d ) * uVisible;
    vTier = iStyle.x;
    vColor = iColor;
    vec4 mv = modelViewMatrix * vec4( c, 1.0 );
    float depth = max( 0.001, -mv.z );
    float pxPerUnit = 0.5 * uViewportH * projectionMatrix[ 1 ][ 1 ] / depth;
    // 近くでは実寸（球）、遠くでは最小ピクセル数の光点
    float px = clamp( iStyle.y * pxPerUnit, iStyle.z, iStyle.w );
    vPx = px;
    float coreWorld = px / pxPerUnit;
    float halfWorld = coreWorld * 3.0; // 板は芯の 3 倍（外側は glow）
    if ( vAlpha <= 0.001 ) halfWorld = 0.0;
    // 球が地面に半分埋まらないよう、見かけの半径ぶん持ち上げる（ルート線の上に浮かぶ光の玉）
    mv.xyz += ( modelViewMatrix * vec4( 0.0, coreWorld * 1.08, 0.0, 0.0 ) ).xyz;
    mv.xy += position.xy * halfWorld;
    vUv = position.xy * 3.0;               // 芯の半径 = 1
    gl_Position = projectionMatrix * mv;
    #include <logdepthbuf_vertex>
    #ifdef USE_LOGARITHMIC_DEPTH_BUFFER
      // 深度は「光の玉の手前側の面」で判定する（板の下半分が海面・地面に切られないように）
      vFragDepth = 1.0 + max( 0.0001, gl_Position.w - halfWorld );
    #endif
  }
`;

const NODE_FRAG = /* glsl */ `
  #include <logdepthbuf_pars_fragment>
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vTier;
  varying float vPx;
  void main() {
    float r = length( vUv );
    if ( r > 3.0 || vAlpha <= 0.001 ) discard;
    // 芯：球のような陰影（左上にハイライト）
    float core = 1.0 - smoothstep( 0.86, 1.0, r );
    float nz = sqrt( max( 0.0, 1.0 - r * r ) );
    vec3 n = vec3( vUv, nz );
    float lit = 0.55 + 0.45 * max( 0.0, dot( n, normalize( vec3( -0.45, 0.55, 0.7 ) ) ) );
    vec3 coreCol = mix( vColor * lit, vec3( 1.0 ), 0.55 * pow( max( 0.0, dot( n, normalize( vec3( -0.4, 0.5, 0.75 ) ) ) ), 14.0 ) + 0.04 );
    // glow：外側へ柔らかく減衰
    float glow = exp( -r * r * 0.9 ) * 0.55 + exp( -r * 1.6 ) * 0.22;
    // リング（100km・始点・終点・寄港地。近くで大きく見えている時だけ）
    float ring = 0.0;
    bool ringed = vTier > 1.5 && vTier < 4.5 || vTier > 5.5;
    if ( ringed ) {
      float near = smoothstep( 7.0, 14.0, vPx );
      ring = ( 1.0 - smoothstep( 0.0, 0.11, abs( r - 1.75 ) ) ) * 0.85 * near;
      if ( vTier > 2.5 && vTier < 4.5 ) ring += ( 1.0 - smoothstep( 0.0, 0.08, abs( r - 2.35 ) ) ) * 0.6 * near; // 始点・終点は二重
    }
    vec3 col = coreCol * core + vColor * ( glow * ( 1.0 - core ) + ring );
    float a = clamp( core + glow * 0.9 + ring, 0.0, 1.0 ) * vAlpha;
    gl_FragColor = vec4( col * vAlpha, a );
    #include <logdepthbuf_fragment>
  }
`;

export class JourneyLayer {
  /**
   * @param {import('./terrain.js').TerrainSystem} terrain
   */
  constructor(terrain, opts = {}) {
    this.terrain = terrain;
    // 市街地では建物の上を通す（(x, z) → 0..1 の市街地密度。cities.densityAt）
    this.urbanAt = opts.urbanAt ?? null;
    this.group = new THREE.Group();
    this.group.name = 'journey';
    this.visible = true;
    this.frame = 0;
    this.hiCount = -1;
    this.lines = []; // { line, geo, samples:[{x,z}], kind }
    this.lineMaterials = [];
    this.stats = { lineVertices: 0, nodes: 0, refreshes: 0 };
  }

  /**
   * @param {import('./route.js').Journey} journey
   */
  build(journey) {
    this.journey = journey;
    const rail = journey.rail;
    const ferry = journey.ferry;
    const conn = journey.connector;

    // ---- ルート線 ----
    const railS = this._sample(rail, 0.5);
    const ferryS = this._sample(ferry, 1.0);
    const connS = this._sample(conn, 0.1);
    this._addLine('rail-glow', railS, { color: '#00d4ff', linewidth: 7, opacity: 0.3, additive: true, stencilBit: 1 });
    this._addLine('rail-core', railS, { color: '#7ff8ff', linewidth: 2.3, opacity: 1.0 });
    this._addLine('connector', connS, { color: '#ffd98a', linewidth: 3, opacity: 1.0, dashed: true, dash: [0.16, 0.08] });
    this._addLine('ferry-glow', ferryS, { color: '#7ff5e0', linewidth: 7, opacity: 0.16, additive: true, stencilBit: 2 });
    this._addLine('ferry-core', ferryS, { color: '#e6fffa', linewidth: 1.7, opacity: 0.9, dashed: true, dash: [2.4, 1.6] });

    // ---- ノード ----
    const tierOf = (km) => (km === 0 ? 'start' : km % 100 === 0 ? 'major' : km % 50 === 0 ? 'mid' : 'minor');
    this.railNodes = rail.makeNodes(10, tierOf);
    // RAIL END（鹿児島中央）：通常ノードとは別に終点ノードを置く
    const end = rail.getPositionAtDistance(rail.totalKm);
    this.railNodes.push({ km: rail.totalKm, tier: 'rail-end', x: end.x, z: end.z, lat: end.lat, lon: end.lon, station: rail.endStation });
    this.railNodes.forEach((n) => (n.route = 'rail'));
    // フェリー：10km ごとの航路灯（寄港地と重なるものは省く）
    this.ferryNodes = ferry
      .makeNodes(10, () => 'ferry')
      .filter((n) => !ferry.ports.some((p) => Math.abs(p.km - n.km) < 3));
    this.ferryNodes.forEach((n) => (n.route = 'ferry'));
    this.portNodes = ferry.ports.map((p) => {
      const q = ferry.getPositionAtDistance(p.km);
      return { km: p.km, tier: 'port', x: q.x, z: q.z, lat: q.lat, lon: q.lon, port: p, route: 'ferry' };
    });
    this.allNodes = [...this.railNodes, ...this.ferryNodes, ...this.portNodes];
    this._buildNodes();
    this.refreshHeights(true);
  }

  /** ルートを論理 km ではなく幾何長で細かく刻んだ点列（線の形を保つため、元の折れ線の頂点も含める） */
  _sample(route, stepKm) {
    const out = [];
    const pts = route.points;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const L = route.cum[i + 1] - route.cum[i];
      const n = Math.max(1, Math.ceil(L / stepKm));
      for (let k = 0; k < n; k++) {
        const t = k / n;
        out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
      }
    }
    const l = pts[pts.length - 1];
    out.push({ x: l.x, z: l.z });
    return out;
  }

  _addLine(kind, samples, o) {
    const geo = new LineGeometry();
    const n = samples.length;
    geo.setPositions(new Float32Array(n * 3));
    const mat = new LineMaterial({
      color: new THREE.Color(o.color),
      linewidth: o.linewidth,
      transparent: o.opacity < 1 || !!o.additive,
      opacity: o.opacity,
      depthWrite: !o.additive && o.opacity >= 1,
      dashed: !!o.dashed,
    });
    if (o.additive) {
      mat.blending = THREE.AdditiveBlending;
      // 線分は 0.5〜1km 間隔で細かく、遠景では 1 ピクセルに何十本も重なる。加算合成がそのまま積み重なると
      // 白飛びするので、ステンシルで「同じピクセルには 1 回だけ」描く（線ごとに別のビット）
      const bit = o.stencilBit ?? 1;
      mat.stencilWrite = true;
      mat.stencilRef = bit;
      mat.stencilFuncMask = bit;
      mat.stencilWriteMask = bit;
      mat.stencilFunc = THREE.NotEqualStencilFunc;
      mat.stencilZPass = THREE.ReplaceStencilOp;
    }
    if (o.dashed) {
      mat.dashSize = o.dash[0];
      mat.gapSize = o.dash[1];
      mat.dashScale = 1;
    }
    patchLineMaterial(mat, kind + (o.dashed ? '-d' : ''));
    const line = new Line2(geo, mat);
    line.name = `route-${kind}`;
    line.frustumCulled = false; // 列島を縦断する長い線なので境界球カリングは効かない
    line.renderOrder = o.additive ? 3 : 2;
    line.userData = { kind: 'route-line', routeKind: kind };
    this.group.add(line);
    this.lines.push({ line, geo, samples, kind, dashed: !!o.dashed });
    this.lineMaterials.push(mat);
    this.stats.lineVertices += n;
  }

  _buildNodes() {
    const n = this.allNodes.length;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const pos = new Float32Array(n * 3);
    const yc = new Float32Array(n);
    const style = new Float32Array(n * 4);
    const color = new Float32Array(n * 3);
    const c = new THREE.Color();
    this.allNodes.forEach((nd, i) => {
      const t = TIER[nd.tier];
      pos[i * 3] = nd.x;
      pos[i * 3 + 2] = nd.z;
      style.set([t.id, t.r, t.minPx, t.maxPx], i * 4);
      c.set(t.color);
      color.set([c.r, c.g, c.b], i * 3);
    });
    this.nodePos = new THREE.InstancedBufferAttribute(pos, 3);
    this.nodeYc = new THREE.InstancedBufferAttribute(yc, 1);
    g.setAttribute('iPos', this.nodePos);
    g.setAttribute('iYc', this.nodeYc);
    g.setAttribute('iStyle', new THREE.InstancedBufferAttribute(style, 4));
    g.setAttribute('iColor', new THREE.InstancedBufferAttribute(color, 3));
    g.instanceCount = n;
    this.nodeUniforms = { uViewportH: { value: 800 }, uVisible: { value: 1 }, ...liftUniforms() };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.nodeUniforms,
      vertexShader: NODE_VERT,
      fragmentShader: NODE_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    mat.name = 'route-nodes';
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = 'route-nodes';
    mesh.frustumCulled = false;
    mesh.renderOrder = 4;
    mesh.userData = { kind: 'route-nodes', items: this.allNodes };
    this.nodeMesh = mesh;
    this.group.add(mesh);
    this.stats.nodes = n;
  }

  /** 地表の高さ（詳細・粗い）を計算し直す */
  refreshHeights(force = false) {
    const t = this.terrain;
    if (!t.coarse) return;
    const n = t.hiData.size;
    if (!force && n === this.hiCount) return;
    this.hiCount = n;
    this.stats.refreshes++;
    // 周囲 0.45km（4 方向）と中心の最大値：細い谷へ線が沈まないように
    const R = 0.45;
    const hiY = (x, z) => {
      let m = t.getHeightMeters(x, z);
      m = Math.max(m, t.getHeightMeters(x + R, z), t.getHeightMeters(x - R, z), t.getHeightMeters(x, z + R), t.getHeightMeters(x, z - R));
      return Math.max(0, m * M2Y);
    };
    const coY = (x, z) => Math.max(0, t.getCoarseHeightMeters(x, z) * M2Y);
    // 市街地：建物（高さ Y 0.1〜0.6）に線が隠れないよう、密度に応じて持ち上げる
    const urban = this.urbanAt;
    const URBAN_LIFT = 0.42;

    for (const L of this.lines) {
      const s = L.samples;
      const N = s.length;
      const ys = new Float32Array(N);
      const yc = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        const u = urban && L.kind !== 'ferry-core' && L.kind !== 'ferry-glow' ? urban(s[i].x, s[i].z) * URBAN_LIFT : 0;
        ys[i] = hiY(s[i].x, s[i].z) + u;
        yc[i] = coY(s[i].x, s[i].z);
      }
      // 隣の点との最大値（区間の途中で尾根を突き抜けないように）
      const pos = new Float32Array(N * 3);
      const ym = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        const y = Math.max(ys[i], ys[Math.max(0, i - 1)], ys[Math.min(N - 1, i + 1)]);
        pos[i * 3] = s[i].x;
        pos[i * 3 + 1] = y;
        pos[i * 3 + 2] = s[i].z;
        ym[i] = y;
      }
      ys.set(ym);
      const segN = N - 1;
      const first = !L.ycBuffer;
      if (first) {
        L.geo.setPositions(pos);
        // 粗い地形の高さ（線分の start / end）を instanced attribute として追加
        L.ycBuffer = new THREE.InstancedInterleavedBuffer(new Float32Array(segN * 2), 2, 1);
        L.geo.setAttribute('instanceYcStart', new THREE.InterleavedBufferAttribute(L.ycBuffer, 1, 0));
        L.geo.setAttribute('instanceYcEnd', new THREE.InterleavedBufferAttribute(L.ycBuffer, 1, 1));
      } else {
        // 2 回目以降は GPU バッファを作り直さず中身だけ更新（線分 i = [p_i, p_i+1]）
        const seg = L.geo.attributes.instanceStart.data;
        const a = seg.array;
        for (let i = 0; i < segN; i++) {
          a[i * 6 + 1] = pos[i * 3 + 1];
          a[i * 6 + 4] = pos[(i + 1) * 3 + 1];
        }
        seg.needsUpdate = true;
      }
      const b = L.ycBuffer.array;
      for (let i = 0; i < segN; i++) {
        b[i * 2] = Math.max(yc[i], ys[i]);
        b[i * 2 + 1] = Math.max(yc[i + 1], ys[i + 1]);
      }
      L.ycBuffer.needsUpdate = true;
      if (first) {
        if (L.dashed) L.line.computeLineDistances();
        L.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
      }
    }
    // ノード
    const p = this.nodePos.array;
    const yc = this.nodeYc.array;
    this.allNodes.forEach((nd, i) => {
      const y = hiY(nd.x, nd.z) + (urban && nd.route === 'rail' ? urban(nd.x, nd.z) * URBAN_LIFT : 0);
      p[i * 3 + 1] = y;
      yc[i] = Math.max(y, coY(nd.x, nd.z));
      nd.y = y;
    });
    this.nodePos.needsUpdate = true;
    this.nodeYc.needsUpdate = true;
  }

  setVisible(v) {
    this.visible = v;
    this.group.visible = v;
  }

  update(camera, width, height) {
    for (const m of this.lineMaterials) m.resolution.set(width, height);
    if (this.nodeUniforms) this.nodeUniforms.uViewportH.value = height;
    // 詳細地形の読み込みに合わせて高さを更新（最大 2 秒に 1 回程度）
    if (++this.frame % 45 === 0) this.refreshHeights();
  }

  /* ------------------------------------------------------------------ */
  /* ラベル（labels.js の addItems 形式）                                     */
  /* ------------------------------------------------------------------ */
  labelItems() {
    const items = [];
    const J = this.journey;
    // 100km ノード：近距離だけ距離を表示（10km ノードには数字を出さない）
    for (const n of this.railNodes) {
      if (n.tier !== 'major') continue;
      items.push({
        id: `km-${n.km}`, name: `${n.km} km`, type: 'routekm', x: n.x, z: n.z,
        getY: () => (n.y ?? 0) + 0.55, maxDist: 70, prio: 1.4, nearDist: 25, prioNear: 3.0, meta: n,
      });
    }
    const s = J.rail.startStation;
    const sp = latLonToWorld(s.routeLat ?? s.lat, s.routeLon ?? s.lon);
    items.push({
      id: 'dht-start', name: 'DHT EXPRESS 0 km', sub: '東京 START', type: 'routeend', cls: 'label--route-start',
      x: sp.x, z: sp.z, getY: (g) => g + 1.2, maxDist: 420, prio: 3.6, nearDist: 60, prioNear: 6.8, meta: s,
    });
    const e = J.rail.endStation;
    const ep = latLonToWorld(e.routeLat ?? e.lat, e.routeLon ?? e.lon);
    items.push({
      id: 'dht-rail-end', name: 'RAIL END', sub: `鹿児島中央 ${J.rail.totalKm} km`, type: 'routeend', cls: 'label--route-end',
      x: ep.x, z: ep.z, getY: (g) => g + 1.2, maxDist: 420, prio: 3.6, nearDist: 60, prioNear: 6.8, meta: e,
    });
    for (const p of J.ferry.ports) {
      const w = latLonToWorld(p.stageLat ?? p.lat, p.stageLon ?? p.lon);
      const jk = J.segments.find((sg) => sg.type === 'ferry').fromKm + p.km;
      items.push({
        id: `port-${p.id}`, name: `${p.name}港`.replace('港港', '港'), sub: `${p.island} · 航路 ${p.km} km`, type: 'port',
        x: w.x, z: w.z, getY: () => 0.5, maxDist: p.km === 0 || p.km === 735 ? 380 : 300, minDist: 1.5,
        prio: 2.6, nearDist: 80, prioNear: 5.5, meta: { ...p, journeyKm: jk },
      });
    }
    return items;
  }
}
