import assert from 'node:assert/strict';
import test from 'node:test';
import {openLegacyMigrationSnapshot} from '../app/e2ee/legacy-snapshot-stream.ts';
import {UnlockedE2eeVault} from '../app/e2ee/storage.ts';
import {freshSecret,generateDeviceKeys} from '../app/e2ee/keys.ts';
import {encodeE2eeBytes,importE2eeRoot} from '../app/e2ee/envelope.ts';
import {E2EE_CHUNK_BYTES} from '../app/e2ee/files.ts';
import {requiredPrivatePaths} from '../app/e2ee/migration-sources.ts';

class Memory {
 rows=new Map();reads=0;hold;
 async get(key){this.reads++;await this.hold?.(key);return structuredClone(this.rows.get(key)??null);}
 async list(prefix){return [...this.rows.keys()].filter(key=>key.startsWith(prefix));}
 async commit(changes,signal){assert.ok(!signal?.aborted);for(const row of changes)assert.equal(this.rows.get(row.key)?.serial??null,row.expected);for(const row of changes)if(row.value===null)this.rows.delete(row.key);else this.rows.set(row.key,structuredClone(row.value));}
}
const digest=async bytes=>encodeE2eeBytes(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)));
async function fixture({size=3,wire,kind='project'}={}){
 const memory=new Memory(),keys=await generateDeviceKeys(),raw=freshSecret(),root=await importE2eeRoot(raw);raw.fill(0);let live=true;
 const vault=new UnlockedE2eeVault(memory,{ownerId:'legacy-actor',scopeId:'device:legacy-reader',deviceId:'legacy-device',generation:1,cryptoEpoch:1,securityEpoch:1,keyId:'local-root',signingKey:keys.signing.privateKey,roots:new Map([['local-root',root]]),trustedSigner:id=>id==='legacy-device'?keys.signing.publicKey:undefined});
 const target={ownerId:'content-owner',scopeId:kind+':legacy-reader',kind},paths=requiredPrivatePaths(kind).map(row=>row.id),values=paths.map((_,index)=>Uint8Array.from({length:index?3:size},(_,at)=>(at*31+index*17)&255));
 const wrapper={protocol:1,ownerId:target.ownerId,scopeId:target.scopeId,paths:paths.map((id,index)=>({id,bytes:encodeE2eeBytes(values[index])}))};
 const bytes=new TextEncoder().encode(wire?wire(wrapper):JSON.stringify(wrapper)),migrationId=crypto.randomUUID(),reference={migrationId,snapshotSize:bytes.length,snapshotParts:Math.ceil(bytes.length/E2EE_CHUNK_BYTES),snapshotHash:await digest(bytes)};
 for(let index=0;index<reference.snapshotParts;index++)await vault.write([{domain:'local-snapshot',objectId:`${migrationId}:source:${index}`,value:bytes.subarray(index*E2EE_CHUNK_BYTES,(index+1)*E2EE_CHUNK_BYTES),expected:null}]);
 const options={vault,target,paths,reference,assertCurrent:()=>{if(!live)throw new Error('E2EE_ACCOUNT_CHANGED');}};
 return{memory,vault,values,bytes,options,retire:()=>{live=false;},open:(changes={})=>openLegacyMigrationSnapshot({...options,...changes})};
}
async function collect(reader){const parts=[];for await(const part of reader.chunks){assert.ok(part.length<=E2EE_CHUNK_BYTES);parts.push(new Uint8Array(part));}reader.assertComplete();return new Uint8Array(Buffer.concat(parts));}

