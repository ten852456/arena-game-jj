"""Tiny numpy synth used by sfx.py and music.py (no samples, no licence question).
Everything is additive / FM synthesis plus FFT reverb, so it needs only numpy."""
import subprocess
import wave
from pathlib import Path

import numpy as np

SR = 44100
ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / "tools/assets/.cache"
OUT = ROOT / "src/web/public/assets"
rng = np.random.default_rng(20261119)


def hz(m):
    return 440.0 * 2 ** ((np.asarray(m, dtype=float) - 69) / 12)


def tt(d):
    return np.arange(int(SR * d)) / SR


def env(d, a=0.005, decay=6.0, hold=0.0):
    t = tt(d)
    e = np.minimum(1, t / max(a, 1e-4)) * np.exp(-np.maximum(0, t - a - hold) * decay)
    # 4 ms fade at the end so nothing clicks
    k = min(len(e), int(SR * 0.004))
    if k:
        e[-k:] *= np.linspace(1, 0, k)
    return e, t


def adsr(d, a=0.01, r=0.1):
    t = tt(d)
    e = np.minimum(1, t / max(a, 1e-4)) * np.minimum(1, np.maximum(0, d - t) / max(r, 1e-4))
    return e, t


def sine(f, t):
    return np.sin(2 * np.pi * f * t)


def sweep(f0, f1, d, curve="exp"):
    """phase-continuous frequency glide"""
    t = tt(d)
    if curve == "exp":
        f = f0 * (f1 / f0) ** (t / d)
    else:
        f = f0 + (f1 - f0) * (t / d)
    return np.sin(2 * np.pi * np.cumsum(f) / SR), t


def pluck(m, d=0.4, bright=0.35, decay=8.0):
    e, t = env(d, 0.003, decay)
    f = hz(m)
    return e * (sine(f, t) + bright * sine(2 * f, t) * np.exp(-t * 6) + 0.12 * sine(3 * f, t) * np.exp(-t * 10))


def bell(m, d=1.2, decay=3.5):
    e, t = env(d, 0.002, decay)
    f = hz(m)
    return e * (sine(f, t) + 0.45 * sine(f * 2.76, t) * np.exp(-t * 6) + 0.2 * sine(f * 5.4, t) * np.exp(-t * 12))


def marimba(m, d=0.5):
    e, t = env(d, 0.002, 9)
    f = hz(m)
    return e * (sine(f, t) + 0.3 * sine(f * 4, t) * np.exp(-t * 30))


def fm(m, d=0.5, ratio=2.0, index=2.0, decay=6.0, a=0.004):
    e, t = env(d, a, decay)
    f = hz(m)
    mod = index * np.exp(-t * decay * 0.7) * sine(f * ratio, t)
    return e * np.sin(2 * np.pi * f * t + mod)


def pad(m, d, a=0.4, r=0.6, det=0.12):
    """soft detuned pad: a few sines per voice, slow attack"""
    e, t = adsr(d, a, r)
    f = hz(m)
    s = np.zeros_like(t)
    for c, g in ((-det, 0.5), (0, 1.0), (det, 0.5)):
        ff = f * 2 ** (c / 12)
        s += g * (sine(ff, t) + 0.25 * sine(2 * ff, t) + 0.08 * sine(3 * ff, t))
    return e * s / 2.0


def kick(d=0.32, f0=150, f1=48):
    e, t = env(d, 0.001, 11)
    f = f1 + (f0 - f1) * np.exp(-t * 35)
    return e * np.sin(2 * np.pi * np.cumsum(f) / SR)


def smooth(x, k):
    """moving-average low-pass (k samples)"""
    if k <= 1:
        return x
    return np.convolve(x, np.ones(k) / k, mode="same")


def noise(d, decay=20.0, lp=1, hp=False, a=0.001):
    e, _ = env(d, a, decay)
    x = rng.standard_normal(len(e))
    if hp:
        x = np.diff(x, prepend=0)
    x = smooth(x, lp)
    return e * x / (np.max(np.abs(x)) + 1e-9)


def hat(d=0.06):
    return noise(d, 60, hp=True) * 0.6


def snare(d=0.18):
    e, t = env(d, 0.001, 22)
    return 0.6 * noise(d, 18, lp=2) + 0.5 * e * sine(190, t)


def shaker(d=0.07):
    return noise(d, 40, hp=True, a=0.012) * 0.5


