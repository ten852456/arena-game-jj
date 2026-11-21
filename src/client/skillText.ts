/**
 * Two levels of skill explanation, generated from the skill data (sim/skills.ts) so every skill, Lv2/Lv3 branch,
 * mark and connect bonus is always described correctly:
 * - simpleText: one plain line a new player reads at a glance ("ตี 6 · 3 ที · ทุก 4 วิ" / "Hits 6 ×3 · every 4s")
 * - detailLines: the exact internals a competitive player wants (cooldown in ticks, damage formula, multipliers…)
 * Pure text in the current language (L from i18n.ts): no DOM, so scripts/skilltext-check.ts can test every skill.
 */
import { L } from '../i18n';
import { cdTicks, CLEANSE_MAX, CTL_MIN_T, CTL_SHARE, SHAKE_OFF, THORNS_MAX, TRIGGER_GAP, TRIGGER_GAP_MAX } from '../sim/combat';
import { HASTE_BONUS, POWER_BONUS, bonusValue } from '../sim/links';
import { LINE_NAME, SKILLS, nodeOf, type Effect, type SkillNode } from '../sim/skills';
import { T } from '../sim/tuning';
import type { Bonus, Line, SkillInstance } from '../sim/types';

type K = Pick<SkillInstance, 'id' | 'v' | 'mark'>;
type Hit = Extract<Effect, { k: 'hit' }>;

/** 1.5 → "1.5", 6 → "6" */
const num = (x: number) => String(+x.toFixed(2));
const pct = (x: number) => `${Math.round(x * 100)}%`;
/** seconds in the plain line: one decimal (0.55 → 0.6) */
const s1 = (x: number) => String(+x.toFixed(1));
/** cooldown ticks → seconds with one decimal, no trailing ".0" */
export const cdSecs = (ticks: number) => String(+(ticks / 10).toFixed(1));

// ---------------- simple ----------------

function simpleHit(e: Hit): string {
  const add: string[] = [];
  if (e.shieldPct) add.push(L('แรงจากโล่', 'shield'));
  if (e.thornsX) add.push(L('แรงจากหนาม', 'thorns'));
  if (e.burnPct) add.push(L('ระเบิดไฟ', 'burn left'));
  if (e.poisonPct) add.push(L('ระเบิดพิษ', 'poison left'));
  if (e.perBurn) add.push(L(`${e.perBurn} ต่อกองไฟ`, `${e.perBurn} per burn`));
  if (e.perDodge) add.push(L(`${e.perDodge} ต่อแต้มหลบ`, `${e.perDodge} per dodge`));
  if (e.perRemoved) add.push(L(`${e.perRemoved} ต่อของที่ลบได้`, `${e.perRemoved} per removed`));
  let s: string;
  if (e.n > 0) s = L(`ตี ${e.n}`, `Hits ${e.n}`) + add.map((a) => ` + ${a}`).join('');
  else s = L(`ตีด้วย${add.join(' + ')}`, `Hits = ${add.join(' + ')}`);
  if (e.times && e.times > 1) s += L(` · ${e.times} ที`, ` ×${e.times}`);
  if (e.ifSlowed) s = L(`ถ้าศัตรูช้า: ${s}`, `If slowed: ${s.replace(/^Hits/, 'hits')}`);
  const tail: string[] = [];
  if (e.pierce) tail.push(e.pierce >= 1 ? L('ทะลุโล่', 'ignores shield') : L(`ทะลุโล่ ${pct(e.pierce)}`, `${pct(e.pierce)} pierce`));
  if (e.exec) tail.push(L('แรงขึ้นเมื่อศัตรูเลือดต่ำ', 'stronger vs low HP'));
  if (e.frozen) tail.push(L('แรงขึ้นเมื่อศัตรูแข็ง', 'stronger vs frozen'));
  if (e.noShield) tail.push(L('แรงขึ้นถ้าศัตรูไม่มีโล่', 'stronger vs no shield'));
  if (e.leech) tail.push(L('ดูดเลือด', 'drains HP'));
  if (e.burn) tail.push(L(`ติดไฟ ${s1(e.burn[1])} วิ`, `burns ${s1(e.burn[1])}s`));
  if (e.poison) tail.push(L(`ติดพิษ ${s1(e.poison[1])} วิ`, `poisons ${s1(e.poison[1])}s`));
  if (e.sure) tail.push(L('หลบไม่ได้', "can't be dodged"));
  return [s, ...tail].join(' · ');
}

