import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {sealE2eeFileStream,openE2eeFile,openE2eeFileStream,E2EE_CHUNK_BYTES} from '../app/e2ee/files.ts';
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
async function readFixture(size=E2EE_CHUNK_BYTES*2+37){
 const f=await fixture();f.options.size=size;f.options.source=(async function*(){let at=0;const buffer=new Uint8Array(65536);
  try{while(at<size){const count=Math.min(buffer.length,size-at);for(let index=0;index<count;index++)buffer[index]=((at+index)*31)&255;yield buffer.subarray(0,count);at+=count;}}
  finally{buffer.fill(0);}
 })();
 const manifest=await sealE2eeFileStream(f.options);
 return{...f,manifest,read:{root:f.options.root,signer:f.signer,expectedContext:structuredClone(f.options.context),manifestEnvelope:structuredClone(manifest),
  fetchChunk:async id=>f.chunks.get(id),assertCurrent:f.options.assertCurrent,writeQuarantinedPlaintext:async()=>{}}};
}

test('the v1 streaming reader authenticates every original byte with bounded borrowed buffers and returns metadata only after completion',async()=>{
 const f=await readFixture();let at=0;const borrowed=[];
 f.read.writeQuarantinedPlaintext=async chunk=>{assert.ok(chunk.length<=E2EE_CHUNK_BYTES);assert.ok(borrowed.every(value=>value.every(byte=>byte===0)));
  for(let index=0;index<chunk.length;index++)assert.equal(chunk[index],((at+index)*31)&255);at+=chunk.length;borrowed.push(chunk);await Promise.resolve();};
 const result=await openE2eeFileStream(f.read);assert.equal(at,f.options.size);assert.equal(borrowed.length,3);assert.ok(borrowed.every(value=>value.every(byte=>byte===0)));
 assert.deepEqual(result,{size:f.options.size,filename:f.options.metadata.filename,mediaType:f.options.metadata.mediaType});assert.ok(Object.isFrozen(result));
});
test('a later missing/tampered chunk or quarantine refusal yields no complete metadata and wipes every borrowed prefix',async()=>{
 for(const mode of ['missing','tamper','space']){
  const f=await readFixture(),borrowed=[];let fetches=0,result;
  f.read.fetchChunk=async id=>{fetches++;const chunk=f.chunks.get(id);if(fetches===2&&mode==='missing')throw new Error('SYNTHETIC_CHUNK_MISSING');
   if(fetches===2&&mode==='tamper')return{...chunk,ciphertext:(chunk.ciphertext[0]==='A'?'B':'A')+chunk.ciphertext.slice(1)};return chunk;};
  f.read.writeQuarantinedPlaintext=async chunk=>{borrowed.push(chunk);if(mode==='space')throw new Error('SYNTHETIC_NO_SPACE');};
  await assert.rejects(async()=>{result=await openE2eeFileStream(f.read);},mode==='missing'?/CHUNK_MISSING/:mode==='space'?/NO_SPACE/:/CORRUPT_FILE/);
  assert.equal(result,undefined);assert.ok(fetches<=2);assert.ok(borrowed.length>=1);assert.ok(borrowed.every(value=>value.every(byte=>byte===0)));
 }
});
test('reader actor checks surround fetch and quarantine awaits, and retirement grants no whole-file receipt',async()=>{
 for(const mode of ['before','fetch','sink']){
  const f=await readFixture(),borrowed=[];let fetches=0;if(mode==='before')f.retire();
  f.read.fetchChunk=async id=>{fetches++;if(mode==='fetch')f.retire();return f.chunks.get(id);};
  f.read.writeQuarantinedPlaintext=async chunk=>{borrowed.push(chunk);if(mode==='sink')f.retire();await Promise.resolve();};
  await assert.rejects(openE2eeFileStream(f.read),/ACCOUNT_CHANGED/);assert.equal(fetches,mode==='before'?0:1);assert.equal(borrowed.length,mode==='sink'?1:0);
  assert.ok(borrowed.every(value=>value.every(byte=>byte===0)));
 }
});
test('stream reader context, manifest and callbacks are captured before crypto awaits',async()=>{
 const f=await readFixture(3);let received=0;f.read.writeQuarantinedPlaintext=async chunk=>{received+=chunk.length;};
 const pending=openE2eeFileStream(f.read);f.read.expectedContext.ownerId='different-owner';f.read.manifestEnvelope.context.scopeId='different-scope';f.read.manifestEnvelope.nonce='invalid';
 f.read.fetchChunk=async()=>assert.fail('replaced fetch');f.read.assertCurrent=()=>{throw new Error('REPLACED_GUARD');};f.read.writeQuarantinedPlaintext=async()=>assert.fail('replaced quarantine');
 const result=await pending;assert.equal(received,3);assert.equal(result.filename,f.options.metadata.filename);
});
test('zero-byte v1 streaming read authenticates the manifest and has no implicit chunk or sink output',async()=>{
 const f=await readFixture(0);f.read.fetchChunk=async()=>assert.fail('implicit empty chunk');f.read.writeQuarantinedPlaintext=async()=>assert.fail('implicit empty output');
 assert.equal((await openE2eeFileStream(f.read)).size,0);
});
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
