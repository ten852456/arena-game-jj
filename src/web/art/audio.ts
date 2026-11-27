// Sound for Mochi Moon: sfx(name), music(track) with crossfade, voice(key) in the current language.
// - Nothing plays before the first user gesture (browser autoplay rules); music asked for earlier starts then.
// - Files load lazily and are cached; a missing or undecodable file is silently skipped.
// - Volumes + mute persist in localStorage when it is available (wrapped in try/catch).
// Assets and how they were made: ./assets.ts, docs/ops/ASSETS.md.
import type { CombatEvent, Side } from '../../sim/types';
import {
  type AudioExt, type Lang, type MusicTrack, type SfxName, type VoiceKey,
  SFX_NAMES, heroVoiceUrl, musicUrl, sfxUrl, voiceUrl, type HeroVoiceKind,
} from './assets';

export type { Lang, MusicTrack, SfxName, VoiceKey } from './assets';
export type Channel = 'master' | 'music' | 'sfx' | 'voice';
export interface AudioSettings {
  master: number;
  music: number;
  sfx: number;
  voice: number;
  muted: boolean;
  /** how chatty the announcer is (playtest: a line on every shop, fight and result got tiring) */
  talk: VoiceTalk;
}
/** all = every line · some = big moments always, routine lines now and then · key = only the big moments */
export type VoiceTalk = 'all' | 'some' | 'key';
export const VOICE_TALKS: VoiceTalk[] = ['all', 'some', 'key'];

const STORE_KEY = 'mochi.audio';
const DEFAULTS: AudioSettings = { master: 0.8, music: 0.5, sfx: 0.8, voice: 0.9, muted: false, talk: 'some' };
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
      if (VOICE_TALKS.includes(s.talk as VoiceTalk)) out.talk = s.talk as VoiceTalk;
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

// ---------- synthesized fight beats ----------
/**
 * Small synthesized sounds for the fight's juice beats (combatScene): a soft mochi squish for normal hits, a heavier
 * thump for big ones, a bell for big / crit hits, ice crack + shatter, burn sizzle, a whoosh when a skill fires, a
 * bubble pop when a shield breaks, a heal chime and a rising chain note (+2 semitones per chain step).
 * Each is a handful of short-lived Web Audio nodes; throttled per kind and overall so fast forward stays light.
 */
export type FightSound = 'squish' | 'thump' | 'bell' | 'crack' | 'shatter' | 'sizzle' | 'whoosh' | 'pop' | 'heal' | 'chain';
const SYNTH_GAP: Record<FightSound, number> = {
  squish: 45, thump: 70, bell: 90, crack: 90, shatter: 120, sizzle: 160, whoosh: 70, pop: 90, heal: 120, chain: 60,
};
let noiseBuf: AudioBuffer | null = null;
let synthRecent: number[] = [];
function noiseBuffer(c: AudioContext) {
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, Math.round(c.sampleRate * 0.6), c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}

