import assert from 'node:assert/strict';
import {test} from 'node:test';
import {UnlockedWebDevice} from '../app/e2ee/device-vault.ts';
import {E2eeScopeClient} from '../app/e2ee/scope-client.ts';
import {E2eeEditorQueue} from '../app/e2ee/editor-queue.ts';
import {createRecoveryKit,freshSecret,sealRoot,publicDeviceKeys} from '../app/e2ee/keys.ts';
import {encodeE2eeBytes,importE2eeRoot,sealE2eeEnvelope} from '../app/e2ee/envelope.ts';
import {signE2eeCommand,verifyE2eeCommand,e2eeCommandHash} from '../app/e2ee/commands.ts';
import {envelopePayloadHash,objectManifestHash,sealE2eeFile} from '../app/e2ee/files.ts';
import {verifyDeviceDirectory} from '../app/e2ee/directory.ts';
import {showPrivateMigration,privateMigrationUi,closePrivateMigrationUi} from '../app/private-migration-ui.ts';

class Records {
  rows=new Map();fail=false;
  async get(id){return structuredClone(this.rows.get(id)??null);}
  async list(prefix){return [...this.rows.keys()].filter(key=>key.startsWith(prefix));}
  async commit(changes,signal){
    if(signal?.aborted)throw new Error('E2EE_UNLOCK_REQUIRED');if(this.fail)throw new Error('SYNTHETIC_DISK_FULL');
    for(const change of changes)if((this.rows.get(change.key)?.serial??null)!==change.expected)throw new Error('E2EE_LOCAL_CONFLICT');
    const copy=new Map(this.rows);for(const change of changes)if(change.value===null)copy.delete(change.key);else copy.set(change.key,structuredClone(change.value));this.rows=copy;
  }
}
class Keys {
  rows=new Map();async get(id){return structuredClone(this.rows.get(id)??null);}
  async create(id,bundle){assert.ok(!this.rows.has(id));this.rows.set(id,{serial:1,bundle:structuredClone(bundle)});}
}
const bytes=text=>new TextEncoder().encode(text),text=value=>new TextDecoder().decode(value);

test('a migration surface freezes ordinary encrypted uploads and editor publications without discarding pending work',async()=>{
  const f=await fixture(),client=f.make();await client.refresh();
  await client.prepare('diary','frozen-upload',bytes('retained pending input'),0);
  const queue=new E2eeEditorQueue(f.device,client,f.rootContext.scopeId,'diary','frozen-editor');
  showPrivateMigration(f.device.ownerId,'en','resume',{scopeId:'project:synthetic',kind:'project',resourceId:'synthetic'});
  const retained=JSON.stringify([...f.storage.rows]);
  try{
    await assert.rejects(client.flush('diary','frozen-upload'),/E2EE_MIGRATION_BUSY/);
    await assert.rejects(queue.stage(bytes('new ordinary input'),null,0),/E2EE_MIGRATION_BUSY/);
    assert(JSON.stringify([...f.storage.rows])===retained,'the migration must see the same retained job and editor inventory');
    assert.equal(f.server.writes,0);
  }finally{closePrivateMigrationUi(privateMigrationUi().id);}
  await client.flush('diary','frozen-upload');assert.equal(f.server.writes,2,'one content chunk and its manifest are uploaded after admission resumes');f.device.lock();
});

