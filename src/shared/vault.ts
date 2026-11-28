// Account store for idle items (v5.1 build plan task 3; design: claude.ai doc "v5.1 Core loop").
// Everything here lives outside a run: Seals, Hero Book Saves, Kit, supplies, Moonstone (Moon Dust), line rank and the
// prototype's play-money test balance. Nothing in it ever enters RunState or a Ranked Build (Arena equality).
// Crystal stays in the town (FarmState.res.crystal), so it is never stored twice.
// Pure functions: the caller passes the time and the clock scale; no Date.now(), no Math.random().
import type { Build, Line } from '../sim/types';
import { LINES } from '../sim/types';

export const VAULT_V = 2;

/** Seals (v5.1): one line Seal per line; D at 3+ wins, C at 5+ wins and line rank 30. */
export type SealGrade = 'D' | 'C';
/** Seal uses before it wears out */
export const SEAL_USES: Record<SealGrade, number> = { D: 30, C: 45 };
/** stash size: at 1 claim a day it stays near 8 [I], so this cap should never block */
export const STASH_MAX = 30;
/** Kit (v5.1): T1 bound, T2/T3 tradable while not worn; 20 uses (2 per climb) */
export type KitTier = 1 | 2 | 3;
export const KIT_USES = 20;
export const KIT_MAX = 30;
/** slots per hero on the Tower team screen (assumption until the Tower engine fixes it) */
export const SEALS_PER_HERO = 1;
export const KITS_PER_HERO = 1;
/** Supplies used between Tower floors (the board counts 2) */
export type Supply = 'ration' | 'spareHeart';
export const SUPPLIES: Supply[] = ['ration', 'spareHeart'];
export const SUPPLY_MAX = 20;
/** Moonstone (Moon Dust): weekly counted clears F20 = 1, F25 = +1, at most 2 a week; first clears are bound */
export const MOONSTONE_WEEK_CAP = 2;
/** Line rank: +1 per run of that line's hero, +1 at 5 wins, +1 at 10 wins, +2 per Seal; first 5 runs a day count */
export const LINE_RANK_C = 30;
export const LINE_RANK_RUNS_PER_DAY = 5;
/**
 * Seal tray (v5.1 task 4): a finished run with SEAL_D_WINS+ wins offers its hero's line Seal (C at SEAL_C_WINS+ wins
 * once the line has rank LINE_RANK_C). Up to TRAY_MAX offers wait TRAY_HOURS each; 1 claim a day, paid in stardust.
 */
export const SEAL_D_WINS = 3;
export const SEAL_C_WINS = 5;
export const TRAY_MAX = 3;
export const TRAY_HOURS = 24;
/** what a claim costs: D 50 stardust (the first FREE_D_SEALS free), C 150 stardust + 1 crystal */
export const SEAL_COST: Record<SealGrade, { stardust: number; crystal: number }> = { D: { stardust: 50, crystal: 0 }, C: { stardust: 150, crystal: 1 } };
export const FREE_D_SEALS = 5;
/** Prototype fake market: every tester starts with the same play money, in cents ($10) */
export const TEST_BALANCE = 1000;

export interface Seal {
  id: string;
  line: Line;
  grade: SealGrade;
  /** 1-10; C pieces at 7+ may be traded */
  roll: number;
  /** fires early or late in the holder's turn on the floor */
  timing: 'early' | 'late';
  uses: number;
  /** bound pieces never reach the market; a Seal binds when it is equipped */
  bound: boolean;
  mutated?: true;
  /** Crack steps taken (roll 10 = Bright, with a season serial) */
  crack?: number;
  bright?: number;
  on?: string;
  madeAt: number;
}
export interface Kit {
  id: string;
  tier: KitTier;
  /** T3 Attuned Kit's line (+9% on it, +6% off it) */
  line?: Line;
  uses: number;
  on?: string;
  madeAt: number;
}
/** A Seal waiting in the tray: claim it (1 a day) before `exp` or it is gone */
export interface SealOffer {
  id: string;
  line: Line;
  grade: SealGrade;
  roll: number;
  timing: 'early' | 'late';
  /** the run that earned it */
  hero: string;
  runId: string;
  wins: number;
  at: number;
  exp: number;
}
/** A Hero Book Save: the build of a finished hand-played run, the hero's Tower roster entry */
export interface Save {
  hero: string;
  runId: string;
  build: Build;
  wins: number;
  losses: number;
  mode: 'casual' | 'ranked';
  at: number;
}
export interface Vault {
  v: number;
  seals: Seal[];
  kit: Kit[];
  /** hero → its Save (only owned heroes) */
  saves: Record<string, Save>;
  /** hero → the newest run that could replace its Save ("Replace Witch's Save with this run?") */
  pending: Record<string, Save>;
  supplies: Record<Supply, number>;
  moonstone: { bound: number; tradable: number; week: number; weekEarned: number };
  lineRank: Record<Line, number>;
  rankDay: { day: number; runs: number };
  testBalance: number;
  /** Seal tray (oldest first), the game day of the last claim (-1 = never), free D claims used */
  tray: SealOffer[];
  claimDay: number;
  freeD: number;
  nextId: number;
  createdAt: number;
  updatedAt: number;
}

