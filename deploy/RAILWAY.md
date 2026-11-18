# Hosting on Railway

Railway builds each version straight from GitHub using the repo's `Dockerfile`. Make **one Railway service per
version**, each pointing at its own branch.

| Service | Branch | What it is |
|---|---|---|
| `arena-grid` | `phase1-combat-character` | grid version |
| `arena-list` | `skill-list` | list version |

## Steps (do this once per version)

1. https://railway.com → **New Project → Deploy from GitHub repo** → pick `JaJoJi/arena-game`.
2. Open the new service → **Settings → Source → Branch**: choose the branch from the table above
   (for this branch: `phase1-combat-character`). Railway finds the `Dockerfile` and builds it.
3. **Settings → Networking → Generate Domain**. If Railway asks for a port, enter **8787**
   (the server listens on Railway's `PORT` variable, which Railway sets for you).
4. *(Recommended)* keep saved builds and replays across redeploys:
   - **Add a Volume** to the service with mount path **`/app/data`**.
   - **Variables → add `RAILWAY_RUN_UID` = `0`**. Railway volumes belong to root and the image runs as the
     `node` user, so without this the game can't write its save file. It still runs, but it logs
     `could not save …` and forgets saved builds on every redeploy.
5. *(Optional)* **Settings → Deploy → Healthcheck Path**: `/`.

For the second version, add another service to the same project (**+ Create → GitHub Repo**, same repo) and pick
the other branch.

## Good to know

- **Every push to a branch redeploys that service.** Push to `phase1-combat-character` → the grid version updates.
- Without a volume the game still works. Opponents' saved builds and replay links just reset on each deploy;
  players' own runs are saved in their browser either way.
- One server process holds all data in memory. Keep the service at **1 replica** (don't scale out), or
  players on different replicas won't see each other's builds.
- Railway gives HTTPS on the generated domain, so no extra proxy is needed.
