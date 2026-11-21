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
 * A run's record before `day`: the result of each earlier day (1 = won, 0 = lost, 2 = draw). The server knows it from
 * the fights it ran (RunTrack.days); scripts that have none use the best honest record (every day won).
 */
export type DayResult = 0 | 1 | 2;
export type RunRecord = DayResult[];
const allWins = (day: number): RunRecord => Array.from({ length: Math.max(0, day - 1) }, () => 1);
/** the last chance's choice (run.ts chooseLastChance); 'none' = no last chance yet */
export type LastChoice = 'none' | 'supply' | 'awaken' | 'mark';

/**
 * What a run with this record can have had by `day`'s shop, following run.ts recordResult exactly: the day-1 gold plus
 * each later day's income with the streak bonus it really had (a win extends a win streak, a loss a loss streak, a draw
 * resets it and costs no HP), and the day of the first death (HP ≤ 0 → the last chance), if any.
 */
export function runMax(day: number, rec: RunRecord = allWins(day)) {
  let gold = 0;
  let streak = 0;
  let hp = START_HP;
  let deathDay = 0;
  for (let d = 1; d <= day; d++) {
    const inc = incomeFor(d, streak);
    gold += inc.base + inc.bonus;
    if (d === day) break;
    const r = rec[d - 1] ?? 0;
    if (r === 1) streak = streak > 0 ? streak + 1 : 1;
    else if (r === 2) streak = 0;
    else {
      streak = streak < 0 ? streak - 1 : -1;
      hp -= damageFor(d);
    }
    if (hp <= 0 && !deathDay) {
      deathDay = d;
      hp = 1;
    }
  }
  return { gold, lastChance: deathDay > 0, deathDay };
}
/** Most gold a run can have earned by `day`'s shop (all days won unless a record is given). */
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

/** One way the run's last chance can have gone, and what it allows: gold cap for n skills, free slots, free marks. */
export interface Allowance {
  opt: LastChoice;
  cap: (n: number) => number;
  freeSlots: number;
  marks: number;
}
/**
 * The ways this run can stand on `day` (sim v15, security review): no last chance → one way. After a death, Supply
 * (+8 gold, +1 slot), Awaken (every Lv1 skill → Lv2: worth one Lv2 price per skill it could have had, at most the slots of
 * the death day + 1) or Mark (one mark): ONE of them, never two. `choice` = what the server already pinned down.
 */
export function allowances(day: number, rec?: RunRecord, choice?: LastChoice): Allowance[] {
  const { gold, lastChance, deathDay } = runMax(day, rec);
  if (!lastChance) return [{ opt: 'none', cap: () => gold, freeSlots: 0, marks: 0 }];
  const all: Allowance[] = [
    { opt: 'supply', cap: () => gold + 8, freeSlots: 1, marks: 0 },
    { opt: 'awaken', cap: (n) => gold + PRICES[1] * Math.min(n, slotsFor(deathDay) + 1), freeSlots: 0, marks: 0 },
    { opt: 'mark', cap: () => gold, freeSlots: 0, marks: 1 },
  ];
  return choice && choice !== 'none' ? all.filter((a) => a.opt === choice) : all;
}

/** price paid for a skill from level `from` (0 = not owned) up to its level now */
const pricesFrom = (id: string, from: number, to: number) => {
  let g = from === 0 && SKILLS[id]?.hero ? 1 : 0;
  for (let l = from + 1; l <= to; l++) g += PRICES[l - 1];
  return g;
};
const sameBonus = (a: Build['skills'][number], b: Build['skills'][number]) => JSON.stringify(a.bonus ?? []) === JSON.stringify(b.bonus ?? []);
/**
 * Least net gold a run spent between its last fought build and today's (the server keeps the run's last build):
 * new skills at full price, level-ups at upgrade prices (a skill whose branch or connect bonuses changed was sold and
 * bought again), sold skills refund 1 / 2 / 3 by level, and slots above the day's own at 4, 6, 8 … (a slot bought once
 * stays bought: `paidSlots`). The running total must stay within what the run can have earned.
 */
