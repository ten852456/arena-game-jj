/**
 * Chains (connect bonuses between neighbours in the skill list), drawn as pictures:
 * - partner chips  ▲/▼ [partner icon] +2⚔  (gold when the partner sits there, grey when not)
 * - connectors between adjacent rows (faint dashed, or a glowing gold line with the bonus)
 * - the active-chain panel as icon equations  [icon]+[icon] = +2⚔
 * - "pairs with" icons on shop cards, and a "put it here" marker in the list for the card under the pointer
 * - drag preview (partner rows glow, the drop line pulses with the bonus it would switch on)
 * - after every shop render: new links burst + chime + toast, broken links fade out
 * Pure HTML strings + small DOM touches; ui.ts owns rendering and calls in here.
 */
import { L } from '../../i18n';
import { HASTE_BONUS, POWER_BONUS, activeBonuses, bonusValue, matches, type ActiveBonus } from '../../sim/links';
import { LINE_NAME, SKILLS, lvOf, nodeOf } from '../../sim/skills';
import { slotsOf, type Offer, type RunState } from '../../sim/run';
import type { Bonus, SkillInstance } from '../../sim/types';
import { LINE_COLORS, lineIcon, skillIcon, type LineIconId } from '../assets';
import { linkChime } from '../audio';

/** where the partner sits: above, below, both, or not placed yet (either works) */
export type Dir = 'up' | 'down' | 'both' | 'any';

export const BONUS_GLYPH: Record<Bonus['e'], string> = { dmg: '⚔', shield: '⛨', haste: '»', power: '✦', trigger: '⚡' };

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const isArch = (t: string) => t.startsWith('line:');
const archOf = (t: string) => t.slice(5) as LineIconId;
/** picture for a bonus condition: the skill's badge, or the archetype emblem */
export const targetIcon = (t: string) => (isArch(t) ? lineIcon(archOf(t)) : skillIcon(t));
/** words for a bonus condition */
export const targetWords = (t: string) =>
  isArch(t) ? L(`skill สาย${LINE_NAME[archOf(t)]}`, `any ${LINE_NAME[archOf(t)]} line skill`) : (SKILLS[t]?.name ?? t);

/** "+2⚔", "-20%»", "+15%✦", "⚡" */
export function bonusShort(b: Bonus, lv: number) {
  const g = BONUS_GLYPH[b.e];
  switch (b.e) {
    case 'dmg':
    case 'shield':
      return `+${bonusValue(b.e, lv)}${g}`;
    case 'haste':
      return `-${Math.round(HASTE_BONUS * 100)}%${g}`;
    case 'power':
      return `+${Math.round(POWER_BONUS * 100)}%${g}`;
    default:
      return g;
  }
}
/** "+2 ดาเมจ" / "+2 damage" (toast, tooltips) */
export function bonusWords(b: Bonus, lv: number) {
  const v = bonusValue(b.e, lv);
  return {
    dmg: L(`+${v} ดาเมจ`, `+${v} damage`),
    shield: L(`+${v} โล่`, `+${v} shield`),
    haste: L(`คูลดาวน์ -${Math.round(HASTE_BONUS * 100)}%`, `cooldown -${Math.round(HASTE_BONUS * 100)}%`),
    power: L(`แรงขึ้น ${Math.round(POWER_BONUS * 100)}%`, `${Math.round(POWER_BONUS * 100)}% stronger`),
    trigger: L('สั่งให้ทำงานตาม ⚡', 'fires it too ⚡'),
  }[b.e];
}

const ico = (src: string, cls: string, t?: string) =>
  `<img class="${cls}" src="${src}" alt=""${t && isArch(t) ? ` style="--ring:${LINE_COLORS[archOf(t)]}"` : ''} draggable="false">`;

// ---------- 1. partner chips ----------
const DIR_GLYPH: Record<Dir, string> = { up: '▲', down: '▼', both: '▲▼', any: '⇅' };
const DIR_WORDS = (d: Dir) =>
  ({ up: L('อยู่ช่องบน', 'sits above'), down: L('อยู่ช่องล่าง', 'sits below'), both: L('อยู่ทั้งบนและล่าง', 'sits above and below'), any: L('วางช่องบนหรือล่างก็ได้', 'goes above or below') })[d];

/**
 * One partner chip. st: on = partner in place, can = you own a partner (not next to it yet), off = nothing yet.
 * tip = the long explanation (HTML) shown on hover / tap.
 */
