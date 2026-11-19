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
import { music, sfx, voice } from './audio';
import { IMAGES } from './assets';

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
/** Opponent label: real name, or AI + tier. Never "คุณ" (that is you). */
function oppLabel(o: { name: string; ai: boolean; tier?: unknown }) {
  const nm = o.name && o.name !== 'คุณ' ? o.name : 'คู่ต่อสู้';
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
const playerName = () => (fetchStore(NAME_KEY) || 'ผู้เล่น').slice(0, 24);

// ---------- helpers ----------
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
const randSeed = () => crypto.getRandomValues(new Uint32Array(1))[0];

/** Icon + number chips for a skill variant; each chip explains its keyword on hover / tap. haste = connect-bonus cooldown cut */
function chipsHTML(k: Pick<SkillInstance, 'id' | 'v' | 'mark'>, haste = 0) {
  return `<span class="chips-row">${chipsOf(nodeOf(k), cdTicks(k, haste))
    .map((c) => `<span class="kw kw-${c.kw}" data-kw="${c.kw}">${esc(c.text)}</span>`)
    .join('')}</span>`;
}

/** Name, level, mark, chips and connect bonuses of a skill (one list row). on = its active bonuses. */
function skillLine(k: Pick<SkillInstance, 'id' | 'v' | 'mark' | 'bonus'>, on: Set<number> | null = null, haste = 0) {
  const mark = k.mark ? ` <span class="mark">${R.MARK_INFO[k.mark].name}</span>` : '';
  return `<span class="nm">${nodeOf(k).name} <small>Lv${lvOf(k.v)}</small>${mark}</span>${chipsHTML(k, haste)}${bonusChips(k.bonus ?? [], lvOf(k.v), on)}`;
}

// ---------- connect bonuses ----------
const BONUS_ICON: Record<Bonus['e'], string> = { dmg: '⚔', shield: '⛨', haste: '»', power: '▲', trigger: '⚡' };
const targetName = (t: string) => (t.startsWith('arch:') ? `skill สาย${ARCH_NAME[t.slice(5) as 'tank']}` : SKILLS[t]?.name ?? t);
function bonusEffect(b: Bonus, lv: number) {
  const v = bonusValue(b.e, lv);
  return {
    dmg: `skill นี้ทำดาเมจ +${v} ทุกครั้งที่ตี`,
    shield: `ทุกครั้งที่ skill นี้ทำงาน คุณได้โล่ +${v}`,
    haste: `คูลดาวน์ของ skill นี้สั้นลง ${Math.round(HASTE_BONUS * 100)}%`,
    power: `ตัวเลขทุกอย่างของ skill นี้แรงขึ้น ${Math.round(POWER_BONUS * 100)}%`,
    trigger: 'เมื่อ skill นี้ทำงาน ตัวที่ติดกันนั้นทำงานทันทีด้วย (คูลดาวน์ของตัวนั้นไม่รีเซ็ต)',
  }[b.e];
}
const bonusText = (b: Bonus, lv: number) => `ติดกับ <b>${targetName(b.t)}</b> (ช่องบนหรือล่าง): ${bonusEffect(b, lv)}`;
/**
 * Small chips for connect bonuses. on = active ones (null = not in the list yet).
 * can = for shop offers: bonuses an owned skill could switch on.
 */
function bonusChips(bonus: Bonus[], lv: number, on: Set<number> | null, can: Set<number> | null = null) {
  if (!bonus.length) return '';
  return `<span class="bonus-row">${bonus
    .map((b, bi) => {
      const st = on?.has(bi) ? 'on' : can?.has(bi) ? 'can' : 'off';
      const tip = `<div class="tt-h"><b>🔗 โบนัสเชื่อมต่อ</b></div><div class="desc">${bonusText(b, lv)}</div>${
        st === 'on'
          ? '<div class="ok">✓ ทำงานอยู่</div>'
          : st === 'can'
            ? '<div class="muted small">คุณมี skill ที่เปิดโบนัสนี้ได้ วางให้ติดกัน</div>'
            : '<div class="muted small">ยังไม่ทำงาน: วาง skill ที่ตรงเงื่อนไขไว้ช่องบนหรือล่าง</div>'
      }`;
      return `<span class="bchip ${st}" data-ttxt="${esc(tip)}">🔗${BONUS_ICON[b.e]} ${esc(targetName(b.t))}</span>`;
    })
    .join('')}</span>`;
}

/** Panel listing every connect bonus that is on right now: which skill, from which neighbour, what it adds. */
function bonusPanel(skills: SkillInstance[], act: ReturnType<typeof activeBonuses>) {
  const total = skills.reduce((n, k) => n + (k.bonus?.length ?? 0), 0);
  const where = (from: number, to: number) => (to < from ? 'ช่องบน' : 'ช่องล่าง');
  const items = act
    .map((a) => {
      const k = skills[a.from];
      const lv = lvOf(k.v);
      const by = a.to.map((j) => `<b>${nodeOf(skills[j]).name}</b> <small class="muted">(${where(a.from, j)})</small>`).join(' และ ');
      return `<li class="bp-item bp-${a.b.e}">
        <span class="bp-icon" aria-hidden="true">${BONUS_ICON[a.b.e]}</span>
        <span class="bp-text"><b>${nodeOf(k).name}</b> <small>Lv${lv}</small>: ${bonusEffect(a.b, lv)}<br><small class="muted">เปิดโดย ${by}</small></span>
      </li>`;
    })
    .join('');
  return `<aside class="bonus-panel" aria-label="โบนัสเชื่อมต่อที่ทำงาน">
    <div class="bp-h">🔗 โบนัสเชื่อมต่อที่ทำงาน <span class="bp-count">${act.length}/${total}</span></div>
    ${act.length ? `<ul class="bp-list">${items}</ul>` : `<p class="muted small">ยังไม่มีโบนัสทำงาน · ดูชิป 🔗 ใต้แต่ละ skill แล้วลาก ⠿ (หรือกด ▲▼) จัดให้ skill ที่ตรงเงื่อนไขอยู่ติดกัน (ช่องบนหรือล่าง)</p>`}
    ${act.length && total > act.length ? `<p class="muted small">อีก ${total - act.length} โบนัสยังไม่ทำงาน</p>` : ''}
  </aside>`;
}

// ---------- skill tree window ----------
function treeNode(id: string, v: Variant, cur: string | null, offer: string | null) {
  const n = SKILLS[id].tree[v];
  let cls = '';
  let tag = '';
  if (cur !== null) {
    if (v === cur) [cls, tag] = ['cur', 'ตอนนี้'];
    else if (cur.startsWith(v)) cls = 'past';
    else if ((nextVariants(cur) as string[]).includes(v)) [cls, tag] = ['next', 'ขั้นถัดไป'];
    else if (!v.startsWith(cur)) [cls, tag] = ['gone', 'ไปไม่ได้แล้ว'];
  }
  if (v === offer) [cls, tag] = [`${cls} offer`, 'ในร้าน'];
  return `<div class="tnode ${cls}"><div class="tn-h"><b>${n.name}</b> <small>Lv${lvOf(v)}</small>${tag ? ` <span class="tn-tag">${tag}</span>` : ''}</div>${chipsHTML({ id, v })}</div>`;
}
function treeHTML() {
  if (!treeOpen) return '';
  const { id, cur, offer } = treeOpen;
  const d = SKILLS[id];
  const branch = (b: 'a' | 'b') => `<div class="tbranch">
      <div class="tb-h">สาย ${b.toUpperCase()}: ${d.tree[b].style ?? ''}</div>
      <div class="tb-row">${treeNode(id, b, cur, offer)}<span class="tarrow" aria-hidden="true">→</span>
        <div class="tleaves">${treeNode(id, `${b}1` as Variant, cur, offer)}${treeNode(id, `${b}2` as Variant, cur, offer)}</div></div>
    </div>`;
  return `<div class="modal" data-a="treeClose"><div class="modal-box arch-${d.arch}" role="dialog" aria-label="ต้นไม้ skill ${d.name}">
    <div class="modal-h"><b>ต้นไม้ skill: ${d.name}</b> <span class="muted small">${ARCH_NAME[d.arch]}${d.hero ? ' · เฉพาะฮีโร่' : ''}</span>
      <button class="small ghost" data-a="treeClose">ปิด ✕</button></div>
    <p class="muted small">Lv1 → เลือกได้ 1 ใน 2 สายที่ Lv2 → แต่ละสายแยกอีก 2 ทางที่ Lv3 · ร้านจะสุ่มเสนอ 1 ทางของขั้นถัดไปให้ ซื้อแล้วย้อนกลับไม่ได้</p>
    <div class="tree">
      <div class="troot">${treeNode(id, '', cur, offer)}</div>
      <div class="tbranches">${branch('a')}${branch('b')}</div>
    </div>
  </div></div>`;
}
/** ⓘ button that opens the skill tree. cur = variant you own (null = not owned), offer = variant in the shop */
const treeBtn = (id: string, cur: string | null, offer: string | null) =>
  `<button class="small ghost info" data-a="tree" data-i="${id}" data-own="${cur !== null ? 1 : 0}" data-cur="${cur ?? ''}" data-offer="${offer ?? ''}" aria-label="ดูต้นไม้ skill" title="ดูต้นไม้ skill ทั้งหมด">ⓘ</button>`;

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
  return `<div class="tt-h arch-${d.arch}"><b>${node.name}</b> <small>Lv${lvOf(k.v)}</small>${d.hero ? ' <span class="mark">เฉพาะ</span>' : ''}
      ${k.mark ? ` <span class="mark">${R.MARK_INFO[k.mark].name}</span>` : ''}</div>
    <div class="muted small">${ARCH_NAME[d.arch]}${branch ? ` · สาย${branch}` : ''}${k.v ? ` · มาจาก ${d.name}` : ''}</div>
    <div>${chipsHTML(k)}</div>
    <ul class="kwlist">${kws.map((kw) => `<li><b>${KEYWORDS[kw].icon} ${KEYWORDS[kw].name}</b> ${KEYWORDS[kw].desc}</li>`).join('')}</ul>
    ${k.bonus?.length ? `<div class="muted small">โบนัสเชื่อมต่อ (skill ช่องบนหรือล่าง):</div><ul class="kwlist bonus">${k.bonus.map((b, bi) => `<li class="${on?.has(bi) ? 'on' : ''}">🔗${BONUS_ICON[b.e]} ${bonusText(b, lvOf(k.v))}${on?.has(bi) ? ' <b class="ok">✓</b>' : ''}</li>`).join('')}</ul>` : ''}
    ${k.mark ? `<div class="muted small">ตรา${R.MARK_INFO[k.mark].name}: ${R.MARK_INFO[k.mark].desc}</div>` : ''}
    ${note ? `<div class="muted small">${note}</div>` : ''}`;
}

