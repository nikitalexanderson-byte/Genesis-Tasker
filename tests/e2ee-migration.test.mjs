import assert from 'node:assert/strict';
import { test } from 'node:test';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import { E2eeMigration } from '../app/e2ee/migration.ts';
import { E2eeMigrationSources, requiredPrivatePaths } from '../app/e2ee/migration-sources.ts';
import { E2eeScopeClient } from '../app/e2ee/scope-client.ts';
import { SignedMigrationTransport } from '../app/e2ee/migration-transport.ts';
import { verifyDeviceDirectory } from '../app/e2ee/directory.ts';
import { UnlockedE2eeVault } from '../app/e2ee/storage.ts';
import { generateDeviceKeys, freshSecret, createRecoveryKit, publicDeviceKeys, sealRoot } from '../app/e2ee/keys.ts';
import { importE2eeRoot, encodeE2eeBytes } from '../app/e2ee/envelope.ts';
import { signE2eeCommand, verifyE2eeCommand, e2eeCommandHash } from '../app/e2ee/commands.ts';
import { envelopePayloadHash, objectManifestHash } from '../app/e2ee/files.ts';
import {ProtectedSourceStage,inspectSourceStages,openSourceStage} from '../app/e2ee/source-stage.ts';
import {calendarModule} from './helpers/calendar-modules.mjs';
import {MemoryStorage} from './helpers/cloud-sync-client.mjs';

class AtomicStorage {
  rows=new Map(); fail=false;
  async get(key){return structuredClone(this.rows.get(key)??null);}
  async list(prefix){return [...this.rows.keys()].filter(key=>key.startsWith(prefix));}
  async commit(changes){
    if(this.fail)throw new Error('SYNTHETIC_DISK_FULL');
    for(const change of changes)if((this.rows.get(change.key)?.serial??null)!==change.expected)throw new Error('E2EE_LOCAL_CONFLICT');
    const rows=new Map(this.rows);
    for(const change of changes){if(change.value===null)rows.delete(change.key);else rows.set(change.key,structuredClone(change.value));}this.rows=rows;await this.afterCommit?.(changes);
  }
}
const bytes=value=>new TextEncoder().encode(value);
async function fixture(options={}){
  const keys=await generateDeviceKeys(),raw=freshSecret(),root=await importE2eeRoot(raw),storage=new AtomicStorage();
  const kind=options.registryKind??'personal',scopeId=`${kind}:owner`,recovery=await createRecoveryKit('owner'),pub=await publicDeviceKeys(keys);
  const recipient={ownerId:'owner',scopeId,cryptoEpoch:1,keyId:'root-one',recipientId:'device'};
  const bootstrap={protocol:1,ownerId:'owner',scopeId,deviceId:'device',action:'bootstrap',expectedRevision:0,checkpointHash:'genesis',securityEpoch:1,operationId:'bootstrap',payload:{
    kind,resourceId:'owner',keyId:'root-one',generation:1,recoveryKit:recovery.kit,deviceKeys:pub,
    deviceCapsule:await sealRoot(raw,pub.receivingKey,recipient),recoveryCapsule:await sealRoot(raw,recovery.kit.authority.receivingKey,{...recipient,recipientId:'recovery'})}};
  bootstrap.payload.selfProof=(await signE2eeCommand(bootstrap,keys.signing.privateKey)).signature;
  const events=[await signE2eeCommand(bootstrap,recovery.keys.signing.privateKey)];
  let directory=await verifyDeviceDirectory('owner',scopeId,recovery.kit.authority,events);
  const vault=new UnlockedE2eeVault(storage,{...directory,deviceId:'device',signingKey:keys.signing.privateKey,
    roots:new Map([['root-one',root]]),trustedSigner:()=>keys.signing.publicKey});
  const trace=[],server={objects:new Map(),receipts:new Map(),state:'legacy',count:0,crashed:new Set(),fence:1,generation:1,expired:false,expiredOnce:false,commands:[]};
  const currentObjects=()=>[...server.objects.values()].filter(e=>e.context.dataGeneration===server.generation);
  const transport={
    async sourceHash(){trace.push('network-source');assert.ok([...storage.rows.values()].some(row=>row.envelope.context.objectId.startsWith('migration:')));return encodeE2eeBytes(new Uint8Array(32).fill(13));},
    async command(packet){
      const command=await verifyE2eeCommand(packet,keys.signing.publicKey);trace.push('network-'+command.action);
      server.commands.push(structuredClone(packet));
      const identity=await e2eeCommandHash(command),old=server.receipts.get(command.operationId);
      if(old){assert.equal(old.identity,identity,'retry must reuse the exact ciphertext/context payload');return old.result;}
      const index=server.count++,payload=command.payload;let result;
      if(options.crashBefore===index&&!server.crashed.has(index)){server.crashed.add(index);throw new Error('SYNTHETIC_PROCESS_DEATH');}
      if(options.expireBefore===index&&!server.expiredOnce){server.expiredOnce=true;server.expired=true;throw new Error('E2EE_MIGRATION_FENCED');}
      if(['put','migration-verify','migration-commit'].includes(command.action)
        &&(server.expired||payload.fence!==server.fence))throw new Error('E2EE_MIGRATION_FENCED');
      if(command.action==='migration-start'){
        if(server.migrationId&&server.migrationId!==payload.migrationId){server.generation++;server.fence++;}
        server.migrationId=payload.migrationId;server.state='uploading';server.expired=false;
        result={fence:server.fence,leaseUntil:2_000_000_000,generation:server.generation};
      }
      else if(command.action==='migration-resume'){
        assert.equal(payload.fence,server.fence);if(options.changedSource)throw new Error('E2EE_SOURCE_CHANGED');
        if(options.resumeCrashBefore&&!server.resumeCrashed){server.resumeCrashed=true;throw new Error('SYNTHETIC_PROCESS_DEATH');}
        server.expired=false;server.fence++;
        const receipt=server.receipts.get(payload.pendingOperationId);
        result={fence:server.fence,leaseUntil:2_000_000_000,generation:server.generation,pendingReceipt:receipt?{payloadHash:receipt.identity,result:receipt.result}:null};
      }
      else if(command.action==='put'){
        assert.equal(server.state,'uploading');const envelope=payload.envelope,id=`${server.generation}\0${envelope.context.domain}\0${envelope.context.objectId}`;
        assert.ok(!server.objects.has(id));server.objects.set(id,envelope);result={revision:1,payloadHash:await envelopePayloadHash(envelope),generation:server.generation};
      }else if(command.action==='migration-verify'){
        assert.equal(payload.manifestHash,await objectManifestHash(await Promise.all(currentObjects().map(async envelope=>({domain:envelope.context.domain,
          objectId:envelope.context.objectId,revision:1,payloadHash:await envelopePayloadHash(envelope)})))));
        assert.equal(payload.objectCount,currentObjects().length);server.state='verified';result={state:'verified',manifestHash:payload.manifestHash};
      }else if(command.action==='migration-commit'){
        assert.equal(server.state,'verified');server.state='active';
        events.push(packet);directory=await verifyDeviceDirectory('owner',scopeId,recovery.kit.authority,events);
        const hash=encodeE2eeBytes(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes(`${command.checkpointHash}\0${await e2eeCommandHash(command)}`))));
        result={state:'active',directoryRevision:command.expectedRevision+1,checkpointHash:options.poisonCheckpoint?'unsigned-server-value':hash};
      }
      else if(command.action==='migration-cancel'){assert.notEqual(server.state,'active');server.state='legacy';result={state:'preparing'};}
      else throw new Error('unexpected command');
      server.receipts.set(command.operationId,{identity,result});
      if(command.action==='migration-resume'&&options.resumeCrashAfter&&!server.resumeCrashed){server.resumeCrashed=true;throw new Error('SYNTHETIC_PROCESS_DEATH');}
      if(options.crashAfter===index&&!server.crashed.has(index)){server.crashed.add(index);throw new Error('SYNTHETIC_PROCESS_DEATH');}
      return result;
    },
    async readAll(){trace.push('read-back');const rows=currentObjects();return options.truncate?rows.slice(1):rows;},
  };
  let sources={
    requiredCoverage:['workspace','diary'],allowedContentDomains:['workspace','diary'],
    async captureLocal(){if(!trace.includes('snapshot-local'))assert.ok(!trace.some(row=>row.startsWith('network-')));trace.push('snapshot-local');return bytes('LOCAL DRAFT + UNSENT OUTBOX + TOMBSTONES');},
    async reconcile(snapshot,previousSnapshots,context){trace.push('reconcile-after-snapshot');server.previousSnapshots=previousSnapshots.map(value=>new TextDecoder().decode(value));assert.equal(new TextDecoder().decode(snapshot),'LOCAL DRAFT + UNSENT OUTBOX + TOMBSTONES');
      assert.deepEqual(context,{ownerId:'owner',scopeId,migrationId:server.migrationId,fence:server.fence,sourceHash:encodeE2eeBytes(new Uint8Array(32).fill(13)),generation:server.generation});
      options.afterReconcile?.({storage,server});
      return{coverage:[{domain:'workspace',complete:!options.incomplete},{domain:'diary',complete:true}],content:options.localOnly?[]:[{domain:'workspace',objectId:'workspace',bytes:bytes('PERSONAL DATA INCLUDING OFFLINE EDIT')},
        {domain:'diary',objectId:'note',bytes:bytes('PRIVATE NOTE + DELETION LEDGER')}],localContent:options.localOnly||options.withLocal?
        [{domain:'diary',objectId:'device-private-note',bytes:options.localBytes?.slice()??bytes('DEVICE-ONLY PRIVATE DIARY + DRAFT'),filename:'Private diary title.json',mediaType:'application/json'}]:[]};},
  };
  if(options.registrySources){
    sources=new E2eeMigrationSources('owner',scopeId,kind);
    for(const path of requiredPrivatePaths(kind)){
      if(path.id===options.missingPath)continue;
      const actual=await options.sourceAdapter?.(path,{storage,server,trace,vault,scopeId});
      if(actual){assert.equal(actual.id,path.id);sources.register(actual);continue;}
      sources.register({id:path.id,async captureLocal(){trace.push('snapshot-local');return bytes(`local:${path.id}`);},
        async reconcile(local,_previous,context){assert.equal(new TextDecoder().decode(local),`local:${path.id}`);
          assert.equal(context.migrationId,server.migrationId);assert.equal(context.fence,server.fence);assert.equal(context.scopeId,scopeId);
          return{complete:path.id!==options.incompletePath,content:[{domain:path.id==='project.content'?'shared-comment':path.domains[0],objectId:path.id,bytes:bytes(`reconciled:${path.id}`)}]};}});
    }
  }
  const make=(scopeId=directory.scopeId)=>new E2eeMigration({vault,directory:{...directory,scopeId},deviceId:'device',signingKey:keys.signing.privateKey,signer:keys.signing.publicKey,root,transport,sources,
    ensureDurableKeys:async()=>{trace.push('durable-key-check');if(options.missingKeys)throw new Error('KEYS_NOT_DURABLE');},
    withLocalWriteFence:async operation=>{trace.push('local-writer-fence');return operation();},verifyRecovery:async()=>{trace.push('recovery-checked');if(options.badRecovery)throw new Error('RECOVERY_FAILED');}});
  return{storage,server,trace,make,transport,vault,keys,root,events,recovery,scopeId,sources};
}

