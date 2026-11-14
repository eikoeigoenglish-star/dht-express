/**
 * device.js — 【v13】タッチ端末（スマートフォン・タブレット）の判定
 * ---------------------------------------------------------------------------
 * userAgent には頼らず、入力デバイスの性質で判定する。
 *   タッチ UI = タッチができる（maxTouchPoints > 0）うえで、
 *     ・主な入力が指（pointer: coarse）で、ホバーできない（hover: none）　… スマートフォン・タブレット
 *     ・または、精密なポインタ（マウス・トラックパッド）がひとつも無い（any-pointer: fine が偽）
 *     ・または、指で触れられて（any-pointer: coarse）画面の短辺が 600px 未満　… 小さな端末
 *   タッチパネル付きのノート PC（主な入力はマウス = pointer: fine / hover: hover）は PC の UI のまま。
 *
 * 確認用に URL で固定できる：?touch=1（タッチ UI）／?touch=0（PC の UI）
 *
 * 判定結果は <body class="is-touch"> に反映する（CSS・各モジュールはこれを見る）。
 * 外付けマウスの接続などで性質が変わったら、判定し直して onChange を呼ぶ。
 */
const mq = (q) => typeof matchMedia === 'function' && matchMedia(q).matches;

export function detectTouchUI() {
  const forced = new URLSearchParams(location.search).get('touch');
  if (forced === '1') return true;
  if (forced === '0') return false;
  const hasTouch = (navigator.maxTouchPoints ?? 0) > 0 || 'ontouchstart' in window;
  if (!hasTouch) return false;
  if (mq('(pointer: coarse)') && mq('(hover: none)')) return true;
  if (!mq('(any-pointer: fine)')) return true;
  const shortSide = Math.min(window.innerWidth, window.innerHeight);
  return mq('(any-pointer: coarse)') && shortSide < 600;
}

let _touch = null;
const _listeners = new Set();

function apply() {
  const next = detectTouchUI();
  if (next === _touch) return;
  _touch = next;
  document.body.classList.toggle('is-touch', next);
  for (const fn of _listeners) fn(next);
}

/** いまタッチ UI か（初回の呼び出しで判定して body へ反映） */
export function isTouchUI() {
  if (_touch === null) {
    apply();
    for (const q of ['(pointer: coarse)', '(hover: none)', '(any-pointer: fine)']) {
      matchMedia?.(q).addEventListener?.('change', apply);
    }
  }
  return _touch;
}

/** 判定が変わったときに呼ぶ関数を登録（引数：タッチ UI なら true） */
export function onTouchUIChange(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}
