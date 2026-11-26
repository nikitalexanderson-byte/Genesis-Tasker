import {assertTechnical,exactKeys} from './keys.ts';
import {decodeE2eeBytes} from './envelope.ts';
import {samePrivateJson as same} from './product-json.ts';
import {validateMembershipAtomicPage,membershipAtomicChangeHash,type MembershipAtomicPage} from './membership-atomic-contract.ts';
import {MembershipAtomicReviewCollector,membershipAtomicReviewFingerprint,validateMembershipAtomicReview,validateMembershipAtomicReviewPart,
 membershipAtomicRotationShape,validateMembershipAtomicOwnerApproval,type MembershipAtomicReview,type MembershipAtomicReviewPart,type MembershipAtomicOwnerApproval} from './membership-atomic-review.ts';
import {verifyMembershipAtomicPacket} from './membership-atomic-proofs.ts';
import {membershipAtomicDigest} from './membership-atomic-contract.ts';
import type {MembershipPeerPorts} from './membership-exchange.ts';
import type {MembershipAtomicScopePreview} from './membership-atomic-preview.ts';
import type {MembershipPrivateEffects} from './membership-atomic-effects.ts';
import type {SignedE2eeCommand} from './commands.ts';

export const MEMBERSHIP_ATOMIC_OWNER_PREFIXES=['membership-atomic-owner-review:','membership-atomic-owner-part:','membership-atomic-owner-consent:','membership-atomic-owner-approval:'] as const;
type Stored={value:unknown;serial:number};
export type MembershipAtomicOwnerState={format:'genesis-membership-atomic-owner-local-v2';ownerId:string;request:MembershipAtomicReview};
export type MembershipAtomicOwnerPart={format:'genesis-membership-atomic-owner-part-local-v2';ownerId:string;part:MembershipAtomicReviewPart};
export type MembershipAtomicOwnerConsent={format:'genesis-membership-atomic-owner-consent-local-v2';ownerId:string;fingerprint:string;scopeId:string;roles:MembershipAtomicScopePreview['roles'];packet:SignedE2eeCommand|null};
export type MembershipAtomicOwnerRelay={format:'genesis-membership-atomic-owner-relay-local-v2';ownerId:string;fingerprint:string;approval:MembershipAtomicOwnerApproval;verified:boolean};
export interface MembershipAtomicOwnerPorts{
 ownerId:string;current:()=>void;peers:MembershipPeerPorts;
 read:(id:string)=>Promise<Stored|null>;write:(id:string,value:unknown,expected:number|null)=>Promise<number>;list:(prefix:string)=>Promise<string[]>;
 /** This adapter opens only the authenticated current owner's actual scope. */
 rotate:(scope:MembershipAtomicScopePreview,changeHash:string)=>Promise<SignedE2eeCommand>;
 reviewEffects:(request:MembershipAtomicReview,scope:MembershipAtomicScopePreview,page:(index:number)=>Promise<MembershipAtomicPage>)=>Promise<MembershipPrivateEffects>;
}
function invalid():never{throw new Error('E2EE_MEMBERSHIP_REVIEW_MISMATCH');}
export function membershipAtomicOwnerId(ownerId:string,fingerprint:string,kind:0|1|2|3=0,suffix=''){
 assertTechnical(ownerId);decodeE2eeBytes(fingerprint,32);return MEMBERSHIP_ATOMIC_OWNER_PREFIXES[kind]+membershipAtomicDigest({format:'genesis-membership-atomic-owner-key-v2',ownerId,fingerprint})+suffix;
}
export function membershipAtomicOwnerScopeSuffix(scopeId:string){assertTechnical(scopeId);return':'+membershipAtomicDigest(scopeId);}
export function validateMembershipAtomicOwnerLocal(input:unknown,ownerId:string,request?:MembershipAtomicReview){
 exactKeys(input,['format','ownerId',...(input&&typeof input==='object'&&'request'in input?['request']:input&&typeof input==='object'&&'part'in input?['part']:input&&typeof input==='object'&&'approval'in input?['fingerprint','approval','verified']:['fingerprint','scopeId','roles','packet'])]);
 if(input.ownerId!==ownerId)invalid();assertTechnical(ownerId);
 if(input.format==='genesis-membership-atomic-owner-local-v2'){validateMembershipAtomicReview(input.request);return structuredClone(input) as MembershipAtomicOwnerState;}
 if(!request)invalid();const fingerprint=membershipAtomicReviewFingerprint(request);
 if(input.format==='genesis-membership-atomic-owner-part-local-v2'){validateMembershipAtomicReviewPart(input.part,request);return structuredClone(input) as MembershipAtomicOwnerPart;}
 if(input.fingerprint!==fingerprint)invalid();
 if(input.format==='genesis-membership-atomic-owner-relay-local-v2'){
  if(typeof input.verified!=='boolean')invalid();exactKeys(input.approval,['format','requestFingerprint','scopeId','packet']);
  if(input.approval.format!=='genesis-membership-atomic-owner-approval-v2'||input.approval.requestFingerprint!==fingerprint)invalid();assertTechnical(input.approval.scopeId);
  validateMembershipAtomicPage({kind:'rotation-packets',items:[input.approval.packet]});return structuredClone(input) as MembershipAtomicOwnerRelay;
 }
 if(input.format!=='genesis-membership-atomic-owner-consent-local-v2'||!Array.isArray(input.roles)||input.roles.length<1||input.roles.length>256)invalid();assertTechnical(input.scopeId);
 let previous='';for(const role of input.roles){exactKeys(role,['userId','deviceId','role']);assertTechnical(role.userId);assertTechnical(role.deviceId);if(role.deviceId<=previous||role.role!==null&&!['owner','writer','commenter','reader'].includes(String(role.role)))invalid();previous=role.deviceId;}
 if(input.packet!==null)validateMembershipAtomicPage({kind:'rotation-packets',items:[input.packet]});return structuredClone(input) as MembershipAtomicOwnerConsent;
}
/** Complete received pages are durable BEFORE directory IO or root rotation.
 * No ACL/application port exists. V1 reviews cannot enter this capability. */
