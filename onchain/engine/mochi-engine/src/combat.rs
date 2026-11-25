//! The fight, sim v12. A rule-for-rule port of arena-game-jj/src/sim/combat.ts (same order of operations, same
//! integer formulas), minus everything that only feeds the UI (events, per-block stats, trace).
//! State lives in fixed-size arrays: no heap, no allocation, small enough for an SBF stack frame.
use crate::data::*;
use crate::fixed::{ceil_div, mul_p, rdiv, ONE};
use crate::rng::Rng;
use crate::types::*;
use alloc::boxed::Box;

/// Capacity of the per-fighter stacks. Measured maximum over 20,000 differential fights (bot + chaos builds):
/// growth 55, thorns 21, burns 21. Values are stored as u16 (all small; thorns expiry is a tick ≤ 1,030) so a
/// fighter stays well inside one 4 KB SBF stack frame. Exceeding a capacity or u16 panics (never silently wrong).
pub const GROW_CAP: usize = 128;
pub const THORNS_CAP: usize = 64;
pub const BURNS_CAP: usize = 64;
/// thorns that never wear off
const PERM: i64 = u16::MAX as i64;
const MAX_FREEZE_TICKS: i64 = 15;
const SLOW_CAP_P: i64 = 500_000;
const MAX_CHAIN: u8 = 8;
const REACT_MIN: i64 = 5;
const THORNS_HEAL_P: i64 = 500_000;
/// 0.6^n in ppm, same integer recurrence as combat.ts DR_P
const DR_P: [i64; 24] = {
    let mut t = [0i64; 24];
    t[0] = ONE;
    let mut i = 1;
    while i < 24 {
        t[i] = ((2 * t[i - 1] * 600_000 + ONE) / (2 * ONE)) as i64;
        i += 1;
    }
    t
};
#[inline(always)]
fn dr_of(n: i64) -> i64 {
    if (n as usize) < DR_P.len() { DR_P[n as usize] } else { 0 }
}

#[derive(Clone, Copy, Default)]
pub struct Block {
    pub id: u8,
    pub v: u8,
    pub mark: u8,
    /// index into build.skills
    pub idx: u8,
    pub cd: i64,
    /// cd × ONE, precomputed (the per-tick hot loop compares against it)
    pub cd_p: i64,
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
}

/// A fixed-capacity stack of (value, until), stored as u16.
#[derive(Clone, Copy)]
pub struct Stack<const N: usize> {
    pub v: [u16; N],
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
        assert!(self.len < N && (0..=u16::MAX as i64).contains(&v) && (0..=u16::MAX as i64).contains(&until), "stack overflow");
        self.v[self.len] = v as u16;
        self.until[self.len] = until as u16;
        self.len += 1;
    }
    /// earliest `until` (thorns expiry); PERM (u16::MAX) never expires
    #[inline(always)]
    pub fn min_until(&self) -> i64 {
        let mut m = u16::MAX;
        for i in 0..self.len {
            if self.until[i] < m {
                m = self.until[i];
            }
        }
        if m == u16::MAX { i64::MAX } else { m as i64 }
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
    /// remove item i keeping order
    pub fn remove(&mut self, i: usize) {
        for k in i..self.len - 1 {
            self.v[k] = self.v[k + 1];
            self.until[k] = self.until[k + 1];
        }
        self.len -= 1;
    }
}

