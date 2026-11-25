//! Run-state differential test: replays each TS action log (engine/diff/run-gen.mts) in Rust and compares,
//! after EVERY action, accepted/rejected and a hash of the whole run state (shop, locks, bonuses, gold, income,
//! streak, slots, HP, phase, upgrades, marks, wish count, last chance, win/loss). Also checks heroChoices.
//! MOCHI_RUNS=<file> (default ../diff/runs-2k.txt)
use mochi_engine::run::{hero_choices, RunState};
use mochi_engine::types::{Bonus, Build, SkillInst, MAX_SKILLS};

fn skill_enc(k: &SkillInst, out: &mut Vec<i64>) {
    out.extend_from_slice(&[k.id as i64, k.v as i64, k.mark as i64, k.nb as i64]);
    for b in &k.bonus {
        out.extend_from_slice(&[b.t as i64, b.e as i64]);
    }
}

/// same layout as run-gen.mts encodeState
fn encode(s: &RunState) -> Vec<i64> {
    let mut o = vec![
        s.hero as i64, s.seed as i64, s.day as i64, s.hp as i64, s.wins as i64, s.losses as i64, s.gold as i64, s.streak as i64,
        s.last_base as i64, s.last_bonus as i64, s.bonus_slots as i64, s.slot_buys as i64, s.rolls as i64, s.ghost as i64,
        s.pending_mark as i64, s.phase as i64, s.conceded as i64, s.wishes as i64, s.n as i64,
    ];
    for i in 0..5 {
        o.push(s.locks[i] as i64);
    }
    for i in 0..MAX_SKILLS {
        if i < s.n as usize { skill_enc(&s.skills[i], &mut o) } else { o.extend_from_slice(&[0; 10]) }
    }
    for of in &s.shop {
        if of.present == 0 {
            o.extend_from_slice(&[0; 10]);
        } else {
            o.extend_from_slice(&[1, of.id as i64, of.v as i64, of.nb as i64]);
            for b in &of.bonus {
                o.extend_from_slice(&[b.t as i64, b.e as i64]);
            }
        }
    }
    o
}

fn hash(xs: &[i64]) -> u32 {
    let mut h: u32 = 2_166_136_261;
    for &x in xs {
        h = (h ^ (x as u32)).wrapping_mul(16_777_619);
        h = (h ^ ((x >> 32) as u32)).wrapping_mul(16_777_619);
    }
    h
}

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

/// index args may be negative / out of range in adversarial runs: map to "no such index"
fn idx(x: i64) -> usize {
    if x < 0 { usize::MAX } else { x as usize }
}

#[test]
fn run_matches_ts_after_every_action() {
    let path = std::env::var("MOCHI_RUNS").unwrap_or_else(|_| "../diff/runs-2k.txt".into());
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("read {path}: {e}"));
    let (mut runs_ok, mut runs_bad, mut actions, mut action_bad, mut choices_bad) = (0, 0, 0usize, 0usize, 0);
    let mut fails = vec![];
    for (ci, line) in text.lines().enumerate() {
        let (head, rest) = line.split_once(" | ").unwrap();
        let h: Vec<i64> = head.split(' ').map(|x| x.parse().unwrap()).collect();
        let (seed, hero) = (h[0] as u32, h[4] as u8);
        if hero_choices(seed).iter().map(|&x| x as i64).collect::<Vec<_>>() != h[1..4] {
            choices_bad += 1;
        }
        let t: Vec<i64> = rest.split(' ').map(|x| x.parse().unwrap()).collect();
        let mut s = RunState::new(hero, seed);
        let mut bad_at: Option<(usize, String)> = None;
        if hash(&encode(&s)) != t[0] as u32 {
            bad_at = Some((0, "start state".into()));
        }
        let mut p = 1;
        let mut k = 0;
        while p < t.len() && bad_at.is_none() {
            let code = t[p];
            p += 1;
            let ok = match code {
                0 => { let r = s.buy(idx(t[p])); p += 1; r }
                1 => { s.sell(idx(t[p])); p += 1; true }
                2 => { s.move_skill(t[p], t[p + 1]); p += 2; true }
                3 => s.reroll(),
                4 => { let r = s.toggle_lock(idx(t[p])); p += 1; r }
                5 => s.buy_slot(),
                6 => s.wish(),
                7 => { s.choose_last_chance(t[p] as u8); p += 1; true }
                8 => { s.apply_mark(t[p]); p += 1; true }
                9 => { s.concede(); true }
                10 => {
                    let seed = t[p] as u32;
                    let opp = build_of(&t[p + 1..p + 83]);
                    p += 83;
                    s.fight(&opp, seed);
                    true
                }
                _ => panic!("bad code {code}"),
            };
            let (want_ok, want_h) = (t[p] == 1, t[p + 1] as u32);
            p += 2;
            actions += 1;
            if ok != want_ok || hash(&encode(&s)) != want_h {
                action_bad += 1;
                bad_at = Some((k, format!("action {k} code {code}: rust ok {ok} ts ok {want_ok}; rust state {:?}", encode(&s))));
            }
            k += 1;
        }
        match bad_at {
            None => runs_ok += 1,
            Some((_, msg)) => {
                runs_bad += 1;
                if fails.len() < 5 {
                    fails.push(format!("run {ci}: {msg}"));
                }
            }
        }
    }
    println!("runs equal {runs_ok}, different {runs_bad}; actions compared {actions}, first-mismatch actions {action_bad}; heroChoices mismatches {choices_bad}");
    for f in &fails {
        println!("{f}");
    }
    assert!(runs_bad == 0 && choices_bad == 0);
}

#[test]
fn run_state_is_flat() {
    // repr(C), integers only: the program can view account bytes as RunState without (de)serialising
    println!("RunState {} B", core::mem::size_of::<RunState>());
    assert!(core::mem::size_of::<RunState>() <= 192);
}
