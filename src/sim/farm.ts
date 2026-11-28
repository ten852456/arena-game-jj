// Farm (idle town): heroes work at landmarks, resources pay for arena tickets, hero unlocks, town upgrades and the
// season monument. Design: docs/design/FARM.md. Pure and deterministic: every function takes `now` (ms) and a time scale,
// so the server (authoritative clock), the client (display) and later the onchain program share one rulebook.
// Numbers are starting values, tuned later; this file owns them (like tuning.ts for fights).
import { HEROES, HEROES_BY_ID } from './heroes';
import { Rng, hashSeed } from './rng';
import type { Line } from './types';

export const FARM_VERSION = 1;

export type Building = 'lumber' | 'mine' | 'shrine';
export type Res = 'wood' | 'ore' | 'crystal';
export const BUILDING_IDS: Building[] = ['lumber', 'mine', 'shrine'];
export const RES_OF: Record<Building, Res> = { lumber: 'wood', mine: 'ore', shrine: 'crystal' };

const H = 3_600_000;

/** Output per working hero per hour, before line affinity. Crystal: one per 12 h (one per collect). */
export const RATE: Record<Res, number> = { wood: 6, ore: 4, crystal: 1 / 12 };
/** +25% when the hero's skill line fits the landmark (docs/design/FARM.md; tower research = burn/poison, later). */
export const AFFINITY_BONUS = 0.25;
export const AFFINITY: Record<Building, Line[]> = {
  lumber: ['hit', 'dodge', 'wind'],
  mine: ['shield', 'ice', 'gold'],
  shrine: ['heal', 'time'],
};

/** Per building level (index = level − 1). */
/** Lv1–Lv5 come from the tables below (slots, storage). Past Lv5 levels never end (the incremental layer). */
export const TABLE_LV = 5;
/** @deprecated kept for old callers: the last table level */
export const MAX_LV = TABLE_LV;
/**
 * Incremental layer (owner, 2026-11-26; formulas in docs/design/FARM.md "Incremental layer"): past Lv5 each level adds
 * +15% output and every 10th level doubles it; a level costs 400 wood × 1.13^(n−6) (ore 2/3 of that, crystal one
 * per 10 levels). Slots and storage stay at the Lv5 values.
 */
export const LEVEL_STEP = 0.15;
export const LEVEL_COST_BASE = 400;
export const LEVEL_COST_GROWTH = 1.13;
export const levelMult = (lv: number) => {
  const k = Math.max(0, lv - TABLE_LV);
  return (1 + LEVEL_STEP * k) * 2 ** Math.floor(k / 10);
};
/**
 * v5.1 (2026-11-28): crystal is the scarce key, so the shrine gets no endless-level multiplier (v5 sims reached
 * 540-620 crystal a season through it) and stops at Lv5. Lumber and mine keep the endless layer.
 */
export const maxLvOf = (b: Building) => (b === 'shrine' ? TABLE_LV : 999);
export const outputMult = (b: Building, lv: number) => (b === 'shrine' ? 1 : levelMult(lv));
/** what it costs to go from `lv` to lv + 1 */
export function upgradeCost(lv: number): Partial<Record<Res | 'stardust', number>> {
  if (lv < TABLE_LV) return UPGRADE_COST[lv - 1];
  const n = lv + 1;
  const wood = Math.round(LEVEL_COST_BASE * LEVEL_COST_GROWTH ** (n - 6));
  const crystal = Math.floor(n / 10);
  return { wood, ore: Math.round((wood * 2) / 3), ...(crystal ? { crystal } : {}) };
}

/**
 * Worker mastery (owner, 2026-11-26): each hero earns mastery at each landmark from its work-hours, levels 1–99,
 * +1% output there per level. XP curve: the RuneScape / Melvor curve divided by 10, 100 XP per work-hour
 * (level 50 ≈ 100 work-hours, 99 ≈ 13,000).
 */
export const MASTERY_XP_PER_HOUR = 100;
export const MASTERY_MAX = 99;
export const MASTERY_STEP = 0.01;
/** XP_TABLE[l] = XP needed for level l (l = 1..99) */
export const XP_TABLE: number[] = (() => {
  const t = [0, 0];
  let acc = 0;
  for (let l = 2; l <= MASTERY_MAX; l++) {
    acc += Math.floor(l - 1 + 300 * 2 ** ((l - 1) / 7));
    t.push(Math.floor(acc / 4 / 10));
  }
  return t;
})();
export function masteryLevel(xp: number): number {
  let l = 1;
  while (l < MASTERY_MAX && xp >= XP_TABLE.at(l + 1)!) l++;
  return l;
}
export const masteryKey = (hero: string, b: Building) => `${hero}@${b}`;
export const SLOTS = [1, 2, 3, 3, 4];
/**
 * hours a job's storage holds before it stops. 12 h at Lv1 covers the night gap of a 2-collects-a-day player (8 h
 * lost a third of the day); Lv5's 24 h makes one visit a day full play (research: docs/design/FARM.md "Fair timers").
 */