// ---------- the test clock ----------
const H = 3_600_000;
export const DAY_MS = 24 * H;
export const WEEK_MS = 7 * DAY_MS;
/** a Monday 00:00 in Bangkok: weeks and days count from here */
export const CLOCK_EPOCH = Date.parse('2026-11-30T00:00:00+07:00');
/**
 * Game day and week index under a clock scale: 1 = real time; 2 = the prototype test season (a 3.5-day week, so a
 * 3-week season fits in 10.5 days); up to 3600 for API checks.
 */
export const dayOf = (t: number, scale = 1) => Math.floor(((t - CLOCK_EPOCH) * scale) / DAY_MS);
export const weekOf = (t: number, scale = 1) => Math.floor(((t - CLOCK_EPOCH) * scale) / WEEK_MS);

export function newVault(now: number, scale = 1): Vault {
  return {
    v: VAULT_V,
    seals: [],
    kit: [],
    saves: Object.create(null),
    pending: Object.create(null),
    supplies: { ration: 0, spareHeart: 0 },
    moonstone: { bound: 0, tradable: 0, week: weekOf(now, scale), weekEarned: 0 },
    lineRank: Object.fromEntries(LINES.map((l) => [l, 0])) as Record<Line, number>,
    rankDay: { day: dayOf(now, scale), runs: 0 },
    testBalance: TEST_BALANCE,
    tray: [],
    claimDay: -1,
    freeD: 0,
    nextId: 1,
    createdAt: now,
    updatedAt: now,
  };
}

const newId = (v: Vault, p: string) => `${p}${v.nextId++}`;
const touch = (v: Vault, now: number) => {
  v.updatedAt = now;
};

/** a C Seal may be traded when its roll is 7+, it mutated or it was Cracked, and it was never equipped */
export const sealTradable = (s: Seal) => !s.bound && s.grade === 'C' && (s.roll >= 7 || !!s.mutated || (s.crack ?? 0) > 0);
/** T2/T3 Kit may be traded while nobody wears it */
export const kitTradable = (k: Kit) => k.tier >= 2 && !k.on;
export const cUnlocked = (v: Vault, line: Line) => v.lineRank[line] >= LINE_RANK_C;

// ---------- grants and spends (server-side callers: run end, Seal tray, crafting, Tower) ----------

export function addSeal(v: Vault, s: { line: Line; grade: SealGrade; roll: number; timing: 'early' | 'late'; mutated?: boolean }, now: number): Seal | string {
  if (!LINES.includes(s.line) || !(s.grade === 'D' || s.grade === 'C')) return 'bad seal';
  if (!Number.isInteger(s.roll) || s.roll < 1 || s.roll > 10 || !(s.timing === 'early' || s.timing === 'late')) return 'bad seal';
  if (v.seals.length >= STASH_MAX) return 'stash full';
  const seal: Seal = {
    id: newId(v, 's'), line: s.line, grade: s.grade, roll: s.roll, timing: s.timing, uses: SEAL_USES[s.grade],
    bound: s.grade === 'D', ...(s.mutated ? { mutated: true as const } : {}), madeAt: now,
  };
  v.seals.push(seal);
  v.lineRank[s.line] += 2;
  touch(v, now);
  return seal;
}

export function addKit(v: Vault, k: { tier: KitTier; line?: Line }, now: number): Kit | string {
  if (!(k.tier === 1 || k.tier === 2 || k.tier === 3)) return 'bad kit';
  if (k.tier === 3 ? !k.line || !LINES.includes(k.line) : k.line !== undefined) return 'bad kit';
  if (v.kit.length >= KIT_MAX) return 'kit full';
  const kit: Kit = { id: newId(v, 'k'), tier: k.tier, ...(k.line ? { line: k.line } : {}), uses: KIT_USES, madeAt: now };
  v.kit.push(kit);
  touch(v, now);
  return kit;
}

