// Simulator work units. Every job is a pure function of its input (seeded), so results do not depend on
// which worker ran it or in what order; the main thread merges them in job order → deterministic report.
import { BOT_TIERS, aiBuild, aiRun, botDay, botRules, randomAiBuild, type BotTier } from '../../src/sim/bot';
import { simulate } from '../../src/sim/combat';
import { HEROES, HEROES_BY_ID, ultLevel } from '../../src/sim/heroes';
import { Rng, hashSeed } from '../../src/sim/rng';
import { WIN_TARGET, applyMark, chooseLastChance, newRun, recordResult, toBuild } from '../../src/sim/run';
import { lvOf } from '../../src/sim/skills';
import type { Build } from '../../src/sim/types';
import { addFight, factsOf, newHealth, type Health } from './metrics';
import { runLinesJob, type LinesJob } from './lines';

export type TierSpec = BotTier | 'mix';
export interface Ctx {
  seed: number;
  tier: TierSpec;
}

/** The tier a bot plays with: fixed, or (mix) rolled from its own key so it is stable for that bot. */
export const tierOf = (c: Ctx, ...key: (string | number)[]): BotTier =>
  c.tier === 'mix' ? BOT_TIERS[hashSeed(c.seed, 'tier', ...key) % BOT_TIERS.length] : c.tier;

export const MAX_DAY = 25;

export type Job =
  | { k: 'builds'; c: Ctx; day: number; hero: string; from: number; to: number }
  | { k: 'match'; c: Ctx; day: number; a: string; n: number; builds: Record<string, Build[]> }
  | { k: 'len'; c: Ctx; day: number; from: number; to: number }
  | { k: 'pool'; c: Ctx; day: number; size: number }
  | { k: 'runs'; c: Ctx; hero: string; from: number; to: number; pool: Build[][] }
  | { k: 'tiers'; c: Ctx; day: number; x: BotTier; y: BotTier; from: number; to: number }
  | LinesJob;

export interface MatchRes {
  score: Record<string, number>;
  count: Record<string, number>;
  /** hero `a`'s ultimate: fights where it was unlocked, fired, fire tick / fight ticks of each fire */
  ultOn: number;
  ultFired: number;
  ultAt: number[];
  /** points scored with the ult unlocked / locked, and fights of each */
  ultScore: number;
  lockScore: number;
  lockN: number;
  /** sides of hero `a` that cast 0 skills / were controlled, over all its fights */
  zero: number;
  sides: number;
  ctl: number;
  ticks: number;
}

export interface SkillAcc {
  own8: number;
  ownAll: number;
  fights: number;
  wins: number;
  share: number;
  shareN: number;
}
export interface RunsRes {
  hero: string;
  runs: number;
  won: number;
  wins: number;
  days: number;
  byTier: Record<string, { runs: number; won: number }>;
  skills: Record<string, SkillAcc>;
  /** runs where one opponent was met ≥ 3 times */
  repeat3: number;
  dead: number;
  /** dead runs where ≥ 2 of the losses came from the same opponent */
  deadRepeat: number;
  /** dead runs where one opponent caused more than half of the losses */
  deadMajority: number;
  health: Health;
  /** runs by the first day the ultimate reached Lv1 / Lv2 (0 = never) */
  ult1Day: Record<number, number>;
  ult2Day: Record<number, number>;
}

export interface TiersRes {
  score: number;
  n: number;
  /** unspent gold / skills / summed levels of side x's builds */
  goldX: number;
  goldY: number;
  skillsX: number;
  skillsY: number;
  lvX: number;
  lvY: number;
}

const pts = (w: number, side: 0 | 1) => (w === side ? 1 : w === -1 ? 0.5 : 0);

