//! Ghost storage study: the build of every fought day of real player runs (runs-20k, player runs only), sized
//! in candidate formats. Prints average / p95 / max bytes per ghost. Runs only with MOCHI_JSTATS=1.
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
fn stat(mut v: Vec<usize>) -> String {
    v.sort();
    let mean = v.iter().sum::<usize>() as f64 / v.len() as f64;
    format!("mean {:.0} · p95 {} · max {}", mean, v[v.len() * 95 / 100], v[v.len() - 1])
}

#[test]
fn journal_sizes() {
    if std::env::var("MOCHI_JSTATS").is_err() { return; }
    let text = std::fs::read_to_string("../diff/runs-20k.txt").unwrap();
    let (mut a, mut b, mut c, mut d, mut days_v, mut changes_v, mut slots_changed) = (vec![], vec![], vec![], vec![], vec![], vec![], vec![]);
    for line in text.lines().step_by(2) {
        let (head, rest) = line.split_once(" | ").unwrap();
        let h: Vec<i64> = head.split(' ').map(|x| x.parse().unwrap()).collect();
        let t: Vec<i64> = rest.split(' ').map(|x| x.parse().unwrap()).collect();
        let mut s = RunState::new(h[4] as u8, h[0] as u32);
        let mut builds: Vec<Build> = vec![];
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
                10 => { builds.push(s.to_build()); s.fight(&build_of(&t[p + 1..p + 83]), t[p] as u32); p += 83; }
                _ => unreachable!(),
            }
            p += 2;
        }
        if builds.is_empty() { continue; }
        let days = builds.len();
        // A: full build every day (82 B)
        a.push(days * 82);
        // B: full build only when changed (+1 day byte)
        let mut changes = 0;
        let (mut bb, mut cc, mut dd, mut sc) = (0, 1, 1, 0); // C and D carry the hero once
        for (i, bu) in builds.iter().enumerate() {
            let prev = if i > 0 { Some(&builds[i - 1]) } else { None };
            if prev.map_or(true, |p| p != bu) {
                changes += 1;
                bb += 1 + 82;
                cc += 2 + 6 * bu.n as usize; // day, n, packed skills (6 B)
                // D: day, n, slot mask, then only the changed slots (packed)
                let k = (0..MAX_SKILLS).filter(|&j| j < bu.n as usize && prev.map_or(true, |p| j >= p.n as usize || p.skills[j] != bu.skills[j])).count();
                sc += k;
                dd += 3 + 6 * k;
            }
        }
        b.push(bb);
        c.push(cc);
        d.push(dd);
        days_v.push(days);
        changes_v.push(changes);
        slots_changed.push(sc);
    }
    println!("player runs: {} · fought days per run: {} · days with a changed build: {} · changed slots per run: {}", a.len(), stat(days_v), stat(changes_v), stat(slots_changed));
    println!("A full every day (82 B)        : {}", stat(a));
    println!("B full on change (+day)         : {}", stat(b));
    println!("C packed full on change (6 B/sk): {}", stat(c));
    println!("D packed delta (changed slots)  : {}", stat(d.clone()));
    // arena sizing: 5 consecutive ghosts (+ 8 B table entry each) must fit a per-player arena of R bytes
    for r in [768usize, 1024, 1280, 1536, 2048] {
        let w = d.windows(5).count();
        let over = d.windows(5).filter(|x| x.iter().map(|g| g + 8).sum::<usize>() > r).count();
        println!("arena {r:>5} B: 5 consecutive ghosts do not fit in {over} of {w} windows ({:.3}%)", 100.0 * over as f64 / w as f64);
    }
}
