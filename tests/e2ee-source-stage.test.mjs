import assert from 'node:assert/strict';
import test from 'node:test';
import {ProtectedSourceStage,inspectSourceStages,openSourceStage} from '../app/e2ee/source-stage.ts';
import {UnlockedE2eeVault,localRecordKey} from '../app/e2ee/storage.ts';
import {freshSecret,generateDeviceKeys} from '../app/e2ee/keys.ts';
import {importE2eeRoot,encodeE2eeBytes} from '../app/e2ee/envelope.ts';
import {E2EE_CHUNK_BYTES} from '../app/e2ee/files.ts';
import {canonicalE2eeValue,decodeCanonicalE2eeValue} from '../app/e2ee/commands.ts';

class AtomicStorage {
 rows=new Map();full=false;beforeCommit;afterCommit;
 async get(key){return structuredClone(this.rows.get(key)??null);}
 async list(prefix){return [...this.rows.keys()].filter(key=>key.startsWith(prefix));}
 async commit(changes,signal){
  await this.beforeCommit?.(changes);if(signal?.aborted)throw new Error('E2EE_UNLOCK_REQUIRED');if(this.full)throw new Error('SYNTHETIC_DISK_FULL');
  for(const row of changes)assert.equal(this.rows.get(row.key)?.serial??null,row.expected,'E2EE_LOCAL_CONFLICT');const next=new Map(this.rows);
  for(const row of changes)if(row.value===null)next.delete(row.key);else next.set(row.key,structuredClone(row.value));
  if(signal?.aborted)throw new Error('E2EE_UNLOCK_REQUIRED');this.rows=next;await this.afterCommit?.(changes);
 }
}
const bytes=value=>new TextEncoder().encode(value),target={ownerId:'content-owner',scopeId:'project:owned-source',kind:'project'};
async function fixture(){
 const storage=new AtomicStorage(),keys=await generateDeviceKeys(),raw=freshSecret(),root=await importE2eeRoot(raw);raw.fill(0);
 const scope={ownerId:'device-actor',scopeId:'device:source-device',deviceId:'source-device',generation:1,cryptoEpoch:1,securityEpoch:1,keyId:'independent-local-root',
  signingKey:keys.signing.privateKey,roots:new Map([['independent-local-root',root]]),trustedSigner:id=>id==='source-device'?keys.signing.publicKey:undefined};
 let live=true;const check=()=>{if(!live)throw new Error('E2EE_ACCOUNT_CHANGED');};let durable=0;const admissions=[];
 const spawn=()=>new UnlockedE2eeVault(storage,scope),vault=spawn();
 const options={vault,target:{...target},paths:['project.content','project.local-work'],capacity:{maximumBytes:4*1024*1024,maximumParts:16},
  ensureDurableKeys:async()=>{durable++;},assertCurrent:check,admit:async value=>{admissions.push({...value});}};
 return{storage,scope,vault,spawn,check,options,admissions,durable:()=>durable,retire:()=>{live=false;}};
}
async function send(write,input){for(let offset=0;offset<input.length;offset+=65536)await write(input.subarray(offset,offset+65536));}
async function readAll(reader){const parts=[];for await(const value of reader.chunks)parts.push(Buffer.from(value));reader.assertComplete();return Buffer.concat(parts);}
async function completed(f,input=bytes('ORIGINAL PRIVATE SOURCE INPUT')){
 const stage=await ProtectedSourceStage.create(f.options);for(const id of f.options.paths)await stage.capturePath(id,write=>send(write,input));return stage.finish();
}

test('original-part locator discovery stays inside the original actor snapshot namespace and validates framing before filtering',async()=>{
 const f=await fixture();await f.vault.write([{domain:'local-snapshot',objectId:'old:source:0',value:bytes('old source'),expected:null},{domain:'local-snapshot',objectId:'other:source',value:bytes('unbound malformed source'),expected:null},
  {domain:'local-snapshot',objectId:'unrelated',value:bytes('unrelated'),expected:null},{domain:'draft',objectId:'draft:source:0',value:bytes('draft'),expected:null}]);
 let gets=0;const get=f.storage.get.bind(f.storage);f.storage.get=async key=>{gets++;return get(key);};
 assert.deepEqual((await f.vault.listMigrationOriginalParts()).sort(),['old:source:0','other:source']);assert.equal(gets,0);
 await assert.rejects(f.vault.listLocal('local-snapshot',''),/E2EE_/);
 const prefix=[f.scope.ownerId,f.scope.scopeId,'local-snapshot'].map(value=>`${value.length}:${value}`).join('');
 f.storage.rows.set(prefix+'02:xx',{});await assert.rejects(f.vault.listMigrationOriginalParts(),/CORRUPT_LOCAL_RECORD/);assert.equal(gets,0);
});

