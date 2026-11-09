import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {calendarModule} from './helpers/calendar-modules.mjs';
const json=path=>JSON.parse(readFileSync(new URL('../'+path,import.meta.url),'utf8'));
const languages=['ru','en','el','de','fr','es','it','pt','pl','sr','uk','zh','tr','ja'];
const source={...json('app/aurora/texts.ru.json'),...json('app/aurora/forecast-test-copy.ru.json'),...json('app/aurora/adaptive-copy.ru.json')};
const {transliterateGreek}=calendarModule('app/aurora/transliteration.ts');
const {LEXICON}=calendarModule('app/aurora/catalog/lexicon.ts');
const {ACTIONS}=calendarModule('app/aurora/catalog/actions.ts');
const {createAuroraTranslator}=calendarModule('app/aurora/localization.ts');
const {SOURCE_CIRCLE_REFERENCE}=calendarModule('app/aurora/source-model.ts');
const {SECTOR_IDS}=calendarModule('app/aurora/registry.ts');

test('Generated conditions translate a catalog question and a short answer together',()=>{
 for(const language of languages.filter(lang=>lang!=='ru')){
  const pack={...json(`app/aurora/locales/${language}.a.json`),...json(`app/aurora/locales/${language}.b.json`)};
  const translate=createAuroraTranslator(language,pack);
  for(const sector of SOURCE_CIRCLE_REFERENCE.filter(row=>SECTOR_IDS.includes(row.id))){
   assert.notEqual(translate(sector.meaning.ru),sector.meaning.ru,`${language}:${sector.id}: source meaning`);
  }
  for(const key of ['text0973','text0975'])for(const answer of ['testYes','testNo','testUnknown']){
   const question=source[key].split('|')[0],expected=pack[key].split('|')[0]+' '+pack[answer];
   assert.equal(translate(question+' '+source[answer]),expected.replace(/\s+/gu,' ').trim(),`${language}:${key}:${answer}`);
  }
  for(const action of ACTIONS){
   const expected=(pack.text0594+translate(action.title)+pack.text0595).replace(/\s+/gu,' ').trim();
   assert.equal(translate(action.independentAlternative),expected,`${language}:${action.id}: lower-case authored title`);
  }
 }
});

test('All fourteen method and backup packs preserve fields, separators and placeholders',()=>{
 const backup=json('app/backup-copy.en.json');
 for(const language of languages){
  const pack=language==='ru'?source:{...json(`app/aurora/locales/${language}.a.json`),...json(`app/aurora/locales/${language}.b.json`)};
  assert.deepEqual(Object.keys(pack).sort(),Object.keys(source).sort(),language);
  for(const [id,text]of Object.entries(source)){
   const translated=pack[id];assert.ok(translated?.trim(),`${language}:${id}`);
   assert.equal(translated.split('|').length,text.split('|').length,`${language}:${id}`);
   assert.deepEqual((translated.match(/\{[A-Za-z]\w*\}/gu)??[]).sort(),(text.match(/\{[A-Za-z]\w*\}/gu)??[]).sort(),`${language}:${id}`);
   if(!['ru','uk','sr'].includes(language))assert.ok(!/[А-Яа-яЁё]/u.test(translated),`${language}:${id} has untranslated source text`);
  }
  const translatedBackup=json(`app/backup-locales/${language}.json`);
  assert.deepEqual(Object.keys(translatedBackup).sort(),Object.keys(backup).sort(),language);
  for(const [key,value]of Object.entries(translatedBackup)){
   assert.ok(value.trim(),`${language}:${key}`);
   assert.deepEqual((value.match(/\{[A-Za-z]\w*\}/gu)??[]).sort(),(key.match(/\{[A-Za-z]\w*\}/gu)??[]).sort(),`${language}:${key}`);
  }
 }
});

test('All 144 lexical sources match the exact accented headword and the reviewed sense',()=>{
 const manifest=json('docs/evidence/v3.2.2-lexicon/manifest.json');
 assert.equal(manifest.entries.length,144);assert.equal(LEXICON.length,144);
 const ids=new Set();
 for(const entry of LEXICON){
  const evidence=manifest.entries.find(row=>row.id===entry.id);
  assert.ok(evidence,entry.id);assert.ok(!ids.has(entry.id));ids.add(entry.id);
  assert.equal(evidence.headword.normalize('NFC'),entry.displayForm.normalize('NFC'),entry.id);
  assert.equal(evidence.projectMeaning,entry.dictionaryMeaning,entry.id);
  assert.equal(evidence.orthographyMatch,'exact_diacritics');
  assert.match(evidence.entrySha256,/^[a-f0-9]{64}$/u);
  assert.ok(evidence.englishSense.trim());assert.ok(entry.sourceRefs[0].startsWith('https://www.logeion.org/'));
 }
 for(const language of languages.filter(lang=>lang!=='ru')){
  const pack={...json(`app/aurora/locales/${language}.a.json`),...json(`app/aurora/locales/${language}.b.json`)};
  for(let index=607;index<=750;index++){
   const id=`text${String(index).padStart(4,'0')}`,[headword,,meaning]=pack[id].split('|');
   assert.equal(headword,source[id].split('|')[0]);assert.ok(meaning.trim(),`${language}:${id}`);
  }
 }
});

test('Conventional readings preserve rough breathing, vowel quantities and diaeresis',()=>{
 for(const [greek,latin]of [['ἁρμονία','harmonia'],['αἵρεσις','hairesis'],['ῥυθμός','rhythmos'],['ἀϊδής','aidēs'],['λόγος','logos'],['ψυχή','psykhē'],['ᾠδή','ōidē'],['ἄγγελος','angelos']])assert.equal(transliterateGreek(greek),latin,greek);
});

test('Every localized card insight retains its exact letter, source sector and orientation',()=>{
 const {cardInsight}=calendarModule('app/aurora/card-insights.ts');
 const {getStoicheionLetters}=calendarModule('app/stoicheion-data.ts');
 for(const language of languages)for(const letter of getStoicheionLetters('ru'))for(const orientation of ['upright','reversed']){
  const insight=cardInsight({cardId:letter.id,sourcePositionId:'center',orientation},language);
  assert.equal(insight.cardId,letter.id);assert.equal(insight.symbol,letter.symbol);assert.equal(insight.reversed,orientation==='reversed');
  assert.ok(insight.heading.trim());assert.ok(insight.lines.length>0,`${language}:${letter.id}:${orientation}`);
 }
});
