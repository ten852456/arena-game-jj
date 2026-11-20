// Measures candidates with the simulator jobs (scripts/sim/jobs.ts) and scores them (lower = better).
// All candidates of one call share the same seeds (common random numbers), so they are compared fairly.
import { HEROES, HEROES_BY_ID } from '../../src/sim/heroes';
import { TPS } from '../../src/sim/combat';
import { LINES, type Build } from '../../src/sim/types';
import { MAX_DAY, type Ctx, type Job, type MatchRes, type RunsRes } from '../sim/jobs';
import type { LinesRes } from '../sim/lines';
import { healthSummary, mergeHealth, newHealth, type Health } from '../sim/metrics';
import { BEATS, TARGETS, ULT_LOW, lengthTarget } from '../sim/targets';
import { BAND, CURVE_DAYS, curveTargets } from './curves';
import { KNOBS, toUnit, x0 } from './knobs';
import type { Task, TunePool } from './pool';
import { WATCH, WATCH_WEIGHT } from './watch';

export interface EvalSpec {
  seed: number;
  /** matchup builds per hero per day */
  nb: number;
  /** bot runs per hero */
  runs: number;
  /** random fights per day for length / health (days 1–15) */
  lenN: number;
  days: number[];
  /** in-line vs off-line builds per hero per LINE_DAYS day (0 = skip) */
  linesN?: number;
}
/** days of the in-line vs off-line check */
export const LINE_DAYS = [4, 7, 11];

export const LEN_DAYS = Array.from({ length: 15 }, (_, i) => i + 1);
/** opponent pool per day for the bot runs (sim uses 24; 16 is enough for reach rates and much cheaper) */
const POOL = 16;
/** bot runs end by about day 18: later days reuse the day-18 pool instead of building new ones */
const POOL_LAST = 18;
const RUN_CHUNK = 20;

/** What one candidate measured. Rates are 0..1. */
export interface Measure {
  /** day → hero → win rate vs every other hero */
  overall: Record<number, Record<string, number>>;
  /** worst hero pair and archetype pair per day */
  pairWorst: Record<number, { r: number; a: string; b: string }>;
  archWorst: Record<number, { r: number; a: string; b: string }>;
  /** all hero pairs (day → "a>b" → rate), for the report */
  pairs: Record<number, Record<string, number>>;
  /** fights behind each hero-pair rate (for the noise allowance) */
  pairN: number;
  reach: Record<string, number>;
  len: Record<number, { avg: number; fatigue: number; zero: number }>;
  zeroAll: number;
  watch: Record<string, Record<number, number>>;
  /** hero → ultimate fire rate when unlocked and median fire time share (all scanned days) */
  ult: Record<string, { fire: number; at: number }>;
  /** hero → day → in-line beats off-line (same hero, normal bots) */
  inline: Record<string, Record<number, number>>;
  /** hero → points the ultimate is worth (in-line builds with it vs locked) */
  ultValue: Record<string, number>;
}

export interface Score {
  total: number;
  parts: Record<string, number>;
}

/** Objective weights (each term is a sum of squared misses in points / seconds). */
export const W = {
  curve: 1,
  reach: 1,
  /** reach-10 mean of all heroes away from 30% by more than 5 points */
  reachMean: 1,
  pair: 2,
  arch: 3,
  zero: 5,
  fatigue: 2,
  length: 30,
  /** designed counter pairs outside 53–60% (points²; sim v13: soft counters, the owner accepts 50–65) */
  beats: 3,
  /** ultimate fire rate / fire time misses (points²) */
  ult: 0.5,
  /** in-line builds beat off-line builds of the same hero 58–85% (points²) */
  inline: 1.5,
  /** the ultimate is worth 6–15 win-rate points (points²) */
  ultValue: 0.5,
  /** distance from the current values: (Δ / knob range)² summed × this */
  dist: 5,
};
/** Inner limits (a little stricter than the targets, so noise does not carry a candidate over them). */
/**
 * Inner limits. Pair rates also get half a standard error of slack (pairs come from few fights in the coarse
 * evaluation: without it, noise alone puts many pairs over the limit and drowns the real signal).
 */
