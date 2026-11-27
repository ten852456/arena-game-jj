// "lines" report jobs: does following your hero's line pay off? (in-line vs off-line builds, day-1 openings,
// how much the ultimate is worth). Pure functions of their input, like jobs.ts.
import { aiBuild, arrangeList, randomAiBuild } from '../../src/sim/bot';
import { simulate } from '../../src/sim/combat';
import { HEROES_BY_ID, ultLevel } from '../../src/sim/heroes';
import { hashSeed } from '../../src/sim/rng';
import { DAY1_GOLD, buy, newRun, priceOf, toBuild } from '../../src/sim/run';
import type { Build } from '../../src/sim/types';
import type { Ctx } from './jobs';

const pts = (w: number, side: 0 | 1) => (w === side ? 1 : w === -1 ? 0.5 : 0);
/** both sides of one pairing (cancels side bias): points of `a` out of 2 */
const duel = (a: Build, b: Build, seed: number, day: number, noUlt: [boolean, boolean] = [false, false]) =>
  pts(simulate(a, b, seed, day, { noUlt }).winner, 0) + pts(simulate(b, a, seed, day, { noUlt: [noUlt[1], noUlt[0]] }).winner, 1);

export interface LinesRes {
  /** in-line vs off-line, same hero, head to head (points, fights) */
  h2h: number;
  n: number;
  /** each vs random normal bots of the same day */
  inPool: number;
  offPool: number;
  /** in-line builds by ult level: [fights, points with ult, points with the ult locked] */
  ult: Record<number, [number, number, number]>;
  /** skill ids (with Lv2 branch letter) owned by the in-line / off-line builds */
  inSkills: Record<string, number>;
  offSkills: Record<string, number>;
}

export type LinesJob =
  | { k: 'lines'; c: Ctx; day: number; hero: string; from: number; to: number; tier: 'normal' | 'hard' }
  | { k: 'day1'; c: Ctx; hero: string; n: number };

const skillKey = (id: string, v: string) => (v.length >= 1 ? `${id}-${v[0]}` : id);

export function runLinesJob(j: LinesJob): unknown {
  const { c } = j;
  if (j.k === 'lines') {
    const h = HEROES_BY_ID[j.hero];
    const r: LinesRes = { h2h: 0, n: 0, inPool: 0, offPool: 0, ult: {}, inSkills: {}, offSkills: {} };
    for (let i = j.from; i < j.to; i++) {
      const inB = aiBuild(h.id, j.day, [h.line], hashSeed(c.seed, 'ln-in', h.id, j.day, i), j.tier);
      const offB = aiBuild(h.id, j.day, [], hashSeed(c.seed, 'ln-off', h.id, j.day, i), j.tier, h.line);
      const opp = randomAiBuild(j.day, hashSeed(c.seed, 'ln-opp', h.id, j.day, i), 'normal');
      const seed = hashSeed(c.seed, 'ln-f', h.id, j.day, i);
      r.h2h += duel(inB, offB, seed, j.day);
      r.inPool += duel(inB, opp, seed + 1, j.day);
      r.offPool += duel(offB, opp, seed + 1, j.day);
      r.n += 2;
      const lv = ultLevel(inB);
      if (lv > 0) {
        const u = (r.ult[lv] ??= [0, 0, 0]);
        u[0] += 2;
        u[1] += duel(inB, opp, seed + 1, j.day);
        u[2] += duel(inB, opp, seed + 1, j.day, [true, false]);
      }
      for (const k of inB.skills) r.inSkills[skillKey(k.id, k.v)] = (r.inSkills[skillKey(k.id, k.v)] ?? 0) + 1;
      for (const k of offB.skills) r.offSkills[skillKey(k.id, k.v)] = (r.offSkills[skillKey(k.id, k.v)] ?? 0) + 1;
    }
    return r;
  }
  // day 1: every affordable opening from the hero's fixed shop vs random day-1 bots (easy, as the server uses on days 1–2,
  // and normal)
  const h = HEROES_BY_ID[j.hero];
  const shop = newRun(h.id, 1, 'd1').shop;
  const combos: number[][] = [];
  for (let a = 0; a < shop.length; a++)
    for (let b = a + 1; b < shop.length; b++) {
      const cost = priceOf(shop[a]!) + priceOf(shop[b]!);
      if (cost <= DAY1_GOLD) combos.push([a, b]);
    }
  const out: Record<string, { easy: number; normal: number; n: number }> = {};
  for (const cb of combos) {
    const key = cb.map((i) => shop[i]!.id).join('+');
    const acc = (out[key] = { easy: 0, normal: 0, n: 0 });
    for (let i = 0; i < j.n; i++) {
      const s = newRun(h.id, hashSeed(c.seed, 'd1', h.id, i), 'd1');
      for (const x of cb) buy(s, x);
      arrangeList(s.skills);
      const me = toBuild(s);
      const seed = hashSeed(c.seed, 'd1f', h.id, key, i);
      acc.easy += duel(me, randomAiBuild(1, hashSeed(c.seed, 'd1e', i), 'easy'), seed, 1);
      acc.normal += duel(me, randomAiBuild(1, hashSeed(c.seed, 'd1n', i), 'normal'), seed, 1);
      acc.n += 2;
    }
  }
  return out;
}
