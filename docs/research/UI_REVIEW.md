# UI review of the list version (commit 49ff9ae, 19 Nov 2026)

Screenshots were taken of every screen at three sizes: PC 1440×900, phone landscape 844×390 and phone portrait 390×844.
The "Page scrolls" column is the page height in pixels compared with the screen height; the goal is one screen with no scrolling.

| Screen | PC | Landscape phone | Portrait phone |
|---|---|---|---|
| Town (home) | ✅ 900/900 | ❌ 603/390 | ✅ |
| Hero pick | ❌ 1367/900 | ❌ 1129/390 | ❌ 1770/844 |
| Shop | ✅ 900/900 | ❌ 1521–1744/390 | scrolls (acceptable) |
| Fight | ✅ | ❌ 639/390 | ✅ |
| Result | ✅ | ❌ 1509/390 | ❌ |
| Run over | ❌ 1769/900 | ❌ | ❌ |
| Leaderboard / Profile | ❌ 965 / 929 | ❌ | ✅ |

## What already works
- The one-screen shop on PC works: shop, my skills, timeline and bonus panel sit side by side.
- The new skill icons are used on shop cards and list rows, and each archetype has a coloured bar.
- The Thai/English switch works.
- The festival background art is used.

## Problems on every screen
1. **Text written directly on the art is unreadable.** This affects the town subtitle, "เลือกฮีโร่" (pick a hero), the run summary and "Run over". Put the text on a semi-transparent panel or add a strong text-shadow.
2. **The first header button ("? วิธีเล่น", how to play) is a white box with no visible text**, so the light background swallows it. The TH/EN and mute buttons look fine.
3. **Phone landscape gets the portrait layout**, so it scrolls even more than portrait does. When `orientation: landscape` and the height is ≤ 500px, it should use the PC layout, scaled down.
4. **Several panels are still flat black:** the town menu panel, the name input, the fight log and the empty-slot boxes. Use `bg-panel` with the moon-colour border, like the shop panels.

## Each screen
- **Town:**
  - The Phaser canvas is a small 576px box in the top middle, with the menu below it as a black box.
  - Make the canvas fill the screen, and put the building buttons and menu as cards over the art.
- **Hero pick:**
  - The hero cards are below the fold.
  - On PC, put the arena preview on the left and the 3 hero cards in a row on the right, with the name and the start button in the same frame.
- **Shop (PC):**
  - The left column under the arena canvas (190px) is empty all the way down. Use it for hero and HP information or the timeline, or make the canvas bigger.
  - The "ซื้อแล้ว" (sold) slots take up as much space as real cards. Shrink them to a thin strip.
  - The bonus panel sits at the bottom and is cut off.
- **Fight:**
  - The arena canvas is small (340px) in the top left, and the space below it is empty and dark.
  - Make the arena large, about 60–65% of the width, with the log and HP bars beside it.
- **Run over:**
  - The panel overlaps the town canvas, and the page scrolls 1769px.
  - Make it a modal or a single-screen summary.
- **Leaderboard and profile:** these sit below the town canvas. Make them pages of their own that fill the screen.

## Chains and synergy: not done yet (main point)
What exists now:
- Each row has a text chip such as "🔗 » ขยายพลัง" or "🔗 ⚔ ทุบหนัก".
- While dragging, the `synergy-preview` class makes the would-link row glow.
- The `.synergy-icon` CSS exists but nothing uses it.
- There is no line between rows. Active links don't glow. Nothing happens when a link connects. Fights don't show chains.

What to do:
1. **Partner chips use pictures:** `[▲ or ▼][partner skill icon or arch emblem] +2⚔`.
   - The arrow says whether the partner goes above or below.
   - The chip lights up gold when the partner is in place, grey when it isn't.
   - Use `skillIcon()` / `archIcon()`, which already exist.
2. **Connectors between rows:** a gap between each pair of adjacent rows with a vertical line or bead.
   - No link: dashed grey.
   - Link active: glowing gold, with the bonus as a label (e.g. "+2 ⚔").
   - When rows move, the line slides with them.
3. **Dragging:**
   - Rows that would link glow, and a dashed preview line pulses.
   - **When the drop makes a new link:** a sparkle burst on the line, the `link` sound, and a toast such as "🔗 ฟัน + ทุบหนัก: +2 ดาเมจ".
   - When the drop breaks a link, the line fades out.
4. **Shop cards:**
   - Hovering or tapping a card makes the rows it links with glow, and a "put it here" slot shows in the list.
   - On the card, show "เข้ากับ:" (pairs with) followed by partner icons. Icons of skills you already own get a ✓.
5. **Bonus panel:** move it to the top of the "skill ของคุณ" (your skills) column so it's always visible. Show it as icons, e.g. `[icon]+[icon] = +2⚔`.
6. **In a fight:**
   - When a chain fires (`🔗ต่อ`), flash the line between the two skills in the timeline.
   - Over the hero in the arena, show text such as "Chain!" and both skills' icons.

Checks: update the selectors in `tests/e2e/e2e.mjs`, and add a "page does not scroll" check (`scrollHeight <= innerHeight + 2`) for PC 1440×900 and landscape 844×390.
