import { T, onTuning } from './tuning';
import type { Line, SkillInstance } from './types';

/**
 * Skills are data. Each skill has a tree: Lv1 (variant ''), two Lv2 variants ('a', 'b') and two Lv3 variants under
 * each ('a1', 'a2', 'b1', 'b2'). A variant is a cooldown plus a list of effects. The combat engine runs the effects
 * (execNode) and the UI turns them into icon + number chips (keyword tooltips explain each icon).
 */

// ---------------- keywords (icons the UI shows; tooltips explain them) ----------------

export type Keyword =
  | 'hit' | 'pierce' | 'shield' | 'heal' | 'leech' | 'burn' | 'freeze' | 'slow' | 'delay' | 'grow' | 'charge'
  | 'thorns' | 'steadfast' | 'cleanse' | 'dispel' | 'exec' | 'shatter' | 'gear' | 'overclock' | 'cd'
  | 'dodge' | 'poison' | 'haste' | 'wound' | 'sure';

export const KEYWORDS: Record<Keyword, { icon: string; name: string; desc: string }> = {
  hit: { icon: '⚔', name: 'ตี', desc: 'ทำดาเมจใส่ศัตรู (+พลังที่สะสม) · ×N = ตี N ครั้ง' },
  pierce: { icon: '🗡', name: 'ทะลุ', desc: 'ไม่สนโล่ของศัตรู (🗡50% = ไม่สนครึ่งหนึ่ง)' },
  shield: { icon: '🛡', name: 'โล่', desc: 'โล่รับดาเมจแทนเลือด อยู่จนกว่าจะแตก' },
  heal: { icon: '❤', name: 'ฟื้น', desc: 'ฟื้นเลือดตัวเอง' },
  leech: { icon: '🩸', name: 'ดูดเลือด', desc: 'ฟื้นเลือดตามสัดส่วนของดาเมจที่ทำ' },
  burn: { icon: '🔥', name: 'ไฟ', desc: `ศัตรูเสียเลือด X ต่อวินาที นาน N วิ · ไม่สนโล่ และเผาโล่ทิ้งวิละเท่าไฟ · ซ้อนกันได้ · ระหว่างติดไฟ ได้โล่น้อยลง ${Math.round((1 - T['burn.shield']) * 100)}%` },
  freeze: { icon: '❄', name: 'แช่แข็ง', desc: 'skill ทุกตัวของศัตรูหยุดนับคูลดาวน์ · โดนถี่ๆ ผลลดลง · มีเพดานต่อการสู้ · หลุดแช่แข็งแล้วต้านการคุมได้ 1.5 วิ' },
  slow: { icon: '🐌', name: 'ช้า', desc: 'คูลดาวน์ทุกตัวของศัตรูเดินช้าลง X% · มีเพดานต่อการสู้' },
  delay: { icon: '⏪', name: 'ถ่วงเวลา', desc: 'ดึงคูลดาวน์ทุกตัวของศัตรูถอยหลัง N วิ · ใช้เพดานร่วมกับแช่แข็ง · โดนแล้วต้านการคุมได้ 1.5 วิ' },
  grow: { icon: '💪', name: 'พลัง', desc: 'ทุกการตีของทุก skill ทำดาเมจเพิ่ม +X จนจบการสู้' },
  charge: { icon: '⚡', name: 'รวมพลัง', desc: `การตีครั้งถัดไปของคุณ (skill ไหนก็ได้) ที่ตีแรง ${T['charge.min']} ขึ้นไป แรง ×N (ตีเบากว่านั้นไม่ใช้รวมพลัง)` },
  thorns: { icon: '🌵', name: 'หนาม', desc: 'ทุกครั้งที่โดนตี สะท้อนดาเมจเท่าหนาม (ไม่เกิน 75% ของดาเมจที่โดน) · ระหว่างมีหนาม ศัตรูฟื้นเลือดได้ครึ่งเดียว' },
  dodge: { icon: '💨', name: 'หลบ', desc: `ได้แต้มหลบ (เก็บได้ 1 · ฮีโร่สายหลบเก็บได้ 2) · การตีครั้งถัดไปที่โดนแค่เฉียด: เข้าแค่ ${Math.round(T['dodge.graze'] * 100)}% ไม่ติดผลเสริม ใช้ 1 แต้ม (ไม่สุ่ม) · ไฟ พิษ หนาม และความเหนื่อยล้าหลบไม่ได้ · การตีที่มี 👁 ไม่พลาด · หลบการตีของ skill ที่แช่แข็ง/ถ่วงเวลา = การคุมนั้นไม่ติดด้วย` },
  poison: { icon: '☠', name: 'พิษ', desc: `ศัตรูเสียเลือด X ต่อวินาที นาน N วิ · ไม่สนโล่ หลบไม่ได้ · ซ้อนกันได้ · เบากว่าไฟแต่นานกว่า · ระหว่างติดพิษ ฟื้นเลือดได้น้อยลง ${Math.round((1 - T['poison.heal']) * 100)}% และได้โล่น้อยลง ${Math.round((1 - T['burn.shield']) * 100)}%` },
  haste: { icon: '⏩', name: 'เร่ง', desc: 'คูลดาวน์ทุกตัวของคุณเดินเร็วขึ้น X% นาน N วิ' },
  wound: { icon: '🩹', name: 'แผลลึก', desc: 'ศัตรูฟื้นเลือดได้น้อยลง X% นาน N วิ' },
  sure: { icon: '👁', name: 'ไม่พลาด', desc: 'การตีนี้หลบไม่ได้ (ไม่ใช้แต้มหลบของศัตรู)' },
  steadfast: { icon: '🗿', name: 'ใจเหล็ก', desc: 'แช่แข็ง ช้า และถ่วงเวลาที่คุณโดน อ่อนลง 60% จนจบการสู้ · skill ที่มี 🗿 ทำงานทันทีเมื่อคุณโดนคุม (1 ครั้งต่อคูลดาวน์)' },
  cleanse: { icon: '✨', name: 'ชำระ', desc: 'ลบดีบัฟบนตัวคุณ: ไฟหรือพิษ (กองแรงสุด) ความช้า การแช่แข็ง แผลลึก · skill ที่มี ✨ ทำงานทันทีเมื่อคุณโดนคุม (1 ครั้งต่อคูลดาวน์)' },
  dispel: { icon: '💥', name: 'สลาย', desc: 'ลบบัฟของศัตรูอย่างละ 1: พลัง หนาม รวมพลัง ใจเหล็ก และโล่ 20%' },
  exec: { icon: '🎯', name: 'ประหาร', desc: 'แรงขึ้นเมื่อศัตรูเลือดต่ำกว่าที่กำหนด' },
  shatter: { icon: '🧊', name: 'ทุบน้ำแข็ง', desc: 'แรงขึ้นเมื่อศัตรูกำลังถูกแช่แข็ง' },
  gear: { icon: '⚙', name: 'ฟันเฟือง', desc: 'ทุกครั้งที่ทำงาน สั่ง skill ข้างบนหรือข้างล่างให้ทำงานทันที สลับกันทีละตัว ที่แรงตาม % · คูลดาวน์ของตัวนั้นเดินต่อตามปกติ · อยู่ขอบ list = สั่งตัวเดียวถี่ขึ้น' },
  overclock: { icon: '🚀', name: 'เร่งเครื่อง', desc: 'สั่ง skill ข้างบนและข้างล่างให้ทำงานพร้อมกันทันที ที่แรงตาม % · แล้วคูลดาวน์ของสองตัวนั้นเริ่มนับใหม่ (คุ้มกับ skill คูลดาวน์ยาว)' },
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
      /** only if the enemy was already slowed */
      ifSlowed?: boolean;
      /** heal this share of the damage dealt */
      leech?: number;
      /** each hit also burns [dps, secs] */
      burn?: [number, number];
      /** each hit also poisons [dps, secs] */
      poison?: [number, number];
      /** + this much per burn stack on the enemy */
      perBurn?: number;
      /** + this share of the poison damage still to come on the enemy */
      poisonPct?: number;
      /** + this much per dodge charge you hold */
      perDodge?: number;
      /** cannot be dodged */
      sure?: boolean;
      /** + this much per debuff removed / buff removed by an earlier cleanse / dispel in the same cast */
      perRemoved?: number;
    }
  | { k: 'shield'; n: number }
  | { k: 'heal'; n: number }
  | { k: 'burn'; dps: number; secs: number; /** + half your พลัง per second */ growthHalf?: boolean; /** this many separate stacks */ stacks?: number }
  | { k: 'poison'; dps: number; secs: number; /** this many separate stacks */ stacks?: number }
  | { k: 'dodge'; n: number }
  | { k: 'haste'; pct: number; secs: number }
  | { k: 'wound'; pct: number; secs: number }
  | { k: 'freeze'; secs: number }
  | { k: 'slow'; pct: number; secs: number }
  | { k: 'delay'; secs: number }
  | { k: 'grow'; n: number }
  | { k: 'charge'; mult: number; /** the multiplier lasts this many hits */ hits?: number }
  | { k: 'thorns'; n: number; /** never wears off */ perm?: boolean; /** enemy healing multiplier while you have thorns (default 0.5) */ heal?: number }
  | { k: 'steadfast'; /** share of control that still lands (default 0.4) */ keep?: number; /** the next freeze on you is ignored */ ignoreFreeze?: boolean }
  | { k: 'cleanse'; /** how many burn / poison stacks (99 = all); slow, freeze and wound always go */ n: number; /** only burn / poison (blows DoT away, can't thaw ice; does not react to control) */ dot?: boolean; /** all stacks when it is a line piece of its owner (ถนัดสาย) */ lineAll?: boolean }
  | { k: 'dispel'; /** how many of each buff (99 = all) */ n: number; /** share of the enemy shield removed (default 0.2) */ shield?: number; /** you gain the พลัง removed */ steal?: boolean }
  | { k: 'leech'; /** your next hit heals this share of its damage */ pct: number };

/**
 * Engine: fires the skills right above / below it in the list (combat.ts). Those fires count as "set off" (ต่อ):
 * a skill can be set off at most once per TRIGGER_GAP, and control they carry is scaled by the power.
 * gear = n neighbours per fire, taking turns (above, below, above…); their cooldowns keep running
 * overclock = both neighbours fire now; their cooldowns restart unless keep
 */
export interface Engine {
  kind: 'gear' | 'overclock';
  /** power of the fires it causes (1 = full) */
  power: number;
  /** gear: neighbours per fire (default 1) */
  n?: number;
  /** overclock: the fired skills keep their cooldown progress */
  keep?: boolean;
}

