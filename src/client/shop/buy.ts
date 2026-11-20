/**
 * Buying straight onto the build grid (ported from the list build's shopdrag.ts / pick.ts, adapted to the grid).
 *
 * - Landing preview: hovering (mouse) or pressing (touch) a shop card shows the exact spot a new block will land on
 *   when you press Buy: a see-through copy of the block on the grid with "+N 🔗" (or "→ bag" when there is no room).
 *   An upgrade card lights up the block it levels with a "▲ Lv2" tag instead.
 * - Drag to buy (mouse and pen): drag a shop card onto the grid. The block snaps to the cells under the pointer,
 *   green = fits, red = not; R / right-click rotates. Drop on the grid = buy it there, on the bag = buy into the bag,
 *   anywhere else = cancel (the card flies back). An upgrade card can be dropped anywhere on the grid.
 * - Tap to place (touch): press a card (it stays picked), then tap a grid cell: the block is bought and put on the
 *   best fitting spot that covers that cell. Tapping the see-through copy buys it right there.
 * The purchase itself is ui.ts (same R.buy as the Buy button, then R.place); nothing here changes the run.
 */
import { L } from '../../i18n';
import { cellsOf, footprint } from '../../sim/grid';
import * as R from '../../sim/run';
import type { Rot, SkillInstance } from '../../sim/types';
import { lvOf, nodeOf } from '../../sim/skills';
import { pieceHTML } from '../gridView';
import { cellAt, cellEl, cellPx, clearCells, flash, gridEl } from './board';
import { COIN } from './hud';
import { offerBest, offerPiece, rotsOf, scoreAt, withBlockAt } from './placement';

export interface Spot3 {
  x: number;
  y: number;
  rot: Rot;
}

export interface BuyCtx {
  run(): R.RunState | null;
  active(): boolean;
  /** why offer i can't be bought now ('' = it can) */
  why(i: number): string;
  /** buy offer i: at = grid spot for a new block, 'bag' = keep it in the bag, null = best spot (or the upgrade) */
  buy(i: number, at: Spot3 | 'bag' | null, from: DOMRect | null): void;
  /** live timeline / bonus preview for a layout that is not saved yet (null = the real one) */
  preview(skills: SkillInstance[] | null): void;
  hideTip(): void;
  spin(el: Element | null): void;
}

let ctx!: BuyCtx;
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** true while a shop card is being dragged */
export let buyDragging = false;

// ---------- landing preview ----------
export function clearLanding() {
  document.querySelectorAll('.gs-land, .gs-land-up').forEach((el) => el.remove());
  document.querySelectorAll('.gs-bag.land-bag, .gs-bagitem.gs-up').forEach((el) => el.classList.remove('land-bag', 'gs-up'));
  document.querySelector('.gs-bag .gs-land-tag')?.remove();
}

/** Show where offer i would go if bought now. tappable = touch pick: the copy can be tapped to buy there. */
export function showLanding(i: number, tappable: boolean) {
  clearLanding();
  const r = ctx.run();
  const o = r?.shop[i];
  const grid = gridEl();
  if (!r || !o || !grid) return;
  if (o.v !== '') {
    const up = R.upgradeOf(r, o);
    if (!up) return;
    const j = r.skills.indexOf(up);
    const tag = `▲ Lv${lvOf(o.v)}`;
    if (up.x < 0) {
      document.querySelector(`.gs-bag [data-blk="${j}"]`)?.closest('.gs-bagitem')?.classList.add('gs-up');
      return;
    }
    const blk = grid.querySelector(`[data-blk="${j}"]`);
    if (!blk) return;
    const gb = grid.getBoundingClientRect();
    const bb = blk.getBoundingClientRect();
    const t = document.createElement('span');
    t.className = 'gs-land-up';
    t.textContent = tag;
    t.style.left = `${bb.left - gb.left + bb.width / 2}px`;
    t.style.top = `${bb.top - gb.top}px`;
    grid.appendChild(t);
    return;
  }
  const spot = offerBest(r, o);
  if (!spot) {
    const bag = document.querySelector('.gs-bag');
    bag?.classList.add('land-bag');
    const tag = document.createElement('span');
    tag.className = 'gs-land-tag';
    tag.textContent = R.bag(r).length >= R.BAG_MAX ? L('ไม่มีที่ว่าง กระเป๋าก็เต็ม', 'No room, and the bag is full') : L('→ เข้ากระเป๋า (ตารางเต็ม)', '→ goes to your bag (grid full)');
    bag?.appendChild(tag);
    return;
  }
  const el = document.createElement('div');
  el.className = `gs-land${tappable ? ' tap' : ''}`;
  el.dataset.land = String(i);
  el.style.left = `calc(var(--c) * ${spot.x})`;
  el.style.top = `calc(var(--c) * ${spot.y})`;
  const k = { ...offerPiece(o), rot: spot.rot };
  el.innerHTML = `${pieceHTML(k, { label: true })}<span class="gs-land-tag">${
    tappable ? L('แตะเพื่อซื้อตรงนี้', 'Tap to buy here') : L('ลงตรงนี้', 'Lands here')
  }${spot.score > 0 ? ` · +${spot.score} 🔗` : ''}</span>`;
  if (tappable) {
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', L(`ซื้อ ${nodeOf(o).name} แล้ววางตรงนี้`, `Buy ${nodeOf(o).name} and put it here`));
  }
  grid.appendChild(el);
}

