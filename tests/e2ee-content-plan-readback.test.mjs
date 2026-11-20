import assert from 'node:assert/strict';
import test from 'node:test';
import {ProtectedMigrationContentPlan,openMigrationContentPlan,verifyMigrationContentPlanReadback} from '../app/e2ee/content-plan.ts';
import {UnlockedE2eeVault} from '../app/e2ee/storage.ts';
import {freshSecret,generateDeviceKeys} from '../app/e2ee/keys.ts';
import {E2EE_SUITE,encodeE2eeBytes,importE2eeRoot} from '../app/e2ee/envelope.ts';
import {requiredPrivatePaths} from '../app/e2ee/migration-sources.ts';
import {E2EE_CHUNK_BYTES} from '../app/e2ee/files.ts';

class Memory {
 rows=new Map();writes=0;reads=0;
 async get(key){this.reads++;return structuredClone(this.rows.get(key)??null);}
 async list(prefix){return [...this.rows.keys()].filter(key=>key.startsWith(prefix));}
 async commit(changes,signal){
  assert.ok(!signal?.aborted);for(const row of changes)assert.equal(this.rows.get(row.key)?.serial??null,row.expected);
  for(const row of changes)if(row.value===null)this.rows.delete(row.key);else this.rows.set(row.key,structuredClone(row.value));this.writes++;
 }
}
const digest=async bytes=>encodeE2eeBytes(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)));
const source=bytes=>(async function*(){for(let at=0;at<bytes.length;at+=E2EE_CHUNK_BYTES)yield bytes.subarray(at,at+E2EE_CHUNK_BYTES);})();
async function fixture({localOnly=false,kind='personal'}={}){
 const storage=new Memory(),keys=await generateDeviceKeys(),raw=freshSecret(),root=await importE2eeRoot(raw);raw.fill(0);let live=true;
 const vault=new UnlockedE2eeVault(storage,{ownerId:'actor-owner',scopeId:'device:plan-readback',deviceId:'plan-device',generation:1,cryptoEpoch:1,securityEpoch:1,keyId:'local-root',
  signingKey:keys.signing.privateKey,roots:new Map([['local-root',root]]),trustedSigner:id=>id==='plan-device'?keys.signing.publicKey:undefined});
 const context={cryptoProtocol:1,suite:E2EE_SUITE,ownerId:'content-owner',scopeId:kind+':plan-readback',domain:'workspace',objectId:'plan-context',schemaVersion:1,
  dataGeneration:2,writerProtocol:9,cryptoEpoch:1,securityEpoch:1,revision:1,keyId:'content-root',deviceId:'plan-device',operationId:crypto.randomUUID()};
 const options={vault,root,signingKey:keys.signing.privateKey,signer:keys.signing.publicKey,context,target:{ownerId:context.ownerId,scopeId:context.scopeId,kind},
  migrationId:crypto.randomUUID(),sourceHash:await digest(new Uint8Array([7])),paths:requiredPrivatePaths(kind).map(path=>path.id),capacity:{maximumBytes:128*1024*1024,maximumEnvelopes:8000,maximumLocalParts:8000},
  admit:async()=>{},ensureDurableKeys:async()=>{},assertCurrent:()=>{if(!live)throw new Error('E2EE_ACCOUNT_CHANGED');},assertSourceComplete:async()=>{}};
 const writer=await ProtectedMigrationContentPlan.create(options),bytes=new Uint8Array(E2EE_CHUNK_BYTES*2+17);for(let i=0;i<bytes.length;i++)bytes[i]=(i*37)&255;
 const domain=kind==='project'?'shared-comment':'workspace',path=options.paths[0];
 await writer.append(path,{placement:localOnly?'local':'remote',domain,objectId:'record',size:kind==='project'?3:bytes.length,source:source(kind==='project'?bytes.subarray(0,3):bytes),filename:'α😀',mediaType:'application/json'});
 if(kind==='personal'&&!localOnly)await writer.append('personal.local-work',{placement:'local',domain:'workspace',objectId:'local',size:3,source:source(new Uint8Array([9,8,7]))});
 const reference=await writer.finish(options.paths.map(domain=>({domain,complete:true}))),manifest=await openMigrationContentPlan({...options,reference});
 const values=new Map();for(const item of manifest.plan){const row=await vault.read('outbox',item.recordId);try{values.set(item.domain+'\0'+item.objectId,JSON.parse(new TextDecoder().decode(row.value)));}finally{row.value.fill(0);}}
 let gets=0,walks=0;
 const readback={async forEachEnvelope(consume){walks++;for(const value of values.values())await consume(structuredClone(value));return values.size;},async getEnvelope(domain,id){gets++;return structuredClone(values.get(domain+'\0'+id)??null);}};
 return{storage,vault,options,reference,manifest,values,readback,bytes,retire:()=>{live=false;},counts:()=>({gets,walks}),verify:(port=readback)=>verifyMigrationContentPlanReadback({...options,reference},port)};
}
const flip=value=>(value[0]==='A'?'B':'A')+value.slice(1);

