// Fast balance simulator: matchups, whole bot runs, per-skill stats, bot tier check. Uses every CPU core.
// Usage: npm run sim -- [matchups|runs|skills|tiers|lines|all] [--n 200] [--days 3,5,10,13] [--tier easy|normal|hard|mix]
//          [--seed 1] [--pool 24] [--workers N] [--json out.json] [--compare old.json] [--strict] [--full]
// See docs/SIMULATOR.md.
import { WIN_TARGET } from '../src/sim/run';
import { readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { BOT_TIERS, type BotTier } from '../src/sim/bot';
import { SIM_VERSION } from '../src/sim/combat';
import { HEROES, ultLevel } from '../src/sim/heroes';
import { LINE_ICON, SKILLS, SKILL_LIST } from '../src/sim/skills';
import { LINES, type Build, type Line } from '../src/sim/types';
import { MAX_DAY, type Ctx, type Job, type MatchRes, type RunsRes, type SkillAcc, type TierSpec, type TiersRes } from './sim/jobs';
import { healthSummary, mergeHealth, newHealth, type Health, type HealthSummary } from './sim/metrics';
import { runJobs } from './sim/pool';
import type { LinesRes } from './sim/lines';
import { BEATS, TARGETS, ULT_LOW, lengthTarget } from './sim/targets';

// ---------------- options ----------------
const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes('--' + name);
const opt = (name: string, def: string) => {
  const i = argv.indexOf('--' + name);
  if (i >= 0 && argv[i + 1] !== undefined) return argv[i + 1];
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  return eq ? eq.slice(name.length + 3) : def;
};
const VALUED = new Set(['n', 'days', 'tier', 'seed', 'pool', 'workers', 'json', 'compare']);
const positional = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && VALUED.has(argv[i - 1].replace(/^--/, ''))));
const MODE = positional[0] ?? 'all';
const MODES = ['matchups', 'runs', 'skills', 'tiers', 'lines', 'all'];
if (!MODES.includes(MODE) || flag('help')) {
  console.log('usage: npm run sim -- [matchups|runs|skills|tiers|lines|all] [--n 200] [--days 3,5,10,13] [--tier normal|easy|hard|mix]\n' +
    '                        [--seed 1] [--pool 24] [--workers N] [--json out.json] [--compare old.json] [--strict] [--full]');
  process.exit(flag('help') ? 0 : 2);
}
const N = Math.max(4, Number(opt('n', '200')));
const DAYS = opt('days', '3,5,10,13').split(',').map(Number).filter((d) => d >= 1);
const TIER = opt('tier', 'normal') as TierSpec;
if (![...BOT_TIERS, 'mix'].includes(TIER)) throw new Error('--tier must be easy|normal|hard|mix');
const SEED = Number(opt('seed', '1'));
const POOL = Number(opt('pool', '24'));
const WORKERS = Number(opt('workers', String(availableParallelism())));
const JSON_OUT = opt('json', '');
const COMPARE = opt('compare', '');
const STRICT = flag('strict');
const FULL = flag('full');
const ctx: Ctx = { seed: SEED, tier: TIER };
const CHUNK = 25;

// ---------------- formatting ----------------
const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const a = [...xs].sort((x, y) => x - y);
  return a[Math.floor(a.length / 2)];
};
const pct = (x: number, w = 6) => (Number.isFinite(x) ? (x * 100).toFixed(0) + '%' : '-').padStart(w);
const num = (x: number, d = 1, w = 6) => x.toFixed(d).padStart(w);
const ok = (b: boolean) => (b ? '✔' : '✘');
const hr = (title: string) => console.log(`\n━━ ${title} ${'━'.repeat(Math.max(3, 74 - title.length))}`);
const t0 = performance.now();
const elapsed = () => ((performance.now() - t0) / 1000).toFixed(1) + 's';
const log = (msg: string) => process.stderr.write(`  [${elapsed()}] ${msg}\n`);

interface Target {
  name: string;
  ok: boolean;
  value: number;
  limit: string;
}
const targets: Target[] = [];
const target = (name: string, value: number, pass: boolean, limit: string) => targets.push({ name, ok: pass, value, limit });

const chunks = (n: number, size = CHUNK) => Array.from({ length: Math.ceil(n / size) }, (_, i) => [i * size, Math.min(n, (i + 1) * size)] as const);
const report: Record<string, unknown> = {
  meta: { mode: MODE, n: N, days: DAYS, tier: TIER, seed: SEED, pool: POOL, simVersion: SIM_VERSION },
};

