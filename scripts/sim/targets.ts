// Balance targets for the simulator (scripts/sim.ts).
// lengthTarget is a copy of the one in scripts/balance.ts (importing balance.ts would run that whole script);
// keep the two in sync, or make balance.ts import this one.

/** Fight length targets in seconds: [min, max] per day range. */
export const lengthTarget = (day: number): [number, number] => (day <= 3 ? [7, 13] : day <= 7 ? [10, 18] : [15, 26]);

// Design goal (19 Nov 2026, product owner): variety and distinct power curves, NOT equal win rates.
// Heroes may be strong early, mid or late; targets only catch dead heroes, hard counters and lock-ups.
export const TARGETS = {
  /** line vs line win rate (off-diagonal, by hero main line), any day */
  line: 0.75,
  /** every hero's overall win rate on each matchup day */
  heroLo: 0.45,
  heroHi: 0.55,
  /** each designed counter pair ("beats", BEATS below), averaged over the days */
  beatsLo: 0.53,
  beatsHi: 0.58,
  /** ultimate fires in at least this share of the fights where it is unlocked (ultLow heroes: ultMinLow) */
  ultFire: 0.75,
  ultFireLow: 0.5,
  /** median fire time as a share of fight length */
  ultTimeLo: 0.4,
  ultTimeHi: 0.7,
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

/** The counter web (docs/DESIGN_LINES_ULT.md §3, soft): each line beats these two. */
export const BEATS: Record<string, [string, string]> = {
  hit: ['heal', 'poison'],
  dodge: ['hit', 'ice'],
  shield: ['hit', 'ice'],
  heal: ['burn', 'wind'],
  burn: ['shield', 'dodge'],
  poison: ['shield', 'dodge'],
  ice: ['wind', 'heal'],
  wind: ['poison', 'burn'],
  gold: ['dodge', 'heal'],
  time: ['ice', 'wind'],
};
/** heroes whose ultimate is meant to fire less often (finisher / last stand) */
export const ULT_LOW = ['assassin', 'berserker'];
