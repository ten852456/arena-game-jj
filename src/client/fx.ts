import Phaser from 'phaser';
import { SKILLS, nodeOf } from '../sim/skills';
import type { SkillInstance } from '../sim/types';

/**
 * Skill effects in the fight arena, cute moon style.
 * - SKILL_FX: one table, skill id → what plays on the caster and on the target (by archetype + keywords).
 *   fxPlan() adds effects for the keywords of the skill's actual level (a Lv2 branch that burns also flames).
 * - FxLayer: a fixed pool of images moved by hand in update() (no tweens, no allocation per frame), plus one big
 *   skill icon per fighter that pops above the caster. Textures are drawn once with the Canvas 2D API.
 * prefers-reduced-motion: no particles, the big icon just fades in place.
 */

export type FxKind =
  | 'slash' | 'multi' | 'impact' | 'flame' | 'ice' | 'snow' | 'bubble' | 'heart' | 'power' | 'spike' | 'gear' | 'speed'
  | 'moon' | 'dispel' | 'time';

export interface SkillFx {
  /** plays on the fighter who used the skill */
  c?: FxKind[];
  /** plays on the other fighter */
  t?: FxKind[];
}

/** All 26 skills. burst = slashes and stars, burn = flames, control = ice / snow / time, tank = bubble / spikes,
 *  scaling = golden arrows / hearts, engines = gears and speed lines, none = moon sparkles. */
export const SKILL_FX: Record<string, SkillFx> = {
  strike: { t: ['slash'] },
  jab: { t: ['slash'] },
  heavy: { t: ['impact', 'slash'] },
  charge: { c: ['power', 'speed'] },
  shield: { c: ['bubble'], t: ['slash'] },
  thorns: { c: ['spike'], t: ['slash'] },
  stoneskin: { c: ['bubble', 'heart'], t: ['slash'] },
  cleanse: { c: ['moon', 'bubble'], t: ['slash'] },
  train: { c: ['power'], t: ['slash'] },
  ignite: { t: ['flame'] },
  feast: { c: ['heart', 'power'], t: ['slash'] },
  amplify: { c: ['power', 'moon'] },
  frost: { t: ['ice'] },
  chill: { t: ['snow', 'slash'] },
  dispel: { t: ['dispel', 'slash'] },
  ironwill: { c: ['bubble', 'moon'] },
  gear: { c: ['gear'] },
  overclock: { c: ['gear', 'speed'] },
  bulwark: { c: ['bubble'], t: ['impact'] },
  spikewall: { c: ['spike'], t: ['impact'] },
  execute: { t: ['impact', 'slash'] },
  flurry: { t: ['multi'] },
  rampage: { c: ['power'], t: ['multi'] },
  inferno: { t: ['flame', 'impact'] },
  shatter: { t: ['ice', 'impact'] },
  timewarp: { t: ['time', 'slash'] },
};

const ARCH_FX: Record<string, SkillFx> = {
  burst: { t: ['slash'] }, tank: { c: ['bubble'] }, scaling: { c: ['power'] }, control: { t: ['ice'] }, none: { c: ['moon'] },
};

const planCache = new Map<string, Required<SkillFx>>();
/** Effects for one equipped skill (cached per id + level variant): the table, plus its level's keywords. */
export function fxPlan(k: Pick<SkillInstance, 'id' | 'v'>): Required<SkillFx> {
  const key = `${k.id}:${k.v}`;
  const hit = planCache.get(key);
  if (hit) return hit;
  const base = SKILL_FX[k.id] ?? ARCH_FX[SKILLS[k.id]?.arch ?? 'none'] ?? {};
  const c = [...(base.c ?? [])];
  const t = [...(base.t ?? [])];
  const add = (list: FxKind[], x: FxKind) => list.length < 3 && !list.includes(x) && list.push(x);
  if (SKILLS[k.id]) {
    for (const e of nodeOf(k).fx) {
      if (e.k === 'burn' || (e.k === 'hit' && (e.burn || e.burnPct))) add(t, 'flame');
      else if (e.k === 'freeze') add(t, 'ice');
      else if (e.k === 'slow') add(t, 'snow');
      else if (e.k === 'delay') add(t, 'time');
      else if (e.k === 'heal' || e.k === 'leech') add(c, 'heart');
      else if (e.k === 'shield') add(c, 'bubble');
      else if (e.k === 'grow' || e.k === 'charge' || e.k === 'amplify') add(c, 'power');
      else if (e.k === 'thorns') add(c, 'spike');
      else if (e.k === 'dispel') add(t, 'dispel');
    }
  }
  const plan = { c, t };
  planCache.set(key, plan);
  return plan;
}

