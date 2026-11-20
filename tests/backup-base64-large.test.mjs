import assert from 'node:assert/strict';
import test from 'node:test';
import {backupBytes,BACKUP_MAX_PLAIN} from '../app/backup-format.ts';

test('canonical Base64 at the supported plaintext limit has no regexp stack or re-encoding limit',()=>{
 const raw=Buffer.alloc(BACKUP_MAX_PLAIN+16,173),encoded=raw.toString('base64');
 assert.deepEqual(backupBytes(encoded,BACKUP_MAX_PLAIN+16),new Uint8Array(raw));
 assert.throws(()=>backupBytes(encoded,BACKUP_MAX_PLAIN),/BACKUP_INVALID/);
});

test('linear validation preserves exact canonical padding, unused bits, alphabet and empty input',()=>{
 for(const raw of [Buffer.alloc(0),Buffer.from([0]),Buffer.from([0,255]),Buffer.from([255,254,253]),Buffer.from([0,1,2,3])])
  assert.deepEqual(backupBytes(raw.toString('base64')),new Uint8Array(raw));
 for(const text of ['A','AAA','A===','====','AA=A','AA==AA==','AB==','AAB=','AAA\n','AAAA ','AAAA_===','AA-=', 'ＡＡ=='])
  assert.throws(()=>backupBytes(text),/BACKUP_INVALID/);
});

test('all final Base64 symbols agree with the independent Node canonical roundtrip',()=>{
 const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
 for(const final of alphabet)for(const candidate of [`A${final}==`,`AA${final}=`,`AAA${final}`]){
  const decoded=Buffer.from(candidate,'base64'),canonical=decoded.toString('base64')===candidate;
  if(canonical)assert.deepEqual(backupBytes(candidate),new Uint8Array(decoded),candidate);
  else assert.throws(()=>backupBytes(candidate),/BACKUP_INVALID/,candidate);
 }
});
