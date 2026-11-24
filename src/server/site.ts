// The public-site side of the server: waitlist, feedback, anonymous usage events, the announcement banner and the
// admin API. Kept apart from the game store (store.ts): contact details live in their own file (data/site.json) and
// events are appended to one file per day (data/events/YYYY-MM-DD.ndjson), so the game's db.json never holds them.
// No third-party trackers, no raw IPs on disk (IPs are only kept in memory for rate limits).
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import { DATA_DIR, db } from './store';
import type { Res } from './fight';
import { HEROES_BY_ID } from '../sim/heroes';

const SITE_FILE = join(DATA_DIR, 'site.json');
const EVENTS_DIR = join(DATA_DIR, 'events');
const WAITLIST_CAP = 50_000;
const FEEDBACK_CAP = 20_000;

export interface WaitEntry {
  id: string;
  telegram?: string;
  x?: string;
  email?: string;
  wallet?: string;
  lang: 'th' | 'en';
  src: string;
  at: number;
}
export interface FeedbackEntry {
  id: string;
  rating?: number;
  text: string;
  screen: string;
  runId?: string;
  hero?: string;
  wins?: number;
  lang: 'th' | 'en';
  device: string;
  ver: string;
  at: number;
  done?: boolean;
}
export interface Announce {
  on: boolean;
  th: string;
  en: string;
  at: number;
}
interface Site {
  waitlist: WaitEntry[];
  feedback: FeedbackEntry[];
  announce: Announce;
}

function loadSite(): Site {
  let d: Partial<Site> = {};
  try {
    d = JSON.parse(readFileSync(SITE_FILE, 'utf8')) as Partial<Site>;
  } catch {
    /* first run */
  }
  return {
    waitlist: Array.isArray(d.waitlist) ? d.waitlist : [],
    feedback: Array.isArray(d.feedback) ? d.feedback : [],
    announce: d.announce && typeof d.announce === 'object' ? d.announce : { on: false, th: '', en: '', at: 0 },
  };
}
export const site = loadSite();

let timer: NodeJS.Timeout | null = null;
function saveSite() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    if (site.waitlist.length > WAITLIST_CAP) site.waitlist.splice(0, site.waitlist.length - WAITLIST_CAP);
    if (site.feedback.length > FEEDBACK_CAP) site.feedback.splice(0, site.feedback.length - FEEDBACK_CAP);
    try {
      mkdirSync(DATA_DIR, { recursive: true });
      writeFileSync(SITE_FILE + '.tmp', JSON.stringify(site));
      renameSync(SITE_FILE + '.tmp', SITE_FILE);
    } catch (e) {
      console.error('could not save', SITE_FILE, (e as Error).message);
    }
  }, 300);
}

// ---------- rate limits (memory only) ----------
const hits = new Map<string, number[]>();
/** true when `key` made fewer than `max` calls in the last `ms` (and counts this one) */
function allow(key: string, max: number, ms: number): boolean {
  const now = Date.now();
  const list = (hits.get(key) ?? []).filter((t) => now - t < ms);
  if (list.length >= max) {
    hits.set(key, list);
    return false;
  }
  list.push(now);
  hits.set(key, list);
  if (hits.size > 50_000) prune(now);
  return true;
}
/** Drop keys whose calls are all older than an hour (the longest window); never a bulk clear. */
function prune(now: number) {
  for (const [k, list] of hits) if (!list.length || now - list[list.length - 1] > 3_600_000) hits.delete(k);
}
// wrong admin tokens: kept apart from the public limits (nothing a visitor does can flush them), per IP and in total
const admFails = new Map<string, number[]>();
const ADM_WINDOW = 600_000;
function admFailCount(key: string, now: number): number {
  const list = (admFails.get(key) ?? []).filter((t) => now - t < ADM_WINDOW);
  admFails.set(key, list);
  return list.length;
}
function admFail(key: string, now: number) {
  admFails.get(key)!.push(now);
  if (admFails.size > 10_000) for (const [k, l] of admFails) if (!l.length || now - l[l.length - 1] > ADM_WINDOW) admFails.delete(k);
}

// ---------- helpers ----------
const bad = (error: string, status = 400): Res => ({ status, json: { error } });
const str = (x: unknown, max: number) => (typeof x === 'string' ? x.trim().slice(0, max) : '');
const lang = (x: unknown): 'th' | 'en' => (x === 'th' ? 'th' : 'en');
/** a short, case-insensitive key: one person, one entry */
const norm = (s: string) => s.replace(/^@/, '').toLowerCase();
export const dayOf = (t: number) => new Date(t).toISOString().slice(0, 10);