/** pitch = semitones up (chain steps); vol = 0..1 extra gain */
export function fightSfx(kind: FightSound, opts: { pitch?: number; vol?: number } = {}) {
  if (!unlocked || !ctx || !gains || settings.muted) return;
  const now = performance.now();
  if (now - (lastPlayed.get('fx:' + kind) ?? -1e9) < SYNTH_GAP[kind]) return;
  synthRecent = synthRecent.filter((t) => now - t < 150);
  if (synthRecent.length >= 5) return;
  synthRecent.push(now);
  lastPlayed.set('fx:' + kind, now);
  const c = ctx;
  const out = c.createGain();
  out.gain.value = 0.55 * (opts.vol ?? 1);
  out.connect(gains.sfx);
  const t0 = c.currentTime + 0.005;
  const pm = Math.pow(2, (opts.pitch ?? 0) / 12);
  /** sine / triangle with a pitch glide and an attack-decay envelope */
  const tone = (type: OscillatorType, f0: number, f1: number, at: number, peak: number, dec: number, glide = dec) => {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0 * pm, t0 + at);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1 * pm, t0 + at + glide);
    g.gain.setValueAtTime(0, t0 + at);
    g.gain.linearRampToValueAtTime(peak, t0 + at + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0006, t0 + at + dec);
    o.connect(g).connect(out);
    o.start(t0 + at);
    o.stop(t0 + at + dec + 0.02);
  };
  /** filtered noise burst */
  const hiss = (ftype: BiquadFilterType, freq: number, q: number, at: number, peak: number, dec: number, sweepTo = 0) => {
    const s = c.createBufferSource();
    s.buffer = noiseBuffer(c);
    const f = c.createBiquadFilter();
    f.type = ftype;
    f.frequency.setValueAtTime(freq, t0 + at);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t0 + at + dec);
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t0 + at);
    g.gain.linearRampToValueAtTime(peak, t0 + at + Math.min(0.02, dec * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0006, t0 + at + dec);
    s.connect(f).connect(g).connect(out);
    s.start(t0 + at, Math.random() * 0.3);
    s.stop(t0 + at + dec + 0.02);
    return g;
  };
  let len = 0.3;
  switch (kind) {
    case 'squish': // soft mochi squish: a short dropping blob + a muffled pat
      tone('sine', 260, 95, 0, 0.55, 0.13, 0.1);
      tone('triangle', 520, 180, 0, 0.12, 0.07);
      hiss('lowpass', 1100, 0.7, 0, 0.35, 0.07);
      len = 0.2;
      break;
    case 'thump': // heavy hit: deep body thump + squish on top
      tone('sine', 150, 42, 0, 0.95, 0.28, 0.2);
      tone('sine', 300, 110, 0, 0.35, 0.12);
      hiss('lowpass', 600, 0.8, 0, 0.6, 0.14);
      hiss('bandpass', 1800, 1.2, 0.005, 0.18, 0.06);
      len = 0.35;
      break;
    case 'bell': // crit / big hit chime: inharmonic bell partials
      for (const [mul, vol] of [[1, 0.5], [2.76, 0.18], [5.4, 0.08], [2, 0.12]] as const) tone('sine', 1046.5 * mul, 1046.5 * mul, 0, vol, 0.9);
      tone('sine', 1568, 1568, 0.06, 0.22, 0.6);
      len = 1;
      break;
    case 'crack': // freeze: glassy crackle + a cold ping
      for (const at of [0, 0.028, 0.06, 0.1]) hiss('highpass', 2600 + Math.random() * 1500, 0.9, at, 0.5, 0.035);
      tone('sine', 2900, 1900, 0, 0.18, 0.35);
      tone('triangle', 1450, 1300, 0.02, 0.1, 0.3);
      len = 0.45;
      break;
    case 'shatter': // ice breaking into shards: louder crackle + tinkling pings
      hiss('highpass', 1800, 0.7, 0, 0.7, 0.12);
      for (let k = 0; k < 6; k++) {
        const at = 0.02 + k * 0.035 + Math.random() * 0.02;
        hiss('highpass', 3000 + Math.random() * 2500, 1, at, 0.3, 0.03);
        tone('sine', 2200 + Math.random() * 2600, 2000, at, 0.09, 0.22);
      }
      len = 0.5;
      break;
    case 'sizzle': { // burn: fluttering bandpassed hiss
      const g = hiss('bandpass', 3800, 0.8, 0, 0.42, 0.38, 2600);
      for (let k = 1; k < 18; k++) g.gain.setValueAtTime(0.12 + Math.random() * 0.3 * (1 - k / 18), t0 + k * 0.02);
      g.gain.exponentialRampToValueAtTime(0.0006, t0 + 0.4);
      tone('sine', 180, 120, 0, 0.12, 0.15);
      len = 0.45;
      break;
    }
    case 'whoosh': // a skill fires: airy swoosh rising
      hiss('bandpass', 500, 1.4, 0, 0.32, 0.2, 2600);
      len = 0.25;
      break;
    case 'pop': // shield bubble pops
      tone('sine', 520, 1500, 0, 0.5, 0.08, 0.05);
      hiss('highpass', 2400, 0.8, 0.01, 0.35, 0.06);
      for (let k = 0; k < 3; k++) tone('sine', 2400 + k * 700, 2400 + k * 700, 0.05 + k * 0.03, 0.06, 0.12);
      len = 0.3;
      break;
    case 'heal': // soft two-note chime going up
      tone('sine', 784, 784, 0, 0.3, 0.45);
      tone('sine', 1175, 1175, 0.07, 0.26, 0.5);
      tone('triangle', 2350, 2350, 0.07, 0.04, 0.3);
      len = 0.6;
      break;
    case 'chain': // rising pluck (pitch goes up 2 semitones per chain step)
      tone('triangle', 1046.5, 1046.5, 0, 0.42, 0.32);
      tone('sine', 1568, 1568, 0.05, 0.3, 0.36);
      tone('sine', 2093, 2093, 0.1, 0.18, 0.4);
      hiss('highpass', 6000, 0.7, 0, 0.08, 0.08);
      len = 0.55;
      break;
  }
  setTimeout(() => out.disconnect(), (len + 0.2) * 1000);
}

// ---------- voice ----------
let currentVoice: AudioBufferSourceNode | null = null;
/**
 * How often a routine line is spoken in 'some' mode: at most once per `gap` seconds and then with `chance`.
 * Lines not listed are big moments (welcome, last chance, champion …) and always play.
 */
