import type { Archetype, SkillInstance } from './types';
import { L } from '../i18n';

/**
 * Skills are data. Each skill has a tree: Lv1 (variant ''), two Lv2 variants ('a', 'b') and two Lv3 variants under
 * each ('a1', 'a2', 'b1', 'b2'). A variant is a cooldown plus a list of effects. The combat engine runs the effects
 * (execNode) and the UI turns them into icon + number chips (keyword tooltips explain each icon).
 * Grid version: every skill also has the block shapes a copy can roll, and two engine skills fire the blocks they touch.
 */

// ---------------- keywords (icons the UI shows; tooltips explain them) ----------------

export type Keyword =
  | 'hit' | 'pierce' | 'shield' | 'heal' | 'leech' | 'burn' | 'freeze' | 'slow' | 'delay' | 'grow' | 'charge'
  | 'thorns' | 'steadfast' | 'cleanse' | 'dispel' | 'amplify' | 'exec' | 'shatter' | 'gear' | 'overclock' | 'cd';

export const KEYWORDS: Record<Keyword, { icon: string; name: string; desc: string }> = {
  hit: { icon: '⚔', name: 'ตี', desc: 'ทำดาเมจใส่ศัตรู (+พลังที่สะสม) · ×N = ตี N ครั้ง' },
  pierce: { icon: '🗡', name: 'ทะลุ', desc: 'ไม่สนโล่ของศัตรู (🗡50% = ไม่สนครึ่งหนึ่ง)' },
  shield: { icon: '🛡', name: 'โล่', desc: 'โล่รับดาเมจแทนเลือด อยู่จนกว่าจะแตก' },
  heal: { icon: '❤', name: 'ฟื้น', desc: 'ฟื้นเลือดตัวเอง' },
  leech: { icon: '🩸', name: 'ดูดเลือด', desc: 'ฟื้นเลือดตามสัดส่วนของดาเมจที่ทำ' },
  burn: { icon: '🔥', name: 'ไฟ', desc: 'ศัตรูเสียเลือด X ต่อวินาที นาน N วิ · ไม่สนโล่ · ซ้อนกันได้' },
  freeze: { icon: '❄', name: 'แช่แข็ง', desc: 'skill ทุกตัวของศัตรูหยุดนับคูลดาวน์ · โดนถี่ๆ ผลลดลง · มีเพดานต่อการสู้ · หลุดแช่แข็งแล้วต้านการคุมได้ 1.5 วิ (ตั้งหลัก)' },
  slow: { icon: '🐌', name: 'ช้า', desc: 'คูลดาวน์ทุกตัวของศัตรูเดินช้าลง X% · มีเพดานต่อการสู้' },
  delay: { icon: '⏪', name: 'ถ่วงเวลา', desc: 'ดึงคูลดาวน์ทุกตัวของศัตรูถอยหลัง N วิ · ใช้เพดานร่วมกับแช่แข็ง · โดนแล้วต้านการคุมได้ 1.5 วิ (ตั้งหลัก)' },
  grow: { icon: '💪', name: 'พลัง', desc: 'ทุกการตีของทุก skill ทำดาเมจเพิ่ม +X จนจบการสู้' },
  charge: { icon: '⚡', name: 'รวมพลัง', desc: 'การตีครั้งถัดไปของคุณ (skill ไหนก็ได้) แรง ×N' },
  thorns: { icon: '🌵', name: 'หนาม', desc: 'ทุกครั้งที่โดนตี สะท้อนดาเมจเท่าหนาม (ไม่เกิน 75% ของดาเมจที่โดน) · ระหว่างมีหนาม ศัตรูฟื้นเลือดได้ครึ่งเดียว' },
  steadfast: { icon: '🗿', name: 'ใจเหล็ก', desc: 'แช่แข็ง ช้า และถ่วงเวลาที่คุณโดน อ่อนลง 60% จนจบการสู้ · บล็อกที่มี 🗿 ทำงานทันทีเมื่อคุณโดนคุม (1 ครั้งต่อคูลดาวน์)' },
  cleanse: { icon: '✨', name: 'ชำระ', desc: 'ลบดีบัฟบนตัวคุณ: ไฟ (กองแรงสุด) ความช้า การแช่แข็ง · บล็อกที่มี ✨ ทำงานทันทีเมื่อคุณโดนคุม (1 ครั้งต่อคูลดาวน์)' },
  dispel: { icon: '💥', name: 'สลาย', desc: 'ลบบัฟของศัตรูอย่างละ 1: พลัง หนาม รวมพลัง ใจเหล็ก และโล่ 20%' },
  amplify: { icon: '✖2', name: 'ขยาย', desc: 'บัฟที่มีตอนนี้ (พลัง หนาม รวมพลัง) เพิ่มเป็น 2 เท่า ไม่เกินเพดาน' },
  exec: { icon: '🎯', name: 'ประหาร', desc: 'แรงขึ้นเมื่อศัตรูเลือดต่ำกว่าที่กำหนด' },
  shatter: { icon: '🧊', name: 'ทุบน้ำแข็ง', desc: 'แรงขึ้นเมื่อศัตรูกำลังถูกแช่แข็ง' },
  gear: { icon: '⚙', name: 'ฟันเฟือง', desc: 'ทุกครั้งที่ทำงาน สั่งบล็อกที่ติดกัน 1 ตัวให้ทำงานทันที (วนทีละตัว ข้ามตัวที่เพิ่งถูกสั่ง) ที่แรงตาม % · คูลดาวน์ของตัวนั้นเดินต่อตามปกติ · บล็อกหนึ่งถูกสั่งได้ไม่เกิน 1 ครั้งต่อคูลดาวน์ของมัน (3–6 วิ)' },
  overclock: { icon: '🚀', name: 'เร่งเครื่อง', desc: 'สั่งบล็อกทุกตัวที่ติดกันให้ทำงานทันที ที่แรงตาม % · แล้วคูลดาวน์ของตัวนั้นเริ่มนับใหม่ · บล็อกหนึ่งถูกสั่งได้ไม่เกิน 1 ครั้งต่อคูลดาวน์ของมัน (3–6 วิ)' },
  cd: { icon: '⏱', name: 'คูลดาวน์', desc: 'ใช้ได้ทุกกี่วินาที (ทุก skill นับพร้อมกัน)' },
};

