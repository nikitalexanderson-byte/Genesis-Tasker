import {assertTechnical} from './e2ee/keys.ts';

import type {WebSharedMigrationTarget} from './e2ee/web-product-migration.ts';
export type PrivateMigrationUi=Readonly<{id:string;ownerId:string;language:string;reason:'setup'|'resume';target?:Readonly<WebSharedMigrationTarget>}>;
let state:PrivateMigrationUi|null=null,listening=false;
const listeners=new Set<()=>void>();
export const privateMigrationUi=()=>state;
export const subscribePrivateMigrationUi=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};};
const notify=()=>{for(const listener of listeners)listener();};
/** Opening this UI grants no key or migration permission. The explicit submit
 * still verifies the authenticated owner, pilot policy and recovery material. */
export function showPrivateMigration(ownerId:string,language:string,reason:PrivateMigrationUi['reason'],target?:WebSharedMigrationTarget){
 assertTechnical(ownerId);
 if(target){assertTechnical(target.scopeId);assertTechnical(target.resourceId);if(!['space','project'].includes(target.kind))throw new Error('E2EE_SCOPE_BINDING_MISMATCH');}
 if(!listening&&typeof window!=='undefined'){listening=true;window.addEventListener('genesis-local-session-ended',()=>{state=null;notify();});}
 if(state?.ownerId===ownerId)return;
 state=Object.freeze({id:crypto.randomUUID(),ownerId,language,reason,...(target?{target:Object.freeze({...target})}:{})});notify();
}
export function closePrivateMigrationUi(id:string){if(state?.id!==id)return;state=null;notify();}
