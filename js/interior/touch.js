/**
 * interior/touch.js — 【v13】車内のタッチ操作（スマートフォン・タブレット）
 * ---------------------------------------------------------------------------
 * body.is-touch（device.js）のときだけ表示・動作する。PC の操作（キーボード・マウス）には触れない。
 *
 *   左下の仮想スティック … 上：前進　下：後退　左：左旋回　右：右旋回（平行移動ではなく舵を切る）
 *                           斜め = 前進しながら旋回。いっぱいまで前へ倒すと走る。指を置いたまま連続入力。
 *   右下のボタン         … 近くの相手・扉・ホログラムへ「話しかける / 調べる / ドアを開ける」（PC の E キー）
 *   目のボタン           … その場を見渡す（PC の V キー）
 *   ? ボタン             … 操作ガイドを出す（乗車直後は数秒だけ自動で表示）
 *
 * 指の分離：スティックは「スティックの上で始まった指（pointerId）」だけを setPointerCapture で追う。
 *   視点のドラッグは train.js が「canvas の上で始まった指」だけを追う。
 *   別々の要素・別々の pointerId なので、左手で移動しながら右手で視点を回しても混ざらない。
 */
const DEAD = 0.2; // 中心の遊び（半径に対する割合）
const RUN_AT = 0.97; // ここまで前へ倒すと走る

/** 遊びを除いて -1〜1 へ（小さな傾きをなめらかに） */
function axis(v) {
  const a = Math.abs(v);
  if (a <= DEAD) return 0;
  const t = Math.min(1, (a - DEAD) / (1 - DEAD));
  return Math.sign(v) * t ** 1.25;
}

export class TouchControls {
  /**
   * @param {{ hud: HTMLElement, onAction: () => void, onOverview: () => void }} o
   */
  constructor(o) {
    this.o = o;
    /** train.js が毎フレーム読む。fwd：前進 +1 〜 後退 -1、turn：左旋回 +1 〜 右旋回 -1、run：走る */
    this.axes = { fwd: 0, turn: 0, run: false };
    this.enabled = false;
    this.pid = null; // スティックを操作している指
    const $ = (k) => o.hud.querySelector(`[data-room1="${k}"]`);
    this.$stick = $('stick');
    this.$knob = $('knob');
    this.$act = $('act');
    this.$view = $('view');
    this.$help = $('help');
    this.$guide = $('guide');

    const s = this.$stick;
    s.addEventListener('pointerdown', (e) => {
      if (!this.enabled || this.pid !== null) return;
      e.preventDefault();
      e.stopPropagation();
      this.pid = e.pointerId;
      s.setPointerCapture?.(e.pointerId);
      s.classList.add('is-active');
      this._move(e);
    });
    s.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.pid) return;
      e.preventDefault();
      this._move(e);
    });
    const end = (e) => {
      if (e.pointerId !== this.pid) return;
      this.release();
    };
    s.addEventListener('pointerup', end);
    s.addEventListener('pointercancel', end);
    s.addEventListener('lostpointercapture', end);
    // 長押しのメニュー・選択・ダブルタップのズームを止める
    for (const el of [s, this.$act, this.$view, this.$help]) el.addEventListener('contextmenu', (e) => e.preventDefault());

    this.$act.addEventListener('click', (e) => {
      e.currentTarget.blur();
      o.onAction();
    });
    this.$view.addEventListener('click', (e) => {
      e.currentTarget.blur();
      o.onOverview();
    });
    this.$help.addEventListener('click', (e) => {
      e.currentTarget.blur();
      this.showGuide(!this.$guide.classList.contains('is-on'), 8000);
    });
    this.$guide.addEventListener('click', () => this.showGuide(false));
  }

  _move(e) {
    const r = this.$stick.getBoundingClientRect();
    const R = r.width * 0.34; // ノブが動ける半径
    let dx = e.clientX - (r.left + r.width / 2);
    let dy = e.clientY - (r.top + r.height / 2);
    const d = Math.hypot(dx, dy);
    if (d > R) {
      dx *= R / d;
      dy *= R / d;
    }
    this.$knob.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`;
    const nx = dx / R;
    const ny = -dy / R; // 上 = 前進
    this.axes.fwd = axis(ny);
    this.axes.turn = -axis(nx); // 左へ倒す = 左旋回（正）
    this.axes.run = ny >= RUN_AT || (ny > 0.75 && Math.min(1, d / R) >= 0.999 && Math.abs(nx) < 0.5);
  }

  /** スティックを中立へ（指を離した・会話が始まった・降車した） */
  release() {
    if (this.pid !== null) {
      try {
        this.$stick.releasePointerCapture?.(this.pid);
      } catch {
        /* すでに解放済み */
      }
    }
    this.pid = null;
    this.axes.fwd = this.axes.turn = 0;
    this.axes.run = false;
    this.$knob.style.transform = '';
    this.$stick.classList.remove('is-active');
  }

  /** タッチ UI の ON/OFF（device.js の判定に合わせる。OFF なら入力は常に 0） */
  setEnabled(on) {
    if (on === this.enabled) return;
    this.enabled = on;
    if (!on) {
      this.release();
      this.setAction(null);
      this.showGuide(false);
    }
  }

  /** 右下のボタン（label が null なら隠す） */
  setAction(label) {
    if (label === this._label) return;
    this._label = label;
    this.$act.hidden = !label || !this.enabled;
    if (label) this.$act.textContent = label;
  }

  /** 操作ガイド。ms を渡すとその時間で自動的に消える */
  showGuide(on, ms = 0) {
    clearTimeout(this._guideT);
    this.$guide.classList.toggle('is-on', !!on && this.enabled);
    if (on && ms > 0) this._guideT = setTimeout(() => this.$guide.classList.remove('is-on'), ms);
  }
}
