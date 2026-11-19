import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {physisModules,settingsRecord,clone} from './physis-test-loader.mjs';
import {calendarModule} from './helpers/calendar-modules.mjs';
const c=physisModules().crypto;
const {parseLegacyPhysisJson,validateLegacyPhysisVault,unlockLegacyPhysisSource,readLegacyPhysisRecord}=calendarModule('app/e2ee/physis-legacy.ts');
const owner='synthetic-physis-source-owner',password='Synthetic legacy password for migration only';
const current=()=>{};
const credential=(method,secret)=>({assertCurrent:current,independentUnlock:async()=>({method,secret})});
async function original(version=1){
 const created=await c.createPhysisVault(owner,password,version),record=settingsRecord({futurePrivateField:{note:'Exact private original 🌿',empty:''}});
 const envelope=await c.sealPhysis(created.key,owner,record.id,version,record);return{...created,record,envelope};
}
async function accountAccess(){
 const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);let writes=0;
 return{get writes(){return writes;},
  async seal(value,purpose){writes++;const iv=crypto.getRandomValues(new Uint8Array(12));const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(`genesis-mindmap-v1:${owner}:${purpose}`)},key,new TextEncoder().encode(JSON.stringify(value)));
   return{iv:Buffer.from(iv).toString('base64'),ciphertext:Buffer.from(cipher).toString('base64')};},
  async open(envelope,purpose){const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:Buffer.from(envelope.iv,'base64'),additionalData:new TextEncoder().encode(`genesis-mindmap-v1:${owner}:${purpose}`)},key,Buffer.from(envelope.ciphertext,'base64'));
   return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(plain));}};
}

