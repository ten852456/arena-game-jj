/**
 * Share card for a crowned run: a 1200x675 PNG drawn on a canvas (hero, 10/10 stars, record, build icons, name).
 * Shared with the Web Share API when the browser can share files, otherwise downloaded.
 */
import { IMAGES, skillIcon } from '../../art/assets';
import { iconURL } from '../../ui/icons';
import { DEPTH_FILES, depthArt } from '../../art/depthArt';

export interface CardData {
  runId: string;
  /** chibi SVG markup of the hero */
  heroSvg: string;
  heroName: string;
  player: string;
  wins: number;
  losses: number;
  winTarget: number;
  /** longest win streak */
  streak: number;
  /** skill ids of the final build, top to bottom */
  skills: string[];
  /** ★ count per skill (same order as skills) and the run's relics as "icon name" (sim v17) */
  stars?: number[];
  relics?: string[];
  /** localized lines */
  title: string;
  sub: string;
  recordLine: string;
  footer: string;
}

const W = 1200;
const H = 675;
const cache = new Map<string, Promise<Blob | null>>();

function load(src: string): Promise<HTMLImageElement | null> {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = src;
  });
}
const svgSrc = (svg: string) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
/** give an SVG a pixel size (its viewBox ratio) so the canvas draws it sharp and undistorted */
function sized(svg: string, h: number) {
  const vb = /viewBox="([\d.\s-]+)"/.exec(svg)?.[1].trim().split(/\s+/).map(Number);
  const w = vb && vb[3] ? Math.round((h * vb[2]) / vb[3]) : h;
  return svg.replace(/\swidth="[^"]*"|\sheight="[^"]*"/g, '').replace('<svg ', `<svg width="${w}" height="${h}" `);
}
function rr(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}
function fit(g: CanvasRenderingContext2D, text: string, max: number) {
  if (g.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && g.measureText(t + '…').width > max) t = t.slice(0, -1);
  return t + '…';
}

