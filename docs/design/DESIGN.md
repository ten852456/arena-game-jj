# Mochi Moon art bible (DESIGN.md)

The single source of truth for how Mochi Moon looks, moves and sounds: in the game, in every generated asset,
and in every promo video, post and banner. When a prompt, a new asset or a video disagrees with this file,
this file wins. When this file disagrees with what ships, fix one of them in the same change.

- File lists, sizes and the generation pipeline are in [ASSETS.md](ASSETS.md); this file says what the art
  must look like, and gives the prompt blocks to make it.
- Colour values below are copied from the code (`src/web/styles/theme.css`, `src/web/art/assets.ts`,
  `src/web/art/chibi.ts`). The code is the truth; update this file when they change.

---

## 0. Style decision (2026-11-21)

Eight styles were tested on the same Knight prompt (Codex, same subject, only the style changed) and shown to
players. Decision:

| Style | Role |
|---|---|
| **1. Kawaii chibi, thick plum outline, flat pastel** | **The game's style.** In-game art, icons, UI, backgrounds, hero art. Everything in §1–§8 describes this style. |
| 5. Layered papercraft diorama | **Promo videos and trailers.** Its layers move apart for parallax in video. Characters keep their in-game look and colours, only the material changes to cut craft paper. |
| 6. Felt plush toy | **Merch and keepsakes** (plush, stickers, physical goods). Same rule: the in-game design, made of felt. |

Not used: ink + watercolor, full watercolor, sumi-e, soft 3D clay, Thai moon festival (kept as an idea for a
Loy Krathong season skin). Style prompts for 5 and 6 are in §7.

---

## 1. The world in one paragraph

A moon festival where round mochi heroes fight in a lantern-lit stone arena. Night is lavender and indigo, the
full moon is huge and warm, cherry blossoms fall, and the Moon Rabbit pounds mochi in a wooden mortar.
**Cozy to look at, sharp to play:** the art is soft and kawaii, the fights are fast, readable and a little
dramatic. Nothing is grim, gory or edgy; defeat is a bandage and a pout, not blood.

**Pillars**

1. **Moon night, always.** Every scene is at night under the full moon. Warm light comes from the moon and
   paper lanterns, never from a daytime sun.
2. **Round and soft.** Mochi bodies, rounded tools, puffy clouds, squishy buttons. No sharp angular frames.
3. **Readable at a glance.** Icons read at 32–40 px; each element line has one colour and one silhouette.
4. **Hand-made, not glossy.** Rice paper, felt, stitched thread, wax seals, painted wood. No glassmorphism,
   no neon, no chrome, no photoreal.
5. **The moment is gold.** Gold and the moon colour are saved for rewards and peaks (★★★, champion, ult,
   victory). If everything glows, nothing does.

---

## 2. Colour

### 2.1 Core palette

| Token | Hex | Use |
|---|---|---|
| Art outline (plum) | `#3a2b33` | every outline in painted art and chibi SVG. **Never pure black.** |
| UI ink | `#3a2b48` | outlines and text strokes in the HTML UI (`--ink`) |
| Ink deep | `#150e27` | deepest shadow, card edges (`--ink-deep`) |
| Night 1 / 2 / 3 | `#2a2150` / `#352b63` / `#43387a` | panel and card fills, darkest to lightest (`--night*`) |
| Badge disc | `#2b2455` | inner disc of every round badge |
| Cream | `#fff4e4` | text on dark, mochi skin highlight, paper (`--cream`) |
| Moon | `#ffe3a3` | the moon, ult and reward glow (`--m-moon`) |
| Gold | `#ffd572` | ★, primary button, stardust (`--m-gold`) |
| Peach | `#ffc39c` | warm accent (`--m-peach`) |
| Pink | `#ffb3c7` | blossoms, blush, friendly accent (`--m-pink`) |
| Hot pink | `#ff6f91` | the one saturated pink, for art highlights only |
| Lavender | `#d4c8f7` | sky haze, secondary text on dark (`--m-lav`) |
| Mint | `#b2ebcb` | good / heal / "fits your build" (`--m-mint`) |
| Sky | `#c7e4ff` | info, rare (`--m-sky`) |

