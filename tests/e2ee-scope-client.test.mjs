import assert from 'node:assert/strict';
import {test} from 'node:test';
import {UnlockedWebDevice} from '../app/e2ee/device-vault.ts';
import {E2eeScopeClient} from '../app/e2ee/scope-client.ts';
import {createRecoveryKit,freshSecret,sealRoot,publicDeviceKeys} from '../app/e2ee/keys.ts';
import {encodeE2eeBytes,importE2eeRoot,sealE2eeEnvelope} from '../app/e2ee/envelope.ts';
import {signE2eeCommand,verifyE2eeCommand,e2eeCommandHash} from '../app/e2ee/commands.ts';
import {envelopePayloadHash,objectManifestHash,sealE2eeFile} from '../app/e2ee/files.ts';
import {verifyDeviceDirectory} from '../app/e2ee/directory.ts';

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
  return {make,reopen,storage,keyStorage,server,transport,rotate,raw,keys,rootContext};
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
