//! One run (รอบ), sim v12: a rule-for-rule port of arena-game-jj/src/sim/run.ts + the connect-bonus roll of
//! links.ts. Same order of RNG calls, same accept/reject behaviour (the TS functions are the reference; phase
//! guards that only the UI enforced in TS belong to the on-chain program, not here).
//!
//! `RunState` is `#[repr(C)]` with integer fields only, so any byte pattern is a valid value: the program can
//! use account bytes directly (zero-copy) instead of (de)serialising it on every action.
use crate::combat::{simulate, NoProbe, Outcome};
use crate::data::*;
use crate::rng::Rng;
use crate::types::*;

pub const PHASE_SHOP: u8 = 0;
pub const PHASE_LASTCHANCE: u8 = 1;
pub const PHASE_MARK: u8 = 2;
pub const PHASE_WON: u8 = 3;
pub const PHASE_DEAD: u8 = 4;
pub const LC_AWAKEN: u8 = 0;
pub const LC_MARK: u8 = 1;
pub const LC_SUPPLY: u8 = 2;

/// A shop offer. `present == 0`: empty place (bought, or the shop rolled fewer than 5).
#[repr(C)]
#[derive(Clone, Copy, Default, Debug, PartialEq, Eq)]
pub struct Offer {
    pub present: u8,
    pub id: u8,
    pub v: u8,
    pub nb: u8,
    pub bonus: [Bonus; MAX_BONUS],
}

#[repr(C)]
#[derive(Clone, Copy, Default, Debug, PartialEq, Eq)]
pub struct RunState {
    pub seed: u32,
    pub hp: i16,
    pub gold: u16,
    pub rolls: u16,
    pub hero: u8,
    pub day: u8,
    pub wins: u8,
    pub losses: u8,
    pub streak: i8,
    pub last_base: u8,
    pub last_bonus: u8,
    pub bonus_slots: u8,
    pub slot_buys: u8,
    pub ghost: u8,
    /// 0 = none, 1..=4 = MARKS index + 1
    pub pending_mark: u8,
    pub phase: u8,
    pub conceded: u8,
    pub wishes: u8,
    pub n: u8,
    pub locks: [u8; SHOP_SIZE],
    /// explicit padding: no implicit padding bytes anywhere, so the raw bytes are fully defined
    pub _pad: [u8; 4],
    pub skills: [SkillInst; MAX_SKILLS],
    pub shop: [Offer; SHOP_SIZE],
}

/// rng.ts hashSeed: FNV-1a over the parts joined with '|' (numbers in decimal), without building the string.
pub struct SeedHash {
    h: u32,
    first: bool,
}
impl SeedHash {
    pub fn new() -> Self {
        SeedHash { h: 0x811c_9dc5, first: true }
    }
    #[inline(always)]
    fn byte(&mut self, b: u8) {
        self.h = (self.h ^ b as u32).wrapping_mul(0x0100_0193);
    }
    #[inline(always)]
    fn sep(&mut self) {
        if !self.first {
            self.byte(b'|');
        }
        self.first = false;
    }
    /// decimal digits of x (all hashed numbers fit u32; 32-bit division is ~3.5× cheaper than 64-bit on SBF)
    pub fn num(mut self, x: u64) -> Self {
        self.sep();
        debug_assert!(x <= u32::MAX as u64);
        let mut x = x as u32;
        let mut buf = [0u8; 10];
        let mut i = buf.len();
        loop {
            i -= 1;
            buf[i] = b'0' + (x % 10) as u8;
            x /= 10;
            if x == 0 {
                break;
            }
        }
        for &b in &buf[i..] {
            self.byte(b);
        }
        self
    }
    pub fn str(mut self, s: &[u8]) -> Self {
        self.sep();
        for &b in s {
            self.byte(b);
        }
        self
    }
    pub fn done(self) -> u32 {
        self.h
    }
}

#[inline(always)]
fn next_variants(v: u8) -> [u8; 2] {
    match v {
        0 => [1, 2],
        1 => [3, 4],
        2 => [5, 6],
        _ => [255, 255],
    }
}
#[inline(always)]
fn pick2(rng: &mut Rng, a: [u8; 2]) -> u8 {
    a[rng.int(2) as usize]
}
#[inline(always)]
fn offer_lv(o: &Offer) -> i64 {
    lv_of(o.v)
}

