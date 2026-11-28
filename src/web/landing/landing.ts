// The public landing page (/). The game itself lives at /play.
// Numbers (heroes, skills, relics, wins) come from the game code, so this page can never quote stale figures.
// Roadmap items say whether they are built or planned (docs/FACTS.md rules).
import { setLangValue, type Lang } from '../../shared/i18n';
import { HEROES } from '../../sim/heroes';
import { SKILLS, nextVariants } from '../../sim/skills';
import { RELICS } from '../../sim/relics';
import { HERO_CHOICES, MARKS, MAX_SLOTS, START_HP, WIN_TARGET } from '../../sim/run';
import { LINES } from '../../sim/types';
import { MAIL_MAX, SEAL_D_WINS, SEAL_USES, STASH_MAX, TRAY_MAX } from '../../shared/vault';
import { VERSION } from '../app/releaseNotes';
import { openFeedback } from '../app/feedback';
import { track, visitorId } from '../app/track';
import './landing.css';
import { esc } from '../ui/html';

// old share links (/?replay=…, /?chain=1 …) belong to the game: send them there untouched
if (location.search) location.replace('/play' + location.search + location.hash);

const LANG_KEY = 'mochi.lang';
let lang: Lang = (() => {
  try {
    return localStorage.getItem(LANG_KEY) === 'th' ? 'th' : 'en';
  } catch {
    return 'en';
  }
})();
const t = (en: string, th: string) => (lang === 'th' ? th : en);

const IMG = '/assets/img/site/';
const LINKS = {
  youtube: 'https://www.youtube.com/@mochimoongame',
  week1: 'https://youtu.be/CUtJ5TXZFv8',
  x: 'https://x.com/tenny2201',
  telegram: 'https://t.me/ten852456',
};
const SHORT = { en: 'Xw72OiZNcM4', th: 'Mz-VDsYAC4U' };
const ICONS = {
  hero: '<svg viewBox="0 0 24 24"><circle cx="12" cy="9" r="4.2"/><path d="M4.5 20.5c1.2-4 4.2-6 7.5-6s6.3 2 7.5 6"/></svg>',
  skill: '<svg viewBox="0 0 24 24"><path d="M13 2.8 5.5 13.2h5.2L9.8 21.2l8.7-11.1h-5.4z"/></svg>',
  relic: '<svg viewBox="0 0 24 24"><path d="M12 2.8 19.5 7v10L12 21.2 4.5 17V7z"/><path d="M12 7.5v9M8 9.8l8 4.4M16 9.8l-8 4.4"/></svg>',
  crown: '<svg viewBox="0 0 24 24"><path d="M3.5 8.5 8 12l4-6.5 4 6.5 4.5-3.5-1.8 10H5.3z"/></svg>',
};

const nHeroes = HEROES.length;
const nSkills = Object.keys(SKILLS).length;
const nRelics = RELICS.length;
const nLines = LINES.length;
/** every version of every skill: Lv1, the Lv2 branches, the Lv3 branches (from the skill tree in the code) */
const nVariants = Object.keys(SKILLS).reduce((sum) => {
  const seen = new Set<string>();
  const q = [''];
  while (q.length) {
    const v = q.shift()!;
    if (seen.has(v)) continue;
    seen.add(v);
    q.push(...nextVariants(v));
  }
  return sum + seen.size;
}, 0);

/** every Seal a run can earn: line × grade × roll 1-10 × early/late (src/shared/vault.ts) */
const nSeals = nLines * Object.keys(SEAL_USES).length * 10 * 2;
/** live today, or planned (FACTS rule 4: never write a planned feature as if it ships today) */
const live = () => `<em class="tag live">${t('live', 'เล่นได้แล้ว')}</em>`;
const soon = () => `<em class="tag soon">${t('coming', 'กำลังมา')}</em>`;

type Item = [en: string, th: string];
const DONE: Item[] = [
  ['Playable core loop on web and phone, in Thai and English', 'เล่นได้ครบลูปบนเว็บและมือถือ ทั้งไทยและอังกฤษ'],
  ['Deterministic combat engine; the server re-checks every build', 'ระบบต่อสู้แบบ deterministic และเซิร์ฟเวอร์ตรวจทุกบิลด์ซ้ำ'],
  [`${nHeroes} heroes, ${nSkills} skills, ${nRelics} relics, balanced with thousands of simulated fights`, `ฮีโร่ ${nHeroes} ตัว สกิล ${nSkills} แบบ เรลิก ${nRelics} ชิ้น จูนสมดุลด้วยไฟต์จำลองหลายพันไฟต์`],
  ['The idle town: heroes work while you are away, buildings level up without a cap', 'เมือง idle: ฮีโร่ทำงานตอนคุณไม่อยู่ อาคารอัปเลเวลได้ไม่จำกัด'],
  ['Casual (free, unlimited) and Ranked (a ticket, 1 free every day)', 'โหมดทั่วไป (ฟรี ไม่จำกัด) และแรงค์ (ใช้ตั๋ว ได้ฟรีวันละ 1 ใบ)'],
  ['Onchain version on Solana devnet: the whole run in a MagicBlock private rollup, randomness from VRF, end-to-end test 19/19', 'เวอร์ชัน onchain บน Solana devnet: ทั้ง run อยู่ใน MagicBlock private rollup สุ่มด้วย VRF ทดสอบครบ 19/19'],
  [`Ranked offers ${HERO_CHOICES} of all ${nHeroes} heroes, drawn by the server: the same chance for everyone, no re-rolls`, `แรงค์สุ่มฮีโร่ ${HERO_CHOICES} ตัวจากทั้ง ${nHeroes} ตัว โดยเซิร์ฟเวอร์: ทุกคนมีโอกาสเท่ากัน สุ่มใหม่ไม่ได้`],
  ['Seals: a run with 3+ wins earns a Seal of its hero line; the Seal tray, the mailbox and 1 claim a day', 'ตรา: ชนะ 3+ ได้ตราของสายฮีโร่ ถาดตรา จดหมายตรา และรับได้วันละ 1 ใบ'],
  ['Hero Book: one kept build per hero, line rank per line, a run-end receipt', 'สมุดฮีโร่: เก็บ build ไว้ตัวละ 1 แบบ แรงค์ต่อสาย และหน้าสรุปหลังจบรอบ'],
];
const NOW: Item[] = [
  ['Public playtest of the Seal and Hero Book loop: you are here', 'เปิดทดสอบลูปตราและสมุดฮีโร่: คุณอยู่ตรงนี้แล้ว'],
  ['The Tower engine: a 3-hero relay, Seal effects, floors and modifiers', 'ระบบหอเวท: ทีม 3 ฮีโร่ผลัดกันสู้ ผลของตรา ชั้น และกติกาประจำชั้น'],
  ['Balance tuning from real runs; the onchain version on its own public server (devnet)', 'จูนสมดุลจากการเล่นจริง และเวอร์ชัน onchain บนเซิร์ฟเวอร์สาธารณะ (devnet)'],
];
const NEXT: Item[] = [
  ['The Tower: daily floor modifiers, a weekly Ruler, boss floors, Pure / Fair / Full boards', 'หอเวท: กติกาประจำชั้นสุ่มรายวัน ผู้ปกครองรายสัปดาห์ ชั้นบอส และกระดาน Pure / Fair / Full'],
  ['Moonstone from deep Tower floors, traded between players on the Moon Market', 'หินจันทร์จากชั้นลึกของหอเวท ซื้อขายกันระหว่างผู้เล่นใน Moon Market'],
  ['Ranked season prizes in USDC from the Moon Fund, settled by a Merkle root on Solana', 'รางวัลแรงค์ประจำ season เป็น USDC จาก Moon Fund ตรวจสอบได้ผ่าน Merkle root บน Solana'],
  ['Looks, status and a season pass from the house: never power', 'ของแต่งตัว สถานะ และ season pass จากเกม: ไม่ขายพลัง'],
];

