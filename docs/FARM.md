# Farm (idle town) — design draft

Status: **design agreed with the owner topic by topic (2026-11-26); not built yet.** Where an older section and a
"(owner, 2026-11-26)" section disagree, the owner section wins. ROADMAP Phase 5.
Numbers are starting values to tune, not decisions. The code will own them (`src/sim/farm.ts`, like `tuning.ts`).

## Sources and owner choices

- Vision (13 Nov), "เมืองและตัวที่ว่าง": heroes not in the arena go gathering; resources build the town, unlock heroes,
  make arena tickets and bot quota; the town never resets. "ตั๋วและ arena": **every account makes the same number of
  tickets per day**; tickets expire each season; inside the arena everyone has the same number of choices.
  Hero library = width (more choice), never power; 2–3 free rotating heroes every day.
- JJ doc (18 Nov): heroes on landmarks (lumber, mine, shrine), ~8 h timers, account-bound resources, ticket craft cap
  4 a day. The USDC ticket market is **not now** (19 Nov overview, FACTS).
- Owner, 2026-11-26: resources buy **arena tickets, hero unlocks and town upgrades**; **real 8 h** with a debug flag
  to shorten; **any hero not in a run** can work; design doc before code.

## The loop

```
 arena run ──► ผงดาว (stardust, by wins — exists today)
     ▲                    │
     │ ticket             ▼
  craft ◄── wood / ore ◄── heroes working at the lumber yard / mine (8 h, offline)
     │                    ▲
     └─ unlock hero ──► more heroes can work and be picked
        upgrade town ─► more work slots, bigger storage
```

Why a player opens the game: collect twice a day (morning / night), spend, then play the runs they have.

## Pieces

### 1. Jobs (the idle part)

- Landmarks with jobs: **ลานตัดไม้ (lumber) → ไม้ wood**, **เหมือง (mine) → แร่ ore**, **ศาลเจ้า (shrine, new) →
  คริสตัล crystal** (owner 2026-11-26). หอเวท (research) and ตลาด (market) stay "soon".
- Send a hero to a landmark slot. It produces **continuously**; the landmark's storage fills in **8 h** and then stops.
  Collect any time (partial collects are fine), so a late player loses nothing until storage is full.
- Production is deterministic (no RNG): rate × time, capped by storage. Crystal = 1 per full 8 h shift at the shrine.
- **Line affinity** (+25% at the matching landmark, owner 2026-11-26): lumber = hit, dodge, wind · mine = shield,
  ice, gold · shrine = heal, time · tower research speed = burn, poison.
- Which heroes: **any hero you can use that is not in an unfinished run**. Starting a run with a working hero recalls
  it (it keeps what it already made). A hero in a run cannot be sent to work.

| | Lumber Lv1 | Mine Lv1 |
|---|---|---|
| Slots | 1 | 1 |
| Rate per hero | 6 wood/h | 4 ore/h |
| Storage | 8 h of output | 8 h of output + crystal |

### 2. Arena tickets

- **3 free runs a day** (reset 00:00 Asia/Bangkok). A run is spent when its day-1 fight is fought (the server first
  sees the run then).
- More runs need a **ticket**, crafted at the arena gate: **30 wood + 20 ore**. Craft cap **4 a day** for every
  account (vision: same ticket output per account), so the most anyone plays is 7 runs a day.
- Tickets are account-bound and **expire at the end of the season**. No trading now (market is "soon").
- The guided tutorial run is always free.

### 3. Hero unlocks

- New player owns **4 starter heroes: knight, assassin, pyro, duelist** (owner 2026-11-26; berserker sims low at 34%).
- **Free rotation: 2 heroes a day**, drawn by VRF from the committed season seed, favouring heroes the player does
  not own (try before unlock), at least one fits today's rule (owner 2026-11-26).