export function addSupply(v: Vault, s: Supply, n: number, now: number): string | null {
  if (!SUPPLIES.includes(s) || !Number.isInteger(n) || n < 1) return 'bad supply';
  if (v.supplies[s] + n > SUPPLY_MAX) return 'supplies full';
  v.supplies[s] += n;
  touch(v, now);
  return null;
}
export function useSupply(v: Vault, s: Supply, now: number): string | null {
  if (!SUPPLIES.includes(s)) return 'bad supply';
  if (v.supplies[s] < 1) return 'no supply';
  v.supplies[s]--;
  touch(v, now);
  return null;
}

/** one use of a worn Seal or Kit (a climb or a Raid attack); it is gone at 0 */
export function wear(v: Vault, id: string, n: number, now: number): string | null {
  if (!Number.isInteger(n) || n < 1) return 'bad uses';
  const list: (Seal | Kit)[] = id.startsWith('s') ? v.seals : v.kit;
  const it = list.find((x) => x.id === id);
  if (!it) return 'no such item';
  it.uses = Math.max(0, it.uses - n);
  if (it.uses === 0) {
    if (id.startsWith('s')) v.seals = v.seals.filter((x) => x.id !== id);
    else v.kit = v.kit.filter((x) => x.id !== id);
  }
  touch(v, now);
  return null;
}

/** roll the week over: the weekly tradable cap counts again */
function moonWeek(v: Vault, now: number, scale: number) {
  const w = weekOf(now, scale);
  if (v.moonstone.week !== w) v.moonstone = { ...v.moonstone, week: w, weekEarned: 0 };
}
/**
 * Moonstone from the Tower. `weekly`: a counted clear of F20 / F25, at most MOONSTONE_WEEK_CAP a week, tradable once
 * the market is open (bound before). `firstClear`: always bound, outside the weekly cap. Returns how many were given.
 */
export function grantMoonstone(v: Vault, n: number, kind: 'weekly' | 'firstClear', marketOpen: boolean, now: number, scale = 1): number {
  if (!Number.isInteger(n) || n < 1) return 0;
  moonWeek(v, now, scale);
  let give = n;
  if (kind === 'weekly') {
    give = Math.min(n, MOONSTONE_WEEK_CAP - v.moonstone.weekEarned);
    if (give <= 0) return 0;
    v.moonstone.weekEarned += give;
  }
  if (kind === 'weekly' && marketOpen) v.moonstone.tradable += give;
  else v.moonstone.bound += give;
  touch(v, now);
  return give;
}
/** spend Moonstone (Crack, T3 Kit, cosmetic recipe): bound pieces first */
export function spendMoonstone(v: Vault, n: number, now: number): string | null {
  if (!Number.isInteger(n) || n < 1) return 'bad amount';
  if (v.moonstone.bound + v.moonstone.tradable < n) return 'not enough moonstone';
  const b = Math.min(v.moonstone.bound, n);
  v.moonstone.bound -= b;
  v.moonstone.tradable -= n - b;
  touch(v, now);
  return null;
}

/** play money for the prototype market (cents) */
export function moveTestBalance(v: Vault, cents: number, now: number): string | null {
  if (!Number.isInteger(cents) || cents === 0) return 'bad amount';
  if (v.testBalance + cents < 0) return 'not enough balance';
  v.testBalance += cents;
  touch(v, now);
  return null;
}

// ---------- Seal tray ----------

/** offers past their 24 h are gone */
function pruneTray(v: Vault, now: number) {
  v.tray = v.tray.filter((o) => o.exp > now);
}
/** the grade a run earns for its line (null = no Seal): read after this run's line rank is counted */
export const sealGradeFor = (v: Vault, line: Line, wins: number): SealGrade | null =>
  wins >= SEAL_C_WINS && cUnlocked(v, line) ? 'C' : wins >= SEAL_D_WINS ? 'D' : null;
/** what claiming this offer costs now (the first FREE_D_SEALS D Seals are free) */
export const claimCost = (v: Vault, grade: SealGrade) => (grade === 'D' && v.freeD < FREE_D_SEALS ? { stardust: 0, crystal: 0 } : SEAL_COST[grade]);