// ------------------------------------------------------------------ textures

const TR = 4; // texture pixels per world unit (the camera zooms ×2; ×4 keeps them crisp when scaled up)
/** every particle is drawn this much bigger than its texture's world size */
const PS = 1.35;
type Ctx = CanvasRenderingContext2D;

function art(scene: Phaser.Scene, key: string, w: number, h: number, draw: (c: Ctx) => void) {
  if (scene.textures.exists(key)) return;
  const tex = scene.textures.createCanvas(key, Math.ceil(w * TR), Math.ceil(h * TR));
  if (!tex) return;
  const c = tex.getContext();
  c.scale(TR, TR);
  c.lineJoin = 'round';
  c.lineCap = 'round';
  draw(c);
  tex.refresh();
}

function starPath(c: Ctx, cx: number, cy: number, n: number, ro: number, ri: number) {
  c.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 ? ri : ro;
    const a = -Math.PI / 2 + (i * Math.PI) / n;
    c.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  c.closePath();
}

function makeFxArt(scene: Phaser.Scene) {
  art(scene, 'fx_star', 14, 14, (c) => {
    starPath(c, 7, 7.4, 5, 6.2, 2.9);
    const g = c.createRadialGradient(6, 6, 0.5, 7, 7, 7);
    g.addColorStop(0, '#fffbe6');
    g.addColorStop(1, '#ffd56b');
    c.fillStyle = g;
    c.fill();
    c.lineWidth = 1;
    c.strokeStyle = '#c98a2c';
    c.stroke();
  });
  art(scene, 'fx_spark', 14, 14, (c) => {
    const g = c.createRadialGradient(7, 7, 0, 7, 7, 7);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 14, 14);
    starPath(c, 7, 7, 4, 6.8, 1.4);
    c.fillStyle = '#ffffff';
    c.fill();
  });
  art(scene, 'fx_glow', 32, 32, (c) => {
    const g = c.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 32, 32);
  });
  art(scene, 'fx_ring', 32, 32, (c) => {
    c.beginPath();
    c.arc(16, 16, 13, 0, Math.PI * 2);
    c.lineWidth = 3;
    c.strokeStyle = '#ffffff';
    c.stroke();
    c.beginPath();
    c.arc(16, 16, 13, 0, Math.PI * 2);
    c.lineWidth = 6;
    c.strokeStyle = 'rgba(255,255,255,0.3)';
    c.stroke();
  });
  // crescent slash: thick in the middle, thin tips, opens to the right
  art(scene, 'fx_slash', 40, 40, (c) => {
    const moon = (ox: number, ro: number, ix: number, ri: number, a: number, mid: string) => {
      c.beginPath();
      c.arc(ox, 20, ro, -a, a, false);
      c.arc(ix, 20, ri, a - 0.1, -(a - 0.1), true);
      c.closePath();
      const g = c.createLinearGradient(14, 1, 14, 39);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.5, mid);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g;
      c.fill();
    };
    moon(13, 18.5, 5, 16, 1.2, 'rgba(255,120,170,0.95)'); // pink glow edge
    moon(13, 17, 8, 15, 1.12, 'rgba(255,255,255,1)'); // white core
  });
  art(scene, 'fx_flame', 12, 16, (c) => {
    c.beginPath();
    c.moveTo(6, 0.6);
    c.bezierCurveTo(9.5, 5, 11.4, 8, 11.4, 10.4);
    c.arc(6, 10.4, 5.4, 0, Math.PI, false);
    c.bezierCurveTo(0.6, 8, 2.5, 5, 6, 0.6);
    const g = c.createRadialGradient(6, 11.5, 0.5, 6, 9, 8);
    g.addColorStop(0, '#fff7c2');
    g.addColorStop(0.35, '#ffc94a');
    g.addColorStop(0.75, '#ff7b3a');
    g.addColorStop(1, '#f2506a');
    c.fillStyle = g;
    c.fill();
  });
  art(scene, 'fx_flake', 14, 14, (c) => {
    c.translate(7, 7);
    for (let i = 0; i < 6; i++) {
      c.rotate(Math.PI / 3);
      c.beginPath();
      c.moveTo(0, 0);
      c.lineTo(0, -6);
      c.moveTo(0, -3.6);
      c.lineTo(-1.8, -5);
      c.moveTo(0, -3.6);
      c.lineTo(1.8, -5);
      c.lineWidth = 2.6;
      c.strokeStyle = '#6fb6ea';
      c.stroke();
      c.lineWidth = 1.3;
      c.strokeStyle = '#ffffff';
      c.stroke();
    }
  });
  art(scene, 'fx_ice', 8, 16, (c) => {
    c.beginPath();
    c.moveTo(4, 0.5);
    c.lineTo(7.4, 6);
    c.lineTo(4, 15.5);
    c.lineTo(0.6, 6);
    c.closePath();
    const g = c.createLinearGradient(0, 0, 8, 16);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.5, '#bff3ff');
    g.addColorStop(1, '#6cc8f0');
    c.fillStyle = g;
    c.fill();
    c.lineWidth = 0.8;
    c.strokeStyle = '#3f8fc4';
    c.stroke();
  });
  art(scene, 'fx_heart', 14, 13, (c) => {
    c.beginPath();
    c.moveTo(7, 12);
    c.bezierCurveTo(1, 8, 0.6, 4.2, 2.2, 2.4);
    c.bezierCurveTo(4, 0.6, 6.2, 1.4, 7, 3.4);
    c.bezierCurveTo(7.8, 1.4, 10, 0.6, 11.8, 2.4);
    c.bezierCurveTo(13.4, 4.2, 13, 8, 7, 12);
    c.fillStyle = '#86e39a';
    c.fill();
    c.lineWidth = 1;
    c.strokeStyle = '#2f8a55';
    c.stroke();
    c.beginPath();
    c.ellipse(4.3, 4.3, 1.4, 0.9, -0.6, 0, Math.PI * 2);
    c.fillStyle = '#ffffff';
    c.fill();
  });
  art(scene, 'fx_arrow', 12, 16, (c) => {
    c.beginPath();
    c.moveTo(6, 0.8);
    c.lineTo(11.2, 7);
    c.lineTo(8, 7);
    c.lineTo(8, 15.2);
    c.lineTo(4, 15.2);
    c.lineTo(4, 7);
    c.lineTo(0.8, 7);
    c.closePath();
    const g = c.createLinearGradient(0, 0, 0, 16);
    g.addColorStop(0, '#fff4c2');
    g.addColorStop(1, '#ffb93a');
    c.fillStyle = g;
    c.fill();
    c.lineWidth = 1;
    c.strokeStyle = '#b8751e';
    c.stroke();
  });
  art(scene, 'fx_spike', 7, 16, (c) => {
    c.beginPath();
    c.moveTo(3.5, 0.6);
    c.lineTo(6.4, 15.4);
    c.lineTo(0.6, 15.4);
    c.closePath();
    const g = c.createLinearGradient(0, 0, 0, 16);
    g.addColorStop(0, '#f4e8ff');
    g.addColorStop(1, '#a07ce6');
    c.fillStyle = g;
    c.fill();
    c.lineWidth = 0.9;
    c.strokeStyle = '#5b3f9a';
    c.stroke();
  });
  art(scene, 'fx_gear', 20, 20, (c) => {
    c.translate(10, 10);
    c.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      c.lineTo(Math.cos(a - 0.2) * 9.4, Math.sin(a - 0.2) * 9.4);
      c.lineTo(Math.cos(a + 0.2) * 9.4, Math.sin(a + 0.2) * 9.4);
      c.lineTo(Math.cos(a + 0.42) * 7, Math.sin(a + 0.42) * 7);
      c.lineTo(Math.cos(a + Math.PI / 4 - 0.42) * 7, Math.sin(a + Math.PI / 4 - 0.42) * 7);
    }
    c.closePath();
    c.arc(0, 0, 3, 0, Math.PI * 2, true);
    const g = c.createRadialGradient(-2, -2, 1, 0, 0, 10);
    g.addColorStop(0, '#fff6d8');
    g.addColorStop(1, '#d8b25a');
    c.fillStyle = g;
    c.fill('evenodd');
    c.lineWidth = 1;
    c.strokeStyle = '#7d5a22';
    c.stroke();
  });
  art(scene, 'fx_line', 26, 4, (c) => {
    const g = c.createLinearGradient(0, 0, 26, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(1, 'rgba(255,255,255,1)');
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(0, 2);
    c.lineTo(24, 0.6);
    c.arc(24, 2, 1.4, -Math.PI / 2, Math.PI / 2);
    c.closePath();
    c.fill();
  });
  art(scene, 'fx_bubble', 48, 48, (c) => {
    const g = c.createRadialGradient(24, 24, 12, 24, 24, 23);
    g.addColorStop(0, 'rgba(170,220,255,0.08)');
    g.addColorStop(0.8, 'rgba(150,205,255,0.28)');
    g.addColorStop(1, 'rgba(120,190,255,0.55)');
    c.beginPath();
    c.arc(24, 24, 22.5, 0, Math.PI * 2);
    c.fillStyle = g;
    c.fill();
    c.lineWidth = 1.4;
    c.strokeStyle = 'rgba(214,240,255,0.95)';
    c.stroke();
    c.beginPath();
    c.arc(24, 24, 17, -2.6, -1.7);
    c.lineWidth = 2.6;
    c.strokeStyle = 'rgba(255,255,255,0.9)';
    c.stroke();
    c.beginPath();
    c.arc(13.5, 16, 1.6, 0, Math.PI * 2);
    c.fillStyle = '#ffffff';
    c.fill();
  });
  art(scene, 'fx_moon', 14, 14, (c) => {
    c.beginPath();
    c.arc(7, 7, 6, 0, Math.PI * 2);
    c.arc(9.6, 5.4, 5, 0, Math.PI * 2, true);
    const g = c.createLinearGradient(0, 0, 14, 14);
    g.addColorStop(0, '#fffbe0');
    g.addColorStop(1, '#ffd56b');
    c.fillStyle = g;
    c.fill('evenodd');
  });
}