export const STORAGE_H = [12, 14, 16, 20, 24];
/** cost to go from level i+1 to i+2 */
export const UPGRADE_COST: Partial<Record<Res | 'stardust', number>>[] = [
  // farm-sim (v0.0.1): the old Lv4/Lv5 costs (1,200 / 3,000 wood) were a wall above the warehouse cap and far above
  // the endless curve that starts at 400; these lead smoothly into it
  { wood: 60, ore: 40 }, // Lv2 is cheap on purpose: the day-1 hook (the first shift pays for it)
  { wood: 150, ore: 100, crystal: 1 },
  { wood: 250, ore: 170, crystal: 2 },
  { wood: 330, ore: 220, crystal: 3 },
];
/** v5.1: the pass sells no production, so it adds no work slot (was 1) */
export const PASS_SLOTS = 0;
/** warehouse: at most this many hours of a landmark's full output can be held (3 days: covers a weekend away) */
export const WAREHOUSE_H = 72;

/**
 * Arena modes (owner 2026-11-26): Casual is free and unlimited; Ranked costs a ticket. Every day brings FREE_RUNS
 * free ranked tickets, banked up to FREE_BANK (a missed day is not lost); more are crafted from wood + ore.
 * A ranked run with RANKED_REFUND_WINS+ wins gives its ticket back; the first CASUAL_TICKET_WINS-win casual run of
 * a day earns one. Casual pays less stardust (CASUAL_STARDUST, lower after CASUAL_FULL_RUNS runs a day), ranked a bonus.
 */
export type Mode = 'casual' | 'ranked';
export const FREE_RUNS = 1;
export const FREE_BANK = 3;
export const RANKED_REFUND_WINS = 7;
export const CASUAL_TICKET_WINS = 10;
export const CASUAL_FULL_RUNS = 3;
export const CASUAL_STARDUST = [0.5, 0.25];
export const RANKED_STARDUST = 1.2;

/**
 * Lucky finds (owner 2026-11-26): every whole hero-hour of work rolls once, at collect time, for a rare find.
 * Width and looks only (crafts cosmetics, feeds the monument, fills the collection log), never a fight bonus.
 * A daily roll cap keeps a bot that never sleeps level with a person who collects twice a day.
 */
export const FINDS: { id: string; at: Building[]; odds: number; th: string; en: string; golden?: true }[] = [
  { id: 'moon_pearl', at: ['lumber', 'mine'], odds: 1 / 400, th: 'ไข่มุกจันทร์', en: 'Moon Pearl' },
  { id: 'relic_shard', at: ['shrine'], odds: 1 / 600, th: 'เศษวัตถุโบราณ', en: 'Shrine Relic Shard' },
  { id: 'golden_pearl', at: ['lumber', 'mine', 'shrine'], odds: 1 / 8000, th: 'ไข่มุกทองคำ', en: 'Golden Moon Pearl', golden: true },
];
export const FIND_ROLLS_PER_DAY = 24;
/** a find poured into the monument */
export const FIND_POINTS: Record<string, number> = { moon_pearl: 150, relic_shard: 200, golden_pearl: 2000 };

/** Moonlit (shiny) hero: each run rolls once when it starts; the look is kept for good. */
export const SHINY_ODDS = 1 / 1024;
/** casual runs are free, so the shiny roll is capped per day (security review: no free unlimited rolls) */
export const SHINY_ROLLS_PER_DAY = 5;
export const TICKET_COST: Partial<Record<Res, number>> = { wood: 30, ore: 20 };
export const TICKET_CRAFT_CAP = 4;
export const TICKET_HOLD = 8;

/** Heroes */
export const STARTERS = ['knight', 'assassin', 'pyro', 'duelist'];
export const ROTATION = 2;
/**
 * Hero adoption (v5.1): stardust rises with each hero adopted beyond the starters (300 → 5,000), always 3 crystal.
 * The order does not matter: the n-th adoption costs the same whichever hero it is.
 */
export const ADOPT_STARDUST = [300, 700, 1400, 2400, 3600, 5000];
export const ADOPT_CRYSTAL = 3;
export const adoptCost = (f: Pick<FarmState, 'owned'>) => {
  const n = f.owned.filter((h) => !STARTERS.includes(h)).length;
  return { stardust: ADOPT_STARDUST[Math.min(n, ADOPT_STARDUST.length - 1)], crystal: ADOPT_CRYSTAL };
};

/** Day-1 hook: the very first job ever finishes its storage in this long (instead of 8 h). */
export const FIRST_SHIFT_MS = 5 * 60_000;

