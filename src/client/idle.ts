import Phaser from 'phaser';
import { ensureChibiExtras } from './chibi';
import { onPerf } from './perf';
import { ARENA_LANTERNS, ARENA_STANDS, FOLK_COLORS, R, makeArenaLifeArt } from './townArt';
import { reducedMotion } from './fx';

/**
 * Life in the combat arena while nothing is fighting (shop, hero pick, menus):
 * - ArenaLife: lanterns sway and glow, sakura petals drift, bunnies in the stands bounce, all hop on a cheer.
 * - HeroIdle: the hero standing in the arena breathes (squash and stretch), blinks, looks around, hops now and
 *   then, and reacts to the shop (happy hop + sparkles on a buy, a sad wobble on a sell).
 * Everything is moved by hand in update() with preallocated objects (no tweens, no per-frame allocations),
 * so CombatScene.idle()'s tweens.killAll() never cuts it off. Phaser itself stops the loop when the tab is hidden.
 * prefers-reduced-motion: everything stands still (no petals, no hops), only the lantern glow stays.
 */

const rand = (a: number, b: number) => a + Math.random() * (b - a);

const PETALS = 12;
const BUNNIES = 12;

export class ArenaLife {
  private lanterns: Phaser.GameObjects.Image[] = [];
  private glows: Phaser.GameObjects.Image[] = [];
  private petals: Phaser.GameObjects.Image[] = [];
  /** per petal: vx, vy (units/ms), wobble phase, spin */
  private pv = new Float32Array(PETALS * 4);
  private bunnies: Phaser.GameObjects.Image[] = [];
  /** per bunny: base y, next hop time, hop start time, hop height */
  private bv = new Float32Array(BUNNIES * 4);
  private still = reducedMotion();
  /** graphics tier (perf.ts): how many petals fall, whether the stands hop */
  private nPetals = PETALS;
  private hops = true;

  constructor(
    private scene: Phaser.Scene,
    private w: number,
    private h: number,
    ground: number,
  ) {
    makeArenaLifeArt(scene);
    const s = 1 / R;
    for (let i = 0; i < BUNNIES; i++) {
      const row = i % ARENA_STANDS.rows;
      const y = ARENA_STANDS.top + row * ARENA_STANDS.step + 10;
      const b = scene.add
        .image(rand(14, w - 14), y, 'life_bunny_' + (i % FOLK_COLORS.length))
        .setOrigin(0.5, 1)
        .setScale(s);
      this.bunnies.push(b);
      this.bv[i * 4] = y;
      this.bv[i * 4 + 1] = rand(0, 4000);
      this.bv[i * 4 + 2] = -1;
      this.bv[i * 4 + 3] = rand(2.5, 4.5);
    }
    for (const lx of ARENA_LANTERNS) {
      this.glows.push(scene.add.image(lx + 5, ground - 44, 'life_glow').setScale(s * 1.1).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.7));
      this.lanterns.push(scene.add.image(lx + 5, ground - 56, 'life_lantern').setOrigin(0.5, 0).setScale(s));
    }
    for (let i = 0; i < PETALS; i++) {
      const p = scene.add.image(rand(0, w), rand(0, h), 'life_petal').setScale(s * rand(0.8, 1.3)).setAlpha(0.85);
      p.setVisible(!this.still);
      this.petals.push(p);
      this.resetPetal(i, false);
    }
    onPerf((p) => {
      this.nPetals = this.still ? 0 : p.petals;
      this.hops = p.hops;
      this.petals.forEach((pt, i) => pt.setVisible(i < this.nPetals));
      if (!p.hops) for (let i = 0; i < BUNNIES; i++) this.bunnies[i].y = this.bv[i * 4];
    });
  }

  private resetPetal(i: number, top: boolean) {
    const p = this.petals[i];
    if (top) p.setPosition(rand(-40, this.w), -6);
    this.pv[i * 4] = rand(0.008, 0.02);
    this.pv[i * 4 + 1] = rand(0.012, 0.025);
    this.pv[i * 4 + 2] = rand(0, Math.PI * 2);
    this.pv[i * 4 + 3] = rand(-0.12, 0.12);
  }

  /** Everyone in the stands hops once, slightly out of step (a buy, a win). */
  cheer() {
    const now = this.scene.time.now;
    for (let i = 0; i < BUNNIES; i++) {
      this.bv[i * 4 + 1] = now + rand(0, 260);
      this.bv[i * 4 + 3] = rand(4, 7);
    }
  }

  update(now: number, delta: number) {
    const dt = Math.min(delta, 50);
    // lanterns: a slow sway, each a little out of phase; their glow breathes
    for (let i = 0; i < this.lanterns.length; i++) {
      const ph = now / 900 + i * 1.3;
      this.lanterns[i].setAngle(this.still ? 0 : Math.sin(ph) * 7);
      this.glows[i].setAlpha(0.55 + 0.2 * Math.sin(now / 700 + i * 2.1));
      if (!this.still) this.glows[i].x = this.lanterns[i].x - Math.sin(ph) * 1.2;
    }
    if (this.still) return;
    for (let i = 0; i < this.nPetals; i++) {
      const p = this.petals[i];
      const o = i * 4;
      p.x += this.pv[o] * dt + Math.sin(now / 600 + this.pv[o + 2]) * 0.012 * dt;
      p.y += this.pv[o + 1] * dt;
      p.rotation += this.pv[o + 3] * dt * 0.05;
      if (p.y > this.h + 6 || p.x > this.w + 10) this.resetPetal(i, true);
    }
    if (!this.hops) return;
    for (let i = 0; i < BUNNIES; i++) {
      const o = i * 4;
      const b = this.bunnies[i];
      if (this.bv[o + 2] < 0 && now >= this.bv[o + 1]) this.bv[o + 2] = now;
      const t0 = this.bv[o + 2];
      if (t0 >= 0) {
        const t = (now - t0) / 360;
        if (t >= 1) {
          b.y = this.bv[o];
          this.bv[o + 2] = -1;
          this.bv[o + 1] = now + rand(1200, 5200);
          this.bv[o + 3] = rand(2.5, 4.5);
        } else b.y = this.bv[o] - this.bv[o + 3] * 4 * t * (1 - t);
      }
    }
  }
}

