// Run-state differential cases, TS side (reference = run.ts). Each case: hero choices + a full action log with
// the accept/reject result and a hash of the WHOLE run state after every action.
//   gen <N> <out.txt>   half "player" runs (sensible play to the end), half "adversarial" (random actions,
//                       out-of-range indices, any phase, after the end)
//   dump <case>         print the decoded actions and states of one case (debugging)
import fs from 'node:fs';
import { randomAiBuild } from '../../../src/sim/bot';
import { simulate } from '../../../src/sim/combat';
import { Rng, hashSeed } from '../../../src/sim/rng';
import { SKILL_LIST, VARIANTS, lvOf } from '../../../src/sim/skills';
import { HEROES } from '../../../src/sim/heroes';
import { ARCHES, type Build, type SkillInstance } from '../../../src/sim/types';
import { BONUS_KINDS, MAX_BONUS } from '../../../src/sim/links';
import {
  MARKS, applyMark, buy, buySlot, chooseLastChance, concede, heroChoices, moveSkill, newRun, priceOf, recordResult, reroll,
  sell, slotPrice, slotsOf, toBuild, toggleLock, upgradeOf, wish, wishKind, wishPrice, type Offer, type RunState,
} from '../../../src/sim/run';

const PHASES = ['shop', 'lastchance', 'mark', 'won', 'dead'];
const LC = ['awaken', 'mark', 'supply', 'nothing'] as const;
const hIdx = (id: string) => HEROES.findIndex((h) => h.id === id);
const sIdx = (id: string) => SKILL_LIST.findIndex((d) => d.id === id);
const bonusEnc = (bonus?: { t: string; e: string }[]) => {
  const out: number[] = [];
  for (let j = 0; j < MAX_BONUS; j++) {
    const b = bonus?.[j];
    if (!b) out.push(0, 0);
    else out.push(b.t.startsWith('arch:') ? 200 + ARCHES.indexOf(b.t.slice(5) as never) : sIdx(b.t), BONUS_KINDS.indexOf(b.e as never));
  }
  return out;
};
const skillEnc = (k?: SkillInstance) => (k ? [sIdx(k.id), VARIANTS.indexOf(k.v as never), k.mark ? MARKS.indexOf(k.mark) + 1 : 0, k.bonus?.length ?? 0, ...bonusEnc(k.bonus)] : Array(10).fill(0));
const offerEnc = (o?: Offer | null) => (o ? [1, sIdx(o.id), VARIANTS.indexOf(o.v as never), o.bonus?.length ?? 0, ...bonusEnc(o.bonus)] : Array(10).fill(0));
/** the whole run state as integers (same layout as the Rust test's encode) */
export function encodeState(s: RunState): number[] {
  const out = [
    hIdx(s.hero), s.seed, s.day, s.hp, s.wins, s.losses, s.gold, s.streak, s.lastIncome.base, s.lastIncome.bonus, s.bonusSlots,
    s.slotBuys, s.rolls, s.ghost ? 1 : 0, s.pendingMark ? MARKS.indexOf(s.pendingMark) + 1 : 0, PHASES.indexOf(s.phase),
    s.conceded ? 1 : 0, s.wishes ?? 0, s.skills.length,
  ];
  for (let i = 0; i < 5; i++) out.push(s.locks?.[i] ? 1 : 0);
  for (let i = 0; i < 8; i++) out.push(...skillEnc(s.skills[i]));
  for (let i = 0; i < 5; i++) out.push(...offerEnc(s.shop[i]));
  return out;
}
const hashOf = (xs: number[]) => {
  let h = 2166136261;
  for (const x of xs) {
    h = Math.imul(h ^ (x >>> 0), 16777619) >>> 0;
    h = Math.imul(h ^ (Math.floor(x / 4294967296) >>> 0), 16777619) >>> 0;
  }
  return h;
};
const buildEnc = (b: Build) => {
  const out = [hIdx(b.hero), b.skills.length];
  for (let i = 0; i < 8; i++) out.push(...skillEnc(b.skills[i]));
  return out;
};