/**
 * Work egg: earned by 3-win and 10-win runs, hatched by hero work-hours (every working hero adds its hours).
 * Cosmetic only, never sold or traded. One egg incubates; up to NEST − 1 wait in line.
 */
export const EGG_WINS = [3, 10];
export const EGG_HOURS: Record<number, number> = { 3: 48, 10: 120 };
/** v5.1: the pass no longer hatches eggs faster (was 1.5) */
export const EGG_PASS_SPEED = 1;
export const NEST = 4;
export const EGG_PITY = 10;

/** Stamp card, counted by total days played (never consecutive, never resets on a break). */
export const STAMPS = 7;
export const STAMPS_NEW = 2; // endowed progress: a new card starts with 2
export const STAMP_REWARD = { crystal: 2, eggHours: 24 };

/** New players: output ×2 on day 0, fading to ×1 over this many days (catch-up). */
export const NEWBIE_DAYS = 7;
export const NEWBIE_BOOST = 1;

/**
 * Season monument (a threshold public good): pour wood/ore/crystal. The goal scales with the players who poured;
 * it starts 20% filled (the ruler's gift: seed money raises giving); bronze/silver/gold tiers past the goal keep
 * people pouring; a personal minimum earns the contributor's own reward. Next season's head start = √contribution,
 * capped, fading over 2 weeks. A missed goal damages a landmark, but never a contributor's.
 */
export const MONUMENT_POINTS: Record<Res, number> = { wood: 1, ore: 1.5, crystal: 40 };
export const HEADSTART_MAX = 0.3;
export const HEADSTART_FULL_AT = 20_000; // points for the full +30%
export const HEADSTART_DAYS = 14;
export const MONUMENT_GOAL_PER_PLAYER = 2500;
export const MONUMENT_SEED = 0.2;
export const MONUMENT_TIERS = [1, 1.3, 1.6];
export const MONUMENT_MIN_PERSONAL = 300;

export interface Job {
  hero: string;
  /** production counted up to here (ms) */
  since: number;
  /** the day-1 hook job: fills its storage in FIRST_SHIFT_MS */
  fast?: true;
}
export interface Egg {
  /** work-hours this egg has had (any working hero counts) and needs */
  h: number;
  need: number;
  from: number;
}
export interface FarmState {
  v: number;
  owned: string[];
  res: Record<Res, number>;
  lv: Record<Building, number>;
  jobs: Record<Building, Job[]>;
  tickets: number;
  /** Bangkok day key of the counters below */
  day: string;
  /** casual runs started today, and today's casual ticket / egg already earned */
  casualRuns?: number;
  casualTicket?: true;
  casualEgg?: true;
  /** lucky finds: count per find id, find rolls used today, part of an hour carried to the next collect */
  finds?: Record<string, number>;
  findRolls?: number;
  findCarry?: number;
  /** moonlit (shiny) heroes this player has rolled, and today's shiny rolls */
  shinies?: string[];
  shinyRolls?: number;
  /** finds since the last time the server read them (for the town feed), cleared by the server */
  newFinds?: string[];
  /** free runs banked (FREE_RUNS added each new day, up to FREE_BANK) */
  free: number;
  crafted: number;
  /** stamp card (total days, not consecutive) and the last day stamped */
  stamps: number;
  stampDay?: string;
  /** the season this farm last lived in (the rollover runs when it changes) */
  season?: string;
  /** what the last season rollover did, shown to the player once */
  rollover?: { from: string; to: string; excess: number; tickets: number; head: number; damaged?: Building };
  /** mastery XP per `hero@building` (masteryKey) */
  mastery?: Record<string, number>;
  /** a landmark damaged by last season's calamity: half output until repaired */
  damaged?: Building;
  createdAt: number;
  pass?: boolean;
  /** the day-1 hook has been used */
  firstShift?: true;
  eggs: Egg[];
  /** cosmetics from eggs (ids from EGG_POOL), no duplicates */
  cosmetics: string[];
  /** eggs hatched since the last rare one (pity) */
  pity: number;
  /** season monument: points poured this season */
  poured: number;
  pouredSeason: string;
  /** head start carried from last season (0..HEADSTART_MAX) and when it started */
  head?: { mult: number; from: number };
  updatedAt: number;
}

/** Bangkok calendar day ("2026-11-27"): free runs and craft caps reset at local midnight. */
export const bkDay = (t: number) => new Date(t + 7 * H).toISOString().slice(0, 10);

