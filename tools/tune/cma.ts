// Separable CMA-ES (Ros & Hansen 2008): CMA-ES with a diagonal covariance, so it learns one step size per knob.
// Works in the knobs' unit cube [0, 1]^n; samples are clamped into it (and the clamped point is what gets learned).
// Plain data state (JSON) so a run can be saved and resumed.
import { Rng, hashSeed } from '../../src/sim/rng';

export interface CmaState {
  n: number;
  lambda: number;
  mu: number;
  gen: number;
  sigma: number;
  mean: number[];
  /** diagonal of C */
  c: number[];
  ps: number[];
  pc: number[];
  seed: number;
}

export function cmaInit(mean: number[], sigma: number, lambda: number, seed: number): CmaState {
  const n = mean.length;
  return { n, lambda, mu: Math.floor(lambda / 2), gen: 0, sigma, mean: [...mean], c: mean.map(() => 1), ps: mean.map(() => 0), pc: mean.map(() => 0), seed };
}

function params(s: CmaState) {
  const { n, mu } = s;
  const raw = Array.from({ length: mu }, (_, i) => Math.log(mu + 0.5) - Math.log(i + 1));
  const sw = raw.reduce((a, b) => a + b, 0);
  const w = raw.map((x) => x / sw);
  const mueff = 1 / w.reduce((a, b) => a + b * b, 0);
  const cs = (mueff + 2) / (n + mueff + 5);
  const ds = 1 + 2 * Math.max(0, Math.sqrt((mueff - 1) / (n + 1)) - 1) + cs;
  const cc = (4 + mueff / n) / (n + 4 + (2 * mueff) / n);
  const sep = (n + 2) / 3; // separable CMA learns the diagonal faster
  const c1 = Math.min(1, (sep * 2) / ((n + 1.3) ** 2 + mueff));
  const cmu = Math.min(1 - c1, (sep * 2 * (mueff - 2 + 1 / mueff)) / ((n + 2) ** 2 + mueff));
  const chiN = Math.sqrt(n) * (1 - 1 / (4 * n) + 1 / (21 * n * n));
  return { w, mueff, cs, ds, cc, c1, cmu, chiN };
}

function gauss(r: Rng) {
  const u = Math.max(1e-12, r.next());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r.next());
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** λ new points in the unit cube (deterministic for this state's seed + generation). */
export function cmaAsk(s: CmaState): number[][] {
  const r = new Rng(hashSeed(s.seed, 'cma', s.gen));
  return Array.from({ length: s.lambda }, () => s.mean.map((m, i) => clamp01(m + s.sigma * Math.sqrt(s.c[i]) * gauss(r))));
}

/** Update with the asked points and their scores (lower = better). */
export function cmaTell(s: CmaState, xs: number[][], f: number[]) {
  const { w, mueff, cs, ds, cc, c1, cmu, chiN } = params(s);
  const idx = f.map((_, i) => i).sort((a, b) => f[a] - f[b]).slice(0, s.mu);
  const ys = idx.map((k) => xs[k].map((x, i) => (x - s.mean[i]) / s.sigma));
  const yw = s.mean.map((_, i) => ys.reduce((n, y, k) => n + w[k] * y[i], 0));
  s.mean = s.mean.map((m, i) => clamp01(m + s.sigma * yw[i]));
  const d = s.c.map(Math.sqrt);
  s.ps = s.ps.map((p, i) => (1 - cs) * p + Math.sqrt(cs * (2 - cs) * mueff) * (yw[i] / d[i]));
  const psn = Math.sqrt(s.ps.reduce((a, b) => a + b * b, 0));
  const hs = psn / Math.sqrt(1 - (1 - cs) ** (2 * (s.gen + 1))) < (1.4 + 2 / (s.n + 1)) * chiN ? 1 : 0;
  s.pc = s.pc.map((p, i) => (1 - cc) * p + hs * Math.sqrt(cc * (2 - cc) * mueff) * yw[i]);
  s.c = s.c.map((ci, i) => {
    const rank = ys.reduce((n, y, k) => n + w[k] * y[i] * y[i], 0);
    const v = (1 - c1 - cmu) * ci + c1 * (s.pc[i] ** 2 + (1 - hs) * cc * (2 - cc) * ci) + cmu * rank;
    return Math.min(4, Math.max(0.05, v)); // keep step ratios sane with few generations and noisy scores
  });
  s.sigma = Math.min(0.4, s.sigma * Math.exp((cs / ds) * (psn / chiN - 1)));
  s.gen++;
}
