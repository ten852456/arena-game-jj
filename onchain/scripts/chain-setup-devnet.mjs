// Devnet + MagicBlock TEE season for the real UI's on-chain mode: Season (7 days), Ranking + Pool shard 0 on Solana,
// delegated to the TEE validator and made private to nobody. Writes chain.json (mode 'tee') for the client.
//   node chain-setup-devnet.mjs <out chain.json>
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import anchor from '@coral-xyz/anchor';
import { ComputeBudgetProgram, Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import * as er from '@magicblock-labs/ephemeral-rollups-sdk';
import nacl from 'tweetnacl';

const out = process.argv[2];
const idl = JSON.parse(fs.readFileSync(new URL('../idl/mochi_game.json', import.meta.url)));
const PROGRAM_ID = new PublicKey(idl.address);
const BASE = 'https://api.devnet.solana.com', TEE = 'https://devnet-tee.magicblock.app';
const VALIDATOR = 'MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo';
const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(`${os.homedir()}/.config/solana/id.json`))));
const SEASON = Math.floor(Math.random() * 4e9) + 1, SHARD = 0;
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
const pda = (s) => PublicKey.findProgramAddressSync(s, PROGRAM_ID)[0];
const seasonPda = pda([Buffer.from('season'), u32(SEASON)]), rankPda = pda([Buffer.from('ranking'), u32(SEASON)]), poolPda = pda([Buffer.from('pool'), u32(SEASON), u16(SHARD)]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { token } = await er.getAuthToken(TEE, admin.publicKey, (m) => Promise.resolve(nacl.sign.detached(m, admin.secretKey)));
const base = new Connection(BASE, 'confirmed'), tee = new Connection(`${TEE}?token=${token}`, 'confirmed');
const P = (c) => new anchor.Program(idl, new anchor.AnchorProvider(c, new anchor.Wallet(admin), { commitment: 'confirmed' }));
async function rpc(fn) { for (let i = 0; ; i++) { try { return await fn(); } catch (e) { if (i > 15 || !/429|Too Many|fetch failed/.test(String(e))) throw e; await sleep(1500 * (i + 1)); } } }
async function send(c, ixs) { return rpc(() => send1(c, ixs)); }
async function send1(c, ixs) {
  const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), ...ixs);
  tx.feePayer = admin.publicKey; tx.recentBlockhash = (await c.getLatestBlockhash('confirmed')).blockhash; tx.sign(admin);
  const sig = await c.sendRawTransaction(tx.serialize(), { skipPreflight: true });
  for (let i = 0; i < 300; i++) { const st = (await rpc(() => c.getSignatureStatuses([sig]))).value[0]; if (st?.err) throw new Error(JSON.stringify(st.err)); if (st && st.confirmationStatus !== 'processed') return sig; await sleep(150); }
  throw new Error('timeout');
}
const now = Math.floor(Date.now() / 1000);
const B = P(base), T = P(tee);
await send(base, [await B.methods.initSeason(SEASON, new anchor.BN(now - 600), new anchor.BN(now + 7 * 86400)).accountsPartial({ admin: admin.publicKey, season: seasonPda }).instruction()]);
await send(base, [await B.methods.initRanking(SEASON).accountsPartial({ admin: admin.publicKey, ranking: rankPda }).instruction(), await B.methods.initPool(SEASON, SHARD).accountsPartial({ admin: admin.publicKey, pool: poolPda }).instruction()]);
await send(base, [
  await B.methods.delegateRanking(SEASON).accountsPartial({ admin: admin.publicKey, ranking: rankPda, validator: new PublicKey(VALIDATOR) }).instruction(),
  await B.methods.delegatePool(SEASON, SHARD).accountsPartial({ admin: admin.publicKey, pool: poolPda, validator: new PublicKey(VALIDATOR) }).instruction(),
]);
for (let i = 0; ; i++) {
  try {
    await send(tee, [
      await T.methods.rankingPermission(SEASON).accountsPartial({ admin: admin.publicKey, ranking: rankPda, permission: er.permissionPdaFromAccount(rankPda) }).instruction(),
      await T.methods.poolPermission(SEASON, SHARD).accountsPartial({ admin: admin.publicKey, pool: poolPda, permission: er.permissionPdaFromAccount(poolPda) }).instruction(),
    ]);
    break;
  } catch (e) { if (i > 30) throw e; await sleep(3000); }
}
const disc = (n) => crypto.createHash('sha256').update('global:' + n).digest().subarray(0, 8).toString('hex');
const names = ['init_player', 'set_salt', 'begin_run', 'pick_hero', 'act', 'act_batch', 'fight', 'finish_run', 'set_session', 'player_permission', 'delegate_player', 'join_pool', 'revoke_session'];
fs.writeFileSync(out, JSON.stringify({ mode: 'tee', rpc: BASE, tee: '/tee', validator: VALIDATOR, program: PROGRAM_ID.toBase58(), season: SEASON, shard: SHARD, disc: Object.fromEntries(names.map((n) => [n, disc(n)])) }, null, 2));
console.log('devnet season', SEASON, 'ready (ranking + pool delegated and private) · wrote', out);
