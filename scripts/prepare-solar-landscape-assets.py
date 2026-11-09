"""Encode and inspect landscape plates while preserving their composition and alpha."""
import argparse
import hashlib
import json
from pathlib import Path
from statistics import median

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / 'public' / 'solar-landscapes-v1'
REPORT = ROOT / 'docs' / 'assets' / 'solar-landscapes-v1.json'
INCOMING = (ROOT / 'output' / 'artwork' / 'incoming').resolve()
REGIONS = ('temperate', 'boreal', 'mediterranean', 'arid', 'tropical', 'southern')


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def prepare(source, key):
    parts = key.split('/')
    assert len(parts) == 2 or (len(parts) == 3 and parts[0] == 'snow-cover')
    region, name = parts[-2:]
    variant = 'snow-cover' if len(parts) == 3 else 'base'
    assert region in REGIONS and name in [f'{month:02}.webp' for month in range(1, 13)]
    source = Path(source).resolve()
    assert source.is_relative_to(INCOMING), 'Place source plates in output/artwork/incoming'
    image = Image.open(source)
    assert image.mode == 'RGBA', 'A genuine alpha terrain plate is required'
    width, height = image.size
    assert width >= 2048 and 2.7 <= width / height <= 3.1, 'A full-width panoramic plate is required'
    alpha = image.getchannel('A')
    assert alpha.getextrema()[0] == 0, 'The sky must contain transparent pixels'
    upper = alpha.crop((int(width * .3), int(height * .05), int(width * .7), int(height * .35)))
    assert sum(upper.histogram()[128:]) / (upper.width * upper.height) < .02, 'Central sky is not transparent'
    bottom = alpha.crop((0, int(height * .96), width, height))
    assert sum(bottom.histogram()[220:]) / (bottom.width * bottom.height) > .94, 'The terrain must fill the bottom edge'
    crossings = []
    for x in range(int(width * .35), int(width * .65), 8):
        crossing = next((y for y in range(height) if alpha.getpixel((x, y)) >= 128), height)
        crossings.append(crossing / height)
    horizon = round(median(crossings), 4)
    assert .38 <= horizon <= .84, f'Unexpected terrain horizon: {horizon}'
    target = ASSETS / key
    target.parent.mkdir(parents=True, exist_ok=True)
    source_hash = digest(source)
    report = json.loads(REPORT.read_text(encoding='utf8')) if REPORT.exists() else {
        'encoding': 'WebP quality 84, alpha quality 100; no crop, resize, recolour or composition changes',
        'entries': [],
    }
    previous = next((entry for entry in report['entries'] if entry['key'] == key), None)
    assert not previous or previous['sourceSha256'] == source_hash, 'Use a new version rather than overwrite approved art'
    assert not target.exists() or previous, 'Existing art without its source record must not be overwritten'
    image.save(target, 'WEBP', quality=84, alpha_quality=100, method=6, exact=True)
    encoded = Image.open(target)
    assert encoded.mode == 'RGBA' and encoded.getchannel('A').tobytes() == alpha.tobytes(), 'Encoding changed alpha'
    entry = {'key': key, 'variant': variant, 'region': region, 'month': int(name[:2]), 'file': f'solar-landscapes-v1/{key}',
             'width': width, 'height': height, 'horizonY': horizon, 'bytes': target.stat().st_size,
             'sha256': digest(target), 'sourceSha256': source_hash, 'alphaExtrema': list(alpha.getextrema())}
    report['entries'] = sorted([row for row in report['entries'] if row['key'] != key] + [entry], key=lambda row: row['key'])
    report['count'] = len(report['entries'])
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    manifest_path = ASSETS / 'manifest.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf8')) if manifest_path.exists() else {
        'version': 1, 'entries': {}, 'snowCoverEntries': {},
    }
    # A source report can cover only the current import; retain every approved plate.
    plate = {field: entry[field] for field in ('width', 'height', 'horizonY')}
    if variant == 'base':
        manifest['entries'][key] = plate
    else:
        manifest.setdefault('snowCoverEntries', {})[key.removeprefix('snow-cover/')] = {**plate, 'path': key}
    revision = hashlib.sha256()
    files = sorted([*manifest['entries'], *(row['path'] for row in manifest['snowCoverEntries'].values())])
    for file in files:
        revision.update(file.encode('utf8'))
        revision.update((ASSETS / file).read_bytes())
    manifest['assetRevision'] = revision.hexdigest()
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    print(json.dumps({field: entry[field] for field in ('key', 'bytes', 'horizonY', 'alphaExtrema')}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source')
    parser.add_argument('--key')
    parser.add_argument('--batch-file')
    arguments = parser.parse_args()
    if arguments.batch_file:
        assert not arguments.source and not arguments.key
        for record in json.loads(Path(arguments.batch_file).read_text(encoding='utf8')):
            prepare(record['path'], record['key'])
    else:
        assert arguments.source and arguments.key
        prepare(arguments.source, arguments.key)
