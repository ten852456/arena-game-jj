// POST /api/fight and GET /api/scout.
import { randomInt, randomUUID } from 'node:crypto';
import { SIM_VERSION, simulate } from '../sim/combat';
import { START_HP, WIN_TARGET, damageFor, markKindFor } from '../sim/run';
import { HEROES_BY_ID } from '../sim/heroes';
import { LINES, type Build, type Line } from '../sim/types';
import { aiBuildFor, avoidMirror, candidates, lineOf, closest, streakOf, tierFor, tutorialOpponent } from './match';
import { PER_DAY_CAP, db, save, type BotTier, type FightRec, type RunTrack, type Snapshot } from './store';
import { MAX_DAY, cleanId, cleanName, cleanRating, intIn, relicOfferCheck, serverRelicOffer, spendCheck, validateBuild, type RunRecord } from './validate';

export interface Res {
  status: number;
  json: unknown;
}
const bad = (error: string): Res => ({ status: 400, json: { error } });

const expected = (ra: number, rb: number) => 1 / (1 + Math.pow(10, (rb - ra) / 400));

/** A run's results before today, day 1 first (1 = won, 0 = lost, 2 = draw), for validateBuild. */
export const recordOf = (t?: RunTrack): RunRecord =>
  t ? Object.keys(t.days).map(Number).sort((a, b) => a - b).map((d) => (t.days[d] === 1 ? 1 : t.days[d] === 2 ? 2 : 0)) : [];

/**
 * Reveal the build's hidden marks with the server's rolls (sim v20, security review). Once the run has a server seed:
 * - a newly gained mark must arrive hidden (`markHidden`); one with an explicit kind is refused with one error that does
 *   not depend on the kind (otherwise accept / reject would reveal the roll);
 * - the server, not the client's label, decides each hidden mark's source from the ledger: the last chance's free mark
 *   first (when a way still has it), then the run's wish marks in order. It keeps the first assignment that the run can
 *   own and has paid for (validateBuild + spendCheck).
 * Returns the build with kinds filled in (or null when a gained mark was explicit) and what it revealed.
 */
export function resolveMarks(
  raw: unknown, prev: RunTrack | undefined, day: number,
): { build: unknown; revealed: { idx: number; mark: string }[] } | null {
  const skills = (raw as { skills?: unknown })?.skills;
  if (!Array.isArray(skills) || prev?.relicSeed === undefined) return { build: raw, revealed: [] };
  const seed = prev.relicSeed;
  // an explicit mark is only allowed where yesterday's build already had that same mark on that same branch line
  for (const k of skills as { id?: unknown; v?: unknown; mark?: unknown; markHidden?: unknown }[]) {
    if (!k || typeof k !== 'object' || k.mark === undefined) continue;
    const p = prev.build?.skills.find((x) => x.id === k.id);
    const kept = !!p && p.mark === k.mark && typeof k.v === 'string' && k.v.startsWith(p.v) && k.v.length >= p.v.length;
    if (!kept) return null;
  }
  const hidden = (skills as { markHidden?: unknown }[]).map((k, idx) => (k && typeof k === 'object' && k.markHidden !== undefined ? idx : -1)).filter((i) => i >= 0);
  if (!hidden.length) return { build: raw, revealed: [] };
  const fill = (freeFirst: boolean, wishFrom: number) => {
    const b = JSON.parse(JSON.stringify(raw)) as { skills: { mark?: string; markHidden?: unknown }[] };
    let w = wishFrom;
    const revealed: { idx: number; mark: string }[] = [];
    hidden.forEach((idx, j) => {
      const k = b.skills[idx];
      k.mark = markKindFor(seed, freeFirst && j === 0 ? 'last' : w++);
      delete k.markHidden;
      revealed.push({ idx, mark: k.mark });
    });
    return { build: b, revealed };
  };
  const rec = recordOf(prev);
  const candidates: { build: unknown; revealed: { idx: number; mark: string }[] }[] = [];
  // ways that still have the free last-chance mark (their own ledger), then plain wish marks
  // right after the death the mark way has no ledger of its own yet: spendCheck starts it from the shared 'none:0'
  // one, so the free mark is tried from there too (otherwise the last chance's mark got a wish roll and was refused)
  const markLedgers = Object.entries(prev.ledger ?? {}).filter(([key]) => key.startsWith('mark:')).map(([, L]) => L);
  if (!markLedgers.length && prev.ledger?.['none:0']) markLedgers.push(prev.ledger['none:0']);
  for (const L of markLedgers) if (L.freeMarks < 1) candidates.push(fill(true, L.wishMarks));
  const wishFroms = [...new Set(Object.values(prev.ledger ?? {}).map((L) => L.wishMarks).concat(prev.wishMarks ?? 0))];
  for (const w of wishFroms) candidates.push(fill(false, w));
  if (prev.ghost && !prev.ledger) candidates.unshift(fill(true, prev.wishMarks ?? 0));
  for (const c of candidates) {
    const v = validateBuild(c.build, day, rec, prev.lastChoice);
    if (typeof v !== 'string' && spendCheck(prev, v, day, rec, prev.lastChoice).length) return c;
  }
  return candidates.at(-1) ?? { build: raw, revealed: [] };
}

