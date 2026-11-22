import {commandBytes,type SignedE2eeCommand,type WireValue} from './commands.ts';
import {assertTechnical,exactKeys} from './keys.ts';
import {decodeE2eeBytes} from './envelope.ts';
import {samePrivateJson as same} from './product-json.ts';
import {membershipAtomicLocalId,membershipAtomicLocalPageId,membershipAtomicLocalRequestId,validateMembershipAtomicLocalState,
 validateMembershipAtomicLocalRequest,membershipAtomicLocalPageMatches,membershipAtomicLocalPacketsId,membershipAtomicLocalPacketPageId,
 validateMembershipAtomicLocalPackets,membershipAtomicLocalPacketPageMatches,type MembershipAtomicLocalState as State,type MembershipAtomicLocalPackets} from './membership-atomic-local.ts';
import {validateMembershipAtomicPlan,validateMembershipAtomicPage,membershipAtomicPageRef,membershipAtomicPlanHash,membershipAtomicStagingPayload,membershipAtomicBatchHash,MembershipAtomicPacketBindings,
 type MembershipAtomicPlan,type MembershipAtomicPage,type MembershipAtomicStagingAction,type MembershipAtomicTransport} from './membership-atomic-contract.ts';

type Stored={value:unknown;serial:number};
export interface MembershipAtomicStagingPorts{
 ownerId:string;deviceId:string;current:()=>void;
 /** All records live in the current account's authenticated encrypted outbox. */
 read:(id:string)=>Promise<Stored|null>;
 write:(id:string,value:unknown,expected:number|null)=>Promise<number>;
 sign:(action:MembershipAtomicStagingAction,payload:Record<string,WireValue>)=>Promise<SignedE2eeCommand>;
 transport:MembershipAtomicTransport;
}
/** Preparation/storage only. This model cannot apply ACL/product changes or
 * acknowledge their readback. Unknown HTTP outcomes reuse the same durable
 * signed request; there is no automatic re-sign, re-key or replacement plan. */
