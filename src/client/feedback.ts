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

function stars(name: string) {
  return `<div class="fb-stars" role="radiogroup" aria-label="${L('ให้คะแนน', 'Rating')}">${[1, 2, 3, 4, 5]
    .map((n) => `<button type="button" class="fb-star" data-n="${n}" role="radio" aria-checked="false" aria-label="${n}" data-sfx="none" name="${name}">★</button>`)
    .join('')}</div>`;
}

function bindStars(root: HTMLElement, onPick: (n: number) => void) {
  const all = [...root.querySelectorAll<HTMLButtonElement>('.fb-star')];
  for (const b of all) {
    b.addEventListener('click', () => {
      const n = Number(b.dataset.n);
      all.forEach((x) => {
        const on = Number(x.dataset.n) <= n;
        x.classList.toggle('on', on);
        x.setAttribute('aria-checked', String(Number(x.dataset.n) === n));
      });
      onPick(n);
    });
  }
}

/** The 💬 form (a small sheet over the page). */
export function openFeedback(ctx: Ctx = { screen: 'game' }) {
  document.querySelector('.fb-sheet')?.remove();
  track('feedback_open', { screen: ctx.screen });
  const el = document.createElement('div');
  el.className = 'fb-sheet';
  el.innerHTML = `<form class="fb-card" novalidate>
    <button type="button" class="fb-x" aria-label="${L('ปิด', 'Close')}" data-sfx="none">✕</button>
    <h3>${L('บอกเราหน่อย', 'Tell us what you think')}</h3>
    <p class="fb-sub">${L('ทุกข้อความมีคนอ่านจริง ช่วยให้เกมดีขึ้นมาก', 'A real person reads every message. It helps a lot.')}</p>
    ${stars('fb')}
    <textarea maxlength="1000" rows="4" placeholder="${L('ชอบอะไร ติดตรงไหน อยากให้มีอะไรเพิ่ม…', 'What did you like? Where did you get stuck? What should we add?')}"></textarea>
    <input class="fb-hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
    <div class="fb-row"><span class="fb-msg" role="status"></span><button type="submit" class="fb-send">${L('ส่ง', 'Send')}</button></div>
  </form>`;
  document.body.appendChild(el);
  let rating: number | undefined;
  bindStars(el, (n) => (rating = n));
  const close = () => el.remove();
  el.querySelector('.fb-x')!.addEventListener('click', close);
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

const rated = new Set<string>();
/** One-tap rating row appended to the end of the run-end page. */
export function rateRunRow(panel: HTMLElement, ctx: { runId: string; hero: string; wins: number }) {
  if (panel.querySelector('.fb-run')) return;
  const row = document.createElement('section');
  row.className = 'fb-run';
  if (rated.has(ctx.runId)) {
    row.innerHTML = `<p>${icon('heart')} ${L('ขอบคุณที่ให้คะแนน run นี้', 'Thanks for rating this run')}</p>`;
  } else {
    row.innerHTML = `<p>${L('run นี้สนุกแค่ไหน?', 'How fun was this run?')}</p>${stars('run')}<button type="button" class="fb-more small ghost" data-sfx="none">${icon('bulb')} ${L('เขียนบอกเรา', 'Write to us')}</button>`;
    bindStars(row, async (n) => {
      rated.add(ctx.runId);
      row.querySelectorAll('button').forEach((b) => ((b as HTMLButtonElement).disabled = true));
      await send(n, '', { screen: 'run_end', ...ctx });
      row.querySelector('p')!.textContent = L('ขอบคุณ! อยากเล่าเพิ่มไหม?', 'Thanks! Want to tell us more?');
      const more = row.querySelector<HTMLButtonElement>('.fb-more');
      if (more) more.disabled = false;
    });
    row.querySelector('.fb-more')!.addEventListener('click', () => openFeedback({ screen: 'run_end', ...ctx }));
  }
  panel.appendChild(row);
}

/** Header 💬 button (wide screens) + the announcement banner. */
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
      bar.innerHTML = `<span></span><button type="button" aria-label="${L('ปิด', 'Close')}" data-sfx="none">✕</button>`;
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
