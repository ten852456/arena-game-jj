# Mochi Moon

A cozy async auto-battler with an idle town, on web and phone. Pick a hero, buy skills day by day, and your build
fights other players' saved builds. Between fights your heroes work your town. An onchain version (Solana +
MagicBlock) lives in `onchain/`.

- Live: https://mochi-list-production.up.railway.app (branch `release`)
- Staging: https://mochi-staging-production.up.railway.app (branch `main`)
- Every number and claim about the project: [`docs/FACTS.md`](docs/FACTS.md) (`npm run facts` keeps it in sync with the code)

## Run it

Needs **Node.js 22+**.

```bash
npm install
npm run dev          # game server on :8787 + live-reload client on :5173 → http://localhost:5173
npm run build && npm start   # the way it is hosted: one server that also serves the built pages → :8787
```

Pages: `/` landing, `/play` the game, `/admin` back office (needs `ADMIN_TOKEN`). Chain mode is opt-in:
`/play?chain=1` (devnet, see `onchain/README.md`).

## Layout

```
src/
  sim/        the deterministic engine (no DOM / Node APIs): fights, runs, bots, town rules. Runs on the server,
              in the browser and is ported to Rust in onchain/. Same builds + seed = same fight.
  shared/     code used by every side (i18n)
  server/     Node HTTP server + JSON store (data/db.json)
    index.ts  entry: routes, static files, saves
    routes/   fight, farm (town), meta (profile, leaderboard), site (landing, waitlist, admin)
    game/     matchmaking, build validation, mint/burn ledger
    http/     shared HTTP helpers, static file serving
    store.ts  the database file, caps, saves
  web/        the client (Vite root): Phaser 3 scenes + HTML UI
    index.html, play/, admin/   the three pages (play/main.ts is the game's entry)
    landing/  the landing page
    app/      the game shell: ui.ts (screens and actions), layout, api, tracking, perf, release notes, feedback
    features/ fight, shop, run-end, town, tutorial, records, chain
    ui/       shared widgets and helpers (html, icons, skill text, info mode, sound panel, codex)
    art/      asset manifest, sound, procedural art
    i18n/     language switch, English text
    styles/   the play page's global sheets (imported by play/main.ts in cascade order)
    public/   images, sounds, voices (served as /assets)
onchain/      Anchor program, Rust engine (parity-tested against src/sim), codegen, devnet scripts
tests/        checks run by npm test, server checks (security, farm API, smoke), e2e (Playwright)
tools/        simulations, balance and tuning, exploit search, asset pipeline, facts, TS → Rust codegen
docs/         FACTS, ROADMAP, API · design/ (game and economy) · ops/ (deploy, assets, exploits) · research/ · archive/
deploy/       Docker compose and Railway notes
```

**Key idea:** the server runs the fight and returns the events plus the seed; the browser only plays them back.
A replay link stores builds and seed, and any client re-simulates the exact same fight.

## Commands

| Command | What it does |
|---|---|
| `npm test` | determinism, text coverage, upgrades, build validation, fights, town rules, damage kinds |
| `npm run typecheck` | TypeScript check |
| `npm run security` / `npm run farm-api` / `npm run smoke` | against a running server (`BASE=http://localhost:8787`) |
| `npm run sim` / `npm run runs` / `npm run balance` | bot simulations: run clear rates, hero spread, matchups |
| `npm run farm-sim` | the idle town over a season |
| `npm run tune` / `npm run exploit` | balance tuning, exploit search |
| `npm run facts` | regenerate the generated block of `docs/FACTS.md` |
| `npm run ts-to-rust` | regenerate `onchain/engine/.../data.rs` from `src/sim` |

## Branches and releases

Trunk-based. Details in [`docs/ops/WORKFLOW.md`](docs/ops/WORKFLOW.md).

- `main`: always deployable; every change lands through a pull request with green checks. Deploys to **staging**.
- `release`: what players get. Ship = fast-forward `release` to a tested `main` commit and tag it (`v0.0.2` …).
- Work branches: `feat/…`, `fix/…`, `chore/…`, `docs/…`; short-lived, deleted after merge.
- Old work is kept as `archive/*` tags (grid version, old main, unmerged experiments).
