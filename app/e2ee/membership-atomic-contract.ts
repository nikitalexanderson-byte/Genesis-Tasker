import {canonicalE2eeValue,commandBytes,type SignedE2eeCommand,type WireValue} from './commands.ts';
import {assertTechnical,exactKeys} from './keys.ts';
import {decodeE2eeBytes,encodeE2eeBytes} from './envelope.ts';
import {sha256} from '@noble/hashes/sha2.js';
import {validateMembershipChanges,membershipChangesProjection,type MembershipChange} from './membership-contract.ts';
import {productMutation,type ProductMutation} from './product-contract.ts';
import {samePrivateJson as same} from './product-json.ts';
import type {MembershipOperationPlan} from './membership-operation-plan.ts';

export type MembershipAtomicAnchor={scopeId:string;ownerId:string;kind:'space'|'project';resourceId:string;generation:number;directoryRevision:number;checkpointHash:string;entityId:string;revision:number;payloadHash:string};
export type MembershipAtomicProducts={scopeId:string;intentId:string;operations:ProductMutation[]};
export type MembershipAtomicPage=
 |{kind:'acl';items:MembershipChange[]}
 |{kind:'anchors';items:MembershipAtomicAnchor[]}
 |{kind:'clear-assignments';items:{projectId:string;userId:string}[]}
 |{kind:'revoke-invitations';items:{kind:'space'|'project';resourceId:string;userId:string}[]}
 |{kind:'role-events';items:{projectId:string;userId:string;from:string|null;to:string|null}[]}
 |{kind:'product-operations';items:MembershipAtomicProducts[]}
 |{kind:'rotation-packets'|'product-packets';items:SignedE2eeCommand[]};