export interface SkillNode {
  name: string;
  /** cooldown in ticks (10 ticks = 1s) */
  cd: number;
  fx: Effect[];
  /** short playstyle label for Lv2 branches */
  style?: string;
  /** engine skills fire their list neighbours */
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
  line: Line | 'none';
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
  /** burn stacks on this fighter */
  burnStacks: number;
  /** poison damage still to come from every poison stack on this fighter */
  poisonLeft: number;
  /** dodge charges */
  dodge: number;
}

export interface Ctx {
  /** scale a number by the cast power (echo mark casts at 50%) */
  v(n: number): number;
  readonly me: FighterView;
  readonly foe: FighterView;
  /** returns damage dealt, or -1 when the enemy dodged it. pierce = share of shield ignored. leech = share healed. sure = can't be dodged */
  hit(amount: number, o?: { pierce?: number; leech?: number; sure?: boolean }): number;
  shield(n: number): void;
  /** lose this much of your own shield */
  spendShield(n: number): void;
  heal(n: number): void;
  burn(dps: number, secs: number): void;
  poison(dps: number, secs: number): void;
  dodge(n: number): void;
  haste(pct: number, secs: number): void;
  wound(pct: number, secs: number): void;
  freeze(secs: number): void;
  slow(pct: number, secs: number): void;
  delay(secs: number): void;
  grow(n: number): void;
  charge(mult: number, hits: number): void;
  thorns(n: number, perm: boolean, heal?: number): void;
  steadfast(keep: number, ignoreFreeze: boolean): void;
  /** returns debuffs removed */
  cleanse(n: number, dotOnly?: boolean): number;
  /** this skill is one of its owner's line pieces */
  readonly inLine: boolean;
  /** cast power (engines and echo fire below 1, connect power bonuses above) */
  readonly power: number;
  /** returns buffs removed */
  dispel(n: number, shield: number, steal: boolean): number;
  leech(pct: number): void;
}

/**
 * Run one skill variant. A skill whose hits were all dodged also loses the freeze / delay that rides on them
 * (dodging an ice ball means the freeze does not land); control placed before any hit always lands.
 */
/** a skill fired at less than this power (engine, echo) gives no dodge charge */
export const DODGE_MIN_POWER = 0.75;

export function execNode(node: SkillNode, c: Ctx) {
  let removed = 0;
  let hitsTried = 0;
  let hitsLanded = 0;
  const missed = () => hitsTried > 0 && hitsLanded === 0;
  for (const e of node.fx) {
    switch (e.k) {
      case 'hit': {
        if (e.ifSlowed && !c.foe.slowed) break;
        const times = e.times ?? 1;
        for (let i = 0; i < times; i++) {
          let n = e.n + (e.perRemoved ?? 0) * removed;
          // a shield bash spends part of the shield it used (sim v15: before, it stayed, so bash after bash scaled forever)
          if (e.shieldPct) {
            const used = c.me.shield * e.shieldPct;
            n += used;
            c.spendShield(used * T['shield.spend']);
          }
          if (e.thornsX) n += c.me.thorns * e.thornsX;
          if (e.burnPct) n += c.foe.burnLeft * e.burnPct;
          if (e.poisonPct) n += c.foe.poisonLeft * e.poisonPct;
          if (e.perBurn) n += c.foe.burnStacks * e.perBurn;
          if (e.perDodge) n += c.me.dodge * e.perDodge;
          if (n <= 0) break;
          let mult = 1;
          if (e.exec && c.foe.hp < c.foe.maxHp * e.exec[0]) mult *= e.exec[1];
          if (e.frozen && c.foe.frozen) mult *= e.frozen;
          if (e.noShield && c.foe.shield <= 0) mult *= e.noShield;
          hitsTried++;
          const d = c.hit(c.v(n * mult), { pierce: e.pierce, leech: e.leech, sure: e.sure });
          if (d < 0) continue; // dodged: no burn / poison either
          hitsLanded++;
          if (e.burn) c.burn(c.v(e.burn[0]), e.burn[1]);
          if (e.poison) c.poison(c.v(e.poison[0]), e.poison[1]);
        }
        break;
      }
      case 'shield': c.shield(c.v(e.n)); break;
      case 'heal': c.heal(c.v(e.n)); break;
      case 'burn':
        for (let i = 0; i < (e.stacks ?? 1); i++) c.burn(c.v(e.dps + (e.growthHalf ? Math.floor(c.me.growth / 2) : 0)), e.secs);
        break;
      case 'poison':
        for (let i = 0; i < (e.stacks ?? 1); i++) c.poison(c.v(e.dps), e.secs);
        break;
      case 'freeze': if (!missed()) c.freeze(e.secs); break;
      case 'slow': c.slow(e.pct, e.secs); break;
      case 'delay': if (!missed()) c.delay(e.secs); break;
      // พลัง from a part-power fire (engine, echo) is that part, not a whole point (sim v14: before, any fire gave ≥ 1)
      case 'grow': c.grow(+(e.n * c.power * (c.inLine ? 1 : T['grow.offline'])).toFixed(2)); break;
      case 'charge': c.charge(e.mult, e.hits ?? 1); break;
      case 'thorns': c.thorns(c.v(e.n), !!e.perm, e.heal); break;
      case 'steadfast': c.steadfast(e.keep ?? 0.4, !!e.ignoreFreeze); break;
      case 'cleanse': removed = c.cleanse(e.lineAll && c.inLine ? 99 : e.n, !!e.dot); break;
      case 'dispel': removed = c.dispel(e.n, e.shield ?? 0.2, !!e.steal); break;
      case 'leech': c.leech(e.pct); break;
      // a dodge charge only comes from a fire of at least DODGE_MIN_POWER (an engine tick at 55% gives none)
      case 'dodge': if (c.power >= DODGE_MIN_POWER) c.dodge(Math.max(1, Math.round(e.n * Math.min(1, c.power)))); break;
      case 'haste': c.haste(e.pct, e.secs); break;
      case 'wound': c.wound(e.pct, e.secs); break;
    }
  }
}

// ---------------- skill data ----------------

const s = (secs: number) => Math.round(secs * 10);
const hit = (n: number, o: Omit<Extract<Effect, { k: 'hit' }>, 'k' | 'n'> = {}): Effect => ({ k: 'hit', n, ...o });
const N = (name: string, cdSecs: number, fx: Effect[], style?: string): SkillNode => ({ name, cd: s(cdSecs), fx, ...(style ? { style } : {}) });
const E = (name: string, cdSecs: number, engine: Engine, fx: Effect[] = [], style?: string): SkillNode => ({ ...N(name, cdSecs, fx, style), engine });

type Tree = Record<Variant, SkillNode>;
const def = (id: string, line: Line | 'none', tree: Tree, hero?: string): SkillDef => ({ id, line, tree, name: tree[''].name, ...(hero ? { hero } : {}) });

