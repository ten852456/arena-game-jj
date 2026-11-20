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

/** Fill a shape, shade part of it (clipped to the shape), then outline it. */
function shaded(c: Ctx, path: () => void, fill: string, shade: () => void, shadeFill: string, lw = 2) {
  path();
  c.fillStyle = fill;
  c.fill();
  c.save();
  path();
  c.clip();
  shade();
  c.fillStyle = shadeFill;
  c.fill();
  c.restore();
  path();
  c.lineWidth = lw;
  c.strokeStyle = INK;
  c.stroke();
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
/** Upper half of an ellipse sitting on y = by. */
function dome(c: Ctx, cx: number, by: number, rx: number, ry: number) {
  c.beginPath();
  c.ellipse(cx, by, rx, ry, 0, Math.PI, 0);
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
/** Four-point twinkle. */
function sparkle(c: Ctx, x: number, y: number, s: number, col: string) {
  c.beginPath();
  c.moveTo(x, y - s);
  c.quadraticCurveTo(x, y, x + s, y);
  c.quadraticCurveTo(x, y, x, y + s);
  c.quadraticCurveTo(x, y, x - s, y);
  c.quadraticCurveTo(x, y, x, y - s);
  c.fillStyle = col;
  c.fill();
}
function glow(c: Ctx, x: number, y: number, r: number, rgb = '255,231,163', a = 0.6) {
  const g = c.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(${rgb},${a})`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  c.fillStyle = g;
  c.fillRect(x - r, y - r, r * 2, r * 2);
}
function shine(c: Ctx, x: number, y: number, rx: number, ry: number, rot = -0.5) {
  ell(c, x, y, rx, ry, rot);
  c.fillStyle = 'rgba(255,255,255,0.6)';
  c.fill();
}
function crystal(c: Ctx, x: number, y: number, h: number, col: string) {
  const w = h * 0.32;
  c.beginPath();
  c.moveTo(x, y - h);
  c.lineTo(x + w, y - h * 0.6);
  c.lineTo(x + w * 0.8, y);
  c.lineTo(x - w * 0.8, y);
  c.lineTo(x - w, y - h * 0.6);
  c.closePath();
  paint(c, col, 1.5);
  line(c, [x - w * 0.4, y - h * 0.6, x, y - h * 0.88], 'rgba(255,255,255,0.9)', 1.5);
}
function lantern(c: Ctx, x: number, y: number, col = P.lamp) {
  glow(c, x, y, 14);
  rr(c, x - 4.5, y - 6, 9, 12, 4);
  paint(c, col, 1.5);
  line(c, [x - 3, y - 6, x + 3, y - 6], INK, 2);
}
function eye(c: Ctx, x: number, y: number, r = 2.2) {
  ell(c, x, y, r, r * 1.15);
  c.fillStyle = INK;
  c.fill();
  ell(c, x - r * 0.35, y - r * 0.45, r * 0.4, r * 0.4);
  c.fillStyle = '#ffffff';
  c.fill();
}
function blush(c: Ctx, x: number, y: number, rx = 4) {
  ell(c, x, y, rx, rx * 0.6);
  c.fillStyle = 'rgba(255,140,170,0.55)';
  c.fill();
}
/** Bunny ear: white outside, pink inside. */
function ear(c: Ctx, x: number, y: number, rx: number, ry: number, rot: number, lw = 2) {
  ell(c, x, y, rx, ry, rot);
  paint(c, P.mochi, lw);
  ell(c, x, y + ry * 0.12, rx * 0.5, ry * 0.7, rot);
  c.fillStyle = P.pink;
  c.fill();
}

const seeded = (seed: number) => () => (seed = (seed * 16807) % 2147483647) / 2147483647;

// ---------------------------------------------------------------- landmarks

export function makeTownArt(scene: Phaser.Scene) {
  // ---- เหมือง: crater mound with a glowing moon-crystal mine and a cart ----
  art(scene, 'bld_mine', 168, 126, (c) => {
    shaded(
      c,
      () => {
        c.beginPath();
        c.moveTo(3, 124);
        c.bezierCurveTo(18, 40, 58, 14, 88, 14);
        c.bezierCurveTo(122, 14, 150, 48, 165, 124);
        c.closePath();
      },
      '#c8bde6',
      () => ell(c, 120, 120, 70, 60),
      '#b2a6d6',
    );
    for (const [x, y, r] of [[38, 74, 8], [124, 64, 6], [66, 40, 5], [104, 34, 4]]) {
      ell(c, x, y, r, r * 0.55);
      c.fillStyle = '#a597cb';
      c.fill();
      ell(c, x + 0.5, y + 1, r * 0.75, r * 0.32);
      c.fillStyle = '#c0b4e0';
      c.fill();
    }
    crystal(c, 88, 18, 16, P.crystal);
    crystal(c, 98, 20, 10, P.crystalPink);
    // entrance
    arch(c, 58, 66, 52, 58);
    paint(c, P.wood);
    arch(c, 66, 74, 36, 50);
    paint(c, P.dark, 1.5);
    glow(c, 84, 110, 18, '166,244,255', 0.45);
    crystal(c, 80, 122, 12, P.crystal);
    lantern(c, 116, 84);
    line(c, [110, 70, 116, 70, 116, 78]);
    // crystal cluster on the left
    crystal(c, 18, 122, 28, P.crystal);
    crystal(c, 32, 122, 18, P.crystalPink);
    crystal(c, 8, 122, 12, P.crystalPink);
    // rail + cart full of crystals
    line(c, [96, 123.5, 166, 123.5], '#8e82b8', 2.5);
    crystal(c, 128, 101, 12, P.crystal);
    crystal(c, 139, 101, 17, P.crystalPink);
    crystal(c, 150, 101, 11, P.crystal);
    rr(c, 118, 98, 42, 17, 5);
    paint(c, P.woodLight);
    line(c, [124, 106, 154, 106], P.woodDark, 1.5);
    for (const x of [127, 151]) {
      ell(c, x, 118, 5.5, 5.5);
      paint(c, P.dark, 1.5);
    }
  });

  // ---- ลานตัดไม้: bamboo grove with a bun-roofed hut and cut bamboo ----
  art(scene, 'bld_lumber', 186, 120, (c) => {
    for (const [x, top] of [[12, 10], [27, 0], [148, 6], [163, 16], [177, 28]]) {
      rr(c, x - 4, top, 8, 122 - top, 4);
      paint(c, '#b4e2c3', 1.5);
      for (let y = top + 18; y < 116; y += 20) line(c, [x - 4, y, x + 4, y], INK, 1.2);
      for (const [ly, a] of [[top + 10, -0.45], [top + 26, Math.PI + 0.45]] as const) {
        ell(c, x + Math.cos(a) * 9, ly + Math.sin(a) * 9, 9, 3.2, a);
        paint(c, '#76c596', 1.2);
      }
    }
    // hut
    rr(c, 42, 62, 84, 58, 6);
    paint(c, '#f6e4c4');
    for (const x of [42, 120]) {
      rr(c, x, 62, 6, 58, 3);
      paint(c, P.wood, 1.5);
    }
    arch(c, 70, 84, 26, 36);
    paint(c, P.dark, 1.5);
    ell(c, 106, 90, 8, 8);
    paint(c, P.lamp, 1.5);
    line(c, [98, 90, 114, 90, 106, 90, 106, 82, 106, 98], P.woodDark, 1.2);
    // bun-shaped thatch roof
    c.beginPath();
    c.moveTo(30, 72);
    c.quadraticCurveTo(32, 24, 84, 22);
    c.quadraticCurveTo(136, 24, 138, 72);
    c.quadraticCurveTo(84, 82, 30, 72);
    paint(c, '#e8ae70');
    for (const dx of [-30, -10, 10, 30]) {
      c.beginPath();
      c.moveTo(84 + dx * 0.5, 28);
      c.quadraticCurveTo(84 + dx * 1.2, 46, 84 + dx * 1.5, 72);
      c.strokeStyle = '#f6cc95';
      c.lineWidth = 2;
      c.stroke();
    }
    shine(c, 62, 36, 14, 5, -0.4);
    // stacked bamboo
    for (const [x, y, w] of [[130, 108, 50], [136, 97, 40], [142, 86, 28]]) {
      rr(c, x, y, w, 11, 5.5);
      paint(c, '#c6e9a5', 1.5);
      ell(c, x + 5, y + 5.5, 4, 5.5);
      paint(c, '#effad2', 1.5);
      ell(c, x + 5, y + 5.5, 1.6, 2.4);
      c.fillStyle = '#9cc77f';
      c.fill();
    }
  });

  // ---- หอเวท: star-dome observatory with a crescent on top ----
  art(scene, 'bld_tower', 102, 216, (c) => {
    const bodyPath = () => {
      c.beginPath();
      c.moveTo(26, 214);
      c.lineTo(32, 76);
      c.lineTo(70, 76);
      c.lineTo(76, 214);
      c.closePath();
    };
    shaded(
      c,
      bodyPath,
      P.stone,
      () => {
        c.beginPath();
        for (const y of [112, 152, 192]) c.rect(0, y, 102, 5);
        c.rect(60, 76, 30, 140);
      },
      P.stoneShade,
    );
    arch(c, 44, 94, 14, 22);
    paint(c, P.lamp, 1.5);
    arch(c, 44, 132, 14, 22);
    paint(c, P.lamp, 1.5);
    arch(c, 39, 176, 24, 38);
    paint(c, P.dark, 1.5);
    ell(c, 57, 198, 1.8, 1.8);
    c.fillStyle = P.gold;
    c.fill();
    rr(c, 18, 66, 66, 13, 6.5);
    paint(c, P.lilac);
    dome(c, 51, 68, 32, 42);
    paint(c, P.violet);
    for (const [x, y, s] of [[38, 50, 4], [60, 40, 3], [64, 58, 3.5], [48, 34, 2.5]]) sparkle(c, x, y, s, '#ffffff');
    shine(c, 36, 44, 7, 12, 0.5);
    line(c, [51, 26, 51, 18], INK, 2);
    crescent(c, 50, 11, 9, P.gold, -0.7);
    sparkle(c, 10, 46, 4, P.crystal);
    sparkle(c, 92, 100, 3.5, P.crystalPink);
    sparkle(c, 8, 150, 3, P.gold);
  });

  // ---- หอฮีโร่: a big mochi with bunny ears, round door and a sleepy face ----
  art(scene, 'bld_hall', 204, 156, (c) => {
    ear(c, 70, 40, 15, 37, -0.3);
    ear(c, 134, 40, 15, 37, 0.3);
    shaded(c, () => dome(c, 102, 124, 92, 84), P.mochi, () => ell(c, 120, 140, 100, 44), P.mochiShade);
    shine(c, 58, 66, 20, 10, -0.6);
    // face
    for (const x of [74, 130]) {
      c.beginPath();
      c.arc(x, 66, 6, Math.PI * 1.1, Math.PI * 1.9);
      c.strokeStyle = INK;
      c.lineWidth = 2.5;
      c.stroke();
    }
    blush(c, 62, 78, 8);
    blush(c, 142, 78, 8);
    // base
    rr(c, 6, 118, 192, 36, 8);
    paint(c, P.stone);
    line(c, [10, 136, 194, 136], P.stoneDark, 1.5);
    for (const x of [40, 74, 130, 164]) line(c, [x, 120, x, 152], P.stoneDark, 1.5);
    // round door
    arch(c, 80, 82, 44, 72);
    paint(c, P.wood);
    arch(c, 86, 88, 32, 66);
    paint(c, P.woodDark, 1.5);
    ell(c, 112, 122, 2.5, 2.5);
    paint(c, P.gold, 1);
    // round windows
    for (const x of [44, 160]) {
      glow(c, x, 100, 20);
      ell(c, x, 100, 11, 11);
      paint(c, P.lamp);
      line(c, [x - 11, 100, x + 11, 100, x, 100, x, 89, x, 111], P.wood, 1.5);
    }
    lantern(c, 16, 108);
    lantern(c, 188, 108);
  });

  // ---- ป้ายประกาศ: notice board under a little pink roof ----
  art(scene, 'bld_board', 90, 96, (c) => {
    for (const x of [12, 71]) {
      rr(c, x, 26, 7, 70, 3);
      paint(c, P.wood, 1.5);
    }
    rr(c, 4, 22, 82, 50, 8);
    paint(c, P.wood);
    rr(c, 9, 27, 72, 40, 5);
    c.fillStyle = P.woodLight;
    c.fill();
    const note = (x: number, y: number, w: number, h: number, rot: number) => {
      c.save();
      c.translate(x + w / 2, y + h / 2);
      c.rotate(rot);
      rr(c, -w / 2, -h / 2, w, h, 2);
      paint(c, P.paper, 1.2);
      for (let ly = -h / 2 + 5; ly < h / 2 - 3; ly += 4) line(c, [-w / 2 + 3, ly, w / 2 - 3, ly], '#c9b8a0', 1);
      c.restore();
    };
    note(13, 30, 20, 26, -0.08);
    note(37, 33, 16, 20, 0.06);
    note(57, 30, 19, 30, -0.04);
    crescent(c, 24, 50, 4, P.gold, -0.5, 1);
    ell(c, 66, 52, 4, 4);
    paint(c, P.pinkDeep, 1);
    c.beginPath();
    c.moveTo(0, 28);
    c.quadraticCurveTo(45, -8, 90, 28);
    c.quadraticCurveTo(45, 18, 0, 28);
    paint(c, P.pink);
    shine(c, 30, 14, 10, 3, -0.3);
  });

  // ---- ตลาด: two pastel stalls with dango, mochi, carrots and crystals ----
  art(scene, 'bld_market', 228, 120, (c) => {
    const stall = (x0: number, col: string, goods: (x: number) => void) => {
      for (const x of [x0 + 8, x0 + 98]) {
        rr(c, x, 36, 6, 84, 3);
        paint(c, P.wood, 1.5);
      }
      goods(x0);
      rr(c, x0 + 4, 82, 104, 38, 6);
      paint(c, P.woodLight);
      line(c, [x0 + 8, 96, x0 + 104, 96], P.wood, 1.5);
      c.save();
      rr(c, x0, 22, 112, 24, 8);
      c.clip();
      for (let i = 0; i < 7; i++) {
        c.fillStyle = i % 2 ? '#ffffff' : col;
        c.fillRect(x0 + i * 16, 22, 16, 24);
      }
      c.restore();
      rr(c, x0, 22, 112, 24, 8);
      c.lineWidth = 2;
      c.strokeStyle = INK;
      c.stroke();
      for (let i = 0; i < 7; i++) {
        c.beginPath();
        c.arc(x0 + 8 + i * 16, 46, 8, 0, Math.PI);
        c.closePath();
        paint(c, i % 2 ? '#ffffff' : col, 1.5);
      }
      line(c, [x0 + 56, 22, x0 + 56, 10], INK, 1.5);
      lantern(c, x0 + 56, 6);
    };
    stall(0, '#ffb3c8', (x) => {
      for (const sx of [18, 28, 38]) {
        line(c, [x + sx, 84, x + sx, 58], P.woodDark, 1.5);
        for (const [i, col] of [P.pink, P.mochi, P.mint].entries()) {
          ell(c, x + sx, 62 + i * 7, 4.2, 4.2);
          paint(c, col, 1.2);
        }
      }
      for (const bx of [58, 78]) {
        dome(c, x + bx, 74, 9, 8);
        paint(c, P.mochi, 1.5);
        rr(c, x + bx - 10, 74, 20, 8, 3);
        paint(c, '#9d7fd8', 1.5);
      }
      for (const cx of [94, 100]) {
        c.beginPath();
        c.moveTo(x + cx - 3, 66);
        c.lineTo(x + cx + 3, 66);
        c.lineTo(x + cx, 82);
        c.closePath();
        paint(c, '#ff9a4d', 1.2);
        ell(c, x + cx, 64, 2, 3.5);
        c.fillStyle = P.mintDeep;
        c.fill();
      }
    });
    stall(116, '#9ee6c9', (x) => {
      crystal(c, x + 22, 82, 18, P.crystal);
      crystal(c, x + 32, 82, 12, P.crystalPink);
      for (const [bx, col] of [[52, '#c49bff'], [68, '#ff8fb0'], [84, '#8fe8ff']] as const) {
        ell(c, x + bx, 75, 6.5, 6.5);
        paint(c, col, 1.5);
        rr(c, x + bx - 2.5, 63, 5, 7, 1.5);
        paint(c, P.paper, 1.2);
        shine(c, x + bx - 2, 73, 1.8, 1.2, 0);
      }
      sparkle(c, x + 98, 70, 4, P.gold);
    });
  });

  // ---- สนามประลอง: round pastel colosseum, bun-domed towers, crescent gate ----
  art(scene, 'bld_arena', 456, 210, (c) => {
    // wall with rounded crenellations
    shaded(
      c,
      () => {
        c.beginPath();
        c.moveTo(30, 208);
        c.lineTo(30, 72);
        for (let x = 30; x < 426; x += 18) c.arc(x + 9, 72, 9, Math.PI, 0);
        c.lineTo(426, 208);
        c.closePath();
      },
      P.stone,
      () => {
        c.beginPath();
        c.rect(0, 128, 456, 6);
        c.rect(0, 196, 456, 14);
      },
      P.stoneShade,
    );
    for (let x = 46; x < 410; x += 36) {
      arch(c, x, 86, 16, 30);
      paint(c, P.dark, 1.5);
    }
    for (let x = 40; x < 420; x += 40) {
      if (x > 160 && x < 290) continue;
      arch(c, x, 144, 24, 52);
      paint(c, P.dark, 1.5);
      glow(c, x + 12, 180, 10, '255,231,163', 0.35);
    }
    // gate
    arch(c, 178, 116, 100, 94);
    paint(c, P.stoneDark);
    arch(c, 190, 128, 76, 82);
    paint(c, P.dark, 1.5);
    for (let x = 198; x < 262; x += 10) line(c, [x, 134, x, 208], '#8f84b8', 2);
    line(c, [190, 170, 266, 170], '#8f84b8', 2);
    crescent(c, 226, 100, 13, P.gold, -0.6, 2);
    sparkle(c, 244, 92, 4, '#ffffff');
    // banners
    for (const [bx, col] of [[88, '#9d7fd8'], [346, '#ff8fb0']] as const) {
      c.beginPath();
      c.moveTo(bx, 74);
      c.lineTo(bx + 22, 74);
      c.lineTo(bx + 22, 124);
      c.lineTo(bx + 11, 116);
      c.lineTo(bx, 124);
      c.closePath();
      paint(c, col);
      crescent(c, bx + 10, 92, 5, P.gold, -0.5, 1);
    }
    // side towers with bun domes and flags
    for (const tx of [2, 400]) {
      shaded(c, () => rr(c, tx, 48, 54, 162, 8), P.stone, () => c.rect(tx + 38, 40, 20, 180), P.stoneShade);
      for (const y of [80, 132]) {
        arch(c, tx + 19, y, 16, 24);
        paint(c, P.lamp, 1.5);
      }
      line(c, [tx + 27, 22, tx + 27, 2], INK, 2);
      c.beginPath();
      c.moveTo(tx + 28, 3);
      c.quadraticCurveTo(tx + 40, 6, tx + 48, 4);
      c.lineTo(tx + 44, 9);
      c.lineTo(tx + 48, 14);
      c.quadraticCurveTo(tx + 40, 15, tx + 28, 12);
      c.closePath();
      paint(c, tx < 200 ? '#9d7fd8' : '#ff8fb0', 1.5);
      dome(c, tx + 27, 52, 31, 30);
      paint(c, P.pink);
      shine(c, tx + 16, 36, 7, 4, -0.5);
    }
  });

  makeRabbitArt(scene);
  makeFolkArt(scene);
}

/**
 * The town landmark: a giant mochi rabbit pounding mochi. Three textures so the pestle (kine) can swing
 * and the mochi can squash: 'deco_rabbit' (rabbit, mortar, pedestal), 'deco_kine' (arm + mallet, pivot
 * at the shoulder = its right-middle point) and 'deco_mochi'.
 */
export const RABBIT = { w: 160, h: 190, shoulder: [96, 112] as const, mochi: [42, 139] as const, kine: { w: 92, h: 40, px: 88 } };

function makeRabbitArt(scene: Phaser.Scene) {
  art(scene, 'deco_rabbit', RABBIT.w, RABBIT.h, (c) => {
    // pedestal
    rr(c, 4, 160, 152, 30, 8);
    paint(c, P.stone);
    line(c, [8, 172, 152, 172], P.stoneDark, 1.5);
    rr(c, 58, 175, 44, 11, 4);
    paint(c, P.gold, 1.5);
    crescent(c, 76, 180, 3.5, '#fff6d0', -0.5, 0);
    // mortar (usu)
    c.beginPath();
    c.moveTo(14, 140);
    c.lineTo(70, 140);
    c.lineTo(63, 162);
    c.lineTo(21, 162);
    c.closePath();
    paint(c, P.wood);
    line(c, [18, 150, 66, 150], P.woodDark, 1.5);
    ell(c, 42, 140, 29, 6);
    paint(c, P.woodLight);
    ell(c, 42, 140, 22, 3.6);
    c.fillStyle = P.woodDark;
    c.fill();
    // rabbit
    ell(c, 148, 134, 10, 10);
    paint(c, P.mochi);
    ear(c, 96, 32, 9, 28, -0.22);
    ear(c, 124, 30, 9, 28, 0.28);
    shaded(c, () => ell(c, 112, 126, 36, 40), P.mochi, () => ell(c, 130, 150, 40, 26), P.mochiShade);
    ell(c, 100, 132, 18, 22);
    c.fillStyle = '#fff3f6';
    c.fill();
    for (const x of [96, 130]) {
      ell(c, x, 163, 13, 7);
      paint(c, P.mochi);
    }
    shaded(c, () => ell(c, 108, 74, 30, 28), P.mochi, () => ell(c, 124, 96, 30, 14), P.mochiShade);
    // headband (hachimaki) with a knot at the back
    c.save();
    ell(c, 108, 74, 30, 28);
    c.clip();
    c.fillStyle = P.pinkDeep;
    c.fillRect(70, 54, 80, 7);
    c.restore();
    ell(c, 108, 74, 30, 28);
    c.lineWidth = 2;
    c.strokeStyle = INK;
    c.stroke();
    for (const [dx, dy] of [[14, -6], [16, 6]]) {
      c.beginPath();
      c.moveTo(137, 57);
      c.quadraticCurveTo(137 + dx * 0.6, 57 + dy * 0.2, 137 + dx, 57 + dy);
      c.strokeStyle = P.pinkDeep;
      c.lineWidth = 3;
      c.stroke();
    }
    shine(c, 94, 64, 7, 4, -0.5);
    eye(c, 92, 76, 2.6);
    eye(c, 110, 76, 2.6);
    blush(c, 86, 86, 5);
    blush(c, 118, 86, 5);
    c.beginPath();
    c.moveTo(96, 86);
    c.quadraticCurveTo(98.5, 89, 101, 86);
    c.quadraticCurveTo(103.5, 89, 106, 86);
    c.strokeStyle = INK;
    c.lineWidth = 1.5;
    c.stroke();
  });

  const { w, h, px } = RABBIT.kine;
  art(scene, 'deco_kine', w, h, (c) => {
    rr(c, 30, 17, 52, 6, 3);
    paint(c, P.wood, 1.5);
    rr(c, 16, 4, 26, 32, 8);
    paint(c, P.woodLight);
    line(c, [17, 12, 41, 12], P.woodDark, 1.5);
    line(c, [17, 28, 41, 28], P.woodDark, 1.5);
    rr(c, 64, 13, px - 64 + 3, 14, 7);
    paint(c, P.mochi);
    ell(c, 66, 20, 7.5, 7.5);
    paint(c, P.mochi);
  });

  art(scene, 'deco_mochi', 40, 14, (c) => {
    c.beginPath();
    c.moveTo(3, 13);
    c.bezierCurveTo(3, 2, 37, 2, 37, 13);
    c.closePath();
    paint(c, P.mochi, 1.5);
    shine(c, 14, 7, 5, 2, -0.2);
  });
}

/** Townsfolk: small mochi bunnies, one per hero colour, facing right. */
function makeFolkArt(scene: Phaser.Scene) {
  FOLK_COLORS.forEach((col, i) => {
    art(scene, 'folk_' + i, 32, 36, (c) => {
      ell(c, 16, 34, 11, 2.5);
      c.fillStyle = 'rgba(40,30,70,0.25)';
      c.fill();
      ear(c, 11, 10, 4, 10, -0.18, 1.5);
      ear(c, 19, 9, 4, 10, 0.24, 1.5);
      shaded(c, () => ell(c, 16, 24, 13, 10.5), P.mochi, () => ell(c, 14, 33, 14, 5), P.mochiShade, 1.5);
      c.save();
      ell(c, 16, 24, 13, 10.5);
      c.clip();
      c.fillStyle = col;
      c.fillRect(0, 27, 32, 3.5);
      c.restore();
      ell(c, 16, 24, 13, 10.5);
      c.lineWidth = 1.5;
      c.strokeStyle = INK;
      c.stroke();
      eye(c, 18, 21, 1.5);
      eye(c, 24, 21, 1.5);
      blush(c, 15, 25, 2.2);
      blush(c, 27.5, 25, 2);
      shine(c, 9, 18, 2.5, 1.5, -0.6);
    });
  });
}

// ---------------------------------------------------------------- backdrop

/** Width a parallax layer must cover: it scrolls (worldW - viewW) * factor. */
const layerW = (worldW: number, viewW: number, f: number) => Math.ceil((worldW - viewW) * f + viewW);

/** Max world width of one layer texture, so no texture is wider than 2000 px (phones cap at 4096). */
const TILE = 1000;

/** A long layer drawn in tiles. `draw` must be deterministic: it runs once per tile, translated. */
function layer(scene: Phaser.Scene, key: string, width: number, h: number, factor: number, depth: number, draw: (c: Ctx) => void) {
  for (let x0 = 0, i = 0; x0 < width; x0 += TILE, i++) {
    const k = `${key}_${i}`;
    art(scene, k, Math.min(TILE, width - x0), h, (c) => {
      c.translate(-x0, 0);
      draw(c);
    });
    scene.add.image(x0, 0, k).setOrigin(0).setScale(1 / R).setScrollFactor(factor).setDepth(depth);
  }
}

/** Wavy top edge of a hill layer, closed down to the bottom of the view. */
function hillPath(c: Ctx, w: number, h: number, top: (x: number) => number) {
  c.beginPath();
  c.moveTo(0, h);
  for (let x = 0; x <= w + 6; x += 6) c.lineTo(x, top(x));
  c.lineTo(w + 6, h);
  c.closePath();
}

export function drawTownBackdrop(scene: Phaser.Scene, worldW: number, viewW: number, viewH: number, ground: number) {
  // ---- night sky with stars (fixed) ----
  art(scene, 'sky', viewW, viewH, (c) => {
    const g = c.createLinearGradient(0, 0, 0, ground);
    g.addColorStop(0, '#231c48');
    g.addColorStop(0.45, '#433680');
    g.addColorStop(0.78, '#8a70c0');
    g.addColorStop(1, '#e9b8d8');
    c.fillStyle = g;
    c.fillRect(0, 0, viewW, viewH);
    const rnd = seeded(5);
    for (let i = 0; i < 120; i++) {
      const y = rnd() * ground * 0.7;
      ell(c, rnd() * viewW, y, 0.5 + rnd() * 0.8, 0.5 + rnd() * 0.8);
      c.fillStyle = `rgba(255,255,255,${0.35 + rnd() * 0.5 * (1 - y / ground)})`;
      c.fill();
    }
  });
  scene.add.image(0, 0, 'sky').setOrigin(0).setScale(1 / R).setScrollFactor(0).setDepth(-10);

  art(scene, 'star', 12, 12, (c) => {
    glow(c, 6, 6, 6, '255,255,255', 0.5);
    sparkle(c, 6, 6, 5, '#ffffff');
  });
  const rs = seeded(17);
  for (let i = 0; i < 14; i++) {
    const s = scene.add
      .image(rs() * viewW, 10 + rs() * 110, 'star')
      .setScale((0.4 + rs() * 0.5) / R)
      .setScrollFactor(0)
      .setDepth(-9.8);
    scene.tweens.add({ targets: s, alpha: 0.15, duration: 900 + rs() * 1600, yoyo: true, repeat: -1, delay: rs() * 1500 });
  }

  // ---- the big moon, with the moon rabbit pounding mochi on its face ----
  const MR = 104;
  art(scene, 'moon', 300, 300, (c) => {
    glow(c, 150, 150, 150, '255,240,200', 0.55);
    const g = c.createRadialGradient(118, 112, 10, 150, 150, MR);
    g.addColorStop(0, '#fffdf0');
    g.addColorStop(1, '#f7e3b2');
    ell(c, 150, 150, MR, MR);
    c.fillStyle = g;
    c.fill();
    c.save();
    ell(c, 150, 150, MR, MR);
    c.clip();
    c.fillStyle = 'rgba(226,196,140,0.35)';
    for (const [x, y, rx, ry] of [[82, 104, 26, 18], [210, 92, 20, 14], [214, 206, 28, 18], [96, 214, 16, 11], [168, 60, 12, 8]]) {
      ell(c, x, y, rx, ry);
      c.fill();
    }
    // moon rabbit silhouette
    c.fillStyle = 'rgba(214,176,112,0.55)';
    ell(c, 172, 176, 30, 34); c.fill(); // body
    ell(c, 166, 128, 23, 21); c.fill(); // head
    ell(c, 154, 92, 7, 24, -0.25); c.fill(); // ears
    ell(c, 176, 90, 7, 24, 0.3); c.fill();
    ell(c, 200, 182, 9, 9); c.fill(); // tail
    c.beginPath(); // mortar
    c.moveTo(92, 186); c.lineTo(140, 186); c.lineTo(134, 214); c.lineTo(98, 214); c.closePath(); c.fill();
    ell(c, 116, 182, 18, 9); c.fill(); // mochi
    c.save(); // pestle
    c.translate(150, 160);
    c.rotate(-0.55);
    c.fillRect(-46, -3, 46, 6);
    c.beginPath(); c.roundRect(-62, -14, 18, 28, 6); c.fill();
    c.restore();
    c.restore();
    ell(c, 150, 150, MR, MR);
    c.strokeStyle = 'rgba(255,255,255,0.7)';
    c.lineWidth = 2;
    c.stroke();
  });
  scene.add.image(430, 120, 'moon').setScale(1 / R).setScrollFactor(0.04).setDepth(-9.5);

  // ---- far mountains + the rulers' floating palace (barely moves → feels far away) ----
  const fw = layerW(worldW, viewW, 0.12);
  layer(scene, 'far', fw, viewH, 0.12, -9, (c) => {
    const rnd = seeded(11);
    for (let x = -40; x < fw + 80; x += 70 + Math.floor(rnd() * 60)) {
      const h = 60 + rnd() * 70;
      const hw = 70 + rnd() * 40;
      c.beginPath();
      c.moveTo(x - hw, ground);
      c.bezierCurveTo(x - hw * 0.4, ground - h * 1.3, x + hw * 0.4, ground - h * 1.3, x + hw, ground);
      c.closePath();
      c.fillStyle = '#5d4f9c';
      c.fill();
    }
    // Far layer moves 0.08 px per scrolled px more than the moon, so put the palace far enough right
    // that it never drifts in front of the moon (it comes into view from mid-town onwards).
    const cx = fw - 100;
    const peak = ground - 150;
    c.beginPath();
    c.moveTo(cx - 120, ground);
    c.bezierCurveTo(cx - 60, peak - 10, cx + 60, peak - 10, cx + 120, ground);
    c.closePath();
    c.fillStyle = '#4e4189';
    c.fill();
    const pal = '#3d3170';
    rr(c, cx - 30, peak - 26, 60, 40, 6);
    c.fillStyle = pal;
    c.fill();
    for (const [dx, h] of [[-46, 44], [-18, 64], [10, 56], [34, 40]] as const) {
      rr(c, cx + dx, peak + 8 - h, 13, h, 3);
      c.fillStyle = pal;
      c.fill();
      dome(c, cx + dx + 6.5, peak + 9 - h, 8, 9);
      c.fillStyle = '#6a4d8f';
      c.fill();
      ell(c, cx + dx + 6.5, peak + 18 - h, 1.8, 2.2);
      c.fillStyle = P.lamp;
      c.fill();
    }
    for (const [dx, dy] of [[-6, -14], [8, -8], [-14, -2]]) {
      glow(c, cx + dx, peak + dy, 5);
      ell(c, cx + dx, peak + dy, 1.6, 2);
      c.fillStyle = P.lamp;
      c.fill();
    }
    line(c, [cx - 12, peak - 56, cx - 12, peak - 78], pal, 1.5);
    c.beginPath();
    c.moveTo(cx - 12, peak - 78);
    c.lineTo(cx, peak - 74);
    c.lineTo(cx - 12, peak - 70);
    c.fillStyle = P.gold;
    c.fill();
  });

  // ---- soft clouds (drift in update) ----
  for (let i = 0; i < 3; i++) {
    art(scene, 'cloud' + i, 80, 30, (c) => {
      const rnd = seeded(31 + i);
      const g = c.createLinearGradient(0, 4, 0, 28);
      g.addColorStop(0, 'rgba(255,255,255,0.85)');
      g.addColorStop(1, 'rgba(214,196,240,0.75)');
      c.fillStyle = g;
      c.beginPath();
      c.roundRect(6, 16, 68, 12, 6);
      for (let k = 0; k < 4; k++) {
        const r = 7 + rnd() * 6;
        c.moveTo(14 + k * 16 + r, 18);
        c.arc(14 + k * 16, 18, r, 0, Math.PI * 2);
      }
      c.fill();
    });
  }
  const clouds: Phaser.GameObjects.Image[] = [];
  const cw = layerW(worldW, viewW, 0.08);
  const rc = seeded(23);
  for (let i = 0; i < 8; i++) {
    const s = 0.6 + rc() * 0.6;
    clouds.push(
      scene.add
        .image(Math.floor(rc() * cw), 20 + Math.floor(rc() * 80), 'cloud' + (i % 3))
        .setScale(s / R)
        .setAlpha(0.8)
        .setScrollFactor(0.08)
        .setDepth(-8),
    );
  }

  // ---- rolling moon hills with craters (two layers) ----
  for (const [f, color, crater, base, amp] of [[0.3, '#7a6cb6', '#6b5ea6', 70, 22], [0.5, '#9789cc', '#887abd', 44, 14]] as const) {
    const w = layerW(worldW, viewW, f);
    const top = (x: number) => ground - base - Math.sin(x * 0.009 + f * 10) * amp - Math.sin(x * 0.027) * amp * 0.4;
    layer(scene, 'hill' + f, w, viewH, f, -7, (c) => {
      hillPath(c, w, viewH, top);
      c.fillStyle = color;
      c.fill();
      const rnd = seeded(Math.round(f * 100));
      for (let x = 30; x < w; x += 80 + rnd() * 120) {
        const y = top(x) + 14 + rnd() * 20;
        ell(c, x, y, 9 + rnd() * 8, 3 + rnd() * 2);
        c.fillStyle = crater;
        c.fill();
      }
    });
  }

  // ---- moon forest: lavender puff trees, pink blossoms and bamboo ----
  const tw = layerW(worldW, viewW, 0.72);
  layer(scene, 'forest', tw, viewH, 0.72, -6, (c) => {
    const rnd = seeded(13);
    for (let x = 0; x < tw; x += 22 + Math.floor(rnd() * 30)) {
      const kind = rnd();
      const h = 36 + rnd() * 34;
      if (kind < 0.25) {
        for (let k = 0; k < 3; k++) {
          const bx = x + k * 6 - 6;
          const bh = h + 10 - k * 8;
          rr(c, bx - 2.5, ground - bh, 5, bh, 2.5);
          c.fillStyle = '#5f9c8d';
          c.fill();
          ell(c, bx + 6, ground - bh + 8, 6, 2, -0.4);
          c.fill();
        }
        continue;
      }
      rr(c, x - 3, ground - 22, 6, 22, 3);
      c.fillStyle = '#4f4077';
      c.fill();
      const pink = kind > 0.8;
      const crown = pink ? '#c98ac0' : '#6c5cab';
      const light = pink ? '#e3a9d6' : '#8a79c6';
      const r = 12 + rnd() * 6;
      const cy = ground - h + r;
      for (const [dx, dy, s] of [[-r * 0.7, 6, 0.8], [r * 0.7, 6, 0.8], [0, 0, 1]]) {
        ell(c, x + dx, cy + dy, r * s, r * s);
        c.fillStyle = crown;
        c.fill();
      }
      ell(c, x - r * 0.3, cy - r * 0.3, r * 0.45, r * 0.35);
      c.fillStyle = light;
      c.fill();
    }
  });

  // ---- ground: moon dust, a cream path, pebbles and little craters ----
  layer(scene, 'ground', worldW, viewH, 1, -5, (c) => {
    const rnd = seeded(29);
    c.fillStyle = '#d3c9ee';
    c.fillRect(0, ground - 6, worldW, viewH);
    c.fillStyle = '#e8e1f8';
    c.fillRect(0, ground - 8, worldW, 4);
    c.fillStyle = '#c3b7e4';
    c.fillRect(0, ground + 24, worldW, viewH);
    rr(c, -10, ground + 6, worldW + 20, 18, 9);
    c.fillStyle = '#f5ead3';
    c.fill();
    c.fillStyle = '#e4d5b8';
    c.fillRect(0, ground + 20, worldW, 2);
    for (let i = 0; i < 220; i++) {
      ell(c, rnd() * worldW, ground + 10 + rnd() * 10, 1.4 + rnd() * 1.6, 1 + rnd());
      c.fillStyle = rnd() < 0.5 ? '#e0cfae' : '#fffaf0';
      c.fill();
    }
    for (let x = 40; x < worldW; x += 90 + rnd() * 140) {
      const y = ground + 32 + rnd() * (viewH - ground - 40);
      const r = 6 + rnd() * 8;
      ell(c, x, y, r, r * 0.4);
      c.fillStyle = '#ab9fd2';
      c.fill();
      ell(c, x + 1, y + 1, r * 0.75, r * 0.25);
      c.fillStyle = '#bcb0de';
      c.fill();
    }
  });

  // ---- foreground: mint tufts and glowing moon flowers (in front of everything) ----
  layer(scene, 'fg', worldW, viewH, 1, 7, (c) => {
    const rnd = seeded(37);
    const petals = ['#ffffff', '#ffe7a3', '#ffb3c8', '#a6f4ff'];
    for (let x = 0; x < worldW; x += 10 + Math.floor(rnd() * 22)) {
      const y = ground + 30 + Math.floor(rnd() * (viewH - ground - 32));
      c.strokeStyle = '#78c7a3';
      c.lineWidth = 1.8;
      for (const [dx, hh] of [[-3, 5], [0, 8], [3, 5]]) {
        c.beginPath();
        c.moveTo(x, y);
        c.quadraticCurveTo(x + dx * 0.4, y - hh * 0.6, x + dx, y - hh);
        c.stroke();
      }
      if (rnd() < 0.3) {
        const col = petals[Math.floor(rnd() * petals.length)];
        glow(c, x, y - 10, 6, '255,255,255', 0.35);
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * Math.PI * 2;
          ell(c, x + Math.cos(a) * 2, y - 10 + Math.sin(a) * 2, 1.8, 1.8);
          c.fillStyle = col;
          c.fill();
        }
        ell(c, x, y - 10, 1.2, 1.2);
        c.fillStyle = P.gold;
        c.fill();
      }
    }
  });

  return { clouds, cloudWrap: cw };
}

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
