import { combatSfx } from './audio';
import Phaser from 'phaser';
import { ZOOM } from './view';
import { SKILLS, lvOf, nodeOf } from '../sim/skills';
import type { Build, CombatEvent, CombatResult, CooldownTrace, Fx, Side } from '../sim/types';
import { hashSeed } from '../sim/rng';
import { CHIBI_ORIGIN_Y, chibiScale, ensureChibi } from './chibi';
import { drawArenaBackdrop } from './townArt';

let resolveReady!: (s: CombatScene) => void;
export const sceneReady = new Promise<CombatScene>((r) => (resolveReady = r));

export const W = 640;
export const H = 300;
const GROUND = 250;
const POS = [205, 435];
const FONT = 'Kanit, sans-serif';
const ARCH_COLOR: Record<string, number> = {
  tank: 0x5aa0e6, burst: 0xe65a5a, scaling: 0xe6b45a, control: 0x7fe0f0, none: 0xaaaaaa,
};
const SIDE_COLOR = ['#9fd3ff', '#ffaaaa'];
/** chibi height in world units, feet to the top of the art */
const HERO_H = 116;
const HERO_S = chibiScale(HERO_H);

/** Look seed of a fighter: the one saved in the build, else one made from the player name (old builds, AI). */
const lookSeed = (side: { name: string; build: Build }) => side.build.look ?? hashSeed(side.name, side.build.hero);

export interface PlayData {
  result: CombatResult;
  left: { name: string; build: Build };
  right: { name: string; build: Build };
}

/** Side-view replay: our hero left, enemy right, executing skill in the center. */
export class CombatScene extends Phaser.Scene {
  speed = 2;
  private fighters!: Phaser.GameObjects.Image[];
  /** texture prefix per fighter once its chibi textures are ready (see ensureChibi) */
  private keys: (string | null)[] = [null, null];
  /** latest show() request per fighter, so a slow texture load can't overwrite a newer one */
  private want = ['', ''];
  private showSeq = 0;
  private dead = [false, false];
  private poseUntil = [0, 0];
  private poseKind: ('cast' | 'hit' | null)[] = [null, null];
  private bars!: Phaser.GameObjects.Graphics;
  private queue!: Phaser.GameObjects.Graphics;
  private nameTexts!: Phaser.GameObjects.Text[];
  private hpTexts!: Phaser.GameObjects.Text[];
  private skillText!: Phaser.GameObjects.Text;
  private clockText!: Phaser.GameObjects.Text;
  private banner!: Phaser.GameObjects.Text;
  /** big status over each fighter's head: frozen / cooldowns pushed back / never fired a skill */
  private lockTexts!: Phaser.GameObjects.Text[];
  private casts = [0, 0];
  private delayUntil = [0, 0];
  /** buff / debuff chips under each HP bar */
  private chips: Phaser.GameObjects.Text[][] = [[], []];
  private fx: (Fx | null)[] = [null, null];
  private fxT = [0, 0];
  /** per-tick cooldown progress (re-simulated locally) for the clock-wipe */
  private trace?: CooldownTrace;
  private lastTick = 0;

  private builds: Build[] = [];
  /** block idx → clock tick until which it glows */
  private glow: Map<number, number>[] = [new Map(), new Map()];
  private maxHp: [number, number] = [40, 40];
  private hp: [number, number] = [40, 40];
  private sh: [number, number] = [0, 0];
  private frozenUntil = [0, 0];
  private flashUntil = [0, 0];
  private evs: CombatEvent[] = [];
  private ei = 0;
  private clock = 0;
  private playing = false;
  private ending = false;
  private quiet = false;
  private onEvent?: (e: CombatEvent) => void;
  private onDone?: () => void;

  constructor() {
    super({ key: 'combat', active: true });
  }

