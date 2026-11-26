import assert from 'node:assert/strict';
import test from 'node:test';
import {calendarModule} from './helpers/calendar-modules.mjs';
import {readFileSync} from 'node:fs';
const {backupJournalConflicts,resolveBackupJournalDocument,selectBackupJournalDocument}=calendarModule('app/backup-private-journals.ts');
const owner='synthetic-owner',a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222';
function fixture(id='aurora'){
 const document=label=>({version:1,syntheticNote:label}),base=document('base');
 const data={journalVersion:1,cached:null,document:document('Forged default'),pendingCopies:[
  {key:`genesis-${id}-workspace-v1:${owner}:pending:writer:${a}:1:pending`,document:document('old'),base,expectedRevision:0},
  {key:`genesis-${id}-workspace-v1:${owner}:pending:writer:${a}:2:pending`,document:document('left'),base,expectedRevision:0},
  {key:`genesis-${id}-workspace-v1:${owner}:pending:writer:${b}:1:pending`,document:document('right'),base,expectedRevision:0}]};
 return{data,payload:{ownerId:owner,sections:[{id,completeness:'partial',data}]}};
}
for(const id of ['aurora','stoicheion'])test(`${id}: explicit choices recover newest or superseded copies without mutating any original`,async()=>{
 const f=fixture(id),before=structuredClone(f.payload),[group]=await backupJournalConflicts(f.payload);
 assert.equal(group.section,id);assert.deepEqual(group.variants.map(row=>[row.document.syntheticNote,row.latest]),[['left',true],['right',true],['old',false]]);
 assert.throws(()=>selectBackupJournalDocument(id,owner,f.data),/DRAFT_CHOICE_REQUIRED/);
 for(const variant of group.variants){const actual=await resolveBackupJournalDocument(id,owner,f.data,{sourceHash:group.sourceHash,variantHash:variant.hash});assert.deepEqual(actual,variant.document);actual.syntheticNote='changed return copy';assert.deepEqual(f.payload,before);}
});
test('a forged archived default/decision never authorizes selecting one draft',async()=>{
 const f=fixture();f.data.decision={variantHash:'forged'};
 await assert.rejects(resolveBackupJournalDocument('aurora',owner,f.data),/DRAFT_CHOICE_REQUIRED/);
 const [group]=await backupJournalConflicts(f.payload);
 await assert.rejects(resolveBackupJournalDocument('aurora',owner,f.data,{sourceHash:group.sourceHash,variantHash:'0'.repeat(64)}),/DRAFT_CHOICE_REQUIRED/);
});
test('a decision is bound to every retained source/base, owner and section; array order is immaterial',async()=>{
 const f=fixture(),[group]=await backupJournalConflicts(f.payload),choice={sourceHash:group.sourceHash,variantHash:group.variants[0].hash};
 f.data.pendingCopies.reverse();assert.equal((await resolveBackupJournalDocument('aurora',owner,f.data,choice)).syntheticNote,'left');
 for(const mutate of [f=>f.data.pendingCopies[0].base.syntheticNote='altered base',f=>f.data.pendingCopies[2].document.syntheticNote='altered historical copy',f=>f.data.cached={document:{version:1,note:'new cache'},revision:1}]){
  const changed=fixture();mutate(changed);await assert.rejects(resolveBackupJournalDocument('aurora',owner,changed.data,choice),/PREVIEW_CHANGED/);
 }
 const other=fixture('stoicheion');await assert.rejects(resolveBackupJournalDocument('stoicheion',owner,other.data,choice),/PREVIEW_CHANGED/);
 await assert.rejects(resolveBackupJournalDocument('aurora','foreign',f.data,choice),/LOCAL_CACHE_INVALID/);
});
test('an input mutation while hashing cannot swap the document authorized by a reviewed choice',async()=>{
 const f=fixture(),[group]=await backupJournalConflicts(f.payload),choice={sourceHash:group.sourceHash,variantHash:group.variants[0].hash};
 const restoring=resolveBackupJournalDocument('aurora',owner,f.data,choice);f.data.pendingCopies[1].document.syntheticNote='replaced during asynchronous hashing';
 assert.equal((await restoring).syntheticNote,'left');
});
test('matching writer heads need no choice, and malformed journals remain blocked',async()=>{
 const same=fixture();same.data.pendingCopies[2].document=structuredClone(same.data.pendingCopies[1].document);assert.deepEqual(await backupJournalConflicts(same.payload),[]);
 for(const mutate of [f=>f.data.pendingCopies.push(f.data.pendingCopies[0]),f=>f.data.pendingCopies[0].key+=':invalid',f=>delete f.data.cached]){
  const f=fixture();mutate(f);await assert.rejects(backupJournalConflicts(f.payload),/INVALID/);
 }
});
test('all fourteen catalogs include the six recovery controls and preserve their number placeholder',()=>{
 const source=['Выберите сохранённый вариант','В архиве есть разные черновики. Сравните их и выберите вариант для восстановления. Остальные варианты останутся в исходном зашифрованном файле.','Вариант {number}','Последний черновик','Ранний снимок','Посмотреть данные варианта'];
 for(const language of ['ru','en','el','de','fr','es','it','pt','pl','sr','uk','zh','tr','ja']){
  const pack=JSON.parse(readFileSync(`app/backup-locales/${language}.json`,'utf8'));for(const key of source)assert.ok(typeof pack[key]==='string'&&pack[key].trim(),`${language}: ${key}`);
  assert.deepEqual(pack[source[2]].match(/\{[^}]+\}/g),['{number}']);
 }
});
