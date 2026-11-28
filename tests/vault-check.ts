// Account store rules (src/shared/vault.ts, v5.1 build plan task 3). Part of npm test.
import * as V from '../src/shared/vault';
import type { Build } from '../src/sim/types';

let fails = 0;
const check = (name: string, ok: boolean, info = '') => {
  if (!ok) fails++;
  console.log(`${ok ? '✔' : '✘'} ${name} ${info}`);
};
const H = 3_600_000;
const T0 = Date.parse('2026-12-01T08:00:00+07:00'); // a Tuesday
const build = (hero: string): Build => ({ hero, skills: [] });
const run = (hero: string, line: V.RunEnd['line'], wins: number, id = hero + wins, mode: V.RunEnd['mode'] = 'casual'): V.RunEnd => ({ runId: id, hero, line, build: build(hero), wins, losses: 3, mode });

// clock
check('the test clock: scale 2 makes a 3.5-day week', V.weekOf(V.CLOCK_EPOCH + 3.5 * 24 * H, 2) === 1 && V.weekOf(V.CLOCK_EPOCH + 3.4 * 24 * H, 2) === 0);
check('a real week starts on a Bangkok Monday', V.weekOf(Date.parse('2026-12-07T00:00:00+07:00')) === 1 && V.weekOf(Date.parse('2026-12-06T23:59:00+07:00')) === 0);

// new store
{
  const v = V.newVault(T0);
  check('a new store: empty, equal play money, every line at rank 0', v.seals.length === 0 && v.testBalance === V.TEST_BALANCE && Object.values(v.lineRank).every((x) => x === 0));
}

// Seals
{
  const v = V.newVault(T0);
  const d = V.addSeal(v, { line: 'shield', grade: 'D', roll: 9, timing: 'early' }, T0);
  const c6 = V.addSeal(v, { line: 'burn', grade: 'C', roll: 6, timing: 'late' }, T0);
  const c7 = V.addSeal(v, { line: 'burn', grade: 'C', roll: 7, timing: 'late' }, T0);
  check('Seal uses: D 30, C 45', typeof d !== 'string' && d.uses === 30 && typeof c7 !== 'string' && c7.uses === 45);
  check('D is bound; C trades only at roll 7+', typeof d !== 'string' && !V.sealTradable(d) && typeof c6 !== 'string' && !V.sealTradable(c6) && typeof c7 !== 'string' && V.sealTradable(c7));
  check('a Seal adds 2 line rank', v.lineRank.shield === 2 && v.lineRank.burn === 4);
  check('bad Seals are refused', V.addSeal(v, { line: 'nope' as never, grade: 'D', roll: 5, timing: 'early' }, T0) === 'bad seal' && V.addSeal(v, { line: 'hit', grade: 'C', roll: 11, timing: 'early' }, T0) === 'bad seal');
  for (let i = v.seals.length; i < V.STASH_MAX; i++) V.addSeal(v, { line: 'hit', grade: 'D', roll: 5, timing: 'early' }, T0);
  check('the stash stops at 30', V.addSeal(v, { line: 'hit', grade: 'D', roll: 5, timing: 'early' }, T0) === 'stash full' && v.seals.length === V.STASH_MAX);
  const id = (c7 as V.Seal).id;
  check('equip needs an owned hero', V.applyVaultOp(v, { op: 'equip', id, hero: 'sage' }, ['knight'], T0) === 'hero not owned');
  check('equip a C7 Seal on Knight', V.applyVaultOp(v, { op: 'equip', id, hero: 'knight' }, ['knight'], T0) === null && (c7 as V.Seal).on === 'knight');
  check('…and it binds (no longer tradable)', !V.sealTradable(c7 as V.Seal));
  check('one Seal per hero', V.applyVaultOp(v, { op: 'equip', id: (c6 as V.Seal).id, hero: 'knight' }, ['knight'], T0) === 'slot taken');
  check('unequip frees the slot', V.applyVaultOp(v, { op: 'unequip', id }, ['knight'], T0) === null && V.applyVaultOp(v, { op: 'equip', id: (c6 as V.Seal).id, hero: 'knight' }, ['knight'], T0) === null);
  check('a worn-out Seal is gone', V.wear(v, id, 45, T0) === null && !v.seals.some((s) => s.id === id));
}

