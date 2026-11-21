import { HEROES_BY_ID } from './heroes';
import { Rng, hashSeed } from './rng';
import { T } from './tuning';
import type { Line } from './types';

/**
 * Run relics (sim v17, docs/DESIGN_LINES_ULT.md §11): run-long rule tweaks picked 1 of 3 (or skipped) before the shop
 * on RELIC_DAYS. About two per line, a few generic / hybrid enablers that pull a hero toward a second line, and three
 * risky "cheese" relics that only pay off with a rare setup. Pure data + text; combat.ts reads the numbers from
 * tuning.ts `relic.*` and applies the effect. A relic belongs to the run (and its Build), at most MAX_RELICS.
 */
export type RelicGroup = Line | 'any' | 'cheese';
export interface RelicDef {
  id: string;
  icon: string;
  group: RelicGroup;
  /** other lines this relic also suits (it counts as "your line" for them in the offer and the picker) */
  also?: Line[];
  name: [string, string];
  /** what it does, with its live numbers: [Thai, English] */
  desc: () => [string, string];
}

const pc = (x: number) => Math.round(x * 100);
export const RELIC_DAYS = [4, 7, 10];
export const MAX_RELICS = RELIC_DAYS.length;
export const RELIC_OFFER = 3;
/** a relic of the hero's line is this many times as likely as any other in the offer (after the first one is owned) */
const LINE_W = 1.3;

