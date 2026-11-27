// Checks the core promise: same builds + same seed → identical fight, every time.
import { randomAiBuild } from '../src/sim/bot';
import { MAX_TICKS, simulate } from '../src/sim/combat';
import { hashSeed } from '../src/sim/rng';

let fails = 0;
let totalTicks = 0;
const N = 500;
for (let i = 0; i < N; i++) {
  const day = 1 + (i % 13);
  const a = randomAiBuild(day, hashSeed('det-a', i));
  const b = randomAiBuild(day, hashSeed('det-b', i));
  const seed = hashSeed('det-seed', i);
  const r1 = JSON.stringify(simulate(a, b, seed, day));
  const r2 = JSON.stringify(simulate(structuredClone(a), structuredClone(b), seed, day));
  const res = simulate(a, b, seed, day);
  totalTicks += res.ticks;
  if (r1 !== r2) {
    fails++;
    console.error('NON-DETERMINISTIC', i);
  }
  if (res.events.at(-1)?.type !== 'end' || res.ticks > MAX_TICKS) {
    fails++;
    console.error('BAD END', i);
  }
}
console.log(`${N} fights · avg length ${(totalTicks / N / 10).toFixed(1)}s · ${fails === 0 ? 'OK deterministic' : fails + ' FAILURES'}`);
process.exit(fails ? 1 : 0);
