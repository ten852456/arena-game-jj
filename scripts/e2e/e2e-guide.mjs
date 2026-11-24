// End-to-end check of the guided tutorial and the clickable town map. Usage: node e2e-guide.mjs <baseUrl> <outDir>
// 1. plays the guide end to end (desktop 1280x720 mouse, phone landscape 844x390 touch, phone portrait 390x844 touch),
//    screenshots every step and checks the spotlight, the click blocking, the easy first fight and the "why" step;
// 2. skips it (button on the first card, and Esc from the "? How to play" menu);
// 3. town map: dragging scrolls without selecting, tapping the selected arena enters it.
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

async function open(ctxOpts, lang = 'th-TH') {
  const browser = await chromium.launch({ executablePath: exe, headless: true });
  const ctx = await browser.newContext({ ...ctxOpts, locale: lang });
  // the post-run rating sheet (feedback.ts) is tested on its own: keep it from covering the screens checked here
  await ctx.addInitScript(() => localStorage.setItem('mochi.fb.asked', String(Date.now())));
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
  p.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) errs.push(m.text().slice(0, 200)); });
  await p.goto(BASE + '/play', { waitUntil: 'load' });
  await p.waitForTimeout(1500);
  return { browser, p, errs };
}
const stepOf = (p) => p.evaluate(() => document.querySelector('.gd-root')?.getAttribute('data-step') ?? null);
const holeBox = (p) => p.locator('.gd-hole').boundingBox();
/** tap/click at a point (touch on phones) */
async function tapAt(p, touch, x, y) {
  if (touch) await p.touchscreen.tap(x, y);
  else await p.mouse.click(x, y);
}
async function waitStep(p, id, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if ((await stepOf(p)) === id) { await p.waitForTimeout(450); return true; }
    await p.waitForTimeout(100);
  }
  return false;
}
/** the bubble must not cover the spotlighted target */
async function bubbleClear(p, retry = 2) {
  const h = await holeBox(p), b = await p.locator('.gd-bubble').boundingBox();
  if (!h || !b || h.width < 4) return true;
  const ix = Math.max(0, Math.min(h.x + h.width, b.x + b.width) - Math.max(h.x, b.x));
  const iy = Math.max(0, Math.min(h.y + h.height, b.y + b.height) - Math.max(h.y, b.y));
  if (ix * iy >= 0.15 * h.width * h.height && retry > 0) { await p.waitForTimeout(500); return bubbleClear(p, retry - 1); } // layout still settling
  if (ix * iy >= 0.15 * h.width * h.height) console.log('   overlap', JSON.stringify({ h, b }));
  return ix * iy < 0.15 * h.width * h.height;
}
/** click the Buy button of the shop card inside the spotlight */
async function buySpotlit(p, touch) {
  const h = await holeBox(p);
  const i = await p.evaluate((h) => {
    const cards = [...document.querySelectorAll('.card.offer')];
    return cards.findIndex((c) => { const r = c.getBoundingClientRect(); const cx = r.left + r.width / 2, cy = r.top + r.height / 2; return cx > h.x && cx < h.x + h.width && cy > h.y && cy < h.y + h.height; });
  }, h);
  if (i < 0) return null;
  const card = p.locator('.card.offer').nth(i);
  const name = (await card.locator('.offer-name').innerText()).trim();
  const bb = await card.locator('[data-a="buy"]').boundingBox();
  await tapAt(p, touch, bb.x + bb.width / 2, bb.y + bb.height / 2);
  await p.waitForTimeout(500);
  return name;
}

