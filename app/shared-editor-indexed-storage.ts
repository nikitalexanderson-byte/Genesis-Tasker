import {privateDeviceAccessBlocked} from './local-sign-out.ts';
import {WorkDraftError,type AsyncWorkDraftStorage} from './shared-work-draft-journal.ts';

const DATABASE='genesis-shared-editors-v1',STORE='entries',SIGNAL='genesis-shared-editor-draft-signal-v1';
export const SHARED_EDITOR_DRAFT_MAX_BYTES=20_000_000;
let generation=0;
const listeners=new Set<(key:string)=>void>();
const range=(prefix:string)=>IDBKeyRange.bound(prefix,prefix+'\uffff');
const failure=()=>new WorkDraftError('DRAFT_STORAGE_UNAVAILABLE');
function openDatabase():Promise<IDBDatabase>{
 return new Promise((resolve,reject)=>{
  let blocked=false;const request=indexedDB.open(DATABASE,1);
  request.onupgradeneeded=()=>request.result.createObjectStore(STORE);
  request.onerror=()=>reject(request.error??failure());
  request.onblocked=()=>{blocked=true;reject(failure());};
  request.onsuccess=()=>{if(blocked)request.result.close();else {request.result.onversionchange=()=>request.result.close();resolve(request.result);}};
 });
}
/** Only encrypted envelopes live in IDB; legacy records remain until explicit recovery. */
export function sharedEditorIndexedStorage(legacy:Pick<Storage,'length'|'key'|'getItem'|'setItem'|'removeItem'>):AsyncWorkDraftStorage{
 const epoch=generation;let stopped=false,connection:Promise<IDBDatabase>|null=null;
 const subscriptions=new Set<(key:string)=>void>();let channel:BroadcastChannel|null=null;
 try{if(typeof BroadcastChannel!=='undefined')channel=new BroadcastChannel(DATABASE);}catch{/* Storage events also carry invalidation. */}
 const check=()=>{if(stopped||epoch!==generation||privateDeviceAccessBlocked())throw failure();};
 const legacyKeys=(prefix:string)=>Array.from({length:legacy.length},(_,i)=>legacy.key(i)).filter((k):k is string=>k!==null&&k.startsWith(prefix));
 const database=async()=>{check();connection??=openDatabase().catch(error=>{connection=null;throw error;});const db=await connection;check();return db;};
 async function transaction<T>(mode:IDBTransactionMode,guard:()=>void,run:(store:IDBObjectStore,result:(v:T)=>void,abort:(error:unknown)=>void)=>void):Promise<T>{
  guard();const db=await database();check();guard();
  return new Promise((resolve,reject)=>{
   let tx:IDBTransaction;try{tx=db.transaction(STORE,mode);}catch(error){reject(error);return;}
   let value:T,reason:unknown;
   const abort=(error:unknown)=>{reason=error;try{tx.abort();}catch{reject(error);}};
   tx.oncomplete=()=>{try{check();guard();resolve(value);}catch(error){reject(error);}};
   tx.onabort=tx.onerror=()=>reject(reason??tx.error??failure());
   try{run(tx.objectStore(STORE),v=>{value=v;},abort);}catch(error){abort(error);}
  });
 }
 const publish=(key:string)=>{
  // Notification failures never change the outcome of an already durable commit.
  for(const listener of listeners)try{listener(key);}catch{/* Best-effort invalidation. */}
  try{channel?.postMessage(key);}catch{/* Fall back to storage events. */}
  try{legacy.setItem(SIGNAL,JSON.stringify({key,id:crypto.randomUUID()}));legacy.removeItem(SIGNAL);}catch{/* Persistence was already confirmed. */}
 };
 const receive=(key:unknown)=>{if(typeof key==='string')for(const listener of subscriptions)try{listener(key);}catch{/* Best-effort invalidation. */}};
 if(channel)channel.onmessage=event=>receive(event.data);
 const storage=(event:StorageEvent)=>{if(event.key===SIGNAL&&event.newValue)try{receive(JSON.parse(event.newValue).key);}catch{/* Ignore malformed signals. */}};
 if(typeof window!=='undefined')window.addEventListener('storage',storage);
 return {
  async keys(prefix){const keys=await transaction<IDBValidKey[]>('readonly',check,(store,result)=>{const read=store.getAllKeys(range(prefix));read.onsuccess=()=>result(read.result);});return [...new Set([...keys.filter((k):k is string=>typeof k==='string'),...legacyKeys(prefix)])];},
  async read(key){return transaction<string|null>('readonly',check,(store,result,abort)=>{const read=store.get(key);read.onsuccess=()=>{try{const old=legacy.getItem(key);if(read.result!==undefined&&typeof read.result!=='string')throw failure();if(read.result!==undefined&&old!==null&&read.result!==old)throw new WorkDraftError('DRAFT_CHANGED');result(read.result??old);}catch(error){abort(error);}};});},
  async write(key,raw,previous,prefix,limit,guard){
   await transaction<void>('readwrite',guard,(store,result,abort)=>{
    const read=store.get(key);read.onsuccess=()=>{try{
     check();guard();if(!key.startsWith(prefix)||legacy.getItem(key)!==null||(read.result??null)!==previous)throw new WorkDraftError('DRAFT_CHANGED');
     const keys=store.getAllKeys(range(prefix));keys.onsuccess=()=>{try{
      check();guard();const all=new Set([...keys.result,...legacyKeys(prefix)]);if(!all.has(key)&&all.size>=limit)throw new WorkDraftError('DRAFT_LIMIT');
      store.put(raw,key);result(undefined);
     }catch(error){abort(error);}};
    }catch(error){abort(error);}};
   });publish(key);
  },
  async remove(key,expected,guard){
   const fromLegacy=await transaction<boolean>('readwrite',guard,(store,result,abort)=>{
    const read=store.get(key);read.onsuccess=()=>{try{check();guard();if(read.result===undefined){result(true);return;}if(read.result!==expected)throw new WorkDraftError('DRAFT_CHANGED');store.delete(key);result(false);}catch(error){abort(error);}};
   });
   check();guard();if(fromLegacy){const old=legacy.getItem(key);if(old!==null&&old!==expected)throw new WorkDraftError('DRAFT_CHANGED');if(old!==null)legacy.removeItem(key);}publish(key);
  },
  subscribe(prefix,listener){const scoped=(key:string)=>{if(key.startsWith(prefix))listener();};listeners.add(scoped);subscriptions.add(scoped);return()=>{listeners.delete(scoped);subscriptions.delete(scoped);};},
  dispose(){stopped=true;channel?.close();channel=null;for(const listener of subscriptions)listeners.delete(listener);subscriptions.clear();if(typeof window!=='undefined')window.removeEventListener('storage',storage);void connection?.then(db=>db.close()).catch(()=>undefined);},
 };
}

/** Invalidate pending writers before clearing every encrypted editor record. */
export async function clearSharedEditorDraftStorage(){
 generation++;if(typeof indexedDB==='undefined')return;
 const db=await openDatabase();
 try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).clear();tx.oncomplete=()=>resolve();tx.onerror=tx.onabort=()=>reject(tx.error??failure());});}finally{db.close();}
}
