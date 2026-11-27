/**
 * UI pieces of the depth systems (sim v17–v20): relic medallions, relic cards and the relic tray, ★ pips, mark
 * badges and the mark count, the ult checklist and the run-end Build Card. Pure HTML strings from the run state and
 * live tuning (no numbers typed in here), in the current language through L(th, en).
 * `data-codex` on a piece opens its codex entry (codex.ts); `data-ttxt` gives the hover / tap tooltip (ui.ts).
 */
import { L, getLang } from '../../shared/i18n';
import { HEROES_BY_ID, inLine, ultLevel, ultLv3, ultPieces, ULT_LV2_LV3, ULT_PIECES, ultProgressText } from '../../sim/heroes';
import { GROUP_ICON, MAX_RELICS, RELIC_DAYS, RELICS_BY_ID, relicFitsBuild, relicHint, type RelicGroup } from '../../sim/relics';
import * as R from '../../sim/run';
import { LINE_ICON, LINE_NAME, SKILLS, lvOf, nodeOf, rarityOf } from '../../sim/skills';
import { T } from '../../sim/tuning';
import { starPower } from '../../sim/combat';
import type { Mark, SkillInstance } from '../../sim/types';
import { LINE_COLORS, skillIcon } from '../art/assets';
import { DEPTH_FILES, artOr } from '../art/depthArt';
import { esc } from './html';

export { esc } from './html';
const pc = (x: number) => Math.round(x * 100);
const th = () => getLang() !== 'en';

/** most marks a run can hold: the last chance's one + the wish marks */
export const MARK_MAX = 1 + R.WISH_MARKS_MAX;
/** lone wolf pays off with this many skills or fewer (combat.ts relicMult) */
export const LONE_MAX = 3;

// ---------- relics ----------
export const relicName = (id: string) => {
  const x = RELICS_BY_ID[id];
  return x ? L(x.name[0], x.name[1]) : id;
};
export const relicDesc = (id: string) => {
  const x = RELICS_BY_ID[id];
  if (!x) return '';
  const d = x.desc();
  return th() ? d[0] : d[1];
};
const GROUP_RING: Record<RelicGroup, string> = { ...LINE_COLORS, any: '#ffe3a3', cheese: '#ff9b7a' } as Record<RelicGroup, string>;
/** "🛡 โล่" / "✦ ทั่วไป" / "☢ เสี่ยง" */
export const groupLabel = (g: RelicGroup) =>
  g === 'any' ? `${GROUP_ICON.any} ${L('ทั่วไป', 'any build')}` : g === 'cheese' ? `${GROUP_ICON.cheese} ${L('เสี่ยง', 'risky')}` : `${GROUP_ICON[g]} ${LINE_NAME[g]}`;

/**
 * round medallion: the relic's painted art, or until the pack lands its glyph drawn by CSS (::before from data-g, so the
 * stand-in emoji is decoration only and never part of the page text) in a ring of its group colour
 */
export function relicMedal(id: string, size: 'sm' | 'md' | 'lg' = 'md') {
  const x = RELICS_BY_ID[id];
  const g = x?.group ?? 'any';
  return `<span class="rlm rlm-${size}${g === 'cheese' ? ' rlm-risk' : ''}" style="--ring:${GROUP_RING[g]}" aria-hidden="true">${artOr(DEPTH_FILES.relic(id), `<span class="rlm-g" data-g="${esc(x?.icon ?? '?')}"></span>`, 'rlm-img')}</span>`;
}

/**
 * The downside / requirement of a risky relic, with live numbers and, when a build is given, whether it is met now.
 * null for a plain relic.
 */
