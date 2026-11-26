import assert from 'node:assert/strict';
import test from 'node:test';
import {calendarModule} from './helpers/calendar-modules.mjs';
import {MemoryStorage,cloudSyncClient} from './helpers/cloud-sync-client.mjs';
const {PersonalMindmapsSource,readMigratedMindmaps,parseMindmapsMigrationJson}=calendarModule('app/e2ee/mindmaps-source.ts');
const {MindmapRepository}=calendarModule('app/mindmaps-storage.ts');
const {normalizeNativeMindmapsCapture}=calendarModule('app/e2ee/mindmaps-native-source.ts');
const NOW='2026-11-19T10:00:00Z',prefix='genesis-mindmaps:owner:';
const context={ownerId:'owner',scopeId:'personal:owner',migrationId:'migration',fence:7,sourceHash:'A'.repeat(43),generation:2};
const decode=bytes=>JSON.parse(new TextDecoder().decode(bytes));
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2coAAAAASUVORK5CYII=';
const map=(id='private-map',fields={})=>({schemaVersion:1,id,title:'Синтетический замысел 🌓',description:'',projectId:'private-project',pinned:true,archived:false,
 nodes:[{id:'root',parentId:null,kind:'idea',text:'Корень',note:'Частная заметка',tags:[],style:{fill:'#e0f1e2'},presentation:{image:{data:image,alt:'Original picture',fit:'contain'},showNote:false}},
  {id:'task-node',parentId:'root',kind:'task',refId:'original-task',occurrenceDate:'2026-11-19',note:'Original reference',tags:['keep']}],
 links:[{id:'link',from:'root',to:'task-node',label:'Original label',color:'#112233'}],appearance:{lineColor:'#334455'},...fields});
async function fixture(encodedKey){
 const raw=encodedKey?new Uint8Array(Buffer.from(encodedKey,'base64')):crypto.getRandomValues(new Uint8Array(32)),key=await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt']);
 const memory={ownerId:'owner',legacyKey:Buffer.from(raw).toString('base64'),generation:0,reconciliationRequired:false,records:[],editors:[],localWork:[]};
 const remote={protocol:1,ownerId:'owner',scopeId:context.scopeId,migrationId:'migration',fence:7,sourceHash:context.sourceHash,legacyGeneration:0,checkpointHash:'A'.repeat(43),directoryRevision:1,
  maps:[],versions:[],receipts:[],deletions:[],legacyKey:{keyMode:'empty',key:null}};
 const storage=new MemoryStorage();let captured=false,calls=0,live=true;
 const ports={storage,memory:()=>structuredClone(memory),assertCurrent:()=>{if(!live)throw new Error('E2EE_ACCOUNT_CHANGED');},legacyMindmaps:async value=>{assert.ok(captured);assert.deepEqual(value,context);calls++;return structuredClone(remote);}};
 const source=new PersonalMindmapsSource('owner',context.scopeId,ports);
 return{memory,remote,storage,ports,source,get calls(){return calls;},lock(){live=false;},
  async seal(value,purpose='map:'+value.id,fields={},json=JSON.stringify(value)){
   const iv=crypto.getRandomValues(new Uint8Array(12)),cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(`genesis-mindmap-v1:owner:${purpose}`)},key,new TextEncoder().encode(json));
   return{id:value.id,schemaVersion:2,revision:1,updatedAt:NOW,iv:Buffer.from(iv).toString('base64'),ciphertext:Buffer.from(cipher).toString('base64'),...fields};
  },async server(value,revision=1,version=false){const row=await this.seal(value);remote[version?'versions':'maps'].push({[version?'map_id':'id']:value.id,schema_version:2,revision,iv:row.iv,ciphertext:row.ciphertext,updated_at:NOW});remote.legacyKey={keyMode:'account',key:memory.legacyKey};},
  cache(rows){storage.setItem(prefix+'cache',JSON.stringify(rows));},async capture(){const bytes=await source.captureLocal();captured=true;return bytes;},async run(previous=[]){return source.reconcile(await this.capture(),previous,context);}};
}
function readers(result){
 const remote=new Map(result.content.map(row=>[row.objectId,row])),local=new Map(result.localContent.map(row=>[row.objectId,row]));
 const ports=[async(_,id)=>decode(remote.get(id).bytes),async id=>{const row=remote.get(id);return row?{bytes:new Uint8Array(row.bytes),mediaType:row.mediaType}:null;},
  async(_,id)=>local.has(id)?new Uint8Array(local.get(id).bytes):null,'owner'];
 return{remote,local,ports,read:()=>readMigratedMindmaps(...ports)};
}

