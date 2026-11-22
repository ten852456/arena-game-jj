import Phaser from 'phaser';
import { HEROES } from '../sim/heroes';
import { drawTownBackdrop, FOLK_COLORS, makeTownArt, R, RABBIT } from './townArt';
import { BUILDINGS, BUILDING_BY_ID, RABBIT_X, WORLD_W } from './townData';
import { ZOOM } from './view';
import { perf } from './perf';
import { L } from '../i18n';

let resolveTown!: (s: TownScene) => void;
export const townReady = new Promise<TownScene>((r) => (resolveTown = r));

const W = 640;
const H = 300;
const GROUND = 258;
const FONT = 'Kanit, sans-serif';
const TAP_SLOP = 8; // px a pointer may move and still count as a tap
// minimap bar
const MX = 170;
const MW = 300;
const MH = 14;
const MY = 300 - MH - 4; // bottom strip, below the road, so tall buildings' labels never collide

/** Side-scrolling town: drag left/right, tap a landmark. */
export class TownScene extends Phaser.Scene {
  onSelect?: (id: string) => void;
  /** the arena was tapped while selected, or its "Enter" bubble was tapped */
  onEnter?: (id: string) => void;
  /** big "Enter the arena ▶" bubble over the arena while it is selected */
  private bubble!: Phaser.GameObjects.Container;
  private bubbleText!: Phaser.GameObjects.Text;
  private bubbleBg!: Phaser.GameObjects.Graphics;
  private bubbleW = 0;
  private bubbleH = 0;
  private images = new Map<string, Phaser.GameObjects.Image>();
  private labels = new Map<string, Phaser.GameObjects.Text>();
  private selected: string | null = null;
  private arrow!: Phaser.GameObjects.Graphics;
  private mini!: Phaser.GameObjects.Graphics;
  private clouds: Phaser.GameObjects.Image[] = [];
  private cloudWrap = 0;
  private dragging = false;
  private onMini = false;
  private downX = 0;
  private downScroll = 0;
  private moved = 0;
  private vel = 0; // px per ms, for inertia
  private lastX = 0;
  private lastT = 0;
  private cursors?: Phaser.Types.Input.Keyboard.CursorKeys;

  constructor() {
    super({ key: 'town', active: true });
  }

  private clamp(x: number) {
    return Phaser.Math.Clamp(x, 0, WORLD_W - W);
  }