function trackOf(runId: string, playerId: string, name: string): RunTrack {
  const t = (db.tracks[runId] ??= { name, snaps: [], opps: [], days: {}, t: Date.now() });
  t.name = name;
  t.playerId ??= playerId; // the run belongs to the player who started it
  t.relicSeed ??= randomInt(0, 2 ** 32 - 1); // server-only: the run's relic offers (never sent)
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
  const prev = Object.hasOwn(db.tracks, runId) ? db.tracks[runId] : undefined;
  // who and when first (security review: relic checks before these were an offer oracle on any run id / future day)
  // runIds are public (leaderboard, replays): only the run's owner may fight its days
  if (prev && prev.playerId !== playerId) return { status: 403, json: { error: 'not your run' } };
  if (prev?.finished) return { status: 409, json: { error: 'run already finished' } };
  if (prev) syncLegacy(prev);
  if (prev?.over) return { status: 409, json: { error: 'run is over' } };
  // days are fought one by one in order: no skipping ahead, no repeating a day
  const fought = prev ? Object.keys(prev.days).length : 0;
  if ((prev && Object.hasOwn(prev.days, day)) || day !== fought + 1) return { status: 409, json: { error: fought >= day ? 'day already fought' : 'days must be fought in order' } };
  // sim v20: reveal hidden marks with the server's rolls (the kind is decided here, never by the client)
  const resolved = resolveMarks(body?.build, prev, day);
  if (!resolved) return bad('bad mark');
  const revealed = resolved.revealed;
  // the build must be one this run could own today, judged from the run's own record (results of earlier days)
  const build = validateBuild(resolved.build, day, recordOf(prev), prev?.lastChoice);
  if (typeof build === 'string') return bad(build);
  // the hero is bound to the run on its first fight: no switching hero (or counter-picking from /api/scout) mid-run
  if (prev?.hero && build.hero !== prev.hero) return bad('hero does not match this run');
  // day by day, the run pays for every change of its build: the running total must fit what its record earned
  // relics: only kept ones, plus on a relic day one of the 3 the server offered (security review)
  const relicErr = relicOfferCheck(prev, build, day);
  if (relicErr) return bad(relicErr);
  const ways = spendCheck(prev, build, day, recordOf(prev), prev?.lastChoice);
  if (!ways.length) return bad('implausible: this run could not have paid for this build');
  // spendCheck re-checks marks and the build's cost per way, so the ways left are the ones that allow ALL of it;
  // the last chance's choice is pinned down as soon as only one way still fits (supply, awaken or mark: never two)
  const way = ways.reduce((a, b) => (b.spent < a.spent ? b : a));
  const opts = new Set(ways.map((w) => w.opt));
  const name = cleanName(body?.name, playerId ?? runId);
  // matchmaking and AI difficulty use the server's own rating for this run, never the client's
  const rating = prev?.rating ?? 1000;
  // Each day of a run is fought once (checked above): a finished run, or a day already on record, cannot be re-fought
  // (otherwise a client could retry a lost day until it wins and inflate the run-end reward).
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
    // no mirror match on days 1–2, fewer later: prefer the candidates of another hero when there are any
    const all = closest(pool);
    const other = all.filter((s) => s.build.hero !== build.hero);
    const near = other.length && avoidMirror(day, build.hero, Math.random()) ? other : all;
    const snap = near[randomInt(0, near.length)];
    opp = { snap, name: snap.name, build: snap.build, rating: snap.rating, ai: false };
  } else {
    const tier = tierFor(day, rating, streak);
    const aiB = aiBuildFor(day, randomInt(0, 2 ** 32 - 1), tier, avoidMirror(day, build.hero, Math.random()));
    opp = { name: `AI · ${HEROES_BY_ID[aiB.hero].name}`, build: aiB, rating, ai: true, tier };
  }

  result ??= simulate(build, opp.build, seed, day);
  const won = result.winner === 0;
  const score = won ? 1 : result.winner === -1 ? 0.5 : 0;
  // the tutorial fight is a fixed easy win: it never moves rating (fresh player ids would otherwise farm it)
  const newRating = tutorial ? rating : Math.round(rating + 32 * (score - expected(rating, opp.rating)));
  if (opp.snap) {
    opp.snap.rating = Math.round(opp.snap.rating + 32 * (1 - score - expected(opp.snap.rating, rating)));
    if (won) opp.snap.defLosses++;
    else opp.snap.defWins++; // owner loses nothing; later: notify them their build won
  }

  // What this run has met and how each day went (no repeats, streak for the AI tier, verified wins at run end).
  const track = trackOf(runId, playerId, name);
  track.hero ??= build.hero;
  track.build = build;
  track.spent = way.spent;
  track.paidSlots = way.paidSlots;
  track.wishMarks = way.wishMarks;
  track.freeMarks = way.freeMarks;
  // every way that still fits keeps its OWN ledger (security review: never one way's marks with another's gold)
  track.ledger = Object.fromEntries(ways.map((w) => [w.key, { spent: w.spent, paidSlots: w.paidSlots, wishMarks: w.wishMarks, freeMarks: w.freeMarks }]));
  if (opts.size === 1 && way.opt !== 'none') track.lastChoice = way.opt;
  track.rating = newRating;
  track.days[day] = won ? 1 : result.winner === -1 ? 2 : 0;
  if (tutorial) track.tutorial = true;
  // same rules as the client (run.ts recordResult): a loss costs HP by day, the first death is the last chance
  // at 1 HP, the second ends the run, WIN_TARGET wins end it too. A modified client can't fight past its end.
  track.hp ??= START_HP;
  // a draw (near-even double KO) costs no HP, like run.ts recordResult
  if (!won && result.winner !== -1) track.hp -= damageFor(day);
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
        line: lineOf(opp.build), build: opp.build, rating: opp.rating,
      },
      match: { window, pool: pool.length },
      ...(tutorial ? { tutorial: true } : {}),
      // hidden marks this fight revealed: list index → kind (the server's roll)
      ...(revealed.length ? { revealed } : {}),
      // tomorrow is a relic day: the 3 relics the server will accept (the client shows these) and the free rerolls
      ...relicFields(serverRelicOffer(track, build.hero, day + 1, build.relics, build.skills), !!track.over),
      result, won, rating: newRating,
    },
  };
}

