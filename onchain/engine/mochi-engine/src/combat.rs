//! The fight, sim v22. A rule-for-rule port of arena-game-jj/src/sim/combat.ts (+ execNode in skills.ts and the
//! hero hooks in heroes.ts): same order of operations, same integer formulas, minus everything that only feeds the UI
//! (events, per-block stats, trace). State lives in fixed-size arrays inside one heap block (SBF frames are 4 KB).
use crate::data::*;
use crate::fixed::{ceil_div, mul_p, rdiv, ONE};
use crate::rng::Rng;
use crate::types::*;
use alloc::boxed::Box;

/// Capacity of the per-fighter stacks (exceeding one panics: never silently wrong). diff.rs reports the maxima seen.
pub const GROW_CAP: usize = 160;
pub const THORNS_CAP: usize = 64;
pub const DOTS_CAP: usize = 96;
/// thorns that never wear off
const PERM: i64 = u16::MAX as i64;
const MAX_FREEZE_TICKS: i64 = 15;
const SLOW_CAP_P: i64 = 500_000;
const MAX_CHAIN: u8 = 8;
const REACT_MIN: i64 = 5;
const FREEZE_DR_DECAY: i64 = 6 * 10;
/// 0.5^n in ppm, same integer recurrence as combat.ts DR_P
const DR_P: [i64; 24] = {
    let mut t = [0i64; 24];
    t[0] = ONE;
    let mut i = 1;
    while i < 24 {
        t[i] = (2 * t[i - 1] * 500_000 + ONE) / (2 * ONE);
        i += 1;
    }
    t
};
#[inline(always)]
fn dr_of(n: i64) -> i64 {
    if (n as usize) < DR_P.len() { DR_P[n as usize] } else { 0 }
}
#[inline(always)]
fn min(a: i64, b: i64) -> i64 {
    if a < b { a } else { b }
}
#[inline(always)]
fn max(a: i64, b: i64) -> i64 {
    if a > b { a } else { b }
}

#[derive(Clone, Copy, Default)]
pub struct Block {
    pub id: u8,
    pub v: u8,
    pub mark: u8,
    pub star: u8,
    /// index into build.skills
    pub idx: u8,
    /// skill of the hero's line (inLine)
    pub in_line: bool,
    /// skill line == hero line (counts as a line cast)
    pub line_cast: bool,
    pub cd0: i64,
    pub cd: i64,
    /// cooldown progress in ppm ticks
    pub prog: i64,
    /// ppm
    pub power: i64,
    pub dmg: i64,
    pub shield_on_fire: i64,
    pub triggers: [u8; 2],
    pub ntrig: u8,
    pub adj: [u8; 2],
    pub nadj: u8,
    pub rr: i64,
    pub trig_at: i64,
    pub reacts: bool,
    pub react_at: i64,
    /// casts so far (own + set off): whetstone and the digest
    pub fired: i64,
}

/// A fixed-capacity stack of (value, until).
#[derive(Clone, Copy)]
pub struct Stack<const N: usize> {
    pub v: [u32; N],
    pub until: [u16; N],
    pub len: usize,
}
impl<const N: usize> Default for Stack<N> {
    fn default() -> Self {
        Stack { v: [0; N], until: [0; N], len: 0 }
    }
}
impl<const N: usize> Stack<N> {
    #[inline(always)]
    pub fn push(&mut self, v: i64, until: i64) {
        assert!(self.len < N && (0..=u32::MAX as i64).contains(&v) && (0..=u16::MAX as i64).contains(&until), "stack overflow");
        self.v[self.len] = v as u32;
        self.until[self.len] = until as u16;
        self.len += 1;
    }
    #[inline(always)]
    pub fn pop(&mut self) -> (i64, i64) {
        self.len -= 1;
        (self.v[self.len] as i64, self.until[self.len] as i64)
    }
    #[inline(always)]
    pub fn sum(&self) -> i64 {
        let mut s = 0i64;
        for i in 0..self.len {
            s += self.v[i] as i64;
        }
        s
    }
    /// damage still to come (DoT stacks: v = dps, until = ticks left)
    pub fn left(&self) -> i64 {
        let mut s = 0i64;
        for i in 0..self.len {
            s += self.v[i] as i64 * ceil_div(self.until[i] as i64, 10);
        }
        s
    }
    /// remove item i keeping order
    pub fn remove(&mut self, i: usize) {
        for k in i..self.len - 1 {
            self.v[k] = self.v[k + 1];
            self.until[k] = self.until[k + 1];
        }
        self.len -= 1;
    }
    /// earliest `until` (thorns expiry); PERM never expires
    pub fn min_until(&self) -> i64 {
        let mut m = u16::MAX;
        for i in 0..self.len {
            if self.until[i] < m {
                m = self.until[i];
            }
        }
        if m == u16::MAX { i64::MAX } else { m as i64 }
    }
    /// DoT tick: every stack loses one second, spent ones go (order kept)
    pub fn tick_down(&mut self) {
        let mut w = 0;
        for i in 0..self.len {
            let t = self.until[i] as i64 - 10;
            if t > 0 {
                self.v[w] = self.v[i];
                self.until[w] = t as u16;
                w += 1;
            }
        }
        self.len = w;
    }
}

#[derive(Clone, Copy, Default)]
pub struct Fighter {
    pub hero: u8,
    pub line: u8,
    /// relic bitmask (RELIC_IDS index)
    pub relics: u32,
    pub blocks: [Block; MAX_SKILLS],
    pub nb: usize,
    pub worth: i64,
    pub hp: i64,
    pub max_hp: i64,
    pub shield: i64,
    pub frozen: i64,
    pub frozen_total: i64,
    pub delay_n: i64,
    pub slow_p: i64,
    pub slow_t: i64,
    pub slow_total: i64,
    /// พลัง, ppm
    pub growth: Stack<GROW_CAP>,
    /// ppm, ONE = none
    pub charge: i64,
    pub charge_hits: i64,
    pub thorns: Stack<THORNS_CAP>,
    /// earliest thorns expiry (cache; never later than the true minimum)
    pub thorns_next: i64,
    /// DoTs: v = dps, until = ticks left
    pub burns: Stack<DOTS_CAP>,
    pub poisons: Stack<DOTS_CAP>,
    pub dodge: i64,
    pub dodge_cap: i64,
    pub dodges: i64,
    pub dealt_total: i64,
    pub haste_p: i64,
    pub haste_t: i64,
    pub wound_p: i64,
    pub wound_t: i64,
    pub ult_lv: i64,
    pub ult_done: bool,
    pub shield_got: i64,
    pub hits_taken: i64,
    pub line_casts: i64,
    pub ctl_landed: i64,
    pub big_hit: i64,
    pub ult_until: i64,
    pub freeze_n: i64,
    pub ctl_keep: i64,
    pub ignore_freeze: bool,
    pub leech_next: i64,
    pub thorns_heal: i64,
    pub immune_until: i64,
    pub pending: [u8; MAX_SKILLS],
    pub npending: usize,
    pub last_fire: i64,
    /// hero hook scratch (combat.ts flags): hits dealt, counter ready, hits taken, raged
    pub f_hits: i64,
    pub f_counter: i64,
    pub f_hits_taken: i64,
    pub f_raged: i64,
}
impl Fighter {
    #[inline(always)]
    pub fn has(&self, r: u8) -> bool {
        self.relics & (1 << r) != 0
    }
}

/// Test hook: sees the full state at the end of every tick. `NoProbe` compiles to nothing.
pub trait Probe {
    fn tick(&mut self, t: i64, f: &[Fighter; 2]);
}
pub struct NoProbe;
impl Probe for NoProbe {
    #[inline(always)]
    fn tick(&mut self, _t: i64, _f: &[Fighter; 2]) {}
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Outcome {
    /// 0 = A, 1 = B, -1 = draw
    pub winner: i8,
    pub ticks: i64,
    pub hp: [i64; 2],
}

/// combat.ts DamageKind
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Hit,
    Thorns,
    Burn,
    Poison,
    Fatigue,
    Ult,
}

