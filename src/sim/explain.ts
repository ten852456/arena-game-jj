import { MAX_TICKS, TPS, cdTicks, fatigueStart } from './combat';
import { HASTE_BONUS, activeBonuses } from './grid';
import { HEROES_BY_ID } from './heroes';
import { MARK_INFO } from './run';
import { SKILLS, lvOf, nodeOf } from './skills';
import type { Build, CombatEvent, CombatResult, Side, SkillInstance } from './types';
import { L } from '../i18n';

/**
 * Post-fight explanation (Thai or English, see i18n.ts), from the events and per-block stats of one fight.
 * Pure (no DOM): the result screen and replays show it, and scripts can test it.
 */
export interface Explanation {
  /** one line: who won, how and when */
  headline: string;
  /** short facts: top damage, chains, control, biggest hit */
  facts: string[];
  /** why `me` lost (or won), most important first, each with what to try */
  reasons: string[];
  /** the winner ended with ≤10% HP (or a draw): worth watching the replay */
  close: boolean;
  /** how a simultaneous KO / timeout / draw was decided, as the sim decides it */
  tiebreak?: string;
  /** big moments for the result screen: biggest hit, longest chain, comeback, lock */
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

/** Damage one block did, split by where it came from. The sim credits all thorns reflection to the oldest thorns stack, so it is re-split here. */
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
  chains: number;
  longestChain: number;
  longestChainT: number;
  growth: number;
}

const sec = (ticks: number) => (ticks / TPS).toFixed(1);
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);
const skillName = (id: string) =>
  id === 'thorns' ? L('หนาม', 'thorns') : id === 'burn' ? L('ไฟ', 'burn') : id === 'fatigue' ? L('ความเหนื่อยล้า', 'fatigue') : SKILLS[id]?.name ?? id;
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
    bigHit: 0, bigHitSrc: '', bigHitT: 0, casts: 0, chains: 0, longestChain: 0, longestChainT: 0, growth: 0,
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
    else if (e.type === 'cast' && !e.echo) {
      const s = t[e.side];
      s.casts++;
      if (e.chain > 0) {
        s.chains++;
        if (e.chain + 1 > s.longestChain) {
          s.longestChain = e.chain + 1;
          s.longestChainT = e.t;
        }
      }
    }
  }
  const last = r.events.at(-1);
  if (last) for (const s of [0, 1] as Side[]) t[s].growth = last.s.fx[s].g;
  return t;
}

/**
 * Damage per block of side `s`, with thorns reflection split fairly over the blocks that gave thorns
 * (weighted by thorns given), so a shield block with a little thorns is not credited for all of it.
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
      const i = b.skills.findIndex((k) => k.id === e.src && k.x >= 0);
      if (i >= 0) direct[i] += e.amount + e.blocked;
    }
  }
  const st = r.stats[s];
  const fires = (i: number) => (st[i]?.c ?? 0) + (st[i]?.tc ?? 0);
  // who gave thorns: blocks with a thorns effect (perm stacks count double), amplify (doubles stacks), the thorns hero
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
    // blocks that never gave thorns: everything not from their own hits is burn credit (exact)
    // thorns givers: the sim may have credited reflection to them, so only a burn mark is counted as burn
    const burn = weight[i] ? (k.mark === 'burn' ? Math.min(Math.max(0, d - direct[i]), fires(i) * 3) : 0) : Math.max(0, d - direct[i]);
    return { idx: i, name: nodeOf(k).name, direct: direct[i], reflect: share, burn, total: direct[i] + share + burn };
  });
  if (heroThorns && reflect) {
    const share = Math.round((reflect * heroThorns) / wSum);
    if (share > 0) out.push({ idx: -1, name: L('หนามติดตัว (ฮีโร่)', 'Hero’s own thorns'), direct: 0, reflect: share, burn: 0, total: share });
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

/** Cooldown cut from active haste connect bonuses of block i (same rule as the sim). */
function hasteOf(b: Build, i: number) {
  return activeBonuses(b.skills, b.w, b.h).filter((a) => a.from === i && a.b.e === 'haste').length * HASTE_BONUS;
}

/**
 * Explain a fight from the point of view of side `me`.
 * builds = [left, right] as passed to simulate(); names = display names ('คุณ' / 'You' = the player).
 */
