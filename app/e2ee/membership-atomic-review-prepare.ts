import {createMembershipAtomicReview,membershipAtomicReviewFingerprint,type MembershipAtomicReviewPart} from './membership-atomic-review.ts';
import {membershipAtomicPages,type MembershipAtomicPage} from './membership-atomic-contract.ts';
import type {MembershipAtomicStager} from './membership-atomic-stager.ts';
import type {MembershipAtomicOwnerReviews} from './membership-atomic-owner.ts';
import type {MembershipAtomicPreviewPage} from './membership-atomic-preview.ts';
import type {SignedE2eeCommand} from './commands.ts';

/** Product packets have already been saved by their normal scope clients.
 * Plan and product input precede preview IO; each exported part stays bounded.
 * This prepares review, never key rotation or final transaction consent. */
export async function prepareMembershipAtomicReview(stager:Pick<MembershipAtomicStager,'inspect'|'previewPage'|'reviewAuthorization'|'readPlanPage'>,owners:Pick<MembershipAtomicOwnerReviews,'create'|'putPart'|'review'>,intentId:string,packets:SignedE2eeCommand[],current:()=>void,createdAt:string){
 current();const state=await stager.inspect(intentId);current();if(!state.ready||state.cancelRequested)throw new Error('E2EE_MEMBERSHIP_REVIEW_REQUIRED');
 const products=membershipAtomicPages('product-packets',packets),previews:MembershipAtomicPreviewPage[]=[];
 for(let after=0;;){const page=await stager.previewPage(intentId,after);current();previews.push(page);if(page.next===null)break;after=page.next;}
 const authorization=await stager.reviewAuthorization(intentId);current();const request=createMembershipAtomicReview(state.plan,previews,products,authorization,createdAt),fingerprint=membershipAtomicReviewFingerprint(request);
 await owners.create(request);current();const put=async(kind:MembershipAtomicReviewPart['kind'],index:number,page:MembershipAtomicPage|MembershipAtomicPreviewPage)=>{
  await owners.putPart({format:'genesis-membership-atomic-review-part-v2',fingerprint,kind,index,page});current();};
 for(let index=0;index<state.plan.pages.length;index++)await put('plan',index,await stager.readPlanPage(intentId,index));
 for(const [index,page]of previews.entries())await put('preview',index,page);
 for(const [index,page]of products.entries())await put('products',index,page);
 const reviewed=await owners.review(fingerprint);current();return{fingerprint,request,summary:{scopeCount:reviewed.scopes.length,productCount:reviewed.products.length}};
}
