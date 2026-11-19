# Skill grid — combat rules & power curves (grid sim v8, 19 Nov 2026)

Live numbers are in `src/sim/skills.ts`, `heroes.ts`, `combat.ts`, `run.ts`. This page explains the rules that
the numbers follow and the power curve each hero is meant to have. It is the grid version of the list branch's
"Sim v10" pass (`mochi-list-v2`), adapted to blocks that touch on any side.

## Why this pass

Grid play-tests (19 Nov) showed whole fights where one side fired 0 skills (frozen all fight, 2 vs 283 damage)
while the other side made 27 chains, and cleanse never got to fire.

## Control rules (no more 0-skill fights)

These apply to every source: a block's own cooldown, trigger chains and engines.

| Rule | Value |
|---|---|
| Freeze + cast delay share one cap per fight | `freezeCap` (2s / 4.5s / 6s by day) **and** at most 1s + 30% of the time fought so far |
| Already frozen | cannot be frozen or delayed again (counts as resisted) |
| ตั้งหลัก (regroup) | when a freeze ends (or is cleansed) or a delay lands: freeze and delay are resisted for 1.5s |
| สลัดการคุม (shake off) | a fighter that has not fired any block for 4s drops freeze / slow and resists all control until it fires |
| Slow | own cap (1.75 × freeze cap, also growing with the fight: 2s + 60% of the time fought) |
| ✨ / 🗿 react | a block with ชำระ or ใจเหล็ก fires **right away** when ≥0.5s of control (or a ≥30% slow) lands on its owner, at most once per its cooldown (its cooldown restarts). ใจเหล็ก also shortens a freeze already on you |
| Weaker fires carry weaker control | fires below 100% power (engines, deeper chain steps, ตีซ้ำ echo) freeze / slow / delay for that share; ขยาย's cap also scales |

Bot fights where a side fires 0 skills: 0–2% per day (all in very short day 1–3 fights, none from control).
Average control received per side: 0.2s (days 1–3), ~0.9s (4–7), ~1.7s (8+); max 6s.

## Chains ("ต่อ")

- A block set off by another block (trigger bonus or engine) cannot be set off again for **its own cooldown,
  at least 3s and at most 6s**.
- Chain step 2 fires at ×0.75, step 3 at ×0.56 … (step 1 = full power). Each block still fires once per chain.
- ⚡ trigger is now the rarest connect bonus (18% of rolls, was 25%).
- ฟันเฟือง takes turns over the blocks it touches but skips the ones that cannot be set off right now.
  เร่งเครื่อง restarts a neighbour's cooldown only when it actually fires it.
- Set-off fires per side per fight (random bot builds): avg 0.1 (days 1–3), 0.6–2 (4–7), 4–10 (8–15).
  Worst side in 3000 late fights: 37 (was 87, and up to 128 in hero matchups). p99 at day 15: ~29.

## Fight length

| Days | HP base | Avg fight | Target | Fatigue starts | Fights reaching fatigue |
|---|---|---|---|---|---|
| 1–3 | 16 / 18 / 21 | 9.5–10s | 7–13s | 14s | 9–12% |
| 4–7 | 58 / 68 / 90 / 112 | 13.7–14.4s | 10–18s | 20s (was 17–23s) | 11–18% |
| 8+ | 235 / 265 / 310 / 360 / 405 / 455 (+60/day) | 19.8–20.5s | 15–26s | 28s (was 25–30s) | 12–19% |

## Run: 10 wins

- `WIN_TARGET` 10. HP lost per defeat = 2 (days 1–3), 3 (4–6), 4 (7–9), 5 from day 10 (cap). `START_HP` stays 20.
- At a 50% fight win rate a run reaches 10 wins ~23% of the time; at 55% ~36%; at 45% ~12% (simulated).
  That is the 15–45% band for real players fighting same-day builds.
- In the bot harness (`npm run runs` style: a run bot vs a pool of plain `aiBuild` bots) the run bot wins ~60%
  of its fights, so heroes reach 10 wins in 47–63% of bot runs (won runs end around day 13–14 with ~3.6 losses).
  Lowering START_HP to fit that harness would make the real game far too harsh, so it stays 20; the harness pool
  should be made stronger (sim tiers) before reading absolute reach rates. Spread between heroes: 16 points.

## Intended power curves (who is strong when)

