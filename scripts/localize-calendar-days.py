"""Prepare offline translations of the public sacred calendar corpus.

Uses the existing editorial provider and an ignored resumable draft cache.
Preserves authored Greek names; runtime clients never call a translator.
"""
from concurrent.futures import ThreadPoolExecutor
import importlib.util
import json
from pathlib import Path
import re
import unicodedata

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('helper', ROOT / 'scripts/localize-catalogs.py')
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)
read = lambda p: json.loads(p.read_text(encoding='utf-8'))
source = read(ROOT / 'app/calendar-days.en.json')
native_source = (ROOT / 'android/app/src/main/java/ru/genesis/calendar/domain/SacredCatalog.kt').read_text(encoding='utf-8')
native_names = [json.loads('"'+m+'"') for m in re.findall(r'SacredDay\(\d+,\s*"((?:\\.|[^"\\])*)"',native_source)]
assert len(native_names) == len(source)
languages = ('el','de','fr','es','it','pt','pl','sr','uk','zh','tr','ja')

# Names are phonetic transcriptions from the existing English and Russian corpus.
# Digraphs retain their Greek meaning instead of becoming translated nouns.
GREEK_DIGRAPHS = {'ph':'φ','th':'θ','ch':'χ','ps':'ψ','ks':'ξ','dz':'ζ',
                  'ou':'ου','ai':'αι','ei':'ει','oi':'οι','au':'αυ','eu':'ευ'}
GREEK_LETTERS = dict(zip('abcdefghijklmnopqrstuvwxyz',
    ('α','β','κ','δ','ε','φ','γ','η','ι','ι','κ','λ','μ','ν','ο','π','κ','ρ','σ','τ','υ','β','ω','ξ','υ','ζ')))
CYRILLIC_DIGRAPHS = {'ph':'ф','th':'т','ch':'х','ps':'пс','ks':'кс','dz':'дз',
                    'ou':'у','ai':'ај','ei':'еј','oi':'ој','au':'ау','eu':'еу'}
CYRILLIC_LETTERS = dict(zip('abcdefghijklmnopqrstuvwxyz',
    ('а','б','к','д','е','ф','г','х','и','ј','к','л','м','н','о','п','к','р','с','т','у','в','в','кс','и','з')))

def authored_name(text, language):
    if language not in ('el','sr','uk'): return text
    digraphs = GREEK_DIGRAPHS if language == 'el' else CYRILLIC_DIGRAPHS
    letters = GREEK_LETTERS if language == 'el' else CYRILLIC_LETTERS
    def word(m):
        el_roots = {'areios':'Άρειος','antesis':'Άνθησις','psitiros':'Ψίθυρος','aigle':'Αίγλη',
                    'kauma':'Καύμα','karpos':'Καρπός','trige':'Τρύγη','katodos':'Κάθοδος',
                    'agrotera':'Αγροτέρα','peras':'Πέρας','lailaps':'Λαίλαψ','zofos':'Ζόφος',
                    'apeiron':'Άπειρον','nyuks':'Νυξ','fanes':'Φάνης','khaos':'Χάος'}
        sr_names = {'athena':'Атина','artemis':'Артемида','hermes':'Хермес','peitho':'Пеито',
                    'hephaestus':'Хефест','aglaea':'Аглаја','ares':'Арес','aphrodite':'Афродита',
                    'demeter':'Деметра','poseidon':'Посејдон','amphitrite':'Амфитрита','apollo':'Аполон',
                    'zeus':'Зевс','hera':'Хера','hades':'Хад','persephone':'Персефона','hestia':'Хестија',
                    'dionysus':'Дионис','ariadne':'Аријадна','aether':'Етар','hemera':'Хемера',
                    'eros':'Ерос','psyche':'Психа','theokyklos':'Теокиклос','stoicheion':'Стоихејон',
                    'pneuma':'Пнеума','homer':'Хомер','hesiod':'Хесиод','pythagoras':'Питагора'}
        overrides = el_roots if language == 'el' else sr_names if language == 'sr' else {}
        if m.group().lower() in overrides: return overrides[m.group().lower()]
        s = m.group().lower(); result = ''; i = 0
        if language == 'el': s = s.replace('pnev','pneu')
        while i < len(s):
            pair = s[i:i+2]
            if pair in digraphs: result += digraphs[pair]; i += 2
            else: result += letters.get(s[i], s[i]); i += 1
        if language == 'uk': result = result.replace('и','і').replace('ј','й')
        if language == 'el' and result.endswith('σ'): result = result[:-1]+'ς'
        return result[0].upper()+result[1:] if m.group()[0].isupper() else result
    return re.sub(r'[A-Za-z]+', word, text)

