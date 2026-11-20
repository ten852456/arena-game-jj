// Balance auto-tuner: CPU only, no network. Searches the knobs in src/sim/tuning.ts (list: scripts/tune/knobs.ts)
// with separable CMA-ES towards the design targets (per-hero power curves, reach-10 rates, no hard counters, healthy
// fights), measured with the simulator jobs on every core. See docs/TUNING.md.
//
// npm run tune                         # search (≈25 min on 12 cores), save progress to scripts/tune/state.json
// npm run tune -- --budget 10          # minutes for the search
// npm run tune -- --resume             # continue a saved search
// npm run tune -- --apply              # search, then write the best values into src/sim/tuning.ts
// npm run tune -- --gens 0 --apply     # apply the best of a saved search without searching more (with --resume)
// npm run tune -- --eval               # only measure the current values (report)
// npm run tune -- --dry                # never write tuning.ts, just print the changes
// npm run tune -- --eval --set "uniq.pyro.lv1=1.4,hp.pyro=1.15|run.startHp=18"   # measure variants
// options: --no-prune --seed 1 --days 3,6,9,12,15 --lambda 12 --sigma 0.12 --state FILE --workers N --gens N
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { HEROES } from '../src/sim/heroes';
import { hashSeed } from '../src/sim/rng';
import { lengthTarget, TARGETS } from './sim/targets';
import { applyTuningFile } from './tune/apply';
import { cmaAsk, cmaInit, cmaTell, type CmaState } from './tune/cma';
import { BAND, HERO_CURVE, curveTargets } from './tune/curves';
import { LINE_DAYS, measure, score, type EvalSpec, type Measure, type Score } from './tune/evaluate';
import { KNOBS, asTuning, fromUnit, toUnit, x0 } from './tune/knobs';
import { TunePool } from './tune/pool';

// ---------------- options ----------------
const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes('--' + n);
const opt = (n: string, d: string) => {
  const i = argv.indexOf('--' + n);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d;
};
const SEED = Number(opt('seed', '1'));
const DAYS = opt('days', '3,5,10,13').split(',').map(Number);
const BUDGET = Number(opt('budget', '25')) * 60;
const LAMBDA = Number(opt('lambda', '12'));
const SIGMA = Number(opt('sigma', '0.12'));
const MAX_GENS = Number(opt('gens', '999'));
const WORKERS = Number(opt('workers', String(availableParallelism())));
const STATE = opt('state', fileURLToPath(new URL('./tune/state.json', import.meta.url)));
const RESUME = flag('resume');
const APPLY = flag('apply');
const DRY = flag('dry');
const EVAL = flag('eval');
const PRUNE = !flag('no-prune');
/** --set "k=v,k=v|k=v": knob overrides (variants separated by |). --eval measures each variant; a search starts from the first. */
const SETS = opt('set', '').split('|').filter(Boolean).map((v) => Object.fromEntries(v.split(',').map((kv) => {
  const [k, x] = kv.split('=');
  if (!KNOBS.some((n) => n.key === k.trim())) throw new Error(`--set: unknown knob ${k}`);
  return [k.trim(), Number(x)];
})));

/** cheap evaluation: every candidate of a generation, same seed */
const COARSE: Omit<EvalSpec, 'seed'> = { nb: 12, runs: 40, lenN: 40, days: DAYS, linesN: 12, day1N: 16 };
/** confirmation: the generation's best and the search mean, fixed seed for the whole search (comparable across generations) */
const CONFIRM: Omit<EvalSpec, 'seed'> = { nb: 32, runs: 100, lenN: 80, days: DAYS, linesN: 30, day1N: 40 };
/** final check with fresh seeds: baseline vs best */
const FINAL: Omit<EvalSpec, 'seed'> = { nb: 80, runs: 200, lenN: 200, days: DAYS, linesN: 60, day1N: 80 };

const t0 = performance.now();
const secs = () => (performance.now() - t0) / 1000;
const log = (s: string) => console.log(`[${(secs() / 60).toFixed(1).padStart(4)}m] ${s}`);