export function newFarm(now: number, allHeroes = false): FarmState {
  return {
    v: FARM_VERSION,
    owned: allHeroes ? HEROES.map((h) => h.id) : [...STARTERS],
    res: { wood: 0, ore: 0, crystal: 0 },
    lv: { lumber: 1, mine: 1, shrine: 1 },
    jobs: { lumber: [], mine: [], shrine: [] },
    tickets: 0,
    day: bkDay(now),
    free: FREE_RUNS,
    finds: {},
    shinies: [],
    crafted: 0,
    stamps: STAMPS_NEW,
    createdAt: now,
    eggs: [],
    cosmetics: [],
    pity: 0,
    poured: 0,
    pouredSeason: '',
    updatedAt: now,
  };
}

const dayNum = (d: string) => Math.round(Date.parse(d + 'T00:00:00Z') / (24 * H));
/** New day(s): free runs are added (banked up to FREE_BANK), the craft cap comes back. */
export function rollDay(f: FarmState, now: number) {
  const d = bkDay(now);
  if (f.day === d) return;
  const days = Math.max(1, dayNum(d) - dayNum(f.day));
  Object.assign(f, { day: d, free: Math.min(FREE_BANK, f.free + FREE_RUNS * days), crafted: 0, casualRuns: 0, findRolls: 0, shinyRolls: 0 });
  delete f.casualTicket;
  delete f.casualEgg;
}

/** Any collect or run stamps today once. A full card pays out and starts a new one. Returns true on a payout. */
export function stamp(f: FarmState, now: number): boolean {
  const d = bkDay(now);
  if (f.stampDay === d) return false;
  f.stampDay = d;
  if (++f.stamps < STAMPS) return false;
  f.stamps = 0;
  f.res.crystal += STAMP_REWARD.crystal; // a reward may go past the warehouse cap
  hatchHours(f, STAMP_REWARD.eggHours, true);
  return true;
}

const tableIdx = (lv: number) => Math.min(lv, TABLE_LV) - 1;
export const slotsOf = (f: FarmState, b: Building) => SLOTS[tableIdx(f.lv[b])] + (f.pass ? PASS_SLOTS : 0);
export const masteryOf = (f: FarmState, hero: string, b: Building) => masteryLevel(f.mastery?.[masteryKey(hero, b)] ?? 0);
export const fits = (hero: string, b: Building) => AFFINITY[b].includes(HEROES_BY_ID[hero]?.line as Line);
export const newbieBoost = (f: FarmState, now: number) =>
  NEWBIE_BOOST * Math.max(0, 1 - (now - (f.createdAt ?? 0)) / (NEWBIE_DAYS * 24 * H));
export const rateOf = (f: FarmState, b: Building, hero: string, now: number) =>
  RATE[RES_OF[b]] * (fits(hero, b) ? 1 + AFFINITY_BONUS : 1) * outputMult(b, f.lv[b]) * (1 + MASTERY_STEP * (masteryOf(f, hero, b) - 1)) *
  (1 + headStart(f, now) + newbieBoost(f, now)) * (f.damaged === b ? 0.5 : 1);
export const storageMs = (f: FarmState, b: Building) => STORAGE_H[tableIdx(f.lv[b])] * H;
/** the most of a resource the warehouse holds: WAREHOUSE_H of the landmark's full output at its level */
export function capOf(f: FarmState, r: Res): number {
  const b = BUILDING_IDS.find((x) => RES_OF[x] === r)!;
  const output = RATE[r] * (1 + AFFINITY_BONUS) * outputMult(b, f.lv[b]) * slotsOf(f, b) * WAREHOUSE_H;
  // never below 1.5× what the next level of any landmark costs in this resource (farm-sim: a cap under the cost is a wall)
  const need = Math.max(...BUILDING_IDS.map((x) => upgradeCost(f.lv[x])[r] ?? 0)) * 1.5;
  return Math.max(10, Math.ceil(Math.max(output, need)));
}

/** The fading head start from last season's monument (0 after HEADSTART_DAYS). */
export function headStart(f: FarmState, now: number): number {
  if (!f.head) return 0;
  const days = (now - f.head.from) / (24 * H);
  if (days >= HEADSTART_DAYS || days < 0) return 0;
  return f.head.mult * (1 - days / HEADSTART_DAYS);
}

/**
 * What a job has made so far (whole units) and how much game time that used. `scale` speeds the clock up for
 * playtests (FARM_TIME_SCALE). The first job ever fills its storage in FIRST_SHIFT_MS.
 */
export function pending(f: FarmState, b: Building, j: Job, now: number, scale = 1) {
  const cap = storageMs(f, b);
  const speed = scale * (j.fast ? cap / FIRST_SHIFT_MS : 1);
  const elapsed = Math.max(0, (now - j.since) * speed);
  const used = Math.min(elapsed, cap);
  const rate = rateOf(f, b, j.hero, now);
  const n = Math.floor((used / H) * rate + 1e-9);
  return { n, full: elapsed >= cap, used, speed, rate, fill: used / cap };
}

