// Matchmaking: same day, closest rating, no repeat opponents within a run, AI with a difficulty tier as the fallback.
import { randomAiBuild } from '../sim/bot';
import { HEROES_BY_ID } from '../sim/heroes';
import { SKILLS } from '../sim/skills';
import { ARCHES, type Archetype, type Build } from '../sim/types';
import { db, type BotTier, type RunTrack, type Snapshot } from './store';

/** Rating windows tried in order: low-rated builds never get matched against far stronger ones. */
export const RATING_WINDOWS = [200, 350, 500];
/** pick at random among this many closest candidates */
const POOL = 5;

/** Main archetype of a build: its skills' archetypes, with the hero's archetype counted 1.5×. */
export function archetypeOf(b: Build): Archetype {
  const hero = HEROES_BY_ID[b.hero];
  const n: Record<string, number> = { [hero.arch]: 1.5 };
  for (const s of b.skills) {
    const a = SKILLS[s.id]?.arch;
    if (a && a !== 'none') n[a] = (n[a] ?? 0) + 1;
  }
  return ARCHES.reduce((best, a) => ((n[a] ?? 0) > (n[best] ?? 0) ? a : best), hero.arch);
}

/** Current streak from a run's per-day results: +n wins in a row, -n losses in a row. */
export function streakOf(t?: RunTrack): number {
  if (!t) return 0;
  const days = Object.keys(t.days).map(Number).sort((a, b) => b - a);
  let s = 0;
  for (const d of days) {
    const w = t.days[d] === 1;
    if (s === 0) s = w ? 1 : -1;
    else if (w === s > 0) s += s > 0 ? 1 : -1;
    else break;
  }
  return s;
}

/** AI difficulty: easy while learning (days 1–2) or when struggling, hard for strong players / win streaks. */
export function tierFor(day: number, rating: number, streak: number): BotTier {
  if (day <= 2) return 'easy';
  if (streak >= 3 || rating >= 1120) return 'hard';
  if (streak <= -2 || rating < 940) return 'easy';
  return 'normal';
}

// TODO(bot tier): src/sim/bot.ts is getting an optional last param `tier` (+ `export type BotTier`).
// Until that lands, call through a looser signature so this still compiles; afterwards replace with
// `import { randomAiBuild, type BotTier } from '../sim/bot'` and call `randomAiBuild(day, seed, tier)` directly.
const randomAiBuildTiered = randomAiBuild as (day: number, seed: number, tier?: BotTier) => Build;
export const aiBuildFor = (day: number, seed: number, tier: BotTier): Build => randomAiBuildTiered(day, seed, tier);

export interface MatchQuery {
  day: number;
  rating: number;
  runId: string;
  playerId?: string;
  track?: RunTrack;
}

/** Snapshots this run may meet: same day, not itself / its own player, not already met in this run. */
function eligible(q: MatchQuery): Snapshot[] {
  const seenSnaps = new Set(q.track?.snaps ?? []);
  const seenRuns = new Set(q.track?.opps ?? []);
  return db.snapshots.filter(
    (s) =>
      s.day === q.day &&
      s.runId !== q.runId &&
      !(q.playerId && s.playerId === q.playerId) &&
      !seenSnaps.has(s.id) &&
      !seenRuns.has(s.runId),
  );
}

/**
 * Candidates for a fight: the narrowest rating window that has any, closest first.
 * Empty `pool` means the fight goes to an AI.
 */
export function candidates(q: MatchQuery): { pool: Snapshot[]; window: number | null } {
  const all = eligible(q);
  for (const w of RATING_WINDOWS) {
    const pool = all.filter((s) => Math.abs(s.rating - q.rating) <= w);
    if (pool.length) return { pool: pool.sort((a, b) => Math.abs(a.rating - q.rating) - Math.abs(b.rating - q.rating)), window: w };
  }
  return { pool: [], window: null };
}

export const closest = (pool: Snapshot[]) => pool.slice(0, POOL);
