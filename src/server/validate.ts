// Input checks. Everything from the client is untrusted: builds, names, ids, numbers.
import { createHash } from 'node:crypto';
import { HEROES_BY_ID } from '../sim/heroes';
import { BONUS_KINDS, MAX_BONUS, MAX_H, MAX_W, canHit, isShape, occupancy, validTarget } from '../sim/grid';
import { START_HP, damageFor, expandPrice, gridFor, incomeFor, priceOf, type RunState } from '../sim/run';
import { SKILLS, isVariant, lvOf } from '../sim/skills';
import type { Build, Mark, Rot, SkillInstance } from '../sim/types';

const MARKS: Mark[] = ['burn', 'echo', 'quick', 'steadfast'];
export const MAX_DAY = 20;

/**
 * First day whose fight can show the effects of โอกาสสุดท้าย (last chance: awaken, mark, supply row + 8 gold).
 * It needs a death first: losses on every day until the damage reaches START_HP, then the next day.
 */
export const LAST_CHANCE_DAY = (() => {
  let dmg = 0;
  for (let d = 1; d < 100; d++) if ((dmg += damageFor(d)) >= START_HP) return d + 1;
  return 100;
})();

/**
 * Most gold a run can have earned by the shop of `day` (best streak bonus every day, plus the last-chance supply).
 * Selling never pays back more than the item cost, so this bounds everything bought on the way.
 */
export function maxGoldBy(day: number): number {
  let g = 0;
  for (let d = 1; d <= day; d++) {
    const best = Math.max(...[d - 1, -(d - 1), 0].map((s) => incomeFor(d, s).bonus));
    g += incomeFor(d, 0).base + best;
  }
  return g + (day >= LAST_CHANCE_DAY ? 8 : 0);
}

/** Total price of `n` grid expansions (each costs more than the last). */
export const expandCost = (n: number) => {
  let c = 0;
  for (let i = 0; i < n; i++) c += expandPrice({ expands: i } as RunState);
  return c;
};

/** The least gold a placed block can have cost: Lv1 price, + the Lv2 upgrade (free with awaken), + the Lv3 upgrade. */
function minCost(k: Pick<SkillInstance, 'id' | 'v'>, day: number): number {
  const lv = lvOf(k.v);
  let c = priceOf({ id: k.id, v: '' });
  if (lv >= 2 && day < LAST_CHANCE_DAY) c += priceOf({ id: k.id, v: 'a' });
  if (lv >= 3) c += priceOf({ id: k.id, v: 'a1' });
  return c;
}

/**
 * Grid builds come from the client (Phase 2 moves run state to the server): check everything that can be checked,
 * and accept only what the run API (src/sim/run.ts, grid.ts) can produce for a fight on `day`:
 * - hero exists; skill ids exist, unique, hero-unique skills only for their hero; variant '' / a / b / a1 a2 b1 b2
 * - grid w × h: at least the day's base size (gridFor), at most MAX_W × MAX_H; growth past the base needs bought
 *   expansions (and one supply row from day LAST_CHANCE_DAY)
 * - every block: a shape from the skill's pool, rot 0–3, integer x/y, fully inside the grid, no overlaps;
 *   bag blocks (x < 0) never fight, so they are rejected
 * - connect bonuses: ≤ min(MAX_BONUS, 1 + level), known kind, valid target for the hero, not itself, no duplicate,
 *   +damage only on skills that can hit
 * - marks: at most one block, and only once a last chance was possible
 * - gold: blocks (cheapest way to their level) + grid expansions ≤ the most gold a run can have by that day
 *   (so day 1 fits at most two blocks, and too many / too high-level blocks for the day are rejected)
 */