// ---------------- matchups + fight length / health ----------------
async function matchups() {
  hr(`Matchups · tier ${TIER} · ${N} builds per hero`);
  const bjobs: Job[] = [];
  const bkey: [number, string][] = [];
  for (const day of DAYS)
    for (const h of HEROES)
      for (const [from, to] of chunks(N)) {
        bjobs.push({ k: 'builds', c: ctx, day, hero: h.id, from, to });
        bkey.push([day, h.id]);
      }
  const bres = await runJobs<Build[]>(bjobs, WORKERS);
  const builds: Record<number, Record<string, Build[]>> = {};
  bres.forEach((b, i) => {
    const [day, hero] = bkey[i];
    ((builds[day] ??= {})[hero] ??= []).push(...b);
  });
  log('builds done');

  const mjobs: Job[] = [];
  for (const day of DAYS) for (const h of HEROES) mjobs.push({ k: 'match', c: ctx, day, a: h.id, n: N, builds: builds[day] });
  const lenDays = Array.from({ length: Math.max(13, ...DAYS) }, (_, i) => i + 1);
  const LEN_N = Math.max(300, 2 * N);
  const ljobs: Job[] = lenDays.flatMap((day) => chunks(LEN_N, 100).map(([from, to]): Job => ({ k: 'len', c: ctx, day, from, to })));
  const all = await runJobs<unknown>([...mjobs, ...ljobs], WORKERS);
  const mres = all.slice(0, mjobs.length) as MatchRes[];
  const lres = all.slice(mjobs.length) as Health[];
  log('fights done');

  const out: Record<string, unknown> = {};
  const beatsAcc: Record<string, number[]> = {};
  const ultByHero: Record<string, { on: number; fired: number; at: number[]; uScore: number; lScore: number; lN: number; unlock: Record<number, number>; unlock2: Record<number, number> }> = {};
  const ultDay: Record<number, Record<string, { on: number; fired: number; at: number }>> = {};
  const overallByDay: Record<number, Record<string, number>> = {};
  const zeroByDay: Record<number, Record<string, number>> = {};
  const pairsOver: string[] = [];
  for (const [di, day] of DAYS.entries()) {
    const score: Record<string, Record<string, number>> = {};
    const count: Record<string, Record<string, number>> = {};
    let games = 0;
    let ticks = 0;
    HEROES.forEach((h, hi) => {
      const r = mres[di * HEROES.length + hi];
      score[h.id] = r.score;
      count[h.id] = r.count;
      games += Object.values(r.count).reduce((n, x) => n + x, 0);
      ticks += r.ticks;
      (zeroByDay[day] ??= {})[h.id] = r.zero / r.sides;
    });
    // line matrix (by hero main line; one hero per line, so it is the hero matrix grouped by line)
    const line: Record<string, Record<string, number>> = {};
    console.log(`\nDay ${day} · ${games} fights · avg ${(ticks / games / 10).toFixed(1)}s   line win rate (row vs column) · * = designed counter (row beats column)`);
    console.log('          ' + LINES.map((a) => `${LINE_ICON[a]}${a}`.padStart(9)).join(''));
    let lineWorst = 0;
    for (const a of LINES) {
      line[a] = {};
      const row = LINES.map((b) => {
        let s = 0;
        let n = 0;
        for (const A of HEROES.filter((h) => h.line === a))
          for (const B of HEROES.filter((h) => h.line === b)) {
            s += score[A.id][B.id];
            n += count[A.id][B.id];
          }
        const r = s / n;
        line[a][b] = r;
        if (a !== b) lineWorst = Math.max(lineWorst, r);
        (beatsAcc[`${a}>${b}`] ??= []).push(r);
        return a === b ? '        -' : pct(r, 8) + (BEATS[a]?.includes(b) ? '*' : r > TARGETS.line ? '!' : ' ');
      });
      console.log(`${LINE_ICON[a]}${a}`.padEnd(10) + row.join(''));
    }
    target(`day ${day}: line matchups ≤ ${pct(TARGETS.line, 0)}`, lineWorst, lineWorst <= TARGETS.line, `worst ${pct(lineWorst, 0)}`);
    // ultimates: unlock share of the bot builds, fire rate and fire time
    for (const h of HEROES) {
      const bs = builds[day][h.id];
      const lv = bs.map((b) => ultLevel(b));
      const r = mres[di * HEROES.length + HEROES.indexOf(h)];
      const u = (ultByHero[h.id] ??= { on: 0, fired: 0, at: [], uScore: 0, lScore: 0, lN: 0, unlock: {}, unlock2: {} });
      u.on += r.ultOn;
      u.fired += r.ultFired;
      u.at.push(...r.ultAt);
      u.uScore += r.ultScore;
      u.lScore += r.lockScore;
      u.lN += r.lockN;
      u.unlock[day] = lv.filter((x) => x >= 1).length / lv.length;
      u.unlock2[day] = lv.filter((x) => x >= 2).length / lv.length;
      (ultDay[day] ??= {})[h.id] = { on: r.ultOn, fired: r.ultFired, at: median(r.ultAt) };
    }
    // hero pairs + overall
    const hero: Record<string, Record<string, number>> = {};
    const overall: Record<string, number> = {};
    let heroWorst = 0;
    for (const A of HEROES) {
      hero[A.id] = {};
      let s = 0;
      let n = 0;
      for (const B of HEROES) {
        const r = score[A.id][B.id] / count[A.id][B.id];
        hero[A.id][B.id] = r;
        if (A.id === B.id) continue;
        s += score[A.id][B.id];
        n += count[A.id][B.id];
        heroWorst = Math.max(heroWorst, r);
        if (r > TARGETS.hero) pairsOver.push(`day ${day}: ${A.id} beats ${B.id} ${pct(r, 0)}`);
      }
      overall[A.id] = s / n;
    }
    if (FULL) {
      console.log('\n  hero (row vs column)  ' + HEROES.map((h) => h.id.slice(0, 6).padStart(7)).join(''));
      for (const A of HEROES) console.log('  ' + A.id.padEnd(21) + HEROES.map((B) => (A.id === B.id ? '      -' : pct(hero[A.id][B.id], 7))).join(''));
    }
    const rates = Object.values(overall);
    const spread = Math.max(...rates) - Math.min(...rates);
    target(`day ${day}: hero pairs ≤ ${pct(TARGETS.hero, 0)}`, heroWorst, heroWorst <= TARGETS.hero, `worst ${pct(heroWorst, 0)}`);
    target(`day ${day}: hero spread ≤ ${TARGETS.heroSpread * 100} pts`, spread, spread <= TARGETS.heroSpread, `${(spread * 100).toFixed(0)} pts`);
    const outOf = HEROES.filter((h) => overall[h.id] < TARGETS.heroLo || overall[h.id] > TARGETS.heroHi);
    target(`day ${day}: every hero ${pct(TARGETS.heroLo, 0).trim()}–${pct(TARGETS.heroHi, 0).trim()}`, outOf.length, !outOf.length,
      outOf.length ? outOf.map((h) => `${h.id} ${pct(overall[h.id], 0).trim()}`).join(', ') : 'all in');
    overallByDay[day] = overall;
    out[day] = { line, hero, overall, spread, zeroSkill: zeroByDay[day], avgLen: ticks / games / 10 };
  }

  console.log(`\nHero overall win rate (vs every other hero) · 0-skill = share of its fights where it cast nothing`);
  console.log('hero        ' + DAYS.map((d) => `d${d}`.padStart(7)).join('') + '   ' + DAYS.map((d) => `0sk d${d}`.padStart(9)).join(''));
  for (const h of HEROES)
    console.log(h.id.padEnd(12) + DAYS.map((d) => pct(overallByDay[d][h.id], 7)).join('') + '   ' + DAYS.map((d) => pct(zeroByDay[d][h.id], 9)).join(''));
  console.log('spread      ' + DAYS.map((d) => num((Math.max(...Object.values(overallByDay[d])) - Math.min(...Object.values(overallByDay[d]))) * 100, 0, 6) + 'p').join(''));
  if (pairsOver.length) console.log(`\nHero pairs over ${pct(TARGETS.hero, 0)}:\n  ` + pairsOver.join('\n  '));

  // designed counters: each "beats" pair, per day and averaged
  hr(`Counter web · designed pairs (row beats column), target ${pct(TARGETS.beatsLo, 0).trim()}–${pct(TARGETS.beatsHi, 0).trim()} averaged over days`);
  console.log('pair               ' + DAYS.map((d) => `d${d}`.padStart(6)).join('') + '     avg');
  const beats: Record<string, number> = {};
  const beatMiss: string[] = [];
  for (const a of LINES)
    for (const b of BEATS[a]) {
      const xs = beatsAcc[`${a}>${b}`] ?? [];
      const avg = xs.reduce((n, x) => n + x, 0) / Math.max(1, xs.length);
      beats[`${a}>${b}`] = avg;
      const okb = avg >= TARGETS.beatsLo && avg <= TARGETS.beatsHi;
      if (!okb) beatMiss.push(`${a}>${b} ${pct(avg, 0).trim()}`);
      console.log(`${LINE_ICON[a]}${a} > ${LINE_ICON[b as Line]}${b}`.padEnd(19) + xs.map((x) => pct(x, 6)).join('') + pct(avg, 8) + ' ' + ok(okb));
    }
  target(`counter pairs ${pct(TARGETS.beatsLo, 0).trim()}–${pct(TARGETS.beatsHi, 0).trim()} (avg over days)`, beatMiss.length, !beatMiss.length,
    beatMiss.length ? `${16 - beatMiss.length}/16 in · miss ${beatMiss.join(', ')}` : '16/16 in');

  // ultimates
  hr('Ultimates · bot builds of the matchup days');
  console.log('hero        ' + DAYS.map((d) => `unl d${d}`.padStart(8)).join('') + '  ' + DAYS.map((d) => `Lv2 d${d}`.padStart(8)).join('') +
    '   fire%  at(med)  win unl/locked');
  const ult: Record<string, unknown> = {};
  for (const h of HEROES) {
    const u = ultByHero[h.id];
    const fire = u.fired / Math.max(1, u.on);
    const at = median(u.at);
    const winU = u.uScore / Math.max(1, u.on);
    const winL = u.lScore / Math.max(1, u.lN);
    ult[h.id] = { unlock: u.unlock, unlock2: u.unlock2, fire, at, winUnlocked: winU, winLocked: winL, byDay: Object.fromEntries(DAYS.map((d) => [d, ultDay[d][h.id]])) };
    console.log(h.id.padEnd(12) + DAYS.map((d) => pct(u.unlock[d], 8)).join('') + '  ' + DAYS.map((d) => pct(u.unlock2[d], 8)).join('') +
      `${pct(fire, 8)}${pct(at, 9)}   ${pct(winU, 0).trim()} / ${u.lN ? pct(winL, 0).trim() : '-'}`);
    const lowOk = ULT_LOW.includes(h.id) ? TARGETS.ultFireLow : TARGETS.ultFire;
    target(`${h.id} ult fires ≥ ${pct(lowOk, 0).trim()} when unlocked`, fire, fire >= lowOk, pct(fire, 0).trim());
    target(`${h.id} ult median time ${pct(TARGETS.ultTimeLo, 0).trim()}–${pct(TARGETS.ultTimeHi, 0).trim()} of the fight`, at, at >= TARGETS.ultTimeLo && at <= TARGETS.ultTimeHi, pct(at, 0).trim());
  }
  console.log('  unl = share of bot builds with ult Lv1+ · fire% = fights where it fired / fights where unlocked · at = median fire tick / fight length');
  report.ult = ult;
  report.beats = beats;

  // length / health per day (random bot builds of random heroes)
  hr(`Fight length & health per day · ${LEN_N} random fights per day`);
  console.log('day   avg   p10   p90  target      fatigue  0-skill locked ctl/side ctlmax  close trig/f chain  ult1+  ult2 fire%');
  const perChunk = Math.ceil(LEN_N / 100);
  const length: Record<number, HealthSummary> = {};
  let allH = newHealth();
  const lenMiss: string[] = [];
  let fatWorst = 0;
  let fatWorstDay = 0;
  for (const [di, day] of lenDays.entries()) {
    let h = newHealth();
    for (let k = 0; k < perChunk; k++) h = mergeHealth(h, lres[di * perChunk + k]);
    allH = mergeHealth(allH, h);
    const s = healthSummary(h);
    length[day] = s;
    const [lo, hi] = lengthTarget(day);
    const lenOk = s.avgLen >= lo && s.avgLen <= hi;
    if (!lenOk) lenMiss.push(`d${day} ${s.avgLen.toFixed(1)}s`);
    if (s.fatigue >= fatWorst) [fatWorst, fatWorstDay] = [s.fatigue, day];
    console.log(
      `${String(day).padStart(3)} ${num(s.avgLen, 1, 5)}s${num(s.p10, 1, 5)}s${num(s.p90, 1, 5)}s  ${`${lo}–${hi}s`.padEnd(7)}${ok(lenOk)}` +
        `${pct(s.fatigue, 7)}${ok(s.fatigue <= TARGETS.fatigue)}${pct(s.zeroSkill, 7)}${s.zeroSkill <= TARGETS.zeroSkill ? ' ' : '!'}${pct(s.locked, 6)}` +
        `${num(s.ctlAvg, 1, 7)}s${num(s.ctlMax, 1, 6)}s${pct(s.close, 7)}${num(s.trigPerFight, 1, 7)}${String(s.chainMax).padStart(6)}` +
        `${pct(s.ult1, 7)}${pct(s.ult2, 6)}${pct(s.ultFire, 6)}`,
    );
  }
  const tot = healthSummary(allH);
  target(`avg fight length in target every day (1–${lenDays.length})`, lenMiss.length, !lenMiss.length, lenMiss.length ? `miss ${lenMiss.join(', ')}` : 'all days');
  target(`fatigue-ended ≤ ${pct(TARGETS.fatigue, 0)} every day`, fatWorst, fatWorst <= TARGETS.fatigue, `worst ${pct(fatWorst, 0)} (day ${fatWorstDay})`);
  target(`0-skill fights ≤ ${pct(TARGETS.zeroSkill, 0)} (days 1–${lenDays.length})`, tot.zeroSkill, tot.zeroSkill <= TARGETS.zeroSkill, pct(tot.zeroSkill, 0));
  console.log(
    `all ${num(tot.avgLen, 1, 5)}s                       ${pct(tot.fatigue, 7)} ${pct(tot.zeroSkill, 7)} ${pct(tot.locked, 6)}${num(tot.ctlAvg, 1, 7)}s${num(tot.ctlMax, 1, 6)}s${pct(tot.close, 7)}${num(tot.trigPerFight, 1, 7)}${String(tot.chainMax).padStart(6)}`,
  );
  console.log('  0-skill = sides that cast nothing · locked = sides frozen/delayed ≥ 25% of the fight · ctl = freeze + cast-delay received\n' +
    '  close = winner ends ≤ 10% HP · trig/f = trigger-bonus casts per fight · chain = biggest trigger chain in one tick\n' +
    '  ult1+ / ult2 = sides with the ultimate unlocked (Lv1+, Lv2) · fire% = of those, fights where it fired');
  report.matchups = out;
  report.length = length;
  report.health = tot;
}

