"""Fill missing public UI copy using the existing editorial translation helper.

Explicit maintenance command, never a runtime/build dependency. Existing reviewed
translations are preserved. Only source-code UI catalogs leave the workstation.
Resume drafts in ignored output/i18n; review generated copy before release.
"""
from concurrent.futures import ThreadPoolExecutor
import importlib.util
import json
from pathlib import Path
import re
import time
import argparse

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('localizer', ROOT / 'scripts/localize-catalogs.py')
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)
helper.PROVIDER = 'anylang'
provider_translate = helper.google_translate
def reliable_translate(*args, **kwargs):
    for attempt in range(4):
        try: return provider_translate(*args, **kwargs)
        except (RuntimeError, TimeoutError):
            if attempt == 3: raise
            time.sleep(3 * 2 ** attempt)
helper.google_translate = reliable_translate
read = lambda p: json.loads(p.read_text(encoding='utf-8'))
def decode(s):
    return json.loads('"' + s.replace('\\$', '$') + '"')

def sources():
    native = (ROOT / 'android/app/src/main/java/ru/genesis/calendar/ui/GenesisI18n.kt').read_text(encoding='utf-8')
    pairs = re.findall(r'"((?:\\.|[^"\\])*)"\s+to\s*(?:\r?\n\s*)?"((?:\\.|[^"\\])*)"', native)
    result = {decode(k): decode(v) for k,v in pairs if re.search('[А-Яа-яЁё]',k) and '$' not in k}
    result.update(read(ROOT / 'app/translations.en.json'))
    result.update(read(ROOT / 'app/ui-translations/en.json'))
    result.update(read(ROOT / 'app/curated-translations.en.json'))
    return result

def catalog_files(language):
    return [f'{language}.a', f'{language}.b'] if language in ('el','sr','uk') else [language, f'{language}.b'] if language in ('de','fr','ja') else [language]

def translate(language, seed):
    files = catalog_files(language)
    current = {}
    for name in files: current.update(read(ROOT / f'app/translations.{name}.json'))
    current.update(read(ROOT / f'app/ui-translations/{language}.json'))
    missing = [(k,v) for k,v in seed.items() if not current.get(k)]
    path = ROOT / f'output/i18n/ui-{language}.json'
    path.parent.mkdir(parents=True, exist_ok=True)
    cache = read(path) if path.exists() else {}
    todo = [(k,v) for k,v in missing if not cache.get(k)]
    for batch in helper.batches(todo, 1800):
        try: helper.translate_batch(batch, language, cache)
        except ValueError:
            for key,value in batch: helper.translate_entry(key,value,language,cache)
        for key,value in batch:
            if not cache.get(key): helper.translate_entry(key,value,language,cache)
        path.write_text(json.dumps(cache,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    target = ROOT / f'app/ui-translations/{language}.json'
    catalog = read(target)
    for key,_ in missing:
        value = cache[key]
        if not value.strip() or re.search(r'〔\d+〕|⟦\d+⟧|ZXQ',value): raise ValueError(f'Invalid copy: {language}: {key}')
        catalog[key] = value
    target.write_text(json.dumps(catalog,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(f'{language}: filled {len(missing)} UI entries',flush=True)

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--english-missing', type=Path)
    args = parser.parse_args()
    if args.english_missing:
        path = ROOT / 'app/ui-translations/en.json'
        base = read(path)
        cache_path = ROOT / 'output/i18n/ui-english-extra.json'
        cache = read(cache_path) if cache_path.exists() else {}
        for line in args.english_missing.read_text(encoding='utf-8').splitlines():
            if '\t' not in line: continue
            key = line.split('\t',1)[1]
            if key in base: continue
            if key not in cache: cache[key] = helper.google_translate(key,'en','ru')
            base[key] = cache[key]
            cache_path.write_text(json.dumps(cache,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        path.write_text(json.dumps(base,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    seed = sources()
    path = ROOT / 'app/ui-translations/en.json'
    base = read(path)
    core = read(ROOT / "app/translations.en.json")
    core.update(read(ROOT / "app/curated-translations.en.json"))
    for k,v in seed.items():
        if k not in base and k not in core: base[k] = v
    base = {k: v for k, v in base.items() if core.get(k) != v}
    path.write_text(json.dumps(base,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(lambda lang: translate(lang,seed), ['el','de','fr','es','it','pt','pl','sr','uk','zh','tr','ja']))
