import {requirePrivateAccount} from './product-session.ts';
import {privateSharedRequest} from './shared-web-live.ts';
import {E2eeDeviceDocument} from './device-document.ts';
import {assertTechnical,exactKeys} from './keys.ts';
import {validateMindmap,mapId,type Mindmap,type MapView} from '../mindmaps-model.ts';
import type {Conversion,MapRecord,SaveState} from '../mindmaps-storage.ts';

type Draft={protocol:1;ownerId:string;spaceId:string;id:string;document:Mindmap;expectedRevision:number;staged:boolean;complete:boolean;createdAt:string};
/** The existing shared editor uses actual signed record transactions. Device
 * drafts/view/conversion content has no legacy account-key/storage fallback. */
export class E2eeSharedMindmapRepository{
 #account:ReturnType<typeof requirePrivateAccount>;#closed=false;#serial:Promise<unknown>=Promise.resolve();#revisions=new Map<string,number>();#listeners=new Set<()=>void>();
 constructor(private readonly owner:string,private readonly spaceId:string){assertTechnical(spaceId);this.#account=requirePrivateAccount(owner);}
 check(){if(this.#closed)throw new Error('E2EE_UNLOCK_REQUIRED');this.#account.requireOpen();if(requirePrivateAccount(this.owner)!==this.#account)throw new Error('E2EE_ACCOUNT_CHANGED');}
 dispose(){this.#closed=true;this.#revisions.clear();this.#listeners.clear();}
 #run<T>(run:()=>Promise<T>){const task=this.#serial.catch(()=>undefined).then(async()=>{this.check();return run();});this.#serial=task;return task;}
 #draft(id:string){return new E2eeDeviceDocument<Draft>(this.#account.device,`shared-map-draft:${this.spaceId}:${id}`,input=>{
  exactKeys(input,['protocol','ownerId','spaceId','id','document','expectedRevision','staged','complete','createdAt']);assertTechnical(input.id);if(input.protocol!==1||input.ownerId!==this.owner||input.spaceId!==this.spaceId||input.id!==id||!Number.isSafeInteger(input.expectedRevision)||Number(input.expectedRevision)<0||typeof input.staged!=='boolean'||typeof input.complete!=='boolean'||typeof input.createdAt!=='string')throw new Error('E2EE_MINDMAPS_SOURCE_INVALID');return{...input,document:validateMindmap(input.document)} as Draft;
 },()=>this.check());}
 async #drafts(){const prefix=`shared-map-draft:${this.spaceId}:`,ids=await this.#account.device.vault.listLocal('draft',prefix);this.check();const rows=[];
  for(const key of ids){const saved=await this.#draft(key.slice(prefix.length)).load();this.check();if(!saved)throw new Error('E2EE_PRIVATE_DOCUMENT_CORRUPT');rows.push(saved);}return rows.sort((a,b)=>a.value.createdAt.localeCompare(b.value.createdAt)||a.value.id.localeCompare(b.value.id));
 }
 async #request(path:string,init:RequestInit={}){this.check();const value=await privateSharedRequest(this.owner,`/shared/spaces/${encodeURIComponent(this.spaceId)}/mindmaps${path}`,init);this.check();return value;}
 list(){return this.#run(async()=>{const response=await this.#request(''),records=(response.maps as Record<string,unknown>[]).map(row=>{const document=validateMindmap(row.document);if(!Number.isSafeInteger(row.revision)||Number(row.revision)<1)throw new Error('E2EE_MINDMAPS_SOURCE_INVALID');return{document,revision:Number(row.revision),updatedAt:String(row.updatedAt)};});
  const drafts=(await this.#drafts()).filter(row=>!row.value.complete).map(row=>({document:row.value.document,revision:row.value.expectedRevision+(row.value.staged?1:0),updatedAt:row.value.createdAt,pending:true,draftKey:row.value.id}));return[...drafts,...records];
 });}
 adopt(record:MapRecord){this.check();this.#revisions.set(record.document.id,record.revision);}
 async #deliver(draft:Draft,serial:number){const response=await this.#request('/'+encodeURIComponent(draft.document.id),{method:'PUT',body:JSON.stringify({document:draft.document,expectedRevision:draft.expectedRevision,operationId:draft.id,schemaVersion:1})});
  const revision=Number(response.revision);if(!Number.isSafeInteger(revision)||revision!==draft.expectedRevision+1)throw new Error('E2EE_INVALID_RECEIPT');this.#revisions.set(draft.document.id,revision);
  await this.#draft(draft.id).save({...draft,staged:true,complete:response.pending!==true},serial);this.check();return response.pending===true;
 }
 save(input:Mindmap,status:(state:SaveState,message?:string)=>void){const document=validateMindmap(structuredClone(input));return this.#run(async()=>{
  const id=mapId(),draft:Draft={protocol:1,ownerId:this.owner,spaceId:this.spaceId,id,document,expectedRevision:this.#revisions.get(document.id)??0,staged:false,complete:false,createdAt:new Date().toISOString()};status('saving');const saved=await this.#draft(id).save(draft,null);this.check();status('device');status('pending');if(!await this.#deliver(draft,saved.serial))status('synced');
 }).catch(error=>{status(error instanceof Error&&error.message.includes('CONFLICT')?'conflict':'error');throw error;});}
 retry(record:MapRecord,status:(state:SaveState,message?:string)=>void){return this.#run(async()=>{status('pending');let pending=false;for(const saved of(await this.#drafts()).filter(row=>!row.value.complete&&row.value.document.id===record.document.id)){pending=await this.#deliver(saved.value,saved.serial)||pending;}if(!pending)status('synced');}).catch(error=>{status('error');throw error;});}
 remove(record:MapRecord){return this.#run(async()=>{await this.#request('/'+encodeURIComponent(record.document.id),{method:'DELETE',body:JSON.stringify({expectedRevision:record.revision,operationId:mapId(),schemaVersion:1})});});}
 history(id:string){return this.#run(async()=>{assertTechnical(id);if(this.#account.mode==='offline')throw new Error('E2EE_ONLINE_REQUIRED');const versions:MapRecord[]=[];let before:number|null=null;const cursors=new Set<number>();
  do{const page=await this.#request(`/${encodeURIComponent(id)}/history${before===null?'':'?before='+before}`);if(!Array.isArray(page.versions))throw new Error('E2EE_PRODUCT_HISTORY_INVALID');for(const row of page.versions as Record<string,unknown>[])if(!row.deleted)versions.push({document:validateMindmap(row.document),revision:Number(row.revision),updatedAt:String(row.updatedAt)});
   before=page.nextCursor===null?null:Number(page.nextCursor);if(before!==null){if(!Number.isSafeInteger(before)||before<1||cursors.has(before))throw new Error('E2EE_PRODUCT_HISTORY_INVALID');cursors.add(before);}if(versions.length>10000)throw new Error('E2EE_SHARED_QUERY_TOO_LARGE');
  }while(before!==null);return versions;
 });}
 async forkDraft(input:Mindmap,status:(state:SaveState,message?:string)=>void){const copy=validateMindmap({...structuredClone(input),id:mapId()});await this.save(copy,status);return copy;}
 #local(id:string){assertTechnical(id);return new E2eeDeviceDocument<{ownerId:string;spaceId:string;value:unknown}>(this.#account.device,`shared-map-local:${this.spaceId}:${id}`,input=>{exactKeys(input,['ownerId','spaceId','value']);if(input.ownerId!==this.owner||input.spaceId!==this.spaceId)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');return input as {ownerId:string;spaceId:string;value:unknown};},()=>this.check());}
 saveView(id:string,view:MapView){return this.#run(async()=>{const store=this.#local('view:'+id),old=await store.load(),prior=old?.value.value as MapView|undefined;await store.save({ownerId:this.owner,spaceId:this.spaceId,value:{...structuredClone(view),viewport:view.viewport??prior?.viewport,positions:view.positions??prior?.positions}},old?.serial??null);this.check();});}
 view(id:string){return this.#run(async()=>{const row=await this.#local('view:'+id).load();this.check();return row?.value.value as MapView|null??null;});}
 journal(input:Conversion){const operation=structuredClone(input);return this.#run(async()=>{const store=this.#local('conversions:'+input.mapId),old=await store.load(),prior=old?.value.value as Conversion[]|undefined;await store.save({ownerId:this.owner,spaceId:this.spaceId,value:[...(prior??[]).filter(row=>row.nodeId!==operation.nodeId),operation]},old?.serial??null);this.check();for(const listener of this.#listeners)listener();});}
 conversions(map:Mindmap){return this.#run(async()=>{const row=await this.#local('conversions:'+map.id).load();this.check();return row?.value.value as Conversion[]??[];});}
 subscribeJournal(listener:()=>void){this.#listeners.add(listener);return()=>{this.#listeners.delete(listener);};}
}
