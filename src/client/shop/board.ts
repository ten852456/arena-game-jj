/**
 * Build-grid interaction for the grid shop (GC1): drag, tap-to-place, rotate, hints. Mouse, pen and touch.
 *
 * - Drag a block from the grid or the bag. The cell you grabbed stays under your pointer (on touch the block floats
 *   a little above your finger so you can see it). Over the grid the ghost snaps to the cells and the cells turn
 *   green (fits) or red (does not), with "+N 🔗" when that spot switches bonuses on. Gold cells = best spots.
 *   Rotate while dragging: R, right-click, or tap with a second finger.
 * - Tap a block to pick it (placing mode). On touch the page cannot scroll while a block is picked, so the second tap
 *   always lands on the grid; a bottom bar shows "placing…", rotate, bag, sell and cancel. Tap a cell to put the
 *   block there (the best fitting spot that covers that cell). Two-finger tap on the grid rotates.
 * - Pressing / hovering a shop card lights the cells where that block would switch a bonus on.
 * Near the top or bottom edge a drag scrolls the page; the bottom zone stops above the sticky bar.
 */
import { L } from '../../i18n';
import { cellsOf, footprint, matches } from '../../sim/grid';
import * as R from '../../sim/run';
import type { Rot, SkillInstance } from '../../sim/types';
import { pieceHTML } from '../gridView';
import { bestSpot, offerPiece, rotsOf, scoreAt, spotsFor, withBlockAt, type Spot } from './placement';

export interface BoardCtx {
  run(): R.RunState | null;
  /** the shop view is on screen */
  active(): boolean;
  sel(): number | null;
  setSel(i: number | null): void;
  /** save + re-render */
  commit(): void;
  /** rotate the selected block (keeps the old ui rules); returns an error / note */
  rotateSel(): string | null;
  /** live timeline / bonus preview for a hypothetical layout (null = back to the real one) */
  preview(skills: SkillInstance[] | null): void;
  hideTip(): void;
  spin(el: Element | null): void;
}

interface Drag {
  i: number;
  /** grabbed cell (index into the shape's cells, stable under rotation) */
  c: number;
  pid: number;
  sx: number;
  sy: number;
  x: number;
  y: number;
  touch: boolean;
  moved: boolean;
  rot: Rot;
  ghost?: HTMLElement;
  /** current snapped spot over the grid */
  spot?: { x: number; y: number; ok: boolean; score: number | null } | null;
  raf: number;
}

const START_PX = 6;
const EDGE_PX = 70;

let ctx!: BoardCtx;
let drag: Drag | null = null;
/** the current pick came from a touch tap: lock page scroll while it lasts */
let touchPick = false;
let needScroll = false;
let locked = false;
/** touch pointers down on the board (for two-finger tap) */
const fingers = new Map<number, number>();
let multi = false;
/** shop card whose hints are showing (-1 = none), and whether it was pinned by a tap */
let offerHint = -1;
let offerPinned = false;

export const isDragging = () => !!drag?.moved;

// ---------- small helpers ----------
const gridEl = () => document.querySelector<HTMLElement>('.grid.live');
function cellPx() {
  const g = gridEl();
  const r = run();
  if (!g || !r) return 40;
  return g.getBoundingClientRect().width / R.gridOf(r).w;
}
const run = () => ctx.run();

/** Grid cell under a screen point (may be outside the grid). */
function cellAt(px: number, py: number): [number, number] | null {
  const g = gridEl();
  if (!g) return null;
  const b = g.getBoundingClientRect();
  const cs = cellPx();
  return [Math.floor((px - b.left) / cs), Math.floor((py - b.top) / cs)];
}

