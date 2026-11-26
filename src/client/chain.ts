/**
 * On-chain mode (the default on this branch; `?chain=0` turns it off): the authoritative run lives in the `mochi-game` program (onchain/programs/mochi-game),
 * whose rules are the Rust port of src/sim (bit-exact, sim v22). Randomness: onchain/docs/RANDOMNESS.md.
 *
 * Wallets: the owner is Phantom (or a burner key with `&wallet=burner`). The owner signs twice, once:
 *   1. Solana: create the season account + its secret account, fund the session key (+ delegate both to the TEE)
 *   2. game RPC: approve the session key for ≤ 7 days (+ make the player account private to owner + session, and
 *      the secret account private to nobody)
 * After that a browser session key signs every action (no wallet popups) until it expires.
 *
 * How it plugs into the UI (sim v22, request + apply):
 * - DETERMINISTIC actions (buy, sell, move, lock, slot, pick relic, concede) play at once on the local TS RunState
 *   and are queued (runChain.ts); the queue goes out with the next chain transaction (act / act_batch);
 * - actions with a RANDOM outcome (fight, shop reroll, wish, last chance, place mark, relic reroll) can't be played
 *   locally: the browser does not know the run's secret. They are sent as the queue + `request_action` in one
 *   transaction; the program's VRF callback applies them; the UI then takes the chain's run state (`chainRoll`);
 * - a fight comes back with its opponent build, seed and day; the UI replays it with the TS sim;
 * - the run start waits for the run's VRF answer: the hero choices come from the chain.
 * Config: /chain.json (devnet + TEE) or /chain-local.json (`&net=local`, local validator; run
 * onchain/scripts/local-vrf.mjs there: it answers the randomness requests in place of the VRF oracle).
 */
import './chainPolyfill';
import { ComputeBudgetProgram, Connection, Keypair, PublicKey, SystemProgram, SYSVAR_SLOT_HASHES_PUBKEY, Transaction, TransactionInstruction } from '@solana/web3.js';
import { ed25519 } from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha256';
import bs58 from 'bs58';
import { HEROES } from '../sim/heroes';
import { MARKS, RUN_VERSION, type Offer, type RunState } from '../sim/run';
import { SKILL_LIST, VARIANTS } from '../sim/skills';
import { LINES, type Bonus, type Build, type SkillInstance } from '../sim/types';
import { BONUS_KINDS } from '../sim/links';
import { RELICS, RELIC_DAYS } from '../sim/relics';

export interface ChainConfig {
  mode?: 'local' | 'tee';
  /** Solana RPC (local validator or devnet) */
  rpc: string;
  /** TEE RPC path or URL (tee mode), e.g. "/tee" (dev-server proxy to devnet-tee.magicblock.app) */
  tee?: string;
  /** TEE validator identity (tee mode) */
  validator?: string;
  program: string;
  season: number;
  shard: number;
}

interface Phantom {
  isPhantom?: boolean;
  publicKey?: PublicKey;
  connect(opts?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: PublicKey }>;
  disconnect(): Promise<void>;
  signTransaction(tx: Transaction): Promise<Transaction>;
  on?(ev: 'accountChanged' | 'disconnect', cb: (pk?: PublicKey | null) => void): void;
}

const LOGIN_KEY = 'arena.chain.login';
/** this browser logged in before (reconnect without a popup on load) */
export const chainRemembered = () => { try { return localStorage.getItem(LOGIN_KEY) === '1'; } catch { return false; } };
export class NotLoggedIn extends Error {}
/** forget every on-chain key / token / login flag in this browser (the accounts on chain are untouched) */
export function chainResetBrowser(): void {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('arena.chain.')) localStorage.removeItem(k);
  } catch { /* private mode */ }
}
/** a new season (or &reset=1 in the URL) starts this browser clean */
function resetIfNewSeason(season: number): void {
  try {
    const url = new URL(location.href);
    if (url.searchParams.get('reset') === '1' || localStorage.getItem('arena.chain.season') !== String(season)) {
      console.info('[chain] step: clearing this browser\'s old chain data');
      chainResetBrowser();
      localStorage.setItem('arena.chain.season', String(season));
      if (url.searchParams.has('reset')) { url.searchParams.delete('reset'); history.replaceState(null, '', url); }
    }
  } catch { /* private mode */ }
}
/** keys in this browser: the burner owner, and one session key per owner wallet (so wallets never share one) */
const BURNER_KEY = 'arena.chain.burner';
const sessionStore = (o: PublicKey) => `arena.chain.key.${o.toBase58()}`;
function loadKey(name: string, create: boolean): Keypair | null {
  try {
    const s = localStorage.getItem(name);
    if (s) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(s)));
  } catch { /* none */ }
  if (!create) return null;
  const k = Keypair.generate();
  try { localStorage.setItem(name, JSON.stringify([...k.secretKey])); } catch { /* private mode */ }
  return k;
}
/**
 * One tab plays a wallet at a time (two tabs sending from the same session key would race on the same account).
 * `take` moves the game to this tab: the other tab is told and stops.
 */
