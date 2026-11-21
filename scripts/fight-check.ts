// Server fight check: honest runs through handleFight (the real /api/fight path, with hidden marks and the per-way
// ledger) that die once and take each last-chance choice. Every build after the choice must be accepted.
// Regression: right after the death the mark way had no ledger yet, so the last chance's hidden mark was revealed as
// a wish roll and the next fight was refused ("could not have paid for this build") about 3 times in 4.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'fight-check-'));
const { handleFight } = await import('../src/server/fight');
const { db } = await import('../src/server/store');
const { botDay, botRules } = await import('../src/sim/bot');
const { HEROES } = await import('../src/sim/heroes');
const R = await import('../src/sim/run');

type Skill = { id: string; v: string; mark?: string; markHidden?: string };
const bad: string[] = [];
const counts: Record<string, number> = { mark: 0, awaken: 0, supply: 0 };
const RUNS = 12;

for (const choice of ['mark', 'awaken', 'supply'] as const) {
  for (let i = 0; i < RUNS; i++) {
    // fight the server's AI, not the weak snapshots earlier runs left in the pool (those runs never die)
    db.snapshots.length = 0;
    const runId = `fc-${choice}-${i}`;
    const playerId = `p-${runId}`;
    // a weak day-1 knight build: it loses often enough to die once well before day 15
    let skills: Skill[] = [{ id: 'strike', v: '' }, { id: 'shield', v: '' }];
    let chosen = false;
    for (let day = 1; day <= 15; day++) {
      const ghostBefore = !!db.tracks[runId]?.ghost;
      const r = handleFight({ runId, playerId, day, name: 'check', build: { hero: 'knight', skills } });
      if (r.status !== 200) {
        bad.push(`${choice} run ${i} day ${day}: ${r.status} ${JSON.stringify(r.json)}`);
        break;
      }
      for (const x of (r.json as { revealed?: { idx: number; mark: string }[] }).revealed ?? []) {
        skills[x.idx].mark = x.mark;
        delete skills[x.idx].markHidden;
      }
      // the fight right after the choice went through
      if (chosen) {
        counts[choice]++;
        chosen = false;
      }
      const t = db.tracks[runId];
      if (t.over) break;
      if (!ghostBefore && t.ghost) {
        // the client's side of each choice (sim run.ts chooseLastChance / applyMark on an online run)
        skills = skills.map((k) => ({ ...k }));
        if (choice === 'mark') skills[0].markHidden = 'last';
        if (choice === 'awaken') skills.forEach((k, j) => { if (k.v === '') k.v = j % 2 ? 'b' : 'a'; });
        if (choice === 'supply') skills.push({ id: 'stoneskin', v: '' });
        chosen = true;
      }
    }
  }
}

// honest bot runs like the real client: server relic offers, hidden marks revealed by the server, every hero,
// each last-chance choice; an easy bot dies often. Every day must be accepted.
const honest: Record<string, number> = { mark: 0, awaken: 0, supply: 0 };
for (const choice of ['mark', 'awaken', 'supply'] as const) {
  for (let i = 0; i < 24; i++) {
    db.snapshots.length = 0;
    const hero = HEROES[i % HEROES.length];
    const s = R.newRun(hero.id, 7000 + i, `fc-h-${choice}-${i}`);
    let chosen = false;
    while (s.phase !== 'won' && s.phase !== 'dead') {
      if (s.phase === 'lastchance') { R.chooseLastChance(s, choice); chosen = true; continue; }
      if (s.phase === 'mark') { R.applyMark(s, 0); continue; }
      botDay(s, botRules([hero.line], i % 2 ? 'easy' : 'normal'));
      const r = handleFight({ runId: s.id, playerId: `p-${s.id}`, name: 'check', day: s.day, build: R.toBuild(s) });
      if (r.status !== 200) {
        bad.push(`honest ${choice} ${hero.id} seed ${7000 + i} day ${s.day}: ${r.status} ${JSON.stringify(r.json)}`);
        break;
      }
      const f = r.json as any;
      if (chosen) { honest[choice]++; chosen = false; }
      if (Array.isArray(f.nextRelics)) s.relicNext = { day: s.day + 1, ids: f.nextRelics };
      s.online = true;
      for (const x of f.revealed ?? []) { const k = s.skills[x.idx]; if (k) { k.mark = x.mark; delete k.markHidden; } }
      s.rating = f.rating;
      R.recordResult(s, f.won, { opp: f.opponent.name, ai: f.opponent.ai, fightId: f.fightId }, f.result.winner === -1);
    }
  }
}
for (const [c, n] of Object.entries(honest)) if (!n) bad.push(`no honest run reached a last chance with ${c}`);
for (const [c, n] of Object.entries(counts)) if (!n) bad.push(`no run reached a last chance with ${c} (the check proves nothing)`);
if (bad.length) {
  console.error(`fight check: ${bad.length} problem(s)\n  ${bad.slice(0, 20).join('\n  ')}`);
  process.exit(1);
}
console.log(`fight check: builds after the last chance accepted (simple runs: mark ${counts.mark}, awaken ${counts.awaken}, supply ${counts.supply} · honest bot runs: mark ${honest.mark}, awaken ${honest.awaken}, supply ${honest.supply})`);
