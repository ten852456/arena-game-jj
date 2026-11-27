/**
 * Tap-to-place (touch first, works with a mouse too): tap a shop card to select it. The list then shows the ghost
 * at the Buy-button spot plus "+" insert targets (44px+) between the rows; tapping one buys the skill into that spot.
 * An upgrade card shows one target under the skill it levels. The targets carry data-a="buyAt", so ui.ts handles
 * the tap like any other button (same run.buy, then a move). DOM-only: nothing re-renders until you buy.
 */
import { L } from '../../../shared/i18n';
import { SKILLS } from '../../../sim/skills';
import { priceOf, upgradeOf, type RunState } from '../../../sim/run';
import { defaultSlot, ghostLi, insertAtRow } from './chains';
import { coinHTML } from './hud';

/** selected shop card (-1 = none) */
export let picked = -1;

export function clearPick(root: HTMLElement) {
  picked = -1;
  root.querySelectorAll('.ins-slot, .put-here.mode-pick, .pick-note, .pick-go').forEach((el) => el.remove());
  root.querySelectorAll('.card.offer.picked').forEach((el) => el.classList.remove('picked'));
  root.querySelector('.skilllist')?.classList.remove('picking');
}

/** Select shop card i (why = reason it can't be bought now, '' if it can). */
export function setPick(root: HTMLElement, r: RunState, i: number, why: string) {
  clearPick(root);
  const o = r.shop[i];
  const list = root.querySelector<HTMLElement>('.skilllist');
  if (!o || !list) return;
  picked = i;
  root.querySelector(`.card.offer[data-tip="s:${i}"]`)?.classList.add('picked');
  root.querySelectorAll('.put-here.mode-hover').forEach((el) => el.remove());
  if (why) {
    const n = document.createElement('li');
    n.className = 'pick-note';
    n.textContent = `${SKILLS[o.id].name}: ${why}`;
    list.prepend(n);
    return;
  }
  list.classList.add('picking');
  // upright phones: the list is below the shop; this button scrolls to the targets (hidden by CSS elsewhere)
  const go = document.createElement('button');
  go.className = 'pick-go';
  go.dataset.a = 'pickGo';
  go.textContent = L('↓ ไปแตะ + ในรายการ skill', '↓ Go tap + in your skill list');
  root.querySelector('.shopv')?.appendChild(go);
  const price = priceOf(o);
  const up = upgradeOf(r, o);
  if (up) {
    const idx = r.skills.indexOf(up);
    const li = document.createElement('li');
    li.className = 'ins-slot up';
    li.innerHTML = `<button data-a="buyAt" data-i="${i}" data-pos="-1">▲ ${L(`แตะเพื่ออัปเกรด ${SKILLS[o.id].name}`, `Tap to upgrade ${SKILLS[o.id].name}`)} ${coinHTML(price)}</button>`;
    list.querySelector(`.skillrow[data-i="${idx}"]`)?.after(li);
    return;
  }
  const def = defaultSlot(r, o);
  for (let p = 0; p <= r.skills.length; p++) {
    if (p === def) {
      const g = ghostLi(r, o, p, 'pick', price);
      g.dataset.a = 'buyAt';
      g.dataset.i = String(i);
      g.setAttribute('role', 'button');
      g.tabIndex = 0;
      insertAtRow(list, g, p);
      continue;
    }
    const li = document.createElement('li');
    li.className = 'ins-slot';
    li.innerHTML = `<button data-a="buyAt" data-i="${i}" data-pos="${p}" aria-label="${L(`วาง ${SKILLS[o.id].name} ช่องที่ ${p + 1}`, `Put ${SKILLS[o.id].name} in slot ${p + 1}`)}"><b>+</b> ${L('วางที่นี่', 'Put here')}</button>`;
    insertAtRow(list, li, p);
  }
}

/** Scroll the first insert target (or the upgrade target) into view and drop the floating button. */
export function goToPick(root: HTMLElement) {
  root.querySelector('.pick-go')?.remove();
  const t = root.querySelector<HTMLElement>('.put-here.mode-pick, .ins-slot');
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  t?.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
}
