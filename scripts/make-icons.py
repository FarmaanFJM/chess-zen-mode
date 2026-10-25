"""Regenerates icons/icon-{16,32,48,128}.png from docs/assets/chess-zen-mode-logo.png (needs Pillow).

32/48/128 are plain high-quality (Lanczos) downscales of the full logo. At 16 px the
full jacuzzi scene turns to mush, so 16 is a tighter crop of the same artwork around the
pawn and water (slightly more saturated and sharpened) to keep the pawn recognizable.
"""
from pathlib import Path
from PIL import Image, ImageEnhance, ImageFilter

root = Path(__file__).resolve().parent.parent
src = Image.open(root / "docs/assets/chess-zen-mode-logo.png").convert("RGB")
out = root / "icons"
out.mkdir(exist_ok=True)

for n in (32, 48, 128):
    src.resize((n, n), Image.LANCZOS, reducing_gap=3.0).save(out / f"icon-{n}.png", optimize=True)

small = src.crop((230, 170, 1030, 970)).resize((64, 64), Image.LANCZOS, reducing_gap=3.0)
small = ImageEnhance.Contrast(ImageEnhance.Color(small).enhance(1.3)).enhance(1.1)
small = small.resize((16, 16), Image.LANCZOS).filter(ImageFilter.UnsharpMask(radius=0.6, percent=80, threshold=0))
small.save(out / "icon-16.png", optimize=True)
print("icons written to", out)
