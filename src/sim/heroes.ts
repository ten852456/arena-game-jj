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
  /** remove your strongest poison stack */
  shedPoison(): void;
  /** poison the enemy: dps per second for secs */
  poisonFoe(dps: number, secs: number): void;
  /** cut the enemy's healing by pct for secs */
  woundFoe(pct: number, secs: number): void;
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
  /** a direct hit of this fighter landed (was not dodged) */
  onLanded?(me: HookFighter): void;
  /** once every second of the fight (sec = whole seconds since the start) */
  onSecond?(me: HookFighter, sec: number): void;
  /** share of its cooldown the top skill of the list has already done when the fight starts */
  headStart?(): number;
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

/** Lv2 needs this share of the Lv1 trigger amount (sooner) */
export const ULT_LV2_TRIG = 0.75;
/** Lv2 effect power × this */
export const ULT_LV2_POW = 1.3;
/** pieces needed for ult Lv1 / Lv2 */
export const ULT_PIECES = [3, 4] as const;
/** Lv2 also needs this many line skills at Lv3 */
export const ULT_LV2_LV3 = 3;
const r1 = (x: number) => +x.toFixed(1);
/** heroes whose trigger is "HP below a share": a sooner trigger is a HIGHER share */
const TRIG_BELOW = ['assassin'];
/**
 * Heroes whose Lv2 keeps the Lv1 trigger: นักรบคลั่ง (a sooner "HP below" would waste the 1-HP survival) and
 * นักเวทเพลิง (1 burn stack would make every fight end the same way). Their Lv2 is only stronger.
 */
const TRIG_SAME = ['berserker', 'pyro'];
/** trigger amount at a level: counts round, shares stay shares; Lv2 needs 25% less (HP thresholds: 25% less HP missing) */
export const ultTrig = (hero: string, lv: number) => {
  const v = T[`ult.${hero}.trig` as keyof typeof T] ?? 0;
  if (lv < 2 || TRIG_SAME.includes(hero)) return v;
  if (TRIG_BELOW.includes(hero)) return r1(1 - (1 - v) * ULT_LV2_TRIG);
  return Number.isInteger(v) ? Math.max(2, Math.round(v * ULT_LV2_TRIG)) : +(v * ULT_LV2_TRIG).toFixed(2);
};
/** effect power at a level */
export const ultPow = (hero: string, lv: number) => (T[`ult.${hero}.pow` as keyof typeof T] ?? 0) * (lv >= 2 ? ULT_LV2_POW : 1);
const both = (f: (lv: number) => string) => `${f(1)} · Lv2 ${f(2)}`;

