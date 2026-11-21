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
  const [bg, hero, ...icons] = await Promise.all([load(IMAGES.bgTitle), load(svgSrc(sized(d.heroSvg, 300))), ...d.skills.slice(0, 8).map((k) => load(skillIcon(k.id)))]);
  if (bg) {
    const s = Math.max(BW / bg.width, BH / bg.height);
    g.drawImage(bg, (BW - bg.width * s) / 2, (BH - bg.height * s) / 2, bg.width * s, bg.height * s);
  }
  g.fillStyle = 'rgba(28,20,58,0.86)';
  g.fillRect(0, 0, BW, BH);
  const spot = g.createRadialGradient(190, 300, 10, 190, 300, 230);
  spot.addColorStop(0, d.won ? 'rgba(255,227,163,0.5)' : 'rgba(212,200,247,0.35)');
  spot.addColorStop(1, 'rgba(255,227,163,0)');
  g.fillStyle = spot;
  g.fillRect(0, 60, 400, 500);
  if (hero) g.drawImage(hero, 190 - hero.width / 2, 150, hero.width, hero.height);
  g.lineWidth = 10;
  g.strokeStyle = '#150e27';
  rr(g, 12, 12, BW - 24, BH - 24, 34);
  g.stroke();
  g.setLineDash([10, 8]);
  g.lineWidth = 2;
  g.strokeStyle = d.won ? 'rgba(255,211,77,0.6)' : 'rgba(255,232,196,0.4)';
  rr(g, 26, 26, BW - 52, BH - 52, 26);
  g.stroke();
  g.setLineDash([]);
  // left column: title, hero, record
  g.textBaseline = 'alphabetic';
  g.fillStyle = '#ffe3a3';
  g.font = '500 26px Mitr, Kanit, sans-serif';
  g.fillText(fit(g, d.title, 330), 52, 74);
  g.fillStyle = '#fff4e4';
  g.font = '600 64px Mitr, Kanit, sans-serif';
  g.fillText(`${d.wins}–${d.losses}`, 52, 140);
  g.font = '500 32px Mitr, Kanit, sans-serif';
  g.fillText(fit(g, d.heroName, 330), 52, 500);
  g.font = '400 21px Kanit, sans-serif';
  g.fillStyle = '#d4c8f7';
  g.fillText(fit(g, d.heroLine, 330), 52, 532);
  g.fillStyle = '#ffd34d';
  g.font = '600 21px Kanit, sans-serif';
  g.fillText(fit(g, d.summary, 330), 52, 562);
  // skills: 2 columns x 4 rows of tiles
  const x0 = 410;
  const tw = 370;
  const th = 82;
  d.skills.slice(0, 8).forEach((k, i) => {
    const x = x0 + (i % 2) * (tw + 14);
    const y = 50 + Math.floor(i / 2) * (th + 12);
    g.fillStyle = 'rgba(21,14,39,0.7)';
    rr(g, x, y, tw, th, 16);
    g.fill();
    g.lineWidth = k.rarity === 'common' && k.star < 3 ? 2.5 : 4;
    g.strokeStyle = k.star >= 3 ? '#ffd34d' : RAR[k.rarity];
    rr(g, x, y, tw, th, 16);
    g.stroke();
    const img = icons[i];
    if (img) g.drawImage(img, x + 10, y + 11, 60, 60);
    g.fillStyle = '#fff4e4';
    g.font = '600 24px Kanit, sans-serif';
    g.fillText(fit(g, k.name, tw - 100), x + 82, y + 34);
    g.font = '400 17px Kanit, sans-serif';
    g.fillStyle = k.rarity === 'epic' ? '#d9c4ff' : k.rarity === 'rare' ? '#cfe8ff' : '#b8afd9';
    g.fillText(fit(g, k.meta, tw - 100), x + 82, y + 58);
    const tags = `${'★'.repeat(k.star)}${k.mark ? `  ${k.mark}` : ''}`;
    if (tags.trim()) {
      g.font = '700 18px Kanit, sans-serif';
      g.fillStyle = '#ffd34d';
      g.fillText(tags, x + 82, y + 77);
    }
  });
  // relics + log
  g.font = '500 20px Kanit, sans-serif';
  g.fillStyle = '#e9dcff';
  g.fillText(fit(g, d.relics.join('   ·   ') || '—', BW - x0 - 50), x0, 452);
  d.log.forEach((r, i) => {
    const x = x0 + i * 40;
    if (x > BW - 70) return;
    g.fillStyle = r === 'w' ? '#b2ebcb' : r === 'd' ? '#c6c1e8' : '#ff9b9b';
    rr(g, x, 478, 32, 32, 8);
    g.fill();
    g.lineWidth = 3;
    g.strokeStyle = '#150e27';
    rr(g, x, 478, 32, 32, 8);
    g.stroke();
  });
  g.font = '500 26px Mitr, Kanit, sans-serif';
  g.fillStyle = '#fff4e4';
  g.fillText(fit(g, d.player, 400), x0, 562);
  g.font = '400 19px Kanit, sans-serif';
  g.fillStyle = '#cfc6f5';
  const fw = g.measureText(d.footer).width;
  g.fillText(d.footer, BW - 52 - fw, 562);
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
