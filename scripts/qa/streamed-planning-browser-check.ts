import {sha256} from '@noble/hashes/sha2.js';
import {E2eeMigration,type MigrationSources,type StreamedPlanningOptions} from '../../app/e2ee/migration.ts';
import {UnlockedWebDevice,IndexedDbDeviceKeyStorage} from '../../app/e2ee/device-vault.ts';
import {IndexedDbE2eeStorage} from '../../app/e2ee/storage.ts';
import {requiredPrivatePaths} from '../../app/e2ee/migration-sources.ts';
import {createRecoveryKit,freshSecret,publicDeviceKeys,sealRoot,generateDeviceKeys} from '../../app/e2ee/keys.ts';
import {verifyDeviceDirectory} from '../../app/e2ee/directory.ts';
import {encodeE2eeBytes,importE2eeRoot,E2EE_DOMAINS} from '../../app/e2ee/envelope.ts';
import {signE2eeCommand,type SignedE2eeCommand,type WireValue} from '../../app/e2ee/commands.ts';
import {ProtectedRemoteOriginal,listRemoteOriginals,describeRemoteOriginal,withRemoteOriginal} from '../../app/e2ee/remote-original.ts';
const report:{synthetic:boolean;runtime:string;checks:{name:string;passed:boolean}[];status?:string;error?:string}={synthetic:true,runtime:navigator.userAgent,checks:[]};
const show=()=>{document.querySelector('#result')!.textContent=JSON.stringify(report,null,2);};
const check=(name:string,passed:boolean)=>{report.checks.push({name,passed});show();if(!passed)throw new Error(name);};
const refuses=async(operation:()=>Promise<unknown>)=>{try{await operation();return false;}catch(error){return error instanceof Error&&error.message.startsWith('E2EE_');}};
const encoder=new TextEncoder(),hash=(bytes:Uint8Array)=>encodeE2eeBytes(sha256(bytes));
try{
 check('actual secure WebCrypto and IndexedDB',isSecureContext&&!!crypto.subtle&&!!indexedDB);
 const ownerId='streamed-'+crypto.randomUUID(),scopeId='personal:'+ownerId,recovery=await createRecoveryKit(ownerId);
 let storage=new IndexedDbE2eeStorage(),keys=new IndexedDbDeviceKeyStorage(),device=await UnlockedWebDevice.provision(ownerId,recovery.secret,recovery.kit,storage,keys);
 const deviceId=device.deviceId,pub=await publicDeviceKeys(device.keys()),raw=freshSecret(),root=await importE2eeRoot(raw),recipient={ownerId,scopeId,cryptoEpoch:1,keyId:'streamed-root',recipientId:deviceId};
 const command={protocol:1 as const,ownerId,scopeId,deviceId,action:'bootstrap',expectedRevision:0,checkpointHash:'genesis',securityEpoch:1,operationId:crypto.randomUUID(),payload:{
  kind:'personal',resourceId:ownerId,keyId:'streamed-root',generation:1,recoveryKit:recovery.kit,deviceKeys:pub,
  deviceCapsule:await sealRoot(raw,pub.receivingKey,recipient),recoveryCapsule:await sealRoot(raw,recovery.kit.authority.receivingKey,{...recipient,recipientId:'recovery'})}};
 raw.fill(0);const bootstrap={...command,payload:{...command.payload,selfProof:(await signE2eeCommand(command,device.keys().signing.privateKey)).signature}};
 const directory=await verifyDeviceDirectory(ownerId,scopeId,recovery.kit.authority,[await signE2eeCommand(bootstrap,recovery.keys.signing.privateKey)]);
 await fetch('/actor',{method:'POST',body:JSON.stringify({ownerId,scopeId,deviceId,signingKey:pub.signingKey})}).then(response=>{if(!response.ok)throw new Error('E2EE_SYNTHETIC_ACTOR_FAILED');});
 const paths=requiredPrivatePaths('personal').map(row=>row.id),target={ownerId,scopeId,kind:'personal' as const},trace:SignedE2eeCommand[]=[];
 let failAfterAck=true,retireAction:string|null=null,live=true,retiredState:string|null=null;
 const current=()=>{if(!live)throw new Error('E2EE_ACCOUNT_CHANGED');device.requireOpen();};
 const inventoryHash=async()=>{const digest=sha256.create();try{for(const key of(await storage.list('')).sort()){const row=await storage.get(key);digest.update(encoder.encode(JSON.stringify([key,row])));}return encodeE2eeBytes(digest.digest());}finally{digest.destroy();}};
 const transport={async sourceHash(){current();check('state4 is durable before source discovery',(await migration.status())?.protocol===4);return(await(await fetch('/source.json')).json() as {sourceHash:string}).sourceHash;},
  async command(packet:SignedE2eeCommand):Promise<Record<string,WireValue>>{
   current();trace.push(structuredClone(packet));const response=await fetch('/lease',{method:'POST',body:JSON.stringify(packet)});if(!response.ok)throw new Error('E2EE_SYNTHETIC_LEASE_FAILED');
   const result=await response.json() as Record<string,WireValue>;if(retireAction===packet.command.action){retiredState=await inventoryHash();live=false;}
   if(failAfterAck){failAfterAck=false;throw new Error('E2EE_SYNTHETIC_LOST_ACK');}return result;
  },async readAll(){throw new Error('E2EE_AGGREGATE_READ_FORBIDDEN');}};
 const sources:MigrationSources={requiredCoverage:paths,allowedContentDomains:E2EE_DOMAINS.filter(domain=>requiredPrivatePaths('personal').some(row=>row.domains.includes(domain))),
  async captureLocal(){throw new Error('E2EE_AGGREGATE_CAPTURE_FORBIDDEN');},async reconcile(){throw new Error('E2EE_AGGREGATE_PLAN_FORBIDDEN');}};
 const make=()=>new E2eeMigration({vault:device.vault,directory,deviceId,signingKey:device.keys().signing.privateKey,signer:device.keys().signing.publicKey,root,sources,transport,
  ensureDurableKeys:()=>device.ensureDurableKeys(),withLocalWriteFence:operation=>operation(),verifyRecovery:async()=>{throw new Error('E2EE_NO_PRODUCT_RECOVERY');}});
 let migration=make();const options=():StreamedPlanningOptions=>({device,capacity:{maximumBytes:32*1024*1024,maximumParts:2000,maximumMetadataBytes:8*1024*1024},
  originalCapacity:{maximumBytes:8*1024*1024,maximumParts:1000,maximumObservations:100,maximumRecords:4000,maximumMetadataBytes:4*1024*1024},assertCurrent:current,admit:async()=>{}});
 const stateId='migration:'+hash(encoder.encode(scopeId));
 const readState=async()=>{const row=await device.vault.read('local-snapshot',stateId);if(!row)throw new Error('E2EE_STATE_MISSING');try{return JSON.parse(new TextDecoder().decode(row.value));}finally{row.value.fill(0);}};
 const cold=async()=>{device.lock();storage=new IndexedDbE2eeStorage();keys=new IndexedDbDeviceKeyStorage();device=await UnlockedWebDevice.unlock(ownerId,recovery.secret,storage,keys);migration=make();};
 const staged={target,paths,async capturePath(path:string,write:(bytes:Uint8Array)=>Promise<void>){
  const size=path===paths[0]?1024*1024+7:31;for(let at=0;at<size;at+=65536){const part=Uint8Array.from({length:Math.min(65536,size-at)},(_,offset)=>(at+offset+paths.indexOf(path))&255);try{await write(part);}finally{part.fill(0);}}
 }},stagedOptions={capacity:{maximumBytes:16*1024*1024,maximumParts:1000},assertCurrent:current,admit:async()=>{}};
 const originalCommit=storage.commit.bind(storage),initialEstimate=navigator.storage.estimate.bind(navigator.storage);
 let pointerEntered!:()=>void,pointerRelease!:(estimate:StorageEstimate)=>void,beforePointer='';
 const pointerWaiting=new Promise<void>(resolve=>{pointerEntered=resolve;}),pointerQuota=new Promise<StorageEstimate>(resolve=>{pointerRelease=resolve;});
 storage.commit=async(...args:Parameters<IndexedDbE2eeStorage['commit']>)=>{
  if(args[0].some(change=>change.value?.envelope.context.objectId===stateId)){
   beforePointer=await inventoryHash();navigator.storage.estimate=async()=>{pointerEntered();return pointerQuota;};
  }
  return originalCommit(...args);
 };
 const retiredPointer=refuses(()=>migration.prepareStaged(staged,stagedOptions));
 await pointerWaiting;live=false;pointerRelease({usage:0,quota:Number.MAX_SAFE_INTEGER});const pointerRefused=await retiredPointer;
 storage.commit=originalCommit;navigator.storage.estimate=initialEstimate;live=true;
 check('retired state3 publication keeps its complete orphan source and creates no migration pointer',pointerRefused&&beforePointer===await inventoryHash()&&await migration.status()===null&&trace.length===0);
 await migration.prepareStaged(staged,stagedOptions);
 const state3=(await device.vault.read('local-snapshot',stateId))!;
 const beforeRetiredWrite=await inventoryHash(),actualEstimate=navigator.storage.estimate.bind(navigator.storage);
 let quotaEntered!:()=>void,quotaRelease!:(estimate:StorageEstimate)=>void;
 const quotaWaiting=new Promise<void>(resolve=>{quotaEntered=resolve;}),quotaResult=new Promise<StorageEstimate>(resolve=>{quotaRelease=resolve;});
 navigator.storage.estimate=async()=>{quotaEntered();return quotaResult;};
 const retiredWrite=refuses(()=>migration.prepareStreamedPlanning(options()));
 await quotaWaiting;live=false;quotaRelease({usage:0,quota:Number.MAX_SAFE_INTEGER});const retiredRefused=await retiredWrite;
 navigator.storage.estimate=actualEstimate;live=true;
 check('retired state4 pointer write refuses at actual quota boundary with state3 and transport untouched',retiredRefused&&beforeRetiredWrite===await inventoryHash()&&(await readState()).protocol===3&&trace.length===0);
 check('lost real loopback acknowledgement preserves a durable exact signed start',await refuses(()=>migration.prepareStreamedPlanning(options())));
 const prepared=await readState(),pending=prepared.pending;check('state4 has no adopted content plan or activation',prepared.protocol===4&&prepared.phase==='preparing'&&prepared.planned===false&&prepared.lease===null);
 const original=(await device.vault.read('local-snapshot',prepared.ownership.sourceState.objectId))!;
 check('raw state3 is retained byte for byte under authenticated ownership',hash(original.value)===hash(state3.value)&&hash(original.value)===prepared.ownership.sourceState.hash);original.value.fill(0);state3.value.fill(0);
 await cold();const ticket=await migration.prepareStreamedPlanning(options());
 check('cold persisted device retries exact packet and operation after lost acknowledgement',JSON.stringify(trace[0])===JSON.stringify(trace[1])&&JSON.stringify(pending)===JSON.stringify(trace[1])&&ticket.attemptId===prepared.ownership.attemptId);
 const packet=await signE2eeCommand({protocol:1,ownerId,scopeId,deviceId,action:'legacy-workspace',expectedRevision:directory.checkpoint.revision,checkpointHash:directory.checkpoint.hash,securityEpoch:directory.securityEpoch,
  operationId:crypto.randomUUID(),payload:{migrationId:ticket.migrationId,fence:ticket.fence,sourceHash:ticket.sourceHash}},device.keys().signing.privateKey);
 const read=()=>({vault:device.vault,target,capacity:options().originalCapacity,assertCurrent:current});
 const capture=await ProtectedRemoteOriginal.create({...read(),packet,signer:device.keys().signing.publicKey,generation:ticket.generation,ensureDurableKeys:()=>device.ensureDurableKeys(),admit:async()=>{}});
 const registered=capture.registration();await migration.reserveStreamedRemoteOriginal(registered,packet,options());
 check('reservation commits exact original packet before HTTP observation prepare',(await listRemoteOriginals(read())).length===0&&(await readState()).ownership.originals[0].registration.id===registered.id);
 await capture.prepare({path:'/e2ee/v1/read',method:'POST',body:JSON.stringify(packet)});await capture.begin({path:'/e2ee/v1/read',status:200,contentType:'application/json',contentLength:null});await capture.append(encoder.encode('ONLY PARTIAL ORIGINAL'));capture.close();
 const retained=await inventoryHash();await cold();const resumed=await migration.prepareStreamedPlanning(options());
 check('cold partial capture and all ciphertext remain unchanged',JSON.stringify(resumed)===JSON.stringify(ticket)&&retained===await inventoryHash());
 const descriptor=await describeRemoteOriginal(read(),registered.id);check('owned partial metadata never gains a body proof',descriptor.phase==='receiving'&&descriptor.bodyVerified===false&&await refuses(()=>withRemoteOriginal(read(),registered.id,async()=>{})));
 check('duplicate reservation refuses without rewriting prior original',await refuses(()=>migration.reserveStreamedRemoteOriginal(registered,packet,options()))&&retained===await inventoryHash());
 const foreign=await generateDeviceKeys(),foreignPacket=await signE2eeCommand({...packet.command,operationId:crypto.randomUUID()},foreign.signing.privateKey);
 const outsider=await ProtectedRemoteOriginal.create({...read(),packet:foreignPacket,signer:foreign.signing.publicKey,generation:ticket.generation,ensureDurableKeys:()=>device.ensureDurableKeys(),admit:async()=>{}});
 check('a foreign signer cannot reserve authenticated request ownership',await refuses(()=>migration.reserveStreamedRemoteOriginal(outsider.registration(),foreignPacket,options()))&&retained===await inventoryHash());outsider.close();
 check('normal run and cancellation remain closed',await refuses(()=>migration.run())&&await refuses(()=>migration.cancel())&&retained===await inventoryHash());
 const row=(await device.vault.read('local-snapshot',stateId))!,expired=await readState();expired.lease.leaseUntil=Math.floor(Date.now()/1000)-1;
 await device.vault.write([{domain:'local-snapshot',objectId:stateId,value:encoder.encode(JSON.stringify(expired)),expected:row.serial}]);row.value.fill(0);retireAction='migration-resume';
 check('late real loopback renewal cannot commit after actor retirement',await refuses(()=>migration.prepareStreamedPlanning(options()))&&retiredState===await inventoryHash());
 live=true;retireAction=null;const renewal=(await readState()).resuming;await cold();await migration.prepareStreamedPlanning(options());
 const renewals=trace.filter(value=>value.command.action==='migration-resume');check('cold renewal preserves exact original signed command',renewals.length===2&&JSON.stringify(renewals[0])===JSON.stringify(renewals[1])&&JSON.stringify(renewal)===JSON.stringify(renewals[1]));
 const tampered=(await readState()).ownership.sourceState.objectId,rawCopy=(await device.vault.read('local-snapshot',tampered))!;rawCopy.value.fill(0);
 await device.vault.write([{domain:'local-snapshot',objectId:tampered,value:encoder.encode('{}'),expected:rawCopy.serial}]);const beforeFailure=await inventoryHash(),requests=trace.length;
 check('changed raw state3 refuses before network and is never treated as empty',await refuses(()=>migration.prepareStreamedPlanning(options()))&&beforeFailure===await inventoryHash()&&trace.length===requests);
 device.lock();recovery.secret.fill(0);report.status='PASS';document.title='PASS GENESIS streamed preparation';
}catch(error){report.status='FAIL';report.error=error instanceof Error?error.stack:String(error);document.title='FAIL GENESIS streamed preparation';}
show();
