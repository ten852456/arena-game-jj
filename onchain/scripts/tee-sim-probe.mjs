// Practical check of the MagicBlock TEE (devnet) against "simulation peeking" (onchain/docs/RANDOMNESS.md §3).
// Uses the program ALREADY on devnet (old layout 3; nothing is deployed) and one throwaway test player in the season
// of src/client/public/chain.json. What it asks the TEE, for owner token, session-key token, stranger token, no token:
//  - getAccountInfo of the player (owner + session members) and of the pool / ranking (zero members)
//  - simulateTransaction of `fight` (reads the zero-member pool + ranking, writes the player): error, logs,
//    return data, post-state of each account (accounts option), with and without signature verification
//  - simulate of a member-only action (`act` reroll) as a baseline
//  - a committed fight: getTransaction (logs) per token
// Run from arena-game-jj:  node onchain/scripts/tee-sim-probe.mjs > onchain/docs/tee-sim-probe.json
import fs from 'node:fs';
import crypto from 'node:crypto';
import bs58 from 'bs58';
import { ed25519 } from '@noble/curves/ed25519';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, ComputeBudgetProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';

const cfg = JSON.parse(fs.readFileSync(new URL('../../src/client/public/chain.json', import.meta.url)));
const idl = JSON.parse(fs.readFileSync(new URL('../idl/mochi_game.json', import.meta.url)));
const BASE = 'https://api.devnet.solana.com', TEE = 'https://devnet-tee.magicblock.app';
const VALIDATOR = new PublicKey(cfg.validator);
const PROGRAM = new PublicKey(cfg.program);
const SEASON = cfg.season, SHARD = cfg.shard;
const ADMIN_KEY = process.env.ADMIN_KEY ?? '\\\\wsl.localhost\\Ubuntu-26.04\\home\\user\\.config\\solana\\id.json';
const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(ADMIN_KEY))));
// throwaway keys are SAVED (PROBE_KEYS, outside the repo) so a rerun reuses the same funded test player
const KEYS = process.env.PROBE_KEYS;
if (!KEYS) throw new Error('set PROBE_KEYS=<file> (throwaway test keys are kept there)');
const saved = fs.existsSync(KEYS) ? JSON.parse(fs.readFileSync(KEYS, 'utf8')) : null;
const kp = (x) => (x ? Keypair.fromSecretKey(Uint8Array.from(x)) : Keypair.generate());
const owner = kp(saved?.owner), session = kp(saved?.session), stranger = kp(saved?.stranger);
fs.writeFileSync(KEYS, JSON.stringify({ owner: [...owner.secretKey], session: [...session.secretKey], stranger: [...stranger.secretKey] }));
const DRY = process.argv.includes('--dry');
/** devnet SOL this run may move from the admin to the test owner (top-up only) */
const BUDGET = Number(process.env.PROBE_BUDGET_SOL ?? 0.03) * LAMPORTS_PER_SOL;
const out = { at: new Date().toISOString(), program: PROGRAM.toBase58(), season: SEASON, owner: owner.publicKey.toBase58(), session: session.publicKey.toBase58(), stranger: stranger.publicKey.toBase58(), probes: [] };
const log = (x) => { out.probes.push(x); console.error(JSON.stringify(x).slice(0, 400)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
const i64 = (n) => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return b; };
const disc = (n) => crypto.createHash('sha256').update('global:' + n).digest().subarray(0, 8);
const pda = (seeds, prog = PROGRAM) => PublicKey.findProgramAddressSync(seeds, prog)[0];

// ---------- tiny IDL instruction builder (args given as Buffers, in order) ----------
function ix(name, args, accs) {
  const def = idl.instructions.find((i) => i.name === name);
  const keys = [];
  const known = { player: accs.player ?? pda([Buffer.from('player'), accs['arg:season'] ?? u32(SEASON), accs.owner.toBuffer()]), ...accs };
  for (const a of def.accounts) {
    let k = known[a.name];
    if (!k && a.address) k = new PublicKey(a.address);
    if (!k && a.pda) {
      const seeds = a.pda.seeds.map((s) => (s.kind === 'const' ? Buffer.from(s.value) : s.kind === 'account' ? known[s.path].toBuffer() : accs['arg:' + s.path]));
      const prog = a.pda.program ? (a.pda.program.kind === 'const' ? new PublicKey(Buffer.from(a.pda.program.value)) : known[a.pda.program.path] ?? new PublicKey(def.accounts.find((x) => x.name === a.pda.program.path).address)) : PROGRAM;
      k = pda(seeds, prog);
    }
    if (!k && a.optional) k = PROGRAM; // anchor: program id = None
    if (!k) throw new Error(`${name}: no account ${a.name}`);
    known[a.name] = k;
    keys.push({ pubkey: k, isSigner: !!a.signer, isWritable: !!a.writable });
  }
  return new TransactionInstruction({ programId: PROGRAM, keys, data: Buffer.concat([disc(name), ...args]) });
}
async function token(k) {
  const ch = await (await fetch(`${TEE}/auth/challenge?pubkey=${k.publicKey.toBase58()}`)).json();
  const sig = ed25519.sign(Buffer.from(ch.challenge, 'utf-8'), k.secretKey.subarray(0, 32));
  const r = await fetch(`${TEE}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pubkey: k.publicKey.toBase58(), challenge: ch.challenge, signature: bs58.encode(sig) }) });
  const j = await r.json();
  if (r.status !== 200) throw new Error('auth ' + JSON.stringify(j));
  return j.token;
}
async function tx(c, signers, ixs, payer = signers[0]) {
  const t = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), ...ixs);
  t.feePayer = payer.publicKey;
  t.recentBlockhash = (await c.getLatestBlockhash('confirmed')).blockhash;
  t.sign(...signers);
  return t;
}
async function send(c, signers, ixs, label) {
  const t = await tx(c, signers, ixs);
  const sig = await c.sendRawTransaction(t.serialize(), { skipPreflight: true });
  for (let i = 0; i < 200; i++) {
    const st = (await c.getSignatureStatuses([sig])).value[0];
    if (st && (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized')) {
      if (st.err) throw new Error(`${label} failed ${JSON.stringify(st.err)}`);
      return sig;
    }
    await sleep(300);
  }
  throw new Error('timeout ' + label);
}
const conn = (u) => new Connection(u, { commitment: 'confirmed' });

// ---------- setup: a throwaway player in the current season ----------
const base = conn(BASE);
const seasonPda = pda([Buffer.from('season'), u32(SEASON)]);
const poolPda = pda([Buffer.from('pool'), u32(SEASON), u16(SHARD)]);
const rankPda = pda([Buffer.from('ranking'), u32(SEASON)]);
const playerPda = pda([Buffer.from('player'), u32(SEASON), owner.publicKey.toBuffer()]);
const seasonAcc = await base.getAccountInfo(seasonPda);
const end = Number(seasonAcc.data.readBigInt64LE(8 + 32 + 4 + 8));
out.seasonEnd = new Date(end * 1000).toISOString();
if (end * 1000 < Date.now()) throw new Error('season over: ' + out.seasonEnd);
// build every instruction BEFORE any SOL moves (a bad instruction must fail here, for free)
const P0 = { owner: owner.publicKey, player: playerPda, season: seasonPda, pool: poolPda, ranking: rankPda, 'arg:season': u32(SEASON) };
const setupIxs = [
  ix('init_player', [u32(SEASON), u16(SHARD)], { owner: owner.publicKey, 'arg:season': u32(SEASON) }),
  ix('delegate_player', [u32(SEASON)], { owner: owner.publicKey, validator: VALIDATOR, 'arg:season': u32(SEASON) }),
];
for (const [n, a] of [['set_session', [session.publicKey.toBuffer(), i64(0)]], ['player_permission', [u32(SEASON)]], ['set_salt', [Buffer.alloc(8)]], ['join_pool', []], ['begin_run', []], ['pick_hero', [Buffer.from([0])]], ['act', [Buffer.from([3, 0, 0])]], ['fight', []]]) ix(n, a, P0);
ix('fight', [], { ...P0, owner: session.publicKey });
out.dry = 'all instructions built';
if (DRY) { console.log(JSON.stringify({ dry: 'ok', owner: owner.publicKey.toBase58(), player: playerPda.toBase58(), ownerBalance: await base.getBalance(owner.publicKey) })); process.exit(0); }
const have = await base.getBalance(owner.publicKey);
const need = 0.03 * LAMPORTS_PER_SOL;
const existing = await base.getAccountInfo(playerPda);
if (have < need && !existing) {
  const top = Math.min(BUDGET, need - have);
  out.funded = top / LAMPORTS_PER_SOL;
  await send(base, [admin], [SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: owner.publicKey, lamports: top })], 'fund');
}
if (!existing) await send(base, [owner], setupIxs, 'init + delegate');
const tok = { owner: await token(owner), session: await token(session), stranger: await token(stranger) };
const tee = { owner: conn(`${TEE}?token=${tok.owner}`), session: conn(`${TEE}?token=${tok.session}`), stranger: conn(`${TEE}?token=${tok.stranger}`), anon: conn(TEE) };
for (let i = 0; i < 40 && !(await tee.owner.getAccountInfo(playerPda)); i++) await sleep(1500);
const P = { owner: owner.publicKey, player: playerPda, season: seasonPda, pool: poolPda, ranking: rankPda, 'arg:season': u32(SEASON) };
await send(tee.owner, [owner], [ix('set_session', [session.publicKey.toBuffer(), i64(Math.floor(Date.now() / 1000) + 3600)], P), ix('player_permission', [u32(SEASON)], P)], 'session + permission');
await sleep(2000);
await send(tee.owner, [owner], [ix('set_salt', [crypto.randomBytes(8)], P)], 'salt');
await send(tee.owner, [owner], [ix('join_pool', [], P)], 'join_pool');
await send(tee.owner, [owner], [ix('begin_run', [], P)], 'begin_run');
await send(tee.owner, [owner], [ix('pick_hero', [Buffer.from([0])], P)], 'pick_hero');
out.setup = 'player created, delegated, session + permission (owner + session), run started';

// ---------- probes ----------
const b64 = (d) => (d ? Buffer.from(d[0], 'base64') : null);
async function reads(label, c) {
  const r = {};
  for (const [n, k] of [['player', playerPda], ['pool', poolPda], ['ranking', rankPda]]) {
    try { const a = await c.getAccountInfo(k); r[n] = a ? `visible (${a.data.length} B)` : 'null'; } catch (e) { r[n] = 'error: ' + String(e.message).slice(0, 160); }
  }
  log({ probe: 'getAccountInfo', as: label, ...r });
}
for (const [n, c] of Object.entries(tee)) await reads(n, c);

const before = Buffer.from((await tee.owner.getAccountInfo(playerPda)).data);
async function sim(label, c, signers, ixs, opt) {
  try {
    const t = await tx(c, signers.length ? signers : [owner], ixs);
    const msg = t;
    const r = await c.simulateTransaction(msg, opt?.sigVerify === false ? undefined : signers.length ? signers : undefined, { addresses: [playerPda.toBase58(), poolPda.toBase58(), rankPda.toBase58()], encoding: 'base64' });
    const v = r.value;
    const accs = (v.accounts ?? []).map((a, i) => (a ? `${['player', 'pool', 'ranking'][i]}: ${a.data ? Buffer.from(a.data[0], 'base64').length + ' B' : 'no data'}${i === 0 && a.data ? (Buffer.compare(Buffer.from(a.data[0], 'base64'), before) === 0 ? ' (unchanged)' : ' (CHANGED: post-fight state visible)') : ''}` : `${['player', 'pool', 'ranking'][i]}: null`));
    log({ probe: 'simulate', what: opt?.what, as: label, err: v.err ?? null, logs: (v.logs ?? []).slice(-6), returnData: v.returnData ?? null, units: v.unitsConsumed ?? null, accounts: accs });
  } catch (e) {
    log({ probe: 'simulate', what: opt?.what, as: label, refused: String(e.message).slice(0, 300) });
  }
}
const fightIx = () => ix('fight', [], P);
const rerollIx = () => ix('act', [Buffer.from([3, 0, 0])], P);
// member baseline: a member-only action
await sim('owner', tee.owner, [owner], [rerollIx()], { what: 'act reroll (member-only accounts)' });
// the threat: preview a fight (reads zero-member pool + ranking)
await sim('owner', tee.owner, [owner], [fightIx()], { what: 'fight, signed by owner' });
// session key signs (it may play) on the session token
const fightBySession = () => ix('fight', [], { ...P, owner: session.publicKey });
await sim('session', tee.session, [session], [fightBySession()], { what: 'fight, signed by session key' });
// a stranger without the owner's signature (sigVerify off) / no token at all
await sim('stranger', tee.stranger, [], [fightIx()], { what: 'fight, unsigned (sigVerify false)', sigVerify: false });
await sim('anon', tee.anon, [], [fightIx()], { what: 'fight, unsigned, no token', sigVerify: false });
// a committed fight: who can read its logs?
let sig = null;
try { sig = await send(tee.owner, [owner], [fightIx()], 'fight'); } catch (e) { log({ probe: 'send fight', err: String(e.message).slice(0, 200) }); }
if (sig) {
  await sleep(2000);
  for (const [n, c] of Object.entries(tee)) {
    try { const t = await c.getTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' }); log({ probe: 'getTransaction(fight)', as: n, result: t ? `visible, ${t.meta?.logMessages?.length ?? 0} log lines` : 'null' }); }
    catch (e) { log({ probe: 'getTransaction(fight)', as: n, error: String(e.message).slice(0, 160) }); }
  }
}
console.log(JSON.stringify(out, null, 1));