  create() {
    makeTownArt(this);
    const cam = this.cameras.main;
    cam.setOrigin(0, 0).setZoom(ZOOM); // scroll is clamped by hand, see clamp()

    const bd = drawTownBackdrop(this, WORLD_W, W, H, GROUND);
    this.clouds = bd.clouds;
    this.cloudWrap = bd.cloudWrap;

    this.addRabbit();

    for (const b of BUILDINGS) {
      const img = this.add
        .image(b.x, GROUND + 4, 'bld_' + b.id)
        .setOrigin(0.5, 1)
        .setScale(1 / R)
        .setDepth(2)
        .setInteractive({ useHandCursor: true });
      // desktop hover: warm tint + soft glow (glow needs WebGL; canvas renderer just tints)
      img.on('pointerover', () => {
        img.setTint(0xfff1c8);
        if (b.open && perf().hoverGlow && !img.preFX?.list.length) img.preFX?.addGlow(0xffd56b, 3, 0, false, 0.1, 12);
      });
      img.on('pointerout', () => {
        img.clearTint();
        img.preFX?.clear();
      });
      const label = this.add
        .text(b.x, img.y - img.displayHeight - 6, b.name, {
          fontFamily: FONT, fontSize: '16px', color: '#ffffff', stroke: '#1d1612', strokeThickness: 5,
        })
        .setOrigin(0.5, 1)
        .setDepth(6);
      this.images.set(b.id, img);
      this.labels.set(b.id, label);
    }

    // townsfolk: little mochi bunnies hop between the buildings
    const ranges: [number, number][] = [[900, 1250], [980, 1500], [1250, 1750], [600, 1100]];
    HEROES.forEach((_h, i) => {
      const [a, b] = ranges[i % ranges.length];
      const s = this.add
        .image(Phaser.Math.Between(a, b), GROUND + 22, 'folk_' + (i % FOLK_COLORS.length))
        .setOrigin(0.5, 1)
        .setScale(1 / R)
        .setDepth(5);
      this.wander(s, a, b);
    });

    this.arrow = this.add.graphics().setDepth(8);
    this.arrow.fillStyle(0xffd56b).fillTriangle(-8, 0, 8, 0, 0, 10);
    this.arrow.lineStyle(1.5, 0x2f2538).strokeTriangle(-8, 0, 8, 0, 0, 10);
    this.arrow.setVisible(false);

    this.mini = this.add.graphics().setScrollFactor(0).setDepth(10);

    this.bubbleBg = this.add.graphics();
    this.bubbleText = this.add
      .text(0, 0, '', { fontFamily: FONT, fontSize: '17px', color: '#2a1a08', fontStyle: 'bold' })
      .setOrigin(0.5, 0.5);
    this.bubble = this.add.container(0, 0, [this.bubbleBg, this.bubbleText]).setDepth(9).setVisible(false);
    this.paintBubble();
    this.tweens.add({ targets: this.bubble, scale: 1.07, duration: 520, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

    // ---- input: drag to scroll, tap to select, minimap to jump ----
    // pointer x/y are canvas pixels; divide by ZOOM to get view units
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      const px = p.x / ZOOM;
      if (this.inMini(p)) {
        this.onMini = true;
        this.jumpMini(px);
        return;
      }
      this.tweens.killTweensOf(cam);
      this.dragging = true;
      this.downX = this.lastX = px;
      this.downScroll = cam.scrollX;
      this.moved = 0;
      this.vel = 0;
      this.lastT = this.time.now;
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      const px = p.x / ZOOM;
      if (this.onMini && p.isDown) return this.jumpMini(px);
      if (!this.dragging) return;
      cam.scrollX = this.clamp(this.downScroll - (px - this.downX));
      this.moved = Math.max(this.moved, Math.abs(px - this.downX));
      const now = this.time.now;
      const dt = now - this.lastT;
      if (dt > 0) this.vel = (-(px - this.lastX) / dt) * 0.6 + this.vel * 0.4;
      this.lastX = px;
      this.lastT = now;
    });
    const up = (p: Phaser.Input.Pointer) => {
      if (this.onMini) {
        this.onMini = false;
        return;
      }
      if (!this.dragging) return;
      this.dragging = false;
      if (this.moved < TAP_SLOP) {
        this.vel = 0;
        this.tap(p);
      } else if (this.time.now - this.lastT > 90) {
        this.vel = 0; // held still before releasing → no fling
      }
    };
    this.input.on('pointerup', up);
    this.input.on('pointerupoutside', up);
    this.input.on('wheel', (_p: unknown, _o: unknown, dx: number, dy: number) => {
      this.tweens.killTweensOf(cam);
      this.vel = 0;
      cam.scrollX = this.clamp(cam.scrollX + (dx + dy) / ZOOM);
    });
    this.cursors = this.input.keyboard?.createCursorKeys();

    cam.scrollX = this.clamp(BUILDING_BY_ID.hall.x - W / 2);
    resolveTown(this);
  }

