// Build plausibility check (part of npm test): every build a real run can make passes validateBuild, forged ones don't.
// Real runs here = bot runs of every tier and hero on days 1–15 (they shop with the same rules and prices as players).
import { aiBuild, botDay, botRules, randomAiBuild } from '../src/sim/bot';
import { simulate } from '../src/sim/combat';
import { applyMark, chooseLastChance, newRun, recordResult, toBuild } from '../src/sim/run';
import { HEROES } from '../src/sim/heroes';
import { hashSeed } from '../src/sim/rng';
import { validateBuild } from '../src/server/validate';
import type { Build } from '../src/sim/types';

const bad: string[] = [];
let n = 0;
for (const tier of ['easy', 'normal', 'hard'] as const)
  for (const h of HEROES)
    for (let day = 1; day <= 15; day++)
      for (let i = 0; i < 6; i++) {
        const b = aiBuild(h.id, day, [h.line], hashSeed(77, tier, h.id, day, i), tier);
        const r = validateBuild(b, day);
        n++;
        if (typeof r === 'string') bad.push(`${tier} ${h.id} day ${day}: ${r} · ${b.skills.map((k) => `${k.id}:${k.v || '1'}`).join(' ')}`);
      }
// whole honest runs with real results (streaks, losses, last chance): every day's build passes with that run's record
let runsDays = 0;
for (const tier of ['easy', 'normal', 'hard'] as const)
  for (const h of HEROES)
    for (let r = 0; r < 4; r++) {
      const s = newRun(h.id, hashSeed(91, tier, h.id, r), 'v');
      const rules = botRules([h.line], tier);
      for (let guard = 0; guard < 25 && s.phase !== 'won' && s.phase !== 'dead'; guard++) {
        if (s.phase === 'lastchance') chooseLastChance(s, (['awaken', 'supply', 'mark'] as const)[r % 3]);
        if (s.phase === 'mark') applyMark(s, 0);
        if (s.phase !== 'shop') continue;
        botDay(s, rules);
        const rec = s.log.map((l) => (l.won ? 1 : 0)) as (0 | 1)[];
        const b = toBuild(s);
        const v = validateBuild(b, s.day, rec);
        runsDays++;
        if (typeof v === 'string') bad.push(`run ${tier} ${h.id} #${r} day ${s.day}: ${v} · ${b.skills.map((k) => `${k.id}:${k.v || '1'}${k.mark ? '+' + k.mark : ''}`).join(' ')} · gold ${s.gold}`);
        const opp = randomAiBuild(s.day, hashSeed(92, tier, h.id, r, s.day), tier);
        recordResult(s, simulate(b, opp, hashSeed(93, r, s.day), s.day).winner === 0, { opp: 'bot', ai: true });
      }
    }
const forged: [string, Build, number][] = [
  ['8 skills on day 1', { hero: 'knight', skills: ['shield', 'stoneskin', 'cleanse', 'bulwark', 'strike', 'jab', 'feast', 'frost'].map((id) => ({ id, v: '' })) }, 1],
  ['Lv2 on day 1', { hero: 'knight', skills: [{ id: 'bulwark', v: 'a' }] }, 1],
  ['Lv3 on day 3', { hero: 'knight', skills: [{ id: 'bulwark', v: 'a1' }, { id: 'shield', v: '' }] }, 3],
  ['3 bonuses', { hero: 'knight', skills: [{ id: 'shield', v: '', bonus: [{ t: 'line:hit', e: 'dmg' }, { t: 'line:ice', e: 'dmg' }, { t: 'strike', e: 'power' }] }] }, 2],
  ['all Lv3 day 4', { hero: 'pyro', skills: ['inferno', 'ignite', 'blaze', 'scorch'].map((id) => ({ id, v: 'a1' })) }, 4],
  ['two marks', { hero: 'pyro', skills: [{ id: 'ignite', v: 'a', mark: 'echo' }, { id: 'blaze', v: 'a', mark: 'quick' }] }, 6],
  ['other hero unique', { hero: 'knight', skills: [{ id: 'shatter', v: '' }] }, 2],
];
for (const [name, b, day] of forged) if (typeof validateBuild(b, day) !== 'string') bad.push(`forged "${name}" was accepted`);
if (bad.length) {
  console.error(`validate check: ${bad.length} problem(s)\n  ${bad.slice(0, 30).join('\n  ')}`);
  process.exit(1);
}
console.log(`validate check: ${n} bot builds (all tiers, days 1–15) and ${runsDays} days of honest bot runs (real records, last chances) pass, ${forged.length} forged builds rejected`);
