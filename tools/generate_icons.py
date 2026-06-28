from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
ICONS = ROOT / "icons"


def make_icon(size: int, filename: str) -> None:
    scale = 4
    canvas_size = size * scale
    image = Image.new("RGB", (canvas_size, canvas_size), "#050510")
    glow = Image.new("RGBA", image.size, (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow)

    points = []
    for i in range(721):
        t = i * 3.141592653589793 * 2 / 720
        x = 16 * (sin(t) ** 3)
        y = 13 * cos(t) - 5 * cos(2 * t) - 2 * cos(3 * t) - cos(4 * t)
        points.append((
            canvas_size / 2 + x * canvas_size / 42,
            canvas_size * 0.52 - y * canvas_size / 42,
        ))

    glow_draw.polygon(points, fill=(255, 48, 160, 210))
    glow = glow.filter(ImageFilter.GaussianBlur(canvas_size * 0.045))
    image = Image.alpha_composite(image.convert("RGBA"), glow)

    draw = ImageDraw.Draw(image)
    draw.polygon(points, fill="#ff71ce")
    highlight = [
        (x * 0.72 + canvas_size * 0.14, y * 0.72 + canvas_size * 0.14)
        for x, y in points
    ]
    draw.line(highlight[:250], fill="#01cdfe", width=max(2, canvas_size // 95))
    image.resize((size, size), Image.Resampling.LANCZOS).convert("RGB").save(
        ICONS / filename,
        optimize=True,
    )


if __name__ == "__main__":
    from math import cos, sin

    ICONS.mkdir(parents=True, exist_ok=True)
    make_icon(192, "icon-192.png")
    make_icon(512, "icon-512.png")
    make_icon(180, "apple-touch-icon.png")
