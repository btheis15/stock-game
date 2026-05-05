#!/usr/bin/env python3
"""Generate OpenGraph card (1200x630) for social/iMessage previews."""
from PIL import Image, ImageDraw, ImageFont
import os

OUT = os.path.join(os.path.dirname(__file__), "..", "public", "og.png")

W, H = 1200, 630
BG = (0, 0, 0)
BRIAN = (0, 200, 5)
KEVIN = (90, 200, 250)
RICK = (255, 159, 10)
LEE = (191, 90, 242)
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

    # 4 diverging lines — winner most upward, others varied
    line([(0.00, 0.85), (0.08, 0.74), (0.18, 0.70), (0.30, 0.55), (0.42, 0.48),
          (0.55, 0.36), (0.68, 0.28), (0.82, 0.18), (1.00, 0.08)], RICK)
    line([(0.00, 0.85), (0.10, 0.78), (0.20, 0.82), (0.32, 0.62), (0.45, 0.70),
          (0.58, 0.50), (0.70, 0.40), (0.85, 0.26), (1.00, 0.18)], KEVIN)
    line([(0.00, 0.85), (0.12, 0.82), (0.24, 0.78), (0.36, 0.74), (0.48, 0.70),
          (0.60, 0.66), (0.72, 0.62), (0.85, 0.58), (1.00, 0.54)], LEE)
    line([(0.00, 0.85), (0.12, 0.74), (0.22, 0.78), (0.36, 0.72), (0.48, 0.78),
          (0.60, 0.74), (0.72, 0.78), (0.85, 0.74), (1.00, 0.72)], BRIAN)

    # Top-left mini-mark (four dots = the icon motif)
    for i, c in enumerate([BRIAN, KEVIN, RICK, LEE]):
        x = 90 + i * 24
        draw.ellipse((x, 88, x + 16, 104), fill=c)
    draw.text((90 + 4 * 24 + 12, 80), "STOCK GAME", fill=DIM, font=font(26, bold=True))

    # Headline
    draw.text((90, 150), "5-Year Portfolio Showdown", fill=FG, font=font(68, bold=True))
    draw.text((90, 260), "Loser pays for golf —", fill=DIM, font=font(36))
    draw.text((90, 304), "tracked since Feb 5, 2026", fill=DIM, font=font(36))

    img.save(OUT, format="PNG", optimize=True)
    print(f"Wrote {OUT} ({W}x{H})")


if __name__ == "__main__":
    main()
