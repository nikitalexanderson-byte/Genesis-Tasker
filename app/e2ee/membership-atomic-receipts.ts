import {assertTechnical,exactKeys} from './keys.ts';
import {decodeE2eeBytes} from './envelope.ts';
import {canonicalE2eeValue,type SignedE2eeCommand,type WireValue} from './commands.ts';
import {membershipAtomicDigest,membershipAtomicPlanHash,membershipAtomicBatchHash,membershipAtomicChangeHash,
 type MembershipAtomicPlan,type MembershipAtomicPageRef} from './membership-atomic-contract.ts';

export type MembershipAtomicApplyAction='membership-atomic-commit'|'membership-atomic-receipt'|'membership-atomic-receipt-page';
export type MembershipAtomicApplyInput={intentId:string;planHash:string;batchHash:string;authorization:SignedE2eeCommand};
export type MembershipAtomicReceiptPageInput=MembershipAtomicApplyInput&{index:number};
export interface MembershipAtomicApplyTransport{
 membershipAtomicCommit(input:MembershipAtomicApplyInput):Promise<unknown>;
 membershipAtomicReceipt(input:MembershipAtomicApplyInput):Promise<unknown>;
 membershipAtomicReceiptPage(input:MembershipAtomicReceiptPageInput):Promise<unknown>;
}
export type MembershipAtomicScopeReceipt={scopeId:string;ownerId:string;result:{directoryRevision:number;checkpointHash:string;cryptoEpoch:number;securityEpoch:number;signInRequired:boolean}};
export type MembershipAtomicProductReceipt={scopeId:string;intentId:string;actorId:string;result:{intentId:string;results:{entityId:string;revision:number;payloadHash:string}[]}};
export type MembershipAtomicReceiptPage={format:'genesis-membership-receipt-page-v2'}&(
 {kind:'scopes';items:MembershipAtomicScopeReceipt[]}|{kind:'products';items:MembershipAtomicProductReceipt[]});
export type MembershipAtomicReceiptPageRef={index:number;kind:MembershipAtomicReceiptPage['kind'];count:number;pageHash:string};
export type MembershipAtomicReceipt={format:'genesis-membership-atomic-receipt-v2';actorId:string;intentId:string;planHash:string;batchHash:string;changeHash:string;pages:MembershipAtomicReceiptPageRef[];signInRequired:true};
function invalid():never{throw new Error('E2EE_INVALID_RECEIPT');}
const integer=(value:unknown,min=0,max=Number.MAX_SAFE_INTEGER-1)=>{if(!Number.isSafeInteger(value)||Number(value)<min||Number(value)>max)invalid();};
export function membershipAtomicApplyPayload(action:MembershipAtomicApplyAction,input:unknown):Record<string,WireValue>{
 if(!['membership-atomic-commit','membership-atomic-receipt','membership-atomic-receipt-page'].includes(action))invalid();
 exactKeys(input,['intentId','planHash','batchHash',...(action==='membership-atomic-receipt-page'?['index']:[])]);assertTechnical(input.intentId);decodeE2eeBytes(input.planHash,32);decodeE2eeBytes(input.batchHash,32);
 if(action==='membership-atomic-receipt-page')integer(input.index,0,9999);return structuredClone(input) as Record<string,WireValue>;
}
export function validateMembershipAtomicReceipt(input:unknown,plan:MembershipAtomicPlan,packetPages:MembershipAtomicPageRef[]):MembershipAtomicReceipt{
 exactKeys(input,['format','actorId','intentId','planHash','batchHash','changeHash','pages','signInRequired']);
 if(input.format!=='genesis-membership-atomic-receipt-v2'||input.actorId!==plan.actorId||input.intentId!==plan.intentId||input.planHash!==membershipAtomicPlanHash(plan)
  ||input.batchHash!==membershipAtomicBatchHash(plan,packetPages)||input.changeHash!==membershipAtomicChangeHash(plan)||input.signInRequired!==true
  ||!Array.isArray(input.pages)||input.pages.length<1||input.pages.length>10000)invalid();
 let scopes=0;for(const [index,row]of input.pages.entries()){
  exactKeys(row,['index','kind','count','pageHash']);if(row.index!==index||!['scopes','products'].includes(String(row.kind)))invalid();integer(row.count,1,200);decodeE2eeBytes(row.pageHash,32);if(row.kind==='scopes')scopes+=row.count as number;
 }if(scopes!==plan.scopeIds.length)invalid();return structuredClone(input) as MembershipAtomicReceipt;
}
export function validateMembershipAtomicReceiptPage(input:unknown):MembershipAtomicReceiptPage{
 exactKeys(input,['format','kind','items']);if(input.format!=='genesis-membership-receipt-page-v2'||!['scopes','products'].includes(String(input.kind))||!Array.isArray(input.items)||input.items.length<1||input.items.length>200)invalid();
 const seen=new Set<string>();for(const row of input.items){
  if(input.kind==='scopes'){
   exactKeys(row,['scopeId','ownerId','result']);assertTechnical(row.scopeId);assertTechnical(row.ownerId);if(seen.has(row.scopeId))invalid();seen.add(row.scopeId);
   exactKeys(row.result,['directoryRevision','checkpointHash','cryptoEpoch','securityEpoch','signInRequired']);for(const key of ['directoryRevision','cryptoEpoch','securityEpoch'])integer(row.result[key],1);decodeE2eeBytes(row.result.checkpointHash,32);if(typeof row.result.signInRequired!=='boolean')invalid();
  }else{
   exactKeys(row,['scopeId','intentId','actorId','result']);for(const key of ['scopeId','intentId','actorId'])assertTechnical(row[key]);const key=row.scopeId+'\0'+row.intentId;if(seen.has(key))invalid();seen.add(key);
   exactKeys(row.result,['intentId','results']);if(row.result.intentId!==row.intentId||!Array.isArray(row.result.results)||row.result.results.length<1||row.result.results.length>100)invalid();
   const entities=new Set<string>();for(const result of row.result.results){exactKeys(result,['entityId','revision','payloadHash']);assertTechnical(result.entityId);if(entities.has(result.entityId))invalid();entities.add(result.entityId);integer(result.revision,1);decodeE2eeBytes(result.payloadHash,32);}
  }
 }
 const result=structuredClone(input) as MembershipAtomicReceiptPage;
 // The same bounded canonical grammar/hash is used by the server page writer.
 const bytes=canonicalE2eeValue(result as unknown as WireValue);try{if(bytes.length>512*1024)invalid();}finally{bytes.fill(0);}return result;
}
export function membershipAtomicReceiptPageRef(index:number,input:unknown):MembershipAtomicReceiptPageRef{
 integer(index,0,9999);const page=validateMembershipAtomicReceiptPage(input);return {index,kind:page.kind,count:page.items.length,pageHash:membershipAtomicDigest(page)};
}
