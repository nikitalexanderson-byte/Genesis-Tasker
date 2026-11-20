import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { verifyDeviceDirectory, contentSigningKey } from '../app/e2ee/directory.ts';
import { importDeviceKeys, openRoot, recoverAuthority, generateDeviceKeys, publicDeviceKeys } from '../app/e2ee/keys.ts';
import { importE2eeRoot, sealE2eeEnvelope, openE2eeEnvelope, encodeE2eeBytes, decodeE2eeBytes } from '../app/e2ee/envelope.ts';
import { canonicalE2eeValue, signE2eeCommand } from '../app/e2ee/commands.ts';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/e2ee/v1-runtime.json',import.meta.url),'utf8'));
const {ownerId,scopeId}=fixture.rootContext;
const verify=(events=fixture.directory.events,previous)=>verifyDeviceDirectory(ownerId,scopeId,fixture.recoveryKit.authority,events,previous);
async function sharedFixture(role){
  const owner=await importDeviceKeys(fixture.device),candidate=await generateDeviceKeys();
  const authority=await recoverAuthority(ownerId,decodeE2eeBytes(fixture.secret,32),fixture.recoveryKit);
  const base=structuredClone(fixture.directory.events[0].command);base.payload.kind='project';base.payload.resourceId='shared-project';
  delete base.payload.selfProof;base.payload.selfProof=(await signE2eeCommand(base,owner.signing.privateKey)).signature;
  const events=[await signE2eeCommand(base,authority.signing.privateKey)],dir=await verify(events);
  const challenge={id:'role-challenge',scopeId,userId:'participant',role,sessionHash:'a'.repeat(64),deviceId:'candidate',
    ...await publicDeviceKeys(candidate),nonce:'b'.repeat(64),expiresAt:2_000_000_000};
  const prefix=new TextEncoder().encode('GENESIS-E2EE-ENROLLMENT\0v1\0'),body=canonicalE2eeValue(challenge),bytes=new Uint8Array(prefix.length+body.length);
  bytes.set(prefix);bytes.set(body,prefix.length);
  const selfProof=encodeE2eeBytes(new Uint8Array(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},candidate.signing.privateKey,bytes)));
  const command={protocol:1,ownerId,scopeId,deviceId:'fixture-device',action:'enroll',expectedRevision:dir.checkpoint.revision,
    checkpointHash:dir.checkpoint.hash,securityEpoch:1,operationId:'role-enroll',payload:{challenge,selfProof,capsule:fixture.rootCapsule,historyCapsules:[]}};
  events.push(await signE2eeCommand(command,owner.signing.privateKey));
  return{events,directory:await verify(events),candidate};
}

