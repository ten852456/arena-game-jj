import Phaser from 'phaser';
import { fightSfx } from './audio';
import { type FxLayer, reducedMotion } from './fx';

/**
 * Status looks on the two fighters and the punchy damage numbers (combatScene drives it every frame).
 * - flash: a white additive copy of the chibi for 80ms on a hit, then the sprite tints pink for 120ms
 *   (the chibi stays readable, never a solid white blob).
 * - freeze: strong ice-blue tint + an ice-blue glaze, a translucent ice cube over the chibi, frost flakes;
 *   when it ends the cube shatters into shards (with an ice-crack sound).
 * - burn: orange flicker every 100ms + small flames and embers rising.
 * - slow: grey-lavender tint (desaturated look) + a purple swirl turning at the feet.
 * - shield: a pastel bubble that wobbles when a hit is blocked and pops when the shield breaks.
 * - thorns: a pink spiky outline that pulses faintly and flashes when it pricks an attacker.
 * - numbers: pooled texts; pop 0 → 1.4 → 1 in 150ms, rise 40, fade; colour per kind; big hits gold with "!" and a
 *   starburst; jittered and stacked so several numbers in a row do not overlap.
 * All objects are made once; update() only moves them (no allocation per frame).
 * prefers-reduced-motion: no wobble, no pop-scale, no particles; tints and overlays still show the state.
 */

export type NumKind = 'dmg' | 'burn' | 'heal' | 'shield' | 'thorns' | 'blocked' | 'fatigue' | 'status';
const NUM_COLOR: Record<NumKind, string> = {
  dmg: '#ffffff', burn: '#ffa04d', heal: '#7dff9c', shield: '#8fd0ff', thorns: '#ff8ac4', blocked: '#8fd0ff', fatigue: '#cfcfcf', status: '#ffffff',
};
const NUM_STROKE: Record<NumKind, string> = {
  dmg: '#5a1030', burn: '#5a2008', heal: '#0d4a22', shield: '#10325a', thorns: '#5a1040', blocked: '#10325a', fatigue: '#333333', status: '#1d1640',
};
const NUMS = 20;
const FONT = 'Kanit, sans-serif';

export interface FighterState {
  frozen: boolean;
  burning: boolean;
  slowed: boolean;
  shield: boolean;
  thorns: boolean;
  dead: boolean;
}

/** tint helpers: mix white toward c by k */
const mix = (c: number, k: number) => {
  const r = 255 - Math.round((255 - ((c >> 16) & 255)) * k);
  const g = 255 - Math.round((255 - ((c >> 8) & 255)) * k);
  const b = 255 - Math.round((255 - (c & 255)) * k);
  return (r << 16) | (g << 8) | b;
};
const ICE = 0x8fd3ff;
const PINK = mix(0xff7aa8, 0.45);
const BURN = mix(0xff8a3d, 0.5);
const SLOW = 0xc4bbdc;

export class FighterFx {
  readonly still = reducedMotion();
  private glaze: Phaser.GameObjects.Image[] = [];
  private cube: Phaser.GameObjects.Image[] = [];
  private bubble: Phaser.GameObjects.Image[] = [];
  private thornImg: Phaser.GameObjects.Image[] = [];
  private swirl: Phaser.GameObjects.Image[] = [];
  /** visual-clock times (ms): white flash start, cube in, bubble wobble, thorn flash, bubble in */
  private flashT = [-1e9, -1e9];
  private cubeT = [-1e9, -1e9];
  private wobT = [-1e9, -1e9];
  private wobK = [0, 0];
  private thornT = [-1e9, -1e9];
  private bubT = [-1e9, -1e9];
  private prev: FighterState[] = [0, 1].map(() => ({ frozen: false, burning: false, slowed: false, shield: false, thorns: false, dead: false }));
  private nextFrost = [0, 0];
  private nextEmber = [0, 0];
  /** damage numbers */
  private nums: Phaser.GameObjects.Text[] = [];
  private nv = new Float32Array(NUMS * 6); // t0, x, y, size scale, life, active
  private ni = 0;
  private lastNum = [-1e9, -1e9];
  private stack = [0, 0];
  /** status words ("Burning", "Frozen!") have their own lane above the numbers, two rows at most */
  private lastWord = [-1e9, -1e9];
  private wordRow = [0, 0];
  private now = 0;

