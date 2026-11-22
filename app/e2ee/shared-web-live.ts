import {requirePrivateAccount,type WebPrivateAccount} from './product-session.ts';
import {E2eeSharedTrust} from './shared-trust.ts';
import {E2eeDeviceDocument} from './device-document.ts';
import {SharedLiveModel,validateSharedLiveContext,validateSharedLiveRequest,type SavedSharedRequest} from './shared-live.ts';
import {encodeE2eeBytes} from './envelope.ts';
import type {SharedDomainBinding} from './shared-domain.ts';
import type {E2eeSharedRecords} from './shared-records.ts';
import {exactKeys,assertTechnical} from './keys.ts';
import {E2eeEditorQueue} from './editor-queue.ts';
import {E2eeFeatureDocument} from './feature-document.ts';
import {SharedAggregateModel,validatePersonalSharedState,seedPersonalSharedState} from './shared-aggregate.ts';
import {parseLegacyMigrationJson} from './legacy-json.ts';
import {privateMembershipOperationDrafts,webPrivateProjectAccess} from './membership-web-operations.ts';
import {membershipProjectAccessFingerprint} from './membership-project-access.ts';
import type {SharedProjectAccessDraft} from '../shared-project-access.ts';
import {waitForPrivateMembershipOperation} from '../private-membership-ui.ts';
import {privateAccountView} from './product-session.ts';
import {samePrivateJson} from './product-json.ts';
import {SharedPrivateBulk,validatePrivateBulkJournal,type PrivateBulkJournal} from './shared-private-bulk.ts';
import {SharedPrivateTransfer,validatePrivateTransferJournal,privateTaskTransferInput,type PrivateTransferJournal} from './shared-private-transfer.ts';