test('an original-part locator lookup retired while pending returns no discovery result',async()=>{
 const f=await fixture();let release;const gate=new Promise(resolve=>{release=resolve;});f.storage.list=async()=>{await gate;return[];};
 const pending=f.vault.listMigrationOriginalParts();f.vault.lock();release();await assert.rejects(pending,/UNLOCK_REQUIRED/);
});

test('independent new-root chunks cold-read exact complete input and keep target owner separate from the device actor',async()=>{
 const f=await fixture(),input=new Uint8Array(E2EE_CHUNK_BYTES*2+31);for(let index=0;index<input.length;index++)input[index]=(index*37)&255;
 const ref=await completed(f,input);assert.equal(f.durable(),1);assert.ok(f.admissions.some(row=>row.parts>=6));assert.equal(JSON.stringify([...f.storage.rows]).includes('ORIGINAL PRIVATE SOURCE INPUT'),false);
 f.vault.lock();const cold=f.spawn(),opened=await openSourceStage(cold,target,ref,f.check);assert.deepEqual(opened.paths,f.options.paths);
 for(const id of opened.paths)assert.deepEqual(await readAll(opened.openPath(id)),Buffer.from(input));
 await assert.rejects(openSourceStage(cold,{...target,ownerId:'foreign-owner'},ref,f.check),/E2EE_/);
 assert.equal((await inspectSourceStages(cold,target,f.check))[0].complete,true);cold.lock();input.fill(0);
});
test('process loss after atomic chunk/journal commit leaves an inert discoverable stage and a new attempt preserves it',async()=>{
 const f=await fixture();let failed=false;f.storage.afterCommit=changes=>{if(!failed&&changes.some(row=>row.key.endsWith(':p:00:00000'))){failed=true;throw new Error('SYNTHETIC_PROCESS_LOSS');}};
 const stage=await ProtectedSourceStage.create(f.options),input=new Uint8Array(E2EE_CHUNK_BYTES).fill(17);
 await assert.rejects(stage.capturePath(f.options.paths[0],write=>write(input)),/SYNTHETIC_PROCESS_LOSS/);await assert.rejects(stage.finish(),/CLOSED/);
 const old=await inspectSourceStages(f.vault,target,f.check);assert.equal(old.length,1);assert.equal(old[0].complete,false);assert.equal(old[0].manifestHash,null);
 const kept=new Map(f.storage.rows);f.storage.afterCommit=undefined;const ref=await completed(f);const history=await inspectSourceStages(f.vault,target,f.check);
 assert.equal(history.length,2);assert.equal(history[0].id,old[0].id);assert.equal(history[0].complete,false);assert.equal(history[1].id,ref.stageId);
 for(const[key,value]of kept)if(!key.includes('source-stage-catalog:'))assert.deepEqual(f.storage.rows.get(key),value);input.fill(0);
});
test('source EOF/tag failure and a caught rejected write can never produce a completed prefix',async()=>{
 for(const mode of ['tag','caught-input']){
  const f=await fixture(),stage=await ProtectedSourceStage.create(f.options),input=new Uint8Array(E2EE_CHUNK_BYTES).fill(37);
  await assert.rejects(stage.capturePath(f.options.paths[0],async write=>{
   await write(input);if(mode==='tag')throw new Error('SYNTHETIC_TAG_FAILURE');
   await assert.rejects(write(new Uint8Array(E2EE_CHUNK_BYTES+1)),/INPUT/);
  }),mode==='tag'?/SYNTHETIC_TAG_FAILURE/:/CLOSED/);
  await assert.rejects(stage.finish(),/CLOSED/);assert.equal((await inspectSourceStages(f.vault,target,f.check))[0].complete,false);assert.ok(input.every(value=>value===37));input.fill(0);
 }
});
test('capacity and storage refusals preserve earlier sealed parts and never publish a complete marker',async()=>{
 for(const mode of ['capacity','disk']){
  const f=await fixture();if(mode==='capacity')f.options.capacity={maximumBytes:E2EE_CHUNK_BYTES,maximumParts:1};
  const stage=await ProtectedSourceStage.create(f.options),input=new Uint8Array(E2EE_CHUNK_BYTES).fill(19);
  await assert.rejects(stage.capturePath(f.options.paths[0],async write=>{await write(input);if(mode==='disk')f.storage.full=true;await write(bytes('extra'));}),mode==='disk'?/DISK_FULL/:/CAPACITY/);
  assert.equal((await inspectSourceStages(f.vault,target,f.check))[0].complete,false);assert.ok([...f.storage.rows.keys()].some(key=>key.endsWith(':p:00:00000')));input.fill(0);
 }
});
test('missing catalogue or an unknown namespace record is explicit unbound input, never an empty discovery',async()=>{
 for(const mode of ['missing-index','unknown-record']){
  const f=await fixture();await ProtectedSourceStage.create(f.options);
  if(mode==='missing-index'){for(const key of f.storage.rows.keys())if(key.includes('source-stage-catalog:'))f.storage.rows.delete(key);}
  else await f.vault.write([{domain:'local-snapshot',objectId:'source-stage:unknown',value:bytes('inert original'),expected:null}]);
  await assert.rejects(inspectSourceStages(f.vault,target,f.check),/UNBOUND_REMNANT/);const original=new Map(f.storage.rows);
  await assert.rejects(ProtectedSourceStage.create(f.options),/UNBOUND_REMNANT/);assert.deepEqual(f.storage.rows,original);
 }
});
test('a closed prefix reader does not certify EOF, and its borrowed plaintext is wiped',async()=>{
 const f=await fixture(),ref=await completed(f,new Uint8Array(E2EE_CHUNK_BYTES+7).fill(41)),snapshot=await openSourceStage(f.vault,target,ref,f.check),reader=snapshot.openPath(f.options.paths[0]);
 const first=await reader.chunks.next();assert.equal(first.done,false);assert.ok(first.value.some(value=>value!==0));await reader.chunks.return();
 assert.ok(first.value.every(value=>value===0));assert.throws(()=>reader.assertComplete(),/EOF_REQUIRED/);
});
test('changed chunks, missing parts and extra unreferenced parts refuse with no repair or deletion',async()=>{
 for(const mode of ['tamper','missing','extra']){
  const f=await fixture(),ref=await completed(f,new Uint8Array(E2EE_CHUNK_BYTES+7).fill(23));const key=[...f.storage.rows.keys()].find(key=>key.endsWith(':p:00:00000'));
  if(mode==='tamper'){const row=f.storage.rows.get(key),raw=row.envelope.ciphertext;row.envelope.ciphertext=(raw[0]==='A'?'B':'A')+raw.slice(1);}
  if(mode==='missing')f.storage.rows.delete(key);
  if(mode==='extra'){const id=key.slice(key.lastIndexOf('source-stage:')).replace(/:00000$/,':00002');await f.vault.write([{domain:'local-snapshot',objectId:id,value:bytes('unreferenced original'),expected:null}]);}
  const original=structuredClone(f.storage.rows);
  await assert.rejects(async()=>{const opened=await openSourceStage(f.vault,target,ref,f.check);await readAll(opened.openPath(f.options.paths[0]));},/E2EE_/);assert.deepEqual(f.storage.rows,original);
 }
});
test('actor retirement wipes a decrypted metadata result and preserves durable incomplete source',async()=>{
 const f=await fixture();await ProtectedSourceStage.create(f.options);const read=f.vault.read.bind(f.vault);let observed;
 f.vault.read=async(...args)=>{const row=await read(...args);if(row){observed=row.value;f.retire();}return row;};
 await assert.rejects(inspectSourceStages(f.vault,target,f.check),/ACCOUNT_CHANGED/);assert.ok(observed.every(value=>value===0));
});
test('technical discovery refuses malformed length framing and a pending lock instead of returning an empty list',async()=>{
 const f=await fixture(),valid=localRecordKey(f.scope,'local-snapshot','x');f.storage.rows.set(valid.replace(/1:x$/,'01:x'),{});
 await assert.rejects(f.vault.listLocal('local-snapshot','source-stage:'),/CORRUPT_LOCAL_RECORD/);f.storage.rows.clear();
 f.storage.list=async()=>{f.vault.lock();return[];};await assert.rejects(f.vault.listLocal('local-snapshot','source-stage:'),/UNLOCK_REQUIRED/);
});
test('all binding, capacity and callback inputs are captured before asynchronous durable-key confirmation',async()=>{
 const f=await fixture(),saved={...f.options.target},paths=[...f.options.paths];f.options.ensureDurableKeys=async()=>{
  f.options.target.ownerId='changed-owner';f.options.paths[0]='changed.path';f.options.capacity.maximumParts=0;f.options.assertCurrent=()=>{throw new Error('UNEXPECTED_REPLACED_CALLBACK');};
 };
 const stage=await ProtectedSourceStage.create(f.options);for(const id of paths)await stage.capturePath(id,write=>send(write,bytes('original binding')));const ref=await stage.finish();
 assert.deepEqual((await openSourceStage(f.vault,saved,ref,f.check)).paths,paths);
});
test('concurrent first creators compare the catalogue and journal in one transaction',async()=>{
 const f=await fixture();let arrivals=0,release;const gate=new Promise(resolve=>{release=resolve;});
 f.storage.beforeCommit=async changes=>{if(changes.some(row=>row.key.includes('source-stage-catalog:')&&row.expected===null)){if(++arrivals===2)release();await gate;}};
 const result=await Promise.allSettled([ProtectedSourceStage.create(f.options),ProtectedSourceStage.create(f.options)]);
 assert.equal(result.filter(row=>row.status==='fulfilled').length,1);assert.equal(result.filter(row=>row.status==='rejected').length,1);
 assert.equal((await inspectSourceStages(f.vault,target,f.check)).length,1);assert.equal(f.storage.rows.size,2);
});
test('a source reference is an immutable value snapshot and cannot be retargeted during metadata reads',async()=>{
 const f=await fixture(),ref=await completed(f),input={...ref},read=f.vault.read.bind(f.vault);let changed=false;
 f.vault.read=async(...args)=>{const row=await read(...args);if(!changed){changed=true;input.stageId=crypto.randomUUID();input.manifestHash=encodeE2eeBytes(new Uint8Array(32));}return row;};
 const opened=await openSourceStage(f.vault,target,input,f.check);assert.equal((await readAll(opened.openPath(f.options.paths[0]))).toString(),'ORIGINAL PRIVATE SOURCE INPUT');
});

