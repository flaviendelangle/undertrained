#!/usr/bin/env python3
"""Rasterize resources/icon.svg into the PNG sizes the desktop needs.

The mark is simple enough (rounded square, two stroked curves, one pill) to draw
directly with Pillow, so no SVG toolchain is required. Run from the desktop/ directory:

    python3 scripts/render-icon.py

Outputs resources/icon.png (256 px, window and Linux launcher icon) and
resources/icon-1024.png (source for the macOS .icns built by scripts/bundle-macos.sh).
"""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent / "resources"
SCALE = 32  # 64-unit viewBox rendered at 2048 px, then downsampled.
BACKGROUND = "#1c2128"
STROKE = "#f7f4ec"
ACCENT = "#44b589"


def cubic(p0, p1, p2, p3, steps=64):
    """Flatten one cubic Bézier segment into points."""
    points = []
    for i in range(steps + 1):
        t = i / steps
        u = 1 - t
        x = u**3 * p0[0] + 3 * u**2 * t * p1[0] + 3 * u * t**2 * p2[0] + t**3 * p3[0]
        y = u**3 * p0[1] + 3 * u**2 * t * p1[1] + 3 * u * t**2 * p2[1] + t**3 * p3[1]
        points.append((x, y))
    return points


def arm(mirror):
    """One side of the "u": a vertical line into a curve toward the middle."""
    sign = -1 if mirror else 1
    x0 = 46 if mirror else 18
    line = [(x0, 18), (x0, 33)]
    curve = cubic((x0, 33), (x0, 41.2), (x0 + sign * 4.8, 46.1), (x0 + sign * 11.2, 47.6))
    return line + curve[1:]


def stroke_path(draw, points, width, color):
    """Stamp a disc every pixel along the path: a clean round-capped stroke without join artifacts."""
    radius = width * SCALE / 2
    scaled = [(x * SCALE, y * SCALE) for x, y in points]
    for (x0, y0), (x1, y1) in zip(scaled, scaled[1:]):
        length = max(1, int(((x1 - x0) ** 2 + (y1 - y0) ** 2) ** 0.5))
        for i in range(length + 1):
            t = i / length
            x = x0 + (x1 - x0) * t
            y = y0 + (y1 - y0) * t
            draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=color)


def render(size):
    canvas = Image.new("RGBA", (64 * SCALE, 64 * SCALE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    draw.rounded_rectangle((0, 0, 64 * SCALE, 64 * SCALE), radius=14 * SCALE, fill=BACKGROUND)
    stroke_path(draw, arm(False), 5.5, STROKE)
    stroke_path(draw, arm(True), 5.5, STROKE)
    draw.rounded_rectangle(
        (30.5 * SCALE, 45 * SCALE, 33.5 * SCALE, 51 * SCALE), radius=1.5 * SCALE, fill=ACCENT
    )
    return canvas.resize((size, size), Image.LANCZOS)


if __name__ == "__main__":
    render(256).save(ROOT / "icon.png")
    render(1024).save(ROOT / "icon-1024.png")
    print("Wrote resources/icon.png and resources/icon-1024.png")
