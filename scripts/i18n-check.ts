// English coverage check: every skill / variant / keyword / hero / mark / building / slide has English text,
// and skill chips have no Thai left in English. Run: npm run i18n (also part of npm test).
import { setLangValue } from '../src/i18n';
import { BUILDINGS_EN, LINE_EN, ROLE_EN, HEROES_EN, KEYWORDS_EN, MARKS_EN, SKILLS_EN, SLIDES_EN } from '../src/client/i18n_en';
import { chipText, withLang } from '../src/client/lang';
import { BUILDINGS } from '../src/client/townData';
import { SLIDES } from '../src/client/tutorialSlides';
import { HEROES } from '../src/sim/heroes';
import { MARK_INFO } from '../src/sim/run';
import { KEYWORDS, LINE_NAME, ROLE_NAME, SKILLS, chipsOf } from '../src/sim/skills';

const THAI = /[฀-๿]/;
const bad: string[] = [];
for (const d of Object.values(SKILLS))
  for (const [v, n] of Object.entries(d.tree)) {
    const en = SKILLS_EN[d.id]?.[v || '_'];
    if (!en) bad.push(`skill ${d.id}/${v || '_'} (${n.name})`);
    else if (n.style !== undefined && !en.includes(' | ')) bad.push(`skill ${d.id}/${v}: missing branch style`);
  }
for (const k of Object.keys(KEYWORDS)) if (!KEYWORDS_EN[k]) bad.push(`keyword ${k}`);
for (const h of HEROES) if (!HEROES_EN[h.id]) bad.push(`hero ${h.id}`);
for (const k of Object.keys(LINE_NAME)) if (!LINE_EN[k]) bad.push(`line ${k}`);
for (const k of Object.keys(ROLE_NAME)) if (!ROLE_EN[k]) bad.push(`role ${k}`);
for (const h of HEROES) if (!HEROES_EN[h.id]?.ult?.name) bad.push(`hero ult ${h.id}`);
for (const k of Object.keys(MARK_INFO)) if (!MARKS_EN[k]) bad.push(`mark ${k}`);
for (const b of BUILDINGS) if (!BUILDINGS_EN[b.id] || !!b.future !== !!BUILDINGS_EN[b.id].future) bad.push(`building ${b.id}`);
if (SLIDES.length !== SLIDES_EN.length) bad.push(`slides: ${SLIDES.length} Thai vs ${SLIDES_EN.length} English`);

// everything the data swap produces in English is Thai-free (chips are built in Thai and translated by chipText)
withLang('en', () => {
  setLangValue('en');
  for (const d of Object.values(SKILLS))
    for (const [v, n] of Object.entries(d.tree)) {
      if (THAI.test(n.name) || THAI.test(n.style ?? '')) bad.push(`thai left in ${d.id}/${v} name`);
      for (const c of chipsOf(n)) if (THAI.test(chipText(c.text))) bad.push(`thai left in chip of ${d.id}/${v}: ${chipText(c.text)}`);
    }
  for (const x of [...Object.values(KEYWORDS), ...HEROES, ...Object.values(MARK_INFO), ...BUILDINGS, ...SLIDES])
    if (THAI.test(JSON.stringify({ ...x, art: undefined }))) bad.push(`thai left in ${JSON.stringify(x).slice(0, 80)}`);
});
setLangValue('th');

if (bad.length) {
  console.error(`i18n: ${bad.length} problem(s)\n  ${bad.join('\n  ')}`);
  process.exit(1);
}
console.log('i18n: English covers every skill, keyword, hero, mark, building and slide');
