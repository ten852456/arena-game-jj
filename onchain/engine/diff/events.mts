// Debug: print the TS events of one differential case between two ticks.
import { simulate } from '../../../src/sim/combat';
const [ci, t0, t1] = process.argv.slice(2).map(Number);
const { execSync } = await import('node:child_process');
const line = execSync(`npx tsx onchain/engine/diff/gen.mts dump x ${ci} 1 0`, { encoding: 'utf8' }).split('\n')[0];
const c = JSON.parse(line);
const r = simulate(c.a, c.b, c.seed, c.day);
for (const e of r.events) if (e.t >= t0 && e.t <= t1) { const { s, ...rest } = e as any; console.log(JSON.stringify(rest), 'hp', s.hp, 'g', s.fx.map((x: any) => x.g)); }