interface Saved {
  version: 1;
  keys: string[];
  seed: number;
  days: number[];
  cma: CmaState;
  base: { xs: number[]; confirm: Score };
  best: { xs: number[]; confirm: Score; gen: number };
  history: { gen: number; sigma: number; coarseBest: number; coarseMean: number; confirmBest: number; confirmMean: number; secs: number }[];
}

// ---------------- report ----------------
const p = (x: number) => (x * 100).toFixed(0).padStart(4);
function curveTable(m: Measure, title: string) {
  const tg = curveTargets();
  console.log(`\n${title}: hero win rate vs the field per day (target band = center ±${BAND})`);
  console.log('hero        curve       ' + DAYS.map((d) => `d${d}`.padStart(11)).join('') + '   reach10');
  for (const h of HEROES) {
    const cells = DAYS.map((d) => {
      const r = m.overall[d]?.[h.id] ?? NaN;
      const c = tg[h.id]?.[d];
      const ok = c === undefined || Math.abs(r * 100 - c) <= BAND;
      return `${p(r)}${ok ? ' ' : '!'}(${c === undefined ? '--' : c.toFixed(0)})`.padStart(11);
    });
    console.log(`${h.id.padEnd(12)}${HERO_CURVE[h.id].padEnd(12)}${cells.join('')}   ${m.reach[h.id] !== undefined ? p(m.reach[h.id]) + '%' : ''}`);
  }
  const pw = DAYS.map((d) => `d${d} ${m.pairWorst[d].a}>${m.pairWorst[d].b} ${p(m.pairWorst[d].r).trim()}%`);
  const aw = DAYS.map((d) => `d${d} ${m.archWorst[d].a}>${m.archWorst[d].b} ${p(m.archWorst[d].r).trim()}%`);
  console.log(`worst hero pair: ${pw.join(' · ')}`);
  console.log(`worst arch pair: ${aw.join(' · ')}`);
  const lenMiss = Object.entries(m.len).filter(([d, l]) => { const [lo, hi] = lengthTarget(+d); return l.avg < lo || l.avg > hi; }).map(([d, l]) => `d${d} ${l.avg.toFixed(1)}s`);
  const fat = Math.max(...Object.values(m.len).map((l) => l.fatigue));
  console.log(`fight length misses: ${lenMiss.length ? lenMiss.join(', ') : 'none'} · worst fatigue ${p(fat).trim()}% · 0-skill ${(m.zeroAll * 100).toFixed(1)}%`);
  const il = Object.entries(m.inline).map(([h, byDay]) => `${h.slice(0, 5)} ${Object.values(byDay).map((r) => p(r).trim()).join('/')}`);
  if (il.length) console.log(`in-line beats off-line (d${LINE_DAYS.join('/')}): ${il.join(' · ')}`);
  const uv = Object.entries(m.ultValue).map(([h, d]) => `${h.slice(0, 5)} ${(d * 100).toFixed(0)}`);
  if (uv.length) console.log(`ult worth (pts): ${uv.join(' · ')}`);
  const d1 = Object.entries(m.day1).map(([h, r]) => `${h.slice(0, 5)} ${p(r).trim()}`);
  if (d1.length) console.log(`best day-1 opening: ${d1.join(' · ')}`);
  for (const [n, byDay] of Object.entries(m.watch)) console.log(`watch ${n}: ${Object.entries(byDay).map(([d, r]) => `d${d} ${p(r).trim()}%`).join(' · ')}`);
}
const partsStr = (s: Score) => Object.entries(s.parts).filter(([, v]) => v >= 0.5).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(' ');
function knobTable(from: number[], to: number[]) {
  const rows = KNOBS.map((k, i) => [k, from[i], to[i]] as const).filter(([, a, b]) => a !== b);
  console.log(`\n${rows.length} knob(s) changed:`);
  console.log('knob                    old      new    why');
  for (const [k, a, b] of rows) console.log(`${k.key.padEnd(22)}${String(a).padStart(6)} → ${String(b).padEnd(7)} ${k.why}`);
}

// ---------------- main ----------------
const withSet = (o: Record<string, number>) => KNOBS.map((k, i) => (k.key in o ? o[k.key] : x0()[i]));

