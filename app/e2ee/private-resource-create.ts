import {E2eeDeviceDocument} from './device-document.ts';
import {E2eeScopeSetup,type ScopeSetupTransport} from './scope-setup.ts';
import {assertTechnical,exactKeys,type RecoveryKit} from './keys.ts';
import {decodeE2eeBytes} from './envelope.ts';
import {samePrivateJson} from './product-json.ts';
import type {WebPrivateAccount} from './product-session.ts';
import {snapshotE2eeValue,type WireValue} from './commands.ts';
import {sharedBodyMetadata,sharedBodyParent,sharedRecordKey,type SharedRecordBody} from './shared-domain.ts';

export type PrivateSpaceDraft={title:string;description:string;invitations:{email:string;role:'admin'|'member'|'guest';permissions:Record<'createProjects'|'editTasks'|'organizeTasks'|'comment'|'manageProjects'|'inviteMembers',boolean>}[];
 coverImage:string|null;coverPosition:{x:number;y:number}};
export type PrivateSpacePreparation={intentId:string;kind:'space';resourceId:string;scopeId:string;spaceId:string;inboxId:string;statuses:{id:string;isDone:0|1}[];state:'preparing';bootstrapHash:string;directoryRevision:1;checkpointHash:string;createdAt:string};
const phases=['draft','prepared','migrated','values','invitations','complete'] as const;
type Intent={format:'genesis-private-resource-create-v1';ownerId:string;intentId:string;scopeId:string;resourceId:string;kind:'space';input:PrivateSpaceDraft;createdAt:string;preparation:PrivateSpacePreparation|null;phase:typeof phases[number]};
const prefix='shared-resource-create:';
function invalid():never{throw new Error('E2EE_PRIVATE_RESOURCE_CREATE_INVALID');}
export function validatePrivateSpaceDraft(input:unknown):PrivateSpaceDraft{
 exactKeys(input,['title','description','invitations','coverImage','coverPosition']);
 if(typeof input.title!=='string'||input.title.trim().length<1||input.title.length>160||typeof input.description!=='string'||input.description.length>5000
  ||!Array.isArray(input.invitations)||input.invitations.length>20||input.coverImage!==null&&(typeof input.coverImage!=='string'||input.coverImage.length>4*1024*1024||input.coverImage!==''&&!/^data:image\/(?:png|jpeg|webp);base64,/.test(input.coverImage)))invalid();
 exactKeys(input.coverPosition,['x','y']);for(const value of Object.values(input.coverPosition))if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>100)invalid();
 const emails=new Set<string>();for(const invite of input.invitations){exactKeys(invite,['email','role','permissions']);if(typeof invite.email!=='string'||invite.email.length>320||!/^\S+@(?:gmail|googlemail)\.com$/i.test(invite.email)||emails.has(invite.email.toLowerCase())||!['admin','member','guest'].includes(String(invite.role)))invalid();emails.add(invite.email.toLowerCase());
  exactKeys(invite.permissions,['createProjects','editTasks','organizeTasks','comment','manageProjects','inviteMembers']);if(Object.values(invite.permissions).some(value=>typeof value!=='boolean'))invalid();
 }
 return structuredClone(input) as PrivateSpaceDraft;
}
export function validatePrivateSpacePreparation(input:unknown,expected:{intentId:string;resourceId:string;scopeId:string}):PrivateSpacePreparation{
 exactKeys(input,['intentId','kind','resourceId','scopeId','spaceId','inboxId','statuses','state','bootstrapHash','directoryRevision','checkpointHash','createdAt']);
 if(input.intentId!==expected.intentId||input.resourceId!==expected.resourceId||input.scopeId!==expected.scopeId||input.spaceId!==expected.resourceId||input.kind!=='space'||input.state!=='preparing'||input.directoryRevision!==1
  ||typeof input.createdAt!=='string'||!Number.isFinite(Date.parse(input.createdAt))||!Array.isArray(input.statuses)||input.statuses.length!==2)invalid();
 assertTechnical(input.inboxId);decodeE2eeBytes(input.bootstrapHash,32);decodeE2eeBytes(input.checkpointHash,32);if(input.bootstrapHash!==input.checkpointHash)invalid();
 const ids=new Set<string>();for(const status of input.statuses){exactKeys(status,['id','isDone']);assertTechnical(status.id);if(ids.has(status.id)||![0,1].includes(status.isDone as number))invalid();ids.add(status.id);}
 if(input.statuses[0].isDone!==0||input.statuses[1].isDone!==1)invalid();return structuredClone(input) as PrivateSpacePreparation;
}

/** Durable creation journal. Product composition must migrate space/inbox,
 * read back private initial values and issue only pending invitations before
 * advancing to complete. This journal never grants recipient/device trust. */
