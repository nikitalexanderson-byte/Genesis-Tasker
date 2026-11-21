import {assertTechnical,exactKeys} from './keys.ts';
import {decodeE2eeBytes,encodeE2eeBytes,type E2eeContext} from './envelope.ts';
import {parseLegacyMigrationJson} from './legacy-json.ts';
import {privatePathSource} from './private-path-source.ts';
import type {PrivatePathRemote} from './private-path-fragments.ts';
import type {PrivatePathLocalInventory} from './local-work-source.ts';
import type {PrivatePathAdapter} from './migration-sources.ts';
import {privatePathDocumentDomain,type PrivateScopeKind} from './private-paths.ts';
import {E2EE_MIGRATION_BYTE_BUDGET,type MigrationContent,type MigrationSourceContext} from './migration.ts';

type Target=Readonly<{ownerId:string;scopeId:string;kind:PrivateScopeKind;resourceId:string;pathId:string}>;
type Snapshot={protocol:1;target:Target;capturedAt:string;local:PrivatePathLocalInventory};
type Row=Record<string,unknown>;
export type PrivateTableDocument={format:'genesis-private-table-v1';pathId:string;table:string;rows:Row[];execution:'content-only'};
export function privateTableObjectId(pathId:string,table:string){assertTechnical(pathId);assertTechnical(table);return`private-table:${pathId}:${table}`;}
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true}),MAX=64*1024*1024;
function invalid():never{throw new Error('E2EE_RELATIONAL_SOURCE_INVALID');}
function object(value:unknown):asserts value is Row{if(!value||typeof value!=='object'||Array.isArray(value))invalid();}
function validateJsonFields(value:Row){for(const [name,raw]of Object.entries(value))if(raw!==null&&(name.endsWith('_json')||['payload','content'].includes(name))&&typeof raw==='string'){
 // A text column named content can also be an ordinary text body. Known JSON
 // families must be strict; user text is never reparsed as a command.
 if(name.endsWith('_json')||name==='payload'||name==='content')parseLegacyMigrationJson(raw,'E2EE_RELATIONAL_SOURCE_INVALID',MAX);
}}
/** Lossless table content plus inert retained local variants. Source tables and
 * every column are fixed by the shared inventory; there is no ACL/import API.
 * Files become real new-key attachment objects and private manifest references. */
