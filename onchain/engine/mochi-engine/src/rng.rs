//! mulberry32, bit-identical to arena-game-jj/src/sim/rng.ts. `int(n)` = floor(next() × n) computed exactly
//! as (v × n) >> 32 (v / 2^32 is exact in a double, so the two are equal).
pub struct Rng {
    s: u32,
}

impl Rng {
    pub fn new(seed: u32) -> Self {
        Rng { s: seed }
    }
    #[inline(always)]
    pub fn next_u32(&mut self) -> u32 {
        self.s = self.s.wrapping_add(0x6d2b_79f5);
        let mut t = self.s;
        t = (t ^ (t >> 15)).wrapping_mul(t | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
        t ^ (t >> 14)
    }
    #[inline(always)]
    pub fn int(&mut self, n: u32) -> u32 {
        ((self.next_u32() as u64 * n as u64) >> 32) as u32
    }
}
