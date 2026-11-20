# Skill tree, keywords and the new start

## Sim v12 (20 Nov 2026): 8 lines replace the 4 archetypes

Branch `feat/lines`. Design: docs/DESIGN_LINES_ULT.md. **Live numbers are in `src/sim/skills.ts` × `src/sim/tuning.ts`**;
the tables below are generated from them (`npx tsx scripts/skill-doc.ts`) and show the chip text
the game shows. The archetype sections further down are history (sim v10–v11).

- Every skill has a `line` (`hit dodge shield heal burn poison ice wind`, or `none` for ฟันเฟือง / เร่งเครื่อง / ใจเหล็ก).
  Connect-bonus conditions are `line:<line>` (was `arch:<archetype>`); tuning keys are `line.<line>.lv1/lv3`.
- Budget: **3 shared skills per line (24) + 1 unique per hero (8) + 3 neutral = 35** (was 26). New: สวนกลับ riposte,
  ก้าวหลบ sidestep, ฟื้นฟู mend, ลูกไฟ blaze, ไฟแผดเผา scorch, เขี้ยวพิษ venom, พิษปะทุ plague, ทวนน้ำแข็ง icelance,
  ธารน้ำแข็ง glacier, ลมส่ง tailwind. Removed: ขยายพลัง amplify (its icon and tuning keys are gone). Every old id that
  survived kept its id; several were renamed / rethemed (แทงเร็ว → แทงหลบ, เกราะหนาม → เกราะหนามพิษ, ลมหนาว → ลมกรรโชก,
  บิดเวลา → ลมย้อน, ป้อมหนาม → ป้อมหนามพิษ …).
- Roles per line (`SKILL_ROLE`): **core** adds the line's element, **payoff** cashes it in, **tech** answers the lines it
  loses to (shown in the skill tooltip as แกน / จบ / แก้ทาง).
- The hero's unique counts for its line (ult pieces, bonuses).

### New keywords

| Icon | Keyword | Meaning |
|---|---|---|
| 💨 | หลบ dodge | Gain dodge charges (max 2). The next direct hit on you misses completely and uses one charge. Deterministic (no random dodge). Burn, poison, thorns reflection, fatigue and ultimates can't be dodged. If every hit of a skill was dodged, the freeze / delay that rides on those hits does not land either |
| ☠ | พิษ poison | X damage per second for N seconds, ignores shields, can't be dodged, stacks; weaker per second than burn but longer; a poisoned fighter heals ×0.6 |
| ⏩ | เร่ง haste | Your cooldowns run X% faster for N seconds (max 60%) |
| 🩹 | แผลลึก wound | The enemy heals X% less for N seconds |
| 👁 | ไม่พลาด sure | This hit can't be dodged |
| ✨ 🔥☠ | ชำระ (DoT only) | Wind / dodge cleanses only blow burn and poison away: they don't thaw a freeze and don't react to control |

✨ ชำระ (full) now removes burn **or** poison stacks (strongest first) plus slow, freeze and wound.

### Counter web (soft, from mechanics)

| Line | Beats | Because | Loses to |
|---|---|---|---|
| ⚔ ตี | ❤ ☠ | big hits end it before heals / poison stack up; นักฆ่า's hits wound (−40% healing 2 s) | 🛡 💨 |
| 💨 หลบ | ⚔ ❄ | dodge negates whole hits (a dodged ice ball also loses its freeze) | 🔥 ☠ |
| 🛡 โล่ | ⚔ ❄ | shields block hits; ice hits lightly | 🔥 ☠ |
| ❤ ฮีล | 🔥 🌪 | healing out-sustains DoT and light hits | ⚔ ❄ |
| 🔥 เผา | 🛡 💨 | burn ignores shields and can't be dodged | ❤ 🌪 |
| ☠ พิษ | 🛡 💨 | poison ignores shields and can't be dodged | ⚔ 🌪 |
| ❄ น้ำแข็ง | 🌪 ❤ | freeze stops fast and healing cooldowns | 🛡 💨 |
| 🌪 ลม | ☠ 🔥 | ลมส่ง blows every burn / poison stack away | ❤ ❄ |

### Skill trees (generated)

Format: role `id` | Lv1 | Lv2 A | Lv3 A1 / A2 | Lv2 B | Lv3 B1 / B2. Chips: ⚔ hit, ×N hits, 🗡 pierce, 👁 can't be dodged, 💨 dodge, ☠ poison, 🩹 wound, ⏩ haste, ✨ 🔥☠ DoT-only cleanse, ⏱ cooldown.

### ⚔ ตี (hit)