function simpleEffect(e: Effect): string {
  switch (e.k) {
    case 'hit': return simpleHit(e);
    case 'shield': return L(`ได้โล่ ${e.n}`, `Shield ${e.n}`);
    case 'heal': return L(`ฟื้น ${e.n}`, `Heal ${e.n}`);
    case 'burn':
      return L(`ติดไฟ ${num(e.dps)}/วิ ${s1(e.secs)} วิ`, `Burns ${num(e.dps)}/s for ${s1(e.secs)}s`) +
        (e.stacks && e.stacks > 1 ? ` ×${e.stacks}` : '') + (e.growthHalf ? L(' (แรงขึ้นตามพลัง)', ' (+power)') : '');
    case 'poison':
      return L(`ติดพิษ ${num(e.dps)}/วิ ${s1(e.secs)} วิ`, `Poisons ${num(e.dps)}/s for ${s1(e.secs)}s`) + (e.stacks && e.stacks > 1 ? ` ×${e.stacks}` : '');
    case 'dodge': return L(`หลบ +${e.n}`, `Dodge +${e.n}`);
    case 'haste': return L(`ตัวเองเร็วขึ้น ${pct(e.pct)} ${s1(e.secs)} วิ`, `Haste ${pct(e.pct)} ${s1(e.secs)}s`);
    case 'wound': return L(`ศัตรูฟื้นน้อยลง ${pct(e.pct)}`, `Enemy heals ${pct(e.pct)} less`);
    case 'freeze': return L(`แช่แข็ง ${s1(e.secs)} วิ`, `Freezes ${s1(e.secs)}s`);
    case 'slow': return L(`ช้าลง ${pct(e.pct)} ${s1(e.secs)} วิ`, `Slows ${pct(e.pct)} ${s1(e.secs)}s`);
    case 'delay': return L(`ถ่วงศัตรู ${s1(e.secs)} วิ`, `Delays the enemy ${s1(e.secs)}s`);
    case 'grow': return L(`ทุกการตี +${e.n} ถาวร`, `All hits +${e.n} for good`);
    case 'charge':
      return e.hits && e.hits > 1
        ? L(`${e.hits} การตีแรงถัดไป ×${e.mult}`, `Next ${e.hits} big hits ×${e.mult}`)
        : L(`การตีแรงถัดไป ×${e.mult}`, `Next big hit ×${e.mult}`);
    case 'thorns':
      return L(`สะท้อนดาเมจ ${e.n}`, `Reflects ${e.n}`) + (e.perm ? L(' ถาวร', ' for good') : '') +
        (e.heal !== undefined ? L(' · ศัตรูฟื้นน้อยลง', ' · cuts enemy healing') : '');
    case 'steadfast':
      return (e.keep !== undefined && e.keep < 0.4 ? L('ต้านการคุมมาก', 'Strongly resists control') : L('ต้านการคุม', 'Resists control')) +
        (e.ignoreFreeze ? L(' · กันแช่แข็ง 1 ครั้ง', ' · blocks 1 freeze') : '');
    case 'cleanse':
      if (e.dot) return e.n >= 99 ? L(`พัดไฟ/พิษทิ้ง ${CLEANSE_MAX} กอง`, `Blows away ${CLEANSE_MAX} burn/poison`) : (e.lineAll ? L(`ล้างไฟ/พิษ ${e.n}–${CLEANSE_MAX}`, `−${e.n}–${CLEANSE_MAX} burn/poison`) : L(`ล้างไฟ/พิษ ${e.n} กอง`, `−${e.n} burn/poison`));
      return e.n >= 99 ? L('ล้างดีบัฟทั้งหมด', 'Cleanses all debuffs') : e.n > 1 ? L(`ล้างดีบัฟ ×${e.n}`, `Cleanses debuffs ×${e.n}`) : L('ล้างดีบัฟ', 'Cleanses a debuff');
    case 'dispel':
      return (e.n >= 99 ? L('ลบบัฟศัตรูทั้งหมด', 'Removes all enemy buffs') : e.n > 1 ? L(`ลบบัฟศัตรู ×${e.n}`, `Removes enemy buffs ×${e.n}`) : L('ลบบัฟศัตรู', 'Removes an enemy buff')) +
        (e.shield !== undefined ? L(' · ทลายโล่', ' · breaks shield') : '') + (e.steal ? L(' · ขโมยพลัง', ' · steals power') : '');
    case 'leech': return L(`การตีถัดไปดูดเลือด ${pct(e.pct)}`, `Next hit drains ${pct(e.pct)}`);
  }
}

