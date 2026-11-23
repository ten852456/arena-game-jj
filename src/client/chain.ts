/**
 * On-chain mode (`?chain=1`): the authoritative run lives in the `mochi-game` program (spikes/per-spike/programs/
 * mochi-game), whose rules are the Rust port of src/sim (bit-exact, sim v13).
 *
 * How it plugs into the UI without rewriting it:
 * - the UI keeps playing on its local TS RunState (instant feedback; same rules as the chain);
 * - every accepted shop / last-chance / mark action is queued as its chain action code (runChain.ts);
 * - a fight sends the queue (act or act_batch) + fight in ONE transaction; the chain picks the opponent
 *   (pool ghost or bot) and stores the fight (opponent build, seed, day); the UI replays it with the TS sim;
 * - after every fight the local state is compared byte for byte with the chain's; on any difference the UI
 *   reloads the run from the chain (the chain wins).
 * Config comes from /chain.json (written by the chain setup script). Wallet: a per-browser burner key.
 */
import './chainPolyfill';
import { ComputeBudgetProgram, Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import { HEROES } from '../sim/heroes';
import { MARKS, type Offer, type RunState } from '../sim/run';
import { SKILL_LIST, VARIANTS } from '../sim/skills';
import { ARCHES, type Bonus, type Build, type SkillInstance } from '../sim/types';
import { BONUS_KINDS } from '../sim/links';

export interface ChainConfig {
  rpc: string;
  program: string;
  season: number;
  shard: number;
  /** anchor discriminators (hex) by instruction name */
  disc: Record<string, string>;
}

export const chainOn = () => typeof location !== 'undefined' && new URLSearchParams(location.search).get('chain') === '1';

let cfg: ChainConfig | null = null;
let conn: Connection;
let me: Keypair;
const queue: [number, number, number][] = [];

// ---------------- encoding (same layouts as mochi-engine: RunState 164 B, Build 82 B) ----------------
const PHASES = ['shop', 'lastchance', 'mark', 'won', 'dead'] as const;
const sIdx = (id: string) => SKILL_LIST.findIndex((d) => d.id === id);
const bonusBytes = (b: Bonus[] | undefined, out: number[]) => {
  for (let j = 0; j < 3; j++) {
    const x = b?.[j];
    if (!x) out.push(0, 0);
    else out.push(x.t.startsWith('arch:') ? 200 + ARCHES.indexOf(x.t.slice(5) as never) : sIdx(x.t), BONUS_KINDS.indexOf(x.e));
  }
};
const skillBytes = (k: SkillInstance | undefined, out: number[]) => {
  if (!k) { out.push(0, 0, 0, 0, 0, 0, 0, 0, 0, 0); return; }
  out.push(sIdx(k.id), VARIANTS.indexOf(k.v as never), k.mark ? MARKS.indexOf(k.mark) + 1 : 0, k.bonus?.length ?? 0);
  bonusBytes(k.bonus, out);
};
const bonusOf = (b: Uint8Array, nb: number): Bonus[] =>
  Array.from({ length: nb }, (_, j) => {
    const t = b[2 * j], e = b[2 * j + 1];
    return { t: t >= 200 ? 'arch:' + ARCHES[t - 200] : SKILL_LIST[t].id, e: BONUS_KINDS[e] };
  });
const skillOf = (b: Uint8Array): SkillInstance => {
  const k: SkillInstance = { id: SKILL_LIST[b[0]].id, v: VARIANTS[b[1]], bonus: bonusOf(b.subarray(4, 10), b[3]) };
  if (b[2]) k.mark = MARKS[b[2] - 1];
  return k;
};

/** TS RunState → the chain's 164 raw bytes */
export function runBytes(s: RunState): Uint8Array {
  const o = new Uint8Array(164);
  const dv = new DataView(o.buffer);
  dv.setUint32(0, s.seed >>> 0, true);
  dv.setInt16(4, s.hp, true);
  dv.setUint16(6, s.gold, true);
  dv.setUint16(8, s.rolls, true);
  const bytes = [HEROES.findIndex((h) => h.id === s.hero), s.day, s.wins, s.losses, s.streak & 0xff, s.lastIncome.base, s.lastIncome.bonus,
    s.bonusSlots, s.slotBuys, s.ghost ? 1 : 0, s.pendingMark ? MARKS.indexOf(s.pendingMark) + 1 : 0, PHASES.indexOf(s.phase), s.conceded ? 1 : 0,
    s.wishes ?? 0, s.skills.length];
  o.set(bytes, 10);
  for (let i = 0; i < 5; i++) o[25 + i] = s.locks?.[i] ? 1 : 0;
  const sk: number[] = [];
  for (let i = 0; i < 8; i++) skillBytes(s.skills[i], sk);
  o.set(sk, 34);
  const sh: number[] = [];
  for (let i = 0; i < 5; i++) {
    const of = s.shop[i];
    if (!of) sh.push(0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    else { sh.push(1, sIdx(of.id), VARIANTS.indexOf(of.v as never), of.bonus?.length ?? 0); bonusBytes(of.bonus, sh); }
  }
  o.set(sh, 114);
  return o;
}

/** the chain's raw bytes → a TS RunState (used to resume / resync; log and rating are UI-only) */
export function runOf(b: Uint8Array, id: string): RunState {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const n = b[24];
  const s: RunState = {
    v: 7, id, seed: dv.getUint32(0, true), hero: HEROES[b[10]].id, day: b[11], hp: dv.getInt16(4, true), wins: b[12], losses: b[13],
    gold: dv.getUint16(6, true), streak: (b[14] << 24) >> 24, lastIncome: { base: b[15], bonus: b[16] }, bonusSlots: b[17], slotBuys: b[18],
    skills: Array.from({ length: n }, (_, i) => skillOf(b.subarray(34 + 10 * i, 44 + 10 * i))),
    shop: Array.from({ length: 5 }, (_, i) => {
      const x = b.subarray(114 + 10 * i, 124 + 10 * i);
      if (!x[0]) return null;
      const of: Offer = { id: SKILL_LIST[x[1]].id, v: VARIANTS[x[2]] };
      if (x[2] === 0) of.bonus = bonusOf(x.subarray(4, 10), x[3]);
      return of;
    }),
    rolls: dv.getUint16(8, true), ghost: !!b[19], pendingMark: b[20] ? MARKS[b[20] - 1] : null, phase: PHASES[b[21]], rating: 1000, log: [],
    ...(b[22] ? { conceded: true } : {}),
    locks: Array.from({ length: 5 }, (_, i) => !!b[25 + i]), wishes: b[23],
  };
  return s;
}
export function buildOf(b: Uint8Array): Build {
  return { hero: HEROES[b[0]].id, skills: Array.from({ length: b[1] }, (_, i) => skillOf(b.subarray(2 + 10 * i, 12 + 10 * i))) };
}
const eq = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

// ---------------- accounts ----------------
const u32 = (n: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n >>> 0, true); return b; };
const u16 = (n: number) => { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, n, true); return b; };
const prog = () => new PublicKey(cfg!.program);
const pda = (seeds: Uint8Array[]) => PublicKey.findProgramAddressSync(seeds, prog())[0];
const enc = (s: string) => new TextEncoder().encode(s);
const seasonPda = () => pda([enc('season'), u32(cfg!.season)]);
const poolPda = () => pda([enc('pool'), u32(cfg!.season), u16(cfg!.shard)]);
const rankPda = () => pda([enc('ranking'), u32(cfg!.season)]);
const playerPda = () => pda([enc('player'), u32(cfg!.season), me.publicKey.toBytes()]);
const hex = (h: string) => Uint8Array.from(h.match(/../g)!.map((x) => parseInt(x, 16)));
function ix(name: string, data: number[] | Uint8Array, keys: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[]) {
  const d = new Uint8Array(8 + data.length);
  d.set(hex(cfg!.disc[name]));
  d.set(data, 8);
  return new TransactionInstruction({ programId: prog(), keys, data: Buffer.from(d) });
}
const W = (pubkey: PublicKey, isSigner = false) => ({ pubkey, isSigner, isWritable: true });
const Rd = (pubkey: PublicKey, isSigner = false) => ({ pubkey, isSigner, isWritable: false });
const keysP = () => [Rd(me.publicKey, true), W(playerPda()), Rd(seasonPda())];
const keysF = () => [Rd(me.publicKey, true), W(playerPda()), W(poolPda()), W(rankPda()), Rd(seasonPda())];

