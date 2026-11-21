import { HEROES, HEROES_BY_ID, ULT_LV2_LV3, ULT_PIECES, ultLv3, ultPieces } from './heroes';
import { activeBonuses } from './links';
import { Rng, hashSeed } from './rng';
import {
  LV3_DAY, MAX_SLOTS, PRICES, REROLL, buy, buySlot, incomeFor, newRun, offerChoices, pickRelic, priceOf, reroll, sell, slotPrice, slotsOf, toBuild, upgradeOf,
  type Offer, type RunState,
} from './run';
import { RELICS_BY_ID, RELIC_DAYS, relicFits, relicFitsBuild, rollRelicOffer } from './relics';
import { T } from './tuning';
import { SKILLS, SKILL_LIST, SKILL_ROLE, lvOf, nodeOf, rarityOf, epicAfter, type Effect, type SkillNode, type Variant } from './skills';
import { LINES, type Build, type Line, type SkillInstance } from './types';

/**
 * Rule-based bot (no LLM). Plays through the same run API as a human.
 * Used for: AI opponents when there are few player builds, balance testing,
 * and later the player-configured bots (โควตา/กฎ in the vision doc).
 *
 * Difficulty tiers:
 * - easy:   no rerolls, noisy picks, sometimes leaves a slot empty on days 1–3, keeps the list in buy order.
 * - normal: line / hero preference, 2 rerolls a day, sorts the list for connect bonuses, buys toward the ultimate.
 * - hard:   values skills by their numbers, buys for connect bonuses, finishes upgrade branches that fit the build,
 *           buys toward the ultimate (3 line pieces = Lv1; all 4 with 3 at Lv3 = Lv2), likes its line's tech skill, buys anti-control when its line has
 *           none, spends its gold (rerolls, slots).
 * Every tier makes sure the build owns at least one damage skill with a short cooldown, so it always casts early.
 */
export type BotTier = 'easy' | 'normal' | 'hard';
export const BOT_TIERS: BotTier[] = ['easy', 'normal', 'hard'];

export interface BotRules {
  /** lines in priority order */
  prefer: Line[];
  /** gold to keep after rerolling */
  reserve: number;
  maxRerolls: number;
  /** default 'normal' */
  tier?: BotTier;
  /** never buy skills of this line (and no hero unique): the simulator's "off-line" builds */
  avoid?: Line;
}

/** Skills a bot with these rules may buy. */
const allowed = (rules: BotRules, id: string) => !rules.avoid || (SKILLS[id]?.line !== rules.avoid && !SKILLS[id]?.hero);

/** Default rules for a tier. */
export function botRules(prefer: Line[], tier: BotTier = 'normal'): BotRules {
  if (tier === 'easy') return { prefer, reserve: 0, maxRerolls: 0, tier };
  if (tier === 'hard') return { prefer, reserve: 0, maxRerolls: 8, tier };
  return { prefer, reserve: 0, maxRerolls: 2, tier };
}

// ---------------- skill facts read from the skill data (no hard-coded skill lists) ----------------

/** "Fires early": cooldown at most this many ticks (6.5s; sim v15: 5s kept slow-line heroes stuck with an off-line hitter) */
export const EARLY_CD = 65;
const directDamage = (e: Effect) => (e.k === 'hit' && (e.n > 0 || !!e.shieldPct || !!e.thornsX || !!e.burnPct) && !e.ifSlowed) || e.k === 'burn';
/** A variant that deals damage on its own and fires within EARLY_CD. */
export const isEarlyHitter = (k: Pick<SkillInstance, 'id' | 'v'>) => {
  const n = nodeOf(k);
  return n.cd <= EARLY_CD && n.fx.some(directDamage);
};
/** Effects that answer freeze / slow / cast delay. */
const ANTI_CONTROL = new Set<Effect['k']>(['cleanse', 'steadfast']);
const nodeAntiControl = (n: SkillNode) => n.fx.some((e) => ANTI_CONTROL.has(e.k));
/** Lv1 of this skill already removes or reduces control. */
export const isAntiControl = (id: string) => !!SKILLS[id] && nodeAntiControl(SKILLS[id].tree['']);
/** A line is weak to control when none of its own skills answer it at Lv1. */
export const weakToControl = (line: Line) => !SKILL_LIST.some((d) => d.line === line && isAntiControl(d.id));

