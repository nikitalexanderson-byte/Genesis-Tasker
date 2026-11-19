import assert from 'node:assert/strict';
import test from 'node:test';
import {calendarModule} from './helpers/calendar-modules.mjs';
import {MemoryStorage,cloudSyncClient} from './helpers/cloud-sync-client.mjs';
const {PersonalDiarySource,readMigratedDiary,parseDiaryMigrationJson}=calendarModule('app/e2ee/diary-source.ts');
const {DiaryRepository}=calendarModule('app/diary-storage.ts');
const {normalizeNativeDiaryCapture}=calendarModule('app/e2ee/diary-native-source.ts');
const NOW='2026-11-19T09:00:00Z',prefix='genesis-diary-v1:owner:';
const context={ownerId:'owner',scopeId:'personal:owner',migrationId:'migration',fence:7,sourceHash:'A'.repeat(43),generation:2};
const decode=bytes=>JSON.parse(new TextDecoder().decode(bytes));
const note=(id='private-note',fields={})=>({version:1,id,title:'Private title',body:'Синтетическая личная запись 🌓',color:'sage',createdAt:NOW,updatedAt:NOW,archived:false,pinned:false,reaction:null,...fields});
async function fixture(){
 const key=crypto.getRandomValues(new Uint8Array(32)),cryptoKey=await crypto.subtle.importKey('raw',key,'AES-GCM',false,['encrypt']);
 const memory={ownerId:'owner',legacyKey:Buffer.from(key).toString('base64'),generation:0,reconciliationRequired:false,records:[],editors:[]};
 const remote={protocol:1,ownerId:'owner',scopeId:context.scopeId,migrationId:'migration',fence:7,sourceHash:context.sourceHash,legacyGeneration:0,checkpointHash:'A'.repeat(43),directoryRevision:1,
  notes:[],deletions:[],settings:[],dreams:[],dreamSettings:[],adviceReferences:[],legacyKey:{keyMode:'empty',key:null}};
 const storage=new MemoryStorage();let captured=false,calls=0,live=true;
 const ports={storage,memory:()=>structuredClone(memory),assertCurrent:()=>{if(!live)throw new Error('E2EE_ACCOUNT_CHANGED');},legacyDiary:async value=>{assert.ok(captured,'capture must precede server source read');assert.deepEqual(value,context);calls++;return structuredClone(remote);}};
 const source=new PersonalDiarySource('owner',context.scopeId,ports);
 return{memory,remote,storage,ports,source,key,get calls(){return calls;},lock(){live=false;},
  async seal(value,fields={},purposeId=value.id,raw=JSON.stringify(value)){
   const iv=crypto.getRandomValues(new Uint8Array(12)),cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(`genesis-mindmap-v1:owner:diary-note:v1:${purposeId}`)},cryptoKey,new TextEncoder().encode(raw));
   return{id:value.id,revision:1,schemaVersion:1,iv:Buffer.from(iv).toString('base64'),ciphertext:Buffer.from(cipher).toString('base64'),updatedAt:NOW,...fields};
  },async server(value,fields={}){const row=await this.seal(value);remote.notes.push({id:row.id,revision:row.revision,schema_version:1,iv:row.iv,ciphertext:row.ciphertext,payload_hash:'b'.repeat(64),updated_at:NOW,...fields});remote.legacyKey={keyMode:'account',key:memory.legacyKey};},
  cache(rows){storage.setItem(prefix+'cache',JSON.stringify(rows));},async capture(){const bytes=await source.captureLocal();captured=true;return bytes;},async run(previous=[]){return source.reconcile(await this.capture(),previous,context);}};
}
async function logical(result){
 const cloud=new Map(result.content.map(row=>[row.objectId,row.bytes])),local=new Map(result.localContent.map(row=>[row.objectId,row.bytes]));
 return readMigratedDiary(async(_,id)=>decode(cloud.get(id)),async(_,id)=>local.has(id)?new Uint8Array(local.get(id)):null,'owner');
}

