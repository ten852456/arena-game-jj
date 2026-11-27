# Mochi Moon: UI & Combat Feel Research Brief

Scope: the owner's complaints, plus the patterns other games use to solve them. Each item is tagged **[src]** (from a cited source) or **[obs]** (from gameplay observation, with no written source found; check against video before copying). Numbers are starting values to tune in playtests.

---

## 1. Gold isn't visible where you buy

- **[obs] TFT, Underlords:** the gold counter sits directly on the shop bar, next to the Reroll and Buy XP buttons. Your eye never leaves the shop to check what you can afford. TFT's 9.24 interface update rearranged the shop bar's buttons to keep it compact [src: TFT Interface Update].
- **[obs] Hearthstone BG / Backpack Battles:** coins show next to the shop, and cards you can't afford are dimmed.
- **[src] Balatro** gives money one fixed colour everywhere: gold #f0c040 [Crosley].

**Mochi Moon:** put a coin pill (36px tall on PC, 32px on phone) at the top-left of the shop panel. Use 22–26px bold numerals in #f0c040 with a dark outline. Every price tag uses the same coin icon and colour. Dim unaffordable cards to 50% saturation and show the price in red. When you buy, a coin flies from the pill to the card over about 250ms, and the number rolls down with a 0.4s spring (cubic-bezier 0.34,1.56,0.64,1) [Crosley].

## 2. Upgrade offers aren't obvious

- **[obs] TFT / Underlords:** a shop card for a unit you already own gets a shimmering gold border. If buying it would complete a 3-of-a-kind, it also gets a chevron or star badge.
- **[obs] Hearthstone BG:** a tavern minion that would make a golden triple is highlighted. The triple itself fuses with a golden burst [src: Icy Veins mechanics].
- **[src] Super Auto Pets:** you drag a duplicate from the shop onto the pet you own to merge it [SAP wiki]. The target is the pet itself, not an empty slot.

**Mochi Moon:** a shop card for a skill you own gets:
- a green **▲ Lv2** badge in the top-right corner, 28px. It bobs 3px up and down every 1.2s.
- a gold shimmer sweep across the card every 2.5s.
- a "next level" stat delta in the tooltip, e.g. `12 → 18`, with the new value in green.

At the same time, the matching skill in the build list pulses a soft gold outline, so the player sees which owned skill the purchase upgrades. When the upgrade is bought, the skill does a squash-and-pop (scale 1→1.25→1 over 220ms), a starburst plays, and the level pips fill.

## 3. HP, day, and wins should be more prominent

- **[obs] TFT:** the HP list stays on screen at all times on the right. Each player's portrait shows a large HP number.
- **[obs] The Bazaar / Backpack Battles:** a top bar shows Day or Round, wins as icons, and lives as hearts.
- **[src] Balatro** gives each resource its own colour: green for hands remaining, blue for chips, red for mult [Crosley].

**Mochi Moon:** use a top HUD band 56px tall (48px on phone) with three chunky chips:
- **HP:** heart icons, or a pink bar labelled "HP 7".
- **Day:** moon-phase icon plus "Day 4", so the moon fills as days pass.
- **Wins:** a row of 10 star slots that fill gold.

Use 28px numerals, cream text with a dark outline. On a change, scale the chip to 1.3 over 150ms, then settle back with a spring. On HP loss, flash the chip red, show "-1 ♥", and shake it ±4px for 300ms. On a win, a star flies into its slot.

## 4. You can't see where a new skill will go

- **[src] Backpack Battles:** you buy by dragging an item straight from the shop into the backpack grid [yekbot]. It is reported (unverified) that valid cells light green and invalid ones red while dragging [seeles]. Adjacency synergies show as star-marked links [casualgameguides].
- **[obs] Super Auto Pets:** while you drag, the team slots open a gap where the pet will land.

