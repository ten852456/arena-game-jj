"""Synthesise the four seamless music loops (town, shop, battle, victory).
Every note tail and the reverb tail wrap around to the start, so the files loop without a seam.
Run: python scripts/assets/music.py  ->  src/client/public/assets/music/<track>.ogg + .mp3 (stereo)"""
import numpy as np

from synth import (CACHE, OUT, SR, Track, bell, encode, fm, hat, kick, marimba, pad, pluck, reverb, shaker, snare,
                   soften, write_wav)

# chord = (root midi, quality); scale-degree triads in C major / A minor flavour
Q = {"M": (0, 4, 7), "m": (0, 3, 7), "M7": (0, 4, 7, 11), "m7": (0, 3, 7, 10), "sus": (0, 5, 7), "add9": (0, 4, 7, 14)}
PENTA = [0, 2, 4, 7, 9]


def chord_notes(root, q):
    return [root + i for i in Q[q]]


def melody_line(rng, chords, bars, beats, step, lo=72, density=0.6, motif_bars=2):
    """pentatonic melody that repeats a motif every motif_bars and varies it, leaning on chord tones"""
    scale = sorted({lo - 12 + o + p for o in (0, 12, 24) for p in PENTA})
    notes = []
    motif = []
    per_bar = int(beats / step)
    for b in range(motif_bars * per_bar):
        if rng.random() < density:
            motif.append((b, rng.integers(0, 6)))
    for bar in range(bars):
        root, q = chords[bar % len(chords)]
        tones = [n for n in scale if (n - root) % 12 in [i % 12 for i in Q[q]] and lo - 3 <= n <= lo + 14]
        vary = (bar // motif_bars) % 2 == 1
        for pos, k in motif:
            if pos // per_bar != bar % motif_bars:
                continue
            p = pos % per_bar
            if vary and rng.random() < 0.3:
                continue
            on_beat = (p * step) % 1 == 0
            if on_beat or not tones:
                m = tones[(k + (2 if vary else 0)) % len(tones)] if tones else lo
            else:
                near = [n for n in scale if lo - 3 <= n <= lo + 14]
                m = near[(k * 2 + bar) % len(near)]
            notes.append((bar * beats + p * step, m))
    return notes


def render(name, bpm, bars, chords, layers, seed, beats=4):
    rng = np.random.default_rng(seed)
    spb = 60 / bpm
    dur = bars * beats * spb
    tr = Track(dur, stereo=True)
    for bar in range(bars):
        t0 = bar * beats * spb
        root, q = chords[bar % len(chords)]
        for fn in layers:
            fn(tr, rng, t0, spb, root, q, bar)
    if "melody" in LAYER_OPTS.get(name, {}):
        o = LAYER_OPTS[name]["melody"]
        for t, m in melody_line(rng, chords, bars, beats, o["step"], o.get("lo", 72), o.get("density", 0.6)):
            tr.add(o["voice"](m), t * spb, o.get("gain", 0.3), pan=o.get("pan", 0.1), wrap=True)
    L = soften(reverb(tr.L, 2.2, 0.3, 2.2, wrap=True))
    R = soften(reverb(tr.R, 2.4, 0.3, 2.0, wrap=True))
    wav = CACHE / "music" / f"{name}.wav"
    write_wav(wav, [L, R])
    encode(wav, OUT / "music" / name, loud=-20, mono=False, q_ogg=1, mp3_kbps=64)
    print(f"{name:8s} {dur:.1f}s  {bpm} bpm  {bars} bars")


# ---- layer helpers ----
def pad_layer(gain=0.12, oct=-12):
    def f(tr, rng, t0, spb, root, q, bar):
        for i, n in enumerate(chord_notes(root + oct, q)):
            tr.add(pad(n, 4 * spb + 0.3, a=0.6, r=0.8), t0, gain, pan=(i - 1) * 0.3, wrap=True)
    return f


def bass_layer(pattern, gain=0.35, voice=None):
    voice = voice or (lambda m: pluck(m, 0.6, bright=0.2, decay=4))
    def f(tr, rng, t0, spb, root, q, bar):
        for beat, off in pattern:
            tr.add(voice(root - 24 + off), t0 + beat * spb, gain, wrap=True)
    return f


def arp_layer(step, order, gain=0.14, voice=None, oct=0, pan=-0.3, alt=None):
    voice = voice or (lambda m: marimba(m, 0.4))
    def f(tr, rng, t0, spb, root, q, bar):
        notes = chord_notes(root + oct, q)
        order_ = alt if alt and bar % 4 >= 2 else order
        k = 0
        t = 0.0
        while t < 4 - 1e-6:
            i = order_[k % len(order_)]
            v = gain * (1.0 if (t % 1) < 1e-6 else 0.8) * rng.uniform(0.85, 1.05)  # accent the beat, humanise
            tr.add(voice(notes[i % len(notes)] + 12 * (i // len(notes))), t0 + t * spb, v, pan=pan, wrap=True)
            k += 1
            t += step
    return f


def drum_layer(kicks=(), snares=(), hats=(), shakers=(), g=1.0, fill_every=0, swing=0.0):
    def f(tr, rng, t0, spb, root, q, bar):
        h = lambda: rng.uniform(0.75, 1.0)  # velocity humanise
        sw = lambda b: b + (swing if (b * 2) % 2 == 1 else 0)  # swing the off-beat eighths
        for b in kicks:
            tr.add(kick(0.35), t0 + b * spb, 0.65 * g, wrap=True)
        for b in snares:
            tr.add(snare(0.22), t0 + b * spb, 0.3 * g * h(), pan=0.05, wrap=True)
        for b in hats:
            tr.add(hat(), t0 + sw(b) * spb, 0.08 * g * h(), pan=0.25, wrap=True)
        for b in shakers:
            tr.add(shaker(), t0 + sw(b) * spb, 0.07 * g * h(), pan=-0.25, wrap=True)
        if fill_every and bar % fill_every == fill_every - 1:
            for b in (3.0, 3.25, 3.5, 3.75):
                tr.add(snare(0.12), t0 + b * spb, 0.15 * g, wrap=True)
    return f


def sparkle_layer(every=2, gain=0.1):
    def f(tr, rng, t0, spb, root, q, bar):
        if bar % every == 0:
            n = chord_notes(root + 24, q)
            for i, m in enumerate(n):
                tr.add(bell(m, 1.5, 3), t0 + (2 + i * 0.25) * spb, gain, pan=0.4 - i * 0.3, wrap=True)
    return f


LAYER_OPTS = {
    "town": {"melody": {"voice": lambda m: bell(m, 1.4, 2.6), "step": 1.0, "lo": 72, "density": 0.45, "gain": 0.16}},
    "shop": {"melody": {"voice": lambda m: marimba(m, 0.5), "step": 0.5, "lo": 74, "density": 0.45, "gain": 0.22}},
    "battle": {"melody": {"voice": lambda m: fm(m, 0.3, ratio=1, index=1.4, decay=7), "step": 0.5, "lo": 74, "density": 0.6, "gain": 0.2}},
    "victory": {"melody": {"voice": lambda m: fm(m, 0.6, ratio=1, index=1.1, decay=4), "step": 0.5, "lo": 74, "density": 0.55, "gain": 0.2}},
}

if __name__ == "__main__":
    # town: calm moon-night, 72 bpm, 16 bars = 53.3 s
    render("town", 72, 16,
           [(60, "add9"), (57, "m7"), (65, "M7"), (67, "sus"), (60, "add9"), (64, "m7"), (65, "M7"), (67, "sus")] * 2,
           [pad_layer(0.13), bass_layer([(0, 0), (2.5, 7)], 0.25), arp_layer(1.0, [0, 1, 2, 3], 0.08, voice=lambda m: bell(m, 1.2, 3), oct=12),
            sparkle_layer(4, 0.06)], seed=1)
    # shop: light, thinking, 96 bpm, 16 bars = 40 s
    render("shop", 96, 16,
           [(65, "M7"), (64, "m7"), (62, "m7"), (67, "sus")] * 4,
           [pad_layer(0.08), bass_layer([(0, 0), (1.5, 7), (2, 0), (3.5, 12)], 0.28), arp_layer(0.5, [0, 2, 1, 3], 0.07, alt=[3, 1, 2, 0]),
            drum_layer(kicks=(0, 2.5), hats=(), shakers=(0.5, 1.5, 2.5, 3.5), g=0.7, swing=0.08), sparkle_layer(4, 0.05)], seed=2)
    # battle: upbeat, 128 bpm, 24 bars = 45 s
    render("battle", 128, 24,
           [(57, "m"), (65, "M"), (60, "M"), (67, "M"), (57, "m"), (65, "M"), (62, "m"), (64, "M")] * 3,
           [pad_layer(0.07), bass_layer([(0, 0), (0.75, 0), (1.5, 12), (2, 0), (2.75, 7), (3.5, 12)], 0.3,
                                        voice=lambda m: fm(m, 0.25, ratio=1, index=1.8, decay=9)),
            arp_layer(0.25, [0, 1, 2, 3, 2, 1], 0.05, voice=lambda m: pluck(m, 0.15, decay=18), oct=12, pan=0.35, alt=[0, 2, 1, 3, 1, 2]),
            sparkle_layer(4, 0.05),
            drum_layer(kicks=(0, 1, 2, 3), snares=(1, 3), hats=(0.5, 1.5, 2.5, 3.5), shakers=(0.25, 0.75, 1.25, 1.75, 2.25, 2.75, 3.25, 3.75),
                       g=0.9, fill_every=8, swing=0.04)], seed=3)
    # victory: bright, 120 bpm, 16 bars = 32 s
    render("victory", 120, 16,
           [(60, "M"), (67, "M"), (69, "m"), (65, "M"), (60, "M"), (65, "M"), (67, "sus"), (67, "M")] * 2,
           [pad_layer(0.1), bass_layer([(0, 0), (1, 7), (2, 0), (3, 12)], 0.28), arp_layer(0.5, [0, 1, 2, 3], 0.08, oct=12),
            drum_layer(kicks=(0, 1, 2, 3), snares=(1, 3), shakers=(0.5, 1.5, 2.5, 3.5), g=0.75, fill_every=4), sparkle_layer(4, 0.05)], seed=4)