const ROUTINE: Partial<Record<VoiceKey | `hero_${HeroVoiceKind}`, { gap: number; chance: number }>> = {
  shop_open: { gap: 0, chance: 1 },
  new_day: { gap: 150, chance: 0.5 },
  fight: { gap: 120, chance: 0.5 },
  victory: { gap: 60, chance: 0.6 },
  defeat: { gap: 90, chance: 0.5 },
  close_fight: { gap: 60, chance: 1 },
  combo: { gap: 90, chance: 0.4 },
  critical: { gap: 90, chance: 0.4 },
  frozen: { gap: 90, chance: 0.4 },
  ko: { gap: 90, chance: 0.4 },
  stardust: { gap: 30, chance: 1 },
  choose_hero: { gap: 600, chance: 1 },
  // the hero's own voice (sim v21): the ult shout most of the time, a win line now and then
  hero_ult: { gap: 20, chance: 0.85 },
  hero_win: { gap: 60, chance: 1 },
};
/** lines 'key' mode still speaks */
const KEY_LINES = new Set<string>(['welcome', 'last_chance', 'champion', 'perfect', 'shop_open', 'hero_pick', 'hero_ult']);
const lastSaid: Record<string, number> = {};
let lastAny = -1e9;
/** should this line be spoken now? (also records it) */
function wantVoice(key: string, force: boolean) {
  const now = performance.now() / 1000;
  if (!force && settings.talk !== 'all') {
    const rule = ROUTINE[key as VoiceKey | `hero_${HeroVoiceKind}`];
    if (settings.talk === 'key' && !KEY_LINES.has(key)) return false;
    if (rule && settings.talk === 'some') {
      if (now - (lastSaid[key] ?? -1e9) < rule.gap) return false;
      // never two routine lines within 8 s of each other
      if (now - lastAny < 8) return false;
      if (Math.random() > rule.chance) {
        lastSaid[key] = now - rule.gap / 2; // try again a bit sooner
        return false;
      }
    }
  }
  lastSaid[key] = now;
  lastAny = now;
  return true;
}
export const voiceTalk = () => settings.talk;
export function setVoiceTalk(t: VoiceTalk) {
  settings.talk = t;
  saveSettings();
}
/** Announcer line in the current language; a new line cuts the previous one. force = ignore the chattiness setting. */
export function voice(key: VoiceKey, force = false) {
  if (!unlocked || !ctx || !gains || settings.muted) return;
  if (!wantVoice(key, force)) return;
  playVoice(voiceUrl(lang, key, ext));
}
/** the hero whose voice says the win line (set when a fight starts) */
let voiceHero = '';
export const setVoiceHero = (hero: string) => (voiceHero = hero);
/** The hero's own line (sim v21): pick, ult or win, in its own voice. */
export function heroVoice(hero: string, kind: HeroVoiceKind, force = false) {
  if (!unlocked || !ctx || !gains || settings.muted || !hero) return;
  if (!wantVoice(`hero_${kind}`, force)) return;
  playVoice(heroVoiceUrl(lang, hero, kind, ext));
}
function playVoice(url: string) {
  const asked = performance.now();
  void load(url).then((buf) => {
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
/**
 * One call per combat event (me = the player's side). Shield / freeze / KO + win or lose. With juice (the arena
 * replay), hits, burn ticks and chains are left to the scene's synthesized beats (fightSfx), which know how big each
 * hit is and how far a chain went; without it the sampled hit / crit / burn / chain sounds play as before.
 */
export function combatSfx(e: CombatEvent, me: Side = 0, juice = false) {
  switch (e.type) {
    case 'cast':
      if (e.from !== undefined && !juice) sfx('chain');
      break;
    case 'damage':
      if (e.amount <= 0) {
        if (e.blocked > 0) sfx('shield', { volume: 0.5 });
      } else if (juice) break;
      else if (e.src === 'burn') sfx('burn', { volume: 0.7 });
      else if (e.src !== 'fatigue') sfx(e.amount >= 10 ? 'crit' : 'hit', { rate: e.side === me ? 0.9 : 1.05 });
      break;
    case 'shield':
      sfx('shield', { volume: 0.8 });
      break;
    case 'status':
      if (e.status === 'freeze' && e.value > 0) sfx('freeze');
      break;
    case 'ult':
      if (e.side === me) heroVoice(e.hero, 'ult');
      break;
    case 'end':
      if (e.winner !== -1) sfx('ko', { force: true });
      setTimeout(() => {
        if (e.winner === me) {
          sfx('win', { force: true });
          // half the wins: the hero's own line instead of the announcer
          if (voiceHero && Math.random() < 0.5) heroVoice(voiceHero, 'win');
          else voice('victory');
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