Overall win rate vs the other 7 heroes, hero bot builds, 40 builds per hero, 5120 fights per day:

| Hero | Curve | d3 | d6 | d9 | d12 | d15 |
|---|---|---|---|---|---|---|
| นักดาบคู่ duelist | **early** burst, fades late | 64 | 56 | 49 | 45 | 40 |
| นักฆ่า assassin | **mid** burst peak (day 5–7), fades late | 42 | 64 | 48 | 48 | 36 |
| แม่มดน้ำแข็ง witch | **early** control, comes back late | 58 | 33 | 41 | 48 | 54 |
| จอมเวทเวลา chrono | **late** control | 46 | 39 | 37 | 49 | 61 |
| อัศวิน knight | steady wall, never the best, never dead | 50 | 50 | 56 | 48 | 47 |
| นักรบหนาม thornguard | **mid–late** tank (reflect grows with enemy hits) | 45 | 52 | 56 | 60 | 57 |
| นักรบคลั่ง berserker | **mid–late** scaling | 47 | 47 | 64 | 61 | 56 |
| นักเวทเพลิง pyro | steady scaling, slightly better mid | 43 | 48 | 52 | 48 | 47 |

Best archetype by day: burst (d3, d6) → scaling (d9, d12) → control (d15). Archetype pairs stay ≤ 69% every day.
Hero pairs stay ≤ 75% on days 6–15. Day 3 still has a few hard counters between tiny builds
(thornguard / knight vs berserker 78–83%, assassin vs thornguard ~81%, berserker vs pyro ~78%): day-3 bot
builds are 2–3 blocks (the unique at Lv3 + one Lv1), so single matchups swing a lot there.

### Hero passives changed in this pass

| Hero | Before | Now |
|---|---|---|
| อัศวิน | HP +25%, start shield 8% | HP +35%, start shield 6% |
| นักรบหนาม | HP +15% | HP +18%, and while it has thorns it also reflects 8% of each hit (nothing on small early hits, a lot vs grown late hits) |
| นักฆ่า | charge skills +0.25 multiplier | first hit of the fight ×1.3, hits on enemies below half HP +10% |
| นักดาบคู่ | every 3rd hit +2 | every 3rd hit +40% (at least +1) |
| นักรบคลั่ง | start +1 power, +4 at half HP | start +2 power, +1 per 5 hits taken, +1 at half HP |
| นักเวทเพลิง | burns +2s | burns +30% longer |
| แม่มดน้ำแข็ง | freezes +0.5s | HP +22%, freezes +0.3s |
| จอมเวทเวลา | HP +8%, slows +10% and +1s | HP +12%, slows +10% (no extra time) |

### Skill numbers changed

- ปลิดชีพ (assassin unique) Lv2/Lv3 hits add 2% of the enemy's max HP (เพชฌฆาต 4%): a late-game lever that is
  worth nothing on day 3 and ~9–18 per hit on day 15. เพชฌฆาต ×2.5 → ×2.2, เชือดไว cooldown 3 → 3.5s.
- บิดเวลา (chrono unique): every variant +2 damage (+3 on ตัดเวลา), so chrono has early damage.
- พายุดาบ (duelist unique) Lv2/Lv3: +1 damage per hit.
- ทุบน้ำแข็ง (witch unique) Lv2/Lv3: −1 to −4 damage (witch was 81% on day 3).
- ลูกน้ำแข็ง Lv2/Lv3: +1 to +2 damage (control was too weak mid-game).
- ฟัน Lv3 ฟันทะลวง 17 → 15, ฟันประหาร 16 → 14. คลั่ง Lv2/Lv3 cooldown 6.5 → 7.5s, คลั่งทลาย 6 → 5 per hit,
  คลั่งเลือด leech 30% → 20%. ฝึกสุดขีด grow 4 → 3 (+1 hit), ฝึกไม่หยุด 2.5 → 3s, ขยายถี่ 3.5 → 4s.

## Fight stats for the UI

`CombatResult.sides[side]` (optional; fights from older sims do not have it): `casts`, `never` (build.skills
indexes of placed blocks that never fired), `fr` frozen ticks, `dl` delayed ticks, `sl` slowed ticks,
`ctl` total cooldown ticks lost to control, `resisted` (cap, ตั้งหลัก, สลัดการคุม, ใจเหล็ก ignore).
Cast events may carry `react: true` (fired early as a reaction to control).
