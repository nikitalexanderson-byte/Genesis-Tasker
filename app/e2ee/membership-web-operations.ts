import {requirePrivateAccount,type WebPrivateAccount} from './product-session.ts';
import {E2eeDeviceDocument} from './device-document.ts';
import {E2eeSharedTrust} from './shared-trust.ts';
import {MembershipOperationDrafts,MEMBERSHIP_OPERATION_DRAFT_PREFIX,validateMembershipOperationDraft,type MembershipOperationDraft} from './membership-operation-drafts.ts';
import {captureMembershipOperationSnapshot} from './membership-operation-selection.ts';
import type {E2eeSharedRecords} from './shared-records.ts';

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
