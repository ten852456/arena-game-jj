/**
 * คู่มือ / Codex: the in-game encyclopedia. One overlay (its own DOM, outside #panel, so it opens over any screen),
 * nine sections, a search box, and contextual links: any element with `data-codex="<target>"` opens it at that entry
 * (targets: a section id, or `relic:<id>`, `mark:<kind>`, `skill:<id>`, `hero:<id>`, `stars`, `rarity`, …).
 * Every number is read from the live code and tuning (run.ts, relics.ts, heroes.ts, tuning.ts, combat.ts), so the codex
 * follows each balance round by itself. Text is Thai first through L(th, en).
 */
import { L, getLang } from '../i18n';
import { CLEANSE_MAX, QUICK_MARK, SIGIL_MAX, fatigueStart, fatigueStep, freezeCap, starPower } from '../sim/combat';
import { HEROES, HEROES_BY_ID, ULT_LV2_LV3, ULT_PIECES, lineAffinity, ultRuleText } from '../sim/heroes';
import { GROUP_ICON, MAX_RELICS, NEEDS, RELICS, RELIC_DAYS, RELIC_OFFER, relicHint } from '../sim/relics';
import * as R from '../sim/run';
import { EPIC, KEYWORDS, LINE_ICON, LINE_NAME, RARE, ROLE_NAME, SKILLS, SKILL_LIST, SKILL_ROLE, rarityOf, type Keyword, type Variant } from '../sim/skills';
import { T } from '../sim/tuning';
import { LINES, type Line, type Mark } from '../sim/types';
import { skillIcon } from './assets';
import { MARK_MAX, LONE_MAX, esc, groupLabel, relicMedal, relicRisk, starGain } from './depthUI';
import { onLang } from './lang';
import { simpleText } from './skillText';

type Sec = 'run' | 'lines' | 'heroes' | 'skills' | 'stars' | 'relics' | 'marks' | 'shop' | 'status';
const SECS: Sec[] = ['run', 'lines', 'heroes', 'skills', 'stars', 'relics', 'marks', 'shop', 'status'];
const secName = (s: Sec) =>
  ({
    run: L('รอบการเล่น', 'How a run works'), lines: L('8 สาย', '8 lines'), heroes: L('ฮีโร่', 'Heroes'), skills: L('สกิล', 'Skills'),
    stars: L('ดาว', 'Stars'), relics: L('ของวิเศษ', 'Relics'), marks: L('ตรา', 'Marks'), shop: L('ร้านค้า', 'Shop tools'), status: L('สถานะ', 'Status words'),
  })[s];
const SEC_ICON: Record<Sec, string> = { run: '🌙', lines: '⚔', heroes: '🐰', skills: '📜', stars: '★', relics: '🏺', marks: '✦', shop: '🪙', status: '🔥' };

interface Entry { sec: Sec; id: string; title: string; html: string; keys: string }

const pc = (x: number) => Math.round(x * 100);
const th = () => getLang() !== 'en';
/** "วัน 1–3: 2 · วัน 4–7: 3" for a per-day value */
function byDay(fn: (d: number) => number | string, last = 14, unit = '') {
  const out: string[] = [];
  let start = 1;
  for (let d = 2; d <= last + 1; d++) {
    if (d > last || fn(d) !== fn(start)) {
      const span = d - 1 === start ? `${start}` : d > last ? `${start}+` : `${start}–${d - 1}`;
      out.push(`${L('วัน', 'day')} ${span}: <b>${fn(start)}${unit}</b>`);
      start = d;
    }
  }
  return out.join(' · ');
}
const p = (s: string) => `<p>${s}</p>`;
const ul = (xs: string[]) => `<ul>${xs.map((x) => `<li>${x}</li>`).join('')}</ul>`;

