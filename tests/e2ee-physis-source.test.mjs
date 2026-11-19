import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {calendarModule} from './helpers/calendar-modules.mjs';
import {physisModules,settingsRecord} from './physis-test-loader.mjs';
const {PersonalPhysisSource,readMigratedPhysis}=calendarModule('app/e2ee/physis-source.ts');
const {normalizeNativePhysisCapture}=calendarModule('app/e2ee/physis-native-source.ts');
const {canonicalJson}=calendarModule('app/aurora/forecast.ts');
const crypt=calendarModule('app/physis/crypto.ts'),NOW='2026-11-19T15:00:00Z';
const context={ownerId:'owner',scopeId:'personal:owner',migrationId:'physis-migration',fence:7,sourceHash:'A'.repeat(43),generation:2};
const encode=value=>new TextEncoder().encode(JSON.stringify(value)),decode=bytes=>JSON.parse(new TextDecoder().decode(bytes));
const generate=()=>crypto.subtle.generateKey({name:'AES-GCM',length:256},true,['encrypt','decrypt']);
const b64=bytes=>Buffer.from(bytes).toString('base64');
async function fixture(version=2){
 const account=await generate(),accountRaw=b64(await crypto.subtle.exportKey('raw',account)),access={seal:async(value,purpose)=>{
  const iv=crypto.getRandomValues(new Uint8Array(12)),cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(`genesis-mindmap-v1:owner:${purpose}`)},account,encode(value));
  return{iv:b64(iv),ciphertext:b64(cipher)};
 }};
 const unlocked=version===1?await crypt.createPhysisVault('owner','synthetic old password'):await crypt.accountPhysisVault(access),{key,vault}=unlocked;
 const memory={ownerId:'owner',generation:0,reconciliationRequired:false,legacyKey:accountRaw,stores:[]};
 const remote={protocol:1,ownerId:'owner',scopeId:context.scopeId,migrationId:context.migrationId,fence:7,sourceHash:context.sourceHash,legacyGeneration:0,checkpointHash:'A'.repeat(43),directoryRevision:1,
  owners:[{current_cursor:0,min_cursor:0,vault_json:JSON.stringify(vault),vault_revision:1,key_version:1}],records:[],usedIds:[],receipts:[],legacyKey:{keyMode:version===2?'account':'empty',key:version===2?accountRaw:null}};
 let captured=false,calls=0,live=true;const ports={memory:async()=>structuredClone(memory),assertCurrent:()=>{if(!live)throw new Error('E2EE_ACCOUNT_CHANGED');},
  legacyPhysis:async value=>{assert.ok(captured,'remote source read before local capture');assert.deepEqual(value,context);calls++;return structuredClone(remote);}};
 const source=new PersonalPhysisSource('owner',context.scopeId,ports);
 return{account,access,key,vault,unlocked,memory,remote,ports,source,lock(){live=false;},get calls(){return calls;},
  async add(record=settingsRecord(),revision=1,dataKey=key,keyVersion=1){const sequence=++remote.owners[0].current_cursor;
   remote.records.push({id:record.id,revision,sequence,envelope_json:JSON.stringify(await crypt.sealPhysis(dataKey,'owner',record.id,keyVersion,record)),updated_at:NOW,deleted_at:null});
   remote.usedIds.push({id:record.id});return record;},
  async capture(){const value=await source.captureLocal();captured=true;return value;},async run(previous=[]){return source.reconcile(await this.capture(),previous,context);},
  async model(){const modules=physisModules(),rows=()=>remote.records.map(row=>({id:row.id,revision:row.revision,sequence:row.sequence,envelope:row.envelope_json===null?null:JSON.parse(row.envelope_json),updatedAt:row.updated_at,deletedAt:row.deleted_at}));
   const writes=[];const transport=async(path,init)=>{if(path.startsWith('/records?'))return{records:rows(),cursor:remote.owners[0].current_cursor,minCursor:0,snapshot:remote.owners[0].current_cursor,hasMore:false};
    writes.push({path,text:init.body});throw new TypeError('synthetic lost response');};
   const model=new(modules.store().PhysisMemoryStore)('owner',key,1,transport,ports.assertCurrent);await model.reload();
   ports.memory=async()=>({...structuredClone(memory),stores:[{vault:structuredClone(vault),state:await model.captureMigrationMemory()}]});return{model,writes};
  }};
}
function readers(result){const remote=new Map(result.content.map(row=>[row.objectId,row])),local=new Map(result.localContent.map(row=>[row.objectId,row]));return{
 remote,local,read:()=>readMigratedPhysis(async(_,id)=>decode(remote.get(id).bytes),async(_,id)=>local.has(id)?new Uint8Array(local.get(id).bytes):null,'owner')};}
