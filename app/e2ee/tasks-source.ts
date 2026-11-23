import {assertTechnical,exactKeys} from './keys.ts';
import {backupJson} from '../backup-format.ts';
import {canonicalJson} from '../aurora/forecast.ts';
import {isCivilDate} from '../calendar-context.ts';
import {E2EE_MIGRATION_BYTE_BUDGET,type MigrationContent,type MigrationSourceContext} from './migration.ts';
import {decodeE2eeBytes} from './envelope.ts';
import type {PrivatePathAdapter} from './migration-sources.ts';
import {reconcileProviderCaches,type ProviderCacheReview} from './provider-cache-source.ts';

type Row=Record<string,unknown>;
export type TaskMigrationEditor={id:string;base:unknown|null;current:unknown|null};
export type TasksMigrationMemory={ownerId:string;legacyKey:string;generation:number;reconciliationRequired:boolean;tasks:unknown[];editors:TaskMigrationEditor[]};
export type TaskMigrationVariant={source:string;deleted:boolean;value:Row|null};
export type TaskMigrationConflict={id:string;variants:readonly TaskMigrationVariant[]};
export type TasksSourcePorts={storage:Pick<Storage,'getItem'|'key'|'length'>;memory:()=>TasksMigrationMemory;assertCurrent:()=>void;
 legacyTasks:(context:MigrationSourceContext)=>Promise<unknown>;
 /** Native opens captured legacy envelopes without exporting keys into JS. */
 openLegacy?:(envelope:{iv:string;ciphertext:string},purpose:string)=>Promise<unknown>;
 review?:(conflicts:readonly TaskMigrationConflict[])=>Promise<Record<string,string>>;
 reviewProviderHistory?:ProviderCacheReview};
