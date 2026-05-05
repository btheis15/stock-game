#!/usr/bin/env python3
"""Generate PWA + Apple touch icons for the Stock Game app."""
from PIL import Image, ImageDraw
import os

OUT = os.path.join(os.path.dirname(__file__), "..", "public")

BRIAN = (0, 200, 5)
KEVIN = (90, 200, 250)
BG = (0, 0, 0)


def make_icon(size: int, maskable: bool = False) -> Image.Image:
    img = Image.new("RGBA", (size, size), BG + (255,))
    draw = ImageDraw.Draw(img)

    # Draw two diverging lines (Brian rising, Kevin slightly less rising)
    margin = size * 0.18
    w = size - 2 * margin
    h = size - 2 * margin
    cx = margin
    cy = margin

    # Brian path: starts low-left, sweeps up-right with a small dip
    brian_pts = [
        (cx + w * 0.0, cy + h * 0.78),
        (cx + w * 0.20, cy + h * 0.62),
        (cx + w * 0.38, cy + h * 0.66),
        (cx + w * 0.58, cy + h * 0.42),
        (cx + w * 0.78, cy + h * 0.32),
        (cx + w * 1.0, cy + h * 0.10),
    ]
    # Kevin path: more volatile, ends a bit lower
    kevin_pts = [
        (cx + w * 0.0, cy + h * 0.78),
        (cx + w * 0.22, cy + h * 0.74),
        (cx + w * 0.42, cy + h * 0.50),
        (cx + w * 0.62, cy + h * 0.58),
        (cx + w * 0.82, cy + h * 0.40),
        (cx + w * 1.0, cy + h * 0.30),
    ]

    line_w = max(int(size * 0.045), 4)
    draw.line(kevin_pts, fill=KEVIN + (255,), width=line_w, joint="curve")
    draw.line(brian_pts, fill=BRIAN + (255,), width=line_w, joint="curve")

    return img


def save(img: Image.Image, name: str):
    path = os.path.join(OUT, name)
    img.save(path, format="PNG")
    print(f"Wrote {path} ({img.size[0]}x{img.size[1]})")


def main():
    save(make_icon(192), "icon-192.png")
    save(make_icon(512), "icon-512.png")
    save(make_icon(180), "apple-touch-icon.png")
    save(make_icon(32), "favicon.png")


if __name__ == "__main__":
    main()
