// Graphics tiers check (perf.ts): auto detection on desktop / phone / weak devices, settings panel buttons, frame cap,
// canvas scale after reload, CSS layers. node perfcheck.mjs <base> <outDir>
import { chromium, devices } from 'playwright';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const BASE = process.argv[2]; const OUT = process.argv[3]; fs.mkdirSync(OUT, { recursive: true });
const exe = path.join(os.homedir(), 'AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe');
let fail = 0;
const ok = (c, m, d = '') => { console.log(`${c ? '✔' : '✘'} ${m}${d ? ' — ' + d : ''}`); if (!c) fail++; };
const browser = await chromium.launch({ executablePath: exe, headless: true });

async function open(name, ctxOpts, initScript) {
  const ctx = await browser.newContext({ locale: 'th-TH', ...ctxOpts });
  // the post-run rating sheet (feedback.ts) is tested on its own: keep it from covering the screens checked here
  await ctx.addInitScript(() => localStorage.setItem('mochi.fb.asked', String(Date.now())));
  if (initScript) await ctx.addInitScript(initScript);
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto(BASE + '/play', { waitUntil: 'load' }); await p.waitForTimeout(1800);
  await p.locator('.gd-skip').first().click({ timeout: 2000 }).catch(() => {});
  await p.waitForTimeout(400);
  const info = await p.evaluate(() => ({ ...window.__perf(), attr: document.documentElement.dataset.perf, canvas: document.querySelector('#stage canvas')?.width, limit: window.Phaser ? null : undefined }));
  return { p, ctx, info, errs, name };
}

// 1. desktop, 8 cores → high
{
  const r = await open('desktop', { viewport: { width: 1280, height: 720 } }, () => { Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 }); Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 }); });
  ok(r.info.tier === 'high' && !r.info.device.mobile, 'desktop 8 cores / 8 GB → auto high', JSON.stringify(r.info));
  ok(r.info.attr === 'high' && r.info.canvas === 1280, 'high: html[data-perf=high], canvas 1280 px', `${r.info.attr} ${r.info.canvas}`);
  ok(await r.p.evaluate(() => getComputedStyle(document.getElementById('ambient')).display !== 'none'), 'high: night sky shown');
  // open settings, check row, pick low
  await r.p.locator('header .vol-btn').click(); await r.p.waitForTimeout(300);
  ok(await r.p.locator('.vol-panel .perf-opts button').count() === 4, 'settings panel: 4 graphics buttons');
  ok((await r.p.locator('.vol-panel [data-perf="auto"]').getAttribute('aria-pressed')) === 'true', 'auto is pressed');
  await r.p.screenshot({ path: path.join(OUT, 'desktop-panel-auto.png') });
  await r.p.locator('.vol-panel [data-perf="medium"]').click(); await r.p.waitForTimeout(300);
  const med = await r.p.evaluate(() => ({ attr: document.documentElement.dataset.perf, stars: [...document.querySelectorAll('#ambient i')].filter((e) => getComputedStyle(e).display !== 'none').length, all: document.querySelectorAll('#ambient i').length }));
  ok(med.attr === 'medium' && med.stars < med.all, 'medium: half the sky hidden', `${med.stars}/${med.all}`);
  await r.p.locator('.vol-panel [data-perf="low"]').click(); await r.p.waitForTimeout(600);
  const low = await r.p.evaluate(() => ({ attr: document.documentElement.dataset.perf, sky: getComputedStyle(document.getElementById('ambient')).display, saved: localStorage.getItem('mochi.perf'), reload: !!document.querySelector('.vol-panel [data-reload]') }));
  ok(low.attr === 'low' && low.sky === 'none' && low.saved === 'low', 'low: sky off, choice saved', JSON.stringify(low));
  ok(low.reload, 'low: panel offers a reload for the canvas scale');
  await r.p.screenshot({ path: path.join(OUT, 'desktop-panel-low.png') });
  // frame cap: measure rAF-driven Phaser frames over 2 s
  const fps = await r.p.evaluate(() => new Promise((res) => { const a = window.__perf().stepped; setTimeout(() => res((window.__perf().stepped - a) / 2.5), 2500); }));
  ok(fps >= 25 && fps <= 34, 'low: game steps ~30 times a second', String(fps));
  await r.p.reload({ waitUntil: 'load' }); await r.p.waitForTimeout(1800);
  const after = await r.p.evaluate(() => ({ ...window.__perf(), canvas: document.querySelector('#stage canvas')?.width }));
  const fpsB = await r.p.evaluate(() => new Promise((res) => { const a = window.__perf().stepped; setTimeout(() => res((window.__perf().stepped - a) / 2.5), 2500); }));
  ok(fpsB >= 25 && fpsB <= 34, 'low from boot: ~30 steps a second', String(fpsB));
  ok(after.tier === 'low' && after.canvas === 960, 'low after reload: canvas 960 px (1.5×)', `${after.tier} ${after.canvas}`);
  // play into a fight on low to make sure nothing breaks
  const tap = async (sel, wait = 500) => { const l = r.p.locator(sel).first(); if (!(await l.count())) return false; await l.click({ timeout: 4000 }).catch(() => {}); await r.p.waitForTimeout(wait); return true; };
  await tap('.gd-skip');
  await tap('[data-a="goto"][data-i="arena"]'); await tap('[data-a="enterArena"]', 900);
  await tap('.pk-card', 900); // open a hero card (it flips, the hero steps onto the platform)
  await tap('.pk-start', 1000);
  for (let i = 0; i < 3; i++) { if (await p.locator('.shop2.drawer-open').count()) { await p.locator('.drawer-x').click().catch(() => {}); await p.waitForTimeout(400); } await p.locator('[data-a="buy"]:not([disabled])').first().click({ delay: 750, timeout: 4000 }).catch(() => {}); await p.waitForTimeout(300); } // hold to buy
  await r.p.screenshot({ path: path.join(OUT, 'desktop-low-shop.png') });
  await tap('[data-a="fight"]', 3000); await r.p.screenshot({ path: path.join(OUT, 'desktop-low-fight.png') });
  await tap('[data-a="skip"]', 1800); await r.p.screenshot({ path: path.join(OUT, 'desktop-low-result.png') });
  // back to auto
  await r.p.locator('header .vol-btn').click(); await r.p.waitForTimeout(300);
  await r.p.locator('.vol-panel [data-perf="auto"]').click(); await r.p.waitForTimeout(600);
  const back = await r.p.evaluate(() => ({ ...window.__perf(), saved: localStorage.getItem('mochi.perf') }));
  ok(back.tier === 'high' && back.saved === null, 'auto again: back to high, choice cleared', `${back.tier} ${back.saved}`);
  const fps2 = await r.p.evaluate(() => new Promise((res) => { const a = window.__perf().stepped; setTimeout(() => res((window.__perf().stepped - a) / 2.5), 2500); }));
  ok(fps2 > 40, 'auto high: frame cap lifted', String(fps2));
  ok(r.errs.length === 0, 'desktop: no page errors', r.errs.join(' | '));
  await r.ctx.close();
}