// ------------------------------------------------------------------ particle pool

const MAX = 140;
// per-particle fields
const X = 0, Y = 1, VX = 2, VY = 3, G = 4, VR = 5, S0 = 6, S1 = 7, A = 8, T0 = 9, LIFE = 10, SWAY = 11, PH = 12, FADEIN = 13;
const NF = 14;
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const TAU = Math.PI * 2;

export const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export class FxLayer {
  private imgs: Phaser.GameObjects.Image[] = [];
  private f = new Float32Array(MAX * NF);
  private live = new Uint8Array(MAX);
  private next = 0;
  /** big skill icon + halo above each fighter: start time, duration, x, y */
  private icons: Phaser.GameObjects.Image[] = [];
  private halos: Phaser.GameObjects.Image[] = [];
  private iv = new Float32Array(2 * 4).fill(-1);
  private lastBurst = [0, 0];
  readonly still = reducedMotion();

  constructor(private scene: Phaser.Scene, depth = 14) {
    makeFxArt(scene);
    for (let i = 0; i < MAX; i++) this.imgs.push(scene.add.image(0, 0, 'fx_star').setVisible(false).setDepth(depth));
    for (let s = 0; s < 2; s++) {
      this.halos.push(scene.add.image(0, 0, 'fx_glow').setVisible(false).setDepth(depth + 1));
      this.icons.push(scene.add.image(0, 0, 'fx_star').setVisible(false).setDepth(depth + 2));
    }
  }

  clear() {
    this.live.fill(0);
    this.imgs.forEach((m) => m.setVisible(false));
    this.icons.forEach((m) => m.setVisible(false));
    this.halos.forEach((m) => m.setVisible(false));
    this.iv.fill(-1);
  }

  /** One particle. Speeds in world units per ms, g = gravity (units/ms²), vr = spin (rad/ms). */
  private p(key: string, x: number, y: number, vx: number, vy: number, life: number, s0: number, s1: number,
    o: { g?: number; rot?: number; vr?: number; a?: number; delay?: number; sway?: number; tint?: number; add?: boolean } = NO) {
    const i = this.next;
    this.next = (this.next + 1) % MAX;
    const m = this.imgs[i];
    const b = i * NF;
    const f = this.f;
    f[b + X] = x; f[b + Y] = y; f[b + VX] = vx; f[b + VY] = vy; f[b + G] = o.g ?? 0; f[b + VR] = o.vr ?? 0;
    f[b + S0] = (s0 * PS) / TR; f[b + S1] = (s1 * PS) / TR; f[b + A] = o.a ?? 1; f[b + T0] = this.scene.time.now + (o.delay ?? 0);
    f[b + LIFE] = life; f[b + SWAY] = o.sway ?? 0; f[b + PH] = Math.random() * TAU; f[b + FADEIN] = key === 'fx_slash' || key === 'fx_ring' ? 0 : 0.12;
    this.live[i] = 1;
    m.setTexture(key).setPosition(x, y).setRotation(o.rot ?? 0).setScale((s0 * PS) / TR).setAlpha(0).setVisible(false);
    if (o.tint !== undefined) m.setTint(o.tint);
    else m.clearTint();
    m.setBlendMode(o.add ? Phaser.BlendModes.ADD : Phaser.BlendModes.NORMAL);
  }

  update(now: number, delta: number) {
    const f = this.f;
    const dt = Math.min(delta, 50);
    for (let i = 0; i < MAX; i++) {
      if (!this.live[i]) continue;
      const b = i * NF;
      const m = this.imgs[i];
      const age = now - f[b + T0];
      if (age < 0) continue;
      const t = age / f[b + LIFE];
      if (t >= 1) {
        this.live[i] = 0;
        m.setVisible(false);
        continue;
      }
      f[b + VY] += f[b + G] * dt;
      f[b + X] += f[b + VX] * dt;
      f[b + Y] += f[b + VY] * dt;
      const e = 1 - (1 - t) * (1 - t); // ease out
      const fi = f[b + FADEIN];
      const a = fi > 0 && t < fi ? t / fi : t < 0.55 ? 1 : 1 - (t - 0.55) / 0.45;
      m.setVisible(true)
        .setPosition(f[b + X] + (f[b + SWAY] ? Math.sin(age * 0.008 + f[b + PH]) * f[b + SWAY] : 0), f[b + Y])
        .setScale(f[b + S0] + (f[b + S1] - f[b + S0]) * e)
        .setAlpha(f[b + A] * a);
      if (f[b + VR]) m.rotation += f[b + VR] * dt;
    }
    // big icons: pop in (overshoot), hold, float up and fade
    for (let s = 0; s < 2; s++) {
      const t0 = this.iv[s * 4];
      if (t0 < 0) continue;
      const t = (now - t0) / this.iv[s * 4 + 1];
      const ic = this.icons[s];
      const ha = this.halos[s];
      if (t >= 1) {
        this.iv[s * 4] = -1;
        ic.setVisible(false);
        ha.setVisible(false);
        continue;
      }
      const base = ic.getData('s') as number;
      let sc = 1;
      let dy = 0;
      let a = 1;
      if (this.still) a = t < 0.15 ? t / 0.15 : t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1;
      else {
        sc = t < 0.12 ? 0.35 + (t / 0.12) * 0.85 : t < 0.22 ? 1.2 - ((t - 0.12) / 0.1) * 0.2 : 1;
        dy = t > 0.6 ? -((t - 0.6) / 0.4) * 14 : 0;
        a = t > 0.6 ? 1 - (t - 0.6) / 0.4 : 1;
      }
      const y = this.iv[s * 4 + 3] + dy;
      ic.setVisible(true).setY(y).setScale(base * sc).setAlpha(a);
      ha.setVisible(true).setY(y).setScale((base * sc * ic.frame.width * 1.7) / (32 * TR)).setAlpha(a * 0.75).setRotation(ha.rotation + 0.002 * dt);
    }
  }

  /** The skill's icon pops above the caster's head with a soft glow in its archetype colour. */
  burstIcon(side: number, id: string, x: number, y: number, color: number, life: number, size = 40) {
    const key = `sk_${id}`;
    const ic = this.icons[side];
    if (!this.scene.textures.exists(key)) return;
    ic.setTexture(key).setPosition(x, y).setData('s', size / (ic.frame.width || 128));
    this.halos[side].setPosition(x, y).setTint(color).setBlendMode(Phaser.BlendModes.SCREEN);
    this.iv[side * 4] = this.scene.time.now;
    this.iv[side * 4 + 1] = life;
    this.iv[side * 4 + 2] = x;
    this.iv[side * 4 + 3] = y;
  }

  /**
   * One effect. x, y = the fighter's chest; dir = +1 if the effect should lean right (caster on the left).
   * k = intensity (0.7 small hit … 1.7 huge hit). lm = life multiplier (fast forward), cm = count multiplier.
   */
  play(kind: FxKind, x: number, y: number, dir: number, k: number, lm: number, cm: number) {
    if (this.still) return;
    const n = (base: number) => Math.max(1, Math.round(base * k * cm));
    const L = (ms: number) => ms * lm;
    switch (kind) {
      case 'slash': {
        this.p('fx_slash', x - dir * 6, y - 4, dir * 0.02, 0, L(260), 0.7 * k, 1.35 * k, { rot: dir > 0 ? Math.PI - 0.5 : -0.5 });
        this.stars(x, y, n(4), k, L);
        break;
      }
      case 'multi': {
        for (let j = 0; j < 3; j++)
          this.p('fx_slash', x + rnd(-8, 8), y + (j - 1) * 14, dir * 0.02, 0, L(220), 0.6 * k, 1.1 * k, {
            rot: (dir > 0 ? Math.PI : 0) + (j - 1) * 0.5, delay: L(j * 90),
          });
        this.stars(x, y, n(5), k, L);
        break;
      }
      case 'impact': {
        this.p('fx_ring', x, y, 0, 0, L(340), 0.4, 2.2 * k, { tint: 0xfff0b8, a: 0.95 });
        this.p('fx_glow', x, y, 0, 0, L(220), 1.2 * k, 2.2 * k, { tint: 0xffffff, a: 0.8 });
        this.stars(x, y, n(7), k * 1.15, L);
        break;
      }
      case 'flame': {
        const m = n(7);
        for (let j = 0; j < m; j++)
          this.p('fx_flame', x + rnd(-22, 22), y + rnd(0, 34), rnd(-0.005, 0.005), rnd(-0.07, -0.04), L(rnd(520, 760)), rnd(1.1, 1.6) * k, 0.3, {
            delay: L(rnd(0, 220)), sway: 2.5,
          });
        this.p('fx_glow', x, y + 14, 0, 0, L(500), 1.6, 2.4 * k, { tint: 0xff9a4a, a: 0.55 });
        break;
      }
      case 'ice': {
        const m = n(6);
        for (let j = 0; j < m; j++) {
          const a = (j / m) * TAU + rnd(-0.2, 0.2);
          const v = rnd(0.07, 0.12);
          this.p('fx_ice', x + Math.cos(a) * 8, y + Math.sin(a) * 8, Math.cos(a) * v, Math.sin(a) * v, L(420), 1.4 * k, 0.8, { rot: a + Math.PI / 2 });
        }
        this.p('fx_ring', x, y, 0, 0, L(360), 0.5, 2 * k, { tint: 0x9fe6ff });
        this.flakes(x, y, n(3), L);
        break;
      }
      case 'snow': {
        this.flakes(x, y, n(7), L);
        this.p('fx_glow', x, y, 0, 0, L(600), 1.8, 2.6, { tint: 0xa8dcff, a: 0.5 });
        break;
      }
      case 'bubble': {
        this.p('fx_bubble', x, y + 6, 0, 0, L(820), 1.3, 1.6, { a: 0.95 });
        for (let j = 0; j < 4; j++) {
          const a = rnd(0, TAU);
          this.p('fx_spark', x + Math.cos(a) * 40, y + 6 + Math.sin(a) * 40, 0, 0, L(420), 0.4, 1.1, { delay: L(rnd(80, 420)), tint: 0xd8f0ff });
        }
        break;
      }
      case 'heart': {
        const m = n(4);
        for (let j = 0; j < m; j++)
          this.p('fx_heart', x + rnd(-24, 24), y + rnd(-6, 18), 0, rnd(-0.055, -0.035), L(rnd(800, 1000)), 0.7, 1.3, {
            delay: L(rnd(0, 320)), sway: 4,
          });
        break;
      }
      case 'power': {
        const m = n(4);
        for (let j = 0; j < m; j++)
          this.p('fx_arrow', x + rnd(-26, 26), y + rnd(10, 40), 0, rnd(-0.09, -0.06), L(rnd(560, 700)), 1.1, 0.8, { delay: L(rnd(0, 260)) });
        this.p('fx_glow', x, y + 10, 0, 0, L(520), 1.8, 2.8, { tint: 0xffd56b, a: 0.55 });
        break;
      }
      case 'spike': {
        const m = 8;
        for (let j = 0; j < m; j++) {
          const a = (j / m) * TAU;
          this.p('fx_spike', x + Math.cos(a) * 30, y + 8 + Math.sin(a) * 36, Math.cos(a) * 0.04, Math.sin(a) * 0.04, L(380), 0.3, 1.25 * Math.min(k, 1.3), {
            rot: a + Math.PI / 2, delay: L(j * 18),
          });
        }
        break;
      }
      case 'gear': {
        this.p('fx_gear', x - dir * 28, y - 34, 0, -0.01, L(760), 0.6, 1.25, { vr: 0.012 * dir });
        this.p('fx_gear', x - dir * 10, y - 46, 0, -0.01, L(760), 0.4, 0.8, { vr: -0.018 * dir, delay: L(60) });
        break;
      }
      case 'speed': {
        const m = n(5);
        for (let j = 0; j < m; j++)
          this.p('fx_line', x - dir * rnd(30, 50), y + rnd(-34, 34), -dir * 0.18, 0, L(rnd(220, 300)), 1, 1.1, {
            rot: dir > 0 ? Math.PI : 0, delay: L(rnd(0, 150)), a: 0.9, tint: 0xfff6e0,
          });
        break;
      }
      case 'moon': {
        this.p('fx_moon', x - dir * 30, y - 40, 0, -0.02, L(800), 0.6, 1.5, { vr: 0.002 });
        const m = n(5);
        for (let j = 0; j < m; j++)
          this.p('fx_spark', x + rnd(-36, 36), y + rnd(-44, 30), 0, -0.01, L(rnd(380, 520)), 0.3, 1.1, { delay: L(rnd(0, 360)), tint: 0xfff1b8 });
        break;
      }
      case 'dispel': {
        this.p('fx_ring', x, y, 0, 0, L(380), 0.4, 2.1, { tint: 0xc9a0ff });
        const m = n(7);
        for (let j = 0; j < m; j++) {
          const a = rnd(0, TAU);
          const v = rnd(0.05, 0.1);
          this.p('fx_spark', x, y, Math.cos(a) * v, Math.sin(a) * v, L(460), 1.1, 0.3, { tint: 0xd9b8ff });
        }
        break;
      }
      case 'time': {
        this.p('fx_gear', x, y - 8, 0, 0, L(700), 1, 2, { vr: -0.02, tint: 0xd2bcff, a: 0.85 });
        this.p('fx_ring', x, y - 8, 0, 0, L(420), 2, 0.6, { tint: 0xb8a0ff });
        break;
      }
    }
  }

  /** Small flame puff for a burn tick, spikes for a thorns hit. */
  tick(kind: 'burn' | 'thorns', x: number, y: number, lm: number) {
    if (this.still) return;
    if (kind === 'burn')
      for (let j = 0; j < 2; j++)
        this.p('fx_flame', x + rnd(-16, 16), y + rnd(4, 26), 0, -0.05, 480 * lm, 1, 0.3, { sway: 2, delay: j * 80 * lm });
    else
      for (let j = 0; j < 4; j++) {
        const a = -Math.PI / 2 + (j - 1.5) * 0.5;
        this.p('fx_spike', x + Math.cos(a) * 20, y + Math.sin(a) * 20, Math.cos(a) * 0.05, Math.sin(a) * 0.05, 300 * lm, 0.4, 1, { rot: a + Math.PI / 2 });
      }
  }

  /** at most one particle burst per fighter every `gap` ms (fast forward), so 4× doesn't flood the pool */
  allow(side: number, gap: number) {
    const now = this.scene.time.now;
    if (now - this.lastBurst[side] < gap) return false;
    this.lastBurst[side] = now;
    return true;
  }

  private stars(x: number, y: number, m: number, k: number, L: (ms: number) => number) {
    for (let j = 0; j < m; j++) {
      const a = rnd(0, TAU);
      const v = rnd(0.06, 0.13);
      this.p('fx_star', x + Math.cos(a) * 6, y + Math.sin(a) * 6, Math.cos(a) * v, Math.sin(a) * v - 0.03, L(rnd(380, 480)), rnd(0.8, 1.1) * Math.min(k, 1.4), 0.3, {
        g: 0.00022, vr: rnd(-0.012, 0.012),
      });
    }
  }

  private flakes(x: number, y: number, m: number, L: (ms: number) => number) {
    for (let j = 0; j < m; j++)
      this.p('fx_flake', x + rnd(-32, 32), y + rnd(-50, -10), 0, rnd(0.02, 0.04), L(rnd(800, 1050)), rnd(0.8, 1.2), 0.6, {
        vr: rnd(-0.004, 0.004), sway: 4, delay: L(rnd(0, 250)),
      });
  }
}
const NO = {};
