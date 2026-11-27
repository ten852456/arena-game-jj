// CU of real sim v22 fights on SBF (local test validator + programs/fight-bench, simulateTransaction).
// Sample: up to PER_DAY parity cases per day 1–20 + the 25 longest × biggest. Checks the on-chain winner and length
// against the TS reference in the case file too.
//   node onchain/engine/bench/fight-cu.mjs <cases.txt> [perDay=20 | all] [rpc=http://127.0.0.1:18899] > out.json
import fs from 'node:fs';
import crypto from 'node:crypto';
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, ComputeBudgetProgram } from '@solana/web3.js';

const [casesFile, perDayStr, rpc] = process.argv.slice(2);
const PROGRAM = new PublicKey('CZj1wwBSAD7eExpKF8JayMzW73WqYdAYCyKpW5MFxriA');
const c = new Connection(rpc ?? 'http://127.0.0.1:18899', 'confirmed');
const payer = Keypair.generate();
const BYTES = 93;
const disc = (n) => crypto.createHash('sha256').update(`global:${n}`).digest().subarray(0, 8);
// case encoding: hero, n, nrel, relics[3], 8 × 11 → bytes: hero, n, relics[3], 8 × 11
const toBytes = (v) => Buffer.from([v[0], v[1], v[3], v[4], v[5], ...v.slice(6, 6 + 88)]);
const cases = fs.readFileSync(casesFile, 'utf8').trim().split('\n').map((l, i) => {
  const [h, a, b] = l.split(' | ');
  const [day, seed, winner, ticks] = h.split(' ').map(Number);
  const A = a.split(' ').map(Number), B = b.split(' ').map(Number);
  return { i, day, seed, winner, ticks, A, B, blocks: A[1] + B[1], chaos: i % 2 === 1 };
});

async function run(name, k) {
  const data = Buffer.alloc(8 + 1 + 4 + 2 * BYTES);
  disc(name).copy(data);
  data.writeUInt8(k.day, 8);
  data.writeUInt32LE(k.seed >>> 0, 9);
  toBytes(k.A).copy(data, 13);
  toBytes(k.B).copy(data, 13 + BYTES);
  const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), new TransactionInstruction({ programId: PROGRAM, keys: [], data }));
  tx.feePayer = payer.publicKey;
  tx.recentBlockhash = (await c.getLatestBlockhash()).blockhash;
  tx.sign(payer);
  const r = await c.simulateTransaction(tx, undefined, false);
  if (r.value.err) return { err: JSON.stringify(r.value.err), logs: r.value.logs?.slice(-3) };
  const ret = Buffer.from(r.value.returnData.data[0], 'base64').readBigUInt64LE(0);
  return { cu: r.value.unitsConsumed, winner: Number(ret >> 32n) - 1, ticks: Number(ret & 0xffffffffn) };
}

await c.confirmTransaction(await c.requestAirdrop(payer.publicKey, 1e9), 'confirmed');
// perDay 'all': every case of the file (worst-case search output)
const perDay = perDayStr === 'all' ? Infinity : Number(perDayStr ?? 20);
const pick = [];
if (perDay === Infinity) pick.push(...cases);
else {
  for (let d = 1; d <= 20; d++) pick.push(...cases.filter((k) => k.day === d).slice(0, perDay));
  const worst = [...cases].sort((x, y) => y.ticks * y.blocks - x.ticks * x.blocks).slice(0, 25);
  pick.push(...worst.filter((w) => !pick.includes(w)));
}
const base = (await run('noop', pick[0])).cu;
const rows = [];
let mismatch = 0, errors = 0;
for (const k of pick) {
  const r = await run('fight', k);
  if (r.err) { errors++; if (errors < 4) console.error('ERR case', k.i, r.err, r.logs); continue; }
  if (r.winner !== k.winner || r.ticks !== k.ticks) mismatch++;
  rows.push({ i: k.i, day: k.day, chaos: k.chaos, ticks: k.ticks, blocks: k.blocks, cu: r.cu - base });
}
const stat = (xs) => { const s = [...xs].sort((a, b) => a - b); return { n: s.length, mean: Math.round(s.reduce((a, b) => a + b, 0) / (s.length || 1)), p50: s[Math.floor(s.length / 2)], p95: s[Math.floor(s.length * 0.95)], max: s[s.length - 1] }; };
const bot = rows.filter((r) => !r.chaos), chaos = rows.filter((r) => r.chaos);
const byDay = {};
for (const r of bot) (byDay[r.day] ??= []).push(r.cu);
const out = {
  baselineCU: base, fights: rows.length, errors, mismatch,
  bot: stat(bot.map((r) => r.cu)), chaos: stat(chaos.map((r) => r.cu)),
  botByDay: Object.fromEntries(Object.entries(byDay).map(([d, xs]) => [d, stat(xs)])),
  top: [...rows].sort((a, b) => b.cu - a.cu).slice(0, 5),
};
console.log(JSON.stringify(out, null, 1));
