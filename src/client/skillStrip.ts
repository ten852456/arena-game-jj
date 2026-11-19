import Phaser from 'phaser';
import { SKILLS, lvOf } from '../sim/skills';
import type { Build } from '../sim/types';

/**
 * Each fighter's skills on the arena floor, under their feet: one round skill icon per skill, in list order
 * (left to right = top to bottom of the list). A clock-wipe shade lifts clockwise as the cooldown runs, with an
 * archetype-coloured ring; the icon pops and flashes white when it fires; icons turn ice-blue while frozen
 * (not 🗿 ใจเหล็ก skills) and pale blue while slowed. Gold dots = level. A chain (⚡ trigger / engine) draws a gold
 * bracket over the two icons. Everything is redrawn from the replay clock each frame with preallocated objects.
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
}

export class SkillStrip {
  private plate: Phaser.GameObjects.Graphics;
  private over: Phaser.GameObjects.Graphics;
  private icons: Phaser.GameObjects.Image[][] = [[], []];
  private builds: (Build | null)[] = [null, null];

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
        // level dots under the icon
        const lv = lvOf(k.v);
        g.fillStyle(0xffd56b, 1);
        for (let l = 0; l < lv; l++) g.fillCircle(cx + (l - (lv - 1) / 2) * 5, cy + r + 4.5, 1.6);
        if (lit) {
          // just fired: pop + white flash + expanding ring
          const q = Math.max(0, Math.min(1, (until - st.clock) / 5));
          const sc = 1 + 0.32 * q;
          m.setScale(base * sc).clearTint().setAlpha(1);
          o.fillStyle(0xffffff, 0.5 * q * q).fillCircle(cx, cy, r * sc);
          o.lineStyle(2.5, 0xffffff, q).strokeCircle(cx, cy, r + 2 + (1 - q) * 9);
          o.lineStyle(2, color, 0.9).strokeCircle(cx, cy, r + 1.5);
          continue;
        }
        m.setScale(base).setAlpha(fade);
        if (iced) m.setTint(0x8fd8ff);
        else if (st.slowed[s]) m.setTint(0xa9c4ff);
        else m.clearTint();
        // clock-wipe: the part of the cooldown still to run stays shaded
        if (ratio < 0.985) {
          o.fillStyle(iced ? 0x1d4a72 : 0x150f33, iced ? 0.6 : 0.52);
          o.beginPath();
          o.slice(cx, cy, r - 0.5, TOP + ratio * Math.PI * 2, TOP + Math.PI * 2, false);
          o.closePath();
          o.fillPath();
          if (ratio > 0.01) {
            o.lineStyle(2.4, iced ? 0x8fd8ff : color, 1);
            o.beginPath();
            o.arc(cx, cy, r + 1.4, TOP, TOP + ratio * Math.PI * 2, false);
            o.strokePath();
          }
        } else {
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
    }
  }
}
