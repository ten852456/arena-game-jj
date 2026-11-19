// Writes knob values into src/sim/tuning.ts (only the numbers between the <tuned> markers change).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const TUNING_FILE = fileURLToPath(new URL('../../src/sim/tuning.ts', import.meta.url));

/** Returns the new file text and the changed keys. */
export function patchTuning(text: string, values: Record<string, number>) {
  const start = text.indexOf('// <tuned>');
  const end = text.indexOf('// </tuned>');
  if (start < 0 || end < 0) throw new Error('tuning.ts: <tuned> markers not found');
  let block = text.slice(start, end);
  const changed: [string, number, number][] = [];
  for (const [k, v] of Object.entries(values)) {
    const re = new RegExp(`(\\n\\s*'${k.replace(/\./g, '\\.')}':\\s*)(-?[0-9.]+)(,)`);
    const m = block.match(re);
    if (!m) throw new Error(`tuning.ts: key ${k} not found`);
    const old = Number(m[2]);
    if (old === v) continue;
    changed.push([k, old, v]);
    block = block.replace(re, `$1${+v.toFixed(4)}$3`);
  }
  return { text: text.slice(0, start) + block + text.slice(end), changed };
}

export function applyTuningFile(values: Record<string, number>, dry: boolean) {
  const text = readFileSync(TUNING_FILE, 'utf8');
  const r = patchTuning(text, values);
  if (!dry && r.changed.length) writeFileSync(TUNING_FILE, r.text);
  return r.changed;
}
