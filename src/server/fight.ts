// POST /api/fight and GET /api/scout.
import { randomInt, randomUUID } from 'node:crypto';
import { SIM_VERSION, simulate } from '../sim/combat';
import { START_HP, WIN_TARGET, damageFor } from '../sim/run';
import { HEROES_BY_ID } from '../sim/heroes';
import { ARCHES, type Archetype, type Build } from '../sim/types';
import { aiBuildFor, archetypeOf, candidates, closest, streakOf, tierFor, tutorialOpponent } from './match';
import { PER_DAY_CAP, db, save, type BotTier, type FightRec, type RunTrack, type Snapshot } from './store';
import { MAX_DAY, cleanId, cleanName, cleanRating, intIn, validateBuild } from './validate';

export interface Res {
  status: number;
  json: unknown;
}
const bad = (error: string): Res => ({ status: 400, json: { error } });

const expected = (ra: number, rb: number) => 1 / (1 + Math.pow(10, (rb - ra) / 400));

function trackOf(runId: string, playerId: string, name: string): RunTrack {
  const t = (db.tracks[runId] ??= { name, snaps: [], opps: [], days: {}, t: Date.now() });
  t.name = name;
  t.playerId ??= playerId; // the run belongs to the player who started it
  t.t = Date.now();
  return t;
}

/**
 * Tracks saved before the server mirrored the run (no `hp` yet): replay the recorded days with the same rules
 * to rebuild HP / last chance / over. A track whose days are not exactly 1..n can't be trusted and is closed.
 */
function syncLegacy(t: RunTrack) {
  if (t.hp !== undefined) return;
  const days = Object.keys(t.days).map(Number).sort((a, b) => a - b);
  if (days.some((d, i) => d !== i + 1)) {
    t.over = true;
    return;
  }
  let hp = START_HP;
  let ghost = false;
  let wins = 0;
  for (const d of days) {
    if (t.days[d] === 1) wins++;
    else hp -= damageFor(d);
    if (wins >= WIN_TARGET) return void Object.assign(t, { hp, ghost, over: true });
    if (hp <= 0) {
      if (ghost) return void Object.assign(t, { hp, ghost, over: true });
      ghost = true;
      hp = 1;
    }
  }
  Object.assign(t, { hp, ghost });
}

