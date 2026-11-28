// Account store screens (v5.1 build plan task 4): the Seal tray, the Seal stash, the Hero Book (Saves) in the Hero
// Hall, and the run-end receipt (line rank, the Seal offer, "Replace <hero>'s Save?"). Rules: src/shared/vault.ts;
// the server decides everything (src/server/routes/vault.ts) and this file only shows its answer and sends actions.
// Nothing here ever enters a run or a Ranked build (Arena equality).
import { api, type SealOfferView, type SealView, type VaultOpReq, type VaultView } from '../../app/api';
import { L } from '../../../shared/i18n';
import { LINE_RANK_C, SEAL_D_WINS, SEAL_C_WINS, TRAY_HOURS } from '../../../shared/vault';
import { HEROES_BY_ID } from '../../../sim/heroes';
import { lineLabel } from '../../../sim/skills';
import type { Line } from '../../../sim/types';
import * as M from '../records/meta';
import { esc } from '../../ui/html';
import { costHTML, farm } from './farmUI';

export let vault: VaultView | null = null;
let loading: Promise<void> | null = null;

const name = (h: string) => HEROES_BY_ID[h]?.name ?? h;
const have = () => ({ stardust: vault?.stardust ?? farm?.stardust ?? 0, crystal: vault?.crystal ?? farm?.res.crystal ?? 0 });

/** Fetch the store (the Hero Hall and the run-end receipt call this). */
export function loadVault(onDone?: () => void): Promise<void> {
  loading ??= api
    .vault(M.playerId())
    .then((v) => {
      vault = { ...v, stardust: farm?.stardust ?? v.stardust };
    })
    .catch(() => {
      /* server down: the hall still shows the heroes */
    })
    .finally(() => {
      loading = null;
      onDone?.();
    });
  return loading;
}

const hoursLeft = (t: number) => {
  const h = Math.max(0, (t - Date.now()) / 3_600_000);
  return h >= 1 ? L(`${Math.floor(h)} ชม.`, `${Math.floor(h)} h`) : L(`${Math.max(1, Math.round(h * 60))} นาที`, `${Math.max(1, Math.round(h * 60))} min`);
};
const gradeHTML = (g: 'D' | 'C') => `<b class="vgrade g-${g}">${g}</b>`;
const timingWord = (t: 'early' | 'late') => (t === 'early' ? L('ต้นตา', 'early') : L('ท้ายตา', 'late'));
/** "🛡 Shield Seal C · roll 7 · late" */
const sealLine = (s: { line: Line; grade: 'D' | 'C'; roll: number; timing: 'early' | 'late' }) =>
  `${gradeHTML(s.grade)} ${esc(lineLabel(s.line))} ${L('ตรา', 'Seal')} · ${L('ค่า', 'roll')} ${s.roll}/10 · ${timingWord(s.timing)}`;

function claimBtn(o: SealOfferView, v: VaultView) {
  const free = o.cost.stardust === 0 && o.cost.crystal === 0;
  const price = free ? L('ฟรี', 'free') : costHTML(o.cost, have());
  return `<button class="small primary" data-a="vaultClaim" data-i="${esc(o.id)}" ${v.claim.left ? '' : 'disabled'}>${L('รับตรา', 'Claim')} ${price}</button>`;
}

