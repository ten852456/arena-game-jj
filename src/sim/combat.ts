import { HEROES_BY_ID, type CombatHooks, type HookFighter } from './heroes';
import { HASTE_BONUS, POWER_BONUS, activeBonuses, bonusValue, neighbours } from './grid';
import { Rng } from './rng';
import { SKILLS, execNode, lvOf, nodeOf, reacts, type Ctx, type FighterView } from './skills';
import type {
  BlockStat, Build, CombatEvent, CombatResult, CooldownTrace, EventBody, Fx, Mark, Side, SideStat, SkillInstance, Snap, StatusKind,
} from './types';

/**
 * Pure, deterministic auto-battle. No Date, no Math.random, no I/O.
 * simulate(a, b, seed, day) always returns the same events, so the server decides
 * the result and the browser (or a shared replay link) just plays it back.
 *
 * Every placed block runs its own cooldown at the same time. When it is ready it fires.
 * Connect bonuses work when any touching block matches their condition. A trigger bonus makes
 * the matching neighbours fire right away too, without resetting their cooldown.
 * Engine blocks fire the blocks they touch (gear: one per fire round-robin, overclock: all + restart their cooldown).
 * Ties fire in grid reading order (top-left first).
 * Anything set off by another block (trigger bonus or engine) counts as "ต่อ": a block can be set off at most once
 * per its own cooldown (TRIGGER_GAP..TRIGGER_GAP_MAX), and each chain step after the first is weaker (CHAIN_DECAY).
 *
 * Control rules (so no side is locked for a whole fight), for every source: own cooldown, chains and engines:
 * - freeze and cast delay share one cap per fight (freezeCap, and at most CTL_BASE + CTL_SHARE × time fought);
 * - a frozen fighter cannot be frozen or delayed again; when a freeze ends or a delay lands the fighter is immune
 *   to freeze and delay for CTL_IMMUNE ticks (ตั้งหลัก);
 * - a fighter that has not fired anything for SHAKE_OFF ticks drops freeze / slow and resists control (สลัดการคุม);
 * - blocks with ✨ ชำระ or 🗿 ใจเหล็ก react: when control lands on their owner they fire right away
 *   (at most once per their cooldown, and their cooldown restarts);
 * - fires below full power (engines, chain steps, echo) carry that share of control.
 */

/** Bump when combat rules or numbers change: old replays can no longer be re-simulated. */
export const SIM_VERSION = 8;
export const TPS = 10; // ticks per second
export const MAX_TICKS = 90 * TPS;
/**
 * Base HP per day, tuned with bot fights so the average fight lasts ≈9–10s on days 1–3,
 * ≈14s on days 4–7 and ≈20s on day 8+ (targets 7–13 / 10–18 / 15–26s), with ≤ ~20% of fights reaching fatigue.
 */
const HP_BY_DAY = [16, 18, 21, 58, 68, 90, 112, 235, 265, 310, 360, 405, 455];
export const hpFor = (day: number) => {
  const d = Math.max(1, Math.floor(day));
  return d <= HP_BY_DAY.length ? HP_BY_DAY[d - 1] : HP_BY_DAY[HP_BY_DAY.length - 1] + 60 * (d - HP_BY_DAY.length);
};
/**
 * Fatigue: after this many ticks both sides take growing damage (a backstop that ends stalled fights).
 * Set near the slow end of normal fights (≈ p80 of the length target), so at most ~1 fight in 5 reaches it.
 */
export const fatigueStart = (day: number) => Math.round((day <= 3 ? 14 : day <= 7 ? 20 : 28) * TPS);
/** Fatigue damage in the n-th second = n × step, so it ends a fight a few seconds after it starts on every day. */
export const fatigueStep = (day: number) => Math.max(1, Math.ceil(hpFor(day) / 30));
const MAX_FREEZE_TICKS = 15;
const FREEZE_DR = 0.6; // each recent freeze makes the next one 40% shorter
const FREEZE_DR_DECAY = 4 * TPS; // one stack of diminishing returns wears off every 4s
/** Total frozen time per fight (≈25% of the target fight length); after that freezes are resisted. */
export const freezeCap = (day: number) => (day <= 3 ? 2 : day <= 7 ? 4.5 : 6) * TPS;
const SLOW_CAP = 0.5;
/** longest trigger chain (each skill fires at most once per chain anyway) */
const MAX_CHAIN = 8;
/**
 * A block set off by another block (trigger bonus / engine) cannot be set off again for its own cooldown,
 * but at least TRIGGER_GAP and at most TRIGGER_GAP_MAX ticks. So "ต่อ" at most doubles a block up to 6s cooldown
 * (fast blocks less), slower blocks a bit more, and a chain can never loop.
 */
