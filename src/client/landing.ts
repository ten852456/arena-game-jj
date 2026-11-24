// The public landing page (/). The game itself lives at /play.
// Numbers (heroes, skills, relics, wins) come from the game code, so this page can never quote stale figures.
// Roadmap items say whether they are built or planned (docs/FACTS.md rules).
import { setLangValue, type Lang } from '../i18n';
import { HEROES } from '../sim/heroes';
import { SKILLS } from '../sim/skills';
import { RELICS } from '../sim/relics';
import { WIN_TARGET } from '../sim/run';
import { openFeedback } from './feedback';
import { track, visitorId } from './track';
import './landing.css';

// old share links (/?replay=…, /?chain=1 …) belong to the game: send them there untouched
if (location.search) location.replace('/play' + location.search + location.hash);

const LANG_KEY = 'mochi.lang';
let lang: Lang = (() => {
  try {
    return localStorage.getItem(LANG_KEY) === 'th' ? 'th' : 'en';
  } catch {
    return 'en';
  }
})();
const t = (en: string, th: string) => (lang === 'th' ? th : en);
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const IMG = '/assets/img/site/';
const LINKS = {
  youtube: 'https://www.youtube.com/@mochimoongame',
  week1: 'https://youtu.be/CUtJ5TXZFv8',
  x: 'https://x.com/tenny2201',
  telegram: 'https://t.me/ten852456',
};
const SHORT = { en: 'Xw72OiZNcM4', th: 'Mz-VDsYAC4U' };

const nHeroes = HEROES.length;
const nSkills = Object.keys(SKILLS).length;
const nRelics = RELICS.length;

type Item = [en: string, th: string];
const DONE: Item[] = [
  ['Playable core loop on web and phone, in Thai and English', 'เล่นได้ครบลูปบนเว็บและมือถือ ทั้งไทยและอังกฤษ'],
  ['Deterministic combat engine: same builds + seed = same fight', 'ระบบต่อสู้แบบ deterministic: บิลด์ + seed เดิม = ไฟต์เดิมทุกครั้ง'],
  ['The server re-checks every build, so forged gold, relics or ranks are refused', 'เซิร์ฟเวอร์ตรวจทุกบิลด์ซ้ำ เงิน เรลิก หรือแรงก์ที่ปลอมมาจะถูกปฏิเสธ'],
  [`${nHeroes} heroes, ${nSkills} skills, ${nRelics} relics, balanced with thousands of simulated fights`, `ฮีโร่ ${nHeroes} ตัว สกิล ${nSkills} แบบ เรลิก ${nRelics} ชิ้น จูนสมดุลด้วยไฟต์จำลองหลายพันไฟต์`],
  ['About 20 private playtesters', 'ผู้ทดสอบแบบ private ราว 20 คน'],
];
const NOW: Item[] = [
  ['Public playtest: you are here', 'เปิดทดสอบสาธารณะ: คุณอยู่ตรงนี้แล้ว'],
  ['Onchain version on Solana devnet (MagicBlock private ephemeral rollup): built, deploying next', 'เวอร์ชัน onchain บน Solana devnet (MagicBlock private ephemeral rollup): สร้างแล้ว กำลังขึ้นเซิร์ฟเวอร์'],
  ['Waitlist, feedback and player stats to steer balance', 'waitlist, feedback และสถิติผู้เล่น เพื่อใช้จูนเกม'],
];
const NEXT: Item[] = [
  ['Seal your best run into a Build Card', 'ผนึกบิลด์ที่ดีที่สุดเป็น Build Card'],
  ['Other players borrow sealed builds for raids and towers; the author earns a share', 'ผู้เล่นอื่นยืมบิลด์ไปลง raid และ tower ได้ เจ้าของบิลด์ได้ส่วนแบ่ง'],
  ['Season prize pool you can verify onchain', 'กองรางวัลประจำ season ที่ตรวจสอบได้บนเชน'],
  ['Season pass for convenience and looks, never combat power', 'Season pass เพื่อความสะดวกและความสวยงาม ไม่เพิ่มพลังต่อสู้'],
];