export const HEROES: HeroDef[] = [
  // ---------------- ⚔ hit ----------------
  {
    id: 'assassin', day1: ['execute', 'strike', 'heavy', 'charge', 'venom'], name: 'นักฆ่า', line: 'hit', unique: 'execute',
    passive: `${hpTxt('assassin')}การตีครั้งแรกของการสู้${T['assassin.every'] ? ` และทุกการตีครั้งที่ ${T['assassin.every']}` : ''} แรง ×${T['assassin.first']} · การตีที่โดนทำให้ศัตรูฟื้นน้อยลง ${pc(T['assassin.wound'])}% 2 วิ`,
    style: 'ตีทีเดียวจบ: รวมพลังแล้วปล่อยการโจมตีหนักๆ ปลิดชีพตอนศัตรูเลือดต่ำ',
    hooks: {
      maxHp: hpOf('assassin'),
      onHit(me, dmg) {
        me.flags.hits = (me.flags.hits ?? 0) + 1;
        const every = T['assassin.every'];
        return me.flags.hits === 1 || (every > 0 && me.flags.hits % every === 0) ? dmg * T['assassin.first'] : dmg;
      },
      onLanded(me) {
        me.woundFoe(T['assassin.wound'], 2);
      },
    },
    ult: {
      name: 'เงาจันทร์',
      get trigger() { return both((lv) => `ศัตรูเลือดต่ำกว่า ${pc(ultTrig('assassin', lv))}%`); },
      get effect() { return both((lv) => `ตีทันที ${pc(ultPow('assassin', lv))}% ของเลือดที่ศัตรูเสียไปแล้ว (ไม่เกิน ${pc(T['ult.cap'] * (lv >= 2 ? ULT_LV2_POW : 1))}% ของเลือดศัตรู) ไม่สนโล่ · แต้มหลบของศัตรูลดเหลือครึ่ง`); },
    },
  },
  // ---------------- 💨 dodge ----------------
  {
    id: 'duelist', day1: ['flurry', 'jab', 'riposte', 'sidestep', 'strike'], name: 'นักดาบคู่', line: 'dodge', unique: 'flurry',
    passive: `${hpTxt('duelist')}เริ่มสู้พร้อมหลบ 1${T['duelist.regen'] ? ` และได้หลบ +1 ทุก ${T['duelist.regen']} วิ` : ''} · เก็บแต้มหลบได้ ${T['dodge.cap'] + 1} · หลบได้แล้ว สะบัดพิษทิ้ง 1 กอง และการตีครั้งถัดไปแรง ×${T['duelist.counter']}`,
    style: 'หลบแล้วสวน: ตีเร็วสะสมแต้มหลบ ให้การตีของศัตรูพลาด แล้วสวนกลับแรงตามแต้มหลบที่มี',
    hooks: {
      maxHp: hpOf('duelist'),
      onStart(me) {
        me.dodge(1);
      },
      // ร่างเงา: a dodge charge every N seconds, so the duelist keeps dodging in long late fights
      onSecond(me, sec) {
        const n = T['duelist.regen'];
        if (n > 0 && sec > 0 && sec % n === 0) me.dodge(1);
      },
      onDodge(me) {
        me.flags.counter = 1;
        me.shedPoison();
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
      get trigger() { return both((lv) => `ได้โล่รวม (ไม่นับโล่เริ่มต้น) ${pc(ultTrig('knight', lv))}% ของเลือดสูงสุด`); },
      get effect() { return both((lv) => `ตีแรงเท่า (โล่ที่มี + ${pc(T['ult.knight.hp'])}% ของเลือดสูงสุด) ×${r1(ultPow('knight', lv))} (ไม่เกิน ${pc(T['ult.cap'] * (lv >= 2 ? ULT_LV2_POW : 1))}% ของเลือดศัตรู) หลบไม่ได้ (โล่ไม่หาย)`); },
    },
  },
  // ---------------- ❤ heal ----------------
  {
    id: 'berserker', day1: ['rampage', 'feast', 'train', 'mend', 'strike'], name: 'นักรบคลั่ง', line: 'heal', unique: 'rampage',
    passive: `${hpTxt('berserker')}โดนตีครบทุก ${T['berserker.hits']} ครั้ง ได้พลังโจมตี +1 · ครั้งแรกที่เลือดต่ำกว่าครึ่ง ได้พลังโจมตีอีก +2 (ทุกการโจมตีของทุก skill จนจบการสู้)`,
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
      get effect() { return both((lv) => `ไม่ตาย (เหลือ 1 เลือดถ้าโดนตีจนหมด) ฟื้น ${pc(ultPow('berserker', lv))}% ของเลือดสูงสุด + พลังตลอดการสู้ +${r1(T['ult.berserker.grow'] * 100 * (lv >= 2 ? 1.5 : 1))}% ของเลือดสูงสุด (อย่างน้อย 2)`); },
    },
  },
  // ---------------- 🔥 burn ----------------
  {
    id: 'pyro', day1: ['inferno', 'ignite', 'blaze', 'scorch', 'strike'], name: 'นักเวทเพลิง', line: 'burn', unique: 'inferno',
    passive: `${hpTxt('pyro')}ไฟที่คุณจุดติดนานขึ้น ${pc(T['pyro.burn'] - 1)}%`,
    style: 'ไฟซ้อนไฟ: จุดไฟหลายกองให้ซ้อนกัน แล้วระเบิดเพลิงตามไฟที่ยังเหลือ (ไม่สนโล่)',
    hooks: { maxHp: hpOf('pyro'), burnSecs: (s) => Math.round(s * T['pyro.burn']) },
    botWant: ['ignite', 'inferno', 'blaze'],
    ult: {
      name: 'สุริยะดับ',
      get trigger() { return both((lv) => `ไฟบนศัตรูครบ ${ultTrig('pyro', lv)} กอง`); },
      get effect() { return both((lv) => `ระเบิดทันทีเท่ากับไฟที่ยังเหลือ ×${r1(ultPow('pyro', lv))} (ไม่สนโล่ และไฟยังติดอยู่ต่อ)`); },
    },
  },
  // ---------------- ☠ poison ----------------
  {
    id: 'thornguard', day1: ['spikewall', 'venom', 'plague', 'thorns', 'strike'], name: 'นักรบหนามพิษ', line: 'poison', unique: 'spikewall',
    passive: `${hpTxt('thornguard')}skill บนสุดเริ่มสู้ด้วยคูลดาวน์ไปแล้ว ${pc(T['thornguard.head'])}% · โดนตีทุก 2 ครั้ง ศัตรูติดพิษ 1/วิ ${T['thornguard.poison']} วิ · หนามของคุณอยู่นาน 13 วิ และสลายเวทลบได้แค่ครึ่งกอง`,
    style: 'พิษซ้อนพิษ: ใครตีเราก็ติดพิษ สะสมพิษให้ซ้อนกันนานๆ แล้วระเบิดพิษปิดเกม (พิษไม่สนโล่และหลบไม่ได้)',
    hooks: {
      onDamaged(me, _n, src) {
        if (src === 'burn' || src === 'poison' || src === 'fatigue' || src === 'thorns' || src === 'ult' || me.hp <= 0) return;
        me.flags.hitsTaken = (me.flags.hitsTaken ?? 0) + 1;
        if (me.flags.hitsTaken % 2 === 0) me.poisonFoe(1, T['thornguard.poison']);
      },
      thornsSecs: 13,
      maxHp: hpOf('thornguard'),
      headStart: () => T['thornguard.head'],
    },
    botWant: ['venom', 'spikewall', 'plague'],
    ult: {
      name: 'หนามพิษ',
      get trigger() { return both((lv) => `โดนตีครบ ${ultTrig('thornguard', lv)} ครั้ง`); },
      get effect() { return both((lv) => `${r1(ultPow('thornguard', lv))} วิ: ศัตรูติดพิษ ${T['ult.thornguard.poison']}/วิ ทันที · ทุกครั้งที่โดนตี ศัตรูติดพิษอีก 2 กอง และฟื้นเลือดไม่ได้`); },
    },
  },
  // ---------------- ❄ ice ----------------
  {
    id: 'witch', day1: ['shatter', 'frost', 'icelance', 'glacier', 'strike'], name: 'แม่มดน้ำแข็ง', line: 'ice', unique: 'shatter',
    passive: `${hpTxt('witch')}การแช่แข็งที่คุณใส่ศัตรูนานขึ้น ${T['witch.freeze']} วิ${T['witch.wound'] ? ` · ตีโดนศัตรูที่ถูกแช่แข็ง ศัตรูฟื้นน้อยลง ${pc(T['witch.wound'])}% 3 วิ` : ''}`,
    style: 'หยุดเวลา: แช่แข็งศัตรูแล้วทุบน้ำแข็งแรง x3 ระหว่างที่ศัตรูขยับไม่ได้',
    hooks: {
      maxHp: hpOf('witch'),
      freezeTicks: (t) => t + Math.round(T['witch.freeze'] * 10),
      // น้ำแข็งกัดแผล: a landed hit while the enemy is frozen cuts its healing for 3 s (❄ > ❤)
      onLanded(me) {
        if (me.foeFrozen && T['witch.wound'] > 0) me.woundFoe(T['witch.wound'], 3);
      },
    },
    ult: {
      name: 'ยุคน้ำแข็ง',
      get trigger() { return both((lv) => `ใช้ skill สายน้ำแข็งครบ ${ultTrig('witch', lv)} ครั้ง`); },
      get effect() { return both((lv) => `แช่แข็ง ${r1(ultPow('witch', lv))} วิ + การตีถัดไป ×${lv >= 2 ? 2.4 : 2}`); },
    },
  },
  // ---------------- 🌪 wind ----------------
  {
    id: 'chrono', day1: ['timewarp', 'chill', 'tailwind', 'dispel', 'strike'], name: 'จอมเวทลม', line: 'wind', unique: 'timewarp',
    passive: `${hpTxt('chrono')}ความช้าที่คุณใส่แรงขึ้น +10% และนานขึ้น 1 วิ · ตีศัตรูที่ช้าหรือถูกแช่แข็งอยู่แรงขึ้น ${pc(T['chrono.slowHit'])}% · ศัตรูที่ช้าหลบได้ไม่เต็ม (โดน ${pc(T['chrono.graze'])}% แทน ${pc(T['dodge.graze'])}%)`,
    style: 'ลมพัดเวลา: ทำให้ศัตรูช้า ดึงคูลดาวน์ถอยหลัง เร่งตัวเอง และพัดไฟ/พิษทิ้ง',
    hooks: {
      maxHp: hpOf('chrono'),
      slow: (p, s) => [p + 0.1, s + 1],
      onHit: (me, dmg) => (me.foeSlowed || me.foeFrozen ? dmg * (1 + T['chrono.slowHit']) : dmg),
    },
    botWant: ['timewarp', 'chill', 'tailwind'],
    ult: {
      name: 'พายุย้อนกาล',
      get trigger() { return both((lv) => `ใส่ช้า/ถ่วงเวลาติดครบ ${ultTrig('chrono', lv)} ครั้ง`); },
      get effect() { return both((lv) => `คูลดาวน์ทุกตัวเดินหน้าทันที ${pc(Math.min(1, ultPow('chrono', lv)))}% + พัดดีบัฟทิ้งทั้งหมด`); },
    },
  },
];