/// run.ts slotsFor
pub fn slots_for(day: i64, bonus: i64) -> i64 {
    core::cmp::min(MAX_SLOTS, core::cmp::min(6, 3 + (day - 1) / 3) + bonus)
}
/// run.ts damageFor: min(5, 1 + ceil(day / 3))
pub fn damage_for(day: i64) -> i64 {
    let d = core::cmp::max(1, day);
    core::cmp::min(LOSS_CAP, 1 + (d + LOSS_EVERY - 1) / LOSS_EVERY)
}
/// run.ts incomeFor: (base, streak bonus)
pub fn income_for(day: i64, streak: i64) -> (i64, i64) {
    let base = if day <= 1 { DAY1_GOLD } else { 5 + core::cmp::min(day / 2, 3) };
    let bonus = if streak >= 5 { 3 } else if streak >= 3 { 2 } else if streak >= 2 { 1 } else if streak <= -2 { 1 } else { 0 };
    (base, bonus)
}
pub fn price_of(o: &Offer) -> i64 {
    PRICES[(offer_lv(o) - 1) as usize] + if SKILLS[o.id as usize].hero != 255 { 1 } else { 0 }
}

/// links.ts rollBonus: one connect bonus, or None after 10 tries
fn roll_bonus(rng: &mut Rng, id: u8, hero: u8, existing: &[Bonus]) -> Option<Bonus> {
    for _ in 0..10 {
        let r = rng.next_u32();
        let e = if r < TH_DMG { BK_DMG } else if r < TH_SHIELD { BK_SHIELD } else if r < TH_HASTE { BK_HASTE } else if r < TH_POWER { BK_POWER } else { BK_TRIGGER };
        if e == BK_DMG && !CAN_HIT[id as usize] {
            continue;
        }
        let t = if rng.next_u32() < TH_TARGET_SKILL {
            // targetsFor(id, hero): shared skills + this hero's unique, except itself (SKILL_LIST order).
            // Precomputed per hero; removing `id` = skipping its position (same element as the filtered list).
            let list = &HERO_TARGETS[hero as usize];
            let len = HERO_TARGETS_LEN[hero as usize] as usize;
            match list[..len].iter().position(|&k| k == id) {
                Some(p) => {
                    let j = rng.int((len - 1) as u32) as usize;
                    list[if j >= p { j + 1 } else { j }]
                }
                None => list[rng.int(len as u32) as usize],
            }
        } else {
            ARCH_TARGET + rng.int(N_ARCHES) as u8
        };
        if !existing.iter().any(|b| b.t == t && b.e == e) {
            return Some(Bonus { t, e });
        }
    }
    None
}

/// links.ts rollBonuses: 1–2 bonuses for a new copy
fn roll_bonuses(rng: &mut Rng, id: u8, hero: u8, out: &mut [Bonus; MAX_BONUS]) -> u8 {
    let n = if rng.next_u32() < TH_TWO_BONUS { 2 } else { 1 };
    let mut nb = 0usize;
    for _ in 0..n {
        if let Some(b) = roll_bonus(rng, id, hero, &out[..nb]) {
            out[nb] = b;
            nb += 1;
        }
    }
    nb as u8
}

/// run.ts heroChoices: `HERO_CHOICES` heroes of different archetypes from the seed
pub fn hero_choices(seed: u32) -> [u8; HERO_CHOICES] {
    let mut rng = Rng::new(SeedHash::new().num(seed as u64).str(b"heroes").done());
    // archetypes in order of first appearance in HEROES
    let mut arches = [0u8; 8];
    let mut na = 0;
    for &a in HERO_ARCH.iter() {
        if !arches[..na].contains(&a) {
            arches[na] = a;
            na += 1;
        }
    }
    let mut out = [255u8; HERO_CHOICES];
    let mut no = 0;
    while no < HERO_CHOICES && na > 0 {
        let k = rng.int(na as u32) as usize;
        let arch = arches[k];
        for j in k..na - 1 {
            arches[j] = arches[j + 1];
        }
        na -= 1;
        let mut hs = [0u8; 8];
        let mut nh = 0;
        for (h, &a) in HERO_ARCH.iter().enumerate() {
            if a == arch {
                hs[nh] = h as u8;
                nh += 1;
            }
        }
        out[no] = hs[rng.int(nh as u32) as usize];
        no += 1;
    }
    out
}

