import {sha256} from '@noble/hashes/sha2.js';
import {E2eeMigration,type MigrationSources,type StreamedPlanningOptions,type StreamedContentPlanningOptions,type MigrationSourceContext} from '../../app/e2ee/migration.ts';
import type {MigrationContentPlanningSession} from '../../app/e2ee/content-planning-session.ts';
import {openMigrationContentPlan} from '../../app/e2ee/content-plan.ts';
import {E2EE_CHUNK_BYTES} from '../../app/e2ee/files.ts';
import {UnlockedWebDevice,IndexedDbDeviceKeyStorage} from '../../app/e2ee/device-vault.ts';
import {IndexedDbE2eeStorage} from '../../app/e2ee/storage.ts';
import {requiredPrivatePaths} from '../../app/e2ee/private-paths.ts';
import {createRecoveryKit,freshSecret,publicDeviceKeys,sealRoot} from '../../app/e2ee/keys.ts';
import {verifyDeviceDirectory} from '../../app/e2ee/directory.ts';
import {encodeE2eeBytes,importE2eeRoot,E2EE_DOMAINS} from '../../app/e2ee/envelope.ts';
import {signE2eeCommand,type SignedE2eeCommand,type WireValue} from '../../app/e2ee/commands.ts';
import {listRemoteOriginals} from '../../app/e2ee/remote-original.ts';
import {authenticatedMigrationTransport} from '../../app/e2ee/browser-transport.ts';
import {loadGenesisSession,captureAccountSessionGuard} from '../../app/cloud-sync';

