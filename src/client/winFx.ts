/**
 * End-of-fight banner plate + victory confetti for the Phaser arena.
 * - plate(): a soft rounded ribbon behind the "Victory / Defeat" word, sized to the text, so the word always sits
 *   inside a frame (and is shrunk to fit the arena if a language makes it long).
 * - confetti(): a short burst of pastel paper bits and stars from above the winner.
 */
import Phaser from 'phaser';

const INK = 0x3a2b48;

export function drawPlate(g: Phaser.GameObjects.Graphics, text: Phaser.GameObjects.Text, kind: 'win' | 'lose' | 'draw', maxW: number) {
  g.clear();
  if (!text.text) return;
  // keep the word inside the arena
  const raw = text.width / text.scaleX;
  const fit = Math.min(0.78, (maxW - 70) / Math.max(1, raw)); // a bit smaller than the raw 48px word: the fighters stay visible
  text.setData('fit', fit);
  const w = raw * fit + 64;
  const h = (text.height / text.scaleY) * fit + 18;
  const fill = kind === 'win' ? 0xfff3d6 : kind === 'lose' ? 0xf3e6f0 : 0xece8f6;
  const band = kind === 'win' ? 0xffcf6b : kind === 'lose' ? 0xff8fa3 : 0xbcb2e6;
  g.setPosition(text.x, text.y);
  // ribbon tails
  g.fillStyle(band, 1).lineStyle(4, INK, 1);
  for (const sx of [-1, 1]) {
    const x0 = sx * (w / 2 - 6);
    const x1 = sx * (w / 2 + 26);
    g.beginPath();
    g.moveTo(x0, -h / 2 + 10);
    g.lineTo(x1, -h / 2 + 10);
    g.lineTo(x1 - sx * 12, 2);
    g.lineTo(x1, h / 2 + 8);
    g.lineTo(x0, h / 2 + 8);
    g.closePath();
    g.fillPath();
    g.strokePath();
  }
  // the plate
  g.fillStyle(fill, 1).fillRoundedRect(-w / 2, -h / 2, w, h, 18);
  g.lineStyle(4, INK, 1).strokeRoundedRect(-w / 2, -h / 2, w, h, 18);
  g.lineStyle(2, band, 1).strokeRoundedRect(-w / 2 + 6, -h / 2 + 6, w - 12, h - 12, 13);
}

const COLORS = [0xffcf6b, 0xffa6ba, 0x9df0df, 0x9ccbff, 0xb9a8ff, 0xfff3e2];

export function confetti(scene: Phaser.Scene, x: number, y: number, n = 46) {
  for (let i = 0; i < n; i++) {
    const star = i % 6 === 0;
    const c = COLORS[i % COLORS.length];
    const o = star
      ? scene.add.star(x, y, 5, 3, 7, 0xffe2a0).setStrokeStyle(1.5, INK)
      : scene.add.rectangle(x, y, Phaser.Math.Between(4, 7), Phaser.Math.Between(7, 11), c).setStrokeStyle(1, INK, 0.6);
    o.setDepth(24).setAngle(Phaser.Math.Between(0, 360));
    const a = Phaser.Math.FloatBetween(-Math.PI * 0.95, -Math.PI * 0.05);
    const v = Phaser.Math.Between(90, 230);
    const tx = x + Math.cos(a) * v * 1.4;
    const peak = y + Math.sin(a) * v;
    const dur = Phaser.Math.Between(1100, 1700);
    scene.tweens.add({ targets: o, x: tx, duration: dur, ease: 'Sine.Out' });
    scene.tweens.add({
      targets: o, y: peak, duration: dur * 0.35, ease: 'Quad.Out',
      onComplete: () => scene.tweens.add({ targets: o, y: peak + 170, alpha: 0, duration: dur * 0.65, ease: 'Quad.In', onComplete: () => o.destroy() }),
    });
    scene.tweens.add({ targets: o, angle: o.angle + Phaser.Math.Between(-540, 540), duration: dur });
  }
}