// ---------------- runs + skills ----------------
let runsCache: RunsRes[] | null = null;
async function runRuns(): Promise<RunsRes[]> {
  if (runsCache) return runsCache;
  const pjobs: Job[] = Array.from({ length: MAX_DAY }, (_, i) => ({ k: 'pool', c: ctx, day: i + 1, size: POOL }));
  const pres = await runJobs<Build[]>(pjobs, WORKERS);
  const pool: Build[][] = [[], ...pres];
  log('opponent pool done');
  const rjobs: Job[] = HEROES.flatMap((h) => chunks(N).map(([from, to]) => ({ k: 'runs', c: ctx, hero: h.id, from, to } as Job)));
  rjobs.forEach((j) => ((j as Extract<Job, { k: 'runs' }>).pool = pool));
  const parts = await runJobs<RunsRes>(rjobs, WORKERS);
  log('runs done');
  // merge chunks per hero (in job order)
  const by: Record<string, RunsRes> = {};
  for (const p of parts) {
    const a = by[p.hero];
    if (!a) {
      by[p.hero] = p;
      continue;
    }
    for (const k of ['runs', 'won', 'wins', 'days', 'repeat3', 'dead', 'deadRepeat', 'deadMajority'] as const) a[k] += p[k];
    for (const [t, v] of Object.entries(p.byTier)) {
      const x = (a.byTier[t] ??= { runs: 0, won: 0 });
      x.runs += v.runs;
      x.won += v.won;
    }
    for (const [id, v] of Object.entries(p.skills)) {
      const x = (a.skills[id] ??= { own8: 0, ownAll: 0, fights: 0, wins: 0, share: 0, shareN: 0 });
      for (const k of Object.keys(v) as (keyof SkillAcc)[]) x[k] += v[k];
    }
    a.health = mergeHealth(a.health, p.health);
    for (const k of ['ult1Day', 'ult2Day'] as const) for (const [d, v] of Object.entries(p[k])) a[k][+d] = (a[k][+d] ?? 0) + v;
  }
  runsCache = HEROES.map((h) => by[h.id]);
  return runsCache;
}

