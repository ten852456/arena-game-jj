// End-of-run screen checks + screenshots (win and loss, TH and EN, 1280x720 / 844x390 / 390x844).
// A real run is started through the UI, then its saved state is turned into a finished run and the page reloaded
// (the town's arena card then offers the finished run's results). The stardust reward call is answered by a stub so the reveal has numbers.
// Usage: node e2e-re-end.mjs <baseUrl> <outDir>
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.argv[2] ?? 'http://localhost:8787';
const OUT = process.argv[3] ?? '.';
fs.mkdirSync(OUT, { recursive: true });
const exe = process.env.CHROME_PATH || path.join(os.homedir(), 'AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe');
const results = [];
const ok = (name, pass, info = '') => { results.push({ name, pass, info }); console.log(`${pass ? '✔' : '✘'} ${name}${info ? ' — ' + info : ''}`); };

const VIEWS = {
  pc: { viewport: { width: 1280, height: 720 } },
  phoneL: { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true },
  phoneP: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
};

/** Start a run through the UI, then rewrite it as finished (won 10–2, or lost 7–5 with a close last fight). */
async function finishedRun(p, won, lang) {
  const tap = async (sel, wait = 600) => { const l = p.locator(sel).first(); if (await l.count()) { await l.click({ timeout: 4000 }).catch(() => {}); await p.waitForTimeout(wait); return true; } return false; };
  await p.goto(BASE, { waitUntil: 'load' });
  await p.waitForTimeout(1300);
  await tap('.gd-skip');
  if (lang === 'en') await tap('[data-lang="en"]', 400);
  await tap('[data-a="goto"][data-i="arena"]');
  await tap('[data-a="enterArena"]', 900);
  await tap('[data-a="start"]', 900);
  await p.evaluate(({ won }) => {
    const k = 'arena.run.v7';
    const r = JSON.parse(localStorage.getItem(k));
    const res = won ? [1, 1, 0, 1, 1, 1, 1, 0, 1, 1, 1, 1] : [1, 0, 1, 1, 1, 0, 1, 0, 1, 1, 0, 0];
    r.log = res.map((w, i) => ({ day: i + 1, won: !!w, opp: w ? `Mochi-${4100 + i}` : `Mochi-${5200 + i}`, ai: false }));
    r.wins = res.filter(Boolean).length; r.losses = res.length - r.wins; r.day = res.length;
    r.phase = won ? 'won' : 'dead'; r.hp = won ? 9 : 0; r.ghost = !won; r.rating = won ? 1342 : 1188;
    localStorage.setItem(k, JSON.stringify(r));
    const notes = r.log.map((l) => ({ day: l.day, won: l.won, opp: l.opp, close: l.day === 12, score: l.day, text: `วันที่ ${l.day}`, textEn: `Day ${l.day}`, hit: 40 + l.day * 7 }));
    const last = notes.at(-1);
    if (!won) Object.assign(last, {
      why: 'โล่ของ Mochi-5211 กันดาเมจคุณไป 212 (41%)', whyEn: 'The shield of Mochi-5211 blocked 212 of your damage (41%)',
      tip: 'ใช้ skill ที่ทะลุโล่ หรือ ตีทีเดียวแรง', tipEn: 'use a shield-piercing skill, or one big hit',
    });
    localStorage.setItem(`mochi.fights.${r.id}`, JSON.stringify(notes));
    // an earlier run on this device: best 5 wins, so 7 is a new best
    localStorage.setItem('mochi.records.v1', JSON.stringify({ runs: 3, bestWins: 5, bestStreak: 3, bigHit: 90, crowns: 0, flawless: 0, heroes: [r.hero], crowned: [] }));
  }, { won });
  await p.route('**/api/run/finish', async (route) => {
    await new Promise((r) => setTimeout(r, 300));
    const stardust = won ? 160 : 80;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ already: false, reward: { stardust }, player: { stardust: 170 + stardust, runs: 4, best: { wins: won ? 10 : 7 } } }) });
  });
  await p.reload({ waitUntil: 'load' });
  await p.waitForTimeout(1200);
  // a reload lands in the town; the arena keeps the finished run's results one tap away
  await tap('[data-a="goto"][data-i="arena"]', 400);
  const btn = await p.locator('[data-a="lastResults"]').count();
  await tap('[data-a="lastResults"]', 0);
  await p.waitForSelector('.re-wrap', { timeout: 8000 }).catch(() => {});
  return btn > 0;
}

