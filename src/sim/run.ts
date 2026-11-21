import { Rng, hashSeed } from './rng';
import { HEROES, HEROES_BY_ID, ULT_PIECES, inLine, ultPieces } from './heroes';
import { rollBonuses } from './links';
import { MAX_RELICS, RELIC_DAYS, isRelic, rollRelicOffer, skillLinesOf } from './relics';
import { T } from './tuning';
import { SKILLS, SKILL_LIST, lvOf, nextVariants, type Variant } from './skills';
import type { Bonus, Build, Mark, SkillInstance } from './types';

/** One run (รอบ) of the game: pick skills day by day until 10 wins or HP runs out. */

/** HP at the start of a run (tuning.ts `run.startHp`) */
export const START_HP = T['run.startHp'];
export const WIN_TARGET = 10;
export const SHOP_SIZE = 5;
/** price by the level you buy: Lv1 skill, Lv2 upgrade, Lv3 upgrade (hero-unique skills +1) */
export const PRICES = [3, 4, 5];
export const REROLL = 1;
export const MAX_LV = 3;
/** gold on day 1: enough for two Lv1 skills, or the hero's unique + one Lv1 */
export const DAY1_GOLD = 7;
/** Skill slots: 3 on day 1, +1 every 3 days up to 6; buying slots can go up to MAX_SLOTS. */
export const MAX_SLOTS = 8;
/** Lv3 upgrades are offered from this day on (shop, moon wish, bots): before it a Lv2 skill gets no upgrade card */
export const LV3_DAY = 4;
/** เสบียงสุดท้าย when the slots are already at MAX_SLOTS: this much gold instead of 8 + a slot */
export const SUPPLY_GOLD_FULL = 12;
/** shop rolls: a new skill of the hero's own line is this many times as likely as any other skill */
export const LINE_WEIGHT = 2;
/** from this day the hero's unique, when not owned, is always in the shop (one place) */
export const UNIQUE_BACK_DAY = 3;
/** can a skill at variant v be upgraded on this day? */
export const canUpgrade = (v: string, day: number) => lvOf(v) < MAX_LV && (lvOf(v) < 2 || day >= LV3_DAY);
/** ★ after Lv3 (sim v17): a Lv3 skill's duplicate card adds a star, up to STAR_MAX, offered from STAR_DAY */
export const STAR_MAX = 3;
export const STAR_DAY = 7;
/** price of the 1st / 2nd / 3rd star */
export const STAR_PRICES = [3, 4, 5];
/** at most this many star cards in one shop roll (so they never crowd out line and ult cards) */
export const STAR_PER_ROLL = 1;
export const canStar = (k: SkillInstance, day: number) => lvOf(k.v) >= MAX_LV && (k.star ?? 0) < STAR_MAX && day >= STAR_DAY;

/**
 * Shop offer: a skill at a tree variant. v = '' is a new Lv1 skill (with its rolled connect bonuses); any other v is
 * an upgrade of a skill you own (its next variant, one of two, picked at random by the shop; the skill keeps its bonuses).
 */
export interface Offer {
  id: string;
  /** '' = new Lv1 skill; an upgrade carries the FIRST of the two next branches, the buyer picks either (sim v17) */
  v: string;
  bonus?: Bonus[];
  /** a star card: the star the owned Lv3 skill gets (1–3) */
  star?: number;
}
/** the branches an upgrade offer lets the buyer pick from (empty for a new skill or a star) */
export const offerChoices = (s: RunState, o: Offer): Variant[] => {
  if (o.v === '' || o.star) return [];
  const owned = s.skills.find((k) => k.id === o.id);
  return owned ? nextVariants(owned.v) : [];
};

/** Heroes offered when a run starts (5 later with the pass). */
export const HERO_CHOICES = 3;

/**
 * The heroes a run may start with: `n` different heroes (so `n` different lines), rolled from the seed.
 * Same seed → same choices, so the server can check the pick later (Phase 2).
 */
