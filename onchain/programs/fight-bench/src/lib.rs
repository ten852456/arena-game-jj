//! CU bench for the sim v22 engine on SBF (local validator only): one real fight, or one run action, per instruction.
//! Build bytes (93): hero, n, relics[3] (255 = none), then 8 × (id, v, mark, star, nb, 3 × (target, kind)).
use anchor_lang::prelude::*;
use mochi_engine::run::{RunState, RUN_STATE_SIZE};
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

    /// run.ts newRun: the raw state
    pub fn run_new(_ctx: Context<Bench>, hero: u8, seed: u32, secret: u32, has_secret: u8) -> Result<[u8; RUN_STATE_SIZE]> {
        Ok(RunState::new(hero, seed, if has_secret != 0 { Some(secret) } else { None }).to_bytes())
    }

    /// one run action on a raw state (codes as engine/diff/run-gen.mts); returns [accepted, state…]
    pub fn run_step(_ctx: Context<Bench>, state: [u8; RUN_STATE_SIZE], code: u8, a: i8, b: i8, seed: u32, secret: u32, has_secret: u8, opp: [u8; BUILD_BYTES]) -> Result<[u8; RUN_STATE_SIZE + 1]> {
        let mut s = RunState::from_bytes(&state);
        let sec = if has_secret != 0 { Some(secret) } else { None };
        let ix = |x: i8| if x < 0 { usize::MAX } else { x as usize };
        let ok = match code {
            0 => s.buy(ix(a), if b < 0 { None } else { Some(b as usize) }),
            1 => { s.sell(ix(a)); true }
            2 => { s.move_skill(a as i64, b as i64); true }
            3 => s.reroll(),
            4 => s.toggle_lock(ix(a)),
            5 => s.buy_slot(),
            6 => s.wish(sec),
            7 => { s.choose_last_chance(a as u8, sec); true }
            8 => s.apply_mark(a as i64, sec),
            9 => { s.concede(); true }
            10 => { s.fight(&decode(&opp), seed, sec); true }
            11 => s.pick_relic(a as i64),
            12 => s.reroll_relic(sec),
            _ => false,
        };
        let mut out = [0u8; RUN_STATE_SIZE + 1];
        out[0] = ok as u8;
        out[1..].copy_from_slice(&s.to_bytes());
        Ok(out)
    }

    /// baseline for run_step: same data in and out, no action
    pub fn run_noop(_ctx: Context<Bench>, state: [u8; RUN_STATE_SIZE], _code: u8, _a: i8, _b: i8, _seed: u32, _secret: u32, _has_secret: u8, _opp: [u8; BUILD_BYTES]) -> Result<[u8; RUN_STATE_SIZE + 1]> {
        let mut out = [0u8; RUN_STATE_SIZE + 1];
        out[1..].copy_from_slice(&RunState::from_bytes(&state).to_bytes());
        Ok(out)
    }

    /// baseline: same instruction data, no fight (subtract for the fight's own CU)
    pub fn noop(_ctx: Context<Bench>, _day: u8, _seed: u32, a: [u8; BUILD_BYTES], _b: [u8; BUILD_BYTES]) -> Result<u64> {
        Ok(a[0] as u64)
    }
}

#[derive(Accounts)]
pub struct Bench {}
