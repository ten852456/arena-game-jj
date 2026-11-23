//! Dumps, for the first K player runs of a run-case file, the raw state before every action plus the action
//! (and the expected state after), for the SBF per-action CU benchmark. Runs only with MOCHI_DUMP=<out file>.
use mochi_engine::run::RunState;
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
fn hex(b: &[u8]) -> String {
    b.iter().fold(String::new(), |mut s, x| { let _ = write!(s, "{x:02x}"); s })
}
fn idx(x: i64) -> usize { if x < 0 { usize::MAX } else { x as usize } }

#[test]
fn dump_actions() {
    let Ok(out) = std::env::var("MOCHI_DUMP") else { return };
    let k_runs: usize = std::env::var("MOCHI_DUMP_RUNS").ok().and_then(|x| x.parse().ok()).unwrap_or(40);
    let text = std::fs::read_to_string(std::env::var("MOCHI_RUNS").unwrap_or_else(|_| "../diff/runs-20k.txt".into())).unwrap();
    let mut lines = vec![];
    for (ci, line) in text.lines().enumerate().filter(|(i, _)| i % 2 == 0).take(k_runs) {
        let (head, rest) = line.split_once(" | ").unwrap();
        let h: Vec<i64> = head.split(' ').map(|x| x.parse().unwrap()).collect();
        let t: Vec<i64> = rest.split(' ').map(|x| x.parse().unwrap()).collect();
        let mut s = RunState::new(h[4] as u8, h[0] as u32);
        lines.push(format!("{ci} new {} {} {}", h[4], h[0], hex(&s.to_bytes())));
        let mut p = 1;
        while p < t.len() {
            let code = t[p];
            p += 1;
            let before = hex(&s.to_bytes());
            let (mut a, mut b, mut seed, mut opp) = (0i64, 0i64, 0u32, vec![0i64; 82]);
            match code {
                0 => { a = t[p]; s.buy(idx(a)); p += 1; }
                1 => { a = t[p]; s.sell(idx(a)); p += 1; }
                2 => { a = t[p]; b = t[p + 1]; s.move_skill(a, b); p += 2; }
                3 => { s.reroll(); }
                4 => { a = t[p]; s.toggle_lock(idx(a)); p += 1; }
                5 => { s.buy_slot(); }
                6 => { s.wish(); }
                7 => { a = t[p]; s.choose_last_chance(a as u8); p += 1; }
                8 => { a = t[p]; s.apply_mark(a); p += 1; }
                9 => { s.concede(); }
                10 => { seed = t[p] as u32; opp = t[p + 1..p + 83].to_vec(); s.fight(&build_of(&opp), seed); p += 83; }
                _ => unreachable!(),
            }
            p += 2;
            let opp_s: Vec<String> = opp.iter().map(|x| x.to_string()).collect();
            lines.push(format!("{ci} {code} {a} {b} {seed} {} {before} {}", opp_s.join(","), hex(&s.to_bytes())));
        }
    }
    std::fs::write(&out, lines.join("\n") + "\n").unwrap();
    println!("dumped {} lines", lines.len());
}
