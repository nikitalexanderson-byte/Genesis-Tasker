import assert from 'node:assert/strict';
import { test } from 'node:test';
import { freshSecret, generateDeviceKeys, publicDeviceKeys, exportPrivateDeviceKeys, importDeviceKeys,
  protectBundle, openBundle, sealRoot, openRoot, createRecoveryKit, recoverAuthority } from '../app/e2ee/keys.ts';
import { E2EE_SUITE, importE2eeRoot, sealE2eeEnvelope, openE2eeEnvelope } from '../app/e2ee/envelope.ts';
import { canonicalE2eeValue, signE2eeCommand, verifyE2eeCommand, e2eeCommandHash } from '../app/e2ee/commands.ts';

const rootContext={ownerId:'synthetic-owner',scopeId:'personal:synthetic-owner',cryptoEpoch:1,keyId:'fresh-key',recipientId:'synthetic-device'};
test('independent recovery authority: clean-client recovery, wrong identity/secret/tamper rejected',async()=>{
  const {secret,kit,keys}=await createRecoveryKit(rootContext.ownerId);
  assert.equal(secret.length,32);
  const recovered=await recoverAuthority(rootContext.ownerId,secret,JSON.parse(JSON.stringify(kit)));
  assert.deepEqual(await publicDeviceKeys(recovered),await publicDeviceKeys(keys));
  assert.ok(!JSON.stringify(kit).includes(Buffer.from(secret).toString('base64url')));
  await assert.rejects(recoverAuthority(rootContext.ownerId,freshSecret(),kit),/E2EE_UNLOCK_REQUIRED/);
  await assert.rejects(recoverAuthority('other-owner',secret,kit),/E2EE_INVALID/);
  const bad=structuredClone(kit);bad.authority.signingKey=(await publicDeviceKeys(await generateDeviceKeys())).signingKey;
  await assert.rejects(recoverAuthority(rootContext.ownerId,secret,bad),/E2EE_INVALID/);
});
test('RFC9180 HPKE delivers independent root to intended device and binds every context field',async()=>{
  const device=await generateDeviceKeys(), pub=await publicDeviceKeys(device), root=freshSecret();
  const capsule=await sealRoot(root,pub.receivingKey,rootContext);
  assert.equal(Buffer.from(capsule.enc,'base64url').length,65);
  assert.equal(Buffer.from(capsule.ciphertext,'base64url').length,48);
  const opened=await openRoot(capsule,device.receiving.privateKey,rootContext);
  assert.equal(opened.extractable,false);
  const context={...rootContext,recipientId:undefined};delete context.recipientId;
  const envelopeContext={cryptoProtocol:1,suite:E2EE_SUITE,ownerId:rootContext.ownerId,scopeId:rootContext.scopeId,
    domain:'workspace',objectId:'document',schemaVersion:1,dataGeneration:1,writerProtocol:9,cryptoEpoch:1,securityEpoch:1,
    revision:1,keyId:rootContext.keyId,deviceId:'synthetic-device',operationId:'synthetic-op'};
  const plaintext=new TextEncoder().encode('Синтетические закрытые данные');
  const envelope=await sealE2eeEnvelope(await importE2eeRoot(root),device.signing.privateKey,envelopeContext,plaintext);
  assert.deepEqual(await openE2eeEnvelope(opened,device.signing.publicKey,envelopeContext,envelope),plaintext);
  for(const key of ['ownerId','scopeId','cryptoEpoch','keyId','recipientId']) {
    await assert.rejects(openRoot(capsule,device.receiving.privateKey,{...rootContext,[key]:key==='cryptoEpoch'?2:'other-id'}),/E2EE_CORRUPT_ROOT/);
  }
  const other=await generateDeviceKeys();
  await assert.rejects(openRoot(capsule,other.receiving.privateKey,rootContext));
});
test('private device bundle is protected independently, rejects substitution of key pairs',async()=>{
  const keys=await generateDeviceKeys(), raw=await exportPrivateDeviceKeys(keys);
  assert.deepEqual(await publicDeviceKeys(await importDeviceKeys(raw)),await publicDeviceKeys(keys));
  const bad={...raw,signingPrivate:(await exportPrivateDeviceKeys(await generateDeviceKeys())).signingPrivate};
  await assert.rejects(importDeviceKeys(bad),/E2EE_INVALID/);
  const badReceiver={...raw,receivingPrivate:(await exportPrivateDeviceKeys(await generateDeviceKeys())).receivingPrivate};
  await assert.rejects(importDeviceKeys(badReceiver),/E2EE_INVALID/);
  const secret=freshSecret(), bytes=new TextEncoder().encode(JSON.stringify(raw));
  const wrapped=await protectBundle(rootContext.ownerId,'device-vault',secret,bytes);
  assert.deepEqual(await openBundle(rootContext.ownerId,'device-vault',secret,wrapped),bytes);
  await assert.rejects(openBundle(rootContext.ownerId,'recovery-authority',secret,wrapped),/E2EE_INVALID/);
  await assert.rejects(protectBundle(rootContext.ownerId,'device-vault',new Uint8Array(31),bytes),/E2EE_INVALID/);
  await assert.rejects(protectBundle(rootContext.ownerId,'device-vault',secret,new Uint8Array(65537)),/E2EE_INVALID/);
});
test('command canonical encoding/order, signature, bounded parsers, signature-free operation identity',async()=>{
  assert.deepEqual(canonicalE2eeValue({b:2,a:'x'}),canonicalE2eeValue({a:'x',b:2}));
  for(const value of [NaN,Infinity,-1,1.1,2**53,new Date(),{bad:'данные'}]) assert.throws(()=>canonicalE2eeValue(value));
  const accessor={};Object.defineProperty(accessor,'secret',{enumerable:true,get(){throw new Error('must not execute');}});
  assert.throws(()=>canonicalE2eeValue(accessor),/E2EE_INVALID_COMMAND/);
  const {signing}=await generateDeviceKeys();
  const command={protocol:1,ownerId:'owner',scopeId:'scope',deviceId:'device',action:'read',expectedRevision:1,checkpointHash:'genesis',securityEpoch:1,
    operationId:'op',payload:{domain:'workspace',after:'',limit:10}};
  const signed=await signE2eeCommand(command,signing.privateKey);
  command.payload.limit=20;
  assert.equal((await verifyE2eeCommand(signed,signing.publicKey)).payload.limit,10);
  const changed=structuredClone(signed);changed.command.operationId='bad';
  await assert.rejects(verifyE2eeCommand(changed,signing.publicKey),/E2EE_UNTRUSTED_COMMAND/);
  const first={...command,payload:{nested:{signature:'first',ciphertext:'same'}}};
  const second={...command,payload:{nested:{signature:'second',ciphertext:'same'}}};
  assert.equal(await e2eeCommandHash(first),await e2eeCommandHash(second));
  second.payload.nested.ciphertext='changed';assert.notEqual(await e2eeCommandHash(first),await e2eeCommandHash(second));
});