  create() {
    this.cameras.main.setOrigin(0, 0).setZoom(ZOOM);
    this.drawBackground();
    this.fighters = [0, 1].map((i) =>
      this.add.image(POS[i], GROUND, '__DEFAULT').setOrigin(0.5, CHIBI_ORIGIN_Y).setScale(HERO_S).setFlipX(i === 1).setVisible(false),
    );
    this.bars = this.add.graphics();
    this.queue = this.add.graphics();
    const txt = (x: number, y: number, size: number, color = '#ffffff') =>
      this.add
        .text(x, y, '', { fontFamily: FONT, fontSize: size + 'px', color, stroke: '#000000', strokeThickness: 4 })
        .setOrigin(0.5);
    this.nameTexts = [txt(145, 48, 16, SIDE_COLOR[0]), txt(495, 48, 16, SIDE_COLOR[1])];
    this.hpTexts = [txt(145, 24, 14), txt(495, 24, 14)];
    this.skillText = txt(W / 2, 100, 26);
    this.clockText = txt(W / 2, 24, 14, '#bbbbbb');
    this.banner = txt(W / 2, 170, 48);
    this.lockTexts = [0, 1].map((i) =>
      this.add
        .text(POS[i], GROUND - HERO_H - 16, '', {
          fontFamily: FONT, fontSize: '15px', color: '#dff4ff', backgroundColor: '#1d3a5ccc', padding: { x: 6, y: 2 },
          stroke: '#0b1830', strokeThickness: 3,
        })
        .setOrigin(0.5)
        .setVisible(false),
    );
    for (const s of [0, 1])
      for (let i = 0; i < 8; i++)
        this.chips[s].push(
          this.add
            .text(0, 0, '', { fontFamily: FONT, fontSize: '11px', color: '#ffffff', backgroundColor: '#000000aa', padding: { x: 4, y: 1 } })
            .setOrigin(0, 0)
            .setVisible(false),
        );
    this.idle(null);
    resolveReady(this);
  }

  private drawBackground() {
    drawArenaBackdrop(this, W, H, GROUND);
  }

  /** Shop / menu: show our hero standing alone. */
  idle(hero: string | null, look = 0) {
    this.playing = false;
    this.tweens.killAll();
    this.banner.setText('');
    this.skillText.setText('');
    this.clockText.setText('');
    this.bars.clear();
    this.queue.clear();
    this.hpTexts.forEach((t) => t.setText(''));
    this.fx = [null, null];
    this.chips.forEach((row) => row.forEach((c) => c.setVisible(false)));
    this.nameTexts.forEach((t) => t.setText(''));
    this.lockTexts?.forEach((t) => t.setVisible(false));
    this.casts = [0, 0];
    this.delayUntil = [0, 0];
    this.fighters.forEach((f, i) => {
      f.setAngle(0).setAlpha(1).clearTint().setX(POS[i]).setVisible(false);
      this.keys[i] = null;
      this.want[i] = '';
      this.dead[i] = false;
      this.poseKind[i] = null;
    });
    if (hero) this.show(0, hero, look, W / 2);
  }

  /** Put a chibi on a fighter slot; it appears once its textures are made (first time only takes a moment). */
  private show(i: number, hero: string, seed: number, x: number) {
    const f = this.fighters[i];
    const token = `${++this.showSeq}`;
    this.want[i] = token;
    f.setX(x);
    void ensureChibi(this, hero, seed).then((prefix) => {
      if (this.want[i] !== token) return;
      this.keys[i] = prefix;
      f.setTexture(prefix + '_idle').setScale(HERO_S).setVisible(true);
    });
  }