/** Collect one landmark: add what its jobs made (up to the warehouse cap), restart their clocks. */
export function collect(f: FarmState, b: Building, now: number, scale = 1, rng?: () => number): number {
  const r = RES_OF[b];
  let got = 0;
  for (const j of f.jobs[b]) {
    const p = pending(f, b, j, now, scale);
    const room = capOf(f, r) - f.res[r];
    const take = Math.max(0, Math.min(p.n, room));
    f.res[r] += take;
    got += take;
    const lost = p.full || take < p.n;
    // work-hours hatch eggs: only the game hours this collect used up (a part-unit carried over counts next time)
    const hours = lost ? p.used / H : p.rate > 0 ? take / p.rate : 0;
    hatchHours(f, hours);
    const mk = masteryKey(j.hero, b);
    (f.mastery ??= {})[mk] = Math.min(XP_TABLE.at(MASTERY_MAX)!, (f.mastery[mk] ?? 0) + hours * MASTERY_XP_PER_HOUR);
    if (rng) rollFinds(f, b, hours, rng);
    if (lost) j.since = now; // full storage or a full warehouse: the rest is lost
    else j.since += p.rate > 0 ? ((take / p.rate) * H) / p.speed : 0; // keep the part-unit already made
    if (j.fast) delete j.fast;
  }
  // v5.1: a worker past the slots (the pass slot is gone) is paid for its hours above and then goes home (Codex review)
  const slots = slotsOf(f, b);
  if (f.jobs[b].length > slots) f.jobs[b] = f.jobs[b].slice(0, slots);
  f.updatedAt = now;
  return got;
}

/** Lucky-find rolls for `hours` of work at `b` (whole hours only; the rest carries over; capped per day). */
export function rollFinds(f: FarmState, b: Building, hours: number, rng: () => number): string[] {
  const got: string[] = [];
  const total = (f.findCarry ?? 0) + hours;
  let n = Math.floor(total);
  f.findCarry = total - n;
  n = Math.min(n, FIND_ROLLS_PER_DAY - (f.findRolls ?? 0));
  if (n <= 0) return got;
  f.findRolls = (f.findRolls ?? 0) + n;
  const here = FINDS.filter((x) => x.at.includes(b));
  for (let i = 0; i < n; i++)
    for (const x of here)
      if (rng() < x.odds) {
        (f.finds ??= {})[x.id] = (f.finds[x.id] ?? 0) + 1;
        (f.newFinds ??= []).push(x.id);
        got.push(x.id);
      }
  return got;
}

function hatchHours(f: FarmState, h: number, bonus = false) {
  const egg = f.eggs[0];
  if (egg) egg.h = Math.min(egg.need, egg.h + h * (f.pass && !bonus ? EGG_PASS_SPEED : 1));
}

/**
 * "Fill jobs": every idle hero to a free slot, spreading them so every landmark works (farm-sim: filling one
 * landmark first left the shrine empty, no crystal, upgrades stuck). Each hero goes to the free landmark with the
 * fewest workers, a landmark its line fits winning a tie. Returns the send ops.
 */
export function fillPlan(f: FarmState, idle: string[]): { b: Building; hero: string }[] {
  const count: Record<Building, number> = { lumber: f.jobs.lumber.length, mine: f.jobs.mine.length, shrine: f.jobs.shrine.length };
  const out: { b: Building; hero: string }[] = [];
  // heroes that fit somewhere first, so they get their landmark
  const order = [...idle].sort((a, c) => Number(BUILDING_IDS.some((x) => fits(c, x))) - Number(BUILDING_IDS.some((x) => fits(a, x))));
  for (const hero of order) {
    const free = BUILDING_IDS.filter((x) => count[x] < slotsOf(f, x));
    if (!free.length) break;
    free.sort((x, y) => count[x] - count[y] || Number(fits(hero, y)) - Number(fits(hero, x)));
    count[free[0]]++;
    out.push({ b: free[0], hero });
  }
  return out;
}

export function heroBusy(f: FarmState, hero: string): Building | null {
  for (const b of BUILDING_IDS) if (f.jobs[b].some((j) => j.hero === hero)) return b;
  return null;
}

/** The 2 free heroes of a day, the same for everyone. VRF onchain later; a seeded roll from the date for now. */
export function rotationOf(day: string, owned: string[] = []): string[] {
  const rng = new Rng(hashSeed(0x5eed, 'rotation', day));
  const all = HEROES.map((h) => h.id);
  // favour heroes this player does not own (try before unlock); fall back to anyone
  const notOwned = all.filter((h) => !owned.includes(h));
  const pool = notOwned.length >= ROTATION ? notOwned : all;
  const out: string[] = [];
  const left = [...pool];
  while (out.length < ROTATION && left.length) out.push(left.splice(rng.int(left.length), 1)[0]);
  return out;
}

