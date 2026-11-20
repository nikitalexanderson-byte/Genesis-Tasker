import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {ProtectedMigrationContentPlan,openMigrationContentPlan} from '../app/e2ee/content-plan.ts';
import {UnlockedE2eeVault} from '../app/e2ee/storage.ts';
import {freshSecret,generateDeviceKeys} from '../app/e2ee/keys.ts';
import {E2EE_SUITE,encodeE2eeBytes,importE2eeRoot} from '../app/e2ee/envelope.ts';
import {E2EE_CHUNK_BYTES,openE2eeFileStream} from '../app/e2ee/files.ts';
import {openMigrationLocalContent} from '../app/e2ee/migration-local.ts';
import {requiredPrivatePaths} from '../app/e2ee/migration-sources.ts';
import {parseE2eeContentPlanJson,parseE2eeFileManifestJson} from '../app/e2ee/file-manifest-json.ts';

class Memory {
 rows=new Map();writes=0;beforeCommit;
 async get(key){return structuredClone(this.rows.get(key)??null);}
 async list(prefix){return [...this.rows.keys()].filter(key=>key.startsWith(prefix));}
 async commit(changes,signal){
  await this.beforeCommit?.(changes);if(signal?.aborted)throw new Error('E2EE_UNLOCK_REQUIRED');
  for(const row of changes)assert.equal(this.rows.get(row.key)?.serial??null,row.expected);
  const next=new Map(this.rows);for(const row of changes)if(row.value===null)next.delete(row.key);else next.set(row.key,structuredClone(row.value));this.rows=next;this.writes++;
 }
}
const digest=async bytes=>encodeE2eeBytes(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)));
function source(bytes,late){return(async function*(){try{for(let at=0;at<bytes.length;at+=65536){const part=bytes.slice(at,at+65536);try{yield part;}finally{part.fill(0);}}if(late)throw new Error(late);}finally{/* Source retains its own original. */}})();}
async function fixture(kind='personal'){
 const storage=new Memory(),keys=await generateDeviceKeys(),raw=freshSecret(),root=await importE2eeRoot(raw);raw.fill(0);
 const vault=new UnlockedE2eeVault(storage,{ownerId:'actor-owner',scopeId:'device:content-plan',deviceId:'plan-device',generation:1,cryptoEpoch:1,securityEpoch:1,keyId:'local-root',
  signingKey:keys.signing.privateKey,roots:new Map([['local-root',root]]),trustedSigner:id=>id==='plan-device'?keys.signing.publicKey:undefined});
 const context={cryptoProtocol:1,suite:E2EE_SUITE,ownerId:'content-owner',scopeId:kind+':content-plan',domain:'workspace',objectId:'plan-context',schemaVersion:1,
  dataGeneration:2,writerProtocol:9,cryptoEpoch:1,securityEpoch:1,revision:1,keyId:'content-root',deviceId:'plan-device',operationId:crypto.randomUUID()};
 let live=true,sourceComplete=true;
 const options={vault,root,signingKey:keys.signing.privateKey,signer:keys.signing.publicKey,context,target:{ownerId:context.ownerId,scopeId:context.scopeId,kind},
  migrationId:crypto.randomUUID(),sourceHash:await digest(new Uint8Array([7])),paths:requiredPrivatePaths(kind).map(path=>path.id),
  capacity:{maximumBytes:128*1024*1024,maximumEnvelopes:8000,maximumLocalParts:8000},admit:async()=>{},ensureDurableKeys:async()=>{},
  assertCurrent:()=>{if(!live)throw new Error('E2EE_ACCOUNT_CHANGED');},assertSourceComplete:async()=>{if(!sourceComplete)throw new Error('E2EE_SOURCE_STAGE_EOF_REQUIRED');}};
 const coverage=options.paths.map(domain=>({domain,complete:true}));
 return{storage,vault,root,keys,options,coverage,retire:()=>{live=false;},incomplete:()=>{sourceComplete=false;}};
}
const record=(bytes,objectId='record',placement='remote')=>({placement,domain:'workspace',objectId,size:bytes.length,source:source(bytes),filename:'\ufeff\ud800-\udfff-α',mediaType:'application/json'});
const reopen=(f,reference)=>openMigrationContentPlan({...f.options,reference});
async function envelope(vault,id){const row=await vault.read('outbox',id);assert.ok(row);try{return JSON.parse(new TextDecoder().decode(row.value));}finally{row.value.fill(0);}}

