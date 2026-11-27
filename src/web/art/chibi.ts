import type Phaser from 'phaser';
import { L as tr } from '../../shared/i18n';

/**
 * Mochi chibi heroes, built from layered SVG parts (ported from the chibi template).
 *
 * Every hero class keeps its iconic parts (headgear, weapon and, for some, off-hand / back) and its magic
 * colour, so a knight always reads as a knight. Everything else — fur, blush, outfit colours, ears, eyes,
 * mouth, outfit cut, effects — is rolled from a look seed. Look seed 0 is the designed default look.
 */

const L = '#3a2b33';
const st = (w = 4) => `stroke="${L}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"`;
const WOOD = '#a8774c';

function shade(hex: string, amt: number) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt)));
  return '#' + ch.map((v) => f(v).toString(16).padStart(2, '0')).join('');
}
const mir = (s: string) => `<g transform="translate(200 0) scale(-1 1)">${s}</g>`;
const both = (s: string) => s + mir(s);
const star4 = (x: number, y: number, r: number, fill: string) =>
  `<path d="M${x} ${y - r} Q${x} ${y} ${x + r} ${y} Q${x} ${y} ${x} ${y + r} Q${x} ${y} ${x - r} ${y} Q${x} ${y} ${x} ${y - r} Z" fill="${fill}" stroke="${L}" stroke-width="2" stroke-linejoin="round"/>`;

export interface Pal {
  body: string;
  inner: string;
  outfit: string;
  trim: string;
  metal: string;
  accent: string;
}
type Slot = 'ears' | 'eyes' | 'mouth' | 'headgear' | 'outfit' | 'back' | 'weapon' | 'offhand' | 'fx';
type Part = { d: (p: Pal) => string; front?: boolean };
export interface Look {
  hero: string;
  parts: Record<Slot, string>;
  pal: Pal;
  /** meme face (replaces eyes + mouth) and prop; normal odds like every other part */
  meme?: { face?: string; extra?: string };
}

// ---------------------------------------------------------------- parts

