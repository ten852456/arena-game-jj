// Meta progression: POST /api/run/finish (stardust reward), GET /api/profile, GET /api/leaderboard.
// playerId is a random id the client keeps: it is untrusted and works like a password, so it is never returned in lists.
import { HEROES_BY_ID } from '../../sim/heroes';
import { WIN_TARGET } from '../../sim/run';
import { lineOf } from '../game/match';
import { SEASON, db, save, type FinishedRun, type Player } from '../store';
import { MAX_DAY, cleanId, cleanName, intIn, relicOfferCheck, spendCheck, validateBuild } from '../game/validate';
import { recordOf } from './fight';
import { bad, type Res } from '../http/http';
import { allow } from './site';
import { onRunFinished } from './farm';
import { onVaultRunEnd } from './vault';
import { ledgerAdd } from '../game/ledger';
import { bkDay, stardustMult } from '../../sim/farm';


/** ผงดาว by wins (index = wins); a flawless 8–0 run adds FLAWLESS_BONUS. */
/** ผงดาว by wins, index 0..WIN_TARGET (10). Keep one entry per possible win count. */
export const STARDUST_BY_WINS = [5, 10, 15, 25, 35, 50, 65, 80, 100, 120, 160];
export const FLAWLESS_BONUS = 70;

const LB_SIZE = 50;
const RECENT = 20;

function newPlayer(id: string, name: string): Player {
  const now = Date.now();
  return { id, name, stardust: 0, runs: 0, wins: 0, losses: 0, createdAt: now, updatedAt: now };
}
const publicPlayer = (p: Player) => ({
  name: p.name, stardust: p.stardust, runs: p.runs, wins: p.wins, losses: p.losses, best: p.best ?? null,
});
const runRow = (r: FinishedRun) => ({
  runId: r.runId, name: r.name, hero: r.hero, line: r.line ?? null, wins: r.wins, losses: r.losses, day: r.day,
  stardust: r.stardust, season: r.season, finishedAt: r.finishedAt,
});
const better = (a: Pick<FinishedRun, 'wins' | 'losses' | 'day'>, b: Pick<FinishedRun, 'wins' | 'losses' | 'day'>) =>
  b.wins - a.wins || a.losses - b.losses || a.day - b.day;

export function rewardFor(wins: number, losses: number) {
  // never read past the table (the win target can change): the last entry is the full-run reward
  const base = STARDUST_BY_WINS[Math.max(0, Math.min(wins, WIN_TARGET, STARDUST_BY_WINS.length - 1))] ?? 0;
  const flawless = wins >= WIN_TARGET && losses === 0 ? FLAWLESS_BONUS : 0;
  return { base, flawless, stardust: base + flawless };
}

