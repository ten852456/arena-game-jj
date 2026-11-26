// Farm (idle town) API. Rules and numbers: src/sim/farm.ts; design: docs/FARM.md.
//   GET  /api/farm?playerId=…        the farm as of now (pending output, runs left, rotation, egg odds)
//   POST /api/farm {playerId, ops}    one visit: a batch of ops, applied in order, all-or-nothing
//   POST /api/farm/hatch {playerId}   hatch the first egg if it has its work-hours
// The server's clock is the only clock. FARM_TIME_SCALE (playtests only) speeds production up.
import { randomInt } from 'node:crypto';
import * as F from '../sim/farm';
import { HEROES_BY_ID } from '../sim/heroes';
import { cleanId, cleanName } from './validate';
import { FEED_CAP, SEASON, db, save, type MonumentRec } from './store';
import { allow } from './site';
import type { Res } from './fight';

export const FARM_TIME_SCALE = Math.max(1, Math.min(3600, Number(process.env.FARM_TIME_SCALE ?? 1) || 1));
/**
 * FARM_GATE=off turns the arena gate off: any hero may start a run and runs are not counted (the farm itself still
 * works). For a playtest that should not change how the arena plays, and for the legacy security checks.
 */
export const RUN_LIMIT = process.env.FARM_GATE !== 'off';
/** Players the server knew before the farm existed own every hero (owner 2026-11-26). */
const FARM_LAUNCH = Number(process.env.FARM_LAUNCH ?? Date.parse('2026-11-27T00:00:00+07:00'));
const MAX_OPS = 32;
/** new towns per IP per hour (a shared school or home network still fits) */
const NEW_TOWNS_PER_IP = 30;
const newTownAllowed = (ip: string) => allow('farmnew:' + ip, NEW_TOWNS_PER_IP, 3_600_000);

const bad = (error: string, status = 400): Res => ({ status, json: { error } });

function knownBeforeLaunch(playerId: string): boolean {
  const p = db.players[playerId];
  if (p && p.createdAt < FARM_LAUNCH) return true;
  return Object.values(db.tracks).some((t) => t.playerId === playerId && t.t < FARM_LAUNCH);
}

/** A player's farm; `create` makes one (callers rate-limit creation by IP). */
export function farmOf(playerId: string, now: number, create = true): F.FarmState | null {
  let f = Object.hasOwn(db.farms, playerId) ? db.farms[playerId] : undefined;
  if (!f) {
    if (!create) return null;
    f = db.farms[playerId] = F.newFarm(now, knownBeforeLaunch(playerId));
  }
  seasonTurn(f, now);
  F.rollDay(f, now);
  return f;
}

function monument(season: string): MonumentRec {
  return (db.monuments[season] ??= { points: 0, players: 0 });
}
export const monumentGoal = (m: MonumentRec) => Math.max(F.MONUMENT_GOAL_PER_PLAYER * 10, m.players * F.MONUMENT_GOAL_PER_PLAYER);
/** points counted toward the goal: the ruler's gift (20% of the goal) plus what players poured */
export const monumentPoints = (m: MonumentRec) => Math.round(m.points + F.MONUMENT_SEED * monumentGoal(m));

/**
 * First visit in a new season: last season's pour becomes a fading head start (√-scaled); if the community missed
 * last season's monument goal, the calamity damages one landmark (half output until repaired) — but never the town
 * of a player who poured at least MONUMENT_MIN_PERSONAL. Nothing is wiped.
 */
function seasonTurn(f: F.FarmState, now: number) {
  if (!f.pouredSeason || f.pouredSeason === SEASON) return;
  const last = db.monuments[f.pouredSeason];
  if (f.poured > 0) f.head = { mult: F.headStartFor(f.poured), from: now };
  if (last && monumentPoints(last) < monumentGoal(last) && f.poured < F.MONUMENT_MIN_PERSONAL) f.damaged = F.BUILDING_IDS[randomInt(0, F.BUILDING_IDS.length)];
  Object.assign(f, { poured: 0, pouredSeason: SEASON });
}

/** Heroes in this player's unfinished runs (they cannot go to work). */
function heroesInRun(playerId: string): string[] {
  const out = new Set<string>();
  for (const t of Object.values(db.tracks)) if (t.playerId === playerId && !t.finished && !t.over && t.hero) out.add(t.hero);
  return [...out];
}

