// mochi-game v22 end to end on a LOCAL validator (program built with feature "local": the admin answers VRF
// requests with local_vrf). Plays real runs through the program, then proves the seed lifecycle:
//  - no secret in Player while a run is going (only the commitment)
//  - at run end: commitment = H(secret, run), secret = H(vrf, season secret, owner, run)
//  - the whole run (hero choices, every shop / relic / mark / wish roll, every fight seed) is recomputed with the TS
//    sim from the revealed secret and must give the exact same state as the program
//  - a rejected action leaves the state byte-identical (no extra roll from a failed transaction)
//   npx tsx onchain/engine/bench/local-e2e.mts [rpc=http://127.0.0.1:18899]
import crypto from 'node:crypto';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, ComputeBudgetProgram, SYSVAR_SLOT_HASHES_PUBKEY } from '@solana/web3.js';
import { simulate } from '../../../src/sim/combat';
import { HEROES } from '../../../src/sim/heroes';
import { SKILL_LIST, VARIANTS, nextVariants } from '../../../src/sim/skills';
import { LINES, type Build } from '../../../src/sim/types';
import { BONUS_KINDS } from '../../../src/sim/links';
import { RELICS } from '../../../src/sim/relics';
import {
  MARKS, applyMark, buy, buySlot, chooseLastChance, concede, heroChoices, moveSkill, newRun, pickRelic, recordResult,
  reroll, rerollRelic, sell, toBuild, toggleLock, wish, type RunState,
} from '../../../src/sim/run';
import { encodeState } from '../diff/run-gen.mts';

const rpc = process.argv[2] ?? 'http://127.0.0.1:18899';
const c = new Connection(rpc, 'confirmed');
const PROGRAM = new PublicKey('Fu3JUGUS5QYmpyXVGLrD7oKChrAhjZCxEcFK1jTcrSh');
const VRF = new PublicKey('Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz');
const QUEUE = new PublicKey('5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc');
const sha = (...xs: (Buffer | Uint8Array | string)[]) => crypto.createHash('sha256').update(Buffer.concat(xs.map((x) => (typeof x === 'string' ? Buffer.from(x) : Buffer.from(x))))).digest();
const disc = (n: string) => sha(`global:${n}`).subarray(0, 8);
const u8 = (n: number) => Buffer.from([n & 255]);
const i8 = (n: number) => { const b = Buffer.alloc(1); b.writeInt8(n); return b; };
const u16 = (n: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
const i64 = (n: number) => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return b; };
const pda = (...s: Buffer[]) => PublicKey.findProgramAddressSync(s, PROGRAM)[0];
const W = (pubkey: PublicKey, isSigner = false) => ({ pubkey, isSigner, isWritable: true });
const R = (pubkey: PublicKey) => ({ pubkey, isSigner: false, isWritable: false });
const sys = R(SystemProgram.programId);
const checks: [string, boolean, string?][] = [];
const check = (name: string, ok: boolean, detail = '') => { checks.push([name, ok, detail]); console.log(`${ok ? 'OK  ' : 'FAIL'} ${name} ${detail}`); };

async function send(signers: Keypair[], name: string, data: Buffer[], keys: ReturnType<typeof W>[]) {
  const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), new TransactionInstruction({ programId: PROGRAM, keys, data: Buffer.concat([disc(name), ...data]) }));
  tx.feePayer = signers[0].publicKey;
  tx.recentBlockhash = (await c.getLatestBlockhash()).blockhash;
  tx.sign(...signers);
  const sig = await c.sendRawTransaction(tx.serialize(), { skipPreflight: true });
  const st = await c.confirmTransaction(sig, 'confirmed');
  if (st.value.err) {
    const t = await c.getTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' });
    throw new Error(`${name}: ${JSON.stringify(st.value.err)} ${(t?.meta?.logMessages ?? []).slice(-3).join(' | ')}`);
  }
  const t = await c.getTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' });
  return t?.meta?.computeUnitsConsumed ?? 0;
}
const fund = async (k: Keypair) => c.confirmTransaction(await c.requestAirdrop(k.publicKey, 20e9), 'confirmed');

