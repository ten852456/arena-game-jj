Generate an original asset pack for the game "Mochi Moon" (cute chibi mochi auto-battler on the moon) with your image generation. These are for NEW UI features: relics, marks, stars, rarity frames, and a run-end Build Card.

You are already on local branch `assets/codex-depth`. Put new files ONLY under `src/client/public/assets/ui/depth/` and write `src/client/public/assets/ui/depth/README.md`: a table of file, what it is, size, and 9-slice insets where they apply. Commit locally. Do NOT push. Do not modify any code.

STYLE: match the existing painted icons in `src/client/public/assets/ui/*.webp` (speaker, close, home, trophy...). Look at them first; they are the reference. Rules:
- Soft round chibi shapes with a thick dark-plum outline (#3a2b48).
- Flat pastel fills: lavender #b9a8ff, cream #fff3e2, peach #ffb8a8, moon gold #ffe2a0, mint #9df0df, sky #9ccbff, pink #ffa6ba.
- A tiny soft upper-left highlight and a slight hand-made wobble. Calm and cozy.
- No glow, no gloss, no heavy gradients, no text in images.
- Transparent background.

DELIVER (.webp, quality ~85; keep the total under 2.5 MB):

A. Relic icons, 192x192, readable at 32px, one per relic, named `relic-<id>.webp`. Theme for each:
   whetstone (sharpening stone + small blade), executioner (headsman axe), counterstep (swirl footstep), featherstep (feather), spikedshield (shield with spikes / hedgehog), bastion (little castle tower), overflow (overflowing cup), vitality (herb leaves), meltdown (tiny volcano), kindling (bundle of dry sticks), virulence (potion flask, green), rot (mushroom), permafrost (ice cube), brittle (cracked crystal), gale (wind gust cloud), tailspin (kite), quickdraw (stopwatch), wanderer (compass), twinline (yin-yang of two colours), ironhide (turtle shell), glasscannon (crystal orb, cracked), lonewolf (small wolf howling at moon), sigil (trident rune).
   Give the three cheese relics (glasscannon, lonewolf, sigil) a subtle special accent, e.g. a tiny gold sparkle.
B. Mark badges, 128x128, named `mark-<kind>.webp`:
   - burn: a flame seal
   - echo: double ring or double arrow
   - quick: a feather with speed lines, or a clock
   - steadfast: a mountain or anchor
   - hidden: a sealed mystery seal with "?"-like swirl, no letters
   Make them look like little carved wax seals or stamps.
C. Star pips, 64x64:
   - `star-pip.webp`: filled gold
   - `star-pip-empty.webp`: outline
   - `star3-burst.webp`: a 3-star crown or burst, 128x128
D. Rarity frames for skill and branch cards, 9-slice friendly, about 256x320 with big round corners. Each has a transparent centre or a light translucent interior so text stays readable.
   - `frame-epic.webp`: purple/lavender, small gem accents
   - `frame-rare.webp`: sky blue
   - `frame-common.webp`: cream
   - `frame-star3.webp`: gold
E. Relic card frame `frame-relic.webp`, about 280x360, 9-slice friendly: lantern-paper or parchment with a soft stitched border.
F. Build Card:
   - `buildcard-bg.webp`, 1200x630 (share-card ratio): a soft moonlit background with an empty central area for content. Not busy.
   - `buildcard-frame.webp`: a decorative border overlay, same size, transparent centre.
G. Small extras, 128x128:
   - `ult-pip-on.webp` / `ult-pip-off.webp`: a little moon pip
   - `relic-slot-empty.webp`: an empty socket

QUALITY: consistent line weight, palette and light direction across the set.
- If one generation is slightly off, regenerate it up to 2 times. Then accept the best version and MOVE ON. Do not stop the whole job over one imperfect image; note weak ones in the README instead.
- Copy each generated image from where your image tool saves it into the folder. Convert and resize with whatever tool works (Python Pillow is fine).
- Finally, make a contact sheet `src/client/public/assets/ui/depth/_sheet.png` showing everything on the dark game background (#2a2140), so consistency can be checked.

When done, print the list of files with sizes and the commit hash.
