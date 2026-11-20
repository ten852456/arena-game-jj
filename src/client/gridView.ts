import { activeBonuses, bonusValue, cellsOf, footprint, type ActiveBonus } from '../sim/grid';
import { ARCH_NAME, SKILLS, chipsOf, lvOf, nodeOf } from '../sim/skills';
import type { Archetype, Bonus, Rot, SkillInstance } from '../sim/types';
import { L } from '../i18n';
import { skillIcon } from './assets';

/**
 * Skill blocks drawn as one SVG shape each, filled with the skill's own pattern.
 * Blocks on the build grid carry a short label (name + main icon/number) so they read on a phone without hover;
 * full details are in the tooltip / selected panel. Sizes use the CSS var --c (one grid cell).
 */

const U = 20; // SVG units per cell
export const ARCH_HEX: Record<Archetype | 'none', string> = {
  tank: '#5aa0e6', burst: '#e65a5a', scaling: '#e6b45a', control: '#7fe0f0', none: '#9aa4ad',
};
const INK = 'rgba(0,0,0,.42)';
const LIGHT = 'rgba(255,255,255,.55)';

/** One 10×10 tile per skill. Every skill has its own look. */
const PATTERN: Record<string, string> = {
  strike: `<path d="M-1 11 L11 -1" stroke="${INK}" stroke-width="2.2"/>`,
  jab: `<path d="M3 2 L7 5 L3 8" fill="none" stroke="${INK}" stroke-width="1.6"/>`,
  heavy: `<path d="M0 0 L10 10 M10 0 L0 10" stroke="${INK}" stroke-width="2.4"/>`,
  charge: `<path d="M1 7 L5 3 L9 7" fill="none" stroke="${LIGHT}" stroke-width="1.8"/>`,
  shield: `<path d="M0 5 A5 5 0 0 0 10 5" fill="none" stroke="${INK}" stroke-width="1.4"/>`,
  thorns: `<path d="M0 10 L2.5 3 L5 10 L7.5 3 L10 10 Z" fill="${INK}"/>`,
  stoneskin: `<path d="M0 0.5 H10 M0 5.5 H10 M5 0.5 V5.5 M0.5 5.5 V10" stroke="${INK}" stroke-width="1.2"/>`,
  train: `<circle cx="5" cy="5" r="3" fill="none" stroke="${INK}" stroke-width="1.4"/>`,
  ignite: `<path d="M5 9.5 C1.5 6.5 4 4 5 0.5 C6 4 8.5 6.5 5 9.5 Z" fill="rgba(255,90,20,.7)"/>`,
  feast: `<circle cx="2.5" cy="2.5" r="1.4" fill="${INK}"/><circle cx="7.5" cy="7.5" r="1.4" fill="${INK}"/>`,
  frost: `<path d="M5 1 V9 M1 5 H9 M2.2 2.2 L7.8 7.8 M7.8 2.2 L2.2 7.8" stroke="#ffffff" stroke-width="0.9"/>`,
  chill: `<path d="M0 5 Q2.5 1.5 5 5 T10 5" fill="none" stroke="${LIGHT}" stroke-width="1.5"/>`,
  ironwill: `<path d="M0 0 H10 V10" fill="none" stroke="${INK}" stroke-width="1"/><circle cx="5" cy="5" r="1.6" fill="${LIGHT}"/>`,
  bulwark: `<circle cx="5" cy="5" r="2" fill="${INK}"/><circle cx="4.4" cy="4.4" r="0.8" fill="${LIGHT}"/>`,
  execute: `<path d="M2.5 2.5 L7.5 7.5 M7.5 2.5 L2.5 7.5" stroke="#5a0c0c" stroke-width="2"/>`,
  rampage: `<path d="M0 7 L2.5 3 L5 7 L7.5 3 L10 7" fill="none" stroke="${INK}" stroke-width="1.8"/>`,
  amplify: `<path d="M2 5.5 L5 2.5 L8 5.5 M2 9 L5 6 L8 9" fill="none" stroke="${LIGHT}" stroke-width="1.5"/>`,
  cleanse: `<path d="M5 2 V8 M2 5 H8" stroke="#ffffff" stroke-width="1.2"/><circle cx="8.5" cy="1.5" r=".8" fill="#ffffff"/>`,
  dispel: `<circle cx="5" cy="5" r="3.2" fill="none" stroke="#ffffff" stroke-width="1.1" stroke-dasharray="2.2 1.6"/>`,
  gear: `<circle cx="5" cy="5" r="2.6" fill="none" stroke="${INK}" stroke-width="1.6"/><path d="M5 0.6 V2 M5 8 V9.4 M0.6 5 H2 M8 5 H9.4" stroke="${INK}" stroke-width="1.8"/>`,
  overclock: `<path d="M6 0.5 L2.8 5.4 H5.4 L4 9.5 L7.6 4.3 H5 Z" fill="#ffe066" stroke="${INK}" stroke-width=".5"/>`,
  shatter: `<path d="M0 3 L4 5 L3 10 M4 5 L10 4 M7 4.5 L8 0" fill="none" stroke="#ffffff" stroke-width="0.9"/>`,
  spikewall: `<path d="M0 10 L2 6 L4 10 L6 6 L8 10 L10 6" fill="none" stroke="${INK}" stroke-width="1.2"/><rect x="0" y="0" width="10" height="3" fill="${INK}"/>`,
  flurry: `<path d="M1 3 L9 1 M1 6 L9 4 M1 9 L9 7" stroke="${LIGHT}" stroke-width="1.1"/>`,
  inferno: `<circle cx="5" cy="5" r="3.4" fill="rgba(255,90,20,.65)"/><circle cx="5" cy="5" r="1.4" fill="#fff2a0"/>`,
  timewarp: `<circle cx="5" cy="5" r="3.6" fill="none" stroke="#ffffff" stroke-width="0.9"/><path d="M5 5 V2.4 M5 5 L3 6.5" stroke="#ffffff" stroke-width="0.9"/>`,
};

