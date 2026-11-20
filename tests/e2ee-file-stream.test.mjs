import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {sealE2eeFileStream,openE2eeFile,E2EE_CHUNK_BYTES} from '../app/e2ee/files.ts';
import {decodeE2eeBytes,importE2eeRoot} from '../app/e2ee/envelope.ts';
const vector=JSON.parse(readFileSync(new URL('./fixtures/e2ee/v1.json',import.meta.url),'utf8'));
async function fixture(){
 const root=await importE2eeRoot(decodeE2eeBytes(vector.rootKey,32));
 const signingKey=await crypto.subtle.importKey('pkcs8',decodeE2eeBytes(vector.privateKeyPkcs8,1,8192),{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
 const signer=await crypto.subtle.importKey('spki',decodeE2eeBytes(vector.publicKeySpki,1,8192),{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
 const chunks=new Map();let live=true;
 const options={root,signingKey,context:structuredClone(vector.envelope.context),size:0,source:(async function*(){})(),metadata:{filename:'original\ud800😀.bin',mediaType:'application/octet-stream'},
  assertCurrent:()=>{if(!live)throw new Error('E2EE_ACCOUNT_CHANGED');},writeQuarantinedChunk:async chunk=>{assert.ok(Object.isFrozen(chunk)&&Object.isFrozen(chunk.context));chunks.set(chunk.context.objectId,chunk);}};
 return{options,chunks,signer,retire:()=>{live=false;}};
}
test('bounded chunks coalesce into unchanged v1 manifests and the existing reader opens every original byte',async()=>{
 const f=await fixture(),input=new Uint8Array(E2EE_CHUNK_BYTES*2+37);for(let index=0;index<input.length;index++)input[index]=(index*31)&255;
 f.options.size=input.length;f.options.source=(async function*(){for(let at=0;at<input.length;at+=8179)yield input.subarray(at,at+8179);})();
 const manifest=await sealE2eeFileStream(f.options);assert.equal(f.chunks.size,3);const opened=await openE2eeFile(f.options.root,f.signer,f.options.context,manifest,async id=>f.chunks.get(id));
 assert.deepEqual(opened.bytes,input);assert.equal(opened.filename,f.options.metadata.filename);assert.equal(opened.mediaType,f.options.metadata.mediaType);opened.bytes.fill(0);input.fill(0);
});
test('empty files still require actual source EOF and have an authenticated manifest with no missing chunk',async()=>{
 const f=await fixture();let reads=0;f.options.source={ [Symbol.asyncIterator](){return{async next(){reads++;return{done:true};}};}};
 const manifest=await sealE2eeFileStream(f.options),opened=await openE2eeFile(f.options.root,f.signer,f.options.context,manifest,async()=>assert.fail('No empty chunk'));
 assert.equal(reads,1);assert.equal(f.chunks.size,0);assert.equal(opened.bytes.length,0);
});
test('the declared last byte cannot bypass a source final-tag error or turn a prefix into a manifest',async()=>{
 const f=await fixture();let closed=false;f.options.size=E2EE_CHUNK_BYTES;
 f.options.source=(async function*(){try{yield new Uint8Array(E2EE_CHUNK_BYTES).fill(17);throw new Error('SYNTHETIC_FINAL_TAG_FAILURE');}finally{closed=true;}})();
 await assert.rejects(sealE2eeFileStream(f.options),/FINAL_TAG_FAILURE/);assert.equal(f.chunks.size,1);assert.equal(closed,true);
});
test('truncation, excess input, invalid chunks and no-space leave only inert ciphertext with no manifest',async()=>{
 for(const mode of ['short','long','invalid','space']){
  const f=await fixture();f.options.size=E2EE_CHUNK_BYTES+1;
  f.options.source=(async function*(){yield new Uint8Array(E2EE_CHUNK_BYTES).fill(19);if(mode==='long')yield Uint8Array.of(1,2);else if(mode==='invalid')yield new Uint8Array(0);else if(mode==='space')yield Uint8Array.of(1);})();
  if(mode==='space')f.options.writeQuarantinedChunk=async()=>{throw new Error('SYNTHETIC_DISK_FULL');};
  await assert.rejects(sealE2eeFileStream(f.options),mode==='space'?/DISK_FULL/:/INVALID_FILE_STREAM/);
  assert.ok(f.chunks.size<=1);
 }
});
test('actor retirement while local persistence is pending closes and wipes a borrowed source without publishing a manifest',async()=>{
 const f=await fixture(),borrowed=new Uint8Array(E2EE_CHUNK_BYTES).fill(23);let closed=false;
 f.options.size=borrowed.length;f.options.source=(async function*(){try{yield borrowed;}finally{borrowed.fill(0);closed=true;}})();
 f.options.writeQuarantinedChunk=async()=>{f.retire();};await assert.rejects(sealE2eeFileStream(f.options),/ACCOUNT_CHANGED/);
 assert.equal(closed,true);assert.ok(borrowed.every(byte=>byte===0));
});
test('source iterator and root/metadata binding are captured before any crypto await',async()=>{
 const f=await fixture(),expected=structuredClone(f.options.context),originalName=f.options.metadata.filename;
 f.options.size=3;f.options.source=(async function*(){yield Uint8Array.of(1,2,3);})();
 const pending=sealE2eeFileStream(f.options);f.options.context.ownerId='changed-owner';f.options.metadata.filename='changed-name';f.options.size=0;
 const manifest=await pending,opened=await openE2eeFile(f.options.root,f.signer,expected,manifest,async id=>f.chunks.get(id));
 assert.equal(opened.filename,originalName);assert.deepEqual(opened.bytes,Uint8Array.of(1,2,3));opened.bytes.fill(0);
});