async function playGuide(label, ctxOpts, lang = 'th-TH') {
  const touch = !!ctxOpts.hasTouch;
  const { browser, p, errs } = await open(ctxOpts, lang);
  const shot = (n) => p.screenshot({ path: path.join(OUT, `guide-${label}-${n}.png`) });
  const t0 = Date.now();
  ok(`${label}: guide is offered on the first visit`, (await stepOf(p)) === 'welcome');
  ok(`${label}: skip button visible on the first card`, await p.locator('.gd-skip').isVisible());
  await shot('1-welcome');
  await p.locator('.gd-next').click();

  ok(`${label}: step town`, await waitStep(p, 'town'));
  await p.waitForTimeout(500); // camera glides to the arena
  await shot('2-town');
  ok(`${label}: town spotlight clear of the bubble`, await bubbleClear(p));
  ok(`${label}: skip button visible (town)`, await p.locator('.gd-skip').isVisible());
  // a click outside the hole does nothing (the Hero Hall chip)
  const chip = await p.locator('[data-a="goto"][data-i="hall"]').boundingBox();
  const h1 = await holeBox(p);
  if (chip && !(chip.x > h1.x && chip.x < h1.x + h1.width && chip.y > h1.y && chip.y < h1.y + h1.height)) {
    await tapAt(p, touch, chip.x + chip.width / 2, chip.y + chip.height / 2);
    await p.waitForTimeout(300);
    ok(`${label}: clicks outside the spotlight are blocked`, !(await p.locator('[data-a="goto"][data-i="hall"].on').count()));
  }
  {
    const h = await holeBox(p);
    // the arena building's lower part (the hole may also hold the Enter bubble above it)
    await tapAt(p, touch, h.x + h.width / 2, h.y + h.height * 0.72);
  }
  ok(`${label}: tapping the spotlit arena opens the hero pick`, await waitStep(p, 'hero'));
  await shot('3-hero');
  ok(`${label}: hero spotlight clear of the bubble`, await bubbleClear(p));
  {
    // tap the card's "start with this hero" button: on a portrait phone the sticky arena strip can cover the card's top
    const go = p.locator('[data-a="start"]').first().locator('.hero-go');
    await go.scrollIntoViewIfNeeded();
    await p.waitForTimeout(300);
    const b = await go.boundingBox();
    await tapAt(p, touch, b.x + b.width / 2, b.y + b.height / 2);
  }
  ok(`${label}: step buy1 (shop)`, await waitStep(p, 'buy1'));
  await shot('4-buy1');
  ok(`${label}: buy1 spotlight clear of the bubble`, await bubbleClear(p));
  const n1 = await buySpotlit(p, touch);
  ok(`${label}: bought the first spotlit skill`, !!n1 && (await p.locator('.skillrow[data-i]').count()) === 1, n1 ?? '');
  ok(`${label}: step buy2`, await waitStep(p, 'buy2'));
  await shot('5-buy2');
  ok(`${label}: buy2 spotlight clear of the bubble`, await bubbleClear(p));
  const title2 = await p.locator('.gd-title').innerText().catch(() => '');
  ok(`${label}: second skill is a chain partner`, /🔗|ต่อโซ่|chains/.test(title2), title2);
  const n2 = await buySpotlit(p, touch);
  ok(`${label}: bought the second skill`, !!n2 && (await p.locator('.skillrow[data-i]').count()) === 2, n2 ?? '');
  ok(`${label}: step chain`, await waitStep(p, 'chain'));
  await shot('6-chain');
  const active = await p.evaluate(() => document.querySelectorAll('.cgap.on').length);
  ok(`${label}: the two skills form an active chain`, active >= 1, `${active} chain links`);
  ok(`${label}: chain step points at the chain picture (one short line)`, await (async () => { const t = await p.locator('.gd-text').innerText(); return /ตามรูป|in the picture/.test(t) && t.length < 80; })());
  await p.locator('.gd-next').click();
  ok(`${label}: step fight`, await waitStep(p, 'fight'));
  await shot('7-fight');
  ok(`${label}: fight spotlight clear of the bubble`, await bubbleClear(p));
  {
    const b = await p.locator('[data-a="fight"]').boundingBox();
    const resp = p.waitForResponse((r) => r.url().includes('/api/fight'));
    await tapAt(p, touch, b.x + b.width / 2, b.y + b.height / 2);
    const j = await (await resp).json();
    ok(`${label}: first fight is the server's tutorial fight vs an easy AI`, j.tutorial === true && j.opponent.ai && j.opponent.tier === 'easy', `${j.opponent.name} · ${j.opponent.build.skills.length} skill(s) · won ${j.won} · ${(j.result.ticks ?? 0) / 10}s`);
    ok(`${label}: first fight is a win`, j.won === true);
  }
  ok(`${label}: step watch (passive)`, await waitStep(p, 'watch'));
  await p.waitForTimeout(1200);
  await shot('8-watch');
  ok(`${label}: watching the fight is not dimmed`, await p.evaluate(() => document.querySelector('.gd-root')?.classList.contains('passive')));
  const fightStart = Date.now();
  ok(`${label}: step why (result)`, await waitStep(p, 'why', 90000), `fight played ${((Date.now() - fightStart) / 1000).toFixed(1)}s at 1x`);
  await p.waitForTimeout(600);
  await shot('9-why');
  ok(`${label}: why-you-won spotlight is the explanation`, await p.evaluate(() => {
    const h = document.querySelector('.gd-hole')?.getBoundingClientRect(); const x = document.querySelector('.xv-callout')?.getBoundingClientRect();
    return !!h && !!x && Math.abs(h.top - (x.top - 6)) < 30;
  }));
  await p.locator('.gd-next').click();
  ok(`${label}: step done`, await waitStep(p, 'done'));
  await shot('10-done');
  await p.locator('.gd-next').click();
  await p.waitForTimeout(400);
  ok(`${label}: guide closes at the end`, !(await p.locator('.gd-root').count()));
  ok(`${label}: guide remembered as done`, (await p.evaluate(() => localStorage.getItem('mm.guide.v1'))) === 'done');
  ok(`${label}: whole guide took < 2 min`, Date.now() - t0 < 120000, `${((Date.now() - t0) / 1000).toFixed(0)}s`);
  ok(`${label}: no horizontal scroll`, await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(1300);
  ok(`${label}: guide not offered again after finishing`, !(await p.locator('.gd-root').count()));
  ok(`${label}: no page/console errors`, errs.length === 0, errs.slice(0, 3).join(' | '));
  await browser.close();
}

async function skipGuide(label, ctxOpts) {
  const { browser, p, errs } = await open(ctxOpts);
  ok(`${label}: guide offered`, (await stepOf(p)) === 'welcome');
  await p.locator('.gd-skip').click();
  await p.waitForTimeout(300);
  ok(`${label}: skip button closes the guide`, !(await p.locator('.gd-root').count()));
  ok(`${label}: skip remembered`, (await p.evaluate(() => localStorage.getItem('mm.guide.v1'))) === 'skipped');
  await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(1300);
  ok(`${label}: not offered again after skipping`, !(await p.locator('.gd-root').count()));
  // replay from the header "?" button: the menu has the guide and the slides
  await p.locator('.tut-open').click(); await p.waitForTimeout(300);
  ok(`${label}: "? How to play" offers the guide and the rules`, (await p.locator('.gd-help [data-h="guide"]').count()) === 1 && (await p.locator('.gd-help [data-h="slides"]').count()) === 1);
  await p.locator('.gd-help [data-h="slides"]').click(); await p.waitForTimeout(300);
  ok(`${label}: the rule slides still open`, await p.locator('.tut-x').isVisible());
  await p.locator('.tut-x').click(); await p.waitForTimeout(200);
  await p.locator('.tut-open').click(); await p.waitForTimeout(300);
  await p.locator('.gd-help [data-h="guide"]').click(); await p.waitForTimeout(300);
  await p.locator('.gd-next').click();
  ok(`${label}: replayed guide reaches the town step`, await waitStep(p, 'town'));
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  ok(`${label}: Esc skips the guide`, !(await p.locator('.gd-root').count()));
  ok(`${label}: no page/console errors`, errs.length === 0, errs.slice(0, 3).join(' | '));
  await browser.close();
}

async function townMap(label, ctxOpts) {
  const touch = !!ctxOpts.hasTouch;
  const { browser, p, errs } = await open(ctxOpts);
  await p.locator('.gd-skip').click(); await p.waitForTimeout(300);
  const canvas = async () => p.locator('#stage canvas').boundingBox();
  // tap the building in the middle of the view: the Hero Hall (the town opens centred on it)
  let c = await canvas();
  await tapAt(p, touch, c.x + c.width / 2, c.y + c.height * 0.68); await p.waitForTimeout(500);
  ok(`${label}: tapping the Hero Hall opens its panel`, (await p.locator('[data-a="goto"][data-i="hall"].on').count()) === 1);
  // a drag scrolls the town and does not count as a tap
  c = await canvas();
  const y = c.y + c.height * 0.68;
  if (touch) {
    const cdp = await p.context().newCDPSession(p);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: c.x + c.width * 0.7, y }] });
    for (let k = 1; k <= 10; k++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: c.x + c.width * (0.7 - 0.04 * k), y }] }); await p.waitForTimeout(25); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await p.mouse.move(c.x + c.width * 0.7, y); await p.mouse.down(); await p.mouse.move(c.x + c.width * 0.3, y, { steps: 10 }); await p.mouse.up();
  }
  await p.waitForTimeout(600);
  ok(`${label}: dragging the town does not select a building`, (await p.locator('[data-a="goto"][data-i="hall"].on').count()) === 1 && (await p.locator('.town-card').count()) === 1);
  // select the arena (chip), then tap it on the map: enters the arena
  await p.locator('[data-a="goto"][data-i="arena"]').click(); await p.waitForTimeout(900);
  await p.screenshot({ path: path.join(OUT, `town-${label}-arena-bubble.png`) });
  c = await canvas();
  await tapAt(p, touch, c.x + c.width / 2, c.y + c.height * 0.7); await p.waitForTimeout(800);
  ok(`${label}: tapping the selected arena enters it (hero pick)`, (await p.locator('[data-a="start"]').count()) === 3);
  ok(`${label}: no page/console errors`, errs.length === 0, errs.slice(0, 3).join(' | '));
  await browser.close();
}

const PC = { viewport: { width: 1280, height: 720 } };
const LAND = { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true };
const PORT = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
const only = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
const runs = [
  ['guide-pc', () => playGuide('pc-1280x720', PC)],
  ['guide-land', () => playGuide('phone-landscape-844x390', LAND)],
  ['guide-port', () => playGuide('phone-portrait-390x844', PORT)],
  ['guide-en', () => playGuide('pc-en', PC, 'en-US')],
  ['skip-pc', () => skipGuide('skip-pc', PC)],
  ['skip-phone', () => skipGuide('skip-phone', LAND)],
  ['town-pc', () => townMap('pc', PC)],
  ['town-phone', () => townMap('phone', LAND)],
];
for (const [k, f] of runs) {
  if (only && !only.test(k)) continue;
  try { await f(); } catch (e) { ok(`${k}: finished without a crash`, false, String(e).slice(0, 200)); }
}
const failed = results.filter((r) => !r.pass);
fs.writeFileSync(path.join(OUT, 'e2e-guide.json'), JSON.stringify(results, null, 1));
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.log('FAILED:\n' + failed.map((f) => `  ${f.name} — ${f.info}`).join('\n')); process.exitCode = 1; }
