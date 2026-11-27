## What and why

<!-- one or two sentences -->

## Checks

- [ ] `npm run typecheck && npm run lint && npm test && npm run build`
- [ ] Server change: `npm run security` and `npm run farm-api` against a local server
- [ ] Sim change: `SIM_VERSION` bumped if fights or runs change, and `npm run ts-to-rust` passes (or the Rust re-port is planned)
- [ ] Facts: `docs/FACTS.md` updated if game numbers, status or the money model changed
- [ ] Player-facing: release note added in `src/web/app/releaseNotes.ts` (if shipping)
