# End-to-end check

Plays full runs in a real browser (phone 390×844 with touch, and desktop) and checks every screen, the API
security rules and the asset content types. Run it before every deploy and against the live URL after.

Playwright is not a project dependency (keeps the image small). Install it once in a scratch folder:

```
mkdir ../e2e-tools && cd ../e2e-tools && npm init -y && npm i playwright && npx playwright install chromium
```

Then, with a server running (`npm run build && npm start`, or the live URL):

```
node ../e2e-tools/node_modules/.bin/../../e2e.mjs   # or copy e2e.mjs next to node_modules and run:
node e2e.mjs http://localhost:8787 ./e2e-out
```

`e2e.mjs` looks for Chromium at `%LOCALAPPDATA%/ms-playwright/chromium-1248`; change `exe` if yours differs.
Exit code 0 = all checks passed; screenshots and `e2e.json` go to the output folder.