/** Base numbers. The live numbers are these × the multipliers in tuning.ts, see SKILL_LIST below. Roles per line: core / payoff / tech. */
const BASE_LIST: SkillDef[] = [
  // ======================= ⚔ hit =======================
  // core: plain hits
  def('strike', 'hit', {
    '': N('ฟัน', 4.3, [hit(5)]),
    a: N('ฟันหนัก', 5, [hit(9)], 'ตีหนัก'),
    a1: N('ฟันทะลวง', 5, [hit(15, { pierce: 0.6 })]),
    a2: N('ฟันประหาร', 5, [hit(13, { exec: [0.5, 1.6] })]),
    b: N('ฟันคู่', 4, [hit(4, { times: 2 })], 'ตีหลายครั้ง'),
    b1: N('ฟันพายุ', 4, [hit(4, { times: 3 })]),
    b2: N('ฟันดูดเลือด', 4, [hit(6, { times: 2, leech: 0.3 })]),
  }),
  // payoff: one hit much harder
  def('charge', 'hit', {
    '': N('รวมพลัง', 5, [{ k: 'charge', mult: 1.7 }]),
    a: N('รวมพลังใหญ่', 6, [{ k: 'charge', mult: 2.2 }], 'ตีทีเดียวแรงมาก'),
    a1: N('ทุ่มสุดตัว', 7, [{ k: 'charge', mult: 3.5 }]),
    a2: N('พลังเดือด', 6, [{ k: 'charge', mult: 2.2 }, { k: 'grow', n: 1 }]),
    b: N('รวมพลังเร็ว', 4, [{ k: 'charge', mult: 1.7 }], 'ใช้บ่อย'),
    b1: N('ต่อเนื่อง', 3, [{ k: 'charge', mult: 1.7 }]),
    b2: N('สองจังหวะ', 4, [{ k: 'charge', mult: 1.7, hits: 2 }]),
  }),
  // tech: answers 🛡 (pierce) and 💨 (hits that can't be dodged)
  def('heavy', 'hit', {
    '': N('ทุบหนัก', 6.5, [hit(11, { pierce: 0.5 })]),
    a: N('ค้อนทลาย', 7, [hit(15, { pierce: 1 })], 'ทลายโล่'),
    a1: N('ค้อนพิฆาต', 7, [hit(22, { pierce: 1 })]),
    a2: N('ค้อนสะท้าน', 7, [hit(16, { pierce: 1 }), { k: 'freeze', secs: 1 }]),
    b: N('ทุบแม่น', 6, [hit(9, { pierce: 0.5, sure: true })], 'ตีไม่พลาด'),
    b1: N('ทุบไม่พลาด', 6, [hit(13, { pierce: 0.5, sure: true })]),
    b2: N('ทุบคู่', 6, [hit(7, { pierce: 0.5, times: 2, sure: true })]),
  }),
  // ======================= 💨 dodge =======================
  // core: quick hits that also dodge
  def('jab', 'dodge', {
    '': N('แทงหลบ', 4, [hit(2), { k: 'dodge', n: 1 }]),
    a: N('แทงไว', 3.2, [hit(3), { k: 'dodge', n: 1 }], 'ความเร็ว'),
    a1: N('แทงสายฟ้า', 2.8, [hit(4), { k: 'dodge', n: 1 }]),
    a2: N('แทงลวงตา', 3.5, [hit(3), { k: 'dodge', n: 1 }, hit(2, { perDodge: 2 })]),
    b: N('แทงจุดตาย', 3.5, [hit(4, { noShield: 1.3 }), { k: 'dodge', n: 1 }], 'ตีศัตรูไร้โล่'),
    b1: N('แทงทะลุ', 3.5, [hit(6, { pierce: 1, noShield: 1.3 }), { k: 'dodge', n: 1 }]),
    b2: N('แทงสะกด', 3.5, [hit(4, { noShield: 1.3 }), { k: 'dodge', n: 1 }, { k: 'delay', secs: 0.5 }]),
  }),
  // payoff: hits harder for every dodge charge held
  def('riposte', 'dodge', {
    '': N('สวนกลับ', 5, [hit(4, { perDodge: 2 })]),
    a: N('สวนแรง', 5, [hit(5, { perDodge: 3 })], 'สวนหนัก'),
    a1: N('สวนพิฆาต', 5, [hit(7, { perDodge: 5 })]),
    a2: N('สวนทะลุ', 5, [hit(6, { perDodge: 3, pierce: 1 })]),
    b: N('สวนแล้วหลบ', 5, [hit(4, { perDodge: 2 }), { k: 'dodge', n: 1 }], 'หลบวน'),
    b1: N('เต้นดาบ', 4.5, [hit(5, { perDodge: 2 }), { k: 'dodge', n: 1 }]),
    b2: N('สวนดูดเลือด', 5, [hit(5, { perDodge: 2, leech: 0.3 }), { k: 'dodge', n: 1 }]),
  }),
  // tech: answers 🔥 ☠ (shakes off a burn / poison stack)
  def('sidestep', 'dodge', {
    '': N('ก้าวหลบ', 6, [{ k: 'dodge', n: 1 }, { k: 'cleanse', n: 99, dot: true }, hit(3)]),
    a: N('สะบัดพิษ', 6, [{ k: 'dodge', n: 1 }, { k: 'cleanse', n: 99, dot: true }, hit(3)], 'ล้างดีบัฟ'),
    a1: N('สะบัดหมด', 6, [{ k: 'dodge', n: 1 }, { k: 'cleanse', n: 99, dot: true }, hit(4)]),
    a2: N('สะบัดแล้วฟื้น', 6, [{ k: 'dodge', n: 1 }, { k: 'cleanse', n: 99, dot: true }, { k: 'heal', n: 4 }]),
    b: N('เงาลวง', 6, [{ k: 'dodge', n: 2 }, { k: 'cleanse', n: 1, dot: true }, hit(4)], 'หลบมาก'),
    b1: N('ร่างเงา', 6, [{ k: 'dodge', n: 2 }, { k: 'cleanse', n: 1, dot: true }, hit(7)]),
    b2: N('เงาสวน', 6, [{ k: 'dodge', n: 2 }, { k: 'cleanse', n: 1, dot: true }, hit(3, { perDodge: 2 })]),
  }),
  // ======================= 🛡 shield =======================
  // core: stack shield
  def('shield', 'shield', {
    '': N('ยกโล่', 5, [{ k: 'shield', n: 6 }, hit(3)]),
    a: N('ป้อมโล่', 7, [{ k: 'shield', n: 11 }, hit(6)], 'กำแพง'),
    a1: N('กำแพงเหล็ก', 7, [{ k: 'shield', n: 15 }, hit(7)]),
    a2: N('โล่มั่นคง', 7, [{ k: 'shield', n: 11 }, { k: 'steadfast' }, hit(6)]),
    b: N('โล่ตอบโต้', 6, [{ k: 'shield', n: 7 }, hit(3, { shieldPct: 0.5 })], 'โล่เป็นดาเมจ'),
    b1: N('โล่กระแทกกลับ', 6, [{ k: 'shield', n: 7 }, hit(3, { shieldPct: 1 })]),
    b2: N('โล่ฟื้นฟู', 6, [{ k: 'shield', n: 7 }, hit(3, { shieldPct: 0.5 }), { k: 'heal', n: 4 }]),
  }),
  // payoff: hits with the shield you hold
  def('stoneskin', 'shield', {
    '': N('ผิวหิน', 7, [{ k: 'shield', n: 3 }, hit(2, { shieldPct: 0.4 })]),
    a: N('หินแกร่ง', 7, [{ k: 'shield', n: 6 }, hit(3, { shieldPct: 0.4 })], 'เกราะ'),
    a1: N('หินผา', 7, [{ k: 'shield', n: 8 }, { k: 'steadfast' }, hit(4, { shieldPct: 0.4 })]),
    a2: N('หินฟื้น', 7, [{ k: 'shield', n: 6 }, { k: 'heal', n: 5 }, hit(4, { shieldPct: 0.4 })]),
    b: N('หินพุ่ง', 7, [{ k: 'shield', n: 3 }, hit(3, { shieldPct: 0.8 })], 'โล่เป็นดาเมจ'),
    b1: N('หินถล่ม', 7, [{ k: 'shield', n: 3 }, hit(4, { shieldPct: 1.2 })]),
    b2: N('หินทะลวง', 7, [{ k: 'shield', n: 3 }, hit(3, { shieldPct: 0.8, pierce: 1 })]),
  }),
  // tech: answers 🔥 ☠ (removes burn / poison)
  def('cleanse', 'shield', {
    '': N('ชำระล้าง', 6, [{ k: 'cleanse', n: 1 }, { k: 'shield', n: 2 }, hit(3)]),
    a: N('ล้างพิษ', 6, [{ k: 'cleanse', n: 2 }, { k: 'heal', n: 4 }, hit(5)], 'กันไฟ/พิษ/การคุม'),
    a1: N('ล้างทั้งหมด', 6, [{ k: 'cleanse', n: 2, lineAll: true }, { k: 'heal', n: 5 }, hit(5)]),
    a2: N('ล้างแล้วแกร่ง', 6, [{ k: 'cleanse', n: 2 }, { k: 'steadfast' }, { k: 'shield', n: 3 }]),
    b: N('ล้างแล้วตอบโต้', 6, [{ k: 'cleanse', n: 1 }, hit(4, { perRemoved: 3 })], 'ลงโทษดีบัฟ'),
    b1: N('ล้างพิฆาต', 6, [{ k: 'cleanse', n: 1 }, hit(5, { perRemoved: 5 })]),
    b2: N('ล้างแล้วตั้งรับ', 6, [{ k: 'cleanse', n: 1 }, { k: 'shield', n: 5 }, hit(4)]),
  }),
  // ======================= ❤ heal =======================
  // core: heal + grow
  def('feast', 'heal', {
    '': N('กินฟื้นแรง', 5, [{ k: 'cleanse', n: 1, dot: true, lineAll: true }, { k: 'heal', n: 4 }, { k: 'grow', n: 1 }, hit(2)]),
    a: N('กินอิ่ม', 5.5, [{ k: 'cleanse', n: 1, dot: true, lineAll: true }, { k: 'heal', n: 6 }, { k: 'grow', n: 1 }, hit(2)], 'อยู่รอด'),
    a1: N('งานเลี้ยง', 5.5, [{ k: 'cleanse', n: 1, dot: true, lineAll: true }, { k: 'heal', n: 8 }, { k: 'grow', n: 1 }, hit(3)]),
    a2: N('กินแล้วแกร่ง', 5.5, [{ k: 'cleanse', n: 1, dot: true, lineAll: true }, { k: 'heal', n: 6 }, { k: 'grow', n: 1 }, { k: 'shield', n: 4 }, hit(3)]),
    b: N('กินโต', 5.5, [{ k: 'cleanse', n: 1, dot: true, lineAll: true }, { k: 'heal', n: 4 }, { k: 'grow', n: 2 }, hit(2)], 'โตเร็ว'),
    b1: N('กินไม่หยุด', 5.5, [{ k: 'cleanse', n: 1, dot: true, lineAll: true }, { k: 'heal', n: 5 }, { k: 'grow', n: 2 }, hit(4)]),
    b2: N('กินเลือด', 5.5, [{ k: 'cleanse', n: 1, dot: true, lineAll: true }, { k: 'heal', n: 4 }, { k: 'grow', n: 2 }, { k: 'leech', pct: 0.5 }, hit(3)]),
  }),
  // payoff: the longer it lasts, the harder it hits
  def('train', 'heal', {
    '': N('ฝึกฝน', 6, [{ k: 'grow', n: 1 }, hit(3)]),
    a: N('ฝึกหนัก', 6.5, [{ k: 'grow', n: 3 }, hit(3)], 'พลังก้อนใหญ่'),
    a1: N('ฝึกสุดขีด', 6.5, [{ k: 'grow', n: 3 }, hit(5)]),
    a2: N('ฝึกต่อสู้', 6.5, [{ k: 'grow', n: 3 }, hit(5)]),
    b: N('ฝึกเร็ว', 3.5, [{ k: 'grow', n: 1 }, hit(3)], 'พลังถี่'),
    b1: N('ฝึกไม่หยุด', 3.2, [{ k: 'grow', n: 1 }, hit(4)]),
    b2: N('ซ้อมจริง', 3.5, [{ k: 'grow', n: 1 }, hit(3, { leech: 0.3 })]),
  }),
  // tech: answers ⚔ ❄ (heals when controlled, shield vs big hits)
  def('mend', 'heal', {
    '': N('ฟื้นฟู', 6, [{ k: 'heal', n: 4 }, { k: 'steadfast', keep: 0.55 }]),
    a: N('ฟื้นทันใจ', 6, [{ k: 'heal', n: 6 }, { k: 'steadfast', keep: 0.55 }], 'ฟื้นตอนโดนคุม'),
    a1: N('ฟื้นไม่หยุด', 5, [{ k: 'heal', n: 8 }, { k: 'steadfast', keep: 0.55 }]),
    a2: N('ฟื้นบริสุทธิ์', 6, [{ k: 'heal', n: 6 }, { k: 'steadfast', keep: 0.55 }, { k: 'cleanse', n: 1 }]),
    b: N('เลือดเหล็ก', 6, [{ k: 'heal', n: 4 }, { k: 'shield', n: 4 }, { k: 'steadfast', keep: 0.55 }], 'กันตีแรง'),
    b1: N('กายเหล็ก', 6, [{ k: 'heal', n: 4 }, { k: 'shield', n: 7 }, { k: 'steadfast', keep: 0.55 }]),
    b2: N('เลือดสวน', 6, [{ k: 'heal', n: 4 }, { k: 'steadfast', keep: 0.55 }, hit(5, { leech: 0.3 })]),
  }),
  // ======================= 🔥 burn =======================
  // core: start burns
  def('ignite', 'burn', {
    '': N('จุดไฟ', 5, [{ k: 'burn', dps: 2, secs: 4 }]),
    a: N('ไฟลุก', 5.5, [{ k: 'burn', dps: 3, secs: 6 }], 'ไฟแรง'),
    a1: N('ไฟนรก', 5.5, [{ k: 'burn', dps: 6, secs: 6 }]),
    a2: N('ไฟโหม', 5.5, [{ k: 'burn', dps: 4, secs: 6, growthHalf: true }]),
    b: N('ไฟยาว', 5.5, [{ k: 'burn', dps: 2, secs: 10 }], 'ไฟนาน'),
    b1: N('ไฟไม่ดับ', 5.5, [{ k: 'burn', dps: 3, secs: 14 }]),
    b2: N('ไฟเย็น', 5.5, [{ k: 'burn', dps: 4, secs: 8 }, { k: 'slow', pct: 0.15, secs: 3 }]),
  }),
  // payoff: hits harder for every burn stack on the enemy
  def('blaze', 'burn', {
    '': N('ลูกไฟ', 5, [hit(3, { perBurn: 1.5 })]),
    a: N('ไฟกระหน่ำ', 5, [hit(4, { perBurn: 2.5 })], 'จุดระเบิด'),
    a1: N('ไฟประลัย', 5, [hit(5, { perBurn: 4 })]),
    a2: N('ไฟทะลวง', 5, [hit(4, { perBurn: 2.5, pierce: 1 })]),
    b: N('ลูกไฟคู่', 5, [hit(2, { perBurn: 1, times: 2, burn: [1, 3] })], 'ไฟซ้อน'),
    b1: N('ฝนไฟ', 5, [hit(2, { perBurn: 1, times: 3, burn: [1, 3] })]),
    b2: N('ไฟลวก', 5, [hit(2, { perBurn: 1, times: 2, burn: [2, 4] })]),
  }),
  // tech: answers ❤ (cuts healing) and 🌪 (many small stacks: a cleanse removes only one)
  def('scorch', 'burn', {
    '': N('ไฟแผดเผา', 6, [{ k: 'burn', dps: 1, secs: 5, stacks: 2 }, { k: 'wound', pct: 0.3, secs: 5 }]),
    a: N('ไฟเผาแผล', 6, [{ k: 'burn', dps: 2, secs: 5, stacks: 2 }, { k: 'wound', pct: 0.35, secs: 6 }], 'ตัดการฟื้น'),
    a1: N('ไฟต้องสาป', 6, [{ k: 'burn', dps: 2, secs: 6, stacks: 2 }, { k: 'wound', pct: 0.5, secs: 6 }]),
    a2: N('ไฟซึม', 6, [{ k: 'burn', dps: 1, secs: 10, stacks: 3 }, { k: 'wound', pct: 0.35, secs: 6 }]),
    b: N('ไฟกระจาย', 5, [{ k: 'burn', dps: 1, secs: 4, stacks: 3 }], 'กองเล็กหลายกอง'),
    b1: N('ทะเลเพลิง', 5, [{ k: 'burn', dps: 1, secs: 5, stacks: 4 }]),
    b2: N('ไฟลามทุ่ง', 5, [{ k: 'burn', dps: 2, secs: 4, stacks: 3 }]),
  }),
  // ======================= ☠ poison =======================
  // core: hits that poison
  def('venom', 'poison', {
    '': N('เขี้ยวพิษ', 4.5, [hit(2), { k: 'poison', dps: 1, secs: 6 }]),
    a: N('พิษแรง', 4.5, [hit(2), { k: 'poison', dps: 2, secs: 8 }], 'พิษหนัก'),
    a1: N('พิษร้าย', 4.5, [hit(3), { k: 'poison', dps: 3, secs: 8 }]),
    a2: N('พิษกัดกร่อน', 4.5, [hit(2, { pierce: 1 }), { k: 'poison', dps: 2, secs: 8 }, { k: 'wound', pct: 0.3, secs: 4 }]),
    b: N('เขี้ยวรัว', 3.5, [hit(2, { times: 2, poison: [1, 6] })], 'พิษถี่'),
    b1: N('พายุพิษ', 3.5, [hit(2, { times: 3, poison: [1, 6] })]),
    b2: N('พิษดูดเลือด', 3.5, [hit(2, { times: 2, leech: 0.3, poison: [1, 6] })]),
  }),
  // payoff: bursts the poison still to come
  def('plague', 'poison', {
    '': N('พิษปะทุ', 6, [hit(2, { poisonPct: 0.4, pierce: 1 })]),
    a: N('พิษระเบิด', 6, [hit(2, { poisonPct: 0.6, pierce: 1 })], 'ระเบิดพิษ'),
    a1: N('มหาพิษ', 6, [hit(3, { poisonPct: 0.8, pierce: 1 })]),
    a2: N('พิษลาม', 6, [hit(2, { poisonPct: 0.4, pierce: 1 }), { k: 'poison', dps: 2, secs: 8 }]),
    b: N('โรคระบาด', 6, [{ k: 'poison', dps: 1, secs: 10, stacks: 2 }], 'พิษนาน'),
    b1: N('ระบาดหนัก', 6, [{ k: 'poison', dps: 2, secs: 10, stacks: 2 }]),
    b2: N('พิษกัดใจ', 6, [{ k: 'poison', dps: 1, secs: 10, stacks: 2 }, { k: 'wound', pct: 0.5, secs: 6 }]),
  }),
  // tech: answers ⚔ (fast hitters hurt themselves on thorns)
  def('thorns', 'poison', {
    '': N('เกราะหนามพิษ', 7, [{ k: 'thorns', n: 2 }, hit(4)]),
    a: N('หนามแหลม', 7, [{ k: 'thorns', n: 4 }, hit(5)], 'สะท้อนแรง'),
    a1: N('หนามพิษร้าย', 7, [{ k: 'thorns', n: 6 }, hit(5)]),
    a2: N('หนามขัดขวาง', 7, [{ k: 'thorns', n: 4, heal: 0.25 }, hit(5)]),
    b: N('หนามถาวร', 7, [{ k: 'thorns', n: 2, perm: true }], 'สะสมถาวร'),
    b1: N('ดงหนาม', 7, [{ k: 'thorns', n: 3, perm: true }]),
    b2: N('หนามหุ้มเกราะ', 7, [{ k: 'thorns', n: 2, perm: true }, { k: 'shield', n: 3 }]),
  }),
  // ======================= ❄ ice =======================
  // core: hit + freeze
  def('frost', 'ice', {
    '': N('ลูกน้ำแข็ง', 5, [hit(5), { k: 'freeze', secs: 1 }]),
    a: N('แช่ยาว', 5, [hit(5), { k: 'freeze', secs: 1.7 }], 'ล็อกศัตรู'),
    a1: N('ธารเยือกแข็ง', 5, [hit(10), { k: 'freeze', secs: 2.5 }]),
    a2: N('หนาวสะท้าน', 5, [hit(8), { k: 'freeze', secs: 2 }, { k: 'slow', pct: 0.2, secs: 3 }]),
    b: N('น้ำแข็งคม', 5, [hit(7), { k: 'freeze', secs: 1 }], 'ดาเมจ'),
    b1: N('หอกน้ำแข็ง', 5, [hit(15), { k: 'freeze', secs: 1 }]),
    b2: N('ลูกเห็บ', 5, [hit(6, { times: 2 }), { k: 'freeze', secs: 1 }]),
  }),
  // payoff: hits harder on a frozen enemy
  def('icelance', 'ice', {
    '': N('ทวนน้ำแข็ง', 5, [hit(5, { frozen: 1.7 })]),
    a: N('ทวนเยือก', 5, [hit(6, { frozen: 2 })], 'คอมโบแช่แข็ง'),
    a1: N('ทวนแหลก', 5, [hit(9, { frozen: 2.4, pierce: 0.5 })]),
    a2: N('ทวนแช่', 5, [hit(6, { frozen: 2 }), { k: 'freeze', secs: 0.5 }]),
    b: N('ทวนเร็ว', 3.5, [hit(5, { frozen: 1.5 })], 'ถี่'),
    b1: N('ทวนพายุ', 3, [hit(6, { frozen: 1.5 })]),
    b2: N('ทวนเย็นเฉียบ', 3.5, [hit(5, { frozen: 1.5 }), { k: 'slow', pct: 0.2, secs: 2 }]),
  }),
  // tech: answers 🛡 (pierce) and 💨 (the freeze comes before the hit, so a dodge can't stop it)
  def('glacier', 'ice', {
    '': N('ธารน้ำแข็ง', 6.5, [{ k: 'freeze', secs: 0.8 }, hit(5, { pierce: 1 })]),
    a: N('ธารเยือก', 6.5, [{ k: 'freeze', secs: 1.2 }, hit(5, { pierce: 1 })], 'แช่ไม่พลาด'),
    a1: N('ธารนิรันดร์', 6.5, [{ k: 'freeze', secs: 1.6 }, hit(6, { pierce: 1 })]),
    a2: N('ธารสลายโล่', 6.5, [{ k: 'freeze', secs: 1.2 }, { k: 'dispel', n: 1, shield: 0.4 }, hit(5)]),
    b: N('ธารคม', 6, [{ k: 'freeze', secs: 0.8 }, hit(8, { pierce: 1, sure: true })], 'ทะลวง'),
    b1: N('ธารแหลม', 6, [{ k: 'freeze', secs: 0.8 }, hit(12, { pierce: 1, sure: true })]),
    b2: N('ธารแตก', 6, [{ k: 'freeze', secs: 0.8 }, hit(5, { pierce: 1, sure: true, times: 2 })]),
  }),
  // ======================= 🌪 wind =======================
  // core: slow the enemy
  def('chill', 'wind', {
    '': N('ลมกรรโชก', 6.5, [hit(3), { k: 'slow', pct: 0.35, secs: 3 }]),
    a: N('พายุลม', 6.5, [hit(5), { k: 'slow', pct: 0.4, secs: 3 }], 'ช้ามาก'),
    a1: N('ลมเยือกแข็ง', 6.5, [hit(5), { k: 'slow', pct: 0.45, secs: 3 }]),
    a2: N('พายุมีด', 6.5, [hit(5), { k: 'slow', pct: 0.4, secs: 3 }, hit(4, { ifSlowed: true })]),
    b: N('ลมเย็นยาว', 6.5, [hit(5), { k: 'slow', pct: 0.25, secs: 5 }], 'ช้านาน'),
    b1: N('ลมนิรันดร์', 6.5, [hit(5), { k: 'slow', pct: 0.25, secs: 7 }]),
    b2: N('ลมส่งแรง', 6.5, [hit(5), { k: 'slow', pct: 0.25, secs: 5 }, { k: 'haste', pct: 0.2, secs: 3 }]),
  }),
  // payoff: speed yourself up and blow debuffs away
  def('tailwind', 'wind', {
    '': N('ลมส่ง', 6, [{ k: 'haste', pct: 0.3, secs: 3 }, { k: 'cleanse', n: 1, dot: true }, hit(3)]),
    a: N('ลมหมุน', 6, [{ k: 'haste', pct: 0.4, secs: 3 }, { k: 'cleanse', n: 1, dot: true }, hit(4)], 'ล้างดีบัฟ'),
    a1: N('พายุหมุน', 6, [{ k: 'haste', pct: 0.4, secs: 4 }, { k: 'cleanse', n: 2, dot: true }, hit(5)]),
    a2: N('ลมชำระ', 6, [{ k: 'haste', pct: 0.3, secs: 3 }, { k: 'cleanse', n: 2, dot: true }, { k: 'heal', n: 4 }, hit(4)]),
    b: N('ลมกรด', 5, [{ k: 'haste', pct: 0.3, secs: 3 }, hit(3, { times: 2 })], 'เร็ว'),
    b1: N('ลมพายุ', 4.5, [{ k: 'haste', pct: 0.4, secs: 3 }, hit(3, { times: 2 })]),
    b2: N('ลมบาด', 5, [{ k: 'haste', pct: 0.3, secs: 3 }, hit(4, { times: 2 }), { k: 'slow', pct: 0.2, secs: 2 }]),
  }),
  // tech: answers ❤ (cuts healing, halves พลัง) and ❄ (strips shields and buffs)
  def('dispel', 'wind', {
    '': N('สลายเวท', 6, [{ k: 'dispel', n: 1 }, { k: 'wound', pct: 0.4, secs: 4 }, hit(4)]),
    a: N('สลายใหญ่', 6, [{ k: 'dispel', n: 2, shield: 0.3 }, { k: 'wound', pct: 0.5, secs: 5 }, hit(4)], 'ล้างบัฟ'),
    a1: N('สลายสิ้น', 6, [{ k: 'dispel', n: 3 }, { k: 'wound', pct: 0.6, secs: 5 }, hit(4)]),
    a2: N('ทลายโล่', 6, [{ k: 'dispel', n: 2, shield: 0.4 }, { k: 'wound', pct: 0.5, secs: 5 }, hit(4)]),
    b: N('สลายแล้วตี', 6, [{ k: 'dispel', n: 1 }, hit(4, { perRemoved: 2 })], 'ลงโทษบัฟ'),
    b1: N('สลายพิฆาต', 6, [{ k: 'dispel', n: 1 }, hit(5, { perRemoved: 3 })]),
    b2: N('ขโมยพลัง', 6, [{ k: 'dispel', n: 1, steal: true }, hit(4)]),
  }),
  // ======================= neutral =======================
  def('ironwill', 'none', {
    '': N('ใจเหล็ก', 8, [{ k: 'steadfast' }, { k: 'shield', n: 2 }]),
    a: N('เหล็กกล้า', 8, [{ k: 'steadfast', keep: 0.2 }, { k: 'shield', n: 2 }], 'กันการคุม'),
    a1: N('ไร้ผล', 8, [{ k: 'steadfast', keep: 0.2, ignoreFreeze: true }, { k: 'shield', n: 2 }]),
    a2: N('เหล็กบริสุทธิ์', 8, [{ k: 'steadfast', keep: 0.2 }, { k: 'cleanse', n: 1 }]),
    b: N('ใจสู้', 8, [{ k: 'steadfast' }, { k: 'grow', n: 1 }], 'สู้ต่อ'),
    b1: N('ใจเพลิง', 8, [{ k: 'steadfast' }, { k: 'grow', n: 2 }]),
    b2: N('ใจกล้า', 8, [{ k: 'steadfast' }, hit(4)]),
  }),
  // engines (fire the skills right above / below)
  def('gear', 'none', {
    '': E('ฟันเฟือง', 3, { kind: 'gear', power: 0.4 }),
    a: E('เฟืองหนัก', 3, { kind: 'gear', power: 0.55 }, [], 'แรงขึ้น'),
    a1: E('เฟืองเหล็ก', 3, { kind: 'gear', power: 0.7 }),
    a2: E('เฟืองโล่', 3, { kind: 'gear', power: 0.55 }, [{ k: 'shield', n: 3 }]),
    b: E('เฟืองไว', 2.4, { kind: 'gear', power: 0.4 }, [], 'ถี่ขึ้น'),
    b1: E('เฟืองพายุ', 2.4, { kind: 'gear', power: 0.55 }),
    b2: E('เฟืองคู่', 2.8, { kind: 'gear', power: 0.45, n: 2 }),
  }),
  def('overclock', 'none', {
    '': E('เร่งเครื่อง', 6, { kind: 'overclock', power: 0.7 }),
    a: E('เร่งแรง', 6, { kind: 'overclock', power: 0.85 }, [], 'แรงขึ้น'),
    a1: E('เร่งสุดขีด', 6, { kind: 'overclock', power: 1 }),
    a2: E('เร่งแล้วตั้งรับ', 6, { kind: 'overclock', power: 0.85 }, [{ k: 'shield', n: 4 }]),
    b: E('เร่งไว', 4.5, { kind: 'overclock', power: 0.75 }, [], 'ถี่ขึ้น'),
    b1: E('เร่งถี่', 4, { kind: 'overclock', power: 0.85 }),
    b2: E('เร่งต่อเนื่อง', 4.5, { kind: 'overclock', power: 0.75, keep: true }),
  }),
  // ======================= hero uniques (count for their hero's line) =======================
  def('execute', 'hit', {
    '': N('ปลิดชีพ', 5, [hit(10, { exec: [0.5, 1.5] })]),
    a: N('ประหาร', 5, [hit(12, { exec: [0.5, 1.6] })], 'ปิดเกม'),
    a1: N('เพชฌฆาต', 5, [hit(13, { sure: true, exec: [0.35, 2.2] })]),
    a2: N('ประหารทะลุ', 5, [hit(14, { exec: [0.5, 1.6], pierce: 1 })]),
    b: N('เชือดเร็ว', 4, [hit(9, { exec: [0.5, 1.4] })], 'ใช้บ่อย'),
    b1: N('เชือดไว', 3, [hit(8, { exec: [0.5, 1.4] })]),
    b2: N('เชือดดูดเลือด', 4, [hit(10, { exec: [0.5, 1.4], leech: 0.3 })]),
  }, 'assassin'),
  def('flurry', 'dodge', {
    '': N('พายุดาบ', 5, [hit(2, { times: 3 })]),
    a: N('พายุคม', 5, [hit(2, { times: 4 })], 'ตีรัวขึ้น'),
    a1: N('พายุพันดาบ', 5, [hit(2, { times: 5 })]),
    a2: N('ดาบเงา', 5, [hit(2, { times: 4 }), { k: 'dodge', n: 1 }]),
    b: N('ดาบหนัก', 5, [hit(3, { times: 3 })], 'ตีน้อยแต่แรง'),
    b1: N('ดาบทลาย', 5, [hit(6, { times: 3 })]),
    b2: N('ดาบถ่วง', 5, [hit(4, { times: 3 }), { k: 'delay', secs: 0.3 }]),
  }, 'duelist'),
  def('bulwark', 'shield', {
    '': N('โล่กระแทก', 6, [hit(6, { shieldPct: 1 })]),
    a: N('ปะทะ', 6, [hit(8, { shieldPct: 1.3 })], 'โล่เป็นดาเมจ'),
    a1: N('ทลายด้วยโล่', 6, [hit(9, { shieldPct: 1.7 })]),
    a2: N('โล่สะท้าน', 6, [hit(9, { shieldPct: 1.3 }), { k: 'freeze', secs: 0.5 }]),
    b: N('ปะทะแล้วตั้งรับ', 6, [hit(8, { shieldPct: 0.8 }), { k: 'shield', n: 4 }], 'วนโล่'),
    b1: N('ตั้งรับเต็มที่', 6, [hit(9, { shieldPct: 0.8 }), { k: 'shield', n: 6 }]),
    b2: N('ปะทะฟื้น', 6, [hit(9, { shieldPct: 0.8 }), { k: 'shield', n: 4 }, { k: 'heal', n: 4 }]),
  }, 'knight'),
  def('rampage', 'heal', {
    '': N('คลั่ง', 5, [hit(2, { times: 2, leech: 0.25 })]),
    a: N('คลั่งรัว', 6, [hit(2, { times: 3, leech: 0.25 })], 'ตีหลายครั้ง'),
    a1: N('บ้าคลั่ง', 6, [hit(4, { times: 4, leech: 0.25 })]),
    a2: N('คลั่งโต', 6, [hit(2, { times: 3, leech: 0.25 }), { k: 'grow', n: 1 }]),
    b: N('คลั่งหนัก', 6, [hit(5, { times: 2 })], 'ตีแรง'),
    b1: N('คลั่งทลาย', 6, [hit(9, { times: 2 })]),
    b2: N('คลั่งเลือด', 6, [hit(6, { times: 2, leech: 0.4 })]),
  }, 'berserker'),
  def('inferno', 'burn', {
    '': N('ระเบิดเพลิง', 6, [hit(2, { burnPct: 0.5, pierce: 1 })]),
    a: N('ระเบิดใหญ่', 6, [hit(2, { burnPct: 0.75, pierce: 1 })], 'จุดระเบิดไฟที่สะสม'),
    a1: N('ระเบิดมหันต์', 6, [hit(2, { burnPct: 0.95, pierce: 1 })]),
    a2: N('ระเบิดลุกลาม', 6, [hit(2, { burnPct: 0.4, pierce: 1 }), { k: 'burn', dps: 2, secs: 6 }]),
    b: N('จุดระเบิด', 6, [hit(2, { burnPct: 0.5, pierce: 1 }), { k: 'burn', dps: 1.5, secs: 6 }], 'สะสมไฟ'),
    b1: N('ระเบิดลาวา', 6, [hit(2, { burnPct: 0.5, pierce: 1 }), { k: 'burn', dps: 3, secs: 6 }]),
    b2: N('ระเบิดควัน', 6, [hit(2, { burnPct: 0.5, pierce: 1 }), { k: 'burn', dps: 2, secs: 6 }, { k: 'slow', pct: 0.2, secs: 3 }]),
  }, 'pyro'),
  def('spikewall', 'poison', {
    '': N('ป้อมหนามพิษ', 5.5, [hit(4, { thornsX: 2 }), { k: 'poison', dps: 1, secs: 6 }]),
    a: N('ระเบิดหนามพิษ', 5.5, [hit(5, { thornsX: 2.5, poisonPct: 0.4 })], 'แปลงพิษเป็นดาเมจ'),
    a1: N('หนามพิษพุ่ง', 5.5, [hit(6, { thornsX: 3, poisonPct: 0.6 })]),
    a2: N('หนามพิษล้อม', 5.5, [hit(5, { thornsX: 2.5, poisonPct: 0.4 }), { k: 'shield', n: 5 }]),
    b: N('ปลูกหนามพิษ', 5.5, [hit(4, { thornsX: 2 }), { k: 'thorns', n: 1 }, { k: 'poison', dps: 1, secs: 6 }], 'สะสมพิษ'),
    b1: N('สวนหนามพิษ', 5.5, [hit(5, { thornsX: 2 }), { k: 'thorns', n: 2 }, { k: 'poison', dps: 2, secs: 6 }]),
    b2: N('หนามพิษฟื้น', 5.5, [hit(4, { thornsX: 2 }), { k: 'thorns', n: 1 }, { k: 'poison', dps: 1, secs: 6 }, { k: 'heal', n: 4 }]),
  }, 'thornguard'),
  def('shatter', 'ice', {
    '': N('ทุบน้ำแข็ง', 4.5, [hit(5, { pierce: 0.5, frozen: 1.8 })]),
    a: N('ทุบแตก', 4.5, [hit(5, { pierce: 0.5, frozen: 2.2 })], 'คอมโบแช่แข็ง'),
    a1: N('ทุบแหลก', 4.5, [hit(10, { pierce: 1, frozen: 3 })]),
    a2: N('ทุบแล้วแช่', 4.5, [hit(8, { pierce: 1, frozen: 2.6 }), { k: 'freeze', secs: 0.5 }]),
    b: N('ทุบตรง', 4.5, [hit(8, { pierce: 0.5, frozen: 2 })], 'ไม่ต้องรอคอมโบ'),
    b1: N('ทุบทะลวง', 4.5, [hit(12, { pierce: 1, frozen: 2 })]),
    b2: N('ทุบเย็น', 4.5, [hit(11, { pierce: 1, frozen: 2 }), { k: 'slow', pct: 0.2, secs: 3 }]),
  }, 'witch'),
  def('timewarp', 'wind', {
    '': N('ลมย้อน', 5, [hit(7), { k: 'delay', secs: 1.25 }]),
    a: N('ลมย้อนแรง', 5, [hit(9), { k: 'delay', secs: 1.5 }], 'ล็อกเวลา'),
    a1: N('ลมหยุดกาล', 5, [hit(9), { k: 'delay', secs: 1.5 }, { k: 'slow', pct: 0.2, secs: 2 }]),
    a2: N('ลมย้อนแล้วช้า', 5, [hit(10), { k: 'delay', secs: 1.5 }, { k: 'slow', pct: 0.2, secs: 3 }]),
    b: N('ลมคม', 4.5, [hit(11), { k: 'delay', secs: 1.25 }], 'ดาเมจ'),
    b1: N('ลมตัด', 4.5, [hit(13), { k: 'delay', secs: 1.25 }]),
    b2: N('ลมเร่ง', 4.5, [hit(11), { k: 'delay', secs: 1.25 }, { k: 'haste', pct: 0.3, secs: 3 }]),
  }, 'chrono'),
];

