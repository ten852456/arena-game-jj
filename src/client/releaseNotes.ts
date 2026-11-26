// Release notes and the "new version" notice. The version comes from package.json (vite define __APP_VERSION__);
// the server answers GET /api/version with the version it is running, so an open tab learns about a deploy.
// Add a NOTES entry (newest first) with every version bump: it is what players see in "What's new".
import { L, getLang } from '../i18n';
import { esc } from './html';

declare const __APP_VERSION__: string;
export const VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';

export interface Note {
  v: string;
  date: string;
  th: string[];
  en: string[];
}

/** Newest first. Player-facing words only: what changed for them, not how. */
export const NOTES: Note[] = [
  {
    v: '0.0.1',
    date: '2026-11-26',
    th: [
      'เมืองแบบมองจากด้านบน: เห็นทั้งเมืองในจอเดียว แตะฟองบนอาคารเพื่อเก็บของ',
      'ส่งฮีโร่ว่างไปทำงานที่เหมือง ศาลเจ้า และลานตัดไม้ ผลิตต่อแม้ปิดเกม',
      'สนามประลอง: แบบทั่วไปเล่นฟรีไม่จำกัด · แบบแรงค์ใช้ตั๋ว (ฟรีวันละ 1 ใบ, ชนะ 7+ ได้ตั๋วคืน)',
      'อาคารอัปเกรดได้ไม่จำกัดเลเวล และฮีโร่เก่งงานขึ้นเมื่อทำงานนาน (ความชำนาญ)',
      'ไข่งาน ของหายากระหว่างทำงาน ฮีโร่แสงจันทร์ และข่าวในเมือง',
      'อนุสาวรีย์ประจำซีซั่น: ร่วมกันเติมทรัพยากรเพื่อปกป้องเมือง',
      'สมดุล: แพ้วันที่ 1–2 เสียเลือด 1 · ของวิเศษ 1 ใน 3 เข้ากับสายฮีโร่เสมอ · สุ่มร้านฟรีวันละ 1 ครั้ง · โบนัสชนะติดสูงสุด +2',
    ],
    en: [
      'Top-down town: the whole town on one screen; tap a bubble on a building to collect',
      'Send idle heroes to work at the mine, shrine and lumber yard; they keep working while the game is closed',
      'Arena: Casual is free and unlimited · Ranked uses a ticket (1 free a day, 7+ wins gives it back)',
      'Buildings level up without a cap, and heroes get better at a job the longer they do it (mastery)',
      'Work eggs, lucky finds while working, moonlit heroes and a town feed',
      'Season monument: pour resources together to protect the town',
      'Balance: a loss on days 1–2 costs 1 HP · 1 of 3 relics always fits your hero line · 1 free shop reroll a day · win-streak gold up to +2',
    ],
  },
];

const SEEN_KEY = 'mochi.seenVersion';
let box: HTMLDivElement | null = null;

/** semver-ish compare: '0.0.10' > '0.0.9' */
export const newer = (a: string, b: string) => {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa.at(i) ?? 0) !== (pb.at(i) ?? 0)) return (pa.at(i) ?? 0) > (pb.at(i) ?? 0);
  return false;
};


export function openNotes(onlySince?: string) {
  const list = NOTES.filter((n) => !onlySince || newer(n.v, onlySince));
  close();
  box = document.createElement('div');
  box.className = 'modal rn-modal';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', L('มีอะไรใหม่', "What's new"));
  box.innerHTML = `<div class="rn-box"><div class="rn-head"><b>${L('มีอะไรใหม่', "What's new")}</b><small>v${esc(VERSION)}</small><button class="rn-x small ghost">${L('ปิด ✕', 'Close ✕')}</button></div>
    <div class="rn-body">${list
      .map((n) => `<section><h3>v${esc(n.v)} <small>${esc(n.date)}</small></h3><ul>${(getLang() === 'th' ? n.th : n.en).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></section>`)
      .join('')}</div></div>`;
  box.addEventListener('click', (ev) => {
    const t = ev.target as HTMLElement;
    if (t === box || t.closest('.rn-x')) close();
  });
  document.body.appendChild(box);
  box.querySelector<HTMLButtonElement>('.rn-x')?.focus();
  localStorage.setItem(SEEN_KEY, VERSION);
}

function close() {
  box?.remove();
  box = null;
}

/** On load: show "What's new" once after an update (not on a player's very first visit). */
export function notesOnStart() {
  const seen = localStorage.getItem(SEEN_KEY);
  if (!seen) {
    localStorage.setItem(SEEN_KEY, VERSION);
    return;
  }
  if (newer(VERSION, seen)) openNotes(seen);
}

/** A version chip in the header (opens the notes), and a banner when the server runs a newer version. */
export function mountVersion() {
  const header = document.querySelector('header');
  if (header && !header.querySelector('.ver-chip')) {
    const b = document.createElement('button');
    b.className = 'ver-chip ghost small';
    b.textContent = `v${VERSION}`;
    b.title = L('มีอะไรใหม่', "What's new");
    b.addEventListener('click', () => openNotes());
    header.querySelector('small')?.after(b);
  }
  const check = () =>
    fetch('/api/version')
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { version?: string } | null) => {
        if (!j?.version || !newer(j.version, VERSION) || document.querySelector('.ver-banner')) return;
        const bar = document.createElement('div');
        bar.className = 'ver-banner';
        bar.innerHTML = `${L(`มีเวอร์ชันใหม่ v${esc(j.version)}`, `New version v${esc(j.version)} is out`)} <button class="small">${L('โหลดใหม่', 'Reload')}</button>`;
        bar.querySelector('button')!.addEventListener('click', () => location.reload());
        document.body.appendChild(bar);
      })
      .catch(() => {});
  setTimeout(check, 5000);
  setInterval(check, 5 * 60_000);
}