#[derive(Clone, Copy, Default)]
struct Fire {
    bi: u8,
    depth: u8,
    /// block that set this one off (None = own cast)
    from: Option<u8>,
    mult: i64,
    restart: bool,
}

#[inline(always)]
fn node(id: u8, v: u8) -> &'static Node {
    &SKILLS[id as usize].tree[v as usize]
}
/// connect bonus condition: a skill id, or a line
#[inline(always)]
fn matches(t: u8, id: u8) -> bool {
    t == id || t == LINE_TARGET + SKILLS[id as usize].line
}
/// heroes.ts inLine: a shared skill of the hero's line, or its own unique
#[inline(always)]
fn in_line(hero: u8, id: u8) -> bool {
    let d = &SKILLS[id as usize];
    d.line == HERO_LINE[hero as usize] && d.line != LINE_NONE && (d.hero == 255 || d.hero == hero)
}
#[inline(always)]
fn mul_all(ps: &[i64]) -> i64 {
    let mut a = ONE;
    for &p in ps {
        a = mul_p(a, p);
    }
    a
}

/// cooldown in ticks with mark, haste bonuses and ★★★ (combat.ts cdTicks)
pub fn cd_ticks(k: &SkillInst, haste_count: i64) -> i64 {
    let m = mul_all(&[
        if k.mark == MARK_QUICK { QUICK_MARK_P } else { ONE },
        max(500_000, ONE - haste_count * HASTE_BONUS_P),
        if k.star >= 3 { ONE - STAR_CD3_P } else { ONE },
    ]);
    max(5, mul_p(node(k.id, k.v).cd, m))
}
fn star_power_p(star: u8) -> i64 {
    let n = min(3, star as i64);
    ONE + STAR_POW_P * min(2, n) + if n >= 3 { STAR_POW3_P } else { 0 }
}
fn affinity_p(hero: u8, k: &SkillInst) -> i64 {
    if in_line(hero, k.id) { mul_p(HERO_AFF_P[hero as usize], if lv_of(k.v) >= 3 { LINE_LV3_P } else { ONE }) } else { ONE }
}
/// combat.ts secondLine: the line (not the hero's, not none) with most skills; ties: the first to reach the count
fn second_line(b: &Build) -> u8 {
    let main = HERO_LINE[b.hero as usize];
    let mut n = [0u8; 16];
    let mut best = 255u8;
    for k in &b.skills[..b.n as usize] {
        let l = SKILLS[k.id as usize].line;
        if l == LINE_NONE || l == main {
            continue;
        }
        n[l as usize] += 1;
        if best == 255 || n[l as usize] > n[best as usize] {
            best = l;
        }
    }
    best
}
fn relic_power_p(b: &Build, bits: u32, i: usize) -> i64 {
    if bits == 0 {
        return ONE;
    }
    let k = &b.skills[i];
    let has = |r: u8| bits & (1 << r) != 0;
    let mut m = ONE;
    let line = SKILLS[k.id as usize].line;
    if has(RL_WANDERER) && !in_line(b.hero, k.id) {
        m = mul_p(m, ONE + R_WANDERER_P);
    }
    if has(RL_TWINLINE) && line != LINE_NONE && line == second_line(b) {
        m = mul_p(m, ONE + R_TWINLINE_P);
    }
    if has(RL_LONEWOLF) && b.n <= 3 {
        m = mul_p(m, ONE + R_LONEWOLF_P);
    }
    if has(RL_SIGIL) && k.mark != MARK_NONE {
        // only the first SIGIL_MAX marked skills of the list
        let mut rank = 0;
        for j in 0..i {
            if b.skills[j].mark != MARK_NONE {
                rank += 1;
            }
        }
        if rank < SIGIL_MAX {
            m = mul_p(m, ONE + R_SIGIL_P);
        }
    }
    m
}
/// heroes.ts ultLevel
fn ult_level(b: &Build) -> i64 {
    let (mut p, mut l3) = (0usize, 0usize);
    for k in &b.skills[..b.n as usize] {
        if in_line(b.hero, k.id) {
            p += 1;
            if lv_of(k.v) >= 3 {
                l3 += 1;
            }
        }
    }
    if p >= ULT_PIECES_2 && l3 >= ULT_LV2_LV3 { 2 } else if p >= ULT_PIECES_1 { 1 } else { 0 }
}

/// Fills a zeroed fighter in place (combat.ts makeBlocks + makeFighter).
fn init_fighter(f: &mut Fighter, b: &Build, day: usize) {
    let n = b.n as usize;
    let hero = b.hero;
    let bits = b.relic_bits();
    f.thorns_next = i64::MAX;
    f.nb = n;
    f.hero = hero;
    f.line = HERO_LINE[hero as usize];
    f.relics = bits;
    let has = |r: u8| bits & (1 << r) != 0;
    let d = day.clamp(1, DAYS);
    let mut max_hp = HERO_MAX_HP[hero as usize][d];
    if has(RL_IRONHIDE) {
        max_hp = mul_p(max_hp, ONE + R_IRONHIDE_P);
    }
    if has(RL_GLASSCANNON) {
        max_hp = max(1, mul_p(max_hp, R_GLASSHP_P));
    }
    let worth_mul = if hero == H_LUCKYCAT { LUCKYCAT_WORTH_P } else { ONE };
    let mut raw_worth = 0;
    for k in &b.skills[..n] {
        raw_worth += WORTH_BY_LV[lv_of(k.v) as usize] + 3 * k.star as i64;
    }
    let mut start = if hero == H_KNIGHT { mul_p(max_hp, KNIGHT_SHIELD_P) } else { 0 };
    if has(RL_BASTION) {
        start += mul_p(max_hp, R_BASTION_P);
    }
    if has(RL_LUCKYCOIN) {
        start += mul_p(mul_p(raw_worth, worth_mul), R_LUCKYCOIN_P);
    }
    f.max_hp = max_hp;
    f.hp = max_hp;
    f.shield = start;
    f.worth = mul_p(mul_p(raw_worth, worth_mul), if has(RL_PIGGYBANK) { ONE + R_PIGGYBANK_P } else { ONE });
    f.charge = ONE;
    f.ctl_keep = ONE;
    f.thorns_heal = THORNS_HEAL_P;
    f.dodge_cap = DODGE_CAP + (HERO_LINE[hero as usize] == LINE_DODGE) as i64 + has(RL_FEATHERSTEP) as i64;
    f.ult_lv = ult_level(b);
    let sk = &b.skills;
    for i in 0..n {
        let k = &sk[i];
        // bonuses of skill i whose condition matches the skill above or below (links.ts activeBonuses / bonusTotals)
        let mut counts = [0i64; 5];
        let mut trig = [0u8; 2];
        let mut ntrig = 0u8;
        for bi in 0..k.nb as usize {
            let bo = k.bonus[bi];
            let mut to = [0u8; 2];
            let mut nto = 0;
            if i > 0 && matches(bo.t, sk[i - 1].id) {
                to[nto] = (i - 1) as u8;
                nto += 1;
            }
            if i + 1 < n && matches(bo.t, sk[i + 1].id) {
                to[nto] = (i + 1) as u8;
                nto += 1;
            }
            if nto == 0 {
                continue;
            }
            counts[bo.e as usize] += 1;
            if bo.e == BK_TRIGGER {
                for &j in &to[..nto] {
                    if !trig[..ntrig as usize].contains(&j) {
                        trig[ntrig as usize] = j;
                        ntrig += 1;
                    }
                }
            }
        }
        let lv = lv_of(k.v);
        let cd = mul_p(cd_ticks(k, counts[BK_HASTE as usize]), if has(RL_PERMAFROST) { ONE + R_PERMAFROSTCD_P } else { ONE });
        let power = mul_all(&[
            ONE + counts[BK_POWER as usize] * POWER_BONUS_P,
            affinity_p(hero, k),
            if lv >= 3 { star_power_p(k.star) } else { ONE },
            relic_power_p(b, bits, i),
            if k.mark == MARK_STEADFAST { 1_250_000 } else { ONE },
        ]);
        let nd = node(k.id, k.v);
        let blk = &mut f.blocks[i];
        blk.id = k.id;
        blk.v = k.v;
        blk.mark = k.mark;
        blk.star = k.star;
        blk.idx = i as u8;
        blk.in_line = in_line(hero, k.id);
        blk.line_cast = SKILLS[k.id as usize].line == HERO_LINE[hero as usize];
        blk.cd = cd;
        blk.cd0 = cd;
        blk.power = power;
        blk.dmg = counts[BK_DMG as usize] * lv;
        blk.shield_on_fire = counts[BK_SHIELD as usize] * (1 + lv);
        blk.triggers = trig;
        blk.ntrig = ntrig;
        blk.reacts = nd.reacts;
        let mut na = 0;
        if i > 0 {
            blk.adj[na] = (i - 1) as u8;
            na += 1;
        }
        if i + 1 < n {
            blk.adj[na] = (i + 1) as u8;
            na += 1;
        }
        blk.nadj = na as u8;
    }
    // early days: a line skill's first cast comes by FIRST_CAST, staggered by list order
    if d <= FIRST_CAST_DAYS {
        let mut c = 0;
        for blk in &mut f.blocks[..n] {
            if blk.in_line {
                blk.prog = max(blk.prog, (blk.cd - min(FIRST_CAST_MAX, FIRST_CAST + FIRST_CAST_STEP * c)) * ONE);
                c += 1;
            }
        }
    }
    if has(RL_QUICKDRAW) {
        for blk in &mut f.blocks[..n] {
            blk.prog = max(blk.prog, mul_p(blk.cd, R_QUICKDRAW_P) * ONE);
        }
    }
    if hero == H_THORNGUARD && n > 0 {
        f.blocks[0].prog = mul_p(f.blocks[0].cd, THORNGUARD_HEAD_P) * ONE;
    }
}