// 2. desktop, 4 cores → medium
{
  const r = await open('desktop4', { viewport: { width: 1280, height: 720 } }, () => { Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 4 }); Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 }); });
  ok(r.info.tier === 'medium', 'desktop 4 cores → auto medium', r.info.tier);
  await r.ctx.close();
}

// 3. phone → medium
{
  const r = await open('phone', { ...devices['iPhone 13'], viewport: { width: 844, height: 390 } });
  ok(r.info.device.mobile && r.info.tier === 'medium', 'iPhone (landscape) → auto medium', JSON.stringify(r.info.device));
  await r.p.locator('header .vol-btn').click(); await r.p.waitForTimeout(300);
  const fits = await r.p.evaluate(() => { const b = document.querySelector('.vol-panel').getBoundingClientRect(); return [Math.round(b.bottom), innerHeight]; });
  ok(fits[0] <= fits[1], 'phone landscape: settings panel fits the screen', fits.join('/'));
  await r.p.locator('.vol-panel .perf-set').scrollIntoViewIfNeeded();
  await r.p.screenshot({ path: path.join(OUT, 'phone-panel.png') });
  ok(r.errs.length === 0, 'phone: no page errors', r.errs.join(' | '));
  await r.ctx.close();
}

// 4. weak Android (2 GB) → low
{
  const r = await open('android2', { ...devices['Pixel 5'], viewport: { width: 851, height: 393 } }, () => Object.defineProperty(navigator, 'deviceMemory', { get: () => 2 }));
  ok(r.info.tier === 'low' && r.info.canvas === 960, 'Android 2 GB → auto low, canvas 960 px', `${r.info.tier} ${r.info.canvas}`);
  await r.ctx.close();
}

// 5. watchdog: a slow machine on auto drops a tier and remembers it
{
  const r = await open('slow', { viewport: { width: 1280, height: 720 } }, () => { Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 }); });
  // burn the main thread so the loop runs ~20 fps
  await r.p.evaluate(() => { const burn = () => { const t = performance.now(); while (performance.now() - t < 45); requestAnimationFrame(burn); }; requestAnimationFrame(burn); });
  await r.p.waitForTimeout(17000);
  const w = await r.p.evaluate(() => ({ ...window.__perf(), learned: localStorage.getItem('mochi.perf.learned') }));
  ok(w.tier !== 'high' && !!w.learned, 'watchdog: sustained low fps drops a tier and saves it', `${w.tier} fps ${w.fps} ${w.learned}`);
  await r.ctx.close();
}

await browser.close();
console.log(fail ? `FAIL ${fail}` : 'ALL OK');
process.exit(fail ? 1 : 0);