test('map snapshot captures every owner cache/draft/request/view/conversion slot and blank editor before IO without mutations',async()=>{
 const f=await fixture();for(const key of ['draft:closed:map','request:closed:map','view:map','conversion:map:node'])f.storage.setItem(prefix+key,'exact old value');
 f.storage.setItem('genesis-mindmaps:foreign:cache','foreign');f.memory.editors=[{source:'new-dialog',document:null,revision:0,state:{title:'Not saved yet'}}];
 const before=[...f.storage.data],snapshot=decode(await f.capture());assert.equal(f.calls,0);assert.equal(snapshot.entries.length,5);assert.ok(snapshot.entries.every(row=>row.key.startsWith(prefix)));
 assert.equal(snapshot.entries.find(row=>row.key.endsWith(':cache')).value,null);assert.deepEqual(snapshot.memory.editors,f.memory.editors);assert.deepEqual([...f.storage.data],before);
});

test('all retained server versions, empty optional fields, graph references and embedded image bytes read under the new generation',async()=>{
 const f=await fixture(),original=map();await f.server(original,30);for(let revision=1;revision<=25;revision++)await f.server({...original,title:'Original version '+revision},revision,true);
 f.remote.receipts=[{map_id:original.id,operation_id:'uncertain-write',payload_hash:'a'.repeat(64),revision:29}];const before=structuredClone(f.remote),result=await f.run(),read=await readers(result).read();
 assert.deepEqual(read.records[0].document,original);assert.equal(read.versions.length,25);assert.equal(read.versions[0].document.title,'Original version 1');assert.equal(read.versions[24].document.title,'Original version 25');
 assert.equal(result.content.filter(row=>row.domain==='attachment').length,1);assert.equal(result.content.find(row=>row.domain==='attachment').mediaType,'image/png');
 const wire=JSON.stringify(result.content.filter(row=>row.domain==='mindmap').map(row=>decode(row.bytes)));assert.ok(!wire.includes(image)&&!wire.includes(f.memory.legacyKey)&&!wire.includes(f.remote.maps[0].ciphertext));
 assert.ok(result.content.every(row=>!row.objectId.includes(original.id)&&!row.objectId.includes('2026-11-19')));assert.deepEqual(f.remote,before);
 const metadata=decode(result.content.find(row=>row.objectId==='personal-mindmap-metadata-v1').bytes);assert.deepEqual(metadata.receipts,f.remote.receipts);assert.equal(metadata.execution,'history-only');
});

test('drafts, uncertain requests, conversion tasks, viewport and mounted undo/editor work stay exclusively device-local without replay',async()=>{
 const f=await fixture();await f.server(map());const draft=map('unsent',{title:'Unsent private draft'}),sealed=await f.seal(draft),pending={schemaVersion:2,expectedRevision:0,operationId:'old-request',iv:sealed.iv,ciphertext:sealed.ciphertext};
 for(const kind of ['draft','request'])f.storage.setItem(prefix+kind+':closed:unsent',JSON.stringify(pending));
 const view={mode:'map',collapsed:['task-node'],focus:'root',zoom:1.5,viewport:{left:12,top:36},positions:{root:{x:12,y:35}}};
 const sealedView=await f.seal(view,'view:private-map');f.storage.setItem(prefix+'view:private-map',JSON.stringify({iv:sealedView.iv,ciphertext:sealedView.ciphertext}));
 const conversion={mapId:'private-map',nodeId:'root',taskId:'uncertain-task',task:{title:'Private conversion text',futureOptional:'retain'},applied:false},sealedConversion=await f.seal(conversion,'conversion:private-map:root');
 f.storage.setItem(prefix+'conversion:private-map:root',JSON.stringify({iv:sealedConversion.iv,ciphertext:sealedConversion.ciphertext}));
 f.memory.editors=[{source:'editor',document:map('blank',{title:''}),revision:0,state:{title:'Typing',undo:[map()],text:'Unfinished note'}}];
 const before=[...f.storage.data],result=await f.run(),read=await readers(result).read(),wire=JSON.stringify(result.content.filter(row=>row.domain==='mindmap').map(row=>decode(row.bytes)));
 assert.ok(!wire.includes('Unsent private draft')&&!wire.includes('Private conversion text')&&!wire.includes('Unfinished note')&&!wire.includes('old-request'));
 assert.equal(read.local.drafts.length,2);assert.equal(read.local.drafts[0].operationId,'old-request');assert.deepEqual(read.local.views[0].value,view);
 assert.deepEqual(read.local.conversions[0].value,conversion);assert.equal(read.local.conversions[0].execution,'history-only');assert.equal(read.local.editors[0].document.title,'');assert.deepEqual([...f.storage.data],before);
});

