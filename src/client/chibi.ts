import type Phaser from 'phaser';

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
}

// ---------------------------------------------------------------- parts

const P: Record<Slot, Record<string, Part>> = {
  ears: {
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
    plate: { d: (p) => `<path d="M64 150 C 70 140 130 140 136 150 L 138 180 C 122 194 78 194 62 180 Z" fill="${p.metal}" ${st()}/><path d="M100 148 L100 182" stroke="${p.trim}" stroke-width="6" stroke-linecap="round"/><path d="M62 176 Q100 190 138 176 L138 185 Q100 199 62 185 Z" fill="${shade(p.outfit, -0.2)}" ${st(3.5)}/><rect x="93" y="180" width="14" height="11" rx="3" fill="${p.trim}" ${st(3)}/>` },
    tunic: { d: (p) => `<path d="M62 148 Q100 136 138 148 L142 188 Q100 200 58 188 Z" fill="${p.outfit}" ${st()}/><path d="M60 172 Q100 184 140 172" fill="none" stroke="${p.trim}" stroke-width="6" stroke-linecap="round"/>` + [70, 88, 106, 124].map((x) => `<path d="M${x} 190 q6 10 12 0 q-6 -6 -12 0z" fill="${p.accent}" ${st(2.5)}/>`).join('') },
    scarf: { d: (p) => `<path d="M62 148 Q100 136 138 148 L142 188 Q100 200 58 188 Z" fill="${p.outfit}" ${st()}/><path d="M124 150 L152 182 L138 188 L114 158 Z" fill="${p.trim}" ${st(3.5)}/><path d="M58 140 Q100 158 142 140 L142 153 Q100 171 58 153 Z" fill="${p.trim}" ${st(3.5)}/>` },
    vest: { d: (p) => both(`<path d="M62 150 Q76 141 92 143 L90 192 Q74 193 60 186 Z" fill="${p.outfit}" ${st()}/>`) + `<circle cx="84" cy="160" r="3" fill="${p.trim}"/><circle cx="84" cy="175" r="3" fill="${p.trim}"/><path d="M84 141 Q100 154 116 141 Q100 148 84 141 Z" fill="#fff" ${st(3)}/>` },
    strap: { d: (p) => `<path d="M62 176 Q100 190 138 176 L142 192 Q100 206 58 192 Z" fill="${p.outfit}" ${st()}/><path d="M68 146 L136 182 L130 191 L62 155 Z" fill="${p.trim}" ${st(3.5)}/><path d="M48 156 q2 -14 16 -10 q8 -10 18 -2 q6 10 -4 14 q-16 10 -30 -2z" fill="${p.trim}" ${st(3.5)}/>` },
    robe: { d: (p) => `<path d="M60 146 Q100 134 140 146 L150 196 Q100 210 50 196 Z" fill="${p.outfit}" ${st()}/><path d="M52 187 Q100 201 148 187 L150 196 Q100 210 50 196 Z" fill="${p.trim}" ${st(3)}/><path d="M80 144 L100 162 L120 144" fill="none" stroke="${p.trim}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>` },
  },
  back: {
    none: { d: () => '' },
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
  return <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)];
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
  return { hero, parts, pal: { body: pick(BODY), inner: pick(INNER), outfit, trim, metal: pick(METAL), accent: c.accent } };
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
  const eyes = hit
    ? `<path d="M70 94 L84 101 L70 108 M130 94 L116 101 L130 108" fill="none" ${st(4)}/>`
    : pose === 'blink'
      ? [78, 122].map((x) => `<path d="M${x - 7} 101 Q${x} 105 ${x + 7} 101" fill="none" ${st(4)}/>`).join('')
      : pose === 'happy'
        ? P.eyes.happy.d(p)
        : part('eyes');
  const mouth = hit ? P.mouth.wobble.d(p) : pose === 'happy' ? P.mouth.open.d(p) : part('mouth');
  const layers = [
    part('back'),
    ear.front ? '' : ear.d(p),
    `<ellipse cx="100" cy="166" rx="40" ry="32" fill="${p.body}" ${st()}/><ellipse cx="81" cy="199" rx="15" ry="9" fill="${shade(p.body, -0.07)}" ${st()}/><ellipse cx="119" cy="199" rx="15" ry="9" fill="${shade(p.body, -0.07)}" ${st()}/>`,
    part('outfit'),
    `<path d="${HEAD}" fill="${p.body}" ${st()}/>` + (ear.front ? ear.d(p) : ''),
    `<ellipse cx="63" cy="116" rx="9.5" ry="5.5" fill="${p.inner}" opacity=".8"/><ellipse cx="137" cy="116" rx="9.5" ry="5.5" fill="${p.inner}" opacity=".8"/>` + eyes + mouth,
    part('headgear'),
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
