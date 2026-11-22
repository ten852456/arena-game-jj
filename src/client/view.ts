import { bootProfile } from './perf';

/**
 * The game world is 640×300 units. The canvas is ZOOM× that size and every camera zooms by ZOOM,
 * so smooth art and text stay sharp instead of being stretched up from a small canvas.
 * ZOOM comes from the graphics tier the page loaded with (2×, or 1.5× on low; perf.ts).
 */
export const ZOOM = bootProfile.zoom;