struct Sim {
    f: [Fighter; 2],
    t: i64,
    day: i64,
    f_cap: i64,
    s_cap: i64,
}

/// What one runSkill call can see (combat.ts ctx)
#[derive(Clone, Copy)]
struct Ctx {
    fi: usize,
    power: i64,
    ctl: i64,
    bonus_dmg: i64,
    secs_p: i64,
    in_line: bool,
}

impl Sim {
    #[inline(always)]
    fn shaking(&self, x: usize) -> bool {
        self.t - self.f[x].last_fire >= SHAKE_OFF
    }
    #[inline(always)]
    fn ctl_room(&self, x: usize) -> i64 {
        min(self.f_cap, max(self.t, CTL_MIN_T) / 4) - self.f[x].frozen_total
    }
    fn can_control(&mut self, foe: usize) -> bool {
        let sh = self.shaking(foe);
        let x = &mut self.f[foe];
        if x.frozen > 0 || self.t < x.immune_until || sh {
            return false;
        }
        true
    }
    fn thorns_until(&self, fi: usize) -> i64 {
        self.t + if self.f[fi].hero == H_THORNGUARD { THORNGUARD_THORNS_SECS * TPS } else { THORNS_TICKS }
    }
    fn push_thorns(&mut self, fi: usize, v: i64, until: i64) {
        let f = &mut self.f[fi];
        f.thorns.push(v, until);
        if until < PERM && until < f.thorns_next {
            f.thorns_next = until;
        }
    }
    fn grow(&mut self, fi: usize, v_p: i64) {
        self.f[fi].growth.push(v_p, 0);
    }

    // ---------------- damage ----------------
    /// share_p: share of the hit shields can block (ppm)
    fn deal(&mut self, target: usize, amount: i64, share_p: i64, kind: Kind) {
        if amount <= 0 || self.f[target].hp <= 0 {
            return;
        }
        if kind != Kind::Fatigue {
            self.f[1 - target].dealt_total += amount;
        }
        let x = &mut self.f[target];
        let mut blocked = 0;
        if share_p > 0 && x.shield > 0 {
            blocked = min(x.shield, mul_p(amount, share_p));
            x.shield -= blocked;
        }
        x.hp -= amount - blocked;
        let reflect = !matches!(kind, Kind::Thorns | Kind::Burn | Kind::Poison | Kind::Fatigue | Kind::Ult);
        if blocked > 0 && x.has(RL_SPIKEDSHIELD) && reflect {
            let back = mul_p(blocked, R_SPIKEDSHIELD_P);
            if back > 0 {
                self.deal(1 - target, back, ONE, Kind::Thorns);
            }
        }
        let x = &mut self.f[target];
        let undying = x.hp <= 0 && x.hero == H_BERSERKER && x.ult_lv > 0 && !x.ult_done;
        if undying {
            x.hp = 1;
            self.fire_ult(target);
        }
        self.on_damaged(target, kind);
    }

    /// heroes.ts onDamaged hooks
    fn on_damaged(&mut self, fi: usize, kind: Kind) {
        let hero = self.f[fi].hero;
        if hero == H_BERSERKER {
            let me = &mut self.f[fi];
            if !matches!(kind, Kind::Burn | Kind::Poison | Kind::Fatigue | Kind::Thorns) && me.hp > 0 {
                me.f_hits_taken += 1;
                if me.f_hits_taken % BERSERKER_HITS == 0 {
                    me.growth.push(ONE, 0);
                }
            }
            let me = &mut self.f[fi];
            if me.f_raged == 0 && me.hp > 0 && me.hp * 2 < me.max_hp {
                me.f_raged = 1;
                me.growth.push(2 * ONE, 0);
            }
        } else if hero == H_THORNGUARD {
            let me = &mut self.f[fi];
            if matches!(kind, Kind::Burn | Kind::Poison | Kind::Fatigue | Kind::Thorns | Kind::Ult) || me.hp <= 0 {
                return;
            }
            me.f_hits_taken += 1;
            if me.f_hits_taken % 2 == 0 {
                self.add_poison(1 - fi, 1, THORNGUARD_POISON_SECS_P);
            }
        }
    }

    fn melt_shield(&self, fi: usize, n: i64) -> i64 {
        let f = &self.f[fi];
        if (f.burns.len > 0 || f.poisons.len > 0) && n > 0 { max(1, mul_p(n, BURN_SHIELD_P)) } else { n }
    }
    fn add_burn(&mut self, foe: usize, d: i64, secs_p: i64) {
        let t = rdiv(secs_p * TPS, ONE);
        self.f[foe].burns.push(d, t);
    }
    fn add_poison(&mut self, foe: usize, d: i64, secs_p: i64) {
        if self.f[foe].hp <= 0 {
            return;
        }
        let t = rdiv(secs_p * TPS, ONE);
        self.f[foe].poisons.push(d, t);
    }
    fn add_dodge(&mut self, fi: usize, n: i64) {
        let f = &mut self.f[fi];
        f.dodge = min(f.dodge_cap, f.dodge + n);
    }
    fn add_haste(&mut self, fi: usize, mut pct_p: i64, mut secs_p: i64) {
        let f = &mut self.f[fi];
        if f.has(RL_TAILSPIN) {
            pct_p += 100_000;
            secs_p += R_TAILSPIN_P;
        }
        f.haste_p = min(HASTE_CAP_P, if f.haste_t > 0 { max(f.haste_p, pct_p) } else { pct_p });
        f.haste_t = max(f.haste_t, rdiv(secs_p * TPS, ONE));
    }
    fn add_wound(&mut self, foe: usize, pct_p: i64, secs_p: i64) {
        let x = &mut self.f[foe];
        x.wound_p = if x.wound_t > 0 { max(x.wound_p, pct_p) } else { pct_p };
        x.wound_t = max(x.wound_t, rdiv(secs_p * TPS, ONE));
    }
    /// remove up to n burn / poison stacks, strongest first (burn wins ties)
    fn remove_dots(&mut self, fi: usize, n: i64) -> i64 {
        let f = &mut self.f[fi];
        let mut removed = 0;
        let mut r = 0;
        while r < n && (f.burns.len > 0 || f.poisons.len > 0) {
            // first maximum over burns then poisons
            let (mut best, mut is_burn, mut k) = (-1i64, true, 0usize);
            for i in 0..f.burns.len {
                if f.burns.v[i] as i64 > best {
                    best = f.burns.v[i] as i64;
                    is_burn = true;
                    k = i;
                }
            }
            for i in 0..f.poisons.len {
                if f.poisons.v[i] as i64 > best {
                    best = f.poisons.v[i] as i64;
                    is_burn = false;
                    k = i;
                }
            }
            if is_burn { f.burns.remove(k) } else { f.poisons.remove(k) }
            removed += 1;
            r += 1;
        }
        removed
    }
    /// relic damage multiplier of fi's hit (combat.ts relicHit), ppm
    fn relic_hit(&mut self, fi: usize) -> i64 {
        let (fhp, fmax, fpois, ffroz) = {
            let x = &self.f[1 - fi];
            (x.hp, x.max_hp, x.poisons.len, x.frozen)
        };
        let f = &mut self.f[fi];
        let mut m = ONE;
        if f.has(RL_EXECUTIONER) && fhp * 10 < fmax * 4 {
            m = mul_p(m, ONE + R_EXECUTIONER_P);
        }
        if f.has(RL_ROT) && fpois > 0 {
            m = mul_p(m, ONE + R_ROT_P);
        }
        if f.has(RL_BRITTLE) && ffroz > 0 {
            m = mul_p(m, ONE + R_BRITTLE_P);
        }
        if f.has(RL_COUNTERSTEP) && f.f_counter != 0 {
            m = mul_p(m, ONE + R_COUNTERSTEP_P);
            f.f_counter = 0;
        }
        m
    }

