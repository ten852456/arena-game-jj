"""Turn the Codex-generated PNGs into the shipped webp files.
Usage: python scripts/assets/images.py [raw_dir]   (default scripts/assets/.cache/raw)
raw_dir must hold the source PNGs named as in SOURCES below (see docs/ASSETS.md for the prompts).
Magenta (#ff00ff) backgrounds are keyed out to alpha with spill removal."""
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
RAW = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "scripts/assets/.cache/raw"
OUT = ROOT / "src/client/public/assets/img"

# out name: (source png, keyed?, max width, crop box as fractions (l, t, r, b) or None, webp quality)
SOURCES = {
    "bg-title": ("bg-title.png", False, 1536, None, 88),
    "logo": ("logo.png", True, 1024, "bbox", 85),
    "bg-shop": ("bg-shop.png", False, 1536, None, 86),
    "banner-victory": ("banner-victory.png", True, 900, "bbox", 82),
    "banner-defeat": ("banner-defeat.png", True, 900, "bbox", 82),
    "stardust": ("stardust.png", True, 256, "bbox", 88),
    "chest": ("chest.png", True, 512, "bbox", 85),
    "header-leaderboard": ("header-leaderboard.png", False, 1200, (0, 0.12, 1, 0.82), 86),
}


def key_magenta(img):
    a = np.asarray(img.convert("RGB")).astype(np.float32)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    m = np.minimum(r, b) - g  # ~255 on the background, small on the artwork
    alpha = np.clip((215 - m) / 140, 0, 1)
    # un-mix the magenta from semi-transparent edge pixels (spill removal)
    key = np.array([255, 0, 255], np.float32)
    safe = np.maximum(alpha, 1e-3)[..., None]
    rgb = np.clip((a - (1 - alpha[..., None]) * key) / safe, 0, 255)
    rgb = np.where(alpha[..., None] > 0, rgb, 0)
    out = np.dstack([rgb, alpha * 255]).astype(np.uint8)
    return Image.fromarray(out, "RGBA")


def fit(img, max_w):
    if img.width > max_w:
        img = img.resize((max_w, round(img.height * max_w / img.width)), Image.LANCZOS)
    return img


def save(img, name, q):
    OUT.mkdir(parents=True, exist_ok=True)
    p = OUT / f"{name}.webp"
    img.save(p, "WEBP", quality=q, method=6)
    print(f"{name:20s} {img.width}x{img.height}  {p.stat().st_size // 1024} KB")
    return img


def main():
    made = {}
    for name, (src, keyed, max_w, crop, q) in SOURCES.items():
        img = Image.open(RAW / src)
        if keyed:
            img = key_magenta(img)
        if crop == "bbox":
            bb = img.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
            pad = 8
            img = img.crop((max(0, bb[0] - pad), max(0, bb[1] - pad), min(img.width, bb[2] + pad), min(img.height, bb[3] + pad)))
        elif crop:
            w, h = img.size
            img = img.crop((int(crop[0] * w), int(crop[1] * h), int(crop[2] * w), int(crop[3] * h)))
        made[name] = save(fit(img, max_w), name, q)

    # share / OG image: 1200x630, the arena scene with the logo on the calm sky at the top
    scene = Image.open(RAW / "og-scene.png").convert("RGB")
    scene = scene.resize((1200, round(scene.height * 1200 / scene.width)), Image.LANCZOS)
    top = 120
    og = scene.crop((0, top, 1200, top + 630)).convert("RGBA")
    logo = made["logo"]
    lw = 520
    logo = logo.resize((lw, round(logo.height * lw / logo.width)), Image.LANCZOS)
    og.alpha_composite(logo, ((1200 - lw) // 2, 14))
    og = og.convert("RGB")
    save(og, "og", 82)
    og.save(OUT / "og.jpg", "JPEG", quality=85, optimize=True, progressive=True)
    print(f"{'og.jpg':20s} {(OUT / 'og.jpg').stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
