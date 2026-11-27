import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {calendarModule} from './helpers/calendar-modules.mjs';
import {MemoryStorage,cloudSyncClient} from './helpers/cloud-sync-client.mjs';
import {collectAdvicePublicAssets} from '../scripts/advice-public-assets.mjs';
const {PersonalAdviceSource}=calendarModule('app/e2ee/advice-source.ts');
const {PublicAdviceCatalogues}=calendarModule('app/e2ee/advice-catalogue.ts');
const {advicePreferences}=calendarModule('app/daily-advice.ts');
const actual=collectAdvicePublicAssets(resolve('.')),assets=new Map(actual.assets.map(row=>[row.fileName,new Uint8Array(Buffer.from(row.source))]));
const entry={...JSON.parse(readFileSync('server/content/daily-advice.json','utf8')).items[0],collection:'aurora'};
const philosopher={...JSON.parse(readFileSync('server/content/philosopher-aphorisms.json','utf8')).items[0],collection:'philosophers'};
const NOW='2026-11-19T09:00:00Z',DAY='2026-11-19';
const context={ownerId:'owner',scopeId:'personal:owner',migrationId:'migration',fence:7,sourceHash:'A'.repeat(43),generation:2};
const decode=bytes=>JSON.parse(new TextDecoder().decode(bytes));
function row(value=entry,slot){return{dayKey:DAY,adviceId:value.id,entryJson:JSON.stringify(value),createdAt:NOW,viewedAt:NOW,dismissedAt:null,...(slot===undefined?{selectionJson:'{"smart":true}'}:{slot})};}
function displayed(value=entry){const card=structuredClone(value);for(const key of ['contentVersion','translationVersion','sourceId','topics','schedule','status','timeOfDay','priority'])delete card[key];return{...card,body:'Synthetic previously rendered private snapshot',dayKey:DAY,language:'en',dismissed:false,sequence:1};}
function result(value=entry){return{dayKey:DAY,state:'ready',advice:displayed(value),history:[displayed(value)],sequence:1,dailyLimit:9,remaining:8,canNext:true};}
function fixture(){
 const memory={ownerId:'owner',generation:0,reconciliationRequired:false,preferences:null,mounted:null,rendered:[],seen:[],unassignedLegacy:false};
 const remote={protocol:1,ownerId:'owner',scopeId:context.scopeId,migrationId:context.migrationId,fence:7,sourceHash:context.sourceHash,legacyGeneration:0,checkpointHash:'A'.repeat(43),directoryRevision:1,
  preferencesJson:'{"enabled":true,"smart":true}',collectionsJson:'["aurora","philosophers"]',notificationsJson:'{}',psychopompiaJson:'{}',philosophersPerDay:3,
  days:[row()],entries:[row(entry,1)],extraEntries:[row(philosopher,7)],metrics:{projects:1,tasks:2,openTasks:1,completedTasks:1,googleSynced:0,habits:3,updatedAt:NOW}};
 const storage=new MemoryStorage();let captured=false,live=true,calls=0;const downloads=[];
 const check=()=>{if(!live)throw new Error('E2EE_ACCOUNT_CHANGED');};
 const catalogues=new PublicAdviceCatalogues(async path=>{assert.ok(captured,'Catalogue IO cannot precede protected capture');downloads.push(path);return assets.get(path);},check);
 const ports={storage,memory:()=>memory,assertCurrent:check,catalogues,legacyAdvice:async actual=>{assert.ok(captured);assert.deepEqual(actual,context);calls++;return structuredClone(remote);}};
 const source=new PersonalAdviceSource('owner',context.scopeId,ports);
 return{memory,remote,storage,source,ports,downloads,lock(){live=false;},get calls(){return calls;},async capture(){const bytes=await source.captureLocal();captured=true;return bytes;},async run(previous=[]){return source.reconcile(await this.capture(),previous,context);}};
}

