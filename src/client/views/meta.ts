/**
 * Adapter for the meta endpoints (run rewards, profile, leaderboard, scouting).
 * The server side is being added separately; every call here fails soft (returns null) when an endpoint is missing
 * (404) or the server is down, so the screens show local data or nothing instead of breaking.
 * Responses are read loosely (several field names accepted) so small shape changes on the server don't break the UI.
 */
import { L, getLang } from '../../i18n';
import type { Build } from '../../sim/types';

// ---------- small local store (per-browser convenience; may be unavailable) ----------
function get(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function set(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* private mode */
  }
}
function getJSON<T>(key: string, dflt: T): T {
  try {
    const v = JSON.parse(get(key) ?? 'null') as T | null;
    return v ?? dflt;
  } catch {
    return dflt;
  }
}
const setJSON = (key: string, v: unknown) => set(key, JSON.stringify(v));

const num = (...xs: unknown[]): number | undefined => {
  for (const x of xs) if (typeof x === 'number' && Number.isFinite(x)) return x;
  return undefined;
};
const str = (...xs: unknown[]): string | undefined => {
  for (const x of xs) if (typeof x === 'string' && x) return x;
  return undefined;
};
type J = Record<string, any>;

async function call(url: string, init?: RequestInit): Promise<J | null> {
  try {
    const r = await fetch(url, { ...init, headers: { 'content-type': 'application/json' } });
    if (!r.ok) return null;
    return (await r.json()) as J;
  } catch {
    return null;
  }
}

// ---------- identity ----------
const PID_KEY = 'mochi.pid';
const SNAME_KEY = 'mochi.serverName';
/** Stable id of this browser's player (the server may hand out its own; see rememberFromFight). */
export function playerId(): string {
  let id = get(PID_KEY);
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
    set(PID_KEY, id);
  }
  return id;
}
/** Server-assigned default name (e.g. Mochi-4821), once the server sends one. */
export const serverName = () => get(SNAME_KEY);
/** Pick up the player id / default name if the fight response carries them. */
export function rememberFromFight(res: unknown) {
  const j = (res ?? {}) as J;
  const id = str(j.playerId, j.you?.id, j.player?.id, j.me?.id);
  if (id) set(PID_KEY, id);
  const nm = str(j.name, j.playerName, j.you?.name, j.player?.name, j.me?.name, j.defaultName);
  if (nm) set(SNAME_KEY, nm);
}

/** Label for an AI opponent's tier (strings or numbers), in the current language. */
export function tierLabel(tier: unknown): string {
  if (tier === undefined || tier === null || tier === '') return '';
  const t = String(tier).toLowerCase();
  const map: Record<string, string> = {
    easy: L('ง่าย', 'easy'), normal: L('ปกติ', 'normal'), medium: L('ปกติ', 'normal'), hard: L('ยาก', 'hard'), expert: L('เก่ง', 'expert'),
    elite: L('ระดับสูง', 'elite'), boss: L('บอส', 'boss'), bronze: L('ทองแดง', 'bronze'), silver: L('เงิน', 'silver'), gold: L('ทอง', 'gold'),
    platinum: L('แพลทินัม', 'platinum'), diamond: L('เพชร', 'diamond'),
  };
  if (map[t]) return map[t];
  if (/^\d+$/.test(t)) return L(`ระดับ ${t}`, `level ${t}`);
  return String(tier);
}

// ---------- finishRun ----------
export interface FinishRunBody {
  runId: string;
  playerId: string;
  name: string;
  hero: string;
  wins: number;
  losses: number;
  day: number;
  rating: number;
  conceded: boolean;
  won: boolean;
  build: Build;
}
export interface FinishRunResult {
  stardust: number;
  total?: number;
  runs?: number;
  bestWins?: number;
}
export async function finishRun(body: FinishRunBody): Promise<FinishRunResult | null> {
  const j = await call('/api/run/finish', { method: 'POST', body: JSON.stringify(body) });
  if (!j) return null;
  const stardust = num(j.stardust, j.reward?.stardust, j.reward, j.earned, j.gained);
  if (stardust === undefined) return null;
  return {
    stardust,
    total: num(j.player?.stardust, j.total, j.totals?.stardust, j.stardustTotal, j.balance, j.profile?.stardust),
    runs: num(j.player?.runs, j.totals?.runs, j.runs, j.profile?.runs),
    bestWins: num(j.player?.best?.wins, j.totals?.bestWins, j.bestWins, j.profile?.bestWins),
  };
}

