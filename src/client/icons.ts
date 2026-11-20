/**
 * Mochi Moon icon set: small hand-drawn SVG icons in the chibi style of the heroes (thick plum outline,
 * flat pastel fill, a soft white highlight, sleepy little faces on some). Used instead of emoji.
 *
 *  icon(name, size?)   → inline SVG string (decorative: aria-hidden; pass a label for a meaningful icon)
 *  initIcons()         → swaps the emoji that game text still contains (tutorial, tips, chips, logs) for these
 *                        icons as the DOM changes, so text stays written with emoji in the data files.
 */

const INK = '#3a2b48';
const C = {
  cream: '#fff4e4',
  paper: '#fbe9cf',
  lav: '#cdbff5',
  lav2: '#a99be6',
  peach: '#ffc39c',
  pink: '#ffb3c7',
  rose: '#ff8fae',
  mint: '#a9e8c4',
  sky: '#bfe0ff',
  ice: '#d6f0ff',
  gold: '#ffd572',
  gold2: '#f2b84b',
  wood: '#c99466',
  stone: '#cfc8de',
};

const o = (w = 2.4) => `stroke="${INK}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"`;
/** soft white highlight */
const hl = (x: number, y: number, rx = 2.6, ry = 1.6, rot = -30) =>
  `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" transform="rotate(${rot} ${x} ${y})" fill="#fff" opacity=".75"/>`;
