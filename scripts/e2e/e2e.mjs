// End-to-end check of the Mochi Moon list build: plays full runs in a real browser (phone + desktop)
// and checks every screen, the API and the assets. Usage: node e2e.mjs <baseUrl> <outDir>
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

async function play(label, ctxOpts, runs = 1) {
  const browser = await chromium.launch({ executablePath: exe, headless: true });
  const ctx = await browser.newContext({ ...ctxOpts, locale: 'th-TH' });
  const p = await ctx.newPage();
  const errs = [], bad = [];
  p.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
  p.on('crash', () => errs.push('PAGE CRASHED'));
  p.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) errs.push(m.text().slice(0, 200)); });
  p.on('response', (r) => { if (r.status() >= 400 && !/favicon/.test(r.url())) bad.push(`${r.status()} ${r.url().replace(BASE, '')}`); });
  const tap = async (sel, wait = 400) => {
    const l = p.locator(sel).first();
    if (!(await l.count())) return false;
    await l.scrollIntoViewIfNeeded().catch(() => {});
    await l.click({ timeout: 4000 }).catch(() => {});
    await p.waitForTimeout(wait);
    return true;
  };
  const has = async (sel) => (await p.locator(sel).count()) > 0;
  const text = async () => (await p.locator('#panel').innerText().catch(() => '')).replace(/\s+/g, ' ');
  const noHScroll = async () => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  const shot = (n) => p.screenshot({ path: path.join(OUT, `${label}-${n}.png`) });

  await p.goto(BASE, { waitUntil: 'load' });
  await p.waitForTimeout(1500);
  ok(`${label}: title is Mochi Moon`, (await p.title()) === 'Mochi Moon');
  // tutorial: the guided tutorial offers itself on the first visit (skip it here; e2e-guide.mjs plays it)
  const tut = await has('.gd-skip');
  ok(`${label}: guided tutorial is offered on first visit`, tut);
  await tap('.gd-skip');
  ok(`${label}: town has no horizontal scroll`, await noHScroll());
  await tap('[data-lang="en"]');
  ok(`${label}: English switch changes language`, await p.locator('html').getAttribute('lang') === 'en');
  await tap('[data-lang="th"]');
  ok(`${label}: Thai switch changes language`, await p.locator('html').getAttribute('lang') === 'th');
  await shot('town');

  // leaderboard + profile pages from the town
  await tap('[data-a="goto"][data-i="board"]');
  await tap('[data-a="leaderboard"]', 900);
  ok(`${label}: leaderboard page opens`, /กระดานผู้นำ/.test(await text()));
  await tap('[data-a="lbPeriod"][data-i="day"]', 700);
  await tap('[data-a="profile"]', 900);
  ok(`${label}: profile page opens`, /โปรไฟล์|ผงดาว|ประวัติ/.test(await text()));
  await tap('[data-a="town"]');

  for (let run = 0; run < runs; run++) {
    await tap('[data-a="goto"][data-i="arena"]');
    await tap('[data-a="enterArena"]', 700);
    ok(`${label} run${run}: hero pick shows logo + 3 heroes`, (await has('.brand-logo')) && (await p.locator('[data-a="start"]').count()) === 3);
    await tap('[data-a="start"]', 900);
    ok(`${label} run${run}: shop opens`, await has('.shopv'));
    ok(`${label} run${run}: shop has no horizontal scroll`, await noHScroll());
    await shot(`run${run}-shop-d1`);

    let day = 0, fights = 0, sawLC = false, sawMark = false, triedShopTools = false;
    for (let guard = 0; guard < 40; guard++) {
      if (await has('[data-a="lc"]')) { sawLC = true; await tap('[data-a="lc"][data-i="supply"]', 700); continue; }
      if (await has('[data-a="mark"]')) { sawMark = true; await tap('[data-a="mark"]', 600); continue; }
      if (await has('.mm-over') || await has('[data-a="replayAgain"]')) break;
      if (await has('.shopv')) {
        day++;
        // shop tools once per run: lock, reroll, drag reorder, tree window, sell + rebuy
        if (!triedShopTools && day >= 2) {
          triedShopTools = true;
          const lockOk = await tap('[data-a="lock"]', 500);
          ok(`${label} run${run}: lock a card`, lockOk && (await has('[data-a="lock"]')));
          await tap('[data-a="reroll"]', 500);
          const rows = p.locator('.skillrow[data-i]');
          if ((await rows.count()) >= 2) {
            const before = (await rows.nth(0).innerText()).slice(0, 40);
            await p.locator('.skillrow[data-i] [data-drag]').nth(0).scrollIntoViewIfNeeded();
            await p.waitForTimeout(300);
            const g = await p.locator('.skillrow[data-i] [data-drag]').nth(0).boundingBox();
            const b = await rows.nth(1).boundingBox();
            const x = g.x + g.width / 2, y1 = g.y + g.height / 2, y2 = b.y + b.height - 4;
            if (ctxOpts.hasTouch) {
              // real touch events through CDP (pointerType = touch)
              const cdp = await p.context().newCDPSession(p);
              await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y1 }] });
              for (let k = 1; k <= 12; k++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y1 + ((y2 - y1) * k) / 12 }] }); await p.waitForTimeout(30); }
              await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
            } else {
              await p.mouse.move(x, y1); await p.mouse.down(); await p.mouse.move(x, y2, { steps: 12 }); await p.mouse.up();
            }
            await p.waitForTimeout(600);
            const after = (await rows.nth(0).innerText()).slice(0, 40);
            ok(`${label} run${run}: drag (${ctxOpts.hasTouch ? 'touch' : 'mouse'}) reorders the list`, before !== after, `${before} → ${after}`);
          } else ok(`${label} run${run}: drag test skipped (fewer than 2 skills)`, true);
          ok(`${label} run${run}: firing timeline visible`, (await text()).includes('วิ') && (await has('.shopv svg, .tl, [class*="timeline"]')));
          if (await tap('[data-a="tree"]', 500)) { ok(`${label} run${run}: skill tree window opens`, await has('button[data-a="treeClose"]')); await tap('button[data-a="treeClose"]'); ok(`${label} run${run}: skill tree window closes`, !(await has('.modal'))); }
          // shop HUD + coin pill on the shop panel
          ok(`${label} run${run}: HUD shows HP, day and 10 win stars`, (await has('[data-hud="hp"]')) && (await has('[data-hud="day"]')) && (await p.locator('.hud-star').count()) === 10);
          ok(`${label} run${run}: gold coin pill sits on the shop panel`, await has('.sv-shop .gold-pill .gold-n'));
          const gold = async () => p.evaluate(() => JSON.parse(localStorage.getItem('arena.run.v7') || '{}').gold);
          const nRows = async () => p.locator('.skillrow[data-i]').count();
          const touch = !!ctxOpts.hasTouch;
          const cdp = touch ? await p.context().newCDPSession(p) : null;
          // a drag gesture (real touch events on phones, the mouse on desktop); target() is read once the drag has started
          const gesture = async (x0, y0, target) => {
            if (touch) {
              await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
              for (let k = 1; k <= 4; k++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + k * 4, y: y0 - k * 6 }] }); await p.waitForTimeout(30); }
              const t = await target();
              for (let k = 1; k <= 14; k++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + (t.x - x0) * k / 14, y: y0 + (t.y - y0) * k / 14 }] }); await p.waitForTimeout(30); }
              await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
            } else {
              await p.mouse.move(x0, y0); await p.mouse.down(); await p.mouse.move(x0 + 12, y0 - 12, { steps: 3 });
              const t = await target();
              await p.mouse.move(t.x, t.y, { steps: 16 }); await p.waitForTimeout(150); await p.mouse.up();
            }
            await p.waitForTimeout(800);
          };
          // sell: drag a skill onto the coin jar
          {
            const r0 = await nRows(), g0 = await gold();
            const grip = p.locator('.skillrow[data-i] [data-drag]').last();
            await grip.scrollIntoViewIfNeeded(); await p.waitForTimeout(250);
            const gb = await grip.boundingBox();
            await gesture(gb.x + gb.width / 2, gb.y + gb.height / 2, async () => {
              const jb = await p.locator('.sell-jar').boundingBox();
              return { x: jb.x + jb.width / 2, y: jb.y + jb.height / 2 };
            });
            const r1 = await nRows(), g1 = await gold();
            ok(`${label} run${run}: drag a skill onto the coin jar sells it`, r1 === r0 - 1 && g1 > g0, `rows ${r0}→${r1}, gold ${g0}→${g1}`);
          }
          // buy: drag a shop card into the list (mouse) / tap a card, then tap the ghost spot (touch)
          {
            const card = p.locator('.card.offer[data-tip^="s:"]:not(.nobuy):not(.can-up)').first();
            if (await card.count()) {
              const r0 = await nRows(), g0 = await gold();
              const bname = (await card.locator('.offer-name').innerText()).trim();
              await card.scrollIntoViewIfNeeded(); await p.waitForTimeout(200);
              if (touch) {
                await card.locator('.offer-name').click(); await p.waitForTimeout(500);
                ok(`${label} run${run}: tapping a card shows the ghost + insert targets`, (await has('.put-here.mode-pick')) && (await has('.ins-slot button')));
                await tap('.put-here.mode-pick', 900);
              } else {
                const cb = await card.locator('.offer-name').boundingBox();
                await gesture(cb.x + cb.width / 2, cb.y + cb.height / 2, async () => {
                  const rb = await p.locator('.skillrow[data-i]').first().boundingBox();
                  return { x: rb.x + rb.width / 2, y: rb.y + 6 };
                });
              }
              const r1 = await nRows(), g1 = await gold();
              ok(`${label} run${run}: ${touch ? 'tap-to-place' : 'drag a shop card into the list'} buys it`, r1 === r0 + 1 && g1 < g0, `rows ${r0}→${r1}, gold ${g0}→${g1}`);
              if (!touch) ok(`${label} run${run}: drag-buy lands where it was dropped (top of the list)`, (await p.locator('.skillrow[data-i="0"] .nm').innerText()).includes(bname), bname);
            } else ok(`${label} run${run}: buy-by-drag skipped (no affordable new skill)`, true);
          }
        }
        // buy what we can afford (left to right), then fight
        for (let i = 0; i < 6; i++) {
          const btn = p.locator('[data-a="buy"]:not([disabled])').first();
          if (!(await btn.count())) break;
          await btn.scrollIntoViewIfNeeded().catch(() => {}); await btn.click({ timeout: 3000 }).catch(() => {}); await p.waitForTimeout(250);
        }
        if (day === 2) await shot(`run${run}-shop-d2`);
        await tap('[data-a="fight"]', 1200);
        fights++;
        // skip the replay once the arena is playing
        await tap('[data-a="skip"]', 900);
        await p.waitForTimeout(600);
        if (fights === 1) {
          const t = await text();
          ok(`${label} run${run}: result names you vs opponent`, /คุณ/.test(t));
          await shot(`run${run}-result1`);
        }
        await tap('[data-a="next"]', 700);
        continue;
      }
      if (await has('[data-a="next"]')) { await tap('[data-a="next"]', 700); continue; }
      if (await has('[data-a="skip"]')) { await tap('[data-a="skip"]', 900); continue; }
      await p.waitForTimeout(800);
    }
    const over = await has('.mm-over');
    ok(`${label} run${run}: run reaches the end page`, over, `${fights} fights, last chance seen: ${sawLC}, mark seen: ${sawMark}`);
    await p.waitForTimeout(2500); // finishRun
    const t = await text();
    const m = t.match(/(\d+)\s*ชนะ\s*(\d+)\s*แพ้/);
    ok(`${label} run${run}: end page shows a stardust reward`, /\+\d+\s*ผงดาว/.test(t), m ? `wins ${m[1]} losses ${m[2]}` : t.slice(0, 80));
    ok(`${label} run${run}: end page has banner image`, await has('.mm-banner'));
    ok(`${label} run${run}: end page has no horizontal scroll`, await noHScroll());
    await shot(`run${run}-over`);
    // open a replay from the run list if there is one
    const rp = p.locator('.mm-over ~ * a[href*="replay"], a[href*="#replay"], a[href*="replay="]').first();
    if (await rp.count()) {
      await rp.click().catch(() => {}); await p.waitForTimeout(2500);
      ok(`${label} run${run}: replay link opens a fight`, (await has('[data-a="skip"]')) || (await has('[data-a="replayAgain"]')) || (await has('[data-a="leaveReplay"]')));
      await tap('[data-a="skip"]', 900); await tap('[data-a="leaveReplay"]', 700);
    }
    await p.goto(BASE, { waitUntil: 'load' }); await p.waitForTimeout(1200);
  }
  // profile now has data
  await tap('[data-a="goto"][data-i="hall"]'); await tap('[data-a="profile"]', 1200);
  const prof = await text();
  ok(`${label}: profile shows finished runs from the server`, /ผงดาว/.test(prof) && !/จากเบราว์เซอร์นี้/.test(prof), prof.slice(0, 100));
  await shot('profile');
  await tap('[data-a="town"]'); await tap('[data-a="goto"][data-i="board"]'); await tap('[data-a="leaderboard"]', 1200);
  ok(`${label}: leaderboard lists runs`, /ชนะ/.test(await text()));
  await shot('leaderboard');
  // mute toggle
  const m1 = await p.locator('.mute-btn').innerText();
  await p.locator('.mute-btn').click(); await p.waitForTimeout(200);
  ok(`${label}: mute toggles`, m1 !== (await p.locator('.mute-btn').innerText()));
  ok(`${label}: no page/console errors`, errs.length === 0, errs.slice(0, 3).join(' | '));
  ok(`${label}: no failed requests`, bad.length === 0, bad.slice(0, 5).join(' | '));
  await browser.close();
}

