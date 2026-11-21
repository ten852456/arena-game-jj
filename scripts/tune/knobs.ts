// The knobs the tuner may turn: a key of src/sim/tuning.ts, its bounds and the step it is rounded to.
// Bounds are deliberately tight (≈ ±25%): the tuner nudges the design, it does not redesign it.
import { TUNING, type TuningKey } from '../../src/sim/tuning';
import { HEROES } from '../../src/sim/heroes';
import { LINES } from '../../src/sim/types';

export interface Knob {
  key: TuningKey;
  lo: number;
  hi: number;
  /** values are rounded to multiples of this (1 = integer) */
  step: number;
  why: string;
}

const around = (key: TuningKey, rel: number, step: number, why: string): Knob => {
  const v = TUNING[key];
  return { key, lo: +(v * (1 - rel)).toFixed(4), hi: +(v * (1 + rel)).toFixed(4), step, why };
};

export const KNOBS: Knob[] = [
  { key: 'run.startHp', lo: 16, hi: 22, step: 1, why: 'reach-10 rate of all heroes (run difficulty)' },
  { key: 'run.lossEvery', lo: 2, hi: 4, step: 1, why: 'how fast the HP lost per defeat rises (2→5)' },
  { key: 'hp.early', lo: 0.85, hi: 1.25, step: 0.01, why: 'fight length days 1–3' },
  { key: 'hp.mid', lo: 0.85, hi: 1.25, step: 0.01, why: 'fight length days 4–7' },
  { key: 'hp.late', lo: 0.85, hi: 1.25, step: 0.01, why: 'fight length day 8+' },
  { key: 'chainDecay', lo: 0.6, hi: 0.85, step: 0.05, why: 'trigger-chain power' },
  { key: 'engine', lo: 0.8, hi: 1.2, step: 0.05, why: 'engine skills power' },
  { key: 'control', lo: 0.8, hi: 1.2, step: 0.05, why: 'freeze / slow / delay length (0-skill, control heroes)' },
  ...LINES.flatMap((a) => [
    { key: `line.${a}.lv1` as TuningKey, lo: 0.6, hi: 1.6, step: 0.05, why: `${a} line shared skills, early (Lv1)` },
    { key: `line.${a}.lv3` as TuningKey, lo: 0.6, hi: 1.6, step: 0.05, why: `${a} line shared skills, late (Lv3)` },
  ]),
  ...HEROES.flatMap((h) => [
    { key: `uniq.${h.id}.lv1` as TuningKey, lo: 0.6, hi: 1.7, step: 0.05, why: `${h.id} unique skill Lv1 (early curve)` },
    { key: `uniq.${h.id}.lv3` as TuningKey, lo: 0.6, hi: 1.7, step: 0.05, why: `${h.id} unique skill Lv3 (late curve)` },
  ]),
  ...HEROES.map((h): Knob => ({ key: `cd.${h.id}` as TuningKey, lo: 0.8, hi: ['assassin', 'duelist', 'berserker', 'chrono'].includes(h.id) ? 1 : 1.2, step: 0.05, why: `${h.id} unique skill cooldown (short = early; 5 s uniques stay early hitters)` })),
  ...HEROES.map((h): Knob => {
    const v = TUNING[`hp.${h.id}` as TuningKey];
    return { key: `hp.${h.id}` as TuningKey, lo: +(v - 0.15).toFixed(2), hi: +(v + 0.15).toFixed(2), step: 0.02, why: `${h.id} max HP` };
  }),
  around('knight.shield', 0.5, 0.02, 'knight start shield'),
  { key: 'assassin.first', lo: 1.3, hi: 2, step: 0.1, why: 'assassin first-hit burst (early)' },
  { key: 'assassin.every', lo: 0, hi: 6, step: 1, why: 'assassin: every Nth hit bursts too (late scaling)' },
  { key: 'duelist.regen', lo: 3, hi: 10, step: 1, why: 'duelist: +1 dodge every N seconds (late scaling)' },
  { key: 'duelist.counter', lo: 1.2, hi: 2, step: 0.1, why: 'duelist counter hit after a dodge' },
  { key: 'thornguard.poison', lo: 1, hi: 4, step: 1, why: 'thornguard poison seconds per hit taken' },
  { key: 'poison.heal', lo: 0.4, hi: 0.8, step: 0.05, why: 'healing while poisoned' },
  { key: 'berserker.hits', lo: 4, hi: 6, step: 1, why: 'berserker hits taken per +1 พลัง (late)' },
  { key: 'pyro.burn', lo: 1.1, hi: 1.6, step: 0.1, why: 'pyro burn length' },
  { key: 'witch.freeze', lo: 0.1, hi: 0.6, step: 0.1, why: 'witch freeze bonus (s)' },
  { key: 'dodge.graze', lo: 0, hi: 0.4, step: 0.05, why: 'share of a dodged hit that still lands (soft 💨)' },
  { key: 'witch.wound', lo: 0, hi: 0.8, step: 0.1, why: 'witch: hits on a frozen enemy cut its healing (❄ > ❤)' },
  ...HEROES.map((h): Knob => ({ key: `aff.${h.id}` as TuningKey, lo: 1.15, hi: 1.4, step: 0.05, why: `${h.id} ถนัดสาย (line pull)` })),
  { key: 'shield.spend', lo: 0, hi: 0.5, step: 0.05, why: 'shield bash spends this share of the shield it used' },
  { key: 'shield.guard', lo: 0, hi: 0.35, step: 0.05, why: 'hits on a shielded fighter deal less (🛡 > ⚔)' },
  { key: 'burn.scorch', lo: 0, hi: 2, step: 0.25, why: 'burn ticks also burn shield away (🔥 > 🛡)' },
  { key: 'burn.shield', lo: 0.5, hi: 1, step: 0.05, why: 'shield gains while burning (🔥 > 🛡)' },
  // ultimates (sim v12): trigger amount and effect power per hero
  { key: 'ult.assassin.trig', lo: 0.2, hi: 0.5, step: 0.05, why: 'assassin ult: enemy HP share' },
  { key: 'ult.assassin.pow', lo: 0.15, hi: 0.6, step: 0.05, why: 'assassin ult: share of the HP the enemy has lost' },
  { key: 'ult.duelist.trig', lo: 2, hi: 8, step: 1, why: 'duelist ult: dodges' },
  { key: 'ult.duelist.pow', lo: 0.3, hi: 0.8, step: 0.05, why: 'duelist ult: haste' },
  { key: 'ult.knight.trig', lo: 0.05, hi: 0.4, step: 0.05, why: 'knight ult: shield gained / max HP' },
  { key: 'ult.knight.pow', lo: 0.8, hi: 2.5, step: 0.1, why: 'knight ult: × shield' },
  { key: 'ult.berserker.trig', lo: 0.15, hi: 0.5, step: 0.05, why: 'berserker ult: HP share' },
  { key: 'ult.berserker.pow', lo: 0.1, hi: 0.4, step: 0.05, why: 'berserker ult: heal share' },
  { key: 'ult.pyro.trig', lo: 2, hi: 6, step: 1, why: 'pyro ult: burn stacks' },
  { key: 'ult.pyro.pow', lo: 0.6, hi: 2, step: 0.1, why: 'pyro ult: × burn left' },
  { key: 'ult.thornguard.trig', lo: 4, hi: 16, step: 1, why: 'thornguard ult: hits taken' },
  { key: 'ult.thornguard.pow', lo: 2, hi: 7, step: 0.5, why: 'thornguard ult: seconds' },
  { key: 'ult.witch.trig', lo: 2, hi: 8, step: 1, why: 'witch ult: ice casts' },
  { key: 'ult.witch.pow', lo: 1, hi: 3, step: 0.25, why: 'witch ult: freeze seconds' },
  { key: 'ult.chrono.trig', lo: 2, hi: 8, step: 1, why: 'chrono ult: slows / delays landed' },
  { key: 'ult.chrono.pow', lo: 0.2, hi: 0.8, step: 0.05, why: 'chrono ult: cooldowns jump forward by this share' },
];

/** Default (current) value of each knob. */
export const x0 = () => KNOBS.map((k) => TUNING[k.key]);
/** Round to the knob's step and clamp into its bounds. */
export const quantize = (k: Knob, v: number) => {
  const r = Math.round(Math.min(k.hi, Math.max(k.lo, v)) / k.step) * k.step;
  return +r.toFixed(4);
};
/** knob values ↔ normalized [0, 1] coordinates the optimizer works in */
export const toUnit = (xs: number[]) => xs.map((v, i) => (v - KNOBS[i].lo) / (KNOBS[i].hi - KNOBS[i].lo));
export const fromUnit = (us: number[]) => us.map((u, i) => quantize(KNOBS[i], KNOBS[i].lo + u * (KNOBS[i].hi - KNOBS[i].lo)));
export const asTuning = (xs: number[]) => Object.fromEntries(KNOBS.map((k, i) => [k.key, xs[i]]));