async function runs() {
  const res = await runRuns();
  hr(`Bot runs · tier ${TIER} · ${N} runs per hero vs a same-day pool of ${POOL} bot builds`);
  const totalWon = res.reduce((n, x) => n + x.won, 0);
  console.log(`hero         win share    reach ${WIN_TARGET}  avg wins  avg days`);
  const reach: number[] = [];
  const heroes: Record<string, unknown> = {};
  for (const x of res) {
    const share = totalWon ? x.won / totalWon : 0;
    const r8 = x.won / x.runs;
    reach.push(r8);
    heroes[x.hero] = { share, reach8: r8, avgWins: x.wins / x.runs, avgDays: x.days / x.runs };
    console.log(`${x.hero.padEnd(12)}${pct(share, 11)}${pct(r8, 10)}${num(x.wins / x.runs, 2, 11)}${num(x.days / x.runs, 1, 10)}`);
    if (share > TARGETS.runShare) target(`${x.hero} owns ≤ ${pct(TARGETS.runShare, 0)} of ${WIN_TARGET}-win runs`, share, false, pct(share, 0));
    target(`${x.hero} reaches ${WIN_TARGET} wins in ${pct(TARGETS.runMin, 0)}–${pct(TARGETS.runMax, 0)} of runs`, r8, r8 >= TARGETS.runMin && r8 <= TARGETS.runMax, pct(r8, 0));
  }
  const spread = Math.max(...reach) - Math.min(...reach);
  console.log(`spread of "reach ${WIN_TARGET}": ${(spread * 100).toFixed(0)} pts (info only: heroes are meant to differ)`);

  const byTier: Record<string, { runs: number; won: number }> = {};
  for (const x of res) for (const [t, v] of Object.entries(x.byTier)) {
    const a = (byTier[t] ??= { runs: 0, won: 0 });
    a.runs += v.runs;
    a.won += v.won;
  }
  if (Object.keys(byTier).length > 1)
    console.log('reach 8 by runner tier: ' + BOT_TIERS.filter((t) => byTier[t]).map((t) => `${t} ${pct(byTier[t].won / byTier[t].runs, 0)}`).join(' · '));

  const sum = (k: 'runs' | 'repeat3' | 'dead' | 'deadRepeat' | 'deadMajority') => res.reduce((n, x) => n + x[k], 0);
  const repeats = {
    meet3: sum('repeat3') / sum('runs'),
    lostTwiceSame: sum('deadRepeat') / Math.max(1, sum('dead')),
    lostMostlySame: sum('deadMajority') / Math.max(1, sum('dead')),
  };
  console.log(
    `same opponent: ${pct(repeats.meet3, 0)} of runs meet one opponent ≥ 3 times · of lost runs ${pct(repeats.lostTwiceSame, 0)} lost twice to the same one,` +
      ` ${pct(repeats.lostMostlySame, 0)} lost mostly to one`,
  );
  const h = healthSummary(res.reduce((a, x) => mergeHealth(a, x.health), newHealth()));
  console.log(
    `run fights: ${h.fights} · avg ${h.avgLen.toFixed(1)}s · 0-skill ${pct(h.zeroSkill, 0)} · locked ${pct(h.locked, 0)} · ctl/side ${h.ctlAvg.toFixed(1)}s (max ${h.ctlMax.toFixed(1)}s)` +
      ` · fatigue ${pct(h.fatigue, 0)} · close ${pct(h.close, 0)} · trig/fight ${h.trigPerFight.toFixed(1)}`,
  );
  // first day the ultimate reached Lv1 / Lv2 in each run (median over runs that got there; share that never did)
  console.log(`\nUlt unlock day (runs, tier ${TIER}) · median first day of Lv1 / Lv2 · p25–p75 · never = run ended first`);
  const ultDays: Record<string, unknown> = {};
  const q = (hist: Record<number, number>, p: number) => {
    const xs = Object.entries(hist).filter(([d]) => +d > 0).sort((a, b) => +a[0] - +b[0]);
    const tot = xs.reduce((n, [, v]) => n + v, 0);
    let acc = 0;
    for (const [d, v] of xs) if ((acc += v) >= tot * p) return +d;
    return NaN;
  };
  for (const x of res) {
    const never1 = (x.ult1Day[0] ?? 0) / x.runs;
    const never2 = (x.ult2Day[0] ?? 0) / x.runs;
    ultDays[x.hero] = { lv1: q(x.ult1Day, 0.5), lv2: q(x.ult2Day, 0.5), never1, never2 };
    console.log(`${x.hero.padEnd(12)} Lv1 d${q(x.ult1Day, 0.5)} (${q(x.ult1Day, 0.25)}–${q(x.ult1Day, 0.75)}) never ${pct(never1, 0)}` +
      `   Lv2 d${q(x.ult2Day, 0.5)} (${q(x.ult2Day, 0.25)}–${q(x.ult2Day, 0.75)}) never ${pct(never2, 0)}`);
  }
  report.runs = { heroes, spread, byTier, repeats, health: h, ultDays };
}

