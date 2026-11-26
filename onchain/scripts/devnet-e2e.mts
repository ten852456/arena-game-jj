// mochi-game (sim v22) on devnet + the MagicBlock TEE, end to end, with the REAL VRF oracle:
//   admin: season (+ committed season secret), season secret, ranking, pool → `delegate` kinds 2/3/4 → TEE:
//          `set_permission` kinds 2/3/4 (no members) → set_season_secret
//   player: the UI's own client (src/client/chain.ts, burner wallet = owner + session key): init + `delegate` kinds
//          0/1, `set_permission` kinds 0/1, join_pool, runs with every random action through request + VRF callback
//   privacy: who can read Player / RunSecret / SeasonSecret / Pool / Ranking on the TEE
//   season end: set_season_end → close_season → issue_proof (read privately) → finalize_player / publish_root /
//          clear_pool (commit + undelegate) → accounts back on Solana, scrubbed → claim_reward (forged / real / twice)
// Keys: admin = WSL ~/.config/solana/id.json; throwaway keys are SAVED to DEVNET_KEYS before any SOL moves.
//   DEVNET_KEYS=<file> npx tsx onchain/scripts/devnet-e2e.mts          → full test, result in onchain/docs/devnet-e2e.json
//   DEVNET_KEYS=<file> npx tsx onchain/scripts/devnet-e2e.mts --ui     → only a 30-day season for the UI (writes
//                                                                         src/client/public/chain.json)
import fs from 'node:fs';
import crypto from 'node:crypto';
import bs58 from 'bs58';
import { ed25519 } from '@noble/curves/ed25519';
import { ComputeBudgetProgram, Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';

const UI = process.argv.includes('--ui');
const BASE = 'https://api.devnet.solana.com', TEE = 'https://devnet-tee.magicblock.app';
const VALIDATOR = new PublicKey('MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo');
const PROGRAM = new PublicKey('7yVgjzySuXwBeRJ18ZhunetqBz8ZTBNGiQVkw1or7w2r');
const DLP = new PublicKey('DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh');
const PERMISSION_PROGRAM = new PublicKey('ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1');
const MAGIC_VAULT = new PublicKey('MagicVau1t999999999999999999999999999999999');
const MAGIC_PROGRAM = new PublicKey('Magic11111111111111111111111111111111111111');
const MAGIC_CONTEXT = new PublicKey('MagicContext1111111111111111111111111111111');
const ADMIN_KEY = process.env.ADMIN_KEY ?? '\\\\wsl.localhost\\Ubuntu-26.04\\home\\user\\.config\\solana\\id.json';
const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(ADMIN_KEY, 'utf8'))));
const KEYS = process.env.DEVNET_KEYS;
if (!KEYS) throw new Error('set DEVNET_KEYS=<file> (throwaway test keys are kept there)');
const saved = fs.existsSync(KEYS) ? JSON.parse(fs.readFileSync(KEYS, 'utf8')) : {};
const kp = (x?: number[]) => (x ? Keypair.fromSecretKey(Uint8Array.from(x)) : Keypair.generate());
const burner = kp(UI ? undefined : saved.burner), stranger = kp(saved.stranger);
const seasonSecret = crypto.randomBytes(32);
const SEASON = Math.floor(Math.random() * 4e9) + 1, SHARD = 0;
fs.writeFileSync(KEYS, JSON.stringify({ ...saved, ...(UI ? {} : { burner: [...burner.secretKey] }), stranger: [...stranger.secretKey], [`season_${SEASON}`]: seasonSecret.toString('hex') }));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sha = (...x: (Buffer | Uint8Array | string)[]) => crypto.createHash('sha256').update(Buffer.concat(x.map((y) => Buffer.from(y)))).digest();
const disc = (n: string) => sha('global:' + n).subarray(0, 8);
const u8 = (n: number) => Buffer.from([n]);
const u16 = (n: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
const i64 = (n: number) => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return b; };
const pdaOf = (seeds: (Buffer | Uint8Array)[], p = PROGRAM) => PublicKey.findProgramAddressSync(seeds, p)[0];
type Meta = { pubkey: PublicKey; isSigner: boolean; isWritable: boolean };
const W = (pubkey: PublicKey, isSigner = false): Meta => ({ pubkey, isSigner, isWritable: true });
const R = (pubkey: PublicKey, isSigner = false): Meta => ({ pubkey, isSigner, isWritable: false });
const mk = (name: string, data: Buffer[], keys: Meta[]) => new TransactionInstruction({ programId: PROGRAM, keys, data: Buffer.concat([disc(name), ...data]) });
const sys = R(SystemProgram.programId);
const now = () => Math.floor(Date.now() / 1000);

