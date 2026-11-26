import assert from 'node:assert/strict';
import test from 'node:test';
import {openOriginalLegacySnapshot} from '../app/e2ee/original-source.ts';
import {UnlockedE2eeVault} from '../app/e2ee/storage.ts';
import {freshSecret,generateDeviceKeys,protectBundle,openBundle} from '../app/e2ee/keys.ts';
import {encodeE2eeBytes,importE2eeRoot} from '../app/e2ee/envelope.ts';
import {E2EE_CHUNK_BYTES} from '../app/e2ee/files.ts';
import {requiredPrivatePaths} from '../app/e2ee/migration-sources.ts';
class Memory {
 rows=new Map();writes=0;reads=[];beforeGet;
 async get(key){this.reads.push(key);await this.beforeGet?.(key);return structuredClone(this.rows.get(key)??null);}
 async list(prefix){return [...this.rows.keys()].filter(key=>key.startsWith(prefix));}
 async commit(changes,signal){assert.ok(!signal?.aborted);for(const row of changes)assert.equal(this.rows.get(row.key)?.serial??null,row.expected);for(const row of changes)if(row.value===null)this.rows.delete(row.key);else this.rows.set(row.key,structuredClone(row.value));this.writes++;}
}
async function fixture(){
 const storage=new Memory(),keys=await generateDeviceKeys(),raw=freshSecret(),secret=freshSecret(),original={ownerId:'original-actor',scopeId:'device:original-legacy',deviceId:'original-device',generation:1,cryptoEpoch:1,securityEpoch:1};
 const saved=await protectBundle(original.ownerId,'synthetic-old-root-only',secret,raw),root=await importE2eeRoot(raw);raw.fill(0);
 const old=new UnlockedE2eeVault(storage,{...original,keyId:'old-local-root',signingKey:keys.signing.privateKey,roots:new Map([['old-local-root',root]]),trustedSigner:id=>id===original.deviceId?keys.signing.publicKey:undefined});
 const target={ownerId:'content-owner',scopeId:'project:original-legacy',kind:'project'},paths=requiredPrivatePaths('project').map(row=>row.id),values=paths.map((_,index)=>Uint8Array.from({length:index?3:E2EE_CHUNK_BYTES+7},(_,at)=>(at*31+index*17)&255));
 const wire=new TextEncoder().encode(JSON.stringify({protocol:1,ownerId:target.ownerId,scopeId:target.scopeId,paths:paths.map((id,index)=>({id,bytes:encodeE2eeBytes(values[index])}))})),migrationId=crypto.randomUUID();
 const reference={migrationId,snapshotSize:wire.length,snapshotParts:Math.ceil(wire.length/E2EE_CHUNK_BYTES),snapshotHash:encodeE2eeBytes(new Uint8Array(await crypto.subtle.digest('SHA-256',wire)))};
 for(let index=0;index<reference.snapshotParts;index++)await old.write([{domain:'local-snapshot',objectId:`${migrationId}:source:${index}`,value:wire.subarray(index*E2EE_CHUNK_BYTES,(index+1)*E2EE_CHUNK_BYTES),expected:null}]);wire.fill(0);old.lock();
 const recovered=await openBundle(original.ownerId,'synthetic-old-root-only',secret,saved);secret.fill(0);let recoveredRoot;try{recoveredRoot=await importE2eeRoot(recovered);}finally{recovered.fill(0);}
 const signer=await crypto.subtle.importKey('spki',await crypto.subtle.exportKey('spki',keys.signing.publicKey),{name:'ECDSA',namedCurve:'P-256'},false,['verify']);delete keys.signing.privateKey;
 const activeKeys=await generateDeviceKeys(),activeRaw=freshSecret(),activeRoot=await importE2eeRoot(activeRaw);activeRaw.fill(0);
 const active=new UnlockedE2eeVault(storage,{ownerId:original.ownerId,scopeId:'device:new',deviceId:'new-device',generation:1,cryptoEpoch:1,securityEpoch:1,keyId:'new-local-root',signingKey:activeKeys.signing.privateKey,roots:new Map([['new-local-root',activeRoot]]),trustedSigner:id=>id==='new-device'?activeKeys.signing.publicKey:undefined});
 let live=true;const options={storage,original:{...original},roots:new Map([['old-local-root',recoveredRoot]]),signer,target:{...target},paths:[...paths],reference:{...reference},assertCurrent:()=>{if(!live)throw new Error('E2EE_ACCOUNT_CHANGED');}};
 return{storage,original,target,paths,values,reference,active,options,retire:()=>{live=false;}};
}
async function consume(reader,expected){let at=0,previous;for await(const bytes of reader.chunks){if(previous)assert.ok(previous.every(value=>value===0));assert.deepEqual(bytes,expected.subarray(at,at+bytes.length));at+=bytes.length;previous=bytes;}reader.assertComplete();assert.equal(at,expected.length);assert.ok(previous.every(value=>value===0));}
test('old snapshot opens with independent roots and public signer while the new active device stays unchanged',async()=>{
 const f=await fixture(),before=structuredClone(f.storage.rows),writes=f.storage.writes,identity=f.active.localIdentity(),handle=await openOriginalLegacySnapshot(f.options);
 assert.deepEqual(Object.keys(handle).sort(),['close','openPath','paths','reference']);assert.ok(Object.isFrozen(handle)&&Object.isFrozen(handle.reference));assert.deepEqual(handle.reference,f.reference);
 for(const[index,path]of f.paths.entries())await consume(handle.openPath(path),f.values[index]);assert.equal(f.storage.writes,writes);assert.deepEqual(f.storage.rows,before);assert.deepEqual(f.active.localIdentity(),identity);
 for(const name of ['write','storage','keys','signer','roots','restore'])assert.equal(handle[name],undefined);handle.close();assert.throws(()=>handle.openPath(f.paths[0]),/E2EE_.*CLOSED/);f.active.lock();
});
test('foreign actor scope generation epochs roots signer target or original digest never become empty recovery',async()=>{
 const f=await fixture(),other=await generateDeviceKeys(),raw=freshSecret(),root=await importE2eeRoot(raw);raw.fill(0);
 const changes=[{original:{...f.original,ownerId:'foreign'}},{original:{...f.original,scopeId:'device:foreign'}},{original:{...f.original,deviceId:'new-device'}},{original:{...f.original,generation:2}},{original:{...f.original,cryptoEpoch:0}},
  {roots:new Map([['old-local-root',root]])},{roots:new Map()},{signer:other.signing.publicKey},{signer:other.signing.privateKey},{target:{...f.target,scopeId:'project:foreign'}},{reference:{...f.reference,snapshotHash:'A'.repeat(43)}}];
 for(const changed of changes)await assert.rejects(openOriginalLegacySnapshot({...f.options,...changed}),/E2EE_/);
});
test('original reference and actor key map callbacks and required paths are captured before IO',async()=>{
 const f=await fixture(),pending=openOriginalLegacySnapshot(f.options);f.options.original.ownerId='changed';f.options.target.scopeId='project:changed';f.options.reference.migrationId='changed';f.options.paths.length=0;f.options.roots.clear();f.options.assertCurrent=()=>{throw new Error('REPLACED_GUARD');};
 const handle=await pending;await consume(handle.openPath(f.paths[0]),f.values[0]);handle.close();
});
test('oversized incomplete aliased and source-stage references refuse before any original body lookup',async()=>{
 const f=await fixture();for(const reference of [{...f.reference,snapshotParts:1e12},{...f.reference,snapshotSize:0},{...f.reference,extra:true},{stageId:crypto.randomUUID(),manifestHash:'A'.repeat(43)}]){
  const count=f.storage.reads.length;await assert.rejects(openOriginalLegacySnapshot({...f.options,reference}),/E2EE_/);assert.equal(f.storage.reads.length,count);
 }
 const count=f.storage.reads.length;await assert.rejects(openOriginalLegacySnapshot({...f.options,paths:f.paths.slice(1)}),/E2EE_/);assert.equal(f.storage.reads.length,count);
});
test('close and original actor retirement revoke pending reads and wipe already borrowed plaintext',async()=>{
 for(const mode of ['close','actor']){const f=await fixture(),handle=await openOriginalLegacySnapshot(f.options),first=handle.openPath(f.paths[0]),borrowed=await first.chunks.next();assert.ok(!borrowed.done);await first.chunks.return();assert.ok(borrowed.value.every(value=>value===0));
  let arrived,release;const entered=new Promise(resolve=>{arrived=resolve;}),gate=new Promise(resolve=>{release=resolve;});f.storage.beforeGet=async()=>{arrived();await gate;};const reader=handle.openPath(f.paths[1]),pending=reader.chunks.next();await entered;if(mode==='close')handle.close();else f.retire();release();await assert.rejects(pending,/E2EE_/);handle.close();
 }
});
test('a missing or unexpected physical original is explicit refusal with every retained row left intact',async()=>{
 const f=await fixture(),key=[...f.storage.rows.keys()][0];f.storage.rows.delete(key);const before=structuredClone(f.storage.rows);await assert.rejects(openOriginalLegacySnapshot(f.options),/E2EE_/);assert.deepEqual(f.storage.rows,before);
});
