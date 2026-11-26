// JSON-file store (data/db.json). Fine for one Railway replica; swap for Postgres/Redis later.
// Every collection has a cap so the file cannot grow without bound, and a failed write never stops the server.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { SIM_VERSION } from '../sim/combat';
import type { Build, Line } from '../sim/types';
import type { LastChoice } from './validate';
import type { FarmState } from '../sim/farm';

export const ROOT = resolve(import.meta.dirname, '../..');
export const DATA_DIR = process.env.DATA_DIR ?? join(ROOT, 'data');
const DB_FILE = join(DATA_DIR, 'db.json');

/** Caps (oldest entries go first). */
export const PER_DAY_CAP = 300;
export const FIGHT_CAP = 2000;
export const TRACK_CAP = 5000;
export const RUN_CAP = 5000;
export const PLAYER_CAP = 20000;

/** Leaderboard season; bump the env var to start a new season (old runs stay in profiles). */
export const SEASON = (process.env.SEASON ?? 's1').slice(0, 16);

export type BotTier = 'easy' | 'normal' | 'hard';

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
  /** the build's hero is moonlit (shiny): opponents see it */
  shiny?: true;
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
  /** the run's hero, bound on its first fight (sim v15) */
  hero?: string;
  /** the build of the last day fought, the day, and the least net gold the run has spent on builds so far (sim v15) */
  build?: Build;
  spent?: number;
  /** extra skill slots the run has paid for so far */
  paidSlots?: number;
  /** marks paid as moon wishes so far, and the last chance's free mark if used (sim v18 ledger) */
  wishMarks?: number;
  freeMarks?: number;
  /** per last-chance way (validate.ts wayKey): its own running spend, paid slots and marks */
  ledger?: Record<string, { spent: number; paidSlots: number; wishMarks: number; freeMarks: number }>;
  /** the last chance's choice, once the builds have shown which one it was */
  lastChoice?: LastChoice;
  name: string;
  /** opponent snapshot ids and opponent run ids already met in this run (no repeats) */
  snaps: string[];
  opps: string[];
  /** day → 1 won, 0 lost/draw (a retried fight on the same day overwrites) */
  days: Record<string, 0 | 1 | 2>;
  /** 'casual' (free) or 'ranked' (a ticket); runs from before the modes have none and count as ranked */
  mode?: 'casual' | 'ranked';
  /** this run's hero is moonlit (shiny): rolled by the server when the run started */
  shiny?: true;
  /** which casual run of the day this was (stardust tapers) */
  casualNth?: number;
  /** day 1 was the guided-tutorial fight (a training bot): it counts for the run, but earns no stardust or rating */
  tutorial?: true;
  /** run state mirrored on the server with the game's own rules (run.ts): HP, last chance used, run over */
  hp?: number;
  ghost?: boolean;
  over?: boolean;
  /** the run's rating, kept on the server (the client's value is never trusted) */
  rating?: number;
  /** set when POST /api/run/finish recorded this run */
  finished?: number;
  /**
   * Server-only seed of the run's relic offers (sim v17, security review): crypto random, made on the run's first fight,
   * never sent. Each relic day's 3 offers are rollRelicOffer(relicSeed, hero, day, owned); the client only gets the
   * offer itself (fight response `nextRelics`). First step of docs/SERVER_RUN.md (the server owns the run's seed).
   */
  relicSeed?: number;
  t: number;
}
export interface FinishedRun {
  runId: string;
  playerId: string;
  name: string;
  hero: string;
  /** main line of the build (runs finished before sim v12 have an old `arch` field instead and no line) */
  line?: Line;
  wins: number;
  losses: number;
  day: number;
  build: Build;
  stardust: number;
  /** wins the client claimed were more than the server saw */
  capped?: boolean;
  /** casual runs stay off the leaderboard; none = ranked (runs from before the modes) */
  mode?: 'casual' | 'ranked';
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
  /** playerId → time it used its one guided-tutorial fight (day 1 vs a training AI) */
  tutorials: Record<string, number>;
  /** playerId → idle town (src/sim/farm.ts, docs/FARM.md) */
  farms: Record<string, FarmState>;
  /** season → monument totals */
  monuments: Record<string, MonumentRec>;
  /** town feed: rare finds and moonlit heroes, newest last (capped) */
  feed: FeedItem[];
  /** mint/burn ledger: Bangkok day → "<resource>:mint|burn" → amount (ledger.ts) */
  ledger: Record<string, Record<string, number>>;
}
export interface FeedItem {
  t: number;
  name: string;
  kind: 'find' | 'shiny';
  id: string;
  season: string;
  /** the first of this find this season */
  first?: true;
}
export const FEED_CAP = 200;
export interface MonumentRec {
  points: number;
  players: number;
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
    tutorials: Object.assign(Object.create(null), isObj(d.tutorials) ? d.tutorials : {}),
    farms: Object.assign(Object.create(null), isObj(d.farms) ? d.farms : {}),
    monuments: Object.assign(Object.create(null), isObj(d.monuments) ? d.monuments : {}),
    feed: Array.isArray(d.feed) ? d.feed.slice(-FEED_CAP) : [],
    ledger: Object.assign(Object.create(null), isObj(d.ledger) ? d.ledger : {}),
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

/**
 * A hard cap on towns. Over it, the least valuable towns go first, oldest first: value counts real investment
 * (unlocked heroes, cosmetics, tickets, eggs, upgrades, a pour past the personal minimum), so a flood of new ids
 * evicts each other long before a played town; a trivial pour buys no protection (security review).
 */
const MONUMENT_MIN = 300; // src/sim/farm.ts MONUMENT_MIN_PERSONAL (store.ts stays free of sim imports)
const farmValue = (f: FarmState) =>
  Math.max(0, f.owned.length - 4) * 10 + f.cosmetics.length * 5 + f.tickets + f.eggs.length * 3 +
  Object.values(f.lv).reduce((a, l) => a + (l - 1) * 2, 0) + (f.poured >= MONUMENT_MIN ? 5 : 0);
function capFarms() {
  const keys = Object.keys(db.farms);
  if (keys.length <= PLAYER_CAP) return;
  keys.sort((a, b) => farmValue(db.farms[a]) - farmValue(db.farms[b]) || db.farms[a].updatedAt - db.farms[b].updatedAt);
  for (const k of keys.slice(0, keys.length - PLAYER_CAP)) delete db.farms[k];
}

export function enforceCaps() {
  if (db.fights.length > FIGHT_CAP) db.fights.splice(0, db.fights.length - FIGHT_CAP);
  if (db.runs.length > RUN_CAP) db.runs.splice(0, db.runs.length - RUN_CAP);
  capRecord(db.tracks, TRACK_CAP, (x) => x.t);
  capRecord(db.players, PLAYER_CAP, (x) => x.updatedAt);
  capRecord(db.tutorials, PLAYER_CAP, (x) => (typeof x === 'number' ? x : 0));
  capFarms();
  if (db.feed.length > FEED_CAP) db.feed.splice(0, db.feed.length - FEED_CAP);
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
