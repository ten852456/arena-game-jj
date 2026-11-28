// Farm rules (src/sim/farm.ts): production, caps, tickets, unlocks, eggs, monument maths. npm test runs it.
import * as F from '../src/sim/farm';

const H = 3_600_000;
let fails = 0;
const check = (name: string, ok: boolean, info = '') => {
  if (!ok) fails++;
  console.log(`${ok ? '✔' : '✘'} ${name} ${info}`);
};
const T0 = Date.parse('2026-12-01T08:00:00+07:00');
const ctx = (now: number, stardust = 0): F.OpCtx => ({ now, scale: 1, stardust, inRun: [], season: 's1' });
const op = (f: F.FarmState, o: F.FarmOp, now: number, stardust = 0) => F.applyOp(f, o, ctx(now, stardust));
/** an old farm (past the newbie boost and the day-1 hook) */
const veteran = () => {
  const f = F.newFarm(T0 - 30 * 24 * H);
  f.firstShift = true;
  return f;
};

// starters, rotation
{
  const f = F.newFarm(T0);
  check('new player owns the 4 starters', f.owned.join() === F.STARTERS.join());
  const rot = F.todaysRotation(f, T0);
  check('rotation: 2 heroes, none of them owned', rot.length === 2 && rot.every((h) => !f.owned.includes(h)), rot.join());
  // biome-ignore lint/suspicious/noSelfCompare: two calls must give the same rotation (determinism)
  check('rotation is the same for the same day', F.rotationOf('2026-12-01').join() === F.rotationOf('2026-12-01').join());
  check('grandfathered player owns all 10', F.newFarm(T0, true).owned.length === 10);
}

// production: 12 h storage, partial collects keep part-units, affinity +25%
{
  const f = veteran();
  check('send knight to the mine', typeof op(f, { op: 'send', b: 'mine', hero: 'knight' }, T0) !== 'string');
  F.collect(f, 'mine', T0 + 1.5 * H);
  check('mine 1.5 h: knight (shield, fits the mine) makes 4 × 1.25 × 1.5 = 7 ore', f.res.ore === 7, `ore ${f.res.ore}`);
  F.collect(f, 'mine', T0 + 3 * H);
  check('the part-unit carries over: 3 h total = 15 ore', f.res.ore === 15, `ore ${f.res.ore}`);
  const rate = F.rateOf(f, 'mine', 'knight', T0 + 40 * H); // includes the mastery the knight earned so far
  F.collect(f, 'mine', T0 + 40 * H);
  check('storage stops at 12 h of output', f.res.ore === 15 + Math.floor(12 * rate + 1e-9), `ore ${f.res.ore}, rate ${rate.toFixed(2)}/h`);
  check('send the same hero twice → error', op(f, { op: 'send', b: 'lumber', hero: 'knight' }, T0) === 'hero already working');
  check('a second hero at Lv1 (1 slot) → no free slot', op(f, { op: 'send', b: 'mine', hero: 'pyro' }, T0) === 'no free slot');
  check('a hero in a run cannot work', F.applyOp(f, { op: 'send', b: 'lumber', hero: 'pyro' }, { ...ctx(T0), inRun: ['pyro'] }) === 'hero is in a run');
  check('a locked hero cannot work', op(f, { op: 'send', b: 'lumber', hero: 'sage' }, T0) !== null && typeof op(f, { op: 'send', b: 'lumber', hero: 'luckycat' }, T0) === 'string');
}

// day-1 hook: the first job ever fills its storage in 5 minutes; newbie boost ×2 fading
{
  const f = F.newFarm(T0);
  op(f, { op: 'send', b: 'lumber', hero: 'assassin' }, T0);
  F.collect(f, 'lumber', T0 + 5 * 60_000);
  // 12 h × 6/h × 1.25 (hit fits the lumber yard) × ~2 (newbie boost, a hair under 2 after 5 min) ≈ 180
  check('first shift: full storage after 5 min', f.res.wood >= 178 && f.res.wood <= 180, `wood ${f.res.wood}`);
  check('Lv2 lumber is affordable in the first session (needs 60 wood + 40 ore)', f.res.wood >= 60);
  check('newbie boost fades to 0 after 7 days', F.newbieBoost(f, T0 + 8 * 24 * H) === 0 && F.newbieBoost(f, T0) === 1);
}

// warehouse cap
{
  const f = veteran();
  f.res.wood = F.capOf(f, 'wood') - 3;
  op(f, { op: 'send', b: 'lumber', hero: 'duelist' }, T0);
  F.collect(f, 'lumber', T0 + 12 * H);
  check('warehouse cap holds', f.res.wood === F.capOf(f, 'wood'), `${f.res.wood}/${F.capOf(f, 'wood')}`);
}

