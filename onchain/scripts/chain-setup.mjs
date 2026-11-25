// Local on-chain mode for the real UI: creates a season (7 days), its ranking and pool shard 0 on the local
// validator, and writes arena-game-jj/src/client/public/chain.json (rpc, program, season, discriminators).
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, sendAndConfirmTransaction } from '@solana/web3.js';
const [programId, rpc, out] = process.argv.slice(2);
const PROGRAM = new PublicKey(programId);
const c = new Connection(rpc, 'confirmed');
const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(`${os.homedir()}/.config/solana/id.json`))));
const disc = (n) => crypto.createHash('sha256').update('global:' + n).digest().subarray(0, 8);
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const i64 = (n) => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return b; };
const pda = (s) => PublicKey.findProgramAddressSync(s, PROGRAM)[0];
const season = Math.floor(Math.random() * 4e9) + 1, shard = 0;
const W = (pubkey, isSigner = false) => ({ pubkey, isSigner, isWritable: true });
const send = (name, data, keys) => sendAndConfirmTransaction(c, new Transaction().add(new TransactionInstruction({ programId: PROGRAM, keys, data: Buffer.concat([disc(name), ...data]) })), [admin]);
if ((await c.getBalance(admin.publicKey)) < 1e9) await c.confirmTransaction(await c.requestAirdrop(admin.publicKey, 10e9), 'confirmed');
const now = Math.floor(Date.now() / 1000);
const sys = { pubkey: SystemProgram.programId, isSigner: false, isWritable: false };
await send('init_season', [u32(season), i64(now - 3600), i64(now + 7 * 86400)], [W(admin.publicKey, true), W(pda([Buffer.from('season'), u32(season)])), sys]);
await send('init_ranking', [u32(season)], [W(admin.publicKey, true), W(pda([Buffer.from('ranking'), u32(season)])), sys]);
await send('init_pool', [u32(season), u16(shard)], [W(admin.publicKey, true), W(pda([Buffer.from('pool'), u32(season), u16(shard)])), sys]);
const names = ['init_player', 'set_salt', 'begin_run', 'pick_hero', 'act', 'act_batch', 'fight', 'finish_run', 'set_session', 'player_permission', 'delegate_player', 'join_pool', 'revoke_session'];
const cfg = { mode: 'local', rpc: 'http://127.0.0.1:18899', program: programId, season, shard, disc: Object.fromEntries(names.map((n) => [n, disc(n).toString('hex')])) };
fs.writeFileSync(out, JSON.stringify(cfg, null, 2));
console.log('season', season, 'ready · wrote', out);