export function partnerChip(b: Bonus, lv: number, st: 'on' | 'can' | 'off', dir: Dir, tip: string) {
  const own = st !== 'off' ? `<i class="pc-ok" aria-hidden="true">✓</i>` : '';
  const label = `${targetWords(b.t)} ${DIR_WORDS(dir)}: ${bonusWords(b, lv)}`;
  return `<span class="pchip ${st} e-${b.e}" data-ttxt="${esc(tip)}" role="img" aria-label="${esc(label)}">` +
    `<i class="pc-dir" aria-hidden="true">${DIR_GLYPH[dir]}</i>${ico(targetIcon(b.t), 'pc-ico', b.t)}${own}` +
    `<b class="pc-amt">${bonusShort(b, lv)}</b></span>`;
}

/** where the partners of skill i's bonuses sit right now (bonus index → Dir) */
export function chainDirs(skills: SkillInstance[], i: number, act: ActiveBonus[] = activeBonuses(skills)) {
  const out = new Map<number, Dir>();
  for (const a of act) {
    if (a.from !== i) continue;
    const up = a.to.some((j) => j < i);
    const down = a.to.some((j) => j > i);
    out.set(a.bi, up && down ? 'both' : up ? 'up' : 'down');
  }
  return (bi: number): Dir => out.get(bi) ?? 'any';
}

// ---------- 2. connectors between rows ----------
/** active bonuses that cross the gap between row i and row i+1 */
const across = (act: ActiveBonus[], i: number) =>
  act.filter((a) => (a.from === i && a.to.includes(i + 1)) || (a.from === i + 1 && a.to.includes(i)));

/** The gutter between row i and row i+1: faint dashed when nothing links, a glowing gold line + bonus when it does. */
export function gapHTML(skills: SkillInstance[], i: number, act: ActiveBonus[]) {
  const on = across(act, i);
  if (!on.length) return `<li class="cgap" data-gap="${i}" aria-hidden="true"><span class="cg-line"></span></li>`;
  const lbl = on.map((a) => `<span class="cg-b e-${a.b.e}">${a.from === i ? '▼' : '▲'}${bonusShort(a.b, lvOf(skills[a.from].v))}</span>`).join('');
  const words = on
    .map((a) => {
      const owner = skills[a.from];
      const partner = skills[a.from === i ? i + 1 : i];
      return `<div>🔗 <b>${esc(nodeOf(owner).name)}</b> + <b>${esc(nodeOf(partner).name)}</b>: ${esc(nodeOf(owner).name)} ${esc(bonusWords(a.b, lvOf(owner.v)))}</div>`;
    })
    .join('');
  const tip = `<div class="tt-h"><b>${L('🔗 โซ่ทำงาน', '🔗 Chain active')}</b></div>${words}<div class="muted small">${L('▲ = ตัวล่างได้โบนัส · ▼ = ตัวบนได้โบนัส', '▲ = the lower skill gets it · ▼ = the upper skill gets it')}</div>`;
  return `<li class="cgap on" data-gap="${i}" aria-hidden="true"><span class="cg-line"></span><span class="cg-bead"></span>` +
    `<span class="cg-lbl" data-ttxt="${esc(tip)}">🔗${lbl}</span></li>`;
}