const P: Record<Slot, Record<string, Part>> = {
  ears: {
    // sim v21: แมวกวัก
    cat: { d: (p) => both(`<path d="M48 76 L54 24 L90 50 Z" fill="${p.body}" ${st()}/><path d="M57 62 L60 38 L78 51 Z" fill="${p.inner}"/>`) },
    // sim v21: เต่าเซียน (the hat covers the head)
    none: { d: () => '' },
    bunny: { d: (p) => both(`<ellipse cx="74" cy="30" rx="14" ry="36" transform="rotate(-14 74 30)" fill="${p.body}" ${st()}/><ellipse cx="74" cy="33" rx="6.5" ry="25" transform="rotate(-14 74 33)" fill="${p.inner}"/>`) },
    perky: { d: (p) => both(`<ellipse cx="66" cy="42" rx="16" ry="28" transform="rotate(-26 66 42)" fill="${p.body}" ${st()}/><ellipse cx="66" cy="45" rx="8" ry="19" transform="rotate(-26 66 45)" fill="${p.inner}"/>`) },
    tipped: {
      d: (p) =>
        `<ellipse cx="74" cy="30" rx="14" ry="36" transform="rotate(-14 74 30)" fill="${p.body}" ${st()}/><ellipse cx="74" cy="33" rx="6.5" ry="25" transform="rotate(-14 74 33)" fill="${p.inner}"/>` +
        `<path d="M118 56 C 120 30 134 16 150 14 C 170 12 182 26 176 40 C 166 34 150 36 140 50 C 136 56 130 62 118 56 Z" fill="${p.body}" ${st()}/><path d="M134 44 C 142 30 156 26 168 30" fill="none" stroke="${p.inner}" stroke-width="6" stroke-linecap="round"/>`,
    },
    floppy: { front: true, d: (p) => both(`<path d="M46 64 C 22 70 16 114 28 132 C 38 144 54 130 55 110 C 56 92 58 72 46 64 Z" fill="${shade(p.body, -0.1)}" ${st()}/><path d="M42 80 C 32 92 30 112 34 124" fill="none" stroke="${p.inner}" stroke-width="5" stroke-linecap="round"/>`) },
  },
  eyes: {
    dot: { d: () => [78, 122].map((x) => `<ellipse cx="${x}" cy="101" rx="5.5" ry="7" fill="${L}"/><circle cx="${x - 1.6}" cy="98.4" r="2" fill="#fff"/>`).join('') },
    sparkle: { d: () => [78, 122].map((x) => `<ellipse cx="${x}" cy="101" rx="8" ry="10" fill="${L}"/><circle cx="${x - 2.6}" cy="97" r="3.3" fill="#fff"/><circle cx="${x + 2.6}" cy="105" r="1.6" fill="#fff"/>`).join('') },
    brave: { d: () => [78, 122].map((x) => `<ellipse cx="${x}" cy="102" rx="5.5" ry="7" fill="${L}"/><circle cx="${x - 1.6}" cy="99.4" r="2" fill="#fff"/>`).join('') + `<path d="M68 89 L86 93 M132 89 L114 93" stroke="${L}" stroke-width="3.6" stroke-linecap="round" fill="none"/>` },
    happy: { d: () => [78, 122].map((x) => `<path d="M${x - 8} 104 Q${x} 92 ${x + 8} 104" fill="none" ${st(4)}/>`).join('') },
    sleepy: { d: () => [78, 122].map((x) => `<path d="M${x - 8} 99 Q${x} 107 ${x + 8} 99" fill="none" ${st(4)}/>`).join('') },
  },
  mouth: {
    smile: { d: () => `<path d="M94 113 Q100 119 106 113" fill="none" ${st(3.4)}/>` },
    cat: { d: () => `<path d="M90 112 Q95 118 100 112 Q105 118 110 112" fill="none" ${st(3.4)}/>` },
    open: { d: () => `<ellipse cx="100" cy="116" rx="5" ry="6" fill="#c2566a" ${st(3)}/>` },
    wobble: { d: () => `<path d="M91 116 Q95.5 112 100 116 Q104.5 120 109 116" fill="none" ${st(3.4)}/>` },
    fang: { d: () => `<path d="M92 113 Q100 120 108 113" fill="none" ${st(3.4)}/><path d="M102 116.5 L104.5 122 L107 115" fill="#fff" ${st(2.2)}/>` },
  },
  headgear: {
    none: { d: () => '' },
    sagehat: {
      d: (p) =>
        `<path d="M22 78 Q100 6 178 78 Q100 92 22 78 Z" fill="#e8c37a" ${st()}/><path d="M60 52 Q100 40 140 52" fill="none" stroke="#c99a4a" stroke-width="3"/>` +
        `<path d="M44 68 Q100 54 156 68" fill="none" stroke="${p.outfit}" stroke-width="7"/><circle cx="100" cy="30" r="7" fill="${p.accent}" ${st(3)}/>`,
    },
    helmet: { d: (p) => `<path d="M100 32 C 96 12 112 2 128 8 C 118 13 113 21 111 33 Z" fill="${p.accent}" ${st()}/><path d="M36 84 C 36 46 64 30 100 30 C 136 30 164 46 164 84 Q100 70 36 84 Z" fill="${p.metal}" ${st()}/><path d="M100 32 L100 74" stroke="${shade(p.metal, -0.18)}" stroke-width="4" stroke-linecap="round"/><path d="M34 84 Q100 70 166 84 L166 92 Q100 78 34 92 Z" fill="${p.trim}" ${st()}/>` },
    leaf: { d: (p) => `<path d="M34 88 C 30 48 66 28 100 28 C 138 28 170 50 166 88 Q100 68 34 88 Z" fill="${p.outfit}" ${st()}/><path d="M60 52 Q70 62 72 76 M140 52 Q130 62 128 76" stroke="${shade(p.outfit, -0.25)}" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M100 30 Q98 18 104 10" fill="none" ${st(3.5)}/><path d="M104 12 C 112 0 128 2 131 8 C 122 17 110 17 104 12 Z" fill="${p.accent}" ${st(3)}/><path d="M100 19 C 90 9 76 11 73 17 C 82 24 94 24 100 19 Z" fill="${p.accent}" ${st(3)}/>` },
    hood: { d: (p) => `<path d="M28 126 C 20 72 32 46 60 34 C 80 26 120 26 140 34 C 168 46 180 72 172 126 C 160 106 146 88 100 86 C 54 88 40 106 28 126 Z" fill="${p.outfit}" ${st()}/><path d="M44 108 C 56 94 76 90 100 90" fill="none" stroke="${shade(p.outfit, 0.18)}" stroke-width="3" stroke-linecap="round"/><path d="M40 92 Q100 74 160 92 L158 102 Q100 84 42 102 Z" fill="${p.trim}" ${st(3)}/>` },
    beret: { d: (p) => `<path d="M138 56 C 150 30 170 16 184 12 C 178 30 164 48 146 62 Z" fill="${p.accent}" ${st(3.5)}/><path d="M46 70 C 46 44 110 28 152 50 C 168 58 160 74 142 74 C 110 76 78 74 46 70 Z" fill="${p.outfit}" ${st()}/><circle cx="102" cy="44" r="5" fill="${p.trim}" ${st(3)}/>` },
    horned: { d: (p) => both(`<path d="M52 60 C 28 58 16 38 24 16 C 34 34 48 40 64 44 Z" fill="${p.trim}" ${st()}/>`) + `<path d="M42 82 C 44 46 70 32 100 32 C 130 32 156 46 158 82 Q100 66 42 82 Z" fill="${p.metal}" ${st()}/><path d="M40 82 Q100 66 160 82 L160 90 Q100 74 40 90 Z" fill="${p.outfit}" ${st()}/><circle cx="70" cy="62" r="3" fill="${shade(p.metal, -0.3)}"/><circle cx="130" cy="62" r="3" fill="${shade(p.metal, -0.3)}"/>` },
    flamecap: { d: (p) => `<path d="M102 24 C 90 10 100 -4 108 4 C 112 -4 124 0 121 11 C 130 13 126 26 113 27 Z" fill="${p.accent}" ${st(3.5)}/><path d="M42 86 C 52 54 76 24 106 22 C 104 36 122 48 150 64 C 160 70 162 80 158 88 Q100 70 42 86 Z" fill="${p.outfit}" ${st()}/><path d="M40 86 Q100 70 160 88 L160 95 Q100 77 40 93 Z" fill="${p.trim}" ${st()}/>` },
    witch: { d: (p) => `<ellipse cx="100" cy="76" rx="76" ry="12" fill="${p.outfit}" ${st()}/><path d="M60 74 C 70 48 80 18 98 -6 C 106 8 114 12 128 16 C 118 30 128 54 140 74 Z" fill="${p.outfit}" ${st()}/><path d="M63 64 Q100 72 137 64 L139 73 Q100 81 61 73 Z" fill="${p.trim}" ${st(3)}/>` + star4(100, 69, 7, p.accent) },
    starcap: { d: (p) => `<path d="M40 86 C 40 44 80 28 112 32 C 144 36 166 30 178 54 C 170 52 162 56 158 66 C 160 74 160 80 158 86 Q100 70 40 86 Z" fill="${p.outfit}" ${st()}/><circle cx="179" cy="56" r="9" fill="${p.trim}" ${st(3.5)}/>` + star4(78, 56, 6, p.trim) + star4(120, 46, 5, p.trim) + star4(140, 70, 4, p.trim) },
  },
  outfit: {
    bellcollar: {
      d: (p) =>
        `<path d="M62 148 Q100 136 138 148 L142 188 Q100 200 58 188 Z" fill="${p.outfit}" ${st()}/>` +
        `<path d="M64 150 Q100 164 136 150" fill="none" stroke="#d8504a" stroke-width="10" stroke-linecap="round"/>` +
        `<circle cx="100" cy="163" r="9" fill="#ffd36e" ${st(3)}/><path d="M93 164 L107 164" stroke="${L}" stroke-width="2.5"/><circle cx="100" cy="168" r="1.8" fill="${L}"/>`,
    },
    plate: { d: (p) => `<path d="M64 150 C 70 140 130 140 136 150 L 138 180 C 122 194 78 194 62 180 Z" fill="${p.metal}" ${st()}/><path d="M100 148 L100 182" stroke="${p.trim}" stroke-width="6" stroke-linecap="round"/><path d="M62 176 Q100 190 138 176 L138 185 Q100 199 62 185 Z" fill="${shade(p.outfit, -0.2)}" ${st(3.5)}/><rect x="93" y="180" width="14" height="11" rx="3" fill="${p.trim}" ${st(3)}/>` },
    tunic: { d: (p) => `<path d="M62 148 Q100 136 138 148 L142 188 Q100 200 58 188 Z" fill="${p.outfit}" ${st()}/><path d="M60 172 Q100 184 140 172" fill="none" stroke="${p.trim}" stroke-width="6" stroke-linecap="round"/>` + [70, 88, 106, 124].map((x) => `<path d="M${x} 190 q6 10 12 0 q-6 -6 -12 0z" fill="${p.accent}" ${st(2.5)}/>`).join('') },
    scarf: { d: (p) => `<path d="M62 148 Q100 136 138 148 L142 188 Q100 200 58 188 Z" fill="${p.outfit}" ${st()}/><path d="M124 150 L152 182 L138 188 L114 158 Z" fill="${p.trim}" ${st(3.5)}/><path d="M58 140 Q100 158 142 140 L142 153 Q100 171 58 153 Z" fill="${p.trim}" ${st(3.5)}/>` },
    vest: { d: (p) => both(`<path d="M62 150 Q76 141 92 143 L90 192 Q74 193 60 186 Z" fill="${p.outfit}" ${st()}/>`) + `<circle cx="84" cy="160" r="3" fill="${p.trim}"/><circle cx="84" cy="175" r="3" fill="${p.trim}"/><path d="M84 141 Q100 154 116 141 Q100 148 84 141 Z" fill="#fff" ${st(3)}/>` },
    strap: { d: (p) => `<path d="M62 176 Q100 190 138 176 L142 192 Q100 206 58 192 Z" fill="${p.outfit}" ${st()}/><path d="M68 146 L136 182 L130 191 L62 155 Z" fill="${p.trim}" ${st(3.5)}/><path d="M48 156 q2 -14 16 -10 q8 -10 18 -2 q6 10 -4 14 q-16 10 -30 -2z" fill="${p.trim}" ${st(3.5)}/>` },
    robe: { d: (p) => `<path d="M60 146 Q100 134 140 146 L150 196 Q100 210 50 196 Z" fill="${p.outfit}" ${st()}/><path d="M52 187 Q100 201 148 187 L150 196 Q100 210 50 196 Z" fill="${p.trim}" ${st(3)}/><path d="M80 144 L100 162 L120 144" fill="none" stroke="${p.trim}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>` },
  },
  back: {
    none: { d: () => '' },
    shell: {
      d: (p) =>
        `<ellipse cx="100" cy="150" rx="74" ry="58" fill="#7cc46a" ${st()}/><ellipse cx="100" cy="150" rx="56" ry="42" fill="#9edb83" ${st(3)}/>` +
        `<path d="M100 112 L124 128 L120 158 L80 158 L76 128 Z" fill="none" stroke="#5a9a4a" stroke-width="4" stroke-linejoin="round"/>` +
        `<path d="M76 128 L50 120 M124 128 L150 120 M80 158 L64 182 M120 158 L136 182" stroke="#5a9a4a" stroke-width="4" stroke-linecap="round"/>`,
    },
    cape: { d: (p) => `<path d="M64 140 C 50 168 44 192 34 207 Q100 194 166 207 C 156 192 150 168 136 140 Z" fill="${shade(p.outfit, -0.28)}" ${st()}/>` },
    thorns: {
      d: (p) => {
        let d = '';
        const n = 15;
        for (let i = 0; i <= n * 2; i++) {
          const a = ((-22 + i * (224 / (n * 2))) * Math.PI) / 180;
          const r = i % 2 ? 94 : 66;
          d += (i ? 'L' : 'M') + (100 + r * Math.cos(a)).toFixed(1) + ' ' + (104 - r * Math.sin(a)).toFixed(1) + ' ';
        }
        return `<path d="${d}Z" fill="${p.trim}" ${st()}/>`;
      },
    },
    crystals: { d: (p) => both(`<path d="M46 152 L16 102 L54 128 Z" fill="${shade(p.accent, 0.35)}" ${st(3.5)}/><path d="M40 112 L30 64 L60 96 Z" fill="${p.accent}" ${st(3.5)}/>`) },
    halo: {
      d: (p) =>
        `<circle cx="100" cy="98" r="88" fill="none" stroke="${L}" stroke-width="12"/><circle cx="100" cy="98" r="88" fill="none" stroke="${p.accent}" stroke-width="6"/>` +
        Array.from({ length: 12 }, (_, i) => {
          const a = (i * Math.PI) / 6;
          return `<circle cx="${(100 + 88 * Math.cos(a)).toFixed(1)}" cy="${(98 + 88 * Math.sin(a)).toFixed(1)}" r="${i % 3 ? 3.5 : 6}" fill="${p.trim}" ${st(2.5)}/>`;
        }).join(''),
    },
  },
  weapon: {
    koban: {
      d: (p) =>
        `<ellipse cx="152" cy="140" rx="21" ry="28" fill="#ffd36e" ${st()}/><ellipse cx="152" cy="140" rx="13" ry="19" fill="none" stroke="#e0a92c" stroke-width="3"/>` +
        `<path d="M156 128 A 11 11 0 1 0 156 152 A 8 8 0 1 1 156 128 Z" fill="#fff3c4"/><path d="M140 122 L144 116" stroke="#fff" stroke-width="3" stroke-linecap="round"/>`,
    },
    gourdstaff: {
      d: (p) =>
        `<rect x="143" y="74" width="8" height="106" rx="4" fill="${WOOD}" ${st(3.5)}/><circle cx="147" cy="66" r="11" fill="#e8a14a" ${st()}/>` +
        `<circle cx="147" cy="46" r="8" fill="#e8a14a" ${st()}/><path d="M147 38 L147 32" ${st(3)}/><path d="M138 62 Q147 58 156 62" fill="none" stroke="${p.accent}" stroke-width="3"/>`,
    },
    sword: { d: (p) => `<path d="M141 150 L141 96 L147 84 L153 96 L153 150 Z" fill="${p.metal}" ${st()}/><path d="M147 94 L147 144" stroke="#fff" stroke-opacity=".75" stroke-width="2.5" stroke-linecap="round"/><rect x="130" y="148" width="34" height="8" rx="4" fill="${p.trim}" ${st(3.5)}/><rect x="143" y="156" width="8" height="16" rx="3" fill="${shade(p.outfit, -0.25)}" ${st(3)}/><circle cx="147" cy="175" r="5" fill="${p.trim}" ${st(3)}/>` },
    rapier: { d: (p) => `<path d="M145 150 L147 58 L149 150 Z" fill="${p.metal}" ${st(3)}/><path d="M134 151 C 134 140 160 140 160 151 C 160 159 134 159 134 151 Z" fill="${p.trim}" ${st(3.5)}/><rect x="143" y="157" width="8" height="14" rx="3" fill="${shade(p.outfit, -0.25)}" ${st(3)}/>` },
    dagger: { d: (p) => `<path d="M141 152 L141 128 L147 114 L153 128 L153 152 Z" fill="${p.metal}" ${st()}/><rect x="134" y="150" width="26" height="7" rx="3.5" fill="${p.trim}" ${st(3)}/><rect x="143" y="157" width="8" height="14" rx="3" fill="${shade(p.outfit, -0.25)}" ${st(3)}/>` },
    axe: { d: (p) => `<rect x="143" y="84" width="8" height="96" rx="4" fill="${WOOD}" ${st(3.5)}/><path d="M151 90 C 174 82 192 102 186 128 C 178 121 165 121 151 125 Z" fill="${p.metal}" ${st()}/><path d="M158 94 C 172 92 182 104 181 118" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="2.5" stroke-linecap="round"/><path d="M143 98 L126 105 L143 113 Z" fill="${p.metal}" ${st(3.5)}/>` },
    club: {
      d: (p) =>
        `<path d="M140 176 L137 120 C 134 94 164 92 161 120 L155 176 Z" fill="${WOOD}" ${st()}/>` +
        ([[136, 112, -1], [162, 110, 1], [138, 132, -1], [160, 130, 1], [149, 96, 0]] as const)
          .map(([x, y, s]) =>
            s === 0
              ? `<path d="M${x - 5} ${y + 2} L${x} ${y - 10} L${x + 5} ${y + 2} Z" fill="${p.metal}" ${st(2.5)}/>`
              : `<path d="M${x} ${y - 5} L${x + 11 * s} ${y} L${x} ${y + 5} Z" fill="${p.metal}" ${st(2.5)}/>`,
          )
          .join(''),
    },
    flamestaff: { d: (p) => `<rect x="143" y="70" width="8" height="108" rx="4" fill="${WOOD}" ${st(3.5)}/><path d="M147 30 C 132 46 134 62 147 66 C 160 62 162 46 147 30 Z" fill="${p.accent}" ${st(3.5)}/><path d="M147 46 C 141 54 142 61 147 62 C 152 61 153 54 147 46 Z" fill="#fff4c2"/><path d="M134 66 Q147 82 160 66" fill="none" ${st(4)}/>` },
    icewand: { d: (p) => `<rect x="144" y="100" width="6" height="76" rx="3" fill="${p.trim}" ${st(3)}/><path d="M147 62 L159 84 L147 106 L135 84 Z" fill="${p.accent}" ${st()}/><path d="M147 70 L152 84" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>` },
    hourglass: { d: (p) => `<rect x="143" y="92" width="8" height="86" rx="4" fill="${shade(p.outfit, -0.2)}" ${st(3.5)}/><path d="M135 58 L159 58 L149 74 L159 90 L135 90 L145 74 Z" fill="${shade(p.metal, 0.3)}" ${st(3.5)}/><path d="M139 85 L155 85 L159 90 L135 90 Z" fill="${p.accent}"/><path d="M139 62 L155 62 L149 70 L145 70 Z" fill="${p.accent}"/><rect x="130" y="52" width="34" height="7" rx="3.5" fill="${p.trim}" ${st(3)}/><rect x="130" y="89" width="34" height="7" rx="3.5" fill="${p.trim}" ${st(3)}/>` },
  },
  offhand: {
    none: { d: () => '' },
    paw: {
      d: (p) =>
        `<path d="M40 150 L40 112" stroke="${p.body}" stroke-width="16" stroke-linecap="round"/><path d="M40 150 L40 112" fill="none" ${st(2)} opacity=".0"/>` +
        `<ellipse cx="40" cy="104" rx="15" ry="16" fill="${p.body}" ${st()}/><ellipse cx="40" cy="108" rx="6" ry="5" fill="${p.inner}"/>` +
        [[31, 97], [40, 93], [49, 97]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.6" fill="${p.inner}"/>`).join(''),
    },
    shield: { d: (p) => `<circle cx="52" cy="166" r="27" fill="${p.metal}" ${st()}/><circle cx="52" cy="166" r="18" fill="${p.outfit}" ${st(3)}/>` + star4(52, 166, 9, p.trim) },
    buckler: {
      d: (p) =>
        Array.from({ length: 8 }, (_, i) => {
          const a = (i * Math.PI) / 4;
          const pt = (r: number, o: number) => `${(52 + r * Math.cos(a + o)).toFixed(1)} ${(166 + r * Math.sin(a + o)).toFixed(1)}`;
          return `<path d="M${pt(20, -0.28)} L${pt(30, 0)} L${pt(20, 0.28)} Z" fill="${p.metal}" ${st(2.5)}/>`;
        }).join('') + `<circle cx="52" cy="166" r="22" fill="${p.trim}" ${st()}/><circle cx="52" cy="166" r="8" fill="${p.metal}" ${st(3)}/>`,
    },
    dagger: { d: (p) => `<path d="M53 158 L40 124 L48 121 L61 155 Z" fill="${p.metal}" ${st(3.5)}/><rect x="46" y="152" width="22" height="7" rx="3.5" transform="rotate(-22 57 155)" fill="${p.trim}" ${st(3)}/>` },
    tome: { d: (p) => `<rect x="30" y="146" width="32" height="38" rx="5" transform="rotate(-10 46 165)" fill="${shade(p.outfit, -0.25)}" ${st()}/><rect x="56" y="150" width="6" height="32" rx="2" transform="rotate(-10 46 165)" fill="${p.trim}"/>` + star4(45, 165, 8, p.accent) },
    orb: { d: (p) => `<circle cx="50" cy="146" r="15" fill="${p.accent}" fill-opacity=".9" ${st()}/><circle cx="45" cy="141" r="4.5" fill="#fff"/>` },
  },
  fx: {
    none: { d: () => '' },
    coins: { d: () => ([[28, 70, 7], [176, 46, 6], [182, 128, 7], [22, 150, 5]] as const).map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#ffd36e" ${st(2.5)}/><circle cx="${x - r / 3}" cy="${y - r / 3}" r="${r / 3}" fill="#fff6d0"/>`).join('') },
    sparkles: { d: (p) => star4(28, 64, 9, p.accent) + star4(174, 40, 7, p.accent) + star4(180, 132, 8, p.trim) + star4(20, 150, 6, p.trim) },
    embers: { d: (p) => ([[36, 140], [166, 116], [58, 58], [152, 52], [24, 98], [180, 170]] as const).map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${i % 2 ? 4 : 5.5}" fill="${i % 2 ? p.trim : p.accent}" ${st(2)}/>`).join('') },
    frost: { d: (p) => ([[26, 70, 8], [176, 44, 6], [182, 140, 7], [18, 156, 5]] as const).map(([x, y, r]) => [0, 60, 120].map((a) => `<path d="M${x} ${y - r} L${x} ${y + r}" transform="rotate(${a} ${x} ${y})" stroke="${p.accent}" stroke-width="3" stroke-linecap="round"/>`).join('')).join('') },
    shine: { d: (p) => star4(168, 80, 9, '#fff') + star4(30, 124, 6, p.trim) + star4(176, 150, 5, '#fff') },
  },
};

// ---------------------------------------------------------------- classes

interface ClassDef {
  /** parts every copy of this hero has */
  icon: Partial<Record<Slot, string>>;
  /** magic colour (part of the class identity) */
  accent: string;
  /** the designed look, used for look seed 0 */
  base: { parts: Record<Slot, string>; pal: Pal };
  outfits: string[];
  fx: string[];
}

const CLASSES: Record<string, ClassDef> = {
  knight: {
    icon: { headgear: 'helmet', weapon: 'sword', offhand: 'shield' }, accent: '#ff6b81',
    base: { parts: { ears: 'bunny', eyes: 'brave', mouth: 'smile', headgear: 'helmet', outfit: 'plate', back: 'cape', weapon: 'sword', offhand: 'shield', fx: 'shine' }, pal: { body: '#fff6ec', inner: '#ffb3c1', outfit: '#5b7fd6', trim: '#f2c14e', metal: '#d5ddea', accent: '#ff6b81' } },
    outfits: ['plate', 'tunic', 'scarf'], fx: ['none', 'shine'],
  },
  thornguard: {
    icon: { headgear: 'leaf', weapon: 'club', offhand: 'buckler', back: 'thorns' }, accent: '#b4e36e',
    base: { parts: { ears: 'perky', eyes: 'dot', mouth: 'cat', headgear: 'leaf', outfit: 'tunic', back: 'thorns', weapon: 'club', offhand: 'buckler', fx: 'none' }, pal: { body: '#f6ead8', inner: '#ffb0a8', outfit: '#6fae5a', trim: '#9a6a46', metal: '#d9dcc4', accent: '#b4e36e' } },
    outfits: ['tunic', 'vest', 'strap'], fx: ['none'],
  },
  assassin: {
    icon: { headgear: 'hood', weapon: 'dagger', offhand: 'dagger' }, accent: '#ff6f8a',
    base: { parts: { ears: 'bunny', eyes: 'brave', mouth: 'smile', headgear: 'hood', outfit: 'scarf', back: 'none', weapon: 'dagger', offhand: 'dagger', fx: 'sparkles' }, pal: { body: '#ffffff', inner: '#ffa6b8', outfit: '#4a3a63', trim: '#d8504a', metal: '#e3e7ef', accent: '#ff6f8a' } },
    outfits: ['scarf', 'vest', 'strap'], fx: ['none', 'sparkles'],
  },
  duelist: {
    icon: { headgear: 'beret', weapon: 'rapier', back: 'cape' }, accent: '#ffd1e0',
    base: { parts: { ears: 'bunny', eyes: 'sparkle', mouth: 'open', headgear: 'beret', outfit: 'vest', back: 'cape', weapon: 'rapier', offhand: 'none', fx: 'sparkles' }, pal: { body: '#fff8f4', inner: '#ffadc6', outfit: '#ff7aa2', trim: '#fbe0a0', metal: '#e9eef6', accent: '#ffd1e0' } },
    outfits: ['vest', 'scarf', 'tunic'], fx: ['none', 'sparkles'],
  },
  berserker: {
    icon: { headgear: 'horned', weapon: 'axe' }, accent: '#f08a4b',
    base: { parts: { ears: 'perky', eyes: 'brave', mouth: 'fang', headgear: 'horned', outfit: 'strap', back: 'none', weapon: 'axe', offhand: 'none', fx: 'embers' }, pal: { body: '#ffe9d6', inner: '#ff9f8f', outfit: '#c75b39', trim: '#f4ead2', metal: '#b8c1cf', accent: '#f08a4b' } },
    outfits: ['strap', 'tunic', 'vest'], fx: ['none', 'embers'],
  },
  pyro: {
    icon: { headgear: 'flamecap', weapon: 'flamestaff', offhand: 'tome' }, accent: '#ffb347',
    base: { parts: { ears: 'tipped', eyes: 'happy', mouth: 'cat', headgear: 'flamecap', outfit: 'robe', back: 'none', weapon: 'flamestaff', offhand: 'tome', fx: 'embers' }, pal: { body: '#fff3e6', inner: '#ffab94', outfit: '#e2533d', trim: '#ffc857', metal: '#8b5a3c', accent: '#ffb347' } },
    outfits: ['robe', 'scarf', 'tunic'], fx: ['none', 'embers'],
  },
  witch: {
    icon: { headgear: 'witch', weapon: 'icewand', back: 'crystals' }, accent: '#8fe8ff',
    base: { parts: { ears: 'floppy', eyes: 'sparkle', mouth: 'smile', headgear: 'witch', outfit: 'robe', back: 'crystals', weapon: 'icewand', offhand: 'orb', fx: 'frost' }, pal: { body: '#f6fbff', inner: '#ffb8cf', outfit: '#4f78c8', trim: '#c8eeff', metal: '#dfe8f5', accent: '#8fe8ff' } },
    outfits: ['robe', 'scarf'], fx: ['none', 'frost'],
  },
  luckycat: {
    icon: { ears: 'cat', weapon: 'koban', offhand: 'paw' }, accent: '#ffd36e',
    base: { parts: { ears: 'cat', eyes: 'happy', mouth: 'cat', headgear: 'none', outfit: 'bellcollar', back: 'none', weapon: 'koban', offhand: 'paw', fx: 'coins' }, pal: { body: '#ffffff', inner: '#ffb3c1', outfit: '#d8504a', trim: '#ffd36e', metal: '#ffd95e', accent: '#ffd36e' } },
    outfits: ['bellcollar'], fx: ['none', 'coins'],
  },
  sage: {
    icon: { ears: 'none', headgear: 'sagehat', back: 'shell', weapon: 'gourdstaff' }, accent: '#b4b8ff',
    base: { parts: { ears: 'none', eyes: 'sleepy', mouth: 'smile', headgear: 'sagehat', outfit: 'robe', back: 'shell', weapon: 'gourdstaff', offhand: 'none', fx: 'sparkles' }, pal: { body: '#eef6e4', inner: '#ffc4a8', outfit: '#3fa7a0', trim: '#fbe0a0', metal: '#c9d8b6', accent: '#b4b8ff' } },
    outfits: ['robe', 'tunic', 'scarf'], fx: ['none', 'sparkles'],
  },
  chrono: {
    icon: { headgear: 'starcap', weapon: 'hourglass', back: 'halo' }, accent: '#c49bff',
    base: { parts: { ears: 'floppy', eyes: 'sleepy', mouth: 'smile', headgear: 'starcap', outfit: 'robe', back: 'halo', weapon: 'hourglass', offhand: 'none', fx: 'sparkles' }, pal: { body: '#fbf6ff', inner: '#ffb7d5', outfit: '#7b5cc4', trim: '#ffd36e', metal: '#e8dcff', accent: '#c49bff' } },
    outfits: ['robe', 'vest', 'scarf'], fx: ['none', 'sparkles'],
  },
};

const BODY = ['#fff6ec', '#ffffff', '#fff0f3', '#f6ead8', '#eef6e4', '#efe9ff', '#e8c3a0', '#e6f1fb', '#f3ece6', '#ffe9d6'];
const INNER = ['#ffb3c1', '#ffa6b8', '#ffadc6', '#ff9f8f', '#ffb7d5', '#ffc4a8', '#f7a8d8'];
const OUTFIT = ['#5b7fd6', '#6fae5a', '#4a3a63', '#ff7aa2', '#c75b39', '#e2533d', '#4f78c8', '#7b5cc4', '#2f2f5a', '#8fbf7a', '#6b4130', '#3fa7a0', '#d9a03f', '#9a4f8f', '#ff8fab', '#5a6b7f'];
const TRIM = ['#f2c14e', '#fff1f4', '#c8eeff', '#ffd36e', '#f4ead2', '#9aa7ff', '#d8504a', '#fbe0a0', '#9a6a46', '#b8f0d0'];
const METAL = ['#d5ddea', '#e3e7ef', '#b8c1cf', '#ffd95e', '#e8dcff', '#c9d8b6', '#f3c9a8'];
const EARS = ['bunny', 'perky', 'tipped', 'floppy'];
const EYES = ['dot', 'sparkle', 'brave', 'happy', 'sleepy'];
const MOUTHS = ['smile', 'cat', 'open', 'fang'];

// ---------------------------------------------------------------- meme faces and props
// Meme-style expressions and props, drawn in our own mochi style (no copied meme characters or images).

const W_MOUTH = `<path d="M92 113 Q96 119 100 114 Q104 119 108 113" fill="none" ${st(3.4)}/>`;
const D_MOUTH = `<path d="M87 109 Q100 134 113 109 Z" fill="#c2566a" ${st(3)}/><path d="M93 121 Q100 127 107 121" fill="#ff9fb0"/>`;
const BLUSH_LINES = both(`<path d="M54 112 l4 -6 M61 113 l4 -6 M68 114 l4 -6" stroke="#ff6f8f" stroke-width="2.6" stroke-linecap="round"/>`);
const EYE_X = [78, 122];
const heart = (x: number, y: number, r: number) =>
  `<path d="M${x} ${y + r * 0.8} C ${x - r * 1.4} ${y - r * 0.2} ${x - r * 0.9} ${y - r * 1.3} ${x} ${y - r * 0.45} C ${x + r * 0.9} ${y - r * 1.3} ${x + r * 1.4} ${y - r * 0.2} ${x} ${y + r * 0.8} Z" fill="#ff4d6d" ${st(2.6)}/>`;
const star5 = (x: number, y: number, r: number, fill: string) => {
  let d = '';
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    d += (i ? 'L' : 'M') + (x + rr * Math.cos(a)).toFixed(1) + ' ' + (y + rr * Math.sin(a)).toFixed(1) + ' ';
  }
  return `<path d="${d}Z" fill="${fill}" ${st(2.4)}/>`;
};

/** Meme faces: replace the eyes and mouth. */
const MEME_FACE: Record<string, () => string> = {
  uwu: () => EYE_X.map((x) => `<path d="M${x - 7} 94 L${x - 7} 100 Q${x} 110 ${x + 7} 100 L${x + 7} 94" fill="none" ${st(4)}/>`).join('') + W_MOUTH + BLUSH_LINES,
  owo: () => EYE_X.map((x) => `<circle cx="${x}" cy="101" r="9.5" fill="#fff" ${st(3.5)}/><circle cx="${x}" cy="102" r="4.8" fill="${L}"/>`).join('') + W_MOUTH,
  smug: () =>
    EYE_X.map((x) => `<path d="M${x - 6} 98 Q${x} 108 ${x + 6} 98 Z" fill="${L}"/><path d="M${x - 10} 97 L${x + 10} 97" fill="none" ${st(4)}/>`).join('') +
    `<path d="M68 86 Q78 79 88 85" fill="none" ${st(3.2)}/><path d="M93 115 Q104 118 111 108" fill="none" ${st(3.4)}/>`,
  sideeye: () =>
    EYE_X.map((x) => `<ellipse cx="${x}" cy="102" rx="9.5" ry="7" fill="#fff" ${st(3)}/><circle cx="${x + 5}" cy="103" r="4.2" fill="${L}"/><path d="M${x - 11} 96 L${x + 11} 96" fill="none" ${st(4)}/>`).join('') +
    `<path d="M94 116 L107 115" fill="none" ${st(3.4)}/>`,
  cry: () =>
    EYE_X.map((x) => `<path d="M${x - 8} 103 Q${x} 92 ${x + 8} 103" fill="none" ${st(4)}/>`).join('') +
    both(`<path d="M69 104 Q60 118 64 134" stroke="#7fd3ff" stroke-width="5.5" fill="none" stroke-linecap="round"/>`) + D_MOUTH,
  hearts: () => EYE_X.map((x) => heart(x, 101, 10)).join('') + `<path d="M91 111 Q100 124 109 111 Z" fill="#c2566a" ${st(3)}/>`,
  derp: () =>
    `<circle cx="76" cy="100" r="11" fill="#fff" ${st(3)}/><circle cx="72" cy="96" r="4" fill="${L}"/>` +
    `<circle cx="124" cy="103" r="6" fill="#fff" ${st(3)}/><circle cx="126" cy="105" r="2.6" fill="${L}"/>` +
    `<path d="M91 113 Q100 118 109 113" fill="none" ${st(3.4)}/><path d="M101 115 q1 11 8 8 q4 -4 -2 -9z" fill="#ff8fa3" ${st(2.4)}/>`,
  xd: () => EYE_X.map((x) => `<path d="M${x - 7} 94 L${x + 7} 108 M${x + 7} 94 L${x - 7} 108" fill="none" ${st(4)}/>`).join('') + D_MOUTH,
  lenny: () =>
    EYE_X.map((x) => `<path d="M${x - 10} 91 Q${x} 81 ${x + 10} 91" fill="none" ${st(3)}/><path d="M${x - 8} 103 Q${x} 96 ${x + 8} 103" fill="none" ${st(3.4)}/><circle cx="${x}" cy="102" r="2.6" fill="${L}"/>`).join('') +
    `<path d="M88 115 Q94 121 100 115 M100 115 Q106 121 112 115 M100 115 Q99 120 103 122" fill="none" ${st(3)}/>`,
  stars: () => EYE_X.map((x) => star5(x, 101, 11, '#ffd95e')).join('') + `<path d="M92 112 Q100 121 108 112" fill="none" ${st(3.4)}/>`,
  sweat: () =>
    EYE_X.map((x) => `<ellipse cx="${x}" cy="101" rx="5.5" ry="7" fill="${L}"/><circle cx="${x - 1.6}" cy="98.4" r="2" fill="#fff"/>`).join('') +
    `<path d="M91 116 Q95.5 112 100 116 Q104.5 120 109 116" fill="none" ${st(3.4)}/><path d="M146 90 Q138 104 146 110 Q154 104 146 90 Z" fill="#a8e4ff" ${st(2.6)}/>`,
  shock: () => EYE_X.map((x) => `<circle cx="${x}" cy="100" r="9" fill="#fff" ${st(3)}/><circle cx="${x}" cy="100" r="2.2" fill="${L}"/>`).join('') + `<ellipse cx="100" cy="119" rx="5.5" ry="7.5" fill="#5a2a3a" ${st(3)}/>`,
};

/** Props on the face, drawn over the headgear. */
const MEME_PROP: Record<string, () => string> = {
  shades: () => {
    const lens = (x0: number) => `<path d="M${x0} 93 h32 v8 h-4 v4 h-4 v4 h-8 v-4 h-4 v-4 h-4 v-4 h-4 v-4 h-4 Z" fill="#141018"/>`;
    return `<rect x="40" y="93" width="120" height="5" fill="#141018"/>${lens(62)}${lens(106)}` +
      `<rect x="66" y="96" width="4" height="4" fill="#fff"/><rect x="70" y="100" width="4" height="4" fill="#fff"/><rect x="110" y="96" width="4" height="4" fill="#fff"/><rect x="114" y="100" width="4" height="4" fill="#fff"/>`;
  },
  monocle: () => `<circle cx="122" cy="101" r="13" fill="rgba(200,240,255,.25)" stroke="#e9b949" stroke-width="3.5"/><path d="M133 108 C 146 120 140 138 152 150" fill="none" stroke="#e9b949" stroke-width="2.2" stroke-dasharray="3 3"/>`,
  mustache: () => both(`<path d="M100 110 C 93 104 82 104 77 111 C 73 117 66 114 68 108 C 69 115 78 117 85 113 C 91 109 96 111 100 114 Z" fill="#4a3328" ${st(2.2)}/>`),
  bandage: () => `<g transform="rotate(-22 62 118)"><rect x="50" y="113" width="25" height="10" rx="4" fill="#f5d0a9" ${st(2.4)}/><rect x="58" y="113" width="9" height="10" fill="#ecc092"/><circle cx="60.5" cy="116.5" r="1" fill="#b8865c"/><circle cx="64.5" cy="119.5" r="1" fill="#b8865c"/></g>`,
  clown: () => `<circle cx="100" cy="109" r="7" fill="#ff3b4f" ${st(2.6)}/><circle cx="97.5" cy="106.5" r="2" fill="#fff"/>`,
  bubble: () => `<circle cx="112" cy="112" r="11" fill="rgba(170,225,255,.45)" stroke="#7fbfe6" stroke-width="2.5"/><circle cx="108" cy="108" r="3" fill="#fff" opacity=".9"/>`,
  nerd: () => EYE_X.map((x) => `<circle cx="${x}" cy="101" r="13" fill="rgba(255,255,255,.18)" stroke="${L}" stroke-width="3.8"/>`).join('') +
    `<path d="M91 100 L109 100" stroke="${L}" stroke-width="3.8"/><rect x="95" y="96" width="10" height="8" rx="1.5" fill="#fff" ${st(2)}/>` +
    `<path d="M65 99 L42 95 M135 99 L158 95" stroke="${L}" stroke-width="3.5" stroke-linecap="round"/>`,
};

/** Share of looks with a prop (the rest have none); each of the 7 props is equally likely. */
export const PROP_CHANCE = 0.5;

export const MEME_NAMES: Record<string, () => string> = {
  uwu: () => 'UwU', owo: () => 'OwO', smug: () => tr('หน้ากวน', 'Smug face'), sideeye: () => tr('มองค้อน', 'Side-eye'),
  cry: () => tr('ขำทั้งน้ำตา', 'Crying laughing'), hearts: () => tr('ตาหัวใจ', 'Heart eyes'), derp: () => tr('หน้าเอ๋อ', 'Derp face'),
  xd: () => 'XD', lenny: () => tr('หน้าเลนนี่', 'Lenny face'), stars: () => tr('ตาวิบวับ', 'Star eyes'), sweat: () => tr('เหงื่อตก', 'Nervous sweat'),
  shock: () => tr('ช็อก', 'Shocked'),
  shades: () => tr('แว่นเท่ (Deal with it)', 'Deal-with-it shades'), monocle: () => tr('แว่นข้างเดียว', 'Monocle'), mustache: () => tr('หนวดผู้ดี', 'Fancy mustache'),
  bandage: () => tr('พลาสเตอร์แปะแก้ม', 'Cheek bandage'), clown: () => tr('จมูกตัวตลก', 'Clown nose'), bubble: () => tr('ฟองน้ำมูก', 'Snot bubble'),
  nerd: () => tr('แว่นเนิร์ด', 'Nerd glasses'),
};

/** Every meme face and prop on one hero, for the dev gallery (?looks). */
export function memeGallery(hero = 'knight') {
  const base = rollLook(hero, 0);
  const cell = (look: Look, name: string) => `<figure style="margin:0;text-align:center;width:120px">${renderChibi(look, 'idle', 120)}<figcaption class="small">${name}</figcaption></figure>`;
  return [
    ...Object.keys(MEME_FACE).map((f) => cell({ ...base, meme: { face: f } }, MEME_NAMES[f]())),
    ...Object.keys(MEME_PROP).map((e) => cell({ ...base, meme: { extra: e } }, MEME_NAMES[e]())),
  ].join('');
}

/** mulberry32 */
function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)];
  return Object.assign(pick, { next });
}