function list(items: Item[]) {
  return `<ul>${items.map(([en, th]) => `<li>${esc(t(en, th))}</li>`).join('')}</ul>`;
}

function render() {
  document.documentElement.lang = lang;
  const root = document.getElementById('site')!;
  root.innerHTML = `
  <nav class="nav">
    <a class="brand" href="/"><img src="/assets/img/logo.webp" alt="Mochi Moon" width="150" height="70"></a>
    <div class="nav-links">
      <a href="#how">${t('How it works', 'เล่นยังไง')}</a>
      <a href="#roadmap">${t('Roadmap', 'แผนงาน')}</a>
      <a href="#faq">FAQ</a>
    </div>
    <div class="nav-end">
      <div class="lang" role="group" aria-label="Language">
        <button type="button" data-lang="en" aria-pressed="${lang === 'en'}">EN</button>
        <button type="button" data-lang="th" aria-pressed="${lang === 'th'}">TH</button>
      </div>
      <a class="btn btn-gold btn-sm" href="/play" data-play="nav">${t('Play', 'เล่นเลย')}</a>
    </div>
  </nav>

  <header class="hero">
    <div class="hero-art" style="background-image:url(${IMG}key-arena.webp)"></div>
    <div class="hero-in">
      <p class="kicker">${t('A cozy auto-battler', 'เกม auto-battler สุดน่ารัก')}</p>
      <h1>${t('Draft the build.', 'จัดบิลด์ให้เทพ')}<br><span>${t('It fights for you.', 'แล้วปล่อยให้มันสู้แทนคุณ')}</span></h1>
      <p class="lead">${t(
        'Pick a hero, stack skills that combo, and send your build into battle against other players’ builds. Every fight is deterministic, so anyone can replay it and check it.',
        'เลือกฮีโร่ สะสมสกิลที่คอมโบกัน แล้วส่งบิลด์ไปสู้กับบิลด์ของผู้เล่นคนอื่น ทุกไฟต์เป็นแบบ deterministic ใครก็เปิดดูซ้ำและตรวจสอบได้',
      )}</p>
      <div class="cta">
        <a class="btn btn-gold" href="/play" data-play="hero">▶ ${t('Play free now', 'เล่นฟรีเลย')}</a>
        <a class="btn btn-ghost" href="#join">${t('Join the waitlist', 'ลงชื่อรอข่าว')}</a>
      </div>
      <p class="fine">${t('Free prototype · web and phone · no login, no wallet needed', 'prototype ฟรี · เว็บและมือถือ · ไม่ต้องล็อกอิน ไม่ต้องมี wallet')}</p>
    </div>
  </header>

  <section class="stats" aria-label="${t('In the game today', 'ในเกมตอนนี้')}">
    <div><b>${nHeroes}</b><span>${t('heroes', 'ฮีโร่')}</span></div>
    <div><b>${nSkills}</b><span>${t('skills', 'สกิล')}</span></div>
    <div><b>${nRelics}</b><span>${t('relics', 'เรลิก')}</span></div>
    <div><b>${WIN_TARGET}</b><span>${t('wins to clear a run', 'ชนะเพื่อผ่าน run')}</span></div>
  </section>

  <section id="how" class="sec">
    <h2>${t('How it works', 'เล่นยังไง')}</h2>
    <div class="steps">
      <article><img src="${IMG}shot-shop.webp" alt="" loading="lazy" width="800" height="450"><h3><i>1</i>${t('Draft', 'จัดบิลด์')}</h3><p>${t(`Pick 1 of 3 heroes, then buy and upgrade skills from ${nSkills} that chain and combo.`, `เลือกฮีโร่ 1 จาก 3 ตัว แล้วซื้อและอัปสกิลจาก ${nSkills} แบบที่ต่อคอมโบกันได้`)}</p></article>
      <article><img src="${IMG}shot-fight.webp" alt="" loading="lazy" width="800" height="450"><h3><i>2</i>${t('It fights for you', 'มันสู้แทนคุณ')}</h3><p>${t('Your build battles another player’s build on its own. Watch the combos land, then tweak.', 'บิลด์ของคุณสู้กับบิลด์ของผู้เล่นอื่นเอง ดูคอมโบออก แล้วปรับต่อ')}</p></article>
      <article><img src="${IMG}shot-win.webp" alt="" loading="lazy" width="800" height="450"><h3><i>3</i>${t(`Climb to ${WIN_TARGET} wins`, `ไต่ให้ถึง ${WIN_TARGET} ชนะ`)}</h3><p>${t('Short runs, phone or desktop. Share a replay of your best fight with a link.', 'run สั้น เล่นได้ทั้งมือถือและคอม แชร์ replay ไฟต์ที่ดีที่สุดได้ด้วยลิงก์')}</p></article>
    </div>
  </section>

  <section class="sec watch">
    <div class="short">
      <iframe src="https://www.youtube-nocookie.com/embed/${SHORT[lang]}" title="Mochi Moon in 14 seconds" loading="lazy" allow="encrypted-media; picture-in-picture" allowfullscreen></iframe>
    </div>
    <div class="watch-text">
      <h2>${t('See it in 14 seconds', 'ดูเกมใน 14 วินาที')}</h2>
      <p>${t('Then watch our weekly build updates: what we shipped, what broke and what is next.', 'แล้วตามดูอัปเดตรายสัปดาห์: ทำอะไรเสร็จ อะไรพัง และจะทำอะไรต่อ')}</p>
      <a class="update-card" href="${LINKS.week1}" target="_blank" rel="noopener"><img src="${IMG}week1-cover.webp" alt="" loading="lazy" width="640" height="360"><span>▶ ${t('Week 1 update: foundations + data', 'อัปเดต week 1: วางระบบ + ข้อมูล')}</span></a>
      <a class="btn btn-ghost btn-sm" href="${LINKS.youtube}" target="_blank" rel="noopener">YouTube @mochimoongame</a>
    </div>
  </section>

  <section class="sec onchain">
    <div class="onchain-art" style="background-image:url(${IMG}key-seal.webp)"></div>
    <div class="onchain-in">
      <p class="kicker">${t('Why onchain', 'ทำไมต้อง onchain')}</p>
      <h2>${t('Fights anyone can verify', 'ไฟต์ที่ใครก็ตรวจสอบได้')}</h2>
      <p>${t(
        'Combat is deterministic, so a fight is just builds + a seed. Our onchain version runs the whole run on Solana inside a MagicBlock private ephemeral rollup: rivals cannot peek at your build, and season results land on Solana. It is a devnet prototype today; it is not on this public server yet.',
        'การต่อสู้เป็น deterministic ไฟต์หนึ่งจึงเท่ากับบิลด์ + seed เวอร์ชัน onchain ของเรารันทั้ง run บน Solana ใน MagicBlock private ephemeral rollup คู่แข่งแอบดูบิลด์คุณไม่ได้ และผลประจำ season ลงบน Solana ตอนนี้ยังเป็น prototype บน devnet และยังไม่ได้ขึ้นเซิร์ฟเวอร์สาธารณะนี้',
      )}</p>
    </div>
  </section>

  <section id="roadmap" class="sec">
    <h2>${t('Roadmap', 'แผนงาน')}</h2>
    <div class="road">
      <article class="done"><h3><em>${t('Built', 'ทำแล้ว')}</em>${t('Week 1', 'สัปดาห์ที่ 1')}</h3>${list(DONE)}</article>
      <article class="now"><h3><em>${t('In progress', 'กำลังทำ')}</em>${t('Week 2', 'สัปดาห์ที่ 2')}</h3>${list(NOW)}</article>
      <article class="next"><h3><em>${t('Planned', 'แผน')}</em>${t('Next', 'ถัดไป')}</h3>${list(NEXT)}</article>
    </div>
    <p class="never">${t('Never: a game token, wagering, loot boxes or paid combat power.', 'ไม่มีวัน: เหรียญเกม การพนัน กล่องสุ่ม หรือการจ่ายเงินซื้อพลังต่อสู้')}</p>
  </section>

  <section id="join" class="sec join">
    <div>
      <h2>${t('Join the waitlist', 'ลงชื่อรอข่าว')}</h2>
      <p>${t('Get the public playtest news, the onchain launch and season start. One message per milestone, no spam.', 'รับข่าวการเปิดทดสอบ การเปิดเวอร์ชัน onchain และการเริ่ม season แจ้งเฉพาะตอนมีความคืบหน้า ไม่สแปม')}</p>
      <p class="fine">${t('Or just', 'หรือ')} <button type="button" class="linkish" data-feedback>${t('send us feedback', 'ส่งความเห็นถึงเรา')}</button>.</p>
    </div>
    <form class="wait" novalidate>
      <label>Telegram<input name="telegram" autocomplete="off" placeholder="@username" maxlength="40"></label>
      <label>X<input name="x" autocomplete="off" placeholder="@handle" maxlength="20"></label>
      <label>${t('Email (optional)', 'อีเมล (ไม่บังคับ)')}<input name="email" type="email" autocomplete="email" placeholder="you@mail.com" maxlength="254"></label>
      <label>${t('Solana wallet (optional)', 'Solana wallet (ไม่บังคับ)')}<input name="wallet" autocomplete="off" placeholder="${t('for future drops', 'ไว้รับของในอนาคต')}" maxlength="50"></label>
      <input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
      <label class="check"><input type="checkbox" name="consent"> ${t('Contact me about Mochi Moon. I can ask to be removed any time.', 'ติดต่อฉันเรื่อง Mochi Moon ได้ ขอให้ลบออกได้ทุกเมื่อ')}</label>
      <button class="btn btn-gold" type="submit">${t('Count me in', 'ลงชื่อเลย')}</button>
      <p class="msg" role="status"></p>
    </form>
  </section>

  <section id="faq" class="sec faq">
    <h2>FAQ</h2>
    ${[
      [t('Is it free?', 'เล่นฟรีไหม?'), t('Yes. The prototype is free, with no login and no wallet.', 'ฟรี prototype เล่นได้เลย ไม่ต้องล็อกอิน ไม่ต้องมี wallet')],
      [t('Do I need a crypto wallet?', 'ต้องมี wallet คริปโตไหม?'), t('Not to play. The onchain version (in testing on devnet) uses Phantom with a session key, so you do not sign every move.', 'ไม่ต้องก็เล่นได้ เวอร์ชัน onchain (กำลังทดสอบบน devnet) ใช้ Phantom กับ session key จึงไม่ต้องกดยืนยันทุกตา')],
      [t('Is there a token?', 'มีเหรียญไหม?'), t('No. No token, no loot boxes, no pay-to-win.', 'ไม่มี ไม่มีเหรียญ ไม่มีกล่องสุ่ม ไม่มี pay-to-win')],
      [t('Does it work on my phone?', 'เล่นบนมือถือได้ไหม?'), t('Yes, in the browser on phone and desktop.', 'ได้ เล่นผ่านเบราว์เซอร์ทั้งมือถือและคอม')],
      [t('Where is my progress saved?', 'ความคืบหน้าเก็บไว้ที่ไหน?'), t('Your player and runs are tied to this browser, and your finished runs are on our server for the leaderboard.', 'ผู้เล่นและ run ผูกกับเบราว์เซอร์นี้ และ run ที่จบแล้วเก็บบนเซิร์ฟเวอร์เพื่อทำ leaderboard')],
    ]
      .map(([q, a]) => `<details><summary>${q}</summary><p>${a}</p></details>`)
      .join('')}
  </section>

  <section class="sec final">
    <h2>${t('Ready to draft?', 'พร้อมจัดบิลด์หรือยัง?')}</h2>
    <a class="btn btn-gold" href="/play" data-play="final">▶ ${t('Play free now', 'เล่นฟรีเลย')}</a>
  </section>

  <footer class="foot">
    <img src="/assets/img/logo.webp" alt="" width="110" height="52">
    <div class="foot-links">
      <a href="${LINKS.youtube}" target="_blank" rel="noopener">YouTube</a>
      <a href="${LINKS.x}" target="_blank" rel="noopener">X @tenny2201</a>
      <a href="${LINKS.telegram}" target="_blank" rel="noopener">Telegram @ten852456</a>
      <button type="button" class="linkish" data-feedback>${t('Feedback', 'ส่งความเห็น')}</button>
    </div>
    <p class="fine">${t('Built for Solana · prototype, numbers come straight from the game code', 'สร้างเพื่อ Solana · prototype ตัวเลขทุกตัวมาจากโค้ดเกมโดยตรง')}</p>
  </footer>`;
  bind(root);
}