// ---------- profile ----------
export interface RunSummary {
  runId: string;
  hero: string;
  wins: number;
  losses: number;
  days: number;
  stardust?: number;
  conceded?: boolean;
  at?: number;
  /** replay of the best fight of that run */
  bestFightId?: string;
  bestText?: string;
  /** English version of bestText (stored next to the Thai one so either language can show it) */
  bestTextEn?: string;
}
export interface Profile {
  name?: string;
  runs: number;
  wins: number;
  losses: number;
  stardust: number;
  bestWins: number;
  best?: RunSummary;
  last: RunSummary[];
  /** true = from this browser only (server had no profile) */
  local: boolean;
}
const runOf = (x: J): RunSummary => ({
  runId: String(x.runId ?? x.id ?? ''),
  hero: String(x.hero ?? ''),
  wins: num(x.wins) ?? 0,
  losses: num(x.losses) ?? 0,
  days: num(x.days, x.day) ?? 0,
  stardust: num(x.stardust, x.reward),
  conceded: !!x.conceded,
  at: num(x.at, x.endedAt, x.createdAt, x.finishedAt),
  bestFightId: str(x.bestFightId, x.best?.fightId, x.replayId),
  bestText: str(x.bestText, x.best?.text),
  bestTextEn: str(x.bestTextEn),
});
/** A run's best-fight line in the current language. */
export const runBestText = (r: RunSummary) => (getLang() === 'en' ? r.bestTextEn ?? r.bestText : r.bestText);
export async function getProfile(id: string): Promise<Profile | null> {
  const j = await call('/api/profile?playerId=' + encodeURIComponent(id));
  if (!j) return null;
  const p = (j.player ?? j.profile ?? j) as J; // server: { known, player: totals, recent: runs }
  const t = (p.totals ?? p) as J;
  const list = (j.recent ?? p.lastRuns ?? p.history ?? (Array.isArray(p.runs) ? p.runs : [])) as J[];
  const last = Array.isArray(list) ? list.map(runOf) : [];
  const best = p.best ? runOf(p.best) : p.bestRun ? runOf(p.bestRun) : last.reduce<RunSummary | undefined>((b, x) => (!b || x.wins > b.wins ? x : b), undefined);
  return {
    name: str(p.name),
    runs: num(t.runs, t.runCount) ?? last.length,
    wins: num(t.wins) ?? 0,
    losses: num(t.losses) ?? 0,
    stardust: num(t.stardust, t.dust) ?? 0,
    bestWins: num(t.bestWins, best?.wins) ?? 0,
    best,
    last,
    local: false,
  };
}

// ---------- leaderboard ----------
export type Period = 'season' | 'day';
export interface LbEntry {
  rank: number;
  name: string;
  score: number;
  wins?: number;
  hero?: string;
  me?: boolean;
}
export interface Leaderboard {
  entries: LbEntry[];
  /** what the score means, if the server says */
  scoreLabel?: string;
  me?: LbEntry;
}
export async function getLeaderboard(period: Period): Promise<Leaderboard | null> {
  const j = await call('/api/leaderboard?period=' + period + '&playerId=' + encodeURIComponent(playerId()));
  if (!j) return null;
  const rows = (Array.isArray(j) ? j : j.entries ?? j.rows ?? j.top ?? j.leaderboard ?? []) as J[];
  if (!Array.isArray(rows)) return null;
  const pid = playerId();
  const entries = rows.map((x, i) => ({
    rank: num(x.rank) ?? i + 1,
    name: String(x.name ?? x.playerName ?? '???'),
    score: num(x.score, x.wins, x.stardust, x.points, x.rating) ?? 0, // server ranks by wins
    wins: num(x.wins, x.bestWins),
    hero: str(x.hero),
    me: x.you === true || x.playerId === pid || x.me === true,
  }));
  const meRow = (Array.isArray(j) ? null : j.me) as J | null;
  return {
    entries,
    scoreLabel: Array.isArray(j) ? undefined : str(j.scoreLabel, j.metric),
    me: meRow ? { rank: num(meRow.rank) ?? 0, name: String(meRow.name ?? ''), score: num(meRow.score, meRow.stardust, meRow.points) ?? 0, me: true } : undefined,
  };
}

