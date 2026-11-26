import {sha256} from '@noble/hashes/sha2.js';
import {canonicalE2eeValue,type WireValue} from './commands.ts';
import {encodeE2eeBytes} from './envelope.ts';
import {parseE2eeTransportJson} from './transport-json.ts';
import type {MigrationContentPlanningSession} from './content-planning-session.ts';
import type {MigrationSourceContext} from './migration.ts';
import type {SignedMigrationTransport} from './migration-transport.ts';

export type LegacyReadPorts=Pick<SignedMigrationTransport,'legacyWorkspace'|'legacyAurora'|'legacyStoicheion'|'legacyAdvice'|'legacyTasks'|'legacyDiary'|'legacyMindmaps'|
 'legacyMindmapsPage'|'legacyPhysisPage'|'legacyRemindersPage'|'legacyArchiveFragment'|'legacySharedMindmapsPage'|'legacyPrivatePathFragment'>&Partial<Pick<SignedMigrationTransport,'legacyPrivatePathBatch'>>;
type Page={table:string;offset:number;byteOffset?:number;pathId?:string;maxFragments?:number};
type Read=(action:string,context:MigrationSourceContext,page?:Page)=>Promise<unknown>;
function port(read:Read):LegacyReadPorts{return{
 legacyWorkspace:context=>read('legacy-workspace',context),legacyAurora:context=>read('legacy-aurora',context),legacyStoicheion:context=>read('legacy-stoicheion',context),
 legacyAdvice:context=>read('legacy-advice',context),legacyTasks:context=>read('legacy-tasks',context),legacyDiary:context=>read('legacy-diary',context),legacyMindmaps:context=>read('legacy-mindmaps',context),
 legacyMindmapsPage:(context,table,offset)=>read('legacy-mindmaps',context,{table,offset}),legacyPhysisPage:(context,table,offset)=>read('legacy-physis',context,{table,offset}),
 legacyRemindersPage:(context,table,offset)=>read('legacy-reminders',context,{table,offset}),legacyArchiveFragment:(context,table,offset,byteOffset)=>read('legacy-archives',context,{table,offset,byteOffset}),
 legacySharedMindmapsPage:(context,table,offset)=>read('legacy-shared-mindmaps',context,{table,offset}),
 legacyPrivatePathFragment:(context,pathId,table,offset,byteOffset)=>read('legacy-private-path',context,{pathId,table,offset,byteOffset}),legacyPrivatePathBatch:(context,pathId,table,offset,byteOffset)=>read('legacy-private-path',context,{pathId,table,offset,byteOffset,maxFragments:50})};}
/** One phase owns a revocable feature-read port. Capture uses signed HTTP;
 * reconciliation uses the immutable responses already protected by that capture. */