type Snapshot={protocol:1;ownerId:string;scopeId:string;capturedAt:string;entries:{key:string;value:string|null}[];memory:TasksMigrationMemory};
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true}),MAX=64*1024*1024;
const PENDING='genesis-pending-mutations-v2',RECORD=/^personal-task-record:[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
function invalid():never{throw new Error('E2EE_TASK_SOURCE_INVALID');}
function object(value:unknown):asserts value is Row{if(!value||typeof value!=='object'||Array.isArray(value))invalid();}
function allowed(value:unknown,keys:readonly string[]):asserts value is Row{object(value);if(Object.keys(value).some(key=>!keys.includes(key)))throw new Error('E2EE_TASK_FORMAT_UNSUPPORTED');}
function integer(value:unknown,min=0,max=Number.MAX_SAFE_INTEGER-1):asserts value is number{if(!Number.isSafeInteger(value)||(value as number)<min||(value as number)>max)invalid();}
function text(value:unknown,max=100000):asserts value is string{if(typeof value!=='string'||value.length>max)invalid();}
function identity(value:unknown):asserts value is string{text(value,512);if(!value||['__proto__','prototype','constructor'].includes(value)||[...value].some(char=>char.charCodeAt(0)<32||char.charCodeAt(0)===127))invalid();}
function date(value:unknown,empty=true){if(value===null)return;if(typeof value!=='string'||!(empty&&value===''||isCivilDate(value)))invalid();}
function time(value:unknown):asserts value is string{text(value,64);if(!Number.isFinite(Date.parse(value)))invalid();}
/** JSON.parse validates grammar; this bounded lexical preflight additionally
 * refuses duplicate decoded object names, including escaped spellings. A
 * malformed legacy record must never lose one of its original field values. */
function parse(value:unknown):unknown{
 text(value,MAX);try{
  const result=backupJson(value,MAX),stack:(Set<string>|null)[]=[];
  for(let index=0;index<value.length;index++){
   const char=value[index];if(char==='{'||char==='['){stack.push(char==='{'?new Set():null);if(stack.length>41)invalid();}
   else if(char==='}'||char===']')stack.pop();
   else if(char==='"'){
    const start=index;index++;
    while(index<value.length&&value[index]!=='"'){if(value[index]==='\\')index++;index++;}
    let next=index+1;while(next<value.length&&/\s/u.test(value[next]))next++;
    if(value[next]===':'){
     const names=stack.at(-1);if(!names)invalid();const name=JSON.parse(value.slice(start,index+1)) as string;
     if(names.has(name))invalid();names.add(name);
    }
   }
  }return result;
 }catch{return invalid();}
}
function list(value:unknown,max=10000):asserts value is unknown[]{if(!Array.isArray(value)||value.length>max)invalid();}
function strings(value:unknown,max=10000){list(value,max);for(const row of value)text(row);}
function bytes64(value:unknown,min:number,max=min){text(value,Math.ceil(max/3)*4);if(value.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(value)||btoa(atob(value.slice(-4)))!==value.slice(-4))invalid();
 const bytes=Uint8Array.from(atob(value),c=>c.charCodeAt(0));if(bytes.length<min||bytes.length>max){bytes.fill(0);invalid();}return bytes;}

const fields=['id','title','description','sacredYear','monthIndex','day','dueDate','endDate','time','endTime','entryType','project','projectId','categoryId','tags','dependsOnIds','priority','done','completedAt',
 'reminders','reminderMinutes','reminderAt','zoneId','recurrence','recurrenceInterval','recurrenceMode','recurrencePattern','recurrenceDays','recurrenceStartDate','recurrenceEndDate','recurrenceMonths','recurrencePyatas',
 'recurrenceContext','recurrenceInvalidDayPolicy','recurrenceExcludedDates','recurrenceSeriesId','recurrenceOriginalDate','calendarMode','calendarNote','syncToGoogle','syncAccountIds','googleLinks','googleAccountId',
 'googleAccountEmail','googleEventId','googleTaskId','googleTaskListId','googleTaskListTitle','googleCalendarId','googleReadOnly','createdIn','createdAt','createdByName','comments','updatedAt','restoredFrom','restoredRevision',
 'yandexEntryType','yandexEndTime','yandexLocation','yandexTelemostUrl','yandexAttendees','yandexOptionalAttendees','yandexBusy','yandexVisibility','yandexReminders','mindmapCreateOnly','mindmapCreationPayload','createOnly','recurrenceDates'];
/** Lossless validation, never the ordinary task normalizer (which trims, sorts,
 * supplies time-dependent values and drops unsupported reminder fields). */
export function validateMigrationTask(value:unknown):Row&{id:string;title:string}{
 allowed(value,fields);identity(value.id);text(value.title);
 for(const name of ['description','project','calendarNote','googleAccountEmail','googleTaskListTitle','createdByName','yandexLocation','yandexTelemostUrl'])if(value[name]!==undefined)text(value[name]);
 for(const name of ['projectId','categoryId','googleAccountId','googleEventId','googleTaskId','googleTaskListId','googleCalendarId','recurrenceSeriesId'])if(value[name]!==undefined&&value[name]!==null)identity(value[name]);
 for(const name of ['dueDate','endDate','recurrenceStartDate','recurrenceEndDate','recurrenceOriginalDate'])if(value[name]!==undefined)date(value[name]);
 for(const name of ['time','endTime','yandexEndTime'])if(value[name]!==undefined){text(value[name],5);if(value[name]!==''&&!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value[name] as string))invalid();}
 for(const name of ['done','syncToGoogle','googleReadOnly','yandexBusy','mindmapCreateOnly','createOnly'])if(value[name]!==undefined&&typeof value[name]!=='boolean')invalid();
 for(const name of ['sacredYear','monthIndex','day','updatedAt','restoredRevision'])if(value[name]!==undefined)integer(value[name]);
 if(value.priority!==undefined)integer(value.priority,1,10);if(value.recurrenceInterval!==undefined)integer(value.recurrenceInterval,1,9999);
 if(value.reminderMinutes!==undefined&&value.reminderMinutes!==null)integer(value.reminderMinutes);
 if(value.reminderAt!==undefined&&value.reminderAt!==null)integer(value.reminderAt,Number.MIN_SAFE_INTEGER+1);
 for(const name of ['createdAt','completedAt'])if(value[name]!==undefined&&value[name]!==null)time(value[name]);
 for(const name of ['tags','dependsOnIds','syncAccountIds','yandexAttendees','yandexOptionalAttendees'])if(value[name]!==undefined)strings(value[name]);
 for(const [name,min,max]of [['recurrenceDays',1,30],['recurrenceMonths',1,72],['recurrencePyatas',1,6],['yandexReminders',0,40320]]as const)if(value[name]!==undefined){list(value[name]);for(const n of value[name])integer(n,min,max);}
 for(const name of ['recurrenceExcludedDates','recurrenceDates'])if(value[name]!==undefined){list(value[name]);for(const day of value[name])date(day,false);}
 const choices:Record<string,readonly string[]>={entryType:['task','meeting','birthday','event'],createdIn:['genesis','google-calendar','google-tasks','yandex-calendar','yandex-tasks'],
  recurrence:['none','daily','weekly','monthly','yearly'],recurrenceMode:['none','genesis','classic','lunar'],recurrencePattern:['none','daily','weekdays','monthly','yearly','pyata-days','month-days','lunar-days','lunar-decades','lunar-decade-days','lunar-phases','lunar-yearly'],
  recurrenceInvalidDayPolicy:['skip'],calendarMode:['profane','sacred','lunar'],yandexEntryType:['task','meeting'],yandexVisibility:['private','public']};
 for(const [name,options]of Object.entries(choices))if(value[name]!==undefined&&!options.includes(value[name] as string))throw new Error('E2EE_TASK_FORMAT_UNSUPPORTED');
 if(value.zoneId!==undefined){text(value.zoneId,128);try{new Intl.DateTimeFormat('en',{timeZone:value.zoneId});}catch{invalid();}}
 if(value.reminders!==undefined){list(value.reminders);for(const row of value.reminders){object(row);if(row.kind==='relative'){exactKeys(row,['kind','minutes']);integer(row.minutes,0,40320);}else if(row.kind==='absolute'){exactKeys(row,['kind','at']);if(typeof row.at==='number')integer(row.at,Number.MIN_SAFE_INTEGER+1);else time(row.at);}else invalid();}}
 if(value.recurrenceContext!==undefined){exactKeys(value.recurrenceContext,['version','timeZone','gregorianYearStart']);const context=value.recurrenceContext;
  if(![1,2].includes(context.version as number)||!['january','march'].includes(context.gregorianYearStart as string))throw new Error('E2EE_TASK_FORMAT_UNSUPPORTED');
  text(context.timeZone,128);try{new Intl.DateTimeFormat('en',{timeZone:context.timeZone});}catch{invalid();}}
 if(value.googleLinks!==undefined){object(value.googleLinks);for(const link of Object.values(value.googleLinks)){allowed(link,['eventId','taskId','taskListId','taskListTitle']);for(const item of Object.values(link))if(item!==null)text(item);}}
 if(value.restoredFrom!==undefined){exactKeys(value.restoredFrom,['sourceId','accountId','taskListId','taskId','backupId']);for(const item of Object.values(value.restoredFrom))if(item!==null)identity(item);}
 if(value.comments!==undefined){list(value.comments);for(const row of value.comments)object(row);}
 if(value.mindmapCreationPayload!==undefined){const child=value.mindmapCreationPayload;object(child);if(child.mindmapCreationPayload!==undefined)invalid();validateMigrationTask(child);if(child.id!==value.id)invalid();}
 return structuredClone(value) as Row&{id:string;title:string};
}

