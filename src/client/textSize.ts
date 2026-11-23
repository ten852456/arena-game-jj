/**
 * "Large text" (settings panel): html.big-text raises the small print (skill pills, tags, notes, tooltips,
 * fight summary, log) to a readable size without changing the one-screen layout. Saved per device.
 * Asked for by the retiree persona in the Nov 2026 playtests (11–13px text was unreadable for him).
 */
import { L } from '../i18n';
import './textsize.css';

const KEY = 'mochi.bigText';
let on = false;
try {
  on = localStorage.getItem(KEY) === '1';
} catch {
  /* private mode */
}

function apply() {
  document.documentElement.classList.toggle('big-text', on);
}
apply();

export const isBigText = () => on;
export function setBigText(v: boolean) {
  on = v;
  try {
    localStorage.setItem(KEY, v ? '1' : '0');
  } catch {
    /* private mode: this visit only */
  }
  apply();
}

/** checkbox row for the 🎚 settings panel */
export const bigTextRowHTML = () =>
  `<label class="vol-mute big-text-row"><input type="checkbox" data-bigtext ${on ? 'checked' : ''}> 🔍 ${L('ตัวหนังสือใหญ่', 'Large text')}</label>`;
