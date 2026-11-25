// The UI's chain client (src/client/chain.ts + runChain.ts, the code the browser runs) against a LOCAL validator:
// burner wallet, `?chain=1&net=local`. Browser APIs are stubbed (location, localStorage, fetch of /chain-local.json).
// Needs: validator with mochi-game (--features local), `node onchain/scripts/chain-setup.mjs`, and the responder
// `node onchain/scripts/local-vrf.mjs` (started here as a child process).
// Checks, like the UI does it: connect (account + secret account + seat) → run start waits for the VRF → hero pick →
// deterministic actions applied locally + queued (then the chain's state = the local one) → random actions (reroll,
// relic reroll, wish, last chance, mark) and fights through request + callback → the UI takes the chain's state →
// every fight replays to the chain's result with the TS sim → finish.
//   npx tsx onchain/engine/bench/client-e2e.mts
import fs from 'node:fs';
import { spawn } from 'node:child_process';

const store = new Map<string, string>();
const g = globalThis as Record<string, unknown>;
g.location = new URL('http://localhost/play/?chain=1&net=local&wallet=burner');
g.history = { replaceState() {} };
g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k), key: () => null, get length() { return store.size; } };
Object.defineProperty(g.localStorage, 'keys', { value: () => [...store.keys()] });
g.window = globalThis;
const realFetch = globalThis.fetch;
g.fetch = (u: string, o?: RequestInit) => (String(u).endsWith('/chain-local.json')
  ? Promise.resolve(new Response(fs.readFileSync(new URL('../../../src/client/public/chain-local.json', import.meta.url))))
  : realFetch(u, o));

const C = await import('../../../src/client/chain');
const R = await import('../../../src/client/runChain');
const { simulate } = await import('../../../src/sim/combat');
type RS = import('../../../src/sim/run').RunState;

const responder = spawn(process.execPath, [new URL('../../scripts/local-vrf.mjs', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')], { stdio: ['ignore', 'pipe', 'inherit'] });
let answered = 0;
responder.stdout.on('data', (b) => { answered += String(b).split('answered').length - 1; });

const checks: [string, boolean, string][] = [];
const check = (n: string, ok: boolean, d = '') => { checks.push([n, ok, d]); console.log(`${ok ? 'OK  ' : 'FAIL'} ${n}${d ? ' · ' + d : ''}`); };
const core = (s: RS) => JSON.stringify({ day: s.day, hp: s.hp, gold: s.gold, wins: s.wins, losses: s.losses, phase: s.phase, skills: s.skills, shop: s.shop, locks: (s.locks ?? []).slice(0, 5).map(Boolean), relics: s.relics ?? [], slots: s.bonusSlots });
let run: RS | null = null;
const adopt = (b: Uint8Array) => { run = Object.assign(C.runOf(b, 'ui'), { log: run?.log ?? [], rating: 1000 }); };

try {
  const st = await C.chainConnect();
  check('connect: account + secret account + pool seat (burner, local)', st.status === 0 || st.status === 1, `status ${st.status}`);
  const t0 = Date.now();
  const choices = await C.chainBeginRun();
  check('run start waits for the VRF answer; hero choices come from the chain', choices.length === 3, `${choices.join(', ')} in ${Date.now() - t0} ms`);
  adopt(await C.chainPickHero(0));
  check('hero pick: the run starts on chain with the first offered hero', run!.hero === choices[0] && run!.day === 1 && run!.phase === 'shop');
  let fights = 0, fightsOk = 0, rolls = 0, detSynced = 0, detChecks = 0;
  for (let step = 0; step < 60 && run && run.phase !== 'won' && run.phase !== 'dead'; step++) {
    const r = run as RS;
    if (r.phase === 'relic') {
      if (step % 3 === 0 && (r.relicRolls ?? 0) < 1) { adopt((await C.chainRoll(12)).run); rolls++; }
      else { R.pickRelic(r, 0); await C.chainFlush(); }
      continue;
    }
    if (r.phase === 'lastchance') { adopt((await C.chainRoll(7, step % 3)).run); rolls++; continue; }
    if (r.phase === 'mark') { adopt((await C.chainRoll(8, r.skills.length ? 0 : -1)).run); rolls++; continue; }
    // shop: deterministic actions locally (queued), then compare with the chain after a flush
    for (let i = 0; i < 5; i++) if (r.shop[i] && !R.buy(r, i)) break;
    if (r.skills.length > 1) R.moveSkill(r, 0, 1);
    if (r.shop.some(Boolean)) R.toggleLock(r, r.shop.findIndex(Boolean));
    if (C.chainQueued()) {
      await C.chainFlush();
      const chain = C.runOf((await C.chainState())!.run!, 'ui');
      detChecks++;
      if (core(chain) === core(r)) detSynced++;
    }
    if (r.day >= 2 && r.gold >= 1 && step % 2 === 0) { adopt((await C.chainRoll(3)).run); rolls++; }
    if (step % 5 === 4 && R.wishKind(run!) && run!.gold >= R.wishPrice(run!)) { adopt((await C.chainRoll(6)).run); rolls++; }
    // fight: replay with the TS sim from the build before the fight
    const build = R.toBuild(run!);
    const day = run!.day;
    const f = await C.chainFight();
    fights++;
    const result = simulate(build, f.opp, f.seed, day);
    if ((result.winner === 0) === f.won && f.day === day) fightsOk++;
    adopt(f.run);
  }
  check('deterministic actions (buy, move, lock, pick relic) applied locally = the chain after the flush', detChecks > 0 && detSynced === detChecks, `${detSynced}/${detChecks}`);
  check('every fight on chain replays to the same result with the TS sim (UI replay)', fights > 0 && fightsOk === fights, `${fightsOk}/${fights} fights`);
  check('random actions (reroll, relic reroll, wish, last chance, mark) went through request + callback', rolls > 0, `${rolls} rolls, ${answered} answers by the responder`);
  const end = await C.chainState();
  if (end?.status === 3) await C.chainFinish();
  const fin = await C.chainState();
  check('run ended on chain and was archived (finish_run)', !!fin && fin.status === 0, `phase ${run!.phase}, ${run!.wins} wins, day ${run!.day}`);
  const prof = await C.chainProfile();
  check('profile window data reads the v22 account', !!prof && prof.runsStarted >= 1, prof ? `runs ${prof.runsStarted}, best ${prof.bestScore}, status ${prof.status}` : 'none');
} catch (e) {
  check('client flow', false, String((e as Error).stack ?? e).slice(0, 400));
}
responder.kill();
const bad = checks.filter((x) => !x[1]).length;
console.log(`\n${checks.length - bad}/${checks.length} checks passed`);
process.exit(bad ? 1 : 0);