async function api() {
  const j = async (u, init) => { const r = await fetch(BASE + u, init); return [r.status, await r.text()]; };
  const post = (u, b) => j(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
  ok('api: __proto__ id rejected', (await post('/api/fight', { runId: '__proto__', day: 1, build: {} }))[0] === 400);
  ok('api: profile with bad id rejected', (await j('/api/profile?playerId=__proto__'))[0] === 400);
  ok('api: leaderboard responds', (await j('/api/leaderboard?period=season'))[0] === 200);
  ok('api: scout responds', (await j('/api/scout?day=2&rating=1000'))[0] === 200);
  for (const [f, type] of [['/assets/img/logo.webp', 'image/webp'], ['/assets/sfx/click.ogg', 'audio/ogg'], ['/assets/voice/en/champion.mp3', 'audio/mpeg'], ['/assets/img/og.jpg', 'image/jpeg']]) {
    const r = await fetch(BASE + f);
    ok(`asset ${f}`, r.status === 200 && (r.headers.get('content-type') ?? '').startsWith(type), `${r.status} ${r.headers.get('content-type')}`);
  }
  const tr = await j('/../../package.json');
  ok('static: path traversal blocked', !tr[1].includes('"arena-poc"'), String(tr[0]));
}

// One-screen layout: on PC and phones held sideways no screen may scroll the page (panels scroll inside).
// Upright phones may scroll only in the shop. Run over is reached by giving up, to keep this quick.
async function layout(label, ctxOpts, portrait = false) {
  const browser = await chromium.launch({ executablePath: exe, headless: true });
  const ctx = await browser.newContext({ ...ctxOpts, locale: 'th-TH' });
  const p = await ctx.newPage();
  const tap = async (sel, wait = 500) => {
    const l = p.locator(sel).first();
    if (!(await l.count())) return false;
    await l.click({ timeout: 4000 }).catch(() => {});
    await p.waitForTimeout(wait);
    return true;
  };
  const fits = async (screen, sel) => {
    const on = await p.locator(sel).count();
    const m = await p.evaluate(() => ({ sh: document.documentElement.scrollHeight, ih: innerHeight, sw: document.documentElement.scrollWidth, iw: innerWidth }));
    const pass = on > 0 && m.sh <= m.ih + 2 && m.sw <= m.iw + 1;
    ok(`layout ${label}: ${screen} fits one screen (no page scroll)`, pass, `${on ? '' : 'screen not shown · '}${m.sh}/${m.ih} tall, ${m.sw}/${m.iw} wide`);
    await p.screenshot({ path: path.join(OUT, `layout-${label}-${screen}.png`) });
  };
  await p.goto(BASE, { waitUntil: 'load' });
  await p.waitForTimeout(1500);
  await tap('.gd-skip');
  await fits('town', '.town-card');
  await tap('[data-a="goto"][data-i="arena"]');
  await tap('[data-a="enterArena"]', 900);
  await fits('hero pick', '[data-a="start"]');
  await tap('[data-a="start"]', 1000);
  if (!portrait) await fits('shop', '.shopv');
  for (let i = 0; i < 4; i++) await tap('[data-a="buy"]:not([disabled])', 250);
  await tap('[data-a="fight"]', 1200);
  await fits('fight', '#log');
  await tap('[data-a="skip"]', 1800);
  await fits('result', '.mm-result');
  await tap('[data-a="next"]', 700);
  await tap('[data-a="concede"]', 400);
  await tap('[data-a="concedeYes"]', 1500);
  await fits('run over', '.mm-over');
  await browser.close();
}

await api();
await layout('pc-1440x900', { viewport: { width: 1440, height: 900 } });
await layout('pc-1280x720', { viewport: { width: 1280, height: 720 } });
await layout('phone-landscape-844x390', { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });
await layout('phone-portrait-390x844', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, true);
await play('phone', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, 2);
await play('desktop', { viewport: { width: 1280, height: 860 } }, 1);
const failed = results.filter((r) => !r.pass);
fs.writeFileSync(path.join(OUT, 'e2e.json'), JSON.stringify(results, null, 1));
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.log('FAILED:\n' + failed.map((f) => `  ${f.name} — ${f.info}`).join('\n')); process.exitCode = 1; }
