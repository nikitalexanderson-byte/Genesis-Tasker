// PUBLIC SYNTHETIC KEYS ONLY. This generator never reads production configuration.
import { writeFileSync } from 'node:fs';
import { createRecoveryKit, generateDeviceKeys, exportPrivateDeviceKeys, publicDeviceKeys, freshSecret, sealRoot, protectBundle } from '../../app/e2ee/keys.ts';
import { encodeE2eeBytes } from '../../app/e2ee/envelope.ts';
import { canonicalE2eeValue, commandBytes, e2eeCommandHash, signE2eeCommand } from '../../app/e2ee/commands.ts';
import { verifyDeviceDirectory } from '../../app/e2ee/directory.ts';
import { sealE2eeFile, objectManifestHash, envelopePayloadHash } from '../../app/e2ee/files.ts';
import { E2EE_SUITE, importE2eeRoot } from '../../app/e2ee/envelope.ts';
const ownerId='fixture-runtime-owner';
const authority=await createRecoveryKit(ownerId),device=await generateDeviceKeys(),root=freshSecret();
const context={ownerId,scopeId:'personal:fixture-runtime-owner',cryptoEpoch:1,keyId:'fresh-key-one',recipientId:'fixture-device'};
const capsule=await sealRoot(root,(await publicDeviceKeys(device)).receivingKey,context);
const plaintext=new TextEncoder().encode('PUBLIC SYNTHETIC BUNDLE — Тест восстановления');
const bundle=await protectBundle(ownerId,'device-vault',authority.secret,plaintext);
const command={protocol:1,ownerId,scopeId:context.scopeId,deviceId:'fixture-device',action:'read',expectedRevision:7,
  checkpointHash:encodeE2eeBytes(new Uint8Array(32).fill(27)),securityEpoch:3,operationId:'fixture-op',payload:{domain:'workspace',after:'',limit:10}};
const fixture={warning:'PUBLIC SYNTHETIC FIXTURE; NEVER USE FOR USER DATA',origin:'WebCrypto + @hpke/core 1.10.1',
  secret:encodeE2eeBytes(authority.secret),recoveryKit:authority.kit,device:await exportPrivateDeviceKeys(device),
  root:encodeE2eeBytes(root),rootContext:context,rootCapsule:capsule,plaintext:encodeE2eeBytes(plaintext),bundle,
  signedCommand:await signE2eeCommand(command,device.signing.privateKey),commandBytes:encodeE2eeBytes(commandBytes(command)),commandHash:await e2eeCommandHash(command)};
const authorityCapsule=await sealRoot(root,authority.kit.authority.receivingKey,{...context,recipientId:'recovery'});
const base={protocol:1,ownerId,scopeId:context.scopeId,deviceId:'fixture-device',action:'bootstrap',expectedRevision:0,checkpointHash:'genesis',securityEpoch:1,operationId:'fixture-bootstrap',
  payload:{kind:'personal',resourceId:ownerId,keyId:context.keyId,generation:1,recoveryKit:authority.kit,recoveryCapsule:authorityCapsule,deviceKeys:await publicDeviceKeys(device),deviceCapsule:capsule}};
base.payload.selfProof=(await signE2eeCommand(base,device.signing.privateKey)).signature;
const events=[await signE2eeCommand(base,authority.keys.signing.privateKey)];
let verified=await verifyDeviceDirectory(ownerId,context.scopeId,authority.kit.authority,events);
const event=async(action,payload)=>{
  events.push(await signE2eeCommand({protocol:1,ownerId,scopeId:context.scopeId,deviceId:'fixture-device',action,
    expectedRevision:verified.checkpoint.revision,checkpointHash:verified.checkpoint.hash,securityEpoch:verified.securityEpoch,operationId:crypto.randomUUID(),payload},device.signing.privateKey));
  verified=await verifyDeviceDirectory(ownerId,context.scopeId,authority.kit.authority,events,verified.checkpoint);
};
await event('migration-commit',{migrationId:'fixture-migration',fence:1,manifestHash:await objectManifestHash([]),objectCount:0,verifiedCheckpoint:encodeE2eeBytes(new Uint8Array(32).fill(4)),generation:1});
const secondDevice=await generateDeviceKeys(),secondPublic=await publicDeviceKeys(secondDevice);
const challenge={id:'fixture-challenge',scopeId:context.scopeId,userId:ownerId,role:'owner',sessionHash:'a'.repeat(64),deviceId:'fixture-second',
  ...secondPublic,nonce:'b'.repeat(64),expiresAt:2000000000};
const prefix=new TextEncoder().encode('GENESIS-E2EE-ENROLLMENT\0v1\0'),body=canonicalE2eeValue(challenge),proofBytes=new Uint8Array(prefix.length+body.length);proofBytes.set(prefix);proofBytes.set(body,prefix.length);
const selfProof=encodeE2eeBytes(new Uint8Array(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},secondDevice.signing.privateKey,proofBytes)));
await event('enroll',{challenge,capsule:await sealRoot(root,secondPublic.receivingKey,{...context,recipientId:'fixture-second'}),historyCapsules:[],selfProof});
const newRoot=freshSecret(),newContext={...context,cryptoEpoch:2,keyId:'fresh-key-two'};
const fileContext={cryptoProtocol:1,suite:E2EE_SUITE,ownerId,scopeId:context.scopeId,domain:'attachment',objectId:'interop-file',schemaVersion:1,dataGeneration:1,
  writerProtocol:9,cryptoEpoch:1,securityEpoch:1,revision:1,keyId:context.keyId,deviceId:'fixture-device',operationId:'interop-file-op'};
fixture.file=await sealE2eeFile(await importE2eeRoot(root),device.signing.privateKey,fileContext,plaintext,{filename:'Синтетическое имя.txt',mediaType:'text/plain'});
fixture.retiredHeads=await Promise.all([...fixture.file.chunks,fixture.file.manifest].map(async envelope=>({domain:envelope.context.domain,objectId:envelope.context.objectId,
  revision:envelope.context.revision,payloadHash:await envelopePayloadHash(envelope)})));
await event('rotate',{revokedDeviceIds:['fixture-device'],cryptoEpoch:2,securityEpoch:2,keyId:'fresh-key-two',retiredManifestHash:await objectManifestHash(fixture.retiredHeads),retiredObjectCount:fixture.retiredHeads.length,capsules:[{deviceId:'fixture-second',
  capsule:await sealRoot(newRoot,secondPublic.receivingKey,{...newContext,recipientId:'fixture-second'})}],recoveryCapsule:await sealRoot(newRoot,authority.kit.authority.receivingKey,{...newContext,recipientId:'recovery'})});
fixture.directory={events,checkpoint:verified.checkpoint};fixture.secondDevice=await exportPrivateDeviceKeys(secondDevice);fixture.newRoot=encodeE2eeBytes(newRoot);
writeFileSync(new URL('../../tests/fixtures/e2ee/v1-runtime.json',import.meta.url),JSON.stringify(fixture,null,2)+'\n');
authority.secret.fill(0);root.fill(0);
console.log('Wrote public synthetic HPKE/recovery/command interoperability fixture');