/** a sleepy chibi face (eyes, tiny smile, blush) */
const face = (x: number, y: number, s = 1, eyes: 'dot' | 'happy' | 'shut' = 'dot') => {
  const e =
    eyes === 'dot'
      ? `<circle cx="${x - 3.2 * s}" cy="${y}" r="${1.25 * s}" fill="${INK}"/><circle cx="${x + 3.2 * s}" cy="${y}" r="${1.25 * s}" fill="${INK}"/>`
      : eyes === 'happy'
        ? `<path d="M${x - 4.4 * s} ${y + 0.6 * s} q${1.2 * s} ${-1.8 * s} ${2.4 * s} 0 M${x + 2 * s} ${y + 0.6 * s} q${1.2 * s} ${-1.8 * s} ${2.4 * s} 0" fill="none" ${o(1.3 * s)}/>`
        : `<path d="M${x - 4.4 * s} ${y} q${1.2 * s} ${1.4 * s} ${2.4 * s} 0 M${x + 2 * s} ${y} q${1.2 * s} ${1.4 * s} ${2.4 * s} 0" fill="none" ${o(1.3 * s)}/>`;
  return (
    e +
    `<path d="M${x - 1.2 * s} ${y + 1.9 * s} q${1.2 * s} ${1.2 * s} ${2.4 * s} 0" fill="none" ${o(1.2 * s)}/>` +
    `<ellipse cx="${x - 5.3 * s}" cy="${y + 2 * s}" rx="${1.5 * s}" ry="${0.9 * s}" fill="${C.rose}" opacity=".55"/>` +
    `<ellipse cx="${x + 5.3 * s}" cy="${y + 2 * s}" rx="${1.5 * s}" ry="${0.9 * s}" fill="${C.rose}" opacity=".55"/>`
  );
};
/** a line drawn as a pastel stroke with a plum outline */
const line = (d: string, fill: string, w = 3) =>
  `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${w + 2.6}" stroke-linecap="round" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="${fill}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
const pts = (cx: number, cy: number, R: number, r: number, n: number, rot = -90) =>
  Array.from({ length: n * 2 }, (_, i) => {
    const a = ((rot + (i * 180) / n) * Math.PI) / 180;
    const d = i % 2 ? r : R;
    return `${(cx + d * Math.cos(a)).toFixed(2)},${(cy + d * Math.sin(a)).toFixed(2)}`;
  }).join(' ');
const star5 = (cx: number, cy: number, R: number, fill: string, w = 2.4) => `<polygon points="${pts(cx, cy, R, R * 0.5, 5)}" fill="${fill}" ${o(w)}/>`;
const twinkle = (x: number, y: number, r: number, fill: string, w = 2) =>
  `<path d="M${x} ${y - r} Q${x} ${y} ${x + r} ${y} Q${x} ${y} ${x} ${y + r} Q${x} ${y} ${x - r} ${y} Q${x} ${y} ${x} ${y - r} Z" fill="${fill}" ${o(w)}/>`;

const HEART = 'M16 27.5C7 21.5 3.5 16.5 3.5 11.2 3.5 7 6.4 4.3 9.8 4.3c2.7 0 4.8 1.6 6.2 4 1.4-2.4 3.5-4 6.2-4 3.4 0 6.3 2.7 6.3 6.9 0 5.3-3.5 10.3-12.5 16.3Z';
const SHIELD = 'M16 3.6 26.4 7.6c0 10.6-3.6 17-10.4 20.9C9.2 24.6 5.6 18.2 5.6 7.6Z';
const SPEAKER = `<path d="M4.5 12.2h5.2l6.8-5.8v19.2l-6.8-5.8H4.5Z" fill="${C.lav}" ${o()}/>${hl(8, 14.4, 1.6, 1)}`;
const sword = (blade = '#eef1ff') =>
  `<path d="M4.6 4.6 9.4 5.2 21.6 17.4 17.4 21.6 5.2 9.4Z" fill="${blade}" ${o()}/>` +
  line('M15.4 23.4 23.4 15.4', C.gold, 3.2) +
  line('M21.4 21.4 25.6 25.6', C.wood, 3.4) +
  `<circle cx="27" cy="27" r="2.4" fill="${C.pink}" ${o(2)}/>`;
const medal = (fill: string, n: number) =>
  `<path d="M9 3h5l3 9h-5Z" fill="${C.sky}" ${o(2)}/><path d="M23 3h-5l-3 9h5Z" fill="${C.pink}" ${o(2)}/>` +
  `<circle cx="16" cy="20" r="9" fill="${fill}" ${o()}/><circle cx="16" cy="20" r="5.8" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="1.6"/>` +
  `<text x="16" y="24" text-anchor="middle" font-family="Kanit,system-ui,sans-serif" font-weight="700" font-size="11" fill="${INK}">${n}</text>`;

/** viewBox 0 0 32 32 */
const ICONS: Record<string, string> = {
  heart: `<path d="${HEART}" fill="${C.pink}" ${o()}/>${hl(9.2, 9.4, 2.6, 1.6)}${face(16, 14.2, 0.9)}`,
  heal: `<path d="${HEART}" fill="${C.mint}" ${o()}/>${hl(9.2, 9.4, 2.6, 1.6)}${line('M16 10.5v9M11.5 15h9', '#fff', 2.6)}`,
  heartbreak: `<path d="${HEART}" fill="#d9a7bf" ${o()}/><path d="M16 8.3 13.6 13l3.6 2.6-3 4.4 1.4 2.4" fill="none" ${o(2)}/>${hl(9.2, 9.4, 2.6, 1.6)}`,
  blood: `<path d="M16 3.5C12 9.5 7.5 14.5 7.5 19.5a8.5 8.5 0 0 0 17 0C24.5 14.5 20 9.5 16 3.5Z" fill="${C.rose}" ${o()}/>${hl(12.4, 18, 1.8, 3, 18)}`,
  moon: `<circle cx="16" cy="16" r="12.2" fill="#ffe6a3" ${o()}/><circle cx="22" cy="10.6" r="2.4" fill="#f4cd7c"/><circle cx="9.2" cy="22" r="1.8" fill="#f4cd7c"/><circle cx="24.2" cy="20.4" r="1.4" fill="#f4cd7c"/>${hl(9.4, 9.2, 3, 1.8)}${face(16, 16.4, 0.95, 'shut')}`,
  crescent: `<path d="M20.5 4.2A12.4 12.4 0 1 0 28 21.6 9.6 9.6 0 1 1 20.5 4.2Z" fill="${C.gold}" ${o()}/>${hl(8.6, 12, 1.6, 2.6, 20)}<path d="M10.4 19q1.3 1.4 2.6 0" fill="none" ${o(1.3)}/><ellipse cx="9.4" cy="22" rx="1.4" ry=".8" fill="${C.rose}" opacity=".55"/>${twinkle(25.5, 7, 2.6, '#fff4c8', 1.4)}`,
  star: `${star5(16, 17, 13.2, C.gold)}${hl(12.4, 11.6, 1.8, 1.1)}${face(16, 18, 0.72)}`,
  sparkle: `${twinkle(13.5, 17.5, 10.5, '#fff1b8', 2.4)}${twinkle(25, 7.5, 4.2, C.pink, 1.8)}${twinkle(25.5, 25, 2.6, C.lav, 1.5)}`,
  bolt: `<path d="M18.6 2.8 6.8 18.2h8l-2.4 11 12.4-16.4h-8l1.8-10Z" fill="${C.gold}" ${o()}/>${hl(14.2, 10.6, 1.2, 2.6, 35)}`,
  fire: `<path d="M16 29.2c-6.8 0-10.6-4.4-10.6-9.6 0-6 5-9.2 6-15 3.6 2.4 4.6 5.4 4.2 8.4 2-1.4 3-3.4 3-5.6 4.6 3 8 7.6 8 12.2 0 5.2-3.8 9.6-10.6 9.6Z" fill="${C.peach}" ${o()}/><path d="M16 27c-3.2 0-4.8-2-4.8-4.4 0-2.8 2.4-4.2 3.4-6.8 3 1.8 6.2 4.2 6.2 7 0 2.4-1.6 4.2-4.8 4.2Z" fill="${C.gold}"/><circle cx="14" cy="22.6" r="1" fill="${INK}"/><circle cx="18" cy="22.6" r="1" fill="${INK}"/>${hl(10.4, 15.6, 1.4, 2.4, 25)}`,
  snow: `${line('M16 3.8v24.4M5.4 9.9l21.2 12.2M5.4 22.1l21.2-12.2', C.ice, 3)}${line('M12.6 5.6 16 8.6l3.4-3M12.6 26.4l3.4-3 3.4 3', C.ice, 2.4)}<circle cx="16" cy="16" r="3.6" fill="#fff" ${o(2)}/>`,
  ice: `<rect x="4.6" y="7" width="22.8" height="20" rx="5.5" fill="${C.ice}" ${o()}/><path d="M7.6 11.6c1-1.8 2.4-2.4 4.4-2.4" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/>${face(16, 18.4, 0.95)}`,
  clock: `<rect x="13" y="2.6" width="6" height="4.4" rx="1.6" fill="${C.pink}" ${o(2)}/><circle cx="16" cy="18" r="11" fill="${C.cream}" ${o()}/>${line('M16 18V11.6M16 18l4.2 2.6', C.lav2, 1.6)}<circle cx="16" cy="18" r="1.6" fill="${INK}"/>${hl(10.6, 12, 2.4, 1.4)}`,
  link:
    line('M13.4 18.6 9.8 22.2a3.6 3.6 0 0 1-5-5l4.6-4.6a3.6 3.6 0 0 1 5 0', C.gold, 3.2) +
    line('M18.6 13.4l3.6-3.6a3.6 3.6 0 0 1 5 5l-4.6 4.6a3.6 3.6 0 0 1-5 0', C.pink, 3.2) +
    line('M12.6 19.4l6.8-6.8', C.cream, 3),
  bulb: `<path d="M16 3.8c-5.8 0-9.4 4.4-9.4 9 0 3.4 2 5.4 3.8 7.2 1 1 1.2 2 1.2 3.2h8.8c0-1.2.2-2.2 1.2-3.2 1.8-1.8 3.8-3.8 3.8-7.2 0-4.6-3.6-9-9.4-9Z" fill="#fff1a6" ${o()}/><rect x="11.4" y="23.2" width="9.2" height="5.4" rx="2.2" fill="${C.lav}" ${o(2)}/>${hl(11, 10, 1.6, 2.6, 30)}${face(16, 13.6, 0.8, 'happy')}`,
  boom: `<polygon points="${pts(16, 16, 14, 8.2, 9)}" fill="${C.peach}" ${o()}/><polygon points="${pts(16, 16, 7.6, 4.6, 7, -70)}" fill="#fff1a6" ${o(1.8)}/>`,
  sword: sword(),
  swords: sword() + `<g transform="translate(32 0) scale(-1 1)">${sword('#e4f2ff')}</g>`,
  shield: `<path d="${SHIELD}" fill="${C.sky}" ${o()}/><path d="M16 7.4 23 10.1c-.3 7.2-2.8 11.6-7 14.4" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="1.8" stroke-linecap="round"/>${face(15.2, 14.6, 0.85)}`,
  coin: `<circle cx="16" cy="16" r="12" fill="${C.gold}" ${o()}/><circle cx="16" cy="16" r="8.2" fill="none" stroke="${C.gold2}" stroke-width="1.8"/><path d="M18.4 11.4a5 5 0 1 0 2.2 7.4 4 4 0 1 1-2.2-7.4Z" fill="${C.gold2}"/>${hl(10.4, 9.6, 2.4, 1.4)}`,
  lock: `${line('M10.4 14.6v-3.6a5.6 5.6 0 0 1 11.2 0v3.6', C.lav, 3)}<rect x="6.2" y="13.8" width="19.6" height="14.6" rx="5" fill="${C.peach}" ${o()}/>${hl(10, 17, 1.8, 1.1)}${face(16, 20.4, 0.85, 'shut')}`,
  unlock: `${line('M10.4 14.6v-3.6a5.6 5.6 0 0 1 10.8-2', C.lav, 3)}<rect x="6.2" y="13.8" width="19.6" height="14.6" rx="5" fill="${C.cream}" ${o()}/>${hl(10, 17, 1.8, 1.1)}${face(16, 20.4, 0.85)}`,
  dice: `<rect x="5" y="5" width="22" height="22" rx="6.5" transform="rotate(-9 16 16)" fill="${C.cream}" ${o()}/><g fill="${INK}" transform="rotate(-9 16 16)"><circle cx="10.8" cy="10.8" r="2"/><circle cx="16" cy="16" r="2"/><circle cx="21.2" cy="21.2" r="2"/></g><g fill="${C.pink}" transform="rotate(-9 16 16)"><circle cx="21.2" cy="10.8" r="2"/><circle cx="10.8" cy="21.2" r="2"/></g>`,
  jar: `<rect x="8.6" y="3.8" width="14.8" height="5" rx="2" fill="${C.pink}" ${o(2.2)}/><path d="M9.4 8.8h13.2v2c3 2 4.6 5.2 4.6 9 0 5.4-4 8.6-11.2 8.6S4.8 25.2 4.8 19.8c0-3.8 1.6-7 4.6-9Z" fill="${C.ice}" ${o()}/><circle cx="12.4" cy="22.6" r="3.2" fill="${C.gold}" ${o(1.6)}/><circle cx="19.4" cy="23" r="3.2" fill="${C.gold}" ${o(1.6)}/><circle cx="16" cy="18" r="3.2" fill="${C.gold}" ${o(1.6)}/>${hl(9.4, 14.4, 1.4, 2.6, 20)}`,
  home: `<rect x="7.4" y="14" width="17.2" height="14" rx="2.6" fill="${C.cream}" ${o()}/><rect x="13.6" y="19.2" width="4.8" height="8.8" rx="2.4" fill="${C.wood}" ${o(2)}/><path d="M3.6 16 16 5.2 28.4 16" fill="none" stroke="${INK}" stroke-width="7.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M3.6 16 16 5.2 28.4 16" fill="none" stroke="${C.pink}" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round"/>`,
  speaker: `${SPEAKER}${line('M20.6 11.8c1.8 2.4 1.8 6 0 8.4', C.mint, 2)}${line('M24.2 8.6c3.4 4.2 3.4 10.6 0 14.8', C.mint, 2)}`,
  mute: `${SPEAKER}${line('M21 12.4l6.4 7.2M27.4 12.4 21 19.6', C.pink, 2.4)}`,
  sliders: `${line('M8.5 5v22M16 5v22M23.5 5v22', '#8d7fc9', 1.4)}<rect x="4.5" y="15.5" width="8" height="5.6" rx="2.8" fill="${C.peach}" ${o(2)}/><rect x="12" y="7.6" width="8" height="5.6" rx="2.8" fill="${C.mint}" ${o(2)}/><rect x="19.5" y="19" width="8" height="5.6" rx="2.8" fill="${C.pink}" ${o(2)}/>`,
  music: `${line('M12 22.4V7.4l13-3v14.8', C.lav, 2)}${line('M12 10.4l13-3', C.lav, 2)}<ellipse cx="8.8" cy="23.2" rx="4.2" ry="3.4" fill="${C.pink}" ${o()}/><ellipse cx="21.8" cy="20" rx="4.2" ry="3.4" fill="${C.mint}" ${o()}/>`,
  voice: `<path d="M7.6 5.2h16.8a4 4 0 0 1 4 4v9a4 4 0 0 1-4 4H15l-6 5v-5H7.6a4 4 0 0 1-4-4v-9a4 4 0 0 1 4-4Z" fill="${C.cream}" ${o()}/>${face(16, 12.6, 0.95, 'happy')}`,
  trophy: `<path d="M9.4 7.6H5.4c0 4.2 1.8 6.6 5 7.2M22.6 7.6h4c0 4.2-1.8 6.6-5 7.2" fill="none" ${o(2.4)}/><path d="M9 4.6h14v7.6c0 4.6-3 7.6-7 7.6s-7-3-7-7.6Z" fill="${C.gold}" ${o()}/><rect x="13.8" y="19.4" width="4.4" height="4" fill="${C.gold2}" ${o(2)}/><rect x="9.4" y="23.2" width="13.2" height="5.2" rx="2" fill="${C.lav}" ${o()}/>${twinkle(16, 11.4, 3.2, '#fff4c8', 1.4)}${hl(11.6, 8, 1.2, 1.8, 10)}`,
  medal1: medal(C.gold, 1),
  medal2: medal('#e6e8f6', 2),
  medal3: medal('#f3b98e', 3),
  scroll: `<rect x="7.4" y="6" width="17.2" height="20" rx="1.6" fill="${C.paper}" ${o()}/><rect x="5" y="3.6" width="22" height="5" rx="2.5" fill="${C.peach}" ${o(2.2)}/><rect x="5" y="23.4" width="22" height="5" rx="2.5" fill="${C.peach}" ${o(2.2)}/>${line('M11 13h10M11 17h7', C.lav2, 0.8)}`,
  book: `<path d="M16 8.4C12.6 5.8 8.6 5.4 3.6 6.4v18.4c5-1 9-.6 12.4 2 3.4-2.6 7.4-3 12.4-2V6.4c-5-1-9-.6-12.4 2Z" fill="${C.cream}" ${o()}/><path d="M16 8.4v18.4" fill="none" ${o(2)}/><path d="M7 11c2.4-.4 4.6 0 6 .8M7 15c2.4-.4 4.6 0 6 .8M19 11.8c1.4-.8 3.6-1.2 6-.8" fill="none" stroke="${C.lav2}" stroke-width="1.6" stroke-linecap="round"/>`,
  flag: `${line('M8 4v24.5', C.wood, 2.4)}<path d="M9.2 5.4c4-1.8 7.4 2 12 .4 2-.7 3.4-.6 4.6-.2v11.6c-1.2-.4-2.6-.5-4.6.2-4.6 1.6-8-2.2-12-.4Z" fill="${C.cream}" ${o()}/>${face(17.4, 10.6, 0.7, 'shut')}`,
  target: `<circle cx="16" cy="16" r="12" fill="${C.pink}" ${o()}/><circle cx="16" cy="16" r="7.6" fill="${C.cream}" ${o(2)}/><circle cx="16" cy="16" r="3.4" fill="${C.rose}" ${o(2)}/>${hl(9.4, 9.4, 2.2, 1.3)}`,
  skull: `<path d="M16 4C9.4 4 5.4 8.6 5.4 14c0 3.6 1.8 6.2 4.2 7.6v4.4h12.8v-4.4c2.4-1.4 4.2-4 4.2-7.6C26.6 8.6 22.6 4 16 4Z" fill="#f2eeff" ${o()}/><ellipse cx="11.6" cy="14.6" rx="2.6" ry="3" fill="${INK}"/><ellipse cx="20.4" cy="14.6" rx="2.6" ry="3" fill="${INK}"/><circle cx="12.2" cy="13.6" r=".9" fill="#fff"/><circle cx="21" cy="13.6" r=".9" fill="#fff"/><path d="M14 22v3.6M18 22v3.6" ${o(1.6)}/>`,
  sleep: `${line('M14 8h8l-8 9h8', C.lav, 2.4)}${line('M5 19h5.4L5 25h5.4', C.sky, 2)}${line('M23 20.6h4l-4 4.6h4', C.pink, 1.6)}`,
  thorns: `<path d="M12 28.4V10a4 4 0 0 1 8 0v18.4Z" fill="${C.mint}" ${o()}/><path d="M12 19.6H8.6a3 3 0 0 1-3-3v-3.4a2 2 0 0 1 4 0v2.4H12M20 16.6h3.4v-4a2 2 0 0 1 4 0v4.4a3 3 0 0 1-3 3H20" fill="${C.mint}" ${o()}/><path d="M9 28.4h14" ${o()}/>${face(16, 14, 0.62)}<path d="M14 21.6l-1.4-.8M18 21.6l1.4-.8M16 25l0 1.2" ${o(1.3)}/>`,
  chart: `<rect x="4" y="5" width="24" height="22" rx="4" fill="${C.cream}" ${o()}/>${line('M8.4 21.6l5.2-5.4 4 3.2 6-7.6', C.mint, 2.4)}<path d="M19.6 10.6h4.6v4.6" fill="none" ${o(2.2)}/>`,
  stone: `<path d="M5 22.6c-1-5 1.6-11 7-13.6 4.6-2.2 10.6-1 13.4 3.4 2.6 4 1.8 10.4-2.6 12.6-3.8 1.8-11.6 2-14.6.8C6.6 25.2 5.4 24.4 5 22.6Z" fill="${C.stone}" ${o()}/><path d="M20.6 12.6l2.2 1.6" ${o(1.4)}/>${hl(11, 12.4, 2.4, 1.4)}${face(15.6, 18.6, 0.9, 'shut')}`,
  power: `<rect x="10.4" y="14" width="11.2" height="4" rx="1.6" fill="${C.lav}" ${o(2)}/><rect x="4.4" y="8.4" width="6.4" height="15.2" rx="3" fill="${C.pink}" ${o()}/><rect x="21.2" y="8.4" width="6.4" height="15.2" rx="3" fill="${C.pink}" ${o()}/>${hl(6.6, 11.6, .9, 1.8, 0)}${hl(23.4, 11.6, .9, 1.8, 0)}`,
  gear: ((shape: string) => `<g fill="${INK}" stroke="${INK}" stroke-width="4.8" stroke-linejoin="round">${shape}</g><g fill="${C.lav}">${shape}</g>`)(
    Array.from({ length: 8 }, (_, k) => `<rect x="13" y="3.6" width="6" height="7" rx="1.4" transform="rotate(${k * 45} 16 16)"/>`).join('') + '<circle cx="16" cy="16" r="9"/>',
  ) + `<circle cx="16" cy="16" r="3.8" fill="${C.cream}" ${o(2)}/>${hl(11.6, 11.2, 2, 1.2)}`,
  snail: `<path d="M3.4 26.6c0-2.6 2-3.4 5-3.4h13c2.2 0 3.2-2.2 3.2-6v-3.4c0-2.4 3.8-2.4 3.8 0v6.4c0 4.4-2.4 6.4-6.6 6.4Z" fill="${C.mint}" ${o()}/>${line('M25.6 11.4 24.4 6.6M27.8 11.4l1.2-4.6', C.mint, 1.2)}<circle cx="26.8" cy="14.6" r="1.1" fill="${INK}"/><circle cx="13.6" cy="15.4" r="8.4" fill="${C.peach}" ${o()}/><path d="M13.6 15.4c1.4 0 1.8 1.8.6 2.6-1.8 1-4-.6-3.6-2.8.4-2.8 4-3.8 6.2-2 2.6 2.2 1.6 6.6-1.6 7.6" fill="none" ${o(1.8)}/>${hl(9.4, 10.6, 1.8, 1.1)}`,
  rocket: `<path d="M16 2.8c5 3.4 6.6 9 5.4 16.4h-10.8C9.4 11.8 11 6.2 16 2.8Z" fill="${C.cream}" ${o()}/><path d="M10.8 15.6 6.4 20.4l4 1.4M21.2 15.6l4.4 4.8-4 1.4" fill="${C.pink}" ${o(2)}/><circle cx="16" cy="11.6" r="2.8" fill="${C.sky}" ${o(2)}/><path d="M12.8 22.2c.2 3 1.6 5.4 3.2 7 1.6-1.6 3-4 3.2-7Z" fill="${C.gold}" ${o(2)}/>`,
  times: line('M9.4 9.4 22.6 22.6M22.6 9.4 9.4 22.6', C.peach, 3.4),
  close: line('M9.6 9.6 22.4 22.4M22.4 9.6 9.6 22.4', C.lav, 3.4),
  check: line('M6.8 16.8l5.8 5.8L25.4 9.6', C.mint, 3.6),
  up: line('M16 26V7M8.4 14 16 6.4 23.6 14', C.mint, 3.2),
  info: `<circle cx="16" cy="16" r="12" fill="${C.lav}" ${o()}/><circle cx="16" cy="9.6" r="2.2" fill="${INK}"/><path d="M16 14.4v8.4" ${o(3.6)}/>${hl(9.6, 10, 2, 1.2)}`,
  telescope: `<rect x="5" y="9.6" width="20" height="7.4" rx="3.4" transform="rotate(-24 15 13.3)" fill="${C.lav}" ${o()}/><rect x="22.4" y="4.6" width="5" height="9.4" rx="2.2" transform="rotate(-24 24.9 9.3)" fill="${C.pink}" ${o(2)}/>${line('M15 17.6 10 28.4M15 17.6l5 10.8', C.wood, 2)}`,
  scale: `${line('M16 5v21M6.4 9.4h19.2', C.wood, 2.2)}<path d="M2.8 18.4h7.2a3.6 3.6 0 0 1-7.2 0ZM22 18.4h7.2a3.6 3.6 0 0 1-7.2 0Z" fill="${C.gold}" ${o(2)}/><path d="M6.4 9.4 3.4 18.4M6.4 9.4l3 9M25.6 9.4l-3 9M25.6 9.4l3 9" fill="none" ${o(1.4)}/><rect x="10.4" y="25.2" width="11.2" height="3.6" rx="1.8" fill="${C.lav}" ${o(2)}/>`,
  shop: `<rect x="5.4" y="14.6" width="21.2" height="13" rx="2.4" fill="${C.cream}" ${o()}/><path d="M4 8.4 7 4.4h18l3 4v3.4a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0Z" fill="${C.pink}" ${o()}/><path d="M10 8.4v3.4M16 8.4v3.4M22 8.4v3.4" fill="none" ${o(1.6)}/><rect x="12.4" y="19.2" width="7.2" height="8.4" rx="2.2" fill="${C.wood}" ${o(2)}/>`,
  robot: `${line('M16 7V3.8', C.lav2, 1.6)}<circle cx="16" cy="3.4" r="1.8" fill="${C.pink}" ${o(1.6)}/><rect x="5" y="7.4" width="22" height="18" rx="7" fill="${C.lav}" ${o()}/><rect x="8.6" y="11" width="14.8" height="10" rx="4.4" fill="${C.cream}" ${o(1.8)}/>${face(16, 15, 0.8, 'happy')}<path d="M10 25.4v3h12v-3" fill="${C.lav2}" ${o(2)}/>`,
};

