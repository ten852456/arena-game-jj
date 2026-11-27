// scratch: like scripts/runs.ts but reports 10-win builds, losses, days (not committed)
import { aiBuild, botShopTurn } from '../src/sim/bot';
import { simulate } from '../src/sim/combat';
import { HEROES } from '../src/sim/heroes';
import { Rng, hashSeed } from '../src/sim/rng';
import { WIN_TARGET, applyMark, chooseLastChance, newRun, recordResult, toBuild } from '../src/sim/run';
import { SKILLS } from '../src/sim/skills';
import type { Build } from '../src/sim/types';

const RUNS = Number(process.argv[2] ?? 200);
const MAX_DAY = 25;
const POOL = 24;
const pool: Build[][] = [];
for (let d = 1; d <= MAX_DAY; d++) {
  pool[d] = [];
  for (let i = 0; i < POOL; i++) { const h = HEROES[i % HEROES.length]; pool[d].push(aiBuild(h.id, d, [h.arch], hashSeed('pool', d, i))); }
}
const skillCount: Record<string, number> = {};
const lines: Record<string, number> = {};
let totalWon = 0;
const out: string[] = [];
const examples: string[] = [];
for (const h of HEROES) {
  let won = 0, wins = 0, days = 0, lossesWon = 0, daysWon = 0;
  for (let r = 0; r < RUNS; r++) {
    const s = newRun(h.id, hashSeed('run', h.id, r), `bot-${r}`);
    const rng = new Rng(hashSeed('opp', h.id, r));
    while (s.day <= MAX_DAY) {
      if (s.phase === 'lastchance') chooseLastChance(s, (['awaken', 'supply', 'mark'] as const)[r % 3]);
      if (s.phase === 'mark') applyMark(s, 0);
      if (s.phase !== 'shop') break;
      botShopTurn(s, { prefer: [h.arch], reserve: 0, maxRerolls: 2 });
      const opp = rng.pick(pool[Math.min(s.day, MAX_DAY)]);
      const fight = simulate(toBuild(s), opp, rng.int(2 ** 31), s.day);
      recordResult(s, fight.winner === 0, { opp: 'bot', ai: true });
    }
    wins += s.wins; days += s.log.length;
    if (s.phase === 'won') {
      won++; lossesWon += s.losses; daysWon += s.log.length;
      for (const k of s.skills) skillCount[k.id] = (skillCount[k.id] ?? 0) + 1;
      // skill lines = archetypes of non-unique skills (2+ of an arch)
      const arches: Record<string, number> = {};
      for (const k of s.skills) if (!SKILLS[k.id].hero) arches[SKILLS[k.id].arch] = (arches[SKILLS[k.id].arch] ?? 0) + 1;
      const main = Object.entries(arches).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '-';
      lines[`${h.id}/${main}`] = (lines[`${h.id}/${main}`] ?? 0) + 1;
      if (examples.filter((e) => e.startsWith(h.id)).length < 2) examples.push(`${h.id.padEnd(10)} d${s.day} L${s.losses}: ${s.skills.map((k) => k.id + (k.v ? '.' + k.v : '')).join(' ')}`);
    }
  }
  totalWon += won;
  out.push(`${h.id.padEnd(11)} ${((won / RUNS) * 100).toFixed(0).padStart(4)}%  avg wins ${(wins / RUNS).toFixed(2)}  avg days ${(days / RUNS).toFixed(1)}  10-win runs: day ${won ? (daysWon / won).toFixed(1) : '-'} losses ${won ? (lossesWon / won).toFixed(1) : '-'}`);
}
console.log(`${RUNS} runs per hero, target ${WIN_TARGET} wins\nhero        reach${WIN_TARGET}`);
console.log(out.join('\n'));
console.log('\nskills in 10-win builds:', Object.entries(skillCount).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${(n / totalWon * 100).toFixed(0)}%`).join(' · '));
console.log('main shared line per hero (10-win):', Object.entries(lines).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, n]) => `${k} ${n}`).join(' · '));
console.log(examples.join('\n'));
