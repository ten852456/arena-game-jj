/**
 * English text for game data (the Thai text lives in the data files themselves).
 * client/lang.ts swaps these into the data objects when the player picks English.
 * Skill names follow the Thai names; hero numbers are read from tuning.ts so they never drift.
 */
import { ULT_LV2_POW, ultPow, ultTrig } from '../sim/heroes';
import { T } from '../sim/tuning';

/** Skill tree names, per skill: variant ('_' = Lv1) → "Name" or "Name | branch style" (Lv2). */
export const SKILLS_EN: Record<string, Record<string, string>> = {
  // ⚔ hit
  strike: { _: 'Slash', a: 'Heavy Slash | Heavy hits', a1: 'Piercing Slash', a2: 'Finishing Slash', b: 'Twin Slash | Many hits', b1: 'Storm Slash', b2: 'Draining Slash' },
  charge: { _: 'Charge Up', a: 'Big Charge | One huge hit', a1: 'All In', a2: 'Boiling Power', b: 'Quick Charge | Use often', b1: 'Follow-up', b2: 'Double Beat' },
  heavy: { _: 'Heavy Smash', a: 'Breaker Hammer | Breaks shields', a1: 'Doom Hammer', a2: 'Quake Hammer', b: 'Sure Smash | Never misses', b1: 'Unerring Smash', b2: 'Double Smash' },
  // 💨 dodge
  jab: { _: 'Dodge Jab', a: 'Swift Jab | Speed', a1: 'Lightning Jab', a2: 'Feint Jab', b: 'Vital Jab | Hits unshielded foes', b1: 'Piercing Jab', b2: 'Binding Jab' },
  riposte: { _: 'Riposte', a: 'Hard Riposte | Heavy counters', a1: 'Deadly Riposte', a2: 'Piercing Riposte', b: 'Riposte & Dodge | Dodge loop', b1: 'Blade Dance', b2: 'Draining Riposte' },
  sidestep: { _: 'Sidestep', a: 'Shake Off | Clear burn/poison', a1: 'Shake It All', a2: 'Shake & Mend', b: 'Mirage | Dodge a lot', b1: 'Shadow Form', b2: 'Shadow Counter' },
  // 🛡 shield
  shield: { _: 'Raise Shield', a: 'Shield Fort | Wall', a1: 'Iron Wall', a2: 'Steady Shield', b: 'Counter Shield | Shield as damage', b1: 'Shield Bash', b2: 'Healing Shield' },
  stoneskin: { _: 'Stoneskin', a: 'Hard Stone | Armor', a1: 'Cliffside', a2: 'Mending Stone', b: 'Stone Burst | Shield as damage', b1: 'Rockslide', b2: 'Piercing Stone' },
  cleanse: { _: 'Cleanse', a: 'Purify | Stops burn, poison and control', a1: 'Full Cleanse', a2: 'Cleanse & Harden', b: 'Cleanse & Counter | Punish debuffs', b1: 'Deadly Cleanse', b2: 'Cleanse & Guard' },
  // ❤ heal
  feast: { _: 'Feast', a: 'Full Belly | Survive', a1: 'Banquet', a2: 'Hearty Meal', b: 'Growth Feast | Grow fast', b1: 'Endless Feast', b2: 'Blood Feast' },
  train: { _: 'Train', a: 'Hard Training | Big power gains', a1: 'Extreme Training', a2: 'Combat Training', b: 'Quick Training | Frequent power', b1: 'Endless Training', b2: 'Sparring' },
  mend: { _: 'Mend', a: 'Quick Mend | Heal when controlled', a1: 'Endless Mend', a2: 'Pure Mend', b: 'Iron Blood | Guard big hits', b1: 'Iron Body', b2: 'Blood Counter' },
  // 🔥 burn
  ignite: { _: 'Ignite', a: 'Blaze | Strong burn', a1: 'Hellfire', a2: 'Wildfire', b: 'Long Burn | Lasting burn', b1: 'Undying Flame', b2: 'Cold Fire' },
  blaze: { _: 'Fireball', a: 'Fire Barrage | Detonate', a1: 'Doom Fire', a2: 'Piercing Fire', b: 'Twin Fireball | Stack burn', b1: 'Fire Rain', b2: 'Scald' },
  scorch: { _: 'Scorch', a: 'Searing Wound | Cut healing', a1: 'Cursed Fire', a2: 'Seeping Fire', b: 'Spreading Fire | Many small stacks', b1: 'Sea of Flames', b2: 'Wildfire Field' },
  // ☠ poison
  venom: { _: 'Venom Fang', a: 'Strong Venom | Heavy poison', a1: 'Deadly Venom', a2: 'Corroding Venom', b: 'Fang Flurry | Fast poison', b1: 'Poison Storm', b2: 'Draining Venom' },
  plague: { _: 'Poison Burst', a: 'Venom Blast | Burst the poison', a1: 'Great Plague', a2: 'Spreading Venom', b: 'Plague | Long poison', b1: 'Heavy Plague', b2: 'Heartbane' },
  thorns: { _: 'Venom Thorn Armor', a: 'Sharp Thorns | Strong reflect', a1: 'Deadly Thorns', a2: 'Hindering Thorns', b: 'Lasting Thorns | Permanent stacks', b1: 'Thicket', b2: 'Armored Thorns' },
  // ❄ ice
  frost: { _: 'Frost Ball', a: 'Deep Freeze | Lock the foe', a1: 'Glacial Grip', a2: 'Shiver', b: 'Sharp Ice | Damage', b1: 'Ice Spear', b2: 'Hailstorm' },
  icelance: { _: 'Ice Lance', a: 'Frigid Lance | Freeze combo', a1: 'Shattering Lance', a2: 'Freezing Lance', b: 'Quick Lance | Often', b1: 'Storm Lance', b2: 'Biting Lance' },
  glacier: { _: 'Glacier', a: 'Deep Glacier | A freeze that lands', a1: 'Eternal Glacier', a2: 'Shield-break Glacier', b: 'Sharp Glacier | Pierce', b1: 'Spiked Glacier', b2: 'Cracking Glacier' },
  // 🌪 wind
  chill: { _: 'Gust', a: 'Gale | Very slow', a1: 'Freezing Gale', a2: 'Knife Gale', b: 'Long Gust | Long slow', b1: 'Endless Wind', b2: 'Pushing Wind' },
  tailwind: { _: 'Tailwind', a: 'Whirlwind | Blow burn/poison away', a1: 'Cyclone', a2: 'Cleansing Wind', b: 'Acid Wind | Fast', b1: 'Wind Storm', b2: 'Cutting Wind' },
  dispel: { _: 'Dispel', a: 'Big Dispel | Clear buffs', a1: 'Total Dispel', a2: 'Shield Break', b: 'Dispel Strike | Punish buffs', b1: 'Deadly Dispel', b2: 'Steal Power' },
  // neutral
  ironwill: { _: 'Iron Will', a: 'Steel | Resist control', a1: 'Immune', a2: 'Pure Steel', b: 'Fighting Spirit | Keep fighting', b1: 'Burning Heart', b2: 'Brave Heart' },
  gear: { _: 'Gear', a: 'Heavy Gear | Stronger', a1: 'Iron Gear', a2: 'Shield Gear', b: 'Swift Gear | More often', b1: 'Storm Gear', b2: 'Twin Gear' },
  overclock: { _: 'Overclock', a: 'Hard Boost | Stronger', a1: 'Max Boost', a2: 'Boost & Guard', b: 'Quick Boost | More often', b1: 'Rapid Boost', b2: 'Steady Boost' },
  // hero uniques
  execute: { _: 'Finisher', a: 'Execute | Close the game', a1: 'Executioner', a2: 'Piercing Execute', b: 'Quick Cut | Use often', b1: 'Swift Cut', b2: 'Draining Cut' },
  flurry: { _: 'Sword Flurry', a: 'Sharp Flurry | More hits', a1: 'Thousand Blades', a2: 'Shadow Blades', b: 'Heavy Blade | Fewer, harder hits', b1: 'Breaker Blade', b2: 'Dragging Blade' },
  bulwark: { _: 'Shield Slam', a: 'Clash | Shield as damage', a1: 'Shield Breaker', a2: 'Shield Quake', b: 'Clash & Guard | Shield loop', b1: 'Full Guard', b2: 'Mending Clash' },
  rampage: { _: 'Rampage', a: 'Frenzy | Many hits', a1: 'Berserk', a2: 'Growing Rage', b: 'Heavy Rage | Hard hits', b1: 'Crushing Rage', b2: 'Blood Rage' },
  inferno: { _: 'Inferno', a: 'Big Blast | Detonate stored burn', a1: 'Cataclysm', a2: 'Spreading Blast', b: 'Kindle | Stack burn', b1: 'Lava Blast', b2: 'Smoke Blast' },
  spikewall: { _: 'Venom Spike Fort', a: 'Venom Thorn Burst | Poison into damage', a1: 'Venom Spike Spray', a2: 'Venom Thorn Ring', b: 'Plant Venom Thorns | Stack poison', b1: 'Venom Thorn Garden', b2: 'Healing Venom Thorns' },
  shatter: { _: 'Shatter', a: 'Crack | Freeze combo', a1: 'Smash to Bits', a2: 'Shatter & Freeze', b: 'Straight Smash | No combo needed', b1: 'Piercing Smash', b2: 'Cold Smash' },
  timewarp: { _: 'Back Wind', a: 'Strong Back Wind | Lock time', a1: 'Time-stop Wind', a2: 'Back Wind & Slow', b: 'Sharp Wind | Damage', b1: 'Slicing Wind', b2: 'Rushing Wind' },
};

