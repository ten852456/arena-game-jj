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

> **Design change (18 Nov 2026):** the skill grid (17 Nov) is removed. Skills are a **vertical list**; every skill
> runs its own cooldown **in parallel** and fires when ready. Skills do not connect or interact by position
> (no shapes, no connect bonuses, no chains, no engines). The grid version is kept on branch `phase1-combat-character`.
> Per principle 10, the vision doc's TCG section should say: skills fire on their own cooldowns, all at once
> (not "ลำดับของ skill คือ combo" and not "การวาง skill คือ combo").

### Skill list rules
- The build is a hero + a list of skills (top to bottom). All of them fight; the order only breaks ties (top fires first).
- **Slots:** 3 on days 1–3, 4 on days 4–6, 5 on days 7–9, 6 from day 10. The shop sells +1 slot
  (4 gold, then +2 each time, max 8 slots); เสบียงสุดท้าย also gives +1 slot. No backpack: sell a skill to free a slot.
- Every copy of a skill is the same; buying a skill you own levels it up (max Lv5; ตื่นพลัง raises to Lv3).
- **Look:** skills are shown as text (name, level, effect, cooldown); no icons or shapes. Hover / tap shows the details.
  The replay shows each side's list with a cooldown bar per skill that flashes when the skill fires.
- **Buff / debuff skills:** ขยายพลัง (double own buffs, capped), ชำระล้าง (remove debuffs on self),
  สลายเวท (remove one of each enemy buff, 20% of their shield).
- **Control caps:** freeze and cast delay share a cap per fight (3s / 5s / 7s by day) with diminishing returns;
  total slowed time is capped at twice that. ใจเหล็ก reduces control by 60%. *(Sim v10 adds immunity windows and
  reactions: see Phase 1.5.)*
- "🏳 ยอมแพ้" (give up the run) sits in the top bar and during your own fights.

### Combat
- [x] **C1 Sim version** — `SIM_VERSION`; fights/replays store it; old-version replays say so instead of re-simulating wrong
- [x] **C2 Grid model** — *(removed 18 Nov: replaced by the skill list)*
- [x] **C3 Parallel cooldown engine** — replace the cast queue with per-skill cooldowns;
  hooks (`onStart`, `onFire`, `onHit`, `onDamaged`, `onStatus`, `onTick`) so passives/daily rules plug in and `combat.ts` has no hero ids
- [x] **C4 Skill data** — every skill gets a cooldown; shop rolls are seeded (deterministic)
- [x] **C5 Fight length & control caps** — base HP by day (≈12s day 1–3, 20–30s day 8+); freeze/slow diminishing returns + cap
- [x] **C6 Fight explanation** — post-fight summary in Thai: damage by skill, skill fires, time controlled, biggest hit, "why you lost"
- [x] **C7 Skill list UI** — text-only vertical list, move up/down, sell, buy slot; replay cooldown bars per skill
- [x] **C8 Bot shop** — AI/balance bot fills free slots, buys a slot or swaps out its weakest skill when full
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
- [ ] Vision doc: TCG section → "skills fire on their own cooldowns, all at once" (vision doc is outside the repo)

---

## Phase 1.5 — Playtest fixes (19 Nov 2026, sim v10)

- [x] **Control lock** — freeze/delay cap also grows with fight time, frozen = can't be re-controlled, 1.5s ตั้งหลัก immunity
  after a freeze ends / a delay lands, 4s without any fire = shake off control, ✨/🗿 skills react instantly to control
- [x] **Chains** — a skill can be set off (ต่อ) at most once per its cooldown (2–4s); deeper chain steps ×0.75 each
- [x] **Engine skills** — ฟันเฟือง (fires above/below in turns) and เร่งเครื่อง (fires both, restarts their cooldowns), Lv1→3 trees
- [x] **Fight stats** — `CombatResult.sides[side]`: casts, skills that never fired, frozen / delayed / slowed ticks, total control, resists
- [x] **Run length** — 10 wins; defeat costs 2/3/4/5 HP by day (cap 5)
- [x] **Power curves** — heroes peak at different days (burst early, control/tank mid, scaling late): see docs/SKILL_TREE.md
- [x] **Auto-tuner (sim v11)** — `npm run tune`: CMA-ES over 54 knobs in `src/sim/tuning.ts` towards per-hero power
  curves, reach-10 15–45%, no hard counters, healthy fights; watch-build penalties for exploits (docs/TUNING.md).
  First pass + exploit-report fixes applied: 12 → 7 sim targets missed. Open: day-15 burst vs scaling, day-3 pairs
  (see SKILL_TREE.md "Sim v11")
- [ ] Bot: place engines next to slow heavy skills (bot.ts `arrangeList` does not know engines yet)
- [ ] UI: show "never fired" skills and control time from `sides`; explain ตั้งหลัก / สลัดการคุม / react in the log

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

## Phase 5 — Town & idle (design draft: `docs/FARM.md`)

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
- [ ] Monthly pass: 5 choices instead of 3 in normal mode, skins, faster egg hatching (never eggs or boxes: owner 2026-11-26, see docs/FARM.md)
- [ ] Skins, server-wide name/status, duplicate hero → cosmetic
- [ ] Marketplace: listings only, fee on every trade, history, account age/progress gate,
  unused heroes only and after tickets
- [ ] Whale perks: roster width, bot runs/rules, early season access (no paid gathering boost: owner 2026-11-26, see docs/FARM.md)

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
