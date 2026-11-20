import {E2eeMigration} from '../../app/e2ee/migration.ts';
import {E2eeMigrationSources} from '../../app/e2ee/migration-sources.ts';
import {ProtectedSourceStage,inspectSourceStages,openSourceStage} from '../../app/e2ee/source-stage.ts';
import {IndexedDbE2eeStorage,type E2eeRecordStorage,type StorageChange} from '../../app/e2ee/storage.ts';
import {UnlockedWebDevice,IndexedDbDeviceKeyStorage} from '../../app/e2ee/device-vault.ts';
import {createRecoveryKit,publicDeviceKeys,freshSecret,sealRoot} from '../../app/e2ee/keys.ts';
import {verifyDeviceDirectory,type VerifiedDirectory} from '../../app/e2ee/directory.ts';
import {signE2eeCommand,type E2eeCommand} from '../../app/e2ee/commands.ts';
import {importE2eeRoot} from '../../app/e2ee/envelope.ts';
import {E2EE_CHUNK_BYTES} from '../../app/e2ee/files.ts';

const report:{synthetic:boolean;runtime:string;checks:{name:string;passed:boolean}[];error?:string;status?:string}={synthetic:true,runtime:navigator.userAgent,checks:[]};
const check=(name:string,passed:boolean)=>{report.checks.push({name,passed});if(!passed)throw new Error(name);};
async function refuses(name:string,code:string,work:()=>Promise<unknown>){let actual='';try{await work();}catch(error){actual=(error as Error).message;}check(name,actual===code);}
class FaultStorage implements E2eeRecordStorage {
 readonly base=new IndexedDbE2eeStorage();pointerFailure:'before'|'after'|null=null;
 get(key:string){return this.base.get(key);}list(prefix:string){return this.base.list(prefix);}
 async commit(changes:StorageChange[],signal?:AbortSignal){
  const pointer=changes.some(row=>row.value?.envelope.context.objectId.startsWith('migration:')),failure=pointer?this.pointerFailure:null;
  if(failure==='before'){this.pointerFailure=null;throw new Error('E2EE_LOCAL_CONFLICT');}
  await this.base.commit(changes,signal);if(failure==='after'){this.pointerFailure=null;throw new Error('SYNTHETIC_POINTER_DEATH');}
 }
}
let device:UnlockedWebDevice|undefined,kit:Awaited<ReturnType<typeof createRecoveryKit>>|undefined,authority:Awaited<ReturnType<typeof createRecoveryKit>>|undefined,targetSecret:Uint8Array|undefined;
try{
 check('actual secure WebCrypto and IndexedDB',isSecureContext&&!!crypto.subtle&&!!indexedDB);
 kit=await createRecoveryKit('stage-coordinator-browser-'+crypto.randomUUID());authority=await createRecoveryKit('content-owner');
 let storage=new FaultStorage();device=await UnlockedWebDevice.provision(kit.kit.ownerId,kit.secret,kit.kit,storage,new IndexedDbDeviceKeyStorage());
 let live=true,network=0,producers=0;const current=()=>{if(!live)throw new Error('E2EE_ACCOUNT_CHANGED');device!.requireOpen();};
 targetSecret=freshSecret();const root=await importE2eeRoot(targetSecret),publicKeys=await publicDeviceKeys(device.keys());
 async function directory(scopeId:string):Promise<VerifiedDirectory>{
  const command:E2eeCommand={protocol:1,ownerId:'content-owner',scopeId,deviceId:device!.deviceId,action:'bootstrap',expectedRevision:0,checkpointHash:'genesis',securityEpoch:1,operationId:'bootstrap',payload:{
   kind:'project',resourceId:scopeId.slice('project:'.length),keyId:'target-one',generation:1,recoveryKit:authority!.kit,deviceKeys:publicKeys,
   deviceCapsule:await sealRoot(targetSecret!,publicKeys.receivingKey,{ownerId:'content-owner',scopeId,cryptoEpoch:1,keyId:'target-one',recipientId:device!.deviceId}),
   recoveryCapsule:await sealRoot(targetSecret!,authority!.kit.authority.receivingKey,{ownerId:'content-owner',scopeId,cryptoEpoch:1,keyId:'target-one',recipientId:'recovery'})}};
  command.payload.selfProof=(await signE2eeCommand(command,device!.keys().signing.privateKey)).signature;
  return verifyDeviceDirectory('content-owner',scopeId,authority!.kit.authority,[await signE2eeCommand(command,authority!.keys.signing.privateKey)]);
 }
 const transport={async sourceHash():Promise<string>{network++;throw new Error('FORBIDDEN_TRANSPORT');},async command():Promise<never>{network++;throw new Error('FORBIDDEN_TRANSPORT');},async readAll():Promise<never>{network++;throw new Error('FORBIDDEN_TRANSPORT');}};
 const options={capacity:{maximumBytes:24*1024*1024,maximumParts:128},assertCurrent:current,async admit(request:{metadataBytes:number}){
  const estimate=await navigator.storage.estimate();current();if(estimate.quota===undefined||estimate.usage===undefined||estimate.quota-estimate.usage<2*E2EE_CHUNK_BYTES+2*request.metadataBytes)throw new Error('E2EE_SOURCE_STAGE_CAPACITY');}};
 const make=(verified:VerifiedDirectory,sources:E2eeMigrationSources)=>new E2eeMigration({vault:device!.vault,directory:verified,deviceId:device!.deviceId,signingKey:device!.keys().signing.privateKey,signer:device!.keys().signing.publicKey,
  root,transport,sources,ensureDurableKeys:()=>device!.ensureDurableKeys(),withLocalWriteFence:async operation=>operation(),verifyRecovery:async()=>{throw new Error('NO_ACTIVATION');}});
 function registry(scopeId:string,producer?:(id:string,write:(bytes:Uint8Array)=>Promise<void>)=>Promise<void>){
  const sources=new E2eeMigrationSources('content-owner',scopeId,'project');for(const id of sources.requiredCoverage)sources.registerStream({id,async captureLocal(write){producers++;current();
   if(producer)await producer(id,write);else await write(new TextEncoder().encode('original:'+id));current();}});return sources;
 }
 const scope='project:stage-browser-large',verified=await directory(scope),length=17*1024*1024+7;
 const sources=registry(scope,async(id,write)=>{
  if(id!=='project.content'){await write(new TextEncoder().encode('original:'+id));return;}
  const buffer=new Uint8Array(65536);let at=0;
  try{while(at<length){const size=Math.min(buffer.length,length-at);for(let index=0;index<size;index++)buffer[index]=((at+index)*31)&255;await write(buffer.subarray(0,size));at+=size;}}
  finally{buffer.fill(0);}
 });
 await make(verified,sources).prepareStaged(sources.stagedCapture(),options);let state=await make(verified,sources).status();
 check('all six project paths publish explicit v3 without legacy empty snapshot fields',state?.protocol===3&&state.source.paths.length===6&&!Object.hasOwn(state,'snapshotParts'));
 check('source publication precedes every transport call',network===0&&producers===6);
 const retainedState=state;if(retainedState?.protocol!==3)throw new Error('NO_V3_SOURCE');
 device.lock();storage=new FaultStorage();device=await UnlockedWebDevice.unlock(kit.kit.ownerId,kit.secret,storage,new IndexedDbDeviceKeyStorage());
 state=await make(verified,sources).status();check('cold device bundle and IDB connection reopen the exact coordinator reference',state?.protocol===3&&state.source.reference.manifestHash===retainedState.source.reference.manifestHash);
 if(state?.protocol!==3)throw new Error('NO_COLD_SOURCE');
 check('content owner remains separate from original device actor',state.source.target.ownerId==='content-owner'&&state.source.actor.ownerId===kit.kit.ownerId);
 const opened=await openSourceStage(device.vault,state.source.target,state.source.reference,current);
 for(const id of opened.paths){
  const reader=opened.openPath(id),expected=new TextEncoder().encode('original:'+id);let at=0,exact=true;
  for await(const chunk of reader.chunks){for(let index=0;index<chunk.length;index++)if(chunk[index]!==(id==='project.content'?((at+index)*31&255):expected[at+index]))exact=false;at+=chunk.length;}
  reader.assertComplete();check('entire cold original source '+id,exact&&at===(id==='project.content'?length:new TextEncoder().encode('original:'+id).length));
 }
 await refuses('v3 never enters the aggregate legacy planner','E2EE_STREAMED_PLANNER_REQUIRED',()=>make(verified,sources).run());
 for(const failure of ['before','after'] as const){
  const localScope='project:stage-browser-'+failure,localDirectory=await directory(localScope),localSources=registry(localScope);storage.pointerFailure=failure;
  await refuses('pointer '+failure+' failure is explicit',failure==='before'?'E2EE_LOCAL_CONFLICT':'SYNTHETIC_POINTER_DEATH',()=>make(localDirectory,localSources).prepareStaged(localSources.stagedCapture(),options));
  if(failure==='before'){
   check('lost CAS publishes no pointer',await make(localDirectory,localSources).status()===null);
   const orphan=(await inspectSourceStages(device.vault,{ownerId:'content-owner',scopeId:localScope,kind:'project'},current))[0];
   await make(localDirectory,localSources).prepareStaged(localSources.stagedCapture(),options);const next=await make(localDirectory,localSources).status();
   check('next pointer retains the complete orphan as source history',orphan.complete&&next?.protocol===3&&next.source.history.length===1&&next.source.history[0].stageId===orphan.id);
  }else{
   const before=producers;await refuses('accepted pointer prevents replacement capture','E2EE_MIGRATION_ALREADY_PREPARED',()=>make(localDirectory,localSources).prepareStaged(localSources.stagedCapture(),options));
   check('lost return keeps a readable v3 pointer and original producers are not replayed',(await make(localDirectory,localSources).status())?.protocol===3&&producers===before);
  }
 }
 const failedScope='project:stage-browser-partial',failedDirectory=await directory(failedScope),failedSources=registry(failedScope,async(_,write)=>{await write(new Uint8Array(E2EE_CHUNK_BYTES).fill(47));throw new Error('SYNTHETIC_LATE_TAG');});
 await refuses('late source tag cannot publish a pointer','SYNTHETIC_LATE_TAG',()=>make(failedDirectory,failedSources).prepareStaged(failedSources.stagedCapture(),options));
 const before=producers,replacement=registry(failedScope);await refuses('an incomplete prefix blocks the next source capture','E2EE_SOURCE_STAGE_HISTORY_REVIEW_REQUIRED',()=>make(failedDirectory,replacement).prepareStaged(replacement.stagedCapture(),options));
 check('incomplete source is retained and no replacement producer or transport runs',producers===before&&network===0&&(await inspectSourceStages(device.vault,{ownerId:'content-owner',scopeId:failedScope,kind:'project'},current))[0].complete===false);
 const raceScope='project:stage-browser-catalogue-race',raceDirectory=await directory(raceScope),raceSources=registry(raceScope),raceTarget={ownerId:'content-owner',scopeId:raceScope,kind:'project' as const};let injected=false;
 const raceOptions={...options,async admit(request:{metadataBytes:number}){
  await options.admit(request);const known=await inspectSourceStages(device!.vault,raceTarget,current);
  if(!injected&&known.length===1&&known[0].complete){injected=true;await ProtectedSourceStage.create({vault:device!.vault,target:raceTarget,paths:raceSources.requiredCoverage,capacity:options.capacity,
   assertCurrent:current,ensureDurableKeys:async()=>{current();},admit:async()=>{current();}});}
 }};
 await refuses('catalogue race during publication cannot bypass the atomic IDB compare','E2EE_LOCAL_CONFLICT',()=>make(raceDirectory,raceSources).prepareStaged(raceSources.stagedCapture(),raceOptions));
 const raced=await inspectSourceStages(device.vault,raceTarget,current);check('catalogue race retains both attempts without publishing a pointer',injected&&raced.length===2&&raced[0].complete&&!raced[1].complete&&await make(raceDirectory,raceSources).status()===null);
 await refuses('the raced incomplete original still blocks the next attempt','E2EE_SOURCE_STAGE_HISTORY_REVIEW_REQUIRED',()=>make(raceDirectory,raceSources).prepareStaged(raceSources.stagedCapture(),options));
 live=false;await refuses('retired actor cannot begin source publication','E2EE_ACCOUNT_CHANGED',()=>make(verified,sources).prepareStaged(sources.stagedCapture(),options));
}catch(error){report.error=(error as Error).message.slice(0,180);}finally{device?.lock();kit?.secret.fill(0);authority?.secret.fill(0);targetSecret?.fill(0);}
report.status=report.error||report.checks.some(row=>!row.passed)?'FAIL':'PASS';document.querySelector('#result')!.textContent=JSON.stringify(report,null,2);document.title=report.status+' GENESIS staged coordinator';