/**
 * Put a Seal offer in the tray. `rnd`: two numbers in [0, 1) from the server's random source (roll 1-10, early or
 * late). A full tray drops its oldest offer.
 */
export function offerSeal(v: Vault, r: { line: Line; grade: SealGrade; hero: string; runId: string; wins: number }, rnd: [number, number], now: number, scale = 1): SealOffer {
  pruneTray(v, now);
  while (v.tray.length >= TRAY_MAX) v.tray.shift();
  const roll = 1 + Math.min(9, Math.floor(rnd[0] * 10));
  const offer: SealOffer = {
    id: newId(v, 'o'), line: r.line, grade: r.grade, roll, timing: rnd[1] < 0.5 ? 'early' : 'late',
    hero: r.hero, runId: r.runId, wins: r.wins, at: now, exp: now + (TRAY_HOURS * H) / scale,
  };
  v.tray.push(offer);
  touch(v, now);
  return offer;
}

/**
 * Claim a tray offer: 1 a day, paid from `wallet` (the caller takes `cost` off the player's stardust and crystal).
 * Returns the new Seal and its cost, or an error (nothing changed).
 */
export function claimSeal(v: Vault, id: string, wallet: { stardust: number; crystal: number }, now: number, scale = 1): { seal: Seal; cost: { stardust: number; crystal: number } } | string {
  pruneTray(v, now);
  const o = v.tray.find((x) => x.id === id);
  if (!o) return 'no such offer';
  const day = dayOf(now, scale);
  if (v.claimDay === day) return 'claimed today';
  const cost = claimCost(v, o.grade);
  if (wallet.stardust < cost.stardust) return 'not enough stardust';
  if (wallet.crystal < cost.crystal) return 'not enough crystal';
  const seal = addSeal(v, o, now);
  if (typeof seal === 'string') return seal;
  if (o.grade === 'D' && cost.stardust === 0) v.freeD++;
  v.tray = v.tray.filter((x) => x.id !== id);
  v.claimDay = day;
  return { seal, cost };
}

// ---------- run end: line rank and the Hero Book ----------

export interface RunEnd {
  runId: string;
  hero: string;
  line: Line;
  build: Build;
  wins: number;
  losses: number;
  mode: 'casual' | 'ranked';
}
/**
 * A finished hand-played run (any mode). Line rank: the first LINE_RANK_RUNS_PER_DAY runs of a day count.
 * Hero Book: an owned hero's first Save is kept at once; after that the run waits as `pending` until the player
 * keeps it (keepSave). A hero that is not owned (a Ranked offer) keeps the run pending until it is adopted.
 * Seal tray: with `rnd` (the server's two random numbers) a run with SEAL_D_WINS+ wins offers its line's Seal.
 * `sealWins` (default `r.wins`) is what the Seal grade counts, e.g. without a guided-tutorial win.
 */
export function onRunEnd(
  v: Vault, r: RunEnd, owned: boolean, now: number, scale = 1, rnd?: [number, number], sealWins = r.wins,
): { rank: number; saved: boolean; offer?: SealOffer } {
  const day = dayOf(now, scale);
  if (v.rankDay.day !== day) v.rankDay = { day, runs: 0 };
  let rank = 0;
  if (LINES.includes(r.line) && v.rankDay.runs < LINE_RANK_RUNS_PER_DAY) {
    v.rankDay.runs++;
    rank = 1 + (r.wins >= 5 ? 1 : 0) + (r.wins >= 10 ? 1 : 0);
    v.lineRank[r.line] += rank;
  }
  const save: Save = { hero: r.hero, runId: r.runId, build: r.build, wins: r.wins, losses: r.losses, mode: r.mode, at: now };
  let saved = false;
  if (owned && !v.saves[r.hero]) {
    v.saves[r.hero] = save;
    delete v.pending[r.hero];
    saved = true;
  } else v.pending[r.hero] = save;
  const grade = rnd && LINES.includes(r.line) ? sealGradeFor(v, r.line, sealWins) : null;
  const offer = grade ? offerSeal(v, { line: r.line, grade, hero: r.hero, runId: r.runId, wins: sealWins }, rnd!, now, scale) : undefined;
  touch(v, now);
  return { rank, saved, ...(offer ? { offer } : {}) };
}

// ---------- player ops (POST /api/vault) ----------

export type VaultOp =
  | { op: 'keepSave'; hero: string }
  | { op: 'dropPending'; hero: string }
  | { op: 'equip'; id: string; hero: string }
  | { op: 'unequip'; id: string };

