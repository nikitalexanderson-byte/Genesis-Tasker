import {commandBytes,type SignedE2eeCommand} from './commands.ts';
import {assertTechnical,exactKeys} from './keys.ts';
import {decodeE2eeBytes} from './envelope.ts';
import {samePrivateJson as same} from './product-json.ts';
import {membershipAtomicDigest,membershipAtomicPlanHash,membershipAtomicPageRef,membershipAtomicStagingPayload,
 validateMembershipAtomicPlan,validateMembershipAtomicPage,validateMembershipAtomicRefs,membershipAtomicBatchHash,type MembershipAtomicPlan,type MembershipAtomicStagingAction,type MembershipAtomicPageRef} from './membership-atomic-contract.ts';

export type MembershipAtomicLocalState={format:'genesis-membership-local-stage-v2';ownerId:string;plan:MembershipAtomicPlan;planHash:string;ready:boolean;cancelRequested:boolean;cancelled:boolean};
export type MembershipAtomicLocalPackets={format:'genesis-membership-local-packets-v2';ownerId:string;intentId:string;planHash:string;batchHash:string;pages:MembershipAtomicPageRef[];ready:boolean};
const invalid=():never=>{throw new Error('E2EE_CORRUPT_OUTBOX');};
export function membershipAtomicLocalStem(ownerId:string,intentId:string){
 assertTechnical(ownerId);assertTechnical(intentId);return membershipAtomicDigest({format:'genesis-membership-local-key-v2',ownerId,intentId});
}
export const membershipAtomicLocalId=(ownerId:string,intentId:string)=>'membership-atomic-v2:'+membershipAtomicLocalStem(ownerId,intentId);
export function membershipAtomicLocalPageId(ownerId:string,intentId:string,index:number){
 if(!Number.isSafeInteger(index)||index<0||index>=10000)invalid();return 'membership-atomic-page:'+membershipAtomicLocalStem(ownerId,intentId)+':'+index;
}
export function membershipAtomicLocalRequestId(ownerId:string,action:MembershipAtomicStagingAction,input:unknown){
 assertTechnical(ownerId);return 'membership-atomic-request:'+membershipAtomicDigest({ownerId,action,payload:membershipAtomicStagingPayload(action,input)});
}
export const membershipAtomicLocalPacketsId=(ownerId:string,intentId:string)=>'membership-atomic-packets:'+membershipAtomicLocalStem(ownerId,intentId);
export function membershipAtomicLocalPacketPageId(ownerId:string,intentId:string,index:number){
 if(!Number.isSafeInteger(index)||index<0||index>=10000)invalid();return 'membership-atomic-packet-page:'+membershipAtomicLocalStem(ownerId,intentId)+':'+index;
}
export function validateMembershipAtomicLocalPackets(input:unknown,state:MembershipAtomicLocalState){
 exactKeys(input,['format','ownerId','intentId','planHash','batchHash','pages','ready']);const pages=validateMembershipAtomicRefs(input.pages,true);
 if(input.format!=='genesis-membership-local-packets-v2'||input.ownerId!==state.ownerId||input.intentId!==state.plan.intentId||input.planHash!==state.planHash
  ||!pages.length||membershipAtomicBatchHash(state.plan,pages)!==input.batchHash||typeof input.ready!=='boolean')invalid();
 return structuredClone(input) as MembershipAtomicLocalPackets;
}
export function membershipAtomicLocalPacketPageMatches(manifest:MembershipAtomicLocalPackets,input:unknown){
 exactKeys(input,['format','ownerId','intentId','planHash','batchHash','index','page']);const index=input.index as number,page=validateMembershipAtomicPage(input.page);
 if(input.format!=='genesis-membership-local-packet-page-v2'||input.ownerId!==manifest.ownerId||input.intentId!==manifest.intentId||input.planHash!==manifest.planHash||input.batchHash!==manifest.batchHash
  ||!Number.isSafeInteger(index)||index<0||index>=10000||!['rotation-packets','product-packets'].includes(page.kind)||!same(membershipAtomicPageRef(index,page),manifest.pages[index]))invalid();
 return {index,page};
}
export function validateMembershipAtomicLocalState(input:unknown,ownerId:string){
 exactKeys(input,['format','ownerId','plan','planHash','ready','cancelRequested','cancelled']);const plan=validateMembershipAtomicPlan(input.plan);
 if(input.format!=='genesis-membership-local-stage-v2'||input.ownerId!==ownerId||plan.actorId!==ownerId||membershipAtomicPlanHash(plan)!==input.planHash
  ||typeof input.ready!=='boolean'||typeof input.cancelRequested!=='boolean'||typeof input.cancelled!=='boolean'||input.cancelled&&!input.cancelRequested)invalid();
 return structuredClone(input) as MembershipAtomicLocalState;
}
export function validateMembershipAtomicLocalPage(input:unknown,ownerId:string){
 exactKeys(input,['format','ownerId','intentId','planHash','index','page']);assertTechnical(input.intentId);decodeE2eeBytes(input.planHash,32);
 if(input.format!=='genesis-membership-local-page-v2'||input.ownerId!==ownerId||!Number.isSafeInteger(input.index)||Number(input.index)<0||Number(input.index)>=10000)invalid();
 const page=validateMembershipAtomicPage(input.page),index=input.index as number;
 if(['rotation-packets','product-packets'].includes(page.kind))invalid();
 return {format:input.format,ownerId,intentId:input.intentId,planHash:input.planHash as string,index,page};
}
export function validateMembershipAtomicLocalRequest(input:unknown,ownerId:string){
 exactKeys(input,['format','ownerId','action','payload','packet']);
 if(input.format!=='genesis-membership-stage-request-v2'||input.ownerId!==ownerId)invalid();
 const action=input.action as MembershipAtomicStagingAction,payload=membershipAtomicStagingPayload(action,input.payload);
 exactKeys(input.packet,['command','signature']);const packet=input.packet as SignedE2eeCommand,bytes=commandBytes(packet.command);bytes.fill(0);decodeE2eeBytes(packet.signature,64);
 if(packet.command.ownerId!==ownerId||packet.command.action!==action||!same(packet.command.payload,payload))invalid();
 return {format:input.format,ownerId,action,payload,packet:structuredClone(packet)};
}
/** Read-only relation check. This accepts an interrupted local page save while
 * ready=false, but never invents a missing original or trusts a transport reply. */
export function membershipAtomicLocalPageMatches(state:MembershipAtomicLocalState,input:unknown){
 const row=validateMembershipAtomicLocalPage(input,state.ownerId);
 if(row.intentId!==state.plan.intentId||row.planHash!==state.planHash||!same(membershipAtomicPageRef(row.index,row.page),state.plan.pages[row.index]))invalid();return row;
}