async function draw(d: CardData): Promise<Blob | null> {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  if (!g) return null;
  try {
    await document.fonts?.ready;
  } catch {
    /* fonts are a nicety */
  }
  const iconImg = (n: string) => load(iconURL(n).replace(/^url\("|"\)$/g, ''));
  const [bg, hero, dust, star, crown, ...skills] = await Promise.all([
    load(IMAGES.bgTitle), load(svgSrc(sized(d.heroSvg, 420))), load(IMAGES.stardust), iconImg('star'), iconImg('crown'),
    ...d.skills.slice(0, 8).map((id) => load(skillIcon(id))),
  ]);
  // night sky
  if (bg) {
    const s = Math.max(W / bg.width, H / bg.height);
    g.drawImage(bg, (W - bg.width * s) / 2, (H - bg.height * s) / 2, bg.width * s, bg.height * s);
  }
  const shade = g.createLinearGradient(0, 0, W, 0);
  shade.addColorStop(0, 'rgba(21,14,39,0.35)');
  shade.addColorStop(0.45, 'rgba(21,14,39,0.55)');
  shade.addColorStop(1, 'rgba(21,14,39,0.9)');
  g.fillStyle = shade;
  g.fillRect(0, 0, W, H);
  // spotlight + hero + crown
  const spot = g.createRadialGradient(300, 380, 20, 300, 380, 300);
  spot.addColorStop(0, 'rgba(255,227,163,0.55)');
  spot.addColorStop(1, 'rgba(255,227,163,0)');
  g.fillStyle = spot;
  g.fillRect(0, 60, 620, 615);
  if (hero) g.drawImage(hero, 300 - hero.width / 2, 170, hero.width, hero.height);
  if (crown) g.drawImage(crown, 300 - 70, 70, 140, 140);
  // frame: ink outline + dashed thread, like the game's paper panels
  g.lineWidth = 10;
  g.strokeStyle = '#150e27';
  rr(g, 12, 12, W - 24, H - 24, 34);
  g.stroke();
  g.setLineDash([10, 8]);
  g.lineWidth = 2;
  g.strokeStyle = 'rgba(255,232,196,0.45)';
  rr(g, 26, 26, W - 52, H - 52, 26);
  g.stroke();
  g.setLineDash([]);
  // text column
  const x = 600;
  const maxW = W - x - 60;
  g.textBaseline = 'alphabetic';
  g.fillStyle = '#ffe3a3';
  g.font = '500 30px Mitr, Kanit, sans-serif';
  g.fillText('Mochi Moon', x, 92);
  g.shadowColor = '#150e27';
  g.shadowOffsetY = 4;
  g.font = '500 64px Mitr, Kanit, sans-serif';
  g.fillStyle = '#fff4e4';
  g.fillText(fit(g, d.title, maxW), x, 172);
  g.shadowOffsetY = 0;
  g.font = '400 30px Kanit, sans-serif';
  g.fillStyle = '#d4c8f7';
  g.fillText(fit(g, d.sub, maxW), x, 218);
  // stars
  for (let i = 0; i < d.winTarget; i++) {
    const on = i < d.wins;
    g.globalAlpha = on ? 1 : 0.25;
    if (star) g.drawImage(star, x + i * 52, 246, 48, 48);
    g.globalAlpha = 1;
  }
  g.font = '600 34px Kanit, sans-serif';
  g.fillStyle = '#ffd572';
  g.fillText(fit(g, d.recordLine, maxW), x, 340);
  // build
  const sz = 64;
  skills.forEach((img, i) => {
    const bx = x + (i % 8) * (sz + 10);
    const by = 372;
    g.fillStyle = '#241c46';
    rr(g, bx, by, sz, sz, 14);
    g.fill();
    if (img) g.drawImage(img, bx + 4, by + 4, sz - 8, sz - 8);
    g.lineWidth = 4;
    g.strokeStyle = '#150e27';
    rr(g, bx, by, sz, sz, 14);
    g.stroke();
    const st = d.stars?.[i] ?? 0;
    if (st > 0) {
      g.font = '700 18px Kanit, sans-serif';
      g.fillStyle = '#ffd34d';
      g.fillText('★'.repeat(st), bx + 4, by + sz - 4);
    }
  });
  if (d.relics?.length) {
    g.font = '500 22px Kanit, sans-serif';
    g.fillStyle = '#e9dcff';
    g.fillText(fit(g, d.relics.join('  ·  '), maxW), x, 462);
  }
  g.font = '500 34px Mitr, Kanit, sans-serif';
  g.fillStyle = '#fff4e4';
  g.fillText(fit(g, d.player, maxW), x, 500);
  g.font = '400 26px Kanit, sans-serif';
  g.fillStyle = '#d4c8f7';
  g.fillText(fit(g, d.heroName, maxW), x, 540);
  if (dust) g.drawImage(dust, x, 572, 34, 42);
  g.font = '400 22px Kanit, sans-serif';
  g.fillStyle = '#cfc6f5';
  g.fillText(fit(g, d.footer, maxW - 48), x + 46, 602);
  return new Promise((res) => c.toBlob((b) => res(b), 'image/png'));
}

/** The card as a PNG blob (drawn once per run). */
export function cardBlob(d: CardData): Promise<Blob | null> {
  let p = cache.get(d.runId + d.title);
  if (!p) {
    p = draw(d).catch(() => null);
    cache.set(d.runId + d.title, p);
  }
  return p;
}

const fileName = (d: CardData) => `mochi-moon-crown-${d.wins}-${d.losses}.png`;

/** Share the card (Web Share API with a file) or download it. Returns what happened. */
export async function shareCard(d: CardData, text: string): Promise<'shared' | 'saved' | 'failed'> {
  const blob = await cardBlob(d);
  if (!blob) return 'failed';
  const file = new File([blob], fileName(d), { type: 'image/png' });
  const nav = navigator as Navigator & { canShare?: (x: unknown) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], text });
      return 'shared';
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return 'shared'; // the player closed the share sheet
    }
  }
  return saveCard(d);
}

/** Download the card as a PNG. */
export async function saveCard(d: CardData): Promise<'saved' | 'failed'> {
  const blob = await cardBlob(d);
  if (!blob) return 'failed';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName(d);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return 'saved';
}