test('diary capture enumerates every owner draft and required absent slot before IO without rewriting or foreign-owner reads',async()=>{
 const f=await fixture();f.storage.setItem(prefix+'draft:closed-tab:unsent','exact raw ciphertext');f.storage.setItem('genesis-diary-v1:other:cache','foreign');
 f.memory.editors=[{source:'mounted-blank',note:note('blank',{body:''}),revision:0}];const before=[...f.storage.data],snapshot=decode(await f.capture());
 assert.equal(f.calls,0);assert.equal(snapshot.entries.length,5);assert.ok(snapshot.entries.every(row=>row.key.startsWith(prefix)));assert.equal(snapshot.entries.find(row=>row.key.endsWith(':cache')).value,null);
 assert.equal(snapshot.entries.find(row=>row.key.includes('closed-tab')).value,'exact raw ciphertext');assert.deepEqual(snapshot.memory.editors,f.memory.editors);assert.deepEqual([...f.storage.data],before);
});

test('authenticated diary factory captures current records and registered blank editors without legacy bootstrap or writes',async()=>{
 const tab=await cloudSyncClient(),repository=new DiaryRepository(tab.userId,new MemoryStorage(),tab.client.personalDocumentAccess(tab.userId));
 let current={note:note('blank',{body:'',title:'Still editing'}),revision:0,state:{voicePartial:'An unfinished voice phrase'}};
 const close=repository.registerMigrationEditor(()=>current),calls=tab.requests.length,before=[...tab.storage.data];
 const source=await tab.client.createPersonalDiaryMigrationSource(tab.userId,'personal:'+tab.userId,{legacyDiary(){throw new Error('Premature source IO');}},()=>repository.captureMigration([]));
 let snapshot=decode(await source.captureLocal());assert.equal(snapshot.memory.ownerId,tab.userId);assert.equal(snapshot.memory.editors[0].state.voicePartial,'An unfinished voice phrase');
 current={...current,note:{...current.note,title:'New editor title'}};snapshot=decode(await source.captureLocal());assert.equal(snapshot.memory.editors[0].note.title,'New editor title');
 assert.equal(tab.requests.length,calls);assert.deepEqual([...tab.storage.data],before);close();assert.deepEqual(repository.captureMigration([]).editors,[]);
 await assert.rejects(tab.client.createPersonalDiaryMigrationSource('foreign','personal:foreign',{legacyDiary(){}},()=>({records:[],editors:[]})),/SCOPE_BINDING_MISMATCH/);
 repository.dispose();assert.throws(()=>repository.captureMigration([]),/SESSION_CLOSED/);
});

test('actual web repository encrypted cache, drafts and unknown note metadata survive signed-source conversion with no replay',async()=>{
 const client=await cloudSyncClient({userId:'owner'}),storage=new MemoryStorage();let writes=0;
 client.respond(async(url,init)=>{if(init.method==='PUT'){writes++;return new Response(JSON.stringify({revision:1,updatedAt:NOW}));}throw new Error('NO_SOURCE_HTTP');});
 const repository=new DiaryRepository('owner',storage,client.client.personalDocumentAccess('owner'));
 const original=note('actual',{customColor:'#12abef',futureMetadata:{private:'preserve exact optional fields'}}),saved=await repository.save(original);
 await repository.keepDraft({...original,body:'Неотправленный текст'},saved);const before=[...storage.data];
 const f=await fixture();f.memory.legacyKey=client.key;f.ports.storage=storage;
 const result=await f.run(),read=await logical(result);assert.equal(writes,1);assert.deepEqual(read.find(row=>row.placement==='remote').note,original);
 const local=decode(result.localContent.find(row=>row.objectId==='personal-diary-local-history-v1').bytes);assert.equal(local.drafts[0].note.body,'Неотправленный текст');
 assert.ok(!JSON.stringify(result.content.map(row=>decode(row.bytes))).includes('Неотправленный текст'));assert.deepEqual([...storage.data],before);
});

