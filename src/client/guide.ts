/**
 * Guided, hands-on tutorial: walks a new player through the real UI (town → arena → hero → buy two skills that
 * chain → fight → why you won). Each step dims the screen, cuts a hole around the thing to press (pulsing ring +
 * short bubble with an arrow) and moves on when the player actually does it. Clicks outside the hole are blocked so
 * the player can't get lost; the "Skip tutorial" button (and Esc) is always there.
 *
 * The first fight asks the server for its training opponent (see handleFight / tutorialOpponent): the server allows
 * it once per player, on day 1 of a new run, so the first game is a win without any client-side trust.
 */
import { L } from '../i18n';
import { onLang } from './lang';
import { guideHooks as H } from './ui';
import { chainPair, partnerOffer, tutorialSeed } from './guidePlan';
import { showTutorial } from './tutorial';
import { TUTORIAL_KEY } from './tutorialSlides';
import './guide.css';

/** Bump to offer the guide again to everyone. */
export const GUIDE_KEY = 'mm.guide.v1';

type Target = Element | DOMRect | null;
interface Step {
  id: string;
  /** the UI view this step belongs to; none = a centred card on any screen */
  view?: string;
  /** what to spotlight (an element, several elements = their union, or a screen rectangle) */
  target?: () => Target | Element[];
  title?: () => string;
  text: () => string;
  /** label of a "next" button: the step waits for it instead of `done` */
  next?: () => string;
  onNext?: () => void;
  done?: () => boolean;
  /** no dimming and no click blocking (the fight plays) */
  passive?: boolean;
  enter?: () => void;
}

const $ = (sel: string) => document.querySelector(sel);
const skills = () => H.run()?.skills.length ?? 0;
/** shop indexes of the two skills the guide suggests: [first, second] */
let pair: [number, number] | null = null;

/** The arena on the town map (canvas) when it is visible and not covered, else the "Enter the Arena" button. */
function arenaTarget(): Target {
  const town = H.town();
  const a = town.screenRect('arena');
  const btn = $('[data-a="enterArena"]');
  if (a) {
    const b = town.screenRect('bubble');
    const r = b ? union([a, b]) : a;
    const cx = a.left + a.width / 2;
    const cy = a.top + a.height * 0.6;
    const onScreen = r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight;
    const hit = onScreen ? document.elementFromPoint(cx, cy) : null;
    if (hit && (hit.tagName === 'CANVAS' || root?.contains(hit))) return r;
  }
  return btn;
}

const offerCard = (i: number) => (i >= 0 ? $(`.card.offer[data-tip="s:${i}"]`) : null);
const anyBuyable = () => $('.card.offer:not(.nobuy)');

