import {ProtectedRemoteOriginal,listRemoteOriginals,describeRemoteOriginal,withRemoteOriginal,type RemoteOriginalOptions} from '../../app/e2ee/remote-original.ts';
import {IndexedDbE2eeStorage,UnlockedE2eeVault} from '../../app/e2ee/storage.ts';
import {generateDeviceKeys,freshSecret} from '../../app/e2ee/keys.ts';
import {importE2eeRoot,encodeE2eeBytes} from '../../app/e2ee/envelope.ts';
import {signE2eeCommand} from '../../app/e2ee/commands.ts';
import {e2eeRequest,loadGenesisSession} from '../../app/cloud-sync';
const report:{synthetic:boolean;runtime:string;checks:{name:string;passed:boolean}[];status?:string;error?:string;rawBytes?:number;rawHash?:string}={synthetic:true,runtime:navigator.userAgent,checks:[]};
const show=()=>{document.querySelector('#result')!.textContent=JSON.stringify(report,null,2);};
const check=(name:string,passed:boolean)=>{report.checks.push({name,passed});show();if(!passed)throw new Error(name);};
const refuses=async(body:()=>Promise<unknown>)=>{try{await body();return false;}catch(error){return error instanceof Error&&error.message.startsWith('E2EE_');}};
try{
 check('secure browser with real WebCrypto and IndexedDB',isSecureContext&&!!crypto.subtle&&!!indexedDB);
 check('actual authenticated account established',(await loadGenesisSession())?.uid==='remote-browser-owner');
 const keys=await generateDeviceKeys(),raw=freshSecret(),root=await importE2eeRoot(raw);raw.fill(0);
 const scope={ownerId:'remote-browser-owner',scopeId:'device:remote-browser',deviceId:'remote-browser-device',generation:1,cryptoEpoch:1,securityEpoch:1,keyId:'independent-local-root',signingKey:keys.signing.privateKey,roots:new Map([['independent-local-root',root]]),trustedSigner:(id:string)=>id==='remote-browser-device'?keys.signing.publicKey:undefined};
 let storage=new IndexedDbE2eeStorage(),vault=new UnlockedE2eeVault(storage,scope),active=true;
 const current=()=>{if(!active)throw new Error('E2EE_ACCOUNT_CHANGED');};
 const packet=await signE2eeCommand({protocol:1,ownerId:scope.ownerId,scopeId:'personal:remote-browser-owner',deviceId:scope.deviceId,action:'legacy-mindmaps',expectedRevision:1,checkpointHash:encodeE2eeBytes(new Uint8Array(32)),securityEpoch:1,operationId:crypto.randomUUID(),payload:{migrationId:crypto.randomUUID(),fence:1,sourceHash:encodeE2eeBytes(new Uint8Array(32).fill(7)),table:'maps',offset:0}},keys.signing.privateKey);
 const options:RemoteOriginalOptions={vault,target:{ownerId:scope.ownerId,scopeId:packet.command.scopeId,kind:'personal'},packet,signer:keys.signing.publicKey,generation:2,capacity:{maximumBytes:16*1024*1024,maximumParts:256,maximumObservations:16,maximumRecords:512,maximumMetadataBytes:4*1024*1024},assertCurrent:current,ensureDurableKeys:async()=>{},admit:async()=>{}};
 const select=async(mode:string)=>{const response=await fetch('/control?mode='+mode);if(!response.ok)throw new Error('Fixture control failed');};
 const snapshot=async()=>{const result=[];for(const key of (await storage.list('')).sort()){const bytes=new TextEncoder().encode(JSON.stringify(await storage.get(key)));try{result.push([key,encodeE2eeBytes(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)))]);}finally{bytes.fill(0);}}return JSON.stringify(result);};
 const expected=await(await fetch('/expected.json')).json() as {largeBytes:number;largeHash:string;duplicateBytes:number;duplicateHash:string};
 await select('large');const large=await ProtectedRemoteOriginal.create(options),registration=large.registration();
 check('pre-network registration is frozen inert identity without a stored original or receipt',Object.isFrozen(registration)&&Object.isFrozen(registration.context)&&Object.isFrozen(registration.binding)
  &&registration.binding.generation===2&&!Object.hasOwn(registration,'complete')&&(await storage.list('')).length===0);
 check('an unprepared registration cannot be discovered as a durable original',await refuses(()=>describeRemoteOriginal(options,registration.id)));
 const value=await e2eeRequest<{private:string}>('/read',packet,undefined,large),ref=large.reference();
 check('actual fetch captures the full generated2MiB response before returning parsed private text',value.private.startsWith('SYNTHETIC-RAW-CANARY α😀')&&ref.size===expected.largeBytes&&ref.rawHash===expected.largeHash);
 check('the finished capture capability is closed while its reference stays inert',await refuses(()=>large.append(new Uint8Array([7]))));
 // Failed late calls deliberately poison that live object; use only its prior
 // immutable reference for the independent cold protected-reader checks.
 const before=await snapshot();vault.lock();storage=new IndexedDbE2eeStorage();vault=new UnlockedE2eeVault(storage,scope);const cold={...options,vault};
 let bodyGets=0;const storedGet=storage.get.bind(storage);storage.get=async key=>{if(key.includes(':p:'))bodyGets++;return storedGet(key);};
 const descriptor=await describeRemoteOriginal(cold,ref.id);
 check('cold metadata authenticates the signed request without reading response bodies or claiming body proof',descriptor.registration.id===registration.id&&descriptor.phase==='complete'
  &&descriptor.bodyVerified===false&&descriptor.rawHash===expected.largeHash&&bodyGets===0);
 let bytes=0;const receipt=await withRemoteOriginal(cold,ref.id,async source=>{for await(const row of source)bytes+=row.length;});
 check('cold actual IDB authenticates every original byte and exact EOF',receipt.complete&&bytes===expected.largeBytes&&receipt.rawHash===expected.largeHash);
 check('cold readback leaves every encrypted record byte-identical',await snapshot()===before);
 const used=await withRemoteOriginal(cold,ref.id,async source=>{const iterator=source[Symbol.asyncIterator]();while(!(await iterator.next()).done){/* Actual EOF required. */}await iterator.return?.();});check('explicit close after actual original EOF preserves its complete proof',used.complete&&used.rawHash===expected.largeHash);
 await select('duplicate');const duplicate=await ProtectedRemoteOriginal.create(cold);
 check('an ambiguous response refuses through the actual authenticated parser',await refuses(()=>e2eeRequest('/read',packet,undefined,duplicate)));
 const duplicateRef=duplicate.reference(),duplicateProof=await withRemoteOriginal(cold,duplicateRef.id,async source=>{for await(const row of source)row.fill(0);});
 check('the rejected duplicate still has its exact protected raw BOM whitespace and original EOF',duplicateProof.complete&&duplicateProof.size===expected.duplicateBytes&&duplicateProof.rawHash===expected.duplicateHash);
 const partial=await ProtectedRemoteOriginal.create(cold);await partial.prepare({path:'/e2ee/v1/read',method:'POST',body:JSON.stringify(packet)});await partial.begin({path:'/e2ee/v1/read',status:200,contentType:'application/json',contentLength:null});await partial.append(new TextEncoder().encode('retained-prefix'));partial.close();
 const markers=await listRemoteOriginals(cold),prefix=markers.find(row=>row.phase==='receiving')!;
 bodyGets=0;const partialDescriptor=await describeRemoteOriginal(cold,prefix.id);
 check('partial request descriptor is discoverable without body reads or an EOF claim',partialDescriptor.phase==='receiving'&&partialDescriptor.bodyVerified===false
  &&partialDescriptor.rawHash===null&&partialDescriptor.manifestHash===null&&partialDescriptor.parts===1&&bodyGets===0);
 check('process-style close leaves a discoverable incomplete prefix',!!prefix&&await refuses(()=>withRemoteOriginal(cold,prefix.id,async()=>{})));
 const prefixReceipt=await withRemoteOriginal(cold,prefix.id,async source=>{for await(const row of source)row.fill(0);},{allowIncomplete:true});check('explicit prefix reading never claims remote EOF',!prefixReceipt.complete&&prefixReceipt.size===15);
 const limited=await ProtectedRemoteOriginal.create({...cold,capacity:{...cold.capacity,maximumObservations:markers.length}}),kept=await snapshot();
 check('quota refusal happens before a new request and retains all old originals',await refuses(()=>limited.prepare({path:'/e2ee/v1/read',method:'POST',body:JSON.stringify(packet)}))&&await snapshot()===kept);limited.close();
 let loan:Uint8Array|undefined,iterator:AsyncIterator<Uint8Array>|undefined;
 check('a consumer stopping before EOF cannot manufacture a read receipt',await refuses(()=>withRemoteOriginal(cold,ref.id,async source=>{iterator=source[Symbol.asyncIterator]();loan=(await iterator.next()).value;})));
 check('a stopped consumer has its actual borrowed buffer wiped',!!loan&&loan.every(byte=>byte===0));check('escaped source readers are revoked',!!iterator&&await refuses(()=>iterator!.next()));
 const retired=await ProtectedRemoteOriginal.create({...cold,admit:async()=>{active=false;}});check('account retirement during durable admission cannot send a response request',await refuses(()=>retired.prepare({path:'/e2ee/v1/read',method:'POST',body:JSON.stringify(packet)})));active=true;retired.close();
 check('retirement preserves every earlier encrypted record',await snapshot()===kept);
 const calls=(await(await fetch('/metrics.json')).json() as {reads:number}).reads,failed=await ProtectedRemoteOriginal.create({...cold,admit:async()=>{throw new Error('SYNTHETIC-PRIVATE-PROVIDER-PATH');}});
 let failure='';try{await e2eeRequest('/read',packet,undefined,failed);}catch(error){failure=error instanceof Error?error.message:'';}
 check('actual authenticated registration reports a fixed local failure without exposing provider text',failure==='E2EE_REMOTE_ORIGINAL_STORAGE_UNAVAILABLE');
 check('failed durable registration sends no request and keeps every earlier original',calls===(await(await fetch('/metrics.json')).json() as {reads:number}).reads&&await snapshot()===kept);
 vault.lock();report.status='PASS';report.rawBytes=ref.size;report.rawHash=ref.rawHash;document.title='PASS GENESIS remote originals';
}catch(error){report.status='FAIL';report.error=error instanceof Error?error.message:String(error);document.title='FAIL GENESIS remote originals';}
show();
