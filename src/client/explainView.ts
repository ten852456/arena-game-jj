/**
 * Post-fight explanation ("why you won / lost") as scannable HTML: an icon per line by topic, coloured key words
 * (skill names with their icon and archetype colour, numbers, status words, win / loss), and the main reason with
 * its "what to try" as a callout. The text itself comes unchanged from sim/explain.ts; this only marks spans in it.
 */
import { L } from '../i18n';
import { SKILLS } from '../sim/skills';
import type { Explanation, LineKind } from '../sim/explain';
import { SKILL_ICON_IDS, skillIcon } from './assets';
import './explain.css';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const reEsc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const KIND_ICON: Record<LineKind, string> = {
  damage: '⚔️', hit: '💥', defence: '🛡️', burn: '🔥', control: '❄️', chain: '🔗', speed: '⏱️',
  thorns: '🌵', heal: '💚', growth: '📈', fatigue: '⏳', ko: '💀', idle: '💤', poison: '☠', dodge: '💨', ult: '★',
};

/** status word → css class; Thai words match anywhere, English ones on letter boundaries, any case */
const STATUS: [string, string][] = [
  ['ไม่หวั่นไหว', 'mark'], ['ร่ายไว', 'mark'], ['Unshaken', 'mark'], ['Quickcast', 'mark'],
  ['ความเหนื่อยล้า', 'fatigue'], ['เหนื่อยล้า', 'fatigue'], ['fatigue', 'fatigue'],
  ['แช่แข็ง', 'freeze'], ['ถ่วงเวลา', 'freeze'], ['ควบคุม', 'freeze'], ['frozen', 'freeze'], ['freezes', 'freeze'], ['freeze', 'freeze'],
  ['delayed', 'freeze'], ['delay', 'freeze'], ['controlled', 'freeze'], ['control', 'freeze'],
  ['ช้าลง', 'slow'], ['slowed', 'slow'], ['slows', 'slow'], ['slow', 'slow'],
  ['ไฟ', 'burn'], ['burns', 'burn'], ['burn', 'burn'],
  ['โล่', 'shield'], ['shields', 'shield'], ['shield', 'shield'],
  ['หนาม', 'thorns'], ['thorns', 'thorns'],
  ['ฟื้นเลือด', 'heal'], ['ฟื้น', 'heal'], ['healing', 'heal'], ['healed', 'heal'], ['heals', 'heal'],
  ['พลังโจมตี', 'growth'], ['attack power', 'growth'],
  ['ชนะ', 'win'], ['Victory', 'win'], ['Won', 'win'], ['won', 'win'], ['wins', 'win'], ['win', 'win'],
  ['แพ้', 'loss'], ['Lost', 'loss'], ['lost', 'loss'], ['เสมอ', 'draw'], ['draw', 'draw'],
];
const THAI = /[฀-๿]/;
/** Thai: anywhere; English: on letter boundaries, first letter in either case ("Burn dealt", "burn ignores") */
const word = (w: string) => {
  if (THAI.test(w)) return reEsc(w);
  const c = w[0];
  return `(?<![A-Za-z])[${c.toUpperCase()}${c.toLowerCase()}]${reEsc(w.slice(1))}(?![A-Za-z])`;
};
/** exact case (skill and player names: "your" is not "You", "train" is not "Train") */
const exact = (w: string) => (THAI.test(w) ? reEsc(w) : `(?<![A-Za-z])${reEsc(w)}(?![A-Za-z])`);
const NUM = String.raw`[+\-]?\d+(?:\.\d+)?(?:\/\d+|%|\s?วิ(?!นาที)|s(?![A-Za-z]))?`;

type Tok = { re: string; html: (m: string) => string };

/** All skill names of the current language (every tree variant) → skill id, longest first. */
function skillTokens(): Tok[] {
  const byName = new Map<string, string>();
  for (const d of Object.values(SKILLS)) for (const n of Object.values(d.tree)) if (n.name && !byName.has(n.name)) byName.set(n.name, d.id);
  const icons = new Set<string>(SKILL_ICON_IDS);
  return [...byName.entries()]
    .sort((a, b) => b[0].length - a[0].length)
    .map(([name, id]) => ({
      re: exact(name),
      html: (m: string) =>
        `<span class="xv-sk xv-a-${SKILLS[id].line}">${icons.has(id) ? `<img src="${skillIcon(id)}" alt="">` : ''}${esc(m)}</span>`,
    }));
}

