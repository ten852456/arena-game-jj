//! Data types: skill definitions (generated in data.rs) and build input.

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum EngineKind {
    Gear,
    Overclock,
}

#[derive(Clone, Copy, Debug)]
pub struct Engine {
    pub kind: EngineKind,
    /// ppm
    pub power: i64,
    pub n: u8,
    pub keep: bool,
}

/// A hit effect. All decimals are ppm; 0 means "not set" for the optional multipliers.
#[derive(Clone, Copy, Debug)]
pub struct Hit {
    pub n: i64,
    pub times: u8,
    pub pierce: i64,
    pub exec_hp: i64,
    pub exec_m: i64,
    pub frozen: i64,
    pub no_shield: i64,
    pub shield_pct: i64,
    pub thorns_x: i64,
    pub burn_pct: i64,
    pub if_slowed: bool,
    pub leech: i64,
    pub burn_dps: i64,
    pub burn_secs: i64,
    pub per_removed: i64,
}

/// One effect. Amounts scaled by cast power are ppm (n × ONE); counts and caps are plain integers.
#[derive(Clone, Copy, Debug)]
pub enum Eff {
    Hit(Hit),
    Shield(i64),
    Heal(i64),
    Burn { dps: i64, secs: i64, growth_half: bool },
    Freeze(i64),
    Slow { pct: i64, secs: i64 },
    Delay(i64),
    Grow(i64),
    Charge { mult: i64, hits: i64 },
    /// heal = -1: not set
    Thorns { n: i64, perm: bool, heal: i64 },
    Steadfast { keep: i64, ignore_freeze: bool },
    Cleanse(i64),
    Dispel { n: i64, shield: i64, steal: bool },
    Amplify(i64),
    Leech(i64),
}

pub struct Node {
    pub cd: i64,
    pub engine: Option<Engine>,
    /// has cleanse or steadfast: fires early when its owner is controlled
    pub reacts: bool,
    pub fx: &'static [Eff],
}

pub struct SkillDef {
    /// 0..3 = ARCHES (tank, burst, scaling, control), 4 = none
    pub arch: u8,
    /// owning hero index, 255 = shared
    pub hero: u8,
    /// variants in VARIANTS order: '', a, b, a1, a2, b1, b2
    pub tree: [Node; 7],
}

pub const MAX_SKILLS: usize = 8;
pub const MARK_NONE: u8 = 0;
pub const MARK_BURN: u8 = 1;
pub const MARK_ECHO: u8 = 2;
pub const MARK_QUICK: u8 = 3;
pub const MARK_STEADFAST: u8 = 4;
/// bonus kinds in BONUS_KINDS order
pub const BK_DMG: u8 = 0;
pub const BK_SHIELD: u8 = 1;
pub const BK_HASTE: u8 = 2;
pub const BK_POWER: u8 = 3;
pub const BK_TRIGGER: u8 = 4;
/// bonus target: a skill index, or ARCH_TARGET + arch index
pub const ARCH_TARGET: u8 = 200;

#[repr(C)]
#[derive(Clone, Copy, Default, Debug, PartialEq, Eq)]
pub struct Bonus {
    pub t: u8,
    pub e: u8,
}

#[repr(C)]
#[derive(Clone, Copy, Default, Debug, PartialEq, Eq)]
pub struct SkillInst {
    pub id: u8,
    /// variant index: 0 = Lv1, 1–2 = Lv2, 3–6 = Lv3
    pub v: u8,
    pub mark: u8,
    pub nb: u8,
    pub bonus: [Bonus; crate::data::MAX_BONUS],
}

#[repr(C)]
#[derive(Clone, Copy, Default, Debug, PartialEq, Eq)]
pub struct Build {
    pub hero: u8,
    pub n: u8,
    pub skills: [SkillInst; MAX_SKILLS],
}

#[inline(always)]
pub fn lv_of(v: u8) -> i64 {
    if v == 0 { 1 } else if v <= 2 { 2 } else { 3 }
}