export type MembershipAtomicPageRef={index:number;kind:MembershipAtomicPage['kind'];count:number;pageHash:string};
export type MembershipAtomicPlan={format:'genesis-membership-atomic-plan-v2';actorId:string;intentId:string;spaceId:string;reviewFingerprint:string;scopeIds:string[];pages:MembershipAtomicPageRef[]};
export type MembershipAtomicReceipt={intentId:string;planHash:string;batchHash:string;changeHash:string;scopes:Record<string,unknown>;products:{scopeId:string;intentId:string;result:Record<string,WireValue>}[];signInRequired:true};
export type MembershipAtomicPhase='plan'|'packets';
export type MembershipAtomicBeginInput={plan:MembershipAtomicPlan;authorization:SignedE2eeCommand};
export type MembershipAtomicPageInput={intentId:string;planHash:string;phase:MembershipAtomicPhase;index:number;page:MembershipAtomicPage;authorization:SignedE2eeCommand};
export type MembershipAtomicStatusInput={intentId:string;planHash:string;phase:MembershipAtomicPhase;after:number;authorization:SignedE2eeCommand};
export type MembershipAtomicCancelInput={intentId:string;planHash:string;authorization:SignedE2eeCommand};
export interface MembershipAtomicTransport{
 membershipAtomicBegin(input:MembershipAtomicBeginInput):Promise<unknown>;
 membershipAtomicPage(input:MembershipAtomicPageInput):Promise<unknown>;
 membershipAtomicStatus(input:MembershipAtomicStatusInput):Promise<unknown>;
 membershipAtomicCancel(input:MembershipAtomicCancelInput):Promise<unknown>;
}
const planKinds=['acl','anchors','clear-assignments','revoke-invitations','role-events','product-operations'] as const;
const packetKinds=['rotation-packets','product-packets'] as const;
const invalid=():never=>{throw new Error('E2EE_MEMBERSHIP_ATOMIC_INVALID');};
const integer=(value:unknown,min=0)=>{if(!Number.isSafeInteger(value)||Number(value)<min||Number(value)>=Number.MAX_SAFE_INTEGER)invalid();};
export function membershipAtomicDigest(value:unknown){const bytes=canonicalE2eeValue(value as WireValue);try{return encodeE2eeBytes(sha256(bytes));}finally{bytes.fill(0);}}
export function validateMembershipAtomicAnchor(input:unknown):MembershipAtomicAnchor{
 exactKeys(input,['scopeId','ownerId','kind','resourceId','generation','directoryRevision','checkpointHash','entityId','revision','payloadHash']);
 for(const key of ['scopeId','ownerId','resourceId','entityId'])assertTechnical(input[key]);if(!['space','project'].includes(String(input.kind))||input.entityId!==input.kind+':'+input.resourceId)invalid();
 for(const key of ['generation','directoryRevision','revision'])integer(input[key],1);decodeE2eeBytes(input.checkpointHash,32);decodeE2eeBytes(input.payloadHash,32);return structuredClone(input) as MembershipAtomicAnchor;
}
export function validateMembershipAtomicPage(input:unknown):MembershipAtomicPage{
 exactKeys(input,['kind','items']);if(!Array.isArray(input.items)||input.items.length<1||input.items.length>200||![...planKinds,...packetKinds].includes(input.kind as never))invalid();
 const seen=new Set<string>();const unique=(key:string)=>{if(seen.has(key))invalid();seen.add(key);};
 if(input.kind==='acl')validateMembershipChanges(input.items);
 else for(const item of input.items){
  switch(input.kind){
   case'anchors':{const row=validateMembershipAtomicAnchor(item);unique(row.scopeId);break;}
   case'clear-assignments':exactKeys(item,['projectId','userId']);assertTechnical(item.projectId);assertTechnical(item.userId);unique(item.projectId+'\0'+item.userId);break;
   case'revoke-invitations':exactKeys(item,['kind','resourceId','userId']);if(!['space','project'].includes(String(item.kind)))invalid();assertTechnical(item.resourceId);assertTechnical(item.userId);unique(item.kind+'\0'+item.resourceId+'\0'+item.userId);break;
   case'role-events':exactKeys(item,['projectId','userId','from','to']);assertTechnical(item.projectId);assertTechnical(item.userId);for(const key of ['from','to'])if(item[key]!==null&&!['manager','member','commenter','viewer'].includes(String(item[key])))invalid();unique(item.projectId+'\0'+item.userId);break;
   case'product-operations':exactKeys(item,['scopeId','intentId','operations']);assertTechnical(item.scopeId);assertTechnical(item.intentId);unique(item.scopeId+'\0'+item.intentId);
    if(!Array.isArray(item.operations)||item.operations.length<1||item.operations.length>100||new Set(item.operations.map(row=>productMutation(row).entityId)).size!==item.operations.length||item.operations.some(row=>row.action==='propose-complete'))invalid();break;
   case'rotation-packets':case'product-packets':exactKeys(item,['command','signature']);commandBytes(item.command);decodeE2eeBytes(item.signature,64);
    if(item.command.action!==(input.kind==='rotation-packets'?'rotate-membership':'product-commit-bound'))invalid();unique(item.command.scopeId+'\0'+item.command.operationId);break;
   default:invalid();
  }
 }
 const bytes=canonicalE2eeValue({format:'genesis-membership-page-v2',kind:input.kind,items:input.kind==='acl'?membershipChangesProjection(input.items):input.items} as WireValue);
 try{if(bytes.length>512*1024)throw new Error('E2EE_MEMBERSHIP_PAGE_TOO_LARGE');}finally{bytes.fill(0);}return structuredClone(input) as MembershipAtomicPage;
}
export function membershipAtomicPageRef(index:number,input:unknown):MembershipAtomicPageRef{
 integer(index);const page=validateMembershipAtomicPage(input);return{index,kind:page.kind,count:page.items.length,pageHash:membershipAtomicDigest({format:'genesis-membership-page-v2',kind:page.kind,items:page.kind==='acl'?membershipChangesProjection(page.items):page.items})};
}
export function validateMembershipAtomicRefs(input:unknown,packets:boolean):MembershipAtomicPageRef[]{
 if(!Array.isArray(input)||input.length>10000||!packets&&input.length<1)invalid();
 const kinds:readonly string[]=packets?packetKinds:planKinds;
 for(const [index,row]of input.entries()){exactKeys(row,['index','kind','count','pageHash']);if(row.index!==index||!kinds.includes(String(row.kind)))invalid();integer(row.count,1);if(Number(row.count)>200)invalid();decodeE2eeBytes(row.pageHash,32);}
 return structuredClone(input) as MembershipAtomicPageRef[];
}
export function validateMembershipAtomicPlan(input:unknown):MembershipAtomicPlan{
 exactKeys(input,['format','actorId','intentId','spaceId','reviewFingerprint','scopeIds','pages']);if(input.format!=='genesis-membership-atomic-plan-v2')invalid();
 for(const key of ['actorId','intentId','spaceId'])assertTechnical(input[key]);decodeE2eeBytes(input.reviewFingerprint,32);
 if(!Array.isArray(input.scopeIds)||input.scopeIds.length<1||input.scopeIds.length>5001)invalid();for(const id of input.scopeIds)assertTechnical(id);if(!same([...new Set(input.scopeIds)].sort(),input.scopeIds))invalid();
 validateMembershipAtomicRefs(input.pages,false);return structuredClone(input) as MembershipAtomicPlan;
}
export function membershipAtomicPlanHash(input:MembershipAtomicPlan){return membershipAtomicDigest(validateMembershipAtomicPlan(input));}
export function membershipAtomicChangeHash(input:MembershipAtomicPlan){const plan=validateMembershipAtomicPlan(input);return membershipAtomicDigest({protocol:2,actorId:plan.actorId,intentId:plan.intentId,planHash:membershipAtomicPlanHash(plan),scopeIds:plan.scopeIds});}
export function membershipAtomicBatchHash(input:MembershipAtomicPlan,pages:MembershipAtomicPageRef[]){return membershipAtomicDigest({protocol:2,planHash:membershipAtomicPlanHash(input),packetPages:validateMembershipAtomicRefs(pages,true)});}
/** Adaptive paging keeps the complete ordered result and never drops a suffix. */
export function membershipAtomicPages(kind:MembershipAtomicPage['kind'],items:unknown[]):MembershipAtomicPage[]{
 const pages:MembershipAtomicPage[]=[];let size=Math.min(200,items.length);for(let offset=0;offset<items.length;){
  try{pages.push(validateMembershipAtomicPage({kind,items:items.slice(offset,offset+size)}));offset+=size;size=Math.min(200,items.length-offset);}
  catch(error){if(!(error instanceof Error)||!['E2EE_MEMBERSHIP_PAGE_TOO_LARGE','E2EE_COMMAND_TOO_LARGE'].includes(error.message)||size<=1)throw error;size=Math.max(1,Math.floor(size/2));}
 }return pages;
}
/** Freeze the full effects/anchor manifest after intent-bound immutable product
 * versions were prepared, before owner rotations or final authorization. The
 * raw input and membership-bound product drafts already precede that upload. */
