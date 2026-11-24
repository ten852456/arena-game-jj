// Player feedback and the announcement banner, inside the game.
// - a feedback button in the header (wide screens only: on phones the header is already full) opens a small form
// - the run-end page gets a one-tap "how was this run?" row at the bottom (never on top of the run-end buttons)
// - /api/announce, when switched on in /admin, shows a slim banner under the header
// Everything is plain DOM (no alert/confirm dialogs) and fails quietly when offline.
import { L, getLang } from '../i18n';
import { SIM_VERSION } from '../sim/combat';
import { deviceKind, track, visitorId } from './track';
import { icon } from './icons';
import './feedback.css';

interface Ctx {
  screen: string;
  runId?: string;
  hero?: string;
  wins?: number;
}

async function send(rating: number | undefined, text: string, ctx: Ctx): Promise<boolean> {
  try {
    const r = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rating, text, ...ctx, lang: getLang(), device: deviceKind(), ver: 'sim' + SIM_VERSION, v: visitorId() }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

const STAR_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 2.6l2.85 5.95 6.5.82-4.78 4.5 1.23 6.45L12 17.2l-5.8 3.12 1.23-6.45-4.78-4.5 6.5-.82z"/></svg>';

/** Five star buttons. Our own SVG (not the ★ character): the game swaps emoji-like characters for its icons, and
 * fonts draw ★ off-centre, so the stars sit exactly in the middle of their buttons whatever the font. */
function stars(label: string) {
  return `<div class="fb-stars" role="radiogroup" aria-label="${label}">${[1, 2, 3, 4, 5]
    .map((n) => `<button type="button" class="fb-star" data-n="${n}" role="radio" aria-checked="false" aria-label="${n} / 5" data-sfx="none">${STAR_SVG}</button>`)
    .join('')}</div>`;
}

function bindStars(root: HTMLElement, onPick: (n: number) => void) {
  const all = [...root.querySelectorAll<HTMLButtonElement>('.fb-star')];
  const paint = (n: number, cls: string) => all.forEach((x) => x.classList.toggle(cls, Number(x.dataset.n) <= n));
  for (const b of all) {
    const n = Number(b.dataset.n);
    b.addEventListener('mouseenter', () => paint(n, 'hover'));
    b.addEventListener('mouseleave', () => paint(0, 'hover'));
    b.addEventListener('click', () => {
      paint(n, 'on');
      all.forEach((x) => x.setAttribute('aria-checked', String(Number(x.dataset.n) === n)));
      onPick(n);
    });
  }
}

/** The feedback form (a small sheet over the page). */
export function openFeedback(ctx: Ctx = { screen: 'game' }, afterRun = false) {
  document.querySelector('.fb-sheet')?.remove();
  track('feedback_open', { screen: ctx.screen });
  const el = document.createElement('div');
  el.className = 'fb-sheet';
  el.innerHTML = `<form class="fb-card" novalidate>
    <button type="button" class="fb-x" aria-label="${L('ปิด', 'Close')}" data-sfx="none"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
    <h3>${afterRun ? L('run นี้สนุกแค่ไหน?', 'How was this run?') : L('บอกเราหน่อย', 'Tell us what you think')}</h3>
    <p class="fb-sub">${afterRun ? L('กดดาวเดียวก็พอ อยากเล่าเพิ่มก็พิมพ์ได้', 'One tap on a star is enough. Add a few words if you like.') : L('ทุกข้อความมีคนอ่านจริง ช่วยให้เกมดีขึ้นมาก', 'A real person reads every message. It helps a lot.')}</p>
    ${stars(L('ให้คะแนน', 'Rating'))}
    <textarea maxlength="1000" rows="${afterRun ? 2 : 4}" placeholder="${L('ชอบอะไร ติดตรงไหน อยากให้มีอะไรเพิ่ม…', 'What did you like? Where did you get stuck? What should we add?')}"></textarea>
    <input class="fb-hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
    <p class="fb-msg" role="status"></p>
    <div class="fb-row">${afterRun ? `<button type="button" class="fb-later" data-sfx="none">${L('ไว้ทีหลัง', 'Not now')}</button>` : '<span></span>'}<button type="submit" class="fb-send" data-sfx="none">${L('ส่ง', 'Send')}</button></div>
  </form>`;
  document.body.appendChild(el);
  let rating: number | undefined;
  bindStars(el, (n) => (rating = n));
  const close = () => el.remove();
  el.querySelector('.fb-x')!.addEventListener('click', close);
  el.querySelector('.fb-later')?.addEventListener('click', close);
  el.addEventListener('click', (e) => {
    if (e.target === el) close();
  });
  el.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Escape') close();
  });
  const form = el.querySelector('form')!;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = form.querySelector('textarea')!.value.trim();
    const msg = form.querySelector<HTMLElement>('.fb-msg')!;
    if ((form.querySelector('.fb-hp') as HTMLInputElement).value) return close();
    if (!rating && !text) {
      msg.textContent = L('ให้ดาวหรือพิมพ์สักนิดก่อนนะ', 'Pick a star or write a few words first');
      return;
    }
    const btn = form.querySelector<HTMLButtonElement>('.fb-send')!;
    btn.disabled = true;
    const ok = await send(rating, text, ctx);
    if (ok) {
      form.innerHTML = `<h3>${L('ขอบคุณมาก!', 'Thank you!')}</h3><p class="fb-sub">${L('ได้รับแล้ว', 'Got it.')}</p>`;
      setTimeout(close, 1400);
    } else {
      btn.disabled = false;
      msg.textContent = L('ส่งไม่สำเร็จ ลองอีกครั้ง', 'Could not send. Try again.');
    }
  });
  el.querySelector<HTMLButtonElement>('.fb-star')?.focus();
}

