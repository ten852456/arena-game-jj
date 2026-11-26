/**
 * Simple / detailed skill info.
 * Every skill is rendered both ways (simple sentence + full chips); a body class picks which one shows:
 * `body.info-detail` = detailed (the saved setting, or Alt held down on desktop). So switching never re-renders.
 * - Simple (default): fewer things on screen. Each skill is a row of icon + word pills, only chains you can make,
 *   and whole layers stay hidden: hero rules, shop how-to notes, the firing timeline, rarity / mastery tags, the
 *   fight log and glossary, and the result's stats (behind one button). Playtests (5 personas, Nov 2026) showed that
 *   swapping icons for sentences alone did not feel simpler: what overwhelmed people was the number of things.
 * - Detailed: all chips, exact numbers, plus the internals (ticks, formulas, bonus math) in tooltips.
 * The toggle lives in the header (ⓘ) and in the 🎚 settings panel; the choice is saved in localStorage.
 */
import { L } from '../i18n';
import { HASTE_BONUS } from '../sim/links';
import { MARK_INFO } from '../sim/run';
import { lvOf, nodeOf } from '../sim/skills';
import type { Bonus, SkillInstance } from '../sim/types';
import { onLang } from './lang';
import { targetIcon, targetWords } from './shop/chains';
import { detailBonus, detailLines, simpleBonus, simpleParts, simpleText } from './skillText';
import './infomode.css';
import { esc } from './html';

type K = Pick<SkillInstance, 'id' | 'v' | 'mark'>;

const KEY = 'mochi.infoDetail';
const HINT_KEY = 'mochi.altHint';

const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* private mode */
  }
};

let detail = read(KEY) === '1';
let alt = false;
const listeners: (() => void)[] = [];

/** the saved setting (Alt does not change it) */
export const isDetail = () => detail;
/** what is on screen right now */
export const showingDetail = () => detail || alt;

function apply() {
  if (typeof document === 'undefined') return;
  document.body.classList.toggle('info-detail', showingDetail());
  document.body.classList.toggle('info-alt', alt && !detail);
}

// before the first render, so the page never flashes the other mode
if (typeof document !== 'undefined' && document.body) apply();

export function setDetail(on: boolean) {
  detail = on;
  write(KEY, on ? '1' : '0');
  apply();
  listeners.forEach((fn) => fn());
}
/** run fn after the saved setting changes (paint toggles) */
export const onInfoMode = (fn: () => void) => listeners.push(fn);

const finePointer = () => typeof matchMedia === 'function' && matchMedia('(hover: hover) and (pointer: fine)').matches;

// ---------------- HTML pieces for ui.ts ----------------

/** The plain description (simple mode, next to the hidden chips): one pill per effect, an icon and a few words,
 *  so icon readers and word readers both get it at a glance. The cooldown pill comes last. */
export const simpleSkillHTML = (k: K, haste = 0) =>
  `<span class="sk-simple info-simp" aria-label="${esc(simpleText(k, haste))}">${simpleParts(k, haste)
    .map(([ico, t]) => `<span class="sp${ico === '⏱' ? ' sp-cd' : ''}"><i aria-hidden="true">${ico}</i>${esc(t)}</span>`)
    .join('')}</span>`;

/** a connect bonus as words: [partner icon] ต่อ chain: +2 ดาเมจ */
export function simpleBonusChip(b: Bonus, lv: number, st: 'on' | 'can' | 'off', tip: string) {
  const words = simpleBonus(b, lv);
  return `<span class="pchip sbonus ${st} e-${b.e}" data-ttxt="${esc(tip)}" role="img" aria-label="${esc(`${targetWords(b.t)}: ${words}`)}">` +
    `<img class="pc-ico" src="${targetIcon(b.t)}" alt="" draggable="false">${st !== 'off' ? '<i class="pc-ok" aria-hidden="true">✓</i>' : ''}<b class="pc-amt">${esc(words)}</b></span>`;
}

/** both rows of connect-bonus chips: the detailed pictures and the simple words */
export function bonusRows(detailChips: string[], bonus: Bonus[], lv: number, states: ('on' | 'can' | 'off')[], tips: string[]) {
  return `<span class="bonus-row info-det">${detailChips.join('')}</span>` +
    // simple: only the bonuses a skill you own can switch on (the rest is noise until you buy their partner)
    `<span class="bonus-row info-simp">${bonus.map((b, bi) => (states[bi] === 'off' ? '' : simpleBonusChip(b, lv, states[bi], tips[bi]))).join('')}</span>`;
}

/** cooldown cut from the active haste bonuses */
const hasteOf = (k: Pick<SkillInstance, 'bonus'>, on: Set<number> | null) =>
  (k.bonus ?? []).filter((b, bi) => b.e === 'haste' && on?.has(bi)).length * HASTE_BONUS;

/** Tooltip part for simple mode: the plain line, chain words, mark meaning, Alt hint. */
export function simpleTipHTML(k: K & Pick<SkillInstance, 'bonus'>, on: Set<number> | null) {
  const lv = lvOf(k.v);
  const bonus = (k.bonus ?? [])
    .map((b, bi) => `<li class="${on?.has(bi) ? 'on' : ''}"><img class="tt-ico" src="${targetIcon(b.t)}" alt=""> ${esc(targetWords(b.t))} → ${esc(simpleBonus(b, lv))}${on?.has(bi) ? ' <b class="ok">✓</b>' : ''}</li>`)
    .join('');
  return `<div class="info-simp">
    <p class="tt-simple">${esc(simpleText(k, hasteOf(k, on)))}</p>
    ${bonus ? `<div class="muted small">${L('วางติดกัน (ช่องบนหรือล่าง):', 'Next to (above or below):')}</div><ul class="kwlist bonus">${bonus}</ul>` : ''}
    ${k.mark ? `<div class="muted small">✦ ${MARK_INFO[k.mark].name}: ${MARK_INFO[k.mark].desc}</div>` : ''}
    ${finePointer() ? `<div class="tt-alt">${L('กด Alt ค้าง = ดูละเอียด', 'Hold Alt = detailed info')}</div>` : ''}
  </div>`;
}