export const RELICS: RelicDef[] = [
  // ⚔ hit
  { id: 'whetstone', icon: '🗡️', group: 'hit', also: ['dodge'], name: ['หินลับมีด', 'Whetstone'],
    desc: () => [`การใช้ครั้งแรกของทุก skill แรง +${pc(T['relic.whetstone'])}%`, `the first cast of each skill is ${pc(T['relic.whetstone'])}% stronger`] },
  { id: 'executioner', icon: '🪓', group: 'hit', also: ['burn', 'poison'], name: ['ขวานเพชฌฆาต', 'Headsman'],
    desc: () => [`ตีศัตรูที่เลือดต่ำกว่า 40% แรง +${pc(T['relic.executioner'])}%`, `hits on an enemy below 40% HP deal +${pc(T['relic.executioner'])}%`] },
  // 💨 dodge
  { id: 'counterstep', icon: '🌀', group: 'dodge', also: ['hit'], name: ['ก้าวสวน', 'Counterstep'],
    desc: () => [`หลบได้แล้ว การตีครั้งถัดไป +${pc(T['relic.counterstep'])}%`, `after you dodge, your next hit deals +${pc(T['relic.counterstep'])}%`] },
  { id: 'featherstep', icon: '🪶', group: 'dodge', name: ['ขนนก', 'Featherstep'],
    desc: () => ['เก็บแต้มหลบได้ +1 แต้ม', 'hold +1 dodge charge'] },
  // 🛡 shield
  { id: 'spikedshield', icon: '🦔', group: 'shield', name: ['โล่หนาม', 'Spiked shield'],
    desc: () => [`ดาเมจที่โล่รับไว้ สะท้อนกลับ ${pc(T['relic.spikedshield'])}%`, `${pc(T['relic.spikedshield'])}% of the damage your shield blocks is reflected`] },
  { id: 'bastion', icon: '🏰', group: 'shield', also: ['heal'], name: ['ป้อมปราการ', 'Bastion'],
    desc: () => [`เริ่มสู้พร้อมโล่ ${pc(T['relic.bastion'])}% ของเลือดสูงสุด`, `start each fight with a shield of ${pc(T['relic.bastion'])}% of your max HP`] },
  // ❤ heal
  { id: 'overflow', icon: '🫗', group: 'heal', also: ['shield'], name: ['ถ้วยล้น', 'Overflow'],
    desc: () => [`ฟื้นเกินเลือดเต็ม → เป็นโล่ ${pc(T['relic.overflow'])}%`, `healing past full HP becomes shield (${pc(T['relic.overflow'])}%)`] },
  { id: 'vitality', icon: '🌿', group: 'heal', name: ['สมุนไพร', 'Vitality'],
    desc: () => [`ฟื้นเลือดได้มากขึ้น +${pc(T['relic.vitality'])}%`, `your healing is ${pc(T['relic.vitality'])}% stronger`] },
  // 🔥 burn
  { id: 'meltdown', icon: '🌋', group: 'burn', name: ['หลอมละลาย', 'Meltdown'],
    desc: () => [`ไฟของคุณเผาโล่ศัตรู ×${T['relic.meltdown']}`, `your burns melt enemy shield ×${T['relic.meltdown']}`] },
  { id: 'kindling', icon: '🪵', group: 'burn', name: ['ฟืนแห้ง', 'Kindling'],
    desc: () => [`ไฟที่คุณจุดติดนานขึ้น ${T['relic.kindling']} วิ`, `your burns last ${T['relic.kindling']}s longer`] },
  // ☠ poison
  { id: 'virulence', icon: '🧪', group: 'poison', name: ['พิษเข้มข้น', 'Virulence'],
    desc: () => [`พิษทุกกองที่คุณใส่ +${T['relic.virulence']}/วิ`, `every poison stack you apply deals +${T['relic.virulence']}/s`] },
  { id: 'rot', icon: '🍄', group: 'poison', name: ['เน่าเปื่อย', 'Rot'],
    desc: () => [`ศัตรูที่ติดพิษโดนตีแรงขึ้น +${pc(T['relic.rot'])}%`, `a poisoned enemy takes +${pc(T['relic.rot'])}% from your hits`] },
  // ❄ ice
  { id: 'permafrost', icon: '🧊', group: 'ice', name: ['น้ำแข็งนิรันดร์', 'Permafrost'],
    desc: () => T['relic.permafrostCd'] > 0
      ? [`แช่แข็งนานขึ้น ${T['relic.permafrost']} วิ แต่คูลดาวน์ทุกตัว +${pc(T['relic.permafrostCd'])}%`, `your freezes last ${T['relic.permafrost']}s longer, but every cooldown is ${pc(T['relic.permafrostCd'])}% longer`]
      : [`แช่แข็งนานขึ้น ${T['relic.permafrost']} วิ (ยังอยู่ใต้เพดานการคุม)`, `your freezes last ${T['relic.permafrost']}s longer (still under the control cap)`] },
  { id: 'brittle', icon: '💎', group: 'ice', also: ['hit'], name: ['เปราะ', 'Brittle'],
    desc: () => [`ตีศัตรูที่ถูกแช่แข็งแรง +${pc(T['relic.brittle'])}%`, `hits on a frozen enemy deal +${pc(T['relic.brittle'])}%`] },
  // 🌪 wind
  { id: 'gale', icon: '🌬️', group: 'wind', also: ['ice'], name: ['ลมแรง', 'Gale'],
    desc: () => [`ความช้าที่คุณใส่ +${pc(T['relic.gale'])}% และนานขึ้น 1 วิ`, `your slows are +${pc(T['relic.gale'])}% stronger and last 1s longer`] },
  { id: 'tailspin', icon: '🪁', group: 'wind', also: ['dodge'], name: ['ว่าวลม', 'Tailspin'],
    desc: () => [`ความเร็วที่คุณได้นานขึ้น ${T['relic.tailspin']} วิ และ +10%`, `your haste lasts ${T['relic.tailspin']}s longer and is +10%`] },
  // ✦ generic / hybrid enablers
  { id: 'quickdraw', icon: '⏱️', group: 'any', also: ['ice', 'wind'], name: ['ชักไว', 'Quickdraw'],
    desc: () => [`ทุก skill เริ่มสู้ด้วยคูลดาวน์ไปแล้ว ${pc(T['relic.quickdraw'])}%`, `every skill starts the fight ${pc(T['relic.quickdraw'])}% through its cooldown`] },
  { id: 'wanderer', icon: '🧭', group: 'any', name: ['นักพเนจร', 'Wanderer'],
    desc: () => [`skill นอกสายหลักแรงขึ้น +${pc(T['relic.wanderer'])}%`, `skills outside your hero's line are ${pc(T['relic.wanderer'])}% stronger`] },
  { id: 'twinline', icon: '☯️', group: 'any', name: ['สองสาย', 'Twin line'],
    desc: () => [`skill ของสายรอง (สายที่มีมากสุดรองจากสายหลัก) แรงขึ้น +${pc(T['relic.twinline'])}%`, `skills of your second line (the one you own most of after your main) are ${pc(T['relic.twinline'])}% stronger`] },
  { id: 'ironhide', icon: '🐢', group: 'any', also: ['shield', 'heal'], name: ['หนังเหล็ก', 'Ironhide'],
    desc: () => [`เลือดสูงสุด +${pc(T['relic.ironhide'])}%`, `+${pc(T['relic.ironhide'])}% max HP`] },
  // ☢ cheese: strong only with a rare setup
  { id: 'glasscannon', icon: '🔮', group: 'cheese', name: ['ปืนแก้ว', 'Glass cannon'],
    desc: () => [`เลือดสูงสุดเหลือ ${pc(T['relic.glassHp'])}% แต่การตีทุกครั้ง +${pc(T['relic.glassDmg'])}% (ส่วนที่เพิ่มไม่เกิน ${pc(T['relic.glassCap'])}% ของเลือดศัตรูต่อครั้ง)`, `max HP down to ${pc(T['relic.glassHp'])}%, but every hit deals +${pc(T['relic.glassDmg'])}% (the extra is at most ${pc(T['relic.glassCap'])}% of the enemy's max HP per hit)`] },
  { id: 'lonewolf', icon: '🐺', group: 'cheese', name: ['หมาป่าเดียวดาย', 'Lone wolf'],
    desc: () => [`มี skill ไม่เกิน 3 ตัว: ทุกตัวแรง +${pc(T['relic.lonewolf'])}%`, `with 3 skills or fewer, each one is ${pc(T['relic.lonewolf'])}% stronger`] },
  { id: 'sigil', icon: '🔱', group: 'cheese', name: ['ตราศักดิ์สิทธิ์', 'Sigil'],
    desc: () => [`skill ที่มีตรา (2 ตัวแรกในรายการ) แรง +${pc(T['relic.sigil'])}%`, `marked skills (the first 2 in your list) are ${pc(T['relic.sigil'])}% stronger`] },
];
export const RELICS_BY_ID: Record<string, RelicDef> = Object.fromEntries(RELICS.map((r) => [r.id, r]));
export const isRelic = (id: unknown): id is string => typeof id === 'string' && !!RELICS_BY_ID[id];
/** relics a run can own by `day` (one per relic day reached) */
export const relicsAllowed = (day: number) => RELIC_DAYS.filter((d) => d <= day).length;
export const relicText = (id: string, th = true) => {
  const r = RELICS_BY_ID[id];
  if (!r) return '';
  const d = r.desc();
  return `${r.icon} ${th ? r.name[0] : r.name[1]}: ${th ? d[0] : d[1]}`;
};
/** the lines (not 'none') a build owns skills of: what a relic offer and its "fits" label look at */
export const skillLinesOf = (skills: { id: string }[], lineOf: (id: string) => string | undefined) => [...new Set(skills.map((k) => lineOf(k.id)).filter((l): l is string => !!l && l !== 'none'))];
/** does this relic suit `line` (its own group, or one of the lines it also suits)? */
export const relicFits = (id: string, line?: string) => !!line && (RELICS_BY_ID[id]?.group === line || !!RELICS_BY_ID[id]?.also?.includes(line as Line));
export const GROUP_ICON: Record<RelicGroup, string> = {
  hit: '⚔', dodge: '💨', shield: '🛡', heal: '❤', burn: '🔥', poison: '☠', ice: '❄', wind: '🌪', any: '✦', cheese: '☢',
};

