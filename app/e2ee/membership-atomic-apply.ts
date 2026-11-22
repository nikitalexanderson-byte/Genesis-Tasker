import {assertTechnical,exactKeys} from './keys.ts';
import {commandBytes,type SignedE2eeCommand,type WireValue} from './commands.ts';
import {decodeE2eeBytes} from './envelope.ts';
import {samePrivateJson as same} from './product-json.ts';
import {membershipAtomicDigest,membershipAtomicPlanHash,MembershipAtomicPacketBindings,
 type MembershipAtomicAnchor} from './membership-atomic-contract.ts';
import {membershipAtomicLocalStem} from './membership-atomic-local.ts';
import {membershipAtomicApplyPayload,validateMembershipAtomicReceipt,validateMembershipAtomicReceiptPage,membershipAtomicReceiptPageRef,
 type MembershipAtomicApplyAction,type MembershipAtomicApplyTransport,type MembershipAtomicReceipt,type MembershipAtomicReceiptPage} from './membership-atomic-receipts.ts';
import {verifyMembershipAtomicPacket,MembershipAtomicReceiptVerifier,type MembershipAtomicReadbackPorts} from './membership-atomic-proofs.ts';
import type {MembershipAtomicStager} from './membership-atomic-stager.ts';

type Stored={value:unknown;serial:number};
export type MembershipAtomicApplyState={format:'genesis-membership-local-apply-v2';ownerId:string;intentId:string;planHash:string;batchHash:string;reviewedFingerprint:string;started:boolean;receipt:MembershipAtomicReceipt|null;complete:boolean};
export interface MembershipAtomicApplyPorts extends MembershipAtomicReadbackPorts{
 ownerId:string;deviceId:string;stager:MembershipAtomicStager;transport:MembershipAtomicApplyTransport;
 read:(id:string)=>Promise<Stored|null>;write:(id:string,value:unknown,expected:number|null)=>Promise<number>;
 list:()=>Promise<string[]>;
 sign:(action:MembershipAtomicApplyAction,payload:Record<string,WireValue>)=>Promise<SignedE2eeCommand>;
 acl:(intentId:string)=>Promise<void>;
}
const invalid=():never=>{throw new Error('E2EE_CORRUPT_OUTBOX');};
export const membershipAtomicApplyId=(ownerId:string,intentId:string)=>'membership-atomic-apply:'+membershipAtomicLocalStem(ownerId,intentId);
export const membershipAtomicApplyRequestId=(ownerId:string,action:MembershipAtomicApplyAction,input:unknown)=>'membership-atomic-apply-request:'+membershipAtomicDigest({ownerId,action,payload:membershipAtomicApplyPayload(action,input)});
export function membershipAtomicFinalReviewFingerprint(planHash:string,batchHash:string){decodeE2eeBytes(planHash,32);decodeE2eeBytes(batchHash,32);return membershipAtomicDigest({format:'genesis-membership-final-review-v2',planHash,batchHash});}
export function validateMembershipAtomicApplyState(input:unknown,ownerId:string):MembershipAtomicApplyState{
 exactKeys(input,['format','ownerId','intentId','planHash','batchHash','reviewedFingerprint','started','receipt','complete']);assertTechnical(input.intentId);
 if(input.format!=='genesis-membership-local-apply-v2'||input.ownerId!==ownerId||input.reviewedFingerprint!==membershipAtomicFinalReviewFingerprint(input.planHash as string,input.batchHash as string)
  ||typeof input.started!=='boolean'||typeof input.complete!=='boolean'||input.receipt!==null&&!input.started||input.complete&&input.receipt===null)invalid();
 return structuredClone(input) as MembershipAtomicApplyState;
}
/** Final consent is separate from input/owner v1 reviews. All originals are
 * retained; no failure renews/re-signs a saved command or discards a draft. */
