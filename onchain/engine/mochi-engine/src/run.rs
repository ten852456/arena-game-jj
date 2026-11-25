//! One run (รอบ), sim v22 / run v13: a rule-for-rule port of arena-game-jj/src/sim/run.ts + the connect-bonus roll
//! of links.ts + the relic offer of relics.ts. Same order of RNG calls, same accept/reject behaviour (the TS functions
//! are the reference; phase guards that only the UI enforces in TS belong to the on-chain program, not here).
//!
//! `secret`: the on-chain run's hidden seed (VRF, kept by the program where the player can't read it; TS
//! `RunState.secret`). EVERY run roll comes from it (shop, rerolls, card bonuses, star cards, wishes, awaken, relic
//! offers, mark kinds); `seed` is then only the cosmetic look. `None` = an offline run (TS without secret).
//! The kind of the last chance's mark is rolled when the mark is placed (`pending_mark == PENDING_SECRET` until then).
//!
//! `RunState` is `#[repr(C)]` with integer fields only, so any byte pattern is a valid value: the program can use
//! account bytes directly (zero-copy) instead of (de)serialising it on every action.
use crate::combat::{simulate, NoProbe, Outcome};
use crate::data::*;
use crate::rng::Rng;
use crate::types::*;

pub const PHASE_SHOP: u8 = 0;
pub const PHASE_RELIC: u8 = 1;
pub const PHASE_LASTCHANCE: u8 = 2;
pub const PHASE_MARK: u8 = 3;
pub const PHASE_WON: u8 = 4;
pub const PHASE_DEAD: u8 = 5;
pub const LC_AWAKEN: u8 = 0;
pub const LC_MARK: u8 = 1;
pub const LC_SUPPLY: u8 = 2;
/// pending last-chance mark whose kind comes from the secret seed when it is placed
pub const PENDING_SECRET: u8 = 255;

/// A shop offer. `present == 0`: empty place (bought, or the shop rolled fewer than 5).
#[repr(C)]
#[derive(Clone, Copy, Default, Debug, PartialEq, Eq)]
pub struct Offer {
    pub present: u8,
    pub id: u8,
    /// 0 = new Lv1 skill; an upgrade carries the first of the two next branches (the buyer picks either)
    pub v: u8,
    /// a star card: the star the owned Lv3 skill gets (1–3)
    pub star: u8,
    pub nb: u8,
    pub bonus: [Bonus; MAX_BONUS],
}

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
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
    /// 0 = none, 1..=4 = MARKS index + 1, PENDING_SECRET = kind rolled from the secret when placed
    pub pending_mark: u8,
    pub phase: u8,
    pub conceded: u8,
    pub wishes: u8,
    pub wish_marks: u8,
    pub n: u8,
    pub locks: [u8; SHOP_SIZE],
    /// owned relics (RELIC_IDS index), NO_RELIC = empty
    pub relics: [u8; MAX_RELICS],
    /// today's relic offer, NO_RELIC = empty
    pub relic_offer: [u8; RELIC_OFFER],
    /// relic days already offered (bit i = RELIC_DAYS[i])
    pub relic_days: u8,
    pub relic_rolls: u8,
    /// explicit padding: no implicit padding bytes anywhere, so the raw bytes are fully defined
    pub _pad: [u8; 2],
    pub skills: [SkillInst; MAX_SKILLS],
    pub shop: [Offer; SHOP_SIZE],
}

impl Default for RunState {
    fn default() -> Self {
        RunState {
            seed: 0, hp: 0, gold: 0, rolls: 0, hero: 0, day: 0, wins: 0, losses: 0, streak: 0, last_base: 0, last_bonus: 0,
            bonus_slots: 0, slot_buys: 0, ghost: 0, pending_mark: 0, phase: 0, conceded: 0, wishes: 0, wish_marks: 0, n: 0,
            locks: [0; SHOP_SIZE], relics: [NO_RELIC; MAX_RELICS], relic_offer: [NO_RELIC; RELIC_OFFER], relic_days: 0,
            relic_rolls: 0, _pad: [0; 2], skills: [SkillInst::default(); MAX_SKILLS], shop: [Offer::default(); SHOP_SIZE],
        }
    }
}