// ---------- scouting ----------
export interface Scout {
  /** archetype → share 0..1 */
  mix: Record<string, number>;
  /** how many saved builds the mix is from */
  total?: number;
  /** share of AI opponents 0..1 */
  ai?: number;
}
const scoutCache = new Map<string, Promise<Scout | null>>();
export function scout(day: number, rating: number, runId: string): Promise<Scout | null> {
  const key = `${runId}:${day}`;
  let p = scoutCache.get(key);
  if (!p) {
    p = (async () => {
      const j = await call(`/api/scout?day=${day}&rating=${Math.round(rating)}&runId=${encodeURIComponent(runId)}`);
      if (!j) return null;
      const raw = (j.pct ?? j.counts ?? j.mix ?? j.archetypes ?? j.arch ?? j) as J; // server: pct = whole percents
      const mix: Record<string, number> = {};
      for (const a of ['tank', 'burst', 'scaling', 'control']) {
        const v = num(raw[a], raw[a]?.share, raw[a]?.count);
        if (v !== undefined) mix[a] = v;
      }
      const sum = Object.values(mix).reduce((n, x) => n + x, 0);
      if (!sum) return null;
      if (sum > 1.01) for (const a in mix) mix[a] /= sum; // counts → shares
      return { mix, total: num(j.total, j.count, j.n) ?? (sum > 1.01 ? sum : undefined), ai: num(j.ai, j.aiShare) };
    })();
    scoutCache.set(key, p);
  }
  return p;
}

// ---------- local run memory (works offline and before the server has profiles) ----------
export interface FightNote {
  day: number;
  won: boolean;
  opp: string;
  fightId?: string;
  close: boolean;
  /** how memorable: close wins and comebacks score high */
  score: number;
  /** Thai (older notes: whatever language they were written in) */
  text: string;
  textEn?: string;
}
/** A fight note in the current language. */
export const noteText = (n: FightNote) => (getLang() === 'en' ? n.textEn ?? n.text : n.text);
const notesKey = (runId: string) => `mochi.fights.${runId}`;
export const fightNotes = (runId: string) => getJSON<FightNote[]>(notesKey(runId), []);
export function addFightNote(runId: string, n: FightNote) {
  const list = fightNotes(runId).filter((x) => x.day !== n.day);
  list.push(n);
  setJSON(notesKey(runId), list);
}
export function bestNote(runId: string): FightNote | null {
  return fightNotes(runId).reduce<FightNote | null>((b, x) => (!b || x.score > b.score ? x : b), null);
}

const HIST_KEY = 'mochi.history.v1';
export const localHistory = () => getJSON<RunSummary[]>(HIST_KEY, []);
export function saveLocalRun(r: RunSummary) {
  const list = localHistory().filter((x) => x.runId !== r.runId);
  list.unshift(r);
  setJSON(HIST_KEY, list.slice(0, 30));
}
export function localProfile(): Profile {
  const last = localHistory();
  const best = last.reduce<RunSummary | undefined>((b, x) => (!b || x.wins > b.wins ? x : b), undefined);
  return {
    runs: last.length,
    wins: last.reduce((n, x) => n + x.wins, 0),
    losses: last.reduce((n, x) => n + x.losses, 0),
    stardust: last.reduce((n, x) => n + (x.stardust ?? 0), 0),
    bestWins: best?.wins ?? 0,
    best,
    last,
    local: true,
  };
}

/** Reward of a finished run, remembered so reloading the end screen doesn't claim twice. */
const claimKey = (runId: string) => `mochi.claim.${runId}`;
export const claimed = (runId: string) => getJSON<FinishRunResult | { none: true } | null>(claimKey(runId), null);
export const rememberClaim = (runId: string, r: FinishRunResult | { none: true }) => setJSON(claimKey(runId), r);
