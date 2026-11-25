// LOCAL VALIDATOR ONLY: stands in for the MagicBlock VRF oracle for mochi-game built with `--features local`.
// Polls every Player account of the local season (onchain/.local-season.json from chain-setup.mjs) and answers
//   - a run start waiting for randomness (status WAIT_VRF)  → local_vrf(random 32 bytes, run_no)
//   - a pending action request (pend_state 1)                → local_apply(random 32 bytes, req)
// with fresh crypto randomness, signed by the season admin. On devnet / mainnet the VRF program does this.
//   node onchain/scripts/local-vrf.mjs [--once]
import fs from 'node:fs';
import crypto from 'node:crypto';
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, ComputeBudgetProgram } from '@solana/web3.js';

const cfg = JSON.parse(fs.readFileSync(new URL('../.local-season.json', import.meta.url)));
const PROGRAM = new PublicKey(cfg.program);
const c = new Connection(cfg.rpc, 'confirmed');
const admin = Keypair.fromSecretKey(Uint8Array.from(cfg.admin));
const once = process.argv.includes('--once');
const disc = (n) => crypto.createHash('sha256').update('global:' + n).digest().subarray(0, 8);
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const pda = (s) => PublicKey.findProgramAddressSync(s, PROGRAM)[0];
const season = pda([Buffer.from('season'), u32(cfg.season)]), ss = pda([Buffer.from('season_secret'), u32(cfg.season)]);
const pool = pda([Buffer.from('pool'), u32(cfg.season), u16(cfg.shard)]), rank = pda([Buffer.from('ranking'), u32(cfg.season)]);
const W = (pubkey, isSigner = false) => ({ pubkey, isSigner, isWritable: true });
const R = (pubkey, isSigner = false) => ({ pubkey, isSigner, isWritable: false });
// Player layout 4 (+8 discriminator): see programs/mochi-game Player
const OFF = { owner: 8 + 40, season: 8 + 204, runNo: 8 + 208, pendReq: 8 + 236, status: 8 + 253, pendState: 8 + 263 };
const PLAYER_DISC = crypto.createHash('sha256').update('account:Player').digest().subarray(0, 8);
async function send(name, data, keys) {
  const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), new TransactionInstruction({ programId: PROGRAM, keys, data: Buffer.concat([disc(name), ...data]) }));
  tx.feePayer = admin.publicKey;
  tx.recentBlockhash = (await c.getLatestBlockhash()).blockhash;
  tx.sign(admin);
  const sig = await c.sendRawTransaction(tx.serialize(), { skipPreflight: true });
  return c.confirmTransaction(sig, 'confirmed');
}
const answered = new Set();
console.log('local VRF responder for season', cfg.season, '· admin', admin.publicKey.toBase58());
for (;;) {
  const accs = await c.getProgramAccounts(PROGRAM, { filters: [{ memcmp: { offset: 0, bytes: PLAYER_DISC.toString('base64'), encoding: 'base64' } }] }).catch(() => []);
  for (const { pubkey, account } of accs) {
    const d = account.data;
    if (d.readUInt32LE(OFF.season) !== cfg.season) continue;
    const owner = new PublicKey(d.subarray(OFF.owner, OFF.owner + 32));
    const sec = pda([Buffer.from('secret'), u32(cfg.season), owner.toBuffer()]);
    if (d[OFF.status] === 5) {
      const key = `run:${pubkey}:${d.readUInt32LE(OFF.runNo)}`;
      if (answered.has(key)) continue;
      answered.add(key);
      await send('local_vrf', [crypto.randomBytes(32), u32(d.readUInt32LE(OFF.runNo))], [W(admin.publicKey, true), R(season), W(pubkey), W(sec), R(ss)]).then(() => console.log('answered run start', key)).catch((e) => console.error(key, e.message));
    } else if (d[OFF.pendState] === 1) {
      const key = `req:${pubkey}:${d.readUInt32LE(OFF.pendReq)}`;
      if (answered.has(key)) continue;
      answered.add(key);
      await send('local_apply', [crypto.randomBytes(32), u32(d.readUInt32LE(OFF.pendReq))], [R(admin.publicKey, true), R(season), W(pubkey), W(sec), W(pool), W(rank)]).then(() => console.log('answered request', key)).catch((e) => console.error(key, e.message));
    }
  }
  if (once) break;
  await new Promise((r) => setTimeout(r, 300));
}