// ---------------- tuning multipliers (tuning.ts) ----------------

/** round to k steps per unit (k = 1: integers; 20: 0.05 steps) */
const rnd = (x: number, k: number) => Math.round(x * k) / k;
/** scale x by m; integers stay integers, fractions keep `k` steps per unit */
const sc = (x: number, m: number, k = 20) => (m === 1 ? x : Number.isInteger(x) ? Math.round(x * m) : rnd(x * m, k));

/** Lv2 sits this share of the way from the Lv1 to the Lv3 multiplier (sim v14: 0.25, was 0.5), so the Lv3 knob shapes the late game and barely the mid game */
const LV2_SHARE = 0.25;
/** Power multiplier of a skill at a level: Lv1 and Lv3 from tuning.ts, Lv2 in between (never below Lv1). */
function powerOf(d: SkillDef, lv: number): number {
  const pre = d.hero ? `uniq.${d.hero}` : d.line !== 'none' ? `line.${d.line}` : '';
  if (!pre) return 1;
  const a = T[`${pre}.lv1` as keyof typeof T] ?? 1;
  const b = T[`${pre}.lv3` as keyof typeof T] ?? 1;
  // never weaker with a level (sim v14): Lv3 at least Lv1, Lv2 in between
  const b2 = Math.max(a, b);
  return lv === 1 ? a : lv === 3 ? b2 : a + (b2 - a) * LV2_SHARE;
}