| Skill | Lv1 | Lv2 A | Lv3 A1 / A2 | Lv2 B | Lv3 B1 / B2 |
|---|---|---|---|---|---|
| core `strike` | **ฟัน** ⚔3 ⏱4.3 | **ฟันหนัก** (ตีหนัก) ⚔10 ⏱5.0 | **ฟันทะลวง** ⚔30 🗡 ⏱5.0 / **ฟันประหาร** ⚔29 🎯<50% ×1.6 ⏱5.0 | **ฟันคู่** (ตีหลายครั้ง) ⚔5 ×2 ⏱4.0 | **ฟันพายุ** ⚔6 ×4 ⏱4.0 / **ฟันดูดเลือด** ⚔14 ×2 🩸30% ⏱4.0 |
| payoff `charge` | **รวมพลัง** ⚡×1.55 ⏱5.0 | **รวมพลังใหญ่** (ตีทีเดียวแรงมาก) ⚡×2.4 ⏱6.0 | **ทุ่มสุดตัว** ⚡×4.75 ⏱7.0 / **พลังเดือด** ⚡×2.8 💪+1 ⏱6.0 | **รวมพลังเร็ว** (ใช้บ่อย) ⚡×1.6 ⏱3.5 | **ต่อเนื่อง** ⚡×1.75 ⏱2.5 / **สองจังหวะ** ⚡×1.75 (2 ครั้ง) ⏱3.5 |
| tech `heavy` | **ทุบหนัก** ⚔10 🗡50% ⏱7.5 | **ค้อนทลาย** (ทลายโล่) ⚔20 🗡 ⏱8.0 | **ค้อนพิฆาต** ⚔54 🗡 ⏱8.0 / **ค้อนสะท้าน** ⚔32 🗡 ❄1s ⏱8.0 | **ทุบแม่น** (ตีไม่พลาด) ⚔12 🗡50% 👁 ⏱6.0 | **ทุบไม่พลาด** ⚔23 🗡50% 👁 ⏱6.0 / **ทุบคู่** ⚔17 ×2 🗡50% 👁 ⏱6.0 |
| unique (assassin) `execute` | **ปลิดชีพ** ⚔11 🎯<50% ×1.5 👁 ⏱4.8 | **ประหาร** (ปิดเกม) ⚔12 🎯<50% ×1.6 👁 ⏱4.8 | **เพชฌฆาต** ⚔11 🎯<35% ×2.2 👁 ⏱4.8 / **ประหารทะลุ** ⚔11 🗡 🎯<50% ×1.5 👁 ⏱4.8 | **เชือดเร็ว** (ใช้บ่อย) ⚔8 🎯<50% ×1.4 👁 ⏱3.8 | **เชือดไว** ⚔7 🎯<50% ×1.4 👁 ⏱2.9 / **เชือดดูดเลือด** ⚔8 🎯<50% ×1.4 🩸30% 👁 ⏱3.8 |

### 💨 หลบ (dodge)

| Skill | Lv1 | Lv2 A | Lv3 A1 / A2 | Lv2 B | Lv3 B1 / B2 |
|---|---|---|---|---|---|
| core `jab` | **แทงหลบ** ⚔2 💨+1 ⏱4.0 | **แทงไว** (ความเร็ว) ⚔5 💨+1 ⏱2.8 | **แทงสายฟ้า** ⚔9 ⏱2.2 / **แทงลวงตา** ⚔7 💨+1 ⚔3+3/💨 ⏱3.5 | **แทงจุดตาย** (ตีศัตรูไร้โล่) ⚔7 ไร้โล่ ×1.5 💨+1 ⏱3.0 | **แทงทะลุ** ⚔15 🗡 ไร้โล่ ×1.5 💨+1 ⏱3.0 / **แทงสะกด** ⚔9 ไร้โล่ ×1.5 💨+1 ⏪0.6s ⏱3.0 |
| payoff `riposte` | **สวนกลับ** ⚔3+2/💨 ⏱5.0 | **สวนแรง** (สวนหนัก) ⚔6+3/💨 ⏱5.0 | **สวนพิฆาต** ⚔10+7/💨 ⏱5.0 / **สวนทะลุ** ⚔9+4/💨 🗡 ⏱5.0 | **สวนแล้วหลบ** (หลบวน) ⚔3+2/💨 💨+1 ⏱5.0 | **เต้นดาบ** ⚔6+3/💨 💨+1 ⏱4.5 / **สวนดูดเลือด** ⚔6+3/💨 🩸30% 💨+1 ⏱5.0 |
| tech `sidestep` | **ก้าวหลบ** 💨+1 ✨ทั้งหมด 🔥☠ ⚔2 ⏱6.0 | **สะบัดพิษ** (ล้างดีบัฟ) 💨+1 ✨ทั้งหมด 🔥☠ ⚔3 ⏱6.0 | **สะบัดหมด** 💨+1 ✨ทั้งหมด 🔥☠ ⚔6 ⏱6.0 / **สะบัดแล้วฟื้น** 💨+1 ✨ทั้งหมด 🔥☠ ❤6 ⏱6.0 | **เงาลวง** (หลบมาก) 💨+2 ⚔5 ⏱6.0 | **ร่างเงา** 💨+2 ⚔10 ⏱6.0 / **เงาสวน** 💨+2 ⚔4+3/💨 ⏱6.0 |
| unique (duelist) `flurry` | **พายุดาบ** ⚔2 ×3 ⏱4.8 | **พายุคม** (ตีรัวขึ้น) ⚔2 ×4 ⏱4.8 | **พายุพันดาบ** ⚔2 ×5 ⏱4.8 / **ดาบเงา** ⚔2 ×4 💨+1 ⏱4.8 | **ดาบหนัก** (ตีน้อยแต่แรง) ⚔3 ×3 ⏱4.8 | **ดาบทลาย** ⚔7 ×3 ⏱4.8 / **ดาบถ่วง** ⚔4 ×3 ⏪0.35s ⏱4.8 |

### 🛡 โล่ (shield)

