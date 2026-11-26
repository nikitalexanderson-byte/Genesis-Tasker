import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDecipheriv, hkdfSync } from 'node:crypto';
import { test } from 'node:test';
import { freshSecret, forwardRoot, importDeviceKeys, openBundle, openRoot, protectBundle, recoverAuthority, publicDeviceKeys, sealRoot } from '../app/e2ee/keys.ts';
import { importE2eeRoot, openE2eeEnvelope, sealE2eeEnvelope } from '../app/e2ee/envelope.ts';

const fixture=JSON.parse(readFileSync(new URL('./fixtures/e2ee/v1-runtime.json',import.meta.url),'utf8'));
const bytes=value=>new TextEncoder().encode(value);
const raw=value=>Uint8Array.from(Buffer.from(value,'base64url'));

// An independent Node/OpenSSL oracle demonstrates the actual confidentiality
// consequence of converting an untyped 32-character string to an empty IKM.
function openWithEmptyIkm(bundle){
 const key=Buffer.from(hkdfSync('sha256',Buffer.alloc(0),Buffer.from(bundle.salt,'base64url'),
  bytes(`GENESIS-E2EE-SECRET\0v1\0${bundle.ownerId}\0${bundle.purpose}`),32));
 try{
  const encrypted=Buffer.from(bundle.ciphertext,'base64url'),decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(bundle.nonce,'base64url'));
  decipher.setAAD(bytes(`GENESIS-E2EE-BUNDLE\0v1\0${bundle.ownerId}\0${bundle.purpose}`));decipher.setAuthTag(encrypted.subarray(-16));
  return Buffer.concat([decipher.update(encrypted.subarray(0,-16)),decipher.final()]);
 }finally{key.fill(0);}
}

test('audit: a text secret cannot produce a public-empty-IKM decryptable bundle',async()=>{
 const clear=bytes('SYNTHETIC KEY INPUT AUDIT');let refused=false;
 try{
  const bundle=await protectBundle('audit-owner','device-vault','x'.repeat(32),clear);
  const exposed=openWithEmptyIkm(bundle);
  assert.notDeepEqual(exposed,Buffer.from(clear),'invalid secret was converted to publicly reproducible empty HKDF input');
 }catch(error){if(error?.message==='E2EE_INVALID_KEY_BUNDLE')refused=true;else throw error;}
 assert.equal(refused,true,'invalid key input must refuse before returning ciphertext');
});

test('audit: bundle and root writers refuse non-byte secret lookalikes',async()=>{
 const device=await importDeviceKeys(fixture.device);
 for(const invalid of [Array(32).fill(7),{length:32},new Uint16Array(32),new Uint8ClampedArray(32),new ArrayBuffer(32),null]){
  await assert.rejects(protectBundle('audit-owner','device-vault',invalid,bytes('synthetic')),/E2EE_INVALID_KEY_BUNDLE/);
  await assert.rejects(sealRoot(invalid,fixture.device.receivingKey,fixture.rootContext),/E2EE_INVALID_KEY_BUNDLE/);
 }
 const valid=new Uint8Array(32).fill(7),capsule=await sealRoot(valid,fixture.device.receivingKey,fixture.rootContext);
 await openRoot(capsule,device.receiving.privateKey,fixture.rootContext);
});

test('audit: bundle plaintext is owned before KDF yields and caller clears its bytes',async()=>{
 const secret=freshSecret(),source=bytes('SYNTHETIC PORTABLE KEY BUNDLE'),expected=new Uint8Array(source);
 const pending=protectBundle('audit-owner','device-vault',secret,source);source.fill(0);
 const bundle=await pending,opened=await openBundle('audit-owner','device-vault',secret,bundle);
 try{assert.deepEqual(opened,expected);}finally{opened.fill(0);secret.fill(0);}
});

test('audit: root material is owned before HPKE yields and the caller clears it',async()=>{
 const device=await importDeviceKeys(fixture.device),original=raw(fixture.root),root=new Uint8Array(original);
 const pending=sealRoot(root,fixture.device.receivingKey,fixture.rootContext);root.fill(0);
 const capsule=await pending,opened=await openRoot(capsule,device.receiving.privateKey,fixture.rootContext);
 const expected=await importE2eeRoot(original),clear=bytes('SYNTHETIC ORIGINAL ROOT');
 const envelope=await sealE2eeEnvelope(expected,device.signing.privateKey,fixture.file.manifest.context,clear);
 const decrypted=await openE2eeEnvelope(opened,device.signing.publicKey,envelope.context,envelope);
 try{assert.deepEqual(decrypted,clear);}finally{decrypted.fill(0);original.fill(0);}
});

