//! CU bench for the sim v22 engine: one real fight per instruction, on SBF. Local validator only.
//! Build bytes (93): hero, n, relics[3] (255 = none), then 8 × (id, v, mark, star, nb, 3 × (target, kind)).
use anchor_lang::prelude::*;
use mochi_engine::types::{Bonus, Build, SkillInst, MAX_SKILLS};

declare_id!("CZj1wwBSAD7eExpKF8JayMzW73WqYdAYCyKpW5MFxriA");

pub const BUILD_BYTES: usize = 5 + 11 * MAX_SKILLS;

fn decode(x: &[u8; BUILD_BYTES]) -> Build {
    let mut b = Build { hero: x[0], n: x[1], relics: [x[2], x[3], x[4]], ..Build::default() };
    for i in 0..MAX_SKILLS {
        let s = &x[5 + 11 * i..5 + 11 * (i + 1)];
        let bonus = [Bonus { t: s[5], e: s[6] }, Bonus { t: s[7], e: s[8] }, Bonus { t: s[9], e: s[10] }];
        b.skills[i] = SkillInst { id: s[0], v: s[1], mark: s[2], star: s[3], nb: s[4], bonus };
    }
    b
}

#[program]
pub mod fight_bench {
    use super::*;

    /// Returns (winner + 1) << 32 | ticks as return data.
    pub fn fight(_ctx: Context<Bench>, day: u8, seed: u32, a: [u8; BUILD_BYTES], b: [u8; BUILD_BYTES]) -> Result<u64> {
        let (ba, bb) = (decode(&a), decode(&b));
        let o = mochi_engine::simulate(&ba, &bb, seed, day as usize, &mut mochi_engine::NoProbe);
        Ok((((o.winner + 1) as u64) << 32) | o.ticks as u64)
    }

    /// baseline: same instruction data, no fight (subtract for the fight's own CU)
    pub fn noop(_ctx: Context<Bench>, _day: u8, _seed: u32, a: [u8; BUILD_BYTES], _b: [u8; BUILD_BYTES]) -> Result<u64> {
        Ok(a[0] as u64)
    }
}

#[derive(Accounts)]
pub struct Bench {}
