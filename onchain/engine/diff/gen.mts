// Differential test cases, TS side (the reference). For each fight: day, seed, both builds (numeric encoding)
// and a running hash of the full integer state after every tick (combat.ts opts.digest).
//   gen <N> <out.txt>          N cases: half bot builds (realistic), half chaos builds (coverage)
//   dump <out.txt> <case> <tick> [n]   print the TS digest rows of one case around a tick (debugging)
import fs from 'node:fs';
import { randomAiBuild } from '../../../src/sim/bot';
import { simulate } from '../../../src/sim/combat';
import { Rng, hashSeed } from '../../../src/sim/rng';
import { SKILL_LIST, VARIANTS } from '../../../src/sim/skills';
import { HEROES } from '../../../src/sim/heroes';
import { LINES, type Build } from '../../../src/sim/types';
import { RELICS, MAX_RELICS } from '../../../src/sim/relics';
import { BONUS_KINDS, MAX_BONUS } from '../../../src/sim/links';
import { MARKS } from '../../../src/sim/run';

const SLOTS = 8;
/** build encoding (sim v22): hero, n, relic count, MAX_RELICS relic indices (255 = none), then per slot
 * id, variant, mark (0 = none), star, bonus count, MAX_BONUS × (target, kind). Target = skill index, or 200 + line index. */
export const enc = (b: Build): number[] => {
  const rs = (b.relics ?? []).map((r) => RELICS.findIndex((x) => x.id === r));
  const out = [HEROES.findIndex((h) => h.id === b.hero), b.skills.length, rs.length, ...Array.from({ length: MAX_RELICS }, (_, i) => rs[i] ?? 255)];
  for (let i = 0; i < SLOTS; i++) {
    const k = b.skills[i];
    if (!k) { out.push(...Array(5 + 2 * MAX_BONUS).fill(0)); continue; }
    const bonus = k.bonus ?? [];
    out.push(SKILL_LIST.findIndex((d) => d.id === k.id), VARIANTS.indexOf(k.v as never), k.mark ? MARKS.indexOf(k.mark) + 1 : 0, k.star ?? 0, bonus.length);
    for (let j = 0; j < MAX_BONUS; j++) {
      const bo = bonus[j];
      if (!bo) { out.push(0, 0); continue; }
      const t = bo.t.startsWith('line:') ? 200 + LINES.indexOf(bo.t.slice(5) as never) : SKILL_LIST.findIndex((d) => d.id === bo.t);
      out.push(t, BONUS_KINDS.indexOf(bo.e));
    }
  }
  return out;
};
/** chaos build: any hero, 1–8 distinct skills, any variant (stars on Lv3), marks, 0–3 bonuses of any kind on any
 * target, 0–3 relics */
function chaos(rng: Rng): Build {
  const hero = rng.pick(HEROES).id;
  const n = 1 + rng.int(SLOTS);
  const ids = SKILL_LIST.map((d) => d.id);
  const skills = [];
  for (let i = 0; i < n; i++) {
    const id = ids.splice(rng.int(ids.length), 1)[0];
    const nb = rng.int(MAX_BONUS + 1);
    const bonus = [];
    for (let j = 0; j < nb; j++) {
      const t = rng.next() < 0.5 ? rng.pick(SKILL_LIST).id : 'line:' + rng.pick(LINES);
      bonus.push({ t, e: rng.pick(BONUS_KINDS) });
    }
    const v = rng.pick(VARIANTS);
    const star = v.length === 2 && rng.next() < 0.5 ? 1 + rng.int(3) : 0;
    skills.push({ id, v, ...(rng.next() < 0.3 ? { mark: rng.pick(MARKS) } : {}), bonus, ...(star ? { star } : {}) });
  }
  const pool = RELICS.map((r) => r.id);
  const relics = Array.from({ length: rng.int(MAX_RELICS + 1) }, () => pool.splice(rng.int(pool.length), 1)[0]);
  return { hero, skills, ...(relics.length ? { relics } : {}) };
}
function caseOf(i: number) {
  const rng = new Rng(hashSeed('diff', i));
  const day = 1 + rng.int(20);
  const [a, b] = i % 2 === 0 ? [randomAiBuild(day, hashSeed('da', i)), randomAiBuild(day, hashSeed('db', i))] : [chaos(rng), chaos(rng)];
  return { day, seed: hashSeed('dseed', i), a, b };
}
function run(c: ReturnType<typeof caseOf>, keep?: number[][]) {
  const hashes: number[] = [];
  let h = 2166136261;
  let nonInt = 0;
  const r = simulate(c.a, c.b, c.seed, c.day, {
    digest: (row) => {
      for (const x of row) {
        if (!Number.isInteger(x)) nonInt++;
        h = Math.imul(h ^ (x >>> 0), 16777619) >>> 0;
        h = Math.imul(h ^ (Math.floor(x / 4294967296) >>> 0), 16777619) >>> 0;
      }
      hashes.push(h);
      keep?.push(row);
    },
  });
  return { r, hashes, nonInt };
}