let tabLockFor = '';
let releaseTab: (() => void) | null = null;
let onTabLost: () => void = () => {};
export const setOnTabLost = (f: () => void) => { onTabLost = f; };
async function lockTab(o: PublicKey, take: boolean): Promise<boolean> {
  const name = `mochi-chain-${o.toBase58()}`;
  if (tabLockFor === name) return true;
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  if (!locks) return true;
  return new Promise<boolean>((resolve) => {
    locks.request(name, take ? { steal: true } : { ifAvailable: true }, (lock) => {
      if (!lock) { resolve(false); return undefined; }
      tabLockFor = name;
      resolve(true);
      return new Promise<void>((r) => { releaseTab = r; });
    }).catch(() => {
      // another tab took the game (steal)
      if (tabLockFor === name) { tabLockFor = ''; releaseTab = null; onTabLost(); }
    });
  });
}
export class OtherTab extends Error {}
/** the chain changed under the UI (an earlier / outside action landed): resync, then retry */
export class StaleState extends Error {}
/** forget queued local actions (after a resync the local state they were built on is gone) */
export const chainDropQueue = () => { queue.length = 0; };

/** this branch is the on-chain version: chain mode is the default; `?chain=0` = the normal server game (tests, dev) */
export const chainOn = () => typeof location !== 'undefined' && new URLSearchParams(location.search).get('chain') !== '0';

let cfg: ChainConfig | null = null;
let base: Connection;
/** where gameplay runs and private state is read: the TEE (tee mode, with the session key's token) or Solana */
let game: Connection;
/** the wallet that owns the season account (Phantom, or the session key itself in burner mode) */
let owner: PublicKey;
let phantom: Phantom | null = null;
/** browser session key: signs (and pays for) gameplay transactions */
let session: Keypair;
const queue: [number, number, number][] = [];
const DLP = new PublicKey('DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh');
const PERMISSION_PROGRAM = new PublicKey('ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1');
const MAGIC_VAULT = new PublicKey('MagicVau1t999999999999999999999999999999999');
const MAGIC_PROGRAM = new PublicKey('Magic11111111111111111111111111111111111111');
const VRF_PROGRAM = new PublicKey('Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz');
const VRF_QUEUE = new PublicKey('5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc');
/** run.ts codes the program applies through request + VRF callback (10 = fight) */
export const RANDOM_CODES = new Set([3, 6, 7, 8, 10, 12]);

// ---------------- decoding (mochi-engine layouts: RunState 184 B, Build 93 B, skill 11 B) ----------------
const PHASES = ['shop', 'relic', 'lastchance', 'mark', 'won', 'dead'] as const;
const PENDING_SECRET = 255;
const bonusOf = (b: Uint8Array, nb: number): Bonus[] =>
  Array.from({ length: nb }, (_, j) => {
    const t = b[2 * j], e = b[2 * j + 1];
    return { t: t >= 200 ? 'line:' + LINES[t - 200] : SKILL_LIST[t].id, e: BONUS_KINDS[e] };
  });
/** 11 bytes: id, v, mark, star, nb, 3 × (target, kind) */
const skillOf = (b: Uint8Array): SkillInstance => {
  const k: SkillInstance = { id: SKILL_LIST[b[0]].id, v: VARIANTS[b[1]], bonus: bonusOf(b.subarray(5, 11), b[4]) };
  if (b[2]) k.mark = MARKS[b[2] - 1];
  if (b[3]) k.star = b[3];
  return k;
};
const relicsOf = (b: Uint8Array) => [...b].filter((r) => r !== 255).map((r) => RELICS[r].id);

/** 11 bytes: present, id, v, star, nb, 3 × (target, kind) */
function offerOf(x: Uint8Array): Offer | null {
  if (!x[0]) return null;
  const of: Offer = { id: SKILL_LIST[x[1]].id, v: VARIANTS[x[2]] };
  if (x[3]) of.star = x[3];
  if (x[2] === 0) of.bonus = bonusOf(x.subarray(5, 11), x[4]);
  return of;
}

