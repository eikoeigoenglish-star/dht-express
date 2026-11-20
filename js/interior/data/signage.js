/**
 * interior/data/signage.js — 【v12】ホログラム投影機のサイネージの内容（仮）
 * ---------------------------------------------------------------------------
 * 表示（hologram.js）とは分けてある。ここを書き換える／API から差し替えるだけで内容が変わる。
 *   SIGNAGE.interval … 切り替え間隔 [秒]（10 秒）
 *   SIGNAGE.slides   … 表示する順番。kind は hologram.js の描画関数の名前（【v14】CM 3 枚を追加して 7 枚）
 *
 * 【v17】列車と船でホログラムの部品（hologram.js）は共用し、表示データだけを乗り物で切り替える（signageFor(kind)）。
 *   案内図（kind: 'guide'）と News だけが乗り物ごと。ブランド・ランキング・CM は共通。
 *   案内図 plan … 見取り図の座標（添付の見取り図のピクセル。左 = 先頭／船首）をそのまま使い、hologram.js が枠に収める。
 *     areas[] … { id, type: room | corridor | balcony | stair | deck, label?, note?, x, y, w, h } または { poly: [[x, y]…] }
 *     note が '現在地' の区画は金色（ホログラムは Dining & Lounge にある）
 */

/** 列車の案内図（添付の列車見取り図の After。左 = 先頭。Room 4 は無い） */
const TRAIN_GUIDE = {
  kind: 'guide',
  title: '車内案内',
  dir: ['← 先頭', '最後部 →'],
  plan: {
    w: 1710,
    h: 240,
    stretchY: 1.75, // 列車は細長いので縦を少し伸ばして文字を入れる（並びと隣り合いは見取り図どおり）
    areas: [
      { id: 'viewroom', type: 'room', label: 'View Room', note: '前面展望', x: 0, y: 0, w: 300, h: 240 },
      // 廊下（左舷側）：Room 1〜3 の横 → 突き当たりで右へ曲がる横通路 → View Room の入口
      { id: 'corridor', type: 'corridor', label: '廊下（左舷側）', poly: [[300, 0], [360, 0], [360, 180], [1260, 180], [1260, 240], [300, 240]], labelAt: [810, 210] },
      { id: 'stair', type: 'stair', x: 237, y: 180, w: 63, h: 60 }, // Lower Deck への階段（チェーンで閉鎖）
      { id: 'room1', type: 'room', label: 'Room 1', note: 'リンさん', x: 360, y: 0, w: 300, h: 180 },
      { id: 'room2', type: 'room', label: 'Room 2', note: '4 匹', x: 660, y: 0, w: 300, h: 180 },
      { id: 'room3', type: 'room', label: 'Room 3', note: '4 匹', x: 960, y: 0, w: 300, h: 180 },
      { id: 'lounge', type: 'room', label: 'Dining & Lounge', note: '現在地', x: 1260, y: 0, w: 450, h: 240 },
    ],
  },
  legend: '▤ Lower Deck への階段（立入不可）',
};

