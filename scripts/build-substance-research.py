"""Build authored reference notes, without inferring medical claims from keywords.

The source TSV/JSON files are reviewed summaries, not automatic translations or
scraped articles. The fetch corpus stays out of Git. Run from the repository root.
"""
import csv,json,pathlib
ROOT=pathlib.Path(__file__).resolve().parents[1]
S=ROOT/'scripts'
OUT=ROOT/'app/physis/substance-research-data'
OUT.mkdir(exist_ok=True)
notes={}
DATE='2026-11-02'
MACROS={
    '@pregnancy':'Безопасность дополнительного приёма при беременности и лактации не установлена; данные обычного пищевого потребления не заменяют исследования добавки.',
    '@investigational':'Для самостоятельного применения клинический профиль безопасности и противопоказания не установлены; особенно недостаточны данные при беременности, лактации и у детей.',
    '@unknown':'Качественных исследований лекарственных взаимодействий недостаточно. Отсутствие описанного взаимодействия не подтверждает безопасность сочетания.',
}
def add(id,patch):
    old=notes.get(id,{})
    sources=list(dict.fromkeys([*old.get('sources',[]),*patch.get('sources',[])]))
    notes[id]={**old,**patch}
    if sources:notes[id]['sources']=sources
def table(name):
    with (S/name).open(encoding='utf8',newline='') as f:
        rows=list(csv.DictReader(f,delimiter='|'))
    for r in rows:
        assert None not in r and all(v is not None for v in r.values()),r
    assert len({r['id'] for r in rows})==len(rows),name
    return rows
def pharma_id(id):return 'pharma-PHY-'+str(int(id)).zfill(4)
for group in json.loads((S/'research-pharmacology-classes.json').read_text(encoding='utf8')).values():
    for id in group['ids']:add(pharma_id(id),{k:v for k,v in group.items() if k!='ids'})
for row in table('research-pharmacology.tsv'):
    add(pharma_id(row['id']),{('scopeNote' if k=='note' else k):MACROS.get(v,v) for k,v in row.items() if k!='id' and v})
for id,patch in json.loads((S/'research-pharmacology-specific.json').read_text(encoding='utf8')).items():add(pharma_id(id),patch)
for row in table('research-vitamins-minerals.tsv'):
    patch={k:v for k,v in row.items() if k not in ['id','ods'] and v}
    if row['ods']:patch['sources']=['https://ods.od.nih.gov/factsheets/'+row['ods']+'-HealthProfessional/']
    add(row['id'],patch)
for name in ['research-supplements.tsv','research-plants.tsv','research-legacy.tsv']:
    if (S/name).exists():
        for row in table(name):add(row['id'],{k:MACROS.get(v,v) for k,v in row.items() if k!='id' and v})
for id,urls in json.loads((S/'research-source-additions.json').read_text(encoding='utf8')).items():
    if id in notes:add(id,{'sources':urls})
for id,urls in json.loads((S/'research-supplement-sources.json').read_text(encoding='utf8')).items():
    if id in notes:add(id,{'sources':urls})
for id,patch in json.loads((S/'research-catalog-corrections.json').read_text(encoding='utf8')).items():
    assert id in notes,id
    add(id,patch)
# This policy concerns enforcement discretion, not marketing approval or evidence.
for id in [293,299,300,310,316]:
    add(pharma_id(id),{
        'status':'США: условная политика аптечного изготовления; это не одобрение лекарства FDA.',
        'scopeNote':'Вещество включено в политику HHS для аптечного изготовления 503A от 30.10.2026. Это не одобрение готового лекарства и не доказательство эффективности; другие страны и формы оцениваются отдельно. '+notes[pharma_id(id)].get('scopeNote',''),
        'sources':['https://www.govinfo.gov/content/pkg/FR-2026-10-30/html/2026-22192.htm','https://www.hhs.gov/sites/default/files/hhs-503a-peptide-enforcement-discretion-policy-appendix-b.pdf'],
    })
add(pharma_id(1217),{'nameRu':'Диметилбутиламин (DMBA)','nameEn':'1,3-Dimethylbutylamine; DMBA; AMP citrate'})
add(pharma_id(1222),{'status':'Лекарственное вещество: Emcitate имеет регистрацию EMA для периферического тиреотоксикоза при дефиците MCT8; показания других стран проверяются отдельно.'})
for id,name in json.loads((S/'research-name-corrections.json').read_text(encoding='utf8')).items():
    assert id in notes,id
    add(id,{'nameRu':name})
for id,patch in notes.items():
    patch['reviewedAt']=DATE
    patch['verification']='Справочная сводка по указанным источникам; ограничения доказательств приведены в карточке'
    assert not any(isinstance(v,str) and v.startswith('@') for v in patch.values()),id
# Keep individual modules comfortably below the application's JS chunk budget.
chunks=[];chunk={};size=0
for id,patch in sorted(notes.items()):
    n=len(json.dumps({id:patch},ensure_ascii=False).encode())
    if size+n>180000 and chunk:chunks.append(chunk);chunk={};size=0
    chunk[id]=patch;size+=n
if chunk:chunks.append(chunk)
# Remove only obsolete generated parts inside the exact output directory.
expected={f'part{i}.json' for i in range(1,len(chunks)+1)}
for old in OUT.glob('part*.json'):
    if old.stem[4:].isdigit() and old.name not in expected:
        assert old.resolve().parent==OUT.resolve()
        old.unlink()
def write_atomic(path,content):
    temporary=path.with_suffix(path.suffix+'.tmp')
    temporary.write_text(content,encoding='utf8')
    temporary.replace(path)
for i,chunk in enumerate(chunks,1):write_atomic(OUT/f'part{i}.json',json.dumps(chunk,ensure_ascii=False,indent=2)+'\n')
imports='\n'.join(f"import part{i} from './substance-research-data/part{i}.json';" for i in range(1,len(chunks)+1))
exports=', '.join('...part'+str(i) for i in range(1,len(chunks)+1))
write_atomic(ROOT/'app/physis/substance-research.ts','// Authored research overlay; rebuild with scripts/build-substance-research.py.\n'+imports+'\nexport const SUBSTANCE_RESEARCH = {'+exports+'};\n')
print(json.dumps({'notes':len(notes),'pharmacology':sum(id.startswith('pharma-') for id in notes),'modules':len(chunks)}))