export const TRIGGER_GAP = 3 * TPS;
export const TRIGGER_GAP_MAX = 6 * TPS;
/** each chain step after the first fires weaker: step 2 = ×0.75, step 3 = ×0.56 … */
export const CHAIN_DECAY = 0.75;
/** ตั้งหลัก: after a freeze ends or a delay lands, freeze and delay on that fighter are resisted for this long */
export const CTL_IMMUNE = 1.5 * TPS;
/** The control cap also grows with the fight: at tick t at most CTL_BASE + CTL_SHARE × t ticks can have been spent. */
export const CTL_BASE = 1 * TPS;
export const CTL_SHARE = 0.3;
/** สลัดการคุม: a fighter that has not fired anything for this long drops freeze / slow and resists control until it fires. */
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
  prog: number;
  /** all numbers of this skill ×power (connect bonus) */
  power: number;
  /** + damage on every hit / + shield on every fire, from connect bonuses */
  dmg: number;
  shieldOnFire: number;
  /** blocks (indexes into fighter.blocks) this one sets off when it fires */
  triggers: number[];
  /** touching blocks (indexes into fighter.blocks), used by engines */
  adj: number[];
  /** gear: next touching block to fire */
  rr: number;
  /** tick from which another block may set this one off again */
  trigAt: number;
  /** ✨/🗿 block: fires early when its owner gets controlled */
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
  /** cooldown ticks pushed back by cast delay (shares the control cap with freeze) */
  delayN: number;
  slowPct: number;
  slowT: number;
  /** ticks this fighter has spent slowed (capped per fight by slowCap) */
  slowTotal: number;
  growth: Stack[];
  charge: number;
  /** block that set the current charge (credit for buff damage) */
  chargeIdx: number;
  thorns: Stack[];
  burns: { dps: number; t: number; idx: number }[];
  freezeN: number;
  /** share of control (freeze / slow / delay) that still lands on this fighter: 1 = all, 0.4 = ใจเหล็ก */
  ctlKeep: number;
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
  /** freeze and delay are resisted until this tick (ตั้งหลัก) */
  immuneUntil: number;
  /** blocks waiting to react to control (processed after the current action) */
  pendingReact: number[];
  /** tick of this fighter's last block fire (for SHAKE_OFF) */
  lastFire: number;
  side_: SideStat;
}

const sum = (xs: Stack[]) => xs.reduce((n, x) => n + x.v, 0);

/** haste = cooldown cut from connect bonuses (0.2 per haste bonus, at most halved) */
export function cdTicks(k: Pick<SkillInstance, 'id' | 'v' | 'mark'>, haste = 0): number {
  const base = nodeOf(k).cd * (k.mark === 'quick' ? 0.6 : 1) * Math.max(0.5, 1 - haste);
  return Math.max(5, Math.round(base));
}

function makeBlocks(b: Build): Block[] {
  // placed blocks only, in grid reading order (top-left first) so ties fire in a stable order
  const placed = b.skills
    .map((inst, idx) => ({ inst, idx }))
    .filter((p) => p.inst.x >= 0 && SKILLS[p.inst.id])
    .sort((p, q) => p.inst.y - q.inst.y || p.inst.x - q.inst.x || p.idx - q.idx);
  const act = activeBonuses(b.skills, b.w, b.h);
  const nb = neighbours(b.skills, b.w, b.h);
  const pos = new Map(placed.map((p, i) => [p.idx, i]));
  const toPos = (js: number[]) => js.map((j) => pos.get(j)).filter((j): j is number => j !== undefined);
  return placed.map((p) => {
    const mine = act.filter((a) => a.from === p.idx);
    const count = (e: string) => mine.filter((a) => a.b.e === e).length;
    const lv = lvOf(p.inst.v);
    return {
      inst: { ...p.inst },
      idx: p.idx,
      cd: cdTicks(p.inst, count('haste') * HASTE_BONUS),
      prog: 0,
      power: 1 + count('power') * POWER_BONUS,
      dmg: count('dmg') * bonusValue('dmg', lv),
      shieldOnFire: count('shield') * bonusValue('shield', lv),
      triggers: [...new Set(toPos(mine.filter((a) => a.b.e === 'trigger').flatMap((a) => a.to)))],
      adj: toPos(nb[p.idx] ?? []),
      rr: 0,
      trigAt: 0,
      reacts: reacts(nodeOf(p.inst)),
      reactAt: 0,
    };
  });
}