export function heroChoices(seed: number, n = HERO_CHOICES): string[] {
  const rng = new Rng(hashSeed(seed, 'heroes'));
  const pool = HEROES.map((h) => h.id);
  const out: string[] = [];
  while (out.length < n && pool.length) out.push(pool.splice(rng.int(pool.length), 1)[0]);
  return out;
}

export type LastChanceOption = 'awaken' | 'mark' | 'supply';
export const MARKS: Mark[] = ['burn', 'echo', 'quick', 'steadfast'];
export const MARK_INFO: Record<Mark, { name: string; desc: string }> = {
  burn: { name: 'เผาไหม้', desc: 'ทุกครั้งที่ใช้ ศัตรูติดไฟ 1/วิ นาน 3 วิ' },
  echo: { name: 'ตีซ้ำ', desc: 'ทำงานซ้ำอีกครั้งที่แรง 50%' },
  quick: { name: 'ร่ายไว', desc: 'คูลดาวน์ลด 40%' },
  steadfast: { name: 'ไม่หวั่นไหว', desc: 'คูลดาวน์ยังเดินต่อแม้โดนแช่แข็ง' },
};

export interface LogEntry {
  day: number;
  won: boolean;
  opp: string;
  ai: boolean;
  fightId?: string;
  /** a draw: no win, no HP lost */
  draw?: boolean;
}

/** Saved-run format version: runs saved with another version are dropped by the client (v9 = sim v13 lines r2). */
export const RUN_VERSION = 10;

export interface RunState {
  v: typeof RUN_VERSION;
  id: string;
  seed: number;
  hero: string;
  day: number;
  hp: number;
  wins: number;
  losses: number;
  gold: number;
  /** +n = n wins in a row, -n = n losses in a row */
  streak: number;
  lastIncome: { base: number; bonus: number };
  /** extra skill slots (bought in the shop, or from เสบียงสุดท้าย) */
  bonusSlots: number;
  /** how many times a slot was bought (price goes up) */
  slotBuys: number;
  /** equipped skills, top to bottom (all of them fight) */
  skills: SkillInstance[];
  shop: (Offer | null)[];
  rolls: number;
  ghost: boolean;
  pendingMark: Mark | null;
  phase: 'shop' | 'relic' | 'lastchance' | 'mark' | 'won' | 'dead';
  rating: number;
  log: LogEntry[];
  /** the player gave up this run */
  conceded?: boolean;
  /** shop lock: locks[i] = offer i is kept through rerolls and into the next day (until bought or unlocked) */
  locks?: boolean[];
  /** moon wishes bought today (the price goes up with each one) */
  wishes?: number;
  /** marks carved by wishes this run (at most WISH_MARKS_MAX) */
  wishMarks?: number;
  /** run relics owned (relics.ts), at most MAX_RELICS */
  relics?: string[];
  /** the 3 relics offered today (phase 'relic') */
  relicOffer?: string[];
  /** relic days already offered (picked or skipped) */
  relicDays?: number[];
  /** the server's relic offer for a coming day (fight response nextRelics): used instead of the local roll */
  relicNext?: { day: number; ids: string[] };
}

/** Skill slots on a day: 3 on days 1–3, 4 on 4–6, 5 on 7–9, 6 from day 10, plus bonus slots (max MAX_SLOTS). */
export function slotsFor(day: number, bonus = 0) {
  return Math.min(MAX_SLOTS, Math.min(6, 3 + Math.floor((day - 1) / 3)) + bonus);
}
export const slotsOf = (s: RunState) => slotsFor(s.day, s.bonusSlots);

/** Price of the next skill slot in the shop. */
export const slotPrice = (s: RunState) => 4 + 2 * s.slotBuys;