export const HEROES_BY_ID: Record<string, HeroDef> = Object.fromEntries(HEROES.map((h) => [h.id, h]));

/**
 * Ultimate pieces (sim v16, one rule for code and text): every skill of the hero's line you own is one piece (the unique
 * is one of them), at most 4. Lv1 = ULT_PIECES[0] pieces; Lv2 = all 4 pieces AND ULT_LV2_LV3 of them at Lv3.
 * Pure function of the build, so the server and the replay agree.
 */
export function ultPieces(b: Pick<Build, 'hero' | 'skills'>): number {
  return b.skills.filter((k) => inLine(b.hero, k.id)).length;
}
/** line skills of the build that are Lv3 */
export const ultLv3 = (b: Pick<Build, 'hero' | 'skills'>) => b.skills.filter((k) => inLine(b.hero, k.id) && lvOf(k.v) >= 3).length;
/** ถนัดสาย of a hero: its line skills work at this power (tuning.ts `aff.<hero>`, default `line.affinity`) */
export const lineAffinity = (hero: string) => T[`aff.${hero}` as keyof typeof T] ?? T['line.affinity'];
/** Is this skill one of the hero's line pieces (a shared skill of its main line, or its own unique)? */
export function inLine(hero: string, id: string): boolean {
  const d = SKILLS[id];
  const line = HEROES_BY_ID[hero]?.line;
  return !!d && !!line && d.line === line && (!d.hero || d.hero === hero);
}
/**
 * What buying a shop offer does to the ultimate: pieces gained (0 / 1) and the ult level after it.
 * A new skill of the line is +1; an upgrade to Lv3 is +1 only while no line skill is Lv3 yet. (shop labels, play CLI)
 */