// ---------- 5. active-chain panel (icon equations) ----------
export function chainPanelHTML(skills: SkillInstance[], act: ActiveBonus[]) {
  const total = skills.reduce((n, k) => n + (k.bonus?.length ?? 0), 0);
  const eq = (owner: SkillInstance, b: Bonus, partners: SkillInstance[], cls: string, note: string) => {
    const lv = lvOf(owner.v);
    const tip = `<div class="tt-h"><b>${esc(nodeOf(owner).name)}</b> + ${partners.map((p) => `<b>${esc(nodeOf(p).name)}</b>`).join(' / ')}</div><div>${esc(nodeOf(owner).name)}: ${esc(bonusWords(b, lv))}</div>${note}`;
    return `<li class="ceq ${cls} e-${b.e}" data-ttxt="${esc(tip)}">${ico(skillIcon(owner.id), 'ceq-ico')}<i class="ceq-op">+</i>` +
      `<span class="ceq-ps">${partners.map((p) => ico(skillIcon(p.id), 'ceq-ico')).join('')}</span><i class="ceq-op">=</i><b class="ceq-amt">${bonusShort(b, lv)}</b></li>`;
  };
  const on = act.map((a) => eq(skills[a.from], a.b, a.to.map((j) => skills[j]), 'on', ''));
  // owned partners that are not next to each other yet: "almost" chains
  const actKey = new Set(act.map((a) => `${a.from}:${a.bi}`));
  const almost: string[] = [];
  skills.forEach((k, i) =>
    (k.bonus ?? []).forEach((b, bi) => {
      if (actKey.has(`${i}:${bi}`)) return;
      const ps = skills.filter((p, j) => j !== i && SKILLS[p.id] && matches(b.t, p));
      if (ps.length) almost.push(eq(k, b, ps.slice(0, 2), 'almost', `<div class="muted small">${L('มีครบแล้ว: ลากให้อยู่ติดกัน', 'You own both: drag them next to each other')}</div>`));
    }),
  );
  const body = on.length || almost.length
    ? `<ul class="ceq-list">${on.join('')}${almost.slice(0, 3).join('')}</ul>`
    : `<p class="ceq-empty info-det">${L('ยังไม่มีโซ่ · ดูไอคอน ⇅ บนแต่ละ skill แล้ววางตัวที่ตรงกันไว้ติดกัน', 'No chains yet · check the ⇅ icons on each skill and put the matching one right next to it')}</p>` +
      `<p class="ceq-empty info-simp">${L('ยังไม่มีโซ่ · ซื้อการ์ดที่เขียน 🔗 ต่อโซ่กับ แล้วมันจะไปวางติดกันเอง', 'No chains yet · buy a card that says 🔗 Chains with, and it lands next to its partner')}</p>`;
  return `<aside class="chain-panel" aria-label="${L('โซ่ที่ทำงาน', 'Active chains')}">
    <div class="cp-h"><span>${L('🔗 โซ่ที่ทำงาน', '🔗 Active chains')}</span><span class="cp-count">${act.length}/${total}</span></div>${body}</aside>`;
}

// ---------- 4. shop cards: "pairs with" ----------
/** Partner icons for a new-skill offer: its own bonus targets, plus owned skills whose bonuses this skill would switch on. */
export function offerPairsHTML(r: RunState, o: Offer, tipFor: (b: Bonus) => string) {
  if (o.v !== '') return '';
  const chips: string[] = [];
  (o.bonus ?? []).forEach((b) => {
    const owned = r.skills.some((k) => SKILLS[k.id] && matches(b.t, k));
    chips.push(partnerChip(b, 1, owned ? 'can' : 'off', 'any', tipFor(b)));
  });
  for (const k of r.skills)
    for (const b of k.bonus ?? []) {
      if (!matches(b.t, { id: o.id })) continue;
      const lv = lvOf(k.v);
      const tip = `<div class="tt-h"><b>${L('🔗 เข้ากับ skill ที่คุณมี', '🔗 Pairs with a skill you own')}</b></div><div>${L(
        `วาง ${esc(SKILLS[o.id].name)} ติดกับ <b>${esc(nodeOf(k).name)}</b> → ${esc(nodeOf(k).name)} ${esc(bonusWords(b, lv))}`,
        `Put ${esc(SKILLS[o.id].name)} next to <b>${esc(nodeOf(k).name)}</b> → ${esc(nodeOf(k).name)} gets ${esc(bonusWords(b, lv))}`,
      )}</div>`;
      chips.push(`<span class="pchip can rev e-${b.e}" data-ttxt="${esc(tip)}" role="img" aria-label="${esc(`${nodeOf(k).name}: ${bonusWords(b, lv)}`)}">` +
        `${ico(skillIcon(k.id), 'pc-ico')}<i class="pc-ok" aria-hidden="true">✓</i><b class="pc-amt">${bonusShort(b, lv)}</b></span>`);
    }
  if (!chips.length) return '';
  // simple mode: just the names of the skills you own that it chains with, in words
  const mates = new Set<string>();
  (o.bonus ?? []).forEach((b) => r.skills.forEach((k) => SKILLS[k.id] && matches(b.t, k) && mates.add(nodeOf(k).name)));
  r.skills.forEach((k) => (k.bonus ?? []).some((b) => matches(b.t, { id: o.id })) && mates.add(nodeOf(k).name));
  const simple = mates.size
    ? `<div class="pairs-s info-simp">🔗 ${L('ต่อโซ่กับ', 'Chains with')} <b>${[...mates].map(esc).join(', ')}</b> <i class="pc-ok" aria-hidden="true">✓</i></div>`
    : '';
  return `<div class="pairs info-det"><span class="pairs-h">${L('เข้ากับ:', 'Pairs with:')}</span>${chips.join('')}</div>${simple}`;
}

