import { MAX_TICKS, TPS, cdTicks, fatigueStart } from './combat';
import { HEROES_BY_ID } from './heroes';
import { bonusTotals } from './links';
import { SKILLS, lvOf, nodeOf } from './skills';
import type { Build, CombatEvent, CombatResult, Side, SkillInstance } from './types';

/**
 * Post-fight explanation in Thai, from the events and per-block stats of one fight.
 * Pure (no DOM): the result screen and replays show it, and scripts can test it.
 */
export interface Explanation {
  /** one line: who won, how and when */
  headline: string;
  /** short facts: top damage, control, biggest hit, skill fires */
  facts: string[];
  /** why `me` lost (or won), most important first, each with what to try */
  reasons: string[];
  /** the winner ended with ≤10% HP (or a draw): worth watching the replay */
  close: boolean;
  /** how a simultaneous KO / timeout / draw was decided, as the sim decides it */
  tiebreak?: string;
  /** big moments for the result screen: biggest hit, longest combo, comeback, lock */
  moments: Moment[];
  /** sides that were controlled for a long time or fired no skill at all */
  locks: Lock[];
  /** HP left at the end, as a share of max HP (0..1, can be below 0 on a double KO) */
  hpShare: [number, number];
}

export interface Moment {
  kind: 'hit' | 'chain' | 'comeback' | 'lock';
  icon: string;
  title: string;
  text: string;
  side: Side;
  /** tick */
  t: number;
}

export interface Lock {
  side: Side;
  /** control time applied to this side (freeze + cooldown pushed back), seconds */
  secs: number;
  /** share of the fight, % */
  pct: number;
  /** skill fires of this side */
  casts: number;
  /** end of the longest continuous lock window, seconds */
  until: number;
  text: string;
}

export interface ExplainOpts {
  /** a draw counts as a loss for `me` (the run rules) */
  drawIsLoss?: boolean;
}

/** Damage one skill did, split by where it came from. The sim credits all thorns reflection to the oldest thorns stack, so it is re-split here. */
export interface SkillDamage {
  /** index into build.skills, or -1 for the hero's own thorns */
  idx: number;
  name: string;
  total: number;
  /** its own hits (incl. what shields blocked) */
  direct: number;
  /** thorns reflected while this skill's thorns were up */
  reflect: number;
  /** burn ticks from burns this skill started */
  burn: number;
}

interface SideTotals {
  dealt: number;
  blockedByFoe: number;
  thornsTaken: number;
  burnTaken: number;
  fatigueTaken: number;
  healed: number;
  shielded: number;
  bigHit: number;
  bigHitSrc: string;
  bigHitT: number;
  casts: number;
  growth: number;
}

const sec = (ticks: number) => (ticks / TPS).toFixed(1);
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);
const skillName = (id: string) => (id === 'thorns' ? 'หนาม' : id === 'burn' ? 'ไฟ' : id === 'fatigue' ? 'ความเหนื่อยล้า' : SKILLS[id]?.name ?? id);
const hasFx = (k: Pick<SkillInstance, 'id' | 'v'>, kind: string) => nodeOf(k).fx.some((e) => e.k === kind);

/**
 * Damage events that are thorns reflections. The thorns skill (id 'thorns') hits with src 'thorns' too, so tell them apart:
 * a reflection comes right after a hit on the other side, with no cast in between.
 */
export function reflectEvents(events: CombatEvent[]): Set<CombatEvent> {
  const out = new Set<CombatEvent>();
  events.forEach((e, j) => {
    if (e.type !== 'damage' || e.src !== 'thorns') return;
    for (let k = j - 1; k >= 0; k--) {
      const p = events[k];
      if (p.t !== e.t || p.type === 'cast') return;
      if (p.type === 'damage') {
        if (p.side !== e.side) out.add(e);
        return;
      }
    }
  });
  return out;
}

