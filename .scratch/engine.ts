// scratch: value of engines vs a normal skill in the same slot, by position (not committed)
import { aiBuild } from '../src/sim/bot';
import { simulate } from '../src/sim/combat';
import { HEROES } from '../src/sim/heroes';
import { hashSeed } from '../src/sim/rng';
import type { Build, SkillInstance } from '../src/sim/types';

const day = Number(process.argv[2] ?? 10);
const N = Number(process.argv[3] ?? 60);
const variants = (process.argv[4] ?? ',a,b,a1,b1,b2').split(',');
const pool: Build[] = [];
for (let i = 0; i < 48; i++) { const h = HEROES[i % 8]; pool.push(aiBuild(h.id, day, [h.arch], hashSeed('pool', day, i))); }
const mine: Build[] = [];
for (let i = 0; i < N; i++) { const h = HEROES[i % 8]; const b = aiBuild(h.id, day, [h.arch], hashSeed('mine', day, i)); b.skills = b.skills.slice(0, 4); mine.push(b); }
function rate(make: (b: Build) => Build) {
  let w = 0, n = 0;
  mine.forEach((b0, i) => {
    const b = make(structuredClone(b0));
    for (let j = 0; j < 6; j++) {
      const o = pool[(i * 5 + j * 7) % pool.length];
      const r1 = simulate(b, o, hashSeed('e', i, j), day); const r2 = simulate(o, b, hashSeed('e', i, j), day);
      w += (r1.winner === 0 ? 1 : r1.winner === -1 ? 0.5 : 0) + (r2.winner === 1 ? 1 : r2.winner === -1 ? 0.5 : 0); n += 2;
    }
  });
  return (w / n * 100).toFixed(0).padStart(4) + '%';
}
const lv = (v: string) => (v.length === 0 ? 1 : v.length === 1 ? 2 : 3);
console.log(`day ${day} · ${N} bot builds cut to 4 skills, +1 skill at position 0..4 (0 = top)`);
console.log('4 skills only:', rate((b) => b));
for (const v of variants) {
  // a normal skill of the same level as comparison: strike / train
  for (const [id, label] of [['strike', 'ฟัน'], ['train', 'ฝึก'], ['gear', 'gear'], ['overclock', 'oclk']] as const) {
    if ((id === 'strike' || id === 'train') && v.length !== 1 && v !== '' && !['a1', 'b1'].includes(v)) continue;
    const row = [0, 1, 2, 3, 4].map((pos) => rate((b) => { if (b.skills.some((k) => k.id === id)) b.skills = b.skills.filter((k) => k.id !== id); const s: SkillInstance = { id, v, bonus: [] }; b.skills.splice(Math.min(pos, b.skills.length), 0, s); return b; }));
    console.log(`Lv${lv(v)} ${(id + '.' + v).padEnd(13)} ${label.padEnd(5)}`, row.join(' '));
  }
}