export class MigrationSourceReadRouter{
 #active:LegacyReadPorts|null=null;
 readonly port:LegacyReadPorts;
 constructor(){this.port=port(async(action,context,page)=>{
  const active=this.#active;if(!active)throw new Error('E2EE_SOURCE_READ_PHASE_REQUIRED');
  const mapping:Record<string,keyof LegacyReadPorts>={'legacy-workspace':'legacyWorkspace','legacy-aurora':'legacyAurora','legacy-stoicheion':'legacyStoicheion','legacy-advice':'legacyAdvice','legacy-tasks':'legacyTasks','legacy-diary':'legacyDiary','legacy-mindmaps':page?'legacyMindmapsPage':'legacyMindmaps','legacy-physis':'legacyPhysisPage','legacy-reminders':'legacyRemindersPage','legacy-archives':'legacyArchiveFragment','legacy-shared-mindmaps':'legacySharedMindmapsPage','legacy-private-path':page?.maxFragments&&active.legacyPrivatePathBatch?'legacyPrivatePathBatch':'legacyPrivatePathFragment'};
  const method=mapping[action];if(!method)throw new Error('E2EE_SOURCE_PATH_FORBIDDEN');
  const args=page?(page.pathId?[context,page.pathId,page.table,page.offset,page.byteOffset]:page.byteOffset!==undefined?[context,page.table,page.offset,page.byteOffset]:[context,page.table,page.offset]):[context];
  const result=await (active[method] as (...args:unknown[])=>Promise<unknown>)(...args);
  if(this.#active!==active)throw new Error('E2EE_SOURCE_READ_PHASE_REQUIRED');return result;
 });}
 async use<T>(active:LegacyReadPorts,operation:()=>Promise<T>):Promise<T>{
  if(this.#active)throw new Error('E2EE_SOURCE_READ_PHASE_BUSY');this.#active=active;
  try{return await operation();}finally{this.#active=null;}
 }
}

/** A saved response never becomes a new HTTP request. Matching uses the exact
 * signed packet plus independently checked raw-body EOF. Lease renewal can
 * change only the technical fence supplied to the category reader, after its
 * original fence/source/owner have been checked against that signed packet. */
export function createOriginalSourceReplay(session:MigrationContentPlanningSession,assertCurrent:()=>void){
 const consumed=new Set<string>();let closed=false;
 const current=()=>{assertCurrent();if(closed)throw new Error('E2EE_SOURCE_REPLAY_CLOSED');};
 const read:Read=async(action,context,page)=>{
  current();const batchPage=page;if(batchPage?.maxFragments&&!session.originals.some(row=>{const p=row.packet?.command.payload;return row.packet?.command.action===action&&p?.pathId===batchPage.pathId&&p?.table===batchPage.table&&p?.offset===batchPage.offset&&p?.byteOffset===batchPage.byteOffset&&p?.maxFragments===batchPage.maxFragments;})){const {maxFragments,...singlePage}=batchPage;void maxFragments;page=singlePage;}
  const original=[...session.originals].reverse().find(row=>{
   const packet=row.packet;if(!packet||packet.command.action!==action)return false;const payload=packet.command.payload;
   if(packet.command.ownerId!==context.ownerId||packet.command.scopeId!==context.scopeId||payload.migrationId!==context.migrationId||payload.sourceHash!==context.sourceHash)return false;
   const fields=page??{};return Object.entries(fields).every(([key,value])=>payload[key]===value)&&['pathId','table','offset','byteOffset','maxFragments'].every(key=>Object.hasOwn(payload,key)===Object.hasOwn(fields,key));
  });
  if(!original?.packet)throw new Error('E2EE_CAPTURED_SOURCE_REQUIRED');
  const encoded=canonicalE2eeValue(original.packet as unknown as WireValue);try{if(encodeE2eeBytes(sha256(encoded))!==original.registration.binding.packetHash)throw new Error('E2EE_CORRUPT_STREAMED_OWNERSHIP');}finally{encoded.fill(0);}
  const parts:Uint8Array[]=[];let size=0,value:Record<string,unknown>|undefined;
  try{
   await session.withOriginal(original.completion.id,async source=>{
    for await(const bytes of source){current();size+=bytes.length;if(size>16*1024*1024)throw new Error('E2EE_RESPONSE_TOO_LARGE');parts.push(new Uint8Array(bytes));}
    const raw=new Uint8Array(size);try{let at=0;for(const part of parts){raw.set(part,at);at+=part.length;}value=parseE2eeTransportJson(new TextDecoder('utf-8',{fatal:true}).decode(raw));}finally{raw.fill(0);}
   });current();consumed.add(original.completion.id);
   const response=value!,binding=original.registration.binding;
   if(response.protocol!==1||response.ownerId!==context.ownerId||response.scopeId!==context.scopeId||response.migrationId!==context.migrationId||response.sourceHash!==context.sourceHash
    ||response.fence!==binding.fence||binding.fence>context.fence||response.checkpointHash!==binding.checkpointHash||response.directoryRevision!==binding.directoryRevision)throw new Error('E2EE_CAPTURED_SOURCE_CONTEXT');
   if(original.packet.command.payload.maxFragments!==undefined){if(!Array.isArray(response.fragments)||!response.fragments.length||response.fragments.length>Number(original.packet.command.payload.maxFragments))throw new Error('E2EE_CAPTURED_SOURCE_CONTEXT');response.fragments=response.fragments.map(raw=>{if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('E2EE_CAPTURED_SOURCE_CONTEXT');const part=raw as Record<string,unknown>;for(const key of ['protocol','ownerId','scopeId','kind','resourceId','migrationId','fence','sourceHash','checkpointHash','directoryRevision'])if(part[key]!==response[key])throw new Error('E2EE_CAPTURED_SOURCE_CONTEXT');return{...part,fence:context.fence};}) as WireValue;}
   return{...response,fence:context.fence};
  }finally{parts.forEach(bytes=>bytes.fill(0));}
 };
 return{port:port(read),async drain(){current();for(const row of session.originals)if(!consumed.has(row.completion.id)){
  await session.withOriginal(row.completion.id,async source=>{for await(const bytes of source){current();bytes.fill(0);}});current();consumed.add(row.completion.id);
 }},close(){closed=true;consumed.clear();}};
}
