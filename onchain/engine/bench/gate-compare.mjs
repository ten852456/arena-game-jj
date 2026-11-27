// Balance gate, part 2: compare two runs. Reports identical-result rates, win rate by hero/archetype, fight length.
import fs from 'node:fs';
const load = (f) => fs.readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const [fa, fb, label] = process.argv.slice(2);
const A = load(fa), B = load(fb);
if (A.length !== B.length) throw new Error('length mismatch');
let sameW = 0, sameT = 0;
for (let k = 0; k < A.length; k++) { if (A[k].w === B[k].w) sameW++; if (A[k].t === B[k].t) sameT++; }
// win rate of each hero (both seats; draw = 0.5)
function rates(R, key) {
  const m = {};
  for (const r of R) {
    for (const [side, h] of [[0, r['h' + 'a'] && (key === 'hero' ? r.ha : r.aa)], [1, key === 'hero' ? r.hb : r.ab]]) {
      const s = r.w === -1 ? 0.5 : r.w === side ? 1 : 0;
      (m[h] ??= { n: 0, s: 0 }); m[h].n++; m[h].s += s;
    }
  }
  return Object.fromEntries(Object.entries(m).map(([h, x]) => [h, x.s / x.n]));
}
const diff = (key) => { const ra = rates(A, key), rb = rates(B, key); return Object.keys(ra).map((h) => ({ [key]: h, a: +(ra[h] * 100).toFixed(2), b: +(rb[h] * 100).toFixed(2), delta: +((rb[h] - ra[h]) * 100).toFixed(2) })); };
const len = (R) => { const by = {}; for (const r of R) (by[r.day] ??= []).push(r.t); return Object.fromEntries(Object.entries(by).map(([d, ts]) => { ts.sort((x, y) => x - y); return [d, { mean: +(ts.reduce((n, x) => n + x, 0) / ts.length / 10).toFixed(2), p95: ts[Math.floor(ts.length * 0.95)] / 10 }]; })); };
const hero = diff('hero'), arch = diff('arch');
const maxAbs = (rows) => Math.max(...rows.map((r) => Math.abs(r.delta)));
console.log(`\n=== ${label} · ${A.length} fights ===`);
console.log(`same winner ${(100 * sameW / A.length).toFixed(2)}% · same length ${(100 * sameT / A.length).toFixed(2)}%`);
console.log(`max |Δ win rate| hero ${maxAbs(hero).toFixed(2)} pts · archetype ${maxAbs(arch).toFixed(2)} pts`);
console.table(hero); console.table(arch);
const la = len(A), lb = len(B);
console.table(Object.keys(la).map((d) => ({ day: +d, meanA: la[d].mean, meanB: lb[d].mean, p95A: la[d].p95, p95B: lb[d].p95 })));
fs.writeFileSync(process.argv[5] ?? '/dev/null', JSON.stringify({ label, n: A.length, sameWinner: sameW / A.length, sameLength: sameT / A.length, hero, arch, lenA: la, lenB: lb }, null, 1));