export function relicRisk(id: string, skills: Pick<SkillInstance, 'mark' | 'markHidden'>[] | null) {
  const marks = skills ? skills.filter((k) => k.mark || k.markHidden).length : 0;
  switch (id) {
    case 'glasscannon':
      return { band: L(`ข้อเสีย: เลือดสูงสุด −${pc(1 - T['relic.glassHp'])}%`, `Downside: max HP −${pc(1 - T['relic.glassHp'])}%`), now: L('ต้องมีโล่หรือฟื้นเลือดช่วย', 'bring shields or healing'), ok: null as boolean | null };
    case 'lonewolf':
      return {
        band: L(`ใช้ได้แค่ ${LONE_MAX} skill · ปิดท่าไม้ตาย Lv2`, `Max ${LONE_MAX} skills · blocks ult Lv2`),
        now: skills ? L(`ตอนนี้มี ${skills.length} ตัว${skills.length > LONE_MAX ? ' (ยังไม่มีผล)' : ''}`, `you have ${skills.length}${skills.length > LONE_MAX ? ' (no effect yet)' : ''}`) : L(`ท่าไม้ตาย Lv2 ต้องมีสกิลสาย ${ULT_PIECES[1]} ตัว`, `ult Lv2 needs ${ULT_PIECES[1]} line skills`),
        ok: skills ? skills.length <= LONE_MAX : null,
      };
    case 'sigil':
      return {
        band: L('ต้องมีตราอย่างน้อย 2 อัน', 'Needs 2+ marks'),
        now: skills ? L(`ตอนนี้มี ${marks} อัน (มีได้สูงสุด ${MARK_MAX})`, `you have ${marks} (max ${MARK_MAX})`) : L('ตราได้จากโอกาสสุดท้าย / พรจันทร์', 'marks come from the last chance / moon wishes'),
        ok: skills ? marks >= 2 : null,
      };
    default:
      return null;
  }
}

/** tooltip body of a relic (name, effect, group, risk) */
export function relicTip(id: string) {
  const x = RELICS_BY_ID[id];
  if (!x) return '';
  const risk = relicRisk(id, null);
  return `<div class="tt-h"><b>${x.icon} ${esc(relicName(id))}</b> <span class="muted small">${groupLabel(x.group)}</span></div><div class="desc">${esc(relicDesc(id))}</div>${
    risk ? `<div class="tt-risk">⚠ ${esc(risk.band)}</div>` : ''
  }<div class="muted small">${L('แตะเพื่อเปิดในคู่มือ', 'Tap to open it in the codex')}</div>`;
}

/** one relic offer on a relic day */
export function relicCardHTML(id: string, i: number, skills: SkillInstance[]) {
  const x = RELICS_BY_ID[id];
  if (!x) return '';
  const fits = relicFitsBuild(id, skills);
  const risk = relicRisk(id, skills);
  const also = (x.also ?? []).map((l) => GROUP_ICON[l]).join(' ');
  const hint = !risk ? relicHint(id, th()) : '';
  return `<div class="card offer relic-card rl-card${fits ? ' rl-fits' : ''}${risk ? ' rl-risky' : ''}" style="--ring:${GROUP_RING[x.group]}">
    ${fits ? `<span class="rl-ribbon">✓ ${L('เข้ากับ build คุณ', 'Fits your build')}</span>` : ''}
    ${relicMedal(id, 'lg')}
    <div class="rl-body">
      <div class="rl-name">${esc(relicName(id))}</div>
      <div class="rl-group"><span class="rl-gchip">${groupLabel(x.group)}</span>${also ? `<span class="rl-also" title="${esc(L('เข้ากับสายนี้ด้วย', 'also suits'))}">+ ${also}</span>` : ''}<button class="cx-q-link" data-codex="relic:${id}" aria-label="${esc(L('เปิดในคู่มือ', 'Open in the codex'))}">?</button></div>
    </div>
    <p class="rl-desc">${esc(relicDesc(id))}</p>
    ${hint ? `<p class="rl-hint">${esc(hint)}</p>` : ''}
    ${risk ? `<div class="rl-risk${risk.ok === false ? ' bad' : risk.ok ? ' good' : ''}" role="note"><b>⚠ ${esc(risk.band)}</b><span>${risk.ok === null ? '' : risk.ok ? '✓ ' : '✗ '}${esc(risk.now)}</span></div>` : ''}
    <button class="buy primary rl-take" data-a="relic" data-i="${i}">${L('เลือกชิ้นนี้', 'Take it')}</button>
  </div>`;
}

/**
 * The run's relic slots: owned relics as medallions (hover / tap = details, tap = codex), then the empty slots with the
 * day each one comes. `relic-chip` stays the class of an owned relic.
 */