/** the chain's 184 raw bytes → a TS RunState (log and rating are UI-only; the secret stays on chain) */
export function runOf(b: Uint8Array, id: string): RunState {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const n = b[25];
  const relics = relicsOf(b.subarray(31, 34));
  const offer = relicsOf(b.subarray(34, 37));
  const s: RunState = {
    v: RUN_VERSION, id, seed: dv.getUint32(0, true), hero: HEROES[b[10]].id, day: b[11], hp: dv.getInt16(4, true), wins: b[12], losses: b[13],
    gold: dv.getUint16(6, true), streak: (b[14] << 24) >> 24, lastIncome: { base: b[15], bonus: b[16] }, bonusSlots: b[17], slotBuys: b[18],
    skills: Array.from({ length: n }, (_, i) => skillOf(b.subarray(41 + 11 * i, 52 + 11 * i))),
    shop: Array.from({ length: 5 }, (_, i) => offerOf(b.subarray(129 + 11 * i, 140 + 11 * i))),
    rolls: dv.getUint16(8, true), ghost: !!b[19],
    // the last chance's mark: its kind is rolled on chain when it is placed (shown as a hidden mark until then)
    pendingMark: b[20] === PENDING_SECRET ? MARKS[0] : b[20] ? MARKS[b[20] - 1] : null,
    ...(b[20] === PENDING_SECRET ? { pendingHidden: true } : {}),
    phase: PHASES[b[21]], rating: 1000, log: [],
    ...(b[22] ? { conceded: true } : {}),
    locks: Array.from({ length: 5 }, (_, i) => !!b[26 + i]), wishes: b[23], wishMarks: b[24],
    ...(relics.length ? { relics } : {}),
    relicOffer: offer, relicDays: RELIC_DAYS.filter((_, i) => b[37] & (1 << i)), relicRolls: b[38],
  };
  return s;
}
/** 93 bytes: hero, n, relics[3], 8 × 11-byte skills */
export function buildOf(b: Uint8Array): Build {
  const relics = relicsOf(b.subarray(2, 5));
  return { hero: HEROES[b[0]].id, skills: Array.from({ length: b[1] }, (_, i) => skillOf(b.subarray(5 + 11 * i, 16 + 11 * i))), ...(relics.length ? { relics } : {}) };
}

// ---------------- accounts + instructions ----------------
const u32 = (n: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n >>> 0, true); return b; };
const u16 = (n: number) => { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, n, true); return b; };
const i64 = (n: number) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigInt64(0, BigInt(n), true); return b; };
const prog = () => new PublicKey(cfg!.program);
const pda = (seeds: Uint8Array[], p = prog()) => PublicKey.findProgramAddressSync(seeds, p)[0];
const enc = (s: string) => new TextEncoder().encode(s);
const seasonPda = () => pda([enc('season'), u32(cfg!.season)]);
const seasonSecretPda = () => pda([enc('season_secret'), u32(cfg!.season)]);
const poolPda = () => pda([enc('pool'), u32(cfg!.season), u16(cfg!.shard)]);
const rankPda = () => pda([enc('ranking'), u32(cfg!.season)]);
const playerPda = () => pda([enc('player'), u32(cfg!.season), owner.toBytes()]);
const secretPda = () => pda([enc('secret'), u32(cfg!.season), owner.toBytes()]);
/** anchor discriminator: sha256("global:<name>")[..8] */
const disc = (name: string) => sha256(enc(`global:${name}`)).subarray(0, 8);
function ix(name: string, data: number[] | Uint8Array, keys: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[]) {
  const d = new Uint8Array(8 + data.length);
  d.set(disc(name));
  d.set(data, 8);
  return new TransactionInstruction({ programId: prog(), keys, data: Buffer.from(d) });
}
const W = (pubkey: PublicKey, isSigner = false) => ({ pubkey, isSigner, isWritable: true });
const Rd = (pubkey: PublicKey, isSigner = false) => ({ pubkey, isSigner, isWritable: false });
/** the VRF request accounts after the program's own (`#[vrf]`: queue, identity, VRF program, slot hashes, system) */
const vrfTail = () => [W(VRF_QUEUE), Rd(pda([enc('identity')])), Rd(VRF_PROGRAM), Rd(SYSVAR_SLOT_HASHES_PUBKEY), Rd(SystemProgram.programId)];
const keysP = () => [Rd(session.publicKey, true), W(playerPda()), W(secretPda()), Rd(seasonPda())];
const keysBegin = () => [W(session.publicKey, true), W(playerPda()), W(secretPda()), Rd(seasonSecretPda()), Rd(seasonPda()), ...vrfTail()];
const keysReq = () => [W(session.publicKey, true), W(playerPda()), Rd(secretPda()), Rd(poolPda()), Rd(rankPda()), Rd(seasonPda()), ...vrfTail()];
const keysFinish = () => [Rd(session.publicKey, true), W(playerPda()), W(secretPda()), W(poolPda()), W(rankPda()), Rd(seasonPda())];
const tee = () => cfg!.mode === 'tee';

/** `delegate` / `set_permission` kinds (program K_*) */
const K_PLAYER = 0, K_SECRET = 1;
/** args of `delegate` / `set_permission`: kind u8, season u32, shard u16 */
const kindArgs = (kind: number) => [kind, ...u32(cfg!.season), ...u16(cfg!.shard)];
function delegateIx(kind: typeof K_PLAYER | typeof K_SECRET, acc: PublicKey): TransactionInstruction {
  return ix('delegate', kindArgs(kind), [
    Rd(owner, true),
    Rd(prog()), // season_acc: none (only the season secret's delegation needs it)
    W(pda([enc('buffer'), acc.toBytes()])),
    W(pda([enc('delegation'), acc.toBytes()], DLP)),
    W(pda([enc('delegation-metadata'), acc.toBytes()], DLP)),
    W(acc),
    Rd(new PublicKey(cfg!.validator!)),
    Rd(prog()),
    Rd(DLP),
    Rd(SystemProgram.programId),
  ]);
}
function permissionIx(kind: typeof K_PLAYER | typeof K_SECRET, acc: PublicKey): TransactionInstruction {
  return ix('set_permission', kindArgs(kind), [
    W(owner, true), Rd(prog()) /* season_acc: none */, W(acc), W(pda([enc('permission:'), acc.toBytes()], PERMISSION_PROGRAM)),
    Rd(PERMISSION_PROGRAM), W(MAGIC_VAULT), Rd(MAGIC_PROGRAM),
  ]);
}

