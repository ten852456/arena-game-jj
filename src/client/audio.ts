// Sound for Mochi Moon: sfx(name), music(track) with crossfade, voice(key) in the current language.
// - Nothing plays before the first user gesture (browser autoplay rules); music asked for earlier starts then.
// - Files load lazily and are cached; a missing or undecodable file is silently skipped.
// - Volumes + mute persist in localStorage when it is available (wrapped in try/catch).
// Assets and how they were made: ./assets.ts, docs/ASSETS.md.
import type { CombatEvent, Side } from '../sim/types';
import {
  type AudioExt, type Lang, type MusicTrack, type SfxName, type VoiceKey,
  SFX_NAMES, musicUrl, sfxUrl, voiceUrl,
} from './assets';

export type { Lang, MusicTrack, SfxName, VoiceKey } from './assets';
export type Channel = 'master' | 'music' | 'sfx' | 'voice';
export interface AudioSettings {
  master: number;
  music: number;
  sfx: number;
  voice: number;
  muted: boolean;
}

const STORE_KEY = 'mochi.audio';
const DEFAULTS: AudioSettings = { master: 0.8, music: 0.5, sfx: 0.8, voice: 0.9, muted: false };
const MUSIC_FADE = 1.2;

let settings: AudioSettings = loadSettings();
let lang: Lang = 'th';
let ctx: AudioContext | null = null;
let gains: Record<Channel, GainNode> | null = null;
let unlocked = false;
let ext: AudioExt = 'ogg';

function loadSettings(): AudioSettings {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const s = JSON.parse(raw) as Partial<AudioSettings>;
      const out = { ...DEFAULTS };
      for (const k of ['master', 'music', 'sfx', 'voice'] as const) {
        const v = Number(s[k]);
        if (Number.isFinite(v)) out[k] = Math.min(1, Math.max(0, v));
      }
      out.muted = s.muted === true;
      return out;
    }
  } catch {
    /* storage unavailable or corrupt: defaults */
  }
  return { ...DEFAULTS };
}

function saveSettings() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(settings));
  } catch {
    /* private mode / blocked storage: settings last for this page only */
  }
}

function applyGains() {
  if (!ctx || !gains) return;
  const t = ctx.currentTime;
  gains.master.gain.setTargetAtTime(settings.muted ? 0 : settings.master, t, 0.02);
  gains.music.gain.setTargetAtTime(settings.music, t, 0.02);
  gains.sfx.gain.setTargetAtTime(settings.sfx, t, 0.02);
  gains.voice.gain.setTargetAtTime(settings.voice, t, 0.02);
}

// ---------- settings API (for a settings panel / mute button) ----------
export function getAudioSettings(): AudioSettings {
  return { ...settings };
}
export function setVolume(ch: Channel, v: number) {
  settings[ch] = Math.min(1, Math.max(0, Number(v) || 0));
  saveSettings();
  applyGains();
}
export function setMuted(m: boolean) {
  settings.muted = m;
  saveSettings();
  applyGains();
}
export function toggleMuted(): boolean {
  setMuted(!settings.muted);
  return settings.muted;
}

/** Voice language ('th' default). The UI language switch should call setLang. */
export function setLang(l: Lang) {
  lang = l === 'en' ? 'en' : 'th';
}
export function getLang(): Lang {
  return lang;
}

// ---------- context + unlock ----------
function pickExt(): AudioExt {
  try {
    const a = document.createElement('audio');
    return a.canPlayType('audio/ogg; codecs="vorbis"') ? 'ogg' : 'mp3';
  } catch {
    return 'mp3';
  }
}

function ensureContext(): AudioContext | null {
  if (ctx) return ctx;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  try {
    ctx = new AC();
  } catch {
    return null;
  }
  const g = (dest: AudioNode) => {
    const n = ctx!.createGain();
    n.connect(dest);
    return n;
  };
  const master = g(ctx.destination);
  gains = { master, music: g(master), sfx: g(master), voice: g(master) };
  applyGains();
  return ctx;
}

function unlock() {
  if (unlocked) return;
  const c = ensureContext();
  if (!c) return;
  void c.resume().catch(() => {});
  unlocked = true;
  for (const ev of GESTURES) window.removeEventListener(ev, unlock, true);
  // warm the small SFX cache in the background
  const idle = (window as unknown as { requestIdleCallback?: (f: () => void) => void }).requestIdleCallback ?? ((f: () => void) => setTimeout(f, 300));
  idle(() => SFX_NAMES.forEach((n) => void load(sfxUrl(n, ext))));
  if (wantTrack) startMusic(wantTrack, 0.6);
}
const GESTURES = ['pointerdown', 'keydown', 'touchend'] as const;