const TG = /^@?[A-Za-z][A-Za-z0-9_]{4,31}$/;
const XH = /^@?[A-Za-z0-9_]{1,15}$/;
const EMAIL = /^[^\s@<>]{1,64}@[^\s@<>]{1,190}\.[A-Za-z]{2,24}$/;
const SOL = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// ---------- events ----------
/** Event names the browser may send. Server-side events (fight, run_end, waitlist, feedback) are added by the server. */
const CLIENT_EVENTS = new Set(['landing_view', 'play_click', 'game_open', 'tutorial_start', 'tutorial_done', 'run_start', 'feedback_open', 'docs_view']);
const PROP_KEYS = ['screen', 'hero', 'src', 'lang', 'device', 'day', 'wins'] as const;

export interface EventRow {
  e: string;
  t: number;
  /** anonymous visitor id (random, per browser) */
  v?: string;
  /** game player id, when the event came from the game */
  p?: string;
  [k: string]: unknown;
}

export function logEvent(row: EventRow) {
  try {
    mkdirSync(EVENTS_DIR, { recursive: true });
    appendFileSync(join(EVENTS_DIR, dayOf(row.t) + '.ndjson'), JSON.stringify(row) + '\n');
  } catch (e) {
    console.error('could not log event', (e as Error).message);
  }
}

const ID = /^[\w-]{6,64}$/;
export function handleEvents(body: any, ip: string): Res {
  if (!allow('ev:' + ip, 240, 60_000)) return bad('slow down', 429);
  const list = Array.isArray(body?.events) ? body.events.slice(0, 30) : [];
  const v = typeof body?.v === 'string' && ID.test(body.v) ? body.v : undefined;
  const p = typeof body?.p === 'string' && ID.test(body.p) ? body.p : undefined;
  let n = 0;
  for (const ev of list) {
    const e = String(ev?.e ?? '');
    if (!CLIENT_EVENTS.has(e)) continue;
    const row: EventRow = { e, t: Date.now(), v, p };
    for (const k of PROP_KEYS) {
      const x = ev?.[k];
      if (typeof x === 'number' && Number.isFinite(x)) row[k] = Math.max(0, Math.min(999, Math.round(x)));
      else if (typeof x === 'string') row[k] = x.slice(0, 24).replace(/[^\w.-]/g, '');
    }
    logEvent(row);
    n++;
  }
  return { status: 200, json: { ok: n } };
}

// ---------- waitlist ----------
export function handleWaitlist(body: any, ip: string): Res {
  if (str(body?.hp, 100)) return { status: 200, json: { ok: true } }; // honeypot: bots fill every field
  if (body?.consent !== true) return bad('consent required');
  const telegram = str(body?.telegram, 40);
  const x = str(body?.x, 20);
  const email = str(body?.email, 254);
  const wallet = str(body?.wallet, 50);
  if (!telegram && !x && !email) return bad('add a Telegram, X or email');
  if (telegram && !TG.test(telegram)) return bad('Telegram username looks wrong');
  if (x && !XH.test(x)) return bad('X handle looks wrong');
  if (email && !EMAIL.test(email)) return bad('email looks wrong');
  if (wallet && !SOL.test(wallet)) return bad('Solana address looks wrong');
  // the limit counts well-formed sign-ups only: a typo answers 400 and does not use up the person's tries
  if (!allow('wl:' + ip, 6, 3_600_000)) return bad('too many sign-ups from here, try later', 429);
  const keys = [telegram && 'tg:' + norm(telegram), x && 'x:' + norm(x), email && 'em:' + email.toLowerCase()].filter(Boolean) as string[];
  const known = site.waitlist.find((w) =>
    keys.some((k) => k === 'tg:' + norm(w.telegram ?? '') || k === 'x:' + norm(w.x ?? '') || k === 'em:' + (w.email ?? '').toLowerCase()),
  );
  // the same answer whether or not the contact was already on the list: the form must not tell who signed up
  if (known) return { status: 200, json: { ok: true } };
  const entry: WaitEntry = {
    id: randomUUID(),
    ...(telegram ? { telegram: '@' + telegram.replace(/^@/, '') } : {}),
    ...(x ? { x: '@' + x.replace(/^@/, '') } : {}),
    ...(email ? { email } : {}),
    ...(wallet ? { wallet } : {}),
    lang: lang(body?.lang),
    src: str(body?.src, 24).replace(/[^\w.-]/g, '') || 'site',
    at: Date.now(),
  };
  site.waitlist.push(entry);
  saveSite();
  logEvent({ e: 'waitlist', t: entry.at, v: ID.test(String(body?.v)) ? body.v : undefined, src: entry.src });
  return { status: 200, json: { ok: true } };
}

