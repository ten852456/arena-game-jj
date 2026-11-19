import type { Archetype, StatusKind } from './types';

/** What a hook can see and do to its own fighter. Implemented by combat.ts. */
export interface HookFighter {
  readonly hero: string;
  readonly hp: number;
  readonly maxHp: number;
  readonly shield: number;
  /** the enemy is slowed / frozen right now */
  readonly foeSlowed: boolean;
  readonly foeFrozen: boolean;
  /** enemy HP / enemy max HP (0..1) */
  readonly foeHpShare: number;
  /** per-fight scratch values for hooks (e.g. "already raged") */
  flags: Record<string, number>;
  grow(n: number): void;
  /** add thorns; permanent = never wears off */
  thorns(n: number, permanent?: boolean): void;
  addShield(n: number): void;
  status(kind: StatusKind, value: number): void;
}

/**
 * Combat hooks. Hero passives use them now; daily rules (Phase 3) will use the same interface.
 * Modifier hooks get the current value and return the new one.
 */
export interface CombatHooks {
  maxHp?(hp: number): number;
  startShield?(n: number, maxHp: number): number;
  onStart?(me: HookFighter): void;
  onDamaged?(me: HookFighter, amount: number, src: string): void;
  /** multiplier given by a charge skill this fighter casts */
  chargeMult?(m: number): number;
  /** freeze ticks this fighter applies to the enemy, before diminishing returns */
  freezeTicks?(ticks: number): number;
  /** thorns damage reflected when this fighter is hit: capped value, total thorns, size of the hit */
  thornsReflect?(capped: number, total: number, hit: number): number;
  /** thorns this fighter gains last this many seconds (default 10); สลายเวท only takes half of a stack */
  thornsSecs?: number;
  /** damage of each hit this fighter deals (after growth and charge) */
  onHit?(me: HookFighter, dmg: number): number;
  /** seconds a burn this fighter applies lasts */
  burnSecs?(secs: number): number;
  /** slow this fighter applies: [percent 0..1, seconds] */
  slow?(pct: number, secs: number): [number, number];
}

export interface HeroDef {
  id: string;
  name: string;
  arch: Archetype;
  passive: string;
  unique: string;
  /** how this hero plays, for หอฮีโร่ and the hero pick */
  style: string;
  hooks: CombatHooks;
  /** skills the bot likes for this hero (on top of its archetype) */
  botWant?: string[];
  /** the fixed day-1 shop (5 skills, same every run) */
  day1: string[];
}

