// Meta progression: POST /api/run/finish (stardust reward), GET /api/profile, GET /api/leaderboard.
// playerId is a random id the client keeps: it is untrusted and works like a password, so it is never returned in lists.
import { HEROES_BY_ID } from '../sim/heroes';
import { WIN_TARGET } from '../sim/run';
import { archetypeOf } from './match';
import { SEASON, db, save, type FinishedRun, type Player } from './store';
import { MAX_DAY, cleanId, cleanName, intIn, validateBuild } from './validate';
import type { Res } from './fight';

const bad = (error: string, status = 400): Res => ({ status, json: { error } });

/** ผงดาว by wins (index = wins); a flawless 8–0 run adds FLAWLESS_BONUS. */
export const STARDUST_BY_WINS = [5, 10, 15, 25, 35, 50, 70, 90, 130];
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
  runId: r.runId, name: r.name, hero: r.hero, arch: r.arch, wins: r.wins, losses: r.losses, day: r.day,
  stardust: r.stardust, season: r.season, finishedAt: r.finishedAt,
});
const better = (a: Pick<FinishedRun, 'wins' | 'losses' | 'day'>, b: Pick<FinishedRun, 'wins' | 'losses' | 'day'>) =>
  b.wins - a.wins || a.losses - b.losses || a.day - b.day;

export function rewardFor(wins: number, losses: number) {
  const base = STARDUST_BY_WINS[Math.min(wins, WIN_TARGET)];
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
  const build = validateBuild(body?.build, day);
  if (typeof build === 'string') return bad(build);
  if (build.hero !== hero) return bad('build hero mismatch');

  const done = db.runs.find((r) => r.runId === runId);
  if (done) {
    if (done.playerId !== playerId) return bad('run belongs to another player', 403);
    const p = db.players[playerId] ?? newPlayer(playerId, done.name);
    return { status: 200, json: { already: true, reward: { stardust: done.stardust, wins: done.wins, capped: !!done.capped }, run: runRow(done), player: publicPlayer(p) } };
  }
  const track = db.tracks[runId];
  if (track?.playerId && track.playerId !== playerId) return bad('run belongs to another player', 403);
  if (track?.finished) return bad('run already finished', 409);

  // Only fights the server ran count: a client can't claim wins it never fought.
  const days = Object.values(track?.days ?? {});
  const seenWins = days.filter((d) => d === 1).length;
  const seenLosses = days.length - seenWins;
  const countedWins = Math.min(wins, seenWins);
  const countedLosses = Math.max(losses, seenLosses);
  const capped = countedWins < wins;
  const reward = rewardFor(countedWins, countedLosses);

  const name = cleanName(body?.name, playerId);
  const player = (db.players[playerId] ??= newPlayer(playerId, name));
  const run: FinishedRun = {
    runId, playerId, name, hero, arch: archetypeOf(build), wins: countedWins, losses: countedLosses, day, build,
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
