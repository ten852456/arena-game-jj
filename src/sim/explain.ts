import { L, getLang } from '../i18n';
import { MAX_TICKS, TPS, cdTicks, fatigueStart } from './combat';
import { HEROES_BY_ID } from './heroes';
import { bonusTotals } from './links';
import { SKILLS, lvOf, nodeOf } from './skills';
import type { Build, CombatEvent, CombatResult, Side, SkillInstance } from './types';

/**
 * Post-fight explanation in the current language (Thai by default, English when the browser picked it),
 * from the events and per-block stats of one fight.
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
  /** what each line of `facts` is about (same order), so the UI can put an icon and colour on it */
  factKinds: LineKind[];
  /** what each line of `reasons` is about (same order) */
  reasonKinds: LineKind[];
  /** the display names the text was written with, [me, foe] (the UI colours them) */
  names: [string, string];
}

/** Topic of one explanation line. Reasons put "what to try" after " → ". */
export type LineKind =
  | 'damage' | 'hit' | 'defence' | 'burn' | 'control' | 'chain' | 'speed' | 'thorns' | 'heal' | 'growth' | 'fatigue' | 'ko' | 'idle'
  | 'poison' | 'dodge' | 'ult';

export interface Moment {
  kind: 'hit' | 'chain' | 'comeback' | 'lock' | 'ult';
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
  poisonTaken: number;
  /** enemy hits this side dodged */
  dodged: number;
  /** this side's ultimate: tick it fired (-1 = no) and its level */
  ultT: number;
  ultLv: number;
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
const skillName = (id: string) =>
  id === 'thorns' ? L('หนาม', 'Thorns') : id === 'burn' ? L('ไฟ', 'Burn') : id === 'poison' ? L('พิษ', 'Poison') : id === 'ult' ? L('ท่าไม้ตาย', 'Ultimate')
    : id === 'fatigue' ? L('ความเหนื่อยล้า', 'Fatigue') : SKILLS[id]?.name ?? id;
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
    dealt: 0, blockedByFoe: 0, thornsTaken: 0, burnTaken: 0, fatigueTaken: 0, poisonTaken: 0, dodged: 0, ultT: -1, ultLv: 0, healed: 0, shielded: 0,
    bigHit: 0, bigHitSrc: '', bigHitT: 0, casts: 0, growth: 0,
  })) as [SideTotals, SideTotals];
  for (const e of r.events) {
    if (e.type === 'damage') {
      const victim = t[e.side];
      const attacker = t[1 - e.side];
      if (e.src === 'fatigue') victim.fatigueTaken += e.amount;
      else if (refl.has(e)) victim.thornsTaken += e.amount + e.blocked;
      else if (e.src === 'burn') victim.burnTaken += e.amount;
      else if (e.src === 'poison') victim.poisonTaken += e.amount;
      if (e.src !== 'fatigue') {
        attacker.dealt += e.amount + e.blocked;
        attacker.blockedByFoe += e.blocked;
        if (e.src !== 'burn' && e.src !== 'poison' && !refl.has(e) && e.amount + e.blocked > attacker.bigHit) {
          attacker.bigHit = e.amount + e.blocked;
          attacker.bigHitSrc = e.src;
          attacker.bigHitT = e.t;
        }
      }
    } else if (e.type === 'heal') t[e.side].healed += e.amount;
    else if (e.type === 'status' && e.status === 'evade') t[e.side].dodged++;
    else if (e.type === 'ult') {
      t[e.side].ultT = e.t;
      t[e.side].ultLv = e.lv;
    }
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
  // who gave thorns: skills with a thorns effect (perm stacks count double), the thorns hero
  const weight = b.skills.map((k, i) => {
    const th = nodeOf(k).fx.find((e) => e.k === 'thorns') as { n: number; perm?: boolean } | undefined;
    if (th) return th.n * (th.perm ? 2 : 1) * fires(i);
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
    if (share > 0) out.push({ idx: -1, name: L('หนามติดตัว (ฮีโร่)', 'Hero thorns'), direct: 0, reflect: share, burn: 0, total: share });
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
  r: CombatResult, builds: [Build, Build], me: Side = 0, names: [string, string] = [L('คุณ', 'You'), L('ศัตรู', 'Enemy')], opts: ExplainOpts = {},
): Explanation {
  const foe = (1 - me) as Side;
  // names glued to Thai words get spaces around them ("ของ Mochi-12 ") except "คุณ"; extra spaces are squeezed at the end
  // (English: every name gets spaces, which the squeeze also tidies)
  const N = names.map((x) => (x === 'คุณ' ? x : ` ${x} `)) as [string, string];
  /** English "was" for side s ("You were") */
  const was = (s: Side) => (names[s] === 'You' ? 'were' : 'was');
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
  const drawWord = opts.drawIsLoss ? L('เสมอ (นับเป็นแพ้)', 'draw (counts as a loss)') : L('เสมอ', 'draw');
  const wl = won ? L('ชนะ', 'Won') : L('แพ้', 'Lost');

  // ---------- headline ----------
  let how: string;
  if (draw) how = drawWord.charAt(0).toUpperCase() + drawWord.slice(1);
  else if (timeout) how = L(`${wl}เพราะหมดเวลา`, `${wl} on time`);
  else if (bothDown) how = L(`${wl}ตอนล้มพร้อมกัน`, `${wl} on a double KO`);
  else if (fatigued) how = L(`${wl}ช่วงเหนื่อยล้า`, `${wl} during fatigue`);
  else how = won ? L('ชนะน็อก', 'Won by KO') : L('แพ้น็อก', 'Lost by KO');
  const hpLine = `${N[me]} ${Math.max(0, endHp[me])}/${r.maxHp[me]} · ${N[foe]} ${Math.max(0, endHp[foe])}/${r.maxHp[foe]}`;
  const headline = L(`${how} · ${sec(len)} วิ · เลือดเหลือ ${hpLine}`, `${how} · ${sec(len)}s · HP left: ${hpLine}`);

  // ---------- how a tie was decided (same rule as simulate) ----------
  let tiebreak: string | undefined;
  if (bothDown)
    tiebreak = L(
      `ทั้งสองฝ่ายเลือดหมดในวินาทีเดียวกัน (${sec(len)} วิ) กติกาตัดสินจากเลือดที่ติดลบน้อยกว่า: ${N[me]} ${endHp[me]} · ${N[foe]} ${endHp[foe]}${
        draw ? ` เท่ากันพอดีจึง${drawWord}` : ` → ${N[r.winner as Side]} ชนะ`
      }`,
      `Both sides ran out of HP in the same second (${sec(len)}s); the rule picks the side less below zero: ${N[me]} ${endHp[me]} · ${N[foe]} ${endHp[foe]}${
        draw ? `, exactly equal, so it is a ${drawWord}` : ` → ${N[r.winner as Side]} wins`
      }`,
    );
  else if (timeout)
    tiebreak = L(
      `ครบ ${sec(MAX_TICKS)} วิ ยังไม่มีใครล้ม กติกาเทียบเลือดที่เหลือเป็น %: ${N[me]} ${Math.round(hpShare[me] * 100)}% · ${N[foe]} ${Math.round(hpShare[foe] * 100)}%${
        draw ? ` เท่ากันจึง${drawWord}` : ''
      }`,
      `${sec(MAX_TICKS)}s passed and nobody fell; the rule compares HP left in %: ${N[me]} ${Math.round(hpShare[me] * 100)}% · ${N[foe]} ${Math.round(hpShare[foe] * 100)}%${
        draw ? `, equal, so it is a ${drawWord}` : ''
      }`,
    );
  else if (draw) tiebreak = L(`ทั้งสองฝ่ายจบด้วยเลือดเท่ากัน จึง${drawWord}`, `Both sides ended with the same HP, so it is a ${drawWord}`);
  if (fatigued && tiebreak)
    tiebreak += L(` · ความเหนื่อยล้าเริ่มที่ ${sec(fStart)} วิ ทำดาเมจเท่ากันทั้งสองฝ่าย`, ` · fatigue started at ${sec(fStart)}s and hits both sides equally`);

  const winnerShare = r.winner === -1 ? 0 : hpShare[r.winner];
  const close = draw || winnerShare <= 0.1;

  // ---------- facts ----------
  const facts: string[] = [];
  const factKinds: LineKind[] = [];
  const fact = (kind: LineKind, text: string) => (facts.push(text), factKinds.push(kind));
  const dmg = [skillDamage(r, builds[0], 0), skillDamage(r, builds[1], 1)];
  const top = (s: Side) => {
    const list = dmg[s];
    const total = list.reduce((n, x) => n + x.total, 0);
    const best = list.reduce<SkillDamage | null>((b, x) => (!b || x.total > b.total ? x : b), null);
    if (!best || best.total <= 0) return '';
    const parts = [
      best.reflect ? L(`สะท้อนหนาม ${best.reflect}`, `thorns ${best.reflect}`) : '',
      best.burn ? L(`ไฟ/พิษ ${best.burn}`, `burn/poison ${best.burn}`) : '',
    ].filter(Boolean);
    return `${best.name} ${best.total} (${pct(best.total, total)}%${parts.length ? ` · ${parts.join(' · ')}` : ''})`;
  };
  fact('damage', L(`ดาเมจรวม: ${N[me]} ${my.dealt} · ${N[foe]} ${their.dealt}`, `Total damage: ${N[me]} ${my.dealt} · ${N[foe]} ${their.dealt}`));
  const mt = top(me);
  const ft = top(foe);
  if (mt) fact('damage', L(`skill ทำดาเมจมากสุดของ${N[me]}: ${mt}`, `Top damage skill of${N[me]}: ${mt}`));
  if (ft) fact('damage', L(`skill ทำดาเมจมากสุดของ${N[foe]}: ${ft}`, `Top damage skill of${N[foe]}: ${ft}`));
  fact('speed', L(`ใช้ skill: ${N[me]} ${my.casts} ครั้ง · ${N[foe]} ${their.casts} ครั้ง`, `Skills fired: ${N[me]} ${my.casts} · ${N[foe]} ${their.casts}`));
  const ctlOn = (s: Side) => r.stats[1 - s].reduce((n, x) => n + x.fz, 0); // control applied TO side s
  const myCtl = ctlOn(me);
  const theirCtl = ctlOn(foe);
  if (myCtl || theirCtl)
    fact(
      'control',
      L(
        `โดนควบคุม (แช่แข็ง/ถ่วงเวลา): ${N[me]} ${sec(myCtl)} วิ · ${N[foe]} ${sec(theirCtl)} วิ`,
        `Controlled (freeze/delay): ${N[me]} ${sec(myCtl)}s · ${N[foe]} ${sec(theirCtl)}s`,
      ),
    );
  if (my.bigHit || their.bigHit) {
    const hits = `${N[me]} ${my.bigHit}${my.bigHitSrc ? ` (${srcName(me, my.bigHitSrc)})` : ''} · ${N[foe]} ${their.bigHit}${their.bigHitSrc ? ` (${srcName(foe, their.bigHitSrc)})` : ''}`;
    fact('hit', L(`ตีแรงสุด: ${hits}`, `Biggest hit: ${hits}`));
  }
  // ultimates (sim v12): who fired theirs, when
  const ultName = (s: Side) => HEROES_BY_ID[builds[s].hero]?.ult.name ?? '';
  const ultTxt = (s: Side) =>
    T[s].ultT >= 0
      ? L(`${N[s]} ${ultName(s)} Lv${T[s].ultLv} ที่ ${sec(T[s].ultT)} วิ`, `${N[s]} ${ultName(s)} Lv${T[s].ultLv} at ${sec(T[s].ultT)}s`)
      : (r.sides?.[s].ultLv ?? 0) > 0
        ? L(`${N[s]} ปลดแล้วแต่ไม่ได้ใช้`, `${N[s]} unlocked but did not fire`)
        : '';
  /** the effect text of side s's ultimate at the level it fired */
  const ultEffect = (s: Side) => (HEROES_BY_ID[builds[s].hero]?.ult.effect ?? '').split(' · Lv2 ')[T[s].ultLv >= 2 ? 1 : 0] ?? '';
  const ults = [ultTxt(me), ultTxt(foe)].filter(Boolean);
  if (ults.length) fact('ult', L(`ท่าไม้ตาย: ${ults.join(' · ')}`, `Ultimates: ${ults.join(' · ')}`));
  if (my.dodged || their.dodged)
    fact('dodge', L(`หลบการตีได้: ${N[me]} ${my.dodged} ครั้ง · ${N[foe]} ${their.dodged} ครั้ง`, `Hits dodged: ${N[me]} ${my.dodged} · ${N[foe]} ${their.dodged}`));
  if (fatigued)
    fact(
      'fatigue',
      L(`ความเหนื่อยล้าเริ่มที่ ${sec(fStart)} วิ (วันที่ ${r.day}) แล้วแรงขึ้นทุกวินาที`, `Fatigue started at ${sec(fStart)}s (day ${r.day}) and grew every second`),
    );

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
            `${N[s]} never fired a skill${ctl ? ` (frozen/delayed ${sec(ctl)}s${w ? `, longest lock until ${until.toFixed(1)}s` : ''})` : ' (cooldowns longer than the fight)'}`,
          )
        : L(
            `${N[s]} โดนแช่แข็ง/ถ่วงเวลา ${sec(ctl)} วิ (${share}% ของการสู้)${w ? ` ล็อกยาวสุด ${sec(w[1] - w[0])} วิ ถึงวินาทีที่ ${until.toFixed(1)}` : ''} · ใช้ skill ได้ ${casts} ครั้ง`,
            `${N[s]} ${was(s)} frozen/delayed for ${sec(ctl)}s (${share}% of the fight)${w ? `, longest lock ${sec(w[1] - w[0])}s until ${until.toFixed(1)}s` : ''} · fired ${casts} skills`,
          );
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
    if (cd > len) return L(`คูลดาวน์ ${sec(cd)} วิ ยาวกว่าการสู้ (จบที่ ${sec(len)} วิ)`, `cooldown ${sec(cd)}s is longer than the fight (it ended at ${sec(len)}s)`);
    if (ctl > 0 && cd + ctl >= len * 0.8)
      return L(
        `คูลดาวน์ ${sec(cd)} วิ แต่${N[me]}โดนแช่แข็ง/ถ่วงเวลารวม ${sec(ctl)} วิ${w ? ` (ล็อกยาวสุด ${sec(w[0])}–${sec(w[1])} วิ)` : ''}${slowed ? ' และโดนทำให้ช้าลง' : ''} คูลดาวน์หยุดนับ เลยไม่ทันได้ออกก่อนจบที่ ${sec(len)} วิ`,
        `cooldown ${sec(cd)}s, but${N[me]}${was(me)} frozen/delayed for ${sec(ctl)}s in total${w ? ` (longest lock ${sec(w[0])}–${sec(w[1])}s)` : ''}${slowed ? ' and slowed' : ''}; the cooldown stopped, so it never fired before the end at ${sec(len)}s`,
      );
    if (slowed) return L(`คูลดาวน์ ${sec(cd)} วิ แต่โดนทำให้ช้าลง จนการสู้จบที่ ${sec(len)} วิ ก่อนถึงคิว`, `cooldown ${sec(cd)}s, but it was slowed and the fight ended at ${sec(len)}s before its turn`);
    return L(`คูลดาวน์ ${sec(cd)} วิ นับไม่ทันก่อนการสู้จบที่ ${sec(len)} วิ`, `cooldown ${sec(cd)}s did not finish before the fight ended at ${sec(len)}s`);
  };
  const steadfastHint = (i: number) =>
    mySkills[i].mark === 'steadfast' ? '' : L(' (ตรา ไม่หวั่นไหว ทำให้คูลดาวน์เดินต่อแม้โดนแช่แข็ง)', ' (the Unshaken mark keeps a cooldown running while frozen)');
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
      const base = nodeOf(mySkills[i]).name;
      const nm = `${base}${base !== skillName(id) ? L(` (สาย${skillName(id)})`, ` (${skillName(id)} line)`) : ''}`;
      const f = firesOf(i);
      if (f === 0) reported.add(i);
      if (f === 0) {
        const why = `${idleWhy(i)}${lockedTicks ? steadfastHint(i) : ''}`;
        notes.push(L(`${nm} ที่มีอยู่ไม่ได้ทำงานเลย: ${why}`, `your ${nm} never fired: ${why}`));
      } else
        notes.push(
          L(
            `${nm} ที่มีอยู่ทำงาน ${f} ครั้ง${lvOf(mySkills[i].v) < 3 ? ' → อัปเลเวลให้แรงขึ้น' : ' แต่ยังไม่พอ'}`,
            `your ${nm} fired ${f} times${lvOf(mySkills[i].v) < 3 ? ' → level it up' : ' but it was not enough'}`,
          ),
        );
    }
    const parts = [buy.length ? L(`ลอง ${buy.join(' หรือ ')}`, `try ${buy.join(' or ')}`) : fallback, notes.join(' · ')].filter(Boolean);
    return parts.join(' · ');
  };

  // ---------- reasons (scored, highest first) ----------
  const out: [number, string, LineKind][] = [];
  const add = (score: number, text: string, kind: LineKind) => score > 0 && out.push([score, text, kind]);
  const lostHp = r.maxHp[me];
  if (!won) {
    if (pct(myCtl, len) >= 20) {
      const tip = advise(
        [['ironwill', L('การควบคุมอ่อนลง 60%', 'control 60% weaker')], ['cleanse', L('ลบการแช่แข็ง', 'removes freeze')]],
        L('ย้าย skill หลักไปใส่ตรา ไม่หวั่นไหว', 'give your main skill the Unshaken mark'),
      );
      add(
        pct(myCtl, len),
        L(
          `${N[me]}โดนแช่แข็ง/ถ่วงเวลา ${sec(myCtl)} วิ (${pct(myCtl, len)}% ของการสู้) skill แทบไม่ได้ออก → ${tip}`,
          `${N[me]}${was(me)} frozen/delayed for ${sec(myCtl)}s (${pct(myCtl, len)}% of the fight), so skills barely fired → ${tip}`,
        ),
        'control',
      );
    }
    if (pct(my.blockedByFoe, my.dealt) >= 30) {
      const tip = advise(
        [
          ['heavy', L('ทะลุโล่ครึ่งหนึ่ง', 'pierces half the shield')],
          ['ignite', L('ไฟไม่สนโล่', 'burn ignores shields')],
          ['dispel', L('ลบโล่ 20%', 'removes 20% of the shield')],
        ],
        L('อัปสาย ทะลุ ของ skill โจมตี', 'upgrade an attack skill along a pierce branch'),
      );
      add(
        pct(my.blockedByFoe, my.dealt),
        L(
          `โล่ของ${N[foe]}กันดาเมจ${N[me]}ไป ${my.blockedByFoe} (${pct(my.blockedByFoe, my.dealt)}%) → ${tip}`,
          `The shield of${N[foe]}blocked ${my.blockedByFoe} of the damage from${N[me]}(${pct(my.blockedByFoe, my.dealt)}%) → ${tip}`,
        ),
        'defence',
      );
    }
    if (pct(my.thornsTaken, lostHp) >= 15) {
      const tip = advise([['heavy', L('ตีทีเดียวแรง', 'one big hit')], ['dispel', L('ลบหนาม', 'removes thorns')]]);
      add(
        pct(my.thornsTaken, lostHp),
        L(
          `หนามของ${N[foe]}สะท้อนใส่${N[me]} ${my.thornsTaken} → ตีน้อยครั้งแต่แรงแทนการตีรัว · ${tip}`,
          `The thorns of${N[foe]}reflected ${my.thornsTaken} onto${N[me]}→ hit fewer, harder times instead of many quick hits · ${tip}`,
        ),
        'thorns',
      );
    }
    if (pct(their.healed, my.dealt) >= 20) {
      const tip = advise(
        [['thorns', L('ระหว่างมีหนาม ศัตรูฟื้นได้ครึ่งเดียว', 'while you have thorns, the enemy heals only half')]],
        L('เร่งดาเมจให้จบเร็ว', 'deal damage faster to end it sooner'),
      );
      add(
        pct(their.healed, my.dealt),
        L(
          `${N[foe]}ฟื้นเลือด ${their.healed} (${pct(their.healed, my.dealt)}% ของดาเมจ${N[me]}) → ${tip}`,
          `${N[foe]}healed ${their.healed} (${pct(their.healed, my.dealt)}% of the damage from${N[me]}) → ${tip}`,
        ),
        'heal',
      );
    }
    if (pct(my.poisonTaken, lostHp) >= 25) {
      const tip = advise(
        [['tailwind', L('พัดไฟ/พิษทิ้ง', 'blows burn/poison away')], ['cleanse', L('ลบพิษกองที่แรงสุด', 'removes the strongest poison')]],
        L('ตีให้จบเร็วก่อนพิษซ้อน', 'end it before the poison stacks up'),
      );
      add(
        pct(my.poisonTaken, lostHp),
        L(`พิษทำดาเมจ${N[me]} ${my.poisonTaken} (ไม่สนโล่ หลบไม่ได้ และลดการฟื้น) → ${tip}`, `Poison dealt ${my.poisonTaken} to${N[me]}(it ignores shields, can't be dodged and cuts healing) → ${tip}`),
        'poison',
      );
    }
    if (their.dodged >= 3) {
      const tip = advise(
        [['heavy', L('สาย ทุบแม่น ตีไม่พลาด', 'the Sure Smash branch never misses')], ['ignite', L('ไฟหลบไม่ได้', "burn can't be dodged")], ['venom', L('พิษหลบไม่ได้', "poison can't be dodged")]],
      );
      add(
        their.dodged * 6,
        L(`${N[foe]}หลบการตีของ${N[me]}ได้ ${their.dodged} ครั้ง → ใช้ไฟ/พิษ หรือการตีที่หลบไม่ได้ (👁) · ${tip}`, `${N[foe]}dodged ${their.dodged} hits from${N[me]}→ use burn/poison or hits that can't be dodged (👁) · ${tip}`),
        'dodge',
      );
    }
    if (their.ultT >= 0) {
      add(
        12,
        L(
          `${N[foe]}ใช้ท่าไม้ตาย ${ultName(foe)} ที่ ${sec(their.ultT)} วิ (${ultEffect(foe)})`,
          `${N[foe]}fired the ultimate ${ultName(foe)} at ${sec(their.ultT)}s (${ultEffect(foe)})`,
        ),
        'ult',
      );
    }
    if (pct(my.burnTaken, lostHp) >= 25) {
      const tip = advise([['cleanse', L('ลบไฟกองที่แรงสุด', 'removes the strongest burn')]], L('เร่งดาเมจให้จบก่อนไฟซ้อน', 'end the fight before burns stack up'));
      add(
        pct(my.burnTaken, lostHp),
        L(`ไฟทำดาเมจ${N[me]} ${my.burnTaken} (ไม่สนโล่) → ${tip}`, `Burn dealt ${my.burnTaken} to${N[me]}(it ignores shields) → ${tip}`), 'burn',
      );
    }
    if (their.growth >= 8 && their.growth > my.growth * 2) {
      const tip = advise([['dispel', L('ลบพลังโจมตี', 'removes attack power')]], L('ทำดาเมจให้จบก่อนศัตรูโต', 'end the fight before the enemy grows'));
      add(
        their.growth * 3,
        L(
          `${N[foe]}สะสมพลังโจมตีได้ถึง +${their.growth} ต่อการตี (ของ${N[me]} +${my.growth}) ยิ่งนานยิ่งแรง → ${tip}`,
          `${N[foe]}stacked attack power up to +${their.growth} per hit (${N[me]}: +${my.growth}); the longer it goes, the harder they hit → ${tip}`,
        ),
        'growth',
      );
    }
    if (fatigued && my.dealt < their.dealt)
      add(
        30,
        L(
          `สู้กันยืดเยื้อเกิน ${sec(fStart)} วิ จนเหนื่อยล้า และ${N[foe]}ทำดาเมจได้มากกว่า (${their.dealt} ต่อ ${my.dealt}) → เพิ่ม skill ที่ตีได้ หรืออัปเลเวล skill หลัก`,
          `The fight dragged past ${sec(fStart)}s into fatigue, and${N[foe]}dealt more damage (${their.dealt} vs ${my.dealt}) → add skills that hit, or level up your main skill`,
        ),
        'fatigue',
      );
    if (their.casts > my.casts * 1.6 && their.casts >= 8) {
      const tip = advise([['chill', L('ศัตรูช้าลง', 'slows the enemy')], ['frost', L('แช่แข็งศัตรู', 'freezes the enemy')]]);
      add(
        Math.round((their.casts / Math.max(1, my.casts)) * 10),
        L(
          `${N[foe]}ใช้ skill ถี่กว่ามาก (${their.casts} ต่อ ${my.casts} ครั้ง) → skill คูลดาวน์สั้น ตราร่ายไว · ${tip}`,
          `${N[foe]}fired skills much more often (${their.casts} vs ${my.casts}) → short-cooldown skills, the Quickcast mark · ${tip}`,
        ),
        'speed',
      );
    }
    if (!out.length && their.dealt > my.dealt)
      add(
        1,
        L(
          `${N[foe]}ทำดาเมจได้มากกว่า (${their.dealt} ต่อ ${my.dealt}) → อัปเลเวล skill ที่ทำดาเมจมากสุด หรือซื้อช่อง skill เพิ่มในร้าน`,
          `${N[foe]}dealt more damage (${their.dealt} vs ${my.dealt}) → level up your top damage skill, or buy another skill slot in the shop`,
        ),
        'damage',
      );
    else if (!out.length)
      add(
        1,
        L(
          `${N[me]}ทำดาเมจมากกว่า (${my.dealt} ต่อ ${their.dealt}) แต่${N[foe]}อึดกว่า (โล่ ${their.shielded} ฟื้นเลือด ${their.healed}) → เพิ่มการทะลุโล่ ไฟ/พิษ หรือแผลลึก`,
          `${N[me]}dealt more damage (${my.dealt} vs ${their.dealt}) but${N[foe]}lasted longer (shield ${their.shielded}, healing ${their.healed}) → add pierce, burn/poison or wounds`,
        ),
        'defence',
      );
  } else {
    if (pct(theirCtl, len) >= 20)
      add(
        pct(theirCtl, len),
        L(`${N[me]}ควบคุม${N[foe]}ได้ ${sec(theirCtl)} วิ (${pct(theirCtl, len)}% ของการสู้)`, `${N[me]}controlled${N[foe]}for ${sec(theirCtl)}s (${pct(theirCtl, len)}% of the fight)`), 'control',
      );
    if (my.casts > their.casts * 1.6 && my.casts >= 8)
      add(
        Math.round((my.casts / Math.max(1, their.casts)) * 10),
        L(`${N[me]}ใช้ skill ถี่กว่ามาก (${my.casts} ต่อ ${their.casts} ครั้ง)`, `${N[me]}fired skills much more often (${my.casts} vs ${their.casts})`), 'speed',
      );
    if (pct(their.thornsTaken, r.maxHp[foe]) >= 15)
      add(
        pct(their.thornsTaken, r.maxHp[foe]),
        L(`หนามของ${N[me]}สะท้อนใส่${N[foe]} ${their.thornsTaken}`, `The thorns of${N[me]}reflected ${their.thornsTaken} onto${N[foe]}`), 'thorns',
      );
    if (my.ultT >= 0) add(15, L(`${N[me]}ใช้ท่าไม้ตาย ${ultName(me)} Lv${my.ultLv} ที่ ${sec(my.ultT)} วิ`, `${N[me]}fired the ultimate ${ultName(me)} Lv${my.ultLv} at ${sec(my.ultT)}s`), 'ult');
    if (my.dodged >= 3) add(my.dodged * 5, L(`${N[me]}หลบการตีได้ ${my.dodged} ครั้ง`, `${N[me]}dodged ${my.dodged} hits`), 'dodge');
    if (my.growth >= 8) add(my.growth * 2, L(`${N[me]}สะสมพลังโจมตีได้ถึง +${my.growth} ต่อการตี`, `${N[me]}stacked attack power up to +${my.growth} per hit`), 'growth');
    const best = dmg[me].reduce<SkillDamage | null>((b, x) => (!b || x.total > b.total ? x : b), null);
    const total = dmg[me].reduce((n, x) => n + x.total, 0);
    if (best && pct(best.total, total) >= 40)
      add(
        pct(best.total, total),
        L(`${best.name} ของ${N[me]}ทำดาเมจ ${pct(best.total, total)}% ของทั้งหมด`, `${best.name} of${N[me]}dealt ${pct(best.total, total)}% of all the damage`), 'damage',
      );
    if (bothDown)
      add(
        50,
        L(`ล้มพร้อมกัน แต่${N[me]}เลือดติดลบน้อยกว่า (${endHp[me]} ต่อ ${endHp[foe]})`, `Both fell at once, but${N[me]}${was(me)} less below zero (${endHp[me]} vs ${endHp[foe]})`), 'ko',
      );
    if (!out.length) {
      if (my.dealt >= their.dealt) add(1, L(`${N[me]}ทำดาเมจได้มากกว่า (${my.dealt} ต่อ ${their.dealt})`, `${N[me]}dealt more damage (${my.dealt} vs ${their.dealt})`), 'damage');
      else if (fatigued)
        add(
          1,
          L(
            `${N[me]}อึดกว่าในช่วงเหนื่อยล้า (โล่ ${my.shielded} ฟื้นเลือด ${my.healed}) แม้ทำดาเมจน้อยกว่า (${my.dealt} ต่อ ${their.dealt}) → เพิ่ม skill ที่ตีได้ จะชนะง่ายขึ้น`,
            `${N[me]}lasted longer in fatigue (shield ${my.shielded}, healing ${my.healed}) despite dealing less damage (${my.dealt} vs ${their.dealt}) → add skills that hit to win more easily`,
          ),
          'fatigue',
        );
      else
        add(
          1,
          L(`${N[me]}เหลือเลือดมากกว่าตอนจบ (โล่ ${my.shielded} ฟื้นเลือด ${my.healed})`, `${N[me]}had more HP left at the end (shield ${my.shielded}, healing ${my.healed})`), 'defence',
        );
    }
  }
  if (!won && bothDown)
    add(
      60,
      L(
        `ล้มพร้อมกัน แต่${N[me]}เลือดติดลบมากกว่า (${endHp[me]} ต่อ ${endHp[foe]}) → ดาเมจอีกนิดเดียวก็ชนะ: อัปเลเวล skill หลัก หรือเพิ่มโล่/ฟื้นเลือด`,
        `Both fell at once, but${N[me]}${was(me)} further below zero (${endHp[me]} vs ${endHp[foe]}) → a little more damage wins it: level up your main skill or add shield/healing`,
      ),
      'ko',
    );
  // skills that never fired, with the real reason
  const idle = mySkills.map((_, i) => i).filter((i) => r.stats[me][i] && firesOf(i) === 0);
  if (idle.length && !won) {
    const txt = idle
      .filter((i) => !reported.has(i))
      .map((i) => `${nodeOf(mySkills[i]).name}: ${idleWhy(i)}`);
    if (txt.length) add(lockedTicks ? 25 : 5, L(`skill ที่ไม่ได้ทำงานเลย · ${txt.join(' · ')}`, `Skills that never fired · ${txt.join(' · ')}`), 'idle');
  }
  const hitters = dmg[me].filter((x) => x.idx >= 0 && x.total > 0).length;
  if (!won && mySkills.length >= 3 && hitters <= 1)
    add(
      8,
      L(
        `มีแค่ ${hitters} skill ที่ทำดาเมจ → เพิ่ม skill โจมตีอีกสักตัว (หรือให้ skill ที่มีอยู่เลเวลสูงขึ้น)`,
        `Only ${hitters} skill${hitters === 1 ? '' : 's'} dealt damage → add another attack skill (or level up the ones you have)`,
      ),
      'damage',
    );

  out.sort((a, b) => b[0] - a[0]);

  // ---------- big moments ----------
  const moments: Moment[] = [];
  const big = my.bigHit >= their.bigHit ? me : foe;
  if (T[big].bigHit > 0)
    moments.push({
      kind: 'hit', icon: '💥', title: L('ตีแรงสุด', 'Biggest hit'), side: big, t: T[big].bigHitT,
      text: L(
        `${N[big]} ${srcName(big, T[big].bigHitSrc)} ${T[big].bigHit} ที่ ${sec(T[big].bigHitT)} วิ`,
        `${N[big]} ${srcName(big, T[big].bigHitSrc)} ${T[big].bigHit} at ${sec(T[big].bigHitT)}s`,
      ),
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
      kind: 'chain', icon: '🔗', title: L('คอมโบยาวสุด', 'Longest combo'), side: chain.side, t: chain.t,
      text: L(
        `${N[chain.side]} ปล่อย ${chain.n} skill ในจังหวะเดียว ที่ ${sec(chain.t)} วิ${chain.trig ? ` (โบนัสเชื่อมต่อสั่งต่อ ${chain.trig})` : ''}`,
        `${N[chain.side]} fired ${chain.n} skills at once at ${sec(chain.t)}s${chain.trig ? ` (${chain.trig} set off by connect bonuses)` : ''}`,
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
          `${N[w]} ${was(w)} down to ${Math.max(0, Math.round(worst.ws * 100))}% HP at ${sec(worst.t)}s (${Math.round(worst.gap * 100)}% behind) but came back to win`,
        ),
      });
  }
  for (const s of [me, foe])
    if (T[s].ultT >= 0)
      moments.push({
        kind: 'ult', icon: '★', title: L('ท่าไม้ตาย', 'Ultimate'), side: s, t: T[s].ultT,
        text: L(`${N[s]} ${ultName(s)} Lv${T[s].ultLv} ที่ ${sec(T[s].ultT)} วิ`, `${N[s]} ${ultName(s)} Lv${T[s].ultLv} at ${sec(T[s].ultT)}s`),
      });
  for (const s of [me, foe]) {
    const w = longest(s);
    if (w && w[1] - w[0] >= 3 * TPS)
      moments.push({
        kind: 'lock', icon: '❄', title: L('โดนล็อกนานสุด', 'Longest lock'), side: s, t: w[0],
        text: L(
          `${N[s]} ขยับไม่ได้ ${sec(w[1] - w[0])} วิ (${sec(w[0])}–${sec(w[1])} วิ)`,
          `${N[s]} could not move for ${sec(w[1] - w[0])}s (${sec(w[0])}–${sec(w[1])}s)`,
        ),
      });
  }

  const sq = (t: string) => {
    const s = t.replace(/ {2,}/g, ' ').replace(/ ([,):])/g, '$1').trim();
    return getLang() === 'en' ? s.replace(/\( /g, '(') : s; // English pads every name with spaces
  };
  for (const m of moments) m.text = sq(m.text);
  for (const l of locks) l.text = sq(l.text);
  return {
    headline: sq(headline), facts: facts.map(sq), reasons: out.slice(0, 3).map((x) => sq(x[1])), reasonKinds: out.slice(0, 3).map((x) => x[2]), close,
    tiebreak: tiebreak && sq(tiebreak), moments, locks, hpShare, factKinds, names: [names[me], names[foe]],
  };
}
