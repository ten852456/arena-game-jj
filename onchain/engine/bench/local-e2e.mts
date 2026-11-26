// mochi-game v22, request + apply randomness: end to end + security tests on a LOCAL validator.
// Program built with feature "local": the admin answers VRF requests (local_vrf / local_apply) and VRF timeouts are
// 20 slots. What it proves (onchain/docs/RANDOMNESS.md):
//  E2E  real runs through the program; at run end the TS sim replays every run from the revealed secret + the public
//       randomness log and gets the exact program state; commitment, secret derivation and every fight seed check out
//  S1   simulating a request (fight, reroll, wish, …) commits nothing and shows nothing but "pending"
//  S2   previewing a fight: simulating the callback with a forged VRF signer works in simulation (the attack path is
//       real), but its outcome depends on the randomness, so guessed randomness says nothing about the real fight
//  S3   a second request / any action while one is pending is refused (no rerolling by re-requesting)
//  S4   replaying an old request's callback (applied before) is refused
//  S5   a duplicate callback of the pending request applies once; the second is refused, the state unchanged
//  S6   timeout: retry before the timeout is refused; after it, the SAME action is re-requested (no change, no cancel)
//  S7   access: a stranger can't request on another account; a session key can play, not after revoke; a player can't
//       answer randomness (local_apply) and can't sign as the VRF identity (apply_random)
//  S8   deterministic actions stay one transaction; random ones are refused on `act` / `act_batch`
//   npx tsx onchain/engine/bench/local-e2e.mts [rpc=http://127.0.0.1:18899]
import crypto from 'node:crypto';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, ComputeBudgetProgram, SYSVAR_SLOT_HASHES_PUBKEY } from '@solana/web3.js';
import { simulate } from '../../../src/sim/combat';
import { HEROES } from '../../../src/sim/heroes';
import { SKILL_LIST, VARIANTS, nextVariants } from '../../../src/sim/skills';
import { LINES, type Build } from '../../../src/sim/types';
import { BONUS_KINDS } from '../../../src/sim/links';
import { RELICS } from '../../../src/sim/relics';
import {
  MARKS, applyMark, buy, buySlot, chooseLastChance, concede, heroChoices, moveSkill, newRun, pickRelic, recordResult,
  reroll, rerollRelic, sell, toBuild, toggleLock, wish, type RunState,
} from '../../../src/sim/run';
import { encodeState } from '../diff/run-gen.mts';

