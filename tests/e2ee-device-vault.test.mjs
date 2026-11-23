import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { UnlockedWebDevice, bindWebVaultLifecycle } from '../app/e2ee/device-vault.ts';
import { createRecoveryKit, freshSecret, forwardRoot, importDeviceKeys, openRoot, publicDeviceKeys } from '../app/e2ee/keys.ts';
import { openE2eeFile } from '../app/e2ee/files.ts';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/e2ee/v1-runtime.json',import.meta.url),'utf8'));
class KeyStore{
  rows=new Map();fail=false;
  async get(owner){return structuredClone(this.rows.get(owner)??null);}
  async create(owner,bundle){if(this.fail)throw new Error('DISK_FULL');if(this.rows.has(owner))throw new Error('E2EE_DEVICE_ALREADY_EXISTS');this.rows.set(owner,{serial:1,bundle:structuredClone(bundle)});}
}
class RecordStore{
  rows=new Map();
  async get(key){return structuredClone(this.rows.get(key)??null);}
  async list(prefix){return [...this.rows.keys()].filter(key=>key.startsWith(prefix));}
  async commit(changes){for(const change of changes)assert.equal(this.rows.get(change.key)?.serial??null,change.expected);for(const change of changes)this.rows.set(change.key,structuredClone(change.value));}
}
test('recovery secret unlocks ciphertext-only durable device vault across process restart; login alone does not',async()=>{
  const owner='fixture-owner',recovery=await createRecoveryKit(owner),keys=new KeyStore(),records=new RecordStore();
  const device=await UnlockedWebDevice.provision(owner,recovery.secret,recovery.kit,records,keys);await device.ensureDurableKeys();
  assert.throws(()=>device.requireDurableProvider(),/STORAGE_PROVIDER_REQUIRED/,'memory component ports cannot become a product capture provider');
  const privateBytes=new TextEncoder().encode('PRIVATE DRAFT + QUEUED DATA');
  await device.vault.write([{domain:'draft',objectId:'draft',value:privateBytes,expected:null}]);device.lock();
  assert.throws(()=>device.keys(),/UNLOCK_REQUIRED/);
  await assert.rejects(UnlockedWebDevice.unlock(owner,freshSecret(),records,keys),/UNLOCK_REQUIRED/);
  await assert.rejects(UnlockedWebDevice.unlock('other-owner',recovery.secret,records,keys),/NOT_ENROLLED/);
  const reopened=await UnlockedWebDevice.unlock(owner,recovery.secret,records,keys);
  assert.equal(reopened.deviceId,device.deviceId);assert.deepEqual((await reopened.vault.read('draft','draft')).value,privateBytes);
  assert.equal(reopened.keys().signing.privateKey.extractable,false);
  const persisted=JSON.stringify([...keys.rows])+JSON.stringify([...records.rows]);
  assert.ok(!persisted.includes('PRIVATE DRAFT'));assert.ok(!persisted.includes(Buffer.from(recovery.secret).toString('base64url')));
  await assert.rejects(UnlockedWebDevice.provision(owner,recovery.secret,recovery.kit,records,keys),/ALREADY_EXISTS/);
  keys.rows.get(owner).bundle.ciphertext='corrupted';await assert.rejects(reopened.ensureDurableKeys(),/UNAVAILABLE/);
  await assert.rejects(UnlockedWebDevice.unlock(owner,recovery.secret,records,keys));
  assert.equal(records.rows.size,1,'corrupt keys never clear data');
});
test('failed persistence does not grant an unlocked device capability',async()=>{
  const recovery=await createRecoveryKit('owner'),keys=new KeyStore();keys.fail=true;
  await assert.rejects(UnlockedWebDevice.provision('owner',recovery.secret,recovery.kit,new RecordStore(),keys),/DISK_FULL/);
  assert.equal(keys.rows.size,0);
});