export function relicTrayHTML(ids: string[] = [], day: number, compact = false) {
  const owned = ids.map(
    (id) => `<button class="relic-chip rl-slot" data-codex="relic:${id}" data-ttxt="${esc(relicTip(id))}" aria-label="${esc(relicName(id))}">${relicMedal(id, 'sm')}${compact ? '' : `<span class="rl-sn">${esc(relicName(id))}</span>`}</button>`,
  );
  const future = RELIC_DAYS.filter((d) => d > day || (d === day && owned.length < RELIC_DAYS.filter((x) => x <= day).length)).slice(0, MAX_RELICS - ids.length);
  const empty = future.map((d) => `<span class="rl-slot rl-empty" title="${esc(L(`ของวิเศษชิ้นถัดไป: วันที่ ${d}`, `Next relic: day ${d}`))}">${artOr(DEPTH_FILES.relicSlotEmpty, `<span class="rlm rlm-sm rlm-void" aria-hidden="true">?</span>`)}${compact ? '' : `<span class="rl-sn">${L(`วัน ${d}`, `Day ${d}`)}</span>`}</span>`);
  const missed = MAX_RELICS - ids.length - empty.length;
  return `<div class="relic-tray${compact ? ' compact' : ''}" role="group" aria-label="${esc(L('ของวิเศษประจำรอบ', 'Run relics'))}">
    <span class="rt-h">${L('ของวิเศษ', 'Relics')} <b>${ids.length}/${MAX_RELICS}</b></span>${owned.join('')}${empty.join('')}${missed > 0 ? `<span class="rl-slot rl-missed" title="${esc(L('ข้ามไปแล้ว', 'skipped'))}">–</span>`.repeat(missed) : ''}
  </div>`;
}

// ---------- stars ----------
/** ★ gives (+n% on every number, the ★★★ echo), live from tuning */
export function starGain(n: number) {
  const p = pc(starPower(n) - 1);
  return n >= 3
    ? L(`ตัวเลขทุกตัว +${p}% · ทุกครั้งที่ใช้ ซ้ำอีกครั้ง ${pc(T['star.echo'])}% ของดาเมจ`, `every number +${p}% · every cast echoes ${pc(T['star.echo'])}% of its damage`)
    : L(`ตัวเลขทุกตัว +${p}%`, `every number +${p}%`);
}
/** what ONE more star adds, as a short line */
export function starStep(n: number) {
  return n >= 3
    ? L(`+${pc(T['star.pow3'])}% และใช้ซ้ำ ${pc(T['star.echo'])}% ทุกครั้ง`, `+${pc(T['star.pow3'])}% and a ${pc(T['star.echo'])}% echo on every cast`)
    : L(`ตัวเลขทุกตัว +${pc(T['star.pow'])}%`, `every number +${pc(T['star.pow'])}%`);
}
/** ★ pips: n of 3 lit; gold at ★★★ (empty string at 0 unless `always`) */
export function starPips(n = 0, always = false) {
  if (!n && !always) return '';
  const pip = (on: boolean) => artOr(on ? DEPTH_FILES.starPip : DEPTH_FILES.starPipEmpty, `<i class="sp${on ? ' on' : ''}"></i>`, 'sp-img');
  return `<span class="star-pips${n >= R.STAR_MAX ? ' max' : ''}" data-codex="stars" data-ttxt="${esc(`<div class="tt-h"><b>${'★'.repeat(Math.max(1, n))} ${n}/${R.STAR_MAX}</b></div><div class="desc">${esc(n ? starGain(n) : L('ยังไม่มีดาว', 'no stars yet'))}</div><div class="muted small">${esc(L(`ซื้อการ์ดซ้ำของ skill Lv3 ตั้งแต่วันที่ ${R.STAR_DAY}`, `Buy a Lv3 skill's duplicate card from day ${R.STAR_DAY}`))}</div>`)}" aria-label="${n} ${L('ดาว', 'stars')}">${Array.from({ length: R.STAR_MAX }, (_, j) => pip(j < n)).join('')}</span>`;
}

