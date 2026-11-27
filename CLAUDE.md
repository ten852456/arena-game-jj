# Mochi Moon: notes for AI agents

Read `README.md` (layout, commands) and `docs/ops/WORKFLOW.md` (branches, pull requests, releases) first.

## Rules

- **Facts:** every number or claim about the project comes from `docs/FACTS.md`; update it in the same change when
  the game, status, money model or team changes (skill `mochi-facts`). Code is the truth; the PDFs in
  `docs/archive/hackathon/` are old.
- **Determinism:** `src/sim/` must stay deterministic and free of DOM / Node APIs (it runs on the server, in the
  browser and as Rust in `onchain/`). No `Math.random()`, `Date.now()` or float-order tricks in sim code; use `Rng`.
  A change to fight or run rules bumps `SIM_VERSION` (or the run version) and needs the Rust engine re-ported
  (`npm run ts-to-rust`, parity tests in `onchain/engine`). JJ reviews `src/sim/**` and `onchain/**`.
- **Arena equality:** nothing from outside a run (town, Seals, Kit, cards, pass) may enter a Ranked fight. The server
  re-validates builds (`src/server/game/validate.ts`).
- **Live data:** the live service keeps `data/db.json` on a Railway volume. Never write to live or staging data from a
  script, and never change Railway settings without the owner.
- **Git:** work on a branch from `main`, open a pull request. Never push to `main` or `release` directly, never
  force-push, never use bare `git stash` (the stash is shared between worktrees). Leave files you did not change alone.
- **Local servers:** use ports 18xxx (other agents use 87xx / 89xx) and stop every server you start before you finish.
- **Text:** English and Thai UI strings both exist (`L('ไทย', 'English')`); `npm test` checks the English coverage.

## Before a pull request

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

For server changes also start a server (`PORT=18xxx DATA_DIR=$(mktemp -d) npm start`) and run
`BASE=http://localhost:18xxx npm run security` and `npm run farm-api` (that one needs `FARM_TIME_SCALE=3600`).
