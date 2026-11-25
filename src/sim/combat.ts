import { HEROES_BY_ID, ULT_LV2_POW, inLine, lineAffinity, ultLevel, ultPow, ultTrig, type CombatHooks, type HookFighter } from './heroes';
import { activeBonuses, bonusTotals } from './links';
import { ONE, P, ceilDiv, mulP, rdiv } from './fixed';
import { Rng } from './rng';
import { T } from './tuning';
import { SKILLS, TIME_CAP_S, execNode, lvOf, nodeOf, rarityOf, reacts, worthOf, type Ctx, type FighterView } from './skills';
import type {
  BlockStat, Build, CombatEvent, CombatResult, CooldownTrace, DamageKind, EventBody, Fx, Mark, Side, SideStat, SkillInstance, Snap, StatusKind,
} from './types';

/**
 * Pure, deterministic auto-battle. No Date, no Math.random, no I/O.
 * simulate(a, b, seed, day) always returns the same events, so the server decides
 * the result and the browser (or a shared replay link) just plays it back.
 *
 * Every equipped skill runs its own cooldown at the same time. When it is ready it fires.
 * Connect bonuses work when the skill right above or below matches their condition. A trigger bonus makes the
 * matching neighbour fire right away too, without resetting its cooldown. Ties fire top to bottom.
 * Engine skills fire their neighbours (ฟันเฟือง: one per fire, taking turns; เร่งเครื่อง: both + restart their cooldown).
 * Anything set off by another skill (trigger bonus or engine) counts as "ต่อ": a skill can be set off at most once
 * per TRIGGER_GAP, so chains stay bounded.
 *
 * Control rules (so no side is locked for a whole fight):
 * - freeze and cast delay share a cap per fight (freezeCap), whatever skill, chain or engine applies them;
 * - a frozen fighter cannot be frozen or delayed again; when a freeze ends or a delay lands, the fighter is immune
 *   to freeze and delay for CTL_IMMUNE ticks;
 * - skills with ✨ ชำระ or 🗿 ใจเหล็ก react: when control lands on their owner they fire right away
 *   (at most once per their cooldown, and their cooldown restarts).
 *
 * Lines (sim v12): dodge charges negate whole direct hits (not burn, poison, thorns, fatigue or ultimates); poison is a
 * long, weak DoT that ignores shields and cuts healing; haste speeds up your own cooldowns. Each hero's ultimate is
 * unlocked by the build (heroes.ts ultLevel) and fires at most once per fight when its trigger is met.
 *
 * Sim v22 (on-chain): every number that decides the fight is an integer. Multipliers and shares are ppm (fixed.ts:
 * 1.25 → 1_250_000), cooldown progress and พลัง are in ppm too, so the Rust engine on Solana gives the exact same result.
 * Data numbers (skills / tuning) go through P() once; state never holds a float. Only the per-block stats and the
 * event values the UI shows may still be fractions.
 */

/** Bump when combat rules or numbers change: old replays can no longer be re-simulated. */
export const SIM_VERSION = 22;
export const TPS = 10; // ticks per second
export const MAX_TICKS = 90 * TPS;
/**
 * Base HP per day, tuned with `npm run balance` so fights last ≈10–13s on days 1–3,
 * 15–22s on days 4–7 and 23–30s on day 8+ (bot damage per second grows about linearly with the day).
 */
const HP_BY_DAY = [15, 20, 26, 44, 57, 68, 80, 127, 135, 156, 176, 198, 220];
/** HP added per day after the table */
const HP_LATE_STEP = 60;
/** tuning.ts multiplier of the base HP on a day */
const hpScale = (d: number) => (d <= 3 ? T['hp.early'] : d <= 7 ? T['hp.mid'] : T['hp.late']);
export const hpFor = (day: number) => {
  const d = Math.max(1, Math.floor(day));
  const base = d <= HP_BY_DAY.length ? HP_BY_DAY[d - 1] : HP_BY_DAY[HP_BY_DAY.length - 1] + HP_LATE_STEP * (d - HP_BY_DAY.length);
  return mulP(base, P(hpScale(d)));
};
/** Fatigue: after this many ticks both sides take growing damage (a backstop that ends stalled fights). */
export const fatigueStart = (day: number) => Math.round(Math.min(30, day <= 3 ? 14 : 9 + 2 * day) * TPS);
/** Fatigue damage in the n-th second = n × step, so it ends a fight a few seconds after it starts on every day. */
export const fatigueStep = (day: number) => Math.max(1, Math.ceil(hpFor(day) / 30));
const MAX_FREEZE_TICKS = 15;
/** each recent freeze makes the next one half as long (sim v19): DR_P[n] = 0.5^n in ppm (integer recurrence, no Math.pow) */
const DR_P: number[] = [ONE];
for (let i = 1; i < 24; i++) DR_P.push(mulP(DR_P[i - 1], 500_000));
const drOf = (n: number) => (n < DR_P.length ? DR_P[n] : 0);
const FREEZE_DR_DECAY = 6 * TPS; // one stack of diminishing returns wears off every 6s (sim v19: 4s)
/** Total frozen time per fight (≈25% of the target fight length); after that freezes are resisted. */
export const freezeCap = (day: number) => (day <= 3 ? 2 : day <= 7 ? 4.5 : 6) * TPS;
const SLOW_CAP_P = 500_000;
/** longest trigger chain (each skill fires at most once per chain anyway) */
const MAX_CHAIN = 8;
/**
 * A skill set off by another skill (trigger bonus / engine) cannot be set off again for its own cooldown,
 * but at least TRIGGER_GAP and at most TRIGGER_GAP_MAX ticks. So "ต่อ" at most doubles a fast skill and
 * triples a slow one, and a chain can never loop.
 */
export const TRIGGER_GAP = 2 * TPS;
export const TRIGGER_GAP_MAX = 4 * TPS;
/** a skill set off by an engine (ฟันเฟือง / เร่งเครื่อง) can't be set off again for at least this long (sim v14) */
export const ENGINE_GAP = 3 * TPS;
/** a double KO where the damage dealt is this close (share of the bigger) is a draw */
export const DRAW_SHARE = 0.05;
/** each chain step after the first fires weaker: step 2 = ×0.75, step 3 = ×0.56 … (tuning.ts `chainDecay`) */
export const CHAIN_DECAY = T.chainDecay;
/** ร่ายไว mark: cooldown × this (sim v19: 0.6 was the one mark everyone wanted) */
export const QUICK_MARK = 0.75;
/** ตราศักดิ์สิทธิ์ powers at most this many marked skills */
export const SIGIL_MAX = 2;
/** sim v18: a skill of the hero's line fires its first cast at most this many ticks into the fight (slow lines start sooner) */
export const FIRST_CAST = 35; // 3.5 s
export const FIRST_CAST_STEP = 1 * TPS;
export const FIRST_CAST_MAX = 65; // 6.5 s
/** a cleanse removes at most this many burn / poison stacks per cast */
export const CLEANSE_MAX = 4;
/** no ultimate fires before this tick */
export const ULT_MIN_T = 6 * TPS;
export const FIRST_CAST_DAYS = 7;
/** damage sources a spiked shield does not reflect */
const NO_REFLECT = new Set<DamageKind>(['thorns', 'burn', 'poison', 'fatigue', 'ult']);
/** after a freeze ends or a delay lands, freeze and delay on that fighter are resisted for this long */
export const CTL_IMMUNE = 15; // 1.5 s
/**
 * The control cap grows with the fight (sim v16: a flat share): at tick t at most CTL_SHARE × max(t, CTL_MIN_T) ticks of
 * freeze + delay can have landed, so over a fight longer than CTL_MIN_T control is at most CTL_SHARE of it.
 */
export const CTL_MIN_T = 4 * TPS;
export const CTL_SHARE = 0.25;
/** A fighter that has not fired any skill for this long shakes off freeze / slow and resists all control until it fires. */
export const SHAKE_OFF = 4 * TPS;
/** control shorter than this does not set off ✨/🗿 reactions */
const REACT_MIN = 5;
/** A thorns stack lasts this long, so thorns cannot pile up for the whole fight. */
export const THORNS_TICKS = 10 * TPS;
/** A reflection is at most this share of the hit that caused it. */
export const THORNS_MAX = 0.75;
/** While the enemy has thorns, your healing is multiplied by this. */
export const THORNS_HEAL = 0.5;