function stagedInput(f,producer){
 const paths=[...f.sources.requiredCoverage],target={ownerId:'owner',scopeId:f.scopeId,kind:f.scopeId.split(':')[0]};
 return{target,paths,async capturePath(id,write){assert.ok(paths.includes(id));if(producer)await producer(id,write);else await write(bytes('STAGED ORIGINAL '+id));}};
}
function stagedOptions(){return{capacity:{maximumBytes:4*1024*1024,maximumParts:16},assertCurrent(){},async admit(){}};}
function historyOptions(){return{capacity:{maximumBytes:8*1024*1024,maximumParts:128,maximumMetadataBytes:4*1024*1024},assertCurrent(){},async admit(){}};}
async function readHistory(input){
 const result=[];
 for(const source of [input.current,...input.previous]){const values=[];for(const path of source.paths){const reader=source.openPath(path),parts=[];
  for await(const part of reader.chunks)parts.push(Buffer.from(part));reader.assertComplete();values.push(Buffer.concat(parts).toString());}
  result.push({id:source.id,values});
 }
 return result;
}

test('actual coordinator resolves mixed v1/v2/v3 originals and a complete orphan through bounded local history with no transport',async()=>{
 for(const protocol of [1,2]){
  const f=await fixture({registrySources:true,registryKind:'project'}),migration=f.make();await migration.prepare();
  if(protocol===1){const id=[...f.storage.rows.values()].find(row=>row.envelope.context.objectId.startsWith('migration:')).envelope.context.objectId;
   const row=await f.vault.read('local-snapshot',id),state=JSON.parse(new TextDecoder().decode(row.value));row.value.fill(0);state.protocol=1;delete state.local;delete state.planned;
   await f.vault.write([{domain:'local-snapshot',objectId:id,value:bytes(JSON.stringify(state)),expected:row.serial}]);}
  await migration.cancel();const capture=stagedInput(f),stage=await ProtectedSourceStage.create({vault:f.vault,target:capture.target,paths:capture.paths,...stagedOptions(),ensureDurableKeys:async()=>{}});
  for(const path of capture.paths)await stage.capturePath(path,async write=>write(bytes('ORPHAN '+path)));const orphan=await stage.finish();
  await migration.prepareStaged(capture,stagedOptions());await migration.cancel();await migration.restartStaged(capture,stagedOptions());
  f.sources.captureLocal=async()=>{throw new Error('NO_AGGREGATE_CAPTURE');};const before=structuredClone(f.storage.rows);let retained,admission;
  const result=await f.make().withStagedSourceHistory(async input=>{retained=input;return readHistory(input);},{...historyOptions(),admit:async value=>{admission=value;}});
  assert.equal(result.length,4);assert.equal(result[0].values[0],'STAGED ORIGINAL '+capture.paths[0]);
  assert.equal(result[1].values[0],'local:'+capture.paths[0]);assert.equal(result[2].id,'stage:'+orphan.stageId);assert.equal(result[2].values[0],'ORPHAN '+capture.paths[0]);
  assert.equal(result[3].values[0],'STAGED ORIGINAL '+capture.paths[0]);assert.equal(admission.sources,4);assert.ok(admission.metadataBytes>0&&admission.parts>0&&admission.bytes>0);
  assert.deepEqual(f.storage.rows,before);assert.equal(f.server.count,0);assert.ok(!f.trace.includes('network-source'));
  assert.throws(()=>retained.current.openPath(capture.paths[0]),/HISTORY_CLOSED/);
 }
});

test('coordinator history requires every current and ancestor path EOF and refuses caught prefix or concurrent-reader failures',async()=>{
 for(const mode of ['empty','prefix','missed-history','caught-busy']){
  const f=await fixture({registrySources:true,registryKind:'project'}),migration=f.make();await migration.prepare();await migration.cancel();await migration.prepareStaged(stagedInput(f),stagedOptions());
  const kept=structuredClone(f.storage.rows);await assert.rejects(migration.withStagedSourceHistory(async input=>{
   if(mode==='empty')return;
   if(mode==='prefix'){const reader=input.current.openPath(input.current.paths[0]);await reader.chunks.next();await reader.chunks.return();return;}
   if(mode==='missed-history'){await readHistory({current:input.current,previous:[]});return;}
   const reader=input.current.openPath(input.current.paths[0]);assert.throws(()=>input.previous[0].openPath(input.current.paths[0]),/INPUT_BUSY/);await reader.chunks.return();
  },historyOptions()),/EOF_REQUIRED/);assert.deepEqual(f.storage.rows,kept);assert.equal(f.server.count,0);
 }
});

test('unknown original prefix, missing cancelled archive, changed original parts and new incomplete stages refuse without a consumer',async()=>{
 for(const mode of ['unknown','missing','corrupt','incomplete']){
  const f=await fixture({registrySources:true,registryKind:'project'}),migration=f.make();await migration.prepare();await migration.cancel();const capture=stagedInput(f);await migration.prepareStaged(capture,stagedOptions());const state=await migration.status();
  if(mode==='unknown')await f.vault.write([{domain:'local-snapshot',objectId:'unresolved:source:0',value:bytes('UNKNOWN ORIGINAL'),expected:null}]);
  if(mode==='missing'){const key=[...f.storage.rows.keys()].find(key=>key.endsWith(state.ancestors[0]));f.storage.rows.delete(key);}
  if(mode==='corrupt'){const id=[...f.storage.rows.values()].find(row=>row.envelope.context.objectId.includes(':source:')).envelope.context.objectId;const row=await f.vault.read('local-snapshot',id);row.value.fill(0);
   await f.vault.write([{domain:'local-snapshot',objectId:id,value:bytes('changed'),expected:row.serial}]);}
  if(mode==='incomplete')await ProtectedSourceStage.create({vault:f.vault,target:capture.target,paths:capture.paths,...stagedOptions(),ensureDurableKeys:async()=>{}});
  const kept=structuredClone(f.storage.rows);let called=0;await assert.rejects(migration.withStagedSourceHistory(async()=>{called++;},historyOptions()),/E2EE_/);
  assert.equal(called,0);assert.deepEqual(f.storage.rows,kept);assert.equal(f.server.count,0);
 }
});

test('original raw duplicate metadata, non-cancelled ancestors and holes in the ancestor chain never project into a valid source',async()=>{
 for(const mode of ['duplicate','active','hole']){
  const f=await fixture({registrySources:true,registryKind:'project'}),migration=f.make();await migration.prepare();await migration.cancel();await migration.prepareStaged(stagedInput(f),stagedOptions());const state=await migration.status(),id=state.ancestors[0];
  const row=await f.vault.read('local-snapshot',id),old=JSON.parse(new TextDecoder().decode(row.value));row.value.fill(0);
  if(mode==='active')old.phase='active';if(mode==='hole')old.ancestors=['unknown:archive'];
  let raw=JSON.stringify(old);if(mode==='duplicate')raw=raw.replace('"protocol":2','"protocol":1,"pr\\u006ftocol":2');
  // Re-seal as an immutable original to test the history decoder, not only serial guards.
  const key=[...f.storage.rows.keys()].find(key=>key.endsWith(id));f.storage.rows.delete(key);await f.vault.write([{domain:'local-snapshot',objectId:id,value:bytes(raw),expected:null}]);
  let called=0;await assert.rejects(migration.withStagedSourceHistory(async()=>{called++;},historyOptions()),/E2EE_/);assert.equal(called,0);assert.equal(f.server.count,0);
 }
});

test('capacity and admission refusal precede history bodies and preserve all original records',async()=>{
 for(const mode of ['bytes','parts','metadata','admission']){
  const f=await fixture({registrySources:true,registryKind:'project'}),migration=f.make();await migration.prepareStaged(stagedInput(f),stagedOptions());const kept=structuredClone(f.storage.rows),options=historyOptions();let consumed=0;
  if(mode==='bytes')options.capacity.maximumBytes=1;if(mode==='parts')options.capacity.maximumParts=1;if(mode==='metadata')options.capacity.maximumMetadataBytes=1;
  if(mode==='admission')options.admit=async()=>{throw new Error('SYNTHETIC_NO_SPACE');};
  await assert.rejects(migration.withStagedSourceHistory(async()=>{consumed++;},options),/CAPACITY|NO_SPACE/);assert.equal(consumed,0);assert.deepEqual(f.storage.rows,kept);assert.equal(f.server.count,0);
 }
});

test('account retirement, changed coordinator and changed source catalogue cannot return an inert success receipt',async()=>{
 for(const mode of ['actor','state','catalogue']){
  const f=await fixture({registrySources:true,registryKind:'project'}),migration=f.make(),capture=stagedInput(f);await migration.prepareStaged(capture,stagedOptions());let live=true;const options=historyOptions();
  options.assertCurrent=()=>{if(!live)throw new Error('E2EE_ACCOUNT_CHANGED');};
  await assert.rejects(migration.withStagedSourceHistory(async input=>{await readHistory(input);
   if(mode==='actor')live=false;
   if(mode==='state')await f.make().cancel();
   if(mode==='catalogue')await ProtectedSourceStage.create({vault:f.vault,target:capture.target,paths:capture.paths,...stagedOptions(),ensureDurableKeys:async()=>{}});
  },options),/E2EE_/);assert.equal(f.server.count,0);
 }
});

test('closing the coordinator history wipes borrowed bytes and preserves a consumer failure',async()=>{
 const f=await fixture({registrySources:true,registryKind:'project'}),migration=f.make();await migration.prepareStaged(stagedInput(f),stagedOptions());let borrowed,retained;
 await assert.rejects(migration.withStagedSourceHistory(async input=>{retained=input;borrowed=(await input.current.openPath(input.current.paths[0]).chunks.next()).value;throw new Error('SYNTHETIC_CONSUMER_FAILURE');},historyOptions()),/SYNTHETIC_CONSUMER_FAILURE/);
 assert.ok(borrowed.every(value=>value===0));assert.throws(()=>retained.current.openPath(retained.current.paths[0]),/HISTORY_CLOSED/);assert.equal(f.server.count,0);
});