/** Best list position for a new offer (most active links). null if it links with nothing. */
export function bestSlot(r: RunState, o: Offer): { pos: number; gain: number } | null {
  if (o.v !== '' || r.skills.some((k) => k.id === o.id)) return null;
  const me: SkillInstance = { id: o.id, v: '', bonus: o.bonus ?? [] };
  const base = activeBonuses(r.skills).length;
  let best: { pos: number; gain: number } | null = null;
  for (let pos = r.skills.length; pos >= 0; pos--) {
    const list = [...r.skills.slice(0, pos), me, ...r.skills.slice(pos)];
    const gain = activeBonuses(list).length - base;
    if (gain > 0 && (!best || gain > best.gain)) best = { pos, gain };
  }
  return best;
}

/** Where a new offer lands when bought with the button: the best chain spot, else the end of the list. */
export function defaultSlot(r: RunState, o: Offer) {
  return bestSlot(r, o)?.pos ?? r.skills.length;
}

/** Links the new skill would make sitting at `pos`: label + whether the partner is above or below. */
export function linksAt(r: RunState, o: Offer, pos: number) {
  const me: SkillInstance = { id: o.id, v: '', bonus: o.bonus ?? [] };
  const list = [...r.skills.slice(0, pos), me, ...r.skills.slice(pos)];
  const out: { up: boolean; text: string }[] = [];
  for (const a of activeBonuses(list)) {
    if (a.from === pos)
      for (const j of a.to) out.push({ up: j < pos, text: `${nodeOf(me).name} ${bonusShort(a.b, 1)}` });
    else if (a.to.includes(pos)) out.push({ up: a.from < pos, text: `${nodeOf(list[a.from]).name} ${bonusShort(a.b, lvOf(list[a.from].v))}` });
  }
  return out;
}

/**
 * Ghost row for a new offer at list position `pos`: a 40% copy of the skill row, dashed chain lines to the
 * neighbours it links with, and "+Chain" labels at full strength. mode: hover (where the Buy button puts it),
 * drag (the gap under the cursor), pick (tap-to-place: tapping it confirms).
 */
export function ghostLi(r: RunState, o: Offer, pos: number, mode: 'hover' | 'drag' | 'pick', price = 0) {
  const li = document.createElement('li');
  const links = linksAt(r, o, pos);
  const up = links.some((l) => l.up);
  const down = links.some((l) => !l.up);
  li.className = `put-here mode-${mode}${up ? ' link-up' : ''}${down ? ' link-down' : ''}${links.length ? ' links' : ''}`;
  li.dataset.pos = String(pos);
  li.setAttribute('aria-hidden', mode === 'pick' ? 'false' : 'true');
  const name = esc(SKILLS[o.id].name);
  const tag = links.length
    ? links.map((l) => `<span class="ph-link">${l.up ? '▲' : '▼'} ${L('+โซ่', '+Chain')}: ${esc(l.text)}</span>`).join('')
    : `<span class="ph-link none">${L('ยังไม่ต่อโซ่ตรงนี้', 'No chain here')}</span>`;
  const head =
    mode === 'pick'
      ? L(`แตะเพื่อวาง ${name} ตรงนี้`, `Tap to put ${name} here`)
      : mode === 'drag'
        ? L(`ปล่อยเพื่อซื้อ ${name} ตรงนี้`, `Drop to buy ${name} here`)
        : L(`✨ ซื้อแล้ว ${name} จะลงตรงนี้`, `✨ Buying puts ${name} here`);
  li.innerHTML =
    `<span class="ph-ghost"><img class="ph-ico" src="${skillIcon(o.id)}" alt="" draggable="false"><b class="ph-nm">${name} <small>Lv1</small></b></span>` +
    `<span class="ph-t"><b>${head}</b><span class="ph-links">${tag}</span></span>` +
    (price ? `<span class="ph-price"><i class="coin-ico" aria-hidden="true"></i>${price}</span>` : '');
  return li;
}

/** Put `li` into the list just above row `pos` (or after the last row). */
export function insertAtRow(list: HTMLElement, li: HTMLElement, pos: number) {
  const row = list.querySelector(`.skillrow[data-i="${pos}"]`);
  if (row) {
    // keep it above the connector that belongs to the row before
    list.insertBefore(li, row);
    return;
  }
  const rows = list.querySelectorAll('.skillrow[data-i]');
  const lastRow = rows[rows.length - 1];
  if (lastRow) lastRow.after(li);
  else list.prepend(li);
}