/** The farm as the client sees it: stored state plus what is ready to collect right now. */
export function farmView(f: F.FarmState, playerId: string, now: number) {
  const jobs = Object.fromEntries(
    F.BUILDING_IDS.map((b) => [
      b,
      f.jobs[b].map((j) => {
        const p = F.pending(f, b, j, now, FARM_TIME_SCALE);
        // ms of real time until this job's storage is full (0 = full now)
        const fullIn = p.full ? 0 : Math.ceil((F.storageMs(f, b) - p.used) / p.speed);
        return { hero: j.hero, ready: p.n, fill: Math.round(p.fill * 1000) / 1000, fullIn, fits: F.fits(j.hero, b), mastery: F.masteryOf(f, j.hero, b), ...(j.fast ? { fast: true } : {}) };
      }),
    ]),
  );
  const m = monument(SEASON);
  return {
    v: f.v, now, scale: FARM_TIME_SCALE, runLimit: RUN_LIMIT,
    owned: f.owned, usable: F.usableHeroes(f, now), rotation: F.todaysRotation(f, now), inRun: heroesInRun(playerId),
    res: f.res, caps: { wood: F.capOf(f, 'wood'), ore: F.capOf(f, 'ore'), crystal: F.capOf(f, 'crystal') },
    lv: f.lv, slots: Object.fromEntries(F.BUILDING_IDS.map((b) => [b, F.slotsOf(f, b)])), jobs,
    ...(f.damaged ? { damaged: f.damaged } : {}),
    tickets: f.tickets, free: f.free, crafted: f.crafted, runsLeft: F.runsLeft(f), stamps: f.stamps, stampedToday: f.stampDay === F.bkDay(now),
    stardust: db.players[playerId]?.stardust ?? 0, pass: !!f.pass,
    finds: f.finds ?? {}, shinies: f.shinies ?? [], findRolls: f.findRolls ?? 0,
    casualRuns: f.casualRuns ?? 0, casualTicket: !!f.casualTicket,
    eggs: f.eggs.map((e) => ({ h: Math.round(e.h * 10) / 10, need: e.need })), odds: F.eggOdds(f), cosmetics: f.cosmetics, pity: f.pity,
    headStart: Math.round(F.headStart(f, now) * 1000) / 1000,
    newbie: Math.round(F.newbieBoost(f, now) * 100) / 100,
    monument: {
      season: SEASON, mine: f.pouredSeason === SEASON ? f.poured : 0, points: monumentPoints(m), goal: monumentGoal(m), players: m.players,
      tiers: F.MONUMENT_TIERS.map((x) => Math.round(x * monumentGoal(m))), minPersonal: F.MONUMENT_MIN_PERSONAL,
    },
  };
}

export function handleFarmGet(q: URLSearchParams): Res {
  const playerId = cleanId(q.get('playerId'));
  if (!playerId) return bad('bad request');
  const now = Date.now();
  // a look never creates a record: an unknown player sees the farm they would start with
  const f = farmOf(playerId, now, false) ?? F.newFarm(now, knownBeforeLaunch(playerId));
  return { status: 200, json: { ...farmView(f, playerId, now), stored: Object.hasOwn(db.farms, playerId) } };
}

export function handleFarmOps(body: any, ip: string): Res {
  const playerId = cleanId(body?.playerId);
  const ops = body?.ops;
  if (!playerId || !Array.isArray(ops) || !ops.length || ops.length > MAX_OPS) return bad('bad request');
  if (!allow('farm:' + playerId, 120, 3_600_000)) return bad('too many farm actions, try again later', 429);
  // a new farm record: the IP limit first, so random ids from one IP cannot flood the db
  if (!Object.hasOwn(db.farms, playerId) && !newTownAllowed(ip)) return bad('too many new towns from here, try again later', 429);
  const now = Date.now();
  const f = farmOf(playerId, now)!;
  // all-or-nothing: run the batch on a copy, keep it only if every op worked
  const copy: F.FarmState = structuredClone(f);
  const player = db.players[playerId];
  let stardust = player?.stardust ?? 0;
  const ctx: F.OpCtx = { now, scale: FARM_TIME_SCALE, stardust, inRun: heroesInRun(playerId), season: SEASON, rng };
  const poured0 = copy.pouredSeason === SEASON ? copy.poured : 0;
  for (let i = 0; i < ops.length; i++) {
    const r = F.applyOp(copy, ops[i], { ...ctx, stardust });
    if (typeof r === 'string') return { status: 409, json: { error: r, at: i } };
    stardust -= r.stardust;
  }
  if (stardust !== (player?.stardust ?? 0)) {
    if (!player) return bad('not enough resources', 409);
    player.stardust = stardust;
    player.updatedAt = now;
  }
  // season monument totals
  const poured = (copy.pouredSeason === SEASON ? copy.poured : 0) - poured0;
  if (poured > 0) {
    const m = monument(SEASON);
    // a player counts toward the goal only once they reach the personal minimum: fake ids pouring 1 wood each
    // cannot raise the goal (security review)
    const total = poured0 + poured;
    if (poured0 < F.MONUMENT_MIN_PERSONAL && total >= F.MONUMENT_MIN_PERSONAL) m.players++;
    m.points += poured;
  }
  copy.updatedAt = now;
  // lucky finds of this visit: to the town feed, and back to the client once
  const found = copy.newFinds ?? [];
  delete copy.newFinds;
  for (const id of found) feedPush(playerId, 'find', id);
  db.farms[playerId] = copy;
  save();
  return { status: 200, json: { ...farmView(copy, playerId, now), ...(found.length ? { found } : {}) } };
}