const emptyStat = (): BlockStat => ({ c: 0, tc: 0, d: 0, bd: 0, bf: 0, h: 0, sh: 0, fz: 0 });

function makeFighter(b: Build, side: Side, day: number): Fighter {
  const hooks = HEROES_BY_ID[b.hero]?.hooks ?? {};
  const maxHp = hooks.maxHp ? hooks.maxHp(hpFor(day)) : hpFor(day);
  return {
    side, hero: b.hero, hooks, blocks: makeBlocks(b),
    hp: maxHp, maxHp, shield: hooks.startShield ? hooks.startShield(0, maxHp) : 0,
    frozen: 0, frozenTotal: 0, delayN: 0, slowPct: 0, slowT: 0, slowTotal: 0, growth: [], charge: 1, chargeIdx: -1, thorns: [],
    burns: [], freezeN: 0, ctlKeep: 1, ignoreFreeze: false, chargeHits: 0, leechNext: 0, thornsHeal: THORNS_HEAL, flags: {},
    stats: b.skills.map(emptyStat),
    immuneUntil: 0, pendingReact: [], lastFire: 0,
    side_: { casts: 0, never: [], fr: 0, dl: 0, sl: 0, ctl: 0, resisted: 0 },
  };
}

export function simulate(a: Build, b: Build, seed: number, day = 1, opts: { trace?: boolean } = {}): CombatResult {
  const rng = new Rng(seed);
  const F: [Fighter, Fighter] = [makeFighter(a, 0, day), makeFighter(b, 1, day)];
  const events: CombatEvent[] = [];
  let t = 0;

  const fx = (f: Fighter): Fx => ({
    g: sum(f.growth),
    c: f.charge,
    th: sum(f.thorns),
    sf: f.ctlKeep < 1 ? 1 : 0,
    b: f.burns.reduce((n, x) => n + x.dps, 0),
    fr: f.frozen,
    sl: f.slowT > 0 ? Math.round(f.slowPct * 100) : 0,
    slt: f.slowT,
  });
  const snap = (): Snap => ({ hp: [F[0].hp, F[1].hp], sh: [F[0].shield, F[1].shield], fx: [fx(F[0]), fx(F[1])] });
  const emit = (e: EventBody) => {
    events.push({ ...e, t, s: snap() } as CombatEvent);
  };
  const view = (x: Fighter): FighterView => ({
    hp: x.hp, maxHp: x.maxHp, shield: x.shield, frozen: x.frozen > 0, slowed: x.slowT > 0, hero: x.hero,
    thorns: sum(x.thorns), growth: sum(x.growth), burnLeft: x.burns.reduce((n, b) => n + b.dps * Math.ceil(b.t / TPS), 0),
  });
  const hookApi = (f: Fighter): HookFighter => ({
    get hero() { return f.hero; },
    get hp() { return f.hp; },
    get maxHp() { return f.maxHp; },
    get shield() { return f.shield; },
    get foeSlowed() { return F[1 - f.side].slowT > 0; },
    get foeFrozen() { return F[1 - f.side].frozen > 0; },
    get foeHpShare() { return F[1 - f.side].hp / F[1 - f.side].maxHp; },
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
      for (const blk of f.blocks) trace.p[f.side][t * n + blk.idx] = Math.min(255, Math.round((blk.prog / blk.cd) * 255));
      trace.fr[f.side][t] = f.frozen > 0 ? 1 : 0;
    }
  };
  const first = rng.int(2); // who acts first on even ticks
  const fStart = fatigueStart(day);
  const fStep = fatigueStep(day);
  const fCap = freezeCap(day);
  const sCap = Math.round(fCap * 1.75);
  for (const f of F) f.hooks.onStart?.(hookApi(f));

  /** owner = the attacker's block that gets credit (idx into its build.skills), -1 = none */
  /** shieldable: true / false, or the share of the hit (0..1) that shields can block */
  function deal(target: Fighter, amount: number, shieldable: boolean | number, src: string, owner = -1, bonusPart = 0) {
    if (amount <= 0 || target.hp <= 0) return;
    let blocked = 0;
    const share = shieldable === true ? 1 : shieldable === false ? 0 : shieldable;
    if (share > 0 && target.shield > 0) {
      blocked = Math.min(target.shield, Math.round(amount * share));
      target.shield -= blocked;
    }
    target.hp -= amount - blocked;
    const st = F[1 - target.side].stats[owner];
    if (st) {
      st.d += amount;
      st.bd += Math.min(amount, bonusPart);
    }
    emit({ type: 'damage', side: target.side, amount: amount - blocked, blocked, src });
    target.hooks.onDamaged?.(hookApi(target), amount - blocked, src);
  }

  function addBurn(foe: Fighter, dps: number, secs: number, idx: number) {
    foe.burns.push({ dps, t: secs * TPS, idx });
    emit({ type: 'status', side: foe.side, status: 'burn', value: foe.burns.reduce((n, x) => n + x.dps, 0) });
  }

  /** control lands on foe: queue its ✨/🗿 reactions */
  function controlled(foe: Fighter) {
    for (let bi = 0; bi < foe.blocks.length; bi++) {
      const b = foe.blocks[bi];
      if (b.reacts && t >= b.reactAt && !foe.pendingReact.includes(bi)) foe.pendingReact.push(bi);
    }
  }
  /** freeze / delay ticks that can still land on this fighter now (their shared cap, growing with the fight) */
  const ctlRoom = (x: Fighter) => Math.floor(Math.min(fCap, CTL_BASE + CTL_SHARE * t) - x.frozenTotal);
  /** สลัดการคุม: no fire for SHAKE_OFF ticks */
  const shaking = (x: Fighter) => t - x.lastFire >= SHAKE_OFF;
  /** can freeze / delay land on this fighter now? (counts a resist when not) */
  function canControl(foe: Fighter) {
    if (foe.frozen > 0 || t < foe.immuneUntil || shaking(foe)) {
      foe.side_.resisted++;
      return false;
    }
    return true;
  }

  /** power = cast power (connect bonus × chain / engine share × echo); bonusDmg = + damage per hit from connect bonuses */
  function runSkill(f: Fighter, foe: Fighter, blk: Block, power: number, bonusDmg: number) {
    const inst = blk.inst;
    const st = f.stats[blk.idx];
    /** fires below full power (engines, chain steps, echo) also carry less control */
    const ctl = Math.min(1, power);
    const thornsUntil = () => t + (f.hooks.thornsSecs ? f.hooks.thornsSecs * TPS : THORNS_TICKS);
    const ctx: Ctx = {
      v: (n) => Math.max(1, Math.round(n * power)),
      get me() { return view(f); },
      get foe() { return view(foe); },
      hit(n, o = {}) {
        if (foe.hp <= 0 || f.hp <= 0) return 0;
        const mult = f.charge;
        let dmg = Math.round((n + sum(f.growth) + bonusDmg) * mult);
        if (f.hooks.onHit) dmg = Math.max(0, Math.round(f.hooks.onHit(hookApi(f), dmg)));
        // credit for connect bonuses: the +damage bonus plus the share added by power bonuses
        const fromPower = blk.power > 1 ? n - n / blk.power : 0;
        const bonusPart = Math.round((bonusDmg + fromPower) * mult);
        // credit for buffs: each พลัง stack's owner gets its share, the charge's owner gets the multiplier's extra
        for (const g of f.growth) if (f.stats[g.idx]) f.stats[g.idx].bf += Math.round(g.v * mult);
        if (mult > 1 && f.stats[f.chargeIdx]) f.stats[f.chargeIdx].bf += dmg - Math.round(dmg / mult);
        if (f.chargeHits > 1) f.chargeHits--;
        else {
          f.charge = 1;
          f.chargeIdx = -1;
          f.chargeHits = 0;
        }
        const pierce = o.pierce ?? 0;
        const hpBefore = foe.hp;
        deal(foe, dmg, 1 - pierce, inst.id, blk.idx, bonusPart);
        const dealt = Math.max(0, hpBefore - Math.max(0, foe.hp)) + 0;
        const leech = (o.leech ?? 0) + f.leechNext;
        f.leechNext = 0;
        if (leech > 0 && dealt > 0) ctx.heal(Math.max(1, Math.round(dealt * leech)));
        // thorns reflect at most THORNS_MAX of the hit (hooks can change it, e.g. a thorns hero reflects more)
        let th = Math.min(sum(foe.thorns), Math.ceil(dmg * THORNS_MAX));
        if (foe.hooks.thornsReflect) th = foe.hooks.thornsReflect(th, sum(foe.thorns), dmg);
        if (th > 0 && f.hp > 0) deal(f, th, true, 'thorns', foe.thorns[0]?.idx ?? -1);
        return dealt;
      },
      shield(n) {
        f.shield += n;
        st.sh += n;
        emit({ type: 'shield', side: f.side, amount: n });
      },
      heal(n) {
        // the enemy's thorns also wound: healing is reduced while they have any
        if (foe.thorns.length) n = Math.max(1, Math.round(n * foe.thornsHeal));
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
        let ticks = secs * ctl * TPS;
        if (f.hooks.freezeTicks) ticks = f.hooks.freezeTicks(ticks);
        ticks *= Math.pow(FREEZE_DR, foe.freezeN) * foe.ctlKeep; // diminishing returns (recovers over time), ใจเหล็ก
        ticks = Math.max(0, Math.min(MAX_FREEZE_TICKS, ctlRoom(foe), Math.round(ticks)));
        foe.freezeN++;
        if (ticks <= 0) foe.side_.resisted++;
        else {
          foe.frozenTotal += ticks;
          st.fz += ticks;
          foe.frozen = ticks;
        }
        emit({ type: 'status', side: foe.side, status: 'freeze', value: ticks });
        if (ticks >= REACT_MIN) controlled(foe);
      },
      slow(pct0, secs0) {
        const [pct, secs] = f.hooks.slow ? f.hooks.slow(pct0, secs0 * ctl) : [pct0, secs0 * ctl];
        const p = Math.min(SLOW_CAP, pct * foe.ctlKeep);
        // total slowed time has its own cap (1.75 × the freeze cap), which also grows with the fight
        const room = shaking(foe) ? 0 : Math.max(0, Math.floor(Math.min(sCap, 2 * CTL_BASE + 2 * CTL_SHARE * t)) - foe.slowTotal - foe.slowT);
        const add = Math.min(room, Math.max(0, Math.round(secs * TPS) - foe.slowT));
        if (add <= 0 && foe.slowT <= 0) {
          foe.side_.resisted++;
          emit({ type: 'status', side: foe.side, status: 'slow', value: 0 });
          return;
        }
        foe.slowPct = foe.slowT > 0 ? Math.max(foe.slowPct, p) : p;
        foe.slowT += add;
        emit({ type: 'status', side: foe.side, status: 'slow', value: Math.round(foe.slowPct * 100) });
        if (add >= REACT_MIN && p >= 0.3) controlled(foe);
      },
      delay(secs) {
        // cast delay: every enemy cooldown goes back. Diminishes with repeated use and shares the control cap with freeze.
        if (!canControl(foe)) {
          emit({ type: 'status', side: foe.side, status: 'delay', value: 0 });
          return;
        }
        let ticks = secs * ctl * TPS * Math.pow(FREEZE_DR, foe.delayN) * foe.ctlKeep;
        ticks = Math.max(0, Math.min(ctlRoom(foe), Math.round(ticks)));
        foe.delayN++;
        if (ticks > 0) {
          foe.frozenTotal += ticks;
          foe.side_.dl += ticks;
          st.fz += ticks;
          for (const b of foe.blocks) b.prog = Math.max(0, b.prog - ticks);
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
        const mult = f.hooks.chargeMult ? f.hooks.chargeMult(m) : m;
        if (mult >= f.charge) {
          f.charge = mult;
          f.chargeIdx = blk.idx;
          f.chargeHits = Math.max(1, hits);
        }
        emit({ type: 'status', side: f.side, status: 'charge', value: mult });
      },
      thorns(n, perm, heal) {
        f.thorns.push({ v: n, idx: blk.idx, ...(perm ? {} : { until: thornsUntil() }) });
        if (heal !== undefined) f.thornsHeal = Math.min(f.thornsHeal, heal);
        emit({ type: 'status', side: f.side, status: 'thorns', value: sum(f.thorns) });
      },
      steadfast(keep, ignoreFreeze) {
        f.ctlKeep = Math.min(f.ctlKeep, keep);
        if (ignoreFreeze) f.ignoreFreeze = true;
        // a freeze already on you is shortened too
        if (f.frozen > 0) f.frozen = Math.max(1, Math.round(f.frozen * keep));
        emit({ type: 'status', side: f.side, status: 'steadfast', value: 1 });
      },
      amplify(cap0) {
        const cap = Math.max(1, Math.round(cap0 * ctl));
        const g = Math.min(cap, sum(f.growth));
        const th = Math.min(cap, sum(f.thorns));
        if (g > 0) f.growth.push({ v: g, idx: blk.idx });
        if (th > 0) f.thorns.push({ v: th, idx: blk.idx, until: thornsUntil() });
        if (f.charge > 1) f.charge = 1 + Math.min(cap, (f.charge - 1) * 2);
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
        if (f.slowT > 0) { f.slowT = 0; f.slowPct = 0; n++; }
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
          if (foe.charge > 1) { foe.charge = 1; foe.chargeIdx = -1; foe.chargeHits = 0; n++; any = true; }
          if (foe.ctlKeep < 1) { foe.ctlKeep = 1; foe.ignoreFreeze = false; n++; any = true; }
          if (!any) break;
        }
        // shields are a buff too: strip part of them
        const cut = Math.floor(foe.shield * shieldShare);
        if (cut > 0) { foe.shield -= cut; n++; }
        emit({ type: 'status', side: foe.side, status: 'dispel', value: n });
        return n;
      },
      leech(pct) {
        f.leechNext = Math.max(f.leechNext, pct);
      },
    };
    execNode(nodeOf(inst), ctx);
  }

  interface Fire {
    bi: number;
    depth: number;
    from?: number;
    /** power of this fire (engines and deeper chain steps fire at less than full power) */
    mult: number;
    /** เร่งเครื่อง: the fired block's cooldown restarts */
    restart?: boolean;
    react?: boolean;
  }

  /**
   * Fires one block (plus its mark effects and shield-on-fire bonus). Returns the follow-up fires (trigger bonuses +
   * engines). ok(bi) = may block bi still be set off in this chain.
   */
  function fireOne(f: Fighter, q: Fire, ok: (bi: number) => boolean): Fire[] {
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
      type: 'cast', side: f.side, skill: inst.id, lv: lvOf(inst.v), idx: blk.idx, chain: q.depth,
      ...(q.from !== undefined ? { from: f.blocks[q.from].idx } : {}),
      ...(q.react ? { react: true } : {}),
    });
    const power = blk.power * q.mult;
    runSkill(f, foe, blk, power, Math.round(blk.dmg * q.mult));
    if (blk.shieldOnFire > 0 && f.hp > 0) {
      const n = Math.max(1, Math.round(blk.shieldOnFire * q.mult));
      f.shield += n;
      st.sh += n;
      emit({ type: 'shield', side: f.side, amount: n });
    }
    if (inst.mark === 'echo' && foe.hp > 0 && f.hp > 0) {
      emit({ type: 'cast', side: f.side, skill: inst.id, lv: lvOf(inst.v), idx: blk.idx, chain: q.depth, echo: true });
      runSkill(f, foe, blk, power * 0.5, Math.round(blk.dmg * q.mult * 0.5));
    }
    if (inst.mark === 'burn' && foe.hp > 0) addBurn(foe, 1, 3, blk.idx);

    // trigger bonuses fire at the same power, but each chain step after the first is weaker
    const decay = q.depth >= 1 ? CHAIN_DECAY : 1;
    const next: Fire[] = blk.triggers.map((bi) => ({ bi, depth: q.depth + 1, from: q.bi, mult: q.mult * decay }));
    const en = nodeOf(inst).engine;
    // engine power: the engine's own power bonus counts, but a chain never fires above the engine's power
    const ep = en ? en.power * blk.power * Math.min(1, q.mult) * decay : 0;
    if (en?.kind === 'gear' && blk.adj.length) {
      // takes turns over the touching blocks, skipping the ones that cannot be set off right now
      let want = Math.min(en.n ?? 1, blk.adj.length);
      for (let tries = 0; tries < blk.adj.length && want > 0; tries++) {
        const bi = blk.adj[blk.rr++ % blk.adj.length];
        if (!ok(bi) || next.some((n) => n.bi === bi)) continue;
        next.push({ bi, depth: q.depth + 1, from: q.bi, mult: ep });
        want--;
      }
    } else if (en?.kind === 'overclock') {
      for (const bi of blk.adj) next.push({ bi, depth: q.depth + 1, from: q.bi, mult: ep, restart: !en.keep });
    }
    return next;
  }

  /**
   * Fire a block, then everything it sets off (breadth-first). Each block fires at most once per chain, and a block
   * set off by another one cannot be set off again for its own cooldown (TRIGGER_GAP..TRIGGER_GAP_MAX).
   */
  function fire(f: Fighter, start: number, react = false) {
    const seen = new Set<number>([start]);
    const ok = (bi: number) => !seen.has(bi) && t >= f.blocks[bi].trigAt;
    const queue: Fire[] = [{ bi: start, depth: 0, mult: 1, react }];
    while (queue.length) {
      const q = queue.shift()!;
      if (f.hp <= 0 || F[1 - f.side].hp <= 0) return;
      const next = fireOne(f, q, ok);
      if (q.depth >= MAX_CHAIN) continue;
      for (const n of next) {
        if (!ok(n.bi)) continue;
        seen.add(n.bi);
        queue.push(n);
      }
    }
  }

  /** ✨/🗿 blocks that were queued by control on f fire now (their cooldown restarts). */
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
      // สลัดการคุม: too long without a single fire, shake off all control
      f.frozen = 0;
      f.slowT = 0;
      f.slowPct = 0;
      emit({ type: 'status', side: f.side, status: 'cleanse', value: 1 });
    }
    const frozen = f.frozen > 0;
    if (frozen) {
      f.frozen--;
      f.side_.fr++;
      if (f.frozen === 0) f.immuneUntil = t + CTL_IMMUNE;
    }
    const rate = f.slowT > 0 ? 1 - f.slowPct : 1;
    if (f.slowT > 0) f.side_.ctl += f.slowPct;
    const ready: number[] = [];
    f.blocks.forEach((blk, bi) => {
      if (frozen && blk.inst.mark !== 'steadfast') return; // steadfast mark: keeps counting while frozen
      blk.prog += rate;
      if (blk.prog >= blk.cd) {
        blk.prog -= blk.cd;
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
        deal(f, total, false, 'burn');
        f.burns = f.burns.map((x) => ({ ...x, t: x.t - TPS })).filter((x) => x.t > 0);
      }
    }

    if (t >= fStart && (t - fStart) % TPS === 0) {
      const n = ((t - fStart) / TPS + 1) * fStep;
      emit({ type: 'fatigue', amount: n });
      for (const f of F) deal(f, n, false, 'fatigue');
    }

    if (F[0].hp <= 0 || F[1].hp <= 0) {
      winner = F[0].hp === F[1].hp ? -1 : F[0].hp > F[1].hp ? 0 : 1;
      decided = true;
      break;
    }
  }
  if (!decided) {
    t = MAX_TICKS;
    const r0 = F[0].hp / F[0].maxHp;
    const r1 = F[1].hp / F[1].maxHp;
    winner = r0 === r1 ? -1 : r0 > r1 ? 0 : 1;
  }
  emit({ type: 'end', winner });
  const sides = F.map((f) => ({
    ...f.side_,
    never: f.blocks.filter((blk) => f.stats[blk.idx].c + f.stats[blk.idx].tc === 0).map((blk) => blk.idx).sort((x, y) => x - y),
    ctl: Math.round(f.side_.fr + f.side_.dl + f.side_.ctl),
  })) as [SideStat, SideStat];

  return {
    v: SIM_VERSION, seed, day, winner, ticks: t, maxHp: [F[0].maxHp, F[1].maxHp], init, events,
    stats: [F[0].stats, F[1].stats], sides,
    ...(trace ? { trace } : {}),
  };
}
