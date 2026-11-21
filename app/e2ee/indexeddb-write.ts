import {snapshotE2eeValue} from './commands.ts';
import {exactKeys} from './keys.ts';
import {admitE2eeStorage,e2eeStorageWriteGrowth,E2EE_PROVIDER_STORAGE_BUDGET} from './storage-capacity.ts';

type Store='records'|'keyMaterial';
type Mutation<T>={key:string;expected:number|null;value:T|null};
const utf8=new TextEncoder();
const failures=new Set(['E2EE_UNLOCK_REQUIRED','E2EE_STORAGE_CAPACITY','E2EE_STORAGE_USAGE_UNAVAILABLE','E2EE_STORAGE_ADMISSION_INVALID','E2EE_CORRUPT_LOCAL_RECORD','E2EE_LOCAL_CONFLICT','E2EE_DEVICE_ALREADY_EXISTS']);
function wireBytes(key:string,row:unknown){
 const text=JSON.stringify([key,row]);if(text.length>8*1024*1024)throw new Error('E2EE_STORAGE_USAGE_UNAVAILABLE');
 return Math.max(text.length*2,utf8.encode(text).length);
}
function capture<T extends {serial:number}>(source:readonly Mutation<T>[]){
 if(!Array.isArray(source))throw new Error('E2EE_INVALID_LOCAL_BATCH');
 const descriptors=Object.getOwnPropertyDescriptors(source as object),length=descriptors.length?.value;
 if(!Number.isSafeInteger(length)||length<1||length>10000||Reflect.ownKeys(descriptors).length!==length+1)throw new Error('E2EE_INVALID_LOCAL_BATCH');
 const rows:Mutation<T>[]=[],seen=new Set<string>();
 for(let index=0;index<length;index++){
  const entry=descriptors[String(index)];if(!entry?.enumerable||!Object.hasOwn(entry,'value'))throw new Error('E2EE_INVALID_LOCAL_BATCH');
  // Snapshot each bounded row independently. A valid multi-row batch need not
  // fit the smaller command packet bound, and no caller alias crosses an await.
  const row=snapshotE2eeValue(entry.value) as Mutation<T>;exactKeys(row,['key','expected','value']);
  if(typeof row.key!=='string'||!row.key.length||row.key.length>2048||seen.has(row.key)
   ||row.expected!==null&&(!Number.isSafeInteger(row.expected)||row.expected<1)
   ||row.value!==null&&(!row.value||typeof row.value!=='object'||!Number.isSafeInteger(row.value.serial)||row.value.serial<1))throw new Error('E2EE_INVALID_LOCAL_BATCH');
  seen.add(row.key);rows.push(row);
 }
 return rows;
}
async function quota(signal?:AbortSignal){
 let estimate:StorageEstimate;
 try{estimate=snapshotE2eeValue(await navigator.storage.estimate());}
 catch{if(signal?.aborted)throw new Error('E2EE_UNLOCK_REQUIRED');throw new Error('E2EE_STORAGE_USAGE_UNAVAILABLE');}
 if(signal?.aborted)throw new Error('E2EE_UNLOCK_REQUIRED');
 const usageBytes=estimate.usage,quotaBytes=estimate.quota;
 if(typeof usageBytes!=='number'||typeof quotaBytes!=='number'||!Number.isSafeInteger(usageBytes)||!Number.isSafeInteger(quotaBytes)||usageBytes<0||quotaBytes<0)throw new Error('E2EE_STORAGE_USAGE_UNAVAILABLE');
 return{usageBytes,quotaBytes};
}

/** All real protected IDB writes pass here. The two store counts, serial checks,
 * deletion credits and writes share ONE durable transaction across both stores.
 * Only affected ciphertext rows are inspected for CAS/rewrite bytes. Counts do
 * not open any other owner's body or key bundle. Quota remains a snapshot. */
