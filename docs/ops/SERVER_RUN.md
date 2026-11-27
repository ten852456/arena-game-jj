# Server-owned run (plan, not built)

Status: plan for the owner to decide (round 4, 21 Nov 2026). Today the client owns the run (shop, gold, purchases) and
sends a build each day; the server only checks that the build is *plausible* for the run's record (`src/server/game/validate.ts`:
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

## What the per-fight checks still cannot see (round 8, sim v19)

The server checks each fought build against the run's record, a per-way gold ledger, the relic offers it rolled and the
mark kinds it rolled. Without owning the shop it still cannot prove:

- **Which cards the shop showed.** A star needs a star card (one per shop roll at most), but the server only sees the
  star count. It caps stars at 4 per day and charges 3/4/5 gold each; a build can still show a star whose card never
  appeared, as long as the gold fits.
- **Rerolls and wishes that bought nothing.** Gold spent on rerolls, or on upgrade wishes, is invisible, so the ledger
  is a lower bound: a client that saved that gold can spend it elsewhere (including on one last-chance way's reward
  while another way's ledger shows the spend). Each way keeps its own ledger, so the gold caps never mix, but the
  unseen reroll gold is slack inside each way.
- **Which skill a wish mark went on.** The kind is the server's roll; the target is any Lv3 skill the build owned.

All three close when the server owns the run (commands in, state out), as planned above.

## Restart fishing and an abandon penalty for ranked (round 9 plan, not built)

Since sim v20 mark kinds are never sent ahead: a mark is carved hidden and the server reveals its kind in the response
of the next fight (and it decides whether a hidden mark is the last chance's or a wish's from its own ledger). Relic
offers are still sent with the fight result of the day before the relic day, because that response is the moment the
next day starts in the client; fetching them later would not change what a restarting player can see. What is left is
fishing by restarting: play to day 3, look at day 4's relics, abandon, start again. It costs about 3 days of play and
nothing else. For a ranked mode:

- **Abandon = a finished run.** A run left without `/api/run/finish` for more than a day, or conceded, is recorded as
  finished with the wins it had (it shows on the profile and counts as a run played).
- **Ranked entry cost.** Starting a ranked run costs a small amount of stardust (or one of N daily ranked tickets),
  paid back with interest only by reaching a set number of wins, so restarting for a better day-4 offer has a price.
- **Rating decay on abandon.** An abandoned ranked run counts as a loss for the run's rating at its current day.
- **One live ranked run per player.** A new ranked run cannot start while one is open; the open one must be finished
  or conceded first (which records it, see above).

These need the player identity the server already keeps (`playerId`, `db.players`) and nothing on the client.
