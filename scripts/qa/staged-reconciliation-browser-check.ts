import {ProtectedSourceStage,openSourceStage} from '../../app/e2ee/source-stage.ts';
import {ProtectedMigrationContentPlan,openMigrationContentPlan,type MigrationContentPlanOptions} from '../../app/e2ee/content-plan.ts';
import {E2eeMigrationSources,requiredPrivatePaths} from '../../app/e2ee/migration-sources.ts';
import type {StagedSourceInput,StagedPathReconciler} from '../../app/e2ee/staged-reconciliation.ts';
import {IndexedDbE2eeStorage,UnlockedE2eeVault} from '../../app/e2ee/storage.ts';
import {freshSecret,generateDeviceKeys} from '../../app/e2ee/keys.ts';
import {E2EE_SUITE,encodeE2eeBytes,importE2eeRoot,type E2eeContext,type E2eeEnvelope} from '../../app/e2ee/envelope.ts';
import {openE2eeFileStream} from '../../app/e2ee/files.ts';
import {openMigrationLocalContent} from '../../app/e2ee/migration-local.ts';

const report:{synthetic:boolean;runtime:string;checks:{name:string;passed:boolean}[];status?:string;stage?:string;error?:string}={synthetic:true,runtime:navigator.userAgent,checks:[]};
const progress=(stage:string)=>{report.stage=stage;report.status='RUNNING';document.querySelector('#result')!.textContent=JSON.stringify(report,null,2);};
const check=(name:string,passed:boolean)=>{report.checks.push({name,passed});progress(name);if(!passed)throw new Error(name);};
const digest=async(bytes:Uint8Array)=>{try{return encodeE2eeBytes(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes))));}finally{bytes.fill(0);}};
try{
 check('real secure WebCrypto and IndexedDB',isSecureContext&&!!crypto.subtle&&!!indexedDB);
 const storage=new IndexedDbE2eeStorage(),keys=await generateDeviceKeys(),raw=freshSecret(),localRoot=await importE2eeRoot(raw);raw.fill(0);const contentRaw=freshSecret(),root=await importE2eeRoot(contentRaw);contentRaw.fill(0);
 const actor={ownerId:'staged-browser-actor',scopeId:'device:staged-browser',deviceId:'staged-browser-device'},scope={...actor,generation:1,cryptoEpoch:1,securityEpoch:1,keyId:'local-root',signingKey:keys.signing.privateKey,
  roots:new Map([['local-root',localRoot]]),trustedSigner:(id:string)=>id===actor.deviceId?keys.signing.publicKey:undefined};
 let live=true,reconciled=false;const current=()=>{if(!live)throw new Error('E2EE_ACCOUNT_CHANGED');};let vault=new UnlockedE2eeVault(storage,scope);
 const target={ownerId:'staged-browser-owner',scopeId:'project:staged-browser',kind:'project' as const},paths=requiredPrivatePaths('project'),size=(index:number)=>index===0?2*1024*1024+17:7;
 const histories:StagedSourceInput['current'][]=[];const references=[];
 for(const seed of [1,2]){
  progress('protect complete synthetic source '+seed);const stage=await ProtectedSourceStage.create({vault,target,paths:paths.map(path=>path.id),capacity:{maximumBytes:16*1024*1024,maximumParts:128},ensureDurableKeys:async()=>{},admit:async()=>{},assertCurrent:current});
  for(const[index,path]of paths.entries())await stage.capturePath(path.id,async write=>{
   const block=new Uint8Array(65536).fill(seed+index);try{for(let at=0;at<size(index);at+=block.length)await write(block.subarray(0,Math.min(block.length,size(index)-at)));}finally{block.fill(0);}});
  const reference=await stage.finish(),opened=await openSourceStage(vault,target,reference,current);references.push(reference);
  histories.push({id:reference.stageId,target,paths:opened.paths,openPath:id=>opened.openPath(id)});
 }
 let input:StagedSourceInput={current:histories[1],previous:[histories[0]]};const lease={ownerId:target.ownerId,scopeId:target.scopeId,migrationId:crypto.randomUUID(),fence:1,
  sourceHash:await digest(new TextEncoder().encode(JSON.stringify(references))),generation:2};
 const originalKeys=await storage.list(''),fingerprints=new Map<string,string>();for(const key of originalKeys)fingerprints.set(key,await digest(new TextEncoder().encode(JSON.stringify(await storage.get(key)))));
 check('both complete protected histories exist before reconciliation',originalKeys.length>20);
 const registry=(missingHistory=false)=>{
  const sources=new E2eeMigrationSources(target.ownerId,target.scopeId,'project');
  for(const[index,path]of paths.entries()){
   const reconcile:StagedPathReconciler['reconcile']=async(originals,context,emit)=>{
    if(missingHistory&&index===0){const reader=originals.current.open();let scanned=0;for await(const bytes of reader.chunks){current();scanned+=bytes.length;}reader.assertComplete();if(scanned!==size(index))throw new Error('INCOMPLETE_ORIGINAL');return true;}
    await emit({placement:path.id.endsWith('.local-work')?'local':'remote',domain:path.domains[0] as E2eeContext['domain'],objectId:path.id,size:2*size(index),filename:'synthetic-'+index,mediaType:'application/octet-stream',source:(async function*(){
     for(const source of [originals.current,...originals.previous]){const reader=source.open();try{for await(const bytes of reader.chunks)yield bytes;reader.assertComplete();}finally{await reader.close();}}
    })()});return true;
   };sources.registerStagedReconciler({id:path.id,reconcile});
  }return sources;
 };
 const context:E2eeContext={cryptoProtocol:1,suite:E2EE_SUITE,ownerId:target.ownerId,scopeId:target.scopeId,domain:'shared-project',objectId:'plan-context',schemaVersion:1,dataGeneration:2,writerProtocol:9,
  cryptoEpoch:1,securityEpoch:1,revision:1,keyId:'content-root',deviceId:actor.deviceId,operationId:crypto.randomUUID()};
 const options:MigrationContentPlanOptions={vault,root,signer:keys.signing.publicKey,signingKey:keys.signing.privateKey,context,target,migrationId:lease.migrationId,sourceHash:lease.sourceHash,
  paths:paths.map(path=>path.id),capacity:{maximumBytes:32*1024*1024,maximumEnvelopes:256,maximumLocalParts:64},admit:async()=>{},ensureDurableKeys:async()=>{},assertCurrent:current,
  assertSourceComplete:async()=>{if(!reconciled)throw new Error('E2EE_SOURCE_INPUT_EOF_REQUIRED');}};
 progress('reconcile all originals through encrypted per-record sink');const writer=await ProtectedMigrationContentPlan.create(options),coverage=await registry().reconcileStaged(input,lease,(path,record)=>writer.append(path,record),current);
 check('all six synthetic current and history paths authenticate EOF',coverage.length===6&&coverage.every(row=>row.complete));reconciled=true;
 const reference=await writer.finish(coverage);vault.lock();const coldStorage=new IndexedDbE2eeStorage();vault=new UnlockedE2eeVault(coldStorage,scope);
 const coldHistory:StagedSourceInput['current'][]=[];for(const reference of references){const opened=await openSourceStage(vault,target,reference,current);coldHistory.push({id:reference.stageId,target,paths:opened.paths,openPath:id=>opened.openPath(id)});}
 input={current:coldHistory[1],previous:[coldHistory[0]]};
 progress('cold read verifies every logical output');const opened=await openMigrationContentPlan({...options,vault,reference});
 check('cold plan has five remote records and one local-only record',opened.logical.length===5&&opened.local.length===1&&opened.plan.length===26&&opened.plan.every(row=>row.objectId!=='project.local-work'));
 const expected:string[]=await(await fetch('/expected.json')).json();check('all six complete hashes match independent Node construction',[...opened.logical,...opened.local].every(row=>row.plaintextHash===expected[paths.findIndex(path=>path.id===row.objectId)]));
 const lookup=new Map(opened.plan.map(row=>[row.objectId,row.recordId]));const get=async(id:string)=>{const row=await vault.read('outbox',id);if(!row)throw new Error('MISSING_RECORD');try{return JSON.parse(new TextDecoder().decode(row.value)) as E2eeEnvelope;}finally{row.value.fill(0);}};
 let total=0,expired=true;
 for(const logical of opened.logical){const index=paths.findIndex(path=>path.id===logical.objectId),manifest=await get(logical.manifestRecordId);let at=0,previous:Uint8Array|undefined;
  await openE2eeFileStream({root,signer:keys.signing.publicKey,expectedContext:manifest.context,manifestEnvelope:manifest,fetchChunk:id=>get(lookup.get(id)!),assertCurrent:current,writeQuarantinedPlaintext:async bytes=>{
   if(previous)expired=expired&&previous.every(value=>value===0);for(let offset=0;offset<bytes.length;offset++)if(bytes[offset]!==index+(at+offset<size(index)?2:1))throw new Error('WRONG_ORIGINAL_BYTE');at+=bytes.length;previous=bytes;}});
  if(at!==2*size(index))throw new Error('INCOMPLETE_ORIGINAL');expired=expired&&!!previous?.every(value=>value===0);total+=at;
 }
 const local=await openMigrationLocalContent(vault,opened.local[0]);try{for(let index=0;index<local.bytes.length;index++)if(local.bytes[index]!==5+(index<7?2:1))throw new Error('WRONG_LOCAL_BYTE');total+=local.bytes.length;}finally{local.bytes.fill(0);}
 check('readback checks every current and historical byte',total===2*(size(0)+5*7));check('borrowed plaintext expires after each sink and EOF',expired);
 const sameOriginals=async()=>{for(const[key,hash]of fingerprints)if(await digest(new TextEncoder().encode(JSON.stringify(await storage.get(key))))!==hash)return false;return true;};
 check('all protected source rows survive unchanged',await sameOriginals());
 reconciled=false;let admits=0;const quota=await ProtectedMigrationContentPlan.create({...options,vault,admit:async()=>{if(++admits===4)throw new Error('E2EE_NO_SPACE');}});let refused=false;
 try{await registry().reconcileStaged(input,lease,(path,record)=>quota.append(path,record),current);}catch(error){refused=(error as Error).message==='E2EE_NO_SPACE';}
 let complete=false;try{await quota.finish(coverage);complete=true;}catch{/* Expected inert failure. */}
 check('quota failure cannot publish complete coverage or erase originals',refused&&!complete&&await sameOriginals());
 let unread=false;try{await registry(true).reconcileStaged(input,lease,async()=>{},current);}catch(error){unread=(error as Error).message==='E2EE_SOURCE_INPUT_EOF_REQUIRED';}
 check('unopened protected history refuses a false complete result',unread);
 live=false;let retired=false;try{await openMigrationContentPlan({...options,vault,reference});}catch(error){retired=(error as Error).message==='E2EE_ACCOUNT_CHANGED';}
 check('retirement refuses a complete-plan receipt',retired);vault.lock();
}catch(error){report.error=(error as Error).message.slice(0,200);}
delete report.stage;report.status=report.error||report.checks.some(row=>!row.passed)?'FAIL':'PASS';document.querySelector('#result')!.textContent=JSON.stringify(report,null,2);document.title=report.status+' GENESIS staged reconciliation';
