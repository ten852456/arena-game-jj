import { HEROES, HEROES_BY_ID } from './heroes';
import { Rng, hashSeed } from './rng';
import { DX, DY, activeBonuses, cellsOf, footprint, matches, neighbours, shapeSize, type Offer } from './grid';
import {
  BAG_MAX, PRICES, REROLL, buy, buyExpand, expandPrice, gridOf, incomeFor, newRun, nextExpand, priceOf, reroll, sell, toBuild,
  upgradeOf, type RunState,
} from './run';
import { SKILLS, SKILL_LIST, lvOf, nodeOf, type Effect, type SkillNode, type Variant } from './skills';
import { ARCHES, type Archetype, type Build, type Rot, type SkillInstance } from './types';

/**
 * Rule-based bot (no LLM). Plays through the same run API as a human.
 * Used for: AI opponents when there are few player builds, balance testing (npm run sim),
 * and later the player-configured bots (โควตา/กฎ in the vision doc).
 *
 * Difficulty tiers:
 * - easy:   no rerolls, noisy picks, at most 1 purchase a day on days 1–3 (1 or 2 later), lazy bots skip early upgrades,
 *           never makes room for a new skill, packs blocks first-fit (ignores connect bonuses).
 * - normal: archetype / hero preference, 2 rerolls a day, fills free grid space before upgrading, makes room (grid expansion or selling a weaker skill),
 *           greedy packing that turns on connect bonuses.
 * - hard:   values skills by their numbers, buys for connect bonuses and engine neighbours, finishes upgrade branches
 *           that fit the build, buys anti-control when its archetype has none, spends its gold (rerolls, expansions),
 *           and searches many layouts for the most active bonuses + engine adjacency.
 * Every tier makes sure the build owns (and places) a damage skill with a short cooldown, so it always casts early.
 */
export type BotTier = 'easy' | 'normal' | 'hard';
export const BOT_TIERS: BotTier[] = ['easy', 'normal', 'hard'];

export interface BotRules {
  /** archetypes in priority order */
  prefer: Archetype[];
  /** gold to keep after rerolling */
  reserve: number;
  maxRerolls: number;
  /** default 'normal' */
  tier?: BotTier;
}

/** Default rules for a tier. */
export function botRules(prefer: Archetype[], tier: BotTier = 'normal'): BotRules {
  if (tier === 'easy') return { prefer, reserve: 0, maxRerolls: 0, tier };
  if (tier === 'hard') return { prefer, reserve: 0, maxRerolls: 8, tier };
  return { prefer, reserve: 0, maxRerolls: 2, tier };
}

// ---------------- skill facts read from the skill data (no hard-coded skill lists) ----------------

/** "Fires early": cooldown at most this many ticks (5s). */
export const EARLY_CD = 50;
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
/** An archetype is weak to control when none of its own skills answer it at Lv1. */
export const weakToControl = (arch: Archetype) => !SKILL_LIST.some((d) => d.arch === arch && isAntiControl(d.id));
const isEngine = (k: Pick<SkillInstance, 'id' | 'v'>) => !!nodeOf(k).engine;

