// Build plausibility check (part of npm test): every build a real run can make passes validateBuild, forged ones don't.
// Real runs here = bot runs of every tier and hero on days 1–15 (they shop with the same rules and prices as players).
import { aiBuild } from '../src/sim/bot';
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
console.log(`validate check: ${n} bot builds (all tiers, days 1–15) pass, ${forged.length} forged builds rejected`);
