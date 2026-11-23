// mochi-game on devnet + MagicBlock TEE, end to end (owner keys stand in for Phantom; session keys play):
// admin setup → players: init + delegate + session + permission → play on the TEE with session keys → privacy
// checks → fight CU / latency → season end (close, proofs, scrub + commit, publish root, clear pool) → claims.
import fs from 'node:fs';
import os from 'node:os';
import anchor from '@coral-xyz/anchor';
import { ComputeBudgetProgram, Connection, Keypair, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import * as er from '@magicblock-labs/ephemeral-rollups-sdk';
import nacl from 'tweetnacl';

const idl = JSON.parse(fs.readFileSync(new URL('../idl/mochi_game.json', import.meta.url)));
const PROGRAM_ID = new PublicKey(idl.address);
const BASE = 'https://api.devnet.solana.com', TEE = 'https://devnet-tee.magicblock.app';
const TEE_VALIDATOR = new PublicKey('MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo');
const HOME = os.homedir();
const load = (p) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p))));
const key = (n) => { const p = `${HOME}/spikes/keys/e2e-${n}.json`; if (!fs.existsSync(p)) fs.writeFileSync(p, JSON.stringify([...Keypair.generate().secretKey])); return load(p); };
const admin = load(`${HOME}/.config/solana/id.json`);
const O = { a: key('ownerA'), b: key('ownerB') }, SK = { a: Keypair.generate(), b: Keypair.generate() }, stranger = Keypair.generate();
const SEASON = Math.floor(Math.random() * 4e9) + 1, SHARD = 0;
const results = [], lat = {}, cus = {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const short = (e) => String(e?.message ?? e).split('\n').slice(0, 2).join(' | ').slice(0, 300);
async function step(name, fn) {
  const t0 = performance.now(); let ok, detail;
  try { detail = await fn(); ok = true; } catch (e) { ok = false; detail = short(e); }
  results.push({ name, ok, ms: Math.round(performance.now() - t0), detail });
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${String(Math.round(performance.now() - t0)).padStart(6)}ms  ${name}  ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
  return ok ? detail : undefined;
}
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
const pda = (s) => PublicKey.findProgramAddressSync(s, PROGRAM_ID)[0];
const seasonPda = pda([Buffer.from('season'), u32(SEASON)]), rankPda = pda([Buffer.from('ranking'), u32(SEASON)]), poolPda = pda([Buffer.from('pool'), u32(SEASON), u16(SHARD)]);
const playerPda = (o) => pda([Buffer.from('player'), u32(SEASON), o.publicKey.toBuffer()]);
const conn = (u) => new Connection(u, { commitment: 'confirmed' });
async function token(k) { const { token } = await er.getAuthToken(TEE, k.publicKey, (m) => Promise.resolve(nacl.sign.detached(m, k.secretKey))); return token; }
const prog = (c, k) => new anchor.Program(idl, new anchor.AnchorProvider(c, new anchor.Wallet(k), { commitment: 'confirmed' }));
async function send(c, signers, ixs, label) {
  const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), ...ixs);
  const { blockhash } = await c.getLatestBlockhash('confirmed');
  tx.recentBlockhash = blockhash; tx.feePayer = signers[0].publicKey; tx.sign(...signers);
  const t0 = performance.now();
  const sig = await c.sendRawTransaction(tx.serialize(), { skipPreflight: true });
  for (let i = 0; i < 300; i++) {
    const st = (await c.getSignatureStatuses([sig])).value[0];
    if (st && (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized')) {
      const ms = performance.now() - t0;
      if (label) (lat[label] ??= []).push(ms);
      if (st.err) {
        const t = await c.getTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' }).catch(() => null);
        throw new Error(`${label ?? 'tx'} failed ${JSON.stringify(st.err)} ${(t?.meta?.logMessages ?? []).filter((l) => /Error|rejected/.test(l)).slice(-2).join(' | ')}`);
      }
      if (label) { const t = await c.getTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' }).catch(() => null); if (t?.meta?.computeUnitsConsumed) (cus[label] ??= []).push(t.meta.computeUnitsConsumed); }
      return sig;
    }
    await sleep(120);
  }
  throw new Error('timeout ' + label);
}
const ixOf = (b) => b.instruction();
async function waitFor(fn, ms = 120000, every = 1500) { const end = Date.now() + ms; for (;;) { try { const v = await fn(); if (v) return v; } catch {} if (Date.now() > end) throw new Error('timeout'); await sleep(every); } }

const base = conn(BASE);
const tok = { admin: await token(admin), a: await token(SK.a), b: await token(SK.b), stranger: await token(stranger) };
const tee = { admin: conn(`${TEE}?token=${tok.admin}`), a: conn(`${TEE}?token=${tok.a}`), b: conn(`${TEE}?token=${tok.b}`), stranger: conn(`${TEE}?token=${tok.stranger}`), anon: conn(TEE) };
const B = prog(base, admin), T = prog(tee.admin, admin);
console.log('program', PROGRAM_ID.toBase58(), 'season', SEASON);
const now = () => Math.floor(Date.now() / 1000);

// ---------- admin ----------
for (const k of [O.a, O.b]) if ((await base.getBalance(k.publicKey)) < 0.1 * LAMPORTS_PER_SOL)
  await step(`fund owner ${k.publicKey.toBase58().slice(0, 6)}`, () => send(base, [admin], [SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: k.publicKey, lamports: 0.15 * LAMPORTS_PER_SOL })]));
