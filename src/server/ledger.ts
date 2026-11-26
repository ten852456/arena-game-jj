// Mint / burn ledger (design meeting 2026-11-26, "measure faucets against drains", EVE-style): per Bangkok day, how
// much of each resource the game created (mint) and destroyed (burn). /admin shows it; the target for wood and ore is
// a burn/mint ratio of 0.8–1.0. Kept in db.json, last LEDGER_DAYS days.
import { bkDay } from '../sim/farm';
import { db, save } from './store';
import type { Res } from './http';

export type LedgerRes = 'wood' | 'ore' | 'crystal' | 'stardust' | 'tickets';
const LEDGER_DAYS = 120;

export function ledgerAdd(res: LedgerRes, kind: 'mint' | 'burn', n: number) {
  if (!(n > 0)) return;
  const day = bkDay(Date.now());
  const row = (db.ledger[day] ??= {});
  const k = `${res}:${kind}`;
  row[k] = (row[k] ?? 0) + n;
  const days = Object.keys(db.ledger).sort();
  for (const d of days.slice(0, Math.max(0, days.length - LEDGER_DAYS))) delete db.ledger[d];
  save();
}

/** GET /api/admin/economy?days=30 → per day and per resource: mint, burn, ratio */
export function adminEconomy(q: URLSearchParams): Res {
  const n = Math.max(1, Math.min(LEDGER_DAYS, Number(q.get('days')) || 30));
  const days = Object.keys(db.ledger).sort().slice(-n);
  const RES: LedgerRes[] = ['wood', 'ore', 'crystal', 'stardust', 'tickets'];
  const rows = days.map((day) => ({
    day,
    ...Object.fromEntries(RES.map((r) => [r, { mint: Math.round(db.ledger[day][`${r}:mint`] ?? 0), burn: Math.round(db.ledger[day][`${r}:burn`] ?? 0) }])),
  }));
  const total = Object.fromEntries(
    RES.map((r) => {
      const mint = days.reduce((a, d) => a + (db.ledger[d][`${r}:mint`] ?? 0), 0);
      const burn = days.reduce((a, d) => a + (db.ledger[d][`${r}:burn`] ?? 0), 0);
      return [r, { mint: Math.round(mint), burn: Math.round(burn), ratio: mint ? Math.round((burn / mint) * 100) / 100 : null }];
    }),
  );
  return { status: 200, json: { days: n, rows, total, target: { wood: [0.8, 1], ore: [0.8, 1] } } };
}
