"""Synthesise every UI / combat sound effect.
Run: python scripts/assets/sfx.py  ->  src/client/public/assets/sfx/<name>.ogg + .mp3 (mono)"""
import numpy as np

from synth import (CACHE, OUT, SR, rng, bell, encode, env, fm, hz, kick, snare, level_sfx, marimba, noise, pluck, reverb, sine,
                   soften, sweep, tt, write_raw)


def mix(dur, *parts):
    """parts: (signal, start_seconds, gain)"""
    out = np.zeros(int(SR * dur))
    for sig, t0, g in parts:
        i = int(SR * t0)
        s = sig[: max(0, len(out) - i)]
        out[i: i + len(s)] += s * g
    return out


def arp(notes, step, voice=pluck, gain=1.0, **kw):
    return [(voice(m, **kw), i * step, gain) for i, m in enumerate(notes)]


def boing(f0, f1, d=0.18):
    s, t = sweep(f0, f1, d)
    e, _ = env(d, 0.003, 10)
    return s * e


C5, D5, E5, G5, A5, C6 = 72, 74, 76, 79, 81, 84

SFX = {}

# ---- UI ----
SFX["click"] = mix(0.12, (fm(C6 + 7, 0.1, ratio=3, index=0.8, decay=40), 0, 0.7), (pluck(C5, 0.1, bright=0.2, decay=45), 0, 0.8),
                  (noise(0.02, 120, lp=6), 0, 0.12))
SFX["hover"] = mix(0.06, (sine(hz(C6 + 12), tt(0.05)) * env(0.05, 0.001, 90)[0], 0, 1))
SFX["buy"] = reverb(mix(0.5, *arp([C5 + 12, E5 + 12, G5 + 12], 0.06, marimba), (bell(C6 + 12, 0.4, 9), 0.18, 0.5),
                        (noise(0.12, 30, hp=True), 0.0, 0.08)), 0.5, 0.15)
SFX["sell"] = reverb(mix(0.45, *arp([G5, E5, C5], 0.06, marimba), (bell(C6, 0.3, 10), 0.16, 0.35)), 0.5, 0.15)
SFX["reroll"] = mix(0.45, *[(marimba(m, 0.15), i * 0.035, 0.6 + 0.05 * i) for i, m in
                            enumerate([C5, E5, G5, C6, E5 + 12, G5 + 12, C6 + 12])], (noise(0.3, 10, lp=4, a=0.2), 0, 0.06))
SFX["lock"] = mix(0.2, (fm(G5 - 12, 0.12, ratio=1.5, index=3, decay=30), 0, 1), (noise(0.03, 80, lp=2), 0.0, 0.3),
                  (fm(C5, 0.1, ratio=2, index=1, decay=40), 0.06, 0.6))
SFX["unlock"] = mix(0.2, (fm(C5, 0.1, ratio=2, index=1, decay=40), 0, 0.6), (noise(0.03, 80, lp=2), 0.05, 0.3),
                    (fm(G5, 0.12, ratio=1.5, index=2, decay=30), 0.07, 0.8))
SFX["pickup"] = mix(0.16, (boing(500, 900, 0.12), 0, 1), (noise(0.04, 60, lp=4), 0, 0.1))
SFX["drop"] = mix(0.2, (boing(700, 300, 0.12), 0, 0.8), (kick(0.12, 260, 120), 0.02, 0.5))
SFX["wish"] = reverb(mix(1.2, *[(bell(m, 0.8, 5), i * 0.07, 0.6) for i, m in enumerate([C6, D5 + 12, E5 + 12, G5 + 12, A5 + 12, C6 + 12])],
                         (noise(0.6, 5, lp=3, a=0.2), 0, 0.04)), 1.2, 0.3)