test('provisioning owns the recovery secret before asynchronous key work and caller cleanup',async()=>{
  const recovery=await createRecoveryKit('snapshot-owner'),keys=new KeyStore(),records=new RecordStore(),retained=new Uint8Array(recovery.secret);
  const pending=UnlockedWebDevice.provision('snapshot-owner',recovery.secret,recovery.kit,records,keys);recovery.secret.fill(0);
  const provisioned=await pending;provisioned.lock();
  const reopened=await UnlockedWebDevice.unlock('snapshot-owner',retained,records,keys);
  assert.equal(reopened.deviceId,provisioned.deviceId);reopened.lock();retained.fill(0);
});

test('unlock owns its secret before waiting for key storage',async()=>{
  const recovery=await createRecoveryKit('snapshot-unlock'),keys=new KeyStore(),records=new RecordStore();
  (await UnlockedWebDevice.provision('snapshot-unlock',recovery.secret,recovery.kit,records,keys)).lock();
  const supplied=new Uint8Array(recovery.secret),pending=UnlockedWebDevice.unlock('snapshot-unlock',supplied,records,keys);supplied.fill(0);
  const reopened=await pending;reopened.lock();recovery.secret.fill(0);
});

test('directory persistence stores exactly the verified pin and history despite caller mutation in the frame observer',async()=>{
  const owner=fixture.rootContext.ownerId,scope=fixture.rootContext.scopeId,secret=Uint8Array.from(Buffer.from(fixture.secret,'base64url'));
  const keys=new KeyStore(),records=new RecordStore(),device=await UnlockedWebDevice.provision(owner,secret,fixture.recoveryKit,records,keys);
  const pin=structuredClone(fixture.recoveryKit.authority),events=structuredClone(fixture.directory.events);
  const verified=await device.rememberDirectory(scope,pin,events,owner,()=>{
    pin.signingKey=fixture.device.signingKey;events[0].signature='invalid';
  });
  assert.deepEqual(verified.checkpoint,fixture.directory.checkpoint);device.lock();
  const reopened=await UnlockedWebDevice.unlock(owner,secret,records,keys),saved=await reopened.savedDirectory(scope);
  assert.deepEqual(saved.checkpoint,verified.checkpoint);assert.deepEqual(saved.recoveryKit.authority,fixture.recoveryKit.authority);
  reopened.lock();secret.fill(0);
});

test('repeated verification of the same signed directory preserves the retained encrypted record and serial',async()=>{
  const owner=fixture.rootContext.ownerId,scope=fixture.rootContext.scopeId,secret=Uint8Array.from(Buffer.from(fixture.secret,'base64url'));
  const records=new RecordStore(),device=await UnlockedWebDevice.provision(owner,secret,fixture.recoveryKit,records,new KeyStore());
  try{
    const first=await device.rememberDirectory(scope,fixture.recoveryKit.authority,fixture.directory.events,owner);
    const retained=JSON.stringify([...records.rows]);
    const again=await device.rememberDirectory(scope,fixture.recoveryKit.authority,fixture.directory.events,owner);
    assert.deepEqual(again.checkpoint,first.checkpoint);
    assert(JSON.stringify([...records.rows])===retained,'an unchanged signed directory must not invalidate another scope’s retained-history snapshot');
  }finally{device.lock();secret.fill(0);}
});