const seasonPda = pdaOf([Buffer.from('season'), u32(SEASON)]);
const ssPda = pdaOf([Buffer.from('season_secret'), u32(SEASON)]);
const rankPda = pdaOf([Buffer.from('ranking'), u32(SEASON)]);
const poolPda = pdaOf([Buffer.from('pool'), u32(SEASON), u16(SHARD)]);
const playerPda = pdaOf([Buffer.from('player'), u32(SEASON), burner.publicKey.toBuffer()]);
const secretPda = pdaOf([Buffer.from('secret'), u32(SEASON), burner.publicKey.toBuffer()]);
const K = { PLAYER: 0, SECRET: 1, SEASON_SECRET: 2, POOL: 3, RANKING: 4 };
const kindArgs = (k: number) => [u8(k), u32(SEASON), u16(SHARD)];
const delegateIx = (payer: PublicKey, kind: number, acc: PublicKey, seasonAcc?: PublicKey) => mk('delegate', kindArgs(kind), [
  R(payer, true), R(seasonAcc ?? PROGRAM),
  W(pdaOf([Buffer.from('buffer'), acc.toBuffer()])), W(pdaOf([Buffer.from('delegation'), acc.toBuffer()], DLP)), W(pdaOf([Buffer.from('delegation-metadata'), acc.toBuffer()], DLP)),
  W(acc), R(VALIDATOR), R(PROGRAM), R(DLP), sys,
]);
const permissionIx = (payer: PublicKey, kind: number, acc: PublicKey, seasonAcc?: PublicKey) => mk('set_permission', kindArgs(kind), [
  W(payer, true), R(seasonAcc ?? PROGRAM), W(acc), W(pdaOf([Buffer.from('permission:'), acc.toBuffer()], PERMISSION_PROGRAM)), R(PERMISSION_PROGRAM), W(MAGIC_VAULT), R(MAGIC_PROGRAM),
]);
const commitTail = () => [R(MAGIC_PROGRAM), W(MAGIC_CONTEXT)];

