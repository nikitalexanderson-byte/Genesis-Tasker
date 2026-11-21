import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {ProtectedRemoteOriginal,listRemoteOriginals,withRemoteOriginal} from '../app/e2ee/remote-original.ts';
import * as remoteOriginals from '../app/e2ee/remote-original.ts';
import {UnlockedE2eeVault} from '../app/e2ee/storage.ts';
import {freshSecret,generateDeviceKeys} from '../app/e2ee/keys.ts';
import {importE2eeRoot,encodeE2eeBytes,sealE2eeEnvelope} from '../app/e2ee/envelope.ts';
import {signE2eeCommand,canonicalE2eeValue,decodeCanonicalE2eeValue} from '../app/e2ee/commands.ts';
import {readE2eeJsonResponse} from '../app/e2ee/http-response.ts';
import {cloudSyncClient} from './helpers/cloud-sync-client.mjs';
class AtomicStorage {
 rows=new Map();full=false;beforeCommit;afterCommit;
 async get(key){return structuredClone(this.rows.get(key)??null);}
 async list(prefix){return [...this.rows.keys()].filter(key=>key.startsWith(prefix));}
 async commit(changes,signal){
  await this.beforeCommit?.(changes);if(signal?.aborted)throw new Error('E2EE_UNLOCK_REQUIRED');if(this.full)throw new Error('E2EE_SYNTHETIC_STORAGE_FULL');
  for(const row of changes)assert.equal(this.rows.get(row.key)?.serial??null,row.expected,'E2EE_LOCAL_CONFLICT');const next=new Map(this.rows);
  for(const row of changes)if(row.value===null)next.delete(row.key);else next.set(row.key,structuredClone(row.value));
  if(signal?.aborted)throw new Error('E2EE_UNLOCK_REQUIRED');this.rows=next;await this.afterCommit?.(changes);
 }
}
const encode=value=>new TextEncoder().encode(value),hash=bytes=>createHash('sha256').update(bytes).digest('base64url');
const header={path:'/e2ee/v1/read',status:200,contentType:'application/json',contentLength:null};
async function fixture(){
 const storage=new AtomicStorage(),keys=await generateDeviceKeys(),raw=freshSecret(),root=await importE2eeRoot(raw);raw.fill(0);
 const scope={ownerId:'cache-qa-user',scopeId:'device:remote-original',deviceId:'remote-device',generation:1,cryptoEpoch:1,securityEpoch:1,keyId:'independent-local-root',signingKey:keys.signing.privateKey,roots:new Map([['independent-local-root',root]]),trustedSigner:id=>id==='remote-device'?keys.signing.publicKey:undefined};
 const target={ownerId:scope.ownerId,scopeId:'personal:'+scope.ownerId,kind:'personal'};
 const packet=await signE2eeCommand({protocol:1,ownerId:target.ownerId,scopeId:target.scopeId,deviceId:scope.deviceId,action:'legacy-mindmaps',expectedRevision:1,checkpointHash:encodeE2eeBytes(new Uint8Array(32)),securityEpoch:1,operationId:crypto.randomUUID(),payload:{migrationId:crypto.randomUUID(),fence:1,sourceHash:encodeE2eeBytes(new Uint8Array(32).fill(7)),table:'maps',offset:0}},keys.signing.privateKey);
 let live=true,durable=0;const current=()=>{if(!live)throw new Error('E2EE_ACCOUNT_CHANGED');},admissions=[];
 const spawn=()=>new UnlockedE2eeVault(storage,scope),vault=spawn(),options={vault,target,packet,signer:keys.signing.publicKey,generation:2,capacity:{maximumBytes:16*1024*1024,maximumParts:128,maximumObservations:16,maximumRecords:256,maximumMetadataBytes:2*1024*1024},assertCurrent:current,ensureDurableKeys:async()=>{durable++;},admit:async value=>{admissions.push(value);}};
 return{storage,scope,target,vault,spawn,options,keys,packet,current,admissions,durable:()=>durable,retire:()=>{live=false;}};
}
async function registered(f){const capture=await ProtectedRemoteOriginal.create(f.options);await capture.prepare({path:header.path,method:'POST',body:JSON.stringify(f.packet)});return capture;}
async function complete(f,raw=encode('\ufeff {"private":"SYNTHETIC-PRIVATE-RAW-CANARY α😀"}\r\n')){
 const capture=await registered(f);await readE2eeJsonResponse(new Response(raw.slice(),{headers:{'Content-Type':header.contentType}}),header.path,f.current,capture);return{capture,raw,ref:capture.reference()};
}
async function readAll(options,id,mode){const chunks=[];const receipt=await withRemoteOriginal(options,id,async source=>{for await(const row of source)chunks.push(Buffer.from(row));},mode);return{receipt,bytes:Buffer.concat(chunks)};}

