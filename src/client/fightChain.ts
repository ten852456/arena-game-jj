/**
 * "CHAIN ×N" popup over a fighter when a chain fires in a fight (a block set off by a touching block: ⚡ trigger
 * bonus or an engine block ⚙ / 🚀). Grid version: N = the chain step the sim reports on the cast (`chain` + 1).
 * DOM overlay on top of the Phaser canvas: pictures of both skills, gold for you, pink for the enemy.
 * combatScene calls chainPopup with the fighter's position as a fraction of the canvas.
 * A chain that keeps going re-uses the popup that is still up: the count goes up (×2, ×3 … capped look at ×5),
 * the popup grows 15% per step, gets hotter (gold → pink-gold glow) and pops again, so a long chain reads as one
 * escalating combo instead of a stack of popups.
 */
import { L } from '../i18n';
import { skillIcon } from './assets';
import './fightChain.css';

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const live: ({ el: HTMLDivElement; until: number; timer: number } | null)[] = [null, null];
const HOT = ['', '#ffd36b', '#ffc06b', '#ffa98a', '#ff8fb8'];

/**
 * fx, fy: where to show it, as a fraction of the canvas (0..1). ms: how long, already scaled by the fight speed.
 * n: chain step (2 = first chained fire).
 */
export function chainPopup(side: 0 | 1, fromId: string, toId: string, fx: number, fy: number, ms = 1000, n = 2) {
  const canvas = document.querySelector<HTMLCanvasElement>('#stage canvas');
  if (!canvas) return;
  const r = canvas.getBoundingClientRect();
  if (!r.width || r.bottom < 0 || r.top > window.innerHeight) return;
  const now = performance.now();
  const step = Math.max(0, Math.min(3, n - 2));
  const dur = Math.max(450, ms);
  let cur = live[side];
  if (cur && now > cur.until) cur = null;
  const el = cur?.el ?? document.createElement('div');
  el.className = `chain-pop s${side}${reduced() ? ' still' : ''}`;
  el.setAttribute('aria-hidden', 'true');
  el.style.left = `${r.left + r.width * fx}px`;
  el.style.top = `${r.top + r.height * fy}px`;
  el.style.setProperty('--dur', `${dur}ms`);
  // icon size follows the canvas size (small arena on phones), +15% per chain step
  el.style.setProperty('--s', `${(Math.max(0.7, Math.min(1.25, r.width / 640)) * (1 + 0.15 * step)).toFixed(3)}`);
  const hot = HOT[step + 1];
  const tStyle = step > 0 ? ` style="color:${hot};text-shadow:0 0 ${10 + step * 5}px rgba(255,${150 - step * 25},${120 + step * 15},0.95)"` : '';
  el.innerHTML =
    `<b class="cpop-t"${tStyle}>${L('ต่อ!', 'CHAIN')} ×${n}</b>` +
    `<span class="cpop-row"><img src="${skillIcon(fromId)}" alt=""><i>⚡</i><img src="${skillIcon(toId)}" alt=""></span>`;
  if (cur) {
    // restart the pop animation on the same element
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
    clearTimeout(cur.timer);
  } else document.body.appendChild(el);
  const entry = { el, until: now + dur * 0.8, timer: 0 };
  entry.timer = window.setTimeout(() => {
    el.remove();
    if (live[side] === entry) live[side] = null;
  }, dur + 80);
  live[side] = entry;
}