/** 船の案内図（添付の船見取り図。左 = 船首。後方の区画は Aft Observation Deck＝屋外の展望デッキ） */
const SHIP_GUIDE = {
  kind: 'guide',
  title: '船内案内',
  dir: ['← 船首', '船尾 →'],
  plan: {
    w: 1722,
    h: 544,
    areas: [
      // バルコニー（屋外。View Room は両舷、Room 1・2 は右舷、Room 3・4 は左舷）
      { id: 'vrbalc-s', type: 'balcony', x: 30, y: 0, w: 240, h: 62 },
      { id: 'vrbalc-p', type: 'balcony', x: 30, y: 482, w: 240, h: 62 },
      { id: 'room1b', type: 'balcony', x: 330, y: 0, w: 240, h: 62 },
      { id: 'room2b', type: 'balcony', x: 630, y: 0, w: 240, h: 62 },
      { id: 'room3b', type: 'balcony', x: 330, y: 482, w: 240, h: 62 },
      { id: 'room4b', type: 'balcony', x: 630, y: 482, w: 240, h: 62 },
      { id: 'viewroom', type: 'room', label: 'View Room', note: '前面展望', x: 0, y: 62, w: 300, h: 420 },
      { id: 'room1', type: 'room', label: 'Room 1', note: 'リンさん', x: 300, y: 62, w: 300, h: 180 },
      { id: 'room2', type: 'room', label: 'Room 2', note: '2 匹', x: 600, y: 62, w: 300, h: 180 },
      { id: 'corridor', type: 'corridor', label: '中央廊下', x: 300, y: 242, w: 672, h: 60 },
      { id: 'stair', type: 'stair', x: 900, y: 180, w: 68, h: 62 }, // 廊下の後端の右舷側。Lower Deck への階段（チェーンで閉鎖）
      { id: 'room3', type: 'room', label: 'Room 3', note: '3 匹', x: 300, y: 302, w: 300, h: 180 },
      { id: 'room4', type: 'room', label: 'Room 4', note: '3 匹', x: 600, y: 302, w: 300, h: 180 },
      { id: 'lounge', type: 'room', label: 'Dining & Lounge', note: '現在地', x: 972, y: 62, w: 450, h: 420 },
      { id: 'aft', type: 'deck', label: ['Aft', 'Observation', 'Deck'], note: '屋外', x: 1422, y: 62, w: 300, h: 420 },
    ],
  },
  legend: '┅ バルコニー（Room 1〜4・View Room）　▤ Lower Deck への階段（立入不可）',
};

const NEWS = {
  train: [
    '本日の車窓：高架から見下ろす街並みと、ときどき緑の山',
    'Dining & Lounge のカウンターで焼き菓子をご用意しています',
    'Room 3 に新しい乗客（猫・仔馬・赤ちゃん虎・ウサギ）が乗車しました',
  ],
  ship: [
    '本日の眺め：青い海と、ときどき島影',
    'Dining & Lounge のカウンターで焼き菓子をご用意しています',
    '船尾の Aft Observation Deck から白い航跡が見えます',
  ],
};

/** 【v17】乗り物（'train' | 'ship'）のサイネージ。案内図・News だけを差し替え、ほかのスライドは共通 */
export function signageFor(kind = 'train') {
  const ship = kind === 'ship';
  return {
    ...SIGNAGE,
    slides: SIGNAGE.slides.map((s) => {
      if (s.kind === 'guide') return ship ? SHIP_GUIDE : TRAIN_GUIDE;
      if (s.kind === 'news') return { ...s, items: NEWS[ship ? 'ship' : 'train'] };
      return s;
    }),
  };
}

export const SIGNAGE = {
  interval: 10,
  slides: [
    { kind: 'brand', title: 'FOREST SCHOOL EXPRESS', sub: 'Dining & Lounge へようこそ' },
    TRAIN_GUIDE, // 【v17】列車の最新構成（View Room・Room 1〜3・Dining & Lounge）。船は signageFor('ship') で差し替え
    {
      kind: 'news',
      title: 'News',
      items: NEWS.train,
    },
    { kind: 'ranking', title: 'DOHENTAI Ranking' },
    // 【v14】車内 CM（スポンサー広告）。kind: 'cm' … sponsor / product / sub / offerLabel / offer（行の配列）/ icon（bowl・soft・curry）
    {
      kind: 'cm',
      sponsor: 'リス吉本舗',
      product: '麻辣湯 新発売',
      sub: 'しびれる辛さの、あったかスープ',
      offerLabel: 'リンさんだけ',
      offer: ['10倍辛さ 無料'],
      icon: 'bowl',
    },
    {
      kind: 'cm',
      sponsor: '鴨わさび商店',
      product: 'ワサビソフト 新発売',
      sub: 'すっきり香る、緑のソフトクリーム',
      offerLabel: 'リンさんだけ',
      offer: ['100%ワサビソフト 無料'],
      icon: 'soft',
    },
    {
      kind: 'cm',
      sponsor: 'わんにゃんうさカレー',
      product: 'トッピングのご案内',
      sub: 'みんなで食べる、やさしいカレー',
      offerLabel: 'リンさんだけ',
      offer: ['キャロライナ・リーパーの', 'トッピング 無料'],
      icon: 'curry',
    },
  ],
};
