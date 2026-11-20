/**
 * interior/shipcharacters.js — 【v16】船の住人（Room 1〜4）
 * ---------------------------------------------------------------------------
 * GLB・大きさ・色・テクスチャの縮小などは列車の定義（characters.js の ROOM_CHARACTERS）をそのまま使い、
 * 船の部屋の席（seat）とセリフだけをここで決める（同じデータを二重に定義しない）。
 *   Room 1：リンさん（列車の Room 1 と同じベンチの寸法・同じひざ掛け blanket.js）
 *   Room 2：赤ちゃん猿・リス　　Room 3：犬・猫・ウサギ　　Room 4：アヒル・仔馬（ベッドの上で伏せる）・赤ちゃん虎
 * 動物はそれぞれ自分のベッドの上（掛け布団の上面 y = 0.52）に座る。
 */
import { ROOM_CHARACTERS } from './characters.js';
import { CABINS, CAB, cabinXZ, cabinFacing, CABIN } from './shiplayout.js';

const BED_TOP = 0.52;
const T = ROOM_CHARACTERS;
const cab = (id) => CABINS.find((c) => c.id === id);

/** ベッドの上（u, w はベッドの中の位置）。向きは部屋の中の (lu, lw) の方へ */
function onBed(roomId, u, w, lu, lw) {
  const c = cab(roomId);
  const p = cabinXZ(c, u, w);
  const t = cabinXZ(c, lu, lw);
  return { x: p.x, y: BED_TOP, z: p.z, facing: Math.atan2(-(t.x - p.x), -(t.z - p.z)) };
}
const mid = (B, k = 0.5) => [(B.u0 + B.u1) / 2 + (k - 0.5) * (B.u1 - B.u0), (B.w0 + B.w1) / 2];

export const SHIP_CHARACTERS = {
  room1: {
    rin: {
      ...T.room1.rin,
      // ベンチ（背は廊下側の壁）に座り、バルコニー（海）の方を向く。腰は背の壁から 0.38 m（列車の Room 1 と同じ）
      seat: (() => {
        const c = cab('room1');
        const bu = (CAB.bench.u0 + CAB.bench.u1) / 2;
        const p = cabinXZ(c, bu, CABIN.depth - 0.38);
        return { x: p.x, y: 0.5, z: p.z, facing: cabinFacing(c, 0, -1) };
      })(),
      lines: ['あら、葉っぱくん。船の旅もいいものね。', 'バルコニーに出ると、潮風が気持ちいいのよ。ガラス戸は E で開けられるわ。', '船のいちばん後ろの Aft Observation Deck からは、船が残していく白い航跡が見えるの。'],
    },
  },
  room2: {
    monkey: {
      ...T.room2.monkey,
      seat: onBed('room2', ...mid(CAB.bedA, 0.62), 2.9, 1.6),
      lines: ['やあ、葉っぱくん！ 船って、ゆらゆらして楽しいね。', 'バルコニーから海を見てたら、トビウオが跳ねたんだ！'],
    },
    squirrel: {
      ...T.room2.squirrel,
      seat: onBed('room2', ...mid(CAB.bedB, 0.62), 2.9, 1.6),
      lines: ['どんぐり、船にも持ってきたよ。', 'ベッドがふかふかで、すぐ眠くなっちゃう。'],
    },
  },
  room3: {
    dog: {
      ...T.room2.dog,
      name: '犬',
      seat: onBed('room3', ...mid(CAB.bedA, 0.62), 3.0, 1.4),
      lines: ['ワン！ 船の上でも見張り番はまかせて。', 'デッキのいちばん後ろ、波が白くなってるんだよ。'],
    },
    cat: {
      ...T.room3.cat,
      seat: onBed('room3', ...mid(CAB.bedB, 0.62), 3.0, 1.4),
      turnLimit: 0.9,
      lines: ['にゃあ。海の匂いがするにゃ。', 'このベッド、窓からの光でぽかぽかするんだよ。'],
    },
    rabbit: {
      ...T.room3.rabbit,
      seat: onBed('room3', ...mid(CAB.bedC), 2.0, 0.6),
      turnLimit: 0.9,
      lines: ['ぴょん。波の音、ちゃんと聞こえてるよ。', 'ラウンジのにんじんケーキ、船にもあるかなあ。'],
    },
  },
  room4: {
    duck: {
      ...T.room2.duck,
      seat: onBed('room4', ...mid(CAB.bedA, 0.62), 3.0, 1.2),
      lines: ['ガァ！ 海の上を進むのは、ぼくの得意分野さ。', '青いスカーフ、潮風になびいてる？'],
    },
    tiger: {
      ...T.room3.tiger,
      seat: onBed('room4', ...mid(CAB.bedB, 0.62), 3.0, 1.2),
      turnLimit: 0.9,
      lines: ['がおー（小声）', '船の旅も、しましまで決めてきたよ。'],
    },
    pony: {
      ...T.room3.pony,
      // ベッド C（長さ 1.83 m・幅 0.92 m）の上に、四肢を折りたたんで伏せる。体はベッドと平行（頭は窓の方）
      seat: (() => {
        const c = cab('room4');
        const [u, w] = mid(CAB.bedC);
        const p = cabinXZ(c, u, w + 0.05);
        return { x: p.x, y: BED_TOP, z: p.z, facing: cabinFacing(c, 0, -1) };
      })(),
      footprint: { hx: 0.6, hz: 0.3, h: 0.78 },
      talkAhead: 0.6, // 【v17】0.95 → 0.6（ベッド C の足元の手前。アヒルの足元に立ったとき仔馬の方が近くならないように）
      turnLimit: 0.12,
      lines: ['ヒヒン。ぼくは体が大きいから、いちばん広いベッドをもらったんだ。', '窓の外、ずっと海だね。'],
    },
  },
};
