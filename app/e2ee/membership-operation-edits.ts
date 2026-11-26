import {sha256} from '@noble/hashes/sha2.js';
import {canonicalE2eeValue} from './commands.ts';
import {assertTechnical} from './keys.ts';
import {samePrivateJson as same} from './product-json.ts';
import {membershipBeforeHash} from './membership-contract.ts';
import {membershipProductIndexHash} from './membership-product-index.ts';
import {validateSharedRecordBody,sharedRecordKey,sharedBodyMetadata,sharedBodyParent,type SharedDomainBinding,type SharedRecordBody} from './shared-domain.ts';
import type {MembershipOperationPlan,MembershipOperationSnapshot} from './membership-operation-plan.ts';
import type {ProductEdit,ProductVersion} from './shared-product.ts';
import type {ProductEntity} from './product-contract.ts';

function eventId(actorId:string,intentId:string,projectId:string,userId:string){
 const input=canonicalE2eeValue({format:'genesis-membership-private-event-v2',actorId,intentId,projectId,userId}),bytes=sha256(input);input.fill(0);bytes[6]=(bytes[6]&15)|128;bytes[8]=(bytes[8]&63)|128;
 const value=Array.from(bytes.subarray(0,16),byte=>byte.toString(16).padStart(2,'0')).join('');bytes.fill(0);return`${value.slice(0,8)}-${value.slice(8,12)}-${value.slice(12,16)}-${value.slice(16,20)}-${value.slice(20)}`;
}
/** Pure effects composer. Ordinary domain validation still runs on EVERY
 * changed body. This creates no authority, signature, network or storage port. */
export function membershipOperationEffectEntities(binding:SharedDomainBinding,plan:Pick<MembershipOperationPlan,'clearAssignments'|'changes'>,entities:ProductEntity[]){
 const clears=plan.clearAssignments.some(row=>binding.kind==='project'&&row.projectId===binding.resourceId),categories=plan.changes.filter(row=>binding.kind==='space'&&row.table==='shared_member_categories'&&row.key.space_id===binding.resourceId);
 return entities.filter(row=>!row.deleted&&(row.kind==='task'&&clears||row.kind==='category'&&categories.some(change=>row.entityId==='category:'+change.key.id)));
}
export function membershipOperationEdits(input:{binding:SharedDomainBinding;actorId:string;intentId:string;createdAt:string;plan:MembershipOperationPlan;snapshot:Pick<MembershipOperationSnapshot,'actorId'>;entities:ProductEntity[];versions:ProductVersion[]}):ProductEdit[]{
 const {binding,actorId,intentId,createdAt,plan,snapshot}=input;assertTechnical(actorId);assertTechnical(intentId);if(!Number.isFinite(Date.parse(createdAt)))throw new Error('E2EE_MEMBERSHIP_OPERATION_INVALID');
 const scope=plan.requiredScopes.find(scope=>scope.scopeId===binding.scopeId);if(!scope||!scope.root.productIndexHash||membershipProductIndexHash(binding.scopeId,input.entities)!==scope.root.productIndexHash)throw new Error('E2EE_MEMBERSHIP_STALE');
 if(scope.root.entityId!==binding.kind+':'+binding.resourceId||snapshot.actorId!==actorId)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
 const clears=new Set(plan.clearAssignments.filter(row=>binding.kind==='project'&&row.projectId===binding.resourceId).map(row=>row.userId));
 const categories=plan.changes.filter(row=>binding.kind==='space'&&row.table==='shared_member_categories'&&row.key.space_id===binding.resourceId);
 const required=membershipOperationEffectEntities(binding,plan,input.entities);
 if(input.versions.length!==required.length||new Set(input.versions.map(row=>row.entityId)).size!==required.length||required.some(row=>!input.versions.some(version=>version.entityId===row.entityId)))throw new Error('E2EE_MEMBERSHIP_EFFECTS_INCOMPLETE');
 const edits:ProductEdit[]=[],edit=(body:SharedRecordBody,expectedRevision:number,action:ProductEdit['action']='update')=>{
  const value=validateSharedRecordBody(binding,body.kind,body);edits.push({action,entityId:sharedRecordKey(value.kind,value.record),kind:value.kind,expectedRevision,parentId:sharedBodyParent(value),metadata:sharedBodyMetadata(value),body:value});};
 const changedCategories=new Set<string>();
 for(const version of input.versions){const entity=required.find(row=>row.entityId===version.entityId);if(!entity||version.scopeId!==binding.scopeId||version.revision!==entity.revision||version.deleted||version.kind!==entity.kind||!same(version.metadata,entity.metadata))throw new Error('E2EE_MEMBERSHIP_STALE');
  const body=structuredClone(validateSharedRecordBody(binding,version.kind,version.body,version));
  if(version.kind==='task'){
   if(!clears.has(String(body.record.assignee_id)))continue;body.record.assignee_id=null;body.record.revision=version.revision+1;body.record.updated_by=actorId;body.record.updated_at=createdAt;edit(body,version.revision);
  }else{
   if(body.table!=='shared_member_categories')throw new Error('E2EE_MEMBERSHIP_EFFECTS_INCOMPLETE');const change=categories.find(row=>row.key.id===body.record.id);if(!change||!change.after)throw new Error('E2EE_MEMBERSHIP_EFFECTS_INCOMPLETE');
   if(membershipBeforeHash('shared_member_categories',{id:body.record.id,space_id:body.record.space_id,permissions_json:body.record.permissions_json,revision:body.record.revision})!==change.expectedHash)throw new Error('E2EE_MEMBERSHIP_SOURCE_DIVERGED');
   if(plan.operation.kind==='category-permissions'&&plan.operation.rename){if(plan.operation.spaceId!==binding.resourceId||plan.operation.categoryId!==change.key.id||plan.operation.privateTitle===undefined)throw new Error('E2EE_MEMBERSHIP_PRIVATE_INPUT_REQUIRED');body.record.title=plan.operation.privateTitle;}
   body.record.permissions_json=change.after.permissions_json as string;body.record.revision=change.after.revision as number;edit(body,version.revision);changedCategories.add(change.key.id);
  }
 }
 if(categories.some(change=>!changedCategories.has(change.key.id)))throw new Error('E2EE_MEMBERSHIP_EFFECTS_INCOMPLETE');
 if(binding.kind==='project')for(const event of plan.roleEvents.filter(row=>row.projectId===binding.resourceId)){
  const id=eventId(actorId,intentId,event.projectId,event.userId);if(input.entities.some(entity=>entity.entityId==='history:'+id))throw new Error('E2EE_MEMBERSHIP_STALE');
  edit({format:'genesis-shared-record-v1',kind:'history',scopeId:binding.scopeId,scopeKind:binding.kind,resourceId:binding.resourceId,table:'shared_audit_events',
   record:{id,project_id:event.projectId,actor_id:actorId,action:event.to===null?'member.removed':'member.role_changed',object_id:event.userId,created_at:createdAt,task_id:null,board_id:null,
    details_json:JSON.stringify({changes:{role:{from:event.from,to:event.to}},membershipIntentId:intentId})},related:{},execution:'history-only'},0,'create');
 }
 return edits.sort((a,b)=>a.entityId<b.entityId?-1:a.entityId>b.entityId?1:0);
}