async function confirm(c: Connection, sig: string): Promise<string> {
  for (let i = 0; i < 200; i++) {
    const st = (await c.getSignatureStatuses([sig])).value[0];
    if (st?.err) {
      const t = await c.getTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' }).catch(() => null);
      throw new Error(`transaction failed: ${(t?.meta?.logMessages ?? []).filter((l) => l.includes('Error') || l.includes('rejected')).slice(-2).join(' | ') || JSON.stringify(st.err)}`);
    }
    if (st && (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized')) return sig;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('transaction timeout');
}
/** gameplay: signed and paid by the session key */
async function sendSession(ixs: TransactionInstruction[]): Promise<string> {
  const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), ...ixs);
  tx.feePayer = session.publicKey;
  tx.recentBlockhash = (await game.getLatestBlockhash('confirmed')).blockhash;
  tx.sign(session);
  return confirm(game, await game.sendRawTransaction(tx.serialize(), { skipPreflight: true }));
}
/** setup: signed and paid by the owner (Phantom popup, or the burner key) */
async function sendOwner(c: Connection, ixs: TransactionInstruction[]): Promise<string> {
  const tx = new Transaction().add(...ixs);
  tx.feePayer = owner;
  tx.recentBlockhash = (await c.getLatestBlockhash('confirmed')).blockhash;
  if (phantom) {
    const signed = await within(phantom.signTransaction(tx), 180_000, 'Phantom approval');
    return confirm(c, await c.sendRawTransaction(signed.serialize(), { skipPreflight: true }));
  }
  tx.sign(session);
  return confirm(c, await c.sendRawTransaction(tx.serialize(), { skipPreflight: true }));
}

/** TEE RPC token for the session key (signs the login challenge itself: no wallet popup) */
async function teeToken(url: string): Promise<string> {
  const k = 'arena.chain.teeToken';
  try {
    const t = JSON.parse(localStorage.getItem(k) ?? 'null');
    if (t && t.pk === session.publicKey.toBase58() && t.exp > Date.now() + 3600e3) return t.token;
  } catch { /* none */ }
  const { challenge } = await (await fetch(`${url}/auth/challenge?pubkey=${session.publicKey.toBase58()}`)).json();
  const sig = ed25519.sign(new TextEncoder().encode(challenge), session.secretKey.slice(0, 32));
  const r = await (await fetch(`${url}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pubkey: session.publicKey.toBase58(), challenge, signature: bs58.encode(sig) }) })).json();
  if (!r.token) throw new Error('TEE login failed');
  try { localStorage.setItem(k, JSON.stringify({ pk: session.publicKey.toBase58(), token: r.token, exp: r.expiresAt ?? Date.now() + 29 * 86400e3 })); } catch { /* private mode */ }
  return r.token;
}

/** Player account offsets (8-byte discriminator + mochi-game Player, layout 4) */
const OFF = {
  vrfSlot: 8, pendSlot: 8 + 8, sessionExpiry: 8 + 32, sessionKey: 8 + 72, runNo: 8 + 208, bestScore: 8 + 216, lastSeed: 8 + 224,
  lookSeed: 8 + 220, revealedRun: 8 + 232, pendReq: 8 + 236, seat: 8 + 252, status: 8 + 253, lastDay: 8 + 255, lastResult: 8 + 256, lastKind: 8 + 257,
  pendState: 8 + 263, choices: 8 + 264, run: 8 + 268, prev: 8 + 268 + 184, lastOpp: 8 + 268 + 184 + 93,
  /** after run, prev, last_opp, journal (1323), claim_proof (128): the day-1 shop of each offered hero */
  preview: 8 + 268 + 184 + 93 + 93 + 1323 + 128,
};
const ST = { IDLE: 0, PICK: 1, RUN: 2, ENDED: 3, FINAL: 4, WAIT_VRF: 5 } as const;
async function player(c = game): Promise<Uint8Array | null> {
  const a = await c.getAccountInfo(playerPda(), 'confirmed');
  return a ? new Uint8Array(a.data) : null;
}
const dvOf = (p: Uint8Array) => new DataView(p.buffer, p.byteOffset, p.byteLength);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** reject with a clear message if a step takes too long (instead of hanging on "connecting") */
function within<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${what}: no answer after ${Math.round(ms / 1000)} s`)), ms))]);
}
/**
 * Wait for the program's VRF callback: poll the player until `done`. After a while without an answer, ask the
 * program to re-send the SAME request (`retry`, refused by the program until its timeout); give up after `ms`.
 */
