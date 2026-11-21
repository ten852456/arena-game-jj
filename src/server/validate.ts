// Input checks. Everything from the client is untrusted: builds, names, ids, numbers.
import { createHash } from 'node:crypto';
import { HEROES_BY_ID } from '../sim/heroes';
import { BONUS_KINDS, MAX_BONUS, validTarget } from '../sim/links';
import { LV3_DAY, MAX_SLOTS, PRICES, START_HP, damageFor, incomeFor, slotsFor } from '../sim/run';
import { SKILLS, isVariant, lvOf } from '../sim/skills';
import type { Build, Mark } from '../sim/types';

const MARKS: Mark[] = ['burn', 'echo', 'quick', 'steadfast'];
export const MAX_DAY = 20;

/**
 * A run's record before `day`: the result of each earlier day (1 = won, 0 = lost or draw). The server knows it from
 * the fights it ran (RunTrack.days); scripts that have none use the best honest record (every day won).
 */
export type RunRecord = (0 | 1)[];
const allWins = (day: number): RunRecord => Array.from({ length: Math.max(0, day - 1) }, () => 1);

/**
 * What a run with this record can have had in its shop on `day` (sim v15, exact, run.ts rules): the day-1 gold plus each
 * later day's income with the streak bonus it really had, and whether the last chance (เสบียงสุดท้าย +8 gold and +1 slot,
 * or ตื่นพลัง: every Lv1 skill → Lv2) was reached (HP ≤ 0 once). Supply and Awaken are one choice, never both.
 */
export function runMax(day: number, rec: RunRecord = allWins(day)) {
  let gold = 0;
  let streak = 0;
  let hp = START_HP;
  let lastChance = false;
  for (let d = 1; d <= day; d++) {
    const inc = incomeFor(d, streak);
    gold += inc.base + inc.bonus;
    if (d === day) break;
    const won = rec[d - 1] === 1;
    streak = won ? (streak > 0 ? streak + 1 : 1) : streak < 0 ? streak - 1 : -1;
    if (!won) hp -= damageFor(d);
    if (hp <= 0 && !lastChance) {
      lastChance = true;
      hp = 1;
    }
  }
  return { gold, lastChance };
}
/** Most gold a run can have earned by `day`'s shop (all days won, no last chance unless the record says so). */
export const goldCap = (day: number, rec?: RunRecord) => runMax(day, rec).gold;
/** Least gold a build can have cost: each skill's Lv1 + upgrades at shop prices, plus every slot above the day's own. */
export function buildCost(b: Build, day: number, freeSlots = 0) {
  let g = 0;
  for (const s of b.skills) {
    const lv = lvOf(s.v);
    for (let l = 1; l <= lv; l++) g += PRICES[l - 1];
    if (SKILLS[s.id]?.hero) g += 1;
  }
  // slot prices are 4, 6, 8 … (the last chance's supply can give one for free)
  const extra = Math.max(0, b.skills.length - slotsFor(day) - freeSlots);
  for (let i = 0; i < extra; i++) g += 4 + 2 * i;
  return g;
}

/**
 * Builds come from the client: check the shape, then whether this run could own it on this day: day 1 = the hero's
 * fixed shop, no Lv3 before LV3_DAY, at most 2 bonuses per skill, marks only after a last chance (or all Lv3), and the
 * build's least cost within the gold this run's record can have earned (`rec`; default = every day won). A full server-authoritative
 * run (server rolls the shop and replays every purchase) would close the rest; see docs/DESIGN_LINES_ULT.md §10c.
 */
export function validateBuild(x: unknown, day: number, rec?: RunRecord): Build | string {
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
  // plausibility for this day, from the run's record (sim v15: exact caps, see runMax)
  const { gold, lastChance } = runMax(day, rec);
  const lvs = skills.map((s) => lvOf(s.v));
  if (day <= 1) {
    // day 1 is the hero's fixed shop: Lv1 only, only those cards, and at most the day's slots
    const shop = HEROES_BY_ID[b.hero].day1;
    if (lvs.some((l) => l > 1)) return 'implausible: upgrades on day 1';
    if (skills.some((s) => !shop.includes(s.id))) return 'implausible: not in the day-1 shop';
  }
  if (day < LV3_DAY && lvs.some((l) => l >= 3)) return 'implausible: Lv3 before day ' + LV3_DAY;
  if (skills.some((s) => (s.bonus?.length ?? 0) > 2)) return 'implausible: too many bonuses';
  // marks come from the last chance (one) or from moon wishes once every skill is Lv3
  const marks = skills.filter((s) => s.mark).length;
  if (marks > (lastChance ? 1 : 0) && !lvs.every((l) => l >= 3)) return 'implausible: too many marks';
  // Awaken (Lv1 → Lv2 for every skill) is worth at most one Lv2 price per skill; Supply is 8 gold + 1 slot: allow the better one
  const bonusGold = lastChance ? Math.max(8, PRICES[1] * skills.length) : 0;
  if (buildCost({ hero: b.hero, skills }, day, lastChance ? 1 : 0) > gold + bonusGold) return 'implausible: costs more gold than this run can have';
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