function compatible(a:Row,b:Row):Row|null{
 const result={...a};for(const [key,value]of Object.entries(b)){
  if(Object.hasOwn(result,key)&&canonicalJson(result[key])!==canonicalJson(value)){
   if(key==='updatedAt'){integer(result[key]);integer(value);result[key]=Math.max(result[key],value);continue;}return null;
  }result[key]=value;
 }return result;
}
function threeWay(base:unknown,local:unknown,remote:unknown):unknown{
 const same=(a:unknown,b:unknown)=>a===undefined||b===undefined?a===b:canonicalJson(a)===canonicalJson(b);
 if(same(local,base)||same(local,remote))return remote;
 if(same(remote,base))return local;
 if(base&&local&&remote&&typeof base==='object'&&typeof local==='object'&&typeof remote==='object'&&!Array.isArray(base)&&!Array.isArray(local)&&!Array.isArray(remote)){
  const output:Row={};for(const key of new Set([...Object.keys(base),...Object.keys(local),...Object.keys(remote)])){
   const merged=threeWay((base as Row)[key],(local as Row)[key],(remote as Row)[key]);if(merged!==undefined)output[key]=merged;
  }return output;
 }throw new Error('E2EE_TASK_CONFLICT_REVIEW_REQUIRED');
}

export class PersonalTasksSource implements PrivatePathAdapter{
 readonly id='personal.tasks';#owner:string;#scope:string;#ports:TasksSourcePorts;
 constructor(ownerId:string,scopeId:string,ports:TasksSourcePorts){assertTechnical(ownerId);assertTechnical(scopeId);this.#owner=ownerId;this.#scope=scopeId;this.#ports=ports;}
 #keys(){return[`genesis-calendar-v2:${this.#owner}`,`${PENDING}:${this.#owner}`,`${PENDING}-deleted:${this.#owner}`,`genesis-workspace-device-key-v2:${this.#owner}`,`genesis-data-generation-v1:${this.#owner}`,'genesis-calendar-v1',PENDING];}
 async captureLocal():Promise<Uint8Array>{
  this.#ports.assertCurrent();const snapshot:Snapshot={protocol:1,ownerId:this.#owner,scopeId:this.#scope,capturedAt:new Date().toISOString(),entries:this.#keys().map(key=>({key,value:this.#ports.storage.getItem(key)})),memory:this.#ports.memory()};
  if(snapshot.memory.ownerId!==this.#owner)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');const bytes=encoder.encode(JSON.stringify(snapshot));this.#ports.assertCurrent();if(bytes.length>MAX){bytes.fill(0);throw new Error('E2EE_SNAPSHOT_TOO_LARGE');}return bytes;
 }
 #decode(bytes:Uint8Array):Snapshot{
  if(bytes.length<1||bytes.length>MAX)invalid();const value=parse(decoder.decode(bytes));exactKeys(value,['protocol','ownerId','scopeId','capturedAt','entries','memory']);
  if(value.protocol!==1||value.ownerId!==this.#owner||value.scopeId!==this.#scope)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');time(value.capturedAt);list(value.entries);
  const keys=this.#keys(),seen=new Set<string>();for(const row of value.entries){exactKeys(row,['key','value']);if(typeof row.key!=='string'||!keys.includes(row.key)||seen.has(row.key)||row.value!==null&&typeof row.value!=='string')invalid();seen.add(row.key);
   if((row.key==='genesis-calendar-v1'||row.key===PENDING)&&row.value!==null)throw new Error('E2EE_TASK_ATTRIBUTION_REQUIRED');}
  if(seen.size!==keys.length)invalid();exactKeys(value.memory,['ownerId','legacyKey','generation','reconciliationRequired','tasks','editors']);const memory=value.memory;
  if(memory.ownerId!==this.#owner)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');text(memory.legacyKey,44);integer(memory.generation);
  if(typeof memory.reconciliationRequired!=='boolean')invalid();if(memory.reconciliationRequired)throw new Error('E2EE_TASK_GENERATION_REVIEW_REQUIRED');
  const capturedEntries=value.entries as Snapshot['entries'];const marker=capturedEntries.find(row=>row.key===`genesis-data-generation-v1:${this.#owner}`)?.value;if(marker!==null&&marker!==String(memory.generation))throw new Error('E2EE_TASK_GENERATION_REVIEW_REQUIRED');
  list(memory.tasks);for(const row of memory.tasks)validateMigrationTask(row);list(memory.editors);
  const editors=new Set<string>();for(const row of memory.editors){exactKeys(row,['id','base','current']);identity(row.id);if(editors.has(row.id))invalid();editors.add(row.id);
   for(const item of [row.base,row.current])if(item!==null&&validateMigrationTask(item).id!==row.id)invalid();}
  return value as Snapshot;
 }
 async reconcile(local:Uint8Array,previous:readonly Uint8Array[],context?:MigrationSourceContext){
  this.#ports.assertCurrent();if(!context||context.ownerId!==this.#owner||context.scopeId!==this.#scope)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
  const snapshot=this.#decode(local);if(previous.length>32)throw new Error('E2EE_MIGRATION_HISTORY_LIMIT');
  const stable=(value:Snapshot)=>({...value,capturedAt:''});for(const raw of previous)if(canonicalJson(stable(this.#decode(raw)))!==canonicalJson(stable(snapshot)))throw new Error('E2EE_TASK_HISTORY_REVIEW_REQUIRED');
  const entries=new Map(snapshot.entries.map(row=>[row.key,row.value])),variants=new Map<string,TaskMigrationVariant[]>(),dirty=new Set<string>(),localDeleted=new Set<string>();
  const add=(source:string,value:unknown,deleted=false,idValue?:unknown)=>{const task=value===null?null:validateMigrationTask(value),id=idValue??task?.id;identity(id);if(task&&task.id!==id)invalid();
   const rows=variants.get(id)??[];if(rows.some(row=>row.source===source))invalid();rows.push({source,value:task,deleted});variants.set(id,rows);if(variants.size>9998)throw new Error('E2EE_SOURCE_TOO_LARGE');};
  const cached=entries.get(`genesis-calendar-v2:${this.#owner}`);if(cached!==null){const cache=parse(cached);object(cache);if(cache.tasks!==undefined){list(cache.tasks);for(const row of cache.tasks)add('cache',row);}}
  for(const row of snapshot.memory.tasks)add('memory',row);
  const deleted=entries.get(`${PENDING}-deleted:${this.#owner}`);if(deleted!==null){const ids=parse(deleted);list(ids);for(const id of ids){identity(id);if(localDeleted.has(id))invalid();localDeleted.add(id);add('local-deletion',null,true,id);}}
  const pending=entries.get(`${PENDING}:${this.#owner}`);if(pending!==null){const rows=parse(pending);list(rows);const keys=new Set<string>();for(const row of rows){
   allowed(row,['key','path','method','body','workspaceBase','queuedAt']);identity(row.key);text(row.path);if(!['PUT','DELETE','POST'].includes(String(row.method)))invalid();if(row.queuedAt!==undefined)integer(row.queuedAt);
   if(keys.has(row.key))invalid();keys.add(row.key);if(!row.key.startsWith('task:'))continue;
   const id=row.key.slice(5);identity(id);if(row.path!==`/tasks/${encodeURIComponent(id)}`||!['PUT','DELETE'].includes(String(row.method)))invalid();
   if(row.method==='PUT'){const task=validateMigrationTask(parse(row.body));if(task.id!==id)invalid();add('queued',task);dirty.add(id);}else{if(row.body!==undefined)object(parse(row.body));if(!localDeleted.has(id)){localDeleted.add(id);add('local-deletion',null,true,id);}}
  }}
  // All local parsing and attribution checks precede the first private read.
  const remote=await this.#ports.legacyTasks(context);this.#ports.assertCurrent();exactKeys(remote,['protocol','ownerId','scopeId','migrationId','fence','sourceHash','legacyGeneration','checkpointHash','directoryRevision','tasks','deletions','links','recovered','recoveredDeletions','creations','creationTargets','legacyKey','providerCaches']);
  if(remote.protocol!==1||remote.ownerId!==this.#owner||remote.scopeId!==this.#scope||remote.migrationId!==context.migrationId||remote.fence!==context.fence||remote.sourceHash!==context.sourceHash)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
  integer(remote.legacyGeneration);integer(remote.directoryRevision,1);decodeE2eeBytes(remote.checkpointHash,32);if(remote.legacyGeneration!==snapshot.memory.generation||context.generation<=remote.legacyGeneration)throw new Error('E2EE_TASK_GENERATION_REVIEW_REQUIRED');
  let count=0;for(const family of ['tasks','deletions','links','recovered','recoveredDeletions','creations','creationTargets']){list(remote[family]);count+=(remote[family] as unknown[]).length;}if(count>10000||encoder.encode(JSON.stringify(remote)).length>MAX)throw new Error('E2EE_SOURCE_TOO_LARGE');
  const providers=await reconcileProviderCaches(remote.providerCaches,this.#owner,{validateTask:validateMigrationTask,assertCurrent:this.#ports.assertCurrent,reviewHistorical:this.#ports.reviewProviderHistory});
  if(count+providers.tasks.length>10000)throw new Error('E2EE_SOURCE_TOO_LARGE');for(const row of providers.tasks)add(row.source,row.value);
  const links=new Map<string,string[]>(),linkNames=new Set<string>();for(const row of remote.links as unknown[]){exactKeys(row,['task_id','depends_on_task_id','created_at']);identity(row.task_id);identity(row.depends_on_task_id);time(row.created_at);const name=row.task_id+'\0'+row.depends_on_task_id;if(linkNames.has(name))invalid();linkNames.add(name);links.set(row.task_id,[...(links.get(row.task_id)??[]),row.depends_on_task_id]);}
  for(const row of remote.tasks as unknown[]){exactKeys(row,['id','project_id','category_id','sacred_year','month_index','sacred_day','due_date','title','description','time_value','project_label','tags_json','done','completed_at','reminder_minutes','recurrence','recurrence_interval','sync_to_google','google_event_id','created_at','updated_at']);
   integer(row.done,0,1);integer(row.sync_to_google,0,1);time(row.updated_at);time(row.created_at);const tags=parse(row.tags_json);strings(tags);
   add('server-sql',{id:row.id,projectId:row.project_id,categoryId:row.category_id,sacredYear:row.sacred_year,monthIndex:row.month_index,day:row.sacred_day,dueDate:row.due_date,title:row.title,description:row.description,time:row.time_value,
    project:row.project_label,tags,done:row.done===1,completedAt:row.completed_at,reminderMinutes:row.reminder_minutes,recurrence:row.recurrence,recurrenceInterval:row.recurrence_interval,syncToGoogle:row.sync_to_google===1,
    googleEventId:row.google_event_id,createdAt:row.created_at,updatedAt:Date.parse(row.updated_at),...(links.has(row.id as string)?{dependsOnIds:links.get(row.id as string)}:{})});}
  for(const row of remote.deletions as unknown[]){exactKeys(row,['task_id','deleted_at']);time(row.deleted_at);add('server-deletion',null,true,row.task_id);}
  for(const row of remote.recoveredDeletions as unknown[]){exactKeys(row,['id','revision','updated_at']);integer(row.revision,1);time(row.updated_at);add('recovered-deletion',null,true,row.id);}
  const keys:CryptoKey[]=[],content:MigrationContent[]=[];let completed=false,size=0;
  try{
   exactKeys(remote.legacyKey,['keyMode','key']);if(!['empty','account','client'].includes(String(remote.legacyKey.keyMode))||remote.legacyKey.keyMode!=='account'&&remote.legacyKey.key!==null)invalid();
   const rawKeys:string[]=[];if(snapshot.memory.legacyKey)rawKeys.push(snapshot.memory.legacyKey);const device=entries.get(`genesis-workspace-device-key-v2:${this.#owner}`);if(device!==null){const value=parse(device);allowed(value,['key','recoveryCode']);text(value.key,44);rawKeys.push(value.key);}
   if(this.#ports.openLegacy&&(rawKeys.length||remote.legacyKey.key!==null))throw new Error('E2EE_KEY_BRIDGE_FORBIDDEN');
   if(remote.legacyKey.keyMode==='account'&&!this.#ports.openLegacy){text(remote.legacyKey.key,44);rawKeys.push(remote.legacyKey.key);}if((remote.recovered as unknown[]).length&&remote.legacyKey.keyMode==='empty')throw new Error('E2EE_LEGACY_KEY_UNAVAILABLE');
   if(!this.#ports.openLegacy)for(const raw of new Set(rawKeys)){const bytes=bytes64(raw,32);try{keys.push(await crypto.subtle.importKey('raw',bytes,'AES-GCM',false,['decrypt']));}finally{bytes.fill(0);}}
   for(const row of remote.recovered as unknown[]){exactKeys(row,['id','revision','iv','ciphertext','updated_at']);identity(row.id);if(!/^restored-[a-f0-9]{32}$/.test(row.id))invalid();integer(row.revision,1);time(row.updated_at);
    text(row.iv,16);text(row.ciphertext,Math.ceil(MAX/3)*4);const envelope={iv:row.iv,ciphertext:row.ciphertext},purpose=`recovered-task:v1:${row.id}`;let value:unknown;
    if(this.#ports.openLegacy)value=await this.#ports.openLegacy(envelope,purpose);
    else{const iv=bytes64(row.iv,12),cipher=bytes64(row.ciphertext,17,MAX);let plain:Uint8Array|undefined;try{for(const key of keys)try{plain=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:encoder.encode(`genesis-mindmap-v1:${this.#owner}:${purpose}`)},key,cipher));break;}catch{/* Only captured old keys may open this record. */}
      if(!plain)throw new Error(keys.length?'E2EE_LEGACY_TASK_CORRUPT':'E2EE_LEGACY_KEY_UNAVAILABLE');value=parse(decoder.decode(plain));}finally{plain?.fill(0);iv.fill(0);cipher.fill(0);}}
    this.#ports.assertCurrent();const task=validateMigrationTask(typeof value==='string'?parse(value):value);if(task.id!==row.id||!task.restoredFrom)invalid();add('server-recovered',{...task,restoredRevision:row.revision});
   }
   // The actual mindmap producer stores a SHA-256 target fingerprint here,
   // not JSON or task content. Retain arbitrary historical state bytes as inert
   // history; never parse them into new tasks or external execution grants.
   for(const row of remote.creations as unknown[]){exactKeys(row,['task_id','state']);identity(row.task_id);text(row.state,MAX);}
   for(const row of remote.creationTargets as unknown[]){exactKeys(row,['task_id','target_key','recovery_token','attempted','provider_id','provider_key']);identity(row.task_id);identity(row.target_key);identity(row.recovery_token);integer(row.attempted,0,1);for(const key of ['provider_id','provider_key'])if(row[key]!==null)text(row[key]);}
   // Queue payloads replace stale local display copies, never independent remote
   // changes. Tombstones suppress clean caches; unsent edits require review.
   const conflicts:TaskMigrationConflict[]=[],selected=new Map<string,{value:Row|null;deleted:boolean;choice:string}>();
   for(const [id,rows]of variants){
   const tombstones=rows.filter(row=>row.deleted),queued=rows.find(row=>row.source==='queued');const candidates=rows.filter(row=>!row.deleted&&(!queued||!['cache','memory'].includes(row.source)));
    if(tombstones.length&&!dirty.has(id))selected.set(id,{value:null,deleted:true,choice:tombstones[0].source});
    else if(tombstones.length)conflicts.push({id,variants:structuredClone(rows)});
    else{let value:Row={};let conflict=false;for(const candidate of candidates){const merged=compatible(value,candidate.value!);if(merged===null){conflict=true;break;}value=merged;}
     if(conflict)conflicts.push({id,variants:structuredClone(candidates)});else{if(!candidates.length)invalid();selected.set(id,{value,deleted:false,choice:'compatible'});}}
   }
   if(conflicts.length){if(!this.#ports.review)throw new Error('E2EE_TASK_CONFLICT_REVIEW_REQUIRED');const choices=await this.#ports.review(structuredClone(conflicts));this.#ports.assertCurrent();object(choices);
    if(Object.keys(choices).length!==conflicts.length||Object.keys(choices).some(id=>!conflicts.some(row=>row.id===id)))throw new Error('E2EE_TASK_CONFLICT_REVIEW_REQUIRED');
    for(const conflict of conflicts){const picked=conflict.variants.find(row=>row.source===choices[conflict.id]);if(!picked)throw new Error('E2EE_TASK_CONFLICT_REVIEW_REQUIRED');selected.set(conflict.id,{value:picked.value,deleted:picked.deleted,choice:picked.source});}}
   for(const editor of snapshot.memory.editors){
    const current=selected.get(editor.id),base=editor.base===null?null:validateMigrationTask(editor.base),next=editor.current===null?null:validateMigrationTask(editor.current);
    if(current?.deleted&&base===null&&next!==null)throw new Error('E2EE_TASK_CONFLICT_REVIEW_REQUIRED');
    if(!current){if(base!==null)throw new Error('E2EE_TASK_LOCAL_BASE_REVIEW_REQUIRED');add('editor',next,next===null,editor.id);selected.set(editor.id,{value:next,deleted:next===null,choice:'editor'});}
    else{const merged=threeWay(base,next,current.deleted?null:current.value);const task=merged===null?null:validateMigrationTask(merged);add('editor',next,next===null,editor.id);selected.set(editor.id,{value:task,deleted:task===null,choice:'editor-three-way'});}
   }
   const push=(objectId:string,value:unknown)=>{const bytes=encoder.encode(JSON.stringify(value));size+=bytes.length;if(bytes.length>MAX||size>E2EE_MIGRATION_BYTE_BUDGET||content.length>=10000){bytes.fill(0);throw new Error('E2EE_SOURCE_TOO_LARGE');}content.push({domain:'workspace',objectId,bytes});};
   const index:{id:string;objectId:string;recordIndex?:number}[]=[],ordered=[...selected].sort(([a],[b])=>a.localeCompare(b,'en')),packed=ordered.length>2000;
   let shard:Row[]=[],shardBytes=1024,shardId='personal-task-shard:'+crypto.randomUUID();
   const finishShard=()=>{if(!shard.length)return;push(shardId,{format:'genesis-private-task-records-v2',protocol:2,ownerId:this.#owner,rows:shard});shard=[];shardBytes=1024;shardId='personal-task-shard:'+crypto.randomUUID();};
   for(const [id,current]of ordered){const row={protocol:1,ownerId:this.#owner,id,...current,variants:variants.get(id),externalCopy:'requires-new-consent'};
    if(!packed){const objectId='personal-task-record:'+crypto.randomUUID();index.push({id,objectId});push(objectId,row);continue;}
    const size=encoder.encode(JSON.stringify(row)).length;if(shard.length&&shardBytes+size>4*1024*1024)finishShard();index.push({id,objectId:shardId,recordIndex:shard.length});shard.push(row);shardBytes+=size+1;
   }finishShard();push('personal-task-index-v1',{protocol:packed?2:1,ownerId:this.#owner,tasks:index});
   push('personal-tasks-live-v1',{protocol:1,ownerId:this.#owner,tasks:[...selected].sort(([a],[b])=>a.localeCompare(b,'en')).map(([id,row])=>({id,value:row.value,deleted:row.deleted})),externalCopy:'requires-new-consent'});
   // Raw HTTP queues/keys remain solely in the protected local capture. These
   // server receipts are inert private history and grant no external execution.
   push('personal-task-history-v1',{protocol:1,ownerId:this.#owner,legacyGeneration:remote.legacyGeneration,tasks:remote.tasks,deletions:remote.deletions,links:remote.links,recovered:remote.recovered,
    recoveredDeletions:remote.recoveredDeletions,creations:remote.creations,creationTargets:remote.creationTargets,legacyKeyMode:remote.legacyKey.keyMode,providerCaches:providers.history});
   this.#ports.assertCurrent();completed=true;return{complete:true,content};
  }finally{keys.length=0;if(!completed)content.forEach(row=>row.bytes.fill(0));}
 }
}

/** Read the migrated task through an already authenticated new-root repository.
 * Provider identities survive as history; these results cannot replay legacy IO. */
export async function readMigratedPersonalTasks(ownerId:string,read:(objectId:string)=>Promise<Uint8Array|null>,assertCurrent:()=>void):Promise<{tasks:Row[];deletedIds:string[]}>{
 assertTechnical(ownerId);assertCurrent();const open=async(id:string)=>{const bytes=await read(id);assertCurrent();if(!bytes)throw new Error('E2EE_TASK_OBJECT_MISSING');try{return parse(decoder.decode(bytes));}finally{bytes.fill(0);}};
 const index=await open('personal-task-index-v1');exactKeys(index,['protocol','ownerId','tasks']);if(![1,2].includes(Number(index.protocol))||index.ownerId!==ownerId)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');list(index.tasks);
 const tasks:Row[]=[],deletedIds:string[]=[],ids=new Set<string>(),objects=new Set<string>();let openedId='',openedRows:unknown[]=[],nextIndex=0;
 for(const entry of index.tasks){exactKeys(entry,index.protocol===2?['id','objectId','recordIndex']:['id','objectId']);identity(entry.id);if(typeof entry.objectId!=='string'||ids.has(entry.id))invalid();ids.add(entry.id);
  let row:Row;
  if(index.protocol===1){if(!RECORD.test(entry.objectId)||objects.has(entry.objectId))invalid();objects.add(entry.objectId);const single=await open(entry.objectId);object(single);row=single;}
  else{if(!/^personal-task-shard:[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(entry.objectId))invalid();integer(entry.recordIndex);
   if(openedId!==entry.objectId){if(openedId&&nextIndex!==openedRows.length||objects.has(entry.objectId))invalid();objects.add(entry.objectId);const part=await open(entry.objectId);exactKeys(part,['format','protocol','ownerId','rows']);if(part.format!=='genesis-private-task-records-v2'||part.protocol!==2||part.ownerId!==ownerId)invalid();list(part.rows);if(!part.rows.length)invalid();openedId=entry.objectId;openedRows=part.rows;nextIndex=0;}
   if(entry.recordIndex!==nextIndex||nextIndex>=openedRows.length)invalid();const candidate=openedRows[nextIndex++];object(candidate);row=candidate;
  }
  exactKeys(row,['protocol','ownerId','id','value','deleted','choice','variants','externalCopy']);if(row.protocol!==1||row.ownerId!==ownerId||row.id!==entry.id)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
  if(typeof row.deleted!=='boolean'||row.externalCopy!=='requires-new-consent'||typeof row.choice!=='string')invalid();list(row.variants);
  if(row.deleted){if(row.value!==null)invalid();deletedIds.push(entry.id);}else{const value=validateMigrationTask(row.value);if(value.id!==entry.id)invalid();tasks.push({...value,syncToGoogle:false,syncAccountIds:[],mindmapCreateOnly:false,createOnly:false});}
 }if(openedId&&nextIndex!==openedRows.length)invalid();assertCurrent();return{tasks,deletedIds};
}
