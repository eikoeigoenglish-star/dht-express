/**
 * nightlights.js — 【v8】夕方・夜の灯り（都市ブロックの窓・屋上、ランドマークのライトアップ）
 * ---------------------------------------------------------------------------
 * どちらも既存の共有マテリアルに onBeforeCompile で足すだけ（ジオメトリ・draw call・テクスチャは増えない）。
 * 明るさは timeofday.js の TOD_UNIFORMS（uCityLight / uCityCoverage / uLandmarkGlow）で切り替える。
 *
 * 都市ブロック（cities.js の InstancedMesh。1 インスタンス = 1 棟）
 *   ・棟ごとの値 h = hash(棟の位置 x, z)。毎フレーム同じ値（チラつかない）。
 *   ・h < uCityCoverage の棟だけ点灯 → EVENING は 0.5（同じ 50% の棟が毎回点く）、NIGHT は 1.0（全棟）。
 *   ・点灯した棟は「壁の窓」（階高 3.6m・間口 6m の格子。窓ごとのハッシュで約 6 割が点灯）と
 *     「屋上の淡い発光」で光る。建物全体を黄色く塗るのではない。
 *   ・窓の格子が画面上で 1px より細かくなる遠景では、格子の平均の明るさに置き換える（モアレ・チラつき防止）。
 */
import { TOD_UNIFORMS } from './timeofday.js';
import { VERTICAL_EXAGGERATION } from './geo.js';

const FLOOR_Y = (3.6 / 1000) * VERTICAL_EXAGGERATION; // 1 階の高さ（ワールド Y）
const BAY_KM = 0.006; // 窓の間口

const HASH = /* glsl */ `
  float nlHash( vec2 p ) {
    vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
    p3 += dot( p3, p3.yzx + 33.33 );
    return fract( ( p3.x + p3.y ) * p3.z );
  }
`;

export function patchCityMaterial(mat) {
  const U = TOD_UNIFORMS;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { uCityLight: U.uCityLight, uCityCoverage: U.uCityCoverage, uCityDim: U.uCityDim });
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        ${HASH}
        varying vec3 vNlLocal; varying vec3 vNlSize; varying vec3 vNlN; varying vec2 vNlHash;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vNlLocal = position;
        vNlN = normal;
        #ifdef USE_INSTANCING
          vec3 nlO = instanceMatrix[ 3 ].xyz;
          vNlSize = vec3( length( instanceMatrix[ 0 ].xyz ), instanceMatrix[ 1 ].y, length( instanceMatrix[ 2 ].xyz ) );
          vNlHash = vec2( nlHash( nlO.xz * 13.7 + 0.5 ), nlHash( nlO.zx * 7.31 + 3.1 ) );
        #else
          vNlSize = vec3( 1.0 ); vNlHash = vec2( 0.0 );
        #endif`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        ${HASH}
        uniform float uCityLight; uniform float uCityCoverage; uniform float uCityDim;
        varying vec3 vNlLocal; varying vec3 vNlSize; varying vec3 vNlN; varying vec2 vNlHash;`,
      )
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= 1.0 - uCityDim;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        if ( uCityLight > 0.001 && vNlHash.x < uCityCoverage ) {
          vec3 n = normalize( vNlN );
          float top = step( 0.5, n.y );
          float hor = abs( n.x ) > 0.5 ? vNlLocal.z * vNlSize.z : vNlLocal.x * vNlSize.x;
          float ver = vNlLocal.y * vNlSize.y;
          vec2 g0 = vec2( hor / ${BAY_KM.toFixed(4)}, ver / ${FLOOR_Y.toFixed(5)} );
          // 窓の格子が画面上で細かすぎる距離では、窓を 2×2, 4×4 … とまとめた「窓の塊」の格子に切り替える。
          // 平均値でのっぺり光らせるのではなく、点灯／消灯の斑（まだら）を保ったまま粗くする（中景でも夜景に見える）
          vec2 fw0 = fwidth( g0 );
          float lv = clamp( log2( max( max( fw0.x, fw0.y ) * 3.0, 1.0 ) ), 0.0, 6.0 );
          float k = floor( lv );
          float tk = lv - k;
          float pat = 0.0;
          for ( int j = 0; j < 2; j++ ) {
            float sc = exp2( k + float( j ) );
            vec2 g = g0 / sc;
            vec2 f = fract( g );
            vec2 id = floor( g );
            float m = 0.16 / sc + 0.04;
            float win = step( m, f.x ) * step( f.x, 1.0 - m ) * step( m + 0.04, f.y ) * step( f.y, 0.96 - m );
            float lit = step( nlHash( id + vNlHash * 97.0 + sc ), 0.5 );
            vec2 fw = fwidth( g );
            float v = mix( win * lit, 0.35 * 0.5, smoothstep( 0.45, 1.0, max( fw.x, fw.y ) ) );
            pat += v * ( j == 0 ? 1.0 - tk : tk );
          }
          vec3 warm = vec3( 1.0, 0.74, 0.40 );
          vec3 cool = vec3( 0.80, 0.88, 1.0 );
          vec3 wc = mix( warm, cool, step( 0.72, vNlHash.y ) );
          float e = pat * ( 1.0 - top ) * 1.6 + top * 0.08;
          totalEmissiveRadiance += wc * e * uCityLight;
        }`,
      );
  };
  mat.customProgramCacheKey = () => 'dht-city-night-v8';
}

/** ランドマーク：夕方・夜は自分の色で淡く発光（ライトアップ） */
export function patchLandmarkMaterial(mat) {
  const U = TOD_UNIFORMS;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uLandmarkGlow = U.uLandmarkGlow;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uLandmarkGlow;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += diffuseColor.rgb * uLandmarkGlow * 0.42;`,
      );
  };
  mat.customProgramCacheKey = () => 'dht-landmark-night-v8';
}