    // ---------------- ultimates ----------------
    fn ult_cap_p(&self, fi: usize) -> i64 {
        mul_p(self.f[1 - fi].max_hp * ULT_CAP_P, if self.f[fi].ult_lv >= 2 { ULT_LV2_POW_P } else { ONE })
    }
    fn fire_ult(&mut self, fi: usize) {
        let foe = 1 - fi;
        self.f[fi].ult_done = true;
        let hero = self.f[fi].hero;
        let pow = ULT_POW_P[hero as usize][self.f[fi].ult_lv as usize];
        if hero == H_ASSASSIN {
            let mut n_p = min(pow * (self.f[foe].max_hp - self.f[foe].hp), self.ult_cap_p(fi));
            if self.f[foe].dodge > 0 {
                self.f[foe].dodge -= 1;
                self.f[foe].dodges += 1;
                n_p /= 2;
            }
            self.deal(foe, max(1, rdiv(n_p, ONE)), 0, Kind::Ult);
        } else if hero == H_DUELIST {
            self.add_haste(fi, pow, 3 * ONE);
            self.add_dodge(fi, 2);
        } else if hero == H_KNIGHT {
            let f = &self.f[fi];
            let raw = pow * (f.shield * ONE + f.max_hp * ULT_KNIGHT_HP_P);
            let n = max(1, rdiv(min(raw, self.ult_cap_p(fi) * ONE), ONE * ONE));
            self.deal(foe, n, ONE, Kind::Ult);
        } else if hero == H_BERSERKER {
            let f = &mut self.f[fi];
            let h = min(f.max_hp - f.hp, mul_p(f.max_hp, pow));
            if h > 0 {
                f.hp += h;
            }
            let g = max(2, mul_p(mul_p(f.max_hp, ULT_BERSERKER_GROW_P), if f.ult_lv >= 2 { 1_500_000 } else { ONE }));
            f.growth.push(g * ONE, 0);
        } else if hero == H_PYRO {
            let left = self.f[foe].burns.left();
            self.deal(foe, max(1, mul_p(left, pow)), 0, Kind::Ult);
        } else if hero == H_THORNGUARD {
            self.f[fi].ult_until = self.t + rdiv(pow * TPS, ONE);
            self.add_wound(foe, ONE, pow);
            self.add_poison(foe, ULT_THORNGUARD_POISON, pow);
        } else if hero == H_WITCH {
            let mut ticks = rdiv(mul_p(pow * TPS, self.f[foe].ctl_keep), ONE);
            ticks = max(0, min(ticks, self.ctl_room(foe) + self.f[foe].frozen));
            let x = &mut self.f[foe];
            if ticks > x.frozen {
                x.frozen_total += ticks - x.frozen;
                x.frozen = ticks;
                if ticks >= REACT_MIN {
                    self.controlled(foe);
                }
            }
            let f = &mut self.f[fi];
            let m = if f.ult_lv >= 2 { 2_400_000 } else { 2_000_000 };
            if m >= f.charge {
                f.charge = m;
                f.charge_hits = 1;
            }
        } else if hero == H_LUCKYCAT {
            let n = max(1, rdiv(min(pow * self.f[fi].worth, self.ult_cap_p(fi)), ONE));
            self.deal(foe, n, ONE, Kind::Ult);
            let sh = self.melt_shield(fi, rdiv(n, 2));
            if sh > 0 {
                self.f[fi].shield += sh;
                self.f[fi].shield_got += sh;
            }
        } else if hero == H_SAGE {
            self.remove_dots(fi, 99);
            let mut bi = 0;
            while bi < self.f[fi].nb && self.f[foe].hp > 0 && self.f[fi].hp > 0 {
                let mut next = [Fire::default(); 8];
                self.fire_one(fi, Fire { bi: bi as u8, depth: MAX_CHAIN, from: None, mult: pow, restart: false }, &mut next);
                bi += 1;
            }
        } else if hero == H_CHRONO {
            let t = self.t;
            self.remove_dots(fi, 99);
            let f = &mut self.f[fi];
            for b in &mut f.blocks[..f.nb] {
                b.prog = min(b.cd * ONE, b.prog + mul_p(b.cd, pow) * ONE);
            }
            if f.slow_t > 0 {
                f.slow_t = 0;
                f.slow_p = 0;
            }
            if f.frozen > 0 {
                f.frozen = 0;
                f.immune_until = t + CTL_IMMUNE;
            }
            if f.wound_t > 0 {
                f.wound_t = 0;
            }
        }
    }
    fn ult_ready(&self, fi: usize) -> bool {
        let f = &self.f[fi];
        if f.ult_lv <= 0 || f.ult_done || f.hp <= 0 {
            return false;
        }
        let foe = &self.f[1 - fi];
        if foe.hp <= 0 {
            return false;
        }
        let h = f.hero as usize;
        let need = ULT_TRIG[h][f.ult_lv as usize];
        let need_p = ULT_TRIG_P[h][f.ult_lv as usize];
        match f.hero {
            x if x == H_ASSASSIN => f.big_hit > 0 && foe.hp * ONE < foe.max_hp * need_p,
            x if x == H_DUELIST => f.dodges >= need,
            x if x == H_KNIGHT => f.shield_got * ONE >= f.max_hp * need_p && f.shield > 0,
            x if x == H_BERSERKER => f.hp * ONE < f.max_hp * need_p,
            x if x == H_PYRO => foe.burns.len as i64 >= need,
            x if x == H_THORNGUARD => f.hits_taken >= need,
            x if x == H_WITCH => f.line_casts >= need,
            x if x == H_CHRONO => f.ctl_landed >= need,
            x if x == H_LUCKYCAT => f.line_casts >= need,
            x if x == H_SAGE => self.t >= need * TPS,
            _ => false,
        }
    }
    fn ult_check(&mut self) {
        if self.t < ULT_MIN_T {
            return;
        }
        for fi in 0..2 {
            if self.ult_ready(fi) {
                self.fire_ult(fi);
            }
        }
    }

    // ---------------- control ----------------
    fn controlled(&mut self, foe: usize) {
        let t = self.t;
        let x = &mut self.f[foe];
        for bi in 0..x.nb {
            let b = &x.blocks[bi];
            if b.reacts && t >= b.react_at && !x.pending[..x.npending].contains(&(bi as u8)) {
                x.pending[x.npending] = bi as u8;
                x.npending += 1;
            }
        }
    }