// Kit and supplies
{
  const v = V.newVault(T0);
  const t1 = V.addKit(v, { tier: 1 }, T0) as V.Kit;
  const t2 = V.addKit(v, { tier: 2 }, T0) as V.Kit;
  check('Kit: T1 bound, T2 tradable, 20 uses', !V.kitTradable(t1) && V.kitTradable(t2) && t2.uses === 20);
  check('T3 needs a line; T1/T2 take none', V.addKit(v, { tier: 3 }, T0) === 'bad kit' && V.addKit(v, { tier: 1, line: 'hit' }, T0) === 'bad kit' && typeof V.addKit(v, { tier: 3, line: 'ice' }, T0) !== 'string');
  V.applyVaultOp(v, { op: 'equip', id: t2.id, hero: 'pyro' }, ['pyro'], T0);
  check('worn T2 Kit cannot be traded', !V.kitTradable(t2));
  check('2 uses per climb', V.wear(v, t2.id, 2, T0) === null && t2.uses === 18);
  check('supplies: add, use, none left', V.addSupply(v, 'ration', 2, T0) === null && V.useSupply(v, 'ration', T0) === null && V.useSupply(v, 'ration', T0) === null && V.useSupply(v, 'ration', T0) === 'no supply');
  check('supplies cap at 20', V.addSupply(v, 'spareHeart', 21, T0) === 'supplies full');
}

// Moonstone
{
  const v = V.newVault(T0);
  check('weekly Moonstone: F20 + F25 = 2, then the cap', V.grantMoonstone(v, 1, 'weekly', true, T0) === 1 && V.grantMoonstone(v, 1, 'weekly', true, T0) === 1 && V.grantMoonstone(v, 1, 'weekly', true, T0) === 0);
  check('…tradable once the market is open', v.moonstone.tradable === 2 && v.moonstone.bound === 0);
  check('first clears are bound and outside the cap', V.grantMoonstone(v, 1, 'firstClear', true, T0) === 1 && v.moonstone.bound === 1);
  check('a new week counts again', V.grantMoonstone(v, 2, 'weekly', true, T0 + 7 * 24 * H) === 2);
  const w = V.newVault(T0);
  V.grantMoonstone(w, 2, 'weekly', false, T0);
  check('before the market every piece is bound', w.moonstone.bound === 2 && w.moonstone.tradable === 0);
  check('spending takes bound pieces first', V.spendMoonstone(v, 2, T0) === null && v.moonstone.bound === 0 && v.moonstone.tradable === 3);
  check('cannot spend more than held', V.spendMoonstone(v, 4, T0) === 'not enough moonstone');
  check('test clock: weekly cap resets after 3.5 days at scale 2', V.grantMoonstone(w, 1, 'weekly', false, T0 + 84 * H, 2) === 1);
}

// run end: line rank and the Hero Book
{
  const v = V.newVault(T0);
  const r1 = V.onRunEnd(v, run('knight', 'shield', 10), true, T0);
  check('a 10-win run: +3 line rank, first Save kept', r1.rank === 3 && r1.saved && v.saves.knight?.wins === 10);
  const r2 = V.onRunEnd(v, run('knight', 'shield', 4), true, T0);
  check('a later run waits as pending', !r2.saved && v.saves.knight.wins === 10 && v.pending.knight?.wins === 4);
  check('keep it: the Save is replaced', V.applyVaultOp(v, { op: 'keepSave', hero: 'knight' }, ['knight'], T0) === null && v.saves.knight.wins === 4 && !v.pending.knight);
  V.onRunEnd(v, run('sage', 'time', 6, 'sage-ranked', 'ranked'), false, T0);
  check('a Ranked run with a hero not owned stays pending', !v.saves.sage && v.pending.sage?.wins === 6 && v.pending.sage.mode === 'ranked');
  check('…and cannot be kept until the hero is adopted', V.applyVaultOp(v, { op: 'keepSave', hero: 'sage' }, ['knight'], T0) === 'hero not owned' && V.applyVaultOp(v, { op: 'keepSave', hero: 'sage' }, ['knight', 'sage'], T0) === null);
  for (let i = 0; i < 5; i++) V.onRunEnd(v, run('pyro', 'burn', 0, 'p' + i), true, T0);
  check('only the first 5 runs of a day count for line rank', v.lineRank.burn === 2, `burn ${v.lineRank.burn}`);
  V.onRunEnd(v, run('pyro', 'burn', 0, 'next'), true, T0 + 24 * H);
  check('…the next day counts again', v.lineRank.burn === 3);
  v.lineRank.ice = 29;
  check('C unlocks at line rank 30', !V.cUnlocked(v, 'ice') && (V.onRunEnd(v, run('witch', 'ice', 0), true, T0 + 24 * H), V.cUnlocked(v, 'ice')));
  check('the view lists the C lines and weekly Moonstone left', V.vaultView(v, T0).cLines.includes('ice') && V.vaultView(v, T0).moonstone.weekLeft === 2);
}

