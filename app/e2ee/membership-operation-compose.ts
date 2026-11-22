import {canonicalE2eeValue,type SignedE2eeCommand,type WireValue} from './commands.ts';
import {assertTechnical} from './keys.ts';
import {samePrivateJson as same} from './product-json.ts';
import {membershipProductIndexHash} from './membership-product-index.ts';
import {membershipOperationEdits,membershipOperationEffectEntities} from './membership-operation-edits.ts';
import {membershipAtomicDigest,membershipAtomicOperationPlan,membershipAtomicPages,membershipAtomicPlanHash,type MembershipAtomicProducts} from './membership-atomic-contract.ts';
import {prepareMembershipAtomicReview} from './membership-atomic-review-prepare.ts';
import type {MembershipOperationDrafts} from './membership-operation-drafts.ts';
import type {MembershipAtomicStager} from './membership-atomic-stager.ts';
import type {MembershipAtomicOwnerReviews} from './membership-atomic-owner.ts';
import type {MembershipGraphScope} from './membership-operation-plan.ts';
import type {SharedDomainBinding} from './shared-domain.ts';
import type {ProductEdit,ProductVersion} from './shared-product.ts';
import type {ProductEntity,ProductMutation} from './product-contract.ts';

export type MembershipCompositionScope=SharedDomainBinding&{ownerId:string;generation:number;directoryRevision:number;checkpointHash:string;entities:ProductEntity[]};
export interface MembershipOperationComposerPorts{
 ownerId:string;current:()=>void;
 drafts:Pick<MembershipOperationDrafts,'start'|'inspect'>;
 stager:Pick<MembershipAtomicStager,'create'|'inspect'|'readPlanPage'|'previewPage'|'reviewAuthorization'|'createPackets'|'cancel'>;
 owners:Pick<MembershipAtomicOwnerReviews,'create'|'putPart'|'review'|'inspect'|'part'|'exportApproval'|'acceptApproval'>;
 open:(scope:MembershipGraphScope)=>Promise<MembershipCompositionScope>;
 read:(scopeId:string,entity:ProductEntity)=>Promise<ProductVersion>;
 stage:(scopeId:string,edits:ProductEdit[],membershipIntentId:string,productIntentId:string)=>Promise<void>;
 prepare:(scopeId:string,productIntentId:string)=>Promise<ProductMutation[]>;
 sign:(scopeId:string,productIntentId:string,changeHash:string,operations:ProductMutation[])=>Promise<SignedE2eeCommand>;
}
/** Small enough for both one plan item and its signed packet, independent of
 * private body size. Adaptive batching always retains the complete suffix. */
export function membershipOperationEditBatches(edits:ProductEdit[]){const result:ProductEdit[][]=[];let offset=0,size=Math.min(100,edits.length);
 while(offset<edits.length){const batch=edits.slice(offset,offset+size),technical=batch.map(edit=>({action:edit.action,entityId:edit.entityId,kind:edit.kind,expectedRevision:edit.expectedRevision,
  domain:'shared-project',objectId:'product-version:00000000-0000-0000-0000-000000000000',payloadHash:'A'.repeat(43),parentId:edit.parentId,metadata:edit.metadata,proposalId:null}));
  let tooLarge=false;try{const bytes=canonicalE2eeValue({operations:technical} as unknown as WireValue);tooLarge=bytes.length>480*1024;bytes.fill(0);}catch(error){if(!(error instanceof Error)||error.message!=='E2EE_COMMAND_TOO_LARGE')throw error;tooLarge=true;}
  if(tooLarge){if(size<=1)throw new Error('E2EE_MEMBERSHIP_PAGE_TOO_LARGE');size=Math.max(1,Math.floor(size/2));continue;}result.push(batch);offset+=size;size=Math.min(100,edits.length-offset);
 }return result;
}
/** Ordinary reviewed operation -> immutable normal private versions -> complete
 * owner review. Every local product draft exists before the first upload.
 * This capability never grants implicit owner or final transaction consent. */