// ---------- Build Card (sim v17+ depth: branches, rarity, stars, marks, relics, the W/L log) ----------
export interface BuildCardImage {
  runId: string;
  heroSvg: string;
  heroName: string;
  /** "⚔ ตี · ★ เงาจันทร์ Lv2" */
  heroLine: string;
  player: string;
  won: boolean;
  wins: number;
  losses: number;
  skills: { id: string; name: string; meta: string; rarity: 'common' | 'rare' | 'epic'; star: number; mark: string }[];
  relics: string[];
  /** one entry per fight: 'w' | 'l' | 'd' */
  log: ('w' | 'l' | 'd')[];
  title: string;
  summary: string;
  footer: string;
}
const BW = 1200;
const BH = 630;
const RAR: Record<string, string> = { epic: '#b48cff', rare: '#9ccbff', common: 'rgba(255,232,196,0.3)' };

async function drawBuild(d: BuildCardImage): Promise<Blob | null> {
  const c = document.createElement('canvas');
  c.width = BW;
  c.height = BH;
  const g = c.getContext('2d');
  if (!g) return null;
  try {
    await document.fonts?.ready;
  } catch {
    /* fonts are a nicety */
  }
  const bgSrc = depthArt(DEPTH_FILES.buildcardBg);
  const frSrc = depthArt(DEPTH_FILES.buildcardFrame);
  const [bg, frame, hero, burst, ...icons] = await Promise.all([
    load(bgSrc ?? IMAGES.bgTitle), frSrc ? load(frSrc) : Promise.resolve(null), load(svgSrc(sized(d.heroSvg, frSrc ? 136 : 210))),
    depthArt(DEPTH_FILES.star3Burst) ? load(depthArt(DEPTH_FILES.star3Burst)!) : Promise.resolve(null),
    ...d.skills.slice(0, 8).map((k) => load(skillIcon(k.id))),
  ]);
  if (bg) {
    const s = Math.max(BW / bg.width, BH / bg.height);
    g.drawImage(bg, (BW - bg.width * s) / 2, (BH - bg.height * s) / 2, bg.width * s, bg.height * s);
  }
  // the painted frame leaves an inner window (clouds, moon and bunnies around it): the card's content lives in a plum
  // panel inside it; without the frame the same layout gets the old ink border
  const P = frame ? { x: 112, y: 128, w: 976, h: 372 } : { x: 40, y: 40, w: BW - 80, h: BH - 80 };
  g.fillStyle = 'rgba(30,22,62,0.9)';
  rr(g, P.x, P.y, P.w, P.h, 26);
  g.fill();
  if (frame) g.drawImage(frame, 0, 0, BW, BH);
  else {
    g.lineWidth = 10;
    g.strokeStyle = '#150e27';
    rr(g, 12, 12, BW - 24, BH - 24, 34);
    g.stroke();
  }
  // left: hero, name, record
  const lx = P.x + 22;
  const spot = g.createRadialGradient(lx + 105, P.y + 120, 10, lx + 105, P.y + 120, 140);
  spot.addColorStop(0, d.won ? 'rgba(255,227,163,0.45)' : 'rgba(212,200,247,0.3)');
  spot.addColorStop(1, 'rgba(255,227,163,0)');
  g.fillStyle = spot;
  g.fillRect(P.x, P.y, 260, 260);
  // (the painted frame's sleeping bunnies sit over the panel's bottom corners: the left column ends above them)
  const top = frame ? 0 : 40;
  if (hero) g.drawImage(hero, lx + 105 - hero.width / 2, P.y + 6 + top, hero.width, hero.height);
  g.textBaseline = 'alphabetic';
  g.fillStyle = '#fff4e4';
  g.font = '600 44px Mitr, Kanit, sans-serif';
  g.fillText(`${d.wins}–${d.losses}`, lx, P.y + 186 + top);
  g.font = '500 23px Mitr, Kanit, sans-serif';
  g.fillText(fit(g, d.heroName, 230), lx, P.y + 214 + top);
  g.font = '400 15px Kanit, sans-serif';
  g.fillStyle = '#d4c8f7';
  g.fillText(fit(g, d.heroLine, 230), lx, P.y + 234 + top);
  // right: skills (2 x 4 tiles), relics, the day log
  const x0 = P.x + 270;
  // (the frame's hanging stars reach into the panel's top-right corner: leave them room)
  const tw = (P.w - 270 - 22 - 10 - (frame ? 44 : 0)) / 2;
  const th = 56;
  d.skills.slice(0, 8).forEach((k, i) => {
    const x = x0 + (i % 2) * (tw + 10);
    const y = P.y + 18 + Math.floor(i / 2) * (th + 8);
    g.fillStyle = 'rgba(21,14,39,0.75)';
    rr(g, x, y, tw, th, 14);
    g.fill();
    g.lineWidth = k.rarity === 'common' && k.star < 3 ? 2.5 : 4;
    g.strokeStyle = k.star >= 3 ? '#ffd34d' : RAR[k.rarity];
    rr(g, x, y, tw, th, 14);
    g.stroke();
    const img = icons[i];
    if (img) g.drawImage(img, x + 7, y + 6, 44, 44);
    if (k.star >= 3 && burst) g.drawImage(burst, x + tw - 34, y - 10, 34, 34);
    g.fillStyle = '#fff4e4';
    g.font = '600 19px Kanit, sans-serif';
    g.fillText(fit(g, k.name, tw - 70), x + 58, y + 24);
    g.font = '400 14px Kanit, sans-serif';
    g.fillStyle = k.rarity === 'epic' ? '#d9c4ff' : k.rarity === 'rare' ? '#cfe8ff' : '#b8afd9';
    const tags = `${'★'.repeat(k.star)}${k.mark ? `  ${k.mark}` : ''}`;
    g.fillText(fit(g, k.meta, tw - 70 - (tags.trim() ? g.measureText(tags).width + 14 : 0)), x + 58, y + 45);
    if (tags.trim()) {
      g.font = '700 15px Kanit, sans-serif';
      g.fillStyle = '#ffd34d';
      g.fillText(tags, x + tw - 8 - g.measureText(tags).width, y + 45);
    }
  });
  const rows = Math.ceil(Math.min(8, d.skills.length) / 2);
  const ry = P.y + 18 + rows * (th + 8) + 18;
  g.font = '500 17px Kanit, sans-serif';
  g.fillStyle = '#e9dcff';
  g.fillText(fit(g, d.relics.join('   ·   ') || '—', P.w - 270 - 22), x0, ry);
  g.fillStyle = '#ffd34d';
  g.font = '600 16px Kanit, sans-serif';
  g.fillText(d.summary, x0, ry + 26);
  d.log.forEach((r, i) => {
    const x = x0 + i * 28;
    if (x > P.x + P.w - 40) return;
    g.fillStyle = r === 'w' ? '#b2ebcb' : r === 'd' ? '#c6c1e8' : '#ff9b9b';
    rr(g, x, ry + 40, 22, 22, 6);
    g.fill();
    g.lineWidth = 2.5;
    g.strokeStyle = '#150e27';
    rr(g, x, ry + 40, 22, 22, 6);
    g.stroke();
  });
  // footer under the panel: title, player and date on one line
  // who and when, under the hero (clear of the frame's bunnies and of a full 8-skill grid)
  g.font = '500 16px Mitr, Kanit, sans-serif';
  g.fillStyle = '#fff4e4';
  g.fillText(fit(g, d.player, 230), lx, P.y + 258 + top);
  g.font = '400 13px Kanit, sans-serif';
  g.fillStyle = '#cfc6f5';
  g.fillText(fit(g, d.title, 230), lx, P.y + 274 + top);
  g.fillText(fit(g, d.footer, 230), lx, P.y + 290 + top);
  return new Promise((res) => c.toBlob((b) => res(b), 'image/png'));
}
/** Download the Build Card as a PNG. */
export async function saveBuildCard(d: BuildCardImage): Promise<'saved' | 'failed'> {
  let blob: Blob | null = null;
  try {
    blob = await drawBuild(d);
  } catch {
    blob = null;
  }
  if (!blob) return 'failed';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `mochi-moon-build-${d.wins}-${d.losses}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return 'saved';
}