test('authoritative deletion does not resurrect a stale cache, and a newer dirty native draft remains recoverable',async()=>{
 const f=await fixture();f.remote.deletions=[{map_id:'private-map',deleted_at:NOW}];f.cache([await f.seal(map())]);
 f.memory.records=[{document:map('private-map',{title:'Edited after deletion'}),revision:1,pending:null,pendingDocument:null,dirty:true}];const result=await f.run(),read=await readers(result).read();
 assert.deepEqual(read.records,[{id:'private-map',document:null,revision:0,deleted:true}]);assert.equal(read.local.drafts[0].document.title,'Edited after deletion');
 assert.ok(!JSON.stringify(result.content.filter(row=>row.domain==='mindmap').map(row=>decode(row.bytes))).includes('Edited after deletion'));
 assert.ok(!JSON.stringify(result.content.filter(row=>row.domain==='mindmap').map(row=>decode(row.bytes))).includes(map().title));assert.equal(result.content.filter(row=>row.domain==='attachment').length,0);
});

test('clean old cache remains history while equal/newer divergent cache or an unexplained orphan requires exact review',async()=>{
 const f=await fixture();await f.server(map(),3);f.cache([await f.seal(map('private-map',{title:'Previous cached version'}),'map:private-map',{revision:2})]);
 assert.equal((await readers(await f.run()).read()).records[0].document.title,map().title);
 f.cache([await f.seal(map('private-map',{title:'Other current version'}),'map:private-map',{revision:3})]);await assert.rejects(f.run(),/CONFLICT_REVIEW_REQUIRED/);
 f.ports.review=async conflicts=>{assert.equal(conflicts.length,1);return{'private-map':'cache'};};assert.equal((await readers(await f.run()).read()).records[0].document.title,'Other current version');
 for(const value of [{},{'private-map':'missing'},{'private-map':'server',extra:'cache'}]){f.ports.review=async()=>value;await assert.rejects(f.run(),/CONFLICT_REVIEW_REQUIRED/);}
 const orphan=await fixture();orphan.cache([await orphan.seal(map())]);await assert.rejects(orphan.run(),/CONFLICT_REVIEW_REQUIRED/);
 orphan.ports.review=async()=>({'private-map':'server-absence'});assert.equal((await readers(await orphan.run()).read()).records[0].deleted,true);
});

test('native dirty/current/pending plaintext variants survive without exporting old keys or executing saved requests',async()=>{
 const f=await fixture(),old=map('native',{title:'Earlier uncertain upload'}),newer=map('native',{title:'More recent unsent edit'}),sealed=await f.seal(old);
 const pending={schemaVersion:2,expectedRevision:4,operationId:'native-request',iv:sealed.iv,ciphertext:sealed.ciphertext};
 f.memory.records=[{document:newer,revision:4,pending,pendingDocument:old,dirty:true,source:'room:native'}];
 const result=await f.run(),read=await readers(result).read();assert.deepEqual(read.records,[]);assert.deepEqual(read.local.drafts[0].document,newer);assert.deepEqual(read.local.drafts[0].pendingDocument,old);
 assert.ok(!JSON.stringify(result.content.filter(row=>row.domain==='mindmap').map(row=>decode(row.bytes))).includes('More recent unsent edit'));
});