function scaleEffect(e: Effect, m: number, ctl: number): Effect {
  switch (e.k) {
    case 'hit': {
      const o: Extract<Effect, { k: 'hit' }> = { ...e, n: sc(e.n, m) };
      if (e.shieldPct) o.shieldPct = sc(e.shieldPct, m);
      if (e.thornsX) o.thornsX = sc(e.thornsX, m, 10);
      if (e.burnPct) o.burnPct = sc(e.burnPct, m);
      if (e.burn) o.burn = [sc(e.burn[0], m, 2), e.burn[1]];
      if (e.poison) o.poison = [sc(e.poison[0], m, 2), e.poison[1]];
      if (e.poisonPct) o.poisonPct = sc(e.poisonPct, m);
      if (e.perBurn) o.perBurn = sc(e.perBurn, m, 2);
      if (e.perDodge) o.perDodge = sc(e.perDodge, m, 2);
      return o;
    }
    case 'shield': case 'heal': return { ...e, n: sc(e.n, m) };
    case 'burn': case 'poison': return { ...e, dps: sc(e.dps, m, 2) };
    case 'charge': return m === 1 ? e : { ...e, mult: rnd(1 + (e.mult - 1) * m, 20) };
    case 'freeze': case 'delay': return { ...e, secs: sc(e.secs, ctl) };
    case 'slow': return { ...e, secs: sc(e.secs, ctl) };
    default: return e;
  }
}