// ---------- feedback ----------
export function handleFeedback(body: any, ip: string): Res {
  if (str(body?.hp, 100)) return { status: 200, json: { ok: true } };
  if (!allow('fb:' + ip, 20, 3_600_000)) return bad('too much feedback from here, try later', 429);
  const rating = Number.isInteger(body?.rating) && body.rating >= 1 && body.rating <= 5 ? body.rating : undefined;
  const text = str(body?.text, 1000);
  if (!rating && !text) return bad('add a rating or a few words');
  const hero = HEROES_BY_ID[String(body?.hero ?? '')] ? String(body.hero) : undefined;
  const wins = Number.isInteger(body?.wins) && body.wins >= 0 && body.wins <= 99 ? body.wins : undefined;
  const runId = typeof body?.runId === 'string' && ID.test(body.runId) ? body.runId : undefined;
  const entry: FeedbackEntry = {
    id: randomUUID(),
    ...(rating ? { rating } : {}),
    text,
    screen: str(body?.screen, 24).replace(/[^\w.-]/g, '') || 'game',
    ...(runId ? { runId } : {}),
    ...(hero ? { hero } : {}),
    ...(wins !== undefined ? { wins } : {}),
    lang: lang(body?.lang),
    device: body?.device === 'phone' ? 'phone' : body?.device === 'tablet' ? 'tablet' : 'desktop',
    ver: str(body?.ver, 16).replace(/[^\w.-]/g, ''),
    at: Date.now(),
  };
  site.feedback.push(entry);
  saveSite();
  logEvent({ e: 'feedback', t: entry.at, rating, screen: entry.screen });
  return { status: 200, json: { ok: true } };
}

export function handleAnnounce(): Res {
  const a = site.announce;
  return { status: 200, json: a.on ? { on: true, th: a.th, en: a.en, at: a.at } : { on: false } };
}

// ---------- admin ----------
const TOKEN = process.env.ADMIN_TOKEN ?? '';
const tokenHash = createHash('sha256').update(TOKEN).digest();
/** null = allowed; otherwise the response to send */
export function adminGate(auth: string | undefined, ip: string): Res | null {
  if (TOKEN.length < 16) return bad('admin is off: set ADMIN_TOKEN (16+ characters) on the server', 503);
  if (!allow('adm:' + ip, 120, 60_000)) return bad('slow down', 429);
  const now = Date.now();
  // 10 wrong tokens per IP, or 50 in total (a faked IP header cannot get around that one), per 10 minutes
  if (admFailCount('ip:' + ip, now) >= 10 || admFailCount('all', now) >= 50) return bad('too many wrong tokens, try later', 429);
  const given = (auth ?? '').replace(/^Bearer\s+/i, '');
  const ok = timingSafeEqual(createHash('sha256').update(given).digest(), tokenHash);
  if (ok) return null;
  admFail('ip:' + ip, now);
  admFail('all', now);
  return bad('wrong token', 401);
}

function readEvents(days: string[]): EventRow[] {
  const out: EventRow[] = [];
  for (const d of days) {
    const f = join(EVENTS_DIR, d + '.ndjson');
    if (!existsSync(f)) continue;
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      if (!line) continue;
      try {
        out.push(JSON.parse(line) as EventRow);
      } catch {
        /* skip a torn line */
      }
    }
  }
  return out;
}

function lastDays(n: number): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(dayOf(Date.now() - i * 864e5));
  return out;
}