export function ultGain(b: Pick<Build, 'hero' | 'skills'>, offer: { id: string; v: string }): { pieces: number; lv: number } {
  if (!inLine(b.hero, offer.id)) return { pieces: 0, lv: ultLevel(b) };
  const after = offer.v === ''
    ? [...b.skills, { id: offer.id, v: '' }]
    : b.skills.map((k) => (k.id === offer.id ? { ...k, v: offer.v } : k));
  const next = { hero: b.hero, skills: after };
  // pieces gained, or (for an upgrade to Lv3) a Lv3 toward Lv2
  return { pieces: ultPieces(next) - ultPieces(b) + (ultLv3(next) > ultLv3(b) && ultLv3(b) < ULT_LV2_LV3 ? 1 : 0), lv: ultLevel(next) };
}
/** 0 = locked, 1 = 3 line pieces, 2 = 4 line pieces with 2 of them at Lv3 */
export const ultLevel = (b: Pick<Build, 'hero' | 'skills'>) => {
  const p = ultPieces(b);
  return p >= ULT_PIECES[1] && ultLv3(b) >= ULT_LV2_LV3 ? 2 : p >= ULT_PIECES[0] ? 1 : 0;
};
/** "Lv1 ✓ · Lv2: 4/4 ชิ้น · Lv3 1/2" — the progress line for the shop, HUD and play CLI */
export function ultProgressText(b: Pick<Build, 'hero' | 'skills'>, th = true) {
  const p = ultPieces(b);
  const l3 = Math.min(ultLv3(b), ULT_LV2_LV3);
  const lv = ultLevel(b);
  if (lv >= 2) return th ? 'ท่าไม้ตาย Lv2 ✓ (เต็ม)' : 'Ult Lv2 ✓ (max)';
  if (lv === 1)
    return th
      ? `ท่าไม้ตาย Lv1 ✓ · Lv2: สกิลสาย ${ULT_PIECES[1]} ตัว, Lv3 ${ULT_LV2_LV3} ตัว (ตอนนี้ ${Math.min(p, ULT_PIECES[1])} · ${l3})`
      : `Ult Lv1 ✓ · Lv2: ${ULT_PIECES[1]} line skills, ${ULT_LV2_LV3} at Lv3 (now ${Math.min(p, ULT_PIECES[1])} · ${l3})`;
  return th ? `ท่าไม้ตาย Lv1: สกิลสาย ${p}/${ULT_PIECES[0]}` : `Ult Lv1: line skills ${p}/${ULT_PIECES[0]}`;
}
/** the rule in one line */
export const ultRuleText = (th = true) =>
  th
    ? `skill สายหลักที่มี (รวมสกิลประจำตัว) = 1 ชิ้น · ${ULT_PIECES[0]} ชิ้น = Lv1 · ครบ ${ULT_PIECES[1]} ชิ้นและ Lv3 ${ULT_LV2_LV3} ตัว = Lv2`
    : `each line skill you own (unique included) = 1 piece · ${ULT_PIECES[0]} pieces = Lv1 · all ${ULT_PIECES[1]} pieces with ${ULT_LV2_LV3} at Lv3 = Lv2`;
