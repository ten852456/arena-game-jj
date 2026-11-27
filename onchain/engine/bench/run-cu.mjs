// CU of every run action on SBF (local test validator + programs/fight-bench): replays recorded runs action by
// action (each call gets the previous call's state), checks accepted + the full state hash against the TS reference,
// and reports CU per action kind (minus a same-size no-op baseline).
//   node onchain/engine/bench/run-cu.mjs <runs.txt> [runs=40] [rpc=http://127.0.0.1:18899] > out.json
import fs from 'node:fs';
import crypto from 'node:crypto';
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, ComputeBudgetProgram } from '@solana/web3.js';

const [runsFile, nStr, rpc] = process.argv.slice(2);
const PROGRAM = new PublicKey('CZj1wwBSAD7eExpKF8JayMzW73WqYdAYCyKpW5MFxriA');
const c = new Connection(rpc ?? 'http://127.0.0.1:18899', 'confirmed');
const payer = Keypair.generate();
const SZ = 184, BYTES = 93, BUILD_LEN = 94;
const NAMES = ['buy', 'sell', 'move', 'reroll', 'lock', 'slot', 'wish', 'lastchance', 'mark', 'concede', 'fight', 'relic', 'relicReroll'];
const ARGS = [2, 1, 2, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0];
const disc = (n) => crypto.createHash('sha256').update(`global:${n}`).digest().subarray(0, 8);
const toBytes = (v) => Buffer.from([v[0], v[1], v[3], v[4], v[5], ...v.slice(6, 6 + 88)]);

/** RunState bytes → the run-gen.mts encodeState vector (repr(C) layout of run.rs) */
function encode(b) {
  const u8 = (o) => b[o], i8 = (o) => b.readInt8(o);
  const o = [u8(10), b.readUInt32LE(0), u8(11), b.readInt16LE(4), u8(12), u8(13), b.readUInt16LE(6), i8(14), u8(15), u8(16), u8(17), u8(18),
    b.readUInt16LE(8), u8(19), u8(20), u8(21), u8(22), u8(23), u8(24), u8(25)];
  for (let i = 0; i < 5; i++) o.push(u8(26 + i));
  for (let i = 0; i < 3; i++) o.push(u8(31 + i));
  for (let i = 0; i < 3; i++) o.push(u8(34 + i));
  o.push(u8(37), u8(38));
  const n = u8(25);
  for (let i = 0; i < 8; i++) { const p = 41 + 11 * i; for (let k = 0; k < 11; k++) o.push(i < n ? u8(p + k) : 0); }
  for (let i = 0; i < 5; i++) { const p = 129 + 11 * i; const present = u8(p); for (let k = 0; k < 11; k++) o.push(present ? u8(p + k) : 0); }
  return o;
}
const hashOf = (xs) => { let h = 2166136261; for (const x of xs) { h = Math.imul(h ^ (x >>> 0), 16777619) >>> 0; h = Math.imul(h ^ (Math.floor(x / 4294967296) >>> 0), 16777619) >>> 0; } return h; };

async function call(data) {
  const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), new TransactionInstruction({ programId: PROGRAM, keys: [], data }));
  tx.feePayer = payer.publicKey;
  tx.recentBlockhash = (await c.getLatestBlockhash()).blockhash;
  tx.sign(payer);
  const r = await c.simulateTransaction(tx, undefined, false);
  if (r.value.err) throw new Error(JSON.stringify(r.value.err) + ' ' + (r.value.logs ?? []).slice(-3).join(' | '));
  return { cu: r.value.unitsConsumed, ret: Buffer.from(r.value.returnData.data[0], 'base64') };
}
function stepData(name, state, code, a, b, seed, secret, opp) {
  const d = Buffer.alloc(8 + SZ + 1 + 1 + 1 + 4 + 4 + 1 + BYTES);
  disc(name).copy(d);
  state.copy(d, 8);
  let p = 8 + SZ;
  d.writeUInt8(code, p++); d.writeInt8(a, p++); d.writeInt8(b, p++);
  d.writeUInt32LE(seed >>> 0, p); p += 4;
  d.writeUInt32LE((secret ?? 0) >>> 0, p); p += 4;
  d.writeUInt8(secret === undefined ? 0 : 1, p++);
  (opp ?? Buffer.alloc(BYTES)).copy(d, p);
  return d;
}

await c.confirmTransaction(await c.requestAirdrop(payer.publicKey, 1e9), 'confirmed');
const lines = fs.readFileSync(runsFile, 'utf8').trim().split('\n');
const N = Number(nStr ?? 40);
const byCode = NAMES.map(() => []);
let mismatch = 0, actions = 0, base = null, newCu = [];
// player runs only (even lines): half offline, half on-chain (secret)
for (let li = 0; li < lines.length && li / 2 < N; li += 2) {
  const [head, rest] = lines[li].split(' | ');
  const h = head.split(' ').map(Number);
  const [seed, sec, hero] = [h[0], h[1] < 0 ? undefined : h[1], h[5]];
  const t = rest.split(' ').map(Number);
  const nd = Buffer.alloc(8 + 1 + 4 + 4 + 1);
  disc('run_new').copy(nd); nd.writeUInt8(hero, 8); nd.writeUInt32LE(seed >>> 0, 9); nd.writeUInt32LE((sec ?? 0) >>> 0, 13); nd.writeUInt8(sec === undefined ? 0 : 1, 17);
  const r0 = await call(nd);
  newCu.push(r0.cu);
  let state = r0.ret;
  if (hashOf(encode(state)) !== t[0]) mismatch++;
  let p = 1;
  while (p < t.length) {
    const code = t[p++];
    const args = t.slice(p, p + ARGS[code]); p += ARGS[code];
    let opp, fseed = 0, a = 0, b = 0;
    if (code === 10) { fseed = args[0]; opp = toBytes(t.slice(p, p + BUILD_LEN)); p += BUILD_LEN; }
    else { a = args[0] ?? 0; b = args[1] ?? 0; }
    const [wantOk, wantH] = [t[p], t[p + 1]]; p += 2;
    if (base === null) base = (await call(stepData('run_noop', state, code, a, b, fseed, sec, opp))).cu;
    const r = await call(stepData('run_step', state, code, a, b, fseed, sec, opp));
    const ok = r.ret[0] === 1;
    state = r.ret.subarray(1);
    actions++;
    if (ok !== (wantOk === 1) || hashOf(encode(state)) !== wantH) { mismatch++; break; }
    byCode[code].push(r.cu - base);
  }
}
const stat = (xs) => { const s = [...xs].sort((x, y) => x - y); return s.length ? { n: s.length, mean: Math.round(s.reduce((x, y) => x + y, 0) / s.length), p95: s[Math.floor(s.length * 0.95)], max: s[s.length - 1] } : { n: 0 }; };
console.log(JSON.stringify({ baselineCU: base, actions, mismatch, runNew: stat(newCu), byAction: Object.fromEntries(NAMES.map((n, i) => [n, stat(byCode[i])])) }, null, 1));
