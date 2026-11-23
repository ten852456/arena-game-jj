import { HEROES_BY_ID, type CombatHooks, type HookFighter } from './heroes';
import { activeBonuses, bonusTotals } from './links';
import { ONE, P, ceilDiv, mulP, rdiv } from './fixed';
import { Rng } from './rng';
import { T } from './tuning';
import { SKILLS, execNode, lvOf, nodeOf, reacts, type Ctx, type FighterView } from './skills';
import type {
  BlockStat, Build, CombatEvent, CombatResult, CooldownTrace, DamageKind, EventBody, Fx, Mark, Side, SideStat, SkillInstance, Snap, StatusKind,
} from './types';

/**
 * Pure, deterministic auto-battle. No Date, no Math.random, no I/O.
 * simulate(a, b, seed, day) always returns the same events, so the server decides
 * the result and the browser (or a shared replay link) just plays it back.
 *
 * Sim v12: every number that decides the fight is an integer (multipliers and shares in ppm, see fixed.ts), so the
 * Rust engine on Solana reproduces it exactly. Only the per-block stats for the result screen still use floats.
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
 */

/** Bump when combat rules or numbers change: old replays can no longer be re-simulated. */
export const SIM_VERSION = 13;
export const TPS = 10; // ticks per second
export const MAX_TICKS = 90 * TPS;
/**
 * Base HP per day, tuned with `npm run balance` so fights last ≈10–13s on days 1–3,
 * 15–22s on days 4–7 and 23–30s on day 8+ (bot damage per second grows about linearly with the day).
 */
const HP_BY_DAY = [16, 18, 21, 39, 50, 61, 72, 127, 135, 156, 176, 198, 220];
/** HP added per day after the table */
const HP_LATE_STEP = 60;
/** tuning.ts multiplier of the base HP on a day */
const hpScale = (d: number) => (d <= 3 ? T['hp.early'] : d <= 7 ? T['hp.mid'] : T['hp.late']);
export const hpFor = (day: number) => {
  const d = Math.max(1, Math.floor(day));
  const base = d <= HP_BY_DAY.length ? HP_BY_DAY[d - 1] : HP_BY_DAY[HP_BY_DAY.length - 1] + HP_LATE_STEP * (d - HP_BY_DAY.length);
  return Math.round(base * hpScale(d));
};
/** Fatigue: after this many ticks both sides take growing damage (a backstop that ends stalled fights). */
export const fatigueStart = (day: number) => Math.round(Math.min(30, day <= 3 ? 14 : 9 + 2 * day) * TPS);
/** Fatigue damage in the n-th second = n × step, so it ends a fight a few seconds after it starts on every day. */
export const fatigueStep = (day: number) => Math.max(1, Math.ceil(hpFor(day) / 30));
const MAX_FREEZE_TICKS = 15;
/** each recent freeze makes the next one 40% shorter: DR_P[n] = 0.6^n in ppm (integer recurrence, no Math.pow) */
const DR_P: number[] = [ONE];
for (let i = 1; i < 24; i++) DR_P.push(mulP(DR_P[i - 1], 600_000));
const drOf = (n: number) => (n < DR_P.length ? DR_P[n] : 0);
const FREEZE_DR_DECAY = 4 * TPS; // one stack of diminishing returns wears off every 4s
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
/** each chain step after the first fires weaker: step 2 = ×0.75, step 3 = ×0.56 … (tuning.ts `chainDecay`) */
export const CHAIN_DECAY = T.chainDecay;
/** after a freeze ends or a delay lands, freeze and delay on that fighter are resisted for this long */
export const CTL_IMMUNE = 1.5 * TPS;
/** The control cap also grows with the fight: at tick t at most CTL_BASE + CTL_SHARE × t ticks can have been spent. */
export const CTL_BASE = 1 * TPS;
export const CTL_SHARE = 0.3;
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
  /** index into build.skills (for events, replay highlighting and stats) */
  idx: number;
  cd: number;
  /** cooldown progress in ppm ticks (cd × ONE = ready) */
  prog: number;
  /** all numbers of this skill ×power (connect bonus), ppm */
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
  v: number;
  idx: number;
  /** tick when this stack wears off (thorns only) */
  until?: number;
}