/// Size of the flat state (also the account payload size for zero-copy storage).
pub const RUN_STATE_SIZE: usize = core::mem::size_of::<RunState>();
const _: () = assert!(RUN_STATE_SIZE == 164 && core::mem::align_of::<RunState>() == 4);
/// owned-skill bitmask in roll_shop needs every skill index < 32
const _: () = assert!(SKILLS.len() <= 32);

impl RunState {
    /// raw bytes (repr(C), integer fields, no implicit padding)
    pub fn to_bytes(&self) -> [u8; RUN_STATE_SIZE] {
        unsafe { core::mem::transmute_copy(self) }
    }
    /// any byte pattern is a valid RunState (integers only)
    pub fn from_bytes(b: &[u8; RUN_STATE_SIZE]) -> RunState {
        unsafe { core::ptr::read_unaligned(b.as_ptr() as *const RunState) }
    }

    #[inline(always)]
    fn skills(&self) -> &[SkillInst] {
        &self.skills[..self.n as usize]
    }
    pub fn slots(&self) -> i64 {
        slots_for(self.day as i64, self.bonus_slots as i64)
    }
    fn owns(&self, id: u8) -> Option<usize> {
        self.skills().iter().position(|k| k.id == id)
    }

    /// run.ts newRun
    pub fn new(hero: u8, seed: u32) -> RunState {
        let mut s = RunState { seed, hero, day: 1, hp: START_HP as i16, ..Default::default() };
        s.begin_day();
        s
    }

    fn begin_day(&mut self) {
        let (base, bonus) = income_for(self.day as i64, self.streak as i64);
        self.last_base = base as u8;
        self.last_bonus = bonus as u8;
        self.gold += (base + bonus) as u16;
        self.rolls = 0;
        self.wishes = 0;
        self.roll_shop();
        self.phase = PHASE_SHOP;
    }

    /// run.ts upgradeOf: index of the owned skill this upgrade offer still applies to
    fn upgrade_of(&self, o: &Offer) -> Option<usize> {
        if o.v == 0 {
            return None;
        }
        let i = self.owns(o.id)?;
        if next_variants(self.skills[i].v).contains(&o.v) { Some(i) } else { None }
    }
    fn offer_still_valid(&self, o: &Offer) -> bool {
        if o.v == 0 { self.owns(o.id).is_none() } else { self.upgrade_of(o).is_some() }
    }

    /// run.ts rollShop
    fn roll_shop(&mut self) {
        if self.day <= 1 {
            let mut brng = Rng::new(SeedHash::new().num(self.seed as u64).str(b"day1").done());
            for i in 0..SHOP_SIZE {
                let id = HERO_DAY1[self.hero as usize][i];
                let mut o = Offer { present: 1, id, v: 0, nb: 0, bonus: [Bonus::default(); MAX_BONUS] };
                o.nb = roll_bonuses(&mut brng, id, self.hero, &mut o.bonus);
                self.shop[i] = o;
            }
            self.locks = [0; SHOP_SIZE];
            return;
        }
        // locked offers that still apply stay in their place; the other places are rolled fresh
        let mut kept = [Offer::default(); SHOP_SIZE];
        let mut nkept = 0;
        for i in 0..SHOP_SIZE {
            let o = self.shop[i];
            if self.locks[i] != 0 && o.present != 0 && self.offer_still_valid(&o) {
                kept[i] = o;
                nkept += 1;
            }
        }
        let kept_has = |id: u8, kept: &[Offer; SHOP_SIZE]| kept.iter().any(|o| o.present != 0 && o.id == id);
        let mut rng = Rng::new(SeedHash::new().num(self.seed as u64).num(self.day as u64).num(self.rolls as u64).done());
        // owned + kept skills as one bitmask (instead of scanning the build per candidate)
        let mut taken: u32 = 0;
        for k in self.skills() {
            taken |= 1 << k.id;
        }
        for o in kept.iter() {
            if o.present != 0 {
                taken |= 1 << o.id;
            }
        }
        let mut fresh = [0u8; SKILLS.len()];
        let mut nf = 0;
        for (k, d) in SKILLS.iter().enumerate() {
            let id = k as u8;
            if (d.hero == 255 || d.hero == self.hero) && taken & (1 << id) == 0 {
                fresh[nf] = id;
                nf += 1;
            }
        }
        let mut ups = [0u8; MAX_SKILLS];
        let mut nu = 0;
        for k in self.skills() {
            if lv_of(k.v) < MAX_LV && !kept_has(k.id, &kept) {
                ups[nu] = k.id;
                nu += 1;
            }
        }
        let mut picks = [Offer::default(); SHOP_SIZE];
        let mut np = 0;
        let need = SHOP_SIZE - nkept;
        while np < need && (nf > 0 || nu > 0) {
            let take_up = nu > 0 && (nf == 0 || rng.next_u32() < TH_UPGRADE);
            if take_up {
                let j = rng.int(nu as u32) as usize;
                let id = ups[j];
                for q in j..nu - 1 {
                    ups[q] = ups[q + 1];
                }
                nu -= 1;
                let kv = self.skills[self.owns(id).unwrap()].v;
                picks[np] = Offer { present: 1, id, v: pick2(&mut rng, next_variants(kv)), nb: 0, bonus: [Bonus::default(); MAX_BONUS] };
            } else {
                let j = rng.int(nf as u32) as usize;
                let id = fresh[j];
                for q in j..nf - 1 {
                    fresh[q] = fresh[q + 1];
                }
                nf -= 1;
                let mut o = Offer { present: 1, id, v: 0, nb: 0, bonus: [Bonus::default(); MAX_BONUS] };
                o.nb = roll_bonuses(&mut rng, id, self.hero, &mut o.bonus);
                picks[np] = o;
            }
            np += 1;
        }
        if nkept == 0 {
            self.shop = [Offer::default(); SHOP_SIZE];
            self.shop[..np].copy_from_slice(&picks[..np]);
            self.locks = [0; SHOP_SIZE];
            return;
        }
        let mut next = 0;
        for i in 0..SHOP_SIZE {
            if kept[i].present != 0 {
                self.shop[i] = kept[i];
                self.locks[i] = 1;
            } else {
                self.locks[i] = 0;
                self.shop[i] = if next < np { next += 1; picks[next - 1] } else { Offer::default() };
            }
        }
    }

