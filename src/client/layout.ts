/**
 * Screen layout glue (styles in layout.css):
 * - The one Phaser canvas (#stage) lives in #stage-clip, which is placed over the `.stage-slot` of whatever screen
 *   is showing. `data-stage="fit"` (default) letterboxes the 640×300 arena inside the slot; `"cover"` fills the
 *   slot and crops (the town fills the whole screen). No slot → the canvas is hidden.
 * - body[data-view] tells the CSS which screen is up.
 * - A night-sky layer behind the panels (twinkling stars, drifting petals, lantern glow), CSS-only animation.
 * - Phones held upright get a friendly, dismissible "turn your phone" hint.
 * - Animations pause while the tab is hidden.
 */
import { IMAGES } from './assets';
import { L } from '../i18n';
import { onLang } from './lang';

const GW = 640;
const GH = 300;

let clip: HTMLElement;
let stageEl: HTMLElement;
let refreshGame = () => {};
let observed: Element | null = null;
let ro: ResizeObserver | null = null;
let last = '';
let raf = 0;

/** Put the canvas over the current screen's slot. Cheap; safe to call often. */
export function placeStage() {
  if (!clip) return;
  const slot = document.querySelector<HTMLElement>('#panel .stage-slot');
  if (slot !== observed) {
    if (observed) ro?.unobserve(observed);
    if (slot) ro?.observe(slot);
    observed = slot;
  }
  const r = slot?.getBoundingClientRect();
  if (!slot || !r || r.width < 8 || r.height < 8) {
    clip.classList.add('off');
    return;
  }
  clip.classList.remove('off');
  const cover = slot.dataset.stage === 'cover';
  // full-bleed slots (town, run-over backdrop) have no frame
  clip.classList.toggle('bleed', slot.classList.contains('bleed'));
  const s = cover ? Math.max(r.width / GW, r.height / GH) : Math.min(r.width / GW, r.height / GH);
  const w = Math.round(GW * s);
  const h = Math.round(GH * s);
  const key = `${r.left},${r.top + window.scrollY},${r.width},${r.height},${w},${h}`;
  if (key === last) return;
  last = key;
  // cover: the clip is the slot and the canvas overflows it (cropped); fit: the clip hugs the letterboxed canvas,
  // so its gold frame sits right on the arena's edge
  const dx = Math.round((r.width - w) / 2);
  const dy = Math.round((r.height - h) / 2);
  Object.assign(clip.style, {
    left: `${r.left + window.scrollX + (cover ? 0 : dx)}px`,
    top: `${r.top + window.scrollY + (cover ? 0 : dy)}px`,
    width: `${cover ? r.width : w}px`,
    height: `${cover ? r.height : h}px`,
  });
  Object.assign(stageEl.style, {
    left: `${cover ? dx : 0}px`,
    top: `${cover ? dy : 0}px`,
    width: `${w}px`,
    height: `${h}px`,
  });
  refreshGame();
}

/** placeStage on the next frame (after the browser has laid the new HTML out). */
export function schedulePlace() {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(() => placeStage());
}

/** Tell the CSS which screen is up, then re-place the canvas. */
export function setView(view: string) {
  document.body.dataset.view = view;
  placeStage();
  schedulePlace();
}

/** Called once after the Phaser game exists: how to make it re-read its parent size. */
export function setGameRefresh(fn: () => void) {
  refreshGame = fn;
  last = '';
  placeStage();
}

// ---------- night sky behind the panels ----------
function mountAmbient() {
  if (document.getElementById('ambient')) return;
  const sky = document.createElement('div');
  sky.id = 'ambient';
  sky.setAttribute('aria-hidden', 'true');
  const bits: string[] = [];
  // fixed pseudo-random spread so the sky looks the same each visit
  let seed = 7;
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < 22; i++)
    bits.push(`<i class="amb-star" style="left:${(rnd() * 100).toFixed(1)}%;top:${(rnd() * 70).toFixed(1)}%;--d:${(2 + rnd() * 4).toFixed(1)}s;--o:${(-rnd() * 6).toFixed(1)}s;--s:${(1 + rnd() * 2.2).toFixed(1)}px"></i>`);
  for (let i = 0; i < 9; i++)
    bits.push(`<i class="amb-petal" style="left:${(rnd() * 100).toFixed(1)}%;--d:${(14 + rnd() * 14).toFixed(1)}s;--o:${(-rnd() * 28).toFixed(1)}s;--x:${(40 + rnd() * 120).toFixed(0)}px;--r:${(rnd() * 360).toFixed(0)}deg"></i>`);
  for (let i = 0; i < 4; i++)
    bits.push(`<i class="amb-lantern" style="left:${(8 + i * 27 + rnd() * 8).toFixed(1)}%;--d:${(4 + rnd() * 3).toFixed(1)}s;--o:${(-rnd() * 4).toFixed(1)}s"></i>`);
  sky.innerHTML = bits.join('');
  document.body.prepend(sky);
}

// ---------- "turn your phone" hint ----------
const HINT_KEY = 'mochi.rotateHint';
function hintDismissed() {
  try {
    return localStorage.getItem(HINT_KEY) === '1';
  } catch {
    return false;
  }
}
function mountRotateHint() {
  if (hintDismissed() || document.querySelector('.rotate-tip')) return;
  const tip = document.createElement('div');
  tip.className = 'rotate-tip';
  tip.setAttribute('role', 'status');
  const paint = () => {
    tip.innerHTML = `<img src="${IMAGES.rotatePhone}" alt="" width="56" height="56"><span><b>${L('หมุนโทรศัพท์แนวนอน', 'Turn your phone sideways')}</b><br>${L(
      'เห็นสนามกว้างขึ้น ทุกอย่างอยู่ในจอเดียว (แนวตั้งก็เล่นได้)',
      'A wider arena with everything on one screen (upright still works)',
    )}</span><button type="button" class="rotate-x" aria-label="${L('ปิด', 'Close')}">✕</button>`;
  };
  paint();
  onLang(paint);
  tip.addEventListener('click', (e) => {
    if (!(e.target as Element).closest('.rotate-x')) return;
    try {
      localStorage.setItem(HINT_KEY, '1');
    } catch {
      /* private mode: it just shows again next visit */
    }
    tip.remove();
  });
  document.body.appendChild(tip);
  // it goes away by itself after a while (and for good once closed)
  setTimeout(() => tip.classList.add('gone'), 9000);
}

export function initLayout() {
  clip = document.getElementById('stage-clip') as HTMLElement;
  stageEl = document.getElementById('stage') as HTMLElement;
  if (typeof ResizeObserver === 'function') ro = new ResizeObserver(() => schedulePlace());
  window.addEventListener('resize', schedulePlace);
  window.addEventListener('orientationchange', () => setTimeout(placeStage, 250));
  document.fonts?.ready.then(schedulePlace).catch(() => {});
  const hidden = () => document.body.classList.toggle('tab-hidden', document.hidden);
  document.addEventListener('visibilitychange', hidden);
  hidden();
  mountAmbient();
  mountRotateHint();
}