export class E2eePrivateResourceCreation{
 #serial:Promise<unknown>=Promise.resolve();
 constructor(private readonly account:WebPrivateAccount,private readonly transport:Pick<ScopeSetupTransport,'directory'>,private readonly guard:()=>void=()=>{}){}
 #current(){this.guard();this.account.requireOpen();}
 #run<T>(fn:()=>Promise<T>){const pending=this.#serial.catch(()=>undefined).then(async()=>{this.#current();return fn();});this.#serial=pending;return pending;}
 #document(id:string){assertTechnical(id);return new E2eeDeviceDocument<Intent>(this.account.device,prefix+id,value=>{
  exactKeys(value,['format','ownerId','intentId','scopeId','resourceId','kind','input','createdAt','preparation','phase']);
  if(value.format!=='genesis-private-resource-create-v1'||value.ownerId!==this.account.ownerId||value.intentId!==id||value.kind!=='space'||!phases.includes(value.phase as Intent['phase'])||typeof value.createdAt!=='string'||!Number.isFinite(Date.parse(value.createdAt)))invalid();
  assertTechnical(value.scopeId);assertTechnical(value.resourceId);validatePrivateSpaceDraft(value.input);
  if(value.preparation!==null)validatePrivateSpacePreparation(value.preparation,{intentId:id,scopeId:value.scopeId,resourceId:value.resourceId});else if(value.phase!=='draft')invalid();return value as Intent;
 },()=>this.#current());}
 create(input:PrivateSpaceDraft){const held=validatePrivateSpaceDraft(input);return this.#run(async()=>{
  const id=crypto.randomUUID(),resourceId=crypto.randomUUID(),scopeId='space:'+crypto.randomUUID(),value:Intent={format:'genesis-private-resource-create-v1',ownerId:this.account.ownerId,intentId:id,scopeId,resourceId,kind:'space',input:held,createdAt:new Date().toISOString(),preparation:null,phase:'draft'};
  const document=this.#document(id);await document.save(value,null);this.#current();const read=await document.load();if(!read||!samePrivateJson(read.value,value))throw new Error('E2EE_PRIVATE_RESOURCE_CREATE_UNVERIFIED');return id;
 });}
 async inspect(id:string){this.#current();const saved=await this.#document(id).load();this.#current();if(!saved)throw new Error('E2EE_PRIVATE_RESOURCE_CREATE_REQUIRED');return structuredClone(saved.value);}
 async pending(){this.#current();const ids=await this.account.device.vault.listLocal('draft',prefix);this.#current();const values:Intent[]=[];for(const key of ids){const value=await this.inspect(key.slice(prefix.length));if(value.phase!=='complete')values.push(value);}return values;}
 advance(id:string,phase:Intent['phase']){return this.#run(async()=>{
  if(!phases.includes(phase))invalid();const document=this.#document(id),before=await document.load();this.#current();if(!before)throw new Error('E2EE_PRIVATE_RESOURCE_CREATE_REQUIRED');
  const at=phases.indexOf(before.value.phase),next=phases.indexOf(phase);if(next<=at)return before.value;
  if(next!==at+1||phase!=='draft'&&!before.value.preparation)throw new Error('E2EE_PRIVATE_RESOURCE_CREATE_UNVERIFIED');
  await document.save({...before.value,phase},before.serial);this.#current();return this.inspect(id);
 });}
 /** Invitations are routing intents only. Issuance/readback never approves a
  * recipient's keys or bypasses the subsequent membership/rotation review. */
 issueInvitations(id:string){return this.#run(async()=>{
  const intent=await this.inspect(id);this.#current();if(phases.indexOf(intent.phase)<phases.indexOf('values'))throw new Error('E2EE_PRIVATE_RESOURCE_CREATE_UNVERIFIED');
  const invitations=[];for(const [index,input]of intent.input.invitations.entries()){
   const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`GENESIS-PRIVATE-INVITATION\0v1\0${intent.ownerId}\0${id}\0${index}`)));this.#current();
   bytes[6]=(bytes[6]&15)|80;bytes[8]=(bytes[8]&63)|128;const hex=Array.from(bytes.subarray(0,16),value=>value.toString(16).padStart(2,'0')).join('');
   const invitationId=`${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
   invitations.push({id:invitationId,email:input.email.trim().toLowerCase(),role:input.role,permissions:input.permissions});
  }
  if(!invitations.length)return;const {client}=this.account.shared(intent.scopeId,'space',intent.resourceId),requestId=`resource-create-invitations:${id}`;
  const result=await client.executeService('shared-invitations-issue',{invitations:invitations as unknown as WireValue},requestId);this.#current();
  exactKeys(result,['intentId','invitations','deviceApprovalRequired']);if(result.intentId!==requestId||result.deviceApprovalRequired!==true||!Array.isArray(result.invitations)||result.invitations.length!==invitations.length)throw new Error('E2EE_INVALID_RECEIPT');
  for(const [at,row]of result.invitations.entries()){exactKeys(row,['id','expiresAt']);if(row.id!==invitations[at].id||typeof row.expiresAt!=='string'||!Number.isFinite(Date.parse(row.expiresAt)))throw new Error('E2EE_INVALID_RECEIPT');}
  const read=await client.readInvitationState(invitations.map(row=>row.id));this.#current();exactKeys(read,['invitations','checkpointHash','directoryRevision']);
  if(!Array.isArray(read.invitations)||read.invitations.length!==invitations.length)throw new Error('E2EE_INVALID_RESPONSE');
  for(const [index,row]of read.invitations.entries()){exactKeys(row,['id','email','role','permissions','createdBy','state']);const expected=invitations[index];
   if(row.id!==expected.id||row.email!==expected.email||row.role!==expected.role||row.createdBy!==this.account.ownerId||!samePrivateJson(row.permissions,expected.permissions)||!['pending','consumed'].includes(String(row.state)))throw new Error('E2EE_RECIPIENT_REVIEW_REQUIRED');
  }
 });}
 /** The normal immutable-version repository performs the initial value write.
  * Its fixed intent/time/revision survive a lost response; source records and
  * completed baseline are never rewritten to carry the intended user text. */
 applyInitialValues(id:string){return this.#run(async()=>{
  const intent=await this.inspect(id);this.#current();if(phases.indexOf(intent.phase)<phases.indexOf('migrated'))throw new Error('E2EE_MIGRATION_UNVERIFIED');
  const {records}=await this.account.sharedRecords(intent.scopeId,'space',intent.resourceId),source=await records.sourceTable('shared_spaces');this.#current();
  if(source.length!==1||source[0].id!==intent.resourceId)throw new Error('E2EE_PRIVATE_SEED_REQUIRED');
  const record={...source[0],title:intent.input.title.trim(),description:intent.input.description,cover_image:intent.input.coverImage,
   cover_x:intent.input.coverPosition.x,cover_y:intent.input.coverPosition.y,updated_at:intent.preparation!.createdAt,revision:2};
  const body:SharedRecordBody={format:'genesis-shared-record-v1',kind:'space',scopeId:intent.scopeId,scopeKind:'space',resourceId:intent.resourceId,table:'shared_spaces',record:record as SharedRecordBody['record'],related:{},execution:'live'};
  const requestId=`resource-create-values:${id}`;
  await records.product.stage([{action:'update',entityId:sharedRecordKey('space',body.record),kind:'space',expectedRevision:1,parentId:sharedBodyParent(body),metadata:sharedBodyMetadata(body),body}],requestId);this.#current();
  await records.flush(requestId);this.#current();const read=await records.get('space',intent.resourceId);this.#current();
  if(read.deleted||read.revision!==2||!samePrivateJson(read.body,body))throw new Error('E2EE_PRIVATE_RESOURCE_CREATE_UNVERIFIED');return intent;
 });}
 prepare(id:string,secret:Uint8Array,kit:RecoveryKit){const held=new Uint8Array(secret);let retainedKit:RecoveryKit;try{retainedKit=snapshotE2eeValue(kit);}catch(reason){held.fill(0);throw reason;}return this.#run(async()=>{
  try{
   if(this.account.mode!=='online')throw new Error('E2EE_ONLINE_REQUIRED');const intent=await this.inspect(id),target={ownerId:this.account.ownerId,scopeId:intent.scopeId,kind:'space' as const,resourceId:intent.resourceId};
   const setup=new E2eeScopeSetup(this.account.device,target,{directory:scope=>this.transport.directory(scope),bootstrap:async packet=>{
    this.#current();const result=await this.account.personal().client.executeService('resource-create-prepare',{bootstrap:packet as unknown as WireValue},id);this.#current();
    const preparation=validatePrivateSpacePreparation(result,intent),document=this.#document(id),before=await document.load();this.#current();if(!before||!samePrivateJson(before.value.input,intent.input))throw new Error('E2EE_LOCAL_CONFLICT');
    if(before.value.preparation&&!samePrivateJson(before.value.preparation,preparation))throw new Error('E2EE_IDEMPOTENCY_CONFLICT');
    if(!before.value.preparation)await document.save({...before.value,preparation},before.serial);this.#current();return result;
   }},()=>this.#current());
   await setup.prepare(held,retainedKit,0);this.#current();const directory=await setup.submit();this.#current();
   const document=this.#document(id),before=await document.load();this.#current();if(!before?.value.preparation)throw new Error('E2EE_PRIVATE_RESOURCE_CREATE_UNVERIFIED');
   if(!['preparing','uploading','verified','active'].includes(directory.state)||directory.kind!=='space'||directory.resourceId!==intent.resourceId)invalid();
   if(before.value.phase==='draft')await document.save({...before.value,phase:'prepared'},before.serial);this.#current();return{intent:await this.inspect(id),directory};
  }finally{held.fill(0);}
 }).finally(()=>held.fill(0));}
}