interface Block {
  inst: SkillInstance;
  /** cooldown at the start of the fight (⏫ accel cuts `cd` from this) */
  cd0: number;
  /** index into build.skills (for events, replay highlighting and stats) */
  idx: number;
  cd: number;
  /** cooldown progress in ppm ticks (cd × ONE = ready) */
  prog: number;
  /** all numbers of this skill ×power (connect bonus, affinity, stars, relics), ppm */
  power: number;
  /** + damage on every hit / + shield on every fire, from connect bonuses */
  dmg: number;
  shieldOnFire: number;
  /** blocks (indexes into fighter.blocks) this one sets off when it fires */
  triggers: number[];
  /** list neighbours (indexes into fighter.blocks), used by engines */
  adj: number[];
  /** gear: next neighbour to fire */
  rr: number;
  /** tick from which another skill may set this one off again */
  trigAt: number;
  /** ✨/🗿 skill: fires early when its owner gets controlled */
  reacts: boolean;
  /** tick from which it may react again */
  reactAt: number;
}

/** A buff stack remembers which block made it, so damage can be credited and dispel removes one stack. */
interface Stack {
  /** ppm for พลัง (growth can be a part of a point), whole points for thorns */
  v: number;
  idx: number;
  /** tick when this stack wears off (thorns only) */
  until?: number;
}

interface Fighter {
  side: Side;
  hero: string;
  /** 💰 build worth (worthOf × the hero's worth hook) */
  worth: number;
  /** the build's run relics (relics.ts) */
  relics: Set<string>;
  hooks: CombatHooks;
  blocks: Block[];
  hp: number;
  maxHp: number;
  shield: number;
  frozen: number;
  frozenTotal: number;
  /** control used from the shared cap: frozen ticks + delayed ticks */
  delayN: number;
  /** slow share, ppm */
  slowP: number;
  slowT: number;
  /** ticks this fighter has spent slowed (capped per fight by slowCap) */
  slowTotal: number;
  /** พลัง stacks, ppm */
  growth: Stack[];
  /** charge multiplier on the next hit, ppm (ONE = none) */
  charge: number;
  /** block that set the current charge (credit for buff damage) */
  chargeIdx: number;
  thorns: Stack[];
  burns: Dot[];
  poisons: Dot[];
  /** dodge charges, and hits dodged this fight */
  dodge: number;
  dodges: number;
  /** damage this fighter dealt (pre-shield, no fatigue): decides a double KO */
  dealtTotal: number;
  /** haste share (ppm) and ticks left */
  hasteP: number;
  hasteT: number;
  /** healing cut share (ppm) and ticks left */
  woundP: number;
  woundT: number;
  /** ultimate: level from the build, fired yet, trigger counters */
  ultLv: number;
  ultDone: boolean;
  /** shield gained this fight (not the start shield) */
  shieldGot: number;
  /** direct hits taken (landed) */
  hitsTaken: number;
  /** casts of this hero's line skills */
  lineCasts: number;
  /** slows / delays this fighter landed on the enemy */
  ctlLanded: number;
  /** biggest single hit this fighter dealt */
  bigHit: number;
  /** นักรบหนาม ult: poison thorns active until this tick */
  ultUntil: number;
  freezeN: number;
  /** share of control (freeze / slow / delay) that still lands on this fighter, ppm: ONE = all, 400_000 = ใจเหล็ก */
  ctlKeep: number;
  /** the next freeze on this fighter is ignored */
  ignoreFreeze: boolean;
  /** hits the current charge multiplier still applies to */
  chargeHits: number;
  /** the next hit heals this share of its damage (ppm) */
  leechNext: number;
  /** while this fighter has thorns, the enemy's healing is multiplied by this (ppm) */
  thornsHeal: number;
  flags: Record<string, number>;
  stats: BlockStat[];
  /** freeze and delay are resisted until this tick (control-immunity window) */
  immuneUntil: number;
  /** blocks waiting to react to control (processed after the current action) */
  pendingReact: number[];
  /** tick of this fighter's last skill fire (for SHAKE_OFF) */
  lastFire: number;
  side_: SideStat;
}

interface Dot {
  dps: number;
  /** ticks left */
  t: number;
  idx: number;
}

const sum = (xs: Stack[]) => xs.reduce((n, x) => n + x.v, 0);
const dps = (xs: Dot[]) => xs.reduce((n, x) => n + x.dps, 0);
/** damage still to come from a list of DoT stacks */
const dotLeft = (xs: Dot[]) => xs.reduce((n, b) => n + b.dps * ceilDiv(b.t, TPS), 0);
/** product of ppm factors, rounded half up at each step */
const mulAll = (...ps: number[]) => ps.reduce((a, p) => mulP(a, p), ONE);

/** haste = cooldown cut from connect bonuses (0.2 per haste bonus, at most halved) */
export function cdTicks(k: Pick<SkillInstance, 'id' | 'v' | 'mark' | 'star'>, haste = 0): number {
  const m = mulAll(
    k.mark === 'quick' ? P(QUICK_MARK) : ONE,
    Math.max(500_000, ONE - P(haste)),
    (k.star ?? 0) >= 3 ? ONE - P(T['star.cd3']) : ONE,
  );
  return Math.max(5, mulP(nodeOf(k).cd, m));
}

/** ถนัดสาย: a skill of the hero's own line (shared or its unique) works at this power (tuning.ts `line.affinity`). */
export const affinityOf = (hero: string, id: string, v = '') =>
  inLine(hero, id) ? lineAffinity(hero) * (lvOf(v) >= 3 ? T['line.lv3'] : 1) : 1;
/** most dodge charges a hero can hold: +1 for the 💨 line */
export const dodgeCap = (hero: string, relics: readonly string[] = []) =>
  T['dodge.cap'] + (HEROES_BY_ID[hero]?.line === 'dodge' ? 1 : 0) + (relics.includes('featherstep') ? 1 : 0);
/** ★ on a Lv3 skill, ppm (the fight uses this; starPower is the same number for the UI) */
const starPowerP = (star = 0) => {
  const n = Math.max(0, Math.min(3, star));
  return ONE + P(T['star.pow']) * Math.min(2, n) + (n >= 3 ? P(T['star.pow3']) : 0);
};
/** ถนัดสาย, ppm */
const affinityP = (hero: string, id: string, v = '') =>
  inLine(hero, id) ? mulP(P(lineAffinity(hero)), lvOf(v) >= 3 ? P(T['line.lv3']) : ONE) : ONE;
/** ★ on a Lv3 skill: its numbers ×(1 + star.pow) per star */
export const starPower = (star = 0) => {
  const n = Math.max(0, Math.min(3, star));
  // sim v20: ★ and ★★ are small (+8% each), ★★★ is the spike (+12% more, and the echo)
  return 1 + T['star.pow'] * Math.min(2, n) + (n >= 3 ? T['star.pow3'] : 0);
};
/**
 * Power from the build's relics for one skill (sim v17): wanderer (off-line skills), twin line (the second line),
 * lone wolf (≤ 3 skills), sigil (marked skills).
 */
export function relicPower(b: Build, inst: SkillInstance): number {
  return relicPowerP(b, inst) / ONE;
}
/** relicPower in ppm (what the fight uses) */
function relicPowerP(b: Build, inst: SkillInstance): number {
  const rs = b.relics ?? [];
  if (!rs.length) return ONE;
  // ตราศักดิ์สิทธิ์ (sim v18): only the first SIGIL_MAX marked skills of the list
  let m = ONE;
  const line = SKILLS[inst.id]?.line;
  if (rs.includes('wanderer') && !inLine(b.hero, inst.id)) m = mulP(m, ONE + P(T['relic.wanderer']));
  if (rs.includes('twinline') && line && line === secondLine(b)) m = mulP(m, ONE + P(T['relic.twinline']));
  if (rs.includes('lonewolf') && b.skills.length <= 3) m = mulP(m, ONE + P(T['relic.lonewolf']));
  if (rs.includes('sigil') && inst.mark && b.skills.filter((k) => k.mark).slice(0, SIGIL_MAX).includes(inst)) m = mulP(m, ONE + P(T['relic.sigil']));
  return m;
}
/** the line (not the hero's own, not 'none') the build owns most skills of; ties: first in the list */
export function secondLine(b: Build): string | null {
  const main = HEROES_BY_ID[b.hero]?.line;
  const n: Record<string, number> = {};
  let best: string | null = null;
  for (const k of b.skills) {
    const l = SKILLS[k.id]?.line;
    if (!l || l === 'none' || l === main) continue;
    n[l] = (n[l] ?? 0) + 1;
    if (!best || n[l] > n[best]) best = l;
  }
  return best;
}

function makeBlocks(b: Build): Block[] {
  const skills = b.skills.filter((k) => SKILLS[k.id]);
  const act = activeBonuses(skills);
  const out: Block[] = [];
  b.skills.forEach((inst, idx) => {
    if (!SKILLS[inst.id]) return;
    const t = bonusTotals(skills, out.length, act);
    out.push({
      inst: { ...inst }, idx, cd0: 0, cd: mulP(cdTicks(inst, t.haste), (b.relics ?? []).includes('permafrost') ? ONE + P(T['relic.permafrostCd']) : ONE), prog: 0,
      power: mulAll(P(t.power), affinityP(b.hero, inst.id, inst.v), lvOf(inst.v) >= 3 ? starPowerP(inst.star) : ONE, relicPowerP(b, inst), inst.mark === 'steadfast' ? 1_250_000 : ONE),
      dmg: t.dmg, shieldOnFire: t.shield, triggers: t.triggers, // indexes into `skills` = into blocks
      adj: [], rr: 0, trigAt: 0, reacts: reacts(nodeOf(inst)), reactAt: 0,
    });
  });
  out.forEach((blk, i) => { blk.adj = [i - 1, i + 1].filter((j) => j >= 0 && j < out.length); blk.cd0 = blk.cd; });
  return out;
}

