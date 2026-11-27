import { Rng } from './rng';
import { SKILLS, SKILL_LIST, hits, lvOf } from './skills';
import { ARCHES, type Bonus, type BonusKind, type SkillInstance } from './types';

/**
 * Connect bonuses for the skill list. Pure and deterministic: runs on server and browser.
 * Each bought copy rolls 1–2 bonuses with a condition (a skill, or a skill type). A bonus is active when the skill
 * right above OR right below it in the list matches the condition, so the order of the list is now part of the build.
 */

export const MAX_BONUS = 3;
export const BONUS_KINDS: BonusKind[] = ['dmg', 'shield', 'haste', 'power', 'trigger'];
export const POWER_BONUS = 0.25;
export const HASTE_BONUS = 0.2;
/** +damage per hit / +shield per fire, by level (Lv1–Lv3) */
export const bonusValue = (e: BonusKind, lv: number) => (e === 'dmg' ? lv : e === 'shield' ? 1 + lv : 0);

/** Does skill k satisfy condition t ('strike' or 'arch:control')? */
export function matches(t: string, k: Pick<SkillInstance, 'id'>): boolean {
  return t === k.id || t === 'arch:' + SKILLS[k.id]?.arch;
}

/** The list neighbours of skill i: the one above and the one below. */
export const neighbours = (skills: SkillInstance[], i: number) => [i - 1, i + 1].filter((j) => j >= 0 && j < skills.length);

export interface ActiveBonus {
  /** skill that owns the bonus */
  from: number;
  /** index into its bonus list */
  bi: number;
  b: Bonus;
  /** neighbours that match the condition */
  to: number[];
}

/** Bonuses whose condition is met by the skill above or below. */
export function activeBonuses(skills: SkillInstance[]): ActiveBonus[] {
  const out: ActiveBonus[] = [];
  skills.forEach((k, i) => {
    (k.bonus ?? []).forEach((b, bi) => {
      const to = neighbours(skills, i).filter((j) => SKILLS[skills[j].id] && matches(b.t, skills[j]));
      if (to.length) out.push({ from: i, bi, b, to });
    });
  });
  return out;
}

/** What the active bonuses of skill i add up to. */
export function bonusTotals(skills: SkillInstance[], i: number, act = activeBonuses(skills)) {
  const mine = act.filter((a) => a.from === i);
  const count = (e: BonusKind) => mine.filter((a) => a.b.e === e).length;
  const lv = lvOf(skills[i].v);
  return {
    on: new Set(mine.map((a) => a.bi)),
    dmg: count('dmg') * bonusValue('dmg', lv),
    shield: count('shield') * bonusValue('shield', lv),
    haste: count('haste') * HASTE_BONUS,
    power: 1 + count('power') * POWER_BONUS,
    triggers: [...new Set(mine.filter((a) => a.b.e === 'trigger').flatMap((a) => a.to))],
  };
}

/** True if some variant of the skill hits (a +damage bonus would do nothing otherwise). */
const canHit = (id: string) => Object.values(SKILLS[id].tree).some(hits);

/** Skills a condition can name: shared skills + this hero's unique. */
const targetsFor = (id: string, hero: string) =>
  SKILL_LIST.filter((d) => d.id !== id && (!d.hero || d.hero === hero)).map((d) => d.id);

export const validTarget = (t: string, hero: string) =>
  ARCHES.some((a) => t === 'arch:' + a) || SKILL_LIST.some((d) => d.id === t && (!d.hero || d.hero === hero));

export function rollBonus(rng: Rng, id: string, hero: string, existing: Bonus[]): Bonus | null {
  for (let tries = 0; tries < 10; tries++) {
    const r = rng.next();
    const e: BonusKind = r < 0.3 ? 'dmg' : r < 0.45 ? 'shield' : r < 0.6 ? 'haste' : r < 0.75 ? 'power' : 'trigger';
    if (e === 'dmg' && !canHit(id)) continue; // skills that never hit roll another effect
    const t = rng.next() < 0.6 ? rng.pick(targetsFor(id, hero)) : 'arch:' + rng.pick(ARCHES);
    if (!existing.some((b) => b.t === t && b.e === e)) return { t, e };
  }
  return null;
}

/** Each new copy rolls 1–2 connect bonuses. */
export function rollBonuses(rng: Rng, id: string, hero: string): Bonus[] {
  const bonus: Bonus[] = [];
  const n = rng.next() < 0.35 ? 2 : 1;
  for (let i = 0; i < n; i++) {
    const b = rollBonus(rng, id, hero, bonus);
    if (b) bonus.push(b);
  }
  return bonus;
}

/** Number of active bonuses (for bots that sort their list). */
export const linkCount = (skills: SkillInstance[]) => activeBonuses(skills).length;