#[derive(Clone, Copy, Default)]
pub struct Fighter {
    pub hero: u8,
    pub blocks: [Block; MAX_SKILLS],
    pub nb: usize,
    pub hp: i64,
    pub max_hp: i64,
    pub shield: i64,
    pub frozen: i64,
    pub frozen_total: i64,
    pub delay_n: i64,
    pub slow_p: i64,
    pub slow_t: i64,
    pub slow_total: i64,
    pub growth: Stack<GROW_CAP>,
    /// ppm, ONE = none
    pub charge: i64,
    pub charge_hits: i64,
    pub thorns: Stack<THORNS_CAP>,
    /// earliest thorns expiry (cache; never later than the true minimum, so no expiry is missed)
    pub thorns_next: i64,
    /// burns: v = dps, until = ticks left
    pub burns: Stack<BURNS_CAP>,
    pub freeze_n: i64,
    pub ctl_keep: i64,
    pub ignore_freeze: bool,
    pub leech_next: i64,
    pub thorns_heal: i64,
    pub immune_until: i64,
    pub pending: [u8; MAX_SKILLS],
    pub npending: usize,
    pub last_fire: i64,
    /// hero hook scratch: hits dealt (assassin, duelist), hits taken (berserker), raged (berserker)
    pub hits: i64,
    pub hits_taken: i64,
    pub raged: bool,
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

#[derive(Clone, Copy, PartialEq, Eq)]
enum Src {
    Hit,
    Thorns,
    Burn,
    Fatigue,
}

#[derive(Clone, Copy, Default)]
struct Fire {
    bi: u8,
    depth: u8,
    from: bool,
    mult: i64,
    restart: bool,
}

#[inline(always)]
fn node(id: u8, v: u8) -> &'static Node {
    &SKILLS[id as usize].tree[v as usize]
}

/// connect bonus condition: a skill id, or an archetype
#[inline(always)]
fn matches(t: u8, id: u8) -> bool {
    t == id || t == ARCH_TARGET + SKILLS[id as usize].arch
}

/// cooldown in ticks with mark and haste bonuses (combat.ts cdTicks)
pub fn cd_ticks(k: &SkillInst, haste_count: i64) -> i64 {
    let q = if k.mark == MARK_QUICK { 600_000 } else { ONE };
    let h = core::cmp::max(500_000, ONE - haste_count * 200_000);
    core::cmp::max(5, rdiv(node(k.id, k.v).cd * q * h, ONE * ONE))
}

/// Fills a zeroed fighter in place (no large value on the stack: SBF frames are 4 KB).
#[inline(always)]
fn push_thorns(f: &mut Fighter, v: i64, until: i64) {
    f.thorns.push(v, until);
    if until < PERM && until < f.thorns_next {
        f.thorns_next = until;
    }
}

fn init_fighter(f: &mut Fighter, b: &Build, day: usize) {
    let n = b.n as usize;
    f.thorns_next = i64::MAX;
    f.nb = n;
    f.hero = b.hero;
    let d = day.clamp(1, DAYS);
    f.max_hp = HERO_MAX_HP[b.hero as usize][d];
    f.hp = f.max_hp;
    f.shield = HERO_START_SHIELD[b.hero as usize][d];
    f.charge = ONE;
    f.ctl_keep = ONE;
    f.thorns_heal = THORNS_HEAL_P;
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
        let blk = &mut f.blocks[i];
        blk.id = k.id;
        blk.v = k.v;
        blk.mark = k.mark;
        blk.idx = i as u8;
        blk.cd = cd_ticks(k, counts[BK_HASTE as usize]);
        blk.cd_p = blk.cd * ONE;
        blk.power = ONE + counts[BK_POWER as usize] * 150_000;
        blk.dmg = counts[BK_DMG as usize] * lv;
        blk.shield_on_fire = counts[BK_SHIELD as usize] * (1 + lv);
        blk.triggers = trig;
        blk.ntrig = ntrig;
        blk.reacts = node(k.id, k.v).reacts;
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
    // hero passive at fight start: thornguard begins with 1 permanent thorns
    if f.hero == H_THORNGUARD {
        push_thorns(f, 1, PERM);
    }
}

struct Sim {
    f: [Fighter; 2],
    t: i64,
    f_cap: i64,
    s_cap: i64,
}

