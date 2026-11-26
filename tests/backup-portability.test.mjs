import test from 'node:test';
import assert from 'node:assert/strict';
import {backupPortabilityVectors} from '../scripts/qa/backup-portability-vectors.mjs';
import {openBackup,sealBackup} from '../app/backup-format.ts';

test('canonical and historical Android escaped-solidus archives authenticate with identical semantic context',async()=>{
 const fixture=await backupPortabilityVectors();assert(fixture.files.canonical.wrappedKey.includes('/'));
 for(const file of Object.values(fixture.files))assert.deepEqual(await openBackup(JSON.stringify(file),fixture.recoveryKey),fixture.payload);
});
test('both historical AAD encodings still reject a changed authenticated header, wrapped key, tag or recovery key',async()=>{
 const fixture=await backupPortabilityVectors();
 for(const file of Object.values(fixture.files)){
  for(const changed of [{...file,backupId:crypto.randomUUID()},{...file,wrappedKey:fixture.files.canonical.iv+'A'.repeat(40)}])
   await assert.rejects(openBackup(JSON.stringify(changed),fixture.recoveryKey));
  await assert.rejects(openBackup(JSON.stringify(file),Buffer.alloc(32,255).toString('base64')),/BACKUP_RECOVERY_OR_INTEGRITY/);
  const raw=Buffer.from(file.ciphertext,'base64');raw[0]^=1;
  const changed={...file,ciphertext:raw.toString('base64'),sha256:Buffer.from(await crypto.subtle.digest('SHA-256',raw)).toString('hex')};
  await assert.rejects(openBackup(JSON.stringify(changed),fixture.recoveryKey),/BACKUP_RECOVERY_OR_INTEGRITY/);raw.fill(0);
 }
});
test('newly sealed archives continue using the canonical encoding',async()=>{
 const fixture=await backupPortabilityVectors(),text=await sealBackup(fixture.payload,fixture.recoveryKey),file=JSON.parse(text);
 assert.deepEqual(await openBackup(text,fixture.recoveryKey),fixture.payload);
 const secret=await crypto.subtle.importKey('raw',Buffer.from(fixture.recoveryKey,'base64'),'AES-KW',false,['unwrapKey']);
 const key=await crypto.subtle.unwrapKey('raw',Buffer.from(file.wrappedKey,'base64'),secret,'AES-KW',{name:'AES-GCM'},false,['decrypt']);
 const aad=JSON.stringify([file.format,file.schema,file.backupId,file.algorithm,file.wrappedKey]);
 const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:Buffer.from(file.iv,'base64'),additionalData:new TextEncoder().encode(aad)},key,Buffer.from(file.ciphertext,'base64'));
 assert.deepEqual(JSON.parse(new TextDecoder().decode(plain)),fixture.payload);new Uint8Array(plain).fill(0);
});
