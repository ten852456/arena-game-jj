// Adversarial worst-case search (TS reference): hill-climb builds to maximise the SBF CU model fitted in stage 3
// (base + per tick + per block-tick + per cast + per hit + per status), and track the largest stacks.
// Writes the top cases in the differential-case format (with per-tick hashes) for the Rust diff test + SBF bench.
//   search <evaluations> <out.txt>
import fs from 'node:fs';
import { simulate } from '../../../src/sim/combat';
import { Rng, hashSeed } from '../../../src/sim/rng';
import { SKILL_LIST, VARIANTS } from '../../../src/sim/skills';
import { HEROES } from '../../../src/sim/heroes';
import { LINES, type Build } from '../../../src/sim/types';
import { RELICS, MAX_RELICS } from '../../../src/sim/relics';
import { enc } from './gen.mts';
import { BONUS_KINDS, MAX_BONUS } from '../../../src/sim/links';
import { MARKS } from '../../../src/sim/run';
import { randomAiBuild } from '../../../src/sim/bot';

// stage-3 fit (CU, sim v13) used as a proxy; the top cases are then measured on SBF (bench/fight-cu.mjs)
const M = { base: 3562, tick: 165.7, bt: 11.0, cast: 348.2, hit: 93.4, st: 66.9 };
const randTarget = () => (rng.next() < 0.5 ? rng.pick(SKILL_LIST).id : 'line:' + rng.pick(LINES));
const randRelics = () => { const pool = RELICS.map((r) => r.id); return Array.from({ length: MAX_RELICS }, () => pool.splice(rng.int(pool.length), 1)[0]); };
const rng = new Rng(hashSeed('worst', 1));
const randSkill = (id: string) => {
  const bonus = [];
  for (let j = 0; j < MAX_BONUS; j++) bonus.push({ t: randTarget(), e: rng.pick(BONUS_KINDS) });
  const v = rng.pick(VARIANTS);
  return { id, v, ...(rng.next() < 0.6 ? { mark: rng.pick(MARKS) } : {}), bonus, ...(v.length === 2 ? { star: rng.int(4) } : {}) };
};
const randBuild = (): Build => {
  const ids = SKILL_LIST.map((d) => d.id); const skills = [];
  for (let i = 0; i < 8; i++) skills.push(randSkill(ids.splice(rng.int(ids.length), 1)[0]));
  return { hero: rng.pick(HEROES).id, skills, relics: randRelics() };
};
function mutate(b: Build): Build {
  const c: Build = structuredClone(b);
  const r = rng.next();
  if (r < 0.1) c.hero = rng.pick(HEROES).id;
  else if (r < 0.15) c.relics = randRelics();
  else if (r < 0.55) { const i = rng.int(c.skills.length); const free = SKILL_LIST.map((d) => d.id).filter((id) => !c.skills.some((k) => k.id === id)); c.skills[i] = randSkill(rng.next() < 0.5 ? c.skills[i].id : rng.pick(free)); }
  else if (r < 0.75 && c.skills.length > 1) { const i = rng.int(c.skills.length - 1); [c.skills[i], c.skills[i + 1]] = [c.skills[i + 1], c.skills[i]]; }
  else { const k = c.skills[rng.int(c.skills.length)]; k.bonus = (k.bonus ?? []).map(() => ({ t: randTarget(), e: rng.pick(BONUS_KINDS) })); }
  return c;
}
let maxStacks = { growth: 0, thorns: 0, burns: 0 };
function score(a: Build, b: Build, day: number, seed: number) {
  const r = simulate(a, b, seed, day);
  let casts = 0, hits = 0, st = 0, g = [0, 0], th = [0, 0], bu = [0, 0];
  for (const e of r.events) {
    if (e.type === 'cast') casts++; else if (e.type === 'damage') hits++; else if (e.type === 'status' || e.type === 'shield' || e.type === 'heal') st++;
  }
  // stack sizes via the digest hook (thorns/burns stack counts are in the row; growth count needs events: use status grow count as a bound)
  simulate(a, b, seed, day, { digest: (row) => { const per = (row.length - 1); void per; } });
  const blocks = a.skills.length + b.skills.length;
  return { cu: M.base + M.tick * r.ticks + M.bt * r.ticks * blocks + M.cast * casts + M.hit * hits + M.st * st, ticks: r.ticks, casts, hits };
}
const [, evStr, outFile] = process.argv.slice(2);
const EV = Number(evStr);
type Cand = { a: Build; b: Build; day: number; seed: number; cu: number; ticks: number; casts: number };
let pool: Cand[] = [];
// start from real bot builds (long, tanky fights are the expensive ones) plus some random ones
for (let i = 0; i < 4000; i++) {
  const day = 16 + rng.int(5);
  const c = { a: randomAiBuild(day, hashSeed('wa', i)), b: randomAiBuild(day, hashSeed('wb', i)), day, seed: rng.next() * 2 ** 32 >>> 0 };
  pool.push({ ...c, ...score(c.a, c.b, c.day, c.seed) });
}
for (let i = 0; i < 64; i++) { const c = { a: randBuild(), b: randBuild(), day: 18 + rng.int(3), seed: rng.next() * 2 ** 32 >>> 0 }; pool.push({ ...c, ...score(c.a, c.b, c.day, c.seed) }); }
pool.sort((x, y) => y.cu - x.cu); pool = pool.slice(0, 64);
console.log(`seed pool best model CU ${Math.round(pool[0].cu)} (ticks ${pool[0].ticks})`);
for (let e = 0; e < EV; e++) {
  const p = pool[rng.int(pool.length)];
  const c = { a: rng.next() < 0.5 ? mutate(p.a) : p.a, b: rng.next() < 0.5 ? mutate(p.b) : p.b, day: p.day, seed: rng.next() < 0.3 ? rng.next() * 2 ** 32 >>> 0 : p.seed };
  const s = score(c.a, c.b, c.day, c.seed);
  const cand = { ...c, ...s };
  pool.push(cand); pool.sort((x, y) => y.cu - x.cu); pool = pool.slice(0, 64);
  if (e % 2000 === 0) console.log(`eval ${e}: best model CU ${Math.round(pool[0].cu)} (ticks ${pool[0].ticks}, casts ${pool[0].casts})`);
}
// write top cases in diff format (gen.mts enc)
const lines = pool.slice(0, 32).map((c) => {
  const hashes: number[] = []; let h = 2166136261;
  const r = simulate(c.a, c.b, c.seed, c.day, { digest: (row) => { for (const x of row) { h = Math.imul(h ^ (x >>> 0), 16777619) >>> 0; h = Math.imul(h ^ (Math.floor(x / 4294967296) >>> 0), 16777619) >>> 0; } hashes.push(h); } });
  return [c.day, c.seed, r.winner, r.ticks, '|', ...enc(c.a), '|', ...enc(c.b), '|', ...hashes].join(' ');
});
fs.writeFileSync(outFile, lines.join('\n') + '\n');
console.log(`top model CU ${Math.round(pool[0].cu)} · ticks ${pool[0].ticks} · casts ${pool[0].casts} · wrote ${lines.length} cases`);