  play(data: PlayData, onEvent: (e: CombatEvent) => void, onDone: () => void) {
    this.idle(null);
    this.builds = [data.left.build, data.right.build];
    [data.left, data.right].forEach((side, i) => {
      this.show(i, side.build.hero, lookSeed(side), POS[i]);
      this.nameTexts[i].setText(side.name);
    });
    this.maxHp = [...data.result.maxHp];
    this.hp = [...data.result.init.hp];
    this.sh = [...data.result.init.sh];
    this.fx = [...data.result.init.fx];
    this.fxT = [0, 0];
    this.glow = [new Map(), new Map()];
    this.frozenUntil = [0, 0];
    this.evs = data.result.events;
    this.trace = data.result.trace;
    this.lastTick = data.result.ticks;
    this.ei = 0;
    this.clock = 0;
    this.ending = false;
    this.onEvent = onEvent;
    this.onDone = onDone;
    this.drawBars();
    this.drawQueue();
    this.playing = true;
  }

  skip() {
    if (!this.playing) return;
    this.quiet = true;
    while (this.ei < this.evs.length) this.handle(this.evs[this.ei++]);
    this.quiet = false;
    this.clock = this.evs.at(-1)?.t ?? 0;
  }

  update(_t: number, delta: number) {
    if (!this.playing) return;
    this.clock += (delta * this.speed) / 100; // 100ms per tick at 1x
    while (this.ei < this.evs.length && this.evs[this.ei].t <= this.clock) this.handle(this.evs[this.ei++]);
    this.drawQueue();
    this.drawChips();
    this.drawLocks();
    const lastT = this.evs.at(-1)?.t ?? 0;
    this.clockText.setText((Math.min(this.clock, lastT) / 10).toFixed(1) + ' วิ');
    const now = this.time.now;
    this.fighters.forEach((f, i) => {
      const key = this.keys[i];
      if (!key || this.dead[i]) return;
      if (this.poseKind[i] && now > this.poseUntil[i]) {
        this.poseKind[i] = null;
        f.setTexture(key + '_idle');
      }
      // soft mochi breathing: squash and stretch around the feet
      const b = Math.sin(now / 300 + i * 1.7);
      f.setScale(HERO_S * (1 + b * 0.012), HERO_S * (1 - b * 0.02));
      if (now < this.flashUntil[i]) f.setTintFill(0xffffff);
      else if (this.clock < this.frozenUntil[i]) f.setTint(0x88ccff);
      else f.clearTint();
    });
    if (this.ei >= this.evs.length && !this.ending) {
      this.ending = true;
      this.time.delayedCall(1400, () => {
        this.playing = false;
        this.onDone?.();
      });
    }
  }

  /** Short cast / hit pose, then back to the idle loop. Ignored once the fighter is down. */
  private pose(side: number, kind: 'cast' | 'hit') {
    const key = this.keys[side];
    if (!key || this.dead[side]) return;
    const now = this.time.now;
    if (kind === 'hit' && this.poseKind[side] === 'cast' && now < this.poseUntil[side]) return; // casting wins
    this.poseKind[side] = kind;
    this.poseUntil[side] = now + this.dur(kind === 'cast' ? 380 : 300);
    this.fighters[side].setTexture(`${key}_${kind}`);
  }

  private dur(ms: number) {
    return ms / Math.max(1, this.speed * 0.6);
  }

  private float(side: number, text: string, color: string, dy = 0) {
    if (this.quiet) return;
    const t = this.add
      .text(POS[side] + Phaser.Math.Between(-24, 24), GROUND - 110 + dy, text, {
        fontFamily: FONT, fontSize: '20px', color, stroke: '#000000', strokeThickness: 4,
      })
      .setOrigin(0.5);
    this.tweens.add({ targets: t, y: t.y - 40, alpha: 0, duration: this.dur(900), onComplete: () => t.destroy() });
  }

