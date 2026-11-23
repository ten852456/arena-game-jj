//! Mochi Moon engine, sim v12. Integer-only, fixed-size state, no heap: runs on SBF (Solana / MagicBlock TEE)
//! and natively for tests. The TypeScript sim (arena-game-jj/src/sim) is the reference; data.rs is generated from it.
#![cfg_attr(not(test), no_std)]
extern crate alloc;

pub mod combat;
pub mod data;
pub mod fixed;
pub mod ghost;
pub mod rng;
pub mod run;
pub mod types;

pub use combat::{simulate, Fighter, NoProbe, Outcome, Probe};
pub use types::{Bonus, Build, SkillInst};