def protect(text, language):
    # Extend the existing glossary with every authored day-name word.
    words = {name for row in source for name in row['name'].split(' (',1)[0].split()}
    values = []; names = {w.lower(): w for w in words}
    pattern = re.compile(r'\b(?:'+'|'.join(re.escape(w) for w in sorted(words,key=len,reverse=True))+r')\b',re.I)
    def named(m):
        values.append(authored_name(names[m.group().lower()], language))
        return f'⟦{len(values)-1:03d}⟧'
    text = pattern.sub(named,text)
    for en,el,uk in helper.TERMS:
        if language in ('el','sr','uk'): continue
        replacement = el if language == 'el' else uk if language == 'uk' else authored_name(en,language) if language == 'sr' else en
        def term(m, replacement=replacement):
            values.append(replacement); return f'⟦{len(values)-1:03d}⟧'
        text = re.sub(r'\b'+re.escape(en)+r'\b',term,text,flags=re.I)
    return text, values

def localize(language):
    path = ROOT / f'output/i18n/calendar-days-{language}.json'
    path.parent.mkdir(parents=True,exist_ok=True)
    cache = read(path) if path.exists() else {}
    entries = []
    for i,row in enumerate(source):
        ru_name = native_names[i]
        ru_root = ru_name.split(' ',1)[0]
        gloss = ru_name.split(' (',1)[1].removesuffix(')')
        if gloss.startswith(ru_root+' '): gloss = gloss[len(ru_root)+1:]
        entries.append((f'{i}:gloss-ru',gloss.lower()))
    entries += [(f'{i}:description-v2',row['description']) for i,row in enumerate(source)]
    todo = [(k,v) for k,v in entries if not cache.get(k)]
    batches = [batch for is_gloss in (True,False) for batch in helper.batches([(k,v) for k,v in todo if (':gloss-ru' in k)==is_gloss],3300)]
    for n,batch in enumerate(batches):
        source_language = 'ru' if ':gloss-ru' in batch[0][0] else 'en'
        prepared = [(v,[]) if source_language=='ru' else protect(v,language) for _,v in batch]
        prepared = [(re.sub(r'⟦(\d{3})⟧',r'ZXQTERM\1',v),terms) for v,terms in prepared]
        payload = '\n'.join(f'〔{i:03d}〕 {v}' for i,(v,_) in enumerate(prepared))
        translated = helper.google_translate(payload, language,source_language)
        markers = list(helper.MARKER.finditer(translated))
        if len(markers)!=len(batch) or [int(m.group(1)) for m in markers] != list(range(len(batch))):
            raise ValueError(f'Changed calendar batch boundaries: {language}/{n}')
        for i,((key,_),(_,terms)) in enumerate(zip(batch,prepared)):
            end = markers[i+1].start() if i+1<len(markers) else len(translated)
            content = translated[markers[i].end():end].strip()
            def restore(value):
                return helper.restore(re.sub(r'ZXQTERM\s*(\d{3})',r'⟦\1⟧',value),terms)
            try: value = restore(content)
            except ValueError:
                # Some provider batches drop a repeated glossary token. Retry the
                # affected public sentence independently, retaining the same terms.
                piece = helper.google_translate(prepared[i][0],language,source_language)
                try: value = restore(piece.strip())
                except ValueError as error: raise ValueError(f'{language}/{key}: {prepared[i][0]} => {piece}') from error
            if not value or re.search(r'〔\d+〕|⟦\d+⟧',value):
                value = restore(helper.google_translate(prepared[i][0],language,source_language).strip())
            if not value: raise ValueError(f'Empty translation {language}/{key}: {batch[i][1]}')
            cache[key] = unicodedata.normalize('NFC',value)
        path.write_text(json.dumps(cache,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        print(f'{language}: {len(cache)}/{len(entries)}',flush=True)
    rows = []
    for i,row in enumerate(source):
        stem = row['name'].split(' (',1)[0]
        root = stem.split(' ',1)[0]
        rows.append({'name':f'{authored_name(stem,language)} ({authored_name(root,language)} {cache[f"{i}:gloss-ru"]})',
                     'description':cache[f'{i}:description-v2']})
    rooting = {'el':'ριζωτής','de':'verwurzelnd','fr':'qui enracine','es':'que arraiga',
               'it':'che radica','pt':'que enraíza','pl':'zakorzeniający','sr':'укорењујући',
               'uk':'той, хто укорінює','zh':'扎根者','tr':'kök saldıran','ja':'根を張る者'}
    stem = source[0]['name'].split(' (',1)[0]
    rows[0]['name'] = f'{authored_name(stem,language)} ({authored_name(stem.split()[0],language)} {rooting[language]})'
    if language == 'uk':
        for index, text in {
            358:'Очисне багаття року, у якому згорає все, що не має перейти в новий цикл.',
            361:'Пошанування сакральної темряви, матері всього сущого, яка зберігає в собі насіння майбутнього.',
            362:'Занурення у щільну порожнечу, де кується сутність нового Космосу.',
            363:'Усвідомлення первісних глибин буття, на яких тримається світ.',
            364:'Пробудження великої сили тяжіння, завдяки якій Хаос набуває форми Порядку.',
        }.items(): rows[index]['description'] = text
    (ROOT / f'app/calendar-days.{language}.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

if __name__ == '__main__':
    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(localize,languages))
