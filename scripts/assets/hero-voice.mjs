// Per-hero voice lines (sim v21): one Gemini TTS voice per hero, checked with Gemini ASR, exported to
// public/assets/voice/<lang>/hero/<hero>_<kind>.ogg|mp3. Lines: hero-voice-lines.json.
//   GEMINI_ENV_FILE=path/to/.env node scripts/assets/hero-voice.mjs gen [--only hero1,hero2]
//   GEMINI_ENV_FILE=...           node scripts/assets/hero-voice.mjs asr [--only ...]
//   node scripts/assets/hero-voice.mjs export
// Sequential on purpose (TTS rate limits). Only the line itself is sent (style words would be spoken aloud).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { speak, transcribe } from './gemini.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const cfg = JSON.parse(readFileSync(path.join(HERE, 'hero-voice-lines.json'), 'utf8'));
const args = process.argv.slice(2);
const cmd = args[0];
const only = (args.includes('--only') ? args[args.indexOf('--only') + 1] : '').split(',').filter(Boolean);
const KINDS = ['pick', 'ult', 'win'];
const LANGS = ['th', 'en'];
const heroes = Object.entries(cfg.heroes).filter(([id]) => !only.length || only.includes(id));
const CACHE = path.join(HERE, '.cache/hero-voice');
const ff = (...a) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...a]);
const CLEAN =
  'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.03,areverse,' +
  'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.06,areverse,' +
  'atempo=1.05,apad=pad_dur=0.05,loudnorm=I=-16:TP=-1.5:LRA=11';
const norm = (s) => s.toLowerCase().replace(/[\s.,!?…'"“”‘’\-–—:;]/g, '');

if (cmd === 'gen') {
  for (const [id, h] of heroes)
    for (const lg of LANGS)
      for (const k of KINDS) {
        const dir = path.join(CACHE, lg);
        mkdirSync(dir, { recursive: true });
        const raw = path.join(dir, `${id}_${k}.raw.wav`);
        for (let tries = 0; ; tries++) {
          try {
            writeFileSync(raw, await speak(h[k][lg], h.voice));
            break;
          } catch (e) {
            if (tries >= 3) throw e;
            console.log('retry', id, lg, k, String(e).slice(0, 120));
            await new Promise((r) => setTimeout(r, 8000 * (tries + 1)));
          }
        }
        ff('-i', raw, '-af', CLEAN, '-ar', '44100', '-ac', '1', path.join(dir, `${id}_${k}.wav`));
        console.log(id, lg, k, 'ok');
      }
} else if (cmd === 'asr') {
  const out = path.join(CACHE, 'asr.json');
  const prev = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : {};
  for (const [id, h] of heroes)
    for (const lg of LANGS)
      for (const k of KINDS) {
        const r = await transcribe(path.join(CACHE, lg, `${id}_${k}.wav`), lg);
        const ok = [h[k][lg], ...(h[k].asr_ok ?? [])].some((w) => norm(r.transcript) === norm(w));
        prev[`${lg}/${id}_${k}`] = { want: h[k][lg], ...r, match: ok };
        console.log(`${ok ? 'OK ' : 'XX '} ${lg} ${id}_${k}  want "${h[k][lg]}"  heard "${r.transcript}"  cute ${r.cuteness} clear ${r.clarity}`);
      }
  writeFileSync(out, JSON.stringify(prev, null, 2));
} else if (cmd === 'export') {
  for (const lg of LANGS) {
    const dst = path.join(ROOT, 'src/client/public/assets/voice', lg, 'hero');
    mkdirSync(dst, { recursive: true });
    for (const [id] of Object.entries(cfg.heroes))
      for (const k of KINDS) {
        const src = path.join(CACHE, lg, `${id}_${k}.wav`);
        if (!existsSync(src)) continue;
        ff('-i', src, '-c:a', 'libvorbis', '-q:a', '2', '-ac', '1', path.join(dst, `${id}_${k}.ogg`));
        ff('-i', src, '-c:a', 'libmp3lame', '-b:a', '56k', '-ac', '1', path.join(dst, `${id}_${k}.mp3`));
      }
    console.log('exported', lg);
  }
} else {
  console.log('usage: hero-voice.mjs gen|asr|export [--only heroes]');
}