    // ---------------- skill effects (combat.ts ctx) ----------------
    #[inline(always)]
    fn v(&self, c: &Ctx, n_p: i64) -> i64 {
        // data number already in ppm: max(1, round(n × power))
        max(1, rdiv(n_p * c.power, ONE * ONE))
    }

    /// returns damage dealt, or -1 when dodged
    fn hit(&mut self, c: &Ctx, n: i64, pierce_p: i64, leech_p: i64, sure: bool) -> i64 {
        let (fi, foe) = (c.fi, 1 - c.fi);
        if self.f[foe].hp <= 0 || self.f[fi].hp <= 0 {
            return 0;
        }
        let use_charge = self.f[fi].charge > ONE && n + c.bonus_dmg >= CHARGE_MIN;
        let mult = if use_charge { self.f[fi].charge } else { ONE };
        let mut dmg = rdiv(((n + c.bonus_dmg) * ONE + self.f[fi].growth.sum()) * mult, ONE * ONE);
        dmg = self.on_hit(fi, dmg);
        if self.f[fi].relics != 0 {
            let m = self.relic_hit(fi);
            dmg = mul_p(dmg, m);
        }
        if self.f[fi].has(RL_GLASSCANNON) {
            dmg = min(mul_p(dmg, ONE + R_GLASSDMG_P), max(dmg, dmg + mul_p(self.f[foe].max_hp, R_GLASSCAP_P)));
        }
        if !sure && self.f[foe].dodge > 0 {
            self.spend_charge(fi, use_charge);
            let x = &mut self.f[foe];
            x.dodge -= 1;
            x.dodges += 1;
            // onDodge (duelist): counter ready, shed the strongest poison
            if x.hero == H_DUELIST {
                x.f_counter = 1;
                if x.poisons.len > 0 {
                    let mut k = 0;
                    for i in 0..x.poisons.len {
                        if x.poisons.v[i] > x.poisons.v[k] {
                            k = i;
                        }
                    }
                    x.poisons.remove(k);
                }
            }
            if x.has(RL_COUNTERSTEP) {
                x.f_counter = 1;
            }
            let g = if self.f[fi].hero == H_CHRONO && self.f[foe].slow_t > 0 { CHRONO_GRAZE_P } else { DODGE_GRAZE_P };
            let graze = mul_p(dmg, g);
            if graze > 0 {
                self.deal(foe, graze, ONE - pierce_p, Kind::Hit);
            }
            return -1;
        }
        {
            let f = &mut self.f[fi];
            f.big_hit = max(f.big_hit, dmg);
        }
        self.f[foe].hits_taken += 1;
        self.on_landed(fi);
        self.spend_charge(fi, use_charge);
        if self.f[foe].shield > 0 && pierce_p < ONE {
            dmg = max(1, mul_p(dmg, ONE - SHIELD_GUARD_P));
        }
        let hp_before = self.f[foe].hp;
        self.deal(foe, dmg, ONE - pierce_p, Kind::Hit);
        let dealt = max(0, hp_before - max(0, self.f[foe].hp));
        let leech = leech_p + self.f[fi].leech_next;
        self.f[fi].leech_next = 0;
        if leech > 0 && dealt > 0 {
            self.heal(c, max(1, mul_p(dealt, leech)));
        }
        let th = min(self.f[foe].thorns.sum(), ceil_div(dmg * 3, 4));
        if th > 0 && self.f[fi].hp > 0 {
            self.deal(fi, th, ONE, Kind::Thorns);
        }
        if self.f[foe].ult_until > self.t && self.f[fi].hp > 0 {
            for _ in 0..2 {
                self.add_poison(fi, 1, 4 * ONE);
            }
        }
        dealt
    }
    fn spend_charge(&mut self, fi: usize, used: bool) {
        if !used {
            return;
        }
        let f = &mut self.f[fi];
        if f.charge_hits > 1 {
            f.charge_hits -= 1;
        } else {
            f.charge = ONE;
            f.charge_hits = 0;
        }
    }
    /// heroes.ts onHit hooks
    fn on_hit(&mut self, fi: usize, dmg: i64) -> i64 {
        let (foe_slowed, foe_frozen) = (self.f[1 - fi].slow_t > 0, self.f[1 - fi].frozen > 0);
        let f = &mut self.f[fi];
        if f.hero == H_ASSASSIN {
            f.f_hits += 1;
            if f.f_hits == 1 || (ASSASSIN_EVERY > 0 && f.f_hits % ASSASSIN_EVERY == 0) {
                return mul_p(dmg, ASSASSIN_FIRST_P);
            }
        } else if f.hero == H_DUELIST {
            if f.f_counter != 0 {
                f.f_counter = 0;
                return mul_p(dmg, DUELIST_COUNTER_P);
            }
        } else if f.hero == H_CHRONO && (foe_slowed || foe_frozen) {
            return mul_p(dmg, ONE + CHRONO_SLOW_HIT_P);
        }
        dmg
    }
    /// heroes.ts onLanded hooks
    fn on_landed(&mut self, fi: usize) {
        let foe = 1 - fi;
        let hero = self.f[fi].hero;
        if hero == H_ASSASSIN {
            self.wound_foe(foe, ASSASSIN_WOUND_P, 2 * ONE);
        } else if hero == H_WITCH && self.f[foe].frozen > 0 && WITCH_WOUND_P > 0 {
            self.wound_foe(foe, WITCH_WOUND_P, 3 * ONE);
        }
    }
    /// hookApi.woundFoe (no status event)
    fn wound_foe(&mut self, foe: usize, pct_p: i64, secs_p: i64) {
        if self.f[foe].hp <= 0 {
            return;
        }
        self.add_wound(foe, pct_p, secs_p);
    }
    fn shield(&mut self, fi: usize, n: i64) {
        let n = self.melt_shield(fi, n);
        let f = &mut self.f[fi];
        f.shield += n;
        f.shield_got += n;
    }
    fn heal(&mut self, c: &Ctx, mut n: i64) {
        let fi = c.fi;
        let foe = &self.f[1 - fi];
        let f = &self.f[fi];
        let mut m = if f.has(RL_VITALITY) { ONE + R_VITALITY_P } else { ONE };
        if foe.thorns.len > 0 {
            m = mul_p(m, foe.thorns_heal);
        }
        if f.poisons.len > 0 {
            m = mul_p(m, POISON_HEAL_P);
        }
        if f.wound_t > 0 {
            m = mul_p(m, ONE - f.wound_p);
        }
        if m != ONE {
            n = if m > 0 { max(1, mul_p(n, m)) } else { 0 };
        }
        let f = &mut self.f[fi];
        let h = min(n, f.max_hp - f.hp);
        if h > 0 {
            f.hp += h;
        }
        let over = mul_p(n - max(0, h), R_OVERFLOW_P);
        if over > 0 && f.has(RL_OVERFLOW) {
            self.shield(fi, over);
        }
    }
    fn burn(&mut self, c: &Ctx, d: i64, secs_p: i64) {
        let f = &self.f[c.fi];
        let s2 = secs_p + if f.has(RL_KINDLING) { R_KINDLING_P } else { 0 };
        // pyro: whole seconds × pyro.burn (heroes.ts burnSecs)
        let s3 = if f.hero == H_PYRO { rdiv(s2 * PYRO_BURN_P, ONE * ONE) * ONE } else { s2 };
        self.add_burn(1 - c.fi, d, s3);
    }
    fn poison(&mut self, c: &Ctx, d: i64, secs_p: i64) {
        let extra = if self.f[c.fi].has(RL_VIRULENCE) { R_VIRULENCE } else { 0 };
        self.add_poison(1 - c.fi, d + extra, secs_p);
    }
    fn freeze(&mut self, c: &Ctx, secs_p: i64) {
        let (fi, foe) = (c.fi, 1 - c.fi);
        if !self.can_control(foe) {
            return;
        }
        if self.f[foe].ignore_freeze {
            self.f[foe].ignore_freeze = false;
            return;
        }
        let perma = if self.f[fi].has(RL_PERMAFROST) { R_PERMAFROST_P } else { 0 };
        let mut t_p = mul_p((secs_p + perma) * TPS, c.ctl);
        if self.f[fi].hero == H_WITCH {
            t_p += WITCH_FREEZE_TICKS * ONE;
        }
        t_p = mul_p(mul_p(t_p, dr_of(self.f[foe].freeze_n)), self.f[foe].ctl_keep);
        let ticks = max(0, min(min(MAX_FREEZE_TICKS, self.ctl_room(foe)), rdiv(t_p, ONE)));
        let x = &mut self.f[foe];
        x.freeze_n += 1;
        if ticks > x.frozen {
            x.frozen_total += ticks - x.frozen;
            x.frozen = ticks;
        }
        if ticks >= REACT_MIN {
            self.controlled(foe);
        }
    }
    fn slow(&mut self, c: &Ctx, pct0: i64, secs0: i64) {
        let (fi, foe) = (c.fi, 1 - c.fi);
        let (mut p0, mut s0) = (pct0, secs0);
        if self.f[fi].has(RL_GALE) {
            p0 += R_GALE_P;
            s0 += ONE;
        }
        let s1 = mul_p(s0, c.ctl);
        let (pct, secs) = if self.f[fi].hero == H_CHRONO { (p0 + 100_000, s1 + ONE) } else { (p0, s1) };
        let p = min(SLOW_CAP_P, mul_p(pct, self.f[foe].ctl_keep));
        let sh = self.shaking(foe);
        let t = self.t;
        let s_cap = self.s_cap;
        let x = &mut self.f[foe];
        x.slow_p = if x.slow_t > 0 { max(x.slow_p, p) } else { p };
        let room = if sh { 0 } else { max(0, min(s_cap, max(t, CTL_MIN_T) / 2) - x.slow_total - x.slow_t) };
        let add = min(room, max(0, ceil_div(secs * TPS, ONE) - x.slow_t));
        if add <= 0 && x.slow_t <= 0 {
            return;
        }
        x.slow_t += add;
        if add > 0 {
            self.f[fi].ctl_landed += 1;
        }
        if add >= REACT_MIN && p >= 300_000 {
            self.controlled(foe);
        }
    }
    fn delay(&mut self, c: &Ctx, secs_p: i64) {
        let (fi, foe) = (c.fi, 1 - c.fi);
        if !self.can_control(foe) {
            return;
        }
        let x = &self.f[foe];
        let t_p = mul_p(mul_p(mul_p(secs_p * TPS, c.ctl), dr_of(x.delay_n)), x.ctl_keep);
        let ticks = max(0, min(self.ctl_room(foe), rdiv(t_p, ONE)));
        let t = self.t;
        let x = &mut self.f[foe];
        x.delay_n += 1;
        if ticks > 0 {
            x.frozen_total += ticks;
            for b in &mut x.blocks[..x.nb] {
                b.prog = max(0, b.prog - ticks * ONE);
            }
            x.immune_until = t + CTL_IMMUNE;
            self.f[fi].ctl_landed += 1;
        }
        if ticks >= REACT_MIN {
            self.controlled(foe);
        }
    }
    fn cleanse(&mut self, fi: usize, stacks: i64, dot_only: bool) -> i64 {
        let mut n = self.remove_dots(fi, min(stacks, CLEANSE_MAX));
        if dot_only {
            return n;
        }
        let t = self.t;
        let f = &mut self.f[fi];
        if f.wound_t > 0 {
            f.wound_t = 0;
            f.wound_p = 0;
            n += 1;
        }
        if f.slow_t > 0 {
            f.slow_t = 0;
            f.slow_p = 0;
            n += 1;
        }
        if f.frozen > 0 {
            f.frozen = 0;
            f.immune_until = t + CTL_IMMUNE;
            n += 1;
        }
        n
    }
    fn dispel(&mut self, fi: usize, times: i64, share_p: i64, steal: bool) -> i64 {
        let foe = 1 - fi;
        let mut n = 0;
        let mut r = 0;
        while r < times {
            let mut any = false;
            if self.f[foe].growth.len > 0 {
                let (g, _) = self.f[foe].growth.pop();
                let keep = (g / (2 * ONE)) * ONE;
                if keep > 0 {
                    self.f[foe].growth.push(keep, 0);
                }
                if steal {
                    self.f[fi].growth.push(g - keep, 0);
                }
                n += 1;
                any = true;
            }
            let x = &mut self.f[foe];
            if x.thorns.len > 0 {
                let (v, until) = x.thorns.pop();
                if x.hero == H_THORNGUARD && v >= 2 {
                    x.thorns.push(v / 2, until);
                }
                n += 1;
                any = true;
            }
            if x.charge > ONE {
                x.charge = ONE;
                x.charge_hits = 0;
                n += 1;
                any = true;
            }
            if x.ctl_keep < ONE {
                x.ctl_keep = ONE;
                x.ignore_freeze = false;
                n += 1;
                any = true;
            }
            if !any {
                break;
            }
            r += 1;
        }
        let x = &mut self.f[foe];
        let cut = (x.shield * share_p) / ONE;
        if cut > 0 {
            x.shield -= cut;
            n += 1;
        }
        n
    }