const STEPS: Step[] = [
  {
    id: 'welcome',
    title: () => L('สวัสดี! 👋', 'Hi there! 👋'),
    text: () => L('มาเล่นเกมแรกด้วยกัน ใช้เวลาแค่ 1 นาที', 'Let’s play your first game together. It takes about a minute.'),
    next: () => L('เริ่มเลย ▶', 'Let’s go ▶'),
    onNext: () => H.goTown(H.runActive() ? undefined : tutorialSeed()),
  },
  {
    id: 'town',
    view: 'town',
    target: arenaTarget,
    text: () => L('นี่คือสนามประลอง แตะเพื่อเข้าไปสู้!', 'This is the Arena. Tap it to go in and fight!'),
    done: () => H.view() === 'title',
  },
  {
    id: 'hero',
    view: 'title',
    target: () => $('.heroes.pick3'),
    text: () => L('เลือกฮีโร่ 1 ตัว ตัวไหนก็ได้!', 'Pick a hero. Any one is fine!'),
    done: () => H.view() === 'shop',
  },
  {
    id: 'buy1',
    view: 'shop',
    target: () => {
      const r = H.run();
      if (r && !r.skills.length) pair ??= chainPair(r);
      return offerCard(pair?.[0] ?? -1) ?? anyBuyable();
    },
    text: () => L('ซื้อ skill นี้ก่อน ตอนสู้มันจะทำงานเอง', 'Buy this skill first. In a fight it fires all by itself.'),
    done: () => skills() >= 1,
  },
  {
    id: 'buy2',
    view: 'shop',
    target: () => {
      const r = H.run();
      return (r ? offerCard(partnerOffer(r)) : null) ?? anyBuyable();
    },
    title: () => (H.run() && partnerOffer(H.run()!) >= 0 ? L('🔗 ตัวนี้ต่อโซ่ได้!', '🔗 This one chains!') : ''),
    text: () =>
      H.run() && partnerOffer(H.run()!) >= 0
        ? L('ซื้อเลย มันจะไปวางติดกับตัวแรก', 'Buy it and it goes right next to your first skill.')
        : L('ซื้ออีก 1 skill', 'Buy one more skill.'),
    done: () => skills() >= 2 || !anyBuyable(),
  },
  {
    id: 'chain',
    view: 'shop',
    target: () => [$('.sv-mine .chain-panel'), $('.sv-mine .skilllist')].filter((e): e is Element => !!e),
    title: () => L('🔗 วางติดกัน = ต่อโซ่', '🔗 Side by side = a chain'),
    // the chain panel right under this bubble already shows it as a picture: [skill] + [skill] = bonus
    text: () => L('สองตัวนี้ติดกัน เลยได้โบนัสตามรูป ☝', 'These two sit together, so they get the bonus in the picture ☝'),
    next: () => L('เข้าใจแล้ว ▶', 'Got it ▶'),
  },
  {
    id: 'fight',
    view: 'shop',
    target: () => $('[data-a="fight"]'),
    enter: () => H.setTutorialFight(true),
    text: () => L('พร้อมแล้ว! กดสู้เลย', 'All set! Press Fight.'),
    done: () => H.view() === 'fighting',
  },
  {
    id: 'watch',
    view: 'fighting',
    passive: true,
    target: () => $('.mm-speed'),
    text: () => L('นั่งดูได้เลย skill ทำงานเองตามเวลาของมัน ⏱ · กด 1x 2x 4x เปลี่ยนความเร็ว', 'Just watch: each skill fires on its own timer ⏱ · tap 1x 2x 4x to change speed'),
    done: () => H.view() === 'result',
  },
  {
    id: 'why',
    view: 'result',
    target: () => $('.xv-callout') ?? $('.rv-main'),
    title: () => (H.lastWon() ? L('ชนะแล้ว! 🎉', 'You won! 🎉') : L('เกือบแล้ว!', 'So close!')),
    text: () =>
      H.lastWon()
        ? L('กล่องนี้กล่องเดียวพอ: บอกว่าชนะเพราะตัวไหน', 'This one box is enough: it tells you which skill won it')
        : L('กล่องนี้กล่องเดียวพอ: บอกว่าแพ้เพราะอะไร และลองอะไรต่อ', 'This one box is enough: why you lost and what to try next'),
    next: () => L('ต่อไป ▶', 'Next ▶'),
  },
  {
    id: 'done',
    title: () => L('พร้อมลุยแล้ว! 🌙', 'You’re ready! 🌙'),
    text: () =>
      L('ชนะให้ครบ 10 ครั้งก่อนเลือดหมด · ดูการสอนซ้ำได้ที่ปุ่ม ? วิธีเล่น', 'Win 10 fights before your HP runs out. Replay this guide from the ? How to play button.'),
    next: () => L('เล่นต่อ ▶', 'Keep playing ▶'),
    onNext: () => finish('done'),
  },
];

// ---------- overlay ----------
let root: HTMLElement | null = null;
let hole!: HTMLElement;
let ring!: HTMLElement;
let bubble!: HTMLElement;
let idx = -1;
let raf = 0;
let shownStep = -1;
let scrolledFor = -1;
/** hole in viewport px (null = none: every click outside the bubble is blocked) */
let holeRect: DOMRect | null = null;
let holeEls: Element[] = [];
let passiveNow = true;
let waitSince = 0;
let scrollTries = 0;
let lastScroll = 0;