export async function commitE2eeIndexedDb<T extends {serial:number}>(database:Promise<IDBDatabase>,storeName:Store,input:readonly Mutation<T>[],signal?:AbortSignal){
 if(storeName!=='records'&&storeName!=='keyMaterial')throw new Error('E2EE_STORAGE_PROVIDER_REQUIRED');
 const changes=capture(input),prospective=changes.map(row=>row.value===null?null:wireBytes(row.key,row.value));
 if(signal?.aborted)throw new Error('E2EE_UNLOCK_REQUIRED');
 let db:IDBDatabase;try{db=await database;}catch{if(signal?.aborted)throw new Error('E2EE_UNLOCK_REQUIRED');throw new Error('E2EE_STORAGE_UNAVAILABLE');}
 if(signal?.aborted)throw new Error('E2EE_UNLOCK_REQUIRED');
 const measured=await quota(signal);if(signal?.aborted)throw new Error('E2EE_UNLOCK_REQUIRED');
 return new Promise<void>((resolve,reject)=>{
  const transaction=db.transaction(['records','keyMaterial'],'readwrite',{durability:'strict'}),store=transaction.objectStore(storeName);
  let remaining=changes.length+2,records=0,keyRecords=0,failure='';const previous:(number|null)[]=changes.map(()=>null);
  const abort=()=>{try{transaction.abort();}catch{/* A completed transaction is already durable. */}};
  const cleanup=()=>signal?.removeEventListener('abort',abort);
  signal?.addEventListener('abort',abort,{once:true});
  const ready=()=>{
   if(--remaining!==0||failure)return;
   try{
    if(signal?.aborted)throw new Error('E2EE_UNLOCK_REQUIRED');
    const growth=e2eeStorageWriteGrowth(changes.map((_,index)=>({nextBytes:prospective[index],previousBytes:previous[index]})));
    const usage={...measured,records:records-(storeName==='records'?growth.removed:0),keyRecords:keyRecords-(storeName==='keyMaterial'?growth.removed:0)};
    admitE2eeStorage(usage,{records:storeName==='records'?growth.added:0,keyRecords:storeName==='keyMaterial'?growth.added:0,writeBytes:growth.writeBytes,rewriteBytes:growth.rewriteBytes},E2EE_PROVIDER_STORAGE_BUDGET);
    for(const row of changes){if(row.value===null)store.delete(row.key);else store.put(row.value,row.key);}
   }catch(error){failure=error instanceof Error?error.message:'E2EE_STORAGE_UNAVAILABLE';abort();}
  };
  const recordCount=transaction.objectStore('records').count(),keyCount=transaction.objectStore('keyMaterial').count();
  recordCount.onsuccess=()=>{records=recordCount.result;ready();};keyCount.onsuccess=()=>{keyRecords=keyCount.result;ready();};
  changes.forEach((row,index)=>{
   // Cursor presence is distinct from the stored value. A malformed/undefined
   // existing row must never be mistaken for absence and silently replaced.
   const request=store.openCursor(IDBKeyRange.only(row.key));request.onsuccess=()=>{
    if(failure)return;
    try{
     const cursor=request.result,current=cursor?.value as T|undefined;
     if(cursor&&storeName==='keyMaterial'){failure='E2EE_DEVICE_ALREADY_EXISTS';abort();return;}
     if(cursor&&(!current||typeof current!=='object'||!Number.isSafeInteger(current.serial)||current.serial<1)){failure='E2EE_CORRUPT_LOCAL_RECORD';abort();return;}
     if((cursor?current!.serial:null)!==row.expected){failure='E2EE_LOCAL_CONFLICT';abort();return;}
     previous[index]=cursor?wireBytes(row.key,current):null;ready();
    }catch{failure='E2EE_STORAGE_USAGE_UNAVAILABLE';abort();}
   };
  });
  transaction.oncomplete=()=>{cleanup();if(signal?.aborted)reject(new Error('E2EE_UNLOCK_REQUIRED'));else resolve();};
  transaction.onabort=transaction.onerror=()=>{cleanup();reject(new Error(signal?.aborted?'E2EE_UNLOCK_REQUIRED':failure||'E2EE_STORAGE_UNAVAILABLE'));};
 }).catch(error=>{throw new Error(signal?.aborted?'E2EE_UNLOCK_REQUIRED':error instanceof Error&&failures.has(error.message)?error.message:'E2EE_STORAGE_UNAVAILABLE');});
}