function simpleEngine(n: SkillNode): string {
  const en = n.engine;
  if (!en) return '';
  if (en.kind === 'gear')
    return en.n && en.n > 1
      ? L(`สั่ง skill บน+ล่างทำงาน (แรง ${pct(en.power)})`, `Fires above + below (${pct(en.power)})`)
      : L(`สั่ง skill ข้างๆ ทำงาน (แรง ${pct(en.power)})`, `Fires a neighbour (${pct(en.power)})`);
  return L(`สั่ง skill บน+ล่างทำงาน (แรง ${pct(en.power)})`, `Fires above + below (${pct(en.power)})`) + (en.keep ? L(' · ไม่รีเซ็ต', ' · no reset') : '');
}

/** One plain line for a skill: its effects, then how often (marks are explained in the tooltip). haste = connect-bonus cooldown cut. */
export function simpleText(k: K, haste = 0): string {
  const n = nodeOf(k);
  const parts = [simpleEngine(n), ...n.fx.map(simpleEffect)].filter(Boolean);
  parts.push(L(`ทุก ${cdSecs(cdTicks(k, haste))} วิ`, `every ${cdSecs(cdTicks(k, haste))}s`));
  return parts.join(' · ');
}

/** A connect bonus in a few words: "ต่อ chain: +2 ดาเมจ" / "Chain: +2 damage". */
export function simpleBonus(b: Bonus, lv: number): string {
  const v = bonusValue(b.e, lv);
  const what = {
    dmg: L(`+${v} ดาเมจ`, `+${v} damage`),
    shield: L(`+${v} โล่`, `+${v} shield`),
    haste: L(`ไวขึ้น ${pct(HASTE_BONUS)}`, `${pct(HASTE_BONUS)} faster`),
    power: L(`แรงขึ้น ${pct(POWER_BONUS)}`, `${pct(POWER_BONUS)} stronger`),
    trigger: L('ทำงานพร้อมกัน', 'fires together'),
  }[b.e];
  // name the neighbour that switches it on (the skill right above or below in the list)
  const t = b.t.startsWith('line:') ? L(`skill สาย${LINE_NAME[b.t.slice(5) as Line]}`, `a ${LINE_NAME[b.t.slice(5) as Line]} skill`) : (SKILLS[b.t]?.name ?? b.t);
  return L(`ติดกับ ${t}: ${what}`, `Next to ${t}: ${what}`);
}

// ---------------- detailed ----------------