type Act = { code: number; args: number[]; opp?: Build };
/** apply one action the TS way; returns accepted (void functions count as accepted) */
function apply(s: RunState, a: Act): boolean {
  const [x, y] = a.args;
  switch (a.code) {
    case 0: return buy(s, x) === null;
    case 1: sell(s, x); return true;
    case 2: moveSkill(s, x, y as -1 | 1); return true;
    case 3: return reroll(s) === null;
    case 4: return toggleLock(s, x) === null;
    case 5: return buySlot(s) === null;
    case 6: return !('err' in wish(s));
    case 7: chooseLastChance(s, LC[x] as never); return true;
    case 8: applyMark(s, x); return true;
    case 9: concede(s); return true;
    case 10: {
      const r = simulate(toBuild(s), a.opp!, x >>> 0, s.day);
      recordResult(s, r.winner === 0, { opp: 'x', ai: true });
      return true;
    }
  }
  throw new Error('bad code ' + a.code);
}

/** a sensible player: buy valid offers, sometimes reroll / lock / wish / buy slots / reorder / sell, then fight */
function playerActions(s: RunState, rng: Rng, tier: 'easy' | 'normal'): Act[] {
  const acts: Act[] = [];
  const one = (a: Act) => { apply(s, a); return [a]; };
  if (s.phase === 'lastchance') return one({ code: 7, args: [rng.int(3)] });
  if (s.phase === 'mark') return one({ code: 8, args: [rng.int(s.skills.length + 1) - 1] });
  if (rng.next() < 0.01) return one({ code: 9, args: [] });
  for (let step = 0; step < 14; step++) {
    const r = rng.next();
    const buyable = s.shop.map((o, i) => [o, i] as const).filter(([o]) => o && s.gold >= priceOf(o) && (o.v === '' ? !s.skills.some((k) => k.id === o.id) && s.skills.length < slotsOf(s) : !!upgradeOf(s, o)));
    if (buyable.length && r < 0.55) acts.push({ code: 0, args: [rng.pick(buyable)[1]] });
    else if (r < 0.63 && wishKind(s) && s.gold >= wishPrice(s)) acts.push({ code: 6, args: [] });
    else if (r < 0.69 && slotsOf(s) < 8 && s.gold >= slotPrice(s)) acts.push({ code: 5, args: [] });
    else if (r < 0.79 && s.day > 1 && s.gold >= 1) acts.push({ code: 3, args: [] });
    else if (r < 0.85 && s.shop.length) acts.push({ code: 4, args: [rng.int(5)] });
    else if (r < 0.92 && s.skills.length > 1) acts.push({ code: 2, args: [rng.int(s.skills.length), rng.next() < 0.5 ? -1 : 1] });
    else if (r < 0.95 && s.skills.length) acts.push({ code: 1, args: [rng.int(s.skills.length)] });
    else break;
    apply(s, acts[acts.length - 1]); // keep the planning state in sync (the recorded run replays from scratch)
  }
  acts.push({ code: 10, args: [rng.next() * 2 ** 32 >>> 0], opp: randomAiBuild(Math.min(20, s.day), rng.next() * 2 ** 32 >>> 0, tier) });
  apply(s, acts[acts.length - 1]);
  return acts;
}

function caseOf(i: number) {
  const rng = new Rng(hashSeed('runcase', i));
  const seed = rng.next() * 2 ** 32 >>> 0;
  const choices = heroChoices(seed);
  const hero = rng.pick(choices);
  const acts: Act[] = [];
  if (i % 2 === 0) {
    const plan = newRun(hero, seed, 'p');
    while (plan.phase !== 'won' && plan.phase !== 'dead' && plan.day <= 30 && acts.length < 600) acts.push(...playerActions(plan, rng, i % 4 === 0 ? 'easy' : 'normal'));
  } else {
    let day = 1;
    for (let k = 0; k < 80 && day < 36; k++) {
      const code = rng.int(11);
      const arg = () => rng.int(12) - 2;
      if (code === 10) { acts.push({ code, args: [rng.next() * 2 ** 32 >>> 0], opp: randomAiBuild(1 + rng.int(20), rng.next() * 2 ** 32 >>> 0) }); day++; }
      else if (code === 2) acts.push({ code, args: [arg(), rng.next() < 0.5 ? -1 : 1] });
      else if (code === 7) acts.push({ code, args: [rng.int(4)] });
      else if (code === 3 || code === 5 || code === 6 || code === 9) acts.push({ code, args: [] });
      else acts.push({ code, args: [arg()] });
    }
  }
  return { seed, choices, hero, acts };
}

