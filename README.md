# Arena POC (ชื่อชั่วคราว)

Proof of concept for the async auto-battler in the vision doc: pick a hero, buy skills day by day into a
vertical skill list (every skill runs its own cooldown in parallel), fight other players' saved builds from the same day,
win 8 before HP 20 runs out. Full combat design: see the combat doc and `docs/ROADMAP.md`.

Repository: **https://github.com/JaJoJi/arena-game**

## Two versions

This repo holds two playable versions of the game on two branches. **This branch is the list version (vertical skill list, skill tree).**

| Version | Branch | Docker image | Port when hosted |
|---|---|---|---|
| Grid: skills are shaped blocks packed into a grid, connect bonuses, chains, engines, auto-arrange | `phase1-combat-character` | `arena-grid` | 8787 |
| List: skills in a vertical list, all firing in parallel, Lv1 → Lv2 → Lv3 skill tree, 5-offer shop | `skill-list` | `arena-list` | 8788 |

Switch versions with `git checkout phase1-combat-character` or `git checkout skill-list`, then run as below.

## How to run

### Option A: on your computer (for development)

Needs **Node.js 22 or newer** (https://nodejs.org) and npm.

```bash
git clone https://github.com/JaJoJi/arena-game.git arena_game
cd arena_game
git checkout skill-list
npm install
npm run dev          # game server on :8787 + live-reload client on :5173
```

Open **http://localhost:5173**. Code changes reload by themselves.

To run it the way it is hosted (one server that also serves the built page):

```bash
npm run build
npm start            # open http://localhost:8787
```

### Option B: with Docker (for hosting)

Needs Docker (Docker Desktop on Windows / macOS). Each version is one image with the server and the web page inside.

```bash
docker build -t arena-list .                                   # on this branch
docker run -d -p 8788:8787 -v arena-list-data:/app/data --name arena-list arena-list
```

Open **http://localhost:8788**. Saved builds, fights and replays stay in the `arena-list-data` volume.

**Both versions at once** (grid on 8787, list on 8788): build both images (one on each branch), then

```bash
docker compose -f deploy/docker-compose.yml up -d     # stop with: docker compose -f deploy/docker-compose.yml down
```

Copying the images to another server, updating, logs, wiping data and HTTPS notes: **[deploy/DEPLOY.md](deploy/DEPLOY.md)**.

### Option C: Railway (hosting from GitHub, with HTTPS)

Railway builds the repo's `Dockerfile` straight from GitHub. Make **one Railway service per version**:

| Railway service | Branch | Version |
|---|---|---|
| `arena-list` | `skill-list` | list version |
| `arena-grid` | `phase1-combat-character` | grid version |

**Steps (repeat for each version):**

1. Sign in at https://railway.com → **New Project → Deploy from GitHub repo** → choose `JaJoJi/arena-game`
   (the first time, Railway asks you to let it read your GitHub repos).
2. Open the service → **Settings → Source → Branch** → pick the branch from the table. Railway detects the
   `Dockerfile` and builds it (about 1–2 minutes).
3. **Settings → Networking → Generate Domain**. If it asks for a port, type **8787**. You get a link like
   `https://arena-list-production.up.railway.app` with HTTPS included: share that link with players.
4. **Keep saved data across redeploys (recommended):**
   - Right-click the service (or **+ Create → Volume**) → add a **Volume** with mount path **`/app/data`**.
   - **Variables → New Variable**: `RAILWAY_RUN_UID` = `0` (Railway volumes belong to root; without this the game
     can't write its save file).
5. *(Optional)* **Settings → Deploy → Healthcheck Path** = `/`.

For the second version: in the same project click **+ Create → GitHub Repo**, pick the same repo, and set the other
branch in step 2.

**After that:**

- Every `git push` to a branch redeploys that version automatically.
- Keep each service at **1 replica**: all saved builds live in one server process.
- Without a volume the game still works, but opponents' saved builds and replay links reset on every deploy
  (players' own runs are saved in their browser either way).
- Logs: open the service → **Deployments → View logs**. A line `could not save …` means step 4 is missing.

More detail: [deploy/RAILWAY.md](deploy/RAILWAY.md).

### First time in the game

A tutorial pops up the first time the game is opened in a browser (8 slides). Reopen it any time with
**? วิธีเล่น** at the top right. Your run is saved in your browser, so you can close the tab and continue later.

## Developer commands

| Command | What it does |
|---|---|
| `npm test` | 500 random fights, each simulated twice: must be identical (determinism) |
| `npm run balance -- [builds=100] [days=3,5,10,13] [--strict] [--no-len]` | fight length per day (vs targets) + archetype and per-hero matchup matrices per day; `--strict` exits 1 on a miss |
| `npm run runs -- [runs=150]` | bots play whole runs per hero vs same-day bot builds: share of 8-win runs, 8-win rate spread |
| `npm run explain` | prints the Thai post-fight explanation for a few bot fights |
| `npm run smoke` | against a running server: two players meet async, replay re-simulates identically, cheat build rejected |
| `npm run typecheck` | TypeScript check |

## Structure

```
src/sim/      pure TypeScript, no DOM/Node APIs: runs on server AND browser
  combat.ts   simulate(buildA, buildB, seed, day) → events + per-skill stats (deterministic, 10 ticks/s)
              every equipped skill runs its own cooldown in parallel; skills don't interact by position
              HP by day (hpFor), fatigue start/step by day, freeze cap by day, SIM_VERSION
  explain.ts  Thai post-fight explanation: how it ended, top skills, skill fires, control, biggest hit, why you lost
  skills.ts   16 shared + 8 hero-unique skills as data: each a tree (Lv1 → 2 Lv2 → 2 Lv3 variants) of effects,
              keyword icons + chips for the UI (design: docs/SKILL_TREE.md)
  heroes.ts   8 heroes (two per archetype); passives are combat hooks (no hero ids in combat.ts)
  run.ts      one run: income, streaks, shop, slots, HP loss = day number, last chance
  bot.ts      rule-based bot (no LLM): AI opponents + balance testing
  rng.ts      seeded PRNG
src/server/   Node http + JSON file (data/db.json): matchmaking by build rating, replays
src/client/   Phaser 3 + HTML UI (Thai text in HTML/Kanit)
  townScene.ts   side-scrolling fantasy town: drag/fling, wheel, arrow keys, minimap, tap a landmark
  townArt.ts     all town pixel art drawn in code (buildings, parallax mountains/castle/forest)
  townData.ts    landmark list: name, position, what it does / will do
  combatScene.ts side-view arena replay (colosseum background)
scripts/      determinism, balance, smoke tests
```

**Key idea:** the server runs the fight and returns the events plus the seed. The browser only plays them back.
A replay link stores builds and seed, and any client re-simulates the exact same fight.

## What's in the POC (from the vision doc)

- Run loop: 20 HP, a loss costs 2–5 HP by day (capped), 10 wins ends run, win-streak bonus > loss-streak comeback money
- Day 1: a fixed 5-skill shop per hero (same every run) and 7 gold for two buys; random shops from day 2
- Shop: 5 offers (new Lv1 skills + random next-variant upgrades of skills you own), reroll, +1 skill slot;
  Lv1 3 gold, Lv2 upgrade 4, Lv3 upgrade 5 (hero skills +1); max Lv3
- Skill list: 3 slots on day 1, +1 every 3 days up to 6, buyable up to 8; move up/down, sell; no backpack
- Parallel cooldowns; buff/debuff skills (ขยายพลัง, ชำระล้าง, สลายเวท); 16 shared skills + 8 hero uniques
- 4 archetypes, 2 heroes each, each playing the archetype a different way:
  tank อัศวิน (shield) / นักรบหนาม (permanent thorns) · burst นักฆ่า (charge/execute) / นักดาบคู่ (fast multi-hits) ·
  scaling นักรบคลั่ง (growth) / นักเวทเพลิง (burn stacking) · control แม่มดน้ำแข็ง (freeze) / จอมเวทเวลา (slow + cast delay)
- Each run offers 3 heroes from different archetypes (rolled from the run seed); หอฮีโร่ shows all 8 with play style
- Freeze and cast delay share a control cap per fight (3s / 5s / 7s by day) with diminishing returns; ใจเหล็ก reduces control by 60%
- Fight length by day: ≈10s on days 1–3, 15–17s on days 4–7, 20–23s on day 8+ (base HP table + day-based fatigue)
- Thai post-fight explanation on the result and replay screens (why you lost and what to try)
- Readable fights: skills shown as icon + number chips (hover / tap a chip explains its keyword), buff/debuff chips,
  cooldown bars per skill, You vs Enemy summary
- Fights end by KO: fatigue ends 7–17% of fights on every day (target ≤ 20%)
- 32×32 pixel-art heroes drawn in code with idle / cast / hit / death poses in the replay; concede button
- Last chance (โอกาสสุดท้าย): first death → 1 HP + pick ตื่นพลัง / ตราวิญญาณ / เสบียงสุดท้าย
- Async PvP: fight a saved build of the same day, closest rating within ±200, AI fills gaps and is labeled AI,
  defender loses nothing, full opponent build shown after the fight, shareable replay link
- Run saved in the browser, so reload and continue mid-run; offline fallback vs a local AI if the server is down

- Town hub (the home screen): 7 landmarks; สนามประลอง enters the arena, หอฮีโร่ shows the roster,
  the rest show what they will do (marked เร็วๆ นี้)

## Not in the POC yet

Town systems (idle resource farming, building upgrades, research, market), player-configured bots, daily rules, accounts and auth, marketplace / tickets / diamonds,
real art. The server trusts the client's run state (it validates builds but not how they were bought);
production needs server-side run state.

## Balance

Bots only (`npm run balance`, `npm run runs`), so treat it as a starting point for real-player data. Current state:

- every archetype pair ≤ 65% on days 5, 10 and 13 (worst ≈ 64%); every hero pair ≤ ~70% (designed counters,
  e.g. นักรบหนาม vs นักดาบคู่)
- best − worst hero overall win rate ≤ 15 points on every tested day
- whole runs: no hero has more than ~14% of all 8-win runs; reach-8-wins rate within ≈10 points across heroes
- average fight length per day inside the targets (printed by `npm run balance`)
