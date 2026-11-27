// "Watch builds": specific builds / patterns that must not get too strong (e.g. exploits found by tools/exploit*).
// Each one is fought against the tuner's matchup builds of every hero on its days (both sides); its win rate vs that
// field must stay ≤ max, otherwise the tuner adds WATCH_WEIGHT × (excess in points)² to the objective.
//
// To add one: push an entry below (a fixed Build, or a function of the day that returns one), then `npm run tune`.
// Skill variants: '' = Lv1, 'a' / 'b' = Lv2, 'a1' 'a2' 'b1' 'b2' = Lv3. Bonuses: see src/sim/types.ts (Bonus).
import type { Build } from '../../src/sim/types';

export interface WatchBuild {
  name: string;
  /** scanned days it is fought on */
  days: number[];
  /** highest allowed win rate vs the field (0..1) */
  max: number;
  build: Build | ((day: number) => Build);
}

export const WATCH_WEIGHT = 5;

export const WATCH: WatchBuild[] = [
  // Example (inactive): a double engine sandwich must stay ≤ 70% on days 9–15.
  // {
  //   name: 'gear sandwich',
  //   days: [9, 12, 15],
  //   max: 0.7,
  //   build: { hero: 'duelist', skills: [{ id: 'heavy', v: 'a1' }, { id: 'gear', v: 'a1' }, { id: 'flurry', v: 'a1' }, { id: 'overclock', v: 'a1' }, { id: 'charge', v: 'a1' }] },
  // },
];