type Has = Set<Effect['k']>;
/** Rough strength of one variant per second of cooldown (hard bot only; tuning numbers, not game rules). */
function nodeValue(n: SkillNode, has: Has): number {
  let v = 0;
  for (const e of n.fx) {
    switch (e.k) {
      case 'hit': {
        let d = e.n;
        if (e.shieldPct) d += e.shieldPct * (has.has('shield') ? 10 : 4);
        if (e.thornsX) d += e.thornsX * (has.has('thorns') ? 3 : 1.5);
        if (e.burnPct) d += e.burnPct * (has.has('burn') ? 10 : 3);
        d *= e.times ?? 1;
        if (e.pierce) d *= 1 + 0.25 * e.pierce;
        if (e.exec) d *= 1 + (e.exec[1] - 1) * 0.35;
        if (e.frozen) d *= has.has('freeze') ? 1 + (e.frozen - 1) * 0.5 : 1;
        if (e.noShield) d *= 1 + (e.noShield - 1) * 0.6;
        if (e.ifSlowed) d *= has.has('slow') ? 0.8 : 0.2;
        if (e.leech) d *= 1 + e.leech;
        if (e.burn) d += e.burn[0] * e.burn[1];
        if (e.perRemoved) d += e.perRemoved * 0.5;
        v += d;
        break;
      }
      case 'shield': v += e.n * 0.7; break;
      case 'heal': v += e.n * 0.8; break;
      case 'burn': v += e.dps * e.secs * 0.8 + (e.growthHalf && has.has('grow') ? 4 : 0); break;
      case 'freeze': v += e.secs * 6; break;
      case 'slow': v += e.pct * e.secs * 8; break;
      case 'delay': v += e.secs * 5; break;
      case 'grow': v += e.n * 4; break;
      case 'charge': v += (e.mult - 1) * 7 * (e.hits ?? 1); break;
      case 'thorns': v += e.n * (e.perm ? 4 : 2.5); break;
      case 'steadfast': v += 3; break;
      case 'cleanse': v += 2; break;
      case 'dispel': v += 3; break;
      case 'amplify': v += has.has('grow') || has.has('thorns') || has.has('charge') ? 6 : 1; break;
      case 'leech': v += e.pct * 8; break;
    }
  }
  // an engine is worth what it makes its neighbours do (layout score); on its own it counts as a mid skill
  if (n.engine) v += 4 * n.engine.power * (n.engine.n ?? 1) * (n.engine.kind === 'overclock' ? 2 : 1);
  return v / Math.max(1, n.cd / 10);
}

/** Effect kinds present in the build (for branch synergy: shieldPct wants shields, frozen wants freeze, ...). */
function effectsOf(skills: SkillInstance[]): Has {
  const has: Has = new Set();
  for (const k of skills) for (const e of nodeOf(k).fx) has.add(e.k);
  return has;
}
/** What one fire of a block is worth (value per second × cooldown in seconds). Engines fire blocks, not effects. */
const fireValue = (k: Pick<SkillInstance, 'id' | 'v'>, has: Has) => {
  const n = nodeOf(k);
  return n.engine ? 0 : nodeValue(n, has) * Math.max(1, n.cd / 10);
};

// ---------------- grid layout ----------------

const BONUS_W = { trigger: 2, power: 1.5, haste: 1.2, dmg: 1.5, shield: 1 } as const;

/**
 * Value per second engines add through their neighbours: ฟันเฟือง (gear) fires `n` touching blocks per fire,
 * round-robin, so it wants a few strong neighbours; เร่งเครื่อง (overclock) fires every touching block, so it wants
 * many heavy ones.
 */
export function engineScore(skills: SkillInstance[], w: number, h: number, has = effectsOf(skills)): number {
  const nb = neighbours(skills, w, h);
  let v = 0;
  skills.forEach((k, i) => {
    if (k.x < 0) return;
    const en = nodeOf(k).engine;
    if (!en) return;
    const vals = nb[i].map((j) => fireValue(skills[j], has)).filter((x) => x > 0);
    if (!vals.length) return;
    const perSec = 10 / Math.max(5, nodeOf(k).cd);
    const sum = vals.reduce((a, b) => a + b, 0);
    v += en.kind === 'gear' ? perSec * en.power * Math.min(en.n ?? 1, vals.length) * (sum / vals.length) : perSec * en.power * sum;
  });
  return v;
}

/** Greedy packing: biggest blocks first, each at the spot that turns on the most connect bonuses. */
export function arrange(s: RunState) {
  arrangeOrder(s, biggestFirst(s));
}

const biggestFirst = (s: RunState) =>
  s.skills.map((_, i) => i).sort((a, b) => shapeSize(s.skills[b].shape) - shapeSize(s.skills[a].shape) || a - b);

/**
 * Score of the current layout: every placed block counts far more than bonuses (never leave a skill out to win a
 * bonus), then the weight of every active connect bonus. -Infinity when the bag would overflow.
 */