export const LIMITS = { pair: 0.72, arch: 0.73, reachLo: 0.17, reachHi: 0.43, reachMid: 0.3, zero: 0.03, fatigue: 0.18 };

const chunks = (n: number, size: number) => Array.from({ length: Math.ceil(n / size) }, (_, i) => [i * size, Math.min(n, (i + 1) * size)] as const);

/** Measure many candidates (knob values as tuning objects) with one spec. */
export async function measure(pool: TunePool, cands: Record<string, number>[], spec: EvalSpec): Promise<Measure[]> {
  const c: Ctx = { seed: spec.seed, tier: 'normal' };
  // ---- phase 1: matchup builds + run opponent pools ----
  const t1: Task[] = [];
  const k1: { ci: number; kind: 'b' | 'p'; day: number; hero?: string }[] = [];
  cands.forEach((tune, ci) => {
    for (const day of spec.days)
      for (const h of HEROES) {
        t1.push({ tune, job: { k: 'builds', c, day, hero: h.id, from: 0, to: spec.nb } });
        k1.push({ ci, kind: 'b', day, hero: h.id });
      }
    if (spec.runs > 0)
      for (let day = 1; day <= POOL_LAST; day++) {
        t1.push({ tune, job: { k: 'pool', c, day, size: POOL } });
        k1.push({ ci, kind: 'p', day });
      }
  });
  const r1 = await pool.run<Build[]>(t1);
  const builds = cands.map(() => ({} as Record<number, Record<string, Build[]>>));
  const pools = cands.map(() => [[]] as Build[][]);
  r1.forEach((b, i) => {
    const k = k1[i];
    if (k.kind === 'b') (builds[k.ci][k.day] ??= {})[k.hero!] = b;
    else pools[k.ci][k.day] = b;
  });
  for (const p of pools) for (let day = POOL_LAST + 1; day <= MAX_DAY; day++) p[day] = p[POOL_LAST];

  // ---- phase 2: matchups, runs, length sweep, watch builds ----
  const t2: Task[] = [];
  const k2: { ci: number; kind: 'm' | 'r' | 'l' | 'w' | 'n'; day?: number; hero?: string; name?: string }[] = [];
  cands.forEach((tune, ci) => {
    for (const day of spec.days)
      for (const h of HEROES) {
        t2.push({ tune, job: { k: 'match', c, day, a: h.id, n: spec.nb, builds: builds[ci][day] } });
        k2.push({ ci, kind: 'm', day, hero: h.id });
      }
    if (spec.runs > 0)
      for (const h of HEROES)
        for (const [from, to] of chunks(spec.runs, RUN_CHUNK)) {
          t2.push({ tune, job: { k: 'runs', c, hero: h.id, from, to, pool: pools[ci] } });
          k2.push({ ci, kind: 'r', hero: h.id });
        }
    for (const day of LEN_DAYS)
      for (const [from, to] of chunks(spec.lenN, 50)) {
        t2.push({ tune, job: { k: 'len', c, day, from, to } as Job });
        k2.push({ ci, kind: 'l', day });
      }
    if (spec.linesN)
      for (const day of LINE_DAYS)
        for (const h of HEROES) {
          t2.push({ tune, job: { k: 'lines', c, day, hero: h.id, from: 0, to: spec.linesN, tier: 'normal' } });
          k2.push({ ci, kind: 'n', day, hero: h.id });
        }
    for (const w of WATCH)
      for (const day of w.days.filter((d) => builds[ci][d])) {
        const build = typeof w.build === 'function' ? w.build(day) : w.build;
        t2.push({ tune, job: { k: 'watch', seed: spec.seed, day, build, builds: builds[ci][day] } });
        k2.push({ ci, kind: 'w', day, name: w.name });
      }
  });
  const r2 = await pool.run<unknown>(t2);

  const out: Measure[] = cands.map(() => ({ overall: {}, pairWorst: {}, archWorst: {}, pairs: {}, pairN: spec.nb * 4, reach: {}, len: {}, zeroAll: 0, watch: {}, ult: {}, inline: {}, ultValue: {} }));
  const ultAcc = cands.map(() => ({} as Record<string, [number, number, number]>));
  const match: Record<number, Record<number, Record<string, MatchRes>>> = {};
  const runs: Record<number, Record<string, { won: number; runs: number }>> = {};
  const lens: Record<number, Record<number, Health>> = {};
  const watch: Record<number, Record<string, Record<number, { s: number; n: number }>>> = {};
  r2.forEach((res, i) => {
    const k = k2[i];
    if (k.kind === 'm') ((match[k.ci] ??= {})[k.day!] ??= {})[k.hero!] = res as MatchRes;
    else if (k.kind === 'r') {
      const r = res as RunsRes;
      const a = ((runs[k.ci] ??= {})[k.hero!] ??= { won: 0, runs: 0 });
      a.won += r.won;
      a.runs += r.runs;
    } else if (k.kind === 'n') {
      const r = res as LinesRes;
      (out[k.ci].inline[k.hero!] ??= {})[k.day!] = r.h2h / Math.max(1, r.n);
      const a = (ultAcc[k.ci][k.hero!] ??= [0, 0, 0]);
      for (const u of Object.values(r.ult)) for (let i = 0; i < 3; i++) a[i] += u[i];
    } else if (k.kind === 'l') {
      const l = (lens[k.ci] ??= {});
      l[k.day!] = l[k.day!] ? mergeHealth(l[k.day!], res as Health) : (res as Health);
    } else {
      const w = res as { s: number; n: number };
      const x = (((watch[k.ci] ??= {})[k.name!] ??= {})[k.day!] ??= { s: 0, n: 0 });
      x.s += w.s;
      x.n += w.n;
    }
  });

  cands.forEach((_, ci) => {
    const m = out[ci];
    for (const day of spec.days) {
      const res = match[ci][day];
      const rate = (a: string, b: string) => res[a].score[b] / res[a].count[b];
      m.overall[day] = {};
      m.pairs[day] = {};
      let pw = { r: 0, a: '', b: '' };
      for (const A of HEROES) {
        let s = 0;
        let n = 0;
        for (const B of HEROES) {
          if (A.id === B.id) continue;
          s += res[A.id].score[B.id];
          n += res[A.id].count[B.id];
          const r = rate(A.id, B.id);
          m.pairs[day][`${A.id}>${B.id}`] = r;
          if (r > pw.r) pw = { r, a: A.id, b: B.id };
        }
        m.overall[day][A.id] = s / n;
      }
      m.pairWorst[day] = pw;
      let aw = { r: 0, a: '', b: '' };
      for (const a of LINES)
        for (const b of LINES) {
          if (a === b) continue;
          let s = 0;
          let n = 0;
          for (const A of HEROES.filter((h) => h.line === a))
            for (const B of HEROES.filter((h) => h.line === b)) {
              s += res[A.id].score[B.id];
              n += res[A.id].count[B.id];
            }
          if (s / n > aw.r) aw = { r: s / n, a, b };
        }
      m.archWorst[day] = aw;
    }
    for (const h of HEROES) {
      let on = 0;
      let fired = 0;
      const at: number[] = [];
      for (const day of spec.days) {
        const r = match[ci][day][h.id];
        on += r.ultOn;
        fired += r.ultFired;
        at.push(...r.ultAt);
      }
      at.sort((x, y) => x - y);
      m.ult[h.id] = { fire: fired / Math.max(1, on), at: at.length ? at[Math.floor(at.length / 2)] : 0.5 };
    }
    if (spec.runs > 0) for (const h of HEROES) m.reach[h.id] = runs[ci][h.id].won / runs[ci][h.id].runs;
    let all = newHealth();
    for (const day of LEN_DAYS) {
      const h = lens[ci][day];
      all = mergeHealth(all, h);
      const s = healthSummary(h);
      m.len[day] = { avg: s.avgLen, fatigue: s.fatigue, zero: s.zeroSkill };
    }
    m.zeroAll = all.zeroSides / Math.max(1, all.sides);
    for (const [h, a] of Object.entries(ultAcc[ci])) if (a[0] >= 10) m.ultValue[h] = (a[1] - a[2]) / a[0];
    for (const [name, byDay] of Object.entries(watch[ci] ?? {}))
      m.watch[name] = Object.fromEntries(Object.entries(byDay).map(([d, x]) => [d, x.s / x.n]));
  });
  return out;
}