// ---------- Player layout (lib.rs Player, + 8 discriminator) ----------
const P = { status: 8 + 237, choices: 8 + 244, run: 8 + 248, lastOpp: 8 + 248 + 184 + 93, commit: 8 + 96, revSecret: 8 + 128, revVrf: 8 + 160, runNo: 8 + 200, lastSeed: 8 + 216, revRun: 8 + 224, lastDay: 8 + 239 };
const ST = { IDLE: 0, PICK: 1, RUN: 2, ENDED: 3, WAIT_VRF: 5 };
async function player(k: PublicKey) { return (await c.getAccountInfo(k))!.data; }
/** RunState bytes → run-gen.mts encodeState vector */
function encodeRust(b: Buffer) {
  const o = [b[10], b.readUInt32LE(0), b[11], b.readInt16LE(4), b[12], b[13], b.readUInt16LE(6), b.readInt8(14), b[15], b[16], b[17], b[18], b.readUInt16LE(8), b[19], b[20], b[21], b[22], b[23], b[24], b[25]];
  for (let i = 0; i < 5; i++) o.push(b[26 + i]);
  for (let i = 0; i < 3; i++) o.push(b[31 + i]);
  for (let i = 0; i < 3; i++) o.push(b[34 + i]);
  o.push(b[37], b[38]);
  for (let i = 0; i < 8; i++) { const p = 41 + 11 * i; for (let k = 0; k < 11; k++) o.push(i < b[25] ? b[p + k] : 0); }
  for (let i = 0; i < 5; i++) { const p = 129 + 11 * i; for (let k = 0; k < 11; k++) o.push(b[p] ? b[p + k] : 0); }
  return o;
}
/** Rust Build bytes (93) → TS Build */
function buildOf(b: Buffer): Build {
  const relics = [b[2], b[3], b[4]].filter((r) => r !== 255).map((r) => RELICS[r].id);
  const skills = [];
  for (let i = 0; i < b[1]; i++) {
    const p = 5 + 11 * i;
    const bonus = [];
    for (let j = 0; j < b[p + 4]; j++) {
      const t = b[p + 5 + 2 * j];
      bonus.push({ t: t >= 200 ? 'line:' + LINES[t - 200] : SKILL_LIST[t].id, e: BONUS_KINDS[b[p + 6 + 2 * j]] });
    }
    skills.push({ id: SKILL_LIST[b[p]].id, v: VARIANTS[b[p + 1]], ...(b[p + 2] ? { mark: MARKS[b[p + 2] - 1] } : {}), ...(b[p + 3] ? { star: b[p + 3] } : {}), bonus });
  }
  return { hero: HEROES[b[0]].id, skills, ...(relics.length ? { relics } : {}) };
}

// ---------- season ----------
const admin = Keypair.generate();
await fund(admin);
const SEASON = (Math.random() * 4e9) >>> 0, SHARD = 0;
const seasonSecret = crypto.randomBytes(32);
const seasonPda = pda(Buffer.from('season'), u32(SEASON)), ssPda = pda(Buffer.from('season_secret'), u32(SEASON));
const rankPda = pda(Buffer.from('ranking'), u32(SEASON)), poolPda = pda(Buffer.from('pool'), u32(SEASON), u16(SHARD));
const now = Math.floor(Date.now() / 1000);
await send([admin], 'init_season', [u32(SEASON), i64(now - 600), i64(now + 7 * 86400), sha(seasonSecret)], [W(admin.publicKey, true), W(seasonPda), sys]);
await send([admin], 'init_season_secret', [u32(SEASON)], [W(admin.publicKey, true), R(seasonPda), W(ssPda), sys]);
let badCommit = false;
try { await send([admin], 'set_season_secret', [crypto.randomBytes(32)], [W(admin.publicKey, true), R(seasonPda), W(ssPda)]); } catch { badCommit = true; }
check('season secret that does not match the published commitment is refused', badCommit);
await send([admin], 'set_season_secret', [seasonSecret], [W(admin.publicKey, true), R(seasonPda), W(ssPda)]);
await send([admin], 'init_ranking', [u32(SEASON)], [W(admin.publicKey, true), W(rankPda), sys]);
await send([admin], 'init_pool', [u32(SEASON), u16(SHARD)], [W(admin.publicKey, true), W(poolPda), sys]);

const identity = PublicKey.findProgramAddressSync([Buffer.from('identity')], PROGRAM)[0];
type Act = { code: number; a: number; b: number } | { fight: true; opp: Build; seed: number; day: number };
const cus: Record<string, number[]> = {};
const cu = (k: string, v: number) => (cus[k] ??= []).push(v);