/** Floating message near the bottom of the screen (the panel toast can be far up the page on a phone). */
let flashTimer = 0;
export function flash(msg: string) {
  if (!msg) return;
  let el = document.getElementById('gs-flash');
  if (!el) {
    el = document.createElement('div');
    el.id = 'gs-flash';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(flashTimer);
  flashTimer = window.setTimeout(() => el!.classList.remove('on'), 2600);
}

function clearCells(...cls: string[]) {
  document.querySelectorAll(cls.map((c) => `.grid.live .gc.${c}`).join(',')).forEach((el) => el.classList.remove(...cls));
}
const cellEl = (x: number, y: number) => document.querySelector(`.grid.live [data-gx="${x}"][data-gy="${y}"]`);

/** Gold cells: every best-scoring spot (only when it switches something on). */
function paintSpots(spots: Spot[], shape: string, cls = 'hint') {
  clearCells(cls);
  const best = spots.reduce((m, s) => Math.max(m, s.score), 0);
  if (best <= 0) return 0;
  for (const s of spots) {
    if (s.score !== best) continue;
    for (const [x, y] of footprint({ shape, rot: s.rot, x: s.x, y: s.y })) cellEl(x, y)?.classList.add(cls);
  }
  return best;
}

/** Best spots for block i in rotation rot (painted gold); returns the best score in that rotation and overall. */
function hintsFor(i: number, rot: Rot) {
  const r = run();
  if (!r || !r.skills[i]) return { here: 0, any: 0, anyRot: rot };
  const { w, h } = R.gridOf(r);
  const all = spotsFor(r.skills, w, h, i, rotsOf(r.skills[i].shape));
  const cur = spotsFor(r.skills, w, h, i, [rot]);
  const here = paintSpots(cur, r.skills[i].shape);
  const top = bestSpot(all, rot);
  return { here, any: top?.score ?? 0, anyRot: top?.rot ?? rot };
}

// ---------- after every render ----------
/** Called by ui.ts after it re-renders the panel. */
export function afterRender() {
  const r = run();
  const sel = ctx.sel();
  // the panel DOM is new: card hints are gone
  offerHint = -1;
  offerPinned = false;
  if (!ctx.active() || !r || sel === null || !r.skills[sel]) {
    touchPick = false;
    setLock(false);
    return;
  }
  const k = r.skills[sel];
  const h = hintsFor(sel, k.rot);
  const note = document.getElementById('gs-hintnote');
  if (note) {
    note.innerHTML =
      h.here > 0
        ? L(`✨ ช่องสีทอง = ที่ที่ดีที่สุด (+${h.here} 🔗)`, `✨ Gold cells = best spots (+${h.here} 🔗)`) +
          (h.any > h.here ? L(` · หมุน ⟳ ได้ +${h.any}`, ` · rotate ⟳ for +${h.any}`) : '')
        : h.any > 0
          ? L(`หมุน ⟳ แล้วจะมีที่ที่ได้ +${h.any} 🔗`, `Rotate ⟳ to find a spot worth +${h.any} 🔗`)
          : L('ยังไม่มีที่ที่เปิดโบนัสได้ วางตรงไหนก็ได้', 'No spot switches a bonus on yet: place it anywhere');
  }
  setLock(touchPick);
  if (needScroll) {
    needScroll = false;
    keepGridInView();
  }
}

/** Scroll so the grid sits between the top and the sticky bar (once, when a pick starts on touch). */
function keepGridInView() {
  const g = gridEl();
  if (!g) return;
  const b = g.getBoundingClientRect();
  const bar = document.querySelector<HTMLElement>('.gs-bar');
  const bottom = bar ? bar.getBoundingClientRect().top : window.innerHeight;
  let dy = 0;
  if (b.bottom > bottom - 8) dy = b.bottom - (bottom - 8);
  if (b.top - dy < 8) dy = b.top - 8;
  if (Math.abs(dy) > 1) {
    const section = g.closest<HTMLElement>('.gs-build');
    if (section && section.scrollHeight > section.clientHeight) section.scrollBy({ top: dy, behavior: 'auto' });
    else window.scrollBy({ top: dy, behavior: 'auto' });
  }
}

function stopTouchScroll(e: TouchEvent) {
  // inside the placing bar small horizontal scrolls are fine; everything else stays put
  if (e.cancelable) e.preventDefault();
}
function setLock(on: boolean) {
  if (on === locked) return;
  locked = on;
  document.documentElement.classList.toggle('gs-lock', on);
  if (on) document.addEventListener('touchmove', stopTouchScroll, { passive: false });
  else document.removeEventListener('touchmove', stopTouchScroll);
}

// ---------- shop card hints ----------
function clearOfferHints() {
  offerHint = -1;
  clearCells('ohint');
  document.querySelectorAll('.grid.live .blk.gs-mate, .grid.live .blk.gs-up').forEach((el) => el.classList.remove('gs-mate', 'gs-up'));
  document.querySelectorAll('.gs-card.hinting').forEach((el) => el.classList.remove('hinting'));
}
/** Light up where shop offer i would switch a bonus on (gold cells) and the blocks it would link with. */
export function showOfferHints(i: number) {
  const r = run();
  if (i === offerHint) return;
  clearOfferHints();
  const o = r?.shop[i];
  if (!r || !o) return;
  offerHint = i;
  document.querySelector(`.gs-card[data-card="${i}"]`)?.classList.add('hinting');
  const blk = (j: number) => document.querySelector(`.grid.live [data-blk="${j}"]`);
  if (o.v !== '') {
    const up = R.upgradeOf(r, o);
    if (up) blk(r.skills.indexOf(up))?.classList.add('gs-up');
    return;
  }
  r.skills.forEach((k, j) => {
    if (k.x < 0) return;
    const mate = o.bonus.some((b) => matches(b.t, k)) || k.bonus.some((b) => matches(b.t, { id: o.id }));
    if (mate) blk(j)?.classList.add('gs-mate');
  });
  const { w, h } = R.gridOf(r);
  const skills = [...r.skills, offerPiece(o)];
  paintSpots(spotsFor(skills, w, h, skills.length - 1, rotsOf(o.shape)), o.shape, 'ohint');
}

// ---------- drag ----------
function ghostFor(d: Drag) {
  const r = run()!;
  const k = { ...r.skills[d.i], rot: d.rot };
  if (!d.ghost) {
    d.ghost = document.createElement('div');
    d.ghost.className = 'drag-ghost gs-ghost';
    document.body.appendChild(d.ghost);
  }
  d.ghost.style.setProperty('--c', `${cellPx()}px`);
  d.ghost.innerHTML = `${pieceHTML(k, { label: true })}<span class="gs-gbadge"></span>`;
}

/** The point that stands for the grabbed cell (on touch, lifted above the finger). */
function aim(d: Drag): [number, number] {
  return d.touch ? [d.x, d.y - cellPx() * 1.1] : [d.x, d.y];
}

function updateDrag() {
  const d = drag;
  const r = run();
  if (!d || !r || !d.ghost) return;
  const k = r.skills[d.i];
  const cs = cellPx();
  const [cx, cy] = cellsOf(k.shape, d.rot)[d.c] ?? [0, 0];
  const [px, py] = aim(d);
  const at = cellAt(px, py);
  const { w, h } = R.gridOf(r);
  clearCells('ok', 'bad');
  let spot: Drag['spot'] = null;
  if (at && at[0] >= 0 && at[1] >= 0 && at[0] < w && at[1] < h) {
    const x = at[0] - cx;
    const y = at[1] - cy;
    const score = scoreAt(r.skills, w, h, d.i, x, y, d.rot);
    spot = { x, y, ok: score !== null, score };
    for (const [fx, fy] of footprint({ shape: k.shape, rot: d.rot, x, y })) cellEl(fx, fy)?.classList.add(spot.ok ? 'ok' : 'bad');
    const b = gridEl()!.getBoundingClientRect();
    d.ghost.style.left = `${b.left + x * cs}px`;
    d.ghost.style.top = `${b.top + y * cs}px`;
  } else {
    d.ghost.style.left = `${px - (cx + 0.5) * cs}px`;
    d.ghost.style.top = `${py - (cy + 0.5) * cs}px`;
  }
  d.ghost.classList.toggle('snap', !!spot);
  d.ghost.classList.toggle('bad', !!spot && !spot.ok);
  const badge = d.ghost.querySelector('.gs-gbadge') as HTMLElement | null;
  if (badge) {
    badge.textContent = spot?.ok && spot.score ? `+${spot.score} 🔗` : spot && !spot.ok ? '✕' : '';
    badge.style.display = badge.textContent ? '' : 'none';
  }
  const prev = d.spot;
  d.spot = spot;
  const same = prev && spot && prev.x === spot.x && prev.y === spot.y && prev.ok === spot.ok;
  if (!same) ctx.preview(spot?.ok ? withBlockAt(r.skills, d.i, spot.x, spot.y, d.rot) : null);
}

function tick() {
  const d = drag;
  if (!d) return;
  d.raf = 0;
  if (!d.moved) return;
  // auto-scroll near the top / bottom edge; the bottom zone starts above the sticky bar
  const bar = document.querySelector<HTMLElement>('.gs-bar');
  const bottom = bar ? Math.min(window.innerHeight, bar.getBoundingClientRect().top) : window.innerHeight;
  let v = 0;
  if (d.y < EDGE_PX) v = -Math.ceil((EDGE_PX - d.y) / 6);
  else if (d.y > bottom - EDGE_PX / 2) v = Math.min(14, Math.ceil((d.y - (bottom - EDGE_PX / 2)) / 6));
  const section = gridEl()?.closest<HTMLElement>('.gs-build');
  if (section && section.scrollHeight > section.clientHeight) {
    const b = section.getBoundingClientRect();
    v = d.y < b.top + EDGE_PX ? -10 : d.y > b.bottom - EDGE_PX ? 10 : 0;
    const before = section.scrollTop;
    if (v) section.scrollBy(0, v);
    if (before === section.scrollTop) v = 0;
  } else {
    if ((v < 0 && window.scrollY <= 0) || (v > 0 && window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 1)) v = 0;
    if (v) window.scrollBy(0, v);
  }
  updateDrag();
  if (v) d.raf = requestAnimationFrame(tick);
}

function rotateDrag() {
  const d = drag;
  const r = run();
  if (!d || !r) return;
  d.rot = ((d.rot + 1) % 4) as Rot;
  ghostFor(d);
  ctx.spin(d.ghost!.querySelector('.blk'));
  hintsFor(d.i, d.rot);
  d.spot = undefined;
  updateDrag();
}

function startDrag(d: Drag) {
  d.moved = true;
  ctx.hideTip();
  clearOfferHints();
  ghostFor(d);
  document.querySelectorAll(`.grid.live [data-blk="${d.i}"], .gs-bag [data-blk="${d.i}"]`).forEach((el) => el.classList.add('gs-lifted'));
  document.body.classList.add('gs-dragging');
  hintsFor(d.i, d.rot);
}

function endDrag(ev: PointerEvent) {
  const d = drag;
  drag = null;
  const r = run();
  if (!d || !r) return;
  if (d.raf) cancelAnimationFrame(d.raf);
  d.ghost?.remove();
  document.body.classList.remove('gs-dragging');
  clearCells('ok', 'bad', 'hint');
  if (!d.moved) return;
  // swallow the click that follows a drag
  const stop = (c: Event) => {
    c.stopPropagation();
    c.preventDefault();
  };
  window.addEventListener('click', stop, { capture: true, once: true });
  setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 60);
  ctx.preview(null);
  if (ev.type === 'pointercancel') return ctx.commit();
  let msg = '';
  const zone = (document.elementFromPoint(d.x, d.y) as HTMLElement | null)?.closest<HTMLElement>('[data-drop]')?.dataset.drop;
  if (d.spot) {
    const err = R.place(r, d.i, d.spot.x, d.spot.y, d.rot);
    if (err) msg = `${err} · ${L('ช่องแดง = ทับบล็อกอื่นหรือออกนอกตาราง', 'red cells = on another block or off the grid')}`;
    else msg = d.spot.score ? L(`วางแล้ว · เปิดโบนัส +${d.spot.score} 🔗`, `Placed · +${d.spot.score} 🔗 bonus on`) : '';
    // a good drop ends the pick (the Fight bar comes back); a bad one keeps the block picked
    ctx.setSel(err ? d.i : null);
    if (!err) touchPick = false;
  } else if (zone === 'bag') {
    if (r.skills[d.i].x < 0) r.skills[d.i].rot = d.rot;
    else msg = R.unplace(r, d.i) ?? '';
    if (!msg) r.skills[d.i].rot = d.rot;
  } else if (zone === 'sell') {
    const gold = R.sellPrice(r.skills[d.i]);
    R.sell(r, d.i);
    ctx.setSel(null);
    msg = L(`ขายแล้ว +${gold}`, `Sold +${gold}`);
  }
  ctx.commit();
  flash(msg);
}

