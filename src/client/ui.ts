import { randomAiBuild } from '../sim/bot';
import { SIM_VERSION, cdTicks, simulate } from '../sim/combat';
import { HEROES, HEROES_BY_ID } from '../sim/heroes';
import { explain, reflectEvents, skillDamage, type Explanation } from '../sim/explain';
import { fatigueStart } from '../sim/combat';
import * as M from './views/meta';
import * as P from './views/pages';
import { hashSeed } from '../sim/rng';
import * as R from '../sim/run';
import { HASTE_BONUS, POWER_BONUS, activeBonuses, bonusTotals, bonusValue, matches } from '../sim/links';
import { ARCH_NAME, KEYWORDS, SKILLS, chipsOf, lvOf, nextVariants, nodeOf, type Keyword, type Variant } from '../sim/skills';
import type { BlockStat, Bonus, Build, CombatEvent, CombatResult, SkillInstance } from '../sim/types';
import { renderChibi, rollLook } from './chibi';
import { api, type FightResponse, type ReplayRecord } from './api';
import type { CombatScene } from './combatScene';
import { BUILDINGS, BUILDING_BY_ID } from './townData';
import type { TownScene } from './townScene';
import { dragging, initDrag } from './shop/drag';
import { resetHints, showHints } from './shop/hints';
import { TIMELINE_SECS, timelineHTML } from './shop/timeline';
import { bindChainResize, chainDirs, chainPanelHTML, defaultSlot, dragPreview, gapHTML, offerPairsHTML, partnerChip, resetChains, syncChains, type Dir } from './shop/chains';
import { COIN as COIN_I, coinFly, coinHTML, goldPillHTML, hudAfterRender, hudHTML, popRow } from './shop/hud';
import { initShopDrag, shopDragging } from './shop/shopdrag';
import { clearPick, goToPick, picked, setPick } from './shop/pick';
import { music, sfx, voice } from './audio';
import { IMAGES, skillIcon, archIcon } from './assets';
import { L } from '../i18n';
import { chipText, displayName, onLang, runErr, withLang } from './lang';
import { setView } from './layout';

export interface Stage {
  town: TownScene;
  combat: CombatScene;
  show(key: 'town' | 'combat'): void;
}

type View =
  | 'town' | 'title' | 'shop' | 'fighting' | 'result' | 'lastchance' | 'mark' | 'over' | 'replay' | 'replayDone'
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
let last: FightResponse | null = null;
let lastDay = 0;
let lastDamage = 0;
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
    if (last?.won) music('victory');
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
    return r && r.v === 7 ? r : null;
  } catch {
    return null;
  }
}
/** the name sent to the server: "ผู้เล่น" (empty) makes the server pick a unique Mochi-1234 name */
const playerName = () => (fetchStore(NAME_KEY) || 'ผู้เล่น').slice(0, 24);

// ---------- helpers ----------
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
const randSeed = () => crypto.getRandomValues(new Uint32Array(1))[0];

/** Icon + number chips for a skill variant; each chip explains its keyword on hover / tap. haste = connect-bonus cooldown cut */
function chipsHTML(k: Pick<SkillInstance, 'id' | 'v' | 'mark'>, haste = 0) {
  return `<span class="chips-row">${chipsOf(nodeOf(k), cdTicks(k, haste))
    .map((c) => `<span class="kw kw-${c.kw}" data-kw="${c.kw}">${esc(chipText(c.text))}</span>`)
    .join('')}</span>`;
}

/** Name, level, mark, chips and connect bonuses of a skill (one list row). on = its active bonuses. */
function skillLine(k: Pick<SkillInstance, 'id' | 'v' | 'mark' | 'bonus'>, on: Set<number> | null = null, haste = 0, dir?: (bi: number) => Dir) {
  const mark = k.mark ? ` <span class="mark">${R.MARK_INFO[k.mark].name}</span>` : '';
  const lv = lvOf(k.v);
  const pips = `<i class="lvpips" aria-hidden="true">${Array.from({ length: R.MAX_LV }, (_, j) => `<i class="${j < lv ? 'on' : ''}"></i>`).join('')}</i>`;
  return `<span class="nm">${nodeOf(k).name} <small>Lv${lv}</small>${pips}${mark}</span>${chipsHTML(k, haste)}${bonusChips(k.bonus ?? [], lvOf(k.v), on, null, dir)}`;
}