  /** The landmark: a giant mochi rabbit pounding mochi; the mallet swings and the mochi squashes. */
  private addRabbit() {
    const s = 1 / R;
    const left = RABBIT_X - RABBIT.w / 2;
    const top = GROUND + 4 - RABBIT.h;
    this.add.image(RABBIT_X, GROUND + 4, 'deco_rabbit').setOrigin(0.5, 1).setScale(s).setDepth(2);
    const mochi = this.add
      .image(left + RABBIT.mochi[0], top + RABBIT.mochi[1], 'deco_mochi')
      .setOrigin(0.5, 1)
      .setScale(s)
      .setDepth(2.1);
    const k = RABBIT.kine;
    const kine = this.add
      .image(left + RABBIT.shoulder[0], top + RABBIT.shoulder[1], 'deco_kine')
      .setOrigin(k.px / k.w, 0.5)
      .setScale(s)
      .setDepth(2.2)
      .setAngle(40);
    this.tweens.add({
      targets: kine,
      angle: -12,
      duration: 300,
      ease: 'Quad.easeIn',
      yoyo: true,
      hold: 140,
      repeatDelay: 650,
      repeat: -1,
      onYoyo: () =>
        this.tweens.add({ targets: mochi, scaleY: s * 0.6, scaleX: s * 1.2, duration: 90, yoyo: true, ease: 'Sine.easeOut' }),
    });
  }

  /** Bunnies hop to a random spot in their range, rest, then pick another. */
  private wander(s: Phaser.GameObjects.Image, a: number, b: number) {
    const tx = Phaser.Math.Between(a, b);
    const base = GROUND + 22;
    s.setFlipX(tx < s.x);
    const hops = Math.max(1, Math.round(Math.abs(tx - s.x) / 26));
    this.tweens.add({
      targets: s,
      x: tx,
      duration: hops * 340,
      onComplete: () => this.time.delayedCall(Phaser.Math.Between(600, 2800), () => this.wander(s, a, b)),
    });
    this.tweens.add({ targets: s, y: base - 7, duration: 170, yoyo: true, repeat: hops - 1, ease: 'Sine.easeOut' });
  }

  private inMini(p: Phaser.Input.Pointer) {
    const x = p.x / ZOOM;
    const y = p.y / ZOOM;
    return y >= MY - 6 && x >= MX - 4 && x <= MX + MW + 4;
  }

  private jumpMini(x: number) {
    this.vel = 0;
    this.tweens.killTweensOf(this.cameras.main);
    this.cameras.main.scrollX = this.clamp(((x - MX) / MW) * WORLD_W - W / 2);
  }

  private tap(p: Phaser.Input.Pointer) {
    const wp = this.cameras.main.getWorldPoint(p.x, p.y);
    if (this.bubble.visible && this.bubbleBounds().contains(wp.x, wp.y)) return this.onEnter?.('arena');
    for (const b of [...BUILDINGS].reverse()) {
      const img = this.images.get(b.id)!;
      const lbl = this.labels.get(b.id)!;
      if (img.getBounds().contains(wp.x, wp.y) || lbl.getBounds().contains(wp.x, wp.y)) {
        // the arena: first tap selects it and shows the "Enter" bubble, the next tap goes in
        if (b.id === 'arena' && this.selected === 'arena') return this.onEnter?.('arena');
        this.focus(b.id);
        this.onSelect?.(b.id);
        return;
      }
    }
  }

  private paintBubble() {
    this.bubbleText.setText(L('เข้าอารีน่า ▶', 'Enter arena ▶'));
    const w = Math.ceil(this.bubbleText.width) + 28;
    const h = 34;
    this.bubbleBg
      .clear()
      .fillStyle(0x1d1612, 0.35)
      .fillRoundedRect(-w / 2 + 2, -h / 2 + 3, w, h, 14)
      .fillStyle(0xffd56b)
      .fillRoundedRect(-w / 2, -h / 2, w, h, 14)
      .lineStyle(2, 0x2f2538)
      .strokeRoundedRect(-w / 2, -h / 2, w, h, 14)
      .fillStyle(0xffd56b)
      .fillTriangle(-8, h / 2 - 1, 8, h / 2 - 1, 0, h / 2 + 9);
    this.bubbleW = w;
    this.bubbleH = h;
  }

  /** the Enter bubble in world units (a container has no reliable bounds for its graphics) */
  private bubbleBounds() {
    const k = this.bubble.scale;
    return new Phaser.Geom.Rectangle(this.bubble.x - (this.bubbleW * k) / 2, this.bubble.y - (this.bubbleH * k) / 2, this.bubbleW * k, (this.bubbleH + 10) * k);
  }

