// Bots play thousands of fights → archetype + per-hero matchup matrices, and fight length per day.
// Vision target: no matchup above ~65%.
// Usage: npm run balance -- [buildsPerHero=100] [days=3,5,10,13] [--strict]
//   --strict exits 1 when a target is missed (for CI).
import { aiBuild, randomAiBuild } from '../src/sim/bot';
import { TPS, fatigueStart, simulate } from '../src/sim/combat';
import { HEROES } from '../src/sim/heroes';
import { hashSeed } from '../src/sim/rng';
import { LINES, type Build } from '../src/sim/types';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const STRICT = process.argv.includes('--strict');
const N = Number(args[0] ?? 100);
const DAYS = (args[1] ?? '3,5,10,13').split(',').map(Number);
const LIMIT = 0.65;
/** single hero vs hero pairs may lean a bit more (designed counters), archetypes may not */
const HERO_LIMIT = 0.7;
const SPREAD = 0.15;
/** Fight length targets in seconds: [min, max] per day range. */
export const lengthTarget = (day: number): [number, number] => (day <= 3 ? [7, 13] : day <= 7 ? [10, 18] : [15, 26]);
/** Most fights should end by KO, not fatigue. */
const FATIGUE_MAX = 0.2;

const pct = (x: number) => ((x * 100).toFixed(0) + '%').padStart(7);
const problems: string[] = [];

// ---------------- fight length per day ----------------
if (!process.argv.includes('--no-len')) console.log('\nFight length per day (random bot builds, 300 fights each)\n\nday   avg    p10    p90   target     fatigue-ended');
for (let day = 1; day <= 13 && !process.argv.includes('--no-len'); day++) {
  const lens: number[] = [];
  let fat = 0;
  for (let i = 0; i < 300; i++) {
    const a = randomAiBuild(day, hashSeed('len-a', day, i));
    const b = randomAiBuild(day, hashSeed('len-b', day, i));
    const r = simulate(a, b, hashSeed('len', day, i), day);
    lens.push(r.ticks / TPS);
    if (r.ticks >= fatigueStart(day)) fat++;
  }
  lens.sort((x, y) => x - y);
  const avg = lens.reduce((n, x) => n + x, 0) / lens.length;
  const [lo, hi] = lengthTarget(day);
  const ok = avg >= lo && avg <= hi;
  if (!ok) problems.push(`day ${day} avg fight ${avg.toFixed(1)}s (target ${lo}–${hi}s)`);
  const fatShare = fat / 300;
  if (fatShare > FATIGUE_MAX) problems.push(`day ${day}: ${Math.round(fatShare * 100)}% of fights end by fatigue (target ≤ ${FATIGUE_MAX * 100}%)`);
  console.log(
    `${String(day).padStart(3)} ${avg.toFixed(1).padStart(6)}s ${lens[30].toFixed(1).padStart(5)}s ${lens[270].toFixed(1).padStart(5)}s   ${lo}–${hi}s ${ok ? '✔' : '✘'}   ${String(Math.round(fatShare * 100)).padStart(5)}% ${fatShare <= FATIGUE_MAX ? '✔' : '✘'}`,
  );
}

// ---------------- matchup matrices ----------------
for (const DAY of DAYS) {
  const builds: Record<string, Build[]> = {};
  for (const h of HEROES) builds[h.id] = Array.from({ length: N }, (_, i) => aiBuild(h.id, DAY, [h.line], hashSeed('bal', h.id, DAY, i)));

  /** score[a][b] = wins of hero a vs hero b, n[a][b] = fights */
  const score: Record<string, Record<string, number>> = {};
  const count: Record<string, Record<string, number>> = {};
  let ticks = 0;
  let games = 0;
  for (const A of HEROES) {
    score[A.id] = {};
    count[A.id] = {};
    for (const B of HEROES) {
      let s = 0;
      let n = 0;
      for (let i = 0; i < N; i++) {
        for (let k = 0; k < 2; k++) {
          const j = (i * 7 + k * 13 + 3) % N;
          const seed = hashSeed('m', DAY, A.id, B.id, i, k);
          const r1 = simulate(builds[A.id][i], builds[B.id][j], seed, DAY); // A on the left
          const r2 = simulate(builds[B.id][j], builds[A.id][i], seed, DAY); // A on the right (cancels side bias)
          s += r1.winner === 0 ? 1 : r1.winner === -1 ? 0.5 : 0;
          s += r2.winner === 1 ? 1 : r2.winner === -1 ? 0.5 : 0;
          n += 2;
          ticks += r1.ticks + r2.ticks;
        }
      }
      score[A.id][B.id] = s;
      count[A.id][B.id] = n;
      games += n;
    }
  }

  console.log(`\n=== Day ${DAY} · ${N} builds per hero · ${games} fights · avg ${(ticks / games / TPS).toFixed(1)}s ===`);

  // archetype matrix: sum hero pairs by archetype (mirror pairs of the same hero are skipped off-diagonal)
  console.log('\nArchetype (row = win rate vs column)\n');
  console.log('        ' + LINES.map((a) => a.padStart(7)).join(''));
  for (const a of LINES) {
    const row = LINES.map((b) => {
      let s = 0;
      let n = 0;
      for (const A of HEROES.filter((h) => h.line === a))
        for (const B of HEROES.filter((h) => h.line === b)) {
          s += score[A.id][B.id];
          n += count[A.id][B.id];
        }
      const r = s / n;
      if (a !== b && r > LIMIT) problems.push(`day ${DAY}: ${a} beats ${b} ${(r * 100).toFixed(0)}%`);
      return pct(r);
    });
    console.log(a.padEnd(8) + row.join(''));
  }

  // per-hero matrix + overall
  console.log('\nHero (row = win rate vs column) · all = vs every other hero\n');
  console.log('          ' + HEROES.map((h) => h.id.slice(0, 6).padStart(7)).join('') + '    all');
  const overall: [string, number][] = [];
  for (const A of HEROES) {
    let s = 0;
    let n = 0;
    const row = HEROES.map((B) => {
      const r = score[A.id][B.id] / count[A.id][B.id];
      if (A.id !== B.id) {
        s += score[A.id][B.id];
        n += count[A.id][B.id];
        if (r > HERO_LIMIT) problems.push(`day ${DAY}: ${A.id} beats ${B.id} ${(r * 100).toFixed(0)}%`);
      }
      return A.id === B.id ? '      -' : pct(r);
    });
    overall.push([A.id, s / n]);
    console.log(A.id.padEnd(10) + row.join('') + pct(s / n));
  }
  const rates = overall.map((o) => o[1]);
  const spread = Math.max(...rates) - Math.min(...rates);
  console.log(`\nHero spread (best − worst overall): ${(spread * 100).toFixed(0)} points (target ≤ ${SPREAD * 100})`);
  if (spread > SPREAD) problems.push(`day ${DAY}: hero spread ${(spread * 100).toFixed(0)} points`);

  console.log('\nExample builds:');
  for (const h of HEROES) console.log(' ', h.id.padEnd(10), builds[h.id][0].skills.map((s) => `${s.id}${s.v ? "." + s.v : ""}`).join(' '));
}

console.log(problems.length ? `\n✘ ${problems.length} targets missed:\n  ` + problems.join('\n  ') : '\n✔ All targets met');
process.exit(STRICT && problems.length ? 1 : 0);