    /// skills.ts execNode with the combat.ts ctx
    fn run_skill(&mut self, fi: usize, bi: usize, power: i64, bonus_dmg: i64) {
        let blk = self.f[fi].blocks[bi];
        let sundial = if self.f[fi].has(RL_SUNDIAL) { ONE + R_SUNDIAL_P } else { ONE };
        let c = Ctx {
            fi,
            power,
            ctl: min(ONE, power),
            bonus_dmg,
            secs_p: min(TIME_CAP_S * ONE, mul_p(self.t * (ONE / TPS), sundial)),
            in_line: blk.in_line,
        };
        let foe = 1 - fi;
        let (mut removed, mut tried, mut landed) = (0i64, 0i64, 0i64);
        for e in node(blk.id, blk.v).fx {
            let missed = tried > 0 && landed == 0;
            match *e {
                Eff::Hit(h) => {
                    if h.if_slowed && self.f[foe].slow_t <= 0 {
                        continue;
                    }
                    for _ in 0..h.times {
                        let mut n_p = h.n + h.per_removed * removed;
                        if h.shield_pct > 0 {
                            let used_p = self.f[fi].shield * h.shield_pct;
                            n_p += used_p;
                            let spend = rdiv(mul_p(used_p, SHIELD_SPEND_P), ONE);
                            self.f[fi].shield = max(0, self.f[fi].shield - spend);
                        }
                        if h.thorns_x > 0 {
                            n_p += self.f[fi].thorns.sum() * h.thorns_x;
                        }
                        if h.burn_pct > 0 {
                            n_p += self.f[foe].burns.left() * h.burn_pct;
                        }
                        if h.poison_pct > 0 {
                            n_p += self.f[foe].poisons.left() * h.poison_pct;
                        }
                        if h.per_burn > 0 {
                            n_p += self.f[foe].burns.len as i64 * h.per_burn;
                        }
                        if h.per_dodge > 0 {
                            n_p += self.f[fi].dodge * h.per_dodge;
                        }
                        if h.per_sec > 0 {
                            n_p += mul_p(c.secs_p, h.per_sec);
                        }
                        if h.per_worth > 0 {
                            n_p += self.f[fi].worth * h.per_worth;
                        }
                        if n_p <= 0 {
                            break;
                        }
                        let mut m = ONE;
                        let x = &self.f[foe];
                        if h.exec_hp > 0 && x.hp * ONE < x.max_hp * h.exec_hp {
                            m = mul_p(m, h.exec_m);
                        }
                        if h.frozen > 0 && x.frozen > 0 {
                            m = mul_p(m, h.frozen);
                        }
                        if h.no_shield > 0 && x.shield <= 0 {
                            m = mul_p(m, h.no_shield);
                        }
                        tried += 1;
                        let amt = self.v(&c, mul_p(n_p, m));
                        let d = self.hit(&c, amt, h.pierce, h.leech, h.sure);
                        if d < 0 {
                            continue;
                        }
                        landed += 1;
                        if h.burn_dps > 0 {
                            let dps = self.v(&c, h.burn_dps);
                            self.burn(&c, dps, h.burn_secs);
                        }
                        if h.poison_dps > 0 {
                            let dps = self.v(&c, h.poison_dps);
                            self.poison(&c, dps, h.poison_secs);
                        }
                    }
                }
                Eff::Shield { n, per_sec, per_worth } => {
                    let amt = self.v(&c, n + mul_p(c.secs_p, per_sec) + per_worth * self.f[fi].worth);
                    self.shield(fi, amt);
                }
                Eff::Heal { n, per_sec, per_worth } => {
                    let amt = self.v(&c, n + mul_p(c.secs_p, per_sec) + per_worth * self.f[fi].worth);
                    self.heal(&c, amt);
                }
                Eff::Accel { pct, min: mn } => {
                    let b = &mut self.f[fi].blocks[bi];
                    b.cd = max(mul_p(b.cd0, mn), b.cd - mul_p(b.cd0, pct));
                }
                Eff::Burn { dps, secs, growth_half, stacks } => {
                    for _ in 0..stacks {
                        let g = if growth_half { self.f[fi].growth.sum() / (2 * ONE) } else { 0 };
                        let d = self.v(&c, dps + g * ONE);
                        self.burn(&c, d, secs);
                    }
                }
                Eff::Poison { dps, secs, stacks } => {
                    for _ in 0..stacks {
                        let d = self.v(&c, dps);
                        self.poison(&c, d, secs);
                    }
                }
                Eff::Freeze(secs) => {
                    if !missed {
                        self.freeze(&c, secs);
                    }
                }
                Eff::Slow { pct, secs } => self.slow(&c, pct, secs),
                Eff::Delay(secs) => {
                    if !missed {
                        self.delay(&c, secs);
                    }
                }
                Eff::Grow(n) => {
                    let g = mul_p(mul_p(n, c.power), if c.in_line { ONE } else { GROW_OFFLINE_P });
                    self.grow(fi, rdiv(g, 10_000) * 10_000);
                }
                Eff::Charge { mult, hits } => {
                    let f = &mut self.f[fi];
                    if mult >= f.charge {
                        f.charge = mult;
                        f.charge_hits = max(1, hits);
                    }
                }
                Eff::Thorns { n, perm, heal } => {
                    let v = self.v(&c, n);
                    let until = if perm { PERM } else { self.thorns_until(fi) };
                    self.push_thorns(fi, v, until);
                    if heal >= 0 {
                        let f = &mut self.f[fi];
                        f.thorns_heal = min(f.thorns_heal, heal);
                    }
                }
                Eff::Steadfast { keep, ignore_freeze } => {
                    let f = &mut self.f[fi];
                    f.ctl_keep = min(f.ctl_keep, keep);
                    if ignore_freeze {
                        f.ignore_freeze = true;
                    }
                    if f.frozen > 0 {
                        f.frozen = max(1, mul_p(f.frozen, keep));
                    }
                }
                Eff::Cleanse { n, dot, line_all } => {
                    removed = self.cleanse(fi, if line_all && c.in_line { 99 } else { n }, dot);
                }
                Eff::Dispel { n, shield, steal } => {
                    removed = self.dispel(fi, n, shield, steal);
                }
                Eff::Leech(p) => {
                    let f = &mut self.f[fi];
                    f.leech_next = max(f.leech_next, p);
                }
                Eff::Dodge(n) => {
                    if c.power >= DODGE_MIN_POWER_P {
                        self.add_dodge(fi, max(1, mul_p(n, min(ONE, c.power))));
                    }
                }
                Eff::Haste { pct, secs } => self.add_haste(fi, mul_p(pct, min(ONE, c.power)), secs),
                Eff::Wound { pct, secs } => self.add_wound(foe, pct, mul_p(secs, c.ctl)),
            }
        }
    }