  private handle(e: CombatEvent) {
    this.hp = [...e.s.hp];
    this.sh = [...e.s.sh];
    if (e.s.fx) {
      this.fx = [...e.s.fx];
      this.fxT = [e.t, e.t];
    }
    switch (e.type) {
      case 'cast': {
        const d = SKILLS[e.skill];
        if (!e.echo) this.casts[e.side]++;
        this.glow[e.side].set(e.idx, e.t + 5);
        if (!this.quiet) {
          const f = this.fighters[e.side];
          const dir = e.side === 0 ? 1 : -1;
          this.tweens.killTweensOf(f);
          f.setX(POS[e.side]);
          this.tweens.add({ targets: f, x: POS[e.side] + dir * 26, duration: this.dur(90), yoyo: true });
          this.pose(e.side, 'cast');
          const inst = this.builds[e.side]?.skills[e.idx];
          const label = `${e.side === 0 ? '▶ ' : ''}${inst ? nodeOf(inst).name : d.name} Lv${e.lv}${e.echo ? ' (ซ้ำ)' : ''}${e.side === 1 ? ' ◀' : ''}`;
          this.skillText.setText(label).setColor(SIDE_COLOR[e.side]).setAlpha(1).setScale(1);
          this.tweens.killTweensOf(this.skillText);
          this.tweens.add({ targets: this.skillText, alpha: 0, delay: this.dur(500), duration: this.dur(400) });
        }
        break;
      }
      case 'damage': {
        const color = e.src === 'burn' ? '#ff9933' : e.src === 'fatigue' ? '#bbbbbb' : e.src === 'thorns' ? '#c9a0ff' : '#ff5555';
        if (e.amount > 0) this.float(e.side, `-${e.amount}`, color);
        if (e.blocked > 0) this.float(e.side, `(${e.blocked})`, '#7fc8ff', 22);
        if (!this.quiet && e.amount > 0) {
          this.flashUntil[e.side] = this.time.now + 70;
          if (e.src !== 'fatigue' && e.src !== 'burn') this.pose(e.side, 'hit');
          if (e.amount >= 10) this.cameras.main.shake(140, 0.008);
        }
        break;
      }
      case 'shield':
        this.float(e.side, `+${e.amount} โล่`, '#7fc8ff');
        break;
      case 'heal':
        this.float(e.side, `+${e.amount}`, '#66ff88');
        break;
      case 'status': {
        const map: Record<string, [string, string]> = {
          freeze: [e.value > 0 ? 'แช่แข็ง!' : 'ต้านได้', '#aee6ff'],
          slow: ['ช้าลง', '#aee6ff'],
          burn: ['ติดไฟ', '#ff9933'],
          grow: [`พลัง ${e.value}`, '#ffd166'],
          charge: [`x${e.value}`, '#ffd166'],
          thorns: ['หนาม', '#c9a0ff'],
          steadfast: ['ใจเหล็ก', '#ffffff'],
          rage: ['คลั่ง!', '#ff4444'],
          amplify: [e.value > 0 ? 'บัฟ x2!' : 'ยังไม่มีบัฟ', '#ffd166'],
          cleanse: [e.value > 0 ? `ชำระล้าง ${e.value}` : 'ไม่มีดีบัฟ', '#aaffcc'],
          dispel: [e.value > 0 ? `สลายบัฟ ${e.value}!` : 'ไม่มีบัฟให้ลบ', '#c9a0ff'],
          delay: [e.value > 0 ? `ถอยเวลา ${(e.value / 10).toFixed(1)} วิ` : 'ต้านได้', '#b8a0ff'],
        };
        const [txt, col] = map[e.status] ?? [e.status, '#ffffff'];
        this.float(e.side, txt, col, -24);
        if (e.status === 'freeze' && e.value > 0) this.frozenUntil[e.side] = Math.max(this.frozenUntil[e.side], e.t + e.value);
        if (e.status === 'cleanse' && e.value > 0) this.frozenUntil[e.side] = Math.min(this.frozenUntil[e.side], e.t);
        if (e.status === 'delay' && e.value > 0) this.delayUntil[e.side] = e.t + Math.max(8, Math.min(20, e.value));
        break;
      }
      case 'fatigue':
        if (!this.quiet) this.skillText.setText(`เหนื่อยล้า -${e.amount}`).setColor('#cccccc').setAlpha(1);
        break;
      case 'end': {
        const w = e.winner;
        this.banner.setText(w === 0 ? 'ชนะ!' : w === 1 ? 'แพ้' : 'เสมอ').setColor(w === 0 ? '#66ff88' : w === 1 ? '#ff6666' : '#dddddd');
        this.banner.setScale(0.5);
        this.tweens.add({ targets: this.banner, scale: 1, duration: 250, ease: 'Back.Out' });
        ([0, 1] as Side[]).forEach((s) => {
          if (w !== -1 && s !== w) {
            const f = this.fighters[s];
            const key = this.keys[s];
            if (!key) return;
            this.dead[s] = true;
            f.setTexture(key + '_hit').setScale(HERO_S).setTint(0xa49cbc);
            this.tweens.add({ targets: f, angle: s === 0 ? -84 : 84, alpha: 0.85, duration: 380, ease: 'Bounce.easeOut' });
          }
        });
        break;
      }
    }
    this.drawBars();
    if (!this.quiet) combatSfx(e, 0);
    this.onEvent?.(e);
  }

