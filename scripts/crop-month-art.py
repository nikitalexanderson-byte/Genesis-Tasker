from pathlib import Path

from PIL import Image


SOURCE = Path("public/month-frieze-v2.png")
OUTPUT_DIRECTORY = Path("public/month-art-v3")
MONTH_COUNT = 13


def main() -> None:
    OUTPUT_DIRECTORY.mkdir(parents=True, exist_ok=True)
    source = Image.open(SOURCE).convert("RGB")

    for index in range(MONTH_COUNT):
        panel_left = round(index * source.width / MONTH_COUNT)
        panel_right = round((index + 1) * source.width / MONTH_COUNT)
        panel_width = panel_right - panel_left
        inset = max(2, round(panel_width * 0.025))
        crop = source.crop((panel_left + inset, 0, panel_right - inset, source.height))
        crop.save(
            OUTPUT_DIRECTORY / f"month-{index + 1:02d}.webp",
            "WEBP",
            quality=90,
            method=6,
        )

    print(f"Created {MONTH_COUNT} isolated month artworks from {SOURCE.name}.")


if __name__ == "__main__":
    main()
