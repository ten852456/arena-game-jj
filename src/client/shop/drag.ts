/**
 * Drag-and-drop reordering of the shop's skill list (mouse, pen and touch via pointer events).
 * Touch: drag by the ⠿ grip (touch-action: none there, so the page doesn't scroll while you drag; the rest of the
 * row still scrolls normally). Mouse: drag the grip or anywhere on the row that isn't a button.
 * The list is plain HTML re-rendered by ui.ts, so this works on the live DOM and reports back:
 * onPreview(order) while the drop spot changes (for the live timeline), onDrop(from, to) once.
 */

export interface DragHooks {
  onPreview(order: number[]): void;
  onDrop(from: number, to: number): void;
  /** dropped on the coin jar (.sell-jar): sell skill `from` */
  onSell?(from: number): void;
}

/** true while a drag is in progress (ui.ts hides tooltips then) */
export let dragging = false;

const START_PX = 5;
const EDGE_PX = 70;

export function initDrag(root: HTMLElement, hooks: DragHooks) {
  root.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    const target = ev.target as HTMLElement;
    const grip = target.closest<HTMLElement>('[data-drag]');
    const row = target.closest<HTMLElement>('.skillrow[data-i]');
    if (!row) return;
    if (!grip && (ev.pointerType !== 'mouse' || target.closest('button, a, input, .kw, .bchip'))) return;
    const list = row.closest<HTMLElement>('.skilllist');
    if (!list) return;
    // no text selection (mouse drag from anywhere on the row) / scroll start (touch from the grip)
    if (grip || ev.pointerType === 'mouse') ev.preventDefault();
    start(ev, row, list, hooks);
  });
}