const ALIAS: Record<string, string> = { sell: 'jar', reroll: 'dice', gold: 'coin', hp: 'heart', day: 'moon', win: 'star', fight: 'swords', sound: 'speaker', tree: 'info' };

/** emoji / symbol → icon name */
const EMOJI: Record<string, string> = {
  '🔗': 'link', '⚡': 'bolt', '✨': 'sparkle', '🗿': 'stone', '🔥': 'fire', '🌙': 'crescent', '🏆': 'trophy', '✦': 'sparkle',
  '💥': 'boom', '✓': 'check', '⏱': 'clock', '⚔': 'swords', '🛡': 'shield', '🗡': 'sword', '✕': 'close', '🔓': 'unlock',
  '🏳': 'flag', '🎯': 'target', '🌵': 'thorns', 'ⓘ': 'info', '❄': 'snow', '🩸': 'blood', '💪': 'power', '💡': 'bulb',
  '⛨': 'shield', '🧊': 'ice', '🚀': 'rocket', '🔊': 'speaker', '📜': 'scroll', '📖': 'book', '📈': 'chart', '🐌': 'snail',
  '🎲': 'dice', '🎚': 'sliders', '⚙': 'gear', '❤': 'heart', '♥': 'heart', '★': 'star', '⭐': 'star', '🌟': 'star', '✖': 'times',
  '⬆': 'up', '🥇': 'medal1', '🥈': 'medal2', '🥉': 'medal3', '🤺': 'swords', '🤖': 'robot', '🛒': 'shop', '🗣': 'voice',
  '🔭': 'telescope', '🔒': 'lock', '🔇': 'mute', '💤': 'sleep', '💚': 'heal', '💔': 'heartbreak', '💀': 'skull', '🏠': 'home',
  '🏟': 'swords', '🎵': 'music', '🌕': 'moon', '⚖': 'scale', '🪙': 'coin', '🏺': 'jar', '❤️': 'heart',
};

