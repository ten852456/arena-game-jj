// Farm (idle town) screens: the resource bar, the lumber yard / mine / shrine cards, the arena gate (runs left,
// tickets), hero unlocks, the work egg and the season monument. Rules live in src/sim/farm.ts; the server decides
// everything (src/server/farm.ts) and this file only shows its answer and sends actions.
import { api, type FarmBuilding, type FarmOpReq, type FarmView, type FeedRow } from './api';
import { IMAGES } from './assets';
import { L } from '../i18n';
import { HEROES, HEROES_BY_ID } from '../sim/heroes';
import { LINE_ICON } from '../sim/skills';
import * as F from '../sim/farm';
import * as M from './views/meta';

export let farm: FarmView | null = null;
export let feed: FeedRow[] = [];
/** local time when `farm` arrived (the countdowns run from it) */
let gotAt = 0;
let loading: Promise<void> | null = null;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const name = (h: string) => HEROES_BY_ID[h]?.name ?? h;

/** Fetch the farm (the town calls this on entry and the timer refreshes it). */
export function loadFarm(onDone?: () => void): Promise<void> {
  loading ??= Promise.all([api.farm(M.playerId()), api.feed().catch(() => ({ rows: [] as FeedRow[] }))])
    .then(([f, fd]) => {
      farm = f;
      feed = fd.rows;
      gotAt = Date.now();
    })
    .catch(() => {
      /* server down: the town still works, without the farm */
    })
    .finally(() => {
      loading = null;
      onDone?.();
    });
  return loading;
}

/** Heroes the hero pick may offer (null: no farm data or the gate is off → every hero). */
// owned + today's rotation (the server also accepts yesterday's rotation, for a run picked just before midnight)
export const usablePool = (): string[] | null => (farm && farm.runLimit ? [...new Set([...farm.owned, ...farm.rotation])] : null);
/** ranked needs a ticket (casual is always free) */
export const outOfRuns = () => !!farm && farm.runLimit && farm.runsLeft <= 0;
export const rankedTickets = () => (farm ? farm.runsLeft : 0);

// ---------- icons ----------
const IMG = IMAGES as unknown as Record<string, string | undefined>;
const ICON: Record<string, [string, string]> = {
  wood: ['resWood', '🪵'], ore: ['resOre', '🪨'], crystal: ['resCrystal', '💎'], ticket: ['ticket', '🎟️'],
  stardust: ['stardust', '✨'], egg: ['egg', '🥚'], eggReady: ['eggCracking', '🐣'], monument: ['monument', '🗿'],
};
export function resIcon(k: string, big = false) {
  const [key, emoji] = ICON[k] ?? ['', '•'];
  const src = IMG[key];
  return src ? `<img class="ficon${big ? ' big' : ''}" src="${src}" alt="" aria-hidden="true">` : `<span class="ficon e${big ? ' big' : ''}" aria-hidden="true">${emoji}</span>`;
}
const RES_NAME: Record<string, [string, string]> = {
  wood: ['ไม้', 'wood'], ore: ['แร่', 'ore'], crystal: ['คริสตัล', 'crystal'], stardust: ['ผงดาว', 'stardust'], ticket: ['ตั๋ว', 'tickets'],
};
const resName = (k: string) => L(...(RES_NAME[k] ?? [k, k]));
const costHTML = (c: Partial<Record<string, number>>, have?: Record<string, number>) =>
  Object.entries(c)
    .filter(([, v]) => v)
    .map(([k, v]) => `<span class="fcost${have && (have[k] ?? 0) < (v ?? 0) ? ' short' : ''}">${resIcon(k)}${v}</span>`)
    .join(' ');
const have = (f: FarmView) => ({ ...f.res, stardust: f.stardust });

