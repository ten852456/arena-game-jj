import Phaser from 'phaser';
import { BUILDINGS } from './townData';
import { IMAGES } from '../../art/assets';
import { ZOOM } from '../../app/view';
import { L } from '../../../shared/i18n';
import type { FarmView } from '../../app/api';

let resolveTown!: (s: TownScene) => void;
export const townReady = new Promise<TownScene>((r) => (resolveTown = r));

const W = 640;
const H = 300;
const FONT = 'Kanit, sans-serif';
/** the ground map (16:9) fitted to the full height: the whole town on one screen, no scrolling */
const MAP_H = H;
const MAP_W = (MAP_H * 16) / 9;
const MAP_X = (W - MAP_W) / 2;
/** sprite key and on-map width per landmark */
const SPRITE: Record<string, [string, number]> = {
  mine: ['tdMine', 84], shrine: ['tdShrine', 82], lumber: ['tdLumber', 82], hall: ['tdHall', 80],
  arena: ['tdArena', 104], board: ['tdBoard', 82], tower: ['tdTower', 58], market: ['tdMarket', 80],
};
const PRODUCER: Record<string, 'wood' | 'ore' | 'crystal'> = { lumber: 'wood', mine: 'ore', shrine: 'crystal' };
const RES_KEY = { wood: 'resWood', ore: 'resOre', crystal: 'resCrystal' } as const;
/** the egg nest sits on the plaza, in front of the arena */
const NEST: [number, number] = [0.5, 0.75];

const at = (fx: number, fy: number): [number, number] => [MAP_X + fx * MAP_W, fy * MAP_H];
/**
 * A tap counts on the map only when it landed on the canvas itself: Phaser also hears pointer-ups over HTML laid on
 * top (a building window), and a click on its Upgrade button would otherwise tap the arena underneath.
 */
const onCanvas = (p: Phaser.Input.Pointer) => (p.event?.target as Element | null)?.tagName === 'CANVAS';

/**
 * Top-down town (sim farm, 2026-11-26): the ground map with every landmark on its plot, all on one screen.
 * Over each producer a bubble shows what is ready (tap = collect); badges mark an egg to hatch or a hero to
 * unlock; tapping the arena goes straight to battle. Replaces the side-scrolling town (playtest: too much
 * scrolling, nothing on the map showed what was ready).
 */
export class TownScene extends Phaser.Scene {
  onSelect?: (id: string) => void;
  /** the arena was tapped */
  onEnter?: (id: string) => void;
  /** a ready bubble over a producer was tapped */
  onCollect?: (id: string) => void;
  private images = new Map<string, Phaser.GameObjects.Image>();
  private labels = new Map<string, Phaser.GameObjects.Text>();
  private subs = new Map<string, Phaser.GameObjects.Text>();
  private bubbles = new Map<string, { box: Phaser.GameObjects.Container; bg: Phaser.GameObjects.Graphics; icon: Phaser.GameObjects.Image; text: Phaser.GameObjects.Text }>();
  private badges = new Map<string, Phaser.GameObjects.Container>();
  private ring!: Phaser.GameObjects.Graphics;
  private nest!: Phaser.GameObjects.Image;

  constructor() {
    super({ key: 'town', active: true });
  }

  preload() {
    const img = IMAGES as unknown as Record<string, string>;
    this.load.image('townGround', img.townGround);
    for (const [k] of Object.values(SPRITE)) this.load.image(k, img[k]);
    this.load.image('tdNest', img.tdNest);
    for (const k of Object.values(RES_KEY)) this.load.image(k, img[k]);
  }

  create() {
    const cam = this.cameras.main;
    cam.setOrigin(0, 0).setZoom(ZOOM).setBackgroundColor('#1b1433');
    this.add.image(MAP_X, 0, 'townGround').setOrigin(0, 0).setDisplaySize(MAP_W, MAP_H).setDepth(0);

    this.ring = this.add.graphics().setDepth(1);
    for (const b of BUILDINGS) {
      const [key, w] = SPRITE[b.id] ?? ['tdHall', 80];
      const [x, y] = at(b.pos[0], b.pos[1]);
      const img = this.add.image(x, y + 12, key).setOrigin(0.5, 0.86).setDepth(2 + y / 1000);
      img.setScale(w / img.width).setInteractive({ useHandCursor: true });
      if (!b.open) img.setAlpha(0.55);
      img.on('pointerover', () => img.setTint(0xfff1c8));
      img.on('pointerout', () => img.clearTint());
      img.on('pointerup', (p: Phaser.Input.Pointer) => onCanvas(p) && this.tapBuilding(b.id));
      const label = this.add
        .text(x, y + 16, b.name, { fontFamily: FONT, fontSize: '11px', color: '#ffffff', stroke: '#1d1612', strokeThickness: 4 })
        .setOrigin(0.5, 0)
        .setDepth(6);
      // workers sit on the label's line ("Mine 1/2"), so nothing reaches into the row below
      const sub = this.add
        .text(x, y + 17, '', { fontFamily: FONT, fontSize: '9px', color: '#ffe3a3', stroke: '#1d1612', strokeThickness: 3 })
        .setOrigin(0, 0)
        .setDepth(6);
      this.images.set(b.id, img);
      this.labels.set(b.id, label);
      this.subs.set(b.id, sub);
      // the ready bubble sits on the roof, low enough that the top row never clips it
      if (PRODUCER[b.id]) this.makeBubble(b.id, x, Math.max(14, y - img.displayHeight * 0.55));
    }
    const [nx, ny] = at(NEST[0], NEST[1]);
    this.nest = this.add.image(nx, ny, 'tdNest').setDepth(3).setInteractive({ useHandCursor: true });
    this.nest.setScale(40 / this.nest.width);
    this.nest.on('pointerup', (p: Phaser.Input.Pointer) => onCanvas(p) && this.tapBuilding('hall'));
    this.makeBadge('nest', nx + 14, ny - 12, '!', 0xff7a93);
    const hall = this.images.get('hall')!;
    this.makeBadge('hall', hall.x + 30, hall.y - hall.displayHeight * 0.8, '↑', 0x8fdcb0);
    this.refreshLabels();
    resolveTown(this);
  }