/** The loop, one turn: each step feeds the next (built ones say live, planned ones coming) */
function loopHTML() {
  const node = (cls: string, ico: string, h: string, tag: string, p: string) =>
    `<article class="lp-node ${cls}"><span class="lp-ico" aria-hidden="true">${ico}</span><h3>${h} ${tag}</h3><p>${p}</p></article>`;
  const arrow = (cls: string, label: string) => `<span class="lp-arrow ${cls}" aria-hidden="true"><i></i><small>${label}</small></span>`;
  return `<div class="loop" role="list" aria-label="${t('The game loop', 'ลูปของเกม')}">
    ${node('n1', '⚔', t('Arena run', 'รอบในสนามประลอง'), live(), t(`Draft a build over a run: up to ${WIN_TARGET} wins before ${START_HP} HP run out. Casual is free; Ranked offers ${HERO_CHOICES} of all ${nHeroes} heroes, the same chance for everyone.`, `จัดบิลด์ตลอดรอบ: ชนะให้ถึง ${WIN_TARGET} ก่อนเลือด ${START_HP} หมด โหมดทั่วไปเล่นฟรี แรงค์สุ่ม ${HERO_CHOICES} จาก ${nHeroes} ฮีโร่ ทุกคนมีโอกาสเท่ากัน`))}
    ${arrow('a1', t('the run ends', 'จบรอบ'))}
    ${node('n2', '🧾', t('Run-end receipt', 'หน้าสรุปหลังจบรอบ'), live(), t(`Stardust, line rank for the hero line, a Seal of that line at ${SEAL_D_WINS}+ wins, and the run kept in the hero's Hero Book page.`, `ได้ผงดาว แรงค์ของสายฮีโร่ ตราของสายนั้นเมื่อชนะ ${SEAL_D_WINS}+ และเก็บรอบนี้ลงสมุดฮีโร่ของตัวนั้น`))}
    ${arrow('a2', t('spend it in town', 'ใช้ในเมือง'))}
    ${node('n3', '🏡', t('Town', 'เมือง'), live(), t(`Heroes work while you are away: wood, ore, crystal. Claim 1 Seal a day from a tray of ${TRAY_MAX} (more wait in the mailbox), equip it, adopt new heroes, craft Ranked tickets.`, `ฮีโร่ทำงานตอนคุณไม่อยู่: ไม้ แร่ คริสตัล รับตราได้วันละ 1 ใบจากถาด ${TRAY_MAX} ช่อง (ที่เหลือรอในจดหมาย) ใส่ตราให้ฮีโร่ รับฮีโร่ใหม่ ทำตั๋วแรงค์`))}
    ${arrow('a3', t('build a team', 'จัดทีม'))}
    ${node('n4', '🗼', t('Tower', 'หอเวท'), soon(), t('Three heroes from your Hero Book climb in relay. Seals fire on the hand-off, so the order is the combo. Each day the floors change their rules.', 'ฮีโร่ 3 ตัวจากสมุดฮีโร่ผลัดกันไต่หอ ตราทำงานตอนส่งไม้ต่อ ลำดับจึงเป็นคอมโบ และทุกวันแต่ละชั้นเปลี่ยนกติกา'))}
    ${arrow('a4', t('a lost floor names a hero', 'แพ้ชั้นไหน บอกว่าควรเล่นฮีโร่ตัวไหน'))}
    <div class="lp-core"><b>${t('Your account', 'บัญชีของคุณ')}</b><span>${t('heroes · Seals · Hero Book · town', 'ฮีโร่ · ตรา · สมุดฮีโร่ · เมือง')}</span><small>${t('Nothing from outside a run ever enters an Arena fight.', 'ของนอกรอบไม่เคยเข้าไปในไฟต์สนามประลอง')}</small></div>
  </div>`;
}

/** The same loop at five time scales */
function scalesHTML() {
  const col = (h: string, sub: string, rows: [string, boolean][]) =>
    `<article><h3>${h}</h3><p class="sc-sub">${sub}</p><ul>${rows.map(([r, on]) => `<li class="${on ? 'on' : 'off'}">${r}${on ? '' : ` ${soon()}`}</li>`).join('')}</ul></article>`;
  return `<div class="scales">
    ${col(t('A fight', 'ไฟต์'), t('seconds', 'ไม่กี่วินาที'), [
      [t('Your build vs a player’s saved build from the same day, matched by rating', 'บิลด์คุณสู้กับบิลด์ที่ผู้เล่นอื่นบันทึกไว้ในวันเดียวกัน จับคู่ตามเรตติ้ง'), true],
      [t('Same builds + seed = the same fight, every time', 'บิลด์และ seed เดิม ได้ไฟต์เดิมทุกครั้ง'), true],
    ])}
    ${col(t('A run', 'รอบ'), t('about 10 minutes', 'ราว 10 นาที'), [
      [t(`A shop each day, ${MAX_SLOTS} skill slots, links between neighbours`, `ร้านทุกวัน ช่องสกิล ${MAX_SLOTS} ช่อง โบนัสเชื่อมกับสกิลข้างๆ`), true],
      [t('Relic days 2, 4 and 6; marks; a last chance', 'วันเรลิก 2, 4, 6 ตรา และโอกาสสุดท้าย'), true],
    ])}
    ${col(t('A day', 'วัน'), t('a few sessions', 'เข้าเล่นไม่กี่ครั้ง'), [
      [t('Collect the town; Casual free, Ranked with a ticket (1 free)', 'เก็บของในเมือง เล่นทั่วไปฟรี แรงค์ใช้ตั๋ว (ฟรีวันละ 1)'), true],
      [t('Claim 1 Seal; line rank from your first 5 runs', 'รับตรา 1 ใบ และแรงค์สายจาก 5 รอบแรก'), true],
      [t('1 counted Tower climb on a fresh seed', 'ไต่หอเวทนับคะแนน 1 ครั้ง ด้วย seed ใหม่'), false],
    ])}
    ${col(t('A week', 'สัปดาห์'), t('Monday reset', 'รีเซ็ตทุกวันจันทร์'), [
      [t('A new Tower Ruler: a weak line and a resisted one', 'ผู้ปกครองหอเวทคนใหม่: แพ้ทางสายหนึ่ง ต้านอีกสายหนึ่ง'), false],
      [t('Moonstone from floors 20 and 25, at most 2 a week', 'หินจันทร์จากชั้น 20 และ 25 สูงสุด 2 ก้อนต่อสัปดาห์'), false],
    ])}
    ${col(t('A season', 'ซีซั่น'), t('6 weeks', '6 สัปดาห์'), [
      [t('The season monument: pour together, start the next season ahead', 'อนุสาวรีย์ประจำซีซั่น: เติมร่วมกัน ซีซั่นหน้าเริ่มได้เร็วกว่า'), true],
      [t('The Ranked board; heroes, line rank and town carry over', 'กระดานแรงค์ ฮีโร่ แรงค์สาย และเมืองติดตัวไปซีซั่นหน้า'), true],
      [t('Ranked prizes in USDC; the top Tower player becomes next season’s boss', 'รางวัลแรงค์เป็น USDC และอันดับ 1 ของหอเวทกลายเป็นบอสซีซั่นหน้า'), false],
    ])}
  </div>`;
}

function list(items: Item[]) {
  return `<ul>${items.map(([en, th]) => `<li>${esc(t(en, th))}</li>`).join('')}</ul>`;
}

function render() {
  document.documentElement.lang = lang;
  const root = document.getElementById('site')!;
  root.innerHTML = `
  <nav class="nav">
    <a class="brand" href="/"><img src="/assets/img/logo.webp" alt="Mochi Moon" width="150" height="70"></a>
    <div class="nav-links">
      <a href="#how">${t('How it works', 'เล่นยังไง')}</a>
      <a href="#loop">${t('Game loop', 'ลูปของเกม')}</a>
      <a href="#depth">${t('Depth', 'ความลึก')}</a>
      <a href="#earn">${t('Earn', 'สร้างรายได้')}</a>
      <a href="#roadmap">${t('Roadmap', 'แผนงาน')}</a>
      <a href="#faq">FAQ</a>
    </div>
    <div class="nav-end">
      <div class="lang" role="group" aria-label="Language">
        <button type="button" data-lang="en" aria-pressed="${lang === 'en'}">EN</button>
        <button type="button" data-lang="th" aria-pressed="${lang === 'th'}">TH</button>
      </div>
      <a class="btn btn-gold btn-sm" href="/play" data-play="nav">${t('Play', 'เล่นเลย')}</a>
    </div>
  </nav>

  <header class="hero">
    <div class="hero-art" style="background-image:url(${IMG}key-arena.webp)"></div>
    <div class="sparkles" aria-hidden="true">${'<i></i>'.repeat(14)}</div>
    <div class="hero-in">
      <img class="hero-logo" src="/assets/img/logo.webp" alt="Mochi Moon" width="300" height="140">
      <p class="kicker">${t('A cozy auto-battler with an idle town · onchain on Solana', 'auto-battler สุดน่ารัก + เมือง idle · onchain บน Solana')}</p>
      <h1>${t('Draft the build.', 'จัดบิลด์ให้เทพ')}<br><span>${t('It fights for you.', 'แล้วปล่อยให้มันสู้แทนคุณ')}</span></h1>
      <p class="lead">${t(
        'Pick a hero, stack skills that combo, and send your build against other players’ builds. Every run feeds your account: stardust, a Seal for the hero’s line and a page in your Hero Book. Between fights your heroes work your town, and soon three of them climb the Tower together.',
        'เลือกฮีโร่ สะสมสกิลที่คอมโบกัน แล้วส่งบิลด์ไปสู้กับบิลด์ของผู้เล่นคนอื่น ทุกรอบเติมบัญชีของคุณ: ผงดาว ตราของสายฮีโร่ และหน้าในสมุดฮีโร่ ระหว่างนั้นฮีโร่ทำงานในเมือง และอีกไม่นานสามตัวจะไต่หอเวทด้วยกัน',
      )}</p>
      <div class="cta">
        <a class="btn btn-gold btn-lg" href="/play" data-play="hero">▶ ${t('Play free now', 'เล่นฟรีเลย')}</a>
        <a class="btn btn-ghost" href="#join">${t('Join the waitlist', 'ลงชื่อรอข่าว')}</a>
      </div>
      <ul class="chips">
        <li>${t('Free', 'ฟรี')}</li><li>${t('Web + phone', 'เว็บ + มือถือ')}</li><li>${t('No login', 'ไม่ต้องล็อกอิน')}</li><li>${t('No wallet needed', 'ไม่ต้องมี wallet')}</li>
      </ul>
    </div>
    <a class="scroll-hint" href="#how" aria-label="${t('See how it works', 'ดูวิธีเล่น')}"><i></i></a>
  </header>

  <section class="stats" aria-label="${t('In the game today', 'ในเกมตอนนี้')}">
    ${(
      [
        [nHeroes, t('heroes', 'ฮีโร่'), ICONS.hero],
        [nSkills, t('skills', 'สกิล'), ICONS.skill],
        [nRelics, t('relics', 'เรลิก'), ICONS.relic],
        [WIN_TARGET, t('wins to clear a run', 'ชนะเพื่อผ่าน run'), ICONS.crown],
      ] as const
    )
      .map(([n, label, svg]) => `<div><span class="st-ico" aria-hidden="true">${svg}</span><b>${n}</b><span>${label}</span></div>`)
      .join('')}
  </section>

  <section id="how" class="sec how">
    <p class="kicker center">${t('How it works', 'เล่นยังไง')}</p>
    <h2 class="center">${t('Five steps. Two minutes to learn.', 'ห้าขั้น เรียนรู้ได้ในสองนาที')}</h2>
    ${(
      [
        ['game-pick.webp', t('Pick a hero', 'เลือกฮีโร่'), t(`Each run offers 3 of ${nHeroes} heroes, each with its own style and ultimate.`, `ทุก run สุ่มให้เลือก 3 จาก ${nHeroes} ฮีโร่ แต่ละตัวมีสไตล์และท่าไม้ตายของตัวเอง`)],
        ['game-shop.webp', t('Draft skills that combo', 'จัดสกิลที่คอมโบกัน'), t(`Buy and upgrade from ${nSkills} skills. Put partners side by side and they chain into bigger hits.`, `ซื้อและอัปสกิลจาก ${nSkills} แบบ วางคู่ที่เข้ากันไว้ติดกัน แล้วมันจะต่อคอมโบแรงขึ้น`)],
        ['game-fight.webp', t('It fights for you', 'มันสู้แทนคุณ'), t('Hit fight and your build battles another player’s build on its own. Watch the combos land, learn, tweak.', 'กดสู้ แล้วบิลด์ของคุณจะสู้กับบิลด์ของผู้เล่นอื่นเอง ดูคอมโบออก เรียนรู้ แล้วปรับ')],
        ['game-win.webp', t(`Climb to ${WIN_TARGET} wins`, `ไต่ให้ถึง ${WIN_TARGET} ชนะ`), t(`Every loss costs HP. Reach the crown before you run out. ${SEAL_D_WINS}+ wins earn a Seal of your hero’s line, and the run goes into your Hero Book. Casual is free and unlimited; Ranked puts you on the season board.`, `แพ้แต่ละครั้งเสียเลือด ไปให้ถึงมงกุฎก่อนเลือดหมด ชนะ ${SEAL_D_WINS}+ ได้ตราของสายฮีโร่ และรอบนั้นเข้าสมุดฮีโร่ โหมดทั่วไปเล่นฟรีไม่จำกัด แรงค์พาคุณขึ้นกระดาน season`)],
        ['../town-ground.webp', t('Your town keeps working', 'เมืองของคุณทำงานต่อ'), t('Heroes who are not fighting mine ore, cut wood and pray for crystals, even while the game is closed. Buildings level up without a cap, heroes master their jobs, and lucky finds drop while they work.', 'ฮีโร่ที่ไม่ได้สู้จะไปขุดแร่ ตัดไม้ และภาวนาหาคริสตัล แม้ตอนปิดเกม อาคารอัปเลเวลได้ไม่จำกัด ฮีโร่ชำนาญงานขึ้นเรื่อยๆ และมีโอกาสเจอของหายากระหว่างทำงาน')],
      ] as const
    )
      .map(
        ([img, h, p], i) => `<article class="feat${i % 2 ? ' flip' : ''}">
        <div class="feat-img"><img src="${IMG}${img}" alt="" loading="lazy"></div>
        <div class="feat-txt"><span class="feat-n">${i + 1}</span><h3>${h}</h3><p>${p}</p></div>
      </article>`,
      )
      .join('')}
  </section>

  <section id="loop" class="sec loop-sec">
    <p class="kicker center">${t('Game loop', 'ลูปของเกม')}</p>
    <h2 class="center">${t('One loop that keeps feeding itself', 'ลูปเดียวที่เติมตัวเองไปเรื่อยๆ')}</h2>
    <p class="center sub">${t('The Arena makes the items, the town turns them into progress, the Tower tests the team, and a lost floor sends you back to the Arena with a plan.', 'สนามประลองให้ของ เมืองเปลี่ยนเป็นความก้าวหน้า หอเวททดสอบทีม และชั้นที่แพ้ส่งคุณกลับสนามพร้อมแผน')}</p>
    ${loopHTML()}
    <h3 class="center sc-h">${t('The same loop, from a fight to a season', 'ลูปเดียวกัน ตั้งแต่ไฟต์เดียวจนถึงทั้งซีซั่น')}</h3>
    ${scalesHTML()}
  </section>

  <section class="sec watch">
    <div class="short">
      <iframe src="https://www.youtube-nocookie.com/embed/${SHORT[lang]}" title="Mochi Moon in 14 seconds" loading="lazy" allow="encrypted-media; picture-in-picture" allowfullscreen></iframe>
    </div>
    <div class="watch-text">
      <h2>${t('See it in 14 seconds', 'ดูเกมใน 14 วินาที')}</h2>
      <p>${t('Then watch our weekly build updates: what we shipped, what broke and what is next.', 'แล้วตามดูอัปเดตรายสัปดาห์: ทำอะไรเสร็จ อะไรพัง และจะทำอะไรต่อ')}</p>
      <a class="update-card" href="${LINKS.week1}" target="_blank" rel="noopener"><img src="${IMG}week1-cover.webp" alt="" loading="lazy" width="640" height="360"><span>▶ ${t('Week 1 update: foundations + data', 'อัปเดต week 1: วางระบบ + ข้อมูล')}</span></a>
      <a class="btn btn-ghost btn-sm" href="${LINKS.youtube}" target="_blank" rel="noopener">YouTube @mochimoongame</a>
    </div>
  </section>

  <section id="depth" class="sec depth">
    <p class="kicker center">${t('Build depth', 'ความลึกของบิลด์')}</p>
    <h2 class="center">${t('Easy to start. Hard to master.', 'เริ่มง่าย เก่งยาก')}</h2>
    <p class="center sub">${t(`${nVariants} skill versions, ${nRelics} relics and ${nLines} skill lines in a list of up to ${MAX_SLOTS}: no two runs build the same way. Then the account adds its own layer: Seals, the Hero Book and, soon, the Tower team.`, `สกิล ${nVariants} รูปแบบ เรลิก ${nRelics} ชิ้น และสายสกิล ${nLines} สาย ในช่องสูงสุด ${MAX_SLOTS} ช่อง: ไม่มี run ไหนจัดบิลด์ได้เหมือนกัน แล้วบัญชียังมีอีกชั้น: ตรา สมุดฮีโร่ และอีกไม่นานคือทีมหอเวท`)}</p>
    <div class="variety" aria-label="${t('Variety in numbers', 'ความหลากหลายเป็นตัวเลข')}">
      ${(
        [
          [`${nHeroes} × ${nLines}`, t('heroes × skill lines', 'ฮีโร่ × สายสกิล')],
          [nVariants, t('skill versions', 'รูปแบบสกิล')],
          [nRelics, t('relics', 'เรลิก')],
          [MARKS.length, t('marks', 'ตราประทับในรอบ')],
          [nSeals, t('possible Seals', 'แบบของตรา')],
          [nHeroes, t('Hero Book pages', 'หน้าในสมุดฮีโร่')],
        ] as const
      )
        .map(([n, l]) => `<div><b>${n}</b><span>${l}</span></div>`)
        .join('')}
    </div>
    <div class="depth-grid">
      ${(
        [
          ['🔗', t('Order is power', 'ลำดับคือพลัง'), t('Skills next to each other switch on link bonuses. Moving one card can turn a loss into a win, for free.', 'สกิลที่วางติดกันเปิดโบนัสเชื่อมต่อให้กัน ย้ายการ์ดใบเดียวก็พลิกแพ้เป็นชนะได้ ไม่เสียเงิน')],
          ['🌳', t('Branching upgrades', 'อัปเกรดแตกสาย'), t(`Every skill goes Lv1 → Lv3 with two paths at each step: ${nVariants} versions in all.`, `ทุกสกิลอัปจาก Lv1 ถึง Lv3 มีสองทางให้เลือกทุกขั้น รวม ${nVariants} รูปแบบ`)],
          ['✦', t('Relics and marks', 'เรลิกและตรา'), t(`Pick 1 of 3 relics on relic days and stamp ${MARKS.length} kinds of marks that bend the rules of a fight.`, `เลือกเรลิก 1 ใน 3 ในวันเรลิก และประทับตรา ${MARKS.length} แบบที่เปลี่ยนกติกาของไฟต์`)],
          ['★', t('Hero ultimates', 'ท่าไม้ตายของฮีโร่'), t('Collect three skills of your hero’s line to unlock its ultimate, then push it to Lv2.', 'สะสมสกิลสายของฮีโร่ครบสามใบเพื่อปลดท่าไม้ตาย แล้วอัปเป็น Lv2')],
          ['👻', t('Real opponents', 'คู่แข่งตัวจริง'), t('You fight the saved builds of other players from the same day, matched by rating. The meta moves with the players.', 'คุณสู้กับบิลด์ของผู้เล่นคนอื่นจากวันเดียวกัน จับคู่ตามเรตติ้ง เมต้าเปลี่ยนไปตามผู้เล่น')],
          ['🎲', t('Fair randomness', 'สุ่มอย่างยุติธรรม'), t('Shops and relics are random, fights are not: the same builds and seed always give the same fight, and the onchain version rolls with VRF anyone can check.', 'ร้านและเรลิกสุ่ม แต่ไฟต์ไม่สุ่ม: บิลด์และ seed เดิมได้ไฟต์เดิมทุกครั้ง และเวอร์ชัน onchain สุ่มด้วย VRF ที่ใครก็ตรวจได้')],
          ['🔖', t('Seals for every line', 'ตราของทุกสาย') + ' ' + live(), t(`Every hero earns its own line Seal, so all ${nHeroes} are worth playing. D or C grade, a roll of 1–10, early or late: ${nSeals} kinds. Keep up to ${STASH_MAX}; ${MAIL_MAX} more wait in the mailbox.`, `ฮีโร่ทุกตัวได้ตราของสายตัวเอง ทั้ง ${nHeroes} ตัวจึงน่าเล่นหมด เกรด D หรือ C ค่า 1–10 ต้นตาหรือท้ายตา รวม ${nSeals} แบบ เก็บได้ ${STASH_MAX} ใบ และรอในจดหมายได้อีก ${MAIL_MAX}`)],
          ['📖', t('The Hero Book', 'สมุดฮีโร่') + ' ' + live(), t('Keep one build per hero, chosen by you after each run. Line rank grows with every hero you play and unlocks the C grade for that line.', 'เก็บ build ไว้ตัวละ 1 แบบ คุณเลือกเองหลังจบรอบ แรงค์สายโตขึ้นทุกครั้งที่เล่นฮีโร่ของสายนั้น และปลดตราเกรด C ของสาย')],
          ['🗼', t('Tower relay', 'หอเวทแบบผลัดกันสู้') + ' ' + soon(), t('Order three heroes, pick a Lead and a Finisher, place Seals. Daily floor modifiers each favour one team style and punish another, so Hand-off Rot, Freeze-Shatter, Bulwark Clock, Burst and Gold Compound teams all get their day.', 'เรียงฮีโร่ 3 ตัว เลือกตัวเปิดและตัวปิด วางตรา กติกาประจำชั้นรายวันเข้าทางทีมแบบหนึ่งและสวนทางอีกแบบ ทีมสายพิษส่งต่อ แช่แข็งแตก โล่จับเวลา ระเบิดดาเมจ และทองทบต้น จึงมีวันของตัวเอง')],
        ] as const
      )
        .map(([ico, h, p]) => `<article><span class="d-ico" aria-hidden="true">${ico}</span><h3>${h}</h3><p>${p}</p></article>`)
        .join('')}
    </div>
  </section>

  <section id="earn" class="sec earn">
    <p class="kicker center">${t('Earn', 'สร้างรายได้')}</p>
    <h2 class="center">${t('The Arena stays equal. The Tower rewards gear.', 'สนามประลองเท่าเทียมตลอดไป หอเวทให้รางวัลกับอุปกรณ์')}</h2>
    <div class="earn-grid">
      <article>
        <h3>${t('Climb today', 'ไต่อันดับได้วันนี้')} <em class="live">${t('live', 'เปิดแล้ว')}</em></h3>
        <p>${t('Ranked runs put you on the season leaderboard. Every run pays stardust and line rank; 3+ wins earn a Seal. Your town turns play into wood, ore and crystal that adopt heroes and grow your town.', 'การเล่นแรงค์พาคุณขึ้นกระดานผู้นำ season ทุกรอบได้ผงดาวและแรงค์สาย ชนะ 3+ ได้ตรา เมืองเปลี่ยนการเล่นเป็นไม้ แร่ และคริสตัล เอาไปรับฮีโร่และขยายเมือง')}</p>
      </article>
      <article>
        <h3>${t('Moonstone and the Moon Market', 'หินจันทร์และ Moon Market')} <em class="plan">${t('planned', 'แผน')}</em></h3>
        <p>${t('Deep Tower floors pay Moonstone, at most 2 a week. Players trade it with each other on the Moon Market, along with Tower gear (C Seals with high rolls, crafted Kit). The house never sells Moonstone or sets its price; it takes a fee on trades.', 'ชั้นลึกของหอเวทให้หินจันทร์ สูงสุด 2 ก้อนต่อสัปดาห์ ผู้เล่นซื้อขายกันเองใน Moon Market พร้อมอุปกรณ์หอเวท (ตรา C ค่าสูง และ Kit ที่คราฟต์) เกมไม่ขายหินจันทร์และไม่กำหนดราคา เก็บเพียงค่าธรรมเนียมการซื้อขาย')}</p>
      </article>
      <article>
        <h3>${t('Ranked prizes in USDC', 'รางวัลแรงค์เป็น USDC')} <em class="plan">${t('planned', 'แผน')}</em></h3>
        <p>${t('The Moon Fund, a share of what the house sells (looks, status, the season pass), goes to the Ranked season prizes in USDC. Never player stakes. Results settle on Solana as a Merkle root you can check (already working on devnet with in-game currency).', 'Moon Fund ส่วนหนึ่งจากของที่เกมขาย (ของแต่งตัว สถานะ season pass) เป็นรางวัลแรงค์ประจำ season แบบ USDC ไม่ใช่เงินเดิมพันของผู้เล่น ผลลงบน Solana เป็น Merkle root ที่ตรวจได้ (ใช้งานได้แล้วบน devnet กับสกุลเงินในเกม)')}</p>
      </article>
    </div>
    <ul class="badges center-badges">
      <li>${t('Same hero = same strength in the Arena', 'ในสนามประลอง ฮีโร่ตัวเดียวกันแรงเท่ากันทุกคน')}</li>
      <li>${t('Nothing you own enters a Ranked fight', 'ของที่คุณมีไม่เข้าไปในไฟต์แรงค์')}</li>
      <li>${t('The game never sells power', 'เกมไม่ขายพลัง')}</li>
      <li>${t('No token, no loot boxes', 'ไม่มีเหรียญ ไม่มีกล่องสุ่ม')}</li>
    </ul>
  </section>

  <section class="sec onchain">
    <div class="onchain-art" style="background-image:url(${IMG}key-seal.webp)"></div>
    <div class="onchain-in">
      <p class="kicker">${t('Why onchain', 'ทำไมต้อง onchain')}</p>
      <h2>${t('Fights anyone can verify', 'ไฟต์ที่ใครก็ตรวจสอบได้')}</h2>
      <p>${t(
        'Combat is deterministic, so a fight is just builds + a seed. Our onchain version runs the whole run on Solana inside a MagicBlock private ephemeral rollup: rivals cannot peek at your build, every random roll comes from MagicBlock VRF and can be re-checked when the run ends, and season results land on Solana. It passes its full devnet test (19/19); it is not on this public server yet.',
        'การต่อสู้เป็น deterministic ไฟต์หนึ่งจึงเท่ากับบิลด์ + seed เวอร์ชัน onchain ของเรารันทั้ง run บน Solana ใน MagicBlock private ephemeral rollup คู่แข่งแอบดูบิลด์คุณไม่ได้ ทุกการสุ่มมาจาก MagicBlock VRF และตรวจซ้ำได้เมื่อจบ run และผลประจำ season ลงบน Solana ผ่านการทดสอบเต็มบน devnet แล้ว (19/19) แต่ยังไม่ได้ขึ้นเซิร์ฟเวอร์สาธารณะนี้',
      )}</p>
      <ul class="badges">
        <li>${t('Deterministic fights', 'ไฟต์แบบ deterministic')}</li>
        <li>${t('Hidden builds (private rollup)', 'บิลด์เป็นความลับ (private rollup)')}</li>
        <li>${t('VRF randomness', 'สุ่มด้วย VRF')}</li>
        <li>${t('Season results on Solana', 'ผล season บน Solana')}</li>
      </ul>
    </div>
  </section>

  <section id="roadmap" class="sec">
    <p class="kicker center">${t('Roadmap', 'แผนงาน')}</p>
    <h2 class="center">${t('Built in public, week by week', 'สร้างแบบเปิดเผย ทีละสัปดาห์')}</h2>
    <div class="road">
      <article class="done"><h3><em>${t('Built', 'ทำแล้ว')}</em>${t('Weeks 1–2', 'สัปดาห์ที่ 1–2')}</h3>${list(DONE)}</article>
      <article class="now"><h3><em>${t('In progress', 'กำลังทำ')}</em>${t('Now', 'ตอนนี้')}</h3>${list(NOW)}</article>
      <article class="next"><h3><em>${t('Planned', 'แผน')}</em>${t('Next', 'ถัดไป')}</h3>${list(NEXT)}</article>
    </div>
    <p class="never">${t('Never: a game token, wagering, loot boxes, the game selling power, or anything paid in an Arena fight.', 'ไม่มีวัน: เหรียญเกม การพนัน กล่องสุ่ม เกมขายพลัง หรือของที่จ่ายเงินในไฟต์สนามประลอง')}</p>
  </section>

  <section id="join" class="sec join">
    <div>
      <h2>${t('Join the waitlist', 'ลงชื่อรอข่าว')}</h2>
      <p>${t('Get the public playtest news, the onchain launch and season start. One message per milestone, no spam.', 'รับข่าวการเปิดทดสอบ การเปิดเวอร์ชัน onchain และการเริ่ม season แจ้งเฉพาะตอนมีความคืบหน้า ไม่สแปม')}</p>
      <p class="fine">${t('Or just', 'หรือ')} <button type="button" class="linkish" data-feedback>${t('send us feedback', 'ส่งความเห็นถึงเรา')}</button>.</p>
    </div>
    <form class="wait" novalidate>
      <label>Telegram<input name="telegram" autocomplete="off" placeholder="@username" maxlength="40"></label>
      <label>X<input name="x" autocomplete="off" placeholder="@handle" maxlength="20"></label>
      <label>${t('Email (optional)', 'อีเมล (ไม่บังคับ)')}<input name="email" type="email" autocomplete="email" placeholder="you@mail.com" maxlength="254"></label>
      <label>${t('Solana wallet (optional)', 'Solana wallet (ไม่บังคับ)')}<input name="wallet" autocomplete="off" placeholder="${t('for future drops', 'ไว้รับของในอนาคต')}" maxlength="50"></label>
      <input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
      <label class="check"><input type="checkbox" name="consent"> ${t('Contact me about Mochi Moon. I can ask to be removed any time.', 'ติดต่อฉันเรื่อง Mochi Moon ได้ ขอให้ลบออกได้ทุกเมื่อ')}</label>
      <button class="btn btn-gold" type="submit">${t('Count me in', 'ลงชื่อเลย')}</button>
      <p class="msg" role="status"></p>
    </form>
  </section>

  <section id="faq" class="sec faq">
    <h2>FAQ</h2>
    ${[
      [t('Is it free?', 'เล่นฟรีไหม?'), t('Yes. Casual runs are free and unlimited, and every day brings a free Ranked ticket. No login and no wallet needed.', 'ฟรี โหมดทั่วไปเล่นได้ไม่จำกัด และได้ตั๋วแรงค์ฟรีทุกวัน ไม่ต้องล็อกอิน ไม่ต้องมี wallet')],
      [t('How can I earn?', 'สร้างรายได้ได้ยังไง?'), t('Two ways are planned: Ranked season prizes in USDC from the Moon Fund, and trading Moonstone and Tower gear with other players on the Moon Market. Neither is live yet; today you climb the Ranked board, collect Seals and grow your town.', 'มีแผนสองทาง: รางวัลแรงค์ประจำ season เป็น USDC จาก Moon Fund และการซื้อขายหินจันทร์กับอุปกรณ์หอเวทกับผู้เล่นคนอื่นใน Moon Market ทั้งสองยังไม่เปิด ตอนนี้ไต่กระดานแรงค์ สะสมตรา และขยายเมืองได้')],
      [t('Can money buy power?', 'เงินซื้อพลังได้ไหม?'), t('Not in the Arena: nothing from outside a run enters a Ranked fight, and the same hero is equally strong for everyone. In the Tower (coming) gear matters; Seals and Kit come from play, and players will be able to trade them with each other. The game itself never sells power.', 'ในสนามประลองไม่ได้: ของนอกรอบไม่เข้าไปในไฟต์แรงค์ และฮีโร่ตัวเดียวกันแรงเท่ากันทุกคน ในหอเวท (กำลังมา) อุปกรณ์มีผล ตราและ Kit ได้จากการเล่น และผู้เล่นจะซื้อขายกันเองได้ ตัวเกมไม่ขายพลัง')],
      [t('What is a Seal?', 'ตราคืออะไร?'), t(`A Tower item earned in the Arena: a run with ${SEAL_D_WINS}+ wins offers a Seal of its hero's line. Claim 1 a day with stardust in the Hero Hall and equip it on a hero. Seals never enter an Arena fight.`, `ไอเทมสำหรับหอเวทที่ได้จากสนามประลอง: รอบที่ชนะ ${SEAL_D_WINS}+ ได้ข้อเสนอตราของสายฮีโร่ตัวนั้น รับได้วันละ 1 ใบด้วยผงดาวที่หอฮีโร่ แล้วใส่ให้ฮีโร่ ตราไม่เคยเข้าไปในไฟต์สนามประลอง`)],
      [t('What is the town?', 'เมืองคืออะไร?'), t('Your idle base. Heroes who are not fighting work the mine, the shrine and the lumber yard while you are away; collect when you are back and spend on tickets, heroes and buildings. The Hero Hall holds your Seal tray and Hero Book.', 'ฐาน idle ของคุณ ฮีโร่ที่ไม่ได้สู้จะทำงานที่เหมือง ศาลเจ้า และลานตัดไม้ตอนคุณไม่อยู่ กลับมาเก็บแล้วใช้ทำตั๋ว รับฮีโร่ และอัปอาคาร หอฮีโร่เก็บถาดตราและสมุดฮีโร่ของคุณ')],
      [t('Do I need a crypto wallet?', 'ต้องมี wallet คริปโตไหม?'), t('Not to play. The onchain version (in testing on devnet) uses Phantom with a session key, so you do not sign every move.', 'ไม่ต้องก็เล่นได้ เวอร์ชัน onchain (กำลังทดสอบบน devnet) ใช้ Phantom กับ session key จึงไม่ต้องกดยืนยันทุกตา')],
      [t('Is there a token?', 'มีเหรียญไหม?'), t('No. No token, no loot boxes, no pay-to-win.', 'ไม่มี ไม่มีเหรียญ ไม่มีกล่องสุ่ม ไม่มี pay-to-win')],
      [t('Does it work on my phone?', 'เล่นบนมือถือได้ไหม?'), t('Yes, in the browser on phone and desktop.', 'ได้ เล่นผ่านเบราว์เซอร์ทั้งมือถือและคอม')],
      [t('Where is my progress saved?', 'ความคืบหน้าเก็บไว้ที่ไหน?'), t('Your player and runs are tied to this browser, and your finished runs are on our server for the leaderboard.', 'ผู้เล่นและ run ผูกกับเบราว์เซอร์นี้ และ run ที่จบแล้วเก็บบนเซิร์ฟเวอร์เพื่อทำ leaderboard')],
    ]
      .map(([q, a]) => `<details><summary>${q}</summary><p>${a}</p></details>`)
      .join('')}
  </section>

  <section class="sec final">
    <h2>${t('Ready to draft?', 'พร้อมจัดบิลด์หรือยัง?')}</h2>
    <a class="btn btn-gold" href="/play" data-play="final">▶ ${t('Play free now', 'เล่นฟรีเลย')}</a>
  </section>

  <div class="mbar"><a class="btn btn-gold" href="/play" data-play="mbar">▶ ${t('Play free now', 'เล่นฟรีเลย')}</a></div>

  <footer class="foot">
    <img src="/assets/img/logo.webp" alt="" width="110" height="52">
    <div class="foot-links">
      <a href="${LINKS.youtube}" target="_blank" rel="noopener">YouTube</a>
      <a href="${LINKS.x}" target="_blank" rel="noopener">X @tenny2201</a>
      <a href="${LINKS.telegram}" target="_blank" rel="noopener">Telegram @ten852456</a>
      <button type="button" class="linkish" data-feedback>${t('Feedback', 'ส่งความเห็น')}</button>
    </div>
    <p class="fine">${t(`Built for Solana · prototype v${VERSION} · numbers come straight from the game code`, `สร้างเพื่อ Solana · prototype v${VERSION} · ตัวเลขทุกตัวมาจากโค้ดเกมโดยตรง`)}</p>
  </footer>`;
  bind(root);
}

function bind(root: HTMLElement) {
  for (const b of root.querySelectorAll<HTMLButtonElement>('[data-lang]')) {
    b.addEventListener('click', () => {
      lang = b.dataset.lang === 'th' ? 'th' : 'en';
      setLangValue(lang);
      try {
        localStorage.setItem(LANG_KEY, lang); // the game follows the same choice
      } catch {
        /* fine */
      }
      render();
    });
  }
  for (const a of root.querySelectorAll<HTMLAnchorElement>('[data-play]')) {
    a.addEventListener('click', () => track('play_click', { src: a.dataset.play, lang }));
  }
  for (const b of root.querySelectorAll<HTMLButtonElement>('[data-feedback]')) {
    b.addEventListener('click', () => openFeedback({ screen: 'landing' }));
  }
  const form = root.querySelector<HTMLFormElement>('form.wait')!;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const msg = form.querySelector<HTMLElement>('.msg')!;
    const val = (k: string) => String(f.get(k) ?? '').trim();
    if (!val('telegram') && !val('x') && !val('email')) {
      msg.textContent = t('Add your Telegram, X or email.', 'ใส่ Telegram, X หรืออีเมลอย่างน้อยหนึ่งช่อง');
      return;
    }
    if (!f.get('consent')) {
      msg.textContent = t('Tick the box so we can contact you.', 'ติ๊กช่องยินยอมก่อนนะ');
      return;
    }
    const btn = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
    btn.disabled = true;
    msg.textContent = '';
    try {
      const r = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          telegram: val('telegram'), x: val('x'), email: val('email'), wallet: val('wallet'), hp: val('website'),
          consent: true, lang, src: 'landing', v: visitorId(),
        }),
      });
      if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error || 'error');
      form.innerHTML = `<div class="joined"><b>${t('You are on the list! 🌙', 'ลงชื่อเรียบร้อย! 🌙')}</b><span>${t('We will message you at each milestone.', 'เราจะแจ้งเมื่อมีความคืบหน้าสำคัญ')}</span><a class="btn btn-gold btn-sm" href="/play" data-play="joined">▶ ${t('Play while you wait', 'เล่นระหว่างรอ')}</a></div>`;
    } catch (err) {
      btn.disabled = false;
      msg.textContent = t('Could not sign you up: ', 'ลงชื่อไม่สำเร็จ: ') + (err as Error).message;
    }
  });
}

if (!location.search) {
  setLangValue(lang);
  render();
  track('landing_view', { lang });
}
