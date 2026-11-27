// Prints the Thai explanation for a few bot fights (sanity check for C6).
import { aiBuild } from '../src/sim/bot';
import { simulate } from '../src/sim/combat';
import { explain } from '../src/sim/explain';
import { HEROES } from '../src/sim/heroes';
import { hashSeed } from '../src/sim/rng';
for (let i = 0; i < 4; i++) {
  const day = [3, 6, 10, 13][i];
  const ha = HEROES[i * 2], hb = HEROES[(i * 3 + 1) % HEROES.length];
  const a = aiBuild(ha.id, day, [ha.line], hashSeed('ex', i)), b = aiBuild(hb.id, day, [hb.line], hashSeed('ey', i));
  const r = simulate(a, b, hashSeed('ez', i), day);
  const x = explain(r, [a, b], 0, ['คุณ', hb.name]);
  console.log(`\n--- day ${day}: ${ha.name} vs ${hb.name}\n${x.headline}\n  ` + x.facts.join('\n  ') + '\n  ทำไม:\n   - ' + x.reasons.join('\n   - '));
}