function start(ev: PointerEvent, row: HTMLElement, list: HTMLElement, hooks: DragHooks) {
  const rows = [...list.querySelectorAll<HTMLElement>('.skillrow[data-i]')];
  const from = rows.indexOf(row);
  if (from < 0) return;
  const pid = ev.pointerId;
  const y0 = ev.clientY;
  const scroll0 = window.scrollY;
  const scroller = row.closest<HTMLElement>('.sv-sec');
  const innerScroll0 = scroller?.scrollTop ?? 0;
  // row midpoints in page coordinates (stable while the page scrolls)
  const mids = rows.map((r) => {
    const b = r.getBoundingClientRect();
    return b.top + window.scrollY + b.height / 2;
  });
  let active = false;
  let to = from;
  let lastY = ev.clientY;
  let lastX = ev.clientX;
  let raf = 0;
  let overSell = false;
  let outside = false;
  let float: HTMLElement | null = null;
  const sellN = row.dataset.sell ?? '';
  let line: HTMLElement | null = null;

  const placeLine = () => {
    if (!line) return;
    const lr = list.getBoundingClientRect();
    // moving up: the gap above row `to`; moving down: the gap below it
    const rb = rows[to].getBoundingClientRect();
    const y = to <= from ? rb.top - lr.top - 4 : rb.bottom - lr.top + 1;
    line.style.top = `${y}px`;
    line.classList.toggle('same', to === from);
  };
  const update = () => {
    const pageY = lastY + window.scrollY;
    const innerDelta = (scroller?.scrollTop ?? 0) - innerScroll0;
    const dy = lastY - y0 + (window.scrollY - scroll0) + innerDelta;
    row.style.transform = `translateY(${dy}px)`;
    // the drop index = how many other rows' midpoints the dragged row's centre has passed
    const centre = mids[from] + (pageY - (y0 + scroll0)) + innerDelta;
    let n = 0;
    mids.forEach((m, i) => {
      if (i !== from && centre > m) n++;
    });
    if (n !== to) {
      to = n;
      const order = rows.map((_, i) => i).filter((i) => i !== from);
      order.splice(to, 0, from);
      hooks.onPreview(order);
      rows.forEach((r, i) => r.classList.toggle('drop-near', i === to && i !== from));
    }
    placeLine();
    // the coin jar: drop here to sell. Outside the skills panel a small chip follows the pointer (the row itself
    // can't leave its scrolling panel)
    const jar = document.querySelector<HTMLElement>('.sell-jar');
    const jb = jar?.getBoundingClientRect();
    overSell = !!jb && jb.width > 0 && lastX >= jb.left - 8 && lastX <= jb.right + 8 && lastY >= jb.top - 8 && lastY <= jb.bottom + 8;
    jar?.classList.toggle('over', overSell);
    row.classList.toggle('to-sell', overSell);
    const sb = (scroller ?? list).getBoundingClientRect();
    outside = lastX < sb.left || lastX > sb.right || lastY < sb.top || lastY > sb.bottom;
    if (outside && !float) {
      float = document.createElement('div');
      float.className = 'sell-float';
      float.setAttribute('aria-hidden', 'true');
      const ic = row.querySelector<HTMLImageElement>('.skill-icon');
      if (ic) float.appendChild(ic.cloneNode());
      const b = document.createElement('b');
      float.appendChild(b);
      document.body.appendChild(float);
    }
    if (float) {
      float.style.display = outside ? '' : 'none';
      float.style.transform = `translate(${lastX - 24}px, ${lastY - 24}px)`;
      float.classList.toggle('over', overSell);
      float.querySelector('b')!.textContent = overSell ? `+${sellN}` : '';
    }
  };
  const tick = () => {
    raf = 0;
    if (!active) return;
    // auto-scroll near the top / bottom edge of the screen
    // the bottom zone starts above the sticky Fight bar, so dropping onto the last rows does not scroll the page away
    const bar = document.querySelector<HTMLElement>('.sv-fight');
    const bottom = bar ? Math.min(window.innerHeight, bar.getBoundingClientRect().top) : window.innerHeight;
    let v = 0;
    if (lastY < EDGE_PX) v = -Math.ceil((EDGE_PX - lastY) / 6);
    else if (lastY > bottom - EDGE_PX / 2) v = Math.min(14, Math.ceil((lastY - (bottom - EDGE_PX / 2)) / 6));
    // stop at the ends of the page
    if (scroller && scroller.scrollHeight > scroller.clientHeight) {
      const bounds = scroller.getBoundingClientRect();
      v = lastY < bounds.top + EDGE_PX ? -10 : lastY > bounds.bottom - EDGE_PX ? 10 : 0;
      const before = scroller.scrollTop;
      if (v) scroller.scrollBy(0, v);
      if (scroller.scrollTop === before) v = 0;
    } else {
      if ((v < 0 && window.scrollY <= 0) || (v > 0 && window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 1)) v = 0;
      if (v) window.scrollBy(0, v);
    }
    update();
    if (v) raf = requestAnimationFrame(tick);
  };
  const move = (e: PointerEvent) => {
    if (e.pointerId !== pid) return;
    lastY = e.clientY;
    lastX = e.clientX;
    if (!active) {
      if (Math.abs(e.clientY - y0) < START_PX) return;
      active = true;
      dragging = true;
      row.classList.add('lifted');
      list.classList.add('dragging');
      document.body.classList.add('no-select', 'skill-dragging');
      const amt = document.querySelector('.sell-jar .jar-amt');
      if (amt) amt.textContent = `+${sellN}`;
      line = document.createElement('div');
      line.className = 'drop-line';
      line.setAttribute('aria-hidden', 'true');
      list.appendChild(line);
      try {
        row.setPointerCapture(pid);
      } catch {
        /* pointer already gone */
      }
    }
    e.preventDefault();
    if (!raf) raf = requestAnimationFrame(tick);
  };
  const end = (e: PointerEvent) => {
    if (e.pointerId !== pid) return;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
    if (raf) cancelAnimationFrame(raf);
    if (!active) return;
    active = false;
    dragging = false;
    document.body.classList.remove('no-select', 'skill-dragging');
    float?.remove();
    document.querySelector('.sell-jar')?.classList.remove('over');
    // swallow the click that follows a drag
    const stop = (c: Event) => {
      c.stopPropagation();
      c.preventDefault();
    };
    window.addEventListener('click', stop, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 50);
    if (e.type !== 'pointercancel' && overSell && hooks.onSell) {
      line?.remove();
      hooks.onSell(from);
      return;
    }
    if (e.type === 'pointercancel' || to === from || outside) {
      row.style.transform = '';
      row.classList.remove('lifted', 'to-sell');
      list.classList.remove('dragging');
      rows.forEach((r) => r.classList.remove('drop-near'));
      line?.remove();
      hooks.onPreview(rows.map((_, i) => i));
      rows.forEach((r) => r.classList.remove('synergy-preview'));
      return;
    }
    hooks.onDrop(from, to);
  };
  window.addEventListener('pointermove', move, { passive: false });
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
}