test('legacy path wrapper is authenticated with its original full hash and streamed without rewriting provenance',async()=>{
 const f=await fixture({size:1024*1024+7}),before=structuredClone(f.memory.rows),opened=await f.open();assert.deepEqual(opened.paths,f.options.paths);assert.deepEqual(opened.reference,f.options.reference);assert.ok(Object.isFrozen(opened)&&Object.isFrozen(opened.reference));
 for(const[index,path]of opened.paths.entries())assert.deepEqual(await collect(opened.openPath(path)),f.values[index]);opened.close();assert.deepEqual(f.memory.rows,before);
});
test('both historical serializer key orders and arbitrary existing path order preserve every original',async()=>{
 const f=await fixture({wire:value=>JSON.stringify({paths:value.paths.toReversed().map(row=>({bytes:row.bytes,id:row.id})),scopeId:value.scopeId,ownerId:value.ownerId,protocol:1})}),opened=await f.open();
 for(const[index,path]of opened.paths.entries())assert.deepEqual(await collect(opened.openPath(path)),f.values[index]);opened.close();
});
test('legacy JSON escapes crossing physical parts and a leading UTF8 BOM keep the exact original hash',async()=>{
 const f=await fixture({size:E2EE_CHUNK_BYTES+17,wire:value=>{let raw=JSON.stringify(value).replace('"protocol":1','"protocol":1.0');const at=E2EE_CHUNK_BYTES-5,code=raw.charCodeAt(at);assert.match(raw[at],/[A-Za-z0-9_-]/);raw=raw.slice(0,at)+'\\u'+code.toString(16).padStart(4,'0')+raw.slice(at+1);return '\ufeff'+raw;}}),opened=await f.open();
 assert.deepEqual(await collect(opened.openPath(opened.paths[0])),f.values[0]);assert.equal(opened.reference.snapshotHash,await digest(f.bytes));opened.close();
});
test('original digest wrong owner scope missing paths duplicates or unknown wrapper fields refuse handles',async()=>{
 for(const mode of ['owner','scope','missing','duplicate','extra','duplicate-key','escaped-duplicate']){
  const f=await fixture({wire:value=>{if(mode==='owner')value.ownerId='foreign';if(mode==='scope')value.scopeId='foreign';if(mode==='missing')value.paths.pop();if(mode==='duplicate')value.paths[1]=value.paths[0];if(mode==='extra')value.extra=true;
   const raw=JSON.stringify(value);return mode==='duplicate-key'?raw.replace('"protocol":1','"protocol":1,"protocol":1'):mode==='escaped-duplicate'?raw.replace('"protocol":1','"protocol":1,"\\u0070rotocol":1'):raw;}});
  await assert.rejects(f.open(),/E2EE_/);
 }
 const f=await fixture();await assert.rejects(f.open({reference:{...f.options.reference,snapshotHash:await digest(new Uint8Array([99]))}}),/E2EE_/);
});
test('canonical unpadded base64 and strict complete JSON refuse unused bits malformed tails and trailing input',async()=>{
 for(const invalid of ['AA=','AB','A','AA+_','AA/','AA\n']){const f=await fixture({wire:value=>{value.paths[0].bytes=invalid;return JSON.stringify(value);}});await assert.rejects(f.open(),/E2EE_/);}
 for(const tail of ['{}',',',' null']){const f=await fixture({wire:value=>JSON.stringify(value)+tail});await assert.rejects(f.open(),/E2EE_/);}
});
test('borrowed decoded bytes expire after advance close and failure and path reads cannot accumulate concurrently',async()=>{
 const f=await fixture({size:E2EE_CHUNK_BYTES+7}),opened=await f.open(),reader=opened.openPath(opened.paths[0]),first=await reader.chunks.next();assert.ok(!first.done&&first.value.some(value=>value));
 assert.throws(()=>opened.openPath(opened.paths[1]),/E2EE_.*BUSY/);const second=await reader.chunks.next();assert.ok(first.value.every(value=>value===0));assert.ok(!second.done);opened.close();assert.ok(second.value.every(value=>value===0));
 await assert.rejects(reader.chunks.next(),/E2EE_/);assert.throws(()=>reader.assertComplete(),/E2EE_/);
});
test('closing or retiring the original actor during a pending protected read cannot yield plaintext',async()=>{
 for(const mode of ['close','retire']){const f=await fixture(),opened=await f.open();let unblock,arrived;const gate=new Promise(resolve=>{unblock=resolve;}),entered=new Promise(resolve=>{arrived=resolve;});f.memory.hold=async()=>{arrived();await gate;};
 const reader=opened.openPath(opened.paths[0]),pending=reader.chunks.next();await entered;if(mode==='close')opened.close();else f.retire();unblock();await assert.rejects(pending,/E2EE_/);opened.close();}
});
test('capability close immediately wipes its retained protected raw wrapper buffer as well as decoded output',async()=>{
 const f=await fixture({size:E2EE_CHUNK_BYTES+7}),raw=[];
 const vault={assertUnlocked:()=>f.vault.assertUnlocked(),localIdentity:()=>f.vault.localIdentity(),listLocal:(...args)=>f.vault.listLocal(...args),async read(...args){const row=await f.vault.read(...args);if(row)raw.push(row.value);return row;}};
 const opened=await f.open({vault}),reader=opened.openPath(opened.paths[0]),first=await reader.chunks.next();assert.ok(!first.done);assert.ok(raw.some(bytes=>bytes.some(value=>value)));
 opened.close();assert.ok(first.value.every(value=>value===0));assert.ok(raw.every(bytes=>bytes.every(value=>value===0)));await assert.rejects(reader.chunks.next(),/E2EE_/);
});
test('missing changed or extra original parts and a source-only-v3 shape never become an empty legacy source',async()=>{
 const f=await fixture({size:E2EE_CHUNK_BYTES+7}),key=[...f.memory.rows.keys()][0];f.memory.rows.delete(key);await assert.rejects(f.open(),/E2EE_/);
 const g=await fixture();await assert.rejects(g.open({reference:{protocol:3,source:{}}}),/E2EE_/);await assert.rejects(g.open({paths:g.options.paths.slice(1)}),/E2EE_/);
 const h=await fixture();await h.vault.write([{domain:'local-snapshot',objectId:`${h.options.reference.migrationId}:source:${h.options.reference.snapshotParts}`,value:new Uint8Array([3]),expected:null}]);await assert.rejects(h.open(),/E2EE_/);
});
test('a late changed original part cannot turn a previously opened path into a completed source',async()=>{
 const f=await fixture({size:E2EE_CHUNK_BYTES+7}),opened=await f.open(),last=[...f.memory.rows.keys()].at(-1);assert.ok(last);f.memory.rows.delete(last);const reader=opened.openPath(opened.paths[0]);
 await assert.rejects(collect(reader),/E2EE_/);assert.throws(()=>reader.assertComplete(),/E2EE_/);opened.close();
});
test('closing an already completed path never closes a later active reader',async()=>{
 const f=await fixture(),opened=await f.open(),old=opened.openPath(f.options.paths[0]);await collect(old);const next=opened.openPath(f.options.paths[1]),first=await next.chunks.next();assert.ok(!first.done);
 await old.chunks.return?.();assert.ok((await next.chunks.next()).done);next.assertComplete();opened.close();
});
test('a concurrent next violation retains its path reservation until the original read actually drains',async()=>{
 const f=await fixture(),opened=await f.open();let unblock,arrived;const gate=new Promise(resolve=>{unblock=resolve;}),entered=new Promise(resolve=>{arrived=resolve;});f.memory.hold=async()=>{arrived();await gate;};
 const reader=opened.openPath(f.options.paths[0]),pending=reader.chunks.next();await entered;await assert.rejects(reader.chunks.next(),/BUSY/);
 let premature;try{premature=opened.openPath(f.options.paths[1]);}catch(error){assert.match(error.message,/BUSY/);}finally{unblock();}
 await assert.rejects(pending,/E2EE_/);assert.equal(premature,undefined);f.memory.hold=undefined;assert.deepEqual(await collect(opened.openPath(f.options.paths[1])),f.values[1]);opened.close();
});
test('a raw protected part arriving after close is wiped when its pending read drains',async()=>{
 const f=await fixture(),raw=[];let block=false,unblock,arrive;const gate=new Promise(resolve=>{unblock=resolve;}),entered=new Promise(resolve=>{arrive=resolve;});
 const vault={assertUnlocked:()=>f.vault.assertUnlocked(),localIdentity:()=>f.vault.localIdentity(),listLocal:(...args)=>f.vault.listLocal(...args),async read(...args){const row=await f.vault.read(...args);if(row)raw.push(row.value);if(block){arrive();await gate;}return row;}};
 const opened=await f.open({vault});block=true;const reader=opened.openPath(f.options.paths[0]),pending=reader.chunks.next();await entered;opened.close();unblock();await assert.rejects(pending,/E2EE_/);assert.ok(raw.every(bytes=>bytes.every(value=>value===0)));
});
