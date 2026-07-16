"""Dev-only: regenerate LOGO_PIXELS for nao_core/branding.py from the source logo PNG."""

from __future__ import annotations

from collections import Counter
from typing import cast

from PIL import Image

SRC = "/Users/adam/.cursor/projects/Users-adam-Documents-1-Projects-Nao-nao/assets/nao_logo-3acd156b-d8a0-4bb7-93d0-b281657c814a.png"
TARGET_WIDTH = 18
PAD = 4


def is_purple(pixel: tuple[int, int, int]) -> bool:
    r, g, b = pixel
    return max(r, g, b) > 55 and b > 45


def is_bright(pixel: tuple[int, int, int]) -> bool:
    r, g, b = pixel
    return max(r, g, b) > 60 and b > 48


def main() -> None:
    image = Image.open(SRC).convert("RGB")
    pixels = image.load()
    assert pixels is not None
    width, height = image.size

    xs: list[int] = []
    ys: list[int] = []
    for y in range(0, height, 2):
        for x in range(0, width, 2):
            if is_purple(cast(tuple[int, int, int], pixels[x, y])):
                xs.append(x)
                ys.append(y)
    x0, x1 = max(0, min(xs) - PAD), min(width, max(xs) + PAD)
    y0, y1 = max(0, min(ys) - PAD), min(height, max(ys) + PAD)

    crop = image.crop((x0, y0, x1, y1))
    crop_width, crop_height = crop.size
    target_height = max(1, round(TARGET_WIDTH * crop_height / crop_width))
    small = crop.resize((TARGET_WIDTH, target_height), Image.Resampling.LANCZOS)
    small_pixels = small.load()
    assert small_pixels is not None

    counter: Counter[tuple[int, int, int]] = Counter()
    for y in range(target_height):
        for x in range(TARGET_WIDTH):
            pixel = cast(tuple[int, int, int], small_pixels[x, y])
            if is_bright(pixel):
                r, g, b = pixel
                counter[(r // 8 * 8, g // 8 * 8, b // 8 * 8)] += 1
    dominant = counter.most_common(1)[0][0]
    flat = f"#{dominant[0]:02x}{dominant[1]:02x}{dominant[2]:02x}"

    rows: list[list[str | None]] = []
    for y in range(target_height):
        row: list[str | None] = []
        for x in range(TARGET_WIDTH):
            pixel = cast(tuple[int, int, int], small_pixels[x, y])
            row.append(flat if is_bright(pixel) else None)
        rows.append(row)

    print(f"# flat color: {flat}, size {TARGET_WIDTH}x{target_height}")
    print("LOGO_PIXELS: list[list[str | None]] = [")
    for row in rows:
        cells = ", ".join("None" if c is None else f'"{c}"' for c in row)
        print(f"    [{cells}],")
    print("]")


if __name__ == "__main__":
    main()