| Skill | Lv1 | Lv2 A | Lv3 A1 / A2 | Lv2 B | Lv3 B1 / B2 |
|---|---|---|---|---|---|
| core `shield` | **ยกโล่** 🛡5 ⚔3 ⏱5.0 | **ป้อมโล่** (กำแพง) 🛡12 ⚔7 ⏱7.0 | **กำแพงเหล็ก** 🛡17 ⚔8 ⏱7.0 / **โล่มั่นคง** 🛡12 🗿 ⚔7 ⏱7.0 | **โล่ตอบโต้** (โล่เป็นดาเมจ) 🛡8 ⚔2+55%🛡 ⏱6.0 | **โล่กระแทกกลับ** 🛡7 ⚔100%🛡 ⏱6.0 / **โล่ฟื้นฟู** 🛡7 ⚔60%🛡 ❤5 ⏱6.0 |
| payoff `stoneskin` | **ผิวหิน** 🛡3 ⚔2+40%🛡 ⏱7.0 | **หินแกร่ง** (เกราะ) 🛡7 ⚔3+45%🛡 ⏱7.0 | **หินผา** 🛡9 🗿 ⚔5+45%🛡 ⏱7.0 / **หินฟื้น** 🛡7 ❤6 ⚔5+45%🛡 ⏱7.0 | **หินพุ่ง** (โล่เป็นดาเมจ) 🛡3 ⚔3+90%🛡 ⏱7.0 | **หินถล่ม** 🛡3 ⚔5+140%🛡 ⏱7.0 / **หินทะลวง** 🛡3 ⚔3+90%🛡 🗡 ⏱7.0 |
| tech `cleanse` | **ชำระล้าง** ✨ 🛡2 ⚔3 ⏱6.0 | **ล้างพิษ** (กันไฟ/พิษ/การคุม) ✨×2 ❤4 ⚔6 ⏱6.0 | **ล้างทั้งหมด** ✨ทั้งหมด ❤6 ⚔6 ⏱6.0 / **ล้างแล้วแกร่ง** ✨×2 🗿 🛡3 ⏱6.0 | **ล้างแล้วตอบโต้** (ลงโทษดีบัฟ) ✨ ⚔4+3/อย่าง ⏱6.0 | **ล้างพิฆาต** ✨ ⚔6+5/อย่าง ⏱6.0 / **ล้างแล้วตั้งรับ** ✨ 🛡6 ⚔5 ⏱6.0 |
| unique (knight) `bulwark` | **โล่กระแทก** ⚔8+100%🛡 ⏱6.6 | **ปะทะ** (โล่เป็นดาเมจ) ⚔10+155%🛡 ⏱6.6 | **ทลายด้วยโล่** ⚔10+195%🛡 ⏱6.6 / **โล่สะท้าน** ⚔10+150%🛡 ❄0.6s ⏱6.6 | **ปะทะแล้วตั้งรับ** (วนโล่) ⚔10+95%🛡 🛡5 ⏱6.6 | **ตั้งรับเต็มที่** ⚔10+90%🛡 🛡7 ⏱6.6 / **ปะทะฟื้น** ⚔10+90%🛡 🛡5 ❤5 ⏱6.6 |

### ❤ ฮีล (heal)

| Skill | Lv1 | Lv2 A | Lv3 A1 / A2 | Lv2 B | Lv3 B1 / B2 |
|---|---|---|---|---|---|
| core `feast` | **กินฟื้นแรง** ✨ 🔥☠ ❤5 💪+1 ⚔3 ⏱5.0 | **กินอิ่ม** (อยู่รอด) ✨ 🔥☠ ❤7 💪+1 ⚔2 ⏱5.5 | **งานเลี้ยง** ✨ 🔥☠ ❤9 💪+1 ⚔3 ⏱5.5 / **กินแล้วแกร่ง** ✨ 🔥☠ ❤7 💪+1 🛡5 ⚔3 ⏱5.5 | **กินโต** (โตเร็ว) ✨ 🔥☠ ❤2 💪+2 ⚔2 ⏱5.5 | **กินไม่หยุด** ✨ 🔥☠ ❤2 💪+3 ⚔3 ⏱5.5 / **กินเลือด** ✨ 🔥☠ ❤2 💪+2 🩸50% ครั้งถัดไป ⚔3 ⏱5.5 |
| payoff `train` | **ฝึกฝน** 💪+1 ⚔4 ⏱6.0 | **ฝึกหนัก** (พลังก้อนใหญ่) 💪+3 ⚔2 ⏱6.5 | **ฝึกสุดขีด** 💪+4 ⚔2 ⏱6.5 / **ฝึกต่อสู้** 💪+3 ⚔6 ⏱6.5 | **ฝึกเร็ว** (พลังถี่) 💪+1 ⚔2 ⏱3.5 | **ฝึกไม่หยุด** 💪+1 ⚔2 ⏱2.5 / **ซ้อมจริง** 💪+1 ⚔3 🩸30% ⏱3.5 |
| tech `mend` | **ฟื้นฟู** ❤5 🗿 ⏱6.0 | **ฟื้นทันใจ** (ฟื้นตอนโดนคุม) ❤7 🗿 ⏱6.0 | **ฟื้นไม่หยุด** ❤9 🗿 ⏱5.0 / **ฟื้นบริสุทธิ์** ❤7 🗿 ✨ ⏱6.0 | **เลือดเหล็ก** (กันตีแรง) ❤4 🛡5 🗿 ⏱6.0 | **กายเหล็ก** ❤3 🛡8 🗿 ⏱6.0 / **เลือดสวน** ❤5 🗿 ⚔6 🩸30% ⏱6.0 |
| unique (berserker) `rampage` | **คลั่ง** ⚔2 ×2 🩸25% ⏱5.0 | **คลั่งรัว** (ตีหลายครั้ง) ⚔2 ×3 🩸25% ⏱6.0 | **บ้าคลั่ง** ⚔3 ×4 🩸25% ⏱6.0 / **คลั่งโต** ⚔2 ×3 🩸25% 💪+1 ⏱6.0 | **คลั่งหนัก** (ตีแรง) ⚔4 ×2 ⏱6.0 | **คลั่งทลาย** ⚔7 ×2 ⏱6.0 / **คลั่งเลือด** ⚔5 ×2 🩸40% ⏱6.0 |