- The hero pick at run start offers 3 from *owned ∪ today's rotation*; working heroes are included (picking one recalls it).
- Unlock a hero for good: **300 ผงดาว + 3 crystal** (≈ 8–10 runs and 3 mine shifts). This gives ผงดาว its first use.
- Same hero = same strength for everyone. Owning more = more choice and more workers, never stronger fights.

### 4. Town upgrades

| Level | Cost | Slots | Storage |
|---|---|---|---|
| Lv1 | — | 1 | 8 h |
| Lv2 | 100 wood + 60 ore | 2 | 10 h |
| Lv3 | 250 wood + 150 ore + 2 crystal | 3 | 12 h |

The town never resets (seasons do not touch buildings or owned heroes; tickets do expire).

## Fit with the 10 principles

- No paid combat power, same hero = same strength: nothing in the Farm touches fights. ✔
- Arena tickets: equal craft cap per account; runs themselves are unchanged. ✔
- **Risk**: a run limit fights the target feeling "so close, one more run". 3 free + up to 4 crafted should cover
  normal play; we watch /admin runs-per-player before and after. If it hurts, raise the free runs first.

## Server (MVP, off-chain, like the rest of the live build)

- State on the player (server time is the only clock):
  `farm: { v, owned: string[], res: { wood, ore, crystal }, tickets, ticketsMadeDay, freeRunsDay, freeRunsUsed,
  buildings: { lumber: { lv, jobs: [{ hero, since, collectedUntil }] }, mine: {…} } }`
- Endpoints: `GET /api/farm`, `POST /api/farm/send`, `/recall`, `/collect`, `/craft`, `/upgrade`, `/unlock`.
  All take `playerId`; the server computes output from `Date.now()`; nothing the client says about time counts.
- `/api/fight` day 1 of a new run: check the hero is owned or in rotation, then spend a free run or a ticket
  (409 `no runs left`). Recall the hero from its job.
- Debug: `FARM_TIME_SCALE` env (e.g. `60` = an 8 h shift takes 8 min). Off in production.
- Abuse: player ids are free, but everything is account-bound, so alt accounts cannot feed a main. Rate-limit the
  farm endpoints with the shared limiter. Add checks to `scripts/security-check.ts` (clock, double collect, caps).
- Existing playtesters: own all 10 heroes (grandfathered), so the live game does not suddenly shrink for them.

## Onchain (MagicBlock ER) — cost and architecture

From the 2026-11-26 research (MagicBlock fee docs checked 2026-11; `origin/engine-v12` program read).
[V] = verified from docs/code, [I] = inference. Re-check the fee schedule before mainnet (it has changed before).

**What it costs** ([V] https://docs.magicblock.gg/pages/overview/additional-information/pricing.md,
…/ephemeral-rollups-ers/introduction/fees-and-commit-economics.md):
- Transactions **inside the ER: 0**. Private ER (TEE) uses the same pricing; VRF inside the ER is free.
- Session fee **0.003 SOL per delegated account** per delegation (taken at undelegate). First commit free; without a
  delegated fee payer commits stop working after 10; with one, 25 free then 0.001 SOL/account/commit.
- Base-layer tx 5,000 lamports. The season `Player` account (1,688 B) rents ≈ 0.0126 SOL (refundable on close).
- So a naive all-base-layer farm (~16 tx/day) is only ≈ $0.34/player/season [I] — fees are not what kills us. The
  ER wins because it is **0 per action, no wallet pop-ups (session key), and atomic with `begin_run`**.

**Recommended design [I]:**
1. **No new account.** Put a packed `FarmBlock` (~70 B: owned-heroes bitmask u16, wood/ore u32, crystal u16,
   tickets u8, day counters, building levels, 6 job slots `{hero u8, since u32}`) inside the existing per-season
   `Player` PDA, which is already delegated to the TEE for the whole season. A separate Town PDA would cost another
   0.003 SOL session fee every season and a cross-account ticket check.
