import {assertTechnical,exactKeys} from './keys.ts';
import {decodeE2eeBytes} from './envelope.ts';
import {membershipAtomicChangeHash,membershipAtomicPlanHash,type MembershipAtomicPlan,type MembershipAtomicAnchor} from './membership-atomic-contract.ts';
export type MembershipAtomicScopePreview={scopeId:string;ownerId:string;kind:'space'|'project';resourceId:string;generation:number;directoryRevision:number;checkpointHash:string;cryptoEpoch:number;securityEpoch:number;
 roles:{deviceId:string;userId:string;role:'owner'|'writer'|'commenter'|'reader'|null}[];manifest:{manifestHash:string;objectCount:number}};
export type MembershipAtomicPreviewPage={intentId:string;planHash:string;changeHash:string;scopePlans:MembershipAtomicScopePreview[];next:number|null};
function invalid():never{throw new Error('E2EE_MEMBERSHIP_REVIEW_MISMATCH');}
const integer=(value:unknown,min=0,max=Number.MAX_SAFE_INTEGER-1)=>{if(!Number.isSafeInteger(value)||Number(value)<min||Number(value)>max)invalid();};
export function validateMembershipAtomicPreviewPage(input:unknown,plan:MembershipAtomicPlan,planHash:string,after:number,anchors:ReadonlyMap<string,MembershipAtomicAnchor>):MembershipAtomicPreviewPage{
 integer(after,0,plan.scopeIds.length);exactKeys(input,['intentId','planHash','changeHash','scopePlans','next']);
 if(planHash!==membershipAtomicPlanHash(plan)||input.intentId!==plan.intentId||input.planHash!==planHash||input.changeHash!==membershipAtomicChangeHash(plan)||!Array.isArray(input.scopePlans)||input.scopePlans.length>200||after+input.scopePlans.length>plan.scopeIds.length)invalid();
 const next=after+input.scopePlans.length;if(input.next!==(next<plan.scopeIds.length?next:null)||!input.scopePlans.length&&after<plan.scopeIds.length)invalid();
 for(const [index,row]of input.scopePlans.entries()){
  exactKeys(row,['scopeId','ownerId','kind','resourceId','generation','directoryRevision','checkpointHash','cryptoEpoch','securityEpoch','roles','manifest']);
  const anchor=anchors.get(plan.scopeIds[after+index]);if(!anchor||row.scopeId!==anchor.scopeId||row.ownerId!==anchor.ownerId||row.kind!==anchor.kind||row.resourceId!==anchor.resourceId||row.generation!==anchor.generation||row.directoryRevision!==anchor.directoryRevision||row.checkpointHash!==anchor.checkpointHash)invalid();
  integer(row.cryptoEpoch,1);integer(row.securityEpoch,1);exactKeys(row.manifest,['manifestHash','objectCount']);decodeE2eeBytes(row.manifest.manifestHash,32);integer(row.manifest.objectCount,0,10000);
  if(!Array.isArray(row.roles)||row.roles.length<1||row.roles.length>256)invalid();let previous='';
  for(const role of row.roles){exactKeys(role,['deviceId','userId','role']);assertTechnical(role.deviceId);assertTechnical(role.userId);if(role.deviceId<=previous||role.role!==null&&!['owner','writer','commenter','reader'].includes(String(role.role)))invalid();previous=role.deviceId;}
 }
 return structuredClone(input) as MembershipAtomicPreviewPage;
}
