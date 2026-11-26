import { randomAiBuild } from '../sim/bot';
import { SIM_VERSION, cdTicks, simulate, starPower } from '../sim/combat';
import { HEROES, HEROES_BY_ID, inLine, lineAffinity, ultGain, ultLevel, ultProgressText, ultRuleText } from '../sim/heroes';
import { explain, reflectEvents, skillDamage, type Explanation } from '../sim/explain';
import { explainView } from './explainView';
import { fatigueStart } from '../sim/combat';
import * as M from './views/meta';
import * as P from './views/pages';
import * as RC from './views/records';
import * as RF from './runEndFx';
import { cardBlob, saveCard, shareCard, type CardData } from './shareCard';
import { hashSeed } from '../sim/rng';
import * as R from './runChain';
import * as C from './chain';
import { mountChainUi, setChainHandlers } from './chainUi';
import { GROUP_ICON, RELICS_BY_ID, relicFitsBuild, relicHint, relicText } from '../sim/relics';
import { T } from '../sim/tuning';
import { HASTE_BONUS, POWER_BONUS, activeBonuses, bonusTotals, bonusValue, matches } from '../sim/links';
import { KEYWORDS, LINE_ICON, LINE_NAME, ROLE_NAME, SKILLS, SKILL_ROLE, TIME_CAP_S, worthOf, chipsOf, lineLabel, lvOf, nextVariants, nodeOf, epicAfter, rarityOf, upgradeDiff, type Keyword, type Variant } from '../sim/skills';
import type { BlockStat, Bonus, Build, CombatEvent, CombatResult, Mark, SkillInstance } from '../sim/types';
import { renderChibi, rollLook } from './chibi';
import { api, type FightResponse, type ReplayRecord } from './api';
import { SPEED_KEY, type CombatScene } from './combatScene';
import { BUILDINGS, BUILDING_BY_ID } from './townData';
import type { TownScene } from './townScene';
import { dragging, initDrag } from './shop/drag';
import { resetHints, showHints } from './shop/hints';
import { TIMELINE_SECS, timelineHTML } from './shop/timeline';
import { bindChainResize, bonusShort, chainDirs, chainPanelHTML, defaultSlot, dragPreview, gapHTML, offerPairsHTML, partnerChip, resetChains, syncChains, targetWords, type Dir } from './shop/chains';
import { COIN as COIN_I, coinFly, coinHTML, goldPillHTML, hudAfterRender, hudHTML, popRow } from './shop/hud';
import { initShopDrag, shopDragging } from './shop/shopdrag';
import { clearPick, goToPick, picked, setPick } from './shop/pick';
import { heroVoice, music, setVoiceHero, sfx, voice } from './audio';
import { IMAGES, skillIcon, lineIcon } from './assets';
import { L, getLang } from '../i18n';
import { MARKS_EN } from './i18n_en';
import { chipText, displayName, onLang, runErr, withLang } from './lang';
import { setView } from './layout';
import { bonusRows, detailTipHTML, showingDetail, simpleDeltaHTML, simpleSkillHTML, simpleTipHTML } from './infoMode';
import * as D from './depthUI';
import { simpleText } from './skillText';
import { skillBlurb } from './skillBlurb';
import { askAfterRun } from './feedback';
import { icon } from './icons';
import { track } from './track';
import { saveBuildCard, type BuildCardImage } from './shareCard';

export interface Stage {
  town: TownScene;
  combat: CombatScene;
  show(key: 'town' | 'combat'): void;
}

type View =
  | 'town' | 'title' | 'shop' | 'relic' | 'fighting' | 'result' | 'lastchance' | 'mark' | 'over' | 'replay' | 'replayDone'
  | 'profile' | 'leaderboard';

// ---------- C2: fight names, end-of-run reward, profile / leaderboard / scouting state ----------
/** damage events of the fight on screen that are thorns reflections (the thorns skill also uses src 'thorns') */
let logRefl = new Set<CombatEvent>();
/** run whose reward is being / has been asked for this session */
const claimAsked = new Set<string>();
const pendingClaim = new Set<string>();
let profileData: M.Profile | null = null;
let profileLoading = false;
let lbPeriod: M.Period = 'season';
let lbData: M.Leaderboard | null = null;
let lbLoading = false;
/** "you" in the current language (fight names, explanations) */
const youName = () => L('คุณ', 'You');
/** Opponent label: real name, or AI + tier. Never "คุณ" (that is you). Server names are mapped to the current language. */
function oppLabel(o: { name: string; ai: boolean; tier?: unknown }) {
  const nm = o.name && o.name !== 'คุณ' ? displayName(o.name) : L('คู่ต่อสู้', 'Opponent');
  if (!o.ai) return nm;
  const tier = M.tierLabel(o.tier);
  const base = /^AI\b/.test(nm) ? nm : `${nm} · AI`;
  return `${base}${tier ? ` (${tier})` : ''}`;
}

const $panel = document.getElementById('panel') as HTMLElement;
let scene!: CombatScene;
let stage!: Stage;
let selected: string | null = 'arena';
let run: R.RunState | null = null;
let view: View = 'title';
/** seed of the next run: it also decides which heroes are offered. Kept until a run starts, so leaving the screen does not re-roll. */
let nextSeed: number | null = null;
/** on-chain mode (the default; ?chain=0 = off): connection state; the hero choices of a run being started (from the chain's VRF) */
let chainConn: 'off' | 'connecting' | 'ready' | 'error' = C.chainOn() ? 'connecting' : 'off';
let chainChoices: string[] | null = null;
/** their day-1 shops (published by the program with the choices) */
let chainPreview: Record<string, (R.Offer | null)[]> | null = null;
/** the coming run's cosmetic seed (chain): the offered heroes are shown with the look the run will have */
let chainLook = 0;
let chainStarting = false;
let last: FightResponse | null = null;
let lastDay = 0;
let lastDamage = 0;
/** skills the last lost fight's explanation advised: the next shop marks their cards (💡) */
let tipIds: string[] = [];
/** the day the "you can still buy something" nudge was shown (simple mode: once a day, the next press fights) */
let goldNudgeDay = 0;
/** the build used in the last fight (stats are indexed by its skills) */
let lastBuild: Build | null = null;
let replayResult: CombatResult | null = null;
let replay: ReplayRecord | null = null;
let busy = false;
// ---------- audio cues (music per screen, one-shot voice/sfx when a screen is entered) ----------
let shownView: View | null = null;
/** the last fight was close (winner at ≤10% HP): the result screen says so out loud */
let lastClose = false;
let lastShopDay = 0;
let welcomed = false;
let heroPrompted = false;
function onEnterView(v: View) {
  if (v === 'town' || v === 'profile' || v === 'leaderboard') {
    music('town');
    if (!welcomed) {
      welcomed = true;
      voice('welcome');
    }
  } else if (v === 'title') {
    music('town');
    if (!runActive() && !heroPrompted) {
      heroPrompted = true;
      voice('choose_hero');
    }
  } else if (v === 'shop') {
    music('shop');
    if (run && run.day !== lastShopDay) {
      voice(lastShopDay ? 'new_day' : 'shop_open');
      lastShopDay = run.day;
    }
  } else if (v === 'result') {
    if (last?.won) {
      music('victory');
      setTimeout(() => sfx('stardust'), 650); // the prize strip lands
    }
    if (lastClose) voice('close_fight');
  } else if (v === 'lastchance') {
    sfx('last_chance');
    voice('last_chance');
  } else if (v === 'over') {
    if (run?.phase === 'won') {
      music('victory');
      sfx('champion');
      voice(run.losses === 0 ? 'perfect' : 'champion');
    } else music('town');
  }
}
let toast = '';
let names: [string, string] = ['', ''];
/** recomputes `names` in the current language (set when a fight starts; used after a language change) */
let namesFn: () => [string, string] = () => names;
/** untranslated names of the fight on screen (they seed the AI's look, which must not change with the language) */
let seedNames: [string, string] = ['', ''];
let confirmConcede = false;
/** skill tree window: which skill, the variant you own (null = not owned) and the variant the shop offers */
let treeOpen: { id: string; cur: string | null; offer: string | null } | null = null;