async function skills() {
  const res = await runRuns();
  const acc: Record<string, SkillAcc> = {};
  for (const x of res)
    for (const [id, v] of Object.entries(x.skills)) {
      const a = (acc[id] ??= { own8: 0, ownAll: 0, fights: 0, wins: 0, share: 0, shareN: 0 });
      for (const k of Object.keys(v) as (keyof SkillAcc)[]) a[k] += v[k];
    }
  const won = res.reduce((n, x) => n + x.won, 0);
  const runsN = res.reduce((n, x) => n + x.runs, 0);
  // heroes that can own each skill (unique skills: one hero), to turn counts into rates
  const ownersOf = (id: string) => (SKILLS[id].hero ? res.filter((x) => x.hero === SKILLS[id].hero) : res);
  hr(`Skills · from bot runs (${runsN} runs, ${won} reached 8 wins)`);
  console.log('skill       line      pick in 8-win  pick (all)  win% owned  dmg share  fights');
  const rows = SKILL_LIST.map((d) => {
    const a = acc[d.id] ?? { own8: 0, ownAll: 0, fights: 0, wins: 0, share: 0, shareN: 0 };
    const owners = ownersOf(d.id);
    const won8 = owners.reduce((n, x) => n + x.won, 0);
    const all = owners.reduce((n, x) => n + x.runs, 0);
    return {
      id: d.id, arch: d.hero ? `${d.line}*` : d.line,
      pick8: won8 ? a.own8 / won8 : NaN, pick: all ? a.ownAll / all : 0,
      winRate: a.fights ? a.wins / a.fights : NaN, dmgShare: a.shareN ? a.share / a.shareN : 0, fights: a.fights,
    };
  }).sort((x, y) => (y.pick8 || 0) - (x.pick8 || 0));
  for (const r of rows)
    console.log(
      `${r.id.padEnd(12)}${r.arch.padEnd(10)}${pct(r.pick8, 13)}${pct(r.pick, 12)}${pct(r.winRate, 12)}${pct(r.dmgShare, 11)}${String(r.fights).padStart(8)}`,
    );
  console.log('  * = hero-unique (rates use that hero\'s runs) · win% owned = fight win rate of run builds that had it · dmg share = its share of its side\'s damage');
  report.skills = Object.fromEntries(rows.map((r) => [r.id, r]));
}


