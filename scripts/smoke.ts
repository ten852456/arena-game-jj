// End-to-end check against a running server (npm start / npm run dev:server):
// player A fights (vs AI), player B fights on the same day (should meet A's saved build),
// then the replay is re-simulated locally and must match the server's result exactly.
import { simulate } from '../src/sim/combat';
import type { Build } from '../src/sim/types';

const BASE = process.env.BASE ?? 'http://localhost:8787';
const post = async (body: unknown) => {
  const r = await fetch(BASE + '/api/fight', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, json: (await r.json()) as any };
};

const blk = (id: string) => ({ id, v: '' });
const buildA: Build = { hero: 'knight', skills: [{ ...blk('shield'), bonus: [{ t: 'strike', e: 'trigger' }] }, { ...blk('strike'), bonus: [{ t: 'arch:tank', e: 'dmg' }] }] };
const buildB: Build = { hero: 'witch', skills: [blk('frost'), blk('shatter')] };
const tag = Date.now().toString(36);

const a = await post({ runId: 'smoke-a-' + tag, playerId: 'smoke-pa-' + tag, name: 'SmokeA', day: 1, rating: 1000, build: buildA });
console.log('A vs', a.json.opponent?.name, '| won:', a.json.won, '| status', a.status, a.json.error ?? '');
const b = await post({ runId: 'smoke-b-' + tag, playerId: 'smoke-pb-' + tag, name: 'SmokeB', day: 1, rating: 1000, build: buildB });
console.log('B vs', b.json.opponent?.name, '| ai:', b.json.opponent?.ai, '| won:', b.json.won);

const rep = (await (await fetch(BASE + '/api/replay/' + b.json.fightId)).json()) as any;
const local = simulate(rep.a.build, rep.b.build, rep.seed, rep.day);
const same = JSON.stringify(local) === JSON.stringify(b.json.result);
console.log('replay', b.json.fightId, 're-simulated locally matches server:', same);

const bad = await post({ runId: 'x-' + tag, playerId: 'smoke-px-' + tag, day: 1, build: { hero: 'knight', skills: [blk('shatter')] } });
console.log('cheat build (witch skill on knight) rejected:', bad.status === 400, bad.json.error);
process.exitCode = same && bad.status === 400 ? 0 : 1;
