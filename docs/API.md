# Mochi Moon server API

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
  "build": { "hero": "knight", "skills": [{ "id": "shield", "v": "" }, { "id": "strike", "v": "" }], "look": 12345 } }
```

`playerId` is optional (but send it: it stops you meeting your own other runs). `rating` is clamped to 0–3000.

Matchmaking:

1. Candidates: saved builds of the same day, not this run, not this player, and **not a snapshot or opponent run
   already met in this run** (the server tracks each run's opponents).
2. Rating window ±200, then ±350, then ±500; the first window with candidates wins; random pick among the 5 closest.
3. No candidates → AI opponent with a tier: days 1–2 `easy`; then `hard` on a 3+ win streak or rating ≥ 1120;
   `easy` on a 2+ loss streak or rating < 940; else `normal`.
4. Guided tutorial: `"tutorial": true` on **day 1 of a run the server has never seen**, once per `playerId`, skips
   matchmaking and fights a training AI (an `easy` bot cut to one skill; the server tries a few bots/seeds and keeps
   the first fight the player wins). The response then has `"tutorial": true`. Any other case ignores the flag.

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

Call once when a run ends (10 wins, dead, or conceded). Request:

```json
{ "playerId": "p-8d1e…", "runId": "3f2c…", "name": "Mochi-4401", "hero": "knight",
  "wins": 8, "losses": 2, "day": 10, "build": { "hero": "knight", "skills": [] } }
```

Checks: ids valid, hero exists, `0 ≤ wins ≤ 8`, `wins + losses` is `day` or `day − 1` (conceded before fighting),
build valid for that day and of that hero. If the server already saw this run with another playerId → 403.

**Only fights the server ran count**: counted wins = min(claimed, wins the server recorded for this runId);
counted losses = max(claimed, losses recorded). `capped: true` when the claim was higher.

Reward (ผงดาว / `stardust`) by counted wins: `0:5 1:10 2:15 3:25 4:35 5:50 6:65 7:80 8:100 9:120 10:160`, +70 for a flawless 10–0.

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

## Pages

The server serves three pages from `dist/`: the landing page `/` (`src/client/index.html`, `landing.ts`), the game
`/play` (`src/client/play/index.html`) and the back office `/admin` (`src/client/admin/`). An old share link
`/?replay=…` (any `/` with a query) is forwarded to `/play` with the same query.

## Public site (src/server/site.ts)

Stored apart from the game: `data/site.json` (waitlist, feedback, banner) and `data/events/YYYY-MM-DD.ndjson`
(one usage event per line). No raw IPs are written; IPs are kept in memory for rate limits only.

| Route | Body / answer | Rules |
|---|---|---|
| `POST /api/waitlist` | `{ telegram?, x?, email?, wallet?, consent: true, lang, src, hp }` → `{ ok }` (the same answer for a new and a repeat sign-up, so the form never tells who is on the list) | at least one of Telegram, X, email; each must match its format (Solana address is base58); one entry per handle or email (case-insensitive); 6 well-formed sign-ups per IP per hour; `hp` is a honeypot |
| `POST /api/feedback` | `{ rating?: 1–5, text?, screen, runId?, hero?, wins?, lang, device, ver }` → `{ ok }` | rating or text required; text cut at 1000 characters; 20 per IP per hour |
| `POST /api/events` | `{ v: visitorId, p?: playerId, events: [{ e, screen?, hero?, src?, lang?, device?, day?, wins? }] }` → `{ ok: counted }` | browser events allowed: `landing_view`, `play_click`, `game_open`, `tutorial_start`, `tutorial_done`, `run_start`, `feedback_open`, `docs_view`; at most 30 per batch, 240 per IP per minute |
| `GET /api/announce` | `{ on, th, en, at }` | the banner set in /admin |

The server adds its own events: `fight` (after every fight it ran: player, day, won, AI, tutorial), `run_end` (a
newly finished run: hero, counted wins, cleared), `waitlist` and `feedback`. The browser cannot send these names.

## Admin API

Every `/api/admin/*` call needs `Authorization: Bearer <ADMIN_TOKEN>` (a server env var, 16+ characters; without it
admin answers 503). Ten wrong tokens from one IP, or 50 in total, within 10 minutes lock admin out for the rest of the window (429). These counters are kept apart from the public rate limits, which only ever drop expired entries.

| Route | Answer |
|---|---|
| `GET /api/admin/overview?days=14` | totals, per-day players / visitors / fights / runs / waitlist / feedback, funnel (landing → play click → game open → first fight → run end → waitlist), day-1 retention, heroes from real finished runs, language and device split |
| `GET /api/admin/feedback` · `POST /api/admin/feedback/done {id, done}` | newest 500 feedback rows; mark done / reopen |
| `GET /api/admin/waitlist` · `GET /api/admin/waitlist.csv` | the list, newest first; CSV with formula-safe cells |
| `GET /api/admin/runs` | newest 100 finished runs and 50 fights (with replay ids) |
| `POST /api/admin/announce {on, th, en}` | set or clear the banner |