function wire(result){return JSON.stringify(result.content.map(row=>decode(row.bytes)));}

test('Physis source preserves original record fields, references and explicit empty/deletion state under opaque object IDs',async()=>{
 const f=await fixture(),original=settingsRecord();original.privateOptional={empty:[],note:'Личная запись 🌓',reference:'original-task'};await f.add(original,9);
 const deleted=crypto.randomUUID(),pruned=crypto.randomUUID();f.remote.records.push({id:deleted,revision:3,sequence:++f.remote.owners[0].current_cursor,envelope_json:null,updated_at:NOW,deleted_at:NOW});
 f.remote.usedIds.push({id:deleted},{id:pruned});f.remote.records[0].sequence=2;f.remote.records[1].sequence=3;
 f.remote.owners[0].current_cursor=3;f.remote.owners[0].min_cursor=1;
 const before=structuredClone(f.remote),result=await f.run(),read=await readers(result).read();
 assert.equal(result.complete,true);assert.deepEqual(read.records.find(row=>row.id===original.id).record,original);
 assert.equal(read.records.find(row=>row.id===deleted).deleted,true);assert.equal(read.records.find(row=>row.id===pruned).deleted,true);
 assert.ok(result.content.every(row=>row.domain==='physis'&&!row.objectId.includes(original.id)));
 assert.ok(!wire(result).includes(f.memory.legacyKey)&&!wire(result).includes(f.remote.records[0].envelope_json));assert.deepEqual(f.remote,before);
 const empty=await fixture();empty.remote.owners=[];empty.remote.legacyKey={keyMode:'empty',key:null};const emptyRead=await readers(await empty.run()).read();assert.deepEqual(emptyRead.records,[]);
});

test('independent password/recovery Physis vaults remain locked until their own authority opens them, including an empty vault',async()=>{
 const f=await fixture(1);await f.add();await assert.rejects(f.run(),/E2EE_PHYSIS_UNLOCK_REQUIRED/);
 f.ports.independentUnlock=async()=>({method:'password',secret:'wrong synthetic password'});await assert.rejects(f.run(),/E2EE_PHYSIS_UNLOCK_REQUIRED/);
 f.ports.independentUnlock=async()=>null;await assert.rejects(f.run(),/E2EE_PHYSIS_UNLOCK_REQUIRED/);
 f.ports.independentUnlock=async()=>({method:'recovery',secret:f.unlocked.recovery});assert.equal((await readers(await f.run()).read()).records.length,1);
 const empty=await fixture(1);await assert.rejects(empty.run(),/E2EE_PHYSIS_UNLOCK_REQUIRED/);
 empty.ports.independentUnlock=async()=>({method:'password',secret:'synthetic old password'});assert.equal((await empty.run()).complete,true);
});

test('an uncertain save preserves its exact request, both record versions and detached drafts without replay',async()=>{
 const f=await fixture(),original=await f.add(),{model,writes}=await f.model(),edited={...original,data:{...original.data,restSeconds:147}};
 await assert.rejects(model.getSnapshot().save(edited));let draft={amount:'1,',text:'Private unsent form'};const detach=model.registerMigrationEditor(()=>draft);detach();draft.text='later';
 await assert.rejects(f.run(),/E2EE_PHYSIS_CONFLICT_REVIEW_REQUIRED/);
 f.ports.review=async conflicts=>{assert.equal(conflicts.length,1);return{[original.id]:'store:0:current'};};const before=writes.length,result=await f.run(),read=await readers(result).read();
 assert.equal(writes.length,before);assert.deepEqual(read.records[0].record,edited);assert.equal(read.local.stores[0].pending[0].requestId,JSON.parse(writes[0].text).requestId);
 assert.equal(read.local.stores[0].pending[0].changes[0].envelope.ciphertext,JSON.parse(writes[0].text).changes[0].envelope.ciphertext);
 assert.equal(read.local.stores[0].editors[0].value.text,'Private unsent form');assert.equal(read.local.stores[0].editors[0].mounted,false);
 assert.ok(read.local.variants[0].variants.some(row=>row.source==='server'&&row.record.data.restSeconds===90));
 const localText=JSON.stringify(read.local);assert.ok(!localText.includes((await model.captureMigrationMemory()).key));assert.ok(!wire(result).includes('Private unsent form'));model.destroy();
});