Background art sits in the lavender to indigo range, and gets darker and softer the more UI sits on top of it
(see `bg-game-wide`: −15 % saturation, −18 % brightness, light blur).

### 2.2 Element lines (identity colours)

Each of the 8 lines owns one ring colour. Use it for the skill badge ring, the line chip, synergy borders,
VFX tint and the hero's promo colour accent. Source: `LINE_COLORS` in `src/web/art/assets.ts`.

| Line | Ring | Hero | Shape language for icons and VFX |
|---|---|---|---|
| hit | `#ff9a9a` | Assassin (นักฆ่า) | slashes, daggers, impact stars |
| dodge | `#b6f0c8` | Duelist (นักดาบคู่) | rapier lines, afterimages, footsteps |
| shield | `#9ccbff` | Knight (อัศวิน) | shields, plates, a shine sweep |
| heal | `#ffb3d9` | Berserker (นักรบคลั่ง) | hearts, leaves, rising sparkles |
| burn | `#ffb070` | Pyromancer (นักเวทเพลิง) | rounded flames, embers |
| poison | `#c49cff` | Venom Thornguard (นักรบหนามพิษ) | bubbles, thorns, drips |
| ice | `#9df0ff` | Ice Witch (แม่มดน้ำแข็ง) | 6-point snowflakes, shards, crystals |
| wind | `#d8f5a2` | Wind Mage (จอมเวทลม) | swirls, feathers, hourglass |
| none | `#c6c1e8` | neutral skills | crescent moon |

> **Known drift to fix:** `style.css` still has an older archetype set (`--tank #5aa0e6`, `--burst #e65a5a` …)
> and ASSETS.md lists archetype ring colours from set 2. The line colours above replace both for any new art.

### 2.3 Rarity and status

| Tier | Frame asset | Colour |
|---|---|---|
| Common | `frame-common` | cream |
| Rare | `frame-rare` | sky `#cfe8ff` |
| Epic | `frame-epic` | lavender `#b48cff` |
| ★★★ | `frame-star3` | gold `#ffd572` |
| Relic | `frame-relic` | stitched parchment |
| Hero-unique skill | gold star on the ring | `#e8b84a` |

Win `#4fd16b`, lose `#ff6b6b`. Use them for text and numbers, not for large painted areas.

---

## 3. Type

- **Kanit** (400, 600) for body text, **Mitr** (500) for headings. Both are Google Fonts with Thai and Latin.
- **Thai first.** Every layout must fit Thai, which runs longer and taller than English. Write Thai copy first,
  then English.
- **Painted art never contains text.** The only exception is the logo (`logo.webp`). Banners, ribbons,
  cards and thumbnails get their text from HTML, canvas or the video editor, so the art works in both languages.
- Numbers in fights (damage, heals) are chunky Kanit 600 with a plum outline.

---

## 4. Characters

### 4.1 How a mochi is built

- **Body:** a round, slightly squashed mochi blob, about 1:1 width to height. The head is the body. Stubby
  arms, tiny feet or none.
- **Face:** two eyes, a small mouth and pink blush ovals. Allowed eye sets: dot, sparkle, brave, happy, sleepy.
  Mouths: smile, cat (`ω`), open, fang.
- **Ears:** bunny, perky, tipped or floppy (all mochi are part moon rabbit).
- **Outline:** thick plum `#3a2b33`. Light comes from the upper left, with one soft cel-shade step.
- **Body colours:** cream to white (`#fff6ec`, `#ffffff`, `#fff0f3` …). No grey or dark skin on the body itself.

### 4.2 The eight heroes

Each hero is recognisable from its **iconic parts** (they never change) and its **accent colour**. Everything
else can be rolled per player (`rollLook` in `chibi.ts`).

