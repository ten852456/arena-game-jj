// Static files from dist/ (perf pass, v0.0.1). Before: no compression and no cache headers, so every visit
// downloaded the whole game again (≈2 MB of JS + 1 MB of images). Now:
// - hashed build files (/assets/<name>-<hash>.js|css) are cached for a year (immutable: a new build has new names)
// - other files (images, sounds) are cached for a day, with an ETag so a reload is a 304
// - HTML is always revalidated (no-cache + ETag), so a deploy is seen at once
// - text files are sent brotli- or gzip-compressed; each compressed copy is made once (async) and kept in memory
import { createReadStream, existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { promisify } from 'node:util';
import { brotliCompress, constants, gzip } from 'node:zlib';
import type { IncomingMessage, ServerResponse } from 'node:http';

const br = promisify(brotliCompress);
const gz = promisify(gzip);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp',
  '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.webm': 'audio/webm',
  '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json',
};
const COMPRESS = new Set(['.html', '.js', '.css', '.json', '.svg', '.txt', '.webmanifest']);
/** a Vite build file: name-<8+ char hash>.js|css under /assets/ */
const HASHED = /[\\/]assets[\\/][^\\/]+-[A-Za-z0-9_-]{8,}\.(js|css)$/;

/** compressed copies: path → { key (mtime + size), br, gzip } — at most a few MB (the build's text files) */
const packed = new Map<string, { key: string; br?: Buffer; gzip?: Buffer }>();

function cacheControl(p: string, ext: string) {
  if (HASHED.test(p)) return 'public, max-age=31536000, immutable';
  if (ext === '.html') return 'no-cache';
  return 'public, max-age=86400';
}

async function compressed(p: string, key: string, enc: 'br' | 'gzip'): Promise<Buffer> {
  let e = packed.get(p);
  if (!e || e.key !== key) packed.set(p, (e = { key }));
  const have = e[enc];
  if (have) return have;
  const raw = await readFile(p);
  const out = enc === 'br' ? await br(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } }) : await gz(raw, { level: 9 });
  e[enc] = out;
  return out;
}

/** Serve a file of `dist` for `url`; /play and /admin are their own pages, anything unknown gets the landing page. */
export async function serveStatic(dist: string, req: IncomingMessage, res: ServerResponse, url: string, notBuilt: () => void) {
  if (!existsSync(dist)) return notBuilt();
  let p = normalize(join(dist, decodeURIComponent(url.split('?')[0])));
  // inside dist only (a bare prefix test would also accept a sibling such as dist-old)
  if (p !== dist && !p.startsWith(dist + sep)) {
    res.writeHead(403, { 'content-type': 'application/json' });
    return res.end('{"error":"forbidden"}');
  }
  if (existsSync(p) && statSync(p).isDirectory() && existsSync(join(p, 'index.html'))) p = join(p, 'index.html');
  else if (!existsSync(p) || statSync(p).isDirectory()) p = join(dist, 'index.html');
  const st = statSync(p);
  const ext = extname(p);
  const key = `${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}`;
  const etag = `W/"${key}"`;
  const headers: Record<string, string> = {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': cacheControl(p, ext),
    etag,
  };
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers);
    return res.end();
  }
  const accept = String(req.headers['accept-encoding'] ?? '');
  const enc = !COMPRESS.has(ext) ? null : /\bbr\b/.test(accept) ? 'br' : /\bgzip\b/.test(accept) ? 'gzip' : null;
  if (enc) {
    const body = await compressed(p, key, enc);
    res.writeHead(200, { ...headers, 'content-encoding': enc, vary: 'Accept-Encoding', 'content-length': String(body.length) });
    return res.end(body);
  }
  res.writeHead(200, { ...headers, ...(COMPRESS.has(ext) ? { vary: 'Accept-Encoding' } : {}), 'content-length': String(st.size) });
  createReadStream(p).pipe(res);
}
