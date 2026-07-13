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



def make_maskable(size: int) -> Image.Image:
    """Maskable variant: same art scaled into the ~80% safe zone so Android
    launcher shapes (circle / squircle) never clip the chart lines. The plain
    icons stay full-bleed for `purpose: any`."""
    img = Image.new("RGBA", (size, size), BG + (255,))
    art = make_icon(int(size * 0.72))
    off = (size - art.size[0]) // 2
    img.paste(art, (off, off), art)
    return img


# iOS home-screen PWA launch images. Without these, cold launch flashes a
# plain black/white screen; with them, launch shows the app mark instantly.
# (device_width_pt, device_height_pt, scale) — covers the iPhone models the
# group plausibly owns (X/11 era through 16 Pro Max). Each emits
# public/splash/splash-{W}x{H}.png plus a <link> tag in app/layout.tsx
# (media-queried by device size + pixel ratio + orientation).
SPLASH_DEVICES = [
    (375, 812, 3),   # iPhone X / XS / 11 Pro / 12-13 mini
    (390, 844, 3),   # iPhone 12 / 13 / 14
    (393, 852, 3),   # iPhone 14 Pro / 15 / 16
    (402, 874, 3),   # iPhone 16 Pro
    (414, 896, 2),   # iPhone XR / 11
    (428, 926, 3),   # iPhone 12-14 Pro Max / 14 Plus
    (430, 932, 3),   # iPhone 14-15 Pro Max / 15-16 Plus
    (440, 956, 3),   # iPhone 16 Pro Max
]


def make_splash(w_px: int, h_px: int) -> Image.Image:
    img = Image.new("RGBA", (w_px, h_px), BG + (255,))
    art = make_icon(int(min(w_px, h_px) * 0.32))
    img.paste(art, ((w_px - art.size[0]) // 2, (h_px - art.size[1]) // 2), art)
    return img


def save_splashes():
    splash_dir = os.path.join(OUT, "splash")
    os.makedirs(splash_dir, exist_ok=True)
    for w_pt, h_pt, scale in SPLASH_DEVICES:
        w_px, h_px = w_pt * scale, h_pt * scale
        img = make_splash(w_px, h_px)
        path = os.path.join(splash_dir, f"splash-{w_px}x{h_px}.png")
        img.save(path, format="PNG")
        print(f"Wrote {path} ({w_px}x{h_px})")
    print("\n<link> tags for app/layout.tsx:")
    for w_pt, h_pt, scale in SPLASH_DEVICES:
        w_px, h_px = w_pt * scale, h_pt * scale
        print(
            f'<link rel="apple-touch-startup-image" media="(device-width: {w_pt}px) and (device-height: {h_pt}px) '
            f'and (-webkit-device-pixel-ratio: {scale}) and (orientation: portrait)" href="/splash/splash-{w_px}x{h_px}.png" />'
        )


def save(img: Image.Image, name: str):
    path = os.path.join(OUT, name)
    img.save(path, format="PNG")
    print(f"Wrote {path} ({img.size[0]}x{img.size[1]})")


def main():
    save(make_icon(192), "icon-192.png")
    save(make_icon(512), "icon-512.png")
    save(make_icon(180), "apple-touch-icon.png")
    save(make_icon(32), "favicon.png")
    save(make_maskable(192), "icon-192-maskable.png")
    save(make_maskable(512), "icon-512-maskable.png")
    save_splashes()


if __name__ == "__main__":
    main()
