/**
 * Share card for a crowned run: a 1200x675 PNG drawn on a canvas (hero, 10/10 stars, record, build icons, name).
 * Shared with the Web Share API when the browser can share files, otherwise downloaded.
 */
import { IMAGES, skillIcon } from './assets';
import { iconURL } from './icons';

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