function buildList(b: Build) {
  const act = activeBonuses(b.skills);
  return `<ol class="build readonly">${b.skills
    .map((k, i) => {
      const t = bonusTotals(b.skills, i, act);
      return `<li class="arch-${SKILLS[k.id].arch}"><div class="sk-text">${skillLine(k, t.on, t.haste)}</div></li>`;
    })
    .join('')}</ol>`;
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
    if (owned) return tipBody({ ...owned, v: o.v }, `อัปเกรดจาก ${nodeOf(owned).name} Lv${lvOf(owned.v)} (ใช้ช่องเดิม และโบนัสเชื่อมต่อเดิม)`);
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
  if (s >= 2) return `ชนะติด ${s}`;
  if (s <= -2) return `แพ้ติด ${-s}`;
  return '';
}

// ---------- views ----------
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
  $panel.innerHTML = (toast ? `<div class="toast">${esc(toast)}</div>` : '') + html + treeHTML();
  toast = '';
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
    (x) => `<button class="chip ${x.id === selected ? 'on' : ''}" data-a="goto" data-i="${x.id}">${x.name}${x.open ? '' : ' <small class="muted">เร็วๆ นี้</small>'}</button>`,
  ).join('');
  let detail = '';
  if (b) {
    let body = `<p>${b.desc}</p>`;
    if (b.id === 'arena') {
      if (runActive()) {
        const r = run!;
        body += `<p>รอบที่เล่นค้างไว้: <b>${HEROES_BY_ID[r.hero].name}</b> · วันที่ ${r.day} · ชนะ ${r.wins}/${R.WIN_TARGET} · เลือด ${r.hp}/${R.START_HP}</p>`;
      }
      body += `<div class="actions"><button class="primary" data-a="enterArena">${runActive() ? 'เล่นต่อ' : 'เข้าสนามประลอง'}</button></div>`;
    } else if (b.id === 'board') {
      body += `<div class="actions"><button class="primary" data-a="leaderboard">🏆 กระดานผู้นำ</button><button data-a="profile">โปรไฟล์และประวัติ</button></div>`;
    } else if (b.id === 'hall') {
      body += `<div class="actions"><button class="primary" data-a="profile">โปรไฟล์และประวัติของฉัน</button></div>`;
      body += `<p class="muted">ฮีโร่ทั้งหมด ${HEROES.length} ตัว · แต่ละรอบสุ่มให้เลือก ${R.HERO_CHOICES} ตัวจากคนละสาย</p><div class="heroes">${HEROES.map(
        (h) => `<div class="card arch-${h.arch}">${heroArt(h.id, 'small')}<div class="nm">${h.name}</div><div class="tag">${ARCH_NAME[h.arch]}</div>
          <div class="desc"><b>วิธีเล่น:</b> ${h.style}</div>
          <div class="desc"><b>ความสามารถ:</b> ${h.passive}</div>
          <div class="desc muted">skill เฉพาะ: <b>${SKILLS[h.unique].name}</b> ${treeBtn(h.unique, null, null)} ${chipsHTML({ id: h.unique, v: '' })}</div></div>`,
      ).join('')}</div>`;
    } else if (b.future) {
      body += `<p class="muted">เร็วๆ นี้: ${b.future}</p>`;
    }
    detail = `<div class="bcard"><h3>${b.name}${b.open ? '' : ' <span class="mark">เร็วๆ นี้</span>'}</h3>${body}</div>`;
  }
  return `
  <h2>เมืองของคุณ</h2>
  <p class="muted">ลากซ้ายขวาเพื่อเดินดูเมือง (ใช้ล้อเมาส์หรือปุ่มลูกศรก็ได้) · แตะอาคารเพื่อดูรายละเอียด · แตะแผนที่ย่อด้านล่างเพื่อกระโดดไปจุดนั้น</p>
  <div class="chips">${chips}</div>
  ${detail}`;
}

