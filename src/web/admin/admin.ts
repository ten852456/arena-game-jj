// /admin: the team's back office. Every call carries the ADMIN_TOKEN (kept in this tab's sessionStorage only).
// Overview (players, funnel, retention, heroes from real runs), feedback inbox, waitlist (+ CSV), recent runs, banner.
import { HEROES_EN } from '../i18n/i18n_en';
import './admin.css';
import { esc } from '../ui/html';

const KEY = 'mochi.admin';
const root = document.getElementById('admin')!;
let token = sessionStorage.getItem(KEY) ?? '';
let tab: 'overview' | 'economy' | 'feedback' | 'waitlist' | 'runs' | 'announce' = 'overview';

const when = (t: number) => new Date(t).toLocaleString();
const pct = (a: number, b: number) => (b ? Math.round((100 * a) / b) + '%' : '–');

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(path, { ...init, headers: { ...(init.headers ?? {}), authorization: 'Bearer ' + token, 'content-type': 'application/json' } });
  if (r.status === 401 || r.status === 503 || r.status === 429) {
    const j = await r.json().catch(() => ({}));
    throw Object.assign(new Error(j.error ?? 'denied'), { auth: true });
  }
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? r.statusText);
  return r.json() as Promise<T>;
}

function login(err = '') {
  root.innerHTML = `<form class="login"><img src="/assets/img/logo.webp" alt="Mochi Moon" width="180">
    <h1>Admin</h1><label>Admin token<input type="password" name="t" autocomplete="current-password" required></label>
    <button>Open</button><p class="err">${esc(err)}</p></form>`;
  root.querySelector('form')!.addEventListener('submit', (e) => {
    e.preventDefault();
    token = String(new FormData(e.target as HTMLFormElement).get('t') ?? '');
    sessionStorage.setItem(KEY, token);
    void show();
  });
}