export const KEYWORDS_EN: Record<string, { name: string; desc: string }> = {
  hit: { name: 'Hit', desc: 'Deal damage to the enemy (+ stacked power) · ×N = hit N times' },
  pierce: { name: 'Pierce', desc: 'Ignores the enemy shield (🗡50% = ignores half)' },
  shield: { name: 'Shield', desc: 'Takes damage before your HP and stays until it breaks' },
  heal: { name: 'Heal', desc: 'Restore your own HP' },
  leech: { name: 'Leech', desc: 'Heal a share of the damage you deal' },
  burn: { name: 'Burn', desc: `Enemy loses X HP per second for N seconds · ignores shields and burns shield away by the same amount each second, can’t be dodged · stacks · a burning fighter gains ${Math.round((1 - T['burn.shield']) * 100)}% less shield` },
  freeze: {
    name: 'Freeze',
    desc: "All the enemy's skills stop counting their cooldowns · weaker if repeated quickly · capped per fight · when a freeze ends, the enemy resists control for 1.5s",
  },
  slow: { name: 'Slow', desc: "All the enemy's cooldowns run X% slower · capped per fight" },
  delay: {
    name: 'Delay',
    desc: "Pushes all the enemy's cooldowns back N seconds · shares the cap with freeze · afterwards the enemy resists control for 1.5s",
  },
  grow: { name: 'Power', desc: 'Every hit of every skill deals +X damage until the fight ends' },
  charge: { name: 'Charge', desc: 'Your next hit (from any skill) is ×N stronger' },
  thorns: {
    name: 'Thorns',
    desc: 'Each time you are hit, reflect damage equal to your thorns (max 75% of the hit) · while you have thorns, the enemy heals only half',
  },
  dodge: {
    name: 'Dodge',
    desc: `Gain dodge charges (hold 1 · a dodge-line hero holds 2) · each one turns the next hit on you into a graze: only ${Math.round(T['dodge.graze'] * 100)}% lands and none of its riders (no randomness) · burn, poison, thorns and fatigue can’t be dodged · 👁 hits never miss · dodging the hit of a freeze/delay skill also stops that control`,
  },
  poison: {
    name: 'Poison',
    desc: `Enemy loses X HP per second for N seconds · ignores shields, can’t be dodged · stacks · weaker than burn but lasts longer · a poisoned fighter heals ${Math.round((1 - T['poison.heal']) * 100)}% less and gains ${Math.round((1 - T['burn.shield']) * 100)}% less shield`,
  },
  haste: { name: 'Haste', desc: 'All your cooldowns run X% faster for N seconds' },
  wound: { name: 'Wound', desc: 'The enemy heals X% less for N seconds' },
  sure: { name: 'Sure hit', desc: 'This hit can’t be dodged (it ignores the enemy’s dodge charges)' },
  steadfast: {
    name: 'Iron Will',
    desc: 'Freeze, slow and delay on you are 60% weaker until the fight ends · a skill with 🗿 fires right away when you are controlled (once per cooldown)',
  },
  cleanse: {
    name: 'Cleanse',
    desc: 'Remove debuffs on you: burn or poison (strongest stack), slow, freeze, wound · a skill with ✨ fires right away when you are controlled (once per cooldown) · ✨ 🔥☠ = only burn/poison',
  },
  dispel: { name: 'Dispel', desc: 'Remove 1 of each enemy buff: power, thorns, charge, iron will, and 20% of their shield' },
  exec: { name: 'Execute', desc: 'Stronger when the enemy is below the HP threshold' },
  shatter: { name: 'Shatter', desc: 'Stronger while the enemy is frozen' },
  gear: {
    name: 'Gear',
    desc: "Each time it works, fires the skill above or below it right away, taking turns, at the % power · that skill's own cooldown keeps running · at the edge of the list it fires its one neighbour more often",
  },
  overclock: {
    name: 'Overclock',
    desc: 'Fires the skills above and below it at once, right away, at the % power · then those two cooldowns restart (best next to long-cooldown skills)',
  },
  cd: { name: 'Cooldown', desc: 'How often it works, in seconds (all skills count at the same time)' },
};