// ---------------- effects ----------------

export type Effect =
  | {
      k: 'hit';
      n: number;
      /** hit this many times (each hit gets พลัง) */
      times?: number;
      /** share of the enemy shield ignored (1 = all) */
      pierce?: number;
      /** [hp share, multiplier]: stronger when the enemy is below that HP share */
      exec?: [number, number];
      /** multiplier while the enemy is frozen */
      frozen?: number;
      /** multiplier when the enemy has no shield */
      noShield?: number;
      /** + this share of your shield */
      shieldPct?: number;
      /** + your thorns × this */
      thornsX?: number;
      /** + this share of the burn damage still to come on the enemy */
      burnPct?: number;
      /** + this share of the enemy's max HP (grows with the day: big targets late) */
      maxHpPct?: number;
      /** only if the enemy was already slowed */
      ifSlowed?: boolean;
      /** heal this share of the damage dealt */
      leech?: number;
      /** each hit also burns [dps, secs] */
      burn?: [number, number];
      /** + this much per debuff removed / buff removed by an earlier cleanse / dispel in the same cast */
      perRemoved?: number;
    }
  | { k: 'shield'; n: number }
  | { k: 'heal'; n: number }
  | { k: 'burn'; dps: number; secs: number; /** + half your พลัง per second */ growthHalf?: boolean }
  | { k: 'freeze'; secs: number }
  | { k: 'slow'; pct: number; secs: number }
  | { k: 'delay'; secs: number }
  | { k: 'grow'; n: number }
  | { k: 'charge'; mult: number; /** the multiplier lasts this many hits */ hits?: number }
  | { k: 'thorns'; n: number; /** never wears off */ perm?: boolean; /** enemy healing multiplier while you have thorns (default 0.5) */ heal?: number }
  | { k: 'steadfast'; /** share of control that still lands (default 0.4) */ keep?: number; /** the next freeze on you is ignored */ ignoreFreeze?: boolean }
  | { k: 'cleanse'; /** how many burn stacks (99 = all); slow and freeze always go */ n: number }
  | { k: 'dispel'; /** how many of each buff (99 = all) */ n: number; /** share of the enemy shield removed (default 0.2) */ shield?: number; /** you gain the พลัง removed */ steal?: boolean }
  | { k: 'amplify'; cap: number }
  | { k: 'leech'; /** your next hit heals this share of its damage */ pct: number };

/**
 * Engine: fires touching blocks (combat.ts).
 * gear = n touching blocks per fire (round-robin), their cooldowns keep running
 * overclock = every touching block fires now; its cooldown restarts unless keep
 */
export interface Engine {
  kind: 'gear' | 'overclock';
  /** power of the fires it causes (1 = full) */
  power: number;
  /** gear: blocks per fire (default 1) */
  n?: number;
  /** overclock: the fired blocks keep their cooldown progress */
  keep?: boolean;
}

export interface SkillNode {
  name: string;
  /** cooldown in ticks (10 ticks = 1s) */
  cd: number;
  fx: Effect[];
  /** short playstyle label for Lv2 branches */
  style?: string;
  engine?: Engine;
}

export type Variant = '' | 'a' | 'b' | 'a1' | 'a2' | 'b1' | 'b2';
export const VARIANTS: Variant[] = ['', 'a', 'b', 'a1', 'a2', 'b1', 'b2'];
export const lvOf = (v: string) => (v.length === 0 ? 1 : v.length === 1 ? 2 : 3);
/** the two variants one level up ([] at Lv3) */
export const nextVariants = (v: string): Variant[] =>
  v === '' ? ['a', 'b'] : v.length === 1 ? ([`${v}1`, `${v}2`] as Variant[]) : [];
export const isVariant = (v: unknown): v is Variant => typeof v === 'string' && (VARIANTS as string[]).includes(v);

export interface SkillDef {
  id: string;
  arch: Archetype | 'none';
  /** block shapes a copy can roll in the shop (grid.ts SHAPES) */
  shapes: string[];
  /** hero-unique skill: only that hero's shops offer it */
  hero?: string;
  tree: Record<Variant, SkillNode>;
  /** Lv1 name (= tree[''].name) */
  name: string;
}

// ---------------- what a skill can do (implemented by the combat engine) ----------------

export interface FighterView {
  hp: number;
  maxHp: number;
  shield: number;
  frozen: boolean;
  slowed: boolean;
  hero: string;
  /** total thorns right now */
  thorns: number;
  /** total พลัง right now */
  growth: number;
  /** burn damage still to come from every burn stack on this fighter */
  burnLeft: number;
}

export interface Ctx {
  /** scale a number by the cast power (echo mark casts at 50%) */
  v(n: number): number;
  readonly me: FighterView;
  readonly foe: FighterView;
  /** returns damage dealt. pierce = share of shield ignored. leech = share healed */
  hit(amount: number, o?: { pierce?: number; leech?: number }): number;
  shield(n: number): void;
  heal(n: number): void;
  burn(dps: number, secs: number): void;
  freeze(secs: number): void;
  slow(pct: number, secs: number): void;
  delay(secs: number): void;
  grow(n: number): void;
  charge(mult: number, hits: number): void;
  thorns(n: number, perm: boolean, heal?: number): void;
  steadfast(keep: number, ignoreFreeze: boolean): void;
  /** returns how much was added */
  amplify(cap: number): number;
  /** returns debuffs removed */
  cleanse(n: number): number;
  /** returns buffs removed */
  dispel(n: number, shield: number, steal: boolean): number;
  leech(pct: number): void;
}