// ---------- resource bar ----------
export function farmBarHTML(): string {
  const f = farm;
  if (!f) return '';
  const pill = (k: 'wood' | 'ore' | 'crystal') =>
    `<span class="fpill${f.res[k] >= f.caps[k] ? ' full' : ''}" title="${resName(k)} ${f.res[k]}/${f.caps[k]}">${resIcon(k)}<b>${f.res[k]}</b></span>`;
  const runs = f.runLimit
    ? `<span class="fpill runs" title="${L('รอบฟรีที่เหลือ + ตั๋ว', 'free runs left + tickets')}">⚔️<b>${f.free}</b><small>${L('ฟรี', 'free')}</small> ${resIcon('ticket')}<b>${f.tickets}</b></span>`
    : '';
  const boost =
    f.newbie > 0 || f.headStart > 0
      ? `<span class="fpill boost" title="${L('ผลผลิตเพิ่ม', 'production boost')}">⬆ +${Math.round((f.newbie + f.headStart) * 100)}%</span>`
      : '';
  const stamps = `<span class="fpill stamps" title="${L(`การ์ดสะสมวัน: เข้าเล่นวันไหนก็ได้ ${F.STAMPS} วัน (ไม่ต้องติดกัน) ได้คริสตัล ${F.STAMP_REWARD.crystal} + ฟักไข่เร็วขึ้น`, `Day card: play any ${F.STAMPS} days (not in a row) for ${F.STAMP_REWARD.crystal} crystal + egg hours`)}">📅<b>${f.stamps}/${F.STAMPS}</b>${f.stampedToday ? '✓' : ''}</span>`;
  const ro = f.rollover;
  const note = ro
    ? `<p class="fwarn">${L(
        `ซีซั่น ${esc(ro.from)} จบแล้ว: ของเกินคลังกลายเป็นแต้มอนุสาวรีย์ ${ro.excess} · ตั๋วหมดอายุ ${ro.tickets} ใบ${ro.head ? ` · เริ่มซีซั่นใหม่ผลผลิต +${Math.round(ro.head * 100)}%` : ''}${ro.damaged ? ' · ภัยพิบัติทำให้อาคารเสียหาย 1 แห่ง' : ''}`,
        `Season ${esc(ro.from)} ended: resources over the warehouse became ${ro.excess} monument points · ${ro.tickets} tickets expired${ro.head ? ` · head start +${Math.round(ro.head * 100)}% output` : ''}${ro.damaged ? ' · the calamity damaged one landmark' : ''}`,
      )}</p>`
    : '';
  return `${note}<div class="farm-bar">${pill('wood')}${pill('ore')}${pill('crystal')}<span class="fpill">${resIcon('stardust')}<b>${f.stardust}</b></span>${runs}${stamps}${boost}</div>`;
}

// ---------- landmarks ----------
const fmtLeft = (ms: number) => {
  if (ms <= 0) return L('เต็มแล้ว', 'full');
  const m = Math.ceil(ms / 60_000);
  return m >= 60 ? L(`เต็มใน ${Math.floor(m / 60)} ชม. ${m % 60} น.`, `full in ${Math.floor(m / 60)}h ${m % 60}m`) : L(`เต็มใน ${m} น.`, `full in ${m}m`);
};

/** Ticks the "full in …" countdowns between server refreshes. */
export function tickFarm(root: ParentNode) {
  root.querySelectorAll<HTMLElement>('[data-full-at]').forEach((el) => {
    el.textContent = fmtLeft(Number(el.dataset.fullAt) - Date.now());
  });
}

