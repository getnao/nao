"""Generate the terminal logo matrix from the source artwork."""

from __future__ import annotations

import argparse
from importlib import import_module
from pathlib import Path
from typing import cast

Image = import_module("PIL.Image")

SOURCE_LOGO = Path(
    "/Users/adam/.cursor/projects/Users-adam-Documents-1-Projects-Nao-nao/assets/"
    "image-f3f9fd3e-fbfa-41c4-9442-514c37ce8586.png"
)
PREVIEW_PATH = Path(__file__).parents[1] / "logo_preview.png"
TARGET_WIDTH = 12
WHITE_LUMINANCE_THRESHOLD = 0.85
WHITE_SATURATION_THRESHOLD = 0.18
CORNER_RADIUS_RATIO = 0.15


def main() -> None:
    """Generate and print the logo pixel matrix."""
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=SOURCE_LOGO)
    parser.add_argument("--width", type=int, default=TARGET_WIDTH)
    args = parser.parse_args()

    image = Image.open(args.source).convert("RGB")
    icon = crop_to_purple_square(remove_outer_border(image))
    resized = resize_icon(icon, args.width)
    pixels = trim_transparent_edges(image_to_pixels(resized))
    save_preview(pixels, PREVIEW_PATH)
    print_matrix(pixels)


def remove_outer_border(image: Image.Image) -> Image.Image:
    """Make the light border connected to the image edge transparent."""
    width, height = image.size
    pixels = list(image.get_flattened_data())
    exterior = set[tuple[int, int]]()
    pending = [(x, y) for x in range(width) for y in (0, height - 1) if not is_purple(pixels[y * width + x])]
    pending.extend((x, y) for y in range(1, height - 1) for x in (0, width - 1) if not is_purple(pixels[y * width + x]))
    while pending:
        x, y = pending.pop()
        if (x, y) in exterior or is_purple(pixels[y * width + x]):
            continue
        exterior.add((x, y))
        pending.extend(
            (next_x, next_y)
            for next_x, next_y in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1))
            if 0 <= next_x < width and 0 <= next_y < height and (next_x, next_y) not in exterior
        )
    alpha = [0 if (x, y) in exterior else 255 for y in range(height) for x in range(width)]
    result = image.convert("RGBA")
    result.putalpha(Image.frombytes("L", image.size, bytes(alpha)))
    return result


def crop_to_purple_square(image: Image.Image) -> Image.Image:
    """Crop the image to the purple icon background."""
    mask = Image.new("1", image.size)
    pixels = cast(list[tuple[int, int, int, int]], list(image.get_flattened_data()))
    mask.putdata([pixel[3] > 0 and is_purple(pixel[:3]) for pixel in pixels])
    bounding_box = mask.getbbox()
    if bounding_box is None:
        raise ValueError("Source image does not contain a purple icon.")
    return image.crop(bounding_box)


def resize_icon(image: Image.Image, width: int) -> Image.Image:
    """Resize the icon while preserving its aspect ratio."""
    height = round(image.height * width / image.width)
    return image.resize((width, height), Image.Resampling.LANCZOS)


def image_to_pixels(image: Image.Image) -> list[list[str | None]]:
    """Convert a logo image to terminal pixel colors."""
    return [
        [
            None if outside_rounded_square(x, y, image.width, image.height) else classify_pixel(pixel)
            for x, pixel in enumerate(row)
        ]
        for y, row in enumerate(image_to_rows(image))
    ]


def image_to_rows(image: Image.Image) -> list[list[tuple[int, int, int, int]]]:
    """Return image pixels grouped into rows."""
    data = list(image.get_flattened_data())
    return [data[index : index + image.width] for index in range(0, len(data), image.width)]


def is_purple(pixel: tuple[int, int, int]) -> bool:
    """Return whether a pixel belongs to the purple icon background."""
    red, green, blue = pixel
    return blue >= 100 and red >= 55 and blue - green >= 75 and blue >= red


def classify_pixel(pixel: tuple[int, int, int, int]) -> str | None:
    """Return the terminal color for an icon pixel."""
    red, green, blue, alpha = pixel
    if alpha < 128:
        return None
    maximum = max(red, green, blue)
    minimum = min(red, green, blue)
    luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255
    saturation = 0 if maximum == 0 else (maximum - minimum) / maximum
    if luminance >= WHITE_LUMINANCE_THRESHOLD and saturation <= WHITE_SATURATION_THRESHOLD:
        return "#ffffff"
    return f"#{red:02x}{green:02x}{blue:02x}"


def outside_rounded_square(x: int, y: int, width: int, height: int) -> bool:
    """Return whether a coordinate is outside the icon's rounded corners."""
    radius = min(width, height) * CORNER_RADIUS_RATIO
    nearest_x = min(max(x + 0.5, radius), width - radius)
    nearest_y = min(max(y + 0.5, radius), height - radius)
    return (x + 0.5 - nearest_x) ** 2 + (y + 0.5 - nearest_y) ** 2 > radius**2


def trim_transparent_edges(pixels: list[list[str | None]]) -> list[list[str | None]]:
    """Remove outer rows and columns containing only transparent pixels."""
    while pixels and all(pixel is None for pixel in pixels[0]):
        pixels.pop(0)
    while pixels and all(pixel is None for pixel in pixels[-1]):
        pixels.pop()
    while pixels and all(row[0] is None for row in pixels):
        pixels = [row[1:] for row in pixels]
    while pixels and all(row[-1] is None for row in pixels):
        pixels = [row[:-1] for row in pixels]
    return pixels


def save_preview(pixels: list[list[str | None]], path: Path) -> None:
    """Save a preview of the quantized logo."""
    width = len(pixels[0])
    height = len(pixels)
    preview = Image.new("RGBA", (width, height))
    preview.putdata([hex_to_rgba(pixel) for row in pixels for pixel in row])
    preview.resize((width * 10, height * 10), Image.Resampling.NEAREST).save(path)


def hex_to_rgba(color: str | None) -> tuple[int, int, int, int]:
    """Convert an optional hex color to RGBA."""
    if color is None:
        return 0, 0, 0, 0
    return int(color[1:3], 16), int(color[3:5], 16), int(color[5:7], 16), 255


def print_matrix(pixels: list[list[str | None]]) -> None:
    """Print a Python literal for the branding module."""
    print("LOGO_PIXELS: list[list[str | None]] = [")
    for row in pixels:
        print(f"    {row},")
    print("]")


if __name__ == "__main__":
    main()
