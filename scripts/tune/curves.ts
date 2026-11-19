// Intended power curves (docs/SKILL_TREE.md "Intended power curves"): who should be strong when.
// The tuner reads a target band per hero per scanned day; a hero inside its band costs nothing.
// Design goal: variety and distinct curves, not equal win rates.

export const CURVE_DAYS = [3, 6, 9, 12, 15];

/** Curve shapes: win rate vs the field (%) on days 3 / 6 / 9 / 12 / 15. Centered so every day averages ≈ 50. */
export const SHAPES = {
  /** strong on the first days, fades late */
  early: [57, 56, 52, 46, 42],
  /** peaks around day 6–9, fades late */
  earlyMid: [52, 57, 55, 47, 42],
  /** grows into the mid / late game */
  midLate: [45, 48, 53, 55, 55],
  /** steady, best late */
  steadyLate: [48, 49, 50, 53, 57],
  /** weak start, strongest at the end */
  late: [43, 45, 48, 54, 60],
} as const;
export type Shape = keyof typeof SHAPES;

export const HERO_CURVE: Record<string, Shape> = {
  duelist: 'early',
  witch: 'early',
  assassin: 'earlyMid',
  chrono: 'midLate',
  thornguard: 'midLate',
  knight: 'steadyLate',
  berserker: 'late',
  pyro: 'late',
};

/** Half-width of the band around the curve (win-rate points): inside it costs nothing. */
export const BAND = 5;

/** Target center per hero per day, shifted so the 8 heroes average exactly 50 on each day. */
export function curveTargets(): Record<string, Record<number, number>> {
  const heroes = Object.keys(HERO_CURVE);
  const out: Record<string, Record<number, number>> = {};
  CURVE_DAYS.forEach((d, i) => {
    const mean = heroes.reduce((n, h) => n + SHAPES[HERO_CURVE[h]][i], 0) / heroes.length;
    for (const h of heroes) (out[h] ??= {})[d] = SHAPES[HERO_CURVE[h]][i] - (mean - 50);
  });
  return out;
}