test('unknown ancestor locator roles refuse before opening any corresponding body',async()=>{
 const f=await fixture({registrySources:true,registryKind:'project'}),migration=f.make();await migration.prepareStaged(stagedInput(f),stagedOptions());
 const id=[...f.storage.rows.values()].find(row=>row.envelope.context.objectId.startsWith('migration:')).envelope.context.objectId,row=await f.vault.read('local-snapshot',id),state=JSON.parse(new TextDecoder().decode(row.value));row.value.fill(0);
 state.ancestors=['private:unexpected'];await f.vault.write([{domain:'local-snapshot',objectId:id,value:bytes(JSON.stringify(state)),expected:row.serial}]);
 const reads=[],get=f.storage.get.bind(f.storage);f.storage.get=async key=>{reads.push(key);return get(key);};
 await assert.rejects(migration.withStagedSourceHistory(async()=>assert.fail('unknown role reached consumer'),historyOptions()),/HISTORY_INVALID/);
 assert.ok(reads.every(key=>!key.endsWith('private:unexpected')));assert.equal(f.server.count,0);
});

test('retained legacy output and partial content plans require explicit original review before a source-only callback',async()=>{
 for(const mode of ['legacy-output','orphan-upload','orphan-private','content-plan']){
  const f=await fixture({registrySources:true,registryKind:'project',crashBefore:2}),migration=f.make();await migration.prepare();
  if(mode==='legacy-output')await assert.rejects(migration.run(),/PROCESS_DEATH/);
  const original=await migration.status();await migration.cancel();await migration.prepareStaged(stagedInput(f),stagedOptions());
  if(mode==='orphan-upload')await f.vault.write([{domain:'outbox',objectId:original.migrationId+':upload:unbound',value:bytes('UNIQUE OLD SERVER DATA'),expected:null}]);
  if(mode==='orphan-private')await f.vault.write([{domain:'local-snapshot',objectId:original.migrationId+':private:unbound',value:bytes('UNIQUE LOCAL DATA'),expected:null}]);
  if(mode==='content-plan')await f.vault.write([{domain:'local-snapshot',objectId:'content-plan:unbound:journal',value:bytes('UNIQUE REMOTE SOURCE'),expected:null}]);
  const kept=structuredClone(f.storage.rows),calls=f.server.count;let consumed=false;
  await assert.rejects(migration.withStagedSourceHistory(async()=>{consumed=true;},historyOptions()),/PLAN_REVIEW_REQUIRED/);
  assert.equal(consumed,false);assert.deepEqual(f.storage.rows,kept);assert.equal(f.server.count,calls);
 }
});

test('all present cancellation copies retain original bindings and unknown or malformed roles refuse before body reads',async()=>{
 for(const mode of ['changed','duplicate','missing','unknown-role']){
  const f=await fixture({registrySources:true,registryKind:'project'}),migration=f.make();await migration.prepare();await migration.cancel();await migration.prepareStaged(stagedInput(f),stagedOptions());
  const copy=[...f.storage.rows.values()].find(row=>row.envelope.context.objectId.includes(':cancel:')).envelope.context.objectId;
  if(mode==='missing'){f.storage.rows.delete([...f.storage.rows.keys()].find(key=>key.endsWith(copy)));}
  else if(mode==='unknown-role')await f.vault.write([{domain:'local-snapshot',objectId:'unknown:cancel:'+crypto.randomUUID(),value:bytes('UNKNOWN ORIGINAL ROLE'),expected:null}]);
  else{const row=await f.vault.read('local-snapshot',copy),old=JSON.parse(new TextDecoder().decode(row.value));row.value.fill(0);if(mode==='changed')old.snapshotHash='A'.repeat(43);
   let raw=JSON.stringify(old);if(mode==='duplicate')raw=raw.replace('"protocol":2','"protocol":1,"pr\\u006ftocol":2');f.storage.rows.delete([...f.storage.rows.keys()].find(key=>key.endsWith(copy)));
   await f.vault.write([{domain:'local-snapshot',objectId:copy,value:bytes(raw),expected:null}]);}
  const kept=structuredClone(f.storage.rows),reads=[],get=f.storage.get.bind(f.storage);f.storage.get=async key=>{reads.push(key);return get(key);};let consumed=false;
  await assert.rejects(migration.withStagedSourceHistory(async input=>{consumed=true;await readHistory(input);},historyOptions()),/E2EE_/);
  assert.equal(consumed,false);if(mode==='unknown-role')assert.ok(reads.every(key=>!key.includes('unknown:cancel:')));assert.deepEqual(f.storage.rows,kept);assert.equal(f.server.count,0);
 }
});

test('v3 publishes a distinct staged source after full local readback and never reaches legacy planning or transport',async()=>{
 const f=await fixture(),input=stagedInput(f),migration=f.make();await migration.prepareStaged(input,stagedOptions());
 const state=await f.make().status();assert.equal(state.protocol,3);assert.equal(state.source.format,'source-stage-v1');
 for(const field of ['snapshotParts','snapshotSize','snapshotHash'])assert.equal(Object.hasOwn(state,field),false);
 assert.deepEqual(state.source.paths,input.paths);assert.deepEqual(state.source.actor,{ownerId:'owner',scopeId:f.scopeId,deviceId:'device'});
 const source=await openSourceStage(f.vault,input.target,state.source.reference,()=>{});
 for(const path of source.paths){const reader=source.openPath(path),parts=[];for await(const part of reader.chunks)parts.push(Buffer.from(part));reader.assertComplete();assert.equal(Buffer.concat(parts).toString(),'STAGED ORIGINAL '+path);}
 await assert.rejects(f.make().run(),/E2EE_STREAMED_PLANNER_REQUIRED/);assert.equal(f.server.count,0);assert.ok(!f.trace.includes('network-source'));
 assert.ok(!JSON.stringify([...f.storage.rows]).includes('STAGED ORIGINAL'));
});

test('missing staged registry paths are refused before durable keys or the first producer',async()=>{
 const f=await fixture(),input=stagedInput(f);input.paths.pop();let called=0;input.capturePath=async()=>{called++;};
 await assert.rejects(f.make().prepareStaged(input,stagedOptions()),/SOURCE_ADAPTER_REQUIRED/);
 assert.equal(called,0);assert.ok(!f.trace.includes('durable-key-check'));assert.equal(f.storage.rows.size,0);assert.equal(f.server.count,0);
});

test('crash after a part leaves explicit incomplete history and a future staged preparation cannot skip it',async()=>{
 const f=await fixture(),input=stagedInput(f,async(id,write)=>write(new Uint8Array(256*1024).fill(47)));let crashed=false;
 f.storage.afterCommit=changes=>{if(!crashed&&changes.some(row=>row.key.includes('source-stage:')&&row.key.endsWith(':p:00:00000'))){crashed=true;throw new Error('SYNTHETIC_PART_DEATH');}};
 await assert.rejects(f.make().prepareStaged(input,stagedOptions()),/SYNTHETIC_PART_DEATH/);assert.equal(await f.make().status(),null);
 const known=await inspectSourceStages(f.vault,input.target,()=>{});assert.equal(known.length,1);assert.equal(known[0].complete,false);
 const retained=structuredClone(f.storage.rows);let producers=0;f.storage.afterCommit=undefined;
 await assert.rejects(f.make().prepareStaged(stagedInput(f,async()=>{producers++;}),stagedOptions()),/HISTORY_REVIEW_REQUIRED/);
 assert.equal(producers,0);assert.deepEqual(f.storage.rows,retained);assert.equal(f.server.count,0);
});

test('a complete stage orphaned at coordinator CAS is fully included in the next published source history',async()=>{
 const f=await fixture(),input=stagedInput(f),commit=f.storage.commit.bind(f.storage);let refused=false;
 f.storage.commit=async changes=>{if(!refused&&changes.some(row=>row.value?.envelope.context.objectId.startsWith('migration:'))){refused=true;throw new Error('E2EE_LOCAL_CONFLICT');}await commit(changes);};
 await assert.rejects(f.make().prepareStaged(input,stagedOptions()),/E2EE_LOCAL_CONFLICT/);assert.equal(await f.make().status(),null);
 const orphan=(await inspectSourceStages(f.vault,input.target,()=>{}))[0];assert.equal(orphan.complete,true);const retained=structuredClone(f.storage.rows);
 await f.make().prepareStaged(input,stagedOptions());const state=await f.make().status();
 assert.deepEqual(state.source.history,[{stageId:orphan.id,manifestHash:orphan.manifestHash}]);
 for(const[key,value]of retained)if(!key.includes('source-stage-catalog:'))assert.deepEqual(f.storage.rows.get(key),value);
 assert.equal(f.server.count,0);
});

test('a process death after coordinator CAS leaves a complete cold-readable pointer without starting a replacement attempt',async()=>{
 const f=await fixture(),input=stagedInput(f);let died=false;
 f.storage.afterCommit=changes=>{if(!died&&changes.some(row=>row.value?.envelope.context.objectId.startsWith('migration:'))){died=true;throw new Error('SYNTHETIC_POINTER_DEATH');}};
 await assert.rejects(f.make().prepareStaged(input,stagedOptions()),/SYNTHETIC_POINTER_DEATH/);f.storage.afterCommit=undefined;
 const state=await f.make().status();assert.equal(state.protocol,3);assert.equal(state.phase,'preparing');
 const retained=structuredClone(f.storage.rows);await assert.rejects(f.make().prepareStaged(input,stagedOptions()),/ALREADY_PREPARED/);assert.deepEqual(f.storage.rows,retained);
 assert.equal((await inspectSourceStages(f.vault,input.target,()=>{})).length,1);assert.equal(f.server.count,0);
});

test('mixed cancelled v2/v3 ancestors retain their exact source formats and no legacy restart can reinterpret v3',async()=>{
 const f=await fixture(),migration=f.make();await migration.prepare();const original=await migration.status();await migration.cancel();
 const input=stagedInput(f);await migration.prepareStaged(input,stagedOptions());let state=await migration.status();
 assert.deepEqual(state.ancestors,[original.migrationId+':archive']);const old=await f.vault.read('local-snapshot',state.ancestors[0]);
 try{const parsed=JSON.parse(new TextDecoder().decode(old.value));assert.equal(parsed.protocol,2);assert.equal(parsed.snapshotHash,original.snapshotHash);assert.equal(parsed.phase,'cancelled');}finally{old.value.fill(0);}
 await migration.cancel();assert.equal(await migration.run(),'cancelled');const retained=structuredClone(f.storage.rows);
 await assert.rejects(migration.prepare(),/STREAMED_SOURCE_REQUIRED/);await assert.rejects(migration.restart(),/STREAMED_SOURCE_REQUIRED/);assert.deepEqual(f.storage.rows,retained);
 await migration.restartStaged(input,stagedOptions());state=await migration.status();assert.equal(state.ancestors.length,2);assert.equal(state.source.history.length,1);
 const previous=await f.vault.read('local-snapshot',state.ancestors[1]);try{assert.equal(JSON.parse(new TextDecoder().decode(previous.value)).protocol,3);}finally{previous.value.fill(0);}
 assert.equal(f.server.count,0);
});