const emptyStat = (): BlockStat => ({ c: 0, tc: 0, d: 0, bd: 0, bf: 0, h: 0, sh: 0, fz: 0 });

function makeFighter(b: Build, side: Side, day: number): Fighter {
  const hooks = HEROES_BY_ID[b.hero]?.hooks ?? {};
  const relics = new Set((b.relics ?? []).filter((r) => typeof r === 'string'));
  let maxHp = hooks.maxHp ? hooks.maxHp(hpFor(day)) : hpFor(day);
  if (relics.has('ironhide')) maxHp = mulP(maxHp, ONE + P(T['relic.ironhide']));
  if (relics.has('glasscannon')) maxHp = Math.max(1, mulP(maxHp, P(T['relic.glassHp'])));
  const worthMul = hooks.worth ? P(hooks.worth()) : ONE;
  const rawWorth = worthOf(b.skills.filter((k) => SKILLS[k.id]));
  const start = (hooks.startShield ? hooks.startShield(0, maxHp) : 0) + (relics.has('bastion') ? mulP(maxHp, P(T['relic.bastion'])) : 0)
    + (relics.has('luckycoin') ? mulP(mulP(rawWorth, worthMul), P(T['relic.luckycoin'])) : 0);
  const blocks = makeBlocks(b);
  // early days only: a slow line's first cast comes by FIRST_CAST (fights on days 1–FIRST_CAST_DAYS are short)
  // sim v19: staggered by list order (3.5 s, 4 s, 4.5 s, 5 s …) so the line's first casts don't land as one volley with the ult
  if (day <= FIRST_CAST_DAYS) {
    let n = 0;
    for (const blk of blocks) if (inLine(b.hero, blk.inst.id)) blk.prog = Math.max(blk.prog, (blk.cd - Math.min(FIRST_CAST_MAX, FIRST_CAST + FIRST_CAST_STEP * n++)) * ONE);
  }
  if (relics.has('quickdraw')) for (const blk of blocks) blk.prog = Math.max(blk.prog, mulP(blk.cd, P(T['relic.quickdraw'])) * ONE);
  // a head start (sim v16, thornguard): the top skill of the list starts this share of its cooldown in
  if (hooks.headStart && blocks[0]) blocks[0].prog = mulP(blocks[0].cd, P(hooks.headStart())) * ONE;
  return {
    side, hero: b.hero, hooks, blocks, relics, worth: mulP(mulP(rawWorth, worthMul), relics.has('piggybank') ? ONE + P(T['relic.piggybank']) : ONE),
    hp: maxHp, maxHp, shield: start,
    frozen: 0, frozenTotal: 0, delayN: 0, slowP: 0, slowT: 0, slowTotal: 0, growth: [], charge: ONE, chargeIdx: -1, thorns: [],
    burns: [], poisons: [], dodge: 0, dodges: 0, hasteP: 0, hasteT: 0, woundP: 0, woundT: 0,
    ultLv: ultLevel(b), ultDone: false, shieldGot: 0, hitsTaken: 0, lineCasts: 0, ctlLanded: 0, bigHit: 0, ultUntil: 0,
    freezeN: 0, ctlKeep: ONE, ignoreFreeze: false, chargeHits: 0, leechNext: 0, thornsHeal: P(THORNS_HEAL), flags: {},
    stats: b.skills.map(emptyStat), dealtTotal: 0,
    immuneUntil: 0, pendingReact: [], lastFire: 0,
    side_: { casts: 0, never: [], fr: 0, dl: 0, sl: 0, ctl: 0, resisted: 0, ultLv: ultLevel(b), ult: -1, dodged: 0 },
  };
}

/**
 * opts.digest (tests only): called at the end of every tick with the full decision state as integers, so the Rust
 * engine can be compared tick by tick (layout: digestOf at the end of this file).
 */