interface Fighter {
  side: Side;
  hero: string;
  hooks: CombatHooks;
  blocks: Block[];
  hp: number;
  maxHp: number;
  shield: number;
  frozen: number;
  frozenTotal: number;
  /** control used from the shared cap: frozen ticks + delayed ticks */
  delayN: number;
  /** slow share in ppm */
  slowP: number;
  slowT: number;
  /** ticks this fighter has spent slowed (capped per fight by slowCap) */
  slowTotal: number;
  growth: Stack[];
  /** charge multiplier on the next hit, ppm (ONE = none) */
  charge: number;
  /** block that set the current charge (credit for buff damage) */
  chargeIdx: number;
  thorns: Stack[];
  burns: { dps: number; t: number; idx: number }[];
  freezeN: number;
  /** share of control (freeze / slow / delay) that still lands on this fighter: 1 = all, 0.4 = ใจเหล็ก */
  ctlKeep: number;
  /** slowed share accumulated per tick (ppm), for SideStat.ctl */
  ctlP: number;
  /** the next freeze on this fighter is ignored */
  ignoreFreeze: boolean;
  /** hits the current charge multiplier still applies to */
  chargeHits: number;
  /** the next hit heals this share of its damage */
  leechNext: number;
  /** while this fighter has thorns, the enemy's healing is multiplied by this */
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

const sum = (xs: Stack[]) => xs.reduce((n, x) => n + x.v, 0);

/** haste = cooldown cut from connect bonuses (0.2 per haste bonus, at most halved) */
export function cdTicks(k: Pick<SkillInstance, 'id' | 'v' | 'mark'>, haste = 0): number {
  const q = k.mark === 'quick' ? 600_000 : ONE;
  const h = Math.max(500_000, ONE - P(haste));
  return Math.max(5, rdiv(nodeOf(k).cd * q * h, ONE * ONE));
}

function makeBlocks(b: Build): Block[] {
  const skills = b.skills.filter((k) => SKILLS[k.id]);
  const act = activeBonuses(skills);
  const out: Block[] = [];
  b.skills.forEach((inst, idx) => {
    if (!SKILLS[inst.id]) return;
    const t = bonusTotals(skills, out.length, act);
    out.push({
      inst: { ...inst }, idx, cd: cdTicks(inst, t.haste), prog: 0,
      power: P(t.power), dmg: t.dmg, shieldOnFire: t.shield, triggers: t.triggers, // indexes into `skills` = into blocks
      adj: [], rr: 0, trigAt: 0, reacts: reacts(nodeOf(inst)), reactAt: 0,
    });
  });
  out.forEach((blk, i) => { blk.adj = [i - 1, i + 1].filter((j) => j >= 0 && j < out.length); });
  return out;
}

const emptyStat = (): BlockStat => ({ c: 0, tc: 0, d: 0, bd: 0, bf: 0, h: 0, sh: 0, fz: 0 });

function makeFighter(b: Build, side: Side, day: number): Fighter {
  const hooks = HEROES_BY_ID[b.hero]?.hooks ?? {};
  const maxHp = hooks.maxHp ? hooks.maxHp(hpFor(day)) : hpFor(day);
  return {
    side, hero: b.hero, hooks, blocks: makeBlocks(b),
    hp: maxHp, maxHp, shield: hooks.startShield ? hooks.startShield(0, maxHp) : 0,
    frozen: 0, frozenTotal: 0, delayN: 0, slowP: 0, slowT: 0, slowTotal: 0, growth: [], charge: ONE, chargeIdx: -1, thorns: [],
    burns: [], freezeN: 0, ctlKeep: ONE, ctlP: 0, ignoreFreeze: false, chargeHits: 0, leechNext: 0, thornsHeal: P(THORNS_HEAL), flags: {},
    stats: b.skills.map(emptyStat),
    immuneUntil: 0, pendingReact: [], lastFire: 0,
    side_: { casts: 0, never: [], fr: 0, dl: 0, sl: 0, ctl: 0, resisted: 0 },
  };
}

/**
 * opts.digest (tests only): called at the end of every tick with the full decision state as integers, so the Rust
 * engine can be compared tick by tick (layout: digestOf at the end of this file).
 */
export function simulate(
  a: Build, b: Build, seed: number, day = 1, opts: { trace?: boolean; digest?: (row: number[]) => void } = {},
): CombatResult {
  const rng = new Rng(seed);
  const F: [Fighter, Fighter] = [makeFighter(a, 0, day), makeFighter(b, 1, day)];
  const events: CombatEvent[] = [];
  let t = 0;

  const fx = (f: Fighter): Fx => ({
    g: sum(f.growth),
    c: f.charge / ONE,
    th: sum(f.thorns),
    sf: f.ctlKeep < ONE ? 1 : 0,
    b: f.burns.reduce((n, x) => n + x.dps, 0),
    fr: f.frozen,
    sl: f.slowT > 0 ? rdiv(f.slowP * 100, ONE) : 0,
    slt: f.slowT,
  });
  const snap = (): Snap => ({ hp: [F[0].hp, F[1].hp], sh: [F[0].shield, F[1].shield], fx: [fx(F[0]), fx(F[1])] });
  const emit = (e: EventBody) => {
    events.push({ ...e, t, s: snap() } as CombatEvent);
  };
  const view = (x: Fighter): FighterView => ({
    hp: x.hp, maxHp: x.maxHp, shield: x.shield, frozen: x.frozen > 0, slowed: x.slowT > 0, hero: x.hero,
    thorns: sum(x.thorns), growth: sum(x.growth), burnLeft: x.burns.reduce((n, b) => n + b.dps * ceilDiv(b.t, TPS), 0),
  });
  const hookApi = (f: Fighter): HookFighter => ({
    get hero() { return f.hero; },
    get hp() { return f.hp; },
    get maxHp() { return f.maxHp; },
    get shield() { return f.shield; },
    get foeSlowed() { return F[1 - f.side].slowT > 0; },
    get foeFrozen() { return F[1 - f.side].frozen > 0; },
    flags: f.flags,
    grow(n) { f.growth.push({ v: n, idx: -1 }); },
    thorns(n, permanent = false) {
      f.thorns.push({ v: n, idx: -1, ...(permanent ? {} : { until: t + THORNS_TICKS }) });
      emit({ type: 'status', side: f.side, status: 'thorns', value: sum(f.thorns) });
    },
    addShield(n) {
      f.shield += n;
      emit({ type: 'shield', side: f.side, amount: n });
    },
    status(kind: StatusKind, value: number) {
      emit({ type: 'status', side: f.side, status: kind, value });
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
  const fCap = freezeCap(day);
  const sCap = rdiv(fCap * 7, 4); // 1.75 × the freeze cap
  for (const f of F) f.hooks.onStart?.(hookApi(f));

  /** owner = the attacker's block that gets credit (idx into its build.skills), -1 = none */
  /** shieldable: true / false, or the share of the hit (ppm) that shields can block */
  /** src = skill id for hits (for the UI), 'thorns' / 'burn' / 'fatigue' otherwise; kind = what dealt it (rules) */
  function deal(target: Fighter, amount: number, shieldable: boolean | number, src: string, kind: DamageKind, owner = -1, bonusPart = 0) {
    if (amount <= 0 || target.hp <= 0) return;
    let blocked = 0;
    const share = shieldable === true ? ONE : shieldable === false ? 0 : shieldable;
    if (share > 0 && target.shield > 0) {
      blocked = Math.min(target.shield, mulP(amount, share));
      target.shield -= blocked;
    }
    target.hp -= amount - blocked;
    const st = F[1 - target.side].stats[owner];
    if (st) {
      st.d += amount;
      st.bd += Math.min(amount, bonusPart);
    }
    emit({ type: 'damage', side: target.side, amount: amount - blocked, blocked, src, kind });
    target.hooks.onDamaged?.(hookApi(target), amount - blocked, kind);
  }

  function addBurn(foe: Fighter, dps: number, secs: number, idx: number) {
    foe.burns.push({ dps, t: secs * TPS, idx });
    emit({ type: 'status', side: foe.side, status: 'burn', value: foe.burns.reduce((n, x) => n + x.dps, 0) });
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
  const ctlRoom = (x: Fighter) => Math.min(fCap, CTL_BASE + Math.floor((3 * t) / 10)) - x.frozenTotal; // CTL_SHARE = 0.3
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
    /** fires below full power (engines, echo) also carry less control */
    const ctl = Math.min(ONE, power); // ppm
    const thornsUntil = () => t + (f.hooks.thornsSecs ? f.hooks.thornsSecs * TPS : THORNS_TICKS);
    const ctx: Ctx = {
      v: (n) => Math.max(1, rdiv(P(n) * power, ONE * ONE)),
      vP: (nP) => Math.max(1, rdiv(nP * power, ONE * ONE)),
      get me() { return view(f); },
      get foe() { return view(foe); },
      hit(n, o = {}) {
        if (foe.hp <= 0 || f.hp <= 0) return 0;
        const mult = f.charge;
        let dmg = mulP(n + sum(f.growth) + bonusDmg, mult);
        if (f.hooks.onHit) dmg = Math.max(0, f.hooks.onHit(hookApi(f), dmg));
        // stats only (result screen; never decides the fight): credit for connect bonuses and buffs
        const m = mult / ONE;
        const fromPower = blk.power > ONE ? n - (n * ONE) / blk.power : 0;
        const bonusPart = Math.round((bonusDmg + fromPower) * m);
        for (const g of f.growth) if (f.stats[g.idx]) f.stats[g.idx].bf += Math.round(g.v * m);
        if (mult > ONE && f.stats[f.chargeIdx]) f.stats[f.chargeIdx].bf += dmg - Math.round(dmg / m);
        if (f.chargeHits > 1) f.chargeHits--;
        else {
          f.charge = ONE;
          f.chargeIdx = -1;
          f.chargeHits = 0;
        }
        const hpBefore = foe.hp;
        deal(foe, dmg, ONE - P(o.pierce ?? 0), inst.id, 'hit', blk.idx, bonusPart);
        const dealt = Math.max(0, hpBefore - Math.max(0, foe.hp));
        const leech = P(o.leech ?? 0) + f.leechNext;
        f.leechNext = 0;
        if (leech > 0 && dealt > 0) ctx.heal(Math.max(1, mulP(dealt, leech)));
        // thorns reflect at most THORNS_MAX of the hit (hooks can change it, e.g. a thorns hero reflects more)
        let th = Math.min(sum(foe.thorns), ceilDiv(dmg * 3, 4)); // THORNS_MAX = 3/4
        if (foe.hooks.thornsReflect) th = foe.hooks.thornsReflect(th, sum(foe.thorns), dmg);
        if (th > 0 && f.hp > 0) deal(f, th, true, 'thorns', 'thorns', foe.thorns[0]?.idx ?? -1);
        return dealt;
      },
      shield(n) {
        f.shield += n;
        st.sh += n;
        emit({ type: 'shield', side: f.side, amount: n });
      },
      heal(n) {
        // the enemy's thorns also wound: healing is reduced while they have any
        if (foe.thorns.length) n = Math.max(1, mulP(n, foe.thornsHeal));
        const h = Math.min(n, f.maxHp - f.hp);
        if (h > 0) {
          f.hp += h;
          st.h += h;
          emit({ type: 'heal', side: f.side, amount: h });
        }
      },
      burn(dps, secs) { addBurn(foe, dps, f.hooks.burnSecs ? f.hooks.burnSecs(secs) : secs, blk.idx); },
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
        let tP = mulP(P(secs) * TPS, ctl); // ppm ticks
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
        const s0 = mulP(P(secs0), ctl);
        const [pct, secs] = f.hooks.slow ? f.hooks.slow(P(pct0), s0) : [P(pct0), s0]; // ppm share, ppm seconds
        const p = Math.min(SLOW_CAP_P, mulP(pct, foe.ctlKeep));
        foe.slowP = foe.slowT > 0 ? Math.max(foe.slowP, p) : p;
        // total slowed time per fight is capped (twice the freeze cap); past it, slows are resisted
        // total slowed time has its own cap (1.75 × the freeze cap), which also grows with the fight
        const room = shaking(foe) ? 0 : Math.max(0, Math.min(sCap, 2 * CTL_BASE + Math.floor((6 * t) / 10)) - foe.slowTotal - foe.slowT);
        // a fractional duration lasts until its last partial tick (as in v11): ceil
        const add = Math.min(room, Math.max(0, ceilDiv(secs * TPS, ONE) - foe.slowT));
        if (add <= 0 && foe.slowT <= 0) {
          foe.side_.resisted++;
          emit({ type: 'status', side: foe.side, status: 'slow', value: 0 });
          return;
        }
        foe.slowT += add;
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
        } else foe.side_.resisted++;
        emit({ type: 'status', side: foe.side, status: 'delay', value: ticks });
        if (ticks >= REACT_MIN) controlled(foe);
      },
      grow(n) {
        f.growth.push({ v: n, idx: blk.idx });
        emit({ type: 'status', side: f.side, status: 'grow', value: sum(f.growth) });
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
      amplify(cap0) {
        const cap = Math.max(1, mulP(cap0, ctl));
        const g = Math.min(cap, sum(f.growth));
        const th = Math.min(cap, sum(f.thorns));
        if (g > 0) f.growth.push({ v: g, idx: blk.idx });
        if (th > 0) f.thorns.push({ v: th, idx: blk.idx, until: thornsUntil() });
        if (f.charge > ONE) f.charge = ONE + Math.min(cap * ONE, (f.charge - ONE) * 2);
        emit({ type: 'status', side: f.side, status: 'amplify', value: g + th });
        return g + th;
      },
      cleanse(stacks) {
        let n = 0;
        // remove the strongest burn stacks
        for (let r = 0; r < stacks && f.burns.length; r++) {
          let k = 0;
          f.burns.forEach((x, i) => { if (x.dps > f.burns[k].dps) k = i; });
          f.burns.splice(k, 1);
          n++;
        }
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
            const keep = Math.floor(g.v / 2);
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
    /** power of this fire in ppm (engines fire at less than full power) */
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
    if (q.from === undefined) st.c++;
    else {
      st.tc++;
      blk.trigAt = t + Math.min(TRIGGER_GAP_MAX, Math.max(TRIGGER_GAP, blk.cd));
      if (q.restart) blk.prog = 0;
    }
    f.side_.casts++;
    f.lastFire = t;
    emit({
      type: 'cast', side: f.side, skill: inst.id, lv: lvOf(inst.v), idx: blk.idx,
      ...(q.from !== undefined ? { from: f.blocks[q.from].idx } : {}),
      ...(q.react ? { react: true } : {}),
    });
    const power = mulP(blk.power, q.mult);
    runSkill(f, foe, blk, power, mulP(blk.dmg, q.mult));
    if (blk.shieldOnFire > 0 && f.hp > 0) {
      const n = Math.max(1, mulP(blk.shieldOnFire, q.mult));
      f.shield += n;
      st.sh += n;
      emit({ type: 'shield', side: f.side, amount: n });
    }
    if (inst.mark === 'echo' && foe.hp > 0 && f.hp > 0) {
      emit({ type: 'cast', side: f.side, skill: inst.id, lv: lvOf(inst.v), idx: blk.idx, echo: true });
      runSkill(f, foe, blk, rdiv(power, 2), rdiv(blk.dmg * q.mult, 2 * ONE));
    }
    if (inst.mark === 'burn' && foe.hp > 0) addBurn(foe, 1, 3, blk.idx);

    // trigger bonuses fire at the same power, but deeper chain steps get weaker
    const tm = q.depth >= 1 ? mulP(q.mult, P(T.chainDecay)) : q.mult;
    const next: Fire[] = blk.triggers.map((bi) => ({ bi, depth: q.depth + 1, from: q.bi, mult: tm }));
    const en = nodeOf(inst).engine;
    // engine power: the engine's own power bonus counts, but a chain never fires above the engine's power
    const ep = en ? mulP(mulP(P(en.power), blk.power), Math.min(ONE, q.mult)) : 0;
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
      emit({ type: 'status', side: f.side, status: 'cleanse', value: 1 });
    }
    const frozen = f.frozen > 0;
    if (frozen) {
      f.frozen--;
      f.side_.fr++;
      if (f.frozen === 0) f.immuneUntil = t + CTL_IMMUNE;
    }
    const rate = f.slowT > 0 ? ONE - f.slowP : ONE;
    if (f.slowT > 0) f.ctlP += f.slowP;
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
    }
    record();
    for (const f of F) {
      if (f.slowT > 0) {
        f.slowT--;
        f.slowTotal++;
        f.side_.sl++;
      }
      if (t % FREEZE_DR_DECAY === 0 && f.freezeN > 0) f.freezeN--;
      if (t % FREEZE_DR_DECAY === 0 && f.delayN > 0) f.delayN--;
      if (f.thorns.some((x) => x.until !== undefined && x.until <= t)) {
        f.thorns = f.thorns.filter((x) => x.until === undefined || x.until > t);
        emit({ type: 'status', side: f.side, status: 'thorns', value: sum(f.thorns) });
      }
    }

    if (t % TPS === 0) {
      for (const f of F) {
        if (!f.burns.length || f.hp <= 0) continue;
        // credit each burn stack's owner, then tick them down
        const total = f.burns.reduce((n, x) => n + x.dps, 0);
        const foeStats = F[1 - f.side].stats;
        for (const x of f.burns) if (foeStats[x.idx]) foeStats[x.idx].d += x.dps;
        deal(f, total, false, 'burn', 'burn');
        f.burns = f.burns.map((x) => ({ ...x, t: x.t - TPS })).filter((x) => x.t > 0);
      }
    }

    if (t >= fStart && (t - fStart) % TPS === 0) {
      const n = ((t - fStart) / TPS + 1) * fStep;
      emit({ type: 'fatigue', amount: n });
      for (const f of F) deal(f, n, false, 'fatigue', 'fatigue');
    }

    if (opts.digest) opts.digest(digestOf(t, F));

    if (F[0].hp <= 0 || F[1].hp <= 0) {
      winner = F[0].hp === F[1].hp ? -1 : F[0].hp > F[1].hp ? 0 : 1;
      decided = true;
      break;
    }
  }
  if (!decided) {
    t = MAX_TICKS;
    // compare HP shares without division: hp0/max0 vs hp1/max1
    const r0 = F[0].hp * F[1].maxHp;
    const r1 = F[1].hp * F[0].maxHp;
    winner = r0 === r1 ? -1 : r0 > r1 ? 0 : 1;
  }
  emit({ type: 'end', winner });
  const sides = F.map((f) => ({
    ...f.side_,
    never: f.stats.flatMap((st, i) => (SKILLS[[a, b][f.side].skills[i]?.id] && st.c + st.tc === 0 ? [i] : [])),
    ctl: Math.round(f.side_.fr + f.side_.dl + f.ctlP / ONE),
  })) as [SideStat, SideStat];

  return {
    v: SIM_VERSION, seed, day, winner, ticks: t, maxHp: [F[0].maxHp, F[1].maxHp], init, events,
    stats: [F[0].stats, F[1].stats], sides,
    ...(trace ? { trace } : {}),
  };
}

/**
 * Full decision state at the end of a tick, as integers (tests only; the Rust engine emits the same layout):
 * [t, then per side: hp, shield, frozen, frozenTotal, slowT, slowP, slowTotal, charge, chargeHits, growth sum,
 *  thorns sum, thorns stacks, burn dps sum, burn stacks, ctlKeep, ignoreFreeze, immuneUntil, lastFire, freezeN,
 *  delayN, leechNext, thornsHeal, then per block: prog, trigAt, reactAt, rr]
 */
function digestOf(t: number, F: [Fighter, Fighter]): number[] {
  const row = [t];
  for (const f of F) {
    row.push(
      f.hp, f.shield, f.frozen, f.frozenTotal, f.slowT, f.slowP, f.slowTotal, f.charge, f.chargeHits, sum(f.growth),
      sum(f.thorns), f.thorns.length, f.burns.reduce((n, x) => n + x.dps, 0), f.burns.length, f.ctlKeep,
      f.ignoreFreeze ? 1 : 0, f.immuneUntil, f.lastFire, f.freezeN, f.delayN, f.leechNext, f.thornsHeal,
    );
    for (const b of f.blocks) row.push(b.prog, b.trigAt, b.reactAt, b.rr);
  }
  return row;
}
