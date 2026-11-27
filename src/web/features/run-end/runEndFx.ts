/**
 * The end-of-run reveal: a short staged show (title → stars → stats → stardust → records → buttons), tap or a key skips it.
 * The page's CSS animates each piece with a delay relative to the reveal's start (`--el` = time already elapsed),
 * so a re-render mid-reveal (the reward arriving, a language switch) carries on where it was instead of restarting.
 * This module keeps the clock, the number count-ups and the sounds.
 */
import { sfx, voice } from '../../art/audio';
import { reducedMotion } from '../fight/fx';
import type { RevealPlan } from '../records/records';

interface State {
  runId: string;
  start: number;
  plan: RevealPlan;
  /** reveal finished or skipped */
  done: boolean;
  /** tap / key / reduced motion: numbers jump to their final value */
  skipped: boolean;
  /** ms after start when the stardust reward shows (null = not known yet) */
  rewardAt: number | null;
  rewardSound: boolean;
  rewardSoundOn: boolean;
  timers: number[];
  raf: number;
}
let st: State | null = null;
const now = () => performance.now();

/** Start (or keep) the reveal of a run. Returns the elapsed ms and whether the staged animation is on. */
export function clock(runId: string, plan: RevealPlan, stars: number): { el: number; on: boolean } {
  if (!st || st.runId !== runId) {
    stop();
    st = { runId, start: now(), plan, done: reducedMotion(), skipped: reducedMotion(), rewardAt: null, rewardSound: false, rewardSoundOn: true, timers: [], raf: 0 };
    if (!st.done) schedule(st, stars);
  }
  const el = Math.round(now() - st.start);
  if (!st.done && el >= plan.total + 400) st.done = true;
  return { el, on: !st.done };
}

/** When the stardust reward appears: its stage time, or now when the server answers later. Plays its sound once. */
export function rewardAt(runId: string, hasReward: boolean, sound = true): number {
  if (!st || st.runId !== runId) return 0;
  if (!hasReward) return st.plan.reward;
  if (st.rewardAt === null) {
    const el = now() - st.start;
    st.rewardAt = st.done ? Math.round(el) : Math.max(st.plan.reward, Math.round(el));
    st.rewardSoundOn = sound;
    const wait = st.rewardAt - el;
    const s = st;
    const play = () => {
      if (s.rewardSound || st !== s) return;
      s.rewardSound = true;
      if (!sound) return;
      sfx('stardust');
      voice('stardust');
    };
    if (wait > 20) s.timers.push(window.setTimeout(play, wait));
    else play();
  }
  return st.rewardAt;
}

export const revealing = () => !!st && !st.done && now() - st.start < st.plan.total + 400;

/** Jump to the end (tap / key). */
export function skip() {
  if (!st) return;
  st.done = true;
  st.skipped = true;
  for (const t of st.timers) clearTimeout(t);
  st.timers = [];
  if (st.rewardAt !== null && !st.rewardSound) {
    st.rewardSound = true;
    if (st.rewardSoundOn) sfx('stardust');
  }
}

/** Leaving the screen: stop timers and the count-up loop (the run's reveal is not shown again). */
export function stop() {
  if (!st) return;
  for (const t of st.timers) clearTimeout(t);
  cancelAnimationFrame(st.raf);
  st.timers = [];
  st.done = true;
}

/** Forget the reveal (a new run ended). */
export function reset() {
  stop();
  st = null;
}

function schedule(s: State, stars: number) {
  const p = s.plan;
  for (let i = 0; i < stars; i++)
    s.timers.push(window.setTimeout(() => sfx('click', { rate: 0.9 + i * 0.08, volume: 0.55 }), p.star0 + i * p.starGap + 120));
  s.timers.push(window.setTimeout(() => {
    if (document.querySelector('.re-fresh')) sfx('wish');
  }, p.records + 80));
}

const ease = (t: number) => 1 - Math.pow(1 - t, 3);
/** Count numbers up ([data-count] = final value, data-from, data-at = ms after start, data-dur) while the reveal runs. */
export function countUps(root: HTMLElement, onDone?: () => void) {
  if (!st) return;
  const s = st;
  cancelAnimationFrame(s.raf);
  const els = [...root.querySelectorAll<HTMLElement>('[data-count]')];
  const frame = () => {
    const el = now() - s.start;
    let busy = false;
    for (const e of els) {
      const to = Number(e.dataset.count);
      const from = Number(e.dataset.from ?? 0);
      const at = Number(e.dataset.at ?? 0);
      const dur = Number(e.dataset.dur ?? 500);
      const t = s.skipped ? 1 : Math.max(0, Math.min(1, (el - at) / dur));
      if (t < 1) busy = true;
      e.textContent = String(Math.round(from + (to - from) * ease(t)));
    }
    const live = !s.done && el < s.plan.total + 400;
    if ((busy || live) && st === s) s.raf = requestAnimationFrame(frame);
    else if (st === s) {
      if (!s.done) s.done = true;
      root.querySelector('.re-wrap')?.classList.remove('re-on');
      onDone?.();
    }
  };
  frame();
}