test('server notes preserve dreams, saved advice snapshots, exact custom fields and authenticated references',async()=>{
 const f=await fixture(),dream=note('dream',{dream:{day:'2026-11-18',timeZone:'Europe/Moscow',lucid:true},customColor:'#c0ffee'}),saved=note('saved',{advice:{id:'advice-123',body:'Original edition',language:'ru',categories:['aretology'],sources:[{work:'Book',kind:'quote'}],privateUnknown:'retain'}});
 await f.server(dream);await f.server(saved);f.remote.dreams=[{note_id:'dream',dream_day:'2026-11-18',time_zone:'Europe/Moscow'}];f.remote.adviceReferences=[{note_id:'saved',advice_id:'advice-123'}];
 f.remote.settings=[{sync_enabled:1,revision:4,command_hash:'c'.repeat(64),removed_count:3,updated_at:NOW}];f.remote.dreamSettings=[{today_mode:'morning',revision:2,updated_at:NOW}];
 const before=structuredClone(f.remote),result=await f.run(),read=await logical(result);assert.deepEqual(read.filter(row=>row.note).map(row=>row.note),[dream,saved]);
 const metadata=decode(result.content.find(row=>row.objectId==='personal-diary-settings-v1').bytes);assert.equal(metadata.noteHistory.length,2);assert.equal(metadata.noteHistory[0].payloadHash,'b'.repeat(64));assert.equal(metadata.noteHistory[0].updatedAt,NOW);
 const index=decode(result.content.find(row=>row.objectId==='personal-diary-index-v1').bytes);assert.equal(index.references.length,2);assert.deepEqual(f.remote,before);
 assert.ok(result.content.every(row=>!row.objectId.includes('2026-11-18')&&!row.objectId.includes('saved')));
 const wire=JSON.stringify(result.content.map(row=>decode(row.bytes)));assert.ok(!wire.includes(f.memory.legacyKey)&&!wire.includes(f.remote.notes[0].ciphertext));
});

test('local-only marker and local-only cache never enter cloud content, including history and refs',async()=>{
 for(const marker of ['server','local','cache']){
  const f=await fixture(),privateNote=note('private-local');await f.server(privateNote);f.cache([await f.seal(privateNote,{localOnly:marker==='cache',revision:marker==='cache'?0:1,uploadId:'uncertain-copy'})]);
  if(marker==='server')f.remote.deletions=[{id:privateNote.id,revision:2,local_only:1,updated_at:NOW}];
  if(marker==='local')f.storage.setItem(prefix+'deleted',JSON.stringify([{id:privateNote.id,revision:2,localOnly:true,updatedAt:NOW}]));
  const result=await f.run(),remote=JSON.stringify(result.content.map(row=>decode(row.bytes)));assert.ok(!remote.includes(privateNote.body)&&!remote.includes(privateNote.id)&&!remote.includes('uncertain-copy'));
  const rows=(await logical(result)).filter(row=>row.note);assert.equal(rows.length,1);assert.equal(rows[0].placement,'local');assert.deepEqual(rows[0].note,privateNote);
  const history=decode(result.localContent.find(row=>row.objectId==='personal-diary-local-history-v1').bytes);assert.equal(history.history.find(row=>row.source==='cache').uploadId,'uncertain-copy');
 }
});

test('a device privacy preference cannot upload its private edit when another device has enabled sync',async()=>{
 const f=await fixture();f.storage.setItem(prefix+'settings',JSON.stringify({syncEnabled:true,revision:3,deviceLocalOnly:true}));
 await f.server(note('same',{body:'Already cloud copy'}));f.cache([await f.seal(note('same',{body:'Device private edited copy'}))]);
 const result=await f.run(),read=await logical(result);assert.deepEqual(read.filter(row=>row.note).map(row=>[row.placement,row.note.body]),[['remote','Already cloud copy'],['local','Device private edited copy']]);
 assert.ok(!JSON.stringify(result.content.map(row=>decode(row.bytes))).includes('Device private edited copy'));
});

test('disabled server sync keeps retained notes local and blank mounted editors remain recoverable work',async()=>{
 const f=await fixture();await f.server(note());f.remote.settings=[{sync_enabled:0,revision:2,command_hash:null,removed_count:1,updated_at:NOW}];f.memory.editors=[{source:'editor',note:note('blank',{body:'  ',title:'Unfinished title'}),revision:0}];
 const result=await f.run();assert.equal((await logical(result)).find(row=>row.note).placement,'local');
 const history=decode(result.localContent.find(row=>row.objectId==='personal-diary-local-history-v1').bytes);assert.equal(history.drafts[0].note.body,'  ');
 assert.ok(!JSON.stringify(result.content.map(row=>decode(row.bytes))).includes('Unfinished title'));
});