export function layoutScore(s: RunState): number {
  const { w, h } = gridOf(s);
  const bagged = s.skills.filter((k) => k.x < 0).length;
  if (bagged > BAG_MAX) return -Infinity;
  let score = (s.skills.length - bagged) * 1000;
  for (const a of activeBonuses(s.skills, w, h)) score += BONUS_W[a.b.e] * 10;
  return score;
}

/** layoutScore + engine adjacency + an early hitter on the grid (hard bot). */
function hardLayoutScore(s: RunState, has: Has): number {
  const base = layoutScore(s);
  if (base === -Infinity) return base;
  const { w, h } = gridOf(s);
  const hitterPlaced = s.skills.some((k) => k.x >= 0 && isEarlyHitter(k));
  return base + engineScore(s.skills, w, h, has) * 10 + (hitterPlaced ? 5000 : 0);
}

export interface AutoResult {
  /** active connect bonuses before / after */
  before: number;
  after: number;
  /** false when the current layout was already the best found (nothing moved) */
  changed: boolean;
}

type Layout = { x: number; y: number; rot: Rot }[];
const snapshotOf = (s: RunState): Layout => s.skills.map((k) => ({ x: k.x, y: k.y, rot: k.rot }));
const restoreTo = (s: RunState, l: Layout) => l.forEach((p, i) => Object.assign(s.skills[i], p));

/** Greedy packing with many seeded shuffled orders; keeps the best layout by `score` (never worse than the current). */
function searchLayout(s: RunState, tries: number, score: () => number, salt: string, engines?: Has): Layout {
  const original = snapshotOf(s);
  let best = original;
  let bestScore = score();
  const rng = new Rng(hashSeed(s.seed, s.day, s.skills.length, salt));
  for (let t = 0; t < tries; t++) {
    let order = biggestFirst(s);
    if (t > 0) {
      // shuffle, but keep a bias towards big blocks first so everything still fits
      order = order
        .map((i, rank) => ({ i, key: rank + rng.next() * s.skills.length * (t % 3 === 0 ? 0.5 : 1.5) }))
        .sort((a, b) => a.key - b.key)
        .map((x) => x.i);
    }
    arrangeOrder(s, order, engines);
    const sc = score();
    if (sc > bestScore) {
      bestScore = sc;
      best = snapshotOf(s);
    }
  }
  restoreTo(s, best);
  return best;
}

/**
 * Auto-arrange for players: run the greedy packing with the biggest-first order and many seeded shuffles,
 * keep the layout with the best score. Never returns a worse layout than the current one. Deterministic.
 */
export function autoArrange(s: RunState, tries = 80): AutoResult {
  const { w, h } = gridOf(s);
  const original = snapshotOf(s);
  const before = activeBonuses(s.skills, w, h).length;
  const best = searchLayout(s, tries, () => layoutScore(s), 'auto');
  return { before, after: activeBonuses(s.skills, w, h).length, changed: best !== original };
}

/**
 * Greedy packing in a given order: each block goes to the spot (and rotation) that turns on the most bonuses.
 * With `engines` (the build's effect kinds), touching an engine also counts what the engine would make it do.
 */