impl Sim {
    #[inline(always)]
    fn shaking(&self, x: usize) -> bool {
        self.t - self.f[x].last_fire >= SHAKE_OFF
    }
    #[inline(always)]
    fn ctl_room(&self, x: usize) -> i64 {
        core::cmp::min(self.f_cap, CTL_BASE + (3 * self.t) / 10) - self.f[x].frozen_total
    }
    fn can_control(&self, foe: usize) -> bool {
        let x = &self.f[foe];
        !(x.frozen > 0 || self.t < x.immune_until || self.shaking(foe))
    }
    fn thorns_until(&self, fi: usize) -> i64 {
        self.t + if self.f[fi].hero == H_THORNGUARD { THORNGUARD_THORNS_SECS * 10 } else { THORNS_TICKS }
    }
    fn burn_left(&self, x: usize) -> i64 {
        let b = &self.f[x].burns;
        let mut s = 0;
        for i in 0..b.len {
            s += b.v[i] as i64 * ceil_div(b.until[i] as i64, 10);
        }
        s
    }

    /// share_p: share of the hit shields can block (ppm)
    fn deal(&mut self, target: usize, amount: i64, share_p: i64, src: Src) {
        let x = &mut self.f[target];
        if amount <= 0 || x.hp <= 0 {
            return;
        }
        let mut blocked = 0;
        if share_p > 0 && x.shield > 0 {
            blocked = core::cmp::min(x.shield, mul_p(amount, share_p));
            x.shield -= blocked;
        }
        x.hp -= amount - blocked;
        // berserker passive (heroes.ts onDamaged)
        if x.hero == H_BERSERKER {
            if src == Src::Hit && x.hp > 0 {
                x.hits_taken += 1;
                if x.hits_taken % BERSERKER_HITS == 0 {
                    x.growth.push(1, 0);
                }
            }
            if !x.raged && x.hp > 0 && 2 * x.hp < x.max_hp {
                x.raged = true;
                x.growth.push(2, 0);
            }
        }
    }

    fn add_burn(&mut self, foe: usize, dps: i64, ticks: i64) {
        self.f[foe].burns.push(dps, ticks);
    }

    fn heal(&mut self, fi: usize, mut n: i64) {
        let foe = 1 - fi;
        if self.f[foe].thorns.len > 0 {
            n = core::cmp::max(1, mul_p(n, self.f[foe].thorns_heal));
        }
        let f = &mut self.f[fi];
        let h = core::cmp::min(n, f.max_hp - f.hp);
        if h > 0 {
            f.hp += h;
        }
    }

    fn on_hit(&mut self, fi: usize, dmg: i64) -> i64 {
        let foe = 1 - fi;
        let (foe_slowed, foe_frozen) = (self.f[foe].slow_t > 0, self.f[foe].frozen > 0);
        let f = &mut self.f[fi];
        let out = match f.hero {
            h if h == H_ASSASSIN => {
                f.hits += 1;
                if f.hits == 1 { mul_p(dmg, ASSASSIN_FIRST_P) } else { dmg }
            }
            h if h == H_DUELIST => {
                f.hits += 1;
                if f.hits % 3 == 0 { dmg + core::cmp::max(1, mul_p(dmg, DUELIST_THIRD_P)) } else { dmg }
            }
            h if h == H_CHRONO => {
                if foe_slowed || foe_frozen { mul_p(dmg, 1_100_000) } else { dmg }
            }
            _ => return dmg,
        };
        core::cmp::max(0, out)
    }

