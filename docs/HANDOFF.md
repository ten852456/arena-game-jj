# Handoff: Mochi Moon (19 Nov 2026)

Read this first. It is the state of the project and the next work, written for the next agent (Codex).
The product owner (ten852456 / "เท็น") talks in Thai; reply in Thai. Game text is Thai + English.

## What the game is
Mochi Moon: async-PvP auto-battler (TypeScript, Vite, Phaser, Node server with a JSON db). Two versions of the
same game are live; the team is still choosing one:

| Version | Branch (fork `ten852456/arena-game-jj`) | Live URL (Railway service) |
|---|---|---|
| List (skills in a vertical list) | `ten852456/mochi-list-v2` | https://mochi-list-production.up.railway.app (`mochi-list`) |
| Grid (shaped blocks on a grid) | `ten852456/mochi-grid-v2` | https://mochi-grid-production.up.railway.app (`mochi-grid`) |

Upstream (teammate JaJoJi / "เจเจ"): `JaJoJi/arena-game`, remote `upstream`. **Always build on the newest
upstream branch** (`git fetch upstream`; `art-mochi` = list art, `art-mochi-grid` = grid art) and merge new
upstream commits in. Never push to upstream.

**Push = deploy.** Each Railway service redeploys on every push to its branch. Only push after the checks below pass.
Railway CLI: `npx -y @railway/cli@4` from a folder linked to project `arena-ab-test` (`railway link -p bba5dff7-1fb9-42be-a0ee-106620eaba6b -e production`).
In Git Bash set `MSYS_NO_PATHCONV=1` before passing `/app/data`.

## Checks before every push (both branches)
1. `npx tsc --noEmit` · `npm test` (determinism) · `npm run build`
2. Start a server on an unusual port (other agents use 87xx/89xx): `DATA_DIR=$(mktemp -d) PORT=18787 npx tsx src/server/index.ts`
3. `BASE=http://localhost:18787 npm run smoke` and `BASE=http://localhost:18787 npm run security` (8 abuse cases, all must be ✔)
4. Browser end-to-end: `scripts/e2e/` (see its README; Playwright is installed outside the project).
   List: `node e2e.mjs http://localhost:18787 ./out` → 71/71. Grid: `node e2e-grid.mjs …` → 78/78 (bilingual; grid picks the
   language from the browser). Look at the screenshots it writes.
5. After deploy: open the live URL, `curl` a fight without playerId → must be 400.

## Tools (CPU only, no LLM cost)
- `npm run sim -- all --n 200` balance report (targets in `scripts/sim/targets.ts`: variety, not equal win rates)
- `npm run exploit -- --quick` evolutionary exploit finder (list branch) → `docs/exploits/`
- `npm run tune` CMA-ES auto-tuner over knobs in `src/sim/tuning.ts` (list branch); add exploit builds to `scripts/tune/watch.ts`
- Docs: `docs/SIMULATOR.md`, `docs/EXPLOIT.md`, `docs/TUNING.md`, `docs/SKILL_TREE.md` (intended power curves), `docs/API.md`, `docs/ASSETS.md`

## Rules decided by the product owner
- Balance = **distinct power curves and variety** (some heroes strong early / mid / late), not equal win rates. 10 wins ends a run.
- Global audience: every player-facing string in Thai and English (`L(th, en)` from `src/i18n.ts` on grid).
- Server security (both branches): server keeps run rating/HP/last chance; playerId required; `/api/run/finish` only for runs
  the server played; days in order; `__proto__` ids rejected. Keep `npm run security` green.
- Art: cute chibi mochi on the moon, moon-night palette, thick plum outlines. Images via Codex image generation; sounds are
  synthesized (`scripts/assets/`); voice lines via Gemini TTS + ASR check (`GEMINI_ENV_FILE=D:/work/my-project/content-agent/.env`, never write the key).

