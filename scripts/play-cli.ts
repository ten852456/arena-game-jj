// Text play for AI playtesters: one run of the real game rules (shop, list order, fights vs bot builds), saved to a
// JSON file between commands. Usage: npx tsx scripts/play-cli.ts <state.json> <command> [args]
//   new <seed> [auto|easy|normal|hard]  start (auto = the server's AI tiers) · pick <heroId>
//   show                            shop, list, gold, scouting       buy <shopIdx> | sell <listIdx> | move <listIdx> <up|down>
//   reroll | lock <shopIdx> | slot | wish                             fight   (then: chance awaken|mark|supply · mark <listIdx>)
//   skill <id>                      full tree of a skill              heroes  all heroes
// Indexes are 0-based and do NOT shift: a bought card leaves an empty place, so the other shop indexes stay the same.
// Scouting shows only the next opponent's hero, line and ult level (like the real game; the server rolls the fight
// seed after your build is locked, so a fight can't be simulated in advance). The seed here is random at `fight`.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomInt } from 'node:crypto';
import { detailLines, simpleBonus, simpleText } from '../src/client/skillText';
import { aiBuild, lossDrop, type BotTier } from '../src/sim/bot';
import { LINES } from '../src/sim/types';
import { simulate } from '../src/sim/combat';
import { explain } from '../src/sim/explain';
import { HEROES, HEROES_BY_ID, inLine, lineAffinity, ultGain, ultLevel, ultProgressText, ultRuleText } from '../src/sim/heroes';
import { T } from '../src/sim/tuning';
import { hashSeed } from '../src/sim/rng';
import * as R from '../src/sim/run';
import { SKILLS, VARIANTS, lvOf, nodeOf, rarityOf, upgradeDiffText } from '../src/sim/skills';
import type { Build, CombatEvent } from '../src/sim/types';

type CliTier = BotTier | 'auto';
/** the next opponent is not stored (the save file would leak it): only its day and tier; the build is regenerated from the seed */
interface Save { s?: R.RunState; seed: number; tier: CliTier; choices?: string[]; opp?: { day: number; tier: BotTier; hero: string }; history: string[] }

const [file, cmd, ...args] = process.argv.slice(2);
if (!file || !cmd) {
  console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(0, 7).join('\n'));
  process.exit(1);
}
const save: Save = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { seed: 1, tier: 'auto', history: [] };
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

/** the server's AI tier rule (src/server/match.ts tierFor) without a rating: easy on days 1–2 or after 2 losses in a row, hard after 3 wins in a row */
const autoTier = (s: R.RunState): BotTier => (s.day <= 2 || lossDrop(s.day, s.streak) ? 'easy' : s.streak >= 3 ? 'hard' : 'normal');
/**
 * Today's opponent: its hero (and tier) is rolled once per day with a real random number and saved, so scouting can show
 * it; its build is rolled only when you fight, with a fresh random seed, so nothing in the save predicts it.
 * Like the server: no mirror match on days 1–2, and half of the mirrors re-rolled later.
 */
function oppHero(s: R.RunState) {
  if (!save.opp || save.opp.day !== s.day || !save.opp.hero) {
    let hero = HEROES[randomInt(0, HEROES.length)].id;
    if (hero === s.hero && (s.day <= 2 || randomInt(0, 2) === 0)) {
      const others = HEROES.filter((h) => h.id !== s.hero);
      hero = others[randomInt(0, others.length)].id;
    }
    save.opp = { day: s.day, tier: save.tier === 'auto' ? autoTier(s) : save.tier, hero };
  }
  return save.opp;
}
function oppFor(s: R.RunState): Build {
  const o = oppHero(s);
  const line = HEROES_BY_ID[o.hero].line;
  const second = LINES.filter((l) => l !== line)[randomInt(0, 7)];
  return aiBuild(o.hero, s.day, [line, second], randomInt(0, 2 ** 31), o.tier);
}
const markText = (m?: string) => (m ? ` mark ${R.MARK_INFO[m as keyof typeof R.MARK_INFO].name} (${R.MARK_INFO[m as keyof typeof R.MARK_INFO].desc})` : '');
/** ult in words at the level it has now */
function ultText(hero: string, lv: number) {
  const u = HEROES_BY_ID[hero].ult;
  const at = (x: string) => (x.split(' · Lv2 ')[lv >= 2 ? 1 : 0] ?? x);
  return `${u.name}: when ${at(u.trigger)} → ${at(u.effect)}`;
}