function renderTitle() {
  if (scene) scene.idle(null);
  const resume = runActive()
    ? `<button class="primary" data-a="resume">เล่นต่อ: ${HEROES_BY_ID[run!.hero].name} วันที่ ${run!.day} (ชนะ ${run!.wins})</button>`
    : '';
  return `
  <div class="actions"><button class="ghost" data-a="town">← กลับเมือง</button></div>
  <img class="brand-logo" src="${IMAGES.logo}" alt="Mochi Moon" width="320" height="120">
  <h2>เลือกฮีโร่</h2>
  <p class="muted">ชนะ ${R.WIN_TARGET} ครั้งก่อนเลือด ${R.START_HP} หมด · แพ้เสียเลือด 2–5 ตามวัน · สู้กับ build ของผู้เล่นอื่นในวันเดียวกัน</p>
  <label class="name">ชื่อของคุณ <input id="name" maxlength="24" value="${esc(fetchStore(NAME_KEY) ?? '')}" placeholder="ผู้เล่น"></label>
  ${resume}
  ${runActive() ? '' : `<p class="muted">รอบนี้มีให้เลือก ${R.HERO_CHOICES} ตัวจากคนละสาย (ดูฮีโร่ทั้งหมดได้ที่หอฮีโร่ในเมือง)</p>`}
  <div class="heroes">${(runActive() ? [] : R.heroChoices((nextSeed ??= randSeed())).map((id) => HEROES_BY_ID[id])).map(
    (h) => `<button class="hero arch-${h.arch}" data-a="start" data-i="${h.id}">
      ${heroArt(h.id)}
      <b>${h.name}</b><span class="tag">${ARCH_NAME[h.arch]}</span>
      <span>${h.style}</span>
      <span>${h.passive}</span>
      <span class="muted">skill เฉพาะ: ${SKILLS[h.unique].name} ${chipsHTML({ id: h.unique, v: '' })}</span>
    </button>`,
  ).join('')}</div>`;
}

/** Shop card that sells +1 skill slot. */
function slotCard(r: R.RunState) {
  const price = R.slotPrice(r);
  const maxed = R.slotsOf(r) >= R.MAX_SLOTS;
  const why = maxed ? 'เต็มแล้ว' : r.gold < price ? 'เงินไม่พอ' : '';
  return `<div class="card offer expand extra" title="ช่อง skill +1 ถาวรทั้งรอบ ราคาขึ้นทุกครั้งที่ซื้อ">
    <div class="offer-art" aria-hidden="true">＋</div>
    <div class="offer-name">ช่อง skill +1</div>
    <div class="offer-desc">${maxed ? `มีครบ ${R.MAX_SLOTS} ช่องแล้ว` : `ถาวรทั้งรอบ · ตอนนี้ ${R.slotsOf(r)}/${R.MAX_SLOTS} ช่อง`}</div>
    <button class="buy" data-a="slot" ${why ? 'disabled' : ''}>${why || `ซื้อ <span class="coin">${price}</span>`}</button>
  </div>`;
}

/** Shop card for พรจันทร์ (moon wish): the late-run gold sink, a random upgrade (or a random mark once all are Lv3). */
function wishCard(r: R.RunState) {
  const kind = R.wishKind(r);
  const price = R.wishPrice(r);
  const why = !r.skills.length ? 'ยังไม่มี skill' : !kind ? 'ครบทุกอย่างแล้ว' : r.gold < price ? 'เงินไม่พอ' : '';
  const pool = kind === 'upgrade' ? r.skills.filter((k) => lvOf(k.v) < R.MAX_LV).length : r.skills.filter((k) => !k.mark).length;
  const desc =
    kind === 'mark'
      ? `ทุกตัว Lv3 แล้ว: สุ่มใส่ <b>ตรา</b> ให้ 1 ใน ${pool} skill ที่ยังไม่มีตรา`
      : `สุ่มอัปเกรด 1 ใน ${pool} skill ที่ยังไม่ Lv3 ขึ้นขั้นถัดไป (สุ่มสาย)`;
  const tip = `<div class="tt-h"><b>🌙 พรจันทร์</b></div><div class="desc">ที่ใช้เงินเหลือ: จ่ายแพงกว่าการ์ดอัปเกรดปกติ แต่ไม่ต้องรอร้านสุ่มเจอ
    เลือก skill และสายให้แบบสุ่ม (ช่องเดิม โบนัสเชื่อมต่อเดิม) · ถ้าทุกตัว Lv3 แล้วจะสุ่มใส่ตราแทน
    · ราคาเริ่ม ${R.WISH_BASE} และแพงขึ้น +2 ทุกครั้งในวันเดียวกัน</div>`;
  return `<div class="card offer extra wish" data-ttxt="${esc(tip)}">
    <div class="offer-art" aria-hidden="true">🌙</div>
    <div class="offer-name">พรจันทร์</div>
    <div class="offer-desc">${kind || !r.skills.length ? desc : 'ทุก skill Lv3 และมีตราแล้ว'}</div>
    <button class="buy" data-a="wish" ${why ? 'disabled' : ''}>${why || `ขอพร <span class="coin">${price}</span>`}</button>
  </div>`;
}