async function scenario(view, lang, won, opts = {}) {
  const label = `${won ? 'win' : 'loss'}-${lang}-${view}${opts.reduced ? '-reduced' : ''}`;
  const browser = await chromium.launch({ executablePath: exe, headless: true });
  const ctx = await browser.newContext({ ...VIEWS[view], locale: 'th-TH', ...(opts.reduced ? { reducedMotion: 'reduce' } : {}) });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
  p.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) errs.push(m.text().slice(0, 200)); });
  const has = async (sel) => (await p.locator(sel).count()) > 0;
  const text = async () => (await p.locator('#panel').innerText().catch(() => '')).replace(/\s+/g, ' ');
  const shot = (n) => p.screenshot({ path: path.join(OUT, `${label}-${n}.png`) });
  const viaTown = await finishedRun(p, won, lang);
  ok(`${label}: after a reload the town offers the last run's results`, viaTown);
  ok(`${label}: end screen opens for a finished run`, await has('.re-wrap'));
  if (opts.reduced) {
    ok(`${label}: reduced motion shows everything at once`, !(await has('.re-wrap.re-on')));
  } else if (!opts.skip) {
    ok(`${label}: staged reveal is running`, await has('.re-wrap.re-on'));
    await p.waitForTimeout(won ? 900 : 500);
    await shot('mid');
  }
  if (opts.skip) {
    await p.waitForTimeout(250);
    await p.locator('.mm-over .mm-over-sub').click({ force: true }).catch(() => {});
    await p.waitForTimeout(150);
    ok(`${label}: a tap skips the reveal`, !(await has('.re-wrap.re-on')));
    await p.waitForTimeout(500);
    ok(`${label}: numbers are final after the skip`, (await p.locator('.mm-statgrid b').first().innerText()) === (won ? '10' : '7'));
  }
  await p.waitForTimeout(won ? 3600 : 2600);
  ok(`${label}: reveal ends`, !(await has('.re-wrap.re-on')));
  const t = await text();
  const m = await p.evaluate(() => ({ sh: document.documentElement.scrollHeight, ih: innerHeight, sw: document.documentElement.scrollWidth, iw: innerWidth }));
  ok(`${label}: fits one screen (no page scroll)`, m.sh <= m.ih + 2 && m.sw <= m.iw + 1, `${m.sh}/${m.ih} tall, ${m.sw}/${m.iw} wide`);
  const again = await p.locator('.re-again').boundingBox();
  ok(`${label}: "play again" is on screen without scrolling`, !!again && again.y >= 0 && again.y + again.height <= m.ih + 1, again ? `y ${Math.round(again.y)}–${Math.round(again.y + again.height)}` : 'missing');
  ok(`${label}: stars filled = wins`, (await p.locator('.re-star.on').count()) === (won ? 10 : 7) && (await p.locator('.re-star').count()) === 10);
  ok(`${label}: stardust counted up to the reward`, (lang === 'en' ? /\+\s*(160|80)\s*stardust/ : /\+\s*(160|80)\s*ผงดาว/).test(t), t.match(/\+\s*\d+\s*\S+/)?.[0]);
  ok(`${label}: stardust total + next title bar`, (await has('.re-bar i')) && (lang === 'en' ? /more stardust to/ : /ผงดาว ได้ฉายา/).test(t));
  ok(`${label}: next goal line`, (lang === 'en' ? /Next goal:/ : /เป้าต่อไป:/).test(t), (await p.locator('.re-goal').innerText().catch(() => '')).trim());
  ok(`${label}: quick start offers 3 heroes`, (await p.locator('.re-hero[data-a="start"]').count()) === 3);
  if (won) {
    ok(`${label}: crown on the hero`, await p.locator('.re-crown').isVisible());
    ok(`${label}: first crown record`, (lang === 'en' ? /Your first crown!/ : /มงกุฎแรกของคุณ!/).test(t));
    ok(`${label}: build defends the moon`, (lang === 'en' ? /defends the moon/ : /เฝ้าดวงจันทร์/).test(t));
    await p.waitForSelector('.re-card img', { timeout: 6000 }).catch(() => {});
    const img = await p.locator('.re-card img').evaluate((e) => ({ w: e.naturalWidth, h: e.naturalHeight })).catch(() => null);
    ok(`${label}: share card PNG rendered`, !!img && img.w === 1200 && img.h === 675, JSON.stringify(img));
    if (view === 'pc' && lang === 'en') {
      const dl = p.waitForEvent('download', { timeout: 5000 }).catch(() => null);
      await p.locator('[data-a="saveCard"]').click();
      const d = await dl;
      if (d) await d.saveAs(path.join(OUT, `${label}-card.png`));
      ok(`${label}: "save image" downloads the card`, !!d && /\.png$/.test(d.suggestedFilename()), d?.suggestedFilename());
    }
  } else {
    ok(`${label}: near-miss line`, (lang === 'en' ? /Only 3 wins from the moon crown/ : /อีกแค่ 3 ชนะ/).test(t));
    ok(`${label}: new personal best`, (lang === 'en' ? /New best: 7 wins!/ : /สถิติใหม่: ชนะ 7!/).test(t));
    ok(`${label}: what ended the run + one tip`, (await has('.re-ended .re-tip')) && (lang === 'en' ? /shield-piercing/ : /ทะลุโล่/).test(t));
    ok(`${label}: close last fight called out`, await has('.re-close'));
  }
  await shot('final');
  ok(`${label}: no emoji left`, !(await p.evaluate(() => /[\u{1F300}-\u{1FAFF}]/u.test(document.body.innerText))));
  // leaving: Enter → hero pick (desktop), quick hero → shop (phones)
  if (view === 'pc' && !opts.reduced) {
    // focus may sit on "save image" (clicked above): R works from anywhere, Enter when no other button has focus
    const key = view === 'pc' && lang === 'en' && won ? 'r' : 'Enter';
    await p.keyboard.press(key);
    await p.waitForTimeout(700);
    ok(`${label}: ${key} goes straight to a fresh hero pick`, (await p.locator('.pick [data-a="start"]').count()) === 3);
  } else if (!opts.reduced) {
    const id = await p.locator('.re-hero').first().getAttribute('data-i');
    await p.locator('.re-hero').first().click();
    await p.waitForTimeout(900);
    const hero = await p.evaluate(() => JSON.parse(localStorage.getItem('arena.run.v7') || '{}'));
    ok(`${label}: one tap on a hero starts the next run`, (await has('.shopv')) && hero.hero === id && hero.phase === 'shop' && hero.wins === 0, `${id} → ${hero.hero}`);
  }
  ok(`${label}: no page/console errors`, errs.length === 0, errs.slice(0, 3).join(' | '));
  await browser.close();
}

for (const lang of ['th', 'en']) for (const view of ['pc', 'phoneL']) for (const won of [true, false]) await scenario(view, lang, won);
await scenario('phoneP', 'th', true);
await scenario('phoneP', 'en', false);
await scenario('pc', 'th', false, { skip: true });
await scenario('pc', 'en', true, { reduced: true });
const failed = results.filter((r) => !r.pass);
fs.writeFileSync(path.join(OUT, 'e2e-re-end.json'), JSON.stringify(results, null, 1));
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.log('FAILED:\n' + failed.map((f) => `  ${f.name} — ${f.info}`).join('\n')); process.exitCode = 1; }
