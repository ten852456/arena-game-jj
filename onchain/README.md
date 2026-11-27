# Mochi Moon on chain

The arena's rules as a Solana program, run inside a MagicBlock private ephemeral rollup (TEE) on devnet.
**Devnet prototype:** not audited; mainnet needs an audit, legal review, a multisig upgrade authority and
MagicBlock's production terms first.

> **Parity (2026-11-27):** fights are bit-exact again (2,000 / 2,000 cases; the double-KO rule was ported:
> side 0, the challenger, loses). **Whole runs are not** (0 / 2,000): `run.rs` still has the onchain branch's run
> rules. Port from `src/sim/run.ts` + `relics.ts`: relic offers with `RELIC_LUCK` on and the line weight off, relic days
> 2 / 4 / 6, days 1–2 losses cost 1 HP, streak bonus cap +2, first reroll of a day free. Check with `npm run ts-to-rust`
> (CI runs it; the whole-run step is allowed to fail until then). Chain mode (`/play?chain=1`) waits for this.

| | |
|---|---|
| Program (devnet) | `7yVgjzySuXwBeRJ18ZhunetqBz8ZTBNGiQVkw1or7w2r` |
| TEE validator | `MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo` (`https://devnet-tee.magicblock.app`) |
| Season the client plays | `../src/client/public/chain.json` |
| Toolchain | Anchor 1.0.2, ephemeral-rollups-sdk 0.16.2, Rust stable |

## Layout

```
engine/mochi-engine/   the game engine in Rust: integer-only, no heap, runs on SBF and natively
  src/combat.rs        the fight (port of src/sim/combat.ts, same order of operations)
  src/run.rs           one run: shop, gold, HP, marks, last chance (port of src/sim/run.ts)
  src/ghost.rs         compressed ghost storage: 6-byte skills, per-day journal, ring arena
  src/data.rs          GENERATED from src/sim by codegen.mts (do not edit)
  tests/               parity tests vs the TS sim (diff, run_diff, ghost_roundtrip, …)
engine/codegen.mts     src/sim → data.rs
engine/diff/           TS-side parity case generators (gen.mts fights, run-gen.mts runs, search.mts worst cases)
programs/mochi-game/   the Anchor program
scripts/               season setup + end-to-end tests (Node; `npm install` in scripts/ first)
idl/mochi_game.json    program IDL for the scripts
```

## TS → Rust

From the repo root: `npm run ts-to-rust` (see the main README). It regenerates `data.rs` from `src/sim`, generates
parity cases from the TS sim, and runs the Rust engine against them: every tick of every fight and every action of
every run must hash identically.

## The program

Accounts per season: `Season` (times), `Ranking` (top 16 + reward Merkle root), `Pool` shards (6 seats + ghosts),
one `Player` per wallet (run state, journal of every day's build, session key). Player, pool and ranking are
delegated to the TEE and private (permission program); only the season's final results come back to Solana.

Instructions (sim v22, layout 4; randomness: docs/RANDOMNESS.md):

- **delegation + privacy (one instruction each, `kind`: 0 Player, 1 RunSecret, 2 SeasonSecret, 3 Pool shard,
  4 Ranking; args `kind, season, shard`):** `delegate` (to the TEE validator) and `set_permission` (TEE). Player /
  RunSecret: their owner signs; SeasonSecret: the season admin signs (pass the Season account; the other kinds pass
  the program id for "none"). Permissions: Player = owner + session key, all others no members.
- **admin / season:** `init_season` (+ season secret commitment), `init_season_secret`, `delegate` + `set_permission`
  (kind 2), `set_season_secret` (TEE, must match the commitment), `set_season_end`, `init_pool`, `init_ranking`,
  `delegate` + `set_permission` (kinds 3, 4)
- **player setup (owner signs):** `init_player` (creates Player + RunSecret), `delegate` (kinds 0, 1), then on the TEE
  `set_session` + `set_permission` (kinds 0, 1); `revoke_session`
- **play (owner or session key, on the TEE):** `join_pool`, `begin_run` (VRF request), `vrf_callback` (VRF program only),
  `retry_vrf` (after VRF_TIMEOUT_SLOTS), `pick_hero`, `act`, `act_batch` (≤ 32 actions, atomic), `fight`, `finish_run`
- **season end:** `close_season`, `issue_proof`, `finalize_player` (scrub Player + RunSecret, commit back to Solana),
  `publish_root`, `clear_pool`, then players `claim_reward` with their Merkle proof
- `local_vrf` exists only with `--features local` (local validator: the admin answers VRF requests); `bench_*` only with
  `--features bench`. Neither is ever deployed.

Session keys: the owner approves a browser key for at most 7 days; it can only call the play instructions, can be
revoked, and is a member of the account's privacy permission together with the owner.

## Build and deploy

Linux / WSL with the Solana CLI and Anchor 1.0.2:

```bash
cd onchain
anchor build -p mochi-game --ignore-keys --no-idl          # add: -- --features bench  for bench builds
solana program deploy target/deploy/mochi_game.so --program-id <keypair> -u devnet
```

The upgrade authority of the devnet program is the admin key in `~/.config/solana/id.json`.

## Scripts

```bash
cd onchain/scripts && npm install
node chain-setup-devnet.mjs ../../src/client/public/chain.json   # new devnet season (7 days) for the client
node chain-setup.mjs <out.json>                                  # same on a local validator
node devnet-e2e.mjs                                              # end to end on devnet + TEE
node session-test.mjs <program id>                               # session key rules (local validator)
```

A new season gives everyone a fresh account; browsers clear their old chain keys automatically when the season in
`chain.json` changes.