/** Re-draw only the timeline for a list order (used live while dragging). */
function previewOrder(order: number[]) {
  const r = run;
  const el = document.getElementById('timeline');
  if (!r || !el) return;
  const skills = order.map((i) => r.skills[i]).slice(0, R.slotsOf(r));
  el.innerHTML = timelineHTML(skills, r.hero);
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
      if (!o) return `<div class="card empty">ซื้อแล้ว</div>`;
      const d = SKILLS[o.id];
      const node = d.tree[o.v as '' | 'a'];
      const up = R.upgradeOf(r, o);
      const price = R.priceOf(o);
      const stale = o.v !== '' && !up;
      const full = o.v === '' && r.skills.length >= slots;
      const why = stale ? 'ใช้ไม่ได้แล้ว' : r.gold < price ? 'เงินไม่พอ' : full ? 'ช่องเต็ม' : '';
      const branch = o.v ? d.tree[o.v[0] as 'a' | 'b'].style : '';
      // which of the offer's bonuses an owned skill could switch on
      const can = new Set((o.bonus ?? []).map((b, bi) => (r.skills.some((k) => matches(b.t, k)) ? bi : -1)).filter((bi) => bi >= 0));
      const locked = R.isLocked(r, i);
      const lockBtn = `<button class="lock${locked ? ' on' : ''}" data-a="lock" data-i="${i}" aria-pressed="${locked}"
        aria-label="${locked ? 'ปลดล็อกการ์ดนี้' : 'ล็อกการ์ดนี้ไว้ถึงพรุ่งนี้'}" title="${locked ? 'ล็อกอยู่: การ์ดนี้จะอยู่ต่อแม้สุ่มใหม่หรือข้ามวัน (กดเพื่อปลด)' : 'ล็อก: เก็บการ์ดนี้ไว้ถึงพรุ่งนี้ (ฟรี)'}">${locked ? '🔒' : '🔓'}</button>`;
      return `<div class="card offer arch-${d.arch}${o.v ? ' upgrade' : ''}${locked ? ' locked' : ''}" data-tip="s:${i}">
        <div class="offer-top">${lockBtn}<span class="offer-lv">Lv${lvOf(o.v)}</span>${treeBtn(o.id, up ? up.v : null, o.v)}</div>
        <div class="offer-name">${node.name}</div>
        <div class="offer-meta">${o.v ? `<span class="up">⬆ อัปเกรด ${d.name}${branch ? ` · ${branch}` : ''}</span>` : `<span class="arch-name">${ARCH_NAME[d.arch]}</span>`}${d.hero ? '<span class="mark">เฉพาะ</span>' : ''}</div>
        <div class="offer-desc">${chipsHTML({ id: o.id, v: o.v })}${o.v ? '' : bonusChips(o.bonus ?? [], 1, null, can)}</div>
        <button class="buy" data-a="buy" data-i="${i}" ${why ? 'disabled' : ''}>${why || `ซื้อ <span class="coin">${price}</span>`}</button>
      </div>`;
    })
    .join('');
  const act = activeBonuses(r.skills);
  /** is there an active bonus between row i and row i+1 (either direction)? */
  const linked = (i: number) => act.some((a) => (a.from === i && a.to.includes(i + 1)) || (a.from === i + 1 && a.to.includes(i)));
  const rows = r.skills
    .map((k, i) => {
      const t = bonusTotals(r.skills, i, act);
      const row = `<li class="skillrow arch-${SKILLS[k.id].arch}" data-tip="g:${i}" data-i="${i}">
        <span class="grip" data-drag="${i}" title="ลากเพื่อย้าย" aria-hidden="true">⠿</span>
        <span class="sk-no" aria-hidden="true">${i + 1}</span>
        <div class="sk-text">${skillLine(k, t.on, t.haste)}</div>
        <div class="sk-btns">
          ${treeBtn(k.id, k.v, null)}
          <button class="ghost mv" data-a="up" data-i="${i}" ${i === 0 ? 'disabled' : ''} aria-label="เลื่อน ${nodeOf(k).name} ขึ้น">▲</button>
          <button class="ghost mv" data-a="down" data-i="${i}" ${i === r.skills.length - 1 ? 'disabled' : ''} aria-label="เลื่อน ${nodeOf(k).name} ลง">▼</button>
          <button class="sell" data-a="sell" data-i="${i}">ขาย +${R.sellPrice(k)}</button>
        </div>
      </li>`;
      const gap = i < r.skills.length - 1 ? `<li class="linkgap${linked(i) ? ' on' : ''}" aria-hidden="true">${linked(i) ? '🔗 เชื่อมต่อ' : ''}</li>` : '';
      return row + gap;
    })
    .join('');
  const empty = '<li class="skillrow emptyslot"><span class="muted">ช่องว่าง: ซื้อ skill จากร้าน</span></li>'.repeat(Math.max(0, slots - r.skills.length));
  const inc = r.lastIncome;
  const nLocked = r.shop.filter((_, i) => R.isLocked(r, i)).length;
  resetHints();
  return `<div class="shopv">
  <div class="sv-top">
    <span class="pill"><small>วันที่</small> <b>${r.day}</b></span>
    <span class="pill hp"><small>เลือด</small> <b>${r.hp}</b>/${R.START_HP}${r.ghost ? ' <span class="mark">กึ่งวิญญาณ</span>' : ''}</span>
    <span class="pill win"><small>ชนะ</small> <b>${r.wins}</b>/${R.WIN_TARGET}</span>
    <span class="pill gold"><small>เงิน</small> <b>${r.gold}</b></span>
    <span class="pill"><small>คะแนน</small> <b>${r.rating}</b></span>
    ${streakText(r.streak) ? `<span class="pill streak">${streakText(r.streak)}</span>` : ''}
    <span class="stats-right">${concedeHTML()}</span>
  </div>
  <p class="sv-sub">วันนี้ได้ +${inc.base}${inc.bonus ? ` และโบนัส +${inc.bonus}` : ''} · <b>${hero.name}</b>: ${hero.passive}</p>

  <section class="sv-sec">
    <div class="sv-h"><h3>ร้าน skill</h3>
      <button class="reroll" data-a="reroll" ${r.gold < R.REROLL || r.day <= 1 ? 'disabled' : ''} title="${r.day <= 1 ? 'วันแรกเป็นร้านประจำฮีโร่' : 'สุ่มการ์ดใหม่ (การ์ดที่ล็อกไว้อยู่ต่อ)'}">🎲 สุ่มใหม่ <span class="coin">${R.REROLL}</span></button></div>
    <p class="sv-note">🔓 กดรูปกุญแจเพื่อ<b>ล็อกการ์ด</b>ไว้ (ฟรี): การ์ดที่ล็อกจะอยู่ต่อแม้กดสุ่มใหม่ และกลับมาในร้านพรุ่งนี้${nLocked ? ` · ล็อกอยู่ ${nLocked} ใบ` : ''}
      · ชี้ (หรือแตะ) การ์ดเพื่อดูว่าควรวางติดกับ skill ไหน</p>
    <div class="shop">${shop}${slotCard(r)}${wishCard(r)}</div>
  </section>

  <section class="sv-sec">
    <div class="sv-h"><h3>skill ของคุณ <span class="sv-count">${r.skills.length}/${slots}</span></h3>
      <span class="sv-hint">โบนัสเชื่อมต่อทำงาน ${act.length} อัน</span></div>
    <p class="sv-note">ลาก <b>⠿</b> เพื่อจัดลำดับ (หรือกด ▲▼): skill ที่อยู่ติดกัน (บน/ล่าง) เปิด 🔗 โบนัสเชื่อมต่อของกันและกัน · ถ้าครบเวลาพร้อมกัน ตัวบนทำงานก่อน</p>
    <div class="list-wrap">
      <ol class="skilllist">${rows}${empty}</ol>
      <div class="tl" aria-label="ลำดับการทำงาน">
        <div class="tl-h"><b>⏱ ใครทำงานก่อน: ${TIMELINE_SECS} วิแรก</b>
          <span class="tl-legend"><i class="tl-dot own"></i> ครบคูลดาวน์ <i class="tl-dot trig">⚡</i> โบนัสสั่งให้ทำงานตาม</span></div>
        <div id="timeline">${timelineHTML(R.toBuild(r).skills, r.hero)}</div>
        <p class="tl-foot">จำลองด้วยระบบสู้จริง กับหุ่นซ้อมที่ไม่ตีกลับ · ถ้าศัตรูแช่แข็งหรือทำให้ช้า skill จะทำงานช้ากว่านี้</p>
      </div>
      ${bonusPanel(r.skills, act)}
    </div>
  </section>

  <div class="sv-fight">
    <span class="pill gold"><small>เงินเหลือ</small> <b>${r.gold}</b></span>
    <button class="primary fightbtn" data-a="fight" ${busy || !r.skills.length ? 'disabled' : ''}>⚔ สู้วันที่ ${r.day} <small>แพ้เสียเลือด ${R.damageFor(r.day)}</small></button>
    <button class="ghost" data-a="town" aria-label="กลับเมือง" title="กลับเมือง">🏠</button>
  </div>
  </div>`;
}

