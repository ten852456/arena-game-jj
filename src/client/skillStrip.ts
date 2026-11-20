import Phaser from 'phaser';
import { SKILLS, lvOf } from '../sim/skills';
import { HASTE_BONUS, activeBonuses, footprint } from '../sim/grid';
import { cdTicks } from '../sim/combat';
import type { Build } from '../sim/types';

/**
 * Each fighter's skill grid in the arena, beside them (grid version of the list build's skill strip): the blocks are
 * drawn in their real shapes and places, softly filled in the archetype colour, with the round skill icon on each
 * block. A clock-wipe shade lifts clockwise over the icon as the cooldown runs, with an archetype-coloured ring; the
 * icon pops and the block flashes when it fires; icons turn ice-blue while frozen (not 🗿 ใจเหล็ก blocks) and pale
 * lavender while slowed. Gold dots = level. A chain (⚡ trigger bonus / engine) draws a star-thread from the block that
 * set it off to the chained one and a gold outline round both blocks. Everything is redrawn from the replay clock each
 * frame with preallocated objects.
 * Juice (visual-clock ms, so hit-stop freezes it too): a firing icon lifts 6px / 1.1x (anticipation), dips and jolts
 * back; a chained block gets a pastel ring burst; an icon pulses in its last 0.3s before firing. Hasted blocks (haste
 * connect bonus) sweep in glowing cyan.
 */

/** most blocks drawn per side (a full 8×6 grid of 1-cell blocks would be 48) */
export const STRIP_MAX = 48;
/** cell size (world units) is the biggest that fits the tray box, capped */
const CELL_MAX = 26;
const BOX_W = 138;
const BOX_H = 150;
/** tray edge from the arena side, bottom edge */
const EDGE = 10;
const SIDE_LINE = [0x9fd3ff, 0xffaaaa];
export const ARCH_HEX: Record<string, number> = {
  tank: 0x9ccbff, burst: 0xffa6ba, scaling: 0xffd98f, control: 0x9df0df, none: 0xc6c1e8,
};
const TOP = -Math.PI / 2;

export interface StripState {
  /** clock tick now */
  clock: number;
  /** progress 0..1 of block i of side s (1 = ready), i = build.skills index */
  ratio: (s: number, i: number) => number;
  /** block idx → clock tick until which it glows (just fired) */
  glow: Map<number, number>[];
  /** chain links that just fired: block a set off block b */
  chainFlash: { a: number; b: number; until: number }[][];
  frozen: boolean[];
  slowed: boolean[];
  /** knocked out: that side's tray fades back so the fallen fighter reads clearly */
  dead: boolean[];
  /** visual clock (ms), for the fire / chain animations */
  now: number;
}

interface Slot {
  /** build.skills index */
  idx: number;
  id: string;
  arch: string;
  steadfast: boolean;
  lv: number;
  /** icon centre and radius (world units) */
  cx: number;
  cy: number;
  r: number;
  /** cell rects (x, y) of the block, top-left, in world units */
  cells: [number, number][];
  /** outline segments [x1, y1, x2, y2] around the block */
  edges: number[];
  cd: number;
  hasted: boolean;
}

const BEAMS = 4;
const easeOut = (t: number) => 1 - (1 - t) * (1 - t);

export class SkillStrip {
  private plate: Phaser.GameObjects.Graphics;
  private over: Phaser.GameObjects.Graphics;
  private icons: Phaser.GameObjects.Image[][] = [[], []];
  private builds: (Build | null)[] = [null, null];
  /** per side: drawn blocks, build.skills index → slot number */
  private slots: Slot[][] = [[], []];
  private at: Map<number, number>[] = [new Map(), new Map()];
  /** per side: tray box (x, y, w, h) and cell size */
  private box: number[][] = [[0, 0, 0, 0], [0, 0, 0, 0]];
  private cell = [CELL_MAX, CELL_MAX];
  /** per slot: fire animation start, chained-ring start (visual ms) */
  private fireT = [new Float64Array(STRIP_MAX).fill(-1e9), new Float64Array(STRIP_MAX).fill(-1e9)];
  private ringT = [new Float64Array(STRIP_MAX).fill(-1e9), new Float64Array(STRIP_MAX).fill(-1e9)];
  /** chain beams per side: from slot, to slot, start, duration */
  private beams = [new Float64Array(BEAMS * 4).fill(-1), new Float64Array(BEAMS * 4).fill(-1)];
  private bi = [0, 0];