/** Run one skill variant. */
export function execNode(node: SkillNode, c: Ctx) {
  let removed = 0;
  for (const e of node.fx) {
    switch (e.k) {
      case 'hit': {
        if (e.ifSlowed && !c.foe.slowed) break;
        const times = e.times ?? 1;
        for (let i = 0; i < times; i++) {
          let n = e.n + (e.perRemoved ?? 0) * removed;
          if (e.shieldPct) n += c.me.shield * e.shieldPct;
          if (e.thornsX) n += c.me.thorns * e.thornsX;
          if (e.burnPct) n += c.foe.burnLeft * e.burnPct;
          if (e.maxHpPct) n += c.foe.maxHp * e.maxHpPct;
          if (n <= 0) break;
          let mult = 1;
          if (e.exec && c.foe.hp < c.foe.maxHp * e.exec[0]) mult *= e.exec[1];
          if (e.frozen && c.foe.frozen) mult *= e.frozen;
          if (e.noShield && c.foe.shield <= 0) mult *= e.noShield;
          c.hit(c.v(n * mult), { pierce: e.pierce, leech: e.leech });
          if (e.burn) c.burn(c.v(e.burn[0]), e.burn[1]);
        }
        break;
      }
      case 'shield': c.shield(c.v(e.n)); break;
      case 'heal': c.heal(c.v(e.n)); break;
      case 'burn': c.burn(c.v(e.dps + (e.growthHalf ? Math.floor(c.me.growth / 2) : 0)), e.secs); break;
      case 'freeze': c.freeze(e.secs); break;
      case 'slow': c.slow(e.pct, e.secs); break;
      case 'delay': c.delay(e.secs); break;
      case 'grow': c.grow(c.v(e.n)); break;
      case 'charge': c.charge(e.mult, e.hits ?? 1); break;
      case 'thorns': c.thorns(c.v(e.n), !!e.perm, e.heal); break;
      case 'steadfast': c.steadfast(e.keep ?? 0.4, !!e.ignoreFreeze); break;
      case 'cleanse': removed = c.cleanse(e.n); break;
      case 'dispel': removed = c.dispel(e.n, e.shield ?? 0.2, !!e.steal); break;
      case 'amplify': c.amplify(e.cap); break;
      case 'leech': c.leech(e.pct); break;
    }
  }
}

// ---------------- skill data ----------------

const s = (secs: number) => Math.round(secs * 10);
const hit = (n: number, o: Omit<Extract<Effect, { k: 'hit' }>, 'k' | 'n'> = {}): Effect => ({ k: 'hit', n, ...o });
const N = (name: string, cdSecs: number, fx: Effect[], style?: string): SkillNode => ({ name, cd: s(cdSecs), fx, ...(style ? { style } : {}) });
/** engine node */
const E = (name: string, cdSecs: number, engine: Engine, fx: Effect[] = [], style?: string): SkillNode => ({ ...N(name, cdSecs, fx, style), engine });

/** block shapes per skill (bigger skills take more room) */
const SHAPES_OF: Record<string, string[]> = {
  strike: ['i3', 'l3'], jab: ['i2'], heavy: ['r6', 'p5'], charge: ['i2', 'l3'],
  shield: ['o4', 'l3'], thorns: ['i3', 'l3'], stoneskin: ['t4', 'l4'], cleanse: ['i2', 'l3'],
  train: ['i2', 'l3'], ignite: ['i3', 'i2'], feast: ['o4', 's4'], amplify: ['t4', 'l4'],
  frost: ['i2', 'l3'], chill: ['i3', 'l3'], dispel: ['i3', 'l3'], ironwill: ['dot', 'i2'],
  gear: ['o4', 'r6'], overclock: ['i2', 'l3'],
  bulwark: ['l4', 't4'], spikewall: ['t4', 'l4'], execute: ['i3', 'l3'], flurry: ['i3', 'l3'],
  rampage: ['t4', 's4'], inferno: ['o4', 't4'], shatter: ['i3', 'l4'], timewarp: ['i3', 'l3'],
};

type Tree = Record<Variant, SkillNode>;
const def = (id: string, arch: Archetype | 'none', tree: Tree, hero?: string): SkillDef =>
  ({ id, arch, shapes: SHAPES_OF[id], tree, name: tree[''].name, ...(hero ? { hero } : {}) });