function hitFormula(e: Hit): string {
  const base: string[] = [];
  if (e.n > 0 || (!e.shieldPct && !e.thornsX && !e.burnPct && !e.poisonPct && !e.perBurn && !e.perDodge)) base.push(String(e.n));
  if (e.shieldPct) base.push(L(`${pct(e.shieldPct)}×โล่ของคุณ`, `${pct(e.shieldPct)}×your shield`));
  if (e.thornsX) base.push(L(`${e.thornsX}×หนามของคุณ`, `${e.thornsX}×your thorns`));
  if (e.burnPct) base.push(L(`${pct(e.burnPct)}×ไฟที่ยังเหลือบนศัตรู`, `${pct(e.burnPct)}×enemy burn left`));
  if (e.poisonPct) base.push(L(`${pct(e.poisonPct)}×พิษที่ยังเหลือบนศัตรู`, `${pct(e.poisonPct)}×enemy poison left`));
  if (e.perBurn) base.push(L(`${e.perBurn}×กองไฟบนศัตรู`, `${e.perBurn}×enemy burn stacks`));
  if (e.perDodge) base.push(L(`${e.perDodge}×แต้มหลบของคุณ`, `${e.perDodge}×your dodge charges`));
  if (e.perRemoved) base.push(L(`${e.perRemoved}×ของที่ลบได้`, `${e.perRemoved}×things removed`));
  const mult: string[] = [];
  if (e.exec) mult.push(L(`×${e.exec[1]} ถ้าศัตรูเลือด<${pct(e.exec[0])}`, `×${e.exec[1]} if enemy HP<${pct(e.exec[0])}`));
  if (e.frozen) mult.push(L(`×${e.frozen} ถ้าศัตรูแข็ง`, `×${e.frozen} if frozen`));
  if (e.noShield) mult.push(L(`×${e.noShield} ถ้าศัตรูไม่มีโล่`, `×${e.noShield} if no enemy shield`));
  let s = L(
    `⚔ ต่อครั้ง = (${base.join(' + ')})${mult.length ? ` ${mult.join(' ')}` : ''} × แรงโบนัส + พลังสะสม + โบนัสดาเมจ, แล้ว × รวมพลัง`,
    `⚔ per hit = (${base.join(' + ')})${mult.length ? ` ${mult.join(' ')}` : ''} × bonus power + stacked power + bonus damage, then × charge`,
  );
  if (e.times && e.times > 1) s += L(` · ${e.times} ครั้ง`, ` · ${e.times} hits`);
  if (e.ifSlowed) s += L(' · เฉพาะถ้าศัตรูช้าอยู่', ' · only if the enemy is slowed');
  if (e.pierce) s += L(` · ไม่สนโล่ ${pct(e.pierce)}`, ` · ignores ${pct(e.pierce)} of shield`);
  if (e.leech) s += L(` · ฟื้น ${pct(e.leech)} ของดาเมจที่เข้าเลือด`, ` · heals ${pct(e.leech)} of HP damage`);
  if (e.burn) s += L(` · ทุกครั้งที่ตี ไฟ ${e.burn[0]}/วิ ${num(e.burn[1])} วิ`, ` · each hit burns ${e.burn[0]}/s ${num(e.burn[1])}s`);
  if (e.poison) s += L(` · ทุกครั้งที่ตีโดน พิษ ${e.poison[0]}/วิ ${num(e.poison[1])} วิ`, ` · each landed hit poisons ${e.poison[0]}/s ${num(e.poison[1])}s`);
  if (e.sure) s += L(' · หลบไม่ได้ (ไม่ใช้แต้มหลบศัตรู)', " · can't be dodged (ignores dodge charges)");
  return s;
}

