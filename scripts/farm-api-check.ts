// Farm API abuse and flow checks, against a live server started with a fast clock and the gate on:
//   FARM_TIME_SCALE=3600 DATA_DIR=<fresh dir> npm start   then   npm run farm-api   (BASE=http://host:port)
// (3600: one game hour per real second, so a 12 h storage fills in 12 s.)
import { aiBuild } from '../src/sim/bot';

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
const fight = (pid: string, runId: string, hero: string) => post('/api/fight', { runId, playerId: pid, day: 1, rating: 1000, build: aiBuild(hero, 1, [], 7) });

const [, g0] = await get('/api/farm?playerId=' + P);
check('GET an unknown player: a fresh farm, nothing stored', g0.stored === false && g0.owned.length === 4 && g0.runsLeft === 3, JSON.stringify({ owned: g0.owned, runsLeft: g0.runsLeft }));
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
  check('a locked hero cannot start a run', (await fight(P, P + '-locked', 'sage'))[1]?.code === 'hero_locked');
  const [s1] = await fight(P, P + '-r1', 'knight');
  const [, g] = await get('/api/farm?playerId=' + P);
  check('starting a run calls the working hero back', s1 === 200 && g.jobs.mine.length === 0 && g.inRun.includes('knight'));
  check('a hero in a run cannot go to work', (await post('/api/farm', { playerId: P, ops: [{ op: 'send', b: 'mine', hero: 'knight' }] }))[0] === 409);
  await fight(P, P + '-r2', 'pyro');
  await fight(P, P + '-r3', 'assassin');
  const [s4, j4] = await fight(P, P + '-r4', 'assassin');
  check('3 free runs, the 4th needs a ticket', s4 === 409 && j4.code === 'no_runs', JSON.stringify(j4));
  const [sc, jc] = await post('/api/farm', { playerId: P, ops: [{ op: 'collect' }, { op: 'craft', n: 1 }] });
  check('craft a ticket (30 wood + 20 ore)', sc === 200 && jc.tickets === 1, JSON.stringify(jc.error ?? jc.res));
  const [s5] = await fight(P, P + '-r4', 'assassin');
  check('the ticket starts the 4th run', s5 === 200);
  const [, g5] = await get('/api/farm?playerId=' + P);
  check('the ticket was spent', g5.tickets === 0 && g5.runsLeft === 0);
  const [, j6] = await post('/api/fight', { runId: P + '-r1', playerId: P, day: 2, rating: 1000, build: aiBuild('knight', 2, [], 7) });
  check('day 2 of a run is never stopped by the run limit', j6?.code !== 'no_runs');
}

// eggs and the monument
{
  check('hatch with no egg → 409', (await post('/api/farm/hatch', { playerId: P }))[0] === 409);
  const [, g] = await get('/api/farm?playerId=' + P);
  check('monument shows a goal and the ruler\'s 20% gift', g.monument.goal > 0 && g.monument.points >= Math.round(0.2 * g.monument.goal), JSON.stringify(g.monument));
  const [sp, jp] = await post('/api/farm', { playerId: P, ops: [{ op: 'pour', res: 'wood', n: 10 }] });
  check('pour 10 wood', sp === 200 && jp.monument.mine === 10 && jp.monument.players >= 1);
}

// creating towns: limited per IP (the last check: it uses up this IP's allowance for an hour)
{
  let limited = false;
  for (let i = 0; i < 12 && !limited; i++) limited = (await post('/api/farm', { playerId: `${P}-new${i}`, ops: [{ op: 'collect' }] }))[0] === 429;
  check('random ids from one IP cannot create towns without limit', limited);
}

console.log(fails ? `\n${fails} farm API check(s) failed` : '\nall farm API checks passed');
if (fails) process.exit(1);
