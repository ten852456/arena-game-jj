//! Ghost storage (requirement C1 = b: the final build plus the build of every day of the run).
//!
//! Measured on 9,895 real player runs (notes/engine/BENCH.md, stage 5): the build changes on 8 of 9 fought days,
//! so "store only changed days" alone saves little (767 → 700 B). What works is (1) packing a skill into 6 bytes
//! instead of 10 and (2) storing per day only the slots that changed:
//!   journal entry = [day u8][n u8][slot mask u8][6 B per changed slot]
//! Mean 140 B, p95 241, max 379 per ghost (theoretical worst ≈ 1,021 B). Reconstruction of any day is exact:
//! replay the entries up to that day.
//!
//! Per player, ghosts live in a ring arena of `ARENA` bytes (up to 5 ghosts, oldest evicted first). With 1,536 B
//! no window of 5 consecutive real ghosts failed to fit (0 / 9,891). If a set ever does not fit, older ghosts are
//! evicted early (fewer than 5 kept); every ghost that is kept stays exact.
use crate::data::MAX_BONUS;
use crate::types::{Bonus, Build, SkillInst, MAX_SKILLS};

pub const PACKED: usize = 6;
pub const MAX_GHOSTS: usize = 5;
pub const ARENA: usize = 1536;
/// worst-case journal: a day entry with every slot changed, for every day a run can last (MAX_DAY 20)
pub const JOURNAL_MAX: usize = 20 * (3 + PACKED * MAX_SKILLS) + 3 + PACKED * MAX_SKILLS;

/// id 5 bits · v 3 · mark 3 · nb 2 · 3 × (t 8 + e 3) = 46 bits → 6 bytes
pub fn pack(k: &SkillInst) -> [u8; PACKED] {
    debug_assert!(k.id < 32 && k.v < 8 && k.mark < 8 && k.nb < 4);
    let mut x: u64 = k.id as u64 | (k.v as u64) << 5 | (k.mark as u64) << 8 | (k.nb as u64) << 11;
    for j in 0..MAX_BONUS {
        debug_assert!(k.bonus[j].e < 8);
        x |= (k.bonus[j].t as u64) << (13 + 11 * j) | (k.bonus[j].e as u64) << (21 + 11 * j);
    }
    let b = x.to_le_bytes();
    [b[0], b[1], b[2], b[3], b[4], b[5]]
}
pub fn unpack(b: &[u8]) -> SkillInst {
    let x = u64::from_le_bytes([b[0], b[1], b[2], b[3], b[4], b[5], 0, 0]);
    let mut bonus = [Bonus::default(); MAX_BONUS];
    for j in 0..MAX_BONUS {
        bonus[j] = Bonus { t: (x >> (13 + 11 * j)) as u8, e: ((x >> (21 + 11 * j)) & 7) as u8 };
    }
    SkillInst { id: (x & 31) as u8, v: ((x >> 5) & 7) as u8, mark: ((x >> 8) & 7) as u8, nb: ((x >> 11) & 3) as u8, bonus }
}

/// Append the day entry for `cur` (vs the previous day's build `prev`) to `out`; returns bytes written
/// (0 when the build did not change: that day is reconstructed from the previous entry).
pub fn journal_day(day: u8, prev: &Build, cur: &Build, out: &mut [u8]) -> usize {
    let mut mask = 0u8;
    for j in 0..cur.n as usize {
        if j >= prev.n as usize || prev.skills[j] != cur.skills[j] {
            mask |= 1 << j;
        }
    }
    if mask == 0 && cur.n == prev.n && day != 1 {
        return 0;
    }
    out[0] = day;
    out[1] = cur.n;
    out[2] = mask;
    let mut w = 3;
    for j in 0..cur.n as usize {
        if mask & (1 << j) != 0 {
            out[w..w + PACKED].copy_from_slice(&pack(&cur.skills[j]));
            w += PACKED;
        }
    }
    w
}

/// Build of `day` from a journal read through `at(i)` (works on a ring arena without copying).
pub fn build_at(hero: u8, len: usize, day: u8, at: impl Fn(usize) -> u8) -> Build {
    let mut b = Build { hero, ..Default::default() };
    let mut p = 0;
    let mut six = [0u8; PACKED];
    while p < len {
        let d = at(p);
        if d > day {
            break;
        }
        b.n = at(p + 1);
        let mask = at(p + 2);
        p += 3;
        for j in 0..MAX_SKILLS {
            if mask & (1 << j) != 0 {
                for (k, x) in six.iter_mut().enumerate() {
                    *x = at(p + k);
                }
                b.skills[j] = unpack(&six);
                p += PACKED;
            }
        }
    }
    // slots past n are not part of the build
    for j in b.n as usize..MAX_SKILLS {
        b.skills[j] = SkillInst::default();
    }
    b
}

/// One ghost in a player's arena.
#[repr(C)]
#[derive(Clone, Copy, Default, Debug, PartialEq, Eq)]
pub struct GhostRef {
    pub run_no: u32,
    pub off: u16,
    pub len: u16,
    pub end_day: u8,
    pub hero: u8,
    pub live: u8,
    pub _pad: u8,
}

/// A player's ghosts: ring of up to 5 refs + a ring byte arena. `#[repr(C)]`, integers only (zero-copy).
#[repr(C)]
#[derive(Clone, Copy)]
pub struct GhostSet {
    pub refs: [GhostRef; MAX_GHOSTS],
    /// index of the oldest live ref, number of live refs, bytes used
    pub oldest: u8,
    pub count: u8,
    pub used: u16,
    pub arena: [u8; ARENA],
}
impl Default for GhostSet {
    fn default() -> Self {
        GhostSet { refs: [GhostRef::default(); MAX_GHOSTS], oldest: 0, count: 0, used: 0, arena: [0; ARENA] }
    }
}

impl GhostSet {
    fn evict_oldest(&mut self) {
        let r = &mut self.refs[self.oldest as usize];
        self.used -= r.len;
        r.live = 0;
        self.oldest = ((self.oldest as usize + 1) % MAX_GHOSTS) as u8;
        self.count -= 1;
    }
    /// Store a ghost (its journal bytes). Evicts the oldest ghosts until it fits (5 max). Returns the ref slot.
    pub fn add(&mut self, run_no: u32, hero: u8, end_day: u8, journal: &[u8]) -> usize {
        let len = journal.len();
        assert!(len <= ARENA, "ghost larger than the arena");
        if self.count as usize == MAX_GHOSTS {
            self.evict_oldest();
        }
        while ARENA - (self.used as usize) < len {
            self.evict_oldest();
        }
        // write right after the newest ghost (ring)
        let off = if self.count == 0 {
            0
        } else {
            let newest = &self.refs[(self.oldest as usize + self.count as usize - 1) % MAX_GHOSTS];
            (newest.off as usize + newest.len as usize) % ARENA
        };
        for (i, &x) in journal.iter().enumerate() {
            self.arena[(off + i) % ARENA] = x;
        }
        let slot = (self.oldest as usize + self.count as usize) % MAX_GHOSTS;
        self.refs[slot] = GhostRef { run_no, off: off as u16, len: len as u16, end_day, hero, live: 1, _pad: 0 };
        self.count += 1;
        self.used += len as u16;
        if self.count == 1 {
            self.oldest = slot as u8;
        }
        slot
    }
    /// Exact build of a stored ghost on `day` (day ≤ its end_day).
    pub fn build(&self, slot: usize, day: u8) -> Build {
        let r = &self.refs[slot];
        let base = r.off as usize;
        build_at(r.hero, r.len as usize, day, |i| self.arena[(base + i) % ARENA])
    }
}
