"""Import and verify individual advice illustrations without publishing draft content."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "server/content/psychopompia-artwork.json"


def read(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")


def sha(value):
    return hashlib.sha256(value).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    init = sub.add_parser("init")
    init.add_argument("--index", type=Path, required=True)
    add = sub.add_parser("add")
    add.add_argument("--imports", type=Path, required=True)
    verify = sub.add_parser("verify")
    verify.add_argument("--complete", action="store_true")
    args = parser.parse_args()
    if args.command == "init":
        assert not MANIFEST.exists(), "Do not replace an existing manifest"
        source = read(args.index)
        entries = []
        for item in source["items"]:
            image = "/advice-art/psychopompia/" + item["id"] + ".webp"
            target = ROOT / "public" / image.lstrip("/")
            entries.append({"number": item["number"], "id": item["id"],
                "sourceBodySha256": sha(item["bodyRu"].encode("utf-8")),
                "image": image if target.exists() else None})
        write(MANIFEST, {"version": 1, "sourceSha256": source["sourceSha256"], "items": entries})
    manifest = read(MANIFEST)
    assert manifest["version"] == 1
    entries = {item["id"]: item for item in manifest["items"]}
    assert len(entries) == len(manifest["items"])
    if args.command == "add":
        for task in read(args.imports):
            entry = entries[task["id"]]
            if entry["image"]:
                continue
            image = "/advice-art/psychopompia/" + entry["id"] + ".webp"
            target = ROOT / "public" / image.lstrip("/")
            assert not target.exists(), "Never overwrite existing artwork"
            target.parent.mkdir(parents=True, exist_ok=True)
            with Image.open(task["path"]) as source:
                ImageOps.fit(source.convert("RGB"), (1200, 675), method=Image.Resampling.LANCZOS).save(target, "WEBP", quality=84, method=6)
            write(Path(str(target) + ".json"), {
                "createdAt": datetime.now(timezone.utc).isoformat(),
                "itemId": entry["id"], "sourceBodySha256": entry["sourceBodySha256"],
                "sha256": sha(target.read_bytes())})
            entry["image"] = image
            write(MANIFEST, manifest)
    hashes = set()
    for entry in manifest["items"]:
        if not entry["image"]:
            continue
        assert entry["image"] == "/advice-art/psychopompia/" + entry["id"] + ".webp"
        target = ROOT / "public" / entry["image"].lstrip("/")
        metadata = read(Path(str(target) + ".json"))
        digest = sha(target.read_bytes())
        assert digest == metadata["sha256"] and digest not in hashes, "Changed or reused artwork"
        hashes.add(digest)
        assert metadata["itemId"] == entry["id"] and metadata["sourceBodySha256"] == entry["sourceBodySha256"]
        with Image.open(target) as image:
            assert image.size == (1200, 675) and image.format == "WEBP"
            image.verify()
    if args.command == "verify" and args.complete:
        assert len(hashes) == len(entries), "Some advice still lacks individual artwork"
    print(json.dumps({"ready": len(hashes), "total": len(entries), "remaining": len(entries) - len(hashes)}))


if __name__ == "__main__":
    main()
