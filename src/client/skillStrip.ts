import Phaser from 'phaser';
import { SKILLS, lvOf } from '../sim/skills';
import { cdTicks } from '../sim/combat';
import { activeBonuses, bonusTotals } from '../sim/links';
import type { Build } from '../sim/types';

/**
 * Each fighter's skills on the arena floor, under their feet: one round skill icon per skill, in list order
 * (left to right = top to bottom of the list). A clock-wipe shade lifts clockwise as the cooldown runs, with an
 * archetype-coloured ring; the icon pops and flashes white when it fires; icons turn ice-blue while frozen
 * (not 🗿 ใจเหล็ก skills) and pale blue while slowed. Gold dots = level. A chain (⚡ trigger / engine) draws a gold
 * bracket over the two icons. Everything is redrawn from the replay clock each frame with preallocated objects.
 * Juice (visual-clock ms, so hit-stop freezes it too): a firing icon lifts 8px / 1.1x (anticipation), dips and jolts
 * back; a chained fire draws a star-thread from the source icon to the chained one (120ms) and a pastel ring bursts
 * on the chained icon; an icon pulses in its last 0.3s before firing. Frozen icons get a frosted overlay, slowed
 * sweeps turn grey-purple, hasted skills (haste connect bonus) sweep in glowing cyan.
 */

export const STRIP_MAX = 8;
/** icon size in world units (the arena is 640×300): bigger when there are few skills (phones stay readable) */
const ICON_BIG = 34;
const ICON_SMALL = 30;
const GAP = 3;
const SIDE_X = [160, 480];
const SIDE_LINE = [0x9fd3ff, 0xffaaaa];
export const ARCH_HEX: Record<string, number> = {
  tank: 0x9ccbff, burst: 0xffa6ba, scaling: 0xffd98f, control: 0x9df0df, none: 0xc6c1e8,
};
const TOP = -Math.PI / 2;

export interface StripState {
  /** clock tick now */
  clock: number;
  /** progress 0..1 of skill i of side s (1 = ready) */
  ratio: (s: number, i: number) => number;
  /** block idx → clock tick until which it glows (just fired) */
  glow: Map<number, number>[];
  chainFlash: { a: number; b: number; until: number }[][];
  frozen: boolean[];
  slowed: boolean[];
  /** knocked out: that side's strip fades back so the fallen fighter reads clearly */
  dead: boolean[];
  /** visual clock (ms), for the fire / chain animations */
  now: number;
}

const BEAMS = 4;
const easeOut = (t: number) => 1 - (1 - t) * (1 - t);

export class SkillStrip {
  private plate: Phaser.GameObjects.Graphics;
  private over: Phaser.GameObjects.Graphics;
  private icons: Phaser.GameObjects.Image[][] = [[], []];
  private builds: (Build | null)[] = [null, null];
  /** per icon: fire animation start, chained-ring start (visual ms) */
  private fireT = [new Float64Array(STRIP_MAX).fill(-1e9), new Float64Array(STRIP_MAX).fill(-1e9)];
  private ringT = [new Float64Array(STRIP_MAX).fill(-1e9), new Float64Array(STRIP_MAX).fill(-1e9)];
  /** per icon: cooldown ticks (for the pre-fire pulse) and whether a haste bonus is on */
  private cd = [new Float32Array(STRIP_MAX), new Float32Array(STRIP_MAX)];
  private hasted = [new Uint8Array(STRIP_MAX), new Uint8Array(STRIP_MAX)];
  /** chain beams per side: from, to, start, duration */
  private beams = [new Float64Array(BEAMS * 4).fill(-1), new Float64Array(BEAMS * 4).fill(-1)];
  private bi = [0, 0];

  constructor(
    private scene: Phaser.Scene,
    private rowY: number,
    depth = 6,
  ) {
    this.plate = scene.add.graphics().setDepth(depth);
    for (const s of [0, 1])
      for (let i = 0; i < STRIP_MAX; i++) this.icons[s].push(scene.add.image(0, 0, '__DEFAULT').setVisible(false).setDepth(depth + 1));
    this.over = scene.add.graphics().setDepth(depth + 2);
  }