function arrangeOrder(s: RunState, order: number[], engines?: Has, plain = false) {
  const { w, h } = gridOf(s);
  for (const k of s.skills) Object.assign(k, { x: -1, y: -1 });
  // occupancy of blocks placed so far (blocks are placed one by one, so this only grows)
  const g = new Int16Array(w * h).fill(-1);
  for (const i of order) {
    const k = s.skills[i];
    const kEngine = engines ? nodeOf(k).engine : undefined;
    const kFire = engines ? fireValue(k, engines) : 0;
    let best: { x: number; y: number; rot: Rot; cells: [number, number][] } | null = null;
    let bestScore = -Infinity;
    for (let r = 0; r < 4; r++) {
      const rot = r as Rot;
      const shape = cellsOf(k.shape, rot);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const cells = shape.map(([cx, cy]) => [x + cx, y + cy] as [number, number]);
          if (!cells.every(([cx, cy]) => cx < w && cy < h && g[cy * w + cx] === -1)) continue;
          // touching placed blocks
          const touch = new Set<number>();
          for (const [cx, cy] of cells)
            for (let d = 0; d < 4; d++) {
              const nx = cx + DX[d];
              const ny = cy + DY[d];
              if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
              const j = g[ny * w + nx];
              if (j >= 0) touch.add(j);
            }
          // only bonuses involving block i change: its own (any touching match) and each neighbour's (i matches)
          let score = -0.001 * (y * w + x);
          if (plain) {
            // first fit: the first free spot in reading order, rotation 0 first
            if (score > bestScore) {
              bestScore = score;
              best = { x, y, rot, cells };
            }
            continue;
          }
          for (const b of k.bonus) if ([...touch].some((j) => matches(b.t, s.skills[j]))) score += BONUS_W[b.e];
          for (const j of touch) {
            const nb = s.skills[j];
            for (const b of nb.bonus) {
              if (!matches(b.t, k)) continue;
              // only counts if no other neighbour of j already turns it on
              if (!neighbourMatch(s, g, w, h, j, b.t)) score += BONUS_W[b.e];
            }
            if (engines) {
              // engine adjacency, in the same units as engineScore (scaled like a bonus weight)
              const jEngine = nodeOf(nb).engine;
              if (kEngine && !jEngine) score += 0.15 * kEngine.power * fireValue(nb, engines);
              if (jEngine && !kEngine) score += 0.15 * jEngine.power * kFire;
            }
          }
          if (score > bestScore) {
            bestScore = score;
            best = { x, y, rot, cells };
          }
        }
    }
    if (best) {
      Object.assign(k, { x: best.x, y: best.y, rot: best.rot });
      for (const [cx, cy] of best.cells) g[cy * w + cx] = i;
    }
  }
}

/** Does any block already touching placed block j match condition t? */
function neighbourMatch(s: RunState, g: Int16Array, w: number, h: number, j: number, t: string) {
  for (const [cx, cy] of footprint(s.skills[j]))
    for (let d = 0; d < 4; d++) {
      const nx = cx + DX[d];
      const ny = cy + DY[d];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const o = g[ny * w + nx];
      if (o >= 0 && o !== j && matches(t, s.skills[o])) return true;
    }
  return false;
}

/** easy: first fit, biggest first, connect bonuses ignored. */
function arrangePlain(s: RunState) {
  arrangeOrder(s, biggestFirst(s), undefined, true);
}

/** If no early hitter ended up on the grid, pack again with the early hitters first. */
function placeHitter(s: RunState, engines?: Has) {
  if (!s.skills.some(isEarlyHitter) || s.skills.some((k) => k.x >= 0 && isEarlyHitter(k))) return;
  const order = biggestFirst(s);
  const first = order.filter((i) => isEarlyHitter(s.skills[i]));
  arrangeOrder(s, [...first, ...order.filter((i) => !first.includes(i))], engines);
}

// ---------------- shop helpers ----------------

const cellsUsed = (s: RunState) => s.skills.reduce((n, k) => n + shapeSize(k.shape), 0);
const cellsFree = (s: RunState) => {
  const { w, h } = gridOf(s);
  return w * h - cellsUsed(s);
};
/** Room on the grid for a new block of this shape (by cell count; the layout pass packs it). */
const hasRoom = (s: RunState, shape: string, slack = 0) => cellsFree(s) - slack >= shapeSize(shape);
/** Cell count after the next grid expansion (0 when the grid is at max). */
const expandGain = (s: RunState) => {
  const what = nextExpand(s);
  if (!what) return 0;
  const { w, h } = gridOf(s);
  return what === 'col' ? h : w;
};

/** How many early hitters the bot owns. */
const ownedHitters = (s: RunState) => s.skills.filter(isEarlyHitter).length;

const weakest = (s: RunState, keep: (k: SkillInstance) => number, ok: (k: SkillInstance) => boolean = () => true) => {
  let w = -1;
  s.skills.forEach((k, i) => {
    if (!ok(k)) return;
    if (w < 0 || keep(k) < keep(s.skills[w])) w = i;
  });
  return w;
};