export const SKILL_LIST: SkillDef[] = [
  // ======================= burst =======================
  def('strike', 'burst', {
    '': N('ฟัน', 4.3, [hit(4)]),
    a: N('ฟันหนัก', 5, [hit(9)], 'ตีหนัก'),
    a1: N('ฟันทะลวง', 5, [hit(15, { pierce: 1 })]),
    a2: N('ฟันประหาร', 5, [hit(14, { exec: [0.5, 1.6] })]),
    b: N('ฟันคู่', 4, [hit(4, { times: 2 })], 'ตีหลายครั้ง'),
    b1: N('ฟันพายุ', 4, [hit(5, { times: 4 })]),
    b2: N('ฟันดูดเลือด', 4, [hit(7, { times: 2, leech: 0.3 })]),
  }),
  def('jab', 'burst', {
    '': N('แทงเร็ว', 3.3, [hit(2)]),
    a: N('แทงไว', 2.7, [hit(4)], 'ความเร็ว'),
    a1: N('แทงสายฟ้า', 2.1, [hit(5)]),
    a2: N('แทงพิษ', 2.7, [hit(4, { burn: [1, 3] })]),
    b: N('แทงจุดตาย', 3, [hit(6, { noShield: 1.5 })], 'ตีศัตรูไร้โล่'),
    b1: N('แทงทะลุ', 3, [hit(10, { pierce: 1, noShield: 1.5 })]),
    b2: N('แทงสะกด', 3, [hit(6, { noShield: 1.5 }), { k: 'delay', secs: 0.5 }]),
  }),
  def('heavy', 'burst', {
    '': N('ทุบหนัก', 7.5, [hit(12, { pierce: 0.5 })]),
    a: N('ค้อนทลาย', 8, [hit(17, { pierce: 1 })], 'ทลายโล่'),
    a1: N('ค้อนพิฆาต', 8, [hit(34, { pierce: 1 })]),
    a2: N('ค้อนสะท้าน', 8, [hit(18, { pierce: 1 }), { k: 'freeze', secs: 1 }]),
    b: N('ทุบสั่น', 6, [hit(10, { pierce: 0.5 }), { k: 'slow', pct: 0.2, secs: 3 }], 'ตีแล้วคุม'),
    b1: N('ทุบถ่วง', 6, [hit(12, { pierce: 0.5 }), { k: 'delay', secs: 1 }]),
    b2: N('ทุบคู่', 6, [hit(10, { pierce: 0.5, times: 2 })]),
  }),
  def('charge', 'burst', {
    '': N('รวมพลัง', 5, [{ k: 'charge', mult: 1.7 }]),
    a: N('รวมพลังใหญ่', 6, [{ k: 'charge', mult: 2.2 }], 'ตีทีเดียวแรงมาก'),
    a1: N('ทุ่มสุดตัว', 7, [{ k: 'charge', mult: 3.3 }]),
    a2: N('พลังเดือด', 6, [{ k: 'charge', mult: 2.2 }, { k: 'grow', n: 1 }]),
    b: N('รวมพลังเร็ว', 3.5, [{ k: 'charge', mult: 1.5 }], 'ใช้บ่อย'),
    b1: N('ต่อเนื่อง', 2.5, [{ k: 'charge', mult: 1.5 }]),
    b2: N('สองจังหวะ', 3.5, [{ k: 'charge', mult: 1.5, hits: 2 }]),
  }),
  // ======================= tank =======================
  def('shield', 'tank', {
    '': N('ยกโล่', 6, [{ k: 'shield', n: 6 }, hit(3)]),
    a: N('ป้อมโล่', 7, [{ k: 'shield', n: 10 }, hit(4)], 'กำแพง'),
    a1: N('กำแพงเหล็ก', 7, [{ k: 'shield', n: 15 }, hit(5)]),
    a2: N('โล่หนาม', 7, [{ k: 'shield', n: 10 }, { k: 'thorns', n: 2 }, hit(5)]),
    b: N('โล่ตอบโต้', 6, [{ k: 'shield', n: 6 }, hit(0, { shieldPct: 0.5 })], 'โล่เป็นดาเมจ'),
    b1: N('โล่กระแทกกลับ', 6, [{ k: 'shield', n: 6 }, hit(0, { shieldPct: 1 })]),
    b2: N('โล่ฟื้นฟู', 6, [{ k: 'shield', n: 6 }, hit(0, { shieldPct: 0.5 }), { k: 'heal', n: 4 }]),
  }),
  def('thorns', 'tank', {
    '': N('เกราะหนาม', 7, [{ k: 'thorns', n: 2 }, hit(3)]),
    a: N('หนามแหลม', 7, [{ k: 'thorns', n: 4 }, hit(4)], 'สะท้อนแรง'),
    a1: N('หนามพิษ', 7, [{ k: 'thorns', n: 6 }, hit(5)]),
    a2: N('หนามขัดขวาง', 7, [{ k: 'thorns', n: 4, heal: 0.25 }, hit(5)]),
    b: N('หนามถาวร', 9, [{ k: 'thorns', n: 2, perm: true }], 'สะสมถาวร'),
    b1: N('ดงหนาม', 9, [{ k: 'thorns', n: 3, perm: true }]),
    b2: N('หนามหุ้มเกราะ', 9, [{ k: 'thorns', n: 2, perm: true }, { k: 'shield', n: 3 }]),
  }),
  def('stoneskin', 'tank', {
    '': N('ผิวหิน', 7, [{ k: 'shield', n: 2 }, { k: 'heal', n: 3 }, hit(3)]),
    a: N('หินฟื้น', 7, [{ k: 'heal', n: 6 }, hit(4)], 'ฟื้นเลือด'),
    a1: N('หินชีวิต', 7, [{ k: 'heal', n: 9 }, hit(5)]),
    a2: N('หินบริสุทธิ์', 7, [{ k: 'heal', n: 6 }, { k: 'cleanse', n: 1 }, hit(5)]),
    b: N('หินแกร่ง', 7, [{ k: 'shield', n: 6 }, hit(4)], 'เกราะ'),
    b1: N('หินผา', 7, [{ k: 'shield', n: 8 }, { k: 'steadfast' }, hit(5)]),
    b2: N('หินพุ่ง', 7, [{ k: 'shield', n: 6 }, hit(6)]),
  }),
  def('cleanse', 'tank', {
    '': N('ชำระล้าง', 6, [{ k: 'cleanse', n: 1 }, { k: 'shield', n: 1 }, hit(3)]),
    a: N('ล้างพิษ', 6, [{ k: 'cleanse', n: 2 }, { k: 'heal', n: 3 }, hit(4)], 'กันไฟ/การคุม'),
    a1: N('ล้างทั้งหมด', 6, [{ k: 'cleanse', n: 99 }, { k: 'heal', n: 5 }, hit(5)]),
    a2: N('ล้างแล้วแกร่ง', 6, [{ k: 'cleanse', n: 2 }, { k: 'steadfast' }]),
    b: N('ล้างแล้วตอบโต้', 6, [{ k: 'cleanse', n: 1 }, hit(4, { perRemoved: 3 })], 'ลงโทษดีบัฟ'),
    b1: N('ล้างพิฆาต', 6, [{ k: 'cleanse', n: 1 }, hit(5, { perRemoved: 5 })]),
    b2: N('ล้างหนาม', 6, [{ k: 'cleanse', n: 1 }, { k: 'thorns', n: 2 }, hit(5)]),
  }),
  // ======================= scaling =======================
  def('train', 'scaling', {
    '': N('ฝึกฝน', 6, [{ k: 'grow', n: 1 }, hit(2)]),
    a: N('ฝึกหนัก', 6.5, [{ k: 'grow', n: 3 }, hit(1)], 'พลังก้อนใหญ่'),
    a1: N('ฝึกสุดขีด', 6.5, [{ k: 'grow', n: 3 }, hit(2)]),
    a2: N('ฝึกต่อสู้', 6.5, [{ k: 'grow', n: 3 }, hit(3)]),
    b: N('ฝึกเร็ว', 3.5, [{ k: 'grow', n: 1 }, hit(1)], 'พลังถี่'),
    b1: N('ฝึกไม่หยุด', 3, [{ k: 'grow', n: 1 }, hit(1)]),
    b2: N('ซ้อมจริง', 3.5, [{ k: 'grow', n: 1 }, hit(2)]),
  }),
  def('ignite', 'scaling', {
    '': N('จุดไฟ', 5.5, [{ k: 'burn', dps: 2, secs: 4 }]),
    a: N('ไฟลุก', 5.5, [{ k: 'burn', dps: 3, secs: 6 }], 'ไฟแรง'),
    a1: N('ไฟนรก', 5.5, [{ k: 'burn', dps: 4, secs: 6 }]),
    a2: N('ไฟโหม', 5.5, [{ k: 'burn', dps: 3, secs: 6, growthHalf: true }]),
    b: N('ไฟยาว', 5.5, [{ k: 'burn', dps: 2, secs: 10 }], 'ไฟนาน'),
    b1: N('ไฟไม่ดับ', 5.5, [{ k: 'burn', dps: 2, secs: 14 }]),
    b2: N('ไฟเย็น', 5.5, [{ k: 'burn', dps: 2, secs: 10 }, { k: 'slow', pct: 0.15, secs: 3 }]),
  }),
  def('feast', 'scaling', {
    '': N('กินฟื้นแรง', 5.5, [{ k: 'heal', n: 4 }, { k: 'grow', n: 1 }]),
    a: N('กินอิ่ม', 5.5, [{ k: 'heal', n: 6 }, { k: 'grow', n: 1 }], 'อยู่รอด'),
    a1: N('งานเลี้ยง', 5.5, [{ k: 'heal', n: 8 }, { k: 'grow', n: 1 }]),
    a2: N('กินแล้วแกร่ง', 5.5, [{ k: 'heal', n: 6 }, { k: 'grow', n: 1 }, { k: 'shield', n: 4 }]),
    b: N('กินโต', 5.5, [{ k: 'heal', n: 2 }, { k: 'grow', n: 2 }], 'โตเร็ว'),
    b1: N('กินไม่หยุด', 5.5, [{ k: 'heal', n: 2 }, { k: 'grow', n: 3 }]),
    b2: N('กินเลือด', 5.5, [{ k: 'heal', n: 2 }, { k: 'grow', n: 2 }, { k: 'leech', pct: 0.5 }]),
  }),
  def('amplify', 'scaling', {
    '': N('ขยายพลัง', 7, [{ k: 'amplify', cap: 4 }]),
    a: N('ขยายใหญ่', 7, [{ k: 'amplify', cap: 8 }], 'ระเบิดช่วงท้าย'),
    a1: N('ทวีคูณ', 7, [{ k: 'amplify', cap: 14 }]),
    a2: N('ขยายรวมพลัง', 7, [{ k: 'amplify', cap: 8 }, { k: 'charge', mult: 1.3 }]),
    b: N('ขยายเร็ว', 4.5, [{ k: 'amplify', cap: 3 }], 'สม่ำเสมอ'),
    b1: N('ขยายถี่', 4, [{ k: 'amplify', cap: 3 }]),
    b2: N('ขยายแล้วโต', 4.5, [{ k: 'amplify', cap: 3 }, { k: 'grow', n: 1 }]),
  }),
  // ======================= control =======================
  def('frost', 'control', {
    '': N('ลูกน้ำแข็ง', 5, [hit(5), { k: 'freeze', secs: 1.2 }]),
    a: N('แช่ยาว', 5, [hit(5), { k: 'freeze', secs: 2 }], 'ล็อกศัตรู'),
    a1: N('ยุคน้ำแข็ง', 5, [hit(6), { k: 'freeze', secs: 2.5 }]),
    a2: N('หนาวสะท้าน', 5, [hit(5), { k: 'freeze', secs: 2 }, { k: 'slow', pct: 0.2, secs: 3 }]),
    b: N('น้ำแข็งคม', 5, [hit(8), { k: 'freeze', secs: 1 }], 'ดาเมจ'),
    b1: N('หอกน้ำแข็ง', 5, [hit(11), { k: 'freeze', secs: 1 }]),
    b2: N('ลูกเห็บ', 5, [hit(4, { times: 2 }), { k: 'freeze', secs: 0.7 }]),
  }),
  def('chill', 'control', {
    '': N('ลมหนาว', 7, [hit(2), { k: 'slow', pct: 0.35, secs: 3 }]),
    a: N('พายุหิมะ', 7, [hit(3), { k: 'slow', pct: 0.4, secs: 3 }], 'ช้ามาก'),
    a1: N('ลมเยือกแข็ง', 7, [hit(3), { k: 'slow', pct: 0.45, secs: 3 }]),
    a2: N('พายุมีด', 7, [hit(4, { ifSlowed: true }), { k: 'slow', pct: 0.4, secs: 3 }]),
    b: N('ลมเย็นยาว', 7, [hit(3), { k: 'slow', pct: 0.25, secs: 5 }], 'ช้านาน'),
    b1: N('หนาวนิรันดร์', 7, [hit(3), { k: 'slow', pct: 0.25, secs: 7 }]),
    b2: N('ลมร้อนเย็น', 7, [hit(3), { k: 'slow', pct: 0.25, secs: 5 }, { k: 'burn', dps: 1, secs: 5 }]),
  }),
  def('dispel', 'control', {
    '': N('สลายเวท', 6, [{ k: 'dispel', n: 1 }, hit(4)]),
    a: N('สลายใหญ่', 6, [{ k: 'dispel', n: 2, shield: 0.3 }, hit(3)], 'ล้างบัฟ'),
    a1: N('สลายสิ้น', 6, [{ k: 'dispel', n: 3 }, hit(3)]),
    a2: N('ทลายโล่', 6, [{ k: 'dispel', n: 2, shield: 0.4 }, hit(3)]),
    b: N('สลายแล้วตี', 6, [{ k: 'dispel', n: 1 }, hit(2, { perRemoved: 2 })], 'ลงโทษบัฟ'),
    b1: N('สลายพิฆาต', 6, [{ k: 'dispel', n: 1 }, hit(2, { perRemoved: 3 })]),
    b2: N('ขโมยพลัง', 6, [{ k: 'dispel', n: 1, steal: true }, hit(3)]),
  }),
  def('ironwill', 'none', {
    '': N('ใจเหล็ก', 8, [{ k: 'steadfast' }, { k: 'shield', n: 2 }]),
    a: N('เหล็กกล้า', 8, [{ k: 'steadfast', keep: 0.2 }, { k: 'shield', n: 2 }], 'กันการคุม'),
    a1: N('ไร้ผล', 8, [{ k: 'steadfast', keep: 0.2, ignoreFreeze: true }, { k: 'shield', n: 2 }]),
    a2: N('เหล็กบริสุทธิ์', 8, [{ k: 'steadfast', keep: 0.2 }, { k: 'cleanse', n: 1 }]),
    b: N('ใจสู้', 8, [{ k: 'steadfast' }, { k: 'grow', n: 1 }], 'สู้ต่อ'),
    b1: N('ใจเพลิง', 8, [{ k: 'steadfast' }, { k: 'grow', n: 2 }]),
    b2: N('ใจกล้า', 8, [{ k: 'steadfast' }, hit(4)]),
  }),
  // ======================= engines (fire the blocks they touch) =======================
  def('gear', 'none', {
    '': E('ฟันเฟือง', 1.5, { kind: 'gear', power: 0.3 }),
    a: E('เฟืองหนัก', 1.5, { kind: 'gear', power: 0.4 }, [], 'แรงขึ้น'),
    a1: E('เฟืองเหล็ก', 1.5, { kind: 'gear', power: 0.5 }),
    a2: E('เฟืองโล่', 1.5, { kind: 'gear', power: 0.4 }, [{ k: 'shield', n: 1 }]),
    b: E('เฟืองไว', 1.1, { kind: 'gear', power: 0.3 }, [], 'ถี่ขึ้น'),
    b1: E('เฟืองพายุ', 0.8, { kind: 'gear', power: 0.3 }),
    b2: E('เฟืองคู่', 1.1, { kind: 'gear', power: 0.3, n: 2 }),
  }),
  def('overclock', 'none', {
    '': E('เร่งเครื่อง', 5, { kind: 'overclock', power: 0.8 }),
    a: E('เร่งแรง', 5.5, { kind: 'overclock', power: 1 }, [], 'แรงขึ้น'),
    a1: E('เร่งสุดขีด', 5.5, { kind: 'overclock', power: 1.2 }),
    a2: E('เร่งแล้วตั้งรับ', 5.5, { kind: 'overclock', power: 1 }, [{ k: 'shield', n: 3 }]),
    b: E('เร่งไว', 4, { kind: 'overclock', power: 0.7 }, [], 'ถี่ขึ้น'),
    b1: E('เร่งถี่', 3.2, { kind: 'overclock', power: 0.7 }),
    b2: E('เร่งต่อเนื่อง', 4, { kind: 'overclock', power: 0.7, keep: true }),
  }),
  // ======================= hero uniques =======================
  def('bulwark', 'tank', {
    '': N('โล่กระแทก', 6, [hit(5, { shieldPct: 1 })]),
    a: N('ปะทะ', 6, [hit(6, { shieldPct: 1.3 })], 'โล่เป็นดาเมจ'),
    a1: N('ทลายด้วยโล่', 6, [hit(7, { shieldPct: 1.7 })]),
    a2: N('โล่สะท้าน', 6, [hit(7, { shieldPct: 1.3 }), { k: 'freeze', secs: 0.5 }]),
    b: N('ปะทะแล้วตั้งรับ', 6, [hit(6, { shieldPct: 0.8 }), { k: 'shield', n: 3 }], 'วนโล่'),
    b1: N('ตั้งรับเต็มที่', 6, [hit(7, { shieldPct: 0.8 }), { k: 'shield', n: 6 }]),
    b2: N('ปะทะฟื้น', 6, [hit(7, { shieldPct: 0.8 }), { k: 'shield', n: 3 }, { k: 'heal', n: 4 }]),
  }, 'knight'),
  def('spikewall', 'tank', {
    '': N('ป้อมหนาม', 5.5, [hit(3, { thornsX: 3 })]),
    a: N('ระเบิดหนาม', 5.5, [hit(3, { thornsX: 3 })], 'แปลงหนามเป็นดาเมจ'),
    a1: N('หนามพุ่ง', 5.5, [hit(3, { thornsX: 3.5 })]),
    a2: N('หนามล้อม', 5.5, [hit(3, { thornsX: 3 }), { k: 'shield', n: 4 }]),
    b: N('ปลูกหนาม', 5.5, [hit(3, { thornsX: 2 }), { k: 'thorns', n: 1 }], 'สะสมหนาม'),
    b1: N('สวนหนาม', 5.5, [hit(3, { thornsX: 2 }), { k: 'thorns', n: 2 }]),
    b2: N('หนามฟื้น', 5.5, [hit(3, { thornsX: 2 }), { k: 'thorns', n: 1 }, { k: 'heal', n: 3 }]),
  }, 'thornguard'),
  def('execute', 'burst', {
    '': N('ปลิดชีพ', 5, [hit(7, { exec: [0.5, 1.6] })]),
    a: N('ประหาร', 5, [hit(8, { exec: [0.5, 1.8], maxHpPct: 0.02 })], 'ปิดเกม'),
    a1: N('เพชฌฆาต', 5, [hit(8, { exec: [0.35, 2.2], maxHpPct: 0.04 })]),
    a2: N('ประหารทะลุ', 5, [hit(9, { exec: [0.5, 1.8], pierce: 1, maxHpPct: 0.02 })]),
    b: N('เชือดเร็ว', 4, [hit(5, { exec: [0.5, 1.5], maxHpPct: 0.02 })], 'ใช้บ่อย'),
    b1: N('เชือดไว', 3.5, [hit(5, { exec: [0.5, 1.5], maxHpPct: 0.02 })]),
    b2: N('เชือดดูดเลือด', 4, [hit(5, { exec: [0.5, 1.5], leech: 0.3, maxHpPct: 0.02 })]),
  }, 'assassin'),
  def('flurry', 'burst', {
    '': N('พายุดาบ', 5, [hit(2, { times: 3 })]),
    a: N('พายุคม', 5, [hit(2, { times: 4 })], 'ตีรัวขึ้น'),
    a1: N('พายุพันดาบ', 5, [hit(2, { times: 6 })]),
    a2: N('ดาบเพลิง', 5, [hit(2, { times: 5, burn: [1, 2] })]),
    b: N('ดาบหนัก', 5, [hit(3, { times: 3 })], 'ตีน้อยแต่แรง'),
    b1: N('ดาบทลาย', 5, [hit(5, { times: 3 })]),
    b2: N('ดาบถ่วง', 5, [hit(3, { times: 3 }), { k: 'delay', secs: 0.3 }]),
  }, 'duelist'),
  def('rampage', 'scaling', {
    '': N('คลั่ง', 7.5, [hit(2, { times: 2 })]),
    a: N('คลั่งรัว', 7.5, [hit(2, { times: 3 })], 'ตีหลายครั้ง'),
    a1: N('บ้าคลั่ง', 7.5, [hit(2, { times: 4 })]),
    a2: N('คลั่งโต', 7.5, [hit(2, { times: 3 }), { k: 'grow', n: 1 }]),
    b: N('คลั่งหนัก', 7.5, [hit(4, { times: 2 })], 'ตีแรง'),
    b1: N('คลั่งทลาย', 7.5, [hit(5, { times: 2 })]),
    b2: N('คลั่งเลือด', 7.5, [hit(4, { times: 2, leech: 0.2 })]),
  }, 'berserker'),
  def('inferno', 'scaling', {
    '': N('ระเบิดเพลิง', 6, [hit(2, { burnPct: 0.5, pierce: 1 })]),
    a: N('ระเบิดใหญ่', 6, [hit(2, { burnPct: 0.7, pierce: 1 })], 'จุดระเบิดไฟที่สะสม'),
    a1: N('ระเบิดมหันต์', 6, [hit(2, { burnPct: 0.9, pierce: 1 })]),
    a2: N('ระเบิดลุกลาม', 6, [hit(2, { burnPct: 0.7, pierce: 1 }), { k: 'burn', dps: 2, secs: 6 }]),
    b: N('จุดระเบิด', 6, [hit(2, { burnPct: 0.5, pierce: 1 }), { k: 'burn', dps: 1.5, secs: 6 }], 'สะสมไฟ'),
    b1: N('ระเบิดลาวา', 6, [hit(2, { burnPct: 0.5, pierce: 1 }), { k: 'burn', dps: 3, secs: 6 }]),
    b2: N('ระเบิดควัน', 6, [hit(2, { burnPct: 0.5, pierce: 1 }), { k: 'burn', dps: 2, secs: 6 }, { k: 'slow', pct: 0.2, secs: 3 }]),
  }, 'pyro'),
  def('shatter', 'control', {
    '': N('ทุบน้ำแข็ง', 4.5, [hit(5, { pierce: 0.5, frozen: 1.8 })]),
    a: N('ทุบแตก', 4.5, [hit(5, { pierce: 0.5, frozen: 2.5 })], 'คอมโบแช่แข็ง'),
    a1: N('ทุบแหลก', 4.5, [hit(8, { pierce: 1, frozen: 3.5 })]),
    a2: N('ทุบแล้วแช่', 4.5, [hit(7, { pierce: 1, frozen: 3 }), { k: 'freeze', secs: 0.5 }]),
    b: N('ทุบตรง', 4.5, [hit(7, { pierce: 0.5, frozen: 2 })], 'ไม่ต้องรอคอมโบ'),
    b1: N('ทุบทะลวง', 4.5, [hit(9, { pierce: 1, frozen: 2 })]),
    b2: N('ทุบเย็น', 4.5, [hit(7, { pierce: 1, frozen: 2 }), { k: 'slow', pct: 0.2, secs: 3 }]),
  }, 'witch'),
  def('timewarp', 'control', {
    '': N('บิดเวลา', 5, [hit(10), { k: 'delay', secs: 1.25 }]),
    a: N('ย้อนเวลา', 5, [hit(9), { k: 'delay', secs: 1.6 }], 'ล็อกเวลา'),
    a1: N('หยุดกาล', 5, [hit(10), { k: 'delay', secs: 1.75 }]),
    a2: N('ย้อนแล้วช้า', 5, [hit(9), { k: 'delay', secs: 1.6 }, { k: 'slow', pct: 0.2, secs: 3 }]),
    b: N('เวลาคม', 5, [hit(11), { k: 'delay', secs: 1 }], 'ดาเมจ'),
    b1: N('ตัดเวลา', 5, [hit(13), { k: 'delay', secs: 1 }]),
    b2: N('เวลาแข็ง', 5, [hit(11), { k: 'delay', secs: 1 }, { k: 'freeze', secs: 0.5 }]),
  }, 'chrono'),
];

