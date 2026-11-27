//! Run-state differential test (sim v22 / run v13): replays each TS action log (engine/diff/run-gen.mts) in Rust and
//! compares, after EVERY action, accepted/rejected and a hash of the whole run state (shop, locks, bonuses, stars,
//! relics and relic offers, gold, income, streak, slots, HP, phase, upgrades, marks, wishes, last chance, win/loss).
//! Half of the runs are on-chain runs (secret seed). Also checks heroChoices.
//! MOCHI_RUNS=<file> (default ../diff/runs-2k.txt)
use mochi_engine::data::{MAX_BONUS, MAX_RELICS, RELIC_OFFER, SHOP_SIZE};
use mochi_engine::run::{hero_choices, RunState, SeedHash};
use mochi_engine::types::{Bonus, Build, SkillInst, MAX_SKILLS, NO_RELIC};

fn skill_enc(k: &SkillInst, out: &mut Vec<i64>) {
    out.extend_from_slice(&[k.id as i64, k.v as i64, k.mark as i64, k.star as i64, k.nb as i64]);
    for b in &k.bonus {
        out.extend_from_slice(&[b.t as i64, b.e as i64]);
    }
}

/// same layout as run-gen.mts encodeState
pub fn encode(s: &RunState) -> Vec<i64> {
    let mut o = vec![
        s.hero as i64, s.seed as i64, s.day as i64, s.hp as i64, s.wins as i64, s.losses as i64, s.gold as i64, s.streak as i64,
        s.last_base as i64, s.last_bonus as i64, s.bonus_slots as i64, s.slot_buys as i64, s.rolls as i64, s.ghost as i64,
        s.pending_mark as i64, s.phase as i64, s.conceded as i64, s.wishes as i64, s.wish_marks as i64, s.n as i64,
    ];
    for i in 0..SHOP_SIZE {
        o.push(s.locks[i] as i64);
    }
    for i in 0..MAX_RELICS {
        o.push(s.relics[i] as i64);
    }
    for i in 0..RELIC_OFFER {
        o.push(s.relic_offer[i] as i64);
    }
    o.push(s.relic_days as i64);
    o.push(s.relic_rolls as i64);
    let w = 5 + 2 * MAX_BONUS;
    for i in 0..MAX_SKILLS {
        if i < s.n as usize { skill_enc(&s.skills[i], &mut o) } else { o.extend(std::iter::repeat(0).take(w)) }
    }
    for of in &s.shop {
        if of.present == 0 {
            o.extend(std::iter::repeat(0).take(w));
        } else {
            o.extend_from_slice(&[1, of.id as i64, of.v as i64, of.star as i64, of.nb as i64]);
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

/// gen.mts enc (sim v22)
pub const BUILD_LEN: usize = 3 + MAX_RELICS + MAX_SKILLS * (5 + 2 * MAX_BONUS);
fn build_of(v: &[i64]) -> Build {
    let mut b = Build { hero: v[0] as u8, n: v[1] as u8, ..Build::default() };
    for i in 0..MAX_RELICS {
        b.relics[i] = v[3 + i] as u8;
    }
    let (base, per) = (3 + MAX_RELICS, 5 + 2 * MAX_BONUS);
    for i in 0..MAX_SKILLS {
        let s = &v[base + i * per..base + (i + 1) * per];
        let mut bonus = [Bonus::default(); MAX_BONUS];
        for j in 0..MAX_BONUS {
            bonus[j] = Bonus { t: s[5 + 2 * j] as u8, e: s[6 + 2 * j] as u8 };
        }
        b.skills[i] = SkillInst { id: s[0] as u8, v: s[1] as u8, mark: s[2] as u8, star: s[3] as u8, nb: s[4] as u8, bonus };
    }
    b
}

/// index args may be negative / out of range in adversarial runs: map to "no such index"
fn idx(x: i64) -> usize {
    if x < 0 { usize::MAX } else { x as usize }
}

/// run-gen.mts actSecret: the secret of the run's k-th action (on chain: from that request's VRF output)
pub fn act_secret(secret: Option<u32>, k: usize) -> Option<u32> {
    secret.map(|s| SeedHash::new().num(s as u64).str(b"act").num(k as u64).done())
}

/// Apply one encoded action (run-gen.mts apply); returns (accepted, new position)
pub fn step(s: &mut RunState, t: &[i64], mut p: usize, secret: Option<u32>) -> (bool, usize) {
    let code = t[p];
    p += 1;
    let ok = match code {
        0 => {
            let pick = if t[p + 1] < 0 { None } else { Some(t[p + 1] as usize) };
            let r = s.buy(idx(t[p]), pick);
            p += 2;
            r
        }
        1 => { s.sell(idx(t[p])); p += 1; true }
        2 => { s.move_skill(t[p], t[p + 1]); p += 2; true }
        3 => s.reroll(secret),
        4 => { let r = s.toggle_lock(idx(t[p])); p += 1; r }
        5 => s.buy_slot(),
        6 => s.wish(secret),
        7 => { s.choose_last_chance(t[p] as u8, secret); p += 1; true }
        8 => { let r = s.apply_mark(t[p], secret); p += 1; r }
        9 => { s.concede(); true }
        10 => {
            let seed = t[p] as u32;
            let opp = build_of(&t[p + 1..p + 1 + BUILD_LEN]);
            p += 1 + BUILD_LEN;
            s.fight(&opp, seed, secret);
            true
        }
        11 => { let r = s.pick_relic(t[p]); p += 1; r }
        12 => s.reroll_relic(secret),
        _ => panic!("bad code {code}"),
    };
    (ok, p)
}

#[test]
fn run_matches_ts_after_every_action() {
    let path = std::env::var("MOCHI_RUNS").unwrap_or_else(|_| "../diff/runs-2k.txt".into());
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("read {path}: {e}"));
    let (mut runs_ok, mut runs_bad, mut actions, mut action_bad, mut choices_bad, mut secret_runs) = (0, 0, 0usize, 0usize, 0, 0);
    let mut fails = vec![];
    for (ci, line) in text.lines().enumerate() {
        let (head, rest) = line.split_once(" | ").unwrap();
        let h: Vec<i64> = head.split(' ').map(|x| x.parse().unwrap()).collect();
        let (seed, hero) = (h[0] as u32, h[5] as u8);
        let secret = if h[1] < 0 { None } else { Some(h[1] as u32) };
        secret_runs += secret.is_some() as usize;
        if hero_choices(seed).iter().map(|&x| x as i64).collect::<Vec<_>>() != h[2..5] {
            choices_bad += 1;
        }
        let t: Vec<i64> = rest.split(' ').map(|x| x.parse().unwrap()).collect();
        let mut s = RunState::new(hero, seed, secret);
        let mut bad_at: Option<String> = None;
        if hash(&encode(&s)) != t[0] as u32 {
            bad_at = Some(format!("start state {:?}", encode(&s)));
        }
        let mut p = 1;
        let mut k = 0;
        while p < t.len() && bad_at.is_none() {
            let code = t[p];
            let (ok, np) = step(&mut s, &t, p, act_secret(secret, k));
            p = np;
            let (want_ok, want_h) = (t[p] == 1, t[p + 1] as u32);
            p += 2;
            actions += 1;
            if ok != want_ok || hash(&encode(&s)) != want_h {
                action_bad += 1;
                bad_at = Some(format!("action {k} code {code}: rust ok {ok} ts ok {want_ok}; rust state {:?}", encode(&s)));
            }
            k += 1;
        }
        match bad_at {
            None => runs_ok += 1,
            Some(msg) => {
                runs_bad += 1;
                if fails.len() < 5 {
                    fails.push(format!("run {ci} (secret {}): {msg}", secret.is_some()));
                }
            }
        }
    }
    println!("runs equal {runs_ok}, different {runs_bad} ({secret_runs} on-chain runs); actions compared {actions}, first-mismatch actions {action_bad}; heroChoices mismatches {choices_bad}");
    for f in &fails {
        println!("{f}");
    }
    assert!(runs_bad == 0 && choices_bad == 0);
}

#[test]
fn run_state_is_flat() {
    // repr(C), integers only: the program can view account bytes as RunState without (de)serialising
    println!("RunState {} B", core::mem::size_of::<RunState>());
    assert_eq!(core::mem::size_of::<RunState>(), 184);
    let s = RunState::default();
    assert!(s.relics.iter().all(|&r| r == NO_RELIC));
}

#[test]
fn secret_runs_ignore_the_public_seed() {
    // on chain every roll comes from the secret: the same actions with ANY public seed give the same run (seed aside)
    let path = std::env::var("MOCHI_RUNS").unwrap_or_else(|_| "../diff/runs-2k.txt".into());
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("read {path}: {e}"));
    let (mut runs, mut actions) = (0, 0);
    for line in text.lines() {
        let (head, rest) = line.split_once(" | ").unwrap();
        let h: Vec<i64> = head.split(' ').map(|x| x.parse().unwrap()).collect();
        if h[1] < 0 {
            continue;
        }
        let (seed, secret, hero) = (h[0] as u32, Some(h[1] as u32), h[5] as u8);
        let t: Vec<i64> = rest.split(' ').map(|x| x.parse().unwrap()).collect();
        let mut a = RunState::new(hero, seed, secret);
        let mut b = RunState::new(hero, seed ^ 0x9e37_79b9, secret);
        let strip = |s: &RunState| { let mut e = encode(s); e[1] = 0; e };
        assert_eq!(strip(&a), strip(&b));
        let mut p = 1;
        let mut k = 0;
        while p < t.len() {
            let (oka, np) = step(&mut a, &t, p, act_secret(secret, k));
            let (okb, _) = step(&mut b, &t, p, act_secret(secret, k));
            k += 1;
            assert_eq!(oka, okb);
            assert_eq!(strip(&a), strip(&b), "public seed changed an on-chain run");
            p = np + 2;
            actions += 1;
        }
        runs += 1;
    }
    println!("on-chain runs replayed with another public seed: {runs} runs, {actions} actions, all identical");
}