/** Ghost row for shop card i at the spot the Buy button would use (removes the old one). */
export function showPutHere(root: HTMLElement, r: RunState | null, i: number) {
  root.querySelectorAll('.put-here.mode-hover').forEach((el) => el.remove());
  const o = i >= 0 ? r?.shop[i] : null;
  if (!r || !o || o.v !== '' || r.skills.some((k) => k.id === o.id) || r.skills.length >= slotsOf(r)) return;
  const list = root.querySelector<HTMLElement>('.skilllist');
  if (!list || list.querySelector('.put-here.mode-pick, .put-here.mode-drag')) return;
  insertAtRow(list, ghostLi(r, o, defaultSlot(r, o), 'hover'), defaultSlot(r, o));
}

// ---------- 3. drag preview ----------
/** While dragging: rows that would link at the drop spot glow, possible partners shimmer, the drop line shows the bonus. */
export function dragPreview(root: HTMLElement, r: RunState | null, order: number[]) {
  const lifted = root.querySelector<HTMLElement>('.skillrow.lifted');
  const rows = root.querySelectorAll<HTMLElement>('.skillrow[data-i]');
  const clear = () => {
    rows.forEach((row) => row.classList.remove('synergy-preview', 'chain-cand'));
    const line = root.querySelector<HTMLElement>('.drop-line');
    line?.classList.remove('links');
    line?.querySelector('.dl-lbl')?.remove();
  };
  if (!r || !lifted) return clear();
  const dragged = Number(lifted.dataset.i);
  const skills = order.map((i) => r.skills[i]).filter(Boolean);
  const pos = order.indexOf(dragged);
  const act = activeBonuses(skills);
  const near = new Set<number>();
  const gains: string[] = [];
  for (const a of act) {
    if (a.from === pos) {
      a.to.forEach((j) => near.add(order[j]));
      gains.push(bonusShort(a.b, lvOf(skills[a.from].v)));
    } else if (a.to.includes(pos)) {
      near.add(order[a.from]);
      gains.push(bonusShort(a.b, lvOf(skills[a.from].v)));
    }
  }
  // any row that could link with the dragged skill somewhere in the list
  const me = r.skills[dragged];
  const cand = (k: SkillInstance) =>
    (me.bonus ?? []).some((b) => matches(b.t, k)) || (k.bonus ?? []).some((b) => matches(b.t, me));
  rows.forEach((row) => {
    const i = Number(row.dataset.i);
    row.classList.toggle('synergy-preview', near.has(i));
    row.classList.toggle('chain-cand', i !== dragged && !near.has(i) && !!r.skills[i] && cand(r.skills[i]));
  });
  const line = root.querySelector<HTMLElement>('.drop-line');
  if (!line) return;
  line.classList.toggle('links', gains.length > 0);
  let lbl = line.querySelector<HTMLElement>('.dl-lbl');
  if (!gains.length) return lbl?.remove();
  if (!lbl) {
    lbl = document.createElement('span');
    lbl.className = 'dl-lbl';
    line.appendChild(lbl);
  }
  lbl.textContent = `🔗 ${gains.join(' ')}`;
}

// ---------- 6. after each shop render: celebrate new links, fade broken ones ----------
interface LinkInfo {
  gap: number;
  owner: string;
  partner: string;
  b: Bonus;
  lv: number;
}
let prevRun = '';
let prev = new Map<string, LinkInfo>();

function linksOf(skills: SkillInstance[]) {
  const out = new Map<string, LinkInfo>();
  for (const a of activeBonuses(skills))
    for (const j of a.to) {
      const owner = skills[a.from];
      const key = `${owner.id}:${a.bi}:${a.b.e}:${a.b.t}>${skills[j].id}`;
      out.set(key, { gap: Math.min(a.from, j), owner: nodeOf(owner).name, partner: nodeOf(skills[j]).name, b: a.b, lv: lvOf(owner.v) });
    }
  return out;
}

/** Forget the previous shop state (leaving the shop / new run): the next render only records. */
export const resetChains = () => {
  prevRun = '';
  prev = new Map();
};

