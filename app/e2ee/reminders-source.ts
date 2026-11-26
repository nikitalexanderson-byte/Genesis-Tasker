import {assertTechnical,exactKeys} from './keys.ts';
import {decodeE2eeBytes} from './envelope.ts';
import {parseLegacyMigrationJson} from './legacy-json.ts';
import {isCivilDate} from '../calendar-context.ts';
import {E2EE_MIGRATION_BYTE_BUDGET,type MigrationContent,type MigrationSourceContext} from './migration.ts';
import type {PrivatePathAdapter} from './migration-sources.ts';

type Row=Record<string,unknown>;
export const REMINDER_SOURCE_TABLES=['habitProfiles','habitDevices','habitDeliveries','adviceDays','adviceDeliveries','sharedPreferences'] as const;
export const REMINDER_WEB_UNASSIGNED_KEYS=['genesis-habit-notification-metrics-v1','genesis-habit-notifications-delivered-v1'] as const;
export const REMINDER_NATIVE_ENTRIES=[['native-reminder-inventory','manifest'],['genesis_preferences','fullMoonLeadDays'],['genesis_preferences','newMoonLeadDays'],
 ['genesis_habit_reminder_preferences','maxPerDay'],['genesis_habit_reminder_preferences','snoozeMinutes'],
 ...['alarms','delivered','deliveryTimes','snoozes','snoozeRequests'].map(key=>['genesis_habit_alarm_registry',key]),
 ...['alarms','delivered'].map(key=>['genesis_sleep_alarm_registry',key]),...['alarms','delivered'].map(key=>['genesis_moon_alarm_registry',key]),
 ['genesis.advice.alarms.v1','scheduled']] as const;
export function reminderWebStorageKeys(ownerId:string){assertTechnical(ownerId);return[
 `genesis.habit-reminder.device.${ownerId}`,`genesis.habit-reminder.frequency.${ownerId}`,`genesis.habit-reminder.receipts.${ownerId}`,
 `genesis.habit-reminder.snoozes.${ownerId}`,`genesis-moon-reminders-v1:${ownerId}`,`genesis-moon-reminders-sent-v1:${ownerId}`,
 `genesis-task-reminders:${ownerId}`,`genesis.advice-push.${ownerId}`,`genesis.shared-push.${ownerId}`,`genesis-data-generation-v1:${ownerId}`,
 `genesis-habit-notification-metrics-v2:${ownerId}`,`genesis-habit-notifications-delivered-v2:${ownerId}`];}
export type ReminderStorageEntry={store:string;key:string;value:unknown};
export type ReminderMigrationLocal={platform:'web'|'android';inventoryVersion:1;entries:ReminderStorageEntry[];room:unknown[];
 editors:{source:string;state:unknown;mounted:boolean}[];worker:{state:'absent'|'captured'|'unsupported';records:{cache:string;url:string;raw:string}[]};
 unassigned:{source:string;raw:string}[];projectionWanted:boolean|null};
export type RemindersMigrationMemory={ownerId:string;generation:number;reconciliationRequired:boolean;local:ReminderMigrationLocal};
export type RemindersSourcePorts={memory:()=>Promise<RemindersMigrationMemory>;assertCurrent:()=>void;
 legacyReminders:(context:MigrationSourceContext)=>Promise<unknown>;
 /** Old origin-wide receipts have no authenticated owner. A product review may
  * explicitly attribute them; absence/cancellation is never implicit consent. */
 reviewUnassigned?:(entries:readonly {source:string;raw:string}[])=>Promise<'attribute-to-current-owner'|null>};