// ---------- pointer handlers ----------
function onDown(ev: PointerEvent) {
  if (!ctx.active() || !run()) return;
  const t = ev.target as Element;
  const onBoard = !!t.closest?.('.gs-board, .gs-bag');
  if (ev.pointerType === 'touch' && onBoard) {
    fingers.set(ev.pointerId, Date.now());
    if (fingers.size >= 2) {
      // second finger: rotate the block in hand / the picked block
      multi = true;
      ev.preventDefault();
      if (drag?.moved) rotateDrag();
      else if (ctx.sel() !== null) {
        drag = null;
        const msg = ctx.rotateSel();
        ctx.commit();
        flash(msg ?? '');
      }
      return;
    }
  }
  // shop card hints (touch: press a card; it stays lit until you tap elsewhere)
  const card = t.closest?.('.gs-card[data-card]') as HTMLElement | null;
  if (ev.pointerType !== 'mouse') {
    if (card && !t.closest('button')) {
      const n = Number(card.dataset.card);
      if (offerPinned && offerHint === n) {
        offerPinned = false;
        clearOfferHints();
      } else {
        showOfferHints(n);
        offerPinned = true;
      }
    } else if (!t.closest('.gs-board') && offerPinned) {
      offerPinned = false;
      clearOfferHints();
    }
  }
  if (ev.button === 2) return;
  const blk = t.closest?.('[data-blk]') as HTMLElement | SVGElement | null;
  if (blk && t.closest('.gs-board, .gs-bag, .gs-bar')) {
    const i = Number(blk.dataset.blk);
    const r = run()!;
    if (!r.skills[i]) return;
    drag = {
      i, c: Number((t.closest('[data-c]') as SVGElement | null)?.dataset.c ?? 0), pid: ev.pointerId,
      sx: ev.clientX, sy: ev.clientY, x: ev.clientX, y: ev.clientY, touch: ev.pointerType !== 'mouse',
      moved: false, rot: r.skills[i].rot, raf: 0,
    };
    return;
  }
}

