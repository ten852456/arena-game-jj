// Volume settings: a 🎚 button in the header opens a small panel with one slider per audio channel.
// Values are saved by audio.ts (localStorage) and applied immediately.
import { L } from '../i18n';
import { onLang } from './lang';
import { getAudioSettings, setMuted, setVolume, sfx, voice, type Channel } from './audio';
import './sound.css';
import { isDetail, onInfoMode, setDetail, settingsRowHTML } from './infoMode';

const ROWS: { ch: Channel; icon: string; th: string; en: string }[] = [
  { ch: 'master', icon: '🔊', th: 'เสียงทั้งหมด', en: 'Master' },
  { ch: 'music', icon: '🎵', th: 'เพลง', en: 'Music' },
  { ch: 'sfx', icon: '✨', th: 'เอฟเฟกต์', en: 'Effects' },
  { ch: 'voice', icon: '🗣️', th: 'เสียงพากย์', en: 'Voice' },
];

export function mountSoundPanel(onChange: () => void) {
  const header = document.querySelector('header');
  if (!header || header.querySelector('.vol-btn')) return;
  const btn = document.createElement('button');
  btn.className = 'vol-btn small ghost';
  btn.type = 'button';
  btn.dataset.sfx = 'none';
  btn.textContent = '🎚️';
  btn.setAttribute('aria-haspopup', 'dialog');
  btn.setAttribute('aria-expanded', 'false');

  const panel = document.createElement('div');
  panel.className = 'vol-panel';
  panel.setAttribute('role', 'dialog');
  panel.hidden = true;

  const render = () => {
    const s = getAudioSettings();
    const label = L('ตั้งค่าเสียง', 'Sound settings');
    btn.title = label;
    btn.setAttribute('aria-label', label);
    panel.setAttribute('aria-label', label);
    panel.innerHTML = `
      <div class="vol-head"><b>${label}</b><button type="button" class="vol-x small ghost" data-sfx="none" aria-label="${L('ปิด', 'Close')}">✕</button></div>
      ${ROWS.map(
        (r) => `<label class="vol-row"><span class="vol-ico">${r.icon}</span><span class="vol-name">${L(r.th, r.en)}</span>
          <input type="range" min="0" max="100" step="5" value="${Math.round(s[r.ch] * 100)}" data-ch="${r.ch}">
          <span class="vol-val">${Math.round(s[r.ch] * 100)}</span></label>`,
      ).join('')}
      <label class="vol-mute"><input type="checkbox" ${s.muted ? 'checked' : ''}> ${L('ปิดเสียงทั้งหมด', 'Mute everything')}</label>
      ${settingsRowHTML()}`;
  };

  panel.addEventListener('input', (ev) => {
    const t = ev.target as HTMLInputElement;
    if (t.type === 'range' && t.dataset.ch) {
      setVolume(t.dataset.ch as Channel, Number(t.value) / 100);
      const val = t.parentElement?.querySelector('.vol-val');
      if (val) val.textContent = t.value;
      if (getAudioSettings().muted && Number(t.value) > 0) {
        setMuted(false);
        const cb = panel.querySelector<HTMLInputElement>('.vol-mute input');
        if (cb) cb.checked = false;
      }
      onChange();
    }
  });
  // preview the level when a slider is released
  panel.addEventListener('change', (ev) => {
    const t = ev.target as HTMLInputElement;
    if (t.type === 'checkbox' && t.dataset.info !== undefined) {
      if (t.checked !== isDetail()) setDetail(t.checked);
      return;
    }
    if (t.type === 'checkbox') {
      setMuted(t.checked);
      onChange();
      return;
    }
    if (t.dataset.ch === 'voice') voice('fight');
    else if (t.dataset.ch === 'sfx' || t.dataset.ch === 'master') sfx('click', { force: true });
  });
  panel.addEventListener('click', (ev) => {
    if ((ev.target as HTMLElement).closest('.vol-x')) close();
  });

  const open = () => {
    render();
    panel.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    panel.querySelector<HTMLInputElement>('input[type=range]')?.focus();
  };
  const close = () => {
    panel.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
  };
  btn.addEventListener('click', () => (panel.hidden ? open() : close()));
  document.addEventListener('pointerdown', (ev) => {
    if (panel.hidden) return;
    const t = ev.target as Node;
    if (!panel.contains(t) && !btn.contains(t)) close();
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !panel.hidden) close();
  });
  onLang(() => {
    btn.title = L('ตั้งค่าเสียง', 'Sound settings');
    if (!panel.hidden) render();
  });
  onInfoMode(() => {
    const cb = panel.querySelector<HTMLInputElement>('input[data-info]');
    if (cb) cb.checked = isDetail();
  });
  render();

  const mute = header.querySelector('.mute-btn');
  if (mute) mute.after(btn);
  else header.appendChild(btn);
  document.body.appendChild(panel);
  /** let the mute button refresh the checkbox */
  return { refresh: () => !panel.hidden && render() };
}