def reverb(x, secs=1.6, mix=0.25, decay=3.0, lp=6, wrap=False):
    """FFT convolution with a soft noise tail. wrap=True folds the tail onto the start (seamless loops)."""
    n = int(SR * secs)
    ir = rng.standard_normal(n) * np.exp(-np.arange(n) / SR * decay)
    ir = smooth(ir, lp)
    ir[: int(SR * 0.012)] = 0  # pre-delay
    ir /= np.sqrt(np.sum(ir**2)) + 1e-9
    L = len(x) + n
    N = 1 << (L - 1).bit_length()
    wet = np.fft.irfft(np.fft.rfft(x, N) * np.fft.rfft(ir, N), N)[:L]
    if wrap:
        tail = wet[len(x):]
        wet = wet[: len(x)].copy()
        wet[: len(tail)] += tail[: len(x)]
    else:
        x = np.concatenate([x, np.zeros(n)])
    return x * (1 - mix) + wet * mix * 3


def soften(x, corner=4500.0):
    """gentle high cut (1st-order slope above corner) done with a circular FFT so the loop stays seamless;
    keeps bells and hats from getting piercing on phone speakers"""
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    X *= 1 / np.sqrt(1 + (f / corner) ** 2)
    return np.fft.irfft(X, len(x))


class Track:
    """mono or stereo buffer you add notes into, by seconds"""

    def __init__(self, dur, stereo=False):
        self.n = int(SR * dur)
        self.L = np.zeros(self.n)
        self.R = np.zeros(self.n) if stereo else None

    def add(self, sig, t0, gain=1.0, pan=0.0, wrap=False):
        i = int(round(t0 * SR))
        sig = np.asarray(sig) * gain
        if wrap:
            idx = (np.arange(len(sig)) + i) % self.n
            np.add.at(self.L, idx, sig * (1 - max(0, pan)))
            if self.R is not None:
                np.add.at(self.R, idx, sig * (1 + min(0, pan)))
            return
        if i >= self.n:
            return
        sig = sig[: self.n - i]
        self.L[i: i + len(sig)] += sig * (1 - max(0, pan))
        if self.R is not None:
            self.R[i: i + len(sig)] += sig * (1 + min(0, pan))


def write_wav(path, chans):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    data = np.stack(chans, axis=1) if len(chans) > 1 else chans[0][:, None]
    peak = np.max(np.abs(data)) + 1e-9
    data = data / peak * 0.89
    pcm = (data * 32767).astype("<i2")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(data.shape[1])
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def ffmpeg(*args):
    subprocess.run(["ffmpeg", "-v", "error", "-y", *map(str, args)], check=True)


def level_sfx(x, target_db=-15.0, peak_db=-1.0):
    """short clips are too short for ffmpeg loudnorm, so match the RMS of the loudest 100 ms window instead
    (with a peak ceiling): every SFX ends up about as loud as the others."""
    x = x / (np.max(np.abs(x)) + 1e-9)
    w = int(SR * 0.1)
    p = np.convolve(x**2, np.ones(w) / w, mode="same") if len(x) > w else np.array([np.mean(x**2)])
    rms = np.sqrt(np.max(p)) + 1e-9
    g = 10 ** (target_db / 20) / rms
    g = min(g, 10 ** (peak_db / 20))  # x is peak-normalised, so g is also the peak
    return x * g


def write_raw(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    pcm = (np.clip(data, -1, 1) * 32767).astype("<i2")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def encode(wav, out_base, loud=-16, mono=True, q_ogg=3, mp3_kbps=96, norm=True):
    """(optionally loudnorm) then write <out_base>.ogg and .mp3"""
    out_base = Path(out_base)
    out_base.parent.mkdir(parents=True, exist_ok=True)
    ch = ["-ac", "1"] if mono else ["-ac", "2"]
    af = ["-af", f"loudnorm=I={loud}:TP=-1.5:LRA=11"] if norm else []
    ffmpeg("-i", wav, *af, "-ar", SR, *ch, "-c:a", "libvorbis", "-q:a", q_ogg, out_base.with_suffix(".ogg"))
    ffmpeg("-i", wav, *af, "-ar", SR, *ch, "-c:a", "libmp3lame", "-b:a", f"{mp3_kbps}k", out_base.with_suffix(".mp3"))
