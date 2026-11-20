// Text play for AI playtesters: one run of the real game rules (shop, list order, fights vs bot builds), saved to a
// JSON file between commands. Usage: npx tsx scripts/play-cli.ts <state.json> <command> [args]
//   new <seed> [easy|normal|hard]   start: shows 3 hero choices      pick <heroId>
//   show                            shop, list, gold, next opponent   buy <shopIdx> | sell <listIdx> | move <listIdx> <up|down>
//   reroll | lock <shopIdx> | slot | wish                             fight   (then: chance awaken|mark|supply · mark <listIdx>)
//   skill <id>                      full tree of a skill              heroes  all heroes
// Indexes are 0-based. The opponent of the day is rolled when the day starts and shown in `show` (scouting).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { detailLines, simpleBonus, simpleText } from '../src/client/skillText';
import { randomAiBuild, type BotTier } from '../src/sim/bot';
import { simulate } from '../src/sim/combat';
import { explain } from '../src/sim/explain';
import { HEROES, HEROES_BY_ID, ultLevel, ultPieces } from '../src/sim/heroes';
import { hashSeed } from '../src/sim/rng';
import * as R from '../src/sim/run';
import { SKILLS, VARIANTS, lvOf, nodeOf } from '../src/sim/skills';
import type { Build, CombatEvent } from '../src/sim/types';

interface Save { s?: R.RunState; seed: number; tier: BotTier; choices?: string[]; opp?: { day: number; build: Build }; history: string[] }