await step('admin: season (7 days) + ranking + pool on Solana', async () => {
  await send(base, [admin], [await ixOf(B.methods.initSeason(SEASON, new anchor.BN(now() - 600), new anchor.BN(now() + 7 * 86400)).accountsPartial({ admin: admin.publicKey, season: seasonPda }))]);
  await send(base, [admin], [await ixOf(B.methods.initRanking(SEASON).accountsPartial({ admin: admin.publicKey, ranking: rankPda })), await ixOf(B.methods.initPool(SEASON, SHARD).accountsPartial({ admin: admin.publicKey, pool: poolPda }))]);
  return 'ok';
});
await step('admin: delegate ranking + pool → TEE', async () => send(base, [admin], [
  await ixOf(B.methods.delegateRanking(SEASON).accountsPartial({ admin: admin.publicKey, ranking: rankPda, validator: TEE_VALIDATOR })),
  await ixOf(B.methods.delegatePool(SEASON, SHARD).accountsPartial({ admin: admin.publicKey, pool: poolPda, validator: TEE_VALIDATOR })),
], 'delegate'));
await step('admin: ranking + pool private to nobody (TEE)', () => waitFor(async () => send(tee.admin, [admin], [
  await ixOf(T.methods.rankingPermission(SEASON).accountsPartial({ admin: admin.publicKey, ranking: rankPda, permission: er.permissionPdaFromAccount(rankPda) })),
  await ixOf(T.methods.poolPermission(SEASON, SHARD).accountsPartial({ admin: admin.publicKey, pool: poolPda, permission: er.permissionPdaFromAccount(poolPda) })),
], 'permission'), 120000, 3000));

