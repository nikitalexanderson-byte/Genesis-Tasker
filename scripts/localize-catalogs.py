"""Prepare reviewed locale assets from the public English GENESIS catalogues.

This is an editorial helper, not a build step. The generated JSON is committed so
the website and offline Android app never depend on a translation service.
Run with --language XX; reruns resume from the ignored output/i18n cache.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import threading
import time
import unicodedata
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "app/catalog-translations"
CACHE_ROOT = ROOT / "output/i18n"
LANGUAGES = ("en", "el", "de", "fr", "es", "it", "pt", "pl", "sr", "uk", "zh", "tr", "ja")
LANGUAGE_NAMES = {"en": "English", "el": "Greek", "de": "German", "fr": "French",
    "es": "Spanish", "it": "Italian", "pt": "Portuguese", "pl": "Polish",
    "sr": "Serbian Cyrillic", "uk": "Ukrainian", "zh": "Simplified Chinese",
    "tr": "Turkish", "ja": "Japanese"}
PROVIDER = "google"
GREEK_RUN = re.compile(r"[\u0370-\u03ff\u1f00-\u1fff]+")
MARKER = re.compile(r"〔(\d{3})〕\s*[:：]?")
TERM = re.compile(r"⟦(\d{3})⟧")
GREEK_BASE = dict(zip(
    "αβγδεζηθικλμνξοπρσςτυφχψω",
    ("a", "b", "g", "d", "e", "z", "e", "th", "i", "k", "l", "m", "n", "x", "o", "p", "r", "s", "s", "t", "y", "ph", "ch", "ps", "o"),
))
GREEK_UK = dict(zip(
    "αβγδεζηθικλμνξοπρσςτυφχψω",
    ("а", "б", "г", "д", "е", "з", "е", "т", "і", "к", "л", "м", "н", "кс", "о", "п", "р", "с", "с", "т", "і", "ф", "х", "пс", "о"),
))
LETTERS = (
    ("Alpha", "Άλφα", "Альфа"), ("Beta", "Βήτα", "Бета"), ("Gamma", "Γάμμα", "Гамма"),
    ("Delta", "Δέλτα", "Дельта"), ("Epsilon", "Έψιλον", "Епсилон"), ("Zeta", "Ζήτα", "Дзета"),
    ("Eta", "Ήτα", "Ета"), ("Theta", "Θήτα", "Тета"), ("Iota", "Ιώτα", "Йота"),
    ("Kappa", "Κάππα", "Каппа"), ("Lambda", "Λάμδα", "Лямбда"), ("Mu", "Μι", "Мю"),
    ("Nu", "Νι", "Ню"), ("Xi", "Ξι", "Ксі"), ("Omicron", "Όμικρον", "Омікрон"),
    ("Pi", "Πι", "Пі"), ("Rho", "Ρο", "Ро"), ("Sigma", "Σίγμα", "Сигма"),
    ("Tau", "Ταυ", "Тау"), ("Upsilon", "Ύψιλον", "Іпсилон"), ("Phi", "Φι", "Фі"),
    ("Chi", "Χι", "Хі"), ("Psi", "Ψι", "Псі"), ("Omega", "Ωμέγα", "Омега"),
)
DEITIES = (
    ("Athena", "Αθηνά", "Афіна"), ("Artemis", "Άρτεμις", "Артеміда"),
    ("Hermes", "Ερμής", "Гермес"), ("Peitho", "Πειθώ", "Пейто"),
    ("Hephaestus", "Ήφαιστος", "Гефест"), ("Aglaea", "Αγλαΐα", "Аглая"),
    ("Ares", "Άρης", "Арес"), ("Aphrodite", "Αφροδίτη", "Афродіта"),
    ("Demeter", "Δήμητρα", "Деметра"), ("Poseidon", "Ποσειδώνας", "Посейдон"),
    ("Amphitrite", "Αμφιτρίτη", "Амфітріта"), ("Apollo", "Απόλλων", "Аполлон"),
    ("Zeus", "Δίας", "Зевс"), ("Hera", "Ήρα", "Гера"),
    ("Hades", "Άδης", "Аїд"), ("Persephone", "Περσεφόνη", "Персефона"),
    ("Hestia", "Εστία", "Гестія"), ("Dionysus", "Διόνυσος", "Діоніс"),
    ("Ariadne", "Αριάδνη", "Аріадна"), ("Aether", "Αιθήρ", "Ефір"),
    ("Hemera", "Ημέρα", "Гемера"), ("Eros", "Έρως", "Ерос"),
    ("Psyche", "Ψυχή", "Психея"),
)
TERMS = LETTERS + DEITIES + (
    ("Stoicheion", "Στοιχεῖον", "Стойхейон"),
    ("Theokyklos", "Θεόκυκλος", "Теокіклос"),
    ("Apeiron", "Ἄπειρον", "Апейрон"),
    ("Aletheia", "Ἀλήθεια", "Алетейя"),
    ("Monad", "Μονάς", "Монада"),
    ("Logos", "Λόγος", "Логос"),
    ("Pneuma", "Πνεῦμα", "Пневма"),
    ("Hysterema", "Ὑστέρημα", "Істерема"),
    ("Selene", "Σελήνη", "Селена"),
    ("Cronus", "Κρόνος", "Кронос"),
    ("Janus", "Ιανός", "Янус"),
    ("Homer", "Όμηρος", "Гомер"),
    ("Hesiod", "Ησίοδος", "Гесіод"),
    ("Pythagoras", "Πυθαγόρας", "Піфагор"),
    ("Areios", "Άρειος", "Арейос"),
    ("Zophos", "Ζόφος", "Зофос"),
)
TERM_PATTERN = re.compile(r"\b(?:" + "|".join(re.escape(row[0]) for row in sorted(TERMS, key=lambda row: -len(row[0]))) + r")\b", re.IGNORECASE)
TERM_MAP = {row[0].lower(): row for row in TERMS}
lock = threading.Lock()


def greek_transliteration(source: str, language: str) -> str:
    if language == "el" or len(source) == 1:
        return source
    decomposed = unicodedata.normalize("NFD", source)
    letters = GREEK_UK if language == "uk" else GREEK_BASE
    result = []
    rough = False
    for char in decomposed:
        if char == "\u0314":
            rough = True
        elif unicodedata.combining(char):
            continue
        else:
            part = letters.get(char.lower(), char)
            result.append(part.title() if char.isupper() else part)
    if rough and result:
        result.insert(0, "Г" if language == "uk" else "H")
    return "".join(result)


def protected(text: str, language: str) -> tuple[str, list[str]]:
    values: list[str] = []

    def protect(value: str) -> str:
        values.append(value)
        return f"⟦{len(values) - 1:03d}⟧"

    def greek(match: re.Match[str]) -> str:
        return protect(greek_transliteration(match.group(), language))

    text = GREEK_RUN.sub(greek, text)

    def named(match: re.Match[str]) -> str:
        name = TERM_MAP[match.group().lower()]
        return protect(name[1] if language == "el" else name[2] if language == "uk" else name[0])

    text = TERM_PATTERN.sub(named, text)
    return text, values


def restore(text: str, values: list[str]) -> str:
    seen = {int(match.group(1)) for match in TERM.finditer(text)}
    missing = set(range(len(values))) - seen
    if any(index >= len(values) for index in seen) or any(values[index] not in
            (values[present] for present in seen) for index in missing):
        raise ValueError(f"Sacred terms were lost: {seen} of {len(values)}")
    return TERM.sub(lambda match: values[int(match.group(1))], text)


def google_translate(text: str, language: str, source: str = "en") -> str:
    if language == source:
        return text
    if PROVIDER == "anylang":
        result = subprocess.run(["node", str(ROOT / "scripts/translate-anylang.cjs")],
            input=json.dumps({"text": text, "source": source, "language": language}),
            text=True, encoding="utf-8", capture_output=True, timeout=90)
        if result.returncode:
            raise RuntimeError(f"Translation helper failed: {result.stderr[:180]}")
        return json.loads(result.stdout)["translation"]
    query = urlencode({"client": "gtx", "sl": source, "tl": "zh-CN" if language == "zh" else language,
                       "dt": "t", "q": text})
    request = Request("https://translate.googleapis.com/translate_a/single?" + query,
                      headers={"User-Agent": "Mozilla/5.0"})
    for attempt in range(3):
        try:
            with urlopen(request, timeout=35) as response:
                chunks = json.load(response)[0]
            return "".join(chunk[0] or "" for chunk in chunks)
        except Exception:
            if attempt == 2:
                raise
            time.sleep(2 ** attempt)
    raise AssertionError("unreachable")


def load_source() -> tuple[dict, dict, str]:
    letters = json.loads((ROOT / "app/stoicheion.en.json").read_text(encoding="utf-8"))
    theokyklos = json.loads((ROOT / "android/app/src/main/assets/catalogs/theokyklos.json").read_text(encoding="utf-8"))
    digest = hashlib.sha256(json.dumps([letters, theokyklos], ensure_ascii=False, sort_keys=True).encode()).hexdigest()
    return letters, theokyklos, digest


def pairs_in(value: object) -> list[tuple[str, str]]:
    pairs: list[tuple[str, str]] = []
    if isinstance(value, dict):
        if isinstance(value.get("ru"), str) and isinstance(value.get("en"), str):
            pairs.append((value["ru"], value["en"]))
        for child in value.values():
            pairs.extend(pairs_in(child))
    elif isinstance(value, list):
        for child in value:
            pairs.extend(pairs_in(child))
    return pairs


def translate_batch(entries: list[tuple[str, str]], language: str, cache: dict[str, str]) -> None:
    prepared = [protected(text, language) for _, text in entries]
    payload = "\n".join(f"〔{index:03d}〕 {text}" for index, (text, _) in enumerate(prepared))
    translated = google_translate(payload, language)
    markers = list(MARKER.finditer(translated))
    if len(markers) != len(entries) or [int(m.group(1)) for m in markers] != list(range(len(entries))):
        raise ValueError("Translation service changed batch boundaries")
    for index, ((key, _), (_, values)) in enumerate(zip(entries, prepared)):
        end = markers[index + 1].start() if index + 1 < len(markers) else len(translated)
        content = translated[markers[index].end():end].strip()
        cache[key] = restore(content, values)


def translate_entry(key: str, text: str, language: str, cache: dict[str, str]) -> None:
    if key.startswith("stoicheion:") and key.endswith(":content"):
        if PROVIDER == "anylang" and language != "uk" and len(text) < 4500:
            try:
                translated = translate_piece(text, language)
                if len(translated.split("\n\n")) == len(text.split("\n\n")):
                    cache[key] = translated
                    return
            except ValueError:
                pass
        if language == "el":
            translated = google_translate(text, language).strip()
            if len(translated.split("\n\n")) != len(text.split("\n\n")):
                translated = "\n\n".join(google_translate(piece, language).strip()
                                           for piece in text.split("\n\n"))
            cache[key] = TERM_PATTERN.sub(lambda match: TERM_MAP[match.group().lower()][1], translated)
            return
        cache[key] = "\n\n".join(translate_piece(piece, language) for piece in text.split("\n\n"))
        return
    cache[key] = translate_piece(text, language)


def translate_piece(text: str, language: str) -> str:
    prepared, values = protected(text, language)
    try:
        return restore(google_translate(prepared, language).strip(), values)
    except ValueError:
        if len(text) < 120:
            raise
        parts = re.split(r"(\n|(?<=[.!?;:]) +)", text)
        if len(parts) > 1:
            return "".join(part if not part.strip() else translate_piece(part, language)
                for part in parts)
        middle = len(text) // 2
        split = text.find(" ", middle)
        if split < 0 or split == len(text) - 1:
            raise
        return translate_piece(text[:split], language) + " " + translate_piece(text[split + 1:], language)


def batches(entries: list[tuple[str, str]], max_length: int = 2500) -> list[list[tuple[str, str]]]:
    result: list[list[tuple[str, str]]] = []
    current: list[tuple[str, str]] = []
    length = 0
    for key, value in entries:
        if current and length + len(value) > max_length:
            result.append(current)
            current, length = [], 0
        current.append((key, value))
        length += len(value) + 14
    if current:
        result.append(current)
    return result


def year_source_pairs() -> dict[str, tuple[str, str]]:
    """The native copy() pairs plus the site's authored year-footer paragraphs."""
    native = (ROOT / "android/app/src/main/java/ru/genesis/calendar/ui/CalendarYearDescription.kt").read_text(encoding="utf-8")
    pair_pattern = re.compile(r'copy\(\s*"((?:[^"\\]|\\.)*)"\s*,\s*"((?:[^"\\]|\\.)*)"')
    pairs = {ru: (en, "en") for ru, en in pair_pattern.findall(native) if "$" not in ru}
    website = (ROOT / "app/GenesisCalendar.tsx").read_text(encoding="utf-8")
    start = website.index('className="year-description-card"')
    end = website.index("  const renderYear =", start)
    section = website[start:end]
    english = json.loads((ROOT / "app/translations.en.json").read_text(encoding="utf-8"))
    english_year = ROOT / "app/year-translations/en.json"
    if english_year.exists():
        english.update(json.loads(english_year.read_text(encoding="utf-8")))
    for match in re.finditer(r">([^<>{}]*[А-Яа-яЁё][^<>{}]*)<", section):
        russian = match.group(1).strip()
        if len(russian) >= 5 and russian not in pairs:
            pairs[russian] = (english.get(russian, russian), "en" if russian in english else "ru")
    profane = re.search(r'const yearDescription = mode === "profane"\s*\? "([^"]+)"', section)
    if profane:
        russian = profane.group(1)
        pairs[russian] = (english.get(russian, russian), "en" if russian in english else "ru")
    return pairs