const pc = (x: number) => Math.round(x * 100);
const r1 = (x: number) => +x.toFixed(1);
const hpPlus = (id: string) => {
  const m = T[`hp.${id}` as keyof typeof T];
  return m === 1 ? '' : `Max HP ${m > 1 ? '+' : '−'}${Math.abs(pc(m - 1))}% · `;
};
const both = (f: (lv: number) => string) => `${f(1)} · Lv2 ${f(2)}`;

export interface HeroEn {
  name: string;
  passive: string;
  style: string;
  ult: { name: string; trigger: string; effect: string };
}

/** Getters: numbers come from tuning.ts at the time the language is applied. */
export const HEROES_EN: Record<string, HeroEn> = {
  assassin: {
    name: 'Assassin',
    get passive() { return `${hpPlus('assassin')}Your first hit of each fight${T['assassin.every'] ? ` and every ${T['assassin.every']}th hit` : ''} deals ×${T['assassin.first']} · your landed hits cut enemy healing by ${pc(T['assassin.wound'])}% for 2s`; },
    style: 'One-shot: charge up, unleash heavy hits and finish the enemy when their HP is low',
    ult: {
      name: 'Moon Shadow',
      get trigger() { return both((lv) => `enemy HP below ${pc(ultTrig('assassin', lv))}%`); },
      get effect() { return both((lv) => `instant hit ×${r1(ultPow('assassin', lv))} your biggest hit this fight (max ${pc(T['ult.cap'] * (lv >= 2 ? ULT_LV2_POW : 1))}% of enemy HP), ignores shield; a dodge charge halves it`); },
    },
  },
  duelist: {
    name: 'Duelist',
    get passive() { return `${hpPlus('duelist')}Start with 1 dodge · hold up to ${T['dodge.cap'] + 1} dodges · after you dodge, shake off 1 poison stack and your next hit deals ×${T['duelist.counter']}`; },
    style: 'Dodge and counter: fast hits stack dodge charges so enemy hits miss, then counter harder the more dodges you hold',
    ult: {
      name: 'Blade Dance',
      get trigger() { return both((lv) => `${ultTrig('duelist', lv)} hits dodged`); },
      get effect() { return both((lv) => `all cooldowns ${pc(ultPow('duelist', lv))}% faster for 3s + 2 dodges`); },
    },
  },
  knight: {
    name: 'Knight',
    get passive() { return `Max HP +${pc(T['hp.knight'] - 1)}%, and start the fight with a shield of ${pc(T['knight.shield'])}% of your HP`; },
    style: 'Shield wall: stack a thick shield, then Shield Slam hits back harder the more shield you have',
    ult: {
      name: 'Moon Fortress',
      get trigger() { return both((lv) => `${pc(ultTrig('knight', lv))}% of max HP gained as shield (the start shield does not count)`); },
      get effect() { return both((lv) => `hit = your shield ×${r1(ultPow('knight', lv))} (max ${pc(T['ult.cap'] * (lv >= 2 ? ULT_LV2_POW : 1))}% of enemy HP), can’t be dodged (the shield stays)`); },
    },
  },
  berserker: {
    name: 'Berserker',
    get passive() {
      return `${hpPlus('berserker')}every ${T['berserker.hits']} hits you take give +1 attack power · the first time your HP drops below half, gain +2 more (all hits of all skills until the fight ends)`;
    },
    style: 'Drain without end: heal and leech to stay alive; the longer you fight and the more you are hit, the harder you hit',
    ult: {
      name: 'Undying',
      get trigger() { return both((lv) => `HP below ${pc(ultTrig('berserker', lv))}% or a killing blow`); },
      get effect() { return both((lv) => `don’t die (1 HP left on a killing blow), heal ${pc(ultPow('berserker', lv))}% of max HP + ${lv >= 2 ? 3 : 2} power`); },
    },
  },
  pyro: {
    name: 'Pyromancer',
    get passive() { return `${hpPlus('pyro')}Burns you apply last ${pc(T['pyro.burn'] - 1)}% longer`; },
    style: 'Fire on fire: stack many burns, then Inferno blows up the burn that is left (ignores shields)',
    ult: {
      name: 'Sunfall',
      get trigger() { return both((lv) => `${ultTrig('pyro', lv)} burn stacks on the enemy`); },
      get effect() { return both((lv) => `all burn still to come lands now ×${r1(ultPow('pyro', lv))} (ignores shields; those burns are used up)`); },
    },
  },
  thornguard: {
    name: 'Venom Thornguard',
    get passive() {
      return `${hpPlus('thornguard')}every 2nd hit you take poisons the attacker 1/s for ${T['thornguard.poison']}s · your thorns last 13s and Dispel removes only half a stack`;
    },
    style: 'Poison on poison: whoever hits you gets poisoned; stack long poison, then burst it (poison ignores shields and can’t be dodged)',
    ult: {
      name: 'Venom Thorns',
      get trigger() { return both((lv) => `${ultTrig('thornguard', lv)} hits taken`); },
      get effect() { return both((lv) => `${r1(ultPow('thornguard', lv))}s: every hit on you poisons the attacker 2 more stacks and they can’t heal`); },
    },
  },
  witch: {
    name: 'Ice Witch',
    get passive() { return `${hpPlus('witch')}freezes you apply last ${T['witch.freeze']}s longer${T['witch.wound'] ? ` · your hits on a frozen enemy cut its healing by ${pc(T['witch.wound'])}% for 3s` : ''}`; },
    style: 'Stop time: freeze the enemy, then Shatter hits ×3 while they cannot move',
    ult: {
      name: 'Ice Age',
      get trigger() { return both((lv) => `${ultTrig('witch', lv)} ice skill casts`); },
      get effect() { return both((lv) => `freeze ${r1(ultPow('witch', lv))}s (no repeat penalty, still under the cap) + next hit ×${lv >= 2 ? 2.4 : 2}`); },
    },
  },
  chrono: {
    name: 'Wind Mage',
    get passive() {
      return `${hpPlus('chrono')}your slows are +10% stronger and last 1s longer · hits on slowed or frozen enemies deal 10% more`;
    },
    style: 'Wind of time: slow the enemy, push their cooldowns back, speed yourself up and blow burn/poison away',
    ult: {
      name: 'Rewind Storm',
      get trigger() { return both((lv) => `${ultTrig('chrono', lv)} slows/delays landed`); },
      get effect() { return both((lv) => `all skills ready now + blow away every debuff + ${pc(ultPow('chrono', lv))}% faster for 3s`); },
    },
  },
};