/** The look for a hero and look seed. Seed 0 = the designed default; any other seed rolls everything non-iconic. */
export function rollLook(hero: string, seed: number): Look {
  const c = CLASSES[hero] ?? CLASSES.knight;
  if (!seed) return { hero, parts: { ...c.base.parts }, pal: { ...c.base.pal } };
  const pick = rng(seed);
  const outfit = pick(OUTFIT);
  let trim = pick(TRIM);
  if (trim === outfit) trim = TRIM[(TRIM.indexOf(trim) + 1) % TRIM.length];
  const parts: Record<Slot, string> = {
    ears: pick(EARS),
    eyes: pick(EYES),
    mouth: pick(MOUTHS),
    headgear: 'none',
    outfit: pick(c.outfits),
    back: pick(['none', 'none', 'cape']),
    weapon: 'sword',
    offhand: 'none',
    fx: pick(c.fx),
    ...c.icon,
  };
  const pal: Pal = { body: pick(BODY), inner: pick(INNER), outfit, trim, metal: pick(METAL), accent: c.accent };
  // Face: the 5 normal eyes and the 12 meme faces are one pool, every face equally likely.
  // Uses its own random stream so the parts above keep their odds.
  const rr = rng(seed ^ 0x9e3779b9);
  const faces = Object.keys(MEME_FACE);
  const meme: NonNullable<Look['meme']> = {};
  const fi = Math.floor(rr.next() * (EYES.length + faces.length));
  if (fi >= EYES.length) meme.face = faces[fi - EYES.length];
  if (rr.next() < PROP_CHANCE) meme.extra = rr(Object.keys(MEME_PROP));
  return { hero, parts, pal, ...(meme.face || meme.extra ? { meme } : {}) };
}

