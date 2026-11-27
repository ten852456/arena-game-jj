import { aiBuild } from '../src/sim/bot';
import { TPS, cdTicks, simulate } from '../src/sim/combat';
import { HEROES } from '../src/sim/heroes';
import { hashSeed } from '../src/sim/rng';
import type { Build, SkillInstance } from '../src/sim/types';
const T = (t: string) => ({ t, e: 'trigger' as const });
const k = (id: string, v = '', bonus: SkillInstance['bonus'] = []): SkillInstance => ({ id, v, bonus });
const build: Build = { hero: 'chrono', skills: [k('timewarp', 'a1', [T('arch:control')]), k('frost', 'a1', [T('arch:control'), T('arch:burst')]), k('chill', 'a1', [T('arch:control')]), k('jab', 'b2', [T('arch:control')])] };
const day = Number(process.argv[2] ?? 6);
for (let i = 0; i < 16; i++) {
  const h = HEROES[i % 8];
  const opp = aiBuild(h.id, day, [h.arch], hashSeed('st', day, i));
  const r = simulate(build, opp, hashSeed('sts', i), day);
  const s = r.sides![1];
  console.log(h.id.padEnd(10), `len ${r.ticks / TPS}s foe casts ${s.casts} ctl ${s.ctl / TPS}s fr ${s.fr / TPS} dl ${s.dl / TPS} sl ${s.sl / TPS} res ${s.resisted} | foe cds ${opp.skills.map((x) => cdTicks(x) / TPS).join(',')} | hp ${r.maxHp}`);
}
