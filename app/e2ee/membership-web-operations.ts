import {requirePrivateAccount,type WebPrivateAccount} from './product-session.ts';
import {E2eeDeviceDocument} from './device-document.ts';
import {E2eeSharedTrust} from './shared-trust.ts';
import {MembershipOperationDrafts,MEMBERSHIP_OPERATION_DRAFT_PREFIX,validateMembershipOperationDraft,type MembershipOperationDraft} from './membership-operation-drafts.ts';
import {captureMembershipOperationSnapshot} from './membership-operation-selection.ts';
import type {E2eeSharedRecords} from './shared-records.ts';
import {MembershipOperationComposer} from './membership-operation-compose.ts';
import type {MembershipAtomicOwnerReviews} from './membership-atomic-owner.ts';
import {membershipProjectAccessProbe,membershipProjectAccessFingerprint,privateProjectAccessView} from './membership-project-access.ts';
import type {SharedProjectAccessDraft} from '../shared-project-access.ts';

const drafts=new WeakMap<WebPrivateAccount,MembershipOperationDrafts>();
export function privateMembershipOperationDrafts(ownerId:string){
 const account=requirePrivateAccount(ownerId),cached=drafts.get(account);if(cached)return cached;
 const current=()=>{account.requireOpen();if(account.mode!=='online')throw new Error('E2EE_ONLINE_REQUIRED');};
 const local=(id:string)=>new E2eeDeviceDocument<MembershipOperationDraft>(account.device,MEMBERSHIP_OPERATION_DRAFT_PREFIX+id,value=>validateMembershipOperationDraft(value,ownerId,id),current);
 const trust=new E2eeSharedTrust(ownerId),membership=account.membership();
 const value=new MembershipOperationDrafts({ownerId,current,load:id=>local(id).load(),save:async(id,input,expected)=>(await local(id).save(input,expected)).serial,
  list:async()=>{current();const ids=await account.device.vault.listLocal('draft',MEMBERSHIP_OPERATION_DRAFT_PREFIX);current();return ids.map(id=>id.slice(MEMBERSHIP_OPERATION_DRAFT_PREFIX.length));},
  capture:async operation=>{const records=new Map<string,E2eeSharedRecords>();return captureMembershipOperationSnapshot(operation,{actorId:ownerId,current,
   bindings:async()=>{const rows=await trust.list();current();return rows.map(({scopeId,kind,resourceId})=>({scopeId,kind,resourceId})).sort((a,b)=>a.scopeId<b.scopeId?-1:a.scopeId>b.scopeId?1:0);},
   graph:spaceId=>membership.graph(spaceId),state:async targets=>({rows:await membership.readState(targets)}),
   open:async(kind,resourceId,scopeId)=>{const scope=await trust.open(scopeId);current();const directory=scope.directory,own=directory.devices.get(account.device.deviceId);
    if(directory.scopeId!==scopeId||directory.kind!==kind||directory.resourceId!==resourceId||!own||own.revoked||own.userId!==ownerId)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
    const {records:repository}=await account.sharedRecords(scopeId,kind,resourceId);current();records.set(scopeId,repository);const entities=await repository.index();current();
    return{scope:{scopeId,ownerId:directory.ownerId,state:directory.state},generation:directory.generation,directoryRevision:directory.checkpoint.revision,checkpointHash:directory.checkpoint.hash,entities};
   },read:async(scopeId,entity)=>{const repository=records.get(scopeId);if(!repository)throw new Error('E2EE_SHARED_SCOPE_UNLOCK_REQUIRED');const result=await repository.read(entity);current();return result;},
  });},
 });drafts.set(account,value);return value;
}
export function webMembershipOperationComposer(account:WebPrivateAccount,owners:MembershipAtomicOwnerReviews,guard:()=>void){
 const current=()=>{guard();account.requireOpen();if(account.mode!=='online')throw new Error('E2EE_ONLINE_REQUIRED');},trust=new E2eeSharedTrust(account.ownerId),records=new Map<string,E2eeSharedRecords>();
 const repository=(scopeId:string)=>{current();const value=records.get(scopeId);if(!value)throw new Error('E2EE_SHARED_SCOPE_UNLOCK_REQUIRED');return value;};
 return new MembershipOperationComposer({ownerId:account.ownerId,current,drafts:privateMembershipOperationDrafts(account.ownerId),stager:account.membershipAtomic(),owners,
  open:async scope=>{current();const opened=await trust.open(scope.scopeId);current();const directory=opened.directory,own=directory.devices.get(account.device.deviceId),kind=directory.kind;
   if(kind==='personal'||directory.ownerId!==scope.ownerId||!own||own.revoked||own.userId!==account.ownerId)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
   const {records:value}=await account.sharedRecords(scope.scopeId,kind,directory.resourceId);current();records.set(scope.scopeId,value);const entities=await value.index();current();
   return{scopeId:scope.scopeId,ownerId:directory.ownerId,kind,resourceId:directory.resourceId,generation:directory.generation,directoryRevision:directory.checkpoint.revision,checkpointHash:directory.checkpoint.hash,entities};},
  read:async(scopeId,entity)=>{const value=await repository(scopeId).read(entity);current();return value;},
  stage:async(scopeId,edits,membershipIntentId,productIntentId)=>{await repository(scopeId).product.stageForMembership(edits,membershipIntentId,productIntentId);current();},
  prepare:async(scopeId,id)=>{const result=await repository(scopeId).product.prepare(id);current();return result;},
  sign:async(scopeId,id,hash,operations)=>{const binding=repository(scopeId).binding,scope=account.shared(scopeId,binding.kind,binding.resourceId);current();const packet=await scope.client.prepareMembershipProduct(id,hash,operations);current();return packet;},
 });
}
export async function webPrivateProjectAccess(ownerId:string,spaceId:string,userId:string,desired:SharedProjectAccessDraft|null){
 const account=requirePrivateAccount(ownerId),current=()=>{account.requireOpen();if(account.mode!=='online')throw new Error('E2EE_ONLINE_REQUIRED');},trust=new E2eeSharedTrust(ownerId),drafts=privateMembershipOperationDrafts(ownerId),probe=membershipProjectAccessProbe(spaceId,userId),snapshot=await drafts.snapshot(probe),records=new Map<string,E2eeSharedRecords>();current();
 const result=await privateProjectAccessView(snapshot,userId,desired,{current,open:async(scope,kind,resourceId)=>{const opened=await trust.open(scope.scopeId);current();const directory=opened.directory,root=scope.root;
  if(directory.ownerId!==scope.ownerId||directory.kind!==kind||directory.resourceId!==resourceId||directory.generation!==root.generation||directory.checkpoint.revision!==root.directoryRevision||directory.checkpoint.hash!==root.checkpointHash)throw new Error('E2EE_MEMBERSHIP_STALE');
  const {records:value}=await account.sharedRecords(scope.scopeId,kind,resourceId);current();records.set(scope.scopeId,value);const entities=await value.index();current();return entities;
 },read:async(scopeId,entity)=>{const record=records.get(scopeId);if(!record)throw new Error('E2EE_SHARED_SCOPE_UNLOCK_REQUIRED');const value=await record.read(entity);current();return value;},history:async(scopeId,id,before)=>{const record=records.get(scopeId);if(!record)throw new Error('E2EE_SHARED_SCOPE_UNLOCK_REQUIRED');const value=await record.product.history(id,before);current();return value;}});current();
 const after=await drafts.snapshot(probe);current();if(membershipProjectAccessFingerprint(after,userId)!==membershipProjectAccessFingerprint(snapshot,userId))throw new Error('E2EE_MEMBERSHIP_STALE');return result;
}