// ---------- loading ----------
const buffers = new Map<string, Promise<AudioBuffer | null>>();
function load(url: string): Promise<AudioBuffer | null> {
  let p = buffers.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then((b) => new Promise<AudioBuffer>((ok, fail) => ctx!.decodeAudioData(b, ok, fail)))
      .catch(() => null); // missing or undecodable file: stay silent
    buffers.set(url, p);
  }
  return p;
}

function playBuffer(buf: AudioBuffer, out: GainNode, vol = 1, rate = 1, loop = false) {
  const src = ctx!.createBufferSource();
  src.buffer = buf;
  src.loop = loop;
  src.playbackRate.value = rate;
  const g = ctx!.createGain();
  g.gain.value = vol;
  src.connect(g).connect(out);
  src.start();
  return { src, g };
}

// ---------- SFX ----------
const lastPlayed = new Map<string, number>();
let recent: number[] = [];
/** Play a sound effect. Ignored before the first user gesture and while the same sound just played. */
export function sfx(name: SfxName, opts: { volume?: number; rate?: number; force?: boolean } = {}) {
  if (!unlocked || !ctx || !gains || settings.muted) return;
  const now = performance.now();
  if (!opts.force) {
    // fast-forward / skip fires many events in one frame: keep it to a few sounds
    if (now - (lastPlayed.get(name) ?? -1e9) < 45) return;
    recent = recent.filter((t) => now - t < 120);
    if (recent.length >= 6) return;
  }
  lastPlayed.set(name, now);
  recent.push(now);
  const asked = now;
  void load(sfxUrl(name, ext)).then((buf) => {
    // if it took long to load, the moment has passed
    if (buf && ctx && gains && performance.now() - asked < 400) playBuffer(buf, gains.sfx, opts.volume ?? 1, opts.rate ?? 1);
  });
}

/**
 * Synthesized "link" chime for a new chain in the skill list: two soft bell notes going up (plus a third for
 * several links at once) with a quiet sparkle on top. Short (~0.6 s), on the sfx channel, silent when muted.
 */
export function linkChime(links = 1) {
  if (!unlocked || !ctx || !gains || settings.muted) return;
  const now = performance.now();
  if (now - (lastPlayed.get('link') ?? -1e9) < 120) return;
  lastPlayed.set('link', now);
  const c = ctx;
  const out = c.createGain();
  out.gain.value = 0.32;
  out.connect(gains.sfx);
  const t0 = c.currentTime + 0.01;
  // E6, B6 (+ E7): a bright perfect fifth, like two moon bells clicking together
  const notes = links > 1 ? [1318.5, 1975.5, 2637] : [1318.5, 1975.5];
  notes.forEach((f, i) => {
    const t = t0 + i * 0.075;
    for (const [mul, type, vol] of [[1, 'sine', 0.9], [2, 'triangle', 0.18], [3.01, 'sine', 0.08]] as const) {
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f * mul, t);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0008, t + 0.42);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + 0.45);
    }
  });
  // sparkle: a few very quiet high blips
  for (let k = 0; k < 4; k++) {
    const t = t0 + 0.12 + k * 0.045;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(3200 + k * 420, t);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.05, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.09);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.1);
  }
  setTimeout(() => out.disconnect(), 900);
}

// ---------- voice ----------
let currentVoice: AudioBufferSourceNode | null = null;
/** Announcer line in the current language; a new line cuts the previous one. */
export function voice(key: VoiceKey) {
  if (!unlocked || !ctx || !gains || settings.muted) return;
  const asked = performance.now();
  void load(voiceUrl(lang, key, ext)).then((buf) => {
    if (!buf || !ctx || !gains || performance.now() - asked > 1500) return;
    try {
      currentVoice?.stop();
    } catch {
      /* already ended */
    }
    currentVoice = playBuffer(buf, gains.voice).src;
  });
}

// ---------- music ----------
let wantTrack: MusicTrack | null = null;
let playing: { track: MusicTrack; src: AudioBufferSourceNode; g: GainNode } | null = null;
let musicToken = 0;
const decodedTracks: string[] = []; // keep at most two decoded loops in memory

