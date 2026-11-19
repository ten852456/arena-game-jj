import { Rng, hashSeed } from './rng';
import { HEROES, HEROES_BY_ID } from './heroes';
import { rollBonuses } from './links';
import { SKILLS, SKILL_LIST, lvOf, nextVariants } from './skills';
import type { Bonus, Build, Mark, SkillInstance } from './types';

/** One run (รอบ) of the game: pick skills day by day until 10 wins or HP runs out. */

export const START_HP = 20;
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

/**
 * Shop offer: a skill at a tree variant. v = '' is a new Lv1 skill (with its rolled connect bonuses); any other v is
 * an upgrade of a skill you own (its next variant, one of two, picked at random by the shop; the skill keeps its bonuses).
 */
export interface Offer {
  id: string;
  v: string;
  bonus?: Bonus[];
}

/** Heroes offered when a run starts (5 later with the pass). */
export const HERO_CHOICES = 3;

/**
 * The heroes a run may start with: `n` heroes from different archetypes, rolled from the seed.
 * Same seed → same choices, so the server can check the pick later (Phase 2).
 */
export function heroChoices(seed: number, n = HERO_CHOICES): string[] {
  const rng = new Rng(hashSeed(seed, 'heroes'));
  const arches = [...new Set(HEROES.map((h) => h.arch))];
  const out: string[] = [];
  while (out.length < n && arches.length) {
    const arch = arches.splice(rng.int(arches.length), 1)[0];
    out.push(rng.pick(HEROES.filter((h) => h.arch === arch)).id);
  }
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
}

