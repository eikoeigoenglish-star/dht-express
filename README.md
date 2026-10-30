# DHT EXPRESS — 広域3Dステージ（プロトタイプ）

北緯 **37°40′23″（37.6731°N）以南** の日本（本州南部・四国・九州・南西諸島〜沖縄・先島）を、
Three.js 上の 1 つの連続した 3D 空間として表示し、**俯瞰（MAP VIEW）** と **一人称の自由飛行（EXPLORE VIEW）** で探索できる Web アプリです。

将来「DHT EXPRESS」の列車と 9 体のキャラクターを載せるための**ステージ（土台）**であり、今回は列車・キャラクター・ルート線・カウンター等は一切含みません。

---

## 1. 起動方法

ビルド不要・サーバー処理不要の**純粋な静的サイト**です。

### GitHub Pages で公開する

1. このフォルダの中身をリポジトリのルート（または `docs/`）に置いて push
2. GitHub の **Settings → Pages** で、公開するブランチとフォルダ（`/ (root)` または `/docs`）を選択
3. `https://<ユーザー名>.github.io/<リポジトリ名>/` を開く

- すべて **相対パス**（`./js/...`, `./data/...`）で参照しているので、リポジトリ名付きのプロジェクトサイトでもそのまま動きます。
- Three.js はリポジトリ内に同梱しているため、CDN や外部 API への依存はありません。
- `.nojekyll` を同梱しています（Jekyll 処理をスキップして即公開されます）。

### ローカルで確認する（開発用）

`file://` で直接開くと、ブラウザの制約で ES Modules とデータの読み込みができません。簡易 HTTP サーバー経由で開いてください。

```bash
cd dht-express-stage
python3 -m http.server 8000
# → http://localhost:8000/ をブラウザで開く
```

Node.js がある場合は `npx serve .` などでも構いません。**これは確認用であり、公開時にサーバー処理は不要**です。

推奨ブラウザ：最新の Chrome / Edge / Firefox / Safari（WebGL2 と Import Maps に対応したもの）。

---

## 2. Three.js バージョン

- **three.js r187（npm `three@0.187.0`）**
- 同梱ファイル：`js/vendor/three.module.js`, `js/vendor/three.core.js`, `js/vendor/addons/controls/OrbitControls.js`
  （公式配布物を esbuild で minify したもの。ライセンスは `js/vendor/THREE_LICENSE.txt`＝MIT）
- `index.html` の Import Map で `three` と `three/addons/` を同梱ファイルに割り当てています。
  バージョンを上げるときは、npm から新しい `build/three.module.js`・`build/three.core.js`・`examples/jsm/controls/OrbitControls.js` に差し替えるだけです。

---

## 3. ファイル構成

```text
index.html                 エントリ（Import Map / UI の骨組み）
.nojekyll                  GitHub Pages 用
css/
  style.css                HUD のスタイル
js/
  main.js                  起動・ループ・モード切替・プリセット移動の統括
  geo.js                   ★ 緯度経度 ⇔ ワールド座標変換、距離計算
  config.js                アセットパス（相対URL解決）・カメラプリセット・ワールド範囲
  terrain.js               地形チャンク・LOD・遅延読込・標高サンプリング
  environment.js           空・海面・海底・ライト・フォグ
  camera.js                カメラ生成・プリセット→視点変換・滑らか移動（トゥイーン）
  controls.js              MAP VIEW（OrbitControls）/ EXPLORE VIEW（自由飛行）
  labels.js                地名ラベル（HTML オーバーレイ、重なり自動回避）
  ui.js                    HUD（モード表示・プリセット・操作説明・情報表示）
  route.js                 【将来用・未使用】km → ルート上の位置
  vendor/                  three.js 同梱
data/
  places.json              地名ラベル用の緯度経度（方位確認用）
  terrain/
    manifest.json          グリッド定義・投影定数・チャンク一覧
    coarse.bin             全域 4km 間隔の標高（約 400KB, 起動時に読込）
    hi/h_X_Z.bin           64km 四方・1km 間隔の標高（214 枚 × 約 9KB, 近づいた所だけ遅延読込）
models/                    将来の GLB 置き場（今回は空）
tools/
  build_terrain.py         地形データの事前生成スクリプト（公開時には不要）
```

