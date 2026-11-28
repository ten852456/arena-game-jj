import type { Build, CombatResult, Line } from '../../sim/types';

/** AI opponent difficulty (same values as `BotTier` in src/sim/bot.ts). */
export type AiTier = 'easy' | 'normal' | 'hard';

export interface FightResponse {
  fightId?: string;
  seed: number;
  day: number;
  /** the name the server used for you: a unique `Mochi-1234` when you sent none / "ผู้เล่น" (store it) */
  name?: string;
  opponent: {
    name: string;
    ai: boolean;
    /** only for AI opponents */
    tier?: AiTier;
    line?: Line;
    build: Build;
    rating: number;
    /** the opponent's hero is moonlit (shiny) */
    shiny?: boolean;
  };
  /** arena mode the server recorded for this run, and whether its hero is moonlit (shiny) */
  mode?: 'casual' | 'ranked';
  shiny?: boolean;
  /** rating window the opponent was found in (null = AI) and how many player builds were in it */
  match?: { window: number | null; pool: number };
  result: CombatResult;
  /** this was the guided tutorial's training fight */
  tutorial?: boolean;
  won: boolean;
  rating: number;
  offline?: boolean;
}

export interface ReplayRecord {
  id: string;
  day: number;
  seed: number;
  a: { name: string; build: Build };
  b: { name: string; build: Build; ai: boolean; tier?: AiTier };
  winner: number;
  v: number;
}

export interface ScoutResponse {
  day: number;
  /** player builds this run could meet next */
  total: number;
  window: number | null;
  counts: Record<Line, number>;
  /** whole percents per line (0 when total is 0) */
  pct: Record<Line, number>;
  top: Line | null;
  /** set when there are no player builds: the next fight is an AI of this tier */
  ai: { tier: AiTier } | null;
}

export interface RunRow {
  runId: string;
  name: string;
  hero: string;
  /** null for runs finished before the 8 lines */
  line: Line | null;
  wins: number;
  losses: number;
  day: number;
  stardust: number;
  season: string;
  finishedAt: number;
}

export interface PlayerTotals {
  name: string;
  /** ผงดาว */
  stardust: number;
  runs: number;
  wins: number;
  losses: number;
  best: { runId: string; hero: string; wins: number; losses: number; day: number; finishedAt: number } | null;
}

export interface FinishRunRequest {
  playerId: string;
  runId: string;
  name: string;
  hero: string;
  wins: number;
  losses: number;
  day: number;
  build: Build;
}

export interface FinishRunResponse {
  /** true when this run was already recorded (same reward returned again, nothing added) */
  already: boolean;
  reward: {
    stardust: number;
    base?: number;
    flawless?: number;
    /** wins that counted (only fights the server ran) */
    wins: number;
    /** the client claimed more wins than the server saw */
    capped: boolean;
  };
  run: RunRow;
  player: PlayerTotals;
}

export interface ProfileResponse {
  known: boolean;
  player: PlayerTotals;
  /** last 20 finished runs, newest first */
  recent: RunRow[];
}

export interface LeaderboardResponse {
  period: 'season' | 'day';
  season: string;
  /** Thailand calendar date, period=day only */
  date?: string;
  rows: (RunRow & { rank: number; you?: true })[];
}

/** GET /api/farm and the answer of every farm action (src/server/routes/farm.ts farmView) */
export type FarmBuilding = 'lumber' | 'mine' | 'shrine';
export interface FarmJobView { hero: string; ready: number; fill: number; fullIn: number; fits: boolean; mastery: number; fast?: true }
export interface FarmView {
  now: number;
  scale: number;
  runLimit: boolean;
  owned: string[];
  usable: string[];
  rotation: string[];
  inRun: string[];
  res: { wood: number; ore: number; crystal: number };
  caps: { wood: number; ore: number; crystal: number };
  lv: Record<FarmBuilding, number>;
  slots: Record<FarmBuilding, number>;
  jobs: Record<FarmBuilding, FarmJobView[]>;
  damaged?: FarmBuilding;
  tickets: number;
  free: number;
  crafted: number;
  runsLeft: number;
  stamps: number;
  stampedToday: boolean;
  stardust: number;
  pass: boolean;
  eggs: { h: number; need: number }[];
  odds: { id: string; p: number }[];
  cosmetics: string[];
  pity: number;
  headStart: number;
  newbie: number;
  monument: { season: string; mine: number; points: number; goal: number; players: number; tiers: number[]; minPersonal: number };
  stored?: boolean;
  finds: Record<string, number>;
  shinies: string[];
  findRolls: number;
  casualRuns: number;
  casualTicket: boolean;
  /** what the last season rollover did (until the next action) */
  rollover?: { from: string; to: string; excess: number; tickets: number; head: number; damaged?: FarmBuilding };
  /** lucky finds of this action (POST answers only) */
  found?: string[];
}
export type FarmOpReq =
  | { op: 'send'; b: FarmBuilding; hero: string }
  | { op: 'recall'; hero: string }
  | { op: 'collect'; b?: FarmBuilding }
  | { op: 'craft'; n?: number }
  | { op: 'upgrade'; b: FarmBuilding }
  | { op: 'unlock'; hero: string }
  | { op: 'pour'; res: 'wood' | 'ore' | 'crystal'; n: number }
  | { op: 'repair' }
  | { op: 'pourFind'; id: string };