test('audit: asynchronous root forwarding cannot bypass same-owner and same-scope restriction',async()=>{
 const device=await importDeviceKeys(fixture.device),peer=await importDeviceKeys(fixture.secondDevice);
 const source={...fixture.rootContext},target={...source,recipientId:'audit-peer'},expected={...target};
 const pending=forwardRoot(fixture.rootCapsule,device.receiving.privateKey,source,fixture.secondDevice.receivingKey,target);
 target.ownerId='different-owner';target.scopeId='different-scope';target.keyId='different-key';target.cryptoEpoch++;
 const capsule=await pending;
 await assert.rejects(openRoot(capsule,peer.receiving.privateKey,target),/E2EE_CORRUPT_ROOT/);
 await openRoot(capsule,peer.receiving.privateKey,expected);
});

test('audit: recipient context and capsule inputs cannot be replaced while HPKE is pending',async()=>{
 const device=await importDeviceKeys(fixture.device),context={...fixture.rootContext},root=raw(fixture.root);
 const pending=sealRoot(root,fixture.device.receivingKey,context);context.ownerId='another-owner';context.scopeId='another-scope';
 const capsule=await pending,opening=openRoot(capsule,device.receiving.privateKey,fixture.rootContext);
 capsule.ciphertext='invalid';await opening;root.fill(0);
});

test('audit: imported private pairs and recovery authority are captured before asynchronous import',async()=>{
 const saved={...fixture.device},pending=importDeviceKeys(saved);
 saved.signingPrivate='invalid';saved.receivingPrivate='invalid';saved.receivingKey=fixture.secondDevice.receivingKey;
 assert.deepEqual(await publicDeviceKeys(await pending),{signingKey:fixture.device.signingKey,receivingKey:fixture.device.receivingKey});
 const kit=structuredClone(fixture.recoveryKit),recovering=recoverAuthority(kit.ownerId,raw(fixture.secret),kit);
 kit.authority.signingKey=fixture.device.signingKey;kit.protectedKeys.ciphertext='invalid';
 assert.deepEqual(await publicDeviceKeys(await recovering),fixture.recoveryKit.authority);
});

test('audit: accessor key metadata is refused without executing the accessor',async()=>{
 let invoked=0;
 function accessor(source,name){const value={...source};Object.defineProperty(value,name,{enumerable:true,get(){invoked++;return source[name];}});return value;}
 await assert.rejects(importDeviceKeys(accessor(fixture.device,'signingPrivate')),/E2EE_INVALID_KEY_BUNDLE/);
 await assert.rejects(sealRoot(raw(fixture.root),fixture.device.receivingKey,accessor(fixture.rootContext,'ownerId')),/E2EE_INVALID_KEY_BUNDLE/);
 const device=await importDeviceKeys(fixture.device);
 await assert.rejects(openRoot(accessor(fixture.rootCapsule,'ciphertext'),device.receiving.privateKey,fixture.rootContext),/E2EE_INVALID_KEY_BUNDLE/);
 await assert.rejects(openBundle(fixture.rootContext.ownerId,'device-vault',raw(fixture.secret),accessor(fixture.bundle,'nonce')),/E2EE_INVALID_KEY_BUNDLE/);
 assert.equal(invoked,0);
});

test('audit: resizable plaintext cannot grow past the admitted bundle after KDF starts',async()=>{
 const buffer=new ArrayBuffer(4,{maxByteLength:65537}),source=new Uint8Array(buffer);source.set([7,8,9,10]);
 const secret=freshSecret(),pending=protectBundle('audit-owner','device-vault',secret,source);buffer.resize(65537);
 const opened=await openBundle('audit-owner','device-vault',secret,await pending);
 try{assert.deepEqual(opened,new Uint8Array([7,8,9,10]));}finally{opened.fill(0);secret.fill(0);}
 const spoofed=new Uint8Array(1);Object.defineProperty(spoofed,'length',{value:32});
 await assert.rejects(protectBundle('audit-owner','device-vault',spoofed,bytes('synthetic')),/E2EE_INVALID_KEY_BUNDLE/);
});