test('real deletion does not resurrect stale committed copies and does not discard unsent local editor content',async()=>{
 const f=await fixture();f.cache([await f.seal(note())]);f.remote.deletions=[{id:'private-note',revision:2,local_only:0,updated_at:NOW}];
 f.memory.editors=[{source:'editor',note:note('private-note',{body:'Unsent after deletion'}),revision:1}];const result=await f.run();
 assert.ok((await logical(result)).every(row=>row.deleted&&row.note===null));assert.equal(decode(result.localContent.find(row=>row.objectId==='personal-diary-local-history-v1').bytes).drafts[0].note.body,'Unsent after deletion');
});

test('divergent equal revisions require exact explicit review and preserve every original without timestamp selection',async()=>{
 const f=await fixture();await f.server(note());f.cache([await f.seal(note('private-note',{body:'Different cache content',updatedAt:'2026-11-20T10:00:00Z'}))]);
 await assert.rejects(f.run(),/CONFLICT_REVIEW_REQUIRED/);let seen;
 f.ports.review=async conflicts=>{seen=conflicts;return{'remote:private-note':'cache'};};const result=await f.run();assert.equal(seen.length,1);assert.equal((await logical(result)).find(row=>row.note).note.body,'Different cache content');
 const object=decode(result.content.find(row=>row.objectId.startsWith('personal-diary-record:')).bytes);assert.equal(object.variants.length,2);
 for(const choices of [{},{'remote:private-note':'server',extra:'cache'},{'remote:private-note':'nonexistent'}]){f.ports.review=async()=>choices;await assert.rejects(f.run(),/CONFLICT_REVIEW_REQUIRED/);}
});

test('duplicate decoded JSON keys, damaged ciphertext and wrong owner/id AAD refuse without source cleanup',async()=>{
 for(const kind of ['duplicate','cipher','id','future','unknown-slot']){
  const f=await fixture();let row=await f.seal(note(),{},kind==='id'?'other-id':'private-note',kind==='duplicate'?JSON.stringify(note()).replace('"body":','"b\\u006fdy":"hidden original","body":'):JSON.stringify(note()));
  if(kind==='cipher')row.ciphertext=row.ciphertext.slice(0,-4)+'AAAA';if(kind==='future')row.schemaVersion=2;
  if(kind==='unknown-slot')f.storage.setItem(prefix+'future-private-slot','do not omit');else f.cache([row]);const before=[...f.storage.data];
  await assert.rejects(f.run(),/E2EE_/);assert.deepEqual([...f.storage.data],before);
 }
 assert.throws(()=>parseDiaryMigrationJson('{"nested":{"a":1,"\\u0061":2}}'),/SOURCE_INVALID/);
});

test('source owner, lease, generation, reference and malformed formats never become an empty successful migration',async()=>{
 for(const modify of [f=>f.remote.ownerId='other',f=>f.remote.sourceHash='B'.repeat(43),f=>f.remote.fence++,f=>f.remote.legacyGeneration++,f=>f.memory.reconciliationRequired=true,
  f=>f.remote.dreams=[{note_id:'missing',dream_day:'2026-11-18',time_zone:'UTC'}],f=>f.remote.notes=[{}],f=>f.remote.settings=[{sync_enabled:1,revision:1}],f=>f.remote.legacyKey={keyMode:'client',key:'do-not-import'}]){
  const f=await fixture();modify(f);const before=structuredClone(f.remote);await assert.rejects(f.run(),/E2EE_/);assert.deepEqual(f.remote,before);
 }
});

test('different protected previous attempts require review before the first remote read and late account switches cancel',async()=>{
 const f=await fixture(),old=await f.capture();f.memory.editors=[{source:'new',note:note('new',{body:''}),revision:0}];await assert.rejects(f.run([old]),/HISTORY_REVIEW_REQUIRED/);assert.equal(f.calls,0);
 const g=await fixture();g.ports.legacyDiary=async()=>{g.lock();return g.remote;};await assert.rejects(g.run(),/ACCOUNT_CHANGED/);
});

