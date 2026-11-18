import {WORKSPACE_SYNC_COLLECTIONS,WORKSPACE_SYNC_FIELDS,workspaceSyncEntityId,prepareWorkspaceForSync,mergeWorkspaceDocuments,
  type SyncableWorkspaceDocument,type WorkspaceSyncMetadata,type WorkspaceFieldConflict,type WorkspaceConflictChoices} from '../workspace-sync-state.ts';
import {assertTechnical,exactKeys} from './keys.ts';
import {decodeE2eeBytes} from './envelope.ts';
import {mergeHabitMeasurementEvents,normalizeHabitRuleHistory} from '../habit-measurement.ts';
import {mergeHabitTimerOperations} from '../habit-timer.ts';
import {mergeHabitHistoryEdits} from '../habit-history.ts';
import {mergeHabitLifecycleEvents} from '../habit-lifecycle.ts';
import type {PrivatePathAdapter} from './migration-sources.ts';
import type {MigrationSourceContext,MigrationContent} from './migration.ts';

const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true}),MAX_BYTES=16*1024*1024;
const json=(value:unknown)=>JSON.stringify(value);
type ObjectValue=Record<string,unknown>;
type Memory={ownerId:string;key:string;version:number;deviceId:string;base:unknown;baseMetadata:unknown;metadata:unknown;current:unknown;draftSource:string|null};
type Snapshot={protocol:1;ownerId:string;scopeId:string;capturedAt:string;entries:{key:string;value:string|null}[];memory:Memory};
export type WorkspaceSourcePorts={
  storage:Pick<Storage,'getItem'|'key'|'length'>;
  /** Synchronous, read-only capture of the actual cloud and mounted editor state. */
  memory:()=>Memory;
  assertCurrent:()=>void;
  legacyWorkspace:(context:MigrationSourceContext)=>Promise<unknown>;
  review?:(conflicts:readonly WorkspaceFieldConflict[],stage:string)=>Promise<WorkspaceConflictChoices>;
};
function object(value:unknown):asserts value is ObjectValue{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('E2EE_WORKSPACE_SOURCE_INVALID');
}
function integer(value:unknown,min=0):asserts value is number{
  if(!Number.isSafeInteger(value)||(value as number)<min)throw new Error('E2EE_WORKSPACE_SOURCE_INVALID');
}
function timestamp(value:unknown):asserts value is string{
  if(typeof value!=='string'||!Number.isFinite(Date.parse(value)))throw new Error('E2EE_WORKSPACE_SOURCE_INVALID');
}
function parse(value:string):unknown{try{return JSON.parse(value);}catch{throw new Error('E2EE_WORKSPACE_SOURCE_INVALID');}}
function b64(value:unknown,min:number,max=min):Uint8Array<ArrayBuffer>{
  if(typeof value!=='string'||value.length%4!==0||value.length>Math.ceil(max/3)*4||!/^[A-Za-z0-9+/]*={0,2}$/.test(value)
    ||btoa(atob(value.slice(-4)))!==value.slice(-4))throw new Error('E2EE_WORKSPACE_SOURCE_INVALID');
  const bytes=Uint8Array.from(atob(value),c=>c.charCodeAt(0));
  if(bytes.length<min||bytes.length>max)throw new Error('E2EE_WORKSPACE_SOURCE_INVALID');
  return bytes;
}
function revision(value:unknown){object(value);exactKeys(value,['version','updatedAt','deviceId']);integer(value.version,1);timestamp(value.updatedAt);
  if(typeof value.deviceId!=='string'||!value.deviceId||value.deviceId.length>100)throw new Error('E2EE_WORKSPACE_SOURCE_INVALID');}
