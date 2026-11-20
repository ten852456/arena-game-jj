// Bots play whole runs (shop → fight → result, day by day) through the same run API as players.
// Opponents are same-day bot builds of random heroes. Prints, per hero: share of all win-target runs,
// how often its runs reach the win target, and average wins. Target: no hero > 50% of win-target runs, small spread.
// Usage: npm run runs -- [runsPerHero=150] [--strict]
import { aiBuild, botShopTurn } from '../src/sim/bot';
import { simulate } from '../src/sim/combat';
import { HEROES } from '../src/sim/heroes';
import { Rng, hashSeed } from '../src/sim/rng';
import { WIN_TARGET, applyMark, chooseLastChance, newRun, recordResult, toBuild } from '../src/sim/run';
import type { Build } from '../src/sim/types';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const STRICT = process.argv.includes('--strict');
const RUNS = Number(args[0] ?? 150);
const MAX_DAY = 25;
const POOL = 24;

// opponent pool per day: bot builds of every hero
const pool: Build[][] = [];
for (let d = 1; d <= MAX_DAY; d++) {
  pool[d] = [];
  for (let i = 0; i < POOL; i++) {
    const h = HEROES[i % HEROES.length];
    pool[d].push(aiBuild(h.id, d, [h.line], hashSeed('pool', d, i)));
  }
}

const res: Record<string, { won: number; wins: number; days: number }> = {};
for (const h of HEROES) {
  res[h.id] = { won: 0, wins: 0, days: 0 };
  for (let r = 0; r < RUNS; r++) {
    const s = newRun(h.id, hashSeed('run', h.id, r), `bot-${r}`);
    const rng = new Rng(hashSeed('opp', h.id, r));
    while (s.day <= MAX_DAY) {
      if (s.phase === 'lastchance') chooseLastChance(s, (['awaken', 'supply', 'mark'] as const)[r % 3]);
      if (s.phase === 'mark') applyMark(s, 0);
      if (s.phase !== 'shop') break;
      botShopTurn(s, { prefer: [h.line], reserve: 0, maxRerolls: 2 });
      const opp = rng.pick(pool[Math.min(s.day, MAX_DAY)]);
      const fight = simulate(toBuild(s), opp, rng.int(2 ** 31), s.day);
      recordResult(s, fight.winner === 0, { opp: 'bot', ai: true });
    }
    if (s.phase === 'won') res[h.id].won++;
    res[h.id].wins += s.wins;
    res[h.id].days += s.log.length;
  }
}

const totalWon = Object.values(res).reduce((n, x) => n + x.won, 0);
console.log(`\n${RUNS} bot runs per hero vs same-day bot builds\n`);
console.log('hero          share of win-target runs   reach the win target   avg wins   avg days');
const problems: string[] = [];
const reach: number[] = [];
for (const h of HEROES) {
  const x = res[h.id];
  const share = totalWon ? x.won / totalWon : 0;
  reach.push(x.won / RUNS);
  if (share > 0.5) problems.push(`${h.id} has ${(share * 100).toFixed(0)}% of all win-target runs`);
  console.log(
    `${h.id.padEnd(12)} ${((share * 100).toFixed(1) + '%').padStart(12)} ${((x.won / RUNS) * 100).toFixed(0).padStart(14)}% ${(x.wins / RUNS).toFixed(2).padStart(10)} ${(x.days / RUNS).toFixed(1).padStart(10)}`,
  );
}
const spread = Math.max(...reach) - Math.min(...reach);
console.log(`\nSpread of "reach ${WIN_TARGET} wins" between heroes: ${(spread * 100).toFixed(0)} points (target ≤ 10)`);
if (spread > 0.1) problems.push(`win-target rate spread ${(spread * 100).toFixed(0)} points`);
console.log(problems.length ? `✘ ${problems.join('\n✘ ')}` : '✔ Run targets met');
process.exit(STRICT && problems.length ? 1 : 0);
