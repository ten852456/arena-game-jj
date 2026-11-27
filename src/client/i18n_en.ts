/**
 * English text for game data (the Thai text lives in the data files themselves).
 * client/lang.ts swaps these into the data objects when the player picks English.
 * Skill names are the same as the grid version (same Thai names); the rest is written for the list version.
 */

/** Skill tree names, per skill: variant ('_' = Lv1) → "Name" or "Name | branch style" (Lv2). */
export const SKILLS_EN: Record<string, Record<string, string>> = {
  strike: { _: 'Slash', a: 'Heavy Slash | Heavy hits', a1: 'Piercing Slash', a2: 'Finishing Slash', b: 'Twin Slash | Many hits', b1: 'Storm Slash', b2: 'Draining Slash' },
  jab: { _: 'Quick Jab', a: 'Swift Jab | Speed', a1: 'Lightning Jab', a2: 'Venom Jab', b: 'Vital Jab | Hits unshielded foes', b1: 'Piercing Jab', b2: 'Binding Jab' },
  heavy: { _: 'Heavy Smash', a: 'Breaker Hammer | Breaks shields', a1: 'Doom Hammer', a2: 'Quake Hammer', b: 'Stun Smash | Hit and control', b1: 'Dragging Smash', b2: 'Double Smash' },
  charge: { _: 'Charge Up', a: 'Big Charge | One huge hit', a1: 'All In', a2: 'Boiling Power', b: 'Quick Charge | Use often', b1: 'Follow-up', b2: 'Double Beat' },
  shield: { _: 'Raise Shield', a: 'Shield Fort | Wall', a1: 'Iron Wall', a2: 'Thorn Shield', b: 'Counter Shield | Shield as damage', b1: 'Shield Bash', b2: 'Healing Shield' },
  thorns: { _: 'Thorn Armor', a: 'Sharp Thorns | Strong reflect', a1: 'Poison Thorns', a2: 'Hindering Thorns', b: 'Lasting Thorns | Permanent stacks', b1: 'Thicket', b2: 'Armored Thorns' },
  stoneskin: { _: 'Stoneskin', a: 'Mending Stone | Healing', a1: 'Lifestone', a2: 'Pure Stone', b: 'Hard Stone | Armor', b1: 'Cliffside', b2: 'Stone Burst' },
  cleanse: { _: 'Cleanse', a: 'Purify | Stops burn and control', a1: 'Full Cleanse', a2: 'Cleanse & Harden', b: 'Cleanse & Counter | Punish debuffs', b1: 'Deadly Cleanse', b2: 'Thorn Cleanse' },
  train: { _: 'Train', a: 'Hard Training | Big power gains', a1: 'Extreme Training', a2: 'Combat Training', b: 'Quick Training | Frequent power', b1: 'Endless Training', b2: 'Sparring' },
  ignite: { _: 'Ignite', a: 'Blaze | Strong burn', a1: 'Hellfire', a2: 'Wildfire', b: 'Long Burn | Lasting burn', b1: 'Undying Flame', b2: 'Cold Fire' },
  feast: { _: 'Feast', a: 'Full Belly | Survive', a1: 'Banquet', a2: 'Hearty Meal', b: 'Growth Feast | Grow fast', b1: 'Endless Feast', b2: 'Blood Feast' },
  amplify: { _: 'Amplify', a: 'Big Amplify | Late burst', a1: 'Multiply', a2: 'Amplify Charge', b: 'Quick Amplify | Steady', b1: 'Rapid Amplify', b2: 'Amplify & Grow' },
  frost: { _: 'Frost Ball', a: 'Deep Freeze | Lock the foe', a1: 'Ice Age', a2: 'Shiver', b: 'Sharp Ice | Damage', b1: 'Ice Spear', b2: 'Hailstorm' },
  chill: { _: 'Cold Wind', a: 'Blizzard | Very slow', a1: 'Freezing Wind', a2: 'Knife Gale', b: 'Long Chill | Long slow', b1: 'Eternal Cold', b2: 'Hot-Cold Wind' },
  dispel: { _: 'Dispel', a: 'Big Dispel | Clear buffs', a1: 'Total Dispel', a2: 'Shield Break', b: 'Dispel Strike | Punish buffs', b1: 'Deadly Dispel', b2: 'Steal Power' },
  ironwill: { _: 'Iron Will', a: 'Steel | Resist control', a1: 'Immune', a2: 'Pure Steel', b: 'Fighting Spirit | Keep fighting', b1: 'Burning Heart', b2: 'Brave Heart' },
  gear: { _: 'Gear', a: 'Heavy Gear | Stronger', a1: 'Iron Gear', a2: 'Shield Gear', b: 'Swift Gear | More often', b1: 'Storm Gear', b2: 'Twin Gear' },
  overclock: { _: 'Overclock', a: 'Hard Boost | Stronger', a1: 'Max Boost', a2: 'Boost & Guard', b: 'Quick Boost | More often', b1: 'Rapid Boost', b2: 'Steady Boost' },
  bulwark: { _: 'Shield Slam', a: 'Clash | Shield as damage', a1: 'Shield Breaker', a2: 'Shield Quake', b: 'Clash & Guard | Shield loop', b1: 'Full Guard', b2: 'Mending Clash' },
  spikewall: { _: 'Spike Fort', a: 'Thorn Burst | Thorns into damage', a1: 'Thorn Spray', a2: 'Thorn Ring', b: 'Plant Thorns | Stack thorns', b1: 'Thorn Garden', b2: 'Healing Thorns' },
  execute: { _: 'Finisher', a: 'Execute | Close the game', a1: 'Executioner', a2: 'Piercing Execute', b: 'Quick Cut | Use often', b1: 'Swift Cut', b2: 'Draining Cut' },
  flurry: { _: 'Sword Flurry', a: 'Sharp Flurry | More hits', a1: 'Thousand Blades', a2: 'Flame Blade', b: 'Heavy Blade | Fewer, harder hits', b1: 'Breaker Blade', b2: 'Dragging Blade' },
  rampage: { _: 'Rampage', a: 'Frenzy | Many hits', a1: 'Berserk', a2: 'Growing Rage', b: 'Heavy Rage | Hard hits', b1: 'Crushing Rage', b2: 'Blood Rage' },
  inferno: { _: 'Inferno', a: 'Big Blast | Detonate stored burn', a1: 'Cataclysm', a2: 'Spreading Blast', b: 'Kindle | Stack burn', b1: 'Lava Blast', b2: 'Smoke Blast' },
  shatter: { _: 'Shatter', a: 'Crack | Freeze combo', a1: 'Smash to Bits', a2: 'Shatter & Freeze', b: 'Straight Smash | No combo needed', b1: 'Piercing Smash', b2: 'Cold Smash' },
  timewarp: { _: 'Time Warp', a: 'Rewind | Lock time', a1: 'Time Stop', a2: 'Rewind & Slow', b: 'Sharp Time | Damage', b1: 'Time Cut', b2: 'Frozen Time' },
};

