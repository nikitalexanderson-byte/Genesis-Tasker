import assert from 'node:assert/strict';
import test from 'node:test';
import { backupJson, newBackupRecoveryKey, sealBackup, openBackup } from '../app/backup-format.ts';
import { backupDriveAdapter, DRIVE_BACKUP_ENABLED } from '../app/backup-drive.ts';
import { captureBackupSources, registerBackupSource } from '../app/backup-sources.ts';
const owner='00000000-0000-4000-8000-000000000001';
const payload=()=>({schema:1,backupId:crypto.randomUUID(),source:'device_snapshot',ownerId:owner,createdAt:new Date().toISOString(),client:'web',billingEvidence:null,
  sections:[{id:'workspace',source:'device',capturedAt:new Date().toISOString(),count:1,pending:1,revision:4,completeness:'partial',notices:['DEVICE_CACHE_ONLY'],data:{tasks:[{id:'a',title:'Private task'}],pending:[{operationId:'save-1',kind:'task',data:{id:'a'}}]}}]});
test('portable user-key round trip, fresh DEK/nonce, private metadata only inside encryption',async()=>{
  const value=payload(),key=newBackupRecoveryKey(),first=await sealBackup(value,key),second=await sealBackup(value,key);
  assert.deepEqual(await openBackup(first,key),value);assert.notEqual(first,second);
  assert.notEqual(JSON.parse(first).wrappedKey,JSON.parse(second).wrappedKey);
  for(const secret of [owner,'Private task','operationId','device_snapshot'])assert.equal(first.includes(secret),false);
  assert.equal(value.billingEvidence,null);
});
test('ciphertext, header, wrapped DEK, digest, key and future schema tampering fail closed',async()=>{
  const key=newBackupRecoveryKey(),file=JSON.parse(await sealBackup(payload(),key));
  for(const patch of [{backupId:crypto.randomUUID()},{wrappedKey:newBackupRecoveryKey()},{sha256:'0'.repeat(64)},{iv:'AAAAAAAAAAAAAAAA'},{ciphertext:file.ciphertext.slice(0,-4)+'AAAA'},{schema:2},{kid:'attacker'}]){
    await assert.rejects(openBackup(JSON.stringify({...file,...patch}),key));
  }
  await assert.rejects(openBackup(JSON.stringify(file),newBackupRecoveryKey()));
});
test('limits reject nesting, prototype keys, duplicate sections, unknown sections, financial/auth claims',async()=>{
  assert.throws(()=>backupJson('['.repeat(42)+'0'+']'.repeat(42)),/BACKUP_LIMIT/);
  assert.throws(()=>backupJson('{"__proto__":{"admin":true}}'));
  assert.throws(()=>backupJson('"'+ 'x'.repeat(100)+'"',50),/BACKUP_TOO_LARGE/);
  for(const transform of [value=>({...value,plan:'premium4life'}),value=>({...value,billingEvidence:{plan:'business'}}),value=>({...value,sections:[...value.sections,...value.sections]}),value=>({...value,sections:[{...value.sections[0],id:'identities'}]})]){
    await assert.rejects(sealBackup(transform(payload()),newBackupRecoveryKey()));
  }
});
test('synchronous snapshot isolates owner, freezes pending data, and unregisters exact source',()=>{
  const data={tasks:[{id:'a'}],pending:[{operationId:'pending-1'}]};
  const cleanup=registerBackupSource('workspace',{owner,capture:()=>data});
  const captured=captureBackupSources(owner);data.tasks.length=0;
  assert.equal(captured.workspace.tasks.length,1);assert.deepEqual(captureBackupSources('other'),{});
  cleanup();assert.deepEqual(captureBackupSources(owner),{});
});
test('Drive remains disabled and performs no upload; disconnect does not delete files',async()=>{
  assert.equal(DRIVE_BACKUP_ENABLED,false);
  const adapter=backupDriveAdapter();await assert.rejects(adapter.upload({operationId:'a',ciphertext:'opaque',sha256:'a'}),/DRIVE_BACKUP_NOT_APPROVED/);await adapter.disconnect();
});