function metadata(value:unknown):asserts value is WorkspaceSyncMetadata{
  object(value);exactKeys(value,['schemaVersion','entities','fields','tombstones']);
  if(value.schemaVersion!==1)throw new Error('E2EE_WORKSPACE_FORMAT_UNSUPPORTED');
  object(value.entities);object(value.fields);
  for(const [name,rows] of Object.entries(value.entities)){
    if(!(WORKSPACE_SYNC_COLLECTIONS as readonly string[]).includes(name))throw new Error('E2EE_WORKSPACE_FORMAT_UNSUPPORTED');
    object(rows);for(const [id,row] of Object.entries(rows)){safeId(id);revision(row);}
  }
  for(const [name,row] of Object.entries(value.fields)){
    if(!(WORKSPACE_SYNC_FIELDS as readonly string[]).includes(name))throw new Error('E2EE_WORKSPACE_FORMAT_UNSUPPORTED');revision(row);
  }
  if(!Array.isArray(value.tombstones))throw new Error('E2EE_WORKSPACE_SOURCE_INVALID');
  for(const row of value.tombstones){object(row);exactKeys(row,['collection','id','version','updatedAt','deviceId']);
    if(!(WORKSPACE_SYNC_COLLECTIONS as readonly unknown[]).includes(row.collection)||typeof row.id!=='string')throw new Error('E2EE_WORKSPACE_SOURCE_INVALID');safeId(row.id);
    revision({version:row.version,updatedAt:row.updatedAt,deviceId:row.deviceId});}
}
function safeId(id:string){if(!id||['__proto__','prototype','constructor'].includes(id))throw new Error('E2EE_WORKSPACE_SOURCE_INVALID');}
function includesOriginal(original:unknown,normalized:unknown):boolean{
  if(Array.isArray(original))return Array.isArray(normalized)&&original.length===normalized.length&&original.every((item,i)=>includesOriginal(item,normalized[i]));
  if(original&&typeof original==='object')return Boolean(normalized)&&typeof normalized==='object'&&!Array.isArray(normalized)
    &&Object.entries(original).every(([name,value])=>Object.hasOwn(normalized!,name)&&includesOriginal(value,(normalized as ObjectValue)[name]));
  return Object.is(original,normalized);
}
function immutableRecords(rows:unknown,normalize:(rows:unknown[])=>unknown[]){
  if(rows===undefined)return;
  if(!Array.isArray(rows))throw new Error('E2EE_WORKSPACE_SOURCE_INVALID');
  for(const row of rows){let normalized:unknown[];try{normalized=normalize([row]);}catch{throw new Error('E2EE_WORKSPACE_EVENT_REVIEW_REQUIRED');}
    if(normalized.length!==1||!includesOriginal(row,normalized[0]))throw new Error('E2EE_WORKSPACE_EVENT_REVIEW_REQUIRED');}
}
/** No lossy feature normalizer here: unknown future formats and invalid IDs stop
 * migration. Original bytes already exist in the encrypted local snapshot. */
function document(value:unknown,localCache=false):SyncableWorkspaceDocument{
  object(value);const output:SyncableWorkspaceDocument={};
  for(const [name,field] of Object.entries(value)){
    if(localCache&&name==='tasks')continue; // Owned by the separate personal.tasks adapter.
    if(name==='habitEntries')throw new Error('E2EE_WORKSPACE_LEGACY_TRACKER_REVIEW_REQUIRED');
    if(!(WORKSPACE_SYNC_COLLECTIONS as readonly string[]).includes(name)&&!(WORKSPACE_SYNC_FIELDS as readonly string[]).includes(name)&&name!=='syncMetadata')
      throw new Error('E2EE_WORKSPACE_FORMAT_UNSUPPORTED');
    output[name]=field;
  }
  if(output.trackerSchemaVersion!==undefined){integer(output.trackerSchemaVersion,1);if(output.trackerSchemaVersion>16)throw new Error('E2EE_WORKSPACE_FORMAT_UNSUPPORTED');
    if(output.trackerSchemaVersion<16)throw new Error('E2EE_WORKSPACE_LEGACY_TRACKER_REVIEW_REQUIRED');}
  for(const collection of WORKSPACE_SYNC_COLLECTIONS){
    if(!(collection in output))continue;
    const rows=output[collection];if(!Array.isArray(rows)||rows.length>10000)throw new Error('E2EE_WORKSPACE_SOURCE_INVALID');
    const ids=new Set<string>();for(const row of rows){object(row);const id=workspaceSyncEntityId(collection,row);
      safeId(id);if(ids.has(id))throw new Error('E2EE_WORKSPACE_SOURCE_INVALID');ids.add(id);}
  }
  if(output.syncMetadata!==undefined)metadata(output.syncMetadata);
  // Ordinary feature mergers may project/drop malformed or future event fields.
  // Migration must first prove that each original event survives that parser.
  immutableRecords(output.habitMeasurements,mergeHabitMeasurementEvents);
  immutableRecords(output.habitTimers,mergeHabitTimerOperations);
  immutableRecords(output.habitHistory,rows=>mergeHabitHistoryEdits(rows,[]));
  for(const habit of (output.habits??[]) as ObjectValue[]){
    immutableRecords(habit.ruleHistory,normalizeHabitRuleHistory);
    immutableRecords(habit.lifecycleHistory,rows=>mergeHabitLifecycleEvents(rows,[]));
  }
  return structuredClone(output);
}
type Clock={version:number;updatedAt:string;deviceId:string};
type Variant={document:SyncableWorkspaceDocument;clock:Clock;base:SyncableWorkspaceDocument|null};

