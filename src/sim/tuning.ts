/**
 * Balance knobs in one place. The auto-tuner (`npm run tune`, see docs/TUNING.md) searches over these values and
 * `npm run tune -- --apply` rewrites the numbers between the <tuned> markers below.
 *
 * - skills.ts scales its base numbers (the literals in SKILL_LIST) by the skill multipliers when it loads:
 *   hits, shields, heals, burns, poisons and charge get `line.*` (shared skills) or `uniq.*` (hero-unique skills),
 *   interpolated by level (Lv2 = halfway between Lv1 and Lv3); freeze / slow / delay seconds get `control`,
 *   engine power gets `engine`, hero-unique cooldowns get `cd.<hero>`. Scaled values are rounded (integers stay integers), so the UI shows the real numbers.
 * - heroes.ts reads the hero HP and passive values; combat.ts the HP curve and chain decay; run.ts the run HP and loss.
 *
 * Change a value → bump SIM_VERSION in combat.ts.
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
  'hp.early': 0.92,
  /** days 4–7 */
  'hp.mid': 0.95,
  /** day 8+ */
  'hp.late': 1.07,
  // ---- combat rules (numbers only) ----
  /** each trigger-chain step after the first fires ×this */
  'chainDecay': 0.75,
  /** engine skill power (ฟันเฟือง / เร่งเครื่อง) × this */
  'engine': 1,
  /** freeze / slow / delay seconds of every skill × this */
  'control': 0.9,
  // ---- shared skills of each line: power multiplier at Lv1 and Lv3 ----
  'line.hit.lv1': 0.9,
  'line.hit.lv3': 1.25,
  'line.dodge.lv1': 0.7,
  'line.dodge.lv3': 1.45,
  'line.shield.lv1': 1.3,
  'line.shield.lv3': 1.15,
  'line.heal.lv1': 1.45,
  'line.heal.lv3': 1.15,
  'line.burn.lv1': 1.2,
  'line.burn.lv3': 1.0,
  'line.poison.lv1': 1.2,
  'line.poison.lv3': 0.9,
  'line.ice.lv1': 0.9,
  'line.ice.lv3': 1.3,
  'line.wind.lv1': 1.4,
  'line.wind.lv3': 0.75,
  // ---- hero-unique skill power at Lv1 and Lv3 ----
  'uniq.knight.lv1': 1.4,
  'uniq.knight.lv3': 1.3,
  'uniq.thornguard.lv1': 1.2,
  'uniq.thornguard.lv3': 1.4,
  'uniq.assassin.lv1': 0.7,
  'uniq.assassin.lv3': 2.1,
  'uniq.duelist.lv1': 1.3,
  'uniq.duelist.lv3': 1.5,
  'uniq.berserker.lv1': 1.75,
  'uniq.berserker.lv3': 0.7,
  'uniq.pyro.lv1': 1.3,
  'uniq.pyro.lv3': 1.5,
  'uniq.witch.lv1': 1.2,
  'uniq.witch.lv3': 1.0,
  'uniq.chrono.lv1': 2.0,
  'uniq.chrono.lv3': 0.55,
  // ---- hero-unique skill cooldown multiplier (all levels) ----
  'cd.knight': 0.95,
  'cd.thornguard': 0.85,
  'cd.assassin': 0.95,
  'cd.duelist': 0.95,
  'cd.berserker': 0.95,
  'cd.pyro': 0.8,
  'cd.witch': 0.95,
  'cd.chrono': 1,
  // ---- hero max HP multiplier ----
  'hp.knight': 1.24,
  'hp.thornguard': 1.3,
  'hp.assassin': 1.06,
  'hp.duelist': 1.0,
  'hp.berserker': 1.2,
  'hp.pyro': 1.44,
  'hp.witch': 1.62,
  'hp.chrono': 1.32,
  // ---- hero passives ----
  /** อัศวิน: start shield, share of max HP */
  'knight.shield': 0.16,
  /** นักฆ่า: the first hit of the fight × this */
  'assassin.first': 1.3,
  /** นักฆ่า: every this-many-th hit is ×assassin.first too (0 = only the first hit) */
  'assassin.every': 4,
  /** นักรบคลั่ง: +1 พลัง per this many hits taken */
  'berserker.hits': 5,
  /** นักเวทเพลิง: burns last × this */
  'pyro.burn': 1.3,
  /** แม่มดน้ำแข็ง: freezes last + this many seconds */
  'witch.freeze': 0.3,
  /** นักฆ่า: every landed hit cuts enemy healing by this share for 2 s */
  'assassin.wound': 0.4,
  /** นักดาบคู่: after a dodge, the next hit × this */
  'duelist.counter': 1.6,
  /** นักรบหนาม: each hit taken poisons the attacker 1/s for this many seconds */
  'thornguard.poison': 3,
  // ---- new mechanics (sim v12) ----
  /** most dodge charges a fighter can hold (+1 for a hero of the 💨 line) */
  'dodge.cap': 1,
  /** share of a dodged hit that still lands (its riders, thorns and leech don't) */
  'dodge.graze': 0.25,
  /** skills of your hero's own line (its pieces) are this much stronger (ถนัดสาย) */
  'line.affinity': 1.1,
  /** a burning fighter's shield gains × this (ไฟละลายโล่) */
  'burn.shield': 0.85,
  /** a poisoned fighter's healing × this */
  'poison.heal': 0.55,
  /** most haste a fighter can have (share faster) */
  'haste.cap': 0.6,
  // ---- ultimates: trigger amount (Lv1; Lv2 needs 30% less) and effect power (Lv1; Lv2 ×1.4) ----
  /** damage ultimates (นักฆ่า, อัศวิน) deal at most this share of the enemy's max HP (Lv2 ×1.4) */
  'ult.cap': 0.3,
  /** นักฆ่า: enemy HP below this share */
  'ult.assassin.trig': 0.55,
  /** นักฆ่า: hit = this × your biggest hit so far (ignores shield, can't be dodged) */
  'ult.assassin.pow': 0.7,
  /** นักดาบคู่: hits dodged */
  'ult.duelist.trig': 3,
  /** นักดาบคู่: haste share for 3 s (+2 dodge) */
  'ult.duelist.pow': 0.25,
  /** อัศวิน: shield gained, share of max HP */
  'ult.knight.trig': 0.2,
  /** อัศวิน: hit = shield × this (the shield stays) */
  'ult.knight.pow': 1.6,
  /** นักรบคลั่ง: HP below this share (or a killing blow, whichever comes first) */
  'ult.berserker.trig': 0.2,
  /** นักรบคลั่ง: heals this share of max HP (+2 พลัง; a killing blow leaves 1 HP first) */
  'ult.berserker.pow': 0.08,
  /** นักเวทเพลิง: burn stacks on the enemy */
  'ult.pyro.trig': 2,
  /** นักเวทเพลิง: deals the burn still to come × this right away */
  'ult.pyro.pow': 1.0,
  /** นักรบหนาม: direct hits taken */
  'ult.thornguard.trig': 6,
  /** นักรบหนาม: seconds of poison thorns */
  'ult.thornguard.pow': 2,
  /** แม่มดน้ำแข็ง: ice skill casts */
  'ult.witch.trig': 4,
  /** แม่มดน้ำแข็ง: freeze seconds (+ next hit ×2) */
  'ult.witch.pow': 2,
  /** จอมเวทลม: slows / delays landed */
  'ult.chrono.trig': 4,
  /** จอมเวทลม: haste share for 3 s (+ all skills ready, cleanse all) */
  'ult.chrono.pow': 0.2,
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