export function runJob(j: Job): unknown {
  const { c } = j;
  switch (j.k) {
    case 'builds': {
      const h = HEROES_BY_ID[j.hero];
      const out: Build[] = [];
      for (let i = j.from; i < j.to; i++) out.push(aiBuild(h.id, j.day, [h.line], hashSeed(c.seed, 'bal', h.id, j.day, i), tierOf(c, 'bal', h.id, j.day, i)));
      return out;
    }
    case 'match': {
      const r: MatchRes = { score: {}, count: {}, zero: 0, sides: 0, ctl: 0, ticks: 0, ultOn: 0, ultFired: 0, ultAt: [], ultScore: 0, lockScore: 0, lockN: 0 };
      const A = j.builds[j.a];
      for (const B of HEROES) {
        let s = 0;
        let n = 0;
        const Bs = j.builds[B.id];
        for (let i = 0; i < j.n; i++) {
          for (let k = 0; k < 2; k++) {
            const jj = (i * 7 + k * 13 + 3) % j.n;
            const seed = hashSeed(c.seed, 'm', j.day, j.a, B.id, i, k);
            const r1 = simulate(A[i], Bs[jj], seed, j.day); // A on the left
            const r2 = simulate(Bs[jj], A[i], seed, j.day); // A on the right (cancels side bias)
            s += pts(r1.winner, 0) + pts(r2.winner, 1);
            n += 2;
            const f1 = factsOf(r1, j.day);
            const f2 = factsOf(r2, j.day);
            r.zero += (f1.casts[0] === 0 ? 1 : 0) + (f2.casts[1] === 0 ? 1 : 0);
            r.ctl += f1.ctl[0] + f2.ctl[1];
            r.sides += 2;
            r.ticks += r1.ticks + r2.ticks;
            for (const [res, side] of [[r1, 0], [r2, 1]] as const) {
              const sd = res.sides?.[side];
              const p = pts(res.winner, side);
              if (!sd?.ultLv) {
                r.lockScore += p;
                r.lockN++;
                continue;
              }
              r.ultOn++;
              r.ultScore += p;
              if ((sd.ult ?? -1) >= 0) {
                r.ultFired++;
                r.ultAt.push(sd.ult! / res.ticks);
              }
            }
          }
        }
        r.score[B.id] = s;
        r.count[B.id] = n;
      }
      return r;
    }
    case 'len': {
      const h = newHealth();
      for (let i = j.from; i < j.to; i++) {
        const a = randomAiBuild(j.day, hashSeed(c.seed, 'len-a', j.day, i), tierOf(c, 'len-a', j.day, i));
        const b = randomAiBuild(j.day, hashSeed(c.seed, 'len-b', j.day, i), tierOf(c, 'len-b', j.day, i));
        addFight(h, factsOf(simulate(a, b, hashSeed(c.seed, 'len', j.day, i), j.day), j.day));
      }
      return h;
    }
    case 'pool': {
      const out: Build[] = [];
      for (let i = 0; i < j.size; i++) {
        const h = HEROES[i % HEROES.length];
        out.push(aiBuild(h.id, j.day, [h.line], hashSeed(c.seed, 'pool', j.day, i), tierOf(c, 'pool', j.day, i)));
      }
      return out;
    }
    case 'runs':
      return runRuns(j);
    case 'lines':
    case 'day1':
      return runLinesJob(j);
    case 'tiers': {
      const r: TiersRes = { score: 0, n: 0, goldX: 0, goldY: 0, skillsX: 0, skillsY: 0, lvX: 0, lvY: 0 };
      for (let i = j.from; i < j.to; i++) {
        const rng = new Rng(hashSeed(c.seed, 'tier-h', j.day, i));
        const ha = rng.pick(HEROES);
        const hb = rng.pick(HEROES);
        const sa = aiRun(ha.id, j.day, [ha.line], hashSeed(c.seed, 'tier-a', j.day, i), j.x);
        const sb = aiRun(hb.id, j.day, [hb.line], hashSeed(c.seed, 'tier-b', j.day, i), j.y);
        const a = toBuild(sa);
        const b = toBuild(sb);
        const seed = hashSeed(c.seed, 'tier', j.day, i);
        r.score += pts(simulate(a, b, seed, j.day).winner, 0) + pts(simulate(b, a, seed, j.day).winner, 1);
        r.n += 2;
        r.goldX += sa.gold;
        r.goldY += sb.gold;
        r.skillsX += a.skills.length;
        r.skillsY += b.skills.length;
        r.lvX += a.skills.reduce((n, k) => n + lvOf(k.v), 0);
        r.lvY += b.skills.reduce((n, k) => n + lvOf(k.v), 0);
      }
      return r;
    }
  }
}