export const LINE_EN: Record<string, string> = {
  hit: 'Hit', dodge: 'Dodge', shield: 'Shield', heal: 'Heal', burn: 'Burn', poison: 'Poison', ice: 'Ice', wind: 'Wind', none: 'General',
};
export const ROLE_EN: Record<string, string> = { core: 'Core', payoff: 'Payoff', tech: 'Counter' };

export const MARKS_EN: Record<string, { name: string; desc: string }> = {
  burn: { name: 'Scorch', desc: 'Each use burns the enemy 1/s for 3s' },
  echo: { name: 'Echo', desc: 'Works once more at 50% power' },
  quick: { name: 'Quickcast', desc: 'Cooldown −40%' },
  steadfast: { name: 'Unshaken', desc: 'Its cooldown keeps running even while you are frozen' },
};

export const BUILDINGS_EN: Record<string, { name: string; desc: string; future?: string }> = {
  mine: {
    name: 'Mine',
    desc: 'Heroes who are not fighting dig here for ore and rare crystals',
    future: 'Send idle heroes to mine resources for building the town, unlocking heroes and bot rounds',
  },
  lumber: {
    name: 'Lumber Yard',
    desc: 'Wood for building and growing the town',
    future: 'Idle heroes go out to cut wood, collecting it even while the game is closed',
  },
  tower: {
    name: 'Magic Tower',
    desc: "The town's mages research new things from the resources you gather",
    future: 'Research unlocks buildings and conveniences, never combat power',
  },
  hall: {
    name: 'Hero Hall',
    desc: 'Home of every hero you own. The same hero is equally strong for everyone · See your profile, stardust and run history here',
  },
  board: {
    name: 'Notice Board',
    desc: 'Leaderboard of mochi fighters, for the season and for today · Coming soon: daily decrees from the arena rulers',
    future: '20–30 rotating daily rules that change which heroes and builds shine that day',
  },
  market: {
    name: 'Market',
    desc: 'Trade tickets and items with other players',
    future: 'List items through the market, with fees and a history, and no direct transfers between accounts',
  },
  arena: { name: 'Arena', desc: 'The only way to earn rewards from the rulers: win 10 times before your HP runs out' },
};

