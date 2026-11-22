import {assertTechnical} from './e2ee/keys.ts';
type Entry={ownerId:string;spaceId:string|null;projectId:string|null;source:string;mounted:boolean;value:unknown};
const live=new Map<object,Entry&{read:()=>unknown}>(),detached:Entry[]=[];
let listening=false;
/** Latest accepted editor input is visible before asynchronous journal writes.
 * Detached inputs remain attributable until logout, alongside durable journals. */
export function registerLocalWorkMigrationEditor(binding:Omit<Entry,'mounted'|'value'>,read:()=>unknown){
 assertTechnical(binding.ownerId);if(binding.spaceId!==null)assertTechnical(binding.spaceId);if(binding.projectId!==null)assertTechnical(binding.projectId);
 // A cross-project selection belongs to the personal recovery inventory. Its
 // actual source/destination coordinates remain in the captured form value.
 if((binding.spaceId===null||binding.projectId===null)&&!['bulk-action','bulk-selection'].includes(binding.source))throw new Error('E2EE_LOCAL_WORK_SOURCE_INVALID');
 if(!binding.source||binding.source.length>128)throw new Error('E2EE_LOCAL_WORK_SOURCE_INVALID');
 if(!listening&&typeof window!=='undefined'){listening=true;window.addEventListener('genesis-local-session-ended',()=>{live.clear();detached.length=0;});}
 const token={};live.set(token,{...binding,mounted:true,value:null,read});
 return()=>{const entry=live.get(token);if(!entry)return;if(detached.length>=1000)throw new Error('E2EE_SOURCE_TOO_LARGE');
  const value=structuredClone(entry.read());live.delete(token);detached.push({...binding,mounted:false,value});};
}
export function captureLocalWorkMigrationMemory(ownerId:string):Entry[]{
 assertTechnical(ownerId);const entries=[...detached.filter(row=>row.ownerId===ownerId).map(row=>structuredClone(row))];
 for(const row of live.values())if(row.ownerId===ownerId)entries.push({ownerId,spaceId:row.spaceId,projectId:row.projectId,source:row.source,mounted:true,value:structuredClone(row.read())});
 if(entries.length>1000)throw new Error('E2EE_SOURCE_TOO_LARGE');return entries;
}
