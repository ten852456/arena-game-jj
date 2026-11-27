# How we work: branches, pull requests, releases

Decided 2026-11-27 (owner). Two developers plus AI agents, so the rules are few and enforced by CI.

## Branches

| Branch | What it is | Deploys to |
|---|---|---|
| `main` | the trunk: always builds, always passes the checks | staging: https://mochi-staging-production.up.railway.app |
| `release` | what players get; only ever fast-forwarded to a `main` commit | live: https://mochi-list-production.up.railway.app |
| `feat/<what>` `fix/<what>` `chore/<what>` `docs/<what>` | one change each, from `main`, deleted after merge | nothing |

- Old branches are not kept; their tips are `archive/*` tags (`git tag -l 'archive/*'`).
- AI agents work in their own worktree on a work branch and open a pull request like anyone else. Remove the worktree
  (and stop any dev server it started) when the branch is merged.

## A change

1. `git switch -c feat/<what> main`
2. Commit in small steps. Commit messages: what changed and why, in plain words.
3. Push and open a pull request to `main` (the template asks for the checks).
4. CI must be green: typecheck, lint, `npm test`, build, and the TS → Rust parity check when `src/sim` or `onchain/`
   changes.
5. `src/sim/**` and `onchain/**` need a review from JJ (CODEOWNERS): the onchain engine must stay bit-exact with the
   TypeScript sim. A sim rule change bumps `SIM_VERSION` and re-ports `onchain/engine`.
6. Squash or merge; delete the branch.

## A release

1. Check staging (it runs the `main` commit you want to ship).
2. Bump `version` in `package.json` and add the entry to `src/web/app/releaseNotes.ts` (in a pull request).
3. Fast-forward and tag:
   ```bash
   git fetch origin
   git push origin origin/main:release        # refused if release is not an ancestor: that is the point
   git tag -a v0.0.2 origin/main -m "v0.0.2" && git push origin v0.0.2
   ```
4. Railway deploys `release` to live in about a minute; `GET /api/version` shows the new version.
5. Update `docs/FACTS.md` (status table) in the next pull request.

A hotfix is a `fix/` branch to `main` like any other change, then a release.

## Data

Live data lives on the Railway volume of `mochi-list` (`/app/data/db.json`). Staging has its own volume. A
`SIM_VERSION` bump drops saved fights and opponent builds (they no longer replay the same), so plan it with a release.
