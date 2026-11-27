import { aiBuild } from '../src/sim/bot';
import { TPS, simulate } from '../src/sim/combat';
import { HEROES_BY_ID } from '../src/sim/heroes';
import { hashSeed } from '../src/sim/rng';
const [A, B] = [process.argv[2] ?? 'chrono', process.argv[3] ?? 'pyro'];
const day = Number(process.argv[4] ?? 5);
const N = 40;
let w = 0, n = 0, len = 0, ctlOnB = 0, resB = 0, castsA = 0, castsB = 0, dmgA = 0, dmgB = 0;
for (let i = 0; i < N; i++) {
  const a = aiBuild(A, day, [HEROES_BY_ID[A].arch], hashSeed('bal', A, day, i));
  const b = aiBuild(B, day, [HEROES_BY_ID[B].arch], hashSeed('bal', B, day, (i * 7 + 3) % N));
  const r = simulate(a, b, hashSeed('p', i), day);
  n++; if (r.winner === 0) w++;
  len += r.ticks; ctlOnB += r.sides![1].ctl; resB += r.sides![1].resisted; castsA += r.sides![0].casts; castsB += r.sides![1].casts;
  dmgA += r.stats[0].reduce((x, s) => x + s.d, 0); dmgB += r.stats[1].reduce((x, s) => x + s.d, 0);
}
console.log(`${A} vs ${B} d${day}: win ${(w / n * 100).toFixed(0)}% len ${(len / n / TPS).toFixed(1)}s ctl on ${B} ${(ctlOnB / n / TPS).toFixed(1)}s resisted ${(resB / n).toFixed(1)} casts ${(castsA / n).toFixed(1)}/${(castsB / n).toFixed(1)} dmg ${(dmgA / n).toFixed(0)}/${(dmgB / n).toFixed(0)}`);
