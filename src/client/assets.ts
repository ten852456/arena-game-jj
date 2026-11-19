// Typed manifest of every generated asset under src/client/public/assets (served from <base>/assets/...).
// How each file was made and how to regenerate it: docs/ASSETS.md.

const BASE = `${import.meta.env.BASE_URL}assets/`;

export const IMAGES = {
  /** 1536x1024 title / loading background (full moon, lanterns, sleeping mochi) */
  bgTitle: `${BASE}img/bg-title.webp`,
  /** 1536x1024 shop backdrop (moon night-market stall, calm centre for cards) */
  bgShop: `${BASE}img/bg-shop.webp`,
  /** "Mochi Moon" wordmark, transparent, 1024x504 */
  logo: `${BASE}img/logo.webp`,
  /** victory ribbon (empty, put the text on top), transparent, 900x574 */
  bannerVictory: `${BASE}img/banner-victory.webp`,
  /** defeat ribbon (empty, put the text on top), transparent, 900x551 */
  bannerDefeat: `${BASE}img/banner-defeat.webp`,
  /** stardust (ผงดาว) currency icon, transparent, 256x313 */
  stardust: `${BASE}img/stardust.webp`,
  /** reward chest spilling stardust, transparent, 512x504 */
  chest: `${BASE}img/chest.webp`,
  /** 1200x560 leaderboard / profile header (three mochi on podiums) */
  headerLeaderboard: `${BASE}img/header-leaderboard.webp`,
  /** 1200x630 share image with logo (webp + jpg for og:image scrapers) */
  og: `${BASE}img/og.webp`,
  ogJpg: `${BASE}img/og.jpg`,
} as const;
export type ImageKey = keyof typeof IMAGES;

export const SFX_NAMES = [
  'click', 'hover', 'buy', 'sell', 'reroll', 'lock', 'unlock', 'pickup', 'drop', 'wish',
  'fight_start', 'hit', 'crit', 'shield', 'freeze', 'burn', 'chain', 'ko',
  'win', 'lose', 'last_chance', 'champion', 'stardust',
] as const;
export type SfxName = (typeof SFX_NAMES)[number];

export const MUSIC_TRACKS = ['town', 'shop', 'battle', 'victory'] as const;
export type MusicTrack = (typeof MUSIC_TRACKS)[number];

export const VOICE_KEYS = [
  'welcome', 'choose_hero', 'shop_open', 'fight', 'victory', 'defeat', 'close_fight', 'ko', 'combo', 'critical',
  'frozen', 'last_chance', 'champion', 'perfect', 'stardust', 'new_day',
] as const;
export type VoiceKey = (typeof VOICE_KEYS)[number];
export type Lang = 'th' | 'en';

/** Every sound exists as .ogg (Vorbis) and .mp3; pass the extension the browser can play. */
export type AudioExt = 'ogg' | 'mp3';
export const sfxUrl = (name: SfxName, ext: AudioExt) => `${BASE}sfx/${name}.${ext}`;
export const musicUrl = (track: MusicTrack, ext: AudioExt) => `${BASE}music/${track}.${ext}`;
export const voiceUrl = (lang: Lang, key: VoiceKey, ext: AudioExt) => `${BASE}voice/${lang}/${key}.${ext}`;