const ASK_KEY = 'mochi.fb.asked';
const ASK_EVERY = 20 * 3600_000;
const asked = new Set<string>();
/**
 * After a run ends: once the run-end reveal has played, a small sheet asks how the run was (stars + optional words).
 * At most once every 20 hours per browser, never twice for one run, and "Not now" just closes it.
 */
export function askAfterRun(ctx: { runId: string; hero: string; wins: number }, revealing: () => boolean) {
  if (asked.has(ctx.runId)) return;
  asked.add(ctx.runId);
  let last = 0;
  try {
    last = Number(localStorage.getItem(ASK_KEY)) || 0;
  } catch {
    /* no storage: ask */
  }
  if (Date.now() - last < ASK_EVERY) return;
  const started = Date.now();
  const tick = () => {
    // wait for the staged reveal (max 9 s), then a short beat so the result sinks in first
    if (revealing() && Date.now() - started < 9000) return void setTimeout(tick, 400);
    setTimeout(() => {
      if (document.querySelector('.fb-sheet')) return;
      try {
        localStorage.setItem(ASK_KEY, String(Date.now()));
      } catch {
        /* fine */
      }
      openFeedback({ screen: 'run_end', ...ctx }, true);
    }, 1200);
  };
  setTimeout(tick, 600);
}

/** Header feedback button (wide screens) + the announcement banner. */
export function mountFeedback() {
  const header = document.querySelector('header');
  if (header && !header.querySelector('.fb-open')) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'fb-open small';
    b.dataset.sfx = 'none';
    b.innerHTML = icon('bulb');
    const label = () => {
      b.title = L('ส่งความเห็น', 'Send feedback');
      b.setAttribute('aria-label', b.title);
    };
    label();
    b.addEventListener('click', () => openFeedback({ screen: 'header' }));
    header.appendChild(b);
  }
  void fetch('/api/announce')
    .then((r) => (r.ok ? r.json() : null))
    .then((a: { on: boolean; th?: string; en?: string; at?: number } | null) => {
      if (!a?.on) return;
      const text = getLang() === 'en' ? a.en || a.th : a.th || a.en;
      if (!text) return;
      const key = 'mochi.announce.' + a.at;
      try {
        if (localStorage.getItem(key)) return;
      } catch {
        /* show it */
      }
      const bar = document.createElement('div');
      bar.className = 'announce';
      bar.setAttribute('role', 'status');
      bar.innerHTML = `<span></span><button type="button" aria-label="${L('ปิด', 'Close')}" data-sfx="none">×</button>`;
      bar.querySelector('span')!.textContent = text;
      bar.querySelector('button')!.addEventListener('click', () => {
        bar.remove();
        try {
          localStorage.setItem(key, '1');
        } catch {
          /* fine */
        }
      });
      document.body.appendChild(bar);
    })
    .catch(() => {});
}
