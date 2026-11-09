# models/

| ファイル | 内容 |
|---|---|
| `forest-school-train.glb` | 【v7】FOREST SCHOOL の列車（+Z が先頭、長さ 1.0、Y=0 が底） |
| `forest-school-ship.glb` | 【v7】FOREST SCHOOL の船（+Z が船首、長さ 1.0、Y=0 が船底） |

GLB は 1 メッシュ・UV なしのまま配置し、外観（白・緑帯・窓・ロゴ・文字）は `js/livery.js` が読み込み後に適用します（README §16.2）。
パスは `js/config.js` の `ASSETS.models` に相対パスで登録しています。将来のキャラクター GLB も同じ形で追加してください（例：`characters/squirrel.glb`）。