test('original-actor retirement during the durable-key await publishes no source or coordinator pointer',async()=>{
 const f=await fixture(),input=stagedInput(f),options=stagedOptions();let live=true;
 options.assertCurrent=()=>{if(!live)throw new Error('E2EE_ACCOUNT_CHANGED');};const durable=f.trace.push.bind(f.trace);
 f.trace.push=(...items)=>{if(items.includes('durable-key-check'))live=false;return durable(...items);};
 await assert.rejects(f.make().prepareStaged(input,options),/E2EE_ACCOUNT_CHANGED/);assert.equal(f.storage.rows.size,0);assert.equal(f.server.count,0);
});

test('stream registry preflights every personal/project/space path and bounds explicit one-path compatibility without aggregate capture',async()=>{
 for(const kind of ['personal','project','space']){
  const registry=new E2eeMigrationSources('owner',kind+':owner',kind);let called=0;
  for(const path of registry.requiredCoverage.slice(1))registry.registerStream({id:path,async captureLocal(write){called++;await write(bytes(path));}});
  assert.throws(()=>registry.stagedCapture(),/SOURCE_ADAPTER_REQUIRED/);assert.equal(called,0);
  const first=registry.requiredCoverage[0];registry.register({id:first,async captureLocal(){called++;return bytes('bounded');},async reconcile(){throw new Error('NO_RECONCILE_DURING_CAPTURE');}});
  assert.throws(()=>registry.stagedCapture(new Map([[first,0]])),/SOURCE_ADAPTER_REQUIRED/);assert.equal(called,0);
  const source=registry.stagedCapture(new Map([[first,7]])),parts=[];
  for(const id of source.paths)await source.capturePath(id,async value=>{parts.push(Buffer.from(value));});assert.equal(called,source.paths.length);assert.equal(parts[0].toString(),'bounded');
  const tooSmall=registry.stagedCapture(new Map([[first,6]]));await assert.rejects(tooSmall.capturePath(first,async()=>assert.fail('oversized compatibility input reached sink')),/SNAPSHOT_TOO_LARGE/);
  await assert.rejects(registry.captureLocal(),/SOURCE_ADAPTER_REQUIRED/);
 }
});

test('staged source binding, capacity and callbacks cannot be replaced while durable keys or admission await',async()=>{
 const f=await fixture(),input=stagedInput(f),options=stagedOptions();let changed=false;
 const originalPaths=[...input.paths];input.capturePath=async(id,write)=>{assert.ok(originalPaths.includes(id));await write(bytes('ORIGINAL CAPTURE '+id));};
 options.admit=async()=>{if(!changed){changed=true;input.target.scopeId='project:foreign';input.paths[0]='foreign.path';input.capturePath=async()=>assert.fail('replaced producer');
  options.capacity.maximumParts=0;options.assertCurrent=()=>{throw new Error('REPLACED_GUARD');};options.admit=async()=>{throw new Error('REPLACED_ADMISSION');};}};
 await f.make().prepareStaged(input,options);const state=await f.make().status();assert.equal(state.protocol,3);assert.equal(state.source.target.scopeId,f.scopeId);assert.deepEqual(state.source.paths,f.sources.requiredCoverage);
 assert.equal(f.server.count,0);
});

test('metadata admission refusal after complete staging preserves an orphan and publishes no coordinator pointer',async()=>{
 const f=await fixture(),input=stagedInput(f),options=stagedOptions();let admissions=0;
 options.admit=async()=>{if(++admissions===5)throw new Error('SYNTHETIC_METADATA_FULL');};
 await assert.rejects(f.make().prepareStaged(input,options),/SYNTHETIC_METADATA_FULL/);assert.equal(await f.make().status(),null);
 const known=await inspectSourceStages(f.vault,input.target,()=>{});assert.equal(known.length,1);assert.equal(known[0].complete,true);assert.equal(f.server.count,0);
});
test('a catalogue change during publication admission atomically refuses the coordinator pointer and retains both attempts',async()=>{
 const f=await fixture(),input=stagedInput(f),options=stagedOptions();let injected=false;
 options.admit=async()=>{
  const known=await inspectSourceStages(f.vault,input.target,()=>{});
  if(!injected&&known.length===1&&known[0].complete){injected=true;await ProtectedSourceStage.create({vault:f.vault,target:input.target,paths:input.paths,capacity:options.capacity,
   ensureDurableKeys:async()=>{},assertCurrent:()=>{},admit:async()=>{}});}
 };
 await assert.rejects(f.make().prepareStaged(input,options),/E2EE_LOCAL_CONFLICT/);assert.equal(injected,true);assert.equal(await f.make().status(),null);
 const known=await inspectSourceStages(f.vault,input.target,()=>{});assert.equal(known.length,2);assert.equal(known[0].complete,true);assert.equal(known[1].complete,false);
 assert.equal(f.server.count,0);const retained=structuredClone(f.storage.rows);await assert.rejects(f.make().prepareStaged(input,stagedOptions()),/HISTORY_REVIEW_REQUIRED/);assert.deepEqual(f.storage.rows,retained);
});

test('a locally injected v3 lease or planned flag cannot bypass the streamed-planner gate',async()=>{
 for(const mode of ['lease','planned','binding']){
  const f=await fixture(),input=stagedInput(f);await f.make().prepareStaged(input,stagedOptions());
  const id=[...f.storage.rows.values()].find(row=>row.envelope.context.objectId.startsWith('migration:')).envelope.context.objectId,row=await f.vault.read('local-snapshot',id);
  try{const value=JSON.parse(new TextDecoder().decode(row.value));if(mode==='lease')value.lease={fence:1,generation:1,leaseUntil:2_000_000_000};else if(mode==='planned')value.planned=true;else value.source.actor.deviceId='different-device';
   await f.vault.write([{domain:'local-snapshot',objectId:id,expected:row.serial,value:bytes(JSON.stringify(value))}]);}
  finally{row.value.fill(0);}
  await assert.rejects(f.make().run(),mode==='binding'?/CORRUPT_STAGED_MIGRATION/:/CORRUPT_MIGRATION/);assert.equal(f.server.count,0);assert.ok(!f.trace.includes('network-source'));
 }
});
test('snapshot is durable before all network work; read-back and independent recovery precede cutover',async()=>{
  const f=await fixture(),migration=f.make();await migration.prepare();assert.equal(f.server.count,0);
  assert.equal(await migration.run(),'active');assert.equal(f.server.state,'active');
  assert.ok(f.trace.indexOf('snapshot-local')<f.trace.indexOf('network-source'));
  assert.ok(f.trace.indexOf('read-back')<f.trace.indexOf('network-migration-verify'));
  assert.ok(f.trace.indexOf('recovery-checked')<f.trace.indexOf('network-migration-commit'));
  assert.ok(!JSON.stringify([...f.storage.rows]).includes('LOCAL DRAFT'));
  assert.ok(!JSON.stringify([...f.server.objects]).includes('PRIVATE NOTE'));
  const count=f.server.count;assert.equal(await f.make().run(),'active');assert.equal(f.server.count,count);
  await assert.rejects(migration.cancel(),/DOWNGRADE_FORBIDDEN/);
});

test('local-only migration output stays in the encrypted device vault, including multi-part bytes and private filenames',async()=>{
 const payload=new Uint8Array(3*256*1024+13).fill(71),f=await fixture({withLocal:true,localBytes:payload}),migration=f.make();
 await migration.prepare();await assert.rejects(migration.readLocal('diary','device-private-note'),/MIGRATION_UNVERIFIED/);
 assert.equal(await migration.run(),'active');assert.equal(f.server.objects.size,4);
 const record=await f.make().readLocal('diary','device-private-note');assert.deepEqual(record.bytes,payload);assert.equal(record.filename,'Private diary title.json');record.bytes.fill(0);
 assert.equal(await f.make().readLocal('diary','missing'),null);await assert.rejects(f.make().readLocal('attachment','device-private-note'),/LOCAL_CONTENT_FORBIDDEN/);
 const status=await migration.status();assert.equal(status.protocol,2);assert.equal(status.local[0].parts,4);
 const wire=JSON.stringify(f.server.commands);for(const privateValue of ['device-private-note','Private diary title.json',status.local[0].plaintextHash])assert.ok(!wire.includes(privateValue));
 assert.ok(!JSON.stringify([...f.storage.rows]).includes('Private diary title.json'));
 f.vault.lock();await assert.rejects(migration.readLocal('diary','device-private-note'),/UNLOCK_REQUIRED/);
});

test('an entirely device-local content plan can complete without a private upload or a fabricated cloud object',async()=>{
 const f=await fixture({localOnly:true}),migration=f.make();await migration.prepare();assert.equal(await migration.run(),'active');
 assert.equal(f.server.objects.size,0);assert.ok(f.server.commands.every(row=>row.command.action!=='put'));
 const record=await f.make().readLocal('diary','device-private-note');assert.equal(new TextDecoder().decode(record.bytes),'DEVICE-ONLY PRIVATE DIARY + DRAFT');record.bytes.fill(0);
 const calls=f.server.count;assert.equal(await f.make().run(),'active');assert.equal(f.server.count,calls);
});

test('a disk-full local output commit preserves the snapshot and prevents the first upload',async()=>{
 const options={withLocal:true,afterReconcile:({storage})=>{storage.fail=true;}},f=await fixture(options);await f.make().prepare();
 await assert.rejects(f.make().run(),/SYNTHETIC_DISK_FULL/);assert.equal(f.server.objects.size,0);assert.notEqual(f.server.state,'active');
 assert.ok(![...f.storage.rows.values()].some(row=>row.envelope.context.objectId.includes(':private:')));
 f.storage.fail=false;delete options.afterReconcile;assert.equal(await f.make().run(),'active');
 const record=await f.make().readLocal('diary','device-private-note');assert.equal(new TextDecoder().decode(record.bytes),'DEVICE-ONLY PRIVATE DIARY + DRAFT');record.bytes.fill(0);
});

