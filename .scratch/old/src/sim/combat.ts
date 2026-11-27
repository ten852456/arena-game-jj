import { HEROES_BY_ID, type CombatHooks, type HookFighter } from './heroes';
import { activeBonuses, bonusTotals } from './links';
import { Rng } from './rng';
import { SKILLS, execNode, lvOf, nodeOf, type Ctx, type FighterView } from './skills';
import type {
  BlockStat, Build, CombatEvent, CombatResult, CooldownTrace, EventBody, Fx, Mark, Side, SkillInstance, Snap, StatusKind,
} from './types';

/**
 * Pure, deterministic auto-battle. No Date, no Math.random, no I/O.
 * simulate(a, b, seed, day) always returns the same events, so the server decides
 * the result and the browser (or a shared replay link) just plays it back.
 *
 * Every equipped skill runs its own cooldown at the same time. When it is ready it fires.
 * Connect bonuses work when the skill right above or below matches their condition. A trigger bonus makes the
 * matching neighbour fire right away too, without resetting its cooldown. Ties fire top to bottom.
 */

/** Bump when combat rules or numbers change: old replays can no longer be re-simulated. */
export const SIM_VERSION = 9;
export const TPS = 10; // ticks per second
export const MAX_TICKS = 90 * TPS;
/**
 * Base HP per day, tuned with `npm run balance` so fights last ≈10–13s on days 1–3,
 * 15–22s on days 4–7 and 23–30s on day 8+ (bot damage per second grows about linearly with the day).
 */
const HP_BY_DAY = [16, 18, 21, 36, 46, 56, 66, 105, 116, 134, 152, 172, 192];
export const hpFor = (day: number) => {
  const d = Math.max(1, Math.floor(day));
  return d <= HP_BY_DAY.length ? HP_BY_DAY[d - 1] : HP_BY_DAY[HP_BY_DAY.length - 1] + 60 * (d - HP_BY_DAY.length);
};
/** Fatigue: after this many ticks both sides take growing damage (a backstop that ends stalled fights). */
export const fatigueStart = (day: number) => Math.round(Math.min(30, day <= 3 ? 14 : 9 + 2 * day) * TPS);
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
}

const sum = (xs: Stack[]) => xs.reduce((n, x) => n + x.v, 0);

