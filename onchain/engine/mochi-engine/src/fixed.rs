//! ppm fixed point, same formulas as arena-game-jj/src/sim/fixed.ts. Inputs are non-negative (checked in debug).
pub const ONE: i64 = 1_000_000;

/// a / b rounded half up (a ≥ 0, b > 0)
#[inline(always)]
pub fn rdiv(a: i64, b: i64) -> i64 {
    debug_assert!(a >= 0 && b > 0, "rdiv({a}, {b})");
    ((2 * a as u64 + b as u64) / (2 * b as u64)) as i64
}

/// a × p (ppm), rounded half up
#[inline(always)]
pub fn mul_p(a: i64, p: i64) -> i64 {
    rdiv(a * p, ONE)
}

/// ceil(a / b) (a ≥ 0, b > 0)
#[inline(always)]
pub fn ceil_div(a: i64, b: i64) -> i64 {
    debug_assert!(a >= 0 && b > 0);
    ((a as u64 + b as u64 - 1) / b as u64) as i64
}
