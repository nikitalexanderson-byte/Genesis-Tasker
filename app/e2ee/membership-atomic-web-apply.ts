import {MembershipAtomicApply} from './membership-atomic-apply.ts';
import {E2eeSharedTrust} from './shared-trust.ts';
import {validateDeviceAccessTarget} from './device-access-contract.ts';
import {membershipBeforeHash} from './membership-contract.ts';
import {exactKeys} from './keys.ts';
import {samePrivateJson as same} from './product-json.ts';
import type {WebPrivateAccount} from './product-session.ts';
import type {MembershipTransport} from './membership-product.ts';
import type {MembershipPeerPorts} from './membership-exchange.ts';
import type {WireValue} from './commands.ts';

const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
/** Concrete foreground account adapters. Receipt callbacks use the normal
 * pinned scope/index/decrypted product repository and never optimistic state. */
export function webMembershipAtomicApply(account:WebPrivateAccount,transport:MembershipTransport,peers:MembershipPeerPorts,guard:()=>void){
 const current=()=>{guard();account.requireOpen();if(account.mode!=='online')throw new Error('E2EE_ONLINE_REQUIRED');};current();
 const {membershipAtomicCommit:commit,membershipAtomicReceipt:receipt,membershipAtomicReceiptPage:page}=transport;
 if(!commit||!receipt||!page)throw new Error('E2EE_MEMBERSHIP_ATOMIC_REQUIRED');
 const trust=new E2eeSharedTrust(account.ownerId),open=async(scopeId:string,ownerId:string)=>{
  current();const target=validateDeviceAccessTarget(await peers.target(scopeId));current();
  if(target.scopeId!==scopeId||target.ownerId!==ownerId||target.kind==='personal')throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
  const opened=await trust.open(scopeId);current();if(opened.directory.ownerId!==ownerId||opened.directory.kind!==target.kind||opened.directory.resourceId!==target.resourceId)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
  const {records}=await account.sharedRecords(scopeId,target.kind,target.resourceId);current();return {target,opened,records};
 };
 return new MembershipAtomicApply({ownerId:account.ownerId,deviceId:account.device.deviceId,current,peers,stager:account.membershipAtomic(),
  read:async id=>{current();const row=await account.device.vault.read('outbox',id);if(!row){current();return null;}try{current();return {value:JSON.parse(decoder.decode(row.value)),serial:row.serial};}finally{row.value.fill(0);}},
  write:async(id,value,expected)=>{current();const bytes=encoder.encode(JSON.stringify(value));try{if(bytes.length>6*1024*1024)throw new Error('E2EE_MEMBERSHIP_PAGE_TOO_LARGE');await account.device.vault.write([{domain:'outbox',objectId:id,value:bytes,expected}]);current();return(expected??0)+1;}finally{bytes.fill(0);}},
  list:async()=>{current();const ids=await account.device.vault.listLocal('outbox','membership-atomic-apply:');current();return ids;},
  sign:async(action,payload)=>{current();await account.personal().client.refresh();current();return account.personal().client.authorizeMembershipAtomicApply(action,payload);},
  transport:{membershipAtomicCommit:input=>commit.call(transport,input),membershipAtomicReceipt:input=>receipt.call(transport,input),membershipAtomicReceiptPage:input=>page.call(transport,input)},
  scope:async(packet,item)=>{const {target,opened,records}=await open(item.scopeId,packet.command.ownerId);await opened.client.confirmMembershipRotation(packet);current();
   await records.get(target.kind as 'space'|'project',target.resourceId);current();},
  product:async(packet,item)=>{const {records}=await open(item.scopeId,packet.command.ownerId);await records.product.confirmPrepared(item.intentId,item.result as unknown as Record<string,WireValue>,packet);current();},
  acl:async intentId=>{const stager=account.membershipAtomic(),state=await stager.inspect(intentId);current();
   for(let index=0;index<state.plan.pages.length;index++){const page=await stager.readPlanPage(intentId,index);current();if(page.kind!=='acl')continue;
    const response=await transport.membershipState(page.items.map(({table,key})=>({table,key})));current();exactKeys(response,['rows']);
    if(!Array.isArray(response.rows)||response.rows.length!==page.items.length)throw new Error('E2EE_MEMBERSHIP_READBACK_MISMATCH');
    for(const [at,row]of response.rows.entries()){const wanted=page.items[at];exactKeys(row,['table','key','before','beforeHash']);const after=wanted.after===null?null:{...wanted.key,...wanted.after};
     if(row.table!==wanted.table||!same(row.key,wanted.key)||row.beforeHash!==membershipBeforeHash(wanted.table,row.before)||row.beforeHash!==membershipBeforeHash(wanted.table,after))throw new Error('E2EE_MEMBERSHIP_READBACK_MISMATCH');
    }
   }
  },
 });
}
