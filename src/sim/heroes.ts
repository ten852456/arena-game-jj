import { T } from './tuning';
import { SKILLS, lvOf } from './skills';
import type { Build, Line, StatusKind } from './types';

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
  /** gain dodge charges (capped) */
  dodge(n: number): void;
  /** poison the enemy: dps per second for secs */
  poisonFoe(dps: number, secs: number): void;
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
  /** this fighter dodged a hit */
  onDodge?(me: HookFighter): void;
}

/** What a hero's ultimate does, in words (Thai; client/i18n_en.ts has English). Numbers come from tuning.ts. */
export interface UltInfo {
  name: string;
  /** when it fires (Lv1 · Lv2) */
  trigger: string;
  /** what it does (Lv1 · Lv2) */
  effect: string;
}

export interface HeroDef {
  id: string;
  name: string;
  /** main line: its skills (and the hero's unique) are the pieces that unlock the ultimate */
  line: Line;
  passive: string;
  unique: string;
  /** how this hero plays, for หอฮีโร่ and the hero pick */
  style: string;
  hooks: CombatHooks;
  ult: UltInfo;
  /** skills the bot likes for this hero (on top of its line) */
  botWant?: string[];
  /** the fixed day-1 shop (5 skills, same every run) */
  day1: string[];
}

/** Lv2 needs this share of the Lv1 trigger amount (30% sooner) */
export const ULT_LV2_TRIG = 0.7;
/** Lv2 effect power × this */
export const ULT_LV2_POW = 1.4;
/** pieces needed for ult Lv1 / Lv2 */
export const ULT_PIECES = [3, 5] as const;
const r1 = (x: number) => +x.toFixed(1);
/** trigger amount at a level: counts round, shares stay shares */
export const ultTrig = (hero: string, lv: number) => {
  const v = T[`ult.${hero}.trig` as keyof typeof T] ?? 0;
  if (lv < 2) return v;
  return Number.isInteger(v) ? Math.max(1, Math.round(v * ULT_LV2_TRIG)) : r1(1 - (1 - v) * ULT_LV2_TRIG);
};
/** effect power at a level */
export const ultPow = (hero: string, lv: number) => (T[`ult.${hero}.pow` as keyof typeof T] ?? 0) * (lv >= 2 ? ULT_LV2_POW : 1);
const both = (f: (lv: number) => string) => `${f(1)} · Lv2 ${f(2)}`;

