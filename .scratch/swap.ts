// what if hero X's day-D bot builds replaced skill S with R? win rate vs all heroes' bot builds
import { aiBuild } from '../src/sim/bot';
import { simulate } from '../src/sim/combat';
import { HEROES, HEROES_BY_ID } from '../src/sim/heroes';
import { hashSeed } from '../src/sim/rng';
import type { Build } from '../src/sim/types';
const [H, S, R] = [process.argv[2] ?? 'chrono', process.argv[3] ?? 'frost', process.argv[4] ?? 'strike'];
const day = Number(process.argv[5] ?? 5);
const N = 40;
const mine = Array.from({ length: N }, (_, i) => aiBuild(H, day, [HEROES_BY_ID[H].arch], hashSeed('bal', H, day, i)));
const opp: Build[] = [];
for (const h of HEROES) if (h.id !== H) for (let i = 0; i < 10; i++) opp.push(aiBuild(h.id, day, [h.arch], hashSeed('bal', h.id, day, i)));
function rate(f: (b: Build) => Build) {
  let w = 0, n = 0;
  mine.forEach((b0, i) => {
    const b = f(structuredClone(b0));
    for (let j = 0; j < 14; j++) {
      const o = opp[(i * 13 + j * 5) % opp.length];
      const r1 = simulate(b, o, hashSeed('s', i, j), day), r2 = simulate(o, b, hashSeed('s', i, j), day);
      w += (r1.winner === 0 ? 1 : r1.winner === -1 ? .5 : 0) + (r2.winner === 1 ? 1 : r2.winner === -1 ? .5 : 0); n += 2;
    }
  });
  return (w / n * 100).toFixed(1) + '%';
}
console.log(`${H} d${day} as is: ${rate((b) => b)} · ${S}→${R}: ${rate((b) => { b.skills = b.skills.map((k) => (k.id === S ? { ...k, id: R } : k)); return b; })} · without ${S}: ${rate((b) => { b.skills = b.skills.filter((k) => k.id !== S); return b; })}`);