function bind(root: HTMLElement) {
  for (const b of root.querySelectorAll<HTMLButtonElement>('[data-lang]')) {
    b.addEventListener('click', () => {
      lang = b.dataset.lang === 'th' ? 'th' : 'en';
      setLangValue(lang);
      try {
        localStorage.setItem(LANG_KEY, lang); // the game follows the same choice
      } catch {
        /* fine */
      }
      render();
    });
  }
  for (const a of root.querySelectorAll<HTMLAnchorElement>('[data-play]')) {
    a.addEventListener('click', () => track('play_click', { src: a.dataset.play, lang }));
  }
  for (const b of root.querySelectorAll<HTMLButtonElement>('[data-feedback]')) {
    b.addEventListener('click', () => openFeedback({ screen: 'landing' }));
  }
  const form = root.querySelector<HTMLFormElement>('form.wait')!;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const msg = form.querySelector<HTMLElement>('.msg')!;
    const val = (k: string) => String(f.get(k) ?? '').trim();
    if (!val('telegram') && !val('x') && !val('email')) {
      msg.textContent = t('Add your Telegram, X or email.', 'ใส่ Telegram, X หรืออีเมลอย่างน้อยหนึ่งช่อง');
      return;
    }
    if (!f.get('consent')) {
      msg.textContent = t('Tick the box so we can contact you.', 'ติ๊กช่องยินยอมก่อนนะ');
      return;
    }
    const btn = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
    btn.disabled = true;
    msg.textContent = '';
    try {
      const r = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          telegram: val('telegram'), x: val('x'), email: val('email'), wallet: val('wallet'), hp: val('website'),
          consent: true, lang, src: 'landing', v: visitorId(),
        }),
      });
      if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error || 'error');
      form.innerHTML = `<div class="joined"><b>${t('You are on the list! 🌙', 'ลงชื่อเรียบร้อย! 🌙')}</b><span>${t('We will message you at each milestone.', 'เราจะแจ้งเมื่อมีความคืบหน้าสำคัญ')}</span><a class="btn btn-gold btn-sm" href="/play" data-play="joined">▶ ${t('Play while you wait', 'เล่นระหว่างรอ')}</a></div>`;
    } catch (err) {
      btn.disabled = false;
      msg.textContent = t('Could not sign you up: ', 'ลงชื่อไม่สำเร็จ: ') + (err as Error).message;
    }
  });
}

if (!location.search) {
  setLangValue(lang);
  render();
  track('landing_view', { lang });
}