/** Idle moves of the hero alone in the arena. */
type Act = 'none' | 'hop' | 'look' | 'happy' | 'sad';

const SPARKS = 10;

export class HeroIdle {
  private img: Phaser.GameObjects.Image | null = null;
  private prefix = '';
  /** texture keys, built once per hero (no string building per frame) */
  private kIdle = '';
  private kBlink = '';
  private kHappy = '';
  private extras = false;
  private baseX = 0;
  private baseY = 0;
  private baseS = 1;
  private act: Act = 'none';
  private actT0 = 0;
  private actLen = 0;
  private hops = 1;
  private nextBlink = 0;
  private blinkUntil = 0;
  private nextAct = 0;
  private lookDir = 1;
  private faceUntil = 0;
  private sparks: Phaser.GameObjects.Image[] = [];
  /** per spark: vx, vy, born */
  private sv = new Float32Array(SPARKS * 3);
  private still = reducedMotion();

  constructor(private scene: Phaser.Scene) {
    for (let i = 0; i < SPARKS; i++) {
      this.sparks.push(scene.add.image(0, 0, 'life_spark').setScale(1 / R).setDepth(20).setBlendMode(Phaser.BlendModes.ADD).setVisible(false));
      this.sv[i * 3 + 2] = -1;
    }
  }

  /** Start idling with this sprite (already showing `${prefix}_idle`). */
  attach(img: Phaser.GameObjects.Image, prefix: string, hero: string, seed: number, scale: number) {
    this.img = img;
    this.prefix = prefix;
    this.kIdle = prefix + '_idle';
    this.kBlink = prefix + '_blink';
    this.kHappy = prefix + '_happy';
    this.baseX = img.x;
    this.baseY = img.y;
    this.baseS = scale;
    this.extras = this.scene.textures.exists(prefix + '_happy');
    if (!this.extras)
      void ensureChibiExtras(this.scene, hero, seed).then((p) => {
        if (p === this.prefix) this.extras = true;
      });
    const now = this.scene.time.now;
    this.act = 'none';
    this.nextBlink = now + rand(1200, 3000);
    this.nextAct = now + rand(2500, 5000);
    this.lookDir = 1;
    this.faceUntil = 0;
  }

  detach() {
    if (this.img) this.img.setFlipX(false).setAngle(0);
    this.img = null;
    for (const s of this.sparks) s.setVisible(false);
  }

  get active() {
    return !!this.img;
  }

  private start(act: Act, len: number, hops = 1) {
    this.act = act;
    this.actT0 = this.scene.time.now;
    this.actLen = len;
    this.hops = hops;
  }

  /** The shop asks for a reaction: 'buy' = happy double hop + sparkles, 'sell' = sad wobble, 'pick' / 'reroll' = small hop. */
  react(kind: 'buy' | 'sell' | 'reroll' | 'pick') {
    if (!this.img) return;
    const now = this.scene.time.now;
    if (kind === 'buy') {
      this.faceUntil = now + 1100;
      this.burst();
      if (!this.still) this.start('happy', 760, 2);
    } else if (kind === 'sell') {
      this.blinkUntil = now + 420;
      if (!this.still) this.start('sad', 620);
    } else if (!this.still) {
      this.lookDir = -this.lookDir;
      this.start(kind === 'pick' ? 'happy' : 'hop', 420, 1);
      if (kind === 'pick') this.faceUntil = now + 700;
    }
    this.nextAct = now + rand(3500, 6000);
  }

