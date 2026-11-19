/**
 * Balance knobs in one place. The auto-tuner (`npm run tune`, see docs/TUNING.md) searches over these values and
 * `npm run tune -- --apply` rewrites the numbers between the <tuned> markers below.
 *
 * - skills.ts scales its base numbers (the literals in SKILL_LIST) by the skill multipliers when it loads:
 *   hits, shields, heals, burns and charge get `arch.*` (shared skills) or `uniq.*` (hero-unique skills),
 *   interpolated by level (Lv2 = halfway between Lv1 and Lv3); freeze / slow / delay seconds get `control`,
 *   engine power gets `engine`, hero-unique cooldowns get `cd.<hero>`. Scaled values are rounded (integers stay integers), so the UI shows the real numbers.
 * - heroes.ts reads the hero HP and passive values; combat.ts the HP curve and chain decay; run.ts the run HP and loss.
 *
 * All values at 1 / their v10 numbers reproduce sim v10 exactly. Change a value → bump SIM_VERSION in combat.ts.
 * Pure data, no imports (safe for server, browser and worker threads).
 */

// <tuned>
export const TUNING = {
  // ---- run (run.ts) ----
  /** HP at the start of a run */
  'run.startHp': 17,
  /** HP lost on a defeat = min(5, 1 + ceil(day / lossEvery)) */
  'run.lossEvery': 3,
  // ---- base HP per day (combat.ts HP_BY_DAY × this) ----
  /** days 1–3 */
  'hp.early': 1.06,
  /** days 4–7 */
  'hp.mid': 1.04,
  /** day 8+ */
  'hp.late': 1.06,
  // ---- combat rules (numbers only) ----
  /** each trigger-chain step after the first fires ×this */
  'chainDecay': 0.75,
  /** engine skill power (ฟันเฟือง / เร่งเครื่อง) × this */
  'engine': 1,
  /** freeze / slow / delay seconds of every skill × this */
  'control': 1.05,
  // ---- shared skills of each archetype: power multiplier at Lv1 and Lv3 ----
  'arch.tank.lv1': 1,
  'arch.tank.lv3': 1,
  'arch.burst.lv1': 1,
  'arch.burst.lv3': 1,
  'arch.scaling.lv1': 1,
  'arch.scaling.lv3': 1,
  'arch.control.lv1': 1,
  'arch.control.lv3': 1,
  // ---- hero-unique skill power at Lv1 and Lv3 ----
  'uniq.knight.lv1': 1,
  'uniq.knight.lv3': 1,
  'uniq.thornguard.lv1': 1,
  'uniq.thornguard.lv3': 1,
  'uniq.assassin.lv1': 1.1,
  'uniq.assassin.lv3': 1.2,
  'uniq.duelist.lv1': 1,
  'uniq.duelist.lv3': 1,
  'uniq.berserker.lv1': 1,
  'uniq.berserker.lv3': 0.9,
  'uniq.pyro.lv1': 1,
  'uniq.pyro.lv3': 1.2,
  'uniq.witch.lv1': 1,
  'uniq.witch.lv3': 0.95,
  'uniq.chrono.lv1': 1,
  'uniq.chrono.lv3': 1,
  // ---- hero-unique skill cooldown multiplier (all levels) ----
  'cd.knight': 1.05,
  'cd.thornguard': 1,
  'cd.assassin': 1,
  'cd.duelist': 1,
  'cd.berserker': 1.05,
  'cd.pyro': 0.8,
  'cd.witch': 0.9,
  'cd.chrono': 1.1,
  // ---- hero max HP multiplier ----
  'hp.knight': 1.3,
  'hp.thornguard': 1.18,
  'hp.assassin': 1,
  'hp.duelist': 1.06,
  'hp.berserker': 1.1,
  'hp.pyro': 1.14,
  'hp.witch': 1.2,
  'hp.chrono': 1.18,
  // ---- hero passives ----
  /** อัศวิน: start shield, share of max HP */
  'knight.shield': 0.1,
  /** นักฆ่า: the first hit of the fight × this */
  'assassin.first': 1.6,
  /** นักดาบคู่: every 3rd hit + this share (at least +1) */
  'duelist.third': 0.3,
  /** นักรบคลั่ง: +1 พลัง per this many hits taken */
  'berserker.hits': 6,
  /** นักเวทเพลิง: burns last × this */
  'pyro.burn': 1.3,
  /** แม่มดน้ำแข็ง: freezes last + this many seconds */
  'witch.freeze': 0.3,
};
// </tuned>

export type TuningKey = keyof typeof TUNING;
/** The live values (the tuner's worker threads change them with setTuning; the game never does). */
export const T: Record<TuningKey, number> = { ...TUNING };

const listeners: (() => void)[] = [];
/** Called after setTuning (skills.ts rebuilds its scaled numbers). */
export const onTuning = (f: () => void) => listeners.push(f);

/** Replace live values (keys not given go back to TUNING). For the tuner only. */
export function setTuning(v: Partial<Record<string, number>>) {
  for (const k of Object.keys(TUNING) as TuningKey[]) T[k] = v[k] ?? TUNING[k];
  for (const f of listeners) f();
}
