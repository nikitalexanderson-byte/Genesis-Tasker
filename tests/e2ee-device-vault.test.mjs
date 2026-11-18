import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { UnlockedWebDevice } from '../app/e2ee/device-vault.ts';
import { createRecoveryKit, freshSecret, forwardRoot, importDeviceKeys, openRoot, publicDeviceKeys } from '../app/e2ee/keys.ts';
import { openE2eeFile } from '../app/e2ee/files.ts';
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
