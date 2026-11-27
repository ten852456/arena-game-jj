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
const RELIC_IDS = [
  'whetstone', 'executioner', 'counterstep', 'featherstep', 'spikedshield', 'bastion', 'overflow', 'vitality', 'meltdown', 'kindling', 'virulence', 'rot',
  'permafrost', 'brittle', 'gale', 'tailspin', 'quickdraw', 'wanderer', 'twinline', 'ironhide', 'glasscannon', 'lonewolf', 'sigil',
];
const DEPTH_HAVE = new Set<string>([
  ...RELIC_IDS.map(DEPTH_FILES.relic),
  ...(['burn', 'echo', 'quick', 'steadfast', 'hidden'] as const).map(DEPTH_FILES.mark),
  // star-pip-empty is a dark outline that vanishes on the plum UI: the empty pip stays CSS (light surfaces only)
  DEPTH_FILES.starPip, DEPTH_FILES.star3Burst,
  ...(['epic', 'rare', 'common', 'star3', 'relic'] as const).map(DEPTH_FILES.frame),
  DEPTH_FILES.buildcardBg, DEPTH_FILES.buildcardFrame, DEPTH_FILES.ultPipOn, DEPTH_FILES.ultPipOff, DEPTH_FILES.relicSlotEmpty,
]);

/** URL of a depth-pack file, or null when it is not in this build (draw the fallback) */
export const depthArt = (file: string): string | null => (DEPTH_HAVE.has(file) ? BASE + file : null);

/** an <img> for a pack file, or the fallback markup */
export const artOr = (file: string, fallback: string, cls = '') => {
  const src = depthArt(file);
  return src ? `<img class="dart ${cls}" src="${src}" alt="" draggable="false">` : fallback;
};

/**
 * The 9-slice frames as CSS variables (--dframe-epic …) for border-image, and body.depth-art when the frames are in
 * the build, so depth.css can swap its CSS frames for the painted ones (and keep them when a file is missing).
 */
export function initDepthArt() {
  const root = document.documentElement;
  let any = false;
  for (const k of ['epic', 'rare', 'common', 'star3', 'relic'] as const) {
    const src = depthArt(DEPTH_FILES.frame(k));
    if (src) {
      root.style.setProperty(`--dframe-${k}`, `url("${src}")`);
      any = true;
    }
  }
  const bg = depthArt(DEPTH_FILES.buildcardBg);
  if (bg) root.style.setProperty('--dbuild-bg', `url("${bg}")`);
  document.body.classList.toggle('depth-art', any);
}