  /**
   * Screen (CSS px, viewport) rectangle of a building, or of the arena's Enter bubble ('bubble').
   * Used by the guided tutorial to spotlight canvas objects. Null when not on screen.
   */
  screenRect(id: string): DOMRect | null {
    const img = this.images.get(id);
    const b = id === 'bubble' ? (this.bubble.visible ? this.bubbleBounds() : null) : img?.getBounds();
    if (!b || !this.sys.isActive()) return null;
    const cr = this.game.canvas.getBoundingClientRect();
    if (!cr.width) return null;
    const k = cr.width / this.scale.width;
    const cam = this.cameras.main;
    const x = cr.left + (b.x - cam.scrollX) * cam.zoom * k;
    const y = cr.top + (b.y - cam.scrollY) * cam.zoom * k;
    return new DOMRect(x, y, b.width * cam.zoom * k, b.height * cam.zoom * k);
  }

  /** Re-draw the building labels after a language change. */
  refreshLabels() {
    for (const b of BUILDINGS) this.labels.get(b.id)?.setText(b.name);
    this.paintBubble();
  }

  /** Highlight a building without moving the camera. */
  setSelected(id: string | null) {
    this.selected = id;
    for (const [bid, lbl] of this.labels) lbl.setColor(bid === id ? '#ffd56b' : '#ffffff');
    this.arrow.setVisible(!!id && id !== 'arena');
    this.bubble.setVisible(id === 'arena');
  }

  /** Scroll smoothly to a building and select it. */
  focus(id: string) {
    const b = BUILDING_BY_ID[id];
    if (!b) return;
    this.setSelected(id);
    this.vel = 0;
    const cam = this.cameras.main;
    this.tweens.killTweensOf(cam);
    this.tweens.add({ targets: cam, scrollX: this.clamp(b.x - W / 2), duration: 450, ease: 'Sine.easeInOut' });
  }

  update(time: number, delta: number) {
    const cam = this.cameras.main;
    for (const c of this.clouds) {
      c.x += delta * 0.006;
      if (c.x > this.cloudWrap + 60) c.x = -80;
    }
    if (!this.dragging && Math.abs(this.vel) > 0.02) {
      cam.scrollX = this.clamp(cam.scrollX + this.vel * delta);
      this.vel *= Math.pow(0.9, delta / 16);
    } else if (!this.dragging) this.vel = 0;
    if (this.cursors?.left.isDown) cam.scrollX = this.clamp(cam.scrollX - 0.5 * delta);
    if (this.cursors?.right.isDown) cam.scrollX = this.clamp(cam.scrollX + 0.5 * delta);

    if (this.selected) {
      const lbl = this.labels.get(this.selected)!;
      this.arrow.setPosition(lbl.x, lbl.y - lbl.height - 14 + Math.sin(time / 180) * 3);
      if (this.selected === 'arena') this.bubble.setPosition(lbl.x, Math.max(24, lbl.y - lbl.height - 26));
    }
    this.drawMini();
  }

  private drawMini() {
    const g = this.mini.clear();
    const sx = this.cameras.main.scrollX;
    g.fillStyle(0x000000, 0.45).fillRect(MX - 4, MY - 2, MW + 8, MH + 4);
    g.fillStyle(0xd3c9ee, 0.9).fillRect(MX, MY + MH - 3, MW, 3);
    for (const b of BUILDINGS) {
      const x = Math.round(MX + (b.x / WORLD_W) * MW);
      const color = b.id === 'arena' ? 0xffd56b : b.open ? 0xffffff : 0x9aa4ad;
      g.fillStyle(color).fillRect(x - 2, MY + 2, b.id === 'arena' ? 6 : 4, MH - 6);
      if (b.id === this.selected) g.lineStyle(1, 0xffd56b).strokeRect(x - 4, MY, 9, MH - 2);
    }
    g.lineStyle(2, 0xffffff, 0.9).strokeRect(MX + (sx / WORLD_W) * MW, MY - 1, (W / WORLD_W) * MW, MH + 2);
  }
}
