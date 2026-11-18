import assert from 'node:assert/strict';
import { test } from 'node:test';
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

class AtomicStorage {
  rows=new Map(); fail=false;
  async get(key){return structuredClone(this.rows.get(key)??null);}
  async list(prefix){return [...this.rows.keys()].filter(key=>key.startsWith(prefix));}
  async commit(changes){
    if(this.fail)throw new Error('SYNTHETIC_DISK_FULL');
    for(const change of changes)if((this.rows.get(change.key)?.serial??null)!==change.expected)throw new Error('E2EE_LOCAL_CONFLICT');
    const rows=new Map(this.rows);
    for(const change of changes){if(change.value===null)rows.delete(change.key);else rows.set(change.key,structuredClone(change.value));}this.rows=rows;
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
  const trace=[],server={objects:new Map(),receipts:new Map(),state:'legacy',count:0,crashed:new Set(),fence:1,generation:1,expired:false,expiredOnce:false};
  const currentObjects=()=>[...server.objects.values()].filter(e=>e.context.dataGeneration===server.generation);
  const transport={
    async sourceHash(){trace.push('network-source');assert.ok([...storage.rows.values()].some(row=>row.envelope.context.objectId.startsWith('migration:')));return encodeE2eeBytes(new Uint8Array(32).fill(13));},
    async command(packet){
      const command=await verifyE2eeCommand(packet,keys.signing.publicKey);trace.push('network-'+command.action);
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
    async reconcile(snapshot,previousSnapshots){trace.push('reconcile-after-snapshot');server.previousSnapshots=previousSnapshots.map(value=>new TextDecoder().decode(value));assert.equal(new TextDecoder().decode(snapshot),'LOCAL DRAFT + UNSENT OUTBOX + TOMBSTONES');
      return{coverage:[{domain:'workspace',complete:!options.incomplete},{domain:'diary',complete:true}],content:[{domain:'workspace',objectId:'workspace',bytes:bytes('PERSONAL DATA INCLUDING OFFLINE EDIT')},
        {domain:'diary',objectId:'note',bytes:bytes('PRIVATE NOTE + DELETION LEDGER')}]};},
  };
  if(options.registrySources){
    sources=new E2eeMigrationSources('owner',scopeId,kind);
    for(const path of requiredPrivatePaths(kind)){
      if(path.id===options.missingPath)continue;
      sources.register({id:path.id,async captureLocal(){trace.push('snapshot-local');return bytes(`local:${path.id}`);},
        async reconcile(local){assert.equal(new TextDecoder().decode(local),`local:${path.id}`);
          return{complete:path.id!==options.incompletePath,content:[{domain:path.id==='project.content'?'shared-comment':path.domains[0],objectId:path.id,bytes:bytes(`reconciled:${path.id}`)}]};}});
    }
  }
  const make=(scopeId=directory.scopeId)=>new E2eeMigration({vault,directory:{...directory,scopeId},deviceId:'device',signingKey:keys.signing.privateKey,signer:keys.signing.publicKey,root,transport,sources,
    ensureDurableKeys:async()=>{trace.push('durable-key-check');if(options.missingKeys)throw new Error('KEYS_NOT_DURABLE');},
    withLocalWriteFence:async operation=>{trace.push('local-writer-fence');return operation();},verifyRecovery:async()=>{trace.push('recovery-checked');if(options.badRecovery)throw new Error('RECOVERY_FAILED');}});
  return{storage,server,trace,make,transport,vault,keys,root,events,recovery,scopeId};
}
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
test('signed shadow readback continues past short pages and rejects loops, directory changes and lock',async()=>{
  const f=await fixture();await f.make().prepare();await f.make().run();
  const directory=await verifyDeviceDirectory('owner',f.scopeId,f.recovery.kit.authority,f.events),seen=[];
  const device={ownerId:'owner',deviceId:'device',requireOpen:()=>f.vault.assertUnlocked(),keys:()=>f.keys};
  let malformed=null;
  const transport=new SignedMigrationTransport(device,directory,['workspace','diary'],async(path,body)=>{
    if(path==='/source')return{sourceHash:encodeE2eeBytes(new Uint8Array(32))};
    const command=await verifyE2eeCommand(body,f.keys.signing.publicKey);seen.push(command);
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