test('an upload committed as migration opens retains its exact pending packet until the surface closes',async()=>{
  const f=await fixture(),client=f.make();await client.refresh();
  await client.prepare('diary','race-upload',bytes('immutable pending input'),0);
  const command=f.transport.command;let retained;
  f.transport.command=async packet=>{
    showPrivateMigration(f.device.ownerId,'en','resume',{scopeId:'project:synthetic',kind:'project',resourceId:'synthetic'});
    retained=JSON.stringify([...f.storage.rows]);return command(packet);
  };
  try{
    await assert.rejects(client.flush('diary','race-upload'),/E2EE_MIGRATION_BUSY/);
    assert.equal(f.server.writes,1);
    assert(JSON.stringify([...f.storage.rows])===retained,'a late receipt must not mutate the authenticated custody snapshot');
  }finally{if(privateMigrationUi())closePrivateMigrationUi(privateMigrationUi().id);f.transport.command=command;}
  await client.flush('diary','race-upload');assert.equal(f.server.writes,2,'retry recovers the first chunk receipt and adds only its manifest');f.device.lock();
});
async function fixture(options={}){
  const ownerId='scope-owner',scopeId='personal:scope-owner',recovery=await createRecoveryKit(ownerId),storage=new Records(),keyStorage=new Keys();
  let device=await UnlockedWebDevice.provision(ownerId,recovery.secret,recovery.kit,storage,keyStorage);
  const raw=freshSecret(),keyId='root-one',keys=device.keys(),pub=await publicDeviceKeys(keys);
  const rootContext={ownerId,scopeId,cryptoEpoch:1,keyId,recipientId:device.deviceId};
  const command={protocol:1,ownerId,scopeId,deviceId:device.deviceId,action:'bootstrap',expectedRevision:0,checkpointHash:'genesis',securityEpoch:1,operationId:'bootstrap',payload:{
    kind:'personal',resourceId:ownerId,keyId,generation:1,recoveryKit:recovery.kit,deviceKeys:pub,
    deviceCapsule:await sealRoot(raw,pub.receivingKey,rootContext),recoveryCapsule:await sealRoot(raw,recovery.kit.authority.receivingKey,{...rootContext,recipientId:'recovery'})}};
  command.payload.selfProof=(await signE2eeCommand(command,keys.signing.privateKey)).signature;
  const events=[await signE2eeCommand(command,recovery.keys.signing.privateKey)];
  let directory=await verifyDeviceDirectory(ownerId,scopeId,recovery.kit.authority,events);
  const append=async(action,payload)=>{
    const c={protocol:1,ownerId,scopeId,deviceId:device.deviceId,action,expectedRevision:directory.checkpoint.revision,checkpointHash:directory.checkpoint.hash,
      securityEpoch:directory.securityEpoch,operationId:crypto.randomUUID(),payload};
    events.push(await signE2eeCommand(c,keys.signing.privateKey));directory=await verifyDeviceDirectory(ownerId,scopeId,recovery.kit.authority,events);
  };
  await append('migration-commit',{generation:1,migrationId:'synthetic-migration',fence:1,manifestHash:await objectManifestHash([]),objectCount:0,verifiedCheckpoint:encodeE2eeBytes(freshSecret())});
  const server={objects:new Map(),receipts:new Map(),writes:0,crashed:false};
  const transport={
    async directory(){return {events:structuredClone(events)};},
    async command(packet){
      const c=await verifyE2eeCommand(packet,keys.signing.publicKey),identity=await e2eeCommandHash(c),receipt=server.receipts.get(c.operationId);
      if(receipt){assert.equal(receipt.payloadHash,identity);return receipt.result;}
      assert.equal(c.expectedRevision,directory.checkpoint.revision);assert.equal(c.checkpointHash,directory.checkpoint.hash);assert.equal(c.securityEpoch,directory.securityEpoch);
      const p=c.payload;
      if(c.action==='cancel-put') {
        const original=p.original.command,originalHash=await e2eeCommandHash(original);
        const old=server.receipts.get(original.operationId),outcome=old??{payloadHash:originalHash,result:{cancelled:true}};
        assert.equal(outcome.payloadHash,originalHash);server.receipts.set(original.operationId,outcome);
        const result={operationReceipt:outcome};server.receipts.set(c.operationId,{payloadHash:identity,result});
        if(options.crashAfterCancel&&!server.cancelCrashed){server.cancelCrashed=true;throw new Error('SYNTHETIC_PROCESS_DEATH');}return result;
      }
      server.lastPut=structuredClone(packet);
      if(options.crashBeforePut&&!server.beforeCrashed){server.beforeCrashed=true;throw new Error('SYNTHETIC_PROCESS_DEATH');}
      const e=p.envelope,k=`${e.context.domain}\0${e.context.objectId}`,old=server.objects.get(k);
      if((old?.context.revision??0)!==p.expectedObjectRevision)throw new Error('E2EE_OBJECT_CONFLICT');
      const result={revision:e.context.revision,generation:e.context.dataGeneration,payloadHash:await envelopePayloadHash(e)};
      server.objects.set(k,structuredClone(e));server.receipts.set(c.operationId,{payloadHash:identity,result});server.writes++;
      if(options.crashAfterPut&&!server.crashed&&server.writes===(options.crashAtWrite??1)){server.crashed=true;throw new Error('SYNTHETIC_PROCESS_DEATH');}
      return result;
    },
    async read(packet){
      const c=await verifyE2eeCommand(packet,keys.signing.publicKey);assert.equal(c.checkpointHash,directory.checkpoint.hash);
      const base={checkpointHash:c.checkpointHash,directoryRevision:c.expectedRevision};
      if(c.action==='receipt')return {...base,receipt:server.receipts.get(c.payload.operationId)??null};
      if(c.action==='sealed-heads')return {...base,objects:c.payload.cryptoEpoch===0?[]:server.retired};
      assert.equal(c.action,'get');const e=server.objects.get(`${c.payload.domain}\0${c.payload.objectId}`);return {...base,envelopes:e?[structuredClone(e)]:[]};
    },
  };
  const make=()=>new E2eeScopeClient(device,ownerId,scopeId,recovery.kit.authority,transport);
  const reopen=async()=>{device.lock();device=await UnlockedWebDevice.unlock(ownerId,recovery.secret,storage,keyStorage);return make();};
  const rotate=async()=>{
    server.retired=await Promise.all([...server.objects.values()].map(async e=>({domain:e.context.domain,objectId:e.context.objectId,revision:e.context.revision,payloadHash:await envelopePayloadHash(e)})));
    const newRoot=freshSecret(),ctx={...rootContext,cryptoEpoch:2,keyId:'root-two'};
    await append('rotate',{revokedDeviceIds:[],cryptoEpoch:2,securityEpoch:2,keyId:'root-two',retiredManifestHash:await objectManifestHash(server.retired),retiredObjectCount:server.retired.length,
      capsules:[{deviceId:device.deviceId,capsule:await sealRoot(newRoot,pub.receivingKey,ctx)}],recoveryCapsule:await sealRoot(newRoot,recovery.kit.authority.receivingKey,{...ctx,recipientId:'recovery'})});
    return newRoot;
  };
  return {make,reopen,storage,keyStorage,server,transport,rotate,raw,keys,rootContext,get device(){return device;}};
}
test('normal save atomically protects draft/ciphertext before network; restart reuses exact acknowledged request',async()=>{
  const f=await fixture({crashAfterPut:true});let client=f.make();await client.refresh();
  await client.prepare('workspace','workspace',bytes('PRIVATE QUEUED OFFLINE EDIT'),0);assert.equal(f.server.writes,0);
  assert.ok(!JSON.stringify([...f.storage.rows]).includes('PRIVATE QUEUED'));assert.equal(text(await client.readDraft('workspace','workspace')),'PRIVATE QUEUED OFFLINE EDIT');
  await assert.rejects(client.flush('workspace','workspace'),/PROCESS_DEATH/);
  client=await f.reopen();await client.refresh();assert.equal(await client.flush('workspace','workspace'),1);assert.equal(f.server.writes,2);
  assert.equal(text((await client.read('workspace','workspace')).bytes),'PRIVATE QUEUED OFFLINE EDIT');
});
test('disk full accepts neither a new save nor a network request; pending edits cannot be overwritten',async()=>{
  const f=await fixture(),client=f.make();await client.refresh();f.storage.fail=true;
  await assert.rejects(client.prepare('diary','note',bytes('private'),0),/DISK_FULL/);assert.equal(f.server.writes,0);
  f.storage.fail=false;await client.prepare('diary','note',bytes('private'),0);
  await assert.rejects(client.prepare('diary','note',bytes('replacement'),0),/PENDING_SAVE_REQUIRED/);
  assert.equal(text(await client.readDraft('diary','note')),'private');
});
test('a confirmed local write pins its head even before first download; server rollback cannot look empty',async()=>{
  const f=await fixture(),client=f.make();await client.refresh();await client.prepare('workspace','one',bytes('private'),0);await client.flush('workspace','one');
  f.server.objects.delete('workspace\0one');await assert.rejects(client.read('workspace','one'),/REMOTE_ROLLBACK/);
});
test('rotation keeps authentic history readable but rejects new ciphertext forged under an old epoch',async()=>{
  const f=await fixture(),client=f.make();await client.refresh();await client.prepare('workspace','one',bytes('AUTHENTIC BEFORE ROTATION'),0);await client.flush('workspace','one');
  const original=f.server.objects.get('workspace\0one');await f.rotate();await client.refresh();
  assert.equal(text((await client.read('workspace','one')).bytes),'AUTHENTIC BEFORE ROTATION');
  const forged=await sealE2eeEnvelope(await importE2eeRoot(f.raw),f.keys.signing.privateKey,{...original.context,operationId:'forged-old-epoch'},bytes('FORGED LATER'));
  f.server.objects.set('workspace\0one',forged);await assert.rejects(client.read('workspace','one'),/REMOTE_ROLLBACK|UNSEALED_HISTORY/);
});
test('unsent old-epoch draft remains recoverable and requires explicit rebase after rotation',async()=>{
  const f=await fixture(),client=f.make();await client.refresh();await client.prepare('diary','draft',bytes('UNSENT PRIVATE DRAFT'),0);
  await f.rotate();await client.refresh();await assert.rejects(client.flush('diary','draft'),/DRAFT_REBASE_REQUIRED/);
  assert.equal(text(await client.readDraft('diary','draft')),'UNSENT PRIVATE DRAFT');assert.equal(f.server.writes,0);
  assert.equal(await client.rebase('diary','draft',0),'rebased');assert.equal(await client.flush('diary','draft'),1);
  assert.equal(text((await client.read('diary','draft')).bytes),'UNSENT PRIVATE DRAFT');
});
test('signed existence rejects an empty server response on a new local floor',async()=>{
  const f=await fixture(),client=f.make();await client.refresh();await client.prepare('workspace','one',bytes('PRIVATE'),0);await client.flush('workspace','one');
  await f.rotate();await client.refresh();
  for(const [key,value]of f.storage.rows)if(value.envelope.context.objectId.startsWith('floor:'))f.storage.rows.delete(key);
  f.server.objects.delete('workspace\0one');await assert.rejects(client.read('workspace','one'),/REMOTE_ROLLBACK/);
});
test('signed head is a minimum revision for current-epoch reads and saves on a clean local floor',async()=>{
  const f=await fixture(),client=f.make();await client.refresh();
  for(const expected of [0,1]){await client.prepare('workspace','one',bytes(`revision-${expected+1}`),expected);await client.flush('workspace','one');}
  const original=f.server.objects.get('workspace\0one'),newRoot=await f.rotate();await client.refresh();
  for(const [key,value]of f.storage.rows)if(value.envelope.context.objectId.startsWith('floor:'))f.storage.rows.delete(key);
  await assert.rejects(client.prepare('workspace','one',bytes('STALE SAVE'),0),/OBJECT_CONFLICT/);
  const stale=await sealE2eeFile(await importE2eeRoot(newRoot),f.keys.signing.privateKey,
    {...original.context,cryptoEpoch:2,securityEpoch:2,keyId:'root-two',revision:1,operationId:'stale-current-epoch'},bytes('STALE BUT AUTHENTIC'),{filename:'',mediaType:'application/json'});
  f.server.objects.set('workspace\0one',stale.manifest);
  for(const chunk of stale.chunks)f.server.objects.set(`attachment\0${chunk.context.objectId}`,chunk);
  await assert.rejects(client.read('workspace','one'),/REMOTE_ROLLBACK/);
});
test('rebase preserves filename and media type in the durable encrypted job',async()=>{
  const f=await fixture();let client=f.make();await client.refresh();
  await client.prepare('attachment','photo',bytes('SYNTHETIC IMAGE BYTES'),0,{filename:'private-photo.png',mediaType:'image/png'});
  await f.rotate();client=await f.reopen();await client.refresh();await client.rebase('attachment','photo',0);await client.flush('attachment','photo');
  const opened=await client.read('attachment','photo');assert.equal(opened.filename,'private-photo.png');assert.equal(opened.mediaType,'image/png');
  assert.equal(text(opened.bytes),'SYNTHETIC IMAGE BYTES');assert.ok(!JSON.stringify([...f.storage.rows]).includes('private-photo.png'));
});
test('offline unlock opens durable drafts and accepts edits without any network; sync requires explicit refresh',async()=>{
  const f=await fixture();let client=f.make();await client.refresh();await client.prepare('diary','one',bytes('SAVED BEFORE OFFLINE'),0);
  client=await f.reopen();let network=0;
  for(const name of ['directory','read','command'])f.transport[name]=async()=>{network++;throw new Error('SYNTHETIC_OFFLINE');};
  assert.equal(text(await client.readDraft('diary','one')),'SAVED BEFORE OFFLINE');
  await client.hydrateOffline();await client.prepare('diary','two',bytes('NEW OFFLINE DRAFT'),0);
  assert.equal(text(await client.readDraft('diary','two')),'NEW OFFLINE DRAFT');assert.equal(network,0);
  await assert.rejects(client.flush('diary','two'),/REFRESH_REQUIRED/);assert.equal(network,0);
  assert.ok(!JSON.stringify([...f.storage.rows]).includes('OFFLINE DRAFT'));
});
test('editor keeps later offline edits while the first upload awaits a lost ACK, including restart and full disk',async()=>{
  const f=await fixture({crashAfterPut:true});let client=f.make();await client.refresh();
  let editor=new E2eeEditorQueue(f.device,client,f.rootContext.scopeId,'diary','one');
  const first=await editor.stage(bytes('FIRST EDIT'),null,0);await editor.stage(bytes('SECOND EDIT'),first,0);
  await assert.rejects(editor.flush(),/PROCESS_DEATH/);
  let saved=await editor.load();await editor.stage(bytes('THIRD EDIT WHILE PENDING'),saved.serial,0);
  f.storage.fail=true;saved=await editor.load();await assert.rejects(editor.stage(bytes('MUST NOT REPLACE'),saved.serial,0),/DISK_FULL/);f.storage.fail=false;
  client=await f.reopen();await client.hydrateOffline();editor=new E2eeEditorQueue(f.device,client,f.rootContext.scopeId,'diary','one');
  assert.equal(text((await editor.load()).bytes),'THIRD EDIT WHILE PENDING');
  await client.refresh();assert.equal(await editor.flush(),2);
  assert.equal(text((await client.read('diary','one')).bytes),'THIRD EDIT WHILE PENDING');assert.equal((await editor.load()).pending,false);
  assert.ok(!JSON.stringify([...f.storage.rows]).includes('THIRD EDIT'));
});
test('a new edit created during acknowledgement remains queued and a stale second tab cannot overwrite it',async()=>{
  const f=await fixture(),client=f.make();await client.refresh();const editor=new E2eeEditorQueue(f.device,client,f.rootContext.scopeId,'diary','one');
  const oldSerial=await editor.stage(bytes('INITIAL'),null,0),original=f.transport.command;let edited=false;
  f.transport.command=async packet=>{
    const result=await original(packet);
    if(packet.command.action==='put'&&packet.command.payload.envelope.context.domain==='diary'&&!edited){edited=true;const state=await editor.load();await editor.stage(bytes('EDIT DURING ACK'),state.serial,state.remoteRevision);}
    return result;
  };
  assert.equal(await editor.flush(),2);assert.equal(text((await client.read('diary','one')).bytes),'EDIT DURING ACK');
  const secondTab=new E2eeEditorQueue(f.device,client,f.rootContext.scopeId,'diary','one');
  await assert.rejects(secondTab.stage(bytes('STALE TAB'),oldSerial,0),/LOCAL_CONFLICT/);
  assert.equal(text((await secondTab.load()).bytes),'EDIT DURING ACK');
});
test('crash after scope receipt but before editor acknowledgement reconciles locally without another remote write',async()=>{
  const f=await fixture(),client=f.make();await client.refresh();const editor=new E2eeEditorQueue(f.device,client,f.rootContext.scopeId,'diary','one');
  await editor.stage(bytes('PRIVATE FINAL EDIT'),null,0);const commit=f.storage.commit.bind(f.storage);let crashed=false;
  f.storage.commit=async(changes,signal)=>{
    if(f.server.writes===2&&!crashed&&changes.some(change=>change.value?.envelope.context.objectId.startsWith('editor:'))){crashed=true;throw new Error('SYNTHETIC_PROCESS_DEATH');}
    return commit(changes,signal);
  };
  await assert.rejects(editor.flush(),/PROCESS_DEATH/);assert.equal((await client.localJob('diary','one')).complete,true);
  const writes=f.server.writes;assert.equal(await editor.flush(),1);assert.equal(f.server.writes,writes);assert.equal((await editor.load()).pending,false);
});
test('editor does not acknowledge a new edit after durable device keys disappear',async()=>{
  const f=await fixture(),client=f.make();await client.refresh();const editor=new E2eeEditorQueue(f.device,client,f.rootContext.scopeId,'diary','one');
  const serial=await editor.stage(bytes('PRESERVED'),null,0);f.keyStorage.rows.clear();
  await assert.rejects(editor.stage(bytes('NEW UNSAFE EDIT'),serial,0),/DEVICE_KEY_UNAVAILABLE/);assert.equal(text((await editor.load()).bytes),'PRESERVED');
});
test('editor cannot expose plaintext through the async continuation after lock',async()=>{
  const f=await fixture(),client=f.make();await client.refresh();const editor=new E2eeEditorQueue(f.device,client,f.rootContext.scopeId,'diary','one');
  await editor.stage(bytes('PRIVATE LOCK CANARY'),null,0);const check=f.device.vault.assertUnlocked.bind(f.device.vault);let scheduled=false;
  f.device.vault.assertUnlocked=()=>{check();if(!scheduled){scheduled=true;queueMicrotask(()=>f.device.lock());}};
  await assert.rejects(editor.load(),/UNLOCK_REQUIRED/);
});
test('editor acknowledges the actual revision if a second worker completes a rebased job first',async()=>{
  const f=await fixture({crashBeforePut:true}),client=f.make();await client.refresh();const editor=new E2eeEditorQueue(f.device,client,f.rootContext.scopeId,'diary','one');
  await editor.stage(bytes('LOCAL EDIT'),null,0);await assert.rejects(editor.flush(),/PROCESS_DEATH/);
  const context={...f.server.lastPut.command.payload.envelope.context,domain:'diary',objectId:'one',revision:5,operationId:'other-device-head'};
  const remote=await sealE2eeFile(await importE2eeRoot(f.raw),f.keys.signing.privateKey,context,bytes('OTHER DEVICE EDIT'),{filename:'',mediaType:'application/json'});
  f.server.objects.set('diary\0one',remote.manifest);for(const chunk of remote.chunks)f.server.objects.set(`attachment\0${chunk.context.objectId}`,chunk);
  const rebase=client.rebase.bind(client);client.rebase=async(...args)=>{
    await rebase(...args);const job=await client.localJob('diary','one');await client.flush('diary','one',job.originId);return rebase(...args);
  };
  assert.equal(await editor.rebasePending(5),'already-confirmed');const saved=await editor.load();assert.equal(saved.remoteRevision,6);assert.equal(saved.pending,false);
  await editor.stage(bytes('NEXT EDIT'),saved.serial,6);
});
test('editor rejects a scope or device mismatch before accepting any personal text',async()=>{
  const f=await fixture(),client=f.make();
  assert.throws(()=>new E2eeEditorQueue(f.device,client,'project:wrong-scope','mindmap','one'),/SCOPE_BINDING_MISMATCH/);
  assert.throws(()=>new E2eeEditorQueue({vault:f.device.vault,ensureDurableKeys:()=>Promise.resolve()},client,f.rootContext.scopeId,'mindmap','one'),/SCOPE_BINDING_MISMATCH/);
  assert.equal(f.storage.rows.size,0);assert.equal(f.server.writes,0);
});
for(const dirty of [false,true])test(`editor reconciles a verified update from another device while retaining old snapshots (dirty: ${dirty})`,async()=>{
  const f=await fixture(),client=f.make();await client.refresh();const editor=new E2eeEditorQueue(f.device,client,f.rootContext.scopeId,'diary','one');
  await editor.stage(bytes('INITIAL'),null,0);await editor.flush();let saved=await editor.load();
  if(dirty){await editor.stage(bytes('UNSENT LOCAL'),saved.serial,1);saved=await editor.load();}
  await client.prepare('diary','one',bytes('REMOTE UPDATE'),1);await client.flush('diary','one');await client.read('diary','one');
  if(dirty)await assert.rejects(editor.flush(),/OBJECT_CONFLICT/);
  saved=await editor.load(); // A failed flush still durably records its upload origin.
  await assert.rejects(editor.reconcile(bytes('UNVERIFIED'),saved.serial,3),/VERIFIED_REMOTE_REQUIRED/);
  const retained=f.storage.rows.size;
  await editor.reconcile(bytes(dirty?'MERGED LOCAL AND REMOTE':'REMOTE UPDATE'),saved.serial,2,{filename:'',mediaType:'application/json'},dirty?'merge':'cache');
  assert.ok(f.storage.rows.size>retained);saved=await editor.load();assert.equal(saved.remoteRevision,2);assert.equal(saved.pending,dirty);
  if(dirty){assert.equal(await editor.flush(),3);assert.equal(text((await client.read('diary','one')).bytes),'MERGED LOCAL AND REMOTE');}
  else {await editor.stage(bytes('NEXT EDIT'),saved.serial,2);assert.equal(await editor.flush(),3);}
});
test('reconciliation after lost editor ACK preserves a newer verified remote base while consuming the older receipt',async()=>{
  const f=await fixture(),client=f.make();await client.refresh();const editor=new E2eeEditorQueue(f.device,client,f.rootContext.scopeId,'diary','one');
  await editor.stage(bytes('LOCAL A'),null,0);const commit=f.storage.commit.bind(f.storage);let crashed=false;
  f.storage.commit=async(changes,signal)=>{
    if(f.server.writes===2&&!crashed&&changes.some(change=>change.value?.envelope.context.objectId.startsWith('editor:'))){crashed=true;throw new Error('SYNTHETIC_PROCESS_DEATH');}
    return commit(changes,signal);
  };
  await assert.rejects(editor.flush(),/PROCESS_DEATH/);assert.equal((await client.localJob('diary','one')).complete,true);
  const original=f.server.objects.get('diary\0one'),remote=await sealE2eeFile(await importE2eeRoot(f.raw),f.keys.signing.privateKey,
    {...original.context,revision:2,operationId:'remote-after-crash'},bytes('REMOTE B'),{filename:'',mediaType:'application/json'});
  f.server.objects.set('diary\0one',remote.manifest);for(const chunk of remote.chunks)f.server.objects.set(`attachment\0${chunk.context.objectId}`,chunk);
  await client.read('diary','one');const saved=await editor.load();await editor.reconcile(bytes('MERGED A AND B'),saved.serial,2);
  assert.equal(await editor.flush(),3);assert.equal((await editor.load()).remoteRevision,3);assert.equal(text((await client.read('diary','one')).bytes),'MERGED A AND B');
});
for(const manifestAccepted of [false,true])test(`rebase resolves lost ACK before rotation (manifest accepted: ${manifestAccepted})`,async()=>{
  const f=await fixture({crashAfterPut:true,crashAtWrite:manifestAccepted?2:1});let client=f.make();await client.refresh();
  await client.prepare('workspace','one',bytes('DURABLE PRIVATE EDIT'),0);await assert.rejects(client.flush('workspace','one'),/PROCESS_DEATH/);
  await f.rotate();client=await f.reopen();await client.refresh();
  assert.equal(await client.rebase('workspace','one',0),manifestAccepted?'already-confirmed':'rebased');
  if(!manifestAccepted)await client.flush('workspace','one');
  assert.equal(text((await client.read('workspace','one')).bytes),'DURABLE PRIVATE EDIT');
});
test('durable cancel tombstone blocks a delayed original put; crash during cancel preserves the draft',async()=>{
  const f=await fixture({crashBeforePut:true,crashAfterCancel:true});let client=f.make();await client.refresh();
  await client.prepare('diary','one',bytes('PRESERVED DURING REBASE'),0);await assert.rejects(client.flush('diary','one'),/PROCESS_DEATH/);
  const delayed=f.server.lastPut;await f.rotate();await client.refresh();await assert.rejects(client.rebase('diary','one',0),/PROCESS_DEATH/);
  client=await f.reopen();await client.refresh();assert.equal(await client.rebase('diary','one',0),'rebased');
  assert.deepEqual(await f.transport.command(delayed),{cancelled:true});assert.equal(f.server.writes,0);
  await client.flush('diary','one');assert.equal(text((await client.read('diary','one')).bytes),'PRESERVED DURING REBASE');
});

