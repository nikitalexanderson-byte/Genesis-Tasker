import {assertTechnical,exactKeys} from './keys.ts';
import {decodeE2eeBytes,encodeE2eeBytes} from './envelope.ts';
import {sha256} from '@noble/hashes/sha2.js';
import {samePrivateJson as same} from './product-json.ts';
import {validateMembershipOperation,localMembershipOperation,validateMembershipOperationSnapshot,planMembershipOperation,membershipOperationFingerprint,membershipOperationPlanFingerprint,
 type MembershipOperation,type MembershipOperationSnapshot,type MembershipOperationPlan} from './membership-operation-plan.ts';

export const MEMBERSHIP_OPERATION_DRAFT_PREFIX='membership-operation:';
type Proposal={snapshot:MembershipOperationSnapshot;plan:MembershipOperationPlan;fingerprint:string;planFingerprint:string};
type Review={fingerprint:string;planFingerprint:string;reviewedAt:string};
export type MembershipOperationDraft={format:'genesis-membership-operation-draft-v1';ownerId:string;intentId:string;operation:MembershipOperation;createdAt:string;
 proposal:Proposal|null;review:Review|null;started:boolean;cancelled?:boolean;resolves?:string;history:{proposal:Proposal;review:Review|null}[]};
export interface MembershipOperationDraftPorts{
 ownerId:string;current:()=>void;
 load:(id:string)=>Promise<{value:unknown;serial:number}|null>;
 save:(id:string,value:MembershipOperationDraft,expected:number|null)=>Promise<number>;
 list:()=>Promise<string[]>;
 /** Actual independently pinned/decrypted topology, not a server proposal. */
 capture:(operation:MembershipOperation)=>Promise<MembershipOperationSnapshot>;
}
function invalid():never{throw new Error('E2EE_MEMBERSHIP_OPERATION_INVALID');}
function validDate(input:unknown){if(typeof input!=='string'||!Number.isFinite(Date.parse(input)))invalid();}
function validateProposal(input:unknown,operation:MembershipOperation):Proposal{
 exactKeys(input,['snapshot','plan','fingerprint','planFingerprint']);
 const snapshot=validateMembershipOperationSnapshot(input.snapshot),plan=planMembershipOperation(snapshot,operation);
 if(!same(plan,input.plan)||input.fingerprint!==membershipOperationFingerprint(snapshot,operation)||input.planFingerprint!==membershipOperationPlanFingerprint(plan))invalid();
 return structuredClone(input) as Proposal;
}
function validateReview(input:unknown,proposal:Proposal):Review{
 exactKeys(input,['fingerprint','planFingerprint','reviewedAt']);validDate(input.reviewedAt);
 if(input.fingerprint!==proposal.fingerprint||input.planFingerprint!==proposal.planFingerprint)invalid();return structuredClone(input) as Review;
}
export function validateMembershipOperationDraft(input:unknown,ownerId:string,intentId:string):MembershipOperationDraft{
 exactKeys(input,['format','ownerId','intentId','operation','createdAt','proposal','review','started','history',...(input&&typeof input==='object'&&Object.hasOwn(input,'cancelled')?['cancelled']:[]),...(input&&typeof input==='object'&&Object.hasOwn(input,'resolves')?['resolves']:[])]);
 if(input.format!=='genesis-membership-operation-draft-v1'||input.ownerId!==ownerId||input.intentId!==intentId||typeof input.started!=='boolean'||!Array.isArray(input.history)||input.history.length>64)invalid();
 assertTechnical(ownerId);assertTechnical(intentId);validDate(input.createdAt);const operation=localMembershipOperation(input.operation);
 if(Object.hasOwn(input,'cancelled')&&typeof input.cancelled!=='boolean')invalid();if(Object.hasOwn(input,'resolves')){assertTechnical(input.resolves);if(input.resolves===intentId)invalid();}
 for(const old of input.history){exactKeys(old,['proposal','review']);const proposal=validateProposal(old.proposal,operation);if(proposal.snapshot.actorId!==ownerId)invalid();if(old.review!==null)validateReview(old.review,proposal);}
 if(input.proposal===null){if(input.review!==null||input.started||input.history.length)invalid();}
 else{const proposal=validateProposal(input.proposal,operation);if(proposal.snapshot.actorId!==ownerId)invalid();if(input.review!==null)validateReview(input.review,proposal);else if(input.started)invalid();}
 return structuredClone(input) as MembershipOperationDraft;
}
/** The full ordinary operation survives before the first graph/state/preview
 * request. Re-review preserves abandoned observations. Once started, neither
 * consent nor the semantic intent can be silently rebased onto a new graph. */
