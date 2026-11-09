"""Import a read-only, bounded Google Sheets snapshot. No network credentials or Sheet writes.

Input contains texts-<first-row>.json / sources-<first-row>.json from authenticated
get_spreadsheet_range reads, plus metadata.json, composition.json and file-before/after.json.
Source cells are preserved byte-for-byte, with separately recorded, source-checked editorial corrections.
"""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
LANGUAGES = ('ru','en','el','de','fr','es','it','pt','pl','sr','uk','zh','tr','ja')
EXPECTED = {'seneca':365,'marcus':365,'epictetus':365,'aristotle':365,'epicurus':76,'socrates':114,
            'plato':101,'heraclitus':105,'pythagorean':58,'democritus':204,'diogenes':119,'plutarch':365}
SHEET = '1pX1knzjMvpMnl7_81-MZmNx0u6j48l9jXmlDBWkk-pA'
VERSION = 'philosophers-2026-11-v1'

def load(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))

def canonical(value):
    return json.dumps(value, ensure_ascii=False, separators=(',',':')).encode('utf-8')

def chunks(folder, prefix, tab, columns):
    rows = []
    cursor = 2
    for path in sorted(folder.glob(prefix+'-*.json'), key=lambda p:int(p.stem.split('-')[-1])):
        part = load(path)
        match = re.fullmatch("'"+tab+"'!A([0-9]+):"+columns+"([0-9]+)",part['range'])
        assert match and int(match[1])==cursor, 'Missing/overlapping snapshot rows: '+path.name
        values = part['values']
        assert len(values)==int(match[2])-cursor+1, 'Truncated snapshot: '+path.name
        rows.extend(values)
        cursor = int(match[2])+1
    assert cursor==2604 and len(rows)==2602, 'Expected the accepted 2602 rows'
    return rows

def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('snapshot',type=Path)
    parser.add_argument('--check',action='store_true',help='Verify committed output matches the snapshot without writing')
    args=parser.parse_args();folder=args.snapshot
    metadata=load(folder/'metadata.json');before=load(folder/'file-before.json');after=load(folder/'file-after.json')
    assert metadata['spreadsheetId']==SHEET and before['id']==after['id']==SHEET
    assert before['modified_time']==after['modified_time'], 'Sheet changed during import; fetch a fresh snapshot'
    texts=chunks(folder,'texts','Коллекция','P');sources=chunks(folder,'sources','Источники','J')
    source_by_id={row[0]:row for row in sources}
    assert len(source_by_id)==len(sources)==2602 and set(source_by_id)=={row[0] for row in texts}
    assert len({row[0] for row in texts})==2602 and Counter(row[1] for row in sources)==Counter(EXPECTED)
    assert all(len(row)==16 and all(isinstance(text,str) and text.strip() for text in row) for row in texts)
    assert all(len(row)==10 and all(isinstance(text,str) for text in row) for row in sources)
    assert all(0<len(text)<=24000 and '\ufffd' not in text for row in texts for text in row[2:])
    headers=load(folder/'text-sentinel.json')['values'][0]
    assert [title.rsplit(' · ',1)[-1] for title in headers[2:]]==list(LANGUAGES)
    labels=load(ROOT/'app/advice-collections-copy.json')
    base=[];locales={language:{} for language in LANGUAGES};provenance={};mapping={}
    for row in texts:
        source_id=row[0];source=source_by_id[source_id]
        identifier='advice-'+hashlib.sha256(('genesis:philosophers:'+SHEET+':'+source_id).encode()).hexdigest()[:24]
        assert identifier not in mapping
        mapping[identifier]=source_id
        assert source[4].startswith('https://'), 'Invalid source URL'
        references=[{'kind':'quote','author':row[2].rsplit('\n',1)[-1], 'work':source[2], 'reference':source[3], 'url':source[4]}]
        base.append({'id':identifier,'sourceId':source_id,'categories':[],'language':'ru','body':row[2],
                     'title':labels['ru']['philosophers'],'sources':references,'translationVersion':VERSION,
                     'editorialContext':True})
        for index,language in enumerate(LANGUAGES):
            text=row[index+2]
            assert '\n' in text and text.rsplit('\n',1)[-1].strip(), 'Missing author signature'
            locales[language][identifier]={'title':labels[language]['philosophers'],'body':text,
                'sources':[{**references[0],'author':text.rsplit('\n',1)[-1]}]}
        provenance[identifier]={'sourceId':source_id,'authorCode':source[1],'authorLabel':row[1],'work':source[2],'location':source[3],'url':source[4],
            'originalEnglish':source[5],'attribution':source[6],'sourceStatus':source[7],'rightsStatus':source[8],'editorialNote':source[9]}
    editorial=load(ROOT/'server/content/philosopher-aphorisms-editorial.json')
    assert editorial['schemaVersion']==1 and editorial['translationVersion']==VERSION
    corrections=set()
    for correction in editorial['corrections']:
        identifier=next(key for key,value in mapping.items() if value==correction['sourceId'])
        language=correction['language'];pair=(identifier,language)
        assert language in LANGUAGES and pair not in corrections
        corrections.add(pair)
        assert locales[language][identifier]['body']==correction['sourceBody'], 'Editorial correction no longer matches the source'
        assert correction['body'].rsplit('\n',1)[-1]==correction['sourceBody'].rsplit('\n',1)[-1], 'Editorial correction changed attribution'
        locales[language][identifier]['body']=correction['body']
        if language=='ru': next(entry for entry in base if entry['id']==identifier)['body']=correction['body']
    corpus={'version':1,'translationVersion':VERSION,'items':base}
    manifest={'version':1,'sourceSpreadsheet':metadata['spreadsheetUrl'],'sourceModifiedAt':before['modified_time'],
        'sourceTab':'Коллекция','sourceRange':'A2:P2603','sourcesTab':'Источники','sourcesRange':'A2:J2603',
        'recordCount':2602,'languageVersions':2602*14,'languages':list(LANGUAGES),'authors':EXPECTED,
        'sourceRowsSha256':hashlib.sha256(canonical(texts)).hexdigest(),'sourceMetadataSha256':hashlib.sha256(canonical(sources)).hexdigest(),
        'editorialCorrectionsSha256':hashlib.sha256(canonical(editorial)).hexdigest(),'editorialCorrectionCount':len(corrections),
        'contextualParaphraseCount':len({item['sourceId'] for item in editorial['corrections'] if item.get('style')=='contextual-paraphrase'}),
        'editorialContext':'Context is supplied by editorial introductions or reviewed contextual paraphrases; these additions are not verbatim words of the ancient author.',
        'rightsReviewPendingCount':sum('1915' in row[8] for row in sources),'rows':provenance}
    output={ROOT/'server/content/philosopher-aphorisms.json':corpus, ROOT/'server/content/philosopher-aphorisms-provenance.json':manifest}
    output.update({ROOT/'server/content/philosopher-aphorisms-locales'/VERSION/(language+'.json'):values for language,values in locales.items()})
    for path,data in output.items():
        if args.check: assert load(path)==data, 'Generated output differs: '+str(path.relative_to(ROOT))
        else: write(path,data)
    print(json.dumps({'records':2602,'authors':EXPECTED,'languages':list(LANGUAGES),'languageVersions':36428,'mode':'checked' if args.check else 'imported'},ensure_ascii=True))

if __name__=='__main__': main()
