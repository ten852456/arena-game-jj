# Skill tree, keywords and the new start

Status: **implemented 18 Nov 2026** (branch `skill-list`). The design below is what was built. **Live numbers are in
`src/sim/skills.ts`** and differ from the tables after the balance pass. Main changes during tuning:

- Every tank skill also hits (Lv1 ⚔3, Lv2 ⚔4, Lv3 ⚔5): with defence weaker, pure walls could not win. โล่กระแทก hits harder too.
- Defensive numbers were cut further than drafted (shields −15–25%, heals −15%); อัศวิน gets +25% HP, นักรบหนาม and จอมเวทเวลา +15% / +8%.
- ลมหนาว also hits a little; control skills deal more damage; ทุบน้ำแข็ง pierces only half the shield until Lv3; burst Lv1 is a bit weaker and Lv3 stronger.
- Hero passives retuned: นักดาบคู่ "every 3rd hit +2", นักรบคลั่ง "+1 พลัง at start, +4 when below half HP",
  นักเวทเพลิง "burns +2s", แม่มดน้ำแข็ง "freezes +0.5s".
- ทุบน้ำแข็ง B1 renamed **ทุบทะลวง** (ทุบหนัก is already the heavy skill's Lv1 name). All 168 variant names are unique.
- Day-1 gold is 7. Hero-unique skills still appear in random shops. Icons are emoji for now.
- HP, fatigue start and the freeze cap were retuned so that fatigue ends 7–17% of fights on every day.

## 1. What changes

| Topic | Now | New |
|---|---|---|
| Levels | Lv1–Lv5, buying a copy = +1 level | **Lv1 → one of 2 Lv2 variants → one of 2 Lv3 variants** (7 versions per skill, max Lv3) |
| How you upgrade | buy the same skill again | the shop **randomly offers one variant** of a skill you own. You may not see the branch you want |
| Shop | 3 offers | **5 offers** (+ the "+1 slot" card) |
| Day 1 | random shop, gold for 1 skill | **fixed shop per hero** (same every run, different per hero), **gold for 2 skills**. Random shops start on day 2 |
| Skill text | full Thai sentences | **icons + numbers**; hover / tap an icon to see what the keyword means |
| Balance | fatigue ends 80–100% of fights | damage-focused: **fatigue should end ≤ 20% of fights**; defensive skills lose value |

### Shop rules

- Each offer is either a **new Lv1 skill** you don't own, or an **upgrade**: one of the 2 next variants of a skill you own,
  picked at random. Buying an upgrade replaces your skill with that variant (it keeps its slot and mark).
- Price: Lv1 = 3, Lv2 upgrade = 4, Lv3 upgrade = 5 (hero-unique skills +1). Selling refunds 1 / 2 / 3.
- About half of the 5 offers are upgrades once you own skills, so you see roughly one variant per owned skill per day or two.
- **ตื่นพลัง (last chance):** every Lv1 skill moves to Lv2 on a random branch (it used to raise everything to Lv3).

### Balance direction

- Hits deal more; shields, heals and thorns are lower (about −25 to −35% on Lv1 defensive numbers).
- HP / fatigue retuned so that most fights end by KO well before fatigue starts.
- Targets: fatigue-ended fights ≤ 20%, day-1 fights 8–12s with every build able to deal damage, archetype pairs ≤ 65%.

## 2. Keywords and icons

Skill cards show only icons and numbers, e.g. **ฟันคู่ Lv2** · `⚔4 ×2 · ⏱4.0`. Hovering (or tapping) an icon shows its line below.

| Icon | Keyword | Meaning (tooltip) |
|---|---|---|
| ⚔ | ตี | Deal damage (+ your พลัง). `×N` = hits N times |
| 🗡 | ทะลุ | Ignores shields (`🗡50%` = ignores half) |
| 🛡 | โล่ | Shield: blocks damage before HP, stays until broken |
| ❤ | ฟื้น | Heal your HP |
| 🩸 | ดูดเลือด | Heal for a share of the damage this skill deals |
| 🔥 | ไฟ | Burn: X damage per second for N seconds, ignores shields, stacks |
| ❄ | แช่แข็ง | Freeze: all enemy cooldowns stop; repeated freezes are shorter; capped per fight |
| 🐌 | ช้า | Slow: enemy cooldowns run X% slower; capped per fight |
| ⏪ | ถ่วงเวลา | Push every enemy cooldown back by N seconds; shares the freeze cap |
| 💪 | พลัง | +X damage on every hit of every skill, for the rest of the fight |
| ⚡ | รวมพลัง | Your next hit (any skill) deals ×N |
| 🌵 | หนาม | When hit, reflect damage = your thorns (max 75% of the hit); while you have thorns the enemy heals half |
| 🗿 | ใจเหล็ก | Freeze, slow and delay on you are 60% weaker, for the rest of the fight |
| ✨ | ชำระ | Remove debuffs on yourself (burn stacks, slow, freeze) |
| 💥 | สลาย | Remove enemy buffs (one of each: พลัง, หนาม, รวมพลัง, ใจเหล็ก) and 20% of their shield |
| ✖2 | ขยาย | Double your current buffs (พลัง, หนาม, รวมพลัง), up to a cap |
| 🎯 | ประหาร | Condition: stronger if the enemy is below X% HP |
| 🧊 | ทุบน้ำแข็ง | Condition: stronger if the enemy is frozen |
| ⏱ | คูลดาวน์ | Seconds between uses |

## 3. Skill trees

Format: **Lv1** → Lv2 **A** (playstyle) / **B** (playstyle) → Lv3 **A1 / A2** under A, **B1 / B2** under B.
Unchanged numbers inherit from the level above unless written.

### Burst (ดาเมจ)

| Skill | Lv1 | Lv2 A | Lv3 A1 / A2 | Lv2 B | Lv3 B1 / B2 |
|---|---|---|---|---|---|
| **ฟัน** strike | ⚔5 ⏱4 | **ฟันหนัก** (big hits) ⚔9 ⏱5 | **ฟันทะลวง** ⚔13 🗡 / **ฟันประหาร** ⚔12 🎯<50% ×1.6 | **ฟันคู่** (many hits) ⚔4×2 ⏱4 | **ฟันพายุ** ⚔3×4 / **ฟันดูดเลือด** ⚔5×2 🩸30% |
| **แทงเร็ว** jab | ⚔3 ⏱3 | **แทงไว** (speed) ⚔4 ⏱2.4 | **แทงสายฟ้า** ⚔4 ⏱1.8 / **แทงพิษ** ⚔4 🔥1 3s | **แทงจุดตาย** (vs no shield) ⚔6, ×1.5 if enemy has no shield | **แทงทะลุ** ⚔8 🗡 / **แทงสะกด** ⚔6 ⏪0.5 |
| **ทุบหนัก** heavy | ⚔12 🗡50% ⏱7.5 | **ค้อนทลาย** (anti-tank) ⚔18 🗡 ⏱8 | **ค้อนพิฆาต** ⚔26 🗡 / **ค้อนสะท้าน** ⚔18 🗡 ❄1 | **ทุบสั่น** (control) ⚔10 🐌20% 3s ⏱6 | **ทุบถ่วง** ⚔12 ⏪1 / **ทุบคู่** ⚔10×2 |
| **รวมพลัง** charge | ⚡×1.7 ⏱5 | **รวมพลังใหญ่** (one huge hit) ⚡×2.2 ⏱6 | **ทุ่มสุดตัว** ⚡×3 ⏱7 / **พลังเดือด** ⚡×2.2 💪+1 | **รวมพลังเร็ว** (often) ⚡×1.5 ⏱3.5 | **ต่อเนื่อง** ⚡×1.5 ⏱2.5 / **สองจังหวะ** ⚡×1.5 for the next 2 hits |

### Tank (ถึก)

| Skill | Lv1 | Lv2 A | Lv3 A1 / A2 | Lv2 B | Lv3 B1 / B2 |
|---|---|---|---|---|---|
| **ยกโล่** shield | 🛡7 ⏱6 | **ป้อมโล่** (wall) 🛡12 ⏱7 | **กำแพงเหล็ก** 🛡18 / **โล่หนาม** 🛡12 🌵2 | **โล่ตอบโต้** (shield → damage) 🛡7, ⚔50% of your shield | **โล่กระแทกกลับ** ⚔100% of shield / **โล่ฟื้นฟู** 🛡7 ❤4 |
| **เกราะหนาม** thorns | 🌵2 (10s) ⏱7 | **หนามแหลม** (burst reflect) 🌵4 | **หนามพิษ** 🌵6 / **หนามขัดขวาง** 🌵4, enemy heals −75% | **หนามถาวร** (stacking) 🌵2 never expires ⏱9 | **ดงหนาม** 🌵3 never expires / **หนามหุ้มเกราะ** 🌵2 never expires 🛡4 |
| **ผิวหิน** stoneskin | 🛡3 ❤3 ⏱7 | **หินฟื้น** (sustain) ❤7 ⏱7 | **หินชีวิต** ❤11 / **หินบริสุทธิ์** ❤7 ✨ | **หินแกร่ง** (armor) 🛡7 ⏱7 | **หินผา** 🛡10 🗿 / **หินพุ่ง** 🛡7 ⚔4 |
| **ชำระล้าง** cleanse | ✨ 🛡2 ⏱6 | **ล้างพิษ** (anti-burn/control) ✨✨ ❤3 | **ล้างทั้งหมด** ✨ all ❤5 / **ล้างแล้วแกร่ง** ✨✨ 🗿 | **ล้างแล้วตอบโต้** (punish debuffs) ✨, ⚔3 per debuff removed | **ล้างพิฆาต** ⚔5 per debuff / **ล้างหนาม** ✨ 🌵2 |

### Scaling (โตไม่หยุด)

| Skill | Lv1 | Lv2 A | Lv3 A1 / A2 | Lv2 B | Lv3 B1 / B2 |
|---|---|---|---|---|---|
| **ฝึกฝน** train | 💪+2 ⚔1 ⏱6 | **ฝึกหนัก** (big stacks) 💪+3 ⏱6.5 | **ฝึกสุดขีด** 💪+4 / **ฝึกต่อสู้** 💪+3 ⚔3 | **ฝึกเร็ว** (fast stacks) 💪+1 ⏱3.5 | **ฝึกไม่หยุด** 💪+1 ⏱2.5 / **ซ้อมจริง** 💪+1 ⚔2 ⏱3.5 |
| **จุดไฟ** ignite | 🔥2 6s ⏱5.5 | **ไฟลุก** (hot) 🔥3 6s | **ไฟนรก** 🔥4 6s / **ไฟโหม** 🔥3 + ½ your พลัง per second | **ไฟยาว** (long) 🔥2 10s | **ไฟไม่ดับ** 🔥2 14s / **ไฟเย็น** 🔥2 10s 🐌15% |
| **กินฟื้นแรง** feast | ❤4 💪+1 ⏱5.5 | **กินอิ่ม** (sustain) ❤7 💪+1 | **งานเลี้ยง** ❤10 💪+1 / **กินแล้วแกร่ง** ❤7 💪+1 🛡4 | **กินโต** (grow) ❤2 💪+2 | **กินไม่หยุด** 💪+3 / **กินเลือด** ❤2 💪+2, next hit 🩸50% |
| **ขยายพลัง** amplify | ✖2 cap 4 ⏱7 | **ขยายใหญ่** (late spike) ✖2 cap 8 | **ทวีคูณ** ✖2 cap 14 / **ขยายรวมพลัง** ✖2 cap 8, also ⚡×1.3 | **ขยายเร็ว** (steady) ✖2 cap 3 ⏱4.5 | **ขยายถี่** ✖2 cap 3 ⏱3.5 / **ขยายแล้วโต** ✖2 cap 3 💪+1 |

### Control (ควบคุม)

| Skill | Lv1 | Lv2 A | Lv3 A1 / A2 | Lv2 B | Lv3 B1 / B2 |
|---|---|---|---|---|---|
| **ลูกน้ำแข็ง** frost | ⚔3 ❄1.4 ⏱5 | **แช่ยาว** (lock) ❄2 | **ยุคน้ำแข็ง** ❄2.5 / **หนาวสะท้าน** ❄2 🐌20% | **น้ำแข็งคม** (damage) ⚔6 ❄1 | **หอกน้ำแข็ง** ⚔9 ❄1 / **ลูกเห็บ** ⚔4×2 ❄0.7 |
| **ลมหนาว** chill | 🐌30% 3s ⏱7 | **พายุหิมะ** (deep slow) 🐌40% 3s | **ลมเยือกแข็ง** 🐌50% / **พายุมีด** 🐌40%, ⚔3 if already slowed | **ลมเย็นยาว** (long slow) 🐌25% 5s | **หนาวนิรันดร์** 🐌25% 7s / **ลมร้อนเย็น** 🐌25% 5s 🔥1 |
| **สลายเวท** dispel | 💥 ⚔2 ⏱6 | **สลายใหญ่** (strip) 💥×2 | **สลายสิ้น** remove all enemy buffs / **ทลายโล่** 💥×2, 40% shield | **สลายแล้วตี** (punish buffs) 💥, ⚔3 per buff removed | **สลายพิฆาต** ⚔5 per buff / **ขโมยพลัง** 💥 and you gain the removed พลัง |
| **ใจเหล็ก** ironwill | 🗿 🛡2 ⏱8 | **เหล็กกล้า** (anti-control) 🗿 80% | **ไร้ผล** 🗿 80%, first freeze ignored / **เหล็กบริสุทธิ์** 🗿 80% ✨ | **ใจสู้** (fight on) 🗿 💪+1 | **ใจเพลิง** 🗿 💪+2 / **ใจกล้า** 🗿 ⚔4 |

### Hero-unique skills

| Hero | Skill | Lv1 | Lv2 A | Lv3 A1 / A2 | Lv2 B | Lv3 B1 / B2 |
|---|---|---|---|---|---|---|
| อัศวิน | **โล่กระแทก** bulwark | ⚔3 + 70% of your 🛡 ⏱6 | **ปะทะ** (shield → damage) ⚔ + 100% 🛡 | **ทลายด้วยโล่** + 130% 🛡 / **โล่สะท้าน** + 100% 🛡 ❄0.5 | **ปะทะแล้วตั้งรับ** (shield loop) + 50% 🛡, 🛡4 | **ตั้งรับเต็มที่** 🛡8 / **ปะทะฟื้น** 🛡4 ❤4 |
| นักรบหนาม | **ป้อมหนาม** spikewall | ⚔3 + 🌵×3 ⏱5.5 | **ระเบิดหนาม** (cash in) + 🌵×4 | **หนามพุ่ง** 🌵×5 / **หนามล้อม** 🌵×4 🛡4 | **ปลูกหนาม** (stack) + 🌵×2, 🌵+1 | **สวนหนาม** 🌵+2 / **หนามฟื้น** 🌵+1 ❤3 |
| นักฆ่า | **ปลิดชีพ** execute | ⚔6 🎯<50% ×1.7 ⏱5 | **ประหาร** (finisher) ⚔8 🎯<50% ×2 | **เพชฌฆาต** 🎯<30% ×3 / **ประหารทะลุ** 🎯 ×2 🗡 | **เชือดเร็ว** (often) ⚔5 🎯 ×1.5 ⏱4 | **เชือดไว** ⏱3 / **เชือดดูดเลือด** 🩸30% |
| นักดาบคู่ | **พายุดาบ** flurry | ⚔1.5 ×4 ⏱5 | **พายุคม** (more hits) ⚔1.5 ×5 | **พายุพันดาบ** ×6 / **ดาบเพลิง** ×5, each hit 🔥1 2s | **ดาบหนัก** (fewer, bigger) ⚔3 ×3 | **ดาบทลาย** ⚔4 ×3 / **ดาบถ่วง** ⚔3 ×3 ⏪0.3 |
| นักรบคลั่ง | **คลั่ง** rampage | ⚔2 ×2 ⏱6.5 | **คลั่งรัว** (more hits) ⚔2 ×3 | **บ้าคลั่ง** ×4 / **คลั่งโต** ×3 💪+1 | **คลั่งหนัก** (big hits) ⚔4 ×2 | **คลั่งทลาย** ⚔6 ×2 / **คลั่งเลือด** ⚔4 ×2 🩸30% |
| นักเวทเพลิง | **ระเบิดเพลิง** inferno | ⚔2 + 70% of 🔥 left, 🗡 ⏱6 | **ระเบิดใหญ่** (cash in) + 100% 🔥 left | **ระเบิดมหันต์** + 130% / **ระเบิดลุกลาม** + 100%, 🔥2 6s | **จุดระเบิด** (build) + 70%, 🔥2 6s | **ระเบิดลาวา** 🔥3 6s / **ระเบิดควัน** 🔥2 🐌20% |
| แม่มดน้ำแข็ง | **ทุบน้ำแข็ง** shatter | ⚔7 🗡 🧊 ×3 ⏱4.5 | **ทุบแตก** (combo) 🧊 ×4 | **ทุบแหลก** 🧊 ×5 / **ทุบแล้วแช่** 🧊 ×4, ❄0.5 after | **ทุบตรง** (no combo needed) ⚔9 🗡 🧊 ×2 | **ทุบทะลวง** ⚔12 / **ทุบเย็น** ⚔9 🐌20% |
| จอมเวทเวลา | **บิดเวลา** timewarp | ⚔3 ⏪1.25 ⏱5 | **ย้อนเวลา** (lock) ⏪1.75 | **หยุดกาล** ⏪2.25 / **ย้อนแล้วช้า** ⏪1.75 🐌20% | **เวลาคม** (damage) ⚔5 ⏪1 | **ตัดเวลา** ⚔8 ⏪1 / **เวลาแข็ง** ⚔5 ⏪1 ❄0.5 |

## 4. Day-1 shop per hero (fixed, buy 2 of 5)

Day-1 gold becomes 6–7 (two Lv1 skills = 6, unique = 4). Every list has at least two damage skills, so no first build is empty.

| Hero | Day-1 shop (always the same) |
|---|---|
| อัศวิน | โล่กระแทก · ยกโล่ · ฟัน · ผิวหิน · แทงเร็ว |
| นักรบหนาม | ป้อมหนาม · เกราะหนาม · ฟัน · ยกโล่ · ทุบหนัก |
| นักฆ่า | ปลิดชีพ · ฟัน · แทงเร็ว · รวมพลัง · ทุบหนัก |
| นักดาบคู่ | พายุดาบ · แทงเร็ว · ฟัน · รวมพลัง · ฝึกฝน |
| นักรบคลั่ง | คลั่ง · ฝึกฝน · ฟัน · กินฟื้นแรง · จุดไฟ |
| นักเวทเพลิง | ระเบิดเพลิง · จุดไฟ · ฝึกฝน · แทงเร็ว · ลมหนาว |
| แม่มดน้ำแข็ง | ทุบน้ำแข็ง · ลูกน้ำแข็ง · ฟัน · ลมหนาว · แทงเร็ว |
| จอมเวทเวลา | บิดเวลา · ลมหนาว · ลูกน้ำแข็ง · ฟัน · สลายเวท |

## 5. Questions for review

1. Names: OK, or do you want a different naming style?
2. Any branch that doesn't fit the hero / playstyle you imagine?
3. Day-1 gold: exactly 2 Lv1 skills (6), or a little extra so a unique (4) + a Lv1 (3) is possible (7)? I suggest **7**.
4. Should hero-unique skills appear in random shops after day 1 (as now), or only on day 1 and as upgrades?
5. Icons: emoji for now (fast, readable). Pixel-art icons drawn in code can replace them later. OK?

## Sim v10 update (19 Nov 2026): control lock, chains, engines, power curves

Live numbers are in `src/sim/skills.ts` / `heroes.ts`; the tables in section 3 are the original draft.

### Control rules (no more 0-skill fights)

| Rule | Value |
|---|---|
| Freeze + cast delay share one cap per fight | `freezeCap` (2s / 4.5s / 6s by day) **and** at most 1s + 30% of the time fought so far |
| Already frozen | cannot be frozen or delayed again |
| ตั้งหลัก (control immunity) | when a freeze ends (or is cleansed) or a delay lands: freeze and delay are resisted for 1.5s |
| สลัดการคุม (shake off) | a fighter that has not fired any skill for 4s drops freeze / slow and resists all control until it fires |
| Slow | own cap (1.75 × freeze cap, also growing with the fight) |
| ✨ / 🗿 react | a skill with ชำระ or ใจเหล็ก fires **right away** when ≥0.5s of control (or a ≥30% slow) lands on its owner, at most once per its cooldown (its cooldown restarts). ใจเหล็ก also shortens a freeze already on you |
| Weaker fires carry weaker control | fires below 100% power (engines, ตีซ้ำ echo) freeze / slow / delay for that share; ขยาย's cap also scales |

These apply to every source: own cooldown, trigger chains and engines.
Bot fights where a side fires 0 skills: 1.6% (all in 5s fights on days 1–3, none caused by control).

### Chains ("ต่อ")

- A skill set off by another skill (trigger bonus or engine) cannot be set off again for its own cooldown
  (at least 2s, at most 4s). So ต่อ at most doubles a fast skill and triples a slow one.
- Chain step 2 fires at ×0.75, step 3 at ×0.56 … (step 1 = full power). Each skill still fires once per chain.
- Max set-off fires per side per fight in bot fights: 17 (was 27 in the playtest).

### Engine skills (shared, type ทั่วไป)

Engines do nothing alone: they fire the skill **right above / below** them in the list. Fires they cause count as ต่อ.

| Skill | Lv1 | Lv2 A | Lv3 A1 / A2 | Lv2 B | Lv3 B1 / B2 |
|---|---|---|---|---|---|
| **ฟันเฟือง** gear ⚙ | fires above, then below, taking turns, at 40% ⏱3 | **เฟืองหนัก** (แรงขึ้น) 70% | **เฟืองเหล็ก** 100% / **เฟืองโล่** 70% 🛡3 | **เฟืองไว** (ถี่ขึ้น) 50% ⏱2.4 | **เฟืองพายุ** 75% ⏱2 / **เฟืองคู่** both neighbours 50% ⏱2.8 |
| **เร่งเครื่อง** overclock 🚀 | fires both neighbours at 85%, then **their cooldowns restart** ⏱6 | **เร่งแรง** (แรงขึ้น) 130% | **เร่งสุดขีด** 160% / **เร่งแล้วตั้งรับ** 130% 🛡4 | **เร่งไว** (ถี่ขึ้น) 110% ⏱4.5 | **เร่งถี่** 125% ⏱4 / **เร่งต่อเนื่อง** 90% ⏱4.5, cooldowns keep running |

Why order matters more now: ฟันเฟือง at the top/bottom of the list fires its single neighbour twice as often
(good next to one big skill); in the middle it feeds two. เร่งเครื่อง restarts its neighbours' cooldowns, so it wants
slow, heavy skills (ทุบหนัก, รวมพลัง) next to it and wastes fast ones. The engine's own power bonus scales its fires.
Measured (day 10, +1 skill to 4-skill bot builds): engines win 15–37% depending on position vs 8–33% for ฟัน of the same level.

### Run: 10 wins

- `WIN_TARGET` 10. HP lost per defeat = 2 (days 1–3), 3 (4–6), 4 (7–9), 5 from day 10 (cap). START_HP stays 20.
- Bot 10-win runs end around day 13–15 with 3–4.5 losses.

### Intended power curves (who is strong when)

Per-hero win rates vs all other heroes, bot builds, `npm run balance -- 80 3,6,9,12,15 --no-len`:

| Hero | Curve | d3 | d6 | d9 | d12 | d15 |
|---|---|---|---|---|---|---|
| นักดาบคู่ duelist | **early** burst, fades late | 52 | 59 | 57 | 52 | 36 |
| นักฆ่า assassin | **early–mid** burst (first hit ×1.6), fades late | 47 | 59 | 57 | 42 | 37 |
| แม่มดน้ำแข็ง witch | **early** control (freeze matters most while HP is low) | 56 | 44 | 44 | 53 | 42 |
| จอมเวทเวลา chrono | **mid–late** control | 48 | 42 | 51 | 62 | 54 |
| นักรบหนาม thornguard | **mid–late** tank, thorns pile up | 44 | 52 | 52 | 54 | 56 |
| อัศวิน knight | steady wall, best late | 54 | 45 | 48 | 43 | 55 |
| นักรบคลั่ง berserker | **late** scaling (พลัง +1 per 5 hits taken) | 50 | 46 | 46 | 52 | 66 |
| นักเวทเพลิง pyro | **late** scaling, burns +30% longer | 49 | 54 | 45 | 43 | 55 |

Burst wins the early/mid days (burst vs tank 66% on day 6, vs scaling 67% on day 9); tank and scaling win day 15
(70% / 68% vs burst). Hero passives changed in this pass: นักฆ่า "first hit ×1.6" (was charge +0.25),
นักดาบคู่ "every 3rd hit +30%", นักรบคลั่ง "+10% HP, +1 พลัง per 5 hits taken, +2 at half HP",
นักเวทเพลิง "burns +30% longer", แม่มด "+16% HP, freezes +0.3s", จอมเวทเวลา "+16% HP, hits on a slowed/frozen enemy +10%",
อัศวิน "+30% HP, start shield 12%", นักรบหนาม "+20% HP, thorns last 13s".
