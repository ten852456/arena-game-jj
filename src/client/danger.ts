/**
 * Low-HP warning: the edges of the arena glow red and pulse (faster near death) while OUR fighter (side 0) is low.
 * One radial-gradient canvas texture over the whole arena; fades in below 40% HP, out when the fight ends.
 */
import Phaser from 'phaser';

const KEY = 'danger-vignette';
const START = 0.4;

export class DangerVignette {
  private img: Phaser.GameObjects.Image;
  private a = 0;

  constructor(scene: Phaser.Scene, w: number, h: number) {
    if (!scene.textures.exists(KEY)) {
      const tex = scene.textures.createCanvas(KEY, w, h)!;
      const ctx = tex.getContext();
      const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.32, w / 2, h / 2, Math.hypot(w, h) / 2);
      g.addColorStop(0, 'rgba(255,0,40,0)');
      g.addColorStop(0.55, 'rgba(230,10,40,0.35)');
      g.addColorStop(1, 'rgba(170,0,20,0.95)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      tex.refresh();
    }
    this.img = scene.add.image(0, 0, KEY).setOrigin(0, 0).setDepth(30).setAlpha(0).setBlendMode(Phaser.BlendModes.NORMAL);
  }

  /** frac = our HP / max HP; active = a fight is playing */
  update(t: number, delta: number, frac: number, active: boolean) {
    const danger = active ? Math.min(1, Math.max(0, (START - frac) / START)) : 0;
    const k = Math.min(1, delta / 250);
    this.a += (danger - this.a) * k;
    if (this.a < 0.01) {
      this.img.setVisible(false);
      return;
    }
    // heartbeat: faster and stronger the closer to 0 HP
    const period = 900 - 450 * danger;
    const beat = 0.7 + 0.3 * Math.abs(Math.sin((t / period) * Math.PI));
    this.img.setVisible(true).setAlpha(Math.min(0.85, this.a * 0.8 * beat));
  }
}