export function validateBuild(x: unknown, day: number): Build | string {
  const b = x as Build;
  if (!b || typeof b !== 'object' || typeof b.hero !== 'string' || !Object.hasOwn(HEROES_BY_ID, b.hero)) return 'bad hero';
  const base = gridFor(day);
  if (!Number.isInteger(b.w) || !Number.isInteger(b.h) || b.w < base.w || b.h < base.h || b.w > MAX_W || b.h > MAX_H) return 'bad grid';
  if (!Array.isArray(b.skills) || b.skills.length > b.w * b.h) return 'bad skills';
  const late = day >= LAST_CHANCE_DAY;
  const skills: SkillInstance[] = [];
  let marks = 0;
  let gold = 0;
  for (const s of b.skills) {
    if (!s || typeof s !== 'object' || typeof s.id !== 'string' || !Object.hasOwn(SKILLS, s.id)) return 'unknown skill';
    const def = SKILLS[s.id];
    if (def.hero && def.hero !== b.hero) return 'skill not allowed for hero';
    if (!isVariant(s.v)) return 'bad level';
    if (s.mark !== undefined) {
      if (!MARKS.includes(s.mark) || !late) return 'bad mark';
      marks++;
    }
    if (typeof s.shape !== 'string' || !isShape(s.shape) || !def.shapes.includes(s.shape)) return 'bad shape';
    if (![0, 1, 2, 3].includes(s.rot) || !Number.isInteger(s.x) || !Number.isInteger(s.y) || s.x < 0 || s.y < 0) return 'bad position';
    if (s.x >= b.w || s.y >= b.h) return 'bad position';
    const bonus = s.bonus;
    if (!Array.isArray(bonus) || bonus.length > Math.min(MAX_BONUS, 1 + lvOf(s.v))) return 'bad bonus';
    const seen = new Set<string>();
    for (const x of bonus) {
      const t = typeof x?.t === 'string' ? x.t : '';
      if (!BONUS_KINDS.includes(x?.e) || t === s.id || !validTarget(t, b.hero)) return 'bad bonus';
      if (x.e === 'dmg' && !canHit(s.id)) return 'bad bonus';
      if (seen.has(t + '|' + x.e)) return 'bad bonus';
      seen.add(t + '|' + x.e);
    }
    gold += minCost(s, day);
    skills.push({
      id: s.id, v: s.v, ...(s.mark ? { mark: s.mark } : {}), shape: s.shape, rot: s.rot as Rot, x: s.x, y: s.y,
      bonus: bonus.map((x) => ({ t: String(x.t), e: x.e })),
    });
  }
  if (marks > 1) return 'bad mark';
  if (new Set(skills.map((s) => s.id)).size !== skills.length) return 'duplicate skill';
  const placed = occupancy(skills, b.w, b.h);
  if (typeof placed === 'string') return 'bad placement';
  // grid growth: bought expansions (one row may come from the last-chance supply instead)
  const expansions = Math.max(0, b.w - base.w + b.h - base.h - (late && b.h > base.h ? 1 : 0));
  gold += expandCost(expansions);
  if (gold > maxGoldBy(day)) return 'too much for the day';
  const look = Number.isInteger(b.look) && b.look! > 0 && b.look! < 2 ** 32 ? b.look : undefined;
  return { hero: b.hero, w: b.w, h: b.h, skills, ...(look ? { look } : {}) };
}

/** Run ids and player ids: 1–64 chars of letters, digits, `-` and `_`. */
export function cleanId(x: unknown): string | null {
  const s = typeof x === 'string' ? x : typeof x === 'number' ? String(x) : '';
  // ids become object keys (db.tracks / db.players): never allow keys that reach Object.prototype
  if (s === '__proto__' || s === 'constructor' || s === 'prototype') return null;
  return /^[\w-]{1,64}$/.test(s) ? s : null;
}

export const intIn = (x: unknown, lo: number, hi: number): number | null =>
  Number.isInteger(x) && (x as number) >= lo && (x as number) <= hi ? (x as number) : null;

/** Client rating is untrusted: finite, clamped to a sane range, default 1000. */
export const cleanRating = (x: unknown) => {
  const n = typeof x === 'string' && x !== '' ? Number(x) : x;
  return typeof n === 'number' && Number.isFinite(n) ? Math.round(Math.min(3000, Math.max(0, n))) : 1000;
};

/** Names the client uses when the player typed nothing. */
const DEFAULT_NAMES = new Set(['', 'ผู้เล่น', 'player', 'Player']);
export const isDefaultName = (n: string) => DEFAULT_NAMES.has(n.trim());

/** Stable unique default, e.g. `Mochi-4821`, derived from the player id (or the run id when there is none). */
export function defaultName(key: string) {
  const h = createHash('sha1').update('mochi-name:' + key).digest().readUInt32BE(0);
  return `Mochi-${1000 + (h % 9000)}`;
}

/** control characters, zero-width and bidi overrides */
const BAD_CHARS = new RegExp('[\u0000-\u001f\u007f​-‏ -‮]', 'g');

/** Trimmed, no control characters, max 24 chars; empty / "ผู้เล่น" becomes a unique default. */
export function cleanName(x: unknown, key: string) {
  const n = (typeof x === 'string' ? x : '').replace(BAD_CHARS, '').trim().slice(0, 24);
  return isDefaultName(n) ? defaultName(key) : n;
}