/** Put the pattern defs into the page once. */
export function installPatterns() {
  if (document.getElementById('skill-patterns')) return;
  const defs = Object.entries(PATTERN)
    .map(
      ([id, art]) =>
        `<pattern id="pat-${id}" width="10" height="10" patternUnits="userSpaceOnUse"><rect width="10" height="10" fill="${ARCH_HEX[SKILLS[id]?.arch ?? 'none']}"/>${art}</pattern>`,
    )
    .join('');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.id = 'skill-patterns';
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.style.position = 'absolute';
  svg.innerHTML = `<defs>${defs}</defs>`;
  document.body.prepend(svg);
}

type Piece = Pick<SkillInstance, 'id' | 'v' | 'shape' | 'mark'> & { rot?: Rot };

interface BlockOpts {
  /** data-blk index (interactive) */
  idx?: number;
  /** data-tip key for the hover tooltip */
  tip?: string;
  at?: [number, number];
  selected?: boolean;
  buffed?: boolean;
  /** draw the short name + main chip on the block (build grid, drag ghost) */
  label?: boolean;
}

/** Visible width of a string in "em" (Thai combining marks take no room, emoji about 1.1em). */
function textEm(s: string) {
  let n = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if ((c >= 0x0e31 && c <= 0x0e3a && c !== 0x0e32 && c !== 0x0e33) || (c >= 0x0e47 && c <= 0x0e4e) || c === 0xfe0f) continue;
    n += c > 0x2000 && (c < 0x0e00 || c > 0x0e7f) ? 1.1 : c < 128 ? 0.56 : 0.62;
  }
  return n;
}
/** Cut a label to fit `em` wide, with an ellipsis. */
function fitText(s: string, em: number) {
  if (textEm(s) <= em) return s;
  let out = '';
  for (const ch of s) {
    if (textEm(out + ch + '…') > em) break;
    out += ch;
  }
  return out.trimEnd() + '…';
}
const escXml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Short label inside the block: the skill icon plus name + main chip on the widest row of the shape (top-most on ties).
 * The icon gets its own cell when the shape has one off the label row; on a one-row block it sits at the left end. */
