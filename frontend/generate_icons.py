"""Génère les icônes PWA brandées Swiss Piscine (fond navy dégradé + vague aqua + SP)."""
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).parent / "icons"
OUT.mkdir(exist_ok=True)
NAVY = (11, 46, 63)
DEEP = (7, 33, 46)
AQUA_LIGHT = (140, 215, 230)
WHITE = (255, 255, 255)


def _font(size: int):
    for name in ("Sora-Bold.ttf", "seguibl.ttf", "segoeuib.ttf", "arialbd.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def make(size: int, maskable: bool = False) -> Image.Image:
    img = Image.new("RGBA", (size, size), NAVY + (255,))
    d = ImageDraw.Draw(img)
    for y in range(size):  # dégradé navy -> deep
        t = y / size
        c = tuple(int(NAVY[i] + (DEEP[i] - NAVY[i]) * t) for i in range(3))
        d.line([(0, y), (size, y)], fill=c + (255,))

    cx = size / 2
    base_y, amp = size * 0.60, size * 0.13
    pts = [(x, base_y + amp * math.sin((x / size) * math.pi * 2.1 + 0.4))
           for x in range(int(size * 0.12), int(size * 0.88))]
    d.line(pts, fill=AQUA_LIGHT + (255,), width=max(3, size // 26), joint="curve")

    f = _font(int(size * 0.30))
    box = d.textbbox((0, 0), "SP", font=f)
    tw, th = box[2] - box[0], box[3] - box[1]
    d.text((cx - tw / 2 - box[0], size * 0.34 - th / 2 - box[1]), "SP", font=f, fill=WHITE)
    return img


for s in (192, 512):
    make(s).save(OUT / f"icon-{s}.png")
make(512, maskable=True).save(OUT / "icon-maskable-512.png")
print("Icônes brandées générées dans", OUT)