/** haste = cooldown cut from connect bonuses (0.2 per haste bonus, at most halved) */
export function cdTicks(k: Pick<SkillInstance, 'id' | 'v' | 'mark'>, haste = 0): number {
  const base = nodeOf(k).cd * (k.mark === 'quick' ? 0.6 : 1) * Math.max(0.5, 1 - haste);
  return Math.max(5, Math.round(base));
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
      power: t.power, dmg: t.dmg, shieldOnFire: t.shield, triggers: t.triggers, // indexes into `skills` = into blocks
    });
  });
  return out;
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

  /** power = cast power (connect bonus × echo); bonusDmg = + damage per hit from connect bonuses */
  function runSkill(f: Fighter, foe: Fighter, blk: Block, power: number, bonusDmg: number) {
    const inst = blk.inst;
    const st = f.stats[blk.idx];
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
        if (foe.ignoreFreeze) {
          foe.ignoreFreeze = false;
          emit({ type: 'status', side: foe.side, status: 'freeze', value: 0 });
          return;
        }
        let ticks = secs * TPS;
        if (f.hooks.freezeTicks) ticks = f.hooks.freezeTicks(ticks);
        ticks *= Math.pow(FREEZE_DR, foe.freezeN) * foe.ctlKeep; // diminishing returns (recovers over time), ใจเหล็ก
        ticks = Math.max(0, Math.min(MAX_FREEZE_TICKS, fCap - foe.frozenTotal, Math.round(ticks)));
        foe.freezeN++;
        if (ticks > foe.frozen) {
          foe.frozenTotal += ticks - foe.frozen;
          st.fz += ticks - foe.frozen;
          foe.frozen = ticks;
        }
        emit({ type: 'status', side: foe.side, status: 'freeze', value: ticks });
      },
      slow(pct0, secs0) {
        const [pct, secs] = f.hooks.slow ? f.hooks.slow(pct0, secs0) : [pct0, secs0];
        const p = Math.min(SLOW_CAP, pct * foe.ctlKeep);
        foe.slowPct = foe.slowT > 0 ? Math.max(foe.slowPct, p) : p;
        // total slowed time per fight is capped (twice the freeze cap); past it, slows are resisted
        const room = Math.max(0, sCap - foe.slowTotal - foe.slowT);
        const add = Math.min(room, Math.max(0, secs * TPS - foe.slowT));
        if (add <= 0 && foe.slowT <= 0) {
          emit({ type: 'status', side: foe.side, status: 'slow', value: 0 });
          return;
        }
        foe.slowT += add;
        emit({ type: 'status', side: foe.side, status: 'slow', value: Math.round(p * 100) });
      },
      delay(secs) {
        // cast delay: every enemy cooldown goes back. Diminishes with repeated use and shares the control cap with freeze.
        let ticks = secs * TPS * Math.pow(FREEZE_DR, foe.delayN) * foe.ctlKeep;
        ticks = Math.max(0, Math.min(fCap - foe.frozenTotal, Math.round(ticks)));
        foe.delayN++;
        if (ticks > 0) {
          foe.frozenTotal += ticks;
          st.fz += ticks;
          for (const b of foe.blocks) b.prog = Math.max(0, b.prog - ticks);
        }
        emit({ type: 'status', side: foe.side, status: 'delay', value: ticks });
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
        emit({ type: 'status', side: f.side, status: 'steadfast', value: 1 });
      },
      amplify(cap) {
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
        if (f.frozen > 0) { f.frozen = 0; n++; }
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

  /** Fires one skill (plus its mark effects and shield-on-fire bonus). from = block that triggered it. */
  function fireOne(f: Fighter, bi: number, from: number | undefined) {
    const foe = F[1 - f.side];
    const blk = f.blocks[bi];
    const inst = blk.inst;
    const st = f.stats[blk.idx];
    if (from === undefined) st.c++;
    else st.tc++;
    emit({
      type: 'cast', side: f.side, skill: inst.id, lv: lvOf(inst.v), idx: blk.idx,
      ...(from !== undefined ? { from: f.blocks[from].idx } : {}),
    });
    runSkill(f, foe, blk, blk.power, blk.dmg);
    if (blk.shieldOnFire > 0 && f.hp > 0) {
      f.shield += blk.shieldOnFire;
      st.sh += blk.shieldOnFire;
      emit({ type: 'shield', side: f.side, amount: blk.shieldOnFire });
    }
    if (inst.mark === 'echo' && foe.hp > 0 && f.hp > 0) {
      emit({ type: 'cast', side: f.side, skill: inst.id, lv: lvOf(inst.v), idx: blk.idx, echo: true });
      runSkill(f, foe, blk, blk.power * 0.5, Math.round(blk.dmg * 0.5));
    }
    if (inst.mark === 'burn' && foe.hp > 0) addBurn(foe, 1, 3, blk.idx);
  }

  /** Fire a skill, then the neighbours its trigger bonuses set off (breadth-first), each at most once per chain. */
  function fire(f: Fighter, start: number) {
    const seen = new Set<number>([start]);
    const queue: { bi: number; depth: number; from?: number }[] = [{ bi: start, depth: 0 }];
    while (queue.length) {
      const q = queue.shift()!;
      if (f.hp <= 0 || F[1 - f.side].hp <= 0) return;
      fireOne(f, q.bi, q.from);
      if (q.depth >= MAX_CHAIN) continue;
      for (const bi of f.blocks[q.bi].triggers) {
        if (seen.has(bi)) continue;
        seen.add(bi);
        queue.push({ bi, depth: q.depth + 1, from: q.bi });
      }
    }
  }

  function act(f: Fighter) {
    if (f.hp <= 0 || f.blocks.length === 0) return;
    const frozen = f.frozen > 0;
    if (frozen) f.frozen--;
    const rate = f.slowT > 0 ? 1 - f.slowPct : 1;
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
    for (const s of order) act(F[s]);
    record();
    for (const f of F) {
      if (f.slowT > 0) {
        f.slowT--;
        f.slowTotal++;
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

  return {
    v: SIM_VERSION, seed, day, winner, ticks: t, maxHp: [F[0].maxHp, F[1].maxHp], init, events,
    stats: [F[0].stats, F[1].stats],
    ...(trace ? { trace } : {}),
  };
}
