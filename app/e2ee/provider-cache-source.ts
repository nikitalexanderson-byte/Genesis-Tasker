import {assertTechnical,exactKeys} from './keys.ts';

type Row=Record<string,unknown>;
export type ProviderCacheHistory={source:string;kind:'primary'|'linked';accountId:string;slot:string;version:string;calendar:unknown;tasks:unknown};
export type ProviderCacheReview=(sources:readonly ProviderCacheHistory[])=>Promise<Record<string,'include'|'retain-only'>>;
type Ports={validateTask:(value:unknown)=>Row;assertCurrent:()=>void;reviewHistorical?:ProviderCacheReview};
const encoder=new TextEncoder();
function invalid():never{throw new Error('E2EE_PROVIDER_CACHE_INVALID');}
function object(value:unknown):asserts value is Row{if(!value||typeof value!=='object'||Array.isArray(value))invalid();}
function allowed(value:unknown,keys:readonly string[]):asserts value is Row{object(value);if(Object.keys(value).some(key=>!keys.includes(key)))throw new Error('E2EE_PROVIDER_CACHE_FORMAT_UNSUPPORTED');}
function text(value:unknown,max=100000):asserts value is string{if(typeof value!=='string'||value.length>max)invalid();}
function identity(value:unknown):asserts value is string{text(value,512);if(!value||[...value].some(c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127))invalid();}
function list(value:unknown):asserts value is unknown[]{if(!Array.isArray(value)||value.length>10000)invalid();}
function state(value:unknown,service:'calendar'|'tasks',validateTask:Ports['validateTask']):void{
 if(value===null)return;allowed(value,['items','checkedAt','fullAt','nextAttempt','warning',...(service==='tasks'?['lists']:[])]);
 for(const name of ['checkedAt','fullAt','nextAttempt'])if(value[name]!==undefined&&(!Number.isSafeInteger(value[name])||(value[name] as number)<0))invalid();
 if(value.warning!==undefined&&value.warning!==null)text(value.warning);
 if(value.items!==undefined){list(value.items);const ids=new Set<string>();for(const raw of value.items){const task=validateTask(raw);identity(task.id);if(ids.has(task.id))invalid();ids.add(task.id);}}
 if(value.lists!==undefined){list(value.lists);const ids=new Set<string>();for(const row of value.lists){allowed(row,['id','title','updatedAt','isDefault']);identity(row.id);text(row.title);
   if(ids.has(row.id))invalid();ids.add(row.id);if(row.updatedAt!==undefined&&row.updatedAt!==null){text(row.updatedAt);if(!Number.isFinite(Date.parse(row.updatedAt)))invalid();}
   if(row.isDefault!==undefined&&typeof row.isDefault!=='boolean')invalid();}}
}

/** The server supplies a signed-owner/lease-bound, read-only file inventory.
 * Its legacy transport contains private content only after the coordinator's
 * protected local snapshot. Provider cursors/credentials never enter this port.
 * Historical grants/retained generations need an explicit per-source decision;
 * an old receipt cannot supply that consent or replay an external operation. */
