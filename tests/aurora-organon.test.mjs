import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarModule} from './helpers/calendar-modules.mjs';
const words=calendarModule('app/aurora/catalog/lexicon.ts'),organon=calendarModule('app/aurora/organon.ts');
const {CURATOR_IDS,DEITIES}=calendarModule('app/aurora/registry.ts'),greek=calendarModule('app/aurora/greek.ts');
const {SPHRAGISES}=calendarModule('app/aurora/catalog/sphragises.ts'),sphragis=calendarModule('app/aurora/sphragis.ts');
const {ACTIONS,ACTION_STRATEGIES}=calendarModule('app/aurora/catalog/actions.ts');
const {PROFILE_STATES}=calendarModule('app/aurora/catalog/profiles.ts');
const prefs={goalTags:['clarity'],qualityTags:['clarity'],valueTags:[],barrierTags:[],lastFiveCanonicalForms:[],excludedCanonicalForms:[],preferShort:false,avoidedLetters:[]};
test('Catalog has 144 distinct attested headwords, 26 exact prepared forms and thirteen fixed fallbacks',()=>{
 words.validateLexicalCatalog();assert.equal(words.LEXICON.length,144);assert.equal(words.RITUAL_FORMS.length,26);assert.equal(words.FALLBACK_NAMES.length,13);
 for(const entry of words.LEXICON){assert.ok(entry.dictionaryMeaning&&entry.sourceRefs[0].startsWith('https://www.logeion.org/'));assert.equal(greek.isopsephy(entry.displayForm),entry.isopsephy);}
 for(const entry of words.RITUAL_FORMS){assert.equal(entry.dictionaryMeaning,null);assert.equal(entry.isopsephy,DEITIES[entry.curatorIds[0]].sum);}
});
test('All thirteen deterministic organons have exact integer sum; difficulty selects a different exact form',()=>{
 for(const id of CURATOR_IDS){const chosen=organon.selectOrganon(id,prefs);assert.equal(chosen.entry.isopsephy,DEITIES[id].sum);assert.ok(chosen.entry.canonicalForm.length<=13);assert.deepEqual(chosen,organon.selectOrganon(id,prefs));
  const alternate=organon.selectOrganon(id,{...prefs,excludedCanonicalForms:[chosen.entry.canonicalForm],preferShort:true});assert.notEqual(alternate.entry.canonicalForm,chosen.entry.canonicalForm);assert.equal(alternate.entry.isopsephy,DEITIES[id].sum);}
 assert.equal(organon.selectOrganon('athena',prefs).entry.canonicalForm,'ΑΚΜΗ');
});
test('Bounded generation is deterministic, phonetic, exact and always respects operation/candidate limits',()=>{
 const a=organon.generateOrganonCandidates('athena',prefs),b=organon.generateOrganonCandidates('athena',prefs);assert.deepEqual(a,b);
 assert.ok(a.states<=100000&&a.entries.length<=256&&a.entries.length>0);
 for(const entry of a.entries){assert.equal(greek.isopsephy(entry.canonicalForm),69);assert.equal(entry.kind,'ritual_form');assert.equal(entry.dictionaryMeaning,null);assert.ok(entry.pronunciation);}
 assert.equal(organon.weightedJaccard([],[]),0);
 const evenPalindromes=a.entries.filter(e=>e.canonicalForm===[...e.canonicalForm].reverse().join('')&&e.canonicalForm.length%2===0);assert.equal(evenPalindromes.length,0);
});
test('All 24 accessible sphragises exist and a low-sum organon cannot acquire rho or tau',()=>{
 assert.equal(SPHRAGISES.length,24);for(const s of SPHRAGISES)assert.ok(s.seated&&s.gesture&&s.withoutHands&&s.visual);
 const chosen=sphragis.chooseSphragis('ΑΚΜΗ',['clarity'],'without_hands');assert.ok('ΑΚΜΗ'.includes(chosen.letter));
 assert.throws(()=>sphragis.chooseSphragis('ΑΚΜΗ',[],'visual','Ρ'),/NOT_IN_WORD/);assert.throws(()=>sphragis.chooseSphragis('ΑΚΜΗ',[],'visual','Τ'),/NOT_IN_WORD/);
 for(const minutes of [1,3,5])for(const comfort of ['gesture','without_hands','visual','mental']){const ritual=sphragis.ritualInstructions(minutes,'ΑΚΜΗ','Проверить одно основание.',chosen,comfort,true).join(' ');assert.doesNotMatch(ritual,/задержите дыхание|через боль|гипервентиляц/i);assert.match(ritual,/обычных выдохах/);}
});

