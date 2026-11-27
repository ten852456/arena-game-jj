import { HEROES, HEROES_BY_ID } from './heroes';
import { activeBonuses } from './links';
import { Rng, hashSeed } from './rng';
import { MAX_SLOTS, PRICES, REROLL, buy, buySlot, incomeFor, newRun, priceOf, reroll, sell, slotPrice, slotsOf, toBuild, upgradeOf, type RunState } from './run';
import { SKILLS, lvOf } from './skills';
import { ARCHES, type Archetype, type Build, type SkillInstance } from './types';

/**
 * Rule-based bot (no LLM). Plays through the same run API as a human.
 * Used for: AI opponents when there are few player builds, balance testing,
 * and later the player-configured bots (โควตา/กฎ in the vision doc).
 */
export interface BotRules {
  /** archetypes in priority order */
  prefer: Archetype[];
  /** gold to keep after rerolling */
  reserve: number;
  maxRerolls: number;
}

export function botShopTurn(s: RunState, rules: BotRules) {
  let rerolls = 0;
  const want = HEROES_BY_ID[s.hero]?.botWant ?? [];
  /** how much the bot likes a skill (0 = not at all) */
  const like = (id: string) => {
    const d = SKILLS[id];
    let score = 0;
    const pi = rules.prefer.indexOf(d.arch as Archetype);
    if (pi >= 0) score += 3 - pi;
    if (d.hero) score += 3;
    if (want.includes(id)) score += 2;
    return score;
  };
  for (let guard = 0; guard < 40; guard++) {
    let best = -1;
    let bestScore = 0;
    const full = s.skills.length >= slotsOf(s);
    s.shop.forEach((offer, i) => {
      if (!offer) return;
      const id = offer.id;
      if (priceOf(offer) > s.gold) return;
      let score: number;
      if (offer.v !== '') {
        if (!upgradeOf(s, offer)) return;
        score = 3; // an upgrade of something we own
      } else {
        if (s.skills.some((k) => k.id === id)) return;
        score = full ? 1 : 2; // a free slot is worth filling with anything
      }
      score += like(id);
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    });
    if (best >= 0 && bestScore >= 2) {
      const offer = s.shop[best]!;
      const id = offer.id;
      const isNew = offer.v === '';
      if (isNew && full) {
        // make room: buy a slot if it leaves enough gold, else swap out a weaker skill
        if (slotsOf(s) < MAX_SLOTS && s.gold >= slotPrice(s) + priceOf(offer)) buySlot(s);
        else {
          let worst = -1;
          s.skills.forEach((k, i) => {
            const v = like(k.id) * 2 + lvOf(k.v);
            if (worst < 0 || v < like(s.skills[worst].id) * 2 + lvOf(s.skills[worst].v)) worst = i;
          });
          const k = s.skills[worst];
          if (worst >= 0 && like(k.id) * 2 + lvOf(k.v) < like(id) * 2 + 1) sell(s, worst);
          else {
            s.shop[best] = null; // not worth it: ignore this offer for today
            continue;
          }
        }
      }
      buy(s, best);
      continue;
    }
    if (rerolls < rules.maxRerolls && s.gold >= REROLL + PRICES[0] + rules.reserve) {
      reroll(s);
      rerolls++;
      continue;
    }
    break;
  }
}

const BONUS_W = { trigger: 2, power: 1.5, haste: 1.2, dmg: 1.5, shield: 1 } as const;
const linkScore = (skills: SkillInstance[]) => activeBonuses(skills).reduce((n, a) => n + BONUS_W[a.b.e], 0);

/** Reorder the list to turn on as many connect bonuses as possible (hill-climb over swaps). Returns the score. */
export function arrangeList(skills: SkillInstance[]): number {
  let best = linkScore(skills);
  for (let pass = 0; pass < 20; pass++) {
    let improved = false;
    for (let i = 0; i < skills.length; i++)
      for (let j = i + 1; j < skills.length; j++) {
        [skills[i], skills[j]] = [skills[j], skills[i]];
        const sc = linkScore(skills);
        if (sc > best + 1e-9) {
          best = sc;
          improved = true;
        } else [skills[i], skills[j]] = [skills[j], skills[i]];
      }
    if (!improved) break;
  }
  return best;
}

/** Build a bot's build as of `day`, by running its shop turns day by day. */
export function aiBuild(hero: string, day: number, prefer: Archetype[], seed: number): Build {
  const s = newRun(hero, seed, 'ai');
  const rules: BotRules = { prefer, reserve: 0, maxRerolls: 2 };
  for (let d = 1; d <= day; d++) {
    if (d > 1) {
      s.day = d;
      s.gold += incomeFor(d, 0).base;
      s.rolls = 0;
      reroll(s); // costs 1, but gives a fresh shop for the day
      s.gold += 1;
    }
    botShopTurn(s, rules);
    arrangeList(s.skills);
  }
  return toBuild(s);
}

export function randomAiBuild(day: number, seed: number): Build {
  const rng = new Rng(seed);
  const hero = rng.pick(HEROES);
  const second = rng.pick(ARCHES.filter((a) => a !== hero.arch));
  return aiBuild(hero.id, day, [hero.arch, second], hashSeed(seed, 'ai'));
}