/** Tooltip part for detailed mode: exact numbers and formulas. */
export function detailTipHTML(k: K & Pick<SkillInstance, 'bonus'>, on: Set<number> | null) {
  const lv = lvOf(k.v);
  const lines = detailLines(k, hasteOf(k, on)).map((x) => `<li>${esc(x)}</li>`);
  for (const b of k.bonus ?? []) lines.push(`<li>🔗 ${esc(targetWords(b.t))}: ${esc(detailBonus(b, lv))}</li>`);
  return `<div class="info-det"><div class="muted small">${L('ตัวเลขละเอียด', 'Exact numbers')}</div><ul class="kwlist det-math">${lines.join('')}</ul></div>`;
}

/** Upgrade tooltip header for simple mode: old line → new line. */
export function simpleDeltaHTML(owned: K, v: string) {
  const next = { ...owned, v };
  return `<div class="tt-delta info-simp"><div class="td-h">▲ ${esc(nodeOf(owned).name)} Lv${lvOf(owned.v)} → <b>${esc(nodeOf(next).name)} Lv${lvOf(v)}</b></div>
    <div class="d-old small">${esc(simpleText(owned))}</div><div class="d-new">→ ${esc(simpleText(next))}</div></div>`;
}

// ---------------- toggles ----------------

/** checkbox row for the 🎚 settings panel */
export const settingsRowHTML = () =>
  `<div class="info-set"><div class="info-set-h">${L('คำอธิบาย skill', 'Skill info')}</div>
    <label class="vol-mute"><input type="checkbox" data-info ${detail ? 'checked' : ''}> ${L('คำอธิบายแบบละเอียด', 'Detailed info')}</label>
    <div class="info-set-note">${L('แบบง่าย: เห็นแค่ที่ต้องใช้เลือก ซ่อนกฎยาว ไทม์ไลน์ บันทึกการสู้ และสถิติ · แบบละเอียด: เห็นทุกอย่าง ตัวเลข สูตร และโซ่ทุกเส้น', 'Simple: only what you need to choose; long rules, the timeline, the fight log and stats stay hidden · Detailed: everything, every number, formula and chain')}${finePointer() ? L(' · กด Alt ค้างเพื่อดูชั่วคราว', ' · hold Alt to peek') : ''}</div></div>`;

/** ⓘ button in the header: simple ↔ detailed */
function mountHeaderToggle() {
  const header = document.querySelector('header');
  if (!header || header.querySelector('.info-btn')) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'info-btn small ghost';
  btn.dataset.sfx = 'none';
  const paint = () => {
    btn.innerHTML = `<span aria-hidden="true">ⓘ</span><span class="ib-l">${detail ? L('ละเอียด', 'Detailed') : L('ง่าย', 'Simple')}</span>`;
    btn.classList.toggle('on', detail);
    btn.setAttribute('aria-pressed', String(detail));
    const label = L('คำอธิบายแบบละเอียด', 'Detailed info');
    btn.setAttribute('aria-label', label);
    btn.title = `${label}${finePointer() ? L(' (กด Alt ค้างเพื่อดูชั่วคราว)', ' (hold Alt to peek)') : ''}`;
  };
  btn.addEventListener('click', () => setDetail(!detail));
  onInfoMode(paint);
  onLang(paint);
  paint();
  const lang = header.querySelector('.lang');
  if (lang) lang.before(btn);
  else header.appendChild(btn);
}

/** "Alt = ละเอียด" pill, once per device, the first time the pointer rests on a skill (desktop only) */
function altHintOnce() {
  if (!finePointer() || read(HINT_KEY)) return;
  const onOver = (ev: Event) => {
    if (!(ev.target as Element).closest?.('.sk-simple, [data-tip]')) return;
    document.removeEventListener('pointerover', onOver);
    write(HINT_KEY, '1');
    const pill = document.createElement('div');
    pill.className = 'alt-hint';
    pill.setAttribute('role', 'status');
    pill.innerHTML = `<kbd>Alt</kbd> = ${L('ละเอียด', 'detailed')}`;
    document.body.appendChild(pill);
    setTimeout(() => pill.classList.add('out'), 6000);
    setTimeout(() => pill.remove(), 6600);
  };
  document.addEventListener('pointerover', onOver);
}

export function initInfoMode() {
  apply();
  const setAlt = (on: boolean) => {
    if (alt === on) return;
    alt = on;
    apply();
  };
  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'Alt') {
      ev.preventDefault(); // no browser menu bar
      setAlt(true);
    }
  });
  window.addEventListener('keyup', (ev) => {
    if (ev.key === 'Alt') {
      ev.preventDefault();
      setAlt(false);
    }
  });
  window.addEventListener('blur', () => setAlt(false));
  // a missed keyup (Alt+Tab and back): the next pointer move fixes it
  window.addEventListener('pointermove', (ev) => {
    if (ev.pointerType === 'mouse' && ev.altKey !== alt) setAlt(ev.altKey);
  });
  mountHeaderToggle();
  altHintOnce();
}