    /// ctx.hit: returns damage dealt
    fn hit(&mut self, fi: usize, skill: u8, n: i64, bonus_dmg: i64, pierce_p: i64, leech_p: i64) -> i64 {
        let foe = 1 - fi;
        if self.f[foe].hp <= 0 || self.f[fi].hp <= 0 {
            return 0;
        }
        let mult = self.f[fi].charge;
        let mut dmg = mul_p(n + self.f[fi].growth.sum() + bonus_dmg, mult);
        dmg = self.on_hit(fi, dmg);
        {
            let f = &mut self.f[fi];
            if f.charge_hits > 1 {
                f.charge_hits -= 1;
            } else {
                f.charge = ONE;
                f.charge_hits = 0;
            }
        }
        let hp_before = self.f[foe].hp;
        // sim v13: every skill hit is kind Hit (the damage kind no longer comes from the skill id)
        let _ = skill;
        self.deal(foe, dmg, ONE - pierce_p, Src::Hit);
        let dealt = core::cmp::max(0, hp_before - core::cmp::max(0, self.f[foe].hp));
        let leech = leech_p + self.f[fi].leech_next;
        self.f[fi].leech_next = 0;
        if leech > 0 && dealt > 0 {
            self.heal(fi, core::cmp::max(1, mul_p(dealt, leech)));
        }
        let th = core::cmp::min(self.f[foe].thorns.sum(), ceil_div(dmg * 3, 4));
        if th > 0 && self.f[fi].hp > 0 {
            self.deal(fi, th, ONE, Src::Thorns);
        }
        dealt
    }

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

