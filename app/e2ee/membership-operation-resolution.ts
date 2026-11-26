import type {MembershipOperationDrafts} from './membership-operation-drafts.ts';
import type {MembershipAtomicStager} from './membership-atomic-stager.ts';

export interface MembershipOperationResolutionPorts{
 current:()=>void;drafts:Pick<MembershipOperationDrafts,'cancel'|'fork'|'preview'|'inspect'>;stager:Pick<MembershipAtomicStager,'inspect'|'cancel'>;
}
/** Durable local cancellation precedes HTTP. A lost/committed outcome never
 * silently creates a new semantic operation or renews an old signature. */
export async function cancelMembershipOperation(id:string,ports:MembershipOperationResolutionPorts){
 ports.current();await ports.drafts.cancel(id);ports.current();
 try{await ports.stager.inspect(id);ports.current();}
 catch(error){if(error instanceof Error&&error.message==='E2EE_MEMBERSHIP_PLAN_REQUIRED')return{intentId:id,outcome:'cancelled' as const,server:'absent' as const};throw error;}
 try{await ports.stager.cancel(id);ports.current();return{intentId:id,outcome:'cancelled' as const,server:'cancelled' as const};}
 catch(error){if(error instanceof Error&&error.message==='E2EE_MEMBERSHIP_OUTCOME_REVIEW_REQUIRED')return{intentId:id,outcome:'reconcile-required' as const};throw error;}
}
export async function resolveMembershipOperation(id:string,ports:MembershipOperationResolutionPorts){
 const outcome=await cancelMembershipOperation(id,ports);ports.current();if(outcome.outcome!=='cancelled')throw new Error('E2EE_MEMBERSHIP_OUTCOME_REVIEW_REQUIRED');
 const next=await ports.drafts.fork(id);ports.current();let draft=await ports.drafts.inspect(next);ports.current();if(!draft.proposal&&!draft.cancelled){draft=await ports.drafts.preview(next);ports.current();}return{previousIntentId:id,intentId:next,draft};
}