    /// run.ts toggleLock
    pub fn toggle_lock(&mut self, i: usize) -> bool {
        if i >= SHOP_SIZE || self.shop[i].present == 0 {
            return false;
        }
        self.locks[i] ^= 1;
        true
    }

    /// run.ts buySlot
    pub fn buy_slot(&mut self) -> bool {
        if self.slots() >= MAX_SLOTS {
            return false;
        }
        let price = 4 + 2 * self.slot_buys as i64;
        if (self.gold as i64) < price {
            return false;
        }
        self.gold -= price as u16;
        self.bonus_slots += 1;
        self.slot_buys += 1;
        true
    }

    /// run.ts wish (พรจันทร์)
    pub fn wish(&mut self) -> bool {
        let up = self.skills().iter().any(|k| lv_of(k.v) < MAX_LV);
        let mark = !up && self.skills().iter().any(|k| k.mark == 0);
        if !up && !mark {
            return false;
        }
        let price = WISH_BASE + 2 * self.wishes as i64;
        if (self.gold as i64) < price {
            return false;
        }
        let mut rng = Rng::new(SeedHash::new().num(self.seed as u64).str(b"wish").num(self.day as u64).num(self.wishes as u64).done());
        let mut pool = [0u8; MAX_SKILLS];
        let mut np = 0;
        for (i, k) in self.skills().iter().enumerate() {
            if if up { lv_of(k.v) < MAX_LV } else { k.mark == 0 } {
                pool[np] = i as u8;
                np += 1;
            }
        }
        let i = pool[rng.int(np as u32) as usize] as usize;
        self.gold -= price as u16;
        self.wishes += 1;
        if up {
            self.skills[i].v = pick2(&mut rng, next_variants(self.skills[i].v));
        } else {
            self.skills[i].mark = rng.int(N_MARKS) as u8 + 1;
        }
        true
    }

    /// run.ts reroll
    pub fn reroll(&mut self) -> bool {
        if self.day <= 1 || (self.gold as i64) < REROLL {
            return false;
        }
        self.gold -= REROLL as u16;
        self.rolls += 1;
        self.roll_shop();
        true
    }