### 🔥 เผา (burn)

| Skill | Lv1 | Lv2 A | Lv3 A1 / A2 | Lv2 B | Lv3 B1 / B2 |
|---|---|---|---|---|---|
| core `ignite` | **จุดไฟ** 🔥3 4s ⏱5.5 | **ไฟลุก** (ไฟแรง) 🔥3 6s ⏱5.5 | **ไฟนรก** 🔥5 6s ⏱5.5 / **ไฟโหม** 🔥3+½💪 6s ⏱5.5 | **ไฟยาว** (ไฟนาน) 🔥2 10s ⏱5.5 | **ไฟไม่ดับ** 🔥2 14s ⏱5.5 / **ไฟเย็น** 🔥3 8s 🐌15% 4s ⏱5.5 |
| payoff `blaze` | **ลูกไฟ** ⚔5+2.5/🔥 ⏱5.0 | **ไฟกระหน่ำ** (จุดระเบิด) ⚔5+3/🔥 ⏱5.0 | **ไฟประลัย** ⚔4+3/🔥 ⏱5.0 / **ไฟทะลวง** ⚔3+2/🔥 🗡 ⏱5.0 | **ลูกไฟคู่** (ไฟซ้อน) ⚔2+1/🔥 ×2 🔥1 3s/ครั้ง ⏱5.0 | **ฝนไฟ** ⚔2+1/🔥 ×3 🔥1 3s/ครั้ง ⏱5.0 / **ไฟลวก** ⚔2+1/🔥 ×2 🔥2 4s/ครั้ง ⏱5.0 |
| tech `scorch` | **ไฟแผดเผา** 🔥2 5s ×2 🩹30% 5s ⏱6.0 | **ไฟเผาแผล** (ตัดการฟื้น) 🔥2 5s ×2 🩹35% 6s ⏱6.0 | **ไฟต้องสาป** 🔥2 6s ×2 🩹50% 6s ⏱6.0 / **ไฟซึม** 🔥1 8s ×3 🩹35% 6s ⏱6.0 | **ไฟกระจาย** (กองเล็กหลายกอง) 🔥1 4s ×3 ⏱5.0 | **ทะเลเพลิง** 🔥1 5s ×4 ⏱5.0 / **ไฟลามทุ่ง** 🔥2 4s ×3 ⏱5.0 |
| unique (pyro) `inferno` | **ระเบิดเพลิง** ⚔3+85%🔥 🗡 ⏱5.4 | **ระเบิดใหญ่** (จุดระเบิดไฟที่สะสม) ⚔3+125%🔥 🗡 ⏱5.4 | **ระเบิดมหันต์** ⚔3+155%🔥 🗡 ⏱5.4 / **ระเบิดลุกลาม** ⚔3+65%🔥 🗡 🔥3 6s ⏱5.4 | **จุดระเบิด** (สะสมไฟ) ⚔3+85%🔥 🗡 🔥2.5 6s ⏱5.4 | **ระเบิดลาวา** ⚔3+85%🔥 🗡 🔥5 6s ⏱5.4 / **ระเบิดควัน** ⚔3+85%🔥 🗡 🔥3 6s 🐌20% 4s ⏱5.4 |

### ☠ พิษ (poison)

| Skill | Lv1 | Lv2 A | Lv3 A1 / A2 | Lv2 B | Lv3 B1 / B2 |
|---|---|---|---|---|---|
| core `venom` | **เขี้ยวพิษ** ⚔2 ☠1 6s ⏱4.5 | **พิษแรง** (พิษหนัก) ⚔2 ☠2 8s ⏱4.5 | **พิษร้าย** ⚔3 ☠3 8s ⏱4.5 / **พิษกัดกร่อน** ⚔2 🗡 ☠2 8s 🩹30% 4s ⏱4.5 | **เขี้ยวรัว** (พิษถี่) ⚔1 ×2 ☠1 6s/ครั้ง ⏱3.5 | **พายุพิษ** ⚔1 ×3 ☠1 6s/ครั้ง ⏱3.5 / **พิษดูดเลือด** ⚔2 ×2 🩸30% ☠1 6s/ครั้ง ⏱3.5 |
| payoff `plague` | **พิษปะทุ** ⚔2+50%☠ 🗡 ⏱6.0 | **พิษระเบิด** (ระเบิดพิษ) ⚔2+65%☠ 🗡 ⏱6.0 | **มหาพิษ** ⚔3+70%☠ 🗡 ⏱6.0 / **พิษลาม** ⚔2+35%☠ 🗡 ☠2 8s ⏱6.0 | **โรคระบาด** (พิษนาน) ☠1 10s ×2 ⏱6.0 | **ระบาดหนัก** ☠2 10s ×2 ⏱6.0 / **พิษกัดใจ** ☠1 10s ×2 🩹50% 6s ⏱6.0 |
| tech `thorns` | **เกราะหนามพิษ** 🌵2 ⚔5 ⏱7.0 | **หนามแหลม** (สะท้อนแรง) 🌵4 ⚔5 ⏱7.0 | **หนามพิษร้าย** 🌵6 ⚔5 ⏱7.0 / **หนามขัดขวาง** 🌵4 ศัตรูฟื้น 25% ⚔5 ⏱7.0 | **หนามถาวร** (สะสมถาวร) 🌵2 ถาวร ⏱9.0 | **ดงหนาม** 🌵3 ถาวร ⏱9.0 / **หนามหุ้มเกราะ** 🌵2 ถาวร 🛡3 ⏱9.0 |
| unique (thornguard) `spikewall` | **ป้อมหนามพิษ** ⚔4+🌵×2 ☠1 6s ⏱5.2 | **ระเบิดหนามพิษ** (แปลงพิษเป็นดาเมจ) ⚔6+🌵×3+50%☠ ⏱5.2 | **หนามพิษพุ่ง** ⚔8+🌵×4+85%☠ ⏱5.2 / **หนามพิษล้อม** ⚔7+🌵×3.5+55%☠ 🛡7 ⏱5.2 | **ปลูกหนามพิษ** (สะสมพิษ) ⚔4+🌵×2 🌵1 ☠1 6s ⏱5.2 | **สวนหนามพิษ** ⚔7+🌵×3 🌵2 ☠3 6s ⏱5.2 / **หนามพิษฟื้น** ⚔6+🌵×3 🌵1 ☠1 6s ❤6 ⏱5.2 |

