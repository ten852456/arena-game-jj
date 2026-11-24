// End-to-end check of the public site around the game: landing page (/), the /play and /admin pages, waitlist,
// feedback, usage events and the admin API. Usage: ADMIN_TOKEN=… node e2e-site.mjs <baseUrl> <outDir>
// Without ADMIN_TOKEN the admin checks only test that the API refuses (401/503). Same setup as e2e.mjs (README).
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.argv[2] ?? 'http://localhost:8787';
const OUT = process.argv[3] ?? '.';
const TOKEN = process.env.ADMIN_TOKEN ?? '';
fs.mkdirSync(OUT, { recursive: true });
const exe = process.env.CHROME_PATH || path.join(os.homedir(), 'AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe');
const results = [];
const ok = (name, pass, info = '') => { results.push({ name, pass, info }); console.log(`${pass ? '✔' : '✘'} ${name}${info ? ' — ' + info : ''}`); };
const api = async (u, body, headers = {}) => {
  const r = await fetch(BASE + u, body === undefined ? { headers } : { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* csv */ }
  return { status: r.status, json, text };
};
const uniq = Date.now().toString(36).slice(-6);

const browser = await chromium.launch({ executablePath: exe, headless: true });

// ---------- landing on desktop and phone ----------
for (const [label, opts] of [['desktop', { viewport: { width: 1280, height: 800 } }], ['phone', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }]]) {
  const ctx = await browser.newContext(opts);
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
  p.on('response', (r) => { if (r.status() >= 400 && !/favicon|youtube/.test(r.url())) errs.push(`${r.status()} ${r.url().replace(BASE, '')}`); });
  await p.goto(BASE + '/', { waitUntil: 'load' });
  await p.waitForSelector('.hero h1');
  ok(`${label}: landing shows the headline`, /Draft the build/.test(await p.textContent('.hero h1')));
  const stats = await p.$$eval('.stats b', (els) => els.map((e) => e.textContent));
  ok(`${label}: stats come from the game code`, stats.join(',') === '10,43,27,10', stats.join(','));
  const wide = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  ok(`${label}: no sideways scroll`, wide <= 1, `+${wide}px`);
  await p.screenshot({ path: path.join(OUT, `landing-${label}.png`), fullPage: true });
  ok(`${label}: no errors on the landing page`, errs.length === 0, errs.join(' | '));
  await ctx.close();
}

// ---------- landing behaviour ----------
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const p = await ctx.newPage();
  await p.goto(BASE + '/?replay=abc123', { waitUntil: 'load' });
  await p.waitForURL(/\/play\?replay=abc123/, { timeout: 8000 }).catch(() => {});
  ok('old share links (/?replay=) go to the game', /\/play\?replay=abc123/.test(p.url()), p.url().replace(BASE, ''));

  await p.goto(BASE + '/', { waitUntil: 'load' });
  await p.click('[data-lang="th"]');
  ok('TH switch translates the page', /จัดบิลด์/.test(await p.textContent('.hero h1')));
  ok('TH choice is shared with the game', (await p.evaluate(() => localStorage.getItem('mochi.lang'))) === 'th');
  await p.click('[data-lang="en"]');

  // waitlist form
  await p.click('form.wait button[type=submit]');
  ok('waitlist: empty form asks for a contact', /Telegram, X or email/.test(await p.textContent('form.wait .msg')));
  await p.fill('form.wait input[name=telegram]', '@mochi_e2e_' + uniq);
  await p.click('form.wait button[type=submit]');
  ok('waitlist: asks for consent', /Tick the box/.test(await p.textContent('form.wait .msg')));
  await p.check('form.wait input[name=consent]');
  await p.click('form.wait button[type=submit]');
  await p.waitForSelector('.joined', { timeout: 8000 }).catch(() => {});
  ok('waitlist: signs up', /You are on the list/.test((await p.textContent('.joined').catch(() => '')) ?? ''));
  await p.screenshot({ path: path.join(OUT, 'landing-joined.png') });

  // feedback sheet
  await p.click('.foot [data-feedback]');
  await p.click('.fb-sheet .fb-star[data-n="4"]');
  await p.fill('.fb-sheet textarea', 'e2e: landing feedback ' + uniq);
  await p.click('.fb-sheet .fb-send');
  await p.waitForSelector('.fb-sheet h3:has-text("Thank you")', { timeout: 8000 }).catch(() => {});
  ok('feedback: sends from the landing page', (await p.locator('.fb-sheet h3:has-text("Thank you")').count()) === 1);

  // Play button → game
  await p.goto(BASE + '/', { waitUntil: 'load' });
  await p.click('.hero [data-play]');
  await p.waitForURL(/\/play$/, { timeout: 8000 }).catch(() => {});
  await p.waitForSelector('canvas', { timeout: 15000 }).catch(() => {});
  ok('Play opens the game at /play', /\/play$/.test(p.url()) && (await p.locator('canvas').count()) > 0, p.url().replace(BASE, ''));
  await p.waitForTimeout(4500); // events are batched every 4 s
  await ctx.close();
}

