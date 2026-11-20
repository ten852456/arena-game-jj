# Run-end screen: research notes (Nov 2026)

How roguelites and auto-battlers end a run and set up "one more run", and what Mochi Moon took from it.
Hard numbers on run-end timings are rare in public sources: anything not backed by a link below is marked *(general knowledge)*.

## What the sources say

### 1. Celebration pacing
- One loud peak beats many small ones. Peggle's "Extreme Fever" win was made "as dramatic as possible" and kept "Ode to Joy" because testers loved it ([PC Gamer](https://www.pcgamer.com/the-making-of-peggle/2)).
- Staged reveals build anticipation. Hearthstone and Overwatch pack/box openings are paced so that each item lands on its own ([PC Gamer](https://www.pcgamer.com/behind-the-addictive-psychology-and-seductive-art-of-loot-boxes)).
- Juice makes games feel better ("Juice it or lose it", [GDC 2012](https://gdcvault.com/play/1016487/Juice-It-or-Lose)), but too much costs clarity ([GDC "Don't juice it or lose it"](https://gdcvault.com/play/1020861/Don-t-Juice-It-or)). Match the amount to the result.
- Count-ups of about 0.5–1.5 s, each tappable to skip; a fanfare plus particles on a win and a short, quiet ending on a loss *(general knowledge)*.

### 2. Near-miss framing
- A near-miss raises the urge to play again more than a plain loss does ([near-miss effect](https://en.wikipedia.org/wiki/Near-miss_effect)). In a Candy Crush study, near-misses were the most frustrating outcome and gave the strongest urge to keep playing ([PMC5445157](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5445157/)).
- Most of this evidence comes from gambling research. Only state true facts ("3 wins from the crown", "the winner had under 10% HP"). Never fake or inflate closeness.

### 3. Personal bests and records
- In 133 million chess games, players chased a new personal best and then often stopped soon after ([PMC5828569](https://pmc.ncbi.nlm.nih.gov/articles/PMC5828569)). Celebrate the record and offer a calm way out (profile, town). Don't push.
- Slay the Spire itemises its score (for example, points per elite), and players ask to see that breakdown ([wiki](https://slaythespire.wiki.gg/wiki/Score), [Steam](https://steamcommunity.com/app/646570/discussions/0/1694914736014793667)). Balatro's run stats (best hand, most-used jokers) are what players compare ([Steam](https://steamcommunity.com/app/2379780/discussions/0/4364626769118438446)).

### 4. Meta progress and the next milestone
- Clash Royale's Trophy Road shows "what you need to do to get that next reward" as a visible path ([Supercell](https://supercell.com/en/games/clashroyale/blog/release-notes/new-update-feature-enter-the-trophy-road)).
- Slay the Spire feeds score into unlocks, so even a lost run fills a bar ([wiki](https://slay-the-spire.fandom.com/wiki/Score)). Hades aims to "take the pain out of dying" so the time "wasn't a waste" ([Game Developer](https://gamedeveloper.com/design/how-supergiant-weaves-narrative-rewards-into-i-hades-i-cycle-of-perpetual-death)).

### 5. Unlock teases and the next goal
- The Bazaar pays out at fixed win counts, which gives every run a clear "next tier" ([Mobalytics](https://mobalytics.gg/the-bazaar/guides/beginner-guide)). Super Auto Pets adds secondary goals (a ribbon for a win with a level-3 pet) on top of plain wins ([wiki](https://superautopets.wiki.gg/wiki/The_Basics)). Hearthstone Arena always gives a reward floor ([Liquipedia](https://liquipedia.net/hearthstone/Arena)).

### 6. Share cards
- Wordle's share grid spread because it was spoiler-free and packed "a lot of drama into a small graph" ([Game Developer](https://www.gamedeveloper.com/marketing/josh-wardle-reflects-on-the-the-unconventional-road-to-wordle-s-success), [Smithsonian](https://www.smithsonianmag.com/smart-news/heres-why-the-word-game-wordle-went-viral-180979439/)). Balatro players share seeds so others can try the same run ([Steam](https://steamcommunity.com/app/2379780/discussions/0/4141690560293498846)).

### 7. Restart friction
- Dead Cells redesigned death "to eliminate downtime". Players accept a ~10 s wait after a good run but find it annoying after a quick death ([GameSkinny](https://www.gameskinny.com/opinion/what-makes-dead-cells-stand-out-from-other-roguelites/), [itch.io](https://itch.io/post/8797269)). Scale the ceremony to the result.
- Balatro players complain that "New Run" on the end screen is easy to hit by accident ([Steam](https://steamcommunity.com/app/2379780/discussions/0/596265621109362087)). Keep the restart button away from where people tap to skip.
- Vampire Survivors players are told to "wait for the results to tally" ([Steam](https://steamcommunity.com/app/1794680/discussions/0/3734079155585481570)). Save progress before you offer a restart.
- Typical games take 1–2 taps and under 5 s from the end screen to the next run *(general knowledge)*.

### 8. Tilt and tone
- Losing streaks drive players away, and losses demotivate ([EurekAlert / Management Science](https://www.eurekalert.org/news-releases/1130401), [Heliyon 2024](https://doaj.org/article/2c3b45519be74b72972980c47ee096d9)). TFT protects new players with no rating loss during placement games ([Riot](https://support-teamfighttactics.riotgames.com/hc/articles/360050552133)).
- Avoid dark patterns: fear of missing out, guilt and pay-to-skip ([darkpattern.games summary](https://gigazine.net/news/20251117-dark-pattern-game/)). On a loss, lead with what you kept (stardust, records) and give one concrete tip, with no "you failed" *(general knowledge)*.

## What Mochi Moon does now (applied)

| Pattern | On the run-end screen |
|---|---|
| Staged reveal, tap to skip | Banner, then the hero (crown drop on a win), then the 10 stars filling one at a time (each star a click with rising pitch), stats counting up, stardust counting into the total, record chips, then the buttons. Tap anywhere, or press Enter, Space or Esc, to skip. A re-render mid-reveal (reward arriving, language switch) carries on rather than restarting. |
| Scale ceremony to result | Win: about 2.9 s, with confetti, spotlight rays, crown, victory music, the `champion` sfx and voice. Loss: 1.3–1.9 s with no confetti and no extra sting. |
| Reward never blocks restart | The stardust reward is claimed in the background. Its `stardust` sound plays when the reveal shows it, or as soon as the server answers. |
| Honest near-miss | "Only 3 wins from the moon crown!" (3 or fewer to go). For a last fight the winner ended under 10% HP: "So close!". Otherwise "7 wins · 3 more for the crown". The text comes from real data only. |
| Records / personal bests | Kept on this device (`mochi.records.v1`, wrapped in try/catch) and fixed per run so a reload shows the same badges: first crown, first crown for a hero, first flawless 10–0, new best wins, longest win streak, biggest hit ever. On a loss without a new record, the screen shows "Your best: N wins". The server's best-wins number stops a false "new best" when the best was set on another device. |
| Meta bar and next milestone | Stardust total with a progress bar to the next cosmetic stardust title (Mochi Sprout, then Star Sprinkler, and so on up to Moon Legend; client-side names, no new server data). Example: "120 more stardust to «Night Lantern»". |
| Next goal | One line, picked from the data: beat your best; next win count, then the crown; a flawless crown; crown another hero; try an untried hero. |
| What ended it + one tip | The last fight's top reason from `explain()` and its "→ what to try" half, stored with the fight note in both languages. Example: "The shield of X blocked 41%" with "Try: a shield-piercing skill, or one big hit". |
| Instant restart | A big "Play again" button, which pulses gently after the reveal (Enter / R, focused when the reveal ends), goes to the hero pick. Under it, the next run's three offered heroes (the same `R.heroChoices(nextSeed)` the hero pick uses, so the rule holds) start a run in one tap. The heroes are tagged "again" (your hero, only if offered) or "new" (never played). Death to next run takes 1 tap. During the reveal the buttons are `visibility: hidden`, so a skip-tap can't hit them. |
| Share card | Win only: a 1200x675 PNG drawn on a canvas (hero with crown, stars, record line, build icons, name, date). It is shared with the Web Share API (files) where available and downloaded otherwise. A preview shows on the screen. |
| "Your build defends the moon" | True to the server: each day's build is saved as a snapshot that same-day players may be matched against. |
| Kind tone | Soft lines only: "No worries: the next one starts fresh", "Every run teaches something". There is no guilt, no timers and no FOMO. Profile and town stay one tap away for players who are done for now. |
| Reduced motion | No staged animation, confetti, rays or pulse. Everything shows at once. |
| Reload | A reload still lands in the town. If the finished run's end screen was never left, the arena card offers "Last run results", which shows the same records with no second reward claim. |

Not done, on purpose: a "same hero again" button outside the offered three (that would bypass the hero-offer rule), unlocks bought with stardust (no such system exists yet), and a replay/seed share code.