/** Buy +1 skill slot for the rest of the run. */
export function buySlot(s: RunState): string | null {
  if (slotsOf(s) >= MAX_SLOTS) return 'ช่อง skill เต็มแล้ว';
  const price = slotPrice(s);
  if (s.gold < price) return 'เงินไม่พอ';
  s.gold -= price;
  s.bonusSlots++;
  s.slotBuys++;
  return null;
}
export const priceOf = (o: Offer) => (o.star ? STAR_PRICES[o.star - 1] : PRICES[lvOf(o.v) - 1] + (SKILLS[o.id].hero ? 1 : 0));
/** gold back when selling: 1 / 2 / 3 by level, +1 per star */
export const sellPrice = (k: SkillInstance) => lvOf(k.v) + (k.star ?? 0);
/**
 * HP lost on a defeat: 2 on days 1–3, 3 on days 4–6, 4 on days 7–9, 5 from day 10 (capped), so a good run to 10 wins
 * (≈ day 13–16) survives 3–4 defeats, plus the last chance.
 */
export const LOSS_CAP = 3;
export const damageFor = (day: number) => Math.min(LOSS_CAP, 1 + Math.ceil(Math.max(1, day) / T['run.lossEvery']));

/** Win streak bonus is clearly bigger than the loss-streak comeback money. */
export function incomeFor(day: number, streak: number) {
  const base = day <= 1 ? DAY1_GOLD : 5 + Math.min(Math.floor(day / 2), 3);
  const bonus = streak >= 5 ? 3 : streak >= 3 ? 2 : streak >= 2 ? 1 : streak <= -2 ? 1 : 0;
  return { base, bonus };
}

export function newRun(hero: string, seed: number, id: string): RunState {
  const s: RunState = {
    v: RUN_VERSION, id, seed, hero, day: 1, hp: T['run.startHp'], wins: 0, losses: 0, gold: 0, streak: 0,
    lastIncome: { base: 0, bonus: 0 }, bonusSlots: 0, slotBuys: 0, skills: [], shop: [], rolls: 0,
    ghost: false, pendingMark: null, phase: 'shop', rating: 1000, log: [],
  };
  beginDay(s);
  return s;
}

export function beginDay(s: RunState) {
  const inc = incomeFor(s.day, s.streak);
  s.lastIncome = inc;
  s.gold += inc.base + inc.bonus;
  s.rolls = 0;
  s.wishes = 0;
  rollShop(s);
  s.phase = 'shop';
  // relic days (sim v17): pick 1 of 3 relics (or skip) before the shop opens
  if (RELIC_DAYS.includes(s.day) && !(s.relicDays ?? []).includes(s.day) && (s.relics ?? []).length < MAX_RELICS) {
    s.relicDays = [...(s.relicDays ?? []), s.day];
    // a ranked run uses the offer the server sent (its seed is server-only); an offline run rolls its own
    const srv = s.relicNext?.day === s.day ? s.relicNext.ids.filter((id) => isRelic(id) && !(s.relics ?? []).includes(id)) : null;
    s.relicOffer = srv?.length ? srv : rollRelicOffer(s.seed, s.hero, s.day, s.relics ?? [], skillLinesOf(s.skills.slice(0, slotsOf(s)), (id) => SKILLS[id]?.line));
    delete s.relicNext;
    if (s.relicOffer.length) s.phase = 'relic';
  }
}

/** Take relic i of today's offer (-1 = skip). Then the shop opens. */
export function pickRelic(s: RunState, i: number): string | null {
  if (s.phase !== 'relic') return 'ไม่มีของวิเศษให้เลือก';
  const id = s.relicOffer?.[i];
  if (i >= 0) {
    if (!isRelic(id)) return 'ไม่มีของชิ้นนี้';
    s.relics = [...(s.relics ?? []), id];
  }
  s.relicOffer = [];
  s.phase = 'shop';
  return null;
}

/**
 * Connect bonuses of a skill's card in this run (sim v16): rolled once per run and skill, so the same card shows the
 * same bonuses on every day and every reroll (before, each roll re-rolled them and the text seemed to change).
 * Selling and buying the skill again gives the same bonuses back.
 */
export const bonusOf = (s: RunState, id: string) => rollBonuses(new Rng(hashSeed(s.seed, 'bonus', id)), id, s.hero);

