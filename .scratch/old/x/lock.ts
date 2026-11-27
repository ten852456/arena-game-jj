// scratch: control-lock / chain metrics (not committed)
import { aiBuild, randomAiBuild } from '../src/sim/bot';
import { TPS, simulate } from '../src/sim/combat';
import { HEROES } from '../src/sim/heroes';
import { hashSeed } from '../src/sim/rng';
const N = Number(process.argv[2] ?? 300);
let tot = 0, zero = 0, zeroCtl = 0, maxTrig = 0, trig20 = 0, ctlSum = 0, ctlMax = 0;
const byHero: Record<string, [number, number]> = {};
const zeroDays: Record<number, number> = {};
const examples: string[] = [];
const str = (b: { skills: { id: string; v: string }[] }) => b.skills.map((k) => k.id + (k.v ? '.' + k.v : '')).join(' ');
for (let day = 1; day <= 13; day++) {
  for (let i = 0; i < N; i++) {
    const a = i % 2 ? randomAiBuild(day, hashSeed('lk-a', day, i)) : aiBuild(HEROES[i % 8].id, day, [HEROES[i % 8].arch], hashSeed('lk-a', day, i));
    const b = randomAiBuild(day, hashSeed('lk-b', day, i));
    const r = simulate(a, b, hashSeed('lk', day, i), day);
    tot++;
    const casts = [0, 0], trig = [0, 0], ctl = [0, 0];
    for (const e of r.events) {
      if (e.type === 'cast' && !e.echo) { casts[e.side]++; if (e.from !== undefined) trig[e.side]++; }
      if (e.type === 'status' && (e.status === 'freeze' || e.status === 'delay')) ctl[e.side] += e.value;
    }
    for (const s of [0, 1]) {
      const h = [a, b][s].hero;
      byHero[h] ??= [0, 0];
      byHero[h][1]++;
      ctlSum += ctl[s]; ctlMax = Math.max(ctlMax, ctl[s]);
      if (trig[s] >= 20) trig20++;
      maxTrig = Math.max(maxTrig, trig[s]);
    }
    const z = [0, 1].filter((s) => casts[s] === 0);
    if (z.length) {
      zero++;
      zeroDays[day] = (zeroDays[day] ?? 0) + 1;
      for (const s of z) byHero[[a, b][s].hero][0]++;
      if (z.some((s) => ctl[s] > 0)) zeroCtl++;
      const zs = z[0];
      if (examples.length < 8) examples.push(`d${day} ${[a, b][zs].hero} [${str([a, b][zs])}] vs ${[a, b][1 - zs].hero} [${str([a, b][1 - zs])}] len ${r.ticks / TPS}s ctl ${ctl[zs] / TPS}s`);
    }
  }
}
console.log(`fights ${tot} · a side fired 0 skills: ${(zero / tot * 100).toFixed(1)}% (with control ${(zeroCtl / tot * 100).toFixed(1)}%) · max triggered casts/side ${maxTrig} · sides >=20 trig ${trig20} · avg ctl ${(ctlSum / tot / 2 / TPS).toFixed(2)}s max ${(ctlMax / TPS).toFixed(1)}s`);
console.log('zero by day', JSON.stringify(zeroDays));
console.log('zero by hero', Object.entries(byHero).map(([h, [z, n]]) => `${h} ${(z / n * 100).toFixed(1)}%`).join(' · '));
console.log(examples.join('\n'));
