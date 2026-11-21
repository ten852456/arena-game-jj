// Meta progression: POST /api/run/finish (stardust reward), GET /api/profile, GET /api/leaderboard.
// playerId is a random id the client keeps: it is untrusted and works like a password, so it is never returned in lists.
import { HEROES_BY_ID } from '../sim/heroes';
import { WIN_TARGET } from '../sim/run';
import { lineOf } from './match';
import { SEASON, db, save, type FinishedRun, type Player } from './store';
import { MAX_DAY, cleanId, cleanName, intIn, relicOfferCheck, spendCheck, validateBuild } from './validate';
import { recordOf } from './fight';
import type { Res } from './fight';

const bad = (error: string, status = 400): Res => ({ status, json: { error } });

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
  const pre = Object.hasOwn(db.tracks, runId) ? db.tracks[runId] : undefined;
  // the final build is judged with the run's record before its last day
  const build = validateBuild(body?.build, day, recordOf(pre).slice(0, day - 1), pre?.lastChoice);
  if (typeof build === 'string') return bad(build);
  if (build.hero !== hero) return bad('build hero mismatch');
  if (pre?.hero && pre.hero !== hero) return bad('hero does not match this run');

  const done = db.runs.find((r) => r.runId === runId);
  if (done) {
    if (done.playerId !== playerId) return bad('run belongs to another player', 403);
    const p = db.players[playerId] ?? newPlayer(playerId, done.name);
    return { status: 200, json: { already: true, reward: { stardust: done.stardust, wins: done.wins, capped: !!done.capped }, run: runRow(done), player: publicPlayer(p) } };
  }
  const track = Object.hasOwn(db.tracks, runId) ? db.tracks[runId] : undefined;
  if (!track) return bad('unknown run', 404);
  if (track.playerId !== playerId) return bad('run belongs to another player', 403);
  if (track.finished) return bad('run already finished', 409);
  // the final build's relics must follow the run's last fought build and the server's offers (security review)
  const relicErr = relicOfferCheck(track, build, day);
  if (relicErr) return bad(relicErr);
  // the final build must also fit the run's running spend (security review: unpaid stars / marks on share cards)
  if (!spendCheck(track, build, day, recordOf(track).slice(0, day - 1), track.lastChoice).length) return bad('implausible: this run could not have paid for this build');

  // Only fights the server ran count: a client can't claim wins it never fought.
  const days = Object.values(track.days);
  const seenWins = days.filter((d) => d === 1).length;
  const seenLosses = days.length - seenWins;
  // the claim must match the fights the server ran; the reward always uses the server's own counts
  if (wins + losses !== days.length) return bad('result does not match the fights on record', 409);
  const countedWins = seenWins;
  const countedLosses = seenLosses;
  const capped = countedWins < wins;
  // a guided-tutorial win (day 1 against a training bot) earns no stardust: player ids are free to make, so it must not be farmable
  const tutorialWin = track.tutorial && track.days[1] === 1 ? 1 : 0;
  const reward = rewardFor(countedWins - tutorialWin, countedLosses);

  const name = cleanName(body?.name, playerId);
  const player = (db.players[playerId] ??= newPlayer(playerId, name));
  const run: FinishedRun = {
    runId, playerId, name, hero, line: lineOf(build), wins: countedWins, losses: countedLosses, day, build,
    stardust: reward.stardust, ...(capped ? { capped } : {}), season: SEASON, finishedAt: Date.now(),
  };
  db.runs.push(run);
  if (track) track.finished = run.finishedAt;

  player.name = name;
  player.stardust += reward.stardust;
  player.runs++;
  player.wins += countedWins;
  player.losses += countedLosses;
  player.updatedAt = run.finishedAt;
  if (!player.best || better(run, player.best) < 0) {
    player.best = { runId, hero, wins: run.wins, losses: run.losses, day, finishedAt: run.finishedAt };
  }
  save();
  return { status: 200, json: { already: false, reward: { ...reward, wins: countedWins, capped }, run: runRow(run), player: publicPlayer(player) } };
}

export function handleProfile(q: URLSearchParams): Res {
  const playerId = cleanId(q.get('playerId'));
  if (!playerId) return bad('bad request');
  const p = db.players[playerId] ?? newPlayer(playerId, cleanName('', playerId));
  const recent = db.runs.filter((r) => r.playerId === playerId).slice(-RECENT).reverse().map(runRow);
  return { status: 200, json: { known: !!db.players[playerId], player: publicPlayer(p), recent } };
}

/** Calendar day in Thailand (UTC+7), e.g. "2026-11-19". */
export const bangkokDate = (t: number) => new Date(t + 7 * 3600_000).toISOString().slice(0, 10);

export function handleLeaderboard(q: URLSearchParams): Res {
  const period = q.get('period') ?? 'season';
  if (period !== 'season' && period !== 'day') return bad('period must be season or day');
  const me = cleanId(q.get('playerId'));
  const today = bangkokDate(Date.now());
  const rows = db.runs
    .filter((r) => r.season === SEASON && (period === 'season' || bangkokDate(r.finishedAt) === today))
    .sort((a, b) => better(a, b) || a.finishedAt - b.finishedAt)
    .slice(0, LB_SIZE)
    .map((r, i) => ({ rank: i + 1, ...runRow(r), ...(me && r.playerId === me ? { you: true } : {}) }));
  return { status: 200, json: { period, season: SEASON, ...(period === 'day' ? { date: today } : {}), rows } };
}
