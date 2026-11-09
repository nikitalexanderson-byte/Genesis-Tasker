export const SHARED_WORK_DRAFT_PREFIX='genesis-shared-work-drafts-v1:';
export type SharedWorkDraftPurpose='workflow'|'planning'|'planning-tasks'|'custom-fields'|'saved-views'|'templates'|'template-apply'|'automations'|'project-access'|'data-import'|'stoicheion-restoration';
const ID=/^[a-zA-Z0-9_-]{1,200}$/;
const MAX_RECORDS=20,MAX_BYTES=2_000_000;
type Sealed={iv:string;ciphertext:string};
type DeviceStorage=Pick<Storage,'length'|'key'|'getItem'|'setItem'|'removeItem'>;
/** Async stores compare expected bytes and enforce scope limits transactionally. */
export type AsyncWorkDraftStorage={
 keys:(prefix:string)=>Promise<string[]>;read:(key:string)=>Promise<string|null>;
 write:(key:string,raw:string,previous:string|null,prefix:string,limit:number,check:()=>void)=>Promise<void>;
 remove:(key:string,expected:string,check:()=>void)=>Promise<void>;
 subscribe?:(prefix:string,listener:()=>void)=>()=>void;dispose?:()=>void;
};
export type DraftCipher={check:()=>void;seal:(value:unknown,scope:string)=>Promise<Sealed>;open:(value:Sealed,scope:string)=>Promise<unknown>};
export type WorkDraft<T>={id:string;at:string;value:T;raw:string};
export class WorkDraftError extends Error{
 readonly record?:{id:string;raw:string};
 constructor(message:string,record?:{id:string;raw:string},options?:ErrorOptions){super(message,options);this.record=record;}
}
type JournalOptions<T>={storage:DeviceStorage;asyncStorage?:AsyncWorkDraftStorage;maxBytes?:number;access:DraftCipher;userId:string;projectId:string;purpose:SharedWorkDraftPurpose;validate:(value:unknown)=>T;writerId?:string;now?:()=>Date};
const object=(value:unknown):value is Record<string,unknown>=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);

