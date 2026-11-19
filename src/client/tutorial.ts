/**
 * First-run tutorial: a pop-up panel with slides. Shown once per browser (and again from the "?" button).
 * Slide content lives in tutorialSlides.ts (each game version has its own).
 */
import { SLIDES, TUTORIAL_KEY, type Slide } from './tutorialSlides';
import { L } from '../i18n';
import { onLang } from './lang';

let open = false;

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
  wrap.innerHTML = `<div class="tut" role="dialog" aria-modal="true" aria-label="${L('วิธีเล่น', 'How to play')}">
    <button class="tut-x ghost small" data-t="close" aria-label="${L('ปิด', 'Close')}">✕</button>
    <div class="tut-slide"></div>
    <div class="tut-dots"></div>
    <div class="tut-nav">
      <button class="ghost" data-t="prev">← ${L('ก่อนหน้า', 'Back')}</button>
      <button class="ghost small" data-t="close">${L('ข้าม', 'Skip')}</button>
      <button class="primary" data-t="next">${L('ถัดไป', 'Next')} →</button>
    </div>
  </div>`;
  document.body.appendChild(wrap);
  const $slide = wrap.querySelector('.tut-slide') as HTMLElement;
  const $dots = wrap.querySelector('.tut-dots') as HTMLElement;
  const $prev = wrap.querySelector('[data-t="prev"]') as HTMLButtonElement;
  const $next = wrap.querySelector('[data-t="next"]') as HTMLButtonElement;

  const draw = () => {
    $slide.innerHTML = slideHTML(SLIDES[i]);
    $dots.innerHTML = SLIDES.map((_, k) => `<button class="tut-dot ${k === i ? 'on' : ''}" data-t="go" data-k="${k}" aria-label="${L('หน้า', 'Page')} ${k + 1}"></button>`).join('');
    $prev.disabled = i === 0;
    $next.textContent = i === SLIDES.length - 1 ? L('เริ่มเล่น!', 'Let’s play!') : `${L('ถัดไป', 'Next')} →`;
    $next.focus();
  };
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

/** Show the tutorial if this browser hasn't seen it, and add the "?" button to the header. */
export function initTutorial() {
  const header = document.querySelector('header');
  if (header && !header.querySelector('.tut-open')) {
    const b = document.createElement('button');
    b.className = 'tut-open small ghost';
    const label = () => {
      b.innerHTML = `? <span class="help-txt">${L('วิธีเล่น', 'How to play')}</span>`;
      b.setAttribute('aria-label', L('วิธีเล่น', 'How to play'));
    };
    label();
    onLang(label);
    b.addEventListener('click', showTutorial);
    header.appendChild(b);
  }
  if (!seen()) showTutorial();
}