test('process death after atomic local output commit reuses that plan without another reconciliation or private upload',async()=>{
 const f=await fixture({localOnly:true});await f.make().prepare();let interrupted=false;
 f.storage.afterCommit=changes=>{if(!interrupted&&changes.some(row=>row.value?.envelope.context.objectId.includes(':private:'))){interrupted=true;throw new Error('SYNTHETIC_PROCESS_DEATH');}};
 await assert.rejects(f.make().run(),/SYNTHETIC_PROCESS_DEATH/);assert.equal(f.server.objects.size,0);const calls=f.trace.filter(row=>row==='reconcile-after-snapshot').length;
 assert.equal(await f.make().run(),'active');assert.equal(f.trace.filter(row=>row==='reconcile-after-snapshot').length,calls);
 const record=await f.make().readLocal('diary','device-private-note');assert.ok(record.bytes.length>0);record.bytes.fill(0);
});

for(const timing of ['Before','After'])for(let index=0;index<3;index++)test(`local-only plan survives crash${timing} network operation ${index} with zero private uploads`,async()=>{
 const f=await fixture({localOnly:true,[`crash${timing}`]:index});await f.make().prepare();await assert.rejects(f.make().run(),/SYNTHETIC_PROCESS_DEATH/);
 assert.equal(await f.make().run(),'active');assert.equal(f.server.objects.size,0);const record=await f.make().readLocal('diary','device-private-note');
 assert.equal(new TextDecoder().decode(record.bytes),'DEVICE-ONLY PRIVATE DIARY + DRAFT');record.bytes.fill(0);
});

test('missing local ciphertext before a pending commit blocks its network replay and never becomes empty or cloud fallback',async()=>{
 const f=await fixture({localOnly:true,crashBefore:2});await f.make().prepare();await assert.rejects(f.make().run(),/SYNTHETIC_PROCESS_DEATH/);
 assert.equal(f.server.state,'verified');const row=[...f.storage.rows.entries()].find(([,value])=>value.envelope.context.objectId.includes(':private:'));
 const saved=structuredClone(row[1]);f.storage.rows.delete(row[0]);const calls=f.server.commands.length;
 await assert.rejects(f.make().run(),/CORRUPT_LOCAL_CONTENT/);assert.equal(f.server.commands.length,calls);assert.equal(f.server.state,'verified');
 f.storage.rows.set(row[0],saved);assert.equal(await f.make().run(),'active');
 f.storage.rows.delete(row[0]);await assert.rejects(f.make().readLocal('diary','device-private-note'),/CORRUPT_LOCAL_CONTENT/);
});

test('old journal v1 can resume while malformed v2 local metadata fails closed before network',async()=>{
 const f=await fixture();await f.make().prepare();const key=[...f.storage.rows.values()].find(row=>row.envelope.context.objectId.startsWith('migration:')).envelope.context.objectId;
 const row=await f.vault.read('local-snapshot',key);const legacy=JSON.parse(new TextDecoder().decode(row.value));row.value.fill(0);legacy.protocol=1;delete legacy.local;delete legacy.planned;
 await f.vault.write([{domain:'local-snapshot',objectId:key,value:bytes(JSON.stringify(legacy)),expected:row.serial}]);assert.equal(await f.make().run(),'active');
 const broken=await fixture({localOnly:true,crashBefore:1});await broken.make().prepare();await assert.rejects(broken.make().run(),/SYNTHETIC_PROCESS_DEATH/);
 const id=[...broken.storage.rows.values()].find(row=>row.envelope.context.objectId.startsWith('migration:')).envelope.context.objectId;
 const saved=await broken.vault.read('local-snapshot',id);const value=JSON.parse(new TextDecoder().decode(saved.value));saved.value.fill(0);value.local[0].recordId='foreign-source';
 await broken.vault.write([{domain:'local-snapshot',objectId:id,value:bytes(JSON.stringify(value)),expected:saved.serial}]);const count=broken.server.commands.length;
 await assert.rejects(broken.make().run(),/CORRUPT_LOCAL_CONTENT/);assert.equal(broken.server.commands.length,count);
});
test('the actual path registry completes migration with coverage IDs distinct from crypto domains',async()=>{
  const f=await fixture({registrySources:true}),migration=f.make();await migration.prepare();assert.equal(f.server.count,0);
  assert.equal(await migration.run(),'active');assert.equal(f.server.objects.size,requiredPrivatePaths('personal').length*2);
  assert.ok([...f.server.objects.values()].some(envelope=>envelope.context.domain==='workspace'&&envelope.context.objectId==='personal.tasks'));
});
test('required registry paths cannot be omitted, marked incomplete, or rebound to another scope',async()=>{
  const missing=await fixture({registrySources:true,missingPath:'personal.tasks'});await assert.rejects(missing.make().prepare(),/SOURCE_ADAPTER_REQUIRED/);assert.equal(missing.server.count,0);
  const incomplete=await fixture({registrySources:true,incompletePath:'personal.tasks'});await incomplete.make().prepare();await assert.rejects(incomplete.make().run(),/INCOMPLETE_COVERAGE/);assert.notEqual(incomplete.server.state,'active');
  assert.throws(()=>incomplete.make('project:foreign'),/SCOPE_BINDING_MISMATCH/);
});
test('shared project registry migration produces comments readable by the normal scope client',async()=>{
  const f=await fixture({registrySources:true,registryKind:'project'});await f.make().prepare();assert.equal(await f.make().run(),'active');
  const directory=await verifyDeviceDirectory('owner',f.scopeId,f.recovery.kit.authority,f.events);
  const device={ownerId:'owner',deviceId:'device',vault:f.vault,requireOpen:()=>f.vault.assertUnlocked(),keys:()=>f.keys,
    rememberDirectory:async(_scope,pin,events,_owner,callback)=>verifyDeviceDirectory('owner',f.scopeId,pin,events,undefined,callback)};
  const normal=new E2eeScopeClient(device,'owner',f.scopeId,f.recovery.kit.authority,{
    async directory(){return{events:f.events};},
    async read(packet){
      const {action,payload}=packet.command,objects=[...f.server.objects.values()];
      const result={checkpointHash:directory.checkpoint.hash,directoryRevision:directory.checkpoint.revision};
      if(action==='sealed-heads')result.objects=await Promise.all(objects.map(async envelope=>({domain:envelope.context.domain,objectId:envelope.context.objectId,revision:1,payloadHash:await envelopePayloadHash(envelope)})));
      else result.envelopes=objects.filter(envelope=>envelope.context.domain===payload.domain&&envelope.context.objectId===payload.objectId);
      return result;
    },
  });
  await normal.refresh();const opened=await normal.read('shared-comment','project.content');assert.equal(new TextDecoder().decode(opened.bytes),'reconciled:project.content');opened.bytes.fill(0);
});

