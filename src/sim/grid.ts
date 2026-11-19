import { Rng } from './rng';
import { L } from '../i18n';
import { SKILLS, SKILL_LIST, hits } from './skills';
import { ARCHES, type Bonus, type BonusKind, type Rot, type SkillInstance } from './types';

/**
 * Skill grid (inventory-style packing). Pure and deterministic: runs on server and browser.
 * Blocks have a shape, can rotate 90°, and carry connect bonuses: a bonus is active when
 * ANY touching block matches its condition (a skill, or a skill type). The side does not matter.
 */

export const DX = [0, 1, 0, -1];
export const DY = [-1, 0, 1, 0];
export const MAX_W = 8;
export const MAX_H = 6;
export const MAX_BONUS = 3;
export const BONUS_KINDS: BonusKind[] = ['dmg', 'shield', 'haste', 'power', 'trigger'];
export const POWER_BONUS = 0.25;
export const HASTE_BONUS = 0.2;
/** +damage per hit / +shield per fire, by level (Lv1–Lv3) */
export const bonusValue = (e: BonusKind, lv: number) => (e === 'dmg' ? lv : e === 'shield' ? 1 + lv : 0);
/** True if some variant of the skill hits (a +damage bonus would do nothing otherwise). */
export const canHit = (id: string) => Object.values(SKILLS[id].tree).some(hits);

/** '#' = cell. Cell index = reading order of '#' in the rows (stable under rotation). */
export const SHAPES: Record<string, string[]> = {
  dot: ['#'],
  i2: ['##'],
  i3: ['###'],
  l3: ['##', '#.'],
  i4: ['####'],
  o4: ['##', '##'],
  t4: ['###', '.#.'],
  l4: ['###', '#..'],
  s4: ['##.', '.##'],
  p5: ['##', '##', '#.'],
  r6: ['###', '###'],
};

const BASE: Record<string, [number, number][]> = Object.fromEntries(
  Object.entries(SHAPES).map(([k, rows]) => {
    const cells: [number, number][] = [];
    rows.forEach((r, y) => [...r].forEach((ch, x) => ch === '#' && cells.push([x, y])));
    return [k, cells];
  }),
);

export const shapeSize = (shape: string) => BASE[shape]?.length ?? 0;
export const isShape = (shape: string) => !!BASE[shape];

/** Cells of a shape after rotating `rot` times clockwise, moved so the top-left is (0,0). Index order is kept. */
export function cellsOf(shape: string, rot: Rot): [number, number][] {
  let cells = BASE[shape].map(([x, y]) => [x, y] as [number, number]);
  for (let i = 0; i < rot; i++) cells = cells.map(([x, y]) => [-y, x]);
  const mx = Math.min(...cells.map((c) => c[0]));
  const my = Math.min(...cells.map((c) => c[1]));
  return cells.map(([x, y]) => [x - mx, y - my]);
}

/** Grid cells covered by a placed block. */
export function footprint(k: Pick<SkillInstance, 'shape' | 'rot' | 'x' | 'y'>): [number, number][] {
  return cellsOf(k.shape, k.rot).map(([x, y]) => [k.x + x, k.y + y]);
}

export type Occupancy = Int16Array; // w*h, value = block index or -1

/** Builds the occupancy grid of placed blocks. Returns an error string on overlap / out of bounds. */
export function occupancy(skills: SkillInstance[], w: number, h: number): Occupancy | string {
  const g = new Int16Array(w * h).fill(-1);
  for (let i = 0; i < skills.length; i++) {
    const k = skills[i];
    if (k.x < 0) continue;
    for (const [x, y] of footprint(k)) {
      if (x < 0 || y < 0 || x >= w || y >= h) return L('ออกนอกตาราง', 'Outside the grid');
      if (g[y * w + x] !== -1) return L('วางทับกัน', 'Overlaps another block');
      g[y * w + x] = i;
    }
  }
  return g;
}

export function fits(skills: SkillInstance[], w: number, h: number, i: number, x: number, y: number, rot: Rot): boolean {
  const k = { ...skills[i], x, y, rot };
  const g = occupancy(
    skills.map((s, j) => (j === i ? { ...s, x: -1 } : s)),
    w,
    h,
  );
  if (typeof g === 'string') return false;
  return footprint(k).every(([cx, cy]) => cx >= 0 && cy >= 0 && cx < w && cy < h && g[cy * w + cx] === -1);
}

