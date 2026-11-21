/**
 * Painted art for the depth systems (relics, marks, stars, rarity frames, the build card), behind one small map so a
 * painted pack can be dropped in later without touching the UI code.
 *
 * Files live in public/assets/ui/depth/ (pack: branch assets/codex-depth, README lists files and 9-slice insets).
 * A file is only used once its name is listed in DEPTH_HAVE: until then every caller gets null and draws its CSS /
 * glyph fallback, so a missing file can never show a broken image or a 404.
 */
const BASE = `${import.meta.env.BASE_URL}assets/ui/depth/`;

/** file names of the depth pack (what each UI piece would load) */
export const DEPTH_FILES = {
  relic: (id: string) => `relic-${id}.webp`,
  mark: (kind: 'burn' | 'echo' | 'quick' | 'steadfast' | 'hidden') => `mark-${kind}.webp`,
  starPip: 'star-pip.webp',
  starPipEmpty: 'star-pip-empty.webp',
  star3Burst: 'star3-burst.webp',
  frame: (k: 'epic' | 'rare' | 'common' | 'star3' | 'relic') => `frame-${k}.webp`,
  buildcardBg: 'buildcard-bg.webp',
  buildcardFrame: 'buildcard-frame.webp',
  ultPipOn: 'ult-pip-on.webp',
  ultPipOff: 'ult-pip-off.webp',
  relicSlotEmpty: 'relic-slot-empty.webp',
} as const;

/**
 * Files of the pack that are present in this build. Add names here when the pack is merged
 * (e.g. 'relic-bastion.webp'); everything not listed falls back to CSS + emoji.
 */
const DEPTH_HAVE = new Set<string>([]);

/** URL of a depth-pack file, or null when it is not in this build (draw the fallback) */
export const depthArt = (file: string): string | null => (DEPTH_HAVE.has(file) ? BASE + file : null);

/** an <img> for a pack file, or the fallback markup */
export const artOr = (file: string, fallback: string, cls = '') => {
  const src = depthArt(file);
  return src ? `<img class="dart ${cls}" src="${src}" alt="" draggable="false">` : fallback;
};
