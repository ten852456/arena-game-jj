// Balance targets for the simulator (scripts/sim.ts).
// lengthTarget is a copy of the one in scripts/balance.ts (importing balance.ts would run that whole script);
// keep the two in sync, or make balance.ts import this one.

/** Fight length targets in seconds: [min, max] per day range. */
export const lengthTarget = (day: number): [number, number] => (day <= 3 ? [9, 16] : day <= 7 ? [14, 24] : [20, 32]);

// Design goal (19 Nov 2026, product owner): variety and distinct power curves, NOT equal win rates.
// Heroes may be strong early, mid or late; targets only catch dead heroes, hard counters and lock-ups.
export const TARGETS = {
  /** archetype vs archetype win rate (off-diagonal), any day */
  arch: 0.75,
  /** single hero vs hero pairs, any day */
  hero: 0.75,
  /** best − worst hero overall win rate on one day (loose: curves are meant to differ by day) */
  heroSpread: 0.3,
  /** every hero reaches the run's win target in at least this share of bot runs (no dead hero) */
  runMin: 0.15,
  /** and in at most this share (no must-pick hero) */
  runMax: 0.45,
  /** no hero should own more than this share of all winning runs */
  runShare: 0.3,
  /** share of fighter-sides that cast 0 skills in a fight (control lock / instant KO) */
  zeroSkill: 0.03,
  /** share of fights (per day) ended by fatigue */
  fatigue: 0.2,
  /** tiers: hard beats normal and normal beats easy at least this often (averaged over days) */
  tierMargin: 0.55,
} as const;