async function playRun(owner: Keypair, plPda: PublicKey, secPda: PublicKey, rng: () => number) {
  const S = [W(owner.publicKey, true), W(plPda), W(secPda), R(seasonPda)];
  const F = [W(owner.publicKey, true), W(plPda), W(secPda), W(poolPda), W(rankPda), R(seasonPda)];
  cu('begin_run', await send([owner], 'begin_run', [], [W(owner.publicKey, true), W(plPda), W(secPda), R(ssPda), R(seasonPda), W(QUEUE), R(identity), R(VRF), R(SYSVAR_SLOT_HASHES_PUBKEY), sys]));
  let d = await player(plPda);
  check('after begin_run: waiting for VRF, no commitment, no choices yet', d[P.status] === ST.WAIT_VRF && d.subarray(P.commit, P.commit + 32).every((x) => x === 0));
  const vrf = crypto.randomBytes(32);
  cu('vrf_callback (local)', await send([admin], 'local_vrf', [vrf], [W(admin.publicKey, true), R(seasonPda), W(plPda), W(secPda), R(ssPda)]));
  d = await player(plPda);
  const runNo = d.readUInt32LE(P.runNo);
  const choices = [...d.subarray(P.choices, P.choices + 3)];
  const commit = Buffer.from(d.subarray(P.commit, P.commit + 32));
  // the secret must not be anywhere in the player's account while the run goes
  const secret = sha('mochi-run', vrf, seasonSecret, owner.publicKey.toBuffer(), u32(runNo));
  check('during the run Player holds only the commitment (secret, vrf and roll seed not in it)', !d.includes(secret) && !d.includes(vrf) && !d.includes(secret.subarray(0, 4)) && d[P.status] === ST.PICK);
  const pick = Math.floor(rng() * 3);
  cu('pick_hero', await send([owner], 'pick_hero', [u8(pick)], S));
  const acts: Act[] = [];
  let rejectedSame = 0, rejectedDiff = 0;
  for (let step = 0; step < 400; step++) {
    d = await player(plPda);
    if (d[P.status] !== ST.RUN) break;
    const run = d.subarray(P.run, P.run + 184);
    const phase = run[21];
    const tryAct = async (code: number, a: number, b = 0) => {
      const run = Buffer.from((await player(plPda)).subarray(P.run, P.run + 184)); // state right before this action
      try {
        cu(`act ${code}`, await send([owner], 'act', [u8(code), i8(a), i8(b)], S));
        acts.push({ code, a, b });
        return true;
      } catch {
        const after = (await player(plPda)).subarray(P.run, P.run + 184);
        if (Buffer.compare(after, run) === 0) rejectedSame++; else rejectedDiff++;
        return false;
      }
    };
    if (phase === 1) { await tryAct(rng() < 0.3 ? 12 : 11, rng() < 0.3 ? 12 : Math.floor(rng() * 3)); continue; }
    if (phase === 2) { await tryAct(7, Math.floor(rng() * 3)); continue; }
    if (phase === 3) { await tryAct(8, run[25] ? 0 : -1); continue; }
    if (phase !== 0) break;
    // shop: a few tries (some invalid on purpose), then fight
    for (let k = 0; k < 4; k++) {
      const r = rng();
      if (r < 0.6) await tryAct(0, Math.floor(rng() * 6), Math.floor(rng() * 3) - 1);
      else if (r < 0.75) await tryAct(3, 0);
      else if (r < 0.85) await tryAct(6, 0);
      else if (r < 0.92) await tryAct(5, 0);
      else await tryAct(2, Math.floor(rng() * 4), 1);
    }
    const day = run[11];
    cu('fight', await send([owner], 'fight', [], F));
    d = await player(plPda);
    acts.push({ fight: true, opp: buildOf(Buffer.from(d.subarray(P.lastOpp, P.lastOpp + 93))), seed: d.readUInt32LE(P.lastSeed), day });
  }
  d = await player(plPda);
  if (d[P.status] === ST.ENDED) cu('finish_run', await send([owner], 'finish_run', [], F));
  d = await player(plPda);
  const revSecret = Buffer.from(d.subarray(P.revSecret, P.revSecret + 32)), revVrf = Buffer.from(d.subarray(P.revVrf, P.revVrf + 32));
  check(`run ${runNo}: revealed secret = H(vrf, season secret, owner, run) and matches the commitment`,
    revSecret.equals(secret) && revVrf.equals(vrf) && d.readUInt32LE(P.revRun) === runNo && sha('mochi-commit', revSecret, u32(runNo)).equals(commit));
  check(`run ${runNo}: rejected actions left the state byte-identical`, rejectedDiff === 0, `${rejectedSame} rejected`);
  // ---------- verify the whole run with the TS sim from the revealed secret ----------
  const u32h = (...p: (Buffer | string)[]) => sha(...p).readUInt32LE(0);
  const rs = u32h(revSecret, 'run'), look = u32h(revSecret, 'look');
  const heroes = heroChoices(u32h(revSecret, 'heroes')).map((h) => HEROES.findIndex((x) => x.id === h));
  check(`run ${runNo}: hero choices = heroChoices(H(secret, "heroes"))`, heroes.join() === choices.join(), `${heroes} vs ${choices}`);
  const s: RunState = newRun(HEROES[choices[pick]].id, look, 'verify', rs);
  let fightsOk = 0, fights = 0;
  for (const a of acts) {
    if ('fight' in a) {
      fights++;
      const want = sha(revSecret, 'fight', u8(a.day)).readUInt32LE(0);
      if (want === a.seed) fightsOk++;
      const r = simulate(toBuild(s), a.opp, a.seed, s.day);
      recordResult(s, r.winner === 0, { opp: 'x', ai: false }, r.winner === -1);
      continue;
    }
    const { code, a: x, b: y } = a;
    if (code === 0) { const o = s.shop[x]; const owned = o ? s.skills.find((k) => k.id === o.id) : undefined; buy(s, x, y < 0 ? undefined : (owned ? nextVariants(owned.v)[y] : undefined) ?? 'zz'); }
    else if (code === 1) sell(s, x); else if (code === 2) moveSkill(s, x, y as 1 | -1); else if (code === 3) reroll(s); else if (code === 4) toggleLock(s, x);
    else if (code === 5) buySlot(s); else if (code === 6) wish(s); else if (code === 7) chooseLastChance(s, (['awaken', 'mark', 'supply'] as const)[x]);
    else if (code === 8) applyMark(s, x); else if (code === 9) concede(s); else if (code === 11) pickRelic(s, x); else if (code === 12) rerollRelic(s);
  }
  const rust = encodeRust(Buffer.from(d.subarray(P.run, P.run + 184)));
  const ts = encodeState(s);
  check(`run ${runNo}: every fight seed = H(secret, "fight", day)`, fightsOk === fights, `${fightsOk}/${fights}`);
  check(`run ${runNo}: TS replay from the revealed secret = program state after ${acts.length} actions (day ${s.day}, ${s.wins} wins)`, rust.join() === ts.join());
}

