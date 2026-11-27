// Follow-up to tee-sim-probe.mjs (READ-ONLY: queries and simulations, no transaction is sent, no SOL is spent).
// Same throwaway player (PROBE_KEYS). Looks at:
//  - getSignaturesForAddress(player) and the full getTransaction of the player's transactions, per caller:
//    which fields are visible (message accounts / instruction data, meta: err, logs, balances, CU, inner ixs, return)
//  - a stranger / anon simulating a member-only action (act) of the player, without the owner's signature
//  - simulation option variants for the owner (sigVerify off + replaceRecentBlockhash) of the fight
//   PROBE_KEYS=<file> node onchain/scripts/tee-sim-probe2.mjs > onchain/docs/tee-sim-probe2.json
import fs from 'node:fs';
import crypto from 'node:crypto';
import bs58 from 'bs58';
import { ed25519 } from '@noble/curves/ed25519';
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, ComputeBudgetProgram } from '@solana/web3.js';

const cfg = JSON.parse(fs.readFileSync(new URL('../../src/web/public/chain.json', import.meta.url)));
const TEE = 'https://devnet-tee.magicblock.app';
const PROGRAM = new PublicKey(cfg.program);
const SEASON = cfg.season, SHARD = cfg.shard;
const k = JSON.parse(fs.readFileSync(process.env.PROBE_KEYS, 'utf8'));
const owner = Keypair.fromSecretKey(Uint8Array.from(k.owner)), session = Keypair.fromSecretKey(Uint8Array.from(k.session)), stranger = Keypair.fromSecretKey(Uint8Array.from(k.stranger));
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
const disc = (n) => crypto.createHash('sha256').update('global:' + n).digest().subarray(0, 8);
const pda = (s) => PublicKey.findProgramAddressSync(s, PROGRAM)[0];
const playerPda = pda([Buffer.from('player'), u32(SEASON), owner.publicKey.toBuffer()]);
const seasonPda = pda([Buffer.from('season'), u32(SEASON)]), poolPda = pda([Buffer.from('pool'), u32(SEASON), u16(SHARD)]), rankPda = pda([Buffer.from('ranking'), u32(SEASON)]);
async function token(kp) {
  const ch = await (await fetch(`${TEE}/auth/challenge?pubkey=${kp.publicKey.toBase58()}`)).json();
  const sig = ed25519.sign(Buffer.from(ch.challenge, 'utf-8'), kp.secretKey.subarray(0, 32));
  return (await (await fetch(`${TEE}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pubkey: kp.publicKey.toBase58(), challenge: ch.challenge, signature: bs58.encode(sig) }) })).json()).token;
}
const url = { owner: `${TEE}?token=${await token(owner)}`, session: `${TEE}?token=${await token(session)}`, stranger: `${TEE}?token=${await token(stranger)}`, anon: TEE };
const rpc = async (u, method, params) => (await (await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json());
const out = { at: new Date().toISOString(), player: playerPda.toBase58(), probes: [] };
const log = (x) => { out.probes.push(x); console.error(JSON.stringify(x).slice(0, 500)); };

// 1. signatures + transaction contents per caller
const sigsOwner = await rpc(url.owner, 'getSignaturesForAddress', [playerPda.toBase58(), { limit: 20 }]);
const sigs = (sigsOwner.result ?? []).map((x) => x.signature);
for (const [who, u] of Object.entries(url)) {
  const s = await rpc(u, 'getSignaturesForAddress', [playerPda.toBase58(), { limit: 20 }]);
  log({ probe: 'getSignaturesForAddress(player)', as: who, result: s.error ? `error: ${s.error.message}` : `${s.result.length} signatures` });
}
for (const sig of sigs.slice(0, 3)) {
  for (const [who, u] of Object.entries(url)) {
    const t = await rpc(u, 'getTransaction', [sig, { encoding: 'json', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }]);
    const r = t.result;
    if (t.error || !r) { log({ probe: 'getTransaction', sig: sig.slice(0, 8), as: who, result: t.error ? `error: ${t.error.message}` : 'null' }); continue; }
    const m = r.transaction?.message ?? {};
    const ixs = (m.instructions ?? []).map((i) => ({ program: m.accountKeys?.[i.programIdIndex]?.slice(0, 6), data: i.data ? bs58.decode(i.data).subarray(0, 12).toString('hex') : '' }));
    log({
      probe: 'getTransaction', sig: sig.slice(0, 8), as: who,
      accountKeys: (m.accountKeys ?? []).length, instructions: ixs,
      meta: r.meta ? { err: r.meta.err, logs: (r.meta.logMessages ?? []).length, preBalances: (r.meta.preBalances ?? []).length, cu: r.meta.computeUnitsConsumed ?? null, inner: (r.meta.innerInstructions ?? []).length, returnData: r.meta.returnData ?? null } : null,
    });
  }
}
// 2. simulations without the owner's signature, of a member-only action and of the fight
async function sim(who, ixs, label) {
  const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), ...ixs);
  tx.feePayer = owner.publicKey;
  tx.recentBlockhash = '11111111111111111111111111111111';
  const raw = tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64');
  const r = await rpc(url[who], 'simulateTransaction', [raw, { encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, accounts: { encoding: 'base64', addresses: [playerPda.toBase58(), poolPda.toBase58()] } }]);
  const v = r.result?.value;
  log({ probe: 'simulate', what: label, as: who, error: r.error?.message ?? null, err: v?.err ?? null, logs: (v?.logs ?? []).slice(-4), units: v?.unitsConsumed ?? null, returnData: v?.returnData ?? null, accounts: (v?.accounts ?? []).map((a) => (a ? `${Buffer.from(a.data[0], 'base64').length} B` : 'null')) });
}
const ixAct = new TransactionInstruction({ programId: PROGRAM, keys: [{ pubkey: owner.publicKey, isSigner: true, isWritable: false }, { pubkey: playerPda, isSigner: false, isWritable: true }, { pubkey: seasonPda, isSigner: false, isWritable: false }], data: Buffer.concat([disc('act'), Buffer.from([4, 0, 0])]) });
const ixFight = new TransactionInstruction({ programId: PROGRAM, keys: [{ pubkey: owner.publicKey, isSigner: true, isWritable: false }, { pubkey: playerPda, isSigner: false, isWritable: true }, { pubkey: poolPda, isSigner: false, isWritable: true }, { pubkey: rankPda, isSigner: false, isWritable: true }, { pubkey: seasonPda, isSigner: false, isWritable: false }], data: disc('fight') });
for (const who of ['owner', 'session', 'stranger', 'anon']) await sim(who, [ixAct], 'act lock (member-only accounts), owner signature NOT given (sigVerify off)');
for (const who of ['owner', 'stranger', 'anon']) await sim(who, [ixFight], 'fight (reads zero-member pool + ranking), sigVerify off');
console.log(JSON.stringify(out, null, 1));
