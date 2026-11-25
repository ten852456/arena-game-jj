// Balance gate, part 1: run the same bot-vs-bot fights on one sim checkout and print one JSON line per fight.
// usage: tsx gate-run.ts <repo root> <seed tag> <fights per day> > out.jsonl
import { pathToFileURL } from 'node:url';
const [root, tag, nStr] = process.argv.slice(2);
const imp = (p: string) => import(pathToFileURL(`${root}/src/sim/${p}`).href);
const { randomAiBuild } = await imp('bot.ts');
const { simulate, SIM_VERSION } = await imp('combat.ts');
const { hashSeed } = await imp('rng.ts');
const { HEROES_BY_ID } = await imp('heroes.ts');
const N = Number(nStr);
const out: string[] = [];
for (const day of [1, 2, 3, 4, 6, 8, 10, 12, 14, 16]) {
  for (let i = 0; i < N; i++) {
    // builds are always from the same tag-independent seeds (same matchups); only the fight seed uses the tag
    const a = randomAiBuild(day, hashSeed('ga', day, i));
    const b = randomAiBuild(day, hashSeed('gb', day, i));
    const r = simulate(a, b, hashSeed('gs', tag, day, i), day);
    out.push(JSON.stringify({ day, i, ha: a.hero, hb: b.hero, aa: HEROES_BY_ID[a.hero].line, ab: HEROES_BY_ID[b.hero].line, w: r.winner, t: r.ticks, v: SIM_VERSION }));
  }
}
process.stdout.write(out.join('\n') + '\n');
