// scratch: one matchup in detail (not part of the game). npx tsx scripts/tmp/dbg.ts witch chrono 10 40
import { aiBuild } from '../../src/sim/bot';
import { simulate } from '../../src/sim/combat';
import { HEROES_BY_ID } from '../../src/sim/heroes';
import { hashSeed } from '../../src/sim/rng';
import { nodeOf } from '../../src/sim/skills';
const [A, B, dayS, nS, show] = process.argv.slice(2);
const day = Number(dayS ?? 10), n = Number(nS ?? 40);
let w = 0;
let len = 0;
const src: Record<string, number>[] = [{}, {}];
const stat = [0, 1].map(() => ({ heal: 0, shield: 0, dodged: 0, ult: 0, ultAt: 0, ctl: 0, casts: 0 }));
for (let i = 0; i < n; i++) {
  const a = aiBuild(A, day, [HEROES_BY_ID[A].line], hashSeed('d', A, i));
  const b = aiBuild(B, day, [HEROES_BY_ID[B].line], hashSeed('e', B, i));
  if (i < Number(show ?? 2)) console.log(A, a.skills.map((k) => nodeOf(k).name + '/' + k.id + k.v).join(', '), '\n ', B, b.skills.map((k) => nodeOf(k).name + '/' + k.id + k.v).join(', '));
  const r = simulate(a, b, hashSeed('s', i), day);
  if (r.winner === 0) w++;
  len += r.ticks;
  for (const e of r.events) {
    if (e.type === 'damage') src[1 - e.side][e.src] = (src[1 - e.side][e.src] ?? 0) + e.amount + e.blocked;
    if (e.type === 'heal') stat[e.side].heal += e.amount;
    if (e.type === 'shield') stat[e.side].shield += e.amount;
  }
  for (const s of [0, 1]) {
    const sd = r.sides![s];
    stat[s].dodged += sd.dodged ?? 0;
    stat[s].casts += sd.casts;
    if ((sd.ult ?? -1) >= 0) {
      stat[s].ult++;
      stat[s].ultAt += sd.ult! / r.ticks;
    }
    stat[s].ctl += sd.ctl;
  }
}
console.log(`${A} wins ${((w / n) * 100).toFixed(0)}% avg ${(len / n / 10).toFixed(1)}s`);
for (const s of [0, 1]) {
  const st = stat[s];
  st.ultAt = st.ult ? st.ultAt / st.ult : 0;
  console.log(
    (s ? B : A).padEnd(11),
    Object.entries(src[s]).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k}:${(v / n).toFixed(0)}`).join(' '),
    JSON.stringify(Object.fromEntries(Object.entries(st).map(([k, v]) => [k, k === 'ultAt' ? +v.toFixed(2) : +(v / n).toFixed(1)]))),
  );
}
