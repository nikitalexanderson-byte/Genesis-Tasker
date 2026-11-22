import {sha256} from '@noble/hashes/sha2.js';
import {canonicalE2eeValue,verifyE2eeCommand,type SignedE2eeCommand,type WireValue} from './commands.ts';
import {decodeE2eeBytes,encodeE2eeBytes,openE2eeEnvelope,validateE2eeEnvelope,type E2eeContext} from './envelope.ts';
import {E2EE_CHUNK_BYTES,E2EE_MAX_FILE_BYTES,envelopePayloadHash,openE2eeFileStream} from './files.ts';
import {HPKE_SUITE,assertTechnical,exactKeys,openRoot} from './keys.ts';
import {contentSigningKey,signingPublicKey,verifyDeviceDirectory,type VerifiedDirectory} from './directory.ts';
import {requiredPrivatePaths} from './private-paths.ts';
import {parseLegacyMigrationJson} from './legacy-json.ts';
import {productMutation} from './product-contract.ts';
import {validatePrivateProjectTopology} from './project-create-contract.ts';
import type {SourceStageReadVault} from './source-stage.ts';

type Options={vault:SourceStageReadVault;actor:{ownerId:string;deviceId:string};receivingKey:CryptoKey;selfKeys:{signingKey:string;receivingKey:string};assertCurrent:()=>void;
 outbox:readonly string[];copies:readonly string[];jobHistory:readonly string[];controlHistory:readonly string[];personalScopeId:string|null;
 claimed:(domain:E2eeContext['domain'],id:string)=>boolean;claim:(domain:E2eeContext['domain'],id:string,scopeId:string,role:string)=>void;
 directory:(scopeId:string,select:(frame:VerifiedDirectory)=>boolean)=>Promise<VerifiedDirectory>};
type Job={protocol:1;scopeId:string;domain:E2eeContext['domain'];objectId:string;generation:number;cryptoEpoch:number;keyId:string;expected:number;size:number;
 metadata:{filename:string;mediaType:string};originId?:string|null;draftId:string;draftParts:number;plan:{recordId:string;hash:string;expected:number}[];
 uploaded:number;pending:SignedE2eeCommand|null;cancelling:SignedE2eeCommand|null;complete:boolean};
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}),uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const digest=(bytes:Uint8Array)=>encodeE2eeBytes(sha256(bytes));
function equal(a:unknown,b:unknown){const left=canonicalE2eeValue(a as WireValue),right=canonicalE2eeValue(b as WireValue);try{return left.length===right.length&&left.every((byte,at)=>byte===right[at]);}finally{left.fill(0);right.fill(0);}}
function invalid():never{throw new Error('E2EE_PRODUCT_CUSTODY_REVIEW_REQUIRED');}
function integer(value:unknown,min=0,max=Number.MAX_SAFE_INTEGER):asserts value is number{if(!Number.isSafeInteger(value)||(value as number)<min||(value as number)>max)invalid();}
function object(value:unknown):asserts value is Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))invalid();}

/** All normal outboxes are explicitly authenticated, never skipped as foreign
 * migration prefixes. No network, refresh, signer, receipt replay or writer is
 * exposed. In particular, an interrupted/denied request stays inert evidence. */