// ---------- players: what the Phantom flow does (2 owner signatures, then the session key plays) ----------
for (const n of ['a', 'b']) {
  const o = O[n], s = SK[n], Bo = prog(base, o), To = prog(tee[n], o);
  await step(`player ${n}: [owner sig 1] init + fund session key + delegate (one Solana tx)`, async () => send(base, [o], [
    await ixOf(Bo.methods.initPlayer(SEASON, SHARD).accountsPartial({ owner: o.publicKey, player: playerPda(o) })),
    SystemProgram.transfer({ fromPubkey: o.publicKey, toPubkey: s.publicKey, lamports: 0.01 * LAMPORTS_PER_SOL }),
    await ixOf(Bo.methods.delegatePlayer(SEASON).accountsPartial({ owner: o.publicKey, player: playerPda(o), validator: TEE_VALIDATOR })),
  ], 'player_setup'));
  await step(`player ${n}: [owner sig 2] approve session key + permission (one TEE tx)`, () => waitFor(async () => send(tee[n], [o], [
    await ixOf(To.methods.setSession(s.publicKey, new anchor.BN(now() + 7 * 86400 - 60)).accountsPartial({ owner: o.publicKey, player: playerPda(o) })),
    await ixOf(To.methods.playerPermission(SEASON).accountsPartial({ owner: o.publicKey, player: playerPda(o), permission: er.permissionPdaFromAccount(playerPda(o)) })),
  ], 'session_setup'), 120000, 3000));
  await step(`player ${n}: [session key] salt + take a pool seat (TEE, no wallet popup)`, async () => send(tee[n], [s], [
    await ixOf(prog(tee[n], s).methods.setSalt(new anchor.BN(Date.now())).accountsPartial({ owner: s.publicKey, player: playerPda(o), season: seasonPda })),
    await ixOf(prog(tee[n], s).methods.joinPool().accountsPartial({ owner: s.publicKey, player: playerPda(o), pool: poolPda })),
  ], 'join'));
}
const coder = new anchor.BorshAccountsCoder(idl);
const readPlayer = async (c, o) => { const i = await c.getAccountInfo(playerPda(o)); return i ? i.data : null; };
const S = (n) => ({ prog: prog(tee[n], SK[n]), o: O[n], s: SK[n] });
const pk = (n) => ({ owner: SK[n].publicKey, player: playerPda(O[n]), season: seasonPda });
const fk = (n) => ({ owner: SK[n].publicKey, player: playerPda(O[n]), pool: poolPda, ranking: rankPda, season: seasonPda });

// privacy before play
await step('privacy: session key reads its Player; stranger / no token cannot', async () => {
  const own = !!(await readPlayer(tee.a, O.a)), st = !!(await readPlayer(tee.stranger, O.a)), an = !!(await readPlayer(tee.anon, O.a)), other = !!(await readPlayer(tee.b, O.a));
  if (!own || st || an || other) throw new Error(JSON.stringify({ own, stranger: st, anon: an, otherSession: other }));
  return { ownSessionReads: own, strangerReads: st, noTokenReads: an, otherPlayersSessionReads: other };
});
await step('privacy: pool + ranking unreadable by anyone (admin, players, no token)', async () => {
  const r = { admin: !!(await tee.admin.getAccountInfo(poolPda)) || !!(await tee.admin.getAccountInfo(rankPda)), player: !!(await tee.a.getAccountInfo(poolPda)), anon: !!(await tee.anon.getAccountInfo(rankPda)) };
  if (r.admin || r.player || r.anon) throw new Error('LEAK ' + JSON.stringify(r)); return r;
});