**Mochi Moon:**
- When you hover or select a shop card, show a **ghost**: a 40%-opacity copy of the card at the default insert spot in the build list. Dashed chain lines go to its new neighbours, each labelled with the chain bonus it would gain ("+Chain: Burn → Freeze").
- **Drag-and-drop:** dragging a shop card into the list opens a gap at the cursor position (neighbours slide apart over 120ms) and shows a price tag next to the cursor. Dropping the card buys it.
  - Dropping onto an owned copy upgrades it.
  - Dropping back on the shop cancels.
  - Dragging a skill from the build onto a coin-jar sell zone (bottom of the shop, shows "+3g") sells it.
- On phone, tap to select. The ghost appears, with insert-slot "+" targets of at least 44px, and you tap a slot to confirm.

## 5. Skills don't feel impactful in fights

- **[src] The Bazaar:** a crawling scanline over each card shows the time until it next fires. On activation the card "dips a little and jolts back up". Slow and haste "shoot a little glowing light at their target" [Load Last Save]. Haste doubles charge speed, Slow charges at half speed, and Freeze stops charging entirely [Mobalytics].
- **[src] Balatro:** layered "juice stack", where no single feedback channel carries the experience alone. Shake grows with score: ±1–2px for 0.2s, ±3–4px for 0.3s, ±6–8px plus ±1° for 0.5s [Crosley].
- **[src] General hit feedback:**
  - Hit-stop: 0–30ms for weak hits, 50–80ms strong, 100–150ms critical [uhiyama].
  - Heavy hits: up to about 180ms [Godot forum].
  - White flash: 80ms [uhiyama].
  - Damage numbers rise and fade over 0.5–1.5s [bugnet].

**Mochi Moon:** each skill fire becomes a three-beat sequence (described under "Fire" in the recipe below). Fights should run at 1x by default, with a 2x toggle.

## 6. Chain-triggered instant fires need an extra effect

- **[src] Balatro:** Jokers fire left to right, each with a pulse, and the running total updates in sequence. Each scored card plays a rising note (C-D-E-F-G) [Crosley].
- **[obs] Bazaar:** a triggered item fires with a flash on the link between items.

**Mochi Moon:** draw a lightning or star-thread along the list from the source skill to the chained skill, 120ms. Then show a "CHAIN!" callout (×2, ×3…) in pink and gold above the fighter. Each chain step raises the SFX pitch by +2 semitones and the popup scale by +15%, and adds +20ms hit-stop.

## 7. Status visuals on fighters

- **[src] Conventions:** burn is orange, poison green, cold blue or white [gamejuice, ENWorld]. Status colours rarely differ between games [indiedb].
- **[obs] The Bazaar:** frozen items get a frosted blue ice overlay and stop their cooldown sweep.

**Mochi Moon** gives each status a sprite tint plus an overlay, and the same icon on the skill card:

| Status | Fighter visual | Skill-card visual |
|---|---|---|
| Freeze | blue tint #8fd3ff at 60% multiply, translucent ice-cube overlay, sprite idle stops, frost particles; on expiry the ice shatters into 6–10 shards | cooldown sweep stops, frosted card |
| Burn | orange flicker #ff8a3d alternating 0/40% every 100ms, small flames, ember particles rising | none listed |
| Slow | desaturate 30%, purple swirl at feet, idle animation at 0.5x | sweep turns grey-purple |
| Haste | green/cyan speed lines, idle at 1.5x | sweep glows green and ticks faster |
| Shield | pastel bubble around the fighter that wobbles when hit and pops when broken | none listed |
| Thorns | pink spiky outline; attackers get a small "prick" counter-hit | none listed |
| Heal | soft green glow, "+N" number, sparkle | none listed |

---

## Combat juice recipe (starting numbers)

**Fire (each skill activation)**
1. **Anticipation:** the card lifts 8px and scales to 1.1 over 80ms. The caster squashes (scaleY 0.9).
2. **Fire:** the card dips and jolts back like in The Bazaar. A projectile or effect travels to the target in 150–250ms.
3. **Impact:** hit-stop, white flash, damage number.