// Seal tray (task 4)
{
  const v = V.newVault(T0);
  const rnd: [number, number] = [0.65, 0.9]; // roll 7, late
  const r2 = V.onRunEnd(v, run('knight', 'shield', 2), true, T0, 1, rnd);
  check('2 wins: no Seal offer', !r2.offer && v.tray.length === 0);
  const r3 = V.onRunEnd(v, run('knight', 'shield', 3, 'k3'), true, T0, 1, rnd);
  check('3 wins: a D offer of the hero line (roll 7, late, 24 h)', r3.offer?.grade === 'D' && r3.offer.line === 'shield' && r3.offer.roll === 7 && r3.offer.timing === 'late' && r3.offer.exp === T0 + 24 * H);
  const r5 = V.onRunEnd(v, run('pyro', 'burn', 6, 'p6'), true, T0, 1, [0, 0.1]);
  check('5+ wins before line rank 30: still D (roll 1, early)', r5.offer?.grade === 'D' && r5.offer.roll === 1 && r5.offer.timing === 'early');
  v.lineRank.ice = V.LINE_RANK_C - 1;
  const rc = V.onRunEnd(v, run('witch', 'ice', 5, 'w5'), true, T0, 1, [0.999, 0.5]);
  check('5 wins once this run brings the line to rank 30: C (roll 10)', rc.offer?.grade === 'C' && rc.offer.roll === 10);
  check('a tutorial win does not count for the Seal', !V.onRunEnd(v, run('duelist', 'dodge', 3, 'tut'), true, T0, 1, rnd, 2).offer);
  const r4 = V.onRunEnd(v, run('duelist', 'dodge', 4, 'd4'), true, T0, 1, rnd);
  check('a full tray (3) drops its oldest offer', v.tray.length === 3 && !v.tray.some((o) => o.id === r3.offer!.id) && v.tray.at(-1)!.id === r4.offer!.id);
  check('the view shows the tray with prices and 5 free D Seals', V.vaultView(v, T0).tray.length === 3 && V.vaultView(v, T0).claim.left && V.vaultView(v, T0).claim.freeD === 5);
  const c = V.claimSeal(v, rc.offer!.id, { stardust: 149, crystal: 1 }, T0);
  check('a C claim costs 150 stardust + 1 crystal', c === 'not enough stardust' && V.claimSeal(v, rc.offer!.id, { stardust: 150, crystal: 0 }, T0) === 'not enough crystal');
  const ok = V.claimSeal(v, rc.offer!.id, { stardust: 150, crystal: 1 }, T0);
  check('…claimed: the Seal is in the stash, the offer left the tray', typeof ok !== 'string' && ok.cost.stardust === 150 && ok.seal.grade === 'C' && ok.seal.roll === 10 && !v.tray.some((o) => o.id === rc.offer!.id));
  check('1 claim a day', V.claimSeal(v, r4.offer!.id, { stardust: 999, crystal: 9 }, T0) === 'claimed today' && !V.vaultView(v, T0).claim.left);
  const d = V.claimSeal(v, r4.offer!.id, { stardust: 0, crystal: 0 }, T0 + 20 * H); // past midnight, inside the offer's 24 h
  check('the next day (00:00 Bangkok): the first D Seals are free', typeof d !== 'string' && d.cost.stardust === 0 && v.freeD === 1);
  check('an offer past 24 h is gone', V.claimSeal(v, r5.offer!.id, { stardust: 999, crystal: 9 }, T0 + 48 * H + 1) === 'no such offer' && V.vaultView(v, T0 + 48 * H + 1).tray.length === 0);
  const w = V.newVault(T0);
  w.freeD = V.FREE_D_SEALS;
  const o = V.onRunEnd(w, run('knight', 'shield', 3, 'x'), true, T0, 2, rnd).offer!;
  check('test clock: the tray lasts 12 h at scale 2; D costs 50 after the free ones', o.exp === T0 + 12 * H && V.vaultView(w, T0, 2).tray[0].cost.stardust === 50);
  check('no rnd (old callers): no offer', !V.onRunEnd(V.newVault(T0), run('knight', 'shield', 9), true, T0).offer);
}

// test balance and old saves
{
  const v = V.newVault(T0);
  check('play money moves, never below 0', V.moveTestBalance(v, -600, T0) === null && V.moveTestBalance(v, -600, T0) === 'not enough balance' && v.testBalance === 400);
  const old = V.loadVault({ v: 0, seals: [{ id: 's1' }], lineRank: { hit: 7 } }, T0);
  check('an older store loads with defaults filled', old.v === V.VAULT_V && old.lineRank.hit === 7 && old.lineRank.time === 0 && old.supplies.ration === 0 && old.seals.length === 1);
  check('a broken store loads empty', V.loadVault('junk', T0).seals.length === 0);
  check('bad ops are refused', V.applyVaultOp(v, { op: 'nope' } as never, [], T0) === 'bad op' && V.applyVaultOp(v, null as never, [], T0) === 'bad op');
}

if (fails) {
  console.error(`vault check: ${fails} failed`);
  process.exit(1);
}
console.log('all vault checks passed');
