"""Review sheet of every skill icon + archetype emblem at 128, 64 and 40 px on the dark UI colour and on light.
Usage: python tools/assets/contact_sheet.py <out.png>"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw

IMG = Path(__file__).resolve().parents[2] / "src/web/public/assets/img"


def main():
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("icons-contact-sheet.png")
    icons = sorted((IMG / "skills").glob("*.webp")) + sorted((IMG / "arch").glob("*.webp"))
    cols, cell = 8, 250
    rows = (len(icons) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * cell, rows * cell), "#1d1838")
    d = ImageDraw.Draw(sheet)
    for i, p in enumerate(icons):
        x, y = (i % cols) * cell, (i // cols) * cell
        if p.parent.name == "arch":
            d.rectangle((x, y, x + cell - 1, y + cell - 1), fill="#2b2455")
        d.rectangle((x + 140, y + 140, x + 245, y + 205), fill="#f4eefc")  # light-background check
        ic = Image.open(p).convert("RGBA")
        sheet.paste(ic, (x + 6, y + 6), ic)
        for s, (ox, oy) in ((64, (x + 140, y + 10)), (40, (x + 150, y + 85)), (40, (x + 150, y + 152))):
            small = ic.resize((s, s), Image.LANCZOS)
            sheet.paste(small, (ox, oy), small)
        small = ic.resize((32, 32), Image.LANCZOS)
        sheet.paste(small, (x + 205, y + 157), small)
        d.text((x + 8, y + 215), f"{p.parent.name}/{p.stem}", fill="#ffffff")
    sheet.save(out)
    print(out)


if __name__ == "__main__":
    main()
