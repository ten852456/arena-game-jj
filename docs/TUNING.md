# Balance auto-tuner (`npm run tune`)

A CPU-only tool (no LLM, no network) that turns a curated set of balance knobs towards the design and can write the
result back into the code. Design goal from the product owner: **variety and distinct power curves, not equal win
rates**. Heroes should be strong at different moments; no hero dead or must-pick; no hard counters.

```
npm run tune                          # search ≈25 min on 12 cores, progress saved to scripts/tune/state.json
npm run tune -- --budget 10           # minutes for the search (the final check runs after it)
npm run tune -- --resume              # continue the saved search (same knob list)
npm run tune -- --apply               # search, then write the best values into src/sim/tuning.ts
npm run tune -- --resume --gens 0 --apply   # apply the best of a saved search without searching more
npm run tune -- --dry                 # never write, just print what would change
npm run tune -- --eval                # only measure the current values (curves, reach-10, pairs, health)
npm run tune -- --eval --set "cd.pyro=0.8,hp.pyro=1.1|run.startHp=18"   # measure hand-made variants side by side
npm run tune -- --set "cd.pyro=0.8"   # start the search from a hand-made point
```

Options: `--seed 1`, `--days 3,6,9,12,15` (days whose curves are scored), `--lambda 12` (candidates per generation),
`--sigma 0.12` (start step, share of each knob's range), `--gens N`, `--state FILE`, `--workers N`, `--no-prune`.

After `--apply`: bump `SIM_VERSION` in `src/sim/combat.ts`, run `npm test` and `npm run sim -- all --compare <old.json>`,
update the "Sim vN" section of docs/SKILL_TREE.md.

## Where the numbers live

`src/sim/tuning.ts` holds every knob value between `// <tuned>` markers (`--apply` only rewrites numbers there).
The rest of the sim reads it:

| file | reads |
|---|---|
| `skills.ts` | the literals in `BASE_LIST` are the base numbers (sim v10). The live `SKILL_LIST` = base × multipliers: hits / shields / heals / burns / charge × `arch.<arch>.lv1/lv3` (shared skills) or `uniq.<hero>.lv1/lv3` (hero-unique), Lv2 = halfway; freeze / slow / delay seconds × `control`; engine power × `engine`; hero-unique cooldowns × `cd.<hero>`. Integers stay integers (rounded), so the UI shows the real numbers. |
| `heroes.ts` | `hp.<hero>` (max HP multiplier) and the passive values (`knight.shield`, `assassin.first`, `duelist.third`, `berserker.hits`, `pyro.burn`, `witch.freeze`). Passive texts are built from them. |
| `combat.ts` | `hp.early/mid/late` (× base HP on days 1–3 / 4–7 / 8+, fatigue damage follows), `chainDecay` |
| `run.ts` | `run.startHp`, `run.lossEvery` (HP lost per defeat = min(5, 1 + ceil(day / lossEvery))) |

With every value at its v10 number the sim reproduced v10 exactly (identical `npm run sim` JSON, `npm test` OK).

## Knobs (`scripts/tune/knobs.ts`)

54 knobs, each with bounds (about ±25%) and a rounding step, so applied values stay readable:

| group | knobs | bounds |
|---|---|---|
| run | `run.startHp`, `run.lossEvery` | 16–22, 2–4 (integers) |
| fight length | `hp.early`, `hp.mid`, `hp.late` | 0.85–1.25 |
| rules (numbers only) | `chainDecay`, `engine`, `control` | 0.6–0.85, 0.8–1.2, 0.8–1.2 |
| shared skills per archetype | `arch.{tank,burst,scaling,control}.{lv1,lv3}` | 0.8–1.25 |
| hero-unique skill | `uniq.<hero>.{lv1,lv3}` | Lv1 0.75–1.4, Lv3 0.75–1.35 |
| hero-unique cooldown | `cd.<hero>` | 0.8–1.2 |
| hero HP | `hp.<hero>` | current ±0.15 |
| passives | `knight.shield`, `assassin.first`, `duelist.third`, `berserker.hits`, `pyro.burn`, `witch.freeze` | see file |

Lv1 / Lv3 multipliers and unique cooldowns are the main curve shapers. Careful: bots pour gold into their hero-unique
skill, so it is often already Lv3 on day 3 (`uniq.<hero>.lv1` barely matters there; `cd.<hero>` does: a 6 s cooldown
barely fires in an 8 s day-3 fight). Cooldown effects are not monotone (a slower ทุบน้ำแข็ง made the witch much
stronger early). Try hand-made variants with `--eval --set` when a hero is far off.
To add a knob: add the key to `tuning.ts` (value = current number), read it where the number is used (proving the
sim JSON is unchanged), then add a line to `KNOBS`. A saved search with a different knob list cannot be resumed.

## Objective (`scripts/tune/evaluate.ts`, lower is better)

Measured with the simulator jobs (`scripts/sim/jobs.ts`: matchup builds, matchups, bot runs, length sweep) on a
persistent worker pool (`scripts/tune/pool.ts`; each task carries its knob values, workers switch with `setTuning`).

| term | what | weight |
|---|---|---|
| curve | each hero's win rate vs the field on each scanned day must be inside its band (curve center ±5 pts); squared points outside | 1 |
| reach | reach-10 rate per hero inside 17–43% (targets 15–45%), and the mean of all heroes within 30 ± 5% (not bunched at an edge) | 1 |
| pair | every hero pair ≤ 72% + ½ standard error of its sample (target 75%), squared points over, all pairs all days | 2 |
| arch | worst archetype pair per day ≤ 73% | 3 |
| zero | 0-skill sides over days 1–15 ≤ 3% | 5 |
| fatigue | fatigue-ended fights ≤ 18% per day | 2 |
| length | average fight length per day inside `lengthTarget` (squared seconds outside) | 30 |
| watch | each watch build's win rate vs the field ≤ its max (see below) | 5 |
| dist | Σ (Δ knob / knob range)² — prefer small changes | 25 |

The limits are a little inside the real targets so noise does not carry a candidate over them.

### Power curves (`scripts/tune/curves.ts`)

From docs/SKILL_TREE.md "Intended power curves". Shapes (win % on days 3 / 6 / 9 / 12 / 15, centered per day so the
eight heroes average 50):

| shape | d3 | d6 | d9 | d12 | d15 | heroes |
|---|---|---|---|---|---|---|
| early | 57 | 56 | 52 | 46 | 42 | นักดาบคู่ duelist, แม่มดน้ำแข็ง witch |
| earlyMid | 52 | 57 | 55 | 47 | 42 | นักฆ่า assassin |
| midLate | 45 | 48 | 53 | 55 | 55 | จอมเวทเวลา chrono, นักรบหนาม thornguard |
| steadyLate | 48 | 49 | 50 | 53 | 57 | อัศวิน knight |
| late | 43 | 45 | 48 | 54 | 60 | นักรบคลั่ง berserker, นักเวทเพลิง pyro |

Change a hero's intended curve by editing `HERO_CURVE` / `SHAPES`, then rerun.

### Watch builds (`scripts/tune/watch.ts`) — penalising a specific exploit

When an exploit finder reports a build or pattern that is too strong, add it to `WATCH`:

```ts
{ name: 'gear sandwich', days: [9, 12, 15], max: 0.7,
  build: { hero: 'duelist', skills: [{ id: 'heavy', v: 'a1' }, { id: 'gear', v: 'a1' }, { id: 'flurry', v: 'a1' }] } },
```

`build` can also be a function of the day. The build fights the tuner's matchup builds of every hero on each listed
day (both sides); every point of win rate above `max` costs `WATCH_WEIGHT` (5) × points². The report prints each
watch build's win rate. Then `npm run tune -- --apply`.

## Optimizer

Separable CMA-ES (`scripts/tune/cma.ts`) in the knobs' unit cube (one learned step size per knob), λ = 12 candidates +
the search mean per generation, start step 0.12 of each range. Every knob value is rounded to its step before it is
measured, so what is measured is exactly what `--apply` writes.

- **Coarse evaluation** (every candidate): 12 builds per hero per scanned day (all hero pairs, both sides), 40 bot runs
  per hero (opponent pool of 16 per day), 40 random fights per day for days 1–15. All candidates of a generation use
  the same seed (common random numbers); the seed changes every generation.
- **Confirmation** (the generation's best and the mean): 32 builds, 100 runs, 80 fights per day, on one fixed seed for
  the whole search, so confirmed scores compare across generations. The best confirmed candidate is the result.
- **Final check**: baseline and best on fresh seeds (80 builds, 200 runs, 200 fights per day); nothing is applied when
  the best is not better than the current values there.
- **Prune**: for every changed knob, the best is measured with only that knob put back; knobs that cost < 1% to put
  back are put back together (fewer if that costs too much). Keeps the applied change small and readable.
- Progress (CMA state, best, history) is saved to the state file after every generation; `--resume` continues it.

## Known limits

- The tuner's runs use an opponent pool of 16 (sim: 24), and its reach-10 rates read ≈ 5 points lower than
  `npm run sim`. Check reach with the sim before shipping.
- Coarse scores are noisy (12 builds per hero): a generation's best is often luck, which is why only confirmed scores
  count and the mean is re-centred when it drifts. Prefer two short runs (`--set` the first one's best as the start of
  the second, smaller `--sigma`) over one long one.
- The exploit finder (`npm run exploit`) optimises builds; the tuner measures bot builds. Use `WATCH` to carry an
  exploit into the tuner, and re-run the exploit finder after applying.

## Sim v11 (first applied pass, 19 Nov 2026)

Two 25-minute searches (the second from a hand fix for pyro's day 3: `cd.pyro` 0.8), prune, then a few hand-checked
`--eval --set` variants for reach-10 and day 15, plus the exploit-report fixes in the base numbers (overclock power,
ระเบิดลุกลาม, ฟันพายุ, แทงทะลุ, fast gears, POWER_BONUS). Fresh-seed tuner score 5543 → ≈1400; sim targets missed 12 → 7.
Values and curves: docs/SKILL_TREE.md "Sim v11". Sim report of v11: `scripts/tune/after-v11.json`
(`npm run sim -- all --days 3,6,9,12,15 --compare scripts/tune/after-v11.json`).

Timing on 12 cores: one generation ≈ 45–90 s (depends on other load on the machine), so the default 25-minute budget
is ≈ 18–25 generations, then prune and the final check (≈ 4 min, reserved inside the budget). `--resume` first
re-scores the saved base and best (the objective may have changed since the save).
For a bigger change, run `--resume` again (each run adds generations).

## Sim v12 (8 lines + ultimates) changes to the tuner

- Days scored: `3,5,10,13` (the matchup days of `npm run sim`); every hero's curve is **flat 50%** (owner target:
  every hero 45–55% on each of those days), band ±4.
- New objective terms: `beats` (each of the 16 designed counter pairs in `scripts/sim/targets.ts` `BEATS`, averaged over
  the days, outside 54–57% costs points²) and `ult` (fire rate below the target + 3 points, median fire time outside
  43–67% of the fight).
- Knobs: `arch.<archetype>.*` became `line.<line>.lv1/lv3` (8 lines, range 0.7–1.4); new `duelist.counter`,
  `thornguard.poison`, `poison.heal` and per-hero `ult.<hero>.trig` / `ult.<hero>.pow`.
- `dist` weight 25 → 5: the v12 redesign needed bigger moves than a nudge.
