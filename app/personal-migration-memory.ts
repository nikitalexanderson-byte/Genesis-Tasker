import {assertTechnical} from './e2ee/keys.ts';
import {capturePrivateLocalValues} from './e2ee/local-work-values.ts';
import type {DiaryMigrationMemory} from './e2ee/diary-source.ts';
import type {MindmapsMigrationMemory} from './e2ee/mindmaps-source.ts';
import type {AuroraMigrationMemory} from './e2ee/aurora-source.ts';
import type {StoicheionMigrationMemory} from './e2ee/stoicheion-source.ts';
import type {AdviceMigrationMemory} from './e2ee/advice-source.ts';

/** Product readers expose real repository bases and current input. They do not
 * expose keys, acquire a transport permit, flush a journal or execute a form. */
type Memory={
 diary:Pick<DiaryMigrationMemory,'records'|'editors'>;
 mindmaps:Pick<MindmapsMigrationMemory,'records'|'editors'|'localWork'>;
 aurora:{current:AuroraMigrationMemory['current'];state:unknown};
 stoicheion:{current:StoicheionMigrationMemory['current'];state:unknown};
 'stoicheion-draws':Pick<StoicheionMigrationMemory,'draws'|'timeline'>;
 advice:Pick<AdviceMigrationMemory,'preferences'|'mounted'> & {state?:unknown};
};
export type PersonalMigrationMemory={[K in keyof Memory]:Memory[K]&{settled?:boolean}};
type Kind=keyof PersonalMigrationMemory;
type Reading<K extends Kind=Kind>={sourceId:string;kind:K;mounted:boolean;value:PersonalMigrationMemory[K]};
type Entry={ownerId:string;kind:Kind;read:()=>PersonalMigrationMemory[Kind]};
const live=new Map<string,Entry>(),retained=new Map<string,{ownerId:string;reading:Reading|null}>();
const observers=new Map<string,Set<()=>void>>();
/** Only an in-memory renderer mirror subscribes here. No observer may save,
 * flush a queue or acquire a legacy writer permit while reading a source. */
export function observePersonalMigrationSources(ownerId:string,changed:()=>void){
 assertTechnical(ownerId);let listeners=observers.get(ownerId);if(!listeners)observers.set(ownerId,listeners=new Set());listeners.add(changed);
 const held=listeners;return()=>{held.delete(changed);if(!held.size&&observers.get(ownerId)===held)observers.delete(ownerId);};
}
export function personalMigrationSourcesChanged(ownerId:string){for(const listener of observers.get(ownerId)??[])listener();}
let revision=0,listening=false;
function clear(){live.clear();retained.clear();revision++;}
export function registerPersonalMigrationSource<K extends Kind>(ownerId:string,kind:K,read:()=>PersonalMigrationMemory[K]){
 assertTechnical(ownerId);
 if(!listening&&typeof window!=='undefined'){listening=true;window.addEventListener('genesis-local-session-ended',clear);}
 if(live.size+retained.size>=1000)throw new Error('E2EE_SOURCE_TOO_LARGE');
 const sourceId=crypto.randomUUID();live.set(sourceId,{ownerId,kind,read});revision++;
 return()=>{
  const entry=live.get(sourceId);if(!entry)return;
  // A failed last read remains an explicit blocker; losing a source must never
  // turn an unsuccessful capture into a conveniently empty category.
  let reading:Reading|null=null;
  try{reading={sourceId,kind,mounted:false,value:structuredClone(entry.read())};}catch{/* Block below when this owner's originals are requested. */}
  live.delete(sourceId);retained.set(sourceId,{ownerId,reading});revision++;personalMigrationSourcesChanged(ownerId);
 };
}
export function capturePersonalMigrationSources<K extends Kind>(ownerId:string,kind:K):Reading<K>[];
export function capturePersonalMigrationSources(ownerId:string):Reading[];
export function capturePersonalMigrationSources(ownerId:string,kind?:Kind):Reading[]{
 assertTechnical(ownerId);const before=revision,result:Reading[]=[];
 for(const entry of retained.values())if(entry.ownerId===ownerId){
  if(entry.reading===null)throw new Error('E2EE_DETACHED_SOURCE_CAPTURE_FAILED');
  if(!kind||entry.reading.kind===kind)result.push(structuredClone(entry.reading));
 }
 for(const [sourceId,entry]of live)if(entry.ownerId===ownerId&&(!kind||entry.kind===kind))result.push({sourceId,kind:entry.kind,mounted:true,value:structuredClone(entry.read())});
 if(before!==revision)throw new Error('E2EE_SOURCE_CAPTURE_CHANGED');return result;
}
/** Preserve every mounted/detached input as local, inert original content.
 * Typed domain adapters separately choose how committed records reconcile. */
export async function materializePersonalMigrationSources(ownerId:string,current:()=>void){
 current();const before=revision;
 const captured=await capturePrivateLocalValues(capturePersonalMigrationSources(ownerId),current);current();
 const after=await capturePrivateLocalValues(capturePersonalMigrationSources(ownerId),current);current();
 if(before!==revision||JSON.stringify(captured)!==JSON.stringify(after))throw new Error('E2EE_SOURCE_CAPTURE_CHANGED');
 return captured;
}
