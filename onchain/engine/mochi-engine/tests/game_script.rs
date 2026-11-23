//! Builds the replay script for the program benchmark (engine/bench/game-bench.mjs) from recorded player runs:
//! shop visits (the accepted actions between fights; same strict guard as the program's `apply`), fights
//! (opponent + seed), and the expected final RunState bytes. Runs only with MOCHI_SCRIPT=<out file>.
use mochi_engine::run::{RunState, PHASE_DEAD, PHASE_LASTCHANCE, PHASE_MARK, PHASE_SHOP, PHASE_WON};
use mochi_engine::types::{Bonus, Build, SkillInst, MAX_SKILLS};
use std::fmt::Write;

fn build_of(v: &[i64]) -> Build {
    let mut b = Build { hero: v[0] as u8, n: v[1] as u8, skills: [SkillInst::default(); MAX_SKILLS] };
    for i in 0..MAX_SKILLS {
        let s = &v[2 + i * 10..12 + i * 10];
        let mut bonus = [Bonus::default(); 3];
        for j in 0..3 {
            bonus[j] = Bonus { t: s[4 + 2 * j] as u8, e: s[5 + 2 * j] as u8 };
        }
        b.skills[i] = SkillInst { id: s[0] as u8, v: s[1] as u8, mark: s[2] as u8, nb: s[3] as u8, bonus };
    }
    b
}
fn hex(b: &[u8]) -> String { b.iter().fold(String::new(), |mut s, x| { let _ = write!(s, "{x:02x}"); s }) }

/// same rules as programs/mochi-game apply()
fn apply(s: &mut RunState, code: u8, a: i64, b: i64) -> bool {
    let n = s.n as i64;
    let idx = |x: i64| if x < 0 { usize::MAX } else { x as usize };
    match code {
        0..=6 if s.phase != PHASE_SHOP => false,
        0 => s.buy(idx(a)),
        1 => { if a < 0 || a >= n { return false; } s.sell(a as usize); true }
        2 => { if a < 0 || a >= n || !(b == 1 || b == -1) || a + b < 0 || a + b >= n { return false; } s.move_skill(a, b); true }
        3 => s.reroll(),
        4 => s.toggle_lock(idx(a)),
        5 => s.buy_slot(),
        6 => s.wish(),
        7 => { if s.phase != PHASE_LASTCHANCE || !(0..=2).contains(&a) { return false; } s.choose_last_chance(a as u8); true }
        8 => { if s.phase != PHASE_MARK || a < -1 || a >= n { return false; } s.apply_mark(a); true }
        9 => { if s.phase == PHASE_WON || s.phase == PHASE_DEAD { return false; } s.concede(); true }
        _ => false,
    }
}

#[test]
fn make_script() {
    let Ok(out) = std::env::var("MOCHI_SCRIPT") else { return };
    let k: usize = std::env::var("MOCHI_SCRIPT_RUNS").ok().and_then(|x| x.parse().ok()).unwrap_or(40);
    let text = std::fs::read_to_string("../diff/runs-20k.txt").unwrap();
    let mut lines = vec![];
    let (mut kept, mut dropped) = (0, 0);
    for line in text.lines().step_by(2).take(k) {
        let (head, rest) = line.split_once(" | ").unwrap();
        let h: Vec<i64> = head.split(' ').map(|x| x.parse().unwrap()).collect();
        let t: Vec<i64> = rest.split(' ').map(|x| x.parse().unwrap()).collect();
        let mut s = RunState::new(h[4] as u8, h[0] as u32);
        lines.push(format!("R {} {}", h[4], h[0]));
        let mut visit: Vec<String> = vec![];
        let mut p = 1;
        while p < t.len() {
            let code = t[p] as u8;
            p += 1;
            if code == 10 {
                lines.push(format!("S {}", visit.join(",")));
                visit.clear();
                let opp: Vec<String> = t[p + 1..p + 83].iter().map(|x| x.to_string()).collect();
                if s.phase == PHASE_SHOP {
                    s.fight(&build_of(&t[p + 1..p + 83]), t[p] as u32);
                    lines.push(format!("F {} {}", t[p], opp.join(",")));
                }
                p += 85;
                continue;
            }
            let (a, b) = match code { 2 => (t[p], t[p + 1]), 3 | 5 | 6 | 9 => (0, 0), _ => (t[p], 0) };
            p += match code { 2 => 2, 3 | 5 | 6 | 9 => 0, _ => 1 };
            p += 2;
            let mut trial = s;
            if apply(&mut trial, code, a, b) {
                s = trial;
                visit.push(format!("{code} {a} {b}"));
                kept += 1;
            } else {
                dropped += 1;
            }
        }
        lines.push(format!("S {}", visit.join(",")));
        lines.push(format!("E {} {}", s.phase, hex(&s.to_bytes())));
    }
    std::fs::write(&out, lines.join("\n") + "\n").unwrap();
    println!("script: {k} runs, kept {kept} actions, dropped {dropped} (rejected by the rules / guards)");
}
