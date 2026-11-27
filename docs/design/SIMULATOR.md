# Balance simulator (`npm run sim`)

A CLI that answers balance questions in seconds: bots build, fight and play whole runs on every CPU core, and the
report ends with a ✔/✘ list of the balance targets. Same seed + same code → the same numbers (on any machine and with
any number of workers), so two reports can be diffed.

```
npm run sim                                   # = all, n 200, days 3,5,10,13, normal bots (~20 s on 12 cores)
npm run sim -- matchups --n 300               # only matchups + fight length / health
npm run sim -- runs --tier mix                # whole runs, bots of mixed difficulty
npm run sim -- lines --n 100                  # in-line vs off-line builds, ult value, day-1 openings
npm run sim -- all --json before.json         # save a machine-readable report
# ... change numbers in combat.ts / skills.ts ...
npm run sim -- all --json after.json --compare before.json   # print what moved
npm run sim -- all --strict                   # exit 1 when a target is missed (CI)
```

A baseline from the code this tool was written on is kept in `tools/sim/baseline.json`
(`npm run sim -- all --compare tools/sim/baseline.json`).

## Modes

| mode | what it does |
|---|---|
| `matchups` | Per day in `--days`: `n` bot builds per hero, every hero vs every hero (2 opponents × both sides each, like `npm run balance`). Prints the **line × line matrix** per day (by hero main line; `*` marks a designed counter pair "row beats column"), each hero's overall win rate per day, the share of its fights where it cast **no skill**, and every hero pair over 75%. Then the **counter web** (each of the 16 designed "beats" pairs per day and averaged), the **ultimates** table and a **fight length & health** table for days 1–13 (max(300, 2n) random fights per day). `--full` also prints the full hero × hero matrices. |
| `runs` | Bots play whole runs through the run API (shop → fight → result, day by day, last chance and marks included, like `tools/runs.ts`) against a same-day pool of `--pool` bot builds (pool slot *i* is "the same opponent" on every day). Per hero: share of all 8-win runs, reach-8 rate, avg wins, avg days. Also: how often a run meets one opponent ≥ 3 times, how often a lost run lost twice to the same opponent / mostly to one opponent, and health numbers of all run fights. With `--tier mix` it also prints reach-8 by the runner's tier. |
| `skills` | From the same bot runs, per skill: how many 8-win runs owned it at the end (pick in 8-win), how many runs owned it at all, the fight win rate of run builds that had it, and its average share of its side's damage. Hero-unique skills (`*`) use only that hero's runs. |
| `tiers` | Bot difficulty check: for each day in `--days`, `n` random hero pairs per tier pair (hard vs normal, normal vs easy, hard vs easy), both sides. Prints win rates per day and on average, and the average unspent gold, skill count and summed skill levels of each tier's builds. |
| `lines` | Does following the hero's line pay off? (sim v13) Per hero per day in `--days`: `n` **in-line** bot builds (prefer the hero's line, as usual) vs `n` **off-line** builds of the same hero (bot rule `avoid`: never buys a skill of the hero's line or its unique, so it picks the best generic skills by numbers). Bots are `normal` (`--tier hard` for numbers-aware bots). Prints in-line vs off-line head to head, both vs random normal bots of the day, the **ult value** (in-line builds with an unlocked ult vs the pool, with the ult and with it locked via `simulate(..., { noUlt })`, by ult level), the skills off-line / in-line builds own (Lv2+ keep the branch letter, e.g. `strike-b`), and **day 1**: every affordable opening (2 cards, ≤ 7 gold) of each hero's fixed day-1 shop vs random day-1 bots (easy / normal), best and worst. |
| `all` | All five (runs and skills share one simulation). |

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

## Lines report targets (sim v13)

| target | value |
|---|---|
| in-line beats off-line (average of days ≥ 5) | ≥ 55% |
| ult worth (with − locked, every hero, Lv1 and Lv2) | ≤ 15 pts |
| best day-1 opening of every hero vs normal day-1 bots | 50–70% |

`runs` also prints the **ult unlock day** per hero: median (p25–p75) first day the run's build had ult Lv1 / Lv2, and the share of runs that never got there.

## Counter web (sim v12, 8 lines)

`BEATS` in `tools/sim/targets.ts` is the designed web from docs/design/DESIGN_LINES_ULT.md §3 (each line beats 2, loses to
2). The table prints the win rate of the row line vs the column line for every designed pair on every matchup day and
the average; the target is 53–58% on the average (a soft counter, not a lock). Bots prefer only their hero's line, so a
hero's builds are close to "pure line" builds and the matrix is a line-vs-line measurement.

## Ultimates table

Per hero, from the matchup builds of every day in `--days`:

| column | meaning |
|---|---|
| unl dN | share of that day's bot builds with the ultimate unlocked (3+ pieces = Lv1) |
| Lv2 dN | share with 5+ pieces (Lv2) |
| fire% | fights where the ultimate fired / fights where it was unlocked (all days) |
| at(med) | median fire tick / fight length |
| win unl/locked | win rate of fights with the ult unlocked vs locked (locked is usually only early days) |

Targets: fire% ≥ 75% (นักฆ่า / นักรบคลั่ง ≥ 50%, their ults are a finisher and a last stand), median fire time 40–70%.

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
| ult1+ / ult2 / fire% | sides of random bot builds (random heroes, normal tier) with the ult unlocked at Lv1+ / Lv2 = the **ult unlock rate by day**, and the fire rate of those |

## Targets

| target | limit |
|---|---|
| line vs line (each day) | ≤ 75% |
| hero vs hero pair (each day) | ≤ 75% |
| hero spread, best − worst overall (each day) | ≤ 30 points |
| every hero's overall win rate (each matchup day) | 45–55% |
| designed counter pairs (average over the days) | 53–58% each |
| ultimate fire rate when unlocked | ≥ 75% (นักฆ่า, นักรบคลั่ง ≥ 50%) |
| ultimate median fire time | 40–70% of the fight |
| fight length in target | every day 1–13 |
| fatigue-ended | ≤ 20% every day |
| 0-skill sides | ≤ 3% over days 1–13 |
| 8-win rate spread between heroes (runs) | ≤ 10 points; no hero > 50% of all 8-win runs |
| tiers: hard > normal and normal > easy | ≥ 55% on average and ≥ 50% on every day |

Limits live in `tools/sim/targets.ts`. `lengthTarget` there is a copy of the one in `tools/balance.ts`
(importing balance.ts would run it); keep them in sync.

## Bot tiers (`src/sim/bot.ts`)

`aiBuild(hero, day, prefer, seed, tier = 'normal')`, `randomAiBuild(day, seed, tier = 'normal')`, `type BotTier`,
`botRules(prefer, tier)` and `botDay(state, rules)` (shop + sort the list, for bots that play real runs).

- **easy** — no rerolls, noisy picks, undervalues upgrades, never makes room for a new skill, at most 1 purchase a day on
  days 1–3 and 2 later; 70% of easy bots leave one slot empty and skip upgrades on days 1–3. Keeps its list in buy order.
- **normal** — line + hero preferences (`prefer` is a list of lines), 2 rerolls a day, sorts the list for connect
  bonuses, +1 for its line's skills while the ultimate is locked and for Lv3 upgrades of line skills until ult Lv2.
- **hard** — scores offers by their numbers per gold (damage, shield, heal, burn, control per second of cooldown; Lv2
  variants also count what their Lv3 children would be worth for this build, finishing a branch is worth more than
  spreading gold), counts connect bonuses a new skill would switch on, buys toward the ultimate (its line's skills while
  locked, Lv3 on line skills until Lv2), likes its line's tech skill from day 3, buys anti-control when its line has no
  anti-control skill of its own (skills whose Lv1 has a `cleanse` or `steadfast` effect, read from `skills.ts`), buys
  slots from day 3 and rerolls up to 8 times so little gold is left over.
- **every tier** owns at least one damage skill whose cooldown is ≤ 5 s (`isEarlyHitter`), bought first and never sold,
  so no AI build is left without a skill that fires early. It picks the hitter it likes most (its line / unique), the
  cheaper one on a tie.

## How it works

`tools/sim.ts` (CLI and report) splits the work into jobs (`tools/sim/jobs.ts`), each a pure function of its seeded
input, and runs them on a `worker_threads` pool (`tools/sim/pool.ts`; tsx loads TypeScript in the workers). Results
are merged in job order, so the report does not depend on the number of workers. Per-fight facts are read from the
combat result (`tools/sim/metrics.ts`): cast events (incl. trigger `from`), fatigue events, per-block `d` and `fz`
stats, and the HP snapshot of the last event.