/** Tutorial slides, same order as tutorialSlides.ts (the art stays as it is). */
export const SLIDES_EN: { title: string; body: string[] }[] = [
  {
    title: 'Welcome to the Arena',
    body: [
      'Pick a hero, buy skills day by day, then send your build to fight other players’ builds',
      'Goal: <b>win 10 times</b> before your <b>20 HP</b> runs out',
      'Each loss costs <b>2–5</b> HP depending on the day (days 1–3 cost 2, day 10 and later cost 5). The longer the run, the bigger the risk',
    ],
  },
  {
    title: 'Pick 1 of 3 heroes',
    body: [
      'Skills come in 8 lines: <b>⚔ Hit · 💨 Dodge · 🛡 Shield · ❤ Heal · 🔥 Burn · ☠ Poison · ❄ Ice · 🌪 Wind</b>. Each line beats 2 lines and loses to 2 (a small edge, not a lock), e.g. shields block hits, but burn and poison ignore shields',
      'Each hero has one main line · 3 pieces of it unlock the hero’s <b>★ Ultimate</b> (5 pieces = Lv2 · your first Lv3 skill of the line counts +1), which fires by itself once per fight · skills of your main line are also stronger (line mastery)',
      'See every hero in the <b>Hero Hall</b> in town',
    ],
  },
  {
    title: 'Day 1: your hero’s shop',
    body: [
      'On day 1 the shop sells 5 skills that suit your hero (the same every run), and you have <b>7</b> gold: enough for <b>2</b>',
      'From day 2 the shop offers 5 random skills every day; press <b>Reroll</b> (1 gold) · Found a good card but short on gold? Press <b>🔓 Lock</b> (free): the card stays through rerolls and comes back tomorrow',
      'Point at or tap a shop card, and the skills in your list that would switch on a 🔗 bonus with it light up',
      'You get gold every day, with a bonus for win streaks · Spare gold? Use the <b>🌙 Moon Wish</b>: it upgrades a random skill that is not Lv3 yet (once all are Lv3, it adds a random mark instead)',
    ],
  },
  {
    title: 'Skills work on their own, all at once',
    body: [
      'Every skill in your list counts its <b>cooldown at the same time</b> and works by itself when ready. You press nothing during a fight',
      'You start with <b>3 skill slots</b>, gain one every 3 days (up to 6), and can buy more in the shop up to 8',
      'Order matters: each skill has <b>🔗 connect bonuses</b>, like "next to Slash: +damage", which work when a matching skill sits in the <b>slot above or below</b>',
    ],
  },
  {
    title: 'Drag to reorder, then see who goes first',
    body: [
      '<b>Drag ⠿</b> on the left of a skill to move it up or down (works on phones too), or press ▲▼',
      'Under the list is a <b>timeline of the first 12 s</b>: each dot is when a skill really fires (run by the real fight engine), and <b>⚡</b> marks a skill fired by a bonus. It updates live while you drag',
      'For example, a 7 s shield always comes after a 6 s attack. Want the shield first? Look for a » bonus (shorter cooldown) or a ⚡ · When two are ready at the same moment, the upper one goes first',
    ],
  },
  {
    title: 'Read skills from their icons',
    body: [
      'Each skill shows as <b>icons + numbers</b>, e.g. ⚔5 = hit for 5 · 🛡6 = gain 6 shield · 🔥2 4s = the enemy burns for 2 per second for 4 s · ⏱6.0 = works every 6 s',
      '<b>Point at or tap</b> an icon to see what it means · point at a skill to see all its details',
    ],
  },
  {
    title: 'Upgrade along a tree',
    body: [
      'Every skill has its own tree: <b>Lv1 → pick 1 of 2 branches (Lv2) → each splits into 2 more (Lv3)</b>. Each branch plays differently, e.g. Slash → Heavy Slash (heavy hits) or Twin Slash (many hits)',
      'The shop offers <b>random</b> upgrade cards (dashed border) for skills you own. Some days you get the branch you want, some days not: plan around what you find',
      'Press <b>ⓘ</b> on a skill to see the whole tree: where you are, what comes next and which branches are closed',
    ],
  },
  {
    title: 'Fight other players’ builds',
    body: [
      'Press <b>Fight</b> to meet a build another player saved on the <b>same day</b> (if nobody has played yet, you meet an AI, and it is labelled)',
      'Watch the fight as a replay, change the speed or skip. After each fight you get a <b>summary of why you won or lost</b> and what to try next',
    ],
  },
  {
    title: 'Ready!',
    body: [
      'Running out of HP the first time is not the end: you get a <b>last chance</b> and come back with 1 HP and 1 special power',
      'Want to start over? Press <b>🏳 Give up</b> any time · Open this guide again with <b>? How to play</b> at the top',
      'Go to the <b>Arena</b> in town to start your first run. Have fun!',
    ],
  },
];

