import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {philosopherQuoteParts} from '../app/philosopher-quote.ts';
const load=async path=>JSON.parse(await readFile(new URL('../'+path,import.meta.url),'utf8'));

test('philosopher presentation separates context and author, preserving punctuation and paragraph breaks',()=>{
  assert.deepEqual(philosopherQuoteParts('(О дружбе (из письма)) «Дружба — благо».\nВторая строка.\nЭпикур','Эпикур'),
    {context:'О дружбе из письма',quote:'«Дружба — благо».\nВторая строка.',author:'Эпикур'});
  assert.deepEqual(philosopherQuoteParts('（論友誼）言葉。\n（エピクロス）','エピクロス'),
    {context:'論友誼',quote:'言葉。',author:'エピクロス'});
  assert.deepEqual(philosopherQuoteParts('Без вводного контекста.\nПлатон','Платон'),
    {context:'',quote:'Без вводного контекста.',author:'Платон'});
  assert.equal(philosopherQuoteParts('Цитата.\nДругой автор','Платон').quote,'Цитата.\nДругой автор');
  assert.equal(philosopherQuoteParts('(Неоконченная вводная.','').quote,'(Неоконченная вводная.');
});

test('all 36,428 localized aphorisms have readable context and one separate author',async()=>{
  const corpus=await load('server/content/philosopher-aphorisms.json');
  const manifest=await load('server/content/philosopher-aphorisms-provenance.json');
  let count=0;
  for(const language of manifest.languages){
    const locale=await load(`server/content/philosopher-aphorisms-locales/${corpus.translationVersion}/${language}.json`);
    for(const entry of corpus.items){
      const source=locale[entry.id];const parts=philosopherQuoteParts(source.body,source.sources[0].author);
      assert.ok(parts.quote.trim(),`${entry.id}:${language}`);
      assert.doesNotMatch(parts.context,/[()（）]/);
      assert.doesNotMatch(parts.quote,/^[（(]/,`${entry.id}:${language}`);
      assert.equal(parts.author,source.sources[0].author);
      assert.notEqual(parts.quote.split('\n').at(-1),parts.author);
      const withoutCredit=source.body.trim().split(/\r?\n/).slice(0,-1).join('\n').trim();
      assert.ok(withoutCredit.endsWith(parts.quote),'Quotation was rewritten');count++;
    }
  }
  assert.equal(count,36428);
});
test('Google Sheets aphorisms preserve all accepted records, author counts and every localized cell',async()=>{
  const corpus=await load('server/content/philosopher-aphorisms.json');
  const manifest=await load('server/content/philosopher-aphorisms-provenance.json');
  const editorial=await load('server/content/philosopher-aphorisms-editorial.json');
  assert.equal(editorial.translationVersion,corpus.translationVersion);
  assert.equal(createHash('sha256').update(JSON.stringify(editorial)).digest('hex'),manifest.editorialCorrectionsSha256);
  const corrections=new Map(editorial.corrections.map(row=>[`${row.sourceId}:${row.language}`,row]));
  assert.equal(corrections.size,editorial.corrections.length);assert.equal(corrections.size,manifest.editorialCorrectionCount);
  assert.equal(corpus.items.length,2602);assert.equal(manifest.recordCount,2602);assert.equal(manifest.languageVersions,36428);
  assert.equal(manifest.rightsReviewPendingCount,103);assert.ok(!('translations' in manifest));
  const locales=await Promise.all(manifest.languages.map(language=>load(`server/content/philosopher-aphorisms-locales/${corpus.translationVersion}/${language}.json`)));
  const counts={};const rows=[];const ids=new Set();
  for(const entry of corpus.items){
    assert.match(entry.id,/^advice-[a-f0-9]{24}$/);assert.ok(!ids.has(entry.id));ids.add(entry.id);
    const source=manifest.rows[entry.id];assert.equal(source.sourceId,entry.sourceId);
    counts[source.authorCode]=(counts[source.authorCode]??0)+1;
    assert.equal(entry.id,'advice-'+createHash('sha256').update('genesis:philosophers:1pX1knzjMvpMnl7_81-MZmNx0u6j48l9jXmlDBWkk-pA:'+source.sourceId).digest('hex').slice(0,24));
    assert.deepEqual(entry.categories,[]);assert.ok(!('translationStatus' in entry));assert.equal(entry.editorialContext,true);
    const texts=locales.map((locale,index)=>{const text=locale[entry.id];const correction=corrections.get(`${entry.sourceId}:${manifest.languages[index]}`);
      if(correction?.style==='contextual-paraphrase')assert.doesNotMatch(text.body.slice(0,text.body.lastIndexOf('\n')),/[()[\]{}]/);
      else assert.ok(text.body.startsWith('('));assert.ok(!text.body.includes('\uFFFD'));
      assert.ok(text.body.length<24000);const signature=text.body.split('\n').at(-1);assert.ok(signature.trim());assert.equal(text.sources[0].author,signature);
      assert.equal(text.sources[0].url,source.url);return text.body;});
    assert.equal(entry.body,texts[0]);
    const originalTexts=texts.map((body,index)=>{
      const correction=corrections.get(`${entry.sourceId}:${manifest.languages[index]}`);
      if(!correction)return body;
      assert.equal(body,correction.body);assert.equal(body.split('\n').at(-1),correction.sourceBody.split('\n').at(-1));
      assert.notEqual(correction.body,correction.sourceBody);corrections.delete(`${entry.sourceId}:${manifest.languages[index]}`);
      return correction.sourceBody;
    });
    rows.push([entry.sourceId,source.authorLabel,...originalTexts]);
  }
  assert.deepEqual(counts,manifest.authors);
  assert.equal(new Set(editorial.corrections.filter(item=>item.style==='contextual-paraphrase').map(item=>item.sourceId)).size,manifest.contextualParaphraseCount);
  assert.equal(corrections.size,0,'Unknown or unused editorial correction');
  assert.equal(createHash('sha256').update(JSON.stringify(rows)).digest('hex'),manifest.sourceRowsSha256,'Import changed a source cell');
  for(const locale of locales)assert.deepEqual(new Set(Object.keys(locale)),ids);
});

test('individual aphorism artwork keeps its quote identity, provenance and unique optimized asset', async () => {
  const corpus = await load('server/content/philosopher-aphorisms.json');
  const manifest = await load('server/content/philosopher-aphorisms-artwork.json');
  assert.equal(manifest.version, 1);
  assert.ok(Object.keys(manifest.images).length > 0);
  const entries = new Map(corpus.items.map(entry => [entry.id, entry]));
  const hashes = new Set();
  for (const [id, path] of Object.entries(manifest.images)) {
    assert.ok(entries.has(id), 'Artwork belongs to an unknown aphorism');
    assert.equal(path, `/advice-art/philosophers/${id}.webp`);
    const bytes = await readFile(new URL(`../public${path}`, import.meta.url));
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
    assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
    const metadata = await load(`public${path}.json`);
    const hash = createHash('sha256').update(bytes).digest('hex');
    assert.equal(hash, metadata.sha256);
    assert.ok(!hashes.has(hash), 'A background was reused for another aphorism');
    hashes.add(hash);
    assert.equal(metadata.sourceId, entries.get(id).sourceId);
    assert.ok(Number.isFinite(Date.parse(metadata.createdAt)));
  }
});