export function landmarkHTML(b: FarmBuilding, heroArt: (id: string) => string): string {
  const f = farm;
  if (!f) return `<p class="muted">${L('กำลังโหลดเมือง…', 'Loading your town…')}</p>`;
  const res = F.RES_OF[b];
  const lv = f.lv[b];
  const jobs = f.jobs[b];
  const ready = jobs.reduce((a, j) => a + j.ready, 0);
  const fitsLines = F.AFFINITY[b].map((l) => LINE_ICON[l]).join(' ');
  const rows = jobs
    .map((j) => {
      const fullAt = gotAt + j.fullIn;
      return `<div class="fjob${j.fill >= 1 ? ' full' : ''}">${heroArt(j.hero)}<div class="fjob-main">
        <b>${esc(name(j.hero))}</b> <span class="fmastery" title="${L('ความชำนาญงานนี้: +1% ต่อเลเวล', 'Mastery at this job: +1% per level')}">${L('ชำนาญ', 'mastery')} ${j.mastery}</span>${j.fits ? ` <span class="ffit" title="${L('ถนัดงานนี้ +25%', 'fits this job +25%')}">★ +25%</span>` : ''}${j.fast ? ` <span class="ffit">${L('กะแรกเร็วพิเศษ!', 'speedy first shift!')}</span>` : ''}
        <div class="fbar"><i style="width:${Math.round(j.fill * 100)}%"></i></div>
        <small>${resIcon(res)} ${j.ready} · <span data-full-at="${fullAt}">${fmtLeft(j.fullIn)}</span></small></div>
        <button class="ghost small" data-a="farmRecall" data-i="${j.hero}">${L('เรียกกลับ', 'Recall')}</button></div>`;
    })
    .join('');
  const free = f.slots[b] - jobs.length;
  const idle = f.usable.filter((h) => !f.inRun.includes(h) && !F.BUILDING_IDS.some((x) => f.jobs[x].some((j) => j.hero === h)));
  // heroes whose line fits this landmark first
  idle.sort((a, c) => Number(F.fits(c, b)) - Number(F.fits(a, b)));
  const send = free > 0 && idle.length
    ? `<div class="fsend"><span class="muted">${L(`ส่งฮีโร่มาทำงาน (ว่าง ${free} ช่อง):`, `Send a hero (${free} free slot${free > 1 ? 's' : ''}):`)}</span>${idle
        .map((h) => `<button class="chip" data-a="farmSend" data-i="${b}" data-h="${h}">${F.fits(h, b) ? '★ ' : ''}${esc(name(h))}</button>`)
        .join('')}</div>`
    : free > 0
      ? `<p class="muted">${L('ไม่มีฮีโร่ว่าง', 'No free hero')}</p>`
      : '';
  // levels never end (incremental layer): Lv2–5 add slots and storage, Lv6+ add +15% output, ×2 every 10th level
  const cost = F.upgradeCost(lv);
  const multNow = F.levelMult(lv);
  const multNext = F.levelMult(lv + 1);
  const next = lv < F.TABLE_LV
    ? L(`Lv${lv + 1}: ${F.SLOTS[lv]} ช่อง · เก็บได้ ${F.STORAGE_H[lv]} ชม.`, `Lv${lv + 1}: ${F.SLOTS[lv]} slots · holds ${F.STORAGE_H[lv]} h`)
    : L(`Lv${lv + 1}: ผลผลิต ×${multNext.toFixed(2)} (ตอนนี้ ×${multNow.toFixed(2)})${(lv + 1 - F.TABLE_LV) % 10 === 0 ? ' · เลเวลสำคัญ: ×2!' : ''}`, `Lv${lv + 1}: output ×${multNext.toFixed(2)} (now ×${multNow.toFixed(2)})${(lv + 1 - F.TABLE_LV) % 10 === 0 ? ' · milestone: ×2!' : ''}`);
  const dmg = f.damaged === b
    ? `<p class="fwarn">${L('ภัยพิบัติจากซีซั่นก่อน: ผลิตได้ครึ่งเดียวจนกว่าจะซ่อม', "Last season's calamity: half output until repaired")} <button class="small" data-a="farmRepair">${L('ซ่อม', 'Repair')} ${costHTML(F.REPAIR_COST, have(f))}</button></p>`
    : '';
  return `<div class="flandmark">
    <p class="muted">Lv${lv}${multNow > 1 ? ` · ×${multNow.toFixed(2)}` : ''} · ${L(`${f.slots[b]} ช่อง · เก็บได้ ${F.STORAGE_H[Math.min(lv, F.TABLE_LV) - 1]} ชม. · ถนัด`, `${f.slots[b]} slot${f.slots[b] > 1 ? 's' : ''} · holds ${F.STORAGE_H[Math.min(lv, F.TABLE_LV) - 1]} h · suits`)} ${fitsLines} · ${L('คลัง', 'warehouse')} ${f.res[res]}/${f.caps[res]}</p>
    ${dmg}${rows}${send}
    <div class="actions">
      <button class="primary" data-a="farmCollect" data-i="${b}" ${ready ? '' : 'disabled'}>${L('เก็บ', 'Collect')} ${resIcon(res)} ${ready}</button>
      <button data-a="farmUpgrade" data-i="${b}" title="${next}">${L('อัปเกรด', 'Upgrade')} ${costHTML(cost, have(f))}</button>
    </div>
    <p class="muted small">${next}</p>
  </div>`;
}