  /** Centre of icon i of side s (world units), e.g. where a chain bracket or effect should start. */
  slotX(s: number, i: number) {
    const n = Math.min(STRIP_MAX, this.builds[s]?.skills.length ?? 0);
    const z = this.size(s);
    const w = n * z + (n - 1) * GAP;
    return SIDE_X[s] - w / 2 + i * (z + GAP) + z / 2;
  }

  /** icon size of side s */
  size(s: number) {
    return (this.builds[s]?.skills.length ?? 0) > 6 ? ICON_SMALL : ICON_BIG;
  }

  setBuilds(b: [Build, Build] | null) {
    this.builds = b ? [b[0], b[1]] : [null, null];
    for (const s of [0, 1]) {
      this.fireT[s].fill(-1e9);
      this.ringT[s].fill(-1e9);
      this.beams[s].fill(-1);
      this.cd[s].fill(0);
      this.hasted[s].fill(0);
      const sk = this.builds[s]?.skills;
      if (!sk || !sk.every((k) => SKILLS[k.id])) continue;
      const act = activeBonuses(sk);
      sk.forEach((k, i) => {
        if (i >= STRIP_MAX) return;
        const h = bonusTotals(sk, i, act).haste;
        this.hasted[s][i] = h > 0 ? 1 : 0;
        this.cd[s][i] = cdTicks(k, h);
      });
    }
    for (const s of [0, 1])
      this.icons[s].forEach((m, i) => {
        const k = this.builds[s]?.skills[i];
        const key = k ? `sk_${k.id}` : '';
        if (!k || !this.scene.textures.exists(key)) return m.setVisible(false);
        m.setTexture(key).setPosition(this.slotX(s, i), this.rowY).setVisible(true).setAlpha(1);
        m.setData('s', this.size(s) / (m.frame.width || 128));
        m.setScale(m.getData('s') as number);
      });
    if (!b) {
      this.plate.clear();
      this.over.clear();
    }
  }

  /** true if skill i of side s has an active haste connect bonus */
  isHasted(s: number, i: number) {
    return i < STRIP_MAX && this.hasted[s][i] === 1;
  }

  /** Skill i of side s fires: lift (anticipation), dip, jolt back. at = visual ms when it starts. */
  fire(s: number, i: number, at: number) {
    if (i < STRIP_MAX) this.fireT[s][i] = at;
  }

  /** A chain set off skill `to` from skill `from`: star-thread along the strip, then a ring on `to`. */
  chain(s: number, from: number, to: number, at: number, ms: number) {
    if (from >= STRIP_MAX || to >= STRIP_MAX) return;
    const b = this.bi[s] * 4;
    this.bi[s] = (this.bi[s] + 1) % BEAMS;
    const bm = this.beams[s];
    bm[b] = from;
    bm[b + 1] = to;
    bm[b + 2] = at;
    bm[b + 3] = Math.max(40, ms);
    this.ringT[s][to] = at + ms;
  }

