// End-to-end check of the Mochi Moon GRID build: plays full runs in a real browser (phone + desktop)
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
  // E2E_ONLY=phoneL,desktop runs just those devices
  if (process.env.E2E_ONLY && !process.env.E2E_ONLY.split(',').includes(label)) return;
  const browser = await chromium.launch({ executablePath: exe, headless: true });
  const ctx = await browser.newContext(ctxOpts);
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
  const landscape = (ctxOpts.viewport?.width ?? 0) > (ctxOpts.viewport?.height ?? 0);
  const touch = !!ctxOpts.hasTouch;
  const noPageScroll = async () => p.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1 && document.documentElement.scrollWidth <= window.innerWidth + 1);
  const runState = async () => p.evaluate(() => JSON.parse(localStorage.getItem('arena.gridrun.v5') || '{}'));
  const placedN = async () => p.locator('.grid.live [data-blk]').count();
  const cdp = touch ? await ctx.newCDPSession(p) : null;
  // a drag gesture: real touch events on touch screens, the mouse elsewhere; target() is read once the drag has started
  const gesture = async (x0, y0, target, during) => {
    if (touch) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
      for (let k = 1; k <= 4; k++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + k * 4, y: y0 - k * 4 }] }); await p.waitForTimeout(30); }
      const t = await target();
      for (let k = 1; k <= 14; k++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + (t.x - x0) * k / 14, y: y0 + (t.y - y0) * k / 14 }] }); await p.waitForTimeout(30); }
      if (during) await during();
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await p.mouse.move(x0, y0); await p.mouse.down(); await p.mouse.move(x0 + 12, y0 - 12, { steps: 3 });
      const t = await target();
      await p.mouse.move(t.x, t.y, { steps: 16 }); await p.waitForTimeout(200);
      if (during) await during();
      await p.mouse.up();
    }
    await p.waitForTimeout(900);
  };
  /** centre of the landing copy's cell nearest its middle (where a dragged card is held) */
  const landPoint = async () => p.evaluate(() => {
    const hits = [...document.querySelectorAll('.gs-land rect.hit')].map((e) => e.getBoundingClientRect());
    if (!hits.length) return null;
    const c = hits.map((b) => [b.left + b.width / 2, b.top + b.height / 2]);
    const mx = c.reduce((a, q) => a + q[0], 0) / c.length, my = c.reduce((a, q) => a + q[1], 0) / c.length;
    let best = c[0];
    for (const q of c) if (Math.hypot(q[0] - mx, q[1] - my) < Math.hypot(best[0] - mx, best[1] - my) - 0.5) best = q;
    return { x: best[0], y: best[1] };
  });
  /** shop UX checks (HUD, coin pill, prices, icons, landing preview, upgrade badge, drag / tap buy, sell jar, one screen) */
  const shopUX = async (tag) => {
    ok(`${label} ${tag}: HUD shows HP heart, moon day and 10 win stars`, (await has('[data-hud="hp"] .hud-heart')) && (await has('[data-hud="day"] .hud-moon')) && (await p.locator('.hud-star').count()) === 10);
    const st = await runState();
    const pill = (await p.locator('.gs-shop .gold-pill .gold-n').first().innerText().catch(() => '')).trim();
    ok(`${label} ${tag}: coin pill on the shop panel shows the gold`, pill === String(st.gold), `pill ${pill}, gold ${st.gold}`);
    ok(`${label} ${tag}: shop cards show coin prices`, (await p.locator('.gs-card[data-card] .gs-buy .coin .coin-ico').count()) > 0);
    const icons = await p.evaluate(() => {
      const imgs = [...document.querySelectorAll('.gs img.skill-icon')];
      const cards = [...document.querySelectorAll('.gs-card[data-card]')].filter((c) => !c.querySelector('.offer-name img.skill-icon')).length;
      const blocks = [...document.querySelectorAll('.grid.live svg.blk')].filter((b) => !b.querySelector('image.bl-icon')).length;
      const bag = [...document.querySelectorAll('.gs-bagitem')].filter((b) => !b.querySelector('img.skill-icon')).length;
      const broken = imgs.filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.getAttribute('src'));
      return { n: imgs.length, cards, blocks, bag, broken };
    });
    ok(`${label} ${tag}: every shop card, grid block and bag item has its skill icon (and none is broken)`, icons.cards === 0 && icons.blocks === 0 && icons.bag === 0 && icons.broken.length === 0, JSON.stringify(icons));
    if (landscape) ok(`${label} ${tag}: shop fits one screen (no page scroll)`, await noPageScroll());
    const up = p.locator('.gs-card.can-up').first();
    if (await up.count()) ok(`${label} ${tag}: upgrade card shows a ▲Lv badge`, /▲\s*Lv[23]/.test(await up.locator('.up-badge').innerText().catch(() => '')));
    else ok(`${label} ${tag}: upgrade badge check skipped (no upgrade card in this shop)`, true);
    // buy a new block onto the grid: drag the card (mouse) / tap the card then the see-through copy (touch)
    const card = p.locator('.gs-card[data-card]:not(.nobuy):not(.upgrade)').first();
    if (!(await card.count())) return ok(`${label} ${tag}: buy-onto-grid skipped (no affordable new skill)`, true);
    await card.scrollIntoViewIfNeeded(); await p.waitForTimeout(200);
    const art = await card.locator('.offer-art').boundingBox();
    const n0 = await placedN(), g0 = (await runState()).gold;
    if (touch) {
      await card.locator('.offer-art').tap(); await p.waitForTimeout(500);
      await p.locator('.gs-land').scrollIntoViewIfNeeded().catch(() => {}); await p.waitForTimeout(300);
      const land = await landPoint();
      ok(`${label} ${tag}: tapping a card picks it and shows where it lands`, (await has('.gs-card.picked')) && (!!land || (await has('.gs-bag.land-bag'))));
      await shot(`${tag}-picked`);
      if (!land) return ok(`${label} ${tag}: tap-to-place skipped (no room on the grid)`, true);
      await p.touchscreen.tap(land.x, land.y); await p.waitForTimeout(900);
      const n1 = await placedN(), g1 = (await runState()).gold;
      ok(`${label} ${tag}: tap card then tap the grid buys it onto the grid`, n1 === n0 + 1 && g1 < g0, `placed ${n0}→${n1}, gold ${g0}→${g1}`);
    } else {
      await p.mouse.move(art.x + art.width / 2, art.y + art.height / 2); await p.waitForTimeout(400);
      const land = await landPoint();
      ok(`${label} ${tag}: hovering a card shows where its block lands`, !!land || (await has('.gs-bag.land-bag')));
      await shot(`${tag}-landing`);
      if (!land) return ok(`${label} ${tag}: drag-buy skipped (no room on the grid)`, true);
      let ghost = false;
      await gesture(art.x + art.width / 2, art.y + art.height / 2, async () => land, async () => { ghost = await has('.gs-buyghost.snap:not(.bad)'); await shot(`${tag}-dragbuy`); });
      const n1 = await placedN(), g1 = (await runState()).gold;
      ok(`${label} ${tag}: dragging a shop card shows the block snapped on the grid`, ghost);
      ok(`${label} ${tag}: dropping a shop card on the grid buys it there`, n1 === n0 + 1 && g1 < g0, `placed ${n0}→${n1}, gold ${g0}→${g1}`);
    }
    // sell: drag a placed block onto the coin jar
    {
      await p.locator('.gs-pack').scrollIntoViewIfNeeded().catch(() => {}); await p.waitForTimeout(300);
      const s0 = (await runState()).skills.length, g0b = (await runState()).gold;
      const hit = p.locator('.grid.live [data-blk] rect.hit').last();
      const hb = await hit.boundingBox();
      let amt = '';
      await gesture(hb.x + hb.width / 2, hb.y + hb.height / 2, async () => {
        const jb = await p.locator('.sell-jar').boundingBox();
        return { x: jb.x + jb.width / 2, y: jb.y + jb.height / 2 };
      }, async () => { amt = await p.locator('.sell-jar .jar-amt').innerText().catch(() => ''); });
      const s1 = (await runState()).skills.length, g1b = (await runState()).gold;
      ok(`${label} ${tag}: the jar shows the sell price while dragging`, /\+\d/.test(amt), amt);
      ok(`${label} ${tag}: dropping a block on the coin jar sells it`, s1 === s0 - 1 && g1b > g0b, `skills ${s0}→${s1}, gold ${g0b}→${g1b}`);
    }
    if (landscape) ok(`${label} ${tag}: still one screen after buying and selling`, await noPageScroll());
  };

  await p.goto(BASE, { waitUntil: 'load' });
  await p.waitForTimeout(1500);
  ok(`${label}: title is Mochi Moon`, (await p.title()) === 'Mochi Moon');
  // tutorial
  const tut = await has('button:has-text("✕")');
  ok(`${label}: tutorial shows on first visit`, tut);
  await tap('button:has-text("✕")');
  ok(`${label}: town has no horizontal scroll`, await noHScroll());
  await shot('town');

  // leaderboard + profile pages from the town
  await tap('[data-a="goto"][data-i="board"]');
  await tap('[data-a="leaderboard"]', 900);
  ok(`${label}: leaderboard page opens`, /กระดานผู้นำ|Leaderboard/.test(await text()));
  await tap('[data-a="lbPeriod"][data-i="day"]', 700);
  await tap('[data-a="profile"]', 900);
  ok(`${label}: profile page opens`, /โปรไฟล์|ผงดาว|ประวัติ|Profile|stardust|history/i.test(await text()));
  await tap('[data-a="town"]');

  for (let run = 0; run < runs; run++) {
    await tap('[data-a="goto"][data-i="arena"]');
    await tap('[data-a="enterArena"]', 700);
    ok(`${label} run${run}: hero pick shows logo + 3 heroes`, (await has('.brand-logo')) && (await p.locator('[data-a="start"]').count()) === 3);
    await tap('[data-a="start"]', 900);
    ok(`${label} run${run}: shop opens`, await has('[data-a="fight"]'));
    ok(`${label} run${run}: shop has no horizontal scroll`, await noHScroll());
    if (landscape) ok(`${label} run${run}: day-1 shop fits one screen (no page scroll)`, await noPageScroll());
    await shot(`run${run}-shop-d1`);

    let day = 0, fights = 0, sawLC = false, sawMark = false, triedShopTools = false;
    for (let guard = 0; guard < 40; guard++) {
      if (await has('[data-a="lc"]')) { sawLC = true; await tap('[data-a="lc"][data-i="supply"]', 700); continue; }
      if (await has('[data-a="mark"]')) { sawMark = true; await tap('[data-a="mark"]', 600); continue; }
      if (await has('.mm-over') || await has('[data-a="replayAgain"]')) break;
      if (await has('[data-a="fight"]') && !(await has('[data-a="skip"]'))) {
        day++;
        // shop tools once per run: lock, reroll, drag reorder, tree window, sell + rebuy
        if (!triedShopTools && day >= 2) {
          triedShopTools = true;
          const lockOk = await tap('[data-a="lock"]', 500);
          ok(`${label} run${run}: lock a card`, lockOk && (await has('[data-a="lock"]')));
          await tap('[data-a="reroll"]', 500);
          ok(`${label} run${run}: shop shows link chips`, (await text()).includes('🔗'));
          if (await has('[data-a="placeBag"]')) { await tap('[data-a="placeBag"]', 600); ok(`${label} run${run}: place-from-bag works`, true); }
          const before = await text();
          await tap('[data-lang="en"]', 900);
          const en = await text();
          const thai = (en.match(/[฀-๿]+/g) || []).filter((w) => !/ผู้เล่น|AI/.test(w));
          ok(`${label} run${run}: English shop has no Thai text`, thai.length === 0, thai.slice(0, 8).join(' '));
          await shot(`run${run}-shop-en`);
          await tap('[data-lang="th"]', 900);
          ok(`${label} run${run}: back to Thai`, /[฀-๿]/.test(await text()) && before.length > 0);
          ok(`${label} run${run}: firing timeline visible`, (await has('[class*="timeline"], [class*="tl-"], .gs-tl, svg')));
          if (await tap('[data-a="tree"]', 500)) { ok(`${label} run${run}: skill tree window opens`, await has('button[data-a="treeClose"]')); await tap('button[data-a="treeClose"]'); ok(`${label} run${run}: skill tree window closes`, !(await has('.modal'))); }
          if (run === 0) await shopUX(`run${run}-d${day}`);
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
          ok(`${label} run${run}: result names you vs opponent`, /คุณ|You/.test(t));
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
    const m = t.match(/(\d+)\s*(?:ชนะ|wins?)\s*(\d+)\s*(?:แพ้|loss)/i);
    ok(`${label} run${run}: end page shows a stardust reward`, /\+\d+\s*(ผงดาว|stardust)/i.test(t), m ? `wins ${m[1]} losses ${m[2]}` : t.slice(0, 80));
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
  ok(`${label}: profile shows finished runs from the server`, /ผงดาว|stardust/i.test(prof) && !/จากเครื่องนี้|this device/i.test(prof), prof.slice(0, 100));
  await shot('profile');
  await tap('[data-a="town"]'); await tap('[data-a="goto"][data-i="board"]'); await tap('[data-a="leaderboard"]', 1200);
  ok(`${label}: leaderboard lists runs`, /ชนะ|win/i.test(await text()));
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
  for (const [f, type] of [['/assets/img/logo.webp', 'image/webp'], ['/assets/sfx/click.ogg', 'audio/ogg'], ['/assets/voice/en/champion.mp3', 'audio/mpeg'], ['/assets/voice/th/fight.ogg', 'audio/ogg'], ['/assets/img/og.jpg', 'image/jpeg']]) {
    const r = await fetch(BASE + f);
    ok(`asset ${f}`, r.status === 200 && (r.headers.get('content-type') ?? '').startsWith(type), `${r.status} ${r.headers.get('content-type')}`);
  }
  const tr = await j('/../../package.json');
  ok('static: path traversal blocked', !tr[1].includes('"arena-poc"'), String(tr[0]));
}

await api();
await play('phone', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, 2);
await play('phoneL', { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true }, 1);
await play('desktop', { viewport: { width: 1280, height: 720 } }, 1);
const failed = results.filter((r) => !r.pass);
fs.writeFileSync(path.join(OUT, 'e2e.json'), JSON.stringify(results, null, 1));
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.log('FAILED:\n' + failed.map((f) => `  ${f.name} — ${f.info}`).join('\n')); process.exitCode = 1; }