function store(v: string) {
  try {
    localStorage.setItem(GUIDE_KEY, v);
  } catch {
    /* storage blocked: the guide is offered again next visit */
  }
}
function seen(key: string) {
  try {
    return !!localStorage.getItem(key);
  } catch {
    return false;
  }
}

const union = (rs: DOMRect[]) => {
  const l = Math.min(...rs.map((r) => r.left));
  const t = Math.min(...rs.map((r) => r.top));
  return new DOMRect(l, t, Math.max(...rs.map((r) => r.right)) - l, Math.max(...rs.map((r) => r.bottom)) - t);
};

function resolve(step: Step): { rect: DOMRect | null; els: Element[] } {
  const t = step.target?.() ?? null;
  const els = Array.isArray(t) ? t : t instanceof Element ? [t] : [];
  if (t instanceof DOMRect) return { rect: t, els: [] };
  const rects = els.map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0 || r.height > 0);
  return { rect: rects.length ? union(rects) : null, els };
}

function paintBubble(step: Step) {
  const title = step.title?.() ?? '';
  const next = step.next?.() ?? '';
  bubble.innerHTML = `<div class="gd-arrow" aria-hidden="true"></div>
    ${title ? `<b class="gd-title">${title}</b>` : ''}
    <p class="gd-text">${step.text()}</p>
    <div class="gd-btns">
      <button type="button" class="gd-skip small ghost" data-g="skip">${L('ข้ามการสอน', 'Skip tutorial')}</button>
      ${next ? `<button type="button" class="gd-next primary" data-g="next">${next}</button>` : ''}
    </div>
    <span class="gd-dots" aria-hidden="true">${STEPS.map((_, k) => `<i class="${k === idx ? 'on' : ''}"></i>`).join('')}</span>`;
  bubble.setAttribute('aria-label', L('การสอน', 'Tutorial'));
  (bubble.querySelector('.gd-next') as HTMLElement | null)?.focus({ preventScroll: true });
}

const PAD = 6;
const M = 10;

function place(rect: DOMRect | null, passive: boolean) {
  const vw = innerWidth;
  const vh = innerHeight;
  root!.classList.toggle('passive', passive);
  root!.classList.toggle('nohole', !rect);
  if (rect) {
    const l = Math.max(2, rect.left - PAD);
    const t = Math.max(2, rect.top - PAD);
    const r = Math.min(vw - 2, rect.right + PAD);
    const b = Math.min(vh - 2, rect.bottom + PAD);
    holeRect = new DOMRect(l, t, Math.max(0, r - l), Math.max(0, b - t));
    for (const el of [hole, ring]) Object.assign(el.style, { left: `${l}px`, top: `${t}px`, width: `${r - l}px`, height: `${b - t}px` });
  } else holeRect = null;
  // bubble: below, above, right, left of the target; else the screen edge farthest from it
  const bw = bubble.offsetWidth;
  const bh = bubble.offsetHeight;
  let x: number;
  let y: number;
  let side = 'none';
  if (!holeRect) {
    x = (vw - bw) / 2;
    y = (vh - bh) / 2;
  } else {
    const h = holeRect;
    const cx = h.left + h.width / 2;
    const cy = h.top + h.height / 2;
    if (vh - h.bottom >= bh + 18) [side, x, y] = ['top', cx - bw / 2, h.bottom + 14];
    else if (h.top >= bh + 18) [side, x, y] = ['bottom', cx - bw / 2, h.top - bh - 14];
    else if (vw - h.right >= bw + 18) [side, x, y] = ['left', h.right + 14, cy - bh / 2];
    else if (h.left >= bw + 18) [side, x, y] = ['right', h.left - bw - 14, cy - bh / 2];
    else [side, x, y] = ['none', vw - bw - M, cy > vh / 2 ? M : vh - bh - M];
    x = Math.max(M, Math.min(vw - bw - M, x));
    y = Math.max(M, Math.min(vh - bh - M, y));
    const arrow = bubble.querySelector<HTMLElement>('.gd-arrow');
    if (arrow) {
      if (side === 'top' || side === 'bottom') arrow.style.left = `${Math.max(16, Math.min(bw - 16, cx - x))}px`;
      else arrow.style.left = '';
      if (side === 'left' || side === 'right') arrow.style.top = `${Math.max(16, Math.min(bh - 16, cy - y))}px`;
      else arrow.style.top = '';
    }
  }
  bubble.dataset.side = side;
  bubble.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}

