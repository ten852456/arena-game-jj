// Upgrade rule check (part of npm test): no upgrade may be worse than the level before it in a headline number it
// keeps (hit damage, shield, heal, burn / poison, dodge, power, thorns, freeze, delay, charge, engine power), and no
// cooldown may be longer than a typical fight on the first day that level can be in a build.
// A branch may still trade: a number the parent had and the child drops entirely is allowed (it is a different skill
// shape, the card shows it), but a number it keeps must not go down.
import { LV3_DAY } from '../src/sim/run';
import { LOWER_BETTER, SKILLS, VARIANTS, flatNumbers, lvOf, mainNumbers, upgradeDiff, upgradeDiffText, type Variant } from '../src/sim/skills';
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
// every number that changes between a level and the next shows in the card's before → after (round 4: pierce, scaling
// shares, slow %, multipliers … were missing); a branch with any change has a non-empty diff text
for (const d of Object.values(SKILLS))
  for (const v of VARIANTS) {
    if (!v) continue;
    if (!upgradeDiff(d.tree[parentOf(v)], d.tree[v]).length) bad.push(`${d.id}/${v}: upgrade shows no change`);
    const from = d.tree[parentOf(v)];
    const to = d.tree[v];
    const a = flatNumbers(from);
    const b = flatNumbers(to);
    const shown = new Set(upgradeDiff(from, to).map((x) => x.key));
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (Math.abs((a[k] ?? 0) - (b[k] ?? 0)) < 1e-9) continue;
      const covered = shown.has(k) || shown.has(k.split('.')[0]) || [...shown].some((x) => x.startsWith(k + '.'));
      if (!covered) bad.push(`${d.id}/${v} ${to.name}: ${k} ${a[k] ?? 0} → ${b[k] ?? 0} is not in the upgrade diff`);
    }
    if (shown.size && !upgradeDiffText(from, to)) bad.push(`${d.id}/${v}: empty diff text`);
  }
// direction (round 5 audit): ▼ only where the new level is really worse
const dir = (id: string, f: Variant, v: Variant) => upgradeDiff(SKILLS[id].tree[f], SKILLS[id].tree[v]);
const must: [string, Variant, Variant, string, boolean][] = [
  ['ironwill', '', 'a', 'steadfast.keep', false], // control on you 40% → 20%: better
  ['ironwill', 'a', 'a1', 'steadfast.ignoreFreeze', false],
  ['heavy', '', 'b', 'hit.sure', false],
  ['charge', 'b', 'b2', 'charge.hits', false],
  ['bulwark', '', 'b', 'hit.shieldPct', true], // 100% → 75% of the shield: worse (it gains shield instead)
];
for (const [id, f, v, field, worse] of must) {
  const row = dir(id, f, v).find((x) => x.key.replace(/#\d+/, '') === field);
  if (!row) bad.push(`${id} ${f || '1'}→${v}: no diff row for ${field}`);
  else if (row.worse !== worse) bad.push(`${id} ${f || '1'}→${v}: ${field} marked ${row.worse ? 'worse' : 'better'}, should be ${worse ? 'worse' : 'better'}`);
}
for (const d of Object.values(SKILLS))
  for (const v of VARIANTS) {
    if (!v) continue;
    if (!upgradeDiff(d.tree[parentOf(v)], d.tree[v]).length) bad.push(`${d.id}/${v}: upgrade shows no change`);
    for (const row of upgradeDiff(d.tree[parentOf(v)], d.tree[v])) {
      const field = row.key.replace(/#\d+/, '');
      if (/(99|NaN|undefined)|[a-z]{3,}/.test(row.text)) bad.push(`${d.id}/${v}: unreadable diff "${row.text}"`);
      if (row.fromText && row.toText && !LOWER_BETTER.has(field) && row.worse !== row.to < row.from) bad.push(`${d.id}/${v}: ${field} direction`);
    }
  }
if (bad.length) {
  console.error(`upgrade check: ${bad.length} problem(s)\n  ${bad.join('\n  ')}`);
  process.exit(1);
}
console.log('upgrade check: no upgrade lowers a number it keeps; every cooldown fits the fights of its first day; every changed number is in the upgrade diff');