    fn freeze(&mut self, fi: usize, secs_p: i64, ctl: i64) {
        let foe = 1 - fi;
        if !self.can_control(foe) {
            return;
        }
        if self.f[foe].ignore_freeze {
            self.f[foe].ignore_freeze = false;
            return;
        }
        let mut tp = mul_p(secs_p * 10, ctl);
        if self.f[fi].hero == H_WITCH {
            tp += WITCH_FREEZE_TICKS * ONE;
        }
        tp = mul_p(mul_p(tp, dr_of(self.f[foe].freeze_n)), self.f[foe].ctl_keep);
        let room = self.ctl_room(foe);
        let ticks = core::cmp::max(0, core::cmp::min(core::cmp::min(MAX_FREEZE_TICKS, room), rdiv(tp, ONE)));
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

    fn slow(&mut self, fi: usize, pct0: i64, secs0: i64, ctl: i64) {
        let foe = 1 - fi;
        let s0 = mul_p(secs0, ctl);
        let (pct, secs) = if self.f[fi].hero == H_CHRONO { (pct0 + 100_000, s0 + ONE) } else { (pct0, s0) };
        let p = core::cmp::min(SLOW_CAP_P, mul_p(pct, self.f[foe].ctl_keep));
        {
            let x = &mut self.f[foe];
            x.slow_p = if x.slow_t > 0 { core::cmp::max(x.slow_p, p) } else { p };
        }
        let room = if self.shaking(foe) {
            0
        } else {
            let x = &self.f[foe];
            core::cmp::max(0, core::cmp::min(self.s_cap, 2 * CTL_BASE + (6 * self.t) / 10) - x.slow_total - x.slow_t)
        };
        let x = &mut self.f[foe];
        let add = core::cmp::min(room, core::cmp::max(0, ceil_div(secs * 10, ONE) - x.slow_t));
        if add <= 0 && x.slow_t <= 0 {
            return;
        }
        x.slow_t += add;
        if add >= REACT_MIN && p >= 300_000 {
            self.controlled(foe);
        }
    }

    fn delay(&mut self, fi: usize, secs_p: i64, ctl: i64) {
        let foe = 1 - fi;
        if !self.can_control(foe) {
            return;
        }
        let tp = mul_p(mul_p(mul_p(secs_p * 10, ctl), dr_of(self.f[foe].delay_n)), self.f[foe].ctl_keep);
        let ticks = core::cmp::max(0, core::cmp::min(self.ctl_room(foe), rdiv(tp, ONE)));
        let t = self.t;
        let x = &mut self.f[foe];
        x.delay_n += 1;
        if ticks > 0 {
            x.frozen_total += ticks;
            for b in x.blocks[..x.nb].iter_mut() {
                b.prog = core::cmp::max(0, b.prog - ticks * ONE);
            }
            x.immune_until = t + CTL_IMMUNE;
        }
        if ticks >= REACT_MIN {
            self.controlled(foe);
        }
    }

    fn cleanse(&mut self, fi: usize, stacks: i64) -> i64 {
        let t = self.t;
        let f = &mut self.f[fi];
        let mut n = 0;
        let mut r = 0;
        while r < stacks && f.burns.len > 0 {
            let mut k = 0;
            for i in 0..f.burns.len {
                if f.burns.v[i] > f.burns.v[k] {
                    k = i;
                }
            }
            f.burns.remove(k);
            n += 1;
            r += 1;
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
        for _ in 0..times {
            let mut any = false;
            if self.f[foe].growth.len > 0 {
                let (v, _) = self.f[foe].growth.pop();
                let keep = v / 2;
                if keep > 0 {
                    self.f[foe].growth.push(keep, 0);
                }
                if steal {
                    self.f[fi].growth.push(v - keep, 0);
                }
                n += 1;
                any = true;
            }
            let x = &mut self.f[foe];
            if x.thorns.len > 0 {
                let (v, until) = x.thorns.pop();
                if x.hero == H_THORNGUARD && v >= 2 {
                    push_thorns(x, v / 2, until);
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
        }
        let x = &mut self.f[foe];
        let cut = (x.shield * share_p) / ONE;
        if cut > 0 {
            x.shield -= cut;
            n += 1;
        }
        n
    }

    /// run one skill variant (skills.ts execNode with the combat.ts ctx)
    fn run_skill(&mut self, fi: usize, bi: usize, power: i64, bonus_dmg: i64) {
        let foe = 1 - fi;
        let blk = self.f[fi].blocks[bi];
        let ctl = core::cmp::min(ONE, power);
        let v = |x: i64| core::cmp::max(1, rdiv(x * power, ONE * ONE));
        let mut removed: i64 = 0;
        for e in node(blk.id, blk.v).fx.iter() {
            match *e {
                Eff::Hit(h) => {
                    if h.if_slowed && self.f[foe].slow_t <= 0 {
                        continue;
                    }
                    for _ in 0..h.times {
                        let mut np = h.n + h.per_removed * removed;
                        if h.shield_pct != 0 {
                            np += self.f[fi].shield * h.shield_pct;
                        }
                        if h.thorns_x != 0 {
                            np += self.f[fi].thorns.sum() * h.thorns_x;
                        }
                        if h.burn_pct != 0 {
                            np += self.burn_left(foe) * h.burn_pct;
                        }
                        if np <= 0 {
                            break;
                        }
                        let mut m = ONE;
                        let fo = &self.f[foe];
                        if h.exec_m != 0 && fo.hp * ONE < fo.max_hp * h.exec_hp {
                            m = mul_p(m, h.exec_m);
                        }
                        if h.frozen != 0 && fo.frozen > 0 {
                            m = mul_p(m, h.frozen);
                        }
                        if h.no_shield != 0 && fo.shield <= 0 {
                            m = mul_p(m, h.no_shield);
                        }
                        self.hit(fi, blk.id, v(mul_p(np, m)), bonus_dmg, h.pierce, h.leech);
                        if h.burn_dps != 0 {
                            self.burn(fi, v(h.burn_dps), h.burn_secs);
                        }
                    }
                }
                Eff::Shield(n) => self.f[fi].shield += v(n),
                Eff::Heal(n) => self.heal(fi, v(n)),
                Eff::Burn { dps, secs, growth_half } => {
                    let g = if growth_half { (self.f[fi].growth.sum() / 2) * ONE } else { 0 };
                    self.burn(fi, v(dps + g), secs);
                }
                Eff::Freeze(s) => self.freeze(fi, s, ctl),
                Eff::Slow { pct, secs } => self.slow(fi, pct, secs, ctl),
                Eff::Delay(s) => self.delay(fi, s, ctl),
                Eff::Grow(n) => self.f[fi].growth.push(v(n), 0),
                Eff::Charge { mult, hits } => {
                    let f = &mut self.f[fi];
                    if mult >= f.charge {
                        f.charge = mult;
                        f.charge_hits = core::cmp::max(1, hits);
                    }
                }
                Eff::Thorns { n, perm, heal } => {
                    let until = if perm { PERM } else { self.thorns_until(fi) };
                    let f = &mut self.f[fi];
                    push_thorns(f, v(n), until);
                    if heal >= 0 {
                        f.thorns_heal = core::cmp::min(f.thorns_heal, heal);
                    }
                }
                Eff::Steadfast { keep, ignore_freeze } => {
                    let f = &mut self.f[fi];
                    f.ctl_keep = core::cmp::min(f.ctl_keep, keep);
                    if ignore_freeze {
                        f.ignore_freeze = true;
                    }
                    if f.frozen > 0 {
                        f.frozen = core::cmp::max(1, mul_p(f.frozen, keep));
                    }
                }
                Eff::Cleanse(n) => removed = self.cleanse(fi, n),
                Eff::Dispel { n, shield, steal } => removed = self.dispel(fi, n, shield, steal),
                Eff::Amplify(cap0) => {
                    let cap = core::cmp::max(1, mul_p(cap0, ctl));
                    let until = self.thorns_until(fi);
                    let f = &mut self.f[fi];
                    let g = core::cmp::min(cap, f.growth.sum());
                    let th = core::cmp::min(cap, f.thorns.sum());
                    if g > 0 {
                        f.growth.push(g, 0);
                    }
                    if th > 0 {
                        push_thorns(f, th, until);
                    }
                    if f.charge > ONE {
                        f.charge = ONE + core::cmp::min(cap * ONE, (f.charge - ONE) * 2);
                    }
                }
                Eff::Leech(p) => {
                    let f = &mut self.f[fi];
                    f.leech_next = core::cmp::max(f.leech_next, p);
                }
            }
        }
    }

    fn burn(&mut self, fi: usize, dps: i64, secs: i64) {
        let s = if self.f[fi].hero == H_PYRO { mul_p(secs, PYRO_BURN_P) } else { secs };
        self.add_burn(1 - fi, dps, s * 10);
    }

    /// fires one skill; writes the follow-up fires (trigger bonuses + engines) into `next`, returns how many
    fn fire_one(&mut self, fi: usize, q: Fire, next: &mut [Fire; 4]) -> usize {
        let foe = 1 - fi;
        let t = self.t;
        let bi = q.bi as usize;
        {
            let blk = &mut self.f[fi].blocks[bi];
            if q.from {
                blk.trig_at = t + core::cmp::min(TRIGGER_GAP_MAX, core::cmp::max(TRIGGER_GAP, blk.cd));
                if q.restart {
                    blk.prog = 0;
                }
            }
        }
        self.f[fi].last_fire = t;
        let blk = self.f[fi].blocks[bi];
        let power = mul_p(blk.power, q.mult);
        self.run_skill(fi, bi, power, mul_p(blk.dmg, q.mult));
        if blk.shield_on_fire > 0 && self.f[fi].hp > 0 {
            self.f[fi].shield += core::cmp::max(1, mul_p(blk.shield_on_fire, q.mult));
        }
        if blk.mark == MARK_ECHO && self.f[foe].hp > 0 && self.f[fi].hp > 0 {
            self.run_skill(fi, bi, rdiv(power, 2), rdiv(blk.dmg * q.mult, 2 * ONE));
        }
        if blk.mark == MARK_BURN && self.f[foe].hp > 0 {
            self.add_burn(foe, 1, 30);
        }
        let tm = if q.depth >= 1 { mul_p(q.mult, CHAIN_DECAY_P) } else { q.mult };
        let mut nn = 0;
        for k in 0..blk.ntrig as usize {
            next[nn] = Fire { bi: blk.triggers[k], depth: q.depth + 1, from: true, mult: tm, restart: false };
            nn += 1;
        }
        if let Some(en) = node(blk.id, blk.v).engine {
            let ep = mul_p(mul_p(en.power, blk.power), core::cmp::min(ONE, q.mult));
            let na = blk.nadj as usize;
            match en.kind {
                EngineKind::Gear if na > 0 => {
                    for _ in 0..core::cmp::min(en.n as usize, na) {
                        let b = &mut self.f[fi].blocks[bi];
                        let target = b.adj[(b.rr as usize) % na];
                        b.rr += 1;
                        next[nn] = Fire { bi: target, depth: q.depth + 1, from: true, mult: ep, restart: false };
                        nn += 1;
                    }
                }
                EngineKind::Overclock => {
                    for k in 0..na {
                        next[nn] = Fire { bi: blk.adj[k], depth: q.depth + 1, from: true, mult: ep, restart: !en.keep };
                        nn += 1;
                    }
                }
                _ => {}
            }
        }
        nn
    }

    /// fire a skill then everything it sets off, breadth-first (each skill at most once per chain)
    fn fire(&mut self, fi: usize, start: usize) {
        let foe = 1 - fi;
        let mut seen: u16 = 1 << start;
        let mut queue = [Fire::default(); MAX_SKILLS];
        let (mut head, mut tail) = (0usize, 0usize);
        queue[tail] = Fire { bi: start as u8, depth: 0, from: false, mult: ONE, restart: false };
        tail += 1;
        let mut next = [Fire::default(); 4];
        while head < tail {
            let q = queue[head];
            head += 1;
            if self.f[fi].hp <= 0 || self.f[foe].hp <= 0 {
                return;
            }
            let nn = self.fire_one(fi, q, &mut next);
            if q.depth >= MAX_CHAIN {
                continue;
            }
            for n in &next[..nn] {
                let bit = 1u16 << n.bi;
                if seen & bit != 0 || self.t < self.f[fi].blocks[n.bi as usize].trig_at {
                    continue;
                }
                seen |= bit;
                queue[tail] = *n;
                tail += 1;
            }
        }
    }

    fn react_all(&mut self, fi: usize) {
        let foe = 1 - fi;
        while self.f[fi].npending > 0 {
            let f = &mut self.f[fi];
            let bi = f.pending[0] as usize;
            for k in 1..f.npending {
                f.pending[k - 1] = f.pending[k];
            }
            f.npending -= 1;
            if self.f[fi].hp <= 0 || self.f[foe].hp <= 0 || self.t < self.f[fi].blocks[bi].react_at {
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
        let rate = if f.slow_t > 0 { ONE - f.slow_p } else { ONE };
        let mut ready = [0u8; MAX_SKILLS];
        let mut nr = 0;
        let nb = f.nb;
        for (bi, b) in f.blocks[..nb].iter_mut().enumerate() {
            if frozen && b.mark != MARK_STEADFAST {
                continue;
            }
            b.prog += rate;
            if b.prog >= b.cd_p {
                b.prog -= b.cd_p;
                ready[nr] = bi as u8;
                nr += 1;
            }
        }
        for k in 0..nr {
            self.fire(fi, ready[k] as usize);
        }
    }
}

/// Same contract as combat.ts simulate(a, b, seed, day): deterministic winner, ticks and HP left.
pub fn simulate<P: Probe>(a: &Build, b: &Build, seed: u32, day: usize, probe: &mut P) -> Outcome {
    let d = day.clamp(1, DAYS);
    let f_cap = FREEZE_CAP[d];
    // one zeroed heap block for the whole fight state (all-zero is a valid Sim: integers, bools, u8/u16 arrays)
    let mut s: Box<Sim> = unsafe {
        let layout = core::alloc::Layout::new::<Sim>();
        let p = alloc::alloc::alloc_zeroed(layout) as *mut Sim;
        assert!(!p.is_null());
        Box::from_raw(p)
    };
    s.f_cap = f_cap;
    s.s_cap = rdiv(f_cap * 7, 4);
    init_fighter(&mut s.f[0], a, day);
    init_fighter(&mut s.f[1], b, day);
    let mut rng = Rng::new(seed);
    let first = rng.int(2) as i64;
    let (f_start, f_step) = (FATIGUE_START[d], FATIGUE_STEP[d]);
    let mut winner: i8 = -1;
    let mut decided = false;
    let mut t = 1;
    // countdowns instead of t % 40, t % 10 and the fatigue modulo (same ticks, no division in the loop)
    let (mut to40, mut to10) = (40i64, 10i64);
    let mut to_fatigue = if f_start >= 1 { f_start } else { 1 };
    let mut fatigue_n: i64 = 0;
    while t <= MAX_TICKS {
        s.t = t;
        let order: [usize; 2] = if (t + first) % 2 == 0 { [0, 1] } else { [1, 0] };
        for &side in &order {
            s.act(side);
            s.react_all(1 - side);
            s.react_all(side);
        }
        to40 -= 1;
        to10 -= 1;
        let dr_tick = to40 == 0;
        for fi in 0..2 {
            let f = &mut s.f[fi];
            if f.slow_t > 0 {
                f.slow_t -= 1;
                f.slow_total += 1;
            }
            if dr_tick && f.freeze_n > 0 {
                f.freeze_n -= 1;
            }
            if dr_tick && f.delay_n > 0 {
                f.delay_n -= 1;
            }
            // thorns that wore off (permanent ones never do): scan only when the earliest expiry is due
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
        if dr_tick {
            to40 = 40;
        }
        if to10 == 0 {
            to10 = 10;
            for fi in 0..2 {
                if s.f[fi].burns.len == 0 || s.f[fi].hp <= 0 {
                    continue;
                }
                let total = s.f[fi].burns.sum();
                s.deal(fi, total, 0, Src::Burn);
                let bu = &mut s.f[fi].burns;
                let mut k = 0;
                while k < bu.len {
                    let left = bu.until[k] as i64 - 10;
                    bu.until[k] = left.max(0) as u16;
                    if left > 0 {
                        k += 1;
                    } else {
                        bu.remove(k);
                    }
                }
            }
        }
        to_fatigue -= 1;
        if to_fatigue == 0 {
            // fatigue every second from f_start: n-th second deals n × step
            fatigue_n += 1;
            let n = fatigue_n * f_step;
            s.deal(0, n, 0, Src::Fatigue);
            s.deal(1, n, 0, Src::Fatigue);
            to_fatigue = 10;
        }
        probe.tick(t, &s.f);
        if s.f[0].hp <= 0 || s.f[1].hp <= 0 {
            winner = if s.f[0].hp == s.f[1].hp { -1 } else if s.f[0].hp > s.f[1].hp { 0 } else { 1 };
            decided = true;
            break;
        }
        t += 1;
    }
    if !decided {
        t = MAX_TICKS;
        let r0 = s.f[0].hp * s.f[1].max_hp;
        let r1 = s.f[1].hp * s.f[0].max_hp;
        winner = if r0 == r1 { -1 } else if r0 > r1 { 0 } else { 1 };
    }
    Outcome { winner, ticks: t, hp: [s.f[0].hp, s.f[1].hp] }
}

#[cfg(test)]
mod size_tests {
    use super::*;
    #[test]
    fn state_fits_an_sbf_frame() {
        let f = core::mem::size_of::<Fighter>();
        std::println!("Fighter {} B, Sim {} B, Build {} B", f, core::mem::size_of::<Sim>(), core::mem::size_of::<Build>());
        assert!(2 * f < 4096, "two fighters must fit one 4 KB frame");
    }
}
