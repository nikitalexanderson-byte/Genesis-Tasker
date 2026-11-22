import {MembershipAtomicOwnerReviews} from './membership-atomic-owner.ts';
import {parseLegacyMigrationJson} from './legacy-json.ts';
import type {WebPrivateAccount} from './product-session.ts';
import type {E2eeScopeClient} from './scope-client.ts';
import type {MembershipPeerPorts} from './membership-exchange.ts';
import type {MembershipAtomicScopePreview} from './membership-atomic-preview.ts';
import {membershipAtomicEffects,verifyMembershipAtomicPrivateEffects,membershipAtomicCandidate} from './membership-atomic-effects.ts';
import {membershipOperationEffectEntities} from './membership-operation-edits.ts';
import {membershipProductIndexHash} from './membership-product-index.ts';
import type {MembershipAtomicPage} from './membership-atomic-contract.ts';
import type {ProductVersion} from './shared-product.ts';

const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
export function webMembershipAtomicOwnerReviews(account:WebPrivateAccount,peers:MembershipPeerPorts,
 openOwned:(plan:MembershipAtomicScopePreview)=>Promise<E2eeScopeClient>,guard:()=>void){
 const current=()=>{guard();account.requireOpen();if(account.mode!=='online')throw new Error('E2EE_ONLINE_REQUIRED');};
 return new MembershipAtomicOwnerReviews({ownerId:account.ownerId,peers,current,
  read:async id=>{current();const row=await account.device.vault.read('outbox',id);if(!row){current();return null;}
   try{current();return{value:parseLegacyMigrationJson(decoder.decode(row.value),'E2EE_MEMBERSHIP_REVIEW_MISMATCH',6*1024*1024),serial:row.serial};}finally{row.value.fill(0);}},
  write:async(id,value,expected)=>{current();const bytes=encoder.encode(JSON.stringify(value));try{if(bytes.length>6*1024*1024)throw new Error('E2EE_MEMBERSHIP_PAGE_TOO_LARGE');
   await account.device.vault.write([{domain:'outbox',objectId:id,value:bytes,expected}],current);current();return(expected??0)+1;}finally{bytes.fill(0);}},
  list:async prefix=>{current();const ids=await account.device.vault.listLocal('outbox',prefix);current();return ids;},
  rotate:async(scope,changeHash)=>{current();if(scope.ownerId!==account.ownerId)throw new Error('E2EE_OWNER_REQUIRED');const client=await openOwned(scope);current();await client.refresh();current();
   const packet=await client.prepareMembershipRotation(changeHash,scope.roles.map(({deviceId,role})=>({deviceId,role})),scope.manifest,scope);current();return packet;},
  reviewEffects:async(request,scope,page)=>{current();if(scope.ownerId!==account.ownerId||!request.createdAt)throw new Error('E2EE_OWNER_REQUIRED');await openOwned(scope);current();
   const pages:MembershipAtomicPage[]=[];for(let index=0;index<request.plan.pages.length;index++){pages.push(await page(index));current();}const effects=membershipAtomicEffects(request.plan,pages),binding={scopeId:scope.scopeId,kind:scope.kind,resourceId:scope.resourceId};
   const {records}=await account.sharedRecords(scope.scopeId,scope.kind,scope.resourceId);current();const entities=await records.index();current();const versions:ProductVersion[]=[],candidates:ProductVersion[]=[];
   for(const entity of membershipOperationEffectEntities(binding,effects.plan,entities)){versions.push(await records.read(entity));current();}
   for(const product of effects.products.filter(row=>row.scopeId===scope.scopeId))for(const operation of product.operations){candidates.push(await records.product.read(membershipAtomicCandidate(operation,request.plan.actorId,request.createdAt)));current();}
   verifyMembershipAtomicPrivateEffects({request,scope,pages,entities,versions,candidates});const after=await records.index();current();if(membershipProductIndexHash(scope.scopeId,after)!==membershipProductIndexHash(scope.scopeId,entities))throw new Error('E2EE_MEMBERSHIP_STALE');
  },
 });
}
