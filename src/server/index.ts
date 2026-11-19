// Tiny async-PvP server: stores each player's build per day, matches by build rating (no repeat opponents in a run,
// tiered AI fallback), runs the fight, keeps fights so replays can be shared by link, and records finished runs
// for the stardust reward, profiles and leaderboards. API: docs/API.md. Storage: ./store.ts (data/db.json).
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { handleFight, handleScout, type Res } from './fight';
import { handleFinish, handleLeaderboard, handleProfile } from './meta';
import { ROOT, db } from './store';
import { cleanName, isDefaultName } from './validate';

const PORT = Number(process.env.PORT ?? 8787);
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

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.webp': 'image/webp', '.jpg': 'image/jpeg', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg',
};
function serveStatic(url: string, res: ServerResponse) {
  if (!existsSync(DIST)) return send(res, 404, { error: 'not found (run `npm run build` or use `npm run dev`)' });
  let p = normalize(join(DIST, decodeURIComponent(url.split('?')[0])));
  if (!p.startsWith(DIST)) return send(res, 403, { error: 'forbidden' });
  if (!existsSync(p) || statSync(p).isDirectory()) p = join(DIST, 'index.html');
  res.writeHead(200, { 'content-type': MIME[extname(p)] ?? 'application/octet-stream' });
  createReadStream(p).pipe(res);
}

type Route = (req: IncomingMessage, q: URLSearchParams) => Res | Promise<Res>;
const routes: Record<string, Route> = {
  'POST /api/fight': async (req) => handleFight(await readBody(req)),
  'POST /api/run/finish': async (req) => handleFinish(await readBody(req)),
  'GET /api/scout': (_req, q) => handleScout(q),
  'GET /api/profile': (_req, q) => handleProfile(q),
  'GET /api/leaderboard': (_req, q) => handleLeaderboard(q),
  'GET /api/stats': () => ({
    status: 200,
    json: { snapshots: db.snapshots.length, fights: db.fights.length, runs: db.runs.length, players: Object.keys(db.players).length },
  }),
};

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  try {
    const route = routes[`${req.method} ${url.pathname}`];
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
    serveStatic(req.url ?? '/', res);
  } catch (e) {
    send(res, 400, { error: String((e as Error).message ?? e) });
  }
}).listen(PORT, () => console.log(`arena server on http://localhost:${PORT}`));
