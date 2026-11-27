/**
 * The hero-select radar ("spider") chart: 6 axes rated 1–5.
 * HP comes from the real tuning (hp.<hero> multiplier); the other five are a design rating of how the hero plays,
 * hand-set here: retune this table when a hero's kit changes.
 */
import { L } from '../../shared/i18n';
import { HEROES } from '../../sim/heroes';
import { T } from '../../sim/tuning';

type Axis = 'hp' | 'atk' | 'def' | 'ctrl' | 'late' | 'easy';
const AXES: Axis[] = ['hp', 'atk', 'def', 'ctrl', 'late', 'easy'];

const axisName = (a: Axis) =>
  ({
    hp: L('พลังชีวิต', 'HP'),
    atk: L('โจมตี', 'Attack'),
    def: L('ป้องกัน', 'Defense'),
    ctrl: L('ควบคุม', 'Control'),
    late: L('โตช่วงท้าย', 'Late game'),
    easy: L('เล่นง่าย', 'Easy'),
  })[a];

/** design ratings, 1–5 (HP is filled in from the tuning) */
const RATING: Record<string, Omit<Record<Axis, number>, 'hp'>> = {
  assassin: { atk: 5, def: 1, ctrl: 1, late: 3, easy: 4 }, // ⚔ hit: one big opening hit, finisher
  duelist: { atk: 4, def: 3, ctrl: 1, late: 3, easy: 3 }, // 💨 dodge: fast hits, dodge charges, counters
  knight: { atk: 2, def: 5, ctrl: 1, late: 3, easy: 5 }, // 🛡 shield: thick shield, Shield Slam
  berserker: { atk: 4, def: 3, ctrl: 1, late: 5, easy: 4 }, // ❤ heal: leech, grows the longer it fights
  pyro: { atk: 4, def: 1, ctrl: 1, late: 4, easy: 3 }, // 🔥 burn: stacks burns, Inferno ignores shields
  thornguard: { atk: 3, def: 3, ctrl: 2, late: 5, easy: 3 }, // ☠ poison: poison on hit taken, long stacks
  witch: { atk: 3, def: 2, ctrl: 5, late: 3, easy: 2 }, // ❄ ice: freeze, Shatter ×3 on frozen
  chrono: { atk: 2, def: 3, ctrl: 5, late: 3, easy: 2 }, // 🌪 wind: slows, pushes cooldowns back, cleanses
  luckycat: { atk: 3, def: 2, ctrl: 1, late: 5, easy: 3 }, // 💰 gold: light early, brutal once upgraded
  sage: { atk: 2, def: 4, ctrl: 2, late: 5, easy: 2 }, // ⏳ time: survive, every second makes it stronger
};

/** HP multiplier mapped onto 1–5 over the heroes' real range (lowest hero = 1, highest = 5), read from the tuning */
const hpMult = (id: string) => (T as Record<string, number>)[`hp.${id}`] ?? 1;
function hpRating(id: string) {
  const all = HEROES.map((h) => hpMult(h.id));
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  return hi > lo ? 1 + ((hpMult(id) - lo) / (hi - lo)) * 4 : 3;
}

export function heroStats(id: string): Record<Axis, number> | null {
  const r = RATING[id];
  return r ? { hp: hpRating(id), ...r } : null;
}

/** The radar as inline SVG. Colour comes from the panel's --pa (the hero's line colour). */
export function radarHTML(id: string) {
  const s = heroStats(id);
  if (!s) return '';
  const C = 110; // centre
  const R = 78; // radius of a 5
  const pt = (i: number, v: number) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / AXES.length;
    return [C + Math.cos(a) * R * (v / 5), C + Math.sin(a) * R * (v / 5)] as const;
  };
  const ring = (v: number) => AXES.map((_, i) => pt(i, v).join(',')).join(' ');
  const grid = [1, 2, 3, 4, 5].map((v) => `<polygon class="rd-ring" points="${ring(v)}"/>`).join('');
  const spokes = AXES.map((_, i) => {
    const [x, y] = pt(i, 5);
    return `<line class="rd-spoke" x1="${C}" y1="${C}" x2="${x}" y2="${y}"/>`;
  }).join('');
  const shape = AXES.map((a, i) => pt(i, s[a]).join(',')).join(' ');
  const dots = AXES.map((a, i) => {
    const [x, y] = pt(i, s[a]);
    return `<circle class="rd-dot" cx="${x}" cy="${y}" r="4" style="--k:${i}"/>`;
  }).join('');
  const labels = AXES.map((a, i) => {
    const [x, y] = pt(i, 6.35);
    const anchor = Math.abs(x - C) < 4 ? 'middle' : x > C ? 'start' : 'end';
    return `<text class="rd-lbl" x="${x}" y="${y}" text-anchor="${anchor}" dominant-baseline="middle">${axisName(a)}</text>`;
  }).join('');
  const sr = AXES.map((a) => `${axisName(a)} ${Math.round(s[a])}/5`).join(', ');
  return `<svg class="radar" viewBox="-30 -10 280 240" role="img" aria-label="${sr}">${grid}${spokes}
    <polygon class="rd-shape" points="${shape}"/>${dots}${labels}</svg>`;
}