/** Device-only encrypted drafts. Every mounted writer owns a distinct record. */
export class SharedWorkDraftJournal<T>{
 private readonly prefix:string;
 readonly writerId:string;
 private serial:Promise<unknown>=Promise.resolve();
 private stopped=false;
 private corrupt=false;
 private readonly options:JournalOptions<T>;
 constructor(options:JournalOptions<T>){
  this.options=options;
  this.writerId=options.writerId??crypto.randomUUID();
  if(![options.userId,options.projectId,this.writerId].every(id=>ID.test(id)))throw new WorkDraftError('DRAFT_SCOPE_INVALID');
  this.prefix=`${SHARED_WORK_DRAFT_PREFIX}${options.userId}:${options.projectId}:${options.purpose}:`;
 }
 private check(){if(this.stopped)throw new WorkDraftError('DRAFT_CLOSED');this.options.access.check();}
 private scope(id:string){return `shared-work-draft:${this.options.projectId}:${this.options.purpose}:${id}`;}
 private key(id:string){if(!ID.test(id))throw new WorkDraftError('DRAFT_SCOPE_INVALID');return this.prefix+id;}
 private async keys(){if(this.options.asyncStorage)return this.options.asyncStorage.keys(this.prefix);const storage=this.options.storage;return Array.from({length:storage.length},(_,index)=>storage.key(index)).filter((key):key is string=>key!==null&&key.startsWith(this.prefix));}
 private async stored(key:string){return this.options.asyncStorage?this.options.asyncStorage.read(key):this.options.storage.getItem(key);}
 private invalid(id:string,raw:string,cause?:unknown):never{this.corrupt=true;throw new WorkDraftError('DRAFT_INVALID',{id,raw},{cause});}
 private async read(id:string,raw:string):Promise<WorkDraft<T>>{
  this.check();let envelope:unknown;
  try{envelope=JSON.parse(raw);}catch(cause){return this.invalid(id,raw,cause);}
  if(!object(envelope)||envelope.version!==1||envelope.id!==id||typeof envelope.at!=='string'||!Number.isFinite(Date.parse(envelope.at))||typeof envelope.iv!=='string'||typeof envelope.ciphertext!=='string')return this.invalid(id,raw);
  let plain:unknown;
  try{plain=await this.options.access.open({iv:envelope.iv,ciphertext:envelope.ciphertext},this.scope(id));}catch(cause){this.check();return this.invalid(id,raw,cause);}
  this.check();
  if(!object(plain)||plain.version!==1||plain.userId!==this.options.userId||plain.projectId!==this.options.projectId||plain.purpose!==this.options.purpose||plain.id!==id||plain.at!==envelope.at)return this.invalid(id,raw);
  let value:T;try{value=this.options.validate(plain.value);}catch(cause){return this.invalid(id,raw,cause);}
  return {id,at:envelope.at,value,raw};
 }
 async list():Promise<WorkDraft<T>[]>{
  this.check();const records:WorkDraft<T>[]=[],keys=await this.keys();if(keys.length>MAX_RECORDS)throw new WorkDraftError('DRAFT_LIMIT');
  for(const key of keys){this.check();const raw=await this.stored(key);if(raw!==null)records.push(await this.read(key.slice(this.prefix.length),raw));}
  this.check();this.corrupt=false;return records.sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)||a.id.localeCompare(b.id));
 }
 /** Snapshot input before awaiting crypto; completion order cannot reorder edits. */
 write(input:T):Promise<WorkDraft<T>>{
  this.check();const value=this.options.validate(structuredClone(input)),json=JSON.stringify(value);
  if(typeof json!=='string'||new TextEncoder().encode(json).byteLength>(this.options.maxBytes??MAX_BYTES))throw new WorkDraftError('DRAFT_TOO_LARGE');
  const snapshot:unknown=JSON.parse(json);
  const work=this.serial.catch(()=>undefined).then(async()=>{
   this.check();if(this.corrupt)throw new WorkDraftError('DRAFT_RECOVERY_REQUIRED');
   const key=this.key(this.writerId),previous=await this.stored(key);this.check();
   if(previous!==null)await this.read(this.writerId,previous);
   else if((await this.keys()).length>=MAX_RECORDS)throw new WorkDraftError('DRAFT_LIMIT');
   const at=(this.options.now?.()??new Date()).toISOString();
   const sealed=await this.options.access.seal({version:1,userId:this.options.userId,projectId:this.options.projectId,purpose:this.options.purpose,id:this.writerId,at,value:snapshot},this.scope(this.writerId));
   this.check();const raw=JSON.stringify({version:1,id:this.writerId,at,...sealed});
   if(this.options.asyncStorage)await this.options.asyncStorage.write(key,raw,previous,this.prefix,MAX_RECORDS,()=>this.check());
   else {if(this.options.storage.getItem(key)!==previous)throw new WorkDraftError('DRAFT_CHANGED');this.options.storage.setItem(key,raw);}
   this.check();
   return {id:this.writerId,at,value:this.options.validate(snapshot),raw};
  });this.serial=work;return work;
 }
 /** Recovery never removes a record that another tab changed in the meantime. */
 remove(record:Pick<WorkDraft<T>,'id'|'raw'>):Promise<void>{
  const work=this.serial.catch(()=>undefined).then(async()=>{
   this.check();const key=this.key(record.id),raw=await this.stored(key);this.check();
   if(raw===null)return;if(raw!==record.raw)throw new WorkDraftError('DRAFT_CHANGED');
   if(this.options.asyncStorage)await this.options.asyncStorage.remove(key,record.raw,()=>this.check());
   else {if(this.options.storage.getItem(key)!==record.raw)throw new WorkDraftError('DRAFT_CHANGED');this.options.storage.removeItem(key);}
  });this.serial=work;return work;
 }
 async flush(){await this.serial;this.check();}
 subscribe(listener:()=>void){return this.options.asyncStorage?.subscribe?.(this.prefix,listener)??(()=>{});}
 dispose(){this.stopped=true;this.options.asyncStorage?.dispose?.();}
}
