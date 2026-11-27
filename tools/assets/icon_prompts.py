"""Write the Codex prompt files for the skill icons and archetype emblems (tools/assets/prompts/icons-*.txt).
Usage: python tools/assets/icon_prompts.py
Then run each prompt file through Codex image generation (see docs/ops/ASSETS.md) and save the PNGs as
tools/assets/.cache/raw/skills/<id>.png and tools/assets/.cache/raw/arch/<arch>.png."""
from pathlib import Path

OUT = Path(__file__).resolve().parent / "prompts"

RING = {
    "tank": "soft sky blue #9ccbff",
    "burst": "pastel pink #ffa6ba",
    "scaling": "warm pastel gold #ffd98f",
    "control": "pastel mint #9df0df",
    "none": "soft lavender #c6c1e8",
}

# id, archetype, hero-unique?, symbol
SKILLS = [
    ("strike", "burst", False, "a single cream-silver sword mid-swing with a bright pink curved slash arc"),
    ("jab", "burst", False, "a small short dagger thrusting diagonally forward with three speed lines, a tiny impact spark at the tip"),
    ("heavy", "burst", False, "a big chunky wooden-and-steel war hammer smashing down onto a cracked ground with a big impact star"),
    ("charge", "burst", False, "a clenched cute fist glowing with gathering golden-pink energy, small sparkles spiralling inward towards it"),
    ("shield", "tank", False, "a big rounded knight shield held up, light blue face with a cream crescent-moon emblem"),
    ("thorns", "tank", False, "a chunky round blue-steel armour chestplate with a ring of big sharp cream spikes sticking straight out all around it like a porcupine, no emblem"),
    ("stoneskin", "tank", False, "a rounded grey-blue boulder with a stone-plated arm flexing in front of it, crack lines, very solid"),
    ("cleanse", "tank", False, "a sparkling water droplet with a big four-point twinkle star and small bubbles, purifying sparkles"),
    ("train", "scaling", False, "a chunky dumbbell with a bold upward green arrow rising behind it"),
    ("ignite", "scaling", False, "one single cute teardrop-shaped orange and yellow flame floating on its own (NO candle, NO cake, nothing under it), warm glow"),
    ("feast", "scaling", False, "a bowl with three round white mochi dango balls on a stick, a small heart floating above"),
    ("amplify", "scaling", False, "a round magnifying glass with a bold cream 'x2' inside the lens (the only text allowed: x2)"),
    ("frost", "control", False, "a round icy blue ice ball / snowball with frost sparkles and a small motion trail"),
    ("chill", "control", False, "a swirling cold wind gust curl with tiny snowflakes, and a small cute snail riding the swirl"),
    ("dispel", "control", False, "a magic rune circle cracking and breaking apart into shards with a burst of light"),
    ("ironwill", "none", False, "a heart made of riveted iron / steel, sturdy and shiny"),
    ("gear", "none", False, "a single big chunky golden-bronze gear cog"),
    ("overclock", "none", False, "a cute little rocket blasting upward with a big flame trail and speed lines"),
    ("bulwark", "tank", True, "a round shield seen from the side, slamming to the right into a big yellow-white impact starburst with bold motion lines behind the shield"),
    ("spikewall", "tank", True, "a small stone fortress tower with thorny vines and spikes all along its walls"),
    ("execute", "burst", True, "a red-pink target crosshair with a dagger stabbing into the centre"),
    ("flurry", "burst", True, "many small swords (five) spinning in a whirlwind circle, a storm of blades"),
    ("rampage", "scaling", True, "a fierce red-orange face mask with two big curved rage horns and steam puffs"),
    ("inferno", "scaling", True, "a big round fire explosion: a blast of orange-red flames bursting outwards"),
    ("shatter", "control", True, "a cube of ice being smashed into pieces, shards flying apart with a crack line"),
    ("timewarp", "control", True, "an hourglass with golden sand, wrapped by a spiral time swirl arrow"),
]

ARCHES = [
    ("tank", "a big plain rounded blue heater shield with a bold cream plus-shaped band across it, no other emblem"),
    ("burst", "a crossed sword and a three-line claw slash"),
    ("scaling", "a small green sprout growing with a bold upward arrow"),
    ("control", "a big snowflake with a small clock face in its centre"),
    ("none", "a cream crescent moon with a tiny star"),
]

STYLE = """Shared art direction for EVERY image (they form one icon set for the cute mobile game "Mochi Moon"):
- Square 1024x1024, plain flat pure #ff00ff magenta background (it is keyed out later). Nothing else on the background: no shadow, no gradient, no sparkles outside the badge.
- A centred round badge filling about 88% of the canvas: outermost thick dark plum outline (#3a2b33, never pure black), then a thick glossy coloured RING in the colour given for that icon, then a thin plum line, then an inner disc of deep indigo night (#2b2455) with a soft lighter glow behind the symbol and 2-3 tiny faint stars.
- In the middle ONE big simple bold symbol filling about 60% of the inner disc: chunky rounded kawaii shapes, thick dark plum outlines, flat bright pastel colours with light cel shading, strong contrast against the dark disc. It must stay readable when shrunk to 40 px, so no small details and no busy backgrounds.
- No text, letters or numbers (unless stated), no faces unless stated, no watermark. Avoid colours close to #ff00ff in the badge itself.
- Same badge construction, line weight, lighting and angle for every icon so they look like one set.
Use your image generation tool once per image (one badge per image); do not download anything from the internet. Generate them in the listed order. After generating, just reply with a one-line list of what you made, in order."""


def item(i, ring, symbol, unique=False):
    star = " Also put a small bright gold five-point star on the ring at the top-right (marks a hero-unique skill)." if unique else ""
    return f"{i}. Ring colour {RING[ring]}. Symbol: {symbol}.{star}"


def main():
    batches = []
    for k in range(0, len(SKILLS), 6):
        chunk = SKILLS[k:k + 6]
        batches.append((f"icons-skills-{k // 6 + 1}", [s[0] for s in chunk],
                        [item(i + 1, a, sym, u) for i, (sid, a, u, sym) in enumerate(chunk)]))
    # second pass: the four icons redone after review (thorns / ignite / bulwark / tank emblem)
    redo = [x for x in SKILLS if x[0] in ("thorns", "ignite", "bulwark")]
    lines = [item(i + 1, a, sym, u) for i, (sid, a, u, sym) in enumerate(redo)]
    lines.append(item(len(lines) + 1, "tank", ARCHES[0][1]))
    batches.append(("icons-redo", [x[0] for x in redo] + ["arch:tank"], lines))
    batches.append(("icons-arch", [a for a, _ in ARCHES], [item(i + 1, a, sym) for i, (a, sym) in enumerate(ARCHES)]))
    for name, ids, lines in batches:
        text = f"Generate {len(lines)} images. {STYLE}\n" + "\n".join(lines) + "\n"
        (OUT / f"{name}.txt").write_text(text, encoding="utf-8")
        print(name, ", ".join(ids))


if __name__ == "__main__":
    main()