// ---------- play on the TEE with session keys ----------
async function playRun(n, maxDays) {
  const { prog: P } = S(n);
  await send(tee[n], [SK[n]], [await ixOf(P.methods.setSalt(new anchor.BN(Date.now())).accountsPartial(pk(n)))], 'salt').catch(() => {});
  await send(tee[n], [SK[n]], [await ixOf(P.methods.beginRun().accountsPartial(pk(n)))], 'begin_run');
  await send(tee[n], [SK[n]], [await ixOf(P.methods.pickHero(0).accountsPartial(pk(n)))], 'pick_hero');
  const log = [];
  for (let d = 0; d < maxDays; d++) {
    let p = await readPlayer(tee[n], O[n]);
    if (p[8 + 89] !== 2) break; // run over (archived)
    const phase = p[8 + 96 + 21];
    if (phase === 1) await send(tee[n], [SK[n]], [await ixOf(P.methods.act(7, 2, 0).accountsPartial(pk(n)))], 'act');
    // buy what the rules accept (each try is one action; rejected ones fail cheaply)
    for (let i = 0; i < 5; i++) await send(tee[n], [SK[n]], [await ixOf(P.methods.act(0, i, 0).accountsPartial(pk(n)))], 'act').catch(() => {});
    await send(tee[n], [SK[n]], [await ixOf(P.methods.fight().accountsPartial(fk(n)))], 'fight');
    p = await readPlayer(tee[n], O[n]);
    log.push({ day: p[8 + 1495], result: ['', 'draw', 'won', 'lost'][p[8 + 1496]], opp: p[8 + 1497] === 1 ? 'ghost' : 'bot' });
  }
  return log;
}
const logA = await step('play: player A run (session key, TEE)', () => playRun('a', 25));
const logB = await step('play: player B run (meets A’s ghost?)', () => playRun('b', 25));
await step('play: B met a player ghost (A’s archived run)', async () => { const g = (logB ?? []).filter((x) => x.opp === 'ghost').length; if (!g) throw new Error('no ghost met: ' + JSON.stringify(logB)); return { ghostFights: g, of: logB.length }; });
await step('privacy: B’s session cannot read A’s Player after play', async () => { if (await readPlayer(tee.b, O.a)) throw new Error('LEAK'); return 'null'; });
const stat = (xs) => { if (!xs?.length) return null; const s = [...xs].sort((a, b) => a - b); return { n: s.length, mean: Math.round(s.reduce((a, b) => a + b, 0) / s.length), p95: Math.round(s[Math.floor(s.length * 0.95)]), max: Math.round(s[s.length - 1]) }; };
results.push({ name: 'TEE latency ms (send → confirmed, from Thailand)', ok: true, detail: Object.fromEntries(Object.entries(lat).map(([k, v]) => [k, stat(v)])) });
results.push({ name: 'TEE CU (tx meta)', ok: true, detail: Object.fromEntries(Object.entries(cus).map(([k, v]) => [k, stat(v)])) });
console.log('LATENCY', JSON.stringify(results.at(-2).detail)); console.log('CU', JSON.stringify(results.at(-1).detail));

