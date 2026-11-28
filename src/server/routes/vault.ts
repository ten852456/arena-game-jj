// Account store API (v5.1 build plan task 3). Rules: src/shared/vault.ts.
//   GET  /api/vault?playerId=…           the store as of now (plus the town's crystal); nothing is created
//   POST /api/vault {playerId, ops}       player ops (keep a Save, equip / unequip a Seal or Kit), all-or-nothing
//   POST /api/admin/vault/grant {…}       admin only: give items to a tester or a bot (prototype, until the Seal
//                                         tray, crafting and the Tower make them)
// Items are only ever created by the server: a finished run (line rank, Saves) or the admin grant.
// TEST_CLOCK_SCALE (playtests only) speeds up the day and week the store counts (2 = the 3.5-day test week).
import * as F from '../../sim/farm';
import { HEROES_BY_ID } from '../../sim/heroes';
import type { Line } from '../../sim/types';
import * as V from '../../shared/vault';
import { cleanId } from '../game/validate';
import { bad, type Res } from '../http/http';
import { db, save } from '../store';

export const TEST_CLOCK_SCALE = Math.max(1, Math.min(3600, Number(process.env.TEST_CLOCK_SCALE ?? 1) || 1));
/** Moon Market open: weekly Moonstone is tradable (before that every piece is bound). Off for the prototype. */
export const MARKET_OPEN = process.env.MOON_MARKET === 'on';
const MAX_OPS = 16;

/** A player's store; `create` makes one (only server-side callers: run end and the admin grant). */
export function vaultOf(playerId: string, now: number, create = true): V.Vault | null {
  if (Object.hasOwn(db.vaults, playerId)) {
    const v = db.vaults[playerId];
    return v.v === V.VAULT_V ? v : (db.vaults[playerId] = V.loadVault(v, now, TEST_CLOCK_SCALE));
  }
  if (!create) return null;
  return (db.vaults[playerId] = V.newVault(now, TEST_CLOCK_SCALE));
}

/** heroes this account owns (a player who never opened the town has the starters) */
const ownedOf = (playerId: string): string[] => (Object.hasOwn(db.farms, playerId) ? db.farms[playerId].owned : F.STARTERS);

function view(v: V.Vault | null, playerId: string, now: number) {
  const crystal = Object.hasOwn(db.farms, playerId) ? db.farms[playerId].res.crystal : 0;
  return { stored: !!v, ...V.vaultView(v ?? V.newVault(now, TEST_CLOCK_SCALE), now, TEST_CLOCK_SCALE), crystal, marketOpen: MARKET_OPEN };
}

export function handleVaultGet(q: URLSearchParams): Res {
  const playerId = cleanId(q.get('playerId'));
  if (!playerId) return bad('bad request');
  const now = Date.now();
  return { status: 200, json: view(vaultOf(playerId, now, false), playerId, now) };
}

export function handleVaultOps(raw: unknown): Res {
  const body = raw as { playerId?: unknown; ops?: unknown } | null;
  const playerId = cleanId(body?.playerId);
  if (!playerId) return bad('bad request');
  const ops = body?.ops;
  if (!Array.isArray(ops) || !ops.length || ops.length > MAX_OPS) return bad('bad ops');
  const now = Date.now();
  const v = vaultOf(playerId, now, false);
  if (!v) return { status: 409, json: { error: 'nothing stored yet: finish a run first', at: 0 } };
  // all-or-nothing: apply to a copy, keep it only if every op passed
  const copy = structuredClone(v);
  const owned = ownedOf(playerId);
  for (let i = 0; i < ops.length; i++) {
    const err = V.applyVaultOp(copy, ops[i] as V.VaultOp, owned, now);
    if (err) return { status: 409, json: { error: err, at: i } };
  }
  db.vaults[playerId] = copy;
  save();
  return { status: 200, json: view(copy, playerId, now) };
}

/** Run end (meta.ts /finish): line rank and the Hero Book. */
export function onVaultRunEnd(playerId: string, r: Omit<V.RunEnd, 'line'>): { rank: number; saved: boolean } {
  const line = HEROES_BY_ID[r.hero]?.line as Line | undefined;
  if (!line) return { rank: 0, saved: false };
  const now = Date.now();
  const v = vaultOf(playerId, now)!;
  const out = V.onRunEnd(v, { ...r, line }, ownedOf(playerId).includes(r.hero), now, TEST_CLOCK_SCALE);
  save();
  return out;
}

/**
 * Admin grant (prototype): { playerId, grants: [{ kind: 'seal', line, grade, roll, timing } | { kind: 'kit', tier, line? }
 * | { kind: 'supply', id, n } | { kind: 'moonstone', n, source: 'weekly' | 'firstClear' } | { kind: 'balance', cents }] }.
 * All-or-nothing like the player ops.
 */
export function adminVaultGrant(raw: unknown): Res {
  const body = raw as { playerId?: unknown; grants?: unknown } | null;
  const playerId = cleanId(body?.playerId);
  const grants = body?.grants;
  if (!playerId || !Array.isArray(grants) || !grants.length || grants.length > 50) return bad('bad request');
  const now = Date.now();
  const v = structuredClone(vaultOf(playerId, now, false) ?? V.newVault(now, TEST_CLOCK_SCALE));
  const given: unknown[] = [];
  for (let i = 0; i < grants.length; i++) {
    const g = (grants[i] ?? {}) as Record<string, unknown>;
    let r: unknown;
    switch (g.kind) {
      case 'seal':
        r = V.addSeal(v, { line: g.line as Line, grade: g.grade as V.SealGrade, roll: g.roll as number, timing: g.timing as 'early' | 'late', mutated: g.mutated === true }, now);
        break;
      case 'kit':
        r = V.addKit(v, { tier: g.tier as V.KitTier, ...(g.line !== undefined ? { line: g.line as Line } : {}) }, now);
        break;
      case 'supply':
        r = V.addSupply(v, g.id as V.Supply, g.n as number, now) ?? { supply: g.id, n: g.n };
        break;
      case 'moonstone': {
        const n = V.grantMoonstone(v, g.n as number, g.source === 'firstClear' ? 'firstClear' : 'weekly', MARKET_OPEN, now, TEST_CLOCK_SCALE);
        r = { moonstone: n };
        break;
      }
      case 'balance':
        r = V.moveTestBalance(v, g.cents as number, now) ?? { balance: v.testBalance };
        break;
      default:
        r = 'bad grant';
    }
    if (typeof r === 'string') return { status: 409, json: { error: r, at: i } };
    given.push(r);
  }
  db.vaults[playerId] = v;
  save();
  return { status: 200, json: { given, vault: view(v, playerId, now) } };
}