function describeBuild(b: Build, title: string) {
  p(`${title}: ${HEROES_BY_ID[b.hero].name} (${b.hero}, line ${heroLine(b.hero)})`);
  b.skills.forEach((k, i) => p(`   ${i}. ${nodeOf(k).name} [${k.id} Lv${lv(k.v)} ${lineOf(k.id)}]${markText(k.mark)} ${simpleText(k)}`));
}

function show(s: R.RunState) {
  const h = HEROES_BY_ID[s.hero];
  p(`== Day ${s.day} · run HP (lives) ${s.hp}/${R.START_HP} · wins ${s.wins}/${R.WIN_TARGET} · losses ${s.losses} · gold ${s.gold} · streak ${s.streak} · phase ${s.phase}${s.ghost ? ' · LAST LIFE' : ''}`);
  p(`Hero: ${h.name} (${h.id}, line ${heroLine(h.id)}) — ${h.passive}`);
  const b0 = R.toBuild(s);
  const ulv = ultLevel(b0);
  p(`Ultimate ★ ${h.ult.name} — Lv1: when ${h.ult.trigger.split(' · Lv2 ')[0]} → ${h.ult.effect.split(' · Lv2 ')[0]}`);
  p(`   Lv2: when ${h.ult.trigger.split(' · Lv2 ')[1] ?? '-'} → ${h.ult.effect.split(' · Lv2 ')[1] ?? '-'}`);
  p(`Ult: ${ultProgressText(b0, false)} → ult ${ulv ? `Lv${ulv}` : 'locked'} (${ultRuleText(false)}) · ${heroLine(h.id)} skills are also stronger (line mastery)`);
  const slots = R.slotsOf(s);
  if (s.day > 1 && R.slotsFor(s.day) > R.slotsFor(s.day - 1)) p(`★ New today: +1 skill slot (${slots} now)`);
  if (s.phase === 'shop' && s.skills.length < slots) p(`⚠ ${slots - s.skills.length} empty skill slot(s): buy something before you fight`);
  p(`List (${s.skills.length}/${slots} slots; top to bottom, neighbours can switch on connect bonuses):`);
  s.skills.forEach((k, i) => {
    const bon = (k.bonus ?? []).map((b) => simpleBonus(b, lv(k.v))).join(' | ');
    const after = ultLevel({ hero: s.hero, skills: s.skills.filter((_, j) => j !== i).slice(0, slots) });
    const drop = after < ulv ? ` (selling it drops the ult Lv${ulv} → ${after ? 'Lv' + after : 'locked'})` : '';
    p(`   ${i}. ${nodeOf(k).name} [${k.id} Lv${lv(k.v)} ${lineOf(k.id)}]${SKILLS[k.id].hero ? ' [UNIQUE]' : ''}${rarityOf(k.id, k.v) !== 'common' ? ` [${rarityOf(k.id, k.v).toUpperCase()}]` : ''}${markText(k.mark)}${inLine(s.hero, k.id) ? ` (line mastery: numbers +${Math.round((lineAffinity(s.hero) - 1) * 100)}%)` : ''}${i >= slots ? ' (NOT FIGHTING: no slot)' : ''}${drop}\n        ${simpleText(k)}${bon ? `\n        connect: ${bon}` : ''}`);
  });
  if (s.phase === 'shop') {
    p(`Shop (reroll ${R.REROLL}g · slot ${R.slotsOf(s) >= R.MAX_SLOTS ? `FULL (${R.MAX_SLOTS}/${R.MAX_SLOTS})` : `${R.slotPrice(s)}g`} · wish ${R.wishPrice(s)}g = upgrades a RANDOM skill of yours below Lv3 to a random next branch):`);
    s.shop.forEach((o, i) => {
      if (!o) return p(`   ${i}. (sold)`);
      const up = R.upgradeOf(s, o);
      const k = { id: o.id, v: o.v, bonus: o.bonus };
      const bon = (o.bonus ?? []).map((b) => simpleBonus(b, lv(o.v))).join(' | ');
      const g = ultGain(b0, o);
      const tag = g.pieces ? ` ★ ${o.v ? 'Lv3 toward ult Lv2' : '+1 ult piece'}${g.lv > ulv ? ` (unlocks ult Lv${g.lv}!)` : ''}` : '';
      const diff = up ? upgradeDiffText(nodeOf(up), nodeOf(k), false) : '';
      p(`   ${i}. ${up ? `UPGRADE Lv${lv(up.v)} → ` : ''}${nodeOf(k).name} [${o.id} Lv${lv(o.v)} ${lineOf(o.id)}]${SKILLS[o.id].hero ? ' [UNIQUE]' : ''}${rarityOf(o.id, o.v) !== 'common' ? ` [${rarityOf(o.id, o.v).toUpperCase()}]` : ''} ${R.priceOf(o)}g${R.isLocked(s, i) ? ' (locked)' : ''}${tag}\n        ${simpleText(k)}${diff ? `\n        change: ${diff}${diff.includes('▼') ? ' (▼ = worse)' : ''}` : ''}${bon ? `\n        connect: ${bon}` : ''}`);
    });
    p('   (indexes do not shift: a bought card leaves an empty place)');
    const oh = oppHero(s);
    p(`Next opponent (scouted): ${HEROES_BY_ID[oh.hero].name} (${oh.hero}, line ${heroLine(oh.hero)}) · AI ${oh.tier} (its build is rolled when you fight)`);
  }
  if (s.phase === 'lastchance') p('You died once: choose `chance awaken` (all Lv1 → Lv2), `chance mark` (a random mark), or `chance supply` (+8 gold, +1 slot).');
  if (s.phase === 'mark') p(`Place mark ${s.pendingMark}: \`mark <listIdx>\` (-1 = skip). ${R.MARK_INFO[s.pendingMark!].name}: ${R.MARK_INFO[s.pendingMark!].desc}`);
  if (s.phase === 'won' || s.phase === 'dead') p(`RUN OVER: ${s.phase === 'won' ? 'WON (10 wins)' : 'DEAD'}. Log: ${s.log.map((l) => (l.won ? 'W' : 'L')).join('')}`);
}

