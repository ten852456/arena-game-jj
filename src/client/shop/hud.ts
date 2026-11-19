/**
 * Shop HUD: the chunky HP / Day / Wins band, the coin pill on the shop panel, coin prices, and the little
 * animations when they change (HP loss flash + shake, a star flying into its slot, the gold number rolling,
 * coins flying between the pill and a card, a starburst on an upgrade).
 * Pure HTML strings plus small DOM touches after ui.ts renders the shop; nothing here changes the run.
 */
import { L } from '../../i18n';
import { START_HP, WIN_TARGET, type RunState } from '../../sim/run';

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** coin picture (CSS) */
export const COIN = '<i class="coin-ico" aria-hidden="true"></i>';
/** a price: coin + number in the gold colour (red when you can't afford it) */
export const coinHTML = (n: number, bad = false) => `<span class="coin${bad ? ' bad' : ''}">${COIN}<b>${n}</b></span>`;

const HEART =
  '<svg class="hud-heart" viewBox="0 0 24 22" aria-hidden="true"><path d="M12 21.2 10.3 19.7C4.4 14.4.5 10.9.5 6.6.5 3.1 3.2.5 6.6.5c1.9 0 3.8.9 5.4 2.6C13.6 1.4 15.5.5 17.4.5c3.4 0 6.1 2.6 6.1 6.1 0 4.3-3.9 7.8-9.8 13.1z"/></svg>';
const STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 1.8 3.1 6.6 7.2.9-5.3 5 1.4 7.1L12 17.9l-6.4 3.5L7 14.3l-5.3-5 7.2-.9z"/></svg>';

/** Moon that fills as the run goes on: a thin crescent on day 1, full by day 14. */
export function moonSvg(day: number) {
  const p = Math.max(0.08, Math.min(1, day / 14));
  // a dark disc slides off the lit moon: p = 0 covers it, p = 1 is a full moon
  const dx = (p * 2.15 * 11).toFixed(2);
  const id = `mclip${day}`;
  return `<svg class="hud-moon" viewBox="0 0 26 26" aria-hidden="true"><defs><clipPath id="${id}"><circle cx="13" cy="13" r="11"/></clipPath></defs>
    <circle cx="13" cy="13" r="11" class="mo-lit"/><circle cx="8.5" cy="9" r="2" class="mo-crater"/><circle cx="16" cy="16.5" r="1.6" class="mo-crater"/>
    <circle cx="${(13 - Number(dx)).toFixed(2)}" cy="13" r="11.4" class="mo-dark" clip-path="url(#${id})"/>
    <circle cx="13" cy="13" r="11" class="mo-rim"/></svg>`;
}

/** The top band: HP, Day, Wins (+ rating, streak). `extra` goes on the right (give-up button). */
export function hudHTML(r: RunState, streak: string, extra: string) {
  const pct = Math.max(0, Math.min(100, (r.hp / START_HP) * 100));
  const low = r.hp <= START_HP * 0.3;
  const stars = Array.from({ length: WIN_TARGET }, (_, i) => `<i class="hud-star${i < r.wins ? ' on' : ''}" data-star="${i}">${STAR}</i>`).join('');
  return `<div class="sv-top hud" role="group" aria-label="${L('สถานะรอบนี้', 'This run')}">
    <div class="hud-chip hud-hp${low ? ' low' : ''}${r.ghost ? ' ghost' : ''}" data-hud="hp" aria-label="${L('เลือด', 'HP')} ${r.hp}/${START_HP}">
      ${HEART}<span class="hud-body"><span class="hud-line"><span class="hud-k">${L('เลือด', 'HP')}</span><b class="hud-n">${r.hp}</b><small class="hud-of">/${START_HP}</small>${
        r.ghost ? `<span class="hud-tag">${L('กึ่งวิญญาณ', 'half-spirit')}</span>` : ''
      }</span><i class="hud-bar"><i style="width:${pct}%"></i></i></span>
    </div>
    <div class="hud-chip hud-day" data-hud="day" aria-label="${L('วันที่', 'Day')} ${r.day}">${moonSvg(r.day)}<span class="hud-k">${L('วันที่', 'Day')}</span><b class="hud-n">${r.day}</b></div>
    <div class="hud-chip hud-wins" data-hud="wins" aria-label="${L(`ชนะ ${r.wins} จาก ${WIN_TARGET}`, `${r.wins} of ${WIN_TARGET} wins`)}">
      <span class="hud-stars">${stars}</span><b class="hud-n">${r.wins}</b><small class="hud-of">/${WIN_TARGET}</small></div>
    <span class="pill hud-rate"><small>${L('คะแนน', 'Rating')}</small> <b>${r.rating}</b></span>
    ${streak ? `<span class="pill streak">${streak}</span>` : ''}
    <span class="stats-right">${extra}</span>
  </div>`;
}

/** Coin pill at the top-left of the shop panel. */
export const goldPillHTML = (gold: number) =>
  `<span class="gold-pill" data-hud="gold" aria-label="${L('เงิน', 'Gold')} ${gold}" title="${L('เงินของคุณ', 'Your gold')}">${COIN}<b class="gold-n">${gold}</b></span>`;

// ---------- change animations ----------
interface Seen {
  id: string;
  hp: number;
  day: number;
  wins: number;
  gold: number;
}
let seen: Seen | null = null;
export const resetHud = () => {
  seen = null;
};

function replay(el: Element | null, cls: string, ms = 700) {
  if (!el) return;
  el.classList.remove(cls);
  void (el as HTMLElement).offsetWidth;
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), ms);
}

