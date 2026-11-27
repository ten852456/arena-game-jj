---
name: mochi-facts
description: Source of truth for Mochi Moon numbers and claims (heroes, skills, relics, playtesters, onchain status, money model, team, funding). Use before writing or reviewing anything that quotes the project — a pitch deck, slides, a weekly or builder update, a Colosseum or accelerator answer, a video caption, a post — and after any change to the game, team, status or money model, to keep docs/FACTS.md current.
---

# Mochi Moon facts

`docs/FACTS.md` is the single source for every number and claim about Mochi Moon. Read it before writing; update it
after changing anything it covers.

## Before writing anything that quotes the project

1. Run `npm run facts` so the generated block (heroes, skills, relics, lines, HP, wins, versions, commits)
   matches the code.
2. Read `docs/FACTS.md` and take every number and claim from it. If something you need is missing, find it in the
   code or ask the user. Never take numbers from the PDFs in `docs/archive/hackathon/`: they are old.
3. Keep its rules:
   - newest source wins, and an owner ruling beats documents
   - the money model is the newest decision only
   - say what is built and what is planned
   - label bot or AI playtests as simulated

## After a change

Update `docs/FACTS.md` in the same session (and the same commit when code changes):

- **Game content changed:** heroes, skills, relics, HP or wins → re-run `npm run facts`.
- **Status changed:** playtesters, deploys, onchain progress, posts, videos → edit the Status table with the date.
  Add a row to the Sprint log at the end of each sprint week.
- **Money model changed:** replace the Money model section with the new decision, its date and its source. Do not
  keep both versions side by side; the change log records the old one.
- **Team or funding changed:** edit the Company and team table with the date.
- **A new source document:** add it to the Sources table by date.
- **Every edit:** add one line to the Change log.

`npm run facts -- --check` exits 1 when the generated block is out of date (it ignores the date line).