test('shared original role requires a shared target and an exact bounded signed page before any write',async()=>{
 const f=await fixture();
 try{for(const kind of ['personal','project','space']){
  const target={...f.target,scopeId:`${kind}:${f.target.ownerId}`,kind};
  for(const mode of ['valid','missing-page','unknown-table','negative-offset','byte-offset']){
   const command=structuredClone(f.packet.command);command.scopeId=target.scopeId;command.action='legacy-shared-mindmaps';
   command.payload={migrationId:command.payload.migrationId,fence:1,sourceHash:command.payload.sourceHash,...(mode==='missing-page'?{}:{table:mode==='unknown-table'?'users':'maps',offset:mode==='negative-offset'?-1:0}),...(mode==='byte-offset'?{byteOffset:0}:{})};
   // Invalid negative numbers are refused by the signed command encoder too.
   const before=structuredClone(f.storage.rows);
   if(mode==='negative-offset'){await assert.rejects(signE2eeCommand(command,f.keys.signing.privateKey));continue;}
   const packet=await signE2eeCommand(command,f.keys.signing.privateKey),options={...f.options,target,packet};
   if(kind==='personal'||mode!=='valid')await assert.rejects(ProtectedRemoteOriginal.create(options));
   else{const capture=await ProtectedRemoteOriginal.create(options);assert.equal(capture.registration().context.kind,kind);capture.close();}
   assert.deepEqual(f.storage.rows,before);
  }
 }}finally{f.vault.lock();}
});