// ---------- season end ----------
const newEnd = now() + 25;
await step('season end: set_season_end', async () => send(base, [admin], [await ixOf(B.methods.setSeasonEnd(new anchor.BN(newEnd)).accountsPartial({ admin: admin.publicKey, season: seasonPda }))]));
await step('season end: TEE sees the new end time', () => waitFor(async () => { const i = await tee.admin.getAccountInfo(seasonPda); return i && Number(coder.decode('Season', i.data).end_ts) === newEnd ? 'yes' : null; }, 120000, 1000));
await step('season end: close_season (Merkle root) after the end', () => waitFor(async () => send(tee.admin, [admin], [await ixOf(T.methods.closeSeason(SEASON).accountsPartial({ payer: admin.publicKey, season: seasonPda, ranking: rankPda }))], 'close'), 120000, 3000));
const proofs = {};
for (const n of ['a', 'b']) await step(`season end: issue_proof → ${n}, read privately with its session key`, async () => {
  try { await send(tee.admin, [admin], [await ixOf(T.methods.issueProof(SEASON).accountsPartial({ payer: admin.publicKey, ranking: rankPda, player: playerPda(O[n]) }))], 'proof'); }
  catch (e) { if (short(e).includes('NotRanked') || short(e).includes('6012')) return 'not ranked'; throw e; }
  const p = await readPlayer(tee[n], O[n]);
  proofs[n] = { rank: p[8 + 1499], reward: p.readUInt32LE(8 + 1504), proof: Array.from({ length: 4 }, (_, k) => [...p.subarray(8 + 1508 + 32 * k, 8 + 1540 + 32 * k)]) };
  if (await readPlayer(tee[n === 'a' ? 'b' : 'a'], O[n])) throw new Error('other player can read the proof');
  return { rank: proofs[n].rank, reward: proofs[n].reward };
});
for (const n of ['a', 'b']) await step(`season end: finalize ${n} (scrub, commit + undelegate)`, async () => send(tee.admin, [admin], [await ixOf(T.methods.finalizePlayer(SEASON).accountsPartial({ payer: admin.publicKey, season: seasonPda, player: playerPda(O[n]) }))], 'finalize'));
await step('season end: publish root (scrub ranking, commit + undelegate)', async () => send(tee.admin, [admin], [await ixOf(T.methods.publishRoot(SEASON).accountsPartial({ payer: admin.publicKey, ranking: rankPda }))], 'publish'));
await step('season end: clear pool (delete ghosts, commit + undelegate)', async () => send(tee.admin, [admin], [await ixOf(T.methods.clearPool(SEASON, SHARD).accountsPartial({ payer: admin.publicKey, season: seasonPda, pool: poolPda }))], 'clear'));
const back = (k) => waitFor(async () => (await base.getAccountInfo(k))?.owner.equals(PROGRAM_ID) ? 'yes' : null, 180000, 3000);
await step('season end: all accounts back on Solana', async () => { await back(rankPda); await back(poolPda); await back(playerPda(O.a)); await back(playerPda(O.b)); await sleep(4000); return 'yes'; });
await step('season end: Solana copies hold no secrets (players scrubbed, ranking = root only, ghosts deleted)', async () => {
  const out = {};
  for (const n of ['a', 'b']) {
    const d = (await base.getAccountInfo(playerPda(O[n]))).data;
    const salt = d.readBigUInt64LE(8), run = d.subarray(8 + 96, 8 + 260), journal = d.subarray(8 + 342, 8 + 1413), proof = d.subarray(8 + 1508, 8 + 1636);
    if (salt !== 0n || run.some(Boolean) || journal.some(Boolean) || proof.some(Boolean)) throw new Error(`SECRETS ON SOLANA (${n})`);
    out[n] = { status: d[8 + 89], best: d.readUInt32LE(8 + 72), runs: d.readUInt32LE(8 + 64) };
  }
  const r = (await base.getAccountInfo(rankPda)).data;
  if (r.subarray(8 + 48).some(Boolean)) throw new Error('RANKING ON SOLANA');
  const p = (await base.getAccountInfo(poolPda)).data;
  if (p.subarray(8 + 216).some(Boolean)) throw new Error('GHOSTS ON SOLANA');
  out.ranking = { closed: r[8 + 9], published: r[8 + 10], root: r.subarray(8 + 16, 8 + 48).toString('hex').slice(0, 16) + '…' };
  return out;
});
const claim = (n, pr) => (async () => send(base, [O[n]], [await ixOf(prog(base, O[n]).methods.claimReward(SEASON, pr.rank, pr.reward, pr.proof).accountsPartial({ owner: O[n].publicKey, ranking: rankPda }))], 'claim'))();
for (const n of Object.keys(proofs)) {
  await step(`claim ${n}: forged reward rejected`, async () => { let err; try { await claim(n, { ...proofs[n], reward: proofs[n].reward + 1 }); } catch (e) { err = short(e); } if (!err) throw new Error('ACCEPTED'); return 'rejected'; });
  await step(`claim ${n}: own proof on Solana`, async () => { await claim(n, proofs[n]); return proofs[n]; });
  await step(`claim ${n}: second claim rejected`, async () => { let err; try { await claim(n, proofs[n]); } catch (e) { err = short(e); } if (!err) throw new Error('ACCEPTED'); return 'rejected'; });
}
const okN = results.filter((r) => r.ok).length;
console.log(`\n${okN}/${results.length} steps ok`);
fs.writeFileSync(new URL('./devnet-e2e.json', import.meta.url), JSON.stringify({ at: new Date().toISOString(), program: PROGRAM_ID.toBase58(), season: SEASON, logA, logB, results }, null, 1));
