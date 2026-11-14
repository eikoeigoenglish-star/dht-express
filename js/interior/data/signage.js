/**
 * interior/data/signage.js — 【v12】ホログラム投影機のサイネージの内容（仮）
 * ---------------------------------------------------------------------------
 * 表示（hologram.js）とは分けてある。ここを書き換える／API から差し替えるだけで内容が変わる。
 *   SIGNAGE.interval … 切り替え間隔 [秒]（10 秒）
 *   SIGNAGE.slides   … 表示する順番。kind は hologram.js の描画関数の名前
 */
export const SIGNAGE = {
  interval: 10,
  slides: [
    { kind: 'brand', title: 'FOREST SCHOOL EXPRESS', sub: 'Dining & Lounge へようこそ' },
    {
      kind: 'guide',
      title: '車内案内',
      cars: [
        { id: 'crew', label: 'CREW' },
        { id: 'room1', label: 'Room 1', note: 'リンさん' },
        { id: 'room2', label: 'Room 2', note: '4 匹' },
        { id: 'room3', label: 'Room 3', note: '準備中' },
        { id: 'lounge', label: 'Dining & Lounge', note: '現在地' },
      ],
    },
    {
      kind: 'news',
      title: 'News',
      items: [
        '本日の車窓：高架から見下ろす街並みと、ときどき緑の山',
        'Dining & Lounge のカウンターで焼き菓子をご用意しています',
        'Room 3 にまもなく新しい乗客が到着予定です',
      ],
    },
    { kind: 'ranking', title: 'DOHENTAI Ranking' },
  ],
};