  constructor(
    private scene: Phaser.Scene,
    /** arena width and the y of the tray's bottom edge */
    private arenaW: number,
    private bottom: number,
    depth = 6,
  ) {
    this.plate = scene.add.graphics().setDepth(depth);
    for (const s of [0, 1])
      for (let i = 0; i < STRIP_MAX; i++) this.icons[s].push(scene.add.image(0, 0, '__DEFAULT').setVisible(false).setDepth(depth + 1));
    this.over = scene.add.graphics().setDepth(depth + 2);
  }

  /** Centre of block idx (build.skills index) of side s, world units ([0, 0] if not drawn). */
  slotPos(s: number, idx: number): [number, number] {
    const k = this.at[s].get(idx);
    const sl = k === undefined ? undefined : this.slots[s][k];
    return sl ? [sl.cx, sl.cy] : [0, 0];
  }

  setBuilds(b: [Build, Build] | null) {
    this.builds = b ? [b[0], b[1]] : [null, null];
    for (const s of [0, 1]) {
      this.fireT[s].fill(-1e9);
      this.ringT[s].fill(-1e9);
      this.beams[s].fill(-1);
      this.slots[s] = [];
      this.at[s] = new Map();
      const bd = this.builds[s];
      if (!bd || !bd.skills.every((k) => SKILLS[k.id])) continue;
      const c = Math.max(10, Math.min(CELL_MAX, Math.floor(BOX_W / Math.max(1, bd.w)), Math.floor(BOX_H / Math.max(1, bd.h))));
      this.cell[s] = c;
      const w = bd.w * c;
      const h = bd.h * c;
      const ox = s === 0 ? EDGE : this.arenaW - EDGE - w;
      const oy = this.bottom - h;
      this.box[s] = [ox, oy, w, h];
      const act = activeBonuses(bd.skills, bd.w, bd.h);
      bd.skills.forEach((k, idx) => {
        if (k.x < 0 || this.slots[s].length >= STRIP_MAX) return;
        const cells = footprint(k);
        const own = new Set(cells.map(([x, y]) => y * 64 + x));
        const xs = cells.map((p) => p[0]);
        const ys = cells.map((p) => p[1]);
        const bw = Math.max(...xs) - Math.min(...xs) + 1;
        const bh = Math.max(...ys) - Math.min(...ys) + 1;
        const mx = xs.reduce((n, v) => n + v, 0) / cells.length;
        const my = ys.reduce((n, v) => n + v, 0) / cells.length;
        let cx: number;
        let cy: number;
        let r: number;
        if (cells.length === bw * bh) {
          // full rectangle: icon in the middle, as big as the short side allows
          cx = ox + (mx + 0.5) * c;
          cy = oy + (my + 0.5) * c;
          r = Math.min(20, Math.min(bw, bh) * c * 0.42);
        } else {
          // L / T / S shapes: on the cell nearest the middle
          const near = cells.reduce((best, p) => (Math.hypot(p[0] - mx, p[1] - my) < Math.hypot(best[0] - mx, best[1] - my) ? p : best));
          cx = ox + (near[0] + 0.5) * c;
          cy = oy + (near[1] + 0.5) * c;
          r = c * 0.44;
        }
        const edges: number[] = [];
        for (const [x, y] of cells) {
          const X = ox + x * c;
          const Y = oy + y * c;
          if (!own.has((y - 1) * 64 + x)) edges.push(X, Y, X + c, Y);
          if (!own.has((y + 1) * 64 + x)) edges.push(X, Y + c, X + c, Y + c);
          if (!own.has(y * 64 + x - 1)) edges.push(X, Y, X, Y + c);
          if (!own.has(y * 64 + x + 1)) edges.push(X + c, Y, X + c, Y + c);
        }
        const haste = act.filter((a) => a.from === idx && a.b.e === 'haste').length * HASTE_BONUS;
        this.at[s].set(idx, this.slots[s].length);
        this.slots[s].push({
          idx, id: k.id, arch: SKILLS[k.id].arch, steadfast: k.mark === 'steadfast', lv: lvOf(k.v),
          cx, cy, r, cells: cells.map(([x, y]) => [ox + x * c, oy + y * c]), edges, cd: cdTicks(k, haste), hasted: haste > 0,
        });
      });
    }
    for (const s of [0, 1])
      this.icons[s].forEach((m, j) => {
        const sl = this.slots[s][j];
        const key = sl ? `sk_${sl.id}` : '';
        if (!sl || !this.scene.textures.exists(key)) return m.setVisible(false);
        m.setTexture(key).setPosition(sl.cx, sl.cy).setVisible(true).setAlpha(1).clearTint();
        m.setData('s', (sl.r * 2) / (m.frame.width || 128));
        m.setScale(m.getData('s') as number);
      });
    if (!b) {
      this.plate.clear();
      this.over.clear();
    }
  }

