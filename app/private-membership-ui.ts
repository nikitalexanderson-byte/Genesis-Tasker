import {assertTechnical} from './e2ee/keys.ts';
import {privateAccountView,subscribePrivateAccount} from './e2ee/product-session.ts';
import {decodeE2eeBytes} from './e2ee/envelope.ts';

export type PrivateMembershipUi=Readonly<{id:string;ownerId:string;language:string;mode:'operation'|'owner';intentId?:string;fingerprint?:string}>;
let state:PrivateMembershipUi|null=null,listening=false;
const listeners=new Set<()=>void>(),waiting=new Map<string,{resolve:(value:Record<string,unknown>)=>void;reject:(reason:Error)=>void}>();
export const privateMembershipUi=()=>state;
export const subscribePrivateMembershipUi=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};};
export const subscribePrivateMembershipClose=(listener:()=>void)=>subscribePrivateMembershipUi(()=>{if(!state)listener();});
const notify=()=>{for(const listener of listeners)listener();};
function listen(){if(listening)return;listening=true;subscribePrivateAccount(()=>{const view=privateAccountView();if(state&&(view.ownerId!==state.ownerId||view.phase!=='ready')){
 for(const value of waiting.values())value.reject(new Error('E2EE_ACCOUNT_CHANGED'));waiting.clear();state=null;notify();
 }});}
export function showPrivateMembershipOperation(ownerId:string,language:string,intentId:string){
 assertTechnical(ownerId);assertTechnical(intentId);listen();if(state)throw new Error('E2EE_MEMBERSHIP_UI_BUSY');state=Object.freeze({id:crypto.randomUUID(),ownerId,language,mode:'operation',intentId});notify();
}
export function showPrivateMembershipOwner(ownerId:string,language:string,fingerprint:string){
 assertTechnical(ownerId);decodeE2eeBytes(fingerprint,32);listen();if(state)throw new Error('E2EE_MEMBERSHIP_UI_BUSY');state=Object.freeze({id:crypto.randomUUID(),ownerId,language,mode:'owner',fingerprint});notify();
}
/** A waiting editor owns no authority. Durable input survives pause/restart. */
export function waitForPrivateMembershipOperation(ownerId:string,language:string,intentId:string){
 if(state||waiting.has(intentId))return Promise.reject(new Error('E2EE_MEMBERSHIP_UI_BUSY'));
 return new Promise<Record<string,unknown>>((resolve,reject)=>{waiting.set(intentId,{resolve,reject});try{showPrivateMembershipOperation(ownerId,language,intentId);}catch(reason){waiting.delete(intentId);reject(reason);}});
}
export function closePrivateMembershipUi(id:string,reason='E2EE_MEMBERSHIP_OPERATION_PAUSED'){
 if(state?.id!==id)return;if(state.intentId){waiting.get(state.intentId)?.reject(new Error(reason));waiting.delete(state.intentId);}state=null;notify();
}
export function completePrivateMembershipUi(id:string,result:Record<string,unknown>){
 if(state?.id!==id||!state.intentId)throw new Error('E2EE_ACCOUNT_CHANGED');waiting.get(state.intentId)?.resolve(structuredClone(result));waiting.delete(state.intentId);state=null;notify();
}
export function replacePrivateMembershipOperation(id:string,intentId:string){
 if(state?.id!==id||!state.intentId)throw new Error('E2EE_ACCOUNT_CHANGED');assertTechnical(intentId);if(waiting.has(intentId))throw new Error('E2EE_MEMBERSHIP_UI_BUSY');
 const old=waiting.get(state.intentId);waiting.delete(state.intentId);if(old)waiting.set(intentId,old);state=Object.freeze({...state,id:crypto.randomUUID(),intentId});notify();
}