const sq = (x: number) => x * x;
const over = (x: number, lim: number) => Math.max(0, x - lim);

/** Objective of one measured candidate with knob values xs. Lower is better; parts show where the cost comes from. */
export function score(m: Measure, xs: number[]): Score {
  const tg = curveTargets();
  const parts: Record<string, number> = { curve: 0, reach: 0, pair: 0, arch: 0, beats: 0, ult: 0, inline: 0, ultValue: 0, zero: 0, fatigue: 0, length: 0, watch: 0, dist: 0 };
  for (const byDay of Object.values(m.inline))
    for (const r of Object.values(byDay)) parts.inline += W.inline * (sq(over(0.58, r) * 100) + 0.5 * sq(over(r, 0.85) * 100));
  for (const d of Object.values(m.ultValue)) parts.ultValue += W.ultValue * sq((over(0.06, d) + over(d, 0.15)) * 100);
  // designed counters (one hero per line): average over the scanned days, inner band 54–57%
  const heroOf = (line: string) => HEROES.find((h) => h.line === line)!.id;
  const days = Object.keys(m.overall).map(Number);
  for (const [a, bs] of Object.entries(BEATS))
    for (const b of bs) {
      const avg = days.reduce((n, d) => n + (m.pairs[d][`${heroOf(a)}>${heroOf(b)}`] ?? 0.5), 0) / Math.max(1, days.length);
      parts.beats += W.beats * sq((over(0.53, avg) + over(avg, 0.6)) * 100);
    }
  for (const [h, u] of Object.entries(m.ult)) {
    const lo = ULT_LOW.includes(h) ? TARGETS.ultFireLow : TARGETS.ultFire;
    parts.ult += W.ult * sq(over(lo + 0.03, u.fire) * 100) + W.ult * sq((over(TARGETS.ultTimeLo + 0.03, u.at) + over(u.at, TARGETS.ultTimeHi - 0.03)) * 100);
  }
  void HEROES_BY_ID;
  const pairLim = LIMITS.pair + 0.5 * Math.sqrt(0.25 / Math.max(1, m.pairN));
  for (const day of Object.keys(m.overall).map(Number)) {
    for (const [h, r] of Object.entries(m.overall[day])) {
      const c = tg[h]?.[day];
      if (c !== undefined) parts.curve += W.curve * sq(over(Math.abs(r * 100 - c), BAND));
      else if (CURVE_DAYS.length) parts.curve += W.curve * sq(over(Math.abs(r * 100 - 50), 12)); // unscanned day: just not dead / must-pick
    }
    for (const r of Object.values(m.pairs[day])) parts.pair += W.pair * sq(over(r, pairLim) * 100);
    parts.arch += W.arch * sq(over(m.archWorst[day].r, LIMITS.arch) * 100);
  }
  const reach = Object.values(m.reach);
  if (reach.length) {
    for (const r of reach) parts.reach += W.reach * sq(over(LIMITS.reachLo, r) * 100) + W.reach * sq(over(r, LIMITS.reachHi) * 100);
    const mean = reach.reduce((a, b) => a + b, 0) / reach.length;
    parts.reach += W.reachMean * sq(over(Math.abs(mean - LIMITS.reachMid), 0.05) * 100);
  }
  parts.zero = W.zero * sq(over(m.zeroAll, LIMITS.zero) * 100);
  for (const [d, l] of Object.entries(m.len)) {
    const [lo, hi] = lengthTarget(Number(d));
    parts.length += W.length * sq(over(lo, l.avg) + over(l.avg, hi));
    parts.fatigue += W.fatigue * sq(over(l.fatigue, LIMITS.fatigue) * 100);
  }
  for (const [name, byDay] of Object.entries(m.watch)) {
    const w = WATCH.find((x) => x.name === name)!;
    for (const r of Object.values(byDay)) parts.watch += WATCH_WEIGHT * sq(over(r, w.max) * 100);
  }
  const u = toUnit(xs);
  const u0 = toUnit(x0());
  parts.dist = W.dist * u.reduce((n, v, i) => n + sq(v - u0[i]), 0);
  const total = Object.values(parts).reduce((a, b) => a + b, 0);
  return { total, parts };
}

export const knobCount = KNOBS.length;
export { TPS };