// ---------- marks ----------
const MARK_GLYPH: Record<Mark, string> = { burn: '✹', echo: '↻', quick: '»', steadfast: '⛨' };
const markName = (m: Mark) => R.MARK_INFO[m].name;
/** a mark's glyph (or its painted coin) */
export const markGlyph = (m: Mark) => artOr(DEPTH_FILES.mark(m), MARK_GLYPH[m]);
/** a mark on a skill: its glyph coin + name, or the hidden "?" until the next fight reveals it */
export function markBadge(k: Pick<SkillInstance, 'mark' | 'markHidden'>, withName = true) {
  if (k.mark) {
    const m = k.mark;
    const tip = `<div class="tt-h"><b>${MARK_GLYPH[m]} ${L('ตรา', 'Mark: ')}${esc(markName(m))}</b></div><div class="desc">${esc(R.MARK_INFO[m].desc)}</div>`;
    return `<span class="mk mk-${m}" data-codex="mark:${m}" data-ttxt="${esc(tip)}"><i class="mk-c">${artOr(DEPTH_FILES.mark(m), MARK_GLYPH[m])}</i>${withName ? `<span class="mk-n">${esc(markName(m))}</span>` : ''}</span>`;
  }
  if (k.markHidden) {
    const tip = `<div class="tt-h"><b>? ${L('ตราลึกลับ', 'Hidden mark')}</b></div><div class="desc">${esc(L('ตรานี้ทำงานแล้ว แต่ชนิดจะเปิดหลังสู้ครั้งถัดไป', 'It already works; its kind is revealed after your next fight'))}</div>`;
    return `<span class="mk mk-hidden" data-codex="marks" data-ttxt="${esc(tip)}"><i class="mk-c">${artOr(DEPTH_FILES.mark('hidden'), '?')}</i>${withName ? `<span class="mk-n">${L('ลึกลับ', 'hidden')}</span>` : ''}</span>`;
  }
  return '';
}
/** "ตรา 2/3" with a coin per mark slot */
export function markCountHTML(skills: Pick<SkillInstance, 'mark' | 'markHidden'>[], wishMarks = 0) {
  const marked = skills.filter((k) => k.mark || k.markHidden);
  if (!marked.length) return '';
  const coins = Array.from({ length: MARK_MAX }, (_, j) => {
    const k = marked[j];
    return k ? `<i class="mk-dot ${k.mark ? `mk-${k.mark}` : 'mk-hidden'}">${k.mark ? markGlyph(k.mark) : artOr(DEPTH_FILES.mark('hidden'), '?')}</i>` : '<i class="mk-dot off"></i>';
  }).join('');
  const tip = `<div class="tt-h"><b>${L('ตรา', 'Marks')} ${marked.length}/${MARK_MAX}</b></div><div class="desc">${esc(
    L(`มีได้สูงสุด ${MARK_MAX} อัน: จากโอกาสสุดท้าย 1 และพรจันทร์ ${R.WISH_MARKS_MAX} (ใช้พรไปแล้ว ${wishMarks})`, `At most ${MARK_MAX}: 1 from the last chance and ${R.WISH_MARKS_MAX} from moon wishes (${wishMarks} wish marks used)`),
  )}</div>`;
  return `<span class="mk-count" data-codex="marks" data-ttxt="${esc(tip)}">${L('ตรา', 'Marks')} ${coins}<b>${marked.length}/${MARK_MAX}</b></span>`;
}