/** Touch pick: the see-through copy was tapped. */
export function buyAtLanding(i: number) {
  const r = ctx.run();
  const o = r?.shop[i];
  if (!r || !o) return;
  const why = ctx.why(i);
  if (why) return flash(why);
  const spot = offerBest(r, o);
  ctx.buy(i, spot ? { x: spot.x, y: spot.y, rot: spot.rot } : null, landRect());
}
const landRect = () => document.querySelector('.gs-land')?.getBoundingClientRect() ?? null;

/**
 * Touch pick: a grid cell was tapped while shop card i is picked. A new block goes to the fitting spot covering that
 * cell that switches on the most bonuses (other rotations are tried if it fits nowhere as it is); an upgrade is bought.
 */
export function buyAtCell(i: number, gx: number, gy: number) {
  const r = ctx.run();
  const o = r?.shop[i];
  if (!r || !o) return;
  const why = ctx.why(i);
  if (why) return flash(why);
  if (o.v !== '') return ctx.buy(i, null, cellEl(gx, gy)?.getBoundingClientRect() ?? null);
  const { w, h } = R.gridOf(r);
  const skills = [...r.skills, offerPiece(o)];
  const n = skills.length - 1;
  const best0 = offerBest(r, o);
  const order: Rot[] = [best0?.rot ?? 0, ...rotsOf(o.shape).filter((x) => x !== (best0?.rot ?? 0))];
  let best: { x: number; y: number; rot: Rot; score: number } | null = null;
  for (const rot of order) {
    for (const [cx, cy] of cellsOf(o.shape, rot)) {
      const x = gx - cx;
      const y = gy - cy;
      const score = scoreAt(skills, w, h, n, x, y, rot);
      if (score !== null && (!best || score > best.score)) best = { x, y, rot, score };
    }
    if (best) break;
  }
  if (!best) return flash(L('วางตรงนี้ไม่ได้ (ที่ว่างไม่พอ) · ลองช่องอื่น', 'It does not fit here (not enough room) · try another cell'));
  ctx.buy(i, { x: best.x, y: best.y, rot: best.rot }, cellEl(gx, gy)?.getBoundingClientRect() ?? null);
}

// ---------- drag a shop card onto the grid (mouse / pen) ----------
interface BuyDrag {
  i: number;
  pid: number;
  x0: number;
  y0: number;
  x: number;
  y: number;
  src: DOMRect;
  card: HTMLElement;
  rot: Rot;
  /** grabbed cell of the shape (index, stable under rotation) */
  c: number;
  up: number;
  active: boolean;
  float?: HTMLElement;
  spot?: { x: number; y: number; ok: boolean; score: number | null } | null;
  zone: 'grid' | 'bag' | null;
  raf: number;
}
let bd: BuyDrag | null = null;
const START_PX = 6;

/** Cell of the shape nearest its middle: the block is held there. */
function middleCell(shape: string) {
  const cells = cellsOf(shape, 0);
  const mx = cells.reduce((s, c) => s + c[0], 0) / cells.length;
  const my = cells.reduce((s, c) => s + c[1], 0) / cells.length;
  let best = 0;
  cells.forEach((c, k) => {
    if (Math.hypot(c[0] - mx, c[1] - my) < Math.hypot(cells[best][0] - mx, cells[best][1] - my)) best = k;
  });
  return best;
}

function floatHTML(d: BuyDrag) {
  const r = ctx.run()!;
  const o = r.shop[d.i]!;
  const price = R.priceOf(o);
  if (d.up >= 0) {
    return `<div class="gs-buyfloat up"><span class="bf-t"><b>${esc(nodeOf(o).name)}</b><small>${L('▲ ปล่อยบนตารางเพื่ออัปเกรด', '▲ Drop on the grid to upgrade')}</small></span><span class="bf-price">${COIN}${price}</span></div>`;
  }
  return `${pieceHTML({ ...offerPiece(o), rot: d.rot }, { label: true })}<span class="gs-gbadge"></span><span class="bf-price">${COIN}${price}</span>`;
}

