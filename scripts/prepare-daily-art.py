from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image


TARGET_WIDTH = 1672
TARGET_HEIGHT = 940


def crop_to_ratio(image: Image.Image) -> Image.Image:
    source_ratio = image.width / image.height
    target_ratio = TARGET_WIDTH / TARGET_HEIGHT
    if source_ratio > target_ratio:
        crop_width = round(image.height * target_ratio)
        left = (image.width - crop_width) // 2
        return image.crop((left, 0, left + crop_width, image.height))
    crop_height = round(image.width / target_ratio)
    top = (image.height - crop_height) // 2
    return image.crop((0, top, image.width, top + crop_height))


def main() -> None:
    parser = argparse.ArgumentParser(description="Prepare a generated GENESIS daily hero image.")
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    with Image.open(args.input) as source:
        image = crop_to_ratio(source.convert("RGB"))
        if image.size != (TARGET_WIDTH, TARGET_HEIGHT):
            image = image.resize((TARGET_WIDTH, TARGET_HEIGHT), Image.Resampling.LANCZOS)

        args.output.parent.mkdir(parents=True, exist_ok=True)
        image.save(args.output, "WEBP", quality=86, method=6)


if __name__ == "__main__":
    main()