test('content plan encrypts records as bounded streams and publishes only after complete remote/local readback',async()=>{
 const f=await fixture(),stage=await ProtectedMigrationContentPlan.create(f.options),bytes=new Uint8Array(E2EE_CHUNK_BYTES*3+17);for(let i=0;i<bytes.length;i++)bytes[i]=(i*37)&255;
 await stage.append('personal.workspace',record(bytes));const local=new Uint8Array([9,8,7]);await stage.append('personal.local-work',record(local,'local-record','local'));
 const ref=await stage.finish(f.coverage),writes=f.storage.writes,opened=await reopen(f,ref);
 assert.equal(f.storage.writes,writes);assert.equal(opened.attemptId,ref.attemptId);assert.equal(opened.plan.length,5);assert.equal(opened.logical.length,1);assert.equal(opened.local.length,1);
 assert.equal(opened.logical[0].plaintextHash,await digest(bytes));assert.ok(Object.isFrozen(opened)&&Object.isFrozen(opened.plan));
 const manifest=await envelope(f.vault,opened.logical[0].manifestRecordId),lookup=new Map(opened.plan.map(row=>[row.objectId,row.recordId]));let at=0,borrowed;
 const metadata=await openE2eeFileStream({root:f.root,signer:f.keys.signing.publicKey,expectedContext:manifest.context,manifestEnvelope:manifest,
  fetchChunk:id=>envelope(f.vault,lookup.get(id)),assertCurrent:f.options.assertCurrent,writeQuarantinedPlaintext:async part=>{assert.deepEqual(part,bytes.subarray(at,at+part.length));at+=part.length;borrowed=part;}});
 assert.equal(at,bytes.length);assert.equal(metadata.filename,'\ufeff\ud800-\udfff-α');assert.ok(borrowed.every(value=>value===0));
 const saved=await openMigrationLocalContent(f.vault,opened.local[0]);try{assert.deepEqual(saved.bytes,local);}finally{saved.bytes.fill(0);}
 bytes.fill(0);local.fill(0);
});
test('late source authentication failure preserves inert encrypted prefixes and never returns a complete plan',async()=>{
 const f=await fixture(),stage=await ProtectedMigrationContentPlan.create(f.options),bytes=new Uint8Array(E2EE_CHUNK_BYTES+1).fill(31);
 await assert.rejects(stage.append('personal.workspace',{...record(bytes),source:source(bytes,'E2EE_OLD_TAG_INVALID')}),/OLD_TAG_INVALID/);
 assert.ok(f.storage.rows.size>1);await assert.rejects(stage.finish(f.coverage),/E2EE_/);assert.ok(bytes.every(value=>value===31));bytes.fill(0);
});
test('quota refusal retains protected originals and no partial attempt becomes a complete source',async()=>{
 const f=await fixture(),original=new Uint8Array([3,2,1]);await f.vault.write([{domain:'local-snapshot',objectId:'original-source',value:original,expected:null}]);
 const before=structuredClone(f.storage.rows);let admitted=0;f.options.admit=async()=>{if(++admitted===3)throw new Error('E2EE_NO_SPACE');};
 const stage=await ProtectedMigrationContentPlan.create(f.options),bytes=new Uint8Array(E2EE_CHUNK_BYTES*2).fill(5);
 await assert.rejects(stage.append('personal.workspace',record(bytes)),/NO_SPACE/);await assert.rejects(stage.finish(f.coverage),/E2EE_/);
 for(const[key,row]of before)assert.deepEqual(f.storage.rows.get(key),row);bytes.fill(0);
});
test('missing or duplicate coverage and incomplete original input block final publication',async()=>{
 for(const mode of ['missing','duplicate','original']){
  const f=await fixture(),stage=await ProtectedMigrationContentPlan.create(f.options);await stage.append('personal.workspace',record(new Uint8Array([1])));
  if(mode==='original')f.incomplete();const coverage=mode==='missing'?f.coverage.slice(0,1):mode==='duplicate'?[...f.coverage,f.coverage[0]]:f.coverage;
  await assert.rejects(stage.finish(coverage),/E2EE_/);
 }
});
test('actor retirement and late encrypted corruption cannot produce an authenticated plan',async()=>{
 const f=await fixture(),stage=await ProtectedMigrationContentPlan.create(f.options),bytes=new Uint8Array(E2EE_CHUNK_BYTES+1).fill(2);
 await stage.append('personal.workspace',record(bytes));const ref=await stage.finish(f.coverage),opened=await reopen(f,ref),last=opened.plan[opened.plan.length-2];
 const key=[...f.storage.rows.keys()].find(key=>key.endsWith(last.recordId));assert.ok(key);const row=f.storage.rows.get(key);row.envelope.ciphertext=(row.envelope.ciphertext[0]==='A'?'B':'A')+row.envelope.ciphertext.slice(1);
 await assert.rejects(reopen(f,ref),/E2EE_/);f.retire();await assert.rejects(reopen(f,ref),/ACCOUNT_CHANGED/);bytes.fill(0);
});
test('record admission refuses wrong paths domains duplicate identities and oversized comments before opening the new source',async()=>{
 const f=await fixture(),stage=await ProtectedMigrationContentPlan.create(f.options);await stage.append('personal.workspace',record(new Uint8Array([1])));
 for(const changed of [{path:'project.content'},{domain:'shared-project'},{objectId:'record'},{domain:'shared-comment',objectId:'comment',size:65537}]){
  let reads=0;const entry={...record(new Uint8Array([2]),'different'),...changed,source:{async *[Symbol.asyncIterator](){reads++;yield new Uint8Array([2]);}}};
  await assert.rejects(stage.append(changed.path??'personal.workspace',entry),/E2EE_/);assert.equal(reads,0);
 }
});
test('full registry is required before durable keys or initial storage mutation',async()=>{
 const f=await fixture();let keys=0;f.options.ensureDurableKeys=async()=>{keys++;};
 await assert.rejects(ProtectedMigrationContentPlan.create({...f.options,paths:f.options.paths.slice(1)}),/SOURCE_ADAPTER_REQUIRED/);assert.equal(keys,0);assert.equal(f.storage.writes,0);
});
test('record metadata and iterator callbacks are captured before capacity awaits',async()=>{
 const f=await fixture(),stage=await ProtectedMigrationContentPlan.create(f.options);let release,hit;const reached=new Promise(resolve=>{hit=resolve;});
 f.storage.beforeCommit=async()=>{f.storage.beforeCommit=undefined;hit();await new Promise(resolve=>{release=resolve;});};
 let at=0;const iterator={async next(){return at++===0?{done:false,value:new Uint8Array([4,5])}:{done:true};},async return(){return{done:true};}};
 const item={...record(new Uint8Array([4,5])),source:{[Symbol.asyncIterator]:()=>iterator}},pending=stage.append('personal.workspace',item);await reached;
 iterator.next=async()=>{throw new Error('REPLACED_PULL');};item.objectId='replaced';item.filename='replaced';release();await pending;
 const opened=await reopen(f,await stage.finish(f.coverage));assert.equal(opened.logical[0].objectId,'record');assert.equal(opened.logical[0].size,2);
});
test('an in-flight append bounds concurrency and actor retirement prevents completion',async()=>{
 const f=await fixture(),stage=await ProtectedMigrationContentPlan.create(f.options);let release,hit;const reached=new Promise(resolve=>{hit=resolve;});
 const item={...record(new Uint8Array([7])),source:{async *[Symbol.asyncIterator](){hit();await new Promise(resolve=>{release=resolve;});yield new Uint8Array([7]);}}};
 const pending=stage.append('personal.workspace',item);await reached;await assert.rejects(stage.append('personal.workspace',record(new Uint8Array([8]),'second')),/CONTENT_PLAN_BUSY/);
 f.retire();release();await assert.rejects(pending,/ACCOUNT_CHANGED/);await assert.rejects(stage.finish(f.coverage),/E2EE_/);
});
test('authenticated empty files local empty values and shared comments keep their distinct formats',async()=>{
 const f=await fixture(),stage=await ProtectedMigrationContentPlan.create(f.options);await stage.append('personal.workspace',record(new Uint8Array()));await stage.append('personal.local-work',record(new Uint8Array(),'empty-local','local'));
 const opened=await reopen(f,await stage.finish(f.coverage));assert.equal(opened.plan.length,1);assert.equal(opened.local[0].parts,0);assert.equal(opened.logical[0].plaintextHash,await digest(new Uint8Array()));
 const g=await fixture('project'),other=await ProtectedMigrationContentPlan.create(g.options),bytes=new Uint8Array(65536).fill(3);
 await assert.rejects(other.append('project.content',{placement:'remote',domain:'shared-comment',objectId:'large-comment',size:65537,source:source(bytes)}),/INVALID_SOURCE_RESULT/);
 await other.append('project.content',{placement:'remote',domain:'shared-comment',objectId:'comment',size:bytes.length,source:source(bytes)});
 const accepted=await reopen(g,await other.finish(g.coverage));assert.equal(accepted.plan.length,1);assert.equal(accepted.logical[0].size,65536);bytes.fill(0);
});
test('an extra unbound part under a complete attempt is explicit corruption and is retained',async()=>{
 const f=await fixture(),stage=await ProtectedMigrationContentPlan.create(f.options);await stage.append('personal.workspace',record(new Uint8Array([1])));const reference=await stage.finish(f.coverage);
 await f.vault.write([{domain:'local-snapshot',objectId:reference.attemptId+':private:unknown:0',value:new Uint8Array([2]),expected:null}]);const writes=f.storage.writes;
 await assert.rejects(reopen(f,reference),/CORRUPT_CONTENT_PLAN/);assert.equal(f.storage.writes,writes);
});
test('a source opened before reservation is closed on refusal without hiding the original failure',async()=>{
 for(const throws of [false,true]){
  const f=await fixture();let admits=0,reads=0,closed=0;f.options.admit=async()=>{if(++admits===2)throw new Error('E2EE_NO_SPACE');};const stage=await ProtectedMigrationContentPlan.create(f.options);
  const iterator={async next(){reads++;return{done:true};},async return(){closed++;if(throws)throw new Error('E2EE_SOURCE_CLOSE_FAILED');return{done:true};}};
  await assert.rejects(stage.append('personal.workspace',{...record(new Uint8Array()),source:{[Symbol.asyncIterator]:()=>iterator}}),/E2EE_NO_SPACE/);assert.equal(reads,0);assert.equal(closed,1);
 }
});
test('retirement after an actual metadata read wipes its owned bytes before refusing',async()=>{
 const f=await fixture(),stage=await ProtectedMigrationContentPlan.create(f.options);await stage.append('personal.workspace',record(new Uint8Array([1])));const reference=await stage.finish(f.coverage);let borrowed;
 const port={assertUnlocked:()=>f.vault.assertUnlocked(),localIdentity:()=>f.vault.localIdentity(),listLocal:(...args)=>f.vault.listLocal(...args),async read(...args){const row=await f.vault.read(...args);if(row){borrowed=row.value;f.retire();}return row;}};
 await assert.rejects(openMigrationContentPlan({...f.options,vault:port,reference}),/ACCOUNT_CHANGED/);assert.ok(borrowed.every(value=>value===0));
});
test('a serializer failure also wipes owned local plaintext allocated before journal encoding',async()=>{
 const f=await fixture(),stage=await ProtectedMigrationContentPlan.create(f.options),owned=[],Original=Uint8Array,stringify=JSON.stringify;
 // Observe only newly owned copies of this public synthetic marker. Real
 // typed arrays/crypto still run; the failure is at metadata serialization.
 globalThis.Uint8Array=new Proxy(Original,{construct(target,args){const bytes=Reflect.construct(target,args,target);if(args[0] instanceof Original&&bytes.length===3&&bytes[0]===9&&bytes[1]===8&&bytes[2]===7)owned.push(bytes);return bytes;}});
 JSON.stringify=function(value,...args){if(value?.phase==='writing'&&value.pending?.placement==='local'&&value.pending.parts===1)throw new Error('E2EE_TEST_METADATA_REFUSAL');return Reflect.apply(stringify,JSON,[value,...args]);};
 try{await assert.rejects(stage.append('personal.local-work',record(new Original([9,8,7]),'private-marker','local')),/E2EE_TEST_METADATA_REFUSAL/);}
 finally{globalThis.Uint8Array=Original;JSON.stringify=stringify;}
 assert.ok(owned.length>=2);assert.ok(owned.every(bytes=>bytes.every(value=>value===0)));
});
test('content metadata has a separate strict budget while the original file corpus and limits remain intact',async()=>{
 const corpus=JSON.parse(await readFile(new URL('./fixtures/e2ee/file-manifest-json-v1.json',import.meta.url),'utf8'));
 for(const row of corpus.valid)parseE2eeContentPlanJson(new TextEncoder().encode(row.text));
 for(const row of corpus.invalid)assert.throws(()=>parseE2eeContentPlanJson(row.hex?new Uint8Array(Buffer.from(row.hex,'hex')):new TextEncoder().encode(row.text)),/E2EE_/);
 const big=new TextEncoder().encode('{"rows":['+'0,'.repeat(140000)+'0]}');assert.ok(big.length>256*1024);assert.equal(parseE2eeContentPlanJson(big).rows.length,140001);assert.throws(()=>parseE2eeFileManifestJson(big),/CORRUPT_FILE/);
});
