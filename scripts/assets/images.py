"""Turn the Codex-generated PNGs into the shipped webp files.
Usage: python scripts/assets/images.py [raw_dir] [--wide]   (default scripts/assets/.cache/raw)
--wide only rebuilds set 2 (wide backgrounds, panel texture, rotate hint, skill icons, archetype emblems).
raw_dir must hold the source PNGs named as in SOURCES below (see docs/ASSETS.md for the prompts).
Magenta (#ff00ff) backgrounds are keyed out to alpha with spill removal."""
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
ARGS = [a for a in sys.argv[1:] if not a.startswith("--")]
RAW = Path(ARGS[0]) if ARGS else ROOT / "scripts/assets/.cache/raw"
OUT = ROOT / "src/client/public/assets/img"
TOWN_IDS = {"town-ground", "td-mine", "td-shrine", "td-lumber", "td-hall", "td-arena", "td-board", "td-tower", "td-market", "td-nest"}
FARM_IDS = {"res-wood", "res-ore", "res-crystal", "ticket", "egg", "egg-cracking", "monument"} | TOWN_IDS

# out name: (source png, keyed?, max width, crop box as fractions (l, t, r, b) or None, webp quality)
SOURCES = {
    "bg-title": ("bg-title.png", False, 1536, None, 88),
    "logo": ("logo.png", True, 1024, "bbox", 85),
    "bg-shop": ("bg-shop.png", False, 1536, None, 86),
    "banner-victory": ("banner-victory.png", True, 900, "bbox", 82),
    "banner-defeat": ("banner-defeat.png", True, 900, "bbox", 82),
    "stardust": ("stardust.png", True, 256, "bbox", 88),
    "res-wood": ("res-wood.png", True, 256, "bbox", 88),
    "res-ore": ("res-ore.png", True, 256, "bbox", 88),
    "res-crystal": ("res-crystal.png", True, 256, "bbox", 88),
    "ticket": ("ticket.png", True, 256, "bbox", 88),
    "egg": ("egg.png", True, 256, "bbox", 88),
    "egg-cracking": ("egg-cracking.png", True, 256, "bbox", 88),
    "monument": ("monument.png", True, 512, "bbox", 88),
    "chest": ("chest.png", True, 512, "bbox", 85),
    # top-down town (sim farm, 2026-11-26): the ground map and one sprite per landmark, same 3/4 camera
    "town-ground": ("town-ground.png", False, 1600, None, 80),
    "td-mine": ("td-mine.png", True, 360, "bbox", 86),
    "td-shrine": ("td-shrine.png", True, 360, "bbox", 86),
    "td-lumber": ("td-lumber.png", True, 360, "bbox", 86),
    "td-hall": ("td-hall.png", True, 360, "bbox", 86),
    "td-arena": ("td-arena.png", True, 420, "bbox", 86),
    "td-board": ("td-board.png", True, 360, "bbox", 86),
    "td-tower": ("td-tower.png", True, 300, "bbox", 86),
    "td-market": ("td-market.png", True, 360, "bbox", 86),
    "td-nest": ("td-nest.png", True, 200, "bbox", 86),
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


def warm_wood(img):
    """The generated log bundle came out purple, too close to the ore icon at 20 px: turn violet hues to warm brown."""
    a = np.array(img.convert("RGBA"))
    hsv = np.array(Image.fromarray(a[..., :3]).convert("HSV")).astype(int)
    h, s = hsv[..., 0], hsv[..., 1]
    sel = (a[..., 3] > 0) & (h > 150) & (h < 235) & (s > 40)
    h[sel] = (18 + (h[sel] - 190) // 6) % 256
    s[sel] = np.clip(s[sel] * 0.9, 0, 255)
    rgb = np.array(Image.fromarray(hsv.astype("uint8"), "HSV").convert("RGB"))
    return Image.fromarray(np.dstack([rgb, a[..., 3]]), "RGBA")


def main():
    made = {}
    for name, (src, keyed, max_w, crop, q) in SOURCES.items():
        if "--farm" in sys.argv and name not in FARM_IDS:
            continue
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
        if name == "res-wood":
            img = warm_wood(img)
        made[name] = save(fit(img, max_w), name, q)

    if "--farm" in sys.argv:
        return

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

    if (RAW / "bg-home-wide.png").exists():
        wide_set()


# ---- set 2 (landscape UI): wide backgrounds, panel texture, rotate hint, skill icons, archetype emblems ----

SKILL_IDS = [
    "strike", "jab", "heavy", "charge", "shield", "thorns", "stoneskin", "cleanse", "train", "ignite", "feast",
    "amplify", "frost", "chill", "dispel", "ironwill", "gear", "overclock", "bulwark", "spikewall", "execute",
    "flurry", "rampage", "inferno", "shatter", "timewarp",
]
ARCHES = ["tank", "burst", "scaling", "control", "none"]


def wide(img, w=1920, h=1080):
    """Centre-crop to 16:9 and scale to w x h."""
    img = img.convert("RGB")
    tw = min(img.width, round(img.height * w / h))
    th = round(tw * h / w)
    l, t = (img.width - tw) // 2, (img.height - th) // 2
    return img.crop((l, t, l + tw, t + th)).resize((w, h), Image.LANCZOS)


def save_max(img, name, max_kb, q=86, out=None):
    """Save webp, lowering quality until the file is <= max_kb."""
    out = out or OUT
    out.mkdir(parents=True, exist_ok=True)
    p = out / f"{name}.webp"
    while True:
        img.save(p, "WEBP", quality=q, method=6)
        if p.stat().st_size <= max_kb * 1024 or q <= 40:
            break
        q -= 4
    print(f"{name:20s} {img.width}x{img.height}  q{q}  {p.stat().st_size // 1024} KB")


def seamless(img):
    """Blend the image with a half-offset copy of itself so it tiles with no visible seam."""
    a = np.asarray(img.convert("RGB")).astype(np.float32)
    h, w = a.shape[:2]
    rolled = np.roll(a, (h // 2, w // 2), axis=(0, 1))
    wy = np.sin(np.pi * (np.arange(h) + 0.5) / h)[:, None]
    wx = np.sin(np.pi * (np.arange(w) + 0.5) / w)[None, :]
    m = (wy * wx)[..., None] ** 0.7
    return Image.fromarray(np.clip(a * m + rolled * (1 - m), 0, 255).astype(np.uint8), "RGB")


def badge(src, size=128):
    """Key the magenta, crop to the badge and scale to a square icon."""
    img = key_magenta(Image.open(src))
    al = np.asarray(img.getchannel("A"))
    bb = Image.fromarray(((al > 128) * 255).astype(np.uint8)).getbbox()
    cx, cy = (bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2
    r = max(bb[2] - bb[0], bb[3] - bb[1]) / 2 + 6
    img = img.crop((round(cx - r), round(cy - r), round(cx + r), round(cy + r)))
    return img.resize((size, size), Image.LANCZOS)


def wide_set():
    from PIL import ImageEnhance, ImageFilter

    save_max(wide(Image.open(RAW / "bg-home-wide.png")), "bg-home-wide", 450)

    game = wide(Image.open(RAW / "bg-game-wide.png"))
    # keep it calm behind the panels: soften, mute and darken a little
    game = game.filter(ImageFilter.GaussianBlur(1.5))
    game = ImageEnhance.Color(game).enhance(0.85)
    game = ImageEnhance.Brightness(game).enhance(0.82)
    save_max(game, "bg-game-wide", 450, q=80)

    panel = Image.open(RAW / "bg-panel.png").convert("RGB").resize((512, 512), Image.LANCZOS)
    save_max(seamless(panel), "bg-panel", 120, q=82)

    rot = key_magenta(Image.open(RAW / "rotate-phone.png"))
    bb = rot.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
    rot = rot.crop((max(0, bb[0] - 8), max(0, bb[1] - 8), min(rot.width, bb[2] + 8), min(rot.height, bb[3] + 8)))
    rot.thumbnail((512, 512), Image.LANCZOS)
    save_max(rot, "rotate-phone", 80, q=86)

    for sid in SKILL_IDS:
        save_max(badge(RAW / "skills" / f"{sid}.png"), sid, 16, q=88, out=OUT / "skills")
    for a in ARCHES:
        save_max(badge(RAW / "arch" / f"{a}.png"), a, 16, q=88, out=OUT / "arch")


if __name__ == "__main__":
    if "--wide" in sys.argv:
        wide_set()
    else:
        main()