/** Heroes this player may start a run with today (owned + rotation). Yesterday's rotation still counts (a run picked at 23:59). */
export function usableHeroes(f: FarmState, now: number): string[] {
  const set = new Set([...f.owned, ...rotationOf(bkDay(now), f.owned), ...rotationOf(bkDay(now - 24 * H), f.owned)]);
  return HEROES.map((h) => h.id).filter((h) => set.has(h));
}
export const todaysRotation = (f: FarmState, now: number) => rotationOf(bkDay(now), f.owned);

export const runsLeft = (f: FarmState) => f.free + f.tickets;

/** Spend one run (free first, then a ticket). Returns an error or null. */
export function spendRun(f: FarmState, now: number): string | null {
  rollDay(f, now);
  if (f.free > 0) f.free--;
  else if (f.tickets > 0) f.tickets--;
  else return 'no ranked tickets: play Casual for free, or craft a ticket at the arena gate';
  stamp(f, now);
  f.updatedAt = now;
  return null;
}

/** A casual run starts: free; counted so stardust and eggs taper after CASUAL_FULL_RUNS a day. */
export function startCasual(f: FarmState, now: number) {
  rollDay(f, now);
  f.casualRuns = (f.casualRuns ?? 0) + 1;
  stamp(f, now);
  f.updatedAt = now;
}

/** Stardust multiplier for a finished run of this mode (`nth` = which casual run of the day it was, 1-based). */
export const stardustMult = (mode: Mode, nth: number) =>
  mode === 'ranked' ? RANKED_STARDUST : nth <= CASUAL_FULL_RUNS ? CASUAL_STARDUST[0] : CASUAL_STARDUST[1];

/**
 * A run ended: tickets and eggs by mode. Ranked: eggs at the 3 and 10 win marks, the ticket back at 7+ wins.
 * Casual: an egg only for a 10-win run, once a day; the first 10-win casual run of the day earns a ticket.
 */
export function runEnded(f: FarmState, mode: Mode, wins: number, now: number): { eggs: number; ticket: boolean } {
  rollDay(f, now);
  let ticket = false;
  let eggs = 0;
  if (mode === 'ranked') {
    eggs = eggsFor(f, wins, now);
    if (wins >= RANKED_REFUND_WINS && f.tickets < TICKET_HOLD) (f.tickets++, (ticket = true));
  } else if (wins >= CASUAL_TICKET_WINS) {
    if (!f.casualEgg && f.eggs.length < NEST) {
      f.eggs.push({ h: 0, need: EGG_HOURS[10], from: now });
      f.casualEgg = true;
      eggs = 1;
    }
    if (!f.casualTicket && f.tickets < TICKET_HOLD) {
      f.tickets++;
      f.casualTicket = true;
      ticket = true;
    }
  }
  f.updatedAt = now;
  return { eggs, ticket };
}

const canPay = (f: FarmState, stardust: number, cost: Partial<Record<Res | 'stardust', number>>) =>
  Object.entries(cost).every(([k, v]) => (k === 'stardust' ? stardust : f.res[k as Res]) >= (v ?? 0));
function pay(f: FarmState, cost: Partial<Record<Res | 'stardust', number>>) {
  for (const [k, v] of Object.entries(cost)) if (k !== 'stardust') f.res[k as Res] -= v ?? 0;
}

// ---------- one visit = a batch of ops (the onchain `farm_batch` will take the same list) ----------

export type FarmOp =
  | { op: 'send'; b: Building; hero: string }
  | { op: 'recall'; hero: string }
  | { op: 'collect'; b?: Building }
  | { op: 'craft'; n?: number }
  | { op: 'upgrade'; b: Building }
  | { op: 'unlock'; hero: string }
  | { op: 'pour'; res: Res; n: number }
  | { op: 'pourFind'; id: string }
  | { op: 'repair' };

/** repairing last season's calamity damage */
export const REPAIR_COST: Partial<Record<Res, number>> = { wood: 100, ore: 60 };

export interface OpCtx {
  now: number;
  scale: number;
  /** stardust the player has (lives on the profile); ops return how much they spent */
  stardust: number;
  /** heroes in an unfinished run: they cannot work */
  inRun: string[];
  season: string;
  /** randomness for lucky finds (server only; VRF onchain later) */
  rng?: () => number;
}