export class MembershipAtomicOwnerReviews{
 #serial:Promise<unknown>=Promise.resolve();
 constructor(private readonly ports:MembershipAtomicOwnerPorts){assertTechnical(ports.ownerId);}
 #run<T>(action:()=>Promise<T>){const task=this.#serial.catch(()=>undefined).then(async()=>{this.ports.current();return action();});this.#serial=task;return task;}
 async #read(id:string){this.ports.current();const result=await this.ports.read(id);this.ports.current();return result;}
 async #save(id:string,value:unknown,expected:number|null){this.ports.current();const serial=await this.ports.write(id,structuredClone(value),expected);this.ports.current();const saved=await this.#read(id);
  if(serial!==(expected??0)+1||!saved||saved.serial!==serial||!same(saved.value,value))throw new Error('E2EE_LOCAL_CONFLICT');return saved;}
 async #request(fingerprint:string){const row=await this.#read(membershipAtomicOwnerId(this.ports.ownerId,fingerprint));if(!row)throw new Error('E2EE_MEMBERSHIP_PLAN_REQUIRED');
  const state=validateMembershipAtomicOwnerLocal(row.value,this.ports.ownerId);if(state.format!=='genesis-membership-atomic-owner-local-v2'||row.serial!==1||membershipAtomicReviewFingerprint(state.request)!==fingerprint)invalid();return state.request;}
 create(input:MembershipAtomicReview){const request=validateMembershipAtomicReview(input),fingerprint=membershipAtomicReviewFingerprint(request);return this.#run(async()=>{
  const id=membershipAtomicOwnerId(this.ports.ownerId,fingerprint),value:MembershipAtomicOwnerState={format:'genesis-membership-atomic-owner-local-v2',ownerId:this.ports.ownerId,request},old=await this.#read(id);
  if(old){if(old.serial!==1||!same(old.value,value))invalid();}else await this.#save(id,value,null);return fingerprint;
 });}
 putPart(input:MembershipAtomicReviewPart){const held=structuredClone(input);return this.#run(async()=>{
  const request=await this.#request(held.fingerprint),part=validateMembershipAtomicReviewPart(held,request),id=membershipAtomicOwnerId(this.ports.ownerId,part.fingerprint,1,':'+part.kind+':'+part.index),value:MembershipAtomicOwnerPart={format:'genesis-membership-atomic-owner-part-local-v2',ownerId:this.ports.ownerId,part};
  const old=await this.#read(id);if(old){if(old.serial!==1||!same(old.value,value))invalid();}else await this.#save(id,value,null);return{fingerprint:part.fingerprint,kind:part.kind,index:part.index};
 });}
 async #part(request:MembershipAtomicReview,kind:MembershipAtomicReviewPart['kind'],index:number){const fingerprint=membershipAtomicReviewFingerprint(request),row=await this.#read(membershipAtomicOwnerId(this.ports.ownerId,fingerprint,1,':'+kind+':'+index));
  if(!row)throw new Error('E2EE_MEMBERSHIP_LOCAL_PAGE_REQUIRED');const value=validateMembershipAtomicOwnerLocal(row.value,this.ports.ownerId,request) as MembershipAtomicOwnerPart;
  if(value.format!=='genesis-membership-atomic-owner-part-local-v2'||row.serial!==1||value.part.kind!==kind||value.part.index!==index)invalid();return value.part;}
 part(fingerprint:string,kind:MembershipAtomicReviewPart['kind'],index:number){return this.#run(async()=>this.#part(await this.#request(fingerprint),kind,index));}
 inspect(fingerprint:string){return this.#run(async()=>({fingerprint,request:await this.#request(fingerprint)}));}
 pending(){return this.#run(async()=>{const ids=await this.ports.list(MEMBERSHIP_ATOMIC_OWNER_PREFIXES[0]);this.ports.current();const rows=[];
  for(const id of ids){const row=await this.#read(id);if(!row)invalid();const state=validateMembershipAtomicOwnerLocal(row.value,this.ports.ownerId) as MembershipAtomicOwnerState,fingerprint=membershipAtomicReviewFingerprint(state.request);if(row.serial!==1||id!==membershipAtomicOwnerId(this.ports.ownerId,fingerprint))invalid();rows.push({fingerprint,request:state.request});}return rows;
 });}
 async #complete(request:MembershipAtomicReview){const collector=new MembershipAtomicReviewCollector(request,this.ports.peers);
  for(const kind of ['plan','preview','products'] as const){const refs=kind==='plan'?request.plan.pages:kind==='preview'?request.previewPages:request.productPages;for(let index=0;index<refs.length;index++)await collector.consume(await this.#part(request,kind,index));}
  return collector.finish();}
 review(fingerprint:string){return this.#run(async()=>{const request=await this.#request(fingerprint),value=await this.#complete(request);
  const privateEffects:{scopeId:string;effects:MembershipPrivateEffects}[]=[];for(const scope of value.scopes)if(scope.ownerId===this.ports.ownerId){const effects=await this.ports.reviewEffects(request,scope,async index=>(await this.#part(request,'plan',index)).page as MembershipAtomicPage);this.ports.current();privateEffects.push({scopeId:scope.scopeId,effects});}return{...value,privateEffects};
 });}
 approve(fingerprint:string,scopeId:string,displayedFingerprint:string,explicitRoles:MembershipAtomicScopePreview['roles']){const held=structuredClone(explicitRoles);return this.#run(async()=>{
  if(displayedFingerprint!==fingerprint)throw new Error('E2EE_MEMBERSHIP_FINGERPRINT_REQUIRED');const request=await this.#request(fingerprint),review=await this.#complete(request),scope=review.scopes.find(row=>row.scopeId===scopeId);
  if(!scope||scope.ownerId!==this.ports.ownerId||!same(held,scope.roles))invalid();
  await this.ports.reviewEffects(request,scope,async index=>(await this.#part(request,'plan',index)).page as MembershipAtomicPage);this.ports.current();
  const id=membershipAtomicOwnerId(this.ports.ownerId,fingerprint,2,membershipAtomicOwnerScopeSuffix(scopeId)),old=await this.#read(id);
  let consent:MembershipAtomicOwnerConsent,serial:number;
  if(old){const checked=validateMembershipAtomicOwnerLocal(old.value,this.ports.ownerId,request);if(checked.format!=='genesis-membership-atomic-owner-consent-local-v2')invalid();consent=checked;serial=old.serial;if(consent.scopeId!==scopeId||!same(consent.roles,held)||serial!==(consent.packet?2:1))invalid();}
  else{consent={format:'genesis-membership-atomic-owner-consent-local-v2',ownerId:this.ports.ownerId,fingerprint,scopeId,roles:held,packet:null};serial=(await this.#save(id,consent,null)).serial;}
  let packet=consent.packet;if(!packet){packet=await this.ports.rotate(scope,membershipAtomicChangeHash(request.plan));this.ports.current();membershipAtomicRotationShape(packet,request,scope);
   await this.#save(id,{...consent,packet},serial);}
  const anchor=await this.#anchor(request,scopeId);await verifyMembershipAtomicPacket(request.plan,anchor,packet,this.ports.peers);this.ports.current();
  return validateMembershipAtomicOwnerApproval({format:'genesis-membership-atomic-owner-approval-v2',requestFingerprint:fingerprint,scopeId,packet},request,scope);
 });}
 async #anchor(request:MembershipAtomicReview,scopeId:string){for(let index=0;index<request.plan.pages.length;index++)if(request.plan.pages[index].kind==='anchors'){
  const part=await this.#part(request,'plan',index),page=part.page as Extract<MembershipAtomicPage,{kind:'anchors'}>,row=page.items.find(value=>value.scopeId===scopeId);if(row)return row;}invalid();}
 /** Exact saved evidence only; exporting after restart never re-signs or
  * interprets a historical approval as fresh consent. */
 exportApproval(fingerprint:string,scopeId:string){return this.#run(async()=>{
  const request=await this.#request(fingerprint);let scope:MembershipAtomicScopePreview|undefined;
  for(let index=0;index<request.previewPages.length;index++){const part=await this.#part(request,'preview',index);scope=(part.page as import('./membership-atomic-preview.ts').MembershipAtomicPreviewPage).scopePlans.find(row=>row.scopeId===scopeId);if(scope)break;}if(!scope)invalid();
  const own=scope.ownerId===this.ports.ownerId,kind=own?2:3,row=await this.#read(membershipAtomicOwnerId(this.ports.ownerId,fingerprint,kind,membershipAtomicOwnerScopeSuffix(scopeId)));if(!row)throw new Error('E2EE_MEMBERSHIP_PLAN_REQUIRED');
  const value=validateMembershipAtomicOwnerLocal(row.value,this.ports.ownerId,request);if(row.serial!==2)throw new Error('E2EE_MEMBERSHIP_REVIEW_REQUIRED');let approval:MembershipAtomicOwnerApproval;
  if(own){if(value.format!=='genesis-membership-atomic-owner-consent-local-v2'||value.scopeId!==scopeId||!same(value.roles,scope.roles)||!value.packet)invalid();approval={format:'genesis-membership-atomic-owner-approval-v2',requestFingerprint:fingerprint,scopeId,packet:value.packet};}
  else{if(value.format!=='genesis-membership-atomic-owner-relay-local-v2'||!value.verified||request.plan.actorId!==this.ports.ownerId)invalid();approval=value.approval;}
  return validateMembershipAtomicOwnerApproval(approval,request,scope);
 });}
 acceptApproval(fingerprint:string,input:MembershipAtomicOwnerApproval){const held=structuredClone(input);return this.#run(async()=>{
  const request=await this.#request(fingerprint);if(request.plan.actorId!==this.ports.ownerId)invalid();const review=await this.#complete(request),scope=review.scopes.find(row=>row.scopeId===held.scopeId);if(!scope)invalid();
  const approval=validateMembershipAtomicOwnerApproval(held,request,scope),id=membershipAtomicOwnerId(this.ports.ownerId,fingerprint,3,membershipAtomicOwnerScopeSuffix(scope.scopeId)),old=await this.#read(id);let serial:number;
  if(old){const relay=validateMembershipAtomicOwnerLocal(old.value,this.ports.ownerId,request) as MembershipAtomicOwnerRelay;if(!same(relay.approval,approval)||old.serial!==(relay.verified?2:1))invalid();serial=old.serial;}
  else serial=(await this.#save(id,{format:'genesis-membership-atomic-owner-relay-local-v2',ownerId:this.ports.ownerId,fingerprint,approval,verified:false},null)).serial;
  await verifyMembershipAtomicPacket(request.plan,await this.#anchor(request,scope.scopeId),approval.packet,this.ports.peers);this.ports.current();
  if(serial===1)await this.#save(id,{format:'genesis-membership-atomic-owner-relay-local-v2',ownerId:this.ports.ownerId,fingerprint,approval,verified:true},serial);return approval;
 });}
}
