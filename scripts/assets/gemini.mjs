// Gemini REST helpers for voice.mjs (TTS) and the ASR check. Adapted from the Mochi Moon promo scripts.
// The key comes from GEMINI_API_KEY, else from the .env file named by GEMINI_ENV_FILE. It is never written anywhere.
import { existsSync, readFileSync } from 'node:fs';

function geminiKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  const f = process.env.GEMINI_ENV_FILE;
  if (f && existsSync(f)) {
    const m = readFileSync(f, 'utf8').match(/^\s*GEMINI_API_KEY\s*=\s*"?([^"\r\n]+)"?\s*$/m);
    if (m) return m[1].trim();
  }
  throw new Error('GEMINI_API_KEY not set (env var, or GEMINI_ENV_FILE pointing at a .env)');
}

async function generate(model, body) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': geminiKey() },
      body: JSON.stringify(body),
    });
    if ([429, 500, 503].includes(r.status) && attempt < 4) {
      await new Promise((res) => setTimeout(res, 8000 * (attempt + 1)));
      continue;
    }
    if (!r.ok) throw new Error(`${model} HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);
    return r.json();
  }
}

export const TTS_MODEL = process.env.TTS_MODEL || 'gemini-3.8-flash-tts';
export const ASR_MODEL = process.env.ASR_MODEL || 'gemini-3.8-flash';

/** Speech for one line, as a WAV buffer. Only the line itself goes in the text (style words would be spoken). */
export async function speak(text, voice, model = TTS_MODEL) {
  const json = await generate(model, {
    contents: [{ parts: [{ text }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
    },
  });
  const part = json.candidates[0].content.parts[0].inlineData;
  const data = Buffer.from(part.data, 'base64');
  const mime = part.mimeType ?? '';
  if (mime.includes('wav')) return data;
  // raw 16-bit mono PCM ("audio/L16;codec=pcm;rate=24000"): add a WAV header
  const rate = Number(mime.match(/rate=(\d+)/)?.[1] ?? 24000);
  const head = Buffer.alloc(44);
  head.write('RIFF', 0);
  head.writeUInt32LE(36 + data.length, 4);
  head.write('WAVEfmt ', 8);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(rate, 24);
  head.writeUInt32LE(rate * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write('data', 36);
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

/** Gemini listens to a WAV file and says what it heard (lang 'th' | 'en'). */
export async function transcribe(file, lang) {
  const prompt =
    (lang === 'th' ? 'Transcribe this short Thai game voice line exactly, in Thai script.' : 'Transcribe this short English game voice line exactly.') +
    ' Then rate the voice. Reply as JSON: {"transcript": str, "gender": "male"|"female", "cuteness": 1-10, "clarity": 1-10, ' +
    '"naturalness": 1-10, "issues": str (mispronounced words, odd tones, glitches, cut-off endings; empty if none)}';
  const json = await generate(ASR_MODEL, {
    contents: [{ parts: [{ inlineData: { mimeType: 'audio/wav', data: readFileSync(file).toString('base64') } }, { text: prompt }] }],
    generationConfig: { responseMimeType: 'application/json' },
  });
  return JSON.parse(json.candidates[0].content.parts[0].text);
}