const rpc = process.argv[2] ?? 'http://127.0.0.1:18899';
const c = new Connection(rpc, 'confirmed');
const PROGRAM = new PublicKey('7yVgjzySuXwBeRJ18ZhunetqBz8ZTBNGiQVkw1or7w2r');
const VRF = new PublicKey('Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz');
const QUEUE = new PublicKey('5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc');
const VRF_ID = PublicKey.findProgramAddressSync([Buffer.from('identity'), PROGRAM.toBuffer()], VRF)[0];
const sha = (...xs: (Buffer | Uint8Array | string)[]) => crypto.createHash('sha256').update(Buffer.concat(xs.map((x) => (typeof x === 'string' ? Buffer.from(x) : Buffer.from(x))))).digest();
const disc = (n: string) => sha(`global:${n}`).subarray(0, 8);
const u8 = (n: number) => Buffer.from([n & 255]);
const i8 = (n: number) => { const b = Buffer.alloc(1); b.writeInt8(n); return b; };
const u16 = (n: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
const i64 = (n: number) => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return b; };
const pda = (...s: Buffer[]) => PublicKey.findProgramAddressSync(s, PROGRAM)[0];
type Meta = { pubkey: PublicKey; isSigner: boolean; isWritable: boolean };
const W = (pubkey: PublicKey, isSigner = false): Meta => ({ pubkey, isSigner, isWritable: true });
const R = (pubkey: PublicKey, isSigner = false): Meta => ({ pubkey, isSigner, isWritable: false });
const sys = R(SystemProgram.programId);
const checks: [string, boolean, string][] = [];
const check = (name: string, ok: boolean, detail = '') => { checks.push([name, ok, detail]); console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' · ' + detail : ''}`); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const mkIx = (name: string, data: Buffer[], keys: Meta[]) => new TransactionInstruction({ programId: PROGRAM, keys, data: Buffer.concat([disc(name), ...data]) });
async function txOf(payer: PublicKey, ixs: TransactionInstruction[]) {
  const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), ...ixs);
  tx.feePayer = payer;
  tx.recentBlockhash = (await c.getLatestBlockhash()).blockhash;
  return tx;
}
async function send(signers: Keypair[], name: string, data: Buffer[], keys: Meta[]) {
  const tx = await txOf(signers[0].publicKey, [mkIx(name, data, keys)]);
  tx.sign(...signers);
  const sig = await c.sendRawTransaction(tx.serialize(), { skipPreflight: true });
  const st = await c.confirmTransaction(sig, 'confirmed');
  const t = await c.getTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' });
  if (st.value.err) throw new Error(`${name}: ${JSON.stringify(st.value.err)} ${(t?.meta?.logMessages ?? []).filter((l) => /Error|error|failed/.test(l)).slice(-2).join(' | ')}`);
  return t?.meta?.computeUnitsConsumed ?? 0;
}
const fails = async (f: () => Promise<unknown>) => { try { await f(); return ''; } catch (e) { return String((e as Error).message); } };
const fund = async (k: Keypair) => c.confirmTransaction(await c.requestAirdrop(k.publicKey, 20e9), 'confirmed');

// ---------- Player layout (lib.rs Player; offsets after the 8-byte discriminator) ----------
const L = (() => {
  const f: [string, number][] = [['vrf_slot', 8], ['pend_slot', 8], ['seen', 8], ['best_slot', 8], ['session_expiry', 8], ['owner', 32], ['session_key', 32], ['secret_commit', 32], ['revealed_secret', 32], ['revealed_vrf', 32],
    ['magic', 4], ['season', 4], ['run_no', 4], ['resets', 4], ['best_score', 4], ['look_seed', 4], ['last_seed', 4], ['claim_reward', 4], ['revealed_run', 4], ['pend_req', 4], ['rand_n', 4],
    ['layout', 2], ['sim', 2], ['shard', 2], ['journal_len', 2], ['seat', 1], ['status', 1], ['fought', 1], ['last_day', 1], ['last_result', 1], ['last_kind', 1], ['claim_ready', 1], ['claim_rank', 1],
    ['pend_code', 1], ['pend_a', 1], ['pend_b', 1], ['pend_state', 1], ['choices', 4], ['run', 184], ['prev', 93], ['last_opp', 93], ['journal', 1323], ['claim_proof', 128], ['preview', 165], ['rand_log', 4096]];
  const o: Record<string, number> = {};
  let p = 8;
  for (const [n, s] of f) { o[n] = p; p += s; }
  return o;
})();
const ST = { IDLE: 0, PICK: 1, RUN: 2, ENDED: 3, WAIT_VRF: 5 };
const getP = async (k: PublicKey) => Buffer.from((await c.getAccountInfo(k))!.data);
const runBytes = (d: Buffer) => d.subarray(L.run, L.run + 184);
function encodeRust(b: Buffer) {
  const o = [b[10], b.readUInt32LE(0), b[11], b.readInt16LE(4), b[12], b[13], b.readUInt16LE(6), b.readInt8(14), b[15], b[16], b[17], b[18], b.readUInt16LE(8), b[19], b[20], b[21], b[22], b[23], b[24], b[25]];
  for (let i = 0; i < 5; i++) o.push(b[26 + i]);
  for (let i = 0; i < 3; i++) o.push(b[31 + i]);
  for (let i = 0; i < 3; i++) o.push(b[34 + i]);
  o.push(b[37], b[38]);
  for (let i = 0; i < 8; i++) { const p = 41 + 11 * i; for (let k = 0; k < 11; k++) o.push(i < b[25] ? b[p + k] : 0); }
  for (let i = 0; i < 5; i++) { const p = 129 + 11 * i; for (let k = 0; k < 11; k++) o.push(b[p] ? b[p + k] : 0); }
  return o;
}
function buildOf(b: Buffer): Build {
  const relics = [b[2], b[3], b[4]].filter((r) => r !== 255).map((r) => RELICS[r].id);
  const skills = [];
  for (let i = 0; i < b[1]; i++) {
    const p = 5 + 11 * i;
    const bonus = [];
    for (let j = 0; j < b[p + 4]; j++) {
      const t = b[p + 5 + 2 * j];
      bonus.push({ t: t >= 200 ? 'line:' + LINES[t - 200] : SKILL_LIST[t].id, e: BONUS_KINDS[b[p + 6 + 2 * j]] });
    }
    skills.push({ id: SKILL_LIST[b[p]].id, v: VARIANTS[b[p + 1]], ...(b[p + 2] ? { mark: MARKS[b[p + 2] - 1] } : {}), ...(b[p + 3] ? { star: b[p + 3] } : {}), bonus });
  }
  return { hero: HEROES[b[0]].id, skills, ...(relics.length ? { relics } : {}) };
}

// ---------- season ----------
const admin = Keypair.generate();
await fund(admin);
const SEASON = (Math.random() * 4e9) >>> 0, SHARD = 0;
const seasonSecret = crypto.randomBytes(32);
const seasonPda = pda(Buffer.from('season'), u32(SEASON)), ssPda = pda(Buffer.from('season_secret'), u32(SEASON));
const rankPda = pda(Buffer.from('ranking'), u32(SEASON)), poolPda = pda(Buffer.from('pool'), u32(SEASON), u16(SHARD));
const now = Math.floor(Date.now() / 1000);
await send([admin], 'init_season', [u32(SEASON), i64(now - 600), i64(now + 7 * 86400), sha(seasonSecret)], [W(admin.publicKey, true), W(seasonPda), sys]);
await send([admin], 'init_season_secret', [u32(SEASON)], [W(admin.publicKey, true), R(seasonPda), W(ssPda), sys]);
check('season secret that does not match the published commitment is refused', !!(await fails(() => send([admin], 'set_season_secret', [crypto.randomBytes(32)], [W(admin.publicKey, true), R(seasonPda), W(ssPda)]))));
await send([admin], 'set_season_secret', [seasonSecret], [W(admin.publicKey, true), R(seasonPda), W(ssPda)]);
await send([admin], 'init_ranking', [u32(SEASON)], [W(admin.publicKey, true), W(rankPda), sys]);
await send([admin], 'init_pool', [u32(SEASON), u16(SHARD)], [W(admin.publicKey, true), W(poolPda), sys]);
const identity = PublicKey.findProgramAddressSync([Buffer.from('identity')], PROGRAM)[0];
const vrfTail = [W(QUEUE), R(identity), R(VRF), R(SYSVAR_SLOT_HASHES_PUBKEY), sys];

type Who = { owner: Keypair; pl: PublicKey; sec: PublicKey };
const who = (o: Keypair): Who => ({ owner: o, pl: pda(Buffer.from('player'), u32(SEASON), o.publicKey.toBuffer()), sec: pda(Buffer.from('secret'), u32(SEASON), o.publicKey.toBuffer()) });
const keysPS = (w: Who, signer = w.owner.publicKey) => [W(signer, true), W(w.pl), W(w.sec), R(seasonPda)];
const keysReq = (w: Who, signer = w.owner.publicKey) => [W(signer, true), W(w.pl), R(w.sec), R(poolPda), R(rankPda), R(seasonPda), ...vrfTail];
const keysApply = (w: Who) => [R(admin.publicKey, true), R(seasonPda), W(w.pl), W(w.sec), W(poolPda), W(rankPda)];
const keysFinish = (w: Who, signer = w.owner.publicKey) => [W(signer, true), W(w.pl), W(w.sec), W(poolPda), W(rankPda), R(seasonPda)];
const cus: Record<string, number[]> = {};
const cu = (k: string, v: number) => (cus[k] ??= []).push(v);

async function setup(o: Keypair) {
  await fund(o);
  const w = who(o);
  await send([o], 'init_player', [u32(SEASON), u16(SHARD)], [W(o.publicKey, true), W(w.pl), W(w.sec), sys]);
  await send([o], 'join_pool', [], [W(o.publicKey, true), W(w.pl), W(poolPda)]);
  return w;
}
/** begin_run + the (local) VRF answer + pick_hero; returns the run's VRF output */
async function startRun(w: Who, pick: number) {
  cu('begin_run (request)', await send([w.owner], 'begin_run', [], [W(w.owner.publicKey, true), W(w.pl), W(w.sec), R(ssPda), R(seasonPda), ...vrfTail]));
  const d = await getP(w.pl);
  const vrf = crypto.randomBytes(32);
  cu('vrf callback (run)', await send([admin], 'local_vrf', [vrf, u32(d.readUInt32LE(L.run_no))], [W(admin.publicKey, true), R(seasonPda), W(w.pl), W(w.sec), R(ssPda)]));
  cu('pick_hero', await send([w.owner], 'pick_hero', [u8(pick)], keysPS(w)));
  return vrf;
}
type Logged = { kind: 'det'; code: number; a: number; b: number } | { kind: 'rand'; code: number; a: number; b: number; req: number; fight?: { opp: Build; seed: number; day: number } };
/** request + (local) apply of a random action; returns the request id */
async function randomAct(w: Who, log: Logged[], code: number, a = 0, b = 0, signer = w.owner) {
  cu(code === 10 ? 'request fight' : `request ${code}`, await send([signer], 'request_action', [u8(code), i8(a), i8(b)], keysReq(w, signer.publicKey)));
  const req = (await getP(w.pl)).readUInt32LE(L.pend_req);
  const day = runBytes(await getP(w.pl))[11];
  cu(code === 10 ? 'apply fight' : `apply ${code}`, await send([admin], 'local_apply', [crypto.randomBytes(32), u32(req)], keysApply(w)));
  const d = await getP(w.pl);
  log.push({ kind: 'rand', code, a, b, req, ...(code === 10 ? { fight: { opp: buildOf(d.subarray(L.last_opp, L.last_opp + 93)), seed: d.readUInt32LE(L.last_seed), day } } : {}) });
  return req;
}
const RANDOM = new Set([3, 6, 7, 8, 12]);

/** play one run with a simple policy; every accepted action is logged for the TS replay */
async function playRun(w: Who, rng: () => number, label: string) {
  const vrf = await startRun(w, Math.floor(rng() * 3));
  const log: Logged[] = [];
  let d = await getP(w.pl);
  const runNo = d.readUInt32LE(L.run_no), choices = [...d.subarray(L.choices, L.choices + 3)], commit = Buffer.from(d.subarray(L.secret_commit, L.secret_commit + 32));
  const pick = runBytes(d)[10];
  const secret = sha('mochi-run', vrf, seasonSecret, w.owner.publicKey.toBuffer(), u32(runNo));
  check(`${label}: during the run Player holds only the commitment`, !d.includes(secret) && !d.includes(vrf));
  const tryRandom = async (code: number, a: number, b = 0) => { try { await randomAct(w, log, code, a, b); return true; } catch { return false; } };
  const tryDet = async (code: number, a: number, b = 0) => {
    try { cu(`act ${code}`, await send([w.owner], 'act', [u8(code), i8(a), i8(b)], keysPS(w))); log.push({ kind: 'det', code, a, b }); return true; } catch { return false; }
  };
  for (let step = 0; step < 300; step++) {
    d = await getP(w.pl);
    if (d[L.status] !== ST.RUN) break;
    const run = runBytes(d);
    const phase = run[21];
    if (phase === 1) { if (rng() < 0.3 && !(await tryRandom(12, 0))) await tryDet(11, 0); else await tryDet(11, Math.floor(rng() * 3)); continue; }
    if (phase === 2) { await tryRandom(7, Math.floor(rng() * 3)); continue; }
    if (phase === 3) { await tryRandom(8, run[25] ? 0 : -1); continue; }
    if (phase !== 0) break;
    for (let k = 0; k < 4; k++) {
      const r = rng();
      if (r < 0.55) await tryDet(0, Math.floor(rng() * 5), Math.floor(rng() * 3) - 1);
      else if (r < 0.7) await tryRandom(3, 0);
      else if (r < 0.8) await tryRandom(6, 0);
      else if (r < 0.88) await tryDet(5, 0);
      else await tryDet(2, Math.floor(rng() * 4), 1);
    }
    await randomAct(w, log, 10);
  }
  d = await getP(w.pl);
  if (d[L.status] === ST.ENDED) cu('finish_run', await send([w.owner], 'finish_run', [], keysFinish(w)));
  d = await getP(w.pl);
  const revSecret = Buffer.from(d.subarray(L.revealed_secret, L.revealed_secret + 32));
  check(`${label}: revealed secret = H(vrf, season secret, owner, run) and matches the commitment`, revSecret.equals(secret) && sha('mochi-commit', revSecret, u32(runNo)).equals(commit));
  // ---------- TS replay from the revealed secret + the public randomness log ----------
  const u32h = (...p: (Buffer | string)[]) => sha(...p).readUInt32LE(0);
  const rs = u32h(revSecret, 'run');
  const heroes = heroChoices(u32h(revSecret, 'heroes')).map((h) => HEROES.findIndex((x) => x.id === h));
  check(`${label}: hero choices = heroChoices(H(secret, "heroes"))`, heroes.join() === choices.join());
  // the day-1 shops shown before the pick = TS newRun of each offered hero with the run's roll seed
  const pv = d.subarray(L.preview, L.preview + 165);
  const pvOk = choices.every((h, i) => {
    const t = newRun(HEROES[h].id, u32h(revSecret, 'look'), 'pv', rs);
    const want = encodeState(t).slice(20 + 5 + 3 + 3 + 2 + 88, 20 + 5 + 3 + 3 + 2 + 88 + 55);
    const got = [...pv.subarray(i * 55, (i + 1) * 55)].map((x, k) => (pv[i * 55 + Math.floor(k / 11) * 11] ? x : 0));
    return want.join() === got.join();
  });
  check(`${label}: the day-1 shops shown before the pick = TS newRun(hero, look, rs) for all 3 heroes`, pvOk);
  const s: RunState = newRun(HEROES[pick].id, u32h(revSecret, 'look'), 'verify', rs);
  const randN = d.readUInt32LE(L.rand_n);
  let j = 0, fightsOk = 0, fights = 0;
  for (const e of log) {
    if (e.kind === 'rand') {
      const r16 = d.subarray(L.rand_log + 16 * j, L.rand_log + 16 * (j + 1));
      j++;
      s.secret = sha(revSecret, r16, u32(e.req)).readUInt32LE(0);
      if (e.fight) {
        fights++;
        if (sha(revSecret, r16, u32(e.req), 'fight').readUInt32LE(0) === e.fight.seed) fightsOk++;
        const r = simulate(toBuild(s), e.fight.opp, e.fight.seed, s.day);
        recordResult(s, r.winner === 0, { opp: 'x', ai: false }, r.winner === -1);
        continue;
      }
    } else s.secret = rs;
    const { code, a: x, b: y } = e;
    if (code === 0) { const o = s.shop[x]; const owned = o ? s.skills.find((k) => k.id === o.id) : undefined; buy(s, x, y < 0 ? undefined : (owned ? nextVariants(owned.v)[y] : undefined) ?? 'zz'); }
    else if (code === 1) sell(s, x); else if (code === 2) moveSkill(s, x, y as 1 | -1); else if (code === 3) reroll(s); else if (code === 4) toggleLock(s, x);
    else if (code === 5) buySlot(s); else if (code === 6) wish(s); else if (code === 7) chooseLastChance(s, (['awaken', 'mark', 'supply'] as const)[x]);
    else if (code === 8) applyMark(s, x); else if (code === 9) concede(s); else if (code === 11) pickRelic(s, x); else if (code === 12) rerollRelic(s);
  }
  check(`${label}: every fight seed = H(secret, r16, req, "fight")`, fightsOk === fights && j === randN, `${fights} fights, ${randN} random actions logged`);
  check(`${label}: TS replay from the revealed secret + randomness log = program state (${log.length} actions, day ${s.day}, ${s.wins} wins)`, encodeRust(Buffer.from(runBytes(d))).join() === encodeState(s).join());
}

let seed = 4242;
const rng = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
const A = await setup(Keypair.generate()), B = await setup(Keypair.generate());
// ---------- E2E: two players, two runs each (the second runs meet the first runs' ghosts) ----------
for (let round = 0; round < 2; round++) for (const [i, w] of [A, B].entries()) await playRun(w, rng, `E2E player ${'AB'[i]} run ${round + 1}`);

/** bring A's run back to its shop phase (relic day → pick, last chance → supply, mark → skip; ended → new run) */
async function toShop(w: Who) {
  for (let k = 0; k < 12; k++) {
    const d = await getP(w.pl);
    if (d[L.status] === ST.ENDED) await send([w.owner], 'finish_run', [], keysFinish(w));
    if (d[L.status] === ST.IDLE || d[L.status] === ST.ENDED) { await startRun(w, 0); continue; }
    const ph = runBytes(d)[21];
    if (ph === 0) return true;
    if (ph === 1) await send([w.owner], 'act', [u8(11), i8(0), i8(0)], keysPS(w));
    else if (ph === 2) await randomAct(w, [], 7, 2);
    else if (ph === 3) await randomAct(w, [], 8, -1);
    else return false;
  }
  return false;
}

// ---------- security tests on a fresh run of A ----------
await startRun(A, 0);
const tick = async () => send([admin], 'set_season_end', [i64(now + 7 * 86400)], [R(admin.publicKey, true), W(seasonPda)]); // any tx: advances slots
async function simRaw(ixs: TransactionInstruction[], payer: Keypair, sigVerify: boolean) {
  const tx = await txOf(payer.publicKey, ixs);
  if (sigVerify) tx.sign(payer);
  const body = { jsonrpc: '2.0', id: 1, method: 'simulateTransaction', params: [tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64'), { encoding: 'base64', commitment: 'confirmed', sigVerify, replaceRecentBlockhash: !sigVerify, accounts: { encoding: 'base64', addresses: [A.pl.toBase58()] } }] };
  const j = await (await fetch(rpc, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
  const v = j.result?.value;
  return { err: v?.err ?? j.error ?? null, logs: (v?.logs ?? []) as string[], post: v?.accounts?.[0]?.data ? Buffer.from(v.accounts[0].data[0], 'base64') : null, returnData: v?.returnData ?? null };
}
// S8: one-transaction deterministic actions; random ones need a request
{
  const d = await getP(A.pl);
  check('S8 a random action on `act` is refused (needs request_action)', /NeedsRequest|0x17|custom/.test(await fails(() => send([A.owner], 'act', [u8(3), i8(0), i8(0)], keysPS(A)))));
  check('S8 a random action inside act_batch is refused', !!(await fails(() => send([A.owner], 'act_batch', [u32(3), Buffer.from([3, 0, 0])], keysPS(A)))));
  const run = runBytes(d);
  const slot = [0, 1, 2, 3, 4].find((i) => run[129 + 11 * i] !== 0) ?? 0;
  const e = run[21] === 0 ? await fails(() => send([A.owner], 'act', [u8(4), i8(slot), i8(0)], keysPS(A))) : 'not in the shop phase';
  check('S8 deterministic actions are one transaction (lock = act)', !e, e.slice(0, 80));
}

// two fights: day 3, gold for rerolls (day 1 has no reroll)
for (let k = 0; k < 2; k++) await randomAct(A, [], 10);

// S1: simulate requests without committing
const dS1 = runBytes(await getP(A.pl));
const s1codes: [number, string][] = [[10, 'fight'], [3, 'reroll'], [12, 'relic reroll'], [6, 'wish']];
for (const [code, name] of s1codes) {
  const before = await getP(A.pl);
  // only actions that are legal right now (an illegal one is refused at request time, before any randomness)
  if ((code === 12 && dS1[21] !== 1) || (code !== 12 && dS1[21] !== 0) || (code === 6 && (await fails(() => simRaw([mkIx('request_action', [u8(6), i8(0), i8(0)], keysReq(A))], A.owner, true).then((r) => { if (r.err) throw new Error('x'); })))) ) continue;
  const r = await simRaw([mkIx('request_action', [u8(code), i8(0), i8(0)], keysReq(A))], A.owner, true);
  const after = await getP(A.pl);
  const postRun = r.post ? runBytes(r.post) : null;
  const revealsNothing = !!r.post && Buffer.compare(postRun!, runBytes(before)) === 0 && r.post[L.pend_state] === 1;
  // strict: the simulation must SUCCEED (the player can simulate) and still show no outcome
  check(`S1 simulate request ${name}: succeeds, commits nothing, post-state = same run + "pending" only (no outcome)`,
    Buffer.compare(after, before) === 0 && r.err === null && revealsNothing, r.err ? `sim err ${JSON.stringify(r.err).slice(0, 80)}` : `logs ${r.logs.length} (no roll in them), return data ${r.returnData ? 'yes' : 'none'}`);
}
// S2: preview a fight by simulating the callback with a forged VRF signer + guessed randomness
await send([A.owner], 'request_action', [u8(10), i8(0), i8(0)], keysReq(A));
const reqF = (await getP(A.pl)).readUInt32LE(L.pend_req);
const forged = [R(VRF_ID, true), W(A.pl), W(A.sec), W(poolPda), W(rankPda)];
const outcomes = new Set<string>();
let forgedRan = 0;
for (let k = 0; k < 6; k++) {
  const r = await simRaw([mkIx('apply_random', [crypto.randomBytes(32), u32(reqF)], forged)], A.owner, false);
  if (!r.err && r.post) { forgedRan++; outcomes.add(runBytes(r.post).toString('hex') + r.post.readUInt32LE(L.last_seed)); }
}
await send([admin], 'local_apply', [crypto.randomBytes(32), u32(reqF)], keysApply(A));
const dReal = await getP(A.pl);
const real = runBytes(dReal).toString('hex') + dReal.readUInt32LE(L.last_seed);
check('S2 forged-callback simulations run (the preview path exists) but each guessed randomness gives another fight; none is the real one',
  forgedRan === 6 && outcomes.size === forgedRan && !outcomes.has(real), `${forgedRan} simulated, ${outcomes.size} different outcomes, real one not among them`);
check('S2 a real (non-simulated) callback can not be signed by the player as the VRF identity', !!(await fails(() => send([A.owner], 'apply_random', [crypto.randomBytes(32), u32(reqF)], [R(A.owner.publicKey, true), W(A.pl), W(A.sec), W(poolPda), W(rankPda)]))));

// S3 / S5 / S4: one request at a time, duplicates, replays
let d = await getP(A.pl);
check('(setup) back in the shop for S3–S5', await toShop(A));
{
  await send([A.owner], 'request_action', [u8(3), i8(0), i8(0)], keysReq(A)).catch(() => send([A.owner], 'request_action', [u8(10), i8(0), i8(0)], keysReq(A)));
  const req = (await getP(A.pl)).readUInt32LE(L.pend_req);
  check('S3 a second request while one is pending is refused', /Pending|0x17/.test(await fails(() => send([A.owner], 'request_action', [u8(10), i8(0), i8(0)], keysReq(A)))) || !!(await fails(() => send([A.owner], 'request_action', [u8(10), i8(0), i8(0)], keysReq(A)))));
  check('S3 a deterministic action while a request is pending is refused', !!(await fails(() => send([A.owner], 'act', [u8(4), i8(0), i8(0)], keysPS(A)))));
  check('S3 act_batch while a request is pending is refused', !!(await fails(() => send([A.owner], 'act_batch', [u32(3), Buffer.from([4, 0, 0])], keysPS(A)))));
  const r1 = crypto.randomBytes(32);
  await send([admin], 'local_apply', [r1, u32(req)], keysApply(A));
  const once = await getP(A.pl);
  const dup = await fails(() => send([admin], 'local_apply', [crypto.randomBytes(32), u32(req)], keysApply(A)));
  check('S5 duplicate callback of an applied request is refused and changes nothing', !!dup && Buffer.compare(await getP(A.pl), once) === 0);
  check('S4 replaying an OLD request id (applied earlier) is refused', !!(await fails(() => send([admin], 'local_apply', [crypto.randomBytes(32), u32(reqF)], keysApply(A)))));
}
// S6: timeout + recovery
check('(setup) back in the shop for S6', await toShop(A));
{
  await send([A.owner], 'request_action', [u8(10), i8(0), i8(0)], keysReq(A));
  const p0 = await getP(A.pl);
  const req = p0.readUInt32LE(L.pend_req);
  check('S6 retry before the timeout is refused', !!(await fails(() => send([A.owner], 'retry_request', [], keysReq(A)))));
  for (let k = 0; k < 40; k++) { await tick(); if ((await c.getSlot()) >= Number(p0.readBigUInt64LE(L.pend_slot)) + 22) break; await sleep(200); }
  await send([A.owner], 'retry_request', [], keysReq(A));
  const p1 = await getP(A.pl);
  check('S6 after the timeout the SAME action is re-requested (same id, code, args; state otherwise unchanged)',
    p1.readUInt32LE(L.pend_req) === req && p1[L.pend_code] === 10 && p1[L.pend_state] === 1 && Buffer.compare(runBytes(p1), runBytes(p0)) === 0);
  check('S6 no instruction cancels or changes a pending request (re-request with another action refused)', !!(await fails(() => send([A.owner], 'request_action', [u8(3), i8(0), i8(0)], keysReq(A)))));
  await send([admin], 'local_apply', [crypto.randomBytes(32), u32(req)], keysApply(A));
  const p2 = await getP(A.pl);
  check('S6 the late answer applies once; a second answer (e.g. the first request\'s) is refused',
    p2[L.pend_state] === 0 && !!(await fails(() => send([admin], 'local_apply', [crypto.randomBytes(32), u32(req)], keysApply(A)))));
}
// S7: access
const stranger = Keypair.generate();
await fund(stranger);
check('S7 a stranger cannot request on another player\'s account', !!(await fails(() => send([stranger], 'request_action', [u8(10), i8(0), i8(0)], keysReq(A, stranger.publicKey)))));
check('S7 a stranger cannot play deterministic actions on it', !!(await fails(() => send([stranger], 'act', [u8(4), i8(0), i8(0)], keysPS(A, stranger.publicKey)))));
check('S7 the player cannot answer randomness (local_apply is admin-only, stands in for the VRF identity)', !!(await fails(() => send([A.owner], 'local_apply', [crypto.randomBytes(32), u32(1)], [R(A.owner.publicKey, true), R(seasonPda), W(A.pl), W(A.sec), W(poolPda), W(rankPda)]))));
const sk = Keypair.generate();
await fund(sk);
await send([A.owner], 'set_session', [sk.publicKey.toBuffer(), i64(Math.floor(Date.now() / 1000) + 3600)], [R(A.owner.publicKey, true), W(A.pl)]);
let sessionPlayed = false;
check('(setup) back in the shop for the session-key test', await toShop(A));
{
  sessionPlayed = !(await fails(() => randomAct(A, [], 10, 0, 0, sk)));
  check('S7 the session key can request + play', sessionPlayed);
}
await send([A.owner], 'revoke_session', [], [R(A.owner.publicKey, true), W(A.pl)]);
check('S7 after revoke_session the session key is refused', !!(await fails(() => send([sk], 'request_action', [u8(10), i8(0), i8(0)], keysReq(A, sk.publicKey)))));
const stat = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return `n ${String(s.length).padStart(3)}  mean ${String(Math.round(s.reduce((a, b) => a + b, 0) / s.length)).padStart(7)}  max ${String(s[s.length - 1]).padStart(7)}`; };
console.log('\nCU per transaction (local validator, includes the compute-budget instruction):');
for (const [k, v] of Object.entries(cus).sort()) console.log(`  ${k.padEnd(22)} ${stat(v)}`);
const bad = checks.filter((x) => !x[1]).length;
console.log(`\n${checks.length - bad}/${checks.length} checks passed`);
process.exit(bad ? 1 : 0);
