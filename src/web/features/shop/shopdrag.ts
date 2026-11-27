/**
 * Buying by dragging a shop card into the skill list (mouse and pen; touch uses tap-to-select instead, see pick.ts).
 * - while the card is over the list, a gap opens at the cursor (a ghost row with the chain labels it would make;
 *   neighbours slide apart) and the floating card shows its price
 * - an upgrade card lights up the skill it levels instead (drop anywhere on the list)
 * - drop on the list = buy (ui.ts calls the same run.buy, then moves the new skill to the drop spot);
 *   drop anywhere else = cancel (the card flies back)
 */
import { L } from '../../../shared/i18n';
import { SKILLS, nodeOf } from '../../../sim/skills';
import { priceOf, upgradeOf, type RunState } from '../../../sim/run';
import { skillIcon } from '../../art/assets';
import { ghostLi, insertAtRow } from './chains';
import { COIN } from './hud';
import { esc } from '../../ui/html';

export interface ShopDragHooks {
  run(): RunState | null;
  /** why offer i can't be bought right now ('' = it can) */
  why(i: number): string;
  /** drop on the list: pos = list position for a new skill, null for an upgrade */
  onBuy(i: number, pos: number | null, from: DOMRect): void;
  /** a drag started (ui.ts clears the tap selection and tooltips) */
  onStart(): void;
}

/** true while a shop card is being dragged */
export let shopDragging = false;

const START_PX = 6;
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function initShopDrag(root: HTMLElement, hooks: ShopDragHooks) {
  root.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0 || ev.pointerType === 'touch') return;
    const t = ev.target as HTMLElement;
    const card = t.closest<HTMLElement>('.card.offer[data-tip^="s:"]');
    if (!card || t.closest('button, a, input, .kw, .pchip')) return;
    const i = Number(card.dataset.tip!.slice(2));
    if (hooks.why(i)) return;
    ev.preventDefault(); // no text selection
    start(ev, root, card, i, hooks);
  });
}