const [mode, ...args] = process.argv.slice(2);
if (mode === 'gen') {
  const N = Number(args[0]);
  const lines: string[] = [];
  let nActs = 0, won = 0, dead = 0, maxDay = 0;
  const codes = Array(11).fill(0), rejected = Array(11).fill(0);
  const cov = { shortShop: 0, keptLock: 0, wishMark: 0, wishNone: 0, allLv3: 0, lcAwaken: 0, lcMark: 0, lcSupply: 0, markPlaced: 0, buyUpgrade: 0, buyNew: 0, afterEnd: 0 };
  for (let i = 0; i < N; i++) {
    const c = caseOf(i);
    const s = newRun(c.hero, c.seed, 'x');
    const toks: (number | string)[] = [c.seed, ...c.choices.map(hIdx), hIdx(c.hero), '|', hashOf(encodeState(s))];
    for (const a of c.acts) {
      const before = { phase: s.phase, wk: wishKind(s), locks: (s.locks ?? []).filter(Boolean).length, offer: a.code === 0 ? s.shop[a.args[0]] : null, lc: s.phase === 'lastchance' };
      const ok = apply(s, a);
      if (a.code === 10 && before.locks && (s.locks ?? []).some(Boolean)) cov.keptLock++;
      if (s.shop.filter(Boolean).length < 5 && s.shop.length < 5) cov.shortShop++;
      if (a.code === 6) { if (before.wk === 'mark') cov.wishMark++; if (!before.wk) cov.wishNone++; }
      if (s.skills.length && s.skills.every((k) => lvOf(k.v) === 3)) cov.allLv3++;
      if (a.code === 7 && before.lc) cov[(['lcAwaken', 'lcMark', 'lcSupply'] as const)[a.args[0]] ?? 'afterEnd']++;
      if (a.code === 8 && before.phase === 'mark' && a.args[0] >= 0 && a.args[0] < s.skills.length) cov.markPlaced++;
      if (a.code === 0 && ok) before.offer?.v === '' ? cov.buyNew++ : cov.buyUpgrade++;
      if (before.phase === 'won' || before.phase === 'dead') cov.afterEnd++;
      codes[a.code]++; if (!ok) rejected[a.code]++;
      toks.push(a.code, ...a.args, ...(a.opp ? buildEnc(a.opp) : []), ok ? 1 : 0, hashOf(encodeState(s)));
    }
    nActs += c.acts.length; if (s.phase === 'won') won++; if (s.phase === 'dead') dead++; maxDay = Math.max(maxDay, s.day);
    lines.push(toks.join(' '));
  }
  fs.writeFileSync(args[1], lines.join('\n') + '\n');
  console.log(`${N} runs, ${nActs} actions (${(nActs / N).toFixed(1)}/run), ended won ${won} dead ${dead}, max day ${maxDay}`);
  console.log('actions by code [buy,sell,move,reroll,lock,slot,wish,lastchance,mark,concede,fight]:', codes.join(','), '· rejected:', rejected.join(','));
  console.log('coverage:', JSON.stringify(cov));
} else if (mode === 'dump') {
  const c = caseOf(Number(args[0]));
  const s = newRun(c.hero, c.seed, 'x');
  console.log('start', JSON.stringify(encodeState(s)));
  c.acts.forEach((a, k) => { const ok = apply(s, a); console.log(k, a.code, a.args.join(','), ok ? 'ok' : 'REJ', JSON.stringify(encodeState(s))); });
}