type Snapshot={protocol:1;ownerId:string;scopeId:string;capturedAt:string;memory:RemindersMigrationMemory};
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true}),MAX=48*1024*1024;
const hashPattern=/^[a-f0-9]{64}$/,timePattern=/^(?:[01]\d|2[0-3]):[0-5]\d$/;
function invalid():never{throw new Error('E2EE_REMINDER_SOURCE_INVALID');}
function object(value:unknown):asserts value is Row{if(!value||typeof value!=='object'||Array.isArray(value))invalid();}
function text(value:unknown,max=MAX):asserts value is string{if(typeof value!=='string'||value.length>max)invalid();}
function identity(value:unknown):asserts value is string{text(value,1024);if(!value||Array.from(value).some(char=>char.charCodeAt(0)<32))invalid();}
function integer(value:unknown,min=0,max=Number.MAX_SAFE_INTEGER-1):asserts value is number{if(!Number.isSafeInteger(value)||(value as number)<min||(value as number)>max)invalid();}
function timestamp(value:unknown){text(value,64);if(!Number.isFinite(Date.parse(value)))invalid();}
function date(value:unknown){text(value,10);if(!isCivilDate(value))invalid();}
function nullable(value:unknown,validate:(value:unknown)=>void){if(value!==null)validate(value);}
function list(value:unknown,max=1000000):asserts value is unknown[]{if(!Array.isArray(value)||value.length>max)invalid();}
export function parseReminderMigrationJson(value:unknown,maximum=MAX){return parseLegacyMigrationJson(value,'E2EE_REMINDER_SOURCE_INVALID',maximum);}
function digest(value:unknown){text(value,64);if(!hashPattern.test(value))invalid();}
function zone(value:unknown){text(value,128);try{new Intl.DateTimeFormat('en',{timeZone:value});}catch{invalid();}}
function clock(value:unknown){text(value,5);if(!timePattern.test(value))invalid();}
function unique(values:readonly Row[],key:(value:Row)=>unknown){if(new Set(values.map(key)).size!==values.length)invalid();}
export function classifyReminderWorkerRecord(row:{cache:string;url:string;raw:string},ownerId:string):'owned'|'foreign'|'unassigned'{
 assertTechnical(ownerId);const names=['genesis-habit-push-receipts-v1','genesis-advice-push-receipts-v1','genesis-shared-push-receipts-v1','displayed-reminders'];
 if(!names.includes(row.cache))throw new Error('E2EE_REMINDER_FORMAT_UNSUPPORTED');
 const value=parseReminderMigrationJson(row.raw);object(value);let owner:unknown=value.userId;
 if(row.cache==='genesis-habit-push-receipts-v1'){
  let path:string;try{path=new URL(row.url).pathname;}catch{return invalid();}
  const match=/\/__habit-(event|intent|receipt)\/([^/]+)$/.exec(path);if(!match)throw new Error('E2EE_REMINDER_FORMAT_UNSUPPORTED');
  if(match[1]==='event'){
   let event:string;try{event=decodeURIComponent(match[2]);}catch{return invalid();}
   if(!/:[a-f0-9]{64}$/.test(event))invalid();const scoped=event.slice(0,-65);assertTechnical(scoped);if(owner!==undefined&&owner!==scoped)invalid();owner=scoped;
  }
 }
 if(owner===undefined)return'unassigned';assertTechnical(owner);return owner===ownerId?'owned':'foreign';
}
function target(value:unknown){
 object(value);const fields=['id','kind','date','at','timeZone','allowDuringQuietHours','habitId','ruleId','intervalTime','localTime','action'];
 if(Object.keys(value).some(key=>!fields.includes(key)))throw new Error('E2EE_REMINDER_FORMAT_UNSUPPORTED');
 identity(value.id);date(value.date);timestamp(value.at);zone(value.timeZone);if(typeof value.allowDuringQuietHours!=='boolean')invalid();
 if(value.kind==='habit'){identity(value.habitId);identity(value.ruleId);if(!['complete','input','interval'].includes(String(value.action))||value.localTime!==undefined)invalid();if(value.intervalTime!==undefined)clock(value.intervalTime);}
 else if(value.kind==='goal'){clock(value.localTime);if(value.allowDuringQuietHours||['habitId','ruleId','intervalTime','action'].some(key=>value[key]!==undefined))invalid();}
 else invalid();return value;
}
function plan(value:unknown){
 exactKeys(value,['version','generatedAt','expiresAt','timeZone','tone','quietHoursStart','quietHoursEnd','rows']);
 if(value.version!==1||!['calm','heroic','ironic'].includes(String(value.tone)))invalid();timestamp(value.generatedAt);timestamp(value.expiresAt);zone(value.timeZone);clock(value.quietHoursStart);clock(value.quietHoursEnd);
 if(Date.parse(value.expiresAt as string)<=Date.parse(value.generatedAt as string))invalid();list(value.rows,2048);for(const row of value.rows)target(row);unique(value.rows as Row[],row=>row.id);return value;
}
function validateLocal(local:unknown,ownerId:string,generation:number):asserts local is ReminderMigrationLocal{
 exactKeys(local,['platform','inventoryVersion','entries','room','editors','worker','unassigned','projectionWanted']);
 if(!['web','android'].includes(String(local.platform))||local.inventoryVersion!==1||local.projectionWanted!==null&&typeof local.projectionWanted!=='boolean')invalid();
 list(local.entries,10000);list(local.room,10000);list(local.editors,1000);list(local.unassigned,10000);const names=new Set<string>();
 exactKeys(local.worker,['state','records']);
 for(const row of local.entries){exactKeys(row,['store','key','value']);identity(row.store);identity(row.key);const name=row.store+'\0'+row.key;if(names.has(name))invalid();names.add(name);}
 if(local.platform==='web'){
  const keys=reminderWebStorageKeys(ownerId);if(local.entries.length!==keys.length||local.room.length)invalid();
  for(const row of local.entries as Row[]){if(row.store!=='localStorage'||!keys.includes(row.key as string)||row.value!==null&&typeof row.value!=='string')invalid();
   if(row.key===`genesis-data-generation-v1:${ownerId}`&&row.value!==null&&row.value!==String(generation))throw new Error('E2EE_REMINDER_GENERATION_REVIEW_REQUIRED');
   // These three are opaque receipt identifiers, never working endpoint grants.
   if(row.value!==null&&!String(row.key).startsWith('genesis.habit-reminder.device.')&&!String(row.key).startsWith('genesis.advice-push.')&&!String(row.key).startsWith('genesis.shared-push.'))parseReminderMigrationJson(row.value);
  }
 }else{
  // Native supplies its exhaustive registry manifest, including missing keys.
  // A web-shaped synthetic empty capture cannot impersonate native inventory.
  const manifest=(local.entries as Row[]).find(row=>row.store==='native-reminder-inventory'&&row.key==='manifest');
  if(!manifest||manifest.value!=='android-v1')throw new Error('E2EE_REMINDER_NATIVE_INVENTORY_REQUIRED');
  if(local.entries.length!==REMINDER_NATIVE_ENTRIES.length||REMINDER_NATIVE_ENTRIES.some(([store,key])=>!names.has(store+'\0'+key)))throw new Error('E2EE_REMINDER_NATIVE_INVENTORY_REQUIRED');
  if(local.projectionWanted!==null||local.worker.state!=='unsupported'||!Array.isArray(local.worker.records)||local.worker.records.length)invalid();
  for(const row of local.entries as Row[]){if(row.value===null||row.store==='native-reminder-inventory')continue;
   if(row.store==='genesis_preferences'){text(row.value,256);}
   else if(row.store==='genesis_habit_reminder_preferences'){if(!(row.key==='maxPerDay'?[4,12,24,64,128]:[5,10,15,30,60]).includes(row.value as number))invalid();}
   else if(row.store==='genesis.advice.alarms.v1')text(row.value,4096);
   else{list(row.value,10000);for(const value of row.value)text(value,1024*1024);if(new Set(row.value).size!==row.value.length)invalid();}
  }
  for(const raw of local.room){exactKeys(raw,['id','taskId','occurrenceId','revision','at','state','deliveredAt']);identity(raw.id);identity(raw.taskId);identity(raw.occurrenceId);integer(raw.revision);integer(raw.at,-8640000000000000,8640000000000000);
   if(!['pending','delivered','cancelled','snoozed'].includes(String(raw.state)))throw new Error('E2EE_REMINDER_FORMAT_UNSUPPORTED');nullable(raw.deliveredAt,integer);}
  unique(local.room as Row[],row=>row.id);
 }
 for(const editor of local.editors){exactKeys(editor,['source','state','mounted']);identity(editor.source);if(typeof editor.mounted!=='boolean')invalid();}
 exactKeys(local.worker,['state','records']);if(!['absent','captured','unsupported'].includes(String(local.worker.state)))invalid();list(local.worker.records,10000);
 if(local.worker.state!=='captured'&&(local.worker.records as unknown[]).length)invalid();
 const workerNames=new Set<string>();for(const row of local.worker.records){exactKeys(row,['cache','url','raw']);identity(row.cache);identity(row.url);text(row.raw);parseReminderMigrationJson(row.raw);
  if(classifyReminderWorkerRecord(row as {cache:string;url:string;raw:string},ownerId)!=='owned')throw new Error('E2EE_REMINDER_PROVENANCE_REVIEW_REQUIRED');
  const name=row.cache+'\0'+row.url;if(workerNames.has(name))invalid();workerNames.add(name);}
 const unassignedNames=new Set<string>();for(const row of local.unassigned){exactKeys(row,['source','raw']);identity(row.source);text(row.raw);parseReminderMigrationJson(row.raw);if(unassignedNames.has(row.source))invalid();unassignedNames.add(row.source);}
}