/** Error messages returned by sim/run.ts (Thai) → English. Unknown messages are shown as they are. */
export const RUN_ERRORS_EN: Record<string, string> = {
  'ช่อง skill เต็มแล้ว': 'All skill slots are full',
  'เงินไม่พอ': 'Not enough gold',
  'ไม่มีของ': 'Nothing to buy there',
  'ทุก skill เต็มขั้นและมีตราแล้ว': 'Every skill is max level and has a mark',
  'วันแรกเป็นร้านประจำฮีโร่ สุ่มใหม่ได้ตั้งแต่วันที่ 2': 'Day 1 is your hero’s shop: you can reroll from day 2',
  'มี skill นี้แล้ว': 'You already have this skill',
  'ช่อง skill เต็ม ขาย skill หรือซื้อช่องเพิ่มก่อน': 'Skill slots are full: sell a skill or buy a slot first',
  'อัปเกรดนี้ใช้กับ skill ที่มีอยู่ไม่ได้แล้ว': 'This upgrade no longer fits a skill you own',
};

/** Thai bits inside skill chips (sim/skills.ts chipsOf) → English, applied in this order. */
export const CHIP_EN: [string, string][] = [
  [' +กันแช่แข็ง 1 ครั้ง', ' +blocks 1 freeze'],
  [' (ถนัด: ทั้งหมด)', ' (line mastery: all)'],
  [' คูลดาวน์ไม่เริ่มใหม่', ' no cooldown reset'],
  ['↕ สลับบน/ล่าง', '↕ above/below in turn'],
  ['↕ บน+ล่าง', '↕ above+below'],
  [' ครั้งถัดไป', ' next hit'],
  [' ศัตรูฟื้น ', ' enemy heals '],
  [' (ถ้าช้า)', ' (if slowed)'],
  [' ขโมยพลัง', ' steals power'],
  ['ทั้งหมด', ' all'],
  ['ไร้โล่ ', 'no shield '],
  [' ครั้ง)', ' hits)'],
  ['/ครั้ง', '/hit'],
  ['/อย่าง', '/each'],
  [' ถาวร', ' permanent'],
  [' โล่', ' shield '],
];
