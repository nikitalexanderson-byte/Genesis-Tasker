import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {recoverScopeRoot} from '../app/e2ee/scope-setup.ts';
import {verifyDeviceDirectory} from '../app/e2ee/directory.ts';
import {recoverAuthority,openRoot,importDeviceKeys} from '../app/e2ee/keys.ts';
import {decodeE2eeBytes,sealE2eeEnvelope,openE2eeEnvelope} from '../app/e2ee/envelope.ts';

test('scope recovery retains the exact independently supplied kit and directory through caller cleanup',async()=>{
 const fixture=JSON.parse(readFileSync(new URL('./fixtures/e2ee/v1-runtime.json',import.meta.url),'utf8'));
 const secret=decodeE2eeBytes(fixture.secret,32),kit=structuredClone(fixture.recoveryKit);
 const directory=await verifyDeviceDirectory(kit.ownerId,fixture.rootContext.scopeId,kit.authority,fixture.directory.events);
 const authority=await recoverAuthority(kit.ownerId,secret,kit),binding={ownerId:directory.ownerId,scopeId:directory.scopeId,cryptoEpoch:directory.cryptoEpoch,keyId:directory.keyId,recipientId:'recovery'};
 const expected=await openRoot(directory.recoveryCapsule,authority.receiving.privateKey,binding),signer=await importDeviceKeys(fixture.device);
 const context={...fixture.file.manifest.context,ownerId:directory.ownerId,scopeId:directory.scopeId,cryptoEpoch:directory.cryptoEpoch,securityEpoch:directory.securityEpoch,keyId:directory.keyId};
 const plain=new TextEncoder().encode('SYNTHETIC RECOVERY INPUT SNAPSHOT'),sealed=await sealE2eeEnvelope(expected,signer.signing.privateKey,context,plain);
 const pending=recoverScopeRoot(directory,secret,kit,()=>{});
 secret.fill(0);kit.authority.signingKey='invalid';kit.protectedKeys.ciphertext='invalid';directory.scopeId='different-scope';directory.recoveryCapsule.ciphertext='invalid';
 const actual=await pending,opened=await openE2eeEnvelope(actual,signer.signing.publicKey,context,sealed);
 try{assert.deepEqual(opened,plain);assert.equal(actual.extractable,false);}finally{opened.fill(0);plain.fill(0);}
});