export const HEROES: HeroDef[] = [
  // ---------------- ⚔ hit ----------------
  {
    id: 'assassin', day1: ['execute', 'strike', 'heavy', 'charge', 'jab'], name: 'นักฆ่า', line: 'hit', unique: 'execute',
    passive: `${hpTxt('assassin')}การตีครั้งแรกของการสู้แรง ×${T['assassin.first']}`,
    style: 'ตีทีเดียวจบ: รวมพลังแล้วปล่อยการโจมตีหนักๆ ปลิดชีพตอนศัตรูเลือดต่ำ',
    hooks: {
      maxHp: hpOf('assassin'),
      onHit(me, dmg) {
        me.flags.hits = (me.flags.hits ?? 0) + 1;
        return me.flags.hits === 1 ? dmg * T['assassin.first'] : dmg;
      },
    },
    ult: {
      name: 'เงาจันทร์',
      get trigger() { return both((lv) => `ศัตรูเลือดต่ำกว่า ${pc(ultTrig('assassin', lv))}%`); },
      get effect() { return both((lv) => `ตีทันที ×${r1(ultPow('assassin', lv))} ของการตีที่แรงสุดในการสู้นี้ (ไม่เกิน ${pc(T['ult.cap'] * (lv >= 2 ? ULT_LV2_POW : 1))}% ของเลือดศัตรู) ไม่สนโล่ หลบไม่ได้`); },
    },
  },
  // ---------------- 💨 dodge ----------------
  {
    id: 'duelist', day1: ['flurry', 'jab', 'riposte', 'sidestep', 'strike'], name: 'นักดาบคู่', line: 'dodge', unique: 'flurry',
    passive: `${hpTxt('duelist')}เริ่มสู้พร้อมหลบ 1 · หลบได้แล้ว การตีครั้งถัดไปแรง ×${T['duelist.counter']}`,
    style: 'หลบแล้วสวน: ตีเร็วสะสมแต้มหลบ ให้การตีของศัตรูพลาด แล้วสวนกลับแรงตามแต้มหลบที่มี',
    hooks: {
      maxHp: hpOf('duelist'),
      onStart(me) {
        me.dodge(1);
      },
      onDodge(me) {
        me.flags.counter = 1;
      },
      onHit(me, dmg) {
        if (!me.flags.counter) return dmg;
        me.flags.counter = 0;
        return dmg * T['duelist.counter'];
      },
    },
    botWant: ['jab', 'flurry', 'riposte'],
    ult: {
      name: 'ร่ายรำดาบ',
      get trigger() { return both((lv) => `หลบครบ ${ultTrig('duelist', lv)} ครั้ง`); },
      get effect() { return both((lv) => `คูลดาวน์ทุกตัวเร็วขึ้น ${pc(ultPow('duelist', lv))}% นาน 3 วิ + หลบ +2`); },
    },
  },
  // ---------------- 🛡 shield ----------------
  {
    id: 'knight', day1: ['bulwark', 'shield', 'stoneskin', 'cleanse', 'strike'], name: 'อัศวิน', line: 'shield', unique: 'bulwark',
    passive: `เลือดสูงสุด +${pc(T['hp.knight'] - 1)}% และเริ่มสู้พร้อมโล่ ${pc(T['knight.shield'])}% ของเลือด`,
    style: 'กำแพงโล่: สะสมโล่ให้หนา แล้วใช้โล่กระแทกตีกลับแรงตามโล่ที่มี',
    hooks: { maxHp: hpOf('knight'), startShield: (n, max) => n + Math.round(max * T['knight.shield']) },
    ult: {
      name: 'ป้อมจันทรา',
      get trigger() { return both((lv) => `ได้โล่รวม ${pc(ultTrig('knight', lv))}% ของเลือดสูงสุด`); },
      get effect() { return both((lv) => `ตีแรงเท่าโล่ที่มี ×${r1(ultPow('knight', lv))} (ไม่เกิน ${pc(T['ult.cap'] * (lv >= 2 ? ULT_LV2_POW : 1))}% ของเลือดศัตรู) หลบไม่ได้ (โล่ไม่หาย)`); },
    },
  },
  // ---------------- ❤ heal ----------------
  {
    id: 'berserker', day1: ['rampage', 'feast', 'train', 'mend', 'strike'], name: 'นักรบคลั่ง', line: 'heal', unique: 'rampage',
    passive: `เลือดสูงสุด +${pc(T['hp.berserker'] - 1)}% · โดนตีครบทุก ${T['berserker.hits']} ครั้ง ได้พลังโจมตี +1 · ครั้งแรกที่เลือดต่ำกว่าครึ่ง ได้พลังโจมตีอีก +2 (ทุกการโจมตีของทุก skill จนจบการสู้)`,
    style: 'ดูดเลือดไม่หยุด: ฟื้นและดูดเลือดให้อยู่นาน ยิ่งสู้นานและยิ่งโดนตี ยิ่งตีแรง',
    hooks: {
      maxHp: hpOf('berserker'),
      onDamaged(me, _n, src) {
        if (src !== 'burn' && src !== 'poison' && src !== 'fatigue' && src !== 'thorns' && me.hp > 0) {
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
    botWant: ['feast', 'rampage', 'train'],
    ult: {
      name: 'ไม่ยอมตาย',
      get trigger() { return both((lv) => `เลือดต่ำกว่า ${pc(ultTrig('berserker', lv))}% หรือโดนตีจนเลือดหมด`); },
      get effect() { return both((lv) => `ไม่ตาย (เหลือ 1 เลือดถ้าโดนตีจนหมด) ฟื้น ${pc(ultPow('berserker', lv))}% ของเลือดสูงสุด + พลัง +${lv >= 2 ? 3 : 2}`); },
    },
  },
  // ---------------- 🔥 burn ----------------
  {
    id: 'pyro', day1: ['inferno', 'ignite', 'blaze', 'scorch', 'jab'], name: 'นักเวทเพลิง', line: 'burn', unique: 'inferno',
    passive: `${hpTxt('pyro')}ไฟที่คุณจุดติดนานขึ้น ${pc(T['pyro.burn'] - 1)}%`,
    style: 'ไฟซ้อนไฟ: จุดไฟหลายกองให้ซ้อนกัน แล้วระเบิดเพลิงตามไฟที่ยังเหลือ (ไม่สนโล่)',
    hooks: { maxHp: hpOf('pyro'), burnSecs: (s) => Math.round(s * T['pyro.burn']) },
    botWant: ['ignite', 'inferno', 'blaze'],
    ult: {
      name: 'สุริยะดับ',
      get trigger() { return both((lv) => `ไฟบนศัตรูครบ ${ultTrig('pyro', lv)} กอง`); },
      get effect() { return both((lv) => `ไฟที่ยังเหลือทั้งหมดระเบิดทันที ×${r1(ultPow('pyro', lv))} (ไม่สนโล่ ไฟกองนั้นหมดไป)`); },
    },
  },
  // ---------------- ☠ poison ----------------
  {
    id: 'thornguard', day1: ['spikewall', 'venom', 'plague', 'thorns', 'strike'], name: 'นักรบหนามพิษ', line: 'poison', unique: 'spikewall',
    passive: `เลือดสูงสุด +${pc(T['hp.thornguard'] - 1)}% · ทุกครั้งที่โดนตี ศัตรูติดพิษ 1/วิ ${T['thornguard.poison']} วิ · หนามของคุณอยู่นาน 13 วิ และสลายเวทลบได้แค่ครึ่งกอง`,
    style: 'พิษซ้อนพิษ: ใครตีเราก็ติดพิษ สะสมพิษให้ซ้อนกันนานๆ แล้วระเบิดพิษปิดเกม (พิษไม่สนโล่และหลบไม่ได้)',
    hooks: {
      onDamaged(me, _n, src) {
        if (src !== 'burn' && src !== 'poison' && src !== 'fatigue' && src !== 'thorns' && me.hp > 0) me.poisonFoe(1, T['thornguard.poison']);
      },
      thornsSecs: 13,
      maxHp: hpOf('thornguard'),
    },
    botWant: ['venom', 'spikewall', 'plague'],
    ult: {
      name: 'หนามพิษ',
      get trigger() { return both((lv) => `โดนตีครบ ${ultTrig('thornguard', lv)} ครั้ง`); },
      get effect() { return both((lv) => `${r1(ultPow('thornguard', lv))} วิ: ทุกครั้งที่โดนตี ศัตรูติดพิษอีก 2 กอง และฟื้นเลือดไม่ได้`); },
    },
  },
  // ---------------- ❄ ice ----------------
  {
    id: 'witch', day1: ['shatter', 'frost', 'icelance', 'glacier', 'strike'], name: 'แม่มดน้ำแข็ง', line: 'ice', unique: 'shatter',
    passive: `เลือดสูงสุด +${pc(T['hp.witch'] - 1)}% · การแช่แข็งที่คุณใส่ศัตรูนานขึ้น ${T['witch.freeze']} วิ`,
    style: 'หยุดเวลา: แช่แข็งศัตรูแล้วทุบน้ำแข็งแรง x3 ระหว่างที่ศัตรูขยับไม่ได้',
    hooks: { maxHp: hpOf('witch'), freezeTicks: (t) => t + Math.round(T['witch.freeze'] * 10) },
    ult: {
      name: 'ยุคน้ำแข็ง',
      get trigger() { return both((lv) => `ใช้ skill สายน้ำแข็งครบ ${ultTrig('witch', lv)} ครั้ง`); },
      get effect() { return both((lv) => `แช่แข็ง ${r1(ultPow('witch', lv))} วิ (ไม่ลดจากโดนถี่ แต่ยังอยู่ใต้เพดาน) + การตีถัดไป ×${lv >= 2 ? 2.4 : 2}`); },
    },
  },
  // ---------------- 🌪 wind ----------------
  {
    id: 'chrono', day1: ['timewarp', 'chill', 'tailwind', 'dispel', 'jab'], name: 'จอมเวทลม', line: 'wind', unique: 'timewarp',
    passive: `เลือดสูงสุด +${pc(T['hp.chrono'] - 1)}% · ความช้าที่คุณใส่แรงขึ้น +10% และนานขึ้น 1 วิ · ตีศัตรูที่ช้าหรือถูกแช่แข็งอยู่แรงขึ้น 10%`,
    style: 'ลมพัดเวลา: ทำให้ศัตรูช้า ดึงคูลดาวน์ถอยหลัง เร่งตัวเอง และพัดไฟ/พิษทิ้ง',
    hooks: {
      maxHp: hpOf('chrono'),
      slow: (p, s) => [p + 0.1, s + 1],
      onHit: (me, dmg) => (me.foeSlowed || me.foeFrozen ? dmg * 1.1 : dmg),
    },
    botWant: ['timewarp', 'chill', 'tailwind'],
    ult: {
      name: 'พายุย้อนกาล',
      get trigger() { return both((lv) => `ใส่ช้า/ถ่วงเวลาติดครบ ${ultTrig('chrono', lv)} ครั้ง`); },
      get effect() { return both((lv) => `skill ทุกตัวพร้อมใช้ทันที + พัดดีบัฟทิ้งทั้งหมด + เร็วขึ้น ${pc(ultPow('chrono', lv))}% 3 วิ`); },
    },
  },
];

export const HEROES_BY_ID: Record<string, HeroDef> = Object.fromEntries(HEROES.map((h) => [h.id, h]));

/**
 * Ultimate pieces of a build: every skill of the hero's main line (its unique counts) is 1 piece, +1 more at Lv3.
 * Pure function of the build, so the server and the replay agree.
 */
export function ultPieces(b: Pick<Build, 'hero' | 'skills'>): number {
  const line = HEROES_BY_ID[b.hero]?.line;
  if (!line) return 0;
  let n = 0;
  for (const k of b.skills) {
    const d = SKILLS[k.id];
    if (!d || d.line !== line || (d.hero && d.hero !== b.hero)) continue;
    n += lvOf(k.v) >= 3 ? 2 : 1;
  }
  return n;
}
/** 0 = locked, 1 = 3 pieces, 2 = 5 pieces */
export const ultLevel = (b: Pick<Build, 'hero' | 'skills'>) => {
  const p = ultPieces(b);
  return p >= ULT_PIECES[1] ? 2 : p >= ULT_PIECES[0] ? 1 : 0;
};