2. **Lazy production, no cranks:** `made = rate × (min(now, since + storage) − since) × affinity`; collect adds it
   and resets `since`. `now` = ER `Clock`. Day key = `(now + 7 h) / 86400` (Bangkok midnight).
3. **One tx per visit:** `farm_batch(ops)` like the existing `act_batch` (3-byte ops: send, recall, collect, craft,
   upgrade, unlock; ≤ 32; all-or-nothing). Signed by the session key; add it to the session-key allowlist.
4. **Ticket spend inside `begin_run`** — the gate and the run are one instruction, nothing to race.
5. **Commits:** only the free season-end commit + undelegate (as today), plus at most 1–2 safety commits mid-season
   so a TEE fault cannot lose a whole season (still inside the free window).
6. **Town carries over:** `finalize_player` keeps `FarmBlock`; next season's `init_player` reads last season's
   finalized `Player`, copies the town, expires tickets, and closes the old account in the same tx (its 0.0126 SOL
   rent pays for the new one).
7. **Who pays:** session key pays (0) on the ER; owner pays setup and the rollover once a season. Gasless onboarding
   later = a relayer funds ~0.003 SOL/player/season.
8. Do **not** use compressed accounts (cannot be delegated to the ER; only worth it for many accounts per player).

Risks: ER clock is the validator's (cap elapsed time at storage, already in the design); TEE access needs an auth
token and is IP-geofenced; forgetting to close old accounts locks ~0.0126 SOL/player/season.
Order: server MVP first (live build is off-chain) → `FarmBlock` + `farm_batch` + ticket gate on `engine-v12` →
season carry-over → relayer.

## Review 2026-11-26 — what the research found wrong with this draft

Simulated flow from the numbers above (casual = 2 collects/day):

| Resource | Problem |
|---|---|
| Wood / ore | Upgrades are one-off (350 wood + 210 ore total). A casual player hits Lv3 on ~day 3–4; after that **~72% of output has no use**, and a player who only plays the 3 free runs uses 0%. "Storage full" stops meaning anything. |
| Crystal | 6–9/day at Lv3, needed only 18 total for 6 unlocks. Never the limit. |
| Stardust | 1,800 total sink, gone in ~7–18 days; grandfathered players have no use for it from day 1. |
| Tickets | Cap limits **crafting**, not holding: 10 days × 4 = a 40-ticket binge. "Max 7 runs/day" is false. |
| Sybils | Every new id gets 3 free runs; alts get leaderboard rows. The farm is safe (account-bound); **the prize pool and leaderboard are the target**. |
| Day 1 | First collect is hours away, so the farm gives nothing in the most important session. |

Lesson from Axie/StepN/Pixels/Sunflower Land: the economies that died made a sellable currency with one sink that
never renewed; the ones that lived moved soft currency off-chain, gated withdrawal by reputation, and kept sinks
renewing. **Our risk is the opposite of inflation: dead resources and a boring loop.**

### Proposals (not decided — owner to choose)

**Resources (keep it small: 4 + tickets; one landmark = one resource, each with a different main use)**

| Resource | Source | Spent on | Season |
|---|---|---|---|
| ผงดาว stardust | arena wins | hero unlocks, tower research, cosmetics | keeps |
| ไม้ wood | lumber yard | tickets, upgrades, season project | keeps |
| แร่ ore | mine | tickets, upgrades, season project | keeps |
| คริสตัล crystal | **shrine** (new, 1 per full shift; moved off the mine) | unlocks, Lv3+, research | keeps |
| ticket / tower key / raid ticket | crafted at the arena gate | extra runs, later tower/raid | **expires** |