export const ICON_NAMES = Object.keys(ICONS);

/**
 * Optional raster art per icon (e.g. a painted pack in /assets/ui/). An entry here wins over the SVG;
 * names without an entry keep the hand-drawn SVG. Example: IMG.coin = '/assets/ui/coin.webp'.
 */
export const IMG: Partial<Record<string, string>> = {};

const has = (n: string | undefined) => !!n && (!!ICONS[n] || !!IMG[n]);
const resolve = (name: string) => (has(name) ? name : has(ALIAS[name]) ? ALIAS[name] : 'sparkle');
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** An icon as inline SVG (or <img> when IMG has art for it). size in px (default 1em: follows the text). label → role=img with that name. */
export function icon(name: string, size?: number, label?: string): string {
  const n = resolve(name);
  const img = IMG[n];
  if (img) {
    const dim = size ? `width="${size}" height="${size}"` : '';
    return `<img class="ico ico-${n}" src="${img}" ${dim} alt="${label ? esc(label) : ''}"${label ? '' : ' aria-hidden="true"'} draggable="false">`;
  }
  const dim = size ? `width="${size}" height="${size}"` : 'width="1em" height="1em"';
  const a11y = label ? `role="img" aria-label="${esc(label)}"` : 'aria-hidden="true"';
  return `<svg class="ico ico-${n}" viewBox="0 0 32 32" ${dim} ${a11y} focusable="false">${ICONS[n]}</svg>`;
}

