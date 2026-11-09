"""Extract previews and encode generated movement atlases; never changes poses.

Usage: python scripts/build-physis-exercise-assets.py output/human-exercise-assets-state.json [--merge]
Requires Pillow. The private source manifest stays in ignored output/.
"""
import json
import re
import sys
from pathlib import Path
from PIL import Image, ImageOps

root = Path(__file__).resolve().parents[1]
state = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
destination = root / 'public/physis-art/exercises'
destination.mkdir(parents=True, exist_ok=True)
media_path = root / 'app/physis/exercise-media-data.json'
media = json.loads(media_path.read_text(encoding='utf-8')) if '--merge' in sys.argv[2:] else {}
for entry in state['specs']:
    if not entry.get('source'):
        continue
    exercise_id = entry['id']
    if not re.fullmatch(r'[a-z][a-z0-9-]*', exercise_id):
        raise ValueError('Invalid exercise id')
    image = Image.open(entry['source']).convert('RGB')
    if entry.get('rowSources'):
        # Pack generated pose rows literally; do not redraw, morph or change poses.
        rows = [Image.open(source).convert('RGB') for source in entry['rowSources']]
        if len(rows) != 2 or any(row.height != rows[0].height for row in rows):
            raise ValueError('Invalid pose rows: ' + exercise_id)
        stops = entry['columnStops']
        if len(stops) != 4 or stops[0] != 0 or any(stops[-1] != row.width for row in rows):
            raise ValueError('Invalid row columns: ' + exercise_id)
        cell_width = max(stops[i + 1] - stops[i] for i in range(3))
        image = Image.new('RGB', (cell_width * 3, rows[0].height * 2), rows[0].getpixel((5, 5)))
        for person, row in enumerate(rows):
            for frame_index in range(3):
                tile = row.crop((stops[frame_index] + 4, 0, stops[frame_index + 1] - 4, row.height))
                image.paste(tile, (frame_index * cell_width + (cell_width - tile.width) // 2, person * row.height))
    width, height = image.size
    split = state['splits'].get(exercise_id, height // 2)
    if entry.get('rowSources'):
        split = height // 2
    frames = entry.get('frames', 3)
    version = entry.get('version', 1)
    if frames not in (2, 3) or not isinstance(version, int) or version < 1:
        raise ValueError('Invalid atlas frame count or version: ' + exercise_id)
    if width % frames or not 0 < split < height:
        raise ValueError('Invalid atlas geometry: ' + exercise_id)
    image.save(destination / f'{exercise_id}-human-v{version}.webp', 'WEBP', quality=80, method=6)
    poster = Image.new('RGB', (640, 360), image.getpixel((5, 5)))
    # A literal frame extraction, with padding rather than clipped heads or feet.
    for person, (top, bottom) in enumerate([(0, split), (split, height)]):
        frame = image.crop((width // frames + 3, top + 3, 2 * width // frames - 3, bottom - 3))
        preview = ImageOps.contain(frame, (320, 352), Image.Resampling.LANCZOS)
        poster.paste(preview, (person * 320 + (320 - preview.width) // 2, (360 - preview.height) // 2))
    poster.save(destination / f'{exercise_id}-poster-human-v{version}.webp', 'WEBP', quality=78, method=6)
    media[exercise_id] = {'src': f'/physis-art/exercises/{exercise_id}-human-v{version}.webp', 'poster': f'/physis-art/exercises/{exercise_id}-poster-human-v{version}.webp', 'split': split, 'width': width, 'height': height}
    if frames != 3:
        media[exercise_id]['frames'] = frames
media_path.write_text(json.dumps(media, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(f'Encoded {len(media)} atlases and {len(media)} previews.')
