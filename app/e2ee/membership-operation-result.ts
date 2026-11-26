import {validateMembershipOperationDraft,type MembershipOperationDraft} from './membership-operation-drafts.ts';
import type {MembershipAtomicReceipt} from './membership-atomic-receipts.ts';

/** A normal editor result comes from a durable reviewed operation. A receipt
 * must come from the completed atomic apply repository, never a UI return or
 * an imported file. A reviewed no-op needs no signature or network mutation. */
export function membershipOperationResult(input:MembershipOperationDraft,receipt:MembershipAtomicReceipt|null){
 const draft=validateMembershipOperationDraft(input,input.ownerId,input.intentId),proposal=draft.proposal;
 if(!draft.started||!draft.review||!proposal)throw new Error('E2EE_MEMBERSHIP_REVIEW_REQUIRED');
 const plan=proposal.plan,noEffects=!plan.scopeIds.length&&!plan.requiredScopes.length&&!plan.changes.length&&!plan.clearAssignments.length&&!plan.revokeInvitations.length&&!plan.roleEvents.length;
 if(receipt===null){if(draft.cancelled)throw new Error('E2EE_MEMBERSHIP_CANCELLED');if(!noEffects)throw new Error('E2EE_MEMBERSHIP_FINAL_REVIEW_REQUIRED');}
 else if(receipt.actorId!==draft.ownerId||receipt.intentId!==draft.intentId)throw new Error('E2EE_INVALID_RECEIPT');
 const userId='userId'in draft.operation?draft.operation.userId:null,change=plan.changes.find(row=>row.table==='shared_space_members'&&row.key.user_id===userId);
 const before=proposal.snapshot.rows.find(row=>row.table==='shared_space_members'&&row.key.user_id===userId),revision=change?.after?.project_access_revision??before?.before?.project_access_revision??0;
 if(typeof revision!=='number'||!Number.isSafeInteger(revision)||revision<0)throw new Error('E2EE_MEMBERSHIP_OPERATION_INVALID');
 return{ok:true,operationId:draft.intentId,revision,changed:plan.changes.length,membershipReceipt:receipt};
}