// ---------------- lines: in-line vs off-line, day-1 openings, ult value ----------------
async function lines() {
  const LTIER = TIER === 'easy' || TIER === 'mix' ? 'normal' : TIER;
  const jobs: Job[] = [];
  for (const day of DAYS) for (const h of HEROES) for (const [from, to] of chunks(N)) jobs.push({ k: 'lines', c: ctx, day, hero: h.id, from, to, tier: LTIER });
  for (const h of HEROES) jobs.push({ k: 'day1', c: ctx, hero: h.id, n: Math.max(50, N) });
  const parts = await runJobs<unknown>(jobs, WORKERS);
  log('lines done');
  const nl = DAYS.length * HEROES.length * chunks(N).length;
  const lres = parts.slice(0, nl) as LinesRes[];
  const d1 = parts.slice(nl) as Record<string, { easy: number; normal: number; n: number }>[];
  hr(`Lines · ${LTIER} bots: in-line (prefers its line) vs off-line (never buys its line or unique) · ${N} per hero per day`);
  console.log('h2h = in-line beats off-line (same hero) · pool = vs random normal bots of the day (in / off)');
  console.log('hero        ' + DAYS.map((d) => `h2h d${d}`.padStart(9)).join('') + '   ' + DAYS.map((d) => `pool d${d}`.padStart(11)).join(''));
  const per = chunks(N).length;
  const out: Record<string, unknown> = {};
  const inSk: Record<string, number> = {};
  const offSk: Record<string, number> = {};
  let builds = 0;
  const ultAcc: Record<string, Record<number, [number, number, number]>> = {};
  const h2hMid: number[] = [];
  let k = 0;
  const agg: Record<string, Record<number, LinesRes>> = {};
  for (const day of DAYS)
    for (const h of HEROES) {
      const a: LinesRes = { h2h: 0, n: 0, inPool: 0, offPool: 0, ult: {}, inSkills: {}, offSkills: {} };
      for (let c = 0; c < per; c++) {
        const p = lres[k++];
        a.h2h += p.h2h; a.n += p.n; a.inPool += p.inPool; a.offPool += p.offPool;
        for (const [lv, u] of Object.entries(p.ult)) {
          const x = ((ultAcc[h.id] ??= {})[+lv] ??= [0, 0, 0]);
          x[0] += u[0]; x[1] += u[1]; x[2] += u[2];
        }
        for (const [id, v] of Object.entries(p.inSkills)) inSk[id] = (inSk[id] ?? 0) + v;
        for (const [id, v] of Object.entries(p.offSkills)) offSk[id] = (offSk[id] ?? 0) + v;
      }
      builds += a.n / 2;
      (agg[h.id] ??= {})[day] = a;
    }
  for (const h of HEROES) {
    const row = DAYS.map((d) => pct(agg[h.id][d].h2h / agg[h.id][d].n, 9)).join('');
    const pool = DAYS.map((d) => `${pct(agg[h.id][d].inPool / agg[h.id][d].n, 5)}/${pct(agg[h.id][d].offPool / agg[h.id][d].n, 0)}`.padStart(11)).join('');
    console.log(h.id.padEnd(12) + row + '   ' + pool);
    out[h.id] = Object.fromEntries(DAYS.map((d) => [d, { h2h: agg[h.id][d].h2h / agg[h.id][d].n, inPool: agg[h.id][d].inPool / agg[h.id][d].n, offPool: agg[h.id][d].offPool / agg[h.id][d].n }]));
    for (const d of DAYS) if (d >= 5) h2hMid.push(agg[h.id][d].h2h / agg[h.id][d].n);
  }
  const avgMid = h2hMid.reduce((n, x) => n + x, 0) / Math.max(1, h2hMid.length);
  const worstMid = Math.min(...h2hMid);
  target('in-line beats off-line ≥ 55% (avg, days ≥ 5)', avgMid, avgMid >= 0.55, `avg ${pct(avgMid, 0).trim()}, worst ${pct(worstMid, 0).trim()}`);

  // ult value: in-line builds with their ult vs the same fights with it locked
  console.log('\nUlt value · in-line builds vs the pool, with the ult / locked (all days) · Δ = points the ult is worth');
  console.log('hero          Lv1 with  locked     Δ     n   Lv2 with  locked     Δ     n');
  const ultV: Record<string, unknown> = {};
  const deltas: number[] = [];
  for (const h of HEROES) {
    const cells = [1, 2].map((lv) => {
      const u = ultAcc[h.id]?.[lv];
      if (!u || u[0] < 20) return { s: '       -       -     -     -', d: NaN };
      const w = u[1] / u[0];
      const l = u[2] / u[0];
      deltas.push(w - l);
      return { s: `${pct(w, 10)}${pct(l, 8)}${num((w - l) * 100, 0, 6)}${String(u[0]).padStart(6)}`, d: w - l, w, l };
    });
    ultV[h.id] = { lv1: cells[0].d, lv2: cells[1].d };
    console.log(h.id.padEnd(12) + cells.map((c) => c.s).join(' '));
  }
  const maxD = Math.max(...deltas.filter(Number.isFinite));
  target('ult worth ≤ 15 pts at Lv1 / Lv2 (every hero)', maxD, maxD <= 0.15, `max ${(maxD * 100).toFixed(0)} pts`);

  // what the builds own (Lv2+ keeps the branch letter)
  const top = (m: Record<string, number>) => Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([id, v]) => `${id} ${pct(v / builds, 0).trim()}`).join(' · ');
  console.log(`\nOff-line builds own: ${top(offSk)}`);
  console.log(`In-line builds own:  ${top(inSk)}`);

  // day 1 openings
  console.log('\nDay 1 · every affordable opening from the fixed shop vs random day-1 bots (easy / normal), best and worst');
  const best: number[] = [];
  const d1Out: Record<string, unknown> = {};
  HEROES.forEach((h, i) => {
    const rows = Object.entries(d1[i]).map(([key, v]) => ({ key, e: v.easy / v.n, nn: v.normal / v.n })).sort((a, b) => b.nn - a.nn);
    const b = rows[0];
    const w = rows[rows.length - 1];
    best.push(b.nn);
    d1Out[h.id] = Object.fromEntries(rows.map((r) => [r.key, { easy: r.e, normal: r.nn }]));
    console.log(`${h.id.padEnd(12)} best ${b.key.padEnd(20)} ${pct(b.e, 4)} / ${pct(b.nn, 0)}   worst ${w.key.padEnd(20)} ${pct(w.e, 4)} / ${pct(w.nn, 0)}`);
  });
  const lo = Math.min(...best);
  const hi = Math.max(...best);
  target('day-1 best opening vs normal bots 50%–70% (every hero)', hi - lo, lo >= 0.5 && hi <= 0.7, `${pct(lo, 0).trim()}–${pct(hi, 0).trim()}`);
  report.lines = { heroes: out, ult: ultV, day1: d1Out, offSkills: offSk, inSkills: inSk };
}

