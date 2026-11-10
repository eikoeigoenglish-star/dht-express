/**
 * livery.js — 【v7】FOREST SCHOOL の列車・船の外観（塗装）
 * ---------------------------------------------------------------------------
 * GLB（models/forest-school-*.glb）は 1 メッシュ・1 マテリアル・UV なし・テクスチャなし。
 * 形状はそのまま使い、読み込み後にマテリアルを差し替えて四面図（白基調・下部の深い緑帯・
 * 黒〜ダークグレーの窓・側面の「FOREST SCHOOL」と樹木ロゴ）を再現する。
 *
 * 方式
 *   ・MeshStandardMaterial + onBeforeCompile。塗り分けはモデル座標（GLB の頂点座標そのもの）と
 *     法線で決める関数（GLSL）。窓・帯・ドア・ヘッドライトは角丸矩形などの距離関数で描き、
 *     fwidth() でアンチエイリアスする（どの距離から見ても輪郭がにじまない）。
 *   ・ロゴと文字は CanvasTexture（実行時に Canvas 2D で描画）を側面へ X 方向から投影する。
 *     左右どちらの側面でも「ロゴ → FOREST SCHOOL」の順に正しく読める向きで貼る。
 *   ・外部画像・フォントの読み込みなし（GitHub Pages でそのまま動く）。
 *
 * モデル座標（両 GLB 共通）
 *   長さ 1.0（z = -0.5 … +0.5）、+Z が先頭（列車の先頭 / 船の船首）、Y = 0 が底、X が左右。
 */
import * as THREE from 'three';
import { TOD_UNIFORMS } from './timeofday.js';

/* ---------------------------------------------------------------------- */
/* 色（四面図から採取した sRGB）                                             */
/* ---------------------------------------------------------------------- */
export const FS_COLORS = {
  white: '#f1f0ec', // ボディの白（少し温かみのあるオフホワイト）
  green: '#1d5a2b', // 下部の深い緑帯
  green2: '#25693a', // 屋根肩・ライン（帯より少しだけ明るい）
  glass: '#3b4046', // 窓ガラス（ダークグレー）
  frame: '#121517', // 窓枠（ほぼ黒）
  doorLine: '#c3c3be', // ドアの目地
  cap: '#1f2326', // 煙突の口
  text: '#1c5a2a', // 「FOREST SCHOOL」
  leafLight: '#8cc63f',
  leafMid: '#5aa83c',
  leafDark: '#2e7d32',
  trunk: '#6b3f1d',
};

