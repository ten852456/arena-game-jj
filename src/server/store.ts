// JSON-file store (data/db.json). Fine for one Railway replica; swap for Postgres/Redis later.
// Every collection has a cap so the file cannot grow without bound, and a failed write never stops the server.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { SIM_VERSION } from '../sim/combat';
import type { Archetype, Build } from '../sim/types';

export const ROOT = resolve(import.meta.dirname, '../..');
const DATA_DIR = process.env.DATA_DIR ?? join(ROOT, 'data');
const DB_FILE = join(DATA_DIR, 'db.json');

/** Caps (oldest entries go first). */
export const PER_DAY_CAP = 300;
export const FIGHT_CAP = 2000;
export const TRACK_CAP = 5000;
export const RUN_CAP = 5000;
export const PLAYER_CAP = 20000;

/** Leaderboard season; bump the env var to start a new season (old runs stay in profiles). */
export const SEASON = (process.env.SEASON ?? 's1').slice(0, 16);

import type { BotTier } from '../sim/bot';
export type { BotTier };

export interface Snapshot {
  id: string;
  runId: string;
  /** owner's player id when the client sent one (never returned by the API) */
  playerId?: string;
  name: string;
  day: number;
  build: Build;
  rating: number;
  v: number;
  defWins: number;
  defLosses: number;
  createdAt: number;
}
export interface FightRec {
  id: string;
  day: number;
  seed: number;
  a: { name: string; build: Build };
  b: { name: string; build: Build; ai: boolean; tier?: BotTier };
  winner: number;
  /** combat version the fight was simulated with */
  v: number;
  createdAt: number;
}
/** What the server saw of a run while it was being played: opponents met and result per day. */
export interface RunTrack {
  playerId?: string;
  name: string;
  /** opponent snapshot ids and opponent run ids already met in this run (no repeats) */
  snaps: string[];
  opps: string[];
  /** day → 1 won, 0 lost/draw (a retried fight on the same day overwrites) */
  days: Record<string, 0 | 1>;
  /** run state mirrored on the server with the game's own rules (run.ts): HP, last chance used, run over */
  hp?: number;
  ghost?: boolean;
  over?: boolean;
  /** the run's rating, kept on the server (the client's value is never trusted) */
  rating?: number;
  /** set when POST /api/run/finish recorded this run */
  finished?: number;
  t: number;
}
export interface FinishedRun {
  runId: string;
  playerId: string;
  name: string;
  hero: string;
  arch: Archetype;
  wins: number;
  losses: number;
  day: number;
  build: Build;
  stardust: number;
  /** wins the client claimed were more than the server saw */
  capped?: boolean;
  season: string;
  finishedAt: number;
}
export interface Player {
  id: string;
  name: string;
  stardust: number;
  runs: number;
  wins: number;
  losses: number;
  /** copy of the best finished run (kept even when the run itself is evicted) */
  best?: Pick<FinishedRun, 'runId' | 'hero' | 'wins' | 'losses' | 'day' | 'finishedAt'>;
  createdAt: number;
  updatedAt: number;
}
export interface Db {
  snapshots: Snapshot[];
  fights: FightRec[];
  tracks: Record<string, RunTrack>;
  runs: FinishedRun[];
  players: Record<string, Player>;
}

const isObj = (x: unknown): x is Record<string, any> => !!x && typeof x === 'object' && !Array.isArray(x);

function loadDb(): Db {
  let d: Partial<Db> = {};
  try {
    d = JSON.parse(readFileSync(DB_FILE, 'utf8')) as Partial<Db>;
  } catch {
    /* no file yet, or unreadable: start empty */
  }
  return {
    // builds from an older combat version have another format: they can't fight or replay any more
    snapshots: (Array.isArray(d.snapshots) ? d.snapshots : []).filter((x) => x?.v === SIM_VERSION),
    fights: (Array.isArray(d.fights) ? d.fights : []).filter((x) => x?.v === SIM_VERSION),
    // prototype-less maps: a key like "__proto__" can never reach Object.prototype
    tracks: Object.assign(Object.create(null), isObj(d.tracks) ? d.tracks : {}),
    runs: Array.isArray(d.runs) ? d.runs : [],
    players: Object.assign(Object.create(null), isObj(d.players) ? d.players : {}),
  };
}

export const db = loadDb();

/** Drop the oldest keys of a record until it fits the cap. */
function capRecord<T>(rec: Record<string, T>, cap: number, time: (x: T) => number) {
  const keys = Object.keys(rec);
  if (keys.length <= cap) return;
  keys.sort((a, b) => time(rec[a]) - time(rec[b]));
  for (const k of keys.slice(0, keys.length - cap)) delete rec[k];
}

export function enforceCaps() {
  if (db.fights.length > FIGHT_CAP) db.fights.splice(0, db.fights.length - FIGHT_CAP);
  if (db.runs.length > RUN_CAP) db.runs.splice(0, db.runs.length - RUN_CAP);
  capRecord(db.tracks, TRACK_CAP, (x) => x.t);
  capRecord(db.players, PLAYER_CAP, (x) => x.updatedAt);
}

let saveTimer: NodeJS.Timeout | null = null;
export function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    enforceCaps();
    // a failed write (no volume, no permission, disk full) must not take the server down: log it and keep playing
    try {
      mkdirSync(DATA_DIR, { recursive: true });
      const tmp = DB_FILE + '.tmp';
      writeFileSync(tmp, JSON.stringify(db));
      renameSync(tmp, DB_FILE); // a crash mid-write never leaves a half-written db.json
    } catch (e) {
      console.error('could not save', DB_FILE, (e as Error).message);
    }
  }, 300);
}