/** Is this offer an upgrade that still applies to what you own? */
export function upgradeOf(s: RunState, o: Offer): SkillInstance | null {
  if (o.v === '') return null;
  const owned = s.skills.find((k) => k.id === o.id);
  if (o.star) return owned && owned.v === o.v && (owned.star ?? 0) + 1 === o.star ? owned : null;
  return owned && nextVariants(owned.v).includes(o.v as never) ? owned : null;
}
/** an upgrade card for owned skill k: its first next branch (the buyer picks a or b), or its next star */
const upOffer = (k: SkillInstance): Offer => (lvOf(k.v) >= MAX_LV ? { id: k.id, v: k.v, star: (k.star ?? 0) + 1 } : { id: k.id, v: nextVariants(k.v)[0] });

/**
 * Day 1: the hero's fixed shop (same every run). Day 2+: 5 random offers, a mix of new Lv1 skills and upgrades
 * (one random next variant per owned skill below Lv3; about half the offers are upgrades when there are some).
 */
function rollShop(s: RunState) {
  if (s.day <= 1) {
    // same skills every run; their connect bonuses are rolled per run
    s.shop = (HEROES_BY_ID[s.hero]?.day1 ?? []).slice(0, SHOP_SIZE).map((id) => ({ id, v: '', bonus: bonusOf(s, id) }));
    s.locks = [];
    return;
  }
  // locked offers stay in their place (unless they no longer apply); the other places are rolled fresh.
  // With no locks this is exactly the old roll, so bots and old runs are unchanged.
  const kept: (Offer | null)[] = Array.from({ length: SHOP_SIZE }, (_, i) => {
    const o = s.locks?.[i] ? s.shop[i] : null;
    return o && offerStillValid(s, o) ? o : null;
  });
  const keptIds = new Set(kept.filter((o): o is Offer => !!o).map((o) => o.id));
  const rng = new Rng(hashSeed(s.seed, s.day, s.rolls));
  const owned = new Set(s.skills.map((k) => k.id));
  const fresh = SKILL_LIST.filter((d) => (!d.hero || d.hero === s.hero) && !owned.has(d.id) && !keptIds.has(d.id)).map((d) => d.id);
  const ups = s.skills.filter((k) => canUpgrade(k.v, s.day) && !keptIds.has(k.id)).map((k) => k.id);
  // star cards (sim v17): Lv3 skills below ★★★, at most STAR_PER_ROLL per roll, and only in a share of rolls
  const starIds = s.skills.filter((k) => canStar(k, s.day) && !keptIds.has(k.id)).map((k) => k.id);
  let stars = starIds.length && rng.next() < (ups.length ? 0.5 : 0.8) ? STAR_PER_ROLL : 0;
  const picks: Offer[] = [];
  const need = SHOP_SIZE - keptIds.size;
  const line = HEROES_BY_ID[s.hero]?.line;
  // the unique comes back: from UNIQUE_BACK_DAY, a hero without its unique always finds it in the shop
  const uniq = HEROES_BY_ID[s.hero]?.unique;
  if (uniq && s.day >= UNIQUE_BACK_DAY && fresh.includes(uniq) && need > 0) {
    fresh.splice(fresh.indexOf(uniq), 1);
    picks.push({ id: uniq, v: '', bonus: bonusOf(s, uniq) });
  }
  /** weighted pick of a new skill: the hero's own line counts LINE_WEIGHT times */
  const pickFresh = () => {
    const w = fresh.map((id) => (SKILLS[id].line === line ? LINE_WEIGHT : 1));
    let r = rng.next() * w.reduce((a, b) => a + b, 0);
    let i = 0;
    while (i < w.length - 1 && (r -= w[i]) >= 0) i++;
    return fresh.splice(i, 1)[0];
  };
  // sim v15: while a line card is not owned, every roll has at least one new card of the hero's line (upgrades used to crowd them out)
  const lineNew = (o: Offer | null) => !!o && o.v === '' && SKILLS[o.id].line === line;
  if (picks.length < need && !picks.some(lineNew) && !kept.some(lineNew)) {
    const ids = fresh.filter((id) => SKILLS[id].line === line);
    if (ids.length) {
      const id = ids[rng.int(ids.length)];
      fresh.splice(fresh.indexOf(id), 1);
      picks.push({ id, v: '', bonus: bonusOf(s, id) });
    }
  }
  // sim v16: once the four line pieces are owned, every roll has an upgrade of a line skill (while one can still go up)
  const lineUp = (o: Offer | null) => !!o && o.v !== '' && inLine(s.hero, o.id);
  if (picks.length < need && ultPieces(s) >= ULT_PIECES[1] && !picks.some(lineUp) && !kept.some(lineUp)) {
    const ids = ups.filter((id) => inLine(s.hero, id));
    if (ids.length) {
      const id = ids[rng.int(ids.length)];
      ups.splice(ups.indexOf(id), 1);
      const k = s.skills.find((x) => x.id === id)!;
      picks.push(upOffer(k));
    }
  }
  while (picks.length < need && (fresh.length || ups.length || (stars > 0 && starIds.length))) {
    if (stars > 0 && starIds.length && (rng.next() < 0.35 || (!fresh.length && !ups.length))) {
      const id = starIds.splice(rng.int(starIds.length), 1)[0];
      picks.push(upOffer(s.skills.find((x) => x.id === id)!));
      stars--;
      continue;
    }
    const takeUp = ups.length > 0 && (fresh.length === 0 || rng.next() < 0.5);
    if (!takeUp && !fresh.length) break;
    if (takeUp) {
      const id = ups.splice(rng.int(ups.length), 1)[0];
      const k = s.skills.find((x) => x.id === id)!;
      picks.push(upOffer(k));
    } else {
      const id = pickFresh();
      picks.push({ id, v: '', bonus: bonusOf(s, id) });
    }
  }
  if (!keptIds.size) {
    s.shop = picks;
    s.locks = [];
    return;
  }
  s.locks = kept.map((o) => !!o);
  s.shop = kept.map((o) => o ?? picks.shift() ?? null);
}

