// Session-key tests for mochi-game on the local validator: owner approves a browser key once; the key can play
// but not manage sessions; strangers, expired and revoked keys are rejected; the state never changes on a rejection.
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, ComputeBudgetProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
const [programId] = process.argv.slice(2);
const PROGRAM = new PublicKey(programId);
const c = new Connection('http://127.0.0.1:18899', 'confirmed');
const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(`${os.homedir()}/.config/solana/id.json`))));
const disc = (n) => crypto.createHash('sha256').update('global:' + n).digest().subarray(0, 8);
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const i64 = (n) => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return b; };
const pda = (s) => PublicKey.findProgramAddressSync(s, PROGRAM)[0];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = (pubkey, isSigner = false) => ({ pubkey, isSigner, isWritable: true });
const R = (pubkey, isSigner = false) => ({ pubkey, isSigner, isWritable: false });
const sys = R(SystemProgram.programId);
const ix = (name, data, keys) => new TransactionInstruction({ programId: PROGRAM, keys, data: Buffer.concat([disc(name), ...data]) });
async function send(ixs, signers) {
  const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), ...ixs);
  tx.feePayer = signers[0].publicKey; tx.recentBlockhash = (await c.getLatestBlockhash()).blockhash; tx.sign(...signers);
  const sig = await c.sendRawTransaction(tx.serialize(), { skipPreflight: true });
  for (let i = 0; i < 200; i++) {
    const st = (await c.getSignatureStatuses([sig])).value[0];
    if (st && (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized')) return !st.err;
    await sleep(40);
  }
  throw new Error('timeout');
}
for (let i = 0; i < 60; i++) { try { await c.getVersion(); break; } catch { await sleep(1000); } }
const owner = Keypair.generate(), session = Keypair.generate(), stranger = Keypair.generate();
for (const k of [admin, owner, session, stranger]) await c.confirmTransaction(await c.requestAirdrop(k.publicKey, 5 * LAMPORTS_PER_SOL), 'confirmed');
const season = Math.floor(Math.random() * 4e9) + 1, now = () => Math.floor(Date.now() / 1000);
const S = pda([Buffer.from('season'), u32(season)]), RK = pda([Buffer.from('ranking'), u32(season)]), PO = pda([Buffer.from('pool'), u32(season), u16(0)]);
const PL = pda([Buffer.from('player'), u32(season), owner.publicKey.toBuffer()]);
await send([ix('init_season', [u32(season), i64(now() - 3600), i64(now() + 86400)], [W(admin.publicKey, true), W(S), sys])], [admin]);
await send([ix('init_ranking', [u32(season)], [W(admin.publicKey, true), W(RK), sys])], [admin]);
await send([ix('init_pool', [u32(season), u16(0)], [W(admin.publicKey, true), W(PO), sys])], [admin]);
await send([ix('init_player', [u32(season), u16(0)], [W(owner.publicKey, true), W(PL), sys]), ix('join_pool', [], [R(owner.publicKey, true), W(PL), W(PO)])], [owner]);
const keysP = (k) => [R(k.publicKey, true), W(PL), R(S)];
const keysF = (k) => [R(k.publicKey, true), W(PL), W(PO), W(RK), R(S)];
const keysO = (k) => [R(k.publicKey, true), W(PL)];
const state = async () => (await c.getAccountInfo(PL)).data.toString('hex');
const tests = [];
async function expect(name, ok, ixs, signers) {
  const before = await state();
  const r = await send(ixs, signers);
  const after = await state();
  tests.push({ test: name, expected: ok ? 'accept' : 'reject', got: r ? 'accept' : 'reject', pass: r === ok && (ok || before === after) });
}
await expect('session plays before the owner approved it', false, [ix('set_salt', [i64(1)], keysP(session))], [session]);
await expect('stranger approves a session for this account', false, [ix('set_session', [session.publicKey.toBuffer(), i64(now() + 3600)], keysO(stranger))], [stranger]);
await expect('owner approves a session longer than 7 days', false, [ix('set_session', [session.publicKey.toBuffer(), i64(now() + 8 * 86400)], keysO(owner))], [owner]);
await expect('owner approves the session (1 h)', true, [ix('set_session', [session.publicKey.toBuffer(), i64(now() + 3600)], keysO(owner))], [owner]);
await expect('session approves another session (owner only)', false, [ix('set_session', [stranger.publicKey.toBuffer(), i64(now() + 3600)], keysO(session))], [session]);
await expect('session sets the salt', true, [ix('set_salt', [i64(42)], keysP(session))], [session]);
await expect('session begins a run', true, [ix('begin_run', [], keysP(session))], [session]);
await expect('session picks a hero', true, [ix('pick_hero', [Buffer.from([0])], keysP(session))], [session]);
await expect('session buys (act)', true, [ix('act', [Buffer.from([0, 0, 0])], keysP(session))], [session]);
await expect('session fights', true, [ix('fight', [], keysF(session))], [session]);
await expect('stranger acts on the account', false, [ix('act', [Buffer.from([4, 0, 0])], keysP(stranger))], [stranger]);
await expect('stranger fights on the account', false, [ix('fight', [], keysF(stranger))], [stranger]);
await expect('owner plays directly (still allowed)', true, [ix('act', [Buffer.from([4, 0, 0])], keysP(owner))], [owner]);
await expect('owner revokes the session', true, [ix('revoke_session', [], keysO(owner))], [owner]);
await expect('revoked session acts', false, [ix('act', [Buffer.from([4, 0, 0])], keysP(session))], [session]);
await expect('owner approves a session that expires in 3 s', true, [ix('set_session', [session.publicKey.toBuffer(), i64(now() + 3)], keysO(owner))], [owner]);
await sleep(6000);
await expect('expired session acts', false, [ix('act', [Buffer.from([4, 0, 0])], keysP(session))], [session]);
console.table(tests);
console.log(`session tests: ${tests.filter((t) => t.pass).length}/${tests.length} pass`);