test('parameterless product reads send a signed versioned payload without weakening the command codec',async()=>{
  const f=await fixture(),client=f.make(),seen=[];
  const methods=[['readTransitionCandidates','resource-transition-candidates'],['readProductContext','product-context'],
    ['readStoicheionState','stoicheion-state'],['readAdvicePolicy','advice-policy'],['sharedReadHistory','shared-read-history']];
  const original=f.transport.read.bind(f.transport);
  f.transport.read=async packet=>{
    const command=await verifyE2eeCommand(packet,f.keys.signing.publicKey);
    if(!methods.some(([,action])=>command.action===action))return original(packet);
    assert.deepEqual(command.payload,{protocol:1});seen.push(command.action);
    const base={checkpointHash:command.checkpointHash,directoryRevision:command.expectedRevision};
    return command.action==='shared-read-history'?{...base,history:{ownerId:command.ownerId,readFlags:{},watching:{}}}:base;
  };
  try{await client.refresh();for(const [method]of methods)await client[method]();
    assert.deepEqual(seen,methods.map(([,action])=>action));assert.equal(f.server.writes,0);
  }finally{f.device.lock();}
});

test('bootstrap discovery signs an initial null cursor and every supported nonnegative part index',async()=>{
  const f=await fixture(),client=f.make(),seen=[],original=f.transport.read.bind(f.transport);
  f.transport.read=async packet=>{
    const command=await verifyE2eeCommand(packet,f.keys.signing.publicKey);
    if(command.action!=='product-bootstrap-state')return original(packet);
    seen.push(command.payload.afterPart);
    return{checkpointHash:command.checkpointHash,directoryRevision:command.expectedRevision,bootstrap:null,part:null};
  };
  try{
    await client.refresh();await client.readBootstrapState();for(const part of [-1,0,255,256,4095])await client.readBootstrapState(part);
    assert.deepEqual(seen,[null,null,0,255,256,4095]);
    for(const part of [-2,4096,1.5])await assert.rejects(client.readBootstrapState(part),/E2EE_INVALID_LIMIT/);
    assert.equal(f.server.writes,0);
  }finally{f.device.lock();}
});
