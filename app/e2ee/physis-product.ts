import {E2eeFeatureDocument,type FeatureDocumentView} from './feature-document.ts';
import {E2eeDeviceDocument} from './device-document.ts';
import {requirePrivateAccount} from './product-session.ts';
import {exactKeys} from './keys.ts';
import {validatePhysisRecord} from '../physis/validation.ts';
import type {PhysisRecord,PhysisStore,SaveState} from '../physis/types.ts';
import type {PhysisMigrationStoreMemory,WireRecord} from '../physis/store.ts';
import type {BackupPayload} from '../backup-format.ts';
import {registerBackupSource} from '../backup-sources.ts';

type State={version:1;ownerId:string;records:{id:string;record:PhysisRecord|null;revision:number;deleted:boolean}[]};
function validate(input:unknown,owner:string):State{
 exactKeys(input,['version','ownerId','records']);if(input.version!==1||input.ownerId!==owner||!Array.isArray(input.records)||input.records.length>100000)throw new Error('E2EE_PHYSIS_SOURCE_INVALID');
 const ids=new Set<string>();for(const row of input.records){exactKeys(row,['id','record','revision','deleted']);
  if(typeof row.id!=='string'||!/^[a-f0-9-]{36}$/i.test(row.id)||ids.has(row.id)||!Number.isSafeInteger(row.revision)||Number(row.revision)<0||typeof row.deleted!=='boolean')throw new Error('E2EE_PHYSIS_SOURCE_INVALID');ids.add(row.id);
  if(row.deleted?row.record!==null:!validatePhysisRecord(row.record)||row.record.id!==row.id)throw new Error('E2EE_PHYSIS_SOURCE_INVALID');
 }return input as State;
}
/** Shared normal aggregate writer for the Physis editor and explicit restore. */
export function physisFeatureDocument(owner:string){return new E2eeFeatureDocument({ownerId:owner,domain:'physis',objectId:'personal-physis-live-v1',validate:value=>validate(value,owner),seed:async read=>{
 const index=await read('personal-physis-index-v1');exactKeys(index,['protocol','ownerId','records']);if(index.protocol!==1||index.ownerId!==owner||!Array.isArray(index.records))throw new Error('E2EE_PHYSIS_SOURCE_INVALID');const records:State['records']=[],objects=new Set<string>();
 for(const item of index.records){exactKeys(item,['id','objectId','deleted']);if(typeof item.objectId!=='string'||!/^personal-physis-record:[a-f0-9-]{36}$/.test(item.objectId)||objects.has(item.objectId))throw new Error('E2EE_PHYSIS_SOURCE_INVALID');objects.add(item.objectId);const row=await read(item.objectId);exactKeys(row,['protocol','ownerId','id','record','revision','deleted']);if(row.protocol!==1||row.ownerId!==owner||row.id!==item.id||row.deleted!==item.deleted)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');records.push({id:row.id as string,record:row.record as PhysisRecord|null,revision:row.revision as number,deleted:row.deleted as boolean});}
 return validate({version:1,ownerId:owner,records},owner);
 }});}
/** A real Physis store over the foreground private account. Existing health
 * validators remain authoritative. Pending edits, deletions and form drafts are
 * durable before the editor acknowledges a save; no account-key vault is used. */
export class E2eePhysisMemoryStore{
 readonly privateStorage=true;readonly rotationPending=false;#closed=false;#account:ReturnType<typeof requirePrivateAccount>;
 #document:E2eeFeatureDocument<State>;#view:FeatureDocumentView<State>|null=null;#serial:Promise<unknown>=Promise.resolve();#listeners=new Set<()=>void>();#state:PhysisStore;
 #editors=new Map<string,()=>unknown>();#detached=new Map<string,unknown>();#unregister:()=>void;#forms:E2eeDeviceDocument<{version:1;ownerId:string;editors:{id:string;value:unknown}[]}>;
 constructor(readonly owner:string){
  this.#account=requirePrivateAccount(owner);
  this.#document=physisFeatureDocument(owner);
  this.#forms=new E2eeDeviceDocument(this.#account.device,'personal-physis-editor-forms-v1',value=>{exactKeys(value,['version','ownerId','editors']);
   if(value.version!==1||value.ownerId!==owner||!Array.isArray(value.editors)||value.editors.length>10000)throw new Error('E2EE_PHYSIS_SOURCE_INVALID');
   const ids=new Set<string>();for(const row of value.editors){exactKeys(row,['id','value']);if(typeof row.id!=='string'||ids.has(row.id))throw new Error('E2EE_PHYSIS_SOURCE_INVALID');ids.add(row.id);}
   return value as {version:1;ownerId:string;editors:{id:string;value:unknown}[]};},()=>this.assertCurrent());
  this.#state={records:[],status:'saved',error:'',save:record=>this.#save([record]),saveMany:records=>this.#save(records),remove:id=>this.#remove(id),reload:()=>this.reload()};
  this.#unregister=registerBackupSource('physis',{owner,capture:()=>{this.assertCurrent();return{records:structuredClone(this.#state.records),pending:this.hasPending?1:0,execution:'content-only'};}});
 }
 assertCurrent(){if(this.#closed)throw new Error('PHYSIS_LOCKED');this.#account.requireOpen();if(requirePrivateAccount(this.owner)!==this.#account)throw new Error('E2EE_ACCOUNT_CHANGED');}
 subscribe=(listener:()=>void)=>{this.#listeners.add(listener);return()=>{this.#listeners.delete(listener);};};
 getSnapshot=()=>this.#state;
 get hasPending(){return this.#view?.pending??false;}
 #publish(status:SaveState,error=''){this.assertCurrent();this.#state={...this.#state,status,error,records:this.#view?.document.records.filter(row=>!row.deleted).map(row=>structuredClone(row.record!))??[]};for(const listener of this.#listeners)listener();}
 #operation<T>(run:()=>Promise<T>):Promise<T>{const task=this.#serial.catch(()=>undefined).then(async()=>{this.assertCurrent();return run();});this.#serial=task;return task.catch(error=>{
  if(!this.#closed){try{this.#publish(error instanceof Error&&error.message.includes('CONFLICT')?'conflict':'error',error instanceof Error?error.message:'E2EE_PRIVATE_CONTENT_UNAVAILABLE');}catch{/* The retired account cannot publish a late completion. */}}throw error;
 });}
 async #load(refresh=false){if(!this.#view||refresh)this.#view=await this.#document.read(refresh);this.assertCurrent();return this.#view;}
 async #flush(){const view=await this.#load();if(view.conflict)throw new Error('E2EE_PRODUCT_CONFLICT_REVIEW_REQUIRED');this.#view=await this.#document.flush();this.#publish(this.#view.pending?'offline':'saved');}
 reload(){return this.#operation(async()=>{await this.#load(true);this.#publish(this.#view!.conflict?'conflict':this.hasPending?'offline':'saved');});}
 flush=()=>this.#operation(()=>this.#flush());
 #save(input:PhysisRecord[]){const records=structuredClone(input);return this.#operation(async()=>{
  if(new Set(records.map(row=>row.id)).size!==records.length||records.some(row=>!validatePhysisRecord(row)))throw new Error('E2EE_PHYSIS_SOURCE_INVALID');
  const view=await this.#load();if(view.conflict)throw new Error('E2EE_PRODUCT_CONFLICT_REVIEW_REQUIRED');const next=structuredClone(view.document);
  for(const record of records){const old=next.records.find(row=>row.id===record.id);if(old?.deleted)throw new Error('E2EE_PHYSIS_DELETED');
   const row={id:record.id,record,revision:(old?.revision??0)+1,deleted:false};if(old)Object.assign(old,row);else next.records.push(row);}
  this.#view=await this.#document.write(validate(next,this.owner));this.#publish('saving');await this.#persistForms();await this.#flush();
 });}
 #remove(id:string){return this.#operation(async()=>{const view=await this.#load();if(view.conflict)throw new Error('E2EE_PRODUCT_CONFLICT_REVIEW_REQUIRED');const next=structuredClone(view.document),row=next.records.find(item=>item.id===id);
  if(!row||row.deleted)return;row.record=null;row.deleted=true;row.revision++;this.#view=await this.#document.write(next);this.#publish('saving');await this.#flush();});}
 async #persistForms(){this.assertCurrent();const prior=await this.#forms.load();this.assertCurrent();const rows=new Map((prior?.value.editors??[]).map(row=>[row.id,row.value]));
  for(const [id,value]of this.#detached)rows.set(id,structuredClone(value));for(const [id,capture]of this.#editors)rows.set(id,structuredClone(capture()));
  await this.#forms.save({version:1,ownerId:this.owner,editors:[...rows].map(([id,value])=>({id,value}))},prior?.serial??null);this.assertCurrent();}
 registerMigrationEditor(capture:()=>unknown){this.assertCurrent();const id=crypto.randomUUID();this.#editors.set(id,capture);return()=>{
  if(!this.#editors.has(id))return;if(!this.#closed)this.#detached.set(id,structuredClone(capture()));this.#editors.delete(id);
  if(!this.#closed)void this.#operation(()=>this.#persistForms()).catch(()=>undefined);
 };}
 async withEditorTask<T>(run:()=>Promise<T>){this.assertCurrent();const result=await run();this.assertCurrent();await this.#operation(()=>this.#persistForms());return result;}
 captureMigrationMemory():Promise<PhysisMigrationStoreMemory>{return Promise.reject(new Error('E2EE_ALREADY_ACTIVE'));}
 exportWire():Promise<WireRecord[]>{return Promise.reject(new Error('E2EE_CONTENT_BACKUP_REQUIRED'));}
 captureBackup(){return this.#operation(async():Promise<BackupPayload>=>{const view=await this.#load();await this.#persistForms();const forms=await this.#forms.load(),at=new Date().toISOString();
  return{schema:1,backupId:crypto.randomUUID(),source:'device_snapshot',ownerId:this.owner,createdAt:at,client:'web',billingEvidence:null,sections:[{
   id:'physis',source:'device',completeness:'available',capturedAt:at,revision:view.remoteRevision,count:this.#state.records.length,pending:view.pending?1:0,notices:[],
   data:{format:'genesis-private-physis-content-v1',records:structuredClone(this.#state.records),variants:structuredClone(view.conflict?.document??null),forms:forms?.value.editors??[],execution:'content-only'}}]};
 });}
 discardAndReload(){return this.#operation(async()=>{const view=await this.#load(true);if(!view.conflict)throw new Error('E2EE_PRODUCT_CONFLICT_REVIEW_REQUIRED');
  // Retain the local selection under the device root before explicit adoption.
  this.#detached.set(`conflict:${crypto.randomUUID()}`,{source:'physis-conflict',state:view.document});await this.#persistForms();
  this.#view=await this.#document.resolve(view.conflict.document,view.conflict.revision);await this.#flush();});}
 destroy(){if(this.#closed)return;this.#closed=true;this.#unregister();this.#view=null;this.#editors.clear();this.#detached.clear();this.#state={...this.#state,records:[],error:'',status:'saved'};for(const listener of this.#listeners)listener();this.#listeners.clear();}
}