export class MembershipAtomicStager{
 #serial:Promise<unknown>=Promise.resolve();
 constructor(private readonly ports:MembershipAtomicStagingPorts){assertTechnical(ports.ownerId);assertTechnical(ports.deviceId);}
 #run<T>(action:()=>Promise<T>){const task=this.#serial.catch(()=>undefined).then(action);this.#serial=task;return task;}
 #id(intentId:string){return membershipAtomicLocalId(this.ports.ownerId,intentId);}
 #pageId(intentId:string,index:number){return membershipAtomicLocalPageId(this.ports.ownerId,intentId,index);}
 async #read(id:string){this.ports.current();const result=await this.ports.read(id);this.ports.current();return result;}
 async #save(id:string,value:unknown,expected:number|null){
  this.ports.current();const serial=await this.ports.write(id,structuredClone(value),expected);this.ports.current();
  const readback=await this.#read(id);if(!readback||readback.serial!==serial||!same(readback.value,value))throw new Error('E2EE_MEMBERSHIP_LOCAL_WRITE_FAILED');return serial;
 }
 async #load(intentId:string){
  const row=await this.#read(this.#id(intentId));if(!row)throw new Error('E2EE_MEMBERSHIP_PLAN_REQUIRED');
  const state=validateMembershipAtomicLocalState(row.value,this.ports.ownerId);
  if(state.plan.intentId!==intentId)throw new Error('E2EE_CORRUPT_OUTBOX');return {state,serial:row.serial};
 }
 async #request(action:MembershipAtomicStagingAction,input:Record<string,WireValue>){
  const payload=membershipAtomicStagingPayload(action,input),id=membershipAtomicLocalRequestId(this.ports.ownerId,action,payload);
  let saved=await this.#read(id);
  if(!saved){
   const packet=await this.ports.sign(action,payload);this.ports.current();this.#packet(packet,action,payload);
   const value={format:'genesis-membership-stage-request-v2',ownerId:this.ports.ownerId,action,payload,packet};await this.#save(id,value,null);saved=await this.#read(id);
  }
  if(!saved)throw new Error('E2EE_MEMBERSHIP_LOCAL_WRITE_FAILED');if(saved.serial!==1)throw new Error('E2EE_CORRUPT_OUTBOX');const value=validateMembershipAtomicLocalRequest(saved.value,this.ports.ownerId);
  if(value.action!==action||!same(value.payload,payload))throw new Error('E2EE_CORRUPT_OUTBOX');
  this.#packet(value.packet,action,payload);return structuredClone(value.packet) as SignedE2eeCommand;
 }
 #packet(input:unknown,action:MembershipAtomicStagingAction,payload:Record<string,WireValue>){
  exactKeys(input,['command','signature']);const packet=input as SignedE2eeCommand;const bytes=commandBytes(packet.command);bytes.fill(0);decodeE2eeBytes(packet.signature,64);
  if(packet.command.ownerId!==this.ports.ownerId||packet.command.deviceId!==this.ports.deviceId||packet.command.action!==action||!same(packet.command.payload,payload))throw new Error('E2EE_CORRUPT_OUTBOX');
 }
 create(input:MembershipAtomicPlan,inputPages:MembershipAtomicPage[]){
  const plan=validateMembershipAtomicPlan(input),pages=inputPages.map(validateMembershipAtomicPage),hash=membershipAtomicPlanHash(plan);
  if(plan.actorId!==this.ports.ownerId||pages.length!==plan.pages.length||pages.some((page,index)=>!same(membershipAtomicPageRef(index,page),plan.pages[index])))throw new Error('E2EE_MEMBERSHIP_ATOMIC_INVALID');
  return this.#run(async()=>{
   const id=this.#id(plan.intentId),existing=await this.#read(id);let state:State,serial:number;
   if(existing){const loaded=await this.#load(plan.intentId);state=loaded.state;serial=loaded.serial;if(state.planHash!==hash)throw new Error('E2EE_IDEMPOTENCY_CONFLICT');}
   else{state={format:'genesis-membership-local-stage-v2',ownerId:this.ports.ownerId,plan,planHash:hash,ready:false,cancelRequested:false,cancelled:false};serial=await this.#save(id,state,null);}
   if(state.cancelRequested)throw new Error('E2EE_MEMBERSHIP_CANCELLED');
   for(const [index,page]of pages.entries()){
    const key=this.#pageId(plan.intentId,index),old=await this.#read(key),value={format:'genesis-membership-local-page-v2',ownerId:this.ports.ownerId,intentId:plan.intentId,planHash:hash,index,page};
    if(old){if(old.serial!==1||!same(old.value,value))throw new Error('E2EE_IDEMPOTENCY_CONFLICT');}else await this.#save(key,value,null);
   }
   if(!state.ready){state.ready=true;await this.#save(id,state,serial);}return plan.intentId;
  });
 }
 async #page(state:State,index:number){
  const stored=await this.#read(this.#pageId(state.plan.intentId,index));if(!stored)throw new Error('E2EE_MEMBERSHIP_LOCAL_PAGE_REQUIRED');if(stored.serial!==1)throw new Error('E2EE_CORRUPT_OUTBOX');const value=stored.value;
  const row=membershipAtomicLocalPageMatches(state,value);
  if(row.index!==index)throw new Error('E2EE_CORRUPT_OUTBOX');return row.page;
 }
 async #staging(intentId:string,planHash:string){const {state}=await this.#load(intentId);
  if(state.planHash!==planHash)throw new Error('E2EE_IDEMPOTENCY_CONFLICT');if(state.cancelRequested)throw new Error('E2EE_MEMBERSHIP_CANCELLED');if(!state.ready)throw new Error('E2EE_MEMBERSHIP_LOCAL_PAGE_REQUIRED');
 }
 stagePlan(intentId:string){return this.#run(()=>this.#stagePlan(intentId));}
 async #stagePlan(intentId:string){
  const {state}=await this.#load(intentId);if(state.cancelRequested)throw new Error('E2EE_MEMBERSHIP_CANCELLED');if(!state.ready)throw new Error('E2EE_MEMBERSHIP_LOCAL_PAGE_REQUIRED');
  // Verify every local page before the first external request. Large pages are
  // loaded individually rather than concatenated into another wire document.
  for(let index=0;index<state.plan.pages.length;index++)await this.#page(state,index);
  const authorization=await this.#request('membership-atomic-begin',{intentId,planHash:state.planHash});
  await this.#staging(intentId,state.planHash);
  const begun=await this.ports.transport.membershipAtomicBegin({plan:state.plan,authorization});this.ports.current();exactKeys(begun,['intentId','planHash','state']);
  if(begun.intentId!==intentId||begun.planHash!==state.planHash)throw new Error('E2EE_INVALID_RECEIPT');
  if(begun.state!=='staged')throw new Error('E2EE_MEMBERSHIP_OUTCOME_REVIEW_REQUIRED');
  for(let index=0;index<state.plan.pages.length;index++){
   await this.#staging(intentId,state.planHash);
   const page=await this.#page(state,index),ref=state.plan.pages[index],authorization=await this.#request('membership-atomic-page',{intentId,planHash:state.planHash,phase:'plan',index,pageHash:ref.pageHash});
   await this.#staging(intentId,state.planHash);
   const result=await this.ports.transport.membershipAtomicPage({intentId,planHash:state.planHash,phase:'plan',index,page,authorization});this.ports.current();
   exactKeys(result,['intentId','planHash','phase','page']);if(result.intentId!==intentId||result.planHash!==state.planHash||result.phase!=='plan'||!same(result.page,ref))throw new Error('E2EE_INVALID_RECEIPT');
  }await this.#staging(intentId,state.planHash);return {intentId,planHash:state.planHash,pages:state.plan.pages.length};
 }
 async #packetManifest(state:State){const row=await this.#read(membershipAtomicLocalPacketsId(this.ports.ownerId,state.plan.intentId));
  if(!row)throw new Error('E2EE_MEMBERSHIP_LOCAL_PAGE_REQUIRED');return {manifest:validateMembershipAtomicLocalPackets(row.value,state),serial:row.serial};
 }
 async #packetPage(manifest:MembershipAtomicLocalPackets,index:number){
  const row=await this.#read(membershipAtomicLocalPacketPageId(this.ports.ownerId,manifest.intentId,index));if(!row)throw new Error('E2EE_MEMBERSHIP_LOCAL_PAGE_REQUIRED');
  if(row.serial!==1)throw new Error('E2EE_CORRUPT_OUTBOX');const checked=membershipAtomicLocalPacketPageMatches(manifest,row.value);if(checked.index!==index)throw new Error('E2EE_CORRUPT_OUTBOX');return checked.page;
 }
 async #packetBindings(state:State,manifest:MembershipAtomicLocalPackets,load:(index:number)=>Promise<MembershipAtomicPage>){
  const binding=new MembershipAtomicPacketBindings(state.plan);for(let index=0;index<state.plan.pages.length;index++)binding.planPage(await this.#page(state,index));
  for(let index=0;index<manifest.pages.length;index++)binding.packetPage(await load(index));binding.complete();
 }
 createPackets(intentId:string,inputPages:MembershipAtomicPage[]){
  assertTechnical(intentId);const pages=inputPages.map(validateMembershipAtomicPage);return this.#run(async()=>{
   const {state}=await this.#load(intentId);await this.#staging(intentId,state.planHash);const refs=pages.map((page,index)=>membershipAtomicPageRef(index,page));
   const input={format:'genesis-membership-local-packets-v2',ownerId:this.ports.ownerId,intentId,planHash:state.planHash,batchHash:membershipAtomicBatchHash(state.plan,refs),pages:refs,ready:false};
   const manifest=validateMembershipAtomicLocalPackets(input,state);await this.#packetBindings(state,manifest,async index=>pages[index]);
   const id=membershipAtomicLocalPacketsId(this.ports.ownerId,intentId),old=await this.#read(id);let serial:number,stored:MembershipAtomicLocalPackets;
   if(old){const checked=validateMembershipAtomicLocalPackets(old.value,state);if(checked.batchHash!==manifest.batchHash)throw new Error('E2EE_IDEMPOTENCY_CONFLICT');stored=checked;serial=old.serial;}
   else{stored=manifest;serial=await this.#save(id,stored,null);}
   for(const [index,page]of pages.entries()){
    const key=membershipAtomicLocalPacketPageId(this.ports.ownerId,intentId,index),value={format:'genesis-membership-local-packet-page-v2',ownerId:this.ports.ownerId,intentId,planHash:state.planHash,batchHash:manifest.batchHash,index,page},prior=await this.#read(key);
    if(prior){if(prior.serial!==1||!same(prior.value,value))throw new Error('E2EE_IDEMPOTENCY_CONFLICT');}else await this.#save(key,value,null);
   }
   if(!stored.ready)await this.#save(id,{...stored,ready:true},serial);return {intentId,planHash:state.planHash,batchHash:manifest.batchHash};
  });
 }
 stagePackets(intentId:string){return this.#run(async()=>{
  const {state}=await this.#load(intentId);await this.#staging(intentId,state.planHash);const {manifest}=await this.#packetManifest(state);
  if(!manifest.ready)throw new Error('E2EE_MEMBERSHIP_LOCAL_PAGE_REQUIRED');await this.#packetBindings(state,manifest,index=>this.#packetPage(manifest,index));
  await this.#stagePlan(intentId);
  for(let index=0;index<manifest.pages.length;index++){
   await this.#staging(intentId,state.planHash);const page=await this.#packetPage(manifest,index),ref=manifest.pages[index];
   const authorization=await this.#request('membership-atomic-page',{intentId,planHash:state.planHash,phase:'packets',index,pageHash:ref.pageHash});await this.#staging(intentId,state.planHash);
   const response=await this.ports.transport.membershipAtomicPage({intentId,planHash:state.planHash,phase:'packets',index,page,authorization});this.ports.current();
   exactKeys(response,['intentId','planHash','phase','page']);if(response.intentId!==intentId||response.planHash!==state.planHash||response.phase!=='packets'||!same(response.page,ref))throw new Error('E2EE_INVALID_RECEIPT');
  }
  const authorization=await this.#request('membership-atomic-seal',{intentId,planHash:state.planHash,batchHash:manifest.batchHash});await this.#staging(intentId,state.planHash);
  const response=await this.ports.transport.membershipAtomicSeal({intentId,planHash:state.planHash,packetPages:manifest.pages,authorization});this.ports.current();
  exactKeys(response,['intentId','planHash','batchHash','state']);if(response.intentId!==intentId||response.planHash!==state.planHash||response.batchHash!==manifest.batchHash||response.state!=='sealed')throw new Error('E2EE_INVALID_RECEIPT');
  return structuredClone(response);
 });}
 cancel(intentId:string){return this.#run(async()=>{
  const loaded=await this.#load(intentId),state=loaded.state;if(state.cancelled)return {intentId,planHash:state.planHash,state:'cancelled'};
  if(!state.cancelRequested){state.cancelRequested=true;await this.#save(this.#id(intentId),state,loaded.serial);}
  const authorization=await this.#request('membership-atomic-cancel',{intentId,planHash:state.planHash});
  const result=await this.ports.transport.membershipAtomicCancel({intentId,planHash:state.planHash,authorization});this.ports.current();
  if(!result||typeof result!=='object'||Array.isArray(result))throw new Error('E2EE_INVALID_RECEIPT');const response=result as Record<string,unknown>;
  if(response.intentId!==intentId||response.planHash!==state.planHash)throw new Error('E2EE_INVALID_RECEIPT');
  if(response.state!=='cancelled')throw new Error('E2EE_MEMBERSHIP_OUTCOME_REVIEW_REQUIRED');exactKeys(response,['intentId','planHash','state']);
  const fresh=await this.#load(intentId);await this.#save(this.#id(intentId),{...fresh.state,cancelRequested:true,cancelled:true},fresh.serial);return structuredClone(response);
 });}
 async inspect(intentId:string){return structuredClone((await this.#load(intentId)).state);}
}
