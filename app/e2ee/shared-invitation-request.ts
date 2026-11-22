import {sha256} from '@noble/hashes/sha2.js';
import {canonicalE2eeValue,type WireValue} from './commands.ts';
import {assertTechnical,exactKeys} from './keys.ts';
import {samePrivateJson as same} from './product-json.ts';
import type {SharedDomainBinding} from './shared-domain.ts';

export type SharedInvitationService={action:'shared-invitations-issue'|'shared-invitation-revoke';payload:Record<string,WireValue>;intentId:string;ids:string[]};
const invalid=():never=>{throw new Error('E2EE_SHARED_INVITATION_INVALID');};
const permissionNames=['createProjects','editTasks','organizeTasks','comment','manageProjects','inviteMembers'];
/** A stable technical ID is independent of email/content and survives a lost
 * response. The complete original ordinary request is retained by SharedLive. */
function invitationId(actorId:string,scopeId:string,intentId:string){
 const bytes=canonicalE2eeValue({format:'genesis-shared-invitation-id-v1',actorId,scopeId,intentId}),hash=sha256(bytes);bytes.fill(0);hash[6]=(hash[6]&15)|80;hash[8]=(hash[8]&63)|128;
 const hex=Array.from(hash.subarray(0,16),byte=>byte.toString(16).padStart(2,'0')).join('');hash.fill(0);return hex.slice(0,8)+'-'+hex.slice(8,12)+'-'+hex.slice(12,16)+'-'+hex.slice(16,20)+'-'+hex.slice(20);
}
export function sharedInvitationService(binding:SharedDomainBinding,actorId:string,method:string,path:string,body:Record<string,unknown>,intentId:string):SharedInvitationService|null{
 const parts=path.split('?')[0].split('/').filter(Boolean);if(parts[0]!=='invitations')return null;
 assertTechnical(actorId);assertTechnical(intentId);assertTechnical(binding.scopeId);const extra=Object.hasOwn(body,'requestId')?['requestId']:[];
 if(method==='POST'&&parts.length===1){
  exactKeys(body,['email','role',...(binding.kind==='space'&&Object.hasOwn(body,'permissions')?['permissions']:[]),...extra]);
  if(typeof body.email!=='string'||body.email.length>320||!/^\S+@\S+\.\S+$/.test(body.email.trim())||typeof body.role!=='string'||!(binding.kind==='space'?['admin','member','guest']:['manager','member','commenter','viewer']).includes(body.role))invalid();
  const email=body.email.trim().toLowerCase();if(binding.kind==='space'&&!/^\S+@(?:gmail|googlemail)\.com$/.test(email))invalid();
  let permissions:Record<string,boolean>|null=null;if(binding.kind==='space'&&body.permissions!==undefined&&body.permissions!==null){exactKeys(body.permissions,permissionNames);if(Object.values(body.permissions).some(value=>typeof value!=='boolean'))invalid();permissions=structuredClone(body.permissions) as Record<string,boolean>;}
  const id=invitationId(actorId,binding.scopeId,intentId),invite:Record<string,WireValue>={id,email,role:body.role};if(binding.kind==='space')invite.permissions=permissions;return{action:'shared-invitations-issue',intentId:'shared-invitation-issue:'+intentId,payload:{invitations:[invite]},ids:[id]};
 }
 if(method==='DELETE'&&parts.length===2){exactKeys(body,extra);assertTechnical(parts[1]);return{action:'shared-invitation-revoke',intentId:'shared-invitation-revoke:'+intentId,payload:{id:parts[1]},ids:[parts[1]]};}
 throw new Error('E2EE_SHARED_OPERATION_REVIEW_REQUIRED');
}
export function verifySharedInvitationResult(plan:SharedInvitationService,actorId:string,result:unknown,state:unknown){
 exactKeys(state,['invitations','checkpointHash','directoryRevision']);if(!Array.isArray(state.invitations)||state.invitations.length!==plan.ids.length)invalid();
 if(plan.action==='shared-invitation-revoke'){
  exactKeys(result,['intentId','id','revoked']);if(result.intentId!==plan.intentId||result.id!==plan.ids[0]||result.revoked!==true)invalid();const row=state.invitations[0];exactKeys(row,['id','email','role','permissions','createdBy','state']);if(row.id!==plan.ids[0]||row.state!=='revoked')throw new Error('E2EE_RECIPIENT_REVIEW_REQUIRED');return{ok:true};
 }
 exactKeys(result,['intentId','invitations','deviceApprovalRequired']);if(result.intentId!==plan.intentId||result.deviceApprovalRequired!==true||!Array.isArray(result.invitations)||result.invitations.length!==plan.ids.length)invalid();
 const expected=plan.payload.invitations as Record<string,WireValue>[];
 for(const [index,row]of result.invitations.entries()){exactKeys(row,['id','expiresAt']);if(row.id!==plan.ids[index]||typeof row.expiresAt!=='string'||!Number.isFinite(Date.parse(row.expiresAt)))invalid();
  const read=state.invitations[index];exactKeys(read,['id','email','role','permissions','createdBy','state']);if(read.id!==row.id||read.email!==expected[index].email||read.role!==expected[index].role||read.createdBy!==actorId||!same(read.permissions,expected[index].permissions??null)||!['pending','consumed'].includes(String(read.state)))throw new Error('E2EE_RECIPIENT_REVIEW_REQUIRED');
 }return{invitation:{...result.invitations[0],deviceApprovalRequired:true},deviceApprovalRequired:true};
}