  constructor(
    private scene: Phaser.Scene,
    private fxl: FxLayer,
    /** x of each fighter, ground y, chibi height */
    private pos: number[],
    private ground: number,
    private heroH: number,
  ) {
    for (let i = 0; i < 2; i++) {
      this.swirl.push(scene.add.image(pos[i], ground + 2, 'fx_swirl').setDepth(1).setVisible(false));
      this.glaze.push(scene.add.image(0, 0, '__DEFAULT').setDepth(3).setVisible(false).setBlendMode(Phaser.BlendModes.ADD));
      this.thornImg.push(scene.add.image(pos[i], ground - heroH * 0.42, 'fx_thornring').setDepth(3).setVisible(false));
      this.cube.push(scene.add.image(pos[i], ground + 5, 'fx_icecube').setOrigin(0.5, 1).setDepth(4).setVisible(false));
      this.bubble.push(scene.add.image(pos[i], ground - heroH * 0.4, 'fx_bubble').setDepth(5).setVisible(false));
    }
    for (let j = 0; j < NUMS; j++)
      this.nums.push(
        scene.add
          .text(0, 0, '', { fontFamily: FONT, fontSize: '24px', fontStyle: 'bold', color: '#ffffff', stroke: '#000000', strokeThickness: 5, resolution: 2 })
          .setOrigin(0.5)
          .setDepth(23)
          .setVisible(false),
      );
  }

  /** Hide everything (new fight, shop, skip). */
  clear() {
    for (let i = 0; i < 2; i++) {
      this.glaze[i].setVisible(false);
      this.cube[i].setVisible(false);
      this.bubble[i].setVisible(false);
      this.thornImg[i].setVisible(false);
      this.swirl[i].setVisible(false);
      this.flashT[i] = this.cubeT[i] = this.wobT[i] = this.thornT[i] = this.bubT[i] = -1e9;
      const p = this.prev[i];
      p.frozen = p.burning = p.slowed = p.shield = p.thorns = p.dead = false;
    }
    this.nums.forEach((t) => t.setVisible(false));
    for (let j = 0; j < NUMS; j++) this.nv[j * 6 + 5] = 0;
  }

  /** the next update takes the states as they are, without playing start / end effects (after a skip) */
  private silent = false;
  settle() {
    this.silent = true;
  }

  flash(i: number) {
    this.flashT[i] = this.now;
  }

  /** a hit was (partly) blocked by the shield: the bubble wobbles, harder for bigger hits */
  wobble(i: number, k: number) {
    this.wobT[i] = this.now;
    this.wobK[i] = Math.min(1, 0.4 + k);
  }

  thornFlash(i: number) {
    this.thornT[i] = this.now;
  }