/** Rough strength of one variant per second of cooldown (hard bot only; tuning numbers, not game rules). */
function nodeValue(n: SkillNode, has: Set<Effect['k'] | 'frozenHit'>): number {
  let v = 0;
  for (const e of n.fx) {
    switch (e.k) {
      case 'hit': {
        let d = e.n;
        if (e.shieldPct) d += e.shieldPct * (has.has('shield') ? 10 : 4);
        if (e.thornsX) d += e.thornsX * (has.has('thorns') ? 3 : 1.5);
        if (e.burnPct) d += e.burnPct * (has.has('burn') ? 10 : 3);
        if (e.poisonPct) d += e.poisonPct * (has.has('poison') ? 12 : 3);
        if (e.perBurn) d += e.perBurn * (has.has('burn') ? 2 : 0.5);
        if (e.perDodge) d += e.perDodge * (has.has('dodge') ? 1.5 : 0.3);
        d *= e.times ?? 1;
        if (e.pierce) d *= 1 + 0.25 * e.pierce;
        if (e.exec) d *= 1 + (e.exec[1] - 1) * 0.35;
        if (e.frozen) d *= has.has('freeze') ? 1 + (e.frozen - 1) * 0.5 : 1;
        if (e.noShield) d *= 1 + (e.noShield - 1) * 0.6;
        if (e.ifSlowed) d *= has.has('slow') ? 0.8 : 0.2;
        if (e.leech) d *= 1 + e.leech;
        if (e.burn) d += e.burn[0] * e.burn[1];
        if (e.poison) d += e.poison[0] * e.poison[1] * 0.7;
        if (e.sure) d *= 1.05;
        if (e.perRemoved) d += e.perRemoved * 0.5;
        v += d;
        break;
      }
      case 'shield': v += e.n * 0.7; break;
      case 'heal': v += e.n * 0.8; break;
      case 'burn': v += (e.dps * e.secs * 0.8 + (e.growthHalf && has.has('grow') ? 4 : 0)) * (e.stacks ?? 1); break;
      case 'poison': v += e.dps * e.secs * 0.7 * (e.stacks ?? 1); break;
      case 'dodge': v += e.n * 3; break;
      case 'haste': v += e.pct * e.secs * 6; break;
      case 'wound': v += e.pct * e.secs * 1.5; break;
      case 'freeze': v += e.secs * 6; break;
      case 'slow': v += e.pct * e.secs * 8; break;
      case 'delay': v += e.secs * 5; break;
      case 'grow': v += e.n * 4; break;
      case 'charge': v += (e.mult - 1) * 7 * (e.hits ?? 1); break;
      case 'thorns': v += e.n * (e.perm ? 4 : 2.5); break;
      case 'steadfast': v += 3; break;
      case 'cleanse': v += 2; break;
      case 'dispel': v += 3; break;
      case 'leech': v += e.pct * 8; break;
    }
  }
  return v / Math.max(1, n.cd / 10);
}

/** Effect kinds present in the build (for branch synergy: shieldPct wants shields, frozen wants freeze, ...). */
function effectsOf(skills: SkillInstance[]) {
  const has = new Set<Effect['k'] | 'frozenHit'>();
  for (const k of skills) for (const e of nodeOf(k).fx) has.add(e.k);
  return has;
}

const BONUS_W = { trigger: 2, power: 1.5, haste: 1.2, dmg: 1.5, shield: 1 } as const;
const cdSecs = (k: SkillInstance) => nodeOf(k).cd / 10; // TPS = 10
/**
 * Engines want strong neighbours: ฟันเฟือง (gear) feeds the hitters next to it (one alone at the list's edge gets
 * fed twice as often), เร่งเครื่อง (overclock) pays off most between slow, heavy skills whose cooldown it restarts.
 * Slow cooldown is the proxy for "heavy" here.
 */
