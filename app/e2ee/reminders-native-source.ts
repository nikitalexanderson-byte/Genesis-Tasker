import {assertTechnical,exactKeys} from './keys.ts';
import {REMINDER_NATIVE_ENTRIES,parseReminderMigrationJson,type RemindersMigrationMemory,type ReminderMigrationLocal} from './reminders-source.ts';

type Row=Record<string,unknown>;
const stores=['genesis_habit_reminder_preferences','genesis_habit_alarm_registry','genesis_sleep_alarm_registry','genesis_moon_alarm_registry','genesis.advice.alarms.v1'];
function invalid():never{throw new Error('E2EE_REMINDER_SOURCE_INVALID');}
function object(value:unknown):asserts value is Row{if(!value||typeof value!=='object'||Array.isArray(value))invalid();}
function integer(value:unknown):asserts value is number{if(!Number.isSafeInteger(value)||(value as number)<0)invalid();}
function text(value:unknown):asserts value is string{if(typeof value!=='string'||value.length>1024*1024)invalid();}
/** Scope attribution happens after the protected source capture. In particular
 * JSONObject/mapNotNull must not hide a duplicate scope or discard a bad snooze.
 * All OS/Push grants remain outside the executable output. */
export async function normalizeNativeReminderCapture(input:unknown,assertCurrent:()=>void){
 assertCurrent();exactKeys(input,['protocol','ownerId','scopeId','capturedAt','generation','pendingGeneration','accountScope','room','preferences','localPreferences','mounted']);
 if(input.protocol!==1||typeof input.ownerId!=='string'||typeof input.scopeId!=='string'||typeof input.capturedAt!=='string'||!Number.isFinite(Date.parse(input.capturedAt)))invalid();
 assertTechnical(input.ownerId);assertTechnical(input.scopeId);integer(input.generation);if(input.pendingGeneration!==null)throw new Error('E2EE_REMINDER_GENERATION_REVIEW_REQUIRED');
 const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(input.ownerId)));assertCurrent();
 const scope='account-'+Array.from(hash,byte=>byte.toString(16).padStart(2,'0')).join('').slice(0,32);hash.fill(0);
 if(input.accountScope!==scope)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');if(!Array.isArray(input.room)||input.room.length>10000)invalid();
 const room=input.room.map(row=>{exactKeys(row,['scope','id','taskId','occurrenceId','revision','at','state','deliveredAt']);if(row.scope!==scope)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');const value={...row};delete value.scope;return value;});
 exactKeys(input.preferences,stores);for(const value of Object.values(input.preferences))object(value);
 exactKeys(input.localPreferences,['fullMoonLeadDays','newMoonLeadDays']);
 const entries:ReminderMigrationLocal['entries']=[],unassigned:ReminderMigrationLocal['unassigned']=[];
 const add=(store:string,key:string,value:unknown)=>entries.push({store,key,value});
 add('native-reminder-inventory','manifest','android-v1');for(const key of ['fullMoonLeadDays','newMoonLeadDays'])add('genesis_preferences',key,input.localPreferences[key]);
 const frequency=input.preferences.genesis_habit_reminder_preferences as Row;
 add('genesis_habit_reminder_preferences','maxPerDay',frequency[scope+':max']??null);add('genesis_habit_reminder_preferences','snoozeMinutes',frequency[scope+':snooze']??null);
 for(const [key,value]of Object.entries(frequency))if(!/^account-[a-f0-9]{32}:(?:max|snooze)$/.test(key))unassigned.push({source:'native:genesis_habit_reminder_preferences:'+key,raw:JSON.stringify(value)});
 const uriOwner=(value:string,authority:string)=>{
  // Supported WebViews can expose an opaque pathname/empty hostname for this
  // non-special scheme, unlike current browser URL. Match Android Uri's exact
  // generated authority and first path component without URL normalization.
  const prefix=`genesis://${authority}/`;if(!value.startsWith(prefix))invalid();
  for(const char of value)if(char.charCodeAt(0)<=32||char.charCodeAt(0)===127||char==='\\'||char==='?'||char==='#')invalid();
  const end=value.indexOf('/',prefix.length);let owner:string;
  try{owner=decodeURIComponent(value.slice(prefix.length,end<0?undefined:end));assertTechnical(owner);}catch{return invalid();}return owner;
 };
 for(const store of stores.slice(1)){
  const values=input.preferences[store] as Row,fields=REMINDER_NATIVE_ENTRIES.filter(([name])=>name===store).map(([,key])=>key);
  for(const [key,value]of Object.entries(values))if(!fields.includes(key))unassigned.push({source:'native:'+store+':'+key,raw:JSON.stringify(value)});
  for(const field of fields){const original=values[field];if(original===undefined||original===null){add(store,field,null);continue;}
   const array=store==='genesis.advice.alarms.v1'?[original]:original;if(!Array.isArray(array)||array.length>10000)invalid();const owned:string[]=[];
   for(const raw of array){text(raw);let owner:string;
    if(field==='snoozes'){
     const row=parseReminderMigrationJson(raw);object(row);const allowed=['scope','requestId','habitId','date','at','ruleId','time','until'];
     if(Object.keys(row).some(key=>!allowed.includes(key)))throw new Error('E2EE_REMINDER_FORMAT_UNSUPPORTED');assertTechnical(row.scope);owner=row.scope;
     text(row.requestId);text(row.habitId);text(row.ruleId);text(row.date);integer(row.at);integer(row.until);if(row.time!==undefined&&row.time!==null)text(row.time);
    }else{
     let uri=raw;if(field==='deliveryTimes'){const split=raw.lastIndexOf('\t');if(split<0||!/^\d+$/.test(raw.slice(split+1)))invalid();uri=raw.slice(0,split);}
     owner=uriOwner(uri,store==='genesis_habit_alarm_registry'?'habit-reminder':store==='genesis_sleep_alarm_registry'?'sleep-reminder':store==='genesis_moon_alarm_registry'?'moon-reminder':'advice-reminder');
    }
    if(owner===scope)owned.push(raw);
   }
   add(store,field,store==='genesis.advice.alarms.v1'?(owned[0]??null):owned);
  }
 }
 let editors:ReminderMigrationLocal['editors']=[];
 if(input.mounted!==null){exactKeys(input.mounted,['editors']);if(!Array.isArray(input.mounted.editors)||input.mounted.editors.length>1000)invalid();editors=structuredClone(input.mounted.editors) as ReminderMigrationLocal['editors'];}
 const local:ReminderMigrationLocal={platform:'android',inventoryVersion:1,entries,room,editors,worker:{state:'unsupported',records:[]},unassigned,projectionWanted:null};
 const memory:RemindersMigrationMemory={ownerId:input.ownerId,generation:input.generation,reconciliationRequired:false,local};assertCurrent();
 return{protocol:1,ownerId:input.ownerId,scopeId:input.scopeId,capturedAt:input.capturedAt,memory};
}