/** Count a number from `from` to `to` (0.4s) and give its pill a springy bump. */
export function rollNumber(el: HTMLElement | null, from: number, to: number) {
  if (!el) return;
  el.textContent = String(to);
  if (from === to || reduced()) return;
  replay(el.closest('.gold-pill, .pill, .hud-chip'), 'bump', 450);
  const t0 = performance.now();
  const step = (t: number) => {
    const k = Math.min(1, (t - t0) / 400);
    el.textContent = String(Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3))));
    if (k < 1) requestAnimationFrame(step);
  };
  el.textContent = String(from);
  requestAnimationFrame(step);
}

/** Floating "-3 ♥" / "+2" text over an element. */
function floatText(host: Element | null, text: string, cls: string) {
  if (!host || reduced()) return;
  const f = document.createElement('span');
  f.className = `hud-float ${cls}`;
  f.textContent = text;
  host.appendChild(f);
  setTimeout(() => f.remove(), 1300);
}

/** After each shop render: animate what changed since the last one (first render of a run only records). */
export function hudAfterRender(root: HTMLElement, r: RunState) {
  const now: Seen = { id: r.id, hp: r.hp, day: r.day, wins: r.wins, gold: r.gold };
  const before = seen && seen.id === r.id ? seen : null;
  seen = now;
  if (!before) return;
  const chip = (k: string) => root.querySelector<HTMLElement>(`[data-hud="${k}"]`);
  if (now.hp < before.hp) {
    const hp = chip('hp');
    replay(hp, 'hit', 900);
    floatText(hp, `-${before.hp - now.hp} ♥`, 'neg');
    const bar = hp?.querySelector<HTMLElement>('.hud-bar > i');
    if (bar && !reduced()) {
      const to = bar.style.width;
      bar.style.transition = 'none';
      bar.style.width = `${Math.max(0, Math.min(100, (before.hp / START_HP) * 100))}%`;
      void bar.offsetWidth;
      bar.style.transition = '';
      setTimeout(() => (bar.style.width = to), 180);
    }
    rollNumber(hp?.querySelector('.hud-n') ?? null, before.hp, now.hp);
  } else if (now.hp > before.hp) {
    replay(chip('hp'), 'bump', 450);
  }
  if (now.wins > before.wins) {
    replay(chip('wins'), 'bump', 450);
    for (let i = before.wins; i < now.wins; i++) replay(root.querySelector(`[data-star="${i}"]`), 'fly', 1100);
  }
  if (now.day !== before.day) replay(chip('day'), 'bump', 450);
  if (now.gold !== before.gold) {
    root.querySelectorAll<HTMLElement>('.gold-n').forEach((el) => rollNumber(el, before.gold, now.gold));
    floatText(root.querySelector('.gold-pill'), `${now.gold > before.gold ? '+' : '-'}${Math.abs(now.gold - before.gold)}`, now.gold > before.gold ? 'pos' : 'neg');
  }
}

/** Coins fly from one box to another (250ms each, a few staggered). */
export function coinFly(from: DOMRect | null, to: DOMRect | null, n = 3) {
  if (!from || !to || reduced()) return;
  for (let k = 0; k < n; k++) {
    const c = document.createElement('i');
    c.className = 'coin-ico coin-fly';
    const x0 = from.left + from.width / 2 - 11;
    const y0 = from.top + from.height / 2 - 11;
    const x1 = to.left + to.width / 2 - 11 + (k - (n - 1) / 2) * 10;
    const y1 = to.top + to.height / 2 - 11;
    c.style.left = `${x0}px`;
    c.style.top = `${y0}px`;
    document.body.appendChild(c);
    const a = c.animate(
      [
        { transform: 'translate(0,0) scale(1)', opacity: 1 },
        { transform: `translate(${(x1 - x0) / 2}px, ${(y1 - y0) / 2 - 40}px) scale(1.25)`, opacity: 1, offset: 0.5 },
        { transform: `translate(${x1 - x0}px, ${y1 - y0}px) scale(0.7)`, opacity: 0.2 },
      ],
      { duration: 250 + k * 40, delay: k * 45, easing: 'cubic-bezier(0.3, 0, 0.6, 1)', fill: 'both' },
    );
    a.onfinish = () => c.remove();
    setTimeout(() => c.remove(), 900);
  }
}

/** Squash-and-pop + starburst on a list row (upgrade bought), or a soft pop (new skill). */
export function popRow(row: HTMLElement | null, upgraded: boolean) {
  if (!row) return;
  replay(row, upgraded ? 'lvpop' : 'newpop', 900);
  if (!upgraded || reduced()) return;
  const icon = row.querySelector<HTMLElement>('.skill-icon');
  const host = document.createElement('span');
  host.className = 'starburst';
  host.setAttribute('aria-hidden', 'true');
  const rr = row.getBoundingClientRect();
  const ir = icon?.getBoundingClientRect();
  host.style.left = `${ir ? ir.left - rr.left + ir.width / 2 : 40}px`;
  host.style.top = `${ir ? ir.top - rr.top + ir.height / 2 : rr.height / 2}px`;
  const n = 14;
  let html = '<i class="sb-ring"></i>';
  for (let k = 0; k < n; k++) {
    const ang = (k / n) * Math.PI * 2;
    const d = 34 + (k % 2) * 18;
    html += `<i class="sb-ray" style="--dx:${(Math.cos(ang) * d).toFixed(1)}px;--dy:${(Math.sin(ang) * d).toFixed(1)}px;--r:${((ang * 180) / Math.PI).toFixed(0)}deg">${k % 3 ? '✦' : '★'}</i>`;
  }
  html += `<b class="sb-txt">${L('เลเวลอัป!', 'Level up!')}</b>`;
  host.innerHTML = html;
  row.appendChild(host);
  setTimeout(() => host.remove(), 1100);
}
