// Simple / detailed skill text check: every skill × variant × mark (and with a chain cooldown cut) produces a short,
// non-empty plain line in Thai and English, English has no Thai left, and the detailed lines exist.
// Also every connect bonus kind. Run: npx tsx scripts/skilltext-check.ts (part of npm test). -v prints samples.
import { setLangValue, type Lang } from '../src/i18n';
import { withLang } from '../src/client/lang';
import { detailBonus, detailLines, simpleBonus, simpleText } from '../src/client/skillText';
import { BONUS_KINDS } from '../src/sim/links';
import { SKILLS, VARIANTS } from '../src/sim/skills';
import type { Mark } from '../src/sim/types';

const THAI = /[฀-๿]/;
/** a phone shop row fits about two lines of this */
const MAX = 95;
const MARKS: (Mark | undefined)[] = [undefined, 'burn', 'echo', 'quick', 'steadfast'];
const bad: string[] = [];
let longest = { n: 0, s: '' };
const verbose = process.argv.includes('-v');

for (const l of ['th', 'en'] as Lang[])
  withLang(l, () => {
    setLangValue(l);
    const check = (what: string, s: string, max = MAX) => {
      if (!s.trim()) bad.push(`${l} ${what}: empty`);
      if (s.length > max) bad.push(`${l} ${what}: ${s.length} chars > ${max}: ${s}`);
      if (l === 'en' && THAI.test(s)) bad.push(`en ${what}: Thai left: ${s}`);
      if (l === 'th' && !THAI.test(s)) bad.push(`th ${what}: no Thai: ${s}`);
      if (/undefined|NaN/.test(s)) bad.push(`${l} ${what}: ${s}`);
    };
    for (const d of Object.values(SKILLS))
      for (const v of VARIANTS)
        for (const mark of MARKS)
          for (const haste of [0, 0.2]) {
            const k = { id: d.id, v, mark };
            const s = simpleText(k, haste);
            check(`${d.id}/${v || '_'}/${mark ?? '-'}`, s);
            if (s.length > longest.n) longest = { n: s.length, s };
            const det = detailLines(k, haste);
            if (det.length < 2) bad.push(`${l} ${d.id}/${v}: detail too short`);
            det.forEach((x, i) => check(`${d.id}/${v} detail ${i}`, x, 400));
            if (verbose && !mark && !haste) console.log(`${l} ${d.id}/${v || '_'}: ${s}`);
          }
    for (const e of BONUS_KINDS)
      for (const lv of [1, 2, 3]) {
        check(`bonus ${e} Lv${lv}`, simpleBonus({ t: 'strike', e }, lv), 60);
        check(`bonus ${e} Lv${lv} line`, simpleBonus({ t: 'line:ice', e }, lv), 60);
        check(`bonus ${e} Lv${lv} detail`, detailBonus({ t: 'strike', e }, lv), 200);
      }
  });
setLangValue('th');

if (bad.length) {
  console.error(`skill text: ${bad.length} problem(s)\n  ${bad.slice(0, 40).join('\n  ')}`);
  process.exit(1);
}
console.log(`skill text: simple + detailed text for every skill, variant, mark and bonus in TH + EN (longest ${longest.n}: ${longest.s})`);
