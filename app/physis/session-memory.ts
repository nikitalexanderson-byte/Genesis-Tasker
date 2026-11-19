import {LOCAL_SESSION_ENDED_EVENT} from '../cloud-sync';
import type {VaultState} from './account-session';
import type {PhysisMemoryStore} from './store';

type Session={model:PhysisMemoryStore;vaultState:VaultState};
const sessions=new Map<string,Session>();let listening=false;
function listen(){
 if(listening||typeof window==='undefined')return;listening=true;
 window.addEventListener(LOCAL_SESSION_ENDED_EVENT,clearPhysisSessionMemory);
 window.addEventListener('beforeunload',event=>{if([...sessions.values()].some(({model})=>model.hasPending||model.rotationPending)){event.preventDefault();event.returnValue='';}});
}
/** Page navigation is not logout. Keep unsent records and detached forms in the
 * same unlocked account session; no disk cache or background transport is added. */
export function rememberPhysisSession(ownerId:string,model:PhysisMemoryStore,vaultState:VaultState){
 model.assertCurrent();if(model.owner!==ownerId)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
 const previous=sessions.get(ownerId);if(previous&&previous.model!==model)throw new Error('E2EE_PHYSIS_SESSION_EXISTS');
 listen();sessions.set(ownerId,{model,vaultState:structuredClone(vaultState)});
}
export function retainedPhysisSession(ownerId:string):Session|null{
 const value=sessions.get(ownerId);if(!value)return null;value.model.assertCurrent();return{model:value.model,vaultState:structuredClone(value.vaultState)};
}
export async function capturePhysisSessionMemory(ownerId:string){
 const value=sessions.get(ownerId);if(!value)return[];value.model.assertCurrent();
 const state=await value.model.captureMigrationMemory();value.model.assertCurrent();
 if(sessions.get(ownerId)!==value)throw new Error('E2EE_PHYSIS_CAPTURE_CHANGED');
 if(!value.vaultState.vault)throw new Error('E2EE_PHYSIS_SOURCE_INVALID');
 return[{vault:structuredClone(value.vaultState.vault),state}];
}
export function forgetPhysisSession(ownerId:string){const value=sessions.get(ownerId);sessions.delete(ownerId);value?.model.destroy();}
export function clearPhysisSessionMemory(){const retained=[...sessions.values()];sessions.clear();retained.forEach(value=>value.model.destroy());}
