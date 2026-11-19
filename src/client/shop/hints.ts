/**
 * Shop card → skill list hints: while you hover (mouse) or press (touch) a shop card, the rows of your list that
 * would switch on a connect bonus if the new skill sat next to them light up, with a short label saying which.
 * Works on the rendered DOM (rows carry data-i), so nothing re-renders.
 */
import { matches } from '../../sim/links';
import { SKILLS, nodeOf } from '../../sim/skills';
import type { Offer, RunState } from '../../sim/run';
import { upgradeOf } from '../../sim/run';
import type { Bonus } from '../../sim/types';

const ICON: Record<Bonus['e'], string> = { dmg: '⚔', shield: '⛨', haste: '»', power: '▲', trigger: '⚡' };

/** row index → labels for offer o */
export function hintsFor(r: RunState, o: Offer): Map<number, string[]> {
  const out = new Map<number, string[]>();
  const add = (i: number, s: string) => out.set(i, [...(out.get(i) ?? []), s]);
  const up = upgradeOf(r, o);
  if (o.v !== '') {
    if (up) add(r.skills.indexOf(up), '⬆ การ์ดนี้อัปเกรดตัวนี้ (ช่องเดิม โบนัสเดิม)');
    return out;
  }
  const name = SKILLS[o.id].name;
  r.skills.forEach((k, i) => {
    // the offer's own bonuses that this row satisfies
    for (const b of o.bonus ?? []) if (matches(b.t, k)) add(i, `วาง ${name} ติดตัวนี้ → 🔗${ICON[b.e]} ของ ${name} ติด`);
    // this row's bonuses that the new skill would satisfy
    for (const b of k.bonus ?? []) if (matches(b.t, { id: o.id })) add(i, `วาง ${name} ติดตัวนี้ → 🔗${ICON[b.e]} ของ ${nodeOf(k).name} ติด`);
  });
  return out;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

let shown = -1;

/** Light up the rows for shop card i (or clear with i = -1). */
export function showHints(root: HTMLElement, r: RunState | null, i: number) {
  if (i === shown) return;
  shown = i;
  root.querySelectorAll('.skillrow.hl').forEach((el) => el.classList.remove('hl'));
  root.querySelectorAll('.sk-hint').forEach((el) => el.remove());
  root.querySelectorAll('.card.offer.hinting').forEach((el) => el.classList.remove('hinting'));
  const o = i >= 0 ? r?.shop[i] : null;
  if (!r || !o) return;
  root.querySelector(`.card.offer[data-tip="s:${i}"]`)?.classList.add('hinting');
  for (const [idx, labels] of hintsFor(r, o)) {
    const row = root.querySelector<HTMLElement>(`.skillrow[data-i="${idx}"]`);
    if (!row) continue;
    row.classList.add('hl');
    const tag = document.createElement('div');
    tag.className = 'sk-hint';
    tag.innerHTML = labels.map(esc).join('<br>');
    row.querySelector('.sk-text')?.appendChild(tag);
  }
}
export const resetHints = () => {
  shown = -1;
};