test('unchanged-directory verification still refuses a concurrent encrypted record replacement',async()=>{
  const owner=fixture.rootContext.ownerId,scope=fixture.rootContext.scopeId,secret=Uint8Array.from(Buffer.from(fixture.secret,'base64url'));
  const records=new RecordStore(),device=await UnlockedWebDevice.provision(owner,secret,fixture.recoveryKit,records,new KeyStore());
  try{
    await device.rememberDirectory(scope,fixture.recoveryKit.authority,fixture.directory.events,owner);
    const [key,row]=[...records.rows].find(([key])=>key.includes('key-check'));
    const saved=await device.vault.read('key-check',row.envelope.context.objectId);
    let replace=false;const get=records.get.bind(records),commit=records.commit.bind(records);
    const replaceOnce=async()=>{
      if(replace){
        replace=false;
        await device.vault.write([{domain:'key-check',objectId:row.envelope.context.objectId,value:saved.value,expected:saved.serial}]);
      }
    };
    records.get=async coordinate=>{if(coordinate===key)await replaceOnce();return get(coordinate);};
    records.commit=async changes=>{if(changes.some(change=>change.key===key))await replaceOnce();return commit(changes);};
    await assert.rejects(device.rememberDirectory(scope,fixture.recoveryKit.authority,fixture.directory.events,owner,()=>{replace=true;}));
    assert.equal(records.rows.get(key).serial,2,'the concurrent writer is retained');
    saved.value.fill(0);
  }finally{device.lock();secret.fill(0);}
});

test('durable-key acknowledgement refuses changed bundle identity headers without discarding encrypted rows',async()=>{
  const owner='durable-headers',recovery=await createRecoveryKit(owner),keys=new KeyStore(),records=new RecordStore();
  const device=await UnlockedWebDevice.provision(owner,recovery.secret,recovery.kit,records,keys),original=structuredClone(keys.rows.get(owner));
  await device.vault.write([{domain:'draft',objectId:'must-retain',value:new TextEncoder().encode('SYNTHETIC RETAINED DRAFT'),expected:null}]);
  const retained=JSON.stringify([...records.rows]);
  for(const [field,value]of [['protocol',2],['ownerId','different-owner'],['purpose','different-purpose'],['unknown','refuse-extra']]){
    const modified=structuredClone(original);modified.bundle[field]=value;keys.rows.set(owner,modified);
    await assert.rejects(device.ensureDurableKeys(),/E2EE_DEVICE_KEY_UNAVAILABLE/);
    assert.equal(JSON.stringify([...records.rows]),retained);
  }
  keys.rows.set(owner,original);await device.ensureDurableKeys();device.lock();recovery.secret.fill(0);
});

test('a lifecycle bound while the document is already hidden immediately revokes its unlocked capability',async()=>{
  const recovery=await createRecoveryKit('initial-hidden'),device=await UnlockedWebDevice.provision('initial-hidden',recovery.secret,recovery.kit,new RecordStore(),new KeyStore());
  const target=new EventTarget();target.document=new EventTarget();target.document.visibilityState='hidden';
  const dispose=bindWebVaultLifecycle(device,target);
  try{assert.throws(()=>device.keys(),/E2EE_UNLOCK_REQUIRED/);await assert.rejects(device.vault.read('draft','pending'),/E2EE_UNLOCK_REQUIRED/);}
  finally{dispose();recovery.secret.fill(0);}
});
test('root forwarding proves possession and binds recipient/epoch without an extractable root',async()=>{
  const fixture=JSON.parse(readFileSync(new URL('./fixtures/e2ee/v1-runtime.json',import.meta.url),'utf8'));
  const device=await importDeviceKeys(fixture.device),peer=await importDeviceKeys(fixture.secondDevice),pub=await publicDeviceKeys(peer);
  const target={...fixture.rootContext,recipientId:'fixture-second'};
  const capsule=await forwardRoot(fixture.rootCapsule,device.receiving.privateKey,fixture.rootContext,pub.receivingKey,target);
  const root=await openRoot(capsule,peer.receiving.privateKey,target);assert.equal(root.extractable,false);
  const opened=await openE2eeFile(root,device.signing.publicKey,fixture.file.manifest.context,fixture.file.manifest,
    async id=>fixture.file.chunks.find(chunk=>chunk.context.objectId===id));
  assert.equal(Buffer.from(opened.bytes).toString('base64url'),fixture.plaintext);
  await assert.rejects(forwardRoot(fixture.rootCapsule,device.receiving.privateKey,fixture.rootContext,pub.receivingKey,{...target,cryptoEpoch:2}),/INVALID/);
});
