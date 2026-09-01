#!/usr/bin/env python3
"""One-off: draws the app icon (a stylised day grid in the JavaZone blues).

Re-run only to change the mark; the generated files are committed.
    python3 scripts/make-icons.py
"""
from PIL import Image, ImageDraw
import pathlib

OUT = pathlib.Path(__file__).resolve().parent.parent / "src" / "icons"
TOP, BOTTOM = (92, 158, 255), (24, 104, 189)          # #5c9eff -> #1868bd
GROUND = (7, 56, 108)                                  # #07386c
ACCENT = (2, 223, 255)                                 # #02dfff
PINK = (240, 86, 122)                                  # #f0567a
# Three columns of session blocks, as fractions of the canvas. The fourth
# element of each entry picks the fill, so the mark carries the two brand
# accents rather than being three columns of flat white.
BLOCKS = [
    (0.215, 0.255, 0.125, 0.295, "light"),
    (0.215, 0.590, 0.125, 0.175, "accent"),
    (0.4375, 0.310, 0.125, 0.430, "light"),
    (0.660, 0.255, 0.125, 0.195, "pink"),
    (0.660, 0.490, 0.125, 0.255, "light"),
]
FILL = {
    "light": (255, 255, 255, 255),
    "accent": ACCENT + (255,),
    "pink": PINK + (255,),
}


def draw(size: int) -> Image.Image:
    ss = 4                                            # supersample for clean edges
    n = size * ss
    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))

    gradient = Image.new("RGB", (1, n))
    for y in range(n):
        t = y / max(n - 1, 1)
        gradient.putpixel((0, y), tuple(round(a + (b - a) * t) for a, b in zip(TOP, BOTTOM)))
    gradient = gradient.resize((n, n))

    mask = Image.new("L", (n, n), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, n - 1, n - 1], radius=int(n * 0.22), fill=255)
    img.paste(gradient, (0, 0), mask)

    blocks = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    pen = ImageDraw.Draw(blocks)
    for x, y, w, h, kind in BLOCKS:
        pen.rounded_rectangle(
            [x * n, y * n, (x + w) * n, (y + h) * n],
            radius=int(n * 0.028),
            fill=FILL[kind],
        )
    img.alpha_composite(blocks)
    return img.resize((size, size), Image.LANCZOS)


OUT.mkdir(parents=True, exist_ok=True)
for size in (180, 192, 512):
    draw(size).save(OUT / f"icon-{size}.png")

# Maskable variant: the same mark inset so it survives a circular safe zone.
base = draw(512)
inner = base.resize((round(512 * 0.72),) * 2, Image.LANCZOS)
maskable = Image.new("RGBA", (512, 512), GROUND + (255,))
maskable.alpha_composite(inner, ((512 - inner.width) // 2,) * 2)
maskable.save(OUT / "icon-maskable-512.png")

print("icons written:", ", ".join(sorted(p.name for p in OUT.glob("*.png"))))