export class PersonalWorkspaceSource implements PrivatePathAdapter{
  readonly id='personal.workspace';#owner:string;#scope:string;#ports:WorkspaceSourcePorts;
  constructor(ownerId:string,scopeId:string,ports:WorkspaceSourcePorts){assertTechnical(ownerId);assertTechnical(scopeId);this.#owner=ownerId;this.#scope=scopeId;this.#ports=ports;}
  #keys(){return[`genesis-calendar-v2:${this.#owner}`,`genesis-workspace-device-key-v2:${this.#owner}`,`genesis-workspace-device-id-v1:${this.#owner}`,
    `genesis-workspace-sync-state-v1:${this.#owner}`,`genesis-pending-mutations-v2:${this.#owner}`,'genesis-calendar-v1','genesis-pending-mutations-v2'];}
  async captureLocal():Promise<Uint8Array>{
    this.#ports.assertCurrent();const storage=this.#ports.storage,keys=this.#keys(),prefix=`genesis-pending-mutations-v2:${this.#owner}:workspace:`;
    for(let i=0;i<storage.length;i++){const key=storage.key(i);if(key?.startsWith(prefix))keys.push(key);}
    const entries=[...new Set(keys)].sort().map(key=>({key,value:storage.getItem(key)}));
    const snapshot:Snapshot={protocol:1,ownerId:this.#owner,scopeId:this.#scope,capturedAt:new Date().toISOString(),entries,memory:this.#ports.memory()};
    if(snapshot.memory.ownerId!==this.#owner)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
    const bytes=encoder.encode(json(snapshot));this.#ports.assertCurrent();
    if(bytes.length>MAX_BYTES){bytes.fill(0);throw new Error('E2EE_SNAPSHOT_TOO_LARGE');}return bytes;
  }
  #decode(bytes:Uint8Array):Snapshot{
    if(bytes.length<1||bytes.length>MAX_BYTES)throw new Error('E2EE_WORKSPACE_SOURCE_INVALID');
    const value=parse(decoder.decode(bytes));exactKeys(value,['protocol','ownerId','scopeId','capturedAt','entries','memory']);timestamp(value.capturedAt);
    if(value.protocol!==1||value.ownerId!==this.#owner||value.scopeId!==this.#scope||!Array.isArray(value.entries)||value.entries.length>10007)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
    const keys=this.#keys(),seen=new Set<string>();for(const entry of value.entries){exactKeys(entry,['key','value']);
      if(typeof entry.key!=='string'||seen.has(entry.key)||!keys.includes(entry.key)&&!entry.key.startsWith(`genesis-pending-mutations-v2:${this.#owner}:workspace:`)
        ||entry.value!==null&&typeof entry.value!=='string')throw new Error('E2EE_WORKSPACE_SOURCE_INVALID');seen.add(entry.key);}
    if(keys.some(key=>!seen.has(key)))throw new Error('E2EE_WORKSPACE_SOURCE_INVALID');
    exactKeys(value.memory,['ownerId','key','version','deviceId','base','baseMetadata','metadata','current','draftSource']);
    if(value.memory.ownerId!==this.#owner||typeof value.memory.key!=='string'||typeof value.memory.deviceId!=='string'
      ||value.memory.draftSource!==null&&typeof value.memory.draftSource!=='string')throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
    integer(value.memory.version);return value as unknown as Snapshot;
  }
  async #merge(left:Variant,right:Variant,stage:string):Promise<Variant>{
    const input={left:left.document,right:right.document,leftFallback:left.clock,rightFallback:right.clock,base:left.base,reviewConflicts:true};
    let merged=mergeWorkspaceDocuments(input);
    if(merged.conflicts.length){
      if(!this.#ports.review)throw new Error('E2EE_WORKSPACE_CONFLICT_REVIEW_REQUIRED');
      const choices=await this.#ports.review(structuredClone(merged.conflicts),stage);this.#ports.assertCurrent();
      object(choices);const names=merged.conflicts.map(row=>row.key);
      if(Object.keys(choices).length!==names.length||names.some(name=>!Object.hasOwn(choices,name)||!['local','remote'].includes(choices[name])))throw new Error('E2EE_WORKSPACE_CONFLICT_REVIEW_REQUIRED');
      merged=mergeWorkspaceDocuments({...input,choices});if(merged.conflicts.length)throw new Error('E2EE_WORKSPACE_CONFLICT_REVIEW_REQUIRED');
    }
    return{document:document(merged.document),clock:left.clock,base:right.document};
  }
  async reconcile(local:Uint8Array,previous:readonly Uint8Array[],context?:MigrationSourceContext):Promise<{complete:boolean;content:MigrationContent[]}>{
    this.#ports.assertCurrent();if(!context||context.ownerId!==this.#owner||context.scopeId!==this.#scope)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
    const snapshot=this.#decode(local),values=new Map(snapshot.entries.map(row=>[row.key,row.value]));
    // Changed attempts require a dedicated history decision. Never union old
    // unsent records into the latest state and thereby resurrect deleted rows.
    for(const bytes of previous){const old=this.#decode(bytes);
      if(json(old.entries)!==json(snapshot.entries)||json(old.memory)!==json(snapshot.memory))throw new Error('E2EE_WORKSPACE_HISTORY_REVIEW_REQUIRED');}
    for(const key of ['genesis-calendar-v1','genesis-pending-mutations-v2'])if(values.get(key)!==null)throw new Error('E2EE_WORKSPACE_ATTRIBUTION_REQUIRED');
    const remote=await this.#ports.legacyWorkspace(context);this.#ports.assertCurrent();
    exactKeys(remote,['protocol','ownerId','scopeId','migrationId','fence','sourceHash','legacyGeneration','checkpointHash','directoryRevision','workspace','projects','categories']);
    if(remote.protocol!==1||remote.ownerId!==this.#owner||remote.scopeId!==this.#scope||remote.migrationId!==context.migrationId
      ||remote.fence!==context.fence||remote.sourceHash!==context.sourceHash)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
    integer(remote.legacyGeneration);integer(remote.directoryRevision,1);decodeE2eeBytes(remote.checkpointHash,32);
    exactKeys(remote.workspace,['keyMode','key','envelope']);
    if(!['account','client','empty'].includes(String(remote.workspace.keyMode))||remote.workspace.key!==null&&typeof remote.workspace.key!=='string')throw new Error('E2EE_WORKSPACE_SOURCE_INVALID');
    const rawKeys:string[]=[];if(snapshot.memory.key)rawKeys.push(snapshot.memory.key);
    const deviceRaw=values.get(`genesis-workspace-device-key-v2:${this.#owner}`);
    if(deviceRaw){const device=parse(deviceRaw);object(device);if(typeof device.key!=='string')throw new Error('E2EE_WORKSPACE_SOURCE_INVALID');rawKeys.push(device.key);}
    const keys:CryptoKey[]=[];
    try{
      if(remote.workspace.keyMode==='account'){if(!remote.workspace.key)throw new Error('E2EE_LEGACY_KEY_UNAVAILABLE');rawKeys.push(remote.workspace.key as string);}
      else if(remote.workspace.key!==null)throw new Error('E2EE_WORKSPACE_SOURCE_INVALID');
      if(remote.workspace.keyMode==='empty'&&remote.workspace.envelope!==null)throw new Error('E2EE_LEGACY_KEY_UNAVAILABLE');
      for(const raw of new Set(rawKeys)){const bytes=b64(raw,32);try{keys.push(await crypto.subtle.importKey('raw',bytes,'AES-GCM',false,['decrypt']));}finally{bytes.fill(0);}}
      const clock:Clock={version:Math.max(1,snapshot.memory.version),updatedAt:snapshot.capturedAt,deviceId:snapshot.memory.deviceId||'legacy-local'};
      const open=async(envelope:unknown):Promise<Variant>=>{
        object(envelope);integer(envelope.version);if(envelope.minimumWriterProtocol!==undefined){integer(envelope.minimumWriterProtocol,1);if(envelope.minimumWriterProtocol>9)throw new Error('E2EE_WORKSPACE_FORMAT_UNSUPPORTED');}
        const nonce=b64(envelope.iv,12),cipher=b64(envelope.ciphertext,16,12*1024*1024);let opened:Uint8Array|undefined;
        for(const key of keys){try{opened=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:nonce},key,cipher));break;}catch{/* Try other captured legacy epochs, never a newly generated key. */}}
        if(!opened)throw new Error(keys.length?'E2EE_LEGACY_WORKSPACE_CORRUPT':'E2EE_LEGACY_KEY_UNAVAILABLE');
        try{if(envelope.updatedAt!==undefined)timestamp(envelope.updatedAt);
          return{document:document(parse(decoder.decode(opened))),clock:{version:Math.max(1,envelope.version),updatedAt:typeof envelope.updatedAt==='string'?envelope.updatedAt:snapshot.capturedAt,deviceId:'legacy-remote'},base:null};}
        finally{opened.fill(0);this.#ports.assertCurrent();}
      };
      const relational=this.#relational(remote.projects,remote.categories);
      let combined:Variant=remote.workspace.envelope===null?{document:relational.document,clock:{...clock,version:1,deviceId:'legacy-relational'},base:null}:await open(remote.workspace.envelope);
      let base:SyncableWorkspaceDocument|null=null,localMetadata:WorkspaceSyncMetadata|undefined,baseMetadata:WorkspaceSyncMetadata|undefined;
      const cacheRaw=values.get(`genesis-workspace-sync-state-v1:${this.#owner}`);
      if(cacheRaw){const cache=parse(cacheRaw);exactKeys(cache,['version','base','baseMetadata','metadata']);integer(cache.version);
        if(cache.base!==null)base=document(cache.base);if(cache.metadata!==null){metadata(cache.metadata);localMetadata=cache.metadata;}
        if(cache.baseMetadata!==null){metadata(cache.baseMetadata);baseMetadata=cache.baseMetadata;}}
      if(snapshot.memory.base!==null){const memoryBase=document(snapshot.memory.base);
        if(base&&json(base)!==json(memoryBase))throw new Error('E2EE_WORKSPACE_LOCAL_BASE_REVIEW_REQUIRED');base=memoryBase;}
      if(snapshot.memory.metadata!==null){metadata(snapshot.memory.metadata);
        if(localMetadata&&json(localMetadata)!==json(snapshot.memory.metadata))throw new Error('E2EE_WORKSPACE_LOCAL_BASE_REVIEW_REQUIRED');localMetadata=snapshot.memory.metadata;}
      if(snapshot.memory.baseMetadata!==null){metadata(snapshot.memory.baseMetadata);
        if(baseMetadata&&json(baseMetadata)!==json(snapshot.memory.baseMetadata))throw new Error('E2EE_WORKSPACE_LOCAL_BASE_REVIEW_REQUIRED');baseMetadata=snapshot.memory.baseMetadata;}
      const currentRaw=values.get(`genesis-calendar-v2:${this.#owner}`),localVariants:unknown[]=[];
      if(currentRaw!==null)localVariants.push(parse(currentRaw!));
      if(snapshot.memory.current!==null){
        if(localVariants.length&&json(document(localVariants[0],true))!==json(document(snapshot.memory.current,true)))throw new Error('E2EE_WORKSPACE_LOCAL_BASE_REVIEW_REQUIRED');
        if(!localVariants.length)localVariants.push(snapshot.memory.current);
      }
      for(const [index,current] of localVariants.entries()){
        const value=document(current,true),prepared=prepareWorkspaceForSync({current:value,base,metadata:localMetadata??value.syncMetadata,baseMetadata:baseMetadata??base?.syncMetadata,clock});
        combined=await this.#merge({document:prepared.document,clock,base},combined,`local:${index}`);
      }
      const queue:unknown[]=[];const queueRaw=values.get(`genesis-pending-mutations-v2:${this.#owner}`);
      if(queueRaw!==null){const rows=parse(queueRaw!);if(!Array.isArray(rows)||rows.length>10000)throw new Error('E2EE_WORKSPACE_SOURCE_INVALID');queue.push(...rows);}
      for(const row of snapshot.entries)if(row.key.startsWith(`genesis-pending-mutations-v2:${this.#owner}:workspace:`)&&row.value!==null){
        const item=parse(row.value);object(item);if(row.key!==`genesis-pending-mutations-v2:${this.#owner}:workspace:${item.key}`)throw new Error('E2EE_WORKSPACE_SOURCE_INVALID');queue.push(item);}
      if(snapshot.memory.draftSource&&!queue.some(row=>{object(row);return row.body===snapshot.memory.draftSource;}))throw new Error('E2EE_WORKSPACE_DRAFT_SOURCE_MISSING');
      const identities=new Map<string,string>();
      for(const row of queue){object(row);if(typeof row.key!=='string')throw new Error('E2EE_WORKSPACE_SOURCE_INVALID');
        const previous=identities.get(row.key);if(previous!==undefined&&previous!==json(row))throw new Error('E2EE_WORKSPACE_QUEUE_REVIEW_REQUIRED');identities.set(row.key,json(row));}
      for(const [index,row] of queue.entries()){
        object(row);if(typeof row.key!=='string'||typeof row.path!=='string'||!['PUT','POST','DELETE'].includes(String(row.method)))throw new Error('E2EE_WORKSPACE_SOURCE_INVALID');
        if(row.key!=='workspace'&&!row.key.startsWith('workspace:')){if(row.path==='/workspace')throw new Error('E2EE_WORKSPACE_SOURCE_INVALID');continue;}
        if(row.path!=='/workspace'||row.method!=='PUT'||typeof row.body!=='string')throw new Error('E2EE_WORKSPACE_SOURCE_INVALID');
        const variant=await open(parse(row.body));variant.base=row.workspaceBase===undefined?null:(await open(row.workspaceBase)).document;
        if(!variant.base&&!variant.document.syncMetadata&&json(variant.document)!==json(combined.document))throw new Error('E2EE_WORKSPACE_BASE_REQUIRED');
        combined=await this.#merge(variant,combined,`queue:${index}`);
      }
      this.#ports.assertCurrent();const content:MigrationContent[]=[{domain:'workspace',objectId:'personal-workspace-v1',bytes:encoder.encode(json(combined.document))},
        {domain:'workspace',objectId:'personal-workspace-legacy-relational-v1',bytes:encoder.encode(json({protocol:1,projects:remote.projects,categories:remote.categories}))}];
      return{complete:true,content};
    }finally{rawKeys.fill('');keys.length=0;}
  }
  #relational(projects:unknown,categories:unknown){
    if(!Array.isArray(projects)||!Array.isArray(categories)||projects.length+categories.length>10000)throw new Error('E2EE_WORKSPACE_SOURCE_INVALID');
    const rows={projects:projects.map(row=>{object(row);exactKeys(row,['id','parent_id','category_id','title','description','tags_json','status','position','created_at','updated_at']);
      if(typeof row.id!=='string'||!row.id||typeof row.title!=='string'||typeof row.description!=='string'||typeof row.tags_json!=='string')throw new Error('E2EE_WORKSPACE_SOURCE_INVALID');
      const tags=parse(row.tags_json);if(!Array.isArray(tags)||tags.some(tag=>typeof tag!=='string'))throw new Error('E2EE_WORKSPACE_SOURCE_INVALID');
      return{id:row.id,parentId:row.parent_id,categoryId:row.category_id,title:row.title,description:row.description,tags,status:row.status,position:row.position,createdAt:row.created_at,updatedAt:row.updated_at};}),
    categories:categories.map(row=>{object(row);exactKeys(row,['id','name','color','position','created_at','updated_at']);
      if(typeof row.id!=='string'||!row.id||typeof row.name!=='string')throw new Error('E2EE_WORKSPACE_SOURCE_INVALID');
      return{id:row.id,name:row.name,color:row.color,position:row.position,createdAt:row.created_at,updatedAt:row.updated_at};})};
    const projectIds=new Set(rows.projects.map(row=>row.id)),categoryIds=new Set(rows.categories.map(row=>row.id));
    for(const row of rows.projects)if(row.parentId!==null&&!projectIds.has(String(row.parentId))||row.categoryId!==null&&!categoryIds.has(String(row.categoryId)))throw new Error('E2EE_WORKSPACE_RELATIONAL_REVIEW_REQUIRED');
    return{document:document(rows)};
  }
}