/** Sell the weakest skills (by `keep`) until a block of `shape` fits; false if even that does not make room. */
function makeRoomBySelling(s: RunState, shape: string, keep: (k: SkillInstance) => number, limit: number): boolean {
  for (let n = 0; n < 3 && !hasRoom(s, shape); n++) {
    const w = weakest(s, keep);
    if (w < 0 || keep(s.skills[w]) >= limit) return false;
    sell(s, w);
  }
  return hasRoom(s, shape);
}

/**
 * Guarantee: the build owns a damage skill that fires early. Buys the cheapest such offer (making room by selling
 * the weakest non-hitter if needed), rerolling a few times when the shop has none. Returns false if it could not.
 */
function ensureHitter(s: RunState, keep: (k: SkillInstance) => number): boolean {
  for (let tries = 0; tries < 4; tries++) {
    if (ownedHitters(s) > 0) return true;
    let pick = -1;
    s.shop.forEach((o, i) => {
      if (!o || o.v !== '' || s.skills.some((k) => k.id === o.id) || !isEarlyHitter({ id: o.id, v: '' })) return;
      if (pick < 0 || priceOf(o) < priceOf(s.shop[pick]!)) pick = i;
    });
    if (pick >= 0) {
      const o = s.shop[pick]!;
      // sell the weakest skills until the hitter fits and is affordable
      for (let n = 0; n < 4 && (!hasRoom(s, o.shape) || priceOf(o) > s.gold); n++) {
        const w = weakest(s, keep);
        if (w < 0) break;
        sell(s, w);
      }
      if (hasRoom(s, o.shape) && priceOf(o) <= s.gold && !buy(s, pick)) return true;
    }
    if (s.day <= 1 || s.gold < REROLL + PRICES[0]) return false;
    reroll(s);
  }
  return ownedHitters(s) > 0;
}

// ---------------- shop turn ----------------

/**
 * One shop day for a bot of any tier: shop, then arrange the grid. `fullLayout` = false skips the hard bot's layout
 * search (one greedy pass instead), for days whose build never fights (aiBuild's earlier days).
 */
export function botShopTurn(s: RunState, rules: BotRules, fullLayout = true) {
  const tier = rules.tier ?? 'normal';
  if (tier === 'hard') return hardShopTurn(s, rules, fullLayout);
  const rng = new Rng(hashSeed(s.seed, 'bot', s.day, tier));
  const easy = tier === 'easy';
  let rerolls = 0;
  const want = HEROES_BY_ID[s.hero]?.botWant ?? [];
  /** how much the bot likes a skill (0 = not at all) */
  const like = (id: string) => {
    const d = SKILLS[id];
    let score = 0;
    const pi = rules.prefer.indexOf(d.arch as Archetype);
    if (pi >= 0) score += 3 - pi;
    if (d.hero) score += 3;
    if (!easy && want.includes(id)) score += 2;
    return score;
  };
  /** value of an owned skill when deciding what to sell; the last early hitter is never sold */
  const keep = (k: SkillInstance) => like(k.id) * 2 + lvOf(k.v) + (isEarlyHitter(k) && ownedHitters(s) <= 1 ? 100 : 0);
  ensureHitter(s, keep);
  // easy: most easy bots skip upgrades on days 1–3; at most 1 purchase a day early, then 1 or 2 (every other day)
  const lazy = easy && s.day <= 3 && new Rng(hashSeed(s.seed, 'lazy')).next() < 0.7;
  const buyCap = !easy ? 99 : s.day <= 3 ? 1 : 1 + (s.day % 2);
  let bought = 0;
  for (let guard = 0; guard < 40 && bought < buyCap; guard++) {
    let best = -1;
    let bestScore = 0;
    s.shop.forEach((offer, i) => {
      if (!offer) return;
      const id = offer.id;
      if (priceOf(offer) > s.gold) return;
      let score: number;
      if (offer.v !== '') {
        if (!upgradeOf(s, offer) || lazy) return;
        score = easy ? 1.5 : 3; // an upgrade of something we own (easy undervalues upgrades)
      } else {
        if (s.skills.some((k) => k.id === id)) return;
        // free grid space is worth filling with anything (normal fills it before upgrading; easy does not care)
        score = hasRoom(s, offer.shape) ? (easy ? 2 : 3.5) : 1;
      }
      // normal: liking counts half for upgrades, so a liked new block beats stacking levels on one block
      score += easy ? like(id) * 0.5 + rng.next() * 3 : offer.v !== '' ? like(id) * 0.5 : like(id);
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    });
    if (best >= 0 && bestScore >= 2) {
      const offer = s.shop[best]!;
      if (offer.v === '' && !hasRoom(s, offer.shape)) {
        if (easy) {
          s.shop[best] = null; // easy never makes room
          continue;
        }
        // make room: buy grid space if it leaves enough gold, else swap out a weaker skill
        if (expandGain(s) > 0 && s.gold >= expandPrice(s) + priceOf(offer) && cellsFree(s) + expandGain(s) >= shapeSize(offer.shape)) buyExpand(s);
        else if (!makeRoomBySelling(s, offer.shape, keep, like(offer.id) * 2 + 1)) {
          s.shop[best] = null; // not worth it: ignore this offer for today
          continue;
        }
      }
      if (buy(s, best)) s.shop[best] = null;
      else bought++;
      continue;
    }
    if (rerolls < rules.maxRerolls && s.gold >= REROLL + PRICES[0] + rules.reserve) {
      reroll(s);
      rerolls++;
      continue;
    }
    break;
  }
  if (easy) arrangePlain(s);
  else arrange(s);
  placeHitter(s);
}