export function spendDelta(prev: Build | undefined, cur: Build, day: number, paidSlots = 0, freeSlots = 0) {
  let g = 0;
  const kept = new Set<string>();
  for (const k of cur.skills) {
    const p = prev?.skills.find((x) => x.id === k.id);
    const continued = p && sameBonus(p, k) && k.v.startsWith(p.v) && lvOf(k.v) >= lvOf(p.v);
    if (continued) {
      kept.add(k.id);
      g += pricesFrom(k.id, lvOf(p!.v), lvOf(k.v));
    } else g += pricesFrom(k.id, 0, lvOf(k.v));
  }
  for (const p of prev?.skills ?? []) if (!kept.has(p.id)) g -= lvOf(p.v);
  const need = Math.max(0, cur.skills.length - slotsFor(day) - freeSlots);
  for (let i = paidSlots; i < need; i++) g += 4 + 2 * i;
  return { gold: g, paidSlots: Math.max(paidSlots, need) };
}

/**
 * Day-by-day spend check for a run (server fight.ts, and the honest-run test): which last-chance ways still fit when
 * this build is added to what the run already spent. Returns the ways that fit (empty = reject) with their new totals.
 */
export function spendCheck(
  prev: { build?: Build; spent?: number; paidSlots?: number } | undefined, build: Build, day: number, rec?: RunRecord, choice?: LastChoice,
) {
  // ONE last-chance way must allow the whole build at once (security review): its marks, the build's own cost and the
  // running spend are all checked against the same way, never one way for one check and another for the next
  const lvs = build.skills.map((k) => lvOf(k.v));
  const marks = build.skills.filter((k) => k.mark).length;
  const allLv3 = lvs.length > 0 && lvs.every((l) => l >= 3);
  return allowances(day, rec, choice)
    .filter((a) => allLv3 || marks <= a.marks)
    .filter((a) => buildCost(build, day, a.freeSlots) <= a.cap(build.skills.length))
    .map((a) => {
      const d = spendDelta(prev?.build, build, day, prev?.paidSlots ?? 0, a.freeSlots);
      return { opt: a.opt, spent: (prev?.spent ?? 0) + d.gold, paidSlots: d.paidSlots, cap: a.cap(build.skills.length) };
    })
    .filter((x) => x.spent <= x.cap);
}

export function validateBuild(x: unknown, day: number, rec?: RunRecord, choice?: LastChoice): Build | string {
  const b = x as Build;
  if (!b || typeof b !== 'object' || !HEROES_BY_ID[b.hero]) return 'bad hero';
  // bought slots can add more than the day gives, but never past MAX_SLOTS
  if (!Array.isArray(b.skills) || b.skills.length > MAX_SLOTS || b.skills.length > slotsFor(day, MAX_SLOTS)) return 'bad skills';
  const skills: Build['skills'] = [];
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
  // plausibility for this day, from the run's record (sim v15: exact caps, see runMax / allowances)
  const lvs = skills.map((s) => lvOf(s.v));
  if (day <= 1) {
    // day 1 is the hero's fixed shop: Lv1 only, only those cards, and at most the day's slots
    const shop = HEROES_BY_ID[b.hero].day1;
    if (lvs.some((l) => l > 1)) return 'implausible: upgrades on day 1';
    if (skills.some((s) => !shop.includes(s.id))) return 'implausible: not in the day-1 shop';
  }
  if (day < LV3_DAY && lvs.some((l) => l >= 3)) return 'implausible: Lv3 before day ' + LV3_DAY;
  if (skills.some((s) => (s.bonus?.length ?? 0) > 2)) return 'implausible: too many bonuses';
  // marks come from the last chance (one, if that was its choice) or from moon wishes once every skill is Lv3
  const marks = skills.filter((s) => s.mark).length;
  const allLv3 = lvs.every((l) => l >= 3);
  const ways = allowances(day, rec, choice).filter(
    (a) => (allLv3 || marks <= a.marks) && buildCost({ hero: b.hero, skills }, day, a.freeSlots) <= a.cap(skills.length),
  );
  if (!ways.length) return marks && !allLv3 ? 'implausible: too many marks' : 'implausible: costs more gold than this run can have';
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