export function handleFinish(body: any): Res {
  const playerId = cleanId(body?.playerId);
  const runId = cleanId(body?.runId);
  const day = intIn(body?.day, 1, MAX_DAY);
  const wins = intIn(body?.wins, 0, WIN_TARGET);
  const losses = intIn(body?.losses, 0, MAX_DAY);
  const hero = String(body?.hero ?? '');
  if (!playerId || !runId || day === null || wins === null || losses === null || !HEROES_BY_ID[hero]) return bad('bad request');
  // one fight per day: the run ends after day `day`'s fight, or during day `day` when conceded before fighting
  if (wins + losses !== day && wins + losses !== day - 1) return bad('wins + losses do not match day');

  const done = db.runs.find((r) => r.runId === runId);
  if (done) {
    if (done.playerId !== playerId) return bad('run belongs to another player', 403);
    const p = db.players[playerId] ?? newPlayer(playerId, done.name);
    return { status: 200, json: { already: true, reward: { stardust: done.stardust, wins: done.wins, capped: !!done.capped, ...(done.receipt ?? {}) }, run: runRow(done), player: publicPlayer(p) } };
  }
  const track = Object.hasOwn(db.tracks, runId) ? db.tracks[runId] : undefined;
  if (!track) return bad('unknown run', 404);
  if (track.playerId !== playerId) return bad('run belongs to another player', 403);
  if (track.finished) return bad('run already finished', 409);

  // Only fights the server ran count: a client can't claim wins it never fought.
  const days = Object.values(track.days);
  const seenWins = days.filter((d) => d === 1).length;
  const seenLosses = days.length - seenWins;
  // the claim must match the fights the server ran (and `day` is the last fought day or the next one), BEFORE the build
  // is looked at (security review: relic checks first were an offer oracle through /finish)
  if (wins + losses !== days.length || (day !== days.length && day !== days.length + 1)) return bad('result does not match the fights on record', 409);
  // the final build: valid for the run's record, its hero, relics that follow the server's offers, and paid for by the
  // run's ledger. Every rejection here gets the same error (no oracle).
  const build = validateBuild(body?.build, day, recordOf(track).slice(0, day - 1), track.lastChoice);
  if (
    typeof build === 'string' || build.hero !== hero || (track.hero && track.hero !== hero) ||
    relicOfferCheck(track, build, day) || !spendCheck(track, build, day, recordOf(track).slice(0, day - 1), track.lastChoice).length
  ) return bad('implausible build');
  const countedWins = seenWins;
  const countedLosses = seenLosses;
  const capped = countedWins < wins;
  // a guided-tutorial win (day 1 against a training bot) earns no stardust: player ids are free to make, so it must not be farmable
  const tutorialWin = track.tutorial && track.days[1] === 1 ? 1 : 0;
  const base = rewardFor(countedWins - tutorialWin, countedLosses);
  // arena modes: casual pays less (and less again after a few casual runs a day), ranked a bonus
  const mode = track.mode ?? 'ranked';
  const mult = stardustMult(mode, track.casualNth ?? 1);
  const reward = { ...base, stardust: Math.round(base.stardust * mult), mult };

  const name = cleanName(body?.name, playerId);
  const player = (db.players[playerId] ??= newPlayer(playerId, name));
  const run: FinishedRun = {
    runId, playerId, name, hero, line: lineOf(build), wins: countedWins, losses: countedLosses, day, build,
    stardust: reward.stardust, ...(capped ? { capped } : {}), mode, season: SEASON, finishedAt: Date.now(),
  };
  db.runs.push(run);
  if (track) track.finished = run.finishedAt;

  player.name = name;
  player.stardust += reward.stardust;
  ledgerAdd('stardust', 'mint', reward.stardust);
  const { eggs, ticket } = onRunFinished(playerId, countedWins, mode);
  // v5.1 account store: line rank and the Hero Book Save (outside the run, never in a Ranked build)
  // the Seal tray offer counts the same wins as the stardust (a guided-tutorial win does not count)
  const { rank, saved, offer } = onVaultRunEnd(playerId, { runId, hero, build, wins: countedWins, losses: countedLosses, mode }, countedWins - tutorialWin);
  const receipt = { ...(rank ? { lineRank: rank } : {}), ...(saved ? { saved: true as const } : {}), ...(offer ? { seal: offer } : {}) };
  if (Object.keys(receipt).length) run.receipt = receipt; // a retried /finish (lost answer) shows the same receipt
  player.runs++;
  player.wins += countedWins;
  player.losses += countedLosses;
  player.updatedAt = run.finishedAt;
  if (mode === 'ranked' && (!player.best || better(run, player.best) < 0)) {
    player.best = { runId, hero, wins: run.wins, losses: run.losses, day, finishedAt: run.finishedAt };
  }
  save();
  return { status: 200, json: { already: false, reward: { ...reward, wins: countedWins, capped, mode, ...(eggs ? { eggs } : {}), ...(ticket ? { ticket } : {}), ...receipt }, run: runRow(run), player: publicPlayer(player) } };
}