export function simulate(
  a: Build, b: Build, seed: number, day = 1,
  opts: { trace?: boolean; /** simulator only: these sides fight with their ultimate locked */ noUlt?: [boolean, boolean]; digest?: (row: number[]) => void } = {},
): CombatResult {
  const rng = new Rng(seed);
  const F: [Fighter, Fighter] = [makeFighter(a, 0, day), makeFighter(b, 1, day)];
  for (const f of F) if (opts.noUlt?.[f.side]) f.ultLv = f.side_.ultLv = 0;
  const events: CombatEvent[] = [];
  let t = 0;

  const fx = (f: Fighter): Fx => ({
    g: rdiv(sum(f.growth), ONE),
    c: f.charge / ONE,
    th: sum(f.thorns),
    sf: f.ctlKeep < ONE ? 1 : 0,
    b: dps(f.burns),
    fr: f.frozen,
    sl: f.slowT > 0 ? rdiv(f.slowP * 100, ONE) : 0,
    slt: f.slowT,
    dg: f.dodge,
    p: dps(f.poisons),
    hs: f.hasteT > 0 ? rdiv(f.hasteP * 100, ONE) : 0,
    hst: f.hasteT,
  });
  const snap = (): Snap => ({ hp: [F[0].hp, F[1].hp], sh: [F[0].shield, F[1].shield], fx: [fx(F[0]), fx(F[1])] });
  const emit = (e: EventBody) => {
    events.push({ ...e, t, s: snap() } as CombatEvent);
  };
  const view = (x: Fighter): FighterView => ({
    hp: x.hp, maxHp: x.maxHp, shield: x.shield, frozen: x.frozen > 0, slowed: x.slowT > 0, hero: x.hero,
    thorns: sum(x.thorns), growthP: sum(x.growth), burnLeft: dotLeft(x.burns), burnStacks: x.burns.length,
    poisonLeft: dotLeft(x.poisons), dodge: x.dodge,
  });
  const hookApi = (f: Fighter): HookFighter => ({
    get hero() { return f.hero; },
    get hp() { return f.hp; },
    get maxHp() { return f.maxHp; },
    get shield() { return f.shield; },
    get foeSlowed() { return F[1 - f.side].slowT > 0; },
    get foeFrozen() { return F[1 - f.side].frozen > 0; },
    flags: f.flags,
    grow(n) { f.growth.push({ v: n * ONE, idx: -1 }); },
    thorns(n, permanent = false) {
      f.thorns.push({ v: n, idx: -1, ...(permanent ? {} : { until: t + THORNS_TICKS }) });
      emit({ type: 'status', side: f.side, status: 'thorns', value: sum(f.thorns) });
    },
    addShield(n) {
      f.shield += n;
      f.shieldGot += n;
      emit({ type: 'shield', side: f.side, amount: n });
    },
    status(kind: StatusKind, value: number) {
      emit({ type: 'status', side: f.side, status: kind, value });
    },
    dodge(n) {
      addDodge(f, n);
    },
    shedPoison() {
      if (!f.poisons.length) return;
      let k = 0;
      f.poisons.forEach((x, i) => { if (x.dps > f.poisons[k].dps) k = i; });
      f.poisons.splice(k, 1);
      emit({ type: 'status', side: f.side, status: 'cleanse', value: 1 });
    },
    poisonFoe(d, secs) {
      addPoison(F[1 - f.side], d, P(secs), -1);
    },
    woundFoe(pct, secs) {
      const foe = F[1 - f.side];
      if (foe.hp <= 0) return;
      // quiet: no status event for every hit (the wound chip is enough)
      const p = P(pct);
      foe.woundP = foe.woundT > 0 ? Math.max(foe.woundP, p) : p;
      foe.woundT = Math.max(foe.woundT, rdiv(P(secs) * TPS, ONE));
    },
  });
  const init = snap();
  let trace: CooldownTrace | undefined;
  if (opts.trace) {
    const n: [number, number] = [a.skills.length, b.skills.length];
    trace = {
      n,
      p: [new Uint8Array((MAX_TICKS + 1) * n[0]), new Uint8Array((MAX_TICKS + 1) * n[1])],
      fr: [new Uint8Array(MAX_TICKS + 1), new Uint8Array(MAX_TICKS + 1)],
    };
  }
  const record = () => {
    if (!trace) return;
    for (const f of F) {
      const n = trace.n[f.side];
      for (const blk of f.blocks) trace.p[f.side][t * n + blk.idx] = Math.min(255, rdiv(blk.prog * 255, blk.cd * ONE));
      trace.fr[f.side][t] = f.frozen > 0 ? 1 : 0;
    }
  };
  const first = rng.int(2); // who acts first on even ticks
  const fStart = fatigueStart(day);
  const fStep = fatigueStep(day);
  // ใจเหล็ก works from the start of the fight when the build owns a skill with it (sim v15: before, only after it fired)
  for (const f of F)
    for (const blk of f.blocks)
      for (const e of nodeOf(blk.inst).fx) if (e.k === 'steadfast') f.ctlKeep = Math.min(f.ctlKeep, P(e.keep ?? 0.4));
  const fCap = freezeCap(day);
  const sCap = rdiv(fCap * 7, 4); // 1.75 × the freeze cap
  for (const f of F) f.hooks.onStart?.(hookApi(f));

  /** owner = the attacker's block that gets credit (idx into its build.skills), -1 = none */
  /** shieldable: true / false, or the share of the hit (ppm) that shields can block */
  /** src = skill id for hits (for the UI), 'thorns' / 'burn' / … otherwise; kind = what dealt it (the rules use kind) */
  function deal(target: Fighter, amount: number, shieldable: boolean | number, src: string, kind: DamageKind, owner = -1, bonusPart = 0) {
    if (amount <= 0 || target.hp <= 0) return;
    if (kind !== 'fatigue') F[1 - target.side].dealtTotal += amount;
    let blocked = 0;
    const share = shieldable === true ? ONE : shieldable === false ? 0 : shieldable;
    if (share > 0 && target.shield > 0) {
      blocked = Math.min(target.shield, mulP(amount, share));
      target.shield -= blocked;
    }
    target.hp -= amount - blocked;
    // โล่หนาม: part of what the shield blocked goes back to the attacker (not from DoTs, thorns or fatigue)
    if (blocked > 0 && target.relics.has('spikedshield') && !NO_REFLECT.has(kind)) {
      const back = mulP(blocked, P(T['relic.spikedshield']));
      if (back > 0) deal(F[1 - target.side], back, true, 'thorns', 'thorns');
    }
    const st = F[1 - target.side].stats[owner];
    if (st) {
      st.d += amount;
      st.bd += Math.min(amount, bonusPart);
    }
    // นักรบคลั่ง's ultimate: a killing blow leaves 1 HP instead (once per fight)
    const undying = target.hp <= 0 && target.hero === 'berserker' && target.ultLv > 0 && !target.ultDone;
    if (undying) target.hp = 1;
    emit({ type: 'damage', side: target.side, amount: amount - blocked, blocked, src, kind });
    if (undying) fireUlt(target);
    target.hooks.onDamaged?.(hookApi(target), amount - blocked, kind);
  }

  /** ไฟ/พิษละลายโล่: a burning or poisoned fighter gains less shield (tuning.ts `burn.shield`) */
  const meltShield = (f: Fighter, n: number) => ((f.burns.length || f.poisons.length) && n > 0 ? Math.max(1, mulP(n, P(T['burn.shield']))) : n);
  /** secsP = seconds in ppm */
  function addBurn(foe: Fighter, d: number, secsP: number, idx: number) {
    foe.burns.push({ dps: d, t: rdiv(secsP * TPS, ONE), idx });
    emit({ type: 'status', side: foe.side, status: 'burn', value: dps(foe.burns) });
  }
  /** secsP = seconds in ppm */
  function addPoison(foe: Fighter, d: number, secsP: number, idx: number) {
    if (foe.hp <= 0) return;
    foe.poisons.push({ dps: d, t: rdiv(secsP * TPS, ONE), idx });
    emit({ type: 'status', side: foe.side, status: 'poison', value: dps(foe.poisons) });
  }
  function addDodge(f: Fighter, n: number) {
    f.dodge = Math.min(dodgeCap(f.hero, [...f.relics]), f.dodge + n);
    emit({ type: 'status', side: f.side, status: 'dodge', value: f.dodge });
  }
  /** pctP = share in ppm, secsP = seconds in ppm */
  function addHaste(f: Fighter, pctP: number, secsP: number) {
    if (f.relics.has('tailspin')) [pctP, secsP] = [pctP + 100_000, secsP + P(T['relic.tailspin'])];
    f.hasteP = Math.min(P(T['haste.cap']), f.hasteT > 0 ? Math.max(f.hasteP, pctP) : pctP);
    f.hasteT = Math.max(f.hasteT, rdiv(secsP * TPS, ONE));
    emit({ type: 'status', side: f.side, status: 'haste', value: rdiv(f.hasteP * 100, ONE) });
  }
  /** pctP = share in ppm, secsP = seconds in ppm */
  function addWound(foe: Fighter, pctP: number, secsP: number) {
    foe.woundP = foe.woundT > 0 ? Math.max(foe.woundP, pctP) : pctP;
    foe.woundT = Math.max(foe.woundT, rdiv(secsP * TPS, ONE));
    emit({ type: 'status', side: foe.side, status: 'wound', value: rdiv(foe.woundP * 100, ONE) });
  }
  /** remove up to n burn / poison stacks, strongest first (burn wins ties) */
  function removeDots(f: Fighter, n: number) {
    let removed = 0;
    for (let r = 0; r < n && (f.burns.length || f.poisons.length); r++) {
      const all = [...f.burns.map((x) => ({ x, list: f.burns })), ...f.poisons.map((x) => ({ x, list: f.poisons }))];
      let k = 0;
      all.forEach((y, i) => { if (y.x.dps > all[k].x.dps) k = i; });
      const { x, list } = all[k];
      list.splice(list.indexOf(x), 1);
      removed++;
    }
    return removed;
  }

  /** damage multiplier of f's relics on one of its hits (sim v17), ppm */
  function relicHit(f: Fighter, foe: Fighter) {
    let m = ONE;
    if (f.relics.has('executioner') && foe.hp * 10 < foe.maxHp * 4) m = mulP(m, ONE + P(T['relic.executioner']));
    if (f.relics.has('rot') && foe.poisons.length) m = mulP(m, ONE + P(T['relic.rot']));
    if (f.relics.has('brittle') && foe.frozen > 0) m = mulP(m, ONE + P(T['relic.brittle']));
    // ปืนแก้ว: its extra is added in hit() with a per-hit cap (glassCap × the enemy's max HP)
    if (f.relics.has('counterstep') && f.flags.counter) {
      m = mulP(m, ONE + P(T['relic.counterstep']));
      f.flags.counter = 0;
    }
    return m;
  }

  // ---------------- ultimates ----------------
  /** most damage one damage ultimate can deal: a share of the enemy's max HP (Lv2 × ULT_LV2_POW) */
  /** ×ONE (ppm of an HP point), so a cap compares exactly with pow × amount */
  const ultCapP = (f: Fighter, foe: Fighter) => mulP(foe.maxHp * P(T['ult.cap']), f.ultLv >= 2 ? P(ULT_LV2_POW) : ONE);
  /** Fire f's ultimate now (its trigger was met). */
  function fireUlt(f: Fighter) {
    const foe = F[1 - f.side];
    f.ultDone = true;
    f.side_.ult = t;
    emit({ type: 'ult', side: f.side, hero: f.hero, lv: f.ultLv });
    /** ultimate power, ppm (data: hero × level) */
    const pow = P(ultPow(f.hero, f.ultLv));
    switch (f.hero) {
      case 'assassin': {
        // sim v15: hits harder the more HP the enemy is missing (a finisher), ignores shields; a dodge charge halves it
        let nP = Math.min(pow * (foe.maxHp - foe.hp), ultCapP(f, foe));
        if (foe.dodge > 0) {
          foe.dodge--;
          foe.dodges++;
          foe.side_.dodged = (foe.side_.dodged ?? 0) + 1;
          emit({ type: 'status', side: foe.side, status: 'evade', value: foe.dodge });
          nP = Math.floor(nP / 2);
        }
        deal(foe, Math.max(1, rdiv(nP, ONE)), false, 'ult', 'ult');
        break;
      }
      case 'duelist':
        addHaste(f, pow, 3 * ONE);
        addDodge(f, 2);
        break;
      case 'knight':
        // sim v18: shield plus a share of max HP (late shields are small next to late HP, so Lv2 did almost nothing)
        // pow × (shield + share × maxHp): ppm × ppm, so compare and round at ONE²
        const raw = pow * (f.shield * ONE + f.maxHp * P(T['ult.knight.hp']));
        deal(foe, Math.max(1, rdiv(Math.min(raw, ultCapP(f, foe) * ONE), ONE * ONE)), true, 'ult', 'ult');
        break;
      case 'berserker': {
        const h = Math.min(f.maxHp - f.hp, mulP(f.maxHp, pow));
        if (h > 0) {
          f.hp += h;
          emit({ type: 'heal', side: f.side, amount: h });
        }
        // sim v19: a bigger payoff (+power for the rest of the fight scales with the day's HP)
        const g = Math.max(2, mulP(mulP(f.maxHp, P(T['ult.berserker.grow'])), f.ultLv >= 2 ? 1_500_000 : ONE));
        f.growth.push({ v: g * ONE, idx: -1 });
        emit({ type: 'status', side: f.side, status: 'grow', value: rdiv(sum(f.growth), ONE) });
        break;
      }
      case 'pyro': {
        // a share (pow) of the burn still to come lands now as one blast; the burns keep burning (sim v14: before, they were used up)
        const left = dotLeft(foe.burns);
        deal(foe, Math.max(1, mulP(left, pow)), false, 'ult', 'ult');
        break;
      }
      case 'thornguard':
        f.ultUntil = t + rdiv(pow * TPS, ONE);
        addWound(foe, ONE, pow);
        // sim v16: it also poisons at once (it used to need hits on you, so a burn build that rarely hits shrugged it off)
        addPoison(foe, T['ult.thornguard.poison'], pow, -1);
        break;
      case 'witch': {
        // no diminishing returns and no immunity window, but still under the control cap (and ใจเหล็ก)
        let ticks = rdiv(mulP(pow * TPS, foe.ctlKeep), ONE);
        ticks = Math.max(0, Math.min(ticks, ctlRoom(foe) + foe.frozen));
        if (ticks > foe.frozen) {
          foe.frozenTotal += ticks - foe.frozen;
          foe.frozen = ticks;
          emit({ type: 'status', side: foe.side, status: 'freeze', value: ticks });
          if (ticks >= REACT_MIN) controlled(foe);
        } else {
          foe.side_.resisted++;
          emit({ type: 'status', side: foe.side, status: 'freeze', value: 0 });
        }
        const m = f.ultLv >= 2 ? 2_400_000 : 2_000_000;
        if (m >= f.charge) {
          f.charge = m;
          f.chargeIdx = -1;
          f.chargeHits = 1;
        }
        emit({ type: 'status', side: f.side, status: 'charge', value: m / ONE });
        break;
      }
      case 'luckycat': {
        // sim v21: a hit worth the build (capped), half of it back as a shield
        const n = Math.max(1, rdiv(Math.min(pow * f.worth, ultCapP(f, foe)), ONE));
        deal(foe, n, true, 'ult', 'ult');
        const sh = meltShield(f, rdiv(n, 2));
        if (sh > 0) {
          f.shield += sh;
          f.shieldGot += sh;
          emit({ type: 'shield', side: f.side, amount: sh });
        }
        break;
      }
      case 'sage': {
        // sim v21: time rewinds the wounds (every burn / poison on you goes), then every skill fires once at pow power
        const n = removeDots(f, 99);
        if (n) emit({ type: 'status', side: f.side, status: 'cleanse', value: n });
        for (let bi = 0; bi < f.blocks.length && foe.hp > 0 && f.hp > 0; bi++) fireOne(f, { bi, depth: MAX_CHAIN, mult: pow });
        break;
      }
      case 'chrono': {
        // sim v15: every cooldown jumps forward by pow of its length (was: all ready at once), then cleanse all
        for (const b of f.blocks) b.prog = Math.min(b.cd * ONE, b.prog + mulP(b.cd, pow) * ONE);
        let n = removeDots(f, 99);
        if (f.slowT > 0) { f.slowT = 0; f.slowP = 0; n++; }
        if (f.frozen > 0) { f.frozen = 0; f.immuneUntil = t + CTL_IMMUNE; n++; }
        if (f.woundT > 0) { f.woundT = 0; n++; }
        emit({ type: 'status', side: f.side, status: 'cleanse', value: n });
        break;
      }
    }
  }
  /** Has f's trigger been met? (นักรบคลั่ง's also fires inside deal on a killing blow) */
  function ultReady(f: Fighter): boolean {
    if (f.ultLv <= 0 || f.ultDone || f.hp <= 0) return false;
    const foe = F[1 - f.side];
    if (foe.hp <= 0) return false;
    const need = ultTrig(f.hero, f.ultLv);
    /** HP-share triggers, ppm (data) */
    const needP = P(need);
    switch (f.hero) {
      case 'assassin': return f.bigHit > 0 && foe.hp * ONE < foe.maxHp * needP;
      case 'duelist': return f.dodges >= need;
      case 'knight': return f.shieldGot * ONE >= f.maxHp * needP && f.shield > 0;
      case 'berserker': return f.hp * ONE < f.maxHp * needP;
      case 'pyro': return foe.burns.length >= need;
      case 'thornguard': return f.hitsTaken >= need;
      case 'witch': return f.lineCasts >= need;
      case 'chrono': return f.ctlLanded >= need;
      case 'luckycat': return f.lineCasts >= need;
      case 'sage': return t >= need * TPS;
      default: return false;
    }
  }
  function ultCheck() {
    // sim v19: no ultimate before ULT_MIN_T (it landed in the same second as the first casts: one-volley fights)
    if (t < ULT_MIN_T) return;
    for (const f of F) if (ultReady(f)) fireUlt(f);
  }

  /** power = cast power (connect bonus × echo); bonusDmg = + damage per hit from connect bonuses */
  /** control lands on foe: queue its ✨/🗿 reactions */
  function controlled(foe: Fighter) {
    for (let bi = 0; bi < foe.blocks.length; bi++) {
      const b = foe.blocks[bi];
      if (b.reacts && t >= b.reactAt && !foe.pendingReact.includes(bi)) foe.pendingReact.push(bi);
    }
  }
  /** freeze / delay ticks that can still land on this fighter now (their shared cap) */
  const ctlRoom = (x: Fighter) => Math.min(fCap, Math.floor(Math.max(t, CTL_MIN_T) / 4)) - x.frozenTotal; // CTL_SHARE = 1/4
  /** can freeze / delay land on this fighter now? (counts a resist when not) */
  const shaking = (x: Fighter) => t - x.lastFire >= SHAKE_OFF;
  function canControl(foe: Fighter) {
    if (foe.frozen > 0 || t < foe.immuneUntil || shaking(foe)) {
      foe.side_.resisted++;
      return false;
    }
    return true;
  }

  function runSkill(f: Fighter, foe: Fighter, blk: Block, power: number, bonusDmg: number) {
    const inst = blk.inst;
    const st = f.stats[blk.idx];
    /** fires below full power (engines, echo) also carry less control (ppm) */
    const ctl = Math.min(ONE, power);
    const thornsUntil = () => t + (f.hooks.thornsSecs ? f.hooks.thornsSecs * TPS : THORNS_TICKS);
    const ctx: Ctx = {
      inLine: inLine(f.hero, inst.id),
      power,
      // ⏳ seconds so far in ppm: t / TPS × sundial, capped
      secsP: Math.min(TIME_CAP_S * ONE, mulP(t * (ONE / TPS), f.relics.has('sundial') ? ONE + P(T['relic.sundial']) : ONE)),
      worth: f.worth,
      accel(pct, min) {
        blk.cd = Math.max(mulP(blk.cd0, P(min)), blk.cd - mulP(blk.cd0, P(pct)));
      },
      v: (n) => Math.max(1, rdiv(P(n) * power, ONE * ONE)),
      vP: (nP) => Math.max(1, rdiv(nP * power, ONE * ONE)),
      get me() { return view(f); },
      get foe() { return view(foe); },
      hit(n, o = {}) {
        if (foe.hp <= 0 || f.hp <= 0) return 0;
        // a charge waits for a real hit: hits below charge.min (before power and charge) don't use it up
        const useCharge = f.charge > ONE && n + bonusDmg >= T['charge.min'];
        const mult = useCharge ? f.charge : ONE;
        // growth is ppm: (n + growth + bonus) x charge, both ppm, so round once at ONE squared
        let dmg = rdiv(((n + bonusDmg) * ONE + sum(f.growth)) * mult, ONE * ONE);
        if (f.hooks.onHit) dmg = Math.max(0, f.hooks.onHit(hookApi(f), dmg));
        if (f.relics.size) dmg = mulP(dmg, relicHit(f, foe));
        if (f.relics.has('glasscannon')) dmg = Math.min(mulP(dmg, ONE + P(T['relic.glassDmg'])), Math.max(dmg, dmg + mulP(foe.maxHp, P(T['relic.glassCap']))));
        if (!o.sure && foe.dodge > 0) {
          // dodged: the whole hit misses (a charge is spent on it too), no thorns, no leech
          if (!useCharge) { /* the charge waits */ } else if (f.chargeHits > 1) f.chargeHits--;
          else {
            f.charge = ONE;
            f.chargeIdx = -1;
            f.chargeHits = 0;
          }
          foe.dodge--;
          foe.dodges++;
          foe.side_.dodged = (foe.side_.dodged ?? 0) + 1;
          emit({ type: 'status', side: foe.side, status: 'evade', value: foe.dodge });
          foe.hooks.onDodge?.(hookApi(foe));
          if (foe.relics.has('counterstep')) foe.flags.counter = 1;
          // a dodge is a graze, not a wall: a share of the hit still lands (no riders, no thorns, no leech)
          // sim v16: a slowed enemy dodges the wind badly (จอมเวทลม: more of the hit still lands)
          const graze = mulP(dmg, P(f.hero === 'chrono' && foe.slowT > 0 ? T['chrono.graze'] : T['dodge.graze']));
          if (graze > 0) deal(foe, graze, ONE - P(o.pierce ?? 0), inst.id, 'hit', blk.idx);
          return -1;
        }
        if (o.sure && foe.dodge > 0) emit({ type: 'status', side: foe.side, status: 'sure', value: foe.dodge });
        f.bigHit = Math.max(f.bigHit, dmg);
        foe.hitsTaken++;
        f.hooks.onLanded?.(hookApi(f));
        // stats only (result screen; never decides the fight): credit for connect bonuses and buffs
        const m = mult / ONE;
        const fromPower = blk.power > ONE ? n - (n * ONE) / blk.power : 0;
        const bonusPart = Math.round((bonusDmg + fromPower) * m);
        for (const g of f.growth) if (f.stats[g.idx]) f.stats[g.idx].bf += Math.round((g.v / ONE) * m);
        if (mult > ONE && f.stats[f.chargeIdx]) f.stats[f.chargeIdx].bf += dmg - Math.round(dmg / m);
        if (!useCharge) { /* the charge waits */ } else if (f.chargeHits > 1) f.chargeHits--;
        else {
          f.charge = ONE;
          f.chargeIdx = -1;
          f.chargeHits = 0;
        }
        const pierce = P(o.pierce ?? 0);
        // ตั้งรับ: a fighter behind a shield takes less from a direct hit that doesn't fully pierce (🛡 > ⚔)
        if (foe.shield > 0 && pierce < ONE) dmg = Math.max(1, mulP(dmg, ONE - P(T['shield.guard'])));
        const hpBefore = foe.hp;
        deal(foe, dmg, ONE - pierce, inst.id, 'hit', blk.idx, bonusPart);
        const dealt = Math.max(0, hpBefore - Math.max(0, foe.hp));
        const leech = P(o.leech ?? 0) + f.leechNext;
        f.leechNext = 0;
        if (leech > 0 && dealt > 0) ctx.heal(Math.max(1, mulP(dealt, leech)));
        // thorns reflect at most THORNS_MAX of the hit (hooks can change it, e.g. a thorns hero reflects more)
        let th = Math.min(sum(foe.thorns), ceilDiv(dmg * 3, 4)); // THORNS_MAX = 3/4
        if (foe.hooks.thornsReflect) th = foe.hooks.thornsReflect(th, sum(foe.thorns), dmg);
        if (th > 0 && f.hp > 0) deal(f, th, true, 'thorns', 'thorns', foe.thorns[0]?.idx ?? -1);
        // นักรบหนาม's ultimate: poison thorns
        if (foe.ultUntil > t && f.hp > 0) for (let i = 0; i < 2; i++) addPoison(f, 1, 4 * ONE, -1);
        return dealt;
      },
      spendShield(n) {
        f.shield = Math.max(0, f.shield - n);
      },
      shield(n) {
        n = meltShield(f, n);
        f.shield += n;
        f.shieldGot += n;
        st.sh += n;
        emit({ type: 'shield', side: f.side, amount: n });
      },
      heal(n) {
        // the enemy's thorns, poison on you and wounds all cut healing
        let m = f.relics.has('vitality') ? ONE + P(T['relic.vitality']) : ONE;
        if (foe.thorns.length) m = mulP(m, foe.thornsHeal);
        if (f.poisons.length) m = mulP(m, P(T['poison.heal']));
        if (f.woundT > 0) m = mulP(m, ONE - f.woundP);
        if (m !== ONE) n = m > 0 ? Math.max(1, mulP(n, m)) : 0;
        const h = Math.min(n, f.maxHp - f.hp);
        if (h > 0) {
          f.hp += h;
          st.h += h;
          emit({ type: 'heal', side: f.side, amount: h });
        }
        // ถ้วยล้น: healing past full HP becomes shield
        const over = mulP(n - Math.max(0, h), P(T['relic.overflow']));
        if (over > 0 && f.relics.has('overflow')) ctx.shield(over);
      },
      burn(d, secs) {
        const s2 = P(secs) + (f.relics.has('kindling') ? P(T['relic.kindling']) : 0);
        addBurn(foe, d, f.hooks.burnSecs ? f.hooks.burnSecs(s2) : s2, blk.idx);
      },
      poison(d, secs) { addPoison(foe, d + (f.relics.has('virulence') ? T['relic.virulence'] : 0), P(secs), blk.idx); },
      dodge(n) { addDodge(f, n); },
      haste(pct, secs) { addHaste(f, mulP(P(pct), Math.min(ONE, power)), P(secs)); },
      wound(pct, secs) { addWound(foe, P(pct), mulP(P(secs), ctl)); },

      freeze(secs) {
        if (!canControl(foe)) {
          emit({ type: 'status', side: foe.side, status: 'freeze', value: 0 });
          return;
        }
        if (foe.ignoreFreeze) {
          foe.ignoreFreeze = false;
          foe.side_.resisted++;
          emit({ type: 'status', side: foe.side, status: 'freeze', value: 0 });
          return;
        }
        let tP = mulP((P(secs) + (f.relics.has('permafrost') ? P(T['relic.permafrost']) : 0)) * TPS, ctl); // ppm ticks
        if (f.hooks.freezeTicks) tP = f.hooks.freezeTicks(tP);
        tP = mulP(mulP(tP, drOf(foe.freezeN)), foe.ctlKeep); // diminishing returns (recovers over time), ใจเหล็ก
        const ticks = Math.max(0, Math.min(MAX_FREEZE_TICKS, ctlRoom(foe), rdiv(tP, ONE)));
        foe.freezeN++;
        if (ticks <= 0) foe.side_.resisted++;
        if (ticks > foe.frozen) {
          foe.frozenTotal += ticks - foe.frozen;
          st.fz += ticks - foe.frozen;
          foe.frozen = ticks;
        }
        emit({ type: 'status', side: foe.side, status: 'freeze', value: ticks });
        if (ticks >= REACT_MIN) controlled(foe);
      },
      slow(pct0, secs0) {
        let p0 = P(pct0);
        let s0 = P(secs0);
        if (f.relics.has('gale')) [p0, s0] = [p0 + P(T['relic.gale']), s0 + ONE];
        const s1 = mulP(s0, ctl);
        const [pct, secs] = f.hooks.slow ? f.hooks.slow(p0, s1) : [p0, s1]; // ppm share, ppm seconds
        const p = Math.min(SLOW_CAP_P, mulP(pct, foe.ctlKeep));
        foe.slowP = foe.slowT > 0 ? Math.max(foe.slowP, p) : p;
        // total slowed time has its own cap (1.75 × the freeze cap), which also grows with the fight (2 × CTL_SHARE = 1/2)
        const room = shaking(foe) ? 0 : Math.max(0, Math.min(sCap, Math.floor(Math.max(t, CTL_MIN_T) / 2)) - foe.slowTotal - foe.slowT);
        // a fractional duration lasts until its last partial tick: ceil (v21 kept a fractional slowT, which also ran on)
        const add = Math.min(room, Math.max(0, ceilDiv(secs * TPS, ONE) - foe.slowT));
        if (add <= 0 && foe.slowT <= 0) {
          foe.side_.resisted++;
          emit({ type: 'status', side: foe.side, status: 'slow', value: 0 });
          return;
        }
        foe.slowT += add;
        if (add > 0) f.ctlLanded++;
        emit({ type: 'status', side: foe.side, status: 'slow', value: rdiv(p * 100, ONE) });
        if (add >= REACT_MIN && p >= 300_000) controlled(foe);
      },
      delay(secs) {
        // cast delay: every enemy cooldown goes back. Diminishes with repeated use and shares the control cap with freeze.
        if (!canControl(foe)) {
          emit({ type: 'status', side: foe.side, status: 'delay', value: 0 });
          return;
        }
        const tP = mulP(mulP(mulP(P(secs) * TPS, ctl), drOf(foe.delayN)), foe.ctlKeep);
        const ticks = Math.max(0, Math.min(ctlRoom(foe), rdiv(tP, ONE)));
        foe.delayN++;
        if (ticks > 0) {
          foe.frozenTotal += ticks;
          foe.side_.dl += ticks;
          st.fz += ticks;
          for (const b of foe.blocks) b.prog = Math.max(0, b.prog - ticks * ONE);
          foe.immuneUntil = t + CTL_IMMUNE;
          f.ctlLanded++;
        } else foe.side_.resisted++;
        emit({ type: 'status', side: foe.side, status: 'delay', value: ticks });
        if (ticks >= REACT_MIN) controlled(foe);
      },
      growP(nP) {
        f.growth.push({ v: nP, idx: blk.idx });
        emit({ type: 'status', side: f.side, status: 'grow', value: rdiv(sum(f.growth), ONE) });
      },
      charge(m, hits) {
        const mult = f.hooks.chargeMult ? f.hooks.chargeMult(P(m)) : P(m);
        if (mult >= f.charge) {
          f.charge = mult;
          f.chargeIdx = blk.idx;
          f.chargeHits = Math.max(1, hits);
        }
        emit({ type: 'status', side: f.side, status: 'charge', value: mult / ONE });
      },
      thorns(n, perm, heal) {
        f.thorns.push({ v: n, idx: blk.idx, ...(perm ? {} : { until: thornsUntil() }) });
        if (heal !== undefined) f.thornsHeal = Math.min(f.thornsHeal, P(heal));
        emit({ type: 'status', side: f.side, status: 'thorns', value: sum(f.thorns) });
      },
      steadfast(keep, ignoreFreeze) {
        f.ctlKeep = Math.min(f.ctlKeep, P(keep));
        if (ignoreFreeze) f.ignoreFreeze = true;
        // a freeze already on you is shortened too
        if (f.frozen > 0) f.frozen = Math.max(1, mulP(f.frozen, P(keep)));
        emit({ type: 'status', side: f.side, status: 'steadfast', value: 1 });
      },
      cleanse(stacks, dotOnly) {
        // the strongest burn / poison stacks, then slow, freeze and wounds (sim v20: at most CLEANSE_MAX stacks a cast,
        // one feast cleansed 10 burns)
        let n = removeDots(f, Math.min(stacks, CLEANSE_MAX));
        if (dotOnly) {
          emit({ type: 'status', side: f.side, status: 'cleanse', value: n });
          return n;
        }
        if (f.woundT > 0) { f.woundT = 0; f.woundP = 0; n++; }
        if (f.slowT > 0) { f.slowT = 0; f.slowP = 0; n++; }
        if (f.frozen > 0) { f.frozen = 0; f.immuneUntil = t + CTL_IMMUNE; n++; }
        emit({ type: 'status', side: f.side, status: 'cleanse', value: n });
        return n;
      },
      dispel(times, shieldShare, steal) {
        let n = 0;
        for (let r = 0; r < times; r++) {
          let any = false;
          if (foe.growth.length) {
            // พลัง is only halved (the latest stack), so scaling builds are slowed, not erased
            const g = foe.growth.pop()!;
            // half the stack, in whole points (as v21: floor of the half)
            const keep = Math.floor(g.v / (2 * ONE)) * ONE;
            if (keep > 0) foe.growth.push({ ...g, v: keep });
            if (steal) f.growth.push({ v: g.v - keep, idx: blk.idx });
            n++;
            any = true;
          }
          if (foe.thorns.length) {
            // a thorns hero keeps half of the removed stack
            const x = foe.thorns.pop()!;
            if (foe.hooks.thornsSecs && x.v >= 2) foe.thorns.push({ ...x, v: Math.floor(x.v / 2) });
            n++;
            any = true;
          }
          if (foe.charge > ONE) { foe.charge = ONE; foe.chargeIdx = -1; foe.chargeHits = 0; n++; any = true; }
          if (foe.ctlKeep < ONE) { foe.ctlKeep = ONE; foe.ignoreFreeze = false; n++; any = true; }
          if (!any) break;
        }
        // shields are a buff too: strip part of them
        const cut = Math.floor((foe.shield * P(shieldShare)) / ONE);
        if (cut > 0) { foe.shield -= cut; n++; }
        emit({ type: 'status', side: foe.side, status: 'dispel', value: n });
        return n;
      },
      leech(pct) {
        f.leechNext = Math.max(f.leechNext, P(pct));
      },
    };
    execNode(nodeOf(inst), ctx);
  }

  interface Fire {
    bi: number;
    depth: number;
    /** block that set this one off */
    from?: number;
    /** power of this fire, ppm (engines fire at less than full power) */
    mult: number;
    /** เร่งเครื่อง: the fired block's cooldown restarts */
    restart?: boolean;
    react?: boolean;
  }

  /** Fires one skill (plus its mark effects and shield-on-fire bonus). Returns the follow-up fires (trigger bonuses + engines). */
  function fireOne(f: Fighter, q: Fire): Fire[] {
    const foe = F[1 - f.side];
    const blk = f.blocks[q.bi];
    const inst = blk.inst;
    const st = f.stats[blk.idx];
    // หินลับมีด: the first cast of each skill in the fight is stronger
    const firstCast = st.c + st.tc === 0 && f.relics.has('whetstone');
    if (q.from === undefined) st.c++;
    else {
      st.tc++;
      const byEngine = !!nodeOf(f.blocks[q.from].inst).engine;
      blk.trigAt = t + Math.min(TRIGGER_GAP_MAX, Math.max(byEngine ? ENGINE_GAP : TRIGGER_GAP, blk.cd));
      if (q.restart) blk.prog = 0;
    }
    f.side_.casts++;
    f.lastFire = t;
    if (SKILLS[inst.id].line === HEROES_BY_ID[f.hero]?.line) f.lineCasts++;
    emit({
      type: 'cast', side: f.side, skill: inst.id, lv: lvOf(inst.v), idx: blk.idx,
      ...(rarityOf(inst.id, inst.v) === 'epic' ? { epic: true } : {}),
      ...(q.from !== undefined ? { from: f.blocks[q.from].idx } : {}),
      ...(q.react ? { react: true } : {}),
    });
    const power = mulAll(blk.power, q.mult, firstCast ? ONE + P(T['relic.whetstone']) : ONE);
    const dealtBefore = f.dealtTotal;
    runSkill(f, foe, blk, power, mulP(blk.dmg, q.mult));
    if (blk.shieldOnFire > 0 && f.hp > 0) {
      const n = meltShield(f, Math.max(1, mulP(blk.shieldOnFire, q.mult)));
      f.shield += n;
      f.shieldGot += n;
      st.sh += n;
      emit({ type: 'shield', side: f.side, amount: n });
    }
    if (inst.mark === 'echo' && foe.hp > 0 && f.hp > 0) {
      emit({ type: 'cast', side: f.side, skill: inst.id, lv: lvOf(inst.v), idx: blk.idx, echo: true });
      runSkill(f, foe, blk, rdiv(power, 2), mulP(blk.dmg, rdiv(q.mult, 2)));
    }
    // sim v20: only the skill's own casts (an engine or a trigger setting it off does not burn again)
    if (inst.mark === 'burn' && foe.hp > 0 && q.from === undefined) addBurn(foe, 1 + Math.floor(day / 3), 4 * ONE, blk.idx);
    // ★★★ signature (sim v18): every cast echoes once more at star.echo power
    if ((inst.star ?? 0) >= 3 && lvOf(inst.v) >= 3 && foe.hp > 0 && f.hp > 0) {
      // sim v19: a true share of the damage the cast dealt (no rounding up, no DoT / buff / cleanse repeat)
      const extra = Math.floor(((f.dealtTotal - dealtBefore) * P(T['star.echo'])) / ONE);
      if (extra > 0) {
        emit({ type: 'cast', side: f.side, skill: inst.id, lv: lvOf(inst.v), idx: blk.idx, echo: true, star3: true });
        deal(foe, extra, true, inst.id, 'hit', blk.idx);
      }
    }

    // trigger bonuses fire at the same power, but deeper chain steps get weaker
    const tm = q.depth >= 1 ? mulP(q.mult, P(T.chainDecay)) : q.mult;
    const next: Fire[] = blk.triggers.map((bi) => ({ bi, depth: q.depth + 1, from: q.bi, mult: tm }));
    const en = nodeOf(inst).engine;
    // engine power: the engine's own power bonus counts, but a chain never fires above the engine's power
    const ep = en ? mulAll(P(en.power), blk.power, Math.min(ONE, q.mult)) : 0;
    if (en?.kind === 'gear' && blk.adj.length) {
      for (let i = 0; i < Math.min(en.n ?? 1, blk.adj.length); i++)
        next.push({ bi: blk.adj[blk.rr++ % blk.adj.length], depth: q.depth + 1, from: q.bi, mult: ep });
    } else if (en?.kind === 'overclock') {
      for (const bi of blk.adj) next.push({ bi, depth: q.depth + 1, from: q.bi, mult: ep, restart: !en.keep });
    }
    return next;
  }

  /**
   * Fire a skill, then everything it sets off (breadth-first). Each skill fires at most once per chain, and a skill
   * set off by another one cannot be set off again for TRIGGER_GAP ticks.
   */
  function fire(f: Fighter, start: number, react = false) {
    const seen = new Set<number>([start]);
    const queue: Fire[] = [{ bi: start, depth: 0, mult: ONE, react }];
    while (queue.length) {
      const q = queue.shift()!;
      if (f.hp <= 0 || F[1 - f.side].hp <= 0) return;
      const next = fireOne(f, q);
      if (q.depth >= MAX_CHAIN) continue;
      for (const n of next) {
        if (seen.has(n.bi) || t < f.blocks[n.bi].trigAt) continue;
        seen.add(n.bi);
        queue.push(n);
      }
    }
  }

  /** ✨/🗿 skills that were queued by control on f fire now (their cooldown restarts). */
  function reactAll(f: Fighter) {
    while (f.pendingReact.length) {
      const bi = f.pendingReact.shift()!;
      const blk = f.blocks[bi];
      if (f.hp <= 0 || F[1 - f.side].hp <= 0 || t < blk.reactAt) continue;
      blk.reactAt = t + blk.cd;
      blk.prog = 0;
      fire(f, bi, true);
    }
  }

  function act(f: Fighter) {
    if (f.hp <= 0 || f.blocks.length === 0) return;
    if (shaking(f) && (f.frozen > 0 || f.slowT > 0)) {
      // too long without a single skill: shake off all control
      f.frozen = 0;
      f.slowT = 0;
      f.slowP = 0;
      emit({ type: 'status', side: f.side, status: 'shake', value: 1 });
    }
    const frozen = f.frozen > 0;
    if (frozen) {
      f.frozen--;
      f.side_.fr++;
      if (f.frozen === 0) f.immuneUntil = t + CTL_IMMUNE;
    }
    // cooldown progress this tick, ppm ticks: (1 − slow) × (1 + haste)
    const rate = mulP(f.slowT > 0 ? ONE - f.slowP : ONE, f.hasteT > 0 ? ONE + f.hasteP : ONE);
    if (f.slowT > 0) f.side_.ctl += f.slowP / ONE; // stats only
    const ready: number[] = [];
    f.blocks.forEach((blk, bi) => {
      if (frozen && blk.inst.mark !== 'steadfast') return; // steadfast mark: keeps counting while frozen
      blk.prog += rate;
      if (blk.prog >= blk.cd * ONE) {
        blk.prog -= blk.cd * ONE;
        ready.push(bi);
      }
    });
    for (const bi of ready) fire(f, bi);
  }

  let winner: Side | -1 = -1;
  let decided = false;
  for (t = 1; t <= MAX_TICKS; t++) {
    const order: Side[] = (t + first) % 2 === 0 ? [0, 1] : [1, 0];
    for (const s of order) {
      act(F[s]);
      reactAll(F[1 - s]);
      reactAll(F[s]);
      ultCheck();
    }
    record();
    for (const f of F) {
      if (f.slowT > 0) {
        f.slowT--;
        f.slowTotal++;
        f.side_.sl++;
      }
      if (f.hasteT > 0) f.hasteT--;
      if (f.woundT > 0) f.woundT--;
      if (t % FREEZE_DR_DECAY === 0 && f.freezeN > 0) f.freezeN--;
      if (t % FREEZE_DR_DECAY === 0 && f.delayN > 0) f.delayN--;
      if (f.thorns.some((x) => x.until !== undefined && x.until <= t)) {
        f.thorns = f.thorns.filter((x) => x.until === undefined || x.until > t);
        emit({ type: 'status', side: f.side, status: 'thorns', value: sum(f.thorns) });
      }
    }

    if (t % TPS === 0) {
      for (const f of F) if (f.hp > 0) f.hooks.onSecond?.(hookApi(f), t / TPS);
      // รากไม้ร้อยปี (sim v21): +1 power every N seconds
      for (const f of F) if (f.hp > 0 && f.relics.has('oldroots') && t / TPS > 0 && (t / TPS) % T['relic.oldroots'] === 0) hookApi(f).grow(1);
      for (const f of F) {
        // credit each burn / poison stack's owner, then tick them down
        const foeStats = F[1 - f.side].stats;
        if (f.burns.length && f.hp > 0) {
          for (const x of f.burns) if (foeStats[x.idx]) foeStats[x.idx].d += x.dps;
          // ไฟเผาโล่: each burn tick also burns away shield (tuning.ts `burn.scorch` × the burn per second);
          // done before the burn damage so that damage event's snapshot already shows the smaller shield
          f.shield -= Math.min(f.shield, mulP(mulP(dps(f.burns), P(T['burn.scorch'])), F[1 - f.side].relics.has('meltdown') ? P(T['relic.meltdown']) : ONE));
          deal(f, dps(f.burns), false, 'burn', 'burn');
          f.burns = f.burns.map((x) => ({ ...x, t: x.t - TPS })).filter((x) => x.t > 0);
        }
        if (f.poisons.length && f.hp > 0) {
          for (const x of f.poisons) if (foeStats[x.idx]) foeStats[x.idx].d += x.dps;
          deal(f, dps(f.poisons), false, 'poison', 'poison');
          f.poisons = f.poisons.map((x) => ({ ...x, t: x.t - TPS })).filter((x) => x.t > 0);
        }
      }
      ultCheck();
    }

    if (t >= fStart && (t - fStart) % TPS === 0) {
      const n = ((t - fStart) / TPS + 1) * fStep;
      emit({ type: 'fatigue', amount: n });
      for (const f of F) deal(f, n, false, 'fatigue', 'fatigue');
    }

    if (opts.digest) opts.digest(digestOf(t, F));
    if (F[0].hp <= 0 || F[1].hp <= 0) {
      // one side down: the other wins. Both down in the same tick (double KO): the side that dealt more damage in the
      // whole fight wins, then the one less below zero, else a draw (sim v14; before: only "less below zero")
      // (sim v15) damage within DRAW_SHARE of each other is a draw (costs no run HP): "who went further below zero" no longer decides
      if (F[0].hp <= 0 && F[1].hp <= 0) {
        const d = F[0].dealtTotal - F[1].dealtTotal;
        // |d| ≤ DRAW_SHARE (1/20) × the bigger total, in integers
        winner = Math.abs(d) * 20 <= Math.max(F[0].dealtTotal, F[1].dealtTotal) ? -1 : d > 0 ? 0 : 1;
      } else winner = F[0].hp > 0 ? 0 : 1;
      decided = true;
      break;
    }
  }
  if (!decided) {
    t = MAX_TICKS;
    // HP share, compared by cross-multiplying (no division)
    const c0 = F[0].hp * F[1].maxHp;
    const c1 = F[1].hp * F[0].maxHp;
    winner = c0 === c1 ? -1 : c0 > c1 ? 0 : 1;

  }
  emit({ type: 'end', winner });
  const sides = F.map((f) => ({
    ...f.side_,
    never: f.stats.flatMap((st, i) => (SKILLS[[a, b][f.side].skills[i]?.id] && st.c + st.tc === 0 ? [i] : [])),
    ctl: Math.round(f.side_.fr + f.side_.dl + f.side_.ctl),
  })) as [SideStat, SideStat];

  return {
    v: SIM_VERSION, seed, day, winner, ticks: t, maxHp: [F[0].maxHp, F[1].maxHp], init, events,
    stats: [F[0].stats, F[1].stats], sides,
    ...(trace ? { trace } : {}),
  };
}