公開サイズの目安：地形データ合計 **約 2.4MB**（初期ロードは manifest + coarse の約 0.4MB のみ）、three.js 約 0.8MB。

---

## 4. 地形データ（取得元・ライセンス）

### 4.1 海岸線：Natural Earth（1:10m）

| 項目 | 内容 |
|---|---|
| 出典 | Natural Earth — `ne_10m_land`, `ne_10m_minor_islands`, `ne_10m_lakes`（琵琶湖のみ使用） |
| 取得元 | https://www.naturalearthdata.com/ （GeoJSON は https://github.com/nvkelso/natural-earth-vector ） |
| ライセンス | **パブリックドメイン**（Natural Earth Terms of Use） |
| 商用利用 | 可 |
| 再配布 | 可（加工・変換したデータの配布も可、条件なし） |
| クレジット | **不要**（任意。表記する場合は「Made with Natural Earth」） |

元の GeoJSON（約 16MB）はリポジトリに含めず、`tools/build_terrain.py` で
「北緯24°〜38.3°・東経122.3°〜142°の範囲を 0.5km ラスタ化 → 海岸からの符号付き距離に変換 → 1km グリッドへ間引き」
した結果だけを `data/terrain/` に保存しています。朝鮮半島・済州島・台湾・大陸は除外しています。

### 4.2 標高：本プロジェクトでの手続き生成（外部 DEM 不使用）

| 項目 | 内容 |
|---|---|
| 出典 | 本リポジトリ `tools/build_terrain.py` による生成物 |
| 方法 | 実在の主要山脈（飛騨・木曽・赤石山脈、紀伊山地、中国山地、四国山地、九州山地 など）・主要火山（富士山、浅間山、阿蘇、霧島、桜島 など）・主要平野（関東・濃尾・大阪・筑紫 など）の**位置と概略標高**をパラメータとして置き、海岸からの距離とノイズで地形を合成 |
| ライセンス | **CC0（パブリックドメイン相当）**として扱えます |
| 商用利用 / 再配布 / クレジット | 可 / 可 / 不要 |

> 外部 DEM（国土地理院タイル、SRTM 等）を使っていないため、標高データ由来のライセンス表記・利用条件は発生しません。
> 一方で標高は**実測値ではありません**（「リアル地図」ではなく「広域3Dステージ」用の簡略地形）。
> 将来、実測 DEM に差し替えたい場合は §9 を参照してください。

### 4.3 Three.js

MIT License（`js/vendor/THREE_LICENSE.txt`）。商用可・再配布可・ライセンス表記の同梱が条件（同梱済み）。

---

## 5. 緯度経度 → 3D 座標の変換ルール

`js/geo.js` にすべて集約しています（`tools/build_terrain.py` と同じ定数）。

### 座標軸

| 軸 | 意味 |
|---|---|
| **+X** | 東（-X が西） |
| **-Z** | 北（+Z が南）＝ Three.js でカメラの「奥」が北 |
| **+Y** | 上（標高）。**海面 = Y 0** |

### スケール

- **水平：1 world unit = 1 km（実距離そのまま）**
- **垂直：Y = 標高[m] ÷ 1000 × 3**（`VERTICAL_EXAGGERATION = 3`、山を見やすく 3 倍誇張）

### 投影法：正弦図法（中央経線 132.5°E、基準緯度 31.0°N）

```js
x =  (lon - 132.5) * KM_PER_DEG * cos(lat)
z = -(lat - 31.0)  * KM_PER_DEG          // KM_PER_DEG = 111.195 km
```

- 南北方向の距離と、各緯線に沿った東西距離が正確。逆変換も厳密。
- 例：東京駅 → `(656.4, -520.5)`、鹿児島中央駅 → `(-185.6, -64.9)`。
  ワールド上の直線距離 957km、大圏距離 967km（誤差 1% 程度）。

### API

```js
import { latLonToWorld, worldToLatLon, metersToY, haversineKm } from './js/geo.js';

const { x, z } = latLonToWorld(35.681, 139.767);    // 東京駅
const { lat, lon } = worldToLatLon(x, z);           // 逆変換
const y = DHT.terrain.getSurfaceY(x, z);            // その地点の地表 or 海面の Y
haversineKm(35.681, 139.767, 31.584, 130.541);      // 実距離 [km]
```

### 実距離・ルート上の位置との関係（将来）