/** Give up the whole run. Shown in the top bar of the shop and during your own fights. */
function concedeHTML() {
  if (!run || run.phase === 'won' || run.phase === 'dead') return '';
  return confirmConcede
    ? `<span class="concede-box"><span class="concede-ask">ยอมแพ้แล้วรอบนี้จะจบทันที แน่ใจไหม?</span>
       <button class="small danger" data-a="concedeYes">ยืนยันยอมแพ้</button>
       <button class="small ghost" data-a="concedeNo">ไม่ เล่นต่อ</button></span>`
    : '<button class="small concede-btn" data-a="concede">🏳 ยอมแพ้</button>';
}

function renderFighting() {
  return `
  <p class="mm-versus"><span class="who s0">${esc(names[0])}</span> <span class="muted">vs</span> <span class="who s1">${esc(names[1])}</span> ${view === 'fighting' ? `<span class="stats-right">${concedeHTML()}</span>` : ''}</p>
  <div class="actions mm-speed">
    ${[1, 2, 4].map((s) => `<button class="small ${scene.speed === s ? 'on' : ''}" data-a="speed" data-i="${s}">${s}x</button>`).join('')}
    <button class="small" data-a="skip">ข้าม</button>
  </div>
  <p class="muted small glossary"><b>พลังโจมตี</b> = ดาเมจเพิ่มให้ทุกการโจมตีของทุก skill · <b>รวมพลัง</b> = การโจมตีครั้งถัดไป 1 ครั้งแรงขึ้น ·
    <b>หนาม</b> = สะท้อนดาเมจทุกครั้งที่โดนตี · <b>ใจเหล็ก</b> = โดนแช่แข็ง/ช้าน้อยลง 60% · <b>ไฟ</b> = เสียเลือดทุกวิ ไม่สนโล่ ·
    <b>แช่แข็ง</b> = skill ทุกตัวหยุดนับคูลดาวน์ · <b>ช้า</b> = คูลดาวน์ทุกตัวเดินช้าลง</p>
  <ol id="log" class="log"></ol>`;
}

const PILES: { key: keyof BlockStat; name: string; unit: string; help: string }[] = [
  { key: 'd', name: 'ดาเมจ', unit: '', help: 'ดาเมจที่แต่ละ skill ทำ (รวมส่วนที่โล่ศัตรูกันไว้)' },
  { key: 'bf', name: 'บัฟ', unit: '', help: 'ดาเมจที่บัฟของ skill นั้น (พลังโจมตี รวมพลัง) เพิ่มให้การโจมตีของทุก skill' },
  { key: 'h', name: 'ฟื้นเลือด', unit: '', help: 'เลือดที่ฟื้นได้จริง' },
  { key: 'sh', name: 'โล่', unit: '', help: 'โล่ที่ได้รับ' },
  { key: 'fz', name: 'แช่แข็ง', unit: ' วิ', help: 'เวลาที่ศัตรูถูกแช่แข็ง' },
];

