import assert from 'node:assert/strict';
import test from 'node:test';
import {withOwnedMigrationPlanning} from '../app/e2ee/migration-session.ts';
import {UnlockedWebDevice} from '../app/e2ee/device-vault.ts';
import {createRecoveryKit} from '../app/e2ee/keys.ts';
import {encodeE2eeBytes} from '../app/e2ee/envelope.ts';
import {signE2eeCommand} from '../app/e2ee/commands.ts';
import {listRemoteOriginals} from '../app/e2ee/remote-original.ts';
import {validateStreamedPlanningOwnership} from '../app/e2ee/migration-ownership.ts';
import {readFileSync} from 'node:fs';

// Component fixture. Memory ports and callback ownership are deliberately
// not a coordinator CAS, authenticated HTTP or durable-provider acceptance.
class Records {
 rows=new Map();
 async get(key){return structuredClone(this.rows.get(key)??null);}
 async list(prefix){return [...this.rows.keys()].filter(key=>key.startsWith(prefix));}
 async commit(changes,signal,current=()=>{}){
  current();assert.notEqual(signal?.aborted,true);
  for(const row of changes)assert.equal(this.rows.get(row.key)?.serial??null,row.expected);
  current();for(const row of changes){if(row.value===null)this.rows.delete(row.key);else this.rows.set(row.key,structuredClone(row.value));}
 }
}
class Keys {
 rows=new Map();async get(owner){return structuredClone(this.rows.get(owner)??null);}
 async create(owner,bundle){assert.equal(this.rows.has(owner),false);this.rows.set(owner,{serial:1,bundle:structuredClone(bundle)});}
}
const observed=promise=>promise.then(value=>({value}),error=>({error}));
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
async function fixture(t){
 const recovery=await createRecoveryKit('session-draft-owner'),records=new Records(),device=await UnlockedWebDevice.provision('session-draft-owner',recovery.secret,recovery.kit,records,new Keys());
 t.after(()=>{device.lock();recovery.secret.fill(0);});
 const digest=encodeE2eeBytes(new Uint8Array(32)),context={ownerId:device.ownerId,scopeId:`personal:${device.ownerId}`,migrationId:crypto.randomUUID(),fence:1,sourceHash:digest,generation:2};
 const binding={ownerId:context.ownerId,scopeId:context.scopeId,deviceId:device.deviceId,checkpointHash:digest,directoryRevision:1,securityEpoch:1};
 const target={ownerId:context.ownerId,scopeId:context.scopeId,kind:'personal'},capacity={maximumBytes:8*1024*1024,maximumParts:1000,maximumObservations:100,maximumRecords:4000,maximumMetadataBytes:4*1024*1024};
 const reservations=[],complete=[];let finished=false,bindFailure;
 const hooks={context,binding,assertCurrent:()=>device.requireOpen(),async packet(action,page){return signE2eeCommand({protocol:1,ownerId:context.ownerId,scopeId:context.scopeId,deviceId:device.deviceId,action,
  expectedRevision:1,checkpointHash:digest,securityEpoch:1,operationId:crypto.randomUUID(),payload:{migrationId:context.migrationId,fence:1,sourceHash:digest,...page}},device.keys().signing.privateKey);},
  original:(packet,current)=>({vault:device.vault,target,capacity,packet,signer:device.keys().signing.publicKey,generation:2,assertCurrent:current,ensureDurableKeys:()=>device.ensureDurableKeys(),admit:async()=>{}}),
  async reserve(registration,packet,current){current();reservations.push({registration,packet});},
  async complete(registration,packet,reference,current){current();if(bindFailure)throw bindFailure;complete.push({registration,packet,reference});},
  async finish(){finished=true;return Object.freeze({ids:complete.map(row=>row.reference.id)});}};
 async function receive(packet,observation){
  await observation.prepare({path:'/e2ee/v1/read',method:'POST',body:JSON.stringify(packet)});
  await observation.begin({path:'/e2ee/v1/read',status:200,contentType:'application/json',contentLength:null});
  await observation.append(new TextEncoder().encode(' {"private":"SYNTHETIC ORIGINAL"} '));await observation.finish();observation.close();return{ok:true};
 }
 return{device,records,context,binding,hooks,receive,reservations,complete,get finished(){return finished;},set bindFailure(value){bindFailure=value;},
  read:()=>({vault:device.vault,target,capacity,assertCurrent:()=>device.requireOpen()})};
}
test('session binds complete authenticated raw bytes before surfacing a parser or HTTP refusal',async t=>{
 const f=await fixture(t),failure=new Error('SYNTHETIC_JSON_REFUSED');
 await assert.rejects(withOwnedMigrationPlanning(f.hooks,async session=>{
  session.assertBinding(f.binding);
  await assert.rejects(session.requestLegacy(f.context,'legacy-workspace',undefined,async(...args)=>{await f.receive(...args);throw failure;}),error=>error===failure);
 }),error=>error===failure);
 assert.equal(f.complete.length,1);assert.equal(f.reservations.length,1);assert.equal(f.finished,false);
 assert.equal((await listRemoteOriginals(f.read()))[0].phase,'complete');
});
test('session withholds a derived result on ownership failure even if its consumer catches that failure',async t=>{
 const f=await fixture(t),failure=new Error('E2EE_LOCAL_CONFLICT');f.bindFailure=failure;let adopted=false;
 await assert.rejects(withOwnedMigrationPlanning(f.hooks,async session=>{
  try{await session.requestLegacy(f.context,'legacy-workspace',undefined,f.receive);adopted=true;}catch(error){assert.equal(error,failure);}
 }),error=>error===failure);
 assert.equal(adopted,false);assert.equal(f.finished,false);assert.equal((await listRemoteOriginals(f.read()))[0].phase,'complete');
});
test('session drains unawaited HTTP before releasing ownership and revokes every late observation',async t=>{
 const f=await fixture(t),entered=deferred(),release=deferred();let child,settled=false;
 const job=observed(withOwnedMigrationPlanning(f.hooks,async session=>{
  child=observed(session.requestLegacy(f.context,'legacy-workspace',undefined,async(packet,observation,signal)=>{
   await observation.prepare({path:'/e2ee/v1/read',method:'POST',body:JSON.stringify(packet)});entered.resolve();await release.promise;
   assert.equal(signal.aborted,true);await observation.begin({path:'/e2ee/v1/read',status:200,contentType:'application/json',contentLength:null});return{};
  }));await entered.promise;
 })).then(value=>{settled=true;return value;});
 await entered.promise;await new Promise(resolve=>setTimeout(resolve,20));assert.equal(settled,false);const retained=structuredClone(f.records.rows);
 release.resolve();const result=await job;assert.match(result.error.message,/REQUEST_NOT_AWAITED/);assert.ok((await child).error);
 assert.deepEqual(f.records.rows,retained);assert.equal(f.finished,false);assert.equal((await listRemoteOriginals(f.read()))[0].phase,'registered');
});
test('session returns technical references after binding and rejects escaped or mismatched ports',async t=>{
 const f=await fixture(t);let escaped;
 const receipt=await withOwnedMigrationPlanning(f.hooks,async session=>{escaped=session;assert.deepEqual(await session.requestLegacy(f.context,'legacy-workspace',undefined,f.receive),{ok:true});});
 assert.equal(receipt.ids.length,1);const retained=structuredClone(f.records.rows);
 await assert.rejects(escaped.requestLegacy(f.context,'legacy-workspace',undefined,f.receive),/SESSION_CLOSED/);assert.deepEqual(f.records.rows,retained);
 assert.throws(()=>escaped.assertBinding(f.binding),/SESSION_CLOSED/);
});
test('session preserves the transport refusal when no physical observation was created',async t=>{
 const f=await fixture(t),failure=new Error('E2EE_STORAGE_CAPACITY');
 await assert.rejects(withOwnedMigrationPlanning(f.hooks,async session=>{await session.requestLegacy(f.context,'legacy-workspace',undefined,async()=>{throw failure;});}),error=>error===failure);
 assert.equal(f.reservations.length,1);assert.equal(f.complete.length,0);assert.equal(f.records.rows.size,0);
});
test('ownership keeps strict v1 and requires explicit null or an exact v2 completion reference',()=>{
 const vector=JSON.parse(readFileSync(new URL('./fixtures/e2ee-streamed-ownership-v1.json',import.meta.url),'utf8'));
 assert.equal(validateStreamedPlanningOwnership(vector.ownership,vector.expected).protocol,1);
 const next=structuredClone(vector.ownership);next.protocol=2;for(const original of next.originals)original.completion=null;
 assert.equal(validateStreamedPlanningOwnership(next,vector.expected).originals[0].completion,null);
 const original=next.originals[0];original.completion={id:original.registration.id,manifestHash:encodeE2eeBytes(new Uint8Array(32)),rawHash:encodeE2eeBytes(new Uint8Array(32).fill(1)),size:0};
 assert.equal(validateStreamedPlanningOwnership(next,vector.expected).originals[0].completion.size,0);
 const illegalV1=structuredClone(next);illegalV1.protocol=1;assert.throws(()=>validateStreamedPlanningOwnership(illegalV1,vector.expected));
 for(const mutate of [value=>delete value.completion,value=>{value.completion.id=crypto.randomUUID();},value=>{value.completion.size=-1;},value=>{value.completion.bodyVerified=true;},value=>{value.completion.rawHash='invalid';}]){
  const bad=structuredClone(next);mutate(bad.originals[0]);assert.throws(()=>validateStreamedPlanningOwnership(bad,vector.expected));
 }
});