```
緯度経度 ──latLonToWorld()──▶ ワールド (x, z)    [1 unit = 1 km]
     │
     └─haversineKm()──▶ 区間 km ──累積──▶ ルート上の位置 (km)
                                            ▲
         progressKm = totalCount（DHT 1回 = 1km）
```

`js/route.js` の `GeoPolyline` は、ルートの緯度経度列を受け取り、
`getPointAtKm(progressKm)` で「緯度経度・ワールド座標・進行方向」を返します。
営業キロ（東京〜鹿児島中央 1395km）と折れ線実測長の差は `totalKm` オプションで正規化します。
**今回はルートデータを定義しておらず、画面にも何も描画しません。**

---

## 6. 操作方法

### 共通

| キー | 動作 |
|---|---|
| `1` | 俯瞰モード（MAP VIEW） |
| `2` | 一人称探索モード（EXPLORE VIEW） |
| `L` | 地名ラベル表示 ON/OFF |
| `I` | 情報表示（FPS / draw call / 三角形数 / 位置 / 高度）ON/OFF |
| `H` | 操作説明の表示／折りたたみ |

画面左上のボタンでもモードを切り替えられ、現在のモードは黄色で表示されます。

### 俯瞰モード（MAP VIEW）

| 操作 | 動作 |
|---|---|
| 左ドラッグ | 回転 |
| 右ドラッグ（または Shift + 左ドラッグ） | パン（地面に沿って移動） |
| ホイール | ズーム（カーソル位置に向かって寄る） |
| 中ドラッグ | ズーム |
| 矢印キー | パン |

- OrbitControls ベース。慣性（ダンピング）あり。
- 見下ろし角は最大 80° に制限（真横にならず酔いにくい）。
- 毎フレーム、カメラが地表・海面に潜らないよう、注視点が地表付近にあるよう補正。
- ズーム範囲：約 1.2km 〜 3400km（日本全体から地表すれすれまで連続的に寄れる）。

### 一人称探索モード（EXPLORE VIEW）

| 操作 | 動作 |
|---|---|
| 画面クリック | マウス視点 ON（ポインタロック） |
| マウス移動 | 視点変更 |
| `W` / `↑` | 前進（視線方向へ飛ぶ） |
| `S` / `↓` | 後退 |
| `A` / `←`・`D` / `→` | 左右移動 |
| `Q` / `E` | 下降 / 上昇（`Space` でも上昇） |
| `Shift` | 4 倍速 |
| ホイール | 基準速度の変更（0.1〜12 倍） |
| `Esc` | マウスロック解除 |

- 地面を歩くのではなく、**地表近くを飛べる自由視点**です（FPS とフライトの中間）。
- 速度は**対地高度に比例**：地表すれすれでは時速 300km 前後、高く上がるほど速くなるので、
  低空で山や島を眺めることも、高空に上がって九州から沖縄まで一気に飛ぶこともできます。
- 加速・減速に慣性あり。地表・海面の 30m 手前で止まり、潜りません。
- 俯瞰モードから切り替えると、注視点の手前の低空へ滑らかに降下します。
  一人称から俯瞰へ戻すと、視線が地面に当たる地点を中心にした俯瞰に切り替わります。

---

## 7. カメラプリセット

左パネル（スマホ幅ではドロップダウン）からワンクリックで移動します。
移動は easeInOut 補間で、遠距離の場合は途中で高度を上げる弧を描きます。

| プリセット | 注視点 | 備考 |
|---|---|---|
| 全体俯瞰 | 北緯30.9° 東経132.4° | 東京〜先島諸島までを一望 |
| 東京付近 | 東京湾 | 富士山・相模湾方向（南南西）を望む |
| 名古屋〜東海 | 浜松の北方 | 南アルプス・浜名湖・遠州灘 |
| 関西 | 大阪 | 大阪湾・紀伊山地 |
| 中国地方 | 中国山地 | 瀬戸内海・四国も入る |
| 北部九州 | 筑紫平野 | 博多〜熊本 |
| 鹿児島 | 錦江湾・桜島 | 南方に屋久島・種子島 |
| 鹿児島〜奄美 | 吐噶喇列島付近 | 鹿児島から沖縄への海上ルート全体 |
| 沖縄 | 沖縄本島中部 | 那覇・与論島 |