// ---------- ultimate ----------
/** the ult rule as two rows of pips: Lv1 = line pieces, Lv2 = all pieces + Lv3 pieces */
export function ultChecklistHTML(hero: string, skills: SkillInstance[]) {
  const h = HEROES_BY_ID[hero];
  if (!h) return '';
  const b = { hero, skills };
  const p = ultPieces(b);
  const l3 = ultLv3(b);
  const lv = ultLevel(b);
  // line pieces are moons; the Lv3 ones Lv2 needs are stars (painted when the pack is in, CSS dots otherwise)
  const pip = (on: boolean, cls = '') =>
    cls === ' l3'
      ? on ? artOr(DEPTH_FILES.starPip, '<i class="up on l3"></i>', 'up-img l3') : '<i class="up l3"></i>'
      : artOr(on ? DEPTH_FILES.ultPipOn : DEPTH_FILES.ultPipOff, `<i class="up${on ? ' on' : ''}"></i>`, `up-img${on ? '' : ' off'}`);
  const row = (n: number, have: number, cls = '') => Array.from({ length: n }, (_, j) => pip(j < have, cls)).join('');
  const tip = `<div class="tt-h"><b>★ ${esc(h.ult.name)}</b></div><div class="desc">${esc(L(ultProgressText(b, true), ultProgressText(b, false)))}</div><div class="muted small">${esc(h.ult.trigger)} → ${esc(h.ult.effect)}</div>`;
  // playtest 2026-11-23 ("how does each hero unlock its ult?"): the Lv1 slots show the line skills you own, and one
  // line says what to collect (locked) or when it fires (unlocked)
  const mine = skills.filter((k) => inLine(hero, k.id)).slice(0, ULT_PIECES[0]);
  const slots = Array.from({ length: ULT_PIECES[0] }, (_, j) =>
    mine[j] ? `<img class="uc-sk" src="${skillIcon(mine[j].id)}" alt="">` : `<i class="uc-empty">${LINE_ICON[h.line]}</i>`).join('');
  const lv1Trig = h.ult.trigger.split(' · Lv2')[0];
  const how = lv >= 1
    ? L(`ใช้เองตอนสู้เมื่อ: ${lv1Trig}`, `Fires by itself when: ${lv1Trig}`)
    : L(`ซื้อ skill ${LINE_ICON[h.line]} สาย${LINE_NAME[h.line]} อีก ${ULT_PIECES[0] - Math.min(p, ULT_PIECES[0])} ใบ → ปลดล็อก`, `Buy ${ULT_PIECES[0] - Math.min(p, ULT_PIECES[0])} more ${LINE_ICON[h.line]} ${LINE_NAME[h.line]} skill(s) → unlocks`);
  return `<div class="ult-chk${lv ? ` lv${lv}` : ''}" data-ttxt="${esc(tip)}" data-codex="hero:${hero}" aria-label="${esc(L(ultProgressText(b, true), ultProgressText(b, false)))}">
    <span class="uc-name">★ ${esc(h.ult.name)}</span>
    <span class="uc-how">${esc(how)}</span>
    <span class="uc-step${lv >= 1 ? ' done' : ''}"><b>Lv1</b><span class="uc-slots">${slots}</span>${lv >= 1 ? '<em>✓</em>' : `<small>${Math.min(p, ULT_PIECES[0])}/${ULT_PIECES[0]}</small>`}</span>
    <span class="uc-step${lv >= 2 ? ' done' : ''}"><b>Lv2</b>${row(ULT_PIECES[1], p)}<span class="uc-sep">+</span>${row(ULT_LV2_LV3, l3, ' l3')}${lv >= 2 ? '<em>✓</em>' : `<small>${Math.min(p, ULT_PIECES[1])}/${ULT_PIECES[1]} · Lv3 ${Math.min(l3, ULT_LV2_LV3)}/${ULT_LV2_LV3}</small>`}</span>
  </div>`;
}

/**
 * Does this shop offer move ult Lv2 forward? A missing line piece (while under 4), or a line upgrade to Lv3 while
 * under the Lv3 count. Returns the short tag text, or ''.
 */
export function ultLv2Step(hero: string, skills: SkillInstance[], o: { id: string; v: string; star?: number }) {
  if (o.star || !inLine(hero, o.id)) return '';
  const b = { hero, skills };
  if (ultLevel(b) >= 2) return '';
  if (o.v === '' && ultPieces(b) < ULT_PIECES[1] && ultPieces(b) >= ULT_PIECES[0] - 1) return L(`ชิ้นที่ ${ultPieces(b) + 1}/${ULT_PIECES[1]} → ท่าไม้ตาย Lv2`, `piece ${ultPieces(b) + 1}/${ULT_PIECES[1]} → ult Lv2`);
  if (o.v !== '' && lvOf(o.v) >= 3 && ultLv3(b) < ULT_LV2_LV3) return L(`Lv3 ตัวที่ ${ultLv3(b) + 1}/${ULT_LV2_LV3} → ท่าไม้ตาย Lv2`, `Lv3 #${ultLv3(b) + 1}/${ULT_LV2_LV3} → ult Lv2`);
  return '';
}

