# Mochi Moon server API (grid version)

Node `http` server, JSON in and out, storage in `data/db.json` (`DATA_DIR` env overrides the folder).
Code: `src/server/` (`index.ts` routes · `fight.ts` fight + scout · `match.ts` matchmaking + AI tier ·
`meta.ts` run finish / profile / leaderboard · `store.ts` db + caps · `validate.ts` input checks).
Typed client: `src/client/api.ts` (`api.fight`, `api.replay`, `api.scout`, `api.finishRun`, `api.profile`, `api.leaderboard`).

Errors are `{"error": "..."}` with status 400 (bad input), 403 (run belongs to another player), 404, 409.

## Ids and names

- **runId**: the client's run id (UUID). 1–64 chars of `[A-Za-z0-9_-]`.
- **playerId**: a random id the client creates once and keeps in localStorage (same format). Untrusted, and it
  acts like a password: the server never returns another player's playerId.
- **Names**: an empty name or the old default `ผู้เล่น` becomes a stable unique name `Mochi-1234`, derived from the
  playerId (or the runId when no playerId is sent). The fight response returns it in `name`: store it as the
  player's name. Names are trimmed, max 24 chars, control / zero-width / bidi characters removed.

## POST /api/fight

Runs one fight of the day. Request:

```json
{ "runId": "3f2c…", "playerId": "p-8d1e…", "name": "", "day": 3, "rating": 1000,
  "build": { "hero": "knight", "w": 5, "h": 3, "look": 12345, "skills": [
    { "id": "shield", "v": "", "shape": "o4", "rot": 0, "x": 0, "y": 0, "bonus": [{ "t": "strike", "e": "trigger" }] },
    { "id": "strike", "v": "", "shape": "i3", "rot": 0, "x": 2, "y": 0, "bonus": [{ "t": "arch:tank", "e": "dmg" }] } ] } }
```

`playerId` is optional (but send it: it stops you meeting your own other runs). `rating` is clamped to 0–3000.
`build` is `toBuild(run)` from `src/sim/run.ts`: placed blocks only (see **Grid build checks** below).

One fight per run day:

- the day is already on record for this runId → **409** `day already fought`
- the run was already finished (`/api/run/finish`) → **409** `run already finished`
- the first playerId that fights a run owns it; another (or a missing) playerId → **403** `not your run`

Matchmaking:

1. Candidates: saved builds of the same day, not this run, not this player, and **not a snapshot or opponent run
   already met in this run** (the server tracks each run's opponents).
2. Rating window ±200, then ±350, then ±500; the first window with candidates wins; random pick among the 5 closest.
3. No candidates → AI opponent with a tier: days 1–2 `easy`; then `hard` on a 3+ win streak or rating ≥ 1120;
   `easy` on a 2+ loss streak or rating < 940; else `normal`.

Response:

```json
{
  "fightId": "6457c3cd", "seed": 912873, "day": 3,
  "name": "Mochi-4401",
  "opponent": { "name": "Far", "ai": false, "arch": "control", "build": { "hero": "witch", "skills": [] }, "rating": 1290 },
  "match": { "window": 350, "pool": 1 },
  "result": { "winner": 0, "events": [] },
  "won": true, "rating": 1016
}
```

AI opponent: `"opponent": { "name": "AI · นักรบหนาม", "ai": true, "tier": "easy", "arch": "tank", … }`, `"match": { "window": null, "pool": 0 }`.

## Grid build checks (`validateBuild` in `src/server/validate.ts`)

Only what the run API (`src/sim/run.ts`, `src/sim/grid.ts`) can produce for a fight on `day` is accepted;
anything else is a 400 with the reason:

| check | error |
|---|---|
| hero exists | `bad hero` |
| `w`/`h` integers, at least the day's base grid `gridFor(day)` (5×3 day 1, grows with the day), at most `MAX_W`×`MAX_H` (8×6) | `bad grid` |
| `skills` is an array of at most `w*h` blocks | `bad skills` |
| skill id exists; hero-unique skills only on their hero | `unknown skill` / `skill not allowed for hero` |
| variant `''`, `a`, `b`, `a1`, `a2`, `b1`, `b2` | `bad level` |
| shape is one of that skill's shapes (`SKILLS[id].shapes`) | `bad shape` |
| `rot` 0–3; `x`, `y` integers ≥ 0 (bag blocks, `x < 0`, never fight and are rejected) | `bad position` |
| every cell inside the `w`×`h` grid, no two blocks share a cell | `bad placement` |
| connect bonuses: at most `min(3, 1 + level)`, kind in `dmg shield haste power trigger`, target a skill of this hero's pool or `arch:<archetype>`, not the block itself, no duplicate (target, kind), `dmg` only on skills that can hit | `bad bonus` |
| each skill id at most once | `duplicate skill` |
| marks: one of `burn echo quick steadfast`, at most one block, only from the first day a last chance is possible (day 7) | `bad mark` |
| gold: Σ cheapest cost of every block at its level (Lv1 price, + Lv2 upgrade unless awaken was possible, + Lv3 upgrade; hero-unique +1) + the price of the grid expansions needed to reach `w`×`h` (one row may be the last-chance supply row) ≤ the most gold a run can have earned by that day (`maxGoldBy`: every day's income with the best streak bonus, + 8 supply gold from day 7) | `too much for the day` |

So day 1 (7 gold) accepts at most two Lv1 blocks on the 5×3 grid, no upgrades, no marks, no extra rows/columns.

## GET /api/replay/:fightId

```json
{ "id": "6457c3cd", "day": 3, "seed": 912873, "a": { "name": "Mochi-4401", "build": {} },
  "b": { "name": "AI · นักรบหนาม", "build": {}, "ai": true, "tier": "easy" }, "winner": 0, "v": 9, "createdAt": 1795082693307 }
```

## GET /api/scout?day=&rating=&runId=&playerId=

Today's arena before a fight: the archetype mix of the builds the next fight could meet (same rules as matchmaking,
including the no-repeat filter when `runId` is given). No builds and no names are returned.

```json
{ "day": 2, "total": 3, "window": 200,
  "counts": { "tank": 0, "burst": 1, "scaling": 0, "control": 2 },
  "pct": { "tank": 0, "burst": 33, "scaling": 0, "control": 67 },
  "top": "control", "ai": null }
```

Nobody to meet: `{ "total": 0, "window": null, …, "top": null, "ai": { "tier": "hard" } }`.

A build's archetype = its skills' archetypes, with the hero's archetype counted 1.5×.

## POST /api/run/finish

Call once when a run ends (`WIN_TARGET` wins, dead, or conceded). Request:

```json
{ "playerId": "p-8d1e…", "runId": "3f2c…", "name": "Mochi-4401", "hero": "knight",
  "wins": 8, "losses": 2, "day": 10, "build": { "hero": "knight", "skills": [] } }
```

Checks: ids valid, hero exists, `0 ≤ wins ≤ WIN_TARGET` (read from `src/sim/run.ts`), `wins + losses` is `day` or `day − 1` (conceded before fighting),
build valid for that day and of that hero. If the server already saw this run with another playerId → 403.

**Only fights the server ran count**: counted wins = min(claimed, wins the server recorded for this runId);
counted losses = max(claimed, losses recorded). `capped: true` when the claim was higher.

Reward (ผงดาว / `stardust`) by counted wins (`stardustFor` in `meta.ts`): `0:5 1:10 2:15 3:25 4:35 5:50 6:65 7:80 8:100 9:120 10:160`,
+70 for a flawless run (`WIN_TARGET` wins, 0 losses). Wins are capped at `WIN_TARGET`; the table is never read past
its end (a larger win target would add the last step, +40, per extra win).

```json
{ "already": false,
  "reward": { "base": 130, "flawless": 0, "stardust": 130, "wins": 8, "capped": false },
  "run": { "runId": "3f2c…", "name": "Mochi-4401", "hero": "knight", "arch": "tank", "wins": 8, "losses": 2,
           "day": 10, "stardust": 130, "season": "s1", "finishedAt": 1795082693307 },
  "player": { "name": "Mochi-4401", "stardust": 145, "runs": 2, "wins": 10, "losses": 6,
              "best": { "runId": "3f2c…", "hero": "knight", "wins": 8, "losses": 2, "day": 10, "finishedAt": 1795082693307 } } }
```

Idempotent: calling again for the same runId returns the stored reward with `"already": true` and adds nothing.

## GET /api/profile?playerId=

```json
{ "known": true,
  "player": { "name": "Mochi-4401", "stardust": 145, "runs": 2, "wins": 10, "losses": 6, "best": { } },
  "recent": [ { "runId": "3f2c…", "name": "Mochi-4401", "hero": "knight", "arch": "tank", "wins": 8, "losses": 2,
                "day": 10, "stardust": 130, "season": "s1", "finishedAt": 1795082693307 } ] }
```

`recent` = last 20 finished runs, newest first. Unknown player: `"known": false`, zero totals, `best: null`,
and the default `Mochi-…` name for that id.

## GET /api/leaderboard?period=season|day[&playerId=]

Top 50 finished runs: most wins, then fewer losses, then earlier day, then earlier finish. `season` = the current
season (env `SEASON`, default `s1`); `day` = runs finished today (Thailand date, UTC+7). With `playerId`, your rows
get `"you": true`.

```json
{ "period": "day", "season": "s1", "date": "2026-11-19",
  "rows": [ { "rank": 1, "runId": "3f2c…", "name": "Mochi-4401", "hero": "knight", "arch": "tank", "wins": 8,
              "losses": 2, "day": 10, "stardust": 130, "season": "s1", "finishedAt": 1795082693307, "you": true } ] }
```

## GET /api/stats

`{ "snapshots": 17, "fights": 17, "runs": 2, "players": 3 }`

## Storage and caps

`data/db.json`, written 300 ms after a change, via a temp file + rename. A failed write is logged
(`could not save …`) and the server keeps running. Snapshots/fights from another `SIM_VERSION` are dropped on load.

| Collection | Cap (oldest dropped first) |
|---|---|
| `snapshots` | 300 per day |
| `fights` (replays) | 2000 |
| `tracks` (per-run opponents met + daily results) | 5000 runs |
| `runs` (finished runs) | 5000 |
| `players` | 20000 (least recently updated dropped) |

## Security notes

- `runId` / `playerId` must match `[\w-]{1,64}` and may not be `__proto__`, `constructor` or `prototype`;
  `tracks` and `players` are prototype-less maps (`Object.create(null)`).
- Request bodies over 64 KB are rejected. Names are cleaned (see above).
- Static files: `dist/` only (`..` and encoded traversal → 403), MIME types for html, js, css, png, svg, json,
  webp, jpg, ogg, mp3.