/** Switch the background loop (null = fade out). Safe to call before the first gesture. */
export function music(track: MusicTrack | null, fade = MUSIC_FADE) {
  wantTrack = track;
  if (!unlocked) return;
  if (playing?.track === track) return;
  startMusic(track, fade);
}

function startMusic(track: MusicTrack | null, fade: number) {
  if (!ctx || !gains) return;
  const token = ++musicToken;
  const old = playing;
  playing = null;
  if (old) {
    const t = ctx.currentTime;
    old.g.gain.cancelScheduledValues(t);
    old.g.gain.setValueAtTime(old.g.gain.value, t);
    old.g.gain.linearRampToValueAtTime(0, t + fade);
    try {
      old.src.stop(t + fade + 0.05);
    } catch {
      /* already stopped */
    }
  }
  if (!track) return;
  const url = musicUrl(track, ext);
  void load(url).then((buf) => {
    if (!buf || !ctx || !gains || token !== musicToken) return;
    remember(url);
    const p = playBuffer(buf, gains.music, 0, 1, true);
    const t = ctx.currentTime;
    p.g.gain.setValueAtTime(0, t);
    p.g.gain.linearRampToValueAtTime(1, t + fade);
    playing = { track, ...p };
  });
}

function remember(url: string) {
  const i = decodedTracks.indexOf(url);
  if (i >= 0) decodedTracks.splice(i, 1);
  decodedTracks.push(url);
  while (decodedTracks.length > 2) buffers.delete(decodedTracks.shift()!);
}

export function currentMusic(): MusicTrack | null {
  return wantTrack;
}

// ---------- combat ----------
/** One call per combat event (me = the player's side). Hit / shield / freeze / burn / trigger / KO + win or lose. */
export function combatSfx(e: CombatEvent, me: Side = 0) {
  switch (e.type) {
    case 'cast':
      if (e.from !== undefined) sfx('chain');
      break;
    case 'damage':
      if (e.amount <= 0) {
        if (e.blocked > 0) sfx('shield', { volume: 0.5 });
      } else if (e.src === 'burn') sfx('burn', { volume: 0.7 });
      else if (e.src !== 'fatigue') sfx(e.amount >= 10 ? 'crit' : 'hit', { rate: e.side === me ? 0.9 : 1.05 });
      break;
    case 'shield':
      sfx('shield', { volume: 0.8 });
      break;
    case 'status':
      if (e.status === 'freeze' && e.value > 0) sfx('freeze');
      break;
    case 'end':
      if (e.winner !== -1) sfx('ko', { force: true });
      setTimeout(() => {
        if (e.winner === me) {
          sfx('win', { force: true });
          voice('victory');
        } else if (e.winner !== -1) {
          sfx('lose', { force: true });
          voice('defeat');
        }
      }, 450);
      break;
  }
}

// ---------- page wiring ----------
let started = false;
const OWN_SOUND = new Set(['buy', 'sell', 'reroll', 'lock', 'wish', 'fight']);
/**
 * Call once at boot. Waits for the first gesture, pauses audio while the tab is hidden and, with uiSounds,
 * plays the click sound for every enabled <button> (skip one with data-sfx="none") and a soft hover tick.
 */
export function initAudio(opts: { uiSounds?: boolean } = {}) {
  if (started || typeof window === 'undefined') return;
  started = true;
  ext = pickExt();
  for (const ev of GESTURES) window.addEventListener(ev, unlock, { capture: true, passive: true });
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) void ctx.suspend().catch(() => {});
    else if (unlocked) void ctx.resume().catch(() => {});
  });
  if (opts.uiSounds) {
    document.addEventListener(
      'click',
      (ev) => {
        const b = (ev.target as Element | null)?.closest?.('button') as HTMLButtonElement | null;
        // actions with their own sound (buy, sell, reroll, lock, wish, fight) skip the generic click
        if (b && !b.disabled && b.dataset.sfx !== 'none' && !OWN_SOUND.has(b.dataset.a ?? '')) sfx('click');
      },
      true,
    );
    let lastHover: Element | null = null;
    document.addEventListener('pointerover', (ev) => {
      if (ev.pointerType !== 'mouse') return;
      const b = (ev.target as Element | null)?.closest?.('button') as HTMLButtonElement | null;
      if (b && b !== lastHover && !b.disabled && b.dataset.sfx !== 'none') sfx('hover', { volume: 0.35 });
      lastHover = b;
    });
  }
}
