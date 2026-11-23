import {E2eePrivateDocument,type PrivateDocumentView} from './product-repository.ts';
import {validateMigrationTask} from './tasks-source.ts';
import {assertTechnical,exactKeys} from './keys.ts';
import type {WebPrivateAccount} from './product-session.ts';

type Row=Record<string,unknown>;
export type PrivatePersonalTasks={protocol:1;ownerId:string;tasks:{id:string;value:ReturnType<typeof validateMigrationTask>|null;deleted:boolean}[];externalCopy:'requires-new-consent'};
type PersonalState={protocol:1;ownerId:string;contentRevision:number;workspace:Row;tasks:PrivatePersonalTasks};
export function validatePrivatePersonalTasks(input:unknown,ownerId:string):PrivatePersonalTasks{
 exactKeys(input,['protocol','ownerId','tasks','externalCopy']);
 if(input.protocol!==1||input.ownerId!==ownerId||input.externalCopy!=='requires-new-consent'||!Array.isArray(input.tasks)||input.tasks.length>100000)throw new Error('E2EE_PRIVATE_DOCUMENT_CORRUPT');
 const ids=new Set<string>();for(const row of input.tasks){exactKeys(row,['id','value','deleted']);if(typeof row.id!=='string'||ids.has(row.id)||typeof row.deleted!=='boolean')throw new Error('E2EE_PRIVATE_DOCUMENT_CORRUPT');ids.add(row.id);
  if(row.deleted){if(row.value!==null)throw new Error('E2EE_PRIVATE_DOCUMENT_CORRUPT');}else if(validateMigrationTask(row.value).id!==row.id)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
 }return input as PrivatePersonalTasks;
}
function workspace(input:unknown):Row{
 if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('E2EE_PRIVATE_DOCUMENT_CORRUPT');const row=input as Row;
 for(const name of ['projects','categories','taskListLinks','taskLists'])if(!Array.isArray(row[name])||(row[name] as unknown[]).length>100000)throw new Error('E2EE_PRIVATE_DOCUMENT_CORRUPT');
 if(['user','csrf','key','rawKey','recoveryCode','billing','entitlements','devices','tasks'].some(name=>Object.hasOwn(row,name)))throw new Error('E2EE_PRIVATE_DOCUMENT_CORRUPT');return row;
}
/** One CAS transaction covers the user's workspace, tasks and tombstones.
 * Migration objects stay immutable, readable seeds. A fresh normal-operation
 * object is created only from both authenticated, complete migration documents;
 * a missing/failed read can never initialize an empty account. */
