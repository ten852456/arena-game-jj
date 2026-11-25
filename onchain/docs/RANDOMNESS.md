# Randomness, secret seed and migration (sim v22 on chain)

Status: implemented in the `mochi-game` v22 program; local-validator tested (see §2). Local only: nothing is pushed or deployed until the owner approves.
Decisions marked **(owner, 25 Nov 2026)** come from the project owner; everything else is a proposal.

## 1. Decisions

| # | Decision | Source |
|---|---|---|
| D1 | Ranked (on-chain) runs take **every** random outcome from a secret seed: shop offers, shop rerolls, card bonuses, star cards, wishes (target + branch + mark kind), awaken, relic offers + rerolls, last-chance mark, fight seed and opponent pick. | owner |
| D2 | Players must not be able to predict future shops or any other roll. | owner |
| D3 | Randomness is verifiable, and the operator (us) cannot steer it. | owner |
| D4 | Offline mode keeps the public run seed, unchanged. | owner |
| D5 | Every outcome is a deterministic function of the secret + counters in the state, so retries, timeouts and failed transactions cannot buy a different roll. | owner |
| D6 | Everything stays local: no push, no devnet deploy without approval. | owner |

Engine status (done, commit `e800490`): `run.ts rollSeed(s) = s.secret ?? s.seed` and Rust `roll_seed(secret)` drive every run roll; `seed` is only the cosmetic look. Test `secret_runs_ignore_the_public_seed`: 10,000 on-chain runs replayed with a different public seed are identical after all 895,950 actions. TS ↔ Rust parity: 20,000 runs / 1.84M actions.

## 2. Seed lifecycle (implemented in `programs/mochi-game`, tested on a local validator)

