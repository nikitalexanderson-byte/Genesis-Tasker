import assert from 'node:assert/strict';
import test from 'node:test';
import {openOriginalSourceStage} from '../app/e2ee/original-source.ts';
import {ProtectedSourceStage} from '../app/e2ee/source-stage.ts';
import {UnlockedE2eeVault} from '../app/e2ee/storage.ts';
import {freshSecret,generateDeviceKeys,protectBundle,openBundle} from '../app/e2ee/keys.ts';
import {importE2eeRoot} from '../app/e2ee/envelope.ts';
import {E2EE_CHUNK_BYTES} from '../app/e2ee/files.ts';

class Memory {
 rows=new Map();writes=0;beforeGet;
 async get(key){await this.beforeGet?.(key);return structuredClone(this.rows.get(key)??null);}
 async list(prefix){return [...this.rows.keys()].filter(key=>key.startsWith(prefix));}
 async commit(changes,signal){
  if(signal?.aborted)throw new Error('E2EE_UNLOCK_REQUIRED');for(const row of changes)assert.equal(this.rows.get(row.key)?.serial??null,row.expected);
  const next=new Map(this.rows);for(const row of changes)if(row.value===null)next.delete(row.key);else next.set(row.key,structuredClone(row.value));this.rows=next;this.writes++;
 }
}
async function fixture(){
 const storage=new Memory(),keys=await generateDeviceKeys(),raw=freshSecret(),secret=freshSecret(),original={ownerId:'original-actor',scopeId:'device:original',deviceId:'original-device',generation:1,cryptoEpoch:1,securityEpoch:1};
 // Synthetic independently protected root only. No old private signing key is
 // imported into the read capability or the separate new active device.
 const saved=await protectBundle(original.ownerId,'synthetic-original-source',secret,raw),root=await importE2eeRoot(raw);raw.fill(0);
 const old=new UnlockedE2eeVault(storage,{...original,keyId:'original-local-root',signingKey:keys.signing.privateKey,roots:new Map([['original-local-root',root]]),trustedSigner:id=>id===original.deviceId?keys.signing.publicKey:undefined});
 const target={ownerId:'project-content-owner',scopeId:'project:original-input',kind:'project'},paths=['project.content','project.local-work'];
 let live=true;const assertCurrent=()=>{if(!live)throw new Error('E2EE_ACCOUNT_CHANGED');};
 const stage=await ProtectedSourceStage.create({vault:old,target,paths,capacity:{maximumBytes:4*1024*1024,maximumParts:16},assertCurrent,ensureDurableKeys:async()=>{},admit:async()=>{}});
 const size=E2EE_CHUNK_BYTES*2+37,input=new Uint8Array(size);for(let index=0;index<size;index++)input[index]=(index*37)&255;
 for(const path of paths)await stage.capturePath(path,async write=>{for(let at=0;at<input.length;at+=65536)await write(input.subarray(at,at+65536));});
 const reference=await stage.finish();old.lock();
 const recovered=await openBundle(original.ownerId,'synthetic-original-source',secret,saved);secret.fill(0);
 let recoveredRoot;try{recoveredRoot=await importE2eeRoot(recovered);}finally{recovered.fill(0);}
 const spki=await crypto.subtle.exportKey('spki',keys.signing.publicKey),signer=await crypto.subtle.importKey('spki',spki,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
 const activeKeys=await generateDeviceKeys(),activeRaw=freshSecret(),activeRoot=await importE2eeRoot(activeRaw);activeRaw.fill(0);
 const active=new UnlockedE2eeVault(storage,{ownerId:original.ownerId,scopeId:'device:new',deviceId:'new-device',generation:1,cryptoEpoch:1,securityEpoch:1,keyId:'new-local-root',signingKey:activeKeys.signing.privateKey,roots:new Map([['new-local-root',activeRoot]]),trustedSigner:id=>id==='new-device'?activeKeys.signing.publicKey:undefined});
 const options={storage,original:{...original},roots:new Map([['original-local-root',recoveredRoot]]),signer,target:{...target},reference:{...reference},assertCurrent};
 return{storage,original,target,paths,reference,input,active,options,retire:()=>{live=false;}};
}
async function consume(reader,expected){let at=0,previous;for await(const bytes of reader.chunks){if(previous)assert.ok(previous.every(value=>value===0));assert.ok(bytes.length<=E2EE_CHUNK_BYTES);assert.deepEqual(bytes,expected.subarray(at,at+bytes.length));at+=bytes.length;previous=bytes;}reader.assertComplete();assert.equal(at,expected.length);assert.ok(previous.every(value=>value===0));}

test('original-stage recovery reads exact original-actor bytes with only imported roots and a public signer; the new device stays independent',async()=>{
 const f=await fixture(),writes=f.storage.writes,newIdentity=f.active.localIdentity(),handle=await openOriginalSourceStage(f.options);
 assert.deepEqual(handle.paths,f.paths);assert.deepEqual(Object.keys(handle).sort(),['close','openPath','paths']);assert.ok(Object.isFrozen(handle)&&Object.isFrozen(handle.paths));
 for(const path of handle.paths)await consume(handle.openPath(path),f.input);
 assert.equal(f.storage.writes,writes);assert.deepEqual(f.active.localIdentity(),newIdentity);assert.equal(handle.write,undefined);assert.equal(handle.keys,undefined);assert.equal(handle.storage,undefined);
 handle.close();assert.throws(()=>handle.openPath(f.paths[0]),/ORIGINAL_SOURCE_CLOSED/);f.input.fill(0);f.active.lock();
});
test('wrong original actor scope generation epochs root signer target and manifest never become an empty successful recovery',async()=>{
 const f=await fixture(),wrongKey=await generateDeviceKeys(),otherRaw=freshSecret(),otherRoot=await importE2eeRoot(otherRaw);otherRaw.fill(0);const writes=f.storage.writes;
 const variants=[{original:{...f.original,ownerId:'wrong-owner'}},{original:{...f.original,scopeId:'device:wrong'}},{original:{...f.original,deviceId:'new-device'}},
  {original:{...f.original,generation:2}},{original:{...f.original,cryptoEpoch:0}},{original:{...f.original,securityEpoch:0}},
  {roots:new Map([['original-local-root',otherRoot]])},{roots:new Map()}, {signer:wrongKey.signing.publicKey},{signer:wrongKey.signing.privateKey},
  {target:{...f.target,ownerId:'wrong-owner'}},{reference:{...f.reference,manifestHash:'A'.repeat(43)}}];
 for(const changed of variants)await assert.rejects(openOriginalSourceStage({...f.options,...changed}),/E2EE_/);
 assert.equal(f.storage.writes,writes);f.input.fill(0);
});
test('original identity key map callbacks and stage binding are captured before the first storage await',async()=>{
 const f=await fixture(),pending=openOriginalSourceStage(f.options);f.options.original.ownerId='changed-owner';f.options.target.scopeId='project:changed';f.options.reference.manifestHash='invalid';
 f.options.roots.clear();f.options.signer=(await generateDeviceKeys()).signing.publicKey;f.options.assertCurrent=()=>{throw new Error('REPLACED_GUARD');};
 const handle=await pending;await consume(handle.openPath(f.paths[0]),f.input);handle.close();f.input.fill(0);
});
test('closing a capability wipes its currently borrowed chunk and denies completion; duplicate path readers cannot grow the working set',async()=>{
 const f=await fixture(),handle=await openOriginalSourceStage(f.options),reader=handle.openPath(f.paths[0]);
 assert.throws(()=>handle.openPath(f.paths[0]),/ORIGINAL_SOURCE_PATH_BUSY/);const first=await reader.chunks.next();assert.equal(first.done,false);assert.ok(first.value.some(value=>value!==0));
 handle.close();assert.ok(first.value.every(value=>value===0));await assert.rejects(reader.chunks.next(),/ORIGINAL_SOURCE_CLOSED/);assert.throws(()=>reader.assertComplete(),/ORIGINAL_SOURCE_CLOSED/);f.input.fill(0);
});
test('close during an in-flight storage read and account retirement return no plaintext or complete-source receipt',async()=>{
 for(const mode of ['close','actor']){
  const f=await fixture(),handle=await openOriginalSourceStage(f.options);let release,reached;const hit=new Promise(resolve=>{reached=resolve;});
  f.storage.beforeGet=async key=>{if(key.includes(':p:00:00000')){reached();await new Promise(resolve=>{release=resolve;});}};
  const reader=handle.openPath(f.paths[0]),pending=reader.chunks.next();await hit;if(mode==='close')handle.close();else f.retire();release();
  await assert.rejects(pending,mode==='close'?/ORIGINAL_SOURCE_CLOSED/:/ACCOUNT_CHANGED/);assert.throws(()=>reader.assertComplete(),/E2EE_/);f.input.fill(0);
 }
});