test('actual signed AEAD quarantine cold-reads exact raw BOM whitespace and private UTF8 without a plaintext store',async()=>{
 const f=await fixture(),{raw,ref}=await complete(f);assert.equal(f.durable(),1);assert.equal(ref.rawHash,hash(raw));assert.equal(ref.size,raw.length);assert.equal(Object.isFrozen(ref),true);
 assert.equal(JSON.stringify([...f.storage.rows]).includes('SYNTHETIC-PRIVATE-RAW-CANARY'),false);const before=new Map(f.storage.rows);f.vault.lock();
 const cold=f.spawn(),result=await readAll({...f.options,vault:cold},ref.id);assert.deepEqual(result.bytes,Buffer.from(raw));assert.equal(result.receipt.complete,true);assert.equal(result.receipt.rawHash,hash(raw));assert.equal((await listRemoteOriginals({...f.options,vault:cold}))[0].phase,'complete');assert.deepEqual(f.storage.rows,before);
});
test('the real authenticated web channel preserves a complete duplicate response before refusing its projected authority',async()=>{
 const f=await fixture(),client=await cloudSyncClient(),capture=await ProtectedRemoteOriginal.create(f.options),raw='\ufeff {"sourceHash":"first", "sourceHash":"second"}\r\n';
 client.respond((url,init)=>{assert.equal(new URL(url).pathname,'/api/e2ee/v1/read');assert.equal(init.body,JSON.stringify(f.packet));assert.ok(f.storage.rows.size>=3);return new Response(raw,{headers:{'Content-Type':'application/json'}});});
 // The Node cloud-client fixture owns a separate VM realm. Copy only its
 // controlled primitive metadata frame; retain production descriptor checks.
 const port={prepare:request=>capture.prepare({...request}),begin:response=>capture.begin({...response}),append:bytes=>capture.append(bytes),finish:()=>capture.finish(),close:()=>capture.close()};
 await assert.rejects(client.client.e2eeRequest('/read',f.packet,undefined,port),/E2EE_INVALID_RESPONSE/);const ref=capture.reference();f.vault.lock();const restored=await readAll({...f.options,vault:f.spawn()},ref.id);assert.deepEqual(restored.bytes,Buffer.from(raw));assert.equal(restored.receipt.complete,true);
});
test('a crashed prefix stays discoverable and cannot become a complete observation while a fresh attempt retains it',async()=>{
 const f=await fixture(),capture=await registered(f);await capture.begin(header);const prefix=encode('retained-prefix');await capture.append(prefix);capture.close();const [old]=await listRemoteOriginals(f.options);
 assert.equal(old.phase,'receiving');await assert.rejects(readAll(f.options,old.id),/INCOMPLETE/);const partial=await readAll(f.options,old.id,{allowIncomplete:true});assert.equal(partial.receipt.complete,false);assert.deepEqual(partial.bytes,Buffer.from(prefix));
 const retained=new Map(f.storage.rows);await complete(f);const rows=await listRemoteOriginals(f.options);assert.equal(rows.length,2);assert.equal(rows[0].id,old.id);for(const[key,value]of retained)if(!key.includes('remote-original-catalog:'))assert.deepEqual(f.storage.rows.get(key),value);
});
test('quota failure and a swallowed rejected append never publish EOF or erase a previous original',async()=>{
 const f=await fixture(),capture=await registered(f);await capture.begin(header);await capture.append(encode('first'));const before=new Map(f.storage.rows);f.storage.full=true;
 await assert.rejects(capture.append(encode('second')),/E2EE_REMOTE_ORIGINAL_STORAGE_UNAVAILABLE/);f.storage.full=false;await assert.rejects(capture.finish(),/CLOSED/);capture.close();assert.deepEqual(f.storage.rows,before);const [row]=await listRemoteOriginals(f.options);assert.equal(row.phase,'receiving');assert.equal((await readAll(f.options,row.id,{allowIncomplete:true})).bytes.toString(),'first');
});

test('provider failures expose a fixed local code without private exception strings while cancellation keeps its identity',async()=>{
 const f=await fixture();
 for(const cancel of [false,true]){
  const failure=cancel?new DOMException('synthetic-retired','AbortError'):new Error('SYNTHETIC-PRIVATE-STORAGE-CANARY');
  const capture=await ProtectedRemoteOriginal.create({...f.options,admit:async()=>{throw failure;}}),before=new Map(f.storage.rows);
  await assert.rejects(capture.prepare({path:header.path,method:'POST',body:JSON.stringify(f.packet)}),error=>cancel?error===failure:error.message==='E2EE_REMOTE_ORIGINAL_STORAGE_UNAVAILABLE');
  capture.close();assert.deepEqual(f.storage.rows,before);
 }
});