// ---------------- tiers ----------------
async function tiers() {
  const pairs: [BotTier, BotTier][] = [['hard', 'normal'], ['normal', 'easy'], ['hard', 'easy']];
  const jobs: Job[] = [];
  for (const day of DAYS) for (const [x, y] of pairs) for (const [from, to] of chunks(N)) jobs.push({ k: 'tiers', c: ctx, day, x, y, from, to });
  const parts = await runJobs<TiersRes>(jobs, WORKERS);
  log('tiers done');
  hr(`Bot tiers · ${N} fights per pair per day (random heroes, both sides)`);
  console.log('day   ' + pairs.map(([x, y]) => `${x}>${y}`.padStart(13)).join(''));
  const per = Math.ceil(N / CHUNK);
  const avg: number[] = pairs.map(() => 0);
  const minDay: number[] = pairs.map(() => 1);
  const stats: Record<string, { gold: number; skills: number; lv: number; n: number }> = {};
  const out: Record<string, Record<string, number>> = {};
  let k = 0;
  for (const day of DAYS) {
    const row: string[] = [];
    out[day] = {};
    pairs.forEach(([x, y], pi) => {
      let s = 0;
      let n = 0;
      for (let c = 0; c < per; c++) {
        const p = parts[k++];
        s += p.score;
        n += p.n;
        for (const [t, g, sk, lv] of [[x, p.goldX, p.skillsX, p.lvX], [y, p.goldY, p.skillsY, p.lvY]] as const) {
          const a = (stats[t] ??= { gold: 0, skills: 0, lv: 0, n: 0 });
          a.gold += g;
          a.skills += sk;
          a.lv += lv;
          a.n += p.n / 2;
        }
      }
      const r = s / n;
      out[day][`${x}>${y}`] = r;
      avg[pi] += r / DAYS.length;
      minDay[pi] = Math.min(minDay[pi], r);
      row.push(pct(r, 13));
    });
    console.log(String(day).padStart(3) + '   ' + row.join(''));
  }
  console.log('avg   ' + avg.map((r) => pct(r, 13)).join(''));
  console.log('\ntier     unspent gold  skills  levels   (average build at those days)');
  for (const t of BOT_TIERS) {
    const a = stats[t];
    console.log(`${t.padEnd(9)}${num(a.gold / a.n, 1, 12)}${num(a.skills / a.n, 1, 8)}${num(a.lv / a.n, 1, 8)}`);
  }
  pairs.slice(0, 2).forEach(([x, y], pi) =>
    target(`tiers: ${x} beats ${y} ≥ ${pct(TARGETS.tierMargin, 0)} avg, ≥ 50% every day`, avg[pi], avg[pi] >= TARGETS.tierMargin && minDay[pi] >= 0.5,
      `avg ${pct(avg[pi], 0)}, worst day ${pct(minDay[pi], 0)}`));
  report.tiers = { days: out, avg: Object.fromEntries(pairs.map(([x, y], i) => [`${x}>${y}`, avg[i]])), builds: stats };
}

