/**
 * Personal records and goals for the end-of-run screen: best wins, best win streak, biggest hit, crowns,
 * heroes played, stardust titles. Kept in this browser (localStorage, may be unavailable) and merged with the
 * server's profile numbers where the server sends them. Pure apart from storage.
 */
import { L } from '../../i18n';
import { HEROES, HEROES_BY_ID } from '../../sim/heroes';
import { WIN_TARGET } from '../../sim/run';
import { localHistory } from './meta';

export interface Records {
  runs: number;
  bestWins: number;
  bestStreak: number;
  bigHit: number;
  crowns: number;
  flawless: number;
  /** heroes that finished a run */
  heroes: string[];
  /** heroes that won the moon crown */
  crowned: string[];
}

/** One finished run, as the records see it. */
export interface RunStats {
  runId: string;
  hero: string;
  wins: number;
  losses: number;
  won: boolean;
  /** longest win streak of the run */
  streak: number;
  /** your biggest single hit of the run (0 = unknown) */
  hit: number;
}

/** Records before and after one run (fixed once per run, so a reload shows the same "new best!" badges). */
export interface Recap {
  prev: Records;
  cur: Records;
}

const KEY = 'mochi.records.v1';
const recapKey = (runId: string) => `mochi.recap.${runId}`;
function read<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null') as T | null;
  } catch {
    return null;
  }
}
function write(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* private mode / full: records are a convenience */
  }
}

const n0 = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? Math.floor(x) : 0);
const ids = (x: unknown) => (Array.isArray(x) ? x.filter((h): h is string => typeof h === 'string' && !!HEROES_BY_ID[h]) : []);
function clean(r: Partial<Records> | null): Records {
  return {
    runs: n0(r?.runs), bestWins: n0(r?.bestWins), bestStreak: n0(r?.bestStreak), bigHit: n0(r?.bigHit),
    crowns: n0(r?.crowns), flawless: n0(r?.flawless), heroes: ids(r?.heroes), crowned: ids(r?.crowned),
  };
}

/** Records of this browser (first use: rebuilt from the local run history, leaving out `skipRun`). */
export function loadRecords(skipRun?: string): Records {
  const saved = read<Partial<Records>>(KEY);
  if (saved) return clean(saved);
  const hist = localHistory().filter((h) => h.runId !== skipRun);
  return clean({
    runs: hist.length,
    bestWins: Math.max(0, ...hist.map((h) => h.wins)),
    heroes: [...new Set(hist.map((h) => h.hero))],
    crowns: hist.filter((h) => h.wins >= WIN_TARGET).length,
    crowned: [...new Set(hist.filter((h) => h.wins >= WIN_TARGET).map((h) => h.hero))],
  });
}

/** Longest run of wins in a run's fight log. */
export function bestStreakOf(log: { won: boolean }[]) {
  let best = 0;
  let cur = 0;
  for (const l of log) {
    cur = l.won ? cur + 1 : 0;
    best = Math.max(best, cur);
  }
  return best;
}

/** Records before / after this run. The first call per run updates the records; later calls return the same pair. */
export function recapFor(s: RunStats): Recap {
  const cached = read<Recap>(recapKey(s.runId));
  if (cached?.prev && cached.cur) return { prev: clean(cached.prev), cur: clean(cached.cur) };
  const prev = loadRecords(s.runId);
  const add = (list: string[], h: string) => (list.includes(h) ? list : [...list, h]);
  const cur: Records = {
    runs: prev.runs + 1,
    bestWins: Math.max(prev.bestWins, s.wins),
    bestStreak: Math.max(prev.bestStreak, s.streak),
    bigHit: Math.max(prev.bigHit, s.hit),
    crowns: prev.crowns + (s.won ? 1 : 0),
    flawless: prev.flawless + (s.won && s.losses === 0 ? 1 : 0),
    heroes: add(prev.heroes, s.hero),
    crowned: s.won ? add(prev.crowned, s.hero) : prev.crowned,
  };
  write(KEY, cur);
  write(recapKey(s.runId), { prev, cur });
  return { prev, cur };
}

export interface Fresh {
  kind: 'crown' | 'flawless' | 'wins' | 'streak' | 'hit' | 'hero';
  icon: string;
  text: string;
}

/**
 * New personal records of this run, most important first.
 * `serverBest` = best wins the server knows after this run (other devices): above this run's wins = not a record.
 */
export function freshRecords(s: RunStats, r: Recap, serverBest?: number): Fresh[] {
  const out: Fresh[] = [];
  const firstRun = r.prev.runs === 0;
  if (s.won && r.prev.crowns === 0) out.push({ kind: 'crown', icon: 'crown', text: L('มงกุฎแรกของคุณ!', 'Your first crown!') });
  else if (s.won && !r.prev.crowned.includes(s.hero))
    out.push({ kind: 'hero', icon: 'crown', text: L(`มงกุฎแรกของ ${HEROES_BY_ID[s.hero]?.name ?? s.hero}`, `First crown for ${HEROES_BY_ID[s.hero]?.name ?? s.hero}`) });
  if (s.won && s.losses === 0 && r.prev.flawless === 0) out.push({ kind: 'flawless', icon: 'sparkle', text: L('ไร้พ่ายครั้งแรก 10–0!', 'First flawless 10–0!') });
  const otherDevice = serverBest !== undefined && serverBest > s.wins;
  if (!s.won && !firstRun && s.wins > r.prev.bestWins && !otherDevice)
    out.push({ kind: 'wins', icon: 'trophy', text: L(`สถิติใหม่: ชนะ ${s.wins}!`, `New best: ${s.wins} wins!`) });
  if (!firstRun && s.streak >= 2 && s.streak > r.prev.bestStreak)
    out.push({ kind: 'streak', icon: 'fire', text: L(`ชนะติดยาวสุด: ${s.streak}`, `Longest win streak: ${s.streak}`) });
  if (!firstRun && s.hit > 0 && s.hit > r.prev.bigHit)
    out.push({ kind: 'hit', icon: 'boom', text: L(`ตีแรงสุดตลอดกาล: ${s.hit}`, `Biggest hit ever: ${s.hit}`) });
  return out;
}

