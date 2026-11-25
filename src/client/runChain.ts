// @ts-nocheck -- written for sim v13 on engine-v12; rewired to sim v22 in the UI stage (mochi-list-v2-onchain)
/**
 * run.ts for the UI: everything re-exported, and in chain mode (`?chain=1`) every player action the local rules
 * accept is also queued as its on-chain action code (sent with the next fight, see chain.ts). Actions that do
 * nothing (selling an empty slot, moving off the end) are not queued: the chain rejects no-ops.
 */
import * as Run from '../sim/run';
import { chainQueue } from './chain';

export * from '../sim/run';

const LC: Run.LastChanceOption[] = ['awaken', 'mark', 'supply'];

export function buy(s: Run.RunState, i: number) {
  const err = Run.buy(s, i);
  if (!err) chainQueue(0, i);
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
export function reroll(s: Run.RunState) {
  const err = Run.reroll(s);
  if (!err) chainQueue(3);
  return err;
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
export function wish(s: Run.RunState) {
  const r = Run.wish(s);
  if (!('err' in r)) chainQueue(6);
  return r;
}
export function chooseLastChance(s: Run.RunState, opt: Run.LastChanceOption) {
  if (s.phase !== 'lastchance' || !LC.includes(opt)) return;
  Run.chooseLastChance(s, opt);
  chainQueue(7, LC.indexOf(opt));
}
export function applyMark(s: Run.RunState, idx: number) {
  if (s.phase !== 'mark' || !s.pendingMark) return;
  const at = idx >= 0 && idx < s.skills.length ? idx : -1;
  Run.applyMark(s, at);
  chainQueue(8, at);
}
export function concede(s: Run.RunState) {
  if (s.phase === 'won' || s.phase === 'dead') return;
  Run.concede(s);
  chainQueue(9);
}
