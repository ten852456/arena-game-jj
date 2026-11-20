/**
 * Life in the arena behind the grid shop: swaying lanterns, drifting petals and a bouncing crowd (ArenaLife), and the
 * hero idling and reacting to the shop (HeroIdle: breathes, blinks, looks around, happy hop on a buy, sad wobble on a
 * sell). Both live in idle.ts.
 *
 * The combat scene is driven from outside here, through its update event, so the grid shop gets this without
 * changing combatScene.ts. If the scene grows its own `react()` (the list build wires idle.ts inside the scene),
 * this module steps back and only forwards reactions to it.
 */
import type Phaser from 'phaser';
import { ArenaLife, HeroIdle } from './idle';
import { W, H, type CombatScene } from './combatScene';
import { chibiScale } from './chibi';

export type ShopReaction = 'buy' | 'sell' | 'reroll' | 'pick';

/** same numbers as combatScene.ts (ground line, hero height in world units) */
const GROUND = 250;
const HERO_S = chibiScale(116);

/** the bits of CombatScene this module reads (private there, so read through a cast) */
interface SceneInside {
  fighters?: Phaser.GameObjects.Image[];
  keys?: (string | null)[];
  playing?: boolean;
  react?: (kind: ShopReaction) => void;
}

let scene: CombatScene | null = null;
let life: ArenaLife | null = null;
let hero: HeroIdle | null = null;
let attached = '';

/** Start the arena life once the combat scene exists. Safe to call more than once. */
export function initShopLife(s: CombatScene) {
  if (scene) return;
  scene = s;
  const inside = s as unknown as SceneInside;
  if (typeof inside.react === 'function') return; // the scene animates itself
  // keep the backdrop at the back and everything that was drawn after it (fighters, bars, text) in front of the life
  const before = [...s.children.list];
  life = new ArenaLife(s, W, H, GROUND);
  hero = new HeroIdle(s);
  for (const obj of before.slice(1)) s.children.bringToTop(obj);
  s.events.on('update', (t: number, delta: number) => tick(t, delta));
}

function tick(now: number, delta: number) {
  if (!scene || !life || !hero) return;
  life.update(now, delta);
  const inside = scene as unknown as SceneInside;
  const f = inside.fighters?.[0];
  const prefix = inside.keys?.[0] ?? null;
  // the hero idles only while nothing is fighting and it is alone in the middle of the arena
  const idle = !inside.playing && !!f && f.visible && !!prefix && Math.abs(f.x - W / 2) < 30 && !inside.keys?.[1];
  if (!idle) {
    if (attached) {
      hero.detach();
      attached = '';
    }
    return;
  }
  if (attached !== prefix) {
    const m = /^chibi_(.+)_(\d+)$/.exec(prefix!);
    f!.setPosition(W / 2, GROUND).setAngle(0).setScale(HERO_S);
    hero.attach(f!, prefix!, m ? m[1] : '', m ? Number(m[2]) : 0, HERO_S);
    attached = prefix!;
  }
  hero.update(now, delta);
}

/** The hero (and the crowd, on a buy) reacts to something done in the shop. */
export function shopReact(kind: ShopReaction) {
  if (!scene) return;
  const inside = scene as unknown as SceneInside;
  if (typeof inside.react === 'function') return inside.react(kind);
  if (inside.playing) return;
  hero?.react(kind);
  if (kind === 'buy') life?.cheer();
}
