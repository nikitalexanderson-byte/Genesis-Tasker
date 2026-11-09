import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {verifyAdvicePairing} from '../scripts/verify-daily-advice.mjs';
import {advicePsychopompiaAllowed,advicePsychopompiaPreferences,adviceNotificationSafe} from '../app/advice-age-access.ts';
const json=async path=>JSON.parse(await readFile(new URL(path,import.meta.url),'utf8'));
const sha=text=>createHash('sha256').update(text).digest('hex');

test('first Psychopompia release preserves source text, fourteen complete locales and sixteen individual illustrations',async()=>{
  const manifest=await json('../server/content/psychopompia-release-2026-11-01.json');
  const catalog=await json('../server/content/daily-advice.json');
  const items=catalog.items.filter(entry=>entry.contentVersion===manifest.contentVersion);
  assert.equal(manifest.items.length,16);assert.equal(items.length,16);assert.equal(manifest.locales.length,14);
  const images=new Set();const imageDigests=new Set();
  const ru=await json(`../server/content/daily-advice/${manifest.contentVersion}/ru.json`);
  const pairings=await json('../server/content/daily-advice-pairings.json');
  for(const reviewed of manifest.items){
    const item=items.find(value=>value.id===reviewed.id);assert.ok(item);
    assert.equal(item.status,'published');assert.equal(item.review.status,'cleared');assert.equal(item.requiresAdult,true);assert.equal(item.containsAlcohol,false);
    assert.equal(sha(item.body),reviewed.sourceBodySha256);assert.deepEqual(ru[item.id],{title:item.title,body:item.body});
    for(const patch of [{requiresAdult:false},{containsAlcohol:true},{subcategories:['intoxication']},{review:{status:'unreviewed'}}])assert.throws(()=>verifyAdvicePairing({...item,...patch},'ru',ru[item.id],pairings.entries[item.id]),/Unreviewed/,'Release pairing must bind all age/content classifications');
    assert.equal(sha((reviewed.displayOriginalHeading?item.title+reviewed.headingSeparator:'')+item.body),reviewed.sourceTextSha256,'Original spelling, punctuation and line breaks must remain exact');
    assert.match(item.image,/^\/advice-art\/psychopompia\/advice-[a-f0-9]{24}\.webp$/);
    const bytes=await readFile(new URL('../public'+item.image,import.meta.url));const metadata=await json('../public'+item.image+'.json');
    assert.equal(metadata.sha256,sha(bytes));assert.equal(metadata.sourceBodySha256,reviewed.sourceBodySha256);
    images.add(item.image);imageDigests.add(metadata.sha256);
  }
  assert.equal(images.size,16);assert.equal(imageDigests.size,16);
  for(const language of manifest.locales){const values=await json(`../server/content/daily-advice/${manifest.contentVersion}/${language}.json`);assert.equal(Object.keys(values).length,16);for(const item of items){assert.ok(values[item.id].title.trim());assert.ok(values[item.id].body.trim());}}
});

test('complete Psychopompia corpus has 181 source-bound images and fourteen complete immutable locales',async()=>{
  const manifests=await Promise.all(['2026-11-01','2026-11-02'].map(date=>json(`../server/content/psychopompia-release-${date}.json`)));
  const catalog=await json('../server/content/daily-advice.json');
  const artwork=await json('../server/content/psychopompia-artwork.json');
  const pairings=await json('../server/content/daily-advice-pairings.json');
  const items=catalog.items.filter(entry=>entry.categories.includes('psychopompia'));
  assert.equal(items.length,181);assert.equal(artwork.items.length,181);
  assert.equal(manifests[1].items.length,165);
  assert.deepEqual(manifests[1].locales,manifests[0].locales);
  assert.equal(manifests[1].sourceSha256,manifests[0].sourceSha256);
  const ids=new Set(),images=new Set(),digests=new Set(),numbers=new Set();
  for(const manifest of manifests){
    for(const language of manifest.locales){
      const values=await json(`../server/content/daily-advice/${manifest.contentVersion}/${language}.json`);
      assert.equal(Object.keys(values).length,manifest.items.length);
      for(const reviewed of manifest.items){
        const item=items.find(entry=>entry.id===reviewed.id);assert.ok(item);
        assert.equal(item.contentVersion,manifest.contentVersion);
        const content=values[item.id];assert.ok(content?.title.trim());assert.ok(content.body.trim());
        assert.doesNotMatch(content.title+content.body,/\ufffd|TRANSLATE_ME|PLACEHOLDER/);
        verifyAdvicePairing(item,language,content,pairings.entries[item.id]);
        if(language==='ru'){
          assert.equal(sha(item.body),reviewed.sourceBodySha256);
          assert.equal(sha((reviewed.displayOriginalHeading?item.title+reviewed.headingSeparator:'')+item.body),reviewed.sourceTextSha256);
          assert.deepEqual(content,{title:item.title,body:item.body});
          const art=artwork.items.find(entry=>entry.id===item.id);assert.ok(art);
          assert.equal(art.number,reviewed.number);assert.equal(art.image,item.image);
          assert.equal(art.sourceBodySha256,reviewed.sourceBodySha256);
          const metadata=await json('../public'+item.image+'.json');
          assert.equal(metadata.itemId,item.id);assert.equal(metadata.sourceBodySha256,reviewed.sourceBodySha256);
          assert.equal(metadata.sha256,sha(await readFile(new URL('../public'+item.image,import.meta.url))));
          ids.add(item.id);images.add(item.image);digests.add(metadata.sha256);numbers.add(reviewed.number);
          if(manifest.version===2){assert.equal(item.containsAlcohol,reviewed.containsAlcohol);assert.deepEqual(item.subcategories,reviewed.subcategories);}
        }
      }
    }
  }
  for(const values of [ids,images,digests,numbers])assert.equal(values.size,181);
  assert.deepEqual([...numbers].sort((a,b)=>a-b),Array.from({length:181},(_,i)=>i+1));
});

test('every released Psychopompia material respects adult, alcohol jurisdiction and notification restrictions',async()=>{
  const catalog=await json('../server/content/daily-advice.json');
  const items=catalog.items.filter(entry=>entry.categories.includes('psychopompia'));
  const adult=advicePsychopompiaPreferences({adultConfirmed:true});
  const wine=(countryCode,ageAtLeast)=>advicePsychopompiaPreferences({adultConfirmed:true,alcohol:{...adult.alcohol,consent:true,countryCode,ageAtLeast}});
  assert.equal(items.filter(item=>item.containsAlcohol).length,15);
  for(const item of items){
    const card={...item,psychopompiaPublished:true};
    assert.equal(item.requiresAdult,true);assert.equal(item.review.status,'cleared');
    assert.equal(advicePsychopompiaAllowed(card,advicePsychopompiaPreferences(),['psychopompia']),false);
    assert.equal(advicePsychopompiaAllowed(card,adult,[]),false);
    assert.equal(advicePsychopompiaAllowed(card,adult,['psychopompia']),!item.containsAlcohol);
    assert.equal(advicePsychopompiaAllowed(card,wine('US',18),['psychopompia']),!item.containsAlcohol);
    assert.equal(advicePsychopompiaAllowed(card,wine('US',21),['psychopompia']),true);
    assert.equal(advicePsychopompiaAllowed(card,wine('ZZ',21),['psychopompia']),!item.containsAlcohol);
    assert.equal(adviceNotificationSafe(card),false);
  }
});