test('Musical, Fibonacci and tetractys design scores are bounded; generation avoids repeated sounds for every curator',()=>{
 const {wordHarmony,openSyllables,phoneme,TETRACTYS_WEIGHTS,rhythmicPatterns}=calendarModule('app/aurora/organon-harmony.ts');
 assert.deepEqual(TETRACTYS_WEIGHTS,[1,2,3,4]);
 assert.deepEqual([...new Set(rhythmicPatterns().map(p=>p.length))].sort((a,b)=>a-b),[4,5,6,8,10,12,13]);
  assert.ok(wordHarmony('ΓΛΕΛΑ').golden>wordHarmony('ΒΑΒΑΒΑ').golden);
  assert.ok(organon.phoneticDiversityScore('ΚΡΑΚΡΕ')>organon.phoneticDiversityScore('ΚΡΑΚΡΑ'));
  assert.ok(Number.isFinite(organon.phoneticDiversityScore('ΑΕ')));
 for(const id of CURATOR_IDS){
  const generated=organon.generateOrganonCandidates(id,prefs);
  assert.ok(generated.entries.length>10,id);assert.ok(generated.states<=organon.SEARCH_LIMITS.states);
  assert.ok(new Set(generated.entries.map(e=>phoneme(e.canonicalForm[0]))).size>=3,id);
  for(const entry of generated.entries){
   const syllables=openSyllables(entry.canonicalForm),sounds=syllables.map(s=>[...s].map(phoneme).join(''));
   assert.equal(syllables.join(''),entry.canonicalForm);assert.equal(new Set(sounds).size,sounds.length);
   assert.equal(greek.isopsephy(entry.canonicalForm),DEITIES[id].sum);
   const h=wordHarmony(entry.canonicalForm);
   for(const key of ['articulation','rhythm','music','golden','fibonacci','arc','total'])assert.ok(Number.isFinite(h[key])&&h[key]>=0&&h[key]<=1,key);
   assert.ok(Math.abs(h.total-(h.articulation+2*h.rhythm+3*h.music+4*(h.golden+h.fibonacci+h.arc)/3)/10)<1e-12);
  }
  const chosen=organon.selectOrganon(id,prefs,true),next=organon.selectOrganon(id,{...prefs,lastFiveCanonicalForms:[chosen.entry.canonicalForm],excludedCanonicalForms:[chosen.entry.canonicalForm]},true);
  assert.notEqual(next.entry.canonicalForm,chosen.entry.canonicalForm);assert.equal(next.entry.isopsephy,DEITIES[id].sum);
 }
});
test('312 distinct base operations cover 13×4×3×2 and time variants do not inflate the count',()=>{
 assert.equal(ACTIONS.length,312);assert.equal(new Set(ACTIONS.map(a=>a.title)).size,312);assert.equal(new Set(ACTIONS.map(a=>a.instructions[0])).size,312);
 for(const id of CURATOR_IDS)for(const state of PROFILE_STATES)for(const strategy of ACTION_STRATEGIES){const pool=ACTIONS.filter(a=>a.curatorId===id&&a.profileState===state&&a.strategy===strategy);assert.equal(pool.length,2);assert.notEqual(pool[0].mechanismId,pool[1].mechanismId);}
 for(const a of ACTIONS){assert.deepEqual(a.durationVariants.map(v=>v.minutes),[2,10,30]);assert.ok(a.independentAlternative&&a.lowEffortAlternative&&a.observableCompletion&&a.sourceRefs.length);}
});