function fightSummary(ev: CombatEvent[], names: [string, string], builds: [Build, Build]) {
  const lines: string[] = [];
  for (const e of ev) {
    const t = (e.t / 10).toFixed(1) + 's';
    if (lines.length >= 400) break;
    const hp = `HP ${names[0]} ${e.s.hp[0]} · ${names[1]} ${e.s.hp[1]}`;
    /** English verb for side s: "You take" / "Enemy takes" */
    const v = (s: number, you: string, it: string) => (names[s] === 'You' ? you : it);
    if (e.type === 'ult') lines.push(`  ${t} ★ ${names[e.side]} ULTIMATE ${ultText(builds[e.side].hero, e.lv)} (Lv${e.lv})  ${hp}`);
    else if (e.type === 'cast') lines.push(`  ${t} ${names[e.side]} ${e.skill} Lv${e.lv}${e.from !== undefined ? ' (set off)' : ''}${e.react ? ' (react)' : ''}${e.echo ? ' (echo)' : ''}  ${hp} · shield ${names[0]} ${e.s.sh[0]} · ${names[1]} ${e.s.sh[1]}`);
    else if (e.type === 'damage' && e.src === 'ult') lines.push(`  ${t}   ${names[e.side]} ${v(e.side, 'take', 'takes')} ${e.amount} from the ultimate  ${hp}`);
    else if (e.type === 'status' && e.status === 'evade') lines.push(`  ${t}   ${names[e.side]} ${v(e.side, 'DODGE', 'DODGES')} a hit (${e.value} dodge left)`);
    else if (e.type === 'status' && e.status === 'sure') lines.push(`  ${t}   ${names[e.side]} can't dodge: an undodgeable 👁 hit`);
    else if (e.type === 'status' && e.status === 'cleanse' && e.value > 0) lines.push(`  ${t}   ${names[e.side]} ${v(e.side, 'cleanse', 'cleanses')} ${e.value} debuff(s)`);
    else if (e.type === 'status' && e.status === 'shake') lines.push(`  ${t}   ${names[e.side]} ${v(e.side, 'shake', 'shakes')} off freeze/slow (no skill for 4s)`);
    else if (e.type === 'status' && e.status === 'freeze') lines.push(`  ${t}   ${names[e.side]} ${e.value > 0 ? `${v(e.side, 'are', 'is')} frozen ${(e.value / 10).toFixed(1)}s` : v(e.side, 'resist a freeze', 'resists a freeze')}`);
    else if (e.type === 'status' && e.status === 'rage') lines.push(`  ${t}   ${names[e.side]} RAGE (+${e.value} power)`);
    else if (e.type === 'fatigue') lines.push(`  ${t}   fatigue: both lose ${e.amount}`);
  }
  return lines;
}

