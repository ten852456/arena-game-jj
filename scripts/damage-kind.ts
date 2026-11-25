// Regression (sim v13): damage kind is separate from the attacking skill id.
// - hits of the skill เกราะหนาม (id 'thorns') are kind 'hit' and COUNT for the berserker passive
// - thorns reflection is kind 'thorns', burn is 'burn', fatigue is 'fatigue': they do NOT count
// The berserker's passive growth is recomputed from the events (rules of heroes.ts) and compared with the engine's
// state (digest), over many seeds and opponents, plus direct checks of the event fields.
import { simulate } from '../src/sim/combat';
import { hashSeed } from '../src/sim/rng';
import { T } from '../src/sim/tuning';
import type { Build, CombatEvent } from '../src/sim/types';

const B = (hero: string, ids: string[]): Build => ({ hero, skills: ids.map((id) => ({ id, v: '' })) });
// the berserker has no growth skills, so all its growth comes from the passive
const berserker = B('berserker', ['strike', 'jab']);
const scenarios: [string, Build][] = [
  ['hits from the skill เกราะหนาม (id thorns)', B('knight', ['thorns'])],
  ['thorns reflection (thornguard: permanent thorns + thorns skill)', B('thornguard', ['thorns', 'shield'])],
  ['burn', B('pyro', ['ignite'])],
  ['fatigue only (no attacks)', B('knight', ['ironwill'])],
  ['mixed', B('thornguard', ['thorns', 'ignite', 'strike'])],
];

let fails = 0;
let checked = 0;
const kinds = { hit: 0, thorns: 0, burn: 0, fatigue: 0 };
for (const [name, foe] of scenarios) {
  for (let i = 0; i < 40; i++) {
    const day = 1 + (i % 15);
    const seed = hashSeed('dk', name, i);
    let lastRow: number[] = [];
    const r = simulate(foe, berserker, seed, day, { digest: (row) => (lastRow = row) });
    // expected passive growth of side 1 (berserker), from the events in order
    let hits = 0, g = 0, raged = false;
    const maxHp = r.maxHp[1];
    for (const e of r.events as CombatEvent[]) {
      if (e.type !== 'damage') continue;
      kinds[e.kind]++;
      if (e.kind === 'thorns' && e.src !== 'thorns') { fails++; console.error('reflection event with src', e.src); }
      if (e.kind === 'hit' && e.src === 'thorns' && e.side !== 1) { /* the berserker never casts เกราะหนาม */ }
      if (e.side !== 1) continue;
      const hp = e.s.hp[1];
      if (e.kind === 'hit' && hp > 0) {
        hits++;
        if (hits % T['berserker.hits'] === 0) g += 1;
      }
      if (!raged && hp > 0 && 2 * hp < maxHp) { raged = true; g += 2; }
    }
    // digest layout: [t, side 0: 22 fields + 4 per block, side 1: ...]; growth sum is field 9
    const growth = lastRow[1 + 22 + 4 * foe.skills.length + 9];
    checked++;
    if (growth !== g) {
      fails++;
      console.error(`FAIL ${name} #${i}: engine growth ${growth}, expected ${g} (hits counted ${hits}, raged ${raged})`);
    }
  }
}
// เกราะหนาม hits must be kind 'hit' with src 'thorns'; there must be real reflections too
const r = simulate(B('knight', ['thorns']), B('thornguard', ['strike']), 7, 5);
const skillHits = r.events.filter((e) => e.type === 'damage' && e.src === 'thorns' && e.kind === 'hit').length;
const refl = r.events.filter((e) => e.type === 'damage' && e.kind === 'thorns').length;
if (!skillHits || !refl) { fails++; console.error(`expected both เกราะหนาม hits (${skillHits}) and reflections (${refl})`); }
console.log(`damage kinds: ${checked} berserker fights checked · events hit ${kinds.hit} thorns ${kinds.thorns} burn ${kinds.burn} fatigue ${kinds.fatigue} · ${fails === 0 ? 'OK' : fails + ' FAILURES'}`);
process.exit(fails ? 1 : 0);
