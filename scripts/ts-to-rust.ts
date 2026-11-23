// TS → Rust: regenerate the on-chain engine's game data from the TypeScript sim and prove the two still agree.
//
//   npm run ts-to-rust                 codegen + parity test (2,000 fights + 2,000 runs)
//   npm run ts-to-rust -- --cases 20000   bigger parity run
//   npm run ts-to-rust -- --no-test    codegen only
//
// 1. codegen: src/sim (skills, heroes, tuning, combat constants, …) → onchain/engine/mochi-engine/src/data.rs
// 2. parity cases from the TS sim (the reference): fights with a hash of the full state after every tick, and
//    whole runs with a hash of the run state after every action
// 3. cargo test: the Rust engine must reproduce every hash exactly (bit-exact)
//
// Only DATA is generated. A change to the RULES in combat.ts / run.ts must be ported to the matching .rs file by
// hand; the parity test then shows whether the port is exact. Cargo runs natively, or through WSL on Windows.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { SIM_VERSION } from '../src/sim/combat';

const root = path.resolve(import.meta.dirname, '..');
const onchain = path.join(root, 'onchain');
const engine = path.join(onchain, 'engine');
const dataRs = path.join(engine, 'mochi-engine', 'src', 'data.rs');
const args = process.argv.slice(2);
const noTest = args.includes('--no-test');
const nCases = Number(args[args.indexOf('--cases') + 1]) || 2000;
const tsx = (script: string, ...a: string[]) => execFileSync(process.execPath, ['--import', 'tsx', script, ...a], { cwd: root, stdio: 'inherit' });
const step = (s: string) => console.log(`\n▶ ${s}`);

// 1. codegen
step(`codegen: src/sim (sim v${SIM_VERSION}) → ${path.relative(root, dataRs)}`);
const before = fs.existsSync(dataRs) ? fs.readFileSync(dataRs, 'utf8') : '';
const simBefore = before.match(/sim v(\d+)/)?.[1];
tsx(path.join(engine, 'codegen.mts'));
const after = fs.readFileSync(dataRs, 'utf8');
console.log(before === after ? '  data.rs unchanged' : `  data.rs updated (${before.split('\n').length} → ${after.split('\n').length} lines)`);
if (simBefore && simBefore !== String(SIM_VERSION)) {
  console.log(`  ⚠ SIM_VERSION ${simBefore} → ${SIM_VERSION}: the rules changed. Port the rule changes to combat.rs / run.rs,`);
  console.log('    then rebuild + redeploy the program and start a new season (old ghosts were built under the old rules).');
}
if (noTest) process.exit(0);

// 2. parity cases (TS = reference)
const k = nCases >= 1000 ? `${Math.round(nCases / 1000)}k` : String(nCases);
const casesFile = path.join(engine, 'diff', `cases-${k}.txt`);
const runsFile = path.join(engine, 'diff', `runs-${k}.txt`);
step(`parity cases from TS: ${nCases} fights + ${nCases} runs`);
tsx(path.join(engine, 'diff', 'gen.mts'), 'gen', String(nCases), casesFile);
tsx(path.join(engine, 'diff', 'run-gen.mts'), 'gen', String(nCases), runsFile);

// 3. cargo test (native cargo, or WSL on Windows)
step('Rust engine vs TS: cargo test (fights, runs, ghost storage)');
const rel = (f: string) => path.relative(path.join(engine, 'mochi-engine'), f).split(path.sep).join('/');
const env = { MOCHI_DIFF: rel(casesFile), MOCHI_RUNS: rel(runsFile) };
const cargoArgs = ['test', '--release', '-p', 'mochi-engine', '--test', 'diff', '--test', 'run_diff', '--test', 'ghost_roundtrip', '--', '--nocapture'];
const hasCargo = spawnSync('cargo --version', { stdio: 'ignore', shell: true }).status === 0;
let status: number | null;
if (hasCargo) {
  status = spawnSync('cargo', cargoArgs, { cwd: path.join(engine, 'mochi-engine'), stdio: 'inherit', env: { ...process.env, ...env } }).status;
} else if (process.platform === 'win32') {
  // D:\work\x → /mnt/d/work/x
  const wslDir = path.join(engine, 'mochi-engine').replace(/^([A-Za-z]):/, (_, d: string) => `/mnt/${d.toLowerCase()}`).split(path.sep).join('/');
  const envs = Object.entries(env).map(([a, b]) => `${a}=${b}`).join(' ');
  const cmd = `source ~/.cargo/env 2>/dev/null; cd '${wslDir}' && ${envs} cargo ${cargoArgs.join(' ')}`;
  console.log('  (no cargo on Windows: running it in WSL)');
  status = spawnSync('wsl', ['--', 'bash', '-lc', cmd], { stdio: 'inherit' }).status;
} else {
  console.error('cargo not found: install Rust (https://rustup.rs)');
  process.exit(1);
}
if (status !== 0) {
  console.error('\n✗ The Rust engine does NOT match the TS sim. Data is regenerated, so the difference is in the rules:');
  console.error('  port the change in src/sim/combat.ts or run.ts to onchain/engine/mochi-engine/src/{combat,run}.rs.');
  process.exit(1);
}
console.log(`\n✓ Rust engine is bit-exact with the TS sim (sim v${SIM_VERSION}, ${nCases} fights + ${nCases} runs).`);
if (before !== after) console.log('  data.rs changed: rebuild the program (anchor build) and redeploy for it to take effect on chain.');