function onMove(ev: PointerEvent) {
  const d = drag;
  if (!d || ev.pointerId !== d.pid) return;
  d.x = ev.clientX;
  d.y = ev.clientY;
  if (!d.moved) {
    if (Math.hypot(d.x - d.sx, d.y - d.sy) < START_PX || multi) return;
    startDrag(d);
  }
  if (ev.cancelable) ev.preventDefault();
  if (!d.raf) d.raf = requestAnimationFrame(tick);
}

function onUp(ev: PointerEvent) {
  if (ev.pointerType === 'touch') fingers.delete(ev.pointerId);
  const wasMulti = multi;
  if (!fingers.size) multi = false;
  const d = drag;
  if (d && ev.pointerId === d.pid) {
    if (d.moved) return endDrag(ev);
    drag = null;
    if (wasMulti || ev.type === 'pointercancel') return;
    // a tap on a block: pick it / drop the pick
    const r = run()!;
    const was = ctx.sel();
    ctx.setSel(was === d.i ? null : d.i);
    touchPick = d.touch && was !== d.i;
    needScroll = touchPick && !!r.skills[d.i];
    ctx.commit();
    return;
  }
  if (wasMulti || ev.type === 'pointercancel' || !ctx.active()) return;
  // a tap on a grid cell while a block is picked: put it there
  const sel = ctx.sel();
  const cell = (ev.target as Element).closest?.('.grid.live [data-gx]') as HTMLElement | null;
  if (cell && sel !== null) tapPlace(sel, Number(cell.dataset.gx), Number(cell.dataset.gy), ev.pointerType !== 'mouse');
}

