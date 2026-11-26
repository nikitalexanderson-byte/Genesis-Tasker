import {personalDocumentAccess,modelingServiceAccess,usesPrivateProductStorage} from '../cloud-sync';
import {AuroraRepository,type Sealed,type AuroraConflict} from './repository';
import type {AuroraDocument,PreparedAuroraResult,AuroraResultSeal} from './session';
import {AuroraPrivateRepository,privateAuroraDocument,E2eeAuroraResults} from '../e2ee/aurora-product';
export type AuroraTaskRequest={title:string;description:string;dueDate:string|null;dueTime?:string|null;zoneId?:string;kind:'action'|'review';sourceId:string};
export type AuroraHost={ownerId:string;language:string;client:'web'|'android'|'android-play';canAddTask:boolean;load:()=>Promise<AuroraDocument>;save:(doc:AuroraDocument)=>Promise<AuroraDocument>;
 captureMigration?:(current:AuroraDocument|null)=>import('../e2ee/aurora-source').AuroraMigrationMemory['current'];
 syncState:()=>string;sealResult:(value:unknown,id:string)=>Promise<AuroraResultSeal>;prepareResult:(value:PreparedAuroraResult)=>Promise<void>;
 conflictVersions:()=>Promise<AuroraConflict|null>;recoverConflict:(newIds:Readonly<Record<string,string>>,now:string)=>Promise<AuroraDocument>;
 readResult:(id:string)=>Promise<{id:string;solution:unknown}>;billing:<T>(path:string,init?:RequestInit)=>Promise<T>;
 openCheckout:(url:string)=>void;addTask:(value:AuroraTaskRequest)=>void;speak:(pronunciation:string)=>void;close:()=>void};
export function webAuroraHost(input:{ownerId:string;language:string;close:()=>void;addTask?:(value:AuroraTaskRequest)=>void}):AuroraHost{
 const access=personalDocumentAccess(input.ownerId),billing=modelingServiceAccess(input.ownerId),privateMode=usesPrivateProductStorage(input.ownerId),
  results=privateMode?new E2eeAuroraResults(input.ownerId):null,
  repo=privateMode?new AuroraPrivateRepository(input.ownerId,privateAuroraDocument(input.ownerId)):new AuroraRepository(input.ownerId,localStorage,access);
 return {ownerId:input.ownerId,language:input.language,client:'web',canAddTask:Boolean(input.addTask),load:()=>repo.load(),save:doc=>repo.save(doc),syncState:()=>repo.syncState,
  ...(!privateMode&&repo instanceof AuroraRepository?{captureMigration:(current:AuroraDocument|null)=>repo.captureMigrationState(current)}:{}),
  conflictVersions:()=>repo.conflictVersions(),recoverConflict:(ids,now)=>repo.recoverAsCopy(ids,now),
  sealResult:(value,id)=>results?results.seal(value,id):access.seal(value,`aurora-result:v1:${id}`),prepareResult:async value=>{if(results){await results.prepare(value);return;}
   if('kind'in value)throw new Error('AURORA_RESULT_MISMATCH');await access.request('/aurora-results',{method:'POST',body:JSON.stringify(value)});},
  readResult:async id=>{const result=await billing.request<{id:string;solution:unknown}>(`/billing/modeling/results/${id}`);
   if(result.id!==id)throw new Error('AURORA_RESULT_MISMATCH');if(results)return{id,solution:await results.open(id,result.solution)};
   const solution=result.solution as Sealed&{kind:string};if(solution?.kind!=='aurora-encrypted-solution-v1')throw new Error('AURORA_RESULT_MISMATCH');
   return {id,solution:await access.open(solution,`aurora-result:v1:${id}`)};},
  billing:billing.request,openCheckout:url=>window.location.assign(url),addTask:value=>input.addTask?.(value),
  speak:pronunciation=>{if('speechSynthesis' in window){speechSynthesis.cancel();const utterance=new SpeechSynthesisUtterance(pronunciation);utterance.lang='ru-RU';utterance.rate=0.8;speechSynthesis.speak(utterance);}},close:input.close};
}
