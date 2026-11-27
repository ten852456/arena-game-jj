/**
 * Graphics quality: three tiers (high / medium / low), picked automatically from the device or set by the player.
 *
 * Layers a tier controls:
 * - render:   frame cap (low = 30 fps) and canvas scale (low = 1.5× instead of 2×, applied on the next load)
 * - fight fx: how many particles a skill spawns, the victory confetti
 * - arena:    falling petals, bunnies hopping in the stands
 * - town:     the hover glow on buildings (a WebGL shader per building)
 * - page:     the DOM night sky, glass blur, purely decorative looping CSS animations (html[data-perf])
 *
 * Auto mode: phones start at medium (low if the browser reports ≤ 2 GB memory or data saver), computers start at
 * high (medium for ≤ 4 cores or ≤ 4 GB). While playing, a watchdog drops one tier when the frame rate stays low,
 * and remembers that for a week so the next visit starts at the tier that ran well.
 * prefers-reduced-motion is separate (fx.ts / idle.ts) and still wins: no particles at any tier.
 */
import type Phaser from 'phaser';

export type Tier = 'high' | 'medium' | 'low';
export type PerfMode = 'auto' | Tier;
export const TIERS: Tier[] = ['high', 'medium', 'low'];

export interface Profile {
  tier: Tier;
  /** frame cap, 0 = the display's rate */
  fps: number;
  /** canvas pixels per world unit (view.ts ZOOM); read once at boot */
  zoom: number;
  /** particle count multiplier for skill effects */
  fx: number;
  /** falling petals in the arena (of 12) */
  petals: number;
  /** bunnies in the stands hop */
  hops: boolean;
  /** glow shader on hovered town buildings */
  hoverGlow: boolean;
  /** confetti pieces multiplier */
  confetti: number;
}

export const PROFILES: Record<Tier, Profile> = {
  high: { tier: 'high', fps: 0, zoom: 2, fx: 1, petals: 12, hops: true, hoverGlow: true, confetti: 1 },
  medium: { tier: 'medium', fps: 0, zoom: 2, fx: 0.6, petals: 6, hops: true, hoverGlow: false, confetti: 0.6 },
  low: { tier: 'low', fps: 30, zoom: 1.5, fx: 0.35, petals: 0, hops: false, hoverGlow: false, confetti: 0.3 },
};

const MODE_KEY = 'mochi.perf';
const LEARNED_KEY = 'mochi.perf.learned';
const WEEK = 7 * 24 * 3600 * 1000;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, v: string | null) {
  try {
    if (v === null) localStorage.removeItem(key);
    else localStorage.setItem(key, v);
  } catch {
    /* private mode: the choice lasts this visit only */
  }
}

// ------------------------------------------------------------------ device check

export interface Device {
  mobile: boolean;
  cores: number | null;
  memory: number | null;
  saveData: boolean;
  /** the tier auto mode starts from on this device (before anything learned from the frame rate) */
  tier: Tier;
}

type Nav = Navigator & {
  deviceMemory?: number;
  userAgentData?: { mobile?: boolean };
  connection?: { saveData?: boolean };
};

const mq = (q: string) => typeof matchMedia === 'function' && matchMedia(q).matches;

export function detectDevice(): Device {
  const nav = (typeof navigator !== 'undefined' ? navigator : {}) as Nav;
  const ua = nav.userAgent ?? '';
  const iPadOS = /Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1;
  const touchOnly = mq('(pointer: coarse)') && !mq('(any-pointer: fine)');
  const mobile = nav.userAgentData?.mobile === true || /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || iPadOS || touchOnly;
  const cores = nav.hardwareConcurrency || null;
  const memory = nav.deviceMemory ?? null;
  const saveData = nav.connection?.saveData === true;
  let tier: Tier;
  if (saveData) tier = 'low';
  else if (mobile) tier = memory !== null && memory <= 2 ? 'low' : 'medium';
  else if ((cores !== null && cores <= 2) || (memory !== null && memory <= 2)) tier = 'low';
  else if ((cores !== null && cores <= 4) || (memory !== null && memory <= 4)) tier = 'medium';
  else tier = 'high';
  return { mobile, cores, memory, saveData, tier };
}

export const device = detectDevice();

// ------------------------------------------------------------------ mode + current tier

function readMode(): PerfMode {
  const m = read(MODE_KEY);
  return m === 'high' || m === 'medium' || m === 'low' ? m : 'auto';
}

/** a lower tier the watchdog found on this device in the last week */
function readLearned(): Tier | null {
  try {
    const o = JSON.parse(read(LEARNED_KEY) ?? 'null') as { tier?: Tier; at?: number } | null;
    if (o?.tier && TIERS.includes(o.tier) && Date.now() - (o.at ?? 0) < WEEK) return o.tier;
  } catch {
    /* ignore */
  }
  return null;
}