Status: built (production, `bench`, `local` features) and run end to end on a local validator with the `local`
build (`engine/bench/local-e2e.mts`: 32/32 checks). That covers 4 runs (2 players × 2, the second runs fight the first
runs' ghosts). After each run, the TS sim replays the whole run from the revealed secret and gets the exact program
state; every fight seed = H(secret, "fight", day); the commitment and secret derivation check out; rejected actions
leave the state byte-identical; a stranger can't start a run on someone else's account; the player can't fulfil their
own VRF request; an early `retry_vrf` is refused. NOT tested yet: the real VRF oracle and the TEE permissions (devnet;
needs the owner's approval to deploy).

Two private accounts per player per season, both delegated to the TEE:

| Account | Who can read it (TEE permission) | Holds |
|---|---|---|
| `Player` | owner wallet + session key | run state, journal, last fight, `secret_commit`, `revealed` (after the run) |
| `RunSecret` (new, PDA `["secret", season, owner]`) | **nobody** (permission with zero members, like Pool / Ranking) | the run's secret, VRF request state |

Steps:

1. **`begin_run`** (player): requires `status = IDLE`. `run_no += 1`, `status = WAIT_VRF`, one VRF request (MagicBlock Ephemeral VRF) with `caller_seed = H(season, owner, run_no)`. Nothing random is computed in this transaction.
2. **`vrf_callback`** (only the VRF program's signer identity; checked): requires `WAIT_VRF` and the same `run_no`. Then
   `secret = H("mochi-run" ‖ vrf_output ‖ season_secret ‖ owner ‖ run_no)` goes into `RunSecret`.
   `secret_commit = H("mochi-commit" ‖ secret ‖ run_no)` goes into `Player` (public to the player).
   The hero choices come from `hero_choices(u32(H(secret, "heroes")))`, the cosmetic seed from `u32(H(secret, "look")))`, and `status = PICK`.
3. **`pick_hero`** → `RunState::new(hero, look_seed, Some(u32(H(secret, "run"))))`.
4. **Actions**: the engine gets the secret on every call. Each roll is keyed by counters already in the state (day, rerolls today, wishes today, wish marks, relic rerolls). The **fight** seed and the opponent pick are `H(secret, "fight", day)`. No action reads the clock, the slot or a client-supplied value for randomness.
5. **Run end** (won / dead / concede → `finish_run`): the program copies the secret into `Player.revealed`. With the action log (or the ghost + replay data), anyone can recompute every roll with the TS sim (`newRun(hero, seed, id, secret)`) and check it against `secret_commit`.
6. The next run needs a new VRF request. A secret is never reused.

`season_secret`: 32 bytes generated at `init_season` from a VRF output mixed with operator entropy. It lives in a zero-member account, its hash is published at season start, and it is revealed at season end. It means the VRF oracle alone can't compute a player's secret (D3), and neither can the operator alone, since the operator never sees the VRF output before the commit.

### Retries, timeouts, failures (D5)

- **Failed transaction** → state rollback. The retry sees the same counters, so it produces the same outcome. There is no hidden entropy that a failure could consume.
- **Reroll** costs gold and bumps the counter. A reroll is never free, and its result is fixed by `(secret, day, rolls)`.
- **VRF timeout**: one outstanding request per `run_no`. After `VRF_TIMEOUT` slots the player may call `retry_vrf` for the same `run_no`. That's safe because they never saw an output. A late callback for an old request is rejected (request id / `run_no` mismatch).
- **Concede and restart** to fish for a good start: each new run is a new VRF, and the ended run is recorded (ghost + ranking). This is "best of N runs", the same as the current game, not RNG manipulation. Limiting runs per day is a game-design question (open, §5).

## 2a. Request + apply (owner decision 25 Nov 2026: protection A + B)

Every action with a random outcome takes two transactions. Deterministic actions stay one.

| Action | Path |
|---|---|
| buy, sell, move, lock, buy slot, pick relic, concede | `act` / `act_batch` (one transaction, refused while a request is pending) |
| fight (10), shop reroll (3), wish (6), last chance (7), place mark (8), relic reroll (12) | `request_action` → VRF → `apply_random` |
| run start | `begin_run` → VRF → `vrf_callback` (hero choices) |

1. **Request** (player / session key): checks the action is legal now. Legality never depends on the roll, so a dry run decides it. The action is then **committed** in Player (`pend_req` id, code, args, slot) and one VRF request is sent, with the request id as callback argument. Nothing random is computed, so simulating this transaction shows only "pending".
2. **Apply** (VRF program's scoped identity): requires the pending id. It clears the pending state **first** (processed once), then rolls with `act seed = H(secret ‖ r16 ‖ req)`; a fight's seed and opponent use `H(secret ‖ r16 ‖ req ‖ "fight")`. It appends `r16` (first 16 bytes of the VRF output) to the public per-run randomness log.
3. **While pending**: no other action, no second request, no cancel instruction. `retry_request` (after the timeout) re-sends the VRF request for the **same** action. Duplicate, late or old-id callbacks are refused (`StaleCallback`).
4. **Verification**: after the run, the revealed secret plus the randomness log plus the request ids reproduce every roll (TS: set `s.secret = act seed` before each random action).

Why it holds even if the TEE lets players simulate: a request carries no outcome, and an apply's outcome needs the VRF output, which doesn't exist when the player sends the request. Test S2 shows the player CAN simulate a forged callback (sigVerify off) on a plain validator. That only gives the outcome for a guessed randomness, never the real one.

Known residual: `pick_hero` rolls the day-1 card bonuses from the run secret, so simulating `pick_hero` for each offered hero reveals those bonuses before picking. This is minor and could be shown openly. The fix, if wanted, is to make pick_hero a request too.

## 3. Confidentiality inside the TEE

What enforces it:

1. `RunSecret`'s permission has **no members**. The TEE RPC only serves an account's data (`getAccountInfo`, websockets, transaction details) to members of its permission (auth token), so neither the player, the session key nor we can read it. Program code reads it during execution.
2. The program never logs the secret, never returns it, and never writes it (or any value from which it can be inverted) into `Player` before the run ends. The only public value is a hash commitment.
3. The player sees only *outcomes* that already happened: today's shop, their build, fight results. Future rolls depend on counters plus the secret, and the hash isn't invertible.
4. Delegation: `RunSecret` is created and delegated in the same base-layer transaction as `Player`. It is never committed back to Solana with content: at season end it is scrubbed (zeroed) before undelegation, like the ranking.

Residual trust, which can't be removed and is written down for the audit:

- **The TEE operator / hardware** (MagicBlock, Intel TDX attestation): a compromised TEE can read memory.
- **The program upgrade authority** could ship code that leaks the secret. For mainnet this needs a multisig and a published build hash.

Open risk (blocking, needs MagicBlock's answer):

- **Simulation peeking**: can a player run `simulateTransaction` (or a preflight) on the TEE for a transaction that touches `RunSecret`, and see the resulting `Player` state or return data without committing? If so, they could preview a reroll's shop, a wish's target or a fight's result (for example, trying build orders until one wins), and skip the bad ones. That breaks D2/D5 without breaking the secret.
  - **(a)** Ask MagicBlock whether the TEE RPC refuses simulation / preflight for transactions that load accounts the caller isn't a member of, or for a given program.
  - **(b)** If it doesn't, use two-step actions for every roll with a hidden outcome (fight, shop reroll, relic reroll, wish, last chance). The request transaction commits the choice and the payment and asks for VRF; the callback applies the roll with randomness that didn't exist when the request was sent. Simulating the request reveals nothing. Cost: one VRF + callback per such action (VRF is free on the ER; latency to be measured).
  - **(c)** Mixing in the landing slot is weaker (a simulation for slot s+k is still a usable preview), so it isn't recommended.
  - Owner decision: **both**. (b) is built (§2a) and tested locally (engine/bench/local-e2e.mts, 45/45). (a), the practical
  check on the TEE, is scripted (`scripts/tee-sim-probe.mjs`) but NOT run: it sends devnet transactions (a throwaway test
  player on the existing devnet program), which needs the owner's approval.

## 4. Owner questions (25 Nov 2026), answered

**Q1. How are existing v21 runs handled, given the rare rounding differences in v22?**
They aren't migrated. A run is only ever played and replayed under the version it started with:
- The live off-chain game stays on sim v21 / run v13 (`ten852456/mochi-list-v2`), and its runs, ghosts and replays are untouched.
- The on-chain game is a **new season** on sim v22 / run v14. It starts empty: no v21 run, ghost or rating moves over.
- The code already filters by version. The server drops fights/snapshots of another `SIM_VERSION` on load, and the client drops saved runs of another `RUN_VERSION` (now 14). So a v21 run can never be continued or re-simulated under v22, which is the only case where a rounding difference could show.
- The rounding differences are the integer maths (fights: same winner 99.65%, max 0.22 pts hero win rate) and the 13:10 relic weights (same odds; a seed's offer can differ only at a rounding boundary). They change outcomes of *new* runs, not stored ones.
- If the live game later moves to v22 too, the switch works like every earlier version bump: runs in progress at the switch end (or are dropped), and old replays show "older version". That decision is for then.

**Q2. How do "162 bytes per ghost" and "7 bytes" relate?**
7 bytes is **one skill**. 162 bytes is **one whole ghost**: a journal of every fought day of a run.
- A skill packs into 7 bytes: id 6 bits (43 skills), variant 3, mark 3, star 2, bonus count 2, three bonuses × 11 bits. The v13 layout was 6 bytes with a 5-bit id, which no longer fits 43 skills.
- A day entry is `[day][n][changed-slot mask][relics byte]`, then the relic ids (only when the relics changed), then 7 bytes per **changed** skill slot. Days with no change are skipped.
- A ghost is all of its day entries. Over 9,896 player runs: mean **162 B**, p95 252 B, max 410 B. The theoretical worst case (`JOURNAL_MAX`) is 1,323 B (21 entries × every slot and relics changed).
- Storage: `Player.journal` holds the current run (sized to `JOURNAL_MAX`). Each pool seat has a 1,536 B ring arena for that player's last 5 ghosts. With real runs, 5 always fit (0 early evictions), and any day's build is rebuilt exactly (85,684 ghost-days checked).

**Q3. How is secret confidentiality enforced inside the TEE, including against the player?** See §3: a zero-member permission on `RunSecret`, no logging or return of the secret, a commit-then-reveal-at-run-end scheme, and `season_secret` mixing against the VRF oracle. Open: simulation peeking, plus TEE / upgrade-authority trust.

## 5. Open items

1. MagicBlock: simulation / preflight on the TEE for non-member accounts (blocking for D2/D5).
2. MagicBlock: Ephemeral VRF on the **TEE** validator (works on the public ER; not yet tested on TEE), callback latency, signer identity to check.
3. Game design: limit runs per day or season? Fishing for a good start by conceding is "best of N".
4. Mainnet: multisig upgrade authority + verifiable build; audit of the seed lifecycle.
