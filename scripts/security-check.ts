// Abuse cases for the server (run against a live server): npm run security  (BASE=http://host:port)
import { aiBuild, botDay, botRules, botShopTurn } from '../src/sim/bot';
import { HEROES_BY_ID } from '../src/sim/heroes';
import { RELICS } from '../src/sim/relics';
import { newRun, recordResult, toBuild, chooseLastChance, applyMark, sell, wish, wishKind, wishPrice } from '../src/sim/run';
import { lvOf } from '../src/sim/skills';
const BASE = process.env.BASE ?? 'http://localhost:8787';
const post = async (u: string, b: unknown) => { const r = await fetch(BASE + u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }); return [r.status, await r.json()] as const; };
const build = aiBuild('knight', 1, ['shield'], 7);
const check = (name: string, ok: boolean, info = '') => console.log(`${ok ? '✔' : '✘'} ${name} ${info}`);
// 1 no playerId
check('fight without playerId → 400', (await post('/api/fight', { runId: 'sec-a', day: 1, rating: 1000, build }))[0] === 400);
// 2 fake finish (no track)
const fake = await post('/api/run/finish', { runId: 'sec-fake-' + Date.now(), playerId: 'p1', name: '', hero: 'knight', wins: 0, losses: 1, day: 1, build });
check('finish of a run the server never saw → 404', fake[0] === 404, JSON.stringify(fake[1]));
// 3 rating lie: two fights, claim 5000 → server ignores
const [s1, f1] = await post('/api/fight', { runId: 'sec-r', playerId: 'p2', day: 1, rating: 5000, build });
check('client rating ignored (server rating ~1000±32)', s1 === 200 && Math.abs(f1.rating - 1000) <= 32, `got ${f1.rating}`);
// 4 lie on finish: claim more fights than played
const lie = await post('/api/run/finish', { runId: 'sec-r', playerId: 'p2', name: '', hero: 'knight', wins: 3, losses: 0, day: 3, build });
check('finish claiming fights not played → 409', lie[0] === 409, JSON.stringify(lie[1]));
// 5 other player finish → 403
const other = await post('/api/run/finish', { runId: 'sec-r', playerId: 'p3', name: '', hero: 'knight', wins: f1.won ? 1 : 0, losses: f1.won ? 0 : 1, day: 1, build });
check('finish by another player → 403', other[0] === 403);
// 6 honest full run → reward from server counts
const s = newRun('berserker', 999, 'sec-full-' + Date.now());
while (s.phase !== 'won' && s.phase !== 'dead') {
  if (s.phase === 'lastchance') { chooseLastChance(s, 'supply'); continue; }
  if (s.phase === 'mark') { applyMark(s, 0); continue; }
  botShopTurn(s, { prefer: [], reserve: 0, maxRerolls: 1 });
  const [st, f] = await post('/api/fight', { runId: s.id, playerId: 'p4', name: '', day: s.day, rating: s.rating, build: toBuild(s) });
  if (st !== 200) { console.log('fight failed', st, f); break; }
  s.rating = f.rating; recordResult(s, f.won, { opp: f.opponent.name, ai: f.opponent.ai, fightId: f.fightId });
}
const fin = await post('/api/run/finish', { runId: s.id, playerId: 'p4', name: '', hero: s.hero, wins: s.wins, losses: s.losses, day: s.day, build: toBuild(s) });
check('fighting after the run ended → 409', (await post('/api/fight', { runId: s.id, playerId: 'p4', name: '', day: s.day + 1, rating: 1000, build: toBuild(s) }))[0] === 409);
check('skipping ahead a day → 409', (await post('/api/fight', { runId: 'sec-skip-' + Date.now(), playerId: 'p5', day: 3, rating: 1000, build }))[0] === 409);
check('honest run gets its reward', fin[0] === 200 && fin[1].reward.stardust > 0, `w${s.wins} l${s.losses} → ${fin[1].reward?.stardust} ผงดาว`);
// 7 guided-tutorial fight: once per player, only on day 1 of a brand-new run, flag must be exactly true
{
  const pid = 'sec-tut-' + Date.now();
  const [t1, j1] = await post('/api/fight', { runId: pid + '-r1', playerId: pid, day: 1, rating: 1000, build, tutorial: true });
  check('tutorial fight: day 1 of a new run → training AI', t1 === 200 && j1.tutorial === true && j1.opponent.ai && j1.opponent.tier === 'easy', `won ${j1.won}`);
  const [t2, j2] = await post('/api/fight', { runId: pid + '-r2', playerId: pid, day: 1, rating: 1000, build, tutorial: true });
  check('tutorial fight: only once per player', t2 === 200 && !j2.tutorial);
  const [, j3] = await post('/api/fight', { runId: pid + '-r1', playerId: pid, day: 2, rating: 1000, build, tutorial: true });
  check('tutorial fight: not on day 2', !j3.tutorial);
  const [t4] = await post('/api/fight', { runId: pid + '-r1', playerId: pid, day: 1, rating: 1000, build, tutorial: true });
  check('tutorial fight: cannot re-fight day 1 → 409', t4 === 409);
  const [, j5] = await post('/api/fight', { runId: pid + '-r3', playerId: pid + 'x', day: 1, rating: 1000, build, tutorial: 'yes' });
  check('tutorial fight: flag must be exactly true', !j5.tutorial);
  // a tutorial win must not be farmable with fresh player ids: no rating gain, no stardust
  const fresh = 'sec-tf-' + Date.now();
  const [, jf] = await post('/api/fight', { runId: fresh + '-r', playerId: fresh, day: 1, rating: 1000, build, tutorial: true });
  check('tutorial fight: rating unchanged', jf.tutorial === true && jf.rating === 1000, `rating ${jf.rating}`);
  const [, fin] = await post('/api/run/finish', { runId: fresh + '-r', playerId: fresh, name: '', hero: 'knight', wins: jf.won ? 1 : 0, losses: jf.won ? 0 : 1, day: 1, build });
  check('tutorial fight: its win earns no stardust (same as a 0-win run: 5)', !jf.won || fin?.reward?.stardust === 5, `stardust ${fin?.reward?.stardust}`);
}
// sim v14: implausible builds are rejected (and so never enter the snapshot pool)
{
  const t = 'sec-pl-' + Date.now();
  const eight = { hero: 'knight', skills: ['shield', 'stoneskin', 'cleanse', 'bulwark', 'strike', 'jab', 'feast', 'frost'].map((id) => ({ id, v: '' })) };
  const [s8] = await post('/api/fight', { runId: t + '-a', playerId: t, day: 1, rating: 1000, build: eight });
  check('8 skills on day 1 → 400', s8 === 400, `status ${s8}`);
  const lv3 = { hero: 'knight', skills: [{ id: 'bulwark', v: 'a1' }, { id: 'shield', v: '' }] };
  const [s3] = await post('/api/fight', { runId: t + '-b', playerId: t, day: 1, rating: 1000, build: lv3 });
  check('Lv3 on day 1 → 400', s3 === 400, `status ${s3}`);
}
// sim v15 (round 4): forge scenarios from the playtest, the hero bound to the run, day-by-day spending
{
  const t = 'sec-f4-' + Date.now();
  const d1forge = { hero: 'knight', skills: ['ignite', 'heavy', 'frost', 'shield'].map((id) => ({ id, v: '' })) };
  const [f1] = await post('/api/fight', { runId: t + '-a', playerId: t, day: 1, rating: 1000, build: d1forge });
  check('forge: day-1 build outside the hero shop → 400', f1 === 400, `status ${f1}`);
  const ok1 = { hero: 'knight', skills: [{ id: 'bulwark', v: '' }, { id: 'shield', v: '' }] };
  const [o1] = await post('/api/fight', { runId: t + '-b', playerId: t, day: 1, rating: 1000, build: ok1 });
  check('honest day-1 knight accepted', o1 === 200, `status ${o1}`);
  const [sw] = await post('/api/fight', { runId: t + '-b', playerId: t, day: 2, rating: 1000, build: { hero: 'pyro', skills: [{ id: 'inferno', v: '' }] } });
  check('switching hero mid-run → 400', sw === 400, `status ${sw}`);
  // day 2: the run has at most 13 gold in total; this build needs 7 (day 1) + 4 + 4 + 3 + 3 = 21
  const rich = { hero: 'knight', skills: [{ id: 'bulwark', v: 'a' }, { id: 'shield', v: 'a' }, { id: 'stoneskin', v: '' }] };
  const [sp] = await post('/api/fight', { runId: t + '-b', playerId: t, day: 2, rating: 1000, build: { ...rich, skills: [...rich.skills, { id: 'cleanse', v: '' }] } });
  check('forge: day-2 build the run could not pay for → 400', sp === 400, `status ${sp}`);
  const d8 = { hero: 'knight', skills: ['charge:a2', 'gear:b2', 'bulwark:a2', 'strike:a1', 'heavy:a2', 'glacier:b2', 'venom:b', 'ignite:a1'].map((x) => ({ id: x.split(':')[0], v: x.split(':')[1] })) };
  const [s8b] = await post('/api/fight', { runId: t + '-c', playerId: t, day: 1, rating: 1000, build: d8 });
  check('forge: the 102g day-8 build from the playtest on a fresh run → 400', s8b === 400, `status ${s8b}`);
}
// sim v17 (round 6): branch choice, stars and relics. Relic offers come from a server-only seed (security review).
{
  const t = 'sec-r6-' + Date.now();
  /** play a run on the server with the normal bot (it picks branches and relics), up to `upto` days; returns the run */
  const play = async (id: string, hero: string, upto: number, tweak?: (day: number, b: ReturnType<typeof toBuild>, offer: string[]) => ReturnType<typeof toBuild> | null, act?: (s: ReturnType<typeof newRun>) => boolean | void) => {
    const s = newRun(hero, 4242, id);
    const res: { day: number; status: number; err?: string; offer?: string[] }[] = [];
    while (s.phase !== 'won' && s.phase !== 'dead' && s.day <= upto) {
      if (s.phase === 'lastchance') { chooseLastChance(s, 'supply'); continue; }
      if (s.phase === 'mark') { applyMark(s, 0); continue; }
      const offer = s.relicOffer?.slice();
      // act: an honest player's own moves (true = instead of the bot's shopping today)
      if (!act?.(s)) botDay(s, botRules([HEROES_BY_ID[hero].line], 'hard'));
      const honest = toBuild(s);
      const b = tweak?.(s.day, honest, offer ?? []) ?? honest;
      const [st, f] = await post('/api/fight', { runId: s.id, playerId: t, name: '', day: s.day, rating: s.rating, build: b });
      res.push({ day: s.day, status: st, err: f?.error, offer });
      if (st !== 200) break;
      if (Array.isArray(f.nextRelics)) s.relicNext = { day: s.day + 1, ids: f.nextRelics, ...(Array.isArray(f.nextRelicsRe) ? { re: f.nextRelicsRe } : {}) };
      s.online = true;
      for (const x of f.revealed ?? []) { const k = s.skills[x.idx]; if (k) { k.mark = x.mark; delete k.markHidden; } }
      s.rating = f.rating;
      recordResult(s, f.won, { opp: f.opponent.name, ai: f.opponent.ai, fightId: f.fightId }, f.result.winner === -1);
    }
    return { s, res };
  };
  // honest: the bot takes relics from the server's offer, chooses branches and buys stars → every day accepted
  const h = await play(t + '-h', 'pyro', 11);
  const relicsOwned = toBuild(h.s).relics ?? [];
  const stars = h.s.skills.reduce((n, k) => n + (k.star ?? 0), 0);
  check('honest run with relics, branch choice and stars: every day accepted', h.res.every((r) => r.status === 200), `days ${h.res.length} · relics ${relicsOwned.join(',') || '-'} · ★${stars} · ${h.res.find((r) => r.status !== 200)?.err ?? ''}`);
  check('the server sent the relic offers (picked relics came from them)', relicsOwned.length > 0 && h.res.filter((r) => [4, 7, 10].includes(r.day)).every((r) => !r.offer || r.offer.length === 3), relicsOwned.join(','));
  // off-offer: on day 4 take a relic the server did not offer
  const off = await play(t + '-o', 'pyro', 4, (day, b, offer) => {
    if (day !== 4) return null;
    const pick = RELICS.map((r) => r.id).find((id) => !offer.includes(id))!;
    return { ...b, relics: [pick] };
  });
  const offDay4 = off.res.find((r) => r.day === 4);
  check('forge: a relic the server did not offer → 400', offDay4?.status === 400 && (offDay4.offer ?? []).length === 3, `status ${offDay4?.status} ${offDay4?.err ?? ''} · offered ${offDay4?.offer?.join(',')}`);
  // a relic added on a non-relic day (day 5)
  // skip the relic on day 4, then add one of day 4's offer on day 5 (still within the count cap)
  let offer4: string[] = [];
  const late = await play(t + '-l', 'pyro', 5, (day, b, offer) => {
    if (day === 4) { offer4 = offer; return { ...b, relics: [] }; }
    if (day === 5) return { ...b, relics: [offer4[0]] };
    return null;
  });
  const d5 = late.res.find((r) => r.day === 5);
  check('forge: a relic added on a non-relic day (skipped on day 4, added day 5) → 400', late.res.find((r) => r.day === 4)?.status === 200 && d5?.status === 400, `status ${d5?.status} ${d5?.err ?? ''}`);
  // a relic dropped / swapped later
  const swap = await play(t + '-s', 'pyro', 5, (day, b) => (day === 5 && b.relics?.length ? { ...b, relics: [] } : null));
  const d5s = swap.res.find((r) => r.day === 5);
  check('forge: a relic dropped later → 400', !toBuild(swap.s).relics?.length || d5s?.status === 400, `status ${d5s?.status}`);
  // relic forgery on day 1 and unknown ids
  const k1 = { hero: 'knight', skills: [{ id: 'bulwark', v: '' }, { id: 'shield', v: '' }] };
  const [r1] = await post('/api/fight', { runId: t + '-d1', playerId: t, day: 1, rating: 1000, build: { ...k1, relics: ['bastion'] } });
  check('forge: a relic on day 1 → 400', r1 === 400, `status ${r1}`);
  const [r2] = await post('/api/fight', { runId: t + '-d1b', playerId: t, day: 1, rating: 1000, build: { ...k1, relics: ['godmode'] } });
  check('forge: an unknown relic id → 400', r2 === 400, `status ${r2}`);
  // stars: only on Lv3, at most ★★★, from day 7, and they cost gold
  const [x1] = await post('/api/fight', { runId: t + '-st1', playerId: t, day: 1, rating: 1000, build: { hero: 'knight', skills: [{ id: 'bulwark', v: '', star: 1 }, { id: 'shield', v: '' }] } });
  check('forge: a star on a Lv1 skill → 400', x1 === 400, `status ${x1}`);
  const starForge = await play(t + '-st2', 'knight', 5, (day, b) => (day === 5 ? { ...b, skills: b.skills.map((k) => (k.v.length === 2 ? { ...k, star: 3 } : k)) } : null));
  const s5 = starForge.res.find((r) => r.day === 5);
  check('forge: stars before day 7 → 400', s5?.status === 400 || !toBuild(starForge.s).skills.some((k) => k.v.length === 2), `status ${s5?.status} ${s5?.err ?? ''}`);
  const star4 = await play(t + '-st3', 'knight', 9, (day, b) => (day === 9 ? { ...b, skills: b.skills.map((k) => (k.v.length === 2 ? { ...k, star: 4 } : k)) } : null));
  const s9 = star4.res.find((r) => r.day === 9);
  check('forge: ★★★★ → 400', s9?.status === 400, `status ${s9?.status} ${s9?.err ?? ''}`);
  const rich = await play(t + '-st4', 'knight', 8, (day, b) => (day === 8 ? { ...b, skills: b.skills.map((k) => (k.v.length === 2 ? { ...k, star: 3 } : k)) } : null));
  const s8 = rich.res.find((r) => r.day === 8);
  check('forge: ★★★ on every Lv3 skill on day 8 (unpaid) → 400', s8?.status === 400, `status ${s8?.status} ${s8?.err ?? ''}`);
  // branch choice: switching a Lv3 skill to its other branch is a sell + rebuy (must be paid for)
  const sw = await play(t + '-br', 'knight', 6, (day, b) => (day === 6 ? { ...b, skills: b.skills.map((k) => (k.v.length === 2 ? { ...k, v: (k.v[0] === 'a' ? 'b' : 'a') + k.v[1] } : k)) } : null));
  const s6 = sw.res.find((r) => r.day === 6);
  const lv3at6 = toBuild(sw.s).skills.filter((k) => k.v.length === 2).length;
  check('forge: every Lv3 switched to the other branch for free → 400', s6?.status === 400 || lv3at6 === 0, `status ${s6?.status} ${s6?.err ?? ''} · Lv3 skills switched ${lv3at6}`);

  // ---- round 7 (sim v18) ----
  // 1 free marks: once every skill is Lv3 the forged build marks everything without paying wishes → 400;
  //   an honest moon-wish mark (paid, at most 2 a run) is accepted
  const lv3Only = (s: ReturnType<typeof newRun>) => { for (let i = s.skills.length - 1; i >= 0; i--) if (lvOf(s.skills[i].v) < 3) sell(s, i); };
  // 2 marks (within the 2-a-run cap) on Lv3 skills but no wish gold paid: the ledger must refuse them
  const fm = await play(t + '-fm', 'knight', 9, (day, b) => {
    if (day !== 9) return null;
    let n = 0;
    return { ...b, skills: b.skills.map((k) => (k.v.length === 2 && n < 2 ? (n++, { ...k, mark: 'quick' as const }) : k)) };
  });
  const fm9 = fm.res.find((r) => r.day === 9);
  check('forge: 2 unpaid marks on Lv3 skills (ledger) → 400', fm9?.status === 400, `status ${fm9?.status} ${fm9?.err ?? ''}`);
  const fm3 = await play(t + '-fm3', 'knight', 9, (day, b) => (day === 9 ? { ...b, skills: b.skills.map((k) => ({ ...k, mark: 'echo' as const })) } : null));
  const fm39 = fm3.res.find((r) => r.day === 9);
  check('forge: marks on every skill → 400', fm39?.status === 400, `status ${fm39?.status} ${fm39?.err ?? ''}`);
  let wished = '';
  // from day 9 the player stops shopping, keeps only Lv3 skills and spends its gold on mark wishes
  const hw = await play(t + '-hw', 'knight', 12, undefined, (s) => {
    if (s.day < 9) return false;
    lv3Only(s);
    while (wishKind(s) === 'mark' && s.gold >= wishPrice(s)) { const w = wish(s); if ('mark' in w && w.mark) wished += w.mark + ' '; }
    return true;
  });
  check('honest: paid moon-wish marks are accepted (at most 2 a run)', hw.res.every((r) => r.status === 200) && (hw.s.wishMarks ?? 0) >= 1 && (hw.s.wishMarks ?? 0) <= 2, `marks ${wished || 'none (no gold)'} · ${hw.res.find((r) => r.status !== 200)?.err ?? 'all days 200'}`);
  // 2 relic-offer oracle: a future day or someone else's run gives the same answer for every relic
  const victim = h.s.id;
  const answers = new Set<string>();
  for (const r of RELICS.slice(0, 8)) {
    const [st, f] = await post('/api/fight', { runId: victim, playerId: t + '-other', day: 12, rating: 1000, build: { ...toBuild(h.s), relics: [r.id] } });
    answers.add(`${st} ${f?.error}`);
  }
  check('oracle: another player probing relics on a run id gets one answer (403) for every relic', answers.size === 1 && [...answers][0].startsWith('403'), [...answers].join(' | '));
  const own = await play(t + '-or', 'witch', 5);
  const fut = new Set<string>();
  for (const r of RELICS.slice(0, 10)) {
    const [st, f] = await post('/api/fight', { runId: own.s.id, playerId: t, day: 7, rating: 1000, build: { ...toBuild(own.s), relics: [...(toBuild(own.s).relics ?? []), r.id] } });
    fut.add(`${st} ${f?.error}`);
  }
  check('oracle: probing a future day gives one answer (409) for every relic', fut.size === 1 && [...fut][0].startsWith('409'), [...fut].join(' | '));
  // 3 finish with unpaid stars (gold cap fine, running spend not)
  const fb = toBuild(h.s);
  const [fs, fj] = await post('/api/run/finish', { runId: h.s.id, playerId: t, name: '', hero: fb.hero, wins: h.s.wins, losses: h.s.losses, day: h.s.day, build: { ...fb, skills: fb.skills.map((k) => (k.v.length === 2 ? { ...k, star: 3 } : k)) } });
  check('finish: a final build with unpaid ★★★ → 400', fs === 400, `status ${fs} ${fj?.error ?? ''}`);
  // 2b /finish is no relic oracle: a claim that does not match the fights on record gets one answer for every relic,
  //    and with a matching claim a bad relic and an unpaid build get the same error
  const fAns = new Set<string>();
  for (const r of RELICS.slice(0, 8)) {
    const [st, f] = await post('/api/run/finish', { runId: h.s.id, playerId: t, name: '', hero: fb.hero, wins: h.s.wins, losses: h.s.losses + 3, day: h.s.day + 3, build: { ...fb, relics: [...(fb.relics ?? []), r.id] } });
    fAns.add(`${st} ${f?.error}`);
  }
  check('finish oracle: a claim off the record gets one answer (409) for every relic', fAns.size === 1 && [...fAns][0].startsWith('409'), [...fAns].join(' | '));
  const [, br] = await post('/api/run/finish', { runId: h.s.id, playerId: t, name: '', hero: fb.hero, wins: h.s.wins, losses: h.s.losses, day: h.s.day, build: { ...fb, relics: [...(fb.relics ?? []).slice(0, 2), RELICS.find((r) => !(fb.relics ?? []).includes(r.id))!.id] } });
  check('finish oracle: a bad relic and an unpaid build get the same error', br?.error === fj?.error && fj?.error === 'implausible build', `${br?.error} / ${fj?.error}`);
  // round 8: mark kinds are the server's rolls; a wish mark needs the older skills at Lv3; a Lv3 branch swap loses the mark
  const MK = ['burn', 'echo', 'quick', 'steadfast'] as const;
  let honestKind = '';
  const wrongKind = await play(t + '-wk', 'knight', 12, (day, b) => {
    // replace the honest wish mark's kind with another kind
    const k = b.skills.find((x) => x.mark);
    if (!k || honestKind) return null;
    honestKind = k.mark!;
    return { ...b, skills: b.skills.map((x) => (x === k ? { ...x, mark: MK.find((m) => m !== k.mark)! } : x)) };
  }, (s) => {
    if (s.day < 9) return false;
    lv3Only(s);
    if (wishKind(s) === 'mark' && s.gold >= wishPrice(s)) wish(s);
    return true;
  });
  const wkRow = wrongKind.res.find((r) => r.status !== 200);
  check('forge: a wish mark of another kind than the server rolled → 400', !!honestKind && wkRow?.status === 400, `honest ${honestKind || 'none'} · ${wkRow?.status} ${wkRow?.err ?? ''}`);
  const lowOld = await play(t + '-lo', 'knight', 10, (day, b) => {
    if (day !== 10) return null;
    const lv3 = b.skills.find((x) => x.v.length === 2);
    const low = b.skills.find((x) => x.v.length < 2);
    if (!lv3 || !low) return null;
    return { ...b, skills: b.skills.map((x) => (x === lv3 ? { ...x, mark: 'quick' as const } : x)) };
  });
  const lo10 = lowOld.res.find((r) => r.day === 10);
  check('forge: a wish mark while an older skill is below Lv3 → 400', !lo10 || lo10.status === 400, `${lo10?.status} ${lo10?.err ?? ''}`);
  const swapMark = await play(t + '-sm', 'knight', 12, (day, b) => {
    const k = b.skills.find((x) => x.mark && x.v.length === 2);
    if (!k || day < 10) return null;
    return { ...b, skills: b.skills.map((x) => (x === k ? { ...x, v: (x.v[0] === 'a' ? 'b' : 'a') + x.v[1] } : x)) };
  }, (s) => {
    if (s.day < 9) return false;
    lv3Only(s);
    if (wishKind(s) === 'mark' && s.gold >= wishPrice(s)) wish(s);
    return true;
  });
  const smRow = swapMark.res.find((r) => r.status !== 200);
  check('forge: a mark kept through a Lv3 branch swap → 400', smRow?.status === 400, `${smRow?.day} ${smRow?.status} ${smRow?.err ?? ''}`);
  // round 9: no mark kinds ahead of time; a hidden mark the server can't place is rejected; honest hidden marks get revealed
  {
    const [, f1] = await post('/api/fight', { runId: t + '-nk', playerId: t, day: 1, rating: 1000, build: { hero: 'knight', skills: [{ id: 'bulwark', v: '' }, { id: 'shield', v: '' }] } });
    check('fight responses carry no mark kinds ahead of time', f1 && !('markKinds' in f1), Object.keys(f1 ?? {}).join(','));
    const [fh] = await post('/api/fight', { runId: t + '-nk', playerId: t, day: 2, rating: 1000, build: { hero: 'knight', skills: [{ id: 'bulwark', v: '', markHidden: 'oops' }, { id: 'shield', v: '' }] } });
    check('forge: a hidden mark of an unknown kind → 400', fh === 400, `status ${fh}`);
    let revealedKinds = '';
    const hid = await play(t + '-hd', 'knight', 11, undefined, (s) => {
      if (s.day < 9) return false;
      lv3Only(s);
      if (wishKind(s) === 'mark' && s.gold >= wishPrice(s)) wish(s);
      return true;
    });
    revealedKinds = hid.s.skills.filter((k) => k.mark).map((k) => k.mark).join(',');
    check('honest: a wish mark is carved hidden and the next fight reveals the server kind', hid.res.every((r) => r.status === 200) && !hid.s.skills.some((k) => k.markHidden) && revealedKinds.length > 0, `revealed ${revealedKinds || 'none'}`);
  }
  // round 9 security review: explicit kinds are no oracle; the source label is the server's call
  {
    const id = t + '-or9';
    const s = newRun('knight', 4242, id);
    const errs = new Set<string>();
    let hiddenOk = false;
    let lieOk = false;
    while (s.phase !== 'won' && s.phase !== 'dead' && s.day <= 12) {
      if (s.phase === 'lastchance') { chooseLastChance(s, 'supply'); continue; }
      if (s.phase === 'mark') { applyMark(s, 0); continue; }
      if (s.day >= 9) lv3Only(s); else botDay(s, botRules(['shield'], 'hard'));
      if (s.day >= 9 && !hiddenOk && wishKind(s) === 'mark' && s.gold >= wishPrice(s)) {
        s.online = true;
        wish(s); // carved hidden
        const hb = toBuild(s);
        const idx = hb.skills.findIndex((k) => k.markHidden);
        // the same gained mark with each explicit kind: one answer for all four (one of them is the real roll)
        for (const m of ['burn', 'echo', 'quick', 'steadfast'] as const) {
          const [st, f] = await post('/api/fight', { runId: id, playerId: t, name: '', day: s.day, rating: 1000, build: { ...hb, skills: hb.skills.map((k, i) => (i === idx ? { id: k.id, v: k.v, ...(k.bonus ? { bonus: k.bonus } : {}), mark: m } : k)) } });
          errs.add(`${st} ${f?.error}`);
        }
        // a lying source label ('last' on a run that never had a last chance) changes nothing: accepted as a wish mark
        const [st2, f2] = await post('/api/fight', { runId: id, playerId: t, name: '', day: s.day, rating: 1000, build: { ...hb, skills: hb.skills.map((k, i) => (i === idx ? { ...k, markHidden: 'last' as const } : k)) } });
        lieOk = st2 === 200 && (f2.revealed ?? []).length === 1;
        hiddenOk = lieOk;
        if (st2 !== 200) break;
        for (const x of f2.revealed ?? []) { const k = s.skills[x.idx]; if (k) { k.mark = x.mark; delete k.markHidden; } }
        recordResult(s, f2.won, { opp: f2.opponent.name, ai: true }, f2.result.winner === -1);
        continue;
      }
      const [st, f] = await post('/api/fight', { runId: id, playerId: t, name: '', day: s.day, rating: s.rating, build: toBuild(s) });
      if (st !== 200) break;
      if (Array.isArray(f.nextRelics)) s.relicNext = { day: s.day + 1, ids: f.nextRelics, ...(Array.isArray(f.nextRelicsRe) ? { re: f.nextRelicsRe } : {}) };
      recordResult(s, f.won, { opp: f.opponent.name, ai: true }, f.result.winner === -1);
    }
    check('oracle: a gained mark with an explicit kind gets one error for every kind', errs.size === 1 && [...errs][0].startsWith('400'), [...errs].join(' | '));
    check('a gained mark sent hidden is accepted, and a lying source label has no effect', hiddenOk && lieOk, `hidden ${hiddenOk}`);
  }
  // 4 the client's wish rules match the server's: no mark wish before every skill is Lv3
  const early = newRun('knight', 77, t + '-ew');
  early.day = 3; early.gold = 50;
  early.skills = [{ id: 'bulwark', v: 'a' }, { id: 'shield', v: 'b' }];
  check('client: a wish on an all-Lv2 build before day 4 gives no mark (the server would refuse it)', wishKind(early) === null, String(wishKind(early)));
}