export class MembershipOperationComposer{
 #serial:Promise<unknown>=Promise.resolve();
 constructor(private readonly ports:MembershipOperationComposerPorts){assertTechnical(ports.ownerId);}
 #run<T>(action:()=>Promise<T>){const task=this.#serial.catch(()=>undefined).then(async()=>{this.ports.current();return action();});this.#serial=task;return task;}
 async #active(id:string){const draft=await this.ports.drafts.inspect(id);this.ports.current();if(!draft.cancelled)return;
  try{const state=await this.ports.stager.inspect(id);this.ports.current();if(!state.cancelRequested)await this.ports.stager.cancel(id);}
  catch(error){if(!(error instanceof Error)||error.message!=='E2EE_MEMBERSHIP_PLAN_REQUIRED')throw error;}throw new Error('E2EE_MEMBERSHIP_CANCELLED');
 }
 #scope(actual:MembershipCompositionScope,expected:MembershipGraphScope){const root=expected.root;
  if(actual.scopeId!==expected.scopeId||actual.ownerId!==expected.ownerId||root.entityId!==actual.kind+':'+actual.resourceId||actual.generation!==root.generation||actual.directoryRevision!==root.directoryRevision||actual.checkpointHash!==root.checkpointHash||!root.productIndexHash||membershipProductIndexHash(actual.scopeId,actual.entities)!==root.productIndexHash)throw new Error('E2EE_MEMBERSHIP_STALE');
  return actual;
 }
 compose(intentId:string){assertTechnical(intentId);return this.#run(async()=>{
  const draft=await this.ports.drafts.start(intentId);this.ports.current();const proposal=draft.proposal;if(draft.ownerId!==this.ports.ownerId||!draft.review||!proposal||draft.review.fingerprint!==proposal.fingerprint)throw new Error('E2EE_MEMBERSHIP_REVIEW_REQUIRED');
  const plan=proposal.plan;if(!plan.scopeIds.length)return{state:'unchanged' as const,intentId};
  const staged:{scopeId:string;intentId:string}[]=[];
  for(const scope of plan.requiredScopes){const opened=this.#scope(await this.ports.open(scope),scope);this.ports.current();const versions:ProductVersion[]=[];
   for(const entity of membershipOperationEffectEntities(opened,plan,opened.entities)){versions.push(await this.ports.read(scope.scopeId,entity));this.ports.current();}
   const edits=membershipOperationEdits({binding:opened,actorId:this.ports.ownerId,intentId,createdAt:draft.createdAt,plan,snapshot:proposal.snapshot,entities:opened.entities,versions});
   await this.#active(intentId);
   for(const [batch,items]of membershipOperationEditBatches(edits).entries()){const productId=membershipAtomicDigest({format:'genesis-membership-product-batch-v2',actorId:this.ports.ownerId,intentId,scopeId:scope.scopeId,batch});
    await this.ports.stage(scope.scopeId,items,intentId,productId);this.ports.current();await this.#active(intentId);staged.push({scopeId:scope.scopeId,intentId:productId});}
  }
  // Recheck the COMPLETE index set, including tasks created during local
  // staging. The server repeats these hashes in its final transaction lock.
  for(const scope of plan.requiredScopes){this.#scope(await this.ports.open(scope),scope);this.ports.current();}
  const products:MembershipAtomicProducts[]=[];
  for(const row of staged){await this.#active(intentId);products.push({...row,operations:await this.ports.prepare(row.scopeId,row.intentId)});this.ports.current();await this.#active(intentId);}
  const atomic=membershipAtomicOperationPlan(this.ports.ownerId,intentId,proposal.snapshot.spaceId,proposal.fingerprint,plan,products);
  await this.#active(intentId);await this.ports.stager.create(atomic.plan,atomic.pages);this.ports.current();await this.#active(intentId);const packets:SignedE2eeCommand[]=[];
  for(const row of products){packets.push(await this.ports.sign(row.scopeId,row.intentId,atomic.changeHash,row.operations));this.ports.current();await this.#active(intentId);}
  const review=await prepareMembershipAtomicReview(this.ports.stager,this.ports.owners,intentId,packets,this.ports.current,draft.createdAt);this.ports.current();await this.#active(intentId);return{state:'review' as const,intentId,...review};
 });}
 packets(intentId:string,fingerprint:string){return this.#run(async()=>{
  await this.#active(intentId);
  const state=await this.ports.stager.inspect(intentId),saved=await this.ports.owners.inspect(fingerprint);this.ports.current();
  if(state.cancelRequested||saved.request.plan.actorId!==this.ports.ownerId||saved.request.plan.intentId!==intentId||membershipAtomicPlanHash(saved.request.plan)!==state.planHash)throw new Error('E2EE_MEMBERSHIP_REVIEW_MISMATCH');
  const review=await this.ports.owners.review(fingerprint);this.ports.current();const rotations:SignedE2eeCommand[]=[];
  for(const scope of review.scopes){const approval=await this.ports.owners.exportApproval(fingerprint,scope.scopeId);this.ports.current();const checked=await this.ports.owners.acceptApproval(fingerprint,approval);this.ports.current();if(!same(approval,checked))throw new Error('E2EE_MEMBERSHIP_REVIEW_MISMATCH');rotations.push(checked.packet);}
  const pages=membershipAtomicPages('rotation-packets',rotations);
  for(let index=0;index<saved.request.productPages.length;index++){const part=await this.ports.owners.part(fingerprint,'products',index);this.ports.current();pages.push(part.page as import('./membership-atomic-contract.ts').MembershipAtomicPage);}
  await this.#active(intentId);const result=await this.ports.stager.createPackets(intentId,pages);this.ports.current();await this.#active(intentId);return result;
 });}
}