/** Who beats whom (docs/DESIGN_LINES_ULT.md §3, through mechanics): line → the two it beats, with why. */
const BEATS: Record<Line, [Line, Line, string, string]> = {
  hit: ['heal', 'poison', 'ตีแรงเร็วกว่าฟื้น และจบก่อนพิษซ้อน', 'hits outpace healing and end fights before poison stacks'],
  dodge: ['hit', 'ice', 'หลบการตี และหลบลูกน้ำแข็งแล้วแช่แข็งไม่ติด', 'dodges hits, and a dodged ice hit never freezes'],
  shield: ['hit', 'ice', 'โล่รับการตี ใจเหล็กลดการคุม', 'shields soak hits, Iron Will weakens control'],
  heal: ['burn', 'wind', 'ฟื้นทันไฟ และทันการตีเบาถี่ๆ', 'heals keep up with burn and with quick light hits'],
  burn: ['shield', 'dodge', 'ไฟไม่สนโล่ และหลบไม่ได้', 'burn ignores shields and cannot be dodged'],
  poison: ['shield', 'dodge', 'พิษไม่สนโล่ และหลบไม่ได้', 'poison ignores shields and cannot be dodged'],
  ice: ['wind', 'heal', 'แช่แข็งหยุดความเร็ว และหยุดคูลดาวน์ฮีล', 'freeze stops haste and stops healing cooldowns'],
  wind: ['poison', 'burn', 'ลมพัดดีบัฟทิ้ง', 'wind blows debuffs away'],
  gold: ['dodge', 'heal', 'แจ็กพอตหลบไม่ได้ และตีก้อนใหญ่เกินกว่าจะฟื้นทัน', 'the jackpot can’t be dodged, and its big hits outpace healing'],
  time: ['ice', 'wind', 'สมาธิกันการคุม และยิ่งถ่วงเวลา ยิ่งแรง', 'calm mind shrugs off control, and every delay only makes it stronger'],
};
const LINE_SAYS: Record<Line, [string, string]> = {
  hit: ['ตีแรง รวมพลัง ปลิดชีพ', 'big hits, charge, executes'],
  dodge: ['ตีเร็ว เก็บแต้มหลบ หลบแล้วสวน', 'fast hits, dodge charges, counters'],
  shield: ['สะสมโล่ แล้วกระแทกด้วยโล่', 'stack shields, then bash with them'],
  heal: ['ฟื้น ดูดเลือด ยิ่งนานยิ่งแรง', 'heal, drain, grow stronger over time'],
  burn: ['ไฟแรงสั้น เผาโล่ ระเบิดไฟ', 'short strong burns that melt shields'],
  poison: ['พิษซ้อนกองนาน ลดการฟื้นของศัตรู', 'long stacking poison that cuts enemy healing'],
  ice: ['แช่แข็ง ทุบน้ำแข็ง', 'freeze, then shatter'],
  wind: ['เร่งตัวเอง ทำศัตรูช้า พัดดีบัฟทิ้ง', 'haste yourself, slow the enemy, blow debuffs away'],
  gold: ['ลงทองกับ skill ยิ่งมาก ยิ่งตีแรง แจ็กพอตก้อนใหญ่', 'the more gold in your skills, the harder you hit; big jackpots'],
  time: ['ยิ่งสู้นานยิ่งแรง ลูกตุ้มยิ่งใช้ยิ่งเร็ว', 'stronger every second; a pendulum that speeds up'],
};
const lineChip = (l: Line | 'none') => `<span class="cx-line line-${l}">${LINE_ICON[l]} ${esc(LINE_NAME[l])}</span>`;
const link = (target: string, text: string) => `<a class="cx-link" data-codex="${target}" href="#">${text}</a>`;

