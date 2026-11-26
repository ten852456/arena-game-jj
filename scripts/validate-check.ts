// Build plausibility check (part of npm test): every build a real run can make passes validateBuild, forged ones don't.
// Real runs here = bot runs of every tier and hero on days 1–15 (they shop with the same rules and prices as players).
import { aiBuild, botDay, botRules, randomAiBuild } from '../src/sim/bot';
import { simulate } from '../src/sim/combat';
import { applyMark, chooseLastChance, markKindFor, newRun, recordResult, toBuild } from '../src/sim/run';
import { HEROES } from '../src/sim/heroes';
import { hashSeed } from '../src/sim/rng';
import { allowances, buildCost, couldBeFull, runMax, spendCheck, validateBuild, type RunRecord } from '../src/server/validate';
import { SUPPLY_GOLD_FULL } from '../src/sim/run';
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
      let prev: { build?: Build; spent?: number; paidSlots?: number } | undefined;
      for (let guard = 0; guard < 25 && s.phase !== 'won' && s.phase !== 'dead'; guard++) {
        if (s.phase === 'lastchance') chooseLastChance(s, (['awaken', 'supply', 'mark'] as const)[r % 3]);
        if (s.phase === 'mark') applyMark(s, 0);
        if (s.phase !== 'shop' && s.phase !== 'relic') continue;
        botDay(s, rules);
        const rec = s.log.map((l) => (l.won ? 1 : l.draw ? 2 : 0)) as RunRecord;
        const b = toBuild(s);
        const v = validateBuild(b, s.day, rec);
        runsDays++;
        // the server's day-by-day spend check (fight.ts) must accept every honest run too
        const ways = spendCheck(prev, b, s.day, rec);
        if (!ways.length) bad.push(`run ${tier} ${h.id} #${r} day ${s.day}: spend check failed (${JSON.stringify(spendCheck({ ...prev, spent: -999 }, b, s.day, rec))})`);
        else {
          const w = ways.reduce((a, c) => (c.spent < a.spent ? c : a));
          prev = { build: b, spent: w.spent, paidSlots: w.paidSlots };
        }
        if (typeof v === 'string') bad.push(`run ${tier} ${h.id} #${r} day ${s.day}: ${v} · ${b.skills.map((k) => `${k.id}:${k.v || '1'}${k.mark ? '+' + k.mark : ''}`).join(' ')} · gold ${s.gold}`);
        const opp = randomAiBuild(s.day, hashSeed(92, tier, h.id, r, s.day), tier);
        const res = simulate(b, opp, hashSeed(93, r, s.day), s.day);
        recordResult(s, res.winner === 0, { opp: 'bot', ai: true }, res.winner === -1);
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
// security review (round 4): a draw costs no HP, so draws never lead to a last chance; and supply + awaken never stack
if (runMax(12, Array(11).fill(2) as RunRecord).lastChance) bad.push('draws were counted as losses (last chance from draws)');
{
  // a record with a death on day 8 (v0.0.1: days 1–2 cost 1 HP, so 7 losses are 15 HP and no longer a death): a build that needs the free slot AND the awaken gold must be rejected
  const rec = [0, 0, 0, 0, 0, 0, 0, 0] as RunRecord;
  const ways = allowances(9, rec);
  if (new Set(ways.map((w) => w.opt)).size !== 3 || ways.some((w) => w.opt === 'none')) bad.push('a death on day 8 should give the three last-chance choices');
  const gold = runMax(9, rec).gold;
  const need = (free: number, b: Build) => buildCost(b, 9, free);
  // search builds that fit only when supply AND awaken stack: every one of them must be rejected
  const ids = ['shield', 'stoneskin', 'cleanse', 'bulwark', 'strike', 'jab', 'heavy', 'feast'];
  let stacked = 0;
  for (let n = 4; n <= 8; n++)
    for (let lv3 = 0; lv3 <= n; lv3++) {
      const lv2 = 0;
      const sk = ids.slice(0, n).map((id, i) => ({ id, v: i < lv3 ? 'a1' : '' }));
      const bb: Build = { hero: 'knight', skills: sk };
      const both = need(1, bb) <= gold + 8 + 4 * Math.min(n, 5);
      const one = ways.some((w) => need(w.freeSlots, bb) <= w.cap(n));
      if (both && !one) {
        stacked++;
        if (typeof validateBuild(bb, 9, rec) !== 'string') bad.push(`supply and awaken were granted together (${n} skills, ${lv3} Lv3, ${lv2} Lv2)`);
      }
    }
  if (!stacked) bad.push('no build needs supply + awaken stacked: the test proves nothing');
  const b: Build = { hero: 'knight', skills: ids.slice(0, 6).map((id) => ({ id, v: 'a1' })) };
  if (typeof validateBuild(b, 9, rec, 'mark') !== 'string' && need(0, b) > gold) bad.push('a pinned last-chance choice was ignored');
  if (need(0, b) <= gold) bad.push('pinned-choice test build is too cheap');
  // supply: either +8 gold and a slot, or 12 gold (slots full) and no slot, never both
  const sup = allowances(9, rec, 'supply');
  if (sup.some((w) => w.freeSlots > 0 && w.cap(6) > gold + 8)) bad.push('supply gave a free slot together with the full-slots gold');
  if (sup.length !== 2) bad.push(`supply should give two separate ways here (got ${sup.length})`);
  if (couldBeFull(1, 7)) bad.push('couldBeFull: a day-1 run with 7 gold cannot have 8 slots');
  if (!couldBeFull(7, 60)) bad.push('couldBeFull: 60 gold buys the 3 missing slots on day 7');
  // a build that needs the free slot AND more than 8 extra gold must fail with supply pinned
  for (let k = 0; k < 40; k++) {
    const n = 6;
    const bb: Build = { hero: 'knight', skills: ids.slice(0, n).map((id, i) => ({ id, v: i < k % 7 ? 'a1' : i < (k % 7) + 2 ? 'a' : '' })) };
    const withSlot = need(1, bb);
    if (withSlot > gold + 8 && withSlot <= gold + SUPPLY_GOLD_FULL && need(0, bb) > gold + SUPPLY_GOLD_FULL && typeof validateBuild(bb, 9, rec, 'supply') !== 'string') bad.push('supply slot + full-slots gold were combined');
  }
  // the two checks must agree on ONE way: a build with a mark (only the Mark way allows it) and a running spend that only
  // Supply's +8 gold covers passes each check under a different way, so the fight must be rejected
  const marked: Build = { hero: 'knight', skills: [{ id: 'shield', v: 'a', mark: 'echo' }, { id: 'bulwark', v: '' }] };
  if (typeof validateBuild(marked, 9, rec) === 'string') bad.push('mixed-way test: the marked build should pass validateBuild alone');
  const prevSpent = { build: marked, spent: gold + 5, paidSlots: 0 };
  const mixed = spendCheck(prevSpent, marked, 9, rec);
  if (mixed.length) bad.push(`a build passed with marks from one last-chance way and gold from another (${mixed.map((w) => w.opt).join(', ')})`);
  if (!spendCheck({ build: marked, spent: gold - 1, paidSlots: 0 }, marked, 9, rec).some((w) => w.opt === 'mark')) bad.push('mixed-way test: the honest Mark way should pass');
}
// security review (round 7): each last-chance way keeps its own ledger; one way's spend never combines with another's cap
{
  const rec = [0, 0, 0, 0, 0, 0, 0, 0, 1] as RunRecord;
  const G = runMax(10, rec).gold;
  const B: Build = { hero: 'knight', skills: [{ id: 'shield', v: 'a1', mark: 'echo' }, { id: 'bulwark', v: '' }] };
  const cur: Build = { hero: 'knight', skills: [...B.skills, { id: 'stoneskin', v: '' }] };
  const ledger = { 'mark:0': { spent: G - 2, paidSlots: 0, wishMarks: 0, freeMarks: 1 }, 'supply:1': { spent: G + 7, paidSlots: 0, wishMarks: 1, freeMarks: 0 } };
  if (spendCheck({ build: B, ledger }, cur, 10, rec).length) bad.push('ledger: a way passed with another ways cheaper spend (mark spend + supply gold)');
  // the same numbers collapsed into one shared ledger would have let it through (the hole the per-way ledger closes)
  if (!spendCheck({ build: B, spent: G - 2, paidSlots: 0, wishMarks: 0, freeMarks: 1 }, cur, 10, rec).length) bad.push('ledger test: the collapsed ledger should show the hole');
  // a way dropped earlier never comes back
  if (spendCheck({ build: B, ledger: { 'supply:1': { spent: G + 7, paidSlots: 0, wishMarks: 1, freeMarks: 0 } } }, B, 10, rec).some((w) => w.opt === 'mark')) bad.push('ledger: a dropped way came back');
}
let markChi = 0;
// security review (round 9): the two wish-mark kinds of a run are independent (FNV low bits used to pair them)
{
  const n = 16000;
  const pairs: Record<string, number> = {};
  for (let i = 0; i < n; i++) { const k = `${markKindFor(i * 7919 + 13, 0)}+${markKindFor(i * 7919 + 13, 1)}`; pairs[k] = (pairs[k] ?? 0) + 1; }
  const keys = Object.keys(pairs);
  const exp = n / 16;
  const chi = keys.reduce((a, k) => a + (pairs[k] - exp) ** 2 / exp, 0) + (16 - keys.length) * exp;
  // 15 degrees of freedom: chi² above 37.7 has p < 0.001
  if (keys.length !== 16 || chi > 37.7) bad.push(`mark kinds: wish pairs not uniform (${keys.length}/16 pairs, chi² ${chi.toFixed(1)})`);
  else markChi = chi;
}
if (bad.length) {
  console.error(`validate check: ${bad.length} problem(s)\n  ${bad.slice(0, 30).join('\n  ')}`);
  process.exit(1);
}
console.log(`validate check: mark-kind pairs uniform (chi² ${markChi.toFixed(1)}, 15 df) · ${n} bot builds (all tiers, days 1–15) and ${runsDays} days of honest bot runs (real records, last chances) pass, ${forged.length} forged builds rejected`);
