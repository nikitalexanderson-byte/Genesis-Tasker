import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {parseE2eeFileManifestJson} from '../app/e2ee/file-manifest-json.ts';
import {openE2eeFile,E2EE_CHUNK_BYTES} from '../app/e2ee/files.ts';
import {decodeE2eeBytes,encodeE2eeBytes,importE2eeRoot,sealE2eeEnvelope} from '../app/e2ee/envelope.ts';
const vectors=JSON.parse(readFileSync(new URL('./fixtures/e2ee/file-manifest-json-v1.json',import.meta.url),'utf8'));
const fixture=JSON.parse(readFileSync(new URL('./fixtures/e2ee/v1.json',import.meta.url),'utf8')),utf8=new TextEncoder();
test('strict private manifest syntax preserves units and refuses platform leniency and decoded duplicate names',()=>{
 for(const row of vectors.valid)assert.deepEqual(parseE2eeFileManifestJson(utf8.encode(row.text)),JSON.parse(row.text),row.name);
 for(const row of vectors.invalid)assert.throws(()=>parseE2eeFileManifestJson(row.hex?Buffer.from(row.hex,'hex'):utf8.encode(row.text)),/E2EE_CORRUPT_FILE/,row.name);
 assert.throws(()=>parseE2eeFileManifestJson(utf8.encode('{"x":'+ '['.repeat(17)+'0'+']'.repeat(17)+'}')),/E2EE_CORRUPT_FILE/);
 assert.throws(()=>parseE2eeFileManifestJson(new Uint8Array(256*1024+1).fill(32)),/E2EE_CORRUPT_FILE/);
 assert.throws(()=>parseE2eeFileManifestJson(utf8.encode('{"x":"'+'a'.repeat(513)+'"}')),/E2EE_CORRUPT_FILE/);
 assert.throws(()=>parseE2eeFileManifestJson(utf8.encode('{"x":'+'1'.repeat(33)+'}')),/E2EE_CORRUPT_FILE/);
});
test('the largest v1 descriptor set and512 original filename units fit the private syntax bounds',()=>{
 const filename='\ud800😀\ufeff'.repeat(128),hash=encodeE2eeBytes(new Uint8Array(32));assert.equal(filename.length,512);
 const manifest={protocol:1,fileKey:hash,size:64*1024*1024,chunkSize:E2EE_CHUNK_BYTES,filename,mediaType:'x'.repeat(128),
  chunks:Array.from({length:256},(_,index)=>({objectId:('id'+index).padEnd(128,'a'),operationId:('op'+index).padEnd(128,'b'),index,size:E2EE_CHUNK_BYTES,hash}))};
 const encoded=utf8.encode(JSON.stringify(manifest));assert.ok(encoded.length<256*1024);assert.deepEqual(parseE2eeFileManifestJson(encoded),manifest);
});
test('the entire authenticated descriptor set is validated before any chunk fetch, even when only a later row is malformed',async()=>{
 const root=await importE2eeRoot(decodeE2eeBytes(fixture.rootKey,32));
 const signing=await crypto.subtle.importKey('pkcs8',decodeE2eeBytes(fixture.privateKeyPkcs8,1,8192),{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
 const signer=await crypto.subtle.importKey('spki',decodeE2eeBytes(fixture.publicKeySpki,1,8192),{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
 const context=fixture.envelope.context,hash=encodeE2eeBytes(new Uint8Array(32));
 for(const mode of ['id-type','operation-type','hash','duplicate','index','size']){
  const manifest={protocol:1,fileKey:hash,size:E2EE_CHUNK_BYTES+1,chunkSize:E2EE_CHUNK_BYTES,filename:'private',mediaType:'application/octet-stream',chunks:[
   {objectId:'first-part',operationId:'first-operation',index:0,size:E2EE_CHUNK_BYTES,hash},
   {objectId:'second-part',operationId:'second-operation',index:1,size:1,hash}]};
  const bad=manifest.chunks[1];if(mode==='id-type')bad.objectId=42;else if(mode==='operation-type')bad.operationId=42;else if(mode==='hash')bad.hash='invalid';
  else if(mode==='duplicate')bad.objectId=manifest.chunks[0].objectId;else if(mode==='index')bad.index=0;else bad.size=2;
  const envelope=await sealE2eeEnvelope(root,signing,context,utf8.encode(JSON.stringify(manifest)));let calls=0;
  await assert.rejects(openE2eeFile(root,signer,context,envelope,async()=>{calls++;throw new Error('UNEXPECTED_PRIVATE_IO');}),/E2EE_CORRUPT_FILE/);assert.equal(calls,0,mode);
 }
});