async function waitRandom(done: (p: Uint8Array) => boolean, retry: () => TransactionInstruction, what: string, ms = 120_000): Promise<Uint8Array> {
  const t0 = Date.now();
  let nextRetry = t0 + 20_000;
  for (;;) {
    const p = await player();
    if (p && done(p)) return p;
    if (Date.now() > t0 + ms) throw new Error(`${what}: no randomness answer after ${Math.round(ms / 1000)} s`);
    if (Date.now() > nextRetry) {
      nextRetry = Date.now() + 20_000;
      await sendSession([retry()]).catch(() => { /* not timed out yet */ });
    }
    await sleep(250);
  }
}

// ---------------- public API for the UI ----------------
export const chainInfo = () => (cfg && owner && session ? { mode: cfg.mode ?? 'local', owner: owner.toBase58(), session: session.publicKey.toBase58(), phantom: !!phantom, player: playerPda().toBase58(), season: cfg.season } : null);
export interface ChainStart {
  status: number;
  /** the run in progress (status RUN / ENDED) */
  run: Uint8Array | null;
  /** hero choices of the run being started (status PICK) */
  choices: string[] | null;
  /** their day-1 shops (card bonuses), shown before the pick */
  preview: Record<string, (Offer | null)[]> | null;
  /** a random action was requested and waits for its VRF answer (e.g. the page was reloaded meanwhile) */
  pending: boolean;
  /** the run's cosmetic seed (public, set with the hero choices): the offered heroes' looks = the run's look */
  lookSeed: number;
}
/** the day-1 shop of each offered hero, published by the program with the hero choices */
const previewOf = (p: Uint8Array): Record<string, (Offer | null)[]> =>
  Object.fromEntries(choicesOf(p).map((h, i) => [h, Array.from({ length: 5 }, (_, k) => offerOf(p.subarray(OFF.preview + 55 * i + 11 * k, OFF.preview + 55 * i + 11 * (k + 1))))]));
const choicesOf = (p: Uint8Array) => [...p.subarray(OFF.choices, OFF.choices + 3)].map((h) => HEROES[h].id);
const startOf = (p: Uint8Array): ChainStart => {
  const st = p[OFF.status];
  return { status: st, run: st === ST.RUN || st === ST.ENDED ? p.slice(OFF.run, OFF.run + 184) : null, choices: st === ST.PICK ? choicesOf(p) : null, preview: st === ST.PICK ? previewOf(p) : null, pending: p[OFF.pendState] === 1, lookSeed: dvOf(p).getUint32(OFF.lookSeed, true) };
};

/**
 * Connect the owner wallet, set up the season account, its secret account and the session key if needed (≤ 2
 * owner signatures, first time only), and return the chain's current run (if any).
 */
