import type Phaser from 'phaser';

/**
 * Mochi Moon town art: smooth shapes drawn in code with the Canvas 2D API (no pixel art, no image files).
 * Every texture is drawn at R texture pixels per world unit and shown at scale 1/R, so it stays sharp
 * on the zoomed canvas. Near things get an ink outline; far layers have none, so they read as distant.
 */
export const R = 2;
const INK = '#2f2538';
type Ctx = CanvasRenderingContext2D;

const P = {
  mochi: '#fffaf3', mochiShade: '#f3e3ec', pink: '#ffb3c8', pinkDeep: '#f27fa0', blush: '#ffc4d4',
  stone: '#ebe3f7', stoneShade: '#d3c8ea', stoneDark: '#b0a3d2',
  wood: '#c98f60', woodLight: '#e6b588', woodDark: '#8d5d3e',
  lamp: '#ffe7a3', gold: '#ffd56b', crystal: '#a6f4ff', crystalPink: '#ffbde9',
  dark: '#453960', mint: '#a3e3c4', mintDeep: '#62b592', lilac: '#bba9ea', violet: '#7d6ec8', paper: '#fff6e2',
};

/** Hero accent colours, reused for the townsfolk bunnies' scarves. */
export const FOLK_COLORS = ['#e9b949', '#8fd14f', '#d8504a', '#ff6f8a', '#f08a4b', '#ffb347', '#8fe8ff', '#c49bff'];

// ---------------------------------------------------------------- drawing kit

function art(scene: Phaser.Scene, key: string, w: number, h: number, draw: (c: Ctx) => void) {
  if (scene.textures.exists(key)) return;
  const tex = scene.textures.createCanvas(key, Math.ceil(w * R), Math.ceil(h * R));
  if (!tex) return;
  const c = tex.getContext();
  c.scale(R, R);
  c.lineJoin = 'round';
  c.lineCap = 'round';
  draw(c);
  tex.refresh();
}

/** Fill the current path, then outline it in ink (lw 0 = no outline). */
function paint(c: Ctx, fill: string | CanvasGradient, lw = 2) {
  c.fillStyle = fill;
  c.fill();
  if (lw > 0) {
    c.lineWidth = lw;
    c.strokeStyle = INK;
    c.stroke();
  }
}