export class MembershipOperationDrafts{
 #serial:Promise<unknown>=Promise.resolve();
 constructor(private readonly ports:MembershipOperationDraftPorts){assertTechnical(ports.ownerId);}
 #run<T>(run:()=>Promise<T>){const task=this.#serial.catch(()=>undefined).then(async()=>{this.ports.current();return run();});this.#serial=task;return task;}
 async #load(id:string){assertTechnical(id);this.ports.current();const saved=await this.ports.load(id);this.ports.current();if(!saved)throw new Error('E2EE_MEMBERSHIP_OPERATION_REQUIRED');
  return{value:validateMembershipOperationDraft(saved.value,this.ports.ownerId,id),serial:saved.serial};}
 async #save(value:MembershipOperationDraft,expected:number|null){const held=validateMembershipOperationDraft(value,this.ports.ownerId,value.intentId);this.ports.current();
  const serial=await this.ports.save(held.intentId,held,expected);this.ports.current();if(serial!==(expected??0)+1)throw new Error('E2EE_LOCAL_CONFLICT');
  const after=await this.#load(held.intentId);if(after.serial!==serial||!same(after.value,held))throw new Error('E2EE_LOCAL_CONFLICT');return after.value;}
 create(input:MembershipOperation,id=crypto.randomUUID()){const operation=localMembershipOperation(input);assertTechnical(id);return this.#run(async()=>{
  await this.#save({format:'genesis-membership-operation-draft-v1',ownerId:this.ports.ownerId,intentId:id,operation,createdAt:new Date().toISOString(),proposal:null,review:null,started:false,history:[]},null);return id;
 });}
 inspect(id:string){return this.#run(async()=>(await this.#load(id)).value);}
  // A read-only access probe owns no draft/consent state. Its network wait must
  // not hold the durable-operation queue used to enter another review.
  async snapshot(input:MembershipOperation){const operation=validateMembershipOperation(input);this.ports.current();
   const captured=await this.ports.capture(operation);this.ports.current();const value=validateMembershipOperationSnapshot(captured);
   if(value.actorId!==this.ports.ownerId)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');return value;}
  async #successor(value:MembershipOperationDraft){const ids=await this.ports.list();this.ports.current();if(new Set(ids).size!==ids.length)invalid();let child:MembershipOperationDraft|null=null;
   for(const id of ids){const candidate=(await this.#load(id)).value;if(candidate.resolves!==value.intentId)continue;if(child||!same(candidate.operation,value.operation))throw new Error('E2EE_MEMBERSHIP_RESOLUTION_DIVERGED');child=candidate;}return child;
  }
  /** Follow only preserved explicit-resolution links. Multiple children or a
   * changed original operation are divergence, never a last-writer choice. */
  follow(id:string){return this.#run(async()=>{let value=(await this.#load(id)).value;const seen=new Set<string>();
   for(let depth=0;depth<64;depth++){if(seen.has(value.intentId))throw new Error('E2EE_MEMBERSHIP_RESOLUTION_DIVERGED');seen.add(value.intentId);if(!value.cancelled)return value;
    const next=await this.#successor(value);if(!next)return value;value=next;}throw new Error('E2EE_SOURCE_HISTORY_CAPACITY');
  });}
 pending(){return this.#run(async()=>{const ids=await this.ports.list();this.ports.current();const values:MembershipOperationDraft[]=[];
  if(new Set(ids).size!==ids.length)invalid();for(const id of ids)values.push((await this.#load(id)).value);return values;
 });}
 async #proposal(operation:MembershipOperation):Promise<Proposal>{const snapshot=validateMembershipOperationSnapshot(await this.ports.capture(structuredClone(operation)));this.ports.current();
  if(snapshot.actorId!==this.ports.ownerId)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');const plan=planMembershipOperation(snapshot,operation);
  return{snapshot,plan,fingerprint:membershipOperationFingerprint(snapshot,operation),planFingerprint:membershipOperationPlanFingerprint(plan)};
 }
 preview(id:string){return this.#run(async()=>{const saved=await this.#load(id);if(saved.value.cancelled)throw new Error('E2EE_MEMBERSHIP_CANCELLED');if(saved.value.started)throw new Error('E2EE_MEMBERSHIP_PLAN_LOCKED');const proposal=await this.#proposal(saved.value.operation);
  const after=await this.#load(id);if(after.serial!==saved.serial)throw new Error('E2EE_LOCAL_CONFLICT');if(same(after.value.proposal,proposal))return after.value;
  const history=[...after.value.history];if(after.value.proposal)history.push({proposal:after.value.proposal,review:after.value.review});if(history.length>64)throw new Error('E2EE_SOURCE_HISTORY_CAPACITY');
  return this.#save({...after.value,proposal,review:null,history},after.serial);
 });}
 confirm(id:string,fingerprint:string){decodeE2eeBytes(fingerprint,32);return this.#run(async()=>{const saved=await this.#load(id),proposal=saved.value.proposal;
  if(saved.value.cancelled)throw new Error('E2EE_MEMBERSHIP_CANCELLED');
  if(!proposal||proposal.fingerprint!==fingerprint||saved.value.started)throw new Error('E2EE_MEMBERSHIP_REVIEW_MISMATCH');
  if(!same(await this.#proposal(saved.value.operation),proposal))throw new Error('E2EE_MEMBERSHIP_STALE');
  const review=saved.value.review??{fingerprint,planFingerprint:proposal.planFingerprint,reviewedAt:new Date().toISOString()};return this.#save({...saved.value,review},saved.serial);
 });}
 start(id:string){return this.#run(async()=>{const saved=await this.#load(id),value=saved.value;if(value.cancelled)throw new Error('E2EE_MEMBERSHIP_CANCELLED');if(value.started)return value;
  if(!value.proposal||!value.review)throw new Error('E2EE_MEMBERSHIP_REVIEW_REQUIRED');if(!same(await this.#proposal(value.operation),value.proposal))throw new Error('E2EE_MEMBERSHIP_STALE');
  return this.#save({...value,started:true},saved.serial);
 });}
 cancel(id:string){return this.#run(async()=>{const saved=await this.#load(id);return saved.value.cancelled?saved.value:this.#save({...saved.value,cancelled:true},saved.serial);});}
 /** A fresh intent requires explicit resolution after the containing server
  * outcome is known. The old plan/consent/packets are never edited or re-keyed. */
  fork(id:string,nextId?:string){if(nextId!==undefined)assertTechnical(nextId);return this.#run(async()=>{const old=(await this.#load(id)).value;if(!old.cancelled||nextId===id)throw new Error('E2EE_MEMBERSHIP_REVIEW_REQUIRED');
   const child=await this.#successor(old);if(child){if(nextId!==undefined&&nextId!==child.intentId)throw new Error('E2EE_IDEMPOTENCY_CONFLICT');return child.intentId;}
   const bytes=new TextEncoder().encode('genesis-membership-resolution-v1\0'+this.ports.ownerId+'\0'+id);let target:string;try{target=nextId??('membership-resolution:'+encodeE2eeBytes(sha256(bytes)));}finally{bytes.fill(0);}assertTechnical(target);
   await this.#save({format:'genesis-membership-operation-draft-v1',ownerId:this.ports.ownerId,intentId:target,operation:old.operation,createdAt:new Date().toISOString(),resolves:id,proposal:null,review:null,started:false,history:[]},null);return target;
 });}
}
