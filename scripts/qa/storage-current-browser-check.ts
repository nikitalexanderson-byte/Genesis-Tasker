import {sha256} from '@noble/hashes/sha2.js';
import {UnlockedWebDevice,IndexedDbDeviceKeyStorage} from '../../app/e2ee/device-vault.ts';
import {IndexedDbE2eeStorage} from '../../app/e2ee/storage.ts';
import {createRecoveryKit,freshSecret} from '../../app/e2ee/keys.ts';
import {encodeE2eeBytes,importE2eeRoot,E2EE_SUITE,type E2eeContext} from '../../app/e2ee/envelope.ts';
import {signE2eeCommand} from '../../app/e2ee/commands.ts';
import {ProtectedRemoteOriginal} from '../../app/e2ee/remote-original.ts';
import {ProtectedSourceStage} from '../../app/e2ee/source-stage.ts';
import {ProtectedMigrationContentPlan} from '../../app/e2ee/content-plan.ts';
import {requiredPrivatePaths} from '../../app/e2ee/private-paths.ts';

const report:{synthetic:boolean;runtime:string;checks:{name:string;passed:boolean}[];attempts:{name:string;failure:string;unchanged:boolean;beforeRecords:number;afterRecords:number;deviceOpen:boolean}[];status?:string;error?:string}={synthetic:true,runtime:navigator.userAgent,checks:[],attempts:[]};
const show=()=>{document.querySelector('#result')!.textContent=JSON.stringify(report,null,2);};
const check=(name:string,passed:boolean)=>{report.checks.push({name,passed});show();if(!passed)throw new Error(name);};
const utf8=new TextEncoder(),actualEstimate=navigator.storage.estimate.bind(navigator.storage);
let fixtureDevice:UnlockedWebDevice|undefined,fixtureSecret:Uint8Array|undefined;
try{
 check('actual IDB, provisioned device and quota boundary',isSecureContext&&!!indexedDB&&!!crypto.subtle);
 const store=new IndexedDbE2eeStorage(),keys=new IndexedDbDeviceKeyStorage(),kit=await createRecoveryKit('current-guard-owner');
 fixtureSecret=kit.secret;
 const device=await UnlockedWebDevice.provision('current-guard-owner',kit.secret,kit.kit,store,keys);
 fixtureDevice=device;
 await device.vault.write([{domain:'draft',objectId:'accepted-original',expected:null,value:utf8.encode('SYNTHETIC ACCEPTED ORIGINAL')}]);
 const target={ownerId:device.ownerId,scopeId:'personal:current-guard-owner',kind:'personal' as const},hash=encodeE2eeBytes(new Uint8Array(32)),migrationId=crypto.randomUUID();
 let live=true;const current=()=>{if(!live)throw new Error('E2EE_ACCOUNT_CHANGED');};
 const snapshot=async()=>{const digest=sha256.create();try{for(const key of(await store.list('')).sort())digest.update(utf8.encode(JSON.stringify([key,await store.get(key)])));return encodeE2eeBytes(digest.digest());}finally{digest.destroy();}};
 async function retireAtActualQuota(name:string,operation:()=>Promise<unknown>,retire:()=>void=()=>{live=false;},expected='E2EE_ACCOUNT_CHANGED'){
  live=true;const before=await snapshot(),beforeRecords=(await store.providerCounts()).records;let entered!:()=>void,release!:(value:StorageEstimate)=>void;
  const waiting=new Promise<void>(resolve=>{entered=resolve;}),estimate=new Promise<StorageEstimate>(resolve=>{release=resolve;});
  navigator.storage.estimate=async()=>{entered();return estimate;};
  const result=operation().then(()=>'',error=>error instanceof Error?error.message:String(error));
  await waiting;retire();release({usage:0,quota:Number.MAX_SAFE_INTEGER});const failure=await result;
  navigator.storage.estimate=actualEstimate;device.requireOpen();device.vault.assertUnlocked();
  const unchanged=before===await snapshot(),afterRecords=(await store.providerCounts()).records;
  report.attempts.push({name,failure,unchanged,beforeRecords,afterRecords,deviceOpen:true});show();
  check(name,failure===expected&&unchanged);live=true;
 }
 const packet=await signE2eeCommand({protocol:1,ownerId:target.ownerId,scopeId:target.scopeId,deviceId:device.deviceId,action:'legacy-workspace',expectedRevision:1,checkpointHash:hash,securityEpoch:1,operationId:crypto.randomUUID(),payload:{migrationId,fence:1,sourceHash:hash}},device.keys().signing.privateKey);
 const original=await ProtectedRemoteOriginal.create({vault:device.vault,target,packet,signer:device.keys().signing.publicKey,generation:2,
  capacity:{maximumBytes:128*1024*1024,maximumParts:8000,maximumObservations:1000,maximumRecords:10000,maximumMetadataBytes:16*1024*1024},
  assertCurrent:current,ensureDurableKeys:()=>device.ensureDurableKeys(),admit:async()=>current()});
 await retireAtActualQuota('raw-original prepare cannot publish after operation retirement while the vault remains open',()=>original.prepare({path:'/e2ee/v1/read',method:'POST',body:JSON.stringify(packet)}));original.close();
 const closed=await ProtectedRemoteOriginal.create({vault:device.vault,target,packet,signer:device.keys().signing.publicKey,generation:2,
  capacity:{maximumBytes:128*1024*1024,maximumParts:8000,maximumObservations:1000,maximumRecords:10000,maximumMetadataBytes:16*1024*1024},
  assertCurrent:current,ensureDurableKeys:()=>device.ensureDurableKeys(),admit:async()=>current()});
 await retireAtActualQuota('closing raw-original during quota wait cannot publish while the vault remains open',()=>closed.prepare({path:'/e2ee/v1/read',method:'POST',body:JSON.stringify(packet)}),()=>closed.close(),'E2EE_REMOTE_ORIGINAL_CLOSED');
 const paths=requiredPrivatePaths('personal').map(path=>path.id);
 await retireAtActualQuota('source-stage creation cannot publish after operation retirement while the vault remains open',()=>ProtectedSourceStage.create({vault:device.vault,target,paths,capacity:{maximumBytes:128*1024*1024,maximumParts:8000},assertCurrent:current,ensureDurableKeys:()=>device.ensureDurableKeys(),admit:async()=>current()}));
 const raw=freshSecret(),root=await importE2eeRoot(raw);raw.fill(0);
 const context:E2eeContext={cryptoProtocol:1,suite:E2EE_SUITE,ownerId:target.ownerId,scopeId:target.scopeId,domain:'workspace',objectId:'guard-plan',schemaVersion:1,dataGeneration:2,writerProtocol:9,cryptoEpoch:1,securityEpoch:1,revision:1,keyId:'guard-content-root',deviceId:device.deviceId,operationId:crypto.randomUUID()};
 await retireAtActualQuota('content-plan creation cannot publish after operation retirement while the vault remains open',()=>ProtectedMigrationContentPlan.create({vault:device.vault,target,root,signer:device.keys().signing.publicKey,signingKey:device.keys().signing.privateKey,context,migrationId,sourceHash:hash,paths,capacity:{maximumBytes:128*1024*1024,maximumEnvelopes:8000,maximumLocalParts:8000},assertCurrent:current,ensureDurableKeys:()=>device.ensureDurableKeys(),admit:async()=>current(),assertSourceComplete:async()=>current()}));
 const beforeCursor=await snapshot(),openCursor=IDBObjectStore.prototype.openCursor,abort=new DOMException('synthetic-current-retired','AbortError');let retiredAtCursor=false;
 IDBObjectStore.prototype.openCursor=function(...args:Parameters<IDBObjectStore['openCursor']>){
  const request=openCursor.apply(this,args);request.addEventListener('success',()=>{retiredAtCursor=true;},{once:true});return request;
 };
 let cursorFailure:unknown;
 try{await device.vault.write([{domain:'draft',objectId:'cursor-retired',expected:null,value:utf8.encode('SYNTHETIC NEVER COMMITTED')}],()=>{if(retiredAtCursor)throw abort;});}
 catch(error){cursorFailure=error;}finally{IDBObjectStore.prototype.openCursor=openCursor;}
 check('actual cursor callback aborts the transaction and preserves trusted AbortError identity',retiredAtCursor&&cursorFailure===abort&&beforeCursor===await snapshot());
 report.status='PASS';document.title='PASS GENESIS operation write guards';
}catch(error){report.status='FAIL';report.error=error instanceof Error?error.stack:String(error);document.title='FAIL GENESIS operation write guards';}
finally{navigator.storage.estimate=actualEstimate;fixtureDevice?.lock();fixtureSecret?.fill(0);}
show();
