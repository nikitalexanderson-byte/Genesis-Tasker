import {MembershipAtomicOwnerReviews} from './membership-atomic-owner.ts';
import {parseLegacyMigrationJson} from './legacy-json.ts';
import type {WebPrivateAccount} from './product-session.ts';
import type {E2eeScopeClient} from './scope-client.ts';
import type {MembershipPeerPorts} from './membership-exchange.ts';
import type {MembershipAtomicScopePreview} from './membership-atomic-preview.ts';

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
 });
}