test('explicit iterator close after actual EOF agrees with native InputStream use without allowing an early receipt',async()=>{
 const f=await fixture(),{ref}=await complete(f);
 const receipt=await withRemoteOriginal(f.options,ref.id,async source=>{const iterator=source[Symbol.asyncIterator]();while(!(await iterator.next()).done){/* Consume through the actual terminal next. */}await iterator.return();});assert.equal(receipt.complete,true);
});
test('request and header bindings refuse before content, and actor retirement after admission publishes no success',async()=>{
 for(const mode of ['request','header','retire']){
  const f=await fixture(),capture=await ProtectedRemoteOriginal.create(f.options);
  if(mode==='request'){await assert.rejects(capture.prepare({path:header.path,method:'POST',body:JSON.stringify({...f.packet,signature:'A'.repeat(86)})}),/E2EE_/);assert.equal(f.storage.rows.size,0);}
  else{await capture.prepare({path:header.path,method:'POST',body:JSON.stringify(f.packet)});const before=new Map(f.storage.rows);
   if(mode==='header')await assert.rejects(capture.begin({...header,path:'/e2ee/v1/source'}),/E2EE_/);
   else{f.options.admit=async()=>{f.retire();}; // Options are captured: changing the caller must not alter the live callback.
    f.retire();await assert.rejects(capture.begin(header),/ACCOUNT_CHANGED/);}
   assert.deepEqual(f.storage.rows,before);
  }capture.close();
 }
});
test('capacity includes old partials requests journals and record counts before another request can be sent',async()=>{
 const f=await fixture(),capture=await registered(f);await capture.begin(header);await capture.append(encode('old'));capture.close();const before=new Map(f.storage.rows),limited={...f.options,capacity:{...f.options.capacity,maximumObservations:1}};
 const next=await ProtectedRemoteOriginal.create(limited);await assert.rejects(next.prepare({path:header.path,method:'POST',body:JSON.stringify(f.packet)}),/CAPACITY/);assert.deepEqual(f.storage.rows,before);assert.ok(f.admissions.every(row=>row.metadataBytes>0&&row.records>=3));next.close();
});
test('missing or forged body parts refuse complete readback and preserve every stored row',async()=>{
 for(const mode of ['missing','tag','serial']){
  const f=await fixture(),{ref}=await complete(f),key=[...f.storage.rows.keys()].find(key=>key.includes(':p:00000')),original=f.storage.rows.get(key);
  if(mode==='missing')f.storage.rows.delete(key);else{const changed=structuredClone(original);if(mode==='tag')changed.envelope.ciphertext=(changed.envelope.ciphertext[0]==='A'?'B':'A')+changed.envelope.ciphertext.slice(1);else changed.serial=2;f.storage.rows.set(key,changed);}
  const before=new Map(f.storage.rows);await assert.rejects(readAll(f.options,ref.id),/E2EE_/);assert.deepEqual(f.storage.rows,before);
 }
});
test('unknown technical roles refuse before any matching source body can be opened',async()=>{
 const f=await fixture(),{ref}=await complete(f);const entry=[...f.storage.rows].find(([key])=>key.includes(':p:00000'));f.storage.rows.set(entry[0].replace(':p:00000',':x:00000'),entry[1]);let gets=0;
 const get=f.storage.get.bind(f.storage);f.storage.get=async key=>{if(key.includes(':p:'))gets++;return get(key);};await assert.rejects(readAll(f.options,ref.id),/UNBOUND_REMNANT/);assert.equal(gets,0);
});
test('incomplete consumers drain and wipe borrowed bytes, and escaped readers lose their capability',async()=>{
 const f=await fixture(),{ref}=await complete(f);let loan,iterator;
 await assert.rejects(withRemoteOriginal(f.options,ref.id,async source=>{iterator=source[Symbol.asyncIterator]();loan=(await iterator.next()).value;}),/INCOMPLETE_READ/);
 assert.ok(loan.every(byte=>byte===0));await assert.rejects(iterator.next(),/READER_CLOSED/);
});
test('metadata rebinding and catalogue changes after consumer EOF cannot yield a source receipt',async()=>{
 const f=await fixture(),{ref}=await complete(f);let changed=false;
 await assert.rejects(withRemoteOriginal(f.options,ref.id,async source=>{for await(const part of source)assert.ok(part.length);if(!changed){changed=true;const other=await registered(f);other.close();}}),/BUSY/);
});
test('a request carrying a different source lease or unknown page role cannot share a captured binding',async()=>{
 const f=await fixture(),capture=await ProtectedRemoteOriginal.create(f.options);
 const changed=await signE2eeCommand({...f.packet.command,payload:{...f.packet.command.payload,fence:2}},f.keys.signing.privateKey);
 await assert.rejects(capture.prepare({path:header.path,method:'POST',body:JSON.stringify(changed)}),/REQUEST_INVALID/);assert.equal(f.storage.rows.size,0);capture.close();
 const unknown=await signE2eeCommand({...f.packet.command,payload:{...f.packet.command.payload,table:'unknown-table'}},f.keys.signing.privateKey);
 await assert.rejects(ProtectedRemoteOriginal.create({...f.options,packet:unknown}),/E2EE_/);
});
test('a validly sealed partial journal cannot rebind its original signed source token before body lookup',async()=>{
 const f=await fixture(),capture=await registered(f);await capture.begin(header);await capture.append(encode('prefix'));capture.close();const [entry]=await listRemoteOriginals(f.options);
 const jid=(await f.vault.listLocal('local-snapshot','remote-original:')).find(id=>id.endsWith(':j:00000')),row=await f.vault.read('local-snapshot',jid);
 const metadata=decodeCanonicalE2eeValue(row.value);row.value.fill(0);metadata.binding.sourceHash=encodeE2eeBytes(new Uint8Array(32).fill(9));const bytes=canonicalE2eeValue(metadata);
 try{await f.vault.write([{domain:'local-snapshot',objectId:jid,value:bytes,expected:row.serial}]);}finally{bytes.fill(0);}
 let bodyGets=0;const get=f.storage.get.bind(f.storage);f.storage.get=async key=>{if(key.includes(':p:'))bodyGets++;return get(key);};const before=new Map(f.storage.rows);
 await assert.rejects(readAll(f.options,entry.id,{allowIncomplete:true}),/E2EE_/);assert.equal(bodyGets,0);assert.deepEqual(f.storage.rows,before);
});