function build(): Entry[] {
  const E: Entry[] = [];
  const add = (sec: Sec, id: string, title: string, html: string, keys = '') => E.push({ sec, id, title, html, keys: `${title} ${keys} ${html.replace(/<[^>]+>/g, ' ')}`.toLowerCase() });

  // ---------- 1. a run ----------
  add('run', 'goal', L('เป้าหมาย: ชนะ 10 ก่อนเลือดหมด', 'Goal: 10 wins before your HP runs out'),
    p(L(`ทุกวันคุณซื้อ skill แล้วสู้ 1 ครั้งกับ build ของผู้เล่นคนอื่นในวันเดียวกัน · ชนะครบ <b>${R.WIN_TARGET}</b> = ได้มงกุฎ · เริ่มด้วยเลือด <b>${R.START_HP}</b>`,
      `Each day you buy skills, then fight once against another player's build from the same day · <b>${R.WIN_TARGET}</b> wins = the crown · you start with <b>${R.START_HP}</b> HP`)) +
    p(L(`แพ้เสียเลือด: ${byDay(R.damageFor)} (ไม่เกิน ${R.LOSS_CAP}) · เสมอไม่เสียเลือด แต่นับเป็นแพ้`, `A loss costs: ${byDay(R.damageFor)} (at most ${R.LOSS_CAP}) · a draw costs no HP but counts as a loss`)), 'hp lives win crown');
  add('run', 'gold', L('เงินรายวัน', 'Daily gold'),
    p(L(`ได้เงินทุกเช้า: ${byDay((d) => R.incomeFor(d, 0).base, 8)} · ชนะติด 2/3/5 ครั้ง ได้โบนัส +${R.incomeFor(5, 2).bonus}/+${R.incomeFor(5, 3).bonus}/+${R.incomeFor(5, 5).bonus} · แพ้ติด 2 ครั้งขึ้นไป +${R.incomeFor(5, -2).bonus} · เงินที่เหลือเก็บไว้วันถัดไปได้`,
      `Gold every morning: ${byDay((d) => R.incomeFor(d, 0).base, 8)} · a 2/3/5 win streak adds +${R.incomeFor(5, 2).bonus}/+${R.incomeFor(5, 3).bonus}/+${R.incomeFor(5, 5).bonus} · 2+ losses in a row add +${R.incomeFor(5, -2).bonus} · unspent gold carries over`)), 'income streak');
  add('run', 'shopday', L('ร้าน skill', 'The skill shop'),
    p(L(`ร้านมีการ์ด ${R.SHOP_SIZE} ใบ: skill ใหม่ Lv1 ราคา ${R.PRICES[0]} (สกิลประจำตัว +1), การ์ด ▲ อัปเกรด skill ที่มี (Lv2 ${R.PRICES[1]}, Lv3 ${R.PRICES[2]}), และตั้งแต่วันที่ ${R.STAR_DAY} การ์ด ★ ดาว · อัป Lv3 ได้ตั้งแต่วันที่ ${R.LV3_DAY} · วันที่ ${R.LATE_DAY} ขึ้นไป ร้านเน้นอัปเกรดและดาวของที่คุณมี`,
      `The shop shows ${R.SHOP_SIZE} cards: a new Lv1 skill costs ${R.PRICES[0]} (a hero's unique +1), a ▲ card upgrades a skill you own (Lv2 ${R.PRICES[1]}, Lv3 ${R.PRICES[2]}), and from day ${R.STAR_DAY} ★ star cards · Lv3 upgrades from day ${R.LV3_DAY} · from day ${R.LATE_DAY} the shop leans to upgrades and stars of what you own`)) +
    p(L(`ช่อง skill: ${byDay((d) => R.slotsFor(d), 10)} (ซื้อเพิ่มได้ถึง ${R.MAX_SLOTS}) · ${link('shop', 'สุ่มใหม่ ล็อก ช่อง และพรจันทร์')}`, `Skill slots: ${byDay((d) => R.slotsFor(d), 10)} (buy more up to ${R.MAX_SLOTS}) · ${link('shop', 'reroll, lock, slots and moon wishes')}`)), 'buy price slot');
  add('run', 'order', L('ลำดับในรายการ', 'List order'),
    p(L('ทุก skill นับคูลดาวน์ของตัวเองพร้อมกัน · skill ที่อยู่ติดกัน (บน/ล่าง) เปิดโบนัสเชื่อมต่อ 🔗 ให้กัน · ถ้าพร้อมกัน ตัวบนทำงานก่อน · ต้นเกม skill สายหลักใช้ครั้งแรกไล่ตามลำดับรายการ',
      'Every skill counts its own cooldown at the same time · neighbours (above / below) switch on each other’s 🔗 connect bonuses · when two are ready together the upper one goes first · early on, main-line skills take their first turn in list order')), 'chain connect bonus');
  add('run', 'fight', L('การสู้', 'The fight'),
    p(L(`การสู้เล่นเอง ดูได้ เร่ง 2x/4x หรือข้ามได้ · ถ้ายืดเยื้อ ทั้งสองฝ่ายเหนื่อยล้า: เริ่ม ${byDay((d) => fatigueStart(d) / 10, 14, ' วิ')} · หลังสู้มีสรุปว่าชนะ/แพ้เพราะอะไร`,
      `Fights play themselves: watch, speed up 2x/4x or skip · long fights bring fatigue for both sides: from ${byDay((d) => fatigueStart(d) / 10, 14, 's')} · afterwards a summary says why you won or lost`)), 'fatigue replay');
  add('run', 'lastchance', L('โอกาสสุดท้าย', 'The last chance'),
    p(L('ครั้งแรกที่เลือดหมด คุณกลับมาเป็น <b>กึ่งวิญญาณ</b> ด้วยเลือด 1 และเลือกพลัง 1 อย่าง · แพ้อีกครั้งคือจบรอบ', 'The first time your HP runs out you come back as a <b>half-spirit</b> with 1 HP and pick one power · one more loss ends the run')) +
    ul([
      L(`<b>เสบียงสุดท้าย</b>: เงิน 8 และช่อง skill +1 (ช่องเต็ม ${R.MAX_SLOTS} แล้ว: เงิน ${R.SUPPLY_GOLD_FULL}) · ดีเมื่อยังมีของอยากซื้อ`, `<b>Last Supplies</b>: 8 gold and +1 skill slot (all ${R.MAX_SLOTS} slots: ${R.SUPPLY_GOLD_FULL} gold) · good when you still have things to buy`),
      L('<b>ตื่นพลัง</b>: skill Lv1 ทุกตัวขึ้น Lv2 (สุ่มทาง) · ดีเมื่อมี Lv1 หลายตัว', '<b>Awaken</b>: every Lv1 skill becomes Lv2 (random branch) · good with many Lv1 skills'),
      L(`<b>ตราวิญญาณ</b>: สุ่มตรา 1 ใน 4 แล้วเลือก skill · ดีเมื่อมี skill หลักที่ Lv3 แล้ว · ${link('marks', 'ตราคืออะไร')}`, `<b>Spirit Mark</b>: 1 of 4 random marks on a skill you pick · good when your main skill is Lv3 · ${link('marks', 'what marks do')}`),
    ]), 'ghost spirit supply awaken mark');

  // ---------- 2. lines ----------
  const rows = LINES.map((l) => {
    const [a, b, wth, wen] = BEATS[l];
    const loses = LINES.filter((x) => BEATS[x][0] === l || BEATS[x][1] === l);
    return `<tr><th>${lineChip(l)}</th><td>${esc(L(...LINE_SAYS[l]))}</td><td class="cx-win">${LINE_ICON[a]} ${LINE_ICON[b]}<small>${esc(L(wth, wen))}</small></td><td class="cx-lose">${loses.map((x) => LINE_ICON[x]).join(' ')}</td></tr>`;
  }).join('');
  add('lines', 'web', L('ใยแก้ทาง: ทุกสายชนะ 2 แพ้ 2', 'The counter web: each line beats 2, loses to 2'),
    p(L('ได้เปรียบเล็กน้อย ไม่ใช่ชนะแน่ · build ที่มี skill แก้ทาง (บทบาท "แก้ทาง") ช่วยลดจุดอ่อน', 'A small edge, never a lock · "answer" skills of a line help cover its weak spots')) +
    `<div class="cx-tablewrap"><table class="cx-table"><tr><th>${L('สาย', 'Line')}</th><th>${L('ถนัด', 'Does')}</th><th>${L('ชนะ', 'Beats')}</th><th>${L('แพ้', 'Loses to')}</th></tr>${rows}</table></div>`, 'counter beats weak');
  add('lines', 'roles', L('บทบาทของสกิลในสาย', 'Skill roles in a line'),
    ul([L(`<b>${ROLE_NAME.core}</b>: ใส่ธาตุของสาย`, `<b>${ROLE_NAME.core}</b> (core): adds the line's element`), L(`<b>${ROLE_NAME.payoff}</b>: ใช้ธาตุที่สะสมให้คุ้ม`, `<b>${ROLE_NAME.payoff}</b> (payoff): cashes it in`), L(`<b>${ROLE_NAME.tech}</b>: แก้สายที่เราแพ้`, `<b>${ROLE_NAME.tech}</b> (answer): helps against the lines you lose to`)]), 'core payoff tech');

  // ---------- 3. heroes ----------
  add('heroes', 'ult', L('ท่าไม้ตาย ปลดยังไง', 'How the ultimate unlocks'),
    p(L(ultRuleText(true), ultRuleText(false))) +
    p(L(`พูดง่ายๆ: มีสกิลสายหลัก ${ULT_PIECES[0]} ตัว = Lv1 · มีครบ ${ULT_PIECES[1]} ตัว และ ${ULT_LV2_LV3} ในนั้นเป็น Lv3 = Lv2 (แรงกว่าและยิงเร็วกว่า) · ท่าไม้ตายยิงได้ 1 ครั้งต่อการสู้`,
      `In plain words: ${ULT_PIECES[0]} skills of your hero's line = Lv1 · all ${ULT_PIECES[1]} with ${ULT_LV2_LV3} of them at Lv3 = Lv2 (stronger and sooner) · it fires once per fight`)), 'ultimate unlock lv1 lv2 piece');
  for (const h of HEROES)
    add('heroes', h.id, h.name,
      `<p>${lineChip(h.line)} <span class="cx-aff">${L('ถนัดสาย', 'line mastery')} +${pc(lineAffinity(h.id) - 1)}%</span></p>` +
      ul([`<b>${L('วิธีเล่น', 'Play style')}</b>: ${esc(h.style)}`, `<b>${L('ความสามารถ', 'Passive')}</b>: ${esc(h.passive)}`, `<b>★ ${esc(h.ult.name)}</b>: ${esc(h.ult.trigger)} → ${esc(h.ult.effect)}`, `<b>${L('สกิลประจำตัว', 'Unique skill')}</b>: ${link(`skill:${h.unique}`, esc(SKILLS[h.unique]?.name ?? h.unique))}`]), h.id);

  // ---------- 4. skills ----------
  add('skills', 'rarity', L('ระดับ Lv และทาง (ธรรมดา / หายาก / มหากาพย์)', 'Levels and branches (common / rare / epic)'),
    p(L('Lv1 → เลือก 1 ใน 2 ทางที่ Lv2 → แต่ละทางแยกอีก 2 ที่ Lv3 · ตอนอัปเกรดคุณเลือกทางเอง (พรจันทร์และตื่นพลังสุ่มให้) · ย้อนกลับไม่ได้', 'Lv1 → pick 1 of 2 branches at Lv2 → each splits into 2 more at Lv3 · you pick the branch when you upgrade (moon wishes and Awaken pick at random) · no going back')) +
    ul([
      `<span class="mark rarity-epic">${L('◆ มหากาพย์', '◆ Epic')}</span> ${L(`ทาง Lv3 ที่เปลี่ยนวิธีเล่นของ skill (มี ${Object.values(EPIC).flat().length} ทาง) · ในการสู้ขึ้นป้าย ◆`, `a Lv3 branch that changes how the skill plays (${Object.values(EPIC).flat().length} of them) · flagged ◆ in fights`)}`,
      `<span class="mark rarity-rare">${L('◇ หายาก', '◇ Rare')}</span> ${L(`ทาง Lv3 ที่เด่นเรื่องตัวเลข (มี ${Object.values(RARE).flat().length} ทาง)`, `a Lv3 branch with standout numbers (${Object.values(RARE).flat().length} of them)`)}`,
      L('ความหายากเป็นป้ายบอก ไม่มีกฎไหนขึ้นกับมัน', 'Rarity is a label: no rule depends on it'),
    ]), 'epic rare common branch');
  for (const d of SKILL_LIST) {
    const node = (v: Variant) => {
      const n = d.tree[v];
      const r = rarityOf(d.id, v);
      return `<li class="cx-node rar-${r}"><b>${esc(n.name)}</b> <small>Lv${v.length + 1}${v ? ` · ${v.toUpperCase()}` : ''}</small>${r !== 'common' ? ` <span class="mark rarity-${r}">${r === 'epic' ? L('◆ มหากาพย์', '◆ Epic') : L('◇ หายาก', '◇ Rare')}</span>` : ''}<span class="cx-st">${esc(simpleText({ id: d.id, v }))}</span></li>`;
    };
    const tree = `<ul class="cx-tree">${node('')}${(['a', 'b'] as const).map((b) => `<li class="cx-br"><span class="cx-bh">${L('ทาง', 'Branch')} ${b.toUpperCase()}${d.tree[b].style ? `: ${esc(d.tree[b].style!)}` : ''}</span><ul>${node(b)}${node(`${b}1`)}${node(`${b}2`)}</ul></li>`).join('')}</ul>`;
    const owner = d.hero ? HEROES_BY_ID[d.hero]?.name : '';
    add('skills', d.id,
      d.name,
      `<p class="cx-skh"><img class="skill-icon" src="${skillIcon(d.id)}" alt="">${lineChip(d.line)}${SKILL_ROLE[d.id] ? ` <span class="cx-role">${esc(ROLE_NAME[SKILL_ROLE[d.id]])}</span>` : ''}${owner ? ` <span class="mark uniq-tag">★ ${L('สกิลประจำตัว', 'unique')}: ${esc(owner)}</span>` : ''}</p><p class="cx-lv1">Lv1: ${esc(simpleText({ id: d.id, v: '' }))}</p><details class="cx-det"><summary>${L('ดูต้นไม้ทั้ง 7 ขั้น', 'See all 7 steps')}</summary>${tree}</details>`,
      `${d.id} ${d.line} ${Object.values(d.tree).map((n) => n.name).join(' ')}`);
  }

  // ---------- 5. stars ----------
  add('stars', 'stars', L('ดาว ★ หลัง Lv3', 'Stars ★ after Lv3'),
    p(L(`ตั้งแต่วันที่ ${R.STAR_DAY} ร้านมีการ์ดซ้ำของ skill ที่ Lv3 แล้ว · ซื้อ = +★ (สูงสุด ${'★'.repeat(R.STAR_MAX)}) · ราคา ${R.STAR_PRICES.join(' / ')} · ขายคืนได้ +1 ต่อดาว · วันที่ ${R.LATE_DAY} ขึ้นไปดาวโผล่บ่อยขึ้น`,
      `From day ${R.STAR_DAY} the shop offers duplicates of your Lv3 skills · buying one adds a ★ (up to ${'★'.repeat(R.STAR_MAX)}) · prices ${R.STAR_PRICES.join(' / ')} · selling refunds +1 per star · from day ${R.LATE_DAY} stars show up more`)) +
    ul([1, 2, 3].map((n) => `<b>${'★'.repeat(n)}</b>: ${esc(starGain(n))}`)) +
    p(L(`★★★ คือก้าวใหญ่: ซ้ำทุกครั้งที่ใช้ ${pc(T['star.echo'])}% ของดาเมจที่การใช้ครั้งนั้นทำจริง (ไม่ซ้ำพลัง ไฟ พิษ หนาม) · ในการสู้ขึ้นป้าย "★★★ ซ้ำ" · รวม ×${starPower(3).toFixed(2)}`,
      `★★★ is the big step: every cast repeats ${pc(T['star.echo'])}% of the damage it actually dealt (power, burn, poison and thorns are not repeated) · flagged "★★★ echo" in fights · ×${starPower(3).toFixed(2)} in all`)), 'star echo duplicate');

  // ---------- 6. relics ----------
  add('relics', 'about', L('ของวิเศษประจำรอบ', 'Run relics'),
    p(L(`วันที่ ${RELIC_DAYS.join(', ')} ก่อนเปิดร้าน เลือก 1 จาก ${RELIC_OFFER} (หรือข้าม) ใช้ได้ทั้งรอบ มีได้ ${MAX_RELICS} ชิ้น · ข้อเสนอมีอย่างน้อย 1 ชิ้นที่เข้ากับสิ่งที่ build คุณทำ`,
      `On days ${RELIC_DAYS.join(', ')}, before the shop, pick 1 of ${RELIC_OFFER} (or skip); it lasts the whole run, ${MAX_RELICS} at most · each offer has at least 1 that fits what your build does`)) +
    p(L('<b>"เข้ากับ build คุณ"</b> = มี skill อย่างน้อย 2 ตัวที่ทำสิ่งที่ของชิ้นนั้นต้องการ · ของ ✦ ทั่วไปใช้ได้ทุก build · ของ ☢ เสี่ยงแรงเฉพาะเมื่อประกอบได้ และมีข้อเสีย', '<b>"Fits your build"</b> = at least 2 of your skills do what it needs · ✦ any-build relics work for everyone · ☢ risky relics only pay off with their setup and have a downside')), 'relic fits risky day');
  const NEED_NAME: Record<string, string> = {
    'line:hit': L('skill สายตี', 'hit-line skills'), charge: L('รวมพลัง', 'charge'), exec: L('ประหาร', 'execute'), dodge: L('หลบ', 'dodge'), shield: L('โล่', 'shield'), heal: L('ฟื้น', 'healing'),
    burn: L('ไฟ', 'burn'), poison: L('พิษ', 'poison'), freeze: L('แช่แข็ง', 'freeze'), slow: L('ช้า', 'slow'), haste: L('เร่ง', 'haste'),
  };
  for (const x of RELICS) {
    const risk = relicRisk(x.id, null);
    const need = NEEDS[x.id];
    const fits = need ? L(`เข้ากับ build เมื่อมี skill ≥ 2 ตัวที่ใช้ ${need.map((n) => NEED_NAME[n] ?? n).join(' / ')}`, `Fits when 2+ of your skills use ${need.map((n) => NEED_NAME[n] ?? n).join(' / ')}`) : x.group === 'cheese' ? L('ไม่ขึ้นป้าย "เข้ากับ build"', 'never labelled "fits"') : L('ใช้ได้ทุก build', 'works for any build');
    const d = x.desc();
    add('relics', x.id, L(x.name[0], x.name[1]),
      `<div class="cx-relic">${relicMedal(x.id, 'md')}<div><p class="cx-rg">${groupLabel(x.group)}${x.also?.length ? ` <small>+ ${x.also.map((l) => GROUP_ICON[l]).join(' ')}</small>` : ''}</p><p>${esc(th() ? d[0] : d[1])}</p><p class="muted small">${esc(fits)}${x.id === 'lonewolf' ? L(` · เสนอตั้งแต่วันที่ ${RELIC_DAYS[1]}`, ` · offered from day ${RELIC_DAYS[1]}`) : ''}</p>${
        risk ? `<p class="cx-risk">⚠ ${esc(risk.band)} · ${esc(risk.now)}</p>` : relicHint(x.id, th()) ? `<p class="cx-risk">⚠ ${esc(relicHint(x.id, th()))}</p>` : ''
      }</div></div>`, `${x.id} ${x.name[0]} ${x.name[1]} ${x.group}`);
  }

  // ---------- 7. marks ----------
  add('marks', 'about', L('ตราคืออะไร', 'What marks are'),
    p(L(`ตราติดอยู่กับ skill หนึ่งตัวและเปลี่ยนวิธีทำงานของมัน · มีได้สูงสุด <b>${MARK_MAX}</b> อันต่อรอบ: จากโอกาสสุดท้าย 1 และจากพรจันทร์ ${R.WISH_MARKS_MAX}`, `A mark sits on one skill and changes how it works · at most <b>${MARK_MAX}</b> a run: 1 from the last chance and ${R.WISH_MARKS_MAX} from moon wishes`)) +
    p(L('<b>ตราลึกลับ</b>: ในรอบออนไลน์ เซิร์ฟเวอร์เป็นคนสุ่มชนิดตรา ตราจึงขึ้นเป็น "?" ก่อน (ทำงานแล้ว) และเปิดชนิดหลังสู้ครั้งถัดไป', '<b>Hidden marks</b>: in online runs the server rolls the kind, so a new mark shows as "?" (it already works) and its kind is revealed after your next fight')) +
    p(L(`ของวิเศษ ${link('relic:sigil', 'ตราศักดิ์สิทธิ์')} เพิ่มพลัง skill ที่มีตรา (${SIGIL_MAX} ตัวแรกในรายการ)`, `The ${link('relic:sigil', 'Sigil')} relic boosts marked skills (the first ${SIGIL_MAX} in your list)`)), 'hidden mark max');
  const MARK_GLYPH: Record<Mark, string> = { burn: '✹', echo: '↻', quick: '»', steadfast: '⛨' };
  for (const m of R.MARKS)
    add('marks', m, `${MARK_GLYPH[m]} ${R.MARK_INFO[m].name}`, p(esc(R.MARK_INFO[m].desc)) + (m === 'quick' ? p(`<small class="muted">${L(`คูลดาวน์ ×${QUICK_MARK}`, `cooldown ×${QUICK_MARK}`)}</small>`) : ''), m);

  // ---------- 8. shop tools ----------
  add('shop', 'wish', L('🌙 พรจันทร์', '🌙 Moon wish'),
    p(L(`ใช้เงินที่เหลือ: ราคาเริ่ม ${R.WISH_BASE} และแพงขึ้น +2 ทุกครั้งในวันเดียวกัน · สุ่ม skill และทางให้ (ช่องเดิม โบนัสเดิม)`, `For spare gold: starts at ${R.WISH_BASE}, +2 for each wish already made that day · picks the skill and branch at random (same slot, same bonuses)`)) +
    ul([
      L('<b>ให้อัปเกรด</b>: ถ้ายังมี skill ต่ำกว่า Lv3 พรจะอัปตัวหนึ่งขึ้น 1 ขั้น', '<b>Gives an upgrade</b>: while any skill is below Lv3, the wish levels one of them up'),
      L(`<b>ให้ตรา</b>: เฉพาะเมื่อ <b>ทุก</b> skill ที่มีอยู่ Lv3 แล้ว · ใส่ตราให้ skill ที่ยังไม่มีตรา · แพงขึ้น +${R.MARK_WISH_EXTRA} · ได้ ${R.WISH_MARKS_MAX} ครั้งต่อรอบ`, `<b>Gives a mark</b>: only once <b>every</b> skill you own is Lv3 · it marks a skill without one · costs +${R.MARK_WISH_EXTRA} · ${R.WISH_MARKS_MAX} times a run`),
      L('ซื้อ skill ใหม่ (Lv1) แล้ว พรจะกลับไปให้อัปเกรดจนกว่าตัวนั้นจะ Lv3 เหมือนกัน', 'Buy a new (Lv1) skill and the wish goes back to upgrades until that one is Lv3 too'),
      L('การ์ดพรบอกไว้ก่อนซื้อเสมอว่าจะให้อะไร', 'The wish card always says which one you get before you buy'),
    ]), 'wish mark upgrade');
  add('shop', 'reroll', L('🎲 สุ่มใหม่ และ 🔒 ล็อก', '🎲 Reroll and 🔒 lock'),
    p(L(`สุ่มการ์ดใหม่ ${R.REROLL} เงิน (วันแรกเป็นร้านประจำฮีโร่ สุ่มไม่ได้) · ล็อกการ์ดได้ฟรี การ์ดที่ล็อกอยู่ต่อแม้สุ่มใหม่หรือข้ามวัน`, `New cards for ${R.REROLL} gold (day 1 is your hero's fixed shop) · locking is free: a locked card stays through rerolls and into the next day`)), 'reroll lock');
  add('shop', 'slot', L('＋ ช่อง skill', '＋ Skill slot'),
    p(L(`ช่องถาวรทั้งรอบ ราคา ${R.slotPrice({ slotBuys: 0 } as R.RunState)}, ${R.slotPrice({ slotBuys: 1 } as R.RunState)}, ${R.slotPrice({ slotBuys: 2 } as R.RunState)} … (สูงสุด ${R.MAX_SLOTS} ช่อง) · ซื้อได้เมื่อช่องเต็มแล้วเท่านั้น`, `A slot for the whole run: ${R.slotPrice({ slotBuys: 0 } as R.RunState)}, ${R.slotPrice({ slotBuys: 1 } as R.RunState)}, ${R.slotPrice({ slotBuys: 2 } as R.RunState)} … (up to ${R.MAX_SLOTS}) · only when every slot is filled`)), 'slot');
  add('shop', 'sell', L('ขาย', 'Selling'),
    p(L('ขายคืนได้ Lv1 = 1, Lv2 = 2, Lv3 = 3 และ +1 ต่อดาว · ลากลงโหลหรือกดปุ่มขาย', 'Selling refunds 1 / 2 / 3 by level, +1 per star · drag into the jar or press Sell')), 'sell refund');

  // ---------- 9. status ----------
  for (const [k, x] of Object.entries(KEYWORDS) as [Keyword, (typeof KEYWORDS)[Keyword]][]) add('status', k, `${x.icon} ${x.name}`, p(esc(x.desc)), k);
  add('status', 'fatigue', L('😮‍💨 เหนื่อยล้า', '😮‍💨 Fatigue'),
    p(L(`ถ้าสู้นานเกินไป ทั้งสองฝ่ายเสียเลือดเพิ่มขึ้นทุกวินาที (วินาทีที่ n เสีย n × ${fatigueStep(10)} ในวันที่ 10) · เริ่ม ${byDay((d) => fatigueStart(d) / 10, 14, ' วิ')}`, `If a fight runs long, both sides lose more HP every second (second n costs n × ${fatigueStep(10)} on day 10) · starts ${byDay((d) => fatigueStart(d) / 10, 14, 's')}`)), 'fatigue');
  add('status', 'control', L('เพดานการคุม', 'Control cap'),
    p(L(`แช่แข็งรวมต่อการสู้ไม่เกิน ${byDay((d) => freezeCap(d) / 10, 10, ' วิ')} · ชำระล้างไฟ/พิษได้สูงสุด ${CLEANSE_MAX} กองต่อครั้ง`, `Total freeze per fight is capped: ${byDay((d) => freezeCap(d) / 10, 10, 's')} · a cleanse removes at most ${CLEANSE_MAX} burn/poison stacks`)), 'freeze cap cleanse');
  return E;
}