// ---------- storage (per-browser convenience only; may be unavailable) ----------
const RUN_KEY = 'arena.run.v7';
const NAME_KEY = 'arena.name';
function store(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* private mode etc. */
  }
}
function fetchStore(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
const saveRun = () => store(RUN_KEY, run ? JSON.stringify(run) : null);
function loadRun(): R.RunState | null {
  try {
    const r = JSON.parse(fetchStore(RUN_KEY) ?? 'null') as R.RunState | null;
    return r && r.v === R.RUN_VERSION ? r : null;
  } catch {
    return null;
  }
}
/** the name sent to the server: "ผู้เล่น" (empty) makes the server pick a unique Mochi-1234 name */
const playerName = () => (fetchStore(NAME_KEY) || 'ผู้เล่น').slice(0, 24);

// ---------- helpers ----------
/** "★ ท่าไม้ตาย เงาจันทร์: when · what" for hero cards */
function ultHTML(h: (typeof HEROES)[number]) {
  return `<b>★ ${L('ท่าไม้ตาย', 'Ultimate')} ${h.ult.name}</b> (${L(`${ultRuleText(true)} · skill สาย${LINE_NAME[h.line]}แรงขึ้น ${Math.round((lineAffinity(h.id) - 1) * 100)}% (ถนัดสาย)`, `${ultRuleText(false)} · ${LINE_NAME[h.line]} skills are ${Math.round((lineAffinity(h.id) - 1) * 100)}% stronger (line mastery)`)}): ${h.ult.trigger} → ${h.ult.effect}`;
}
/** rarity of an upgrade branch (rare = any Lv3, epic = the big ones): a gold / purple tag */
function rarityTag(k: { id: string; v: string } | null) {
  const r = k ? rarityOf(k.id, k.v) : 'common';
  if (r === 'common') {
    // a Lv2 upgrade whose next branch is epic says so (the random branch rule stays: Lv3 picks one of two)
    const e = k ? epicAfter(k.id, k.v) : null;
    return e ? ` <span class="mark rarity-path" data-codex="rarity" title="${esc(L('อัป Lv3 จากทางนี้ เลือกทางมหากาพย์ได้', 'the Lv3 after this branch can be the epic one'))}">${L(`◆ ทางสู่ ${SKILLS[k!.id].tree[e].name}`, `◆ leads to ${SKILLS[k!.id].tree[e].name}`)}</span>` : '';
  }
  const what = r === 'epic' ? L('ทาง Lv3 ที่เปลี่ยนวิธีเล่นของ skill', 'a Lv3 branch that changes how the skill plays') : L('ทาง Lv3 ที่ตัวเลขเด่น', 'a Lv3 branch with standout numbers');
  return ` <span class="mark rarity-${r}" data-codex="rarity" data-ttxt="${esc(`<div class="tt-h"><b>${D.rarityName(r)}</b></div><div class="desc">${what}</div>`)}">${r === 'epic' ? L('◆ มหากาพย์', '◆ EPIC') : L('◇ หายาก', '◇ RARE')}</span>`;
}
/** "★★" after a Lv3 skill's name (sim v17) */
const starTag = (n = 0) => D.starPips(n);
/** what one more star gives, as a diff line */
const starDiff = (n: number) =>
  `<div class="sc-gain">${L(`ดาวที่ ${n}: `, `Star ${n}: `)}<b>${esc(D.starStep(n))}</b><br><small>${L('รวมแล้ว', 'in total')}: ${esc(D.starGain(n))}</small></div>`;
/** relics of the run as small chips with their text in the tooltip */
function relicsHTML(ids: string[] = [], day = run?.day ?? 1) {
  return D.relicTrayHTML(ids, day);
}
/** upgrade card: before → after of each headline number; a number that gets worse is marked ▼ in red */
function upDiffHTML(owned: SkillInstance, o: R.Offer) {
  const diff = upgradeDiff(nodeOf(owned), nodeOf({ id: o.id, v: o.v }), getLang() !== 'en');
  if (!diff.length) return '';
  return `<div class="up-diff">${diff.map((d) => `<span class="${d.worse ? 'worse' : 'better'}">${esc(d.text)}${d.worse ? '▼' : ''}</span>`).join(' · ')}</div>`;
}
/** selling list skill i lowers the ultimate: "★ Lv2 → Lv1" (empty when it doesn't) */
function sellDrop(r: R.RunState, i: number) {
  const b = R.toBuild(r);
  const now = ultLevel(b);
  const after = ultLevel({ hero: b.hero, skills: r.skills.filter((_, j) => j !== i).slice(0, R.slotsOf(r)) });
  if (after >= now) return '';
  return L(`★ ท่าไม้ตาย Lv${now} → ${after ? `Lv${after}` : 'ล็อก'}`, `★ ult Lv${now} → ${after ? `Lv${after}` : 'locked'}`);
}
/** shop card tag: "★ +1 ชิ้น" when the offer is an ult piece ("ปลด Lv1!" when it unlocks a level), "ถนัด" for other in-line cards */
function ultTagHTML(r: R.RunState, o: R.Offer) {
  if (!inLine(r.hero, o.id)) return '';
  const b = R.toBuild(r);
  const lv2 = D.ultLv2Step(r.hero, b.skills, o);
  if (lv2 && ultLevel(b) >= 1) return `<span class="mark ult-lv2" data-codex="hero:${r.hero}" title="${esc(L(ultRuleText(true), ultRuleText(false)))}">${esc(lv2)}</span>`;
  const g = ultGain(b, o);
  const aff = `${L('ถนัดสาย', 'line mastery')} +${Math.round((lineAffinity(r.hero) - 1) * 100)}%`;
  if (!g.pieces) return `<span class="mark ult-aff" title="${esc(aff)}">${L('ถนัด', 'mastery')}</span>`;
  const up = g.lv > ultLevel(b);
  // a new line skill = +1 piece; an upgrade to Lv3 = one of the 2 Lv3 that Lv2 needs
  const what = o.v ? L('★ Lv3 สู่ท่าไม้ตาย Lv2', '★ Lv3 toward ult Lv2') : L('★ ท่าไม้ตาย +1', '★ ult +1');
  const txt = up ? `${what} · ${L(`ปลด Lv${g.lv}!`, `ult Lv${g.lv}!`)}` : what;
  return `<span class="mark ult-piece${up ? ' ult-up' : ''}" title="${esc(`${L('ชิ้นท่าไม้ตาย', 'ultimate piece')} · ${aff}`)}">${txt}</span>`;
}
/** a hero's own unique card already wears the gold ★ tag: a second "ult +1" chip only pushes the Buy button off a sideways phone, so keep it only when it unlocks a level */
function uniqUltTag(unique: boolean | string | undefined, tag: string) {
  return unique && !tag.includes('ult-up') ? '' : tag;
}
/** shop: "★ เงาจันทร์ 2/3" ult piece counter for the run's build */
function ultProgressHTML(r: R.RunState) {
  return D.ultChecklistHTML(r.hero, R.toBuild(r).skills);
}
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
const randSeed = () => crypto.getRandomValues(new Uint32Array(1))[0];

/** Icon + number chips for a skill variant; each chip explains its keyword on hover / tap. haste = connect-bonus cooldown cut */
function chipsHTML(k: Pick<SkillInstance, 'id' | 'v' | 'mark'>, haste = 0) {
  return `<span class="chips-row info-det">${chipsOf(nodeOf(k), cdTicks(k, haste))
    .map((c) => `<span class="kw kw-${c.kw}" data-kw="${c.kw}">${esc(chipText(c.text))}</span>`)
    .join('')}</span>${simpleSkillHTML(k, haste)}`;
}

/** Name, level, mark, chips and connect bonuses of a skill (one list row). on = its active bonuses. */
function skillLine(k: Pick<SkillInstance, 'id' | 'v' | 'mark' | 'markHidden' | 'bonus' | 'star'>, on: Set<number> | null = null, haste = 0, dir?: (bi: number) => Dir) {
  const mark = D.markBadge(k) + starTag(k.star);
  const lv = lvOf(k.v);
  const pips = `<i class="lvpips" aria-hidden="true">${Array.from({ length: R.MAX_LV }, (_, j) => `<i class="${j < lv ? 'on' : ''}"></i>`).join('')}</i>`;
  return `<span class="nm">${nodeOf(k).name} <small>Lv${lv}</small>${pips}${mark}</span>${chipsHTML(k, haste)}${bonusChips(k.bonus ?? [], lvOf(k.v), on, null, dir)}`;
}

// ---------- connect bonuses ----------
const BONUS_ICON: Record<Bonus['e'], string> = { dmg: '⚔', shield: '⛨', haste: '»', power: '✦', trigger: '⚡' };
const targetName = (t: string) =>
  t.startsWith('line:') ? L(`skill สาย${LINE_NAME[t.slice(5) as 'hit']}`, `a ${LINE_NAME[t.slice(5) as 'hit']} line skill`) : SKILLS[t]?.name ?? t;
function bonusEffect(b: Bonus, lv: number) {
  const v = bonusValue(b.e, lv);
  return {
    dmg: L(`skill นี้ทำดาเมจ +${v} ทุกครั้งที่ตี`, `this skill deals +${v} damage on every hit`),
    shield: L(`ทุกครั้งที่ skill นี้ทำงาน คุณได้โล่ +${v}`, `each time this skill works, you gain +${v} shield`),
    haste: L(`คูลดาวน์ของ skill นี้สั้นลง ${Math.round(HASTE_BONUS * 100)}%`, `this skill's cooldown is ${Math.round(HASTE_BONUS * 100)}% shorter`),
    power: L(`ตัวเลขทุกอย่างของ skill นี้แรงขึ้น ${Math.round(POWER_BONUS * 100)}%`, `every number of this skill is ${Math.round(POWER_BONUS * 100)}% stronger`),
    trigger: L(
      'เมื่อ skill นี้ทำงาน ตัวที่ติดกันนั้นทำงานทันทีด้วย (คูลดาวน์ของตัวนั้นไม่รีเซ็ต)',
      'when this skill works, that neighbour works right away too (its cooldown does not reset)',
    ),
  }[b.e];
}
const bonusText = (b: Bonus, lv: number) =>
  L(`ติดกับ <b>${targetName(b.t)}</b> (ช่องบนหรือล่าง): ${bonusEffect(b, lv)}`, `Next to <b>${targetName(b.t)}</b> (slot above or below): ${bonusEffect(b, lv)}`);
/**
 * Small chips for connect bonuses. on = active ones (null = not in the list yet).
 * can = for shop offers: bonuses an owned skill could switch on.
 */
function bonusChips(bonus: Bonus[], lv: number, on: Set<number> | null, can: Set<number> | null = null, dir: (bi: number) => Dir = () => 'any') {
  if (!bonus.length) return '';
  const states: ('on' | 'can' | 'off')[] = [];
  const tips: string[] = [];
  const chips = bonus.map((b, bi) => {
      const st = on?.has(bi) ? 'on' : can?.has(bi) ? 'can' : 'off';
      const tip = `<div class="tt-h"><b>${L('🔗 โบนัสเชื่อมต่อ', '🔗 Connect bonus')}</b></div><div class="desc">${bonusText(b, lv)}</div>${
        st === 'on'
          ? `<div class="ok">${L('✓ ทำงานอยู่', '✓ Active')}</div>`
          : st === 'can'
            ? `<div class="muted small">${L('คุณมี skill ที่เปิดโบนัสนี้ได้ วางให้ติดกัน', 'You own a skill that switches this on: put them next to each other')}</div>`
            : `<div class="muted small">${L('ยังไม่ทำงาน: วาง skill ที่ตรงเงื่อนไขไว้ช่องบนหรือล่าง', 'Not active: put a matching skill in the slot above or below')}</div>`
      }`;
      states.push(st);
      tips.push(tip);
      return partnerChip(b, lv, st, st === 'on' ? dir(bi) : 'any', tip);
    });
  return bonusRows(chips, bonus, lv, states, tips);
}

/** tooltip of an offer's own connect bonus (shop card "pairs with" chips) */
const offerTip = (b: Bonus, owned: boolean) =>
  `<div class="tt-h"><b>${L('🔗 โบนัสเชื่อมต่อ', '🔗 Connect bonus')}</b></div><div class="desc">${bonusText(b, 1)}</div>${
    owned
      ? `<div class="ok">${L('✓ คุณมี skill ที่เปิดโบนัสนี้ได้ วางให้ติดกัน', '✓ You own a skill that switches this on: put them next to each other')}</div>`
      : `<div class="muted small">${L('ยังไม่มี skill ที่ตรงเงื่อนไข', 'You don’t own a matching skill yet')}</div>`
  }`;

// ---------- skill tree window ----------
function treeNode(id: string, v: Variant, cur: string | null, offer: string | null) {
  const n = SKILLS[id].tree[v];
  let cls = '';
  let tag = '';
  if (cur !== null) {
    if (v === cur) [cls, tag] = ['cur', L('ตอนนี้', 'now')];
    else if (cur.startsWith(v)) cls = 'past';
    else if ((nextVariants(cur) as string[]).includes(v)) [cls, tag] = ['next', L('ขั้นถัดไป', 'next')];
    else if (!v.startsWith(cur)) [cls, tag] = ['gone', L('ไปไม่ได้แล้ว', 'closed')];
  }
  if (v === offer) [cls, tag] = [`${cls} offer`, L('ในร้าน', 'in shop')];
  return `<div class="tnode ${cls}"><div class="tn-h"><b>${n.name}</b> <small>Lv${lvOf(v)}</small>${tag ? ` <span class="tn-tag">${tag}</span>` : ''}</div>${chipsHTML({ id, v })}</div>`;
}
function treeHTML() {
  if (!treeOpen) return '';
  const { id, cur, offer } = treeOpen;
  const d = SKILLS[id];
  const branch = (b: 'a' | 'b') => `<div class="tbranch">
      <div class="tb-h">${L('ทาง', 'Branch')} ${b.toUpperCase()}: ${d.tree[b].style ?? ''}</div>
      <div class="tb-row">${treeNode(id, b, cur, offer)}<span class="tarrow" aria-hidden="true">→</span>
        <div class="tleaves">${treeNode(id, `${b}1` as Variant, cur, offer)}${treeNode(id, `${b}2` as Variant, cur, offer)}</div></div>
    </div>`;
  return `<div class="modal" data-a="treeClose"><div class="modal-box line-${d.line}" role="dialog" aria-label="${L('ต้นไม้ skill', 'Skill tree')} ${d.name}">
    <div class="modal-h"><b>${L('ต้นไม้ skill', 'Skill tree')}: ${d.name}</b> <span class="muted small">${lineLabel(d.line)}${d.hero ? L(' · เฉพาะฮีโร่', ' · hero only') : ''}</span>
      <button class="small ghost" data-a="treeClose">${L('ปิด ✕', 'Close ✕')}</button></div>
    <p class="muted small">${L(
      'Lv1 → เลือกได้ 1 ใน 2 ทางที่ Lv2 → แต่ละทางแยกอีก 2 ทางที่ Lv3 · ร้านจะสุ่มเสนอ 1 ทางของขั้นถัดไปให้ ซื้อแล้วย้อนกลับไม่ได้',
      'Lv1 → pick 1 of 2 branches at Lv2 → each branch splits into 2 more at Lv3 · the shop offers 1 random step of the next level; once bought, there is no going back',
    )}</p>
    <div class="tree">
      <div class="troot">${treeNode(id, '', cur, offer)}</div>
      <div class="tbranches">${branch('a')}${branch('b')}</div>
    </div>
  </div></div>`;
}
/** ⓘ button that opens the skill tree. cur = variant you own (null = not owned), offer = variant in the shop */
const treeBtn = (id: string, cur: string | null, offer: string | null) =>
  `<button class="small ghost info" data-a="tree" data-i="${id}" data-own="${cur !== null ? 1 : 0}" data-cur="${cur ?? ''}" data-offer="${offer ?? ''}" aria-label="${L('ดูต้นไม้ skill', 'See the skill tree')}" title="${L('ดูต้นไม้ skill ทั้งหมด', 'See the whole skill tree')}">ⓘ</button>`;

/** Keyword tooltip: icon, name and meaning. */
function kwTip(kw: Keyword) {
  const x = KEYWORDS[kw];
  return `<div class="tt-h"><b>${x.icon} ${x.name}</b></div><div class="desc">${x.desc}</div>`;
}

/** Hover details for a skill: name, chips, each keyword explained, the branch it is on. */
/** popover: does this skill count toward the hero's ★ ultimate? (playtest: "I can't tell how each hero unlocks its ult") */
function ultRowHTML(id: string) {
  const r = run;
  const h = r ? HEROES_BY_ID[r.hero] : null;
  if (!r || !h) return '';
  const owned = r.skills.filter((x) => inLine(r.hero, x.id)).length;
  if (inLine(r.hero, id))
    return `<div class="sp-ult yes">★ ${L(`นับเป็นชิ้นท่าไม้ตาย <b>${esc(h.ult.name)}</b> (มีแล้ว ${owned}/3)`, `Counts toward <b>${esc(h.ult.name)}</b> (you have ${owned}/3)`)}</div>`;
  return `<div class="sp-ult no">☆ ${L(`ไม่นับท่าไม้ตาย: ${esc(h.name)} ใช้ skill สาย ${lineLabel(h.line)}`, `Doesn’t count toward the ult: ${esc(h.name)} needs ${lineLabel(h.line)} skills`)}</div>`;
}
/** popover for 💰 / ⏳ skills: the number it really has now (worth of this run's build) or at 5 / 10 / 20 s */
function scaleRowHTML(k: Pick<SkillInstance, 'id' | 'v'>) {
  const n = nodeOf(k);
  const hit = n.fx.find((e) => e.k === 'hit' && (e.perWorth || e.perSec)) as Extract<(typeof n.fx)[number], { k: 'hit' }> | undefined;
  const other = n.fx.find((e) => (e.k === 'shield' || e.k === 'heal') && (e.perWorth || e.perSec)) as { k: 'shield' | 'heal'; n: number; perWorth?: number; perSec?: number } | undefined;
  const e = hit ?? other;
  if (!e) return '';
  const word = hit ? L('ตี', 'hit') : e.k === 'shield' ? L('โล่', 'shield') : L('ฟื้น', 'heal');
  if (e.perWorth) {
    const r = run;
    const w = r ? Math.round(worthOf(r.skills) * (HEROES_BY_ID[r.hero]?.hooks.worth?.() ?? 1)) : 0;
    if (!r) return '';
    const v = Math.round(e.n + e.perWorth * w);
    return `<div class="sp-scale">💰 ${L(`มูลค่า build ตอนนี้ <b>${w}</b> → ${word} ≈ <b>${v}</b> (อัปเกรด skill ไหนก็ได้ ตัวนี้ยิ่งแรง)`, `Build worth now <b>${w}</b> → ${word} ≈ <b>${v}</b> (upgrading any skill makes this stronger)`)}</div>`;
  }
  const at = (t: number) => Math.round(e.n + (e.perSec ?? 0) * Math.min(TIME_CAP_S, t));
  return `<div class="sp-scale">⏳ ${L(`${word}ที่วินาที 3 / 10 / 20: <b>${at(3)}</b> → <b>${at(10)}</b> → <b>${at(20)}</b>`, `${word} at 3 / 10 / 20 s: <b>${at(3)}</b> → <b>${at(10)}</b> → <b>${at(20)}</b>`)}</div>`;
}
/** popover: what this skill can turn into next */
function nextRowHTML(k: Pick<SkillInstance, 'id' | 'v'>) {
  const nx = nextVariants(k.v);
  if (!nx.length) return '';
  const d = SKILLS[k.id];
  return `<div class="sp-next"><span class="muted">${L(`อัปเป็น Lv${lvOf(k.v) + 1} ได้ 2 ทาง:`, `Lv${lvOf(k.v) + 1} has 2 paths:`)}</span> ${nx
    .map((v) => `<b>${esc(d.tree[v].name)}</b>${d.tree[v].style ? ` <small class="muted">(${esc(d.tree[v].style!)})</small>` : ''}`)
    .join(` <span class="muted">${L('หรือ', 'or')}</span> `)}</div>`;
}

function tipBody(k: Pick<SkillInstance, 'id' | 'v' | 'mark' | 'bonus'>, note = '', on: Set<number> | null = null) {
  const d = SKILLS[k.id];
  const node = nodeOf(k);
  const kws = [...new Set(chipsOf(node).map((c) => c.kw))].filter((kw) => kw !== 'cd');
  const branch = k.v.length >= 1 ? d.tree[k.v[0] as 'a' | 'b'].style : '';
  const blurb = skillBlurb(k.id);
  return `<div class="sk-pop"><div class="tt-h line-${d.line} sp-head"><img class="sp-icon" src="${skillIcon(k.id)}" alt=""><div><b>${node.name}</b> <small>Lv${lvOf(k.v)}</small>${d.hero ? ` <span class="mark">${L('เฉพาะ', 'unique')}</span>` : ''}
      ${k.mark ? ` <span class="mark">${R.MARK_INFO[k.mark].name}</span>` : ''}
    <div class="muted small">${lineLabel(d.line)}${SKILL_ROLE[d.id] ? ` · ${ROLE_NAME[SKILL_ROLE[d.id]]}` : ''}${branch ? L(` · ทาง${branch}`, ` · ${branch}`) : ''}${k.v ? L(` · มาจาก ${d.name}`, ` · from ${d.name}`) : ''}</div></div></div>
    ${blurb ? `<p class="sp-blurb">${esc(blurb)}</p>` : ''}
    ${simpleTipHTML(k, on)}${scaleRowHTML(k)}${ultRowHTML(k.id)}${nextRowHTML(k)}</div><div class="info-det">
    <div>${chipsHTML(k)}</div>
    <ul class="kwlist">${kws.map((kw) => `<li><b>${KEYWORDS[kw].icon} ${KEYWORDS[kw].name}</b> ${KEYWORDS[kw].desc}</li>`).join('')}</ul>
    ${k.bonus?.length ? `<div class="muted small">${L('โบนัสเชื่อมต่อ (skill ช่องบนหรือล่าง):', 'Connect bonuses (skill above or below):')}</div><ul class="kwlist bonus">${k.bonus.map((b, bi) => `<li class="${on?.has(bi) ? 'on' : ''}">🔗${BONUS_ICON[b.e]} ${bonusText(b, lvOf(k.v))}${on?.has(bi) ? ' <b class="ok">✓</b>' : ''}</li>`).join('')}</ul>` : ''}
    ${k.mark ? `<div class="muted small">${L('ตรา', 'Mark: ')}${R.MARK_INFO[k.mark].name}: ${R.MARK_INFO[k.mark].desc}</div>` : ''}
    </div>${detailTipHTML(k, on)}
    ${note ? `<div class="muted small">${note}</div>` : ''}`;
}

function buildList(b: Build) {
  const act = activeBonuses(b.skills);
  return `<ol class="build readonly">${b.skills
    .map((k, i) => {
      const t = bonusTotals(b.skills, i, act);
      return `<li class="line-${SKILLS[k.id].line}"><img class="skill-icon" src="${skillIcon(k.id)}" alt=""><div class="sk-text">${skillLine(k, t.on, t.haste, chainDirs(b.skills, i, act))}</div></li>`;
    })
    .join('')}</ol>`;
}

/** Upgrade tooltip header: what changes, old → new (new numbers in green), chip by chip. */
function upDeltaHTML(owned: SkillInstance, v: string) {
  const next = { ...owned, v };
  const a = chipsOf(nodeOf(owned), cdTicks(owned)).map((c) => ({ kw: c.kw, t: chipText(c.text) }));
  const b = chipsOf(nodeOf(next), cdTicks(next)).map((c) => ({ kw: c.kw, t: chipText(c.text) }));
  const used = new Set<number>();
  const lines: string[] = [];
  for (const nb of b) {
    const j = a.findIndex((x, k) => !used.has(k) && x.kw === nb.kw);
    if (j < 0) {
      lines.push(`<li><span class="d-new">＋ ${esc(nb.t)}</span></li>`);
      continue;
    }
    used.add(j);
    if (a[j].t !== nb.t) lines.push(`<li><span class="d-old">${esc(a[j].t)}</span> <i>→</i> <b class="d-new">${esc(nb.t)}</b></li>`);
  }
  a.forEach((x, k) => {
    if (!used.has(k)) lines.push(`<li><s class="d-old">${esc(x.t)}</s></li>`);
  });
  return `${simpleDeltaHTML(owned, v)}<div class="tt-delta info-det"><div class="td-h">▲ ${esc(nodeOf(owned).name)} Lv${lvOf(owned.v)} → <b>${esc(nodeOf(next).name)} Lv${lvOf(v)}</b></div>${
    lines.length ? `<ul>${lines.join('')}</ul>` : `<div class="muted small">${L('ตัวเลขเท่าเดิม แต่ได้ความสามารถใหม่', 'Same numbers, new effect')}</div>`
  }</div>`;
}

function tipFor(key: string): string {
  const r = run;
  if (!r) return '';
  const [kind, n] = [key[0], Number(key.slice(2))];
  if (kind === 'g') {
    const k = r.skills[n];
    return k ? tipBody(k, '', bonusTotals(r.skills, n).on) : '';
  }
  if (kind === 's') {
    const o = r.shop[n];
    if (!o) return '';
    const owned = R.upgradeOf(r, o);
    if (owned) return upDeltaHTML(owned, o.v) + tipBody(
        { ...owned, v: o.v },
        L(
          `อัปเกรดจาก ${nodeOf(owned).name} Lv${lvOf(owned.v)} (ใช้ช่องเดิม และโบนัสเชื่อมต่อเดิม)`,
          `Upgrades ${nodeOf(owned).name} Lv${lvOf(owned.v)} (same slot and same connect bonuses)`,
        ),
      );
    return tipBody({ id: o.id, v: o.v, bonus: o.bonus });
  }
  return '';
}

/** Hero portrait: the chibi as inline SVG (look 0 = the class's designed look), breathing with CSS. Cached. */
const heroSvgs: Record<string, string> = {};
function heroArt(id: string, cls = '', look = 0) {
  const k = `${id}:${look}`;
  heroSvgs[k] ??= renderChibi(rollLook(id, look));
  return `<span class="hero-art ${cls}" role="img" aria-label="${HEROES_BY_ID[id]?.name ?? id}">${heroSvgs[k]}</span>`;
}

function streakText(s: number) {
  if (s >= 2) return L(`ชนะติด ${s}`, `${s} wins in a row`);
  if (s <= -2) return L(`แพ้ติด ${-s}`, `${-s} losses in a row`);
  return '';
}

// ---------- views ----------
/** Where the arena canvas goes on this screen (layout.ts places it). cover = fill and crop (town). */
const stageSlot = (cover = false, cls = '') => `<div class="stage-slot ${cls}"${cover ? ' data-stage="cover"' : ''} aria-hidden="true"></div>`;
/** hero shown in the arena on the hero-pick screen (hover / focus a hero card to preview it) */
let previewHero: string | null = null;
const runActive = () => !!run && (run.phase === 'shop' || run.phase === 'relic' || run.phase === 'lastchance' || run.phase === 'mark');

function render() {
  if (view !== shownView) {
    shownView = view;
    onEnterView(view);
  }
  stage.show(view === 'town' || view === 'profile' || view === 'leaderboard' ? 'town' : 'combat');
  // low run HP: the screen edges glow red in the shop (the fight has its own red vignette)
  const hpFrac = run && runActive() && view === 'shop' ? run.hp / R.START_HP : 1;
  document.body.classList.toggle('low-hp', hpFrac <= 0.3);
  document.body.classList.toggle('crit', hpFrac <= 0.15);
  const logoEl = document.querySelector<HTMLElement>('header .logo');
  if (logoEl) {
    const busy = view === 'fighting' || view === 'replay';
    logoEl.setAttribute('aria-disabled', String(busy));
    logoEl.title = busy ? '' : L('กลับเมือง', 'Back to town');
    logoEl.setAttribute('aria-label', `Mochi Moon · ${L('กลับเมือง', 'Back to town')}`);
  }
  const html = {
    profile: renderProfile,
    leaderboard: renderLeaderboard,
    town: renderTown,
    title: renderTitle,
    shop: renderShop,
    fighting: renderFighting,
    result: renderResult,
    lastchance: renderLastChance,
    relic: renderRelic,
    mark: renderMark,
    over: renderOver,
    replay: renderFighting,
    replayDone: renderReplayDone,
  }[view]();
  hideTip();
  // shop → shop: keep each panel's inner scroll (buying or selling must not jump the lists back to the top)
  const keep = view === 'shop' && $panel.querySelector('.shopv') ? [...$panel.querySelectorAll<HTMLElement>('.sv-sec, .sv-side')].map((e) => e.scrollTop) : null;
  $panel.innerHTML = (toast ? `<div class="toast">${esc(toast)}</div>` : '') + html + treeHTML() + branchHTML();
  toast = '';
  if (keep) $panel.querySelectorAll<HTMLElement>('.sv-sec, .sv-side').forEach((e, k) => (e.scrollTop = keep[k] ?? 0));
  clearPick($panel);
  if (view === 'shop' && run) {
    syncChains($panel, run);
    hudAfterRender($panel, run);
  } else resetChains();
  const fx = afterRender;
  afterRender = null;
  if (view === 'shop') fx?.();
  setView(view);
  if (view === 'shop') {
    mountScout();
    watchMoreBelow();
  }
  if (view === 'over') overAfterRender();
  else RF.stop();
  if (view === 'profile') {
    // Enter in the name box saves it
    $panel.querySelector<HTMLInputElement>('#pname')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') $panel.querySelector<HTMLButtonElement>('[data-a="rename"]')?.click();
    });
  }
  // selected skill (tap on mobile) shows the same colour highlight as hover
  if (view === 'title') {
    const input = document.getElementById('name') as HTMLInputElement | null;
    input?.addEventListener('input', () => store(NAME_KEY, input.value.trim()));
  }
}

function renderTown() {
  stage.town.setSelected(selected);
  const b = selected ? BUILDING_BY_ID[selected] : null;
  const chips = BUILDINGS.map(
    (x) => `<button class="chip ${x.id === selected ? 'on' : ''}" data-a="goto" data-i="${x.id}">${x.name}${x.open ? '' : ` <small class="muted">${L('เร็วๆ นี้', 'soon')}</small>`}</button>`,
  ).join('');
  let detail = '';
  if (b) {
    let body = `<p>${b.desc}</p>`;
    if (b.id === 'arena') {
      if (runActive()) {
        const r = run!;
        body += L(
          `<p>รอบที่เล่นค้างไว้: <b>${HEROES_BY_ID[r.hero].name}</b> · วันที่ ${r.day} · ชนะ ${r.wins}/${R.WIN_TARGET} · เลือด ${r.hp}/${R.START_HP}</p>`,
          `<p>Run in progress: <b>${HEROES_BY_ID[r.hero].name}</b> · day ${r.day} · wins ${r.wins}/${R.WIN_TARGET} · HP ${r.hp}/${R.START_HP}</p>`,
        );
      }
      // a finished run whose end screen was closed (reload / tab closed) keeps its results one tap away
      const done = run && (run.phase === 'won' || run.phase === 'dead');
      body += `<div class="actions"><button class="primary" data-a="enterArena">${runActive() ? L('เล่นต่อ', 'Continue') : L('เข้าสนามประลอง', 'Enter the Arena')}</button>${
        done ? `<button data-a="lastResults">${L('ผลรอบล่าสุด', 'Last run results')}</button>` : ''
      }<button data-a="leaderboard">${icon('trophy')} ${L('กระดานผู้นำ', 'Leaderboard')}</button></div>`;
    } else if (b.id === 'board') {
      body += `<div class="actions"><button class="primary" data-a="leaderboard">${L('🏆 กระดานผู้นำ', '🏆 Leaderboard')}</button><button data-a="profile">${L('โปรไฟล์และประวัติ', 'Profile and history')}</button></div>`;
    } else if (b.id === 'hall') {
      body += `<div class="actions"><button class="primary" data-a="profile">${L('โปรไฟล์และประวัติของฉัน', 'My profile and history')}</button><button data-a="leaderboard">${icon('trophy')} ${L('กระดานผู้นำ', 'Leaderboard')}</button></div>`;
      body += `<p class="muted">${L(
        `ฮีโร่ทั้งหมด ${HEROES.length} ตัว · แต่ละรอบสุ่มให้เลือก ${R.HERO_CHOICES} ตัวจากคนละสาย`,
        `${HEROES.length} heroes · each run offers ${R.HERO_CHOICES} at random, from different styles`,
      )}</p><div class="heroes">${HEROES.map(
        (h) => `<div class="card line-${h.line}">${heroArt(h.id, 'small')}<div class="nm">${h.name}</div><div class="tag">${lineLabel(h.line)}</div>
          <div class="desc"><b>${L('วิธีเล่น:', 'Play style:')}</b> ${h.style}</div>
          <div class="desc"><b>${L('ความสามารถ:', 'Passive:')}</b> ${h.passive}</div>
          <div class="desc">${ultHTML(h)}</div>
          <div class="desc muted">${L('skill เฉพาะ:', 'Unique skill:')} <b>${SKILLS[h.unique].name}</b> ${treeBtn(h.unique, null, null)} ${chipsHTML({ id: h.unique, v: '' })}</div></div>`,
      ).join('')}</div>`;
    } else if (b.future) {
      body += `<p class="muted">${L('เร็วๆ นี้:', 'Coming soon:')} ${b.future}</p>`;
    }
    detail = `<div class="bcard"><h3>${b.name}${b.open ? '' : ` <span class="mark">${L('เร็วๆ นี้', 'soon')}</span>`}</h3>${body}</div>`;
  }
  return `${stageSlot(false, 'town-slot')}
  <section class="town-card glass">
    <h2 class="town-h">${L('เมืองของคุณ', 'Your town')}</h2>
    <p class="town-hint">${L(
      'ลากซ้ายขวาเพื่อเดินดูเมือง (ใช้ล้อเมาส์หรือปุ่มลูกศรก็ได้) · แตะอาคารเพื่อดูรายละเอียด · แตะแผนที่ย่อด้านล่างเพื่อกระโดดไปจุดนั้น',
      'Drag left and right to walk around town (the mouse wheel or arrow keys work too) · tap a building for details · tap the mini map below to jump there',
    )}</p>
    <div class="chips">${chips}</div>
    ${detail}
  </section>`;
}