  /** true if block idx of side s has an active haste connect bonus */
  isHasted(s: number, idx: number) {
    const k = this.at[s].get(idx);
    return k !== undefined && this.slots[s][k].hasted;
  }

  /** Block idx of side s fires: lift (anticipation), dip, jolt back. at = visual ms when it starts. */
  fire(s: number, idx: number, at: number) {
    const k = this.at[s].get(idx);
    if (k !== undefined) this.fireT[s][k] = at;
  }

  /** A chain: block `from` set off block `to`. A star-thread runs between them, then a ring bursts on `to`. */
  chain(s: number, from: number, to: number, at: number, ms: number) {
    const a = this.at[s].get(from);
    const b = this.at[s].get(to);
    if (a === undefined || b === undefined) return;
    const j = this.bi[s] * 4;
    this.bi[s] = (this.bi[s] + 1) % BEAMS;
    const bm = this.beams[s];
    bm[j] = a;
    bm[j + 1] = b;
    bm[j + 2] = at;
    bm[j + 3] = Math.max(40, ms);
    this.ringT[s][b] = at + ms;
  }

  draw(st: StripState) {
    const g = this.plate.clear();
    const o = this.over.clear();
    for (let s = 0; s < 2; s++) {
      const slots = this.slots[s];
      if (!this.builds[s]) continue;
      const [bx, by, bw, bh] = this.box[s];
      const c = this.cell[s];
      const frozen = st.frozen[s];
      const fade = st.dead[s] ? 0.5 : 1;
      // tray with faint empty cells
      g.fillStyle(0x221a52, 0.72 * fade).fillRoundedRect(bx - 5, by - 5, bw + 10, bh + 10, 9);
      g.lineStyle(1.5, frozen ? 0x8fd8ff : SIDE_LINE[s], frozen ? 1 : 0.75).strokeRoundedRect(bx - 5, by - 5, bw + 10, bh + 10, 9);
      g.lineStyle(1, 0x3a3170, 0.6 * fade);
      for (let x = 1; x < bw / c; x++) g.lineBetween(bx + x * c, by, bx + x * c, by + bh);
      for (let y = 1; y < bh / c; y++) g.lineBetween(bx, by + y * c, bx + bw, by + y * c);
      for (let j = 0; j < slots.length; j++) {
        const sl = slots[j];
        const m = this.icons[s][j];
        const { cx, cy, r } = sl;
        const color = ARCH_HEX[sl.arch] ?? 0xc6c1e8;
        const until = st.glow[s].get(sl.idx) ?? -1;
        const lit = until >= st.clock;
        const base = (m.getData('s') as number) ?? (r * 2) / 128;
        const ratio = lit ? 1 : st.ratio(s, sl.idx);
        const iced = frozen && !sl.steadfast;
        // block body in its archetype colour, with an outline
        g.fillStyle(iced ? 0x8fd8ff : color, (iced ? 0.22 : 0.26) * fade);
        for (const [x, y] of sl.cells) g.fillRect(x + 0.5, y + 0.5, c - 1, c - 1);
        g.lineStyle(1.4, iced ? 0xbfeaff : color, 0.85 * fade);
        const e = sl.edges;
        for (let q = 0; q < e.length; q += 4) g.lineBetween(e[q], e[q + 1], e[q + 2], e[q + 3]);
        // fire animation (visual ms): lift 6px / 1.1x over 80ms, dip to +2px / 0.94x by 140ms, jolt back by 320ms
        const fa = st.now - this.fireT[s][j];
        const firing = fa >= 0 && fa < 320;
        let dy = 0;
        let fs = 1;
        if (firing) {
          if (fa < 80) {
            const k = easeOut(fa / 80);
            dy = -6 * k;
            fs = 1 + 0.1 * k;
          } else if (fa < 140) {
            const k = (fa - 80) / 60;
            dy = -6 + 8 * k;
            fs = 1.1 - 0.16 * k;
          } else {
            const u = (fa - 140) / 180;
            const w = (1 - u) * Math.cos(u * Math.PI * 2.5);
            dy = 2 * w;
            fs = 1 - 0.06 * w;
          }
        }
        const iy = cy + dy;
        m.setY(iy);
        // level dots on the icon's lower rim
        g.fillStyle(0xffd56b, fade);
        for (let l = 0; l < sl.lv; l++) g.fillCircle(cx + (l - (sl.lv - 1) / 2) * 4.2, cy + r + 1.5, 1.4);
        // chained ring: a pastel ring bursts out of the icon (300ms)
        const ra = st.now - this.ringT[s][j];
        if (ra >= 0 && ra < 300) {
          const u = ra / 300;
          o.lineStyle(3 * (1 - u) + 1, 0xffb7d5, 1 - u).strokeCircle(cx, iy, r + 2 + u * 14);
          o.lineStyle(2, 0xb8f5e4, (1 - u) * 0.9).strokeCircle(cx, iy, r + u * 9);
        }
        if (lit || firing) {
          // just fired: the block glows, the icon lifts / dips with a soft flash + expanding ring
          const q = lit ? Math.max(0, Math.min(1, (until - st.clock) / 5)) : 0;
          const sc = firing ? fs : 1 + 0.2 * q;
          m.setScale(base * sc).clearTint().setAlpha(1);
          const flash = fa >= 80 && fa < 220 ? 1 - (fa - 80) / 140 : 0;
          const glowA = Math.max(0.35 * q, 0.45 * flash);
          if (glowA > 0.01) {
            o.fillStyle(0xfff4d8, glowA);
            for (const [x, y] of sl.cells) o.fillRect(x + 0.5, y + 0.5, c - 1, c - 1);
          }
          o.fillStyle(0xffffff, Math.max(0.25 * q * q, 0.55 * flash)).fillCircle(cx, iy, r * sc);
          o.lineStyle(2.2, 0xffffff, Math.max(q, flash)).strokeCircle(cx, iy, r + 2 + (1 - Math.max(q, flash)) * 7);
          o.lineStyle(1.8, color, 0.9).strokeCircle(cx, iy, r + 1.2);
          continue;
        }
        // last 0.3s before it fires: a little anticipation pulse
        const soon = !iced && sl.cd > 0 && ratio < 0.985 && (1 - ratio) * sl.cd <= 3;
        m.setScale(base * (soon ? 1.05 + 0.03 * Math.sin(st.now / 40) : 1)).setAlpha(fade);
        if (iced) m.setTint(0x9fdcff);
        else if (st.slowed[s]) m.setTint(0xb7aed6);
        else m.clearTint();
        const hasted = sl.hasted && !iced;
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
              o.lineStyle(4, 0x7ff0ff, 0.3 + 0.15 * Math.sin(st.now / 90));
              o.beginPath();
              o.arc(cx, iy, r + 1.2, TOP, TOP + ratio * Math.PI * 2, false);
              o.strokePath();
            }
            o.lineStyle(2, sweep, 1);
            o.beginPath();
            o.arc(cx, iy, r + 1.2, TOP, TOP + ratio * Math.PI * 2, false);
            o.strokePath();
          }
        }
        if (iced) {
          // frosted icon: icy film, rim and a few crystal strokes
          o.fillStyle(0xe4f7ff, 0.38).fillCircle(cx, iy, r - 0.5);
          o.lineStyle(1.6, 0xffffff, 0.95).strokeCircle(cx, iy, r + 0.5);
          o.lineStyle(1, 0xffffff, 0.8);
          o.lineBetween(cx - r * 0.55, iy - r * 0.15, cx - r * 0.15, iy - r * 0.55);
          o.lineBetween(cx + r * 0.2, iy + r * 0.5, cx + r * 0.55, iy + r * 0.1);
          o.lineBetween(cx - r * 0.1, iy + r * 0.2, cx + r * 0.1, iy - r * 0.05);
          continue;
        }
        if (ratio >= 0.985) {
          // ready: soft pulsing white ring
          const p = 0.55 + 0.45 * Math.sin(st.clock * 0.9 + j);
          o.lineStyle(2, 0xffffff, p).strokeCircle(cx, cy, r + 1.2);
        }
      }
      // chain links that just fired: a gold outline round both blocks and a bright link between them, fading out
      for (const f of st.chainFlash[s]) {
        const left = f.until - st.clock;
        const ja = this.at[s].get(f.a);
        const jb = this.at[s].get(f.b);
        if (left <= 0 || ja === undefined || jb === undefined) continue;
        const q = Math.min(1, left / 8);
        const A = slots[ja];
        const B = slots[jb];
        for (const sl of [A, B]) {
          o.lineStyle(2.4, 0xffe2a0, q);
          for (let k = 0; k < sl.edges.length; k += 4) o.lineBetween(sl.edges[k], sl.edges[k + 1], sl.edges[k + 2], sl.edges[k + 3]);
        }
        o.lineStyle(5, 0xffb86b, 0.35 * q).lineBetween(A.cx, A.cy, B.cx, B.cy);
        o.lineStyle(2, 0xffe2a0, q).lineBetween(A.cx, A.cy, B.cx, B.cy);
      }
      // chain star-threads: a glowing thread arcs from the source block to the chained one, then fades
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
        const A = slots[bm[b]];
        const B = slots[bm[b + 1]];
        if (!A || !B) continue;
        const dx = B.cx - A.cx;
        const dyy = B.cy - A.cy;
        const len = Math.hypot(dx, dyy) || 1;
        // bow the thread perpendicular to the link, towards the top (sideways for an up / down link)
        const flip = dx / len > 0 ? -1 : 1;
        const nx = (-dyy / len) * flip;
        const ny = (dx / len) * flip;
        const lift = 8 + len * 0.15;
        const head = Math.min(1, age / ms);
        const fadeK = age > ms ? 1 - (age - ms) / 260 : 1;
        const SEG = 10;
        let px = A.cx;
        let py = A.cy;
        for (let q = 1; q <= SEG; q++) {
          const u = (q / SEG) * head;
          const bow = Math.sin(u * Math.PI) * lift;
          const x = A.cx + dx * u + nx * bow;
          const y = A.cy + dyy * u + ny * bow;
          o.lineStyle(6, 0xffb86b, 0.35 * fadeK).lineBetween(px, py, x, y);
          o.lineStyle(2.2, 0xfff4cf, 0.95 * fadeK).lineBetween(px, py, x, y);
          px = x;
          py = y;
        }
        // the star at the thread's head
        if (age < ms + 100) {
          const sr = 4.5 + 2 * Math.sin(age / 30);
          o.fillStyle(0xffffff, fadeK).fillCircle(px, py, 2.4);
          o.lineStyle(1.8, 0xffe08a, fadeK).lineBetween(px - sr, py, px + sr, py).lineBetween(px, py - sr, px, py + sr);
        }
      }
    }
  }
}