const lin = (hex) => {
  const c = new THREE.Color(hex); // three の Color は sRGB 16 進を線形に変換して保持する
  return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`;
};

/* ---------------------------------------------------------------------- */
/* ロゴ（樹木）と文字の Canvas                                               */
/* ---------------------------------------------------------------------- */

/** 樹木ロゴ。(cx, base) = 幹の根元の中心、h = 全高 */
export function drawTreeLogo(ctx, cx, base, h) {
  const C = FS_COLORS;
  const s = h / 100;
  ctx.save();
  ctx.translate(cx, base);
  ctx.scale(s, s);
  // 幹（根元が少し広がる）と 2 本の枝
  ctx.fillStyle = C.trunk;
  ctx.beginPath();
  ctx.moveTo(-7, 0);
  ctx.quadraticCurveTo(-3.5, -10, -3.6, -30);
  ctx.lineTo(-4, -48);
  ctx.lineTo(4, -48);
  ctx.lineTo(3.6, -30);
  ctx.quadraticCurveTo(3.5, -10, 7, 0);
  ctx.closePath();
  ctx.fill();
  ctx.lineCap = 'round';
  ctx.strokeStyle = C.trunk;
  ctx.lineWidth = 4.2;
  ctx.beginPath();
  ctx.moveTo(-1, -30);
  ctx.quadraticCurveTo(-10, -37, -17, -49);
  ctx.moveTo(1, -32);
  ctx.quadraticCurveTo(10, -38, 17, -50);
  ctx.moveTo(0, -46);
  ctx.lineTo(0, -60);
  ctx.stroke();
  // 葉（先の尖った楕円）。[x, y, 長さ, 幅, 角度(度), 色]
  const leaves = [
    [-27, -40, 21, 12, -62, C.leafDark],
    [27, -40, 21, 12, 62, C.leafDark],
    [-30, -58, 21, 12, -78, C.leafMid],
    [30, -58, 21, 12, 78, C.leafMid],
    [-18, -74, 21, 12, -35, C.leafLight],
    [18, -74, 21, 12, 35, C.leafLight],
    [-8, -88, 19, 11, -12, C.leafMid],
    [8, -88, 19, 11, 12, C.leafMid],
    [0, -70, 17, 10, 0, C.leafLight],
    [-14, -56, 15, 9, -40, C.leafLight],
    [14, -56, 15, 9, 40, C.leafLight],
  ];
  for (const [x, y, L, W, a, col] of leaves) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((a * Math.PI) / 180);
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(0, L);
    ctx.bezierCurveTo(W, L * 0.45, W * 0.9, -L * 0.55, 0, -L);
    ctx.bezierCurveTo(-W * 0.9, -L * 0.55, -W, L * 0.45, 0, L);
    ctx.fill();
    // 葉脈（ごく薄い明線）
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(0, L * 0.8);
    ctx.lineTo(0, -L * 0.75);
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

const FONT_STACK = '"Montserrat", "Poppins", "Avenir Next", "Segoe UI", "Helvetica Neue", "Hiragino Sans", Arial, "DejaVu Sans", sans-serif';

/**
 * 側面デカール：左にロゴ、右に「FOREST SCHOOL」。
 * @param {{ w:number, h:number, logoH:number, logoBase:number, textCap:number, textBase:number, logoX:number, textX0:number, textX1:number }} L
 *   すべてデカール矩形に対する比率（0..1。y は上から）
 */
function makeSideDecal(L, renderer) {
  const W = 2048;
  const H = Math.round((W * L.h) / L.w);
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  drawTreeLogo(ctx, L.logoX * W, L.logoBase * H, L.logoH * H);
  // 文字：太いサンセリフ。幅を textX0..textX1 に合わせる（フォントの違いを吸収）
  const cap = L.textCap * H;
  ctx.font = `800 ${Math.round(cap / 0.72)}px ${FONT_STACK}`;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = FS_COLORS.text;
  const label = 'FOREST SCHOOL';
  const mw = ctx.measureText(label).width;
  const want = (L.textX1 - L.textX0) * W;
  ctx.save();
  ctx.translate(L.textX0 * W, L.textBase * H);
  ctx.scale(want / mw, 1);
  ctx.fillText(label, 0, 0);
  ctx.restore();
  return toTexture(cv, renderer);
}

/** 煙突用：ロゴだけの正方形 */
function makeLogoDecal(renderer) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const ctx = cv.getContext('2d');
  drawTreeLogo(ctx, 128, 236, 220);
  return toTexture(cv, renderer);
}

function toTexture(cv, renderer) {
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 4;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

/* ---------------------------------------------------------------------- */
/* GLSL                                                                    */
/* ---------------------------------------------------------------------- */

const GLSL_HELPERS = /* glsl */ `
  varying vec3 vFsPos;   // モデル座標
  varying vec3 vFsNrm;   // モデル座標の法線
  uniform sampler2D uFsDecal;
  uniform sampler2D uFsLogo;
  uniform vec4 uFsDecalBox; // zMin, zMax, yMin, yMax（側面デカールの範囲）
  uniform vec4 uFsLogoBox;  // zMin, zMax, yMin, yMax（煙突ロゴ）
  uniform float uFsLamp;    // ヘッドライトの明るさ
  uniform float uVehicleLit; // v10: 夕方・夜の照明（0..1）

  // 角丸矩形の距離（内側が負）
  float fsBox( vec2 p, vec2 c, vec2 h, float r ) {
    vec2 q = abs( p - c ) - h + r;
    return length( max( q, 0.0 ) ) + min( max( q.x, q.y ), 0.0 ) - r;
  }
  float fsCapsule( vec2 p, vec2 a, vec2 b, float r ) {
    vec2 pa = p - a, ba = b - a;
    float h = clamp( dot( pa, ba ) / dot( ba, ba ), 0.0, 1.0 );
    return length( pa - ba * h ) - r;
  }
  // 距離 d < 0 を 1、> 0 を 0（画面上 1px 程度でなめらかに）
  float fsIn( float d ) {
    float w = max( fwidth( d ), 1e-5 );
    return 1.0 - smoothstep( -w, w, d );
  }
  // 線（|d| < t）
  float fsLine( float d, float t ) { return fsIn( abs( d ) - t ); }

  // 側面デカールの合成。左右どちらの側面でも左→右に読める向き
  vec4 fsSideDecal( vec3 p, vec3 n, vec4 box ) {
    if ( abs( n.x ) < 0.45 ) return vec4( 0.0 );
    float u = ( p.z - box.x ) / ( box.y - box.x );
    if ( p.x > 0.0 ) u = 1.0 - u; // +X 側は先頭が左に見えるので反転
    float v = ( p.y - box.z ) / ( box.w - box.z );
    if ( u < 0.0 || u > 1.0 || v < 0.0 || v > 1.0 ) return vec4( 0.0 );
    vec4 c = texture2D( uFsDecal, vec2( u, v ) );
    return c * smoothstep( 0.45, 0.6, abs( n.x ) );
  }
`;

/* 列車：リニアモーターカー風の先頭（+Z）。数値は GLB の形状を正射影で測った値 */
const TRAIN_LIVERY = /* glsl */ `
  void fsLivery( vec3 p, vec3 n, out vec3 col, out float rough, out vec3 emi ) {
    vec3 WHITE = ${lin(FS_COLORS.white)};
    vec3 GREEN = ${lin(FS_COLORS.green)};
    vec3 GREEN2 = ${lin(FS_COLORS.green2)};
    vec3 GLASS = ${lin(FS_COLORS.glass)};
    vec3 FRAME = ${lin(FS_COLORS.frame)};
    vec3 DOOR = ${lin(FS_COLORS.doorLine)};
    col = WHITE; rough = 0.42; emi = vec3( 0.0 );
    float ax = abs( p.x );
    float az = abs( p.z );
    vec2 s = vec2( p.z, p.y ); // 側面座標

    // 屋根の肩の緑ライン（屋根の中央は白）。先頭・後端で下へ流れ、先頭では窓の両脇の柱になる
    float hs = 0.236;
    hs = mix( hs, 0.150, smoothstep( 0.285, 0.43, p.z ) );
    hs = mix( hs, 0.150, smoothstep( -0.395, -0.485, p.z ) );
    float wc = mix( 0.052, 0.080, smoothstep( 0.30, 0.42, az ) );
    col = mix( col, GREEN2, fsIn( hs - p.y ) * fsIn( wc - ax ) );

    // 下部の深い緑帯（先頭・後端の丸みで少し上がる）
    float gb = 0.047 + 0.014 * smoothstep( 0.41, 0.5, az );
    col = mix( col, GREEN, fsIn( p.y - gb ) );

    // ドア（目地の線と緑の取っ手）
    if ( ax > 0.10 ) {
      float d1 = fsBox( s, vec2( -0.355, 0.136 ), vec2( 0.0215, 0.083 ), 0.011 );
      float d2 = fsBox( s, vec2( 0.2845, 0.136 ), vec2( 0.0215, 0.083 ), 0.011 );
      col = mix( col, DOOR, max( fsLine( d1, 0.0011 ), fsLine( d2, 0.0011 ) ) * step( gb + 0.004, p.y ) );
      float h1 = fsBox( s, vec2( -0.3425, 0.140 ), vec2( 0.0019, 0.0075 ), 0.0018 );
      float h2 = fsBox( s, vec2( 0.272, 0.140 ), vec2( 0.0019, 0.0075 ), 0.0018 );
      col = mix( col, GREEN2, fsIn( min( h1, h2 ) ) );
    }

    float glass = 0.0;  // ガラス（0..1）
    float frame = 0.0;  // 窓枠
    // 側面の窓：黒い窓枠の帯 + 3 枚のダークグレーのガラス、後端の乗務員室窓
    if ( ax > 0.10 ) {
      float band = fsBox( s, vec2( -0.035, 0.1795 ), vec2( 0.2875, 0.0375 ), 0.015 );
      float rearW = fsBox( s, vec2( -0.433, 0.1925 ), vec2( 0.031, 0.0245 ), 0.013 );
      frame = max( frame, fsIn( min( band, rearW ) ) );
      float pn = fsBox( s, vec2( -0.232, 0.1795 ), vec2( 0.080, 0.0285 ), 0.009 );
      pn = min( pn, fsBox( s, vec2( -0.038, 0.1795 ), vec2( 0.0835, 0.0285 ), 0.009 ) );
      pn = min( pn, fsBox( s, vec2( 0.1585, 0.1795 ), vec2( 0.0845, 0.0285 ), 0.009 ) );
      pn = min( pn, fsBox( s, vec2( -0.433, 0.1925 ), vec2( 0.025, 0.0185 ), 0.009 ) );
      glass = max( glass, fsIn( pn ) );
      // 先頭の窓の回り込み（ドアの前、緑ラインの下）
      float wrap = max( max( 0.153 - p.y, p.y - ( hs - 0.009 ) ), 0.312 - p.z );
      wrap = max( wrap, p.z - 0.43 );
      glass = max( glass, fsIn( wrap ) );
    }
    // 先頭の大きな前面窓（屋根の白の下、両脇は緑の柱）
    if ( p.z > 0.28 ) {
      float ws = fsBox( vec2( ax, p.y ), vec2( 0.0, 0.1775 ), vec2( 0.106, 0.0355 ), 0.024 );
      glass = max( glass, fsIn( ws ) );
      frame = max( frame, fsIn( ws - 0.004 ) );
    }
    // 後端の窓（後ろの面）
    if ( p.z < -0.44 && n.z < -0.25 ) {
      float bw = fsBox( vec2( ax, p.y ), vec2( 0.0, 0.168 ), vec2( 0.092, 0.034 ), 0.022 );
      glass = max( glass, fsIn( bw ) );
      frame = max( frame, fsIn( bw - 0.004 ) );
    }
    col = mix( col, FRAME, frame );
    rough = mix( rough, 0.3, frame );
    // ガラス：上がわずかに明るいグラデーション
    vec3 g = GLASS * mix( 0.78, 1.18, smoothstep( 0.14, 0.22, p.y ) );
    col = mix( col, g, glass );
    rough = mix( rough, 0.26, glass );

    // ヘッドライト（先頭の左右。細長く外側が上がる形）
    if ( p.z > 0.37 ) {
      float hl = fsCapsule( vec2( ax, p.y ), vec2( 0.060, 0.0855 ), vec2( 0.117, 0.0995 ), 0.0068 );
      col = mix( col, FRAME, fsIn( hl - 0.0042 ) );
      float lamp = fsIn( hl );
      col = mix( col, vec3( 1.0, 0.93, 0.80 ), lamp );
      emi += vec3( 1.0, 0.82, 0.55 ) * lamp * uFsLamp;
    }

    // 側面のロゴ・文字
    if ( ax > 0.11 ) {
      vec4 dc = fsSideDecal( p, n, uFsDecalBox );
      col = mix( col, dc.rgb, dc.a );
    }
  }
`;

/* 船：2 層の旅客船。船首 +Z、煙突は船尾側（z ≈ -0.31） */
const SHIP_LIVERY = /* glsl */ `
  // 上部の流れる緑ライン（後部は上層窓の上を水平に、前へ向かって波のように持ち上がり操舵室の上へ）
  float fsWaveY( float z ) {
    float y = 0.2205;
    y += 0.0335 * smoothstep( -0.11, 0.10, z );
    return y;
  }
  void fsLivery( vec3 p, vec3 n, out vec3 col, out float rough, out vec3 emi ) {
    vec3 WHITE = ${lin(FS_COLORS.white)};
    vec3 GREEN = ${lin(FS_COLORS.green)};
    vec3 GREEN2 = ${lin(FS_COLORS.green2)};
    vec3 GLASS = ${lin(FS_COLORS.glass)};
    vec3 FRAME = ${lin(FS_COLORS.frame)};
    vec3 CAP = ${lin(FS_COLORS.cap)};
    col = WHITE; rough = 0.45; emi = vec3( 0.0 );
    float ax = abs( p.x );
    vec2 s = vec2( p.z, p.y );
    bool side = abs( n.x ) > 0.35;

    // 船体下部の深い緑（船首では V 字に下がる）
    float gb = 0.050 - 0.032 * smoothstep( 0.36, 0.5, p.z );
    col = mix( col, GREEN, fsIn( p.y - gb ) );

    float glass = 0.0;
    float frame = 0.0;

    // 下層の窓（側面：黒い帯 + 5 枚のガラス。前端は斜め）
    {
      float band = fsBox( s, vec2( -0.112, 0.1655 ), vec2( 0.356, 0.0175 ), 0.012 );
      band = max( band, ( p.z - 0.255 ) + ( p.y - 0.150 ) * 1.4 );
      float f = fsIn( band ) * step( 0.06, ax );
      frame = max( frame, f );
      float pz = p.z + 0.112;
      float cell = mod( pz + 0.356, 0.1424 ) - 0.0712; // 5 枚
      float pn = max( abs( cell ) - 0.0655, abs( p.y - 0.1655 ) - 0.0125 );
      glass = max( glass, fsIn( max( pn, band + 0.004 ) ) * f );
    }
    // 上層の窓（側面）
    {
      float band = fsBox( s, vec2( -0.142, 0.2095 ), vec2( 0.298, 0.0125 ), 0.009 );
      float f = fsIn( band ) * step( 0.06, ax );
      frame = max( frame, f );
      float pz = p.z + 0.142;
      float cell = mod( pz + 0.298, 0.1192 ) - 0.0596; // 5 枚
      float pn = max( abs( cell ) - 0.0545, abs( p.y - 0.2095 ) - 0.0088 );
      glass = max( glass, fsIn( max( pn, band + 0.003 ) ) * f );
    }
    // 船尾の面にも 2 層の窓を回り込ませる
    if ( p.z < -0.44 && n.z < -0.3 ) {
      float lo = fsBox( vec2( ax, p.y ), vec2( 0.0, 0.1655 ), vec2( 0.118, 0.0175 ), 0.012 );
      float up = fsBox( vec2( ax, p.y ), vec2( 0.0, 0.2105 ), vec2( 0.105, 0.0105 ), 0.009 );
      frame = max( frame, fsIn( min( lo, up ) ) );
      float pn = max( abs( mod( ax + 0.039, 0.078 ) - 0.039 ) - 0.034, 0.0 );
      glass = max( glass, fsIn( max( lo + 0.004, pn - 0.0001 ) ) );
      glass = max( glass, fsIn( max( up + 0.003, pn - 0.0001 ) ) );
    }
    // 操舵室の窓（前面 3 枚 + 側面）
    if ( p.z > 0.17 ) {
      float wy = fsWaveY( p.z );
      float fr = fsBox( vec2( ax, p.y ), vec2( 0.0, 0.2585 ), vec2( 0.090, 0.0215 ), 0.012 );
      float fm = fsIn( fr ) * smoothstep( 0.1, 0.3, n.z + n.y * 0.2 );
      frame = max( frame, fm );
      float cell = abs( ax - 0.0 );
      float pn = min( max( cell - 0.029, abs( p.y - 0.2585 ) - 0.016 ), max( abs( ax - 0.060 ) - 0.024, abs( p.y - 0.2585 ) - 0.016 ) );
      glass = max( glass, fsIn( pn ) * fm );
      // 側面（緑ラインの下、上層デッキより上）
      float sw = max( max( 0.226 - p.y, p.y - ( wy - 0.002 ) ), 0.185 - p.z );
      sw = max( sw, p.z - 0.34 );
      float sm = fsIn( sw ) * step( 0.07, ax ) * step( 0.2, abs( n.x ) + n.z );
      glass = max( glass, sm );
    }
    // 下層前面の横長窓（操舵室の下・前向きの面）
    if ( p.z > 0.2 && n.z > 0.35 ) {
      float fw = fsBox( vec2( ax, p.y ), vec2( 0.0, 0.192 ), vec2( 0.092, 0.0145 ), 0.008 );
      glass = max( glass, fsIn( fw ) );
      frame = max( frame, fsIn( fw - 0.004 ) );
    }
    col = mix( col, FRAME, frame );
    rough = mix( rough, 0.3, frame );
    col = mix( col, GLASS * mix( 0.8, 1.15, smoothstep( 0.14, 0.27, p.y ) ), glass );
    rough = mix( rough, 0.26, glass );

    // 流れる緑ライン（上層の屋根の縁 → 波の頂 → 操舵室の上を回って前面の両脇へ）
    {
      float wy = fsWaveY( p.z );
      float t = 0.015 + 0.006 * smoothstep( -0.05, 0.1, p.z );
      float wave = fsIn( abs( p.y - ( wy + t * 0.5 ) ) - t * 0.5 ) * step( -0.455, p.z ) * smoothstep( 0.29, 0.27, p.z );
      wave *= step( 0.25, abs( n.x ) + max( n.y, 0.0 ) * 0.6 );
      // 操舵室の前の両脇（前面窓の外側の柱）
      float pil = fsIn( 0.090 - ax ) * fsIn( abs( p.y - 0.258 ) - 0.03 ) * step( 0.19, p.z ) * smoothstep( 0.45, 0.6, n.z );
      pil *= 1.0 - glass;
      col = mix( col, GREEN2, max( wave, pil ) );
    }
    // 船尾上部の緑の縁（四面図の背面・側面後部の緑）
    {
      float rim = fsIn( abs( p.y - 0.2265 ) - 0.006 ) * step( p.z, -0.25 ) * step( 0.06, ax );
      col = mix( col, GREEN2, rim * ( 1.0 - glass ) );
    }

    // 煙突（船尾側）：緑の頂部と前縁、黒い口、側面に樹木ロゴ
    if ( p.z < -0.235 && p.z > -0.40 && p.y > 0.245 ) {
      float lead = ( p.z + 0.25 ) + ( p.y - 0.25 ) * 0.62; // 前縁の斜辺（> 0 で外）
      float g = max( fsIn( 0.317 - p.y ), fsIn( abs( lead + 0.011 ) - 0.011 ) );
      col = mix( col, GREEN2, g );
      col = mix( col, CAP, fsIn( 0.333 - p.y ) * smoothstep( 0.5, 0.8, n.y ) );
      if ( side ) {
        float u = ( p.z - uFsLogoBox.x ) / ( uFsLogoBox.y - uFsLogoBox.x );
        if ( p.x > 0.0 ) u = 1.0 - u;
        float v = ( p.y - uFsLogoBox.z ) / ( uFsLogoBox.w - uFsLogoBox.z );
        if ( u > 0.0 && u < 1.0 && v > 0.0 && v < 1.0 ) {
          vec4 lg = texture2D( uFsLogo, vec2( u, v ) );
          col = mix( col, lg.rgb, lg.a * smoothstep( 0.45, 0.6, abs( n.x ) ) );
        }
      }
    }

    // 前照灯（船首の両舷）
    if ( p.z > 0.38 ) {
      float hl = fsCapsule( s, vec2( 0.419, 0.1025 ), vec2( 0.451, 0.1025 ), 0.0042 );
      col = mix( col, FRAME, fsIn( hl - 0.003 ) * step( 0.02, ax ) );
      float lamp = fsIn( hl ) * step( 0.02, ax );
      col = mix( col, vec3( 1.0, 0.93, 0.80 ), lamp );
      emi += vec3( 1.0, 0.82, 0.55 ) * lamp * uFsLamp;
    }

    // 船体の「FOREST SCHOOL」とロゴ
    if ( ax > 0.10 && p.y < 0.145 ) {
      vec4 dc = fsSideDecal( p, n, uFsDecalBox );
      col = mix( col, dc.rgb, dc.a );
    }
  }
`;

/* ---------------------------------------------------------------------- */
/* 車種ごとの設定（デカールの位置はモデル座標）                               */
/* ---------------------------------------------------------------------- */
const KINDS = {
  train: {
    glsl: TRAIN_LIVERY,
    // 前後のドアの間（四面図：ロゴは後ろ寄り/前寄りのドアの直後から、文字は反対側のドアの手前まで）
    decalBox: [-0.33, 0.258, 0.042, 0.138],
    decal: { logoX: 0.075, logoBase: 0.96, logoH: 0.92, textCap: 0.44, textBase: 0.735, textX0: 0.17, textX1: 0.965 },
    logoBox: [0, 0, 0, 0],
    roughness: 0.42,
  },
  ship: {
    glsl: SHIP_LIVERY,
    decalBox: [-0.345, 0.235, 0.05, 0.138],
    decal: { logoX: 0.08, logoBase: 0.97, logoH: 0.95, textCap: 0.40, textBase: 0.74, textX0: 0.18, textX1: 0.975 },
    logoBox: [-0.345, -0.275, 0.262, 0.312],
    roughness: 0.45,
  },
};

/**
 * GLB のメッシュ用マテリアル（塗装シェーダ）を作る
 * @param {'train'|'ship'} kind
 * @param {THREE.WebGLRenderer} [renderer] 異方性フィルタの上限取得用
 */
export function makeLiveryMaterial(kind, renderer) {
  const K = KINDS[kind];
  const b = K.decalBox;
  const decalTex = makeSideDecal({ w: b[1] - b[0], h: b[3] - b[2], ...K.decal }, renderer);
  const logoTex = makeLogoDecal(renderer);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: K.roughness, metalness: 0.0 });
  mat.name = `forest-school-${kind}`;
  const uniforms = {
    uFsDecal: { value: decalTex },
    uFsLogo: { value: logoTex },
    uFsDecalBox: { value: new THREE.Vector4(...K.decalBox) },
    uFsLogoBox: { value: new THREE.Vector4(...K.logoBox) },
    uFsLamp: { value: 1.6 },
    uVehicleLit: TOD_UNIFORMS.uVehicleLit, // v10
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFsPos;\nvarying vec3 vFsNrm;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFsPos = position;\nvFsNrm = normal;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${GLSL_HELPERS}\n${K.glsl}`)
      .replace(
        'vec4 diffuseColor = vec4( diffuse, opacity );',
        `vec3 fsCol; float fsRough; vec3 fsEmi;
        fsLivery( vFsPos, normalize( vFsNrm ), fsCol, fsRough, fsEmi );
        vec4 diffuseColor = vec4( fsCol, opacity );`,
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = fsRough;')
      // v10: 夕方・夜は車体の塗装（白・緑の帯・窓・ロゴ）が昼と同じように読めるよう、塗装色そのものを控えめに足す
      //      （車体の照明・周囲の街明かりを受けている想定。ネオンのように光らせない＝昼の見え方の 4〜5 割程度）。
      //      ヘッドライトは夜ほど強く。
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += fsEmi * ( 1.0 + 0.9 * uVehicleLit );
        totalEmissiveRadiance += diffuseColor.rgb * ( 0.30 * uVehicleLit ) * ( 0.75 + 0.25 * max( vFsNrm.y, 0.0 ) );`,
      );
  };
  mat.customProgramCacheKey = () => `forest-school-livery-v10-${kind}`;
  mat.userData.livery = { kind, uniforms, decalTex, logoTex };
  return mat;
}