// two players, two runs each (the second runs meet the first runs' ghosts)
const owners = [Keypair.generate(), Keypair.generate()];
for (const o of owners) {
  await fund(o);
  const pl = pda(Buffer.from('player'), u32(SEASON), o.publicKey.toBuffer()), sec = pda(Buffer.from('secret'), u32(SEASON), o.publicKey.toBuffer());
  await send([o], 'init_player', [u32(SEASON), u16(SHARD)], [W(o.publicKey, true), W(pl), W(sec), sys]);
  await send([o], 'join_pool', [], [W(o.publicKey, true), W(pl), W(poolPda)]);
}
let seed = 12345;
const rng = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
for (let round = 0; round < 2; round++)
  for (const o of owners) {
    const pl = pda(Buffer.from('player'), u32(SEASON), o.publicKey.toBuffer()), sec = pda(Buffer.from('secret'), u32(SEASON), o.publicKey.toBuffer());
    await playRun(o, pl, sec, rng);
  }
// a stranger cannot play someone else's run
const stranger = Keypair.generate();
await fund(stranger);
const pl0 = pda(Buffer.from('player'), u32(SEASON), owners[0].publicKey.toBuffer()), sec0 = pda(Buffer.from('secret'), u32(SEASON), owners[0].publicKey.toBuffer());
let refused = false;
try { await send([stranger], 'begin_run', [], [W(stranger.publicKey, true), W(pl0), W(sec0), R(ssPda), R(seasonPda), W(QUEUE), R(identity), R(VRF), R(SYSVAR_SLOT_HASHES_PUBKEY), sys]); } catch { refused = true; }
check('a stranger cannot start a run on another player\'s account', refused);
// a player cannot answer their own VRF request
let selfVrf = false;
const o0 = owners[0];
await send([o0], 'begin_run', [], [W(o0.publicKey, true), W(pl0), W(sec0), R(ssPda), R(seasonPda), W(QUEUE), R(identity), R(VRF), R(SYSVAR_SLOT_HASHES_PUBKEY), sys]);
try { await send([o0], 'local_vrf', [crypto.randomBytes(32)], [W(o0.publicKey, true), R(seasonPda), W(pl0), W(sec0), R(ssPda)]); } catch { selfVrf = true; }
check('the player cannot fulfil their own randomness request', selfVrf);
let early = false;
try { await send([o0], 'retry_vrf', [], [W(o0.publicKey, true), W(pl0), W(sec0), R(ssPda), R(seasonPda), W(QUEUE), R(identity), R(VRF), R(SYSVAR_SLOT_HASHES_PUBKEY), sys]); } catch { early = true; }
check('retry_vrf before the timeout is refused', early);

const stat = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return `n ${s.length} mean ${Math.round(s.reduce((a, b) => a + b, 0) / s.length)} max ${s[s.length - 1]}`; };
console.log('\nCU per instruction (whole transaction):');
for (const [k, v] of Object.entries(cus)) console.log(`  ${k.padEnd(22)} ${stat(v)}`);
const bad = checks.filter((x) => !x[1]).length;
console.log(`\n${checks.length - bad}/${checks.length} checks passed`);
process.exit(bad ? 1 : 0);