// ranked tickets: 1 free a day banked up to 3, crafted tickets, refunds; casual is free
{
  const f = veteran();
  f.day = F.bkDay(T0);
  f.free = 1;
  check('1 free ranked ticket, then none', F.spendRun(f, T0) === null && F.spendRun(f, T0) !== null && f.free === 0);
  F.rollDay(f, T0 + 24 * H);
  check('next day: +1 free ranked ticket', f.free === 1);
  F.rollDay(f, T0 + 6 * 24 * H);
  check('missed days bank up to 3', f.free === F.FREE_BANK, `free ${f.free}`);
  f.res.wood = 1000;
  f.res.ore = 1000;
  check('craft 4 tickets', typeof op(f, { op: 'craft', n: 4 }, T0 + 6 * 24 * H) !== 'string' && f.tickets === 4);
  check('5th craft today → limit', op(f, { op: 'craft' }, T0 + 6 * 24 * H) === 'craft limit reached today');
  op(f, { op: 'craft', n: 4 }, T0 + 7 * 24 * H);
  check('ticket bag holds 8 at most', op(f, { op: 'craft' }, T0 + 8 * 24 * H) === 'ticket bag full' && f.tickets === 8);
  check('ticket cost paid', f.res.wood === 1000 - 8 * 30 && f.res.ore === 1000 - 8 * 20);
  const g = veteran();
  F.startCasual(g, T0);
  F.startCasual(g, T0);
  check('casual runs are free and counted', g.casualRuns === 2 && g.tickets === 0);
  check('casual stardust: half for the first 3 a day, then a quarter; ranked +20%', F.stardustMult('casual', 3) === 0.5 && F.stardustMult('casual', 4) === 0.25 && F.stardustMult('ranked', 1) === 1.2);
  const r7 = F.runEnded(g, 'ranked', 7, T0);
  check('ranked 7+ wins: ticket back, an egg at 3 wins', r7.ticket && r7.eggs === 1 && g.tickets === 1);
  check('ranked 6 wins: no ticket back', !F.runEnded(g, 'ranked', 6, T0).ticket);
  const c1 = F.runEnded(g, 'casual', 10, T0);
  const c2 = F.runEnded(g, 'casual', 10, T0);
  check('casual: the first 10-win run of the day earns a ticket and an egg, the second nothing', c1.ticket && c1.eggs === 1 && !c2.ticket && !c2.eggs);
  check('casual 9 wins: nothing', !F.runEnded(g, 'casual', 9, T0 + 24 * H).ticket);
}

// lucky finds: one roll per whole hero-hour, capped per day
{
  const f = veteran();
  const always = () => 0; // every roll hits
  const got = F.rollFinds(f, 'mine', 3.5, always);
  check('3.5 hours at the mine: 3 rolls, the half hour carries', f.findRolls === 3 && Math.abs((f.findCarry ?? 0) - 0.5) < 1e-9 && got.length === 6, got.join());
  F.rollFinds(f, 'shrine', 100, () => 0.999);
  check('daily roll cap', f.findRolls === F.FIND_ROLLS_PER_DAY);
  f.res.ore = 0;
  op(f, { op: 'pourFind', id: 'moon_pearl' }, T0);
  check('a find poured into the monument', f.poured === F.FIND_POINTS.moon_pearl && f.finds!.moon_pearl === 2);
  check('pourFind: a prototype key is not a find', op(f, { op: 'pourFind', id: '__proto__' }, T0) === 'bad op' && op(f, { op: 'pourFind', id: 'constructor' }, T0) === 'bad op');
}

