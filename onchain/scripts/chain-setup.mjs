// Local on-chain mode for the real UI (sim v22): creates a season (7 days) with its committed season secret, the
// ranking and pool shard 0 on a LOCAL validator running mochi-game built with `--features local`, and writes
//   src/client/public/chain-local.json   (rpc, program, season, shard) for the UI (`?chain=1&net=local`)
//   onchain/.local-season.json           (admin key + season) for local-vrf.mjs, which answers the randomness
// Run from arena-game-jj:  node onchain/scripts/chain-setup.mjs [program] [rpc]
import fs from 'node:fs';
import crypto from 'node:crypto';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, sendAndConfirmTransaction } from '@solana/web3.js';

const [programId = '7yVgjzySuXwBeRJ18ZhunetqBz8ZTBNGiQVkw1or7w2r', rpc = 'http://127.0.0.1:18899'] = process.argv.slice(2);
const PROGRAM = new PublicKey(programId);
const c = new Connection(rpc, 'confirmed');
const admin = Keypair.generate();
const sha = (...x) => crypto.createHash('sha256').update(Buffer.concat(x.map((y) => Buffer.from(y)))).digest();
const disc = (n) => sha('global:' + n).subarray(0, 8);
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const i64 = (n) => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return b; };
const pda = (s) => PublicKey.findProgramAddressSync(s, PROGRAM)[0];
const season = Math.floor(Math.random() * 4e9) + 1, shard = 0;
const W = (pubkey, isSigner = false) => ({ pubkey, isSigner, isWritable: true });
const R = (pubkey) => ({ pubkey, isSigner: false, isWritable: false });
const send = (name, data, keys) => sendAndConfirmTransaction(c, new Transaction().add(new TransactionInstruction({ programId: PROGRAM, keys, data: Buffer.concat([disc(name), ...data]) })), [admin]);
await c.confirmTransaction(await c.requestAirdrop(admin.publicKey, 10e9), 'confirmed');
const now = Math.floor(Date.now() / 1000);
const sys = R(SystemProgram.programId);
const seasonPda = pda([Buffer.from('season'), u32(season)]), ssPda = pda([Buffer.from('season_secret'), u32(season)]);
const seasonSecret = crypto.randomBytes(32);
await send('init_season', [u32(season), i64(now - 3600), i64(now + 7 * 86400), sha(seasonSecret)], [W(admin.publicKey, true), W(seasonPda), sys]);
await send('init_season_secret', [u32(season)], [W(admin.publicKey, true), R(seasonPda), W(ssPda), sys]);
await send('set_season_secret', [seasonSecret], [W(admin.publicKey, true), R(seasonPda), W(ssPda)]);
await send('init_ranking', [u32(season)], [W(admin.publicKey, true), W(pda([Buffer.from('ranking'), u32(season)])), sys]);
await send('init_pool', [u32(season), u16(shard)], [W(admin.publicKey, true), W(pda([Buffer.from('pool'), u32(season), u16(shard)])), sys]);
const cfgPath = new URL('../../src/client/public/chain-local.json', import.meta.url);
fs.writeFileSync(cfgPath, JSON.stringify({ mode: 'local', rpc, program: programId, season, shard }, null, 2) + '\n');
fs.writeFileSync(new URL('../.local-season.json', import.meta.url), JSON.stringify({ rpc, program: programId, season, shard, admin: [...admin.secretKey] }));
console.log('season', season, 'ready · wrote', cfgPath.pathname, '+ onchain/.local-season.json · now run: node onchain/scripts/local-vrf.mjs');