## Work in flight when Claude stopped (check these first)
Two Claude sub-agents were still running in git worktrees of the main repo `C:/Users/Tenny/orca/arena-game-jj`
(`git worktree list` shows them under `.claude/worktrees/`). They may have committed, half-finished, or nothing:
- **LI** `agent-a21357200f95d11ca` (branch `worktree-agent-a21357200f95d11ca`): port the grid's Thai/English switch to the **list**
  (src/i18n.ts, client/lang.ts, i18n_en.ts, wrap every UI string in `L()`, header TH/EN switch, voice follows language).
- **D2** (art) is **done and merged** into `ten852456/mochi-list-v2`: `img/bg-home-wide`, `img/bg-game-wide`, `img/bg-panel`,
  `img/rotate-phone`, `img/skills/<id>.webp` (26), `img/arch/<arch>.webp` (5); `src/client/assets.ts` has `IMAGES.bgHomeWide`,
  `IMAGES.bgGameWide`, `IMAGES.bgPanel`, `IMAGES.rotatePhone`, `skillIcon(id)`, `archIcon(arch)`, `ARCH_COLORS`. Not used by the UI yet.
For each: `git -C <worktree> log --oneline -3` and `git -C <worktree> status`. If committed and checks pass, merge into
`ten852456/mochi-list-v2`. If unfinished, finish the task yourself from the description above.

## Next work, in order
1. **Finish/merge LI (i18n for list).** D2 art is merged; use it in step 2 (and copy `src/client/public/assets/img/{skills,arch}` + the bg images to the grid branch).
2. **UI redesign from the product owner's feedback (list first, then port to grid).** His words, summarised:
   - The current UI does not work. On **PC it must not be a single vertical column**: design a **landscape, one-screen layout with no page
     scrolling** (e.g. arena/fight canvas + my skill list/build + shop + timeline/bonus panel side by side; panels may scroll inside if needed).
   - **Home/first screen**: full-bleed background art (Codex), use the whole screen, lively.
   - **Phones: recommend landscape** (show a friendly "rotate your phone" hint with `img/rotate-phone`); portrait must still be playable.
   - **Skill and skill-line icons** so a player understands at a glance **what each skill combos with**: show the partner's icon/arch emblem
     on the card and on the list row (e.g. "needs ⚔ฟัน above/below" as icons), not only text.
   - **When dragging and a synergy would connect, glow/sparkle** at the matching neighbour(s); show active links as glowing connectors.
   - **No dead black areas**: backgrounds, subtle animated stars/particles, panels with texture; make it feel lively.
   - Keep: phone touch drag, link chips, active-bonus panel, firing timeline, lock, moon wish, Thai+English, mute.
   Then run the full checks (update `scripts/e2e/*.mjs` selectors if the layout changes), push, and ask the owner for feedback.
3. **Balance round 2 (list)**: add the exploit finder's top builds to `scripts/tune/watch.ts`, run `npm run tune`, then
   `npm run exploit` again (still finds 93–100% builds: knight day 12, berserker day 15; duelist too weak early). Ship after checks.
4. **Grid follow-ups**: grid `bot.ts` should place engines (gear/overclock next to slow heavy blocks); grid sim opponent pool is too weak
   (all heroes reach 10 wins 47–63% in the harness); port `exploit`/`tune` to grid; grid UI redesign same as list.
5. Optional later: Farm (idle) design (see `docs/ROADMAP.md` Phase 5), Colosseum Eternal onchain plan (`docs/HACKATHON.md`).

## Useful history
- Playtests and MiroFish panel (19 Nov): players prefer List for readability (link chips + bonus panel) and Grid for combo hype;
  phone friction made grid players press auto-arrange every day (now replaced by hints). Theme "cute + idle farm" reads as casual/P2E
  to core players: lead with depth (combos, provable fights), not cuteness.
- Railway: old services `arena-list` / `arena-grid` were deleted; their orphaned volumes still exist (ask before deleting).
