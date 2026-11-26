import {reminderWebStorageKeys,REMINDER_WEB_UNASSIGNED_KEYS,classifyReminderWorkerRecord,type ReminderMigrationLocal} from './reminders-source.ts';
import {captureReminderMigrationEditors} from '../reminder-migration-memory.ts';

const names=['genesis-habit-push-receipts-v1','genesis-advice-push-receipts-v1','genesis-shared-push-receipts-v1'];
const MAX=48*1024*1024,encoder=new TextEncoder();
async function rawResponse(response:Response){
 if(!response.body)return'';const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const value=await reader.read();if(value.done)break;size+=value.value.byteLength;if(size>1024*1024){void reader.cancel().catch(()=>{});throw new Error('E2EE_SOURCE_TOO_LARGE');}chunks.push(value.value);}}
 finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const part of chunks){bytes.set(part,offset);offset+=part.length;}
 try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}finally{bytes.fill(0);}
}
/** Local-only capture. The product coordinator holds its durable owner/global
 * write barrier before calling this collector; opening a network source first
 * or treating a failed cache read as an empty cache is forbidden. */
export async function captureWebReminderInventory(ownerId:string,ports:{storage:Pick<Storage,'getItem'>;assertCurrent:()=>void;
 caches:Pick<CacheStorage,'has'|'open'>|null;notifications:()=>Promise<readonly {title:string;body:string;tag:string;lang:string;data:unknown;silent:boolean|null}[]>;
 projectionWanted:boolean}):Promise<ReminderMigrationLocal>{
 ports.assertCurrent();const entries=reminderWebStorageKeys(ownerId).map(key=>({store:'localStorage',key,value:ports.storage.getItem(key)}));
 const unassigned:ReminderMigrationLocal['unassigned']=[];
 const legacy=REMINDER_WEB_UNASSIGNED_KEYS.map(key=>({key,raw:ports.storage.getItem(key)}));for(const row of legacy)if(row.raw!==null)unassigned.push({source:'localStorage:'+row.key,raw:row.raw});
 const editors=captureReminderMigrationEditors(ownerId),records:ReminderMigrationLocal['worker']['records']=[];let size=0,count=0,found=false;
 const add=(row:{cache:string;url:string;raw:string})=>{
  size+=encoder.encode(row.raw).length;if(++count>10000||size>MAX)throw new Error('E2EE_SOURCE_TOO_LARGE');
  let attribution:'owned'|'foreign'|'unassigned';try{attribution=classifyReminderWorkerRecord(row,ownerId);}catch{attribution='unassigned';}
  if(attribution==='owned')records.push(row);else if(attribution==='unassigned')unassigned.push({source:row.cache+':'+row.url,raw:row.raw});
 };
 if(ports.caches)for(const name of names){ports.assertCurrent();if(!await ports.caches.has(name))continue;found=true;const cache=await ports.caches.open(name);ports.assertCurrent();
  for(const request of await cache.keys()){ports.assertCurrent();const response=await cache.match(request);if(!response)throw new Error('E2EE_REMINDER_CAPTURE_CHANGED');add({cache:name,url:request.url,raw:await rawResponse(response)});ports.assertCurrent();}
 }
 // Notification objects contain methods and native handles. Preserve only their
 // existing display/data payload; never close, acknowledge or recreate them.
 for(const notice of await ports.notifications()){ports.assertCurrent();found=true;
  const data=notice.data&&typeof notice.data==='object'?notice.data as Record<string,unknown>:{};
  add({cache:'displayed-reminders',url:'displayed:'+crypto.randomUUID(),raw:JSON.stringify({...notice,userId:data.userId})});}
 ports.assertCurrent();const after=captureReminderMigrationEditors(ownerId);
 if(JSON.stringify(after)!==JSON.stringify(editors)||entries.some(row=>ports.storage.getItem(row.key)!==row.value)||legacy.some(row=>ports.storage.getItem(row.key)!==row.raw))throw new Error('E2EE_REMINDER_CAPTURE_CHANGED');
 return{platform:'web',inventoryVersion:1,entries,room:[],editors,worker:{state:found?'captured':ports.caches?'absent':'unsupported',records},unassigned,projectionWanted:ports.projectionWanted};
}
