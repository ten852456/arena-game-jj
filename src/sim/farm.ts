// Farm (idle town): heroes work at landmarks, resources pay for arena tickets, hero unlocks, town upgrades and the
// season monument. Design: docs/FARM.md. Pure and deterministic: every function takes `now` (ms) and a time scale,
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
/** +25% when the hero's skill line fits the landmark (docs/FARM.md; tower research = burn/poison, later). */
export const AFFINITY_BONUS = 0.25;
export const AFFINITY: Record<Building, Line[]> = {
  lumber: ['hit', 'dodge', 'wind'],
  mine: ['shield', 'ice', 'gold'],
  shrine: ['heal', 'time'],
};

/** Per building level (index = level − 1). */
export const MAX_LV = 5;
export const SLOTS = [1, 2, 3, 3, 4];
/**
 * hours a job's storage holds before it stops. 12 h at Lv1 covers the night gap of a 2-collects-a-day player (8 h
 * lost a third of the day); Lv5's 24 h makes one visit a day full play (research: docs/FARM.md "Fair timers").
 */
export const STORAGE_H = [12, 14, 16, 20, 24];
/** cost to go from level i+1 to i+2 */
export const UPGRADE_COST: Partial<Record<Res | 'stardust', number>>[] = [
  { wood: 60, ore: 40 }, // Lv2 is cheap on purpose: the day-1 hook (the first shift pays for it)
  { wood: 250, ore: 150, crystal: 2 }, // ~day 3
  { wood: 1200, ore: 800, crystal: 6 }, // ~day 8
  { wood: 3000, ore: 2000, crystal: 15 }, // ~day 15
];
/** the battle pass adds one work slot at every landmark (production only: supplies and tickets stay capped) */
export const PASS_SLOTS = 1;
/** warehouse: at most this many hours of a landmark's full output can be held (3 days: covers a weekend away) */
export const WAREHOUSE_H = 72;

/** Arena tickets. Free runs: 3 a day, and unused ones are banked up to FREE_BANK (a missed day is not lost). */
export const FREE_RUNS = 3;
export const FREE_BANK = 6;
export const TICKET_COST: Partial<Record<Res, number>> = { wood: 30, ore: 20 };
export const TICKET_CRAFT_CAP = 4;
export const TICKET_HOLD = 8;

/** Heroes */
export const STARTERS = ['knight', 'assassin', 'pyro', 'duelist'];
export const ROTATION = 2;
export const UNLOCK_COST = { stardust: 300, crystal: 3 };

/** Day-1 hook: the very first job ever finishes its storage in this long (instead of 8 h). */
export const FIRST_SHIFT_MS = 5 * 60_000;

/**
 * Work egg: earned by 3-win and 10-win runs, hatched by hero work-hours (every working hero adds its hours).
 * Cosmetic only, never sold or traded. One egg incubates; up to NEST − 1 wait in line.
 */
export const EGG_WINS = [3, 10];
export const EGG_HOURS: Record<number, number> = { 3: 48, 10: 120 };
export const EGG_PASS_SPEED = 1.5;
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
  /** free runs banked (FREE_RUNS added each new day, up to FREE_BANK) */
  free: number;
  crafted: number;
  /** stamp card (total days, not consecutive) and the last day stamped */
  stamps: number;
  stampDay?: string;
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
  Object.assign(f, { day: d, free: Math.min(FREE_BANK, f.free + FREE_RUNS * days), crafted: 0 });
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

export const slotsOf = (f: FarmState, b: Building) => SLOTS[f.lv[b] - 1] + (f.pass ? PASS_SLOTS : 0);
export const fits = (hero: string, b: Building) => AFFINITY[b].includes(HEROES_BY_ID[hero]?.line as Line);
export const newbieBoost = (f: FarmState, now: number) =>
  NEWBIE_BOOST * Math.max(0, 1 - (now - (f.createdAt ?? 0)) / (NEWBIE_DAYS * 24 * H));
export const rateOf = (f: FarmState, b: Building, hero: string, now: number) =>
  RATE[RES_OF[b]] * (fits(hero, b) ? 1 + AFFINITY_BONUS : 1) * (1 + headStart(f, now) + newbieBoost(f, now)) * (f.damaged === b ? 0.5 : 1);
export const storageMs = (f: FarmState, b: Building) => STORAGE_H[f.lv[b] - 1] * H;
/** the most of a resource the warehouse holds: WAREHOUSE_H of the landmark's full output at its level */
export function capOf(f: FarmState, r: Res): number {
  const b = BUILDING_IDS.find((x) => RES_OF[x] === r)!;
  return Math.max(10, Math.ceil(RATE[r] * (1 + AFFINITY_BONUS) * slotsOf(f, b) * WAREHOUSE_H));
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
export function collect(f: FarmState, b: Building, now: number, scale = 1): number {
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
    hatchHours(f, lost ? p.used / H : p.rate > 0 ? take / p.rate : 0);
    if (lost) j.since = now; // full storage or a full warehouse: the rest is lost
    else j.since += p.rate > 0 ? ((take / p.rate) * H) / p.speed : 0; // keep the part-unit already made
    if (j.fast) delete j.fast;
  }
  f.updatedAt = now;
  return got;
}

function hatchHours(f: FarmState, h: number, bonus = false) {
  const egg = f.eggs[0];
  if (egg) egg.h = Math.min(egg.need, egg.h + h * (f.pass && !bonus ? EGG_PASS_SPEED : 1));
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
  else return 'no runs left today: craft a ticket at the arena gate';
  stamp(f, now);
  f.updatedAt = now;
  return null;
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
      collect(f, b, c.now, c.scale); // keeps what it made
      f.jobs[b] = f.jobs[b].filter((j) => j.hero !== o.hero);
      return { stardust: 0 };
    }
    case 'collect': {
      if (o.b !== undefined && !isB(o.b)) return 'bad op';
      for (const b of o.b ? [o.b] : BUILDING_IDS) collect(f, b, c.now, c.scale);
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
      if (f.lv[o.b] >= MAX_LV) return 'max level';
      const cost = UPGRADE_COST[f.lv[o.b] - 1];
      if (!canPay(f, c.stardust, cost)) return 'not enough resources';
      collect(f, o.b, c.now, c.scale); // jobs keep what they made at the old rate
      pay(f, cost);
      f.lv[o.b]++;
      return { stardust: cost.stardust ?? 0 };
    }
    case 'unlock': {
      if (typeof o.hero !== 'string' || !HEROES_BY_ID[o.hero]) return 'bad op';
      if (f.owned.includes(o.hero)) return 'already owned';
      if (!canPay(f, c.stardust, UNLOCK_COST)) return 'not enough resources';
      pay(f, UNLOCK_COST);
      f.owned.push(o.hero);
      return { stardust: UNLOCK_COST.stardust };
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