/** An icon as a CSS url() value (for backgrounds / masks). */
export function iconURL(name: string): string {
  const n = resolve(name);
  if (IMG[n]) return `url("${IMG[n]}")`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${ICONS[n]}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

// ------------------------------------------------------------------ emoji → icon swap

const keys = Object.keys(EMOJI).sort((a, b) => b.length - a.length).map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
const RE = new RegExp(`(?:${keys.join('|')})\\uFE0F?`, 'gu');
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'OPTION', 'SELECT', 'TITLE', 'CANVAS', 'NOSCRIPT']);

function skip(el: Element | null): boolean {
  for (let e = el; e; e = e.parentElement) {
    if (SKIP.has(e.tagName) || e instanceof SVGElement || (e as HTMLElement).dataset?.noicon !== undefined) return true;
    if (e === document.body) return false;
  }
  return false;
}

function swapText(t: Text) {
  const s = t.nodeValue;
  if (!s) return;
  RE.lastIndex = 0;
  if (!RE.test(s)) return;
  const parent = t.parentElement;
  if (!parent || skip(parent)) return;
  RE.lastIndex = 0;
  const frag = document.createDocumentFragment();
  let at = 0;
  for (const m of s.matchAll(RE)) {
    const i = m.index ?? 0;
    if (i > at) frag.appendChild(document.createTextNode(s.slice(at, i)));
    const span = document.createElement('span');
    span.className = 'ico-w';
    span.innerHTML = icon(EMOJI[m[0].replace(/️/g, '')] ?? EMOJI[m[0]] ?? 'sparkle');
    frag.appendChild(span);
    at = i + m[0].length;
  }
  if (at < s.length) frag.appendChild(document.createTextNode(s.slice(at)));
  t.replaceWith(frag);
}

/** Swap emoji for icons in a subtree (text only; attributes keep their emoji). */
export function iconify(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) return swapText(root as Text);
  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
  if (root instanceof Element && skip(root)) return;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const found: Text[] = [];
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    RE.lastIndex = 0;
    if (n.nodeValue && RE.test(n.nodeValue)) found.push(n as Text);
  }
  found.forEach(swapText);
}

const CSS_ICONS = ['coin', 'jar', 'lock', 'star', 'heart', 'moon'];
let started = false;
/** Keep swapping emoji for icons as the UI re-renders. */
export function initIcons() {
  if (started || typeof MutationObserver === 'undefined') return;
  started = true;
  // icons drawn by CSS (coin, sell jar, ...) read these variables
  for (const n of CSS_ICONS) document.documentElement.style.setProperty(`--ico-${n}`, iconURL(n));
  iconify(document.body);
  new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === 'characterData') swapText(m.target as Text);
      else m.addedNodes.forEach((n) => iconify(n));
    }
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
}