/** v5.1 account store (src/shared/vault.ts, GET/POST /api/vault): what the Hero Hall and the run-end receipt show */
export type SealGrade = 'D' | 'C';
export interface SealOfferView { id: string; line: Line; grade: SealGrade; roll: number; timing: 'early' | 'late'; hero: string; runId: string; wins: number; at: number; exp: number; cost: { stardust: number; crystal: number } }
export interface SealView { id: string; line: Line; grade: SealGrade; roll: number; timing: 'early' | 'late'; uses: number; bound: boolean; tradable: boolean; on?: string }
export interface SaveView { hero: string; runId: string; build: Build; wins: number; losses: number; mode: 'casual' | 'ranked'; at: number }
export interface VaultView {
  stored: boolean;
  seals: SealView[];
  saves: Record<string, SaveView>;
  pending: Record<string, SaveView>;
  lineRank: Record<Line, number>;
  cLines: Line[];
  tray: SealOfferView[];
  claim: { left: boolean; freeD: number; next: number };
  /** the wallet a claim pays from: the town's crystal and the profile's stardust */
  crystal: number;
  stardust: number;
}
export type VaultOpReq =
  | { op: 'claim'; id: string }
  | { op: 'keepSave'; hero: string }
  | { op: 'dropPending'; hero: string }
  | { op: 'equip'; id: string; hero: string }
  | { op: 'unequip'; id: string };

export interface FeedRow { t: number; name: string; kind: 'find' | 'shiny'; id: string; first?: true }

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: { 'content-type': 'application/json' } });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return (await r.json()) as T;
}

const qs = (o: Record<string, string | number | undefined>) =>
  new URLSearchParams(Object.entries(o).filter((e): e is [string, string | number] => e[1] !== undefined && e[1] !== '').map(([k, v]) => [k, String(v)])).toString();

export const api = {
  fight: (body: { runId: string; name: string; day: number; rating: number; build: Build; playerId?: string; tutorial?: boolean; mode?: 'casual' | 'ranked'; seed?: number }) =>
    req<FightResponse>('/api/fight', { method: 'POST', body: JSON.stringify(body) }),
  replay: (id: string) => req<ReplayRecord>('/api/replay/' + encodeURIComponent(id)),
  /** line mix of the player builds the next fight could meet */
  scout: (q: { day: number; rating: number; runId?: string; playerId?: string }) => req<ScoutResponse>('/api/scout?' + qs(q)),
  /** record a finished run once (idempotent per runId) and get the ผงดาว reward + totals */
  finishRun: (body: FinishRunRequest) => req<FinishRunResponse>('/api/run/finish', { method: 'POST', body: JSON.stringify(body) }),
  profile: (playerId: string) => req<ProfileResponse>('/api/profile?' + qs({ playerId })),
  farm: (playerId: string) => req<FarmView>('/api/farm?' + qs({ playerId })),
  /** one visit: ops applied in order, all-or-nothing */
  farmOps: (playerId: string, ops: FarmOpReq[]) => req<FarmView>('/api/farm', { method: 'POST', body: JSON.stringify({ playerId, ops }) }),
  feed: () => req<{ rows: FeedRow[] }>('/api/feed'),
  vault: (playerId: string) => req<VaultView>('/api/vault?' + qs({ playerId })),
  /** v5.1 account store ops, all-or-nothing (a claim pays stardust and crystal) */
  vaultOps: (playerId: string, ops: VaultOpReq[]) => req<VaultView>('/api/vault', { method: 'POST', body: JSON.stringify({ playerId, ops }) }),
  /** v5.1: the server's Ranked offer for this player (the same one until a Ranked run starts with it) */
  rankedOffer: (playerId: string) => req<{ seed: number; heroes: string[] }>('/api/ranked/offer', { method: 'POST', body: JSON.stringify({ playerId }) }),
  hatch: (playerId: string) => req<{ got: string; farm: FarmView }>('/api/farm/hatch', { method: 'POST', body: JSON.stringify({ playerId }) }),
  leaderboard: (period: 'season' | 'day' = 'season', playerId?: string) =>
    req<LeaderboardResponse>('/api/leaderboard?' + qs({ period, playerId })),
};