/** hard tier: numbers-aware shopping, connect bonuses, engines, coherent upgrades, anti-control, gold spent. */
function hardShopTurn(s: RunState, rules: BotRules, fullLayout: boolean) {
  const hero = HEROES_BY_ID[s.hero];
  const want = hero?.botWant ?? [];
  const arch = hero?.arch ?? rules.prefer[0];
  const needAnti = weakToControl(arch) && s.day >= 4;
  const pref = (id: string) => {
    const d = SKILLS[id];
    const pi = rules.prefer.indexOf(d.arch as Archetype);
    return (pi >= 0 ? 2 - pi * 0.5 : 0) + (d.hero ? 2.5 : 0) + (want.includes(id) ? 1.5 : 0);
  };
  // the build's effect kinds, recomputed only when the skills change (version)
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
  ensureHitter(s, keep);
  version++;
  const hasAnti = () => s.skills.some((k) => isAntiControl(k.id) || nodeAntiControl(nodeOf(k)));

  /** Connect potential of a new block: its bonuses that an owned skill could switch on, owned bonuses it matches, engines. */
  const linkPotential = (o: Offer) => {
    let v = 0;
    for (const b of o.bonus) if (s.skills.some((k) => matches(b.t, k))) v += BONUS_W[b.e];
    for (const k of s.skills) for (const b of k.bonus) if (matches(b.t, { id: o.id })) v += BONUS_W[b.e] * 0.5;
    const has = hasNow();
    const inst = { id: o.id, v: '' };
    const en = nodeOf(inst).engine;
    if (en) {
      // best neighbours it could get: the strongest owned non-engine blocks
      const vals = s.skills.filter((k) => !isEngine(k)).map((k) => fireValue(k, has)).sort((a, b) => b - a);
      const n = en.kind === 'gear' ? Math.min(en.n ?? 1, vals.length) : Math.min(3, vals.length);
      const top = vals.slice(0, Math.max(1, n));
      const avg = top.length ? top.reduce((a, b) => a + b, 0) / top.length : 0;
      v += (10 / Math.max(5, nodeOf(inst).cd)) * en.power * avg * n * 0.6;
    } else if (s.skills.some(isEngine)) v += fireValue(inst, has) * 0.05;
    return v;
  };

  /** score of an offer = value gained per gold (0 = skip) */
  const score = (o: Offer): number => {
    const has = hasNow();
    if (o.v !== '') {
      const owned = upgradeOf(s, o);
      if (!owned) return 0;
      const gain = nodeValue(nodeOf({ id: o.id, v: o.v }), has) - nodeValue(nodeOf(owned), has);
      // finishing a branch (Lv2 → Lv3) on a skill that fits the build is worth more than spreading gold thin
      const branch = lvOf(owned.v) === 2 ? 1.5 : 0.5;
      // a Lv2 variant whose Lv3 children suit the build (best child value) is a coherent branch to start
      const kids = lvOf(o.v) === 2 ? Math.max(...(['1', '2'] as const).map((c) => nodeValue(nodeOf({ id: o.id, v: (o.v + c) as Variant }), has))) * 0.2 : 0;
      if (gain + kids <= 0) return 0;
      return (gain + kids + branch + pref(o.id) * 0.5 + 0.8 /* +1 connect bonus */) / priceOf(o);
    }
    if (s.skills.some((k) => k.id === o.id)) return 0;
    let v = instValue({ id: o.id, v: '' }, has) + linkPotential(o) * 0.8;
    if (needAnti && !hasAnti() && isAntiControl(o.id)) v += 6;
    if (hasRoom(s, o.shape)) v += 3; // empty grid space fights for nothing
    return v / priceOf(o);
  };

  // offer scores only change when the skills change: cache them per version
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
      if (!o || priceOf(o) > s.gold) return;
      const sc = cachedScore(o);
      if (sc > bestScore) {
        bestScore = sc;
        best = i;
      }
    });
    if (best >= 0 && bestScore > 0.3) {
      const o = s.shop[best]!;
      if (o.v === '' && !hasRoom(s, o.shape)) {
        const canExpand = expandGain(s) > 0 && s.gold >= expandPrice(s) + priceOf(o) && cellsFree(s) + expandGain(s) >= shapeSize(o.shape);
        if (canExpand && s.day >= 2) buyExpand(s);
        else {
          const newV = instValue({ id: o.id, v: '' }) + linkPotential(o) * 0.8 + (needAnti && !hasAnti() && isAntiControl(o.id) ? 6 : 0);
          if (makeRoomBySelling(s, o.shape, keep, newV - 1)) version++;
          else {
            s.shop[best] = null;
            continue;
          }
        }
      }
      if (buy(s, best)) s.shop[best] = null;
      version++;
      continue;
    }
    // nothing worth buying: from day 3 grid space is better than a gold pile when the grid is (nearly) full
    if (s.day >= 3 && expandGain(s) > 0 && s.gold >= expandPrice(s) + PRICES[0] && cellsFree(s) < 3) {
      buyExpand(s);
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
  const has = effectsOf(s.skills);
  if (fullLayout) searchLayout(s, HARD_LAYOUT_TRIES, () => hardLayoutScore(s, has), 'hard', has);
  else arrangeOrder(s, biggestFirst(s), has);
  placeHitter(s, has);
}

