// Farm API abuse and flow checks, against a live server started with a fast clock and the gate on:
//   FARM_TIME_SCALE=3600 DATA_DIR=<fresh dir> npm start   then   npm run farm-api   (BASE=http://host:port)
//   (ADMIN_TOKEN set on both: also checks the v5.1 vault admin grant)
// (3600: one game hour per real second, so a 12 h storage fills in 12 s.)
import { aiBuild } from '../src/sim/bot';
import { offerFor } from '../src/sim/run';

const BASE = process.env.BASE ?? 'http://localhost:8787';
const post = async (u: string, b: unknown) => {
  const r = await fetch(BASE + u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
  return [r.status, await r.json()] as const;
};
const get = async (u: string) => {
  const r = await fetch(BASE + u);
  return [r.status, await r.json()] as const;
};
let fails = 0;
const check = (name: string, ok: boolean, info = '') => {
  if (!ok) fails++;
  console.log(`${ok ? '✔' : '✘'} ${name} ${info}`);
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const P = 'farm-' + Date.now();
/** v5.1: the Ranked offer the server issued this player (3 of all heroes) */
const offer = async (pid: string) => (await post('/api/ranked/offer', { playerId: pid }))[1] as { seed: number; heroes: string[] };
/** a seed whose Ranked offer has, or (`not`) does not have, this hero: one a client could pick for itself */
const seedFor = (hero: string, not = false) => {
  for (let s = 1; ; s++) if (offerFor('ranked', s).includes(hero) !== not) return s;
};
const fight = (pid: string, runId: string, hero: string, mode?: 'ranked', seed = 1) =>
  post('/api/fight', { runId, playerId: pid, day: 1, rating: 1000, build: aiBuild(hero, 1, [], 7), seed, ...(mode ? { mode } : {}) });
/** day 1 of a Ranked run with the server's offer: its first hero unless one is named */
const rankedFight = async (pid: string, runId: string, pick?: (heroes: string[]) => string | undefined) => {
  const o = await offer(pid);
  const hero = pick?.(o.heroes) ?? o.heroes[0];
  return [...(await fight(pid, runId, hero, 'ranked', o.seed)), hero, o] as const;
};

const [, g0] = await get('/api/farm?playerId=' + P);
check('GET an unknown player: a fresh farm, nothing stored', g0.stored === false && g0.owned.length === 4 && g0.runsLeft === 1, JSON.stringify({ owned: g0.owned, runsLeft: g0.runsLeft }));
if (g0.scale < 600 || !g0.runLimit) {
  console.log(`\nstart the server with FARM_TIME_SCALE=3600 and the gate on (scale ${g0.scale}, gate ${g0.runLimit})`);
  process.exit(1);
}

// batch: all-or-nothing
{
  const [s, j] = await post('/api/farm', { playerId: P, ops: [{ op: 'send', b: 'lumber', hero: 'duelist' }, { op: 'send', b: 'lumber', hero: 'nobody' }] });
  const [, g] = await get('/api/farm?playerId=' + P);
  check('a batch with one bad op changes nothing', s === 409 && j.at === 1 && g.jobs.lumber.length === 0, JSON.stringify(j));
}
check('more than 32 ops → 400', (await post('/api/farm', { playerId: P, ops: Array(33).fill({ op: 'collect' }) }))[0] === 400);
check('ops must be a list → 400', (await post('/api/farm', { playerId: P, ops: { op: 'collect' } }))[0] === 400);
check('a locked hero cannot work', (await post('/api/farm', { playerId: P, ops: [{ op: 'send', b: 'lumber', hero: 'sage' }] }))[0] === 409);
check('unlock with no stardust → 409', (await post('/api/farm', { playerId: P, ops: [{ op: 'unlock', hero: 'sage' }] }))[0] === 409);
check('prototype keys are not buildings', (await post('/api/farm', { playerId: P, ops: [{ op: 'upgrade', b: '__proto__' }] }))[0] === 409);
check('pour a negative amount → 409', (await post('/api/farm', { playerId: P, ops: [{ op: 'pour', res: 'wood', n: -50 }] }))[0] === 409);

// work: send, the first shift fills in 5 game-minutes, collect
{
  const [s] = await post('/api/farm', { playerId: P, ops: [{ op: 'send', b: 'lumber', hero: 'duelist' }, { op: 'send', b: 'mine', hero: 'knight' }] });
  check('send duelist to the lumber yard, knight to the mine', s === 200);
  await wait(1500);
  const [, c] = await post('/api/farm', { playerId: P, ops: [{ op: 'collect' }] });
  check('first shift + 1.5 game hours: wood and ore come in', c.res.wood > 100 && c.res.ore > 0, `wood ${c.res.wood} ore ${c.res.ore}`);
  const before = c.res.wood;
  const [, c2] = await post('/api/farm', { playerId: P, ops: [{ op: 'collect' }, { op: 'collect' }] });
  check('a double collect adds no more than the time passed', c2.res.wood - before <= 2, `+${c2.res.wood - before}`);
  await wait(3000); // 3 more game hours at the mine: enough ore for a ticket
  await post('/api/farm', { playerId: P, ops: [{ op: 'collect' }] });
}

// arena gate
{
  check('a locked hero cannot start a casual run', (await fight(P, P + '-locked', 'sage'))[1]?.code === 'hero_locked');
  const o1 = await offer(P);
  const o2 = await offer(P);
  check('v5.1: the server issues one Ranked offer per player (asking again cannot re-roll)', o1.seed === o2.seed && o1.heroes.length === 3 && JSON.stringify(o1.heroes) === JSON.stringify(offerFor('ranked', o1.seed)));
  const out = ['knight', 'pyro', 'duelist', 'assassin'].find((h) => !o1.heroes.includes(h))!;
  const [sn, jn] = await fight(P, P + '-notoffered', out, 'ranked', o1.seed);
  check('v5.1: ranked rejects a hero the issued offer does not have', sn === 400 && jn.code === 'not_offered', JSON.stringify(jn));
  const [sc0, jc0] = await fight(P, P + '-ownseed', 'knight', 'ranked', seedFor('knight'));
  check('v5.1: ranked rejects a seed the client picked for itself', sc0 === 400 && jc0.code === 'not_offered', JSON.stringify(jc0));
  const [snull, jnull] = await post('/api/fight', { runId: P + '-noseed', playerId: P, day: 1, rating: 1000, build: aiBuild('knight', 1, [], 7), mode: 'ranked' });
  check('v5.1: ranked without a seed → 400', snull === 400 && jnull.code === 'not_offered', JSON.stringify(jnull));
  check('…and a refused start keeps the offer', (await offer(P)).seed === o1.seed);
  const [s1] = await fight(P, P + '-r1', 'knight');
  const [, g] = await get('/api/farm?playerId=' + P);
  check('starting a run calls the working hero back', s1 === 200 && g.jobs.mine.length === 0 && g.inRun.includes('knight'));
  check('a hero in a run cannot go to work', (await post('/api/farm', { playerId: P, ops: [{ op: 'send', b: 'mine', hero: 'knight' }] }))[0] === 409);
  const [s2, j2] = await fight(P, P + '-r2', 'pyro');
  const [s3] = await fight(P, P + '-r3', 'assassin');
  check('casual runs are free (no ticket needed)', s2 === 200 && s3 === 200 && j2.mode === 'casual');
  const [s4, j4, h1, ok1] = await rankedFight(P, P + '-k1');
  check('ranked uses the free daily ticket', s4 === 200 && j4.mode === 'ranked', JSON.stringify(j4.error ?? j4.mode));
  const ok2 = await offer(P);
  check('v5.1: a started Ranked run uses up its offer (the next run gets a new one)', ok2.seed !== ok1.seed);
  const [s5, j5] = await rankedFight(P, P + '-k2');
  check('…then ranked needs a ticket', s5 === 409 && j5.code === 'no_tickets', JSON.stringify(j5));
  check('…and the refused start keeps the offer', (await offer(P)).seed === ok2.seed);
  const [sc, jc] = await post('/api/farm', { playerId: P, ops: [{ op: 'collect' }, { op: 'craft', n: 1 }] });
  check('craft a ticket (30 wood + 20 ore)', sc === 200 && jc.tickets === 1, JSON.stringify(jc.error ?? jc.res));
  const [s6] = await rankedFight(P, P + '-k2');
  check('the ticket starts a ranked run', s6 === 200);
  const [, g6] = await get('/api/farm?playerId=' + P);
  check('the ticket was spent', g6.tickets === 0 && g6.runsLeft === 0);
  const [, j7] = await post('/api/fight', { runId: P + '-k1', playerId: P, day: 2, rating: 1000, build: aiBuild(h1, 2, [], 7), mode: 'ranked' });
  check('day 2 of a ranked run costs nothing more', j7?.code !== 'no_tickets');
  const [, feed] = await get('/api/feed');
  check('the town feed answers', Array.isArray(feed.rows));
}

// v5.1: Ranked offers 3 of all 10 heroes, owned or not
{
  const Q = P + '-q';
  const [, g0q] = await get('/api/farm?playerId=' + Q);
  const o = await offer(Q);
  const unowned = o.heroes.find((h) => !g0q.owned.includes(h));
  if (!unowned) console.log('(skipped: this offer has only owned heroes)');
  else {
    const [sq, jq] = await fight(Q, Q + '-r1', unowned, 'ranked', o.seed);
    const [, gq] = await get('/api/farm?playerId=' + Q);
    check('v5.1: a ranked run can start with an offered hero the player does not own', sq === 200 && jq.mode === 'ranked' && !gq.owned.includes(unowned), JSON.stringify(jq.error ?? jq.mode));
  }
}

// eggs and the monument
{
  check('hatch with no egg → 409', (await post('/api/farm/hatch', { playerId: P }))[0] === 409);
  const [, g] = await get('/api/farm?playerId=' + P);
  check('monument shows a goal and the ruler\'s 20% gift', g.monument.goal > 0 && g.monument.points >= Math.round(0.2 * g.monument.goal), JSON.stringify(g.monument));
  const [sp, jp] = await post('/api/farm', { playerId: P, ops: [{ op: 'pour', res: 'wood', n: 10 }] });
  check('pour 10 wood (below the personal minimum: not counted as a player, so fake ids cannot raise the goal)', sp === 200 && jp.monument.mine === 10 && jp.monument.players === 0);
}

// v5.1 account store (src/shared/vault.ts): created by a finished run, player ops only touch what the server made
{
  const W = P + '-vault';
  const [, g0] = await get('/api/vault?playerId=' + W);
  check('vault: an unknown player sees an empty store, nothing stored', g0.stored === false && g0.testBalance === 1000 && g0.seals.length === 0, JSON.stringify({ stored: g0.stored }));
  check('vault: ops before any run → 409', (await post('/api/vault', { playerId: W, ops: [{ op: 'keepSave', hero: 'knight' }] }))[0] === 409);
  const finishRun = async (runId: string) => {
    const [, jf] = await fight(W, runId, 'knight');
    return post('/api/run/finish', { runId, playerId: W, name: '', hero: 'knight', wins: jf.won ? 1 : 0, losses: jf.won ? 0 : 1, day: 1, build: aiBuild('knight', 1, [], 7) });
  };
  const [f1s, f1] = await finishRun(W + '-r1');
  check('vault: a finished run gives line rank and the first Save', f1s === 200 && f1.reward.lineRank >= 1 && f1.reward.saved === true, JSON.stringify(f1.reward ?? f1));
  const [, g1] = await get('/api/vault?playerId=' + W);
  check('vault: the Save is the run build, the shield line moved', g1.stored && g1.saves.knight?.runId === W + '-r1' && g1.lineRank.shield >= 1);
  await finishRun(W + '-r2');
  const [, g2] = await get('/api/vault?playerId=' + W);
  check('vault: the next run waits as pending', g2.pending.knight?.runId === W + '-r2' && g2.saves.knight.runId === W + '-r1');
  const [sk, jk] = await post('/api/vault', { playerId: W, ops: [{ op: 'keepSave', hero: 'knight' }] });
  check('vault: keep it → the Save is replaced', sk === 200 && jk.saves.knight.runId === W + '-r2' && !jk.pending.knight);
  check('vault: a client cannot grant itself items', (await post('/api/vault', { playerId: W, ops: [{ op: 'addSeal', line: 'burn' }] }))[0] === 409);
  check('vault: equipping an item that does not exist → 409', (await post('/api/vault', { playerId: W, ops: [{ op: 'equip', id: 's1', hero: 'knight' }] }))[0] === 409);
  check('vault: the admin grant needs the token', (await post('/api/admin/vault/grant', { playerId: W, grants: [{ kind: 'balance', cents: 100 }] }))[0] !== 200);
  const TOKEN = process.env.ADMIN_TOKEN;
  if (TOKEN) {
    const adm = async (b: unknown) => {
      const r = await fetch(BASE + '/api/admin/vault/grant', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + TOKEN }, body: JSON.stringify(b) });
      return [r.status, await r.json()] as const;
    };
    const [ga, ja] = await adm({ playerId: W, grants: [{ kind: 'seal', line: 'burn', grade: 'C', roll: 7, timing: 'late' }, { kind: 'kit', tier: 2 }, { kind: 'supply', id: 'ration', n: 2 }, { kind: 'moonstone', n: 3, source: 'weekly' }] });
    const seal = ja.vault?.seals?.[0];
    check('vault admin: grant a C7 Seal, T2 Kit, 2 Rations; weekly Moonstone stops at 2 (bound before the market)', ga === 200 && seal?.tradable === true && ja.vault.kit[0]?.tradable === true && ja.vault.supplies.ration === 2 && ja.vault.moonstone.bound === 2 && ja.vault.moonstone.weekLeft === 0, JSON.stringify(ja.error ?? ja.vault?.moonstone));
    const [se, je] = await post('/api/vault', { playerId: W, ops: [{ op: 'equip', id: seal?.id, hero: 'knight' }, { op: 'equip', id: ja.vault?.kit?.[0]?.id, hero: 'knight' }] });
    check('vault: equip the Seal and Kit on Knight; the Seal binds', se === 200 && je.seals[0].on === 'knight' && je.seals[0].tradable === false && je.kit[0].tradable === false, JSON.stringify(je.error));
    const [sb] = await post('/api/vault', { playerId: W, ops: [{ op: 'unequip', id: seal?.id }, { op: 'equip', id: seal?.id, hero: 'sage' }] });
    const [, g3] = await get('/api/vault?playerId=' + W);
    check('vault: a batch with a bad op changes nothing (sage not owned)', sb === 409 && g3.seals[0].on === 'knight');
    const [gb] = await adm({ playerId: W, grants: [{ kind: 'balance', cents: -5000 }] });
    check('vault admin: play money never goes below 0', gb === 409);
    // v5.1 task 4: the Seal tray (offers granted as if runs earned them)
    const [go, jo] = await adm({ playerId: W, grants: [{ kind: 'offer', hero: 'knight', grade: 'D', roll: 4, timing: 'early' }, { kind: 'offer', hero: 'witch', grade: 'C', roll: 8, timing: 'late' }] });
    const tray = jo.vault?.tray ?? [];
    check('tray: two offers wait, D free (first 5), C 150 stardust + 1 crystal', go === 200 && tray.length === 2 && tray[0].cost.stardust === 0 && tray[1].cost.stardust === 150 && tray[1].cost.crystal === 1 && jo.vault.claim.left, JSON.stringify(jo.error ?? tray.map((o: { cost: unknown }) => o.cost)));
    const [sc, jc] = await post('/api/vault', { playerId: W, ops: [{ op: 'claim', id: tray[1]?.id }] });
    check('tray: a C claim without the stardust → 409, nothing taken', sc === 409 && jc.error === 'not enough stardust', JSON.stringify(jc));
    const [sd, jd] = await post('/api/vault', { playerId: W, ops: [{ op: 'claim', id: tray[0]?.id }] });
    check('tray: claim the free D Seal → in the stash, out of the tray', sd === 200 && jd.seals.some((s: { line: string; grade: string; roll: number }) => s.line === 'shield' && s.grade === 'D' && s.roll === 4) && jd.tray.length === 1 && !jd.claim.left, JSON.stringify(jd.error));
    const [s2] = await post('/api/vault', { playerId: W, ops: [{ op: 'claim', id: tray[1]?.id }] });
    check('tray: 1 claim a day', s2 === 409);
    check('tray: a bad offer grant is refused', (await adm({ playerId: W, grants: [{ kind: 'offer', hero: 'nobody', grade: 'D', roll: 4, timing: 'early' }] }))[0] === 409);
  } else console.log('  (vault admin checks skipped: start the server and this check with the same ADMIN_TOKEN)');
}

// creating towns: limited per IP (the last check: it uses up this IP's allowance for an hour)
{
  let limited = false;
  for (let i = 0; i < 40 && !limited; i++) limited = (await post('/api/farm', { playerId: `${P}-new${i}`, ops: [{ op: 'collect' }] }))[0] === 429;
  check('random ids from one IP cannot create towns without limit', limited);
  const [sf, jf] = await fight(`${P}-newfight`, `${P}-newfight-r`, 'knight');
  check('…and a day-1 fight cannot create one either (same limit)', sf === 429, JSON.stringify(jf));
}

console.log(fails ? `\n${fails} farm API check(s) failed` : '\nall farm API checks passed');
if (fails) process.exit(1);
