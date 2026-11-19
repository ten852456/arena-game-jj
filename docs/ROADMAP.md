# Arena — Feature Phases & To-do

Source: vision doc (13 Nov 2026). Every item is checked against the 10 fixed principles (หลักที่ไม่เปลี่ยน).
Numbers are starting values to test with data. Status: `[x]` done · `[ ]` to do · `[~]` partly done.

**Pass test for every playable build:** after a run the player should say either
"อีกแค่รอบเดียวก็จะชนะแล้ว" or "build บ้าคลั่งมาก". If not, the build has not passed.

---

## Phase 0 — POC (done)

- [x] Deterministic combat `simulate(a, b, seed)`, 10 ticks/s, shared by server and browser
- [x] 4 heroes (one per archetype), 13 shared + 4 unique skills, Lv1–3, combo +20% per same-arch step
- [x] Run loop: 20 HP, HP lost = day number, 8 wins, streak bonus > comeback money, slots 3 → 6
- [x] Last chance (ตื่นพลัง / ตราวิญญาณ / เสบียงสุดท้าย)
- [x] Async PvP vs same-day saved builds, rating matchmaking ±200, AI fill labeled AI, replay link
- [x] Rule-based bot (AI opponents + balance script), determinism/balance/smoke scripts
- [x] Town hub with 7 landmarks (mostly "เร็วๆ นี้"), Phaser colosseum replay

---

## Phase 1 — Combat & Character complete ✔ (18 Nov 2026)

Goal: the fight is fair, readable and long enough for combos; heroes are data-driven and there are enough
of them to support daily rules and free rotation later.

> **Design change (17 Nov 2026):** the skill row and "order = combo" are replaced by a **skill grid**
> (inventory-style packing). This updates the vision's TCG section ("ลำดับของ skill คือ combo" →
> "การวาง skill คือ combo"); per principle 10, the vision doc should be updated to match.

### Grid & placement rules
- Skills are **blocks** with a shape (e.g. โจมตี 3×2, แช่แข็ง 1×2). The player packs them into a **grid**
  (starts small, grows with days like the old slots). Blocks can be rotated.
- Every skill runs its **own cooldown in parallel**; when ready it fires.
- **Connect bonuses (conditions):** each copy rolls 1–2 bonuses like "touching ทุบหนัก: +damage per hit" or
  "touching any control skill: fire it right away (⚡ trigger, its cooldown is not reset)". Any side counts.
  Effects: +damage per hit, +shield per fire, −20% cooldown, +25% power, trigger. Level-up adds one bonus (max 3).
