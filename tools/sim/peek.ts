// Debug helper: why does hero A lose to hero B on a day? Prints damage by source and the builds of a few fights.
// Usage: npx tsx tools/sim/peek.ts <heroA> <heroB> [day] [n]
import { aiBuild } from '../../src/sim/bot';
import { simulate } from '../../src/sim/combat';
import { HEROES_BY_ID } from '../../src/sim/heroes';
import { hashSeed } from '../../src/sim/rng';
import { nodeOf } from '../../src/sim/skills';

const [a, b, dayS, nS] = process.argv.slice(2);
const day = Number(dayS ?? 10);
const n = Number(nS ?? 200);
let wins = 0;
const src: [Record<string, number>, Record<string, number>] = [{}, {}];
let shown = 0;
for (let i = 0; i < n; i++) {
  const A = aiBuild(a, day, [HEROES_BY_ID[a].line], hashSeed(9, 'pa', i));
  const B = aiBuild(b, day, [HEROES_BY_ID[b].line], hashSeed(9, 'pb', i));
  const r = simulate(A, B, hashSeed(9, 'pf', i), day);
  if (r.winner === 0) wins++;
  for (const e of r.events) if (e.type === 'damage') src[1 - e.side][e.src] = (src[1 - e.side][e.src] ?? 0) + e.amount + e.blocked;
  if (shown < 3) {
    shown++;
    const d = (x: typeof A) => x.skills.map((k) => `${nodeOf(k).name}(${k.id} ${k.v || 'Lv1'})`).join(', ');
    console.log(`#${i} ${r.winner === 0 ? a : r.winner === 1 ? b : 'draw'} wins in ${(r.ticks / 10).toFixed(1)}s\n  ${a}: ${d(A)}\n  ${b}: ${d(B)}`);
  }
}
const fmt = (m: Record<string, number>) => Object.entries(m).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${(v / n).toFixed(0)}`).join(' · ');
console.log(`${a} wins ${((wins / n) * 100).toFixed(0)}% on day ${day}`);
console.log(`${a} damage per fight: ${fmt(src[0])}`);
console.log(`${b} damage per fight: ${fmt(src[1])}`);