// ---------- Hero Hall ----------
export function trayHTML(): string {
  const v = vault;
  if (!v) return '';
  const head = `<h4>${L('ถาดตรา', 'Seal tray')} <small class="muted">${L(
    `วันละ 1 ใบ · ข้อเสนออยู่ ${TRAY_HOURS} ชม. · ตรา D ฟรีอีก ${v.claim.freeD} ใบ`,
    `1 a day · offers last ${TRAY_HOURS} h · ${v.claim.freeD} free D Seals left`,
  )}</small></h4>`;
  const wait = v.claim.left ? '' : `<p class="muted small">${L(`รับวันนี้แล้ว · รับใบต่อไปได้ในอีก ${hoursLeft(v.claim.next)}`, `Claimed today · the next claim opens in ${hoursLeft(v.claim.next)}`)}</p>`;
  const rows = v.tray.length
    ? v.tray
        .map(
          (o) => `<div class="voffer line-${o.line}"><span>${sealLine(o)}<br><small class="muted">${L(
            `จาก ${esc(name(o.hero))} ชนะ ${o.wins} · หมดใน ${hoursLeft(o.exp)}`,
            `from ${esc(name(o.hero))}, ${o.wins} wins · expires in ${hoursLeft(o.exp)}`,
          )}</small></span>${claimBtn(o, v)}</div>`,
        )
        .join('')
    : `<p class="muted small">${L(
        `ชนะ ${SEAL_D_WINS}+ ในรอบเดียว ได้ตรา D ของสายฮีโร่ตัวนั้น · ชนะ ${SEAL_C_WINS}+ และสายนั้นแรงค์ ${LINE_RANK_C} ได้ตรา C`,
        `Win ${SEAL_D_WINS}+ fights in a run for a D Seal of that hero's line · ${SEAL_C_WINS}+ wins with line rank ${LINE_RANK_C} for a C`,
      )}</p>`;
  return `<div class="fvault vtray">${head}${wait}${rows}</div>`;
}

function stashRow(s: SealView, owned: string[], seals: SealView[]) {
  const free = owned.filter((h) => !seals.some((x) => x.on === h));
  const action = s.on
    ? `<span class="small">${L('ใส่ให้', 'on')} <b>${esc(name(s.on))}</b></span> <button class="small" data-a="vaultUnequip" data-i="${esc(s.id)}">${L('ถอด', 'Take off')}</button>`
    : free.length
      ? `<span class="vequip">${free.map((h) => `<button class="small" data-a="vaultEquip" data-i="${esc(s.id)}" data-h="${esc(h)}">${esc(name(h))}</button>`).join('')}</span>`
      : `<span class="muted small">${L('ฮีโร่ทุกตัวมีตราแล้ว', 'every hero wears one')}</span>`;
  const tags = `${s.tradable ? `<span class="ffit">${L('ขายได้', 'tradable')}</span>` : `<span class="muted small">${L('ผูกบัญชี', 'bound')}</span>`} <small class="muted">${L(`ใช้ได้อีก ${s.uses}`, `${s.uses} uses`)}</small>`;
  return `<div class="voffer line-${s.line}"><span>${sealLine(s)} ${tags}</span>${action}</div>`;
}
export function stashHTML(): string {
  const v = vault;
  if (!v?.seals.length) return '';
  const owned = farm?.owned ?? [];
  return `<div class="fvault"><h4>${L('ตราที่มี', 'Your Seals')} <small class="muted">${v.seals.length}/30 · ${L('ฮีโร่ 1 ตัวใส่ได้ 1 ตรา · ใส่แล้วผูกบัญชี · ใช้ในหอเวท ไม่เข้าสนามประลอง', '1 per hero · equipping binds it · for the Tower, never in the Arena')}</small></h4>
    ${v.seals.map((s) => stashRow(s, owned, v.seals)).join('')}</div>`;
}
export function bookHTML(): string {
  const v = vault;
  if (!v) return '';
  const owned = farm?.owned ?? [];
  const heroes = [...new Set([...Object.keys(v.saves), ...Object.keys(v.pending)])];
  if (!heroes.length) return '';
  const row = (h: string) => {
    const s = v.saves[h];
    const p = v.pending[h];
    const cur = s ? L(`ชนะ ${s.wins} แพ้ ${s.losses} (${s.mode === 'ranked' ? 'แรงค์' : 'ทั่วไป'})`, `${s.wins} W ${s.losses} L (${s.mode})`) : L('ยังไม่มี', 'none yet');
    const ask = p ? replaceAsk(h, s, p, owned.includes(h)) : '';
    return `<div class="vsave"><b>${esc(name(h))}</b> <span class="small">${cur}</span>${ask}</div>`;
  };
  return `<div class="fvault"><h4>${L('สมุดฮีโร่', 'Hero Book')} <small class="muted">${L('build ที่เก็บไว้ของฮีโร่แต่ละตัว ใช้เป็นทีมในหอเวท', 'one kept build per hero: your Tower roster')}</small></h4>${heroes.map(row).join('')}</div>`;
}
/** "Replace Witch's Save (4 wins) with this run (6 wins)?" (or: adopt the hero first) */
function replaceAsk(h: string, s: VaultView['saves'][string] | undefined, p: VaultView['pending'][string], owned: boolean) {
  if (!owned)
    return `<p class="small">${L(`รอบล่าสุด (ชนะ ${p.wins}) รอไว้ · รับ ${esc(name(h))} ที่หอฮีโร่ก่อนจึงจะเก็บได้`, `The last run (${p.wins} wins) is waiting · adopt ${esc(name(h))} in the Hero Hall to keep it`)}</p>`;
  const q = s
    ? L(`แทน build ของ ${esc(name(h))} (ชนะ ${s.wins}) ด้วยรอบนี้ (ชนะ ${p.wins})?`, `Replace ${esc(name(h))}'s Save (${s.wins} wins) with this run (${p.wins} wins)?`)
    : L(`เก็บรอบนี้ (ชนะ ${p.wins}) เป็น build ของ ${esc(name(h))}?`, `Keep this run (${p.wins} wins) as ${esc(name(h))}'s Save?`);
  return `<p class="vask small">${q} <button class="small primary" data-a="vaultKeep" data-i="${esc(h)}">${s ? L('แทนที่', 'Replace') : L('เก็บ', 'Keep')}</button><button class="small" data-a="vaultDrop" data-i="${esc(h)}">${s ? L('เก็บของเดิม', 'Keep the old one') : L('ไม่เก็บ', 'Skip')}</button></p>`;
}
export const hallVaultHTML = () => trayHTML() + stashHTML() + bookHTML();