function tick() {
  raf = requestAnimationFrame(tick);
  if (!root || idx < 0) return;
  let step = STEPS[idx];
  const v = H.view();
  // the player got ahead (or the step is already done): move on
  for (let guard = 0; guard < STEPS.length; guard++) {
    step = STEPS[idx];
    if (step.done?.() && !step.next) {
      go(idx + 1);
      if (!root) return;
      continue;
    }
    if (step.view && step.view !== v) {
      const j = STEPS.findIndex((s, k) => k > idx && s.view === v);
      if (j > idx) {
        go(j);
        continue;
      }
    }
    break;
  }
  step = STEPS[idx];
  if (idx !== shownStep) {
    shownStep = idx;
    root.dataset.step = step.id;
    step.enter?.();
    paintBubble(step);
  }
  const waiting = !!step.view && step.view !== v;
  const { rect, els } = waiting ? { rect: null, els: [] } : resolve(step);
  holeEls = els;
  // a target that is not there yet (screen still drawing): wait without blocking
  const missing = !waiting && !!step.target && !rect;
  passiveNow = !!step.passive || waiting || missing;
  // a short wait (a screen still drawing) hides the bubble; a long one shows it again so Skip is always reachable
  if (waiting || missing) waitSince ||= performance.now();
  else waitSince = 0;
  root.classList.toggle('waiting', !!waitSince && performance.now() - waitSince < 1200);
  // bring the target on screen (a few tries per step: the screen may still be settling; never fights the player for long)
  if (scrolledFor !== idx) [scrolledFor, scrollTries, lastScroll] = [idx, 0, 0];
  const now = performance.now();
  if (els[0] && rect && scrollTries < 3 && now - lastScroll > 700) {
    const fits = rect.height < innerHeight * 0.8;
    const off = fits ? rect.top < 0 || rect.bottom > innerHeight - 70 : rect.top < 0 || rect.top > innerHeight * 0.5;
    if (off || rect.left < 0 || rect.right > innerWidth) {
      els[0].scrollIntoView({ block: fits ? 'center' : 'start', inline: 'nearest', behavior: 'smooth' });
      scrollTries++;
      lastScroll = now;
    }
  }
  place(waiting || missing ? null : rect, passiveNow);
}

function go(k: number) {
  if (k >= STEPS.length) return finish('done');
  idx = k;
}

/** Clicks and taps outside the hole (and the bubble) do nothing while a step is showing. */
function guard(e: Event) {
  if (!root || passiveNow) return;
  const t = e.target as Node | null;
  if (t && bubble.contains(t)) return;
  if (t && holeEls.some((el) => el.contains(t))) return;
  let x = NaN;
  let y = NaN;
  if ('clientX' in e) [x, y] = [(e as MouseEvent).clientX, (e as MouseEvent).clientY];
  else if ((e as TouchEvent).touches?.[0]) [x, y] = [(e as TouchEvent).touches[0].clientX, (e as TouchEvent).touches[0].clientY];
  const h = holeRect;
  if (h && x >= h.left && x <= h.right && y >= h.top && y <= h.bottom) return;
  e.stopPropagation();
  // touchstart/pointerdown keep their default so the page can still be scrolled with a finger
  if (e.type === 'click' || e.type === 'mousedown' || e.type === 'dblclick' || e.type === 'contextmenu') e.preventDefault();
}
const GUARDED = ['pointerdown', 'mousedown', 'touchstart', 'click', 'dblclick', 'contextmenu'] as const;

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && root) {
    e.stopPropagation();
    e.preventDefault();
    finish('skipped');
  }
}