async function send(ixs: TransactionInstruction[]): Promise<string> {
  const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), ...ixs);
  tx.feePayer = me.publicKey;
  tx.recentBlockhash = (await conn.getLatestBlockhash('confirmed')).blockhash;
  tx.sign(me);
  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true });
  for (let i = 0; i < 150; i++) {
    const st = (await conn.getSignatureStatuses([sig])).value[0];
    if (st?.err) {
      const t = await conn.getTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' }).catch(() => null);
      throw new Error(`transaction failed: ${(t?.meta?.logMessages ?? []).filter((l) => l.includes('Error') || l.includes('rejected')).slice(-2).join(' | ') || JSON.stringify(st.err)}`);
    }
    if (st && (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized')) return sig;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('transaction timeout');
}

// Player account offsets (8-byte discriminator + mochi-game Player layout v2)
const OFF = { status: 8 + 89, salt: 8, choices: 8 + 92, seed: 8 + 76, run: 8 + 96, lastOpp: 8 + 1413, lastDay: 8 + 1495, lastResult: 8 + 1496, lastKind: 8 + 1497, lastSeed: 8 + 1500 };
async function player(): Promise<Uint8Array | null> {
  const a = await conn.getAccountInfo(playerPda(), 'confirmed');
  return a ? new Uint8Array(a.data) : null;
}

// ---------------- public API for the UI ----------------
export const chainInfo = () => (cfg ? { wallet: me.publicKey.toBase58(), player: playerPda().toBase58(), season: cfg.season, rpc: cfg.rpc } : null);

/** Connect, create + fund the burner wallet and the season account if needed. Returns the chain's current run (if any). */
export async function chainConnect(): Promise<{ status: number; run: Uint8Array | null; seed: number | null }> {
  cfg = await (await fetch('/chain.json')).json();
  conn = new Connection(cfg!.rpc, 'confirmed');
  let k: Keypair | null = null;
  try {
    const s = localStorage.getItem('arena.chain.key');
    if (s) k = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(s)));
  } catch { /* none */ }
  if (!k) {
    k = Keypair.generate();
    try { localStorage.setItem('arena.chain.key', JSON.stringify([...k.secretKey])); } catch { /* private mode */ }
  }
  me = k;
  if ((await conn.getBalance(me.publicKey)) < 50_000_000) {
    // local validator / devnet faucet (devnet: rate limited)
    const sig = await conn.requestAirdrop(me.publicKey, 1_000_000_000);
    await conn.confirmTransaction(sig, 'confirmed');
  }
  let p = await player();
  if (!p) {
    await send([ix('init_player', [...u32(cfg!.season), ...u16(cfg!.shard)], [W(me.publicKey, true), W(playerPda()), W(poolPda()), Rd(SystemProgram.programId)])]);
    p = await player();
  }
  if (p && p.subarray(OFF.salt, OFF.salt + 8).every((x) => x === 0)) {
    const salt = crypto.getRandomValues(new Uint8Array(8));
    await send([ix('set_salt', salt, keysP())]);
    p = await player();
  }
  const status = p![OFF.status];
  return {
    status,
    run: status === 2 ? p!.slice(OFF.run, OFF.run + 164) : null,
    seed: status === 1 ? new DataView(p!.buffer).getUint32(OFF.seed, true) : null,
  };
}