export const KEYWORDS_EN: Record<string, { name: string; desc: string }> = {
  hit: { name: 'Hit', desc: 'Deal damage to the enemy (+ stacked power) · ×N = hit N times' },
  pierce: { name: 'Pierce', desc: 'Ignores the enemy shield (🗡50% = ignores half)' },
  shield: { name: 'Shield', desc: 'Takes damage before your HP and stays until it breaks' },
  heal: { name: 'Heal', desc: 'Restore your own HP' },
  leech: { name: 'Leech', desc: 'Heal a share of the damage you deal' },
  burn: { name: 'Burn', desc: 'Enemy loses X HP per second for N seconds · ignores shields · stacks' },
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
  steadfast: {
    name: 'Iron Will',
    desc: 'Freeze, slow and delay on you are 60% weaker until the fight ends · a skill with 🗿 fires right away when you are controlled (once per cooldown)',
  },
  cleanse: {
    name: 'Cleanse',
    desc: 'Remove debuffs on you: burn (strongest stack), slow, freeze · a skill with ✨ fires right away when you are controlled (once per cooldown)',
  },
  dispel: { name: 'Dispel', desc: 'Remove 1 of each enemy buff: power, thorns, charge, iron will, and 20% of their shield' },
  amplify: { name: 'Amplify', desc: 'Double the buffs you have now (power, thorns, charge), up to the cap' },
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

export const HEROES_EN: Record<string, { name: string; passive: string; style: string }> = {
  knight: {
    name: 'Knight',
    passive: 'Max HP +30%, and start the fight with a shield of 12% of your HP',
    style: 'Shield wall: stack a thick shield, then Shield Slam hits back harder the more shield you have',
  },
  thornguard: {
    name: 'Thornguard',
    passive: 'Max HP +20% · your thorns last 13s (normally 10) and Dispel removes only half a stack · start with 1 permanent thorn',
    style: 'It hurts to hit you: stack thorns so fast attackers hurt themselves, then finish with Spike Fort',
  },
  assassin: {
    name: 'Assassin',
    passive: 'Your first hit of each fight deals ×1.6',
    style: 'One-shot: charge up, unleash heavy hits and finish the enemy when their HP is low',
  },
  duelist: {
    name: 'Duelist',
    passive: 'Every 3rd hit you land deals 30% more (at least +1)',
    style: 'Nonstop hits: short-cooldown, multi-hit skills; the faster you hit, the more 3rd hits you get',
  },
  berserker: {
    name: 'Berserker',
    passive:
      'Max HP +10% · every 5 hits you take give +1 attack power · the first time your HP drops below half, gain +2 more (all hits of all skills until the fight ends)',
    style: 'Never stop growing: stack attack power bit by bit; the longer you fight and the more you are hit, the harder you hit',
  },
  pyro: {
    name: 'Pyromancer',
    passive: 'Burns you apply last 30% longer',
    style: 'Fire on fire: stack many burns, then Inferno blows up the burn that is left (ignores shields)',
  },
  witch: {
    name: 'Ice Witch',
    passive: 'Max HP +16% · freezes you apply last 0.3s longer',
    style: 'Stop time: freeze the enemy, then Shatter hits ×3 while they cannot move',
  },
  chrono: {
    name: 'Chronomancer',
    passive: 'Max HP +16% · your slows are +10% stronger and last 1s longer · hits on slowed or frozen enemies deal 10% more',
    style: 'Stall: slow the enemy and push their cooldowns back so their skills barely fire',
  },
};

export const ARCH_EN: Record<string, string> = { tank: 'Tank', burst: 'Burst', scaling: 'Scaling', control: 'Control', none: 'General' };

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
      'Heroes come in 4 styles: <b>Tank</b> (tough, hits back) · <b>Burst</b> (big hits) · <b>Scaling</b> (stronger over time) · <b>Control</b> (freeze, slow)',
      'Each run offers 3 heroes from different styles. Every hero has a <b>passive</b> and a <b>unique skill</b>',
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