  /**
   * A floating number over fighter i. size: 1 normal, 1.17 medium, 1.42 big, 1.67 crit / kill (24px base).
   * gold = big hit: gold text, "!" and a starburst behind.
   */
  number(i: number, text: string, kind: NumKind, size = 1, gold = false, color?: string) {
    const j = this.ni;
    this.ni = (this.ni + 1) % NUMS;
    const t = this.nums[j];
    let x: number;
    let y: number;
    if (kind === 'status') {
      // own lane: a second word while the first is still up goes one row higher and to the outside, never a third row
      // (playtests: "แผลลึก ติดไฟ ติดไฟ" piled into one unreadable block over the enemy's name)
      const near = this.now - this.lastWord[i] < 700;
      this.wordRow[i] = near ? (this.wordRow[i] + 1) % 2 : 0;
      this.lastWord[i] = this.now;
      x = this.pos[i] + (i === 0 ? -1 : 1) * (this.wordRow[i] * 26);
      y = this.ground - this.heroH * 0.9 - 30 - this.wordRow[i] * 20;
    } else {
      const near = this.now - this.lastNum[i] < 280;
      this.stack[i] = near ? (this.stack[i] + 1) % 3 : 0;
      this.lastNum[i] = this.now;
      x = this.pos[i] + (Math.random() * 16 - 8) + (i === 0 ? 1 : -1) * this.stack[i] * 12;
      y = this.ground - this.heroH * 0.9 + 10 - this.stack[i] * 17;
    }
    t.setText(gold ? text + '!' : text)
      .setFontSize(Math.round(28 * size))
      .setColor(gold ? '#ffd84a' : (color ?? NUM_COLOR[kind]))
      .setStroke(gold ? '#6a2a00' : NUM_STROKE[kind], kind === 'status' ? 4 : 5)
      .setPosition(x, y)
      .setScale(this.still ? 1 : 0)
      .setAlpha(1)
      .setVisible(true);
    const b = j * 6;
    this.nv[b] = this.now;
    this.nv[b + 1] = x;
    this.nv[b + 2] = y;
    this.nv[b + 3] = 1;
    this.nv[b + 4] = gold ? 1150 : kind === 'status' ? 1000 : 850;
    this.nv[b + 5] = 1;
    if (gold) this.fxl.starburst(x, y, size * 0.8);
  }

