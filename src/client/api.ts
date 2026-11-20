import type { Archetype, Build, CombatResult } from '../sim/types';

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
    arch?: Archetype;
    build: Build;
    rating: number;
  };
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
  counts: Record<Archetype, number>;
  /** whole percents per archetype (0 when total is 0) */
  pct: Record<Archetype, number>;
  top: Archetype | null;
  /** set when there are no player builds: the next fight is an AI of this tier */
  ai: { tier: AiTier } | null;
}

export interface RunRow {
  runId: string;
  name: string;
  hero: string;
  arch: Archetype;
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

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: { 'content-type': 'application/json' } });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return (await r.json()) as T;
}

const qs = (o: Record<string, string | number | undefined>) =>
  new URLSearchParams(Object.entries(o).filter((e): e is [string, string | number] => e[1] !== undefined && e[1] !== '').map(([k, v]) => [k, String(v)])).toString();

export const api = {
  fight: (body: { runId: string; name: string; day: number; rating: number; build: Build; playerId?: string; tutorial?: boolean }) =>
    req<FightResponse>('/api/fight', { method: 'POST', body: JSON.stringify(body) }),
  replay: (id: string) => req<ReplayRecord>('/api/replay/' + encodeURIComponent(id)),
  /** archetype mix of the player builds the next fight could meet */
  scout: (q: { day: number; rating: number; runId?: string; playerId?: string }) => req<ScoutResponse>('/api/scout?' + qs(q)),
  /** record a finished run once (idempotent per runId) and get the ผงดาว reward + totals */
  finishRun: (body: FinishRunRequest) => req<FinishRunResponse>('/api/run/finish', { method: 'POST', body: JSON.stringify(body) }),
  profile: (playerId: string) => req<ProfileResponse>('/api/profile?' + qs({ playerId })),
  leaderboard: (period: 'season' | 'day' = 'season', playerId?: string) =>
    req<LeaderboardResponse>('/api/leaderboard?' + qs({ period, playerId })),
};