test('pre-network registration is immutable inert identity without a durable original or receipt',async()=>{
 const f=await fixture(),capture=await ProtectedRemoteOriginal.create(f.options),registration=capture.registration();
 assert.equal(registration.protocol,1);assert.equal(registration.purpose,'remote-original/v1');assert.match(registration.id,/^[a-f0-9-]{36}$/);
 assert.equal(registration.binding.packetHash,hash(canonicalE2eeValue(f.packet)));assert.equal(registration.context.actorId,f.scope.ownerId);assert.equal(registration.binding.generation,2);
 assert.ok(Object.isFrozen(registration)&&Object.isFrozen(registration.context)&&Object.isFrozen(registration.binding));assert.equal(Object.hasOwn(registration,'complete'),false);
 assert.equal(f.storage.rows.size,0);assert.equal(f.durable(),0);await assert.rejects(remoteOriginals.describeRemoteOriginal(f.options,registration.id),/MISSING/);
 capture.close();f.retire();assert.deepEqual(capture.registration(),registration);
});

test('authenticated descriptor discovers registered and partial request bindings without opening response bodies',async()=>{
 const f=await fixture(),capture=await registered(f),registration=capture.registration(),originalGet=f.storage.get.bind(f.storage);let bodyGets=0;
 f.storage.get=async key=>{if(key.includes(':p:'))bodyGets++;return originalGet(key);};
 let descriptor=await remoteOriginals.describeRemoteOriginal(f.options,registration.id);
 assert.equal(descriptor.bodyVerified,false);assert.equal(descriptor.phase,'registered');assert.deepEqual(descriptor.registration,registration);assert.equal(descriptor.request.hash,hash(encode(JSON.stringify(f.packet))));
 await capture.begin(header);await capture.append(encode('prefix'));capture.close();const before=new Map(f.storage.rows);
 descriptor=await remoteOriginals.describeRemoteOriginal(f.options,registration.id);assert.equal(descriptor.phase,'receiving');assert.equal(descriptor.size,6);assert.equal(descriptor.parts,1);assert.equal(descriptor.rawHash,null);assert.equal(descriptor.manifestHash,null);
 assert.ok(Object.isFrozen(descriptor)&&Object.isFrozen(descriptor.request)&&Object.isFrozen(descriptor.response));assert.equal(bodyGets,0);assert.deepEqual(f.storage.rows,before);
});