const cloneNode = (n: SkillNode): SkillNode => ({ ...n, fx: n.fx.map((e) => ({ ...e })), ...(n.engine ? { engine: { ...n.engine } } : {}) });

/** The live skills: BASE_LIST × tuning.ts. Rebuilt in place when the tuner changes the multipliers. */
export const SKILL_LIST: SkillDef[] = BASE_LIST.map((d) => ({ ...d, tree: Object.fromEntries(VARIANTS.map((v) => [v, cloneNode(d.tree[v])])) as Tree }));

function applyTuning() {
  BASE_LIST.forEach((d, i) => {
    for (const v of VARIANTS) {
      const base = d.tree[v];
      const m = powerOf(d, lvOf(v));
      const node = SKILL_LIST[i].tree[v];
      node.fx = base.fx.map((e) => scaleEffect(e, m, T.control));
      const cdm = d.hero ? T[`cd.${d.hero}` as keyof typeof T] ?? 1 : 1;
      node.cd = cdm === 1 ? base.cd : Math.round(base.cd * cdm);
      if (base.engine) node.engine = { ...base.engine, power: sc(base.engine.power, T.engine) };
    }
  });
}
applyTuning();
onTuning(applyTuning);

export const SKILLS: Record<string, SkillDef> = Object.fromEntries(SKILL_LIST.map((d) => [d.id, d]));

/** The variant an equipped skill uses. */
export const nodeOf = (k: Pick<SkillInstance, 'id' | 'v'>): SkillNode => SKILLS[k.id].tree[k.v as Variant] ?? SKILLS[k.id].tree[''];

/** True if the variant deals direct hits (used by bots and the explanation). */
export const hits = (node: SkillNode) => node.fx.some((e) => e.k === 'hit');

/** True if the variant fires early when its owner is controlled (it has ✨ ชำระ or 🗿 ใจเหล็ก). */
export const reacts = (node: SkillNode) => node.fx.some((e) => (e.k === 'cleanse' && !e.dot) || e.k === 'steadfast');

/** True for engine skills (ฟันเฟือง, เร่งเครื่อง): they fire their list neighbours. */
/**
 * The headline numbers of a variant, for "before → after" on upgrade cards and the no-worse-upgrade check:
 * total hit damage (all unconditional hits × times), shield, heal, burn / poison total, dodge, power, thorns,
 * freeze / delay seconds, charge, engine power. Only keys the variant has.
 */
export type MainKey = 'hit' | 'shield' | 'heal' | 'burn' | 'poison' | 'dodge' | 'grow' | 'thorns' | 'freeze' | 'delay' | 'charge' | 'engine' | 'cd';
export function mainNumbers(n: SkillNode): Partial<Record<MainKey, number>> {
  const o: Partial<Record<MainKey, number>> = {};
  const add = (k: MainKey, v: number) => (o[k] = +((o[k] ?? 0) + v).toFixed(2));
  for (const e of n.fx) {
    if (e.k === 'hit' && !e.ifSlowed && e.n > 0) add('hit', e.n * (e.times ?? 1));
    else if (e.k === 'shield' || e.k === 'heal' || e.k === 'dodge' || e.k === 'grow' || e.k === 'thorns') add(e.k, e.n);
    else if (e.k === 'burn' || e.k === 'poison') add(e.k, e.dps * e.secs * (e.stacks ?? 1));
    else if (e.k === 'freeze' || e.k === 'delay') add(e.k, e.secs);
    else if (e.k === 'charge') add('charge', e.mult);
  }
  if (n.engine) add('engine', n.engine.power);
  o.cd = n.cd / 10;
  return o;
}

/**
 * Every number of a variant, flattened (sim v15 round 4): "<effect kind>#<n>.<field>" → value, e.g. "hit#0.n" 14,
 * "hit#0.pierce" 1, "hit#0.exec.1" 1.6, "burn#0.dps" 2, "cd" 5. Flags (sure, perm, dot, lineAll) count as 1.
 * The n-th effect of a kind keeps its index, so a branch that keeps a hit and adds a second one compares the first.
 */
