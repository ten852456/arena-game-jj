//! Ghost storage must be exact: for every real player run (runs-20k), the journal reconstructs the build of
//! EVERY fought day, and a ring arena fed with consecutive runs (eviction + wrap-around) keeps every retained
//! ghost exact for every day.
use mochi_engine::ghost::{build_at, journal_day, pack, unpack, GhostSet, JOURNAL_MAX, MAX_GHOSTS};
use mochi_engine::run::RunState;
use mochi_engine::types::{Bonus, Build, SkillInst, MAX_SKILLS};

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
fn idx(x: i64) -> usize { if x < 0 { usize::MAX } else { x as usize } }

#[test]
fn pack_roundtrip_all_values() {
    for id in 0..26u8 { for v in 0..7u8 { for mark in 0..5u8 { for nb in 0..4u8 {
        let k = SkillInst { id, v, mark, nb, bonus: [Bonus { t: 203, e: 4 }, Bonus { t: id, e: 2 }, Bonus { t: 0, e: 0 }] };
        assert_eq!(unpack(&pack(&k)), k);
    } } } }
}

#[test]
fn journals_and_arena_are_exact() {
    let text = std::fs::read_to_string(std::env::var("MOCHI_RUNS").unwrap_or_else(|_| "../diff/runs-20k.txt".into())).unwrap();
    let (mut runs, mut days_checked, mut arena_checked, mut evicted_early) = (0, 0, 0, 0);
    let mut set = GhostSet::default();
    let mut stored: Vec<(usize, Vec<Build>)> = vec![]; // (ref slot, builds by day) for ghosts in the arena
    for (ri, line) in text.lines().step_by(2).enumerate() {
        let (head, rest) = line.split_once(" | ").unwrap();
        let h: Vec<i64> = head.split(' ').map(|x| x.parse().unwrap()).collect();
        let t: Vec<i64> = rest.split(' ').map(|x| x.parse().unwrap()).collect();
        let hero = h[4] as u8;
        let mut s = RunState::new(hero, h[0] as u32);
        let mut builds: Vec<Build> = vec![];
        let mut journal = vec![0u8; JOURNAL_MAX];
        let mut jlen = 0;
        let mut prev = Build { hero, ..Default::default() };
        let mut p = 1;
        while p < t.len() {
            let code = t[p];
            p += 1;
            match code {
                0 => { s.buy(idx(t[p])); p += 1; }
                1 => { s.sell(idx(t[p])); p += 1; }
                2 => { s.move_skill(t[p], t[p + 1]); p += 2; }
                3 => { s.reroll(); }
                4 => { s.toggle_lock(idx(t[p])); p += 1; }
                5 => { s.buy_slot(); }
                6 => { s.wish(); }
                7 => { s.choose_last_chance(t[p] as u8); p += 1; }
                8 => { s.apply_mark(t[p]); p += 1; }
                9 => { s.concede(); }
                10 => {
                    let b = s.to_build();
                    let day = builds.len() as u8 + 1;
                    jlen += journal_day(day, &prev, &b, &mut journal[jlen..]);
                    prev = b;
                    builds.push(b);
                    s.fight(&build_of(&t[p + 1..p + 83]), t[p] as u32);
                    p += 83;
                }
                _ => unreachable!(),
            }
            p += 2;
        }
        if builds.is_empty() { continue; }
        runs += 1;
        for (d, want) in builds.iter().enumerate() {
            let got = build_at(hero, jlen, d as u8 + 1, |i| journal[i]);
            assert_eq!(&got, want, "run {ri} day {}", d + 1);
            days_checked += 1;
        }
        // ring arena: add this run's ghost, then every retained ghost must still be exact on every day
        let before = set.count;
        let slot = set.add(ri as u32, hero, builds.len() as u8, &journal[..jlen]);
        if (before as usize) < MAX_GHOSTS && set.count <= before { evicted_early += 1; }
        stored.retain(|(sl, _)| set.refs[*sl].live == 1 && *sl != slot);
        stored.push((slot, builds));
        for (sl, bs) in &stored {
            for (d, want) in bs.iter().enumerate() {
                assert_eq!(&set.build(*sl, d as u8 + 1), want);
                arena_checked += 1;
            }
        }
    }
    println!("runs {runs} · journal days reconstructed exactly {days_checked} · arena ghost-days re-checked exactly {arena_checked} · ghosts evicted before 5 {evicted_early}");
}