  draw(st: StripState) {
    const g = this.plate.clear();
    const o = this.over.clear();
    for (let s = 0; s < 2; s++) {
      const b = this.builds[s];
      if (!b || !b.skills.length) continue;
      const ICON = this.size(s);
      const r = ICON / 2;
      const n = Math.min(STRIP_MAX, b.skills.length);
      const x0 = this.slotX(s, 0) - r;
      const w = n * ICON + (n - 1) * GAP;
      const frozen = st.frozen[s];
      const fade = st.dead[s] ? 0.5 : 1;
      // tray
      g.fillStyle(0x221a52, 0.72 * fade).fillRoundedRect(x0 - 6, this.rowY - r - 5, w + 12, ICON + 15, 12);
      g.lineStyle(1.5, frozen ? 0x8fd8ff : SIDE_LINE[s], frozen ? 1 : 0.75).strokeRoundedRect(x0 - 6, this.rowY - r - 5, w + 12, ICON + 15, 12);
      for (let i = 0; i < n; i++) {
        const k = b.skills[i];
        const m = this.icons[s][i];
        const cx = this.slotX(s, i);
        const cy = this.rowY;
        const color = ARCH_HEX[SKILLS[k.id]?.arch ?? 'none'];
        const until = st.glow[s].get(i) ?? -1;
        const lit = until >= st.clock;
        const base = (m.getData('s') as number) ?? ICON / 128;
        const ratio = lit ? 1 : st.ratio(s, i);
        const iced = frozen && k.mark !== 'steadfast';
        // fire animation (visual ms): lift 8px / 1.1x over 80ms, dip to +3px / 0.94x by 140ms, jolt back by 320ms
        const fa = st.now - this.fireT[s][i];
        const firing = fa >= 0 && fa < 320;
        let dy = 0;
        let fs = 1;
        if (firing) {
          if (fa < 80) {
            const e = easeOut(fa / 80);
            dy = -8 * e;
            fs = 1 + 0.1 * e;
          } else if (fa < 140) {
            const e = (fa - 80) / 60;
            dy = -8 + 11 * e;
            fs = 1.1 - 0.16 * e;
          } else {
            const u = (fa - 140) / 180;
            const w = (1 - u) * Math.cos(u * Math.PI * 2.5);
            dy = 3 * w;
            fs = 1 - 0.06 * w;
          }
        }
        const iy = cy + dy;
        m.setY(iy);
        // level dots under the icon
        const lv = lvOf(k.v);
        g.fillStyle(0xffd56b, 1);
        for (let l = 0; l < lv; l++) g.fillCircle(cx + (l - (lv - 1) / 2) * 5, cy + r + 4.5, 1.6);
        // chained ring: a pastel ring bursts out of the icon (300ms)
        const ra = st.now - this.ringT[s][i];
        if (ra >= 0 && ra < 300) {
          const u = ra / 300;
          o.lineStyle(3.5 * (1 - u) + 1, 0xffb7d5, 1 - u).strokeCircle(cx, iy, r + 2 + u * 16);
          o.lineStyle(2, 0xb8f5e4, (1 - u) * 0.9).strokeCircle(cx, iy, r + u * 10);
        }
        if (lit || firing) {
          // just fired: lift / dip, white flash on the dip + expanding ring
          const q = lit ? Math.max(0, Math.min(1, (until - st.clock) / 5)) : 0;
          const sc = firing ? fs : 1 + 0.2 * q;
          m.setScale(base * sc).clearTint().setAlpha(1);
          const flash = fa >= 80 && fa < 220 ? 1 - (fa - 80) / 140 : 0;
          o.fillStyle(0xffffff, Math.max(0.3 * q * q, 0.75 * flash)).fillCircle(cx, iy, r * sc);
          o.lineStyle(2.5, 0xffffff, Math.max(q, flash)).strokeCircle(cx, iy, r + 2 + (1 - Math.max(q, flash)) * 9);
          o.lineStyle(2, color, 0.9).strokeCircle(cx, iy, r + 1.5);
          continue;
        }
        // last 0.3s before it fires: a little anticipation pulse
        const cdt = this.cd[s][i];
        const soon = !iced && cdt > 0 && ratio < 0.985 && (1 - ratio) * cdt <= 3;
        m.setScale(base * (soon ? 1.05 + 0.03 * Math.sin(st.now / 40) : 1)).setAlpha(fade);
        if (iced) m.setTint(0x9fdcff);
        else if (st.slowed[s]) m.setTint(0xb7aed6);
        else m.clearTint();
        const hasted = this.hasted[s][i] === 1 && !iced;
        const sweep = iced ? 0x8fd8ff : st.slowed[s] ? 0x9a88c8 : hasted ? 0x7ff0ff : color;
        // clock-wipe: the part of the cooldown still to run stays shaded
        if (ratio < 0.985) {
          o.fillStyle(iced ? 0x1d4a72 : st.slowed[s] ? 0x2a2140 : 0x150f33, iced ? 0.6 : 0.52);
          o.beginPath();
          o.slice(cx, iy, r - 0.5, TOP + ratio * Math.PI * 2, TOP + Math.PI * 2, false);
          o.closePath();
          o.fillPath();
          if (ratio > 0.01) {
            if (hasted && !st.slowed[s]) {
              o.lineStyle(5, 0x7ff0ff, 0.3 + 0.15 * Math.sin(st.now / 90));
              o.beginPath();
              o.arc(cx, iy, r + 1.4, TOP, TOP + ratio * Math.PI * 2, false);
              o.strokePath();
            }
            o.lineStyle(2.4, sweep, 1);
            o.beginPath();
            o.arc(cx, iy, r + 1.4, TOP, TOP + ratio * Math.PI * 2, false);
            o.strokePath();
          }
        }
        if (iced) {
          // frosted icon: icy film, rim and a few crystal strokes
          o.fillStyle(0xe4f7ff, 0.38).fillCircle(cx, iy, r - 0.5);
          o.lineStyle(2, 0xffffff, 0.95).strokeCircle(cx, iy, r + 0.5);
          o.lineStyle(1.2, 0xffffff, 0.8);
          o.lineBetween(cx - r * 0.55, iy - r * 0.15, cx - r * 0.15, iy - r * 0.55);
          o.lineBetween(cx + r * 0.2, iy + r * 0.5, cx + r * 0.55, iy + r * 0.1);
          o.lineBetween(cx - r * 0.1, iy + r * 0.2, cx + r * 0.1, iy - r * 0.05);
          continue;
        }
        if (ratio >= 0.985) {
          // ready: soft pulsing white ring
          const p = 0.55 + 0.45 * Math.sin(st.clock * 0.9 + i);
          o.lineStyle(2.4, 0xffffff, p).strokeCircle(cx, cy, r + 1.4);
        }
      }
      // chain links that just fired: a gold bracket over the two icons, fading out
      for (const f of st.chainFlash[s]) {
        const left = f.until - st.clock;
        if (left <= 0 || f.a >= n || f.b >= n) continue;
        const q = Math.min(1, left / 8);
        const xa = this.slotX(s, Math.min(f.a, f.b));
        const xb = this.slotX(s, Math.max(f.a, f.b));
        const yb = this.rowY - r - 3;
        const yt = yb - 7;
        o.lineStyle(6, 0xffb86b, 0.35 * q).lineBetween(xa, yt, xb, yt);
        o.lineStyle(2.5, 0xffe2a0, q).lineBetween(xa, yb, xa, yt).lineBetween(xa, yt, xb, yt).lineBetween(xb, yt, xb, yb);
        o.lineStyle(2, 0xffe2a0, q).strokeCircle(this.slotX(s, f.a), this.rowY, r + 3).strokeCircle(this.slotX(s, f.b), this.rowY, r + 3);
      }
      // chain star-threads: a glowing thread arcs from the source icon to the chained one, then fades
      const bm = this.beams[s];
      for (let j = 0; j < BEAMS; j++) {
        const b = j * 4;
        if (bm[b] < 0) continue;
        const age = st.now - bm[b + 2];
        const ms = bm[b + 3];
        if (age < 0) continue;
        if (age > ms + 260) {
          bm[b] = -1;
          continue;
        }
        const a = bm[b];
        const to = bm[b + 1];
        if (a >= n || to >= n) continue;
        const xa = this.slotX(s, a);
        const xb = this.slotX(s, to);
        const lift = 14 + Math.abs(to - a) * 4;
        const head = Math.min(1, age / ms);
        const fadeK = age > ms ? 1 - (age - ms) / 260 : 1;
        const yA = this.rowY - r * 0.6;
        const SEG = 10;
        let px = xa;
        let py = yA;
        for (let q = 1; q <= SEG; q++) {
          const u = (q / SEG) * head;
          const x = xa + (xb - xa) * u;
          const y = yA - Math.sin(u * Math.PI) * lift;
          o.lineStyle(7, 0xffb86b, 0.35 * fadeK).lineBetween(px, py, x, y);
          o.lineStyle(2.4, 0xfff4cf, 0.95 * fadeK).lineBetween(px, py, x, y);
          px = x;
          py = y;
        }
        // the star at the thread's head
        if (age < ms + 100) {
          const sr = 5 + 2 * Math.sin(age / 30);
          o.fillStyle(0xffffff, fadeK).fillCircle(px, py, 2.6);
          o.lineStyle(2, 0xffe08a, fadeK).lineBetween(px - sr, py, px + sr, py).lineBetween(px, py - sr, px, py + sr);
        }
      }
    }
  }
}
