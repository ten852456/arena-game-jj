// Tiny async-PvP server: stores each player's build per day, matches by build rating (no repeat opponents in a run,
// tiered AI fallback), runs the fight, keeps fights so replays can be shared by link, and records finished runs
// for the stardust reward, profiles and leaderboards. API: docs/API.md. Storage: ./store.ts (data/db.json).
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { serveStatic } from './http/static';
import { handleFight, handleScout, type Res } from './routes/fight';
import { handleFinish, handleLeaderboard, handleProfile, handleRename } from './routes/meta';
import { ROOT, db, saveNow } from './store';
import { handleFarmGet, handleFarmOps, handleFeed, handleHatch } from './routes/farm';
import { handleRankedOffer } from './routes/ranked';
import { adminVaultGrant, handleVaultGet, handleVaultOps } from './routes/vault';
import { adminEconomy } from './game/ledger';
import { WIN_TARGET } from '../sim/run';
import { cleanName, isDefaultName } from './game/validate';
import {
  adminAnnounce, adminFeedback, adminFeedbackDone, adminGate, adminOverview, adminRuns, adminWaitlist, handleAnnounce,
  handleEvents, handleFeedback, handleWaitlist, logEvent, waitlistCsv,
} from './routes/site';

const PORT = Number(process.env.PORT ?? 8787);
/** the running game version (package.json): open tabs compare it with theirs and offer a reload */
const VERSION = String(JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version ?? '0.0.0');
const DIST = join(ROOT, 'dist');

// builds saved before unique default names all say "ผู้เล่น": give them their Mochi-1234 name
for (const s of db.snapshots) if (isDefaultName(s.name)) s.name = cleanName('', s.playerId ?? s.runId);

function send(res: ServerResponse, status: number, json: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(json));
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((ok, fail) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > 64 * 1024) {
        fail(new Error('too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        ok(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch (e) {
        fail(e);
      }
    });
  });
}

/**
 * The caller's IP, for rate limits only (never written to disk). Behind Railway's proxy: x-real-ip, else the LAST
 * x-forwarded-for entry (the one the proxy added; earlier entries come from the client and can be faked). If a header
 * is faked anyway, the limits that matter also have a global cap (admin tokens: site.ts).
 */
function ipOf(req: IncomingMessage): string {
  const real = String(req.headers['x-real-ip'] ?? '').trim();
  const fwd = String(req.headers['x-forwarded-for'] ?? '').split(',').map((s) => s.trim()).filter(Boolean).at(-1);
  return real || fwd || req.socket.remoteAddress || '?';
}

type Route = (req: IncomingMessage, q: URLSearchParams) => Res | Promise<Res>;
const routes: Record<string, Route> = {
  'POST /api/fight': async (req) => {
    const body: any = await readBody(req);
    const r = handleFight(body, ipOf(req));
    const j: any = r.status === 200 ? r.json : null;
    if (j) logEvent({ e: 'fight', t: Date.now(), p: typeof body?.playerId === 'string' ? body.playerId.slice(0, 64) : undefined, day: j.day, won: !!j.won, ai: !!j.opponent?.ai, tut: !!j.tutorial });
    return r;
  },
  'POST /api/run/finish': async (req) => {
    const body: any = await readBody(req);
    const r = handleFinish(body);
    const j: any = r.status === 200 ? r.json : null;
    if (j && !j.already) logEvent({ e: 'run_end', t: Date.now(), p: String(body.playerId).slice(0, 64), hero: j.run?.hero, wins: j.run?.wins, won: (Number(j.run?.wins) || 0) >= WIN_TARGET });
    return r;
  },
  'POST /api/waitlist': async (req) => handleWaitlist(await readBody(req), ipOf(req)),
  'POST /api/feedback': async (req) => handleFeedback(await readBody(req), ipOf(req)),
  'POST /api/events': async (req) => handleEvents(await readBody(req), ipOf(req)),
  'GET /api/announce': () => handleAnnounce(),
  'GET /api/scout': (_req, q) => handleScout(q),
  'GET /api/profile': (_req, q) => handleProfile(q),
  'POST /api/profile/name': async (req) => handleRename(await readBody(req), ipOf(req)),
  'GET /api/leaderboard': (_req, q) => handleLeaderboard(q),
  'GET /api/farm': (_req, q) => handleFarmGet(q),
  'POST /api/farm': async (req) => handleFarmOps(await readBody(req), ipOf(req)),
  'POST /api/farm/hatch': async (req) => handleHatch(await readBody(req)),
  'GET /api/feed': () => handleFeed(),
  'GET /api/vault': (_req, q) => handleVaultGet(q),
  'POST /api/vault': async (req) => handleVaultOps(await readBody(req)),
  'POST /api/ranked/offer': async (req) => handleRankedOffer(await readBody(req), ipOf(req)),
  'GET /api/version': () => ({ status: 200, json: { version: VERSION } }),
  'GET /api/stats': () => ({
    status: 200,
    json: { snapshots: db.snapshots.length, fights: db.fights.length, runs: db.runs.length, players: Object.keys(db.players).length },
  }),
};

/** Admin API: every route needs the ADMIN_TOKEN as a Bearer header. */
const adminRoutes: Record<string, Route> = {
  'GET /api/admin/overview': (_req, q) => adminOverview(q),
  'GET /api/admin/feedback': () => adminFeedback(),
  'POST /api/admin/feedback/done': async (req) => adminFeedbackDone(await readBody(req)),
  'GET /api/admin/waitlist': () => adminWaitlist(),
  'GET /api/admin/runs': () => adminRuns(),
  'GET /api/admin/economy': (_req, q) => adminEconomy(q),
  'POST /api/admin/announce': async (req) => adminAnnounce(await readBody(req)),
  'POST /api/admin/vault/grant': async (req) => adminVaultGrant(await readBody(req)),
};

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  try {
    const key = `${req.method} ${url.pathname}`;
    if (url.pathname.startsWith('/api/admin/')) {
      const denied = adminGate(req.headers.authorization, ipOf(req));
      if (denied) return send(res, denied.status, denied.json);
      if (key === 'GET /api/admin/waitlist.csv') {
        res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="mochi-waitlist.csv"', 'cache-control': 'no-store' });
        return res.end('﻿' + waitlistCsv());
      }
      const ar = adminRoutes[key];
      if (!ar) return send(res, 404, { error: 'not found' });
      const r = await ar(req, url.searchParams);
      return send(res, r.status, r.json);
    }
    const route = routes[key];
    if (route) {
      const r = await route(req, url.searchParams);
      return send(res, r.status, r.json);
    }
    const m = url.pathname.match(/^\/api\/replay\/([\w-]{1,40})$/);
    if (req.method === 'GET' && m) {
      const f = db.fights.find((x) => x.id === m[1]);
      return f ? send(res, 200, f) : send(res, 404, { error: 'replay not found' });
    }
    if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'not found' });
    await serveStatic(DIST, req, res, req.url ?? '/', () => send(res, 404, { error: 'not found (run `npm run build` or use `npm run dev`)' }));
  } catch (e) {
    send(res, 400, { error: String((e as Error).message ?? e) });
  }
}).listen(PORT, () => console.log(`arena server on http://localhost:${PORT}`));

// a deploy or Ctrl+C: write the db once more before going (saves are throttled, see store.ts)
for (const sig of ['SIGTERM', 'SIGINT'] as const)
  process.on(sig, () => {
    saveNow();
    process.exit(0);
  });
