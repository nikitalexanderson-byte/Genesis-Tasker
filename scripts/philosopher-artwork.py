"""Plan, import and verify the GENESIS aphorism artwork catalog."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import errno
import hashlib
import json
from itertools import zip_longest
import os
from pathlib import Path
import tempfile
import time

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / 'server/content/philosopher-aphorisms.json'
MANIFEST = ROOT / 'server/content/philosopher-aphorisms-artwork.json'
def read(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    data = json.dumps(value, ensure_ascii=False, indent=2) + '\n'
    for attempt in range(6):
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', newline='\n', dir=path.parent, prefix='.' + path.name + '.', suffix='.tmp', delete=False) as stream:
                temporary = Path(stream.name)
                stream.write(data)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, path)
            return
        except OSError as error:
            if attempt == 5 or error.errno not in (errno.EACCES, errno.EPERM, errno.EINVAL):
                raise
            time.sleep(0.15 * (attempt + 1))
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    plan = sub.add_parser('plan')
    plan.add_argument('--out', type=Path, default=ROOT / 'output/artwork/philosopher-aphorisms-plan.json')
    add = sub.add_parser('add')
    add.add_argument('id')
    add.add_argument('input', type=Path)
    verify = sub.add_parser('verify')
    verify.add_argument('--complete', action='store_true')
    args = parser.parse_args()
    entries = {entry['id']: entry for entry in read(CATALOG)['items']}
    manifest = read(MANIFEST) if MANIFEST.exists() else {'version': 1, 'images': {}}
    assert manifest['version'] == 1 and set(manifest['images']) <= set(entries)
    if args.command == 'plan':
        provenance = read(ROOT / 'server/content/philosopher-aphorisms-provenance.json')['rows']
        groups = {}
        for key, entry in entries.items():
            if key not in manifest['images']:
                groups.setdefault(provenance[key]['authorCode'], []).append({'id': key, 'sourceId': entry['sourceId'], 'excerpt': entry['body']})
        queue = [entry for row in zip_longest(*groups.values()) for entry in row if entry is not None]
        write(args.out, queue)
        print(json.dumps({'total': len(entries), 'ready': len(manifest['images']), 'pending': len(queue), 'plan': str(args.out)}))
    elif args.command == 'add':
        assert args.id in entries, 'Unknown aphorism'
        assert args.id not in manifest['images'], 'Do not overwrite an existing illustration'
        image_path = '/advice-art/philosophers/' + args.id + '.webp'
        target = ROOT / 'public' / image_path.lstrip('/')
        assert not target.exists(), 'Do not overwrite an existing asset'
        target.parent.mkdir(parents=True, exist_ok=True)
        with Image.open(args.input) as source:
            image = ImageOps.fit(source.convert('RGB'), (1200, 675), method=Image.Resampling.LANCZOS)
            image.save(target, 'WEBP', quality=84, method=6)
        write(Path(str(target) + '.json'), {
            'createdAt': datetime.now(timezone.utc).isoformat(),
            'sourceId': entries[args.id]['sourceId'], 'sha256': hashlib.sha256(target.read_bytes()).hexdigest(),
        })
        manifest['images'][args.id] = image_path
        write(MANIFEST, manifest)
        print(json.dumps({'ready': len(manifest['images']), 'total': len(entries), 'image': image_path}))
    else:
        artwork_dir = ROOT / 'public/advice-art/philosophers'
        assert not any(path.suffix.lower() == '.png' for path in artwork_dir.rglob('*')), 'PNG originals must stay outside the public artwork directory'
        assert {path.stem for path in artwork_dir.glob('*.webp')} == set(manifest['images']), 'Every public WebP must be registered in the manifest'
        hashes = set()
        for key, path in manifest['images'].items():
            assert path == '/advice-art/philosophers/' + key + '.webp', 'Unstable image identity'
            target = ROOT / 'public' / path.lstrip('/')
            metadata = read(Path(str(target) + '.json'))
            digest = hashlib.sha256(target.read_bytes()).hexdigest()
            assert digest == metadata['sha256'] and digest not in hashes, 'Missing, changed or reused image'
            hashes.add(digest)
            assert metadata['sourceId'] == entries[key]['sourceId']
            with Image.open(target) as image:
                assert image.size == (1200, 675) and image.format == 'WEBP'
                image.verify()
        if args.complete:
            assert set(manifest['images']) == set(entries), 'Not every aphorism has its own image yet'
        print(json.dumps({'ready': len(hashes), 'total': len(entries), 'complete': len(hashes) == len(entries)}))


if __name__ == '__main__':
    main()
