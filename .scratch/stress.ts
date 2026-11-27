// scratch: hand-made control-lock and chain builds vs bot builds (not committed)
import { aiBuild } from '../src/sim/bot';
import { TPS, simulate } from '../src/sim/combat';
import { HEROES } from '../src/sim/heroes';
import { hashSeed } from '../src/sim/rng';
import type { Build, SkillInstance } from '../src/sim/types';

const T = (t: string) => ({ t, e: 'trigger' as const });
const k = (id: string, v = '', bonus: SkillInstance['bonus'] = []): SkillInstance => ({ id, v, bonus });
const lock: [string, number, Build][] = [
  ['chrono lock d6', 6, { hero: 'chrono', skills: [k('timewarp', 'a1', [T('arch:control')]), k('frost', 'a1', [T('arch:control'), T('arch:burst')]), k('chill', 'a1', [T('arch:control')]), k('jab', 'b2', [T('arch:control')])] }],
  ['witch lock d8', 8, { hero: 'witch', skills: [k('frost', 'a1', [T('arch:control')]), k('shatter', 'a2', [T('arch:control')]), k('timewarp' === 'x' ? 'x' : 'chill', 'a1', [T('arch:control'), T('arch:burst')]), k('heavy', 'b1', [T('arch:control')]), k('jab', 'b2', [T('arch:burst')])] }],
  ['chrono lock d11', 11, { hero: 'chrono', skills: [k('jab', 'b2', [T('arch:control')]), k('timewarp', 'a1', [T('arch:control'), T('arch:burst')]), k('frost', 'a1', [T('arch:control'), T('arch:burst')]), k('heavy', 'b1', [T('arch:control'), T('arch:burst')]), k('chill', 'a1', [T('arch:burst')]), k('dispel', 'a1', [T('arch:control')])] }],
  ['chain d10', 10, { hero: 'duelist', skills: [k('jab', 'a1', [T('arch:burst')]), k('strike', 'b1', [T('arch:burst')]), k('flurry', 'a1', [T('arch:burst')]), k('heavy', 'a1', [T('arch:burst')]), k('charge', 'b1', [T('arch:burst')])] }],
  ['gear d10', 10, { hero: 'assassin', skills: [k('gear', 'b1'), k('heavy', 'a1'), k('execute', 'a2'), k('strike', 'a1'), k('jab', 'a1')] }],
  ['overclock d10', 10, { hero: 'assassin', skills: [k('heavy', 'a1'), k('overclock', 'a1'), k('execute', 'a2'), k('strike', 'a1'), k('jab', 'a1')] }],
];
const N = Number(process.argv[2] ?? 100);
for (const [name, day, build] of lock) {
  let win = 0, zeroFoe = 0, trigMax = 0, foeCtl = 0, n = 0;
  for (let i = 0; i < N; i++) {
    const h = HEROES[i % HEROES.length];
    const opp = aiBuild(h.id, day, [h.arch], hashSeed('st', day, i));
    for (const side of [0, 1] as const) {
      const r = side === 0 ? simulate(build, opp, hashSeed('sts', i), day) : simulate(opp, build, hashSeed('sts', i), day);
      n++;
      if (r.winner === side) win++;
      const foe = 1 - side;
      let casts = 0, trig = 0;
      for (const e of r.events) if (e.type === 'cast' && !e.echo) { if (e.side === foe) casts++; else if (e.from !== undefined) trig++; }
      if (casts === 0) zeroFoe++;
      trigMax = Math.max(trigMax, trig);
      foeCtl += r.sides ? r.sides[foe].ctl : 0;
    }
  }
  console.log(`${name.padEnd(16)} win ${(win / n * 100).toFixed(0)}% · foe fired 0: ${(zeroFoe / n * 100).toFixed(1)}% · foe controlled avg ${(foeCtl / n / TPS).toFixed(1)}s · max triggered casts ${trigMax}`);
}