| Hero (TH / EN) | Line | Iconic parts | Outfit / trim | Accent | Ult |
|---|---|---|---|---|---|
| อัศวิน / Knight | shield | helmet, sword, shield, cape | `#5b7fd6` / `#f2c14e` | `#ff6b81` | ป้อมจันทรา / Moon Fortress |
| นักรบหนามพิษ / Venom Thornguard | poison | leaf cap, club, buckler, thorns on back | `#6fae5a` / `#9a6a46` | `#b4e36e` | หนามพิษ / Venom Thorns |
| นักฆ่า / Assassin | hit | hood, twin daggers | `#4a3a63` / `#d8504a` | `#ff6f8a` | เงาจันทร์ / Moon Shadow |
| นักดาบคู่ / Duelist | dodge | beret, rapier, cape | `#ff7aa2` / `#fbe0a0` | `#ffd1e0` | ร่ายรำดาบ / Blade Dance |
| นักรบคลั่ง / Berserker | heal | horned helm, axe | `#c75b39` / `#f4ead2` | `#f08a4b` | ไม่ยอมตาย / Undying |
| นักเวทเพลิง / Pyromancer | burn | flame cap, flame staff, tome | `#e2533d` / `#ffc857` | `#ffb347` | สุริยะดับ / Sunfall |
| แม่มดน้ำแข็ง / Ice Witch | ice | witch hat, ice wand, orb, crystals on back | `#4f78c8` / `#c8eeff` | `#8fe8ff` | ยุคน้ำแข็ง / Ice Age |
| จอมเวทลม / Wind Mage | wind | star cap, hourglass, halo | `#7b5cc4` / `#ffd36e` | `#c49bff` | พายุย้อนกาล / Rewind Storm |

### 4.3 Supporting cast

- **Moon Rabbit:** the mascot. A tall white chibi rabbit in a pink kimono with a blossom hair pin, pounding
  mochi with a wooden mallet in a mortar painted with a cherry blossom. It appears on the title, the share
  image and video end cards. It never fights.
- **Mochi crowd:** plain round white mochi with happy faces and `\\ //` cheer marks. Use them for crowds,
  reactions and filler.
- **Personality:** brave, a bit cheeky, never mean. Defeat = bandage, swirl eyes, a pout.

---

## 5. Rendering rules (for every painted asset)

1. Kawaii chibi, rounded shapes, **thick plum outlines** `#3a2b33` (never black).
2. Flat pastel fills with **one** light cel-shade step and a small soft highlight. Light from the upper left.
3. Soft glow only around light sources (moon, lanterns, magic) and reward moments.
4. Backgrounds: lavender and indigo sky, big warm moon, lanterns, blossoms. Keep a calm area where UI or a logo goes.
5. Icons: one big simple symbol, readable at 40 px, no busy detail, no small text.
6. **Never:** text or letters (except the logo), watermarks, photoreal textures, pure black, neon, chrome,
   blood or gore, real-world logos, copies of existing characters or memes.

---

## 6. Asset families and specs

| Family | Size (source → shipped) | Background | Rules |
|---|---|---|---|
| Wide background | 16:9 → 1920×1080 webp ≤ 450 KB | full scene | calm zone for UI; in-run backdrop is muted and blurred |
| Round badge (skill, line, archetype) | 1024² → 128² webp | `#ff00ff` key | plum outline → line-colour ring → thin plum line → `#2b2455` disc with soft glow and 2–3 faint stars → one symbol at ~60 % of the disc. Hero-unique skill: small gold star on the ring |
| Relic | 1024² → 192² webp | `#ff00ff` key | a single object, no disc, cream/pastel with plum outline (see `relic-bastion`) |
| Mark seal | 1024² → 128² webp | `#ff00ff` key | wax seal with one embossed symbol; hidden mark = mystery swirl |
| 9-slice frame | 256×320 (relic 280×360) | transparent | insets 64/80/64/80 (relic 70/90/70/90); keep ornaments in the corners, not mid-edge |
| Pips and bursts | 64² / 128² | transparent | star pip, ★★★ burst, ult moon pip on/off; on and off must have the same silhouette |
| Banner / ribbon | ~900×570 | transparent | empty ribbon, text added later |
| Share card | 1200×630 | full | `buildcard-bg` + `buildcard-frame`; also used for `og.jpg` |

