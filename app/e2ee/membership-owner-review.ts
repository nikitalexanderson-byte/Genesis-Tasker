import {sha256} from '@noble/hashes/sha2.js';
import {E2eeDeviceDocument} from './device-document.ts';
import {assertTechnical,exactKeys} from './keys.ts';
import {encodeE2eeBytes} from './envelope.ts';
import {samePrivateJson as same} from './product-json.ts';
import {validateMembershipReviewRequest,membershipReviewFingerprint,membershipRotationShape,type MembershipReviewRequest,type MembershipOwnerApproval} from './membership-exchange.ts';
import type {WebPrivateAccount} from './product-session.ts';
import type {E2eeScopeClient,ReviewedDeviceRole} from './scope-client.ts';
import type {MembershipScopePlan} from './membership-product.ts';
import type {SignedE2eeCommand} from './commands.ts';

type OwnerReview={format:'genesis-membership-owner-review-v1';ownerId:string;id:string;scopeId:string;request:MembershipReviewRequest;reviewedFingerprint:string;reviewedRoles:ReviewedDeviceRole[];packet:SignedE2eeCommand|null};
const prefix='membership-owner-review:';
const identity=(fingerprint:string,scopeId:string)=>fingerprint+':'+encodeE2eeBytes(sha256(new TextEncoder().encode(scopeId)));
/** The scope owner reviews the full initiator plan and this exact recipient
 * list. The resulting independently keyed rotation is only a relayed signature;
 * it cannot apply ACLs or rotate one scope outside the atomic complete batch. */
export class E2eeMembershipOwnerReview{
 #serial:Promise<unknown>=Promise.resolve();
 constructor(private readonly account:WebPrivateAccount,private readonly openOwned:(plan:MembershipScopePlan)=>Promise<E2eeScopeClient>,private readonly guard:()=>void=()=>{}){}
 #current(){this.guard();this.account.requireOpen();}
 #store(id:string){assertTechnical(id);return new E2eeDeviceDocument<OwnerReview>(this.account.device,prefix+id,value=>{
  exactKeys(value,['format','ownerId','id','scopeId','request','reviewedFingerprint','reviewedRoles','packet']);const request=validateMembershipReviewRequest(value.request),fingerprint=membershipReviewFingerprint(request);
  if(value.format!=='genesis-membership-owner-review-v1'||value.ownerId!==this.account.ownerId||value.id!==id||typeof value.scopeId!=='string'||value.reviewedFingerprint!==fingerprint||id!==identity(fingerprint,value.scopeId))throw new Error('E2EE_MEMBERSHIP_REVIEW_MISMATCH');
  const plan=request.preview.scopePlans.find(row=>row.scopeId===value.scopeId);if(!plan||plan.ownerId!==this.account.ownerId||!same(value.reviewedRoles,plan.roles))throw new Error('E2EE_MEMBERSHIP_REVIEW_MISMATCH');
  if(value.packet!==null)membershipRotationShape(value.packet,request,plan);return structuredClone(value) as OwnerReview;
 },()=>this.#current());}
 async inspect(id:string){this.#current();const row=await this.#store(id).load();this.#current();if(!row)throw new Error('E2EE_MEMBERSHIP_PLAN_REQUIRED');return structuredClone(row.value);}
 async list(){this.#current();const keys=await this.account.device.vault.listLocal('draft',prefix),rows:OwnerReview[]=[];this.#current();for(const key of keys)rows.push(await this.inspect(key.slice(prefix.length)));return rows;}
 approve(input:MembershipReviewRequest,scopeId:string,comparedFingerprint:string,explicitRoles:ReviewedDeviceRole[]){
  const request=validateMembershipReviewRequest(input),roles=structuredClone(explicitRoles);const task=this.#serial.catch(()=>undefined).then(async()=>{
   this.#current();if(this.account.mode!=='online')throw new Error('E2EE_ONLINE_REQUIRED');const fingerprint=membershipReviewFingerprint(request);
   if(fingerprint!==comparedFingerprint)throw new Error('E2EE_MEMBERSHIP_FINGERPRINT_REQUIRED');const plan=request.preview.scopePlans.find(row=>row.scopeId===scopeId);
   if(!plan||plan.ownerId!==this.account.ownerId||!same(roles,plan.roles))throw new Error('E2EE_MEMBERSHIP_REVIEW_MISMATCH');
   const id=identity(fingerprint,scopeId),store=this.#store(id),before=await store.load();this.#current();
   if(before){if(!same(before.value.request,request)||!same(before.value.reviewedRoles,roles))throw new Error('E2EE_LOCAL_CONFLICT');if(before.value.packet)return this.#export(before.value);}
   else await store.save({format:'genesis-membership-owner-review-v1',ownerId:this.account.ownerId,id,scopeId,request,reviewedFingerprint:fingerprint,reviewedRoles:roles,packet:null},null);
   this.#current();const client=await this.openOwned(plan);this.#current();await client.refresh();this.#current();const packet=await client.prepareMembershipRotation(request.preview.changeHash,roles,plan.manifest,plan);this.#current();
   membershipRotationShape(packet,request,plan);const saved=await store.load();this.#current();if(!saved||!same(saved.value.request,request)||saved.value.packet!==null)throw new Error('E2EE_LOCAL_CONFLICT');
   await store.save({...saved.value,packet},saved.serial);this.#current();return this.#export(await this.inspect(id));
  });this.#serial=task;return task;
 }
 #export(value:OwnerReview):MembershipOwnerApproval{if(!value.packet)throw new Error('E2EE_MEMBERSHIP_PLAN_REQUIRED');return{format:'genesis-membership-owner-approval-v1',requestFingerprint:value.reviewedFingerprint,scopeId:value.scopeId,packet:structuredClone(value.packet)};}
 async export(id:string){return this.#export(await this.inspect(id));}
}