export function membershipAtomicOperationPlan(actorId:string,intentId:string,spaceId:string,reviewFingerprint:string,operation:MembershipOperationPlan,products:MembershipAtomicProducts[]){
 assertTechnical(actorId);assertTechnical(intentId);assertTechnical(spaceId);decodeE2eeBytes(reviewFingerprint,32);
 if('spaceId'in operation.operation&&operation.operation.spaceId!==spaceId)invalid();
 const anchors=operation.requiredScopes.map(scope=>validateMembershipAtomicAnchor({scopeId:scope.scopeId,ownerId:scope.ownerId,
  kind:scope.root.entityId.startsWith('space:')?'space':'project',resourceId:scope.root.entityId.slice(scope.root.entityId.indexOf(':')+1),
  generation:scope.root.generation,directoryRevision:scope.root.directoryRevision,checkpointHash:scope.root.checkpointHash,
  entityId:scope.root.entityId,revision:scope.root.revision,payloadHash:scope.root.payloadHash})).sort((a,b)=>a.scopeId<b.scopeId?-1:a.scopeId>b.scopeId?1:0);
 const pages=[...membershipAtomicPages('acl',operation.changes),...membershipAtomicPages('anchors',anchors),
  ...membershipAtomicPages('clear-assignments',operation.clearAssignments),...membershipAtomicPages('revoke-invitations',operation.revokeInvitations),
  ...membershipAtomicPages('role-events',operation.roleEvents),...membershipAtomicPages('product-operations',products)];
 const scopeIds=[...operation.scopeIds].sort();if(!same(anchors.map(row=>row.scopeId).sort(),scopeIds))invalid();
 const plan=validateMembershipAtomicPlan({format:'genesis-membership-atomic-plan-v2',actorId,intentId,
  spaceId,reviewFingerprint,scopeIds,pages:pages.map((page,index)=>membershipAtomicPageRef(index,page))});
 for(const row of products)if(!scopeIds.includes(row.scopeId))invalid();
 return {plan,pages,planHash:membershipAtomicPlanHash(plan),changeHash:membershipAtomicChangeHash(plan)};
}