export async function chainConnect(onStatus: (s: string) => void = () => {}, silent = false, take = false): Promise<ChainStart> {
  // &net=local: the local validator config; default: /chain.json (devnet + TEE)
  cfg = await (await fetch(new URLSearchParams(location.search).get('net') === 'local' ? '/chain-local.json' : '/chain.json', { cache: 'no-store' })).json();
  resetIfNewSeason(cfg!.season);
  base = new Connection(cfg!.rpc, 'confirmed');
  owner = undefined as unknown as PublicKey;
  session = undefined as unknown as Keypair;
  const w = window as unknown as { phantom?: { solana?: Phantom }; solana?: Phantom };
  const ph = w.phantom?.solana ?? (w.solana?.isPhantom ? w.solana : undefined);
  const burner = new URLSearchParams(location.search).get('wallet') === 'burner';
  const say = (state: ChainStatus, msg: string) => { console.info('[chain] step:', msg || state); setChainStatus(state, msg); onStatus(msg); };
  if (ph && !burner) {
    say('connecting', 'connecting Phantom…');
    phantom = ph;
    try {
      owner = (await within(ph.connect(silent ? { onlyIfTrusted: true } : undefined), silent ? 15_000 : 120_000, 'Phantom connect (open / unlock Phantom)')).publicKey;
    } catch (e) {
      phantom = null;
      setChainStatus('loggedout');
      throw silent ? new NotLoggedIn('not logged in') : e;
    }
    ph.on?.('accountChanged', () => location.reload());
    session = loadKey(sessionStore(owner), true)!;
  } else {
    phantom = null;
    session = loadKey(BURNER_KEY, true)!;
    owner = session.publicKey;
  }
  if (!(await lockTab(owner, take))) {
    setChainStatus('othertab');
    throw new OtherTab('this wallet is already playing in another tab');
  }
  if (tee()) {
    const url = cfg!.tee!.startsWith('/') ? `${location.origin}${cfg!.tee}` : cfg!.tee!;
    say('connecting', 'logging in to the MagicBlock TEE…');
    game = new Connection(`${url}?token=${await within(teeToken(url), 30_000, 'TEE login')}`, 'confirmed');
  } else {
    game = base;
    for (const pk of [owner, session.publicKey]) {
      if ((await base.getBalance(pk)) < 50_000_000) await base.confirmTransaction(await base.requestAirdrop(pk, 1_000_000_000), 'confirmed');
    }
  }
  say('connecting', 'checking your devnet SOL…');
  if (tee() && (await within(base.getBalance(owner), 30_000, 'devnet RPC (balance)')) < 20_000_000) throw new Error(`wallet ${owner.toBase58()} needs devnet SOL (≥ 0.02): turn on Testnet Mode in Phantom → Solana Devnet and get SOL from faucet.solana.com`);
  say('connecting', 'looking for your season account…');
  const fresh = !(await base.getAccountInfo(playerPda(), 'confirmed'));
  if (!fresh && tee() && !owner.equals(session.publicKey) && (await base.getBalance(session.publicKey)) < 3_000_000) {
    say('approve', 'approve in your wallet: 0.01 SOL for this browser\'s game key (pays its fees)');
    await sendOwner(base, [SystemProgram.transfer({ fromPubkey: owner, toPubkey: session.publicKey, lamports: 10_000_000 })]);
  }
  if (fresh) {
    say('approve', 'approve 1/2 in your wallet: create your season account');
    const ixs = [ix('init_player', [...u32(cfg!.season), ...u16(cfg!.shard)], [W(owner, true), W(playerPda()), W(secretPda()), Rd(SystemProgram.programId)])];
    if (tee()) {
      if (!owner.equals(session.publicKey)) ixs.push(SystemProgram.transfer({ fromPubkey: owner, toPubkey: session.publicKey, lamports: 10_000_000 }));
      ixs.push(delegateIx(K_PLAYER, playerPda()), delegateIx(K_SECRET, secretPda()));
    }
    await sendOwner(base, ixs);
  }
  const waitPlayer = async (what: string) => {
    say('connecting', what);
    let q: Uint8Array | null = null;
    for (let i = 0; i < 60 && !(q = await player()); i++) await sleep(1500);
    if (!q) throw new Error('season account not visible on the game RPC');
    return q;
  };
  const burnerOwner = owner.equals(session.publicKey);
  let p: Uint8Array | null = null;
  if (fresh || burnerOwner) p = await waitPlayer(tee() ? 'waiting for your account on the TEE…' : 'reading your account…');
  else {
    say('connecting', 'reading your account…');
    for (let i = 0; i < 3 && !(p = await player()); i++) await sleep(1000);
  }
  // owner signature 2 (first time / new browser key / after expiry): approve this browser's key (+ privacy on the TEE:
  // player = owner + session; secret = nobody)
  const live = !!p && new PublicKey(p.subarray(OFF.sessionKey, OFF.sessionKey + 32)).equals(session.publicKey) && Number(dvOf(p).getBigInt64(OFF.sessionExpiry, true)) > Date.now() / 1000 + 600;
  if (!live && !burnerOwner) {
    say('approve', 'approve 2/2 in your wallet: let this browser play for 7 days');
    const ixs = [ix('set_session', [...session.publicKey.toBytes(), ...i64(Math.floor(Date.now() / 1000) + 7 * 86400 - 120)], [Rd(owner, true), W(playerPda())])];
    if (tee()) ixs.push(permissionIx(K_PLAYER, playerPda()), permissionIx(K_SECRET, secretPda()));
    await sendOwner(game, ixs);
    p = await waitPlayer('reading your account…');
  } else if (!live && tee()) {
    await sendOwner(game, [permissionIx(K_PLAYER, playerPda()), permissionIx(K_SECRET, secretPda())]);
  }
  if (p![OFF.seat] === 255) {
    await sendSession([ix('join_pool', [], [Rd(session.publicKey, true), W(playerPda()), W(poolPda())])]);
    p = await player();
  }
  try { localStorage.setItem(LOGIN_KEY, '1'); } catch { /* private mode */ }
  say('ready', '');
  return startOf(p!);
}

/** Start a run: one VRF request; returns the hero choices (+ their day-1 shops) once the program's callback answered. */
export async function chainBeginRun(): Promise<{ choices: string[]; preview: Record<string, (Offer | null)[]>; lookSeed: number }> {
  let p = (await player())!;
  if (p[OFF.status] === ST.IDLE) {
    setChainStatus('sending', 'rolling your run on chain…');
    await sendSession([ix('begin_run', [], keysBegin())]);
  }
  p = await waitRandom((q) => q[OFF.status] === ST.PICK, () => ix('retry_vrf', [], keysBegin()), 'run start');
  setChainStatus('ready');
  return { choices: choicesOf(p), preview: previewOf(p), lookSeed: dvOf(p).getUint32(OFF.lookSeed, true) };
}