test('independently locked Physis sources open only with the original password or recovery and retain exact private fields',async()=>{
 const f=await original(7),before=JSON.stringify({vault:f.vault,envelope:f.envelope});
 for(const [method,secret]of [['password',password],['recovery',f.recovery]]){
  const key=await unlockLegacyPhysisSource(owner,clone(f.vault),credential(method,secret));
  assert.equal(key.extractable,false);assert.deepEqual(key.usages,['decrypt']);
  assert.deepEqual(await readLegacyPhysisRecord(owner,f.record.id,7,key,clone(f.envelope),current),f.record);
 }
 assert.equal(JSON.stringify({vault:f.vault,envelope:f.envelope}),before);
});
test('account-v2 opening is read-only, bound to the original vault purpose and cannot normalize away data',async()=>{
 const access=await accountAccess(),f=await c.accountPhysisVault(access,3),record=settingsRecord();
 const envelope=await c.sealPhysis(f.key,owner,record.id,3,record),purposes=[];
 const vault=clone(f.vault),key=await unlockLegacyPhysisSource(owner,vault,{assertCurrent:current,accountOpen:async(packet,purpose)=>{
  purposes.push(purpose);vault.keyVersion=99;return access.open(packet,purpose);}});
 assert.deepEqual(purposes,['physis-vault:v2:3']);assert.equal(access.writes,1);
 assert.deepEqual(await readLegacyPhysisRecord(owner,record.id,3,key,envelope,current),record);
});
test('a missing, cancelled or wrong independent secret never falls back to the account key or an empty source',async()=>{
 const f=await original(),before=JSON.stringify(f.vault);let accountCalls=0;
 const accountOpen=async()=>{accountCalls++;throw new Error('Unexpected account fallback');};
 for(const independentUnlock of [undefined,async()=>null,async()=>({method:'password',secret:'A wrong synthetic password'})]){
  await assert.rejects(unlockLegacyPhysisSource(owner,f.vault,{assertCurrent:current,accountOpen,independentUnlock}),/E2EE_PHYSIS_UNLOCK_REQUIRED/);
 }
 assert.equal(accountCalls,0);assert.equal(JSON.stringify(f.vault),before);
});
test('noncanonical unused recovery bits refuse even when the old helper would decode the same key',async()=>{
 const f=await original(),alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
 const last=alphabet.indexOf(f.recovery.at(-1)),noncanonical=f.recovery.slice(0,-1)+alphabet[last|1];
 assert.notEqual(noncanonical,f.recovery);
 assert.deepEqual(Buffer.from(noncanonical.slice(5),'base64url'),Buffer.from(f.recovery.slice(5),'base64url'));
 await assert.rejects(unlockLegacyPhysisSource(owner,f.vault,credential('recovery',noncanonical)),/E2EE_PHYSIS_SOURCE_INVALID/);
 const key=await unlockLegacyPhysisSource(owner,f.vault,credential('recovery','\uFEFF '+f.recovery+'\u00A0'));
 assert.deepEqual(await readLegacyPhysisRecord(owner,f.record.id,1,key,f.envelope,current),f.record);
});
test('malformed and future vaults refuse before prompting for a password or performing a KDF',async()=>{
 const f=await original();let calls=0;
 for(const change of [v=>v.version=9,v=>v.password.iterations=1,v=>v.password.iterations=1e12,v=>v.password.salt='A'.repeat(100000),
  v=>v.recovery.iv='AA==',v=>v.keyVersion=0,v=>v.unknownPrivateMode=true]){
  const vault=clone(f.vault);change(vault);
  await assert.rejects(unlockLegacyPhysisSource(owner,vault,{assertCurrent:current,independentUnlock:async()=>{calls++;return{method:'password',secret:password};}}),/E2EE_/);
 }
 assert.equal(calls,0);
 assert.throws(()=>parseLegacyPhysisJson('{"version":1,"vers\\u0069on":2}'),/E2EE_/);
 assert.throws(()=>validateLegacyPhysisVault({...clone(f.vault),password:{...f.vault.password,iterations:'600000'}}),/E2EE_/);
});
test('owner, record ID, epoch, schema, nonce and ciphertext substitution never opens a retained record',async()=>{
 const f=await original(),key=await unlockLegacyPhysisSource(owner,f.vault,credential('recovery',f.recovery)),before=JSON.stringify(f.envelope);
 for(const [actor,id,version,envelope]of [
  ['foreign-owner',f.record.id,1,f.envelope],[owner,crypto.randomUUID(),1,f.envelope],[owner,f.record.id,2,f.envelope],
  [owner,f.record.id,1,{...f.envelope,schemaVersion:2}],[owner,f.record.id,1,{...f.envelope,version:2}],
 ])await assert.rejects(readLegacyPhysisRecord(actor,id,version,key,envelope,current),/E2EE_/);
 for(const field of ['iv','ciphertext']){const changed=clone(f.envelope),bytes=Buffer.from(changed[field],'base64');bytes[0]^=1;changed[field]=bytes.toString('base64');
  await assert.rejects(readLegacyPhysisRecord(owner,f.record.id,1,key,changed,current),/E2EE_LEGACY_PHYSIS_CORRUPT/);}
 assert.equal(JSON.stringify(f.envelope),before);assert.deepEqual(await readLegacyPhysisRecord(owner,f.record.id,1,key,f.envelope,current),f.record);
});
test('valid AEAD with duplicate decoded JSON names or invalid UTF-8 still refuses without truncating or projecting the original',async()=>{
 const f=await original(),key=await unlockLegacyPhysisSource(owner,f.vault,credential('recovery',f.recovery));
 for(const plain of [new TextEncoder().encode('{"note":"one","n\\u006fte":"two"}'),new Uint8Array([0xff,0xfe,0x7b,0x7d])]){
  const iv=crypto.getRandomValues(new Uint8Array(12)),cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:c.physisAad(owner,f.record.id,1,1)},f.key,plain);
  const envelope={version:1,schemaVersion:1,keyVersion:1,iv:Buffer.from(iv).toString('base64'),ciphertext:Buffer.from(cipher).toString('base64')};
  await assert.rejects(readLegacyPhysisRecord(owner,f.record.id,1,key,envelope,current),/E2EE_PHYSIS_SOURCE_INVALID/);
 }
});
test('the full legacy byte limit is readable and oversized/canonical-base64 claims refuse before decryption',async()=>{
 const f=await original(),key=await unlockLegacyPhysisSource(owner,f.vault,credential('recovery',f.recovery)),text='x'.repeat(c.MAX_PHYSIS_PLAINTEXT_BYTES-2);
 const envelope=await c.sealPhysis(f.key,owner,f.record.id,1,text);
 assert.equal(await readLegacyPhysisRecord(owner,f.record.id,1,key,envelope,current),text);
 for(const changed of [{...envelope,ciphertext:Buffer.alloc(256*1024+1).toString('base64')},{...envelope,iv:envelope.iv+'='}])
  await assert.rejects(readLegacyPhysisRecord(owner,f.record.id,1,key,changed,current),/E2EE_/);
});
test('late owner changes cancel unlock and plaintext return while preserving retained source bytes',async()=>{
 const f=await original();let live=true;
 await assert.rejects(unlockLegacyPhysisSource(owner,f.vault,{assertCurrent:()=>{if(!live)throw new Error('E2EE_ACCOUNT_CHANGED');},independentUnlock:async()=>{live=false;return{method:'recovery',secret:f.recovery};}}),/E2EE_ACCOUNT_CHANGED/);
 const key=await unlockLegacyPhysisSource(owner,f.vault,credential('recovery',f.recovery));let checks=0;const before=JSON.stringify(f.envelope);
 await assert.rejects(readLegacyPhysisRecord(owner,f.record.id,1,key,f.envelope,()=>{if(++checks>1)throw new Error('E2EE_ACCOUNT_CHANGED');}),/E2EE_ACCOUNT_CHANGED/);
 assert.equal(JSON.stringify(f.envelope),before);
});
test('credential-provider exceptions cannot echo a secret and owner cancellation still takes precedence',async()=>{
 const fixture=JSON.parse(readFileSync(new URL('./fixtures/e2ee/physis-legacy.json',import.meta.url),'utf8')),f=fixture.independent[0];
 await assert.rejects(unlockLegacyPhysisSource(fixture.ownerId,f.vault,{assertCurrent:current,independentUnlock:async()=>{
  throw new Error('Untrusted prompt error including '+f.password);
 }}),error=>error.message==='E2EE_PHYSIS_UNLOCK_REQUIRED'&&!error.message.includes(f.password));
 await assert.rejects(unlockLegacyPhysisSource(fixture.ownerId,f.vault,{assertCurrent:current,independentUnlock:async()=>{
  throw new Error('E2EE_PROMPT_CANCELLED');
 }}),/E2EE_PROMPT_CANCELLED/);
 let live=true;
 await assert.rejects(unlockLegacyPhysisSource(fixture.ownerId,f.vault,{assertCurrent:()=>{if(!live)throw new Error('E2EE_ACCOUNT_CHANGED');},independentUnlock:async()=>{
  live=false;throw new Error('Untrusted prompt error including '+f.password);
 }}),/E2EE_ACCOUNT_CHANGED/);
});
test('the published native interoperability fixture opens with the actual legacy WebCrypto reader including unpaired UTF-16 passwords',async()=>{
 const fixture=JSON.parse(readFileSync(new URL('./fixtures/e2ee/physis-legacy.json',import.meta.url),'utf8'));
 for(const f of fixture.independent)for(const [method,secret]of [['password',f.password],['recovery',f.recovery]]){
  const key=await unlockLegacyPhysisSource(fixture.ownerId,f.vault,credential(method,secret));
  assert.deepEqual(await readLegacyPhysisRecord(fixture.ownerId,f.id,f.vault.keyVersion,key,f.envelope,current),JSON.parse(f.plaintext));
 }
 const f=fixture.account,old=await crypto.subtle.importKey('raw',Buffer.from(f.oldKey,'base64'),'AES-GCM',false,['decrypt']);
 const key=await unlockLegacyPhysisSource(fixture.ownerId,f.vault,{assertCurrent:current,accountOpen:async(envelope,purpose)=>{
  const bytes=await crypto.subtle.decrypt({name:'AES-GCM',iv:Buffer.from(envelope.iv,'base64'),
   additionalData:new TextEncoder().encode(`genesis-mindmap-v1:${fixture.ownerId}:${purpose}`)},old,Buffer.from(envelope.ciphertext,'base64'));
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
 }});
 assert.deepEqual(await readLegacyPhysisRecord(fixture.ownerId,f.id,f.vault.keyVersion,key,f.envelope,current),JSON.parse(f.plaintext));
});