# ---- combat ----
SFX["fight_start"] = reverb(mix(1.0, (kick(0.3, 140, 55), 0, 0.9), (noise(0.08, 40, lp=4), 0, 0.4), (kick(0.3, 140, 55), 0.16, 0.9),
                                (noise(0.08, 40, lp=4), 0.16, 0.4), (sweep(400, 1600, 0.2)[0] * env(0.2, 0.15, 3)[0], 0.16, 0.25),
                                (fm(C5, 0.6, ratio=1, index=2, decay=4), 0.36, 0.5), (fm(G5, 0.6, ratio=1, index=2, decay=4), 0.36, 0.4),
                                (fm(C6, 0.6, ratio=1, index=1.5, decay=4), 0.36, 0.35), (snare(0.2), 0.36, 0.5)), 0.7, 0.18)
_thump = sine(95, tt(0.16)) * env(0.16, 0.002, 22)[0]
SFX["hit"] = mix(0.2, (_thump, 0, 1.0), (noise(0.09, 38, lp=3), 0, 0.9), (noise(0.03, 120, lp=1), 0, 0.25))
SFX["crit"] = reverb(mix(0.45, (kick(0.2, 260, 100), 0, 0.7), (noise(0.1, 30, lp=6), 0, 0.5), (pluck(C5, 0.2, decay=18), 0, 0.5),
                         (bell(C6 + 7, 0.3, 9), 0.03, 0.45), (bell(C6 + 12, 0.3, 9), 0.07, 0.35)), 0.6, 0.18)
SFX["shield"] = reverb(mix(0.5, (fm(E5, 0.4, ratio=3.01, index=2.5, decay=6), 0, 0.8), (fm(E5 + 7, 0.4, ratio=2, index=1, decay=7), 0.03, 0.4),
                           (noise(0.3, 10, hp=True, a=0.05), 0, 0.1)), 0.7, 0.25)
SFX["freeze"] = reverb(mix(0.7, *[(bell(m, 0.5, 7), i * 0.03, 0.45) for i, m in enumerate([C6 + 12, G5 + 12, E5 + 12, C6 + 7, A5 + 12])],
                           (noise(0.4, 9, hp=True, a=0.03), 0, 0.2)), 0.9, 0.3)
def crackle(d=0.35, n=14):
    """fire: band-limited hiss plus a few random little crackle pops"""
    out = (noise(d, 7, lp=3, a=0.03) - noise(d, 7, lp=30, a=0.03)) * 0.5
    for t0 in np.sort(rng.uniform(0, d * 0.8, n)):
        pop = noise(0.012, 300, lp=2) * rng.uniform(0.3, 1)
        i = int(t0 * SR)
        out[i: i + len(pop)] += pop[: len(out) - i]
    return out


SFX["burn"] = mix(0.35, (crackle(), 0, 1), (kick(0.1, 160, 90), 0, 0.15))
SFX["chain"] = reverb(mix(0.4, (sweep(800, 2400, 0.08)[0] * env(0.08, 0.002, 20)[0], 0, 0.5),
                          *[(fm(m, 0.12, ratio=4, index=2, decay=25), i * 0.045, 0.6) for i, m in enumerate([G5, C6, G5 + 12])],
                          (noise(0.08, 40, hp=True), 0, 0.2)), 0.5, 0.15)
SFX["ko"] = reverb(mix(1.0, (kick(0.3, 200, 70), 0, 0.6), (noise(0.4, 9, lp=20, a=0.02), 0, 0.7),
                       *[(bell(m, 0.5, 6), 0.12 + i * 0.09, 0.4) for i, m in enumerate([G5 + 12, E5 + 12, C6])]), 0.9, 0.2)

# ---- jingles ----
SFX["win"] = reverb(mix(1.6, *arp([C5, E5, G5, C6], 0.11, fm, 0.7, ratio=1, index=1.2, decay=5),
                        (bell(E5 + 12, 1.0, 3), 0.44, 0.5), (bell(G5 + 12, 1.0, 3), 0.44, 0.35),
                        *arp([C5 - 12, G5 - 24, C5 - 12], 0.22, pluck, 0.5, d=0.3), (noise(0.6, 5, hp=True, a=0.3), 0.4, 0.05)), 1.2, 0.25)
