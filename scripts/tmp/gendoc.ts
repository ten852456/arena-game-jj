// scratch: prints the 8-line skill tables (live numbers) as markdown for docs/SKILL_TREE.md
import { HEROES } from '../../src/sim/heroes';
import { LINE_ICON, LINE_NAME, SKILL_LIST, SKILL_ROLE, chipsOf, type Variant } from '../../src/sim/skills';
import { LINES } from '../../src/sim/types';

const chip = (id: string, v: Variant) => {
  const d = SKILL_LIST.find((x) => x.id === id)!;
  const n = d.tree[v];
  return `**${n.name}**${n.style ? ` (${n.style})` : ''} ${chipsOf(n).map((c) => c.text).join(' ')}`;
};
const row = (id: string, label: string) =>
  `| ${label} \`${id}\` | ${chip(id, '')} | ${chip(id, 'a')} | ${chip(id, 'a1')} / ${chip(id, 'a2')} | ${chip(id, 'b')} | ${chip(id, 'b1')} / ${chip(id, 'b2')} |`;
const out: string[] = [];
for (const l of LINES) {
  out.push(`\n### ${LINE_ICON[l]} ${LINE_NAME[l]} (${l})\n`);
  out.push('| Skill | Lv1 | Lv2 A | Lv3 A1 / A2 | Lv2 B | Lv3 B1 / B2 |\n|---|---|---|---|---|---|');
  for (const d of SKILL_LIST.filter((x) => x.line === l && !x.hero)) out.push(row(d.id, SKILL_ROLE[d.id] ?? ''));
  for (const d of SKILL_LIST.filter((x) => x.line === l && x.hero)) out.push(row(d.id, `unique (${d.hero})`));
}
out.push('\n### ⚙ neutral\n');
out.push('| Skill | Lv1 | Lv2 A | Lv3 A1 / A2 | Lv2 B | Lv3 B1 / B2 |\n|---|---|---|---|---|---|');
for (const d of SKILL_LIST.filter((x) => x.line === 'none')) out.push(row(d.id, ''));
out.push('\n## Heroes\n\n| Hero | Line | Passive | Ultimate | Trigger (Lv1 · Lv2) | Effect (Lv1 · Lv2) | Day-1 shop |\n|---|---|---|---|---|---|---|');
for (const h of HEROES)
  out.push(`| ${h.name} \`${h.id}\` | ${LINE_ICON[h.line]} ${LINE_NAME[h.line]} | ${h.passive} | ${h.ult.name} | ${h.ult.trigger} | ${h.ult.effect} | ${h.day1.join(', ')} |`);
console.log(out.join('\n'));
