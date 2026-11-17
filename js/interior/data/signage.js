/**
 * interior/data/signage.js — 【v12】ホログラム投影機のサイネージの内容（仮）
 * ---------------------------------------------------------------------------
 * 表示（hologram.js）とは分けてある。ここを書き換える／API から差し替えるだけで内容が変わる。
 *   SIGNAGE.interval … 切り替え間隔 [秒]（10 秒）
 *   SIGNAGE.slides   … 表示する順番。kind は hologram.js の描画関数の名前（【v14】CM 3 枚を追加して 7 枚）
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
        { id: 'room3', label: 'Room 3', note: '4 匹' },
        { id: 'lounge', label: 'Dining & Lounge', note: '現在地' },
      ],
    },
    {
      kind: 'news',
      title: 'News',
      items: [
        '本日の車窓：高架から見下ろす街並みと、ときどき緑の山',
        'Dining & Lounge のカウンターで焼き菓子をご用意しています',
        'Room 3 に新しい乗客（猫・仔馬・赤ちゃん虎・ウサギ）が乗車しました',
      ],
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