// ---- the public site: waitlist, feedback, events, admin (site.ts) ----
{
  const tag = Date.now().toString(36);
  // a body over 64 KB is refused before it is parsed
  const big = await fetch(BASE + '/api/feedback', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'x'.repeat(70_000) }) }).then((r) => r.status).catch(() => 0);
  check('site: a 70 KB body is refused', big === 400 || big === 0, String(big));
  // contact fields must look like what they claim to be (no markup or formulas reach the CSV)
  const [s1] = await post('/api/waitlist', { telegram: '=HYPERLINK("x")', consent: true });
  const [s2] = await post('/api/waitlist', { x: '<script>', consent: true });
  check('site: waitlist refuses markup and formulas in handles', s1 === 400 && s2 === 400, `${s1} ${s2}`);
  // events: a batch is capped and unknown names are dropped
  const [s3, e3] = await post('/api/events', { v: 'sec-' + tag, events: Array.from({ length: 100 }, () => ({ e: 'landing_view' })) });
  check('site: an events batch counts at most 30', s3 === 200 && e3.ok === 30, JSON.stringify(e3));
  const [, e4] = await post('/api/events', { v: 'sec-' + tag, events: [{ e: 'fight' }, { e: 'run_end' }, { e: 'waitlist' }] });
  check('site: the browser cannot fake server-side events (fight, run_end, waitlist)', e4.ok === 0, JSON.stringify(e4));
  // admin: no token, wrong token, then lockout after repeated wrong tokens
  const adm = (tok?: string) => fetch(BASE + '/api/admin/overview', { headers: tok ? { authorization: 'Bearer ' + tok } : {} }).then((r) => r.status);
  const a0 = await adm();
  check('site: admin API without a token is refused', a0 === 401 || a0 === 503, String(a0));
  if (a0 === 401) {
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) codes.push(await adm('guess-' + tag + i));
    // earlier wrong tokens from this IP (e.g. e2e-site) count too: some 401s, then only 429s, never more than 10 401s
    const first429 = codes.indexOf(429);
    check('site: admin locks out after 10 wrong tokens', first429 >= 0 && first429 <= 10 && codes.slice(first429).every((c) => c === 429), codes.join(','));
    if (process.env.ADMIN_TOKEN) check('site: the right token still gets in during a lockout', (await adm(process.env.ADMIN_TOKEN)) === 200);
  }
  // waitlist sign-ups are rate limited per IP
  const codes: number[] = [];
  for (let i = 0; i < 8; i++) codes.push((await post('/api/waitlist', { telegram: `@sec_${tag}_${i}`, consent: true }))[0]);
  check('site: waitlist allows a few sign-ups per IP per hour, then 429', codes.includes(429) && codes.filter((c) => c === 200).length <= 6, codes.join(','));
}