  /**
   * Once per frame after the fighters are placed. dt = visual ms (hit-stop / slow-mo scaled), lm = fast-forward
   * life multiplier for particles. Returns nothing; sets the fighters' tints.
   */
  update(dt: number, fighters: Phaser.GameObjects.Image[], st: FighterState[], speed: number) {
    this.now += dt;
    const now = this.now;
    for (let i = 0; i < 2; i++) {
      const f = fighters[i];
      const s = st[i];
      const p = this.prev[i];
      const on = f.visible && !s.dead;
      const cx = f.x;
      const chest = this.ground - this.heroH * 0.42;
      // ---------- transitions
      if (this.silent) {
        Object.assign(p, s);
        this.cubeT[i] = this.bubT[i] = now - 1000;
      }
      if (on && s.frozen && !p.frozen) {
        this.cubeT[i] = now;
        fightSfx('crack');
      }
      if (p.frozen && !s.frozen && f.visible) {
        this.fxl.shatter(cx, chest + 6);
        fightSfx('shatter');
      }
      if (on && s.shield && !p.shield) this.bubT[i] = now;
      if (p.shield && !s.shield && on) {
        this.fxl.pop(cx, chest + 4);
        fightSfx('pop');
      }
      if (on && s.thorns && !p.thorns) this.thornT[i] = now;
      Object.assign(p, s);
      if (!on) {
        this.glaze[i].setVisible(false);
        this.cube[i].setVisible(false);
        this.bubble[i].setVisible(false);
        this.thornImg[i].setVisible(false);
        this.swirl[i].setVisible(false);
        continue;
      }
      // ---------- sprite tint: hit flash > ice > burn flicker > slow
      const fa = now - this.flashT[i];
      let tint = -1;
      if (fa < 200 && fa >= 80) tint = PINK;
      else if (s.frozen) tint = ICE;
      else if (s.burning && Math.floor(now / 100) % 2 === 0) tint = BURN;
      else if (s.slowed) tint = SLOW;
      if (tint < 0) f.clearTint();
      else f.setTint(tint);
      // ---------- glaze: an additive copy of the chibi (white flash, or the frozen ice sheen)
      const gz = this.glaze[i];
      let ga = 0;
      let gc = 0xffffff;
      if (fa < 80) ga = 0.75 * (1 - fa / 80);
      else if (s.frozen) {
        ga = 0.42 + 0.06 * Math.sin(now / 160);
        gc = 0x4a8fc4;
      }
      if (ga > 0.01) {
        if (gz.texture !== f.texture) gz.setTexture(f.texture.key);
        gz.setPosition(f.x, f.y).setOrigin(f.originX, f.originY).setScale(f.scaleX, f.scaleY).setFlipX(f.flipX).setAngle(f.angle);
        gz.setTintFill(gc).setAlpha(ga).setVisible(true);
      } else gz.setVisible(false);
      // ---------- ice cube
      const cb = this.cube[i];
      if (s.frozen) {
        const a = Math.min(1, (now - this.cubeT[i]) / 140);
        const pop = this.still ? 1 : a < 1 ? 0.6 + 0.5 * a : 1 + 0.04 * Math.max(0, 1 - (now - this.cubeT[i] - 140) / 160);
        const sc = (this.heroH * 0.86) / (104 * 4);
        cb.setPosition(cx, this.ground + 5).setScale(sc * pop, sc * (this.still ? 1 : 0.7 + 0.3 * a)).setAlpha(0.9 * a).setVisible(true);
        if (now > this.nextFrost[i]) {
          this.nextFrost[i] = now + (speed >= 4 ? 420 : 200);
          this.fxl.frost(cx, chest);
        }
      } else cb.setVisible(false);
      // ---------- burn embers
      if (s.burning && now > this.nextEmber[i]) {
        this.nextEmber[i] = now + (speed >= 4 ? 300 : 140);
        this.fxl.ember(cx, chest);
      }
      // ---------- slow swirl at the feet
      const sw = this.swirl[i];
      if (s.slowed) {
        sw.setPosition(cx, this.ground + 1).setScale(0.3 * (1 + 0.05 * Math.sin(now / 200)), 0.3).setAlpha(0.85).setVisible(true);
        if (!this.still) sw.setFlipX(Math.floor(now / 180) % 2 === 0);
      } else sw.setVisible(false);
      // ---------- shield bubble
      const bb = this.bubble[i];
      if (s.shield) {
        const base = (this.heroH * 1.02) / (48 * 4);
        const ia = Math.min(1, (now - this.bubT[i]) / 180);
        const w = now - this.wobT[i];
        let sx = 1;
        let sy = 1;
        if (!this.still) {
          sx = ia < 1 ? 0.5 + 0.5 * ia + 0.12 * Math.sin(ia * Math.PI) : 1 + 0.025 * Math.sin(now / 260);
          sy = ia < 1 ? sx : 1 - 0.025 * Math.sin(now / 260);
          if (w < 420) {
            const d = 1 - w / 420;
            const o = Math.sin(w / 28) * 0.16 * this.wobK[i] * d * d;
            sx += o;
            sy -= o;
          }
        }
        bb.setPosition(cx, chest + 2).setScale(base * sx, base * sy).setAlpha(0.85 * Math.max(0.25, ia)).setVisible(true);
      } else bb.setVisible(false);
      // ---------- thorns outline
      const th = this.thornImg[i];
      const tf = now - this.thornT[i];
      if (s.thorns || tf < 320) {
        const burst = tf < 320 ? 1 - tf / 320 : 0;
        const base = (this.heroH * 0.95) / (64 * 4);
        th.setPosition(cx, chest + 2)
          .setScale(base * (1 + 0.18 * burst))
          .setAlpha(Math.min(1, (s.thorns ? 0.2 + 0.08 * Math.sin(now / 240) : 0) + burst))
          .setRotation(this.still ? 0 : now * 0.0004)
          .setVisible(true);
      } else th.setVisible(false);
    }
    this.silent = false;
    // ---------- damage numbers: pop 0 → 1.4 → 1 in 150ms, rise 40, fade out
    for (let j = 0; j < NUMS; j++) {
      const b = j * 6;
      if (!this.nv[b + 5]) continue;
      const t = this.nums[j];
      const age = now - this.nv[b];
      const life = this.nv[b + 4];
      if (age >= life) {
        this.nv[b + 5] = 0;
        t.setVisible(false);
        continue;
      }
      let sc = 1;
      if (!this.still) sc = age < 90 ? (age / 90) * 1.4 : age < 150 ? 1.4 - ((age - 90) / 60) * 0.4 : 1;
      const u = age / life;
      const rise = 40 * (1 - (1 - u) * (1 - u));
      t.setScale(sc).setY(this.nv[b + 2] - rise).setAlpha(u < 0.6 ? 1 : 1 - (u - 0.6) / 0.4);
    }
  }
}