test('incomplete journals must match every retained part and their original authenticated context',async()=>{
 for(const mode of ['missing-part','extra-part','actor','out-of-order']){
  const f=await fixture(),stage=await ProtectedSourceStage.create(f.options);await stage.capturePath(f.options.paths[0],write=>send(write,bytes('inert source')));
  const key=[...f.storage.rows.keys()].find(key=>key.endsWith(':p:00:00000'));
  if(mode==='missing-part')f.storage.rows.delete(key);
  else if(mode==='extra-part'){
   const id=key.slice(key.lastIndexOf('source-stage:')).replace(/:00000$/,':00002');await f.vault.write([{domain:'local-snapshot',objectId:id,value:bytes('unbound'),expected:null}]);
  }else{
   const journalId=[...f.storage.rows.keys()].find(key=>key.endsWith(':j:00:00000')).split('source-stage:')[1];
   const id='source-stage:'+journalId,row=await f.vault.read('local-snapshot',id);const body=decodeCanonicalE2eeValue(row.value);row.value.fill(0);
   if(mode==='actor')body.context.actorId='foreign-actor';else body.entries[0].complete=false;
   // Out-of-order: a later completed path cannot follow an unfinished one.
   if(mode==='out-of-order')body.entries[1]={...body.entries[0],id:body.entries[1].id,complete:true};
   const value=canonicalE2eeValue(body);try{await f.vault.write([{domain:'local-snapshot',objectId:id,value,expected:row.serial}]);}finally{value.fill(0);}
  }
  const original=structuredClone(f.storage.rows);await assert.rejects(inspectSourceStages(f.vault,target,f.check),/E2EE_/);
  await assert.rejects(ProtectedSourceStage.create(f.options),/E2EE_/);assert.deepEqual(f.storage.rows,original);
 }
});
test('an unawaited chunk is drained and retained only as an inert prefix when the producer returns early',async()=>{
 const f=await fixture(),stage=await ProtectedSourceStage.create(f.options);let enter,release;
 const entered=new Promise(resolve=>{enter=resolve;}),gate=new Promise(resolve=>{release=resolve;});
 f.storage.beforeCommit=async changes=>{if(changes.some(row=>row.key.endsWith(':p:00:00000'))){enter();await gate;}};
 const capture=stage.capturePath(f.options.paths[0],async write=>{void write(new Uint8Array(E2EE_CHUNK_BYTES).fill(37));await entered;});
 const result=assert.rejects(capture,/INPUT/);await entered;await new Promise(resolve=>setImmediate(resolve));release();await result;
 await assert.rejects(stage.finish(),/CLOSED/);assert.equal((await inspectSourceStages(f.vault,target,f.check))[0].complete,false);
});
test('parallel finish calls cannot both advance metadata and a failed finisher cannot reopen the stage',async()=>{
 const f=await fixture(),stage=await ProtectedSourceStage.create(f.options);for(const id of f.options.paths)await stage.capturePath(id,write=>write(bytes('sealed source')));
 const result=await Promise.allSettled([stage.finish(),stage.finish()]);assert.equal(result.filter(row=>row.status==='fulfilled').length,1);assert.equal(result.filter(row=>row.status==='rejected').length,1);
 const ref=result.find(row=>row.status==='fulfilled').value;assert.equal((await readAll((await openSourceStage(f.vault,target,ref,f.check)).openPath(f.options.paths[0]))).toString(),'sealed source');
});