export function adminOverview(q: URLSearchParams): Res {
  const n = Math.max(1, Math.min(60, Number(q.get('days')) || 14));
  const days = lastDays(n);
  const evs = readEvents(days);
  const perDay = days.map((d) => {
    const es = evs.filter((e) => dayOf(e.t) === d);
    const uniq = (name: string, key: 'v' | 'p') => new Set(es.filter((e) => e.e === name && e[key]).map((e) => e[key])).size;
    const players = new Set(es.filter((e) => e.p && (e.e === 'game_open' || e.e === 'fight')).map((e) => e.p)).size;
    return {
      day: d,
      visitors: uniq('landing_view', 'v'),
      playClicks: uniq('play_click', 'v'),
      players,
      fights: es.filter((e) => e.e === 'fight').length,
      runs: es.filter((e) => e.e === 'run_end').length,
      waitlist: es.filter((e) => e.e === 'waitlist').length,
      feedback: es.filter((e) => e.e === 'feedback').length,
    };
  });
  // funnel over the window, by visitor / player
  const setOf = (name: string, key: 'v' | 'p', f: (e: EventRow) => boolean = () => true) =>
    new Set(evs.filter((e) => e.e === name && e[key] && f(e)).map((e) => e[key] as string));
  const funnel = [
    { step: 'landing', n: setOf('landing_view', 'v').size },
    { step: 'play_click', n: setOf('play_click', 'v').size },
    { step: 'game_open', n: setOf('game_open', 'p').size },
    { step: 'first_fight', n: setOf('fight', 'p', (e) => e.day === 1).size },
    { step: 'run_end', n: setOf('run_end', 'p').size },
    { step: 'waitlist', n: evs.filter((e) => e.e === 'waitlist').length },
  ];
  // day-1 retention: players first seen on day d who came back on d+1
  const firstSeen = new Map<string, string>();
  const seenOn = new Map<string, Set<string>>();
  for (const e of evs) {
    if (!e.p) continue;
    const d = dayOf(e.t);
    if (!firstSeen.has(e.p) || firstSeen.get(e.p)! > d) firstSeen.set(e.p, d);
    if (!seenOn.has(e.p)) seenOn.set(e.p, new Set());
    seenOn.get(e.p)!.add(d);
  }
  let cohort = 0;
  let back = 0;
  for (const [p, d] of firstSeen) {
    const next = dayOf(Date.parse(d) + 864e5);
    if (next > dayOf(Date.now() - 864e5)) continue; // cohort day+1 not over yet
    cohort++;
    if (seenOn.get(p)!.has(next)) back++;
  }
  // heroes from real finished runs in the window
  const heroes: Record<string, { runs: number; wins: number; clears: number }> = {};
  for (const e of evs) {
    if (e.e !== 'run_end' || typeof e.hero !== 'string') continue;
    const h = (heroes[e.hero] ??= { runs: 0, wins: 0, clears: 0 });
    h.runs++;
    h.wins += Number(e.wins) || 0;
    if (e.won) h.clears++;
  }
  const lang = { th: 0, en: 0 } as Record<string, number>;
  const device = { phone: 0, tablet: 0, desktop: 0 } as Record<string, number>;
  for (const e of evs) {
    if (e.e !== 'game_open') continue;
    if (typeof e.lang === 'string' && e.lang in lang) lang[e.lang]++;
    if (typeof e.device === 'string' && e.device in device) device[e.device]++;
  }
  return {
    status: 200,
    json: {
      days: n,
      totals: {
        players: Object.keys(db.players).length,
        runs: db.runs.length,
        fights: db.fights.length,
        waitlist: site.waitlist.length,
        feedback: site.feedback.length,
        feedbackOpen: site.feedback.filter((f) => !f.done).length,
      },
      perDay,
      funnel,
      retentionD1: { cohort, back },
      heroes,
      lang,
      device,
    },
  };
}

export const adminFeedback = (): Res => ({ status: 200, json: { rows: [...site.feedback].reverse().slice(0, 500) } });

export function adminFeedbackDone(body: any): Res {
  const f = site.feedback.find((x) => x.id === body?.id);
  if (!f) return bad('not found', 404);
  f.done = body?.done !== false;
  saveSite();
  return { status: 200, json: { ok: true } };
}

export const adminWaitlist = (): Res => ({ status: 200, json: { rows: [...site.waitlist].reverse() } });

export function waitlistCsv(): string {
  const cell = (s: unknown) => {
    const v = String(s ?? '');
    // a leading = + - @ would run as a formula in a spreadsheet
    const safe = /^[=+\-@]/.test(v) && !/^@[A-Za-z0-9_]+$/.test(v) ? "'" + v : v;
    return '"' + safe.replace(/"/g, '""') + '"';
  };
  const head = ['at', 'telegram', 'x', 'email', 'wallet', 'lang', 'src'];
  const rows = site.waitlist.map((w) => [new Date(w.at).toISOString(), w.telegram, w.x, w.email, w.wallet, w.lang, w.src].map(cell).join(','));
  return [head.join(','), ...rows].join('\n') + '\n';
}

export function adminRuns(): Res {
  const runs = [...db.runs].reverse().slice(0, 100).map((r) => ({
    runId: r.runId, name: r.name, hero: r.hero, wins: r.wins, losses: r.losses, day: r.day, finishedAt: r.finishedAt,
  }));
  const fights = [...db.fights].reverse().slice(0, 50).map((f) => ({
    id: f.id, day: f.day, a: f.a.name, b: f.b.name, ai: f.b.ai, winner: f.winner, at: f.createdAt,
  }));
  return { status: 200, json: { runs, fights } };
}

export function adminAnnounce(body: any): Res {
  site.announce = { on: body?.on === true, th: str(body?.th, 200), en: str(body?.en, 200), at: Date.now() };
  saveSite();
  return { status: 200, json: { ok: true, announce: site.announce } };
}