// ---------- rarity ----------
export const rarityName = (r: 'rare' | 'epic' | 'common') => (r === 'epic' ? L('◆ มหากาพย์', '◆ Epic') : r === 'rare' ? L('◇ หายาก', '◇ Rare') : L('ธรรมดา', 'Common'));

// ---------- build card (run end) ----------
export interface BuildCardData {
  hero: string;
  heroArt: string;
  player: string;
  won: boolean;
  wins: number;
  losses: number;
  winTarget: number;
  skills: SkillInstance[];
  relics: string[];
  log: { day: number; won: boolean; draw?: boolean }[];
  rating: number;
}
/** The collector's summary of a finished run: hero, skills with branch / rarity / ★ / mark, relics and the W/L log. */
export function buildCardHTML(d: BuildCardData) {
  const h = HEROES_BY_ID[d.hero];
  const lv = ultLevel({ hero: d.hero, skills: d.skills });
  const tiles = d.skills
    .map((k) => {
      const r = rarityOf(k.id, k.v);
      const st = k.star ?? 0;
      const branch = k.v ? SKILLS[k.id].tree[k.v[0] as 'a' | 'b'].style ?? '' : '';
      return `<li class="bc-sk rar-${r}${st >= R.STAR_MAX ? ' st3' : ''}">${st >= R.STAR_MAX ? artOr(DEPTH_FILES.star3Burst, '', 'bc-burst') : ''}
        <img class="skill-icon" src="${skillIcon(k.id)}" alt="">
        <span class="bc-nm">${esc(nodeOf(k).name)}</span>
        <span class="bc-meta">Lv${lvOf(k.v)}${branch ? ` · ${esc(branch)}` : ''}</span>
        <span class="bc-tags">${r !== 'common' ? `<span class="bc-rar">${rarityName(r)}</span>` : ''}${starPips(st)}${markBadge(k, false)}</span>
      </li>`;
    })
    .join('');
  const relics = d.relics.length
    ? d.relics.map((id) => `<span class="bc-relic">${relicMedal(id, 'sm')}<span>${esc(relicName(id))}</span></span>`).join('')
    : `<span class="muted small">${L('ไม่มีของวิเศษ', 'No relics')}</span>`;
  const log = d.log.map((x) => `<i class="bc-day ${x.won ? 'w' : x.draw ? 'd' : 'l'}" title="${L('วัน', 'Day')} ${x.day}: ${x.won ? L('ชนะ', 'won') : x.draw ? L('เสมอ', 'draw') : L('แพ้', 'lost')}">${x.won ? '✓' : x.draw ? '=' : '✗'}</i>`).join('');
  const stars = d.skills.reduce((n, k) => n + (k.star ?? 0), 0);
  const epics = d.skills.filter((k) => rarityOf(k.id, k.v) === 'epic').length;
  const marks = d.skills.filter((k) => k.mark || k.markHidden).length;
  return `<figure class="bc-card${d.won ? ' won' : ''}" aria-label="${esc(L('การ์ด build', 'Build card'))}">
    <div class="bc-top"><span class="bc-brand">Mochi Moon · ${L('การ์ด build', 'Build card')}</span><span class="bc-rec"><b>${d.wins}</b>–${d.losses}${d.won ? ' 👑' : ''}</span></div>
    <div class="bc-hero">${d.heroArt}<div><b class="bc-hn">${esc(h?.name ?? d.hero)}</b><span class="bc-hl">${h ? `${esc(LINE_NAME[h.line])} · ★ ${esc(h.ult.name)} ${lv ? `Lv${lv}` : L('ล็อก', 'locked')}` : ''}</span>
      <span class="bc-sum">${L(`★ ${stars} · ◆ ${epics} · ตรา ${marks}`, `★ ${stars} · ◆ ${epics} · marks ${marks}`)}</span><span class="bc-pl">${esc(d.player)} · ${L('คะแนน', 'rating')} ${d.rating}</span></div></div>
    <ol class="bc-skills">${tiles}</ol>
    <div class="bc-relics">${relics}</div>
    <div class="bc-log" aria-label="${esc(L('ผลแต่ละวัน', 'Each day'))}">${log}</div>
  </figure>`;
}
