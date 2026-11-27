**Run flow**

1. Choose one of three offered heroes; start day 1 with 16 run HP and a target of 10 wins.
2. Get 7 gold and five random shop offers. Buy skills, reroll for 1 gold, or lock offers for later.
3. Start with three skill slots. A new slot arrives on days 4, 7 and 10; extra slots cost 4 gold, then 6, and so on, up to eight.
4. New skills cost 3 gold; upgrades cost 4 then 5, with hero uniques costing one more. Choose an upgrade branch; level 3 opens on day 4.
5. Order skills to activate rolled bonuses when their required neighbor is present. Skills fire automatically on their own cooldowns.
6. Fight a same-day saved build within rating windows, or an AI fallback. A win advances the target; a loss costs 2 HP through day 4, then 3. A draw costs no HP but gives no win.
7. From day 2, base daily income rises from 6 to 8 gold. Win streaks add up to 3; a loss streak adds 1.
8. Before the shop on days 2, 4 and 6, choose one of three random relics, reroll once for free, or skip. From day 7, level-3 skills can gain stars.
9. Three hero-line skills unlock ultimate level 1; four, including three at level 3, unlock level 2. An ultimate cannot fire before six seconds.
10. On the first lethal run loss, return at 1 HP and choose random-branch awakenings, a mark, or gold and a slot. A later lethal loss ends the run. Moon wishes can also randomly upgrade skills or, once all are level 3, add limited random marks.

**Five strongest parts**

1. **The run has a clear arc.** Early purchases, relic days, ultimate thresholds and stars provide successive goals.
2. **The shop creates real opportunity costs.** A reroll, upgrade, new skill and slot all compete for the same gold; locking preserves a future plan.
3. **Adjacency gives the list agency.** Reordering can improve a build without spending gold, and trigger links create satisfying engines.
4. **Last chance creates a story.** The player gets a consequential comeback decision rather than an immediate end.
5. **Async opponents fit short sessions.** Same-day matching, rating windows and AI fallback keep fights available without a live queue.

**Five biggest risks to fun and retention**

1. **Relics can feel like dead choices.** `RELIC_LUCK = false`, `RELIC_OFFER = 3` in [relics.ts](C:/Users/Tenny/orca/workspaces/arena-game-jj/dogfish/src/sim/relics.ts:26): even with one reroll, six candidates may offer little to an existing build. This is a risk, not a measured frequency.
2. **The system strongly funnels players into their hero line.** `LINE_WEIGHT = 2` in [run.ts](C:/Users/Tenny/orca/workspaces/arena-game-jj/dogfish/src/sim/run.ts:28), line mastery in [tuning.ts](C:/Users/Tenny/orca/workspaces/arena-game-jj/dogfish/src/sim/tuning.ts:139), and ultimate thresholds in [heroes.ts](C:/Users/Tenny/orca/workspaces/arena-game-jj/dogfish/src/sim/heroes.ts:107) all reward the same direction. Hybrid builds may feel like self-sabotage; this does not prove the meta is solved.
3. **Wins can compound early luck.** [run.ts](C:/Users/Tenny/orca/workspaces/arena-game-jj/dogfish/src/sim/run.ts:188) gives streaking winners up to 3 extra gold versus 1 on a loss streak. That can widen a shop advantage just when the losing player needs a recovery.
4. **Too many overlapping rules obscure why a build works.** Branches, stars, relics, marks, ultimates and adjacency stack; [links.ts](C:/Users/Tenny/orca/workspaces/arena-game-jj/dogfish/src/sim/links.ts:13) alone has five bonus types and skill-or-line conditions. The burden is especially high when effects trigger during automatic combat.
5. **Late progress may feel granular.** In [tuning.ts](C:/Users/Tenny/orca/workspaces/arena-game-jj/dogfish/src/sim/tuning.ts:149), each ordinary star adds 8% power, while the more distinctive echo arrives at three stars. Several purchases may feel incremental before the payoff.

**Changes, ranked by impact and effort**

1. **High impact / low effort:** Guarantee one broadly useful or build-relevant relic among each offer, retaining the other random options and free reroll.
2. **High / medium:** Give hybrid builds a competing milestone—such as a two-line bonus—then test its strength against ultimate progression.
3. **High / low:** Test a smaller streak-income gap, such as capping the win bonus at 2. Compare comeback and win-rate distributions before adopting it.
4. **Medium / medium:** After each fight, surface the two or three biggest contributors and whether adjacency, relics and the ultimate actually activated.
5. **Medium / low:** Test a more noticeable first-star effect while reducing later star scaling to preserve total power. Measure whether late shops produce more interesting choices.