export function handleHatch(body: any): Res {
  const playerId = cleanId(body?.playerId);
  if (!playerId) return bad('bad request');
  if (!allow('hatch:' + playerId, 30, 3_600_000)) return bad('too many requests', 429);
  const now = Date.now();
  const f = farmOf(playerId, now, false);
  if (!f) return bad('no egg', 409);
  F.collect(f, 'lumber', now, FARM_TIME_SCALE); // bring work-hours up to date
  F.collect(f, 'mine', now, FARM_TIME_SCALE);
  F.collect(f, 'shrine', now, FARM_TIME_SCALE);
  const r = F.hatch(f, randomInt(0, 1_000_000) / 1_000_000);
  if (typeof r === 'string') return bad(r, 409);
  save();
  return { status: 200, json: { got: r.got, farm: farmView(f, playerId, now) } };
}

const rng = () => randomInt(0, 2 ** 31) / 2 ** 31;

/** Town feed: rare finds and moonlit heroes (newest last). A find is a "world first" the first time this season. */
export function feedPush(playerId: string, kind: 'find' | 'shiny', id: string) {
  const name = db.players[playerId]?.name ?? cleanName('', playerId);
  const first = kind === 'find' && !db.feed.some((x) => x.kind === 'find' && x.id === id && x.season === SEASON);
  db.feed.push({ t: Date.now(), name, kind, id, season: SEASON, ...(first ? { first: true as const } : {}) });
  if (db.feed.length > FEED_CAP) db.feed.splice(0, db.feed.length - FEED_CAP);
}

export function handleFeed(): Res {
  return { status: 200, json: { rows: db.feed.slice(-30).reverse() } };
}

/** what a new run gets from the gate */
export interface RunStart { mode: F.Mode; shiny: boolean; casualNth?: number }

/**
 * Day 1 of a new run (the server first sees it then). Casual is free; Ranked costs a ticket (the day's free one
 * first). The hero must be one this player may use today. A hero at work is called back (it keeps what it made).
 * The run rolls once for a moonlit (shiny) hero. The tutorial run is free. Returns an error response or the start.
 */
export function startRunGate(playerId: string, hero: string, tutorial: boolean, ip: string, asked: F.Mode): Res | RunStart {
  if (!HEROES_BY_ID[hero]) return bad('bad hero');
  // the free tutorial run is always casual: the recorded mode is the one actually paid for (security review)
  const mode: F.Mode = tutorial ? 'casual' : asked;
  // gate off: nothing to count (and no town to cap shiny rolls on), so no town record and no shiny roll
  if (!RUN_LIMIT) return { mode, shiny: false };
  const now = Date.now();
  // same per-IP limit as POST /api/farm before a new town record is made (security review: sibling-path parity)
  if (!Object.hasOwn(db.farms, playerId) && !newTownAllowed(ip)) return bad('too many new players from here, try again later', 429);
  const f = farmOf(playerId, now)!;
  if (!F.usableHeroes(f, now).includes(hero)) return { status: 409, json: { error: 'hero locked: unlock it in the Hero Hall or wait for the free rotation', code: 'hero_locked' } };
  let casualNth: number | undefined;
  if (mode === 'ranked') {
    const err = F.spendRun(f, now);
    if (err) return { status: 409, json: { error: err, code: 'no_tickets' } };
  } else {
    F.startCasual(f, now);
    casualNth = f.casualRuns;
  }
  const at = F.heroBusy(f, hero);
  if (at) {
    F.collect(f, at, now, FARM_TIME_SCALE);
    f.jobs[at] = f.jobs[at].filter((j) => j.hero !== hero);
  }
  // one shiny roll per run, at most SHINY_ROLLS_PER_DAY a day (casual runs are free: no unlimited rolls)
  const canRoll = (f.shinyRolls ?? 0) < F.SHINY_ROLLS_PER_DAY;
  if (canRoll) f.shinyRolls = (f.shinyRolls ?? 0) + 1;
  const shiny = canRoll && rng() < F.SHINY_ODDS;
  if (shiny) {
    if (!(f.shinies ??= []).includes(hero)) f.shinies.push(hero);
    feedPush(playerId, 'shiny', hero);
  }
  save();
  return { mode, shiny, ...(casualNth ? { casualNth } : {}) };
}

/** A run ended: eggs and tickets by mode. */
export function onRunFinished(playerId: string, wins: number, mode: F.Mode): { eggs: number; ticket: boolean } {
  const now = Date.now();
  const f = farmOf(playerId, now, false);
  if (!f) return { eggs: 0, ticket: false };
  const r = F.runEnded(f, mode, wins, now);
  if (r.eggs || r.ticket) save();
  return r;
}