  /** Frozen / pushed-back label over a fighter, and "no skill fired" once the fight is over. */
  private drawLocks() {
    const tick = Math.max(0, Math.min(this.lastTick, Math.floor(this.clock)));
    const over = this.ei >= this.evs.length;
    for (const s of [0, 1]) {
      const t = this.lockTexts[s];
      const frozen = this.trace ? this.trace.fr[s][tick] === 1 : this.clock < this.frozenUntil[s];
      let label = '';
      let bg = '#1d3a5ccc';
      if (over && this.casts[s] === 0 && this.evs.length) {
        label = 'ไม่ได้ใช้ skill เลย';
        bg = '#4a1f3acc';
      } else if (frozen && !this.dead[s]) {
        const left = Math.max(0, this.frozenUntil[s] - this.clock) / 10;
        label = `❄ โดนแช่แข็ง${left > 0.05 ? ` ${left.toFixed(1)}` : ''}`;
      } else if (this.clock < this.delayUntil[s] && !this.dead[s]) {
        label = '⏪ คูลดาวน์ถอยหลัง';
        bg = '#33275ccc';
      }
      if (!label) {
        t.setVisible(false);
        continue;
      }
      if (t.text !== label) t.setText(label).setBackgroundColor(bg);
      t.setVisible(true);
    }
  }

  private drawBars() {
    const g = this.bars.clear();
    for (const s of [0, 1]) {
      const x0 = s === 0 ? 20 : 370;
      const w = 250;
      const hpW = Math.max(0, Math.round((w * this.hp[s]) / this.maxHp[s]));
      const shW = Math.min(w, Math.round((w * this.sh[s]) / this.maxHp[s]));
      g.fillStyle(0x000000).fillRect(x0 - 2, 12, w + 4, 26);
      g.fillStyle(0x3a1d1d).fillRect(x0, 14, w, 22);
      g.fillStyle(this.hp[s] / this.maxHp[s] > 0.35 ? 0x4fd16b : 0xe0a030);
      g.fillRect(s === 0 ? x0 : x0 + w - hpW, 14, hpW, 22);
      if (shW > 0) {
        g.fillStyle(0x7fc8ff);
        g.fillRect(s === 0 ? x0 : x0 + w - shW, 14, shW, 6);
      }
      this.hpTexts[s].setText(`${Math.max(0, this.hp[s])}/${this.maxHp[s]}${this.sh[s] ? `  โล่ ${this.sh[s]}` : ''}`);
    }
  }