export class E2eePersonalProduct{
 readonly ownerId:string;#account:WebPrivateAccount;#document:E2eePrivateDocument<PersonalState>;
 #view:PrivateDocumentView<PersonalState>|null=null;#serial:Promise<unknown>=Promise.resolve();
 constructor(account:WebPrivateAccount){
  this.#account=account;this.ownerId=account.ownerId;const {client,directory}=account.personal();assertTechnical(directory.scopeId);
  const current=()=>account.requireOpen(),write=()=>{current();const device=account.personal().directory.devices.get(account.device.deviceId);
   if(!device||device.revoked||device.userId!==account.ownerId||device.role!=='owner')throw new Error('E2EE_SCOPE_FORBIDDEN');};
  this.#document=new E2eePrivateDocument({device:account.device,client,scopeId:directory.scopeId,domain:'workspace',objectId:'personal-product-live-v1',assertCurrent:current,assertWrite:write,
   validate:(input:unknown)=>{exactKeys(input,['protocol','ownerId','contentRevision','workspace','tasks']);if(input.protocol!==1||input.ownerId!==this.ownerId)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
    if(!Number.isSafeInteger(input.contentRevision)||(input.contentRevision as number)<1)throw new Error('E2EE_PRIVATE_DOCUMENT_CORRUPT');
    return{protocol:1,ownerId:this.ownerId,contentRevision:input.contentRevision as number,workspace:workspace(input.workspace),tasks:validatePrivatePersonalTasks(input.tasks,this.ownerId)};}});
 }
 #operation<T>(run:()=>Promise<T>):Promise<T>{const work=this.#serial.catch(()=>undefined).then(async()=>{this.#account.requireOpen();return run();});this.#serial=work;return work;}
 #state(){this.#account.requireOpen();if(!this.#view||this.#view.conflict)throw new Error(this.#view?.conflict?'E2EE_PRODUCT_CONFLICT_REVIEW_REQUIRED':'E2EE_PRODUCT_READ_REQUIRED');return this.#view;}
 snapshot():Row&{tasks:(ReturnType<typeof validateMigrationTask>&{syncToGoogle:boolean;syncAccountIds:string[]})[]}{const value=this.#state().value;return{...structuredClone(value.workspace),tasks:value.tasks.tasks.filter(row=>!row.deleted).map(row=>({...structuredClone(row.value!),syncToGoogle:false,syncAccountIds:[]}))};}
 async load(mode:'online'|'offline'='online'){
  return this.#operation(async()=>{
   try{this.#view=await this.#document.load(mode);}
   catch(error){
    if(mode!=='online'||!(error instanceof Error)||error.message!=='E2EE_PRIVATE_DOCUMENT_MISSING')throw error;
    const {client}=this.#account.personal(),original=await client.read('workspace','personal-workspace-v1'),tasks=await client.read('workspace','personal-tasks-live-v1');this.#account.requireOpen();
    try{
     if(!original||!tasks)throw new Error('E2EE_PRODUCT_MIGRATION_CONTENT_REQUIRED');
     const {parseLegacyMigrationJson}=await import('./legacy-json.ts'),decode=(bytes:Uint8Array)=>parseLegacyMigrationJson(new TextDecoder('utf-8',{fatal:true}).decode(bytes),'E2EE_PRIVATE_DOCUMENT_CORRUPT',64*1024*1024);
     const value:PersonalState={protocol:1,ownerId:this.ownerId,contentRevision:1,workspace:workspace(decode(original.bytes)),tasks:validatePrivatePersonalTasks(decode(tasks.bytes),this.ownerId)};
     // Persist the exact seed before sending. A concurrent initializer loses
     // its CAS; it retains its draft and must explicitly reload/reconcile.
     const serial=await this.#document.save(value,{serial:null,remoteRevision:0});this.#view={value,serial,remoteRevision:0,pending:true,conflict:null};
     await this.#document.flush();this.#view=await this.#document.load('offline');
     if(this.#view.pending||JSON.stringify(this.#view.value)!==JSON.stringify(value))throw new Error('E2EE_PRODUCT_CONFLICT_REVIEW_REQUIRED');
    }finally{original?.bytes.fill(0);tasks?.bytes.fill(0);}
   }
   const value=this.#state();return{workspace:structuredClone(value.value.workspace),tasks:this.snapshot().tasks,
    deletedTaskIds:value.value.tasks.tasks.filter(row=>row.deleted).map(row=>row.id),pending:value.pending};
  });
 }
 async #stage(next:PersonalState,onQueued?:()=>void){const prior=this.#state();next={...next,contentRevision:prior.value.contentRevision+1};if(!Number.isSafeInteger(next.contentRevision))throw new Error('E2EE_PRIVATE_DOCUMENT_CORRUPT');const serial=await this.#document.save(next,prior);
  this.#view={...prior,value:next,serial,pending:true};onQueued?.();}
 async #flush(){const prior=this.#state();if(this.#account.mode==='offline')return prior.remoteRevision;if(prior.pending){
  await this.#document.flush();this.#view=await this.#document.load('offline');
  if(this.#view.pending||JSON.stringify(this.#view.value)!==JSON.stringify(prior.value))throw new Error('E2EE_PRODUCT_CONFLICT_REVIEW_REQUIRED');
 }return this.#state().remoteRevision;}
 /** Used by real UI persistence, including timers and offline task edits.
  * Every acknowledged snapshot is encrypted before the returned promise ends. */
 stageSnapshot(input:unknown,expectedContentRevision?:number,flush=false){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('E2EE_PRIVATE_DOCUMENT_CORRUPT');const copy=structuredClone(input) as Row,tasks=copy.tasks;delete copy.tasks;const state=workspace(copy);
  if(!Array.isArray(tasks))throw new Error('E2EE_PRIVATE_DOCUMENT_CORRUPT');const values=tasks.map(validateMigrationTask);
  if(new Set(values.map(value=>value.id)).size!==values.length)throw new Error('E2EE_PRIVATE_DOCUMENT_CORRUPT');
  return this.#operation(async()=>{const previous=this.#state().value,ids=new Set(values.map(value=>value.id));
   if(expectedContentRevision!==undefined&&previous.contentRevision!==expectedContentRevision)throw new Error('E2EE_RESTORE_REVIEW_STALE');
   if(previous.tasks.tasks.some(row=>row.deleted&&ids.has(row.id)))throw new Error('TASK_DELETED');
   const next:PersonalState={...previous,workspace:state,tasks:{...previous.tasks,tasks:[...values.map(value=>({id:String(value.id),value,deleted:false})),
    ...previous.tasks.tasks.filter(row=>!ids.has(row.id)).map(row=>({id:row.id,value:null,deleted:true}))]}};
   await this.#stage(next);if(flush)await this.#flush();
  });
 }
 restoreSnapshot(input:unknown,expectedContentRevision:number){return this.stageSnapshot(input,expectedContentRevision,true);}
 restoreView(){const state=this.#state();return{snapshot:this.snapshot(),contentRevision:state.value.contentRevision,deletedTaskIds:state.value.tasks.tasks.filter(row=>row.deleted).map(row=>row.id),pending:state.pending};}
 saveWorkspace(input:Row,onQueued?:()=>void){const state=workspace(structuredClone(input));return this.#operation(async()=>{await this.#stage({...this.#state().value,workspace:state},onQueued);return this.#flush();});}
 saveTask(input:unknown,createOnly=false,onQueued?:()=>void){const value=validateMigrationTask(structuredClone(input));return this.#operation(async()=>{
  const prior=this.#state().value,previous=prior.tasks.tasks.find(row=>row.id===value.id);
  if(previous?.deleted)throw new Error('TASK_DELETED');if(createOnly&&previous)throw new Error('TASK_ALREADY_EXISTS');
  await this.#stage({...prior,tasks:{...prior.tasks,tasks:[...prior.tasks.tasks.filter(row=>row.id!==value.id),{id:String(value.id),value,deleted:false}]}},onQueued);
  await this.#flush();return{...value,syncToGoogle:false,syncAccountIds:[]};
 });}
 removeTask(id:string,onQueued?:()=>void){return this.#operation(async()=>{const prior=this.#state().value,previous=prior.tasks.tasks.find(row=>row.id===id);
  if(!previous)throw new Error('E2EE_TASK_OBJECT_MISSING');if(!previous.deleted)await this.#stage({...prior,tasks:{...prior.tasks,tasks:prior.tasks.tasks.map(row=>row.id===id?{id,value:null,deleted:true}:row)}},onQueued);await this.#flush();
 });}
 flush(){return this.#operation(()=>this.#flush());}
}
