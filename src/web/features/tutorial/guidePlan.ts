/**
 * Pure helpers for the guided tutorial: which shop cards chain with each other, and a run seed whose heroes all
 * have such a pair in their day-1 shop. Nothing here changes the game rules: the seed is picked by the client
 * anyway (it only decides the heroes offered and the rolled connect bonuses).
 */
import { matches } from '../../../sim/links';
import * as R from '../../../sim/run';
import type { SkillInstance } from '../../../sim/types';

type Offer = NonNullable<R.RunState['shop'][number]>;
type Skillish = Pick<SkillInstance, 'id'> & { bonus?: SkillInstance['bonus'] };

/** Next to each other, does a or b switch on one of its connect bonuses? */
export const chains = (a: Skillish, b: Skillish) =>
  (a.bonus ?? []).some((x) => matches(x.t, b)) || (b.bonus ?? []).some((x) => matches(x.t, a));

const isNew = (o: Offer | null): o is Offer => !!o && o.v === '';

/** Two new-skill offers that chain and that the gold can pay for together: [first, second] shop indexes. */
export function chainPair(r: Readonly<R.RunState>): [number, number] | null {
  for (let i = 0; i < r.shop.length; i++)
    for (let j = 0; j < r.shop.length; j++) {
      const a = r.shop[i];
      const b = r.shop[j];
      if (i === j || !isNew(a) || !isNew(b)) continue;
      if (R.priceOf(a) + R.priceOf(b) <= r.gold && chains(a, b)) return [i, j];
    }
  return null;
}

/** A shop offer that chains with a skill the player owns and can be bought now (-1 = none). */
export function partnerOffer(r: Readonly<R.RunState>): number {
  return r.shop.findIndex((o) => isNew(o) && R.priceOf(o) <= r.gold && r.skills.some((k) => chains(k, o)));
}

/** A run seed where every offered hero's day-1 shop has a chaining pair (falls back to a random seed). */
export function tutorialSeed(tries = 300): number {
  let seed = 0;
  for (let k = 0; k < tries; k++) {
    seed = crypto.getRandomValues(new Uint32Array(1))[0];
    if (R.heroChoices(seed).every((h) => chainPair(R.newRun(h, seed, 'guide')))) return seed;
  }
  return seed;
}
