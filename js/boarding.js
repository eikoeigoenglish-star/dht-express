/**
 * boarding.js — 【v11】MAP ⇔ FOREST SCHOOL EXPRESS / Room 1 の乗車・降車
 * ---------------------------------------------------------------------------
 * 1) MAP VIEW / VEHICLE VIEW で列車（vehicles.train）をクリック
 *      → 画面中央に「FOREST SCHOOL EXPRESS に乗車しますか？ はい / いいえ」
 *      判定：列車の先頭・後尾を画面へ投影した線分からの距離（車体は画面上で約 64px に保たれる）
 *            または遠景で出る「列車」の札の矩形。ドラッグ（5px 以上）やカメラ移動中は無視。
 * 2) 「はい」→ フェードしてから Room 1 へ（初回だけ interior/room1.js を動的 import して構築）
 *    「いいえ」/ Esc → ダイアログだけ閉じる（MAP はそのまま）
 * 3) Room 1 の「← MAPへ戻る」→ フェードして MAP へ
 *
 * Room 1 表示中は main.js のループが frame() を呼び、MAP の更新・描画を丸ごと止める。
 * MAP 側の状態（カメラ位置・VIEW・timeMode・列車の位置と再生）は触らないので、そのまま復帰する。
 * MAP 側の入力（OrbitControls・追跡カメラ）は suspendMap() / resumeMap() で止める・戻す。
 */
import * as THREE from 'three';

const FADE_MS = 320;