### ❄ น้ำแข็ง (ice)

| Skill | Lv1 | Lv2 A | Lv3 A1 / A2 | Lv2 B | Lv3 B1 / B2 |
|---|---|---|---|---|---|
| core `frost` | **ลูกน้ำแข็ง** ⚔5 ❄1s ⏱5.0 | **แช่ยาว** (ล็อกศัตรู) ⚔4 ❄2.05s ⏱5.0 | **ยุคน้ำแข็ง** ⚔12 ❄3s ⏱5.0 / **หนาวสะท้าน** ⚔10 ❄2s 🐌20% 4s ⏱5.0 | **น้ำแข็งคม** (ดาเมจ) ⚔7 ❄1s ⏱5.0 | **หอกน้ำแข็ง** ⚔18 ❄1s ⏱5.0 / **ลูกเห็บ** ⚔7 ×2 ❄0.85s ⏱5.0 |
| payoff `icelance` | **ทวนน้ำแข็ง** ⚔5 🧊×1.7 ⏱5.0 | **ทวนเยือก** (คอมโบแช่แข็ง) ⚔6 🧊×2 ⏱5.0 | **ทวนแหลก** ⚔11 🗡50% 🧊×2.4 ⏱5.0 / **ทวนแช่** ⚔7 🧊×2 ❄0.6s ⏱5.0 | **ทวนเร็ว** (ถี่) ⚔4 🧊×1.5 ⏱3.5 | **ทวนพายุ** ⚔6 🧊×1.5 ⏱3.0 / **ทวนเย็นเฉียบ** ⚔5 🧊×1.5 🐌20% 2s ⏱3.5 |
| tech `glacier` | **ธารน้ำแข็ง** ❄0.95s ⚔5 🗡 ⏱6.5 | **ธารเยือก** (แช่ไม่พลาด) ❄1.45s ⚔5 🗡 ⏱6.5 | **ธารนิรันดร์** ❄1.9s ⚔7 🗡 ⏱6.5 / **ธารสลายโล่** ❄1.45s 💥 โล่40% ⚔6 ⏱6.5 | **ธารคม** (ทะลวง) ❄0.95s ⚔8 🗡 👁 ⏱6.0 | **ธารแหลม** ❄0.95s ⚔14 🗡 👁 ⏱6.0 / **ธารแตก** ❄0.95s ⚔6 ×2 🗡 👁 ⏱6.0 |
| unique (witch) `shatter` | **ทุบน้ำแข็ง** ⚔6 🗡50% 🧊×1.8 ⏱4.1 | **ทุบแตก** (คอมโบแช่แข็ง) ⚔5 🗡50% 🧊×2.2 ⏱4.1 | **ทุบแหลก** ⚔9 🗡 🧊×3 ⏱4.1 / **ทุบแล้วแช่** ⚔7 🗡 🧊×2.6 ❄0.6s ⏱4.1 | **ทุบตรง** (ไม่ต้องรอคอมโบ) ⚔9 🗡50% 🧊×2 ⏱4.1 | **ทุบทะลวง** ⚔11 🗡 🧊×2 ⏱4.1 / **ทุบเย็น** ⚔10 🗡 🧊×2 🐌20% 4s ⏱4.1 |

### 🌪 ลม (wind)