test('lost rotation response can be reconciled after old memory is destroyed, with exact receipt and both generations authenticated',async()=>{
 const f=await fixture(),original=await f.add(),{model,writes}=await f.model(),next=await crypt.accountPhysisVault(f.access,2);
 await assert.rejects(model.rotate(next.key,next.vault,1));const request=JSON.parse(writes[0].text),snapshot=await f.capture();model.destroy();
 f.remote.owners[0]={current_cursor:3,min_cursor:0,vault_json:JSON.stringify(next.vault),vault_revision:2,key_version:2};
 f.remote.records[0]={...f.remote.records[0],revision:2,sequence:2,envelope_json:JSON.stringify(request.records[0].envelope)};
 const hash=createHash('sha256').update('rotate\0'+canonicalJson(request)).digest('hex');
 f.remote.receipts=[{request_id:request.requestId,payload_hash:hash,response_json:JSON.stringify({revision:2,cursor:3,keyVersion:2}),created_at:NOW}];
 f.remote.legacyKey={keyMode:'empty',key:null};f.memory.legacyKey='';
 const result=await f.source.reconcile(snapshot,[],context),read=await readers(result).read();assert.deepEqual(read.records[0].record,original);
 assert.deepEqual(read.local.stores[0].rotation.decoded[0].record,original);assert.equal(read.local.stores[0].rotation.payload,writes[0].text);assert.equal(read.local.stores[0].rotation.uncertain,true);
 const old=decode(snapshot).memory.stores[0].state;assert.ok(!JSON.stringify(read.local).includes(old.key)&&!JSON.stringify(read.local).includes(old.rotation.key));
 f.remote.receipts[0].payload_hash='f'.repeat(64);await assert.rejects(f.source.reconcile(snapshot,[],context),/E2EE_PHYSIS_RECEIPT_CONFLICT/);
});

test('authoritative deletion never silently revives a clean stale cache, and dirty disagreement requires exact choices',async()=>{
 const f=await fixture(),original=await f.add(),{model}=await f.model();f.remote.records[0]={...f.remote.records[0],revision:2,sequence:2,envelope_json:null,deleted_at:NOW};f.remote.owners[0].current_cursor=2;
 assert.equal((await readers(await f.run()).read()).records[0].deleted,true);
 const edited={...original,data:{...original.data,restSeconds:222}};await assert.rejects(model.getSnapshot().save(edited));await assert.rejects(f.run(),/CONFLICT_REVIEW_REQUIRED/);
 for(const choices of [{},{[original.id]:'missing'},{[original.id]:'server',extra:'server'}]){f.ports.review=async()=>choices;await assert.rejects(f.run(),/CONFLICT_REVIEW_REQUIRED/);}
 f.ports.review=async()=>({[original.id]:'server'});const read=await readers(await f.run()).read();assert.equal(read.records[0].deleted,true);assert.equal(read.local.stores[0].records[0].data.restSeconds,222);model.destroy();
});

