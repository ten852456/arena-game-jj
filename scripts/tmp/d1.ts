// scratch: bot builds on days 1-3
import { HEROES_BY_ID } from '../../src/sim/heroes';
import { aiRun, isEarlyHitter } from '../../src/sim/bot';
for (const h of ['chrono', 'knight', 'berserker', 'pyro', 'thornguard', 'witch', 'assassin', 'duelist']) {
  for (const d of [1, 2, 3]) {
    const s = aiRun(h, d, [HEROES_BY_ID[h].line], 5);
    console.log(h, d, s.skills.map((k) => k.id + k.v).join(','), 'gold', s.gold);
  }
}
console.log(isEarlyHitter({ id: 'timewarp', v: '' }), isEarlyHitter({ id: 'jab', v: '' }));