/** A new-skill offer you don't own yet, or an upgrade that still fits the skill you own. */
function offerStillValid(s: RunState, o: Offer) {
  return o.v === '' ? !s.skills.some((k) => k.id === o.id) : !!upgradeOf(s, o);
}

/** Lock / unlock shop offer i (free): a locked offer survives rerolls and comes back in the next day's shop. */
export function toggleLock(s: RunState, i: number): string | null {
  if (!s.shop[i]) return 'ไม่มีของ';
  const locks = Array.from({ length: s.shop.length }, (_, k) => !!s.locks?.[k]);
  locks[i] = !locks[i];
  s.locks = locks;
  return null;
}
export const isLocked = (s: RunState, i: number) => !!s.locks?.[i] && !!s.shop[i];

/**
 * พรจันทร์ (moon wish), the late-run gold sink: upgrade one random owned skill below Lv3 to one of its next
 * branches (random). Once every skill is Lv3 it carves a random mark into a random unmarked skill instead.
 * Costs more than a normal upgrade because you don't choose, and +2 for every wish already made today.
 * Deterministic from the run seed, day and wish count.
 */
export const WISH_BASE = 6;
/** a wish that carves a mark costs this much more (sim v18: marks are a rare resource again) */
export const MARK_WISH_EXTRA = 4;
/** marks a run can get from wishes, at most (sim v18) */
export const WISH_MARKS_MAX = 2;
export const wishPrice = (s: RunState) => WISH_BASE + 2 * (s.wishes ?? 0) + (wishKind(s) === 'mark' ? MARK_WISH_EXTRA : 0);
/**
 * Least gold `n` mark wishes on one day can have cost (server ledger, validate.ts): the k-th wish of a day costs
 * WISH_BASE + 2k, a mark wish MARK_WISH_EXTRA more; earlier upgrade wishes that day only make it dearer.
 */
export const markWishCost = (n: number) => Array.from({ length: Math.max(0, n) }, (_, k) => WISH_BASE + MARK_WISH_EXTRA + 2 * k).reduce((a, b) => a + b, 0);
export type WishKind = 'upgrade' | 'mark' | null;
/**
 * What a wish does now: upgrade a random skill below Lv3; once EVERY skill is Lv3 (sim v18: not merely "none can go up
 * today"), carve a random mark into an unmarked skill, at most WISH_MARKS_MAX times a run.
 */