function engineScore(skills: SkillInstance[]) {
  let n = 0;
  skills.forEach((k, i) => {
    const en = nodeOf(k).engine;
    if (!en) return;
    const nb = [skills[i - 1], skills[i + 1]].filter((x): x is SkillInstance => !!x && !nodeOf(x).engine);
    const sum = nb.reduce((s, x) => s + cdSecs(x), 0);
    n += en.kind === 'gear' ? en.power * 0.4 * (nb.length === 1 ? 2 * sum : sum) : en.power * 0.5 * sum;
  });
  return n;
}
const linkScore = (skills: SkillInstance[]) =>
  activeBonuses(skills).reduce((n, a) => n + BONUS_W[a.b.e], 0) + engineScore(skills);

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

/** Connect-bonus score gained if `extra` joined the list at its best position (or replaced skill `drop`). Cheap: no re-sort. */
function linkGain(skills: SkillInstance[], extra: SkillInstance, drop = -1) {
  const base = linkScore(skills);
  const rest = skills.filter((_, i) => i !== drop);
  let best = -Infinity;
  for (let p = 0; p <= rest.length; p++) best = Math.max(best, linkScore([...rest.slice(0, p), extra, ...rest.slice(p)]));
  return best - base;
}

// ---------------- branch choice and relics (sim v17) ----------------

/**
 * Which branch a bot takes when it buys an upgrade: easy at random, normal the stronger one by its numbers half the time
 * (else random), hard the stronger one by its numbers (a Lv2 branch counts its best Lv3 child too) with a small pull
 * toward rare / epic branches. Deterministic from the run seed.
 */
export function botBranch(s: RunState, o: Offer, tier: BotTier): string | undefined {
  const opts = offerChoices(s, o);
  if (opts.length < 2) return undefined;
  const rng = new Rng(hashSeed(s.seed, 'branch', s.day, o.id, tier));
  if (tier === 'easy' || (tier === 'normal' && rng.next() < 0.6)) return rng.pick(opts);
  const has = effectsOf(s.skills);
  const val = (v: Variant) => {
    let x = nodeValue(nodeOf({ id: o.id, v }), has);
    if (v.length === 1) x += 0.25 * Math.max(...(['1', '2'] as const).map((c) => nodeValue(nodeOf({ id: o.id, v: (v + c) as Variant }), has)));
    const r = rarityOf(o.id, v);
    if (tier === 'hard') x *= r === 'epic' ? 1.08 : r === 'rare' ? 1.04 : epicAfter(o.id, v) ? 1.03 : 1;
    return x * (0.8 + 0.4 * rng.next());
  };
  return opts.reduce((a, b) => (val(b) > val(a) ? b : a));
}

/** the relic a bot takes from today's offer (-1 = skip): easy at random, normal its line or a generic one, hard by fit */
export function botRelic(s: RunState, tier: BotTier): number {
  const offer = s.relicOffer ?? [];
  if (!offer.length) return -1;
  const rng = new Rng(hashSeed(s.seed, 'relicpick', s.day, tier));
  // sim v18: every tier knows a relic's condition (no lone wolf with 5 skills, no sigil without a mark)
  const usable = (id: string) => (id === 'lonewolf' ? s.skills.length <= 3 && s.day >= 7 : id === 'sigil' ? s.skills.some((k) => k.mark) : true);
  if (!offer.some(usable)) return -1;
  if (tier === 'easy') {
    const ok = offer.map((id, i) => (usable(id) ? i : -1)).filter((i) => i >= 0);
    return ok[rng.int(ok.length)];
  }
  const line = HEROES_BY_ID[s.hero]?.line;
  const counts: Record<string, number> = {};
  for (const k of s.skills) counts[SKILLS[k.id].line] = (counts[SKILLS[k.id].line] ?? 0) + 1;
  const fit = (id: string) => {
    const g = RELICS_BY_ID[id].group;
    if (!usable(id)) return -Infinity;
    if (relicFitsBuild(id, s.skills)) return 1.8;
    if (relicFits(id, line)) return 1.2;
    if (g === 'cheese') {
      if (id === 'sigil') return s.skills.filter((k) => k.mark).length >= 2 ? 4 : 0.5;
      if (id === 'lonewolf') return 4;
      return tier === 'hard' ? 1.2 : 0.3;
    }
    if (g === 'any') {
      if (id === 'twinline') return Math.max(...Object.entries(counts).filter(([l]) => l !== line && l !== 'none').map(([, n]) => n), 0) >= 2 ? 2.8 : 1;
      if (id === 'wanderer') return s.skills.filter((k) => SKILLS[k.id].line !== line).length >= 3 ? 2.6 : 1.2;
      return 1.5;
    }
    return 1 + 0.5 * (counts[g] ?? 0);
  };
  let best = 0;
  let bv = -Infinity;
  offer.forEach((id, i) => {
    const v = fit(id) + rng.next() * (tier === 'hard' ? 2 : 2.5);
    if (v > bv) [best, bv] = [i, v];
  });
  return best;
}