export const SKILLS: Record<string, SkillDef> = Object.fromEntries(SKILL_LIST.map((d) => [d.id, d]));

/** The variant an equipped skill uses. */
export const nodeOf = (k: Pick<SkillInstance, 'id' | 'v'>): SkillNode => SKILLS[k.id].tree[k.v as Variant] ?? SKILLS[k.id].tree[''];

/** True if the variant deals direct hits (used by bots and the explanation). */
export const hits = (node: SkillNode) => node.fx.some((e) => e.k === 'hit');

/** True if the variant fires early when its owner is controlled (it has ✨ ชำระ or 🗿 ใจเหล็ก). */
export const reacts = (node: SkillNode) => node.fx.some((e) => e.k === 'cleanse' || e.k === 'steadfast');

/** True for engine skills (ฟันเฟือง, เร่งเครื่อง): they fire the blocks they touch. */
export const isEngine = (id: string) => Object.values(SKILLS[id]?.tree ?? {}).some((n) => !!n.engine);

export const ARCH_NAME: Record<Archetype | 'none', string> = {
  tank: 'ถึก',
  burst: 'ดาเมจ',
  scaling: 'โตไม่หยุด',
  control: 'ควบคุม',
  none: 'ทั่วไป',
};

// ---------------- icon + number chips for the UI ----------------

