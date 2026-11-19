// Balance targets for the simulator (scripts/sim.ts).
// lengthTarget is a copy of the one in scripts/balance.ts (importing balance.ts would run that whole script);
// keep the two in sync, or make balance.ts import this one.

/** Fight length targets in seconds: [min, max] per day range. */
export const lengthTarget = (day: number): [number, number] => (day <= 3 ? [7, 13] : day <= 7 ? [10, 18] : [15, 26]);

export const TARGETS = {
  /** archetype vs archetype win rate (off-diagonal) */
  arch: 0.65,
  /** single hero vs hero pairs may lean a bit more (designed counters) */
  hero: 0.7,
  /** best − worst hero overall win rate */
  heroSpread: 0.15,
  /** best − worst hero "reach 8 wins" rate in bot runs */
  runSpread: 0.1,
  /** no hero should own more than this share of all 8-win runs */
  runShare: 0.5,
  /** share of fighter-sides that cast 0 skills in a fight (control lock / instant KO) */
  zeroSkill: 0.03,
  /** share of fights (per day) ended by fatigue */
  fatigue: 0.2,
  /** tiers: hard beats normal and normal beats easy at least this often (averaged over days) */
  tierMargin: 0.55,
} as const;