const s = save.s;
switch (cmd) {
  case 'new': {
    save.seed = Number(args[0] ?? Date.now() % 1e9);
    save.tier = (args[1] as CliTier) ?? 'auto';
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
    p(`All ${HEROES.length} heroes (each run offers only ${R.HERO_CHOICES} of them: see \`new\`):`);
    for (const h of HEROES) p(` - ${h.id}: ${h.name} (line ${heroLine(h.id)}) — ${h.style}\n     passive: ${h.passive}`);
    break;
  case 'pick': {
    if (!save.choices?.includes(args[0])) fail(`this run offers only ${R.HERO_CHOICES} heroes: ${save.choices?.join(', ')} (\`heroes\` lists all of them, but a run starts with one of its ${R.HERO_CHOICES})`);
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
    } else if (cmd === 'buy') {
      err = R.buy(st, n(args[0]));
      if (!err) p(`bought shop card ${n(args[0])} (the other cards keep their indexes)`);
    }
    else if (cmd === 'sell') R.sell(st, n(args[0]));
    else if (cmd === 'move') R.moveSkill(st, n(args[0]), args[1] === 'up' ? -1 : 1);
    else if (cmd === 'reroll') err = R.reroll(st);
    else if (cmd === 'lock') err = R.toggleLock(st, n(args[0]));
    else if (cmd === 'slot') err = R.buySlot(st);
    else if (cmd === 'wish') {
      const w = R.wish(st);
      if ('err' in w) err = w.err;
      else if (w.v !== undefined) p(`wish: ${nodeOf({ id: st.skills[w.idx].id, v: w.from }).name} Lv${lv(w.from)} → ${nodeOf(st.skills[w.idx]).name} Lv${lv(w.v)} (${upgradeDiffText(nodeOf({ id: st.skills[w.idx].id, v: w.from }), nodeOf(st.skills[w.idx]), false)})`);
      else p(`wish: ${nodeOf(st.skills[w.idx]).name} got the mark${markText(w.mark)}`);
    } else if (cmd === 'chance') R.chooseLastChance(st, args[0] as R.LastChanceOption);
    else if (cmd === 'mark') R.applyMark(st, n(args[0]));
    else if (cmd === 'fight') {
      if (st.phase !== 'shop') fail('not in the shop');
      const me = R.toBuild(st);
      const opp = oppFor(st);
      // like the server: the fight seed is rolled only now, after the build is locked
      const r = simulate(me, opp, randomInt(0, 2 ** 31), st.day);
      const ex = explain(r, [me, opp], 0, ['You', 'Enemy'], { drawIsLoss: true });
      const won = r.winner === 0;
      p(`### Fight day ${st.day}: ${won ? 'WIN' : 'LOSS'} in ${(r.ticks / 10).toFixed(1)}s — ${ex.headline}`);
      describeBuild(opp, 'Opponent');
      ex.facts.forEach((f) => p(' fact: ' + f));
      ex.reasons.forEach((f) => p(' why: ' + f));
      ex.moments.forEach((m) => p(` moment: ${m.title} — ${m.text}`));
      p(' timeline (casts + special events ★):');
      fightSummary(r.events, ['You', 'Enemy'], [me, opp]).slice(0, 140).forEach((l) => p(l));
      save.history.push(`D${st.day} ${won ? 'W' : 'L'} vs ${opp.hero} ${(r.ticks / 10).toFixed(1)}s`);
      R.recordResult(st, won, { opp: 'bot', ai: true }, r.winner === -1);
    } else fail('unknown command ' + cmd);
    if (err) p('✘ ' + err);
    if (st.phase === 'shop' || cmd !== 'fight' || true) show(st);
  }
}
writeFileSync(file, JSON.stringify(save));
console.log(out.join('\n'));