function effectDetail(e: Effect): string {
  switch (e.k) {
    case 'hit': return hitFormula(e);
    case 'shield': return L(`🛡 โล่ +${e.n} × แรงโบนัส (ไม่หายจนกว่าจะแตก)`, `🛡 shield +${e.n} × bonus power (stays until broken)`);
    case 'heal': return L(`❤ ฟื้น ${e.n} × แรงโบนัส (หนามศัตรู พิษ และแผลลึกลดการฟื้น)`, `❤ heal ${e.n} × bonus power (enemy thorns, poison and wounds cut healing)`);
    case 'burn':
      return L(
        `🔥 ${e.dps}${e.growthHalf ? ' + ½พลัง' : ''}/วิ × ${num(e.secs)} วิ = ${num(e.dps * e.secs)}${e.growthHalf ? '+' : ''} รวม · ไม่สนโล่ · ซ้อนได้`,
        `🔥 ${e.dps}${e.growthHalf ? ' + ½power' : ''}/s × ${num(e.secs)}s = ${num(e.dps * e.secs)}${e.growthHalf ? '+' : ''} total · ignores shield · stacks`,
      );
    case 'poison':
      return L(
        `☠ ${e.dps}/วิ × ${num(e.secs)} วิ = ${num(e.dps * e.secs)} รวม${e.stacks && e.stacks > 1 ? ` × ${e.stacks} กอง` : ''} · ไม่สนโล่ หลบไม่ได้ · ระหว่างติดพิษฟื้นได้ ×${T['poison.heal']}`,
        `☠ ${e.dps}/s × ${num(e.secs)}s = ${num(e.dps * e.secs)} total${e.stacks && e.stacks > 1 ? ` × ${e.stacks} stacks` : ''} · ignores shield, can't be dodged · poisoned healing ×${T['poison.heal']}`,
      );
    case 'dodge':
      return L(`💨 +${e.n} แต้มหลบ (เก็บได้ ${T['dodge.cap']} · ฮีโร่สายหลบ ${T['dodge.cap'] + 1}) · การตีที่โดนครั้งถัดไปแค่เฉียด (เข้า ${pct(T['dodge.graze'])}) 1 ครั้งต่อแต้ม`, `💨 +${e.n} dodge (hold ${T['dodge.cap']} · dodge-line hero ${T['dodge.cap'] + 1}) · each charge turns one incoming hit into a graze (${pct(T['dodge.graze'])} lands)`);
    case 'haste': return L(`⏩ คูลดาวน์ทุกตัวของคุณเร็วขึ้น ${pct(e.pct)} นาน ${num(e.secs)} วิ (สูงสุด ${pct(T['haste.cap'])})`, `⏩ all your cooldowns run ${pct(e.pct)} faster for ${num(e.secs)}s (max ${pct(T['haste.cap'])})`);
    case 'wound': return L(`🩹 ศัตรูฟื้นเลือด ×${num(1 - e.pct)} นาน ${num(e.secs)} วิ`, `🩹 enemy healing ×${num(1 - e.pct)} for ${num(e.secs)}s`);
    case 'freeze': return L(`❄ ${num(e.secs)} วิ = ${Math.round(e.secs * 10)} tick (ลดเมื่อแรง<100%)`, `❄ ${num(e.secs)}s = ${Math.round(e.secs * 10)} ticks (less when power<100%)`);
    case 'slow': return L(`🐌 คูลดาวน์ศัตรูเดินช้าลง ${pct(e.pct)} นาน ${num(e.secs)} วิ`, `🐌 enemy cooldowns run ${pct(e.pct)} slower for ${num(e.secs)}s`);
    case 'delay': return L(`⏪ ดึงคูลดาวน์ศัตรูถอย ${Math.round(e.secs * 10)} tick`, `⏪ pushes enemy cooldowns back ${Math.round(e.secs * 10)} ticks`);
    case 'grow': return L(`💪 +${e.n} ต่อการตีทุกครั้ง จนจบการสู้`, `💪 +${e.n} on every hit until the fight ends`);
    case 'charge': return L(`⚡ การตี ${e.hits ?? 1} ครั้งถัดไปที่แรง ${T['charge.min']}+ ×${e.mult} (ตีเบากว่านั้นไม่ใช้รวมพลัง)`, `⚡ next ${e.hits ?? 1} hit(s) of ${T['charge.min']}+ ×${e.mult} (smaller hits don’t use it)`);
    case 'thorns':
      return L(
        `🌵 ${e.n}${e.perm ? ' ถาวร' : ''} · สะท้อนไม่เกิน ${pct(THORNS_MAX)} ของดาเมจ · ศัตรูฟื้น ×${e.heal ?? 0.5}`,
        `🌵 ${e.n}${e.perm ? ' permanent' : ''} · reflects at most ${pct(THORNS_MAX)} of a hit · enemy heals ×${e.heal ?? 0.5}`,
      );
    case 'steadfast':
      return L(
        `🗿 การคุมที่โดนเหลือ ${pct(e.keep ?? 0.4)}${e.ignoreFreeze ? ' · ไม่โดนแช่แข็งครั้งถัดไป' : ''}`,
        `🗿 control on you lands at ${pct(e.keep ?? 0.4)}${e.ignoreFreeze ? ' · ignores the next freeze' : ''}`,
      );
    case 'cleanse':
      return e.dot
        ? L(`✨ ลบไฟ/พิษ ${Math.min(e.n, CLEANSE_MAX)} กอง (ไม่ลบการแช่แข็ง ไม่ทำงานตอนโดนคุม)`, `✨ removes ${Math.min(e.n, CLEANSE_MAX)} burn/poison stack(s) (not freeze; does not react to control)`)
        : L(`✨ ลบไฟ/พิษ ${Math.min(e.n, CLEANSE_MAX)} กอง + ความช้า + แช่แข็ง + แผลลึก`, `✨ removes ${Math.min(e.n, CLEANSE_MAX)} burn/poison stack(s) + slow + freeze + wound`);
    case 'dispel':
      return L(
        `💥 ลบบัฟศัตรูอย่างละ ${e.n >= 99 ? 'ทั้งหมด' : e.n} + โล่ ${pct(e.shield ?? 0.2)}${e.steal ? ' · ได้พลังที่ลบมา' : ''}`,
        `💥 removes ${e.n >= 99 ? 'all' : e.n} of each enemy buff + ${pct(e.shield ?? 0.2)} shield${e.steal ? ' · you gain the power removed' : ''}`,
      );
    case 'leech': return L(`🩸 การตีถัดไปฟื้น ${pct(e.pct)} ของดาเมจ`, `🩸 next hit heals ${pct(e.pct)} of its damage`);
  }
}

