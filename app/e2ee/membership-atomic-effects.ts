import {validateSharedRecordBody} from './shared-domain.ts';
import {samePrivateJson as same} from './product-json.ts';
import {validateMembershipOperation,type MembershipOperationPlan} from './membership-operation-plan.ts';
import {validateMembershipAtomicPage,membershipAtomicPageRef,type MembershipAtomicPage,type MembershipAtomicPlan,type MembershipAtomicProducts} from './membership-atomic-contract.ts';
import {validateMembershipAtomicReview,type MembershipAtomicReview} from './membership-atomic-review.ts';
import {membershipOperationEdits} from './membership-operation-edits.ts';
import type {MembershipAtomicScopePreview} from './membership-atomic-preview.ts';
import type {ProductEntity,ProductMutation} from './product-contract.ts';
import type {ProductVersion} from './shared-product.ts';

function invalid():never{throw new Error('E2EE_MEMBERSHIP_EFFECTS_INCOMPLETE');}
/** The collector has already authenticated the request/rosters/writers. This
 * reconstructs the COMPLETE declared effects, never a permissive JSON edit. */
export function membershipAtomicEffects(plan:MembershipAtomicPlan,input:MembershipAtomicPage[]){
 if(input.length!==plan.pages.length)invalid();let header:Record<string,unknown>|null=null;const grants:unknown[]=[],products:MembershipAtomicProducts[]=[];
 const result:Omit<MembershipOperationPlan,'operation'>={format:'genesis-membership-operation-plan-v1',changes:[],scopeIds:[...plan.scopeIds],requiredScopes:[],clearAssignments:[],revokeInvitations:[],roleEvents:[]};
 for(const [index,raw]of input.entries()){const page=validateMembershipAtomicPage(raw);if(!same(membershipAtomicPageRef(index,page),plan.pages[index]))invalid();
  switch(page.kind){
   case'operation':if(header)invalid();header=page.items[0] as Record<string,unknown>;break;
   case'operation-grants':grants.push(...page.items);break;
   case'acl':result.changes.push(...page.items);break;
   case'clear-assignments':result.clearAssignments.push(...page.items);break;
   case'revoke-invitations':result.revokeInvitations.push(...page.items);break;
   case'role-events':result.roleEvents.push(...page.items);break;
   case'product-operations':products.push(...page.items);break;
   case'anchors':for(const row of page.items){if(!row.productIndexHash)throw new Error('E2EE_MEMBERSHIP_REVIEW_REQUIRED');result.requiredScopes.push({scopeId:row.scopeId,ownerId:row.ownerId,state:'active',root:{scopeId:row.scopeId,entityId:row.entityId,generation:row.generation,directoryRevision:row.directoryRevision,checkpointHash:row.checkpointHash,revision:row.revision,payloadHash:row.payloadHash,productIndexHash:row.productIndexHash}});}break;
   default:invalid();
  }
 }
 if(!header||!same(result.requiredScopes.map(scope=>scope.scopeId).sort(),plan.scopeIds))invalid();
 const operation=validateMembershipOperation(header.kind==='project-grants'?{...header,grants}:header);if(operation.kind!=='project-grants'&&grants.length)invalid();
 return{plan:{...result,operation} as MembershipOperationPlan,products};
}
export type MembershipPrivateEffects={taskCount:number;categoryCount:number;eventCount:number;renames:{entityId:string;before:string;after:string}[]};
export type MembershipAtomicEffectsInput={request:MembershipAtomicReview;scope:MembershipAtomicScopePreview;pages:MembershipAtomicPage[];entities:ProductEntity[];versions:ProductVersion[];candidates:ProductVersion[]};
/** An owner independently decrypts the old normal records and every proposed
 * immutable version. Only the exact normal effects may receive a new root.
 * A writer's signature alone cannot approve arbitrary private body changes. */
export function verifyMembershipAtomicPrivateEffects(input:MembershipAtomicEffectsInput){
 const {request,scope,entities,versions,candidates}=input,header=validateMembershipAtomicReview(request);if(!header.createdAt)throw new Error('E2EE_MEMBERSHIP_REVIEW_REQUIRED');
 const effects=membershipAtomicEffects(header.plan,input.pages),anchor=effects.plan.requiredScopes.find(row=>row.scopeId===scope.scopeId);if(!anchor||anchor.ownerId!==scope.ownerId||anchor.root.entityId!==scope.kind+':'+scope.resourceId)invalid();
 const binding={scopeId:scope.scopeId,kind:scope.kind,resourceId:scope.resourceId},renames:MembershipPrivateEffects['renames']=[];
 const operation=effects.plan.operation;
 if(operation.kind==='category-permissions'&&operation.rename&&scope.kind==='space'&&scope.resourceId===operation.spaceId){
  const id='category:'+operation.categoryId,previous=versions.find(row=>row.entityId===id),proposed=candidates.find(row=>row.entityId===id);if(!previous||!proposed)invalid();
  const oldBody=validateSharedRecordBody(binding,'category',previous.body,previous),nextBody=validateSharedRecordBody(binding,'category',proposed.body,proposed);
  if(oldBody.table!=='shared_member_categories'||nextBody.table!==oldBody.table||nextBody.record.id!==operation.categoryId||typeof nextBody.record.title!=='string'||typeof oldBody.record.title!=='string')invalid();
  // The complete ciphertext and independently verified writer bind this value.
  // The owning user sees these decrypted before/after values before approval.
  effects.plan.operation={...operation,privateTitle:nextBody.record.title};renames.push({entityId:id,before:oldBody.record.title,after:nextBody.record.title});
 }
 const expected=membershipOperationEdits({binding,actorId:header.plan.actorId,intentId:header.plan.intentId,createdAt:header.createdAt,plan:effects.plan,snapshot:{actorId:header.plan.actorId},entities,versions});
 const operations=effects.products.filter(row=>row.scopeId===scope.scopeId).flatMap(row=>row.operations);if(expected.length!==operations.length||candidates.length!==operations.length||new Set(candidates.map(row=>row.entityId)).size!==operations.length)invalid();
 for(const edit of expected){const operation=operations.find(row=>row.entityId===edit.entityId),version=candidates.find(row=>row.entityId===edit.entityId);
  if(!operation||!version||operation.action!==edit.action||operation.kind!==edit.kind||operation.expectedRevision!==edit.expectedRevision||operation.parentId!==edit.parentId||!same(operation.metadata,edit.metadata))invalid();
  if(version.scopeId!==scope.scopeId||version.entityId!==edit.entityId||version.kind!==edit.kind||version.revision!==edit.expectedRevision+1||version.parentId!==edit.parentId||version.deleted!==(edit.action==='delete')||!same(version.metadata,edit.metadata)||!same(version.body,edit.body))invalid();
 }return{taskCount:expected.filter(row=>row.kind==='task').length,categoryCount:expected.filter(row=>row.kind==='category').length,eventCount:expected.filter(row=>row.kind==='history').length,renames};
}
/** Explicit uncommitted review reference. Reading it validates the signed
 * envelope/reference, and never installs a business head or marks a commit. */
export function membershipAtomicCandidate(operation:ProductMutation,actorId:string,createdAt:string):ProductEntity{
 return{entityId:operation.entityId,kind:operation.kind,revision:operation.expectedRevision+1,domain:operation.domain,objectId:operation.objectId,payloadHash:operation.payloadHash,parentId:operation.parentId,authorId:actorId,deleted:operation.action==='delete',metadata:operation.metadata,updatedAt:createdAt};
}