/** Roll the run seed on chain (hero choices = heroChoices(seed), exactly as in TS). */
export async function chainBeginRun(): Promise<number> {
  let p = await player();
  if (p![OFF.status] !== 1) {
    await send([ix('begin_run', [], keysP())]);
    p = await player();
  }
  return new DataView(p!.buffer).getUint32(OFF.seed, true);
}

export async function chainPickHero(choice: number): Promise<void> {
  queue.length = 0;
  await send([ix('pick_hero', [choice], keysP())]);
}

/** An action the local TS rules accepted (runChain.ts calls this). */
export function chainQueue(code: number, a = 0, b = 0) {
  if (chainOn()) queue.push([code, a, b]);
}

function queueIxs(): TransactionInstruction[] {
  const out: TransactionInstruction[] = [];
  const q = queue.splice(0);
  if (q.length === 1) out.push(ix('act', [q[0][0], q[0][1] & 0xff, q[0][2] & 0xff], keysP()));
  for (let i = 0; q.length > 1 && i < q.length; i += 32) {
    const part = q.slice(i, i + 32);
    const d = new Uint8Array(4 + 3 * part.length);
    new DataView(d.buffer).setUint32(0, 3 * part.length, true);
    part.forEach(([c, a, b], j) => d.set([c, a & 0xff, b & 0xff], 4 + 3 * j));
    out.push(ix('act_batch', d, keysP()));
  }
  return out;
}

export interface ChainFight {
  seed: number;
  day: number;
  opp: Build;
  ghost: boolean;
  won: boolean;
  draw: boolean;
  /** chain run state after the fight */
  run: Uint8Array;
  sig: string;
}

/** Send the queued actions + the fight in one transaction; returns the fight as the chain resolved it. */
export async function chainFight(): Promise<ChainFight> {
  const sig = await send([...queueIxs(), ix('fight', [], keysF())]);
  const p = (await player())!;
  const dv = new DataView(p.buffer);
  const res = p[OFF.lastResult];
  return {
    seed: dv.getUint32(OFF.lastSeed, true), day: p[OFF.lastDay], opp: buildOf(p.subarray(OFF.lastOpp, OFF.lastOpp + 82)),
    ghost: p[OFF.lastKind] === 1, won: res === 2, draw: res === 1, run: p.slice(OFF.run, OFF.run + 164), sig,
  };
}

/** After a concede: send the queue + finish_run (archives the ghost, updates the ranking). */
export async function chainFinish(): Promise<void> {
  await send([...queueIxs(), ix('finish_run', [], keysF())]);
}

/** Byte-for-byte check of the local state against the chain's. */
export const sameAsChain = (local: RunState, chain: Uint8Array) => eq(runBytes(local), chain);