// ---------------------------------------------------------------- render

/** blink / happy are extra idle-animation frames, made only for the hero shown in the shop (see ensureChibiExtras) */
export type ChibiPose = 'idle' | 'cast' | 'hit' | 'blink' | 'happy';
const POSES: ChibiPose[] = ['idle', 'cast', 'hit'];
const EXTRA_POSES: ChibiPose[] = ['blink', 'happy'];
const HEAD = 'M100 40 C 150 40 168 75 166 105 C 164 135 138 148 100 148 C 62 148 36 135 34 105 C 32 75 50 40 100 40 Z';
/** viewBox: x 0..200, y -12..220; the feet stand on y = 207 */
export const VIEW = { w: 200, h: 232, top: -12, feet: 207 };

export function renderChibi(look: Look, pose: ChibiPose = 'idle', size?: number) {
  const p = look.pal;
  const q = look.parts;
  const hit = pose === 'hit';
  const part = (k: Slot) => (P[k][q[k]] ?? P[k][Object.keys(P[k])[0]]).d(p);
  const ear = P.ears[q.ears] ?? P.ears.bunny;
  // a meme face keeps its own eyes and mouth in every pose but 'hit' (no blink/happy frames for it)
  const face = look.meme?.face && MEME_FACE[look.meme.face];
  const eyes = hit
    ? `<path d="M70 94 L84 101 L70 108 M130 94 L116 101 L130 108" fill="none" ${st(4)}/>`
    : face
      ? face()
      : pose === 'blink'
        ? [78, 122].map((x) => `<path d="M${x - 7} 101 Q${x} 105 ${x + 7} 101" fill="none" ${st(4)}/>`).join('')
        : pose === 'happy'
          ? P.eyes.happy.d(p)
          : part('eyes');
  const mouth = hit ? P.mouth.wobble.d(p) : face ? '' : pose === 'happy' ? P.mouth.open.d(p) : part('mouth');
  const extra = look.meme?.extra && MEME_PROP[look.meme.extra] ? MEME_PROP[look.meme.extra]() : '';
  const layers = [
    part('back'),
    ear.front ? '' : ear.d(p),
    `<ellipse cx="100" cy="166" rx="40" ry="32" fill="${p.body}" ${st()}/><ellipse cx="81" cy="199" rx="15" ry="9" fill="${shade(p.body, -0.07)}" ${st()}/><ellipse cx="119" cy="199" rx="15" ry="9" fill="${shade(p.body, -0.07)}" ${st()}/>`,
    part('outfit'),
    `<path d="${HEAD}" fill="${p.body}" ${st()}/>` + (ear.front ? ear.d(p) : ''),
    `<ellipse cx="63" cy="116" rx="9.5" ry="5.5" fill="${p.inner}" opacity=".8"/><ellipse cx="137" cy="116" rx="9.5" ry="5.5" fill="${p.inner}" opacity=".8"/>` + eyes + mouth,
    part('headgear') + extra,
    part('weapon') + `<ellipse cx="142" cy="166" rx="12" ry="11" fill="${p.body}" ${st()}/>`,
    `<ellipse cx="58" cy="166" rx="12" ry="11" fill="${p.body}" ${st()}/>`,
    part('offhand'),
    part('fx'),
  ];
  let inner = `<ellipse cx="100" cy="207" rx="50" ry="7" fill="${L}" opacity=".14"/>`;
  if (pose === 'cast') inner += `<g transform="rotate(6 100 207)">${layers.join('')}</g>` + star4(178, 68, 16, p.accent) + star4(160, 40, 7, '#fff');
  else if (hit) inner += `<g transform="rotate(-6 100 207)">${layers.join('')}</g>`;
  else inner += layers.join('');
  const wh = size ? ` width="${size * (VIEW.w / VIEW.h)}" height="${size}"` : '';
  return `<svg viewBox="0 ${VIEW.top} ${VIEW.w} ${VIEW.h}"${wh} xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
}

// ---------------------------------------------------------------- Phaser textures

/** Texture pixels per viewBox unit. */
const TEX_SCALE = 1.5;
const pending = new Map<string, Promise<string>>();

function svgCanvas(svg: string): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement('canvas');
      cv.width = Math.round(VIEW.w * TEX_SCALE);
      cv.height = Math.round(VIEW.h * TEX_SCALE);
      cv.getContext('2d')!.drawImage(img, 0, 0, cv.width, cv.height);
      resolve(cv);
    };
    img.onerror = reject;
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });
}

/**
 * Make (once) the idle / cast / hit textures for a hero + look seed. Resolves to the key prefix:
 * textures are `${prefix}_idle`, `${prefix}_cast`, `${prefix}_hit`.
 */
export function ensureChibi(scene: Phaser.Scene, hero: string, seed: number): Promise<string> {
  const prefix = `chibi_${hero}_${seed >>> 0}`;
  if (scene.textures.exists(prefix + '_idle')) return Promise.resolve(prefix);
  let p = pending.get(prefix);
  if (!p) {
    const look = rollLook(hero, seed);
    p = Promise.all(
      POSES.map((pose) =>
        svgCanvas(renderChibi(look, pose, VIEW.h * TEX_SCALE)).then((cv) => {
          if (!scene.textures.exists(`${prefix}_${pose}`)) scene.textures.addCanvas(`${prefix}_${pose}`, cv);
        }),
      ),
    ).then(() => prefix);
    pending.set(prefix, p);
  }
  return p;
}

/**
 * Extra idle frames (eyes closed, happy face) for the hero standing in the shop arena. Made lazily, once per look:
 * resolves when `${prefix}_blink` and `${prefix}_happy` exist.
 */
export function ensureChibiExtras(scene: Phaser.Scene, hero: string, seed: number): Promise<string> {
  const prefix = `chibi_${hero}_${seed >>> 0}`;
  const key = prefix + ':extra';
  if (scene.textures.exists(prefix + '_happy')) return Promise.resolve(prefix);
  let p = pending.get(key);
  if (!p) {
    const look = rollLook(hero, seed);
    p = Promise.all(
      EXTRA_POSES.map((pose) =>
        svgCanvas(renderChibi(look, pose, VIEW.h * TEX_SCALE)).then((cv) => {
          if (!scene.textures.exists(`${prefix}_${pose}`)) scene.textures.addCanvas(`${prefix}_${pose}`, cv);
        }),
      ),
    ).then(() => prefix);
    pending.set(key, p);
  }
  return p;
}

/** Display scale for a chibi texture so it stands `height` world units tall (feet to top of viewBox). */
export const chibiScale = (height: number) => height / (VIEW.h * TEX_SCALE);
/** Origin y that puts the feet on the sprite's y. */
export const CHIBI_ORIGIN_Y = (VIEW.feet - VIEW.top) / VIEW.h;
