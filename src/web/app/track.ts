// Anonymous usage events for our own admin page (no third-party trackers). A random visitor id per browser, the game's
// player id when there is one, and a handful of allowed event names (the server drops anything else).
// Events are batched and sent with sendBeacon when the page hides, so they never slow the game down.

const VID_KEY = 'mochi.vid';
const PID_KEY = 'mochi.pid';

function store(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function visitorId(): string {
  let v = store(VID_KEY);
  if (!v) {
    v = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
    try {
      localStorage.setItem(VID_KEY, v);
    } catch {
      /* private window: a fresh id per page is fine */
    }
  }
  return v;
}

export function deviceKind(): 'phone' | 'tablet' | 'desktop' {
  const w = Math.min(screen.width, screen.height);
  const touch = matchMedia('(pointer: coarse)').matches;
  if (!touch) return 'desktop';
  return w < 600 ? 'phone' : 'tablet';
}

type Props = Partial<Record<'screen' | 'hero' | 'src' | 'lang' | 'device' | 'day' | 'wins', string | number>>;
let queue: ({ e: string } & Props)[] = [];
let timer: number | undefined;

function flush(beacon = false) {
  if (timer) clearTimeout(timer);
  timer = undefined;
  if (!queue.length) return;
  const body = JSON.stringify({ v: visitorId(), p: store(PID_KEY) ?? undefined, events: queue.splice(0, 30) });
  try {
    if (beacon && navigator.sendBeacon) navigator.sendBeacon('/api/events', new Blob([body], { type: 'application/json' }));
    else void fetch('/api/events', { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true }).catch(() => {});
  } catch {
    /* offline: drop it, stats are best effort */
  }
}

export function track(e: string, props: Props = {}) {
  queue.push({ e, ...props });
  if (queue.length >= 20) flush();
  else if (!timer) timer = window.setTimeout(() => flush(), 4000);
}

addEventListener('pagehide', () => flush(true));
addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flush(true);
});
