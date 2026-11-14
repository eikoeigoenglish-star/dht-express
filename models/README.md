# models/

| ファイル | 内容 |
|---|---|
| `forest-school-train.glb` | 【v7】FOREST SCHOOL の列車（+Z が先頭、長さ 1.0、Y=0 が底） |
| `forest-school-ship.glb` | 【v7】FOREST SCHOOL の船（+Z が船首、長さ 1.0、Y=0 が船底） |
| `characters/monkey.glb` | 【v11】赤ちゃん猿（Room 1。SitIdle で座る） |
| `characters/squirrel.glb` | 【v11】リス |
| `characters/duck.glb` | 【v11】アヒル |
| `characters/dog.glb` | 【v11】柴犬 |

GLB は 1 メッシュ・UV なしのまま配置し、外観（白・緑帯・窓・ロゴ・文字）は `js/livery.js` が読み込み後に適用します（README §16.2）。
パスは `js/config.js` の `ASSETS.models` に相対パスで登録しています。将来のキャラクター GLB も同じ形で追加してください（例：`characters/squirrel.glb`）。


【v11】Room 1 の動物は `js/interior/characters.js` の `ROOM1_CHARACTERS[id].model` で指定（README §20.4）。