// ---------- overlay ----------
let $box: HTMLElement | null = null;
let sec: Sec = 'run';
let query = '';
let lineFilter: Line | 'all' = 'all';
let entries: Entry[] = [];
let lastFocus: HTMLElement | null = null;

function entryHTML(e: Entry, showSec = false) {
  return `<article class="cx-entry" id="cx-${e.sec}-${e.id}" data-id="${e.sec}:${e.id}"><h3>${showSec ? `<small class="cx-from">${SEC_ICON[e.sec]} ${secName(e.sec)}</small>` : ''}${e.title}</h3>${e.html}</article>`;
}
function bodyHTML() {
  const q = query.trim().toLowerCase();
  if (q) {
    const hits = entries.filter((e) => q.split(/\s+/).every((w) => e.keys.includes(w)));
    return hits.length ? `<p class="cx-count">${L(`พบ ${hits.length} หัวข้อ`, `${hits.length} found`)}</p>${`<div class="cx-list">${hits.slice(0, 40).map((e) => entryHTML(e, true)).join('')}</div>`}` : `<p class="cx-empty">${L('ไม่พบ ลองคำอื่น เช่น "ไฟ" "ดาว" "ตรา"', 'Nothing found: try "burn", "star" or "mark"')}</p>`;
  }
  let list = entries.filter((e) => e.sec === sec);
  let filter = '';
  if (sec === 'skills') {
    filter = `<div class="cx-filter" role="group">${(['all', ...LINES] as const).map((l) => `<button class="cx-chip${lineFilter === l ? ' on' : ''}" data-cx-line="${l}">${l === 'all' ? L('ทั้งหมด', 'All') : `${LINE_ICON[l]} ${esc(LINE_NAME[l])}`}</button>`).join('')}</div>`;
    if (lineFilter !== 'all') list = list.filter((e) => e.id === 'rarity' || SKILLS[e.id]?.line === lineFilter);
  }
  if (sec === 'relics') {
    // group the relic list by line (about first)
    const order = [...LINES, 'any', 'cheese'];
    list = [list[0], ...list.slice(1).sort((a, b) => order.indexOf(RELICS.find((x) => x.id === a.id)!.group) - order.indexOf(RELICS.find((x) => x.id === b.id)!.group))];
  }
  return `<h2 class="cx-sech">${SEC_ICON[sec]} ${secName(sec)}</h2>${filter}<div class="cx-list">${list.map((e) => entryHTML(e)).join('')}</div>`;
}
function draw(keepScroll = false) {
  if (!$box) return;
  const body = $box.querySelector<HTMLElement>('.cx-body');
  const top = body?.scrollTop ?? 0;
  $box.querySelector('.cx-tabs')!.innerHTML = SECS.map((s) => `<button class="cx-tab${s === sec && !query ? ' on' : ''}" data-cx-sec="${s}" aria-pressed="${s === sec && !query}"><span aria-hidden="true">${SEC_ICON[s]}</span> ${secName(s)}</button>`).join('');
  if (body) {
    body.innerHTML = bodyHTML();
    body.scrollTop = keepScroll ? top : 0;
  }
}
function frame() {
  const q = $box!.querySelector<HTMLInputElement>('.cx-q');
  $box!.querySelector('.cx-title')!.textContent = L('📖 คู่มือ', '📖 Codex');
  if (q) {
    q.placeholder = L('ค้นหา: ไฟ, ดาว, หมาป่า…', 'Search: burn, star, wolf…');
    q.setAttribute('aria-label', L('ค้นหาในคู่มือ', 'Search the codex'));
  }
  $box!.querySelector('.cx-x')!.textContent = L('ปิด ✕', 'Close ✕');
}