async function token(k: Keypair): Promise<string> {
  const ch = await (await fetch(`${TEE}/auth/challenge?pubkey=${k.publicKey.toBase58()}`)).json();
  const sig = ed25519.sign(Buffer.from(ch.challenge, 'utf-8'), k.secretKey.subarray(0, 32));
  const r = await fetch(`${TEE}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pubkey: k.publicKey.toBase58(), challenge: ch.challenge, signature: bs58.encode(sig) }) });
  const j = await r.json();
  if (r.status !== 200 || !j.token) throw new Error('TEE auth ' + JSON.stringify(j));
  return j.token;
}
const conn = (u: string) => new Connection(u, 'confirmed');
const lat: Record<string, number[]> = {};
async function send(c: Connection, signers: Keypair[], ixs: TransactionInstruction[], label: string): Promise<string> {
  const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), ...ixs);
  tx.feePayer = signers[0].publicKey;
  tx.recentBlockhash = (await c.getLatestBlockhash('confirmed')).blockhash;
  tx.sign(...signers);
  const t0 = performance.now();
  // the public devnet RPC rate-limits (429): retry the send / status calls instead of failing the step
  const retry = async <T,>(f: () => Promise<T>): Promise<T> => { for (let k = 0; ; k++) { try { return await f(); } catch (e) { if (k >= 8 || !/429|Too Many/.test(String(e))) throw e; await sleep(2000 * (k + 1)); } } };
  const sig = await retry(() => c.sendRawTransaction(tx.serialize(), { skipPreflight: true }));
  for (let i = 0; i < 400; i++) {
    const st = (await retry(() => c.getSignatureStatuses([sig]))).value[0];
    if (st && (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized')) {
      (lat[label] ??= []).push(performance.now() - t0);
      if (st.err) {
        const t = await c.getTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' }).catch(() => null);
        throw new Error(`${label} failed ${JSON.stringify(st.err)} ${(t?.meta?.logMessages ?? []).filter((l) => /Error|error|failed|rejected/.test(l)).slice(-3).join(' | ')}`);
      }
      return sig;
    }
    await sleep(150);
  }
  throw new Error('timeout ' + label);
}
async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, ms = 120_000, every = 2000): Promise<T> {
  const end = Date.now() + ms;
  let last = '';
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch (e) { last = String((e as Error).message).slice(0, 200); }
    if (Date.now() > end) throw new Error('timeout' + (last ? ': ' + last : ''));
    await sleep(every);
  }
}
const results: { name: string; ok: boolean; ms: number; detail: unknown }[] = [];
async function step<T>(name: string, fn: () => Promise<T>): Promise<T | undefined> {
  const t0 = performance.now();
  try {
    const d = await fn();
    results.push({ name, ok: true, ms: Math.round(performance.now() - t0), detail: d });
    console.log(`OK   ${String(Math.round(performance.now() - t0)).padStart(6)}ms  ${name}  ${typeof d === 'string' ? d : JSON.stringify(d) ?? ''}`);
    return d;
  } catch (e) {
    const m = String((e as Error).message ?? e).split('\n').slice(0, 2).join(' | ').slice(0, 400);
    results.push({ name, ok: false, ms: Math.round(performance.now() - t0), detail: m });
    console.log(`FAIL ${String(Math.round(performance.now() - t0)).padStart(6)}ms  ${name}  ${m}`);
    return undefined;
  }
}
const fails = async (f: () => Promise<unknown>) => { try { await f(); return ''; } catch (e) { return String((e as Error).message).slice(0, 200) || 'error'; } };

// ---------- build every admin instruction BEFORE any SOL moves ----------
const start = now() - 600, end = now() + (UI ? 30 * 86400 : 3600);
const adminIxs = {
  season: mk('init_season', [u32(SEASON), i64(start), i64(end), sha(seasonSecret)], [W(admin.publicKey, true), W(seasonPda), sys]),
  ss: mk('init_season_secret', [u32(SEASON)], [W(admin.publicKey, true), R(seasonPda), W(ssPda), sys]),
  ranking: mk('init_ranking', [u32(SEASON)], [W(admin.publicKey, true), W(rankPda), sys]),
  pool: mk('init_pool', [u32(SEASON), u16(SHARD)], [W(admin.publicKey, true), W(poolPda), sys]),
  delegates: [delegateIx(admin.publicKey, K.SEASON_SECRET, ssPda, seasonPda), delegateIx(admin.publicKey, K.POOL, poolPda), delegateIx(admin.publicKey, K.RANKING, rankPda)],
  perms: [permissionIx(admin.publicKey, K.SEASON_SECRET, ssPda, seasonPda), permissionIx(admin.publicKey, K.POOL, poolPda), permissionIx(admin.publicKey, K.RANKING, rankPda)],
  setSecret: mk('set_season_secret', [seasonSecret], [R(admin.publicKey, true), R(seasonPda), W(ssPda)]),
};
const base = conn(BASE);
const tee = { admin: conn(`${TEE}?token=${await token(admin)}`), stranger: conn(`${TEE}?token=${await token(stranger)}`), owner: conn(`${TEE}?token=${await token(burner)}`) };
console.log('program', PROGRAM.toBase58(), 'season', SEASON, 'admin', admin.publicKey.toBase58(), 'balance', (await base.getBalance(admin.publicKey)) / LAMPORTS_PER_SOL);

// ---------- admin setup ----------
await step('admin: season (+ season secret commitment), season secret, ranking, pool on Solana', async () => {
  await send(base, [admin], [adminIxs.season, adminIxs.ss], 'init');
  await send(base, [admin], [adminIxs.ranking, adminIxs.pool], 'init');
  return 'ok';
});
await step('admin: `delegate` kinds 2 (season secret), 3 (pool), 4 (ranking) → TEE', () => send(base, [admin], adminIxs.delegates, 'delegate'));
await step('admin: `set_permission` kinds 2/3/4 on the TEE (no members) + set_season_secret', () => waitFor(async () => {
  await send(tee.admin, [admin], adminIxs.perms, 'permission');
  await send(tee.admin, [admin], [adminIxs.setSecret], 'season_secret');
  return 'ok';
}, 180_000, 4000));
if (UI) {
  const cfgPath = new URL('../../src/client/public/chain.json', import.meta.url);
  const old = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  fs.writeFileSync(cfgPath, JSON.stringify({ mode: 'tee', rpc: BASE, tee: old.tee ?? '/tee', validator: VALIDATOR.toBase58(), program: PROGRAM.toBase58(), season: SEASON, shard: SHARD }, null, 2) + '\n');
  console.log('UI season', SEASON, 'until', new Date(end * 1000).toISOString(), '→ src/client/public/chain.json');
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}

// ---------- the player: the UI's chain client, burner wallet, devnet + TEE ----------
const store = new Map<string, string>([['arena.chain.burner', JSON.stringify([...burner.secretKey])]]);
const g = globalThis as Record<string, unknown>;
g.location = new URL('http://localhost/play/?chain=1&wallet=burner');
g.history = { replaceState() {} };
g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k), key: () => null, get length() { return store.size; } };
Object.defineProperty(g.localStorage, 'keys', { value: () => [...store.keys()] });
g.window = globalThis;
const realFetch = globalThis.fetch;
const uiCfg = { mode: 'tee', rpc: BASE, tee: TEE, validator: VALIDATOR.toBase58(), program: PROGRAM.toBase58(), season: SEASON, shard: SHARD };
g.fetch = (u: string, o?: RequestInit) => (String(u).endsWith('/chain.json') ? Promise.resolve(new Response(JSON.stringify(uiCfg))) : realFetch(u, o));
const C = await import('../../src/client/chain');
const Rn = await import('../../src/client/runChain');
const { simulate } = await import('../../src/sim/combat');
type RS = import('../../src/sim/run').RunState;

await step('fund the burner owner (0.08 devnet SOL)', async () => {
  const have = await base.getBalance(burner.publicKey);
  if (have < 0.05 * LAMPORTS_PER_SOL) await send(base, [admin], [SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: burner.publicKey, lamports: 0.08 * LAMPORTS_PER_SOL - have })], 'fund');
  return burner.publicKey.toBase58();
});
const connected = await step('player: connect = init_player + `delegate` kinds 0/1 (Solana), `set_permission` kinds 0/1 + join_pool (TEE)', async () => {
  const st = await C.chainConnect();
  if (st.status !== 0) throw new Error('status ' + st.status);
  return 'status idle, seat taken';
});
const PL = { claimReward: 8 + 5 * 8 + 5 * 32 + 7 * 4, claimRank: 0, claimProof: 0, bestScore: 8 + 5 * 8 + 5 * 32 + 4 * 4, status: 8 + 253 };
PL.claimRank = 8 + 5 * 8 + 5 * 32 + 11 * 4 + 4 * 2 + 7;
PL.claimProof = 8 + 268 + 184 + 93 + 93 + 1323;
const readPlayer = async (c: Connection) => { const a = await c.getAccountInfo(playerPda); return a ? Buffer.from(a.data) : null; };
const runStats: unknown[] = [];
async function playRun(): Promise<{ fights: number; replayOk: number; rolls: number; wins: number; day: number; phase: string; vrfMs: number }> {
  let run: RS | null = null;
  const adopt = (b: Uint8Array) => { run = Object.assign(C.runOf(b, 'ui'), { log: [], rating: 1000 }); };
  const t0 = Date.now();
  const begun = await C.chainBeginRun();
  const vrfMs = Date.now() - t0;
  adopt(await C.chainPickHero(0));
  let fights = 0, replayOk = 0, rolls = 0;
  for (let s = 0; s < 80 && run && (run as RS).phase !== 'won' && (run as RS).phase !== 'dead'; s++) {
    const r = run as RS;
    if (r.phase === 'relic') { if (s % 3 === 0 && (r.relicRolls ?? 0) < 1) { adopt((await C.chainRoll(12)).run); rolls++; } else { Rn.pickRelic(r, 0); await C.chainFlush(); } continue; }
    if (r.phase === 'lastchance') { adopt((await C.chainRoll(7, s % 3)).run); rolls++; continue; }
    if (r.phase === 'mark') { adopt((await C.chainRoll(8, r.skills.length ? 0 : -1)).run); rolls++; continue; }
    for (let i = 0; i < 5; i++) if (r.shop[i] && !Rn.buy(r, i)) break;
    if (C.chainQueued()) await C.chainFlush();
    if (r.day >= 2 && r.gold >= 1 && s % 3 === 0) { adopt((await C.chainRoll(3)).run); rolls++; }
    const build = Rn.toBuild(run!), day = (run as RS).day;
    const f = await C.chainFight();
    fights++;
    const res = simulate(build, f.opp, f.seed, day);
    if ((res.winner === 0) === f.won && f.day === day) replayOk++;
    adopt(f.run);
  }
  if ((await C.chainState())?.status === 3) await C.chainFinish();
  if (!begun.choices?.length) throw new Error('no hero choices');
  return { fights, replayOk, rolls, wins: (run as unknown as RS).wins, day: (run as unknown as RS).day, phase: (run as unknown as RS).phase, vrfMs };
}
if (connected) {
  for (let i = 1; i <= 4; i++) {
    const st = await step(`player: run ${i} on the TEE (real VRF for the run + every random action and fight)`, async () => {
      const s = await playRun();
      if (s.replayOk !== s.fights) throw new Error(`replay mismatch ${s.replayOk}/${s.fights}`);
      return s;
    });
    runStats.push(st);
    const p = await readPlayer(tee.owner);
    if (!st || (p && p.readUInt32LE(PL.bestScore) > 0)) break; // ranked (score > 0): enough for the season end
  }
}

// ---------- privacy ----------
await step('privacy: owner reads its Player; RunSecret / SeasonSecret / Pool / Ranking unreadable to owner, stranger, admin', async () => {
  const r: Record<string, Record<string, boolean>> = {};
  for (const [who, c] of Object.entries(tee)) {
    r[who] = {};
    for (const [n, k] of [['player', playerPda], ['runSecret', secretPda], ['seasonSecret', ssPda], ['pool', poolPda], ['ranking', rankPda]] as const) r[who][n] = !!(await c.getAccountInfo(k).catch(() => null));
  }
  const leak = Object.entries(r).flatMap(([who, x]) => Object.entries(x).filter(([n, v]) => v && !(who === 'owner' && n === 'player')).map(([n]) => `${who}:${n}`));
  if (!r.owner.player) throw new Error('owner cannot read its player');
  if (leak.length) throw new Error('LEAK ' + leak.join(', '));
  return r;
});
await step('privacy: a stranger cannot play on the player (signer check)', async () => {
  const e = await fails(() => send(tee.stranger, [stranger], [mk('set_session', [stranger.publicKey.toBuffer(), i64(now() + 3600)], [R(stranger.publicKey, true), W(playerPda)])], 'stranger'));
  if (!e) throw new Error('ACCEPTED');
  return 'refused';
});

// ---------- season end ----------
const newEnd = now() + 30;
await step('season end: set_season_end (now + 30 s)', () => send(base, [admin], [mk('set_season_end', [i64(newEnd)], [R(admin.publicKey, true), W(seasonPda)])], 'season_end'));
await step('season end: close_season on the TEE after the end (Merkle root)', () => waitFor(() => send(tee.admin, [admin], [mk('close_season', [u32(SEASON)], [R(admin.publicKey, true), R(seasonPda), W(rankPda)])], 'close'), 240_000, 4000));
let proof: { rank: number; reward: number; proof: number[][] } | null = null;
await step('season end: issue_proof → the player reads it privately (owner token)', async () => {
  const e = await fails(() => send(tee.admin, [admin], [mk('issue_proof', [u32(SEASON)], [R(admin.publicKey, true), W(rankPda), W(playerPda)])], 'proof'));
  if (e) { if (/6012|NotRanked/.test(e)) return 'not ranked (no run scored)'; throw new Error(e); }
  const p = await waitFor(async () => { const d = await readPlayer(tee.owner); return d && d[PL.claimRank - 1] === 1 ? d : null; }, 60_000, 1500);
  proof = { rank: p[PL.claimRank], reward: p.readUInt32LE(PL.claimReward), proof: Array.from({ length: 4 }, (_, k) => [...p.subarray(PL.claimProof + 32 * k, PL.claimProof + 32 * (k + 1))]) };
  if (await readPlayer(tee.stranger)) throw new Error('stranger can read the proof');
  return { rank: proof.rank, reward: proof.reward };
});
await step('season end: finalize_player (scrub, commit + undelegate Player + RunSecret)', () => send(tee.admin, [admin], [mk('finalize_player', [u32(SEASON)], [W(admin.publicKey, true), R(seasonPda), W(playerPda), W(secretPda), ...commitTail()])], 'finalize'));
await step('season end: publish_root (scrub ranking, commit + undelegate)', () => send(tee.admin, [admin], [mk('publish_root', [u32(SEASON)], [W(admin.publicKey, true), W(rankPda), ...commitTail()])], 'publish'));
await step('season end: clear_pool (delete ghosts, commit + undelegate)', () => send(tee.admin, [admin], [mk('clear_pool', [u32(SEASON), u16(SHARD)], [W(admin.publicKey, true), R(seasonPda), W(poolPda), ...commitTail()])], 'clear'));
await step('season end: Player, RunSecret, Ranking, Pool back on Solana (owned by the program again)', async () => {
  for (const k of [playerPda, secretPda, rankPda, poolPda]) await waitFor(async () => (await base.getAccountInfo(k))?.owner.equals(PROGRAM), 240_000, 3000);
  return 'yes';
});
await step('season end: the Solana copies hold no secret (run secret, VRF, run state, proof, ranking entries, ghosts)', async () => {
  const p = (await base.getAccountInfo(playerPda))!.data, s = (await base.getAccountInfo(secretPda))!.data;
  const r = (await base.getAccountInfo(rankPda))!.data, pool = (await base.getAccountInfo(poolPda))!.data;
  const bad: string[] = [];
  if (s.subarray(8 + 24 + 32).some(Boolean)) bad.push('run secret / vrf');
  if (p.subarray(8 + 268, 8 + 268 + 184).some(Boolean)) bad.push('run state');
  if (p.subarray(PL.claimProof, PL.claimProof + 128).some(Boolean)) bad.push('proof');
  if (r.subarray(8 + 48).some(Boolean)) bad.push('ranking entries');
  if (pool.subarray(8 + 24 + 32 * 6).some(Boolean)) bad.push('ghosts');
  if (bad.length) throw new Error('SECRETS ON SOLANA: ' + bad.join(', '));
  return { playerStatus: p[PL.status], rankingClosed: r[8 + 9], published: r[8 + 10], root: Buffer.from(r.subarray(8 + 16, 8 + 48)).toString('hex').slice(0, 16) + '…' };
});
if (proof) {
  const pr = proof as { rank: number; reward: number; proof: number[][] };
  const claim = (reward: number) => send(base, [burner], [mk('claim_reward', [u32(SEASON), u8(pr.rank), u32(reward), Buffer.from(pr.proof.flat())], [
    W(burner.publicKey, true), R(rankPda), W(pdaOf([Buffer.from('claim'), u32(SEASON), burner.publicKey.toBuffer()])), W(pdaOf([Buffer.from('wallet'), burner.publicKey.toBuffer()])), sys,
  ])], 'claim');
  await step('claim: forged reward rejected', async () => { if (!(await fails(() => claim(pr.reward + 1)))) throw new Error('ACCEPTED'); return 'rejected'; });
  await step('claim: own proof accepted on Solana', async () => { await claim(pr.reward); return pr; });
  await step('claim: second claim rejected', async () => { if (!(await fails(() => claim(pr.reward)))) throw new Error('ACCEPTED'); return 'rejected'; });
}

const stat = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return { n: s.length, mean: Math.round(s.reduce((a, b) => a + b, 0) / s.length), p95: Math.round(s[Math.floor(s.length * 0.95)]), max: Math.round(s[s.length - 1]) }; };
const latency = Object.fromEntries(Object.entries(lat).map(([k, v]) => [k, stat(v)]));
console.log('LATENCY (script txs, ms)', JSON.stringify(latency));
const okN = results.filter((r) => r.ok).length;
console.log(`\n${okN}/${results.length} steps ok`);
fs.writeFileSync(new URL('../docs/devnet-e2e.json', import.meta.url), JSON.stringify({ at: new Date().toISOString(), program: PROGRAM.toBase58(), season: SEASON, runs: runStats, latency, results }, null, 1));
process.exit(okN === results.length ? 0 : 1);