function start(ev: PointerEvent, root: HTMLElement, card: HTMLElement, i: number, hooks: ShopDragHooks) {
  const r = hooks.run();
  const o = r?.shop[i];
  if (!r || !o) return;
  const up = upgradeOf(r, o);
  const upIdx = up ? r.skills.indexOf(up) : -1;
  const price = priceOf(o);
  const pid = ev.pointerId;
  const x0 = ev.clientX;
  const y0 = ev.clientY;
  const src = card.getBoundingClientRect();
  let active = false;
  let float: HTMLElement | null = null;
  let gap: HTMLElement | null = null;
  let pos = -1;
  let overList = false;
  let raf = 0;
  let lx = x0;
  let ly = y0;
  const list = () => root.querySelector<HTMLElement>('.skilllist');
  const scroller = () => list()?.closest<HTMLElement>('.sv-sec') ?? null;

  const setGap = (p: number) => {
    const l = list();
    if (!l || p === pos) return;
    pos = p;
    if (gap) {
      const old = gap;
      old.classList.add('closing');
      old.dataset.pos = '';
      setTimeout(() => old.remove(), reduced() ? 0 : 120);
    }
    gap = p < 0 ? null : ghostLi(r, o, p, 'drag', price);
    if (gap) insertAtRow(l, gap, p);
  };
  /** list position under the pointer: how many rows' (live) midpoints are above it; the gap itself is skipped */
  const posAt = (y: number) => {
    const l = list();
    if (!l) return 0;
    let n = 0;
    l.querySelectorAll<HTMLElement>('.skillrow[data-i]').forEach((row) => {
      const b = row.getBoundingClientRect();
      if (b.top + b.height / 2 < y) n++;
    });
    return n;
  };
  const update = () => {
    raf = 0;
    if (!active || !float) return;
    float.style.transform = `translate(${lx - 70}px, ${ly - 26}px)`;
    const l = list();
    const sec = scroller();
    const lb = (sec ?? l)?.getBoundingClientRect();
    overList = !!lb && lx >= lb.left && lx <= lb.right && ly >= lb.top && ly <= lb.bottom;
    float.classList.toggle('over', overList);
    if (upIdx >= 0) {
      root.querySelector(`.skillrow[data-i="${upIdx}"]`)?.classList.toggle('drop-up', overList);
    } else if (overList) setGap(posAt(ly));
    else setGap(-1);
    // scroll the skills panel when you hold the card near its top / bottom edge
    if (overList && sec && sec.scrollHeight > sec.clientHeight && lb) {
      const v = ly < lb.top + 50 ? -9 : ly > lb.bottom - 50 ? 9 : 0;
      if (v) {
        sec.scrollBy(0, v);
        raf = requestAnimationFrame(update);
      }
    }
  };

  const move = (e: PointerEvent) => {
    if (e.pointerId !== pid) return;
    lx = e.clientX;
    ly = e.clientY;
    if (!active) {
      if (Math.hypot(lx - x0, ly - y0) < START_PX) return;
      active = true;
      shopDragging = true;
      hooks.onStart();
      document.body.classList.add('no-select', 'shop-dragging');
      card.classList.add('drag-src');
      list()?.classList.add('dragging');
      float = document.createElement('div');
      float.className = `drag-card${up ? ' up' : ''}`;
      float.setAttribute('aria-hidden', 'true');
      const name = esc(nodeOf({ id: o.id, v: o.v }).name);
      float.innerHTML =
        `<img src="${skillIcon(o.id)}" alt="" draggable="false"><span class="dc-t"><b>${name}</b><small>${
          up ? L(`▲ อัปเกรด ${esc(SKILLS[o.id].name)}`, `▲ Upgrade ${esc(SKILLS[o.id].name)}`) : L('ปล่อยในรายการเพื่อซื้อ', 'Drop in your list to buy')
        }</small></span><span class="dc-price">${COIN}${price}</span>`;
      document.body.appendChild(float);
      if (upIdx >= 0) root.querySelector(`.skillrow[data-i="${upIdx}"]`)?.classList.add('hl', 'up-pulse');
    }
    e.preventDefault();
    if (!raf) raf = requestAnimationFrame(update);
  };

  const cleanup = () => {
    shopDragging = false;
    document.body.classList.remove('no-select', 'shop-dragging');
    card.classList.remove('drag-src');
    list()?.classList.remove('dragging');
    root.querySelectorAll('.drop-up').forEach((el) => el.classList.remove('drop-up'));
  };

  const end = (e: PointerEvent) => {
    if (e.pointerId !== pid) return;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
    if (raf) cancelAnimationFrame(raf);
    if (!active) return;
    // swallow the click that follows a drag
    const stop = (c: Event) => {
      c.stopPropagation();
      c.preventDefault();
    };
    window.addEventListener('click', stop, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 50);
    const drop = e.type !== 'pointercancel' && overList;
    const dropPos = pos;
    const f = float;
    cleanup();
    if (drop && (upIdx >= 0 || dropPos >= 0)) {
      f?.remove();
      gap?.remove();
      hooks.onBuy(i, upIdx >= 0 ? null : dropPos, src);
      return;
    }
    // cancel: the gap closes, the card flies back to its place in the shop
    setGap(-1);
    if (!f) return;
    if (reduced()) return f.remove();
    const b = f.getBoundingClientRect();
    const a = f.animate(
      [
        { transform: `translate(${b.left}px, ${b.top}px)`, opacity: 1 },
        { transform: `translate(${src.left + src.width / 2 - 70}px, ${src.top + 20}px) scale(0.6)`, opacity: 0 },
      ],
      { duration: 220, easing: 'ease-in', fill: 'forwards' },
    );
    a.onfinish = () => f.remove();
    setTimeout(() => f.remove(), 400);
  };
  window.addEventListener('pointermove', move, { passive: false });
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
}
