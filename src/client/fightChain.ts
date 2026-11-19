/**
 * "Chain!" popup over a fighter when a chain fires in a fight (a cast set off by a neighbour: ⚡ trigger bonus
 * or an engine skill). DOM overlay on top of the Phaser canvas: pictures of both skills, gold for you, pink for
 * the enemy. combatScene calls chainPopup with the fighter's position as a fraction of the canvas.
 */
import { L } from '../i18n';
import { skillIcon } from './assets';

const last = [0, 0];
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** fx, fy: where to show it, as a fraction of the canvas (0..1). ms: how long, already scaled by the fight speed. */
export function chainPopup(side: 0 | 1, fromId: string, toId: string, fx: number, fy: number, ms = 1000) {
  const now = performance.now();
  if (now - last[side] < Math.min(380, ms * 0.45)) return; // fast forward: don't stack a pile of popups
  last[side] = now;
  const canvas = document.querySelector<HTMLCanvasElement>('#stage canvas');
  if (!canvas) return;
  const r = canvas.getBoundingClientRect();
  if (!r.width || r.bottom < 0 || r.top > window.innerHeight) return;
  const el = document.createElement('div');
  el.className = `chain-pop s${side}${reduced() ? ' still' : ''}`;
  el.setAttribute('aria-hidden', 'true');
  el.style.left = `${r.left + r.width * fx}px`;
  el.style.top = `${r.top + r.height * fy}px`;
  el.style.setProperty('--dur', `${Math.max(450, ms)}ms`);
  // icon size follows the canvas size (small arena on phones)
  el.style.setProperty('--s', `${Math.max(0.7, Math.min(1.25, r.width / 640))}`);
  el.innerHTML = `<b class="cpop-t">${L('ต่อ! Chain', 'Chain!')}</b><span class="cpop-row"><img src="${skillIcon(fromId)}" alt=""><i>⚡</i><img src="${skillIcon(toId)}" alt=""></span>`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), Math.max(450, ms) + 80);
}