// ---------------- shop turn ----------------

/** Bots ramp up gently: no Lv3 before day 5 (any tier), easy bots no Lv2 before day 3. */
export const BOT_LV3_DAY = LV3_DAY;
const upgradeAllowed = (v: string, day: number, tier: BotTier) =>
  v.length >= 2 ? day >= (tier === 'easy' ? EASY_LV3_DAY : BOT_LV3_DAY) : tier !== 'easy' || day >= 3;
/** easy bots stay gentle: Lv3 only from this day */
export const EASY_LV3_DAY = 8;

/** How many early hitters the bot owns. */
const ownedHitters = (s: RunState) => s.skills.filter(isEarlyHitter).length;

/**
 * Guarantee: the build owns a damage skill that fires early. Buys the cheapest such offer (making room by selling
 * the weakest non-hitter if needed), rerolling a few times when the shop has none. Returns false if it could not.
 */
function ensureHitter(s: RunState, keep: (k: SkillInstance) => number, rules: BotRules): boolean {
  for (let tries = 0; tries < 4; tries++) {
    if (ownedHitters(s) > 0) return true;
    // an upgrade can turn an owned skill into an early hitter too, but a new Lv1 hitter is the reliable fix
    let pick = -1;
    s.shop.forEach((o, i) => {
      if (!o || o.v !== '' || priceOf(o) > s.gold + (s.skills.length >= slotsOf(s) ? minSell(s, keep) : 0)) return;
      if (s.skills.some((k) => k.id === o.id) || !isEarlyHitter({ id: o.id, v: '' }) || !allowed(rules, o.id)) return;
      // the hitter the bot likes most (its line / its unique), cheaper on a tie
      const v = keep({ id: o.id, v: '' });
      const pv = pick < 0 ? -Infinity : keep({ id: s.shop[pick]!.id, v: '' });
      if (pick < 0 || v > pv || (v === pv && priceOf(o) < priceOf(s.shop[pick]!))) pick = i;
    });
    if (pick >= 0) {
      if (s.skills.length >= slotsOf(s)) sell(s, weakest(s, keep));
      if (!buy(s, pick)) return true;
    }
    if (s.day <= 1 || s.gold < REROLL + PRICES[0]) return false;
    reroll(s);
  }
  return ownedHitters(s) > 0;
}
const weakest = (s: RunState, keep: (k: SkillInstance) => number) => {
  let w = -1;
  s.skills.forEach((k, i) => {
    if (w < 0 || keep(k) < keep(s.skills[w])) w = i;
  });
  return w;
};
const minSell = (s: RunState, keep: (k: SkillInstance) => number) => {
  const w = weakest(s, keep);
  return w >= 0 ? lvOf(s.skills[w].v) : 0;
};

