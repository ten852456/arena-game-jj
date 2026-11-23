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
  'run.startHp': 16,
  /** HP lost on a defeat = min(5, 1 + ceil(day / lossEvery)) */
  'run.lossEvery': 4,
  // ---- base HP per day (combat.ts HP_BY_DAY × this) ----
  /** days 1–3 */
  'hp.early': 1.6,
  /** days 4–7 */
  'hp.mid': 1.6,
  /** day 8+ */
  'hp.late': 1.85,
  // ---- combat rules (numbers only) ----
  /** each trigger-chain step after the first fires ×this */
  'chainDecay': 0.75,
  /** engine skill power (ฟันเฟือง / เร่งเครื่อง) × this */
  'engine': 0.9,
  /** freeze / slow / delay seconds of every skill × this */
  'control': 0.9,
  // ---- shared skills of each line: power multiplier at Lv1 and Lv3 ----
  'line.hit.lv1': 0.75,
  'line.hit.lv3': 1.45,
  'line.dodge.lv1': 0.85,
  'line.dodge.lv3': 1.8,
  'line.shield.lv1': 1.05,
  'line.shield.lv3': 1.45,
  'line.heal.lv1': 1.12,
  'line.heal.lv3': 1.15,
  'line.burn.lv1': 1.0,
  'line.burn.lv3': 0.7,
  'line.poison.lv1': 1.45,
  'line.poison.lv3': 0.8,
  'line.ice.lv1': 1.22,
  'line.ice.lv3': 1.7,
  'line.wind.lv1': 1.3,
  'line.wind.lv3': 1.2,
  'line.gold.lv1': 1.2,
  'line.gold.lv3': 0.38,
  'line.time.lv1': 0.9,
  'line.time.lv3': 1.4,
  // ---- hero-unique skill power at Lv1 and Lv3 ----
  'uniq.knight.lv1': 0.65,
  'uniq.knight.lv3': 1.25,
  'uniq.thornguard.lv1': 1.15,
  'uniq.thornguard.lv3': 1.8,
  'uniq.assassin.lv1': 0.8,
  'uniq.assassin.lv3': 1.6,
  'uniq.duelist.lv1': 1.05,
  'uniq.duelist.lv3': 1.4,
  'uniq.berserker.lv1': 1.5,
  'uniq.berserker.lv3': 1.1,
  'uniq.pyro.lv1': 0.95,
  'uniq.pyro.lv3': 1,
  'uniq.witch.lv1': 1.15,
  'uniq.witch.lv3': 1.3,
  'uniq.chrono.lv1': 1.3,
  'uniq.chrono.lv3': 1.25,
  'uniq.luckycat.lv1': 1.5,
  'uniq.luckycat.lv3': 0.4,
  'uniq.sage.lv1': 0.85,
  'uniq.sage.lv3': 1.4,
  // ---- hero-unique skill cooldown multiplier (all levels) ----
  'cd.knight': 1,
  'cd.thornguard': 1.1,
  'cd.assassin': 0.9,
  'cd.duelist': 0.95,
  'cd.berserker': 0.85,
  'cd.pyro': 0.8,
  'cd.witch': 1.1,
  'cd.chrono': 0.95,
  'cd.luckycat': 1,
  'cd.sage': 1,
  // ---- hero max HP multiplier ----
  'hp.knight': 1.16,
  'hp.thornguard': 1.15,
  'hp.assassin': 1.18,
  'hp.duelist': 0.9,
  'hp.berserker': 1.16,
  'hp.pyro': 1.55,
  'hp.witch': 1.28,
  'hp.chrono': 1.32,
  'hp.luckycat': 1.2,
  'hp.sage': 1.25,
  // ---- hero passives ----
  /** อัศวิน: start shield, share of max HP */
  'knight.shield': 0.05,
  /** นักฆ่า: the first hit of the fight × this */
  'assassin.first': 1.5,
  /** นักฆ่า: every this-many-th hit is ×assassin.first too (0 = only the first hit) */
  'assassin.every': 6,
  /** นักรบคลั่ง: +1 พลัง per this many hits taken */
  'berserker.hits': 5,
  /** นักเวทเพลิง: burns last × this */
  'pyro.burn': 1.1,
  /** แม่มดน้ำแข็ง: freezes last + this many seconds */
  'witch.freeze': 0.2,
  /** แม่มดน้ำแข็ง: a hit on a frozen enemy cuts its healing by this share for 3 s */
  'witch.wound': 0.5,
  /** นักฆ่า: every landed hit cuts enemy healing by this share for 2 s */
  'assassin.wound': 0.4,
  /** นักดาบคู่: after a dodge, the next hit × this */
  /** นักดาบคู่: +1 dodge every this many seconds (0 = off) */
  'duelist.regen': 9,
  'duelist.counter': 1.8,
  /** นักรบหนาม: each hit taken poisons the attacker 1/s for this many seconds */
  'thornguard.poison': 2,
  /** sim v16: thornguard's top skill starts the fight this share of its cooldown in (a fast first cast) */
  'thornguard.head': 0.35,
  // ---- new mechanics (sim v12) ----
  /** most dodge charges a fighter can hold (+1 for a hero of the 💨 line) */
  'dodge.cap': 1,
  /** share of a dodged hit that still lands (its riders, thorns and leech don't) */
  'dodge.graze': 0.25,
  /** จอมเวทลม: share of a dodged hit that still lands when the enemy is slowed */
  'chrono.graze': 0.6,
  /** skills of your hero's own line (its pieces) are this much stronger (ถนัดสาย) */
  'line.affinity': 1.1,
  /** sim v16: พลัง from a skill outside your hero's line is this share (a generic grow pile out-scaled every line) */
  'grow.offline': 0.5,
  /** sim v16: a Lv3 skill of your hero's line is this much stronger again (mastery grows with the line) */
  'line.lv3': 1.25,
  // ---- stars after Lv3 (sim v17, run.ts / combat.ts) ----
  /** each ★ on a Lv3 skill: all its numbers ×(1 + this) */
  'star.pow': 0.08,
  /** ★★★ also cuts the skill's cooldown by this share */
  'star.cd3': 0,
  /** ★★★ adds this much more on top of ★★ (sim v20: the spike) */
  'star.pow3': 0.12,
  /** ★★★ signature: each cast echoes once more at this power */
  'star.echo': 0.18,
  // ---- run relics (sim v17, relics.ts) ----
  /** free rerolls of the relic offer per relic day */
  'relic.rerolls': 1,
  'relic.whetstone': 0.12,
  'relic.executioner': 0.35,
  'relic.counterstep': 1.2,
  'relic.spikedshield': 0.4,
  'relic.bastion': 0.04,
  'relic.overflow': 2,
  'relic.vitality': 0.6,
  'relic.meltdown': 4,
  'relic.kindling': 1.5,
  'relic.virulence': 1,
  'relic.rot': 0.2,
  'relic.permafrost': 0.5,
  'relic.permafrostCd': 0,
  'relic.brittle': 0.2,
  'relic.gale': 0.15,
  'relic.tailspin': 0.2,
  'relic.quickdraw': 0.07,
  'relic.wanderer': 0.2,
  'relic.twinline': 0.3,
  'relic.ironhide': 0.08,
  'relic.glassHp': 0.65,
  /** ปืนแก้ว: its extra damage on one hit is at most this share of the enemy's max HP */
  'relic.glassCap': 0.08,
  'relic.glassDmg': 0.45,
  'relic.lonewolf': 0.5,
  'relic.sigil': 0.25,
  'relic.piggybank': 0.3,
  'relic.luckycoin': 0.15,
  'relic.sundial': 0.3,
  'relic.oldroots': 6,
  /** a fighter with shield takes this much less from a direct hit that doesn't fully pierce (ตั้งรับ) */
  /** share of the shield a shield bash (โล่เป็นดาเมจ) used that it spends */
  'shield.spend': 0.25,
  'shield.guard': 0.4,
  /** per-hero ถนัดสาย (sim v14): heroes whose line pull was weak get more */
  'aff.assassin': 1.3,
  'aff.duelist': 1.42,
  'aff.knight': 1.35,
  'aff.berserker': 1.25,
  'aff.pyro': 1.4,
  'aff.thornguard': 1.35,
  'aff.witch': 1.45,
  'aff.chrono': 1.35,
  'aff.luckycat': 1.35,
  'aff.sage': 1.35,
  /** a charge (รวมพลัง) waits for a hit of at least this much (before power and charge) */
  'charge.min': 4,
  /** จอมเวทลม: hits on a slowed / frozen enemy deal this much more */
  'chrono.slowHit': 0.05,
  /** แมวกวัก (sim v21): 💰 build worth counts × this */
  'luckycat.worth': 0.9,
  /** แมวกวัก: + gold every day from day 2 */
  'luckycat.income': 1,
  /** เต่าเซียน: +1 พลัง every this many seconds */
  'sage.grow': 4,
  /** a burning fighter's shield gains × this (ไฟละลายโล่) */
  /** each burn tick also removes this × the burn per second of shield (ไฟเผาโล่) */
  'burn.scorch': 0.5,
  'burn.shield': 0.95,
  /** a poisoned fighter's healing × this */
  'poison.heal': 0.65,
  /** most haste a fighter can have (share faster) */
  'haste.cap': 0.6,
  // ---- ultimates: trigger amount (Lv1; Lv2 needs 30% less) and effect power (Lv1; Lv2 ×1.4) ----
  /** damage ultimates (นักฆ่า, อัศวิน) deal at most this share of the enemy's max HP (Lv2 ×1.4) */
  'ult.cap': 0.3,
  /** นักฆ่า: enemy HP below this share */
  'ult.assassin.trig': 0.3,
  /** นักฆ่า: hit = this × the HP the enemy has lost (capped by ult.cap; ignores shield; a dodge halves it) */
  'ult.assassin.pow': 0.15,
  /** นักดาบคู่: hits dodged */
  'ult.duelist.trig': 5,
  /** นักดาบคู่: haste share for 3 s (+2 dodge) */
  'ult.duelist.pow': 0.4,
  /** อัศวิน: shield gained, share of max HP */
  'ult.knight.trig': 0.15,
  /** อัศวิน: hit = shield × this (the shield stays) */
  /** อัศวิน ult: hits pow × (shield + this share of max HP) */
  'ult.knight.hp': 0.1,
  'ult.knight.pow': 0.5,
  /** นักรบคลั่ง: HP below this share (or a killing blow, whichever comes first) */
  'ult.berserker.trig': 0.3,
  /** นักรบคลั่ง: heals this share of max HP (+2 พลัง; a killing blow leaves 1 HP first) */
  /** นักรบคลั่ง ult: +power for the rest of the fight = this share of max HP (×1.5 at Lv2), at least 2 */
  'ult.berserker.grow': 0.006,
  'ult.berserker.pow': 0.08,
  /** นักเวทเพลิง: burn stacks on the enemy */
  'ult.pyro.trig': 2,
  /** นักเวทเพลิง: deals the burn still to come × this right away */
  'ult.pyro.pow': 0.27,
  /** นักรบหนาม: direct hits taken */
  'ult.thornguard.trig': 3,
  /** นักรบหนาม: seconds of poison thorns */
  'ult.thornguard.pow': 3,
  /** หนามพิษ also poisons the enemy this much per second for its duration, at once */
  'ult.thornguard.poison': 2,
  /** แม่มดน้ำแข็ง: ice skill casts */
  'ult.witch.trig': 3,
  /** แม่มดน้ำแข็ง: freeze seconds (+ next hit ×2) */
  'ult.witch.pow': 1.7,
  /** จอมเวทลม: slows / delays landed */
  'ult.chrono.trig': 3,
  /** จอมเวทลม: haste share for 3 s (+ all skills ready, cleanse all) */
  'ult.chrono.pow': 0.3,
  /** แมวกวัก: 💰 gold line casts */
  'ult.luckycat.trig': 4,
  /** แมวกวัก: hit = build worth × this (capped by ult.cap), and half of it as shield */
  'ult.luckycat.pow': 0.25,
  /** เต่าเซียน: seconds of fight */
  'ult.sage.trig': 9,
  /** เต่าเซียน: every skill fires once now at this power */
  'ult.sage.pow': 0.7,
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