| Skill | Lv1 | Lv2 A | Lv3 A1 / A2 | Lv2 B | Lv3 B1 / B2 |
|---|---|---|---|---|---|
| core `chill` | **ลมกรรโชก** ⚔4 🐌35% 4s ⏱6.5 | **พายุลม** (ช้ามาก) ⚔5 🐌40% 4s ⏱6.5 | **ลมเยือกแข็ง** ⚔4 🐌45% 4s ⏱6.5 / **พายุมีด** ⚔2 🐌40% 4s ⚔3 (ถ้าช้า) ⏱6.5 | **ลมเย็นยาว** (ช้านาน) ⚔5 🐌25% 6s ⏱6.5 | **ลมนิรันดร์** ⚔4 🐌25% 8s ⏱6.5 / **ลมส่งแรง** ⚔3 🐌25% 6s ⏩20% 3s ⏱6.5 |
| payoff `tailwind` | **ลมส่ง** ⏩30% 3s ✨ทั้งหมด 🔥☠ ⚔4 ⏱6.0 | **ลมหมุน** (ล้างดีบัฟ) ⏩40% 3s ✨ทั้งหมด 🔥☠ ⚔3 ⏱6.0 | **พายุหมุน** ⏩40% 4s ✨ทั้งหมด 🔥☠ ⚔3 ⏱6.0 / **ลมชำระ** ⏩30% 3s ✨ทั้งหมด 🔥☠ ❤3 ⏱6.0 | **ลมกรด** (เร็ว) ⏩30% 3s ⚔3 ×2 ⏱5.0 | **ลมพายุ** ⏩40% 3s ⚔2 ×2 ⏱4.5 / **ลมบาด** ⏩30% 3s ⚔3 ×2 🐌20% 2s ⏱5.0 |
| tech `dispel` | **สลายเวท** 💥 🩹40% 4s ⚔5 ⏱6.0 | **สลายใหญ่** (ล้างบัฟ) 💥×2 โล่30% 🩹50% 5s ⚔3 ⏱6.0 | **สลายสิ้น** 💥×3 🩹60% 5s ⚔3 ⏱6.0 / **ทลายโล่** 💥×2 โล่40% 🩹50% 5s ⚔3 ⏱6.0 | **สลายแล้วตี** (ลงโทษบัฟ) 💥 ⚔2+2/อย่าง ⏱6.0 | **สลายพิฆาต** 💥 ⚔2+3/อย่าง ⏱6.0 / **ขโมยพลัง** 💥 ขโมยพลัง ⚔3 ⏱6.0 |
| unique (chrono) `timewarp` | **ลมย้อน** ⚔10 ⏪1.5s ⏱5.0 | **ลมย้อนแรง** (ล็อกเวลา) ⚔10 ⏪1.8s ⏱5.0 | **ลมหยุดกาล** ⚔8 ⏪1.8s 🐌20% 2s ⏱5.0 / **ลมย้อนแล้วช้า** ⚔9 ⏪1.8s 🐌20% 4s ⏱5.0 | **ลมคม** (ดาเมจ) ⚔13 ⏪1s ⏱4.5 | **ลมตัด** ⚔12 ⏪1s ⏱4.5 / **ลมเร่ง** ⚔9 ⏪1s ⏩30% 3s ⏱4.5 |

### ⚙ neutral

| Skill | Lv1 | Lv2 A | Lv3 A1 / A2 | Lv2 B | Lv3 B1 / B2 |
|---|---|---|---|---|---|
|  `ironwill` | **ใจเหล็ก** 🗿 🛡2 ⏱8.0 | **เหล็กกล้า** (กันการคุม) 🗿 80% 🛡2 ⏱8.0 | **ไร้ผล** 🗿 80% +กันแช่แข็ง 1 ครั้ง 🛡2 ⏱8.0 / **เหล็กบริสุทธิ์** 🗿 80% ✨ ⏱8.0 | **ใจสู้** (สู้ต่อ) 🗿 💪+1 ⏱8.0 | **ใจเพลิง** 🗿 💪+2 ⏱8.0 / **ใจกล้า** 🗿 ⚔4 ⏱8.0 |
|  `gear` | **ฟันเฟือง** ⚙↕ สลับบน/ล่าง 40% ⏱3.0 | **เฟืองหนัก** (แรงขึ้น) ⚙↕ สลับบน/ล่าง 70% ⏱3.0 | **เฟืองเหล็ก** ⚙↕ สลับบน/ล่าง 100% ⏱3.0 / **เฟืองโล่** ⚙↕ สลับบน/ล่าง 70% 🛡3 ⏱3.0 | **เฟืองไว** (ถี่ขึ้น) ⚙↕ สลับบน/ล่าง 40% ⏱2.4 | **เฟืองพายุ** ⚙↕ สลับบน/ล่าง 75% ⏱2.4 / **เฟืองคู่** ⚙↕ บน+ล่าง 60% ⏱2.8 |
|  `overclock` | **เร่งเครื่อง** 🚀↕ บน+ล่าง 85% ⏱6.0 | **เร่งแรง** (แรงขึ้น) 🚀↕ บน+ล่าง 100% ⏱6.0 | **เร่งสุดขีด** 🚀↕ บน+ล่าง 115% ⏱6.0 / **เร่งแล้วตั้งรับ** 🚀↕ บน+ล่าง 100% 🛡4 ⏱6.0 | **เร่งไว** (ถี่ขึ้น) 🚀↕ บน+ล่าง 90% ⏱4.5 | **เร่งถี่** 🚀↕ บน+ล่าง 100% ⏱4.0 / **เร่งต่อเนื่อง** 🚀↕ บน+ล่าง 90% คูลดาวน์ไม่เริ่มใหม่ ⏱4.5 |

### Heroes, passives and ultimates