export function flatNumbers(n: SkillNode): Record<string, number> {
  const o: Record<string, number> = {};
  const seen: Record<string, number> = {};
  for (const e of n.fx) {
    const i = (seen[e.k] = (seen[e.k] ?? -1) + 1);
    for (const [f, v] of Object.entries(e)) {
      if (f === 'k') continue;
      const key = `${e.k}#${i}.${f}`;
      if (typeof v === 'number') o[key] = v;
      else if (typeof v === 'boolean') o[key] = v ? 1 : 0;
      else if (Array.isArray(v)) v.forEach((x, j) => (o[`${key}.${j}`] = x));
    }
    // defaults a branch may spell out (1 hit, a charge for 1 hit)
    if (e.k === 'hit') o[`hit#${i}.times`] ??= 1;
    if (e.k === 'charge') o[`charge#${i}.hits`] ??= 1;
    // presence of the effect itself (a steadfast or cleanse without numbers still shows when it comes or goes)
    o[`${e.k}#${i}`] = 1;
  }
  if (n.engine) for (const [f, v] of Object.entries(n.engine)) if (typeof v === 'number' || typeof v === 'boolean') o[`engine.${f}`] = +v;
  o.cd = n.cd / 10;
  return o;
}
/** short label of a field (Thai, English), and how it reads: pct = a share, sec = seconds, flag = on / off */
const FIELD: Record<string, [string, string, ('pct' | 'sec' | 'flag' | 'num')?]> = {
  'hit.n': ['ตี', 'hit'], 'hit.times': ['จำนวนครั้ง', 'hits'], 'hit.pierce': ['ทะลุโล่', 'pierce', 'pct'], 'hit.shieldPct': ['ตีจากโล่', 'from shield', 'pct'],
  'hit.thornsX': ['ตีจากหนาม×', 'from thorns×'], 'hit.burnPct': ['ตีจากไฟ', 'from burn', 'pct'], 'hit.poisonPct': ['ตีจากพิษ', 'from poison', 'pct'],
  'hit.perBurn': ['ต่อกองไฟ', 'per burn'], 'hit.perDodge': ['ต่อแต้มหลบ', 'per dodge'], 'hit.exec.0': ['ประหารเมื่อเลือด<', 'execute below', 'pct'],
  'hit.exec.1': ['ประหาร×', 'execute×'], 'hit.frozen': ['ทุบน้ำแข็ง×', 'vs frozen×'], 'hit.noShield': ['ไร้โล่×', 'no shield×'], 'hit.leech': ['ดูดเลือด', 'leech', 'pct'],
  'hit.sure': ['ไม่พลาด', 'can’t miss', 'flag'], 'hit.burn.0': ['ไฟต่อครั้ง', 'burn per hit'], 'hit.burn.1': ['ไฟนาน', 'burn for', 'sec'],
  'hit.poison.0': ['พิษต่อครั้ง', 'poison per hit'], 'hit.poison.1': ['พิษนาน', 'poison for', 'sec'], 'hit.perRemoved': ['ต่อดีบัฟที่ล้าง', 'per cleansed'],
  'hit.ifSlowed': ['ตีเมื่อศัตรูช้า', 'hit if slowed', 'flag'], 'hit': ['การตี', 'hit', 'flag'],
  'shield.n': ['โล่', 'shield'], 'heal.n': ['ฟื้น', 'heal'], 'burn.dps': ['ไฟ/วิ', 'burn/s'], 'burn.secs': ['ไฟนาน', 'burn for', 'sec'],
  'burn.stacks': ['กองไฟ', 'burn stacks'], 'burn.growthHalf': ['ไฟ+½พลัง', 'burn +½ power', 'flag'], 'burn': ['ไฟ', 'burn', 'flag'],
  'poison.dps': ['พิษ/วิ', 'poison/s'], 'poison.secs': ['พิษนาน', 'poison for', 'sec'], 'poison.stacks': ['กองพิษ', 'poison stacks'], 'poison': ['พิษ', 'poison', 'flag'],
  'dodge.n': ['หลบ', 'dodge'], 'dodge': ['หลบ', 'dodge', 'flag'], 'haste.pct': ['เร่ง', 'haste', 'pct'], 'haste.secs': ['เร่งนาน', 'haste for', 'sec'], 'haste': ['เร่ง', 'haste', 'flag'],
  'wound.pct': ['แผลลึก', 'wound', 'pct'], 'wound.secs': ['แผลลึกนาน', 'wound for', 'sec'], 'wound': ['แผลลึก', 'wound', 'flag'],
  'freeze.secs': ['แช่แข็ง', 'freeze', 'sec'], 'freeze': ['แช่แข็ง', 'freeze', 'flag'], 'slow.pct': ['ช้า', 'slow', 'pct'], 'slow.secs': ['ช้านาน', 'slow for', 'sec'],
  'slow': ['ช้า', 'slow', 'flag'], 'delay.secs': ['ถ่วงเวลา', 'delay', 'sec'], 'delay': ['ถ่วงเวลา', 'delay', 'flag'], 'grow.n': ['พลัง', 'power'], 'grow': ['พลัง', 'power', 'flag'],
  'charge.mult': ['รวมพลัง×', 'charge×'], 'charge.hits': ['รวมพลังกี่ครั้ง', 'charged hits'], 'charge': ['รวมพลัง', 'charge', 'flag'],
  'thorns.n': ['หนาม', 'thorns'], 'thorns.perm': ['หนามถาวร', 'permanent thorns', 'flag'], 'thorns.heal': ['ศัตรูฟื้นได้', 'enemy heals', 'pct'], 'thorns': ['หนาม', 'thorns', 'flag'],
  'steadfast.keep': ['การคุมที่ยังโดน', 'control still taken', 'pct'], 'steadfast.ignoreFreeze': ['กันแช่แข็ง 1 ครั้ง', 'blocks 1 freeze', 'flag'], 'steadfast': ['ใจเหล็ก', 'iron will', 'flag'],
  'cleanse.n': ['ล้าง', 'cleanse'], 'cleanse.dot': ['ล้างแค่ไฟ/พิษ', 'only burn/poison', 'flag'], 'cleanse.lineAll': ['สายตัวเอง: ล้างหมด', 'own line: all', 'flag'], 'cleanse': ['ล้าง', 'cleanse', 'flag'],
  'dispel.n': ['สลาย', 'dispel'], 'dispel.shield': ['สลายโล่', 'dispel shield', 'pct'], 'dispel.steal': ['ขโมยพลัง', 'steal power', 'flag'], 'dispel': ['สลาย', 'dispel', 'flag'],
  'leech.pct': ['ดูดเลือดครั้งหน้า', 'next-hit leech', 'pct'], 'leech': ['ดูดเลือด', 'leech', 'flag'], 'engine.power': ['แรงที่สั่ง', 'engine power', 'pct'], 'engine.n': ['สั่งกี่ตัว', 'fires'],
  'engine.keep': ['คูลดาวน์ไม่เริ่มใหม่', 'keeps cooldown', 'flag'], 'cd': ['คูลดาวน์', 'cooldown', 'sec'],
  'shield': ['โล่', 'shield', 'flag'], 'heal': ['ฟื้น', 'heal', 'flag'],
};
/** fields where a lower number is better (sim v16 audit: cooldown, what the enemy keeps, the control that still lands) */
export const LOWER_BETTER = new Set(['cd', 'thorns.heal', 'steadfast.keep', 'cleanse.dot']);
/** defaults the data leaves out (so a branch that spells one out is not "new") */
const DEFAULTS: Record<string, number> = { 'steadfast.keep': 0.4, 'hit.times': 1, 'charge.hits': 1, 'dispel.shield': 0.2, 'thorns.heal': 0.5 };
const fieldOf = (key: string) => key.replace(/#\d+/, '');
const effOf = (key: string) => key.split('.')[0];
const ALL = 99;
/** "35%", "1.5 วิ", "ทั้งหมด", "5" */
export function fmtField(key: string, v: number, th = true) {
  const kind = FIELD[fieldOf(key)]?.[2] ?? 'num';
  if (v >= ALL) return th ? 'ทั้งหมด' : 'all';
  if (kind === 'pct') return `${Math.round(v * 100)}%`;
  if (kind === 'sec') return `${+v.toFixed(2)}${th ? ' วิ' : 's'}`;
  return String(+v.toFixed(2));
}
export interface DiffRow { key: string; label: string; from: number; to: number; worse: boolean; fromText: string; toText: string; text: string }
/**
 * Before → after of an upgrade, in short words: every number that changes (scripts/upgrade-check.ts proves none is
 * missing and that ▼ only marks what really gets worse). An effect the new level adds is one "+…" row, one it drops is
 * one "−…" row (worse); otherwise one row per changed number.
 */
export function upgradeDiff(from: SkillNode, to: SkillNode, th = true): DiffRow[] {
  const a = flatNumbers(from);
  const b = flatNumbers(to);
  for (const m of [a, b]) for (const k of Object.keys(m)) if (!k.includes('.')) for (const [f, d] of Object.entries(DEFAULTS)) {
    const [kind, field] = f.split('.');
    if (k.startsWith(kind + '#')) m[`${k}.${field}`] ??= d;
  }
  const label = (key: string) => FIELD[fieldOf(key)]?.[th ? 0 : 1] ?? fieldOf(key);
  const out: DiffRow[] = [];
  const effs = [...new Set([...Object.keys(a), ...Object.keys(b)].filter((k) => !k.includes('.') && k !== 'cd'))];
  const done = new Set<string>();
  for (const e of effs) {
    if (a[e] && !b[e]) {
      out.push({ key: e, label: label(e), from: 1, to: 0, worse: true, fromText: '', toText: '', text: `−${label(e)}` });
      done.add(e);
    } else if (!a[e] && b[e]) {
      // the new effect with its headline number
      const nums = Object.keys(b).filter((k) => k.startsWith(e + '.') && FIELD[fieldOf(k)]?.[2] !== 'flag' && !(fieldOf(k) in DEFAULTS));
      const main = nums[0];
      const extra = main ? ` ${fmtField(main, b[main], th)}` : '';
      out.push({ key: e, label: label(e), from: 0, to: 1, worse: false, fromText: '', toText: '', text: `+${label(main ?? e)}${extra}` });
      done.add(e);
    }
  }
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (!key.includes('.') && key !== 'cd') continue;
    if (done.has(effOf(key))) continue;
    const f = a[key] ?? 0;
    const t = b[key] ?? 0;
    if (Math.abs(f - t) < 1e-9) continue;
    const field = fieldOf(key);
    const kind = FIELD[field]?.[2];
    const worse = LOWER_BETTER.has(field) ? t > f : t < f;
    if (kind === 'flag') out.push({ key, label: label(key), from: f, to: t, worse, fromText: '', toText: '', text: `${t ? '+' : '−'}${label(key)}` });
    else if (!(key in a)) out.push({ key, label: label(key), from: f, to: t, worse: false, fromText: '', toText: '', text: `+${label(key)} ${fmtField(key, t, th)}` });
    else if (!(key in b)) out.push({ key, label: label(key), from: f, to: t, worse: true, fromText: '', toText: '', text: `−${label(key)}` });
    else {
      const fromText = fmtField(key, f, th);
      const toText = fmtField(key, t, th);
      out.push({ key, label: label(key), from: f, to: t, worse, fromText, toText, text: `${label(key)} ${fromText}→${toText}` });
    }
  }
  return out;
}
/** "ตี 4→9 · คูลดาวน์ 4.3 วิ→5 วิ▼" (▼ = got worse) */
export const upgradeDiffText = (from: SkillNode, to: SkillNode, th = true) =>
  upgradeDiff(from, to, th).map((d) => `${d.text}${d.worse ? '▼' : ''}`).join(' · ');

