/**
 * Placement hints for the grid shop (GC1). Replaces auto-arrange: the game never moves your blocks for you,
 * it only shows where a block would switch connect bonuses on, and can drop NEW blocks (bag / just bought)
 * into free space without touching the ones you placed.
 *
 * Score of a spot = how many connect bonuses are on with the block there minus with it off the grid
 * (its own bonuses + bonuses of the blocks it would touch). Pure functions over a copy of the skills.
 */
import { activeBonuses, cellsOf, fits } from '../../sim/grid';
import { gridOf, type RunState } from '../../sim/run';
import type { Offer } from '../../sim/grid';
import type { Rot, SkillInstance } from '../../sim/types';

export interface Spot {
  x: number;
  y: number;
  rot: Rot;
  /** connect bonuses switched on by putting the block here */
  score: number;
}

const ROTS: Rot[] = [0, 1, 2, 3];

/** Distinct rotations of a shape (a 2×2 square has one, a bar has two). */
export function rotsOf(shape: string): Rot[] {
  const seen = new Set<string>();
  return ROTS.filter((r) => {
    const key = cellsOf(shape, r)
      .map((c) => c.join(','))
      .sort()
      .join(';');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Every spot where block i fits (in the given rotations), scored. Block i's current place is ignored. */
export function spotsFor(skills: SkillInstance[], w: number, h: number, i: number, rots: Rot[] = ROTS): Spot[] {
  const work = skills.map((k) => ({ ...k }));
  work[i] = { ...work[i], x: -1, y: -1 };
  const base = activeBonuses(work, w, h).length;
  const out: Spot[] = [];
  for (const rot of rots)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        if (!fits(work, w, h, i, x, y, rot)) continue;
        work[i] = { ...work[i], x, y, rot };
        out.push({ x, y, rot, score: activeBonuses(work, w, h).length - base });
        work[i] = { ...work[i], x: -1, y: -1 };
      }
  return out;
}

/** Bonuses switched on if block i sat at (x, y, rot); null if it does not fit there. */
export function scoreAt(skills: SkillInstance[], w: number, h: number, i: number, x: number, y: number, rot: Rot): number | null {
  if (!fits(skills, w, h, i, x, y, rot)) return null;
  const work = skills.map((k) => ({ ...k }));
  work[i] = { ...work[i], x: -1, y: -1 };
  const base = activeBonuses(work, w, h).length;
  work[i] = { ...work[i], x, y, rot };
  return activeBonuses(work, w, h).length - base;
}

/** The skills with block i moved to (x, y, rot): for live previews. */
export const withBlockAt = (skills: SkillInstance[], i: number, x: number, y: number, rot: Rot) =>
  skills.map((k, j) => (j === i ? { ...k, x, y, rot } : k));

/** Best spot by score (ties: the current rotation first, then reading order). null = no room. */
export function bestSpot(spots: Spot[], prefer?: Rot): Spot | null {
  let best: Spot | null = null;
  for (const s of spots) {
    if (!best || s.score > best.score || (s.score === best.score && s.rot === prefer && best.rot !== prefer)) best = s;
  }
  return best;
}

/** The block a shop offer would add (new skills only), as an extra skill at the end of the list. */
export function offerPiece(o: Offer): SkillInstance {
  return { id: o.id, v: o.v, shape: o.shape, rot: 0, x: -1, y: -1, bonus: o.bonus.map((b) => ({ ...b })) };
}

/** Best spot for a shop offer on the current grid (null = no room or not a new skill). */
export function offerBest(r: RunState, o: Offer): Spot | null {
  if (o.v !== '') return null;
  const { w, h } = gridOf(r);
  const skills = [...r.skills, offerPiece(o)];
  return bestSpot(spotsFor(skills, w, h, skills.length - 1, rotsOf(o.shape)));
}

/** Move block i (just bought, or from the bag) to its best free spot. Placed blocks never move. */
export function placeBest(r: RunState, i: number): boolean {
  const k = r.skills[i];
  if (!k) return false;
  const { w, h } = gridOf(r);
  const best = bestSpot(spotsFor(r.skills, w, h, i, rotsOf(k.shape)), k.rot);
  if (!best) return false;
  Object.assign(k, { x: best.x, y: best.y, rot: best.rot });
  return true;
}

/** Put every bag block into free space (biggest first, each at its best spot). Returns how many went in. */
export function placeBag(r: RunState): number {
  const order = r.skills
    .map((k, i) => ({ k, i }))
    .filter(({ k }) => k.x < 0)
    .sort((a, b) => cellsOf(b.k.shape, 0).length - cellsOf(a.k.shape, 0).length || a.i - b.i);
  let n = 0;
  for (const { i } of order) if (placeBest(r, i)) n++;
  return n;
}