/** Pick offered hero `choice` (index); returns the new run's state. */
export async function chainPickHero(choice: number): Promise<Uint8Array> {
  queue.length = 0;
  await sendSession([ix('pick_hero', [choice], keysP())]);
  return (await player())!.slice(OFF.run, OFF.run + 184);
}

/** A deterministic action the local TS rules accepted (runChain.ts calls this); sent with the next transaction. */
export function chainQueue(code: number, a = 0, b = 0) {
  if (chainOn() && !RANDOM_CODES.has(code)) queue.push([code, a, b]);
}
export const chainQueued = () => queue.length;

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

/** Send the queued deterministic actions now (e.g. before leaving the shop for a while). */
export async function chainFlush(): Promise<void> {
  const ixs = queueIxs();
  if (ixs.length) await sendSession(ixs);
}

export interface ChainFight {
  seed: number;
  day: number;
  /** the build the chain fought with (its journal's day entry): the replay uses it, not the local build */
  build: Build;
  opp: Build;
  ghost: boolean;
  won: boolean;
  draw: boolean;
  /** chain run state after the fight */
  run: Uint8Array;
  sig: string;
}

/**
 * An action with a random outcome (RANDOM_CODES): the queue + request_action in ONE transaction, then wait for the
 * program's VRF callback to apply it. Returns the chain's run state after it (the UI takes it as is).
 */
export async function chainRoll(code: number, a = 0, b = 0, what = 'rolling on chain…'): Promise<{ run: Uint8Array; player: Uint8Array; sig: string }> {
  if (!RANDOM_CODES.has(code)) throw new Error(`code ${code} is not a random action`);
  setChainStatus('sending', what);
  let sig: string;
  const before = (await player())!;
  const req0 = dvOf(before).getUint32(OFF.pendReq, true);
  try {
    if (before[OFF.pendState] === 1) {
      // an earlier request (reload, another device) still waits: let it land first, never pass its result off as this
      // action's. The local queue was built on a state that is gone: drop it. The UI resyncs and the player retries.
      queue.length = 0;
      await waitRandom((q) => q[OFF.pendState] === 0, () => ix('retry_request', [], keysReq()), 'earlier action');
      throw new StaleState('an earlier action was still waiting on chain and has now been applied: check the new state, then try again');
    }
    sig = await sendSession([...queueIxs(), ix('request_action', [code, a & 0xff, b & 0xff], keysReq())]);
    const p = await waitRandom((q) => q[OFF.pendState] === 0 && dvOf(q).getUint32(OFF.pendReq, true) >= req0 + 1, () => ix('retry_request', [], keysReq()), what);
    setChainStatus('ready');
    return { run: p.slice(OFF.run, OFF.run + 184), player: p, sig };
  } catch (e) {
    setChainStatus('error', (e as Error).message);
    throw e;
  }
}

/** A request sent before (e.g. before a reload) still waits: wait for its answer, return the run after it. */
export async function chainWaitPending(): Promise<Uint8Array> {
  setChainStatus('sending', 'waiting for your last action on chain…');
  const p = await waitRandom((q) => q[OFF.pendState] === 0, () => ix('retry_request', [], keysReq()), 'last action');
  setChainStatus('ready');
  return p.slice(OFF.run, OFF.run + 184);
}

/** The fight (request + VRF callback); returns it as the chain resolved it. */
export async function chainFight(): Promise<ChainFight> {
  const r = await chainRoll(10, 0, 0, 'fight on chain…');
  const p = r.player;
  const dv = dvOf(p);
  const res = p[OFF.lastResult];
  const f: ChainFight = {
    seed: dv.getUint32(OFF.lastSeed, true), day: p[OFF.lastDay], build: buildOf(p.subarray(OFF.prev, OFF.prev + 93)), opp: buildOf(p.subarray(OFF.lastOpp, OFF.lastOpp + 93)),
    ghost: p[OFF.lastKind] === 1, won: res === 2, draw: res === 1, run: r.run, sig: r.sig,
  };
  noteChainFight(f);
  return f;
}

/** After a concede: send the queue (with the concede) + finish_run (archives the ghost, updates the ranking). */
export async function chainFinish(): Promise<void> {
  await sendSession([...queueIxs(), ix('finish_run', [], keysFinish())]);
}

/** The chain's current run (resync after an error). */
export async function chainState(): Promise<ChainStart | null> {
  const p = await player();
  return p ? startOf(p) : null;
}

// ---------------- what the chain UI shows (chainUi.ts) ----------------
export type ChainStatus = 'off' | 'loggedout' | 'othertab' | 'connecting' | 'approve' | 'ready' | 'sending' | 'error';
let status: { state: ChainStatus; msg: string } = { state: chainOn() ? 'connecting' : 'off', msg: '' };
const listeners: (() => void)[] = [];
export const onChain = (f: () => void) => listeners.push(f);
export const chainStatus = () => status;
export function setChainStatus(state: ChainStatus, msg = '') {
  status = { state, msg };
  for (const f of listeners) f();
}
export interface LastFight { day: number; won: boolean; draw: boolean; ghost: boolean; seed: number; sig: string; at: number }
let lastFight: LastFight | null = null;
export const chainLastFight = () => lastFight;
export function noteChainFight(f: ChainFight) {
  lastFight = { day: f.day, won: f.won, draw: f.draw, ghost: f.ghost, seed: f.seed, sig: f.sig, at: Date.now() };
  for (const g of listeners) g();
}

