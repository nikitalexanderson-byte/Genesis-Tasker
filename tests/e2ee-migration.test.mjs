import assert from 'node:assert/strict';
import { test } from 'node:test';
import { E2eeMigration } from '../app/e2ee/migration.ts';
import { UnlockedE2eeVault } from '../app/e2ee/storage.ts';
import { generateDeviceKeys, freshSecret } from '../app/e2ee/keys.ts';
import { importE2eeRoot, encodeE2eeBytes } from '../app/e2ee/envelope.ts';
import { verifyE2eeCommand, e2eeCommandHash } from '../app/e2ee/commands.ts';
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
  const keys=await generateDeviceKeys(),root=await importE2eeRoot(freshSecret()),storage=new AtomicStorage();
  const directory={ownerId:'owner',scopeId:'personal:owner',cryptoEpoch:1,securityEpoch:1,keyId:'root-one',generation:1,
    checkpoint:{revision:1,hash:encodeE2eeBytes(new Uint8Array(32).fill(9))}};
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
  const sources={
    async captureLocal(){if(!trace.includes('snapshot-local'))assert.ok(!trace.some(row=>row.startsWith('network-')));trace.push('snapshot-local');return bytes('LOCAL DRAFT + UNSENT OUTBOX + TOMBSTONES');},
    async reconcile(snapshot,previousSnapshots){trace.push('reconcile-after-snapshot');server.previousSnapshots=previousSnapshots.map(value=>new TextDecoder().decode(value));assert.equal(new TextDecoder().decode(snapshot),'LOCAL DRAFT + UNSENT OUTBOX + TOMBSTONES');
      return{coverage:[{domain:'workspace',complete:!options.incomplete},{domain:'diary',complete:true}],content:[{domain:'workspace',objectId:'workspace',bytes:bytes('PERSONAL DATA INCLUDING OFFLINE EDIT')},
        {domain:'diary',objectId:'note',bytes:bytes('PRIVATE NOTE + DELETION LEDGER')}]};},
  };
  const make=(scopeId=directory.scopeId)=>new E2eeMigration({vault,directory:{...directory,scopeId},deviceId:'device',signingKey:keys.signing.privateKey,signer:keys.signing.publicKey,root,transport,sources,
    requiredDomains:['workspace','diary'],ensureDurableKeys:async()=>{trace.push('durable-key-check');if(options.missingKeys)throw new Error('KEYS_NOT_DURABLE');},
    withLocalWriteFence:async operation=>{trace.push('local-writer-fence');return operation();},verifyRecovery:async()=>{trace.push('recovery-checked');if(options.badRecovery)throw new Error('RECOVERY_FAILED');}});
  return{storage,server,trace,make,transport,vault};
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
