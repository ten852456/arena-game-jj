import { autoArrange, randomAiBuild } from '../sim/bot';
import { SIM_VERSION, cdTicks, simulate } from '../sim/combat';
import { HASTE_BONUS, POWER_BONUS, activeBonuses, fits, matches, type Offer } from '../sim/grid';
import { HEROES, HEROES_BY_ID } from '../sim/heroes';
import { explain, reflectEvents, skillDamage, type Explanation } from '../sim/explain';
import { fatigueStart } from '../sim/combat';
import { hashSeed } from '../sim/rng';
import * as M from './views/meta';
import * as P from './views/pages';
import { music, sfx, voice } from './audio';
import { IMAGES } from './assets';
import * as R from '../sim/run';
import { ARCH_NAME, KEYWORDS, SKILLS, chipsOf, lvOf, nextVariants, nodeOf, type Keyword, type Variant } from '../sim/skills';
import type { BlockStat, Build, CombatEvent, CombatResult, Rot, SkillInstance } from '../sim/types';
import { memeGallery, renderChibi, rollLook } from './chibi';
import { BONUS_ICON, bonusText, dropOrigin, footprintAt, gridHTML, installPatterns, pieceHTML } from './gridView';
import { api, type FightResponse, type ReplayRecord } from './api';
import type { CombatScene } from './combatScene';
import { BUILDINGS, BUILDING_BY_ID } from './townData';
import { L } from '../i18n';
import { onLang } from './lang';
import type { TownScene } from './townScene';

export interface Stage {
  town: TownScene;
  combat: CombatScene;
  show(key: 'town' | 'combat'): void;
}

type View =
  | 'town' | 'title' | 'shop' | 'fighting' | 'result' | 'lastchance' | 'mark' | 'over' | 'replay' | 'replayDone'
  | 'profile' | 'leaderboard';

// ---------- GC2: fight names, end-of-run reward, profile / leaderboard / scouting state ----------
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
/** Opponent label: real name, or name · AI (tier). Never "You" (that is the player). */
function oppLabel(o: { name: string; ai: boolean; tier?: unknown }) {
  const nm = o.name && o.name !== 'คุณ' && o.name !== 'You' ? o.name : L('คู่ต่อสู้', 'Opponent');
  if (!o.ai) return nm;
  const tier = M.tierLabel(o.tier);
  const base = /\bAI\b/.test(nm) ? nm : `${nm} · AI`;
  return `${base}${tier ? ` (${tier})` : ''}`;
}
/** what the player is called in fight texts (the explanation, the log and the summary say "You") */
const youName = () => L('คุณ', 'You');

// ---------- audio cues (music per screen, one-shot voice/sfx when a screen is entered) ----------
let shownView: View | null = null;
/** the last fight of the run was close (winner ≤10% HP): the result screen says so out loud */
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
    else music('shop');
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
  } else if (v === 'replay') music('battle');
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
let toast = '';
/** block (index into run.skills) to play the rotate animation on after the next render */
let animRot: number | null = null;
/** screen positions of blocks before an auto-arrange, so they can slide to their new spots */
let flipFrom: Map<number, DOMRect> | null = null;
let names: [string, string] = ['', ''];
/** selected block (index into run.skills) */
let sel: number | null = null;
let confirmConcede = false;
/** one colour per bonus slot: tooltip line and highlighted shapes share it */
const HL = ['#ff6bd6', '#5ce1ff', '#9dff6b'];

// ---------- storage (per-browser convenience only; may be unavailable) ----------
const RUN_KEY = 'arena.gridrun.v5';
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
    return r && r.v === 5 ? r : null;
  } catch {
    return null;
  }
}
const playerName = () => (fetchStore(NAME_KEY) || L('ผู้เล่น', 'Player')).slice(0, 24);

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

/** Keyword tooltip: icon, name and meaning. */
function kwTip(kw: Keyword) {
  const x = KEYWORDS[kw];
  return `<div class="tt-h"><b>${x.icon} ${x.name}</b></div><div class="desc">${x.desc}</div>`;
}

function skillLine(k: SkillInstance) {
  const mark = k.mark ? ` <span class="mark">${R.MARK_INFO[k.mark].name}</span>` : '';
  return `<span class="nm">${nodeOf(k).name} <small>Lv${lvOf(k.v)}</small>${mark}</span>${chipsHTML(k)}`;
}

