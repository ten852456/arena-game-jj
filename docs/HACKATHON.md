# Hackathon: Colosseum Eternal

Notes from research on 18 Nov 2026. Sources at the bottom.

**Project name: Mochi Moon** (decided 19 Nov 2026). Art style: the mochi chibi critters from the layered template (mix-and-match parts, recolour by palette).

## Game design and pitch (JaJoJi, 18 Nov 2026)

Full documents: [onchain game design](hackathon/onchain-game-design.pdf) (14 pages) and [pitch deck](hackathon/pitch.pdf) (16 slides).

**Pitch:** "Forge a build in ranked PvP, seal it onchain, and earn every time it carries someone else through a raid or the tower."
A fully onchain GameFi auto-battler on Solana with MagicBlock Ephemeral Rollups (every shop roll and fight onchain, no gas, session keys, VRF seeds).

**Direction (owner, 20 Nov 2026):** GameFi on the blockchain first. Real-money (USDC) flows are the plan; legal is not a blocker for design work.

The loop:
1. **Ranked Arena** (the game today, made ranked + onchain): pick 1 of 3 heroes, shop/fight days, season rank (Bronze → Legend). Doc draft: 8 wins / 20 HP (the live list build uses 10 wins).
2. **Seal** a run with ≥3 wins: $1 USDC → a **Build Card** (hero, skills, variants, marks, record, author wallet; links to the run's onchain history; non-transferable in v1). Seal fee: 70% season pool, 30% treasury.
3. **Save slots**: 3 free, 20 with the Premium Pass ($4.99/month; room and cosmetics, never power).
4. **Build Library**: anyone borrows a sealed build for one raid attack or one tower climb. Protocol-set use fee by tier ($0.05 for 3–5 wins, $0.10 for 6–7, $0.25 full clear, ×2 for top-100 authors). Split 70% author / 20% raid+tower pools / 10% treasury. Anti-abuse: wash renting loses 30%, no re-sealing borrowed builds, rate limits, a build only in content at least as hard as its forge day, weekly payouts above a threshold.
5. **Raid Boss** (weekly): shared HP, parties of 3 builds fight one after another, weekly rule twists, phases at 75/50/25%. 3 free attacks a day, then Raid Tickets.
6. **Endless Tower**: party of 3 in relay, HP carries between floors (rest every 5), +6% per floor, mini-boss every 10, floors built from real ranked builds. 1 free climb a day, then Tower Keys.
7. **Season prizes** (USDC, top 100 of Raid and Tower, funded only by fees): 15 / 10 / 7%, 3% each for 4–10, 0.6% for 11–50, 0.46% for 51–100; paid 7 days after the season after a bot check.
8. **Farm + ticket market**: idle heroes on town landmarks (lumber, mine, shrine, ~8 h timers) → resources (account-bound) → craft Raid Tickets / Tower Keys (onchain tokens, 4 a day cap, expire each season) → sell for USDC (5% fee; sellers need Silver rank and a 7-day-old account).

**4-week sprint:** W1 runs on an Ephemeral Rollup + session keys + VRF; W2 ranked matchmaking + Build Cards; W3 Build Library with paid use + Endless Tower 1–30; W4 public playtest + pitch. Before the sprint: port the combat sim to Rust and prove it matches TypeScript on thousands of fights; measure a fight's compute cost. After: Raid Boss, Farm, ticket market, Solana Mobile, mainnet.

**Open team decisions (from the doc):** seal price and fee splits; Build Cards tradable later?; pass price and slot counts; ticket rules; prize split; tower relay (one after another vs all 3 at once); list or grid goes onchain; sprint start date (late Jan–Feb 2027).

## Goal

Enter **Colosseum Eternal**, Colosseum's perpetual hackathon (https://colosseum.com/eternal), with this game.

| | |
|---|---|
| Format | We start a **4-week sprint** whenever we are ready (window open Nov–Mar) |
| Deadline to start | **Sat 20 Mar 2027, 23:59 PDT** (Sun 21 Mar 13:59 Thai time). A sprint started in time may finish after the window closes |
| Weekly | 1-minute video update: what we prioritised, shipped, found hard (missing ones hurt the evaluation) |
| Final | Pitch video, technical demo, GitHub repo, team background, business context |
| Results | Reply within 14 days; Eternal Award winners picked in **May** |
| Prizes | **Eternal Award $25k USDC** (any chain; "step-function increase in onchain adoption"). **Accelerator $250k pre-seed**, 12 weeks (2 in San Francisco), **Solana only** |
| Competition | 112 Eternal submissions in H1 2026 (vs 2,857 at Frontier) |

**Judging:** founder–market fit, insight into a problem or trend, product and execution (shipping speed, response to feedback),
market size, founder communication, a scalable business. In the repo they look for **significant work done during the sprint**,
by the team itself, good prioritisation, and a **meaningful onchain integration**.

**Pre-existing work:** allowed but must be disclosed. Tag the repo before the sprint starts (e.g. `pre-sprint`) so the
sprint's work is easy to show. A product from an earlier Colosseum event may only come back with a material change.

**Decided so far:** target Eternal; chain = Solana (needed for the accelerator) unless we decide otherwise.

**Open decisions:** money model (needs Thai legal advice), how big the AI-agent angle is, Solana Mobile (Seeker) as the main
channel, team and founder story, sprint start date (suggested late Jan – Feb 2027).

## What we learn from past winners

### Grand champions (none are games)

| Event | Winner | What it is | Lesson |
|---|---|---|---|
| Frontier 2026 | CrowdBrain | Robotics DePIN: train people in simulation, send the best to teleoperate real robots | A real pilot before judging; new category on a hot trend |
| Cypherpunk 2025 | Unruggable | Solana-only hardware wallet + app | Founder entered **4 times** over 2.5 years; real hardware; deep founder–market fit |
| Breakout 2025 | TapeDrive | Onchain data storage | Infra the whole ecosystem needs |
| Radar 2024 | Reflect | Stablecoin / yield protocol | Sits on the money flow |
| Renaissance 2024 | Ore | Proof-of-work mining token | A new mechanic that went viral |

### Game winners

| Project | Result | Core idea | Where the money comes from |
|---|---|---|---|
| Supersize | Radar gaming #1 | Agar.io-style blobs, fully onchain in real time (MagicBlock); buy in with any token | Buy-in wagering |
| The Arena | Radar gaming #2 | PvP social trading game | Trading as a contest |
| Windfall | Radar gaming #3 | Luck games built on staked SOL | Staking yield funds rewards |
| Crypto Fantasy League | Breakout gaming #1 → accelerator | Fantasy league with tokens instead of players, scored on live prices | Token prices are the game; tournaments |
| The Syndicate | Frontier top 25 → Cohort 5 | Idle mafia strategy, weekly seasons and leagues; **email / Telegram login** | Packs + pass for cash; pack revenue funds open prize pools |
| One Arena | Frontier top 25 → Cohort 5 | TCG battles with graded physical cards as onchain assets; founder ex-Shadowverse | Collectibles; **6,800+ downloads on Solana Seeker**, $50k cup |
| WeLikeSports | Frontier top 25 → Cohort 5 | Fantasy pools (survivor, brackets, pick'em) | No house rake: interest on pooled money |

### Patterns

1. **Crypto is the core loop, not an add-on.** No winner is "a good game that happens to be onchain".
2. **Easy onboarding:** email / social login, mobile first.
3. **Real users before judging** (downloads, tournaments, mainnet).
4. **Founder–market fit** is visible (card-game pros build card games, traders build trading games).
5. **Ride the current trend:** 2026 = TCG/collectibles, AI agents, prediction markets, Solana Mobile; 2024 = real-time onchain games.
6. **Games are judged as businesses**, not on game design.

### Money models by legal risk (we are in Thailand: get legal advice first)

| Model | Example | Risk | Fits our vision |
|---|---|---|---|
| Buy-in wagering, winner takes the pot | Supersize, Scrim | High (gambling) | No (principle 4) |
| Gacha / loot packs | The Syndicate | Medium–high | No |
| Season pass → transparent onchain prize pool | close to The Syndicate | Medium | Yes (the vision already has a pass) |
| Yield / interest funds prizes, deposits never at risk | WeLikeSports, Windfall | Medium | Good, and stands out |
| No money: leaderboard + cosmetics | — | Low | Yes, but judges may find it weak |

## Where we stand

**Strengths:** deterministic simulation (anyone can re-run a fight → provably fair PvP without a randomness service);
async PvP (cheap onchain); bots that fight for you (vision Phase 4, an angle no game winner has used yet); short sessions,
mobile-friendly.

**Gaps:** no money mechanic ("why crypto?"), no users, founder story not written.

**Candidate pitch:** *a provably fair auto-battler where your strategy, written by you or an AI, fights 24/7.*
Build and fight results committed to Solana, anyone can verify a fight, strategies have onchain records credited to their
owner, season prize pool shown onchain (no player stakes), email login with an embedded wallet, Solana Mobile as a channel.

**Before the sprint:** make the core combat easy to start and fun to repeat (next step); pick the money model; build a
waitlist and playtesters; write the founder story; practise the English pitch; tag the pre-sprint code.

**Tool to try:** Colosseum Copilot (agent tool with project data from every Colosseum hackathon):
https://docs.colosseum.com/copilot

## Onchain plan (decided 19 Nov 2026)

**Order:** finish balance and game features first. Then move the game **100% onchain with MagicBlock**:
run state and fights in an Ephemeral Rollup, session keys (no wallet popup per action), MagicBlock VRF for shop
rolls, fight seeds and matchmaking, results and builds committed to Solana.

**Technical approach:**
- Write the sim **once in Rust**: compile it to a Solana program for the chain and to WebAssembly for the browser
  replay, so the two can never disagree. Integer / fixed-point maths only (also removes the `Math.pow` risk).
- **Spike first (1 week):** combat core + 4 skills in Rust, one full fight inside an Ephemeral Rollup. Measure compute
  units and speed, and check WASM matches the TS sim tick for tick. Fall back to "fights offchain, hashes onchain +
  verify button" if it does not fit.
- List version is far simpler onchain than the grid (short array vs shape/placement checks). Keep launch content small.
- Graphics, town UI and analytics stay in the client; the client only shows what the chain says.

## Onchain feature ideas (beyond running the game onchain)

Judges want crypto to be essential, not a storage layer. Ideas, each checked against the 10 principles:

| # | Idea | What it is | Why it is onchain-native | Risk / principle |
|---|---|---|---|---|
| 1 | **Challenge Blinks** ⭐ | Share a build or replay as a Solana Blink on X / Telegram: "beat my build" plays the fight right in the post | Solana-only growth loop; every share is a playable ad | Low |
| 2 | **Agent Arena** ⭐ | Bot strategies are onchain assets (Metaplex Core) with a win/loss record written only by the program; anyone, including outside AI agents, can submit a strategy through an open program interface and it fights 24/7 | Provable records, open to agents (2026 trend), composable | Strategies are not run loot, so principle 5 holds; label AI opponents |
| 3 | **Legend builds** ⭐ | An 8-win build is minted as a soulbound trophy and joins a permanent onchain boss pool for later seasons; its owner is credited every time it beats someone | Your build lives forever onchain and keeps earning reputation | Low |
| 4 | **Transparent season pool** | Pass sales / sponsors fund a prize account; payout rules and winners are public onchain; no player stakes | Anyone can audit the prizes | ⚠ Thai legal review first; principle 4 (the game never pays out from player money) |
| 5 | **Ruler's decree by VRF** | The daily rule is drawn onchain by VRF (or voted by season-pass holders) and nobody, including the team, can pick it in advance | Fair, visible randomness | Low |
| 6 | **Strategy licensing** | Owners can let others use their bot strategy; a fee share goes to the creator through a marketplace with fees | Creator economy for strategies | Ties to the marketplace decision (Phase 7) |
| 7 | **Proof-of-play profile** | Soulbound achievements and season ranks: a portable reputation other apps can read | Composable identity | Low |
| 8 | **Onchain referrals** | Joining through someone's bot or Blink link is recorded; the referrer earns cosmetics | Fair, visible attribution | Low |
| 9 | **Cosmetic skins as assets** | Skins (the layered chibi recolours) as tradable items with creator royalties; never combat power | Ownership and trading | Principle 1 (no combat numbers for money) |
| 10 | **Seeker perks** | Seeker Genesis Token holders get a season cosmetic or early access | Solana Mobile channel | Low |

Spectator prediction markets (betting on bot-vs-bot fights) are left out: high gambling risk in Thailand.

**Suggested hackathon core:** 1 + 2 + 3 (Blinks for growth, Agent Arena as the story, Legend builds for retention),
with 4 only after legal advice.

## Sources

- https://colosseum.com/eternal · https://colosseum.com/hackathon · https://colosseum.com/worldsfair
- https://blog.colosseum.com/announcing-the-winners-of-the-solana-frontier-hackathon/
- https://blog.colosseum.com/announcing-the-winners-of-the-solana-cypherpunk-hackathon/
- https://blog.colosseum.com/announcing-colosseums-accelerator-cohort-5/
- https://solana.com/news/solana-radar-winners · https://blockworks.com/news/solana-data-startup-wins-hackathon
- https://solanacompass.com/projects/unruggable · https://solanacompass.com/projects/supersize
- https://egamers.io/games/crypto-fantasy-league/ · https://docs.thesyndicate.games/
- https://genfinity.io/2026/10/15/rosentica-natsuki-one-arena-solana-rwa-collectibles-application-layer-interview/
- https://egamers.io/?p=120255