export class MembershipAtomicApply{
 #serial:Promise<unknown>=Promise.resolve();
 constructor(private readonly ports:MembershipAtomicApplyPorts){assertTechnical(ports.ownerId);assertTechnical(ports.deviceId);}
 #run<T>(action:()=>Promise<T>){const task=this.#serial.catch(()=>undefined).then(action);this.#serial=task;return task;}
 async #read(id:string){this.ports.current();const value=await this.ports.read(id);this.ports.current();return value;}
 async #save(id:string,value:unknown,expected:number|null){this.ports.current();const serial=await this.ports.write(id,structuredClone(value),expected);this.ports.current();const back=await this.#read(id);
  if(!back||back.serial!==serial||!same(back.value,value))throw new Error('E2EE_MEMBERSHIP_LOCAL_WRITE_FAILED');return serial;
 }
 async #originals(intentId:string){const state=await this.ports.stager.inspect(intentId),manifest=await this.ports.stager.readPacketManifest(intentId);this.ports.current();
  if(!state.ready||!manifest.ready||state.plan.actorId!==this.ports.ownerId||state.plan.intentId!==intentId||state.planHash!==membershipAtomicPlanHash(state.plan))invalid();return {stage:state,manifest};
 }
 async #load(intentId:string){const id=membershipAtomicApplyId(this.ports.ownerId,intentId),row=await this.#read(id);if(!row)throw new Error('E2EE_MEMBERSHIP_FINAL_REVIEW_REQUIRED');
  const state=validateMembershipAtomicApplyState(row.value,this.ports.ownerId),originals=await this.#originals(intentId);
  if(state.intentId!==intentId||state.planHash!==originals.stage.planHash||state.batchHash!==originals.manifest.batchHash)invalid();
  if(state.receipt)validateMembershipAtomicReceipt(state.receipt,originals.stage.plan,originals.manifest.pages);return {state,serial:row.serial,...originals};
 }
 async #describe(intentId:string){const originals=await this.#originals(intentId),{stage:state,manifest}=originals;
  if(state.cancelRequested)throw new Error('E2EE_MEMBERSHIP_CANCELLED');const bindings=new MembershipAtomicPacketBindings(state.plan),anchors=new Map<string,MembershipAtomicAnchor>();
  for(let index=0;index<state.plan.pages.length;index++){const page=await this.ports.stager.readPlanPage(intentId,index);bindings.planPage(page);if(page.kind==='anchors')for(const row of page.items)anchors.set(row.scopeId,row);}
  for(let index=0;index<manifest.pages.length;index++){const page=await this.ports.stager.readPacketPage(intentId,index);if(page.kind!=='rotation-packets'&&page.kind!=='product-packets')invalid();
   for(const packet of page.items){const anchor=anchors.get(packet.command.scopeId);if(!anchor)invalid();await verifyMembershipAtomicPacket(state.plan,anchor,packet,this.ports.peers);this.ports.current();}bindings.packetPage(page);
  }bindings.complete();return {plan:structuredClone(state.plan),manifest:structuredClone(manifest),fingerprint:membershipAtomicFinalReviewFingerprint(state.planHash,manifest.batchHash)};
 }
 describe(intentId:string){return this.#run(()=>this.#describe(intentId));}
 confirm(intentId:string,comparedFingerprint:string){return this.#run(async()=>{
  const view=await this.#describe(intentId);if(comparedFingerprint!==view.fingerprint)throw new Error('E2EE_MEMBERSHIP_REVIEW_MISMATCH');
  const id=membershipAtomicApplyId(this.ports.ownerId,intentId),old=await this.#read(id);if(old){const loaded=await this.#load(intentId);if(loaded.state.reviewedFingerprint!==comparedFingerprint)invalid();return structuredClone(loaded.state);}
  const state:MembershipAtomicApplyState={format:'genesis-membership-local-apply-v2',ownerId:this.ports.ownerId,intentId,planHash:membershipAtomicPlanHash(view.plan),batchHash:view.manifest.batchHash,reviewedFingerprint:view.fingerprint,started:false,receipt:null,complete:false};
  await this.#save(id,state,null);return structuredClone(state);
 });}
 async #request(action:MembershipAtomicApplyAction,input:Record<string,WireValue>){
  const payload=membershipAtomicApplyPayload(action,input),id=membershipAtomicApplyRequestId(this.ports.ownerId,action,payload);let saved=await this.#read(id);
  if(!saved){const packet=await this.ports.sign(action,payload);this.ports.current();this.#packet(packet,action,payload);const value={format:'genesis-membership-apply-request-v2',ownerId:this.ports.ownerId,action,payload,packet};await this.#save(id,value,null);saved=await this.#read(id);}
  if(!saved||saved.serial!==1)invalid();const value=saved.value;exactKeys(value,['format','ownerId','action','payload','packet']);
  if(value.format!=='genesis-membership-apply-request-v2'||value.ownerId!==this.ports.ownerId||value.action!==action||!same(value.payload,payload))invalid();this.#packet(value.packet,action,payload);return structuredClone(value.packet) as SignedE2eeCommand;
 }
 #packet(input:unknown,action:MembershipAtomicApplyAction,payload:Record<string,WireValue>){exactKeys(input,['command','signature']);const packet=input as SignedE2eeCommand;commandBytes(packet.command).fill(0);decodeE2eeBytes(packet.signature,64);
  if(packet.command.ownerId!==this.ports.ownerId||packet.command.deviceId!==this.ports.deviceId||packet.command.action!==action||!same(packet.command.payload,payload))invalid();
 }
 async #receiptPage(state:MembershipAtomicApplyState,index:number){
  const header=state.receipt;if(!header||!header.pages[index])invalid();const id='membership-atomic-receipt-page:'+membershipAtomicLocalStem(this.ports.ownerId,state.intentId)+':'+index;
  let row=await this.#read(id);
  if(!row){const payload={intentId:state.intentId,planHash:state.planHash,batchHash:state.batchHash,index},authorization=await this.#request('membership-atomic-receipt-page',payload);
   const response=await this.ports.transport.membershipAtomicReceiptPage({...payload,authorization});this.ports.current();exactKeys(response,['intentId','planHash','batchHash','index','page']);
   if(response.intentId!==state.intentId||response.planHash!==state.planHash||response.batchHash!==state.batchHash||response.index!==index)throw new Error('E2EE_INVALID_RECEIPT');
   const page=validateMembershipAtomicReceiptPage(response.page);if(!same(membershipAtomicReceiptPageRef(index,page),header.pages[index]))throw new Error('E2EE_INVALID_RECEIPT');
   await this.#save(id,{format:'genesis-membership-local-receipt-page-v2',ownerId:this.ports.ownerId,intentId:state.intentId,planHash:state.planHash,batchHash:state.batchHash,index,page},null);row=await this.#read(id);
  }
  if(!row||row.serial!==1)invalid();const value=row.value;exactKeys(value,['format','ownerId','intentId','planHash','batchHash','index','page']);
  if(value.format!=='genesis-membership-local-receipt-page-v2'||value.ownerId!==this.ports.ownerId||value.intentId!==state.intentId||value.planHash!==state.planHash||value.batchHash!==state.batchHash||value.index!==index||!same(membershipAtomicReceiptPageRef(index,value.page),header.pages[index]))invalid();
  return structuredClone(value.page) as MembershipAtomicReceiptPage;
 }
 async #verify(intentId:string){const loaded=await this.#load(intentId);if(!loaded.state.receipt)throw new Error('E2EE_MEMBERSHIP_OUTCOME_REVIEW_REQUIRED');
  if(loaded.state.complete){
   for(let index=0;index<loaded.stage.plan.pages.length;index++)await this.ports.stager.readPlanPage(intentId,index);
   for(let index=0;index<loaded.manifest.pages.length;index++)await this.ports.stager.readPacketPage(intentId,index);
   for(let index=0;index<loaded.state.receipt.pages.length;index++)await this.#receiptPage(loaded.state,index);return structuredClone(loaded.state.receipt);
  }
  if(loaded.stage.cancelled)throw new Error('E2EE_MEMBERSHIP_OUTCOME_REVIEW_REQUIRED');
  const verifier=new MembershipAtomicReceiptVerifier(loaded.stage.plan,loaded.manifest.pages,loaded.state.receipt,this.ports);
  for(let index=0;index<loaded.stage.plan.pages.length;index++)verifier.planPage(index,await this.ports.stager.readPlanPage(intentId,index));
  for(let index=0;index<loaded.manifest.pages.length;index++)await verifier.packetPage(index,await this.ports.stager.readPacketPage(intentId,index));await verifier.seal();
  for(let index=0;index<loaded.state.receipt.pages.length;index++)await verifier.consume(index,await this.#receiptPage(loaded.state,index));const receipt=await verifier.finish();this.ports.current();await this.ports.acl(intentId);this.ports.current();
  const fresh=await this.#load(intentId);if(!same(fresh.state.receipt,receipt))invalid();await this.#save(membershipAtomicApplyId(this.ports.ownerId,intentId),{...fresh.state,complete:true},fresh.serial);return receipt;
 }
 async #storeReceipt(intentId:string,input:unknown){const loaded=await this.#load(intentId),receipt=validateMembershipAtomicReceipt(input,loaded.stage.plan,loaded.manifest.pages);
  if(loaded.state.receipt&&!same(loaded.state.receipt,receipt))throw new Error('E2EE_INVALID_RECEIPT');if(!loaded.state.receipt)await this.#save(membershipAtomicApplyId(this.ports.ownerId,intentId),{...loaded.state,started:true,receipt},loaded.serial);return this.#verify(intentId);
 }
 submit(intentId:string){return this.#run(async()=>{
  let loaded=await this.#load(intentId);if(loaded.state.receipt)return this.#verify(intentId);
  if(loaded.stage.cancelRequested)return this.#reconcile(intentId);
  if(!loaded.state.started){await this.#save(membershipAtomicApplyId(this.ports.ownerId,intentId),{...loaded.state,started:true},loaded.serial);loaded=await this.#load(intentId);}
  const payload={intentId,planHash:loaded.state.planHash,batchHash:loaded.state.batchHash};
  // If the final POST already had an unknown outcome, do not begin staging
  // again: a committed server plan is immutable. Reuse that exact saved POST.
  if(!await this.#read(membershipAtomicApplyRequestId(this.ports.ownerId,'membership-atomic-commit',payload))){await this.ports.stager.stagePackets(intentId);this.ports.current();}
  const authorization=await this.#request('membership-atomic-commit',payload);
  const fresh=await this.ports.stager.inspect(intentId);this.ports.current();if(fresh.cancelRequested)return this.#reconcile(intentId);
  const receipt=await this.ports.transport.membershipAtomicCommit({...payload,authorization});this.ports.current();return this.#storeReceipt(intentId,receipt);
 });}
 async #reconcile(intentId:string){const loaded=await this.#load(intentId);if(loaded.state.receipt)return this.#verify(intentId);const payload={intentId,planHash:loaded.state.planHash,batchHash:loaded.state.batchHash},authorization=await this.#request('membership-atomic-receipt',payload);
  const receipt=await this.ports.transport.membershipAtomicReceipt({...payload,authorization});this.ports.current();return this.#storeReceipt(intentId,receipt);
 }
 reconcile(intentId:string){return this.#run(()=>this.#reconcile(intentId));}
 async inspect(intentId:string){return structuredClone((await this.#load(intentId)).state);}
 async pending(){this.ports.current();const ids=await this.ports.list();this.ports.current();const values:MembershipAtomicApplyState[]=[];
  for(const id of ids){const row=await this.#read(id);if(!row)invalid();const state=validateMembershipAtomicApplyState(row.value,this.ports.ownerId);if(id!==membershipAtomicApplyId(this.ports.ownerId,state.intentId))invalid();values.push(await this.inspect(state.intentId));}return values;
 }
}
