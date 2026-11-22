import {requirePrivateAccount,type WebPrivateAccount} from './product-session.ts';
import {E2eeSharedTrust} from './shared-trust.ts';
import {E2eeDeviceDocument} from './device-document.ts';
import {SharedLiveModel,validateSharedLiveContext,validateSharedLiveRequest,type SavedSharedRequest} from './shared-live.ts';
import {encodeE2eeBytes} from './envelope.ts';
import type {SharedDomainBinding} from './shared-domain.ts';
import type {E2eeSharedRecords} from './shared-records.ts';
import {exactKeys} from './keys.ts';
import {E2eeEditorQueue} from './editor-queue.ts';
import {E2eeFeatureDocument} from './feature-document.ts';
import {SharedAggregateModel,validatePersonalSharedState,seedPersonalSharedState} from './shared-aggregate.ts';
import {parseLegacyMigrationJson} from './legacy-json.ts';
import {privateMembershipOperationDrafts} from './membership-web-operations.ts';
import {waitForPrivateMembershipOperation} from '../private-membership-ui.ts';
import {privateAccountView} from './product-session.ts';
import {samePrivateJson} from './product-json.ts';

const models=new WeakMap<WebPrivateAccount,Map<string,WebSharedLive>>();
const aggregates=new WeakMap<WebPrivateAccount,SharedAggregateModel>();
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
   membership:async(operation,id)=>{account.requireOpen();const drafts=privateMembershipOperationDrafts(account.ownerId);let existing;
    try{existing=await drafts.inspect(id);}catch(error){if(!(error instanceof Error)||error.message!=='E2EE_MEMBERSHIP_OPERATION_REQUIRED')throw error;}
    account.requireOpen();if(existing){if(!samePrivateJson(existing.operation,operation))throw new Error('E2EE_IDEMPOTENCY_CONFLICT');}else await drafts.create(operation,id);account.requireOpen();
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
export async function privateSharedPending(ownerId:string,projectId?:string){const rows=[];
 for(const scope of await bindings(ownerId))if(!projectId||scope.kind==='project'&&scope.resourceId===projectId){const live=await open(ownerId,scope.kind,scope.resourceId);for(const request of await live.pending())rows.push({scopeId:scope.scopeId,kind:scope.kind,resourceId:scope.resourceId,request});}return rows;
}
export async function resumePrivateSharedRequest(ownerId:string,resourceId:string,requestId:string,kind:'project'|'space'='project'){const live=await open(ownerId,kind,resourceId);return live.model.resume(requestId);}