/**
 * For every changed knob, measure the best with only that knob put back (confirmation seed). Knobs whose revert costs
 * less than tol are put back together (most harmless first); if the combination costs too much, try fewer.
 */
async function prune(st: Saved) {
  const best = st.best.xs;
  const changed = KNOBS.map((_, i) => i).filter((i) => best[i] !== st.base.xs[i]);
  if (!changed.length) return;
  const seed = hashSeed(SEED, 'confirm');
  const tries = changed.map((i) => best.map((v, j) => (j === i ? st.base.xs[i] : v)));
  const rs = await evalOne(tries, CONFIRM, seed);
  const tol = Math.max(10, st.best.confirm.total * 0.01);
  const cheap = changed.map((i, k) => ({ i, d: rs[k].s.total - st.best.confirm.total })).filter((x) => x.d < tol).sort((a, b) => a.d - b.d);
  log(`prune: ${changed.length} changed knobs, ${cheap.length} cost < ${tol.toFixed(0)} to put back`);
  for (let n = cheap.length; n > 0; n = Math.floor(n / 2)) {
    const xs = [...best];
    for (const { i } of cheap.slice(0, n)) xs[i] = st.base.xs[i];
    const [r] = await evalOne([xs], CONFIRM, seed);
    log(`prune: put back ${n} → ${r.s.total.toFixed(1)} (best ${st.best.confirm.total.toFixed(1)})`);
    if (r.s.total <= st.best.confirm.total + 2 * tol) {
      st.best = { xs, confirm: r.s, gen: st.best.gen };
      writeFileSync(STATE, JSON.stringify(st, null, 1));
      return;
    }
  }
}
const pool = new TunePool(WORKERS);
const base = x0();
const evalOne = async (xs: number[][], spec: Omit<EvalSpec, 'seed'>, seed: number) => {
  const ms = await measure(pool, xs.map(asTuning), { ...spec, seed });
  return ms.map((m, i) => ({ m, s: score(m, xs[i]) }));
};