const YOU = '#3987e5';
const FOE = '#d95926';

/**
 * Post-fight "You vs Enemy": mirrored bars per kind of value (you left, enemy right, same scale per row),
 * then where the damage each side took came from, as ranked bars. Hover any bar for the skills behind it.
 */
/** C6: Thai explanation of the fight (headline, facts, why) from side `me`'s point of view. */
function explainHTML(r: CombatResult, x: Explanation, me: 0 | 1) {
  const won = r.winner === me;
  return `<div class="explain">
    <p><b>${esc(x.headline)}</b></p>
    <ul class="facts">${x.facts.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
    ${x.reasons.length ? `<h4>${won ? 'ทำไมชนะ' : 'ทำไมแพ้ และลองอะไรต่อ'}</h4><ul class="reasons">${x.reasons.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
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
      : '<div class="muted">ไม่มี</div>';
  };
  const rows = PILES.map((pile) => {
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
    if (fatigue[side]) list.push({ name: `เหนื่อยล้า (หลัง ${(fatigueStart(r.day) / 10).toFixed(0)} วิ)`, v: fatigue[side] });
    list.sort((a, b) => b.v - a.v);
    const total = list.reduce((n, x) => n + x.v, 0);
    if (!total) return '<p class="muted small">ไม่โดนดาเมจเลย</p>';
    const top = list.slice(0, 6);
    const rest = list.slice(6).reduce((n, x) => n + x.v, 0);
    if (rest) top.push({ name: 'อื่นๆ', v: rest });
    const color = att ? FOE : YOU;
    return top
      .map((x) => {
        const pct = Math.round((x.v / total) * 100);
        const fill = x.name.startsWith('เหนื่อยล้า') ? '#6b7480' : color;
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
      <div><h4>ดาเมจที่ ${esc(names2[0])} โดน มาจาก</h4>${tookFrom(0)}</div>
      <div><h4>ดาเมจที่ ${esc(names2[1])} โดน มาจาก</h4>${tookFrom(1)}</div>
    </div>
    <p class="muted small">ชี้เมาส์ (หรือแตะ) ที่แถบเพื่อดูว่ามาจาก skill ไหน · ดาเมจรวมส่วนที่โล่กันไว้</p>
    <details><summary>ดูราย skill ของ ${esc(names2[0])}</summary>${statsTable(builds[0], r.stats[0], dmg[0])}</details>
    <details><summary>ดูราย skill ของ ${esc(names2[1])}</summary>${statsTable(builds[1], r.stats[1], dmg[1])}</details>
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
      ? `<p class="statline"><b>${nodeOf(top.k).name}</b> ทำดาเมจ <b>${Math.round((top.st.d / total) * 100)}%</b> ของทั้งหมด (${top.st.d} จาก ${total})</p>`
      : '<p class="statline muted">ยังไม่ได้ทำดาเมจเลย</p>';
  const body = rows
    .map(({ k, st }) => {
      const pct = total ? Math.round((st.d / total) * 100) : 0;
      return `<tr>
        <td class="sk"><span>${nodeOf(k).name} <small>Lv${lvOf(k.v)}</small></span></td>
        <td>${st.c}${st.tc ? ` <small class="muted">+${st.tc} ต่อ</small>` : ''}</td>
        <td class="dmg"><div class="bar"><i style="width:${pct}%"></i></div><span>${st.d}</span> <small class="muted">${pct}%</small></td>
        ${has('bd') ? `<td>${st.bd || '·'}</td>` : ''}
        ${has('bf') ? `<td>${st.bf || '·'}</td>` : ''}
        ${has('h') ? `<td>${st.h || '·'}</td>` : ''}
        ${has('sh') ? `<td>${st.sh || '·'}</td>` : ''}
        ${has('fz') ? `<td>${st.fz ? (st.fz / 10).toFixed(1) + ' วิ' : '·'}</td>` : ''}
      </tr>`;
    })
    .join('');
  return `${headline}<div class="statwrap"><table class="stats-t">
    <tr><th>skill</th><th>ใช้</th><th>ดาเมจ</th>
      ${has('bd') ? '<th>จากโบนัส🔗</th>' : ''}${has('bf') ? '<th>บัฟเพิ่มดาเมจ</th>' : ''}${has('h') ? '<th>ฟื้นเลือด</th>' : ''}${has('sh') ? '<th>โล่</th>' : ''}${has('fz') ? '<th>แช่แข็ง</th>' : ''}</tr>
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
    bestFightId: best?.fightId, bestText: best?.text,
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

/** Remember the memorable bits of a fight of this run (end-of-run page, local history). */
function noteFight(r: R.RunState, f: FightResponse, x: Explanation, day: number) {
  const m = x.moments.find((y) => y.kind === 'comeback') ?? x.moments.find((y) => y.kind === 'hit');
  const comeback = x.moments.some((y) => y.kind === 'comeback' && y.side === 0);
  const score = (f.won ? 50 : 0) + (x.close ? 30 : 0) + (comeback ? 40 : 0) + day;
  const text = `${f.won ? 'ชนะ' : 'แพ้'} ${names[1]}${x.close ? ' แบบสูสี' : ''}${m ? ` · ${m.title} ${m.text}` : ''}`;
  M.addFightNote(r.id, { day, won: f.won, opp: names[1], fightId: f.fightId, close: x.close, score, text });
}

function renderResult() {
  const f = last!;
  const r = run!;
  const link = f.fightId ? `${location.origin}${location.pathname}?replay=${f.fightId}` : '';
  const oname = names[1];
  const x = lastBuild ? explain(f.result, [lastBuild, f.opponent.build], 0, ['คุณ', oname], { drawIsLoss: true }) : null;
  const draw = f.result.winner === -1;
  return `
  <div class="mm-result ${f.won ? 'won' : 'lost'}">
    <h2 class="${f.won ? 'win' : 'lose'}">${f.won ? 'ชนะ' : draw ? 'เสมอ (นับเป็นแพ้)' : 'แพ้'} · วันที่ ${lastDay}${x?.close ? ' <span class="mm-tag close">สูสี!</span>' : ''}</h2>
    <p>คู่ต่อสู้: <b class="who s1">${esc(oname)}</b> · ${HEROES_BY_ID[f.opponent.build.hero].name}
     ${f.offline ? '<span class="muted">(ออฟไลน์: เซิร์ฟเวอร์ไม่ตอบ สู้กับ AI ในเครื่อง)</span>' : ''}</p>
    <p>${f.won ? `ชนะแล้ว ${r.wins}/${R.WIN_TARGET}` : `เสียเลือด ${lastDamage} · เหลือ ${Math.max(0, r.hp)}`} · คะแนน build ใหม่ ${f.rating}</p>
  </div>
  ${x ? P.fightHighlights(x, { replayAction: 'rewatch' }) : ''}
  <div class="actions"><button class="primary" data-a="next">ต่อไป</button>${x && !x.close ? '<button data-a="rewatch">▶ ดูไฟต์นี้อีกครั้ง</button>' : ''}</div>
  <h3>สรุปการสู้</h3>
  ${x ? explainHTML(f.result, x, 0) : ''}
  ${lastBuild ? vsSummary(f.result, [lastBuild, f.opponent.build], ['คุณ', oname]) : ''}
  <h3>build ของ ${esc(oname)}</h3>
  ${buildList(f.opponent.build)}
  ${link ? `<p class="muted">ลิงก์ replay: <input class="link" readonly value="${esc(link)}" onclick="this.select()"></p>` : ''}
  <div class="actions"><button class="primary" data-a="next">ต่อไป</button></div>`;
}

function renderLastChance() {
  scene.idle(run!.hero, R.lookOf(run!));
  return `
  <h2 class="lose">เลือดหมด… แต่ยังไม่จบ</h2>
  <p>คุณเข้าสู่สถานะ <b>กึ่งวิญญาณ</b>: กลับมาด้วยเลือด 1 แพ้อีกครั้งคือจบรอบ เลือกพลังหนึ่งอย่าง</p>
  <div class="heroes">
    <button class="hero" data-a="lc" data-i="awaken"><b>ตื่นพลัง</b><span>skill Lv1 ทุกใบขึ้นเป็น Lv2 (สุ่มสาย A หรือ B)</span><span class="muted">เหมาะกับ build ที่ของครบแต่เลเวลต่ำ</span></button>
    <button class="hero" data-a="lc" data-i="mark"><b>ตราวิญญาณ</b><span>สุ่มตราหนึ่งในสี่แบบ แล้วเลือกใส่ skill</span><span class="muted">เหมาะกับ build ที่มี skill หลักชัด</span></button>
    <button class="hero" data-a="lc" data-i="supply"><b>เสบียงสุดท้าย</b><span>เงิน 8 และช่อง skill +1 ถาวร</span><span class="muted">เหมาะกับ build ที่ยังขาดชิ้นสำคัญ</span></button>
  </div>`;
}

function renderMark() {
  const r = run!;
  const m = R.MARK_INFO[r.pendingMark!];
  return `
  <h2>ได้ตรา: ${m.name}</h2>
  <p>${m.desc} · เลือก skill ที่จะใส่ตรา</p>
  <ol class="build">${r.skills
    .map((k, i) => (`<li class="arch-${SKILLS[k.id].arch}"><div class="sk-text">${skillLine(k)}</div><span class="btns"><button data-a="mark" data-i="${i}">ใส่ตรานี้</button></span></li>`))
    .join('')}</ol>
  <div class="actions"><button class="ghost" data-a="mark" data-i="-1">ไม่ใส่</button></div>`;
}

function renderOver() {
  const r = run!;
  scene.idle(r.hero, R.lookOf(r));
  const won = r.phase === 'won';
  claimReward(r);
  const c = M.claimed(r.id);
  const reward = c && 'stardust' in c ? c : null;
  return P.runOverPage({
    won, conceded: !!r.conceded, hero: r.hero, heroArt: heroArt(r.hero, '', R.lookOf(r)), wins: r.wins, losses: r.losses,
    winTarget: R.WIN_TARGET, days: r.log.length, rating: r.rating, buildHTML: buildList(R.toBuild(r)),
    historyHTML: P.historyList(r.log, M.fightNotes(r.id)), best: M.bestNote(r.id), reward: pendingClaim.has(r.id) ? undefined : reward,
  });
}

/** Display names of a replay: "คุณ" for your own fights, and never two identical names. */
function replayNames(f: ReplayRecord): [string, string] {
  const mine = !!run?.log.some((l) => l.fightId === f.id) || M.localHistory().some((h) => h.bestFightId === f.id);
  const a = mine ? 'คุณ' : f.a.name || 'ผู้เล่น';
  const b = oppLabel({ name: f.b.name, ai: f.b.ai, tier: (f.b as { tier?: unknown }).tier });
  return b === a ? [`${a} (ซ้าย)`, `${b} (ขวา)`] : [a, b];
}

function renderReplayDone() {
  const f = replay!;
  const x = replayResult ? explain(replayResult, [f.a.build, f.b.build], 0, names) : null;
  return `
  <h2>Replay วันที่ ${f.day}${x?.close ? ' <span class="mm-tag close">สูสี!</span>' : ''}</h2>
  ${x ? P.fightHighlights(x) : ''}
  <div class="actions"><button data-a="replayAgain">▶ ดูอีกครั้ง</button><button class="primary" data-a="leaveReplay">เล่นเกมของคุณ</button></div>
  <h3>สรุปการสู้</h3>
  ${replayResult && x ? explainHTML(replayResult, x, 0) : ''}
  ${replayResult ? vsSummary(replayResult, [f.a.build, f.b.build], names) : ''}
  <div class="two">
    <div><h3><span class="who s0">${esc(names[0])}</span> · ${HEROES_BY_ID[f.a.build.hero].name}</h3>${buildList(f.a.build)}</div>
    <div><h3><span class="who s1">${esc(names[1])}</span> · ${HEROES_BY_ID[f.b.build.hero].name}</h3>${buildList(f.b.build)}</div>
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
  if (!r || !row) return;
  const slot = document.createElement('div');
  slot.className = 'mm-scout-slot';
  row.before(slot);
  const day = r.day;
  void M.scout(day, r.rating, r.id).then((s) => {
    if (view === 'shop' && run?.day === day && slot.isConnected) slot.innerHTML = P.scoutChip(s, day);
  });
}

// ---------- combat log ----------
/** builds of the fight on screen [left, right] (for skill variant names in the log) */
let logBuilds: [Build, Build] | null = null;
/** start a new combat log: remember the builds and which damage events are thorns reflections */
function beginLog(result: CombatResult, builds: [Build, Build]) {
  logBuilds = builds;
  logRefl = reflectEvents(result.events);
}
function describe(e: CombatEvent): string | null {
  // each side in its own colour, so "who lost HP" is never ambiguous
  const who = (s: number) => `<span class="who s${s}">${esc(names[s])}</span>`;
  const varName = (side: number, id: string) => {
    const k = logBuilds?.[side]?.skills.find((x) => x.id === id);
    return k ? nodeOf(k).name : SKILLS[id]?.name ?? id;
  };
  switch (e.type) {
    case 'cast':
      return `${who(e.side)} ใช้ <b>${varName(e.side, e.skill)}</b> Lv${e.lv}${e.echo ? ' (ตีซ้ำ)' : ''}${e.from !== undefined ? ' <small class="muted">🔗ต่อ</small>' : ''}`;
    case 'damage': {
      const attacker = 1 - e.side;
      const src =
        e.src === 'burn' ? 'ไฟ' : e.src === 'fatigue' ? 'ความเหนื่อยล้า' : logRefl.has(e) ? `หนามของ${esc(names[attacker])}` : varName(attacker, e.src);
      return `&nbsp;&nbsp;${who(e.side)} เสีย <b class="dmg">${e.amount}</b>${e.blocked ? ` (โล่กัน ${e.blocked})` : ''} จาก${src}`;
    }
    case 'status':
      switch (e.status) {
        case 'freeze':
          return e.value > 0 ? `&nbsp;&nbsp;${who(e.side)} ถูกแช่แข็ง ${(e.value / 10).toFixed(1)} วิ` : `&nbsp;&nbsp;${who(e.side)} ต้านการแช่แข็ง`;
        case 'slow':
          return `&nbsp;&nbsp;${who(e.side)} ช้าลง ${e.value}%`;
        case 'rage':
          return `${who(e.side)} <b>คลั่ง!</b> พลังโจมตี +${e.value}`;
        case 'amplify':
          return e.value > 0 ? `&nbsp;&nbsp;${who(e.side)} บัฟเป็น 2 เท่า (+${e.value})` : null;
        case 'cleanse':
          return e.value > 0 ? `&nbsp;&nbsp;${who(e.side)} ล้างดีบัฟ ${e.value} อย่าง` : null;
        case 'dispel':
          return e.value > 0 ? `&nbsp;&nbsp;${who(e.side)} ถูกลบบัฟ ${e.value} อย่าง` : null;
        case 'delay':
          return e.value > 0 ? `&nbsp;&nbsp;${who(e.side)} คูลดาวน์ถอยหลัง ${(e.value / 10).toFixed(1)} วิ` : `&nbsp;&nbsp;${who(e.side)} ต้านการถ่วงเวลา`;
        default:
          return null;
      }
    case 'fatigue':
      return `<span class="muted">เหนื่อยล้า: ทั้งสองฝ่ายเสีย ${e.amount}</span>`;
    case 'end':
      return `<b>${e.winner === -1 ? 'เสมอ' : who(e.winner) + ' ชนะ'}</b>`;
    default:
      return null;
  }
}
function addLog(e: CombatEvent) {
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
      opponent: { name: `AI · ${HEROES_BY_ID[opp.hero].name}`, ai: true, build: opp, rating: r.rating },
    };
  }
  last = res;
  // apply the result before the replay plays, so reloading mid-replay can't undo a loss
  r.rating = res.rating;
  R.recordResult(r, res.won, { opp: res.opponent.name, ai: res.opponent.ai, fightId: res.fightId });
  saveRun();
  names = ['คุณ', oppLabel(res.opponent as FightResponse['opponent'] & { tier?: unknown })];
  noteFight(r, res, explain(res.result, [build, res.opponent.build], 0, names, { drawIsLoss: true }), lastDay);
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
    { result: shown, left: { name: names[0], build }, right: { name: names[1], build: res.opponent.build } },
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
    toast = 'ไม่พบ replay นี้';
    view = 'title';
    render();
    return;
  }
  playReplay();
}
function playReplay() {
  const f = replay!;
  if (f.v !== SIM_VERSION) {
    toast = 'replay นี้มาจากเกมเวอร์ชันเก่า ดูซ้ำไม่ได้แล้ว';
    replay = null;
    view = 'town';
    render();
    return;
  }
  const result = simulate(f.a.build, f.b.build, f.seed, f.day, { trace: true }); // recomputed locally from the seed
  replayResult = result;
  names = replayNames(f);
  view = 'replay';
  render();
  beginLog(result, [f.a.build, f.b.build]);
  scene.play({ result, left: { name: names[0], build: f.a.build }, right: { name: names[1], build: f.b.build } }, addLog, () => {
    view = 'replayDone';
    render();
  });
}

function onClick(ev: Event) {
  const el = (ev.target as HTMLElement).closest<HTMLElement>('[data-a]');
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
      err = R.buy(run!, n);
      break;
    case 'reroll':
      err = R.reroll(run!);
      break;
    case 'sell':
      R.sell(run!, n);
      break;
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
          ? `🌙 พรจันทร์: ${nodeOf(k).name} ได้ตรา${R.MARK_INFO[w.mark].name}`
          : `🌙 พรจันทร์: ${nodeOf({ id: k.id, v: w.from }).name} Lv${lvOf(w.from)} → ${nodeOf(k).name} Lv${lvOf(k.v)}`;
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
  if (err) toast = err;
  else if (a === 'buy' || a === 'reroll' || a === 'sell' || a === 'wish') sfx(a);
  else if (a === 'lock') sfx('lock');
  saveRun();
  render();
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
  showHints($panel, run, card ? Number(card.dataset.tip!.slice(2)) : -1);
}

function onHover(ev: PointerEvent) {
  if (ev.pointerType !== 'mouse') return;
  if (dragging) return hideTip();
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
    }
  });
  $panel.addEventListener('pointerdown', onPointerDown);
  initDrag($panel, { onPreview: previewOrder, onDrop: dropSkill });
  window.addEventListener('pointermove', onHover);
  $panel.addEventListener('pointerleave', hideTip);
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