/** Layouts the hard bot tries each fighting day. */
const HARD_LAYOUT_TRIES = 40;

/** One full shop day for a bot that fights today (shop + arrange). */
export const botDay = (s: RunState, rules: BotRules) => botShopTurn(s, rules, true);

/** Build a bot's build as of `day`, by running its shop turns day by day. */
export function aiBuild(hero: string, day: number, prefer: Archetype[], seed: number, tier: BotTier = 'normal'): Build {
  return toBuild(aiRun(hero, day, prefer, seed, tier));
}

/** The bot's run state after its shop on `day` (aiBuild without the toBuild; the simulator reads its unspent gold). */
export function aiRun(hero: string, day: number, prefer: Archetype[], seed: number, tier: BotTier = 'normal'): RunState {
  const s = newRun(hero, seed, 'ai');
  const rules = botRules(prefer, tier);
  for (let d = 1; d <= day; d++) {
    if (d > 1) {
      s.day = d;
      s.gold += incomeFor(d, 0).base;
      s.rolls = 0;
      reroll(s); // costs 1, but gives a fresh shop for the day
      s.gold += 1;
    }
    botShopTurn(s, rules, d === day);
  }
  return s;
}

export function randomAiBuild(day: number, seed: number, tier: BotTier = 'normal'): Build {
  const rng = new Rng(seed);
  const hero = rng.pick(HEROES);
  const second = rng.pick(ARCHES.filter((a) => a !== hero.arch));
  return aiBuild(hero.id, day, [hero.arch, second], hashSeed(seed, 'ai'), tier);
}
