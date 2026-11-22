import {sha256} from '@noble/hashes/sha2.js';
import {canonicalE2eeValue,type SignedE2eeCommand,type WireValue} from './commands.ts';
import {encodeE2eeBytes,type E2eeContext} from './envelope.ts';
import {assertTechnical,exactKeys,openRoot,publicDeviceKeys} from './keys.ts';
import {signingPublicKey} from './directory.ts';
import {parseLegacyMigrationJson} from './legacy-json.ts';
import {requiredPrivatePaths} from './private-paths.ts';
import {validateStagedMigrationSnapshot} from './migration-stage.ts';
import {inspectSourceStages,openSourceStage,authenticateInterruptedSourceStage,type SourceStageTarget} from './source-stage.ts';
import {openLegacyMigrationSnapshot,captureLegacyMigrationSnapshotReference} from './legacy-snapshot-stream.ts';
import {validateStreamedPlanningOwnership} from './migration-ownership.ts';
import {authenticateRemoteOriginalRegistration,describeRemoteOriginal,listRemoteOriginals,withRemoteOriginal,type RemoteOriginalReadOptions} from './remote-original.ts';
import {inspectMigrationContentPlanAttempt,openMigrationContentPlan,retainedMigrationPlanValues} from './content-plan.ts';
import {authenticateRetainedMigrationControls,inspectRetainedLegacyPlan,type RetainedMigrationFrame} from './retained-migration-proof.ts';
import {E2EE_PROVIDER_STORAGE_BUDGET} from './storage-capacity.ts';
import {inspectRetainedProductCustody} from './retained-product-custody.ts';
import {retainedMigrationValueCollector} from './retained-migration-values.ts';
import type {UnlockedWebDevice} from './device-vault.ts';
import type {UnlockedE2eeVault} from './storage.ts';
import type {MigrationState} from './migration.ts';

type Identity=Readonly<{ownerId:string;scopeId:string;deviceId:string}>;
type Row=Readonly<{domain:E2eeContext['domain'];id:string;serial:number;hash:string;bytes:number}>;
type Frame=RetainedMigrationFrame;
type Scope=Readonly<{target:SourceStageTarget;resourceId:string;stateId:string;root:MigrationState|null;ancestors:readonly MigrationState[]}>;
type Role=Readonly<{scopeId:string;role:string}>;
export type MigrationOwnershipUsage=Readonly<{bytes:number;records:number;metadataBytes:number;scopes:number}>;
type Options={device:UnlockedWebDevice;decode:(bytes:Uint8Array)=>MigrationState;assertCurrent:()=>void;
 capacity:Readonly<{maximumBytes:number;maximumParts:number;maximumMetadataBytes:number}>;
 originalCapacity:RemoteOriginalReadOptions['capacity'];admit:(usage:MigrationOwnershipUsage)=>Promise<void>};
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
const hash=(bytes:Uint8Array)=>encodeE2eeBytes(sha256(bytes));
const key=(domain:E2eeContext['domain'],id:string)=>domain+'\0'+id;
function invalid():never{throw new Error('E2EE_MIGRATION_HISTORY_REVIEW_REQUIRED');}
function same(left:unknown,right:unknown){const a=canonicalE2eeValue(left as WireValue),b=canonicalE2eeValue(right as WireValue);try{return a.length===b.length&&a.every((byte,at)=>byte===b[at]);}finally{a.fill(0);b.fill(0);}}
function anchor(state:MigrationState){return state.protocol===5?{hash:state.adopted.checkpointHash,revision:state.adopted.directoryRevision}:{hash:state.checkpointHash,revision:state.directoryRevision};}
function binding(state:MigrationState){return [state.migrationId,state.ancestors,state.protocol>=3&&'source'in state?state.source:{parts:'snapshotParts'in state?state.snapshotParts:null,size:'snapshotSize'in state?state.snapshotSize:null,hash:'snapshotHash'in state?state.snapshotHash:null}];}

/** Read-only proof of EVERY discovered migration owner/role. It has no writer,
 * replay, downgrade, filtering or deletion API. A namespace match is not an
 * admission: exact signed owners, full source EOF and plan/original inventories
 * must all succeed before this capability is returned. */
