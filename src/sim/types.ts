/**
 * The 8 lines (สาย): the identity system of skills and heroes. Each line beats 2 others and loses to 2 (softly,
 * through mechanics: shields block hits, burn/poison ignore shields and cannot be dodged, dodge negates hits,
 * heal out-sustains DoT, wind cleanses DoT, ice stops fast and healing cooldowns). docs/DESIGN_LINES_ULT.md.
 */
export type Line = 'hit' | 'dodge' | 'shield' | 'heal' | 'burn' | 'poison' | 'ice' | 'wind';
export const LINES: Line[] = ['hit', 'dodge', 'shield', 'heal', 'burn', 'poison', 'ice', 'wind'];

export type Mark = 'burn' | 'echo' | 'quick' | 'steadfast';

/**
 * Connect bonus effects (values in links.ts bonusValue):
 * dmg: every hit of this skill deals more · shield: gain shield when it fires
 * haste: shorter cooldown · power: all numbers of this skill stronger
 * trigger: when it fires, the matching neighbour fires right away too (its cooldown is not reset)
 */
export type BonusKind = 'dmg' | 'shield' | 'haste' | 'power' | 'trigger';

/** Active when the skill right above or right below matches t: a skill id, or 'line:<line>'. */
export interface Bonus {
  t: string;
  e: BonusKind;
}

/** One equipped skill. Every skill runs its own cooldown in parallel; neighbours in the list can turn on connect bonuses. */
export interface SkillInstance {
  id: string;
  /** tree variant: '' = Lv1, 'a' / 'b' = Lv2, 'a1' 'a2' 'b1' 'b2' = Lv3 (see skills.ts) */
  v: string;
  mark?: Mark;
  /** connect bonuses rolled when this copy was bought (kept through upgrades) */
  bonus?: Bonus[];
}

/** A build is a hero plus its skill list, top to bottom. Neighbours (above / below) can turn on connect bonuses. */
export interface Build {
  hero: string;
  skills: SkillInstance[];
  /** cosmetic look seed for the chibi art (colours, ears, face, outfit); never read by the sim */
  look?: number;
}

export type Side = 0 | 1;

export type StatusKind =
  | 'burn' // side = target
  | 'freeze' // side = target, value = ticks (0 = resisted)
  | 'slow' // side = target, value = percent
  | 'grow' // side = self, value = total growth
  | 'charge' // side = self, value = multiplier
  | 'thorns' // side = self, value = total thorns
  | 'steadfast' // side = self
  | 'rage' // side = self (hero passive)
  | 'cleanse' // side = self, value = debuffs removed
  | 'dispel' // side = target, value = buffs removed
  | 'delay' // side = target, value = cooldown ticks pushed back (0 = resisted)
  | 'dodge' // side = self, value = dodge charges now (after gaining)
  | 'evade' // side = the fighter that dodged a hit, value = dodge charges left
  | 'poison' // side = target, value = total poison per second
  | 'haste' // side = self, value = percent faster cooldowns
  | 'wound'; // side = target, value = percent less healing

/** Buffs and debuffs on one fighter right after an event (for the status UI). */
export interface Fx {
  /** growth (+damage per hit) */
  g: number;
  /** charge multiplier on the next hit (1 = none) */
  c: number;
  /** thorns */
  th: number;
  /** ใจเหล็ก */
  sf: 0 | 1;
  /** total burn per second */
  b: number;
  /** frozen ticks left */
  fr: number;
  /** slow percent (0 = not slowed) and ticks left */
  sl: number;
  slt: number;
  /** dodge charges (added in sim v12) */
  dg: number;
  /** total poison per second */
  p: number;
  /** haste percent (0 = none) and ticks left */
  hs: number;
  hst: number;
}

/** Per-block stats for the post-fight breakdown. Index = build.skills index. */
export interface BlockStat {
  /** fires on its own cooldown */
  c: number;
  /** fires set off by a neighbour's trigger bonus */
  tc: number;
  /** damage that came from connect bonuses (+damage and power) */
  bd: number;
  /** damage dealt (including what shields blocked) */
  d: number;
  /** damage that this block's buffs (พลังโจมตี stacks, รวมพลัง) added to hits of ANY block */
  bf: number;
  /** HP healed */
  h: number;
  /** shield gained */
  sh: number;
  /** control ticks applied to the enemy (freeze + cooldown delay) */
  fz: number;
}

export interface Snap {
  hp: [number, number];
  sh: [number, number];
  fx: [Fx, Fx];
}

export type EventBody =
  /** idx = index into that side's build.skills */
  | {
      type: 'cast'; side: Side; skill: string; lv: number; idx: number; echo?: boolean;
      /** set off by this skill (its trigger bonus, or an engine: ฟันเฟือง / เร่งเครื่อง) */
      from?: number;
      /** fired early as a reaction to control (skills with ✨ ชำระ or 🗿 ใจเหล็ก) */
      react?: boolean;
    }
  | { type: 'damage'; side: Side; amount: number; blocked: number; src: string }
  | { type: 'shield'; side: Side; amount: number }
  | { type: 'heal'; side: Side; amount: number }
  | { type: 'status'; side: Side; status: StatusKind; value: number }
  | { type: 'fatigue'; amount: number }
  /** the hero's ultimate fired (once per fight at most); its effects follow as normal events */
  | { type: 'ult'; side: Side; hero: string; lv: number }
  | { type: 'end'; winner: Side | -1 };

/** t = tick (10 ticks per second). s = HP/shield snapshot AFTER the event. */
export type CombatEvent = EventBody & { t: number; s: Snap };

/** Per-side summary of one fight (for the result screen: skills that never fired, time spent controlled). */
export interface SideStat {
  /** skill fires (own cooldown + set off by others + reactions; echo repeats not counted) */
  casts: number;
  /** build.skills indexes of skills that never fired this fight */
  never: number[];
  /** ticks this side spent frozen */
  fr: number;
  /** cooldown ticks pushed back by cast delay */
  dl: number;
  /** ticks this side spent slowed */
  sl: number;
  /** fr + dl + slowed ticks × slow share: cooldown ticks lost to control in total */
  ctl: number;
  /** control effects resisted (control cap, the control-immunity window, ใจเหล็ก's ignore) */
  resisted: number;
  /** ultimate level unlocked by the build (0 = none; added in sim v12) */
  ultLv?: number;
  /** tick the ultimate fired, -1 = it did not */
  ult?: number;
  /** hits this side dodged */
  dodged?: number;
}

export interface CombatResult {
  v: number;
  seed: number;
  day: number;
  winner: Side | -1;
  ticks: number;
  maxHp: [number, number];
  init: Snap;
  events: CombatEvent[];
  stats: [BlockStat[], BlockStat[]];
  /** per-side summary (added in sim v10; older saved fights do not have it) */
  sides?: [SideStat, SideStat];
  /** only when simulate(..., { trace: true }): per tick cooldown progress, see CooldownTrace */
  trace?: CooldownTrace;
}

/**
 * Cooldown progress of every skill at every tick, for the replay's clock-wipe.
 * p[side][tick * n[side] + idx] = progress 0..255 (255 = ready), idx = build.skills index.
 * Not sent by the server: the browser re-runs the deterministic fight locally to get it.
 */
export interface CooldownTrace {
  n: [number, number];
  p: [Uint8Array, Uint8Array];
  /** frozen flag per tick per side (1 = frozen) */
  fr: [Uint8Array, Uint8Array];
}