// Actual authenticated browser channel/IDB; generated account, source registry,
// authority and loopback server only. No real data, activation or recovery.
const scopeKind=(new URL(location.href).searchParams.get('kind')??'personal') as 'personal'|'project'|'space';
const report:{synthetic:boolean;kind:string;runtime:string;checks:{name:string;passed:boolean}[];status?:string;error?:string}={synthetic:true,kind:scopeKind,runtime:navigator.userAgent,checks:[]};
const show=()=>{document.querySelector('#result')!.textContent=JSON.stringify(report,null,2);};
const check=(name:string,passed:boolean)=>{report.checks.push({name,passed});show();if(!passed)throw new Error(name);};
const encoder=new TextEncoder(),decoder=new TextDecoder(),digest=(bytes:Uint8Array)=>encodeE2eeBytes(sha256(bytes)),nativeFetch=globalThis.fetch.bind(globalThis);
let fixtureDevice:UnlockedWebDevice|undefined,fixtureSecret:Uint8Array|undefined;
try{
 check('secure actual WebCrypto and IndexedDB',isSecureContext&&!!crypto.subtle&&!!indexedDB);
 if(!['personal','project','space'].includes(scopeKind))throw new Error('SYNTHETIC_SCOPE_KIND');
 const ownerId='session-browser-owner',scopeId=`${scopeKind}:${ownerId}`,expectedRequests=scopeKind==='personal'?11:6;
 const readOne=(port:ReturnType<typeof authenticatedMigrationTransport>,context:MigrationSourceContext)=>scopeKind==='personal'?port.legacyWorkspace(context):port.legacySharedMindmapsPage(context,'maps',0);
 check('actual authenticated account channel initialized',(await loadGenesisSession())?.uid===ownerId);
 const account=captureAccountSessionGuard(),recovery=await createRecoveryKit(ownerId);fixtureSecret=recovery.secret;
 let storage=new IndexedDbE2eeStorage(),keys=new IndexedDbDeviceKeyStorage(),device=await UnlockedWebDevice.provision(ownerId,recovery.secret,recovery.kit,storage,keys);fixtureDevice=device;
 device.requireDurableProvider();check('product capture requires actual record and device-key providers',true);
 const deviceId=device.deviceId,pub=await publicDeviceKeys(device.keys()),raw=freshSecret(),root=await importE2eeRoot(raw),recipient={ownerId,scopeId,cryptoEpoch:1,keyId:'session-content-root',recipientId:deviceId};
 const bootstrap={protocol:1 as const,ownerId,scopeId,deviceId,action:'bootstrap',expectedRevision:0,checkpointHash:'genesis',securityEpoch:1,operationId:crypto.randomUUID(),payload:{
  kind:scopeKind,resourceId:ownerId,keyId:'session-content-root',generation:1,recoveryKit:recovery.kit,deviceKeys:pub,
  deviceCapsule:await sealRoot(raw,pub.receivingKey,recipient),recoveryCapsule:await sealRoot(raw,recovery.kit.authority.receivingKey,{...recipient,recipientId:'recovery'})}};
 raw.fill(0);const command={...bootstrap,payload:{...bootstrap.payload,selfProof:(await signE2eeCommand(bootstrap,device.keys().signing.privateKey)).signature}};
 const directory=await verifyDeviceDirectory(ownerId,scopeId,recovery.kit.authority,[await signE2eeCommand(command,recovery.keys.signing.privateKey)]);
 const registered=await nativeFetch('/actor',{method:'POST',body:JSON.stringify({ownerId,scopeId,kind:scopeKind,deviceId,signingKey:pub.signingKey,directoryRevision:directory.checkpoint.revision,checkpointHash:directory.checkpoint.hash})});if(!registered.ok)throw new Error('E2EE_SYNTHETIC_ACTOR_FAILED');
 const paths=requiredPrivatePaths(scopeKind).map(row=>row.id),target={ownerId,scopeId,kind:scopeKind};let live=true,inFence=false,fenceEntries=0,ownedBeforeFetch=0;
 const current=()=>{account();if(!live)throw new Error('E2EE_ACCOUNT_CHANGED');device.requireOpen();};
 const sources:MigrationSources={requiredCoverage:paths,allowedContentDomains:E2EE_DOMAINS.filter(domain=>requiredPrivatePaths(scopeKind).some(row=>row.domains.includes(domain))),
  assertBinding(owner,scope,kind){if(owner!==ownerId||scope!==scopeId||kind!==scopeKind)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');},
  async captureLocal(){throw new Error('E2EE_AGGREGATE_CAPTURE_FORBIDDEN');},async reconcile(){throw new Error('E2EE_AGGREGATE_RECONCILIATION_FORBIDDEN');}};
 const transport={async sourceHash(){current();return(await(await nativeFetch('/source.json')).json() as {sourceHash:string}).sourceHash;},
  async command(packet:SignedE2eeCommand):Promise<Record<string,WireValue>>{current();const response=await nativeFetch('/lease',{method:'POST',body:JSON.stringify(packet)});if(!response.ok)throw new Error('E2EE_SYNTHETIC_LEASE_FAILED');return await response.json() as Record<string,WireValue>;},async readAll(){throw new Error('E2EE_AGGREGATE_READ_FORBIDDEN');}};
 const make=()=>new E2eeMigration({vault:device.vault,directory,deviceId,signingKey:device.keys().signing.privateKey,signer:device.keys().signing.publicKey,root,sources,transport,
  ensureDurableKeys:()=>device.ensureDurableKeys(),withLocalWriteFence:async operation=>{current();if(inFence)throw new Error('E2EE_SYNTHETIC_NONREENTRANT_FENCE');inFence=true;fenceEntries++;try{return await operation();}finally{inFence=false;}},verifyRecovery:async()=>{throw new Error('E2EE_NO_PRODUCT_RECOVERY');}});
 let migration=make();const options=():StreamedPlanningOptions=>({device,capacity:{maximumBytes:32*1024*1024,maximumParts:2000,maximumMetadataBytes:8*1024*1024},
  originalCapacity:{maximumBytes:16*1024*1024,maximumParts:1000,maximumObservations:100,maximumRecords:4000,maximumMetadataBytes:4*1024*1024},assertCurrent:current,admit:async()=>current()});
 const readOriginal=()=>({vault:device.vault,target,capacity:options().originalCapacity,assertCurrent:current}),stateId='migration:'+digest(encoder.encode(scopeId));
 const readState=async()=>{const row=await device.vault.read('local-snapshot',stateId);if(!row)throw new Error('E2EE_STATE_MISSING');try{return JSON.parse(decoder.decode(row.value));}finally{row.value.fill(0);}};
 const snapshot=async()=>{const hash=sha256.create();try{for(const key of(await storage.list('')).sort())hash.update(encoder.encode(JSON.stringify([key,await storage.get(key)])));return encodeE2eeBytes(hash.digest());}finally{hash.destroy();}};
 globalThis.fetch=async(input,init)=>{
  const path=new URL(input instanceof Request?input.url:String(input),location.href).pathname;
  if(path==='/api/e2ee/v1/read'){
   current();if(!inFence||typeof init?.body!=='string')throw new Error('E2EE_SYNTHETIC_UNOWNED_HTTP');const packet=JSON.parse(init.body) as SignedE2eeCommand,state=await readState();
   const owned=state.ownership.originals.find((row:{packet:SignedE2eeCommand})=>row.packet.command.operationId===packet.command.operationId);
   if(!owned||owned.completion!==null||JSON.stringify(owned.packet)!==JSON.stringify(packet))throw new Error('E2EE_SYNTHETIC_UNRESERVED_HTTP');
   const marker=(await listRemoteOriginals(readOriginal())).find(row=>row.id===owned.registration.id);if(marker?.phase!=='registered')throw new Error('E2EE_SYNTHETIC_UNPREPARED_HTTP');ownedBeforeFetch++;
  }
  return nativeFetch(input,init);
 };
 await migration.prepareStaged({target,paths,async capturePath(path,write){await write(encoder.encode('SYNTHETIC LOCAL ORIGINAL '+path));}},{capacity:{maximumBytes:8*1024*1024,maximumParts:1000},assertCurrent:current,admit:async()=>current()});
 const entries=fenceEntries;let escaped:ReturnType<typeof authenticatedMigrationTransport>|undefined,context:Parameters<NonNullable<typeof escaped>['legacyWorkspace']>[0]|undefined;
 const receipt=await migration.withStreamedPlanning(async session=>{
  const port=authenticatedMigrationTransport(device,directory,sources,undefined,session);escaped=port;context=session.context;
  if(scopeKind==='personal'){
   for(const method of ['legacyWorkspace','legacyAurora','legacyStoicheion','legacyAdvice','legacyTasks','legacyDiary','legacyMindmaps'] as const)await port[method](session.context);
   await port.legacyMindmapsPage(session.context,'versions',128);await port.legacyPhysisPage(session.context,'records',128);await port.legacyRemindersPage(session.context,'habitDevices',128);await port.legacyArchiveFragment(session.context,'safety',0,65536);
  }else for(const table of ['maps','versions','receipts','deletions','deletionScopes','conversions'])await port.legacySharedMindmapsPage(session.context,table,0);
 },options());
 check('all scoped legacy forms are owned and prepared before fetch',ownedBeforeFetch===expectedRequests&&receipt.originals.length===expectedRequests&&receipt.originals.every(row=>row.completion!==null&&row.registration.context.kind===scopeKind));
 check('whole session takes one nonreentrant fence and releases it only after completed work',fenceEntries===entries+1&&!inFence);
 const metrics=await(await nativeFetch('/metrics.json?kind='+scopeKind)).json() as {reads:{operationId:string;rawHash:string;size:number;action:string}[]};const state=await readState();
 check('complete protected raw hashes and sizes match independently generated host bytes',metrics.reads.length===expectedRequests&&metrics.reads.every(row=>{
  const owned=state.ownership.originals.find((value:{packet:SignedE2eeCommand})=>value.packet.command.operationId===row.operationId);return owned?.completion?.rawHash===row.rawHash&&owned?.completion?.size===row.size;
 }));
 check('streamed capture receipt is immutable and never adopts a content plan or enables activation',state.protocol===4&&state.ownership.protocol===2&&!state.planned&&state.plan.length===0&&state.phase==='preparing'
  &&Object.isFrozen(receipt)&&Object.isFrozen(receipt.originals)&&receipt.originals.every(row=>Object.isFrozen(row.registration)&&Object.isFrozen(row.registration.context)&&Object.isFrozen(row.registration.binding)&&Object.isFrozen(row.completion)));
 const retained=await snapshot();let refused=false;try{await readOne(escaped!,context!);}catch(error){refused=error instanceof Error&&error.message==='E2EE_STREAMED_SESSION_CLOSED';}
 check('escaped authenticated transport is revoked without another HTTP request or local write',refused&&retained===await snapshot()&&ownedBeforeFetch===expectedRequests);
 device.lock();storage=new IndexedDbE2eeStorage();keys=new IndexedDbDeviceKeyStorage();device=await UnlockedWebDevice.unlock(ownerId,recovery.secret,storage,keys);fixtureDevice=device;migration=make();
 await migration.prepareStreamedPlanning(options());check('cold actual device unlock authenticates every bound original without rewriting ciphertext',retained===await snapshot());
 const plain=authenticatedMigrationTransport(device,directory,sources);refused=false;try{await readOne(plain,context!);}catch(error){refused=error instanceof Error&&error.message==='E2EE_STREAMED_CAPTURE_REQUIRED';}
 check('actual authenticated factory refuses legacy data without a planning session',refused&&ownedBeforeFetch===expectedRequests&&retained===await snapshot());
 for(const mode of ['duplicate','http-error']){
  await nativeFetch('/control?mode='+mode);const before=(await readState()).ownership.originals.length;let failure=false;
  try{await migration.withStreamedPlanning(async session=>{await readOne(authenticatedMigrationTransport(device,directory,sources,undefined,session),session.context);},options());}catch{failure=true;}
  const after=await readState();check(`actual ${mode} response stays completely bound despite parser or HTTP refusal`,failure&&after.ownership.originals.length===before+1&&after.ownership.originals.at(-1).completion!==null);
 }
 await nativeFetch('/control?mode=directory-error');let caught=false,failed=false;
 try{await migration.withStreamedPlanning(async session=>{
  try{await readOne(authenticatedMigrationTransport(device,directory,sources,undefined,session),session.context);}catch(error){if(!(error instanceof Error)||error.message!=='E2EE_DIRECTORY_CONFLICT')throw error;caught=true;}
 },options());}catch(error){failed=error instanceof Error&&error.message==='E2EE_DIRECTORY_CONFLICT';}
 check('caught directory header failure remains sticky after complete original binding',caught&&failed&&(await readState()).ownership.originals.at(-1).completion!==null);
 const beforeInvalid=ownedBeforeFetch;caught=false;failed=false;
 try{await migration.withStreamedPlanning(async session=>{
  const port=authenticatedMigrationTransport(device,directory,sources,undefined,session);
  try{if(scopeKind==='personal')await port.legacyMindmapsPage(session.context,'users',0);else await port.legacySharedMindmapsPage(session.context,'users',0);}catch(error){if(!(error instanceof Error)||error.message!=='E2EE_LEGACY_PAGE_INVALID')throw error;caught=true;}
 },options());}catch(error){failed=error instanceof Error&&error.message==='E2EE_LEGACY_PAGE_INVALID';}
 check('caught page preflight failure remains sticky without another HTTP request',caught&&failed&&ownedBeforeFetch===beforeInvalid);
 const finalMetrics=await(await nativeFetch('/metrics.json?kind='+scopeKind)).json() as {reads:{operationId:string;rawHash:string;size:number}[]},finalState=await readState();
 check('refused response original references match exact host body hashes',finalMetrics.reads.every(row=>{const owned=finalState.ownership.originals.find((value:{packet:SignedE2eeCommand})=>value.packet.command.operationId===row.operationId);return owned.completion.rawHash===row.rawHash&&owned.completion.size===row.size;}));
 const planOptions=():StreamedContentPlanningOptions=>({...options(),planCapacity:{maximumBytes:32*1024*1024,maximumEnvelopes:256,maximumLocalParts:256},admitPlan:async()=>current()});
 const drainLocal=async(session:MigrationContentPlanningSession)=>{
  for(const source of [session.sources.current,...session.sources.previous])for(const path of source.paths){const reader=await source.openPath(path);for await(const bytes of reader.chunks)bytes.fill(0);reader.assertComplete();}
 };
 const planBuild=async(session:MigrationContentPlanningSession)=>{
  await drainLocal(session);
  for(const[index,original]of session.originals.entries())await session.withOriginal(original.completion.id,async source=>{
   await session.emit(paths[0],{placement:'remote',domain:scopeKind==='personal'?'workspace':'shared-project',objectId:'synthetic-raw:'+index,size:original.completion.size,source});
  });
  return paths.map(domain=>({domain,complete:true}));
 };
 const planEntries=fenceEntries,planCalls=ownedBeforeFetch,planned=await migration.planStreamedContent(planBuild,planOptions()),plannedState=await readState();
 check('actual coordinator reserves and binds a complete plan in one fence without legacy HTTP or upload',fenceEntries===planEntries+1&&ownedBeforeFetch===planCalls
  &&plannedState.ownership.protocol===3&&plannedState.ownership.plans.length===1&&plannedState.ownership.plans[0].completion.manifestHash===planned.plan.manifestHash&&!plannedState.planned&&plannedState.plan.length===0);
 const manifest=await openMigrationContentPlan({vault:device.vault,root,signer:device.keys().signing.publicKey,context:plannedState.ownership.plans[0].context,target,
  migrationId:planned.ticket.migrationId,sourceHash:planned.ticket.sourceHash,paths,assertCurrent:current,reference:planned.plan});
 check('every generated plan stream has the exact complete raw-original digest including refused HTTP and JSON',manifest.logical.length===plannedState.ownership.originals.length
  &&manifest.logical.every((row,index)=>row.plaintextHash===plannedState.ownership.originals[index].completion.rawHash));
 let plannedSnapshot=await snapshot();device.lock();storage=new IndexedDbE2eeStorage();keys=new IndexedDbDeviceKeyStorage();device=await UnlockedWebDevice.unlock(ownerId,recovery.secret,storage,keys);fixtureDevice=device;migration=make();
 const reopened=await migration.planStreamedContent(async()=>{throw new Error('E2EE_SYNTHETIC_REBUILD_FORBIDDEN');},planOptions());
 check('cold actual IndexedDB reopens the exact complete plan without rewriting source or plan ciphertext',reopened.plan.manifestHash===planned.plan.manifestHash&&plannedSnapshot===await snapshot());
 await nativeFetch('/control?mode=normal');await migration.withStreamedPlanning(async session=>{await readOne(authenticatedMigrationTransport(device,directory,sources,undefined,session),session.context);},options());
 let caughtPrefix=false,prefixFailure=false;
 try{await migration.planStreamedContent(async session=>{
  await drainLocal(session);for(const original of session.originals)await session.withOriginal(original.completion.id,async input=>{for await(const bytes of input)bytes.fill(0);});
  try{await session.emit(paths[0],{placement:'remote',domain:scopeKind==='personal'?'workspace':'shared-project',objectId:'synthetic-partial',size:E2EE_CHUNK_BYTES+1,source:(async function*(){yield new Uint8Array(E2EE_CHUNK_BYTES).fill(9);throw new Error('E2EE_SYNTHETIC_LATE_TAG');})()});}
  catch(error){if(!(error instanceof Error)||error.message!=='E2EE_SYNTHETIC_LATE_TAG')throw error;caughtPrefix=true;}
  return paths.map(domain=>({domain,complete:true}));
 },planOptions());}catch(error){prefixFailure=error instanceof Error&&error.message==='E2EE_SYNTHETIC_LATE_TAG';}
 const partialState=await readState(),partialId=partialState.ownership.plans[1].attemptId;
 const partialSnapshot=async()=>{const rows=[];for(const key of(await storage.list('')).filter(key=>key.includes(partialId)).sort())rows.push([key,await storage.get(key)]);return digest(encoder.encode(JSON.stringify(rows)));};
 const keptPartial=await partialSnapshot();
 check('a caught late stream failure preserves an owned inert partial attempt in actual IndexedDB',caughtPrefix&&prefixFailure&&partialState.ownership.plans[1].completion===null
  &&(await device.vault.listLocal('outbox',partialId+':upload:')).length>0);
 device.lock();storage=new IndexedDbE2eeStorage();keys=new IndexedDbDeviceKeyStorage();device=await UnlockedWebDevice.unlock(ownerId,recovery.secret,storage,keys);fixtureDevice=device;migration=make();
 const retry=await migration.planStreamedContent(planBuild,planOptions());
 check('cold retry uses a fresh attempt and retains every failed-prefix ciphertext row',retry.plan.attemptId!==partialId&&(await readState()).ownership.plans.length===3&&keptPartial===await partialSnapshot());
 plannedSnapshot=await snapshot();const noNetwork=ownedBeforeFetch;refused=false;
 try{await migration.run();}catch(error){refused=error instanceof Error&&error.message==='E2EE_STREAMED_PLANNER_REQUIRED';}
 check('complete local plan adoption keeps run and activation gated',refused&&noNetwork===ownedBeforeFetch&&plannedSnapshot===await snapshot());
 live=false;report.status='PASS';document.title='PASS GENESIS owned migration capture';
}catch(error){report.status='FAIL';report.error=error instanceof Error?error.stack:String(error);document.title='FAIL GENESIS owned migration capture';}
finally{globalThis.fetch=nativeFetch;fixtureDevice?.lock();fixtureSecret?.fill(0);}
show();
