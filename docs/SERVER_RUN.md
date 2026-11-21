# Server-owned run (plan, not built)

Status: plan for the owner to decide (round 4, 21 Nov 2026). Today the client owns the run (shop, gold, purchases) and
sends a build each day; the server only checks that the build is *plausible* for the run's record (`src/server/validate.ts`:
day-1 fixed shop, Lv3 from day 4, exact gold cap from the run's wins / losses / draws, one last-chance way, day-by-day
spend with paid slots, hero bound to the run). A forger can still pick the best skills, branches and connect bonuses the
real shop might never have offered. Closing that needs the server to own the run.

## What changes

1. **Run start** `POST /api/run/start {playerId, hero}` → the server picks the run seed (crypto random, never sent before
   the run ends), the 3 hero choices from it (`run.ts heroChoices`) and creates `RunState` with `newRun` (same code as the
   client). Response: the public part of the state (shop, gold, HP, list), not the seed.
2. **Commands** `POST /api/run/cmd {runId, playerId, cmd, args}` with `cmd` ∈ buy / sell / move / reroll / lock / slot /
   wish / chance / mark. The server applies them with the existing pure functions of `src/sim/run.ts` (they are
   deterministic from the seed) and returns the new public state. Invalid commands get the same error strings the client
   shows today (`runErr`).
3. **Fight** `POST /api/fight {runId, playerId}` takes no build: the server uses `toBuild(state)`, matches, simulates,
   then `recordResult` (same function) and `beginDay`. The validator above becomes unnecessary for these runs (it stays for
   old clients during the change-over).
4. **Storage** `db.runs[runId] = RunState` (a few KB; the JSON store is fine for one replica, Postgres later). Keep the
   last N commands per run for replay / audit.
5. **Client** sends commands instead of mutating its own `RunState`; it keeps a local copy only for instant feedback and
   replaces it with the server's answer (optimistic UI; on mismatch the server wins). Offline play stays as a separate,
   unranked mode with a local seed.

## Effort and risks

- Server: one new route file (start / cmd), store changes, ~300 lines; the game rules are reused as they are.
- Client: the shop actions in `ui.ts` / `shop/*.ts` call the API (about 12 call sites) and handle latency (disable the
  card while a command is in flight). E2E suites need the server in the loop for every click (already true for fights).
- Load: one request per shop click instead of one per day. Fine for the playtest scale; rate-limit per player.
- Onchain plan: the run seed can be committed (hash) at run start and revealed at run end, so anyone can replay the
  commands and check the result; rewards can then be signed by the server per verified run.

## What it fixes

Forged builds (any skill, branch or bonus), gold and slot cheating, re-rolling a day by refreshing, and switching hero
mid-run. What it can't fix: a player using an outside simulator to plan purchases (that is skill, and the shop and the
opponent are still unknown until they happen).