/// rng.ts hashSeed: FNV-1a over the parts joined with '|' (numbers in decimal), without building the string.
pub struct SeedHash {
    h: u32,
    first: bool,
}
impl Default for SeedHash {
    fn default() -> Self {
        Self::new()
    }
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

/// run.ts mix32
pub fn mix32(mut x: u32) -> u32 {
    x ^= x >> 16;
    x = x.wrapping_mul(0x7feb_352d);
    x ^= x >> 15;
    x = x.wrapping_mul(0x846c_a68b);
    x ^= x >> 16;
    x
}
/// run.ts markKindFor(seed, idx): mark 1..=4 (MARKS index + 1); idx None = 'last'
pub fn mark_kind_for(seed: u32, idx: Option<u32>) -> u8 {
    let h = SeedHash::new().num(seed as u64).str(b"markkind");
    let h = match idx {
        Some(i) => h.num(i as u64),
        None => h.str(b"last"),
    };
    (mix32(h.done()) % N_MARKS) as u8 + 1
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
fn min(a: i64, b: i64) -> i64 {
    if a < b { a } else { b }
}
fn remove_at(a: &mut [u8], len: &mut usize, j: usize) -> u8 {
    let x = a[j];
    for q in j..*len - 1 {
        a[q] = a[q + 1];
    }
    *len -= 1;
    x
}

/// run.ts slotsFor
pub fn slots_for(day: i64, bonus: i64) -> i64 {
    min(MAX_SLOTS, min(6, 3 + (day - 1) / 3) + bonus)
}
/// run.ts damageFor
pub fn damage_for(day: i64) -> i64 {
    let d = if day < 1 { 1 } else { day };
    min(LOSS_CAP, 1 + (d + LOSS_EVERY - 1) / LOSS_EVERY)
}
/// run.ts incomeFor: (base, streak bonus)
pub fn income_for(day: i64, streak: i64, hero: u8) -> (i64, i64) {
    let base = (if day <= 1 { DAY1_GOLD } else { 5 + min(day / 2, 3) }) + if hero == H_LUCKYCAT && day >= 2 { LUCKYCAT_INCOME } else { 0 };
    let bonus = if streak >= 5 { 3 } else if streak >= 3 { 2 } else if streak >= 2 { 1 } else if streak <= -2 { 1 } else { 0 };
    (base, bonus)
}
/// run.ts canUpgrade
#[inline(always)]
fn can_upgrade(v: u8, day: i64) -> bool {
    lv_of(v) < MAX_LV && (lv_of(v) < 2 || day >= LV3_DAY)
}
/// run.ts canStar
#[inline(always)]
fn can_star(k: &SkillInst, day: i64) -> bool {
    lv_of(k.v) >= MAX_LV && (k.star as i64) < STAR_MAX && day >= STAR_DAY
}
pub fn price_of(o: &Offer) -> i64 {
    if o.star > 0 { STAR_PRICES[o.star as usize - 1] } else { PRICES[(lv_of(o.v) - 1) as usize] + if SKILLS[o.id as usize].hero != 255 { 1 } else { 0 } }
}
/// heroes.ts inLine
#[inline(always)]
fn in_line(hero: u8, id: u8) -> bool {
    let d = &SKILLS[id as usize];
    d.line == HERO_LINE[hero as usize] && d.line != LINE_NONE && (d.hero == 255 || d.hero == hero)
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
            // targetsFor(id, hero): shared skills + this hero's unique, except itself (SKILL_LIST order)
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
            LINE_TARGET + rng.int(N_LINES) as u8
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

/// run.ts heroChoices: HERO_CHOICES different heroes from the seed
pub fn hero_choices(seed: u32) -> [u8; HERO_CHOICES] {
    let mut rng = Rng::new(SeedHash::new().num(seed as u64).str(b"heroes").done());
    let mut pool = [0u8; 16];
    let mut np = N_HEROES as usize;
    for (i, x) in pool[..np].iter_mut().enumerate() {
        *x = i as u8;
    }
    let mut out = [255u8; HERO_CHOICES];
    for o in out.iter_mut() {
        if np == 0 {
            break;
        }
        let j = rng.int(np as u32) as usize;
        *o = remove_at(&mut pool, &mut np, j);
    }
    out
}

/// relics.ts relicFitsBuild: does relic r fit what the build's skills do?
fn relic_fits_build(r: u8, skills: &[SkillInst]) -> bool {
    if r == RL_SIGIL {
        return skills.iter().filter(|k| k.mark != MARK_NONE).count() >= 2;
    }
    if r == RL_LONEWOLF {
        return false;
    }
    let need = RELIC_NEED[r as usize];
    if need == 0 {
        return false;
    }
    skills.iter().filter(|k| SKILL_TAGS[k.id as usize][k.v as usize] & need != 0).count() >= 2
}
#[inline(always)]
fn relic_fits_line(r: u8, line: u8) -> bool {
    RELIC_LINES[r as usize] & (1 << line) != 0
}
/// relics.ts rollRelicOffer(seed, hero, day, owned, skills, roll) → offer (NO_RELIC padded), count
pub fn roll_relic_offer(seed: u32, hero: u8, day: i64, owned: &[u8], skills: &[SkillInst], roll: i64) -> ([u8; RELIC_OFFER], usize) {
    let (first, nfirst) = if roll > 0 { roll_relic_offer(seed, hero, day, owned, skills, roll - 1) } else { ([NO_RELIC; RELIC_OFFER], 0) };
    let h = SeedHash::new().num(seed as u64).str(b"relic").num(day as u64);
    let mut rng = Rng::new(if roll > 0 { h.str(b"re").num(roll as u64).done() } else { h.done() });
    let line = HERO_LINE[hero as usize];
    let fits = |r: u8| if !skills.is_empty() { relic_fits_build(r, skills) } else { relic_fits_line(r, line) };
    let mut pool = [0u8; 32];
    let mut np = 0;
    for r in 0..RELIC_IDS.len() as u8 {
        if !owned.contains(&r) && !first[..nfirst].contains(&r) && (r != RL_LONEWOLF || day >= LONEWOLF_DAY) {
            pool[np] = r;
            np += 1;
        }
    }
    let mut out = [NO_RELIC; RELIC_OFFER];
    let mut no = 0;
    let mut mine = [0u8; 32];
    let mut nm = 0;
    for &r in &pool[..np] {
        if fits(r) {
            mine[nm] = r;
            nm += 1;
        }
    }
    if nm > 0 {
        out[0] = mine[rng.int(nm as u32) as usize];
        no = 1;
    }
    let mut rest = [0u8; 32];
    let mut nr = 0;
    for &r in &pool[..np] {
        if !out[..no].contains(&r) {
            rest[nr] = r;
            nr += 1;
        }
    }
    while no < RELIC_OFFER && nr > 0 {
        // weighted pick: x = next() × W; first i with x − (w0 + … + wi) < 0, exact as x·2^32 = u × W
        let mut total = 0u64;
        for &r in &rest[..nr] {
            total += if relic_fits_line(r, line) { RELIC_LINE_W } else { RELIC_OTHER_W };
        }
        let xv = rng.next_u32() as u64 * total;
        let mut i = 0;
        let mut cum = 0u64;
        while i < nr - 1 {
            cum += if relic_fits_line(rest[i], line) { RELIC_LINE_W } else { RELIC_OTHER_W };
            if xv < cum << 32 {
                break;
            }
            i += 1;
        }
        out[no] = remove_at(&mut rest, &mut nr, i);
        no += 1;
    }
    (out, no)
}

/// Size of the flat state (also the account payload size for zero-copy storage).
pub const RUN_STATE_SIZE: usize = core::mem::size_of::<RunState>();
// 10 B of u32/u16 + 16 u8 fields + locks + relics + offer + relic days/rolls + 2 pad, then 8 skills and 5 offers of 11 B
const _: () = assert!(core::mem::align_of::<RunState>() == 4 && RUN_STATE_SIZE == 10 + 16 + SHOP_SIZE + MAX_RELICS + RELIC_OFFER + 2 + 2 + 11 * MAX_SKILLS + 11 * SHOP_SIZE && RUN_STATE_SIZE == 184);
/// owned-skill bitmask in roll_shop needs every skill index < 64
const _: () = assert!(SKILLS.len() <= 64);

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
    fn n_relics(&self) -> usize {
        self.relics.iter().filter(|&&r| r != NO_RELIC).count()
    }
    /// run.ts rollSeed: every run roll comes from the secret on chain, else from the public run seed
    #[inline(always)]
    fn roll_seed(&self, secret: Option<u32>) -> u32 {
        secret.unwrap_or(self.seed)
    }
    /// run.ts bonusOf: the connect bonuses of a skill's card in this run
    fn bonus_of(&self, id: u8, rs: u32, out: &mut [Bonus; MAX_BONUS]) -> u8 {
        let mut rng = Rng::new(SeedHash::new().num(rs as u64).str(b"bonus").str(SKILL_IDS[id as usize].as_bytes()).done());
        roll_bonuses(&mut rng, id, self.hero, out)
    }
    fn new_offer(&self, id: u8, rs: u32) -> Offer {
        let mut o = Offer { present: 1, id, ..Default::default() };
        o.nb = self.bonus_of(id, rs, &mut o.bonus);
        o
    }
    /// run.ts upOffer: an upgrade card for owned skill k (its first next branch), or its next star
    fn up_offer(k: &SkillInst) -> Offer {
        if lv_of(k.v) >= MAX_LV {
            Offer { present: 1, id: k.id, v: k.v, star: k.star + 1, ..Default::default() }
        } else {
            Offer { present: 1, id: k.id, v: next_variants(k.v)[0], ..Default::default() }
        }
    }

    /// run.ts newRun
    pub fn new(hero: u8, seed: u32, secret: Option<u32>) -> RunState {
        let mut s = RunState { seed, hero, day: 1, hp: START_HP as i16, ..Default::default() };
        s.begin_day(secret);
        s
    }

    fn begin_day(&mut self, secret: Option<u32>) {
        let (base, bonus) = income_for(self.day as i64, self.streak as i64, self.hero);
        self.last_base = base as u8;
        self.last_bonus = bonus as u8;
        self.gold += (base + bonus) as u16;
        self.rolls = 0;
        self.wishes = 0;
        self.roll_shop(secret);
        self.phase = PHASE_SHOP;
        // relic days: pick 1 of 3 relics (or skip) before the shop opens
        if let Some(di) = RELIC_DAYS.iter().position(|&d| d == self.day as i64) {
            if self.relic_days & (1 << di) == 0 && self.n_relics() < MAX_RELICS {
                self.relic_days |= 1 << di;
                let owned = self.relics;
                let n = min(self.n as i64, self.slots()) as usize;
                let (offer, no) = roll_relic_offer(self.roll_seed(secret), self.hero, self.day as i64, &owned[..self.n_relics()], &self.skills[..n], 0);
                self.relic_offer = offer;
                self.relic_rolls = 0;
                if no > 0 {
                    self.phase = PHASE_RELIC;
                }
            }
        }
    }

    /// run.ts rerollRelic
    pub fn reroll_relic(&mut self, secret: Option<u32>) -> bool {
        if self.phase != PHASE_RELIC || (self.relic_rolls as i64) >= RELIC_REROLLS {
            return false;
        }
        let r = self.relic_rolls as i64 + 1;
        let owned = self.relics;
        let n = min(self.n as i64, self.slots()) as usize;
        let (offer, no) = roll_relic_offer(self.roll_seed(secret), self.hero, self.day as i64, &owned[..self.n_relics()], &self.skills[..n], r);
        if no == 0 {
            return false;
        }
        self.relic_rolls = r as u8;
        self.relic_offer = offer;
        true
    }

    /// run.ts pickRelic (i < 0 = skip)
    pub fn pick_relic(&mut self, i: i64) -> bool {
        if self.phase != PHASE_RELIC {
            return false;
        }
        if i >= 0 {
            if i as usize >= RELIC_OFFER || self.relic_offer[i as usize] == NO_RELIC {
                return false;
            }
            let k = self.n_relics();
            self.relics[k] = self.relic_offer[i as usize];
        }
        self.relic_offer = [NO_RELIC; RELIC_OFFER];
        self.phase = PHASE_SHOP;
        true
    }

    /// run.ts upgradeOf: index of the owned skill this upgrade (or star) offer still applies to
    fn upgrade_of(&self, o: &Offer) -> Option<usize> {
        if o.v == 0 {
            return None;
        }
        let i = self.owns(o.id)?;
        let k = &self.skills[i];
        if o.star > 0 {
            return if k.v == o.v && k.star + 1 == o.star { Some(i) } else { None };
        }
        if next_variants(k.v).contains(&o.v) { Some(i) } else { None }
    }
    fn offer_still_valid(&self, o: &Offer) -> bool {
        if o.v == 0 { self.owns(o.id).is_none() } else { self.upgrade_of(o).is_some() }
    }

    /// run.ts rollShop
    fn roll_shop(&mut self, secret: Option<u32>) {
        let rs = self.roll_seed(secret);
        let day = self.day as i64;
        if day <= 1 {
            for i in 0..SHOP_SIZE {
                self.shop[i] = self.new_offer(HERO_DAY1[self.hero as usize][i], rs);
            }
            self.locks = [0; SHOP_SIZE];
            return;
        }
        let mut kept = [Offer::default(); SHOP_SIZE];
        let mut kept_ids: u64 = 0;
        for i in 0..SHOP_SIZE {
            let o = self.shop[i];
            if self.locks[i] != 0 && o.present != 0 && self.offer_still_valid(&o) {
                kept[i] = o;
                kept_ids |= 1 << o.id;
            }
        }
        let nkept = kept_ids.count_ones() as usize;
        let mut rng = Rng::new(SeedHash::new().num(rs as u64).num(day as u64).num(self.rolls as u64).done());
        let mut owned: u64 = 0;
        for k in self.skills() {
            owned |= 1 << k.id;
        }
        let mut fresh = [0u8; 64];
        let mut nf = 0;
        for (k, d) in SKILLS.iter().enumerate() {
            if (d.hero == 255 || d.hero == self.hero) && owned & (1 << k) == 0 && kept_ids & (1 << k) == 0 {
                fresh[nf] = k as u8;
                nf += 1;
            }
        }
        let mut ups = [0u8; MAX_SKILLS];
        let mut nu = 0;
        let mut star_ids = [0u8; MAX_SKILLS];
        let mut ns = 0;
        for k in self.skills() {
            if can_upgrade(k.v, day) && kept_ids & (1 << k.id) == 0 {
                ups[nu] = k.id;
                nu += 1;
            }
            if can_star(k, day) && kept_ids & (1 << k.id) == 0 {
                star_ids[ns] = k.id;
                ns += 1;
            }
        }
        let late = day >= LATE_DAY;
        let mut stars: i64 = 0;
        if ns > 0 {
            let th = if late { TH_STARS_LATE } else if nu > 0 { TH_STARS_UPS } else { TH_STARS };
            if rng.next_u32() < th {
                stars = STAR_PER_ROLL + late as i64;
            }
        }
        let mut picks = [Offer::default(); SHOP_SIZE];
        let mut np = 0;
        let need = SHOP_SIZE - nkept;
        let line = HERO_LINE[self.hero as usize];
        let uniq = HERO_UNIQUE[self.hero as usize];
        if day >= UNIQUE_BACK_DAY && need > 0 {
            if let Some(j) = fresh[..nf].iter().position(|&x| x == uniq) {
                remove_at(&mut fresh, &mut nf, j);
                picks[np] = self.new_offer(uniq, rs);
                np += 1;
            }
        }
        let line_new = |o: &Offer| o.present != 0 && o.v == 0 && SKILLS[o.id as usize].line == line;
        if np < need && !picks[..np].iter().any(line_new) && !kept.iter().any(line_new) {
            let mut ids = [0u8; 64];
            let mut ni = 0;
            for &x in &fresh[..nf] {
                if SKILLS[x as usize].line == line {
                    ids[ni] = x;
                    ni += 1;
                }
            }
            if ni > 0 {
                let id = ids[rng.int(ni as u32) as usize];
                let j = fresh[..nf].iter().position(|&x| x == id).unwrap();
                remove_at(&mut fresh, &mut nf, j);
                picks[np] = self.new_offer(id, rs);
                np += 1;
            }
        }
        let hero = self.hero;
        let line_up = |o: &Offer| o.present != 0 && o.v != 0 && in_line(hero, o.id);
        let pieces = self.skills().iter().filter(|k| in_line(hero, k.id)).count();
        if np < need && pieces >= ULT_PIECES_2 && !picks[..np].iter().any(line_up) && !kept.iter().any(line_up) {
            let mut ids = [0u8; MAX_SKILLS];
            let mut ni = 0;
            for &x in &ups[..nu] {
                if in_line(hero, x) {
                    ids[ni] = x;
                    ni += 1;
                }
            }
            if ni > 0 {
                let id = ids[rng.int(ni as u32) as usize];
                let j = ups[..nu].iter().position(|&x| x == id).unwrap();
                remove_at(&mut ups, &mut nu, j);
                picks[np] = Self::up_offer(&self.skills[self.owns(id).unwrap()]);
                np += 1;
            }
        }
        while np < need && (nf > 0 || nu > 0 || (stars > 0 && ns > 0)) {
            if stars > 0 && ns > 0 && (rng.next_u32() < TH_STAR_PICK || (nf == 0 && nu == 0)) {
                let j = rng.int(ns as u32) as usize;
                let id = remove_at(&mut star_ids, &mut ns, j);
                picks[np] = Self::up_offer(&self.skills[self.owns(id).unwrap()]);
                np += 1;
                stars -= 1;
                continue;
            }
            let take_up = nu > 0 && (nf == 0 || rng.next_u32() < if late { TH_UP_LATE } else { TH_UP });
            if !take_up && nf == 0 {
                break;
            }
            if take_up {
                let j = rng.int(nu as u32) as usize;
                let id = remove_at(&mut ups, &mut nu, j);
                picks[np] = Self::up_offer(&self.skills[self.owns(id).unwrap()]);
            } else {
                // weighted pick: the hero's own line counts LINE_WEIGHT times (exact: x·2^32 = u × W)
                let mut total = 0u64;
                for &x in &fresh[..nf] {
                    total += if SKILLS[x as usize].line == line { LINE_WEIGHT } else { 1 };
                }
                let xv = rng.next_u32() as u64 * total;
                let mut i = 0;
                let mut cum = 0u64;
                while i < nf - 1 {
                    cum += if SKILLS[fresh[i] as usize].line == line { LINE_WEIGHT } else { 1 };
                    if xv < cum << 32 {
                        break;
                    }
                    i += 1;
                }
                let id = remove_at(&mut fresh, &mut nf, i);
                picks[np] = self.new_offer(id, rs);
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
                self.shop[i] = if next < np {
                    next += 1;
                    picks[next - 1]
                } else {
                    Offer::default()
                };
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
        if self.slots() >= MAX_SLOTS || (self.n as i64) < self.slots() {
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

    /// run.ts wishKind: 1 = upgrade, 2 = mark, 0 = none
    fn wish_kind(&self) -> u8 {
        let day = self.day as i64;
        if self.skills().iter().any(|k| can_upgrade(k.v, day)) {
            return 1;
        }
        if self.n > 0 && self.skills().iter().all(|k| lv_of(k.v) >= MAX_LV) && self.skills().iter().any(|k| k.mark == MARK_NONE) && (self.wish_marks as i64) < WISH_MARKS_MAX {
            return 2;
        }
        0
    }
    /// run.ts wish (พรจันทร์)
    pub fn wish(&mut self, secret: Option<u32>) -> bool {
        let kind = self.wish_kind();
        if kind == 0 {
            return false;
        }
        let day = self.day as i64;
        let price = WISH_BASE + 2 * self.wishes as i64 + if kind == 2 { MARK_WISH_EXTRA } else { 0 };
        if (self.gold as i64) < price {
            return false;
        }
        let mut rng = Rng::new(SeedHash::new().num(self.roll_seed(secret) as u64).str(b"wish").num(day as u64).num(self.wishes as u64).done());
        let mut pool = [0u8; MAX_SKILLS];
        let mut np = 0;
        for (i, k) in self.skills().iter().enumerate() {
            if if kind == 1 { can_upgrade(k.v, day) } else { k.mark == MARK_NONE } {
                pool[np] = i as u8;
                np += 1;
            }
        }
        let i = pool[rng.int(np as u32) as usize] as usize;
        self.gold -= price as u16;
        self.wishes += 1;
        if kind == 1 {
            self.skills[i].v = pick2(&mut rng, next_variants(self.skills[i].v));
            // an upgrade card in the shop for this skill no longer fits: its next level, or dropped
            let k = self.skills[i];
            for j in 0..SHOP_SIZE {
                let o = self.shop[j];
                if o.present == 0 || o.id != k.id || o.v == 0 {
                    continue;
                }
                self.shop[j] = if can_upgrade(k.v, day) { Self::up_offer(&k) } else { Offer::default() };
                if self.shop[j].present == 0 {
                    self.locks[j] = 0;
                }
            }
            return true;
        }
        self.skills[i].mark = match secret {
            Some(sec) => mark_kind_for(sec, Some(self.wish_marks as u32)),
            None => rng.int(N_MARKS) as u8 + 1,
        };
        self.wish_marks += 1;
        true
    }

    /// run.ts reroll
    pub fn reroll(&mut self, secret: Option<u32>) -> bool {
        if self.day <= 1 || self.phase == PHASE_RELIC || (self.gold as i64) < REROLL {
            return false;
        }
        self.gold -= REROLL as u16;
        self.rolls += 1;
        self.roll_shop(secret);
        true
    }

    /// run.ts buy: pick = branch index (0/1) of an upgrade, None = the card's own branch
    pub fn buy(&mut self, i: usize, pick: Option<usize>) -> bool {
        if i >= SHOP_SIZE || self.shop[i].present == 0 || self.phase == PHASE_RELIC {
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
            self.skills[n] = SkillInst { id: o.id, v: 0, mark: 0, star: 0, nb: o.nb, bonus: o.bonus };
            self.n += 1;
        } else {
            let k = match self.upgrade_of(&o) {
                Some(k) => k,
                None => return false,
            };
            if o.star > 0 {
                self.skills[k].star = o.star;
            } else {
                let nv = next_variants(self.skills[k].v);
                let v = match pick {
                    None => o.v,
                    Some(p) if p < 2 => nv[p],
                    Some(_) => 255,
                };
                if !nv.contains(&v) || v == 255 {
                    return false;
                }
                self.skills[k].v = v;
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
        self.gold += (lv_of(self.skills[i].v) + self.skills[i].star as i64) as u16;
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

    /// run.ts toBuild: the skills that fit today's slots, and the run's relics
    pub fn to_build(&self) -> Build {
        let n = min(self.n as i64, self.slots()) as usize;
        let mut b = Build { hero: self.hero, n: n as u8, relics: self.relics, ..Default::default() };
        b.skills[..n].copy_from_slice(&self.skills[..n]);
        b
    }

    /// run.ts recordResult (draw: no win, no HP lost, streak reset)
    pub fn record_result(&mut self, won: bool, draw: bool, secret: Option<u32>) {
        if won {
            self.wins += 1;
            self.streak = if self.streak > 0 { self.streak + 1 } else { 1 };
        } else {
            self.losses += 1;
            if draw {
                self.streak = 0;
            } else {
                self.hp = core::cmp::max(0, self.hp as i64 - damage_for(self.day as i64)) as i16;
                self.streak = if self.streak < 0 { self.streak - 1 } else { -1 };
            }
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
        self.begin_day(secret);
    }

    /// fight today's opponent and record the result (run.ts caller: simulate(toBuild(s), opp, seed, day))
    pub fn fight(&mut self, opp: &Build, seed: u32, secret: Option<u32>) -> Outcome {
        let o = simulate(&self.to_build(), opp, seed, self.day as usize, &mut NoProbe);
        self.record_result(o.winner == 0, o.winner == -1, secret);
        o
    }

    /// run.ts chooseLastChance (an unknown option just moves on to the next day)
    pub fn choose_last_chance(&mut self, opt: u8, secret: Option<u32>) {
        if self.phase != PHASE_LASTCHANCE {
            return;
        }
        match opt {
            LC_AWAKEN => {
                let mut rng = Rng::new(SeedHash::new().num(self.roll_seed(secret) as u64).str(b"awaken").num(self.day as u64).done());
                let n = self.n as usize;
                for k in self.skills[..n].iter_mut() {
                    if k.v == 0 {
                        k.v = pick2(&mut rng, next_variants(0));
                    }
                }
            }
            LC_SUPPLY => {
                if self.slots() >= MAX_SLOTS {
                    self.gold += SUPPLY_GOLD_FULL as u16;
                } else {
                    self.gold += 8;
                    self.bonus_slots += 1;
                }
            }
            LC_MARK => {
                self.pending_mark = if secret.is_some() {
                    PENDING_SECRET
                } else {
                    Rng::new(SeedHash::new().num(self.seed as u64).str(b"mark").num(self.day as u64).done()).int(N_MARKS) as u8 + 1
                };
                self.phase = PHASE_MARK;
                return;
            }
            _ => {}
        }
        self.day += 1;
        self.begin_day(secret);
    }

    /// run.ts concede
    pub fn concede(&mut self) {
        if self.phase == PHASE_WON || self.phase == PHASE_DEAD {
            return;
        }
        self.conceded = 1;
        self.phase = PHASE_DEAD;
    }

    /// run.ts applyMark (idx -1 = skip placing it; any other missing slot is refused)
    pub fn apply_mark(&mut self, idx: i64, secret: Option<u32>) -> bool {
        if self.phase != PHASE_MARK || self.pending_mark == 0 {
            return false;
        }
        if idx != -1 && (idx < 0 || idx >= self.n as i64) {
            return false;
        }
        if idx >= 0 {
            self.skills[idx as usize].mark = if self.pending_mark == PENDING_SECRET {
                mark_kind_for(secret.unwrap_or(self.seed), None)
            } else {
                self.pending_mark
            };
        }
        self.pending_mark = 0;
        self.day += 1;
        self.begin_day(secret);
        true
    }
}