function totals(r: CombatResult): [SideTotals, SideTotals] {
  const refl = reflectEvents(r.events);
  const t = [0, 1].map(() => ({
    dealt: 0, blockedByFoe: 0, thornsTaken: 0, burnTaken: 0, fatigueTaken: 0, healed: 0, shielded: 0,
    bigHit: 0, bigHitSrc: '', bigHitT: 0, casts: 0, growth: 0,
  })) as [SideTotals, SideTotals];
  for (const e of r.events) {
    if (e.type === 'damage') {
      const victim = t[e.side];
      const attacker = t[1 - e.side];
      if (e.src === 'fatigue') victim.fatigueTaken += e.amount;
      else if (refl.has(e)) victim.thornsTaken += e.amount + e.blocked;
      else if (e.src === 'burn') victim.burnTaken += e.amount;
      if (e.src !== 'fatigue') {
        attacker.dealt += e.amount + e.blocked;
        attacker.blockedByFoe += e.blocked;
        if (e.src !== 'burn' && !refl.has(e) && e.amount + e.blocked > attacker.bigHit) {
          attacker.bigHit = e.amount + e.blocked;
          attacker.bigHitSrc = e.src;
          attacker.bigHitT = e.t;
        }
      }
    } else if (e.type === 'heal') t[e.side].healed += e.amount;
    else if (e.type === 'shield') t[e.side].shielded += e.amount;
    else if (e.type === 'cast' && !e.echo) t[e.side].casts++;
  }
  const last = r.events.at(-1);
  if (last) for (const s of [0, 1] as Side[]) t[s].growth = last.s.fx[s].g;
  return t;
}

/**
 * Damage per skill of side `s`, with thorns reflection split fairly over the skills that gave thorns
 * (weighted by thorns given), so a shield skill with a little thorns is not credited for all of it.
 */
export function skillDamage(r: CombatResult, b: Build, s: Side): SkillDamage[] {
  const foe = 1 - s;
  const direct = b.skills.map(() => 0);
  let reflect = 0;
  const refl = reflectEvents(r.events);
  for (const e of r.events) {
    if (e.type !== 'damage' || e.side !== foe) continue;
    if (refl.has(e)) reflect += e.amount + e.blocked;
    else {
      const i = b.skills.findIndex((k) => k.id === e.src);
      if (i >= 0) direct[i] += e.amount + e.blocked;
    }
  }
  const st = r.stats[s];
  const fires = (i: number) => (st[i]?.c ?? 0) + (st[i]?.tc ?? 0);
  // who gave thorns: skills with a thorns effect (perm stacks count double), amplify (doubles stacks), the thorns hero
  const weight = b.skills.map((k, i) => {
    const th = nodeOf(k).fx.find((e) => e.k === 'thorns') as { n: number; perm?: boolean } | undefined;
    if (th) return th.n * (th.perm ? 2 : 1) * fires(i);
    if (hasFx(k, 'amplify') && b.skills.some((x) => hasFx(x, 'thorns'))) return fires(i);
    return 0;
  });
  const heroThorns = HEROES_BY_ID[b.hero]?.hooks.thornsSecs ? 3 : 0;
  const wSum = weight.reduce((n, x) => n + x, 0) + heroThorns;
  const out: SkillDamage[] = b.skills.map((k, i) => {
    const d = st[i]?.d ?? 0;
    const share = wSum ? Math.round((reflect * weight[i]) / wSum) : 0;
    // skills that never gave thorns: everything not from their own hits is burn credit (exact)
    // thorns givers: the sim may have credited reflection to them, so only a burn mark is counted as burn
    const burn = weight[i] ? (k.mark === 'burn' ? Math.min(Math.max(0, d - direct[i]), fires(i) * 3) : 0) : Math.max(0, d - direct[i]);
    return { idx: i, name: nodeOf(k).name, direct: direct[i], reflect: share, burn, total: direct[i] + share + burn };
  });
  if (heroThorns && reflect) {
    const share = Math.round((reflect * heroThorns) / wSum);
    if (share > 0) out.push({ idx: -1, name: 'หนามติดตัว (ฮีโร่)', direct: 0, reflect: share, burn: 0, total: share });
  }
  return out;
}