Never an onchain token for the four town resources (Pixels' BERRY lesson). Only tickets might ever trade.

**Line affinity (+25%, flavour; covers all 10 lines):** lumber = hit, dodge, wind · mine = shield, ice, gold ·
shrine = heal, time · tower (research speed) = burn, poison.

**Sinks that renew every season**
- Season town project: everyone pours wood + ore into a shared monument; contributors get the season cosmetic.
- Tower research (stardust + crystal, timed queue): width only — work slots, storage, rotation preview, cosmetics.
- Raid tickets / tower keys from wood + ore when those modes ship.
- Fixed-price cosmetic recipes (crystal + stardust); Lv4+ upgrades (~600 wood / 400 ore).

**Caps:** hold at most ~8 tickets; warehouse cap ~2 days of output.

**Sybil defence around prizes, not the farm:** prize/leaderboard eligibility needs wallet or email link + 7-day
account + N runs; rank on the first N runs of each day; keep same-IP players apart in matchmaking.

**Day 1:** a 5-minute first shift and a cheap Lv2 so the town pays back in the first session.

**Seasons:** 6 weeks (two 3-week halves), a named ruler + one new hero or skill line. Town, heroes, resources,
cosmetics carry over; tickets expire; rating partial reset. Commit a hash of the rule calendar + rotation seed at
season start; publish results + a real-run meta table in the season-end Merkle root (`engine-v12` already does the
top-16 + reward root). Daily rule and rotation from VRF.

**Hero tiers:** no rarity (players read "rare" as "strong"). Every hero costs the same to unlock; new heroes get a
"New" tag. Show a **meta tier list from real runs** (clear %, pick %, sample) after 200+ runs, refreshed weekly,
labelled as data. Rotation favours heroes the player does not own (try before unlock), one fits today's rule.
Starters near the median clear rate (sim: berserker is low at 34% — consider duelist).

**Eggs (เปิดไข่สุ่ม)** — only inside these rules: earned by play only, never sold/in a pass/traded, odds shown
before hatching, no duplicates, fixed pity, VRF roll, hatch speed ignores any paid perk, no combat contents.
- *Shift egg:* from 3 and 10 win runs; sits in a town nest and hatches after N hero work-hours (like Pokémon GO
  distance); cosmetic looks / emotes / frames; rare variant guaranteed by the 10th egg.
- *Hero egg:* one per season milestone; pick 1 of 2 heroes you do not own (alternative to stardust, never the only way).
- *Season egg:* one per player who played N runs; everyone hatches it on season-end day from the VRF result.
- Selling eggs (cash, diamonds, paid pass) = a paid loot box → breaks FACTS "Never" (and is illegal for minors
  in Brazil from 2026, treated as gambling in BE/NL). ROADMAP Phase 7 "Monthly pass: … boxes" and the "2–3×
  gathering" whale perk conflict with this and need rewording.

## Client

- Town: lumber yard and mine turn `open`; their card shows slots, working heroes (chibi working animation),
  a fill bar, Collect, Send hero, Upgrade.
- Top bar: wood / ore / crystal / tickets / free runs left.
- Hero pick: locked heroes greyed with their unlock cost; rotation heroes tagged "ฟรีวันนี้".
- A "storage full" marker on the town map so the reason to come back is visible.

## Decided (owner, 2026-11-26)

1. A working hero **can** appear in the hero pick; picking it recalls it (it keeps what it made).
2. Free runs: **3 a day, reset at midnight** (Asia/Bangkok).
3. **No refund** for a short run (0–2 wins).
4. Current players are **grandfathered with all 10 heroes**; new players start with 4.

### Tower supplies (owner, 2026-11-26)

Farm resources become **supplies for the Endless Tower** (HP carries between floors, floors carry debuffs).
- Supplies only **remove harm, never add stats**, and only act **between floors**, never inside a fight.
- **Supply slots per climb (owner, 2026-11-26, replaces "3 for everyone"):** start **1** → **2** after a town
  upgrade (earned by play) → **3** with the battle pass. The **prize board counts at most 2 supplies for everyone**:
  a climb that used the pass slot still earns normal Tower rewards and progress, but its board entry is the floor
  reached with ≤ 2 supplies. So whales get a visible gap, while the USDC prizes stay free of paid power
  (FACTS "Never" list holds). A casual player can fill 2 slots every day, so resources buy *more stocked climbs*.
- Effects (all four chosen): **ration** (wood) heal carried HP up to max · **repair kit** (ore) one extra life on a
  lost floor, so a sealed card keeps going · **cleanse charm** (crystal) remove one debuff from the next floor ·
  **reroll** (cost open) swap the next floor's debuff for a random one (VRF, a gamble).
- **One prize board**, ranked by floor reached (with ≤ 2 supplies, see above); supplies used shown as a badge.
  Open detail: how the board scores a pass climb that used slot 3 — floor reached before the 3rd supply was used.
- This is the main renewing sink for wood/ore/crystal (fixes the "dead resources after day 4" finding).

### Season monument (owner, 2026-11-26)

At season end the world is threatened; everyone pours resources into the city hall / monument to save it.
- **Multiplier = a fading head start**: up to +30% farm output in the first 2 weeks of next season, falling to 0.
  Veterans start ahead, new players catch up by mid-season. Supplies and tickets stay capped, so it never buys
  Tower or arena power.
- **Diminishing scaling**: boost ∝ √contribution (10× resources ≈ 3× boost).
- Status that lasts: name on the monument (onchain at season end), title, frame.
- **Goal missed = calamity, not a wipe**: some buildings start next season damaged (lower output) until repaired
  with resources. Nobody loses heroes or levels. Repairs are one more renewing sink.
- **No paid gathering boost**: the ROADMAP Phase 7 whale perk "2–3× gathering" is removed, so contribution and the
  multiplier can never be bought.

### Eggs (owner, 2026-11-26)

- Build **only the work egg** for now (hero egg and season egg are not chosen).
- Work egg: earned from 3-win and 10-win runs; sits in a town nest and hatches after N hero work-hours; contents are
  cosmetics only (hero looks, emotes, frames); odds shown before hatching; no duplicates; rare variant guaranteed
  by the 10th egg (pity); roll by VRF onchain.
- **Never sold, never given by the pass.** The battle pass only **hatches faster** (or an extra nest slot); the egg
  and its odds are the same for everyone. So it is not a paid loot box and the FACTS "Never" list holds.
- **Never tradable**: eggs and hatched cosmetics are account-bound.
- ROADMAP Phase 7 "Monthly pass: … boxes" must not mean eggs/boxes in the pass (reworded).

### Resources (owner, 2026-11-26)

- **4 resources + tickets**: stardust (arena), wood (lumber), ore (mine), crystal (**new shrine**). One landmark
  makes one resource. Never onchain tokens; account-bound.
- Affinity map above (+25%).
- **Battle pass: +1 town work slot.** Whales produce more, so they build the town and the monument faster (and get a
  bigger, still √-scaled, next-season head start). Supplies and tickets stay capped, so this is not combat power.

### Heroes (owner, 2026-11-26)

- Starters knight, assassin, pyro, duelist; daily VRF rotation favouring unowned heroes.
- **No rarity**: every hero costs the same to unlock; new heroes get a "New" tag.
- **Tier list from real runs** (clear %, pick %, sample size), shown once a hero has 200+ runs, refreshed weekly,
  labelled as data, not power.
- Whale gap: the pass gives 5 hero choices instead of 3 (ROADMAP Phase 7).

### Seasons (owner, 2026-11-26)

- **6 weeks**, two 3-week halves; a named arena ruler and one new hero or skill line per season; a fresh daily-rule
  set and a small milestone reward at the half.
- Carries over: town, heroes, resources, cosmetics, monument names. Resets: tickets expire, season board clears,
  **rating partial reset** (pulled toward the middle, order kept).
- **Monument open all season**; the goal is checked at season end; the last week shows a countdown and a threat event.
- Onchain: commit a hash of the rule calendar + rotation seed at season start; at season end one Merkle root with
  results, the real-run tier table and monument names (extends `engine-v12`'s season-end root).

### Onchain and review fixes (owner, 2026-11-26)

- Onchain: **`FarmBlock` inside the season `Player` PDA**, `farm_batch` (one tx per visit), ticket spend inside
  `begin_run` (see "Onchain (MagicBlock ER)" above).
- Adopted: **hold at most ~8 tickets** (craft cap 4/day stays) · **sybil gate on prizes** (wallet or email link +
  7-day account + N runs for prize/board eligibility; same-IP players kept apart in matchmaking) · **day-1 hook**
  (a 5-minute first shift and a cheap Lv2) · **warehouse cap ~2 days of output** (upgrades raise it).
- Build order: **server MVP first** (jobs, collect, tickets, unlocks, upgrades, `FARM_TIME_SCALE`) → Tower
  supplies, work egg, monument → port to `engine-v12`.

## Built (2026-11-26, server + client MVP)

Code: `src/sim/farm.ts` (rules and numbers), `src/server/farm.ts` (API, arena gate), `src/client/farmUI.ts` (town
cards). Checks: `scripts/farm-check.ts` (in `npm test`), `scripts/farm-api-check.ts` (`npm run farm-api`, against a
server with `FARM_TIME_SCALE=3600`). Not built yet: Tower supplies (no Tower), tower research, market, the pass
itself (`pass` flag exists), VRF (server randomness for now).

**Numbers changed after the engagement research (fair, not punishing; sources in the research notes):**
- Storage 12 / 14 / 16 / 20 / 24 h by level (8 h lost a third of a 2-collects-a-day player's output at night).
- Crystal 1 per 12 h (one per collect). Warehouse 3 days of output (covers a weekend).
- Free runs: 3 a day, **unused ones bank up to 6** (a missed day is not lost; owner had chosen "reset at midnight",
  banking is the softer version of it).
- Upgrades Lv2 60w+40o (paid by the 5-minute first shift) · Lv3 250/150/2c · Lv4 1200/800/6c · Lv5 3000/2000/15c.
- Work egg: 48 work-hours (3 wins), 120 (10 wins); nest holds 4, one incubates; the pass hatches 1.5× faster.
- Stamp card: 7 days by total days played (never consecutive), starts with 2 stamps; full card = 2 crystal + 24 egg hours.
- New players: output ×2 on day 0 fading to ×1 over 7 days.
- Monument: goal = 2,500 points × players who poured at least 300; starts 20% filled (the ruler's gift);
  bronze / silver / gold at 100 / 130 / 160%; contributors (≥ 300) are never hit by the calamity.

**Security review fixes:** the per-IP new-town limit also guards the day-1 fight path; a player counts toward the
monument goal only past the personal minimum (fake ids cannot raise it); towns have a hard cap and the least
valuable go first.

## RMT and bots (research 2026-11-26, owner: tolerate RMT, fight bots with detection)

Research recommendation (not decided): everything stays account-bound inside the game and account/wallet sales
are tolerated (not policed); later an **official market for cosmetics only** with a 5–10% fee as a sink. Never
tradable: wood, ore, crystal, stardust, supplies, heroes, tickets (a ticket is a board attempt). Lessons: Diablo 3
auction house removed (trading became the game), Axie SLP collapse, Pixels ~40% bots, Lost Ark false bans.
Bots: log per-action timing (+ hashed IP/device), nightly scores (collect regularity, no-sleep, no input,
account clusters), shadow-flag at 50 (off prize boards and the ghost pool), human review at 80, ban waves every
2–3 weeks and before payouts, 72 h payout hold, appeals. Prize guardrails: board counts the first N runs a day,
rented builds never count, payout wallet fixed for the season.
Conflict to settle: eggs and hatched cosmetics are "never tradable" today; a cosmetics market would change that.

## Playtest round 2 (owner, 2026-11-26)

Owner played the first build: the side-scrolling town was inconvenient and confusing, the farm needed something
random to talk about, and the arena should be free. Three research passes (layout UX, community RNG, casual vs
ranked) and a mockup (claude.ai artifact "Mochi Moon town hub redesign"); owner decisions:
- **Top-down town** (owner chose it over the one-screen side-view hub): a 3/4 top-down ground map with 8 plots,
  every landmark on one screen, no scrolling (`src/client/townScene.ts`, art `town-ground.webp` + `td-*.webp`
  made with Codex). Ready bubbles over producers (tap = collect), worker counts, egg and unlock badges, tap the
  arena = battle. One-tap row in the panel: Collect all, Fill jobs (best free slot per idle hero), BATTLE.
- **Casual free + Ranked ticket.** Casual: free, unlimited, stardust ×0.5 (×0.25 after 3 a day), an egg and a
  ticket for the first 10-win casual run of a day, off the leaderboard. Ranked: 1 ticket per run, 1 free ticket a
  day (bank 3), crafted tickets (30 wood + 20 ore, 4 a day, hold 8), 7+ wins refunds the ticket, stardust ×1.2,
  eggs at 3 and 10 wins, the leaderboard and prizes. A tutorial run is always casual. Casual and Ranked share one
  ghost pool (few players).
- **Lucky finds** while working: one roll per hero-hour at collect time, 24 rolls a day; Moon Pearl 1/400 (mine,
  lumber), Shrine Relic Shard 1/600 (shrine), Golden Moon Pearl 1/8000; pour into the monument for points.
  **Moonlit (shiny) heroes**: 1/1024 per run, 5 rolls a day (casual is free). Both go to the **town feed**
  (`GET /api/feed`, "world first" per season).
- **Trading later:** new finds (pearls, shiny looks) may become tradable with a 7-day lock; egg cosmetics,
  resources, tickets and heroes stay account-bound.
- Not built yet: hero pets, Moon Rain event, collection log page, crafting cosmetics from finds, shiny glow in
  the fight scene (only a toast and the Hero Hall list now), separate season rating.

## Incremental layer (owner adopted all recommendations, 2026-11-26)

Plan + formulas + growth chart: claude.ai doc "Mochi Moon idle town: summary and incremental plan". Design meeting
(auto-battler, idle, economy; Codex code review + genre and economy research): doc "Mochi Moon design meeting".
- Endless building levels past Lv5: cost C(n) = 400 x 1.13^(n-6); output x(1 + 0.15 (n-5)) x 2^floor((n-5)/10);
  slots and storage stay capped. About 13 h of one full landmark per level at Lv5, 22-26 h past Lv50.
- Worker mastery per hero and landmark, 1-99, +1% output per level; RuneScape XP curve / 10, 100 XP per work-hour.
- Magic Tower research (stardust + crystal): storage, nest slot, job auto-refill, warehouse. No auto-collect.
- Moon Festival: voluntary, from average Lv10; resets levels above Lv5 and stockpiled wood/ore for
  Moonlight = floor(sqrt(R_earned / 10000)), +2% output each for the season; converts to monument points at season end.
- Build order: endless levels + mastery (with a 6-week farm sim), then Tower research, then the festival.
- Open (meeting decisions): pass-slot output out of the monument and 5 picks Casual-only; season-end auto-pour above
  the warehouse cap; layer gating; relic offers with one fitting slot + a free daily reroll; mint/burn ledger in /admin.

## Open questions

1. Bot quota (vision: resources also pay for bot runs) — later, when bots ship.
2. Numbers to tune in code: rates, costs, reroll supply cost, egg hatch hours, monument goal size, Lv4+ costs.
3. How the Tower board scores a pass climb that used slot 3 (proposal: floor reached before the 3rd supply).
