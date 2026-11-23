import { ONE, P, mulP } from './fixed';
import { T } from './tuning';
import type { Archetype, StatusKind } from './types';

/** HP multiplier of a hero (tuning.ts) */
const hpOf = (id: string) => (hp: number) => Math.round(hp * T[`hp.${id}` as keyof typeof T]);
/** +N% text from a multiplier or share */
const pc = (x: number) => Math.round(x * 100);
/** 'เลือดสูงสุด ±N% · ' for heroes whose base passive has no HP part (empty at ×1) */
const hpTxt = (id: string) => {
  const m = T[`hp.${id}` as keyof typeof T];
  return m === 1 ? '' : `เลือดสูงสุด ${m > 1 ? '+' : '−'}${Math.abs(pc(m - 1))}% · `;
};

/** What a hook can see and do to its own fighter. Implemented by combat.ts. */
export interface HookFighter {
  readonly hero: string;
  readonly hp: number;
  readonly maxHp: number;
  readonly shield: number;
  /** the enemy is slowed / frozen right now */
  readonly foeSlowed: boolean;
  readonly foeFrozen: boolean;
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
  /** freeze this fighter applies to the enemy, in ppm ticks (sim v12), before diminishing returns */
  freezeTicks?(ticksP: number): number;
  /** thorns damage reflected when this fighter is hit: capped value, total thorns, size of the hit */
  thornsReflect?(capped: number, total: number, hit: number): number;
  /** thorns this fighter gains last this many seconds (default 10); สลายเวท only takes half of a stack */
  thornsSecs?: number;
  /** damage of each hit this fighter deals (after growth and charge); integer in, integer out (sim v12) */
  onHit?(me: HookFighter, dmg: number): number;
  /** seconds a burn this fighter applies lasts */
  burnSecs?(secs: number): number;
  /** slow this fighter applies, in ppm (sim v12): [share 0..ONE, seconds × ONE] */
  slow?(pctP: number, secsP: number): [number, number];
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
    passive: `เลือดสูงสุด +${pc(T['hp.knight'] - 1)}% และเริ่มสู้พร้อมโล่ ${pc(T['knight.shield'])}% ของเลือด`,
    style: 'กำแพงโล่: สะสมโล่ให้หนา แล้วใช้โล่กระแทกตีกลับแรงตามโล่ที่มี',
    hooks: { maxHp: hpOf('knight'), startShield: (n, max) => n + Math.round(max * T['knight.shield']) },
  },
  {
    id: 'thornguard', day1: ['spikewall', 'thorns', 'strike', 'shield', 'heavy'], name: 'นักรบหนาม', arch: 'tank', unique: 'spikewall',
    passive: `เลือดสูงสุด +${pc(T['hp.thornguard'] - 1)}% · หนามของคุณอยู่นาน 13 วิ (ปกติ 10) และสลายเวทลบได้แค่ครึ่งกอง · เริ่มสู้พร้อมหนาม 1 ที่ไม่หายไป`,
    style: 'ยิ่งโดนตียิ่งเจ็บ: สะสมหนาม ให้ศัตรูที่ตีถี่ๆ ทำร้ายตัวเอง แล้วปิดด้วยป้อมหนาม',
    hooks: {
      onStart(me) {
        me.thorns(1, true);
      },
      thornsSecs: 13,
      maxHp: hpOf('thornguard'),
    },
    botWant: ['thorns', 'spikewall', 'shield'],
  },
  // ---------------- burst ----------------
  {
    id: 'assassin', day1: ['execute', 'strike', 'jab', 'charge', 'heavy'], name: 'นักฆ่า', arch: 'burst', unique: 'execute',
    passive: `${hpTxt('assassin')}การตีครั้งแรกของการสู้แรง ×${T['assassin.first']}`,
    style: 'ตีทีเดียวจบ: รวมพลังแล้วปล่อยการโจมตีหนักๆ ปลิดชีพตอนศัตรูเลือดต่ำ',
    hooks: {
      maxHp: hpOf('assassin'),
      onHit(me, dmg) {
        me.flags.hits = (me.flags.hits ?? 0) + 1;
        return me.flags.hits === 1 ? mulP(dmg, P(T['assassin.first'])) : dmg;
      },
    },
  },
  {
    id: 'duelist', day1: ['flurry', 'jab', 'strike', 'charge', 'train'], name: 'นักดาบคู่', arch: 'burst', unique: 'flurry',
    passive: `${hpTxt('duelist')}การตีทุกครั้งที่ 3 ของคุณแรงขึ้น ${pc(T['duelist.third'])}% (อย่างน้อย +1)`,
    style: 'ตีรัวไม่หยุด: skill คูลดาวน์สั้นและตีหลายครั้ง ยิ่งตีถี่ยิ่งได้ครั้งที่ 3 บ่อย',
    hooks: {
      maxHp: hpOf('duelist'),
      onHit(me, dmg) {
        me.flags.hits = (me.flags.hits ?? 0) + 1;
        return me.flags.hits % 3 === 0 ? dmg + Math.max(1, mulP(dmg, P(T['duelist.third']))) : dmg;
      },
    },
    botWant: ['jab', 'flurry', 'strike'],
  },
  // ---------------- scaling ----------------
  {
    id: 'berserker', day1: ['rampage', 'train', 'strike', 'feast', 'ignite'], name: 'นักรบคลั่ง', arch: 'scaling', unique: 'rampage',
    passive: `เลือดสูงสุด +${pc(T['hp.berserker'] - 1)}% · โดนตีครบทุก ${T['berserker.hits']} ครั้ง ได้พลังโจมตี +1 · ครั้งแรกที่เลือดต่ำกว่าครึ่ง ได้พลังโจมตีอีก +2 (ทุกการโจมตีของทุก skill จนจบการสู้)`,
    style: 'โตไม่หยุด: สะสมพลังโจมตีทีละนิด ยิ่งสู้นานและยิ่งโดนตี ยิ่งตีแรง',
    hooks: {
      maxHp: hpOf('berserker'),
      onDamaged(me, _n, src) {
        if (src !== 'burn' && src !== 'fatigue' && src !== 'thorns' && me.hp > 0) {
          me.flags.hitsTaken = (me.flags.hitsTaken ?? 0) + 1;
          if (me.flags.hitsTaken % T['berserker.hits'] === 0) me.grow(1);
        }
        if (!me.flags.raged && me.hp > 0 && me.hp < me.maxHp / 2) {
          me.flags.raged = 1;
          me.grow(2);
          me.status('rage', 2);
        }
      },
    },
  },
  {
    id: 'pyro', day1: ['inferno', 'ignite', 'train', 'jab', 'chill'], name: 'นักเวทเพลิง', arch: 'scaling', unique: 'inferno',
    passive: `${hpTxt('pyro')}ไฟที่คุณจุดติดนานขึ้น ${pc(T['pyro.burn'] - 1)}%`,
    style: 'ไฟซ้อนไฟ: จุดไฟหลายกองให้ซ้อนกัน แล้วระเบิดเพลิงตามไฟที่ยังเหลือ (ไม่สนโล่)',
    hooks: { maxHp: hpOf('pyro'), burnSecs: (s) => mulP(s, P(T['pyro.burn'])) },
    botWant: ['ignite', 'inferno', 'amplify'],
  },
  // ---------------- control ----------------
  {
    id: 'witch', day1: ['shatter', 'frost', 'strike', 'chill', 'jab'], name: 'แม่มดน้ำแข็ง', arch: 'control', unique: 'shatter',
    passive: `เลือดสูงสุด +${pc(T['hp.witch'] - 1)}% · การแช่แข็งที่คุณใส่ศัตรูนานขึ้น ${T['witch.freeze']} วิ`,
    style: 'หยุดเวลา: แช่แข็งศัตรูแล้วทุบน้ำแข็งแรง x3 ระหว่างที่ศัตรูขยับไม่ได้',
    hooks: { maxHp: hpOf('witch'), freezeTicks: (tP) => tP + Math.round(T['witch.freeze'] * 10) * ONE },
  },
  {
    id: 'chrono', day1: ['timewarp', 'chill', 'frost', 'strike', 'dispel'], name: 'จอมเวทเวลา', arch: 'control', unique: 'timewarp',
    passive: `เลือดสูงสุด +${pc(T['hp.chrono'] - 1)}% · ความช้าที่คุณใส่แรงขึ้น +10% และนานขึ้น 1 วิ · ตีศัตรูที่ช้าหรือถูกแช่แข็งอยู่แรงขึ้น 10%`,
    style: 'ถ่วงเวลา: ทำให้ศัตรูช้าและดึงคูลดาวน์ถอยหลัง skill ศัตรูแทบไม่ได้ออก',
    hooks: {
      maxHp: hpOf('chrono'),
      slow: (p, s) => [p + 100_000, s + ONE],
      onHit: (me, dmg) => (me.foeSlowed || me.foeFrozen ? mulP(dmg, 1_100_000) : dmg),
    },
    botWant: ['timewarp', 'frost', 'chill'],
  },
];

export const HEROES_BY_ID: Record<string, HeroDef> = Object.fromEntries(HEROES.map((h) => [h.id, h]));