export async function reconcileProviderCaches(value:unknown,ownerId:string,ports:Ports):Promise<{tasks:{source:string;value:Row}[];history:unknown[]}>{
 assertTechnical(ownerId);ports.assertCurrent();list(value);let count=0;
 if(encoder.encode(JSON.stringify(value)).length>16*1024*1024)throw new Error('E2EE_SOURCE_TOO_LARGE');
 const seen=new Set<string>(),current=new Set<string>(),accounts=new Set<string>(),historical:ProviderCacheHistory[]=[],records:{raw:Row;source:string}[]=[];
 for(const raw of value){
  exactKeys(raw,['kind','accountId','slot','version','presence','provenance','calendar','tasks']);
  if(!['primary','linked'].includes(String(raw.kind)))invalid();assertTechnical(raw.accountId);
  if(raw.kind==='primary'&&raw.accountId!==ownerId)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
  text(raw.slot,73);if(raw.slot!=='current'&&!/^retained:[a-f0-9]{64}$/.test(raw.slot))invalid();
  const account=raw.kind+':'+raw.accountId,key=account+':'+raw.slot;if(seen.has(key))invalid();seen.add(key);accounts.add(account);if(raw.slot==='current')current.add(account);
  if(raw.presence==='missing'){
   if(raw.slot!=='current'||raw.version!==null||raw.provenance!=='none'||raw.calendar!==null||raw.tasks!==null)invalid();continue;
  }
  if(raw.presence!=='stored'||typeof raw.version!=='string'||!/^[a-f0-9]{64}$/.test(raw.version)||!['current-grant','historical-grant'].includes(String(raw.provenance)))invalid();
  if(raw.slot!=='current'&&raw.slot!==`retained:${raw.version}`)invalid();
  state(raw.calendar,'calendar',ports.validateTask);state(raw.tasks,'tasks',ports.validateTask);
  for(const service of [raw.calendar,raw.tasks])if(service!==null){const row=service as Row;count+=(Array.isArray(row.items)?row.items.length:0)+(Array.isArray(row.lists)?row.lists.length:0);}
  if(count+value.length>10000)throw new Error('E2EE_SOURCE_TOO_LARGE');
  const source=`server-google:${key}:${raw.version}`;records.push({raw,source});
  if(raw.slot!=='current'||raw.provenance==='historical-grant')historical.push({source,kind:raw.kind as 'primary'|'linked',accountId:raw.accountId,slot:raw.slot,version:raw.version,calendar:structuredClone(raw.calendar),tasks:structuredClone(raw.tasks)});
 }
 if(!current.has('primary:'+ownerId)||[...accounts].some(account=>!current.has(account)))throw new Error('E2EE_PROVIDER_INVENTORY_INCOMPLETE');
 let decisions:Record<string,'include'|'retain-only'>={};
 if(historical.length){
  if(!ports.reviewHistorical)throw new Error('E2EE_PROVIDER_HISTORY_REVIEW_REQUIRED');
  decisions=await ports.reviewHistorical(structuredClone(historical));ports.assertCurrent();object(decisions);
  if(Object.keys(decisions).length!==historical.length||Object.keys(decisions).some(key=>!historical.some(row=>row.source===key))
   ||Object.values(decisions).some(choice=>!['include','retain-only'].includes(choice)))throw new Error('E2EE_PROVIDER_HISTORY_REVIEW_REQUIRED');
 }
 const tasks:{source:string;value:Row}[]=[],prefixes=new Map<string,string>();
 for(const {raw,source}of records){
  if(decisions[source]==='retain-only')continue;
  const accountId=raw.accountId as string;
  if(!prefixes.has(accountId)){const bytes=encoder.encode(accountId),hash=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));ports.assertCurrent();
   try{prefixes.set(accountId,[...hash].map(byte=>byte.toString(16).padStart(2,'0')).join('').slice(0,10));}finally{bytes.fill(0);hash.fill(0);}}
  for(const service of ['calendar','tasks']as const){const rows=(raw[service] as Row|null)?.items??[];list(rows);
   for(const item of rows){const task=ports.validateTask(item),id=(task.createdIn??'genesis')==='genesis'?task.id:`account-${prefixes.get(accountId)}-${task.id}`;
    const decorated={...task,id,syncAccountIds:[accountId],googleAccountId:accountId,googleLinks:{[accountId]:{eventId:task.googleEventId??null,taskId:task.googleTaskId??null,taskListId:task.googleTaskListId??null,taskListTitle:task.googleTaskListTitle??''}}};
    tasks.push({source:source+':'+service,value:ports.validateTask(decorated)});
   }
  }
 }
 ports.assertCurrent();return{tasks,history:structuredClone(value)};
}