test('normal migrated read rejects missing local bytes, swapped owner/object and invalid index selection',async()=>{
 const f=await fixture();f.cache([await f.seal(note(),{localOnly:true,revision:0})]);const result=await f.run();
 const cloud=new Map(result.content.map(row=>[row.objectId,decode(row.bytes)])),local=new Map(result.localContent.map(row=>[row.objectId,new Uint8Array(row.bytes)]));
 const read=()=>readMigratedDiary(async(_,id)=>structuredClone(cloud.get(id)),async(_,id)=>local.has(id)?new Uint8Array(local.get(id)):null,'owner');
 const id=[...local.keys()].find(id=>id.startsWith('personal-diary-record:')),original=local.get(id);local.delete(id);await assert.rejects(read(),/LOCAL_CONTENT_REQUIRED/);local.set(id,original);
 const swapped=decode(original);swapped.ownerId='other';local.set(id,new TextEncoder().encode(JSON.stringify(swapped)));await assert.rejects(read(),/BINDING_MISMATCH/);
});

function nativeFixture(){
 const root={version:1,owner:'owner',hasCache:true,settings:{syncEnabled:true,revision:2,deviceLocalOnly:false},dreamSettings:{todayMode:'morning',revision:1},deleted:[],
  records:[{note:note('native'),revision:1,draftKey:null,pending:null,pendingNote:null,localOnly:false,uploadId:null}],drafts:[]};
 const value={protocol:1,ownerId:'owner',scopeId:context.scopeId,capturedAt:NOW,generation:0,pendingGeneration:null,
  documents:[{kind:'diary-v1',revision:1,encrypted:'native-keystore-envelope'}],caches:[{source:'diary-v1',plain:JSON.stringify(root)}],mounted:null,
  memory:{ownerId:'owner',legacyKey:'',generation:0,reconciliationRequired:false,records:[],editors:[]}};
 return{root,value};
}
test('native raw diary cache normalizes all note/draft/privacy/settings fields without opening or exporting any key',async()=>{
 const {root,value}=nativeFixture();root.records[0].localOnly=true;root.records[0].uploadId='uncertain-native-copy';root.drafts=[{note:note('draft'),revision:0,draftKey:'draft:old: draft'.replace(' ',''),pending:null,pendingNote:null,localOnly:false,uploadId:null}];value.caches[0].plain=JSON.stringify(root);
 const normalized=normalizeNativeDiaryCapture(value,()=>{});assert.equal(normalized.snapshot.memory.legacyKey,'');assert.equal(normalized.snapshot.memory.records.length,2);
 assert.equal(normalized.snapshot.memory.records[0].uploadId,'uncertain-native-copy');assert.deepEqual(normalized.metadata.caches,value.caches);
 const f=await fixture();f.ports.openLegacy=async()=>{throw new Error('Unexpected old key open');};const snapshot=new TextEncoder().encode(JSON.stringify(normalized.snapshot));await f.capture();
 const result=await f.source.reconcile(snapshot,[],context);assert.equal((await logical(result)).find(row=>row.note).placement,'local');assert.ok(!JSON.stringify(result.content.map(row=>decode(row.bytes))).includes('uncertain-native-copy'));
});

test('native duplicate raw fields, foreign cache, missing primary and divergent retained chunk history refuse safely',()=>{
 for(const alter of [({value})=>value.caches[0].plain=value.caches[0].plain.replace('"body":','"body":"hidden","b\\u006fdy":'),
  ({root,value})=>{root.owner='foreign';value.caches[0].plain=JSON.stringify(root);},({value})=>value.caches=[],
  ({value})=>value.documents.push({kind:'diary-v1/future',revision:1,encrypted:'retained'}),
  ({root,value})=>{const generation='11111111-1111-4111-8111-111111111111';value.documents.push({kind:`diary-v1/${generation}/0`,revision:1,encrypted:'retained'});root.records[0].note.body='Old private history';value.caches.push({source:`diary-v1/${generation}`,plain:JSON.stringify(root)});},
  ({value})=>value.pendingGeneration=2]){
  const f=nativeFixture();alter(f);assert.throws(()=>normalizeNativeDiaryCapture(f.value,()=>{}),/E2EE_/);
 }
});