SFX["lose"] = reverb(mix(1.4, *arp([G5, 75, 74, C5], 0.18, fm, 0.6, d=0.5, ratio=1, index=0.8, decay=4),
                         (pluck(C5 - 24, 0.8, decay=3), 0.54, 0.6)), 1.2, 0.25)
SFX["last_chance"] = reverb(mix(1.3, *[(fm(A5 if i % 2 == 0 else 77, 0.13, ratio=2, index=1.6, decay=12), i * 0.11, 0.5) for i in range(6)],
                                (kick(0.25, 150, 55), 0, 0.8), (kick(0.25, 150, 55), 0.33, 0.8), (kick(0.25, 150, 55), 0.66, 0.9),
                                (fm(A5 - 12, 0.6, ratio=1, index=1.5, decay=4), 0.66, 0.5), (fm(E5, 0.6, ratio=1, index=1.2, decay=4), 0.66, 0.4)), 0.7, 0.15)
SFX["stardust"] = reverb(mix(1.0, *[(bell(m, 0.5, 6), i * 0.05, 0.5) for i, m in enumerate([E5 + 12, G5 + 12, C6 + 12, G5 + 12, C6 + 12, E5 + 24])],
                             (marimba(C5 + 12, 0.3), 0, 0.5), (noise(0.6, 5, hp=True, a=0.1), 0, 0.08)), 0.9, 0.3)


def champion():
    """8-win fanfare built explicitly so the second phrase lands where intended"""
    parts = []
    for i, m in enumerate([G5 - 12, C5, E5, G5]):
        parts.append((fm(m, 0.6, ratio=1, index=1.5, decay=6), i * 0.1, 0.6))
    parts += [(fm(C6, 0.7, ratio=1, index=1.2, decay=3), 0.4, 0.7), (fm(E5 + 12, 0.7, ratio=1, index=1, decay=3), 0.4, 0.35)]
    for i, m in enumerate([A5, C6, D5 + 12, E5 + 12]):
        parts.append((fm(m, 0.5, ratio=1, index=1.5, decay=6), 0.8 + i * 0.1, 0.55))
    parts += [(fm(G5 + 12, 1.8, ratio=1, index=1, decay=1.4), 1.2, 0.7), (fm(C6, 1.8, ratio=1, index=0.8, decay=1.4), 1.2, 0.4),
              (fm(E5, 1.8, ratio=1, index=0.6, decay=1.4), 1.2, 0.3)]
    parts += [(bell(m, 0.7, 5), 1.2 + i * 0.06, 0.3) for i, m in enumerate([C6 + 12, G5 + 12, E5 + 12, C6 + 12, G5 + 24])]
    parts += [(kick(0.4), t, 0.6) for t in (0, 0.4, 0.8, 1.2)]
    parts.append((noise(1.6, 2, hp=True, a=0.5), 1.2, 0.07))
    return reverb(mix(3.2, *parts), 1.6, 0.3)


SFX["champion"] = champion()

if __name__ == "__main__":
    for name, sig in SFX.items():
        # trim the reverb tail where it falls under -60 dB
        sig = level_sfx(soften(sig))
        a = np.abs(sig)
        last = np.nonzero(a > 10 ** (-60 / 20))[0]
        sig = sig[: (last[-1] + int(SR * 0.02)) if len(last) else len(sig)]
        k = min(len(sig), int(SR * 0.01))
        sig[-k:] *= np.linspace(1, 0, k)
        wav = CACHE / "sfx" / f"{name}.wav"
        write_raw(wav, sig)
        encode(wav, OUT / "sfx" / name, mono=True, q_ogg=2, mp3_kbps=64, norm=False)
        print(f"{name:12s} {len(sig) / SR:.2f}s")
