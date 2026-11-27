// Server cost at the store caps (npm run bench): a db filled to PLAYER_CAP / RUN_CAP / FIGHT_CAP / TRACK_CAP, then
// the time of one save (JSON of the whole db) and of the busiest requests. Run it after changes to the store or
// to per-request scans; nothing is written outside a temp folder.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'bench-'));
const { db, FIGHT_CAP, PLAYER_CAP, RUN_CAP, TRACK_CAP } = await import('../src/server/store');
const F = await import('../src/sim/farm');
const { aiBuild } = await import('../src/sim/bot');
const { handleFarmGet, handleFarmOps } = await import('../src/server/routes/farm');
const { handleLeaderboard, handleProfile } = await import('../src/server/routes/meta');

const build = aiBuild('knight', 8, ['shield'], 7);
const now = Date.now();
for (let i = 0; i < PLAYER_CAP; i++) {
  const id = `p${i}`;
  db.players[id] = { id, name: `Mochi-${i}`, stardust: 500, runs: 5, wins: 30, losses: 10, createdAt: now - 1e9, updatedAt: now };
  db.farms[id] = F.newFarm(now - 1e9);
}
for (let i = 0; i < TRACK_CAP; i++) db.tracks[`r${i}`] = { name: 'x', playerId: `p${i % PLAYER_CAP}`, hero: 'knight', snaps: [], opps: [], days: { 1: 1, 2: 0, 3: 1 }, t: now };
for (let i = 0; i < RUN_CAP; i++)
  db.runs.push({ runId: `r${i}`, playerId: `p${i % 3000}`, name: `Mochi-${i}`, hero: 'knight', wins: i % 11, losses: 2, day: 12, build, stardust: 50, season: 's1', finishedAt: now - i * 1000 });
for (let i = 0; i < FIGHT_CAP; i++)
  db.fights.push({ id: `f${i}`, day: 5, seed: i, a: { name: 'a', build }, b: { name: 'b', build, ai: true }, winner: 0, v: 22, createdAt: now });

const time = (label: string, n: number, fn: () => unknown) => {
  fn();
  const t0 = performance.now();
  for (let i = 0; i < n; i++) fn();
  const ms = (performance.now() - t0) / n;
  console.log(`${label.padEnd(44)} ${ms.toFixed(2)} ms`);
  return ms;
};
const size = JSON.stringify(db).length;
console.log(`db at the caps: ${(size / 1e6).toFixed(1)} MB of JSON · ${PLAYER_CAP} players + towns, ${TRACK_CAP} tracks, ${RUN_CAP} runs, ${FIGHT_CAP} fights\n`);
time('save: JSON.stringify(db)', 3, () => JSON.stringify(db));
time('GET /api/farm (known player)', 200, () => handleFarmGet(new URLSearchParams({ playerId: 'p17' })));
time('GET /api/farm (unknown player)', 200, () => handleFarmGet(new URLSearchParams({ playerId: 'nobody' })));
time('POST /api/farm collect', 200, () => handleFarmOps({ playerId: 'p18', ops: [{ op: 'collect' }] }, `ip${Math.random()}`));
time('GET /api/leaderboard season', 50, () => handleLeaderboard(new URLSearchParams({ period: 'season', playerId: 'p5' })));
time('GET /api/profile', 200, () => handleProfile(new URLSearchParams({ playerId: 'p5' })));
process.exit(0);
