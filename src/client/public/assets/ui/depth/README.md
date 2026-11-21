# Mochi Moon depth UI assets

WebP assets are encoded at quality 85. Dimensions and insets are in pixels. Insets are left, top, right, bottom; preserve the corners when scaling. The build-card artwork is intended to be used at its native aspect ratio.

| File | What it is | Dimensions | Bytes | 9-slice insets |
| --- | --- | --- | ---: | --- |
| `buildcard-bg.webp` | Moonlit share-card background | 1200 ? 630 | 23,012 | ? |
| `buildcard-frame.webp` | Share-card border overlay | 1200 ? 630 | 108,062 | ? |
| `frame-common.webp` | Cream rarity frame | 256 ? 320 | 12,966 | 64, 80, 64, 80 |
| `frame-epic.webp` | Lavender rarity frame | 256 ? 320 | 14,784 | 64, 80, 64, 80 |
| `frame-rare.webp` | Sky-blue rarity frame | 256 ? 320 | 12,038 | 64, 80, 64, 80 |
| `frame-relic.webp` | Stitched parchment relic frame | 280 ? 360 | 22,230 | 70, 90, 70, 90 |
| `frame-star3.webp` | Gold rarity frame | 256 ? 320 | 17,034 | 64, 80, 64, 80 |
| `mark-burn.webp` | Flame wax seal | 128 ? 128 | 6,646 | ? |
| `mark-echo.webp` | Echo wax seal | 128 ? 128 | 6,608 | ? |
| `mark-hidden.webp` | Mystery swirl wax seal | 128 ? 128 | 5,140 | ? |
| `mark-quick.webp` | Feather wax seal | 128 ? 128 | 5,132 | ? |
| `mark-steadfast.webp` | Mountain wax seal | 128 ? 128 | 5,360 | ? |
| `relic-bastion.webp` | Castle tower | 192 ? 192 | 8,788 | ? |
| `relic-brittle.webp` | Cracked crystal | 192 ? 192 | 6,694 | ? |
| `relic-counterstep.webp` | Swirling footstep | 192 ? 192 | 11,416 | ? |
| `relic-executioner.webp` | Headsman axe | 192 ? 192 | 7,708 | ? |
| `relic-featherstep.webp` | Feather | 192 ? 192 | 6,676 | ? |
| `relic-gale.webp` | Wind gust | 192 ? 192 | 10,066 | ? |
| `relic-glasscannon.webp` | Cracked orb with sparkle | 192 ? 192 | 8,832 | ? |
| `relic-ironhide.webp` | Turtle shell | 192 ? 192 | 7,032 | ? |
| `relic-kindling.webp` | Bundle of sticks | 192 ? 192 | 9,418 | ? |
| `relic-lonewolf.webp` | Wolf and moon | 192 ? 192 | 9,462 | ? |
| `relic-meltdown.webp` | Volcano | 192 ? 192 | 5,830 | ? |
| `relic-overflow.webp` | Overflowing cup | 192 ? 192 | 8,990 | ? |
| `relic-permafrost.webp` | Ice cube | 192 ? 192 | 5,788 | ? |
| `relic-quickdraw.webp` | Stopwatch | 192 ? 192 | 9,320 | ? |
| `relic-rot.webp` | Mushroom | 192 ? 192 | 6,182 | ? |
| `relic-sigil.webp` | Trident rune with sparkle | 192 ? 192 | 8,934 | ? |
| `relic-slot-empty.webp` | Empty relic socket | 128 ? 128 | 5,798 | ? |
| `relic-spikedshield.webp` | Spiked shield | 192 ? 192 | 12,688 | ? |
| `relic-tailspin.webp` | Kite | 192 ? 192 | 9,034 | ? |
| `relic-twinline.webp` | Two-colour yin-yang | 192 ? 192 | 5,886 | ? |
| `relic-virulence.webp` | Green potion | 192 ? 192 | 9,068 | ? |
| `relic-vitality.webp` | Herb leaves | 192 ? 192 | 7,696 | ? |
| `relic-wanderer.webp` | Compass | 192 ? 192 | 9,836 | ? |
| `relic-whetstone.webp` | Sharpening stone and blade | 192 ? 192 | 5,574 | ? |
| `star-pip-empty.webp` | Outline star | 64 ? 64 | 1,714 | ? |
| `star-pip.webp` | Filled gold star | 64 ? 64 | 1,570 | ? |
| `star3-burst.webp` | Three-star burst | 128 ? 128 | 8,636 | ? |
| `ult-pip-off.webp` | Inactive moon pip | 128 ? 128 | 3,716 | ? |
| `ult-pip-on.webp` | Active moon pip | 128 ? 128 | 4,430 | ? |

`_sheet.png` is a contact sheet on #2a2140 (1200 ? 960, 515,606 bytes).

## Review notes

The empty star outline is dark and low contrast on the game background. The echo seal reads more as a moon emblem than a double ring, and the inactive moon pip is more ornate than the active one. Frame ornaments on the middle of the edges will stretch with 9-slicing; use modest resizing or preserve those ornaments separately if needed.

Artwork generated with the built-in image tool using individual prompts for each subject and the requested chibi pastel palette, plum outlines, and upper-left highlights.