/** Apply one player op. `owned`: the heroes this account owns (only they have Saves and wear items). */
export function applyVaultOp(v: Vault, o: VaultOp, owned: string[], now: number): string | null {
  if (!o || typeof o !== 'object') return 'bad op';
  switch (o.op) {
    case 'keepSave': {
      if (typeof o.hero !== 'string' || !Object.hasOwn(v.pending, o.hero)) return 'nothing to keep';
      if (!owned.includes(o.hero)) return 'hero not owned';
      v.saves[o.hero] = v.pending[o.hero];
      delete v.pending[o.hero];
      break;
    }
    case 'dropPending': {
      if (typeof o.hero !== 'string' || !Object.hasOwn(v.pending, o.hero)) return 'nothing to drop';
      delete v.pending[o.hero];
      break;
    }
    case 'equip': {
      if (typeof o.id !== 'string' || typeof o.hero !== 'string') return 'bad op';
      if (!owned.includes(o.hero)) return 'hero not owned';
      const seal = v.seals.find((s) => s.id === o.id);
      const kit = seal ? undefined : v.kit.find((k) => k.id === o.id);
      const it = seal ?? kit;
      if (!it) return 'no such item';
      if (it.on === o.hero) return null;
      const worn = seal ? v.seals.filter((s) => s.on === o.hero).length : v.kit.filter((k) => k.on === o.hero).length;
      if (worn >= (seal ? SEALS_PER_HERO : KITS_PER_HERO)) return 'slot taken';
      it.on = o.hero;
      if (seal) seal.bound = true; // a Seal binds on equip
      break;
    }
    case 'unequip': {
      if (typeof o.id !== 'string') return 'bad op';
      const it = v.seals.find((s) => s.id === o.id) ?? v.kit.find((k) => k.id === o.id);
      if (!it) return 'no such item';
      delete it.on;
      break;
    }
    default:
      return 'bad op';
  }
  touch(v, now);
  return null;
}

/** what the client sees: the stored items plus what is tradable, and how much weekly Moonstone is left */
export function vaultView(v: Vault, now: number, scale = 1) {
  const week = weekOf(now, scale);
  const day = dayOf(now, scale);
  const earned = v.moonstone.week === week ? v.moonstone.weekEarned : 0;
  return {
    v: v.v,
    seals: v.seals.map((s) => ({ ...s, tradable: sealTradable(s) })),
    kit: v.kit.map((k) => ({ ...k, tradable: kitTradable(k) })),
    saves: v.saves,
    pending: v.pending,
    supplies: v.supplies,
    moonstone: { bound: v.moonstone.bound, tradable: v.moonstone.tradable, weekLeft: MOONSTONE_WEEK_CAP - earned },
    lineRank: v.lineRank,
    cLines: LINES.filter((l) => cUnlocked(v, l)),
    testBalance: v.testBalance,
    tray: v.tray.filter((o) => o.exp > now).map((o) => ({ ...o, cost: claimCost(v, o.grade) })),
    /** a claim is left today; free D Seals left; when the next game day starts (a claim is possible again) */
    claim: { left: v.claimDay !== day, freeD: Math.max(0, FREE_D_SEALS - v.freeD), next: CLOCK_EPOCH + ((day + 1) * DAY_MS) / scale },
    clock: { day, week, scale },
  };
}

/** a stored vault from an older version or a hand-edited file: fill what is missing (never throws) */
export function loadVault(x: unknown, now: number, scale = 1): Vault {
  const base = newVault(now, scale);
  if (!x || typeof x !== 'object') return base;
  const v = x as Partial<Vault>;
  return {
    ...base,
    ...v,
    v: VAULT_V,
    supplies: { ...base.supplies, ...(v.supplies ?? {}) },
    moonstone: { ...base.moonstone, ...(v.moonstone ?? {}) },
    lineRank: { ...base.lineRank, ...(v.lineRank ?? {}) },
    seals: Array.isArray(v.seals) ? v.seals : [],
    kit: Array.isArray(v.kit) ? v.kit : [],
    tray: Array.isArray(v.tray) ? v.tray : [],
    claimDay: typeof v.claimDay === 'number' ? v.claimDay : -1,
    freeD: typeof v.freeD === 'number' ? v.freeD : 0,
    saves: Object.assign(Object.create(null), v.saves ?? {}),
    pending: Object.assign(Object.create(null), v.pending ?? {}),
  };
}
