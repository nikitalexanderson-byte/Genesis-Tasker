import {sha256} from '@noble/hashes/sha2.js';
import {canonicalE2eeValue,type WireValue} from './commands.ts';
import {assertTechnical,exactKeys} from './keys.ts';
import {encodeE2eeBytes} from './envelope.ts';
import {samePrivateJson as same} from './product-json.ts';
import {E2eeDeviceDocument} from './device-document.ts';
import type {WebPrivateAccount} from './product-session.ts';

type ObjectValue=Record<string,unknown>;
export type RecipientResponse={id:string;scopeId:string;kind:'space'|'project';resourceId:string;spaceId:string;state:'unanswered'|'pending'|'declined'|'admitted'|'expired'|'unavailable';acceptedAt:string|null;deviceApprovalRequired:true};
export type RecipientRequest={format:'genesis-invitation-recipient-request-v1';ownerId:string;id:string;accept:boolean;intentId:string;result:ObjectValue|null};
const invalid=():never=>{throw new Error('E2EE_INVITATION_RESPONSE_INVALID');};
export function invitationRecipientIntent(ownerId:string,id:string,accept:boolean){assertTechnical(ownerId);assertTechnical(id);if(typeof accept!=='boolean')invalid();const bytes=canonicalE2eeValue({format:'genesis-invitation-recipient-intent-v1',ownerId,id,accept});try{return'invitation-response:'+encodeE2eeBytes(sha256(bytes));}finally{bytes.fill(0);}}
export function validateRecipientResponse(input:unknown,id:string):RecipientResponse{
 exactKeys(input,['id','scopeId','kind','resourceId','spaceId','state','acceptedAt','deviceApprovalRequired']);for(const key of ['id','scopeId','resourceId','spaceId'])assertTechnical(input[key]);
 if(input.id!==id||!['space','project'].includes(String(input.kind))||!['unanswered','pending','declined','admitted','expired','unavailable'].includes(String(input.state))||input.deviceApprovalRequired!==true||input.acceptedAt!==null&&(typeof input.acceptedAt!=='string'||!Number.isFinite(Date.parse(input.acceptedAt))))invalid();return structuredClone(input) as RecipientResponse;
}
export function validateRecipientRequest(input:unknown,ownerId:string,intentId:string):RecipientRequest{
 exactKeys(input,['format','ownerId','id','accept','intentId','result']);if(input.format!=='genesis-invitation-recipient-request-v1'||input.ownerId!==ownerId||typeof input.accept!=='boolean'||input.intentId!==intentId||invitationRecipientIntent(ownerId,String(input.id),input.accept)!==intentId||input.result!==null&&(!input.result||typeof input.result!=='object'||Array.isArray(input.result)))invalid();return structuredClone(input) as RecipientRequest;
}
export function validateRecipientInvitationPage(input:unknown,after:string,limit:number){
 exactKeys(input,['invitations','nextAfter','checkpointHash','directoryRevision']);if(!Array.isArray(input.invitations)||input.invitations.length>limit)invalid();let previous=after;
 for(const row of input.invitations){exactKeys(row,['id','role','expiresAt','scope','spaceTitle','projectTitle','inviterName','encrypted','pendingApproval','admitted','deviceApprovalRequired']);assertTechnical(row.id);
  if(String(row.id)<=previous||!['space','project'].includes(String(row.scope))||!(row.scope==='space'?['admin','member','guest']:['manager','member','commenter','viewer']).includes(String(row.role))||typeof row.expiresAt!=='string'||!Number.isFinite(Date.parse(row.expiresAt))||['spaceTitle','projectTitle','inviterName'].some(key=>typeof row[key]!=='string'||String(row[key]).length>2000)||['encrypted','pendingApproval','admitted','deviceApprovalRequired'].some(key=>typeof row[key]!=='boolean')||row.encrypted&&row.projectTitle!=='')invalid();previous=String(row.id);
 }
 if(input.nextAfter!==null&&(input.invitations.length!==limit||input.nextAfter!==previous||previous<=after))invalid();return{invitations:structuredClone(input.invitations) as ObjectValue[],nextAfter:input.nextAfter as string|null};
}
export interface InvitationRecipientPorts{
 ownerId:string;current:()=>void;page:(after:string,limit:number)=>Promise<unknown>;state:(id:string)=>Promise<unknown>;service:(payload:{id:string;accept:boolean},intentId:string)=>Promise<unknown>;
 load:(id:string)=>Promise<{value:unknown;serial:number}|null>;save:(id:string,value:RecipientRequest,expected:number|null)=>Promise<number>;
}
export class InvitationRecipient{
 #serial:Promise<unknown>=Promise.resolve();constructor(private readonly ports:InvitationRecipientPorts){assertTechnical(ports.ownerId);}
 #run<T>(work:()=>Promise<T>){const task=this.#serial.catch(()=>undefined).then(async()=>{this.ports.current();return work();});this.#serial=task;return task;}
 list(){return this.#run(async()=>{const rows:ObjectValue[]=[];let after='';for(;;){const value=await this.ports.page(after,50);this.ports.current();const page=validateRecipientInvitationPage(value,after,50);rows.push(...page.invitations);if(rows.length>10000)throw new Error('E2EE_INVITATION_LIST_TOO_LARGE');if(page.nextAfter===null)return rows;after=page.nextAfter;}});}
 respond(id:string,accept:boolean){const intentId=invitationRecipientIntent(this.ports.ownerId,id,accept);return this.#run(async()=>{
  let saved=await this.ports.load(intentId);this.ports.current();let value:RecipientRequest;
  if(saved)value=validateRecipientRequest(saved.value,this.ports.ownerId,intentId);else{value={format:'genesis-invitation-recipient-request-v1',ownerId:this.ports.ownerId,id,accept,intentId,result:null};const serial=await this.ports.save(intentId,value,null);this.ports.current();if(serial!==1)invalid();const observed=await this.ports.load(intentId);this.ports.current();if(!observed||observed.serial!==serial||!same(observed.value,value))throw new Error('E2EE_LOCAL_CONFLICT');saved=observed;}
  if(value.id!==id||value.accept!==accept)throw new Error('E2EE_IDEMPOTENCY_CONFLICT');const receipt=value.result??await this.ports.service({id,accept},intentId);this.ports.current();exactKeys(receipt,['intentId','response','pendingApproval']);
  const original=validateRecipientResponse(receipt.response,id);if(receipt.intentId!==intentId||receipt.pendingApproval!==accept||original.state!==(accept?'pending':'declined'))invalid();
  const read=await this.ports.state(id);this.ports.current();exactKeys(read,['response','checkpointHash','directoryRevision']);const current=validateRecipientResponse(read.response,id);
  if(['scopeId','kind','resourceId','spaceId','acceptedAt'].some(key=>current[key as keyof RecipientResponse]!==original[key as keyof RecipientResponse])||!(accept?['pending','admitted']:['declined']).includes(current.state))throw new Error('E2EE_INVITATION_RESPONSE_CHANGED');
  if(value.result===null){const serial=await this.ports.save(intentId,{...value,result:structuredClone(receipt)},saved.serial);this.ports.current();const after=await this.ports.load(intentId);this.ports.current();if(serial!==saved.serial+1||!after||after.serial!==serial||!same(after.value,{...value,result:receipt}))throw new Error('E2EE_LOCAL_CONFLICT');}
  return accept?{projectId:current.kind==='project'?current.resourceId:'',spaceId:current.spaceId,pendingApproval:current.state==='pending',admitted:current.state==='admitted',deviceApprovalRequired:true,invitationId:id}:{ok:true};
 });}
}
export function webInvitationRecipient(account:WebPrivateAccount){const current=()=>{account.requireOpen();if(account.mode!=='online')throw new Error('E2EE_ONLINE_REQUIRED');},client=account.personal().client;
 const document=(id:string)=>new E2eeDeviceDocument<RecipientRequest>(account.device,'invitation-recipient:'+id,value=>validateRecipientRequest(value,account.ownerId,id),current);
 return new InvitationRecipient({ownerId:account.ownerId,current,page:(after,limit)=>client.readSharedInvitationPage(after,limit),state:id=>client.readSharedInvitationResponse(id),service:(payload,id)=>client.executeService('shared-invitation-respond',payload as unknown as Record<string,WireValue>,id),load:id=>document(id).load(),save:async(id,value,expected)=>(await document(id).save(value,expected)).serial});
}