console.log(`Mochi Moon tuner · ${KNOBS.length} knobs · days ${DAYS.join(',')} · ${WORKERS} workers · seed ${SEED}`);
try {
  if (EVAL) {
    const vs = [base, ...SETS.map(withSet)];
    const rs = await evalOne(vs, CONFIRM, hashSeed(SEED, 'confirm'));
    rs.forEach((r, i) => {
      curveTable(r.m, i === 0 ? 'current values' : `variant ${i}: ${JSON.stringify(SETS[i - 1])}`);
      console.log(`\nscore ${r.s.total.toFixed(1)}  (${partsStr(r.s)})`);
    });
    console.log(`${secs().toFixed(0)}s`);
  } else {
    let st: Saved;
    if (RESUME && existsSync(STATE)) {
      st = JSON.parse(readFileSync(STATE, 'utf8'));
      if (st.keys.join() !== KNOBS.map((k) => k.key).join()) throw new Error('state file has a different knob list; start a new search');
      // the objective may have changed since the save: score base and best again
      const [b, x] = await evalOne([st.base.xs, st.best.xs], CONFIRM, hashSeed(SEED, 'confirm'));
      st.base.confirm = b.s;
      st.best.confirm = x.s;
      log(`resumed ${STATE} at generation ${st.cma.gen} · base ${b.s.total.toFixed(1)} · best ${x.s.total.toFixed(1)} (${partsStr(x.s)})`);
    } else {
      const [b] = await evalOne([base], CONFIRM, hashSeed(SEED, 'confirm'));
      st = {
        version: 1, keys: KNOBS.map((k) => k.key), seed: SEED, days: DAYS,
        cma: cmaInit(toUnit(SETS.length ? withSet(SETS[0]) : base), SIGMA, LAMBDA, SEED),
        base: { xs: base, confirm: b.s }, best: { xs: base, confirm: b.s, gen: -1 }, history: [],
      };
      log(`baseline confirmed score ${b.s.total.toFixed(1)}  (${partsStr(b.s)})`);
    }
    // ---- search ----
    let genSecs = 0;
    let drift = 0;
    const FINAL_SECS = PRUNE ? 300 : 100;
    for (let g = 0; g < MAX_GENS; g++) {
      if (secs() + genSecs * 1.1 + FINAL_SECS > BUDGET) break;
      const gs = secs();
      const us = cmaAsk(st.cma);
      const xs = [...us.map(fromUnit), fromUnit(st.cma.mean)];
      const res = await evalOne(xs, COARSE, hashSeed(SEED, 'gen', st.cma.gen));
      const f = res.map((r) => r.s.total);
      const bi = f.slice(0, us.length).reduce((b, v, i) => (v < f[b] ? i : b), 0);
      // confirm the generation's best and the mean on the fixed confirmation seed
      const conf = await evalOne([xs[bi], xs[xs.length - 1]], CONFIRM, hashSeed(SEED, 'confirm'));
      for (const c of [0, 1]) {
        const cx = c === 0 ? xs[bi] : xs[xs.length - 1];
        if (conf[c].s.total < st.best.confirm.total) st.best = { xs: cx, confirm: conf[c].s, gen: st.cma.gen };
      }
      const gen = st.cma.gen;
      cmaTell(st.cma, us, f.slice(0, us.length));
      // noisy scores can walk the mean away from good regions: when the mean confirms > 1.5 × best for 3
      // generations in a row, put the mean back on the best point
      drift = conf[1].s.total > st.best.confirm.total * 1.5 ? drift + 1 : 0;
      if (drift >= 3) {
        st.cma.mean = toUnit(st.best.xs);
        drift = 0;
        log('        mean drifted: re-centred on the best');
      }
      genSecs = secs() - gs;
      st.history.push({ gen, sigma: st.cma.sigma, coarseBest: f[bi], coarseMean: f[f.length - 1], confirmBest: conf[0].s.total, confirmMean: conf[1].s.total, secs: genSecs });
      writeFileSync(STATE, JSON.stringify(st, null, 1));
      log(`gen ${String(gen).padStart(3)} · σ ${st.cma.sigma.toFixed(3)} · coarse best ${f[bi].toFixed(0)} mean-pt ${f[f.length - 1].toFixed(0)} · ` +
        `confirmed best ${conf[0].s.total.toFixed(0)} mean-pt ${conf[1].s.total.toFixed(0)} · overall best ${st.best.confirm.total.toFixed(1)} (gen ${st.best.gen}) · ${genSecs.toFixed(0)}s`);
      log(`        best parts: ${partsStr(st.best.confirm)}`);
    }
    // ---- prune: put back knobs whose change does not pay for itself (fewer, more readable changes) ----
    if (PRUNE && MAX_GENS > 0) await prune(st);
    // ---- final check with fresh seeds ----
    log('final check (fresh seeds): baseline vs best');
    const [fb, fx] = await evalOne([st.base.xs, st.best.xs], FINAL, hashSeed(SEED, 'final'));
    curveTable(fb.m, 'BEFORE (current values)');
    curveTable(fx.m, 'AFTER (best found)');
    console.log(`\nscore before ${fb.s.total.toFixed(1)} (${partsStr(fb.s)})`);
    console.log(`score after  ${fx.s.total.toFixed(1)} (${partsStr(fx.s)})`);
    knobTable(st.base.xs, st.best.xs);
    if (APPLY || DRY) {
      if (fx.s.total >= fb.s.total) console.log('\nbest is not better than the current values on fresh seeds: nothing applied');
      else {
        const changed = applyTuningFile(asTuning(st.best.xs), DRY || !APPLY);
        console.log(DRY ? `\n--dry: would change ${changed.length} value(s) in src/sim/tuning.ts` :
          `\napplied ${changed.length} value(s) to src/sim/tuning.ts — bump SIM_VERSION in src/sim/combat.ts, then npm test / npm run sim`);
      }
    }
    console.log(`targets used: hero/arch pairs ≤ ${TARGETS.hero * 100}% · reach 10 in ${TARGETS.runMin * 100}–${TARGETS.runMax * 100}% · 0-skill ≤ ${TARGETS.zeroSkill * 100}% · fatigue ≤ ${TARGETS.fatigue * 100}%`);
  }
} finally {
  await pool.close();
}
log('done');