// ---------- run-end receipt ----------
/**
 * The run-end receipt's v5.1 lines: line rank gained, the Seal offer (now in the tray, claim it here), and the Save
 * ("Replace <hero>'s Save?"). `r`: the finish result of this run; empty when there is nothing to show.
 */
export function receiptHTML(hero: string, runId: string, r: M.FinishRunResult | null | undefined): string {
  if (!r) return '';
  const v = vault;
  const line = HEROES_BY_ID[hero]?.line as Line | undefined;
  const parts: string[] = [];
  if (r.lineRank && line) {
    const now = v?.lineRank[line];
    parts.push(`<p>${esc(lineLabel(line))} ${L('แรงค์สาย', 'line rank')} <b>+${r.lineRank}</b>${now !== undefined ? ` · ${now}/${LINE_RANK_C}${now >= LINE_RANK_C ? ` ${L('(ปลดตรา C แล้ว)', '(C Seals unlocked)')}` : ''}` : ''}</p>`);
  }
  if (r.seal) {
    const o = v?.tray.find((x) => x.id === r.seal!.id);
    const act = !v
      ? ''
      : o
        ? v.claim.left
          ? claimBtn(o, v)
          : `<small class="muted">${L(`รับวันนี้แล้ว · ตราใบนี้รออยู่ในถาด ${hoursLeft(o.exp)}`, `Claimed today · it waits in the tray for ${hoursLeft(o.exp)}`)}</small>`
        : v.seals.some((s) => s.line === r.seal!.line && s.roll === r.seal!.roll && s.grade === r.seal!.grade)
          ? `<small>✓ ${L('รับแล้ว', 'claimed')}</small>`
          : '';
    parts.push(`<div class="voffer line-${r.seal.line}"><span>${sealLine(r.seal)}<br><small class="muted">${L('ไปอยู่ในถาดตราที่หอฮีโร่แล้ว', 'added to your Seal tray in the Hero Hall')}</small></span>${act}</div>`);
  }
  if (r.saved) parts.push(`<p>✓ ${L(`เก็บ build นี้ลงสมุดฮีโร่ของ ${esc(name(hero))} แล้ว`, `Saved to ${esc(name(hero))}'s Hero Book page`)}</p>`);
  else if (v?.pending[hero]?.runId === runId) parts.push(replaceAsk(hero, v.saves[hero], v.pending[hero], (farm?.owned ?? []).includes(hero)));
  return parts.length ? `<div class="re-vault fvault">${parts.join('')}</div>` : '';
}

// ---------- actions ----------
const ERR_TH: Record<string, string> = {
  'claimed today': 'วันนี้รับตราไปแล้ว', 'not enough stardust': 'ผงดาวไม่พอ', 'not enough crystal': 'คริสตัลไม่พอ',
  'stash full': 'ช่องเก็บตราเต็ม', 'no such offer': 'ข้อเสนอนี้หมดเวลาแล้ว', 'slot taken': 'ฮีโร่ตัวนี้มีตราแล้ว',
  'hero not owned': 'ยังไม่มีฮีโร่ตัวนี้', 'nothing stored yet: finish a run first': 'ยังไม่มีของ: เล่นให้จบสักรอบก่อน',
};
const errText = (e: unknown) => {
  const m = /^\d+ (.*)$/s.exec(e instanceof Error ? e.message : String(e));
  let why = m ? m[1] : String(e);
  try { why = (JSON.parse(why) as { error?: string }).error ?? why; } catch { /* plain text */ }
  return L(ERR_TH[why] ?? why, why);
};

/** Run a store button (data-a="vault…"). Returns a toast (error or result) or ''. */
export async function vaultAction(a: string, el: HTMLElement): Promise<string> {
  const i = el.dataset.i ?? '';
  let op: VaultOpReq;
  switch (a) {
    case 'vaultClaim': op = { op: 'claim', id: i }; break;
    case 'vaultEquip': op = { op: 'equip', id: i, hero: el.dataset.h ?? '' }; break;
    case 'vaultUnequip': op = { op: 'unequip', id: i }; break;
    case 'vaultKeep': op = { op: 'keepSave', hero: i }; break;
    case 'vaultDrop': op = { op: 'dropPending', hero: i }; break;
    default: return '';
  }
  try {
    const before = vault;
    vault = await api.vaultOps(M.playerId(), [op]);
    if (farm && vault.stardust !== undefined) {
      farm.stardust = vault.stardust;
      farm.res.crystal = vault.crystal;
    }
    if (a === 'vaultClaim') {
      const got = vault.seals.find((s) => !before?.seals.some((x) => x.id === s.id));
      return got ? L(`ได้ตรา ${got.grade} ${lineLabel(got.line)} แล้ว!`, `${lineLabel(got.line)} ${got.grade} Seal claimed!`) : '';
    }
    if (a === 'vaultKeep') return L(`เก็บลงสมุดฮีโร่ของ ${name(i)} แล้ว`, `Saved to ${name(i)}'s Hero Book page`);
    return '';
  } catch (e) {
    return errText(e);
  }
}