**Hit-stop (freeze the whole fight)**
| Hit | Hit-stop |
|---|---|
| Small (<10% max HP) | 40ms |
| Medium | 70ms |
| Big (≥25%) / crit | 120ms |
| Kill blow | 180ms plus slow-mo at 0.3x for 400ms |

**Screen shake (decaying, not looped)**
| Hit | Shake |
|---|---|
| Small | ±2px for 150ms |
| Medium | ±4px for 250ms |
| Big | ±8px plus ±1° for 400ms |

Add a "reduce shake" setting.

**Flash**
- Target goes white for 80ms, then pink #ff7aa8 at 30% for 120ms. Keep the sprite readable, which matches the recent commit b3257e5.

**Squash and stretch**
- Target is knocked back 6–12px and squashes to scaleX 1.15 / scaleY 0.85 for 60ms, then springs back over 200ms.
- Caster stretches to scaleY 1.1 when firing.

**Damage numbers**
- Pop in at scale 0 → 1.4 → 1.0 over 150ms, rise 40px, and fade over 800ms.
- Base size 24px. Big hits 32px. Crits 40px gold with "!" and a starburst behind.
- Colours: damage white, burn orange, heal green "+", shield blue, thorns pink.
- Jitter x by ±10px so stacked numbers don't overlap.

**Chain trigger**
- Link beam of 120ms, then the "CHAIN ×N" callout.
- Each step adds +2 semitones to the SFX, +15% to the number scale, and +20ms of hit-stop, capped at ×5.
- Pastel radial burst ring of 300ms on the triggered card.

**Cooldown readability**
- Bazaar-style fill or sweep over each skill icon.
- The last 300ms before firing, the icon pulses (scale 1.05) to set up anticipation.
- Haste and slow each send a small glowing orb from the source to the affected skill [Load Last Save].

**Audio**
- Every visual beat gets a sound.
- Pitch up on combos (Balatro's rising notes).
- Use a soft "mochi squish" for normal hits and a "bell chime" for crits.

---

### Sources
- Crosley, Balatro juice guide: https://blakecrosley.com/guides/design/balatro
- Load Last Save, The Bazaar review: https://loadlastsave.substack.com/p/the-bazaar-review
- Mobalytics, Bazaar keywords: https://mobalytics.gg/the-bazaar/guides/keywords-and-terms
- Mobalytics, The Bazaar review: https://mobalytics.gg/gamebase/reviews/the-bazaar-review
- uhiyama-lab, hit feedback primer: https://uhiyama-lab.com/en/notes/unity/unity-game-feel-hit-feedback/
- Godot forum, hit-stop and shake: https://forum.godotengine.org/t/tutorial-hit-stop-and-screen-shake-in-godot-4-autoload-trauma-camera-mit/145240
- bugnet, damage numbers: https://bugnet.io/blog/how-to-build-a-damage-number-system
- eastondev, feedback layers: https://eastondev.com/blog/en/posts/dev/20260521-game-feedback-feel/
- TFT Interface Update: https://teamfighttactics.leagueoflegends.com/en-gb/news/game-updates/tft-interface-update/
- Icy Veins, HS Battlegrounds mechanics: https://www.icy-veins.com/hearthstone/hearthstone-battlegrounds-mechanics-guide
- Super Auto Pets wiki: https://superautopets.wiki.gg/wiki/The_Basics
- Backpack Battles guide: https://www.yekbot.com/backpack-battles-guide-game-basics-tips-and-recipes/
- Backpack Battles layout: https://casualgameguides.com/walkthroughs/backpack-battles/backpack-layout-item-positioning
- Backpack Battles drag preview (unverified): https://www.seeles.ai/games/strategy/backpack-battles
- Colour as feedback language: https://gamejuice.pages.dev/articles/color-as-feedback-language
- ENWorld, damage colours: https://www.enworld.org/threads/rpg-evolution-what-color-is-your-damage.685206/latest
- IndieDB, buffs and conditions: https://www.indiedb.com/features/game-elements-3-buffs-conditions