// ---------- stardust titles (cosmetic: a name for how much stardust you have gathered) ----------
export const TITLES: { at: number; th: string; en: string }[] = [
  { at: 0, th: 'โมจิต้นอ่อน', en: 'Mochi Sprout' },
  { at: 60, th: 'ผู้โปรยดาว', en: 'Star Sprinkler' },
  { at: 200, th: 'นักสะสมผงดาว', en: 'Stardust Collector' },
  { at: 450, th: 'โคมแห่งราตรี', en: 'Night Lantern' },
  { at: 800, th: 'ผู้พิทักษ์จันทร์', en: 'Moon Guardian' },
  { at: 1300, th: 'ช่างทอดาว', en: 'Star Weaver' },
  { at: 2000, th: 'ปราชญ์ดวงจันทร์', en: 'Moon Sage' },
  { at: 3000, th: 'ตำนานดวงจันทร์', en: 'Moon Legend' },
];
const tName = (t: { th: string; en: string }) => L(t.th, t.en);
/** Title for a stardust total, the next one and how far along the way to it (0..1; 1 when there is no next). */
export function titleFor(total: number) {
  let i = 0;
  while (i + 1 < TITLES.length && total >= TITLES[i + 1].at) i++;
  const cur = TITLES[i];
  const next = TITLES[i + 1];
  const frac = next ? (total - cur.at) / (next.at - cur.at) : 1;
  return { name: tName(cur), next: next ? { name: tName(next), at: next.at } : null, frac: Math.max(0, Math.min(1, frac)), index: i };
}

/** One "what next" line. */
export function nextGoal(s: RunStats, r: Recap, winTarget: number): string {
  const untried = HEROES.filter((h) => !r.cur.heroes.includes(h.id)).length;
  const uncrowned = HEROES.filter((h) => !r.cur.crowned.includes(h.id)).length;
  if (s.won) {
    if (s.losses > 0 && r.cur.flawless === 0) return L(`เป้าต่อไป: มงกุฎแบบไร้พ่าย (ชนะ ${winTarget} แพ้ 0)`, `Next goal: a flawless crown (${winTarget} wins, 0 losses)`);
    if (uncrowned > 0) return L(`เป้าต่อไป: สวมมงกุฎให้ฮีโร่ตัวอื่น (ยังเหลือ ${uncrowned} ตัว)`, `Next goal: crown another hero (${uncrowned} still uncrowned)`);
    return L('เป้าต่อไป: ทำสถิติใหม่บนกระดานผู้นำ', 'Next goal: climb the leaderboard');
  }
  const best = r.cur.bestWins;
  if (s.wins < best) return L(`เป้าต่อไป: ชนะให้เกินสถิติ ${best} ครั้งของคุณ`, `Next goal: beat your best of ${best} wins`);
  if (r.cur.crowns === 0) {
    const t = Math.min(winTarget, s.wins + 1);
    return t >= winTarget
      ? L(`เป้าต่อไป: มงกุฎดวงจันทร์ (ชนะ ${winTarget})`, `Next goal: the moon crown (${winTarget} wins)`)
      : L(`เป้าต่อไป: ชนะ ${t} ครั้ง แล้วไปให้ถึงมงกุฎ`, `Next goal: ${t} wins, then on to the crown`);
  }
  if (untried > 0) return L(`เป้าต่อไป: ลองฮีโร่ที่ยังไม่เคยเล่น (เหลือ ${untried} ตัว)`, `Next goal: try a hero you have not played (${untried} left)`);
  return L('เป้าต่อไป: มงกุฎอีกใบ', 'Next goal: another crown');
}

// ---------- reveal timing (shared by the page's CSS delays and the sounds / count-ups) ----------
export interface RevealPlan {
  /** hero / crown drop */
  hero: number;
  star0: number;
  starGap: number;
  stats: number;
  reward: number;
  records: number;
  actions: number;
  /** everything is in place */
  total: number;
}
/** A full crown gets the long ceremony (~2.8 s); an early loss is over in about a second (tap skips either). */
export function revealPlan(won: boolean, wins: number): RevealPlan {
  if (won) return { hero: 200, star0: 450, starGap: 95, stats: 1450, reward: 1900, records: 2450, actions: 2650, total: 2900 };
  const gap = 70;
  const star0 = 200;
  const stats = star0 + Math.max(1, wins) * gap + 120;
  const reward = stats + 300;
  const records = reward + 400;
  const actions = Math.min(records + 100, 1700);
  return { hero: 0, star0, starGap: gap, stats, reward, records, actions, total: Math.max(actions, records) + 250 };
}
