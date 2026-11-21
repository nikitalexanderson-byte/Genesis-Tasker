import {IndexedDbDeviceKeyStorage,UnlockedWebDevice} from '../../app/e2ee/device-vault.ts';
import {IndexedDbOriginalCustodyStorage} from '../../app/e2ee/original-custody-storage.ts';
import {ORIGINAL_CUSTODY_PURPOSE,recoverOriginalCustody,recoverOriginalCustodyById,type OriginalCustodyReference} from '../../app/e2ee/original-custody.ts';
import {openE2eeDatabase,IndexedDbE2eeStorage} from '../../app/e2ee/storage.ts';
import {createRecoveryKit,freshSecret,openBundle} from '../../app/e2ee/keys.ts';
import {ProtectedSourceStage,type SourceStageReference,type SourceStageTarget} from '../../app/e2ee/source-stage.ts';
import type {RecoveryKit,PublicDeviceKeys} from '../../app/e2ee/keys.ts';
import {decodeE2eeBytes} from '../../app/e2ee/envelope.ts';

const report:{synthetic:boolean;runtime:string;checks:{name:string;passed:boolean}[];status?:string;error?:string}={synthetic:true,runtime:navigator.userAgent,checks:[]};
const check=(name:string,passed:boolean)=>{report.checks.push({name,passed});if(!passed)throw new Error(name);};
async function refused(job:()=>Promise<unknown>,code='E2EE_'){try{const value=await job();(value as {close?:()=>void})?.close?.();return false;}catch(error){return (error as Error).message.startsWith(code);}}
async function rawWrite(key:string,value:unknown,remove=false){
 const db=await openE2eeDatabase();try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction('keyMaterial','readwrite',{durability:'strict'});if(remove)tx.objectStore('keyMaterial').delete(key);else tx.objectStore('keyMaterial').put(value,key);tx.oncomplete=()=>resolve();tx.onabort=tx.onerror=()=>reject(new Error('SYNTHETIC_RAW_WRITE_FAILED'));});}finally{db.close();}
}
async function rawRead(key:string){
 const db=await openE2eeDatabase();try{return await new Promise<{reference?:OriginalCustodyReference}|undefined>((resolve,reject)=>{const tx=db.transaction('keyMaterial','readonly'),request=tx.objectStore('keyMaterial').get(key);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(new Error('SYNTHETIC_RAW_READ_FAILED'));});}finally{db.close();}
}
async function snapshot(records:IndexedDbE2eeStorage){const keys=await records.list('');return JSON.stringify(await Promise.all(keys.map(async key=>({key,row:await records.get(key)}))))}
async function consume(handle:Awaited<ReturnType<typeof recoverOriginalCustody>>,target:SourceStageTarget,reference:SourceStageReference,size:number){
 const stage=await handle.openStage(target,reference);try{const input=stage.openPath('project.content');let at=0,previous:Uint8Array|undefined;
  for await(const bytes of input.chunks){if(bytes.length>256*1024||bytes.some((byte,index)=>byte!==(at+index)%251)||previous&&!previous.every(byte=>byte===0))throw new Error('SYNTHETIC_ORIGINAL_MISMATCH');at+=bytes.length;previous=bytes;}
  input.assertComplete();if(at!==size||!previous?.every(byte=>byte===0))throw new Error('SYNTHETIC_ORIGINAL_EOF');
 }finally{stage.close();}
}
let old:UnlockedWebDevice|undefined,fresh:UnlockedWebDevice|undefined,secret:Uint8Array|undefined;
try{
 check('actual secure WebCrypto and IndexedDB',isSecureContext&&!!crypto.subtle&&!!indexedDB);
 const owner='browser-custody-'+crypto.randomUUID(),recovery=await createRecoveryKit(owner);secret=recovery.secret;
 const records=new IndexedDbE2eeStorage(),keyStorage=new IndexedDbDeviceKeyStorage(),custody=new IndexedDbOriginalCustodyStorage();
 old=await UnlockedWebDevice.provision(owner,secret,recovery.kit,records,keyStorage);old.requireDurableProvider();
 let live=true;const current=()=>{if(!live)throw new Error('E2EE_ACCOUNT_CHANGED');};
 const target:SourceStageTarget={ownerId:'separate-project-owner',scopeId:'project:actual-custody',kind:'project'},size=2*1024*1024+17;
 const stage=await ProtectedSourceStage.create({vault:old.vault,target,paths:['project.content'],capacity:{maximumBytes:4*1024*1024,maximumParts:32},assertCurrent:current,ensureDurableKeys:()=>old!.ensureDurableKeys(),admit:async()=>{}});
 await stage.capturePath('project.content',async write=>{const bytes=new Uint8Array(65536);try{for(let at=0;at<size;at+=bytes.length){const count=Math.min(bytes.length,size-at);for(let index=0;index<count;index++)bytes[index]=(at+index)%251;await write(bytes.subarray(0,count));}}finally{bytes.fill(0);}});
 const stageReference=await stage.finish(),before=await snapshot(records),count=await records.providerCounts();
 const reference=await old.preserveOriginalSources(secret,recovery.kit,current),after=await records.providerCounts();
 check('product custody is durable in admitted keyMaterial and increases actual provider key count exactly once',count.keyRecords===1&&after.keyRecords===2&&JSON.stringify(await custody.list(owner,current))===JSON.stringify([reference.id]));
 const artifact=await custody.get(owner,reference.id,current);if(!artifact)throw new Error('SYNTHETIC_CUSTODY_MISSING');
 check('complete public custody reference is durable outside the original root',JSON.stringify((await rawRead(reference.id))?.reference)===JSON.stringify(reference));
 const clear=await openBundle(owner,ORIGINAL_CUSTODY_PURPOSE,secret,artifact.bundle);try{
  const payload=JSON.parse(new TextDecoder().decode(clear));check('owner artifact carries root and authority certificate without old private signing identity',JSON.stringify(Object.keys(payload).sort())===JSON.stringify(['certificate','protocol','root'])&&!new TextDecoder().decode(clear).includes('signingPrivate'));
 }finally{clear.fill(0);}
 check('custody discovery is owner-only before any body read',(await custody.list('foreign-owner',current)).length===0&&await refused(()=>custody.get('foreign-owner',reference.id,current)));
 check('create-only conflict preserves the exact accepted artifact',await refused(()=>custody.create(owner,artifact,current,reference),'E2EE_DEVICE_ALREADY_EXISTS')&&JSON.stringify(await custody.get(owner,reference.id,current))===JSON.stringify(artifact));
 const oldId=old.deviceId;old.lock();await rawWrite(owner,undefined,true);
 fresh=await UnlockedWebDevice.provision(owner,secret,recovery.kit,new IndexedDbE2eeStorage(),new IndexedDbDeviceKeyStorage());
 check('after losing original key bundle the fresh actual device has an independent signing identity',fresh.deviceId!==oldId);
 const input={ownerId:owner,primaryPin:recovery.kit.authority,recoveryKit:recovery.kit,secret,reference,storage:new IndexedDbOriginalCustodyStorage(),records:new IndexedDbE2eeStorage(),assertCurrent:current};
 const restored=await recoverOriginalCustody(input);await consume(restored,target,stageReference,size);
 const [discoveredId]=await custody.list(owner,current),discovered=await recoverOriginalCustodyById({ownerId:owner,primaryPin:recovery.kit.authority,recoveryKit:recovery.kit,secret,id:discoveredId,storage:custody,records:new IndexedDbE2eeStorage(),assertCurrent:current});
 await consume(discovered,target,stageReference,size);discovered.close();check('owner-only discovery recovers without the old key bundle or an in-memory custody reference',discoveredId===reference.id);
 check('cold actual IDB recovery reads full multi-chunk original after old key loss without rewriting source ciphertext',await snapshot(records)===before);
 check('recovered capability exposes only reference openStage openLegacy close',JSON.stringify(Object.keys(restored).sort())===JSON.stringify(['close','openLegacy','openStage','reference'])&&Object.isFrozen(restored));
 const active=await restored.openStage(target,stageReference),reader=active.openPath('project.content'),first=await reader.chunks.next();if(first.done)throw new Error('SYNTHETIC_MISSING_SOURCE');restored.close();
 check('recovery close wipes borrowed bytes and denies any further read',first.value.every(byte=>byte===0)&&await refused(()=>reader.chunks.next(),'E2EE_ORIGINAL_SOURCE_CLOSED'));
 const other=await createRecoveryKit(owner);let rejected=true;
 for(const changed of [{secret:freshSecret()},{primaryPin:{...input.primaryPin,signingKey:other.kit.authority.signingKey}},{primaryPin:{...input.primaryPin,receivingKey:other.kit.authority.receivingKey}},
  {recoveryKit:other.kit,secret:other.secret},{primaryPin:other.kit.authority,recoveryKit:other.kit,secret:other.secret}])rejected=await refused(()=>recoverOriginalCustody({...input,...changed}))&&rejected;
 other.secret.fill(0);check('wrong recovery secret either changed primary pin and same-owner project authority refuse',rejected&&await snapshot(records)===before);
 const tampered=structuredClone(artifact);tampered.bundle.ciphertext=tampered.bundle.ciphertext.slice(0,-2)+'AA';await rawWrite(reference.id,{serial:1,artifact:tampered,reference});
 check('tampered stored artifact refuses without fallback to an empty successful recovery',await refused(()=>recoverOriginalCustody(input))&&await snapshot(records)===before);await rawWrite(reference.id,{serial:1,artifact,reference});
 await rawWrite(reference.id,undefined);check('an existing undefined custody row is corruption and cannot be overwritten',await refused(()=>custody.get(owner,reference.id,current))&&await refused(()=>custody.create(owner,artifact,current,reference),'E2EE_DEVICE_ALREADY_EXISTS'));await rawWrite(reference.id,{serial:1,artifact,reference});
 const supplied={...input,primaryPin:{...input.primaryPin},reference:structuredClone(reference),secret:new Uint8Array(secret)};
 const pending=recoverOriginalCustody(supplied);supplied.secret.fill(0);supplied.primaryPin.signingKey='invalid';(supplied.reference as {signer:string}).signer='invalid';supplied.assertCurrent=()=>{throw new Error('REPLACED_GUARD');};
 const captured=await pending;await consume(captured,target,stageReference,size);captured.close();check('trust coordinates secrets and guards are captured before actual storage awaits',true);
 const originalEstimate=navigator.storage.estimate.bind(navigator.storage),descriptor=Object.getOwnPropertyDescriptor(navigator.storage,'estimate');
 const restoreEstimate=()=>{if(descriptor)Object.defineProperty(navigator.storage,'estimate',descriptor);else delete (navigator.storage as unknown as {estimate?:unknown}).estimate;};
 try{
  Object.defineProperty(navigator.storage,'estimate',{configurable:true,value:async()=>({usage:0,quota:0})});const keysBefore=await records.providerCounts();
  const denied=await refused(()=>fresh!.preserveOriginalSources(secret!,recovery.kit,current),'E2EE_STORAGE_CAPACITY');
  check('actual quota refusal publishes no custody artifact and retains originals',denied&&(await records.providerCounts()).keyRecords===keysBefore.keyRecords&&await snapshot(records)===before);
 }finally{restoreEstimate();}
 try{
  Object.defineProperty(navigator.storage,'estimate',{configurable:true,value:async()=>{const value=await originalEstimate();live=false;return value;}});const countBefore=await records.providerCounts();
  const denied=await refused(()=>fresh!.preserveOriginalSources(secret!,recovery.kit,current),'E2EE_ACCOUNT_CHANGED');live=true;
  check('retirement after quota await refuses before the real IDB transaction',denied&&(await records.providerCounts()).keyRecords===countBefore.keyRecords&&await snapshot(records)===before);
 }finally{live=true;restoreEstimate();}
 // Recovery material is still supplied separately; the old protected device row
 // has remained absent even while a fresh unrelated device is active.
 const final=await recoverOriginalCustody(input);await consume(final,target,stageReference,size);final.close();
 check('fresh identity remains usable and source ciphertext remains exact after every refusal',fresh.deviceId!==oldId&&await snapshot(records)===before);
 // Preserve only synthetic interoperability metadata via the loopback host.
 const vector=await fetch('/web.json').then(response=>response.json()) as {ownerId:string;primaryPin:PublicDeviceKeys;recoveryKit:RecoveryKit;secret:string;reference:OriginalCustodyReference;artifact:NonNullable<typeof artifact>;target:SourceStageTarget;stageReference:SourceStageReference;records:{key:string;serial:number;envelope:unknown}[]};
 const readOnly={get:async(key:string)=>vector.records.find(row=>row.key===key)??null,list:async(prefix:string)=>vector.records.map(row=>row.key).filter(key=>key.startsWith(prefix))};
 const publicSecret=decodeE2eeBytes(vector.secret,32);
 try{const port={get:async()=>vector.artifact,describe:async()=>vector.reference,create:async()=>{throw new Error('FORBIDDEN');},list:async()=>[vector.reference.id]};
  const handle=await recoverOriginalCustody({...vector,secret:publicSecret,storage:port,records:readOnly as unknown as IndexedDbE2eeStorage,assertCurrent:()=>{}});handle.close();check('persisted WebCrypto vector has a valid owner certificate and purpose binding',true);
 }finally{publicSecret.fill(0);}
}catch(error){report.error=(error as Error).message.slice(0,200);}
finally{old?.lock();fresh?.lock();secret?.fill(0);}
report.status=report.error||report.checks.some(row=>!row.passed)?'FAIL':'PASS';document.querySelector('#result')!.textContent=JSON.stringify(report,null,2);document.title=report.status+' GENESIS original custody';