/**
 * The 3 relics offered on a relic day: seeded by the run and day, never one already owned, at least one of the hero's
 * line while the run owns none of its line's relics (then line relics are only weighted ×1.3), the rest from everything
 * else (other lines, generic and cheese relics).
 */
export function rollRelicOffer(seed: number, hero: string, day: number, owned: string[] = [], skillLines: string[] = []): string[] {
  const rng = new Rng(hashSeed(seed, 'relic', day));
  const line = HEROES_BY_ID[hero]?.line;
  // sim v18: "fits" = the hero's line or a line the build owns skills of
  const lines = [...new Set([line, ...skillLines].filter((x): x is string => !!x && x !== 'none'))];
  const fits = (id: string) => lines.some((l) => relicFits(id, l));
  const pool = RELICS.filter((r) => !owned.includes(r.id));
  const out: string[] = [];
  // always at least one that fits the build (sim v18: a line it owns skills of, not only the hero's nominal line);
  // the hero's own line is weighted ×LINE_W in the rest
  const mine = pool.filter((r) => fits(r.id));
  if (mine.length) out.push(rng.pick(mine).id);
  const rest = pool.filter((r) => !out.includes(r.id));
  while (out.length < RELIC_OFFER && rest.length) {
    const w = rest.map((r) => (relicFits(r.id, line) ? LINE_W : 1));
    let x = rng.next() * w.reduce((a, b) => a + b, 0);
    let i = 0;
    while (i < w.length - 1 && (x -= w[i]) >= 0) i++;
    out.push(rest.splice(i, 1)[0].id);
  }
  return out;
}