/** the heroes offered for the next run: from the seed offline, from the chain's randomness on chain (null = not yet) */
function heroOffer(): string[] {
  if (!C.chainOn()) return R.heroChoices((nextSeed ??= randSeed()));
  if (!chainChoices && chainConn === 'ready' && !chainStarting && !runActive()) {
    chainStarting = true;
    void C.chainBeginRun().then(
      (c) => { chainChoices = c.choices; chainPreview = c.preview; chainLook = c.lookSeed; chainStarting = false; render(); },
      (e) => { chainStarting = false; toast = (e as Error).message; render(); },
    );
  }
  return chainChoices ?? [];
}
/**
 * The day-1 shop of an offered hero, card bonuses included: shown before the pick (intended gameplay information).
 * Offline it is rolled from the next run's seed; on chain the program publishes it with the hero choices.
 */
function day1Shop(id: string): (R.Offer | null)[] {
  if (C.chainOn()) return chainPreview?.[id] ?? [];
  return R.newRun(id, (nextSeed ??= randSeed()), 'preview').shop;
}
function day1HTML(id: string) {
  const shop = day1Shop(id).filter((o): o is R.Offer => !!o);
  if (!shop.length) return '';
  // always visible (Simple and Detail mode): effect + what it connects to, e.g. "+1⚔ next to Gust"
  const bon = (b: Bonus) => `<span class="d1-bonus">${esc(bonusShort(b, 1))} ${L('ติดกับ', 'next to')} ${esc(targetWords(b.t))}</span>`;
  const row = (o: R.Offer) => `<span class="d1-card"><img class="skill-icon" src="${skillIcon(o.id)}" alt=""><b>${esc(nodeOf({ id: o.id, v: o.v }).name)}</b>${(o.bonus ?? []).map(bon).join('')}</span>`;
  return `<span class="hero-day1"><small class="muted">${L('ร้านวันแรก (โบนัสต่อสาย)', 'Day-1 shop (connect bonuses)')}</small>${shop.map(row).join('')}</span>`;
}
/** cosmetic look of an offered hero = the look its run will have (on chain: from the run's published cosmetic seed) */
const offerLook = (id: string) => (C.chainOn() ? (chainLook ? R.lookFor(chainLook, id) : 0) : R.lookFor(nextSeed!, id));