test('actual Aurora journals migrate from a durable snapshot and open through the normal new-root client',async()=>{
  const {PersonalAuroraSource}=calendarModule('app/e2ee/aurora-source.ts');
  const {newSession}=calendarModule('app/aurora/session.ts'),policy=calendarModule('app/aurora/draw-policy.ts');
  const empty=()=>({version:1,ownerId:'owner',sessions:[],removed:[]}),now='2026-11-05T09:00:00Z';
  const document=id=>({...empty(),sessions:[newSession({id,ownerId:'owner',now,timezone:'Europe/Moscow',primary:policy.snapshotFromSavedDraw({id:'source',seed:123,day:'2026-11-05',createdAt:now,cards:policy.expectedSourceDraw(123)})})]});
  const raw=freshSecret(),legacyKey=Buffer.from(raw).toString('base64'),key=await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt']);raw.fill(0);
  const seal=async(value,scope)=>{const iv=crypto.getRandomValues(new Uint8Array(12)),ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:bytes('genesis-mindmap-v1:owner:'+scope)},key,bytes(JSON.stringify(value)));
    return{iv:Buffer.from(iv).toString('base64'),ciphertext:Buffer.from(ciphertext).toString('base64')};};
  const local=new MemoryStorage(),prefix='genesis-aurora-workspace-v1:owner:',writer=crypto.randomUUID(),old=document('offline'),latest=structuredClone(old);
  old.sessions[0].observationNote='Earlier private Aurora branch';latest.sessions[0].observationNote='Current private Aurora branch';
  for(const [index,value] of [old,latest].entries())local.setItem(`${prefix}pending:writer:${writer}:${index+1}:pending`,JSON.stringify({envelope:{...await seal(value,'aurora-workspace:v1'),expectedRevision:0},base:await seal(empty(),'aurora-workspace-base:v1')}));
  const original=[...local.data],workspace={...await seal(document('server'),'aurora-workspace:v1'),revision:1,updatedAt:now};
  let reads=0;
  // Only personal.aurora uses the real adapter here. Other registry paths remain
  // synthetic; this is deliberately not whole-product migration acceptance.
  const f=await fixture({registrySources:true,sourceAdapter:async(path,ports)=>path.id==='personal.aurora'?new PersonalAuroraSource('owner',ports.scopeId,{
    storage:local,memory:()=>({ownerId:'owner',legacyKey,generation:0,reconciliationRequired:false,current:null}),assertCurrent:()=>ports.vault.assertUnlocked(),
    legacyAurora:async context=>{
      const journal=await ports.vault.read('local-snapshot',`${context.migrationId}:source:0`);assert.ok(journal,'all source bytes must already be durably encrypted');
      try{assert.ok(new TextDecoder().decode(journal.value).includes('personal.aurora'));}finally{journal.value.fill(0);}
      assert.ok(!JSON.stringify([...ports.storage.rows]).includes(legacyKey));assert.ok(!JSON.stringify([...ports.storage.rows]).includes('Current private Aurora branch'));
      const {ownerId,scopeId,migrationId,fence,sourceHash}=context;
      reads++;return{protocol:1,ownerId,scopeId,migrationId,fence,sourceHash,legacyGeneration:0,checkpointHash:'A'.repeat(43),directoryRevision:1,workspace,results:[],legacyKey:{keyMode:'account',key:legacyKey}};
    },
  }):null});
  await f.make().prepare();assert.equal(reads,0);assert.equal(f.server.count,0);assert.equal(await f.make().run(),'active');assert.equal(reads,1);assert.deepEqual([...local.data],original);
  const serialized=JSON.stringify([...f.storage.rows,...f.server.objects]);assert.ok(!serialized.includes(legacyKey));assert.ok(!serialized.includes('private Aurora branch'));
  const directory=await verifyDeviceDirectory('owner',f.scopeId,f.recovery.kit.authority,f.events);
  const device={ownerId:'owner',deviceId:'device',vault:f.vault,requireOpen:()=>f.vault.assertUnlocked(),keys:()=>f.keys,
    rememberDirectory:async(_scope,pin,events,_owner,callback)=>verifyDeviceDirectory('owner',f.scopeId,pin,events,undefined,callback)};
  const normal=new E2eeScopeClient(device,'owner',f.scopeId,f.recovery.kit.authority,{
    async directory(){return{events:f.events};},async read(packet){
      const {action,payload}=packet.command,objects=[...f.server.objects.values()],result={checkpointHash:directory.checkpoint.hash,directoryRevision:directory.checkpoint.revision};
      if(action==='sealed-heads')result.objects=await Promise.all(objects.map(async envelope=>({domain:envelope.context.domain,objectId:envelope.context.objectId,revision:1,payloadHash:await envelopePayloadHash(envelope)})));
      else result.envelopes=objects.filter(envelope=>envelope.context.domain===payload.domain&&envelope.context.objectId===payload.objectId);
      return result;
    },
  });
  await normal.refresh();
  const opened=await normal.read('aurora','personal-aurora-workspace-v1');assert.ok(opened);
  try{const value=JSON.parse(new TextDecoder().decode(opened.bytes));assert.deepEqual(new Set(value.document.sessions.map(row=>row.id)),new Set(['server','offline']));assert.equal(value.document.sessions.find(row=>row.id==='offline').observationNote,'Current private Aurora branch');}
  finally{opened.bytes.fill(0);}
  const history=await normal.read('aurora','personal-aurora-local-history-v1');assert.ok(history);
  try{const value=JSON.parse(new TextDecoder().decode(history.bytes));assert.equal(value.snapshots.length,2);assert.equal(value.snapshots[0].document.sessions[0].observationNote,'Earlier private Aurora branch');}
  finally{history.bytes.fill(0);}
});
test('actual practice journals and draw history survive coordinator migration and normal new-root reads',async()=>{
  const {PersonalStoicheionSource}=calendarModule('app/e2ee/stoicheion-source.ts'),value=JSON.parse(readFileSync('tests/fixtures/e2ee/stoicheion-content-v1.json','utf8'));
  assert.equal(value.synthetic,true);const document=value.document,empty={version:1,works:[],removed:[]};
  const raw=freshSecret(),legacyKey=Buffer.from(raw).toString('base64'),key=await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt']);raw.fill(0);
  const seal=async(value,purpose)=>{const iv=crypto.getRandomValues(new Uint8Array(12)),ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:bytes('genesis-mindmap-v1:owner:'+purpose)},key,bytes(JSON.stringify(value)));
    return{iv:Buffer.from(iv).toString('base64'),ciphertext:Buffer.from(ciphertext).toString('base64')};};
  const local=new MemoryStorage(),prefix='genesis-stoicheion-workspace-v1:owner:',writer=crypto.randomUUID(),old=structuredClone(document);
  old.works[0].snapshot.reflection='Earlier synthetic private reflection';
  for(const [index,value]of [old,document].entries())local.setItem(`${prefix}pending:writer:${writer}:${index+1}:pending`,JSON.stringify({envelope:{...await seal(value,'stoicheion-workspace:v1'),expectedRevision:0},base:await seal(empty,'stoicheion-pending-base:v1')}));
  const original=[...local.data];let reads=0;
  // Other required paths are deliberately synthetic here. This proves this real
  // adapter with the coordinator/vault, not full twenty-path product acceptance.
  const f=await fixture({registrySources:true,sourceAdapter:async(path,ports)=>path.id==='personal.stoicheion'?new PersonalStoicheionSource('owner',ports.scopeId,{
    storage:local,memory:()=>({ownerId:'owner',legacyKey,generation:0,reconciliationRequired:false,current:null,draws:[],timeline:null,nativeDraws:null}),assertCurrent:()=>ports.vault.assertUnlocked(),
    legacyStoicheion:async context=>{
      const snapshot=await ports.vault.read('local-snapshot',`${context.migrationId}:source:0`);assert.ok(snapshot);
      try{assert.ok(new TextDecoder().decode(snapshot.value).includes('personal.stoicheion'));}finally{snapshot.value.fill(0);}
      assert.ok(!JSON.stringify([...ports.storage.rows]).includes(legacyKey));assert.ok(!JSON.stringify([...ports.storage.rows]).includes('Earlier synthetic private reflection'));
      const {ownerId,scopeId,migrationId,fence,sourceHash}=context;reads++;
      return{protocol:1,ownerId,scopeId,migrationId,fence,sourceHash,legacyGeneration:0,checkpointHash:'A'.repeat(43),directoryRevision:1,workspace:null,draws:[],spreadCards:[],timelineSessions:[],timelineWindows:[],legacyKey:{keyMode:'account',key:legacyKey}};
    },
  }):null});
  await f.make().prepare();assert.equal(reads,0);assert.equal(f.server.count,0);assert.equal(await f.make().run(),'active');assert.equal(reads,1);assert.deepEqual([...local.data],original);
  const serialized=JSON.stringify([...f.storage.rows,...f.server.objects]);assert.ok(!serialized.includes(legacyKey));assert.ok(!serialized.includes('synthetic private reflection'));
  const directory=await verifyDeviceDirectory('owner',f.scopeId,f.recovery.kit.authority,f.events),device={ownerId:'owner',deviceId:'device',vault:f.vault,requireOpen:()=>f.vault.assertUnlocked(),keys:()=>f.keys,
    rememberDirectory:async(_scope,pin,events,_owner,callback)=>verifyDeviceDirectory('owner',f.scopeId,pin,events,undefined,callback)};
  const normal=new E2eeScopeClient(device,'owner',f.scopeId,f.recovery.kit.authority,{
    async directory(){return{events:f.events};},async read(packet){
      const {action,payload}=packet.command,objects=[...f.server.objects.values()],result={checkpointHash:directory.checkpoint.hash,directoryRevision:directory.checkpoint.revision};
      if(action==='sealed-heads')result.objects=await Promise.all(objects.map(async envelope=>({domain:envelope.context.domain,objectId:envelope.context.objectId,revision:1,payloadHash:await envelopePayloadHash(envelope)})));
      else result.envelopes=objects.filter(envelope=>envelope.context.domain===payload.domain&&envelope.context.objectId===payload.objectId);return result;
    },
  });await normal.refresh();
  const opened=await normal.read('stoicheion','personal-stoicheion-workspace-v1');assert.ok(opened);try{assert.deepEqual(JSON.parse(new TextDecoder().decode(opened.bytes)).document,document);}finally{opened.bytes.fill(0);}
  const history=await normal.read('stoicheion','personal-stoicheion-local-history-v1');assert.ok(history);try{const value=JSON.parse(new TextDecoder().decode(history.bytes));assert.equal(value.snapshots.length,2);assert.equal(value.snapshots[0].document.works[0].snapshot.reflection,'Earlier synthetic private reflection');}finally{history.bytes.fill(0);}
  const draws=await normal.read('stoicheion','personal-stoicheion-draw-history-v1');assert.ok(draws);draws.bytes.fill(0);
});
test('actual Advice preferences and historical texts pass durable migration and ordinary new-root reads',async()=>{
  const {PersonalAdviceSource}=calendarModule('app/e2ee/advice-source.ts'),{collectAdvicePublicAssets}=await import('../scripts/advice-public-assets.mjs');
  const editorial={...JSON.parse(readFileSync('server/content/daily-advice.json','utf8')).items[0],collection:'aurora'},day='2026-11-19',now='2026-11-19T09:00:00Z';
  const assets=collectAdvicePublicAssets(process.cwd()),publicRows=new Map(assets.assets.map(row=>[row.fileName,Buffer.from(row.source)]));
  const {contentVersion,topics,...displayed}=editorial;assert.ok(contentVersion);assert.ok(topics);
  const canary='Synthetic private previous Advice display',card={...displayed,language:'en',body:canary,dayKey:day,dismissed:false,sequence:1};
  const mounted={language:'en',selection:card.id,result:{dayKey:day,state:'ready',advice:card,history:[card],sequence:1,dailyLimit:9,remaining:8,canNext:true}};
  const local=new MemoryStorage();let reads=0,catalogueReads=0;
  // Only Advice is real in this fixture. The other mandatory categories remain
  // synthetic; a successful test must not be called complete product coverage.
  const f=await fixture({registrySources:true,sourceAdapter:async(path,ports)=>path.id==='personal.advice'?new PersonalAdviceSource('owner',ports.scopeId,{
    storage:local,memory:()=>({ownerId:'owner',generation:0,reconciliationRequired:false,preferences:null,mounted,rendered:[],seen:[],unassignedLegacy:false}),assertCurrent:()=>ports.vault.assertUnlocked(),
    legacyAdvice:async context=>{
      const protectedCopy=await ports.vault.read('local-snapshot',`${context.migrationId}:source:0`);assert.ok(protectedCopy);protectedCopy.value.fill(0);
      assert.ok(!JSON.stringify([...ports.storage.rows]).includes(canary));reads++;
      const {ownerId,scopeId,migrationId,fence,sourceHash}=context;
      return{protocol:1,ownerId,scopeId,migrationId,fence,sourceHash,legacyGeneration:0,checkpointHash:'A'.repeat(43),directoryRevision:1,
        preferencesJson:'{"smart":false,"categories":["hermetica"]}',collectionsJson:'["aurora"]',notificationsJson:'{}',psychopompiaJson:'{}',philosophersPerDay:2,
        days:[{dayKey:day,adviceId:editorial.id,entryJson:JSON.stringify(editorial),createdAt:now,viewedAt:now,dismissedAt:null,selectionJson:'{}'}],entries:[],extraEntries:[],metrics:null};
    },catalogues:{async resolve(kind,version,language,id){assert.equal(reads,1);catalogueReads++;const row=assets.manifest.catalogues.find(row=>row.kind===kind&&row.version===version&&row.language===language);assert.ok(row);return JSON.parse(publicRows.get(row.path).toString('utf8'))[id];}},
  }):null});
  await f.make().prepare();assert.equal(reads,0);assert.equal(catalogueReads,0);assert.equal(await f.make().run(),'active');assert.equal(reads,1);assert.equal(catalogueReads,14);
  assert.ok(!JSON.stringify([...f.storage.rows,...f.server.objects]).includes(canary));
  const directory=await verifyDeviceDirectory('owner',f.scopeId,f.recovery.kit.authority,f.events),device={ownerId:'owner',deviceId:'device',vault:f.vault,requireOpen:()=>f.vault.assertUnlocked(),keys:()=>f.keys,
    rememberDirectory:async(_scope,pin,events,_owner,callback)=>verifyDeviceDirectory('owner',f.scopeId,pin,events,undefined,callback)};
  const normal=new E2eeScopeClient(device,'owner',f.scopeId,f.recovery.kit.authority,{
    async directory(){return{events:f.events};},async read(packet){
      const {action,payload}=packet.command,objects=[...f.server.objects.values()],result={checkpointHash:directory.checkpoint.hash,directoryRevision:directory.checkpoint.revision};
      if(action==='sealed-heads')result.objects=await Promise.all(objects.map(async envelope=>({domain:envelope.context.domain,objectId:envelope.context.objectId,revision:1,payloadHash:await envelopePayloadHash(envelope)})));
      else result.envelopes=objects.filter(envelope=>envelope.context.domain===payload.domain&&envelope.context.objectId===payload.objectId);return result;
    },
  });await normal.refresh();
  const indexRecord=await normal.read('workspace','personal-advice-history-index-v1');assert.ok(indexRecord);let dayObject;
  try{const index=JSON.parse(new TextDecoder().decode(indexRecord.bytes));assert.equal(index.days[0].dayKey,day);dayObject=index.days[0].objectId;assert.match(dayObject,/^personal-advice-day:[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);}finally{indexRecord.bytes.fill(0);}
  for(const [id,verify]of [
    ['personal-advice-preferences-v1',value=>{assert.equal(value.preferences.philosophersPerDay,2);assert.equal(value.preferences.smart,false);}],
    [dayObject,value=>{assert.equal(Object.keys(value.pointer.translations).length,14);assert.equal(value.pointer.entryJson,JSON.stringify(editorial));}],
    ['personal-advice-local-history-v1',value=>{assert.equal(value.mounted.result.advice.body,canary);assert.equal(value.mounted.result.canNext,undefined);}],
  ]){const opened=await normal.read('workspace',id);assert.ok(opened);try{verify(JSON.parse(new TextDecoder().decode(opened.bytes)));}finally{opened.bytes.fill(0);}}
});

test('actual personal task source survives a crashed shadow upload and ordinary new-root reads preserve outbox edits and tombstones',async()=>{
  const {PersonalTasksSource,readMigratedPersonalTasks}=calendarModule('app/e2ee/tasks-source.ts');
  const storage=new MemoryStorage(),canary='Synthetic private queued task '+crypto.randomUUID(),id='task-private-2026-11-19';
  const old={id,title:'Older displayed copy',description:'Original private description',dueDate:'2026-11-19',done:false,updatedAt:1,
    recurrenceMode:'lunar',recurrencePattern:'lunar-days',recurrenceDays:[2,7],recurrenceSeriesId:'private-series',recurrenceOriginalDate:'2026-11-18',googleTaskId:'private-provider-id',syncToGoogle:true};
  const edited={...old,title:canary};
  storage.setItem('genesis-calendar-v2:owner',JSON.stringify({tasks:[old]}));
  storage.setItem('genesis-pending-mutations-v2:owner',JSON.stringify([{key:'task:'+id,path:'/tasks/'+id,method:'PUT',body:JSON.stringify(edited)}]));
  storage.setItem('genesis-pending-mutations-v2-deleted:owner','["task-removed-offline"]');
  const before=[...storage.data];let reads=0;
  // Only personal.tasks uses the real source in this fixture. All other mandatory
  // categories remain explicitly synthetic; this cannot activate the product.
  const f=await fixture({registrySources:true,crashAfter:1,sourceAdapter:async(path,ports)=>path.id==='personal.tasks'?new PersonalTasksSource('owner',ports.scopeId,{
    storage,assertCurrent:()=>ports.vault.assertUnlocked(),memory:()=>({ownerId:'owner',legacyKey:'',generation:0,reconciliationRequired:false,tasks:[old],editors:[]}),
    legacyTasks:async context=>{
      assert.ok([...ports.storage.rows.values()].some(row=>row.envelope.context.domain==='local-snapshot'));
      assert.equal(ports.server.state,'uploading');assert.equal(context.migrationId,ports.server.migrationId);reads++;
      return{protocol:1,ownerId:context.ownerId,scopeId:context.scopeId,migrationId:context.migrationId,fence:context.fence,sourceHash:context.sourceHash,legacyGeneration:0,checkpointHash:'A'.repeat(43),directoryRevision:1,
        tasks:[],deletions:[],links:[],recovered:[],recoveredDeletions:[],creations:[],creationTargets:[],legacyKey:{keyMode:'empty',key:null},
        providerCaches:[{kind:'primary',accountId:context.ownerId,slot:'current',version:null,presence:'missing',provenance:'none',calendar:null,tasks:null}]};
    },
  }):null});
  await f.make().prepare();assert.equal(reads,0);await assert.rejects(f.make().run(),/SYNTHETIC_PROCESS_DEATH/);assert.equal(reads,1);
  assert.equal(await f.make().run(),'active');assert.equal(reads,1,'A shadow retry reuses its persisted ciphertext plan');assert.deepEqual([...storage.data],before);
  const serialized=JSON.stringify([...f.storage.rows.values(),...f.server.objects.values()]);assert.ok(!serialized.includes(canary)&&!serialized.includes('private-provider-id'));
  const directory=await verifyDeviceDirectory('owner',f.scopeId,f.recovery.kit.authority,f.events);
  const device={ownerId:'owner',deviceId:'device',vault:f.vault,requireOpen:()=>f.vault.assertUnlocked(),keys:()=>f.keys,
    rememberDirectory:async(_scope,pin,events,_owner,callback)=>verifyDeviceDirectory('owner',f.scopeId,pin,events,undefined,callback)};
  const normal=new E2eeScopeClient(device,'owner',f.scopeId,f.recovery.kit.authority,{
    async directory(){return{events:f.events};},async read(packet){
      const {action,payload}=packet.command,objects=[...f.server.objects.values()],result={checkpointHash:directory.checkpoint.hash,directoryRevision:directory.checkpoint.revision};
      if(action==='sealed-heads')result.objects=await Promise.all(objects.map(async envelope=>({domain:envelope.context.domain,objectId:envelope.context.objectId,revision:1,payloadHash:await envelopePayloadHash(envelope)})));
      else result.envelopes=objects.filter(envelope=>envelope.context.domain===payload.domain&&envelope.context.objectId===payload.objectId);return result;
    },
  });await normal.refresh();
  const read=await readMigratedPersonalTasks('owner',async objectId=>(await normal.read('workspace',objectId))?.bytes??null,()=>f.vault.assertUnlocked());
  assert.equal(read.tasks[0].title,canary);assert.equal(read.tasks[0].description,old.description);assert.equal(read.tasks[0].recurrenceOriginalDate,old.recurrenceOriginalDate);
  assert.equal(read.tasks[0].googleTaskId,'private-provider-id');assert.equal(read.tasks[0].syncToGoogle,false);assert.deepEqual(read.deletedIds,['task-removed-offline']);
});

test('signed shadow readback continues past short pages and rejects loops, directory changes and lock',async()=>{
  const f=await fixture();await f.make().prepare();await f.make().run();
  const directory=await verifyDeviceDirectory('owner',f.scopeId,f.recovery.kit.authority,f.events),seen=[];
  const device={ownerId:'owner',deviceId:'device',requireOpen:()=>f.vault.assertUnlocked(),keys:()=>f.keys};
  let malformed=null;
  const transport=new SignedMigrationTransport(device,directory,['workspace','diary'],async(path,body)=>{
    if(path==='/source')return{sourceHash:encodeE2eeBytes(new Uint8Array(32))};
    const command=await verifyE2eeCommand(body,f.keys.signing.publicKey);assert.equal(command.action,'read');seen.push(command);
    const {domain,after}=command.payload,rows=[...f.server.objects.values()].filter(envelope=>envelope.context.domain===domain)
      .sort((a,b)=>a.context.objectId<b.context.objectId?-1:1).filter(envelope=>malformed==='loop'||envelope.context.objectId>after).slice(0,1);
    if(malformed==='lock')f.vault.lock();
    return{checkpointHash:directory.checkpoint.hash,directoryRevision:directory.checkpoint.revision+(malformed==='directory'?1:0),envelopes:rows};
  });
  assert.equal(await transport.sourceHash(),encodeE2eeBytes(new Uint8Array(32)));assert.equal((await transport.readAll()).length,4);
  assert.ok(seen.filter(command=>command.payload.domain==='attachment').length>=3);
  malformed='loop';await assert.rejects(transport.readAll(),/INVALID_RESPONSE/);
  malformed='directory';await assert.rejects(transport.readAll(),/DIRECTORY_CONFLICT/);
  malformed='lock';await assert.rejects(transport.readAll(),/UNLOCK_REQUIRED/);
});
test('emit real web migration readback packets for the PHP SQLite contract fixture',async()=>{
  const f=await fixture(),directory=await verifyDeviceDirectory('owner',f.scopeId,f.recovery.kit.authority,f.events),reads=[];let legacyRead,auroraRead,stoicheionRead,adviceRead,tasksRead,diaryRead,mindmapsRead,mindmapsPageRead,physisPageRead,archiveRead;
  const device={deviceId:'device',requireOpen:()=>f.vault.assertUnlocked(),keys:()=>f.keys};
  const transport=new SignedMigrationTransport(device,directory,['workspace'],async(path,packet)=>{
    assert.equal(path,'/read');
    if(packet.command.action==='legacy-workspace')legacyRead=packet;
    else if(packet.command.action==='legacy-aurora')auroraRead=packet;
    else if(packet.command.action==='legacy-stoicheion')stoicheionRead=packet;
    else if(packet.command.action==='legacy-advice')adviceRead=packet;
    else if(packet.command.action==='legacy-tasks')tasksRead=packet;
    else if(packet.command.action==='legacy-diary')diaryRead=packet;
    else if(packet.command.action==='legacy-mindmaps'&&Object.hasOwn(packet.command.payload,'table'))mindmapsPageRead=packet;
    else if(packet.command.action==='legacy-mindmaps')mindmapsRead=packet;
    else if(packet.command.action==='legacy-physis')physisPageRead=packet;
    else if(packet.command.action==='legacy-archives')archiveRead=packet;
    else{assert.equal(packet.command.action,'read');reads.push(packet);}
    return{checkpointHash:directory.checkpoint.hash,directoryRevision:directory.checkpoint.revision,envelopes:[]};
  });
  assert.deepEqual(await transport.readAll(),[]);assert.equal(reads.length,2);
  const context={ownerId:'owner',scopeId:f.scopeId,migrationId:'web-migration-transport',fence:1,sourceHash:encodeE2eeBytes(new Uint8Array(32)),generation:1};
  await transport.legacyWorkspace(context);assert.equal((await verifyE2eeCommand(legacyRead,f.keys.signing.publicKey)).action,'legacy-workspace');
  assert.deepEqual({...legacyRead.command.payload},{migrationId:context.migrationId,fence:context.fence,sourceHash:context.sourceHash});
  await assert.rejects(transport.legacyWorkspace({...context,scopeId:'personal:foreign'}),/SCOPE_BINDING_MISMATCH/);
  await transport.legacyAurora(context);assert.equal((await verifyE2eeCommand(auroraRead,f.keys.signing.publicKey)).action,'legacy-aurora');
  assert.deepEqual({...auroraRead.command.payload},{migrationId:context.migrationId,fence:context.fence,sourceHash:context.sourceHash});
  await assert.rejects(transport.legacyAurora({...context,ownerId:'foreign'}),/SCOPE_BINDING_MISMATCH/);
  await transport.legacyStoicheion(context);assert.equal((await verifyE2eeCommand(stoicheionRead,f.keys.signing.publicKey)).action,'legacy-stoicheion');
  assert.deepEqual({...stoicheionRead.command.payload},{migrationId:context.migrationId,fence:context.fence,sourceHash:context.sourceHash});
  await assert.rejects(transport.legacyStoicheion({...context,ownerId:'foreign'}),/SCOPE_BINDING_MISMATCH/);
  await transport.legacyAdvice(context);assert.equal((await verifyE2eeCommand(adviceRead,f.keys.signing.publicKey)).action,'legacy-advice');
  assert.deepEqual({...adviceRead.command.payload},{migrationId:context.migrationId,fence:context.fence,sourceHash:context.sourceHash});
  await assert.rejects(transport.legacyAdvice({...context,ownerId:'foreign'}),/SCOPE_BINDING_MISMATCH/);
  await assert.rejects(transport.legacyAdvice({...context,scopeId:'personal:foreign'}),/SCOPE_BINDING_MISMATCH/);
  await transport.legacyTasks(context);assert.equal((await verifyE2eeCommand(tasksRead,f.keys.signing.publicKey)).action,'legacy-tasks');
  assert.deepEqual({...tasksRead.command.payload},{migrationId:context.migrationId,fence:context.fence,sourceHash:context.sourceHash});
  await assert.rejects(transport.legacyTasks({...context,ownerId:'foreign'}),/SCOPE_BINDING_MISMATCH/);
  await assert.rejects(transport.legacyTasks({...context,scopeId:'personal:foreign'}),/SCOPE_BINDING_MISMATCH/);
  await transport.legacyDiary(context);assert.equal((await verifyE2eeCommand(diaryRead,f.keys.signing.publicKey)).action,'legacy-diary');
  assert.deepEqual({...diaryRead.command.payload},{migrationId:context.migrationId,fence:context.fence,sourceHash:context.sourceHash});
  await assert.rejects(transport.legacyDiary({...context,ownerId:'foreign'}),/SCOPE_BINDING_MISMATCH/);
  await assert.rejects(transport.legacyDiary({...context,scopeId:'personal:foreign'}),/SCOPE_BINDING_MISMATCH/);
  await transport.legacyMindmaps(context);assert.equal((await verifyE2eeCommand(mindmapsRead,f.keys.signing.publicKey)).action,'legacy-mindmaps');
  assert.deepEqual({...mindmapsRead.command.payload},{migrationId:context.migrationId,fence:context.fence,sourceHash:context.sourceHash});
  await assert.rejects(transport.legacyMindmaps({...context,ownerId:'foreign'}),/SCOPE_BINDING_MISMATCH/);
  await assert.rejects(transport.legacyMindmaps({...context,scopeId:'personal:foreign'}),/SCOPE_BINDING_MISMATCH/);
  await transport.legacyMindmapsPage(context,'versions',128);
  assert.deepEqual({...mindmapsPageRead.command.payload},{migrationId:context.migrationId,fence:context.fence,sourceHash:context.sourceHash,table:'versions',offset:128});
  assert.equal((await verifyE2eeCommand(mindmapsPageRead,f.keys.signing.publicKey)).action,'legacy-mindmaps');
  await transport.legacyPhysisPage(context,'records',128);
  await transport.legacyArchiveFragment(context,'stages',0,1024*1024);
  assert.equal((await verifyE2eeCommand(archiveRead,f.keys.signing.publicKey)).action,'legacy-archives');
  assert.deepEqual({...archiveRead.command.payload},{migrationId:context.migrationId,fence:context.fence,sourceHash:context.sourceHash,table:'stages',offset:0,byteOffset:1024*1024});
  for(const [table,offset,byteOffset] of [['users',0,0],['stages',-1,0],['stages',0,-1],['stages',0,64*1024*1024+1],['safety',NaN,0]])
    await assert.rejects(transport.legacyArchiveFragment(context,table,offset,byteOffset),/ARCHIVE_TRANSPORT_INVALID/);
  await assert.rejects(transport.legacyArchiveFragment({...context,ownerId:'foreign'},'stages',0,0),/SCOPE_BINDING_MISMATCH/);
  await assert.rejects(transport.legacyArchiveFragment({...context,scopeId:'personal:foreign'},'stages',0,0),/SCOPE_BINDING_MISMATCH/);
  assert.deepEqual({...physisPageRead.command.payload},{migrationId:context.migrationId,fence:context.fence,sourceHash:context.sourceHash,table:'records',offset:128});
  assert.equal((await verifyE2eeCommand(physisPageRead,f.keys.signing.publicKey)).action,'legacy-physis');
  for(const method of ['legacyMindmapsPage','legacyPhysisPage']){
    await assert.rejects(transport[method]({...context,ownerId:'foreign'},'receipts',0),/SCOPE_BINDING_MISMATCH/);
    for(const [table,offset]of [['users',0],['receipts',-1],['receipts',0.5]])await assert.rejects(transport[method](context,table,offset),/LEGACY_PAGE_INVALID/);
  }
  mkdirSync('output/release-3.3.6/runtime',{recursive:true});
  writeFileSync('output/release-3.3.6/runtime/web-migration-transport.json',JSON.stringify({protocol:1,synthetic:true,platform:'web',bootstrap:f.events[0],reads,legacyRead,auroraRead,stoicheionRead,adviceRead,tasksRead,diaryRead,mindmapsRead,mindmapsPageRead,physisPageRead,archiveRead},null,2));
});
test('personal and multiple shared scopes share one device vault without migration journal collisions',async()=>{
  const f=await fixture(),personal=f.make(),project=f.make('project:one'),long=f.make('p'.repeat(128));
  await personal.prepare();await project.prepare();await long.prepare();
  const states=await Promise.all([personal.status(),project.status(),long.status()]);
  assert.equal(new Set(states.map(state=>state.migrationId)).size,3);
  assert.equal([...f.storage.rows.values()].filter(row=>row.envelope.context.objectId.startsWith('migration:')).length,3);
});
for(let index=1;index<7;index++)test(`expired lease before operation ${index}: fresh fence resumes the same protected shadow`,async()=>{
  const f=await fixture({expireBefore:index});await f.make().prepare();
  assert.equal(await f.make().run(),'active');assert.equal(f.server.objects.size,4);assert.equal(f.server.fence,2);
  assert.equal((await f.make().status()).resuming,null);
});
for(const position of ['resumeCrashBefore','resumeCrashAfter'])test(`${position}: durable renewal retries its exact request without double apply`,async()=>{
  const f=await fixture({expireBefore:3,[position]:true});await f.make().prepare();
  await assert.rejects(f.make().run(),/SYNTHETIC_PROCESS_DEATH/);
  assert.equal(await f.make().run(),'active');assert.equal(f.server.objects.size,4);assert.equal(f.server.fence,2);
});
test('legacy changes during an expired lease block resume and preserve every protected snapshot/job',async()=>{
  const f=await fixture({expireBefore:3,changedSource:true});await f.make().prepare();
  await assert.rejects(f.make().run(),/SOURCE_CHANGED/);
  const state=await f.make().status();assert.equal(state.phase,'uploading');assert.ok(state.pending);assert.ok(state.resuming);
  assert.ok(f.storage.rows.size>4);assert.notEqual(f.server.state,'active');
});
test('changed source can cancel/restart without dropping the old snapshot or mixing shadow generations',async()=>{
  const options={expireBefore:3,changedSource:true},f=await fixture(options);await f.make().prepare();
  const first=(await f.make().status()).migrationId;await assert.rejects(f.make().run(),/SOURCE_CHANGED/);
  const oldObjects=f.server.objects.size;await f.make().restart();
  const next=await f.make().status();assert.notEqual(next.migrationId,first);assert.equal(next.ancestors.length,1);
  options.changedSource=false;assert.equal(await f.make().run(),'active');
  assert.equal(f.server.generation,2);assert.equal(f.server.objects.size,oldObjects+4);
  assert.deepEqual(f.server.previousSnapshots,['LOCAL DRAFT + UNSENT OUTBOX + TOMBSTONES']);
});
test('unsigned or inconsistent commit checkpoint cannot become a locally trusted active state',async()=>{
  const f=await fixture({poisonCheckpoint:true});await f.make().prepare();await assert.rejects(f.make().run(),/INVALID_RECEIPT/);
  const state=await f.make().status();assert.equal(state.phase,'verified');assert.equal(state.pending.command.action,'migration-commit');
});
for(const position of ['crashBefore','crashAfter'])for(let index=0;index<7;index++)test(`${position} operation ${index}: restart retries durable journal without loss`,async()=>{
  const f=await fixture({[position]:index});await f.make().prepare();
  await assert.rejects(f.make().run(),/SYNTHETIC_PROCESS_DEATH/);
  assert.equal(await f.make().run(),'active');assert.equal(f.server.objects.size,4);
  assert.equal((await f.make().status()).pending,null);
});
test('storage full and unavailable durable keys prevent the first network operation',async()=>{
  const f=await fixture();f.storage.fail=true;await assert.rejects(f.make().prepare(),/DISK_FULL/);assert.equal(f.server.count,0);
  const other=await fixture({missingKeys:true});await assert.rejects(other.make().prepare(),/KEYS_NOT_DURABLE/);assert.equal(other.server.count,0);
});
for(const condition of ['incomplete','truncate','badRecovery'])test(`${condition} blocks activation and retains snapshot/outbox`,async()=>{
  const f=await fixture({[condition]:true});await f.make().prepare();await assert.rejects(f.make().run());
  assert.notEqual(f.server.state,'active');assert.notEqual((await f.make().status()).phase,'active');assert.ok(f.storage.rows.size>1);
});
