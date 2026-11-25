//! Ghost storage must be exact (sim v22): for every player run of the run cases, the journal reconstructs the build
//! (skills, stars, marks, bonuses, relics) of EVERY fought day, and a ring arena fed with consecutive runs (eviction +
//! wrap-around) keeps every retained ghost exact for every day. Also prints ghost sizes for the arena budget.
//! MOCHI_RUNS=<file> (default ../diff/runs-2k.txt)
use mochi_engine::data::{MAX_BONUS, MAX_RELICS};
use mochi_engine::ghost::{build_at, journal_day, pack, unpack, GhostSet, JOURNAL_MAX, MAX_GHOSTS};
use mochi_engine::run::RunState;
use mochi_engine::types::{Bonus, Build, SkillInst, MAX_SKILLS};

const BUILD_LEN: usize = 3 + MAX_RELICS + MAX_SKILLS * (5 + 2 * MAX_BONUS);
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
fn idx(x: i64) -> usize {
    if x < 0 { usize::MAX } else { x as usize }
}

#[test]
fn pack_roundtrip_all_values() {
    for id in 0..43u8 {
        for v in 0..7u8 {
            for mark in 0..5u8 {
                for star in 0..4u8 {
                    for nb in 0..4u8 {
                        let k = SkillInst { id, v, mark, star, nb, bonus: [Bonus { t: 209, e: 4 }, Bonus { t: id, e: 2 }, Bonus { t: 0, e: 0 }] };
                        assert_eq!(unpack(&pack(&k)), k);
                    }
                }
            }
        }
    }
}

#[test]
fn journals_and_arena_are_exact() {
    let path = std::env::var("MOCHI_RUNS").unwrap_or_else(|_| "../diff/runs-2k.txt".into());
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("read {path}: {e}"));
    let (mut runs, mut days_checked, mut arena_checked, mut evicted_early) = (0, 0, 0, 0);
    let mut sizes: Vec<usize> = vec![];
    let mut set = GhostSet::default();
    let mut stored: Vec<(usize, Vec<Build>)> = vec![]; // (ref slot, builds by day) for ghosts in the arena
    // player runs only (even cases): adversarial logs are not real ghosts
    for (ri, line) in text.lines().step_by(2).enumerate() {
        let (head, rest) = line.split_once(" | ").unwrap();
        let h: Vec<i64> = head.split(' ').map(|x| x.parse().unwrap()).collect();
        let t: Vec<i64> = rest.split(' ').map(|x| x.parse().unwrap()).collect();
        let (seed, hero) = (h[0] as u32, h[5] as u8);
        let secret = if h[1] < 0 { None } else { Some(h[1] as u32) };
        let mut s = RunState::new(hero, seed, secret);
        let mut builds: Vec<Build> = vec![];
        let mut journal = vec![0u8; JOURNAL_MAX];
        let mut jlen = 0;
        let mut prev = Build { hero, ..Default::default() };
        let mut p = 1;
        while p < t.len() {
            let code = t[p];
            p += 1;
            match code {
                0 => { s.buy(idx(t[p]), if t[p + 1] < 0 { None } else { Some(t[p + 1] as usize) }); p += 2; }
                1 => { s.sell(idx(t[p])); p += 1; }
                2 => { s.move_skill(t[p], t[p + 1]); p += 2; }
                3 => { s.reroll(secret); }
                4 => { s.toggle_lock(idx(t[p])); p += 1; }
                5 => { s.buy_slot(); }
                6 => { s.wish(secret); }
                7 => { s.choose_last_chance(t[p] as u8, secret); p += 1; }
                8 => { s.apply_mark(t[p], secret); p += 1; }
                9 => { s.concede(); }
                10 => {
                    let b = s.to_build();
                    let day = builds.len() as u8 + 1;
                    jlen += journal_day(day, &prev, &b, &mut journal[jlen..]);
                    prev = b;
                    builds.push(b);
                    s.fight(&build_of(&t[p + 1..p + 1 + BUILD_LEN]), t[p] as u32, secret);
                    p += 1 + BUILD_LEN;
                }
                11 => { s.pick_relic(t[p]); p += 1; }
                12 => { s.reroll_relic(secret); }
                _ => unreachable!(),
            }
            p += 2;
        }
        if builds.is_empty() {
            continue;
        }
        runs += 1;
        sizes.push(jlen);
        for (d, want) in builds.iter().enumerate() {
            let got = build_at(hero, jlen, d as u8 + 1, |i| journal[i]);
            assert_eq!(&got, want, "run {ri} day {}", d + 1);
            days_checked += 1;
        }
        let before = set.count;
        let slot = set.add(ri as u32, hero, builds.len() as u8, &journal[..jlen]);
        if (before as usize) < MAX_GHOSTS && set.count <= before {
            evicted_early += 1;
        }
        stored.retain(|(sl, _)| set.refs[*sl].live == 1 && *sl != slot);
        stored.push((slot, builds));
        for (sl, bs) in &stored {
            for (d, want) in bs.iter().enumerate() {
                assert_eq!(&set.build(*sl, d as u8 + 1), want);
                arena_checked += 1;
            }
        }
    }
    sizes.sort();
    let mean = sizes.iter().sum::<usize>() as f64 / sizes.len().max(1) as f64;
    println!(
        "runs {runs} · journal days exact {days_checked} · arena ghost-days re-checked {arena_checked} · evicted before 5: {evicted_early} · ghost bytes mean {mean:.0} p95 {} max {} (JOURNAL_MAX {JOURNAL_MAX})",
        sizes[sizes.len() * 95 / 100], sizes[sizes.len() - 1]
    );
}