// ---------- connect bonuses ----------
const BONUS_ICON: Record<Bonus['e'], string> = { dmg: '⚔', shield: '⛨', haste: '»', power: '✦', trigger: '⚡' };
const targetName = (t: string) =>
  t.startsWith('arch:') ? L(`skill สาย${ARCH_NAME[t.slice(5) as 'tank']}`, `a ${ARCH_NAME[t.slice(5) as 'tank']} skill`) : SKILLS[t]?.name ?? t;
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
  return `<span class="bonus-row">${bonus
    .map((b, bi) => {
      const st = on?.has(bi) ? 'on' : can?.has(bi) ? 'can' : 'off';
      const tip = `<div class="tt-h"><b>${L('🔗 โบนัสเชื่อมต่อ', '🔗 Connect bonus')}</b></div><div class="desc">${bonusText(b, lv)}</div>${
        st === 'on'
          ? `<div class="ok">${L('✓ ทำงานอยู่', '✓ Active')}</div>`
          : st === 'can'
            ? `<div class="muted small">${L('คุณมี skill ที่เปิดโบนัสนี้ได้ วางให้ติดกัน', 'You own a skill that switches this on: put them next to each other')}</div>`
            : `<div class="muted small">${L('ยังไม่ทำงาน: วาง skill ที่ตรงเงื่อนไขไว้ช่องบนหรือล่าง', 'Not active: put a matching skill in the slot above or below')}</div>`
      }`;
      return partnerChip(b, lv, st, st === 'on' ? dir(bi) : 'any', tip);
    })
    .join('')}</span>`;
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
      <div class="tb-h">${L('สาย', 'Branch')} ${b.toUpperCase()}: ${d.tree[b].style ?? ''}</div>
      <div class="tb-row">${treeNode(id, b, cur, offer)}<span class="tarrow" aria-hidden="true">→</span>
        <div class="tleaves">${treeNode(id, `${b}1` as Variant, cur, offer)}${treeNode(id, `${b}2` as Variant, cur, offer)}</div></div>
    </div>`;
  return `<div class="modal" data-a="treeClose"><div class="modal-box arch-${d.arch}" role="dialog" aria-label="${L('ต้นไม้ skill', 'Skill tree')} ${d.name}">
    <div class="modal-h"><b>${L('ต้นไม้ skill', 'Skill tree')}: ${d.name}</b> <span class="muted small">${ARCH_NAME[d.arch]}${d.hero ? L(' · เฉพาะฮีโร่', ' · hero only') : ''}</span>
      <button class="small ghost" data-a="treeClose">${L('ปิด ✕', 'Close ✕')}</button></div>
    <p class="muted small">${L(
      'Lv1 → เลือกได้ 1 ใน 2 สายที่ Lv2 → แต่ละสายแยกอีก 2 ทางที่ Lv3 · ร้านจะสุ่มเสนอ 1 ทางของขั้นถัดไปให้ ซื้อแล้วย้อนกลับไม่ได้',
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
function tipBody(k: Pick<SkillInstance, 'id' | 'v' | 'mark' | 'bonus'>, note = '', on: Set<number> | null = null) {
  const d = SKILLS[k.id];
  const node = nodeOf(k);
  const kws = [...new Set(chipsOf(node).map((c) => c.kw))].filter((kw) => kw !== 'cd');
  const branch = k.v.length >= 1 ? d.tree[k.v[0] as 'a' | 'b'].style : '';
  return `<div class="tt-h arch-${d.arch}"><b>${node.name}</b> <small>Lv${lvOf(k.v)}</small>${d.hero ? ` <span class="mark">${L('เฉพาะ', 'unique')}</span>` : ''}
      ${k.mark ? ` <span class="mark">${R.MARK_INFO[k.mark].name}</span>` : ''}</div>
    <div class="muted small">${ARCH_NAME[d.arch]}${branch ? L(` · สาย${branch}`, ` · ${branch}`) : ''}${k.v ? L(` · มาจาก ${d.name}`, ` · from ${d.name}`) : ''}</div>
    <div>${chipsHTML(k)}</div>
    <ul class="kwlist">${kws.map((kw) => `<li><b>${KEYWORDS[kw].icon} ${KEYWORDS[kw].name}</b> ${KEYWORDS[kw].desc}</li>`).join('')}</ul>
    ${k.bonus?.length ? `<div class="muted small">${L('โบนัสเชื่อมต่อ (skill ช่องบนหรือล่าง):', 'Connect bonuses (skill above or below):')}</div><ul class="kwlist bonus">${k.bonus.map((b, bi) => `<li class="${on?.has(bi) ? 'on' : ''}">🔗${BONUS_ICON[b.e]} ${bonusText(b, lvOf(k.v))}${on?.has(bi) ? ' <b class="ok">✓</b>' : ''}</li>`).join('')}</ul>` : ''}
    ${k.mark ? `<div class="muted small">${L('ตรา', 'Mark: ')}${R.MARK_INFO[k.mark].name}: ${R.MARK_INFO[k.mark].desc}</div>` : ''}
    ${note ? `<div class="muted small">${note}</div>` : ''}`;
}

function buildList(b: Build) {
  const act = activeBonuses(b.skills);
  return `<ol class="build readonly">${b.skills
    .map((k, i) => {
      const t = bonusTotals(b.skills, i, act);
      return `<li class="arch-${SKILLS[k.id].arch}"><img class="skill-icon" src="${skillIcon(k.id)}" alt=""><div class="sk-text">${skillLine(k, t.on, t.haste, chainDirs(b.skills, i, act))}</div></li>`;
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
  return `<div class="tt-delta"><div class="td-h">▲ ${esc(nodeOf(owned).name)} Lv${lvOf(owned.v)} → <b>${esc(nodeOf(next).name)} Lv${lvOf(v)}</b></div>${
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
const runActive = () => !!run && (run.phase === 'shop' || run.phase === 'lastchance' || run.phase === 'mark');

function render() {
  if (view !== shownView) {
    shownView = view;
    onEnterView(view);
  }
  stage.show(view === 'town' || view === 'profile' || view === 'leaderboard' ? 'town' : 'combat');
  const html = {
    profile: renderProfile,
    leaderboard: renderLeaderboard,
    town: renderTown,
    title: renderTitle,
    shop: renderShop,
    fighting: renderFighting,
    result: renderResult,
    lastchance: renderLastChance,
    mark: renderMark,
    over: renderOver,
    replay: renderFighting,
    replayDone: renderReplayDone,
  }[view]();
  hideTip();
  // shop → shop: keep each panel's inner scroll (buying or selling must not jump the lists back to the top)
  const keep = view === 'shop' && $panel.querySelector('.shopv') ? [...$panel.querySelectorAll<HTMLElement>('.sv-sec, .sv-side')].map((e) => e.scrollTop) : null;
  $panel.innerHTML = (toast ? `<div class="toast">${esc(toast)}</div>` : '') + html + treeHTML();
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
  if (view === 'shop') mountScout();
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
      body += `<div class="actions"><button class="primary" data-a="enterArena">${runActive() ? L('เล่นต่อ', 'Continue') : L('เข้าสนามประลอง', 'Enter the Arena')}</button></div>`;
    } else if (b.id === 'board') {
      body += `<div class="actions"><button class="primary" data-a="leaderboard">${L('🏆 กระดานผู้นำ', '🏆 Leaderboard')}</button><button data-a="profile">${L('โปรไฟล์และประวัติ', 'Profile and history')}</button></div>`;
    } else if (b.id === 'hall') {
      body += `<div class="actions"><button class="primary" data-a="profile">${L('โปรไฟล์และประวัติของฉัน', 'My profile and history')}</button></div>`;
      body += `<p class="muted">${L(
        `ฮีโร่ทั้งหมด ${HEROES.length} ตัว · แต่ละรอบสุ่มให้เลือก ${R.HERO_CHOICES} ตัวจากคนละสาย`,
        `${HEROES.length} heroes · each run offers ${R.HERO_CHOICES} at random, from different styles`,
      )}</p><div class="heroes">${HEROES.map(
        (h) => `<div class="card arch-${h.arch}">${heroArt(h.id, 'small')}<div class="nm">${h.name}</div><div class="tag">${ARCH_NAME[h.arch]}</div>
          <div class="desc"><b>${L('วิธีเล่น:', 'Play style:')}</b> ${h.style}</div>
          <div class="desc"><b>${L('ความสามารถ:', 'Passive:')}</b> ${h.passive}</div>
          <div class="desc muted">${L('skill เฉพาะ:', 'Unique skill:')} <b>${SKILLS[h.unique].name}</b> ${treeBtn(h.unique, null, null)} ${chipsHTML({ id: h.unique, v: '' })}</div></div>`,
      ).join('')}</div>`;
    } else if (b.future) {
      body += `<p class="muted">${L('เร็วๆ นี้:', 'Coming soon:')} ${b.future}</p>`;
    }
    detail = `<div class="bcard"><h3>${b.name}${b.open ? '' : ` <span class="mark">${L('เร็วๆ นี้', 'soon')}</span>`}</h3>${body}</div>`;
  }
  return `${stageSlot(true, 'town-slot bleed')}
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

function renderTitle() {
  const offered = runActive() ? [] : R.heroChoices((nextSeed ??= randSeed())).map((id) => HEROES_BY_ID[id]);
  if (!previewHero || (offered.length && !offered.some((h) => h.id === previewHero))) previewHero = offered[0]?.id ?? run?.hero ?? null;
  if (scene) scene.idle(previewHero, runActive() ? R.lookOf(run!) : 0);
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
      `ชนะ ${R.WIN_TARGET} ครั้งก่อนเลือด ${R.START_HP} หมด · แพ้เสียเลือด 2–5 ตามวัน · สู้กับ build ของผู้เล่นอื่นในวันเดียวกัน`,
      `Win ${R.WIN_TARGET} times before your ${R.START_HP} HP runs out · a loss costs 2–5 HP depending on the day · fight other players' builds from the same day`,
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
      (h) => `<button class="hero arch-${h.arch}${h.id === previewHero ? ' previewing' : ''}" data-a="start" data-i="${h.id}">
        ${heroArt(h.id)}
        <b class="hero-nm">${h.name}</b><span class="tag">${ARCH_NAME[h.arch]}</span>
        <span class="hero-style">${h.style}</span>
        <span class="hero-passive">${h.passive}</span>
        <span class="muted hero-uniq">${L('skill เฉพาะ:', 'Unique skill:')} ${SKILLS[h.unique].name} ${chipsHTML({ id: h.unique, v: '' })}</span>
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
  const why = maxed ? L('เต็มแล้ว', 'Maxed') : r.gold < price ? L('เงินไม่พอ', 'Not enough gold') : '';
  return `<div class="card offer expand extra${!maxed && r.gold < price ? ' poor' : ''}" title="${L('ช่อง skill +1 ถาวรทั้งรอบ ราคาขึ้นทุกครั้งที่ซื้อ', '+1 skill slot for the whole run; the price goes up each time')}">
    <div class="offer-art" aria-hidden="true">＋</div>
    <div class="offer-name">${L('ช่อง skill +1', '+1 skill slot')}</div>
    <div class="offer-desc">${maxed ? L(`มีครบ ${R.MAX_SLOTS} ช่องแล้ว`, `All ${R.MAX_SLOTS} slots owned`) : L(`ถาวรทั้งรอบ · ตอนนี้ ${R.slotsOf(r)}/${R.MAX_SLOTS} ช่อง`, `For the whole run · now ${R.slotsOf(r)}/${R.MAX_SLOTS} slots`)}</div>
    <button class="buy" data-a="slot" ${why ? 'disabled' : ''}>${buyLabel(why, L('ซื้อ', 'Buy'), price, !maxed && r.gold < price)}</button>
  </div>`;
}

/** Shop card for พรจันทร์ (moon wish): the late-run gold sink, a random upgrade (or a random mark once all are Lv3). */
function wishCard(r: R.RunState) {
  const kind = R.wishKind(r);
  const price = R.wishPrice(r);
  const why = !r.skills.length ? L('ยังไม่มี skill', 'No skills yet') : !kind ? L('ครบทุกอย่างแล้ว', 'All done') : r.gold < price ? L('เงินไม่พอ', 'Not enough gold') : '';
  const pool = kind === 'upgrade' ? r.skills.filter((k) => lvOf(k.v) < R.MAX_LV).length : r.skills.filter((k) => !k.mark).length;
  const desc =
    kind === 'mark'
      ? L(`ทุกตัว Lv3 แล้ว: สุ่มใส่ <b>ตรา</b> ให้ 1 ใน ${pool} skill ที่ยังไม่มีตรา`, `All Lv3: adds a random <b>mark</b> to 1 of ${pool} unmarked skills`)
      : L(`สุ่มอัปเกรด 1 ใน ${pool} skill ที่ยังไม่ Lv3 ขึ้นขั้นถัดไป (สุ่มสาย)`, `Upgrades 1 of ${pool} skills below Lv3 to the next level (random branch)`);
  const tip = `<div class="tt-h"><b>${L('🌙 พรจันทร์', '🌙 Moon Wish')}</b></div><div class="desc">${L(
    `ที่ใช้เงินเหลือ: จ่ายแพงกว่าการ์ดอัปเกรดปกติ แต่ไม่ต้องรอร้านสุ่มเจอ
    เลือก skill และสายให้แบบสุ่ม (ช่องเดิม โบนัสเชื่อมต่อเดิม) · ถ้าทุกตัว Lv3 แล้วจะสุ่มใส่ตราแทน
    · ราคาเริ่ม ${R.WISH_BASE} และแพงขึ้น +2 ทุกครั้งในวันเดียวกัน`,
    `For spare gold: costs more than a normal upgrade card, but you don't have to wait for the shop to roll one.
    It picks the skill and branch at random (same slot, same connect bonuses) · once every skill is Lv3 it adds a random mark instead
    · starts at ${R.WISH_BASE} and costs +2 more each time on the same day`,
  )}</div>`;
  return `<div class="card offer extra wish${kind && r.skills.length && r.gold < price ? ' poor' : ''}" data-ttxt="${esc(tip)}">
    <div class="offer-art" aria-hidden="true">🌙</div>
    <div class="offer-name">${L('พรจันทร์', 'Moon Wish')}</div>
    <div class="offer-desc">${kind || !r.skills.length ? desc : L('ทุก skill Lv3 และมีตราแล้ว', 'Every skill is Lv3 and marked')}</div>
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
function buyOffer(i: number, pos: number | null): string | null {
  const r = run!;
  const o = r.shop[i];
  if (!o) return R.buy(r, i);
  const up = R.upgradeOf(r, o);
  const upIdx = up ? r.skills.indexOf(up) : -1;
  const at = o.v === '' ? Math.max(0, Math.min(r.skills.length, pos ?? defaultSlot(r, o))) : upIdx;
  const from = $panel.querySelector(`.card.offer[data-tip="s:${i}"]`)?.getBoundingClientRect() ?? null;
  const err = R.buy(r, i);
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
  const [k] = r.skills.splice(from, 1);
  r.skills.splice(to, 0, k);
  saveRun();
  render();
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
      return `<div class="card offer arch-${d.arch}${o.v ? ' upgrade' : ''}${isUp ? ' can-up' : ''}${locked ? ' locked' : ''}${poor ? ' poor' : ''}${why ? ' nobuy' : ''}" data-tip="s:${i}">
        ${badge}<div class="offer-top">${lockBtn}<span class="offer-lv">${isUp ? `Lv${lvOf(up.v)} → <b>Lv${lvOf(o.v)}</b>` : `Lv${lvOf(o.v)}`}</span>${treeBtn(o.id, up ? up.v : null, o.v)}</div>
        <div class="offer-name"><img class="skill-icon" src="${skillIcon(o.id)}" alt="" draggable="false">${node.name}</div>
        <div class="offer-meta">${o.v ? `<span class="up">▲ ${L('อัปเกรด', 'Upgrade')} ${d.name}${branch ? ` · ${branch}` : ''}</span>` : `<span class="arch-name">${ARCH_NAME[d.arch]}</span>`}${d.hero ? `<span class="mark">${L('เฉพาะ', 'unique')}</span>` : ''}</div>
        <div class="offer-desc">${chipsHTML({ id: o.id, v: o.v })}${offerPairsHTML(r, o, (b) => offerTip(b, can.has((o.bonus ?? []).indexOf(b))))}</div>
        <button class="buy" data-a="buy" data-i="${i}" ${why ? 'disabled' : ''}>${buyLabel(why, isUp ? L('อัปเกรด', 'Upgrade') : L('ซื้อ', 'Buy'), price, poor)}</button>
      </div>`;
    })
    .join('');
  const act = activeBonuses(r.skills);
  const rows = r.skills
    .map((k, i) => {
      const t = bonusTotals(r.skills, i, act);
      const row = `<li class="skillrow arch-${SKILLS[k.id].arch}" data-tip="g:${i}" data-i="${i}" data-sell="${R.sellPrice(k)}">
        <span class="grip" data-drag="${i}" title="${L('ลากเพื่อย้าย', 'Drag to move')}" aria-hidden="true">⠿</span>
        <span class="sk-no" aria-hidden="true">${i + 1}</span>
        <img class="skill-icon" src="${skillIcon(k.id)}" alt=""><div class="sk-text">${skillLine(k, t.on, t.haste, chainDirs(r.skills, i, act))}</div>
        <div class="sk-btns">
          ${treeBtn(k.id, k.v, null)}
          <button class="ghost mv" data-a="up" data-i="${i}" ${i === 0 ? 'disabled' : ''} aria-label="${L(`เลื่อน ${nodeOf(k).name} ขึ้น`, `Move ${nodeOf(k).name} up`)}">▲</button>
          <button class="ghost mv" data-a="down" data-i="${i}" ${i === r.skills.length - 1 ? 'disabled' : ''} aria-label="${L(`เลื่อน ${nodeOf(k).name} ลง`, `Move ${nodeOf(k).name} down`)}">▼</button>
          <button class="sell" data-a="sell" data-i="${i}">${L('ขาย', 'Sell')} +${R.sellPrice(k)}</button>
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
  ${hudHTML(r, streakText(r.streak), concedeHTML())}
  <aside class="sv-side">
    ${stageSlot(true, 'sv-slot')}
    <div class="sv-hero glass">
      <div class="svh-name"><b>${hero.name}</b> <span class="tag">${ARCH_NAME[hero.arch]}</span></div>
      <p class="sv-sub">${L('วันนี้ได้', 'Today')} +${inc.base}${inc.bonus ? L(` และโบนัส +${inc.bonus}`, ` and bonus +${inc.bonus}`) : ''} · ${hero.passive}</p>
    </div>
    <div class="mm-scout-slot sv-scout"></div>
  </aside>

  <section class="sv-sec sv-shop">
    <div class="sv-h">${goldPillHTML(r.gold)}<h3>${L('ร้าน skill', 'Skill shop')}</h3>
      <button class="reroll" data-a="reroll" ${r.gold < R.REROLL || r.day <= 1 ? 'disabled' : ''} title="${r.day <= 1 ? L('วันแรกเป็นร้านประจำฮีโร่', 'Day 1 is your hero’s shop') : L('สุ่มการ์ดใหม่ (การ์ดที่ล็อกไว้อยู่ต่อ)', 'New cards (locked cards stay)')}">${L('🎲 สุ่มใหม่', '🎲 Reroll')} ${coinHTML(R.REROLL)}</button></div>
    <p class="sv-note">${L(
      '<b>ลากการ์ด</b>ไปวางในรายการ skill ของคุณ (หรือแตะการ์ด แล้วแตะ <b>+</b> ตรงที่อยากวาง) · การ์ด <b>▲</b> = อัปเกรด skill ที่มีอยู่',
      '<b>Drag a card</b> into your skill list (or tap a card, then tap <b>+</b> where you want it) · a <b>▲</b> card levels up a skill you own',
    )} · 🔓 ${L('ล็อกการ์ดไว้ถึงพรุ่งนี้ได้ฟรี', 'lock a card until tomorrow for free')}${nLocked ? L(` (ล็อกอยู่ ${nLocked})`, ` (${nLocked} locked)`) : ''}</p>
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
    <p class="sv-note">${L(
      'ลาก <b>⠿</b> เพื่อจัดลำดับ (หรือกด ▲▼): skill ที่อยู่ติดกัน (บน/ล่าง) เปิด 🔗 โบนัสเชื่อมต่อของกันและกัน · ถ้าครบเวลาพร้อมกัน ตัวบนทำงานก่อน',
      'Drag <b>⠿</b> to reorder (or press ▲▼): skills next to each other (above/below) switch on each other’s 🔗 connect bonuses · when two are ready at once, the upper one goes first',
    )}</p>
    <div class="list-wrap">
      <ol class="skilllist">${rows}${empty}</ol>
      <div class="tl" aria-label="${L('ลำดับการทำงาน', 'Firing order')}">
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
    <button class="primary fightbtn" data-a="fight" ${busy || !r.skills.length ? 'disabled' : ''}>⚔ ${L('สู้วันที่', 'Fight day')} ${r.day} <small>${L('แพ้เสียเลือด', 'a loss costs')} ${R.damageFor(r.day)}${L('', ' HP')}</small></button>
    <button class="ghost" data-a="town" aria-label="${L('กลับเมือง', 'Back to town')}" title="${L('กลับเมือง', 'Back to town')}">🏠</button>
  </div>
  </div>`;
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
    <div class="fv-gloss glass"><b class="fv-gh">${L('📖 คำศัพท์ในไฟต์', '📖 Fight words')}</b><p class="muted small glossary">${L(
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
  <div class="fv-logh">${L('📜 บันทึกการสู้ (ล่าสุดอยู่บน)', '📜 Fight log (newest on top)')}</div>
  <ol id="log" class="log"></ol>
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
  const won = r.winner === me;
  return `<div class="explain">
    <p><b>${esc(x.headline)}</b></p>
    <ul class="facts">${x.facts.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
    ${x.reasons.length ? `<h4>${won ? L('ทำไมชนะ', 'Why you won') : L('ทำไมแพ้ และลองอะไรต่อ', 'Why you lost, and what to try next')}</h4><ul class="reasons">${x.reasons.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
  </div>`;
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
      if (res.stardust > 0) {
        sfx('stardust');
        voice('stardust');
      }
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
  M.addFightNote(r.id, { day, won: f.won, opp: f.opponent.name, fightId: f.fightId, close: x.close, score, text: th.text, textEn: en.text });
}

function renderResult() {
  const f = last!;
  const r = run!;
  const link = f.fightId ? `${location.origin}${location.pathname}?replay=${f.fightId}` : '';
  const oname = names[1];
  const x = lastBuild ? explain(f.result, [lastBuild, f.opponent.build], 0, [youName(), oname], { drawIsLoss: true }) : null;
  const draw = f.result.winner === -1;
  return `<div class="resv">
  <div class="rv-side">
  ${stageSlot(false, 'rv-slot')}
  <div class="mm-result ${f.won ? 'won' : 'lost'}">
    <h2 class="${f.won ? 'win' : 'lose'}">${f.won ? L('ชนะ', 'Victory') : draw ? L('เสมอ (นับเป็นแพ้)', 'Draw (counts as a loss)') : L('แพ้', 'Defeat')} · ${L('วันที่', 'day')} ${lastDay}${x?.close ? ` <span class="mm-tag close">${L('สูสี!', 'Close!')}</span>` : ''}</h2>
    <p>${L('คู่ต่อสู้', 'Opponent')}: <b class="who s1">${esc(oname)}</b> · ${HEROES_BY_ID[f.opponent.build.hero].name}
     ${f.offline ? `<span class="muted">${L('(ออฟไลน์: เซิร์ฟเวอร์ไม่ตอบ สู้กับ AI ในเครื่อง)', '(offline: the server did not answer, so you fought a local AI)')}</span>` : ''}</p>
    <p>${f.won ? L(`ชนะแล้ว ${r.wins}/${R.WIN_TARGET}`, `Wins: ${r.wins}/${R.WIN_TARGET}`) : L(`เสียเลือด ${lastDamage} · เหลือ ${Math.max(0, r.hp)}`, `Lost ${lastDamage} HP · ${Math.max(0, r.hp)} left`)} · ${L('คะแนน build ใหม่', 'new build rating')} ${f.rating}</p>
  </div>
  <div class="actions rv-actions"><button class="primary" data-a="next">${L('ต่อไป ▶', 'Continue ▶')}</button>${x && !x.close ? `<button data-a="rewatch">${L('▶ ดูไฟต์นี้อีกครั้ง', '▶ Watch this fight again')}</button>` : ''}</div>
  </div>
  <div class="rv-main glass">
  ${x ? P.fightHighlights(x, { replayAction: 'rewatch' }) : ''}
  <h3>${L('สรุปการสู้', 'Fight summary')}</h3>
  ${x ? explainHTML(f.result, x, 0) : ''}
  ${lastBuild ? vsSummary(f.result, [lastBuild, f.opponent.build], [youName(), oname]) : ''}
  <h3>${L(`build ของ ${esc(oname)}`, `Build of ${esc(oname)}`)}</h3>
  ${buildList(f.opponent.build)}
  ${link ? `<p class="muted">${L('ลิงก์ replay:', 'Replay link:')} <input class="link" readonly value="${esc(link)}" onclick="this.select()"></p>` : ''}
  </div>
  </div>`;
}

function renderLastChance() {
  scene.idle(run!.hero, R.lookOf(run!));
  return `<div class="lay">
  <div class="lay-side">${stageSlot(true)}</div>
  <section class="lay-main glass">
  <h2 class="lose">${L('เลือดหมด… แต่ยังไม่จบ', 'Out of HP… but not out yet')}</h2>
  <p>${L(
    'คุณเข้าสู่สถานะ <b>กึ่งวิญญาณ</b>: กลับมาด้วยเลือด 1 แพ้อีกครั้งคือจบรอบ เลือกพลังหนึ่งอย่าง',
    'You become a <b>half-spirit</b>: you come back with 1 HP, and one more loss ends the run. Pick one power',
  )}</p>
  <div class="heroes">
    <button class="hero" data-a="lc" data-i="awaken"><b>${L('ตื่นพลัง', 'Awaken')}</b><span>${L('skill Lv1 ทุกใบขึ้นเป็น Lv2 (สุ่มสาย A หรือ B)', 'Every Lv1 skill becomes Lv2 (random branch A or B)')}</span><span class="muted">${L('เหมาะกับ build ที่ของครบแต่เลเวลต่ำ', 'Good for a full build with low levels')}</span></button>
    <button class="hero" data-a="lc" data-i="mark"><b>${L('ตราวิญญาณ', 'Spirit Mark')}</b><span>${L('สุ่มตราหนึ่งในสี่แบบ แล้วเลือกใส่ skill', 'Get 1 of 4 random marks, then pick a skill for it')}</span><span class="muted">${L('เหมาะกับ build ที่มี skill หลักชัด', 'Good for a build with a clear main skill')}</span></button>
    <button class="hero" data-a="lc" data-i="supply"><b>${L('เสบียงสุดท้าย', 'Last Supplies')}</b><span>${L('เงิน 8 และช่อง skill +1 ถาวร', '8 gold and +1 skill slot for good')}</span><span class="muted">${L('เหมาะกับ build ที่ยังขาดชิ้นสำคัญ', 'Good for a build still missing a key piece')}</span></button>
  </div>
  </section>
  </div>`;
}

function renderMark() {
  const r = run!;
  const m = R.MARK_INFO[r.pendingMark!];
  scene.idle(r.hero, R.lookOf(r));
  return `<div class="lay">
  <div class="lay-side">${stageSlot(true)}</div>
  <section class="lay-main glass">
  <h2>${L('ได้ตรา', 'New mark')}: ${m.name}</h2>
  <p>${m.desc} · ${L('เลือก skill ที่จะใส่ตรา', 'pick the skill that gets the mark')}</p>
  <ol class="build">${r.skills
    .map((k, i) => (`<li class="arch-${SKILLS[k.id].arch}"><div class="sk-text">${skillLine(k)}</div><span class="btns"><button data-a="mark" data-i="${i}">${L('ใส่ตรานี้', 'Mark this')}</button></span></li>`))
    .join('')}</ol>
  <div class="actions"><button class="ghost" data-a="mark" data-i="-1">${L('ไม่ใส่', 'Skip')}</button></div>
  </section>
  </div>`;
}

function renderOver() {
  const r = run!;
  scene.idle(r.hero, R.lookOf(r));
  const won = r.phase === 'won';
  claimReward(r);
  const c = M.claimed(r.id);
  const reward = c && 'stardust' in c ? c : null;
  return stageSlot(true, 'over-slot bleed') + P.runOverPage({
    won, conceded: !!r.conceded, hero: r.hero, heroArt: heroArt(r.hero, '', R.lookOf(r)), wins: r.wins, losses: r.losses,
    winTarget: R.WIN_TARGET, days: r.log.length, rating: r.rating, buildHTML: buildList(R.toBuild(r)),
    historyHTML: P.historyList(r.log, M.fightNotes(r.id)), best: M.bestNote(r.id), reward: pendingClaim.has(r.id) ? undefined : reward,
  });
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
      return `${who(e.side)} ${L('ใช้', vb(e.side, 'uses', 'use'))} <b>${varName(e.side, e.skill)}</b> Lv${e.lv}${e.echo ? L(' (ตีซ้ำ)', ' (echo)') : ''}${e.from !== undefined ? ` <small class="muted">${L('🔗ต่อ', '🔗chain')}</small>` : ''}`;
    case 'damage': {
      const attacker = 1 - e.side;
      const src =
        e.src === 'burn'
          ? L('ไฟ', 'burn')
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
        case 'amplify':
          return e.value > 0 ? `&nbsp;&nbsp;${who(e.side)} ${L('บัฟเป็น 2 เท่า', vb(e.side, 'doubles their buffs', 'double your buffs'))} (+${e.value})` : null;
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
    case 'end':
      return `<b>${e.winner === -1 ? L('เสมอ', 'Draw') : who(e.winner) + L(' ชนะ', vb(e.winner, ' wins', ' win'))}</b>`;
    default:
      return null;
  }
}
function addLog(e: CombatEvent) {
  logHist.push(e);
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
  try {
    // playerId lets the server keep a profile for this browser (extra field; older servers ignore it)
    const body = { runId: r.id, name: playerName(), day: r.day, rating: r.rating, build, playerId: M.playerId() };
    res = await api.fight(body as Parameters<typeof api.fight>[0]);
    M.rememberFromFight(res);
    if (import.meta.env.DEV) {
      // the browser can re-run the exact fight from the seed — this is what makes replays shareable
      const local = simulate(build, res.opponent.build, res.seed, r.day);
      if (JSON.stringify(local) !== JSON.stringify(res.result)) console.warn('[arena] client/server sim mismatch');
    }
  } catch (err) {
    console.warn('[arena] server unavailable, fighting a local AI', err);
    const seed = hashSeed(r.seed, 'offline', r.day, Date.now());
    const opp = randomAiBuild(r.day, seed);
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
  R.recordResult(r, res.won, { opp: res.opponent.name, ai: res.opponent.ai, fightId: res.fightId });
  saveRun();
  const oppInfo = res.opponent as FightResponse['opponent'] & { tier?: unknown };
  namesFn = () => [youName(), oppLabel(oppInfo)];
  names = namesFn();
  seedNames = ['คุณ', oppInfo.name];
  noteFight(r, res, build, lastDay);
  view = 'fighting';
  sfx('fight_start');
  voice('fight');
  music('battle');
  render();
  playLast();
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
  return r.phase === 'shop' ? 'shop' : r.phase === 'lastchance' ? 'lastchance' : r.phase === 'mark' ? 'mark' : 'over';
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
  if (!el || (el as HTMLButtonElement).disabled) return;
  const a = el.dataset.a!;
  // the tree window closes from its button or a click on the dark backdrop, not from clicks inside it
  if (a === 'treeClose' && el.classList.contains('modal') && ev.target !== el) return;
  const arg = el.dataset.i ?? '';
  const n = Number(arg);
  let err: string | null = null;
  switch (a) {
    case 'start':
      {
        const seed = nextSeed ?? randSeed();
        if (!R.heroChoices(seed).includes(arg)) break; // only an offered hero can start a run
        nextSeed = null;
        run = R.newRun(arg, seed, uid());
      }
      view = 'shop';
      break;
    case 'resume':
      view = phaseView(run!);
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
      err = buyOffer(n, null);
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
        toast = w.mark
          ? L(`🌙 พรจันทร์: ${nodeOf(k).name} ได้ตรา${R.MARK_INFO[w.mark].name}`, `🌙 Moon Wish: ${nodeOf(k).name} gets the ${R.MARK_INFO[w.mark].name} mark`)
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
      if (view === 'fighting') {
        scene.idle(null); // stop the replay
        busy = false;
      }
      view = 'over';
      break;
    case 'fight':
      void doFight();
      return;
    case 'speed':
      scene.speed = n;
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
      R.applyMark(run!, n);
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
    case 'lbPeriod':
      if (arg !== 'season' && arg !== 'day') return;
      lbPeriod = arg;
      lbData = null;
      lbLoading = false;
      break;
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
  scene.idle(id, 0);
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
  run = loadRun();
  const rid = new URLSearchParams(location.search).get('replay');
  if (rid) {
    stage.show('combat');
    void openReplay(rid);
    return;
  }
  view = 'town';
  render();
}