  private burst() {
    const now = this.scene.time.now;
    for (let i = 0; i < SPARKS; i++) {
      const a = (i / SPARKS) * Math.PI * 2 + rand(-0.2, 0.2);
      const sp = rand(0.05, 0.1);
      this.sv[i * 3] = Math.cos(a) * sp;
      this.sv[i * 3 + 1] = Math.sin(a) * sp - 0.03;
      this.sv[i * 3 + 2] = now;
      this.sparks[i].setPosition(this.baseX, this.baseY - 60).setVisible(true).setAlpha(1);
    }
  }

  update(now: number, delta: number) {
    const dt = Math.min(delta, 50);
    for (let i = 0; i < SPARKS; i++) {
      const born = this.sv[i * 3 + 2];
      if (born < 0) continue;
      const s = this.sparks[i];
      const t = (now - born) / 700;
      if (t >= 1) {
        s.setVisible(false);
        this.sv[i * 3 + 2] = -1;
        continue;
      }
      s.x += this.sv[i * 3] * dt;
      s.y += this.sv[i * 3 + 1] * dt;
      this.sv[i * 3 + 1] += 0.00012 * dt;
      s.setAlpha(1 - t).setScale((1 / R) * (1.4 - t * 0.8));
    }
    const img = this.img;
    if (!img || !img.visible) return;
    // face: happy > blink > idle
    let key = this.kIdle;
    if (this.extras) {
      if (now < this.faceUntil) key = this.kHappy;
      else if (now < this.blinkUntil) key = this.kBlink;
      else if (now >= this.nextBlink) {
        this.blinkUntil = now + 130;
        // sometimes a double blink
        this.nextBlink = Math.random() < 0.25 ? now + 260 : now + rand(2200, 4800);
        key = this.kBlink;
      }
    }
    if (img.texture.key !== key) img.setTexture(key);
    if (this.still) {
      img.setScale(this.baseS).setPosition(this.baseX, this.baseY).setAngle(0);
      return;
    }
    // pick the next idle move
    if (this.act === 'none' && now >= this.nextAct) {
      const r = Math.random();
      if (r < 0.45) {
        this.lookDir = -this.lookDir;
        this.start('look', 1600);
      } else this.start('hop', 440, Math.random() < 0.3 ? 2 : 1);
      this.nextAct = now + rand(3000, 6500);
    }
    // breathing: soft squash and stretch around the feet
    const br = Math.sin(now / 420);
    let sx = 1 + br * 0.018;
    let sy = 1 - br * 0.028;
    let y = this.baseY;
    let x = this.baseX;
    let ang = 0;
    if (this.act !== 'none') {
      const t = (now - this.actT0) / this.actLen;
      if (t >= 1) {
        this.act = 'none';
        if (this.lookDir < 0 && Math.random() < 0.6) this.lookDir = 1;
      } else if (this.act === 'hop' || this.act === 'happy') {
        const n = this.hops;
        const k = (t * n) % 1;
        const height = this.act === 'happy' ? 22 : 12;
        if (k < 0.15) {
          // crouch before the jump
          const c = Math.sin((k / 0.15) * Math.PI);
          sx *= 1 + 0.1 * c;
          sy *= 1 - 0.12 * c;
        } else if (k > 0.85) {
          const c = Math.sin(((k - 0.85) / 0.15) * Math.PI);
          sx *= 1 + 0.12 * c;
          sy *= 1 - 0.14 * c;
        } else {
          const a = (k - 0.15) / 0.7;
          y -= height * 4 * a * (1 - a);
          sx *= 0.94;
          sy *= 1.07;
        }
      } else if (this.act === 'sad') {
        ang = Math.sin(t * Math.PI * 4) * 7 * (1 - t);
        sy *= 1 - 0.06 * Math.sin(t * Math.PI);
        sx *= 1 + 0.04 * Math.sin(t * Math.PI);
      } else if (this.act === 'look') {
        // a small step towards where it looks, then back
        x += this.lookDir * 8 * Math.sin(Math.min(1, t * 1.4) * Math.PI);
      }
    }
    img.setFlipX(this.lookDir < 0);
    img.setPosition(x, y).setAngle(ang).setScale(this.baseS * sx, this.baseS * sy);
  }
}