    /// Fires one skill (plus marks, ★★★ echo and shield-on-fire). Writes the follow-up fires; returns how many.
    fn fire_one(&mut self, fi: usize, q: Fire, next: &mut [Fire; 8]) -> usize {
        let foe = 1 - fi;
        let bi = q.bi as usize;
        let t = self.t;
        let first_cast = self.f[fi].blocks[bi].fired == 0 && self.f[fi].has(RL_WHETSTONE);
        {
            let f = &mut self.f[fi];
            if let Some(from) = q.from {
                let by_engine = node(f.blocks[from as usize].id, f.blocks[from as usize].v).engine.is_some();
                let b = &mut f.blocks[bi];
                b.trig_at = t + min(TRIGGER_GAP_MAX, max(if by_engine { ENGINE_GAP } else { TRIGGER_GAP }, b.cd));
                if q.restart {
                    b.prog = 0;
                }
            }
            f.blocks[bi].fired += 1;
            f.last_fire = t;
            if f.blocks[bi].line_cast {
                f.line_casts += 1;
            }
        }
        let blk = self.f[fi].blocks[bi];
        let power = mul_all(&[blk.power, q.mult, if first_cast { ONE + R_WHETSTONE_P } else { ONE }]);
        let dealt_before = self.f[fi].dealt_total;
        self.run_skill(fi, bi, power, mul_p(blk.dmg, q.mult));
        if blk.shield_on_fire > 0 && self.f[fi].hp > 0 {
            let n = self.melt_shield(fi, max(1, mul_p(blk.shield_on_fire, q.mult)));
            let f = &mut self.f[fi];
            f.shield += n;
            f.shield_got += n;
        }
        if blk.mark == MARK_ECHO && self.f[foe].hp > 0 && self.f[fi].hp > 0 {
            self.run_skill(fi, bi, rdiv(power, 2), mul_p(blk.dmg, rdiv(q.mult, 2)));
        }
        if blk.mark == MARK_BURN && self.f[foe].hp > 0 && q.from.is_none() {
            self.add_burn(foe, 1 + self.day / 3, 4 * ONE);
        }
        if blk.star >= 3 && lv_of(blk.v) >= 3 && self.f[foe].hp > 0 && self.f[fi].hp > 0 {
            let extra = ((self.f[fi].dealt_total - dealt_before) * STAR_ECHO_P) / ONE;
            if extra > 0 {
                self.deal(foe, extra, ONE, Kind::Hit);
            }
        }
        let tm = if q.depth >= 1 { mul_p(q.mult, CHAIN_DECAY_P) } else { q.mult };
        let mut nn = 0;
        for &tb in &blk.triggers[..blk.ntrig as usize] {
            next[nn] = Fire { bi: tb, depth: q.depth + 1, from: Some(q.bi), mult: tm, restart: false };
            nn += 1;
        }
        if let Some(en) = node(blk.id, blk.v).engine {
            let ep = mul_all(&[en.power, blk.power, min(ONE, q.mult)]);
            let nadj = blk.nadj as usize;
            if en.kind == EngineKind::Gear && nadj > 0 {
                let k = min(en.n as i64, nadj as i64) as usize;
                for _ in 0..k {
                    let b = &mut self.f[fi].blocks[bi];
                    let target = blk.adj[(b.rr % nadj as i64) as usize];
                    b.rr += 1;
                    next[nn] = Fire { bi: target, depth: q.depth + 1, from: Some(q.bi), mult: ep, restart: false };
                    nn += 1;
                }
            } else if en.kind == EngineKind::Overclock {
                for &a in &blk.adj[..nadj] {
                    next[nn] = Fire { bi: a, depth: q.depth + 1, from: Some(q.bi), mult: ep, restart: !en.keep };
                    nn += 1;
                }
            }
        }
        nn
    }

    /// Fire a skill, then everything it sets off (breadth-first, each skill at most once per chain).
    fn fire(&mut self, fi: usize, start: usize) {
        let mut seen: u16 = 1 << start;
        let mut queue = [Fire::default(); 16];
        let (mut head, mut tail) = (0usize, 1usize);
        queue[0] = Fire { bi: start as u8, depth: 0, from: None, mult: ONE, restart: false };
        while head < tail {
            let q = queue[head];
            head += 1;
            if self.f[fi].hp <= 0 || self.f[1 - fi].hp <= 0 {
                return;
            }
            let mut next = [Fire::default(); 8];
            let nn = self.fire_one(fi, q, &mut next);
            if q.depth >= MAX_CHAIN {
                continue;
            }
            for n in &next[..nn] {
                let b = n.bi as usize;
                if seen & (1 << b) != 0 || self.t < self.f[fi].blocks[b].trig_at {
                    continue;
                }
                seen |= 1 << b;
                queue[tail] = *n;
                tail += 1;
            }
        }
    }

