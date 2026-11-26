/**
 * One-time coach marks: a small pulsing bubble that teaches one gesture, shown until the player does it once
 * (or taps ✕). Replaces the always-on how-to paragraphs, so a returning player sees no instructions at all.
 * Saved per key in localStorage (a blocked storage just shows the bubble again next time).
 * Simple mode only (class info-simp): detailed mode keeps its full how-to notes. Never while the guided tutorial
 * (guide.ts, `.gd-root`) is on screen: it already points at one thing at a time.
 */
const KEY = 'mochi.coach.';

export type CoachKey = 'buy' | 'order' | 'sell' | 'detail';

export function seen(k: CoachKey) {
  try {
    return localStorage.getItem(KEY + k) === '1';
  } catch {
    return false;
  }
}

/** The player did the thing (or closed the bubble): never show this one again. */
export function coachDone(k: CoachKey) {
  try {
    localStorage.setItem(KEY + k, '1');
  } catch {
    /* storage blocked: the bubble just comes back next time */
  }
}

/** One bubble, or '' if already learned. `text` may hold <b> tags (it is our own copy, never user input). */
export function coachHTML(k: CoachKey, icon: string, text: string) {
  if (seen(k) || document.querySelector('.gd-root')) return '';
  return `<div class="coach info-simp" data-coach="${k}"><span class="coach-ico" aria-hidden="true">${icon}</span><span class="coach-t">${text}</span>` +
    `<button class="coach-x" data-a="coachX" data-i="${k}" aria-label="OK">✕</button></div>`;
}