| Hero | Line | Passive | Ultimate | Trigger (Lv1 · Lv2) | Effect (Lv1 · Lv2) | Day-1 shop |
|---|---|---|---|---|---|---|
| นักฆ่า `assassin` | ⚔ ตี | เลือดสูงสุด +8% · การตีครั้งแรกของการสู้แรง ×1.3 · การตีที่โดนทำให้ศัตรูฟื้นน้อยลง 40% 2 วิ | เงาจันทร์ | ศัตรูเลือดต่ำกว่า 55% · Lv2 ศัตรูเลือดต่ำกว่า 70% | ตีทันที ×1 ของการตีที่แรงสุดในการสู้นี้ (ไม่เกิน 30% ของเลือดศัตรู) ไม่สนโล่ หลบไม่ได้ · Lv2 ตีทันที ×1.4 ของการตีที่แรงสุดในการสู้นี้ (ไม่เกิน 42% ของเลือดศัตรู) ไม่สนโล่ หลบไม่ได้ | execute, strike, heavy, charge, jab |
| นักดาบคู่ `duelist` | 💨 หลบ | เลือดสูงสุด −12% · เริ่มสู้พร้อมหลบ 1 · หลบได้แล้ว การตีครั้งถัดไปแรง ×1.4 | ร่ายรำดาบ | หลบครบ 4 ครั้ง · Lv2 หลบครบ 3 ครั้ง | คูลดาวน์ทุกตัวเร็วขึ้น 60% นาน 3 วิ + หลบ +2 · Lv2 คูลดาวน์ทุกตัวเร็วขึ้น 84% นาน 3 วิ + หลบ +2 | flurry, jab, riposte, sidestep, strike |
| อัศวิน `knight` | 🛡 โล่ | เลือดสูงสุด +34% และเริ่มสู้พร้อมโล่ 14% ของเลือด | ป้อมจันทรา | ได้โล่รวม (ไม่นับโล่เริ่มต้น) 20% ของเลือดสูงสุด · Lv2 ได้โล่รวม (ไม่นับโล่เริ่มต้น) 14% ของเลือดสูงสุด | ตีแรงเท่าโล่ที่มี ×1.6 (ไม่เกิน 30% ของเลือดศัตรู) หลบไม่ได้ (โล่ไม่หาย) · Lv2 ตีแรงเท่าโล่ที่มี ×2.2 (ไม่เกิน 42% ของเลือดศัตรู) หลบไม่ได้ (โล่ไม่หาย) | bulwark, shield, stoneskin, cleanse, strike |
| นักรบคลั่ง `berserker` | ❤ ฮีล | โดนตีครบทุก 5 ครั้ง ได้พลังโจมตี +1 · ครั้งแรกที่เลือดต่ำกว่าครึ่ง ได้พลังโจมตีอีก +2 (ทุกการโจมตีของทุก skill จนจบการสู้) | ไม่ยอมตาย | เลือดต่ำกว่า 30% หรือโดนตีจนเลือดหมด · Lv2 เลือดต่ำกว่า 50% หรือโดนตีจนเลือดหมด | ไม่ตาย (เหลือ 1 เลือดถ้าโดนตีจนหมด) ฟื้น 15% ของเลือดสูงสุด + พลัง +2 · Lv2 ไม่ตาย (เหลือ 1 เลือดถ้าโดนตีจนหมด) ฟื้น 21% ของเลือดสูงสุด + พลัง +3 | rampage, feast, train, mend, strike |
| นักเวทเพลิง `pyro` | 🔥 เผา | เลือดสูงสุด +42% · ไฟที่คุณจุดติดนานขึ้น 30% | สุริยะดับ | ไฟบนศัตรูครบ 2 กอง · Lv2 ไฟบนศัตรูครบ 1 กอง | ไฟที่ยังเหลือทั้งหมดระเบิดทันที ×1.4 (ไม่สนโล่ ไฟกองนั้นหมดไป) · Lv2 ไฟที่ยังเหลือทั้งหมดระเบิดทันที ×2 (ไม่สนโล่ ไฟกองนั้นหมดไป) | inferno, ignite, blaze, scorch, jab |
| นักรบหนามพิษ `thornguard` | ☠ พิษ | เลือดสูงสุด +20% · โดนตีทุก 2 ครั้ง ศัตรูติดพิษ 1/วิ 3 วิ · หนามของคุณอยู่นาน 13 วิ และสลายเวทลบได้แค่ครึ่งกอง | หนามพิษ | โดนตีครบ 5 ครั้ง · Lv2 โดนตีครบ 4 ครั้ง | 2.5 วิ: ทุกครั้งที่โดนตี ศัตรูติดพิษอีก 2 กอง และฟื้นเลือดไม่ได้ · Lv2 3.5 วิ: ทุกครั้งที่โดนตี ศัตรูติดพิษอีก 2 กอง และฟื้นเลือดไม่ได้ | spikewall, venom, plague, thorns, strike |
| แม่มดน้ำแข็ง `witch` | ❄ น้ำแข็ง | เลือดสูงสุด +50% · การแช่แข็งที่คุณใส่ศัตรูนานขึ้น 0.3 วิ | ยุคน้ำแข็ง | ใช้ skill สายน้ำแข็งครบ 5 ครั้ง · Lv2 ใช้ skill สายน้ำแข็งครบ 4 ครั้ง | แช่แข็ง 2.5 วิ (ไม่ลดจากโดนถี่ แต่ยังอยู่ใต้เพดาน) + การตีถัดไป ×2 · Lv2 แช่แข็ง 3.5 วิ (ไม่ลดจากโดนถี่ แต่ยังอยู่ใต้เพดาน) + การตีถัดไป ×2.4 | shatter, frost, icelance, glacier, strike |
| จอมเวทลม `chrono` | 🌪 ลม | เลือดสูงสุด +20% · ความช้าที่คุณใส่แรงขึ้น +10% และนานขึ้น 1 วิ · ตีศัตรูที่ช้าหรือถูกแช่แข็งอยู่แรงขึ้น 10% | พายุย้อนกาล | ใส่ช้า/ถ่วงเวลาติดครบ 3 ครั้ง · Lv2 ใส่ช้า/ถ่วงเวลาติดครบ 2 ครั้ง | skill ทุกตัวพร้อมใช้ทันที + พัดดีบัฟทิ้งทั้งหมด + เร็วขึ้น 30% 3 วิ · Lv2 skill ทุกตัวพร้อมใช้ทันที + พัดดีบัฟทิ้งทั้งหมด + เร็วขึ้น 42% 3 วิ | timewarp, chill, tailwind, dispel, jab |


