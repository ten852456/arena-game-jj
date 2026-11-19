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