/** Private reminder history migrates independently of delivery authority. No old
 * pending/sending job, push subscription, OS permission or stored action is
 * executable output. Fresh scheduling is a separate explicit product consent. */
export class PersonalRemindersSource implements PrivatePathAdapter{
 readonly id='personal.reminders';#owner:string;#scope:string;#ports:RemindersSourcePorts;
 constructor(ownerId:string,scopeId:string,ports:RemindersSourcePorts){assertTechnical(ownerId);assertTechnical(scopeId);this.#owner=ownerId;this.#scope=scopeId;this.#ports=ports;}
 async captureLocal():Promise<Uint8Array>{
  this.#ports.assertCurrent();const memory=structuredClone(await this.#ports.memory());this.#ports.assertCurrent();
  if(memory.ownerId!==this.#owner)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
  const bytes=encoder.encode(JSON.stringify({protocol:1,ownerId:this.#owner,scopeId:this.#scope,capturedAt:new Date().toISOString(),memory}));
  if(bytes.length>MAX){bytes.fill(0);throw new Error('E2EE_SNAPSHOT_TOO_LARGE');}return bytes;
 }
 #decode(bytes:Uint8Array):Snapshot{
  if(bytes.length<1||bytes.length>MAX)invalid();const value=parseReminderMigrationJson(decoder.decode(bytes));exactKeys(value,['protocol','ownerId','scopeId','capturedAt','memory']);
  if(value.protocol!==1||value.ownerId!==this.#owner||value.scopeId!==this.#scope)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');timestamp(value.capturedAt);
  exactKeys(value.memory,['ownerId','generation','reconciliationRequired','local']);if(value.memory.ownerId!==this.#owner)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');integer(value.memory.generation);
  if(typeof value.memory.reconciliationRequired!=='boolean')invalid();if(value.memory.reconciliationRequired)throw new Error('E2EE_REMINDER_GENERATION_REVIEW_REQUIRED');
  validateLocal(value.memory.local,this.#owner,value.memory.generation);return value as Snapshot;
 }
 async reconcile(local:Uint8Array,previous:readonly Uint8Array[],context?:MigrationSourceContext){
  this.#ports.assertCurrent();if(!context||context.ownerId!==this.#owner||context.scopeId!==this.#scope)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
  if(previous.length>32||local.length+previous.reduce((sum,bytes)=>sum+bytes.length,0)>E2EE_MIGRATION_BYTE_BUDGET)throw new Error('E2EE_MIGRATION_HISTORY_LIMIT');
  const snapshots=[this.#decode(local),...previous.map(bytes=>this.#decode(bytes))];
  if(snapshots.some(value=>value.memory.generation!==snapshots[0].memory.generation))throw new Error('E2EE_REMINDER_GENERATION_REVIEW_REQUIRED');
  const unassigned=snapshots.flatMap(value=>value.memory.local.unassigned);
  if(unassigned.length&&(!this.#ports.reviewUnassigned||await this.#ports.reviewUnassigned(structuredClone(unassigned))!=='attribute-to-current-owner'))throw new Error('E2EE_REMINDER_PROVENANCE_REVIEW_REQUIRED');
  this.#ports.assertCurrent();const remote=structuredClone(await this.#ports.legacyReminders(context));this.#ports.assertCurrent();
  exactKeys(remote,['protocol','ownerId','scopeId','migrationId','fence','sourceHash','legacyGeneration','checkpointHash','directoryRevision',...REMINDER_SOURCE_TABLES,'legacyKey']);
  if(remote.protocol!==1||remote.ownerId!==this.#owner||remote.scopeId!==this.#scope||remote.migrationId!==context.migrationId||remote.fence!==context.fence||remote.sourceHash!==context.sourceHash)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
  integer(remote.legacyGeneration);integer(remote.directoryRevision,1);decodeE2eeBytes(remote.checkpointHash,32).fill(0);
  if(remote.legacyGeneration!==snapshots[0].memory.generation||context.generation<=remote.legacyGeneration)throw new Error('E2EE_REMINDER_GENERATION_REVIEW_REQUIRED');
  exactKeys(remote.legacyKey,['keyMode','key']);if(remote.legacyKey.keyMode!=='empty'||remote.legacyKey.key!==null)throw new Error('E2EE_KEY_BRIDGE_FORBIDDEN');
  let count=0;for(const name of REMINDER_SOURCE_TABLES){list(remote[name]);count+=(remote[name] as unknown[]).length;}if(count>1000000||encoder.encode(JSON.stringify(remote)).length>E2EE_MIGRATION_BYTE_BUDGET)throw new Error('E2EE_SOURCE_TOO_LARGE');
  if((remote.habitProfiles as Row[]).length>1||(remote.sharedPreferences as Row[]).length>1)invalid();
  const devices=new Map<string,Row>(),events=new Set<string>(),days=new Set<string>();
  for(const row of remote.habitProfiles as Row[]){exactKeys(row,['encrypted_plan','plan_hash','workspace_version','revision','expires_at','needs_refresh','updated_at','plan_json']);
   integer(row.workspace_version);integer(row.revision);integer(row.needs_refresh,0,1);timestamp(row.updated_at);nullable(row.expires_at,timestamp);nullable(row.plan_hash,digest);
   if((row.encrypted_plan===null)!==(row.plan_json===null))invalid();nullable(row.encrypted_plan,text);if(row.plan_json!==null)plan(parseReminderMigrationJson(row.plan_json));
  }
  for(const row of remote.habitDevices as Row[]){exactKeys(row,['id','device_key','encrypted_subscription','enabled','request_id','request_hash','time_zone','max_per_day','snooze_minutes','revision','created_at','updated_at']);
   identity(row.id);identity(row.device_key);identity(row.request_id);digest(row.request_hash);nullable(row.encrypted_subscription,text);integer(row.enabled,0,1);integer(row.revision,1);zone(row.time_zone);timestamp(row.created_at);timestamp(row.updated_at);
   if(![4,12,24,64,128].includes(row.max_per_day as number)||![5,10,15,30,60].includes(row.snooze_minutes as number)||devices.has(row.id as string))invalid();devices.set(row.id as string,row);
  }
  const states=['pending','sending','sent','cancelled','failed'];
  for(const row of remote.habitDeliveries as Row[]){exactKeys(row,['id','device_id','profile_revision','event_key','encrypted_target','scheduled_at','expires_at','state','sent_at','reserved_at','snooze_of','error_code','created_at','updated_at','target_json']);
   identity(row.id);identity(row.device_id);integer(row.profile_revision);digest(row.event_key);text(row.encrypted_target);nullable(row.snooze_of,identity);nullable(row.error_code,text);
   for(const name of ['scheduled_at','expires_at','created_at','updated_at'])timestamp(row[name]);for(const name of ['sent_at','reserved_at'])nullable(row[name],timestamp);
   if(!states.includes(String(row.state))||!devices.has(row.device_id as string)||events.has(row.id as string))invalid();events.add(row.id as string);target(parseReminderMigrationJson(row.target_json));
  }
  // Retention can remove a snooze's original delivery. Its complete target is
  // retained in this row; preserve the reference without recreating either job.
  for(const row of remote.adviceDays as Row[]){exactKeys(row,['day_key','advice_id','collection','scheduled_time','time_zone','expires_at','created_at']);date(row.day_key);text(row.advice_id,40);
   if(!/^advice-[a-f0-9]{24}$/.test(row.advice_id)||!['aurora','philosophers'].includes(String(row.collection))||days.has(row.day_key as string))invalid();days.add(row.day_key as string);clock(row.scheduled_time);zone(row.time_zone);timestamp(row.expires_at);timestamp(row.created_at);
  }
  const adviceIds=new Set<string>();for(const row of remote.adviceDeliveries as Row[]){exactKeys(row,['id','device_id','day_key','state','sent_at','error_code','created_at','updated_at']);identity(row.id);identity(row.device_id);date(row.day_key);nullable(row.sent_at,timestamp);nullable(row.error_code,text);timestamp(row.created_at);timestamp(row.updated_at);
   if(!states.includes(String(row.state))||adviceIds.has(row.id as string))invalid();adviceIds.add(row.id as string);
   // Ordinary retention may remove the day before an old delivery. Preserve the
   // orphan as inert history; it can never authorize fetching a new advice card.
  }
  for(const row of remote.sharedPreferences as Row[]){exactKeys(row,['settings_json','revision','updated_at']);integer(row.revision,1);timestamp(row.updated_at);object(parseReminderMigrationJson(row.settings_json));}
  const content:MigrationContent[]=[],localContent:MigrationContent[]=[];let size=0,complete=false;
  const add=(placement:'remote'|'local',objectId:string,value:unknown)=>{const bytes=encoder.encode(JSON.stringify(value));size+=bytes.length;
   if(bytes.length>64*1024*1024||size>E2EE_MIGRATION_BYTE_BUDGET||content.length+localContent.length>=10000){bytes.fill(0);throw new Error('E2EE_SOURCE_TOO_LARGE');}
   (placement==='remote'?content:localContent).push({domain:'workspace',objectId,bytes});};
  try{
   const history:{table:string;objectId:string}[]=[];for(const name of REMINDER_SOURCE_TABLES)for(const row of remote[name] as Row[]){const objectId='personal-reminder-history:'+crypto.randomUUID();history.push({table:name,objectId});
    add('local',objectId,{protocol:1,ownerId:this.#owner,table:name,original:row,execution:'history-only'});}
   const captures:string[]=[];for(const snapshot of snapshots){const objectId='personal-reminder-capture:'+crypto.randomUUID();captures.push(objectId);
    add('local',objectId,{protocol:1,ownerId:this.#owner,capturedAt:snapshot.capturedAt,local:snapshot.memory.local,execution:'history-only'});}
   add('remote','personal-reminders-preferences-v1',{protocol:1,ownerId:this.#owner,shared:(remote.sharedPreferences as Row[])[0]??null,deliveryAuthority:'fresh-consent-required'});
   // All recovery history stays on this device under the new root; old request
   // IDs/targets/ciphertexts do not become server-visible object identifiers.
   add('local','personal-reminders-history-index-v1',{protocol:1,ownerId:this.#owner,history,captures,execution:'history-only',deliveryAuthority:'fresh-consent-required'});
   this.#ports.assertCurrent();complete=true;return{complete:true,content,localContent};
  }finally{if(!complete)[...content,...localContent].forEach(row=>row.bytes.fill(0));}
 }
}

/** New-root recovery/readback only. This deliberately has no schedule, subscribe,
 * delivery acknowledgement, old-key unwrap or legacy replay capability. */
export async function readMigratedReminderHistory(readLocal:(domain:'workspace',objectId:string)=>Promise<Uint8Array|null>,ownerId:string){
 assertTechnical(ownerId);const read=async(id:string)=>{const bytes=await readLocal('workspace',id);if(!bytes)throw new Error('E2EE_REMINDER_LOCAL_CONTENT_REQUIRED');
  try{return parseReminderMigrationJson(decoder.decode(bytes),64*1024*1024);}finally{bytes.fill(0);}};
 const index=await read('personal-reminders-history-index-v1');exactKeys(index,['protocol','ownerId','history','captures','execution','deliveryAuthority']);
 if(index.protocol!==1||index.ownerId!==ownerId||index.execution!=='history-only'||index.deliveryAuthority!=='fresh-consent-required')invalid();list(index.history,10000);list(index.captures,33);
 const server:Row[]=[],captures:Row[]=[],seen=new Set<string>();for(const reference of index.history){exactKeys(reference,['table','objectId']);text(reference.objectId,80);
  if(!REMINDER_SOURCE_TABLES.includes(reference.table as typeof REMINDER_SOURCE_TABLES[number])||!/^personal-reminder-history:[a-f0-9-]{36}$/.test(reference.objectId)||seen.has(reference.objectId))invalid();seen.add(reference.objectId);
  const value=await read(reference.objectId);exactKeys(value,['protocol','ownerId','table','original','execution']);if(value.protocol!==1||value.ownerId!==ownerId||value.table!==reference.table||value.execution!=='history-only')invalid();object(value.original);server.push(value);
 }
 for(const id of index.captures){text(id,80);if(!/^personal-reminder-capture:[a-f0-9-]{36}$/.test(id)||seen.has(id))invalid();seen.add(id);
  const value=await read(id);exactKeys(value,['protocol','ownerId','capturedAt','local','execution']);if(value.protocol!==1||value.ownerId!==ownerId||value.execution!=='history-only')invalid();timestamp(value.capturedAt);captures.push(value);
 }
 return{server,captures,execution:'history-only' as const,deliveryAuthority:'fresh-consent-required' as const};
}