test('malformed, duplicate, mixed-owner/generation and missing retained Physis data refuse completeness',async()=>{
 const variants=[
  f=>{f.remote.owners[0].vault_json=f.remote.owners[0].vault_json.replace('"version":2','"version":2,"versi\\u006fn":2');},
  f=>{f.remote.records[0].envelope_json=f.remote.records[0].envelope_json.replace('"version":1','"version":1,"version":1');},
  f=>{f.remote.records[0].envelope_json='null';},f=>{f.remote.records[0].extra='unrecognized';},
  f=>{f.remote.usedIds=[];},f=>{f.remote.usedIds.push({...f.remote.usedIds[0]});},
  f=>{f.remote.owners[0].current_cursor=0;},f=>{f.remote.owners[0].key_version=2;},
  f=>{f.remote.ownerId='other';},f=>{f.remote.legacyGeneration=1;},f=>{f.remote.owners=[];},
  f=>{f.memory.reconciliationRequired=true;},f=>{f.memory.legacyKey='';f.remote.legacyKey={keyMode:'client',key:null};},
 ];
 for(const mutate of variants){const f=await fixture();await f.add();mutate(f);await assert.rejects(f.run());}
 const corrupt=await fixture();await corrupt.add();const envelope=JSON.parse(corrupt.remote.records[0].envelope_json);envelope.ciphertext='A'+envelope.ciphertext.slice(1);corrupt.remote.records[0].envelope_json=JSON.stringify(envelope);await assert.rejects(corrupt.run(),/E2EE_LEGACY_PHYSIS_CORRUPT/);
});

test('native opening port sees validated originals and raw decrypted duplicates are rejected before schema projection',async()=>{
 const f=await fixture();const original=await f.add();f.memory.legacyKey='';f.remote.legacyKey={keyMode:'account',key:null};let opens=0;
 f.ports.openVault=async vault=>{assert.deepEqual(vault,f.vault);opens++;return async(id,envelope)=>{assert.equal(id,original.id);assert.deepEqual(envelope,JSON.parse(f.remote.records[0].envelope_json));return JSON.stringify(original);};};
 assert.equal((await f.run()).complete,true);assert.equal(opens,1);
 f.ports.openVault=async()=>async()=>JSON.stringify(original).replace('"schemaVersion":1','"schemaVersion":1,"schemaVersion":1');await assert.rejects(f.run(),/E2EE_PHYSIS_SOURCE_INVALID/);
 f.remote.owners[0].vault_json=f.remote.owners[0].vault_json.replace('"version":2','"version":2,"version":2');const before=opens;await assert.rejects(f.run());assert.equal(opens,before);
});

test('snapshot divergence, account loss and local readback corruption cannot become empty Physis',async()=>{
 const f=await fixture(),old=await f.capture();f.memory.generation=1;await assert.rejects(f.run([old]),/HISTORY_REVIEW_REQUIRED/);
 const ended=await fixture(),snapshot=await ended.capture();ended.ports.legacyPhysis=async()=>{ended.lock();return ended.remote;};await assert.rejects(ended.source.reconcile(snapshot,[],context),/ACCOUNT_CHANGED/);
 const good=await fixture();await good.add();const result=await good.run(),read=readers(result);read.remote.get('personal-physis-index-v1').bytes=encode({protocol:1,ownerId:'other',records:[]});await assert.rejects(read.read(),/SCOPE_BINDING_MISMATCH/);
 const missing=readers(await good.run());missing.local.clear();await assert.rejects(missing.read(),/LOCAL_CONTENT_REQUIRED/);
});

test('explicit native local inventory retains wrapper metadata without declaring remote Physis empty or accepting raw key bridges',()=>{
 const input={protocol:1,ownerId:'owner',scopeId:context.scopeId,capturedAt:NOW,generation:0,pendingGeneration:null,
  documents:[{kind:'aurora-account-key',revision:1,encrypted:'exact-native-wrapper'}],memory:{ownerId:'owner',generation:0,reconciliationRequired:false,legacyKey:'',stores:[]}};
 const normalized=normalizeNativePhysisCapture(input,()=>{});assert.equal(normalized.metadata.localRepository,'unavailable');assert.equal(normalized.snapshot.memory.stores.length,0);
 assert.equal(normalized.metadata.documents[0].encrypted,'exact-native-wrapper');
 for(const mutate of [value=>{value.documents[0].plain='raw-old-key';},value=>{value.documents[0].kind='physis-future';},value=>{value.memory.legacyKey='raw-old-key';},value=>{value.pendingGeneration=1;}]){
  const bad=structuredClone(input);mutate(bad);assert.throws(()=>normalizeNativePhysisCapture(bad,()=>{}));
 }
});

test('a used ID without a retained record or any pruning checkpoint must not silently become an empty deletion',async()=>{
 const f=await fixture();await f.add();f.remote.usedIds.push({id:crypto.randomUUID()});
 await assert.rejects(f.run(),/E2EE_PHYSIS_SOURCE_INVALID/);
});