export function explain(
  r: CombatResult, builds: [Build, Build], me: Side = 0, names: [string, string] = [L('คุณ', 'You'), L('ศัตรู', 'Enemy')], opts: ExplainOpts = {},
): Explanation {
  const foe = (1 - me) as Side;
  const isYou = (s: Side) => names[s] === 'คุณ' || names[s] === 'You';
  // Thai: names glued to Thai words get spaces around them ("ของ Mochi-12 ") except "คุณ"; extra spaces are squeezed at the end
  const N = names.map((x) => (x === 'คุณ' ? x : ` ${x} `)) as [string, string];
  // English: subject, possessive and verb agreement ("You were" / "Mochi-12 was")
  const E = names;
  const was = (s: Side) => (isYou(s) ? 'were' : 'was');
  const poss = (s: Side) => (isYou(s) ? 'your' : `${E[s]}’s`);
  const Poss = (s: Side) => (isYou(s) ? 'Your' : `${E[s]}’s`);
  /** name of a damage source as the side that dealt it has it (its tree variant) */
  const srcName = (s: Side, id: string) => {
    const k = builds[s].skills.find((x) => x.id === id && x.x >= 0);
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
  const drawWord = opts.drawIsLoss ? L('เสมอ (นับเป็นแพ้)', 'Draw (counts as a loss)') : L('เสมอ', 'Draw');
  const drawWordLc = opts.drawIsLoss ? 'a draw (counts as a loss)' : 'a draw';

  // ---------- headline ----------
  let how: string;
  if (draw) how = drawWord;
  else if (timeout) how = L(`${won ? 'ชนะ' : 'แพ้'}เพราะหมดเวลา`, `${won ? 'Won' : 'Lost'} on time`);
  else if (bothDown) how = L(`${won ? 'ชนะ' : 'แพ้'}ตอนล้มพร้อมกัน`, `${won ? 'Won' : 'Lost'} in a double KO`);
  else if (fatigued) how = L(`${won ? 'ชนะ' : 'แพ้'}ช่วงเหนื่อยล้า`, `${won ? 'Won' : 'Lost'} in fatigue`);
  else how = won ? L('ชนะน็อก', 'Won by knockout') : L('แพ้น็อก', 'Lost by knockout');
  const hpOf = (s: Side) => `${Math.max(0, endHp[s])}/${r.maxHp[s]}`;
  const headline = L(
    `${how} · ${sec(len)} วิ · เลือดเหลือ ${N[me]} ${hpOf(me)} · ${N[foe]} ${hpOf(foe)}`,
    `${how} · ${sec(len)}s · HP left: ${E[me]} ${hpOf(me)} · ${E[foe]} ${hpOf(foe)}`,
  );

  // ---------- how a tie was decided (same rule as simulate) ----------
  let tiebreak: string | undefined;
  if (bothDown)
    tiebreak = L(
      `ทั้งสองฝ่ายเลือดหมดในวินาทีเดียวกัน (${sec(len)} วิ) กติกาตัดสินจากเลือดที่ติดลบน้อยกว่า: ${N[me]} ${endHp[me]} · ${N[foe]} ${endHp[foe]}${draw ? ` เท่ากันพอดีจึง${drawWord}` : ` → ${N[r.winner as Side]} ชนะ`}`,
      `Both sides hit 0 HP in the same moment (${sec(len)}s). The rule: whoever is less far below zero wins: ${E[me]} ${endHp[me]} · ${E[foe]} ${endHp[foe]}${draw ? `. Exactly equal, so it is ${drawWordLc}` : ` → ${E[r.winner as Side]} ${isYou(r.winner as Side) ? 'win' : 'wins'}`}`,
    );
  else if (timeout)
    tiebreak = L(
      `ครบ ${sec(MAX_TICKS)} วิ ยังไม่มีใครล้ม กติกาเทียบเลือดที่เหลือเป็น %: ${N[me]} ${Math.round(hpShare[me] * 100)}% · ${N[foe]} ${Math.round(hpShare[foe] * 100)}%${draw ? ` เท่ากันจึง${drawWord}` : ''}`,
      `${sec(MAX_TICKS)}s passed and nobody fell. The rule compares HP left as a %: ${E[me]} ${Math.round(hpShare[me] * 100)}% · ${E[foe]} ${Math.round(hpShare[foe] * 100)}%${draw ? `. Equal, so it is ${drawWordLc}` : ''}`,
    );
  else if (draw) tiebreak = L(`ทั้งสองฝ่ายจบด้วยเลือดเท่ากัน จึง${drawWord}`, `Both sides ended on the same HP, so it is ${drawWordLc}`);
  if (fatigued && tiebreak)
    tiebreak += L(` · ความเหนื่อยล้าเริ่มที่ ${sec(fStart)} วิ ทำดาเมจเท่ากันทั้งสองฝ่าย`, ` · Fatigue started at ${sec(fStart)}s and hits both sides equally`);

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
    const parts = [best.reflect ? `${L('สะท้อนหนาม', 'thorns reflect')} ${best.reflect}` : '', best.burn ? `${L('ไฟ', 'burn')} ${best.burn}` : ''].filter(Boolean);
    return `${best.name} ${best.total} (${pct(best.total, total)}%${parts.length ? ` · ${parts.join(' · ')}` : ''})`;
  };
  facts.push(L(`ดาเมจรวม: ${N[me]} ${my.dealt} · ${N[foe]} ${their.dealt}`, `Total damage: ${E[me]} ${my.dealt} · ${E[foe]} ${their.dealt}`));
  const mt = top(me);
  const ft = top(foe);
  if (mt) facts.push(L(`skill ทำดาเมจมากสุดของ${N[me]}: ${mt}`, `${Poss(me)} top damage skill: ${mt}`));
  if (ft) facts.push(L(`skill ทำดาเมจมากสุดของ${N[foe]}: ${ft}`, `${Poss(foe)} top damage skill: ${ft}`));
  facts.push(L(`ใช้ skill: ${N[me]} ${my.casts} ครั้ง · ${N[foe]} ${their.casts} ครั้ง`, `Skills fired: ${E[me]} ${my.casts} · ${E[foe]} ${their.casts}`));
  if (my.chains || their.chains)
    facts.push(L(
      `เชน: ${N[me]} ${my.chains} ครั้ง (ยาวสุด x${my.longestChain || 1}) · ${N[foe]} ${their.chains} ครั้ง (ยาวสุด x${their.longestChain || 1})`,
      `Chains: ${E[me]} ${my.chains} (longest x${my.longestChain || 1}) · ${E[foe]} ${their.chains} (longest x${their.longestChain || 1})`,
    ));
  const ctlOn = (s: Side) => r.stats[1 - s].reduce((n, x) => n + x.fz, 0); // control applied TO side s
  const myCtl = ctlOn(me);
  const theirCtl = ctlOn(foe);
  if (myCtl || theirCtl)
    facts.push(L(`โดนควบคุม (แช่แข็ง/ถ่วงเวลา): ${N[me]} ${sec(myCtl)} วิ · ${N[foe]} ${sec(theirCtl)} วิ`, `Time controlled (freeze/delay): ${E[me]} ${sec(myCtl)}s · ${E[foe]} ${sec(theirCtl)}s`));
  if (my.bigHit || their.bigHit) {
    const bh = (s: Side) => `${T[s].bigHit}${T[s].bigHitSrc ? ` (${srcName(s, T[s].bigHitSrc)})` : ''}`;
    facts.push(L(`ตีแรงสุด: ${N[me]} ${bh(me)} · ${N[foe]} ${bh(foe)}`, `Biggest hit: ${E[me]} ${bh(me)} · ${E[foe]} ${bh(foe)}`));
  }
  if (fatigued)
    facts.push(L(`ความเหนื่อยล้าเริ่มที่ ${sec(fStart)} วิ (วันที่ ${r.day}) แล้วแรงขึ้นทุกวินาที`, `Fatigue started at ${sec(fStart)}s (day ${r.day}) and grew every second`));

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
        ? L(
            `${N[s]} ใช้ skill ไม่ได้เลยสักครั้ง${ctl ? ` (โดนแช่แข็ง/ถ่วงเวลา ${sec(ctl)} วิ${w ? ` ล็อกยาวสุดถึงวินาทีที่ ${until.toFixed(1)}` : ''})` : ' (คูลดาวน์ยาวกว่าการสู้)'}`,
            `${E[s]} never fired a single skill${ctl ? ` (frozen/delayed for ${sec(ctl)}s${w ? `, the longest lock lasted until ${until.toFixed(1)}s` : ''})` : ' (cooldowns longer than the fight)'}`,
          )
        : L(
            `${N[s]} โดนแช่แข็ง/ถ่วงเวลา ${sec(ctl)} วิ (${share}% ของการสู้)${w ? ` ล็อกยาวสุด ${sec(w[1] - w[0])} วิ ถึงวินาทีที่ ${until.toFixed(1)}` : ''} · ใช้ skill ได้ ${casts} ครั้ง`,
            `${E[s]} ${was(s)} frozen/delayed for ${sec(ctl)}s (${share}% of the fight)${w ? `, the longest lock ${sec(w[1] - w[0])}s until ${until.toFixed(1)}s` : ''} · fired ${casts} skills`,
          );
    locks.push({ side: s, secs: ctl / TPS, pct: share, casts, until, text });
  }

  // ---------- why an owned skill did (not) help ----------
  const mySkills = builds[me].skills;
  const placed = (i: number) => mySkills[i].x >= 0;
  const myWin = windows[me];
  const slowed = r.events.some((e) => e.type === 'status' && e.side === me && e.status === 'slow' && e.value > 0);
  const lockedTicks = myWin.reduce((n, w) => n + (w[1] - w[0]), 0);
  const ownIdx = (id: string) => mySkills.findIndex((k) => k.id === id && k.x >= 0);
  const inBag = (id: string) => mySkills.some((k) => k.id === id && k.x < 0);
  const firesOf = (i: number) => (r.stats[me][i]?.c ?? 0) + (r.stats[me][i]?.tc ?? 0);
  /** why block i of `me` never fired */
  const idleWhy = (i: number) => {
    const k = mySkills[i];
    const cd = cdTicks(k, hasteOf(builds[me], i));
    const w = longest(me);
    const ctl = Math.max(lockedTicks, myCtl);
    if (cd > len) return L(`คูลดาวน์ ${sec(cd)} วิ ยาวกว่าการสู้ (จบที่ ${sec(len)} วิ)`, `its ${sec(cd)}s cooldown is longer than the fight (over at ${sec(len)}s)`);
    if (ctl > 0 && cd + ctl >= len * 0.8)
      return L(
        `คูลดาวน์ ${sec(cd)} วิ แต่${N[me]}โดนแช่แข็ง/ถ่วงเวลารวม ${sec(ctl)} วิ${w ? ` (ล็อกยาวสุด ${sec(w[0])}–${sec(w[1])} วิ)` : ''}${slowed ? ' และโดนทำให้ช้าลง' : ''} คูลดาวน์หยุดนับ เลยไม่ทันได้ออกก่อนจบที่ ${sec(len)} วิ`,
        `its cooldown is ${sec(cd)}s, but ${E[me]} ${was(me)} frozen/delayed for ${sec(ctl)}s in all${w ? ` (longest lock ${sec(w[0])}–${sec(w[1])}s)` : ''}${slowed ? ' and slowed' : ''}, so the cooldown stopped and never finished before the end at ${sec(len)}s`,
      );
    if (slowed)
      return L(`คูลดาวน์ ${sec(cd)} วิ แต่โดนทำให้ช้าลง จนการสู้จบที่ ${sec(len)} วิ ก่อนถึงคิว`, `its cooldown is ${sec(cd)}s, but slows dragged it out until the fight ended at ${sec(len)}s`);
    return L(`คูลดาวน์ ${sec(cd)} วิ นับไม่ทันก่อนการสู้จบที่ ${sec(len)} วิ`, `its ${sec(cd)}s cooldown did not finish before the fight ended at ${sec(len)}s`);
  };
  const steadfastHint = (i: number) =>
    mySkills[i].mark === 'steadfast' ? '' : L(` (ตรา ${MARK_INFO.steadfast.name} ทำให้คูลดาวน์เดินต่อแม้โดนแช่แข็ง)`, ` (the ${MARK_INFO.steadfast.name} mark keeps its cooldown running while frozen)`);
  /**
   * Advice that knows the build: skills you don't own are suggested; for ones on your grid, say how they did;
   * ones in your bag are reminded to be placed. opts = [skill id, what it does]
   */
  const reported = new Set<number>();
  const advise = (opts: [string, string][], fallback = '') => {
    const buy = opts.filter(([id]) => ownIdx(id) < 0 && !inBag(id)).map(([id, what]) => `${skillName(id)} (${what})`);
    const notes: string[] = [];
    for (const [id] of opts) {
      if (inBag(id) && ownIdx(id) < 0) {
        notes.push(L(`${skillName(id)} อยู่ในกระเป๋า ไม่ได้ลงสู้ → วางลงตาราง`, `${skillName(id)} is in your bag and did not fight → place it on the grid`));
        continue;
      }
      const i = ownIdx(id);
      if (i < 0) continue;
      const node = nodeOf(mySkills[i]);
      const nm = `${node.name}${node.name !== skillName(id) ? L(` (สาย${skillName(id)})`, ` (${skillName(id)} tree)`) : ''}`;
      const f = firesOf(i);
      if (f === 0) {
        reported.add(i);
        notes.push(L(`${nm} ที่มีอยู่ไม่ได้ทำงานเลย: ${idleWhy(i)}`, `your ${nm} never fired: ${idleWhy(i)}`) + (lockedTicks ? steadfastHint(i) : ''));
      } else
        notes.push(
          lvOf(mySkills[i].v) < 3
            ? L(`${nm} ที่มีอยู่ทำงาน ${f} ครั้ง → อัปเลเวลให้แรงขึ้น`, `your ${nm} fired ${f} times → level it up`)
            : L(`${nm} ที่มีอยู่ทำงาน ${f} ครั้ง แต่ยังไม่พอ`, `your ${nm} fired ${f} times but it was not enough`),
        );
    }
    const parts = [buy.length ? L(`ลอง ${buy.join(' หรือ ')}`, `try ${buy.join(' or ')}`) : fallback, notes.join(' · ')].filter(Boolean);
    return parts.join(' · ');
  };

  // ---------- reasons (scored, highest first) ----------
  const out: [number, string][] = [];
  const add = (score: number, text: string) => score > 0 && out.push([score, text]);
  const lostHp = r.maxHp[me];
  if (!won) {
    if (pct(myCtl, len) >= 20)
      add(pct(myCtl, len), L(
        `${N[me]}โดนแช่แข็ง/ถ่วงเวลา ${sec(myCtl)} วิ (${pct(myCtl, len)}% ของการสู้) skill แทบไม่ได้ออก → ${advise([['ironwill', 'การควบคุมอ่อนลง 60%'], ['cleanse', 'ลบการแช่แข็ง']], `ย้าย skill หลักไปใส่ตรา ${MARK_INFO.steadfast.name}`)}`,
        `${E[me]} ${was(me)} frozen/delayed for ${sec(myCtl)}s (${pct(myCtl, len)}% of the fight), so skills barely fired → ${advise([['ironwill', 'control 60% weaker'], ['cleanse', 'removes freeze']], `put the ${MARK_INFO.steadfast.name} mark on your main skill`)}`,
      ));
    if (pct(my.blockedByFoe, my.dealt) >= 30)
      add(pct(my.blockedByFoe, my.dealt), L(
        `โล่ของ${N[foe]}กันดาเมจ${N[me]}ไป ${my.blockedByFoe} (${pct(my.blockedByFoe, my.dealt)}%) → ${advise([['heavy', 'ทะลุโล่ครึ่งหนึ่ง'], ['ignite', 'ไฟไม่สนโล่'], ['dispel', 'ลบโล่ 20%']], 'อัปสาย ทะลุ ของ skill โจมตี')}`,
        `${Poss(foe)} shield blocked ${my.blockedByFoe} of ${poss(me)} damage (${pct(my.blockedByFoe, my.dealt)}%) → ${advise([['heavy', 'pierces half the shield'], ['ignite', 'burn ignores shields'], ['dispel', 'removes 20% of shield']], 'upgrade an attack into its piercing branch')}`,
      ));
    if (pct(my.thornsTaken, lostHp) >= 15)
      add(pct(my.thornsTaken, lostHp), L(
        `หนามของ${N[foe]}สะท้อนใส่${N[me]} ${my.thornsTaken} → ตีน้อยครั้งแต่แรงแทนการตีรัว · ${advise([['heavy', 'ตีทีเดียวแรง'], ['dispel', 'ลบหนาม']])}`,
        `${Poss(foe)} thorns reflected ${my.thornsTaken} back → fewer, bigger hits instead of many small ones · ${advise([['heavy', 'one big hit'], ['dispel', 'removes thorns']])}`,
      ));
    if (pct(their.healed, my.dealt) >= 20)
      add(pct(their.healed, my.dealt), L(
        `${N[foe]}ฟื้นเลือด ${their.healed} (${pct(their.healed, my.dealt)}% ของดาเมจ${N[me]}) → ${advise([['thorns', 'ระหว่างมีหนาม ศัตรูฟื้นได้ครึ่งเดียว']], 'เร่งดาเมจให้จบเร็ว')}`,
        `${E[foe]} healed ${their.healed} (${pct(their.healed, my.dealt)}% of ${poss(me)} damage) → ${advise([['thorns', 'while you have thorns the enemy heals half']], 'more damage to end it sooner')}`,
      ));
    if (pct(my.burnTaken, lostHp) >= 25)
      add(pct(my.burnTaken, lostHp), L(
        `ไฟทำดาเมจ${N[me]} ${my.burnTaken} (ไม่สนโล่) → ${advise([['cleanse', 'ลบไฟกองที่แรงสุด']], 'เร่งดาเมจให้จบก่อนไฟซ้อน')}`,
        `Burn dealt ${my.burnTaken} to ${isYou(me) ? 'you' : E[me]} (ignores shields) → ${advise([['cleanse', 'removes the strongest burn']], 'more damage to end it before burns stack')}`,
      ));
    if (their.growth >= 8 && their.growth > my.growth * 2)
      add(their.growth * 3, L(
        `${N[foe]}สะสมพลังโจมตีได้ถึง +${their.growth} ต่อการตี (ของ${N[me]} +${my.growth}) ยิ่งนานยิ่งแรง → ${advise([['dispel', 'ลบพลังโจมตี']], 'ทำดาเมจให้จบก่อนศัตรูโต')}`,
        `${E[foe]} stacked +${their.growth} power per hit (${poss(me)} +${my.growth}) and grew stronger over time → ${advise([['dispel', 'removes power']], 'finish them before they grow')}`,
      ));
    if (fatigued && my.dealt < their.dealt)
      add(30, L(
        `สู้กันยืดเยื้อเกิน ${sec(fStart)} วิ จนเหนื่อยล้า และ${N[foe]}ทำดาเมจได้มากกว่า (${their.dealt} ต่อ ${my.dealt}) → เพิ่ม skill ที่ตีได้ หรืออัปเลเวล skill หลัก`,
        `The fight dragged past ${sec(fStart)}s into fatigue and ${E[foe]} dealt more damage (${their.dealt} vs ${my.dealt}) → add skills that hit, or level up your main skill`,
      ));
    if (their.casts > my.casts * 1.6 && their.casts >= 8)
      add(Math.round((their.casts / Math.max(1, my.casts)) * 10), L(
        `${N[foe]}ใช้ skill ถี่กว่ามาก (${their.casts} ต่อ ${my.casts} ครั้ง) → skill คูลดาวน์สั้น โบนัสเร่ง (») ตรา${MARK_INFO.quick.name} · ${advise([['chill', 'ศัตรูช้าลง'], ['frost', 'แช่แข็งศัตรู']])}`,
        `${E[foe]} fired skills far more often (${their.casts} vs ${my.casts}) → short-cooldown skills, haste bonuses (») or the ${MARK_INFO.quick.name} mark · ${advise([['chill', 'slows the enemy'], ['frost', 'freezes the enemy']])}`,
      ));
    if (their.longestChain >= 3 && their.chains > my.chains * 2)
      add(their.chains * 2, L(
        `${N[foe]}ต่อเชนได้ ${their.chains} ครั้ง (ยาวสุด x${their.longestChain}) → จัดบล็อกของคุณให้โบนัสเชื่อมต่อ (⚡) ติดกันมากขึ้น`,
        `${E[foe]} chained ${their.chains} times (longest x${their.longestChain}) → arrange your blocks so more trigger bonuses (⚡) touch`,
      ));
    if (!out.length)
      add(1, L(
        `${N[foe]}ทำดาเมจได้มากกว่า (${their.dealt} ต่อ ${my.dealt}) → อัปเลเวล skill ที่ทำดาเมจมากสุด หรือขยายตารางเพื่อวางเพิ่ม`,
        `${E[foe]} dealt more damage (${their.dealt} vs ${my.dealt}) → level up your top damage skill, or expand the grid to fit more`,
      ));
  } else {
    if (pct(theirCtl, len) >= 20)
      add(pct(theirCtl, len), L(`${N[me]}ควบคุม${N[foe]}ได้ ${sec(theirCtl)} วิ (${pct(theirCtl, len)}% ของการสู้)`, `${E[me]} controlled ${E[foe]} for ${sec(theirCtl)}s (${pct(theirCtl, len)}% of the fight)`));
    if (my.casts > their.casts * 1.6 && my.casts >= 8)
      add(Math.round((my.casts / Math.max(1, their.casts)) * 10), L(`${N[me]}ใช้ skill ถี่กว่ามาก (${my.casts} ต่อ ${their.casts} ครั้ง)`, `${E[me]} fired skills far more often (${my.casts} vs ${their.casts})`));
    if (my.longestChain >= 3)
      add(my.chains * 2, L(`เชนของ${N[me]}ทำงาน ${my.chains} ครั้ง (ยาวสุด x${my.longestChain})`, `${Poss(me)} chains fired ${my.chains} times (longest x${my.longestChain})`));
    if (pct(their.thornsTaken, r.maxHp[foe]) >= 15)
      add(pct(their.thornsTaken, r.maxHp[foe]), L(`หนามของ${N[me]}สะท้อนใส่${N[foe]} ${their.thornsTaken}`, `${Poss(me)} thorns reflected ${their.thornsTaken} at ${E[foe]}`));
    if (my.growth >= 8) add(my.growth * 2, L(`${N[me]}สะสมพลังโจมตีได้ถึง +${my.growth} ต่อการตี`, `${E[me]} stacked +${my.growth} power per hit`));
    const best = dmg[me].reduce<SkillDamage | null>((b, x) => (!b || x.total > b.total ? x : b), null);
    const total = dmg[me].reduce((n, x) => n + x.total, 0);
    if (best && pct(best.total, total) >= 40)
      add(pct(best.total, total), L(`${best.name} ของ${N[me]}ทำดาเมจ ${pct(best.total, total)}% ของทั้งหมด`, `${Poss(me)} ${best.name} dealt ${pct(best.total, total)}% of all damage`));
    if (bothDown)
      add(50, L(`ล้มพร้อมกัน แต่${N[me]}เลือดติดลบน้อยกว่า (${endHp[me]} ต่อ ${endHp[foe]})`, `Double KO, but ${E[me]} ended less far below zero (${endHp[me]} vs ${endHp[foe]})`));
    if (!out.length) {
      if (my.dealt >= their.dealt) add(1, L(`${N[me]}ทำดาเมจได้มากกว่า (${my.dealt} ต่อ ${their.dealt})`, `${E[me]} dealt more damage (${my.dealt} vs ${their.dealt})`));
      else if (fatigued)
        add(1, L(
          `${N[me]}อึดกว่าในช่วงเหนื่อยล้า (โล่ ${my.shielded} ฟื้นเลือด ${my.healed}) แม้ทำดาเมจน้อยกว่า (${my.dealt} ต่อ ${their.dealt}) → เพิ่ม skill ที่ตีได้ จะชนะง่ายขึ้น`,
          `${E[me]} outlasted them in fatigue (shield ${my.shielded}, healing ${my.healed}) despite less damage (${my.dealt} vs ${their.dealt}) → add skills that hit to win more easily`,
        ));
      else add(1, L(`${N[me]}เหลือเลือดมากกว่าตอนจบ (โล่ ${my.shielded} ฟื้นเลือด ${my.healed})`, `${E[me]} had more HP left at the end (shield ${my.shielded}, healing ${my.healed})`));
    }
  }
  if (!won && bothDown)
    add(60, L(
      `ล้มพร้อมกัน แต่${N[me]}เลือดติดลบมากกว่า (${endHp[me]} ต่อ ${endHp[foe]}) → ดาเมจอีกนิดเดียวก็ชนะ: อัปเลเวล skill หลัก หรือเพิ่มโล่/ฟื้นเลือด`,
      `Double KO, but ${E[me]} ended further below zero (${endHp[me]} vs ${endHp[foe]}) → a little more damage wins it: level up your main skill, or add shield/healing`,
    ));
  // placed blocks that never fired, with the real reason
  const idle = mySkills.map((_, i) => i).filter((i) => placed(i) && r.stats[me][i] && firesOf(i) === 0);
  if (idle.length && !won) {
    const txt = idle.filter((i) => !reported.has(i)).map((i) => `${nodeOf(mySkills[i]).name}: ${idleWhy(i)}`);
    if (txt.length) add(lockedTicks ? 25 : 5, L(`skill ที่ไม่ได้ทำงานเลย · ${txt.join(' · ')}`, `Skills that never fired · ${txt.join(' · ')}`));
  }
  const hitters = dmg[me].filter((x) => x.idx >= 0 && x.total > 0).length;
  const placedN = mySkills.filter((k) => k.x >= 0).length;
  if (!won && placedN >= 3 && hitters <= 1)
    add(8, L(
      `มีแค่ ${hitters} skill ที่ทำดาเมจ → เพิ่ม skill โจมตีอีกสักตัว (หรือให้ skill ที่มีอยู่เลเวลสูงขึ้น)`,
      `Only ${hitters} skill${hitters === 1 ? '' : 's'} dealt damage → add another attack (or level up the ones you have)`,
    ));
  const bonusDmg = r.stats[me].reduce((n, x) => n + x.bd, 0);
  if (!won && placedN >= 4 && pct(bonusDmg, my.dealt) < 5)
    add(4, L(
      `โบนัสเชื่อมต่อแทบไม่ช่วยดาเมจ (${pct(bonusDmg, my.dealt)}%) → วางบล็อกให้ตรงเงื่อนไขของกันและกัน (บล็อกที่ติดโบนัสจะเรืองแสง)`,
      `Connect bonuses barely added damage (${pct(bonusDmg, my.dealt)}%) → place blocks to meet each other’s conditions (blocks with an active bonus glow)`,
    ));

  out.sort((a, b) => b[0] - a[0]);

  // ---------- big moments ----------
  const moments: Moment[] = [];
  const big = my.bigHit >= their.bigHit ? me : foe;
  if (T[big].bigHit > 0)
    moments.push({
      kind: 'hit', icon: '💥', title: L('ตีแรงสุด', 'Biggest hit'), side: big, t: T[big].bigHitT,
      text: L(
        `${N[big]} ${srcName(big, T[big].bigHitSrc)} ${T[big].bigHit} ที่ ${sec(T[big].bigHitT)} วิ`,
        `${E[big]}: ${srcName(big, T[big].bigHitSrc)} ${T[big].bigHit} at ${sec(T[big].bigHitT)}s`,
      ),
    });
  // longest chain: trigger bonuses firing touching blocks one after another
  const cs = my.longestChain >= their.longestChain ? me : foe;
  if (T[cs].longestChain >= 3)
    moments.push({
      kind: 'chain', icon: '⚡', title: L('เชนยาวสุด', 'Longest chain'), side: cs, t: T[cs].longestChainT,
      text: L(
        `${N[cs]} ต่อเชน x${T[cs].longestChain} ที่ ${sec(T[cs].longestChainT)} วิ (เชนทั้งหมด ${T[cs].chains} ครั้ง)`,
        `${E[cs]} chained x${T[cs].longestChain} at ${sec(T[cs].longestChainT)}s (${T[cs].chains} chain fires in all)`,
      ),
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
        kind: 'comeback', icon: '🌙', title: L('พลิกเกม!', 'Comeback!'), side: w, t: worst.t,
        text: L(
          `${N[w]} เหลือเลือด ${Math.max(0, Math.round(worst.ws * 100))}% ที่ ${sec(worst.t)} วิ (ตามหลัง ${Math.round(worst.gap * 100)}%) แต่กลับมาชนะ`,
          `${E[w]} ${was(w)} down to ${Math.max(0, Math.round(worst.ws * 100))}% HP at ${sec(worst.t)}s (${Math.round(worst.gap * 100)}% behind) and still won`,
        ),
      });
  }
  for (const s of [me, foe]) {
    const w = longest(s);
    if (w && w[1] - w[0] >= 3 * TPS)
      moments.push({
        kind: 'lock', icon: '❄', title: L('โดนล็อกนานสุด', 'Longest lock'), side: s, t: w[0],
        text: L(`${N[s]} ขยับไม่ได้ ${sec(w[1] - w[0])} วิ (${sec(w[0])}–${sec(w[1])} วิ)`, `${E[s]} could not act for ${sec(w[1] - w[0])}s (${sec(w[0])}–${sec(w[1])}s)`),
      });
  }

  const sq = (t: string) => t.replace(/ {2,}/g, ' ').replace(/ ([,):])/g, '$1').trim();
  for (const m of moments) m.text = sq(m.text);
  for (const l of locks) l.text = sq(l.text);
  return {
    headline: sq(headline), facts: facts.map(sq), reasons: out.slice(0, 3).map((x) => sq(x[1])), close,
    tiebreak: tiebreak && sq(tiebreak), moments, locks, hpShare,
  };
}