function finish(how: 'done' | 'skipped') {
  if (!root) return;
  store(how);
  H.setTutorialFight(false);
  cancelAnimationFrame(raf);
  for (const t of GUARDED) window.removeEventListener(t, guard, true);
  window.removeEventListener('keydown', onKey, true);
  root.remove();
  root = null;
  idx = -1;
  pair = null;
}

/** Start the guided tutorial from the welcome card. */
export function startGuide() {
  if (root) return;
  pair = null;
  idx = 0;
  shownStep = -1;
  scrolledFor = -1;
  root = document.createElement('div');
  root.className = 'gd-root';
  root.innerHTML = `<div class="gd-hole"></div><div class="gd-ring"></div><div class="gd-bubble" role="dialog" aria-live="polite"></div>`;
  hole = root.querySelector('.gd-hole')!;
  ring = root.querySelector('.gd-ring')!;
  bubble = root.querySelector('.gd-bubble')!;
  bubble.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-g]');
    if (!b) return;
    if (b.dataset.g === 'skip') return finish('skipped');
    const step = STEPS[idx];
    if (step.onNext) step.onNext();
    if (root && STEPS[idx] === step) go(idx + 1);
  });
  document.body.appendChild(root);
  for (const t of GUARDED) window.addEventListener(t, guard, { capture: true, passive: false });
  window.addEventListener('keydown', onKey, true);
  raf = requestAnimationFrame(tick);
}

export const guideActive = () => !!root;

// ---------- "? How to play" chooser ----------
let redrawHelp: (() => void) | null = null;
/** The header "?" button: play the guided tutorial, or read the rule slides. */
export function openHelp() {
  if (root || document.querySelector('.gd-help')) return;
  const box = document.createElement('div');
  box.className = 'gd-help';
  const draw = () => {
    const v = H.view();
    const can = !H.runActive() && v !== 'fighting' && v !== 'replay';
    box.innerHTML = `<div class="gd-help-box" role="dialog" aria-modal="true" aria-label="${L('วิธีเล่น', 'How to play')}">
      <button type="button" class="gd-help-x small ghost" data-h="close" aria-label="${L('ปิด', 'Close')}">✕</button>
      <h2>${L('วิธีเล่น', 'How to play')}</h2>
      <button type="button" class="primary" data-h="guide" ${can ? '' : 'disabled'}>${L('▶ เล่นตามการสอน (1 นาที)', '▶ Guided game (1 min)')}</button>
      ${can ? '' : `<p class="muted small">${L('ใช้ได้เมื่อไม่มีรอบที่เล่นค้างอยู่', 'Available when no run is in progress')}</p>`}
      <button type="button" data-h="slides">${L('📖 อ่านกติกา', '📖 Read the rules')}</button>
    </div>`;
  };
  draw();
  redrawHelp = draw;
  const close = () => {
    box.remove();
    redrawHelp = null;
    window.removeEventListener('keydown', key, true);
  };
  const key = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  box.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-h]');
    if (!b) return e.target === box && close();
    if (b.dataset.h === 'close') close();
    else if (b.dataset.h === 'guide') {
      close();
      startGuide();
    } else if (b.dataset.h === 'slides') {
      close();
      showTutorial();
    }
  });
  window.addEventListener('keydown', key, true);
  document.body.appendChild(box);
  (box.querySelector('[data-h="guide"]:not([disabled])') as HTMLElement | null)?.focus();
}

/** Offer the guide on the first visit (not to players who already saw the old slides, not mid-run, not on a replay link). */
export function initGuide() {
  onLang(() => {
    if (root && idx >= 0) paintBubble(STEPS[idx]);
    redrawHelp?.();
  });
  if (new URLSearchParams(location.search).has('replay')) return;
  if (seen(GUIDE_KEY) || seen(TUTORIAL_KEY) || H.runActive()) return;
  startGuide();
}
