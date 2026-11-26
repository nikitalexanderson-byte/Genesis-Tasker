import {snapshotE2eeValue} from './commands.ts';
import {commitE2eeIndexedDb} from './indexeddb-write.ts';
import {exactKeys} from './keys.ts';
import {openE2eeDatabase} from './storage.ts';
import {E2EE_PROVIDER_STORAGE_BUDGET} from './storage-capacity.ts';
import {captureOriginalCustodyReference,originalCustodyPrefix,validateOriginalCustodyId,type OriginalCustodyArtifact,type OriginalCustodyReference,type OriginalCustodyStorage} from './original-custody.ts';

/** Existing keyMaterial store: actual provider-wide count/byte/quota admission
 * and create-only CAS. Never encrypted by, or dependent on, the old local root. */
export class IndexedDbOriginalCustodyStorage implements OriginalCustodyStorage {
 #database:Promise<IDBDatabase>;
 constructor(factory?:IDBFactory,database?:Promise<IDBDatabase>){this.#database=database??openE2eeDatabase(factory);}
 async create(ownerId:string,source:OriginalCustodyArtifact,assertCurrent:()=>void,inputReference:OriginalCustodyReference){
  const value=snapshotE2eeValue(source),reference=captureOriginalCustodyReference(inputReference),current=assertCurrent;
  if(reference.id!==value.id||reference.original.ownerId!==ownerId)throw new Error('E2EE_INVALID_ORIGINAL_CUSTODY');current();await validateOriginalCustodyId(ownerId,value.id);current();
  return commitE2eeIndexedDb(this.#database,'keyMaterial',[{key:value.id,expected:null,value:{serial:1,artifact:value,reference}}],undefined,current);
 }
 async get(ownerId:string,id:string,assertCurrent:()=>void):Promise<OriginalCustodyArtifact|null>{
  return (await this.#read(ownerId,id,assertCurrent))?.artifact??null;
 }
 async describe(ownerId:string,id:string,assertCurrent:()=>void):Promise<OriginalCustodyReference|null>{
  return (await this.#read(ownerId,id,assertCurrent))?.reference??null;
 }
 async #read(ownerId:string,id:string,assertCurrent:()=>void){
  const current=assertCurrent;current();await validateOriginalCustodyId(ownerId,id);current();const db=await this.#database;current();
  const result=await new Promise<{artifact:OriginalCustodyArtifact;reference:OriginalCustodyReference}|null>((resolve,reject)=>{
   const transaction=db.transaction('keyMaterial','readonly'),request=transaction.objectStore('keyMaterial').openCursor(IDBKeyRange.only(id));let row:{artifact:OriginalCustodyArtifact;reference:OriginalCustodyReference}|null=null,failure:unknown;
   request.onsuccess=()=>{try{current();const cursor=request.result;if(!cursor)return;const value=snapshotE2eeValue(cursor.value);exactKeys(value,['serial','artifact','reference']);
    if(value.serial!==1)throw new Error('E2EE_INVALID_ORIGINAL_CUSTODY');const reference=captureOriginalCustodyReference(value.reference as OriginalCustodyReference);
    if(reference.id!==id||reference.original.ownerId!==ownerId)throw new Error('E2EE_INVALID_ORIGINAL_CUSTODY');row={artifact:value.artifact as OriginalCustodyArtifact,reference};
   }catch(error){failure=error;transaction.abort();}};
   transaction.oncomplete=()=>resolve(row);transaction.onerror=transaction.onabort=()=>reject(failure??new Error('E2EE_STORAGE_UNAVAILABLE'));
  });current();return result;
 }
 async list(ownerId:string,assertCurrent:()=>void){
  const current=assertCurrent;current();const prefix=await originalCustodyPrefix(ownerId);current();const db=await this.#database;current();
  const result=await new Promise<string[]>((resolve,reject)=>{
   const transaction=db.transaction('keyMaterial','readonly'),request=transaction.objectStore('keyMaterial').openKeyCursor(IDBKeyRange.bound(prefix,prefix+'\uffff'));const ids:string[]=[];let failure:unknown;
   request.onsuccess=()=>{try{current();const cursor=request.result;if(!cursor)return;
    if(ids.length>=E2EE_PROVIDER_STORAGE_BUDGET.maximumKeyRecords||typeof cursor.key!=='string')throw new Error('E2EE_STORAGE_CAPACITY');ids.push(cursor.key);cursor.continue();
   }catch(error){failure=error;transaction.abort();}};
   transaction.oncomplete=()=>resolve(ids);transaction.onabort=transaction.onerror=()=>reject(failure??new Error('E2EE_STORAGE_UNAVAILABLE'));
  });current();for(const id of result){await validateOriginalCustodyId(ownerId,id);current();}return result;
 }
}