export function botShopTurn(s: RunState, rules: BotRules) {
  const tier = rules.tier ?? 'normal';
  if (tier === 'hard') return hardShopTurn(s, rules);
  const rng = new Rng(hashSeed(s.seed, 'bot', s.day, tier));
  const easy = tier === 'easy';
  let rerolls = 0;
  const want = HEROES_BY_ID[s.hero]?.botWant ?? [];
  const line = HEROES_BY_ID[s.hero]?.line;
  /** how much the bot likes a skill (0 = not at all) */
  const like = (id: string) => {
    const d = SKILLS[id];
    let score = 0;
    const pi = rules.prefer.indexOf(d.line as Line);
    if (pi >= 0) score += 3 - pi;
    if (d.hero) score += 3;
    if (!easy && want.includes(id)) score += 2;
    // buying toward the ultimate: one more line skill is worth a bit more while the ult is still locked
    if (!easy && d.line === line && ultPieces(s) < ULT_PIECES[0]) score += 1;
    return score;
  };
  /** value of an owned skill when deciding what to sell; the last early hitter is never sold */
  const keep = (k: SkillInstance) => like(k.id) * 2 + lvOf(k.v) + (isEarlyHitter(k) && ownedHitters(s) <= 1 ? 100 : 0);
  ensureHitter(s, keep, rules);
  // easy: most easy bots leave one slot empty on days 1–3; at most 1 purchase a day early, 2 later
  const lazy = easy && s.day <= 3 && new Rng(hashSeed(s.seed, 'lazy')).next() < 0.7;
  const buyCap = !easy ? 99 : s.day <= 3 ? 1 : 2;
  let bought = 0;
  for (let guard = 0; guard < 40 && bought < buyCap; guard++) {
    let best = -1;
    let bestScore = 0;
    const full = s.skills.length >= slotsOf(s) - (lazy ? 1 : 0);
    s.shop.forEach((offer, i) => {
      if (!offer || !allowed(rules, offer.id)) return;
      // easy bots are gentler on day 1: no hero unique (its Lv1 hits far harder than a shared Lv1)
      if (easy && s.day <= 1 && SKILLS[offer.id].hero) return;
      const id = offer.id;
      if (priceOf(offer) > s.gold) return;
      let score: number;
      if (offer.v !== '') {
        if (!upgradeOf(s, offer) || lazy) return; // lazy easy bots do not upgrade early either
        if (!upgradeAllowed(offer.v, s.day, tier)) return;
        score = easy ? 1.5 : offer.star ? 2 : 3; // an upgrade of something we own (easy undervalues upgrades; a star is a late gold sink)
        // a Lv3 on a line skill is one more ult piece (ult Lv2 needs ULT_LV2_LV3 of them)
        if (!easy && SKILLS[id].line === line && offer.v.length === 2 && ultLv3(s) < ULT_LV2_LV3) score += 1;
      } else {
        if (s.skills.some((k) => k.id === id)) return;
        score = full ? 1 : 2; // a free slot is worth filling with anything
      }
      score += easy ? like(id) * 0.5 + rng.next() * 3 : like(id);
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
        if (easy) {
          s.shop[best] = null; // easy never makes room
          continue;
        }
        // make room: buy a slot if it leaves enough gold, else swap out a weaker skill
        // normal bots buy at most one extra slot (hard bots manage slots on their own)
        if (slotsOf(s) < MAX_SLOTS && s.bonusSlots < 1 && s.gold >= slotPrice(s) + priceOf(offer)) buySlot(s);
        else {
          const worst = weakest(s, keep);
          if (worst >= 0 && keep(s.skills[worst]) < like(id) * 2 + 1) sell(s, worst);
          else {
            s.shop[best] = null; // not worth it: ignore this offer for today
            continue;
          }
        }
      }
      buy(s, best, botBranch(s, offer, tier));
      bought++;
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

/** hard tier: numbers-aware shopping, connect bonuses, coherent upgrades, anti-control, no gold left lying around. */
function hardShopTurn(s: RunState, rules: BotRules) {
  const hero = HEROES_BY_ID[s.hero];
  const want = hero?.botWant ?? [];
  const line = hero?.line ?? rules.prefer[0];
  const needAnti = weakToControl(line) && s.day >= 4;
  const pref = (id: string) => {
    const d = SKILLS[id];
    const pi = rules.prefer.indexOf(d.line as Line);
    let v = (pi >= 0 ? 2 - pi * 0.5 : 0) + (d.hero ? 2.5 : 0) + (want.includes(id) ? 1.5 : 0);
    // toward the ultimate while it is locked; the line's tech skill (answers the lines it loses to) from day 3
    if (d.line === line && ultPieces(s) < ULT_PIECES[0]) v += 1.5;
    if (d.line === line && SKILL_ROLE[id] === 'tech' && s.day >= 3) v += 1;
    return v;
  };
  // the list's effect kinds, recomputed only when the list changes (version)
  let version = 0;
  let hasV = -1;
  let hasCache = effectsOf(s.skills);
  const hasNow = () => {
    if (hasV !== version) [hasCache, hasV] = [effectsOf(s.skills), version];
    return hasCache;
  };
  const instValue = (k: Pick<SkillInstance, 'id' | 'v'>, has = hasNow()) => nodeValue(nodeOf(k), has) + pref(k.id);
  const keep = (k: SkillInstance) => {
    let v = instValue(k) + lvOf(k.v) * 1.5;
    if (isEarlyHitter(k) && ownedHitters(s) <= 1) v += 100;
    if (needAnti && isAntiControl(k.id) && s.skills.filter((x) => isAntiControl(x.id)).length <= 1) v += 50;
    return v;
  };
  ensureHitter(s, keep, rules);
  version++; // the list may have changed
  const hasAnti = () => s.skills.some((k) => isAntiControl(k.id) || nodeAntiControl(nodeOf(k)));

  /** score of an offer = value gained per gold (0 = skip) */
  const score = (o: Offer): number => {
    const has = hasNow();
    if (o.v !== '') {
      const owned = upgradeOf(s, o);
      if (!owned || !upgradeAllowed(o.v, s.day, 'hard')) return 0;
      if (o.star) return (nodeValue(nodeOf(owned), has) * T['star.pow'] * (o.star >= 3 ? 1.8 : 1) + 0.5 + pref(o.id) * 0.3) / priceOf(o);
      const pick = (botBranch(s, o, 'hard') ?? o.v) as Variant;
      const gain = nodeValue(nodeOf({ id: o.id, v: pick }), has) - nodeValue(nodeOf(owned), has);
      // finishing a branch (Lv2 → Lv3) on a skill that fits the build is worth more than spreading gold thin
      const branch = lvOf(owned.v) === 2 ? (SKILLS[o.id].line === line && ultLv3(s) < ULT_LV2_LV3 ? 2.5 : 1.5) : 0.5;
      // a Lv2 variant whose Lv3 children suit the build (best child value) is a coherent branch to start
      const kids = lvOf(pick) === 2 ? Math.max(...(['1', '2'] as const).map((c) => nodeValue(nodeOf({ id: o.id, v: (pick + c) as Variant }), has))) * 0.2 : 0;
      if (gain + kids <= 0) return 0;
      return (gain + kids + branch + pref(o.id) * 0.5) / priceOf(o);
    }
    if (s.skills.some((k) => k.id === o.id)) return 0;
    const inst: SkillInstance = { id: o.id, v: '', bonus: o.bonus };
    const full = s.skills.length >= slotsOf(s);
    let v = instValue(inst, has) + linkGain(s.skills, inst) * 0.8;
    if (needAnti && !hasAnti() && isAntiControl(o.id)) v += 6;
    if (!full) v += 3; // an empty slot fights for nothing
    return v / priceOf(o);
  };

  // offer scores only change when the list changes: cache them per list version
  const cache = new WeakMap<Offer, [number, number]>();
  const cachedScore = (o: Offer) => {
    const c = cache.get(o);
    if (c && c[0] === version) return c[1];
    const sc = score(o);
    cache.set(o, [version, sc]);
    return sc;
  };
  let rerolls = 0;
  for (let guard = 0; guard < 60; guard++) {
    let best = -1;
    let bestScore = 0;
    s.shop.forEach((o, i) => {
      if (!o || priceOf(o) > s.gold || !allowed(rules, o.id)) return;
      const sc = cachedScore(o);
      if (sc > bestScore) {
        bestScore = sc;
        best = i;
      }
    });
    if (best >= 0 && bestScore > 0.3) {
      const o = s.shop[best]!;
      if (o.v === '' && s.skills.length >= slotsOf(s)) {
        if (slotsOf(s) < MAX_SLOTS && s.gold >= slotPrice(s) + priceOf(o) && s.day >= 3) buySlot(s);
        else {
          const w = weakest(s, keep);
          const inst: SkillInstance = { id: o.id, v: '', bonus: o.bonus };
          const newV = instValue(inst) + linkGain(s.skills, inst, w) * 0.8 + (needAnti && !hasAnti() && isAntiControl(o.id) ? 6 : 0);
          if (w >= 0 && keep(s.skills[w]) + 1 < newV) {
            sell(s, w);
            version++;
          } else {
            s.shop[best] = null;
            continue;
          }
        }
      }
      buy(s, best, botBranch(s, o, 'hard'));
      version++;
      continue;
    }
    // nothing worth buying: from day 3 a slot is better than a gold pile
    if (s.day >= 3 && slotsOf(s) < MAX_SLOTS && s.gold >= slotPrice(s) + PRICES[0] && s.skills.length >= slotsOf(s)) {
      buySlot(s);
      version++;
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

/** One full shop day for a bot: shop, then sort the list (easy keeps buy order). */
export function botDay(s: RunState, rules: BotRules) {
  if (s.phase === 'relic') pickRelic(s, botRelic(s, rules.tier ?? 'normal'));
  botShopTurn(s, rules);
  if ((rules.tier ?? 'normal') !== 'easy') arrangeList(s.skills);
}

/** Build a bot's build as of `day`, by running its shop turns day by day. */
export function aiBuild(hero: string, day: number, prefer: Line[], seed: number, tier: BotTier = 'normal', avoid?: Line): Build {
  return toBuild(aiRun(hero, day, prefer, seed, tier, avoid));
}

/** The bot's run state after its shop on `day` (aiBuild without the toBuild; the simulator reads its unspent gold). */
export function aiRun(hero: string, day: number, prefer: Line[], seed: number, tier: BotTier = 'normal', avoid?: Line): RunState {
  const s = newRun(hero, seed, 'ai');
  const rules: BotRules = { ...botRules(prefer, tier), ...(avoid ? { avoid } : {}) };
  for (let d = 1; d <= day; d++) {
    if (d > 1) {
      s.day = d;
      s.gold += incomeFor(d, 0).base;
      s.rolls = 0;
      reroll(s); // costs 1, but gives a fresh shop for the day
      s.gold += 1;
      // relic days: the same 3-card offer a player gets (sim v17)
      if (RELIC_DAYS.includes(d)) {
        s.relicDays = [...(s.relicDays ?? []), d];
        s.relicOffer = rollRelicOffer(s.seed, s.hero, d, s.relics ?? [], toBuild(s).skills);
        if (s.relicOffer.length) s.phase = 'relic';
      }
    }
    botDay(s, rules);
  }
  return s;
}

/** A random hero's bot build. avoidHero: never that hero (no mirror match). */
export function randomAiBuild(day: number, seed: number, tier: BotTier = 'normal', avoidHero?: string): Build {
  const rng = new Rng(seed);
  let hero = rng.pick(HEROES);
  if (avoidHero && hero.id === avoidHero) hero = rng.pick(HEROES.filter((h) => h.id !== avoidHero));
  const second = rng.pick(LINES.filter((a) => a !== hero.line));
  return aiBuild(hero.id, day, [hero.line, second], hashSeed(seed, 'ai'), tier);
}

/** Does this loss streak drop the AI to easy? (sim v16: at −3, or at −2 from day 5; server tierFor and play-cli share it) */
export const lossDrop = (day: number, streak: number) => streak <= -3 || (streak <= -2 && day >= 5);