const [file, cmd, ...args] = process.argv.slice(2);
if (!file || !cmd) {
  console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(0, 7).join('\n'));
  process.exit(1);
}
const save: Save = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { seed: 1, tier: 'normal', history: [] };
const out: string[] = [];
const p = (...x: unknown[]) => out.push(x.join(' '));
const fail = (m: string) => {
  console.log('✘ ' + m);
  process.exit(2);
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const lineOf = (id: string): string => ((SKILLS[id] as any)?.line ?? (SKILLS[id] as any)?.arch ?? '?') as string;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const heroLine = (id: string): string => ((HEROES_BY_ID[id] as any)?.line ?? (HEROES_BY_ID[id] as any)?.arch ?? '?') as string;
const lv = (v: string) => lvOf(v);

function oppFor(s: R.RunState): Build {
  if (!save.opp || save.opp.day !== s.day) save.opp = { day: s.day, build: randomAiBuild(s.day, hashSeed(save.seed, 'opp', s.day, s.wins, s.losses), save.tier) };
  return save.opp.build;
}

function describeBuild(b: Build, title: string) {
  p(`${title}: ${HEROES_BY_ID[b.hero].name} (${b.hero}, line ${heroLine(b.hero)})`);
  b.skills.forEach((k, i) => p(`   ${i}. ${nodeOf(k).name} [${k.id} Lv${lv(k.v)} ${lineOf(k.id)}${k.mark ? ' mark:' + k.mark : ''}] ${simpleText(k)}`));
}

function show(s: R.RunState) {
  const h = HEROES_BY_ID[s.hero];
  p(`== Day ${s.day} · HP ${s.hp} · wins ${s.wins}/${R.WIN_TARGET} · losses ${s.losses} · gold ${s.gold} · streak ${s.streak} · phase ${s.phase}${s.ghost ? ' · LAST LIFE' : ''}`);
  p(`Hero: ${h.name} (${h.id}, line ${heroLine(h.id)}) — ${h.passive}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const extra = h as any;
  if (extra.ult) p(`Ultimate: ${JSON.stringify(extra.ult).slice(0, 400)}
Ult pieces now: ${ultPieces(R.toBuild(s))} (3 = Lv1, 5 = Lv2; a Lv3 skill of your line counts +1) → ult Lv${ultLevel(R.toBuild(s))}`);
  const slots = R.slotsOf(s);
  p(`List (${s.skills.length}/${slots} slots; top to bottom, neighbours can switch on connect bonuses):`);
  s.skills.forEach((k, i) => {
    const bon = (k.bonus ?? []).map((b) => simpleBonus(b, lv(k.v))).join(' | ');
    p(`   ${i}. ${nodeOf(k).name} [${k.id} Lv${lv(k.v)} ${lineOf(k.id)}${k.mark ? ' mark:' + k.mark : ''}]${i >= slots ? ' (NOT FIGHTING: no slot)' : ''}\n        ${simpleText(k)}${bon ? `\n        connect: ${bon}` : ''}`);
  });
  if (s.phase === 'shop') {
    p(`Shop (reroll ${R.REROLL}g · slot ${R.slotPrice(s)}g · wish ${R.wishPrice(s)}g):`);
    s.shop.forEach((o, i) => {
      if (!o) return p(`   ${i}. (sold)`);
      const up = R.upgradeOf(s, o);
      const k = { id: o.id, v: o.v, bonus: o.bonus };
      const bon = (o.bonus ?? []).map((b) => simpleBonus(b, lv(o.v))).join(' | ');
      p(`   ${i}. ${up ? 'UPGRADE → ' : ''}${nodeOf(k).name} [${o.id} Lv${lv(o.v)} ${lineOf(o.id)}] ${R.priceOf(o)}g${R.isLocked(s, i) ? ' (locked)' : ''}\n        ${simpleText(k)}${bon ? `\n        connect: ${bon}` : ''}`);
    });
    describeBuild(oppFor(s), 'Next opponent (scouted)');
  }
  if (s.phase === 'lastchance') p('You died once: choose `chance awaken` (all Lv1 → Lv2), `chance mark` (a random mark), or `chance supply` (+8 gold, +1 slot).');
  if (s.phase === 'mark') p(`Place mark ${s.pendingMark}: \`mark <listIdx>\` (-1 = skip). ${R.MARK_INFO[s.pendingMark!].name}: ${R.MARK_INFO[s.pendingMark!].desc}`);
  if (s.phase === 'won' || s.phase === 'dead') p(`RUN OVER: ${s.phase === 'won' ? 'WON (10 wins)' : 'DEAD'}. Log: ${s.log.map((l) => (l.won ? 'W' : 'L')).join('')}`);
}

function fightSummary(ev: CombatEvent[], names: [string, string]) {
  const known = new Set(['cast', 'damage', 'shield', 'heal', 'status', 'fatigue', 'end']);
  const lines: string[] = [];
  for (const e of ev) {
    const t = (e.t / 10).toFixed(1) + 's';
    if (!known.has(e.type)) lines.push(`  ${t} ★ ${JSON.stringify(e).replace(/,"s":\{.*$/, '}')}`);
    else if (e.type === 'cast' && lines.length < 400) lines.push(`  ${t} ${names[e.side]} ${e.skill} Lv${e.lv}${e.from !== undefined ? ' (set off)' : ''}${e.react ? ' (react)' : ''}  HP ${e.s.hp.join('/')} SH ${e.s.sh.join('/')}`);
  }
  return lines;
}

const s = save.s;
switch (cmd) {
  case 'new': {
    save.seed = Number(args[0] ?? Date.now() % 1e9);
    save.tier = (args[1] as BotTier) ?? 'normal';
    save.choices = R.heroChoices(save.seed);
    delete save.s;
    p('Pick a hero with `pick <id>`:');
    for (const id of save.choices) {
      const h = HEROES_BY_ID[id];
      p(` - ${id}: ${h.name} (line ${heroLine(id)}) — ${h.style}\n     passive: ${h.passive}\n     day-1 shop: ${h.day1.join(', ')}`);
    }
    break;
  }
  case 'heroes':
    for (const h of HEROES) p(` - ${h.id}: ${h.name} (line ${heroLine(h.id)}) — ${h.style}\n     passive: ${h.passive}`);
    break;
  case 'pick': {
    if (!save.choices?.includes(args[0])) fail(`pick one of ${save.choices?.join(', ')}`);
    save.s = R.newRun(args[0], save.seed, 'cli');
    show(save.s);
    break;
  }
  case 'skill': {
    const d = SKILLS[args[0]];
    if (!d) fail('unknown skill');
    p(`${d.name} [${d.id}] line ${lineOf(d.id)}${d.hero ? ' unique of ' + d.hero : ''}`);
    for (const v of VARIANTS) p(`  ${v || 'Lv1'}: ${d.tree[v].name} — ${simpleText({ id: d.id, v })}\n      ${detailLines({ id: d.id, v }).join('\n      ')}`);
    break;
  }
  default: {
    if (!s) fail('no run: `new <seed>` then `pick <hero>`');
    const st = s!;
    const n = (x: string | undefined) => Number(x);
    let err: string | null = null;
    if (cmd === 'show') {
      // nothing
    } else if (cmd === 'buy') err = R.buy(st, n(args[0]));
    else if (cmd === 'sell') R.sell(st, n(args[0]));
    else if (cmd === 'move') R.moveSkill(st, n(args[0]), args[1] === 'up' ? -1 : 1);
    else if (cmd === 'reroll') err = R.reroll(st);
    else if (cmd === 'lock') err = R.toggleLock(st, n(args[0]));
    else if (cmd === 'slot') err = R.buySlot(st);
    else if (cmd === 'wish') {
      const w = R.wish(st);
      p('wish: ' + JSON.stringify(w));
    } else if (cmd === 'chance') R.chooseLastChance(st, args[0] as R.LastChanceOption);
    else if (cmd === 'mark') R.applyMark(st, n(args[0]));
    else if (cmd === 'fight') {
      if (st.phase !== 'shop') fail('not in the shop');
      const me = R.toBuild(st);
      const opp = oppFor(st);
      const r = simulate(me, opp, hashSeed(save.seed, 'fight', st.day, st.wins, st.losses), st.day);
      const ex = explain(r, [me, opp], 0, ['You', 'Enemy'], { drawIsLoss: true });
      const won = r.winner === 0;
      p(`### Fight day ${st.day}: ${won ? 'WIN' : 'LOSS'} in ${(r.ticks / 10).toFixed(1)}s — ${ex.headline}`);
      describeBuild(opp, 'Opponent');
      ex.facts.forEach((f) => p(' fact: ' + f));
      ex.reasons.forEach((f) => p(' why: ' + f));
      ex.moments.forEach((m) => p(` moment: ${m.title} — ${m.text}`));
      p(' timeline (casts + special events ★):');
      fightSummary(r.events, ['You', 'Enemy']).slice(0, 80).forEach((l) => p(l));
      save.history.push(`D${st.day} ${won ? 'W' : 'L'} vs ${opp.hero} ${(r.ticks / 10).toFixed(1)}s`);
      R.recordResult(st, won, { opp: 'bot', ai: true });
    } else fail('unknown command ' + cmd);
    if (err) p('✘ ' + err);
    if (st.phase === 'shop' || cmd !== 'fight' || true) show(st);
  }
}
writeFileSync(file, JSON.stringify(save));
console.log(out.join('\n'));
