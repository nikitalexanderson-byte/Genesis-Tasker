import {E2eeDeviceDocument} from './device-document.ts';
import {E2eeScopeSetup,type ScopeSetupTransport} from './scope-setup.ts';
import {assertTechnical,exactKeys,type RecoveryKit} from './keys.ts';
import {decodeE2eeBytes} from './envelope.ts';
import {samePrivateJson} from './product-json.ts';
import type {WebPrivateAccount} from './product-session.ts';
import {snapshotE2eeValue,type WireValue} from './commands.ts';

export type PrivateSpaceDraft={title:string;description:string;invitations:{email:string;role:'admin'|'member'|'guest';permissions:Record<'createProjects'|'editTasks'|'organizeTasks'|'comment'|'manageProjects'|'inviteMembers',boolean>}[];
 coverImage:string|null;coverPosition:{x:number;y:number}};
export type PrivateSpacePreparation={intentId:string;kind:'space';resourceId:string;scopeId:string;spaceId:string;inboxId:string;statuses:{id:string;isDone:0|1}[];state:'preparing';bootstrapHash:string;directoryRevision:1;checkpointHash:string;createdAt:string};
type Intent={format:'genesis-private-resource-create-v1';ownerId:string;intentId:string;scopeId:string;resourceId:string;kind:'space';input:PrivateSpaceDraft;createdAt:string;preparation:PrivateSpacePreparation|null;phase:'draft'|'prepared'};
const prefix='shared-resource-create:';
function invalid():never{throw new Error('E2EE_PRIVATE_RESOURCE_CREATE_INVALID');}
export function validatePrivateSpaceDraft(input:unknown):PrivateSpaceDraft{
 exactKeys(input,['title','description','invitations','coverImage','coverPosition']);
 if(typeof input.title!=='string'||input.title.trim().length<1||input.title.length>120||typeof input.description!=='string'||input.description.length>5000
  ||!Array.isArray(input.invitations)||input.invitations.length>20||input.coverImage!==null&&(typeof input.coverImage!=='string'||input.coverImage.length>4*1024*1024||input.coverImage!==''&&!/^data:image\/(?:png|jpeg|webp);base64,/.test(input.coverImage)))invalid();
 exactKeys(input.coverPosition,['x','y']);for(const value of Object.values(input.coverPosition))if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>100)invalid();
 const emails=new Set<string>();for(const invite of input.invitations){exactKeys(invite,['email','role','permissions']);if(typeof invite.email!=='string'||invite.email.length>320||!/^\S+@\S+\.\S+$/.test(invite.email)||emails.has(invite.email.toLowerCase())||!['admin','member','guest'].includes(String(invite.role)))invalid();emails.add(invite.email.toLowerCase());
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

/** Durable PREPARATION, never a plaintext create or a completed space. The
 * normal controllers still have to migrate space/inbox, retain all local work,
 * publish initial private records and review the intended recipients. */
export class E2eePrivateResourceCreation{
 #serial:Promise<unknown>=Promise.resolve();
 constructor(private readonly account:WebPrivateAccount,private readonly transport:Pick<ScopeSetupTransport,'directory'>){}
 #current(){this.account.requireOpen();}
 #run<T>(fn:()=>Promise<T>){const pending=this.#serial.catch(()=>undefined).then(async()=>{this.#current();return fn();});this.#serial=pending;return pending;}
 #document(id:string){assertTechnical(id);return new E2eeDeviceDocument<Intent>(this.account.device,prefix+id,value=>{
  exactKeys(value,['format','ownerId','intentId','scopeId','resourceId','kind','input','createdAt','preparation','phase']);
  if(value.format!=='genesis-private-resource-create-v1'||value.ownerId!==this.account.ownerId||value.intentId!==id||value.kind!=='space'||!['draft','prepared'].includes(String(value.phase))||typeof value.createdAt!=='string'||!Number.isFinite(Date.parse(value.createdAt)))invalid();
  assertTechnical(value.scopeId);assertTechnical(value.resourceId);validatePrivateSpaceDraft(value.input);
  if(value.preparation!==null)validatePrivateSpacePreparation(value.preparation,{intentId:id,scopeId:value.scopeId,resourceId:value.resourceId});else if(value.phase==='prepared')invalid();return value as Intent;
 },()=>this.#current());}
 create(input:PrivateSpaceDraft){const held=validatePrivateSpaceDraft(input);return this.#run(async()=>{
  const id=crypto.randomUUID(),resourceId=crypto.randomUUID(),scopeId='space:'+crypto.randomUUID(),value:Intent={format:'genesis-private-resource-create-v1',ownerId:this.account.ownerId,intentId:id,scopeId,resourceId,kind:'space',input:held,createdAt:new Date().toISOString(),preparation:null,phase:'draft'};
  const document=this.#document(id);await document.save(value,null);this.#current();const read=await document.load();if(!read||!samePrivateJson(read.value,value))throw new Error('E2EE_PRIVATE_RESOURCE_CREATE_UNVERIFIED');return id;
 });}
 async inspect(id:string){this.#current();const saved=await this.#document(id).load();this.#current();if(!saved)throw new Error('E2EE_PRIVATE_RESOURCE_CREATE_REQUIRED');return structuredClone(saved.value);}
 async pending(){this.#current();const ids=await this.account.device.vault.listLocal('draft',prefix);this.#current();const values:Intent[]=[];for(const key of ids)values.push(await this.inspect(key.slice(prefix.length)));return values;}
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
   if(!['preparing','active'].includes(directory.state)||directory.kind!=='space'||directory.resourceId!==intent.resourceId)invalid();
   if(before.value.phase!=='prepared')await document.save({...before.value,phase:'prepared'},before.serial);this.#current();return{intent:await this.inspect(id),directory};
  }finally{held.fill(0);}
 }).finally(()=>held.fill(0));}
}