/**
 * Put block i so it covers cell (gx, gy): of the spots that fit, the one with most bonuses. The current rotation is
 * tried first; if it fits nowhere there, the other rotations are tried (and the player is told it turned).
 */
function tapPlace(i: number, gx: number, gy: number, touch: boolean) {
  const r = run()!;
  const k = r.skills[i];
  const { w, h } = R.gridOf(r);
  const order = [k.rot, ...rotsOf(k.shape).filter((x) => x !== k.rot)];
  let best: { x: number; y: number; rot: Rot; score: number } | null = null;
  for (const rot of order) {
    for (const [cx, cy] of cellsOf(k.shape, rot)) {
      const x = gx - cx;
      const y = gy - cy;
      const score = scoreAt(r.skills, w, h, i, x, y, rot);
      if (score !== null && (!best || score > best.score)) best = { x, y, rot, score };
    }
    if (best) break;
  }
  if (!best) {
    flash(L('วางตรงนี้ไม่ได้ (ที่ว่างไม่พอ) · ลองช่องอื่น', 'It does not fit here (not enough room) · try another cell'));
    return;
  }
  const turned = best.rot !== k.rot;
  R.place(r, i, best.x, best.y, best.rot);
  ctx.setSel(null);
  if (touch) touchPick = false;
  ctx.commit();
  if (turned) ctx.spin(document.querySelector(`.grid.live [data-blk="${i}"]`));
  const done = best.score ? L(`วางแล้ว · เปิดโบนัส +${best.score} 🔗`, `Placed · +${best.score} 🔗 bonus on`) : L('วางแล้ว', 'Placed');
  flash(turned ? `${done} · ${L('หมุนให้แล้วเพื่อให้ลงพอดี', 'turned to fit')}` : done);
}

