# Balance simulator (`npm run sim`)

A CLI that answers balance questions in seconds: bots build, fight and play whole runs on every CPU core, and the
report ends with a ✔/✘ list of the balance targets. Same seed + same code → the same numbers (on any machine and with
any number of workers), so two reports can be diffed.

```
npm run sim                                   # = all, n 200, days 3,5,10,13, normal bots (~20 s on 12 cores)
npm run sim -- matchups --n 300               # only matchups + fight length / health
npm run sim -- runs --tier mix                # whole runs, bots of mixed difficulty
npm run sim -- all --json before.json         # save a machine-readable report
# ... change numbers in combat.ts / skills.ts ...
npm run sim -- all --json after.json --compare before.json   # print what moved
npm run sim -- all --strict                   # exit 1 when a target is missed (CI)
```

A baseline from the code this tool was written on is kept in `scripts/sim/baseline.json`
(`npm run sim -- all --compare scripts/sim/baseline.json`).

## Modes

| mode | what it does |
|---|---|
| `matchups` | Per day in `--days`: `n` bot builds per hero, every hero vs every hero (2 opponents × both sides each, like `npm run balance`). Prints the archetype matrix per day, each hero's overall win rate per day, the share of its fights where it cast **no skill**, and every hero pair over 70%. Then a **fight length & health** table for days 1–13 (max(300, 2n) random fights per day). `--full` also prints the full hero × hero matrices. |
| `runs` | Bots play whole runs through the run API (shop → fight → result, day by day, last chance and marks included, like `scripts/runs.ts`) against a same-day pool of `--pool` bot builds (pool slot *i* is "the same opponent" on every day). Per hero: share of all 8-win runs, reach-8 rate, avg wins, avg days. Also: how often a run meets one opponent ≥ 3 times, how often a lost run lost twice to the same opponent / mostly to one opponent, and health numbers of all run fights. With `--tier mix` it also prints reach-8 by the runner's tier. |
| `skills` | From the same bot runs, per skill: how many 8-win runs owned it at the end (pick in 8-win), how many runs owned it at all, the fight win rate of run builds that had it, and its average share of its side's damage. Hero-unique skills (`*`) use only that hero's runs. |
| `tiers` | Bot difficulty check: for each day in `--days`, `n` random hero pairs per tier pair (hard vs normal, normal vs easy, hard vs easy), both sides. Prints win rates per day and on average, and the average unspent gold, skill count and summed skill levels of each tier's builds. |
| `all` | All four (runs and skills share one simulation). |

## Options

| option | default | meaning |
|---|---|---|
| `--n` | 200 | builds per hero (matchups), runs per hero (runs/skills), fights per tier pair per day (tiers) |
| `--days` | 3,5,10,13 | days for matchups and tiers |
| `--tier` | normal | bot tier for matchup builds, the length sweep, the run bots and their opponent pool: `easy`, `normal`, `hard` or `mix` (each bot rolls its own tier from its seed) |
| `--seed` | 1 | changes every build, shop and fight; same seed → same report |
| `--pool` | 24 | opponent pool size per day in runs |
| `--workers` | all cores | worker threads (`0` = run inline, for debugging) |
| `--json FILE` | | write the report as JSON (no timestamps, so it diffs cleanly) |
| `--compare FILE` | | print what changed vs an earlier `--json` report: rates that moved ≥ 2 points, other numbers ≥ 5%, the 50 biggest (all with `--full`), and targets that flipped ✔/✘. Warns when n / tier / seed / sim version differ. |
| `--strict` | | exit code 1 when any target is missed |
| `--full` | | full hero × hero matrices, and no row limit in `--compare` |

## Health metrics (fight length & health table)

| column | meaning |
|---|---|
| avg / p10 / p90 | fight length in seconds; target per day from `lengthTarget` (7–13 s days 1–3, 10–18 s days 4–7, 15–26 s day 8+) |
| fatigue | share of fights that reached fatigue (target ≤ 20% on every day) |
| 0-skill | share of fighter-sides that cast **nothing** in the fight — control lock or killed before the first cooldown (target ≤ 3%) |
| locked | share of sides that spent ≥ 25% of the fight frozen or cast-delayed |
| ctl/side, ctlmax | freeze + cast-delay ticks a side received (from the per-block `fz` stat): average and the worst single fight |
| close | share of decided fights the winner ended at ≤ 10% HP |
| trig/f, chain | casts set off by trigger connect bonuses per fight; the biggest trigger chain in one tick |

## Targets

| target | limit |
|---|---|
| archetype vs archetype (each day) | ≤ 65% |
| hero vs hero pair (each day) | ≤ 70% |
| hero spread, best − worst overall (each day) | ≤ 15 points |
| fight length in target | every day 1–13 |
| fatigue-ended | ≤ 20% every day |
| 0-skill sides | ≤ 3% over days 1–13 |
| 8-win rate spread between heroes (runs) | ≤ 10 points; no hero > 50% of all 8-win runs |
| tiers: hard > normal and normal > easy | ≥ 55% on average and ≥ 50% on every day |

Limits live in `scripts/sim/targets.ts`. `lengthTarget` there is a copy of the one in `scripts/balance.ts`
(importing balance.ts would run it); keep them in sync.

## Bot tiers (`src/sim/bot.ts`)

`aiBuild(hero, day, prefer, seed, tier = 'normal')`, `randomAiBuild(day, seed, tier = 'normal')`, `type BotTier`,
`botRules(prefer, tier)` and `botDay(state, rules)` (shop + sort the list, for bots that play real runs).

- **easy** — no rerolls, noisy picks, undervalues upgrades, never makes room for a new skill, at most 1 purchase a day on
  days 1–3 and 2 later; 70% of easy bots leave one slot empty and skip upgrades on days 1–3. Keeps its list in buy order.
- **normal** — the original bot (archetype + hero preferences, 2 rerolls a day, sorts the list for connect bonuses).
- **hard** — scores offers by their numbers per gold (damage, shield, heal, burn, control per second of cooldown; Lv2
  variants also count what their Lv3 children would be worth for this build, finishing a branch is worth more than
  spreading gold), counts connect bonuses a new skill would switch on, buys anti-control when its archetype has no
  anti-control skill of its own (skills whose Lv1 has a `cleanse` or `steadfast` effect, read from `skills.ts`), buys
  slots from day 3 and rerolls up to 8 times so little gold is left over.
- **every tier** owns at least one damage skill whose cooldown is ≤ 5 s (`isEarlyHitter`), bought first and never sold,
  so no AI build is left without a skill that fires early.

## How it works

`scripts/sim.ts` (CLI and report) splits the work into jobs (`scripts/sim/jobs.ts`), each a pure function of its seeded
input, and runs them on a `worker_threads` pool (`scripts/sim/pool.ts`; tsx loads TypeScript in the workers). Results
are merged in job order, so the report does not depend on the number of workers. Per-fight facts are read from the
combat result (`scripts/sim/metrics.ts`): cast events (incl. trigger `from`), fatigue events, per-block `d` and `fz`
stats, and the HP snapshot of the last event.