function rr(c: Ctx, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.roundRect(x, y, w, h, r);
}
function ell(c: Ctx, x: number, y: number, rx: number, ry: number, rot = 0) {
  c.beginPath();
  c.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
}
/** Flat bottom at y + h, round top. */
function arch(c: Ctx, x: number, y: number, w: number, h: number) {
  const r = w / 2;
  c.beginPath();
  c.moveTo(x, y + h);
  c.lineTo(x, y + r);
  c.arc(x + r, y + r, r, Math.PI, 0);
  c.lineTo(x + w, y + h);
  c.closePath();
}
function line(c: Ctx, pts: number[], col = INK, lw = 1.5) {
  c.beginPath();
  c.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]);
  c.strokeStyle = col;
  c.lineWidth = lw;
  c.stroke();
}
function crescent(c: Ctx, x: number, y: number, r: number, col: string, tilt = -0.5, lw = 1.5) {
  const d = r * 0.75;
  const a = Math.atan2(Math.sqrt(r * r - (d * d) / 4), d / 2);
  c.save();
  c.translate(x, y);
  c.rotate(tilt);
  c.beginPath();
  c.arc(0, 0, r, a, Math.PI * 2 - a, false);
  c.arc(d, 0, r, Math.PI + a, Math.PI - a, true);
  c.closePath();
  paint(c, col, lw);
  c.restore();
}
function glow(c: Ctx, x: number, y: number, r: number, rgb = '255,231,163', a = 0.6) {
  const g = c.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(${rgb},${a})`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  c.fillStyle = g;
  c.fillRect(x - r, y - r, r * 2, r * 2);
}
function blush(c: Ctx, x: number, y: number, rx = 4) {
  ell(c, x, y, rx, rx * 0.6);
  c.fillStyle = 'rgba(255,140,170,0.55)';
  c.fill();
}

const seeded = (seed: number) => () => (seed = (seed * 16807) % 2147483647) / 2147483647;

// ---------------------------------------------------------------- landmarks





// ---------------------------------------------------------------- backdrop






// ---------------------------------------------------------------- fight arena

/** Inside the moon colosseum: night sky and big moon, a bunny crowd in the stands, gates and moon sand. */
/** x of each lantern post on the arena wall (the lantern hangs from ground - 56) */
export const ARENA_LANTERNS = [120, 240, 400, 520];
/** y of the first row of the arena stands, and the row step */
export const ARENA_STANDS = { top: 118, step: 20, rows: 5 };

/**
 * Small textures for the living arena (idle.ts): a hanging lantern, a soft glow, a sakura petal, a cheering
 * bunny per scarf colour and a sparkle. Drawn once, at R pixels per world unit like the rest of the art.
 */
export function makeArenaLifeArt(scene: Phaser.Scene) {
  art(scene, 'life_lantern', 14, 22, (c) => {
    line(c, [7, 0, 7, 5], INK, 1.2);
    rr(c, 2, 5, 10, 13, 4.5);
    paint(c, P.pink, 1.5);
    line(c, [4.5, 8, 4.5, 15], 'rgba(255,255,255,0.55)', 1);
    rr(c, 3.5, 4, 7, 2.4, 1);
    paint(c, P.gold, 1);
    rr(c, 3.5, 17, 7, 2.4, 1);
    paint(c, P.gold, 1);
    line(c, [7, 19.5, 7, 22], P.gold, 1.2);
  });
  art(scene, 'life_glow', 40, 40, (c) => glow(c, 20, 20, 20, '255,214,140', 0.75));
  art(scene, 'life_petal', 6, 5, (c) => {
    ell(c, 3, 2.5, 2.6, 1.7, 0.4);
    c.fillStyle = '#ffc2d6';
    c.fill();
    ell(c, 2.4, 2.2, 1, 0.6, 0.4);
    c.fillStyle = 'rgba(255,255,255,0.8)';
    c.fill();
  });
  art(scene, 'life_spark', 12, 12, (c) => {
    glow(c, 6, 6, 6, '255,240,190', 0.9);
    c.beginPath();
    c.moveTo(6, 0.5);
    c.quadraticCurveTo(6, 6, 11.5, 6);
    c.quadraticCurveTo(6, 6, 6, 11.5);
    c.quadraticCurveTo(6, 6, 0.5, 6);
    c.quadraticCurveTo(6, 6, 6, 0.5);
    c.fillStyle = '#fff7d6';
    c.fill();
  });
  const fur = ['#fffaf3', '#fff0f3', '#f6ead8', '#efe9ff'];
  FOLK_COLORS.forEach((scarf, i) => {
    art(scene, 'life_bunny_' + i, 14, 16, (c) => {
      const col = fur[i % fur.length];
      ell(c, 4.6, 4.5, 1.8, 4.6, -0.2);
      paint(c, col, 1);
      ell(c, 9.4, 4.5, 1.8, 4.6, 0.2);
      paint(c, col, 1);
      ell(c, 7, 11, 5.6, 4.6);
      paint(c, col, 1);
      c.fillStyle = scarf;
      c.fillRect(2.6, 13.4, 8.8, 2);
      c.fillStyle = INK;
      c.fillRect(5, 10, 1.1, 1.3);
      c.fillRect(8, 10, 1.1, 1.3);
      blush(c, 4, 12, 1.3);
      blush(c, 10, 12, 1.3);
    });
  });
}

export function drawArenaBackdrop(scene: Phaser.Scene, w: number, h: number, ground: number) {
  art(scene, 'arena_bg', w, h, (c) => {
    const rnd = seeded(7);
    const sky = c.createLinearGradient(0, 0, 0, 140);
    sky.addColorStop(0, '#231c48');
    sky.addColorStop(1, '#6a55a8');
    c.fillStyle = sky;
    c.fillRect(0, 0, w, h);
    for (let i = 0; i < 60; i++) {
      ell(c, rnd() * w, rnd() * 90, 0.6 + rnd() * 0.7, 0.6 + rnd() * 0.7);
      c.fillStyle = `rgba(255,255,255,${0.4 + rnd() * 0.5})`;
      c.fill();
    }
    // big moon behind the royal box
    glow(c, w / 2, 70, 110, '255,240,200', 0.45);
    const mg = c.createRadialGradient(w / 2 - 20, 50, 6, w / 2, 70, 62);
    mg.addColorStop(0, '#fffdf0');
    mg.addColorStop(1, '#f7e3b2');
    ell(c, w / 2, 70, 62, 62);
    c.fillStyle = mg;
    c.fill();
    c.fillStyle = 'rgba(214,176,112,0.4)';
    ell(c, w / 2 + 12, 84, 17, 19); c.fill();
    ell(c, w / 2 + 8, 58, 13, 12); c.fill();
    ell(c, w / 2 + 2, 38, 4, 13, -0.25); c.fill();
    ell(c, w / 2 + 14, 37, 4, 13, 0.3); c.fill();
    ell(c, w / 2 - 22, 92, 12, 6); c.fill();
    // stands: pastel stone tiers full of mochi bunnies
    const top = 104;
    c.fillStyle = '#b9acdc';
    c.beginPath();
    c.moveTo(0, ground);
    c.lineTo(0, top);
    for (let x = 0; x < w; x += 16) c.arc(x + 8, top, 8, Math.PI, 0);
    c.lineTo(w, ground);
    c.closePath();
    c.fill();
    const fur = ['#fffaf3', '#fff0f3', '#f6ead8', '#efe9ff', '#e8c3a0', '#e6f1fb'];
    const scarf = ['#ffb3c8', '#9ee6c9', '#ffd56b', '#9d7fd8', '#8fe8ff', '#ff8fb0', '#f08a4b'];
    for (let row = 0; row < 5; row++) {
      const y = top + 14 + row * 20;
      c.fillStyle = row % 2 ? '#a99cd0' : '#b2a5d8';
      c.fillRect(0, y + 8, w, 12);
      c.fillStyle = '#9a8dc4';
      c.fillRect(0, y + 18, w, 2);
      for (let x = 6 + (row % 2) * 6; x < w; x += 12) {
        if (rnd() > 0.82) continue;
        const bx = x + rnd() * 3;
        const col = fur[Math.floor(rnd() * fur.length)];
        ell(c, bx - 2.2, y - 2, 1.6, 4.5, -0.2);
        c.fillStyle = col;
        c.fill();
        ell(c, bx + 2.2, y - 2, 1.6, 4.5, 0.2);
        c.fill();
        ell(c, bx, y + 5, 5, 4.2);
        c.fill();
        c.fillStyle = scarf[Math.floor(rnd() * scarf.length)];
        c.fillRect(bx - 4, y + 7.5, 8, 1.8);
        c.fillStyle = INK;
        c.fillRect(bx - 2, y + 4, 1, 1.2);
        c.fillRect(bx + 1, y + 4, 1, 1.2);
      }
    }
    // royal box with a pink canopy and crescent
    rr(c, w / 2 - 54, top - 18, 108, 40, 8);
    paint(c, P.stone);
    c.beginPath();
    c.moveTo(w / 2 - 60, top - 14);
    c.quadraticCurveTo(w / 2, top - 46, w / 2 + 60, top - 14);
    c.closePath();
    paint(c, P.pink);
    for (let i = 0; i < 6; i++) {
      c.beginPath();
      c.arc(w / 2 - 50 + i * 20, top - 14, 10, 0, Math.PI);
      c.closePath();
      paint(c, i % 2 ? '#ffffff' : P.pink, 1.5);
    }
    crescent(c, w / 2, top - 30, 7, P.gold, -0.6, 1.5);
    rr(c, w / 2 - 44, top + 2, 88, 16, 4);
    paint(c, '#9d7fd8', 1.5);
    // banners
    for (const [bx, col] of [[60, '#9d7fd8'], [180, '#ff8fb0'], [440, '#ff8fb0'], [560, '#9d7fd8']] as const) {
      c.beginPath();
      c.moveTo(bx, top);
      c.lineTo(bx + 18, top);
      c.lineTo(bx + 18, top + 40);
      c.lineTo(bx + 9, top + 33);
      c.lineTo(bx, top + 40);
      c.closePath();
      paint(c, col, 1.5);
      crescent(c, bx + 8, top + 14, 4.5, P.gold, -0.5, 1);
    }
    // arena wall with round gates and lanterns
    rr(c, -4, ground - 38, w + 8, 42, 4);
    paint(c, P.stone);
    c.fillStyle = P.stoneShade;
    c.fillRect(0, ground - 10, w, 10);
    for (const gx of [24, w / 2 - 20, w - 64]) {
      arch(c, gx, ground - 34, 40, 34);
      paint(c, P.dark, 1.5);
      for (let x = gx + 6; x < gx + 38; x += 7) line(c, [x, ground - 30, x, ground], '#8f84b8', 1.5);
    }
    // lantern posts with a little hook; the lanterns themselves are sprites that sway (idle.ts)
    for (const lx of ARENA_LANTERNS) {
      line(c, [lx, ground - 38, lx, ground - 56], INK, 1.5);
      line(c, [lx, ground - 56, lx + 5, ground - 56], INK, 1.5);
    }
    // moon sand
    const sand = c.createLinearGradient(0, ground, 0, h);
    sand.addColorStop(0, '#efe4d0');
    sand.addColorStop(1, '#ddd0ec');
    c.fillStyle = sand;
    c.fillRect(0, ground, w, h - ground);
    line(c, [0, ground + 0.5, w, ground + 0.5], '#cbbca2', 2);
    ell(c, w / 2, ground + 26, 190, 14);
    c.strokeStyle = 'rgba(160,140,190,0.35)';
    c.lineWidth = 2;
    c.stroke();
    for (let i = 0; i < 14; i++) {
      const x = rnd() * w;
      const y = ground + 10 + rnd() * (h - ground - 14);
      const r = 4 + rnd() * 7;
      ell(c, x, y, r, r * 0.35);
      c.fillStyle = 'rgba(170,150,200,0.35)';
      c.fill();
    }
  });
  scene.add.image(0, 0, 'arena_bg').setOrigin(0).setScale(1 / R);
}