export function wishKind(s: RunState): WishKind {
  if (s.skills.some((k) => canUpgrade(k.v, s.day))) return 'upgrade';
  if (s.skills.length && s.skills.every((k) => lvOf(k.v) >= MAX_LV) && s.skills.some((k) => !k.mark) && (s.wishMarks ?? 0) < WISH_MARKS_MAX) return 'mark';
  return null;
}
export type WishResult = { err: string } | { idx: number; from: string; v?: string; mark?: Mark };
export function wish(s: RunState): WishResult {
  const kind = wishKind(s);
  if (!kind) return { err: 'พรจันทร์ใช้ไม่ได้ตอนนี้' };
  const price = wishPrice(s);
  if (s.gold < price) return { err: 'เงินไม่พอ' };
  const rng = new Rng(hashSeed(s.seed, 'wish', s.day, s.wishes ?? 0));
  const pool = s.skills.map((k, i) => ({ k, i })).filter(({ k }) => (kind === 'upgrade' ? canUpgrade(k.v, s.day) : !k.mark));
  const { k, i } = rng.pick(pool);
  const from = k.v;
  s.gold -= price;
  s.wishes = (s.wishes ?? 0) + 1;
  if (kind === 'upgrade') {
    k.v = rng.pick(nextVariants(k.v));
    // an upgrade card in the shop (locked or not) for this skill no longer fits: turn it into its next level (or drop it)
    s.shop.forEach((o, j) => {
      if (!o || o.id !== k.id || o.v === '') return;
      s.shop[j] = canUpgrade(k.v, s.day) ? upOffer(k) : null;
      if (!s.shop[j] && s.locks?.[j]) s.locks[j] = false;
    });
    return { idx: i, from, v: k.v };
  }
  k.mark = rng.pick(MARKS);
  s.wishMarks = (s.wishMarks ?? 0) + 1;
  return { idx: i, from, mark: k.mark };
}

export function reroll(s: RunState): string | null {
  if (s.day <= 1) return 'วันแรกเป็นร้านประจำฮีโร่ สุ่มใหม่ได้ตั้งแต่วันที่ 2';
  if (s.phase === 'relic') return 'เลือกของวิเศษก่อน';
  if (s.gold < REROLL) return 'เงินไม่พอ';
  s.gold -= REROLL;
  s.rolls++;
  rollShop(s);
  return null;
}

/**
 * Buy offer i: a new skill needs a free slot; an upgrade replaces the owned skill's variant (same slot and mark) with
 * the branch `pick` (one of the two next branches; default the card's first), a star card adds one ★.
 */
export function buy(s: RunState, i: number, pick?: string): string | null {
  const offer = s.shop[i];
  if (!offer) return 'ไม่มีของ';
  if (s.phase === 'relic') return 'เลือกของวิเศษก่อน';
  const price = priceOf(offer);
  if (s.gold < price) return 'เงินไม่พอ';
  if (offer.v === '') {
    if (s.skills.some((k) => k.id === offer.id)) return 'มี skill นี้แล้ว';
    if (s.skills.length >= slotsOf(s)) return 'ช่อง skill เต็ม ขาย skill หรือซื้อช่องเพิ่มก่อน';
    s.skills.push({ id: offer.id, v: '', bonus: (offer.bonus ?? []).map((b) => ({ ...b })) });
  } else {
    const owned = upgradeOf(s, offer);
    if (!owned) return 'อัปเกรดนี้ใช้กับ skill ที่มีอยู่ไม่ได้แล้ว';
    if (offer.star) owned.star = offer.star;
    else {
      const v = pick ?? offer.v;
      if (!nextVariants(owned.v).includes(v as Variant)) return 'ไม่มีทางนี้';
      owned.v = v;
    }
  }
  s.gold -= price;
  s.shop[i] = null;
  if (s.locks?.[i]) s.locks[i] = false;
  return null;
}