/** fight response fields for tomorrow's relic offer: nextRelics (the offer) and nextRelicsRe (its rerolls) */
const relicFields = (offers: string[][], over: boolean) =>
  over || !offers[0]?.length ? {} : { nextRelics: offers[0], ...(offers.length > 1 ? { nextRelicsRe: offers.slice(1) } : {}) };

/** Today's arena: line mix of the builds this run could meet (no builds, no names). */
export function handleScout(q: URLSearchParams): Res {
  const day = intIn(Number(q.get('day')), 1, MAX_DAY);
  const runId = q.get('runId') ? cleanId(q.get('runId')) : '';
  const playerId = q.get('playerId') ? cleanId(q.get('playerId')) : undefined;
  if (day === null || runId === null || playerId === null) return bad('bad request');
  const rating = cleanRating(q.get('rating'));
  const prev = runId ? db.tracks[runId] : undefined;
  const { pool, window } = candidates({ day, rating, runId, playerId, track: prev });
  const counts = Object.fromEntries(LINES.map((a) => [a, 0])) as Record<Line, number>;
  for (const s of pool) counts[lineOf(s.build)]++;
  const total = pool.length;
  const pct = Object.fromEntries(LINES.map((a) => [a, total ? Math.round((100 * counts[a]) / total) : 0])) as Record<Line, number>;
  const top = total ? LINES.reduce((b, a) => (counts[a] > counts[b] ? a : b)) : null;
  return {
    status: 200,
    json: {
      day, total, window, counts, pct, top,
      /** no player builds to meet: the next fight is against an AI of this tier */
      ai: total === 0 ? { tier: tierFor(day, rating, streakOf(prev)) } : null,
    },
  };
}