// ---------- arena gate ----------
export function arenaGateHTML(): string {
  const f = farm;
  if (!f || !f.runLimit) return '';
  const canCraft = f.crafted < F.TICKET_CRAFT_CAP && f.tickets < F.TICKET_HOLD;
  return `<div class="fgate">
    <p>${L(`ทั่วไป: ฟรี ไม่จำกัด · แรงค์: ตั๋วฟรี <b>${f.free}</b> (วันละ ${F.FREE_RUNS} สะสมได้ ${F.FREE_BANK}) + ตั๋วที่ทำ <b>${f.tickets}</b>/${F.TICKET_HOLD} · ชนะ ${F.RANKED_REFUND_WINS}+ ได้ตั๋วคืน`, `Casual: free, unlimited · Ranked: free tickets <b>${f.free}</b> (${F.FREE_RUNS} a day, bank ${F.FREE_BANK}) + crafted <b>${f.tickets}</b>/${F.TICKET_HOLD} · ${F.RANKED_REFUND_WINS}+ wins refunds the ticket`)}</p>
    <div class="actions"><button data-a="farmCraft" ${canCraft ? '' : 'disabled'}>${L('ทำตั๋ว', 'Craft a ticket')} ${costHTML(F.TICKET_COST, have(f))}</button>
    <span class="muted">${L(`วันนี้ทำแล้ว ${f.crafted}/${F.TICKET_CRAFT_CAP}`, `crafted today ${f.crafted}/${F.TICKET_CRAFT_CAP}`)}</span></div>
  </div>`;
}

// ---------- hero hall: unlocks, rotation ----------
export function hallFarmHTML(): string {
  const f = farm;
  if (!f) return '';
  const locked = HEROES.filter((h) => !f.owned.includes(h.id));
  if (!locked.length) return `<p class="muted">${L('คุณมีฮีโร่ครบทุกตัวแล้ว', 'You own every hero')}</p>`;
  return `<div class="funlock"><h4>${L('ปลดล็อกฮีโร่', 'Unlock heroes')}</h4>
    <p class="muted">${L(`ฟรีวันนี้: ${f.rotation.map(name).join(', ')} · ฮีโร่ทุกตัวราคาเท่ากัน แรงเท่ากันทุกคน`, `Free today: ${f.rotation.map(name).join(', ')} · every hero costs the same and is equally strong for everyone`)}</p>
    ${locked
      .map((h) => `<div class="funl"><b>${h.name}</b>${f.rotation.includes(h.id) ? ` <span class="ffit">${L('ฟรีวันนี้', 'free today')}</span>` : ''}
        <button class="small" data-a="farmUnlock" data-i="${h.id}">${L('ปลดล็อก', 'Unlock')} ${costHTML(F.UNLOCK_COST, have(f))}</button></div>`)
      .join('')}</div>`;
}

// ---------- work egg ----------
export function eggHTML(): string {
  const f = farm;
  if (!f) return '';
  const egg = f.eggs[0];
  const odds = f.odds;
  const item = (id: string) => F.EGG_POOL.find((x) => x.id === id);
  const oddsHTML = odds.length
    ? `<details><summary>${L('ดูโอกาส (ไม่มีของซ้ำ)', 'See the odds (no duplicates)')}</summary><ul class="fodds">${odds
        .map((o) => `<li>${item(o.id)?.rare ? '⭐ ' : ''}${esc(L(item(o.id)?.th ?? o.id, item(o.id)?.en ?? o.id))}: ${(o.p * 100).toFixed(1)}%</li>`)
        .join('')}</ul><p class="muted small">${L(`การันตีของหายากภายใน ${F.EGG_PITY} ฟอง (ตอนนี้ ${f.pity}) · ไข่ได้จากการเล่นเท่านั้น ไม่ขาย ไม่แลก`, `A rare is guaranteed within ${F.EGG_PITY} eggs (now ${f.pity}) · eggs come from play only, never sold or traded`)}</p></details>`
    : `<p class="muted">${L('สะสมครบทุกชิ้นแล้ว!', 'Collection complete!')}</p>`;
  const body = egg
    ? `<div class="fegg">${resIcon(egg.h >= egg.need ? 'eggReady' : 'egg', true)}<div><b>${L('ไข่งาน', 'Work egg')}</b> ${f.eggs.length > 1 ? L(`(+${f.eggs.length - 1} รอในรัง)`, `(+${f.eggs.length - 1} waiting)`) : ''}
        <div class="fbar"><i style="width:${Math.min(100, Math.round((egg.h / egg.need) * 100))}%"></i></div>
        <small>${L(`ชั่วโมงทำงานของฮีโร่ ${Math.floor(egg.h)}/${egg.need}`, `hero work-hours ${Math.floor(egg.h)}/${egg.need}`)}</small></div>
        <button class="primary" data-a="farmHatch" ${egg.h >= egg.need ? '' : 'disabled'}>${L('ฟัก!', 'Hatch!')}</button></div>`
    : `<p class="muted">${L(`ชนะ ${F.EGG_WINS.join(' และ ')} ครั้งในรอบเดียวเพื่อได้ไข่ · ไข่ฟักจากชั่วโมงทำงานของฮีโร่ในเมือง`, `Win ${F.EGG_WINS.join(' and ')} fights in a run for an egg · eggs hatch from your heroes' work-hours`)}</p>`;
  const got = f.cosmetics.length ? `<p class="small">${L('ของที่มี:', 'Collected:')} ${f.cosmetics.map((c) => esc(L(item(c)?.th ?? c, item(c)?.en ?? c))).join(' · ')}</p>` : '';
  return `<div class="fnest"><h4>${L('รังไข่', 'Egg nest')}</h4>${body}${oddsHTML}${got}</div>`;
}