test('actual repository retains encrypted failed-save drafts and captures its registered blank editor without migration HTTP',async()=>{
 const tab=await cloudSyncClient({userId:'owner'}),storage=new MemoryStorage();let requests=0;
 tab.respond(async()=>{requests++;throw new Error('Synthetic network unavailable');});
 const repository=new MindmapRepository('owner',undefined,{storage,access:tab.client.personalDocumentAccess('owner')});
 await assert.rejects(repository.save(map('actual',{title:'Actual failed save'}),()=>{}),/Synthetic network unavailable/);
 let editor={document:null,revision:0,state:{title:'Not-yet-created map'}};const close=repository.registerMigrationEditor(()=>editor),count=requests,before=[...storage.data];
 const source=await tab.client.createPersonalMindmapsMigrationSource('owner','personal:owner',{legacyMindmapsPage(){throw new Error('Premature source IO');}},()=>repository.captureMigration([]));
 let capture=decode(await source.captureLocal());assert.equal(capture.memory.editors[0].state.title,'Not-yet-created map');editor={...editor,state:{title:'Latest title'}};
 capture=decode(await source.captureLocal());assert.equal(capture.memory.editors[0].state.title,'Latest title');assert.equal(requests,count);assert.deepEqual([...storage.data],before);
 const f=await fixture(tab.key);f.ports.storage=storage;f.memory.editors=repository.captureMigration([]).editors;
 const read=await readers(await f.run()).read();assert.equal(read.local.drafts.length,2);assert.equal(read.local.drafts[0].document.title,'Actual failed save');assert.equal(requests,count);
 close();assert.deepEqual(repository.captureMigration([]).editors,[]);repository.dispose();assert.throws(()=>repository.captureMigration([]),/Сессия карт закрыта/);
});

test('duplicate decoded JSON fields, malformed graph/envelope/image, unknown future fields and wrong AAD refuse without cleanup',async()=>{
 for(const kind of ['duplicate','cipher','id','schema','unknown-slot','unknown-field','duplicate-cache']){
  const f=await fixture(),value=map(),raw=kind==='duplicate'?JSON.stringify(value).replace('"title":','"t\\u0069tle":"Original hidden title","title":'):JSON.stringify(value);
  if(kind==='unknown-field')value.futurePrivate='retain or refuse';const row=await f.seal(value,kind==='id'?'map:other':'map:private-map',{},kind==='unknown-field'?JSON.stringify(value):raw);
  if(kind==='cipher')row.ciphertext=row.ciphertext.slice(0,-4)+'AAAA';if(kind==='schema')row.schemaVersion=3;
  if(kind==='unknown-slot')f.storage.setItem(prefix+'future-private-slot','Never omit');else f.cache(kind==='duplicate-cache'?[row,row]:[row]);const before=[...f.storage.data];
  await assert.rejects(f.run(),/E2EE_/);assert.deepEqual([...f.storage.data],before);
 }
 assert.throws(()=>parseMindmapsMigrationJson('{"x":{"a":1,"\\u0061":2}}'),/MINDMAPS_SOURCE_INVALID/);
});

test('owner/lease/generation mismatches and changed protected attempts block before a partial migration can succeed',async()=>{
 for(const change of [f=>f.remote.ownerId='foreign',f=>f.remote.sourceHash='B'.repeat(43),f=>f.remote.fence++,f=>f.remote.legacyGeneration++,f=>f.memory.reconciliationRequired=true,f=>f.remote.maps=[{}]]){
  const f=await fixture();change(f);await assert.rejects(f.run(),/E2EE_/);
 }
 const f=await fixture(),old=await f.capture();f.memory.editors=[{source:'new',document:null,revision:0,state:{title:'New private work'}}];await assert.rejects(f.run([old]),/HISTORY_REVIEW_REQUIRED/);assert.equal(f.calls,0);
 const g=await fixture();g.ports.legacyMindmaps=async()=>{g.lock();return g.remote;};await assert.rejects(g.run(),/ACCOUNT_CHANGED/);
});