/**
 * Test-only: the full decision state at the end of a tick, as integers (onchain/engine/mochi-engine/tests/diff.rs
 * row_of has the same layout). Per fighter 44 fields, then 6 per block.
 */
function digestOf(t: number, F: [Fighter, Fighter]): number[] {
  const row = [t];
  for (const f of F) {
    row.push(
      f.hp, f.shield, f.frozen, f.frozenTotal, f.slowT, f.slowP, f.slowTotal, f.charge, f.chargeHits,
      sum(f.growth), f.growth.length, sum(f.thorns), f.thorns.length,
      dps(f.burns), f.burns.length, dotLeft(f.burns), dps(f.poisons), f.poisons.length, dotLeft(f.poisons),
      f.dodge, f.dodges, f.dealtTotal, f.hasteP, f.hasteT, f.woundP, f.woundT, f.ultDone ? 1 : 0,
      f.shieldGot, f.hitsTaken, f.lineCasts, f.ctlLanded, f.bigHit, f.ultUntil, f.freezeN, f.delayN, f.ctlKeep,
      f.ignoreFreeze ? 1 : 0, f.leechNext, f.thornsHeal, f.immuneUntil, f.lastFire,
      f.flags.hits ?? 0, f.flags.counter ?? 0, f.flags.hitsTaken ?? 0, f.flags.raged ?? 0,
    );
    for (const b of f.blocks) row.push(b.prog, b.cd, b.trigAt, b.reactAt, b.rr, f.stats[b.idx].c + f.stats[b.idx].tc);
  }
  return row;
}