export function handleFight(body: any): Res {
  const runId = cleanId(body?.runId);
  // a fight always belongs to a player: runs are bound to the playerId that started them
  const playerId = cleanId(body?.playerId);
  const day = intIn(body?.day, 1, MAX_DAY);
  if (!runId || day === null || !playerId) return bad('bad request');
  const build = validateBuild(body?.build, day);
  if (typeof build === 'string') return bad(build);
  const name = cleanName(body?.name, playerId ?? runId);
  const prev = Object.hasOwn(db.tracks, runId) ? db.tracks[runId] : undefined;
  // matchmaking and AI difficulty use the server's own rating for this run, never the client's
  const rating = prev?.rating ?? 1000;
  // Each day of a run is fought once: a finished run, or a day already on record, cannot be re-fought
  // (otherwise a client could retry a lost day until it wins and inflate the run-end reward).
  // runIds are public (leaderboard, replays): only the run's owner may fight its days
  if (prev && prev.playerId !== playerId) return { status: 403, json: { error: 'not your run' } };
  if (prev?.finished) return { status: 409, json: { error: 'run already finished' } };
  if (prev) syncLegacy(prev);
  if (prev?.over) return { status: 409, json: { error: 'run is over' } };
  // days are fought one by one in order: no skipping ahead, no repeating a day
  const fought = prev ? Object.keys(prev.days).length : 0;
  if ((prev && Object.hasOwn(prev.days, day)) || day !== fought + 1) return { status: 409, json: { error: fought >= day ? 'day already fought' : 'days must be fought in order' } };
  const streak = streakOf(prev);

  // Guided tutorial: the very first fight of a brand-new run, once per player, is against a training AI
  // (an easy bot with one skill, a fight the player wins). The server decides everything; the client only asks.
  const tutorial = body?.tutorial === true && day === 1 && !prev && !Object.hasOwn(db.tutorials, playerId);
  // Matchmaking: same day, closest rating, widening window, never the same opponent twice in a run. No counter-picking.
  const { pool, window } = tutorial ? { pool: [] as Snapshot[], window: null } : candidates({ day, rating, runId, playerId, track: prev });
  let seed = randomInt(0, 2 ** 32 - 1);
  let opp: { snap?: Snapshot; name: string; build: Build; rating: number; ai: boolean; tier?: BotTier };
  let result: ReturnType<typeof simulate> | null = null;
  if (tutorial) {
    db.tutorials[playerId] = Date.now();
    const t = tutorialOpponent(build, day);
    seed = t.seed;
    result = t.result;
    opp = { name: `AI · ${HEROES_BY_ID[t.build.hero].name}`, build: t.build, rating, ai: true, tier: 'easy' };
  } else if (pool.length) {
    const near = closest(pool);
    const snap = near[randomInt(0, near.length)];
    opp = { snap, name: snap.name, build: snap.build, rating: snap.rating, ai: false };
  } else {
    const tier = tierFor(day, rating, streak);
    const aiB = aiBuildFor(day, randomInt(0, 2 ** 32 - 1), tier);
    opp = { name: `AI · ${HEROES_BY_ID[aiB.hero].name}`, build: aiB, rating, ai: true, tier };
  }

  result ??= simulate(build, opp.build, seed, day);
  const won = result.winner === 0;
  const score = won ? 1 : result.winner === -1 ? 0.5 : 0;
  const newRating = Math.round(rating + 32 * (score - expected(rating, opp.rating)));
  if (opp.snap) {
    opp.snap.rating = Math.round(opp.snap.rating + 32 * (1 - score - expected(opp.snap.rating, rating)));
    if (won) opp.snap.defLosses++;
    else opp.snap.defWins++; // owner loses nothing; later: notify them their build won
  }

  // What this run has met and how each day went (no repeats, streak for the AI tier, verified wins at run end).
  const track = trackOf(runId, playerId, name);
  track.rating = newRating;
  track.days[day] = won ? 1 : 0;
  // same rules as the client (run.ts recordResult): a loss costs HP by day, the first death is the last chance
  // at 1 HP, the second ends the run, WIN_TARGET wins end it too. A modified client can't fight past its end.
  track.hp ??= START_HP;
  if (!won) track.hp -= damageFor(day);
  const winsSoFar = Object.values(track.days).filter((d) => d === 1).length;
  if (winsSoFar >= WIN_TARGET) track.over = true;
  else if (track.hp <= 0) {
    if (!track.ghost) {
      track.ghost = true;
      track.hp = 1;
    } else track.over = true;
  }
  if (opp.snap) {
    track.snaps.push(opp.snap.id);
    track.opps.push(opp.snap.runId);
    track.snaps = track.snaps.slice(-40);
    track.opps = track.opps.slice(-40);
  }

  // Save this player's build for this day so others can fight it.
  const existing = db.snapshots.findIndex((s) => s.runId === runId && s.day === day);
  const snap: Snapshot = {
    id: randomUUID(), runId, ...(playerId ? { playerId } : {}), name, day, build, rating: newRating, v: SIM_VERSION,
    defWins: 0, defLosses: 0, createdAt: Date.now(),
  };
  if (existing >= 0) db.snapshots[existing] = snap;
  else db.snapshots.push(snap);
  const sameDay = db.snapshots.filter((s) => s.day === day);
  if (sameDay.length > PER_DAY_CAP) {
    const oldest = sameDay.sort((a, b) => a.createdAt - b.createdAt)[0];
    db.snapshots.splice(db.snapshots.indexOf(oldest), 1);
  }

  const fight: FightRec = {
    id: randomUUID().slice(0, 8), day, seed,
    a: { name, build }, b: { name: opp.name, build: opp.build, ai: opp.ai, ...(opp.tier ? { tier: opp.tier } : {}) },
    winner: result.winner, v: SIM_VERSION, createdAt: Date.now(),
  };
  db.fights.push(fight);
  save();

  return {
    status: 200,
    json: {
      fightId: fight.id, seed, day,
      /** the name the server used for you (store it when you had none) */
      name,
      opponent: {
        name: opp.name, ai: opp.ai, ...(opp.tier ? { tier: opp.tier } : {}),
        arch: archetypeOf(opp.build), build: opp.build, rating: opp.rating,
      },
      match: { window, pool: pool.length },
      ...(tutorial ? { tutorial: true } : {}),
      result, won, rating: newRating,
    },
  };
}

/** Today's arena: archetype mix of the builds this run could meet (no builds, no names). */
export function handleScout(q: URLSearchParams): Res {
  const day = intIn(Number(q.get('day')), 1, MAX_DAY);
  const runId = q.get('runId') ? cleanId(q.get('runId')) : '';
  const playerId = q.get('playerId') ? cleanId(q.get('playerId')) : undefined;
  if (day === null || runId === null || playerId === null) return bad('bad request');
  const rating = cleanRating(q.get('rating'));
  const prev = runId ? db.tracks[runId] : undefined;
  const { pool, window } = candidates({ day, rating, runId, playerId, track: prev });
  const counts = Object.fromEntries(ARCHES.map((a) => [a, 0])) as Record<Archetype, number>;
  for (const s of pool) counts[archetypeOf(s.build)]++;
  const total = pool.length;
  const pct = Object.fromEntries(ARCHES.map((a) => [a, total ? Math.round((100 * counts[a]) / total) : 0])) as Record<Archetype, number>;
  const top = total ? ARCHES.reduce((b, a) => (counts[a] > counts[b] ? a : b)) : null;
  return {
    status: 200,
    json: {
      day, total, window, counts, pct, top,
      /** no player builds to meet: the next fight is against an AI of this tier */
      ai: total === 0 ? { tier: tierFor(day, rating, streakOf(prev)) } : null,
    },
  };
}