test('actual signed source fields and all historical public texts become owner-bound portable content without live draw authority',async()=>{
 const f=fixture();f.memory.mounted={language:'en',result:result(),selection:entry.id};f.memory.rendered=[{source:'synthetic-owner-room-copy',response:result()}];f.memory.seen=[{dayKey:DAY,id:entry.id}];
 f.storage.setItem('genesis-data-generation-v1:foreign','foreign-secret');const originals=structuredClone(f.remote),before=[...f.storage.data];
 const capture=await f.capture();assert.equal(f.calls,0);assert.equal(f.downloads.length,0);assert.ok(!new TextDecoder().decode(capture).includes('foreign-secret'));
 const migrated=await f.source.reconcile(capture,[],context);assert.equal(migrated.complete,true);assert.equal(migrated.content.length,4);assert.ok(migrated.content.every(row=>row.domain==='workspace'));
 const prefs=decode(migrated.content[0].bytes);assert.equal(prefs.preferences.philosophersPerDay,3);assert.equal(prefs.originals.preferencesJson,f.remote.preferencesJson);
 const index=decode(migrated.content.find(row=>row.objectId==='personal-advice-history-index-v1').bytes);assert.equal(index.days[0].dayKey,DAY);
 assert.match(index.days[0].objectId,/^personal-advice-day:[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);assert.ok(migrated.content.every(row=>!row.objectId.includes(DAY)&&!row.objectId.includes(entry.id)&&!row.objectId.includes(philosopher.id)));
 const day=decode(migrated.content.find(row=>row.objectId===index.days[0].objectId).bytes);assert.equal(Object.keys(day.pointer.translations).length,18);assert.equal(Object.keys(day.extraEntries[0].translations).length,18);
 const exact=JSON.parse(readFileSync('server/content/daily-advice/'+entry.contentVersion+'/en.json','utf8'))[entry.id];assert.deepEqual(day.pointer.translations.en,exact);
 assert.equal(day.pointer.entryJson,f.remote.days[0].entryJson);assert.equal(day.entries[0].viewedAt,NOW);assert.equal(day.extraEntries[0].slot,7);
 const history=decode(migrated.content.at(-1).bytes);assert.equal(history.mounted.result.advice.body,'Synthetic previously rendered private snapshot');assert.deepEqual(history.seen,f.memory.seen);assert.equal(history.metrics.habits,3);
 for(const item of migrated.content)for(const authority of ['"canNext":','"dailyLimit":','"remaining":'])assert.ok(!new TextDecoder().decode(item.bytes).includes(authority));
 assert.deepEqual(f.remote,originals);assert.deepEqual([...f.storage.data],before);assert.ok(f.downloads.every(path=>!path.includes(entry.id)&&!path.includes(philosopher.id)));
});

test('independent mounted preference edits merge while same-field disagreement retains source and requires review',async()=>{
 const f=fixture(),base=advicePreferences({collections:['aurora','philosophers'],philosophersPerDay:3});
 f.memory.preferences={base,value:{...base,enabled:false}};f.remote.preferencesJson='{"enabled":true,"smart":false}';
 const prefs=decode((await f.run()).content[0].bytes).preferences;assert.equal(prefs.enabled,false);assert.equal(prefs.smart,false);
 const conflict=fixture();conflict.memory.preferences={base,value:{...base,notifications:{...base.notifications,time:'10:00'}}};conflict.remote.notificationsJson=JSON.stringify({...base.notifications,time:'11:00'});
 const before=structuredClone(conflict.remote);await assert.rejects(conflict.run(),/CONFLICT_REVIEW_REQUIRED/);assert.deepEqual(conflict.remote,before);
});

test('unassigned provenance, pending generation and changed protected attempts block before private source IO',async()=>{
 for(const mutate of [f=>f.memory.unassignedLegacy=true,f=>f.memory.reconciliationRequired=true,f=>f.storage.setItem('genesis-data-generation-v1:owner','1')]){
  const f=fixture();mutate(f);await assert.rejects(f.run(),/REVIEW_REQUIRED/);assert.equal(f.calls,0);assert.equal(f.downloads.length,0);
 }
 const changed=fixture(),old=await changed.capture();changed.memory.seen=[{dayKey:DAY,id:entry.id}];await assert.rejects(changed.run([old]),/HISTORY_REVIEW_REQUIRED/);assert.equal(changed.calls,0);
});

test('wrong account, migration lease or generation cannot produce new-root content',async()=>{
 for(const field of ['ownerId','scopeId','migrationId','sourceHash','fence']){
  const f=fixture();f.remote[field]=field==='fence'?8:'wrong';await assert.rejects(f.run(),/SCOPE_BINDING_MISMATCH/);
 }
 const generation=fixture();generation.remote.legacyGeneration=1;await assert.rejects(generation.run(),/GENERATION_REVIEW_REQUIRED/);
 const closed=fixture();closed.lock();await assert.rejects(closed.capture(),/ACCOUNT_CHANGED/);assert.equal(closed.calls,0);
 const late=fixture();late.ports.legacyAdvice=async()=>{late.lock();return late.remote;};await assert.rejects(late.run(),/ACCOUNT_CHANGED/);assert.equal(late.downloads.length,0);
});

test('malformed or lossy private preferences, unsupported entry fields, orphan identity and duplicate slot never silently drop data',async()=>{
 for(const mutate of [f=>f.remote.psychopompiaJson='{"subcategories":["future-unknown-category"]}',f=>f.remote.preferencesJson='{"futurePrivateChoice":"preserve me"}',
  f=>f.remote.days[0].entryJson=JSON.stringify({...entry,unknownPrivateReflection:'retain'}),f=>f.remote.days[0].adviceId=philosopher.id,
  f=>f.remote.entries.push(f.remote.entries[0]),f=>f.remote.extraEntries[0].slot=1,f=>f.remote.days[0].createdAt='bad',f=>f.remote.liveQuota=9]){
  const f=fixture();mutate(f);const before=structuredClone(f.remote);await assert.rejects(f.run(),/E2EE_/);assert.deepEqual(f.remote,before);
 }
});

test('missing public historical edition is an explicit failure while exact captured rendered text survives',async()=>{
 const f=fixture();f.memory.rendered=[{source:'synthetic-old-room',response:result()}];
 f.remote.days[0].entryJson=JSON.stringify({...entry,contentVersion:'unavailable-old-v1'});const capture=await f.capture();
 await assert.rejects(f.source.reconcile(capture,[],context),/CATALOGUE_UNAVAILABLE/);
 assert.equal(decode(capture).memory.rendered[0].response.advice.body,'Synthetic previously rendered private snapshot');
});

test('authenticated factory captures the actual owner and supplied mounted advice/settings without private or public IO',async()=>{
 const tab=await cloudSyncClient(),before=[...tab.storage.data],calls=tab.requests.length;
 const mounted={language:'en',result:result(),selection:entry.id},settings={base:advicePreferences(),value:{...advicePreferences(),enabled:false}};
 const source=await tab.client.createPersonalAdviceMigrationSource(tab.userId,'personal:'+tab.userId,{legacyAdvice(){throw new Error('Premature private IO');}},()=>({preferences:settings,mounted}));
 const snapshot=decode(await source.captureLocal());assert.equal(snapshot.memory.ownerId,tab.userId);assert.deepEqual(snapshot.memory.mounted,mounted);assert.deepEqual(snapshot.memory.preferences,settings);
 assert.equal(tab.requests.length,calls);assert.deepEqual([...tab.storage.data],before);
 await assert.rejects(tab.client.createPersonalAdviceMigrationSource('foreign','personal:foreign',{legacyAdvice(){}},()=>({preferences:null,mounted:null})),/SCOPE_BINDING_MISMATCH/);
});
