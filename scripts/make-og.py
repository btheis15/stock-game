#!/usr/bin/env python3
"""Generate OpenGraph card (1200x630) for social/iMessage previews."""
from PIL import Image, ImageDraw, ImageFont
import os

OUT = os.path.join(os.path.dirname(__file__), "..", "public", "og.png")

W, H = 1200, 630
BG = (0, 0, 0)
BRIAN = (0, 200, 5)
KEVIN = (90, 200, 250)
FG = (255, 255, 255)
DIM = (160, 160, 165)


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    candidates_bold = [
        "/System/Library/Fonts/SFNSRounded.ttf",
        "/System/Library/Fonts/HelveticaNeue.ttc",
        "/Library/Fonts/Arial Bold.ttf",
    ]
    candidates_regular = [
        "/System/Library/Fonts/SFNS.ttf",
        "/System/Library/Fonts/HelveticaNeue.ttc",
        "/Library/Fonts/Arial.ttf",
    ]
    for path in candidates_bold if bold else candidates_regular:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return ImageFont.load_default()


def main():
    img = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(img)

    # Subtle radial vignette
    for r in range(0, 400, 8):
        alpha = max(0, 30 - r // 16)
        draw.ellipse(
            (W // 2 - r * 1.5, H // 2 - r, W // 2 + r * 1.5, H // 2 + r),
            outline=(20, 20, 22),
        )

    # Two diverging stock lines across the canvas
    margin_x = 90
    chart_top = 380
    chart_bottom = 540

    def line(pts, color, width=8):
        scaled = [(margin_x + p[0] * (W - 2 * margin_x), chart_top + p[1] * (chart_bottom - chart_top))
                  for p in pts]
        draw.line(scaled, fill=color, width=width, joint="curve")

    line([(0.00, 0.85), (0.10, 0.78), (0.20, 0.82), (0.32, 0.62), (0.45, 0.70),
          (0.58, 0.50), (0.70, 0.40), (0.85, 0.22), (1.00, 0.15)], KEVIN)
    line([(0.00, 0.85), (0.12, 0.74), (0.22, 0.78), (0.36, 0.68), (0.48, 0.72),
          (0.60, 0.62), (0.72, 0.66), (0.85, 0.58), (1.00, 0.55)], BRIAN)

    # Top-left mini-mark (two dots = the icon motif)
    draw.ellipse((90, 88, 110, 108), fill=BRIAN)
    draw.ellipse((118, 88, 138, 108), fill=KEVIN)
    draw.text((150, 80), "STOCK GAME", fill=DIM, font=font(28, bold=True))

    # Headline
    draw.text((90, 150), "Brian vs Kevin", fill=FG, font=font(96, bold=True))
    draw.text((90, 260), "Portfolio showdown,", fill=DIM, font=font(38))
    draw.text((90, 308), "tracked since Feb 5, 2026.", fill=DIM, font=font(38))

    # Bottom-right legend
    draw.ellipse((W - 280, H - 70, W - 264, H - 54), fill=BRIAN)
    draw.text((W - 254, H - 78), "Brian", fill=FG, font=font(28, bold=True))
    draw.ellipse((W - 170, H - 70, W - 154, H - 54), fill=KEVIN)
    draw.text((W - 144, H - 78), "Kevin", fill=FG, font=font(28, bold=True))

    img.save(OUT, format="PNG", optimize=True)
    print(f"Wrote {OUT} ({W}x{H})")


if __name__ == "__main__":
    main()
