import { aiBuild } from '../src/sim/bot';
import { HEROES_BY_ID } from '../src/sim/heroes';
import { hashSeed } from '../src/sim/rng';
const hero = process.argv[2] ?? 'berserker';
const day = Number(process.argv[3] ?? 5);
const h = HEROES_BY_ID[hero];
const count: Record<string, number> = {};
for (let i = 0; i < 40; i++) {
  const b = aiBuild(hero, day, [h.arch], hashSeed('bal', hero, day, i));
  if (i < 8) console.log(b.skills.map((s) => `${s.id}${s.v ? '.' + s.v : ''}`).join(' '));
  for (const s of b.skills) count[s.id] = (count[s.id] ?? 0) + 1;
}
console.log(Object.entries(count).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}:${n}`).join(' '));
