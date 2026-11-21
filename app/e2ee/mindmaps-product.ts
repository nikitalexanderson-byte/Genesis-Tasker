import {requirePrivateAccount} from './product-session.ts';
import {E2eePrivateDocument,type PrivateDocumentView} from './product-repository.ts';
import {readMigratedMindmaps} from './mindmaps-source.ts';
import {parseLegacyMigrationJson} from './legacy-json.ts';
import {validateMindmap,mapId,type Mindmap,type MapView} from '../mindmaps-model.ts';
import {currentFeatureAccess,requireQuotaGrowth} from '../feature-access.ts';
import {exactKeys,assertTechnical} from './keys.ts';
import type {Conversion,MapRecord,SaveState} from '../mindmaps-storage.ts';
type Entry={id:string;document:Mindmap|null;revision:number;deleted:boolean;updatedAt:string};
type State={protocol:1;ownerId:string;records:Entry[];versions:MapRecord[]};
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
/** Actual personal map editor storage. New conversion/view journals are
 * device-local ciphertext; old operation receipts never execute themselves. */
export class E2eeMindmapRepository{
 #account:ReturnType<typeof requirePrivateAccount>;#document:E2eePrivateDocument<State>;#view:PrivateDocumentView<State>|null=null;
 #serial:Promise<unknown>=Promise.resolve();#closed=false;#adopted=new Map<string,number>();#listeners=new Set<()=>void>();#owner:string;
 constructor(owner:string){
  this.#owner=owner;this.#account=requirePrivateAccount(owner);const {client,directory}=this.#account.personal();
  this.#document=new E2eePrivateDocument({device:this.#account.device,client,scopeId:directory.scopeId,domain:'mindmap',objectId:'personal-mindmaps-live-v1',
   assertCurrent:()=>this.check(),assertWrite:()=>this.check(),validate:input=>{
    exactKeys(input,['protocol','ownerId','records','versions']);if(input.protocol!==1||input.ownerId!==owner||!Array.isArray(input.records)||!Array.isArray(input.versions)||input.records.length>10000||input.versions.length>10000)throw new Error('E2EE_MINDMAPS_SOURCE_INVALID');
    const seen=new Set<string>();for(const row of input.records){exactKeys(row,['id','document','revision','deleted','updatedAt']);assertTechnical(row.id);
     if(seen.has(row.id)||!Number.isSafeInteger(row.revision)||row.revision<0||typeof row.deleted!=='boolean'||typeof row.updatedAt!=='string')throw new Error('E2EE_MINDMAPS_SOURCE_INVALID');seen.add(row.id);
     if(row.deleted){if(row.document!==null)throw new Error('E2EE_MINDMAPS_SOURCE_INVALID');}else if(validateMindmap(row.document).id!==row.id)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
    }
    for(const row of input.versions){exactKeys(row,['document','revision','updatedAt']);validateMindmap(row.document);if(!Number.isSafeInteger(row.revision)||row.revision<1||typeof row.updatedAt!=='string')throw new Error('E2EE_MINDMAPS_SOURCE_INVALID');}
    return input as State;
   }});
 }
 check(){if(this.#closed)throw new Error('E2EE_UNLOCK_REQUIRED');this.#account.requireOpen();}
 dispose(){this.#closed=true;this.#view=null;this.#adopted.clear();this.#listeners.clear();}
 #operation<T>(run:()=>Promise<T>):Promise<T>{const result=this.#serial.catch(()=>undefined).then(async()=>{this.check();return run();});this.#serial=result;return result;}
 async #load(refresh=false){
  this.check();if(this.#view&&!refresh)return this.#state();
  const online=this.#account.mode==='online'&&navigator.onLine;
  try{this.#view=await this.#document.load(online?'online':'offline');}
  catch(error){if(!online||!(error instanceof Error)||error.message!=='E2EE_PRIVATE_DOCUMENT_MISSING')throw error;
   const client=this.#account.personal().client,read=async(domain:'mindmap',id:string)=>{const row=await client.read(domain,id);this.check();if(!row)throw new Error('E2EE_MINDMAPS_SOURCE_INVALID');
    try{return parseLegacyMigrationJson(decoder.decode(row.bytes),'E2EE_MINDMAPS_SOURCE_INVALID',64*1024*1024);}finally{row.bytes.fill(0);}};
   const seed=await readMigratedMindmaps(read,id=>client.read('attachment',id),null,this.#owner);this.check();
   const value:State={protocol:1,ownerId:this.#owner,records:seed.records.map(row=>({...row,document:row.document?validateMindmap(row.document):null,updatedAt:row.document&&typeof row.document.updatedAt==='string'?row.document.updatedAt:new Date(0).toISOString()})),
    versions:seed.versions.map(row=>({document:validateMindmap(row.document),revision:Number(row.revision),updatedAt:String(row.updatedAt)}))};
   const serial=await this.#document.save(value,{serial:null,remoteRevision:0});this.#view={value,serial,remoteRevision:0,pending:true,conflict:null};
   await this.#flush();
  }return this.#state();
 }
 #state(){this.check();if(!this.#view)throw new Error('E2EE_PRODUCT_READ_REQUIRED');if(this.#view.conflict)throw new Error('E2EE_PRODUCT_CONFLICT_REVIEW_REQUIRED');return this.#view;}
 async #stage(value:State){const prior=this.#state(),serial=await this.#document.save(value,prior);this.#view={...prior,value,serial,pending:true};}
 async #flush(){const view=this.#state();if(!view.pending||this.#account.mode==='offline')return;
  await this.#document.flush();this.#view=await this.#document.load('offline');
  if(this.#view.pending||JSON.stringify(this.#view.value)!==JSON.stringify(view.value))throw new Error('E2EE_PRODUCT_CONFLICT_REVIEW_REQUIRED');
 }
 list():Promise<MapRecord[]>{return this.#operation(async()=>{const state=await this.#load(true);return state.value.records.filter(row=>!row.deleted).map(row=>({document:structuredClone(row.document!),revision:row.revision,updatedAt:row.updatedAt,pending:state.pending}));});}
 adopt(record:MapRecord){this.check();this.#adopted.set(record.document.id,record.revision);}
 save(input:Mindmap,status:(state:SaveState,message?:string)=>void){
  const snapshot=validateMindmap(structuredClone(input));status('saving');return this.#operation(async()=>{
   await this.#load();const prior=this.#state().value,old=prior.records.find(row=>row.id===snapshot.id);
   if(old?.deleted)throw new Error('E2EE_MINDMAP_DELETED');if((old?.revision??0)!==(this.#adopted.get(snapshot.id)??0))throw new Error('E2EE_PRODUCT_CONFLICT_REVIEW_REQUIRED');
   const count=prior.records.filter(row=>!row.deleted).length;requireQuotaGrowth(currentFeatureAccess(this.#owner),'mindmaps',count,count+(old?0:1));
   const updatedAt=new Date().toISOString(),revision=(old?.revision??0)+1;
   const next:State={...prior,records:[...prior.records.filter(row=>row.id!==snapshot.id),{id:snapshot.id,document:snapshot,revision,deleted:false,updatedAt}],
    versions:[...prior.versions,{document:snapshot,revision,updatedAt}]};
   await this.#stage(next);this.#adopted.set(snapshot.id,revision);status('device');status('pending');await this.#flush();if(this.#account.mode==='online')status('synced');
  }).catch(error=>{status(error instanceof Error&&error.message.includes('CONFLICT')?'conflict':'error');throw error;});
 }
 retry(_record:MapRecord,status:(state:SaveState,message?:string)=>void){return this.#operation(async()=>{await this.#load();status('pending');await this.#flush();if(this.#account.mode==='online')status('synced');}).catch(error=>{status('error');throw error;});}
 remove(record:MapRecord){return this.#operation(async()=>{await this.#load();const prior=this.#state().value,old=prior.records.find(row=>row.id===record.document.id);
  if(!old||old.deleted)return;if(old.revision!==record.revision)throw new Error('E2EE_PRODUCT_CONFLICT_REVIEW_REQUIRED');
  await this.#stage({...prior,records:prior.records.map(row=>row.id===old.id?{...row,document:null,deleted:true,revision:row.revision+1,updatedAt:new Date().toISOString()}:row)});await this.#flush();
 });}
 history(id:string){return this.#operation(async()=>{await this.#load();return this.#state().value.versions.filter(row=>row.document.id===id).map(row=>structuredClone(row));});}
 async forkDraft(input:Mindmap,status:(state:SaveState,message?:string)=>void){const copy=validateMindmap({...input,id:mapId(),title:`${input.title.slice(0,1900)} — сохранённый вариант`});await this.save(copy,status);return copy;}
 async #local<T>(id:string,change?:(prior:T|null)=>T){
  this.check();assertTechnical(id);const row=await this.#account.device.vault.read('draft',id);this.check();
  try{const prior=row?parseLegacyMigrationJson(decoder.decode(row.value),'E2EE_PRIVATE_DOCUMENT_CORRUPT',64*1024*1024) as T:null;
   if(!change)return prior;const next=change(prior),bytes=encoder.encode(JSON.stringify(next));
   try{await this.#account.device.ensureDurableKeys();this.check();await this.#account.device.vault.write([{domain:'draft',objectId:id,value:bytes,expected:row?.serial??null}]);this.check();return next;}finally{bytes.fill(0);}
  }finally{row?.value.fill(0);}
 }
 saveView(id:string,view:MapView){const input=structuredClone(view);return this.#operation(async()=>{await this.#local<MapView>(`mindmap-view:${id}`,prior=>({...input,viewport:input.viewport??prior?.viewport,positions:input.positions??prior?.positions}));});}
 view(id:string){return this.#operation(()=>this.#local<MapView>(`mindmap-view:${id}`));}
 journal(operation:Conversion){const input=structuredClone(operation);return this.#operation(async()=>{
  assertTechnical(input.mapId);assertTechnical(input.nodeId);assertTechnical(input.taskId);
  await this.#local<Conversion[]>(`mindmap-conversions:${input.mapId}`,prior=>[...(prior??[]).filter(row=>row.nodeId!==input.nodeId),input]);for(const listener of this.#listeners)listener();
 });}
 conversions(map:Mindmap){return this.#operation(async()=>await this.#local<Conversion[]>(`mindmap-conversions:${map.id}`)??[]);}
 subscribeJournal(listener:()=>void){this.#listeners.add(listener);return()=>{this.#listeners.delete(listener);};}
}
