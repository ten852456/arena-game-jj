import { combatSfx, fightSfx, voice } from './audio';
import Phaser from 'phaser';
import { DangerVignette } from './danger';
import { confetti, drawPlate } from './winFx';
import { ZOOM } from './view';
import { HEROES_BY_ID } from '../sim/heroes';
import { SKILLS, nodeOf } from '../sim/skills';
import type { Build, CombatEvent, CombatResult, CooldownTrace, Fx, Side } from '../sim/types';
import { hashSeed } from '../sim/rng';
import { CHIBI_ORIGIN_Y, chibiScale, ensureChibi } from './chibi';
import { drawArenaBackdrop } from './townArt';
import { L } from '../i18n';
import { chainPopup } from './fightChain';
import { ArenaLife, HeroIdle } from './idle';
import { SKILL_ICON_IDS, skillIcon } from './assets';
import { FxLayer, fxPlan, reducedMotion } from './fx';
import { FighterFx, type FighterState } from './fighterFx';
import { LINE_HEX, SkillStrip, type StripState } from './skillStrip';

let resolveReady!: (s: CombatScene) => void;
export const sceneReady = new Promise<CombatScene>((r) => (resolveReady = r));

export const W = 640;
export const H = 300;
const GROUND = 250;
const POS = [205, 435];
const FONT = 'Kanit, sans-serif';
const SIDE_COLOR = ['#9fd3ff', '#ffaaaa'];
/** chibi height in world units, feet to the top of the art */
const HERO_H = 116;
const HERO_S = chibiScale(HERO_H);
/** a fighter's chest height, where skill effects play */
const CHEST = GROUND - Math.round(HERO_H * 0.45);

/** Look seed of a fighter: the one saved in the build, else one made from the player name (old builds, AI). */
/** seedName (the untranslated name) keeps a look stable when the language changes */
const lookSeed = (side: { name: string; seedName?: string; build: Build }) => side.build.look ?? hashSeed(side.seedName ?? side.name, side.build.hero);

export interface PlayData {
  result: CombatResult;
  left: { name: string; seedName?: string; build: Build };
  right: { name: string; seedName?: string; build: Build };
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
  /** skill icons with cooldown wipes on the floor (skillStrip.ts) and the skill effects (fx.ts) */
  private strip!: SkillStrip;
  private fxl!: FxLayer;
  private stripState!: StripState;
  private slowed = [false, false];
  /** voice cues already played this fight (one of each, so the announcer does not chatter) */
  private said = new Set<string>();
  private nameTexts!: Phaser.GameObjects.Text[];
  private hpTexts!: Phaser.GameObjects.Text[];
  private skillText!: Phaser.GameObjects.Text;
  private clockText!: Phaser.GameObjects.Text;
  private banner!: Phaser.GameObjects.Text;
  private bannerPlate!: Phaser.GameObjects.Graphics;
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
  /** chain links flashing in each fighter's skill queue: rows a and b, until clock tick */
  private chainFlash: { a: number; b: number; until: number }[][] = [[], []];
  private maxHp: [number, number] = [40, 40];
  private hp: [number, number] = [40, 40];
  private danger!: DangerVignette;
  private sh: [number, number] = [0, 0];
  private frozenUntil = [0, 0];
  private evs: CombatEvent[] = [];
  private ei = 0;
  private clock = 0;
  private playing = false;
  private ending = false;
  private quiet = false;
  private onEvent?: (e: CombatEvent) => void;
  private onDone?: () => void;
  /** ambient arena life (lanterns, petals, crowd) and the shop hero's idle moves (idle.ts) */
  private life!: ArenaLife;
  private heroIdle!: HeroIdle;
  /** hero + look standing alone in the arena right now ('' = none) */
  private idleKey = '';

  // ---------- combat juice (see the recipe in docs/RESEARCH_UI.md)
  /** status looks on the fighters + damage numbers (fighterFx.ts) */
  private ffx!: FighterFx;
  private fstate: FighterState[] = [0, 1].map(() => ({ frozen: false, burning: false, slowed: false, shield: false, thorns: false, dead: false }));
  private readonly still = reducedMotion();
  /**
   * Visual clock (ms): runs at 1x normally, ~0 during hit-stop and 0.3x during the kill slow-mo. Fighter motion,
   * particles, numbers and the skill strip's fire animations all run on it, so a hit-stop freezes the whole picture.
   */
  private vnow = 0;
  /** real-time (scene ms) marks: replay clock paused until holdUntil (a shot in flight), hit-stop until stopUntil,
   *  slow-mo until slowUntil. Events after a hold wait, so HP bars, numbers and the log stay in step. */
  private holdUntil = 0;
  private stopUntil = 0;
  private slowUntil = 0;
  /** decaying camera shake: start (scene ms), duration, amplitude (world units) */
  private shT0 = 0;
  private shDur = 0;
  private shAmp = 0;
  /** per fighter, in visual ms: breathing phase, anticipation squash, lunge, knockback */
  private bph = [0, 0];
  private anticT0 = [-1e9, -1e9];
  private anticMs = [80, 80];
  private lungeT0 = [-1e9, -1e9];
  private knockT0 = [-1e9, -1e9];
  private knockAmp = [0, 0];
  /** chain step of the cast in progress per side (0 = not a chain), tick of the last chained cast, its step */
  private castChain = [0, 0];
  private chainTick = [-1, -1];
  private chainN = [0, 0];
  /** hits landed by the cast in progress per side (the first one gets the full hit-stop) */
  private castHits = [0, 0];
  private lastStatus = [-1e9, -1e9];