/**
 * Rarity of a tree variant (a label for the shop and the list; no rule depends on it). Sim v16: only chosen Lv3
 * branches are special: about two epics per line, each one changing how the skill plays (not just bigger numbers),
 * and a few rares; every other branch is common. Pure data, cheap to change.
 */
export type Rarity = 'common' | 'rare' | 'epic';
export const EPIC: Record<string, Variant[]> = {
  strike: ['a2'], charge: ['a1'], riposte: ['a1'], flurry: ['a2'], stoneskin: ['b1'], bulwark: ['a1'], feast: ['b2'],
  rampage: ['a2'], inferno: ['a1'], ignite: ['a2'], spikewall: ['a1'], plague: ['a1'], shatter: ['a1'], frost: ['a1'],
  timewarp: ['b2'], dispel: ['b2'], gear: ['b2'], overclock: ['b2'],
};
export const RARE: Record<string, Variant[]> = {
  heavy: ['a2'], execute: ['a1'], jab: ['b2'], sidestep: ['b2'], shield: ['a2'], cleanse: ['a1'], train: ['b2'],
  mend: ['a2'], blaze: ['a2'], scorch: ['a1'], venom: ['a2'], thorns: ['a2'], icelance: ['a2'], glacier: ['a2'],
  tailwind: ['a1'], chill: ['a2'], ironwill: ['a1'],
};
export const rarityOf = (id: string, v: string): Rarity =>
  lvOf(v) < 3 ? 'common' : EPIC[id]?.includes(v as Variant) ? 'epic' : RARE[id]?.includes(v as Variant) ? 'rare' : 'common';
/** the Lv3 branch of `v` (a Lv2 variant) that is epic, if any: the shop shows "◆ leads to …" on that upgrade */
export const epicAfter = (id: string, v: string): Variant | null =>
  v.length !== 1 ? null : (EPIC[id]?.find((x) => x[0] === v) ?? null);

export const isEngine = (id: string) => Object.values(SKILLS[id]?.tree ?? {}).some((n) => !!n.engine);

/** Line names (the UI swaps them for English). */
export const LINE_NAME: Record<Line | 'none', string> = {
  hit: 'ตี',
  dodge: 'หลบ',
  shield: 'โล่',
  heal: 'ฮีล',
  burn: 'เผา',
  poison: 'พิษ',
  ice: 'น้ำแข็ง',
  wind: 'ลม',
  none: 'ทั่วไป',
};
/** Line icons (same in every language). */
export const LINE_ICON: Record<Line | 'none', string> = {
  hit: '⚔', dodge: '💨', shield: '🛡', heal: '❤', burn: '🔥', poison: '☠', ice: '❄', wind: '🌪', none: '⚙',
};
/** Role of a shared skill in its line: core (adds the line's element), payoff (cashes it in), tech (answers the lines it loses to). */
export type Role = 'core' | 'payoff' | 'tech';
export const SKILL_ROLE: Record<string, Role> = {
  strike: 'core', charge: 'payoff', heavy: 'tech',
  jab: 'core', riposte: 'payoff', sidestep: 'tech',
  shield: 'core', stoneskin: 'payoff', cleanse: 'tech',
  feast: 'core', train: 'payoff', mend: 'tech',
  ignite: 'core', blaze: 'payoff', scorch: 'tech',
  venom: 'core', plague: 'payoff', thorns: 'tech',
  frost: 'core', icelance: 'payoff', glacier: 'tech',
  chill: 'core', tailwind: 'payoff', dispel: 'tech',
};
export const ROLE_NAME: Record<Role, string> = { core: 'แกน', payoff: 'จบ', tech: 'แก้ทาง' };
/** "⚔ ตี" */
export const lineLabel = (l: Line | 'none') => `${LINE_ICON[l]} ${LINE_NAME[l]}`;

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
  const en = node.engine;
  if (en?.kind === 'gear') out.push({ kw: 'gear', text: `⚙${en.n && en.n > 1 ? '↕ บน+ล่าง' : '↕ สลับบน/ล่าง'} ${pct(en.power)}` });
  if (en?.kind === 'overclock') out.push({ kw: 'overclock', text: `🚀↕ บน+ล่าง ${pct(en.power)}${en.keep ? ' คูลดาวน์ไม่เริ่มใหม่' : ''}` });
  for (const e of node.fx) {
    switch (e.k) {
      case 'hit': {
        const parts: string[] = [];
        if (e.n > 0) parts.push(String(e.n));
        if (e.shieldPct) parts.push(`${pct(e.shieldPct)}🛡`);
        if (e.thornsX) parts.push(`🌵×${e.thornsX}`);
        if (e.burnPct) parts.push(`${pct(e.burnPct)}🔥`);
        if (e.poisonPct) parts.push(`${pct(e.poisonPct)}☠`);
        if (e.perBurn) parts.push(`${e.perBurn}/🔥`);
        if (e.perDodge) parts.push(`${e.perDodge}/💨`);
        if (e.perRemoved) parts.push(`${e.perRemoved}/อย่าง`);
        out.push({ kw: 'hit', text: `⚔${parts.join('+')}${e.times && e.times > 1 ? ` ×${e.times}` : ''}${e.ifSlowed ? ' (ถ้าช้า)' : ''}` });
        if (e.pierce) out.push({ kw: 'pierce', text: e.pierce >= 1 ? '🗡' : `🗡${pct(e.pierce)}` });
        if (e.exec) out.push({ kw: 'exec', text: `🎯<${pct(e.exec[0])} ×${e.exec[1]}` });
        if (e.frozen) out.push({ kw: 'shatter', text: `🧊×${e.frozen}` });
        if (e.noShield) out.push({ kw: 'hit', text: `ไร้โล่ ×${e.noShield}` });
        if (e.leech) out.push({ kw: 'leech', text: `🩸${pct(e.leech)}` });
        if (e.burn) out.push({ kw: 'burn', text: `🔥${e.burn[0]} ${sec(e.burn[1])}/ครั้ง` });
        if (e.poison) out.push({ kw: 'poison', text: `☠${e.poison[0]} ${sec(e.poison[1])}/ครั้ง` });
        if (e.sure) out.push({ kw: 'sure', text: '👁' });
        break;
      }
      case 'shield': out.push({ kw: 'shield', text: `🛡${e.n}` }); break;
      case 'heal': out.push({ kw: 'heal', text: `❤${e.n}` }); break;
      case 'burn': out.push({ kw: 'burn', text: `🔥${e.dps}${e.growthHalf ? '+½💪' : ''} ${sec(e.secs)}${e.stacks && e.stacks > 1 ? ` ×${e.stacks}` : ''}` }); break;
      case 'poison': out.push({ kw: 'poison', text: `☠${e.dps} ${sec(e.secs)}${e.stacks && e.stacks > 1 ? ` ×${e.stacks}` : ''}` }); break;
      case 'dodge': out.push({ kw: 'dodge', text: `💨+${e.n}` }); break;
      case 'haste': out.push({ kw: 'haste', text: `⏩${pct(e.pct)} ${sec(e.secs)}` }); break;
      case 'wound': out.push({ kw: 'wound', text: `🩹${pct(e.pct)} ${sec(e.secs)}` }); break;
      case 'freeze': out.push({ kw: 'freeze', text: `❄${sec(e.secs)}` }); break;
      case 'slow': out.push({ kw: 'slow', text: `🐌${pct(e.pct)} ${sec(e.secs)}` }); break;
      case 'delay': out.push({ kw: 'delay', text: `⏪${sec(e.secs)}` }); break;
      case 'grow': out.push({ kw: 'grow', text: `💪+${e.n}` }); break;
      case 'charge': out.push({ kw: 'charge', text: `⚡×${e.mult}${e.hits && e.hits > 1 ? ` (${e.hits} ครั้ง)` : ''}` }); break;
      case 'thorns': out.push({ kw: 'thorns', text: `🌵${e.n}${e.perm ? ' ถาวร' : ''}${e.heal !== undefined ? ` ศัตรูฟื้น ${pct(e.heal)}` : ''}` }); break;
      case 'steadfast': out.push({ kw: 'steadfast', text: `🗿${e.keep !== undefined && e.keep !== 0.4 ? ` ${pct(1 - e.keep)}` : ''}${e.ignoreFreeze ? ' +กันแช่แข็ง 1 ครั้ง' : ''}` }); break;
      case 'cleanse': out.push({ kw: 'cleanse', text: `${e.n >= 99 ? '✨ทั้งหมด' : e.n > 1 ? `✨×${e.n}` : '✨'}${e.dot ? ' 🔥☠' : ''}${e.lineAll ? ' (ถนัดสาย: ล้างได้ทั้งหมด)' : ''}` }); break;
      case 'dispel': out.push({ kw: 'dispel', text: `${e.n >= 99 ? '💥ทั้งหมด' : e.n > 1 ? `💥×${e.n}` : '💥'}${e.shield !== undefined ? ` โล่${pct(e.shield)}` : ''}${e.steal ? ' ขโมยพลัง' : ''}` }); break;
      case 'leech': out.push({ kw: 'leech', text: `🩸${pct(e.pct)} ครั้งถัดไป` }); break;
    }
  }
  out.push({ kw: 'cd', text: `⏱${(cdTicks / 10).toFixed(1)}` });
  return out;
}
