// Per-fight health metrics and mergeable accumulators (plain JSON so they cross worker threads).
import { TPS, fatigueStart } from '../../src/sim/combat';
import type { CombatResult, Side } from '../../src/sim/types';

export interface FightFacts {
  ticks: number;
  winner: Side | -1;
  /** skills cast per side (own cooldown + triggered + echo) */
  casts: [number, number];
  /** casts set off by a trigger bonus, per side */
  trig: [number, number];
  /** biggest trigger chain in one tick (casts incl. the first), per side */
  chain: [number, number];
  /** freeze + cast-delay ticks this side received */
  ctl: [number, number];
  /** damage dealt by each block, per side (index = build.skills index) */
  dmg: [number[], number[]];
  fatigue: boolean;
  /** winner ended at ≤ 10% HP */
  close: boolean;
}

export function factsOf(r: CombatResult, day: number): FightFacts {
  const casts: [number, number] = [0, 0];
  const trig: [number, number] = [0, 0];
  const chain: [number, number] = [0, 0];
  let fatigue = false;
  let curT = -1;
  const inTick: [number, number] = [0, 0];
  for (const e of r.events) {
    if (e.type === 'cast') {
      casts[e.side]++;
      if (e.t !== curT) {
        curT = e.t;
        inTick[0] = inTick[1] = 0;
      }
      if (e.from !== undefined) {
        trig[e.side]++;
        inTick[e.side]++;
        chain[e.side] = Math.max(chain[e.side], inTick[e.side] + 1);
      }
    } else if (e.type === 'fatigue') fatigue = true;
  }
  fatigue = fatigue || r.ticks >= fatigueStart(day); // same rule as balance.ts
  const sumFz = (side: Side) => r.stats[side].reduce((n, s) => n + s.fz, 0);
  const last = r.events[r.events.length - 1];
  const close = r.winner !== -1 && !!last && last.s.hp[r.winner] <= r.maxHp[r.winner] * 0.1;
  return {
    ticks: r.ticks, winner: r.winner, casts, trig, chain,
    ctl: [sumFz(1), sumFz(0)],
    dmg: [r.stats[0].map((s) => s.d), r.stats[1].map((s) => s.d)],
    fatigue, close,
  };
}

/** Mergeable health accumulator. */
export interface Health {
  fights: number;
  sides: number;
  zeroSides: number;
  /** sides that spent ≥ 25% of the fight controlled */
  lockedSides: number;
  ctlTicks: number;
  ctlMax: number;
  fatigue: number;
  close: number;
  decided: number;
  trig: number;
  chainMax: number;
  ticks: number;
  /** fight lengths in seconds (for percentiles) */
  lens: number[];
}

export const newHealth = (): Health => ({
  fights: 0, sides: 0, zeroSides: 0, lockedSides: 0, ctlTicks: 0, ctlMax: 0, fatigue: 0, close: 0, decided: 0, trig: 0, chainMax: 0, ticks: 0, lens: [],
});

export function addFight(h: Health, f: FightFacts, keepLen = true) {
  h.fights++;
  h.ticks += f.ticks;
  if (keepLen) h.lens.push(f.ticks / TPS);
  if (f.fatigue) h.fatigue++;
  if (f.winner !== -1) h.decided++;
  if (f.close) h.close++;
  for (const s of [0, 1] as const) {
    h.sides++;
    if (f.casts[s] === 0) h.zeroSides++;
    if (f.ctl[s] >= f.ticks * 0.25) h.lockedSides++;
    h.ctlTicks += f.ctl[s];
    h.ctlMax = Math.max(h.ctlMax, f.ctl[s]);
    h.trig += f.trig[s];
    h.chainMax = Math.max(h.chainMax, f.chain[s]);
  }
}

export function mergeHealth(a: Health, b: Health): Health {
  return {
    fights: a.fights + b.fights, sides: a.sides + b.sides, zeroSides: a.zeroSides + b.zeroSides, lockedSides: a.lockedSides + b.lockedSides,
    ctlTicks: a.ctlTicks + b.ctlTicks, ctlMax: Math.max(a.ctlMax, b.ctlMax), fatigue: a.fatigue + b.fatigue, close: a.close + b.close,
    decided: a.decided + b.decided, trig: a.trig + b.trig, chainMax: Math.max(a.chainMax, b.chainMax), ticks: a.ticks + b.ticks,
    lens: a.lens.concat(b.lens),
  };
}

/** Summary numbers of a Health (what goes into the JSON report). */
export function healthSummary(h: Health) {
  const lens = [...h.lens].sort((x, y) => x - y);
  const q = (p: number) => (lens.length ? lens[Math.min(lens.length - 1, Math.floor(lens.length * p))] : 0);
  const n = Math.max(1, h.fights);
  return {
    fights: h.fights,
    avgLen: h.ticks / n / TPS,
    p10: q(0.1),
    p90: q(0.9),
    zeroSkill: h.zeroSides / Math.max(1, h.sides),
    locked: h.lockedSides / Math.max(1, h.sides),
    ctlAvg: h.ctlTicks / Math.max(1, h.sides) / TPS,
    ctlMax: h.ctlMax / TPS,
    fatigue: h.fatigue / n,
    close: h.close / Math.max(1, h.decided),
    trigPerFight: h.trig / n,
    chainMax: h.chainMax,
  };
}
export type HealthSummary = ReturnType<typeof healthSummary>;
