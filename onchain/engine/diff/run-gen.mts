// Run-state differential cases, TS side (reference = run.ts, sim v22 / run v13). Each case: hero choices + a full
// action log with the accept/reject result and a hash of the WHOLE run state after every action.
//   gen <N> <out.txt>   half "player" runs (sensible play to the end), half "adversarial" (random actions,
//                       out-of-range indices, any phase, after the end). Every other case is an on-chain run
//                       (RunState.secret set: relic offers + mark kinds from the secret seed).
//   dump <case>         print the decoded actions and states of one case (debugging)
import fs from 'node:fs';
import { randomAiBuild } from '../../../src/sim/bot';
import { simulate } from '../../../src/sim/combat';
import { Rng, hashSeed } from '../../../src/sim/rng';
import { SKILL_LIST, VARIANTS, lvOf, nextVariants } from '../../../src/sim/skills';
import { HEROES } from '../../../src/sim/heroes';
import { LINES, type Build, type SkillInstance } from '../../../src/sim/types';
import { BONUS_KINDS, MAX_BONUS } from '../../../src/sim/links';
import { RELICS, RELIC_DAYS, MAX_RELICS, RELIC_OFFER } from '../../../src/sim/relics';
import {
  MARKS, applyMark, buy, buySlot, chooseLastChance, concede, heroChoices, moveSkill, newRun, pickRelic, priceOf, recordResult,
  reroll, rerollRelic, sell, slotPrice, slotsOf, toBuild, toggleLock, upgradeOf, wish, wishKind, wishPrice, type Offer, type RunState,
} from '../../../src/sim/run';
import { enc as buildEnc } from './enc.mts';