export interface RunState {
  v: 7;
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
  phase: 'shop' | 'lastchance' | 'mark' | 'won' | 'dead';
  rating: number;
  log: LogEntry[];
  /** the player gave up this run */
  conceded?: boolean;
  /** shop lock: locks[i] = offer i is kept through rerolls and into the next day (until bought or unlocked) */
  locks?: boolean[];
  /** moon wishes bought today (the price goes up with each one) */
  wishes?: number;
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
export const priceOf = (o: Offer) => PRICES[lvOf(o.v) - 1] + (SKILLS[o.id].hero ? 1 : 0);
/** gold back when selling: 1 / 2 / 3 by level */
export const sellPrice = (k: SkillInstance) => lvOf(k.v);
/**
 * HP lost on a defeat: 2 on days 1–3, 3 on days 4–6, 4 on days 7–9, 5 from day 10 (capped), so a good run to 10 wins
 * (≈ day 13–16) survives 3–4 defeats, plus the last chance.
 */
export const LOSS_CAP = 5;
export const damageFor = (day: number) => Math.min(LOSS_CAP, 1 + Math.ceil(Math.max(1, day) / 3));

/** Win streak bonus is clearly bigger than the loss-streak comeback money. */
export function incomeFor(day: number, streak: number) {
  const base = day <= 1 ? DAY1_GOLD : 5 + Math.min(Math.floor(day / 2), 3);
  const bonus = streak >= 5 ? 3 : streak >= 3 ? 2 : streak >= 2 ? 1 : streak <= -2 ? 1 : 0;
  return { base, bonus };
}

export function newRun(hero: string, seed: number, id: string): RunState {
  const s: RunState = {
    v: 7, id, seed, hero, day: 1, hp: START_HP, wins: 0, losses: 0, gold: 0, streak: 0,
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
}

/** Is this offer an upgrade that still applies to what you own? */
export function upgradeOf(s: RunState, o: Offer): SkillInstance | null {
  if (o.v === '') return null;
  const owned = s.skills.find((k) => k.id === o.id);
  return owned && nextVariants(owned.v).includes(o.v as never) ? owned : null;
}

/**
 * Day 1: the hero's fixed shop (same every run). Day 2+: 5 random offers, a mix of new Lv1 skills and upgrades
 * (one random next variant per owned skill below Lv3; about half the offers are upgrades when there are some).
 */
function rollShop(s: RunState) {
  if (s.day <= 1) {
    // same skills every run; their connect bonuses are rolled per run
    const brng = new Rng(hashSeed(s.seed, 'day1'));
    s.shop = (HEROES_BY_ID[s.hero]?.day1 ?? []).slice(0, SHOP_SIZE).map((id) => ({ id, v: '', bonus: rollBonuses(brng, id, s.hero) }));
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
  const ups = s.skills.filter((k) => lvOf(k.v) < MAX_LV && !keptIds.has(k.id)).map((k) => k.id);
  const picks: Offer[] = [];
  const need = SHOP_SIZE - keptIds.size;
  while (picks.length < need && (fresh.length || ups.length)) {
    const takeUp = ups.length > 0 && (fresh.length === 0 || rng.next() < 0.5);
    if (takeUp) {
      const id = ups.splice(rng.int(ups.length), 1)[0];
      const k = s.skills.find((x) => x.id === id)!;
      picks.push({ id, v: rng.pick(nextVariants(k.v)) });
    } else {
      const id = fresh.splice(rng.int(fresh.length), 1)[0];
      picks.push({ id, v: '', bonus: rollBonuses(rng, id, s.hero) });
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
export const wishPrice = (s: RunState) => WISH_BASE + 2 * (s.wishes ?? 0);
export type WishKind = 'upgrade' | 'mark' | null;
export function wishKind(s: RunState): WishKind {
  if (s.skills.some((k) => lvOf(k.v) < MAX_LV)) return 'upgrade';
  if (s.skills.some((k) => !k.mark)) return 'mark';
  return null;
}
export type WishResult = { err: string } | { idx: number; from: string; v?: string; mark?: Mark };
export function wish(s: RunState): WishResult {
  const kind = wishKind(s);
  if (!kind) return { err: 'ทุก skill เต็มขั้นและมีตราแล้ว' };
  const price = wishPrice(s);
  if (s.gold < price) return { err: 'เงินไม่พอ' };
  const rng = new Rng(hashSeed(s.seed, 'wish', s.day, s.wishes ?? 0));
  const pool = s.skills.map((k, i) => ({ k, i })).filter(({ k }) => (kind === 'upgrade' ? lvOf(k.v) < MAX_LV : !k.mark));
  const { k, i } = rng.pick(pool);
  const from = k.v;
  s.gold -= price;
  s.wishes = (s.wishes ?? 0) + 1;
  if (kind === 'upgrade') {
    k.v = rng.pick(nextVariants(k.v));
    return { idx: i, from, v: k.v };
  }
  k.mark = rng.pick(MARKS);
  return { idx: i, from, mark: k.mark };
}

export function reroll(s: RunState): string | null {
  if (s.day <= 1) return 'วันแรกเป็นร้านประจำฮีโร่ สุ่มใหม่ได้ตั้งแต่วันที่ 2';
  if (s.gold < REROLL) return 'เงินไม่พอ';
  s.gold -= REROLL;
  s.rolls++;
  rollShop(s);
  return null;
}

/** Buy offer i: a new skill needs a free slot; an upgrade replaces the owned skill's variant (same slot and mark). */
export function buy(s: RunState, i: number): string | null {
  const offer = s.shop[i];
  if (!offer) return 'ไม่มีของ';
  const price = priceOf(offer);
  if (s.gold < price) return 'เงินไม่พอ';
  if (offer.v === '') {
    if (s.skills.some((k) => k.id === offer.id)) return 'มี skill นี้แล้ว';
    if (s.skills.length >= slotsOf(s)) return 'ช่อง skill เต็ม ขาย skill หรือซื้อช่องเพิ่มก่อน';
    s.skills.push({ id: offer.id, v: '', bonus: (offer.bonus ?? []).map((b) => ({ ...b })) });
  } else {
    const owned = upgradeOf(s, offer);
    if (!owned) return 'อัปเกรดนี้ใช้กับ skill ที่มีอยู่ไม่ได้แล้ว';
    owned.v = offer.v;
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
export const lookOf = (s: RunState) => hashSeed(s.seed, 'look') || 1;

export const toBuild = (s: RunState): Build => ({
  hero: s.hero,
  skills: s.skills.slice(0, slotsOf(s)).map((k) => ({ ...k })),
  look: lookOf(s),
});

export function recordResult(s: RunState, won: boolean, info: Omit<LogEntry, 'day' | 'won'>) {
  s.log.push({ day: s.day, won, ...info });
  if (won) {
    s.wins++;
    s.streak = s.streak > 0 ? s.streak + 1 : 1;
  } else {
    s.losses++;
    s.hp -= damageFor(s.day);
    s.streak = s.streak < 0 ? s.streak - 1 : -1;
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

export function chooseLastChance(s: RunState, opt: LastChanceOption) {
  if (s.phase !== 'lastchance') return;
  if (opt === 'awaken') {
    // every Lv1 skill moves to Lv2 on a random branch
    const rng = new Rng(hashSeed(s.seed, 'awaken', s.day));
    for (const k of s.skills) if (k.v === '') k.v = rng.pick(nextVariants(''));
  }
  if (opt === 'supply') {
    s.gold += 8;
    s.bonusSlots += 1;
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
