/**
 * Integer fixed-point helpers for sim v12. The fight is integer-only so the Rust engine on Solana (no FPU) gives the
 * exact same result at a fraction of the cost. Multipliers and shares are parts per million (ppm): 1.7 → 1_700_000.
 * All values here stay far below 2^53, so plain JS numbers are exact; Rust uses u64 with the same formulas.
 */
export const ONE = 1_000_000;

/** Data decimal → ppm. Data numbers have at most a few decimals, so this is exact. Only used on data, never on state. */
export const P = (x: number) => Math.round(x * ONE);

/** a / b rounded half up (a ≥ 0, b > 0): the integer form of Math.round(a / b). */
export const rdiv = (a: number, b: number) => Math.floor((2 * a + b) / (2 * b));

/** a × p (ppm), rounded half up. */
export const mulP = (a: number, p: number) => rdiv(a * p, ONE);

/** ceil(a / b) for a ≥ 0, b > 0. */
export const ceilDiv = (a: number, b: number) => Math.floor((a + b - 1) / b);