    /// run.ts buy: a new skill needs a free slot; an upgrade replaces the owned skill's variant
    pub fn buy(&mut self, i: usize) -> bool {
        if i >= SHOP_SIZE || self.shop[i].present == 0 {
            return false;
        }
        let o = self.shop[i];
        let price = price_of(&o);
        if (self.gold as i64) < price {
            return false;
        }
        if o.v == 0 {
            if self.owns(o.id).is_some() || self.n as i64 >= self.slots() {
                return false;
            }
            let n = self.n as usize;
            self.skills[n] = SkillInst { id: o.id, v: 0, mark: 0, nb: o.nb, bonus: o.bonus };
            self.n += 1;
        } else {
            match self.upgrade_of(&o) {
                Some(k) => self.skills[k].v = o.v,
                None => return false,
            }
        }
        self.gold -= price as u16;
        self.shop[i] = Offer::default();
        self.locks[i] = 0;
        true
    }

    /// run.ts sell (no-op without a skill there)
    pub fn sell(&mut self, i: usize) {
        if i >= self.n as usize {
            return;
        }
        self.gold += lv_of(self.skills[i].v) as u16;
        let n = self.n as usize;
        for k in i..n - 1 {
            self.skills[k] = self.skills[k + 1];
        }
        self.skills[n - 1] = SkillInst::default();
        self.n -= 1;
    }

    /// run.ts moveSkill: dir -1 up, +1 down (no-op at the ends)
    pub fn move_skill(&mut self, i: i64, dir: i64) {
        let j = i + dir;
        let n = self.n as i64;
        if i < 0 || j < 0 || i >= n || j >= n {
            return;
        }
        self.skills.swap(i as usize, j as usize);
    }

    /// run.ts toBuild: the skills that fit today's slots
    pub fn to_build(&self) -> Build {
        let n = core::cmp::min(self.n as i64, self.slots()) as usize;
        let mut b = Build { hero: self.hero, n: n as u8, ..Default::default() };
        b.skills[..n].copy_from_slice(&self.skills[..n]);
        b
    }

    /// run.ts recordResult
    pub fn record_result(&mut self, won: bool) {
        if won {
            self.wins += 1;
            self.streak = if self.streak > 0 { self.streak + 1 } else { 1 };
        } else {
            self.losses += 1;
            self.hp -= damage_for(self.day as i64) as i16;
            self.streak = if self.streak < 0 { self.streak - 1 } else { -1 };
        }
        if self.wins as i64 >= WIN_TARGET {
            self.phase = PHASE_WON;
            return;
        }
        if self.hp <= 0 {
            if self.ghost == 0 {
                self.ghost = 1;
                self.hp = 1;
                self.phase = PHASE_LASTCHANCE;
                return;
            }
            self.phase = PHASE_DEAD;
            return;
        }
        self.day += 1;
        self.begin_day();
    }

    /// fight today's opponent and record the result (the run.ts caller: simulate(toBuild(s), opp, seed, day))
    pub fn fight(&mut self, opp: &Build, seed: u32) -> Outcome {
        let o = simulate(&self.to_build(), opp, seed, self.day as usize, &mut NoProbe);
        self.record_result(o.winner == 0);
        o
    }

    /// run.ts chooseLastChance
    pub fn choose_last_chance(&mut self, opt: u8) {
        if self.phase != PHASE_LASTCHANCE {
            return;
        }
        match opt {
            LC_AWAKEN => {
                let mut rng = Rng::new(SeedHash::new().num(self.seed as u64).str(b"awaken").num(self.day as u64).done());
                let n = self.n as usize;
                for k in self.skills[..n].iter_mut() {
                    if k.v == 0 {
                        k.v = pick2(&mut rng, next_variants(0));
                    }
                }
            }
            LC_SUPPLY => {
                self.gold += 8;
                self.bonus_slots += 1;
            }
            LC_MARK => {
                let mut rng = Rng::new(SeedHash::new().num(self.seed as u64).str(b"mark").num(self.day as u64).done());
                self.pending_mark = rng.int(N_MARKS) as u8 + 1;
                self.phase = PHASE_MARK;
                return;
            }
            _ => {}
        }
        self.day += 1;
        self.begin_day();
    }

    /// run.ts concede
    pub fn concede(&mut self) {
        if self.phase == PHASE_WON || self.phase == PHASE_DEAD {
            return;
        }
        self.conceded = 1;
        self.phase = PHASE_DEAD;
    }

    /// run.ts applyMark (idx out of range = skip placing it)
    pub fn apply_mark(&mut self, idx: i64) {
        if self.phase != PHASE_MARK || self.pending_mark == 0 {
            return;
        }
        if idx >= 0 && idx < self.n as i64 {
            self.skills[idx as usize].mark = self.pending_mark;
        }
        self.pending_mark = 0;
        self.day += 1;
        self.begin_day();
    }
}