/** Exact internals for the detailed tooltip, one line each. */
export function detailLines(k: K, haste = 0): string[] {
  const n = nodeOf(k);
  const ticks = cdTicks(k, haste);
  const mods: string[] = [];
  if (k.mark === 'quick') mods.push(L('ร่ายไว ×0.6', 'quick ×0.6'));
  if (haste) mods.push(L(`ต่อ chain −${pct(Math.min(0.5, haste))}`, `chain −${pct(Math.min(0.5, haste))}`));
  const out = [
    L(
      `⏱ ${ticks} tick = ${num(ticks / 10)} วิ${mods.length ? ` (ฐาน ${n.cd} tick, ${mods.join(', ')})` : ''} · 10 tick = 1 วิ · ต่ำสุด 5 tick`,
      `⏱ ${ticks} ticks = ${num(ticks / 10)}s${mods.length ? ` (base ${n.cd} ticks, ${mods.join(', ')})` : ''} · 10 ticks = 1s · min 5 ticks`,
    ),
  ];
  const direct = n.fx.reduce((s, e) => (e.k === 'hit' && !e.ifSlowed ? s + e.n * (e.times ?? 1) : s), 0);
  if (direct > 0) out.push(L(`≈ ${num(direct / (ticks / 10))} ดาเมจฐาน/วิ (ยังไม่รวมพลัง โบนัส และตัวคูณ)`, `≈ ${num(direct / (ticks / 10))} base damage/s (before power, bonuses, multipliers)`));
  if (n.engine) {
    const en = n.engine;
    out.push(
      en.kind === 'gear'
        ? L(`⚙ ทุกครั้งที่ทำงาน สั่ง ${en.n ?? 1} skill ข้างๆ (สลับบน/ล่าง) ที่แรง ${pct(en.power)} × แรงโบนัส · คูลดาวน์ตัวนั้นเดินต่อ`, `⚙ each fire sets off ${en.n ?? 1} neighbour(s) (taking turns) at ${pct(en.power)} × bonus power · their cooldowns keep running`)
        : L(`🚀 สั่งบนและล่างที่แรง ${pct(en.power)} × แรงโบนัส · ${en.keep ? 'คูลดาวน์ตัวนั้นไม่เริ่มใหม่' : 'คูลดาวน์ตัวนั้นเริ่มใหม่'}`, `🚀 fires above and below at ${pct(en.power)} × bonus power · ${en.keep ? 'their cooldowns keep their progress' : 'their cooldowns restart'}`),
    );
    out.push(L(`ตัวที่ถูกสั่ง ทำงานซ้ำจากการสั่งได้ทุก ${TRIGGER_GAP}–${TRIGGER_GAP_MAX} tick · การคุมลดตามแรง`, `a set-off skill can be set off again after ${TRIGGER_GAP}–${TRIGGER_GAP_MAX} ticks · its control scales with power`));
  }
  for (const e of n.fx) out.push(effectDetail(e));
  if (n.fx.some((e) => e.k === 'freeze' || e.k === 'delay'))
    out.push(L(`เพดานแช่แข็ง+ถ่วง: ไม่เกิน ${pct(CTL_SHARE)} ของเวลาที่สู้ (ช่วง ${CTL_MIN_T / 10} วิแรกนับเป็น ${CTL_MIN_T / 10} วิ) · ศัตรูที่ไม่ได้ใช้ skill ${SHAKE_OFF} tick จะสะบัดหลุด`, `freeze+delay cap: at most ${pct(CTL_SHARE)} of the fight time (the first ${CTL_MIN_T / 10}s count as ${CTL_MIN_T / 10}s) · an enemy idle for ${SHAKE_OFF} ticks shakes it off`));
  if (k.mark === 'echo') out.push(L('ตรา ตีซ้ำ: ทำงานซ้ำทันทีที่แรง 50% (โบนัสดาเมจ ×0.5)', 'Echo mark: works again right away at 50% (bonus damage ×0.5)'));
  if (k.mark === 'burn') out.push(L('ตรา เผาไหม้: ทุกครั้งที่ใช้ ไฟ 1/วิ 3 วิ', 'Burn mark: each use burns 1/s for 3s'));
  if (k.mark === 'steadfast') out.push(L('ตรา ไม่หวั่นไหว: คูลดาวน์เดินต่อตอนโดนแช่แข็ง', 'Steadfast mark: cooldown keeps counting while frozen'));
  return out;
}

/** Exact math of a connect bonus (detailed tooltip). */
export function detailBonus(b: Bonus, lv: number): string {
  const v = bonusValue(b.e, lv);
  return {
    dmg: L(`+${v} ต่อการตี (Lv×1)`, `+${v} per hit (Lv×1)`),
    shield: L(`+${v} โล่ทุกครั้งที่ทำงาน (1+Lv)`, `+${v} shield per fire (1+Lv)`),
    haste: L(`คูลดาวน์ ×${1 - HASTE_BONUS} (ซ้อนได้ ลดได้สูงสุด 50%)`, `cooldown ×${1 - HASTE_BONUS} (stacks, max −50%)`),
    power: L(`ตัวเลขทุกอย่าง ×${1 + POWER_BONUS} (ซ้อนแบบบวก)`, `every number ×${1 + POWER_BONUS} (stacks additively)`),
    trigger: L(`ตัวที่ติดกันทำงานที่แรงเท่ากัน · ต่อ chain ชั้นลึกแรง ×${T.chainDecay}`, `the neighbour fires at the same power · deeper chain steps ×${T.chainDecay}`),
  }[b.e];
}