/** Control windows on side `s`: freezes (cut short by cleanse) and cooldown pushbacks, merged. In ticks. */
function lockWindows(r: CombatResult, s: Side): [number, number][] {
  const raw: [number, number][] = [];
  let open: [number, number] | null = null;
  for (const e of r.events) {
    if (e.type !== 'status' || e.side !== s) continue;
    if (e.status === 'freeze' && e.value > 0) {
      const end = e.t + e.value;
      if (open && e.t <= open[1]) open[1] = Math.max(open[1], end);
      else raw.push((open = [e.t, end]));
    } else if (e.status === 'cleanse' && e.value > 0 && open && e.t < open[1]) open[1] = e.t;
    else if (e.status === 'delay' && e.value > 0) raw.push([e.t, e.t + e.value]);
  }
  raw.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const w of raw) {
    const end = Math.min(w[1], r.ticks);
    if (end <= w[0]) continue;
    const m = merged.at(-1);
    if (m && w[0] <= m[1]) m[1] = Math.max(m[1], end);
    else merged.push([w[0], end]);
  }
  return merged;
}

/**
 * Explain a fight from the point of view of side `me`.
 * builds = [left, right] as passed to simulate(); names = display names.
 */
export function explain(
  r: CombatResult, builds: [Build, Build], me: Side = 0, names: [string, string] = ['คุณ', 'ศัตรู'], opts: ExplainOpts = {},
): Explanation {
  const foe = (1 - me) as Side;
  // names glued to Thai words get spaces around them ("ของ Mochi-12 ") except "คุณ"; extra spaces are squeezed at the end
  const N = names.map((x) => (x === 'คุณ' ? x : ` ${x} `)) as [string, string];
  /** name of a damage source as the side that dealt it has it (its tree variant) */
  const srcName = (s: Side, id: string) => {
    const k = builds[s].skills.find((x) => x.id === id);
    return k ? nodeOf(k).name : skillName(id);
  };
  const T = totals(r);
  const my = T[me];
  const their = T[foe];
  const won = r.winner === me;
  const draw = r.winner === -1;
  const fStart = fatigueStart(r.day);
  const fatigued = r.ticks >= fStart;
  const len = r.ticks;
  const endHp = r.events.at(-1)?.s.hp ?? r.init.hp;
  const hpShare: [number, number] = [endHp[0] / r.maxHp[0], endHp[1] / r.maxHp[1]];
  const bothDown = endHp[0] <= 0 && endHp[1] <= 0;
  const timeout = !bothDown && endHp[0] > 0 && endHp[1] > 0 && len >= MAX_TICKS;
  const drawWord = opts.drawIsLoss ? 'เสมอ (นับเป็นแพ้)' : 'เสมอ';

  // ---------- headline ----------
  let how: string;
  if (draw) how = drawWord;
  else if (timeout) how = `${won ? 'ชนะ' : 'แพ้'}เพราะหมดเวลา`;
  else if (bothDown) how = `${won ? 'ชนะ' : 'แพ้'}ตอนล้มพร้อมกัน`;
  else if (fatigued) how = `${won ? 'ชนะ' : 'แพ้'}ช่วงเหนื่อยล้า`;
  else how = won ? 'ชนะน็อก' : 'แพ้น็อก';
  const headline = `${how} · ${sec(len)} วิ · เลือดเหลือ ${N[me]} ${Math.max(0, endHp[me])}/${r.maxHp[me]} · ${N[foe]} ${Math.max(0, endHp[foe])}/${r.maxHp[foe]}`;

  // ---------- how a tie was decided (same rule as simulate) ----------
  let tiebreak: string | undefined;
  if (bothDown)
    tiebreak = `ทั้งสองฝ่ายเลือดหมดในวินาทีเดียวกัน (${sec(len)} วิ) กติกาตัดสินจากเลือดที่ติดลบน้อยกว่า: ${N[me]} ${endHp[me]} · ${N[foe]} ${endHp[foe]}${
      draw ? ` เท่ากันพอดีจึง${drawWord}` : ` → ${N[r.winner as Side]} ชนะ`
    }`;
  else if (timeout)
    tiebreak = `ครบ ${sec(MAX_TICKS)} วิ ยังไม่มีใครล้ม กติกาเทียบเลือดที่เหลือเป็น %: ${N[me]} ${Math.round(hpShare[me] * 100)}% · ${N[foe]} ${Math.round(hpShare[foe] * 100)}%${
      draw ? ` เท่ากันจึง${drawWord}` : ''
    }`;
  else if (draw) tiebreak = `ทั้งสองฝ่ายจบด้วยเลือดเท่ากัน จึง${drawWord}`;
  if (fatigued && tiebreak) tiebreak += ` · ความเหนื่อยล้าเริ่มที่ ${sec(fStart)} วิ ทำดาเมจเท่ากันทั้งสองฝ่าย`;

  const winnerShare = r.winner === -1 ? 0 : hpShare[r.winner];
  const close = draw || winnerShare <= 0.1;

  // ---------- facts ----------
  const facts: string[] = [];
  const dmg = [skillDamage(r, builds[0], 0), skillDamage(r, builds[1], 1)];
  const top = (s: Side) => {
    const list = dmg[s];
    const total = list.reduce((n, x) => n + x.total, 0);
    const best = list.reduce<SkillDamage | null>((b, x) => (!b || x.total > b.total ? x : b), null);
    if (!best || best.total <= 0) return '';
    const parts = [best.reflect ? `สะท้อนหนาม ${best.reflect}` : '', best.burn ? `ไฟ ${best.burn}` : ''].filter(Boolean);
    return `${best.name} ${best.total} (${pct(best.total, total)}%${parts.length ? ` · ${parts.join(' · ')}` : ''})`;
  };
  facts.push(`ดาเมจรวม: ${N[me]} ${my.dealt} · ${N[foe]} ${their.dealt}`);
  const mt = top(me);
  const ft = top(foe);
  if (mt) facts.push(`skill ทำดาเมจมากสุดของ${N[me]}: ${mt}`);
  if (ft) facts.push(`skill ทำดาเมจมากสุดของ${N[foe]}: ${ft}`);
  facts.push(`ใช้ skill: ${N[me]} ${my.casts} ครั้ง · ${N[foe]} ${their.casts} ครั้ง`);
  const ctlOn = (s: Side) => r.stats[1 - s].reduce((n, x) => n + x.fz, 0); // control applied TO side s
  const myCtl = ctlOn(me);
  const theirCtl = ctlOn(foe);
  if (myCtl || theirCtl) facts.push(`โดนควบคุม (แช่แข็ง/ถ่วงเวลา): ${N[me]} ${sec(myCtl)} วิ · ${N[foe]} ${sec(theirCtl)} วิ`);
  if (my.bigHit || their.bigHit)
    facts.push(`ตีแรงสุด: ${N[me]} ${my.bigHit}${my.bigHitSrc ? ` (${srcName(me, my.bigHitSrc)})` : ''} · ${N[foe]} ${their.bigHit}${their.bigHitSrc ? ` (${srcName(foe, their.bigHitSrc)})` : ''}`);
  if (fatigued) facts.push(`ความเหนื่อยล้าเริ่มที่ ${sec(fStart)} วิ (วันที่ ${r.day}) แล้วแรงขึ้นทุกวินาที`);

  // ---------- locks ----------
  const windows = [lockWindows(r, 0), lockWindows(r, 1)];
  const longest = (s: Side) => windows[s].reduce<[number, number] | null>((b, w) => (!b || w[1] - w[0] > b[1] - b[0] ? w : b), null);
  const locks: Lock[] = [];
  for (const s of [me, foe]) {
    const ctl = ctlOn(s);
    const casts = T[s].casts;
    const share = pct(ctl, len);
    if (share < 25 && casts > 0) continue;
    const w = longest(s);
    const until = w ? w[1] / TPS : 0;
    const text =
      casts === 0
        ? `${N[s]} ใช้ skill ไม่ได้เลยสักครั้ง${ctl ? ` (โดนแช่แข็ง/ถ่วงเวลา ${sec(ctl)} วิ${w ? ` ล็อกยาวสุดถึงวินาทีที่ ${until.toFixed(1)}` : ''})` : ' (คูลดาวน์ยาวกว่าการสู้)'}`
        : `${N[s]} โดนแช่แข็ง/ถ่วงเวลา ${sec(ctl)} วิ (${share}% ของการสู้)${w ? ` ล็อกยาวสุด ${sec(w[1] - w[0])} วิ ถึงวินาทีที่ ${until.toFixed(1)}` : ''} · ใช้ skill ได้ ${casts} ครั้ง`;
    locks.push({ side: s, secs: ctl / TPS, pct: share, casts, until, text });
  }

  // ---------- why an owned skill did (not) help ----------
  const mySkills = builds[me].skills;
  const myWin = windows[me];
  const slowed = r.events.some((e) => e.type === 'status' && e.side === me && e.status === 'slow' && e.value > 0);
  const lockedTicks = myWin.reduce((n, w) => n + (w[1] - w[0]), 0);
  const ownIdx = (id: string) => mySkills.findIndex((k) => k.id === id);
  const firesOf = (i: number) => (r.stats[me][i]?.c ?? 0) + (r.stats[me][i]?.tc ?? 0);
  /** why skill i of `me` never fired */
  const idleWhy = (i: number) => {
    const k = mySkills[i];
    const cd = cdTicks(k, bonusTotals(mySkills, i).haste);
    const w = longest(me);
    const ctl = Math.max(lockedTicks, myCtl);
    if (cd > len) return `คูลดาวน์ ${sec(cd)} วิ ยาวกว่าการสู้ (จบที่ ${sec(len)} วิ)`;
    if (ctl > 0 && cd + ctl >= len * 0.8)
      return `คูลดาวน์ ${sec(cd)} วิ แต่${N[me]}โดนแช่แข็ง/ถ่วงเวลารวม ${sec(ctl)} วิ${w ? ` (ล็อกยาวสุด ${sec(w[0])}–${sec(w[1])} วิ)` : ''}${slowed ? ' และโดนทำให้ช้าลง' : ''} คูลดาวน์หยุดนับ เลยไม่ทันได้ออกก่อนจบที่ ${sec(len)} วิ`;
    if (slowed) return `คูลดาวน์ ${sec(cd)} วิ แต่โดนทำให้ช้าลง จนการสู้จบที่ ${sec(len)} วิ ก่อนถึงคิว`;
    return `คูลดาวน์ ${sec(cd)} วิ นับไม่ทันก่อนการสู้จบที่ ${sec(len)} วิ`;
  };
  const steadfastHint = (i: number) => (mySkills[i].mark === 'steadfast' ? '' : ' (ตรา ไม่หวั่นไหว ทำให้คูลดาวน์เดินต่อแม้โดนแช่แข็ง)');
  /**
   * Advice that knows the build: skills you don't own are suggested; for ones you own, say how they did.
   * opts = [skill id, what it does]
   */
  const reported = new Set<number>();
  const advise = (opts: [string, string][], fallback = '') => {
    const buy = opts.filter(([id]) => ownIdx(id) < 0).map(([id, what]) => `${skillName(id)} (${what})`);
    const notes: string[] = [];
    for (const [id] of opts) {
      const i = ownIdx(id);
      if (i < 0) continue;
      const nm = `${nodeOf(mySkills[i]).name}${nodeOf(mySkills[i]).name !== skillName(id) ? ` (สาย${skillName(id)})` : ''}`;
      const f = firesOf(i);
      if (f === 0) reported.add(i);
      if (f === 0) notes.push(`${nm} ที่มีอยู่ไม่ได้ทำงานเลย: ${idleWhy(i)}${lockedTicks ? steadfastHint(i) : ''}`);
      else notes.push(`${nm} ที่มีอยู่ทำงาน ${f} ครั้ง${lvOf(mySkills[i].v) < 3 ? ' → อัปเลเวลให้แรงขึ้น' : ' แต่ยังไม่พอ'}`);
    }
    const parts = [buy.length ? `ลอง ${buy.join(' หรือ ')}` : fallback, notes.join(' · ')].filter(Boolean);
    return parts.join(' · ');
  };

  // ---------- reasons (scored, highest first) ----------
  const out: [number, string][] = [];
  const add = (score: number, text: string) => score > 0 && out.push([score, text]);
  const lostHp = r.maxHp[me];
  if (!won) {
    if (pct(myCtl, len) >= 20)
      add(pct(myCtl, len), `${N[me]}โดนแช่แข็ง/ถ่วงเวลา ${sec(myCtl)} วิ (${pct(myCtl, len)}% ของการสู้) skill แทบไม่ได้ออก → ${advise([['ironwill', 'การควบคุมอ่อนลง 60%'], ['cleanse', 'ลบการแช่แข็ง']], 'ย้าย skill หลักไปใส่ตรา ไม่หวั่นไหว')}`);
    if (pct(my.blockedByFoe, my.dealt) >= 30)
      add(pct(my.blockedByFoe, my.dealt), `โล่ของ${N[foe]}กันดาเมจ${N[me]}ไป ${my.blockedByFoe} (${pct(my.blockedByFoe, my.dealt)}%) → ${advise([['heavy', 'ทะลุโล่ครึ่งหนึ่ง'], ['ignite', 'ไฟไม่สนโล่'], ['dispel', 'ลบโล่ 20%']], 'อัปสาย ทะลุ ของ skill โจมตี')}`);
    if (pct(my.thornsTaken, lostHp) >= 15)
      add(pct(my.thornsTaken, lostHp), `หนามของ${N[foe]}สะท้อนใส่${N[me]} ${my.thornsTaken} → ตีน้อยครั้งแต่แรงแทนการตีรัว · ${advise([['heavy', 'ตีทีเดียวแรง'], ['dispel', 'ลบหนาม']])}`);
    if (pct(their.healed, my.dealt) >= 20)
      add(pct(their.healed, my.dealt), `${N[foe]}ฟื้นเลือด ${their.healed} (${pct(their.healed, my.dealt)}% ของดาเมจ${N[me]}) → ${advise([['thorns', 'ระหว่างมีหนาม ศัตรูฟื้นได้ครึ่งเดียว']], 'เร่งดาเมจให้จบเร็ว')}`);
    if (pct(my.burnTaken, lostHp) >= 25)
      add(pct(my.burnTaken, lostHp), `ไฟทำดาเมจ${N[me]} ${my.burnTaken} (ไม่สนโล่) → ${advise([['cleanse', 'ลบไฟกองที่แรงสุด']], 'เร่งดาเมจให้จบก่อนไฟซ้อน')}`);
    if (their.growth >= 8 && their.growth > my.growth * 2)
      add(their.growth * 3, `${N[foe]}สะสมพลังโจมตีได้ถึง +${their.growth} ต่อการตี (ของ${N[me]} +${my.growth}) ยิ่งนานยิ่งแรง → ${advise([['dispel', 'ลบพลังโจมตี']], 'ทำดาเมจให้จบก่อนศัตรูโต')}`);
    if (fatigued && my.dealt < their.dealt)
      add(30, `สู้กันยืดเยื้อเกิน ${sec(fStart)} วิ จนเหนื่อยล้า และ${N[foe]}ทำดาเมจได้มากกว่า (${their.dealt} ต่อ ${my.dealt}) → เพิ่ม skill ที่ตีได้ หรืออัปเลเวล skill หลัก`);
    if (their.casts > my.casts * 1.6 && their.casts >= 8)
      add(Math.round((their.casts / Math.max(1, my.casts)) * 10), `${N[foe]}ใช้ skill ถี่กว่ามาก (${their.casts} ต่อ ${my.casts} ครั้ง) → skill คูลดาวน์สั้น ตราร่ายไว · ${advise([['chill', 'ศัตรูช้าลง'], ['frost', 'แช่แข็งศัตรู']])}`);
    if (!out.length)
      add(1, `${N[foe]}ทำดาเมจได้มากกว่า (${their.dealt} ต่อ ${my.dealt}) → อัปเลเวล skill ที่ทำดาเมจมากสุด หรือซื้อช่อง skill เพิ่มในร้าน`);
  } else {
    if (pct(theirCtl, len) >= 20) add(pct(theirCtl, len), `${N[me]}ควบคุม${N[foe]}ได้ ${sec(theirCtl)} วิ (${pct(theirCtl, len)}% ของการสู้)`);
    if (my.casts > their.casts * 1.6 && my.casts >= 8) add(Math.round((my.casts / Math.max(1, their.casts)) * 10), `${N[me]}ใช้ skill ถี่กว่ามาก (${my.casts} ต่อ ${their.casts} ครั้ง)`);
    if (pct(their.thornsTaken, r.maxHp[foe]) >= 15) add(pct(their.thornsTaken, r.maxHp[foe]), `หนามของ${N[me]}สะท้อนใส่${N[foe]} ${their.thornsTaken}`);
    if (my.growth >= 8) add(my.growth * 2, `${N[me]}สะสมพลังโจมตีได้ถึง +${my.growth} ต่อการตี`);
    const best = dmg[me].reduce<SkillDamage | null>((b, x) => (!b || x.total > b.total ? x : b), null);
    const total = dmg[me].reduce((n, x) => n + x.total, 0);
    if (best && pct(best.total, total) >= 40) add(pct(best.total, total), `${best.name} ของ${N[me]}ทำดาเมจ ${pct(best.total, total)}% ของทั้งหมด`);
    if (bothDown) add(50, `ล้มพร้อมกัน แต่${N[me]}เลือดติดลบน้อยกว่า (${endHp[me]} ต่อ ${endHp[foe]})`);
    if (!out.length) {
      if (my.dealt >= their.dealt) add(1, `${N[me]}ทำดาเมจได้มากกว่า (${my.dealt} ต่อ ${their.dealt})`);
      else if (fatigued) add(1, `${N[me]}อึดกว่าในช่วงเหนื่อยล้า (โล่ ${my.shielded} ฟื้นเลือด ${my.healed}) แม้ทำดาเมจน้อยกว่า (${my.dealt} ต่อ ${their.dealt}) → เพิ่ม skill ที่ตีได้ จะชนะง่ายขึ้น`);
      else add(1, `${N[me]}เหลือเลือดมากกว่าตอนจบ (โล่ ${my.shielded} ฟื้นเลือด ${my.healed})`);
    }
  }
  if (!won && bothDown) add(60, `ล้มพร้อมกัน แต่${N[me]}เลือดติดลบมากกว่า (${endHp[me]} ต่อ ${endHp[foe]}) → ดาเมจอีกนิดเดียวก็ชนะ: อัปเลเวล skill หลัก หรือเพิ่มโล่/ฟื้นเลือด`);
  // skills that never fired, with the real reason
  const idle = mySkills.map((_, i) => i).filter((i) => r.stats[me][i] && firesOf(i) === 0);
  if (idle.length && !won) {
    const txt = idle
      .filter((i) => !reported.has(i))
      .map((i) => `${nodeOf(mySkills[i]).name}: ${idleWhy(i)}`);
    if (txt.length) add(lockedTicks ? 25 : 5, `skill ที่ไม่ได้ทำงานเลย · ${txt.join(' · ')}`);
  }
  const hitters = dmg[me].filter((x) => x.idx >= 0 && x.total > 0).length;
  if (!won && mySkills.length >= 3 && hitters <= 1)
    add(8, `มีแค่ ${hitters} skill ที่ทำดาเมจ → เพิ่ม skill โจมตีอีกสักตัว (หรือให้ skill ที่มีอยู่เลเวลสูงขึ้น)`);

  out.sort((a, b) => b[0] - a[0]);

  // ---------- big moments ----------
  const moments: Moment[] = [];
  const big = my.bigHit >= their.bigHit ? me : foe;
  if (T[big].bigHit > 0)
    moments.push({
      kind: 'hit', icon: '💥', title: 'ตีแรงสุด', side: big, t: T[big].bigHitT,
      text: `${N[big]} ${srcName(big, T[big].bigHitSrc)} ${T[big].bigHit} ที่ ${sec(T[big].bigHitT)} วิ`,
    });
  // longest combo: most skills fired by one side in the same tick (trigger chains, cooldowns lining up)
  let chain = { n: 0, side: me as Side, t: 0, trig: 0 };
  const seen = new Map<string, { n: number; trig: number }>();
  for (const e of r.events) {
    if (e.type !== 'cast' || e.echo) continue;
    const key = `${e.side}:${e.t}`;
    const c = seen.get(key) ?? { n: 0, trig: 0 };
    c.n++;
    if (e.from !== undefined) c.trig++;
    seen.set(key, c);
    if (c.n > chain.n) chain = { n: c.n, side: e.side, t: e.t, trig: c.trig };
  }
  if (chain.n >= 3)
    moments.push({
      kind: 'chain', icon: '🔗', title: 'คอมโบยาวสุด', side: chain.side, t: chain.t,
      text: `${N[chain.side]} ปล่อย ${chain.n} skill ในจังหวะเดียว ที่ ${sec(chain.t)} วิ${chain.trig ? ` (โบนัสเชื่อมต่อสั่งต่อ ${chain.trig})` : ''}`,
    });
  // comeback: the winner was far behind at some point
  if (r.winner !== -1) {
    const w = r.winner;
    const l = (1 - w) as Side;
    let worst = { gap: 0, t: 0, ws: 1 };
    for (const e of r.events) {
      const ws = e.s.hp[w] / r.maxHp[w];
      const ls = e.s.hp[l] / r.maxHp[l];
      if (ls - ws > worst.gap) worst = { gap: ls - ws, t: e.t, ws };
    }
    if (worst.gap >= 0.3 && worst.ws <= 0.45)
      moments.push({
        kind: 'comeback', icon: '🌙', title: 'พลิกเกม!', side: w, t: worst.t,
        text: `${N[w]} เหลือเลือด ${Math.max(0, Math.round(worst.ws * 100))}% ที่ ${sec(worst.t)} วิ (ตามหลัง ${Math.round(worst.gap * 100)}%) แต่กลับมาชนะ`,
      });
  }
  for (const s of [me, foe]) {
    const w = longest(s);
    if (w && w[1] - w[0] >= 3 * TPS)
      moments.push({ kind: 'lock', icon: '❄', title: 'โดนล็อกนานสุด', side: s, t: w[0], text: `${N[s]} ขยับไม่ได้ ${sec(w[1] - w[0])} วิ (${sec(w[0])}–${sec(w[1])} วิ)` });
  }

  const sq = (t: string) => t.replace(/ {2,}/g, ' ').replace(/ ([,):])/g, '$1').trim();
  for (const m of moments) m.text = sq(m.text);
  for (const l of locks) l.text = sq(l.text);
  return {
    headline: sq(headline), facts: facts.map(sq), reasons: out.slice(0, 3).map((x) => sq(x[1])), close,
    tiebreak: tiebreak && sq(tiebreak), moments, locks, hpShare,
  };
}
