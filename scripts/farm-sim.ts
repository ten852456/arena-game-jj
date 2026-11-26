// Six-week farm simulation (design meeting 2026-11-26: "model the loop before building it"). Three players visit
// the town on a schedule and play it greedily; prints per-week building levels, mint/burn and the hours a level
// takes. Usage: npm run farm-sim [-- days=42]
import * as F from '../src/sim/farm';
import { Rng } from '../src/sim/rng';

const H = 3_600_000;
const DAYS = Number(process.argv.find((a) => a.startsWith('days='))?.slice(5) ?? 42);
const T0 = Date.parse('2027-01-04T00:00:00+07:00');

interface Player { name: string; visits: number[]; pass: boolean; tickets: number }
const PLAYERS: Player[] = [
  { name: 'casual (08:00, 21:00)', visits: [8, 21], pass: false, tickets: 2 },
  { name: 'active (every 4 h, 08–24)', visits: [8, 12, 16, 20, 24], pass: false, tickets: 4 },
  { name: 'pass holder (08:00, 21:00)', visits: [8, 21], pass: true, tickets: 2 },
];

function simulate(p: Player) {
  const f = F.newFarm(T0);
  f.pass = p.pass;
  const rng = new Rng(7);
  const ctx = (now: number): F.OpCtx => ({ now, scale: 1, stardust: 0, inRun: [], season: 's1', rng: () => rng.next() });
  const mint = { wood: 0, ore: 0, crystal: 0 };
  const burn = { wood: 0, ore: 0, crystal: 0 };
  const weeks: string[] = [];
  const track = (before: F.FarmState['res'], kind: 'mint' | 'burn') => {
    for (const r of ['wood', 'ore', 'crystal'] as const) {
      const d = f.res[r] - before[r];
      if (kind === 'mint' && d > 0) mint[r] += d;
      if (kind === 'burn' && d < 0) burn[r] -= d;
    }
  };
  for (let day = 0; day < DAYS; day++) {
    for (const h of p.visits) {
      const now = T0 + day * 24 * H + h * H;
      let before = { ...f.res };
      F.applyOp(f, { op: 'collect' }, ctx(now));
      track(before, 'mint');
      // "Fill jobs", as the game's button does it
      for (const s of F.fillPlan(f, f.owned.filter((x) => !F.heroBusy(f, x)))) F.applyOp(f, { op: 'send', b: s.b, hero: s.hero }, ctx(now));
      before = { ...f.res };
      // tickets first (the arena is the point), then upgrade the cheapest landmark while affordable
      for (let i = f.crafted; i < p.tickets; i++) if (typeof F.applyOp(f, { op: 'craft', n: 1 }, ctx(now)) === 'string') break;
      f.tickets = 0; // spent in the arena
      for (let guard = 0; guard < 50; guard++) {
        const b = [...F.BUILDING_IDS].sort((x, y) => (F.upgradeCost(f.lv[x]).wood ?? 0) - (F.upgradeCost(f.lv[y]).wood ?? 0))[0];
        if (typeof F.applyOp(f, { op: 'upgrade', b }, ctx(now)) === 'string') break;
      }
      track(before, 'burn');
    }
    if ((day + 1) % 7 === 0) {
      const lv = F.BUILDING_IDS.map((b) => f.lv[b]);
      // hours of the lumber yard's current output to afford its next level
      const now = T0 + (day + 1) * 24 * H;
      const perH = f.jobs.lumber.reduce((a, j) => a + F.rateOf(f, 'lumber', j.hero, now), 0);
      const next = F.upgradeCost(f.lv.lumber).wood ?? 0;
      const ratio = mint.wood ? burn.wood / mint.wood : 0;
      weeks.push(`  week ${(day + 1) / 7}: levels lumber/mine/shrine ${lv.join('/')} · wood made ${Math.round(mint.wood)} burned ${Math.round(burn.wood)} (burn/mint ${ratio.toFixed(2)}) · next lumber level ≈ ${perH ? (next / perH).toFixed(1) : '–'} h · stock ${Math.round(f.res.wood)} wood`);
    }
  }
  return weeks;
}

console.log(`Farm simulation, ${DAYS} days, 4 starter heroes, greedy upgrades after tickets\n`);
for (const p of PLAYERS) {
  console.log(p.name);
  for (const w of simulate(p)) console.log(w);
  console.log('');
}
console.log('Targets (docs/FARM.md): a level past Lv5 ≈ 13–26 h of one landmark; burn/mint for wood 0.8–1.0.');