export class Boarding {
  /**
   * @param {{
   *   renderer: THREE.WebGLRenderer, canvas: HTMLCanvasElement, camera: THREE.Camera,
   *   vehicles: import('./vehicles.js').VehicleSystem,
   *   canBoard: () => boolean, timeMode: () => string,
   *   suspendMap: () => void, resumeMap: () => void,
   * }} opts
   */
  constructor(opts) {
    this.o = opts;
    this.state = 'map'; // 'map' | 'dialog' | 'entering' | 'room' | 'leaving'
    this.room = null;
    this.trips = 0;
    this.$dialog = document.getElementById('board-dialog');
    this.$fade = document.getElementById('scene-fade');
    this.$hud = document.getElementById('room1-hud');
    this._a = new THREE.Vector3();
    this._b = new THREE.Vector3();
    this._down = null;

    const c = opts.canvas;
    // capture: OrbitControls などより先に位置を記録（伝播は止めない）
    c.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || this.state !== 'map') return;
      this._down = { x: e.clientX, y: e.clientY, t: performance.now() };
    }, true);
    c.addEventListener('pointerup', (e) => {
      const d = this._down;
      this._down = null;
      if (!d || e.button !== 0 || this.state !== 'map') return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5 || performance.now() - d.t > 600) return; // ドラッグは対象外
      if (!this.o.canBoard()) return;
      if (this.hitTrain(e.clientX, e.clientY)) this.openDialog();
    }, true);
    c.addEventListener('pointermove', (e) => {
      if (this.state !== 'map' || e.buttons) return;
      const on = this.o.canBoard() && this.hitTrain(e.clientX, e.clientY);
      if (on !== this._hover) {
        this._hover = on;
        c.style.cursor = on ? 'pointer' : '';
      }
    });

    this.$dialog.querySelector('[data-act="yes"]').addEventListener('click', () => this.board());
    this.$dialog.querySelector('[data-act="no"]').addEventListener('click', () => this.closeDialog());
    this.$hud.querySelector('[data-room1="back"]').addEventListener('click', (e) => {
      e.currentTarget.blur();
      this.leave();
    });
    addEventListener('keydown', (e) => {
      if (this.state !== 'dialog') return;
      if (e.code === 'Escape') {
        e.preventDefault();
        this.closeDialog();
      } else if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        // フォーカス中のボタンがあればそのボタン（「いいえ」に Tab で移動した場合など）
        const f = document.activeElement;
        if (f && this.$dialog.contains(f) && f.dataset.act) return;
        e.preventDefault();
        this.board();
      }
    });
  }

  /** 画面座標 (clientX, clientY) が列車に当たるか */
  hitTrain(cx, cy) {
    const t = this.o.vehicles.train;
    if (!t || !t.visible) return false;
    const rect = this.o.canvas.getBoundingClientRect();
    const x = cx - rect.left;
    const y = cy - rect.top;
    // 遠景の「列車」札
    const tag = this.o.vehicles.tags?.train;
    if (tag && tag.style.display !== 'none') {
      const r = tag.getBoundingClientRect();
      if (cx >= r.left - 6 && cx <= r.right + 6 && cy >= r.top - 6 && cy <= r.bottom + 10) return true;
    }
    const cam = this.o.camera;
    t.updateMatrixWorld();
    const a = this._a.set(0, 0.06, -0.5).applyMatrix4(t.matrixWorld).project(cam);
    const b = this._b.set(0, 0.06, 0.5).applyMatrix4(t.matrixWorld).project(cam);
    if (a.z > 1 || b.z > 1) return false;
    const W = rect.width;
    const H = rect.height;
    const ax = (a.x + 1) * 0.5 * W;
    const ay = (1 - a.y) * 0.5 * H;
    const bx = (b.x + 1) * 0.5 * W;
    const by = (1 - b.y) * 0.5 * H;
    const dx = bx - ax;
    const dy = by - ay;
    const L2 = dx * dx + dy * dy;
    const u = L2 > 1e-6 ? THREE.MathUtils.clamp(((x - ax) * dx + (y - ay) * dy) / L2, 0, 1) : 0;
    const d = Math.hypot(x - (ax + dx * u), y - (ay + dy * u));
    return d < Math.max(16, Math.sqrt(L2) * 0.14);
  }

  openDialog() {
    if (this.state !== 'map') return;
    this.state = 'dialog';
    document.body.classList.add('is-boarding');
    this.$dialog.hidden = false;
    requestAnimationFrame(() => this.$dialog.classList.add('is-on'));
    this.$dialog.querySelector('[data-act="yes"]').focus({ preventScroll: true });
  }

  closeDialog() {
    if (this.state !== 'dialog') return;
    this.state = 'map';
    document.body.classList.remove('is-boarding');
    this.$dialog.classList.remove('is-on');
    this.$dialog.hidden = true;
    this.o.canvas.focus({ preventScroll: true });
  }

  _fade(on, text = '') {
    this.$fade.querySelector('p').textContent = text;
    this.$fade.classList.toggle('is-on', on);
    return new Promise((r) => setTimeout(r, FADE_MS));
  }

  /** 「はい」：Room 1 へ */
  async board() {
    if (this.state !== 'dialog') return;
    this.state = 'entering';
    this.$dialog.classList.remove('is-on');
    this.$dialog.hidden = true;
    document.body.classList.remove('is-boarding');
    this.o.canvas.style.cursor = '';
    this._hover = false;
    await this._fade(true, this.room ? '' : '車内へ移動中…');
    try {
      if (!this.room) {
        const { Room1 } = await import('./interior/room1.js');
        this.room = new Room1({ renderer: this.o.renderer, canvas: this.o.canvas, hud: this.$hud });
        await new Promise((r) => requestAnimationFrame(r)); // 「移動中…」を一度描画してから構築
        this.room.build();
      }
      this.o.suspendMap();
      this.room.enter({ timeMode: this.o.timeMode() });
      document.body.classList.add('is-interior');
      this.state = 'room';
      this.trips++;
      // 最初のフレームを描いてからフェードを開ける（シェーダのコンパイルをフェード中に済ませる）
      this.room.render();
    } catch (e) {
      console.error('[boarding] Room 1 を開けませんでした', e);
      this.state = 'map';
      this.o.resumeMap();
      await this._fade(false);
      return;
    }
    await this._fade(false);
  }

  /** 「← MAPへ戻る」 */
  async leave() {
    if (this.state !== 'room') return;
    this.state = 'leaving';
    await this._fade(true);
    this.room.exit();
    document.body.classList.remove('is-interior');
    this.o.resumeMap();
    this.state = 'map';
    this.o.canvas.focus({ preventScroll: true });
    await this._fade(false);
  }

  /**
   * main.js のループから毎フレーム。Room 1 を描画したら true（MAP の更新・描画をしない）。
   * 'leaving' のフェード中も Room 1 を描き続ける（暗転し終わるまで）。
   */
  frame(dt) {
    if (!this.room || (this.state !== 'room' && this.state !== 'leaving')) return false;
    this.room.update(dt);
    this.room.render();
    return true;
  }

  resize() {
    this.room?.resize();
  }

  get inRoom() {
    return this.state === 'room' || this.state === 'leaving';
  }
}