export async function openMigrationOwnershipCatalogue(source:Options){
 const options={...source,capacity:{...source.capacity},originalCapacity:{...source.originalCapacity}},device=options.device,base=device.vault;
 const identity:Identity=Object.freeze({...base.localIdentity()}),rows=new Map<string,Row>(),roles=new Map<string,Role>(),lists=new Map<string,string[]>();
 let closed=false,totalBytes=0,metadataBytes=0,roleContext:Role|null=null;
 const metadataRows=new Set<string>();
 const current=()=>{options.assertCurrent();device.requireOpen();base.assertUnlocked();if(closed)throw new Error('E2EE_MIGRATION_HISTORY_CLOSED');const actor=base.localIdentity();if(actor.ownerId!==identity.ownerId||actor.scopeId!==identity.scopeId||actor.deviceId!==identity.deviceId)invalid();};
 current();for(const amount of Object.values(options.capacity))if(!Number.isSafeInteger(amount)||amount<1)invalid();
 if(options.capacity.maximumParts>10000||options.capacity.maximumMetadataBytes>128*1024*1024)invalid();
 const claim=(domain:E2eeContext['domain'],id:string,scopeId:string,role:string)=>{
  assertTechnical(id);assertTechnical(scopeId);const coordinate=key(domain,id),old=roles.get(coordinate);
  if(old&&old.scopeId!==scopeId)invalid();
  if(old&&old.role!==role&&old.role!=='authenticated-source'&&role!=='authenticated-source')invalid();
  if(!old||old.role==='authenticated-source')roles.set(coordinate,Object.freeze({scopeId,role}));
  if(domain==='outbox'&&role!=='authenticated-source'&&role!=='product-cipher'&&!metadataRows.has(coordinate)){
   const row=rows.get(coordinate);if(row){metadataRows.add(coordinate);metadataBytes+=row.bytes;}
  }
 };
 const asSource=async<T,>(scopeId:string,operation:()=>Promise<T>):Promise<T>=>{const previous=roleContext;roleContext={scopeId,role:'authenticated-source'};try{return await operation();}finally{roleContext=previous;}};
 const read:UnlockedE2eeVault['read']=async(domain,id)=>{
  current();const row=await base.read(domain,id);current();const coordinate=key(domain,id),old=rows.get(coordinate);
  if(!row){if(old)throw new Error('E2EE_SOURCE_HISTORY_CHANGED');return null;}
  try{const digest=hash(row.value);if(old){if(old.serial!==row.serial||old.hash!==digest||old.bytes!==row.value.length)throw new Error('E2EE_SOURCE_HISTORY_CHANGED');}
   else{
    // Producer limits apply to their own source/plan. Counting all retained
    // scopes must not replace those limits with a smaller account-wide byte
    // ceiling. The mandatory provider admission checks real physical quota.
    totalBytes+=row.value.length;if(!Number.isSafeInteger(totalBytes)||rows.size>=E2EE_PROVIDER_STORAGE_BUDGET.maximumRecords+E2EE_PROVIDER_STORAGE_BUDGET.maximumKeyRecords)throw new Error('E2EE_SOURCE_HISTORY_CAPACITY');
    rows.set(coordinate,Object.freeze({domain,id,serial:row.serial,hash:digest,bytes:row.value.length}));
    const body=domain==='outbox'||domain==='draft'||domain==='local-snapshot'&&(/:source:[0-9]+$|:private:[0-9]+:[0-9]+$/.test(id)||/^source-stage:[^:]+:[^:]+:p:/.test(id)||/^remote-original:[^:]+:[^:]+:p:/.test(id));
    if(!body){metadataRows.add(coordinate);metadataBytes+=row.value.length;}
   }
   if(roleContext)claim(domain,id,roleContext.scopeId,roleContext.role);return row;
  }catch(reason){row.value.fill(0);throw reason;}
 };
 const list:UnlockedE2eeVault['listLocal']=async(domain,prefix)=>{
  current();const value=(await base.listLocal(domain,prefix)).sort();current();const coordinate=key(domain,prefix),old=lists.get(coordinate);
  if(old&&(old.length!==value.length||old.some((id,at)=>id!==value[at])))throw new Error('E2EE_SOURCE_HISTORY_CHANGED');if(!old)lists.set(coordinate,[...value]);return value;
 };
 const vault={read,listLocal:list,localIdentity:()=>identity,assertUnlocked:current};
 const values=retainedMigrationValueCollector(vault,current);
 const metadata=async(id:string,limit=4*1024*1024,domain:E2eeContext['domain']='local-snapshot')=>{
  const row=await read(domain,id);if(!row)invalid();
  try{if(row.value.length<1||row.value.length>limit)invalid();
   return{serial:row.serial,hash:hash(row.value),value:parseLegacyMigrationJson(decoder.decode(row.value),'E2EE_MIGRATION_HISTORY_REVIEW_REQUIRED',limit)};
  }finally{row.value.fill(0);}
 };
 // State decoding consumes the loan inside its read scope, never afterwards.
 const stateAt=async(id:string)=>{const row=await read('local-snapshot',id);if(!row)invalid();try{
  if(row.value.length<1||row.value.length>4*1024*1024)invalid();return{state:options.decode(row.value),serial:row.serial,hash:hash(row.value)};
 }finally{row.value.fill(0);}};
 const currentIds=await list('local-snapshot','migration:'),directoryIds=await list('key-check','directory-');
 const savedDirectories=new Map<string,{id:string;ownerId:string;scopeId:string}>();
 for(const id of directoryIds){
  const saved=await metadata(id,32*1024*1024,'key-check');exactKeys(saved.value,['ownerId','pin','checkpoint','events']);
  if(!Array.isArray(saved.value.events)||!saved.value.events.length)invalid();const first=saved.value.events[0] as SignedE2eeCommand;
  if(!first?.command)invalid();const scopeId=first.command.scopeId;assertTechnical(scopeId);assertTechnical(saved.value.ownerId);
  if(id!=='directory-'+hash(encoder.encode(scopeId))||savedDirectories.has(scopeId))invalid();savedDirectories.set(scopeId,{id,ownerId:saved.value.ownerId,scopeId});
 }
 const scopes:Scope[]=[],states=new Map<string,{scope:Scope;state:MigrationState}>(),ownerFrames=new Map<string,Frame>(),verifiedOriginals=new Map<string,Set<string>>(),copies=await base.listMigrationHistoryCopies();current();
 const copyIds=[...copies].sort(),currentById=new Map<string,Awaited<ReturnType<typeof stateAt>>>();
 for(const id of currentIds){if(!/^migration:[A-Za-z0-9_-]{43}$/.test(id))invalid();currentById.set(id,await stateAt(id));}
 for(const saved of savedDirectories.values()){
  const stateId='migration:'+hash(encoder.encode(saved.scopeId)),loaded=currentById.get(stateId);
  const root=loaded?.state??null,target=root&&root.protocol>=3&&'source'in root?root.source.target:null;
  // Old source-only states have no target tuple. Their signed directory supplies
  // the exact coordinates below; old planned outputs need their own reader.
  let coordinates:SourceStageTarget|null=target?{...target}:null;const needed=new Set(root?[anchor(root).revision]:[]);
  const ancestors:MigrationState[]=[];
  for(const[index,id]of (root?.ancestors??[]).entries()){
   const old=await stateAt(id);if(old.serial!==1||old.state.phase!=='cancelled'||id!==old.state.migrationId+':archive'||old.state.ancestors.length!==index||!same(old.state.ancestors,root!.ancestors.slice(0,index)))invalid();
   ancestors.push(old.state);needed.add(anchor(old.state).revision);
  }
  const frames=new Map<number,Frame>();
  const latest=await device.savedDirectory(saved.scopeId,frame=>{
   if(needed.has(frame.checkpoint.revision))frames.set(frame.checkpoint.revision,Object.freeze({ownerId:frame.ownerId,scopeId:frame.scopeId,resourceId:frame.resourceId,kind:frame.kind,cryptoEpoch:frame.cryptoEpoch,securityEpoch:frame.securityEpoch,keyId:frame.keyId,checkpoint:Object.freeze({...frame.checkpoint}),own:structuredClone(frame.devices.get(identity.deviceId)??null)}));
  });current();if(!latest||latest.ownerId!==saved.ownerId)invalid();
  coordinates??={ownerId:latest.ownerId,scopeId:latest.scopeId,kind:latest.kind};
  if(coordinates.ownerId!==latest.ownerId||coordinates.scopeId!==latest.scopeId||coordinates.kind!==latest.kind)invalid();
  const scope:Scope=Object.freeze({target:Object.freeze(coordinates),resourceId:latest.resourceId,stateId,root,ancestors:Object.freeze(ancestors)});scopes.push(scope);
  const nodes=root?[...ancestors,root]:[];
  claim('key-check',saved.id,coordinates.scopeId,'directory');if(root)claim('local-snapshot',stateId,coordinates.scopeId,'current');
  for(const node of nodes){
   assertTechnical(node.migrationId);if(states.has(node.migrationId))invalid();states.set(node.migrationId,{scope,state:node});
   const expected=anchor(node),frame=frames.get(expected.revision),own=frame?.own;
   if(!frame||frame.checkpoint.hash!==expected.hash||frame.ownerId!==coordinates.ownerId||frame.scopeId!==coordinates.scopeId||frame.kind!==coordinates.kind||!own||own.revoked||own.role!=='owner'||own.userId!==identity.ownerId)invalid();
   ownerFrames.set(node.migrationId,frame);
   const paths=requiredPrivatePaths(coordinates.kind).map(path=>path.id);
   if(node!==root)claim('local-snapshot',node.migrationId+':archive',coordinates.scopeId,'archive');
   if(node.protocol===3||node.protocol===4||node.protocol===5)validateStagedMigrationSnapshot(node.source,coordinates,identity,paths);
   await authenticateRetainedMigrationControls(node,frame,identity.deviceId,current);current();
   if(node.protocol===4||node.protocol===5){
    validateStreamedPlanningOwnership(node.ownership,{migrationId:node.migrationId,target:coordinates,actor:identity,sourceHash:node.sourceHash,lease:node.lease,checkpointHash:expected.hash,directoryRevision:expected.revision});
    if(node.ownership.signer!==own.signingKey||node.ownership.securityEpoch!==frame.securityEpoch)invalid();
    await modern(scope,node,frame,paths);
   }else if(node.protocol===1||node.protocol===2)await legacy(scope,node,frame);
  }
  // All saved parts have exact authenticated custody. Incomplete stages are
  // prefix-only quarantine: they cannot enter a logical source/history reader,
  // restore or publication until exact producer replay and full EOF succeeds.
  const stages=await asSource(coordinates.scopeId,async()=>{const found=await inspectSourceStages(vault,coordinates!,current);current();
   if(!root&&found.length){const own=latest.devices.get(identity.deviceId);if(!own||own.revoked||own.role!=='owner'||own.userId!==identity.ownerId)invalid();}
   for(const stage of found){
    if(!stage.complete){
     const partial=await authenticateInterruptedSourceStage(vault,coordinates!,stage.id,current);
     const paths=requiredPrivatePaths(coordinates!.kind).map(path=>path.id);
     if(partial.paths.length!==paths.length||partial.paths.some((path,at)=>path!==paths[at]))invalid();
     continue;
    }
    if(!stage.manifestHash)invalid();
    const opened=await openSourceStage(vault,coordinates!,{stageId:stage.id,manifestHash:stage.manifestHash},current);
    const paths=requiredPrivatePaths(coordinates!.kind).map(path=>path.id);if(opened.paths.length!==paths.length||opened.paths.some((path,at)=>path!==paths[at]))invalid();
    for(const path of opened.paths){const input=opened.openPath(path);for await(const bytes of input.chunks){current();bytes.fill(0);}input.assertComplete();}
   }return found;
  });
  for(const node of nodes)if(node.protocol===3||node.protocol===4||node.protocol===5){const references=[...node.source.history,node.source.reference];if(references.length>stages.length||references.some((ref,at)=>ref.stageId!==stages[at].id||ref.manifestHash!==stages[at].manifestHash))invalid();}
  for(const node of nodes)if(node.protocol===1||node.protocol===2){
   const original=captureLegacyMigrationSnapshotReference({migrationId:node.migrationId,snapshotSize:node.snapshotSize,snapshotParts:node.snapshotParts,snapshotHash:node.snapshotHash});
   await asSource(coordinates.scopeId,async()=>{const opened=await openLegacyMigrationSnapshot({vault,target:coordinates!,paths:requiredPrivatePaths(coordinates!.kind).map(path=>path.id),reference:original,assertCurrent:current});
    try{for(const path of requiredPrivatePaths(coordinates!.kind)){const input=opened.openPath(path.id);for await(const bytes of input.chunks){current();bytes.fill(0);}input.assertComplete();}}finally{opened.close();}
   });
  }
 }
 if(scopes.filter(scope=>scope.root!==null).length!==currentIds.length)invalid();
 const sourceParts=await base.listMigrationOriginalParts(),outputs=await base.listMigrationPlanOutputs(),stateRoles=await base.listMigrationStateRoles(),jobHistory=await base.listProductJobHistory(),controlHistory=await base.listProductControlHistory();current();
 const personal=scopes.filter(scope=>scope.target.kind==='personal'&&scope.target.ownerId===identity.ownerId);
 const selfKeys=await publicDeviceKeys(device.keys());current();
 await inspectRetainedProductCustody({vault,actor:identity,receivingKey:device.keys().receiving.privateKey,selfKeys,assertCurrent:current,outbox:outputs.remote,copies:copyIds,jobHistory,controlHistory,
  personalScopeId:personal.length===1?personal[0].target.scopeId:null,claimed:(domain,id)=>roles.has(key(domain,id)),claim,
  directory:async(scopeId,select)=>{
   const known=savedDirectories.get(scopeId);if(!known)invalid();let found:import('./directory.ts').VerifiedDirectory|undefined;
   const latest=await device.savedDirectory(scopeId,frame=>{if(select(frame))found=structuredClone(frame);});current();
   if(!latest||latest.ownerId!==known.ownerId||!found)invalid();return found;
  }});current();
 const cancellationCounts=new Map<string,number>();
 for(const id of copyIds){
  const role=roles.get(key('local-snapshot',id))?.role;if(role==='archive'||role==='product-job')continue;
  const at=id.lastIndexOf(':cancel:'),migrationId=id.slice(0,at),nonce=id.slice(at+8),known=states.get(migrationId);
  if(at<1||!known||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(nonce))invalid();
  const raw=await stateAt(id);if(raw.serial!==1||raw.state.phase==='active'||raw.state.protocol!==known.state.protocol||!same(binding(raw.state),binding(known.state)))invalid();
  if(raw.state.protocol===4||raw.state.protocol===5){const frame=ownerFrames.get(migrationId);if(!frame)invalid();await modern(known.scope,raw.state,frame,requiredPrivatePaths(known.scope.target.kind).map(path=>path.id));}
  else{const frame=ownerFrames.get(migrationId);if(!frame)invalid();await authenticateRetainedMigrationControls(raw.state,frame,identity.deviceId,current);
   if(raw.state.protocol===1||raw.state.protocol===2)await legacy(known.scope,raw.state,frame);}
  claim('local-snapshot',id,known.scope.target.scopeId,'cancel-copy');
  cancellationCounts.set(migrationId,(cancellationCounts.get(migrationId)??0)+1);
 }
 for(const{state}of states.values())if(state.phase==='cancelled'&&(state.protocol===1||state.protocol===2||state.protocol===3)&&!cancellationCounts.has(state.migrationId))invalid();
 for(const scope of scopes)await asSource(scope.target.scopeId,async()=>{const present=await listRemoteOriginals({vault,target:scope.target,capacity:options.originalCapacity,assertCurrent:current});if(present.some(row=>!verifiedOriginals.get(scope.target.scopeId)?.has(row.id)))invalid();});
 const categories=[['local-snapshot','remote-original:'],['local-snapshot','remote-original-catalog:'],['local-snapshot','content-plan:'],['local-snapshot','source-stage:'],['local-snapshot','source-stage-catalog:']] as const;
 for(const[domain,prefix]of categories)for(const id of await list(domain,prefix))if(!roles.has(key(domain,id)))invalid();
 for(const id of [...stateRoles,...jobHistory,...controlHistory])if(!roles.has(key('local-snapshot',id)))invalid();
 for(const id of [...sourceParts,...outputs.local])if(!roles.has(key('local-snapshot',id)))invalid();
 for(const id of outputs.remote)if(!roles.has(key('outbox',id)))invalid();
 await options.admit(Object.freeze({bytes:totalBytes,records:rows.size,metadataBytes,scopes:scopes.length}));current();
 async function legacy(scope:Scope,state:Extract<MigrationState,{protocol:1|2}>,frame:Frame){
  const own=frame.own;if(!own)invalid();
  const root=await openRoot(own.capsule,device.keys().receiving.privateKey,{ownerId:scope.target.ownerId,scopeId:scope.target.scopeId,cryptoEpoch:frame.cryptoEpoch,keyId:frame.keyId,recipientId:identity.deviceId});current();
  await asSource(scope.target.scopeId,()=>inspectRetainedLegacyPlan({vault,target:scope.target,state,frame,root,assertCurrent:current}));current();
  values.add({scope:{...scope.target,resourceId:scope.resourceId},migrationId:state.migrationId,attemptId:state.migrationId,root,signer:await signingPublicKey(own.signingKey),plan:state.plan,logical:state.logical,local:state.local??[]});current();
 }
 async function modern(scope:Scope,state:Extract<MigrationState,{protocol:4|5}>,frame:Frame,paths:string[]){
  const own=frame.own!;const signer=await signingPublicKey(own.signingKey),readOptions={vault,target:scope.target,capacity:options.originalCapacity,assertCurrent:current};
  const expected=anchor(state);
  if(expected.hash!==frame.checkpoint.hash||expected.revision!==frame.checkpoint.revision)invalid();
  validateStagedMigrationSnapshot(state.source,scope.target,identity,paths);
  validateStreamedPlanningOwnership(state.ownership,{migrationId:state.migrationId,target:scope.target,actor:identity,sourceHash:state.sourceHash,lease:state.lease,checkpointHash:expected.hash,directoryRevision:expected.revision});
  if(state.ownership.signer!==own.signingKey||state.ownership.securityEpoch!==frame.securityEpoch)invalid();
  await authenticateRetainedMigrationControls(state,frame,identity.deviceId,current);current();
  const preparation=await stateAt(state.ownership.sourceState.objectId);
  if(preparation.serial!==1||preparation.hash!==state.ownership.sourceState.hash||preparation.state.protocol!==3||preparation.state.phase!=='preparing'
   ||preparation.state.checkpointHash!==expected.hash||preparation.state.directoryRevision!==expected.revision||!same(binding(preparation.state),binding(state)))invalid();
  claim('local-snapshot',state.ownership.sourceState.objectId,scope.target.scopeId,'preparation');
  if(state.protocol===5){const adopted=await stateAt(state.adopted.stateId);
   if(state.adopted.stateId!==`${state.migrationId}:adoption:${state.adopted.reference.attemptId}`||adopted.serial!==1||adopted.hash!==state.adopted.stateHash||adopted.state.protocol!==4
    ||adopted.state.checkpointHash!==expected.hash||adopted.state.directoryRevision!==expected.revision||adopted.state.sourceHash!==state.sourceHash
    ||!same(adopted.state.ownership,state.ownership)||!same(binding(adopted.state),binding(state)))invalid();
   await authenticateRetainedMigrationControls(adopted.state,frame,identity.deviceId,current);current();claim('local-snapshot',state.adopted.stateId,scope.target.scopeId,'adoption');}
  for(const original of state.ownership.originals){
   if(!state.lease)invalid();await authenticateRemoteOriginalRegistration(original.registration,original.packet,signer,{...readOptions,generation:state.lease.generation});current();
   // A different generation in the same target may own another marker. The
   // final global inventory joins it to its own exact reservation, never skips it.
   await asSource(scope.target.scopeId,async()=>{const present=(await listRemoteOriginals(readOptions)).find(row=>row.id===original.registration.id);if(!present){if('completion'in original&&original.completion!==null)invalid();return;}
    const descriptor=await describeRemoteOriginal(readOptions,present.id);current();if(!same(descriptor.registration,original.registration))invalid();
    const proof=await withRemoteOriginal(readOptions,present.id,async input=>{for await(const bytes of input){current();bytes.fill(0);}},{allowIncomplete:true});current();
    if('completion'in original&&original.completion!==null&&(!proof.complete||!same(original.completion,{id:proof.id,manifestHash:proof.manifestHash,rawHash:proof.rawHash,size:proof.size})))invalid();
    let verified=verifiedOriginals.get(scope.target.scopeId);if(!verified)verifiedOriginals.set(scope.target.scopeId,verified=new Set());verified.add(present.id);
   });
  }
  let adoptedPlanFound=state.protocol!==5;
  if(state.ownership.protocol===3)for(const plan of state.ownership.plans){
   if(plan.context.cryptoEpoch!==frame.cryptoEpoch||plan.context.keyId!==frame.keyId||plan.context.securityEpoch!==frame.securityEpoch||!state.sourceHash)invalid();
   const root=await openRoot(own.capsule,device.keys().receiving.privateKey,{ownerId:scope.target.ownerId,scopeId:scope.target.scopeId,cryptoEpoch:frame.cryptoEpoch,keyId:frame.keyId,recipientId:identity.deviceId});current();
   const inspected=await asSource(scope.target.scopeId,()=>inspectMigrationContentPlanAttempt({vault,root,signer,context:plan.context,target:scope.target,migrationId:state.migrationId,sourceHash:state.sourceHash!,paths,assertCurrent:current,attemptId:plan.attemptId,reference:plan.completion}));current();
   for(const id of inspected.metadataIds)claim('local-snapshot',id,scope.target.scopeId,'content-plan');
   const retained=await asSource(scope.target.scopeId,()=>retainedMigrationPlanValues({vault,root,signer,context:plan.context,target:scope.target,migrationId:state.migrationId,sourceHash:state.sourceHash!,paths,assertCurrent:current,attemptId:plan.attemptId,reference:plan.completion}));current();
   values.add({scope:{...scope.target,resourceId:scope.resourceId},migrationId:state.migrationId,attemptId:plan.attemptId,root,signer,...retained});
   if(inspected.reference){const manifest=await asSource(scope.target.scopeId,()=>openMigrationContentPlan({vault,root,signer,context:plan.context,target:scope.target,migrationId:state.migrationId,sourceHash:state.sourceHash!,paths,assertCurrent:current,reference:inspected.reference!}));
    if(state.protocol===5&&plan.attemptId===state.adopted.reference.attemptId){
     if(!plan.completion||!same(plan.completion,state.adopted.reference)||!same(state.plan,manifest.plan)||!same(state.logical,manifest.logical)||!same(state.local,manifest.local))invalid();adoptedPlanFound=true;
    }
   }
  }
  if(!adoptedPlanFound)invalid();
 }
 const assertUnchanged=async()=>{
  current();for(const expected of rows.values()){const row=await base.read(expected.domain,expected.id);try{current();if(!row||row.serial!==expected.serial||row.value.length!==expected.bytes||hash(row.value)!==expected.hash)throw new Error('E2EE_SOURCE_HISTORY_CHANGED');}finally{row?.value.fill(0);}}
  for(const[coordinate,expected]of lists){const at=coordinate.indexOf('\0'),domain=coordinate.slice(0,at) as E2eeContext['domain'],prefix=coordinate.slice(at+1),actual=(await base.listLocal(domain,prefix)).sort();current();if(!same(actual,expected))throw new Error('E2EE_SOURCE_HISTORY_CHANGED');}
  const afterCopies=(await base.listMigrationHistoryCopies()).sort(),afterSources=(await base.listMigrationOriginalParts()).sort(),afterOutputs=await base.listMigrationPlanOutputs(),afterStates=(await base.listMigrationStateRoles()).sort(),afterJobs=(await base.listProductJobHistory()).sort(),afterControls=(await base.listProductControlHistory()).sort();current();
  if(!same(afterCopies,copyIds)||!same(afterSources,[...sourceParts].sort())||!same(afterStates,[...stateRoles].sort())||!same(afterJobs,[...jobHistory].sort())||!same(afterControls,[...controlHistory].sort())||!same([...afterOutputs.remote].sort(),[...outputs.remote].sort())||!same([...afterOutputs.local].sort(),[...outputs.local].sort()))throw new Error('E2EE_SOURCE_HISTORY_CHANGED');
 };
 await assertUnchanged();current();
 return Object.freeze({scopes:Object.freeze(scopes.map(scope=>Object.freeze({scopeId:scope.target.scopeId,ownerId:scope.target.ownerId,kind:scope.target.kind,resourceId:scope.resourceId,migrationId:scope.root?.migrationId??null,phase:scope.root?.phase??null}))),
  scope(scopeId:string){current();const scope=scopes.find(row=>row.target.scopeId===scopeId);if(!scope)invalid();return structuredClone(scope);},
  contents:values.list(),async readContent(id:string,write:(bytes:Uint8Array)=>Promise<void>){current();await assertUnchanged();const metadata=await values.read(id,write);await assertUnchanged();current();return metadata;},
  role(domain:E2eeContext['domain'],id:string){current();const role=roles.get(key(domain,id));if(!role)invalid();return role;},assertUnchanged,
  usage:Object.freeze({bytes:totalBytes,records:rows.size,metadataBytes,scopes:scopes.length}),close(){closed=true;values.close();rows.clear();roles.clear();lists.clear();metadataRows.clear();}});
}