export function handleProfile(q: URLSearchParams): Res {
  const playerId = cleanId(q.get('playerId'));
  if (!playerId) return bad('bad request');
  const p = db.players[playerId] ?? newPlayer(playerId, cleanName('', playerId));
  const recent = db.runs.filter((r) => r.playerId === playerId).slice(-RECENT).reverse().map(runRow);
  return { status: 200, json: { known: !!db.players[playerId], player: publicPlayer(p), recent } };
}

/** Calendar day in Thailand (UTC+7), e.g. "2026-11-19". */
/** Calendar day in Thailand (UTC+7): the same day key as the farm's free tickets and caps */
export const bangkokDate = bkDay;

export function handleLeaderboard(q: URLSearchParams): Res {
  const period = q.get('period') ?? 'season';
  if (period !== 'season' && period !== 'day') return bad('period must be season or day');
  const me = cleanId(q.get('playerId'));
  const today = bangkokDate(Date.now());
  // one row per player: their best run in the period (a player's other runs would only push others down)
  const best = new Map<string, FinishedRun>();
  for (const r of db.runs) {
    // the leaderboard is Ranked only (casual runs are practice)
    if (r.mode === 'casual' || r.season !== SEASON || (period === 'day' && bangkokDate(r.finishedAt) !== today)) continue;
    const cur = best.get(r.playerId);
    if (!cur || better(r, cur) < 0 || (better(r, cur) === 0 && r.finishedAt < cur.finishedAt)) best.set(r.playerId, r);
  }
  const ranked = [...best.values()].sort((a, b) => better(a, b) || a.finishedAt - b.finishedAt);
  const row = (r: FinishedRun, i: number) => ({
    rank: i + 1, ...runRow(r), runs: db.players[r.playerId]?.runs ?? 1, ...(me && r.playerId === me ? { you: true } : {}),
  });
  const rows = ranked.slice(0, LB_SIZE).map(row);
  const myIdx = me ? ranked.findIndex((r) => r.playerId === me) : -1;
  const mine = myIdx >= LB_SIZE ? row(ranked[myIdx], myIdx) : undefined;
  return {
    status: 200,
    json: { period, season: SEASON, ...(period === 'day' ? { date: today } : {}), players: ranked.length, rows, ...(mine ? { me: mine } : {}) },
  };
}

// ---------- rename (profile page) ----------
/**
 * POST /api/profile/name {playerId, name}: the player's new name, also on their finished runs and saved builds, so the
 * leaderboard and fights show it at once. Only a player the server already knows (a profile, a run being played or a
 * saved build) is written; for anyone else the cleaned name just comes back (the browser keeps it and sends it with the
 * next fight), so random ids can never create records. Limits: 5 per player and 20 per IP per hour.
 */
export function handleRename(body: any, ip: string): Res {
  const playerId = cleanId(body?.playerId);
  if (!playerId) return bad('bad request');
  // the IP limit first: random ids from one IP stop here before they can add any per-player key
  if (!allow('rnip:' + ip, 20, 3_600_000)) return bad('too many name changes, try again later', 429);
  const name = cleanName(body?.name, playerId);
  const known =
    Object.hasOwn(db.players, playerId) ||
    db.snapshots.some((sn) => sn.playerId === playerId) ||
    Object.values(db.tracks).some((t) => t.playerId === playerId);
  if (!known) return { status: 200, json: { name, stored: false } };
  // per-player limit only for players the server knows (their ids are not free to invent)
  if (!allow('rn:' + playerId, 5, 3_600_000)) return bad('too many name changes, try again later', 429);
  const p = (db.players[playerId] ??= newPlayer(playerId, name));
  p.name = name;
  p.updatedAt = Date.now();
  for (const r of db.runs) if (r.playerId === playerId) r.name = name;
  for (const sn of db.snapshots) if (sn.playerId === playerId) sn.name = name;
  save(); // debounced: many renames in a burst write the file once
  return { status: 200, json: { name, stored: true, player: publicPlayer(p) } };
}
