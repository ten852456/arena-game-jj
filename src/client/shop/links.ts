/**
 * Connect-bonus text for the grid shop (GC1): link chips (what each bonus needs, readable without hover) and the
 * active-bonus panel (every bonus that is on, the block it comes from, the blocks switching it on, ⚡ chains, engines).
 */
import { L } from '../../i18n';
import { HASTE_BONUS, POWER_BONUS, activeBonuses, bonusValue, matches, neighbours, type ActiveBonus } from '../../sim/grid';
import { lvOf, nodeOf } from '../../sim/skills';
import type { Bonus, SkillInstance } from '../../sim/types';
import { BONUS_ICON, bonusText, targetName } from '../gridView';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Short effect, e.g. "+2 dmg per hit". */
export function effectShort(b: Bonus, lv: number) {
  const v = bonusValue(b.e, lv);
  switch (b.e) {
    case 'dmg':
      return L(`ดาเมจ +${v}/ครั้ง`, `+${v} dmg per hit`);
    case 'shield':
      return L(`โล่ +${v} ทุกครั้งที่ใช้`, `+${v} shield per use`);
    case 'haste':
      return L(`คูลดาวน์ −${Math.round(HASTE_BONUS * 100)}%`, `cooldown −${Math.round(HASTE_BONUS * 100)}%`);
    case 'power':
      return L(`แรงขึ้น ${Math.round(POWER_BONUS * 100)}%`, `${Math.round(POWER_BONUS * 100)}% stronger`);
    case 'trigger':
      return L('⚡ สั่งตัวที่ติดให้ทำงานตาม', '⚡ fires the touching block too');
  }
}

export type ChipState = 'on' | 'can' | 'off';

/**
 * One chip per connect bonus: 🔗 icon + what it must touch. state(bi): on = active, can = you own a block that
 * could switch it on, off = not yet. Tapping / hovering a chip explains it (data-ttxt).
 */
export function linkChips(bonus: Bonus[], lv: number, state: (bi: number) => ChipState) {
  if (!bonus.length) return '';
  return `<span class="gs-links">${bonus
    .map((b, bi) => {
      const st = state(bi);
      const note =
        st === 'on'
          ? `<div class="ok">✓ ${L('ทำงานอยู่', 'Active')}</div>`
          : st === 'can'
            ? `<div class="muted small">${L('คุณมีบล็อกที่เปิดโบนัสนี้ได้ วางให้ติดกัน', 'You own a block that switches this on: make them touch')}</div>`
            : `<div class="muted small">${L('ยังไม่ทำงาน: วางให้ติดกับบล็อกที่ตรงเงื่อนไข (ด้านไหนก็ได้)', 'Not active yet: make it touch a matching block (any side)')}</div>`;
      const tip = `<div class="tt-h"><b>🔗 ${L('โบนัสติดกัน', 'Connect bonus')}</b></div><div class="desc">${bonusText(b, lv)}</div>${note}`;
      return `<span class="gs-link ${st} lk-${b.e}" data-ttxt="${esc(tip)}">${BONUS_ICON[b.e]} ${esc(targetName(b.t))}</span>`;
    })
    .join('')}</span>`;
}

/** Chip states for an owned block: on if active, can if some other owned block matches. */
export function ownedStates(skills: SkillInstance[], i: number, act: ActiveBonus[]) {
  return (bi: number): ChipState =>
    act.some((a) => a.from === i && a.bi === bi) ? 'on' : skills.some((k, j) => j !== i && matches(skills[i].bonus[bi].t, k)) ? 'can' : 'off';
}

/** Longest ⚡ chains (trigger bonuses + engines) as name lists, longest first, at most 4. */
function chainsOf(skills: SkillInstance[], w: number, h: number, act: ActiveBonus[]) {
  const next = new Map<number, Set<number>>();
  const add = (a: number, b: number) => next.set(a, (next.get(a) ?? new Set()).add(b));
  for (const a of act) if (a.b.e === 'trigger') a.to.forEach((j) => add(a.from, j));
  const nb = neighbours(skills, w, h);
  skills.forEach((k, i) => {
    if (k.x >= 0 && nodeOf(k).engine) nb[i].forEach((j) => add(i, j));
  });
  const hasIn = new Set([...next.values()].flatMap((s) => [...s]));
  const paths: number[][] = [];
  const walk = (path: number[]) => {
    const last = path[path.length - 1];
    const outs = [...(next.get(last) ?? [])].filter((j) => !path.includes(j));
    if (!outs.length) {
      if (path.length > 1) paths.push(path);
      return;
    }
    outs.forEach((j) => walk([...path, j]));
  };
  // start from blocks nothing fires (or every source, if all are in a loop)
  const starts = [...next.keys()].filter((i) => !hasIn.has(i));
  (starts.length ? starts : [...next.keys()]).forEach((i) => walk([i]));
  paths.sort((a, b) => b.length - a.length);
  // drop chains contained in a longer one
  const keep: number[][] = [];
  for (const p of paths) if (!keep.some((q) => p.every((x) => q.includes(x)))) keep.push(p);
  return keep.slice(0, 4);
}

/** Panel: every active connect bonus with its source block and the blocks switching it on, then chains. */
export function bonusPanelHTML(skills: SkillInstance[], w: number, h: number) {
  const act = activeBonuses(skills, w, h);
  const total = skills.reduce((n, k) => n + (k.x >= 0 ? k.bonus.length : 0), 0);
  const nm = (i: number) => esc(nodeOf(skills[i]).name);
  const items = act
    .map((a) => {
      const k = skills[a.from];
      const lv = lvOf(k.v);
      const by = a.to.map((j) => `<b>${nm(j)}</b>`).join(L(' และ ', ' and '));
      return `<li class="bp-item bp-${a.b.e}" data-a="pick" data-i="${a.from}" role="button" tabindex="0">
        <span class="bp-icon" aria-hidden="true">${BONUS_ICON[a.b.e]}</span>
        <span class="bp-text"><b>${nm(a.from)}</b> <small>Lv${lv}</small>: ${effectShort(a.b, lv)}<br><small class="muted">${L('เปิดโดย', 'switched on by')} ${by}</small></span>
      </li>`;
    })
    .join('');
  const chains = chainsOf(skills, w, h, act)
    .map((p) => `<li>${p.map((i) => `<b>${nm(i)}</b>`).join(' <span class="bp-arrow">⚡→</span> ')}</li>`)
    .join('');
  const off = total - act.length;
  return `<div class="bp-h">🔗 ${L('โบนัสติดกันที่ทำงาน', 'Active connect bonuses')} <span class="bp-count">${act.length}/${total}</span></div>
    ${
      act.length
        ? `<ul class="bp-list">${items}</ul>`
        : `<p class="muted small">${L('ยังไม่มีโบนัสทำงาน · ดูชิป 🔗 ใต้บล็อก แล้ววางให้ติดกับบล็อกที่ชิปบอก · เลือกบล็อกแล้วช่องสีทองคือที่ที่ดีที่สุด', 'No bonus is on yet · read the 🔗 chips under each block and make it touch what they name · select a block: gold cells are the best spots')}</p>`
    }
    ${chains ? `<div class="bp-sub">⚡ ${L('เชนและเครื่องยนต์', 'Chains and engines')}</div><ul class="bp-chains">${chains}</ul>` : ''}
    ${act.length && off > 0 ? `<p class="muted small">${L(`อีก ${off} โบนัสยังไม่ทำงาน`, `${off} more bonuses are not on yet`)}</p>` : ''}`;
}