/** Apply one op. Returns an error string (nothing changed for that op) or the stardust it spent. */
export function applyOp(f: FarmState, o: FarmOp, c: OpCtx): string | { stardust: number } {
  rollDay(f, c.now);
  const isB = (b: unknown): b is Building => BUILDING_IDS.includes(b as Building);
  switch (o?.op) {
    case 'send': {
      if (!isB(o.b) || typeof o.hero !== 'string' || !HEROES_BY_ID[o.hero]) return 'bad op';
      if (!usableHeroes(f, c.now).includes(o.hero)) return 'hero not owned';
      if (c.inRun.includes(o.hero)) return 'hero is in a run';
      const at = heroBusy(f, o.hero);
      if (at) return 'hero already working';
      if (f.jobs[o.b].length >= slotsOf(f, o.b)) return 'no free slot';
      const job: Job = { hero: o.hero, since: c.now };
      if (!f.firstShift) {
        job.fast = true;
        f.firstShift = true;
      }
      f.jobs[o.b].push(job);
      return { stardust: 0 };
    }
    case 'recall': {
      const b = heroBusy(f, o.hero);
      if (!b) return 'hero not working';
      collect(f, b, c.now, c.scale, c.rng); // keeps what it made
      f.jobs[b] = f.jobs[b].filter((j) => j.hero !== o.hero);
      return { stardust: 0 };
    }
    case 'collect': {
      if (o.b !== undefined && !isB(o.b)) return 'bad op';
      for (const b of o.b ? [o.b] : BUILDING_IDS) collect(f, b, c.now, c.scale, c.rng);
      stamp(f, c.now);
      return { stardust: 0 };
    }
    case 'craft': {
      const n = Math.floor(Number(o.n ?? 1));
      if (!(n >= 1 && n <= TICKET_CRAFT_CAP)) return 'bad op';
      if (f.crafted + n > TICKET_CRAFT_CAP) return 'craft limit reached today';
      if (f.tickets + n > TICKET_HOLD) return 'ticket bag full';
      const cost = Object.fromEntries(Object.entries(TICKET_COST).map(([k, v]) => [k, (v ?? 0) * n]));
      if (!canPay(f, 0, cost)) return 'not enough resources';
      pay(f, cost);
      f.tickets += n;
      f.crafted += n;
      return { stardust: 0 };
    }
    case 'upgrade': {
      if (!isB(o.b)) return 'bad op';
      if (f.lv[o.b] >= maxLvOf(o.b)) return 'max level';
      const cost = upgradeCost(f.lv[o.b]);
      if (!canPay(f, c.stardust, cost)) return 'not enough resources';
      collect(f, o.b, c.now, c.scale, c.rng); // jobs keep what they made at the old rate
      pay(f, cost);
      f.lv[o.b]++;
      return { stardust: cost.stardust ?? 0 };
    }
    case 'unlock': {
      if (typeof o.hero !== 'string' || !HEROES_BY_ID[o.hero]) return 'bad op';
      if (f.owned.includes(o.hero)) return 'already owned';
      const cost = adoptCost(f);
      if (!canPay(f, c.stardust, cost)) return 'not enough resources';
      pay(f, cost);
      f.owned.push(o.hero);
      return { stardust: cost.stardust };
    }
    case 'pour': {
      const n = Math.floor(Number(o.n));
      if (!['wood', 'ore', 'crystal'].includes(o.res) || !(n >= 1)) return 'bad op';
      if (f.res[o.res] < n) return 'not enough resources';
      if (f.pouredSeason !== c.season) Object.assign(f, { poured: 0, pouredSeason: c.season });
      f.res[o.res] -= n;
      f.poured += n * MONUMENT_POINTS[o.res];
      return { stardust: 0 };
    }
    case 'pourFind': {
      // only ids of real finds (never a prototype key like "__proto__"), and a positive count (security review)
      if (typeof o.id !== 'string' || !Object.hasOwn(FIND_POINTS, o.id)) return 'bad op';
      const have = f.finds && Object.hasOwn(f.finds, o.id) ? f.finds[o.id] : 0;
      if (!(typeof have === 'number' && have > 0)) return 'not enough resources';
      if (f.pouredSeason !== c.season) Object.assign(f, { poured: 0, pouredSeason: c.season });
      f.finds![o.id] = have - 1;
      f.poured += FIND_POINTS[o.id];
      return { stardust: 0 };
    }
    case 'repair': {
      if (!f.damaged) return 'nothing to repair';
      if (!canPay(f, 0, REPAIR_COST)) return 'not enough resources';
      collect(f, f.damaged, c.now, c.scale);
      pay(f, REPAIR_COST);
      delete f.damaged;
      return { stardust: 0 };
    }
    default:
      return 'bad op';
  }
}

/**
 * A new season (design meeting 2026-11-26): the town never resets, but the hoard does not carry over either.
 * - wood, ore and crystal above the warehouse cap auto-pour into last season's monument share (status + head start)
 * - unused tickets expire
 * - last season's pour becomes a fading head start (√-scaled, capped)
 * - a missed community goal damages one landmark, never a contributor's
 * Buildings, levels, mastery, heroes, eggs and cosmetics stay. `goalMet` null = no monument record for last season.
 */