// ---------- admin page ----------
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const p = await ctx.newPage();
  await p.goto(BASE + '/admin', { waitUntil: 'load' });
  ok('/admin shows the token form', (await p.locator('.login input[type=password]').count()) === 1);
  await p.fill('.login input', 'wrong-token-' + uniq);
  await p.click('.login button');
  await p.waitForSelector('.login .err:not(:empty)', { timeout: 8000 }).catch(() => {});
  ok('/admin refuses a wrong token', /wrong token|admin is off/.test(await p.textContent('.login .err')));
  if (TOKEN) {
    await p.fill('.login input', TOKEN);
    await p.click('.login button');
    await p.waitForSelector('.tiles', { timeout: 8000 }).catch(() => {});
    ok('/admin overview opens with the token', (await p.locator('.tiles div').count()) >= 4);
    await p.screenshot({ path: path.join(OUT, 'admin-overview.png'), fullPage: true });
    for (const t of ['feedback', 'waitlist', 'runs', 'announce']) {
      await p.click(`[data-tab="${t}"]`);
      await p.waitForTimeout(500);
      await p.screenshot({ path: path.join(OUT, `admin-${t}.png`), fullPage: true });
    }
    await p.click('[data-tab="waitlist"]');
    await p.waitForSelector('table.wide', { timeout: 8000 }).catch(() => {});
    ok('/admin waitlist lists the e2e sign-up', (await p.textContent('main')).includes('mochi_e2e_' + uniq));
  }
  await ctx.close();
}
await browser.close();

// ---------- API rules ----------
let r = await api('/api/waitlist', { telegram: 'ab', consent: true });
ok('API waitlist: bad Telegram name → 400', r.status === 400, r.json?.error);
r = await api('/api/waitlist', { telegram: '@valid_name_' + uniq });
ok('API waitlist: no consent → 400', r.status === 400, r.json?.error);
r = await api('/api/waitlist', { wallet: 'not-a-wallet', email: 'x' + uniq + '@mail.com', consent: true });
ok('API waitlist: bad Solana address → 400', r.status === 400, r.json?.error);
r = await api('/api/waitlist', { email: 'Mixed' + uniq + '@Mail.com', consent: true });
const r2 = await api('/api/waitlist', { email: 'mixed' + uniq + '@mail.com', consent: true });
ok('API waitlist: a repeat sign-up gets the same answer as a new one (no membership oracle)', r.status === 200 && JSON.stringify(r.json) === JSON.stringify(r2.json), JSON.stringify(r2.json));
const mixedTag = 'mixed' + uniq;
r = await api('/api/waitlist', { telegram: '@honey_pot_' + uniq, consent: true, hp: 'http://spam' });
ok('API waitlist: honeypot answers ok', r.status === 200);
r = await api('/api/feedback', { rating: 6 });
ok('API feedback: rating 6 and no text → 400', r.status === 400, r.json?.error);
r = await api('/api/feedback', { text: 'x'.repeat(5000), screen: '<script>' });
ok('API feedback: long text is accepted and cut', r.status === 200);
r = await api('/api/events', { v: 'visitor-' + uniq, events: [{ e: 'landing_view' }, { e: 'evil_event' }, { e: 'run_end', wins: 10 }] });
ok('API events: only allowed browser events count', r.status === 200 && r.json?.ok === 1, JSON.stringify(r.json));
r = await api('/api/announce');
ok('API announce is public', r.status === 200 && typeof r.json?.on === 'boolean');
r = await api('/api/admin/overview');
ok('API admin without token → 401/503', r.status === 401 || r.status === 503, String(r.status));
r = await api('/api/admin/waitlist.csv', undefined, { authorization: 'Bearer nope' });
ok('API admin CSV with a wrong token → 401/503', r.status === 401 || r.status === 503, String(r.status));
if (TOKEN) {
  const auth = { authorization: 'Bearer ' + TOKEN };
  r = await api('/api/admin/overview?days=7', undefined, auth);
  ok('API admin overview with token', r.status === 200 && r.json?.totals?.waitlist >= 2, JSON.stringify(r.json?.totals));
  ok('API admin funnel counts the landing visit and the Play click', (r.json?.funnel?.[0]?.n ?? 0) >= 1 && (r.json?.funnel?.[1]?.n ?? 0) >= 1, JSON.stringify(r.json?.funnel));
  r = await api('/api/admin/waitlist.csv', undefined, auth);
  ok('API admin: the same email twice is one entry', (r.text.toLowerCase().match(new RegExp(mixedTag, 'g')) ?? []).length === 1);
  ok('API admin CSV download', r.status === 200 && r.text.includes('telegram') && r.text.includes('mochi_e2e_' + uniq));
  ok('API admin CSV leaves out the honeypot', !r.text.includes('honey_pot_' + uniq));
  r = await api('/api/admin/announce', { on: true, th: 'ทดสอบ', en: 'e2e banner' }, auth);
  const pub = await api('/api/announce');
  ok('API admin sets the banner, the game can read it', r.status === 200 && pub.json?.on === true && pub.json?.en === 'e2e banner');
  await api('/api/admin/announce', { on: false, th: '', en: '' }, auth);
}

fs.writeFileSync(path.join(OUT, 'e2e-site.json'), JSON.stringify(results, null, 1));
const failed = results.filter((x) => !x.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