function labelSVG(k: Piece, cells: [number, number][]) {
  const has = (x: number, y: number) => cells.some((p) => p[0] === x && p[1] === y);
  let best = { x: 0, y: 0, run: 0 };
  for (const [x, y] of cells) {
    if (has(x - 1, y)) continue;
    let run = 1;
    while (has(x + run, y)) run++;
    if (run > best.run || (run === best.run && y < best.y)) best = { x, y, run };
  }
  const node = nodeOf(k);
  const chip = chipsOf(node)[0]?.text ?? '';
  const FS = 5.6; // font size in SVG units (one cell = 20)
  const href = skillIcon(k.id);
  const img = (x: number, y: number, s: number) =>
    `<image class="bl-icon" href="${href}" x="${x}" y="${y}" width="${s}" height="${s}" preserveAspectRatio="xMidYMid meet" pointer-events="none"/>`;
  const free = cells.find(([x, y]) => y !== best.y);
  let icon = '';
  let lx = best.x;
  let run = best.run;
  if (free) icon = img(free[0] * U + 3, free[1] * U + 3, U - 6);
  else if (run === 1) {
    // a one-cell block: big icon and the main number, no name
    return `<g class="blabel" aria-hidden="true" pointer-events="none">${img(best.x * U + 3.5, best.y * U + 1.5, 13)}${
      chip ? `<text class="bl-chip" x="${best.x * U + U / 2}" y="${best.y * U + 18.6}" font-size="${FS - 1.2}">${escXml(fitText(chip, (U - 2) / (FS - 1.2)))}</text>` : ''
    }</g>`;
  } else {
    icon = img(best.x * U + 2.5, best.y * U + 3, U - 5);
    lx += 1;
    run -= 1;
  }
  const room = (run * U - 3) / FS;
  const name = fitText(node.name, room);
  const main = fitText(chip, room);
  const cx = lx * U + (run * U) / 2;
  const y0 = best.y * U;
  return `<g class="blabel" aria-hidden="true" pointer-events="none">${icon}<text x="${cx}" y="${y0 + 11}" font-size="${FS}">${escXml(name)}</text>${
    main ? `<text class="bl-chip" x="${cx}" y="${y0 + 17.6}" font-size="${FS - 0.4}">${escXml(main)}</text>` : ''
  }</g>`;
}

/** One block as a single SVG: pattern-filled cells, outline only on the outside edges, level pips. */
function blockSVG(k: Piece, o: BlockOpts) {
  const rot = (k.rot ?? 0) as Rot;
  const cells = cellsOf(k.shape, rot);
  const bw = Math.max(...cells.map((c) => c[0])) + 1;
  const bh = Math.max(...cells.map((c) => c[1])) + 1;
  const has = (x: number, y: number) => cells.some((p) => p[0] === x && p[1] === y);
  const arch = SKILLS[k.id]?.arch ?? 'none';
  let body = '';
  let edges = '';
  const g = 1.2; // inset so neighbouring blocks show a gap
  cells.forEach(([x, y], c) => {
    const x0 = x * U + (has(x - 1, y) ? 0 : g);
    const y0 = y * U + (has(x, y - 1) ? 0 : g);
    const x1 = (x + 1) * U - (has(x + 1, y) ? 0 : g);
    const y1 = (y + 1) * U - (has(x, y + 1) ? 0 : g);
    body += `<rect class="hit" data-c="${c}" x="${x0}" y="${y0}" width="${x1 - x0 + (has(x + 1, y) ? 0.6 : 0)}" height="${y1 - y0 + (has(x, y + 1) ? 0.6 : 0)}" fill="url(#pat-${k.id})"/>`;
    if (!has(x, y - 1)) edges += `M${x0} ${y0} H${x1} `;
    if (!has(x, y + 1)) edges += `M${x0} ${y1} H${x1} `;
    if (!has(x - 1, y)) edges += `M${x0} ${y0} V${y1} `;
    if (!has(x + 1, y)) edges += `M${x1} ${y0} V${y1} `;
  });
  const [px, py] = cells[0];
  let pips = '';
  const lv = lvOf(k.v);
  for (let l = 0; l < lv; l++) pips += `<circle cx="${px * U + 4 + l * 3.4}" cy="${py * U + 4}" r="1.35" fill="${lv >= 3 ? '#ffe066' : '#fff'}" stroke="#000" stroke-width=".5"/>`;
  if (k.mark) pips += `<path d="M${px * U + 4} ${py * U + 7} l2.5 2.5 l-2.5 2.5 l-2.5 -2.5 Z" fill="#c9a0ff" stroke="#000" stroke-width=".6"/>`;
  const label = o.label ? labelSVG(k, cells) : '';
  const [ox, oy] = o.at ?? [0, 0];
  const cls = `blk arch-${arch}${o.selected ? ' sel' : ''}${o.buffed ? ' buffed' : ''}`;
  const data = `${o.idx !== undefined ? ` data-blk="${o.idx}"` : ''}${o.tip ? ` data-tip="${o.tip}"` : ''}`;
  return `<svg class="${cls}"${data} viewBox="0 0 ${bw * U} ${bh * U}" style="left:calc(var(--c)*${ox});top:calc(var(--c)*${oy});width:calc(var(--c)*${bw});height:calc(var(--c)*${bh})">${body}<path class="edge" d="${edges}" fill="none"/>${label}${pips}</svg>`;
}