/** Text → HTML with key words wrapped. names = [me, foe] get the side colours (who s0 / s1). */
function marker(names: [string, string]) {
  const toks: Tok[] = [
    ...names
      .map((n, i) => ({ n: n.trim(), i }))
      .filter((x) => x.n)
      .sort((a, b) => b.n.length - a.n.length)
      .map(({ n, i }) => ({ re: exact(n), html: (m: string) => `<b class="who s${i}">${esc(m)}</b>` })),
    ...skillTokens(),
    ...[...STATUS].sort((a, b) => b[0].length - a[0].length).map(([w, c]) => ({ re: word(w), html: (m: string) => `<span class="xv-st xv-${c}">${esc(m)}</span>` })),
    { re: NUM, html: (m: string) => `<b class="xv-num">${esc(m)}</b>` },
  ];
  const re = new RegExp(toks.map((t) => `(${t.re})`).join('|'), 'g');
  return (text: string) => {
    let out = '';
    let at = 0;
    for (const m of text.matchAll(re)) {
      const tok = toks[m.slice(1).findIndex((x) => x !== undefined)];
      out += esc(text.slice(at, m.index)) + tok.html(m[0]);
      at = m.index! + m[0].length;
    }
    return out + esc(text.slice(at));
  };
}

/** " → " splits what happened from what to try next */
const split = (t: string): [string, string] => {
  const i = t.indexOf(' → ');
  return i < 0 ? [t, ''] : [t.slice(0, i), t.slice(i + 3)];
};

/** The explanation block of the result / replay screens. won = `me` won (a draw counts as not won). */
export function explainView(x: Explanation, won: boolean): string {
  const mk = marker(x.names);
  const [how, ...rest] = x.headline.split(' · ');
  const line = (kind: LineKind, body: string, cls = '') =>
    `<li class="xv-line xv-k-${kind} ${cls}"><span class="xv-ico" aria-hidden="true">${KIND_ICON[kind] ?? '•'}</span><div>${body}</div></li>`;
  const tipHTML = (tip: string, cls: string) => (tip ? `<div class="${cls}"><span class="xv-ico" aria-hidden="true">💡</span><span>${mk(tip)}</span></div>` : '');

  const [main, ...others] = x.reasons;
  const mainKind = x.reasonKinds?.[0] ?? 'damage';
  let callout = '';
  if (main) {
    const [cause, tip] = split(main);
    callout = `<div class="xv-callout ${won ? 'xv-ok' : 'xv-bad'}">
      <div class="xv-cl-h">${won ? L('🏆 กุญแจสู่ชัยชนะ', '🏆 Key to the win') : L('🎯 สาเหตุหลัก', '🎯 Main reason')}</div>
      <div class="xv-cl-body"><span class="xv-ico" aria-hidden="true">${KIND_ICON[mainKind]}</span><div>${mk(cause)}</div></div>
      ${tip ? `<div class="xv-tipbox"><b>${L('💡 ครั้งหน้าลอง', '💡 Next time')}</b><div>${mk(tip)}</div></div>` : ''}
    </div>`;
  }
  const otherHTML = others
    .map((t, i) => {
      const [cause, tip] = split(t);
      return line(x.reasonKinds?.[i + 1] ?? 'damage', `${mk(cause)}${tipHTML(tip, 'xv-tip')}`);
    })
    .join('');

  return `<div class="explain xv ${won ? 'xv-won' : 'xv-lost'}">
    <div class="xv-head"><span class="xv-res ${won ? 'xv-ok' : 'xv-bad'}">${won ? '🏆' : '💔'} ${esc(how)}</span>${rest.length ? `<span class="xv-meta">${mk(rest.join(' · '))}</span>` : ''}</div>
    ${main ? `<h4>${won ? L('ทำไมชนะ', 'Why you won') : L('ทำไมแพ้ และลองอะไรต่อ', 'Why you lost, and what to try next')}</h4>${callout}` : ''}
    ${otherHTML ? `<ul class="xv-list reasons">${otherHTML}</ul>` : ''}
    <ul class="xv-list xv-facts facts">${x.facts.map((f, i) => line(x.factKinds?.[i] ?? 'damage', mk(f))).join('')}</ul>
  </div>`;
}
