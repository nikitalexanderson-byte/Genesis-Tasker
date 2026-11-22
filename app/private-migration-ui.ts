import {assertTechnical} from './e2ee/keys.ts';

import type {WebSharedMigrationTarget} from './e2ee/web-product-migration.ts';
export type PrivateMigrationUi=Readonly<{id:string;ownerId:string;language:string;reason:'setup'|'resume';target?:Readonly<WebSharedMigrationTarget>;creationId?:string}>;
let state:PrivateMigrationUi|null=null,listening=false;
const creations=new Map<string,{resolve:(value:Record<string,unknown>)=>void;reject:(reason:Error)=>void}>();
const listeners=new Set<()=>void>();
export const privateMigrationUi=()=>state;
export const subscribePrivateMigrationUi=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};};
const notify=()=>{for(const listener of listeners)listener();};
/** Opening this UI grants no key or migration permission. The explicit submit
 * still verifies the authenticated owner, pilot policy and recovery material. */
export function showPrivateMigration(ownerId:string,language:string,reason:PrivateMigrationUi['reason'],target?:WebSharedMigrationTarget,creationId?:string){
 assertTechnical(ownerId);
 if(target){assertTechnical(target.scopeId);assertTechnical(target.resourceId);if(!['space','project'].includes(target.kind))throw new Error('E2EE_SCOPE_BINDING_MISMATCH');}
 if(creationId){assertTechnical(creationId);if(!target||target.kind!=='space')throw new Error('E2EE_SCOPE_BINDING_MISMATCH');}
 if(!listening&&typeof window!=='undefined'){listening=true;window.addEventListener('genesis-local-session-ended',()=>{for(const waiting of creations.values())waiting.reject(new Error('E2EE_ACCOUNT_CHANGED'));creations.clear();state=null;notify();});}
 if(state?.ownerId===ownerId)return;
 state=Object.freeze({id:crypto.randomUUID(),ownerId,language,reason,...(target?{target:Object.freeze({...target})}:{}),...(creationId?{creationId}:{})});notify();
}
export function closePrivateMigrationUi(id:string){if(state?.id!==id)return;if(state.creationId){creations.get(state.creationId)?.reject(new Error('E2EE_RESOURCE_CREATION_PAUSED'));creations.delete(state.creationId);}state=null;notify();}
/** Waiting callers hold no key/secret or durable authority. The encrypted input
 * remains discoverable after cancellation, logout or a full process restart. */
export function waitForPrivateResourceCreation(ownerId:string,language:string,target:WebSharedMigrationTarget,creationId:string){
 if(state||creations.has(creationId))return Promise.reject(new Error('E2EE_MIGRATION_BUSY'));
 return new Promise<Record<string,unknown>>((resolve,reject)=>{
  creations.set(creationId,{resolve,reject});try{showPrivateMigration(ownerId,language,'resume',target,creationId);}catch(reason){creations.delete(creationId);reject(reason);}
 });
}
export function completePrivateResourceCreation(id:string,result:Record<string,unknown>){
 if(state?.id!==id||!state.creationId)throw new Error('E2EE_RESOURCE_CREATION_CHANGED');const creationId=state.creationId;
 creations.get(creationId)?.resolve(structuredClone(result));creations.delete(creationId);state=null;notify();
}
