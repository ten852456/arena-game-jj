/**
 * run.ts for the UI: everything re-exported. In chain mode (the default; `?chain=0` = off) every DETERMINISTIC action the local rules
 * accept (buy, sell, move, lock, slot, pick relic, concede) is also queued as its on-chain action code and sent with
 * the next chain transaction (chain.ts). Actions with a random outcome (reroll, wish, last chance, mark, relic
 * reroll, fight) are not played locally in chain mode: ui.ts sends them with chain.chainRoll and takes the chain's
 * state. Actions that do nothing (selling an empty slot, moving off the end) are not queued: the chain rejects no-ops.
 */
import * as Run from '../sim/run';
import { nextVariants } from '../sim/skills';
import { chainQueue } from './chain';

export * from '../sim/run';

/** buy offer i; `pick` = the upgrade branch (variant), sent as its index among the two next branches (-1 = the card's) */
export function buy(s: Run.RunState, i: number, pick?: string) {
  const o = s.shop[i];
  const owned = o ? s.skills.find((k) => k.id === o.id) : undefined;
  const b = pick === undefined || !owned ? -1 : nextVariants(owned.v).indexOf(pick as never);
  const err = Run.buy(s, i, pick);
  if (!err) chainQueue(0, i, b);
  return err;
}
export function sell(s: Run.RunState, i: number) {
  if (!s.skills[i]) return;
  Run.sell(s, i);
  chainQueue(1, i);
}
export function moveSkill(s: Run.RunState, i: number, dir: -1 | 1) {
  if (!s.skills[i] || !s.skills[i + dir]) return;
  Run.moveSkill(s, i, dir);
  chainQueue(2, i, dir);
}
export function toggleLock(s: Run.RunState, i: number) {
  const err = Run.toggleLock(s, i);
  if (!err) chainQueue(4, i);
  return err;
}
export function buySlot(s: Run.RunState) {
  const err = Run.buySlot(s);
  if (!err) chainQueue(5);
  return err;
}
export function pickRelic(s: Run.RunState, i: number) {
  const err = Run.pickRelic(s, i);
  if (!err) chainQueue(11, i);
  return err;
}
export function concede(s: Run.RunState) {
  if (s.phase === 'won' || s.phase === 'dead') return;
  Run.concede(s);
  chainQueue(9);
}