/** Blocks that have at least one connect bonus switched on. */
export const buffedSet = (act: ActiveBonus[]) => new Set(act.map((a) => a.from));

/** The packing grid. interactive = cells and blocks carry data attributes for drag/tap/hover. */
export function gridHTML(
  skills: SkillInstance[],
  w: number,
  h: number,
  opts: { interactive?: boolean; selected?: number; small?: boolean; labels?: boolean } = {},
) {
  const buffed = buffedSet(activeBonuses(skills, w, h));
  let cells = '';
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      cells += `<div class="gc" ${opts.interactive ? `data-gx="${x}" data-gy="${y}"` : ''} style="left:calc(var(--c)*${x});top:calc(var(--c)*${y})"></div>`;
  const blocks = skills
    .map((k, i) =>
      k.x < 0
        ? ''
        : blockSVG(k, {
            idx: opts.interactive ? i : undefined,
            tip: opts.interactive ? `g:${i}` : undefined,
            at: [k.x, k.y],
            selected: opts.selected === i,
            buffed: buffed.has(i),
            label: opts.labels,
          }),
    )
    .join('');
  // the live grid sizes its cells from its column count (--gw) so it never gets wider than a phone
  const fit = opts.interactive ? `--gw:${w};--gh:${h};` : '';
  return `<div class="grid${opts.small ? ' small' : ''}${opts.interactive ? ' live' : ''}" style="${fit}width:calc(var(--c)*${w});height:calc(var(--c)*${h})">${cells}${blocks}</div>`;
}

/** A single block preview (shop offer, bag item, drag ghost). */
export function pieceHTML(k: Piece, opts: { idx?: number; tip?: string; selected?: boolean; label?: boolean } = {}) {
  const cells = cellsOf(k.shape, (k.rot ?? 0) as Rot);
  const bw = Math.max(...cells.map((c) => c[0])) + 1;
  const bh = Math.max(...cells.map((c) => c[1])) + 1;
  return `<div class="piece" style="width:calc(var(--c)*${bw});height:calc(var(--c)*${bh})">${blockSVG(k, opts)}</div>`;
}

/** Origin so that block cell `c` lands on grid cell (gx, gy). */
export function dropOrigin(k: Pick<SkillInstance, 'shape' | 'rot'>, c: number, gx: number, gy: number): [number, number] {
  const [cx, cy] = cellsOf(k.shape, k.rot)[c];
  return [gx - cx, gy - cy];
}

export const footprintAt = (k: SkillInstance, x: number, y: number) => footprint({ ...k, x, y });

// ---------- text for tooltips ----------
export const targetName = (t: string) =>
  t.startsWith('arch:') ? L(`สาย${ARCH_NAME[t.slice(5) as Archetype]}`, `a ${ARCH_NAME[t.slice(5) as Archetype]} skill`) : SKILLS[t]?.name ?? t;

export function bonusText(b: Bonus, lv: number) {
  const v = bonusValue(b.e, lv);
  const eff = {
    dmg: L(`skill นี้ทำดาเมจ +${v} ทุกครั้งที่ตี`, `this skill deals +${v} damage on every hit`),
    shield: L(`ทุกครั้งที่ skill นี้ทำงาน คุณได้โล่ +${v}`, `each time this skill works, you gain +${v} shield`),
    haste: L('คูลดาวน์ของ skill นี้สั้นลง 20%', 'this skill’s cooldown is 20% shorter'),
    power: L('skill นี้แรงขึ้น 25% (ดาเมจ โล่ ฟื้นเลือด ไฟ ของ skill นี้เท่านั้น)', 'this skill is 25% stronger (its own damage, shield, healing and burn only)'),
    trigger: L('เมื่อ skill นี้ทำงาน ตัวที่ติดกันนั้นทำงานทันทีด้วย (คูลดาวน์ของตัวนั้นไม่รีเซ็ต)', 'when this skill works, that touching block works right away too (its cooldown does not reset)'),
  }[b.e];
  return L(`ติดกับ <b>${targetName(b.t)}</b>: ${eff}`, `Touching <b>${targetName(b.t)}</b>: ${eff}`);
}

export const BONUS_ICON: Record<Bonus['e'], string> = { dmg: '⚔', shield: '⛨', haste: '»', power: '▲', trigger: '⚡' };