// ---------- season monument ----------
export function monumentHTML(): string {
  const f = farm;
  if (!f) return '';
  const m = f.monument;
  const pct = (x: number) => Math.min(100, Math.round((x / m.tiers[m.tiers.length - 1]) * 100));
  const tier = m.tiers.filter((t) => m.points >= t).length;
  const pour = (r: 'wood' | 'ore' | 'crystal', n: number) =>
    `<button class="small" data-a="farmPour" data-i="${r}" data-n="${n}" ${f.res[r] >= n ? '' : 'disabled'}>${resIcon(r)} ${n}</button>`;
  return `<div class="fmonument"><h4>${resIcon('monument')} ${L('อนุสาวรีย์ประจำซีซั่น', 'Season monument')}</h4>
    <p class="muted">${L(
      'ร่วมกันเติมทรัพยากรให้ถึงเป้า ก่อนสิ้นซีซั่น เพื่อปกป้องเมืองจากภัยพิบัติ · ยิ่งเติมมาก ซีซั่นหน้าเริ่มผลิตได้มากขึ้น (สูงสุด +30% และค่อยๆ ลดลงใน 2 สัปดาห์)',
      'Fill the monument together before the season ends to protect the towns from the calamity · the more you pour, the bigger your head start next season (up to +30%, fading over 2 weeks)',
    )}</p>
    <div class="fbar mono"><i style="width:${pct(m.points)}%"></i>${m.tiers.map((t, i) => `<em style="left:${pct(t)}%" title="${['🥉', '🥈', '🥇'][i]}">${['🥉', '🥈', '🥇'][i]}</em>`).join('')}</div>
    <small>${m.points.toLocaleString()} / ${m.goal.toLocaleString()} · ${L(`${m.players} คนร่วมเติม · รวมของขวัญผู้ปกครอง 20%`, `${m.players} players poured · includes the ruler's 20% gift`)}${tier ? ` · ${['🥉', '🥈', '🥇'][tier - 1]}` : ''}</small>
    <p>${L(`ของคุณ ${m.mine.toLocaleString()} แต้ม`, `Yours: ${m.mine.toLocaleString()} points`)}${m.mine >= m.minPersonal ? ` ✓ ${L('ได้ของรางวัลผู้ร่วมเติม และเมืองของคุณปลอดภัย', 'contributor reward earned, your town is safe')}` : ` · ${L(`เติมครบ ${m.minPersonal} แต้มเพื่อรับของรางวัลและกันเมืองเสียหาย`, `pour ${m.minPersonal} points for the contributor reward and to keep your town safe`)}`}</p>
    <div class="actions">${pour('wood', 50)}${pour('ore', 50)}${pour('crystal', 1)}</div></div>`;
}

// ---------- actions ----------
const ERR_TH: Record<string, string> = {
  'not enough resources': 'ทรัพยากรไม่พอ', 'no free slot': 'ไม่มีช่องว่าง', 'hero already working': 'ฮีโร่ทำงานอยู่แล้ว',
  'hero is in a run': 'ฮีโร่อยู่ในรอบที่เล่นค้าง', 'craft limit reached today': 'วันนี้ทำตั๋วครบแล้ว', 'ticket bag full': 'ถุงตั๋วเต็ม',
  'max level': 'เลเวลสูงสุดแล้ว', 'already owned': 'มีแล้ว', 'egg not ready': 'ไข่ยังไม่พร้อม', 'no egg': 'ไม่มีไข่',
};
const errText = (e: unknown) => {
  const m = /^\d+ (.*)$/s.exec(e instanceof Error ? e.message : String(e));
  let why = m ? m[1] : String(e);
  try { why = (JSON.parse(why) as { error?: string }).error ?? why; } catch { /* plain text */ }
  return L(ERR_TH[why] ?? why, why);
};

/** Run a farm button. Returns a toast (error or result) or '' . */
export async function farmAction(a: string, el: HTMLElement): Promise<string> {
  const i = el.dataset.i ?? '';
  let ops: FarmOpReq[] | null = null;
  switch (a) {
    case 'farmSend': ops = [{ op: 'send', b: i as FarmBuilding, hero: el.dataset.h ?? '' }]; break;
    case 'farmRecall': ops = [{ op: 'recall', hero: i }]; break;
    case 'farmCollect': ops = [{ op: 'collect', b: i as FarmBuilding }]; break;
    case 'farmCraft': ops = [{ op: 'collect' }, { op: 'craft', n: 1 }]; break;
    case 'farmUpgrade': ops = [{ op: 'upgrade', b: i as FarmBuilding }]; break;
    case 'farmUnlock': ops = [{ op: 'unlock', hero: i }]; break;
    case 'farmPour': ops = [{ op: 'pour', res: i as 'wood' | 'ore' | 'crystal', n: Number(el.dataset.n) || 0 }]; break;
    case 'farmRepair': ops = [{ op: 'repair' }]; break;
    case 'farmCollectAll': ops = [{ op: 'collect' }]; break;
    case 'farmFill': ops = fillOps(); if (!ops.length) return L('ไม่มีฮีโร่ว่างหรือช่องว่าง', 'No idle hero or free slot'); break;
    case 'farmPourFind': ops = [{ op: 'pourFind', id: i }]; break;
    case 'farmHatch':
      try {
        const r = await api.hatch(M.playerId());
        farm = r.farm;
        gotAt = Date.now();
        const it = F.EGG_POOL.find((x) => x.id === r.got);
        return it ? L(`ไข่ฟักแล้ว! ได้ ${it.th}`, `The egg hatched: ${it.en}!`) : L('ไข่ฟักแล้ว! (สะสมครบแล้ว)', 'The egg hatched! (collection complete)');
      } catch (e) {
        return errText(e);
      }
    default:
      return '';
  }
  try {
    const before = farm;
    farm = await api.farmOps(M.playerId(), ops);
    gotAt = Date.now();
    if (farm.found?.length) {
      void api.feed().then((fd) => (feed = fd.rows)).catch(() => {});
      return farm.found.map((id) => {
        const x = F.FINDS.find((y) => y.id === id);
        return x ? L(`✨ ของหายาก! ${x.th} (โอกาส 1 ใน ${Math.round(1 / x.odds)})`, `✨ Lucky find! ${x.en} (1 in ${Math.round(1 / x.odds)})`) : id;
      }).join(' · ');
    }
    if (a === 'farmCollect' && before) {
      const r = F.RES_OF[i as FarmBuilding];
      return L(`ได้${resName(r)} +${farm.res[r] - before.res[r]}`, `+${farm.res[r] - before.res[r]} ${resName(r)}`);
    }
    if (a === 'farmUnlock') return L(`ปลดล็อก ${name(i)} แล้ว!`, `${name(i)} unlocked!`);
    return '';
  } catch (e) {
    return errText(e);
  }
}

// ---------- one-tap helpers ----------
/** "Fill jobs": every idle hero to its best free slot (a landmark its line suits first). */
export function fillOps(): FarmOpReq[] {
  const f = farm;
  if (!f) return [];
  const idle = f.usable.filter((h) => !f.inRun.includes(h) && !F.BUILDING_IDS.some((x) => f.jobs[x].some((j) => j.hero === h)));
  // the same spread as the farm sim: every landmark works (sim/farm.ts fillPlan)
  const plan = F.fillPlan({ ...(F.newFarm(Date.now())), lv: f.lv, pass: f.pass, jobs: f.jobs as unknown as F.FarmState['jobs'] }, idle);
  return plan.map((p) => ({ op: 'send' as const, b: p.b, hero: p.hero }));
}
export const readyTotal = () => {
  const f = farm;
  const out = { wood: 0, ore: 0, crystal: 0 };
  if (f) for (const b of F.BUILDING_IDS) out[F.RES_OF[b]] += f.jobs[b].reduce((a, j) => a + j.ready, 0);
  return out;
};
export const idleCount = () => fillOps().length;

// ---------- lucky finds, moonlit heroes, town feed ----------
export function findsHTML(): string {
  const f = farm;
  if (!f) return '';
  const have = F.FINDS.filter((x) => (f.finds[x.id] ?? 0) > 0);
  const shinies = f.shinies.map(name).join(', ');
  return `<div class="ffinds"><h4>${L('ของหายากที่พบ', 'Lucky finds')}</h4>
    <p class="muted small">${L(`ฮีโร่ที่ทำงานมีโอกาสเจอของหายากทุกชั่วโมงทำงาน (วันละ ${F.FIND_ROLLS_PER_DAY} ครั้ง) · ใช้ทำของแต่ง หรือเติมอนุสาวรีย์ · ไม่เพิ่มพลังในการสู้`, `Working heroes roll for a rare find every work-hour (${F.FIND_ROLLS_PER_DAY} rolls a day) · craft looks or pour into the monument · never a fight bonus`)}</p>
    ${have.length ? have.map((x) => `<div class="funl"><b>${x.golden ? '🌟' : '✨'} ${esc(L(x.th, x.en))} ×${f.finds[x.id]}</b><button class="small" data-a="farmPourFind" data-i="${x.id}">${L('เติมอนุสาวรีย์', 'Pour')} +${F.FIND_POINTS[x.id]}</button></div>`).join('') : `<p class="muted small">${L('ยังไม่เจอ · โอกาส: ไข่มุกจันทร์ 1/400 (เหมือง ลานตัดไม้) · เศษวัตถุ 1/600 (ศาลเจ้า) · ไข่มุกทอง 1/8000', 'None yet · odds: Moon Pearl 1/400 (mine, lumber) · Relic Shard 1/600 (shrine) · Golden Pearl 1/8000')}</p>`}
    <p class="small">${L('ฮีโร่แสงจันทร์ (โอกาส 1/1024 ต่อรอบ):', 'Moonlit heroes (1 in 1024 per run):')} ${shinies || L('ยังไม่มี', 'none yet')}</p></div>`;
}

export function feedHTML(): string {
  if (!feed.length) return `<div class="ffeed"><h4>${L('ข่าวในเมือง', 'Town feed')}</h4><p class="muted small">${L('ยังไม่มีใครเจอของหายาก', 'No rare finds yet')}</p></div>`;
  const what = (r: FeedRow) => {
    if (r.kind === 'shiny') return L(`ได้ ${name(r.id)} แสงจันทร์ ✦`, `rolled a moonlit ${name(r.id)} ✦`);
    const x = F.FINDS.find((y) => y.id === r.id);
    return L(`เจอ ${x?.th ?? r.id}`, `found a ${x?.en ?? r.id}`);
  };
  return `<div class="ffeed"><h4>${L('ข่าวในเมือง', 'Town feed')}</h4><ul>${feed
    .slice(0, 8)
    .map((r) => `<li class="${r.first ? 'first' : ''}">${r.first ? `<b>${L('คนแรกของซีซั่น!', 'WORLD FIRST')}</b> · ` : ''}${esc(r.name)} ${what(r)}</li>`)
    .join('')}</ul></div>`;
}

/** a locked hero can be unlocked right now (the Hero Hall badge on the map) */
export const canUnlockAny = () =>
  !!farm && farm.owned.length < HEROES.length && farm.stardust >= F.UNLOCK_COST.stardust && farm.res.crystal >= F.UNLOCK_COST.crystal;
