"""Apply a complete, source-reviewed multilingual editorial batch without touching source cells.

The input contains sourceIds plus one equally sized phrase array for every supported
language. Original cells remain in the editorial ledger for import reproducibility.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
LANGUAGES = ('ru', 'en', 'el', 'de', 'fr', 'es', 'it', 'pt', 'pl', 'sr', 'uk', 'zh', 'tr', 'ja')


def read(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def write(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('batch', type=Path)
    args = parser.parse_args()
    batch = read(args.batch)
    ids = batch['sourceIds']
    assert ids and len(ids) == len(set(ids))
    assert set(batch) == {'sourceIds', *LANGUAGES}
    assert all(len(batch[language]) == len(ids) for language in LANGUAGES)
    corpus_path = ROOT / 'server/content/philosopher-aphorisms.json'
    editorial_path = ROOT / 'server/content/philosopher-aphorisms-editorial.json'
    manifest_path = ROOT / 'server/content/philosopher-aphorisms-provenance.json'
    corpus, editorial, manifest = read(corpus_path), read(editorial_path), read(manifest_path)
    entries = {item['sourceId']: item for item in corpus['items']}
    assert set(ids) <= set(entries)
    version = corpus['translationVersion']
    locales = {language: read(ROOT / f'server/content/philosopher-aphorisms-locales/{version}/{language}.json') for language in LANGUAGES}
    corrections = {(item['sourceId'], item['language']): item for item in editorial['corrections']}
    for index, source_id in enumerate(ids):
        entry = entries[source_id]
        for language in LANGUAGES:
            phrase = batch[language][index]
            assert isinstance(phrase, str) and 20 < len(phrase) < 5000 and phrase == phrase.strip()
            assert not re.search(r'[()\[\]{}\n\ufffd]', phrase), f'Editorial scaffolding in {source_id}/{language}'
            row = locales[language][entry['id']]
            previous = row['body']
            signature = previous.rsplit('\n', 1)[-1]
            body = phrase + '\n' + signature
            correction = corrections.get((source_id, language))
            if correction:
                assert previous == correction['body'], 'Existing correction drift'
                correction['body'] = body
            else:
                correction = {'sourceId': source_id, 'language': language, 'sourceBody': previous, 'body': body}
                editorial['corrections'].append(correction)
            correction.update({'style': 'contextual-paraphrase', 'reason': 'User-requested complete contextual paraphrase based on the recorded source; author attribution and source identity preserved.'})
            row['body'] = body
            if language == 'ru':
                entry['body'] = body
    natural_ids = {item['sourceId'] for item in editorial['corrections'] if item.get('style') == 'contextual-paraphrase'}
    manifest['editorialCorrectionsSha256'] = hashlib.sha256(json.dumps(editorial, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()
    manifest['editorialCorrectionCount'] = len(editorial['corrections'])
    manifest['contextualParaphraseCount'] = len(natural_ids)
    manifest['editorialContext'] = 'Context is supplied by editorial introductions or reviewed contextual paraphrases; these additions are not verbatim words of the ancient author.'
    # All records and locales are validated before any output file is replaced.
    for language, locale in locales.items():
        write(ROOT / f'server/content/philosopher-aphorisms-locales/{version}/{language}.json', locale)
    write(corpus_path, corpus)
    write(editorial_path, editorial)
    write(manifest_path, manifest)
    print(json.dumps({'contextualParaphrases': len(natural_ids), 'records': len(entries), 'languageVersions': len(natural_ids) * len(LANGUAGES)}))


if __name__ == '__main__':
    main()