Pipeline (Codex image generation → key `#ff00ff` → crop → resize → webp) is in [ASSETS.md](ASSETS.md) and
`tools/assets/images.py`. After every batch, make a contact sheet (`tools/assets/contact_sheet.py`) and
check each icon at 128 / 64 / 40 / 32 px on dark and light backgrounds.

---

## 7. Prompt kit

Copy the shared block into every image prompt, then add one family block and one subject line per image.
Generate one image per call, never download references from the internet, and keep the prompt files in
`tools/assets/prompts/` so any asset can be regenerated.

**Shared style block**

```text
Art direction for the cute mobile game "Mochi Moon": soft cozy kawaii chibi style, rounded shapes, thick dark
plum outlines (#3a2b33, never pure black), flat pastel colours with one light cel-shade step, light from the
upper left. Moon-night palette: lavender and indigo night sky, a huge softly glowing warm full moon (#ffe3a3),
cream (#fff4e4), pastel pink (#ffb3c7) and peach accents, soft gold glow (#ffd572), small sparkly stars.
No text, no letters, no numbers, no watermark, no UI elements, no pure black, no photorealism, no gore.
```

**Family blocks**

- *Badge:* `Square 1024x1024 on a plain flat pure #ff00ff background. A centred round badge filling ~88% of
  the canvas: thick plum outline, then a thick glossy ring in <RING HEX>, a thin plum line, and an inner disc
  of deep indigo (#2b2455) with a soft glow and 2-3 faint stars. In the middle ONE big bold simple symbol
  (~60% of the disc), readable at 40 px.`
- *Relic:* `Square 1024x1024 on plain flat #ff00ff. One cute chunky object, centred, ~80% of the canvas,
  no badge, no ground shadow.`
- *Hero key art:* `Portrait 1024x1536 (or 1024x1024) on plain flat #ff00ff. One mochi hero, full body, 3/4
  view, dynamic but cute pose. Body: round cream mochi blob with <EARS> ears, <EYES> eyes, pink blush.
  Iconic parts: <PARTS>. Outfit <OUTFIT HEX> with <TRIM HEX> trim, magic accent <ACCENT HEX>.`
- *Scene:* `Widest landscape possible (16:9). <SCENE>. Keep <AREA> calm and empty for a logo / UI.`
- *Promo (style 5), replaces the shared block's rendering lines:* `A layered paper-cut diorama: every element
  cut from coloured craft paper with slightly rough edges, stacked in layers with soft drop shadows between
  them, photographed straight on, cozy handmade look. Keep the Mochi Moon designs and colours exactly.` For
  video parallax, also ask for the background, middle and front layers as separate images on `#ff00ff`.
- *Merch (style 6), replaces the shared block's rendering lines:* `Made of soft felt and plush fabric, visible
  stitching and seams, fuzzy texture, embroidered details, like a handmade toy, soft studio lighting. Keep
  the Mochi Moon designs and colours exactly.`

**Review checklist** (reject and regenerate if any fails)

- [ ] Outline is plum, not black. No text crept in.
- [ ] Reads at 40 px (badges, relics, seals) and on both a dark and a light background.
- [ ] Line colour matches §2.2, and the hero's iconic parts match §4.2.
- [ ] Same line weight, light direction and angle as the rest of its set (compare on the contact sheet).
- [ ] No colour close to `#ff00ff` inside the subject (it gets keyed out).

---

## 8. Motion and VFX

The same language in the Phaser fight scene, the HTML UI and promo videos.

- **Squish:** buttons and mochi squash on press and impact (about 0.9 × 1.1), then spring back. Bouncy ease
  (back-out), 120–200 ms.
- **Hits:** a white impact star and a short shake. A crit gets a bigger star, a 2-frame white flash and the
  `crit` sound. Damage numbers pop up and fall.
- **Line VFX:** tinted with the line colour, shaped by §2.2 (embers rise, ice shards burst outward, poison
  bubbles pop, wind swirls arc, a shield gets a shine sweep, heal hearts float up, dodge leaves an afterimage).
