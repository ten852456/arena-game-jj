// Build encoding shared by the parity generators (gen.mts, run-gen.mts, search.mts) and the Rust tests.
import { SKILL_LIST, VARIANTS } from '../../../src/sim/skills';
import { HEROES } from '../../../src/sim/heroes';
import { LINES, type Build } from '../../../src/sim/types';
import { BONUS_KINDS, MAX_BONUS } from '../../../src/sim/links';
import { MARKS } from '../../../src/sim/run';
import { RELICS, MAX_RELICS } from '../../../src/sim/relics';

const SLOTS = 8;
/** build encoding (sim v22): hero, n, relic count, MAX_RELICS relic indices (255 = none), then per slot
 * id, variant, mark (0 = none), star, bonus count, MAX_BONUS × (target, kind). Target = skill index, or 200 + line index. */
export const enc = (b: Build): number[] => {
  const rs = (b.relics ?? []).map((r) => RELICS.findIndex((x) => x.id === r));
  const out = [HEROES.findIndex((h) => h.id === b.hero), b.skills.length, rs.length, ...Array.from({ length: MAX_RELICS }, (_, i) => rs[i] ?? 255)];
  for (let i = 0; i < SLOTS; i++) {
    const k = b.skills[i];
    if (!k) { out.push(...Array(5 + 2 * MAX_BONUS).fill(0)); continue; }
    const bonus = k.bonus ?? [];
    out.push(SKILL_LIST.findIndex((d) => d.id === k.id), VARIANTS.indexOf(k.v as never), k.mark ? MARKS.indexOf(k.mark) + 1 : 0, k.star ?? 0, bonus.length);
    for (let j = 0; j < MAX_BONUS; j++) {
      const bo = bonus[j];
      if (!bo) { out.push(0, 0); continue; }
      const t = bo.t.startsWith('line:') ? 200 + LINES.indexOf(bo.t.slice(5) as never) : SKILL_LIST.findIndex((d) => d.id === bo.t);
      out.push(t, BONUS_KINDS.indexOf(bo.e));
    }
  }
  return out;
};