export class RelationalPrivatePathSource implements PrivatePathAdapter{
 readonly id:string;#target:Target;#domain:E2eeContext['domain'];#ports:{assertCurrent:()=>void;capture:()=>Promise<PrivatePathLocalInventory>;
 read:(context:MigrationSourceContext)=>Promise<PrivatePathRemote>};
 constructor(target:Target,ports:{assertCurrent:()=>void;capture:()=>Promise<PrivatePathLocalInventory>;read:(context:MigrationSourceContext)=>Promise<PrivatePathRemote>}){
  const source=privatePathSource(target.kind,target.pathId);assertTechnical(target.ownerId);assertTechnical(target.scopeId);assertTechnical(target.resourceId);
  this.#target=Object.freeze({...target});this.id=source.id;this.#domain=privatePathDocumentDomain(target.kind,target.pathId);this.#ports=ports;
 }
 async captureLocal():Promise<Uint8Array>{
  this.#ports.assertCurrent();const local=structuredClone(await this.#ports.capture());this.#ports.assertCurrent();
  const bytes=encoder.encode(JSON.stringify({protocol:1,target:this.#target,capturedAt:new Date().toISOString(),local}));
  if(bytes.length>MAX){bytes.fill(0);throw new Error('E2EE_SNAPSHOT_TOO_LARGE');}return bytes;
 }
 #snapshot(bytes:Uint8Array):Snapshot{
  if(bytes.length<1||bytes.length>MAX)invalid();const input=parseLegacyMigrationJson(decoder.decode(bytes),'E2EE_RELATIONAL_SOURCE_INVALID',MAX);
  exactKeys(input,['protocol','target','capturedAt','local']);exactKeys(input.target,['ownerId','scopeId','kind','resourceId','pathId']);
  if(input.protocol!==1||Object.entries(this.#target).some(([name,value])=>input.target[name]!==value))throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
  if(typeof input.capturedAt!=='string'||!Number.isFinite(Date.parse(input.capturedAt)))invalid();exactKeys(input.local,['platform','entries','editors','inventoryVersion']);
  if(!['web','android'].includes(String(input.local.platform))||input.local.inventoryVersion!==1||!Array.isArray(input.local.entries)||!Array.isArray(input.local.editors)
   ||input.local.entries.length>10000||input.local.editors.length>1000)invalid();
  const seen=new Set<string>();for(const item of input.local.entries){exactKeys(item,['store','key','raw','content','spaceId','projectId']);
   if(typeof item.store!=='string'||typeof item.key!=='string'||typeof item.raw!=='string'||seen.has(item.store+'\0'+item.key))invalid();seen.add(item.store+'\0'+item.key);
   if(input.local.platform==='android'){object(item.content);if(typeof item.content.rawDocument!=='string'||item.content.execution!=='history-only')invalid();parseLegacyMigrationJson(item.content.rawDocument,'E2EE_LOCAL_WORK_SOURCE_INVALID',MAX);}
   if(item.spaceId!==null)assertTechnical(item.spaceId);if(item.projectId!==null)assertTechnical(item.projectId);
   if(this.#target.kind==='project'&&item.projectId!==this.#target.resourceId||this.#target.kind==='space'&&(item.spaceId!==this.#target.resourceId||item.projectId!==null&&item.projectId!==this.#target.resourceId))throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
  }
  return input as Snapshot;
 }
 async reconcile(local:Uint8Array,previous:readonly Uint8Array[],context?:MigrationSourceContext){
  this.#ports.assertCurrent();const target=this.#target;
  if(!context||context.ownerId!==target.ownerId||context.scopeId!==target.scopeId)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
  if(previous.length>32||local.length+previous.reduce((sum,value)=>sum+value.length,0)>E2EE_MIGRATION_BYTE_BUDGET)throw new Error('E2EE_MIGRATION_HISTORY_LIMIT');
  const snapshots=[this.#snapshot(local),...previous.map(value=>this.#snapshot(value))],schema=privatePathSource(target.kind,target.pathId);
  const remote=await this.#ports.read(context);this.#ports.assertCurrent();exactKeys(remote,['protocol','ownerId','scopeId','kind','resourceId','pathId','tables']);
  if(remote.protocol!==1||remote.ownerId!==target.ownerId||remote.scopeId!==target.scopeId||remote.kind!==target.kind||remote.resourceId!==target.resourceId||remote.pathId!==target.pathId)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
  exactKeys(remote.tables,schema.server);const content:MigrationContent[]=[],localContent:MigrationContent[]=[];let size=0;
  const add=(placement:'remote'|'local',domain:E2eeContext['domain'],objectId:string,value:unknown,metadata?:{filename:string;mediaType:string})=>{
   const bytes=value instanceof Uint8Array?new Uint8Array(value):encoder.encode(JSON.stringify(value));size+=bytes.length;
   if(bytes.length>MAX||size>E2EE_MIGRATION_BYTE_BUDGET||content.length+localContent.length>=10000){bytes.fill(0);throw new Error('E2EE_SOURCE_TOO_LARGE');}
   (placement==='remote'?content:localContent).push({domain,objectId,bytes,...metadata});
  };
  try{
   const index:{table:string;objectId:string;count:number}[]=[];
   for(const spec of schema.tables){const sourceRows=remote.tables[spec.table];if(!Array.isArray(sourceRows)||sourceRows.length>1000000)invalid();const rows:Row[]=[];
    for(const item of sourceRows){exactKeys(item,['original','content','execution']);object(item.original);object(item.content);exactKeys(item.original,spec.columns);
     if(item.execution!=='history-only')invalid();const row=structuredClone(item.content);validateJsonFields(row);
     if(['shared_mindmaps','shared_mindmap_versions'].includes(spec.table)){
      const document=parseLegacyMigrationJson(row.content,'E2EE_RELATIONAL_SOURCE_INVALID',2_000_000);object(document);
      const projectId=document.projectId??null;
      if(projectId!==(row.project_id??null)||target.kind==='project'&&projectId!==target.resourceId||target.kind==='space'&&projectId!==null)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
     }
     if(Object.hasOwn(row,'file')){
      if(target.pathId!=='project.files')invalid();exactKeys(row.file,['encoding','bytes','length','sha256','filename','mediaType']);
      const file=row.file;if(file.encoding!=='base64url'||!Number.isSafeInteger(file.length)||(file.length as number)<1||(file.length as number)>MAX||typeof file.filename!=='string'||file.filename.length>512||typeof file.mediaType!=='string'||file.mediaType.length>128)invalid();
      const bytes=decodeE2eeBytes(file.bytes,file.length as number);let hash:Uint8Array|undefined;
      try{hash=new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes)));this.#ports.assertCurrent();
       if(encodeE2eeBytes(hash)!==file.sha256)invalid();const objectId='private-file:'+crypto.randomUUID();
       add('remote','attachment',objectId,bytes,{filename:file.filename,mediaType:file.mediaType});row.file={objectId,size:bytes.length,filename:file.filename,mediaType:file.mediaType};
      }finally{bytes.fill(0);hash?.fill(0);}
     }
     rows.push(row);
    }
    const objectId=privateTableObjectId(target.pathId,spec.table),document:PrivateTableDocument={format:'genesis-private-table-v1',pathId:target.pathId,table:spec.table,rows,execution:'content-only'};
    add('remote',this.#domain,objectId,document);index.push({table:spec.table,objectId,count:rows.length});
   }
   // Historical operations are never shared remote commands. Every retained
   // capture and closed editor survives locally under the new device root.
   const histories=[];for(let i=0;i<snapshots.length;i++){const snapshot=snapshots[i],objectId=`private-work:${target.pathId}:`+crypto.randomUUID();
    const entries=snapshot.local.entries.map(({store,key,content,spaceId,projectId})=>({store,key,content,spaceId,projectId}));
    add('local',this.#domain,objectId,{format:'genesis-private-local-work-v1',pathId:target.pathId,capturedAt:snapshot.capturedAt,entries,editors:snapshot.local.editors,execution:'history-only'});histories.push(objectId);
   }
   add(schema.tables.length?'remote':'local',this.#domain,`private-path:${target.pathId}:index-v1`,{format:'genesis-private-path-index-v1',pathId:target.pathId,tables:index,localHistory:histories,execution:'content-only'});
   this.#ports.assertCurrent();return{complete:true,content,localContent};
  }catch(error){[...content,...localContent].forEach(row=>row.bytes.fill(0));throw error;}
 }
}
