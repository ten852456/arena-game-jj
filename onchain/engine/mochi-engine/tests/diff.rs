//! Differential test: Rust engine vs the TS reference (engine/diff/gen.mts), compared at EVERY tick through a
//! running hash of the full integer state (same layout as combat.ts digestOf). Also checks winner and length,
//! and reports the largest stack sizes seen (to size the fixed capacities).
//! MOCHI_DIFF=<cases file> (default ../diff/cases-2k.txt)
use mochi_engine::combat::{Fighter, Probe};
use mochi_engine::data::{MAX_BONUS, MAX_RELICS};
use mochi_engine::types::{Bonus, Build, SkillInst, MAX_SKILLS};
use mochi_engine::simulate;

struct Hasher {
    h: u32,
    hashes: Vec<u32>,
    rows: Option<Vec<Vec<i64>>>,
    max_growth: usize,
    max_thorns: usize,
    max_burns: usize,
}

fn row_of(t: i64, f: &[Fighter; 2]) -> Vec<i64> {
    // same layout as combat.ts digestOf (sim v22): 44 fields per fighter, then 6 per block
    let mut row = vec![t];
    for x in f {
        row.extend_from_slice(&[
            x.hp, x.shield, x.frozen, x.frozen_total, x.slow_t, x.slow_p, x.slow_total, x.charge, x.charge_hits,
            x.growth.sum(), x.growth.len as i64, x.thorns.sum(), x.thorns.len as i64,
            x.burns.sum(), x.burns.len as i64, x.burns.left(), x.poisons.sum(), x.poisons.len as i64, x.poisons.left(),
            x.dodge, x.dodges, x.dealt_total, x.haste_p, x.haste_t, x.wound_p, x.wound_t, x.ult_done as i64,
            x.shield_got, x.hits_taken, x.line_casts, x.ctl_landed, x.big_hit, x.ult_until, x.freeze_n, x.delay_n, x.ctl_keep,
            x.ignore_freeze as i64, x.leech_next, x.thorns_heal, x.immune_until, x.last_fire,
            x.f_hits, x.f_counter, x.f_hits_taken, x.f_raged,
        ]);
        for b in &x.blocks[..x.nb] {
            row.extend_from_slice(&[b.prog, b.cd, b.trig_at, b.react_at, b.rr, b.fired]);
        }
    }
    row
}

impl Probe for Hasher {
    fn tick(&mut self, t: i64, f: &[Fighter; 2]) {
        let row = row_of(t, f);
        for &x in &row {
            self.h = (self.h ^ (x as u32)).wrapping_mul(16_777_619);
            self.h = (self.h ^ ((x >> 32) as u32)).wrapping_mul(16_777_619);
        }
        self.hashes.push(self.h);
        for x in f {
            self.max_growth = self.max_growth.max(x.growth.len);
            self.max_thorns = self.max_thorns.max(x.thorns.len);
            self.max_burns = self.max_burns.max(x.burns.len).max(x.poisons.len);
        }
        if let Some(r) = self.rows.as_mut() {
            r.push(row);
        }
    }
}

/// gen.mts enc (sim v22): hero, n, relic count, MAX_RELICS relics, then per slot id, v, mark, star, nb, bonuses
fn build_of(v: &[i64]) -> Build {
    let mut b = Build { hero: v[0] as u8, n: v[1] as u8, ..Build::default() };
    for i in 0..MAX_RELICS {
        b.relics[i] = v[3 + i] as u8;
    }
    let base = 3 + MAX_RELICS;
    let per = 5 + 2 * MAX_BONUS;
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

#[test]
fn rust_matches_ts_every_tick() {
    let path = std::env::var("MOCHI_DIFF").unwrap_or_else(|_| "../diff/cases-2k.txt".into());
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("read {path}: {e}"));
    let (mut ok, mut bad, mut ticks) = (0usize, 0usize, 0usize);
    let mut probe_max = (0, 0, 0);
    let mut failures = vec![];
    for (ci, line) in text.lines().enumerate() {
        let parts: Vec<&str> = line.split(" | ").collect();
        let head: Vec<i64> = parts[0].split(' ').map(|x| x.parse().unwrap()).collect();
        let a = build_of(&parts[1].split(' ').map(|x| x.parse().unwrap()).collect::<Vec<i64>>());
        let b = build_of(&parts[2].split(' ').map(|x| x.parse().unwrap()).collect::<Vec<i64>>());
        let want: Vec<u32> = parts[3].split(' ').map(|x| x.parse().unwrap()).collect();
        let (day, seed, winner, len) = (head[0] as usize, head[1] as u32, head[2], head[3]);
        let mut p = Hasher { h: 2_166_136_261, hashes: vec![], rows: None, max_growth: 0, max_thorns: 0, max_burns: 0 };
        let out = simulate(&a, &b, seed, day, &mut p);
        ticks += out.ticks as usize;
        probe_max = (probe_max.0.max(p.max_growth), probe_max.1.max(p.max_thorns), probe_max.2.max(p.max_burns));
        let first_bad = p.hashes.iter().zip(&want).position(|(x, y)| x != y);
        if first_bad.is_none() && p.hashes.len() == want.len() && out.winner as i64 == winner && out.ticks == len {
            ok += 1;
        } else {
            bad += 1;
            if failures.len() < 5 {
                let tick = first_bad.map(|i| i + 1).unwrap_or(want.len().min(p.hashes.len()) + 1);
                let mut p2 = Hasher { h: 2_166_136_261, hashes: vec![], rows: Some(vec![]), max_growth: 0, max_thorns: 0, max_burns: 0 };
                simulate(&a, &b, seed, day, &mut p2);
                let rows = p2.rows.unwrap();
                let show = |t: usize| rows.get(t.wrapping_sub(1)).map(|r| format!("{r:?}")).unwrap_or_default();
                failures.push(format!(
                    "case {ci} day {day}: first different tick {tick} (rust winner {} ticks {}, ts winner {winner} ticks {len})\n  rust t-1: {}\n  rust t  : {}",
                    out.winner, out.ticks, show(tick - 1), show(tick)
                ));
            }
        }
    }
    println!("{ok} equal, {bad} different, {ticks} ticks compared; max stacks growth {} thorns {} burns {}", probe_max.0, probe_max.1, probe_max.2);
    for f in &failures {
        println!("{f}");
    }
    assert_eq!(bad, 0, "Rust and TS differ");
}