- **Chain ⚡:** a short spark line from one skill to its neighbour, with the `chain` sound.
- **Peak moments:** ult, ★★★ (`star3-burst`), champion. Briefly dim everything else, use a gold and moon
  burst, and add a voice line ("คอมโบ!", "แชมป์แห่งดวงจันทร์!"). Keep these rare (pillar 5).
- **Respect reduced motion:** without shakes and flashes the UI must still read.

Sound and voice: four music loops (town, shop, battle, victory), synthesised SFX, and the Zephyr announcer
voice in Thai and English. See [ASSETS.md](ASSETS.md). Promo videos reuse these files so they sound like the game.

---

## 9. Promo and video kit

### 9.1 Formats

| Use | Size | Safe area |
|---|---|---|
| TikTok / Shorts / Reels | 1080×1920 (9:16) | keep text out of the top 220 px and the bottom 380 px (platform UI); keep the right 120 px clear |
| YouTube / trailer | 1920×1080 (16:9) | title-safe 90 % |
| X post / Discord | 1600×900 (16:9) or 1080×1350 (4:5) | centre 80 % |
| Link card / OG | 1200×630 | `og.jpg`, `buildcard-*` |
| X header | 1500×500 | centre third (avatar covers the bottom left) |
| Discord banner | 960×540 | centre |
| Avatar / app icon | 1024² | round crop safe: a mochi face, or the moon and mochi from the logo |

### 9.2 Video rules

- **Two looks, one video:** the papercraft style (§0, style 5) is for openers, transitions, key visuals and
  end cards, and real gameplay footage (style 1) is for everything that shows play. Never repaint gameplay.
- **Hook in the first 1.5 s:** open on the action (a ★★★ moment, an ult, a near-death comeback), not on the logo.
- **Show real gameplay.** The fight sim is deterministic, so a moment can be recorded again from its seed and
  builds (Playwright at 60 fps, fixed viewport). Never fake a fight that the game cannot produce.
- **Captions on every clip:** Thai main line, English sub-line. Kanit 600, cream fill, 6 px plum outline, at
  most 2 lines on screen.
- **Audio:** game music under (about −20 LUFS), SFX and voice on top. The Moon Rabbit announcer voice is our
  "narrator".
- **End card (2 s):** logo, Moon Rabbit, one call to action ("สู้ build ของฉัน" / "Beat my build" + link or
  QR). Same end card on every video.
- **Length:** shorts 15–30 s, trailer 45–75 s.

### 9.3 Repeatable clip formats

1. **★★★ moment:** shop → third copy → star burst → the next fight wins. 15 s.
2. **Comeback:** 1 HP left → the ult fires → win. 15 s.
3. **Build of the week:** one community build, its skills on screen, one fight. 20–30 s.
4. **Hero spotlight:** one hero per week: key art, ult, a signature combo. 20 s.
5. **Patch notes in 20 s:** what changed, shown on real cards.
6. **Challenge:** "Can you beat this build?" + a challenge link or Blink.

---

## 10. Gaps (art to make next)

Ordered by what promo work needs first.

1. **Painted hero key art (8 heroes):** the heroes are still SVG chibis (`chibi.ts`). Promo, thumbnails and
   hero spotlights need painted art: one full-body pose per hero, plus an ult pose later. Use §4.2 and the
   hero key-art block.
2. **Logo variants:** horizontal lockup, a square mark for avatars, and a one-colour version for overlays.
3. **Social kit:** X header, Discord banner and server icon, a Discord emoji/sticker set (8 hero faces,
   ★★★, stardust, mochi cheer, mochi pout).
4. **Line badges:** `img/line/*` are placeholders copied from the old archetype badges. Redo them in the badge
   block with the §2.2 ring colours.
5. **Skill badges:** several sim v12 line skills (riposte, sidestep, mend, blaze, scorch, venom, plague,
   icelance, glacier, tailwind) still use placeholder icons copied from related skills.
6. **Depth pack fixes** (from its README): the empty star pip has low contrast, the echo seal reads as a moon,
   and the off ult pip is more ornate than the on pip.
7. **Video end card and caption template:** one file for the editor, made from §9.2.
8. **Colour token cleanup:** retire the old archetype tokens in `style.css` (§2.2 note).