def translate_year(language: str, cache: dict[str, str]) -> dict[str, str]:
    pairs = year_source_pairs()
    if PROVIDER == "anylang":
        pending = [("year:" + russian, source) for russian, (source, source_language) in pairs.items()
            if source_language == "en" and "year:" + russian not in cache]
        for batch in batches(pending, max_length=1800):
            try:
                translate_batch(batch, language, cache)
            except ValueError:
                for key, value in batch:
                    translate_entry(key, value, language, cache)
            (CACHE_ROOT / f"catalog-translation-cache-{language}.json").write_text(
                json.dumps({language: cache}, ensure_ascii=False), encoding="utf-8")
    for index, (russian, (source, source_language)) in enumerate(pairs.items()):
        key = "year:" + russian
        if key in cache:
            continue
        if source_language == "en":
            cache[key] = translate_piece(source, language)
        else:
            # The full civil-calendar essay exists only in the original Russian.
            translated = google_translate(source, language, "ru").strip()
            cache[key] = GREEK_RUN.sub(lambda match: greek_transliteration(match.group(), language), translated)
        cache_path = CACHE_ROOT / f"catalog-translation-cache-{language}.json"
        cache_path.write_text(json.dumps({language: cache}, ensure_ascii=False), encoding="utf-8")
        if index % 10 == 0:
            print(language, "year", index + 1, "/", len(pairs), flush=True)
    template_key = "year:lunar-start-template"
    if template_key not in cache:
        template = "The year begins on ⟦001⟧, the first exact new moon after the spring equinox, and includes ⟦002⟧ lunar months of 29 or 30 days."
        translated = google_translate(template, language)
        if "⟦001⟧" not in translated or "⟦002⟧" not in translated:
            raise ValueError(f"Lunar-year placeholders were lost in {language}")
        cache[template_key] = translated.replace("⟦001⟧", "{date}").replace("⟦002⟧", "{months}")
    return {russian: cache["year:" + russian] for russian in pairs} | {
        "__lunarStartTemplate": cache[template_key]}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--language", choices=LANGUAGES, required=True)
    parser.add_argument("--skip-year", action="store_true", help="Update the catalog without year-footer copy")
    parser.add_argument("--provider", choices=("google", "anylang"), default="google")
    args = parser.parse_args()
    global PROVIDER
    PROVIDER = args.provider
    language = args.language
    letters, theokyklos, source_hash = load_source()
    CACHE_ROOT.mkdir(parents=True, exist_ok=True)
    cache_path = CACHE_ROOT / f"catalog-translation-cache-{language}.json"
    cache_all = json.loads(cache_path.read_text(encoding="utf-8")) if cache_path.exists() else {}
    cache = cache_all.setdefault(language, {})
    pairs = dict(pairs_in(theokyklos))
    # Greek utterances are given by the authored Greek field, not translated from English.
    for segment in theokyklos["segments"]:
        for word in segment["words"]:
            ru = word["pronunciation"]["ru"]
            cache["theokyklos:" + ru] = (word["greek"] if language == "el" else
                greek_transliteration(word["greek"], language) if language == "uk" else
                word["pronunciation"]["en"])
    pending = [("theokyklos:" + ru, en) for ru, en in pairs.items() if "theokyklos:" + ru not in cache]
    for index, batch in enumerate(batches(pending)):
        try:
            translate_batch(batch, language, cache)
        except ValueError:
            for key, value in batch:
                translate_entry(key, value, language, cache)
        cache_all[language] = cache
        cache_path.write_text(json.dumps(cache_all, ensure_ascii=False), encoding="utf-8")
        print(language, "theokyklos", min(index + 1, len(batches(pending))), "/", len(batches(pending)), flush=True)
    for index, (letter_id, value) in enumerate(letters.items()):
        for field in ("name", "tagline", "content"):
            key = f"stoicheion:{letter_id}:{field}"
            if key not in cache:
                translate_entry(key, value[field], language, cache)
                cache_path.write_text(json.dumps(cache_all, ensure_ascii=False), encoding="utf-8")
        print(language, "stoicheion", index + 1, "/", len(letters), flush=True)
    output = {
        "sourceSha256": source_hash,
        "stoicheion": {letter_id: {field: cache[f"stoicheion:{letter_id}:{field}"]
                                   for field in ("name", "tagline", "content")}
                        for letter_id in letters},
        "theokyklos": {ru: cache["theokyklos:" + ru] for ru in pairs},
        "theokyklosWords": {word["greek"]: greek_transliteration(word["greek"], language)
                             for segment in theokyklos["segments"] for word in segment["words"]},
    }
    artwork = json.loads((ROOT / "android/app/src/main/assets/stoicheion-art.json").read_text(encoding="utf-8"))
    dictionaries: dict[str, str] = {}
    for path in (ROOT / "app").glob(f"translations.{language}*.json"):
        dictionaries.update(json.loads(path.read_text(encoding="utf-8")))
    output["stoicheionArt"] = {
        letter_id: {
            "body": dictionaries[item["body"]],
            "bodyGreek": greek_transliteration(item["bodyGreek"], language),
            "invocation": greek_transliteration(item["invocation"], language),
        }
        for letter_id, item in artwork.items()
    }
    OUT.mkdir(exist_ok=True)
    (OUT / f"{language}.json").write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if args.skip_year:
        print(language, "catalog complete", len(output["stoicheion"]), len(output["theokyklos"]), flush=True)
        return
    year = translate_year(language, cache)
    cache_path.write_text(json.dumps(cache_all, ensure_ascii=False), encoding="utf-8")
    year_root = ROOT / "app/year-translations"
    year_root.mkdir(exist_ok=True)
    (year_root / f"{language}.json").write_text(json.dumps(year, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(language, "complete", len(output["stoicheion"]), len(output["theokyklos"]), flush=True)


if __name__ == "__main__":
    main()
