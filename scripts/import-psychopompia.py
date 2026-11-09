"""Import a source-bound release without replacing previously published advice or translations."""
import argparse
import hashlib
import json
from pathlib import Path


def read(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def digest(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def write(path, value):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--preparation", required=True, type=Path)
    parser.add_argument("--artwork", required=True, type=Path)
    parser.add_argument("--release", required=True, type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    release, prepared, artwork = read(args.release), read(args.preparation), read(args.artwork)
    candidates = {entry["id"]: entry for entry in prepared["items"]}
    locales = release["locales"]
    assert len(locales) == 14 and len(set(locales)) == 14
    assert release["reviewedBy"] == "root-content-review" and release["items"]
    assert release["version"] in (1, 2)
    assert len({entry["id"] for entry in release["items"]}) == len(release["items"])
    if "items" in artwork:
        assert artwork["sourceSha256"] == release["sourceSha256"]
        artwork_images = {entry["id"]: entry["image"] for entry in artwork["items"]}
    else:
        artwork_images = artwork["images"]
    catalog_path = root / "server/content/daily-advice.json"
    catalog = read(catalog_path)
    pairings_path = root / "server/content/daily-advice-pairings.json"
    pairings = read(pairings_path)
    existing = {entry["id"]: entry for entry in catalog["items"]}
    locale_output = {language: {} for language in locales}
    ui_titles = read(root / "app/advice-psychopompia-copy.json")
    for reviewed in release["items"]:
        item = candidates[reviewed["id"]]
        original = item["original"]
        assert item["source"]["sourceSha256"] == release["sourceSha256"]
        assert digest(original["text"]) == reviewed["sourceTextSha256"]
        assert digest(original["body"]) == reviewed["sourceBodySha256"]
        assert item["number"] == reviewed["number"]
        assert original["displayHeading"] == reviewed["displayOriginalHeading"]
        assert original["headingSeparator"] == reviewed["headingSeparator"]
        if release["version"] == 1:
            assert item["containsAlcohol"] is False  # The immutable first release has no alcohol practices.
            contains_alcohol = False
        else:
            contains_alcohol = reviewed["containsAlcohol"]
            assert isinstance(contains_alcohol, bool)
            assert not item["containsAlcohol"] or contains_alcohol, "Never weaken an alcohol restriction"
            assert contains_alcohol == item["containsAlcohol"] or reviewed.get("classificationReason", "").strip()
            assert reviewed["subcategories"] == item["subcategories"]
        image = artwork_images[item["id"]]
        assert image == "/advice-art/psychopompia/" + item["id"] + ".webp"
        image_path = root / "public" / image.lstrip("/")
        metadata = read(str(image_path) + ".json")
        assert metadata["sourceBodySha256"] == reviewed["sourceBodySha256"]
        assert metadata["sha256"] == hashlib.sha256(image_path.read_bytes()).hexdigest()
        for language in locales:
            translated = item["translations"][language]
            assert translated["body"].strip()
            if language != "ru":
                assert translated["status"] == "translated-draft"
                assert translated["sourceTextSha256"] == reviewed["sourceTextSha256"]
                assert digest((translated["title"] or "") + translated["headingSeparator"] + translated["body"]) == translated["textSha256"]
            title = translated["title"] or ui_titles[language]["title"]
            locale_output[language][item["id"]] = {"title": title, "body": translated["body"]}
        assert locale_output["ru"][item["id"]]["body"] == original["body"]
        entry = {
            "id": item["id"], "categories": ["psychopompia"],
            **locale_output["ru"][item["id"]], "language": "ru", "sources": [],
            "contentVersion": release["contentVersion"], "image": image, "topics": [],
            "status": "published", "requiresAdult": True, "containsAlcohol": contains_alcohol,
            "subcategories": item["subcategories"], "review": {"status": "cleared"},
        }
        if item["id"] in existing:
            assert existing[item["id"]] == entry, "Never replace an immutable published version"
        else:
            catalog["items"].append(entry)
        pairing = {"category": "psychopompia", "sourceNumber": reviewed["number"], "contentVersion": release["contentVersion"], "title": entry["title"], "locales": {}}
        for language in locales:
            content = locale_output[language][item["id"]]
            payload = [item["id"], entry["contentVersion"], entry["categories"], image, language, content["title"], content["body"], True, contains_alcohol, entry["subcategories"], "cleared"]
            pairing["locales"][language] = digest(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
        if item["id"] in pairings["entries"]:
            assert pairings["entries"][item["id"]] == pairing, "Published pairing reviews are immutable"
        pairings["entries"][item["id"]] = pairing
    for language, values in locale_output.items():
        target = root / "server/content/daily-advice" / release["contentVersion"] / f"{language}.json"
        assert not target.exists() or read(target) == values, "Published translations are immutable"
        write(target, values)
    write(catalog_path, catalog)
    write(pairings_path, pairings)
    print(json.dumps({"published": len(release["items"]), "locales": len(locales), "sourceTextUnchanged": True}))


if __name__ == "__main__":
    main()