const PHASES = ['shop', 'relic', 'lastchance', 'mark', 'won', 'dead'];
const LC = ['awaken', 'mark', 'supply', 'nothing'] as const;
const hIdx = (id: string) => HEROES.findIndex((h) => h.id === id);
const sIdx = (id: string) => SKILL_LIST.findIndex((d) => d.id === id);
const rIdx = (id?: string) => (id ? RELICS.findIndex((r) => r.id === id) : 255);
const bonusEnc = (bonus?: { t: string; e: string }[]) => {
  const out: number[] = [];
  for (let j = 0; j < MAX_BONUS; j++) {
    const b = bonus?.[j];
    if (!b) out.push(0, 0);
    else out.push(b.t.startsWith('line:') ? 200 + LINES.indexOf(b.t.slice(5) as never) : sIdx(b.t), BONUS_KINDS.indexOf(b.e as never));
  }
  return out;
};
const W = 5 + 2 * MAX_BONUS;
const skillEnc = (k?: SkillInstance) => (k ? [sIdx(k.id), VARIANTS.indexOf(k.v as never), k.mark ? MARKS.indexOf(k.mark) + 1 : 0, k.star ?? 0, k.bonus?.length ?? 0, ...bonusEnc(k.bonus)] : Array(W).fill(0));
const offerEnc = (o?: Offer | null) => (o ? [1, sIdx(o.id), VARIANTS.indexOf(o.v as never), o.star ?? 0, o.bonus?.length ?? 0, ...bonusEnc(o.bonus)] : Array(W).fill(0));
/** the whole run state as integers (same layout as run_diff.rs encode) */
export function encodeState(s: RunState): number[] {
  // on chain the last chance's mark stays unknown until it is placed (Rust: PENDING_SECRET)
  const pend = s.pendingMark ? (s.secret !== undefined ? 255 : MARKS.indexOf(s.pendingMark) + 1) : 0;
  const out = [
    hIdx(s.hero), s.seed, s.day, s.hp, s.wins, s.losses, s.gold, s.streak, s.lastIncome.base, s.lastIncome.bonus, s.bonusSlots,
    s.slotBuys, s.rolls, s.ghost ? 1 : 0, pend, PHASES.indexOf(s.phase), s.conceded ? 1 : 0, s.wishes ?? 0, s.wishMarks ?? 0,
    s.skills.length,
  ];
  for (let i = 0; i < 5; i++) out.push(s.locks?.[i] ? 1 : 0);
  for (let i = 0; i < MAX_RELICS; i++) out.push(rIdx(s.relics?.[i]));
  for (let i = 0; i < RELIC_OFFER; i++) out.push(rIdx(s.relicOffer?.[i]));
  out.push(RELIC_DAYS.reduce((m, d, i) => m | ((s.relicDays ?? []).includes(d) ? 1 << i : 0), 0), s.relicRolls ?? 0);
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

type Act = { code: number; args: number[]; opp?: Build };
/** apply one action the TS way; returns accepted (void functions count as accepted) */
function apply(s: RunState, a: Act): boolean {
  const [x, y] = a.args;
  switch (a.code) {
    case 0: {
      // y = branch of an upgrade: -1 = the card's own, 0 / 1 = nextVariants index, anything else = invalid
      const o = s.shop[x];
      const owned = o ? s.skills.find((k) => k.id === o.id) : undefined;
      const pick = y < 0 ? undefined : (owned ? nextVariants(owned.v)[y] : undefined) ?? 'zz';
      return buy(s, x, pick) === null;
    }
    case 1: sell(s, x); return true;
    case 2: moveSkill(s, x, y as -1 | 1); return true;
    case 3: return reroll(s) === null;
    case 4: return toggleLock(s, x) === null;
    case 5: return buySlot(s) === null;
    case 6: return !('err' in wish(s));
    case 7: chooseLastChance(s, LC[x] as never); return true;
    case 8: return applyMark(s, x) === null;
    case 9: concede(s); return true;
    case 10: {
      const r = simulate(toBuild(s), a.opp!, x >>> 0, s.day);
      recordResult(s, r.winner === 0, { opp: 'x', ai: true }, r.winner === -1);
      return true;
    }
    case 11: return pickRelic(s, x) === null;
    case 12: return rerollRelic(s) === null;
  }
  throw new Error('bad code ' + a.code);
}

/** a sensible player: relics, buy valid offers (either branch), sometimes reroll / lock / wish / buy slots / reorder / sell, then fight */
function playerActions(s: RunState, rng: Rng, tier: 'easy' | 'normal'): Act[] {
  const one = (a: Act) => { apply(s, a); return [a]; };
  if (s.phase === 'lastchance') return one({ code: 7, args: [rng.int(3)] });
  if (s.phase === 'mark') return one({ code: 8, args: [rng.int(s.skills.length + 1) - 1] });
  if (s.phase === 'relic') return rng.next() < 0.3 ? one({ code: 12, args: [] }) : one({ code: 11, args: [rng.int(4) - 1] });
  if (rng.next() < 0.01) return one({ code: 9, args: [] });
  const acts: Act[] = [];
  for (let step = 0; step < 14; step++) {
    const r = rng.next();
    const buyable = s.shop.map((o, i) => [o, i] as const).filter(([o]) => o && s.gold >= priceOf(o) && (o.v === '' ? !s.skills.some((k) => k.id === o.id) && s.skills.length < slotsOf(s) : !!upgradeOf(s, o)));
    if (buyable.length && r < 0.55) acts.push({ code: 0, args: [rng.pick(buyable)[1], rng.int(3) - 1] });
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
  const secret = i % 4 >= 2 ? rng.next() * 2 ** 32 >>> 0 : undefined;
  const choices = heroChoices(seed);
  const hero = rng.pick(choices);
  const acts: Act[] = [];
  if (i % 2 === 0) {
    const plan = start(hero, seed, secret);
    while (plan.phase !== 'won' && plan.phase !== 'dead' && plan.day <= 30 && acts.length < 600) acts.push(...playerActions(plan, rng, i % 8 === 0 ? 'easy' : 'normal'));
  } else {
    let day = 1;
    for (let k = 0; k < 90 && day < 36; k++) {
      const code = rng.int(13);
      const arg = () => rng.int(12) - 2;
      if (code === 10) { acts.push({ code, args: [rng.next() * 2 ** 32 >>> 0], opp: randomAiBuild(1 + rng.int(20), rng.next() * 2 ** 32 >>> 0) }); day++; }
      else if (code === 0) acts.push({ code, args: [arg(), rng.int(4) - 1] });
      else if (code === 2) acts.push({ code, args: [arg(), rng.next() < 0.5 ? -1 : 1] });
      else if (code === 7) acts.push({ code, args: [rng.int(4)] });
      else if (code === 3 || code === 5 || code === 6 || code === 9 || code === 12) acts.push({ code, args: [] });
      else acts.push({ code, args: [arg()] });
    }
  }
  return { seed, secret, choices, hero, acts };
}
function start(hero: string, seed: number, secret?: number) {
  return newRun(hero, seed, 'x', secret);
}

const [mode, ...args] = process.argv.slice(2);
if (mode === 'gen') {
  const N = Number(args[0]);
  const lines: string[] = [];
  let nActs = 0, won = 0, dead = 0, maxDay = 0;
  const codes = Array(13).fill(0), rejected = Array(13).fill(0);
  const cov: Record<string, number> = {};
  const inc = (k: string) => (cov[k] = (cov[k] ?? 0) + 1);
  for (let i = 0; i < N; i++) {
    const c = caseOf(i);
    const s = start(c.hero, c.seed, c.secret);
    const toks: (number | string)[] = [c.seed, c.secret ?? -1, ...c.choices.map(hIdx), hIdx(c.hero), '|', hashOf(encodeState(s))];
    for (const a of c.acts) {
      const before = { phase: s.phase, wk: wishKind(s), offer: a.code === 0 ? s.shop[a.args[0]] : null };
      const ok = apply(s, a);
      if (a.code === 6 && ok) inc(`wish:${before.wk}${c.secret !== undefined ? ':secret' : ''}`);
      if (a.code === 7 && before.phase === 'lastchance') inc(`lc:${LC[a.args[0]]}`);
      if (a.code === 8 && ok && a.args[0] >= 0) inc(c.secret !== undefined ? 'markPlaced:secret' : 'markPlaced');
      if (a.code === 0 && ok) inc(before.offer?.star ? 'buyStar' : before.offer?.v === '' ? 'buyNew' : a.args[1] === 1 ? 'buyUpgradeB' : 'buyUpgrade');
      if (a.code === 11 && ok) inc(a.args[0] >= 0 ? 'relicPick' : 'relicSkip');
      if (a.code === 12 && ok) inc('relicReroll');
      if (before.phase === 'won' || before.phase === 'dead') inc('afterEnd');
      if (s.shop.some((o) => o?.star)) inc('shopHasStar');
      codes[a.code]++; if (!ok) rejected[a.code]++;
      toks.push(a.code, ...a.args, ...(a.opp ? buildEnc(a.opp) : []), ok ? 1 : 0, hashOf(encodeState(s)));
    }
    nActs += c.acts.length; if (s.phase === 'won') won++; if (s.phase === 'dead') dead++; maxDay = Math.max(maxDay, s.day);
    lines.push(toks.join(' '));
  }
  fs.writeFileSync(args[1], lines.join('\n') + '\n');
  console.log(`${N} runs, ${nActs} actions (${(nActs / N).toFixed(1)}/run), ended won ${won} dead ${dead}, max day ${maxDay}`);
  console.log('actions by code [buy,sell,move,reroll,lock,slot,wish,lastchance,mark,concede,fight,relic,relicReroll]:', codes.join(','), '· rejected:', rejected.join(','));
  console.log('coverage:', JSON.stringify(cov));
} else if (mode === 'dump') {
  const c = caseOf(Number(args[0]));
  const s = start(c.hero, c.seed, c.secret);
  console.log('start', JSON.stringify(encodeState(s)));
  c.acts.forEach((a, k) => { const ok = apply(s, a); console.log(k, a.code, a.args.join(','), ok ? 'ok' : 'REJ', JSON.stringify(encodeState(s))); });
}