  constructor() {
    super({ key: 'combat', active: true });
  }

  preload() {
    // round skill badges for the in-fight skill strip and the cast pop
    for (const id of SKILL_ICON_IDS) this.load.image(`sk_${id}`, skillIcon(id));
  }

  create() {
    this.cameras.main.setOrigin(0, 0).setZoom(ZOOM);
    this.drawBackground();
    this.life = new ArenaLife(this, W, H, GROUND);
    this.fighters = [0, 1].map((i) =>
      this.add.image(POS[i], GROUND, '__DEFAULT').setOrigin(0.5, CHIBI_ORIGIN_Y).setScale(HERO_S).setFlipX(i === 1).setVisible(false),
    );
    this.bars = this.add.graphics();
    this.strip = new SkillStrip(this, GROUND + 22);
    this.fxl = new FxLayer(this);
    this.danger = new DangerVignette(this, W, H);
    this.fighters.forEach((f) => f.setDepth(2));
    this.ffx = new FighterFx(this, this.fxl, POS, GROUND, HERO_H);
    const trace = () => this.trace;
    const tickNow = () => Math.max(0, Math.min(this.lastTick, Math.floor(this.clock)));
    this.stripState = {
      clock: 0,
      ratio: (s, i) => {
        const tr = trace();
        return tr ? tr.p[s][tickNow() * tr.n[s] + i] / 255 : 0;
      },
      glow: this.glow,
      chainFlash: this.chainFlash,
      frozen: [false, false],
      slowed: this.slowed,
      dead: this.dead,
      now: 0,
    };
    const txt = (x: number, y: number, size: number, color = '#ffffff') =>
      this.add
        .text(x, y, '', { fontFamily: FONT, fontSize: size + 'px', color, stroke: '#000000', strokeThickness: 4 })
        .setOrigin(0.5);
    this.nameTexts = [txt(145, 48, 16, SIDE_COLOR[0]), txt(495, 48, 16, SIDE_COLOR[1])];
    this.hpTexts = [txt(145, 24, 14), txt(495, 24, 14)];
    this.skillText = txt(W / 2, 100, 26).setDepth(20);
    this.clockText = txt(W / 2, 24, 14, '#bbbbbb');
    this.banner = txt(W / 2, 150, 48).setDepth(22);
    this.bannerPlate = this.add.graphics().setDepth(21);
    this.lockTexts = [0, 1].map((i) =>
      this.add
        .text(POS[i], GROUND - HERO_H - 16, '', {
          fontFamily: FONT, fontSize: '15px', color: '#dff4ff', backgroundColor: '#1d3a5ccc', padding: { x: 6, y: 2 },
          stroke: '#0b1830', strokeThickness: 3,
        })
        .setOrigin(0.5)
        .setDepth(20)
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
    this.heroIdle = new HeroIdle(this);
    this.idle(null);
    resolveReady(this);
  }

  private drawBackground() {
    drawArenaBackdrop(this, W, H, GROUND);
  }

  /** Shop / menu: show our hero standing alone. */
  idle(hero: string | null, look = 0) {
    // the shop re-renders on every click: keep the same hero idling instead of restarting it
    const key = hero ? `${hero}:${look}` : '';
    if (!this.playing && key && key === this.idleKey && this.keys[0]) return;
    this.idleKey = key;
    this.heroIdle?.detach();
    this.playing = false;
    this.tweens.killAll();
    this.banner.setText('');
    this.bannerPlate.clear();
    this.endWinner = null;
    this.skillText.setText('');
    this.clockText.setText('');
    this.bars.clear();
    this.strip.setBuilds(null);
    this.fxl.clear();
    this.ffx.clear();
    this.resetJuice();
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
      if (!this.playing && i === 0 && this.idleKey) this.heroIdle.attach(f, prefix, hero, seed, HERO_S);
    });
  }

  /** The hero in the arena reacts to the shop: buy = happy hop + sparkles (and the crowd cheers), sell = sad wobble. */
  react(kind: 'buy' | 'sell' | 'reroll' | 'pick') {
    if (this.playing) return;
    this.heroIdle.react(kind);
    if (kind === 'buy') this.life.cheer();
  }

  /** winner of the fight on screen once it ended (null = not over) */
  private endWinner: number | null = null;
  private bannerText() {
    const w = this.endWinner;
    return w === null ? '' : w === 0 ? L('ชนะ!', 'Victory!') : w === 1 ? L('แพ้', 'Defeat') : L('เสมอ', 'Draw');
  }

  private paintPlate() {
    const w = this.endWinner;
    this.banner.setScale(1);
    drawPlate(this.bannerPlate, this.banner, w === 0 ? 'win' : w === 1 ? 'lose' : 'draw', W);
    this.banner.setScale((this.banner.getData('fit') as number) ?? 1);
  }

  /** Re-label the fighters and the end banner (language change). */
  setNames(names: [string, string]) {
    names.forEach((n, i) => this.nameTexts[i]?.text && this.nameTexts[i].setText(n));
    if (this.banner?.text) {
      this.banner.setText(this.bannerText());
      this.paintPlate();
    }
    this.skillText?.setText(''); // the fading "skill used" line was drawn in the old language
  }

  play(data: PlayData, onEvent: (e: CombatEvent) => void, onDone: () => void) {
    this.idle(null);
    this.fighters.forEach((f) => f.setFlipX(f === this.fighters[1]));
    this.builds = [data.left.build, data.right.build];
    this.strip.setBuilds([data.left.build, data.right.build]);
    this.said = new Set();
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
    this.chainFlash = [[], []];
    this.stripState.glow = this.glow;
    this.stripState.chainFlash = this.chainFlash;
    this.frozenUntil = [0, 0];
    this.resetJuice();
    this.ffx.clear();
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
    this.fxl.clear();
    this.holdUntil = this.stopUntil = this.slowUntil = 0;
    this.ffx.settle();
    const end = this.evs.at(-1);
    if (end?.type === 'end') combatSfx(end, 0); // skipped to the end: still play the KO and the result jingle
  }

  update(_t: number, delta: number) {
    const t = this.time.now;
    // hit-stop: the picture almost stops; kill slow-mo: 0.3x
    const vr = t < this.stopUntil ? 0.04 : t < this.slowUntil ? 0.3 : 1;
    const vdt = Math.min(delta, 60) * vr;
    this.vnow += vdt;
    this.life.update(t, delta);
    this.fxl.update(vdt);
    this.updateShake(t);
    this.danger.update(t, delta, this.hp[0] / Math.max(1, this.maxHp[0]), this.playing);
    if (!this.playing) {
      this.heroIdle.update(t, delta);
      return;
    }
    // the replay clock waits while a shot is in flight or a hit-stop holds (events stay in step with the picture)
    const run = t >= this.holdUntil && t >= this.stopUntil;
    if (run) this.clock += (delta * vr * this.speed) / 100; // 100ms per tick at 1x
    while (this.ei < this.evs.length && this.evs[this.ei].t <= this.clock && this.time.now >= this.holdUntil && this.time.now >= this.stopUntil)
      this.handle(this.evs[this.ei++]);
    this.drawQueue();
    this.drawChips();
    this.drawLocks();
    const lastT = this.evs.at(-1)?.t ?? 0;
    this.clockText.setText((Math.min(this.clock, lastT) / 10).toFixed(1) + L(' วิ', 's'));
    const now = this.vnow;
    this.fighters.forEach((f, i) => {
      const key = this.keys[i];
      if (!key || this.dead[i]) return;
      const frozen = this.stripState.frozen[i];
      if (this.poseKind[i] && now > this.poseUntil[i] && !frozen) {
        this.poseKind[i] = null;
        f.setTexture(key + '_idle');
      }
      // soft mochi breathing (squash and stretch around the feet): stops while frozen, half speed when slowed
      this.bph[i] += (vdt * (frozen ? 0 : this.slowed[i] ? 0.5 : 1)) / 300;
      const b = Math.sin(this.bph[i] + i * 1.7);
      let sx = 1 + b * 0.012;
      let sy = 1 - b * 0.02;
      let x = POS[i];
      const dir = i === 0 ? 1 : -1;
      // anticipation: the caster squashes down (scaleY 0.9)
      const at = now - this.anticT0[i];
      if (at >= 0 && at < this.anticMs[i]) {
        const e = at / this.anticMs[i];
        sy *= 1 - 0.1 * e;
        sx *= 1 + 0.06 * e;
        x -= dir * 3 * e;
      }
      // fire: stretch up (scaleY 1.1) and lunge at the enemy
      const lt = now - this.lungeT0[i];
      if (lt >= 0 && lt < 280) {
        const u = lt / 280;
        sy *= 1 + 0.1 * (1 - u) * (1 - u);
        sx *= 1 - 0.05 * (1 - u) * (1 - u);
        x += dir * 24 * Math.sin(Math.PI * Math.min(1, lt / 200));
      }
      // knockback: squash 1.15 / 0.85 for 60ms, pushed away 6-12, springs back over 200ms
      const kt = now - this.knockT0[i];
      if (kt >= 0 && kt < 260) {
        if (kt < 60) {
          const e = kt / 60;
          sx *= 1 + 0.15 * e;
          sy *= 1 - 0.15 * e;
          x -= dir * this.knockAmp[i] * e;
        } else {
          const u = (kt - 60) / 200;
          const w = (1 - u) * Math.cos(u * Math.PI * 1.5);
          sx *= 1 + 0.15 * w;
          sy *= 1 - 0.15 * w;
          x -= dir * this.knockAmp[i] * (1 - u) * (1 - u);
        }
      }
      // frozen: a tiny shiver inside the ice
      if (frozen) x += Math.sin(now / 22) * 0.5;
      if (this.still) x = POS[i];
      f.setScale(HERO_S * sx, HERO_S * sy).setX(x);
    });
    for (let s = 0; s < 2; s++) {
      const st = this.fstate[s];
      const fx = this.fx[s];
      st.frozen = this.stripState.frozen[s];
      st.burning = !!fx && fx.b > 0;
      st.slowed = this.slowed[s];
      st.shield = this.sh[s] > 0;
      st.thorns = !!fx && fx.th > 0;
      st.dead = this.dead[s];
    }
    this.ffx.update(vdt, this.fighters, this.fstate, this.speed);
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
    const now = this.vnow;
    if (kind === 'hit' && this.poseKind[side] === 'cast' && now < this.poseUntil[side]) return; // casting wins
    this.poseKind[side] = kind;
    this.poseUntil[side] = now + this.dur(kind === 'cast' ? 380 : 300);
    this.fighters[side].setTexture(`${key}_${kind}`);
  }

  private dur(ms: number) {
    return ms / Math.max(1, this.speed * 0.6);
  }

  /** status words over a fighter ("Frozen!", "Power 3"): small pooled numbers in the status colour */
  private float(side: number, text: string, color: string) {
    if (this.quiet) return;
    // fast forward: at most one status word per fighter every 300ms so they don't pile up
    if (this.speed >= 4 && this.time.now - this.lastStatus[side] < 300) return;
    this.lastStatus[side] = this.time.now;
    this.ffx.number(side, text, 'status', 0.72, false, color);
  }

  /** hold scale at the current speed: holds and hit-stops shrink at 2x and mostly vanish at 4x */
  private hs() {
    return this.speed >= 4 ? 0.3 : this.speed >= 2 ? 0.6 : 1;
  }

  /** pause the replay clock for ms (a shot in flight); the picture keeps moving */
  private hold(ms: number) {
    if (this.quiet || ms <= 0) return;
    this.holdUntil = Math.max(this.holdUntil, this.time.now + ms);
  }

  /** hit-stop: replay clock and picture freeze for ms; slow = then slow-mo 0.3x for that long (kill blow) */
  private hitStop(ms: number, slow = 0) {
    if (this.quiet || ms <= 0) return;
    const t = this.time.now;
    this.stopUntil = Math.max(this.stopUntil, t + ms);
    if (slow > 0) this.slowUntil = Math.max(this.slowUntil, this.stopUntil + slow);
  }

  /** decaying camera shake, amplitude in world units (skipped with prefers-reduced-motion) */
  private shake(amp: number, ms: number) {
    if (this.quiet || this.still) return;
    const t = this.time.now;
    const left = this.shDur > 0 ? Math.max(0, 1 - (t - this.shT0) / this.shDur) * this.shAmp : 0;
    if (amp < left) return; // a bigger shake is still running
    this.shT0 = t;
    this.shDur = ms;
    this.shAmp = amp;
  }

  private updateShake(t: number) {
    const cam = this.cameras.main;
    if (this.shDur <= 0) return;
    const p = (t - this.shT0) / this.shDur;
    if (p >= 1 || this.still) {
      this.shDur = 0;
      cam.setScroll(0, 0);
      return;
    }
    const a = this.shAmp * (1 - p) * (1 - p);
    cam.setScroll((Math.random() * 2 - 1) * a, (Math.random() * 2 - 1) * a * 0.7);
  }

  private resetJuice() {
    this.holdUntil = this.stopUntil = this.slowUntil = 0;
    this.shDur = 0;
    this.cameras.main.setScroll(0, 0);
    this.anticT0 = [-1e9, -1e9];
    this.lungeT0 = [-1e9, -1e9];
    this.knockT0 = [-1e9, -1e9];
    this.castChain = [0, 0];
    this.chainTick = [-1, -1];
    this.chainN = [0, 0];
    this.castHits = [0, 0];
  }

  /** knock fighter i back by amp (world units) with a squash */
  private knock(i: number, amp: number) {
    this.knockT0[i] = this.vnow;
    this.knockAmp[i] = amp;
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
        this.castHits[e.side] = 0;
        this.castChain[e.side] = 0;
        if (!this.quiet) {
          this.pose(e.side, 'cast');
          const inst = this.builds[e.side]?.skills[e.idx];
          const label = `${e.side === 0 ? '▶ ' : ''}${inst ? nodeOf(inst).name : d.name} Lv${e.lv}${e.echo ? L(' (ซ้ำ)', ' (echo)') : ''}${e.side === 1 ? ' ◀' : ''}`;
          this.skillText.setText(label).setColor(SIDE_COLOR[e.side]).setAlpha(1).setScale(1);
          this.tweens.killTweensOf(this.skillText);
          this.tweens.add({ targets: this.skillText, alpha: 0, delay: this.dur(500), duration: this.dur(400) });
          const lead = e.from !== undefined ? this.chain(e.side, e.from, e.idx, e.t) : 0;
          if (e.from !== undefined && e.side === 0) this.say('combo');
          this.castFx(e, lead);
        }
        break;
      }
      case 'damage':
        if (!this.quiet) this.impact(e);
        break;
      case 'shield':
        if (!this.quiet) this.ffx.number(e.side, `+${e.amount} ${L('โล่', 'shield')}`, 'shield', 0.85);
        break;
      case 'heal':
        if (!this.quiet) {
          this.ffx.number(e.side, `+${e.amount}`, 'heal', 1.05);
          this.fxl.heal(this.fighters[e.side].x, CHEST);
          fightSfx('heal');
        }
        break;
      case 'status': {
        const map: Record<string, [string, string]> = {
          freeze: [e.value > 0 ? L('แช่แข็ง!', 'Frozen!') : L('ต้านได้', 'Resisted'), '#aee6ff'],
          slow: [L('ช้าลง', 'Slowed'), '#aee6ff'],
          burn: [L('ติดไฟ', 'Burning'), '#ff9933'],
          grow: [`${L('พลัง', 'Power')} ${e.value}`, '#ffd166'],
          charge: [`x${e.value}`, '#ffd166'],
          thorns: [L('หนาม', 'Thorns'), '#c9a0ff'],
          steadfast: [L('ใจเหล็ก', 'Iron Will'), '#ffffff'],
          rage: [L('คลั่ง!', 'Rage!'), '#ff4444'],
          dodge: [`${L('หลบ', 'Dodge')} ${e.value}`, '#b6f0c8'],
          evade: [L('หลบได้!', 'Dodged!'), '#b6f0c8'],
          poison: [L('ติดพิษ', 'Poisoned'), '#c49cff'],
          haste: [`${L('เร่ง', 'Haste')} +${e.value}%`, '#ffd166'],
          wound: [L('แผลลึก', 'Wounded'), '#ff7b5c'],
          cleanse: [e.value > 0 ? `${L('ชำระล้าง', 'Cleansed')} ${e.value}` : L('ไม่มีดีบัฟ', 'No debuffs'), '#aaffcc'],
          dispel: [e.value > 0 ? `${L('สลายบัฟ', 'Dispelled')} ${e.value}!` : L('ไม่มีบัฟให้ลบ', 'Nothing to dispel'), '#c9a0ff'],
          delay: [e.value > 0 ? `${L('ถอยเวลา', 'Delayed')} ${(e.value / 10).toFixed(1)}${L(' วิ', 's')}` : L('ต้านได้', 'Resisted'), '#b8a0ff'],
        };
        const [txt, col] = map[e.status] ?? [e.status, '#ffffff'];
        this.float(e.side, txt, col);
        if (e.status === 'thorns' && !this.quiet) this.ffx.thornFlash(e.side);
        if (e.status === 'freeze' && e.value > 0) {
          this.frozenUntil[e.side] = Math.max(this.frozenUntil[e.side], e.t + e.value);
          if (e.side === 1 && e.value >= 15) this.say('frozen');
        }
        if (e.status === 'cleanse' && e.value > 0) this.frozenUntil[e.side] = Math.min(this.frozenUntil[e.side], e.t);
        if (e.status === 'delay' && e.value > 0) this.delayUntil[e.side] = e.t + Math.max(8, Math.min(20, e.value));
        break;
      }
      case 'fatigue':
        if (!this.quiet) this.skillText.setText(`${L('เหนื่อยล้า', 'Fatigue')} -${e.amount}`).setColor('#cccccc').setAlpha(1);
        break;
      case 'ult': {
        // simple ultimate banner in the cast-label spot (gold, bigger, stays a little longer)
        const h = HEROES_BY_ID[e.hero];
        if (!this.quiet && h) {
          this.skillText.setText(`★ ${h.ult.name} Lv${e.lv} ★`).setColor('#ffd166').setAlpha(1).setScale(1.25);
          this.tweens.killTweensOf(this.skillText);
          this.tweens.add({ targets: this.skillText, alpha: 0, scale: 1, delay: this.dur(900), duration: this.dur(500) });
          this.pose(e.side, 'cast');
          this.float(e.side, L('ท่าไม้ตาย!', 'Ultimate!'), '#ffd166');
        }
        break;
      }
      case 'end': {
        const w = e.winner;
        this.endWinner = w;
        this.banner.setText(this.bannerText()).setColor(w === 0 ? '#3fbf6a' : w === 1 ? '#ff5a72' : '#8f86b8').setStroke('#3a2b48', 6);
        this.paintPlate();
        const fit = (this.banner.getData('fit') as number) ?? 1;
        this.banner.setScale(0.5 * fit);
        this.bannerPlate.setScale(0.5);
        if (w === 0 && !this.quiet) {
          this.life.cheer();
          confetti(this, POS[0], GROUND - HERO_H - 10);
          this.time.delayedCall(180, () => confetti(this, W / 2, 150, 30));
        }
        this.tweens.add({ targets: this.banner, scale: fit, duration: 250, ease: 'Back.Out' });
        this.tweens.add({ targets: this.bannerPlate, scale: 1, duration: 250, ease: 'Back.Out' });
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
    if (!this.quiet) combatSfx(e, 0, true);
    this.onEvent?.(e);
  }

  /**
   * A chain fired (cast set off by neighbour `from`): a star-thread runs along the skill strip from the source icon
   * to the chained one (120ms), a pastel ring bursts on it, and the "CHAIN ×N" popup over the fighter counts up.
   * Each step: +2 semitones on the chain note, +15% popup size, +20ms hit-stop on its hits (capped at ×5).
   * Returns the lead time (ms) before the chained skill itself goes off.
   */
  private chain(side: Side, from: number, idx: number, t: number) {
    const sk = this.builds[side]?.skills;
    const a = sk?.[from]?.id;
    const b = sk?.[idx]?.id;
    if (!a || !b || !SKILLS[a] || !SKILLS[b]) return 0;
    const n = this.chainTick[side] === t ? this.chainN[side] + 1 : 2;
    this.chainTick[side] = t;
    this.chainN[side] = n;
    this.castChain[side] = n;
    const k = Math.min(5, n);
    this.chainFlash[side] = [...this.chainFlash[side].filter((f) => f.until > t), { a: from, b: idx, until: t + 8 }];
    const beam = 120 * this.hs();
    this.strip.chain(side, from, idx, this.vnow, beam);
    chainPopup(side, a, b, POS[side] / W, (GROUND - HERO_H + 2) / H, this.dur(1300), n);
    fightSfx('chain', { pitch: 2 * (k - 2), vol: 0.8 + 0.1 * (k - 2) });
    return beam;
  }

  /**
   * A hit lands (damage event, target = e.side). Hit-stop scaled by damage (40 / 70 / 120ms, kill blow 180ms + 0.3x
   * slow-mo 400ms, +20ms per chain step), decaying shake (2 / 4 / 8), knockback 6-12 + squash, white → pink flash,
   * a big popping number and a squish / thump / bell. Burn ticks sizzle, thorns prick back in pink.
   */
  private impact(e: Extract<CombatEvent, { type: 'damage' }>) {
    const s = e.side;
    const total = e.amount + e.blocked;
    if (total <= 0) return;
    const att = 1 - s;
    const hs = this.hs();
    const kill = e.s.hp[s] <= 0 && e.amount > 0;
    const x = this.fighters[s].x;
    if (e.blocked > 0) {
      this.ffx.wobble(s, e.blocked / Math.max(1, this.maxHp[s] * 0.15));
      this.ffx.number(s, `(${e.blocked})`, 'blocked', 0.8);
    }
    if (e.src === 'burn') {
      if (e.amount > 0) this.ffx.number(s, `-${e.amount}`, 'burn', 0.95);
      if (this.fxl.allow(s, 200)) this.fxl.tick('burn', x, CHEST, this.fxLife());
      fightSfx('sizzle', { vol: 0.8 });
      if (kill) this.killBlow(s);
      return;
    }
    if (e.src === 'fatigue') {
      if (e.amount > 0) this.ffx.number(s, `-${e.amount}`, 'fatigue', 0.9);
      this.ffx.flash(s);
      fightSfx('squish', { pitch: -5, vol: 0.5 });
      if (kill) this.killBlow(s);
      return;
    }
    if (e.src === 'thorns') {
      // the thorns owner (the one who was hit) pricks the attacker back
      this.ffx.thornFlash(att);
      if (e.amount > 0) this.ffx.number(s, `-${e.amount}`, 'thorns', 0.95);
      this.ffx.flash(s);
      this.knock(s, 5);
      this.hitStop(40 * hs);
      this.shake(2, 150);
      fightSfx('squish', { pitch: 5, vol: 0.8 });
      if (this.fxl.allow(s, 120)) this.fxl.tick('thorns', x, CHEST, this.fxLife());
      if (kill) this.killBlow(s);
      return;
    }
    const frac = total / Math.max(1, this.maxHp[s]);
    const tier = kill ? 3 : frac >= 0.25 ? 2 : frac >= 0.1 ? 1 : 0;
    const first = this.castHits[att]++ === 0;
    const chainK = this.castChain[att] ? Math.min(5, this.castChain[att]) - 1 : 0;
    const stop = (first ? [40, 70, 120, 180][tier] : Math.min(50, [40, 70, 120, 180][tier])) + 20 * chainK;
    if (kill) this.killBlow(s, stop);
    else this.hitStop(stop * hs);
    this.shake([2, 4, 8, 8][tier], [150, 250, 400, 450][tier]);
    if (e.amount > 0) {
      this.ffx.flash(s);
      this.knock(s, 6 + 6 * Math.min(1, frac / 0.3));
      this.pose(s, 'hit');
      this.ffx.number(s, `-${e.amount}`, 'dmg', [1, 1.17, 1.42, 1.67][tier], tier >= 2);
      this.fxl.hitFlash(x + (s === 0 ? 10 : -10), CHEST - 4, [0.7, 0.9, 1.2, 1.4][tier]);
    }
    if (tier >= 2) {
      fightSfx('thump', { pitch: chainK * 2 });
      fightSfx('bell', { pitch: chainK * 2 });
    } else fightSfx('squish', { pitch: (s === 0 ? -2 : 0) + chainK * 2 + tier * -2, vol: 0.8 + tier * 0.2 });
    if (e.amount >= 18 && s === 1) this.say('critical');
  }

  /** kill blow: long hit-stop then 0.3x slow-mo, big shake (the KO itself plays on the end event) */
  private killBlow(s: number, stop = 180) {
    const hs = Math.max(0.5, this.hs());
    this.hitStop(Math.max(180, stop) * hs, 400 * hs);
    this.shake(8, 450);
    this.ffx.flash(s);
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
        label = L('ไม่ได้ใช้ skill เลย', 'No skill fired');
        bg = '#4a1f3acc';
      } else if (frozen && !this.dead[s]) {
        // the ice cube on the fighter and the "Frozen 1.1" chip under the HP bar already say it
      } else if (this.clock < this.delayUntil[s] && !this.dead[s]) {
        label = L('⏪ คูลดาวน์ถอยหลัง', '⏪ Cooldowns pushed back');
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
      this.hpTexts[s].setText(`${Math.max(0, this.hp[s])}/${this.maxHp[s]}${this.sh[s] ? `  ${L('โล่', 'shield')} ${this.sh[s]}` : ''}`);
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
        if (f.g > 0) list.push([`${L('พลัง', 'Power')} +${f.g}`, '#ffd166']);
        if (f.c > 1) list.push([`${L('รวมพลัง', 'Charge')} x${+f.c.toFixed(2)}`, '#ffd166']);
        if (f.th > 0) list.push([`${L('หนาม', 'Thorns')} ${f.th}`, '#ffd166']);
        if (f.sf) list.push([L('ใจเหล็ก', 'Iron Will'), '#ffd166']);
        if (f.b > 0) list.push([`${L('ไฟ', 'Burn')} ${f.b}${L('/วิ', '/s')}`, '#ff7b5c']);
        if (fr > 0) list.push([`${L('แช่แข็ง', 'Frozen')} ${(fr / 10).toFixed(1)}`, '#8fd8ff']);
        if (f.sl > 0 && slt > 0) list.push([`${L('ช้า', 'Slow')} ${f.sl}%`, '#8fd8ff']);
        if (f.dg > 0) list.push([`💨${L('หลบ', 'Dodge')} ${f.dg}`, '#ffd166']);
        if (f.hs > 0 && f.hst - since > 0) list.push([`⏩${L('เร่ง', 'Haste')} ${f.hs}%`, '#ffd166']);
        if (f.p > 0) list.push([`☠${L('พิษ', 'Poison')} ${f.p}${L('/วิ', '/s')}`, '#c49cff']);
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

  /** Skill icons on the floor under each fighter (skillStrip.ts): cooldown wipe, fire pop, frozen / slowed tint. */
  private drawQueue() {
    const st = this.stripState;
    const tick = Math.max(0, Math.min(this.lastTick, Math.floor(this.clock)));
    st.clock = this.clock;
    st.now = this.vnow;
    for (let s = 0; s < 2; s++) {
      st.frozen[s] = this.trace ? this.trace.fr[s][tick] === 1 : this.clock < this.frozenUntil[s];
      const f = this.fx[s];
      this.slowed[s] = !!f && f.sl > 0 && f.slt - Math.max(0, this.clock - this.fxT[s]) > 0;
    }
    this.strip.draw(st);
  }

  /** life multiplier for effects at the current fight speed (4x plays them faster) */
  private fxLife() {
    return 1 / Math.max(1, this.speed * 0.5);
  }

  /**
   * A skill fired: its icon bursts above the caster, then the skill's effects (fx.ts table) play on the caster and
   * on the target, bigger for bigger hits. Fast forward thins the particles out.
   */
  private castFx(e: Extract<CombatEvent, { type: 'cast' }>, lead = 0) {
    const inst = this.builds[e.side]?.skills[e.idx];
    if (!inst || !SKILLS[inst.id]) return;
    const foe = (1 - e.side) as Side;
    const lm = this.fxLife();
    const line = SKILLS[inst.id].line;
    const color = LINE_HEX[line] ?? 0xffffff;
    const dir = e.side === 0 ? 1 : -1;
    const hs = this.hs();
    // at the caster's hand, on the side facing the enemy (clear of the skill name and the damage numbers)
    this.fxl.burstIcon(e.side, inst.id, POS[e.side] + dir * 66, GROUND - Math.round(HERO_H * 0.62), color, this.dur(950), 40);
    // damage this cast deals and whether it reaches the enemy at all (the events right after it, same tick)
    let dmg = 0;
    let reach = false;
    for (let j = this.ei; j < this.evs.length; j++) {
      const n = this.evs[j];
      if (n.t !== e.t || n.type === 'cast' || n.type === 'end') break;
      if (n.type === 'damage' && n.side === foe) {
        reach = true;
        if (n.src === inst.id) dmg += n.amount + n.blocked;
      } else if (n.type === 'status' && n.side === foe) reach = true;
    }
    // three beats: anticipation (icon lifts, caster squashes), fire (icon dips, caster stretches + lunges, the shot
    // flies 150-250ms), impact (the damage events, held back until the shot lands)
    const antic = 80 * hs;
    const travel = reach ? (150 + 100 * Math.min(1, dmg / Math.max(1, this.maxHp[foe] * 0.3))) * hs : 0;
    const t0 = this.vnow + lead;
    this.strip.fire(e.side, e.idx, t0);
    this.anticT0[e.side] = t0;
    this.anticMs[e.side] = antic;
    this.lungeT0[e.side] = t0 + antic;
    fightSfx('whoosh', { vol: 0.7 });
    this.hold(lead + antic + (reach ? travel : 50 * hs));
    const k = dmg > 0 ? Math.max(0.75, Math.min(1.7, 0.7 + dmg / 14)) : 1;
    const ok = this.fxl.allow(e.side, this.speed >= 4 ? 150 : this.speed >= 2 ? 70 : 0);
    if (reach && (ok || this.speed < 4)) {
      const hx = POS[e.side] + dir * 30;
      this.fxl.projectile(hx, CHEST - 10, POS[foe] - dir * 16, CHEST, travel, color, Math.min(1.4, 0.85 + dmg / 30), lead + antic);
    }
    if (!ok) return;
    const cm = this.speed >= 4 ? 0.55 : 1;
    const plan = fxPlan(inst);
    this.fxl.baseDelay = lead + antic;
    for (const kind of plan.c) this.fxl.play(kind, POS[e.side], CHEST, dir, 1, lm, cm);
    if (this.strip.isHasted(e.side, e.idx)) this.fxl.haste(POS[e.side], CHEST, dir);
    this.fxl.baseDelay = lead + antic + travel;
    for (const kind of plan.t) this.fxl.play(kind, POS[foe], CHEST, dir, k, lm, cm);
    this.fxl.baseDelay = 0;
  }

  /** One announcer line per kind per fight, never while skipping. */
  private say(key: 'combo' | 'critical' | 'frozen') {
    if (this.quiet || this.said.has(key)) return;
    this.said.add(key);
    voice(key);
  }
}