for(const role of ['reader','writer','commenter'])test(`shared ${role} key cannot administer enrollment or rotate the directory`,async()=>{
  const f=await sharedFixture(role),dir=f.directory;
  const command={protocol:1,ownerId,scopeId,deviceId:'candidate',action:'rotate',expectedRevision:dir.checkpoint.revision,
    checkpointHash:dir.checkpoint.hash,securityEpoch:1,operationId:'unauthorized-rotate',payload:fixture.directory.events.at(-1).command.payload};
  await assert.rejects(verify([...f.events,await signE2eeCommand(command,f.candidate.signing.privateKey)]),/UNTRUSTED_DIRECTORY/);
  command.action='enroll';command.payload=f.events.at(-1).command.payload;
  await assert.rejects(verify([...f.events,await signE2eeCommand(command,f.candidate.signing.privateKey)]),/UNTRUSTED_DIRECTORY/);
});
test('signed roles restrict whole-project writes and keep comments append-only on both sides',async()=>{
  const context={...fixture.file.manifest.context,deviceId:'candidate',domain:'shared-project'};
  const reader=await sharedFixture('reader');await assert.rejects(contentSigningKey(reader.directory,context),/UNTRUSTED_DIRECTORY/);
  const commenter=await sharedFixture('commenter');await assert.rejects(contentSigningKey(commenter.directory,context),/UNTRUSTED_DIRECTORY/);
  await contentSigningKey(commenter.directory,{...context,domain:'shared-comment'});
  await assert.rejects(contentSigningKey(commenter.directory,{...context,domain:'shared-comment',revision:2}),/UNTRUSTED_DIRECTORY/);
  const writer=await sharedFixture('writer');await contentSigningKey(writer.directory,context);
});
test('trust reconstructed from signed genesis/enrollment/rotation chain matches native checkpoint',async()=>{
  const directory=await verify();assert.deepEqual(directory.checkpoint,fixture.directory.checkpoint);
  assert.equal(directory.state,'active');assert.equal(directory.cryptoEpoch,2);assert.equal(directory.securityEpoch,2);
  assert.equal(directory.devices.get('fixture-device').revoked,true);assert.equal(directory.devices.get('fixture-second').revoked,false);
  assert.deepEqual((await verify(undefined,directory.checkpoint)).checkpoint,directory.checkpoint);
});
test('a historical root keyId can never be reused by a later signed rotation',async()=>{
  const directory=await verify(),keys=await importDeviceKeys(fixture.secondDevice);
  const command={protocol:1,ownerId,scopeId,deviceId:'fixture-second',action:'rotate',expectedRevision:directory.checkpoint.revision,
    checkpointHash:directory.checkpoint.hash,securityEpoch:directory.securityEpoch,operationId:'reuse-old-id',payload:{...fixture.directory.events.at(-1).command.payload,
      cryptoEpoch:3,securityEpoch:3,keyId:fixture.rootContext.keyId,revokedDeviceIds:[]}};
  await assert.rejects(verify([...fixture.directory.events,await signE2eeCommand(command,keys.signing.privateKey)]),/UNTRUSTED_DIRECTORY/);
});
test('directory rollback, substituted root, command tamper and revoked signer extensions fail',async()=>{
  const events=fixture.directory.events;
  await assert.rejects(verify(events.slice(0,-1),fixture.directory.checkpoint),/UNTRUSTED_DIRECTORY/);
  await assert.rejects(verify(events,{...fixture.directory.checkpoint,hash:'different'}),/UNTRUSTED_DIRECTORY/);
  const tampered=structuredClone(events);tampered[2].command.payload.challenge.receivingKey=fixture.device.receivingKey;
  await assert.rejects(verify(tampered),/UNTRUSTED/);
  const otherPin={...fixture.recoveryKit.authority,signingKey:fixture.device.signingKey};
  await assert.rejects(verifyDeviceDirectory(ownerId,scopeId,otherPin,events),/UNTRUSTED/);
  const keys=await importDeviceKeys(fixture.device),last=(await verify()).checkpoint;
  const revoked=await signE2eeCommand({protocol:1,ownerId,scopeId,deviceId:'fixture-device',action:'enroll',expectedRevision:last.revision,
    checkpointHash:last.hash,securityEpoch:2,operationId:'revoked-op',payload:events[2].command.payload},keys.signing.privateKey);
  await assert.rejects(verify([...events,revoked]),/UNTRUSTED_DIRECTORY/);
});

test('the saved checkpoint cannot be lowered by mutating the caller object while verification yields',async()=>{
  const first=await verify(fixture.directory.events.slice(0,1)),previous={...fixture.directory.checkpoint};
  const pending=verify(fixture.directory.events.slice(0,-1),previous);
  Object.assign(previous,first.checkpoint);
  await assert.rejects(pending,/E2EE_UNTRUSTED_DIRECTORY/);
});
test('revoked root/device cannot open future root or future content; survivor can',async()=>{
  const directory=await verify(),survivor=await importDeviceKeys(fixture.secondDevice),revoked=await importDeviceKeys(fixture.device);
  const context={ownerId,scopeId,cryptoEpoch:2,keyId:directory.keyId,recipientId:'fixture-second'};
  const capsule=directory.devices.get('fixture-second').capsule;
  const root=await openRoot(capsule,survivor.receiving.privateKey,context);
  await assert.rejects(openRoot(capsule,revoked.receiving.privateKey,context));
  const header={...fixture.file.manifest.context,cryptoEpoch:2,securityEpoch:2,keyId:directory.keyId,deviceId:'fixture-second'};
  const bytes=new TextEncoder().encode('FUTURE PRIVATE DATA');const envelope=await sealE2eeEnvelope(root,survivor.signing.privateKey,header,bytes);
  assert.deepEqual(await openE2eeEnvelope(root,survivor.signing.publicKey,header,envelope),bytes);
  await assert.rejects(openE2eeEnvelope(await importE2eeRoot(Uint8Array.from(Buffer.from(fixture.root,'base64url'))),survivor.signing.publicKey,header,envelope),/CORRUPT/);
});