export interface ChainProfile {
  mode: 'local' | 'tee';
  network: string;
  owner: string;
  phantom: boolean;
  session: string;
  sessionExpiresAt: number | null;
  player: string;
  program: string;
  season: number;
  ownerSol: number;
  sessionSol: number;
  runsStarted: number;
  bestScore: number;
  status: string;
  run: { hero: string; day: number; wins: number; losses: number; hp: number; gold: number; phase: string } | null;
}
const STATUS_NAMES = ['idle', 'picking a hero', 'in a run', 'run ended', 'season finalized', 'waiting for randomness'];

/** Everything the profile window shows, read from the chain (the session key can read the private account). */
export async function chainProfile(): Promise<ChainProfile | null> {
  if (!cfg || !owner || !session) return null;
  const p = await player().catch(() => null);
  const [ownerSol, sessionSol] = await Promise.all([base.getBalance(owner).catch(() => 0), base.getBalance(session.publicKey).catch(() => 0)]);
  const dv = p ? new DataView(p.buffer) : null;
  const run = p && p[OFF.status] === 2 ? runOf(p.slice(OFF.run, OFF.run + 184), 'x') : null;
  const sessionLive = p && new PublicKey(p.subarray(OFF.sessionKey, OFF.sessionKey + 32)).equals(session.publicKey);
  return {
    mode: cfg.mode ?? 'local',
    network: cfg.mode === 'tee' ? 'Solana devnet + MagicBlock TEE' : 'local validator',
    owner: owner.toBase58(), phantom: !!phantom, session: session.publicKey.toBase58(),
    sessionExpiresAt: sessionLive && dv ? Number(dv.getBigInt64(OFF.sessionExpiry, true)) * 1000 : null,
    player: playerPda().toBase58(), program: cfg.program, season: cfg.season,
    ownerSol: ownerSol / 1e9, sessionSol: sessionSol / 1e9,
    runsStarted: dv ? dv.getUint32(OFF.runNo, true) : 0, bestScore: dv ? dv.getUint32(OFF.bestScore, true) : 0,
    status: p ? STATUS_NAMES[p[OFF.status]] ?? '?' : 'no account yet',
    run: run ? { hero: run.hero, day: run.day, wins: run.wins, losses: run.losses, hp: run.hp, gold: run.gold, phase: run.phase } : null,
  };
}

/** Owner revokes this browser's session key (wallet popup); the next action asks for a new approval. */
export async function chainRevoke(): Promise<void> {
  if (!cfg || !owner || !session || owner.equals(session.publicKey)) throw new Error('nothing to revoke (burner wallet)');
  await sendOwner(game, [ix('revoke_session', [], [Rd(owner, true), W(playerPda())])]);
}

export const explorerUrl = (addr: string, kind: 'address' | 'tx' = 'address') =>
  cfg?.mode === 'tee' ? `https://explorer.solana.com/${kind}/${addr}?cluster=devnet` : `https://explorer.solana.com/${kind}/${addr}?cluster=custom&customUrl=${encodeURIComponent(cfg?.rpc ?? '')}`;

/**
 * Log out: return the session key's leftover SOL to the wallet (best effort), forget the session key and the TEE
 * token in this browser, disconnect Phantom. The season account stays on chain, owned by the wallet: logging in
 * again (on any browser) continues it after approving a new session key.
 */
export async function chainLogout(): Promise<void> {
  if (cfg && session && owner && !owner.equals(session.publicKey)) {
    try {
      const bal = await base.getBalance(session.publicKey);
      const fee = 5000;
      if (bal > fee) {
        const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: session.publicKey, toPubkey: owner, lamports: bal - fee }));
        tx.feePayer = session.publicKey;
        tx.recentBlockhash = (await base.getLatestBlockhash('confirmed')).blockhash;
        tx.sign(session);
        await confirm(base, await base.sendRawTransaction(tx.serialize(), { skipPreflight: true }));
      }
    } catch (e) {
      console.warn('[chain] could not return the session SOL', e);
    }
  }
  try { await phantom?.disconnect(); } catch { /* already */ }
  const mine = owner && session && !owner.equals(session.publicKey) ? [sessionStore(owner)] : [];
  releaseTab?.();
  releaseTab = null;
  tabLockFor = '';
  for (const k of [...mine, 'arena.chain.key', 'arena.chain.teeToken', LOGIN_KEY]) {
    try { localStorage.removeItem(k); } catch { /* private mode */ }
  }
  phantom = null;
  cfg = null;
  queue.length = 0;
  lastFight = null;
  setChainStatus('loggedout');
}
