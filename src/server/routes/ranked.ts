// Ranked offers (v5.1, prize safety): the server draws the seed that decides the 3 heroes a Ranked run may start with.
//   POST /api/ranked/offer {playerId}   → { seed, heroes }
// One offer per player, kept until a Ranked run starts with it (day 1 at /api/fight): asking again returns the same
// offer, so nobody can re-roll for a hero. A start the gate refuses (no ticket) keeps it too. The seed is public once
// issued (it is the run's seed: the day-1 shop preview comes from it); the run's secret rolls stay server-only.
import { randomInt } from 'node:crypto';
import { offerFor } from '../../sim/run';
import { cleanId, rankedOfferCheck } from '../game/validate';
import { bad, type Res } from '../http/http';
import { db, save } from '../store';
import { allow } from './site';

/** offers for players with no town yet, per IP per hour (same budget as new towns) */
const NEW_OFFERS_PER_IP = 30;

export function handleRankedOffer(raw: unknown, ip: string): Res {
  const playerId = cleanId((raw as { playerId?: unknown } | null)?.playerId);
  if (!playerId) return bad('bad request');
  let o = Object.hasOwn(db.rankedOffers, playerId) ? db.rankedOffers[playerId] : undefined;
  if (!o) {
    if (!Object.hasOwn(db.farms, playerId) && !allow('rankednew:' + ip, NEW_OFFERS_PER_IP, 3_600_000)) return bad('too many new players from here, try again later', 429);
    o = db.rankedOffers[playerId] = { seed: randomInt(0, 2 ** 32 - 1), t: Date.now() };
    save();
  }
  return { status: 200, json: { seed: o.seed, heroes: offerFor('ranked', o.seed) } };
}

/** day 1 of a Ranked run: the seed must be the one issued to this player, and the hero one it offers (null = fine) */
export function rankedStartCheck(playerId: string, hero: string, seed: unknown): string | null {
  const o = Object.hasOwn(db.rankedOffers, playerId) ? db.rankedOffers[playerId] : undefined;
  if (!o || seed !== o.seed) return 'offer not issued: ask for a new one';
  return rankedOfferCheck(hero, seed);
}

/** the run started: the next Ranked run gets a fresh offer (the caller saves) */
export function takeRankedOffer(playerId: string) {
  delete db.rankedOffers[playerId];
}