export function sell(s: RunState, i: number) {
  const k = s.skills[i];
  if (!k) return;
  s.gold += sellPrice(k);
  s.skills.splice(i, 1);
}

/** Move skill i up (-1) or down (+1) in the list. Neighbours decide which connect bonuses are on. */
export function moveSkill(s: RunState, i: number, dir: -1 | 1) {
  const j = i + dir;
  if (!s.skills[i] || !s.skills[j]) return;
  [s.skills[i], s.skills[j]] = [s.skills[j], s.skills[i]];
}

/** Each run rolls a fresh look for its hero (cosmetic only); derived from the run seed so old saves get one too. */
/** Each run rolls a fresh look for its hero (cosmetic only), from the run seed and the hero, so the hero pick can show it. */
export const lookFor = (seed: number, hero: string) => hashSeed(seed, 'look', hero) || 1;
export const lookOf = (s: RunState) => lookFor(s.seed, s.hero);

export const toBuild = (s: RunState): Build => ({
  hero: s.hero,
  skills: s.skills.slice(0, slotsOf(s)).map((k) => ({ ...k })),
  look: lookOf(s),
  ...(s.relics?.length ? { relics: [...s.relics] } : {}),
});

/** draw = the fight ended in a draw (a near-even double KO): it is not a win, but costs no HP and resets the streak (sim v15) */
export function recordResult(s: RunState, won: boolean, info: Omit<LogEntry, 'day' | 'won'>, draw = false) {
  s.log.push({ day: s.day, won, ...info, ...(draw && !won ? { draw: true } : {}) });
  if (won) {
    s.wins++;
    s.streak = s.streak > 0 ? s.streak + 1 : 1;
  } else {
    s.losses++;
    if (draw) s.streak = 0;
    else {
      s.hp = Math.max(0, s.hp - damageFor(s.day));
      s.streak = s.streak < 0 ? s.streak - 1 : -1;
    }
  }
  if (s.wins >= WIN_TARGET) {
    s.phase = 'won';
    return;
  }
  if (s.hp <= 0) {
    if (!s.ghost) {
      // โอกาสสุดท้าย: first death becomes a half-spirit with 1 HP
      s.ghost = true;
      s.hp = 1;
      s.phase = 'lastchance';
      return;
    }
    s.phase = 'dead';
    return;
  }
  s.day++;
  beginDay(s);
}

/** What Awaken would do, per skill: the Lv2 variant a Lv1 skill becomes (null = not Lv1). Same rolls as Awaken itself. */
export function awakenPreview(s: RunState): (Variant | null)[] {
  const rng = new Rng(hashSeed(s.seed, 'awaken', s.day));
  return s.skills.map((k) => (k.v === '' ? rng.pick(nextVariants('')) : null));
}

export function chooseLastChance(s: RunState, opt: LastChanceOption) {
  if (s.phase !== 'lastchance') return;
  if (opt === 'awaken') {
    // every Lv1 skill moves to Lv2 on a random branch
    awakenPreview(s).forEach((v, i) => {
      if (v) s.skills[i].v = v;
    });
  }
  if (opt === 'supply') {
    // at the most slots there is no slot to give: 12 gold instead (sim v15)
    if (slotsOf(s) >= MAX_SLOTS) s.gold += SUPPLY_GOLD_FULL;
    else {
      s.gold += 8;
      s.bonusSlots += 1;
    }
  }
  if (opt === 'mark') {
    s.pendingMark = new Rng(hashSeed(s.seed, 'mark', s.day)).pick(MARKS);
    s.phase = 'mark';
    return;
  }
  s.day++;
  beginDay(s);
}

/** Give up the run: it ends right away as a loss. */
export function concede(s: RunState) {
  if (s.phase === 'won' || s.phase === 'dead') return;
  s.conceded = true;
  s.phase = 'dead';
}

/** idx = -1 skips placing the mark */
export function applyMark(s: RunState, idx: number) {
  if (s.phase !== 'mark' || !s.pendingMark) return;
  if (s.skills[idx]) s.skills[idx].mark = s.pendingMark;
  s.pendingMark = null;
  s.day++;
  beginDay(s);
}
