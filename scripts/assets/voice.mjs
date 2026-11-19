// Announcer voice lines (Thai + English) with Gemini TTS, checked with Gemini ASR.
//   GEMINI_ENV_FILE=path/to/.env node scripts/assets/voice.mjs gen <th|en> <Voice> [--only k1,k2]
//   GEMINI_ENV_FILE=...           node scripts/assets/voice.mjs asr <th|en> <Voice> [--only k1,k2]
//   node scripts/assets/voice.mjs export      (encodes the voices chosen in voice-lines.json into public/assets/voice)
// Lines live in voice-lines.json. Only the line itself is sent: style words in the text would be spoken aloud.
// Generation is sequential on purpose (TTS rate limits).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { speak, transcribe } from './gemini.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const cfg = JSON.parse(readFileSync(path.join(HERE, 'voice-lines.json'), 'utf8'));
const [cmd, lang, voice] = process.argv.slice(2);
const args = process.argv.slice(2);
const only = (args.includes('--only') ? args[args.indexOf('--only') + 1] : '').split(',').filter(Boolean);
const lines = cfg.lines.filter((l) => !only.length || only.includes(l.key));
const dirOf = (v, lg) => path.join(HERE, '.cache/voice', v, lg);
const ff = (...a) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...a]);

// trim silence at both ends, a touch faster, loudness-normalised, mono 44.1 kHz
const CLEAN =
  'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.03,areverse,' +
  'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.06,areverse,' +
  'atempo=1.05,apad=pad_dur=0.05,loudnorm=I=-16:TP=-1.5:LRA=11';

/** compare loosely: no spaces, punctuation or case; Thai repetition marks kept */
const norm = (s) => s.toLowerCase().replace(/[\s.,!?…'"“”‘’\-–—:;]/g, '');

if (cmd === 'gen') {
  const dir = dirOf(voice, lang);
  mkdirSync(dir, { recursive: true });
  for (const l of lines) {
    const raw = path.join(dir, `${l.key}.raw.wav`);
    writeFileSync(raw, await speak(l[lang], voice));
    ff('-i', raw, '-af', CLEAN, '-ar', '44100', '-ac', '1', path.join(dir, `${l.key}.wav`));
    console.log(voice, lang, l.key, 'ok');
  }
} else if (cmd === 'asr') {
  const dir = dirOf(voice, lang);
  const out = path.join(dir, 'asr.json');
  const prev = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : {};
  for (const l of lines) {
    const r = await transcribe(path.join(dir, `${l.key}.wav`), lang);
    // asr_ok: transcripts that are right but spelled differently (e.g. a loanword written in Latin letters)
    const ok = [l[lang], ...(l.asr_ok ?? [])].some((w) => norm(r.transcript) === norm(w));
    prev[l.key] = { want: l[lang], ...r, match: ok };
    console.log(`${ok ? 'OK ' : 'XX '} ${l.key.padEnd(12)} want "${l[lang]}"  heard "${r.transcript}"  cute ${r.cuteness} clear ${r.clarity} nat ${r.naturalness} ${r.issues ? '| ' + r.issues : ''}`);
  }
  writeFileSync(out, JSON.stringify(prev, null, 2));
} else if (cmd === 'export') {
  for (const lg of ['th', 'en']) {
    const v = cfg.voices[lg];
    const dst = path.join(ROOT, 'src/client/public/assets/voice', lg);
    mkdirSync(dst, { recursive: true });
    for (const l of cfg.lines) {
      const src = path.join(dirOf(v, lg), `${l.key}.wav`);
      ff('-i', src, '-c:a', 'libvorbis', '-q:a', '2', '-ac', '1', path.join(dst, `${l.key}.ogg`));
      ff('-i', src, '-c:a', 'libmp3lame', '-b:a', '56k', '-ac', '1', path.join(dst, `${l.key}.mp3`));
    }
    console.log('exported', lg, v);
  }
} else {
  console.log('usage: voice.mjs gen|asr <th|en> <Voice> [--only keys] | export');
}