    fn react_all(&mut self, fi: usize) {
        while self.f[fi].npending > 0 {
            let f = &mut self.f[fi];
            let bi = f.pending[0] as usize;
            f.pending.copy_within(1..f.npending, 0);
            f.npending -= 1;
            if self.f[fi].hp <= 0 || self.f[1 - fi].hp <= 0 || self.t < self.f[fi].blocks[bi].react_at {
                continue;
            }
            let t = self.t;
            let b = &mut self.f[fi].blocks[bi];
            b.react_at = t + b.cd;
            b.prog = 0;
            self.fire(fi, bi);
        }
    }

    fn act(&mut self, fi: usize) {
        if self.f[fi].hp <= 0 || self.f[fi].nb == 0 {
            return;
        }
        let shaking = self.shaking(fi);
        let t = self.t;
        let f = &mut self.f[fi];
        if shaking && (f.frozen > 0 || f.slow_t > 0) {
            f.frozen = 0;
            f.slow_t = 0;
            f.slow_p = 0;
        }
        let frozen = f.frozen > 0;
        if frozen {
            f.frozen -= 1;
            if f.frozen == 0 {
                f.immune_until = t + CTL_IMMUNE;
            }
        }
        let rate = mul_p(if f.slow_t > 0 { ONE - f.slow_p } else { ONE }, if f.haste_t > 0 { ONE + f.haste_p } else { ONE });
        let mut ready = [0u8; MAX_SKILLS];
        let mut nr = 0;
        for bi in 0..f.nb {
            let b = &mut f.blocks[bi];
            if frozen && b.mark != MARK_STEADFAST {
                continue;
            }
            b.prog += rate;
            if b.prog >= b.cd * ONE {
                b.prog -= b.cd * ONE;
                ready[nr] = bi as u8;
                nr += 1;
            }
        }
        for &bi in &ready[..nr] {
            self.fire(fi, bi as usize);
        }
    }

    /// once a second (combat.ts: t % TPS === 0)
    fn second(&mut self) {
        let sec = self.t / TPS;
        for fi in 0..2 {
            if self.f[fi].hp <= 0 {
                continue;
            }
            let hero = self.f[fi].hero;
            if hero == H_DUELIST && DUELIST_REGEN > 0 && sec > 0 && sec % DUELIST_REGEN == 0 {
                self.add_dodge(fi, 1);
            } else if hero == H_SAGE && SAGE_GROW > 0 && sec > 0 && sec % SAGE_GROW == 0 {
                self.grow(fi, ONE);
            }
        }
        for fi in 0..2 {
            if self.f[fi].hp > 0 && self.f[fi].has(RL_OLDROOTS) && sec > 0 && sec % R_OLDROOTS == 0 {
                self.grow(fi, ONE);
            }
        }
        for fi in 0..2 {
            if self.f[fi].burns.len > 0 && self.f[fi].hp > 0 {
                let d = self.f[fi].burns.sum();
                let melt = if self.f[1 - fi].has(RL_MELTDOWN) { R_MELTDOWN_P } else { ONE };
                let f = &mut self.f[fi];
                f.shield -= min(f.shield, mul_p(mul_p(d, BURN_SCORCH_P), melt));
                self.deal(fi, d, 0, Kind::Burn);
                self.f[fi].burns.tick_down();
            }
            if self.f[fi].poisons.len > 0 && self.f[fi].hp > 0 {
                let d = self.f[fi].poisons.sum();
                self.deal(fi, d, 0, Kind::Poison);
                self.f[fi].poisons.tick_down();
            }
        }
        self.ult_check();
    }
}

pub fn simulate<P: Probe>(a: &Build, b: &Build, seed: u32, day: usize, probe: &mut P) -> Outcome {
    let d = day.clamp(1, DAYS);
    let f_cap = FREEZE_CAP[d];
    // one zeroed heap block for the whole fight state (all-zero is a valid Sim: integers, bools, small arrays)
    let mut s: Box<Sim> = unsafe {
        let layout = core::alloc::Layout::new::<Sim>();
        let p = alloc::alloc::alloc_zeroed(layout) as *mut Sim;
        assert!(!p.is_null());
        Box::from_raw(p)
    };
    s.f_cap = f_cap;
    s.s_cap = rdiv(f_cap * 7, 4);
    s.day = day as i64;
    init_fighter(&mut s.f[0], a, day);
    init_fighter(&mut s.f[1], b, day);
    let mut rng = Rng::new(seed);
    let first = rng.int(2) as i64;
    // ใจเหล็ก from the start when the build owns a steadfast skill
    for fi in 0..2 {
        let f = &mut s.f[fi];
        for bi in 0..f.nb {
            let st = node(f.blocks[bi].id, f.blocks[bi].v).steadfast;
            f.ctl_keep = min(f.ctl_keep, st);
        }
    }
    // onStart: the duelist starts with a dodge charge
    for fi in 0..2 {
        if s.f[fi].hero == H_DUELIST {
            s.add_dodge(fi, 1);
        }
    }
    let (f_start, f_step) = (FATIGUE_START[d], FATIGUE_STEP[d]);
    let mut winner: i8 = -1;
    let mut decided = false;
    let mut t = 1;
    while t <= MAX_TICKS {
        s.t = t;
        let order: [usize; 2] = if (t + first) % 2 == 0 { [0, 1] } else { [1, 0] };
        for &side in &order {
            s.act(side);
            s.react_all(1 - side);
            s.react_all(side);
            s.ult_check();
        }
        let dr_tick = t % FREEZE_DR_DECAY == 0;
        for fi in 0..2 {
            let f = &mut s.f[fi];
            if f.slow_t > 0 {
                f.slow_t -= 1;
                f.slow_total += 1;
            }
            if f.haste_t > 0 {
                f.haste_t -= 1;
            }
            if f.wound_t > 0 {
                f.wound_t -= 1;
            }
            if dr_tick && f.freeze_n > 0 {
                f.freeze_n -= 1;
            }
            if dr_tick && f.delay_n > 0 {
                f.delay_n -= 1;
            }
            if f.thorns_next <= t {
                let mut k = 0;
                while k < f.thorns.len {
                    if f.thorns.until[k] as i64 <= t {
                        f.thorns.remove(k);
                    } else {
                        k += 1;
                    }
                }
                f.thorns_next = f.thorns.min_until();
            }
        }
        if t % TPS == 0 {
            s.second();
        }
        if t >= f_start && (t - f_start) % TPS == 0 {
            let n = ((t - f_start) / TPS + 1) * f_step;
            for fi in 0..2 {
                s.deal(fi, n, 0, Kind::Fatigue);
            }
        }
        probe.tick(t, &s.f);
        if s.f[0].hp <= 0 || s.f[1].hp <= 0 {
            if s.f[0].hp <= 0 && s.f[1].hp <= 0 {
                let d = s.f[0].dealt_total - s.f[1].dealt_total;
                winner = if d.abs() * 20 <= max(s.f[0].dealt_total, s.f[1].dealt_total) { -1 } else if d > 0 { 0 } else { 1 };
            } else {
                winner = if s.f[0].hp > 0 { 0 } else { 1 };
            }
            decided = true;
            break;
        }
        t += 1;
    }
    if !decided {
        t = MAX_TICKS;
        let c0 = s.f[0].hp * s.f[1].max_hp;
        let c1 = s.f[1].hp * s.f[0].max_hp;
        winner = if c0 == c1 { -1 } else if c0 > c1 { 0 } else { 1 };
    }
    Outcome { winner, ticks: t, hp: [s.f[0].hp, s.f[1].hp] }
}
