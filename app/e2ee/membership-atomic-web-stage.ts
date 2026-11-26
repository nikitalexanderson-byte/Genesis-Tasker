import type {UnlockedWebDevice} from './device-vault.ts';
import type {E2eeScopeClient} from './scope-client.ts';
import type {MembershipTransport} from './membership-product.ts';
import {MembershipAtomicStager} from './membership-atomic-stager.ts';

const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
/** The current account/session guard and the independently unlocked device are
 * supplied by the product account. HTTP identity alone cannot open this store. */
export function webMembershipAtomicStager(device:UnlockedWebDevice,personal:E2eeScopeClient,transport:MembershipTransport,current:()=>void){
 const {membershipAtomicBegin:begin,membershipAtomicPage:page,membershipAtomicStatus:status,membershipAtomicCancel:cancel,membershipAtomicSeal:seal,membershipAtomicPreview:preview}=transport;
 if(!begin||!page||!status||!cancel||!seal||!preview)throw new Error('E2EE_MEMBERSHIP_ATOMIC_REQUIRED');
 return new MembershipAtomicStager({ownerId:device.ownerId,deviceId:device.deviceId,current,
  read:async id=>{current();const row=await device.vault.read('outbox',id);if(!row){current();return null;}
   try{current();return {value:JSON.parse(decoder.decode(row.value)),serial:row.serial};}finally{row.value.fill(0);}},
  write:async(id,value,expected)=>{current();const bytes=encoder.encode(JSON.stringify(value));
   try{if(bytes.length>6*1024*1024)throw new Error('E2EE_MEMBERSHIP_PAGE_TOO_LARGE');await device.vault.write([{domain:'outbox',objectId:id,value:bytes,expected}]);current();return (expected??0)+1;}finally{bytes.fill(0);}},
  sign:async(action,payload)=>{current();await personal.refresh();current();return personal.authorizeMembershipAtomic(action,payload);},
  transport:{membershipAtomicBegin:input=>begin.call(transport,input),membershipAtomicPage:input=>page.call(transport,input),
   membershipAtomicStatus:input=>status.call(transport,input),membershipAtomicCancel:input=>cancel.call(transport,input),membershipAtomicSeal:input=>seal.call(transport,input),membershipAtomicPreview:input=>preview.call(transport,input)},
 });
}