---

# History: the 4 archetypes (sim v10–v11)

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

## Sim v11 update (19 Nov 2026): auto-tuner pass + exploit fixes

Numbers now live in `src/sim/tuning.ts` (multipliers and values) on top of the base literals in `src/sim/skills.ts`;
see docs/TUNING.md. The intended curves above (early / mid / late per hero) are now target bands in
`scripts/tune/curves.ts`, searched by `npm run tune`. The v10 curve table above is history; the live one is below.

### What changed

| knob | v10 | v11 | why |
|---|---|---|---|
| `run.startHp` (START_HP) | 20 | 17 | reach-10 rates were 33–65% (target 15–45%) |
| `hp.early` / `hp.mid` / `hp.late` (base HP days 1–3 / 4–7 / 8+) | 1 | 1.06 / 1.04 / 1.06 | days 5 and 8–10 fights were below their length target |
| `control` (freeze / slow / delay seconds) | 1 | 1.05 | |
| `cd.pyro` (ระเบิดเพลิง tree cooldown) | 6 s | 4.8 s | pyro was dead on day 3 (12%): its 6 s unique barely fired in an 8 s fight |
| `uniq.pyro.lv3`, `hp.pyro` | 1, +0% | 1.2, +14% | pyro's curve |
| `cd.witch` (ทุบน้ำแข็ง), `uniq.witch.lv3` | 4.5 s, 1 | 4.1 s, 0.95 | |
| `hp.witch` / `hp.chrono` | +16% / +16% | +20% / +18% | |
| `cd.chrono` (บิดเวลา) | 5 s | 5.5 s | chrono was too strong on days 3–6 for a mid–late hero |
| `cd.knight` / `cd.berserker` | 1 | 1.05 | |
| `uniq.assassin.lv1` / `lv3` | 1 / 1 | 1.1 / 1.2 | assassin fell to 29% on day 15 |
| `uniq.berserker.lv3`, `berserker.hits` | 1, 5 | 0.9, 6 | berserker 63% on day 3 and 72% on day 15 |
| `hp.thornguard` / `hp.duelist` | +20% / +0% | +18% / +6% | |
| `knight.shield` | 12% | 10% | |
| เร่งเครื่อง power a / a1 / a2 / b / b1 | 1.3 / 1.6 / 1.3 / 1.1 / 1.25 | 1.0 / 1.15 / 1.0 / 0.9 / 1.0 | exploit report #1: overclock in 88% of top builds, one-shots on day 9 |
| ระเบิดลุกลาม burn share (base) | 0.75 | 0.4 (live 0.48 every 4.8 s) | exploit report #4: 100% on day 12 |
| ฟันพายุ / แทงทะลุ hit | 6 ×4 / 12 | 4 ×4 / 10 | exploit report #2: Lv3 rush on day 3 |
| เฟืองพายุ cooldown, เฟืองไว power | 2 s, 0.5 | 2.4 s, 0.4 | exploit report #5 |
| POWER_BONUS (links.ts) | 0.25 | 0.15 | connect-bonus luck decided early fights (no measurable effect on bot fights) |

### Achieved curves (`npm run sim -- all --n 200 --days 3,6,9,12,15`, tier normal, seed 1)

Win rate vs the field; v10 in brackets. Targets: curve bands in `scripts/tune/curves.ts` (center ±5).

| Hero | Curve | d3 | d6 | d9 | d12 | d15 | reach 10 |
|---|---|---|---|---|---|---|---|
| นักดาบคู่ duelist | early | 43 (49) | 59 (58) | 49 (49) | 44 (47) | 40 (38) | 37% (41) |
| แม่มดน้ำแข็ง witch | early | 67 (60) | 53 (46) | 49 (41) | 50 (40) | 39 (34) | 41% (36) |
| นักฆ่า assassin | early–mid | 57 (54) | 58 (57) | 48 (49) | 40 (41) | 27 (29) | 42% (45) |
| จอมเวทเวลา chrono | mid–late | 57 (60) | 48 (54) | 45 (51) | 51 (57) | 43 (47) | 43% (50) |
| นักรบหนาม thornguard | mid–late | 51 (58) | 51 (55) | 56 (57) | 54 (55) | 60 (62) | 54% (65) |
| อัศวิน knight | steady, best late | 39 (44) | 48 (51) | 54 (60) | 52 (57) | 54 (61) | 43% (54) |
| นักรบคลั่ง berserker | late | 49 (63) | 41 (49) | 50 (56) | 52 (57) | 71 (72) | 47% (62) |
| นักเวทเพลิง pyro | late | 36 (12) | 42 (31) | 47 (37) | 57 (46) | 66 (58) | 39% (33) |

Sim targets: 7 of 28 missed (v10: 12). Fixed: day-6 hero pairs (76 → 69%), fight length on every day, reach 10 of
knight and chrono (berserker 62 → 47%, thornguard 65 → 54%: still just over 45%), hero spread on days 3–9.
Still open: day 3 worst pair 84% (was 94%; witch / chrono vs pyro), and **day 15**: berserker 71%, assassin 27%
(berserker beats assassin 86%, scaling vs burst 81%). Burst is meant to fade late, but not this far. The next tuning
round should target day 15 (assassin Lv3, berserker's late scaling) and duelist's early peak (43% on day 3, meant ~58%).
Health: 0-skill 0.1%, fatigue ≤ 12% every day, average fight 13.9 s.
