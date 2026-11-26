# Deploying the on-chain version (devnet) on Railway — prepared, NOT deployed

Status 2026-11-26: everything below is ready locally; nothing has been pushed and no Railway service exists yet.
Do it only with the product owner's go-ahead.

## What it is
The same server + client image as the live list game (Dockerfile), from branch `mochi-list-v2-onchain`. With
`/play/?chain=1` the game runs on chain: rules in the `mochi-game` program on the MagicBlock TEE (devnet), all
randomness from the VRF oracle, accounts and season results on Solana devnet. Without `?chain=1` it is the normal
server game (sim v22 balance on this branch).

| | |
|---|---|
| Program (devnet) | `7yVgjzySuXwBeRJ18ZhunetqBz8ZTBNGiQVkw1or7w2r` |
| Season in `src/client/public/chain.json` | `3241632420`, ends 2026-12-26 |
| TEE | `https://devnet-tee.magicblock.app` (called directly: it allows CORS `*`; the Vite `/tee` proxy is dev-only) |
| Solana RPC | `https://api.devnet.solana.com` (public, rate-limited per IP) |

## Never deploy over the live game
Push = deploy (docs/HANDOFF.md). `mochi-list` / `mochi-grid` are the live games. The on-chain version gets its OWN
branch on the fork and its OWN Railway service. Never push this branch to `ten852456/mochi-list-v2` or to upstream.

## Steps (when approved)
1. Checks (all passed on 2026-11-26 at commit of this file):
   `npx tsc --noEmit` · `npm test` · `npm run build` · production server
   `DATA_DIR=$(mktemp -d) PORT=18787 npx tsx src/server/index.ts` → `BASE=http://localhost:18787 npm run smoke` and
   `npm run security` (all ✔) · `dist/chain.json` has the direct TEE URL.
   Browser e2e (`scripts/e2e/e2e.mjs`): 93/110. The 17 failures are known: the script does not handle the day-4
   relic pick and some layout checks; the live list branch (062ada7) scores 86/110 with the same failures.
2. Push to a new fork branch, e.g. `git push origin mochi-list-v2-onchain:ten852456/mochi-onchain` (name to confirm).
3. Railway (project `arena-ab-test`): New service → GitHub repo `ten852456/arena-game-jj`, branch from step 2,
   builder = Dockerfile. Attach a volume at `/app/data`. Variables: none required (`PORT` is set by Railway).
   Generate a domain, e.g. `mochi-onchain-production.up.railway.app`.
4. After deploy: open `<url>/play/?chain=1`, connect Phantom (devnet), play one run; `curl` a fight without
   playerId → must be 400.

## Known limits for testers
- Phantom must be on devnet (Settings → Developer Settings → Testnet Mode → Solana Devnet) with ~0.03 devnet SOL
  (faucet.solana.com, or the admin sends some). On phones: open the URL inside Phantom's in-app browser.
- Public devnet RPC rate-limits (HTTP 429); fine for a few testers. For more: a dedicated devnet RPC (e.g. Helius),
  set as `rpc` in chain.json.
- The season is baked into the build (`chain.json` is a static file). New season: `DEVNET_KEYS=… npx tsx
  onchain/scripts/devnet-e2e.mts --ui` (writes chain.json), commit, push → redeploy.
- Devnet prototype: not audited; the program's upgrade authority is one admin key. Say "devnet test" on the page.
