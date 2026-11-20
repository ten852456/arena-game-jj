# End-to-end check

Plays full runs in a real browser (phone 390×844 with touch, and desktop) and checks every screen, the API
security rules and the asset content types. Run it before every deploy and against the live URL after.

Playwright is not a project dependency (keeps the image small). Install it once in a scratch folder:

```
mkdir ../e2e-tools && cd ../e2e-tools && npm init -y && npm i playwright && npx playwright install chromium
```

Then copy `e2e.mjs` into that folder and, with a server running (`npm run build && npm start`, or the live URL):

```
cd ../e2e-tools && node e2e.mjs http://localhost:8787 ./e2e-out
```

Chromium is taken from `CHROME_PATH`, else `%LOCALAPPDATA%/ms-playwright/chromium-1248`.
Exit code 0 = all checks passed; screenshots and `e2e.json` go to the output folder.

`e2e.mjs` also checks the one-screen layout: at 1440×900, 1280×720 and phone landscape 844×390 the town, hero pick,
shop, fight, result and run-over screens must not scroll the page (`scrollHeight <= innerHeight + 2`); upright
390×844 is checked for every screen except the shop (the shop may scroll there). Screenshots: `layout-*.png`.

## Guided tutorial

`e2e-guide.mjs` (same setup, `node e2e-guide.mjs <baseUrl> <outDir>`) plays the guided tutorial end to end at 1280x720,
phone landscape 844x390 and portrait 390x844 (touch), screenshots every step (`guide-*.png`), checks the click
blocking, the server-side training fight (a win) and the "why you won" step, skips it (button and Esc) and checks the
clickable town map (drag is not a tap, tapping the selected arena enters it). `ONLY=<regex>` runs some parts only.
`e2e.mjs` skips the guide on its first screen.

`e2e-run-end.mjs` (same setup) checks the end-of-run screen: a won run (10–2) and a lost run (7–5, close last fight)
in Thai and English at 1280x720, 844x390 and 390x844. It covers the staged reveal (mid and final screenshots), tap to
skip, reduced motion, no page scroll, "play again" on screen, the records, stardust bar, next goal, last-fight tip and
share card (PNG plus download), Enter / R to the hero pick, and a one-tap quick start. The reward call is stubbed.