export interface Chip {
  kw: Keyword;
  text: string;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const sec = (t: number) => `${+t.toFixed(2)}s`;

/** Effect list → icon chips, e.g. [⚔4 ×2] [🔥2 6s]. The cooldown chip comes last. */
export function chipsOf(node: SkillNode, cdTicks = node.cd): Chip[] {
  const out: Chip[] = [];
  for (const e of node.fx) {
    switch (e.k) {
      case 'hit': {
        const parts: string[] = [];
        if (e.n > 0) parts.push(String(e.n));
        if (e.shieldPct) parts.push(`${pct(e.shieldPct)}🛡`);
        if (e.thornsX) parts.push(`🌵×${e.thornsX}`);
        if (e.burnPct) parts.push(`${pct(e.burnPct)}🔥`);
        if (e.maxHpPct) parts.push(`${pct(e.maxHpPct)}${L('เลือดศัตรู', ' enemy HP')}`);
        if (e.perRemoved) parts.push(`${e.perRemoved}/${L('อย่าง', 'each')}`);
        out.push({ kw: 'hit', text: `⚔${parts.join('+')}${e.times && e.times > 1 ? ` ×${e.times}` : ''}${e.ifSlowed ? L(' (ถ้าช้า)', ' (if slowed)') : ''}` });
        if (e.pierce) out.push({ kw: 'pierce', text: e.pierce >= 1 ? '🗡' : `🗡${pct(e.pierce)}` });
        if (e.exec) out.push({ kw: 'exec', text: `🎯<${pct(e.exec[0])} ×${e.exec[1]}` });
        if (e.frozen) out.push({ kw: 'shatter', text: `🧊×${e.frozen}` });
        if (e.noShield) out.push({ kw: 'hit', text: `${L('ไร้โล่', 'no shield')} ×${e.noShield}` });
        if (e.leech) out.push({ kw: 'leech', text: `🩸${pct(e.leech)}` });
        if (e.burn) out.push({ kw: 'burn', text: `🔥${e.burn[0]} ${sec(e.burn[1])}/${L('ครั้ง', 'hit')}` });
        break;
      }
      case 'shield': out.push({ kw: 'shield', text: `🛡${e.n}` }); break;
      case 'heal': out.push({ kw: 'heal', text: `❤${e.n}` }); break;
      case 'burn': out.push({ kw: 'burn', text: `🔥${e.dps}${e.growthHalf ? '+½💪' : ''} ${sec(e.secs)}` }); break;
      case 'freeze': out.push({ kw: 'freeze', text: `❄${sec(e.secs)}` }); break;
      case 'slow': out.push({ kw: 'slow', text: `🐌${pct(e.pct)} ${sec(e.secs)}` }); break;
      case 'delay': out.push({ kw: 'delay', text: `⏪${sec(e.secs)}` }); break;
      case 'grow': out.push({ kw: 'grow', text: `💪+${e.n}` }); break;
      case 'charge': out.push({ kw: 'charge', text: `⚡×${e.mult}${e.hits && e.hits > 1 ? ` (${e.hits} ${L('ครั้ง', 'hits')})` : ''}` }); break;
      case 'thorns': out.push({ kw: 'thorns', text: `🌵${e.n}${e.perm ? L(' ถาวร', ' permanent') : ''}${e.heal !== undefined ? ` ${L('ศัตรูฟื้น', 'enemy heals')} ${pct(e.heal)}` : ''}` }); break;
      case 'steadfast': out.push({ kw: 'steadfast', text: `🗿${e.keep !== undefined && e.keep < 0.4 ? ' 80%' : ''}${e.ignoreFreeze ? L(' +กันแช่แข็ง 1 ครั้ง', ' +blocks 1 freeze') : ''}` }); break;
      case 'cleanse': out.push({ kw: 'cleanse', text: e.n >= 99 ? `✨${L('ทั้งหมด', 'all')}` : e.n > 1 ? `✨×${e.n}` : '✨' }); break;
      case 'dispel': out.push({ kw: 'dispel', text: `${e.n >= 99 ? `💥${L('ทั้งหมด', 'all')}` : e.n > 1 ? `💥×${e.n}` : '💥'}${e.shield !== undefined ? ` ${L('โล่', 'shield ')}${pct(e.shield)}` : ''}${e.steal ? L(' ขโมยพลัง', ' steals power') : ''}` }); break;
      case 'amplify': out.push({ kw: 'amplify', text: `✖2 ≤${e.cap}` }); break;
      case 'leech': out.push({ kw: 'leech', text: `🩸${pct(e.pct)} ${L('ครั้งถัดไป', 'next hit')}` }); break;
    }
  }
  const en = node.engine;
  if (en) {
    if (en.kind === 'gear') out.unshift({ kw: 'gear', text: `⚙${en.n && en.n > 1 ? `×${en.n}` : ''} ${pct(en.power)}` });
    else out.unshift({ kw: 'overclock', text: `🚀 ${pct(en.power)}${en.keep ? L(' ไม่รีเซ็ต', ' no reset') : ''}` });
  }
  out.push({ kw: 'cd', text: `⏱${(cdTicks / 10).toFixed(1)}` });
  return out;
}