const lower = (a: Tier, b: Tier): Tier => (TIERS.indexOf(a) >= TIERS.indexOf(b) ? a : b);

function autoTier(): Tier {
  const learned = readLearned();
  return learned ? lower(device.tier, learned) : device.tier;
}

let mode = readMode();
let current: Tier = mode === 'auto' ? autoTier() : mode;
/** the tier the page loaded with: the canvas scale only changes on the next load */
export const bootProfile: Profile = PROFILES[current];

const listeners = new Set<(p: Profile) => void>();

export const perfMode = () => mode;
export const perfTier = () => current;
export const perf = (): Profile => PROFILES[current];

/** Run fn now and on every tier change; returns an unsubscribe. */
export function onPerf(fn: (p: Profile) => void) {
  listeners.add(fn);
  fn(perf());
  return () => listeners.delete(fn);
}

function apply(t: Tier) {
  if (t === current) return;
  current = t;
  paintDom();
  const p = perf();
  for (const fn of listeners) fn(p);
}

/** Player's choice from the settings panel. 'auto' forgets what the watchdog learned. */
export function setPerfMode(m: PerfMode) {
  mode = m;
  write(MODE_KEY, m === 'auto' ? null : m);
  if (m === 'auto') write(LEARNED_KEY, null);
  watchdog.reset();
  apply(m === 'auto' ? autoTier() : m);
}

/** true when the canvas scale of the current tier differs from the one the page loaded with */
export const needsReload = () => perf().zoom !== bootProfile.zoom;

function paintDom() {
  if (typeof document !== 'undefined') document.documentElement.dataset.perf = current;
}
paintDom();

// ------------------------------------------------------------------ frame cap + watchdog

let game: Phaser.Game | null = null;
/** frames the game actually stepped (Phaser's actualFps counts every rAF tick, even the ones the cap skips) */
let stepped = 0;

/**
 * The value for Phaser's fps.limit. Phaser only steps when the time since the last step reaches 1000 / limit and
 * then forgets the remainder, so a limit of exactly 30 on a 60 Hz screen sometimes needs 3 ticks (20 fps):
 * aim a little higher and two 60 Hz ticks (or four 120 Hz ones) always pass.
 */
export const loopLimit = (p: Profile) => (p.fps ? p.fps + 2 : 0);

function applyFps(p: Profile) {
  const loop = game?.loop;
  if (!loop) return;
  const limit = loopLimit(p);
  if (loop.fpsLimit === limit) return;
  loop.fpsLimit = limit;
  loop.hasFpsLimit = limit > 0;
  (loop as unknown as { _limitRate: number })._limitRate = limit > 0 ? 1000 / limit : 0;
  // the step function is picked when the loop starts: restart it so the new cap takes effect
  if (loop.running) {
    loop.sleep();
    loop.wake(true);
  }
}

/** When auto mode's frame rate stays under this for the whole window, drop one tier. */
const SLOW_FPS = 42;
const WINDOW = 6; // one sample per second
const WARMUP_MS = 8000;

const watchdog = {
  samples: [] as number[],
  since: 0,
  reset() {
    this.samples = [];
    this.since = performance.now();
  },
  tick() {
    if (!game || mode !== 'auto' || current === 'low' || document.hidden || !game.loop.running) return this.reset();
    if (performance.now() - this.since < WARMUP_MS) return;
    this.samples.push(game.loop.actualFps);
    if (this.samples.length < WINDOW) return;
    if (this.samples.length > WINDOW) this.samples.shift();
    const sorted = [...this.samples].sort((a, b) => a - b);
    const median = sorted[WINDOW >> 1];
    if (median >= SLOW_FPS) return;
    const next = TIERS[TIERS.indexOf(current) + 1];
    write(LEARNED_KEY, JSON.stringify({ tier: next, at: Date.now() }));
    this.reset();
    apply(next);
  },
};

/** Hook the game loop: frame cap for the tier, and the auto-mode watchdog. */
export function attachPerf(g: Phaser.Game) {
  game = g;
  g.events.on('poststep', () => stepped++);
  onPerf(applyFps);
  watchdog.reset();
  setInterval(() => watchdog.tick(), 1000);
  document.addEventListener('visibilitychange', () => watchdog.reset());
}

/** For the console / tests: what was detected and what is running. */
export function perfInfo() {
  return { mode, tier: current, boot: bootProfile.tier, device, learned: readLearned(), fps: game ? Math.round(game.loop.actualFps) : null, stepped };
}
if (typeof window !== 'undefined') (window as unknown as { __perf: typeof perfInfo }).__perf = perfInfo;