test('metadata discovery is not body proof even when an authenticated complete marker exists',async()=>{
 const f=await fixture(),{ref}=await complete(f),key=[...f.storage.rows.keys()].find(key=>key.includes(':p:00000')),changed=structuredClone(f.storage.rows.get(key));
 changed.envelope.ciphertext=(changed.envelope.ciphertext[0]==='A'?'B':'A')+changed.envelope.ciphertext.slice(1);f.storage.rows.set(key,changed);const before=new Map(f.storage.rows);
 const descriptor=await remoteOriginals.describeRemoteOriginal(f.options,ref.id);assert.equal(descriptor.phase,'complete');assert.equal(descriptor.bodyVerified,false);assert.equal(descriptor.rawHash,ref.rawHash);
 await assert.rejects(readAll(f.options,ref.id),/E2EE_/);assert.deepEqual(f.storage.rows,before);
});

test('authenticated descriptor refuses signed-source rebinding catalogue drift and actor retirement before body access',async()=>{
 for(const mode of ['binding','catalog','retire']){
  const f=await fixture(),{ref}=await complete(f);let bodyGets=0,changed=false;const get=f.storage.get.bind(f.storage);
  if(mode==='binding'){
   const jid=(await f.vault.listLocal('local-snapshot','remote-original:')).find(id=>id.endsWith(':j:00000')),row=await f.vault.read('local-snapshot',jid),metadata=decodeCanonicalE2eeValue(row.value);row.value.fill(0);
   metadata.binding.sourceHash=encodeE2eeBytes(new Uint8Array(32).fill(9));const bytes=canonicalE2eeValue(metadata);try{await f.vault.write([{domain:'local-snapshot',objectId:jid,value:bytes,expected:row.serial}]);}finally{bytes.fill(0);}
  }
  const before=new Map(f.storage.rows);
  f.storage.get=async key=>{if(key.includes(':p:'))bodyGets++;const value=await get(key);if(key.includes(':r:')&&!changed){changed=true;if(mode==='retire')f.retire();if(mode==='catalog')(await registered(f)).close();}return value;};
  await assert.rejects(remoteOriginals.describeRemoteOriginal(f.options,ref.id),/E2EE_/);assert.equal(bodyGets,0);
  for(const[key,value]of before)if(!key.includes('remote-original-catalog:'))assert.deepEqual(f.storage.rows.get(key),value);
 }
});

test('physical request BOM is forbidden on protected readback as on native even after valid local resealing',async()=>{
 const f=await fixture(),capture=await registered(f);capture.close();const [marker]=await listRemoteOriginals(f.options);
 const ids=await f.vault.listLocal('local-snapshot','remote-original:'),rid=ids.find(id=>id.endsWith(':r:00000')),jid=ids.find(id=>id.endsWith(':j:00000'));
 const request=await f.vault.read('local-snapshot',rid),bytes=Buffer.concat([Buffer.from([239,187,191]),Buffer.from(request.value)]);request.value.fill(0);
 const rkey=[...f.storage.rows.keys()].find(key=>key.endsWith(rid)),stored=f.storage.rows.get(rkey);f.storage.rows.set(rkey,{serial:1,envelope:await sealE2eeEnvelope(f.scope.roots.get(f.scope.keyId),f.keys.signing.privateKey,stored.envelope.context,bytes)});
 const journal=await f.vault.read('local-snapshot',jid),metadata=decodeCanonicalE2eeValue(journal.value);journal.value.fill(0);metadata.request={size:bytes.length,hash:hash(bytes)};const encoded=canonicalE2eeValue(metadata);
 try{await f.vault.write([{domain:'local-snapshot',objectId:jid,value:encoded,expected:journal.serial}]);}finally{encoded.fill(0);bytes.fill(0);}
 const before=new Map(f.storage.rows);await assert.rejects(readAll(f.options,marker.id,{allowIncomplete:true}),/E2EE_/);await assert.rejects(remoteOriginals.describeRemoteOriginal(f.options,marker.id),/E2EE_/);assert.deepEqual(f.storage.rows,before);
});