function renderTitle() {
  const offered = runActive() ? [] : heroOffer().map((id) => HEROES_BY_ID[id]);
  if (!previewHero || (offered.length && !offered.some((h) => h.id === previewHero))) previewHero = offered[0]?.id ?? run?.hero ?? null;
  if (scene && previewHero) scene.idle(previewHero, runActive() ? R.lookOf(run!) : offerLook(previewHero));
  const resume = runActive()
    ? `<button class="primary" data-a="resume">${L(
        `เล่นต่อ: ${HEROES_BY_ID[run!.hero].name} วันที่ ${run!.day} (ชนะ ${run!.wins})`,
        `Continue: ${HEROES_BY_ID[run!.hero].name}, day ${run!.day} (${run!.wins} wins)`,
      )}</button>`
    : '';
  return `<div class="pick">
  <div class="pick-side">
    <div class="pick-brand"><button class="ghost back" data-a="town">${L('← กลับเมือง', '← Back to town')}</button>
      <img class="brand-logo" src="${IMAGES.logo}" alt="Mochi Moon" width="320" height="120"></div>
    ${stageSlot(true, 'pick-slot')}
    <p class="pick-rules">${L(
      `ชนะ ${R.WIN_TARGET} ครั้งก่อนเลือด ${R.START_HP} หมด · แพ้เสียเลือด ${R.damageFor(1)}–${R.LOSS_CAP} ตามวัน · สู้กับ build ของผู้เล่นอื่นในวันเดียวกัน`,
      `Win ${R.WIN_TARGET} times before your ${R.START_HP} HP runs out · a loss costs ${R.damageFor(1)}–${R.LOSS_CAP} HP depending on the day · fight other players' builds from the same day`,
    )}</p>
  </div>
  <section class="pick-main glass">
    <div class="pick-head">
      <h2>${L('เลือกฮีโร่', 'Choose your hero')}</h2>
      <label class="name">${L('ชื่อของคุณ', 'Your name')} <input id="name" maxlength="24" value="${esc(fetchStore(NAME_KEY) ?? '')}" placeholder="${L('ผู้เล่น', 'Player')}"></label>
    </div>
    ${resume}
    ${runActive() ? '' : `<p class="pick-note">${L(
      `รอบนี้มีให้เลือก ${R.HERO_CHOICES} ตัวจากคนละสาย · แตะการ์ดเพื่อเริ่ม (ดูฮีโร่ทั้งหมดได้ที่หอฮีโร่ในเมือง)`,
      `This run offers ${R.HERO_CHOICES} heroes from different styles · tap a card to start (see every hero in the Hero Hall in town)`,
    )}</p>`}
    <div class="heroes pick3">${offered.map(
      (h) => `<button class="hero line-${h.line}${h.id === previewHero ? ' previewing' : ''}" data-a="start" data-i="${h.id}">
        ${heroArt(h.id, '', offerLook(h.id))}
        <b class="hero-nm">${h.name}</b><span class="tag">${lineLabel(h.line)}</span>
        <span class="hero-style">${h.style}</span>
        <span class="hero-ult-how info-simp">★ ${esc(h.ult.name)}: ${L(`ซื้อ skill ${LINE_ICON[h.line]} สาย${LINE_NAME[h.line]} 3 ใบ เพื่อปลดท่าไม้ตาย`, `buy 3 ${LINE_ICON[h.line]} ${LINE_NAME[h.line]} skills to unlock the ultimate`)}</span>
        <span class="hero-passive info-det">${h.passive}</span>
        <span class="hero-ult small info-det">${ultHTML(h)}</span>
        <span class="muted hero-uniq info-det">${L('skill เฉพาะ:', 'Unique skill:')} ${SKILLS[h.unique].name} ${chipsHTML({ id: h.unique, v: '' })}</span>
        ${day1HTML(h.id)}
        <span class="hero-go">${L('เริ่มด้วยตัวนี้ ▶', 'Start with this hero ▶')}</span>
      </button>`,
    ).join('')}</div>
  </section>
  </div>`;
}

/** Buy-button label: "Buy (coin) 3"; when it can't be bought, the reason, plus the price in red if gold is short. */
function buyLabel(why: string, verb: string, price: number, poor: boolean) {
  if (!why) return `${verb} ${coinHTML(price)}`;
  return poor ? `<span class="why">${why}</span> ${coinHTML(price, true)}` : why;
}

/** Shop card that sells +1 skill slot. */
function slotCard(r: R.RunState) {
  const price = R.slotPrice(r);
  const maxed = R.slotsOf(r) >= R.MAX_SLOTS;
  // sim v19: no slot while one is still empty (a lone-wolf build never needs one)
  const spare = r.skills.length < R.slotsOf(r);
  const why = maxed ? L('เต็มแล้ว', 'Maxed') : spare ? L('ยังมีช่องว่าง', 'A slot is still empty') : r.gold < price ? L('เงินไม่พอ', 'Not enough gold') : '';
  return `<div class="card offer expand extra${!maxed && r.gold < price ? ' poor' : ''}" title="${L('ช่อง skill +1 ถาวรทั้งรอบ ราคาขึ้นทุกครั้งที่ซื้อ', '+1 skill slot for the whole run; the price goes up each time')}">
    <div class="offer-art" aria-hidden="true">＋</div>
    <div class="offer-name">${L('ช่อง skill +1', '+1 skill slot')}</div>
    <div class="offer-desc">${maxed ? L(`มีครบ ${R.MAX_SLOTS} ช่องแล้ว`, `All ${R.MAX_SLOTS} slots owned`) : L(`ถาวรทั้งรอบ · ${R.slotsOf(r)}/${R.MAX_SLOTS} ช่อง · ถัดไป ${price + 2}`, `Whole run · ${R.slotsOf(r)}/${R.MAX_SLOTS} slots · next ${price + 2}`)}</div>
    <button class="buy" data-a="slot" ${why ? 'disabled' : ''}>${buyLabel(why, L('ซื้อ', 'Buy'), price, !maxed && r.gold < price)}</button>
  </div>`;
}

/** Shop card for พรจันทร์ (moon wish): the late-run gold sink, a random upgrade (or a random mark once all are Lv3). */
function wishCard(r: R.RunState) {
  const kind = R.wishKind(r);
  const price = R.wishPrice(r);
  const why = !r.skills.length ? L('ยังไม่มี skill', 'No skills yet') : !kind ? L('ครบทุกอย่างแล้ว', 'All done') : r.gold < price ? L('เงินไม่พอ', 'Not enough gold') : '';
  const below = r.skills.filter((k) => lvOf(k.v) < R.MAX_LV).length;
  const unmarked = r.skills.filter((k) => !k.mark && !k.markHidden).length;
  const left = R.WISH_MARKS_MAX - (r.wishMarks ?? 0);
  // one clear line: what this wish gives now, and why (never two rules that read as if they clash)
  const desc = !r.skills.length
    ? L('ซื้อ skill ก่อน', 'Buy a skill first')
    : kind === 'mark'
      ? `<span class="wish-kind mk">✦ ${L('ให้ตรา', 'Gives a mark')}</span> ${L(`ทุกตัว Lv3 แล้ว: สุ่มตราใส่ 1 ใน ${unmarked} ตัวที่ยังไม่มีตรา · เหลือ ${left} ครั้ง`, `All Lv3: a random mark on 1 of ${unmarked} unmarked skills · ${left} left`)}`
      : kind === 'upgrade'
        ? `<span class="wish-kind up">▲ ${L('ให้อัปเกรด', 'Gives an upgrade')}</span> ${L(`สุ่มอัป 1 ใน ${below} ตัวที่ยังไม่ Lv3 (สุ่มทาง)`, `1 of ${below} skills below Lv3 goes up (random branch)`)}${left > 0 && r.day >= R.LV3_DAY ? `<br><small class="muted">${L(`ให้ตราได้เมื่อทุกตัว Lv3 (เหลือ ${below})`, `marks once all are Lv3 (${below} to go)`)}</small>` : ''}`
        : `<span class="wish-kind no">${L('หมดแล้ว', 'Nothing left')}</span> ${(r.wishMarks ?? 0) >= R.WISH_MARKS_MAX ? L(`ใช้ตราจากพรครบ ${R.WISH_MARKS_MAX} แล้ว`, `All ${R.WISH_MARKS_MAX} wish marks used`) : L('ทุกตัวมีตราแล้ว', 'Every skill has a mark')}`;
  const tip = `<div class="tt-h"><b>${L('🌙 พรจันทร์', '🌙 Moon Wish')}</b></div><div class="desc">${L(
    `ใช้เงินที่เหลือ: สุ่ม skill และทางให้ (ช่องเดิม โบนัสเดิม)<br>
    · <b>ให้อัปเกรด</b> ถ้ายังมี skill ต่ำกว่า Lv3<br>
    · <b>ให้ตรา</b> เมื่อทุกตัว Lv3 แล้วเท่านั้น (+${R.MARK_WISH_EXTRA} เงิน, ${R.WISH_MARKS_MAX} ครั้งต่อรอบ)<br>
    · ราคาเริ่ม ${R.WISH_BASE} และ +2 ทุกครั้งในวันเดียวกัน`,
    `For spare gold: picks the skill and branch at random (same slot, same bonuses)<br>
    · <b>an upgrade</b> while any skill is below Lv3<br>
    · <b>a mark</b> only once every skill is Lv3 (+${R.MARK_WISH_EXTRA} gold, ${R.WISH_MARKS_MAX} a run)<br>
    · starts at ${R.WISH_BASE}, +2 for each wish already made that day`,
  )}</div>`;
  return `<div class="card offer extra wish${kind && r.skills.length && r.gold < price ? ' poor' : ''}" data-ttxt="${esc(tip)}">
    <div class="offer-art" aria-hidden="true">🌙</div>
    <div class="offer-name">${L('พรจันทร์', 'Moon Wish')} <button class="cx-q-link" data-codex="shop:wish" aria-label="${esc(L('พรจันทร์ในคู่มือ', 'Moon wish in the codex'))}">?</button></div>
    <div class="offer-desc">${desc}</div>
    <button class="buy" data-a="wish" ${why ? 'disabled' : ''}>${buyLabel(why, L('ขอพร', 'Wish'), price, !!kind && r.skills.length > 0 && r.gold < price)}</button>
  </div>`;
}

/** Re-draw only the timeline for a list order (used live while dragging). */
function previewOrder(order: number[]) {
  const r = run;
  const el = document.getElementById('timeline');
  if (!r || !el) return;
  const skills = order.map((i) => r.skills[i]).slice(0, R.slotsOf(r));
  el.innerHTML = timelineHTML(skills, r.hero);
  dragPreview($panel, r, order);
}

/** one-shot effects to play right after the next render (coins flying, a row popping) */
let afterRender: (() => void) | null = null;
const goldPillRect = () => $panel.querySelector('.gold-pill')?.getBoundingClientRect() ?? null;

/** Why shop offer i can't be bought right now ('' = it can). Same checks as run.buy, for the UI. */
function offerWhy(r: R.RunState, i: number) {
  const o = r.shop[i];
  if (!o) return L('ซื้อแล้ว', 'Bought');
  if (o.v !== '' && !R.upgradeOf(r, o)) return L('ใช้ไม่ได้แล้ว', 'No longer fits');
  if (r.gold < R.priceOf(o)) return L('เงินไม่พอ', 'Not enough gold');
  if (o.v === '' && r.skills.length >= R.slotsOf(r)) return L('ช่องเต็ม', 'Slots full');
  return '';
}

/**
 * Buy shop offer i through run.buy (the same rule the server re-checks at fight time). A new skill then moves from
 * the end of the list to `pos` (null = the ghost's spot: the best chain spot, else the end); an upgrade stays put.
 */
function buyOffer(i: number, pos: number | null, pick?: string): string | null {
  const r = run!;
  const o = r.shop[i];
  if (!o) return R.buy(r, i);
  const up = R.upgradeOf(r, o);
  const upIdx = up ? r.skills.indexOf(up) : -1;
  const at = o.v === '' ? Math.max(0, Math.min(r.skills.length, pos ?? defaultSlot(r, o))) : upIdx;
  const from = $panel.querySelector(`.card.offer[data-tip="s:${i}"]`)?.getBoundingClientRect() ?? null;
  const err = R.buy(r, i, pick);
  if (err) return err;
  if (o.v === '') for (let k = r.skills.length - 1; k > at; k--) R.moveSkill(r, k, -1);
  afterRender = () => {
    coinFly(goldPillRect(), from);
    popRow($panel.querySelector<HTMLElement>(`.skillrow[data-i="${at}"]`), upIdx >= 0);
  };
  return null;
}

/** Sell skill i (button or the coin jar): coins fly back into the gold pill. */
function sellSkill(i: number, from: DOMRect | null) {
  const r = run;
  if (!r || view !== 'shop' || !r.skills[i]) return;
  R.sell(r, i);
  afterRender = () => coinFly(from, goldPillRect());
  sfx('sell');
  saveRun();
  render();
  scene.react('sell');
}

/** Drop from the drag: move skill `from` to position `to`. */
function dropSkill(from: number, to: number) {
  const r = run;
  if (!r || view !== 'shop' || !r.skills[from]) return;
  // one step at a time through R.moveSkill (= the same order as taking it out and inserting it at `to`), so chain
  // mode queues every move for the chain; editing r.skills directly changed only the screen, not the build fought
  const end = Math.max(0, Math.min(to, r.skills.length - 1));
  for (let i = from; i < end; i++) R.moveSkill(r, i, 1);
  for (let i = from; i > end; i--) R.moveSkill(r, i, -1);
  saveRun();
  render();
}

/**
 * Branch choice (sim v17): an upgrade card shows both next branches with their changes and rarity; the player taps one.
 * Empty when the offer has no choice (a new skill, a star, a stale card).
 */
function choiceHTML(r: R.RunState, o: R.Offer, i: number, why: string, price: number, poor: boolean) {
  const up = R.upgradeOf(r, o);
  const opts = R.offerChoices(r, o);
  if (!up || opts.length < 2) return '';
  const names = opts
    .map((v) => {
      const rar = rarityOf(o.id, v);
      const nx = epicAfter(o.id, v);
      return `<span class="bp-n rar-${rar}">${esc(nodeOf({ id: o.id, v }).name)}<i>${rar === 'epic' ? L('◆ มหากาพย์', '◆ epic') : rar === 'rare' ? L('◇ หายาก', '◇ rare') : nx ? L('◆ ทางสู่มหากาพย์', '◆ leads to epic') : SKILLS[o.id].tree[v[0] as 'a'].style ?? ''}</i></span>`;
    })
    .join('');
  return `<div class="branch-pick bp-mini"><div class="bp-names">${names}</div>
    <button class="buy" data-a="branchOpen" data-i="${i}" ${why ? 'disabled' : ''}>${buyLabel(why, L('เลือกทาง ▸', 'Pick a branch ▸'), price, poor)}</button></div>`;
}

/** shop offer whose two branches are open side by side (null = closed) */
let branchOpen: number | null = null;
/** The branch picker: both next branches side by side, rarity frames, before → after and what each leads to. */
function branchHTML() {
  const r = run;
  if (branchOpen === null || !r || view !== 'shop') return '';
  const o = r.shop[branchOpen];
  const up = o ? R.upgradeOf(r, o) : null;
  const opts = o ? R.offerChoices(r, o) : [];
  if (!o || !up || opts.length < 2) return '';
  const price = R.priceOf(o);
  const why = offerWhy(r, branchOpen);
  const poor = r.gold < price;
  const th = getLang() !== 'en';
  const now = simpleText(up);
  const card = (v: Variant) => {
    const k = { id: o.id, v };
    const rar = rarityOf(o.id, v);
    const diff = upgradeDiff(nodeOf(up), nodeOf(k), th);
    const nx = lvOf(v) < R.MAX_LV ? nextVariants(v).map((x) => ({ x, rar: rarityOf(o.id, x) })) : [];
    return `<div class="bp-opt rar-${rar}">
      ${rar !== 'common' ? `<span class="bp-rar">${D.rarityName(rar)}</span>` : ''}
      <h4>${esc(nodeOf(k).name)} <small>Lv${lvOf(v)}</small></h4>
      <span class="bp-style info-det">${L('ทาง', 'Branch')} ${v.toUpperCase()}${SKILLS[o.id].tree[v[0] as 'a'].style ? ` · ${esc(SKILLS[o.id].tree[v[0] as 'a'].style!)}` : ''}</span>
      <dl class="bp-ba info-det"><dt>${L('ตอนนี้', 'Now')}</dt><dd>${esc(now)}</dd><dt>${L('หลังอัป', 'After')}</dt><dd class="after">${esc(simpleText(k))}</dd></dl>
      <div class="bp-simple info-simp">${simpleSkillHTML(k)}</div>
      ${diff.length ? `<div class="bp-diff">${diff.map((d) => `<span class="${d.worse ? 'worse' : ''}">${esc(d.text)}${d.worse ? ' ▼' : ''}</span>`).join('')}</div>` : ''}
      ${nx.length ? `<div class="bp-next info-det">${L('Lv3 ต่อไป', 'Lv3 next')}: ${nx.map((n) => `${esc(nodeOf({ id: o.id, v: n.x }).name)}${n.rar === 'epic' ? ' ◆' : n.rar === 'rare' ? ' ◇' : ''}`).join(L(' หรือ ', ' or '))}</div>` : ''}
      <button class="buy primary" data-a="buy" data-i="${branchOpen}" data-v="${v}" ${why ? 'disabled' : ''}>${buyLabel(why, L('เลือกทางนี้', 'Take this branch'), price, poor)}</button>
    </div>`;
  };
  return `<div class="modal bp-modal" data-a="branchClose"><div class="modal-box bp-box" role="dialog" aria-label="${esc(L('เลือกทางอัปเกรด', 'Pick an upgrade branch'))}">
    <div class="bp-head"><img class="skill-icon" src="${skillIcon(o.id)}" alt=""><h3>${L('เลือกทาง', 'Pick a branch')}: ${esc(nodeOf(up).name)} Lv${lvOf(up.v)} → Lv${lvOf(o.v)}<small class="info-det">${L('เลือกแล้วย้อนกลับไม่ได้ · ช่องเดิม โบนัสเชื่อมต่อเดิม', 'No going back · same slot, same connect bonuses')}</small></h3>
      <button class="small ghost" data-a="branchClose">${L('ปิด ✕', 'Close ✕')}</button></div>
    <div class="bp-opts">${opts.map(card).join('')}</div>
  </div></div>`;
}

/** Relic day (sim v17): pick 1 of 3 run relics, or skip. Each card says what it does, if it fits your build and its risk. */
function renderRelic() {
  const r = run!;
  scene.idle(r.hero, R.lookOf(r));
  const cards = (r.relicOffer ?? []).map((id, i) => D.relicCardHTML(id, i, r.skills)).join('');
  return `<div class="lay">
  <div class="lay-side">${stageSlot(true)}</div>
  <section class="lay-main glass relic-view">
  <h2>${L(`วันที่ ${r.day}: เลือกของวิเศษ`, `Day ${r.day}: pick a relic`)} <button class="cx-q-link" data-codex="relics" aria-label="${esc(L('ของวิเศษในคู่มือ', 'Relics in the codex'))}">?</button></h2>
  <p class="rv-lead">${L('เลือก 1 ชิ้น ใช้ได้ทั้งรอบ หรือข้ามไป', 'Pick 1; it lasts the whole run. Or skip')}</p>
  ${relicsHTML(r.relics)}
  <div class="shop relic-shop">${cards}</div>
  <div class="actions">${R.relicRerollsLeft(r) ? `<button class="relic-re" data-a="relicReroll" title="${esc(L('3 ชิ้นนี้จะหายไป แล้วได้ 3 ชิ้นใหม่ (ฟรี)', 'These 3 go away and you get 3 new ones (free)'))}">🎲 ${L(`สุ่มใหม่ (ฟรี เหลือ ${R.relicRerollsLeft(r)})`, `Reroll (free, ${R.relicRerollsLeft(r)} left)`)}</button>` : ''}<button class="ghost" data-a="relic" data-i="-1">${L('ข้าม ไม่เอาชิ้นไหน', 'Skip, take none')}</button></div>
  ${(r.relicRolls ?? 0) > 0 && !R.relicRerollsLeft(r) ? `<p class="muted small">${L('สุ่มใหม่แล้ว: ชุดนี้คือชุดสุดท้าย', 'Rerolled: this is the last set')}</p>` : ''}
  </section>
  </div>`;
}

function renderShop() {
  const r = run!;
  scene.idle(r.hero, R.lookOf(r));
  const hero = HEROES_BY_ID[r.hero];
  const slots = R.slotsOf(r);
  const shop = r.shop
    .map((o, i) => {
      if (!o) return `<div class="card empty">${L('ซื้อแล้ว', 'Bought')}</div>`;
      const d = SKILLS[o.id];
      const node = d.tree[o.v as '' | 'a'];
      const up = R.upgradeOf(r, o);
      const price = R.priceOf(o);
      const stale = o.v !== '' && !up;
      const full = o.v === '' && r.skills.length >= slots;
      const why = stale ? L('ใช้ไม่ได้แล้ว', 'No longer fits') : r.gold < price ? L('เงินไม่พอ', 'Not enough gold') : full ? L('ช่องเต็ม', 'Slots full') : '';
      const branch = o.v ? d.tree[o.v[0] as 'a' | 'b'].style : '';
      // which of the offer's bonuses an owned skill could switch on
      const can = new Set((o.bonus ?? []).map((b, bi) => (r.skills.some((k) => matches(b.t, k)) ? bi : -1)).filter((bi) => bi >= 0));
      const locked = R.isLocked(r, i);
      const lockBtn = `<button class="lock${locked ? ' on' : ''}" data-a="lock" data-i="${i}" aria-pressed="${locked}"
        aria-label="${locked ? L('ปลดล็อกการ์ดนี้', 'Unlock this card') : L('ล็อกการ์ดนี้ไว้ถึงพรุ่งนี้', 'Lock this card until tomorrow')}" title="${locked ? L('ล็อกอยู่: การ์ดนี้จะอยู่ต่อแม้สุ่มใหม่หรือข้ามวัน (กดเพื่อปลด)', 'Locked: this card stays through rerolls and the next day (press to unlock)') : L('ล็อก: เก็บการ์ดนี้ไว้ถึงพรุ่งนี้ (ฟรี)', 'Lock: keep this card until tomorrow (free)')}">${locked ? '🔒' : '🔓'}</button>`;
      const poor = !stale && r.gold < price;
      const isUp = !!up;
      const badge = isUp
        ? `<span class="up-badge" aria-label="${L(`อัปเกรดเป็น Lv${lvOf(o.v)}`, `Upgrades to Lv${lvOf(o.v)}`)}">▲ Lv${lvOf(o.v)}</span><span class="up-shine" aria-hidden="true"></span>`
        : '';
      const tipped = tipIds.includes(o.id);
      return `<div class="card offer line-${d.line}${tipped ? ' tip-pick' : ''}${d.hero ? ' uniq' : ''}${o.v ? ' upgrade' : ''}${o.star ? ' star-card' : ''}${isUp ? ' can-up' : ''}${locked ? ' locked' : ''}${poor ? ' poor' : ''}${why ? ' nobuy' : ''}" data-tip="s:${i}">
        ${badge}${tipped ? `<span class="tip-badge">💡 ${L('ไฟต์ที่แล้วแนะนำ', 'Last fight’s tip')}</span>` : ''}<div class="offer-top">${lockBtn}<span class="offer-lv">${o.star && up ? `<span class="sc-head">${D.starPips(up.star ?? 0, true)} <b>+★</b></span>` : isUp ? `Lv${lvOf(up.v)} → <b>Lv${lvOf(o.v)}</b>` : `Lv${lvOf(o.v)}`}</span>${treeBtn(o.id, up ? up.v : null, o.v)}</div>
        <div class="offer-name"><img class="skill-icon" src="${skillIcon(o.id)}" alt="" draggable="false">${o.star ? `${node.name}` : up && R.offerChoices(r, o).length > 1 ? nodeOf(up).name : node.name}</div>
        <div class="offer-meta">${o.star ? '' : o.v ? `<span class="up">▲ ${L('อัปเกรด', 'Upgrade')} ${d.name}${branch ? ` · ${branch}` : ''}</span>` : `<span class="arch-name">${lineLabel(d.line)}</span>`}${d.hero ? `<span class="mark uniq-tag">★ ${L('สกิลประจำตัว', 'UNIQUE')}</span>` : ''}${o.star || R.offerChoices(r, o).length > 1 ? '' : `<span class="info-det">${rarityTag(o.v ? o : null)}</span>`}${o.star ? '' : uniqUltTag(d.hero, ultTagHTML(r, o))}</div>
        ${choiceHTML(r, o, i, why, price, poor) || `${up ? (o.star ? starDiff(o.star) : upDiffHTML(up, o)) : ''}
        <div class="offer-desc">${chipsHTML({ id: o.id, v: o.v })}${offerPairsHTML(r, o, (b) => offerTip(b, can.has((o.bonus ?? []).indexOf(b))))}</div>
        <button class="buy" data-a="buy" data-i="${i}" ${why ? 'disabled' : ''}>${buyLabel(why, isUp ? (o.star ? L(`เพิ่มดาว ★${o.star}`, `Add star ★${o.star}`) : L('อัปเกรด', 'Upgrade')) : L('ซื้อ', 'Buy'), price, poor)}</button>`}
      </div>`;
    })
    .join('');
  const act = activeBonuses(r.skills);
  const rows = r.skills
    .map((k, i) => {
      const t = bonusTotals(r.skills, i, act);
      const row = `<li class="skillrow line-${SKILLS[k.id].line}${rarityOf(k.id, k.v) === 'epic' ? ' row-epic' : ''}${(k.star ?? 0) >= 3 ? ' row-star3' : ''}" data-tip="g:${i}" data-i="${i}" data-sell="${R.sellPrice(k)}">
        <span class="grip" data-drag="${i}" title="${L('ลากเพื่อย้าย', 'Drag to move')}" aria-hidden="true">⠿</span>
        <span class="sk-no" aria-hidden="true">${i + 1}</span>
        <img class="skill-icon" src="${skillIcon(k.id)}" alt=""><div class="sk-text">${skillLine(k, t.on, t.haste, chainDirs(r.skills, i, act))}<span class="sk-tags">${SKILLS[k.id].hero ? ` <span class="mark uniq-tag">★ ${L('สกิลประจำตัว', 'UNIQUE')}</span>` : ''}<span class="info-det">${rarityTag(k.v ? { id: k.id, v: k.v } : null)}</span>${inLine(r.hero, k.id) ? ` <span class="mark ult-aff info-det" title="${esc(L(`skill สายหลักของฮีโร่: ตัวเลขทุกตัว (ตี โล่ ฟื้น ไฟ พิษ ฯลฯ) ×${lineAffinity(r.hero).toFixed(2)}`, `a skill of your hero’s main line: every number (hits, shield, heal, burn, poison …) ×${lineAffinity(r.hero).toFixed(2)}`))}">${L('ถนัด', 'mastery')} +${Math.round((lineAffinity(r.hero) - 1) * 100)}%</span>` : ''}</span></div>
        <div class="sk-btns">
          ${treeBtn(k.id, k.v, null)}
          <button class="ghost mv" data-a="up" data-i="${i}" ${i === 0 ? 'disabled' : ''} aria-label="${L(`เลื่อน ${nodeOf(k).name} ขึ้น`, `Move ${nodeOf(k).name} up`)}">▲</button>
          <button class="ghost mv" data-a="down" data-i="${i}" ${i === r.skills.length - 1 ? 'disabled' : ''} aria-label="${L(`เลื่อน ${nodeOf(k).name} ลง`, `Move ${nodeOf(k).name} down`)}">▼</button>
          <button class="sell${sellDrop(r, i) ? ' sell-warn' : ''}" data-a="sell" data-i="${i}"${sellDrop(r, i) ? ` title="${esc(sellDrop(r, i))}"` : ''}>${L('ขาย', 'Sell')} +${R.sellPrice(k)}${sellDrop(r, i) ? ` <small>${esc(sellDrop(r, i))}</small>` : ''}</button>
        </div>
      </li>`;
      const gap = i < r.skills.length - 1 ? gapHTML(r.skills, i, act) : '';
      return row + gap;
    })
    .join('');
  const empty = `<li class="skillrow emptyslot"><span class="muted">${L('ช่องว่าง: ซื้อ skill จากร้าน', 'Empty slot: buy a skill from the shop')}</span></li>`.repeat(Math.max(0, slots - r.skills.length));
  const inc = r.lastIncome;
  const nLocked = r.shop.filter((_, i) => R.isLocked(r, i)).length;
  resetHints();
  return `<div class="shopv">
  ${hudHTML(r, streakText(r.streak), `<button class="small ghost cx-hud" data-codex="run" title="${esc(L('คู่มือ', 'Codex'))}" aria-label="${esc(L('เปิดคู่มือ', 'Open the codex'))}">📖</button>${concedeHTML()}`)}
  <aside class="sv-side">
    ${stageSlot(true, 'sv-slot')}
    <div class="sv-hero glass">
      <div class="svh-name"><b>${hero.name}</b> <span class="tag">${lineLabel(hero.line)}</span></div>
      <p class="sv-sub">${L('วันนี้ได้', 'Today')} +${inc.base}${inc.bonus ? L(` และโบนัส +${inc.bonus}`, ` and bonus +${inc.bonus}`) : ''}<span class="info-det"> · ${hero.passive}</span></p>
      <div class="sv-sub sv-ult">${ultProgressHTML(r)}</div>${relicsHTML(r.relics)}${D.markCountHTML(r.skills, r.wishMarks ?? 0)}
    </div>
    <div class="mm-scout-slot sv-scout"></div>
  </aside>

  <section class="sv-sec sv-shop">
    <div class="sv-h">${goldPillHTML(r.gold)}<h3>${L('ร้าน skill', 'Skill shop')}</h3>
      <button class="reroll" data-a="reroll" ${r.gold < R.REROLL || r.day <= 1 ? 'disabled' : ''} title="${r.day <= 1 ? L('วันแรกเป็นร้านประจำฮีโร่', 'Day 1 is your hero’s shop') : L('สุ่มการ์ดใหม่ (การ์ดที่ล็อกไว้อยู่ต่อ)', 'New cards (locked cards stay)')}">${L('🎲 สุ่มใหม่', '🎲 Reroll')} ${coinHTML(R.REROLL)}</button></div>
    <p class="sv-note info-det">${L(
      '<b>ลากการ์ด</b>ไปวางในรายการ skill ของคุณ (หรือแตะการ์ด แล้วแตะ <b>+</b> ตรงที่อยากวาง) · การ์ด <b>▲</b> = อัปเกรด skill ที่มีอยู่',
      '<b>Drag a card</b> into your skill list (or tap a card, then tap <b>+</b> where you want it) · a <b>▲</b> card levels up a skill you own',
    )} · 🔓 ${L('ล็อกการ์ดไว้ถึงพรุ่งนี้ได้ฟรี', 'lock a card until tomorrow for free')}${nLocked ? L(` (ล็อกอยู่ ${nLocked})`, ` (${nLocked} locked)`) : ''}</p>
    ${tipLineHTML(r)}
    <div class="shop">${shop}${slotCard(r)}${wishCard(r)}</div>
    <div class="sell-jar" aria-label="${L('โหลขาย: ลาก skill มาวางที่นี่เพื่อขาย', 'Sell jar: drag a skill here to sell it')}">
      <span class="jar-ico" aria-hidden="true"><i class="coin-ico"></i><i class="coin-ico"></i><i class="coin-ico"></i></span>
      <span class="jar-t">${L('ลาก skill มาที่โหลนี้เพื่อขาย', 'Drag a skill into this jar to sell it')}</span><b class="jar-amt"></b>
    </div>
  </section>

  <section class="sv-sec sv-mine">
    <div class="sv-h"><h3>${L('skill ของคุณ', 'Your skills')} <span class="sv-count">${r.skills.length}/${slots}</span></h3>
      <span class="sv-hint">${L(`โบนัสเชื่อมต่อทำงาน ${act.length} อัน`, `${act.length} connect bonuses active`)}</span></div>
    ${chainPanelHTML(r.skills, act)}
    <p class="sv-note info-det">${L(
      'ลาก <b>⠿</b> เพื่อจัดลำดับ (หรือกด ▲▼): skill ที่อยู่ติดกัน (บน/ล่าง) เปิด 🔗 โบนัสเชื่อมต่อของกันและกัน · ถ้าครบเวลาพร้อมกัน ตัวบนทำงานก่อน',
      'Drag <b>⠿</b> to reorder (or press ▲▼): skills next to each other (above/below) switch on each other’s 🔗 connect bonuses · when two are ready at once, the upper one goes first',
    )}</p>
    <div class="list-wrap">
      <ol class="skilllist">${rows}${empty}</ol>
      <div class="tl info-det" aria-label="${L('ลำดับการทำงาน', 'Firing order')}">
        <div class="tl-h"><b>${L(`⏱ ใครทำงานก่อน: ${TIMELINE_SECS} วิแรก`, `⏱ Who goes first: the first ${TIMELINE_SECS}s`)}</b>
          <span class="tl-legend"><i class="tl-dot own"></i> ${L('ครบคูลดาวน์', 'cooldown ready')} <i class="tl-dot trig">⚡</i> ${L('โบนัสสั่งให้ทำงานตาม', 'fired by a bonus')}</span></div>
        <div id="timeline">${timelineHTML(R.toBuild(r).skills, r.hero)}</div>
        <p class="tl-foot">${L(
          'จำลองด้วยระบบสู้จริง กับหุ่นซ้อมที่ไม่ตีกลับ · ถ้าศัตรูแช่แข็งหรือทำให้ช้า skill จะทำงานช้ากว่านี้',
          'Run by the real fight engine against a dummy that never hits back · enemy freezes and slows make skills fire later than this',
        )}</p>
      </div>
    </div>
  </section>

  <div class="sv-fight">
    <span class="pill gold"><small>${L('เงินเหลือ', 'Gold left')}</small> ${COIN_I}<b class="gold-n">${r.gold}</b></span>
    <button class="primary fightbtn" data-a="fight" ${busy || !r.skills.length ? 'disabled' : ''}>⚔ ${L('สู้วันที่', 'Fight day')} ${r.day} <small>${L('แพ้เสียเลือด', 'a loss costs')} ${R.damageFor(r.day)}${L('', ' HP')}</small>${r.skills.length < R.slotsOf(r) && !(r.relics ?? []).includes('lonewolf') ? `<small class="warn-empty">${L(`ช่อง skill ว่าง ${R.slotsOf(r) - r.skills.length} ช่อง`, `${R.slotsOf(r) - r.skills.length} empty skill slot(s)`)}${r.gold >= 3 ? L(` · ยังมีเงิน ${r.gold}`, ` · ${r.gold} gold left`) : ''}</small>` : ''}${R.slotsFor(r.day) > R.slotsFor(r.day - 1) && r.day > 1 ? `<small class="slot-up">${L('วันนี้ได้ช่อง skill +1', 'New today: +1 skill slot')}</small>` : ''}</button>
    <button class="ghost" data-a="town" aria-label="${L('กลับเมือง', 'Back to town')}" title="${L('กลับเมือง', 'Back to town')}">🏠</button>
  </div>
  </div>`;
}

/**
 * The shop panel scrolls on its own (phones held sideways show one row of cards): while there is more below,
 * a "▼ more cards" tab sits at its bottom edge, so a cut-off card reads as "scroll", not as "that is all".
 */
function watchMoreBelow() {
  const sec = $panel.querySelector<HTMLElement>('.sv-shop');
  if (!sec) return;
  let tab = sec.querySelector<HTMLButtonElement>('.more-below');
  if (!tab) {
    tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'more-below';
    tab.dataset.sfx = 'none';
    tab.textContent = L('▼ การ์ดอีก', '▼ More');
    tab.addEventListener('click', () => sec.scrollBy({ top: sec.clientHeight * 0.8, behavior: 'smooth' }));
    // in the shop's header row, next to the reroll: never over a card's buy button
    (sec.querySelector('.sv-h') ?? sec).appendChild(tab);
  }
  const t = tab;
  const paint = () => t.classList.toggle('on', sec.scrollHeight - sec.scrollTop - sec.clientHeight > 24);
  sec.addEventListener('scroll', paint, { passive: true });
  paint();
}

/** "You still have gold": the buyable cards glow, the first scrolls into view, the fight button says press again. */
function nudgeBuy(idx: number[]) {
  const cards = idx.map((i) => $panel.querySelector<HTMLElement>(`.card.offer[data-tip="s:${i}"]`)).filter((c): c is HTMLElement => !!c);
  cards.forEach((c) => {
    c.classList.remove('nudge');
    void c.offsetWidth; // restart the animation
    c.classList.add('nudge');
  });
  // a line at the top of the shop (the fight button is too small on a phone held sideways to carry it)
  const shop = $panel.querySelector('.sv-shop .sv-h');
  if (shop && !$panel.querySelector('.nudge-note'))
    shop.insertAdjacentHTML('afterend', `<p class="tip-line nudge-note">🪙 ${L(`ยังมีเงิน ${run!.gold} ซื้อได้อีก ${idx.length} ใบ (ใบที่เรืองแสง) · กดสู้อีกครั้งถ้าจะสู้เลย`, `${run!.gold} gold left: ${idx.length} glowing card(s) you can buy · press Fight again to fight anyway`)}</p>`);
  $panel.querySelector('.sv-shop')?.scrollTo({ top: 0, behavior: 'smooth' });
  sfx('click', { force: true });
}

/** After a loss: the advised skills that are not in today's shop, with a nudge to reroll (none listed if all are there). */
function tipLineHTML(r: R.RunState) {
  if (!tipIds.length) return '';
  const missing = tipIds.filter((id) => SKILLS[id] && !r.shop.some((o) => o?.id === id));
  if (missing.length < tipIds.length) return ''; // at least one advised card is here, and it glows
  const nm = missing.slice(0, 2).map((id) => SKILLS[id].name).join(L(' หรือ ', ' or '));
  return `<p class="tip-line">💡 ${L(`ไฟต์ที่แล้วแนะนำ ${esc(nm)} แต่ร้านวันนี้ไม่มี · ลอง 🎲 สุ่มใหม่ หรืออัป skill ที่มีอยู่`, `Last fight suggested ${esc(nm)}, not in today's shop · try 🎲 reroll, or level up what you have`)}</p>`;
}

/** Give up the whole run. Shown in the top bar of the shop and during your own fights. */
function concedeHTML() {
  if (!run || run.phase === 'won' || run.phase === 'dead') return '';
  return confirmConcede
    ? `<span class="concede-box"><span class="concede-ask">${L('ยอมแพ้แล้วรอบนี้จะจบทันที แน่ใจไหม?', 'Giving up ends this run right away. Are you sure?')}</span>
       <button class="small danger" data-a="concedeYes">${L('ยืนยันยอมแพ้', 'Yes, give up')}</button>
       <button class="small ghost" data-a="concedeNo">${L('ไม่ เล่นต่อ', 'No, keep playing')}</button></span>`
    : `<button class="small concede-btn" data-a="concede">${L('🏳 ยอมแพ้', '🏳 Give up')}</button>`;
}

function renderFighting() {
  return `<div class="fightv">
  <div class="fv-arena">
    ${stageSlot(false, 'fv-slot')}
    <div class="fv-gloss glass info-det"><b class="fv-gh">${L('📖 คำศัพท์ในไฟต์', '📖 Fight words')}</b><p class="muted small glossary">${L(
    `<b>พลังโจมตี</b> = ดาเมจเพิ่มให้ทุกการโจมตีของทุก skill · <b>รวมพลัง</b> = การโจมตีครั้งถัดไป 1 ครั้งแรงขึ้น ·
    <b>หนาม</b> = สะท้อนดาเมจทุกครั้งที่โดนตี · <b>ใจเหล็ก</b> = โดนแช่แข็ง/ช้าน้อยลง 60% · <b>ไฟ</b> = เสียเลือดทุกวิ ไม่สนโล่ ·
    <b>แช่แข็ง</b> = skill ทุกตัวหยุดนับคูลดาวน์ · <b>ช้า</b> = คูลดาวน์ทุกตัวเดินช้าลง`,
    `<b>Power</b> = extra damage on every hit of every skill · <b>Charge</b> = the next hit is stronger ·
    <b>Thorns</b> = reflect damage each time you are hit · <b>Iron Will</b> = freeze/slow 60% weaker on you · <b>Burn</b> = lose HP every second, ignores shields ·
    <b>Freeze</b> = every skill stops counting its cooldown · <b>Slow</b> = every cooldown runs slower`,
  )}</p></div>
  </div>
  <aside class="fv-side glass">
  <p class="mm-versus"><span class="who s0">${esc(names[0])}</span> <span class="muted">vs</span> <span class="who s1">${esc(names[1])}</span> ${view === 'fighting' ? `<span class="stats-right">${concedeHTML()}</span>` : ''}</p>
  <div class="actions mm-speed">
    ${[1, 2, 4].map((s) => `<button class="small ${scene.speed === s ? 'on' : ''}" data-a="speed" data-i="${s}">${s}x</button>`).join('')}
    <button class="small" data-a="skip">${L('ข้าม ⏭', 'Skip ⏭')}</button>
  </div>
  <div id="fv-dots" class="fv-dots" aria-live="off"></div>
  <div class="fv-logh info-det">${L('📜 บันทึกการสู้ (ล่าสุดอยู่บน)', '📜 Fight log (newest on top)')}</div>
  <ol id="log" class="log info-det"></ol>
  <p class="fv-watch info-simp">${L('นั่งดูได้เลย skill ทำงานเอง ✨', 'Sit back: your skills fire on their own ✨')}</p>
  </aside>
  </div>`;
}

const fatigueLabel = (day: number) => {
  const s = (fatigueStart(day) / 10).toFixed(0);
  return L(`เหนื่อยล้า (หลัง ${s} วิ)`, `Fatigue (after ${s}s)`);
};

const PILES = (): { key: keyof BlockStat; name: string; unit: string; help: string }[] => [
  { key: 'd', name: L('ดาเมจ', 'Damage'), unit: '', help: L('ดาเมจที่แต่ละ skill ทำ (รวมส่วนที่โล่ศัตรูกันไว้)', 'Damage each skill dealt (including what enemy shields blocked)') },
  {
    key: 'bf', name: L('บัฟ', 'Buffs'), unit: '',
    help: L('ดาเมจที่บัฟของ skill นั้น (พลังโจมตี รวมพลัง) เพิ่มให้การโจมตีของทุก skill', 'Damage that the skill’s buffs (power, charge) added to the hits of every skill'),
  },
  { key: 'h', name: L('ฟื้นเลือด', 'Healing'), unit: '', help: L('เลือดที่ฟื้นได้จริง', 'HP actually restored') },
  { key: 'sh', name: L('โล่', 'Shield'), unit: '', help: L('โล่ที่ได้รับ', 'Shield gained') },
  { key: 'fz', name: L('แช่แข็ง', 'Freeze'), unit: L(' วิ', 's'), help: L('เวลาที่ศัตรูถูกแช่แข็ง', 'Time the enemy was frozen') },
];

const YOU = '#3987e5';
const FOE = '#d95926';

/**
 * Post-fight "You vs Enemy": mirrored bars per kind of value (you left, enemy right, same scale per row),
 * then where the damage each side took came from, as ranked bars. Hover any bar for the skills behind it.
 */
/** C6: explanation of the fight (headline, facts, why) from side `me`'s point of view. */
function explainHTML(r: CombatResult, x: Explanation, me: 0 | 1) {
  return explainView(x, r.winner === me);
}

function vsSummary(r: CombatResult, builds: [Build, Build], names2: [string, string]) {
  const fmt = (key: keyof BlockStat, v: number) => (key === 'fz' ? (v / 10).toFixed(1) : String(v));
  // damage per skill with thorns reflection split fairly (the sim credits it all to the oldest thorns stack)
  const dmg = [skillDamage(r, builds[0], 0), skillDamage(r, builds[1], 1)];
  const valOf = (side: 0 | 1, key: keyof BlockStat, i: number) => (key === 'd' ? dmg[side][i]?.total ?? 0 : r.stats[side][i]?.[key] ?? 0);
  const breakdown = (side: 0 | 1, key: keyof BlockStat) => {
    const list = (key === 'd' ? dmg[side].map((x) => ({ name: x.name, v: x.total })) : builds[side].skills
      .map((k, i) => ({ name: nodeOf(k).name, v: valOf(side, key, i) })))
      .filter((x) => x.v > 0)
      .sort((a, b) => b.v - a.v);
    return list.length
      ? list.map((x) => `<div class="tt-row"><span>${x.name}</span><b>${fmt(key, x.v)}</b></div>`).join('')
      : `<div class="muted">${L('ไม่มี', 'None')}</div>`;
  };
  const rows = PILES().map((pile) => {
    const tot = ([0, 1] as const).map((side) =>
      pile.key === 'd' ? dmg[side].reduce((n, x) => n + x.total, 0) : r.stats[side].reduce((n, st) => n + (st?.[pile.key] ?? 0), 0),
    );
    if (!tot[0] && !tot[1]) return '';
    const max = Math.max(tot[0], tot[1]);
    const half = (side: 0 | 1) => {
      const pct = max ? (tot[side] / max) * 100 : 0;
      const tip = `<div class="tt-h"><b>${esc(names2[side])}</b> · ${pile.name} ${fmt(pile.key, tot[side])}${pile.unit}</div><div class="muted small">${pile.help}</div>${breakdown(side, pile.key)}`;
      return `<div class="vs-half ${side ? 'r' : 'l'}" data-ttxt="${esc(tip)}">
        <span class="vs-n ${tot[side] > tot[1 - side] ? 'lead' : ''}">${fmt(pile.key, tot[side])}${pile.unit}</span>
        <div class="vs-track"><i style="width:${pct}%;background:${side ? FOE : YOU}"></i></div></div>`;
    };
    return `<div class="vs-row">${half(0)}<div class="vs-label">${pile.name}</div>${half(1)}</div>`;
  }).join('');

  // where the damage each side TOOK came from: the other side's skills (burn and thorns included) + fatigue
  const fatigue = [0, 0];
  for (const e of r.events) if (e.type === 'damage' && e.src === 'fatigue') fatigue[e.side] += e.amount + e.blocked;
  const tookFrom = (side: 0 | 1) => {
    const att = (1 - side) as 0 | 1;
    const list = dmg[att].map((x) => ({ name: x.name, v: x.total })).filter((x) => x.v > 0);
    if (fatigue[side]) list.push({ name: fatigueLabel(r.day), v: fatigue[side] });
    list.sort((a, b) => b.v - a.v);
    const total = list.reduce((n, x) => n + x.v, 0);
    if (!total) return `<p class="muted small">${L('ไม่โดนดาเมจเลย', 'Took no damage')}</p>`;
    const top = list.slice(0, 6);
    const rest = list.slice(6).reduce((n, x) => n + x.v, 0);
    if (rest) top.push({ name: L('อื่นๆ', 'Other'), v: rest });
    const color = att ? FOE : YOU;
    return top
      .map((x) => {
        const pct = Math.round((x.v / total) * 100);
        const fill = x.name === fatigueLabel(r.day) ? '#6b7480' : color;
        return `<div class="rank"><span class="rank-n">${x.name}</span>
          <div class="rank-track"><i style="width:${(x.v / top[0].v) * 100}%;background:${fill}"></i></div>
          <span class="rank-v">${x.v} <small class="muted">${pct}%</small></span></div>`;
      })
      .join('');
  };

  return `<div class="vs">
    <div class="vs-head"><span style="color:${YOU}">■</span> <b>${esc(names2[0])}</b><span class="muted">vs</span><b>${esc(names2[1])}</b> <span style="color:${FOE}">■</span></div>
    ${rows}
    <div class="two took">
      <div><h4>${L(`ดาเมจที่ ${esc(names2[0])} โดน มาจาก`, `Damage ${esc(names2[0])} took came from`)}</h4>${tookFrom(0)}</div>
      <div><h4>${L(`ดาเมจที่ ${esc(names2[1])} โดน มาจาก`, `Damage ${esc(names2[1])} took came from`)}</h4>${tookFrom(1)}</div>
    </div>
    <p class="muted small">${L('ชี้เมาส์ (หรือแตะ) ที่แถบเพื่อดูว่ามาจาก skill ไหน · ดาเมจรวมส่วนที่โล่กันไว้', 'Point at (or tap) a bar to see which skills it came from · damage includes what shields blocked')}</p>
    <details><summary>${L(`ดูราย skill ของ ${esc(names2[0])}`, `Per skill: ${esc(names2[0])}`)}</summary>${statsTable(builds[0], r.stats[0], dmg[0])}</details>
    <details><summary>${L(`ดูราย skill ของ ${esc(names2[1])}`, `Per skill: ${esc(names2[1])}`)}</summary>${statsTable(builds[1], r.stats[1], dmg[1])}</details>
  </div>`;
}

/** Per-skill breakdown table (the table view of the summary). */
function statsTable(b: Build, stats0: BlockStat[], dmg: ReturnType<typeof skillDamage>) {
  // damage column = own hits + burn + a fair share of thorns reflection
  const stats = stats0.map((st, i) => (st ? { ...st, d: dmg[i]?.total ?? st.d } : st));
  const rows = b.skills.map((k, i) => ({ k, st: stats[i] })).filter((x) => x.st);
  const total = rows.reduce((n, x) => n + x.st.d, 0);
  const has = (key: keyof BlockStat) => rows.some((x) => x.st[key] > 0);
  rows.sort((p, q) => q.st.d - p.st.d || q.st.h + q.st.sh - (p.st.h + p.st.sh));
  const top = rows[0];
  const headline =
    top && total > 0
      ? L(
          `<p class="statline"><b>${nodeOf(top.k).name}</b> ทำดาเมจ <b>${Math.round((top.st.d / total) * 100)}%</b> ของทั้งหมด (${top.st.d} จาก ${total})</p>`,
          `<p class="statline"><b>${nodeOf(top.k).name}</b> dealt <b>${Math.round((top.st.d / total) * 100)}%</b> of all damage (${top.st.d} of ${total})</p>`,
        )
      : `<p class="statline muted">${L('ยังไม่ได้ทำดาเมจเลย', 'No damage dealt yet')}</p>`;
  const body = rows
    .map(({ k, st }) => {
      const pct = total ? Math.round((st.d / total) * 100) : 0;
      return `<tr>
        <td class="sk"><span>${nodeOf(k).name} <small>Lv${lvOf(k.v)}</small></span></td>
        <td>${st.c}${st.tc ? ` <small class="muted">+${st.tc} ${L('ต่อ', 'set off')}</small>` : ''}</td>
        <td class="dmg"><div class="bar"><i style="width:${pct}%"></i></div><span>${st.d}</span> <small class="muted">${pct}%</small></td>
        ${has('bd') ? `<td>${st.bd || '·'}</td>` : ''}
        ${has('bf') ? `<td>${st.bf || '·'}</td>` : ''}
        ${has('h') ? `<td>${st.h || '·'}</td>` : ''}
        ${has('sh') ? `<td>${st.sh || '·'}</td>` : ''}
        ${has('fz') ? `<td>${st.fz ? (st.fz / 10).toFixed(1) + L(' วิ', 's') : '·'}</td>` : ''}
      </tr>`;
    })
    .join('');
  return `${headline}<div class="statwrap"><table class="stats-t">
    <tr><th>skill</th><th>${L('ใช้', 'Uses')}</th><th>${L('ดาเมจ', 'Damage')}</th>
      ${has('bd') ? `<th>${L('จากโบนัส🔗', 'From bonus🔗')}</th>` : ''}${has('bf') ? `<th>${L('บัฟเพิ่มดาเมจ', 'Buff damage')}</th>` : ''}${has('h') ? `<th>${L('ฟื้นเลือด', 'Healing')}</th>` : ''}${has('sh') ? `<th>${L('โล่', 'Shield')}</th>` : ''}${has('fz') ? `<th>${L('แช่แข็ง', 'Freeze')}</th>` : ''}</tr>
    ${body}</table></div>`;
}

/** Reward for a finished run from the server (asked once per run), plus the local history entry. */
function claimReward(r: R.RunState) {
  if (claimAsked.has(r.id) || M.claimed(r.id)) return;
  claimAsked.add(r.id);
  pendingClaim.add(r.id);
  const best = M.bestNote(r.id);
  const summary: M.RunSummary = {
    runId: r.id, hero: r.hero, wins: r.wins, losses: r.losses, days: r.log.length, conceded: !!r.conceded, at: Date.now(),
    bestFightId: best?.fightId, bestText: best?.text, bestTextEn: best?.textEn,
  };
  M.saveLocalRun(summary);
  void M.finishRun({
    runId: r.id, playerId: M.playerId(), name: playerName(), hero: r.hero, wins: r.wins, losses: r.losses, day: r.day,
    rating: r.rating, conceded: !!r.conceded, won: r.phase === 'won', build: R.toBuild(r),
  }).then((res) => {
    pendingClaim.delete(r.id);
    if (res) {
      // the stardust sound plays when the reveal shows the reward (runEndFx)
      M.rememberClaim(r.id, res);
      M.saveLocalRun({ ...summary, stardust: res.stardust });
    }
    if (view === 'over') render();
  });
}

/**
 * Remember the memorable bits of a fight of this run (end-of-run page, local history).
 * The line is stored in Thai and English, so switching language later still shows it right.
 */
function noteFight(r: R.RunState, f: FightResponse, build: Build, day: number) {
  const line = () => {
    const nm = namesFn();
    const x = explain(f.result, [build, f.opponent.build], 0, nm, { drawIsLoss: true });
    const m = x.moments.find((y) => y.kind === 'comeback') ?? x.moments.find((y) => y.kind === 'hit');
    const text = L(
      `${f.won ? 'ชนะ' : 'แพ้'} ${nm[1]}${x.close ? ' แบบสูสี' : ''}${m ? ` · ${m.title} ${m.text}` : ''}`,
      `${f.won ? 'Beat' : 'Lost to'} ${nm[1]}${x.close ? ' in a close fight' : ''}${m ? ` · ${m.title} ${m.text}` : ''}`,
    );
    return { x, text };
  };
  const th = withLang('th', line);
  const en = withLang('en', line);
  const x = th.x;
  const comeback = x.moments.some((y) => y.kind === 'comeback' && y.side === 0);
  lastClose = x.close;
  const score = (f.won ? 50 : 0) + (x.close ? 30 : 0) + (comeback ? 40 : 0) + day;
  // the end-of-run screen: your biggest hit (records) and, for a loss, the main reason + what to try
  const refl = reflectEvents(f.result.events);
  let hit = 0;
  for (const e of f.result.events)
    if (e.type === 'damage' && e.side === 1 && e.src !== 'burn' && e.src !== 'fatigue' && !refl.has(e)) hit = Math.max(hit, e.amount + e.blocked);
  const split = (s?: string) => {
    const k = s ? s.indexOf(' → ') : -1;
    return k < 0 ? [s, undefined] : [s!.slice(0, k), s!.slice(k + 3)];
  };
  const [why, tip] = f.won ? [] : split(th.x.reasons[0]);
  const [whyEn, tipEn] = f.won ? [] : split(en.x.reasons[0]);
  M.addFightNote(r.id, {
    day, won: f.won, opp: f.opponent.name, fightId: f.fightId, close: x.close, score, text: th.text, textEn: en.text, hit,
    ...(why ? { why, whyEn, tip, tipEn } : {}),
  });
}

function renderResult() {
  const f = last!;
  const r = run!;
  const link = f.fightId ? `${location.origin}${location.pathname}?replay=${f.fightId}` : '';
  const oname = names[1];
  const x = lastBuild ? explain(f.result, [lastBuild, f.opponent.build], 0, [youName(), oname], { drawIsLoss: true }) : null;
  const draw = f.result.winner === -1;
  tipIds = !f.won && x ? x.suggest : [];
  return `<div class="resv">
  <div class="rv-side">
  ${stageSlot(false, 'rv-slot')}
  <div class="mm-result ${f.won ? 'won' : 'lost'}">
    <h2 class="${f.won ? 'win' : 'lose'}">${f.won ? L('ชนะ', 'Victory') : draw ? L('เสมอ (นับเป็นแพ้)', 'Draw (counts as a loss)') : L('แพ้', 'Defeat')} · ${L('วันที่', 'day')} ${lastDay}${x?.close ? ` <span class="mm-tag close">${L('สูสี!', 'Close!')}</span>` : ''}</h2>
    <p>${L('คู่ต่อสู้', 'Opponent')}: <b class="who s1">${esc(oname)}</b> · ${HEROES_BY_ID[f.opponent.build.hero].name}
     ${f.offline ? `<span class="muted">${L('(ออฟไลน์: เซิร์ฟเวอร์ไม่ตอบ สู้กับ AI ในเครื่อง)', '(offline: the server did not answer, so you fought a local AI)')}</span>` : ''}</p>
    <p class="info-det">${f.won ? L(`ชนะแล้ว ${r.wins}/${R.WIN_TARGET}`, `Wins: ${r.wins}/${R.WIN_TARGET}`) : L(`เสียเลือด ${lastDamage} · เหลือ ${Math.max(0, r.hp)}`, `Lost ${lastDamage} HP · ${Math.max(0, r.hp)} left`)} · ${L('คะแนน build ใหม่', 'new build rating')} ${f.rating}</p>
    ${f.won ? '' : `<p class="rv-hearts info-simp" aria-label="${L(`หัวใจของรอบ เหลือ ${Math.max(0, r.hp)} จาก ${R.START_HP}`, `Run hearts: ${Math.max(0, r.hp)} of ${R.START_HP} left`)}"><span class="rvh-h">❤</span> <s>${Math.max(0, r.hp) + lastDamage}</s> → <b>${Math.max(0, r.hp)}</b><small>${L(`หัวใจของทั้งรอบ (คนละอันกับเลือดในไฟต์) · หมดเมื่อไรจบรอบ`, `hearts for the whole run (not the fight's HP bar) · the run ends at 0`)}</small></p>`}
  ${f.won ? winRewardHTML(r) : ''}
  ${revealHTML()}
  </div>
  <div class="actions rv-actions"><button class="primary" data-a="next">${L('ต่อไป ▶', 'Continue ▶')}</button>${x && !x.close ? `<button data-a="rewatch">${L('▶ ดูไฟต์นี้อีกครั้ง', '▶ Watch this fight again')}</button>` : ''}</div>
  </div>
  <div class="rv-main glass">
  <div class="rv-more">${x ? P.fightHighlights(x, { replayAction: 'rewatch' }) : ''}</div>
  <h3>${L('สรุปการสู้', 'Fight summary')}</h3>
  ${x ? explainHTML(f.result, x, 0) : ''}
  <button class="ghost rv-more-btn info-simp" data-a="more">${L('ดูสถิติทั้งหมด ▾', 'All the numbers ▾')}</button>
  <div class="rv-more">
  ${lastBuild ? vsSummary(f.result, [lastBuild, f.opponent.build], [youName(), oname]) : ''}
  <h3>${L(`build ของ ${esc(oname)}`, `Build of ${esc(oname)}`)}</h3>
  ${buildList(f.opponent.build)}
  ${link ? `<p class="muted">${L('ลิงก์ replay:', 'Replay link:')} <input class="link" readonly value="${esc(link)}" onclick="this.select()"></p>` : ''}
  </div>
  </div>
  </div>`;
}

/** The prize strip on a won fight: this win's star landing in the 10-star row, tomorrow's coins, the streak,
 * and how far the crown is. Animated once (CSS), with confetti from the card. */
function winRewardHTML(r: R.RunState) {
  const inc = R.incomeFor(r.day, r.streak, r.hero);
  const left = Math.max(0, R.WIN_TARGET - r.wins);
  const stars = Array.from({ length: R.WIN_TARGET }, (_, i) =>
    `<i class="wr-star${i < r.wins ? ' on' : ''}${i === r.wins - 1 ? ' new' : ''}" style="--i:${i}"></i>`).join('');
  const bits = Array.from({ length: 18 }, (_, i) => `<b class="wr-bit" style="--i:${i}"></b>`).join('');
  return `<div class="win-reward" role="status">
    <div class="wr-burst" aria-hidden="true">${bits}</div>
    <div class="wr-title">🏆 ${L(`ชนะครั้งที่ ${r.wins}!`, `Win #${r.wins}!`)}</div>
    <div class="wr-stars" aria-label="${r.wins}/${R.WIN_TARGET}">${stars}</div>
    <div class="wr-row">
      <span class="wr-chip wr-gold">🪙 ${L('พรุ่งนี้ได้', 'Tomorrow')} <b>+${inc.base + inc.bonus}</b>${inc.bonus ? ` <small>(${L('โบนัสชนะติด', 'streak bonus')} +${inc.bonus})</small>` : ''}</span>
      ${r.streak >= 2 ? `<span class="wr-chip wr-streak">🔥 ${L(`ชนะติด ${r.streak}`, `${r.streak} in a row`)}</span>` : ''}
      <span class="wr-chip wr-crown">👑 ${left ? L(`อีก ${left} ชนะ ได้มงกุฎ`, `${left} more for the crown`) : L('ได้มงกุฎ!', 'Crown!')}</span>
    </div>
  </div>`;
}

/** Awaken: how many skills it would level up. */
function awakenCount() {
  const n = R.awakenPreview(run!).filter(Boolean).length;
  return n ? L(`อัป ${n} ใบ`, `${n} skill${n > 1 ? 's' : ''} up`) : L('ไม่มี Lv1 ให้อัป', 'no Lv1 skill to level');
}

/** Last chance: your skills under the three powers, showing what each power would do to them. Pointing at (or focusing)
 * a power highlights its part (data-show on .lc-build, set in onLcHover). */
function lcBuild() {
  const r = run!;
  const up = R.awakenPreview(r);
  const rows = r.skills
    .map((k, i) => {
      const t = bonusTotals(r.skills, i);
      const v = up[i];
      const next = v ? { ...k, v } : null;
      const aw = next
        ? `<span class="lc-fx lc-awaken">▲ ${L('ตื่นพลัง', 'Awaken')} → <b>${nodeOf(next).name} Lv2</b> ${chipsHTML(next)}</span>`
        : `<span class="lc-fx lc-awaken lc-same">${L('ตื่นพลัง: เลเวลสูงแล้ว ไม่เปลี่ยน', 'Awaken: already Lv2+, no change')}</span>`;
      const mk = `<span class="lc-fx lc-mark">✦ ${k.mark ? L(`มีตรา ${R.MARK_INFO[k.mark].name} แล้ว (ใส่ใหม่จะแทน)`, `has ${R.MARK_INFO[k.mark].name} (a new mark replaces it)`) : L('ใส่ตราวิญญาณได้', 'can take the Spirit Mark')}</span>`;
      return `<li class="line-${SKILLS[k.id].line}${v ? ' will-up' : ''}"><img class="skill-icon" src="${skillIcon(k.id)}" alt=""><div class="sk-text">${skillLine(k, t.on, t.haste)}${aw}${mk}</div></li>`;
    })
    .join('');
  const supply = `<li class="lc-fx lc-supply lc-slot">＋ ${L('ช่อง skill ใหม่ (ถาวร) และเงิน +8 ไว้ซื้อของวันพรุ่งนี้', 'A new skill slot (for good) and +8 gold for tomorrow')}</li>`;
  return `<div class="lc-build" data-show="awaken">
    <h3>${L('skill ของคุณ', 'Your skills')} <small class="muted">${L('ชี้ที่พลังด้านบนเพื่อดูว่าจะเปลี่ยนอะไร', 'point at a power above to see what it changes')}</small></h3>
    <ol class="build readonly lc-list">${rows}${supply}</ol>
  </div>`;
}

/** Hover / focus on a last-chance power: show its effect on the skill list. */
function onLcHover(ev: Event) {
  if (view !== 'lastchance') return;
  const b = (ev.target as Element).closest?.<HTMLElement>('[data-a="lc"]');
  const box = $panel.querySelector<HTMLElement>('.lc-build');
  if (b && box && box.dataset.show !== b.dataset.i) box.dataset.show = b.dataset.i!;
}

function renderLastChance() {
  scene.idle(run!.hero, R.lookOf(run!));
  const r = run!;
  // when each power is good, with this build's numbers; the best fit gets a badge
  const lv1 = r.skills.filter((k) => k.v === '').length;
  const lv3 = r.skills.filter((k) => lvOf(k.v) >= R.MAX_LV).length;
  const full = R.slotsOf(r) >= R.MAX_SLOTS;
  const best = lv1 >= 2 ? 'awaken' : lv3 >= 2 && !r.skills.some((k) => k.mark || k.markHidden) ? 'mark' : 'supply';
  const when = {
    awaken: L(`ดีเมื่อมี skill Lv1 หลายตัว · คุณมี <b>${lv1}</b>`, `Best with many Lv1 skills · you have <b>${lv1}</b>`),
    mark: L(`ดีเมื่อ skill หลักเป็น Lv3 แล้ว · คุณมี Lv3 <b>${lv3}</b> ตัว`, `Best once your main skills are Lv3 · you have <b>${lv3}</b> at Lv3`),
    supply: full ? L(`ดีเมื่อมีของอยากซื้อ · ได้เงิน <b>${R.SUPPLY_GOLD_FULL}</b>`, `Best when you have things to buy · <b>${R.SUPPLY_GOLD_FULL}</b> gold`) : L(`ดีเมื่อมีของอยากซื้อและอยากได้ช่องเพิ่ม · ช่องตอนนี้ <b>${R.slotsOf(r)}/${R.MAX_SLOTS}</b>`, `Best when you want to buy more and need a slot · slots now <b>${R.slotsOf(r)}/${R.MAX_SLOTS}</b>`),
  };
  const tag = (k: 'awaken' | 'mark' | 'supply') => (k === best ? `<span class="lc-badge">${L('เหมาะกับคุณ', 'Fits you')}</span>` : '');
  return `<div class="lay">
  <div class="lay-side">${stageSlot(true)}</div>
  <section class="lay-main glass">
  <h2 class="lose">${L('เลือดหมด… แต่ยังไม่จบ', 'Out of HP… but not out yet')}</h2>
  <p>${L(
    'คุณเข้าสู่สถานะ <b>กึ่งวิญญาณ</b>: กลับมาด้วยเลือด 1 แพ้อีกครั้งคือจบรอบ เลือกพลังหนึ่งอย่าง',
    'You become a <b>half-spirit</b>: you come back with 1 HP, and one more loss ends the run. Pick one power',
  )}</p>
  <div class="heroes">
    <button class="hero${best === 'awaken' ? ' lc-best' : ''}" data-a="lc" data-i="awaken">${tag('awaken')}<b>${L('ตื่นพลัง', 'Awaken')}</b><span class="lc-count">${awakenCount()}</span><span>${L('skill Lv1 ทุกใบขึ้นเป็น Lv2 (สุ่มทาง A หรือ B)', 'Every Lv1 skill becomes Lv2 (random branch A or B)')}</span><span class="lc-when">${when.awaken}</span></button>
    <button class="hero${best === 'mark' ? ' lc-best' : ''}" data-a="lc" data-i="mark">${tag('mark')}<b>${L('ตราวิญญาณ', 'Spirit Mark')}</b><span>${L('สุ่มตราหนึ่งในสี่แบบ แล้วเลือกใส่ skill', 'Get 1 of 4 random marks, then pick a skill for it')}</span><span class="lc-when">${when.mark}</span></button>
    <button class="hero${best === 'supply' ? ' lc-best' : ''}" data-a="lc" data-i="supply">${tag('supply')}<b>${L('เสบียงสุดท้าย', 'Last Supplies')}</b><span>${R.slotsOf(run!) >= R.MAX_SLOTS ? L(`ช่อง skill เต็ม ${R.MAX_SLOTS} แล้ว: ได้เงิน ${R.SUPPLY_GOLD_FULL} แทน`, `Slots are full (${R.MAX_SLOTS}): ${R.SUPPLY_GOLD_FULL} gold instead`) : L('เงิน 8 และช่อง skill +1 ถาวร', '8 gold and +1 skill slot for good')}</span><span class="lc-when">${when.supply}</span></button>
  </div>
  ${lcBuild()}
  </section>
  </div>`;
}

function renderMark() {
  const r = run!;
  // a ranked run's last-chance mark is hidden: the server reveals its kind in the next fight (sim v20)
  const m = r.pendingHidden
    ? { name: L('ตราลึกลับ', 'Hidden mark'), desc: L('ทำงานทันที ชนิดจะเปิดหลังสู้ครั้งถัดไป', 'it works right away; its kind is revealed after your next fight') }
    : R.MARK_INFO[r.pendingMark!];
  scene.idle(r.hero, R.lookOf(r));
  return `<div class="lay">
  <div class="lay-side">${stageSlot(true)}</div>
  <section class="lay-main glass">
  <h2>${L('ได้ตรา', 'New mark')}: ${m.name}</h2>
  <p>${m.desc} · ${L('เลือก skill ที่จะใส่ตรา', 'pick the skill that gets the mark')} ${D.markCountHTML(r.skills, r.wishMarks ?? 0)}</p>
  <ol class="build lc-list mark-list">${r.skills
    .map((k, i) => {
      const t = bonusTotals(r.skills, i);
      const repl = k.mark && k.mark !== r.pendingMark ? `<span class="lc-fx lc-warn">${L('แทนตราเดิม', 'replaces')} ${R.MARK_INFO[k.mark].name}</span>` : '';
      return `<li class="line-${SKILLS[k.id].line}"><img class="skill-icon" src="${skillIcon(k.id)}" alt=""><div class="sk-text">${skillLine(k, t.on, t.haste)}
        <span class="lc-fx lc-mark">✦ ${m.name}: ${m.desc}</span>${repl}</div>
        <span class="btns"><button class="primary" data-a="mark" data-i="${i}">${L('ใส่ตรานี้', 'Mark this')}</button></span></li>`;
    })
    .join('')}</ol>
  <div class="actions"><button class="ghost" data-a="mark" data-i="-1">${L('ไม่ใส่', 'Skip')}</button></div>
  </section>
  </div>`;
}

function renderOver() {
  const r = run!;
  scene.idle(r.hero, R.lookOf(r));
  const won = r.phase === 'won';
  const notes = M.fightNotes(r.id);
  const stats: RC.RunStats = {
    runId: r.id, hero: r.hero, wins: r.wins, losses: r.losses, won,
    streak: RC.bestStreakOf(r.log), hit: Math.max(0, ...notes.map((n) => n.hit ?? 0)),
  };
  const recap = RC.recapFor(stats); // before claimReward: the local history must not count this run yet
  claimReward(r);
  const c = M.claimed(r.id);
  const reward = pendingClaim.has(r.id) ? undefined : c && 'stardust' in c ? c : null;
  const plan = RC.revealPlan(won, r.wins);
  const clock = RF.clock(r.id, plan, r.wins);
  const rewardAt = RF.rewardAt(r.id, reward !== undefined, !!reward && reward.stardust > 0);
  const total = reward?.total ?? (reward === undefined ? null : M.localHistory().reduce((n, x) => n + (x.stardust ?? 0), 0) || null);
  const lastLog = r.log.at(-1);
  const lastNote = lastLog ? notes.find((n) => n.day === lastLog.day) : undefined;
  const en = getLang() === 'en';
  const ended = !won && !r.conceded && lastLog && !lastLog.won
    ? { day: lastLog.day, close: !!lastNote?.close, why: (en ? lastNote?.whyEn : undefined) ?? lastNote?.why, tip: (en ? lastNote?.tipEn : undefined) ?? lastNote?.tip }
    : null;
  // the next run's heroes (the same offer the hero-pick screen shows): one tap starts it
  const offered = C.chainOn() ? chainChoices ?? [] : R.heroChoices((nextSeed ??= randSeed()));
  const quick: P.QuickHero[] = offered
    .map((id) => ({ id, name: HEROES_BY_ID[id].name, art: heroArt(id, 'tiny', offerLook(id)), tag: (id === r.hero ? 'again' : recap.cur.heroes.includes(id) ? '' : 'new') as P.QuickHero['tag'] }))
    .sort((a, b) => Number(b.tag === 'again') - Number(a.tag === 'again'));
  return stageSlot(true, 'over-slot bleed') + P.runOverPage({
    won, conceded: !!r.conceded, hero: r.hero, heroArt: heroArt(r.hero, '', R.lookOf(r)), wins: r.wins, losses: r.losses,
    winTarget: R.WIN_TARGET, days: r.log.length, rating: r.rating, streak: stats.streak, buildHTML: buildCardBlock(r),
    historyHTML: P.historyList(r.log, notes), best: M.bestNote(r.id), reward, total, recap,
    fresh: RC.freshRecords(stats, recap, reward?.bestWins), goal: RC.nextGoal(stats, recap, R.WIN_TARGET), ended, quick,
    plan, el: clock.el, on: clock.on, rewardAt,
  });
}

/** The Build Card on the run-end screen (every finished run), with its "save image" button and the full list below. */
function buildCardBlock(r: R.RunState) {
  const card = D.buildCardHTML({
    hero: r.hero, heroArt: heroArt(r.hero, '', R.lookOf(r)), player: displayName(M.serverName() ?? playerName()), won: r.phase === 'won',
    wins: r.wins, losses: r.losses, winTarget: R.WIN_TARGET, skills: r.skills, relics: r.relics ?? [], log: r.log, rating: r.rating,
  });
  return `<div class="bc-wrap">${card}<div class="actions"><button data-a="saveBuild">${L('บันทึกการ์ด build เป็นรูป', 'Save the build card as an image')}</button></div>
    <details class="bc-list"><summary>${L('ดูรายละเอียดทุก skill', 'Every skill in detail')}</summary>${buildList(R.toBuild(r))}</details></div>`;
}
/** the Build Card as data for the PNG (shareCard.ts) */
function buildCardImage(r: R.RunState): BuildCardImage {
  const h = HEROES_BY_ID[r.hero];
  const lv = ultLevel(R.toBuild(r));
  const glyph: Record<string, string> = { burn: '✹', echo: '↻', quick: '»', steadfast: '⛨' };
  return {
    runId: r.id, heroSvg: renderChibi(rollLook(r.hero, R.lookOf(r))), heroName: h.name,
    heroLine: `${LINE_NAME[h.line]} · ★ ${h.ult.name} ${lv ? `Lv${lv}` : L('ล็อก', 'locked')}`,
    player: displayName(M.serverName() ?? playerName()), won: r.phase === 'won', wins: r.wins, losses: r.losses,
    skills: r.skills.map((k) => {
      const rar = rarityOf(k.id, k.v);
      const style = k.v ? SKILLS[k.id].tree[k.v[0] as 'a'].style ?? '' : '';
      return {
        id: k.id, name: nodeOf(k).name, rarity: rar, star: k.star ?? 0,
        meta: `Lv${lvOf(k.v)}${style ? ` · ${style}` : ''}${rar !== 'common' ? ` · ${D.rarityName(rar)}` : ''}`,
        mark: k.mark ? `${glyph[k.mark]} ${R.MARK_INFO[k.mark].name}` : k.markHidden ? `? ${L('ตราลึกลับ', 'hidden mark')}` : '',
      };
    }),
    relics: (r.relics ?? []).map((id) => `${RELICS_BY_ID[id]?.icon ?? ''} ${D.relicName(id)}`),
    log: r.log.map((x) => (x.won ? 'w' : x.draw ? 'd' : 'l')),
    title: L('Mochi Moon · การ์ด build', 'Mochi Moon · Build card'),
    summary: L(`★ ${r.skills.reduce((n, k) => n + (k.star ?? 0), 0)} · ◆ ${r.skills.filter((k) => rarityOf(k.id, k.v) === 'epic').length} · ตรา ${r.skills.filter((k) => k.mark || k.markHidden).length}`, `★ ${r.skills.reduce((n, k) => n + (k.star ?? 0), 0)} · ◆ ${r.skills.filter((k) => rarityOf(k.id, k.v) === 'epic').length} · marks ${r.skills.filter((k) => k.mark || k.markHidden).length}`),
    footer: `${location.host} · ${new Date().toLocaleDateString(getLang() === 'en' ? 'en-GB' : 'th-TH')}`,
  };
}

/** Share card of the crowned run on screen. */
function cardData(r: R.RunState): CardData {
  const flawless = r.losses === 0;
  return {
    runId: r.id, heroSvg: renderChibi(rollLook(r.hero, R.lookOf(r))), heroName: HEROES_BY_ID[r.hero].name,
    player: displayName(M.serverName() ?? playerName()), wins: r.wins, losses: r.losses, winTarget: R.WIN_TARGET,
    streak: RC.bestStreakOf(r.log), skills: r.skills.map((k) => k.id), stars: r.skills.map((k) => k.star ?? 0),
    relics: (r.relics ?? []).map((id) => `${RELICS_BY_ID[id]?.icon ?? ''} ${L(RELICS_BY_ID[id]?.name[0] ?? id, RELICS_BY_ID[id]?.name[1] ?? id)}`),
    title: flawless ? L('มงกุฎไร้พ่าย!', 'Flawless crown!') : L('มงกุฎดวงจันทร์!', 'Moon crown!'),
    sub: L(`ชนะครบ ${R.WIN_TARGET} ในสนามดวงจันทร์`, `All ${R.WIN_TARGET} wins in the moon arena`),
    recordLine: L(`ชนะ ${r.wins} · แพ้ ${r.losses} · ชนะติด ${RC.bestStreakOf(r.log)}`, `${r.wins} wins · ${r.losses} losses · best streak ${RC.bestStreakOf(r.log)}`),
    footer: `${location.host} · ${new Date().toLocaleDateString(getLang() === 'en' ? 'en-GB' : 'th-TH')}`,
  };
}

let overFocused = '';
/** After the end screen renders: count-ups, the share card, focus on "Play again" once the reveal is over. */
function overAfterRender() {
  const r = run;
  if (!r) return;
  askAfterRun({ runId: r.id, hero: r.hero, wins: r.wins }, () => RF.revealing());
  RF.countUps($panel, () => {
    if (overFocused === r.id) return;
    overFocused = r.id;
    const b = $panel.querySelector<HTMLButtonElement>('.re-again');
    if (b && !document.activeElement?.closest('#panel button, #panel a, input')) b.focus({ preventScroll: true });
  });
  const slot = $panel.querySelector<HTMLElement>('[data-card]');
  if (slot && r.phase === 'won') {
    const d = cardData(r);
    const key = d.runId + d.title;
    void cardBlob(d).then((b) => {
      const el = $panel.querySelector<HTMLElement>('[data-card]');
      if (!el) return;
      if (!b) {
        el.remove();
        return;
      }
      if (!cardURLs.has(key)) cardURLs.set(key, URL.createObjectURL(b));
      const img = document.createElement('img');
      img.src = cardURLs.get(key)!;
      img.alt = L('การ์ดมงกุฎของคุณ', 'Your crown card');
      img.width = 1200;
      img.height = 675;
      el.replaceChildren(img);
    });
  }
}
/** object URLs of drawn share cards (per run and language) */
const cardURLs = new Map<string, string>();

/** End screen: skip the reveal, or start the next run (Enter / R). */
function overKey(e: KeyboardEvent) {
  if (view !== 'over' || !run || treeOpen) return;
  const t = e.target as HTMLElement | null;
  if (t?.closest('input, textarea, select')) return;
  const onControl = !!t?.closest('button, a, summary');
  if (RF.revealing() && (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape')) {
    e.preventDefault();
    RF.skip();
    render();
    return;
  }
  if ((e.key === 'Enter' && !onControl) || ((e.key === 'r' || e.key === 'R') && !e.ctrlKey && !e.metaKey && !e.altKey)) {
    e.preventDefault();
    playAgain();
  }
}
function playAgain() {
  if (run && (run.phase === 'won' || run.phase === 'dead')) run = null;
  view = 'title';
  saveRun();
  render();
}

/** Display names of a replay: "คุณ" (you) for your own fights, and never two identical names. */
function replayNames(f: ReplayRecord): [string, string] {
  const mine = !!run?.log.some((l) => l.fightId === f.id) || M.localHistory().some((h) => h.bestFightId === f.id);
  const a = mine ? youName() : displayName(f.a.name || 'ผู้เล่น');
  const b = oppLabel({ name: f.b.name, ai: f.b.ai, tier: (f.b as { tier?: unknown }).tier });
  return b === a ? [`${a} ${L('(ซ้าย)', '(left)')}`, `${b} ${L('(ขวา)', '(right)')}`] : [a, b];
}

function renderReplayDone() {
  const f = replay!;
  const x = replayResult ? explain(replayResult, [f.a.build, f.b.build], 0, names) : null;
  return `<div class="resv">
  <div class="rv-side">
  ${stageSlot(false, 'rv-slot')}
  <div class="mm-result"><h2>${L('Replay วันที่', 'Replay: day')} ${f.day}${x?.close ? ` <span class="mm-tag close">${L('สูสี!', 'Close!')}</span>` : ''}</h2>
  <p><span class="who s0">${esc(names[0])}</span> <span class="muted">vs</span> <span class="who s1">${esc(names[1])}</span></p></div>
  <div class="actions rv-actions"><button data-a="replayAgain">${L('▶ ดูอีกครั้ง', '▶ Watch again')}</button><button class="primary" data-a="leaveReplay">${L('เล่นเกมของคุณ', 'Play your own game')}</button></div>
  </div>
  <div class="rv-main glass">
  ${x ? P.fightHighlights(x) : ''}
  <h3>${L('สรุปการสู้', 'Fight summary')}</h3>
  ${replayResult && x ? explainHTML(replayResult, x, 0) : ''}
  ${replayResult ? vsSummary(replayResult, [f.a.build, f.b.build], names) : ''}
  <div class="two">
    <div><h3><span class="who s0">${esc(names[0])}</span> · ${HEROES_BY_ID[f.a.build.hero].name}</h3>${buildList(f.a.build)}</div>
    <div><h3><span class="who s1">${esc(names[1])}</span> · ${HEROES_BY_ID[f.b.build.hero].name}</h3>${buildList(f.b.build)}</div>
  </div>
  </div>
  </div>`;
}

function renderProfile() {
  if (!profileData && !profileLoading) {
    profileLoading = true;
    void M.getProfile(M.playerId()).then((p) => {
      profileLoading = false;
      // the server may not have profiles yet: fall back to this browser's finished runs
      profileData = p && (p.runs || p.last.length) ? p : M.localProfile();
      if (p && !p.runs && !p.last.length) profileData.name = p.name;
      if (view === 'profile') render();
    });
  }
  return P.profilePage(profileData, M.serverName() ?? playerName(), profileLoading);
}

function renderLeaderboard() {
  if (!lbData && !lbLoading) {
    lbLoading = true;
    const period = lbPeriod;
    void M.getLeaderboard(period).then((lb) => {
      if (period !== lbPeriod) return;
      lbLoading = false;
      lbData = lb ?? { entries: [] };
      if (view === 'leaderboard') render();
    });
  }
  return P.leaderboardPage(lbPeriod, lbData && lbData.entries.length ? lbData : null, lbLoading, M.localHistory());
}

/** Today's-arena scouting chip, placed above the fight button of the shop (the shop itself is not touched). */
function mountScout() {
  const r = run;
  const btn = $panel.querySelector('[data-a="fight"]');
  const row = btn?.closest('.actions');
  let slot = $panel.querySelector<HTMLElement>('.sv-scout');
  if (!r || (!row && !slot)) return;
  if (!slot) {
    slot = document.createElement('div');
    slot.className = 'mm-scout-slot';
    row!.before(slot);
  }
  const box = slot;
  const day = r.day;
  void M.scout(day, r.rating, r.id).then((s) => {
    if (view === 'shop' && run?.day === day && box.isConnected) box.innerHTML = P.scoutChip(s, day);
  });
}

// ---------- combat log ----------
/** builds of the fight on screen [left, right] (for skill variant names in the log) */
let logBuilds: [Build, Build] | null = null;
/** start a new combat log: remember the builds and which damage events are thorns reflections */
function beginLog(result: CombatResult, builds: [Build, Build]) {
  logBuilds = builds;
  logRefl = reflectEvents(result.events);
  logHist = [];
  dots = [{ burn: 0, poison: 0 }, { burn: 0, poison: 0 }];
  paintDots();
}
/** burn / poison damage each side has dealt so far in the fight on screen */
let dots = [{ burn: 0, poison: 0 }, { burn: 0, poison: 0 }];
function paintDots() {
  const el = document.getElementById('fv-dots');
  if (!el) return;
  el.innerHTML = ([0, 1] as const)
    .map((s) => {
      const d = dots[s];
      const parts = [d.burn ? `🔥 ${d.burn}` : '', d.poison ? `☠ ${d.poison}` : ''].filter(Boolean).join(' · ');
      return parts ? `<span class="s${s}" title="${esc(L('ดาเมจไฟ/พิษที่ทำได้', 'burn / poison damage dealt'))}">${esc(names[s])}: ${parts}</span>` : '';
    })
    .join('');
}
/** events already in the log, so a language change can re-write it */
let logHist: CombatEvent[] = [];
function describe(e: CombatEvent): string | null {
  // each side in its own colour, so "who lost HP" is never ambiguous
  const who = (s: number) => `<span class="who s${s}">${esc(names[s])}</span>`;
  /** English verb for side s: "You lose" / "Mochi-12 loses" */
  const vb = (s: number, he: string, you: string) => (names[s] === 'You' ? you : he);
  const varName = (side: number, id: string) => {
    const k = logBuilds?.[side]?.skills.find((x) => x.id === id);
    return k ? nodeOf(k).name : SKILLS[id]?.name ?? id;
  };
  switch (e.type) {
    case 'cast':
      return `${who(e.side)} ${L('ใช้', vb(e.side, 'uses', 'use'))} <b>${varName(e.side, e.skill)}</b> Lv${e.lv}${e.star3 ? ` <span class="lg-star">${L('★★★ ซ้ำ', '★★★ echo')}</span>` : e.echo ? L(' (ตีซ้ำ)', ' (echo)') : ''}${e.epic && !e.echo ? ` <span class="lg-epic">${L('◆ มหากาพย์', '◆ EPIC')}</span>` : ''}${e.from !== undefined ? ` <small class="muted">${L('🔗ต่อ', '🔗chain')}</small>` : ''}`;
    case 'damage': {
      const attacker = 1 - e.side;
      const src =
        e.src === 'burn'
          ? L('ไฟ', 'burn')
          : e.src === 'poison'
            ? L('พิษ', 'poison')
          : e.src === 'ult'
            ? L('ท่าไม้ตาย', 'the ultimate')
          : e.src === 'fatigue'
            ? L('ความเหนื่อยล้า', 'fatigue')
            : logRefl.has(e)
              ? L(`หนามของ${esc(names[attacker])}`, names[attacker] === 'You' ? 'your thorns' : `the thorns of ${esc(names[attacker])}`)
              : varName(attacker, e.src);
      return `&nbsp;&nbsp;${who(e.side)} ${L('เสีย', vb(e.side, 'loses', 'lose'))} <b class="dmg">${e.amount}</b>${e.blocked ? L(` (โล่กัน ${e.blocked})`, ` (shield blocked ${e.blocked})`) : ''} ${L('จาก', 'from')}${L('', ' ')}${src}`;
    }
    case 'status':
      switch (e.status) {
        case 'freeze':
          return e.value > 0
            ? `&nbsp;&nbsp;${who(e.side)} ${L('ถูกแช่แข็ง', vb(e.side, 'is frozen for', 'are frozen for'))} ${(e.value / 10).toFixed(1)}${L(' วิ', 's')}`
            : `&nbsp;&nbsp;${who(e.side)} ${L('ต้านการแช่แข็ง', vb(e.side, 'resists the freeze', 'resist the freeze'))}`;
        case 'slow':
          return `&nbsp;&nbsp;${who(e.side)} ${L('ช้าลง', vb(e.side, 'is slowed', 'are slowed'))} ${e.value}%`;
        case 'rage':
          return `${who(e.side)} <b>${L('คลั่ง!', 'Rage!')}</b> ${L('พลังโจมตี', 'attack power')} +${e.value}`;
        case 'evade':
          return `&nbsp;&nbsp;${who(e.side)} ${L('หลบการตีได้', vb(e.side, 'dodges the hit', 'dodge the hit'))} 💨 (${L('เหลือ', 'left')} ${e.value})`;
        case 'shake':
          return `&nbsp;&nbsp;${who(e.side)} ${L('สลัดการแช่แข็ง/ช้าทิ้ง (ไม่ได้ใช้ skill 4 วิ)', vb(e.side, 'shakes off freeze/slow (no skill for 4s)', 'shake off freeze/slow (no skill for 4s)'))}`;
        case 'sure':
          return `&nbsp;&nbsp;${who(e.side)} ${L('หลบไม่ได้: การตีนี้ไม่พลาด', vb(e.side, "can't dodge: this hit never misses", "can't dodge: this hit never misses"))} 👁`;
        case 'dodge':
          return `&nbsp;&nbsp;${who(e.side)} ${L('ได้แต้มหลบ', vb(e.side, 'has dodge', 'have dodge'))} 💨${e.value}`;
        case 'poison':
          return `&nbsp;&nbsp;${who(e.side)} ${L('ติดพิษ', vb(e.side, 'is poisoned', 'are poisoned'))} ☠${e.value}${L('/วิ', '/s')}`;
        case 'haste':
          return `&nbsp;&nbsp;${who(e.side)} ${L('เร่งคูลดาวน์', vb(e.side, 'hastes', 'haste'))} ⏩${e.value}%`;
        case 'wound':
          return `&nbsp;&nbsp;${who(e.side)} ${L('แผลลึก ฟื้นน้อยลง', vb(e.side, 'is wounded: heals less', 'are wounded: heal less'))} ${e.value}%`;
        case 'cleanse':
          return e.value > 0 ? `&nbsp;&nbsp;${who(e.side)} ${L(`ล้างดีบัฟ ${e.value} อย่าง`, `${vb(e.side, 'cleanses', 'cleanse')} ${e.value} debuff${e.value === 1 ? '' : 's'}`)}` : null;
        case 'dispel':
          return e.value > 0 ? `&nbsp;&nbsp;${who(e.side)} ${L(`ถูกลบบัฟ ${e.value} อย่าง`, `${vb(e.side, 'loses', 'lose')} ${e.value} buff${e.value === 1 ? '' : 's'}`)}` : null;
        case 'delay':
          return e.value > 0
            ? `&nbsp;&nbsp;${who(e.side)} ${L('คูลดาวน์ถอยหลัง', 'cooldowns pushed back')} ${(e.value / 10).toFixed(1)}${L(' วิ', 's')}`
            : `&nbsp;&nbsp;${who(e.side)} ${L('ต้านการถ่วงเวลา', vb(e.side, 'resists the delay', 'resist the delay'))}`;
        default:
          return null;
      }
    case 'fatigue':
      return `<span class="muted">${L(`เหนื่อยล้า: ทั้งสองฝ่ายเสีย ${e.amount}`, `Fatigue: both sides lose ${e.amount}`)}</span>`;
    case 'ult': {
      const h = HEROES_BY_ID[e.hero];
      return `<b class="ult">★ ${who(e.side)} ${L('ใช้ท่าไม้ตาย', vb(e.side, 'unleashes', 'unleash'))} ${esc(h?.ult.name ?? e.hero)} Lv${e.lv}</b>`;
    }
    case 'end':
      return `<b>${e.winner === -1 ? L('เสมอ', 'Draw') : who(e.winner) + L(' ชนะ', vb(e.winner, ' wins', ' win'))}</b>`;
    default:
      return null;
  }
}
function addLog(e: CombatEvent) {
  logHist.push(e);
  if (e.type === 'damage' && (e.src === 'burn' || e.src === 'poison')) {
    dots[1 - e.side][e.src] += e.amount + e.blocked;
    paintDots();
  }
  if (logHist.length > 400) logHist.splice(0, logHist.length - 200);
  writeLog(e);
}
function writeLog(e: CombatEvent) {
  const line = describe(e);
  const el = document.getElementById('log');
  if (!line || !el) return;
  const li = document.createElement('li');
  li.innerHTML = `<span class="t">${(e.t / 10).toFixed(1)}</span> ${line}`;
  el.prepend(li);
  while (el.children.length > 80) el.lastElementChild?.remove();
}

// ---------- actions ----------
async function doFight() {
  const r = run!;
  if (busy) return;
  busy = true;
  const build = R.toBuild(r);
  lastBuild = build;
  lastDay = r.day;
  lastDamage = R.damageFor(r.day);
  let res: FightResponse;
  if (C.chainOn()) {
    await chainFightUi(r, build);
    return;
  }
  try {
    // playerId lets the server keep a profile for this browser (extra field; older servers ignore it)
    const body = { runId: r.id, name: playerName(), day: r.day, rating: r.rating, build, playerId: M.playerId(), ...(tutorialFight && r.day === 1 ? { tutorial: true } : {}) };
    tutorialFight = false;
    res = await api.fight(body as Parameters<typeof api.fight>[0]);
    M.rememberFromFight(res);
    if (import.meta.env.DEV) {
      // the browser can re-run the exact fight from the seed — this is what makes replays shareable
      const local = simulate(build, res.opponent.build, res.seed, r.day);
      if (JSON.stringify(local) !== JSON.stringify(res.result)) console.warn('[arena] client/server sim mismatch');
    }
  } catch (err) {
    // the server answered but refused the build (400/403/409): never fight offline then, say why and stay in the shop
    const m = /^(4\d\d) (.*)$/s.exec(err instanceof Error ? err.message : '');
    if (m) {
      let why = m[2];
      try { why = (JSON.parse(m[2]) as { error?: string }).error ?? why; } catch { /* plain text */ }
      console.warn('[arena] the server refused this build', m[1], why);
      toast = L(`เซิร์ฟเวอร์ไม่รับ build นี้ (${why}) · ลองปรับ build แล้วสู้ใหม่ หรือเริ่มรอบใหม่`, `The server refused this build (${why}) · change the build and fight again, or start a new run`);
      busy = false;
      view = phaseView(r);
      render();
      return;
    }
    console.warn('[arena] server unavailable, fighting a local AI', err);
    const seed = hashSeed(r.seed, 'offline', r.day, Date.now());
    const opp = randomAiBuild(r.day, seed, r.day <= 2 ? 'easy' : 'normal', r.day <= 2 ? r.hero : undefined);
    const result = simulate(build, opp, seed, r.day);
    res = {
      seed, day: r.day, result, won: result.winner === 0, rating: r.rating, offline: true,
      // Thai like the server's AI names (shown through displayName)
      opponent: { name: `AI · ${withLang('th', () => HEROES_BY_ID[opp.hero].name)}`, ai: true, build: opp, rating: r.rating },
    };
  }
  last = res;
  // apply the result before the replay plays, so reloading mid-replay can't undo a loss
  r.rating = res.rating;
  // sim v20: the server revealed hidden marks (their kinds are its rolls)
  if (!(res as { offline?: boolean }).offline) r.online = true;
  const rev = (res as { revealed?: { idx: number; mark: string }[] }).revealed;
  lastReveal = [];
  if (Array.isArray(rev))
    for (const x of rev) {
      const k = r.skills[x.idx];
      if (k && R.MARKS.includes(x.mark as Mark)) {
        k.mark = x.mark as Mark;
        delete k.markHidden;
        lastReveal.push({ id: k.id, v: k.v, mark: k.mark });
      }
    }
  const nextRelics = (res as { nextRelics?: unknown }).nextRelics;
  const reRelics = (res as { nextRelicsRe?: unknown }).nextRelicsRe;
  const strs = (a: unknown[]) => a.filter((x): x is string => typeof x === 'string');
  if (Array.isArray(nextRelics))
    r.relicNext = { day: r.day + 1, ids: strs(nextRelics), ...(Array.isArray(reRelics) ? { re: reRelics.filter(Array.isArray).map(strs) } : {}) };
  R.recordResult(r, res.won, { opp: res.opponent.name, ai: res.opponent.ai, fightId: res.fightId }, res.result.winner === -1);
  saveRun();
  const oppInfo = res.opponent as FightResponse['opponent'] & { tier?: unknown };
  namesFn = () => [youName(), oppLabel(oppInfo)];
  names = namesFn();
  seedNames = ['คุณ', oppInfo.name];
  noteFight(r, res, build, lastDay);
  view = 'fighting';
  sfx('fight_start');
  setVoiceHero(r.hero);
  voice('fight');
  music('battle');
  render();
  playLast();
}

/** hidden marks the last fight's response revealed: shown as a moment on the result screen */
let lastReveal: { id: string; v: string; mark: Mark }[] = [];
function revealHTML() {
  return lastReveal
    .map((x) => `<div class="mk-reveal mk-${x.mark}" role="status"><i class="mk-c mk-big">${D.markGlyph(x.mark)}</i>
      <p><b>${L('ตราลึกลับเปิดแล้ว!', 'Hidden mark revealed!')}</b> ${L(`${esc(nodeOf(x).name)} ได้ตรา <b>${esc(R.MARK_INFO[x.mark].name)}</b>`, `${esc(nodeOf(x).name)} has the <b>${esc(R.MARK_INFO[x.mark].name)}</b> mark`)}<small>${esc(R.MARK_INFO[x.mark].desc)}</small></p></div>`)
    .join('');
}

/** Play the last fight of the run in the arena (first time, or again from the result screen). */
function playLast() {
  const res = last!;
  const build = lastBuild!;
  beginLog(res.result, [build, res.opponent.build]);
  // the server sends only events; re-run the same fight here to get per-tick cooldowns for the clock-wipe
  const traced = simulate(build, res.opponent.build, res.seed, lastDay, { trace: true });
  const shown = traced.winner === res.result.winner ? { ...res.result, trace: traced.trace } : res.result;
  scene.play(
    {
      result: shown,
      left: { name: names[0], seedName: seedNames[0], build },
      right: { name: names[1], seedName: seedNames[1], build: res.opponent.build },
    },
    addLog,
    () => {
      busy = false;
      view = 'result';
      render();
    },
  );
}

function phaseView(r: R.RunState): View {
  return r.phase === 'shop' ? 'shop' : r.phase === 'relic' ? 'relic' : r.phase === 'lastchance' ? 'lastchance' : r.phase === 'mark' ? 'mark' : 'over';
}

async function openReplay(id: string) {
  try {
    replay = await api.replay(id);
  } catch {
    toast = L('ไม่พบ replay นี้', 'Replay not found');
    view = 'title';
    render();
    return;
  }
  playReplay();
}
function playReplay() {
  const f = replay!;
  if (f.v !== SIM_VERSION) {
    toast = L('replay นี้มาจากเกมเวอร์ชันเก่า ดูซ้ำไม่ได้แล้ว', 'This replay is from an older version of the game and can no longer be played');
    replay = null;
    view = 'town';
    render();
    return;
  }
  const result = simulate(f.a.build, f.b.build, f.seed, f.day, { trace: true }); // recomputed locally from the seed
  replayResult = result;
  namesFn = () => replayNames(f);
  names = namesFn();
  seedNames = [f.a.name, f.b.name];
  view = 'replay';
  render();
  beginLog(result, [f.a.build, f.b.build]);
  const left = { name: names[0], seedName: seedNames[0], build: f.a.build };
  const right = { name: names[1], seedName: seedNames[1], build: f.b.build };
  scene.play({ result, left, right }, addLog, () => {
    view = 'replayDone';
    render();
  });
}

function onClick(ev: Event) {
  const el = (ev.target as HTMLElement).closest<HTMLElement>('[data-a]');
  // shop: tap (or click) a card to select it → ghost + "+" targets in the list; tap elsewhere to let go
  if (view === 'shop' && run && !el) {
    const card = (ev.target as HTMLElement).closest<HTMLElement>('.card.offer[data-tip^="s:"]');
    if (card) {
      const i = Number(card.dataset.tip!.slice(2));
      if (picked === i) clearPick($panel);
      else {
        setPick($panel, run, i, offerWhy(run, i));
        // a new skill: the ghost and the + targets matter more than the tooltip (an upgrade keeps its old → new tip)
        if (run.shop[i]?.v === '' && (ev as PointerEvent).pointerType !== 'mouse') hideTip();
      }
      return;
    }
    if (picked >= 0) clearPick($panel);
  }
  // end screen: a tap anywhere (not on a control) during the reveal shows everything at once
  if (view === 'over' && RF.revealing() && !(ev.target as HTMLElement).closest('a, button, summary')) {
    RF.skip();
    render();
    return;
  }
  if (!el || (el as HTMLButtonElement).disabled) return;
  const a = el.dataset.a!;
  // the tree window closes from its button or a click on the dark backdrop, not from clicks inside it
  if ((a === 'treeClose' || a === 'branchClose') && el.classList.contains('modal') && ev.target !== el) return;
  const arg = el.dataset.i ?? '';
  const n = Number(arg);
  let err: string | null = null;
  // on chain, actions with a random outcome are rolled by the program (request + VRF callback)
  if (C.chainOn() && run && CHAIN_ROLL[a]) {
    const [code, aa] = CHAIN_ROLL[a](n, arg);
    void chainRollUi(code, aa, a);
    return;
  }
  switch (a) {
    case 'start':
      if (C.chainOn()) {
        void chainStart(arg);
        return;
      }
      {
        const seed = nextSeed ?? randSeed();
        if (!R.heroChoices(seed).includes(arg)) break; // only an offered hero can start a run
        nextSeed = null;
        run = R.newRun(arg, seed, uid());
        track('run_start', { hero: arg });
        heroVoice(arg, 'pick', true); // the hero greets you in its own voice (sim v21)
      }
      view = 'shop';
      break;
    case 'resume':
      view = phaseView(run!);
      break;
    case 'lastResults':
      if (!run || (run.phase !== 'won' && run.phase !== 'dead')) return;
      view = 'over';
      break;
    case 'home':
      if (run && (run.phase === 'won' || run.phase === 'dead')) run = null;
      view = 'title';
      break;
    case 'town':
      if (run && (run.phase === 'won' || run.phase === 'dead')) run = null;
      view = 'town';
      break;
    case 'goto':
      selected = arg;
      stage.town.focus(arg);
      break;
    case 'enterArena':
      view = runActive() ? phaseView(run!) : 'title';
      break;
    case 'buy':
      err = buyOffer(n, null, el.dataset.v || undefined);
      branchOpen = null;
      break;
    case 'branchOpen':
      if (!run?.shop[n]) return;
      branchOpen = n;
      render();
      return;
    case 'branchClose':
      branchOpen = null;
      render();
      return;
    case 'relicReroll':
      err = R.rerollRelic(run!);
      if (!err) sfx('reroll');
      break;
    case 'relic':
      err = R.pickRelic(run!, n);
      if (!err) view = phaseView(run!);
      break;
    case 'pickGo':
      goToPick($panel);
      return;
    case 'buyAt': {
      const pos = Number(el.dataset.pos);
      err = buyOffer(n, pos >= 0 ? pos : null);
      break;
    }
    case 'reroll':
      err = R.reroll(run!);
      break;
    case 'sell':
      sellSkill(n, el.getBoundingClientRect());
      return;
    case 'up':
    case 'down':
      R.moveSkill(run!, n, a === 'up' ? -1 : 1);
      break;
    case 'slot':
      err = R.buySlot(run!);
      break;
    case 'lock':
      err = R.toggleLock(run!, n);
      break;
    case 'wish': {
      const w = R.wish(run!);
      if ('err' in w) err = w.err;
      else {
        const k = run!.skills[w.idx];
        const nm = run!.skills.filter((x) => x.mark || x.markHidden).length;
        toast = k.markHidden
          ? L(`🌙 ${nodeOf(k).name} ได้ตราลึกลับ · ชนิดเปิดหลังสู้ครั้งถัดไป · ตรา ${nm}/${D.MARK_MAX}`, `🌙 ${nodeOf(k).name} gets a hidden mark · revealed after your next fight · marks ${nm}/${D.MARK_MAX}`)
          : w.mark
          ? L(`🌙 ${nodeOf(k).name} ได้ตรา${R.MARK_INFO[w.mark].name}: ${R.MARK_INFO[w.mark].desc} · ตรา ${nm}/${D.MARK_MAX}`, `🌙 ${nodeOf(k).name} gets the ${MARKS_EN[w.mark].name} mark: ${MARKS_EN[w.mark].desc} · marks ${nm}/${D.MARK_MAX}`)
          : `${L('🌙 พรจันทร์', '🌙 Moon Wish')}: ${nodeOf({ id: k.id, v: w.from }).name} Lv${lvOf(w.from)} → ${nodeOf(k).name} Lv${lvOf(k.v)}`;
      }
      break;
    }
    case 'tree':
      if (!SKILLS[arg]) return;
      treeOpen = { id: arg, cur: el.dataset.own === '1' ? (el.dataset.cur ?? '') : null, offer: el.dataset.offer || null };
      render();
      return;
    case 'treeClose':
      treeOpen = null;
      render();
      return;
    case 'concede':
      confirmConcede = true;
      break;
    case 'concedeNo':
      confirmConcede = false;
      break;
    case 'concedeYes':
      confirmConcede = false;
      R.concede(run!);
      if (C.chainOn()) void C.chainFinish().catch((e) => { toast = (e as Error).message; render(); });
      if (view === 'fighting') {
        scene.idle(null); // stop the replay
        busy = false;
      }
      view = 'over';
      break;
    case 'fight': {
      // simple mode, once a day: gold left and a card you can buy → point at it instead of fighting
      const r = run;
      const canBuy = r ? r.shop.map((_, i) => i).filter((i) => !offerWhy(r, i)) : [];
      if (r && canBuy.length && !showingDetail() && goldNudgeDay !== r.day) {
        goldNudgeDay = r.day;
        nudgeBuy(canBuy);
        return;
      }
      void doFight();
      return;
    }
    case 'more': {
      // simple mode result: open the full numbers in place
      const main = (ev.target as HTMLElement).closest('.rv-main');
      main?.classList.add('more');
      return;
    }
    case 'speed':
      scene.speed = n;
      try {
        localStorage.setItem(SPEED_KEY, String(n));
      } catch {
        /* private mode: this visit only */
      }
      document.querySelectorAll('[data-a="speed"]').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.i === arg));
      return;
    case 'skip':
      scene.skip();
      return;
    case 'next':
      view = phaseView(run!);
      break;
    case 'lc':
      R.chooseLastChance(run!, arg as R.LastChanceOption);
      view = phaseView(run!);
      break;
    case 'mark':
      err = R.applyMark(run!, n);
      view = phaseView(run!);
      break;
    case 'replayAgain':
      playReplay();
      return;
    case 'rewatch':
      if (!last || !lastBuild || busy) return;
      busy = true;
      view = 'replay';
      render();
      playLast();
      return;
    case 'profile':
      profileData = null; // refresh on every visit
      view = 'profile';
      break;
    case 'leaderboard':
      lbData = null;
      lbLoading = false;
      view = 'leaderboard';
      break;
    case 'rename': {
      const input = $panel.querySelector<HTMLInputElement>('#pname');
      const nm = input?.value.trim() ?? '';
      if (!nm) {
        toast = L('พิมพ์ชื่อก่อนนะ', 'Type a name first');
        break;
      }
      (el as HTMLButtonElement).disabled = true;
      void M.renameMe(nm).then((r) => {
        if (r.name) {
          store(NAME_KEY, r.name); // the next fights and runs carry it too
          if (profileData) profileData.name = r.name;
          lbData = null; // the leaderboard shows the new name on the next visit
          toast = L(`เปลี่ยนชื่อเป็น ${r.name} แล้ว`, `You are now ${r.name}`);
        } else toast = r.error === 'offline' ? L('ออฟไลน์อยู่ ลองใหม่อีกครั้ง', 'You are offline, try again') : L('เปลี่ยนชื่อไม่สำเร็จ: ', 'Could not change the name: ') + r.error;
        if (view === 'profile') render();
      });
      return;
    }
    case 'lbPeriod':
      if (arg !== 'season' && arg !== 'day') return;
      lbPeriod = arg;
      lbData = null;
      lbLoading = false;
      break;
    case 'shareCard':
    case 'saveCard': {
      if (!run || run.phase !== 'won') return;
      const d = cardData(run);
      const btn = el as HTMLButtonElement;
      btn.disabled = true;
      const done = (how: string) => {
        btn.disabled = false;
        if (how === 'failed') {
          toast = L('ทำรูปการ์ดไม่สำเร็จ', 'Could not make the card image');
          render();
        }
      };
      if (a === 'saveCard') void saveCard(d).then(done);
      else void shareCard(d, L(`โมจิของฉันได้มงกุฎดวงจันทร์ใน Mochi Moon! ${location.origin}`, `My mochi won the moon crown in Mochi Moon! ${location.origin}`)).then(done);
      return;
    }
    case 'saveBuild': {
      if (!run || (run.phase !== 'won' && run.phase !== 'dead')) return;
      const btn = el as HTMLButtonElement;
      btn.disabled = true;
      void saveBuildCard(buildCardImage(run)).then((how) => {
        btn.disabled = false;
        if (how === 'failed') {
          toast = L('ทำรูปการ์ดไม่สำเร็จ', 'Could not make the card image');
          render();
        }
      });
      return;
    }
    case 'leaveReplay':
      history.replaceState(null, '', location.pathname);
      replay = null;
      view = 'town';
      break;
    default:
      return;
  }
  if (err) {
    toast = runErr(err);
    afterRender = null;
  } else if (a === 'buy' || a === 'buyAt') sfx('buy');
  else if (a === 'reroll' || a === 'wish') sfx(a);
  else if (a === 'lock') sfx('lock');
  saveRun();
  render();
  // the hero in the shop arena reacts (happy hop on a buy, sad wobble on a sell)
  if (!err && view === 'shop') {
    if (a === 'buy' || a === 'buyAt' || a === 'wish' || a === 'slot') scene.react('buy');
    else if (a === 'reroll') scene.react('reroll');
  }
}

/** Hero pick: pointing at (or focusing) a hero card shows that hero in the arena. */
function onPreview(ev: Event) {
  if (view !== 'title') return;
  const card = (ev.target as Element).closest?.<HTMLElement>('[data-a="start"]');
  const id = card?.dataset.i;
  if (!id || id === previewHero) return;
  previewHero = id;
  scene.idle(id, nextSeed != null ? R.lookFor(nextSeed, id) : 0);
  scene.react('pick');
  $panel.querySelectorAll('[data-a="start"]').forEach((b) => b.classList.toggle('previewing', b === card));
}

// ---------- tooltip ----------
let $tip: HTMLElement | null = null;
let tipKey = '';
function showTip(key: string, x: number, y: number) {
  if (!$tip) {
    $tip = document.createElement('div');
    $tip.className = 'tooltip';
    document.body.appendChild($tip);
  }
  if (key !== tipKey) {
    const html = key.startsWith('raw:') ? key.slice(4) : tipFor(key);
    if (!html) return hideTip();
    $tip.innerHTML = html;
    tipKey = key;
  }
  $tip.style.display = 'block';
  const r = $tip.getBoundingClientRect();
  const left = Math.min(window.innerWidth - r.width - 8, x + 16);
  const top = y + 16 + r.height > window.innerHeight ? y - r.height - 12 : y + 16;
  $tip.style.left = `${Math.max(8, left)}px`;
  $tip.style.top = `${Math.max(8, top)}px`;
}
function hideTip() {
  if ($tip) $tip.style.display = 'none';
  tipKey = '';
}

/** shop card under the pointer → light up the list rows it would connect to (-1 = none) */
function offerHints(ev: PointerEvent) {
  if (view !== 'shop') return;
  const card = (ev.target as Element).closest?.('.card.offer[data-tip^="s:"]') as HTMLElement | null;
  // with a card selected (tap-to-place) its hints stay on while the pointer is elsewhere
  showHints($panel, run, card ? Number(card.dataset.tip!.slice(2)) : picked);
}

function onHover(ev: PointerEvent) {
  if (ev.pointerType !== 'mouse') return;
  if (dragging || shopDragging) return hideTip();
  offerHints(ev);
  // a keyword chip explains its keyword (anywhere: shop, lists, hero hall)
  const kw = (ev.target as Element).closest?.('[data-kw]') as HTMLElement | null;
  if (kw) return showTip('raw:' + kwTip(kw.dataset.kw as Keyword), ev.clientX, ev.clientY);
  const tt = (ev.target as Element).closest?.('[data-ttxt]') as HTMLElement | null;
  if (tt) return showTip('raw:' + tt.dataset.ttxt, ev.clientX, ev.clientY);
  const el = (ev.target as Element).closest?.('[data-tip]') as HTMLElement | SVGElement | null;
  if (el && view === 'shop') showTip(el.dataset.tip!, ev.clientX, ev.clientY);
  else hideTip();
}

function onPointerDown(ev: PointerEvent) {
  if (ev.pointerType === 'mouse') return;
  offerHints(ev);
  if ((ev.target as Element).closest?.('[data-drag]')) return hideTip();
  // touch: tap a keyword chip, a chart bar or a skill to see its details
  const kw = (ev.target as Element).closest?.('[data-kw]') as HTMLElement | null;
  if (kw) return showTip('raw:' + kwTip(kw.dataset.kw as Keyword), ev.clientX, ev.clientY);
  const tt = (ev.target as Element).closest?.('[data-ttxt]') as HTMLElement | null;
  if (tt) return showTip('raw:' + tt.dataset.ttxt, ev.clientX, ev.clientY);
  const el = (ev.target as Element).closest?.('[data-tip]') as HTMLElement | null;
  if (el && view === 'shop' && !(ev.target as Element).closest('button')) return showTip(el.dataset.tip!, ev.clientX, ev.clientY);
  hideTip();
}

export function startUI(st: Stage) {
  stage = st;
  scene = st.combat;
  // header logo: back to the town from any screen (not while a fight is playing: its end would pull you back)
  const logo = document.querySelector<HTMLElement>('header .logo');
  const goHome = () => {
    if (view === 'fighting' || view === 'replay' || view === 'town') return;
    if (run && (run.phase === 'won' || run.phase === 'dead')) run = null;
    treeOpen = null;
    hideTip();
    view = 'town';
    render();
  };
  logo?.addEventListener('click', goHome);
  $panel.addEventListener('pointerover', onLcHover);
  $panel.addEventListener('focusin', onLcHover);
  logo?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      goHome();
    }
  });
  // tapping the selected arena (or its "Enter" bubble) on the town map = the "Enter the Arena" button
  st.town.onEnter = (id) => {
    if (view !== 'town' || id !== 'arena' || busy) return;
    view = runActive() ? phaseView(run!) : 'title';
    render();
  };
  st.town.onSelect = (id) => {
    selected = id;
    if (view === 'town') render();
  };
  $panel.addEventListener('click', onClick);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && treeOpen) {
      treeOpen = null;
      render();
    } else if (e.key === 'Escape' && picked >= 0) {
      clearPick($panel);
      showHints($panel, run, -1);
    }
  });
  $panel.addEventListener('pointerdown', onPointerDown);
  $panel.addEventListener('pointerover', onPreview);
  $panel.addEventListener('focusin', onPreview);
  initDrag($panel, {
    onPreview: previewOrder,
    onDrop: dropSkill,
    onSell: (i) => sellSkill(i, document.querySelector('.sell-jar')?.getBoundingClientRect() ?? null),
  });
  initShopDrag($panel, {
    run: () => (view === 'shop' ? run : null),
    why: (i) => (run && view === 'shop' ? offerWhy(run, i) : '-'),
    onStart: () => {
      hideTip();
      clearPick($panel);
      showHints($panel, run, -1);
      sfx('pickup');
    },
    onBuy: (i, pos) => {
      if (!run || view !== 'shop') return;
      const err = buyOffer(i, pos);
      if (err) {
        toast = runErr(err);
        afterRender = null;
      }
      sfx(err ? 'click' : 'buy');
      saveRun();
      render();
      if (!err) scene.react('buy');
    },
  });
  bindChainResize($panel);
  window.addEventListener('pointermove', onHover);
  $panel.addEventListener('pointerleave', hideTip);
  // language switch: re-label the fighters, re-render the panel, and re-write the fight log in the new language
  onLang(() => {
    names = namesFn();
    scene.setNames(names);
    if (!stage || !$panel.firstChild) return;
    render();
    if (view === 'fighting' || view === 'replay') logHist.slice(-80).forEach(writeLog);
  });
  window.addEventListener('keydown', overKey);
  run = C.chainOn() ? null : loadRun();
  if (C.chainOn()) void chainBoot();
  const rid = new URLSearchParams(location.search).get('replay');
  if (rid) {
    stage.show('combat');
    void openReplay(rid);
    return;
  }
  view = 'town';
  render();
}

// ---------- on-chain mode (the default; ?chain=0 = off) ----------
/** UI actions with a random outcome → their chain code and argument */
const CHAIN_ROLL: Record<string, (n: number, arg: string) => [number, number]> = {
  reroll: () => [3, 0],
  wish: () => [6, 0],
  lc: (_n, arg) => [7, ['awaken', 'mark', 'supply'].indexOf(arg)],
  mark: (n) => [8, n >= 0 && run && n < run.skills.length ? n : -1],
  relicReroll: () => [12, 0],
};
/** take the chain's run state (the chain decides; the UI keeps its own log, rating and id) */
function adoptChain(bytes: Uint8Array) {
  const keep = run ? { id: run.id, log: run.log, rating: run.rating } : { id: uid(), log: [], rating: 1000 };
  run = Object.assign(C.runOf(bytes, keep.id), keep);
  saveRun();
}
async function chainRollUi(code: number, a: number, what: string) {
  if (busy || !run) return;
  busy = true;
  const before = run;
  try {
    const r = await C.chainRoll(code, a, 0, L('กำลังสุ่มบน chain…', 'rolling on chain…'));
    adoptChain(r.run);
    if (what === 'reroll' || what === 'relicReroll') sfx('reroll');
    if (what === 'wish') toast = L('🌙 พรจันทร์บน chain แล้ว', '🌙 Moon Wish rolled on chain');
    view = phaseView(run!);
  } catch (e) {
    run = before;
    toast = L('ทำบน chain ไม่ได้: ', 'Could not do it on chain: ') + (e as Error).message;
    await chainResync();
  }
  busy = false;
  render();
}
/** the fight on chain: request + VRF callback; replay it with the TS sim; then take the chain's state */
async function chainFightUi(r: R.RunState, build: Build) {
  let f: C.ChainFight;
  try {
    f = await C.chainFight();
  } catch (err) {
    busy = false;
    toast = L('ส่งไฟต์ขึ้น chain ไม่ได้: ', 'Could not send the fight: ') + (err as Error).message;
    await chainResync();
    return;
  }
  // replay what the chain fought: its build of the day (the local one can be stale, e.g. another device acted)
  if (JSON.stringify(f.build.skills) !== JSON.stringify(build.skills)) console.warn('[chain] the chain fought with another build than shown here (state changed elsewhere): replaying the chain build');
  // the chain's build has no cosmetic look (never stored on chain): keep the run's, so the battle shows the same
  // hero art as the shop
  build = { ...f.build, look: R.lookOf(r) };
  lastBuild = build;
  const result = simulate(build, f.opp, f.seed, f.day);
  if ((result.winner === 0) !== f.won) console.error('[chain] TS replay winner differs from the chain');
  const res: FightResponse = {
    seed: f.seed, day: f.day, result, won: f.won, rating: r.rating,
    opponent: { name: `${f.ghost ? 'Ghost' : 'AI'} · ${withLang('th', () => HEROES_BY_ID[f.opp.hero].name)}`, ai: !f.ghost, build: f.opp, rating: r.rating },
  };
  last = res;
  r.log.push({ day: r.day, won: f.won, opp: res.opponent.name, ai: !f.ghost, ...(f.draw && !f.won ? { draw: true } : {}) });
  adoptChain(f.run);
  const oppInfo = res.opponent;
  namesFn = () => [youName(), oppLabel(oppInfo)];
  names = namesFn();
  seedNames = ['คุณ', oppInfo.name];
  noteFight(run!, res, build, lastDay);
  view = 'fighting';
  sfx('fight_start');
  render();
  playLast();
}
/** a request from before a reload still waits: block actions, show it, take the chain's state when it lands */
async function chainPendingUi() {
  busy = true;
  toast = L('รอผลการกระทำล่าสุดบน chain…', 'Waiting for your last action on chain…');
  render();
  try {
    adoptChain(await C.chainWaitPending());
    toast = L('ได้ผลจาก chain แล้ว', 'Your last action landed on chain');
  } catch (e) {
    toast = (e as Error).message;
  }
  busy = false;
  if (run && view !== 'town' && view !== 'title') view = phaseView(run);
  render();
}
/** on load: reconnect silently if this browser logged in before; otherwise wait for "Connect Phantom" */
async function chainBoot(interactive = false, take = false) {
  mountChainUi();
  setChainHandlers({ login: () => void chainBoot(true), logout: chainLogout, take: () => void chainBoot(true, true) });
  C.setOnTabLost(() => {
    chainConn = 'off';
    run = null;
    view = 'town';
    C.setChainStatus('othertab');
    toast = L('ย้ายไปเล่นในแท็บอื่นแล้ว', 'The game moved to another tab');
    render();
  });
  if (!interactive && !C.chainRemembered() && new URLSearchParams(location.search).get('wallet') !== 'burner') {
    chainConn = 'off';
    C.setChainStatus('loggedout');
    toast = L('เชื่อมต่อ Phantom (ปุ่มมุมขวาบน) เพื่อเล่นบน chain', 'Connect Phantom (top right) to play on chain');
    render();
    return;
  }
  chainConn = 'connecting';
  try {
    const st = await C.chainConnect((msg) => { if (msg) { toast = msg; render(); } }, !interactive, take);
    if (st.run) adoptChain(st.run);
    chainChoices = st.choices;
    chainPreview = st.preview;
    chainLook = st.lookSeed;
    chainConn = 'ready';
    toast = L('เชื่อมต่อ chain แล้ว', 'Connected to the chain');
    if (st.pending) void chainPendingUi();
  } catch (e) {
    chainConn = e instanceof C.OtherTab || e instanceof C.NotLoggedIn ? 'off' : 'error';
    if (chainConn === 'error') C.setChainStatus('error', (e as Error).message);
    toast = e instanceof C.OtherTab
      ? L('กระเป๋านี้เล่นอยู่ในแท็บอื่น กดปุ่มมุมขวาบนเพื่อย้ายมาเล่นที่นี่', 'This wallet is playing in another tab: use the top-right button to play here')
      : e instanceof C.NotLoggedIn
        ? L('เชื่อมต่อ Phantom (ปุ่มมุมขวาบน) เพื่อเล่นบน chain', 'Connect Phantom (top right) to play on chain')
        : L('เชื่อมต่อ chain ไม่ได้: ', 'Chain connection failed: ') + (e as Error).message;
  }
  render();
}
async function chainLogout() {
  await C.chainLogout();
  chainConn = 'off';
  run = null;
  chainChoices = null;
  view = 'town';
  toast = L('ออกจากระบบแล้ว', 'Logged out');
  render();
}
async function chainStart(hero: string) {
  if (busy || !chainChoices?.includes(hero)) return;
  busy = true;
  try {
    const bytes = await C.chainPickHero(chainChoices.indexOf(hero));
    chainChoices = null;
    chainPreview = null;
    run = null;
    adoptChain(bytes);
    track('run_start', { hero });
    heroVoice(hero, 'pick', true);
    view = 'shop';
  } catch (e) {
    toast = (e as Error).message;
  }
  busy = false;
  render();
}
/** after a failed transaction: reload the run from the chain (the chain wins; queued local actions are dropped) */
async function chainResync() {
  C.chainDropQueue();
  try {
    const st = await C.chainState();
    if (st?.run) adoptChain(st.run);
    else if (run && run.phase !== 'won' && run.phase !== 'dead') run = null;
    chainChoices = st?.choices ?? null;
    chainPreview = st?.preview ?? null;
    chainLook = st?.lookSeed ?? 0;
    if (st?.pending) {
      view = run ? phaseView(run) : 'title';
      void chainPendingUi();
      return;
    }
  } catch (e) {
    console.error('[chain] resync', e);
  }
  view = run ? phaseView(run) : 'title';
  render();
}

// ---------- hooks for the guided tutorial (src/client/guide.ts) ----------

/** the next fight asks the server for the tutorial's training opponent (day 1 of a new run only; the server decides) */
let tutorialFight = false;
export const guideHooks = {
  view: (): string => view,
  run: (): Readonly<R.RunState> | null => run,
  runActive,
  /** result of the fight on screen (null before any fight) */
  lastWon: () => last?.won ?? null,
  setTutorialFight(on: boolean) {
    tutorialFight = on;
  },
  /** Go to the town with the arena selected and in view. `seed` (no run active only) decides the heroes offered next. */
  goTown(seed?: number) {
    if (view === 'fighting' || view === 'replay') return;
    if (seed !== undefined && !runActive()) nextSeed = seed;
    if (run && (run.phase === 'won' || run.phase === 'dead')) run = null;
    treeOpen = null;
    selected = 'arena';
    view = 'town';
    render();
    stage.town.focus('arena');
  },
  town: () => stage.town,
};