test('full remote inventory and bounded authenticated file digests produce a read-only reference receipt',async()=>{
 const f=await fixture(),before=structuredClone(f.storage.rows),writes=f.storage.writes,result=await f.verify();
 assert.deepEqual(result,{...f.reference,envelopes:4,remoteRecords:1,localRecords:1});assert.ok(Object.isFrozen(result));assert.deepEqual(f.counts(),{gets:4,walks:1});
 assert.equal(f.storage.writes,writes);assert.deepEqual(f.storage.rows,before);assert.ok(f.bytes.some(value=>value));f.bytes.fill(0);
});
test('bounded port preflight refuses missing methods before any local read',async()=>{
 const f=await fixture(),reads=f.storage.reads;
 for(const port of [{},null,{forEachEnvelope:async()=>0},{getEnvelope:async()=>null}])await assert.rejects(f.verify(port),/E2EE_STREAMED_READBACK_REQUIRED/);
 assert.equal(f.storage.reads,reads);
});
test('missing extra duplicate and falsely reported inventories cannot turn an empty page into completeness',async()=>{
 const f=await fixture(),all=[...f.values.values()];
 for(const mode of ['missing','extra','duplicate','count']){
  const rows=mode==='missing'?all.slice(1):mode==='extra'?[...all,{...all[0],context:{...all[0].context,objectId:'unplanned'}}]:mode==='duplicate'?[...all,all[0]]:all;
  await assert.rejects(f.verify({...f.readback,async forEachEnvelope(sink){for(const value of rows)await sink(value);return mode==='count'?0:rows.length;}}),/E2EE_/);
 }
 assert.equal(f.counts().gets,0);
});
test('signature-free payload hashes never excuse forged inventory signatures',async()=>{
 const f=await fixture(),all=[...f.values.values()];
 await assert.rejects(f.verify({...f.readback,async forEachEnvelope(sink){for(const value of all)await sink({...value,signature:flip(value.signature)});return all.length;}}),/E2EE_/);
 assert.equal(f.counts().gets,0);
});
test('malformed runtime callback values retain a sanitized envelope error',async()=>{
 const f=await fixture();for(const value of [null,undefined,{},[],{context:{}}])await assert.rejects(f.verify({...f.readback,async forEachEnvelope(sink){await sink(value);return 1;}}),/^Error: E2EE_/);
 assert.equal(f.counts().gets,0);
});
test('missing replaced foreign-context and bad-signature exact gets refuse a complete receipt',async()=>{
 const f=await fixture();
 for(const mode of ['missing','ciphertext','scope','signature'])await assert.rejects(f.verify({...f.readback,async getEnvelope(domain,id){
  const value=await f.readback.getEnvelope(domain,id);if(mode==='missing')return null;if(mode==='scope')return{...value,context:{...value.context,scopeId:'foreign'}};return{...value,[mode]:flip(value[mode])};
 }}),/E2EE_/);
});
test('swallowed sink errors concurrent callbacks and late callbacks remain sticky and revoked',async()=>{
 const f=await fixture(),all=[...f.values.values()];let late;
 await assert.rejects(f.verify({...f.readback,async forEachEnvelope(sink){try{await sink({...all[0],signature:flip(all[0].signature)});}catch{/* Deliberately hostile port. */}for(const value of all)try{await sink(value);}catch{/* Must remain sticky. */}return all.length;}}),/E2EE_/);
 await assert.rejects(f.verify({...f.readback,async forEachEnvelope(sink){await Promise.allSettled([sink(all[0]),sink(all[1])]);return all.length;}}),/E2EE_/);
 await f.verify({...f.readback,async forEachEnvelope(sink){late=sink;return f.readback.forEachEnvelope(sink);}});await assert.rejects(late(all[0]),/E2EE_READBACK_CLOSED/);
});
test('retirement during iteration or exact get never returns a complete reference receipt',async()=>{
 for(const mode of ['walk','get']){const f=await fixture();await assert.rejects(f.verify({...f.readback,
  async forEachEnvelope(sink){const count=await f.readback.forEachEnvelope(sink);if(mode==='walk')f.retire();return count;},
  async getEnvelope(domain,id){const value=await f.readback.getEnvelope(domain,id);if(mode==='get')f.retire();return value;}
 }),/E2EE_ACCOUNT_CHANGED/);}
});
test('local-only plans need an actually empty inventory and never fetch a local record remotely',async()=>{
 const f=await fixture({localOnly:true}),result=await f.verify();assert.equal(result.envelopes,0);assert.equal(result.localRecords,1);assert.deepEqual(f.counts(),{gets:0,walks:1});
 await assert.rejects(f.verify({...f.readback,async forEachEnvelope(){return 1;}}),/E2EE_/);
});
test('single-envelope shared comments use the same full signature AEAD and original digest checks',async()=>{
 const f=await fixture({kind:'project'}),result=await f.verify();assert.equal(result.envelopes,1);assert.equal(result.remoteRecords,1);assert.deepEqual(f.counts(),{gets:1,walks:1});
});
test('loss of a protected local-only part during remote checks cannot yield success',async()=>{
 const f=await fixture(),key=[...f.storage.rows.keys()].find(key=>key.endsWith(`${f.manifest.local[0].recordId}:0`));assert.ok(key);
 await assert.rejects(f.verify({...f.readback,async forEachEnvelope(sink){const count=await f.readback.forEachEnvelope(sink);f.storage.rows.delete(key);return count;}}),/E2EE_/);
});