export const HEROES: HeroDef[] = [
  // ---------------- tank ----------------
  {
    id: 'knight', day1: ['bulwark', 'shield', 'strike', 'stoneskin', 'jab'], name: 'อัศวิน', arch: 'tank', unique: 'bulwark',
    passive: 'เลือดสูงสุด +35% และเริ่มสู้พร้อมโล่ 6% ของเลือด',
    style: 'กำแพงโล่: สะสมโล่ให้หนา แล้วใช้โล่กระแทกตีกลับแรงตามโล่ที่มี',
    hooks: { maxHp: (hp) => Math.round(hp * 1.35), startShield: (n, max) => n + Math.round(max * 0.06) },
  },
  {
    id: 'thornguard', day1: ['spikewall', 'thorns', 'strike', 'shield', 'heavy'], name: 'นักรบหนาม', arch: 'tank', unique: 'spikewall',
    passive: 'เลือดสูงสุด +18% · หนามของคุณอยู่นาน 15 วิ (ปกติ 10) และสลายเวทลบได้แค่ครึ่งกอง · เริ่มสู้พร้อมหนาม 1 ที่ไม่หายไป · ระหว่างมีหนาม สะท้อนเพิ่มอีก 8% ของดาเมจที่โดน',
    style: 'ยิ่งโดนตียิ่งเจ็บ: สะสมหนาม ให้ศัตรูที่ตีถี่ๆ ทำร้ายตัวเอง แล้วปิดด้วยป้อมหนาม',
    hooks: {
      onStart(me) {
        me.thorns(1, true);
      },
      thornsSecs: 15,
      // + 8% of the hit: nothing on small early hits, matters against big (grown) hits later
      thornsReflect: (capped, total, hit) => (total > 0 ? capped + Math.floor(hit * 0.08) : capped),
      maxHp: (hp) => Math.round(hp * 1.18),
    },
    botWant: ['thorns', 'spikewall', 'shield'],
  },
  // ---------------- burst ----------------
  {
    id: 'assassin', day1: ['execute', 'strike', 'jab', 'charge', 'heavy'], name: 'นักฆ่า', arch: 'burst', unique: 'execute',
    passive: 'การตีครั้งแรกของการสู้แรง ×1.3 · ตีศัตรูที่เลือดต่ำกว่าครึ่งแรงขึ้น 10%',
    style: 'ตีทีเดียวจบ: รวมพลังแล้วปล่อยการโจมตีหนักๆ ปลิดชีพตอนศัตรูเลือดต่ำ',
    hooks: {
      onHit(me, dmg) {
        me.flags.hits = (me.flags.hits ?? 0) + 1;
        if (me.flags.hits === 1) return dmg * 1.3;
        return me.foeHpShare < 0.5 ? dmg * 1.1 : dmg;
      },
    },
  },
  {
    id: 'duelist', day1: ['flurry', 'jab', 'strike', 'charge', 'train'], name: 'นักดาบคู่', arch: 'burst', unique: 'flurry',
    passive: 'การตีทุกครั้งที่ 3 ของคุณแรงขึ้น 40% (อย่างน้อย +1)',
    style: 'ตีรัวไม่หยุด: skill คูลดาวน์สั้นและตีหลายครั้ง ยิ่งตีถี่ยิ่งได้ครั้งที่ 3 บ่อย',
    hooks: {
      onHit(me, dmg) {
        me.flags.hits = (me.flags.hits ?? 0) + 1;
        return me.flags.hits % 3 === 0 ? dmg + Math.max(1, Math.round(dmg * 0.4)) : dmg;
      },
    },
    botWant: ['jab', 'flurry', 'strike'],
  },
  // ---------------- scaling ----------------
  {
    id: 'berserker', day1: ['rampage', 'train', 'strike', 'feast', 'ignite'], name: 'นักรบคลั่ง', arch: 'scaling', unique: 'rampage',
    passive: 'เริ่มสู้ด้วยพลังโจมตี +2 · โดนตีครบทุก 5 ครั้ง ได้พลังโจมตีอีก +1 · ครั้งแรกที่เลือดต่ำกว่าครึ่ง ได้พลังโจมตีอีก +1 (ทุกการโจมตีของทุก skill จนจบการสู้)',
    style: 'โตไม่หยุด: สะสมพลังโจมตีทีละนิด ยิ่งสู้นานและยิ่งโดนตี ยิ่งตีแรง',
    hooks: {
      onStart(me) {
        me.grow(2);
      },
      onDamaged(me, _n, src) {
        if (src !== 'burn' && src !== 'fatigue' && src !== 'thorns' && me.hp > 0) {
          me.flags.hitsTaken = (me.flags.hitsTaken ?? 0) + 1;
          if (me.flags.hitsTaken % 5 === 0) me.grow(1);
        }
        if (!me.flags.raged && me.hp > 0 && me.hp < me.maxHp / 2) {
          me.flags.raged = 1;
          me.grow(1);
          me.status('rage', 1);
        }
      },
    },
  },
  {
    id: 'pyro', day1: ['inferno', 'ignite', 'train', 'jab', 'chill'], name: 'นักเวทเพลิง', arch: 'scaling', unique: 'inferno',
    passive: 'ไฟที่คุณจุดติดนานขึ้น 30%',
    style: 'ไฟซ้อนไฟ: จุดไฟหลายกองให้ซ้อนกัน แล้วระเบิดเพลิงตามไฟที่ยังเหลือ (ไม่สนโล่)',
    hooks: { burnSecs: (s) => Math.round(s * 1.3) },
    botWant: ['ignite', 'inferno', 'amplify'],
  },
  // ---------------- control ----------------
  {
    id: 'witch', day1: ['shatter', 'frost', 'strike', 'chill', 'jab'], name: 'แม่มดน้ำแข็ง', arch: 'control', unique: 'shatter',
    passive: 'เลือดสูงสุด +22% · การแช่แข็งที่คุณใส่ศัตรูนานขึ้น 0.3 วิ',
    style: 'หยุดเวลา: แช่แข็งศัตรูแล้วทุบน้ำแข็งแรง x3 ระหว่างที่ศัตรูขยับไม่ได้',
    hooks: { maxHp: (hp) => Math.round(hp * 1.22), freezeTicks: (t) => t + 3 },
  },
  {
    id: 'chrono', day1: ['timewarp', 'chill', 'frost', 'strike', 'dispel'], name: 'จอมเวทเวลา', arch: 'control', unique: 'timewarp',
    passive: 'เลือดสูงสุด +12% · ความช้าที่คุณใส่แรงขึ้น +10% · ตีศัตรูที่ช้าอยู่แรงขึ้น 10%',
    style: 'ถ่วงเวลา: ทำให้ศัตรูช้าและดึงคูลดาวน์ถอยหลัง skill ศัตรูแทบไม่ได้ออก',
    hooks: {
      maxHp: (hp) => Math.round(hp * 1.12),
      slow: (p, s) => [p + 0.1, s],
      onHit: (me, dmg) => (me.foeSlowed ? dmg * 1.1 : dmg),
    },
    botWant: ['timewarp', 'frost', 'chill'],
  },
];

export const HEROES_BY_ID: Record<string, HeroDef> = Object.fromEntries(HEROES.map((h) => [h.id, h]));