// unlock and upgrade
{
  const f = veteran();
  f.res.crystal = 3;
  check('unlock without stardust → error', op(f, { op: 'unlock', hero: 'sage' }, T0, 100) === 'not enough resources');
  const r = op(f, { op: 'unlock', hero: 'sage' }, T0, 300);
  check('unlock sage: 300 stardust + 3 crystal', typeof r !== 'string' && r.stardust === 300 && f.res.crystal === 0 && f.owned.includes('sage'));
  check('unlock twice → error', op(f, { op: 'unlock', hero: 'sage' }, T0, 999) === 'already owned');
  f.res.crystal = 30;
  check('v5.1: the next adoption costs 700', F.adoptCost(f).stardust === 700 && op(f, { op: 'unlock', hero: 'witch' }, T0, 699) === 'not enough resources');
  const r2 = op(f, { op: 'unlock', hero: 'witch' }, T0, 700);
  check('…and the one after 1,400 (rising 300 → 5,000)', typeof r2 !== 'string' && r2.stardust === 700 && F.adoptCost(f).stardust === 1400 && F.ADOPT_STARDUST.at(-1) === 5000);
  check('the 6th adoption and beyond cost 5,000', F.adoptCost({ owned: [...F.STARTERS, 'a', 'b', 'c', 'd', 'e', 'f'] }).stardust === 5000);
  f.res.crystal = 0;
  f.res.wood = 60;
  f.res.ore = 40;
  check('upgrade lumber to Lv2', typeof op(f, { op: 'upgrade', b: 'lumber' }, T0) !== 'string' && f.lv.lumber === 2 && F.slotsOf(f, 'lumber') === 2);
  f.pass = true;
  check('v5.1: the pass adds no work slot', F.slotsOf(f, 'lumber') === 2);
  check('v5.1: the pass does not hatch eggs faster', F.EGG_PASS_SPEED === 1);
  const extra = veteran();
  extra.lv.lumber = 2;
  for (const hero of ['knight', 'assassin', 'pyro']) extra.jobs.lumber.push({ hero, since: T0 }); // a 3rd worker from the old pass slot
  const got = F.collect(extra, 'lumber', T0 + 2 * H);
  check('v5.1: an old pass-slot worker is paid, then goes home', got > 0 && extra.jobs.lumber.length === 2 && !extra.jobs.lumber.some((j) => j.hero === 'pyro'), `jobs ${extra.jobs.lumber.length}`);
}

// incremental layer: endless levels past Lv5, worker mastery
{
  const f = veteran();
  f.lv.lumber = 5;
  f.res.wood = 1e6;
  f.res.ore = 1e6;
  f.res.crystal = 100;
  check('Lv5 → Lv6 costs 400 wood + 267 ore', JSON.stringify(F.upgradeCost(5)) === JSON.stringify({ wood: 400, ore: 267 }));
  for (let i = 0; i < 20; i++) op(f, { op: 'upgrade', b: 'lumber' }, T0);
  check('levels never end: Lv25 reached', f.lv.lumber === 25, `lv ${f.lv.lumber}`);
  check('Lv15 = ×(1 + 0.15·10)·2 = ×5 output; Lv25 = ×4·4 = ×16', F.levelMult(15) === 5 && F.levelMult(25) === 16);
  check('slots and storage stay at the Lv5 values', F.slotsOf(f, 'lumber') === F.SLOTS[4] && F.storageMs(f, 'lumber') === F.STORAGE_H[4] * H);
  check('the warehouse grows with the level', F.capOf(f, 'wood') > 16 * 6 * 4 * 72);
  const s5 = veteran();
  s5.lv.shrine = 5;
  s5.res.wood = 1e6;
  s5.res.ore = 1e6;
  s5.res.crystal = 100;
  check('v5.1: the shrine stops at Lv5', op(s5, { op: 'upgrade', b: 'shrine' }, T0) === 'max level' && s5.lv.shrine === 5);
  s5.lv.shrine = 30; // an old save past Lv5 makes crystal at the base rate
  check('v5.1: shrine crystal has no level multiplier', F.rateOf(s5, 'shrine', 'knight', T0 + 30 * 24 * H) === F.rateOf({ ...s5, lv: { ...s5.lv, shrine: 1 } }, 'shrine', 'knight', T0 + 30 * 24 * H));
  check('mastery curve: Lv50 = 10,133 XP, Lv99 = 1,303,443 XP', F.XP_TABLE[50] === 10133 && F.XP_TABLE[99] === 1303443);
  const g = veteran();
  op(g, { op: 'send', b: 'mine', hero: 'knight' }, T0);
  F.collect(g, 'mine', T0 + 12 * H);
  const ml = F.masteryOf(g, 'knight', 'mine');
  check('12 work-hours = 1,200 mastery XP: early levels come fast (28)', Math.round(g.mastery![F.masteryKey('knight', 'mine')]) === 1200 && ml === 28, `lv ${ml}`);
  check('mastery raises output +1% per level above 1', Math.abs(F.rateOf(g, 'mine', 'knight', T0 + 40 * 24 * H) / (4 * 1.25) - (1 + 0.01 * (ml - 1))) < 1e-9);
}