多くのプリセットは**南西向き（列車の進行方向）**に向けています。
EXPLORE VIEW 中にプリセットを選ぶと、その地点を低空から眺める位置へ飛びます。
プリセットの定義は `js/config.js` の `CAMERA_PRESETS`（緯度経度・距離・角度）です。

---

## 8. 将来拡張ポイント

| 追加したいもの | 拡張場所 |
|---|---|
| 列車 GLB・9体のキャラクター GLB | `models/` に配置 → `config.js` の `ASSETS.models` に相対パス追加 → `main.js` の `actors` グループへ add |
| GLB の地表配置 | `latLonToWorld()` → `terrain.getSurfaceY(x, z)` で Y を決める |
| 東京→鹿児島中央のルート曲線、1km = 1カウント | `route.js` の `GeoPolyline` にルート緯度経度を渡し `getPointAtKm(totalCount)` |
| 鹿児島以南の海上移動 | 同じ `GeoPolyline` に海上区間を続けるだけ（海面は Y=0 で連続） |
| 列車追尾カメラ | `controls.js` に `FollowController`（enable/disable/update）を追加し `main.js` のモードに登録 |
| 駅・到達イベント地点 | `data/places.json` と同じ形式で緯度経度を定義 |
| キャラクタークリック UI | `actors` グループに Raycaster を当てる（地形は別グループなので判定対象から外せる） |
| 演出・パーティクル | `main.js` の `fx` グループ |
| 実測 DEM への差し替え | `build_terrain.py` の標高合成部分を DEM サンプリングに置き換える。出力形式（manifest / coarse / hi）が同じなら JS 側は無修正 |

ブラウザのコンソールから `window.DHT`（`scene`, `camera`, `terrain`, `geo`, `layers` など）にアクセスできます。

---

## 9. パフォーマンス上の注意

### 現状の負荷（目安）

| 状況 | draw call | 三角形 |
|---|---|---|
| 全体俯瞰 | 約 86 | 約 19 万 |
| 地域プリセット（詳細タイル表示中） | 約 25〜65 | 約 6〜22 万 |

- マテリアルは地形 1 + 海 1 + 海底 1 + 空 1 のみ。テクスチャは波の法線マップ 1 枚（128px）だけ。
- 影（shadow map）は未使用。
- 地形は **128km 四方の粗タイル（4km 間隔）** と **64km 四方の詳細タイル（1km 間隔）** の 2 段 LOD。
  カメラから 170km 以内の粗タイルを詳細タイル 4 枚に分割し、215km より離れたら戻します（ヒステリシス付き）。
- 詳細データは近づいた所だけ fetch（同時 6 本まで）。生成済みメッシュは最大 160 枚までキャッシュし、溢れたら古い順に破棄。
- タイルごとに frustum culling が効きます。地名ラベルは HTML なので draw call を使いません。

### GLB を追加するときの目安

- 地形は最大でも 20 万三角形・数十 draw call 程度なので、
  **列車 1 + キャラクター 9 体（各 1〜3 万三角形・数 draw call 程度）を足しても余裕があります。**
- キャラクターのテクスチャは 1024px 程度・KTX2 圧縮、ジオメトリは Draco / meshopt 圧縮を推奨。
- 影を付ける場合は、地形全体ではなく列車周辺だけを照らす小さな影カメラにしてください。

### その他

- 深度精度のため `logarithmicDepthBuffer` を有効にしています（地表 10m 〜 地平線数千 km を 1 カメラで扱うため）。
  カスタム ShaderMaterial を追加する際は `#include <logdepthbuf_*>` チャンクを入れてください。
- ピクセル比は最大 1.75 に制限しています（高 DPI 画面での負荷対策、`main.js`）。

---

## 10. 地形データの再生成（任意）

公開には不要です。パラメータ（山の位置・標高、北限の帯など）を変えたいときだけ実行します。

```bash
pip install numpy scipy pillow
mkdir -p ../src_data && cd ../src_data
B=https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson
for f in ne_10m_land ne_10m_minor_islands ne_10m_lakes; do curl -LO $B/$f.geojson; done
cd ../dht-express-stage
python3 tools/build_terrain.py --src ../src_data --out data/terrain
```

数十秒で `data/terrain/` が作り直されます。北限（37°40′23″）より北の帯は、色を落としながら海へ沈めて「範囲外」と分かるようにしています（`NORTH_LIMIT`, `FADE_END`）。