/** Call after the shop is rendered. Lines the connectors up with the icons, then reacts to links made / broken. */
export function syncChains(root: HTMLElement, r: RunState) {
  layoutGaps(root);
  const now = linksOf(r.skills);
  const first = prevRun !== r.id;
  const before = prev;
  prevRun = r.id;
  prev = now;
  if (first) return;
  const made = [...now].filter(([k]) => !before.has(k)).map(([, v]) => v);
  const lost = [...before].filter(([k]) => !now.has(k)).map(([, v]) => v);
  for (const l of lost) {
    const gap = root.querySelector<HTMLElement>(`.cgap[data-gap="${l.gap}"]`);
    if (!gap || gap.classList.contains('on') || gap.querySelector('.cg-fade')) continue;
    const f = document.createElement('span');
    f.className = 'cg-fade';
    gap.appendChild(f);
    setTimeout(() => f.remove(), 1200);
  }
  if (!made.length) return;
  for (const l of made) burst(root.querySelector<HTMLElement>(`.cgap[data-gap="${l.gap}"]`));
  linkChime(made.length);
  const m = made[0];
  const more = made.length > 1 ? L(` (และอีก ${made.length - 1})`, ` (+${made.length - 1} more)`) : '';
  chainToast(`🔗 ${m.owner} + ${m.partner}: ${bonusWords(m.b, m.lv)}${more}`);
}

/** Stretch each connector from the upper row's icon to the lower row's icon (rows can wrap on phones). */
export function layoutGaps(root: HTMLElement) {
  const list = root.querySelector<HTMLElement>('.skilllist');
  if (!list) return;
  const lr = list.getBoundingClientRect();
  list.querySelectorAll<HTMLElement>('.cgap').forEach((gap) => {
    const i = Number(gap.dataset.gap);
    const rowA = list.querySelector(`.skillrow[data-i="${i}"]`);
    const rowB = list.querySelector(`.skillrow[data-i="${i + 1}"]`);
    const a = rowA?.querySelector('.skill-icon')?.getBoundingClientRect();
    const b = rowB?.querySelector('.skill-icon')?.getBoundingClientRect();
    const ra = rowA?.getBoundingClientRect();
    const rb = rowB?.getBoundingClientRect();
    const g = gap.getBoundingClientRect();
    if (!a || !b || !ra || !rb || !a.width) return;
    // icon-to-icon when the icons sit in the middle of their rows (one-line rows); on wrapped phone rows the icon is
    // at the top, so the line would cross the text: then it only bridges the gap between the two rows
    const centred = (ic: DOMRect, r: DOMRect) => Math.abs(ic.top + ic.height / 2 - (r.top + r.height / 2)) < r.height * 0.2;
    const up = centred(a, ra) ? g.top - a.bottom + 2 : g.top - ra.bottom + 10;
    const down = centred(b, rb) ? b.top - g.bottom + 2 : rb.top - g.bottom + 10;
    gap.style.setProperty('--cx', `${a.left + a.width / 2 - lr.left}px`);
    gap.style.setProperty('--up', `${Math.max(0, up)}px`);
    gap.style.setProperty('--down', `${Math.max(0, down)}px`);
  });
}

function burst(gap: HTMLElement | null) {
  if (!gap) return;
  gap.classList.remove('fresh');
  void gap.offsetWidth;
  gap.classList.add('fresh');
  setTimeout(() => gap.classList.remove('fresh'), 1400);
  if (reduced()) return;
  const n = 12;
  for (let k = 0; k < n; k++) {
    const s = document.createElement('i');
    s.className = 'cg-spark';
    const ang = (k / n) * Math.PI * 2 + Math.random() * 0.4;
    const d = 22 + Math.random() * 26;
    s.style.setProperty('--dx', `${Math.cos(ang) * d}px`);
    s.style.setProperty('--dy', `${Math.sin(ang) * d * 0.8}px`);
    s.style.animationDelay = `${Math.random() * 90}ms`;
    s.textContent = k % 3 ? '✦' : '★';
    gap.appendChild(s);
    setTimeout(() => s.remove(), 1000);
  }
}

let toastTimer = 0;
/** Floating toast for a new chain (no layout shift, ignores the pointer). */
export function chainToast(text: string) {
  let el = document.getElementById('chain-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'chain-toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el!.classList.remove('show'), 2600);
}

let resizeBound = false;
/** keep connectors lined up when the window size changes */
export function bindChainResize(root: HTMLElement) {
  if (resizeBound) return;
  resizeBound = true;
  let raf = 0;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => layoutGaps(root));
  });
}