const models=new WeakMap<WebPrivateAccount,Map<string,WebSharedLive>>();
const aggregates=new WeakMap<WebPrivateAccount,SharedAggregateModel>();
const transferModels=new WeakMap<WebPrivateAccount,SharedPrivateTransfer>();
function privateTransfer(ownerId:string){const account=requirePrivateAccount(ownerId),prior=transferModels.get(account);if(prior)return prior;const current=()=>account.requireOpen(),document=(id:string)=>new E2eeDeviceDocument<PrivateTransferJournal>(account.device,'shared-transfer-private:'+id,value=>{const parsed=validatePrivateTransferJournal(value,ownerId);if(parsed.input.requestId!==id)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');return parsed;},current);
 const model=new SharedPrivateTransfer({ownerId,current,load:id=>document(id).load(),save:async(value,serial)=>(await document(value.input.requestId).save(value,serial)).serial,capture:async projectId=>await(await open(ownerId,'project',projectId)).model.request('GET','execution/capture') as unknown as Awaited<ReturnType<import('./shared-private-transfer.ts').PrivateTransferPorts['capture']>>,request:async(projectId,path,input)=>(await open(ownerId,'project',projectId)).model.request('POST',path,input),copyFile:async(sourceProject,destinationProject,source,destination)=>{
  const sourceLive=await open(ownerId,'project',sourceProject);current();const target=await open(ownerId,'project',destinationProject);current();const from=account.shared(sourceLive.records.binding.scopeId,'project',sourceProject).client,to=account.shared(target.records.binding.scopeId,'project',destinationProject).client;
  if((await from.objectReference('attachment',source.objectId)).revision!==1)throw new Error('E2EE_PRIVATE_FILE_IMMUTABLE');current();const file=await from.read('attachment',source.objectId);current();if(!file)throw new Error('E2EE_PRIVATE_FILE_UNAVAILABLE');const queue=new E2eeEditorQueue(account.device,to,target.records.binding.scopeId,'attachment',destination.objectId);let saved;
  try{if(file.bytes.length!==source.size||file.filename!==source.filename||file.mediaType!==source.mediaType||destination.size!==source.size||destination.filename!==source.filename||destination.mediaType!==source.mediaType)throw new Error('E2EE_PRIVATE_FILE_CORRUPT');saved=await queue.load();current();if(saved){if(saved.remoteRevision>1||saved.bytes.length!==file.bytes.length||saved.bytes.some((v,i)=>v!==file.bytes[i])||saved.metadata.filename!==destination.filename||saved.metadata.mediaType!==destination.mediaType)throw new Error('E2EE_IDEMPOTENCY_CONFLICT');}else await queue.stage(file.bytes,null,0,{filename:destination.filename,mediaType:destination.mediaType});current();await queue.flush();current();const readback=await to.read('attachment',destination.objectId);current();try{if(!readback||(await to.objectReference('attachment',destination.objectId)).revision!==1||readback.filename!==destination.filename||readback.mediaType!==destination.mediaType||readback.bytes.length!==file.bytes.length||readback.bytes.some((v,i)=>v!==file.bytes[i]))throw new Error('E2EE_TRANSFER_READBACK_CHANGED');}finally{readback?.bytes.fill(0);}}finally{saved?.bytes.fill(0);file.bytes.fill(0);}
 }});transferModels.set(account,model);return model;
}
const bulkModels=new WeakMap<WebPrivateAccount,SharedPrivateBulk>();
function privateBulk(ownerId:string){const account=requirePrivateAccount(ownerId),prior=bulkModels.get(account);if(prior)return prior;const current=()=>account.requireOpen(),document=(id:string)=>new E2eeDeviceDocument<PrivateBulkJournal>(account.device,'shared-bulk-private:'+id,value=>{const parsed=validatePrivateBulkJournal(value,ownerId);if(parsed.id!==id)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');return parsed;},current);
 const model=new SharedPrivateBulk({ownerId,current,move:input=>privateTransfer(ownerId).execute(input),load:id=>document(id).load(),save:async(value,serial)=>(await document(value.id).save(value,serial)).serial,list:async()=>(await account.device.vault.listLocal('draft','shared-bulk-private:')).map(v=>v.slice('shared-bulk-private:'.length)),projects:async()=>{const all=[];for(const scope of await bindings(ownerId))if(scope.kind==='project'){const value=await(await open(ownerId,'project',scope.resourceId)).model.request('GET','');current();all.push({project:value.project as Record<string,unknown>,tasks:value.tasks as Record<string,unknown>[],statuses:value.statuses as Record<string,unknown>[]});}return all;},query:async(filter,sort,cursor)=>await aggregate(ownerId).request('GET',`/shared/tasks?filter=${encodeURIComponent(JSON.stringify(filter))}&sort=${encodeURIComponent(sort)}${cursor?`&cursor=${encodeURIComponent(cursor)}`:''}`) as unknown as import('../cloud-sync.ts').SharedTaskPage,request:async(projectId,method,path,body)=>{const live=await open(ownerId,'project',projectId);current();return live.model.request(method,path,body);}});bulkModels.set(account,model);return model;
}
function aggregate(ownerId:string){const account=requirePrivateAccount(ownerId);let value=aggregates.get(account);if(value)return value;
 const personal=new E2eeFeatureDocument({ownerId,domain:'workspace',objectId:'personal-shared-views-live-v1',validate:input=>validatePersonalSharedState(input,ownerId),seed:async()=>{
  const original=await account.personal().client.readMigrationOriginal('local-snapshot','private-table:personal.local-work:shared_saved_views');account.requireOpen();
  try{return seedPersonalSharedState(parseLegacyMigrationJson(new TextDecoder('utf-8',{fatal:true}).decode(original.bytes),'E2EE_PRIVATE_SEED_REQUIRED',64*1024*1024),ownerId,await account.personal().client.sharedReadHistory());}finally{original.bytes.fill(0);}
 }});
 value=new SharedAggregateModel({actorId:ownerId,current:()=>account.requireOpen(),personal,
  bindings:async()=>(await bindings(ownerId)).map(row=>({scopeId:row.scopeId,kind:row.kind,resourceId:row.resourceId})),
  request:async(binding,method,path,body={})=>{const live=await open(ownerId,binding.kind,binding.resourceId);account.requireOpen();if(live.records.binding.scopeId!==binding.scopeId)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');return live.model.request(method,path,body);},
 });aggregates.set(account,value);return value;
}
class WebSharedLive{
 readonly model:SharedLiveModel;readonly prefix:Promise<string>;
 constructor(readonly account:WebPrivateAccount,readonly records:E2eeSharedRecords){const binding=records.binding;
  this.prefix=crypto.subtle.digest('SHA-256',new TextEncoder().encode(binding.scopeId)).then(value=>'shared-request:'+encodeE2eeBytes(new Uint8Array(value))+':');
  const contextStore=new E2eeDeviceDocument(account.device,`shared-context:${binding.scopeId}`,value=>{
   exactKeys(value,['scopeId','context']);if(value.scopeId!==binding.scopeId)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');return{scopeId:binding.scopeId,context:validateSharedLiveContext(value.context)};
  },()=>account.requireOpen());
  const eventStore=new E2eeDeviceDocument(account.device,`shared-events:${binding.scopeId}`,value=>{exactKeys(value,['scopeId','events']);if(value.scopeId!==binding.scopeId||!Array.isArray(value.events)||value.events.length>10000)throw new Error('E2EE_SHARED_DOMAIN_INVALID');return value as {scopeId:string;events:Record<string,unknown>[]};},()=>account.requireOpen());
  this.model=new SharedLiveModel({binding,actorId:account.ownerId,online:account.mode==='online',current:()=>account.requireOpen(),
   context:async()=>{const saved=await contextStore.load();account.requireOpen();if(account.mode==='offline'){if(!saved)throw new Error('E2EE_OFFLINE_CONTENT_UNAVAILABLE');return saved.value.context;}
    const response=await account.shared(binding.scopeId,binding.kind,binding.resourceId).client.readProductContext();account.requireOpen();exactKeys(response,['context','checkpointHash','directoryRevision']);
    const value=validateSharedLiveContext(response.context);await contextStore.save({scopeId:binding.scopeId,context:value},saved?.serial??null);account.requireOpen();return value;
   },
   versions:async()=>{const entities=await records.index(),versions=[];for(const entity of entities){versions.push(await records.read(entity));account.requireOpen();}return versions;},
   localVersions:()=>records.product.localVersions(),
   history:(entityId,before)=>records.product.history(entityId,before),
   sourceTable:table=>records.sourceTable(table),
   eventCache:{load:async()=>{const row=await eventStore.load();account.requireOpen();return row?.value.events??null;},save:async events=>{const before=await eventStore.load();account.requireOpen();await eventStore.save({scopeId:binding.scopeId,events},before?.serial??null);account.requireOpen();}},
   completionProposals:async()=>records.product.completionProposals(),
   approvalPreview:entityId=>records.product.approvalPreview(entityId),
   approve:(review,id)=>records.product.approve(review,id),
   stageFile:async(reference,bytes)=>{account.requireOpen();const {client}=account.shared(binding.scopeId,binding.kind,binding.resourceId),queue=new E2eeEditorQueue(account.device,client,binding.scopeId,'attachment',reference.objectId),saved=await queue.load();account.requireOpen();
    try{if(saved){if(saved.remoteRevision>1||saved.bytes.length!==bytes.length||saved.bytes.some((byte,index)=>byte!==bytes[index])||saved.metadata.filename!==reference.filename||saved.metadata.mediaType!==reference.mediaType)throw new Error('E2EE_IDEMPOTENCY_CONFLICT');}
     else await queue.stage(bytes,null,0,{filename:reference.filename,mediaType:reference.mediaType});account.requireOpen();if(account.mode==='online'){await queue.flush();account.requireOpen();const head=await client.objectReference('attachment',reference.objectId);if(head.revision!==1)throw new Error('E2EE_PRIVATE_FILE_IMMUTABLE');}
    }finally{saved?.bytes.fill(0);}
   },
   readFile:async reference=>{account.requireOpen();const {client}=account.shared(binding.scopeId,binding.kind,binding.resourceId);
    if(account.mode==='offline'){const local=await new E2eeEditorQueue(account.device,client,binding.scopeId,'attachment',reference.objectId).load();account.requireOpen();if(!local)throw new Error('E2EE_OFFLINE_CONTENT_UNAVAILABLE');return{bytes:local.bytes,...local.metadata};}
    const file=await client.read('attachment',reference.objectId);account.requireOpen();if(!file)throw new Error('E2EE_PRIVATE_FILE_UNAVAILABLE');return file;
   },
   stage:(edits,id)=>records.product.stage(edits,id),flush:async id=>{if(account.mode!=='online')throw new Error('E2EE_ONLINE_REQUIRED');return records.flush(id);},
   invitationService:async plan=>{const {client}=account.shared(binding.scopeId,binding.kind,binding.resourceId);account.requireOpen();const result=await client.executeService(plan.action,plan.payload,plan.intentId);account.requireOpen();const state=await client.readInvitationState(plan.ids);account.requireOpen();return{result,state};},
   membershipView:async(userId,desired)=>await webPrivateProjectAccess(account.ownerId,binding.resourceId,userId,desired as SharedProjectAccessDraft|null) as unknown as Record<string,unknown>,
   membership:async(operation,id,expectedFingerprint)=>{account.requireOpen();const drafts=privateMembershipOperationDrafts(account.ownerId);let existing;
    try{existing=await drafts.inspect(id);}catch(error){if(!(error instanceof Error)||error.message!=='E2EE_MEMBERSHIP_OPERATION_REQUIRED')throw error;}
    account.requireOpen();if(existing){if(!samePrivateJson(existing.operation,operation))throw new Error('E2EE_IDEMPOTENCY_CONFLICT');}else await drafts.create(operation,id);account.requireOpen();
    const observed=await drafts.follow(id);account.requireOpen();if(operation.kind==='project-grants'&&!observed.resolves&&!observed.started){const snapshot=await drafts.snapshot(operation);account.requireOpen();if(expectedFingerprint!==membershipProjectAccessFingerprint(snapshot,operation.userId))throw new Error('PROJECT_ACCESS_CONFLICT');}
    const api=await import('../cloud-sync');account.requireOpen();const completed=await api.completedCurrentPrivateMembershipOperation(id);account.requireOpen();if(completed)return completed;
    const active=await drafts.follow(id);account.requireOpen();await waitForPrivateMembershipOperation(account.ownerId,privateAccountView().language,active.intentId);account.requireOpen();
    const result=await api.completedCurrentPrivateMembershipOperation(id);account.requireOpen();if(!result)throw new Error('E2EE_MEMBERSHIP_OUTCOME_REVIEW_REQUIRED');return result;},
   loadRequest:async id=>(await this.requestDocument(id)).load(),saveRequest:async(value,expected)=>(await(await this.requestDocument(value.id)).save(value,expected)).serial,
  });
 }
 async requestDocument(id:string){return new E2eeDeviceDocument<SavedSharedRequest>(this.account.device,(await this.prefix)+id,value=>validateSharedLiveRequest(this.records.binding,value),()=>this.account.requireOpen());}
 async pending(){const ids=await this.account.device.vault.listLocal('draft',await this.prefix),rows:SavedSharedRequest[]=[];this.account.requireOpen();
  for(const key of ids){const id=key.slice((await this.prefix).length),saved=await(await this.requestDocument(id)).load();if(!saved)throw new Error('E2EE_SHARED_REQUEST_MISSING');if(!saved.value.complete)rows.push(saved.value);}return rows;
 }
}
async function open(ownerId:string,kind:'project'|'space',resourceId:string){
 const account=requirePrivateAccount(ownerId),trust=new E2eeSharedTrust(ownerId),scopes=await trust.list();account.requireOpen();
 const candidates=scopes.filter(row=>row.kind===kind&&row.resourceId===resourceId);if(candidates.length!==1)throw new Error('E2EE_SHARED_FINGERPRINT_REQUIRED');
 const candidate=candidates[0];await trust.open(candidate.scopeId);account.requireOpen();let cache=models.get(account);if(!cache){cache=new Map();models.set(account,cache);}
 const existing=cache.get(candidate.scopeId);if(existing)return existing;const {records}=await account.sharedRecords(candidate.scopeId,kind,resourceId);account.requireOpen();
 const concurrent=cache.get(candidate.scopeId);if(concurrent)return concurrent;const value=new WebSharedLive(account,records);cache.set(candidate.scopeId,value);return value;
}
/** Resolve the actual CURRENT resource through normal trust and membership.
 * Archive scope IDs never select a cached writer or supply authorization. */
export async function privateSharedRestoreRequest(ownerId:string,binding:SharedDomainBinding,method:string,path:string,input:Record<string,unknown>,guard:()=>void){
 guard();const live=await open(ownerId,binding.kind,binding.resourceId);guard();live.account.requireOpen();const result=await live.model.request(method,path,input);guard();live.account.requireOpen();return result;
}
async function bindings(ownerId:string){const account=requirePrivateAccount(ownerId),trust=await new E2eeSharedTrust(ownerId).list();account.requireOpen();
 if(account.mode==='online'){const scopes=(await account.scopeSummaries()).filter(row=>row.kind!=='personal');
  for(const scope of scopes)if(scope.state!=='active'||!trust.some(row=>row.scopeId===scope.scopeId&&row.kind===scope.kind&&row.resourceId===scope.resourceId))throw new Error('E2EE_SHARED_FINGERPRINT_REQUIRED');
  for(const known of trust)if(!scopes.some(row=>row.scopeId===known.scopeId))throw new Error('E2EE_SHARED_SCOPE_REVALIDATION_REQUIRED');
 }return trust;
}
/** Called before the legacy API/cache/queue boundary. No private filter or
 * mutation is transmitted to a readable shared-content endpoint. */
export async function privateSharedRequest(ownerId:string,path:string,init:RequestInit={}):Promise<Record<string,unknown>>{
 const url=new URL(path,'https://private.invalid'),method=(init.method??'GET').toUpperCase();init.signal?.throwIfAborted();
 let body:Record<string,unknown>={};if(init.body!==undefined&&init.body!==null){if(typeof init.body!=='string')throw new Error('E2EE_SHARED_REQUEST_INVALID');const value=JSON.parse(init.body);if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('E2EE_SHARED_REQUEST_INVALID');body=value;}
 const segments=url.pathname.split('/').filter(Boolean).map(value=>decodeURIComponent(value));if(segments[0]!=='shared')throw new Error('E2EE_SHARED_REQUEST_INVALID');
 if(segments[1]==='bulk')return await privateBulk(ownerId).request(method,path,body) as unknown as Record<string,unknown>;
 if(method==='POST'&&segments.length===6&&segments[1]==='projects'&&segments[3]==='tasks'&&segments[5]==='move'&&body.destinationProjectId!==segments[2]){
  const command=privateTaskTransferInput(segments[2],segments[4],body);await privateTransfer(ownerId).execute(command);requirePrivateAccount(ownerId).requireOpen();init.signal?.throwIfAborted();return(await open(ownerId,'project',command.destinationProjectId)).model.request('GET',`tasks/${command.rootTaskId}`);
 }
 if(segments[1]==='invitations'){const account=requirePrivateAccount(ownerId),{webInvitationRecipient}=await import('./invitation-recipient.ts');account.requireOpen();const recipient=webInvitationRecipient(account);
  if(method==='GET'&&segments.length===2){const invitations=await recipient.list();account.requireOpen();init.signal?.throwIfAborted();return{invitations};}
  if(method==='POST'&&segments.length===3){if(segments[2]==='accept'){exactKeys(body,['id']);assertTechnical(body.id);return recipient.respond(body.id,true);}exactKeys(body,[]);return recipient.respond(segments[2],false);}
  throw new Error('E2EE_SHARED_OPERATION_REVIEW_REQUIRED');
 }
 if(['views','overview','inbox','notifications'].includes(segments[1])||segments[1]==='spaces'&&segments[3]==='mindmaps'||segments[1]==='projects'&&segments.length===6&&segments[3]==='tasks'&&['read','watch'].includes(segments[5])||method==='GET'&&(segments[1]==='tasks'&&segments.length===2||segments[1]==='spaces'&&segments[3]==='search'&&segments.length===4)){
  const result=await aggregate(ownerId).request(method,path,body);requirePrivateAccount(ownerId).requireOpen();init.signal?.throwIfAborted();return result;
 }
 const run=async(binding:Pick<SharedDomainBinding,'kind'|'resourceId'>,relative:string)=>{
  const live=await open(ownerId,binding.kind,binding.resourceId);init.signal?.throwIfAborted();const result=await live.model.request(method,relative+url.search,body);requirePrivateAccount(ownerId).requireOpen();init.signal?.throwIfAborted();return result;
 };
 if(method==='GET'&&segments[1]==='tasks'&&(segments.length===4&&segments[3]==='image'||segments.length===5&&segments[3]==='attachments')){
  for(const scope of await bindings(ownerId))if(scope.kind==='project'){const live=await open(ownerId,'project',scope.resourceId),entities=await live.records.index();if(entities.some(row=>row.entityId===`task:${segments[2]}`&&row.kind==='task'&&!row.deleted))return run(scope,`tasks/${segments.slice(2).join('/')}`);}
  throw new Error('E2EE_PRODUCT_ENTITY_MISSING');
 }
 if(segments.length>=3&&(segments[1]==='projects'||segments[1]==='spaces')){
  const kind=segments[1]==='projects'?'project':'space',resourceId=segments[2];
  if(method==='GET'&&kind==='space'&&['projects','archived-projects'].includes(segments[3])&&segments.length===4){const projects=[];
   for(const scope of await bindings(ownerId))if(scope.kind==='project'){const live=await open(ownerId,'project',scope.resourceId),snapshot=await live.model.request('GET','');const project=snapshot.project as Record<string,unknown>;
    if(project.spaceId===resourceId&&!!project.archivedAt===(segments[3]==='archived-projects'))projects.push(project);}
   return{projects};
  }
  return run({kind,resourceId},segments.slice(3).join('/'));
 }
 if(method==='GET'&&segments.length===2&&segments[1]==='spaces'){const spaces=[];for(const scope of await bindings(ownerId))if(scope.kind==='space'){const snapshot=await(await open(ownerId,'space',scope.resourceId)).model.request('GET','');spaces.push(snapshot.space);}return{spaces};}
 if(method==='GET'&&segments.length===2&&segments[1]==='task-lists'){const lists=[];for(const scope of await bindings(ownerId))if(scope.kind==='project'){
  const snapshot=await(await open(ownerId,'project',scope.resourceId)).model.request('GET',''),project=snapshot.project as Record<string,unknown>,tasks=snapshot.tasks as Record<string,unknown>[];
  for(const status of snapshot.statuses as Record<string,unknown>[])lists.push({...status,projectId:scope.resourceId,projectTitle:project.title,spaceId:project.spaceId,role:project.role,taskCount:tasks.filter(task=>task.statusId===status.id).length,openCount:tasks.filter(task=>task.statusId===status.id&&!task.completedAt).length});
 }return{lists};}
 throw new Error('E2EE_SHARED_OPERATION_REVIEW_REQUIRED');
}
export async function advancePrivateSharedExecution(ownerId:string,current:()=>void){const errors:string[]=[];let changed=0;current();
 for(const binding of await bindings(ownerId)){current();if(binding.kind!=='project')continue;try{const live=await open(ownerId,'project',binding.resourceId);current();
  for(let count=0;count<5;count++){const now=new Date().toISOString(),ready=await live.model.request('GET',`execution/ready?now=${encodeURIComponent(now)}`);current();const operation=ready.automation?'automations/advance':ready.series?'series/advance':null;if(!operation)break;const result=await live.model.request('POST',operation,{now});current();if(!result.advanced)break;changed++;}
 }catch(error){current();errors.push(error instanceof Error&&/^[A-Z_]{1,100}$/.test(error.message)?error.message:'E2EE_PRIVATE_EXECUTION_PENDING');}}return{changed,errors};
}
export async function privateSharedPending(ownerId:string,projectId?:string){const rows=[];
 const known=await bindings(ownerId);for(const scope of known)if(!projectId||scope.kind==='project'&&scope.resourceId===projectId){const live=await open(ownerId,scope.kind,scope.resourceId);for(const request of await live.pending())rows.push({scopeId:scope.scopeId,kind:scope.kind,resourceId:scope.resourceId,request});}
 const account=requirePrivateAccount(ownerId);for(const key of await account.device.vault.listLocal('draft','shared-transfer-private:')){account.requireOpen();const id=key.slice('shared-transfer-private:'.length),saved=await new E2eeDeviceDocument<PrivateTransferJournal>(account.device,key,value=>validatePrivateTransferJournal(value,ownerId),()=>account.requireOpen()).load();if(!saved||saved.value.complete||projectId&&saved.value.input.sourceProjectId!==projectId)continue;const transfer=saved.value,scope=known.find(row=>row.kind==='project'&&row.resourceId===transfer.input.sourceProjectId);if(!scope)throw new Error('E2EE_SHARED_SCOPE_REVALIDATION_REQUIRED');const request:SavedSharedRequest={protocol:1,scopeId:scope.scopeId,id:'transfer:'+id,method:'POST',path:`tasks/${transfer.input.rootTaskId}/move`,body:{...transfer.input},createdAt:transfer.createdAt,edits:null,result:null,complete:false};rows.push({scopeId:scope.scopeId,kind:scope.kind,resourceId:scope.resourceId,request});}return rows;
}
export async function resumePrivateSharedRequest(ownerId:string,resourceId:string,requestId:string,kind:'project'|'space'='project'){
 if(requestId.startsWith('transfer:')){const account=requirePrivateAccount(ownerId),id=requestId.slice('transfer:'.length);assertTechnical(id);const saved=await new E2eeDeviceDocument<PrivateTransferJournal>(account.device,'shared-transfer-private:'+id,value=>validatePrivateTransferJournal(value,ownerId),()=>account.requireOpen()).load();account.requireOpen();if(kind!=='project'||!saved||saved.value.input.requestId!==id||saved.value.input.sourceProjectId!==resourceId)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');await privateTransfer(ownerId).execute(saved.value.input);account.requireOpen();return(await open(ownerId,'project',saved.value.input.destinationProjectId)).model.request('GET',`tasks/${saved.value.input.rootTaskId}`);}
 const live=await open(ownerId,kind,resourceId);return live.model.resume(requestId);
}