// season rollover: the town stays, the hoard and tickets do not
{
  const f = veteran();
  F.seasonRollover(f, 's1', null, T0, () => 'mine');
  check('a farm first seen in s1: no rollover', !f.rollover && f.season === 's1');
  f.lv.mine = 7; // before the cap: the warehouse grows with the next level's cost
  f.res.wood = F.capOf(f, 'wood') + 500;
  f.tickets = 3;
  f.poured = 100;
  f.pouredSeason = 's1';
  const r = F.seasonRollover(f, 's2', false, T0, () => 'mine');
  check('rollover: wood over the cap pours (500 points)', !!r && r.excess === 500 && f.res.wood === F.capOf(f, 'wood'));
  check('rollover: tickets expire, buildings stay', f.tickets === 0 && r!.tickets === 3 && f.lv.mine === 7);
  check('rollover: pour + excess (600) became a head start', !!f.head && Math.abs(f.head.mult - F.headStartFor(600)) < 1e-9);
  check('rollover: 600 points ≥ the personal minimum, so no calamity', !f.damaged);
  check('rollover runs once per season', F.seasonRollover(f, 's2', false, T0, () => 'mine') === null);
  const g = veteran();
  g.season = 's1';
  F.seasonRollover(g, 's2', false, T0, () => 'shrine');
  check('a missed goal damages a non-contributor', g.damaged === 'shrine' && !g.head);
}

// eggs: hatch by work-hours, odds shown, no duplicates, pity
{
  const f = veteran();
  check('a 10-win run lays 2 eggs (3 and 10 win marks)', F.eggsFor(f, 10, T0) === 2 && f.eggs[0].need === 48);
  check('not ready → error', F.hatch(f, 0.5) === 'egg not ready');
  f.eggs[0].h = 48;
  const odds = F.eggOdds(f);
  check('odds add up to 1', Math.abs(odds.reduce((a, o) => a + o.p, 0) - 1) < 1e-9);
  const g = F.hatch(f, 0.99);
  check('hatch gives a cosmetic', typeof g !== 'string' && !!g.got && f.cosmetics.includes(g.got));
  const seen = new Set<string>();
  let rare = false;
  for (let i = 0; i < F.EGG_POOL.length + 2; i++) {
    f.eggs = [{ h: 999, need: 1, from: T0 }];
    const r = F.hatch(f, 0.99); // a roll that never picks a rare by chance
    if (typeof r !== 'string' && r.got) {
      if (seen.has(r.got)) check('no duplicates', false, r.got);
      seen.add(r.got);
      if (F.EGG_POOL.find((x) => x.id === r.got)?.rare) rare = true;
    }
  }
  check('no duplicates, the whole pool collected', f.cosmetics.length === F.EGG_POOL.length);
  check('pity gives a rare even with bad rolls', rare);
  // work-hours from collects hatch the egg
  const e = veteran();
  F.eggsFor(e, 3, T0);
  op(e, { op: 'send', b: 'lumber', hero: 'duelist' }, T0);
  op(e, { op: 'send', b: 'mine', hero: 'knight' }, T0);
  for (let h = 12; h <= 24; h += 12) for (const b of ['lumber', 'mine'] as const) F.collect(e, b, T0 + h * H);
  check('2 heroes × 24 h = 48 work-hours: the egg is ready', e.eggs[0].h >= 48, `h ${e.eggs[0].h}`);
}

// stamp card: total days, not consecutive
{
  const f = F.newFarm(T0);
  check('a new card starts with 2 stamps', f.stamps === 2);
  F.stamp(f, T0);
  F.stamp(f, T0 + H);
  check('one stamp a day', f.stamps === 3);
  F.stamp(f, T0 + 10 * 24 * H);
  check('a break does not reset the card', f.stamps === 4);
}

// monument maths
{
  check('head start: 0 points → 0', F.headStartFor(0) === 0);
  check('head start: √-scaled (¼ of the full points → half the boost)', Math.abs(F.headStartFor(F.HEADSTART_FULL_AT / 4) - F.HEADSTART_MAX / 2) < 1e-9);
  check('head start capped at +30%', F.headStartFor(1e9) === F.HEADSTART_MAX);
  const f = veteran();
  f.head = { mult: 0.3, from: T0 };
  check('head start fades to 0 after 14 days', F.headStart(f, T0 + 7 * 24 * H) === 0.15 && F.headStart(f, T0 + 15 * 24 * H) === 0);
  f.res.wood = 500;
  op(f, { op: 'pour', res: 'wood', n: 200 }, T0);
  check('pour: resources become points', f.poured === 200 && f.res.wood === 300);
  check('pour more than owned → error', op(f, { op: 'pour', res: 'wood', n: 999 }, T0) === 'not enough resources');
  f.damaged = 'mine';
  check('a damaged landmark makes half', F.rateOf(f, 'mine', 'duelist', T0 + 30 * 24 * H) === F.RATE.ore / 2);
  f.res.ore = 100;
  check('repair', typeof op(f, { op: 'repair' }, T0) !== 'string' && !f.damaged);
}

console.log(fails ? `\n${fails} farm check(s) failed` : '\nall farm checks passed');
if (fails) process.exit(1);
