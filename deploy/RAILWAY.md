# Hosting on Railway

Railway project `arena-ab-test` builds the repo's `Dockerfile` straight from GitHub (`ten852456/mochi-moon`).
Branch flow and releases: [`docs/ops/WORKFLOW.md`](../docs/ops/WORKFLOW.md).

| Service | Branch | URL | Volume (`/app/data`) |
|---|---|---|---|
| `mochi-list` (live) | `release` | https://mochi-list-production.up.railway.app | `mochi-list-volume` |
| `mochi-staging` | `main` | https://mochi-staging-production.up.railway.app | `mochi-staging-volume` |

Both services: variable `RAILWAY_RUN_UID` = `0` (Railway volumes belong to root and the image runs as `node`;
without it the game logs `could not save …`). `ADMIN_TOKEN` (16+ characters) opens `/admin`; without it `/admin`
answers 503. Keep each service at **1 replica**: one server process holds all data in memory.

## Good to know

- A push to `main` redeploys staging; moving `release` redeploys live.
- **The source branch is set per service, not per environment.** Duplicating an environment shares the service's
  source, so staging is its own service (tried 2026-11-27: switching the duplicate's branch switched live too).
- CLI: `npx -y @railway/cli@4` (in Git Bash set `MSYS_NO_PATHCONV=1`). Set a service's branch with
  `railway service source connect --repo ten852456/mochi-moon --branch <branch> --service <service>`.
- Volume backups (`railway volume files download`) need an SSH key registered with `railway ssh keys add`.
- Railway gives HTTPS on the generated domain; no proxy needed.
