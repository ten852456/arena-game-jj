/**
 * First-run tutorial: a pop-up panel with slides. Shown once per browser (and again from the "?" button).
 * Slide content lives in tutorialSlides.ts (each game version has its own).
 */
import { L, getLang } from '../i18n';
import { onLang, setLang } from './lang';
import { SLIDES, TUTORIAL_KEY, type Slide } from './tutorialSlides';

let open = false;
/** re-draws the open tutorial (language change) */
let redraw = () => {};

function seen(): boolean {
  try {
    return localStorage.getItem(TUTORIAL_KEY) === '1';
  } catch {
    return false; // storage blocked: just show it
  }
}

function markSeen() {
  try {
    localStorage.setItem(TUTORIAL_KEY, '1');
  } catch {
    /* storage blocked: it shows again next time, which is fine */
  }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function slideHTML(s: Slide) {
  return `<div class="tut-art" aria-hidden="true">${s.art}</div>
    <h2 class="tut-title">${esc(s.title)}</h2>
    <div class="tut-body">${s.body.map((p) => `<p>${p}</p>`).join('')}</div>`;
}

/** Show the tutorial panel (from slide 0). */
export function showTutorial() {
  if (open) return;
  open = true;
  let i = 0;
  const wrap = document.createElement('div');
  wrap.className = 'tut-backdrop';
  wrap.innerHTML = `<div class="tut" role="dialog" aria-modal="true">
    <button class="tut-x ghost small" data-t="close">✕</button>
    <span class="tut-lang" role="group" aria-label="Language"></span>
    <div class="tut-slide"></div>
    <div class="tut-dots"></div>
    <div class="tut-nav">
      <button class="ghost" data-t="prev"></button>
      <button class="ghost small" data-t="close" data-skip="1"></button>
      <button class="primary" data-t="next"></button>
    </div>
  </div>`;
  document.body.appendChild(wrap);
  const $slide = wrap.querySelector('.tut-slide') as HTMLElement;
  const $dots = wrap.querySelector('.tut-dots') as HTMLElement;
  const $prev = wrap.querySelector('[data-t="prev"]') as HTMLButtonElement;
  const $next = wrap.querySelector('[data-t="next"]') as HTMLButtonElement;

  const draw = () => {
    if (!open) return;
    wrap.querySelector('.tut')!.setAttribute('aria-label', L('วิธีเล่น', 'How to play'));
    wrap.querySelector('.tut-x')!.setAttribute('aria-label', L('ปิด', 'Close'));
    wrap.querySelector('[data-skip]')!.textContent = L('ข้าม', 'Skip');
    $prev.textContent = L('← ก่อนหน้า', '← Back');
    wrap.querySelector('.tut-lang')!.innerHTML = (['th', 'en'] as const)
      .map((l) => `<button class="small ${getLang() === l ? 'on' : 'ghost'}" data-t="lang" data-lang="${l}" aria-pressed="${getLang() === l}">${l.toUpperCase()}</button>`)
      .join('');
    $slide.innerHTML = slideHTML(SLIDES[i]);
    $dots.innerHTML = SLIDES.map((_, k) => `<button class="tut-dot ${k === i ? 'on' : ''}" data-t="go" data-k="${k}" aria-label="${L('หน้า', 'Page')} ${k + 1}"></button>`).join('');
    $prev.disabled = i === 0;
    $next.textContent = i === SLIDES.length - 1 ? L('เริ่มเล่น!', 'Let’s play!') : L('ถัดไป →', 'Next →');
    $next.focus();
  };
  redraw = draw;
  const close = () => {
    markSeen();
    wrap.remove();
    window.removeEventListener('keydown', onKey);
    open = false;
  };
  const go = (k: number) => {
    i = Math.max(0, Math.min(SLIDES.length - 1, k));
    draw();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight') i === SLIDES.length - 1 ? close() : go(i + 1);
    else if (e.key === 'ArrowLeft') go(i - 1);
  };
  wrap.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-t]');
    if (!t) {
      if (e.target === wrap) close(); // click outside the panel
      return;
    }
    const a = t.dataset.t;
    if (a === 'close') close();
    else if (a === 'prev') go(i - 1);
    else if (a === 'next') (i === SLIDES.length - 1 ? close() : go(i + 1));
    else if (a === 'go') go(Number(t.dataset.k));
    else if (a === 'lang' && t.dataset.lang !== getLang()) setLang(t.dataset.lang as 'th' | 'en');
  });
  // swipe on touch screens
  let sx = 0;
  wrap.addEventListener('touchstart', (e) => (sx = e.touches[0].clientX), { passive: true });
  wrap.addEventListener('touchend', (e) => {
    const dx = e.changedTouches[0].clientX - sx;
    if (Math.abs(dx) > 50) go(i + (dx < 0 ? 1 : -1));
  });
  window.addEventListener('keydown', onKey);
  draw();
}

/**
 * Add the "?" button to the header. Without options it opens these slides and shows them on the first visit;
 * `onHelp` replaces both (the guided tutorial offers itself and lets the player pick slides or the guide).
 */
export function initTutorial(opts: { onHelp?: () => void } = {}) {
  const header = document.querySelector('header');
  if (header && !header.querySelector('.tut-open')) {
    const b = document.createElement('button');
    b.className = 'tut-open small ghost';
    const paint = () => {
      b.innerHTML = `<span aria-hidden="true">?</span> <span class="hb-l">${L('วิธีเล่น', 'How to play')}</span>`;
      b.setAttribute('aria-label', L('วิธีเล่น', 'How to play'));
    };
    paint();
    b.addEventListener('click', () => (opts.onHelp ?? showTutorial)());
    header.appendChild(b);
    onLang(() => {
      paint();
      redraw();
    });
  }
  if (!opts.onHelp && !seen()) showTutorial();
}
