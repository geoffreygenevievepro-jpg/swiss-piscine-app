"""Génère les icônes PWA (navy + vague aqua + SP). Lancer une fois."""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).parent / "icons"
OUT.mkdir(exist_ok=True)
NAVY = (12, 34, 51)
AQUA = (25, 182, 201)
WHITE = (255, 255, 255)


def _font(size: int):
    for name in ("seguibl.ttf", "segoeuib.ttf", "arialbd.ttf", "Arialbd.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def make(size: int, maskable: bool = False) -> Image.Image:
    img = Image.new("RGBA", (size, size), NAVY + (255,))
    d = ImageDraw.Draw(img)
    # Vague aqua dans le bas.
    pad = int(size * 0.18) if maskable else 0
    wave_y = size * 0.62
    amp = size * 0.05
    pts = [(0, size)]
    for x in range(0, size + 1, max(1, size // 60)):
        import math
        y = wave_y + amp * math.sin(x / size * math.pi * 3)
        pts.append((x, y))
    pts.append((size, size))
    d.polygon(pts, fill=AQUA + (255,))
    # "SP"
    f = _font(int(size * 0.34))
    text = "SP"
    box = d.textbbox((0, 0), text, font=f)
    tw, th = box[2] - box[0], box[3] - box[1]
    d.text(((size - tw) / 2 - box[0], size * 0.30 - th / 2 - box[1]), text, font=f, fill=WHITE)
    return img


for s in (192, 512):
    make(s).save(OUT / f"icon-{s}.png")
make(512, maskable=True).save(OUT / "icon-maskable-512.png")
print("Icônes générées dans", OUT)
