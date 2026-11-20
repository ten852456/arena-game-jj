// Input checks. Everything from the client is untrusted: builds, names, ids, numbers.
import { createHash } from 'node:crypto';
import { HEROES_BY_ID } from '../sim/heroes';
import { BONUS_KINDS, MAX_BONUS, validTarget } from '../sim/links';
import { DAY1_GOLD, LV3_DAY, MAX_SLOTS, PRICES, incomeFor, slotsFor } from '../sim/run';
import { SKILLS, isVariant, lvOf } from '../sim/skills';
import type { Build, Mark } from '../sim/types';

const MARKS: Mark[] = ['burn', 'echo', 'quick', 'steadfast'];
export const MAX_DAY = 20;

/** Most gold a run can have earned by the end of `day`'s shop: base income + the biggest streak bonus every day + the last-chance supply. */
export function goldCap(day: number) {
  let g = DAY1_GOLD;
  for (let d = 2; d <= day; d++) g += incomeFor(d, 5).base + incomeFor(d, 5).bonus;
  // the last chance can give 8 gold, or Awaken (every Lv1 skill → Lv2 for free; a first death is day 5 at the earliest)
  return g + 8 + (day >= 5 ? MAX_SLOTS * PRICES[1] : 0);
}
/** Least gold a build can have cost: each skill's Lv1 + upgrades at shop prices, plus the slots above the day's own. */
export function buildCost(b: Build, day: number) {
  let g = 0;
  for (const s of b.skills) {
    const lv = lvOf(s.v);
    for (let l = 1; l <= lv; l++) g += PRICES[l - 1];
    if (SKILLS[s.id]?.hero) g += 1;
  }
  // one extra slot can come free from the last chance (เสบียงสุดท้าย); slot prices are 4, 6, 8 …
  const extra = Math.max(0, b.skills.length - slotsFor(day) - 1);
  for (let i = 0; i < extra; i++) g += 4 + 2 * i;
  return g;
}

/**
 * Builds come from the client: check the shape, then whether a real run could own it on this day (sim v14 plausibility
 * caps): Lv1 only on day 1, no Lv3 before LV3_DAY, at most 2 bonuses per skill, at most 1 mark unless every skill is
 * Lv3 (moon wishes), and the build's least cost within the most gold a run can earn by then. A full server-authoritative
 * run (server rolls the shop and replays every purchase) would close the rest; see docs/DESIGN_LINES_ULT.md §10c.
 */
export function validateBuild(x: unknown, day: number): Build | string {
  const b = x as Build;
  if (!b || typeof b !== 'object' || !HEROES_BY_ID[b.hero]) return 'bad hero';
  // bought slots can add more than the day gives, but never past MAX_SLOTS
  if (!Array.isArray(b.skills) || b.skills.length > MAX_SLOTS || b.skills.length > slotsFor(day, MAX_SLOTS)) return 'bad skills';
  const skills = [];
  for (const s of b.skills) {
    if (!SKILLS[s?.id]) return 'unknown skill';
    if (SKILLS[s.id].hero && SKILLS[s.id].hero !== b.hero) return 'skill not allowed for hero';
    if (!isVariant(s.v)) return 'bad level';
    if (s.mark !== undefined && !MARKS.includes(s.mark)) return 'bad mark';
    const bonus = s.bonus ?? [];
    if (!Array.isArray(bonus) || bonus.length > MAX_BONUS) return 'bad bonus';
    for (const x of bonus) if (!BONUS_KINDS.includes(x?.e) || !validTarget(String(x?.t), b.hero)) return 'bad bonus';
    skills.push({
      id: s.id, v: s.v, ...(s.mark ? { mark: s.mark } : {}),
      ...(bonus.length ? { bonus: bonus.map((x) => ({ t: String(x.t), e: x.e })) } : {}),
    });
  }
  if (new Set(skills.map((s) => s.id)).size !== skills.length) return 'duplicate skill';
  // plausibility for this day
  const lvs = skills.map((s) => lvOf(s.v));
  if (day <= 1 && lvs.some((l) => l > 1)) return 'implausible: upgrades on day 1';
  if (day < LV3_DAY && lvs.some((l) => l >= 3)) return 'implausible: Lv3 before day ' + LV3_DAY;
  if (skills.some((s) => (s.bonus?.length ?? 0) > 2)) return 'implausible: too many bonuses';
  const marks = skills.filter((s) => s.mark).length;
  if (marks > 1 && !lvs.every((l) => l >= 3)) return 'implausible: too many marks';
  if (skills.length > slotsFor(day) + 1 && day <= 2) return 'implausible: too many slots';
  if (buildCost({ hero: b.hero, skills }, day) > goldCap(day)) return 'implausible: costs more gold than a run can have';
  const look = Number.isInteger(b.look) && b.look! > 0 && b.look! < 2 ** 32 ? b.look : undefined;
  return { hero: b.hero, skills, ...(look ? { look } : {}) };
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
const BAD_CHARS = new RegExp('[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e]', 'g');

/** Trimmed, no control characters, max 24 chars; empty / "ผู้เล่น" becomes a unique default. */
export function cleanName(x: unknown, key: string) {
  const n = (typeof x === 'string' ? x : '').replace(BAD_CHARS, '').trim().slice(0, 24);
  return isDefaultName(n) ? defaultName(key) : n;
}