export function seasonRollover(f: FarmState, season: string, goalMet: boolean | null, now: number, pick: () => Building) {
  const from = f.season ?? f.pouredSeason ?? '';
  if (f.season === season) return null;
  f.season = season;
  if (!from || from === season) return null; // a new farm, or one from before this field: nothing to roll over
  let excess = 0;
  for (const r of ['wood', 'ore', 'crystal'] as const) {
    const over = Math.max(0, f.res[r] - capOf(f, r));
    f.res[r] -= over;
    excess += over * MONUMENT_POINTS[r];
  }
  const poured = (f.pouredSeason === from ? f.poured : 0) + excess;
  const tickets = f.tickets;
  f.tickets = 0;
  const head = poured > 0 ? headStartFor(poured) : 0;
  if (head > 0) f.head = { mult: head, from: now };
  else delete f.head;
  if (goalMet === false && poured < MONUMENT_MIN_PERSONAL) f.damaged = pick();
  Object.assign(f, { poured: 0, pouredSeason: season });
  f.rollover = { from, to: season, excess: Math.round(excess), tickets, head: Math.round(head * 1000) / 1000, ...(f.damaged ? { damaged: f.damaged } : {}) };
  return f.rollover;
}

/** Next season's head start from this season's pour: √-scaled, capped (10× the points ≈ 3× the boost). */
export const headStartFor = (points: number) => HEADSTART_MAX * Math.min(1, Math.sqrt(Math.max(0, points) / HEADSTART_FULL_AT));

// ---------- work egg ----------

/** Cosmetic pool (profile frames and titles for now; hero looks later). `rare` ones are guaranteed by EGG_PITY. */
export const EGG_POOL: { id: string; rare?: true; th: string; en: string }[] = [
  { id: 'frame_sakura', th: 'กรอบซากุระ', en: 'Sakura frame' },
  { id: 'frame_lantern', th: 'กรอบโคมไฟ', en: 'Lantern frame' },
  { id: 'frame_moon', th: 'กรอบพระจันทร์', en: 'Moon frame' },
  { id: 'title_farmer', th: 'ฉายา: ชาวไร่โมจิ', en: 'Title: Mochi Farmer' },
  { id: 'title_miner', th: 'ฉายา: นักขุดตัวน้อย', en: 'Title: Little Miner' },
  { id: 'title_sage', th: 'ฉายา: ผู้เฝ้าศาลเจ้า', en: 'Title: Shrine Keeper' },
  { id: 'frame_gold', rare: true, th: 'กรอบทองจันทร์ (หายาก)', en: 'Golden moon frame (rare)' },
  { id: 'title_legend', rare: true, th: 'ฉายา: ตำนานแห่งเมือง (หายาก)', en: 'Title: Town Legend (rare)' },
];
export const EGG_RARE_CHANCE = 0.1;

/** Odds shown before hatching (no duplicates: only what the player does not own yet). */
export function eggOdds(f: FarmState): { id: string; p: number }[] {
  const left = EGG_POOL.filter((x) => !f.cosmetics.includes(x.id));
  const rare = left.filter((x) => x.rare);
  const common = left.filter((x) => !x.rare);
  if (!left.length) return [];
  const pity = f.pity + 1 >= EGG_PITY && rare.length;
  const pr = !rare.length ? 0 : !common.length || pity ? 1 : EGG_RARE_CHANCE;
  return [...rare.map((x) => ({ id: x.id, p: pr / rare.length })), ...common.map((x) => ({ id: x.id, p: (1 - pr) / common.length }))];
}

/** A run ended with `wins`: an egg for each EGG_WINS mark it reached, while the nest has room. */
export function eggsFor(f: FarmState, wins: number, now: number): number {
  let n = 0;
  for (const w of EGG_WINS) if (wins >= w && f.eggs.length < NEST) (f.eggs.push({ h: 0, need: EGG_HOURS[w], from: now }), n++);
  return n;
}

/** Hatch the first egg if it has its work-hours. `roll` in [0,1) (server randomness now, VRF onchain later). */
export function hatch(f: FarmState, roll: number): string | { got: string } {
  const egg = f.eggs[0];
  if (!egg) return 'no egg';
  if (egg.h < egg.need) return 'egg not ready';
  const odds = eggOdds(f);
  f.eggs.shift();
  if (!odds.length) return { got: '' }; // collection complete: the egg is just a cheer
  let acc = 0;
  let got = odds[odds.length - 1].id;
  for (const o of odds) if (roll < (acc += o.p)) { got = o.id; break; }
  f.cosmetics.push(got);
  f.pity = EGG_POOL.find((x) => x.id === got)?.rare ? 0 : f.pity + 1;
  return { got };
}
