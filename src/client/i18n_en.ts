/**
 * English text for game data (the Thai text lives in the data files themselves).
 * client/lang.ts swaps these into the data objects when the player picks English.
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
  freeze: { name: 'Freeze', desc: "All the enemy's cooldowns stop · weaker if repeated quickly · capped per fight · after a freeze ends, the target resists control for 1.5s (Regroup)" },
  slow: { name: 'Slow', desc: "All the enemy's cooldowns run X% slower · capped per fight" },
  delay: { name: 'Delay', desc: "Pushes all the enemy's cooldowns back N seconds · shares the cap with freeze · then the target resists control for 1.5s (Regroup)" },
  grow: { name: 'Power', desc: 'Every hit of every skill deals +X damage until the fight ends' },
  charge: { name: 'Charge', desc: 'Your next hit (from any skill) is ×N stronger' },
  thorns: { name: 'Thorns', desc: 'Each time you are hit, reflect damage equal to your thorns (max 75% of the hit) · while you have thorns, the enemy heals only half' },
  steadfast: { name: 'Iron Will', desc: 'Freeze, slow and delay on you are 60% weaker until the fight ends · a block with 🗿 works right away when you get controlled (once per its cooldown)' },
  cleanse: { name: 'Cleanse', desc: 'Remove debuffs on you: burn (strongest stack), slow, freeze · a block with ✨ works right away when you get controlled (once per its cooldown)' },
  dispel: { name: 'Dispel', desc: "Remove 1 of each enemy buff: power, thorns, charge, iron will, and 20% of their shield" },
  amplify: { name: 'Amplify', desc: 'Double the buffs you have now (power, thorns, charge), up to the cap' },
  exec: { name: 'Execute', desc: 'Stronger when the enemy is below the HP threshold' },
  shatter: { name: 'Shatter', desc: 'Stronger while the enemy is frozen' },
  gear: { name: 'Gear', desc: 'Each time it works, fires 1 touching block right away (taking turns, skipping blocks that were just set off) at the % power · that block keeps its own cooldown · a block can be set off at most once per its own cooldown (3–6s)' },
  overclock: { name: 'Overclock', desc: 'Fires every touching block right away at the % power · then their cooldowns restart · a block can be set off at most once per its own cooldown (3–6s)' },
  cd: { name: 'Cooldown', desc: 'How often it works, in seconds (all skills count at the same time)' },
};

export const HEROES_EN: Record<string, { name: string; passive: string; style: string }> = {
  knight: {
    name: 'Knight',
    passive: 'Max HP +35%, and start the fight with a shield of 6% of your HP',
    style: 'Shield wall: stack a thick shield, then Shield Slam hits back harder the more shield you have',
  },
  thornguard: {
    name: 'Thornguard',
    passive: 'Max HP +18% · your thorns last 15s (normally 10) and Dispel removes only half a stack · start with 1 permanent thorn · while you have thorns, also reflect 8% of each hit you take',
    style: 'It hurts to hit you: stack thorns so fast attackers hurt themselves, then finish with Spike Fort',
  },
  assassin: {
    name: 'Assassin',
    passive: 'Your first hit of the fight deals ×1.3 · hits on enemies below half HP deal 10% more',
    style: 'One-shot: charge up, unleash a huge hit and finish the enemy when their HP is low',
  },
  duelist: {
    name: 'Duelist',
    passive: 'Every 3rd hit you land deals 40% more (at least +1)',
    style: 'Nonstop hits: short-cooldown, multi-hit skills; the faster you hit, the more 3rd hits you get',
  },
  berserker: {
    name: 'Berserker',
    passive: 'Start with +2 attack power · every 5 hits you take give +1 more · the first time your HP drops below half, gain +1 more (all hits of all skills until the fight ends)',
    style: 'Never stop growing: stack attack power bit by bit; the longer the fight and the more you get hit, the harder you hit',
  },
  pyro: {
    name: 'Pyromancer',
    passive: 'Burns you apply last 30% longer',
    style: 'Fire on fire: stack many burns, then Inferno blows up the burn that is left (ignores shields)',
  },
  witch: {
    name: 'Ice Witch',
    passive: 'Max HP +22% · freezes you apply last 0.3s longer',
    style: 'Stop time: freeze the enemy, then Shatter hits ×3 while they cannot move',
  },
  chrono: {
    name: 'Chronomancer',
    passive: 'Max HP +12% · your slows are 10% stronger · hits on slowed enemies deal 10% more',
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
    desc: 'Heroes who are not fighting dig here for ore and rare moon crystals',
    future: 'Send idle heroes to mine resources for building the town, unlocking heroes and bot rounds',
  },
  lumber: {
    name: 'Lumber Yard',
    desc: 'Bamboo and wood for building and growing the town',
    future: 'Idle heroes go out to cut bamboo, collecting it even while the game is closed',
  },
  tower: {
    name: 'Magic Tower',
    desc: "The town's mages research new things from the resources you gather",
    future: 'Research unlocks buildings and conveniences, never combat power',
  },
  hall: { name: 'Hero Hall', desc: 'Home of every hero you own. The same hero is equally strong for everyone' },
  board: {
    name: 'Notice Board',
    desc: 'Daily decrees from the arena rulers, which do not have to make sense',
    future: '20–30 rotating daily rules that change which heroes and builds shine that day',
  },
  market: {
    name: 'Market',
    desc: 'Trade tickets and items with other players',
    future: 'List items through the market, with fees and a history, and no direct transfers between accounts',
  },
  arena: { name: 'Arena', desc: 'The only way to earn rewards from the rulers: win 10 times before your HP runs out' },
};

/** Tutorial slides, same order as tutorialSlides.ts. */
export const SLIDES_EN: { title: string; body: string[] }[] = [
  {
    title: 'Welcome to Mochi Moon',
    body: [
      'Pick a hero, buy skills day by day, arrange them on your grid, then send your build to fight other players’ builds',
      'Goal: <b>win 10 times</b> before your <b>20 HP</b> runs out',
      'Each loss costs <b>2 HP</b> on days 1–3, 3 on days 4–6, 4 on days 7–9 and <b>5</b> from day 10. The longer the run, the bigger the risk',
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
    title: 'The skill shop',
    body: [
      'On day 1 the shop sells 5 skills that suit your hero (the same every run). You have <b>7</b> gold, enough for 2 · From day 2 the shop is random; press <b>Reroll</b> for 1 gold',
      'Skills have a <b>tree</b>: Lv1 → pick 1 of 2 branches (Lv2) → each splits into 2 more (Lv3) · The shop offers upgrade cards (dashed border); an upgrade keeps the block’s place and adds 1 new bonus · Press <b>ⓘ</b> to see the whole tree',
      'The shop also sells <b>more grid space</b> (+1 column or row)',
    ],
  },
  {
    title: 'Skills are blocks on a grid',
    body: [
      'Each skill is a <b>block with its own shape</b>. Drag it onto your grid (it starts at 5×3 and grows over the days)',
      '<b>Rotate</b>: right-click, press R or use the rotate button · Blocks not on the grid wait in your <b>bag</b> (6 slots) and do not fight',
      'Drag a block to the sell box to sell it · On mobile: tap a block, then tap an empty cell · Feeling lazy? Press <b>✨ Auto-arrange</b> to let the game find the spots with the most bonuses',
    ],
  },
  {
    title: 'Skills work on their own, all at once',
    body: [
      'Every block on the grid counts its <b>cooldown at the same time</b> and works by itself when ready. You press nothing during a fight',
      'In the replay you can see each block’s cooldown ring turning, and blocks flash when they work',
    ],
  },
  {
    title: 'Touching blocks = bonuses',
    body: [
      'Each block has 1–2 <b>connect bonuses</b>, like "touching Heavy Smash: damage +" or "touching a Control skill: ⚡ makes it work right away" (any side counts)',
      'Blocks with an active bonus <b>glow</b> · Hover a block to see what its bonus wants to touch (those blocks light up)',
      '<b>Chains ⚡</b>: A fires B fires C in a row. The longer the chain, the stronger',
    ],
  },
  {
    title: 'Engines',
    body: [
      '<b>Gear</b>: every so often, fires one touching block, taking turns',
      '<b>Overclock</b>: fires every touching block at once, then their cooldowns restart',
      'Put your strongest blocks around an engine so they work more often',
    ],
  },
  {
    title: 'Fight other players’ builds',
    body: [
      'Press <b>Fight</b> to meet a build another player saved on the <b>same day</b> (if nobody has played yet, you meet an AI, and it is labelled)',
      'After each fight you get a <b>summary of why you won or lost</b> · The first time your HP runs out you get a <b>last chance</b> and come back with 1 HP',
      'Want to start over? Press <b>🏳 Give up</b> · Open this guide again any time with <b>? How to play</b> at the top. Have fun!',
    ],
  },
];