// ---------------- compare ----------------
function flatten(o: unknown, path = '', out: Record<string, number> = {}) {
  if (typeof o === 'number') out[path] = o;
  else if (o && typeof o === 'object' && !Array.isArray(o)) for (const [k, v] of Object.entries(o)) flatten(v, path ? `${path}.${k}` : k, out);
  return out;
}
function compare(file: string) {
  const old = JSON.parse(readFileSync(file, 'utf8'));
  hr(`Compare with ${file}`);
  const a = flatten({ ...old, targets: undefined, meta: undefined });
  const b = flatten({ ...report, targets: undefined, meta: undefined });
  const isRate = (p: string) => !/(avgLen|p10|p90|ctlAvg|ctlMax|avgWins|avgDays|trigPerFight|chainMax|fights|gold|skills\.n|\.lv|\.n$)/.test(p) || /zeroSkill/.test(p);
  const om = old.meta ?? {};
  const diff = (['n', 'tier', 'seed', 'pool', 'simVersion'] as const).filter((k) => JSON.stringify(om[k]) !== JSON.stringify((report.meta as Record<string, unknown>)[k]));
  if (diff.length) console.log(`  note: run settings differ (${diff.map((k) => `${k} ${JSON.stringify(om[k])} → ${JSON.stringify((report.meta as Record<string, unknown>)[k])}`).join(', ')})`);
  let rows: [string, number, number][] = [];
  for (const p of Object.keys(b)) {
    if (!(p in a) || /(\.fights|\.n)$/.test(p)) continue; // sample sizes are not results
    if (/\.hero\./.test(p) && !FULL) continue; // full hero matrix only with --full
    const d = b[p] - a[p];
    const rate = isRate(p) && Math.abs(a[p]) <= 1.0001 && Math.abs(b[p]) <= 1.0001;
    if (rate ? Math.abs(d) >= 0.02 : Math.abs(d) >= Math.max(0.3, Math.abs(a[p]) * 0.05)) rows.push([p, a[p], b[p]]);
  }
  const fmt = (p: string, x: number) => (isRate(p) && Math.abs(x) <= 1.0001 ? (x * 100).toFixed(1) + '%' : x.toFixed(2));
  if (!rows.length) console.log('no notable changes (rates ±2 pts, other numbers ±5%)');
  const LIMIT = FULL ? Infinity : 50;
  const total = rows.length;
  if (total > LIMIT) {
    // keep the biggest changes (rates in points, others relative), then show them in report order
    const size = ([p, x, y]: [string, number, number]) => (isRate(p) && Math.abs(x) <= 1.0001 ? Math.abs(y - x) * 100 : (Math.abs(y - x) / Math.max(1, Math.abs(x))) * 20);
    const keep = new Set([...rows].sort((r1, r2) => size(r2) - size(r1)).slice(0, LIMIT).map((r) => r[0]));
    rows = rows.filter((r) => keep.has(r[0]));
  }
  for (const [p, x, y] of rows) {
    const d = isRate(p) && Math.abs(x) <= 1.0001 ? `${y - x >= 0 ? '+' : ''}${((y - x) * 100).toFixed(1)} pts` : `${y - x >= 0 ? '+' : ''}${(y - x).toFixed(2)}`;
    console.log(`  ${p.padEnd(42)} ${fmt(p, x).padStart(8)} → ${fmt(p, y).padStart(8)}   ${d}`);
  }
  if (total > LIMIT) console.log(`  … ${total - LIMIT} smaller changes not shown (use --full)`);
  const oldT: Record<string, boolean> = Object.fromEntries(((old.targets ?? []) as Target[]).map((t) => [t.name, t.ok]));
  const flips = targets.filter((t) => t.name in oldT && oldT[t.name] !== t.ok);
  for (const t of flips) console.log(`  target ${t.ok ? '✘ → ✔' : '✔ → ✘'} ${t.name} (${t.limit})`);
}

// ---------------- main ----------------
console.log(`Mochi Moon balance sim · mode ${MODE} · n ${N} · days ${DAYS.join(',')} · tier ${TIER} · seed ${SEED} · ${WORKERS} workers · sim v${SIM_VERSION}`);
if (MODE === 'matchups' || MODE === 'all') await matchups();
if (MODE === 'runs' || MODE === 'all') await runs();
if (MODE === 'skills' || MODE === 'all') await skills();
if (MODE === 'tiers' || MODE === 'all') await tiers();
if (MODE === 'lines' || MODE === 'all') await lines();
report.targets = targets;

hr('Targets');
for (const t of targets) console.log(`${ok(t.ok)} ${t.name.padEnd(52)} ${t.limit}`);
const missed = targets.filter((t) => !t.ok);
console.log(missed.length ? `\n✘ ${missed.length} of ${targets.length} targets missed` : `\n✔ all ${targets.length} targets met`);
if (COMPARE) compare(COMPARE);
if (JSON_OUT) {
  writeFileSync(JSON_OUT, JSON.stringify(report, null, 1));
  console.log(`\nwrote ${JSON_OUT}`);
}
console.log(`done in ${elapsed()}`);
process.exit(STRICT && missed.length ? 1 : 0);