function runRuns(j: Extract<Job, { k: 'runs' }>): RunsRes {
  const { c } = j;
  const h = HEROES_BY_ID[j.hero];
  const res: RunsRes = {
    hero: h.id, runs: 0, won: 0, wins: 0, days: 0, byTier: {}, skills: {}, repeat3: 0, dead: 0, deadRepeat: 0, deadMajority: 0, health: newHealth(), ult1Day: {}, ult2Day: {},
  };
  const sk = (id: string) => (res.skills[id] ??= { own8: 0, ownAll: 0, fights: 0, wins: 0, share: 0, shareN: 0 });
  for (let r = j.from; r < j.to; r++) {
    const tier = tierOf(c, 'run', h.id, r);
    const rules = botRules([h.line], tier);
    const s = newRun(h.id, hashSeed(c.seed, 'run', h.id, r), `bot-${r}`);
    const rng = new Rng(hashSeed(c.seed, 'opp', h.id, r));
    const met: Record<number, number> = {};
    const lostTo: Record<number, number> = {};
    let u1 = 0;
    let u2 = 0;
    while (s.day <= MAX_DAY) {
      if (s.phase === 'lastchance') chooseLastChance(s, (['awaken', 'supply', 'mark'] as const)[r % 3]);
      if (s.phase === 'mark') applyMark(s, 0);
      if (s.phase !== 'shop') break;
      botDay(s, rules);
      const day = Math.min(s.day, MAX_DAY);
      const oi = rng.int(j.pool[day].length);
      met[oi] = (met[oi] ?? 0) + 1;
      const me = toBuild(s);
      const ul = ultLevel(me);
      if (ul >= 1 && !u1) u1 = s.day;
      if (ul >= 2 && !u2) u2 = s.day;
      const fight = simulate(me, j.pool[day][oi], rng.int(2 ** 31), s.day);
      const f = factsOf(fight, s.day);
      addFight(res.health, f, false);
      const won = fight.winner === 0;
      if (!won) lostTo[oi] = (lostTo[oi] ?? 0) + 1;
      const total = f.dmg[0].reduce((n, x) => n + x, 0);
      me.skills.forEach((k, i) => {
        const a = sk(k.id);
        a.fights++;
        if (won) a.wins++;
        if (total > 0) {
          a.share += f.dmg[0][i] / total;
          a.shareN++;
        }
      });
      recordResult(s, won, { opp: 'bot', ai: true }, fight.winner === -1);
    }
    res.runs++;
    res.ult1Day[u1] = (res.ult1Day[u1] ?? 0) + 1;
    res.ult2Day[u2] = (res.ult2Day[u2] ?? 0) + 1;
    const won8 = s.phase === 'won' && s.wins >= WIN_TARGET;
    if (won8) res.won++;
    res.wins += s.wins;
    res.days += s.log.length;
    const bt = (res.byTier[tier] ??= { runs: 0, won: 0 });
    bt.runs++;
    if (won8) bt.won++;
    for (const k of s.skills) {
      sk(k.id).ownAll++;
      if (won8) sk(k.id).own8++;
    }
    if (Object.values(met).some((n) => n >= 3)) res.repeat3++;
    if (!won8) {
      res.dead++;
      const losses = Object.values(lostTo);
      const all = losses.reduce((n, x) => n + x, 0);
      const top = Math.max(0, ...losses);
      if (top >= 2) res.deadRepeat++;
      if (all > 0 && top > all / 2) res.deadMajority++;
    }
  }
  return res;
}