/** Does block `k` satisfy condition t ('strike' or 'arch:control')? */
export function matches(t: string, k: Pick<SkillInstance, 'id'>): boolean {
  return t === k.id || t === 'arch:' + SKILLS[k.id]?.arch;
}

/** For each placed block: the set of blocks touching it (4-neighbour, any cell). */
export function neighbours(skills: SkillInstance[], w: number, h: number): number[][] {
  const out: number[][] = skills.map(() => []);
  const g = occupancy(skills, w, h);
  if (typeof g === 'string') return out;
  skills.forEach((k, i) => {
    if (k.x < 0) return;
    const set = new Set<number>();
    for (const [x, y] of footprint(k))
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d];
        const ny = y + DY[d];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = g[ny * w + nx];
        if (j >= 0 && j !== i) set.add(j);
      }
    out[i] = [...set].sort((a, b) => a - b);
  });
  return out;
}

export interface ActiveBonus {
  /** block that owns the bonus */
  from: number;
  /** index into its bonus list */
  bi: number;
  b: Bonus;
  /** touching blocks that match the condition */
  to: number[];
}

/** Bonuses whose condition is met by at least one touching block. */
export function activeBonuses(skills: SkillInstance[], w: number, h: number): ActiveBonus[] {
  const nb = neighbours(skills, w, h);
  const out: ActiveBonus[] = [];
  skills.forEach((k, i) => {
    if (k.x < 0) return;
    k.bonus.forEach((b, bi) => {
      const to = nb[i].filter((j) => matches(b.t, skills[j]));
      if (to.length) out.push({ from: i, bi, b, to });
    });
  });
  return out;
}

/**
 * Shop offer. v = '' is a new Lv1 skill with its rolled shape and connect bonuses; any other v is an upgrade of a
 * skill you own (its next tree variant, one of two, picked at random; shape = the owned block's, bonus unused).
 */
export interface Offer {
  id: string;
  v: string;
  shape: string;
  bonus: Bonus[];
}

/** Skills a condition can name: shared skills + this hero's unique. */
const targetsFor = (id: string, hero: string) =>
  SKILL_LIST.filter((d) => d.id !== id && (!d.hero || d.hero === hero)).map((d) => d.id);

export const validTarget = (t: string, hero: string) =>
  ARCHES.some((a) => t === 'arch:' + a) || SKILL_LIST.some((d) => d.id === t && (!d.hero || d.hero === hero));

export function rollBonus(rng: Rng, id: string, hero: string, existing: Bonus[]): Bonus | null {
  for (let tries = 0; tries < 10; tries++) {
    const r = rng.next();
    // trigger is the rarest (18%): every trigger bonus adds chains, and many of them made fights a wall of chains
    const e: BonusKind = r < 0.32 ? 'dmg' : r < 0.48 ? 'shield' : r < 0.64 ? 'haste' : r < 0.82 ? 'power' : 'trigger';
    if (e === 'dmg' && !canHit(id)) continue; // skills that don't hit roll another effect
    const t = rng.next() < 0.6 ? rng.pick(targetsFor(id, hero)) : 'arch:' + rng.pick(ARCHES);
    if (!existing.some((b) => b.t === t && b.e === e)) return { t, e };
  }
  return null;
}

/** Each copy rolls its own shape (from the skill's pool) and 1–2 connect bonuses. */
export function rollOffer(rng: Rng, id: string, hero: string): Offer {
  const def = SKILLS[id];
  const shape = rng.pick(def.shapes);
  const bonus: Bonus[] = [];
  const n = rng.next() < 0.35 ? 2 : 1;
  for (let i = 0; i < n; i++) {
    const b = rollBonus(rng, id, hero, bonus);
    if (b) bonus.push(b);
  }
  return { id, v: '', shape, bonus };
}

/** First free spot (reading order, any rotation). */
export function findSpot(skills: SkillInstance[], w: number, h: number, i: number): { x: number; y: number; rot: Rot } | null {
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let r = 0; r < 4; r++) if (fits(skills, w, h, i, x, y, r as Rot)) return { x, y, rot: r as Rot };
  return null;
}