export async function inspectRetainedProductCustody(options:Options){
 const {vault,assertCurrent:current,claim,claimed}=options;current();
 const metadata=async(domain:E2eeContext['domain'],id:string,immutable=false)=>{
  const row=await vault.read(domain,id);if(!row)invalid();try{current();if(immutable&&row.serial!==1||row.value.length<1||row.value.length>4*1024*1024)invalid();return parseLegacyMigrationJson(decoder.decode(row.value),'E2EE_PRODUCT_CUSTODY_REVIEW_REQUIRED',4*1024*1024);}finally{row.value.fill(0);}
 };
 const packet=async(input:unknown)=>{
  exactKeys(input,['command','signature']);const signed=input as unknown as SignedE2eeCommand,command=signed.command;
  if(!command||command.deviceId!==options.actor.deviceId&&command.deviceId!=='recovery')invalid();
  const directory=await options.directory(command.scopeId,frame=>frame.checkpoint.revision===command.expectedRevision&&frame.checkpoint.hash===command.checkpointHash&&frame.securityEpoch===command.securityEpoch);current();
  if(directory.ownerId!==command.ownerId)invalid();
  const own=directory.devices.get(options.actor.deviceId),key=command.deviceId==='recovery'?directory.recoveryKit.authority.signingKey:own?.signingKey;
  if(!key||command.deviceId!=='recovery'&&(!own||own.revoked||own.userId!==options.actor.ownerId))invalid();
  await verifyE2eeCommand(signed,await signingPublicKey(key));current();return{signed,command,directory};
 };
 const roles=(value:unknown)=>{
  if(!Array.isArray(value)||value.length>256)invalid();const ids=new Set<string>();for(const row of value){exactKeys(row,['deviceId','role']);assertTechnical(row.deviceId);if(ids.has(row.deviceId)||row.role!==null&&!['owner','writer','commenter','reader'].includes(String(row.role)))invalid();ids.add(row.deviceId);}return value as {deviceId:string;role:string|null}[];
 };
 const capsule=(value:unknown)=>{exactKeys(value,['suite','enc','ciphertext']);if(value.suite!==HPKE_SUITE)invalid();decodeE2eeBytes(value.enc,65);decodeE2eeBytes(value.ciphertext,48);};
 const rotation=async(value:unknown)=>{
  const checked=await packet(value),{command,directory}=checked,payload=command.payload,own=directory.devices.get(options.actor.deviceId);
  if(command.action!=='rotate-membership'||command.deviceId!==options.actor.deviceId||directory.kind==='personal'||directory.ownerId!==options.actor.ownerId||own?.role!=='owner')invalid();
  exactKeys(payload,['membershipHash','revokedDeviceIds','roleChanges','cryptoEpoch','securityEpoch','keyId','capsules','recoveryCapsule','retiredManifestHash','retiredObjectCount']);
  decodeE2eeBytes(payload.membershipHash,32);decodeE2eeBytes(payload.retiredManifestHash,32);integer(payload.retiredObjectCount,0,10000);assertTechnical(payload.keyId);
  if(payload.cryptoEpoch!==directory.cryptoEpoch+1||payload.securityEpoch!==directory.securityEpoch+1||!Array.isArray(payload.revokedDeviceIds)||!Array.isArray(payload.capsules))invalid();
  const live=[...directory.devices.values()].filter(device=>!device.revoked),changes=roles(payload.roleChanges),removed=payload.revokedDeviceIds;
  for(const id of removed)assertTechnical(id);if(new Set(removed).size!==removed.length||new Set([...changes.map(row=>row.deviceId),...removed]).size!==live.length||changes.length+removed.length!==live.length)invalid();
  for(const device of live){const change=changes.find(row=>row.deviceId===device.deviceId);if(!change&&!removed.includes(device.deviceId)||device.userId===directory.ownerId&&change?.role!=='owner'||device.userId!==directory.ownerId&&change?.role==='owner')invalid();}
  if(changes.some(row=>row.role===null)||payload.capsules.length!==changes.length)invalid();const recipients=new Set<string>();
  for(const row of payload.capsules){exactKeys(row,['deviceId','capsule']);assertTechnical(row.deviceId);if(recipients.has(row.deviceId)||!changes.some(change=>change.deviceId===row.deviceId))invalid();recipients.add(row.deviceId);capsule(row.capsule);}
  capsule(payload.recoveryCapsule);const self=payload.capsules.find(row=>{object(row);return row.deviceId===options.actor.deviceId;});object(self);
  await openRoot(self.capsule,options.receivingKey,{ownerId:directory.ownerId,scopeId:directory.scopeId,cryptoEpoch:payload.cryptoEpoch as number,keyId:payload.keyId,recipientId:options.actor.deviceId});current();
  return checked;
 };
 const membership=async(input:unknown,id:string)=>{
  exactKeys(input,['protocol','ownerId','intentId','scopeIds','changes','preview','review','batch','result']);
  if(input.protocol!==1||input.ownerId!==options.actor.ownerId||id!=='membership:'+input.intentId||!Array.isArray(input.scopeIds)||input.scopeIds.length>256||!Array.isArray(input.changes)||input.changes.length<1||input.changes.length>200)invalid();
  assertTechnical(input.intentId);for(const scope of input.scopeIds)assertTechnical(scope);if(!equal(input.scopeIds,[...new Set(input.scopeIds)].sort()))invalid();
  const seen=new Set<string>();
  const specs:Record<string,{keys:string[];fields:string[]}>=Object.freeze({shared_project_members:{keys:['project_id','user_id'],fields:['role']},shared_space_members:{keys:['space_id','user_id'],fields:['role','can_organize_tasks','all_projects','permissions_json','member_category_id','project_access_restricted','project_access_revision']},shared_member_categories:{keys:['id','space_id'],fields:['permissions_json','revision']},shared_member_project_grants:{keys:['space_id','user_id','project_id'],fields:['role','include_descendants']}});
  for(const change of input.changes){
   exactKeys(change,['table','key','expectedHash','after']);if(typeof change.table!=='string'||!Object.hasOwn(specs,change.table))invalid();const spec=specs[change.table];exactKeys(change.key,spec.keys);Object.values(change.key).forEach(assertTechnical);
   const coordinate=digest(canonicalE2eeValue([change.table,change.key] as WireValue));if(seen.has(coordinate))invalid();seen.add(coordinate);if(change.expectedHash!=='absent')decodeE2eeBytes(change.expectedHash,32);
   if(change.after!==null){exactKeys(change.after,spec.fields);
    for(const field of ['can_organize_tasks','all_projects','project_access_restricted','include_descendants'])if(Object.hasOwn(change.after,field)&&![0,1].includes(change.after[field] as number))invalid();
    for(const field of ['revision','project_access_revision'])if(Object.hasOwn(change.after,field))integer(change.after[field],1);
    if(Object.hasOwn(change.after,'member_category_id')&&change.after.member_category_id!==null)assertTechnical(change.after.member_category_id);
    if(Object.hasOwn(change.after,'role')){const allowed=change.table==='shared_space_members'?['owner','admin','member','guest']:change.table==='shared_project_members'?['owner','manager','member','commenter','viewer']:['member','commenter','viewer'];if(!allowed.includes(String(change.after.role)))invalid();}
    if(Object.hasOwn(change.after,'permissions_json')&&change.after.permissions_json!==null){if(typeof change.after.permissions_json!=='string')invalid();const permissions=parseLegacyMigrationJson(change.after.permissions_json,'E2EE_PRODUCT_CUSTODY_REVIEW_REQUIRED',65536);exactKeys(permissions,['createProjects','editTasks','organizeTasks','comment','manageProjects','inviteMembers']);if(Object.values(permissions).some(value=>typeof value!=='boolean'))invalid();}
   }
  }
  const changeHash=digest(canonicalE2eeValue({protocol:1,actorId:options.actor.ownerId,intentId:input.intentId,changes:input.changes,scopeIds:input.scopeIds} as WireValue));
  if(input.preview!==null){exactKeys(input.preview,['intentId','changeHash','scopePlans']);if(input.preview.intentId!==input.intentId||input.preview.changeHash!==changeHash||!Array.isArray(input.preview.scopePlans)||!equal(input.preview.scopePlans.map(plan=>{object(plan);return plan.scopeId;}).sort(),input.scopeIds))invalid();
   for(const plan of input.preview.scopePlans){exactKeys(plan,['scopeId','ownerId','kind','resourceId','directoryRevision','checkpointHash','cryptoEpoch','securityEpoch','roles','manifest']);assertTechnical(plan.scopeId);const directory=await options.directory(plan.scopeId,frame=>frame.checkpoint.revision===plan.directoryRevision&&frame.checkpoint.hash===plan.checkpointHash&&frame.cryptoEpoch===plan.cryptoEpoch&&frame.securityEpoch===plan.securityEpoch);current();
    if(directory.ownerId!==plan.ownerId||directory.kind!==plan.kind||directory.resourceId!==plan.resourceId)invalid();roles(plan.roles);exactKeys(plan.manifest,['manifestHash','objectCount']);decodeE2eeBytes(plan.manifest.manifestHash,32);integer(plan.manifest.objectCount,0,10000);}
  }
  if(input.review!==null){if(!input.preview||!Array.isArray(input.review)||!equal(input.review.map(row=>{exactKeys(row,['scopeId','roles']);roles(row.roles);return row.scopeId;}).sort(),input.scopeIds))invalid();
   for(const row of input.review)if(!equal(row.roles,(input.preview.scopePlans as Record<string,unknown>[]).find(plan=>plan.scopeId===row.scopeId)?.roles))invalid();}
  if(input.batch!==null){
   exactKeys(input.batch,['intentId','changes','authorization','rotations']);if(!input.review||input.batch.intentId!==input.intentId||!equal(input.batch.changes,input.changes)||!Array.isArray(input.batch.rotations))invalid();
   const authority=await packet(input.batch.authorization);exactKeys(authority.command.payload,['intentId','changeHash']);
   if(authority.command.action!=='membership-authorize'||authority.directory.kind!=='personal'||authority.directory.ownerId!==options.actor.ownerId||authority.command.payload.intentId!==input.intentId||authority.command.payload.changeHash!==changeHash)invalid();
   const scopeIds:string[]=[];for(const value of input.batch.rotations){const checked=await rotation(value);if(checked.command.payload.membershipHash!==changeHash)invalid();scopeIds.push(checked.directory.scopeId);}
   if(!equal(scopeIds.sort(),input.scopeIds))invalid();
  }
  if(input.result!==null){object(input.result);if(!input.batch||input.result.intentId!==input.intentId||input.result.changeHash!==changeHash)invalid();}
  if(!options.personalScopeId)invalid();claim('outbox',id,options.personalScopeId,'membership-plan');
 };
 const groups=new Map<string,string[]>();
 for(const id of options.outbox){
  if(claimed('outbox',id))continue;
  const match=/^([a-f0-9-]{36}):cipher:(0|[1-9][0-9]*)$/.exec(id);
  if(match){if(!uuid.test(match[1])||Number(match[2])>257)invalid();const rows=groups.get(match[1])??[];rows.push(id);groups.set(match[1],rows);}
 }
 const proofs=new Map<string,{scopeId:string;domain:E2eeContext['domain'];objectId:string;size:number;hash:string;metadata:{filename:string;mediaType:string};context:E2eeContext;hashes:readonly string[]}>();
 const inspectGroup=async(draftId:string)=>{
  const prior=proofs.get(draftId);if(prior)return prior;
  const ids=groups.get(draftId);if(!ids?.length)invalid();ids.sort((a,b)=>Number(a.slice(a.lastIndexOf(':')+1))-Number(b.slice(b.lastIndexOf(':')+1)));
  if(ids.some((id,index)=>id!==`${draftId}:cipher:${index}`))invalid();
  const headers:{id:string;context:E2eeContext;hash:string}[]=[];
  for(const id of ids){const envelope=validateE2eeEnvelope(await metadata('outbox',id,true));headers.push({id,context:envelope.context,hash:await envelopePayloadHash(envelope)});current();}
  const last=headers.at(-1)!,context=last.context,frame=await options.directory(context.scopeId,dir=>dir.cryptoEpoch===context.cryptoEpoch&&dir.securityEpoch===context.securityEpoch&&dir.keyId===context.keyId&&dir.generation===context.dataGeneration);current();
  const own=frame.devices.get(options.actor.deviceId);
  if(!own||own.userId!==options.actor.ownerId||context.ownerId!==frame.ownerId||context.deviceId!==options.actor.deviceId||context.writerProtocol!==9||context.schemaVersion!==1
   ||!requiredPrivatePaths(frame.kind).some(path=>path.domains.includes(context.domain)))invalid();
  const signer=await contentSigningKey(frame,context),root=await openRoot(own.capsule,options.receivingKey,{ownerId:frame.ownerId,scopeId:frame.scopeId,cryptoEpoch:frame.cryptoEpoch,keyId:frame.keyId,recipientId:options.actor.deviceId});current();
  const byCoordinate=new Map<string,typeof headers[number]>(),used=new Set<string>();
  for(const header of headers){const c=header.context;
   if(c.ownerId!==frame.ownerId||c.scopeId!==frame.scopeId||c.deviceId!==context.deviceId||c.cryptoEpoch!==context.cryptoEpoch||c.securityEpoch!==context.securityEpoch||c.keyId!==context.keyId
    ||c.dataGeneration!==context.dataGeneration||c.writerProtocol!==9||c.schemaVersion!==1||header!==last&&(c.domain!=='attachment'||c.revision!==1))invalid();
   const coordinate=c.domain+'\0'+c.objectId;if(byCoordinate.has(coordinate))invalid();byCoordinate.set(coordinate,header);
  }
  const load=async(header:typeof headers[number])=>{
   const value=validateE2eeEnvelope(await metadata('outbox',header.id,true));if(!equal(value.context,header.context)||await envelopePayloadHash(value)!==header.hash)invalid();current();
   claim('outbox',header.id,frame.scopeId,'product-cipher');return value;
  };
  const manifest=await load(last),hash=sha256.create();let size=0,description={filename:'',mediaType:'application/json'};
  try{
   if(context.domain==='shared-comment'){
    if(headers.length!==1)invalid();const bytes=await openE2eeEnvelope(root,signer,context,manifest);try{current();if(bytes.length>65536)invalid();size=bytes.length;hash.update(bytes);}finally{bytes.fill(0);}
   }else{const opened=await openE2eeFileStream({root,signer,expectedContext:context,manifestEnvelope:manifest,assertCurrent:current,
    fetchChunk:async objectId=>{const item=byCoordinate.get('attachment\0'+objectId);if(!item||item===last||used.has(item.id))invalid();used.add(item.id);return load(item);},
    writeQuarantinedPlaintext:async bytes=>{current();size+=bytes.length;hash.update(bytes);}});description={filename:opened.filename,mediaType:opened.mediaType};}
   if(used.size!==headers.length-1)invalid();const bodyHash=hash.digest();let plaintextHash:string;try{plaintextHash=encodeE2eeBytes(bodyHash);}finally{bodyHash.fill(0);}
   const draftHash=sha256.create();let draftSize=0;
   try{
    const parts=Math.ceil(size/E2EE_CHUNK_BYTES),actual=(await vault.listLocal('draft',draftId+':')).sort(),expected=Array.from({length:parts},(_,at)=>`${draftId}:${at}`).sort();current();if(!equal(actual,expected))invalid();
    for(let at=0;at<parts;at++){const id=`${draftId}:${at}`,row=await vault.read('draft',id);if(!row)invalid();try{current();if(row.serial!==1||row.value.length!==Math.min(E2EE_CHUNK_BYTES,size-draftSize))invalid();draftHash.update(row.value);draftSize+=row.value.length;claim('draft',id,frame.scopeId,'product-draft');}finally{row.value.fill(0);}}
    const bytes=draftHash.digest();try{if(draftSize!==size||encodeE2eeBytes(bytes)!==plaintextHash)invalid();}finally{bytes.fill(0);}
   }finally{draftHash.destroy();}
   const proof={scopeId:frame.scopeId,domain:context.domain,objectId:context.objectId,size,hash:plaintextHash,metadata:description,context,hashes:headers.map(header=>header.hash)};proofs.set(draftId,proof);return proof;
  }finally{hash.destroy();}
 };
 const inspectJob=async(input:unknown,id:string,domain:'outbox'|'local-snapshot')=>{
  object(input);exactKeys(input,['protocol','scopeId','domain','objectId','generation','cryptoEpoch','keyId','expected','size','metadata','draftId','draftParts','plan','uploaded','pending','cancelling','complete',...(Object.hasOwn(input,'originId')?['originId']:[])]);
  const job=input as unknown as Job;
  if(job.protocol!==1||!uuid.test(job.draftId)||typeof job.complete!=='boolean'||!Array.isArray(job.plan)||job.plan.length<1||job.plan.length>258)invalid();
  assertTechnical(job.scopeId);assertTechnical(job.objectId);assertTechnical(job.keyId);integer(job.expected);integer(job.size,0,E2EE_MAX_FILE_BYTES);integer(job.generation,1);integer(job.cryptoEpoch,1);integer(job.uploaded,0,job.plan.length);
  if(job.draftParts!==Math.ceil(job.size/E2EE_CHUNK_BYTES)||job.complete!==(job.uploaded===job.plan.length)||job.complete&&(job.pending||job.cancelling)||job.originId!==undefined&&job.originId!==null&&typeof job.originId!=='string')invalid();
  exactKeys(job.metadata,['filename','mediaType']);if(typeof job.metadata.filename!=='string'||job.metadata.filename.length>512||typeof job.metadata.mediaType!=='string'||job.metadata.mediaType.length>128)invalid();
  const proof=await inspectGroup(job.draftId);current();
  if(job.scopeId!==proof.scopeId||job.domain!==proof.domain||job.objectId!==proof.objectId||job.generation!==proof.context.dataGeneration||job.cryptoEpoch!==proof.context.cryptoEpoch||job.keyId!==proof.context.keyId
   ||job.expected+1!==proof.context.revision||job.size!==proof.size||!equal(job.metadata,proof.metadata)||job.plan.length!==proof.hashes.length)invalid();
  for(const[itemIndex,item]of job.plan.entries()){exactKeys(item,['recordId','hash','expected']);if(item.recordId!==`${job.draftId}:cipher:${itemIndex}`||item.hash!==proof.hashes[itemIndex]||item.expected!==(itemIndex===job.plan.length-1?job.expected:0))invalid();}
  if(domain==='outbox'){if(id!=='job:'+digest(encoder.encode(`${job.scopeId}\0${job.domain}\0${job.objectId}`)))invalid();}
  else if(!new RegExp('^'+job.draftId+':(?:rebase|completed|cancel):[a-f0-9-]{36}$').test(id)||!uuid.test(id.slice(id.lastIndexOf(':')+1)))invalid();
  if(job.pending){const pending=await packet(job.pending),item=job.plan[job.uploaded];
   exactKeys(pending.command.payload,['envelope','expectedObjectRevision','migrationId','fence']);const envelope=validateE2eeEnvelope(pending.command.payload.envelope);
   if(!item||pending.command.action!=='put'||pending.command.scopeId!==job.scopeId||pending.command.deviceId!==options.actor.deviceId||pending.command.payload.migrationId!==null||pending.command.payload.fence!==0
    ||pending.command.payload.expectedObjectRevision!==item.expected||envelope.context.operationId!==pending.command.operationId||await envelopePayloadHash(envelope)!==item.hash)invalid();current();}
  if(job.cancelling){const cancel=await packet(job.cancelling);exactKeys(cancel.command.payload,['original']);if(!job.pending||cancel.command.action!=='cancel-put'||cancel.command.scopeId!==job.scopeId||!equal(cancel.command.payload.original,job.pending))invalid();}
  claim(domain,id,job.scopeId,'product-job');
 };
 for(const id of options.outbox)if(!claimed('outbox',id)&&id.startsWith('job:'))await inspectJob(await metadata('outbox',id),id,'outbox');
 for(const id of [...new Set([...options.copies,...options.jobHistory])])if(!claimed('local-snapshot',id)){
  const value=await metadata('local-snapshot',id,true);if(value&&typeof value==='object'&&!Array.isArray(value)&&'draftId'in value&&'scopeId'in value&&'plan'in value)await inspectJob(value,id,'local-snapshot');
 }
 // Pre-index completed jobs can have lost only the mutable job header. Their
 // complete signed file + exact protected draft still prove inert CONTENT,
 // never "not started", an acknowledgement or a replayable operation.
 for(const id of groups.keys())await inspectGroup(id);
 const inspectControl=async(value:unknown,id:string,domain:'outbox'|'local-snapshot')=>{
  const baseId=domain==='outbox'?id:id.slice(0,id.lastIndexOf(':attempt:'));
  if(domain==='local-snapshot'&&(!/:[1-9][0-9]*$/.test(id)||baseId===id))invalid();
  const {command,directory}=await packet(value),payload=command.payload;
  if(baseId.startsWith('service:')){
   if(!['product-commit','product-approve','stoicheion-grant','advice-issue','product-bootstrap-start','product-bootstrap-stage','product-bootstrap-complete','resource-create-prepare','resource-create-resolve','shared-invitations-issue','shared-invitation-revoke'].includes(command.action))invalid();
   assertTechnical(payload.intentId);if(baseId!=='service:'+digest(encoder.encode(`${command.action}\0${payload.intentId}`))||command.deviceId!==options.actor.deviceId)invalid();
   if(command.action==='shared-invitations-issue'){
    exactKeys(payload,['intentId','invitations']);if(!Array.isArray(payload.invitations)||payload.invitations.length<1||payload.invitations.length>20)invalid();const ids=new Set<string>(),emails=new Set<string>();
    for(const row of payload.invitations){exactKeys(row,['id','email','role','permissions']);assertTechnical(row.id);if(ids.has(row.id)||typeof row.email!=='string'||row.email.length>320||!/^\S+@(?:gmail|googlemail)\.com$/i.test(row.email)||emails.has(row.email.toLowerCase())||!['admin','member','guest'].includes(String(row.role)))invalid();ids.add(row.id);emails.add(row.email.toLowerCase());
     exactKeys(row.permissions,['createProjects','editTasks','organizeTasks','comment','manageProjects','inviteMembers']);if(Object.values(row.permissions).some(value=>typeof value!=='boolean'))invalid();}
   }else if(command.action==='shared-invitation-revoke'){exactKeys(payload,['intentId','id']);assertTechnical(payload.id);
   }else if(['resource-create-prepare','resource-create-resolve'].includes(command.action)){
    let request=payload;if(command.action==='resource-create-resolve'){
     exactKeys(payload,['intentId','original']);exactKeys(payload.original,['intentId','bootstrap','topology']);request=payload.original as Record<string,WireValue>;
     assertTechnical(request.intentId);if(payload.intentId!=='resource-create-resolve:'+request.intentId)invalid();
    }
    exactKeys(request,Object.hasOwn(request,'topology')?['intentId','bootstrap','topology']:['intentId','bootstrap']);exactKeys(request.bootstrap,['command','signature']);const initial=request.bootstrap as unknown as SignedE2eeCommand;
    const kind=initial.command.payload.kind;
    if(initial.command.action!=='bootstrap'||initial.command.ownerId!==options.actor.ownerId||initial.command.deviceId!==options.actor.deviceId||!['space','project'].includes(String(kind))||(kind==='project')!==Object.hasOwn(request,'topology')||initial.command.expectedRevision!==0||initial.command.checkpointHash!=='genesis'||initial.command.securityEpoch!==1||command.action==='resource-create-resolve'&&kind!=='project')invalid();
    if(kind==='project')validatePrivateProjectTopology(request.topology,options.actor.ownerId);
    const fresh=await verifyDeviceDirectory(options.actor.ownerId,initial.command.scopeId,directory.recoveryKit.authority,[initial]);current();
    const own=fresh.devices.get(options.actor.deviceId);if(fresh.generation!==1||fresh.kind!==kind||!own||own.signingKey!==options.selfKeys.signingKey||own.receivingKey!==options.selfKeys.receivingKey)invalid();
   }
   else if(command.action==='product-commit'){exactKeys(payload,['intentId','operations']);if(!Array.isArray(payload.operations)||payload.operations.length<1||payload.operations.length>100)invalid();payload.operations.forEach(productMutation);}
   else if(command.action==='product-approve'){exactKeys(payload,['intentId','proposalId','entityId','baseRevision','payloadHash']);assertTechnical(payload.proposalId);assertTechnical(payload.entityId);integer(payload.baseRevision);decodeE2eeBytes(payload.payloadHash,32);}
   else if(command.action==='product-bootstrap-start'){exactKeys(payload,['intentId','bootstrapId','sourceManifestHash','expectedCount']);assertTechnical(payload.bootstrapId);decodeE2eeBytes(payload.sourceManifestHash,32);integer(payload.expectedCount,0,10000);}
   else if(command.action==='product-bootstrap-stage'){exactKeys(payload,['intentId','bootstrapId','partIndex','items']);assertTechnical(payload.bootstrapId);integer(payload.partIndex,0,9999);if(!Array.isArray(payload.items)||payload.items.length<1||payload.items.length>100)invalid();for(const item of payload.items){exactKeys(item,['operation','authorId']);productMutation(item.operation);assertTechnical(item.authorId);}}
   else if(command.action==='product-bootstrap-complete'){exactKeys(payload,['intentId','bootstrapId','parts','expectedCount']);assertTechnical(payload.bootstrapId);integer(payload.expectedCount,0,10000);if(!Array.isArray(payload.parts)||payload.parts.length>10000)invalid();for(const part of payload.parts){exactKeys(part,['partIndex','proofHash']);integer(part.partIndex,0,9999);decodeE2eeBytes(part.proofHash,32);}}
   else if(command.action==='advice-issue'){exactKeys(payload,['intentId','dayKey','collection','expectedCount','objectId','payloadHash']);assertTechnical(payload.dayKey);assertTechnical(payload.objectId);decodeE2eeBytes(payload.payloadHash,32);integer(payload.expectedCount,0,8);if(!['aurora','philosophers'].includes(String(payload.collection))||payload.objectId!=='advice-live:'+payload.intentId)invalid();}
   else if(command.action==='stoicheion-grant'){exactKeys(payload,['intentId','kind','action','position','expectedRevision','periodKey','objectId','payloadHash']);integer(payload.expectedRevision);assertTechnical(payload.periodKey);decodeE2eeBytes(payload.payloadHash,32);if(payload.position!==null)integer(payload.position,0,8);if(!['daily','spread','timeline'].includes(String(payload.kind))||!['draw','spread-card','reveal','reroll'].includes(String(payload.action))||payload.objectId!=='stoicheion-live:'+payload.intentId)invalid();}
  }else if(baseId.startsWith('enrollment:')){
   if(baseId!=='enrollment:'+command.scopeId||command.action!=='enroll'||command.deviceId!=='recovery')invalid();
   exactKeys(payload,['challenge','capsule','historyCapsules','selfProof']);exactKeys(payload.challenge,['id','scopeId','userId','role','sessionHash','deviceId','signingKey','receivingKey','nonce','expiresAt']);const challenge=payload.challenge;
   if(challenge.scopeId!==command.scopeId||challenge.userId!==options.actor.ownerId||challenge.deviceId!==options.actor.deviceId||challenge.signingKey!==options.selfKeys.signingKey||challenge.receivingKey!==options.selfKeys.receivingKey
    ||!['owner','writer','commenter','reader'].includes(String(challenge.role))||!Array.isArray(payload.historyCapsules))invalid();integer(challenge.expiresAt,1);if(typeof challenge.sessionHash!=='string'||!/^[a-f0-9]{64}$/.test(challenge.sessionHash))invalid();
   const prefix=encoder.encode('GENESIS-E2EE-ENROLLMENT\0v1\0'),body=canonicalE2eeValue(challenge),proof=new Uint8Array(prefix.length+body.length);proof.set(prefix);proof.set(body,prefix.length);
   try{if(!await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},await signingPublicKey(challenge.signingKey as string),decodeE2eeBytes(payload.selfProof,64),proof))invalid();current();}finally{body.fill(0);proof.fill(0);}
   await openRoot(payload.capsule,options.receivingKey,{ownerId:directory.ownerId,scopeId:directory.scopeId,cryptoEpoch:directory.cryptoEpoch,keyId:directory.keyId,recipientId:options.actor.deviceId});current();
   for(const history of payload.historyCapsules){exactKeys(history,['cryptoEpoch','keyId','capsule']);integer(history.cryptoEpoch,1,directory.cryptoEpoch-1);assertTechnical(history.keyId);
    await openRoot(history.capsule,options.receivingKey,{ownerId:directory.ownerId,scopeId:directory.scopeId,cryptoEpoch:history.cryptoEpoch,keyId:history.keyId as string,recipientId:options.actor.deviceId});current();}
  }else if(baseId.startsWith('aurora-manifest:')){
   exactKeys(payload,['id','methodVersion','objectId','payloadHash']);assertTechnical(payload.id);assertTechnical(payload.objectId);decodeE2eeBytes(payload.payloadHash,32);
   if(baseId!=='aurora-manifest:'+payload.id||command.action!=='aurora-result'||command.deviceId!==options.actor.deviceId||typeof payload.methodVersion!=='string')invalid();
  }else invalid();claim(domain,id,directory.scopeId,'product-control');
 };
 for(const id of options.controlHistory)if(!claimed('local-snapshot',id))await inspectControl(await metadata('local-snapshot',id),id,'local-snapshot');
 for(const id of options.outbox){
  if(claimed('outbox',id))continue;
  const value=await metadata('outbox',id);
  if(id.startsWith('service:')||id.startsWith('enrollment:')||id.startsWith('aurora-manifest:'))await inspectControl(value,id,'outbox');
  else if(id==='advice-pending-v1'||id==='advice-policy-v1'){
   if(!options.personalScopeId)invalid();const directory=await options.directory(options.personalScopeId,()=>true);if(directory.kind!=='personal')invalid();
   const {inspectAdviceLocalCell}=await import('./advice-product.ts');inspectAdviceLocalCell(id,value,options.actor.ownerId,directory.scopeId);current();claim('outbox',id,directory.scopeId,'advice-job');
  }else if(/^stoicheion-job:(daily|spread|timeline)$/.test(id)){
   object(value);object(value.content);assertTechnical(value.content.scopeId);const directory=await options.directory(value.content.scopeId,()=>true);if(directory.kind!=='personal')invalid();
   const {inspectStoicheionLocalJob}=await import('./stoicheion-product.ts');inspectStoicheionLocalJob(value,options.actor.ownerId,directory.scopeId,id.slice('stoicheion-job:'.length) as 'daily'|'spread'|'timeline');current();claim('outbox',id,directory.scopeId,'stoicheion-job');
  }else if(id.startsWith('membership:'))await membership(value,id);
  else if(id.startsWith('rotation:')){
   exactKeys(value,['protocol','roles','manifest','packet']);if(value.protocol!==1)invalid();const checked=await rotation(value.packet),payload=checked.command.payload;
   if(id!=='rotation:'+digest(encoder.encode(`${checked.directory.scopeId}\0${payload.membershipHash}`)))invalid();
   const expected=[...(payload.roleChanges as {deviceId:string;role:string}[]),...(payload.revokedDeviceIds as string[]).map(deviceId=>({deviceId,role:null}))].sort((a,b)=>a.deviceId.localeCompare(b.deviceId));
   if(!equal([...roles(value.roles)].sort((a,b)=>a.deviceId.localeCompare(b.deviceId)),expected))invalid();exactKeys(value.manifest,['manifestHash','objectCount']);if(value.manifest.manifestHash!==payload.retiredManifestHash||value.manifest.objectCount!==payload.retiredObjectCount)invalid();claim('outbox',id,checked.directory.scopeId,'membership-rotation');
  }
 }
}