/** Open the codex, at a section or an entry (`relic:bastion`, `mark:echo`, `skill:frost`, `hero:knight`, `stars` …). */
export function openCodex(target = '') {
  entries = build();
  query = '';
  let focus = '';
  const [kind, id] = target.split(':');
  const MAP: Record<string, Sec> = { relic: 'relics', mark: 'marks', skill: 'skills', hero: 'heroes', star: 'stars', stars: 'stars', rarity: 'skills', wish: 'shop', line: 'lines' };
  if ((SECS as string[]).includes(kind)) sec = kind as Sec;
  else if (MAP[kind]) sec = MAP[kind];
  if (kind === 'rarity') focus = 'skills:rarity';
  else if (id) focus = `${sec}:${id}`;
  if (sec === 'skills' && id && SKILLS[id]) lineFilter = SKILLS[id].line === 'none' ? 'all' : SKILLS[id].line;
  if (!$box) {
    $box = document.createElement('div');
    $box.className = 'cx-modal modal';
    $box.setAttribute('role', 'dialog');
    $box.setAttribute('aria-modal', 'true');
    $box.innerHTML = `<div class="cx-box"><div class="cx-head"><b class="cx-title"></b><input class="cx-q" type="search" autocomplete="off"><button class="cx-x small ghost"></button></div><nav class="cx-tabs"></nav><div class="cx-body" tabindex="-1"></div></div>`;
    $box.addEventListener('click', onClick);
    $box.querySelector('.cx-q')!.addEventListener('input', (ev) => {
      query = (ev.target as HTMLInputElement).value;
      draw();
    });
    document.body.appendChild($box);
  }
  lastFocus = document.activeElement as HTMLElement | null;
  // out of the page while closed (it shares the .modal look with the game's other windows, which tests look for)
  if (!$box.isConnected) document.body.appendChild($box);
  $box.hidden = false;
  document.body.classList.add('cx-on');
  frame();
  $box.querySelector<HTMLInputElement>('.cx-q')!.value = '';
  draw();
  const el = focus ? $box.querySelector<HTMLElement>(`[data-id="${CSS.escape(focus)}"]`) : null;
  if (el) {
    el.classList.add('cx-hit');
    el.querySelector('details')?.setAttribute('open', '');
    requestAnimationFrame(() => el.scrollIntoView({ block: 'start' }));
  }
  ($box.querySelector<HTMLElement>('.cx-x'))?.focus({ preventScroll: true });
}
export function closeCodex() {
  if (!codexOpen()) return;
  $box!.hidden = true;
  $box!.remove();
  document.body.classList.remove('cx-on');
  lastFocus?.focus?.({ preventScroll: true });
}
export const codexOpen = () => !!$box && $box.isConnected && !$box.hidden;