function makeFloat(d: BuyDrag) {
  if (!d.float) {
    d.float = document.createElement('div');
    d.float.className = `drag-ghost gs-ghost gs-buyghost${d.up >= 0 ? ' up' : ''}`;
    d.float.setAttribute('aria-hidden', 'true');
    document.body.appendChild(d.float);
  }
  d.float.style.setProperty('--c', `${cellPx()}px`);
  d.float.innerHTML = floatHTML(d);
}

function update() {
  const d = bd;
  const r = ctx.run();
  if (!d || !r || !d.float) return;
  d.raf = 0;
  const o = r.shop[d.i]!;
  const cs = cellPx();
  const under = (document.elementFromPoint(d.x, d.y) as HTMLElement | null)?.closest<HTMLElement>('.gs-board, [data-drop="bag"]');
  const g = gridEl();
  const gb = g?.getBoundingClientRect();
  const overGrid = !!gb && d.x >= gb.left - cs / 2 && d.x <= gb.right + cs / 2 && d.y >= gb.top - cs / 2 && d.y <= gb.bottom + cs / 2;
  d.zone = overGrid || under?.classList.contains('gs-board') ? 'grid' : under?.dataset.drop === 'bag' ? 'bag' : null;
  document.querySelector('.gs-bag')?.classList.toggle('drop-on', d.zone === 'bag' && d.up < 0);
  if (d.up >= 0) {
    // upgrade: follow the pointer; light the owned block while over the grid
    d.float.style.left = `${d.x - 70}px`;
    d.float.style.top = `${d.y - 24}px`;
    document.querySelector(`.grid.live [data-blk="${d.up}"]`)?.classList.toggle('drop-up', d.zone === 'grid');
    d.float.classList.toggle('snap', d.zone === 'grid');
    return;
  }
  const { w, h } = R.gridOf(r);
  const skills = [...r.skills, offerPiece(o)];
  const n = skills.length - 1;
  const [cx, cy] = cellsOf(o.shape, d.rot)[d.c] ?? [0, 0];
  const at = cellAt(d.x, d.y);
  clearCells('ok', 'bad');
  let spot: BuyDrag['spot'] = null;
  if (at && overGrid && at[0] >= 0 && at[1] >= 0 && at[0] < w && at[1] < h) {
    const x = at[0] - cx;
    const y = at[1] - cy;
    const score = scoreAt(skills, w, h, n, x, y, d.rot);
    spot = { x, y, ok: score !== null, score };
    for (const [fx, fy] of footprint({ shape: o.shape, rot: d.rot, x, y })) cellEl(fx, fy)?.classList.add(spot.ok ? 'ok' : 'bad');
    d.float.style.left = `${gb!.left + x * cs}px`;
    d.float.style.top = `${gb!.top + y * cs}px`;
  } else {
    d.float.style.left = `${d.x - (cx + 0.5) * cs}px`;
    d.float.style.top = `${d.y - (cy + 0.5) * cs}px`;
  }
  d.float.classList.toggle('snap', !!spot);
  d.float.classList.toggle('bad', !!spot && !spot.ok);
  const badge = d.float.querySelector<HTMLElement>('.gs-gbadge');
  if (badge) {
    badge.textContent = spot?.ok ? (spot.score ? `+${spot.score} 🔗` : L('วางได้', 'fits')) : spot ? '✕' : d.zone === 'bag' ? L('→ กระเป๋า', '→ bag') : '';
    badge.style.display = badge.textContent ? '' : 'none';
  }
  const prev = d.spot;
  d.spot = spot;
  const same = prev && spot && prev.x === spot.x && prev.y === spot.y && prev.ok === spot.ok;
  if (!same) ctx.preview(spot?.ok ? withBlockAt(skills, n, spot.x, spot.y, d.rot) : null);
}

function begin(d: BuyDrag) {
  d.active = true;
  buyDragging = true;
  ctx.hideTip();
  clearLanding();
  document.body.classList.add('gs-dragging', 'shop-dragging');
  d.card.classList.add('drag-src');
  if (d.up >= 0) document.querySelector(`.grid.live [data-blk="${d.up}"]`)?.classList.add('gs-up', 'up-pulse');
  makeFloat(d);
}