function shell(body: string) {
  const tabs = ['overview', 'economy', 'feedback', 'waitlist', 'runs', 'announce'] as const;
  root.innerHTML = `<nav class="bar"><img src="/assets/img/logo.webp" alt="" width="110"><b>Admin</b>
    ${tabs.map((t) => `<button data-tab="${t}" aria-pressed="${t === tab}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}
    <span class="sp"></span><a href="/" target="_blank">Site ↗</a><a href="/play" target="_blank">Game ↗</a><button data-out>Log out</button></nav>
    <main>${body}</main>`;
  root.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) =>
    b.addEventListener('click', () => {
      tab = b.dataset.tab as typeof tab;
      void show();
    }),
  );
  root.querySelector('[data-out]')!.addEventListener('click', () => {
    sessionStorage.removeItem(KEY);
    token = '';
    login();
  });
}

interface Overview {
  days: number;
  totals: Record<string, number>;
  perDay: { day: string; visitors: number; playClicks: number; players: number; fights: number; runs: number; waitlist: number; feedback: number }[];
  funnel: { step: string; n: number }[];
  retentionD1: { cohort: number; back: number };
  heroes: Record<string, { runs: number; wins: number; clears: number }>;
  lang: Record<string, number>;
  device: Record<string, number>;
}

/** one small bar chart per metric: one hue, a value on every bar, the day under it */
function bars(title: string, rows: { label: string; v: number }[]) {
  const max = Math.max(1, ...rows.map((r) => r.v));
  return `<figure class="chart"><figcaption>${esc(title)}</figcaption><div class="bars">${rows
    .map((r) => `<div class="b" title="${esc(r.label)}: ${r.v}"><span class="v">${r.v || ''}</span><i style="height:${(r.v / max) * 100}%"></i><span class="d">${esc(r.label.slice(5))}</span></div>`)
    .join('')}</div></figure>`;
}

async function overview() {
  const o = await call<Overview>('/api/admin/overview?days=14');
  const T = o.totals;
  const tiles: [string, number | string][] = [
    ['Players (all time)', T.players], ['Finished runs kept', T.runs], ['Waitlist', T.waitlist],
    ['Feedback (open)', `${T.feedback} (${T.feedbackOpen})`], ['D1 retention', `${pct(o.retentionD1.back, o.retentionD1.cohort)} of ${o.retentionD1.cohort}`],
  ];
  const top = o.funnel[0]?.n || 0;
  const heroRows = Object.entries(o.heroes).sort((a, b) => b[1].runs - a[1].runs);
  const totalRuns = heroRows.reduce((n, [, h]) => n + h.runs, 0);
  return `
    <section class="tiles">${tiles.map(([k, v]) => `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}</section>
    <section class="grid2">
      ${bars('Players per day', o.perDay.map((d) => ({ label: d.day, v: d.players })))}
      ${bars('Landing visitors per day', o.perDay.map((d) => ({ label: d.day, v: d.visitors })))}
      ${bars('Finished runs per day', o.perDay.map((d) => ({ label: d.day, v: d.runs })))}
      ${bars('Waitlist sign-ups per day', o.perDay.map((d) => ({ label: d.day, v: d.waitlist })))}
    </section>
    <section class="grid2">
      <div class="card"><h2>Funnel · last ${o.days} days</h2>${o.funnel
        .map((f) => `<div class="fn"><span>${esc(f.step.replace('_', ' '))}</span><div class="fnbar"><i style="width:${top ? (100 * f.n) / top : 0}%"></i></div><b>${f.n}</b><em>${pct(f.n, top)}</em></div>`)
        .join('')}<p class="note">Landing and Play are counted per browser; game steps per player id. Players who open /play directly skip the first two steps.</p></div>
      <div class="card"><h2>Heroes · real finished runs</h2>${
        heroRows.length
          ? `<table><thead><tr><th>Hero</th><th>Runs</th><th>Pick</th><th>Avg wins</th><th>Cleared</th></tr></thead><tbody>${heroRows
              .map(([id, h]) => `<tr><td>${esc(HEROES_EN[id]?.name ?? id)}</td><td>${h.runs}</td><td>${pct(h.runs, totalRuns)}</td><td>${(h.wins / h.runs).toFixed(1)}</td><td>${pct(h.clears, h.runs)}</td></tr>`)
              .join('')}</tbody></table>`
          : '<p class="note">No finished runs in this window yet.</p>'
      }</div>
    </section>
    <section class="grid2">
      <div class="card"><h2>Language (game opens)</h2><p>TH ${o.lang.th ?? 0} · EN ${o.lang.en ?? 0}</p></div>
      <div class="card"><h2>Device (game opens)</h2><p>Phone ${o.device.phone ?? 0} · Tablet ${o.device.tablet ?? 0} · Desktop ${o.device.desktop ?? 0}</p></div>
    </section>`;
}

interface Fb { id: string; rating?: number; text: string; screen: string; hero?: string; wins?: number; lang: string; device: string; ver: string; at: number; done?: boolean }
interface Economy {
  days: number;
  rows: ({ day: string } & Record<string, { mint: number; burn: number }>)[];
  total: Record<string, { mint: number; burn: number; ratio: number | null }>;
  target: Record<string, [number, number]>;
}
/** Mint / burn per resource (server ledger.ts): is anything piling up? Wood and ore aim for burn/mint 0.8–1.0. */
async function economy() {
  const o = await call<Economy>('/api/admin/economy?days=30');
  const RES = ['wood', 'ore', 'crystal', 'stardust', 'tickets'];
  const flag = (r: string) => {
    const t = o.target[r];
    const x = o.total[r]?.ratio;
    return t && x !== null && x !== undefined && (x < t[0] || x > t[1]) ? ' class="warn"' : '';
  };
  return `<section class="card"><h2>Economy · mint and burn, last ${o.days} days</h2>
    <p class="note">Mint = what the game created (collects, rewards, crafted tickets). Burn = what players spent (upgrades, tickets, unlocks, the monument). Target for wood and ore: burn/mint 0.8–1.0; below that, resources pile up.</p>
    <table><thead><tr><th>Resource</th><th>Mint</th><th>Burn</th><th>Burn/mint</th></tr></thead><tbody>${RES.map(
      (r) => `<tr${flag(r)}><td>${esc(r)}</td><td>${o.total[r]?.mint ?? 0}</td><td>${o.total[r]?.burn ?? 0}</td><td>${o.total[r]?.ratio ?? '–'}</td></tr>`,
    ).join('')}</tbody></table></section>
    <section class="card"><h2>Per day</h2><table><thead><tr><th>Day</th>${RES.map((r) => `<th>${esc(r)} +/−</th>`).join('')}</tr></thead><tbody>${[...o.rows]
      .reverse()
      .map((row) => `<tr><td>${esc(row.day)}</td>${RES.map((r) => `<td>${row[r]?.mint ?? 0} / ${row[r]?.burn ?? 0}</td>`).join('')}</tr>`)
      .join('')}</tbody></table></section>`;
}

async function feedback() {
  const { rows } = await call<{ rows: Fb[] }>('/api/admin/feedback');
  if (!rows.length) return '<p class="note">No feedback yet.</p>';
  return `<section class="list">${rows
    .map((f) => `<article class="fb ${f.done ? 'done' : ''}"><header><b>${f.rating ? '★'.repeat(f.rating) + '☆'.repeat(5 - f.rating) : '—'}</b>
      <span>${esc(f.screen)}${f.hero ? ' · ' + esc(HEROES_EN[f.hero]?.name ?? f.hero) : ''}${f.wins !== undefined ? ' · ' + f.wins + ' wins' : ''} · ${esc(f.lang)} · ${esc(f.device)} · ${esc(f.ver)}</span>
      <time>${when(f.at)}</time><button data-done="${f.id}" data-v="${!f.done}">${f.done ? 'Reopen' : 'Mark done'}</button></header>
      ${f.text ? `<p>${esc(f.text)}</p>` : ''}</article>`)
    .join('')}</section>`;
}

interface Wait { id: string; telegram?: string; x?: string; email?: string; wallet?: string; lang: string; src: string; at: number }
async function waitlist() {
  const { rows } = await call<{ rows: Wait[] }>('/api/admin/waitlist');
  return `<div class="row"><b>${rows.length} people</b><button data-csv>Download CSV</button></div>
    <table class="wide"><thead><tr><th>#</th><th>When</th><th>Telegram</th><th>X</th><th>Email</th><th>Wallet</th><th>Lang</th><th>From</th></tr></thead><tbody>${rows
      .map((w, i) => `<tr><td>${rows.length - i}</td><td>${when(w.at)}</td><td>${esc(w.telegram)}</td><td>${esc(w.x)}</td><td>${esc(w.email)}</td><td class="mono">${esc(w.wallet ? w.wallet.slice(0, 4) + '…' + w.wallet.slice(-4) : '')}</td><td>${esc(w.lang)}</td><td>${esc(w.src)}</td></tr>`)
      .join('')}</tbody></table>`;
}

async function runs() {
  const r = await call<{ runs: { runId: string; name: string; hero: string; wins: number; losses: number; finishedAt: number }[]; fights: { id: string; day: number; a: string; b: string; ai: boolean; winner: number; at: number }[] }>('/api/admin/runs');
  return `<section class="grid2"><div class="card"><h2>Recent finished runs</h2><table><thead><tr><th>When</th><th>Player</th><th>Hero</th><th>W–L</th></tr></thead><tbody>${r.runs
    .map((x) => `<tr><td>${when(x.finishedAt)}</td><td>${esc(x.name)}</td><td>${esc(HEROES_EN[x.hero]?.name ?? x.hero)}</td><td>${x.wins}–${x.losses}</td></tr>`)
    .join('')}</tbody></table></div>
    <div class="card"><h2>Recent fights</h2><table><thead><tr><th>When</th><th>Day</th><th>Fight</th><th></th></tr></thead><tbody>${r.fights
      .map((f) => `<tr><td>${when(f.at)}</td><td>${f.day}</td><td>${esc(f.a)} vs ${esc(f.b)}${f.ai ? ' (AI)' : ''}</td><td><a href="/play?replay=${encodeURIComponent(f.id)}" target="_blank">replay</a></td></tr>`)
      .join('')}</tbody></table></div></section>`;
}

async function announce() {
  const a = await fetch('/api/announce').then((r) => r.json()).catch(() => ({ on: false }));
  return `<form class="card ann"><h2>Banner on the game</h2><p class="note">Shown once per player at the top of /play until they close it.</p>
    <label>Thai<input name="th" maxlength="200" value="${esc(a.th ?? '')}"></label>
    <label>English<input name="en" maxlength="200" value="${esc(a.en ?? '')}"></label>
    <label class="check"><input type="checkbox" name="on" ${a.on ? 'checked' : ''}> Show it</label>
    <button>Save</button><span class="ok"></span></form>`;
}

async function show() {
  if (!token) return login();
  try {
    const body = await { overview, economy, feedback, waitlist, runs, announce }[tab]();
    shell(body);
    bindTab();
  } catch (e) {
    if ((e as { auth?: boolean }).auth) {
      sessionStorage.removeItem(KEY);
      token = '';
      return login((e as Error).message);
    }
    shell(`<p class="err">${esc((e as Error).message)}</p>`);
  }
}

function bindTab() {
  root.querySelectorAll<HTMLButtonElement>('[data-done]').forEach((b) =>
    b.addEventListener('click', async () => {
      await call('/api/admin/feedback/done', { method: 'POST', body: JSON.stringify({ id: b.dataset.done, done: b.dataset.v === 'true' }) });
      void show();
    }),
  );
  root.querySelector('[data-csv]')?.addEventListener('click', async () => {
    const r = await fetch('/api/admin/waitlist.csv', { headers: { authorization: 'Bearer ' + token } });
    if (!r.ok) return;
    const url = URL.createObjectURL(await r.blob());
    const a = Object.assign(document.createElement('a'), { href: url, download: `mochi-waitlist-${new Date().toISOString().slice(0, 10)}.csv` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  });
  const ann = root.querySelector<HTMLFormElement>('form.ann');
  ann?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(ann);
    await call('/api/admin/announce', { method: 'POST', body: JSON.stringify({ th: f.get('th'), en: f.get('en'), on: f.get('on') === 'on' }) });
    ann.querySelector('.ok')!.textContent = 'Saved ✓';
  });
}

void show();