const [mode, ...args] = process.argv.slice(2);
if (mode === 'gen') {
  const N = Number(args[0]);
  const lines: string[] = [];
  let nonInt = 0, ticks = 0;
  for (let i = 0; i < N; i++) {
    const c = caseOf(i);
    const { r, hashes, nonInt: ni } = run(c);
    nonInt += ni; ticks += r.ticks;
    lines.push([c.day, c.seed, r.winner, r.ticks, '|', ...enc(c.a), '|', ...enc(c.b), '|', ...hashes].join(' '));
  }
  fs.writeFileSync(args[1], lines.join('\n') + '\n');
  console.log(`${N} cases, ${ticks} ticks, non-integer state values: ${nonInt}`);
} else if (mode === 'gen-dk') {
  // damage-kind regression fights (same scenarios as arena-game-jj/scripts/damage-kind.ts)
  const Bd = (hero: string, ids: string[]): Build => ({ hero, skills: ids.map((id) => ({ id, v: '' })) });
  const ber = Bd('berserker', ['strike', 'jab']);
  const foes = [Bd('knight', ['thorns']), Bd('thornguard', ['thorns', 'shield']), Bd('pyro', ['ignite']), Bd('knight', ['ironwill']), Bd('thornguard', ['thorns', 'ignite', 'strike'])];
  const lines: string[] = [];
  foes.forEach((foe, fi) => { for (let i = 0; i < 40; i++) {
    const c = { day: 1 + (i % 15), seed: hashSeed('dk', fi, i), a: foe, b: ber };
    const { r, hashes } = run(c);
    lines.push([c.day, c.seed, r.winner, r.ticks, '|', ...enc(c.a), '|', ...enc(c.b), '|', ...hashes].join(' '));
  } });
  fs.writeFileSync(args[0], lines.join(String.fromCharCode(10)) + String.fromCharCode(10));
  console.log(`${lines.length} damage-kind cases`);
} else if (mode === 'cov') {
  // coverage of N cases: ultimates fired per hero, fights per relic, marks and stars present
  const N = Number(args[0]);
  const ult: Record<string, number> = {}, rel: Record<string, number> = {}, other: Record<string, number> = {};
  for (let i = 0; i < N; i++) {
    const c = caseOf(i);
    const r = simulate(c.a, c.b, c.seed, c.day);
    for (const e of r.events) if (e.type === 'ult') ult[e.hero] = (ult[e.hero] ?? 0) + 1;
    for (const b of [c.a, c.b]) {
      for (const x of b.relics ?? []) rel[x] = (rel[x] ?? 0) + 1;
      for (const k of b.skills) { if (k.mark) other['mark:' + k.mark] = (other['mark:' + k.mark] ?? 0) + 1; if (k.star) other['star' + k.star] = (other['star' + k.star] ?? 0) + 1; }
    }
  }
  console.log(JSON.stringify({ ult, rel, other }));
} else if (mode === 'dump') {
  const [, ci, tick, n] = args.map(Number);
  const rows: number[][] = [];
  const c = caseOf(ci);
  run(c, rows);
  console.log(JSON.stringify({ day: c.day, seed: c.seed, a: c.a, b: c.b }));
  for (let t = Math.max(1, tick - (n || 1)); t <= Math.min(rows.length, tick); t++) console.log(rows[t - 1].join(' '));
}