test('conflicting same-revision or future server history cannot silently override its current authoritative map',async()=>{
 for(const revision of [3,4]){const f=await fixture();await f.server(map(),3);await f.server(map('private-map',{title:'Inconsistent retained server history'}),revision,true);
  const before=structuredClone(f.remote);await assert.rejects(f.run(),/HISTORY_REVIEW_REQUIRED/);assert.deepEqual(f.remote,before);
 }
});

test('cold read refuses missing local content, missing/swapped images, foreign owner and corrupt selection',async()=>{
 const f=await fixture();await f.server(map());const result=await f.run(),r=readers(result),file=result.content.find(row=>row.domain==='attachment');
 r.remote.delete(file.objectId);await assert.rejects(r.read(),/ATTACHMENT_REQUIRED/);r.remote.set(file.objectId,{...file,mediaType:'image/jpeg'});await assert.rejects(r.read(),/SOURCE_INVALID/);r.remote.set(file.objectId,file);
 const local=r.local.get('personal-mindmap-local-work-v1');r.local.delete('personal-mindmap-local-work-v1');await assert.rejects(r.read(),/LOCAL_CONTENT_REQUIRED/);r.local.set('personal-mindmap-local-work-v1',local);
 const index=r.remote.get('personal-mindmap-index-v1'),other=decode(index.bytes);other.ownerId='foreign';r.remote.set(index.objectId,{...index,bytes:new TextEncoder().encode(JSON.stringify(other))});await assert.rejects(r.read(),/BINDING_MISMATCH/);
});

function nativeFixture(){return{protocol:1,ownerId:'owner',scopeId:context.scopeId,capturedAt:NOW,generation:0,pendingGeneration:null,
 documents:[{kind:'mindmaps',revision:1,encrypted:'exact-native-ciphertext'},{kind:'mindmap-view:private-map',revision:1,encrypted:'exact-view-ciphertext'},{kind:'mindmap-conversion',revision:0,encrypted:'exact-conversion-ciphertext'}],
 caches:[{kind:'mindmaps',plain:JSON.stringify([{document:map(),revision:1,pending:null,pendingDocument:null,dirty:false}])},
  {kind:'mindmap-view:private-map',plain:'{ "mode":"map", "zoom":1.2 }'},{kind:'mindmap-conversion',plain:'{ "title":"Unsent native conversion" }'}],mounted:null,
 memory:{ownerId:'owner',legacyKey:'',generation:0,reconciliationRequired:false,records:[],editors:[],localWork:[]}};}
test('raw native maps/views/conversion originals become lossless local work with no native key bridge',async()=>{
 const input=nativeFixture(),normalized=normalizeNativeMindmapsCapture(input,()=>{});assert.equal(normalized.snapshot.memory.legacyKey,'');assert.equal(normalized.snapshot.memory.records.length,1);
 assert.equal(normalized.snapshot.memory.localWork.length,2);assert.deepEqual(normalized.metadata.caches,input.caches);assert.equal(normalized.snapshot.memory.records[0].source,'room:private-map');
 const f=await fixture();await f.server(map());f.remote.legacyKey.key=null;f.ports.openLegacy=async()=>JSON.stringify(map());await f.capture();
 const result=await f.source.reconcile(new TextEncoder().encode(JSON.stringify(normalized.snapshot)),[],context),read=await readers(result).read();assert.deepEqual(read.records[0].document,map());assert.equal(read.local.conversions[0].value.title,'Unsent native conversion');
});
test('duplicate raw native graph fields, missing view bytes, unknown rows, foreign owner and pending generation refuse safely',()=>{
 for(const change of [f=>f.caches[0].plain=f.caches[0].plain.replace('"title":','"title":"hidden","t\\u0069tle":'),f=>f.caches.pop(),f=>f.documents.push({kind:'mindmap-private-future',revision:1,encrypted:'retained'}),
  f=>f.ownerId='foreign',f=>f.pendingGeneration=1,f=>f.caches.push({...f.caches[0]})]){const input=nativeFixture();change(input);assert.throws(()=>normalizeNativeMindmapsCapture(input,()=>{}),/E2EE_/);}
});