function onHoverCard(ev: PointerEvent) {
  if (ev.pointerType !== 'mouse' || drag?.moved || !ctx.active() || offerPinned) return;
  const card = (ev.target as Element).closest?.('.gs-card[data-card]') as HTMLElement | null;
  if (card) showOfferHints(Number(card.dataset.card));
  else if (offerHint >= 0) clearOfferHints();
}

function onKey(ev: KeyboardEvent) {
  if (!ctx.active() || (ev.target as HTMLElement).tagName === 'INPUT') return;
  if (ev.key === 'Escape' && ctx.sel() !== null && !document.querySelector('.modal')) {
    ctx.setSel(null);
    ctx.commit();
    return;
  }
  if (ev.key !== 'r' && ev.key !== 'R') return;
  if (drag?.moved) return rotateDrag();
  const msg = ctx.rotateSel();
  ctx.commit();
  flash(msg ?? '');
}

function onContext(ev: MouseEvent) {
  if (!ctx.active() || !run()) return;
  if (drag?.moved) {
    ev.preventDefault();
    rotateDrag();
    return;
  }
  const el = (ev.target as Element).closest?.('.gs-board [data-blk], .gs-bag [data-blk]') as HTMLElement | SVGElement | null;
  if (!el) return;
  ev.preventDefault();
  const prev = ctx.sel();
  ctx.setSel(Number(el.dataset.blk));
  const msg = ctx.rotateSel();
  if (prev !== ctx.sel() && msg) ctx.setSel(prev);
  ctx.hideTip();
  ctx.commit();
  flash(msg ?? '');
}

export function initBoard(root: HTMLElement, c: BoardCtx) {
  ctx = c;
  root.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove, { passive: false });
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  window.addEventListener('pointermove', onHoverCard);
  window.addEventListener('keydown', onKey);
  root.addEventListener('contextmenu', onContext);
}