  private makeBubble(id: string, x: number, y: number) {
    const bg = this.add.graphics();
    const icon = this.add.image(-12, 0, RES_KEY[PRODUCER[id]]);
    icon.setScale(14 / Math.max(icon.width, icon.height));
    const text = this.add.text(-3, 0, '', { fontFamily: FONT, fontSize: '11px', color: '#3a2b48', fontStyle: 'bold' }).setOrigin(0, 0.5);
    const box = this.add.container(x, y, [bg, icon, text]).setDepth(8).setVisible(false);
    box.setSize(56, 20).setInteractive({ useHandCursor: true });
    box.on('pointerup', (p: Phaser.Input.Pointer) => onCanvas(p) && this.onCollect?.(id));
    this.tweens.add({ targets: box, y: y - 3, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    this.bubbles.set(id, { box, bg, icon, text });
  }

  private makeBadge(id: string, x: number, y: number, mark: string, color: number) {
    const g = this.add.graphics().fillStyle(color).fillCircle(0, 0, 7).lineStyle(1.5, 0x1d1612).strokeCircle(0, 0, 7);
    const t = this.add.text(0, 0, mark, { fontFamily: FONT, fontSize: '10px', color: '#1d1612', fontStyle: 'bold' }).setOrigin(0.5);
    const c = this.add.container(x, y, [g, t]).setDepth(9).setVisible(false);
    this.tweens.add({ targets: c, scale: 1.15, duration: 600, yoyo: true, repeat: -1 });
    this.badges.set(id, c);
  }

  private tapBuilding(id: string) {
    if (id === 'arena') return this.onEnter?.('arena');
    this.onSelect?.(id);
  }

  /** Show the farm on the map: ready bubbles, worker counts, badges. Null hides them (no farm data). */
  setFarm(f: FarmView | null, canUnlock = false) {
    for (const [id, b] of this.bubbles) {
      const jobs = f?.jobs[id as 'lumber'] ?? [];
      const ready = jobs.reduce((a, j) => a + j.ready, 0);
      const full = jobs.some((j) => j.fill >= 1);
      b.box.setVisible(ready > 0);
      if (ready > 0) {
        b.text.setText(`+${ready}${full ? ' ' + L('เต็ม', 'FULL') : ''}`);
        const w = 24 + b.text.width;
        b.bg.clear().fillStyle(full ? 0xffe3a3 : 0xfff4e4).fillRoundedRect(-20, -10, w, 20, 10).lineStyle(1.5, 0x3a2b48).strokeRoundedRect(-20, -10, w, 20, 10);
        b.box.setSize(w, 20);
      }
      const sub = this.subs.get(id);
      const label = this.labels.get(id);
      if (sub && label) {
        sub.setText(f ? ` ${jobs.length}/${f.slots[id as 'lumber']}` : '');
        // the label and its worker count centred together on the plot
        const total = label.width + sub.width;
        label.setOrigin(0, 0).setX(this.images.get(id)!.x - total / 2);
        sub.setX(label.x + label.width);
      }
    }
    this.badges.get('nest')?.setVisible(!!f?.eggs[0] && f.eggs[0].h >= f.eggs[0].need);
    this.nest.setVisible(!!f?.eggs.length);
    this.badges.get('hall')?.setVisible(canUnlock);
  }

  /**
   * Screen rectangle (CSS px) of a landmark, for the guided tutorial's spotlight. 'bubble' = the arena too
   * (the side-view town had an "Enter" bubble over it). Null when not on screen.
   */
  screenRect(id: string): DOMRect | null {
    const img = this.images.get(id === 'bubble' ? 'arena' : id);
    const b = img?.getBounds();
    if (!b || !this.sys.isActive()) return null;
    const cr = this.game.canvas.getBoundingClientRect();
    if (!cr.width) return null;
    const k = cr.width / this.scale.width;
    const cam = this.cameras.main;
    return new DOMRect(cr.left + (b.x - cam.scrollX) * cam.zoom * k, cr.top + (b.y - cam.scrollY) * cam.zoom * k, b.width * cam.zoom * k, b.height * cam.zoom * k);
  }

  /** Re-draw the building labels after a language change. */
  refreshLabels() {
    for (const b of BUILDINGS) this.labels.get(b.id)?.setText(b.open ? b.name : `${b.name} · ${L('เร็วๆ นี้', 'soon')}`);
  }

  setSelected(id: string | null) {
    this.ring.clear();
    const img = id ? this.images.get(id) : null;
    if (!img) return;
    this.ring.lineStyle(2, 0xffd56b, 0.95).strokeEllipse(img.x, img.y - 2, img.displayWidth * 0.95, img.displayWidth * 0.36);
  }

  /** The whole town is on screen: nothing to scroll to. Kept for callers of the side-view town. */
  focus(id: string) {
    this.setSelected(id);
  }
}