- **Random per copy:** shape (from that skill's pool) and bonuses are rolled per shop offer from the run seed.
- **Look:** every skill has its own pattern; blocks carry no text (hover = name, effect, bonuses on/off; tap on mobile);
  blocks with an active bonus glow. Rotate with right-click, R, or the button. Backpack holds 6 unused skills.
- **Buff / debuff skills:** ขยายพลัง (double own buffs, capped), ชำระล้าง (remove one of each debuff on self),
  สลายเวท (remove one of each enemy buff). **Engines:** ฟันเฟือง (every 1s fires one touching skill, round-robin,
  its cooldown keeps running) and เร่งเครื่อง (fires every touching skill and restarts their cooldowns).
- **Levels & space:** skills go up to Lv5 (ตื่นพลัง still raises to Lv3). The shop also sells grid space
  (+1 column/row, 4 gold then +2 each time, max 8×6). "🏳 ยอมแพ้" (give up the run) sits in the top bar and during your own fights.
- **Readability:** live buff (gold) / debuff (red) chips under each HP bar; after every fight a per-skill table:
  own fires + triggered fires, damage and % of total, damage from connect bonuses, heal, shield, freeze time.
- Chains: A → B → C is allowed; each skill fires at most once per chain (no infinite loops); chain length shown as combo.
- Freeze pauses **all** of the target's cooldowns, with diminishing returns + a total-control cap per fight.

### Combat
- [x] **C1 Sim version** — `SIM_VERSION`; fights/replays store it; old-version replays say so instead of re-simulating wrong
- [x] **C2 Grid model** — shapes, rotation, placement validation, adjacency + link-edge resolution (pure, in `src/sim/`)
- [x] **C3 Parallel cooldown engine** — replace the cast queue with per-skill cooldowns; trigger chains via links;
  hooks (`onStart`, `onFire`, `onHit`, `onDamaged`, `onStatus`, `onTick`) so passives/daily rules plug in and `combat.ts` has no hero ids
- [x] **C4 Skill data** — every skill gets cooldown, shape pool, possible link bonuses; random roll is seeded (deterministic)
- [x] **C5 Fight length & control caps** — base HP by day (≈12s day 1–3, 20–30s day 8+); freeze/slow diminishing returns + cap
- [x] **C6 Fight explanation** — post-fight summary in Thai: damage by skill, chains fired, time frozen, biggest hit, "why you lost"
- [x] **C7 Grid UI** — drag/drop + rotate on mouse and touch, shows link edges lighting up when connected; replay highlights blocks as they fire and draws the chain
- [x] **C8 Bot packing** — AI/balance bot buys and packs blocks onto the grid (greedy: maximise active links)
- [x] **C9 Balance pass** — all archetype pairs ≤ 65% at day 5, 10, 13

### Character
- [x] **H1 Hero data** — `HeroDef` carries its passive as hook code + stat mods + Thai text; remove hard-coded checks
- [x] **H2 8 heroes** — 2 per archetype; the second one plays the same archetype a different way
  (vision: "เจอคู่ต่อสู้ใช้ฮีโร่ตัวที่เรามี แต่เล่นในแบบที่ไม่เคยคิด")
  - tank: อัศวิน (shield) + new: thorns/reflect tank
  - burst: นักฆ่า (charge/execute) + new: many fast hits
  - scaling: นักรบคลั่ง (growth) + new: burn stacking
  - control: แม่มดน้ำแข็ง (freeze) + new: slow / cast-delay
- [x] **H3 Hero art** — sprite per hero + idle / cast / hit / death animation in the replay
- [x] **H4 Hero pick** — each run offers 3 heroes (5 later with pass); หอฮีโร่ shows passive, unique skill, play style
- [x] **H5 Hero balance** — bot runs per hero: win-rate spread between heroes ≤ ~10 points; no hero > 50% of 8-win runs

### Tests / exit criteria
- [x] `npm test` determinism still OK with hooks + new skills
- [x] `npm run balance` prints archetype matrix **and** per-hero matrix; nothing > 65% (archetypes; hero pairs ≤ 70%)
- [x] Average fight length per day printed and inside targets
- [x] README updated
- [ ] Vision doc: "ลำดับของ skill คือ combo" → "การวาง skill คือ combo" (vision doc is outside the repo)

---

## Phase 1.5 — Grid playtest fixes (19 Nov 2026, grid sim v8)

Details and numbers: docs/SKILL_TREE.md.

- [x] **Control lock** — freeze/delay cap also grows with fight time (1s + 30%), frozen = can't be re-controlled,
  1.5s ตั้งหลัก immunity after a freeze ends / a delay lands, 4s without any fire = สลัดการคุม, ✨/🗿 blocks react
  instantly to control; engines, chain steps and echo carry control in proportion to their power
- [x] **Chains** — a block can be set off at most once per its own cooldown (3–6s); deeper chain steps ×0.75 each;
  ⚡ trigger rolls 18% (was 25%); gear skips blocks that can't be set off
- [x] **Fight stats** — `CombatResult.sides[side]`: casts, blocks that never fired, frozen / delayed / slowed ticks,
  total control, resists; `react` flag on cast events
- [x] **Run length** — 10 wins; defeat costs 2/3/4/5 HP by day (cap 5); START_HP 20
- [x] **Fight length** — HP by day retuned, fatigue at 14s / 20s / 28s; ≤ ~20% of fights reach fatigue
- [x] **Power curves** — burst early/mid, scaling mid–late, control late, tank steady/mid–late (docs/SKILL_TREE.md)
- [ ] Bot: place engines next to slow, heavy blocks and give trigger bonuses targets (bot.ts does not value engines)
- [ ] Balance harness: run bots beat the plain `aiBuild` pool ~60%, so "reach 10 wins" reads 47–63%; needs a
  stronger pool / tiers before the 15–45% target can be read from it
- [ ] UI: show "never fired" blocks and control time from `sides`; explain ตั้งหลัก / สลัดการคุม / react in the log;
  Thai texts still say 8 wins and "HP lost = day number" (townData.ts, tutorialSlides.ts, ui.ts hero pick line)

## Phase 2 — Server-authoritative run & guest accounts ← **NEXT**

- [ ] Run state lives on the server (shop rolls, gold, buys) — the client sends actions, not state
- [ ] Guest account (device id) → optional link login later; resume a run on any device
- [ ] Day timer (~70s) is soft: pause any time, continue later
- [ ] Owner notified when their saved build beats someone ("build ของคุณชนะ X")
- [ ] Full opponent build view after fight (exists) + "try this build" shortcut
- [ ] Analytics events: run start/end, day length, win/loss by day, quit points
- [ ] Database (move from `data/db.json` to SQLite/Postgres), build rating per saved build

Exit: run of 10–15 min measured on real devices; "lost first 3 days" group does not out-perform winners.

## Phase 3 — Daily rules & hero rotation

- [ ] Rule engine on top of the combat hooks (C2) + run hooks (income, shop, slots)
- [ ] 20–30 rules, calendar rotation, Thai text from the arena rulers ("คำสั่งตามอำเภอใจ")
- [ ] Builds only fight builds from the same rule day
- [ ] Free hero rotation 2–3/day; at least one fits today's rule (auto-check with bots)
- [ ] Bot sweep per rule: which archetype rises, nothing > 65%

## Phase 4 — Player bots (main differentiator)

- [ ] Rule editor (no code): archetype priority, gold to keep, take anti-control?, reroll limit, ordering style
- [ ] Rule slots: normal ~3, whale ~10 with conditions (more rules, not hidden smarts)
- [ ] Bot plays a whole run through the same API as players; result screen when you come back
- [ ] Quota: 2–3 bot runs/day from mined resources, 10–20 with bought resources
- [ ] Reward multiplier for bot runs (start 1); bot-run items account-bound (principle 5)
- [ ] Share: off by default; code/link with owner name + season tag; warning on old-season code
- [ ] Link opens the game with that bot ready (new player onboarding)
- [ ] Separate leaderboards: manual vs bot

## Phase 5 — Town & idle

- [ ] Heroes not in the arena go gathering (wood, ore, scarce goods) while offline
- [ ] Buildings + research; town never resets
- [ ] Resources → unlock heroes, make arena tickets, bot quota
- [ ] Wire the 7 landmarks that are "เร็วๆ นี้" today

## Phase 6 — Arena tiers & tickets ⚠ legal review first

- [ ] Arena tiers by roster size + rank; ticket entry; rewards by win count
- [ ] Equal ticket production per account per day; tickets expire per season
- [ ] Everyone gets the same number of choices inside arenas (principle 3)

## Phase 7 — Economy ⚠ decide "real money out" first

- [ ] Diamonds (buy only, game never pays out — principle 4)
- [ ] Monthly pass: 5 choices instead of 3 in normal mode, boxes, skins
- [ ] Skins, server-wide name/status, duplicate hero → cosmetic
- [ ] Marketplace: listings only, fee on every trade, history, account age/progress gate,
  unused heroes only and after tickets
- [ ] Whale perks: roster width, 2–3× gathering (not tickets), bot runs/rules, early season access

## Phase 8 — Seasons & live ops

- [ ] Balance patch flow: minor version bump, old replays tagged (uses C1)
- [ ] Season: name + theme, new heroes/skills, partial rank reset, ticket expiry
- [ ] Publish top-group bot rules at season end
- [ ] Leaderboards, season rewards that are width/speed/status, not combat power

## Phase 9 — Launch readiness

- [ ] Game name, ruler name, art style (open)
- [ ] Mobile performance, PWA, Thai-first text pass
- [ ] Anti-cheat / bot-farm limits, rate limits
- [ ] Creator tools: share replay + bot link ("เอา bot ของผมไปใช้ แล้วมาดูว่าของใครไปได้ไกลกว่า")

---

## Open decisions (from vision) and which phase they block

| Decision | Blocks |
|---|---|
| Real money out: diamonds non-withdrawable vs outside trading | Phase 7 (marketplace) |
| Legal review of tickets, rewards, randomness | Phase 6 |
| Game name, ruler name, art style | Phase 9 (H3 uses placeholder pixel art) |
| Pass extra choices: normal only, or low arenas too | Phase 7 |
| LLM bots later? | after Phase 4 |
| Launch hero count and shared skill count | Phase 1 proposes 8 heroes / ~16 shared skills |
