// Abuse cases for the server (run against a live server): npm run security  (BASE=http://host:port)
import { aiBuild, botShopTurn } from '../src/sim/bot';
import { newRun, recordResult, toBuild, chooseLastChance, applyMark } from '../src/sim/run';
const BASE = process.env.BASE ?? 'http://localhost:8787';
const post = async (u: string, b: unknown) => { const r = await fetch(BASE + u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }); return [r.status, await r.json()] as const; };
const build = aiBuild('knight', 1, ['shield'], 7);
const check = (name: string, ok: boolean, info = '') => console.log(`${ok ? '✔' : '✘'} ${name} ${info}`);
// 1 no playerId
check('fight without playerId → 400', (await post('/api/fight', { runId: 'sec-a', day: 1, rating: 1000, build }))[0] === 400);
// 2 fake finish (no track)
const fake = await post('/api/run/finish', { runId: 'sec-fake-' + Date.now(), playerId: 'p1', name: '', hero: 'knight', wins: 0, losses: 1, day: 1, build });
check('finish of a run the server never saw → 404', fake[0] === 404, JSON.stringify(fake[1]));
// 3 rating lie: two fights, claim 5000 → server ignores
const [s1, f1] = await post('/api/fight', { runId: 'sec-r', playerId: 'p2', day: 1, rating: 5000, build });
check('client rating ignored (server rating ~1000±32)', s1 === 200 && Math.abs(f1.rating - 1000) <= 32, `got ${f1.rating}`);
// 4 lie on finish: claim more fights than played
const lie = await post('/api/run/finish', { runId: 'sec-r', playerId: 'p2', name: '', hero: 'knight', wins: 3, losses: 0, day: 3, build });
check('finish claiming fights not played → 409', lie[0] === 409, JSON.stringify(lie[1]));
// 5 other player finish → 403
const other = await post('/api/run/finish', { runId: 'sec-r', playerId: 'p3', name: '', hero: 'knight', wins: f1.won ? 1 : 0, losses: f1.won ? 0 : 1, day: 1, build });
check('finish by another player → 403', other[0] === 403);
// 6 honest full run → reward from server counts
const s = newRun('berserker', 999, 'sec-full-' + Date.now());
while (s.phase !== 'won' && s.phase !== 'dead') {
  if (s.phase === 'lastchance') { chooseLastChance(s, 'supply'); continue; }
  if (s.phase === 'mark') { applyMark(s, 0); continue; }
  botShopTurn(s, { prefer: [], reserve: 0, maxRerolls: 1 });
  const [st, f] = await post('/api/fight', { runId: s.id, playerId: 'p4', name: '', day: s.day, rating: s.rating, build: toBuild(s) });
  if (st !== 200) { console.log('fight failed', st, f); break; }
  s.rating = f.rating; recordResult(s, f.won, { opp: f.opponent.name, ai: f.opponent.ai, fightId: f.fightId });
}
const fin = await post('/api/run/finish', { runId: s.id, playerId: 'p4', name: '', hero: s.hero, wins: s.wins, losses: s.losses, day: s.day, build: toBuild(s) });
check('fighting after the run ended → 409', (await post('/api/fight', { runId: s.id, playerId: 'p4', name: '', day: s.day + 1, rating: 1000, build: toBuild(s) }))[0] === 409);
check('skipping ahead a day → 409', (await post('/api/fight', { runId: 'sec-skip-' + Date.now(), playerId: 'p5', day: 3, rating: 1000, build }))[0] === 409);
check('honest run gets its reward', fin[0] === 200 && fin[1].reward.stardust > 0, `w${s.wins} l${s.losses} → ${fin[1].reward?.stardust} ผงดาว`);
// 7 guided-tutorial fight: once per player, only on day 1 of a brand-new run, flag must be exactly true
{
  const pid = 'sec-tut-' + Date.now();
  const [t1, j1] = await post('/api/fight', { runId: pid + '-r1', playerId: pid, day: 1, rating: 1000, build, tutorial: true });
  check('tutorial fight: day 1 of a new run → training AI', t1 === 200 && j1.tutorial === true && j1.opponent.ai && j1.opponent.tier === 'easy', `won ${j1.won}`);
  const [t2, j2] = await post('/api/fight', { runId: pid + '-r2', playerId: pid, day: 1, rating: 1000, build, tutorial: true });
  check('tutorial fight: only once per player', t2 === 200 && !j2.tutorial);
  const [, j3] = await post('/api/fight', { runId: pid + '-r1', playerId: pid, day: 2, rating: 1000, build, tutorial: true });
  check('tutorial fight: not on day 2', !j3.tutorial);
  const [t4] = await post('/api/fight', { runId: pid + '-r1', playerId: pid, day: 1, rating: 1000, build, tutorial: true });
  check('tutorial fight: cannot re-fight day 1 → 409', t4 === 409);
  const [, j5] = await post('/api/fight', { runId: pid + '-r3', playerId: pid + 'x', day: 1, rating: 1000, build, tutorial: 'yes' });
  check('tutorial fight: flag must be exactly true', !j5.tutorial);
  // a tutorial win must not be farmable with fresh player ids: no rating gain, no stardust
  const fresh = 'sec-tf-' + Date.now();
  const [, jf] = await post('/api/fight', { runId: fresh + '-r', playerId: fresh, day: 1, rating: 1000, build, tutorial: true });
  check('tutorial fight: rating unchanged', jf.tutorial === true && jf.rating === 1000, `rating ${jf.rating}`);
  const [, fin] = await post('/api/run/finish', { runId: fresh + '-r', playerId: fresh, name: '', hero: 'knight', wins: jf.won ? 1 : 0, losses: jf.won ? 0 : 1, day: 1, build });
  check('tutorial fight: its win earns no stardust (same as a 0-win run: 5)', !jf.won || fin?.reward?.stardust === 5, `stardust ${fin?.reward?.stardust}`);
}
