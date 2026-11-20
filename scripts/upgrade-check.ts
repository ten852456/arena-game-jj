// Upgrade rule check (part of npm test): no upgrade may be worse than the level before it in a headline number it
// keeps (hit damage, shield, heal, burn / poison, dodge, power, thorns, freeze, delay, charge, engine power), and no
// cooldown may be longer than a typical fight on the first day that level can be in a build.
// A branch may still trade: a number the parent had and the child drops entirely is allowed (it is a different skill
// shape, the card shows it), but a number it keeps must not go down.
import { LV3_DAY } from '../src/sim/run';
import { SKILLS, VARIANTS, lvOf, mainNumbers, type Variant } from '../src/sim/skills';
import { lengthTarget } from './sim/targets';

const parentOf = (v: string): Variant => (v.length <= 1 ? '' : (v[0] as Variant));
/** first day a level can be owned: Lv1 day 1, Lv2 day 2, Lv3 LV3_DAY */
const firstDay = (lv: number) => (lv === 1 ? 1 : lv === 2 ? 2 : LV3_DAY);
const bad: string[] = [];
for (const d of Object.values(SKILLS))
  for (const v of VARIANTS) {
    const node = d.tree[v];
    const m = mainNumbers(node);
    const lv = lvOf(v);
    // typical fight length on that day = the upper end of its target band minus a little slack
    const fight = lengthTarget(firstDay(lv))[0] + 2;
    if ((m.cd ?? 0) > fight) bad.push(`${d.id}/${v || '_'} ${node.name}: cooldown ${m.cd}s > ${fight}s (first day it can be owned: ${firstDay(lv)})`);
    if (!v) continue;
    const p = mainNumbers(d.tree[parentOf(v)]);
    for (const [k, pv] of Object.entries(p)) {
      if (k === 'cd') continue;
      const cv = m[k as keyof typeof m];
      if (cv !== undefined && cv < pv - 1e-9) bad.push(`${d.id}/${v} ${node.name}: ${k} ${pv} → ${cv} (lower than Lv${lv - 1})`);
    }
  }
if (bad.length) {
  console.error(`upgrade check: ${bad.length} problem(s)\n  ${bad.join('\n  ')}`);
  process.exit(1);
}
console.log('upgrade check: no upgrade lowers a number it keeps; every cooldown fits the fights of its first day');