function onClick(ev: MouseEvent) {
  const t = ev.target as HTMLElement;
  if (t === $box || t.closest('.cx-x')) return closeCodex();
  const s = t.closest<HTMLElement>('[data-cx-sec]');
  if (s) {
    sec = s.dataset.cxSec as Sec;
    query = '';
    $box!.querySelector<HTMLInputElement>('.cx-q')!.value = '';
    return draw();
  }
  const l = t.closest<HTMLElement>('[data-cx-line]');
  if (l) {
    lineFilter = l.dataset.cxLine as Line | 'all';
    return draw(true);
  }
}

/** Entry points: the header button, and a click on any [data-codex] anywhere (captured before the game's handlers). */
export function initCodex() {
  const header = document.querySelector('header');
  if (header && !header.querySelector('.cx-open')) {
    const b = document.createElement('button');
    b.className = 'cx-open small ghost';
    const paint = () => {
      b.innerHTML = `<span aria-hidden="true">📖</span> <span class="hb-l">${L('คู่มือ', 'Codex')}</span>`;
      b.setAttribute('aria-label', L('คู่มือ', 'Codex'));
      b.title = L('คู่มือ: ทุกอย่างในเกมอธิบายไว้ที่นี่', 'Codex: everything in the game, explained');
    };
    paint();
    b.addEventListener('click', () => openCodex());
    const tut = header.querySelector('.tut-open');
    if (tut) header.insertBefore(b, tut);
    else header.appendChild(b);
    onLang(() => {
      paint();
      if (codexOpen()) {
        entries = build();
        frame();
        draw(true);
      }
    });
  }
  document.addEventListener(
    'click',
    (ev) => {
      const el = (ev.target as Element).closest?.<HTMLElement>('[data-codex]');
      if (!el || el.closest('.drag-ghost')) return;
      ev.preventDefault();
      ev.stopPropagation();
      document.querySelector<HTMLElement>('.tooltip')?.style.setProperty('display', 'none');
      openCodex(el.dataset.codex);
    },
    true,
  );
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && codexOpen()) {
      ev.stopPropagation();
      closeCodex();
    }
  }, true);
}
