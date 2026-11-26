import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {SignedMigrationTransport} from '../app/e2ee/migration-transport.ts';
import {UnlockedWebDevice} from '../app/e2ee/device-vault.ts';
import {E2eeMigration} from '../app/e2ee/migration.ts';
import {requiredPrivatePaths} from '../app/e2ee/migration-sources.ts';
import {createRecoveryKit,freshSecret,publicDeviceKeys,sealRoot,generateDeviceKeys} from '../app/e2ee/keys.ts';
import {importE2eeRoot,encodeE2eeBytes} from '../app/e2ee/envelope.ts';
import {signE2eeCommand,verifyE2eeCommand,e2eeCommandHash,canonicalE2eeValue} from '../app/e2ee/commands.ts';
import {validateStreamedPlanningOwnership} from '../app/e2ee/migration-ownership.ts';
import {ProtectedRemoteOriginal,listRemoteOriginals,withRemoteOriginal} from '../app/e2ee/remote-original.ts';
import {openMigrationContentPlan} from '../app/e2ee/content-plan.ts';
import {E2EE_CHUNK_BYTES} from '../app/e2ee/files.ts';
import {collectPrivatePathFragments} from '../app/e2ee/private-path-fragments.ts';
import {privatePathSource} from '../app/e2ee/private-path-source.ts';

async function sessionReply(f,packet,observation,_signal,status=200,raw=' {"rows":"SYNTHETIC ORIGINAL"} '){
 const saved=await f.readState();try{const owned=saved.state.ownership.originals.find(row=>row.packet.command.operationId===packet.command.operationId);assert.ok(owned);assert.deepEqual(owned.packet,JSON.parse(JSON.stringify(packet)));assert.equal(owned.completion,null);}finally{saved.raw.fill(0);}
 await observation.prepare({path:'/e2ee/v1/read',method:'POST',body:JSON.stringify(packet)});
 await observation.begin({path:'/e2ee/v1/read',status,contentType:'application/json',contentLength:null});
 await observation.append(bytes(raw));await observation.finish();observation.close();
 return{protocol:1,ownerId:packet.command.ownerId,scopeId:packet.command.scopeId,migrationId:packet.command.payload.migrationId,
  fence:packet.command.payload.fence,sourceHash:packet.command.payload.sourceHash,checkpointHash:f.directory.checkpoint.hash,directoryRevision:f.directory.checkpoint.revision,rows:'SYNTHETIC ORIGINAL'};
}

