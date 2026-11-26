// PUBLIC SYNTHETIC LEGACY KEYS ONLY. Never use these fixtures for user data.
import {writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {createPhysisVault,accountPhysisVault,sealPhysis,openPhysis} from '../../app/physis/crypto.ts';

const ownerId='synthetic-legacy-physis-interop';
const base64=value=>Buffer.from(value).toString('base64');
const record=id=>({id,kind:'synthetic-unknown-private-record',schemaVersion:1,note:'Original ФЮЗИС 🌿 日本語',
 empty:'',zero:0,unknownPrivateField:{nullable:null,enabled:false},createdAt:'2026-11-19T00:00:00.000Z'});
const independent=[];
for(const [password,keyVersion]of [['Synthetic independent password only',7],['Секрет 🌿 \uD800 lone-high / \uDC00 lone-low',Number.MAX_SAFE_INTEGER]]){
 const created=await createPhysisVault(ownerId,password,keyVersion),id=crypto.randomUUID(),value=record(id);
 const envelope=await sealPhysis(created.key,ownerId,id,keyVersion,value);
 assert.deepEqual(await openPhysis(created.key,ownerId,id,keyVersion,envelope),value);
 independent.push({password,recovery:created.recovery,vault:created.vault,id,plaintext:JSON.stringify(value),envelope,
  recordKey:base64(await crypto.subtle.exportKey('raw',created.key))});
}
const oldRaw=crypto.getRandomValues(new Uint8Array(32)),oldKey=await crypto.subtle.importKey('raw',oldRaw,'AES-GCM',false,['encrypt']);
const accountAccess={async seal(value,purpose){
 const iv=crypto.getRandomValues(new Uint8Array(12)),cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,
  additionalData:new TextEncoder().encode(`genesis-mindmap-v1:${ownerId}:${purpose}`)},oldKey,new TextEncoder().encode(JSON.stringify(value)));
 return{iv:base64(iv),ciphertext:base64(cipher)};
}};
const created=await accountPhysisVault(accountAccess,3),id=crypto.randomUUID(),value=record(id);
const account={oldKey:base64(oldRaw),vault:created.vault,id,plaintext:JSON.stringify(value),
 envelope:await sealPhysis(created.key,ownerId,id,3,value),recordKey:base64(await crypto.subtle.exportKey('raw',created.key))};
const fixture={warning:'PUBLIC SYNTHETIC TEST KEYS; NEVER USE FOR USER DATA',
 origin:'Actual app/physis/crypto.ts with WebCrypto; PBKDF2-SHA256/600000; UTF-16 TextEncoder edge cases',ownerId,independent,account};
writeFileSync(new URL('../../tests/fixtures/e2ee/physis-legacy.json',import.meta.url),JSON.stringify(fixture,null,2)+'\n');
oldRaw.fill(0);
console.log('Wrote public synthetic legacy Physis WebCrypto interoperability fixture.');