  /** Buff chips (gold) then debuff chips (red) under each HP bar. Timed debuffs count down. */
  private drawChips() {
    for (const s of [0, 1]) {
      const f = this.fx[s];
      const row = this.chips[s];
      const list: [string, string][] = [];
      if (f) {
        const since = Math.max(0, this.clock - this.fxT[s]);
        const fr = Math.max(0, f.fr - since);
        const slt = Math.max(0, f.slt - since);
        if (f.g > 0) list.push([`พลัง +${f.g}`, '#ffd166']);
        if (f.c > 1) list.push([`รวมพลัง x${+f.c.toFixed(2)}`, '#ffd166']);
        if (f.th > 0) list.push([`หนาม ${f.th}`, '#ffd166']);
        if (f.sf) list.push(['ใจเหล็ก', '#ffd166']);
        if (f.b > 0) list.push([`ไฟ ${f.b}/วิ`, '#ff7b5c']);
        if (fr > 0) list.push([`แช่แข็ง ${(fr / 10).toFixed(1)}`, '#8fd8ff']);
        if (f.sl > 0 && slt > 0) list.push([`ช้า ${f.sl}%`, '#8fd8ff']);
      }
      let x = s === 0 ? 20 : 370;
      let y = 62;
      row.forEach((c, i) => {
        const item = list[i];
        if (!item) return c.setVisible(false);
        const buff = item[1] === '#ffd166';
        c.setText(item[0]).setColor(item[1]).setBackgroundColor(buff ? '#2a2108dd' : '#2a0b0bdd').setVisible(true);
        if (x + c.width > (s === 0 ? 270 : 620)) {
          x = s === 0 ? 20 : 370;
          y += 18;
        }
        c.setPosition(x, y);
        x += c.width + 4;
      });
    }
  }

  /**
   * Each fighter's skill list beside them, top to bottom: a colour chip per skill and a cooldown bar
   * that fills as the cooldown runs. A skill flashes white when it fires; bars turn ice-blue while frozen.
   */
  private drawQueue() {
    const g = this.queue.clear();
    const rowH = 13;
    const barW = 54;
    const tick = Math.max(0, Math.min(this.lastTick, Math.floor(this.clock)));
    for (const s of [0, 1]) {
      const b = this.builds[s];
      if (!b || !b.skills.length) continue;
      const n = b.skills.length;
      const w = 14 + barW;
      const ox = s === 0 ? 12 : W - 12 - w;
      const oy = GROUND - 8 - n * rowH;
      g.fillStyle(0x0b0e13, 0.82).fillRoundedRect(ox - 4, oy - 4, w + 8, n * rowH + 6, 4);
      g.lineStyle(1, 0x3a424d).strokeRoundedRect(ox - 4, oy - 4, w + 8, n * rowH + 6, 4);
      const frozen = this.trace ? this.trace.fr[s][tick] === 1 : false;
      b.skills.forEach((k, i) => {
        const y = oy + i * rowH;
        const color = ARCH_COLOR[SKILLS[k.id]?.arch ?? 'none'];
        const lit = (this.glow[s].get(i) ?? -1) >= this.clock;
        g.fillStyle(lit ? 0xffffff : color, 1).fillRect(ox, y, 10, 10);
        // level pips under the chip
        g.fillStyle(0xffffff, 0.85);
        for (let l = 0; l < lvOf(k.v); l++) g.fillRect(ox + l * 3, y + 10, 2, 1);
        const bx = ox + 14;
        g.fillStyle(0x000000, 0.6).fillRect(bx, y + 2, barW, 6);
        const ratio = lit ? 1 : this.trace ? this.trace.p[s][tick * this.trace.n[s] + i] / 255 : 0;
        if (ratio > 0.01) {
          g.fillStyle(lit ? 0xffffff : frozen && k.mark !== 'steadfast' ? 0x8fd8ff : ratio > 0.9 ? 0xffffff : color, 1);
          g.fillRect(bx, y + 2, Math.round(barW * ratio), 6);
        }
      });
      if (frozen) g.lineStyle(2, 0x8fd8ff, 0.9).strokeRect(ox - 2, oy - 2, w + 4, n * rowH + 2);
    }
  }
}