const bytes=value=>new TextEncoder().encode(value),hash=value=>createHash('sha256').update(value).digest('base64url');
test('public state4 ownership vector agrees with native canonical bytes and trusted request signature',async()=>{
 const vector=JSON.parse(readFileSync(new URL('./fixtures/e2ee-streamed-ownership-v1.json',import.meta.url),'utf8'));
 const checked=validateStreamedPlanningOwnership(vector.ownership,vector.expected);
 assert.equal(hash(canonicalE2eeValue(checked)),vector.ownershipCanonicalHash);
 const signer=await crypto.subtle.importKey('spki',Buffer.from(checked.signer,'base64url'),{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
 await verifyE2eeCommand(checked.originals[0].packet,signer);
 for(const field of ['sourceHash','checkpointHash','migrationId']){
  const invalid=structuredClone(vector.expected);invalid[field]=field==='migrationId'?'50000000-0000-4000-8000-000000000005':hash('different');
  assert.throws(()=>validateStreamedPlanningOwnership(vector.ownership,invalid));
 }
});
class Records{
 rows=new Map();fail=false;
 async get(key){return structuredClone(this.rows.get(key)??null);}
 async list(prefix){return [...this.rows.keys()].filter(key=>key.startsWith(prefix));}
 async commit(changes,signal,current=()=>{}){
  current();if(signal?.aborted)throw new Error('E2EE_UNLOCK_REQUIRED');if(this.fail)throw new Error('SYNTHETIC_DISK_FULL');
  for(const change of changes)if((this.rows.get(change.key)?.serial??null)!==change.expected)throw new Error('E2EE_LOCAL_CONFLICT');
  const next=new Map(this.rows);for(const change of changes){if(change.value===null)next.delete(change.key);else next.set(change.key,structuredClone(change.value));}this.rows=next;
  await this.afterCommit?.(changes);
 }
}
class Keys{
 rows=new Map();async get(id){return structuredClone(this.rows.get(id)??null);}
 async create(id,bundle){assert.equal(this.rows.has(id),false);this.rows.set(id,{serial:1,bundle:structuredClone(bundle)});}
}
async function fixture(t,options={}){
 const kind=options.kind??'personal',ownerId='streamed-owner',scopeId=`${kind}:${ownerId}`,recovery=await createRecoveryKit(ownerId),records=new Records(),keys=new Keys();
 let device=await UnlockedWebDevice.provision(ownerId,recovery.secret,recovery.kit,records,keys);
 const deviceId=device.deviceId,publicKeys=await publicDeviceKeys(device.keys()),publicKey=device.keys().signing.publicKey,raw=freshSecret(),root=await importE2eeRoot(raw);
 const recipient={ownerId,scopeId,cryptoEpoch:1,keyId:'content-root',recipientId:deviceId};
 const bootstrap={protocol:1,ownerId,scopeId,deviceId,action:'bootstrap',expectedRevision:0,checkpointHash:'genesis',securityEpoch:1,operationId:'streamed-bootstrap',payload:{
  kind,resourceId:ownerId,keyId:'content-root',generation:1,recoveryKit:recovery.kit,deviceKeys:publicKeys,
  deviceCapsule:await sealRoot(raw,publicKeys.receivingKey,recipient),recoveryCapsule:await sealRoot(raw,recovery.kit.authority.receivingKey,{...recipient,recipientId:'recovery'})}};
 raw.fill(0);
 bootstrap.payload.selfProof=(await signE2eeCommand(bootstrap,device.keys().signing.privateKey)).signature;
 const directory=await device.rememberDirectory(scopeId,recovery.kit.authority,[await signE2eeCommand(bootstrap,recovery.keys.signing.privateKey)],ownerId);
 const required=requiredPrivatePaths(kind).map(value=>value.id),sourceHash=encodeE2eeBytes(new Uint8Array(32).fill(29)),trace=[],server={fence:1,generation:2,receipts:new Map(),lost:false};
 const transport={async sourceHash(){trace.push('source');assert.equal((await coordinator.status()).protocol,4);await options.onSource?.();return sourceHash;},
  async command(packet){
   const command=await verifyE2eeCommand(packet,publicKey);trace.push(structuredClone(packet));const identity=await e2eeCommandHash(command),known=server.receipts.get(command.operationId);await options.onCommand?.(command,packet);
   if(known){assert.equal(known.hash,identity);return structuredClone(known.result);}
   if(options.loss==='before'&&!server.lost){server.lost=true;throw new Error('SYNTHETIC_PROCESS_DEATH');}
   let result;if(command.action==='migration-start')result={fence:server.fence,generation:server.generation,leaseUntil:Math.floor(Date.now()/1000)+(options.expired?-1:3600)};
   else if(command.action==='migration-resume'){
    if(options.sourceChanged)throw new Error('E2EE_SOURCE_CHANGED');assert.equal(command.payload.fence,server.fence);server.fence++;
    result={fence:server.fence,generation:server.generation,leaseUntil:Math.floor(Date.now()/1000)+3600,pendingReceipt:null};
   }else throw new Error('UNEXPECTED_UPLOAD_OR_ACTIVATION');
   server.receipts.set(command.operationId,{hash:identity,result});if(options.loss==='after'&&!server.lost){server.lost=true;throw new Error('SYNTHETIC_PROCESS_DEATH');}
   return structuredClone(result);
  },async readAll(){throw new Error('AGGREGATE_READ_FORBIDDEN');}};
 const sources={requiredCoverage:required,allowedContentDomains:[...new Set(requiredPrivatePaths(kind).flatMap(path=>path.domains))],
  async captureLocal(){throw new Error('AGGREGATE_CAPTURE_FORBIDDEN');},async reconcile(){throw new Error('AGGREGATE_RECONCILIATION_FORBIDDEN');}};
 const make=()=>new E2eeMigration({vault:device.vault,directory,deviceId,signingKey:device.keys().signing.privateKey,signer:device.keys().signing.publicKey,root,transport,sources,
  ensureDurableKeys:()=>device.ensureDurableKeys(),withLocalWriteFence:options.withLocalWriteFence??(operation=>operation()),verifyRecovery:async()=>{throw new Error('RECOVERY_NOT_PART_OF_PREPARATION');}});
 let coordinator=make();const target={ownerId,scopeId,kind},stage={target,paths:required,async capturePath(path,write){await write(bytes('SYNTHETIC LOCAL ORIGINAL '+path));}};
 const stagePolicy={capacity:{maximumBytes:16*1024*1024,maximumParts:1000},assertCurrent(){},async admit(){}};
 const originalCapacity={maximumBytes:8*1024*1024,maximumParts:1000,maximumObservations:100,maximumRecords:4000,maximumMetadataBytes:4*1024*1024};
 const policy=()=>({device,capacity:{maximumBytes:32*1024*1024,maximumParts:2000,maximumMetadataBytes:8*1024*1024},originalCapacity,assertCurrent(){},async admit(){}});
 const readOriginal=()=>({vault:device.vault,target,capacity:originalCapacity,assertCurrent(){}});
 const stateId='migration:'+hash(bytes(scopeId));
 const readState=async()=>{const row=await device.vault.read('local-snapshot',stateId);assert.ok(row);try{return{state:JSON.parse(new TextDecoder().decode(row.value)),serial:row.serial,raw:row.value.slice()};}finally{row.value.fill(0);}};
 const capture=async(ticket,action='legacy-workspace',signing=device.keys())=>{
  const packet=await signE2eeCommand({protocol:1,ownerId,scopeId,deviceId,action,expectedRevision:directory.checkpoint.revision,checkpointHash:directory.checkpoint.hash,securityEpoch:directory.securityEpoch,
   operationId:crypto.randomUUID(),payload:{migrationId:ticket.migrationId,fence:ticket.fence,sourceHash:ticket.sourceHash}},signing.signing.privateKey);
  const observation=await ProtectedRemoteOriginal.create({...readOriginal(),packet,signer:signing.signing.publicKey,generation:ticket.generation,ensureDurableKeys:()=>device.ensureDurableKeys(),async admit(){}});
  return{packet,observation,registration:observation.registration()};
 };
 t.after(()=>{device.lock();recovery.secret.fill(0);});
 await coordinator.prepareStaged(stage,stagePolicy);
 return{records,keys,directory,server,trace,stage,stagePolicy,policy,readOriginal,readState,capture,make,root,get coordinator(){return coordinator;},get device(){return device;},
  async reopen(){device.lock();device=await UnlockedWebDevice.unlock(ownerId,recovery.secret,records,keys);coordinator=make();return coordinator;}};
}

test('state4 atomically retains exact state3 bytes and obtains only a signed preparation lease',async t=>{
 const f=await fixture(t),before=await f.readState(),ticket=await f.coordinator.prepareStreamedPlanning(f.policy()),after=await f.readState();
 assert.equal(after.state.protocol,4);assert.equal(after.state.phase,'preparing');assert.equal(after.state.planned,false);assert.equal(after.state.ownership.attemptId,ticket.attemptId);
 const original=await f.device.vault.read('local-snapshot',after.state.ownership.sourceState.objectId);
 try{assert.deepEqual(original.value,before.raw);assert.equal(hash(original.value),after.state.ownership.sourceState.hash);}finally{original.value.fill(0);before.raw.fill(0);after.raw.fill(0);}
 assert.deepEqual(f.trace.filter(value=>typeof value==='object').map(value=>value.command.action),['migration-start']);
 const stored=new Map(f.records.rows),calls=f.trace.length;
 await assert.rejects(f.coordinator.run(),/STREAMED_PLANNER_REQUIRED/);await assert.rejects(f.coordinator.cancel(),/STREAMED_PLANNER_REQUIRED/);
 await assert.rejects(f.coordinator.restart(),/STREAMED_SOURCE_REQUIRED/);await assert.rejects(f.coordinator.restartStaged(f.stage,f.stagePolicy),/STREAMED_PLANNER_REQUIRED/);
 await assert.rejects(f.coordinator.withStagedSourceHistory(async()=>{},f.policy()),/STAGED_SOURCE_REQUIRED/);
 assert.deepEqual(f.records.rows,stored);assert.equal(f.trace.length,calls);
});

test('cold preparation resumes the same owned attempt and exact lost start command before and after acknowledgement',async t=>{
 for(const loss of ['before','after']){
  const f=await fixture(t,{loss});await assert.rejects(f.coordinator.prepareStreamedPlanning(f.policy()),/SYNTHETIC_PROCESS_DEATH/);
  const prior=await f.readState(),packet=structuredClone(prior.state.pending),attempt=prior.state.ownership.attemptId;await f.reopen();
  const ticket=await f.coordinator.prepareStreamedPlanning(f.policy());assert.equal(ticket.attemptId,attempt);assert.equal(ticket.migrationId,prior.state.migrationId);
  const commands=f.trace.filter(value=>typeof value==='object');assert.deepEqual(commands,[packet,packet]);assert.equal((await f.coordinator.status()).pending,null);prior.raw.fill(0);
 }
});

test('commit-then-process-death keeps the state3 original and does not send a request until cold verification',async t=>{
 const f=await fixture(t),original=await f.readState();let crashed=false;
 f.records.afterCommit=changes=>{if(!crashed&&changes.some(value=>value.value?.envelope.context.objectId.endsWith(':preparation:3'))){crashed=true;throw new Error('SYNTHETIC_COMMITTED_DEATH');}};
 await assert.rejects(f.coordinator.prepareStreamedPlanning(f.policy()),/SYNTHETIC_COMMITTED_DEATH/);assert.equal(f.trace.length,0);assert.equal((await f.readState()).state.protocol,4);
 await f.reopen();const ticket=await f.coordinator.prepareStreamedPlanning(f.policy());assert.ok(ticket.fence);const state=await f.readState();
 const kept=await f.device.vault.read('local-snapshot',state.state.ownership.sourceState.objectId);assert.deepEqual(kept.value,original.raw);kept.value.fill(0);original.raw.fill(0);state.raw.fill(0);
});

test('failed key/admission/storage checks preserve prepared source bytes and refuse before networking',async t=>{
 for(const mode of ['keys','admission','disk']){
  const f=await fixture(t),before=new Map(f.records.rows),policy=f.policy();
  if(mode==='keys')f.keys.rows.get(f.device.ownerId).bundle.ciphertext='corrupt';
  if(mode==='admission')policy.admit=async()=>{throw new Error('SYNTHETIC_ADMISSION_REFUSAL');};if(mode==='disk')f.records.fail=true;
  await assert.rejects(f.coordinator.prepareStreamedPlanning(policy));assert.equal(f.trace.length,0);assert.deepEqual(f.records.rows,before);
 }
});

test('inert originals are owned before prepare and cold partial captures remain retained without body proof',async t=>{
 const f=await fixture(t),ticket=await f.coordinator.prepareStreamedPlanning(f.policy()),capture=await f.capture(ticket),calls=f.trace.length;
 await f.coordinator.reserveStreamedRemoteOriginal(capture.registration,capture.packet,f.policy());assert.equal(f.trace.length,calls);assert.deepEqual(await listRemoteOriginals(f.readOriginal()),[]);
 const owned=await f.readState();assert.deepEqual(owned.state.ownership.originals[0],structuredClone({registration:capture.registration,packet:capture.packet}));owned.raw.fill(0);
 await capture.observation.prepare({path:'/e2ee/v1/read',method:'POST',body:JSON.stringify(capture.packet)});
 await capture.observation.begin({path:'/e2ee/v1/read',status:200,contentType:'application/json',contentLength:null});await capture.observation.append(bytes('ONLY ORIGINAL PREFIX'));capture.observation.close();
 const stored=new Map(f.records.rows);await f.reopen();const resumed=await f.coordinator.prepareStreamedPlanning(f.policy());assert.deepEqual(resumed,ticket);assert.deepEqual(f.records.rows,stored);
 const markers=await listRemoteOriginals(f.readOriginal());assert.equal(markers[0].phase,'receiving');await assert.rejects(withRemoteOriginal(f.readOriginal(),capture.registration.id,async()=>{}),/INCOMPLETE/);
});

test('unowned originals and foreign request signers cannot gain ownership or reach networking',async t=>{
 for(const mode of ['unowned','signer']){
  const f=await fixture(t),ticket=await f.coordinator.prepareStreamedPlanning(f.policy()),capture=await f.capture(ticket,'legacy-workspace',mode==='signer'?await generateDeviceKeys():f.device.keys());
  if(mode==='unowned')await capture.observation.prepare({path:'/e2ee/v1/read',method:'POST',body:JSON.stringify(capture.packet)});
  const before=new Map(f.records.rows),calls=f.trace.length;
  if(mode==='signer')await assert.rejects(f.coordinator.reserveStreamedRemoteOriginal(capture.registration,capture.packet,f.policy()),/UNTRUSTED_COMMAND/);
  else await assert.rejects(f.coordinator.prepareStreamedPlanning(f.policy()),/MIGRATION_HISTORY_REVIEW_REQUIRED/);
  capture.observation.close();assert.deepEqual(f.records.rows,before);assert.equal(f.trace.length,calls);
 }
});

test('request rebinding, duplicate reservation and late caller mutation cannot change an owned original',async t=>{
 const f=await fixture(t),ticket=await f.coordinator.prepareStreamedPlanning(f.policy()),capture=await f.capture(ticket);
 const bad=structuredClone(capture.registration);bad.binding.fence++;
 await assert.rejects(f.coordinator.reserveStreamedRemoteOriginal(bad,capture.packet,f.policy()));
 const supplied=structuredClone(capture.registration),packet=structuredClone(capture.packet),pending=f.coordinator.reserveStreamedRemoteOriginal(supplied,packet,f.policy());
 supplied.binding.sourceHash=encodeE2eeBytes(new Uint8Array(32).fill(4));packet.command.payload.fence=999;await pending;
 const before=new Map(f.records.rows);await assert.rejects(f.coordinator.reserveStreamedRemoteOriginal(capture.registration,capture.packet,f.policy()),/ALREADY_RESERVED/);assert.deepEqual(f.records.rows,before);
 const state=await f.readState();assert.deepEqual(state.state.ownership.originals[0],structuredClone({registration:capture.registration,packet:capture.packet}));state.raw.fill(0);capture.observation.close();
});

test('missing or corrupt raw preparation metadata cannot become an empty resumed source',async t=>{
 for(const mode of ['missing','corrupt']){
  const f=await fixture(t);await f.coordinator.prepareStreamedPlanning(f.policy());const state=await f.readState(),id=state.state.ownership.sourceState.objectId;
  const key=[...f.records.rows.keys()].find(value=>value.endsWith(id));assert.ok(key);if(mode==='missing')f.records.rows.delete(key);else{const old=structuredClone(f.records.rows.get(key));old.envelope.ciphertext=(old.envelope.ciphertext[0]==='A'?'B':'A')+old.envelope.ciphertext.slice(1);f.records.rows.set(key,old);}
  const before=new Map(f.records.rows),calls=f.trace.length;await assert.rejects(f.coordinator.prepareStreamedPlanning(f.policy()));assert.equal(f.trace.length,calls);assert.deepEqual(f.records.rows,before);state.raw.fill(0);
 }
});

test('retirement during preparation and reservation cannot publish or send a late continuation',async t=>{
 for(const mode of ['prepare','reserve']){
  const f=await fixture(t);const ticket=mode==='reserve'?await f.coordinator.prepareStreamedPlanning(f.policy()):null,capture=ticket?await f.capture(ticket):null;
  const before=new Map(f.records.rows),calls=f.trace.length,policy=f.policy();let retired=false;
  policy.assertCurrent=()=>{if(retired)throw new Error('SYNTHETIC_RETIRED');};policy.admit=async()=>{retired=true;};
  const operation=capture?f.coordinator.reserveStreamedRemoteOriginal(capture.registration,capture.packet,policy):f.coordinator.prepareStreamedPlanning(policy);
  await assert.rejects(operation,/SYNTHETIC_RETIRED/);assert.equal(f.trace.length,calls);assert.deepEqual(f.records.rows,before);capture?.observation.close();
 }
});

test('source-changed lease renewal retains the exact signed renewal and never replaces original tokens',async t=>{
 const f=await fixture(t,{expired:true,sourceChanged:true});await assert.rejects(f.coordinator.prepareStreamedPlanning(f.policy()),/SOURCE_CHANGED/);
 const before=await f.readState(),saved=new Map(f.records.rows);await f.reopen();await assert.rejects(f.coordinator.prepareStreamedPlanning(f.policy()),/SOURCE_CHANGED/);
 assert.deepEqual(f.records.rows,saved);const renewals=f.trace.filter(value=>typeof value==='object'&&value.command.action==='migration-resume');assert.deepEqual(renewals[0],renewals[1]);before.raw.fill(0);
});

test('a provisioned device vault is mandatory and a changed verified directory refuses before publication',async t=>{
 const f=await fixture(t),before=new Map(f.records.rows),policy=f.policy();policy.device={vault:f.device.vault,deviceId:f.device.deviceId,ownerId:f.device.ownerId,requireOpen(){},async ensureDurableKeys(){}};
 await assert.rejects(f.coordinator.prepareStreamedPlanning(policy),/DEVICE_VAULT_REQUIRED/);assert.equal(f.trace.length,0);assert.deepEqual(f.records.rows,before);
 const existing=f.coordinator;f.directory.checkpoint.hash=encodeE2eeBytes(new Uint8Array(32).fill(17));
 await assert.rejects(f.make().prepareStreamedPlanning(f.policy()),/DIRECTORY_CONFLICT/);assert.deepEqual(f.records.rows,before);
 const ticket=await existing.prepareStreamedPlanning(f.policy());assert.ok(ticket.attemptId,'constructor owns its directory snapshot');
});

test('retirement during remote source discovery preserves local preparation without signing or applying a late continuation',async t=>{
 const options={},f=await fixture(t,options),policy=f.policy();let retired=false,before;
 policy.assertCurrent=()=>{if(retired)throw new Error('SYNTHETIC_RETIRED');};
 options.onSource=()=>{before=new Map(f.records.rows);retired=true;};
 await assert.rejects(f.coordinator.prepareStreamedPlanning(policy),/SYNTHETIC_RETIRED/);
 assert.deepEqual(f.records.rows,before);assert.deepEqual(f.trace,['source']);const saved=await f.readState();
 assert.equal(saved.state.sourceHash,null);assert.equal(saved.state.pending,null);assert.equal(saved.state.lease,null);saved.raw.fill(0);
});

test('late start and renewal receipts cannot advance a retired attempt and cold retry uses the exact signed command',async t=>{
 for(const action of ['migration-start','migration-resume']){
  const options={expired:action==='migration-resume'},f=await fixture(t,options),policy=f.policy();let retired=false,before;
  policy.assertCurrent=()=>{if(retired)throw new Error('SYNTHETIC_RETIRED');};
  options.onCommand=command=>{if(command.action===action){before=new Map(f.records.rows);retired=true;}};
  await assert.rejects(f.coordinator.prepareStreamedPlanning(policy),/SYNTHETIC_RETIRED/);assert.deepEqual(f.records.rows,before);
  const saved=await f.readState(),pending=structuredClone(action==='migration-start'?saved.state.pending:saved.state.resuming);
  assert.equal(pending.command.action,action);saved.raw.fill(0);delete options.onCommand;retired=false;await f.reopen();
  const ticket=await f.coordinator.prepareStreamedPlanning(f.policy());assert.ok(ticket.fence);
  const repeats=f.trace.filter(value=>typeof value==='object'&&value.command.action===action);assert.deepEqual(repeats,[pending,pending]);
 }
});

test('a mutable transport cannot rewrite the durably retained signed start packet',async t=>{
 const options={loss:'after'},f=await fixture(t,options);
 options.onCommand=(_command,packet)=>{assert.throws(()=>{packet.command.payload.sourceHash='MUTATED';},TypeError);assert.throws(()=>{packet.signature='MUTATED';},TypeError);};
 await assert.rejects(f.coordinator.prepareStreamedPlanning(f.policy()),/SYNTHETIC_PROCESS_DEATH/);const saved=await f.readState();
 assert.deepEqual(saved.state.pending,f.trace.find(value=>typeof value==='object'));saved.raw.fill(0);delete options.onCommand;await f.reopen();
 await f.coordinator.prepareStreamedPlanning(f.policy());const packets=f.trace.filter(value=>typeof value==='object');assert.deepEqual(packets[0],packets[1]);
});


test('coordinator owns two sequential captures under one nonreentrant fence and binds every complete byte reference',async t=>{
 let inside=false,entries=0;const f=await fixture(t,{withLocalWriteFence:async operation=>{assert.equal(inside,false);inside=true;entries++;try{return await operation();}finally{inside=false;}}});
 const before=entries;let calls=0;
 const receipt=await f.coordinator.withStreamedPlanning(async session=>{
  for(const action of ['legacy-workspace','legacy-tasks'])await session.requestLegacy(session.context,action,undefined,async(...args)=>{calls++;return sessionReply(f,...args);});
 },f.policy());
 assert.equal(entries,before+1);assert.equal(inside,false);assert.equal(calls,2);assert.equal(receipt.originals.length,2);
 for(const row of receipt.originals){assert.equal(row.completion.id,row.registration.id);assert.equal(row.completion.rawHash,hash(bytes(' {"rows":"SYNTHETIC ORIGINAL"} ')));}
 const saved=await f.readState();try{assert.equal(saved.state.ownership.protocol,2);assert.equal(saved.state.planned,false);}finally{saved.raw.fill(0);}
 await f.reopen();assert.equal((await f.coordinator.prepareStreamedPlanning(f.policy())).attemptId,receipt.ticket.attemptId);
 await assert.rejects(f.coordinator.run(),/STREAMED_PLANNER_REQUIRED/);
});

test('coordinator binds a complete original despite JSON refusal and keeps that failure sticky',async t=>{
 const f=await fixture(t),failure=new Error('SYNTHETIC_JSON_REFUSED');
 await assert.rejects(f.coordinator.withStreamedPlanning(async session=>{
  try{await session.requestLegacy(session.context,'legacy-workspace',undefined,async(...args)=>{await sessionReply(f,...args);throw failure;});}catch(error){assert.equal(error,failure);}
 },f.policy()),error=>error===failure);
 const saved=await f.readState();try{assert.ok(saved.state.ownership.originals[0].completion);}finally{saved.raw.fill(0);}
 await f.reopen();await f.coordinator.prepareStreamedPlanning(f.policy());
});

test('coordinator withholds a result after failed binding and cold repairs its exact retained original',async t=>{
 const f=await fixture(t);let adopted=false;
 await assert.rejects(f.coordinator.withStreamedPlanning(async session=>{
  await session.requestLegacy(session.context,'legacy-workspace',undefined,async(...args)=>{const response=await sessionReply(f,...args);f.records.fail=true;return response;});adopted=true;
 },f.policy()),/SYNTHETIC_DISK_FULL/);
 assert.equal(adopted,false);const saved=await f.readState();try{assert.equal(saved.state.ownership.originals.length,1);assert.equal(saved.state.ownership.originals[0].completion,null);}finally{saved.raw.fill(0);}
 const originals=new Map([...f.records.rows].filter(([key])=>key.includes('remote-original:')));f.records.fail=false;await f.reopen();
 const receipt=await f.coordinator.withStreamedPlanning(async()=>{},f.policy());assert.equal(receipt.originals.length,1);assert.ok(receipt.originals[0].completion);
 assert.deepEqual(new Map([...f.records.rows].filter(([key])=>key.includes('remote-original:'))),originals);
});

test('coordinator rejects an altered completion reference before another HTTP request and preserves its ciphertext',async t=>{
 const f=await fixture(t);await f.coordinator.withStreamedPlanning(async session=>{await session.requestLegacy(session.context,'legacy-workspace',undefined,(...args)=>sessionReply(f,...args));},f.policy());
 const saved=await f.readState();saved.state.ownership.originals[0].completion.rawHash=hash('changed-reference');
 const stateId='migration:'+hash(bytes(f.directory.scopeId));await f.device.vault.write([{domain:'local-snapshot',objectId:stateId,expected:saved.serial,value:bytes(JSON.stringify(saved.state))}]);saved.raw.fill(0);
 const retained=structuredClone(f.records.rows);let called=false;
 await assert.rejects(f.coordinator.withStreamedPlanning(async session=>{called=true;await session.requestLegacy(session.context,'legacy-workspace',undefined,(...args)=>sessionReply(f,...args));},f.policy()),/MIGRATION_HISTORY_REVIEW_REQUIRED/);
 assert.equal(called,false);assert.deepEqual(f.records.rows,retained);
});

test('signed transport routes all ten legacy actions and page/fragment forms through the live owned session',async t=>{
 const f=await fixture(t),actions=[];let escaped,context;
 const receipt=await f.coordinator.withStreamedPlanning(async session=>{
  context=session.context;
  const transport=new SignedMigrationTransport(f.device,f.directory,['workspace'],async(path,packet,observation,signal)=>{
   assert.equal(path,'/read');assert.ok(observation);assert.equal(signal.aborted,false);actions.push(packet.command.action);await verifyE2eeCommand(packet,f.device.keys().signing.publicKey);return sessionReply(f,packet,observation,signal);
  },session);escaped=transport;
  for(const method of ['legacyWorkspace','legacyAurora','legacyStoicheion','legacyAdvice','legacyTasks','legacyDiary','legacyMindmaps'])await transport[method](context);
  await transport.legacyMindmapsPage(context,'maps',1);await transport.legacyPhysisPage(context,'records',2);await transport.legacyRemindersPage(context,'habitDevices',3);await transport.legacyArchiveFragment(context,'safety',4,17);
 },f.policy());
 assert.equal(actions.length,11);assert.equal(new Set(actions).size,10);assert.equal(receipt.originals.length,11);assert.ok(receipt.originals.every(row=>row.completion!==null));
 const retained=structuredClone(f.records.rows);await assert.rejects(escaped.legacyTasks(context),/SESSION_CLOSED/);assert.equal(actions.length,11);assert.deepEqual(f.records.rows,retained);
});

test('signed transport refuses legacy HTTP without a current planning session while keeping bounded shadow reads separate',async t=>{
 const f=await fixture(t);let calls=0;
 const transport=new SignedMigrationTransport(f.device,f.directory,['workspace'],async()=>{calls++;return{};});
 const context={ownerId:f.directory.ownerId,scopeId:f.directory.scopeId,migrationId:crypto.randomUUID(),fence:1,sourceHash:encodeE2eeBytes(new Uint8Array(32)),generation:2};
 await assert.rejects(transport.legacyWorkspace(context),/STREAMED_CAPTURE_REQUIRED/);await assert.rejects(transport.legacyArchiveFragment(context,'safety',0,0),/STREAMED_CAPTURE_REQUIRED/);assert.equal(calls,0);
});


test('caught directory refusal poisons the whole owned session after retaining its complete raw response',async t=>{
 const f=await fixture(t);let caught=false;
 await assert.rejects(f.coordinator.withStreamedPlanning(async session=>{
  const port=new SignedMigrationTransport(f.device,f.directory,['workspace'],async(path,packet,observation,signal)=>{
   const value=await sessionReply(f,packet,observation,signal);return{...value,directoryRevision:f.directory.checkpoint.revision+1};
  },session);
  try{await port.legacyWorkspace(session.context);}catch(error){assert.match(error.message,/DIRECTORY_CONFLICT/);caught=true;}
 },f.policy()),/DIRECTORY_CONFLICT/);
 assert.equal(caught,true);const saved=await f.readState();try{assert.ok(saved.state.ownership.originals[0].completion);}finally{saved.raw.fill(0);}
});

test('caught public legacy page preflight refusal remains sticky without fetching or storing an original',async t=>{
 const f=await fixture(t);let calls=0,caught=false;
 await assert.rejects(f.coordinator.withStreamedPlanning(async session=>{
  const port=new SignedMigrationTransport(f.device,f.directory,['workspace'],async()=>{calls++;return{};},session);
  try{await port.legacyMindmapsPage(session.context,'users',0);}catch(error){assert.match(error.message,/LEGACY_PAGE_INVALID/);caught=true;}
 },f.policy()),/LEGACY_PAGE_INVALID/);
 assert.equal(caught,true);assert.equal(calls,0);assert.equal((await f.readState()).state.ownership.originals.length,0);
});

for(const kind of ['project','space'])test(`owned ${kind} map pages bind all six raw forms and cold-read without an aggregate transport`,async t=>{
 const f=await fixture(t,{kind}),tables=['maps','versions','receipts','deletions','deletionScopes','conversions'],requests=[];let escaped,context;
 const receipt=await f.coordinator.withStreamedPlanning(async session=>{
  context=session.context;
  const port=new SignedMigrationTransport(f.device,f.directory,['mindmap'],async(path,packet,observation,signal)=>{
   assert.equal(path,'/read');assert.equal(packet.command.action,'legacy-shared-mindmaps');assert.equal(packet.command.scopeId,f.directory.scopeId);
   await verifyE2eeCommand(packet,f.device.keys().signing.publicKey);requests.push(packet.command.payload.table);return sessionReply(f,packet,observation,signal);
  },session);escaped=port;
  for(const table of tables)await port.legacySharedMindmapsPage(context,table,0);
 },f.policy());
 assert.deepEqual(requests,tables);assert.equal(receipt.originals.length,6);assert.ok(receipt.originals.every(row=>row.completion&&row.registration.context.kind===kind));
 const retained=structuredClone(f.records.rows);await assert.rejects(escaped.legacySharedMindmapsPage(context,'maps',0),/SESSION_CLOSED/);assert.deepEqual(f.records.rows,retained);
 await f.reopen();await f.coordinator.prepareStreamedPlanning(f.policy());assert.deepEqual(f.records.rows,retained);
 let caught=false;await assert.rejects(f.coordinator.withStreamedPlanning(async session=>{
  const port=new SignedMigrationTransport(f.device,f.directory,['mindmap'],async()=>{throw new Error('UNEXPECTED_HTTP');},session);
  try{await port.legacySharedMindmapsPage(session.context,'users',0);}catch(error){assert.match(error.message,/LEGACY_PAGE_INVALID/);caught=true;}
 },f.policy()),/LEGACY_PAGE_INVALID/);
 assert.equal(caught,true);assert.equal(requests.length,6);assert.deepEqual(f.records.rows,retained);
});

test('personal planning cannot request a shared map original even when the public scope refusal is caught',async t=>{
 const f=await fixture(t);let calls=0,caught=false;
 await assert.rejects(f.coordinator.withStreamedPlanning(async session=>{
  const port=new SignedMigrationTransport(f.device,f.directory,['mindmap'],async()=>{calls++;return{};},session);
  try{await port.legacySharedMindmapsPage(session.context,'maps',0);}catch(error){assert.match(error.message,/SCOPE_BINDING_MISMATCH/);caught=true;}
 },f.policy()),/SCOPE_BINDING_MISMATCH/);
 assert.equal(calls,0);assert.equal(caught,true);const row=await f.readState();try{assert.equal(row.state.ownership.originals.length,0);}finally{row.raw.fill(0);}
});

const contentPolicy=f=>({...f.policy(),planCapacity:{maximumBytes:16*1024*1024,maximumEnvelopes:200,maximumLocalParts:200},async admitPlan(){}});
async function buildSyntheticPlan(f,session,options={}){
 for(const source of [session.sources.current,...session.sources.previous])for(const path of source.paths){
  const reader=await source.openPath(path);for await(const part of reader.chunks)part.fill(0);reader.assertComplete();
 }
 if(!options.skipOriginals)for(const original of session.originals)await session.withOriginal(original.completion.id,async source=>{
  await session.emit('personal.workspace',{domain:'workspace',objectId:'synthetic-remote-original',placement:'remote',size:original.completion.size,source});
 });
 if(!session.originals.length){
  const value=bytes('SYNTHETIC NORMALIZED CONTENT');await session.emit(f.stage.paths[0],{domain:f.directory.kind==='personal'?'workspace':'shared-project',objectId:'synthetic-content',placement:'remote',size:value.length,source:(async function*(){yield value;})()});
 }
 return f.stage.paths.map(domain=>({domain,complete:true}));
}
async function openOwnedPlan(f,receipt){
 const saved=await f.readState();try{
  const plan=saved.state.ownership.plans.find(row=>row.attemptId===receipt.plan.attemptId);
  return await openMigrationContentPlan({vault:f.device.vault,root:f.root,signer:f.device.keys().signing.publicKey,context:plan.context,target:f.stage.target,
   migrationId:saved.state.migrationId,sourceHash:saved.state.sourceHash,paths:f.stage.paths,assertCurrent(){},reference:receipt.plan});
 }finally{saved.raw.fill(0);}
}

test('state4 reserves exact plan provenance before its first journal and adopts bounded content without upload',async t=>{
 let fenced=false,count=0;
 const f=await fixture(t,{withLocalWriteFence:async run=>{assert.equal(fenced,false);fenced=true;count++;try{return await run();}finally{fenced=false;}}});
 await f.coordinator.withStreamedPlanning(async session=>{await session.requestLegacy(session.context,'legacy-workspace',undefined,(...args)=>sessionReply(f,...args));},f.policy());
 const before=await f.readState(),calls=f.trace.length,priorFences=count;
 f.records.afterCommit=async changes=>{
  const journal=changes.find(row=>row.value?.envelope.context.objectId.startsWith('content-plan:'));if(!journal)return;
  const state=await f.readState();try{assert.equal(fenced,true);const attempt=journal.value.envelope.context.objectId.split(':')[1],owned=state.state.ownership.plans.find(row=>row.attemptId===attempt);
   assert.ok(owned);assert.deepEqual(owned.originals,before.state.ownership.originals.map(row=>row.completion));assert.equal(owned.context.dataGeneration,state.state.lease.generation);
  }finally{state.raw.fill(0);}
 };
 const receipt=await f.coordinator.planStreamedContent(session=>buildSyntheticPlan(f,session),contentPolicy(f)),after=await f.readState(),opened=await openOwnedPlan(f,receipt);
 assert.equal(count-priorFences,1);assert.equal(f.trace.length,calls);assert.equal(after.state.phase,'preparing');assert.equal(after.state.planned,false);assert.deepEqual(after.state.plan,[]);
 assert.deepEqual(after.state.ownership.plans[0].completion,receipt.plan);assert.equal(opened.logical.length,1);assert.equal(opened.logical[0].plaintextHash,before.state.ownership.originals[0].completion.rawHash);
 const kept=structuredClone(f.records.rows);await f.reopen();const reused=await f.coordinator.planStreamedContent(async()=>{throw new Error('EXACT_COMPLETE_PLAN_MUST_REOPEN');},contentPolicy(f));
 assert.deepEqual(reused,receipt);assert.deepEqual(f.records.rows,kept);
 await assert.rejects(f.coordinator.run(),/STREAMED_PLANNER_REQUIRED/);assert.equal(f.trace.length,calls);before.raw.fill(0);after.raw.fill(0);
});

test('lost plan binding preserves the complete manifest and cold repairs only its exact reserved reference',async t=>{
 const f=await fixture(t);let stopped=false;
 f.records.afterCommit=async changes=>{
  for(const row of changes)if(row.value?.envelope.context.objectId.startsWith('content-plan:')&&row.value.envelope.context.objectId.endsWith(':manifest')&&!stopped){stopped=true;f.records.fail=true;}
 };
 await assert.rejects(f.coordinator.planStreamedContent(session=>buildSyntheticPlan(f,session),contentPolicy(f)),/SYNTHETIC_DISK_FULL/);
 const prior=await f.readState(),reservation=prior.state.ownership.plans[0];assert.equal(reservation.completion,null);
 const manifest=await f.device.vault.read('local-snapshot',`content-plan:${reservation.attemptId}:manifest`);assert.ok(manifest);const manifestHash=hash(manifest.value);manifest.value.fill(0);
 f.records.fail=false;await f.reopen();const receipt=await f.coordinator.planStreamedContent(async()=>{throw new Error('REBUILD_FORBIDDEN');},contentPolicy(f));
 assert.deepEqual(receipt.plan,{attemptId:reservation.attemptId,manifestHash});assert.equal((await f.coordinator.status()).ownership.plans.length,1);prior.raw.fill(0);
});

test('a caught late output error is sticky and its authenticated partial attempt survives a successful retry',async t=>{
 const f=await fixture(t);let attempted=false;
 await assert.rejects(f.coordinator.planStreamedContent(async session=>{
  for(const source of [session.sources.current,...session.sources.previous])for(const path of source.paths){const reader=await source.openPath(path);for await(const part of reader.chunks)part.fill(0);reader.assertComplete();}
  try{await session.emit('personal.workspace',{domain:'workspace',objectId:'partial',placement:'remote',size:E2EE_CHUNK_BYTES+1,source:(async function*(){yield new Uint8Array(E2EE_CHUNK_BYTES).fill(4);attempted=true;throw new Error('SYNTHETIC_LATE_TAG');})()});}catch{/* The session must retain this caught failure. */}
  return f.stage.paths.map(domain=>({domain,complete:true}));
 },contentPolicy(f)),/SYNTHETIC_LATE_TAG/);assert.equal(attempted,true);
 const prior=await f.readState(),attempt=prior.state.ownership.plans[0].attemptId,kept=new Map([...f.records.rows].filter(([id])=>id.includes(attempt)));
 assert.ok(kept.size>1);assert.ok((await f.device.vault.listLocal('outbox',attempt+':upload:')).length>0);
 await f.reopen();const receipt=await f.coordinator.planStreamedContent(session=>buildSyntheticPlan(f,session),contentPolicy(f));assert.notEqual(receipt.plan.attemptId,attempt);
 for(const[id,row]of kept)assert.deepEqual(f.records.rows.get(id),row);assert.equal((await f.coordinator.status()).ownership.plans.length,2);prior.raw.fill(0);
});

test('a complete plan requires actual local and remote EOF and never adopts an omitted original',async t=>{
 for(const mode of ['local','remote']){
  const f=await fixture(t);await f.coordinator.withStreamedPlanning(async session=>{await session.requestLegacy(session.context,'legacy-workspace',undefined,(...args)=>sessionReply(f,...args));},f.policy());
  await assert.rejects(f.coordinator.planStreamedContent(async session=>{
   if(mode==='remote'){
    await buildSyntheticPlan(f,session,{skipOriginals:true});
    await session.emit('personal.workspace',{domain:'workspace',objectId:'other',placement:'local',size:0,source:(async function*(){})()});
   }else await session.withOriginal(session.originals[0].completion.id,async source=>{await session.emit('personal.workspace',{domain:'workspace',objectId:'other',placement:'remote',size:session.originals[0].completion.size,source});});
   return f.stage.paths.map(domain=>({domain,complete:true}));
  },contentPolicy(f)),mode==='local'?/SOURCE_INPUT_EOF_REQUIRED/:/REMOTE_ORIGINAL_INCOMPLETE_READ/);
  const saved=await f.readState();assert.equal(saved.state.ownership.plans[0].completion,null);assert.equal(saved.state.planned,false);saved.raw.fill(0);
 }
});

test('unknown plan metadata and journal-free outputs refuse before a later request and preserve every row',async t=>{
 for(const mode of ['journal','remote','local']){
  const f=await fixture(t);await f.coordinator.prepareStreamedPlanning(f.policy());
  const id=crypto.randomUUID(),objectId=mode==='journal'?`content-plan:${id}:journal`:mode==='remote'?`${id}:upload:0`:`${id}:private:0:0`;
  await f.device.vault.write([{domain:mode==='remote'?'outbox':'local-snapshot',objectId,value:bytes('SYNTHETIC UNKNOWN ROLE'),expected:null}]);
  const kept=structuredClone(f.records.rows),calls=f.trace.length;
  await assert.rejects(f.coordinator.withStreamedPlanning(async()=>{throw new Error('CONSUMER_MUST_NOT_RUN');},f.policy()),mode==='remote'?/PRODUCT_CUSTODY_REVIEW_REQUIRED/:/MIGRATION_HISTORY_REVIEW_REQUIRED/);
  assert.deepEqual(f.records.rows,kept);assert.equal(f.trace.length,calls);
 }
});

test('a multi-request session durably renews an expired lease while retaining earlier original bindings',async t=>{
 const f=await fixture(t),now=Date.now;let elapsed=0;Date.now=()=>now()+elapsed;
 try{
  const receipt=await f.coordinator.withStreamedPlanning(async session=>{
   await session.requestLegacy(session.context,'legacy-workspace',undefined,(...args)=>sessionReply(f,...args));elapsed=3600*1000;
   await session.requestLegacy(session.context,'legacy-workspace',undefined,(...args)=>sessionReply(f,...args));
  },f.policy());
  assert.equal(receipt.ticket.fence,2);assert.equal(receipt.originals.length,2);assert.ok(receipt.originals.every(row=>row.completion));
  assert.deepEqual(f.trace.filter(row=>typeof row==='object').map(row=>row.command.action),['migration-start','migration-resume']);
 }finally{Date.now=now;}
});

test('shared fragment collection survives a verified lease renewal and preserves the original signed fences',async t=>{
 const f=await fixture(t,{kind:'project'}),schema=privatePathSource('project','project.content'),now=Date.now;let elapsed=0,calls=0;
 Date.now=()=>now()+elapsed;
 try{
  const receipt=await f.coordinator.withStreamedPlanning(async session=>{
   const transport=new SignedMigrationTransport(f.device,f.directory,['shared-project'],async(path,packet,observation,signal)=>{
    assert.equal(path,'/read');await verifyE2eeCommand(packet,f.device.keys().signing.publicKey);
    const payload=packet.command.payload,fragment={protocol:1,ownerId:session.context.ownerId,scopeId:session.context.scopeId,kind:'project',resourceId:f.directory.resourceId,
     migrationId:payload.migrationId,fence:payload.fence,sourceHash:payload.sourceHash,checkpointHash:f.directory.checkpoint.hash,directoryRevision:f.directory.checkpoint.revision,
     pathId:payload.pathId,table:payload.table,offset:payload.offset,byteOffset:payload.byteOffset,totals:Object.fromEntries(schema.server.map(name=>[name,0])),
     rowBytes:0,rowHash:null,chunk:'',nextByteOffset:null,nextOffset:null};
    const {totals,rowBytes,rowHash,chunk,nextByteOffset,nextOffset,...header}=fragment;void totals;void rowBytes;void rowHash;void chunk;void nextByteOffset;void nextOffset;
    const response={...header,fragments:[fragment]};
    await sessionReply(f,packet,observation,signal,200,JSON.stringify(response));calls++;elapsed=3600*1000;return response;
   },session);
   const result=await collectPrivatePathFragments(session.context,{kind:'project',resourceId:f.directory.resourceId,pathId:'project.content'},
    {assertCurrent(){},read(){throw new Error('BATCH_REQUIRED');},readBatch:(...args)=>transport.legacyPrivatePathBatch(...args)});
   assert.deepEqual(Object.keys(result.tables),schema.server);
  },f.policy());
  assert.equal(calls,schema.tables.length);assert.equal(receipt.ticket.fence,2);
  assert.deepEqual(receipt.originals.map(row=>row.registration.binding.fence),[1,...schema.tables.slice(1).map(()=>2)]);
 }finally{Date.now=now;}
});

test('invalid plan capacity refuses before source discovery or a plan reservation',async t=>{
 const f=await fixture(t),kept=structuredClone(f.records.rows),policy=contentPolicy(f);policy.planCapacity.maximumEnvelopes=0;
 await assert.rejects(f.coordinator.planStreamedContent(session=>buildSyntheticPlan(f,session),policy),/CONTENT_PLAN_CAPACITY/);assert.equal(f.trace.length,0);assert.deepEqual(f.records.rows,kept);
});