// ---------- skill tree window ----------
/** skill tree window: which skill, the variant you own (null = not owned) and the variant the shop offers */
let treeOpen: { id: string; cur: string | null; offer: string | null } | null = null;
function treeNode(id: string, v: Variant, cur: string | null, offer: string | null) {
  const n = SKILLS[id].tree[v];
  let cls = '';
  let tag = '';
  if (cur !== null) {
    if (v === cur) [cls, tag] = ['cur', L('ตอนนี้', 'Now')];
    else if (cur.startsWith(v)) cls = 'past';
    else if ((nextVariants(cur) as string[]).includes(v)) [cls, tag] = ['next', L('ขั้นถัดไป', 'Next')];
    else if (!v.startsWith(cur)) [cls, tag] = ['gone', L('ไปไม่ได้แล้ว', 'Locked out')];
  }
  if (v === offer) [cls, tag] = [`${cls} offer`, L('ในร้าน', 'In shop')];
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
    <div class="modal-h"><b>${L('ต้นไม้ skill', 'Skill tree')}: ${d.name}</b> <span class="muted small">${ARCH_NAME[d.arch]}${d.hero ? L(' · เฉพาะฮีโร่', ' · Hero only') : ''}</span>
      <button class="small ghost" data-a="treeClose">${L('ปิด', 'Close')} ✕</button></div>
    <p class="muted small">${L('Lv1 → เลือกได้ 1 ใน 2 สายที่ Lv2 → แต่ละสายแยกอีก 2 ทางที่ Lv3 · ร้านจะสุ่มเสนอ 1 ทางของขั้นถัดไปให้ ซื้อแล้วย้อนกลับไม่ได้ · อัปเกรดแล้วบล็อกใช้รูปและที่เดิม และได้โบนัสติดกันเพิ่ม 1 อัน', 'Lv1 → pick 1 of 2 branches at Lv2 → each branch splits 2 more ways at Lv3 · The shop offers one random next step; once bought you cannot go back · An upgrade keeps the block’s shape and place and adds 1 connect bonus')}</p>
    <div class="tree">
      <div class="troot">${treeNode(id, '', cur, offer)}</div>
      <div class="tbranches">${branch('a')}${branch('b')}</div>
    </div>
  </div></div>`;
}
/** ⓘ button that opens the skill tree. cur = variant you own (null = not owned), offer = variant in the shop */
const treeBtn = (id: string, cur: string | null, offer: string | null) =>
  `<button class="small ghost info" data-a="tree" data-i="${id}" data-own="${cur !== null ? 1 : 0}" data-cur="${cur ?? ''}" data-offer="${offer ?? ''}" aria-label="${L('ดูต้นไม้ skill', 'Show skill tree')}" title="${L('ดูต้นไม้ skill ทั้งหมด', 'Show the whole skill tree')}">ⓘ</button>`;

/** Hover / selected details for a skill: name, chips, keywords, cooldown, each connect bonus (on or off). */
function tipBody(k: Pick<SkillInstance, 'id' | 'v' | 'mark' | 'bonus'>, fx: ReturnType<typeof bonusState> | null, note = '') {
  const d = SKILLS[k.id];
  const node = nodeOf(k);
  const lv = lvOf(k.v);
  const on = fx?.on ?? new Set<number>();
  const bonus = k.bonus
    .map((b, bi) => `<li class="${on.has(bi) ? 'on' : ''}" style="--hl:${HL[bi % HL.length]}"><span class="bi">${BONUS_ICON[b.e]}</span> ${bonusText(b, lv)}${on.has(bi) ? ` <b class="ok">✓ ${L('ทำงาน', 'Active')}</b>` : ''}</li>`)
    .join('');
  const kws = [...new Set(chipsOf(node).map((c) => c.kw))].filter((kw) => kw !== 'cd');
  const branch = k.v.length >= 1 ? d.tree[k.v[0] as 'a' | 'b'].style : '';
  return `<div class="tt-h arch-${d.arch}"><b>${node.name}</b> <small>Lv${lv}</small>${d.hero ? ` <span class="mark">${L('เฉพาะ', 'Unique')}</span>` : ''}
      ${k.mark ? ` <span class="mark">${R.MARK_INFO[k.mark].name}</span>` : ''}</div>
    <div class="muted small">${ARCH_NAME[d.arch]}${branch ? ` · ${L('สาย', 'branch: ')}${branch}` : ''}${k.v ? ` · ${L('มาจาก', 'from')} ${d.name}` : ''}${fx?.power ? ` · ${L('แรงขึ้น', 'stronger by')} ${Math.round(fx.power * 100)}%` : ''}</div>
    <div>${chipsHTML(k, fx?.haste ?? 0)}</div>
    <ul class="kwlist">${kws.map((kw) => `<li><b>${KEYWORDS[kw].icon} ${KEYWORDS[kw].name}</b> ${KEYWORDS[kw].desc}</li>`).join('')}</ul>
    ${bonus ? `<div class="muted small">${L('โบนัสเมื่อวางติดกัน (ด้านไหนก็ได้)', 'Bonuses when touching (any side)')}</div><ul class="bonus">${bonus}</ul>` : ''}
    ${fx?.triggeredBy.length ? `<div class="combo small">⚡ ${L('ถูกสั่งโดย', 'Fired by')} ${fx.triggeredBy.join(', ')}</div>` : ''}
    ${note ? `<div class="muted small">${note}</div>` : ''}`;
}

function buildList(b: Build) {
  return `<div class="buildview">${gridHTML(b.skills, b.w, b.h, { small: true })}
  <ol class="build readonly">${b.skills
    .map((k) => `<li class="arch-${SKILLS[k.id].arch}">${skillLine(k)}</li>`)
    .join('')}</ol></div>`;
}

/** Which connect bonuses of block i are on, and what they add up to. */
function bonusState(r: R.RunState, i: number) {
  const { w, h } = R.gridOf(r);
  const act = activeBonuses(r.skills, w, h);
  const mine = act.filter((a) => a.from === i);
  return {
    on: new Set(mine.map((a) => a.bi)),
    haste: mine.filter((a) => a.b.e === 'haste').length * HASTE_BONUS,
    power: mine.filter((a) => a.b.e === 'power').length * POWER_BONUS,
    triggeredBy: act.filter((a) => a.b.e === 'trigger' && a.to.includes(i)).map((a) => SKILLS[r.skills[a.from].id].name),
  };
}

function tipFor(key: string): string {
  const r = run;
  if (!r) return '';
  const [kind, n] = [key[0], Number(key.slice(2))];
  if (kind === 'g') {
    const k = r.skills[n];
    if (!k) return '';
    return tipBody(k, k.x >= 0 ? bonusState(r, n) : null, k.x < 0 ? L('อยู่ในกระเป๋า: ไม่ได้ลงสู้', 'In your bag: not fighting') : L('คลิกขวาหรือกด R เพื่อหมุน', 'Right-click or press R to rotate'));
  }
  if (kind === 's') {
    const o: Offer | null = r.shop[n];
    if (!o) return '';
    const owned = R.upgradeOf(r, o);
    if (owned) return tipBody({ ...owned, v: o.v }, null, L(`อัปเกรดจาก ${nodeOf(owned).name} Lv${lvOf(owned.v)}: ใช้รูปและที่เดิม และได้โบนัสใหม่ 1 อัน`, `Upgrades ${nodeOf(owned).name} Lv${lvOf(owned.v)}: same shape and place, plus 1 new bonus`));
    return tipBody({ id: o.id, v: o.v, bonus: o.bonus }, null);
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
  playBlockAnims();
  // selected skill (tap on mobile) shows the same colour highlight as hover
  if (view === 'shop' && sel !== null) highlightFor('g:' + sel);
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
        body += L(`<p>รอบที่เล่นค้างไว้: <b>${HEROES_BY_ID[r.hero].name}</b> · วันที่ ${r.day} · ชนะ ${r.wins}/${R.WIN_TARGET} · เลือด ${r.hp}/${R.START_HP}</p>`, `<p>Run in progress: <b>${HEROES_BY_ID[r.hero].name}</b> · day ${r.day} · wins ${r.wins}/${R.WIN_TARGET} · HP ${r.hp}/${R.START_HP}</p>`);
      }
      body += `<div class="actions"><button class="primary" data-a="enterArena">${runActive() ? L('เล่นต่อ', 'Continue') : L('เข้าสนามประลอง', 'Enter the arena')}</button></div>`;
    } else if (b.id === 'board') {
      body += `<div class="actions mm-actions"><button class="primary" data-a="leaderboard">🏆 ${L('กระดานผู้นำ', 'Leaderboard')}</button><button data-a="profile">${L('โปรไฟล์และประวัติ', 'Profile and history')}</button></div>`;
    } else if (b.id === 'hall') {
      body += `<div class="actions mm-actions"><button class="primary" data-a="profile">${L('โปรไฟล์และประวัติของฉัน', 'My profile and history')}</button></div>`;
      body += `<p class="muted">${L(`ฮีโร่ทั้งหมด ${HEROES.length} ตัว · แต่ละรอบสุ่มให้เลือก ${R.HERO_CHOICES} ตัวจากคนละสาย`, `${HEROES.length} heroes in all · each run offers ${R.HERO_CHOICES} from different styles`)}</p><div class="heroes">${HEROES.map(
        (h) => `<div class="card arch-${h.arch}">${heroArt(h.id, 'small')}<div class="nm">${h.name}</div><div class="tag">${ARCH_NAME[h.arch]}</div>
          <div class="desc"><b>${L('วิธีเล่น', 'How to play')}:</b> ${h.style}</div>
          <div class="desc"><b>${L('ความสามารถ', 'Passive')}:</b> ${h.passive}</div>
          <div class="desc muted">${L('skill เฉพาะ', 'Unique skill')}: <b>${SKILLS[h.unique].name}</b> ${treeBtn(h.unique, null, null)} ${chipsHTML({ id: h.unique, v: '' })}</div></div>`,
      ).join('')}</div>`;
    } else if (b.future) {
      body += `<p class="muted">${L('เร็วๆ นี้', 'Coming soon')}: ${b.future}</p>`;
    }
    detail = `<div class="bcard"><h3>${b.name}${b.open ? '' : ` <span class="mark">${L('เร็วๆ นี้', 'Soon')}</span>`}</h3>${body}</div>`;
  }
  return `
  <h2>${L('เมืองของคุณ', 'Your town')}</h2>
  <p class="muted">${L('ลากซ้ายขวาเพื่อเดินดูเมือง (ใช้ล้อเมาส์หรือปุ่มลูกศรก็ได้) · แตะอาคารเพื่อดูรายละเอียด · แตะแผนที่ย่อด้านล่างเพื่อกระโดดไปจุดนั้น', 'Drag left and right to walk around town (mouse wheel or arrow keys work too) · Tap a building for details · Tap the minimap below to jump there')}</p>
  <div class="chips">${chips}</div>
  ${detail}`;
}

function renderTitle() {
  if (scene) scene.idle(null);
  const resume = runActive()
    ? `<button class="primary" data-a="resume">${L(`เล่นต่อ: ${HEROES_BY_ID[run!.hero].name} วันที่ ${run!.day} (ชนะ ${run!.wins})`, `Continue: ${HEROES_BY_ID[run!.hero].name} day ${run!.day} (${run!.wins} wins)`)}</button>`
    : '';
  return `
  <div class="actions"><button class="ghost" data-a="town">← ${L('กลับเมือง', 'Back to town')}</button></div>
  <img class="brand-logo" src="${IMAGES.logo}" alt="Mochi Moon" width="1024" height="504">
  <h2>${L('เลือกฮีโร่', 'Pick a hero')}</h2>
  <p class="muted">${L(`ชนะ ${R.WIN_TARGET} ครั้งก่อนเลือด ${R.START_HP} หมด · แพ้เสียเลือดเท่ากับเลขวัน · สู้กับ build ของผู้เล่นอื่นในวันเดียวกัน`, `Win ${R.WIN_TARGET} times before your ${R.START_HP} HP runs out · a loss costs HP equal to the day number · you fight other players’ builds from the same day`)}</p>
  <label class="name">${L('ชื่อของคุณ', 'Your name')} <input id="name" maxlength="24" value="${esc(fetchStore(NAME_KEY) ?? '')}" placeholder="${L('ผู้เล่น', 'Player')}"></label>
  ${resume}
  ${runActive() ? '' : `<p class="muted">${L(`รอบนี้มีให้เลือก ${R.HERO_CHOICES} ตัวจากคนละสาย (ดูฮีโร่ทั้งหมดได้ที่หอฮีโร่ในเมือง)`, `This run offers ${R.HERO_CHOICES} heroes from different styles (see them all in the Hero Hall in town)`)}</p>`}
  <div class="heroes">${(runActive() ? [] : R.heroChoices((nextSeed ??= randSeed())).map((id) => HEROES_BY_ID[id])).map(
    (h) => `<button class="hero arch-${h.arch}" data-a="start" data-i="${h.id}">
      ${heroArt(h.id, '', R.lookFor(nextSeed!, h.id))}
      <b>${h.name}</b><span class="tag">${ARCH_NAME[h.arch]}</span>
      <span>${h.style}</span>
      <span>${h.passive}</span>
      <span class="muted">${L('skill เฉพาะ', 'Unique skill')}: ${SKILLS[h.unique].name}</span>${chipsHTML({ id: h.unique, v: '' })}
    </button>`,
  ).join('')}</div>`;
}

/** Shop card that sells +1 column / row of grid space. */
function expandCard(r: R.RunState) {
  const what = R.nextExpand(r);
  const price = R.expandPrice(r);
  const { w, h } = R.gridOf(r);
  const nw = what === 'col' ? w + 1 : w;
  const nh = what === 'row' ? h + 1 : h;
  let cells = '';
  for (let y = 0; y < nh; y++)
    for (let x = 0; x < nw; x++) cells += `<i class="${x >= w || y >= h ? 'new' : ''}" style="left:${x * 9}px;top:${y * 9}px"></i>`;
  const why = !what ? L('ใหญ่สุดแล้ว', 'Max size') : r.gold < price ? L('เงินไม่พอ', 'Not enough gold') : '';
  return `<div class="card offer expand" title="${L('ซื้อพื้นที่ตารางเพิ่ม ถาวรทั้งรอบ ราคาขึ้นทุกครั้งที่ซื้อ', 'Buy more grid space for the rest of the run; the price goes up each time')}">
    <div class="offer-art"><div class="minigrid" style="width:${nw * 9}px;height:${nh * 9}px">${cells}</div></div>
    <div class="offer-meta">${what ? L(`ขยายตาราง +1 ${what === 'col' ? 'คอลัมน์' : 'แถว'}`, `Grid +1 ${what === 'col' ? 'column' : 'row'}`) : L('ตาราง 8×6 แล้ว', 'Grid is 8×6')}</div>
    <button data-a="expand" ${why ? 'disabled' : ''}>${why || `${L('ซื้อ', 'Buy')} ${price}`}</button>
  </div>`;
}

function renderShop() {
  const r = run!;
  scene.idle(r.hero, R.lookOf(r));
  const hero = HEROES_BY_ID[r.hero];
  const { w, h } = R.gridOf(r);
  if (sel !== null && !r.skills[sel]) sel = null;
  const shop = r.shop
    .map((o, i) => {
      if (!o) return `<div class="card empty">${L('ซื้อแล้ว', 'Sold')}</div>`;
      const d = SKILLS[o.id];
      const node = d.tree[o.v as Variant];
      const up = R.upgradeOf(r, o);
      const price = R.priceOf(o);
      const stale = o.v !== '' && !up;
      const why = stale ? L('ใช้ไม่ได้แล้ว', 'No longer usable') : r.gold < price ? L('เงินไม่พอ', 'Not enough gold') : '';
      const disabled = !!why;
      const branch = o.v ? d.tree[o.v[0] as 'a' | 'b'].style : '';
      const look = up ? { ...up, v: o.v } : { ...o };
      return `<div class="card offer${o.v ? ' upgrade' : ''}" data-tip="s:${i}">
        <div class="offer-name">${node.name} <small>Lv${lvOf(o.v)}</small> ${treeBtn(o.id, up ? up.v : null, o.v)}</div>
        <div class="offer-art">${pieceHTML(look, { tip: `s:${i}` })}</div>
        <div class="offer-meta">${o.v ? `<span class="up">⬆ ${L('อัปเกรด', 'Upgrade')} ${d.name}${branch ? ` · ${branch}` : ''}</span>` : ''}${o.bonus.length && !o.v ? `<span class="bicons">${o.bonus.map((b) => BONUS_ICON[b.e]).join(' ')}</span>` : ''}${d.hero ? `<span class="mark">${L('เฉพาะ', 'Unique')}</span>` : ''}</div>
        <div class="offer-desc">${chipsHTML({ id: o.id, v: o.v })}</div>
        <button data-a="buy" data-i="${i}" ${disabled ? 'disabled' : ''}>${why || `${L('ซื้อ', 'Buy')} ${price}`}</button>
      </div>`;
    })
    .join('');
  const bagItems = r.skills
    .map((k, i) => (k.x < 0 ? `<div class="bagitem">${pieceHTML(k, { idx: i, tip: `g:${i}`, selected: sel === i })}</div>` : ''))
    .join('');
  const freeSlots = Math.max(0, R.BAG_MAX - R.bag(r).length);
  let info = `<p class="muted">${L('ชี้เมาส์ที่ skill เพื่อดูรายละเอียด · ลากไปวาง · คลิกขวาหรือกด R เพื่อหมุน · ตัวที่เรืองแสง = โบนัสติดกันทำงาน', 'Hover a skill for details · drag to place · right-click or press R to rotate · glowing = a connect bonus is active')}</p>`;
  if (sel !== null) {
    const k = r.skills[sel];
    info = `<div class="selinfo arch-${SKILLS[k.id].arch}">
      ${tipBody(k, k.x >= 0 ? bonusState(r, sel) : null, k.x < 0 ? L('อยู่ในกระเป๋า: ไม่ได้ลงสู้', 'In your bag: not fighting') : '')}
      <div class="actions">
        ${treeBtn(k.id, k.v, null)}
        <button class="small" data-a="rot">${L('หมุน', 'Rotate')} ⟳</button>
        ${k.x >= 0 ? `<button class="small" data-a="bag">${L('เก็บเข้ากระเป๋า', 'Put in bag')}</button>` : ''}
        <button class="small" data-a="sell" data-i="${sel}">${L('ขาย', 'Sell')} +${R.sellPrice(k)}</button>
        <button class="small ghost" data-a="desel">${L('ยกเลิก', 'Cancel')}</button>
      </div></div>`;
  }
  const inc = r.lastIncome;
  const placed = r.skills.filter((k) => k.x >= 0).length;
  return `
  <div class="stats">
    <span>${L('วันที่', 'Day')} <b>${r.day}</b></span>
    <span>${L('เลือด', 'HP')} <b>${r.hp}</b>/${R.START_HP}${r.ghost ? ` <span class="mark">${L('กึ่งวิญญาณ', 'Half-ghost')}</span>` : ''}</span>
    <span>${L('ชนะ', 'Wins')} <b>${r.wins}</b>/${R.WIN_TARGET}</span>
    <span>${L('เงิน', 'Gold')} <b>${r.gold}</b></span>
    <span>${L('คะแนน build', 'Build rating')} <b>${r.rating}</b></span>
    ${streakText(r.streak) ? `<span>${streakText(r.streak)}</span>` : ''}
    <span class="stats-right">${concedeHTML()}</span>
  </div>
  <p class="muted">${L('วันนี้ได้', 'Income today')} +${inc.base}${inc.bonus ? ` ${L('และโบนัส', 'and bonus')} +${inc.bonus}` : ''} · ${hero.name}: ${hero.passive}</p>
  <h3>${L('ร้าน skill', 'Skill shop')} <button class="small" data-a="reroll" ${r.gold < R.REROLL ? 'disabled' : ''}>${L('สุ่มใหม่', 'Reroll')} (${R.REROLL})</button></h3>
  <div class="shop">${shop}${expandCard(r)}</div>
  <h3>${L('ตาราง skill', 'Skill grid')} ${w}×${h} <button class="small auto-btn" data-a="auto" ${r.skills.length ? '' : 'disabled'} title="${L('จัดบล็อกให้โบนัสติดกันทำงานมากที่สุด', 'Arrange blocks to turn on the most connect bonuses')}">✨ ${L('จัดอัตโนมัติ', 'Auto-arrange')}</button>
    <small class="muted">${L('ทุกตัวนับคูลดาวน์พร้อมกัน · วางให้ติดกับตัวที่โบนัสต้องการ แล้วตัวนั้นจะเรืองแสง', 'All cooldowns count at the same time · place blocks next to what their bonus wants and they glow')}</small></h3>
  <div class="pack">
    ${gridHTML(r.skills, w, h, { interactive: true, selected: sel ?? undefined })}
    <div class="side">
      <div class="bag" data-drop="bag">
        <div class="bag-h"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M8 7V5a4 4 0 0 1 8 0v2" fill="none" stroke="currentColor" stroke-width="2"/><rect x="4" y="7" width="16" height="14" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4 13h16" stroke="currentColor" stroke-width="2"/></svg>
        ${L('กระเป๋าเก็บ skill', 'Skill bag')} <small class="muted">${R.bag(r).length}/${R.BAG_MAX} · ${L('ไม่ได้ลงสู้', 'not fighting')}</small></div>
        <div class="bag-items">${bagItems}${'<div class="bagslot"></div>'.repeat(freeSlots)}</div>
      </div>
      <div class="sellzone" data-drop="sell">${L('ลากมาที่นี่เพื่อขาย', 'Drag here to sell')}</div>
    </div>
  </div>
  ${info}
  <div class="actions">
    <button class="primary" data-a="fight" ${busy || !placed ? 'disabled' : ''}>${L(`สู้วันที่ ${r.day} · ถ้าแพ้เสียเลือด ${R.damageFor(r.day)}`, `Fight day ${r.day} · a loss costs ${R.damageFor(r.day)} HP`)}</button>
    <button class="ghost" data-a="town">${L('กลับเมือง', 'Back to town')}</button>
  </div>`;
}

/** Give up the whole run. Shown in the top bar of the shop and during your own fights. */
function concedeHTML() {
  if (!run || run.phase === 'won' || run.phase === 'dead') return '';
  return confirmConcede
    ? `<span class="concede-box"><span class="concede-ask">${L('ยอมแพ้แล้วรอบนี้จะจบทันที แน่ใจไหม?', 'Giving up ends this run right away. Are you sure?')}</span>
       <button class="small danger" data-a="concedeYes">${L('ยืนยันยอมแพ้', 'Yes, give up')}</button>
       <button class="small ghost" data-a="concedeNo">${L('ไม่ เล่นต่อ', 'No, keep playing')}</button></span>`
    : `<button class="small concede-btn" data-a="concede">🏳 ${L('ยอมแพ้', 'Give up')}</button>`;
}

function renderFighting() {
  return `
  <p class="mm-versus"><span class="who s0">${esc(names[0])}</span> <span class="muted">vs</span> <span class="who s1">${esc(names[1])}</span> ${view === 'fighting' ? `<span class="stats-right">${concedeHTML()}</span>` : ''}</p>
  <div class="actions mm-speed">
    ${[1, 2, 4].map((s) => `<button class="small ${scene.speed === s ? 'on' : ''}" data-a="speed" data-i="${s}">${s}x</button>`).join('')}
    <button class="small" data-a="skip">${L('ข้าม', 'Skip')}</button>
  </div>
  <p class="muted small glossary">${L(`<b>พลังโจมตี</b> = ดาเมจเพิ่มให้ทุกการโจมตีของทุก skill · <b>รวมพลัง</b> = การโจมตีครั้งถัดไป 1 ครั้งแรงขึ้น ·
    <b>หนาม</b> = สะท้อนดาเมจทุกครั้งที่โดนตี · <b>ใจเหล็ก</b> = โดนแช่แข็ง/ช้าน้อยลง 60% · <b>ไฟ</b> = เสียเลือดทุกวิ ไม่สนโล่ ·
    <b>แช่แข็ง</b> = skill ทุกตัวหยุดนับคูลดาวน์ · <b>ช้า</b> = คูลดาวน์ทุกตัวเดินช้าลง · <b>เชน ⚡</b> = บล็อกที่ติดกันสั่งกันทำงานต่อทันที`, `<b>Power</b> = extra damage on every hit of every skill · <b>Charge</b> = your next hit is stronger ·
    <b>Thorns</b> = reflect damage each time you are hit · <b>Iron Will</b> = freeze/slow on you 60% weaker · <b>Burn</b> = lose HP every second, ignores shields ·
    <b>Freeze</b> = all cooldowns stop · <b>Slow</b> = all cooldowns run slower · <b>Chain ⚡</b> = touching blocks fire each other right away`)}</p>
  <ol id="log" class="log"></ol>`;
}

const PILES = (): { key: keyof BlockStat; name: string; unit: string; help: string }[] => [
  { key: 'd', name: L('ดาเมจ', 'Damage'), unit: '', help: L('ดาเมจที่แต่ละ skill ทำ (รวมส่วนที่โล่ศัตรูกันไว้ ไฟ และส่วนแบ่งหนามที่สะท้อน)', 'Damage each skill dealt (including what enemy shields blocked, burn, and its share of thorns reflection)') },
  { key: 'bf', name: L('บัฟ', 'Buffs'), unit: '', help: L('ดาเมจที่บัฟของ skill นั้น (พลังโจมตี รวมพลัง) เพิ่มให้การโจมตีของทุก skill', 'Damage that skill’s buffs (power, charge) added to every skill’s hits') },
  { key: 'h', name: L('ฟื้นเลือด', 'Healing'), unit: '', help: L('เลือดที่ฟื้นได้จริง', 'HP actually healed') },
  { key: 'sh', name: L('โล่', 'Shield'), unit: '', help: L('โล่ที่ได้รับ', 'Shield gained') },
  { key: 'fz', name: L('ควบคุม', 'Control'), unit: L(' วิ', 's'), help: L('เวลาที่ศัตรูถูกแช่แข็งหรือถ่วงคูลดาวน์', 'Time the enemy spent frozen or with cooldowns pushed back') },
];

const YOU = '#3987e5';
const FOE = '#d95926';

/** Explanation of the fight (headline, facts, why) from side `me`'s point of view. */
function explainHTML(r: CombatResult, x: Explanation, me: 0 | 1) {
  const won = r.winner === me;
  return `<div class="explain">
    <p><b>${esc(x.headline)}</b></p>
    <ul class="facts">${x.facts.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
    ${x.reasons.length ? `<h4>${won ? L('ทำไมชนะ', 'Why you won') : L('ทำไมแพ้ และลองอะไรต่อ', 'Why you lost, and what to try')}</h4><ul class="reasons">${x.reasons.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
  </div>`;
}

/**
 * Post-fight "You vs Enemy": mirrored bars per kind of value (you left, enemy right, same scale per row),
 * then where the damage each side took came from, as ranked bars. Hover any bar for the skills behind it.
 */
function vsSummary(r: CombatResult, builds: [Build, Build], names2: [string, string]) {
  const fmt = (key: keyof BlockStat, v: number) => (key === 'fz' ? (v / 10).toFixed(1) : String(v));
  // damage per skill with thorns reflection split fairly (the sim credits it all to the oldest thorns stack)
  const dmg = [skillDamage(r, builds[0], 0), skillDamage(r, builds[1], 1)];
  const breakdown = (side: 0 | 1, key: keyof BlockStat) => {
    const list = (key === 'd'
      ? dmg[side].map((x) => ({ name: x.name, v: x.total }))
      : builds[side].skills.map((k, i) => ({ name: nodeOf(k).name, v: r.stats[side][i]?.[key] ?? 0 })))
      .filter((x) => x.v > 0)
      .sort((a, b) => b.v - a.v);
    return list.length
      ? list.map((x) => `<div class="tt-row"><span>${esc(x.name)}</span><b>${fmt(key, x.v)}</b></div>`).join('')
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
  const fStart = (fatigueStart(r.day) / 10).toFixed(0);
  const tookFrom = (side: 0 | 1) => {
    const att = (1 - side) as 0 | 1;
    const list = dmg[att].map((x) => ({ name: x.name, v: x.total, fatigue: false })).filter((x) => x.v > 0);
    if (fatigue[side]) list.push({ name: L(`เหนื่อยล้า (หลัง ${fStart} วิ)`, `Fatigue (after ${fStart}s)`), v: fatigue[side], fatigue: true });
    list.sort((a, b) => b.v - a.v);
    const total = list.reduce((n, x) => n + x.v, 0);
    if (!total) return `<p class="muted small">${L('ไม่โดนดาเมจเลย', 'Took no damage')}</p>`;
    const top = list.slice(0, 6);
    const rest = list.slice(6).reduce((n, x) => n + x.v, 0);
    if (rest) top.push({ name: L('อื่นๆ', 'Other'), v: rest, fatigue: false });
    const color = att ? FOE : YOU;
    return top
      .map((x) => {
        const pct = Math.round((x.v / total) * 100);
        const fill = x.fatigue ? '#6b7480' : color;
        return `<div class="rank"><span class="rank-n">${esc(x.name)}</span>
          <div class="rank-track"><i style="width:${(x.v / top[0].v) * 100}%;background:${fill}"></i></div>
          <span class="rank-v">${x.v} <small class="muted">${pct}%</small></span></div>`;
      })
      .join('');
  };

  return `<div class="vs">
    <div class="vs-head"><span style="color:${YOU}">■</span> <b class="who s0">${esc(names2[0])}</b><span class="muted">vs</span><b class="who s1">${esc(names2[1])}</b> <span style="color:${FOE}">■</span></div>
    ${rows}
    <div class="two took">
      <div><h4>${L(`ดาเมจที่ ${esc(names2[0])} โดน มาจาก`, `Where ${names2[0] === 'You' ? 'you' : esc(names2[0])} took damage from`)}</h4>${tookFrom(0)}</div>
      <div><h4>${L(`ดาเมจที่ ${esc(names2[1])} โดน มาจาก`, `Where ${names2[1] === 'You' ? 'you' : esc(names2[1])} took damage from`)}</h4>${tookFrom(1)}</div>
    </div>
    <p class="muted small">${L('ชี้เมาส์ (หรือแตะ) ที่แถบเพื่อดูว่ามาจาก skill ไหน · ดาเมจรวมส่วนที่โล่กันไว้', 'Hover (or tap) a bar to see which skills it came from · damage includes what shields blocked')}</p>
    <details><summary>${L(`ดูราย skill ของ ${esc(names2[0])}`, `Per-skill stats: ${esc(names2[0])}`)}</summary>${statsTable(builds[0], r.stats[0], dmg[0])}</details>
    <details><summary>${L(`ดูราย skill ของ ${esc(names2[1])}`, `Per-skill stats: ${esc(names2[1])}`)}</summary>${statsTable(builds[1], r.stats[1], dmg[1])}</details>
  </div>`;
}

/** Per-skill breakdown table (the table view of the summary). Placed blocks only; damage = own hits + burn + fair thorns share. */
function statsTable(b: Build, stats0: BlockStat[], dmg: ReturnType<typeof skillDamage>) {
  const rows = b.skills
    .map((k, i) => ({ k, st: stats0[i] ? { ...stats0[i], d: dmg[i]?.total ?? stats0[i].d } : stats0[i] }))
    .filter((x) => x.st && x.k.x >= 0);
  const total = rows.reduce((n, x) => n + x.st.d, 0);
  const has = (key: keyof BlockStat) => rows.some((x) => x.st[key] > 0);
  rows.sort((p, q) => q.st.d - p.st.d || q.st.h + q.st.sh - (p.st.h + p.st.sh));
  const top = rows[0];
  const headline =
    top && total > 0
      ? L(`<p class="statline"><b>${nodeOf(top.k).name}</b> ทำดาเมจ <b>${Math.round((top.st.d / total) * 100)}%</b> ของทั้งหมด (${top.st.d} จาก ${total})</p>`, `<p class="statline"><b>${nodeOf(top.k).name}</b> dealt <b>${Math.round((top.st.d / total) * 100)}%</b> of all damage (${top.st.d} of ${total})</p>`)
      : `<p class="statline muted">${L('ยังไม่ได้ทำดาเมจเลย', 'No damage dealt')}</p>`;
  const body = rows
    .map(({ k, st }) => {
      const pct = total ? Math.round((st.d / total) * 100) : 0;
      return `<tr>
        <td class="sk">${pieceHTML({ ...k, rot: 0 })}<span>${nodeOf(k).name} <small>Lv${lvOf(k.v)}</small></span></td>
        <td>${st.c}${st.tc ? ` <small class="combo">+${st.tc} ⚡</small>` : ''}</td>
        <td class="dmg"><div class="bar"><i style="width:${pct}%"></i></div><span>${st.d}</span> <small class="muted">${pct}%</small></td>
        ${has('bd') ? `<td>${st.bd ? `+${st.bd}` : '·'}</td>` : ''}
        ${has('bf') ? `<td>${st.bf || '·'}</td>` : ''}
        ${has('h') ? `<td>${st.h || '·'}</td>` : ''}
        ${has('sh') ? `<td>${st.sh || '·'}</td>` : ''}
        ${has('fz') ? `<td>${st.fz ? (st.fz / 10).toFixed(1) + L(' วิ', 's') : '·'}</td>` : ''}
      </tr>`;
    })
    .join('');
  return `${headline}<div class="statwrap"><table class="stats-t">
    <tr><th>skill</th><th>${L('ใช้ <small>(+ถูกสั่ง)</small>', 'Uses <small>(+fired)</small>')}</th><th>${L('ดาเมจ', 'Damage')}</th>
      ${has('bd') ? `<th>${L('จากโบนัสติดกัน', 'From connect bonuses')}</th>` : ''}${has('bf') ? `<th>${L('บัฟเพิ่มดาเมจ', 'Buff damage')}</th>` : ''}${has('h') ? `<th>${L('ฟื้นเลือด', 'Healing')}</th>` : ''}${has('sh') ? `<th>${L('โล่', 'Shield')}</th>` : ''}${has('fz') ? `<th>${L('ควบคุม', 'Control')}</th>` : ''}</tr>
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
        // after the champion / run-over cue has had its moment
        setTimeout(() => {
          sfx('stardust');
          voice('stardust');
        }, r.phase === 'won' ? 2600 : 600);
      }
      M.rememberClaim(r.id, res);
      M.saveLocalRun({ ...summary, stardust: res.stardust });
    } else M.rememberClaim(r.id, { none: true });
    if (view === 'over') render();
  });
}

/** Remember the memorable bits of a fight of this run (end-of-run page, local history). */
function noteFight(r: R.RunState, f: FightResponse, x: Explanation, day: number) {
  const m = x.moments.find((y) => y.kind === 'comeback') ?? x.moments.find((y) => y.kind === 'chain') ?? x.moments.find((y) => y.kind === 'hit');
  const comeback = x.moments.some((y) => y.kind === 'comeback' && y.side === 0);
  const score = (f.won ? 50 : 0) + (x.close ? 30 : 0) + (comeback ? 40 : 0) + day;
  const text = `${f.won ? L('ชนะ', 'Beat') : L('แพ้', 'Lost to')} ${names[1]}${x.close ? L(' แบบสูสี', ' in a close fight') : ''}${m ? ` · ${m.title} ${m.text}` : ''}`;
  M.addFightNote(r.id, { day, won: f.won, opp: names[1], fightId: f.fightId, close: x.close, score, text });
}

function renderResult() {
  const f = last!;
  const r = run!;
  const link = f.fightId ? `${location.origin}${location.pathname}?replay=${f.fightId}` : '';
  const oname = names[1];
  const x = lastBuild ? explain(f.result, [lastBuild, f.opponent.build], 0, [youName(), oname], { drawIsLoss: true }) : null;
  const draw = f.result.winner === -1;
  return `
  <div class="mm-result ${f.won ? 'won' : 'lost'}">
    <h2 class="${f.won ? 'win' : 'lose'}">${f.won ? L('ชนะ', 'Victory') : draw ? L('เสมอ (นับเป็นแพ้)', 'Draw (counts as a loss)') : L('แพ้', 'Defeat')} · ${L('วันที่', 'day')} ${lastDay}${x?.close ? ` <span class="mm-tag close">${L('สูสี!', 'Close fight!')}</span>` : ''}</h2>
    <p>${L('คู่ต่อสู้', 'Opponent')}: <b class="who s1">${esc(oname)}</b> · ${HEROES_BY_ID[f.opponent.build.hero].name}
     ${f.offline ? `<span class="muted">${L('(ออฟไลน์: เซิร์ฟเวอร์ไม่ตอบ สู้กับ AI ในเครื่อง)', '(offline: the server did not answer, so you fought a local AI)')}</span>` : ''}</p>
    <p>${f.won ? L(`ชนะแล้ว ${r.wins}/${R.WIN_TARGET}`, `${r.wins}/${R.WIN_TARGET} wins`) : L(`เสียเลือด ${lastDamage} · เหลือ ${Math.max(0, r.hp)}`, `Lost ${lastDamage} HP · ${Math.max(0, r.hp)} left`)} · ${L('คะแนน build ใหม่', 'new build rating')} ${f.rating}</p>
  </div>
  ${x ? P.fightHighlights(x, { replayAction: 'rewatch' }) : ''}
  <div class="actions mm-actions"><button class="primary" data-a="next">${L('ต่อไป', 'Next')}</button>${x && !x.close ? `<button data-a="rewatch">▶ ${L('ดูไฟต์นี้อีกครั้ง', 'Watch this fight again')}</button>` : ''}</div>
  <h3>${L('สรุปการสู้', 'Fight summary')}</h3>
  ${x ? explainHTML(f.result, x, 0) : ''}
  ${lastBuild ? vsSummary(f.result, [lastBuild, f.opponent.build], [youName(), oname]) : ''}
  <h3>${L(`build ของ ${esc(oname)}`, `${esc(oname)}’s build`)}</h3>
  ${buildList(f.opponent.build)}
  ${link ? `<p class="muted">${L('ลิงก์ replay', 'Replay link')}: <input class="link" readonly value="${esc(link)}" onclick="this.select()"></p>` : ''}
  <div class="actions mm-actions"><button class="primary" data-a="next">${L('ต่อไป', 'Next')}</button></div>`;
}

function renderLastChance() {
  scene.idle(run!.hero, R.lookOf(run!));
  return `
  <h2 class="lose">${L('เลือดหมด… แต่ยังไม่จบ', 'Out of HP… but not out yet')}</h2>
  <p>${L('คุณเข้าสู่สถานะ <b>กึ่งวิญญาณ</b>: กลับมาด้วยเลือด 1 แพ้อีกครั้งคือจบรอบ เลือกพลังหนึ่งอย่าง', 'You become a <b>half-ghost</b>: you come back with 1 HP and the next loss ends the run. Pick one power')}</p>
  <div class="heroes">
    <button class="hero" data-a="lc" data-i="awaken"><b>${L('ตื่นพลัง', 'Awaken')}</b><span>${L('skill Lv1 ทุกใบขึ้นเป็น Lv2 (สุ่มสาย A หรือ B)', 'Every Lv1 skill becomes Lv2 (random branch A or B)')}</span><span class="muted">${L('เหมาะกับ build ที่ของครบแต่เลเวลต่ำ', 'Good for builds with all the pieces but low levels')}</span></button>
    <button class="hero" data-a="lc" data-i="mark"><b>${L('ตราวิญญาณ', 'Spirit Mark')}</b><span>${L('สุ่มตราหนึ่งในสี่แบบ แล้วเลือกใส่ skill ในตาราง', 'Roll one of four marks, then put it on a skill on your grid')}</span><span class="muted">${L('เหมาะกับ build ที่มี skill หลักชัด', 'Good for builds with one clear main skill')}</span></button>
    <button class="hero" data-a="lc" data-i="supply"><b>${L('เสบียงสุดท้าย', 'Last Supplies')}</b><span>${L('เงิน 8 และตาราง +1 แถวถาวร', '8 gold and +1 grid row for good')}</span><span class="muted">${L('เหมาะกับ build ที่ยังขาดชิ้นสำคัญ', 'Good for builds still missing a key piece')}</span></button>
  </div>`;
}

function renderMark() {
  const r = run!;
  const m = R.MARK_INFO[r.pendingMark!];
  return `
  <h2>${L('ได้ตรา', 'Mark')}: ${m.name}</h2>
  <p>${m.desc} · ${L('เลือก skill ในตารางที่จะใส่ตรา', 'pick the skill on your grid to mark')}</p>
  <ol class="build mm-markpick">${r.skills
    .map((k, i) => (k.x < 0 ? '' : `<li class="arch-${SKILLS[k.id].arch}">${skillLine(k)}<span class="btns"><button data-a="mark" data-i="${i}">${L('ใส่ตรานี้', 'Mark this')}</button></span></li>`))
    .join('')}</ol>
  <div class="actions"><button class="ghost" data-a="mark" data-i="-1">${L('ไม่ใส่', 'Skip')}</button></div>`;
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

/** Display names of a replay: "You" for your own fights, and never two identical names. */
function replayNames(f: ReplayRecord): [string, string] {
  const mine = !!run?.log.some((l) => l.fightId === f.id) || M.localHistory().some((h) => h.bestFightId === f.id) || replayIsMine(f.id);
  const a = mine ? youName() : f.a.name || L('ผู้เล่น', 'Player');
  const b = oppLabel({ name: f.b.name, ai: f.b.ai, tier: (f.b as { tier?: unknown }).tier });
  return b === a ? [`${a} (${L('ซ้าย', 'left')})`, `${b} (${L('ขวา', 'right')})`] : [a, b];
}
/** fight ids of this browser's own fights (any run), remembered so old replays still say "You" */
const MINE_KEY = 'mochi.myFights';
function replayIsMine(id: string) {
  return (fetchStore(MINE_KEY) ?? '').split(',').includes(id);
}
function rememberMine(id?: string) {
  if (!id) return;
  const list = (fetchStore(MINE_KEY) ?? '').split(',').filter(Boolean);
  if (!list.includes(id)) store(MINE_KEY, [id, ...list].slice(0, 200).join(','));
}

function renderReplayDone() {
  const f = replay!;
  const x = replayResult ? explain(replayResult, [f.a.build, f.b.build], 0, names) : null;
  return `
  <h2>Replay · ${L('วันที่', 'day')} ${f.day}${x?.close ? ` <span class="mm-tag close">${L('สูสี!', 'Close fight!')}</span>` : ''}</h2>
  ${x ? P.fightHighlights(x, { replayAction: 'replayAgain' }) : ''}
  <div class="actions mm-actions"><button data-a="replayAgain">▶ ${L('ดูอีกครั้ง', 'Watch again')}</button><button class="primary" data-a="leaveReplay">${L('เล่นเกมของคุณ', 'Play your own game')}</button></div>
  <h3>${L('สรุปการสู้', 'Fight summary')}</h3>
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

/** Today's-arena scouting chip, placed above the fight button of the shop (the shop markup itself is not touched). */
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
  const isYou = (s: number) => names[s] === youName();
  // English verbs agree with "You" (you lose / Mochi-12 loses)
  const v = (s: number, you: string, other: string) => (isYou(s) ? you : other);
  const varName = (side: number, id: string) => {
    const k = logBuilds?.[side]?.skills.find((x) => x.id === id && x.x >= 0);
    return k ? nodeOf(k).name : SKILLS[id]?.name ?? id;
  };
  const sp = '&nbsp;&nbsp;';
  switch (e.type) {
    case 'cast':
      return `${e.chain ? `${sp}⚡ ` : ''}${who(e.side)} ${L('ใช้', v(e.side, 'use', 'uses'))} <b>${varName(e.side, e.skill)}</b> Lv${e.lv}${e.chain ? ` <span class="combo">${L('เชน', 'chain')} x${e.chain + 1}</span>` : ''}${e.echo ? L(' (ตีซ้ำ)', ' (echo)') : ''}`;
    case 'damage': {
      const attacker = 1 - e.side;
      const src =
        e.src === 'burn' ? L('ไฟ', 'burn')
        : e.src === 'fatigue' ? L('ความเหนื่อยล้า', 'fatigue')
        : logRefl.has(e) ? L(`หนามของ${esc(names[attacker])}`, isYou(attacker) ? 'your thorns' : `${esc(names[attacker])}’s thorns`)
        : varName(attacker, e.src);
      return `${sp}${who(e.side)} ${L('เสีย', v(e.side, 'lose', 'loses'))} <b class="dmg">${e.amount}</b>${e.blocked ? ` (${L('โล่กัน', 'shield blocked')} ${e.blocked})` : ''} ${L('จาก', 'from ')}${src}`;
    }
    case 'status':
      switch (e.status) {
        case 'freeze':
          return e.value > 0 ? `${sp}${who(e.side)} ${L('ถูกแช่แข็ง', v(e.side, 'are frozen for', 'is frozen for'))} ${(e.value / 10).toFixed(1)}${L(' วิ', 's')}` : `${sp}${who(e.side)} ${L('ต้านการแช่แข็ง', v(e.side, 'resist the freeze', 'resists the freeze'))}`;
        case 'slow':
          return `${sp}${who(e.side)} ${L('ช้าลง', v(e.side, 'are slowed', 'is slowed'))} ${e.value}%`;
        case 'rage':
          return `${who(e.side)} <b>${L('คลั่ง!', v(e.side, 'rage!', 'rages!'))}</b> ${L('พลังโจมตี', 'power')} +${e.value}`;
        case 'amplify':
          return e.value > 0 ? `${sp}${who(e.side)} ${L('บัฟเป็น 2 เท่า', v(e.side, 'double your buffs', 'doubles their buffs'))} (+${e.value})` : null;
        case 'cleanse':
          return e.value > 0 ? `${sp}${who(e.side)} ${L(`ล้างดีบัฟ ${e.value} อย่าง`, `${v(e.side, 'cleanse', 'cleanses')} ${e.value} debuffs`)}` : null;
        case 'dispel':
          return e.value > 0 ? `${sp}${who(e.side)} ${L(`ถูกลบบัฟ ${e.value} อย่าง`, `${v(e.side, 'lose', 'loses')} ${e.value} buffs`)}` : null;
        case 'delay':
          return e.value > 0 ? `${sp}${who(e.side)} ${L('คูลดาวน์ถอยหลัง', 'cooldowns pushed back')} ${(e.value / 10).toFixed(1)}${L(' วิ', 's')}` : `${sp}${who(e.side)} ${L('ต้านการถ่วงเวลา', v(e.side, 'resist the delay', 'resists the delay'))}`;
        default:
          return null;
      }
    case 'fatigue':
      return `<span class="muted">${L(`เหนื่อยล้า: ทั้งสองฝ่ายเสีย ${e.amount}`, `Fatigue: both sides lose ${e.amount}`)}</span>`;
    case 'end':
      return `<b>${e.winner === -1 ? L('เสมอ', 'Draw') : who(e.winner) + L(' ชนะ', v(e.winner, ' win', ' wins'))}</b>`;
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
  rememberMine(res.fightId);
  names = [youName(), oppLabel(res.opponent as FightResponse['opponent'] & { tier?: unknown })];
  const ex = explain(res.result, [build, res.opponent.build], 0, names, { drawIsLoss: true });
  lastClose = ex.close;
  noteFight(r, res, ex, lastDay);
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
    toast = L('ไม่พบ replay นี้', 'Replay not found');
    view = 'town';
    render();
    return;
  }
  playReplay();
}
function playReplay() {
  const f = replay!;
  if (f.v !== SIM_VERSION) {
    toast = L('replay นี้มาจากเกมเวอร์ชันเก่า ดูซ้ำไม่ได้แล้ว', 'This replay is from an older game version and can no longer be played');
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
      sel = null;
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
    case 'tree':
      if (!SKILLS[arg]) return;
      treeOpen = { id: arg, cur: el.dataset.own === '1' ? (el.dataset.cur ?? '') : null, offer: el.dataset.offer || null };
      render();
      return;
    case 'treeClose':
      treeOpen = null;
      render();
      return;
    case 'reroll':
      err = R.reroll(run!);
      break;
    case 'sell':
      R.sell(run!, n);
      sel = null;
      break;
    case 'rot':
      err = rotateSelected();
      break;
    case 'bag':
      if (sel !== null) err = R.unplace(run!, sel);
      break;
    case 'desel':
      sel = null;
      break;
    case 'auto': {
      flipFrom = blockRects();
      const res = autoArrange(run!);
      sel = null;
      toast = !res.changed
        ? L(`จัดดีที่สุดแล้ว · โบนัสทำงาน ${res.after} อัน`, `Already the best layout · ${res.after} bonuses active`)
        : L(`จัดใหม่แล้ว · โบนัสทำงาน ${res.before} → ${res.after} อัน`, `Rearranged · bonuses active ${res.before} → ${res.after}`);
      if (!res.changed) flipFrom = null;
      break;
    }
    case 'expand':
      err = R.buyExpand(run!);
      break;
    case 'concede':
      confirmConcede = true;
      break;
    case 'concedeNo':
      confirmConcede = false;
      break;
    case 'concedeYes':
      confirmConcede = false;
      sel = null;
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
  else if (a === 'buy' || a === 'sell' || a === 'reroll') sfx(a);
  else if (a === 'expand') sfx('unlock');
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
  if (!key.startsWith('raw:')) highlightFor(key);
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
  clearHighlight();
}

let hlKey = '';
function clearHighlight() {
  hlKey = '';
  document.querySelector('.grid.live')?.classList.remove('hovering');
  document.querySelectorAll('.blk.hl-on, .blk.hl-hint, .blk.hl-self').forEach((el) => {
    el.classList.remove('hl-on', 'hl-hint', 'hl-self');
    (el as SVGElement).style.removeProperty('--hl');
  });
}

/** Light up the shapes each bonus of the hovered skill/offer cares about, in that bonus's colour. */
function highlightFor(key: string) {
  if (key === hlKey || !run) return;
  clearHighlight();
  hlKey = key;
  const r = run;
  const n = Number(key.slice(2));
  const from = key[0] === 'g' ? n : -1;
  const bonus = key[0] === 'g' ? r.skills[n]?.bonus : r.shop[n]?.bonus;
  if (!bonus) return;
  const { w, h } = R.gridOf(r);
  const act = from >= 0 && r.skills[from].x >= 0 ? activeBonuses(r.skills, w, h) : [];
  const blockEl = (j: number) => document.querySelector(`.grid.live [data-blk="${j}"]`) as SVGElement | null;
  document.querySelector('.grid.live')?.classList.add('hovering');
  if (from >= 0) blockEl(from)?.classList.add('hl-self');
  bonus.forEach((b, bi) => {
    r.skills.forEach((k, j) => {
      if (k.x < 0 || j === from || !matches(b.t, k)) return;
      const el = blockEl(j);
      if (!el || el.classList.contains('hl-on')) return;
      const on = act.some((a) => a.from === from && a.bi === bi && a.to.includes(j));
      el.classList.remove('hl-hint');
      el.classList.add(on ? 'hl-on' : 'hl-hint');
      el.style.setProperty('--hl', HL[bi % HL.length]);
    });
  });
}
function onHover(ev: PointerEvent) {
  if (ev.pointerType !== 'mouse' || drag?.moved) return;
  const kw = (ev.target as Element).closest?.('[data-kw]') as HTMLElement | null;
  if (kw) return showTip('raw:' + kwTip(kw.dataset.kw as Keyword), ev.clientX, ev.clientY);
  const tt = (ev.target as Element).closest?.('[data-ttxt]') as HTMLElement | null;
  if (tt) return showTip('raw:' + tt.dataset.ttxt, ev.clientX, ev.clientY);
  const el = (ev.target as Element).closest?.('[data-tip]') as HTMLElement | SVGElement | null;
  if (el && view === 'shop') showTip(el.dataset.tip!, ev.clientX, ev.clientY);
  else hideTip();
}

function onContextMenu(ev: MouseEvent) {
  if (view !== 'shop' || !run) return;
  if (drag?.moved) {
    // right-click while dragging rotates the block in hand
    ev.preventDefault();
    drag.rot = ((drag.rot + 1) % 4) as Rot;
    if (drag.ghost) {
      drag.ghost.innerHTML = pieceHTML({ ...run.skills[drag.i], rot: drag.rot });
      spin(drag.ghost.querySelector('.blk'));
    }
    return;
  }
  const el = (ev.target as Element).closest?.('[data-blk]') as HTMLElement | SVGElement | null;
  if (!el) return;
  ev.preventDefault();
  const prev = sel;
  sel = Number(el.dataset.blk);
  toast = rotateSelected() ?? '';
  if (prev !== sel && toast) sel = prev;
  hideTip();
  saveRun();
  render();
}

// ---------- block animations ----------
const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Restart the rotate animation on a block element. */
function spin(el: Element | null) {
  if (!el || reduceMotion()) return;
  el.classList.remove('rot-anim');
  void (el as HTMLElement).getBoundingClientRect(); // restart the CSS animation
  el.classList.add('rot-anim');
  el.addEventListener('animationend', () => el.classList.remove('rot-anim'), { once: true });
}

/** Current on-screen box of every block in the grid and the bag, by skill index. */
function blockRects() {
  const m = new Map<number, DOMRect>();
  document.querySelectorAll<SVGElement>('[data-blk]').forEach((el) => m.set(Number(el.dataset.blk), el.getBoundingClientRect()));
  return m;
}

/** After a render: spin the rotated block, slide auto-arranged blocks from where they were. */
function playBlockAnims() {
  if (animRot !== null) {
    document.querySelectorAll(`[data-blk="${animRot}"]`).forEach((el) => spin(el));
    animRot = null;
  }
  if (flipFrom) {
    const from = flipFrom;
    flipFrom = null;
    if (reduceMotion()) return;
    document.querySelectorAll<SVGElement>('[data-blk]').forEach((el, n) => {
      const a = from.get(Number(el.dataset.blk));
      const b = el.getBoundingClientRect();
      if (!a) return;
      const dx = a.left - b.left;
      const dy = a.top - b.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      el.animate(
        [{ transform: `translate(${dx}px, ${dy}px)`, opacity: 0.6 }, { transform: 'translate(0, 0)', opacity: 1 }],
        { duration: 420, delay: n * 35, easing: 'cubic-bezier(.2,.8,.2,1.15)', fill: 'backwards' },
      );
    });
  }
}

// ---------- grid: tap, drag, rotate ----------
function rotateSelected(): string | null {
  const r = run;
  if (!r || sel === null) return null;
  const k = r.skills[sel];
  const rot = ((k.rot + 1) % 4) as Rot;
  animRot = sel;
  if (k.x < 0) {
    k.rot = rot;
    return null;
  }
  const { w, h } = R.gridOf(r);
  const tries = [[0, 0], [-1, 0], [0, -1], [-1, -1], [1, 0], [0, 1], [-2, 0], [0, -2]];
  for (const [dx, dy] of tries)
    if (fits(r.skills, w, h, sel, k.x + dx, k.y + dy, rot)) return R.place(r, sel, k.x + dx, k.y + dy, rot);
  // no room for the rotated shape here: rotate it anyway and park it in the backpack
  if (R.unplace(r, sel)) return L('หมุนตรงนี้ไม่ได้ และกระเป๋าเต็ม', 'Cannot rotate here, and the bag is full');
  k.rot = rot;
  return L('หมุนแล้ว แต่ไม่มีที่ว่าง ย้ายไปไว้ในกระเป๋า ลากกลับมาวางได้', 'Rotated, but there was no room, so it went to your bag. Drag it back to place it');
}

/** Place block i so that it covers grid cell (gx, gy); tries every cell of the block as the anchor. */
function placeCovering(i: number, gx: number, gy: number): string | null {
  const r = run!;
  const k = r.skills[i];
  const { w, h } = R.gridOf(r);
  const n = footprintAt(k, 0, 0).length;
  for (let c = 0; c < n; c++) {
    const [x, y] = dropOrigin(k, c, gx, gy);
    if (fits(r.skills, w, h, i, x, y, k.rot)) return R.place(r, i, x, y, k.rot);
  }
  return L('วางตรงนี้ไม่ได้', 'Cannot place it here');
}

interface Drag {
  i: number;
  c: number;
  sx: number;
  sy: number;
  moved: boolean;
  /** rotation while dragging (R key); applied on drop */
  rot: Rot;
  ghost?: HTMLElement;
}
let drag: Drag | null = null;

function elementAt(x: number, y: number) {
  return document.elementFromPoint(x, y) as HTMLElement | null;
}

function clearPreview() {
  document.querySelectorAll('.gc.ok, .gc.bad').forEach((el) => el.classList.remove('ok', 'bad'));
}

function onPointerDown(ev: PointerEvent) {
  if (ev.pointerType !== 'mouse') {
    // tap a keyword chip or a chart block to see its details
    const kw = (ev.target as Element).closest?.('[data-kw]') as HTMLElement | null;
    if (kw) return showTip('raw:' + kwTip(kw.dataset.kw as Keyword), ev.clientX, ev.clientY);
    const tt = (ev.target as Element).closest?.('[data-ttxt]') as HTMLElement | null;
    if (tt) return showTip('raw:' + tt.dataset.ttxt, ev.clientX, ev.clientY);
    if (!(ev.target as Element).closest?.('[data-tip]')) hideTip();
  }
  if (view !== 'shop' || !run) return;
  if (ev.button === 2) return;
  const el = (ev.target as Element).closest('[data-blk]') as HTMLElement | SVGElement | null;
  if (el) {
    drag = { i: Number(el.dataset.blk), c: Number(((ev.target as Element).closest('[data-c]') as SVGElement | null)?.dataset.c ?? 0), sx: ev.clientX, sy: ev.clientY, moved: false, rot: run.skills[Number(el.dataset.blk)].rot };
    return;
  }
  // tap on an empty grid cell moves the selected block there
  const cell = (ev.target as HTMLElement).closest<HTMLElement>('[data-gx]');
  if (cell && sel !== null) {
    toast = placeCovering(sel, Number(cell.dataset.gx), Number(cell.dataset.gy)) ?? '';
    saveRun();
    render();
  }
}

function onPointerMove(ev: PointerEvent) {
  if (!drag || !run) return;
  if (!drag.moved && Math.hypot(ev.clientX - drag.sx, ev.clientY - drag.sy) < 6) return;
  const k = { ...run.skills[drag.i], rot: drag.rot };
  if (!drag.moved) {
    drag.moved = true;
    const cs = getComputedStyle(document.querySelector('.grid.live') ?? document.body).getPropertyValue('--c');
    const g = document.createElement('div');
    g.className = 'drag-ghost';
    if (cs) g.style.setProperty('--c', cs);
    g.innerHTML = pieceHTML(k);
    hideTip();
    document.body.appendChild(g);
    drag.ghost = g;
  }
  const size = drag.ghost!.querySelector('.bc')?.getBoundingClientRect().width ?? 40;
  const [ox, oy] = dropOrigin(k, drag.c, 0, 0); // = minus the grabbed cell's offset
  drag.ghost!.style.left = `${ev.clientX + (ox - 0.5) * size}px`;
  drag.ghost!.style.top = `${ev.clientY + (oy - 0.5) * size}px`;
  clearPreview();
  const cell = elementAt(ev.clientX, ev.clientY)?.closest<HTMLElement>('[data-gx]');
  if (cell) {
    const [x, y] = dropOrigin(k, drag.c, Number(cell.dataset.gx), Number(cell.dataset.gy));
    const { w, h } = R.gridOf(run);
    const ok = fits(run.skills, w, h, drag.i, x, y, drag.rot);
    for (const [fx, fy] of footprintAt(k, x, y))
      document.querySelector(`[data-gx="${fx}"][data-gy="${fy}"]`)?.classList.add(ok ? 'ok' : 'bad');
  }
}

function onPointerUp(ev: PointerEvent) {
  const d = drag;
  drag = null;
  if (!d || !run) return;
  d.ghost?.remove();
  clearPreview();
  let err: string | null = null;
  if (!d.moved) {
    sel = sel === d.i ? null : d.i;
  } else {
    const under = elementAt(ev.clientX, ev.clientY);
    const cell = under?.closest<HTMLElement>('[data-gx]');
    const drop = under?.closest<HTMLElement>('[data-drop]')?.dataset.drop;
    const k = { ...run.skills[d.i], rot: d.rot };
    if (cell) {
      const [x, y] = dropOrigin(k, d.c, Number(cell.dataset.gx), Number(cell.dataset.gy));
      err = R.place(run, d.i, x, y, d.rot);
      sel = d.i;
    } else if (drop === 'bag') err = R.unplace(run, d.i);
    else if (drop === 'sell') {
      R.sell(run, d.i);
      sel = null;
    }
  }
  if (err) toast = err;
  saveRun();
  render();
}

function onKey(ev: KeyboardEvent) {
  if (view !== 'shop' || (ev.target as HTMLElement).tagName === 'INPUT') return;
  if (ev.key !== 'r' && ev.key !== 'R') return;
  if (drag?.moved && run) {
    // rotate while dragging; the new rotation is used on drop
    drag.rot = ((drag.rot + 1) % 4) as Rot;
    if (drag.ghost) {
      drag.ghost.innerHTML = pieceHTML({ ...run.skills[drag.i], rot: drag.rot });
      spin(drag.ghost.querySelector('.blk'));
    }
    return;
  }
  toast = rotateSelected() ?? '';
  saveRun();
  render();
}

export function startUI(st: Stage) {
  stage = st;
  scene = st.combat;
  onLang(() => render());
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('looks')) {
    // dev only: every meme face and prop on one hero, to check the art (?looks or ?looks=witch)
    $panel.innerHTML = `<h2>Meme faces and props</h2><div style="display:flex;flex-wrap:wrap;gap:8px">${memeGallery(new URLSearchParams(location.search).get('looks') || 'knight')}</div>`;
    return;
  }
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
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('keydown', onKey);
  window.addEventListener('pointermove', onHover);
  $panel.addEventListener('contextmenu', onContextMenu);
  $panel.addEventListener('pointerleave', hideTip);
  installPatterns();
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