function cleanup() {
  buyDragging = false;
  document.body.classList.remove('gs-dragging', 'shop-dragging');
  clearCells('ok', 'bad');
  document.querySelectorAll('.drop-up, .up-pulse, .gs-bag.drop-on, .drag-src').forEach((el) => el.classList.remove('drop-up', 'up-pulse', 'drop-on', 'drag-src'));
}

function onMove(ev: PointerEvent) {
  const d = bd;
  if (!d || ev.pointerId !== d.pid) return;
  d.x = ev.clientX;
  d.y = ev.clientY;
  if (!d.active) {
    if (Math.hypot(d.x - d.x0, d.y - d.y0) < START_PX) return;
    begin(d);
  }
  ev.preventDefault();
  if (!d.raf) d.raf = requestAnimationFrame(update);
}

function onUp(ev: PointerEvent) {
  const d = bd;
  if (!d || ev.pointerId !== d.pid) return;
  bd = null;
  if (d.raf) cancelAnimationFrame(d.raf);
  if (!d.active) return;
  // swallow the click that follows a drag
  const stop = (c: Event) => {
    c.stopPropagation();
    c.preventDefault();
  };
  window.addEventListener('click', stop, { capture: true, once: true });
  setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 60);
  const f = d.float;
  cleanup();
  ctx.preview(null);
  const cancel = ev.type === 'pointercancel';
  if (!cancel && d.up >= 0 && d.zone === 'grid') {
    f?.remove();
    return ctx.buy(d.i, null, f?.getBoundingClientRect() ?? null);
  }
  if (!cancel && d.up < 0 && d.spot?.ok) {
    f?.remove();
    return ctx.buy(d.i, { x: d.spot.x, y: d.spot.y, rot: d.rot }, f?.getBoundingClientRect() ?? null);
  }
  if (!cancel && d.up < 0 && d.zone === 'bag') {
    f?.remove();
    return ctx.buy(d.i, 'bag', f?.getBoundingClientRect() ?? null);
  }
  if (!cancel && d.spot && !d.spot.ok) flash(L('วางตรงนั้นไม่ได้ (ทับบล็อกอื่นหรือออกนอกตาราง) · ยังไม่ได้ซื้อ', 'It does not fit there (on another block or off the grid) · not bought'));
  // cancel: the block flies back to its card
  if (!f) return;
  if (reduced()) return f.remove();
  const b = f.getBoundingClientRect();
  const a = f.animate(
    [
      { transform: 'translate(0, 0)', opacity: 1 },
      { transform: `translate(${d.src.left + d.src.width / 2 - b.left - b.width / 2}px, ${d.src.top + 40 - b.top}px) scale(0.5)`, opacity: 0 },
    ],
    { duration: 220, easing: 'ease-in', fill: 'forwards' },
  );
  a.onfinish = () => f.remove();
  setTimeout(() => f.remove(), 400);
}

function rotate() {
  const d = bd;
  const r = ctx.run();
  if (!d?.active || d.up >= 0 || !r) return false;
  d.rot = ((d.rot + 1) % 4) as Rot;
  makeFloat(d);
  ctx.spin(d.float!.querySelector('.blk'));
  d.spot = undefined;
  update();
  return true;
}

function onDown(ev: PointerEvent) {
  if (ev.button !== 0 || ev.pointerType === 'touch' || !ctx.active()) return;
  const t = ev.target as HTMLElement;
  const card = t.closest<HTMLElement>('.gs-card[data-card]');
  if (!card || t.closest('button, a, input, .kw, .gs-link')) return;
  const i = Number(card.dataset.card);
  const r = ctx.run();
  const o = r?.shop[i];
  if (!r || !o || ctx.why(i)) return;
  ev.preventDefault(); // no text selection
  const up = R.upgradeOf(r, o);
  const best = offerBest(r, o);
  bd = {
    i, pid: ev.pointerId, x0: ev.clientX, y0: ev.clientY, x: ev.clientX, y: ev.clientY, src: card.getBoundingClientRect(), card,
    rot: best?.rot ?? 0, c: middleCell(o.shape), up: up ? r.skills.indexOf(up) : -1, active: false, zone: null, raf: 0,
  };
}

export function initBuy(root: HTMLElement, c: BuyCtx) {
  ctx = c;
  root.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove, { passive: false });
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  window.addEventListener('keydown', (ev) => {
    if ((ev.key === 'r' || ev.key === 'R') && rotate()) ev.stopImmediatePropagation();
  }, { capture: true });
  window.addEventListener('contextmenu', (ev) => {
    if (!rotate()) return;
    ev.preventDefault();
    ev.stopPropagation();
  }, { capture: true });
}
