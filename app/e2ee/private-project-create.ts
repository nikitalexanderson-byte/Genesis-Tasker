import {sha256} from '@noble/hashes/sha2.js';
import {E2eeDeviceDocument} from './device-document.ts';
import {E2eeScopeSetup,type ScopeSetupTransport} from './scope-setup.ts';
import {E2eeSharedTrust} from './shared-trust.ts';
import {capturePrivateProjectSelection} from './project-create-selection.ts';
import {validatePrivateProjectLocation,validatePrivateProjectTopology,type PrivateProjectLocation,type PrivateProjectTopology} from './project-create-contract.ts';
import {canonicalE2eeValue,e2eeCommandHash,snapshotE2eeValue,type WireValue} from './commands.ts';
import {assertTechnical,exactKeys,type RecoveryKit} from './keys.ts';
import {decodeE2eeBytes,encodeE2eeBytes} from './envelope.ts';
import {samePrivateJson as same} from './product-json.ts';
import {sharedBodyMetadata,sharedBodyParent,sharedRecordKey,type SharedRecordBody} from './shared-domain.ts';
import type {WebPrivateAccount} from './product-session.ts';

export type PrivateProjectDraft=PrivateProjectLocation&{title:string;description:string;tags:string[];labelIds:string[];
 statusTitles:{open:string;progress:string;done:string;chaos:string}};
export type PrivateProjectPreparation={intentId:string;kind:'project';resourceId:string;scopeId:string;spaceId:string;parentId:string|null;categoryId:string|null;boardStatusId:string|null;
 projectType:'project'|'task-list';layout:'list'|'board';statuses:{id:string;isDone:0|1;isChaos:0|1}[];reviewedMembers:PrivateProjectTopology['reviewedMembers'];topologyHash:string;
 state:'preparing';bootstrapHash:string;directoryRevision:1;checkpointHash:string;createdAt:string};
type Review={topologyHash:string;reviewedAt:string};
const phases=['draft','previewed','reviewed','prepared','migrated','values','complete'] as const;
export type PrivateProjectCreationIntent={format:'genesis-private-project-create-v1';ownerId:string;intentId:string;scopeId:string;resourceId:string;kind:'project';input:PrivateProjectDraft;createdAt:string;
 topology:PrivateProjectTopology|null;review:Review|null;started:boolean;preparation:PrivateProjectPreparation|null;phase:typeof phases[number];history:{topology:PrivateProjectTopology;review:Review|null}[]};
const prefix='shared-project-create:',uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const invalid=():never=>{throw new Error('E2EE_PRIVATE_RESOURCE_CREATE_INVALID');};
const trim=(value:string)=>value.replace(/^[\u0000\t\n\r\v ]+|[\u0000\t\n\r\v ]+$/g,'');
export function privateProjectLocation(input:PrivateProjectLocation):PrivateProjectLocation{
 const {spaceId,parentId,categoryId,boardStatusId,kind,layout}=input;return validatePrivateProjectLocation({spaceId,parentId,categoryId,boardStatusId,kind,layout});
}
export function validatePrivateProjectDraft(input:unknown):PrivateProjectDraft{
 exactKeys(input,['spaceId','parentId','categoryId','boardStatusId','kind','layout','title','description','tags','labelIds','statusTitles']);
 privateProjectLocation(input as PrivateProjectDraft);
 if(typeof input.title!=='string'||!trim(input.title)||Array.from(input.title).length>160||typeof input.description!=='string'||Array.from(input.description).length>5000
  ||!Array.isArray(input.tags)||input.tags.length>30||input.tags.some(tag=>typeof tag!=='string'||Array.from(tag).length>80)
  ||!Array.isArray(input.labelIds)||input.labelIds.length>50||input.labelIds.some(id=>typeof id!=='string'||!uuid.test(id)))invalid();
 exactKeys(input.statusTitles,['open','progress','done','chaos']);for(const title of Object.values(input.statusTitles))if(typeof title!=='string'||!trim(title)||Array.from(title).length>80)invalid();
 return structuredClone(input) as PrivateProjectDraft;
}
export function privateProjectTopologyHash(value:PrivateProjectTopology){const bytes=canonicalE2eeValue(value as unknown as WireValue);try{return encodeE2eeBytes(sha256(bytes));}finally{bytes.fill(0);}}
function review(value:unknown,topology:PrivateProjectTopology):Review{
 exactKeys(value,['topologyHash','reviewedAt']);decodeE2eeBytes(value.topologyHash,32);
 if(value.topologyHash!==privateProjectTopologyHash(topology)||typeof value.reviewedAt!=='string'||!Number.isFinite(Date.parse(value.reviewedAt)))invalid();return value as Review;
}
export function validatePrivateProjectPreparation(input:unknown,intent:Pick<PrivateProjectCreationIntent,'intentId'|'resourceId'|'scopeId'|'topology'>):PrivateProjectPreparation{
 exactKeys(input,['intentId','kind','resourceId','scopeId','spaceId','parentId','categoryId','boardStatusId','projectType','layout','statuses','reviewedMembers','topologyHash','state','bootstrapHash','directoryRevision','checkpointHash','createdAt']);
 const topology=intent.topology;if(!topology||input.intentId!==intent.intentId||input.resourceId!==intent.resourceId||input.scopeId!==intent.scopeId||input.kind!=='project'||input.state!=='preparing'
  ||input.directoryRevision!==1||input.spaceId!==topology.spaceId||input.parentId!==topology.parentId||input.categoryId!==topology.categoryId||input.boardStatusId!==topology.boardStatusId
  ||input.projectType!==topology.kind||input.layout!==topology.layout||!same(input.reviewedMembers,topology.reviewedMembers)||input.topologyHash!==privateProjectTopologyHash(topology)
  ||typeof input.createdAt!=='string'||!Number.isFinite(Date.parse(input.createdAt))||!Array.isArray(input.statuses)||input.statuses.length!==5)invalid();
 decodeE2eeBytes(input.bootstrapHash,32);decodeE2eeBytes(input.checkpointHash,32);if(input.bootstrapHash!==input.checkpointHash)invalid();
 const ids=new Set<string>();for(const [at,row]of input.statuses.entries()){
  exactKeys(row,['id','isDone','isChaos']);assertTechnical(row.id);if(ids.has(row.id)||row.isChaos!==(at<2?1:0)||row.isDone!==([0,1,0,0,1][at]))invalid();ids.add(row.id);
  if(at<2){if(row.id!==(at===0?'chaos-open:':'chaos-done:')+intent.resourceId)invalid();}else if(!uuid.test(row.id))invalid();
 }
 return structuredClone(input) as PrivateProjectPreparation;
}
/** Full input precedes IO. A proposal is not consent; consent does not grant a
 * key. After preparation starts, its exact topology/packet cannot be retargeted.
 * Source rows, abandoned proposals and immutable product versions stay intact. */
export class E2eePrivateProjectCreation {
 #serial:Promise<unknown>=Promise.resolve();
 constructor(private readonly account:WebPrivateAccount,private readonly transport:Pick<ScopeSetupTransport,'directory'>,private readonly guard:()=>void=()=>{}){}
 #current(){this.guard();this.account.requireOpen();}
 #run<T>(run:()=>Promise<T>){const task=this.#serial.catch(()=>undefined).then(async()=>{this.#current();return run();});this.#serial=task;return task;}
 #document(id:string){assertTechnical(id);return new E2eeDeviceDocument<PrivateProjectCreationIntent>(this.account.device,prefix+id,value=>{
  exactKeys(value,['format','ownerId','intentId','scopeId','resourceId','kind','input','createdAt','topology','review','started','preparation','phase','history']);
  if(value.format!=='genesis-private-project-create-v1'||value.ownerId!==this.account.ownerId||value.intentId!==id||value.kind!=='project'||typeof value.started!=='boolean'
   ||!phases.includes(value.phase as PrivateProjectCreationIntent['phase'])||typeof value.createdAt!=='string'||!Number.isFinite(Date.parse(value.createdAt))
   ||!Array.isArray(value.history)||value.history.length>64)invalid();
  assertTechnical(value.scopeId);assertTechnical(value.resourceId);if(!uuid.test(value.resourceId))invalid();validatePrivateProjectDraft(value.input);
  for(const row of value.history){exactKeys(row,['topology','review']);const topology=validatePrivateProjectTopology(row.topology,this.account.ownerId);if(row.review!==null)review(row.review,topology);}
  const at=phases.indexOf(value.phase as PrivateProjectCreationIntent['phase']);
  if(value.topology===null){if(at!==0||value.review!==null||value.started||value.preparation!==null)invalid();}
  else{const topology=validatePrivateProjectTopology(value.topology,this.account.ownerId);if(!same(privateProjectLocation(value.input as PrivateProjectDraft),privateProjectLocation(topology)))invalid();
   if(at<1||value.review===null&&(at>=2||value.started)||value.review!==null&&at<2)invalid();if(value.review!==null)review(value.review,topology);
   if(value.preparation!==null)validatePrivateProjectPreparation(value.preparation,{intentId:id,resourceId:value.resourceId,scopeId:value.scopeId,topology});
  }
  if(value.started&&value.review===null||value.preparation!==null&&!value.started||at>=3&&value.preparation===null)invalid();
  return value as PrivateProjectCreationIntent;
 },()=>this.#current());}
 create(input:PrivateProjectDraft){const held=validatePrivateProjectDraft(input);return this.#run(async()=>{
  const id=crypto.randomUUID(),value:PrivateProjectCreationIntent={format:'genesis-private-project-create-v1',ownerId:this.account.ownerId,intentId:id,scopeId:'project:'+crypto.randomUUID(),resourceId:crypto.randomUUID(),kind:'project',
   input:held,createdAt:new Date().toISOString(),topology:null,review:null,started:false,preparation:null,phase:'draft',history:[]};
  const document=this.#document(id);await document.save(value,null);this.#current();const after=await document.load();if(!after||!same(after.value,value))throw new Error('E2EE_PRIVATE_RESOURCE_CREATE_UNVERIFIED');return id;
 });}
 async inspect(id:string){this.#current();const saved=await this.#document(id).load();this.#current();if(!saved)throw new Error('E2EE_PRIVATE_RESOURCE_CREATE_REQUIRED');return structuredClone(saved.value);}
 async pending(){this.#current();const ids=await this.account.device.vault.listLocal('draft',prefix);this.#current();const rows:PrivateProjectCreationIntent[]=[];for(const key of ids){const row=await this.inspect(key.slice(prefix.length));if(row.phase!=='complete')rows.push(row);}return rows;}
 async #proposal(intent:PrivateProjectCreationIntent){
  const selection=await capturePrivateProjectSelection(this.account,privateProjectLocation(intent.input),()=>this.#current());this.#current();
  await this.account.personal().client.refresh();this.#current();const topology=await this.account.personal().client.readProjectCreationPreview(intent.resourceId,selection);this.#current();return topology;
 }
 preview(id:string){return this.#run(async()=>{
  const intent=await this.inspect(id);if(intent.started||intent.preparation)throw new Error('E2EE_RESOURCE_CREATION_LOCKED');
  const topology=await this.#proposal(intent),document=this.#document(id),before=await document.load();this.#current();
  if(!before||before.value.started||!same(before.value.input,intent.input)||!same(before.value.topology,intent.topology)||!same(before.value.review,intent.review))throw new Error('E2EE_LOCAL_CONFLICT');
  if(same(before.value.topology,topology))return before.value;
  const history=[...before.value.history];if(before.value.topology)history.push({topology:before.value.topology,review:before.value.review});
  if(history.length>64)throw new Error('E2EE_SOURCE_HISTORY_CAPACITY');
  await document.save({...before.value,topology,review:null,phase:'previewed',history},before.serial);this.#current();return this.inspect(id);
 });}
 confirmReview(id:string,expectedHash:string){return this.#run(async()=>{
  decodeE2eeBytes(expectedHash,32);const intent=await this.inspect(id);if(!intent.topology||intent.started||privateProjectTopologyHash(intent.topology)!==expectedHash)throw new Error('E2EE_PROJECT_TOPOLOGY_CHANGED');
  const fresh=await this.#proposal(intent);if(!same(fresh,intent.topology))throw new Error('E2EE_PROJECT_TOPOLOGY_CHANGED');
  const document=this.#document(id),before=await document.load();this.#current();
  if(!before||before.value.started||!same(before.value.input,intent.input)||!same(before.value.topology,intent.topology))throw new Error('E2EE_LOCAL_CONFLICT');
  if(!before.value.review)await document.save({...before.value,review:{topologyHash:expectedHash,reviewedAt:new Date().toISOString()},phase:'reviewed'},before.serial);
  this.#current();return this.inspect(id);
 });}
 prepare(id:string,secret:Uint8Array,kit:RecoveryKit){const held=new Uint8Array(secret);let retainedKit:RecoveryKit;try{retainedKit=snapshotE2eeValue(kit);}catch(reason){held.fill(0);throw reason;}
  return this.#run(async()=>{try{
   if(this.account.mode!=='online')throw new Error('E2EE_ONLINE_REQUIRED');let intent=await this.inspect(id);
   if(!intent.topology||!intent.review)throw new Error('E2EE_PROJECT_RECIPIENT_REVIEW_REQUIRED');
   if(!intent.started){
    const fresh=await this.#proposal(intent);if(!same(fresh,intent.topology))throw new Error('E2EE_PROJECT_TOPOLOGY_CHANGED');
    const document=this.#document(id),before=await document.load();this.#current();
    if(!before||!same(before.value,intent))throw new Error('E2EE_LOCAL_CONFLICT');
    await document.save({...before.value,started:true},before.serial);intent=await this.inspect(id);
   }
   const fixed=intent;let resolved=false,result:unknown;
   const bootstrap:ScopeSetupTransport['bootstrap']=async packet=>{
     if(resolved)return result;
     this.#current();const hash=await e2eeCommandHash(packet.command);this.#current();
     result=await this.account.personal().client.executeService('resource-create-prepare',{bootstrap:packet as unknown as WireValue,topology:fixed.topology as unknown as WireValue},id);this.#current();
     const receipt=validatePrivateProjectPreparation(result,fixed);if(receipt.bootstrapHash!==hash)throw new Error('E2EE_INVALID_RECEIPT');
     const document=this.#document(id),before=await document.load();this.#current();
     if(!before||!same(before.value.input,fixed.input)||!same(before.value.topology,fixed.topology)||!same(before.value.review,fixed.review)||!before.value.started)throw new Error('E2EE_LOCAL_CONFLICT');
     if(before.value.preparation&&!same(before.value.preparation,receipt))throw new Error('E2EE_IDEMPOTENCY_CONFLICT');
     if(!before.value.preparation)await document.save({...before.value,preparation:receipt},before.serial);this.#current();resolved=true;return result;
   };
   const setup=new E2eeScopeSetup(this.account.device,{ownerId:this.account.ownerId,scopeId:fixed.scopeId,kind:'project',resourceId:fixed.resourceId},{directory:scope=>this.transport.directory(scope),bootstrap},()=>this.#current());
   const packet=await setup.prepare(held,retainedKit,0);this.#current();
   // A directory read may have completed setup after the creation response was
   // lost. Resolve the same semantic receipt even when setup is already done.
   if(!fixed.preparation)await bootstrap(packet);else if(fixed.preparation.bootstrapHash!==await e2eeCommandHash(packet.command))throw new Error('E2EE_INVALID_RECEIPT');
   this.#current();const directory=await setup.submit();this.#current();const document=this.#document(id),before=await document.load();
   if(!before?.value.preparation||directory.kind!=='project'||directory.resourceId!==fixed.resourceId||directory.ownerId!==this.account.ownerId||!['preparing','uploading','verified','active'].includes(directory.state))invalid();
   if(phases.indexOf(before.value.phase)<phases.indexOf('prepared'))await document.save({...before.value,phase:'prepared'},before.serial);
   this.#current();return{intent:await this.inspect(id),directory};
  }finally{held.fill(0);}}).finally(()=>held.fill(0));
 }
 markMigrated(id:string){return this.#run(async()=>{
  const intent=await this.inspect(id);if(phases.indexOf(intent.phase)<phases.indexOf('prepared')||!intent.preparation)throw new Error('E2EE_PRIVATE_RESOURCE_CREATE_UNVERIFIED');
  if(phases.indexOf(intent.phase)>=phases.indexOf('migrated'))return intent;
  const {records}=await this.account.sharedRecords(intent.scopeId,'project',intent.resourceId),index=await records.index();this.#current();
  for(const [kind,raw]of [['project',intent.resourceId],...intent.preparation.statuses.map(row=>['status',row.id])]){
   const entity=index.find(row=>row.entityId===kind+':'+raw&&row.kind===kind);if(!entity||entity.deleted)throw new Error('E2EE_PRIVATE_SEED_REQUIRED');
  }
  const document=this.#document(id),before=await document.load();this.#current();if(!before||!same(before.value,intent))throw new Error('E2EE_LOCAL_CONFLICT');
  await document.save({...before.value,phase:'migrated'},before.serial);this.#current();return this.inspect(id);
 });}
 async #initialBodies(intent:PrivateProjectCreationIntent){
  if(!intent.preparation||!intent.topology)invalid();const {records}=await this.account.sharedRecords(intent.scopeId,'project',intent.resourceId),roots=await records.sourceTable('shared_projects');this.#current();
  if(roots.length!==1||roots[0].id!==intent.resourceId)throw new Error('E2EE_PRIVATE_SEED_REQUIRED');
  const root=roots[0],location=privateProjectLocation(intent.input);if(root.is_inbox!==0||root.archived_at!==null||root.created_by!==intent.ownerId)throw new Error('E2EE_PROJECT_TOPOLOGY_CHANGED');
  for(const [column,key]of [['space_id','spaceId'],['parent_id','parentId'],['category_id','categoryId'],['board_status_id','boardStatusId'],['kind','kind'],['layout','layout']] as const)
   if(root[column]!==location[key])throw new Error('E2EE_PROJECT_TOPOLOGY_CHANGED');
  const trust=new E2eeSharedTrust(this.account.ownerId);await trust.open(intent.topology.spaceAnchor.scopeId);this.#current();
  const space=await this.account.sharedRecords(intent.topology.spaceAnchor.scopeId,'space',intent.input.spaceId),labels=[...new Set(intent.input.labelIds)].sort();
  for(const id of labels){const label=await space.records.get('label',id);this.#current();const body=label.body as SharedRecordBody;
   if(label.deleted||body.table!=='shared_space_labels'||body.record.space_id!==intent.input.spaceId)throw new Error('E2EE_PRODUCT_PARENT_INVALID');}
  const tags=[...new Set(intent.input.tags.map(value=>trim(value).replace(/^#+/,'')).filter(Boolean))];
  const project:SharedRecordBody={format:'genesis-shared-record-v1',kind:'project',scopeId:intent.scopeId,scopeKind:'project',resourceId:intent.resourceId,table:'shared_projects',
   record:{...root,title:trim(intent.input.title),description:intent.input.description,tags_json:JSON.stringify(tags),revision:2,updated_at:intent.preparation.createdAt} as SharedRecordBody['record'],
   related:{shared_project_labels:labels.map(id=>({project_id:intent.resourceId,label_id:id}))},execution:'live'};
  const bodies:SharedRecordBody[]=[project],source=await records.sourceTable('shared_project_statuses');this.#current();
  const titles=[intent.input.statusTitles.chaos,intent.input.statusTitles.chaos,intent.input.statusTitles.open,intent.input.statusTitles.progress,intent.input.statusTitles.done];
  for(const [at,status]of intent.preparation.statuses.entries()){
   const rows=source.filter(row=>row.id===status.id);if(rows.length!==1||rows[0].project_id!==intent.resourceId||rows[0].is_done!==status.isDone||rows[0].is_chaos!==status.isChaos
    ||rows[0].position!==([-2,-1,0,1,2][at]))throw new Error('E2EE_PRIVATE_SEED_REQUIRED');
   bodies.push({format:'genesis-shared-record-v1',kind:'status',scopeId:intent.scopeId,scopeKind:'project',resourceId:intent.resourceId,table:'shared_project_statuses',
    record:{...rows[0],title:trim(titles[at]),revision:2} as SharedRecordBody['record'],related:{},execution:'live'});
  }
  return{records,bodies};
 }
 applyInitialValues(id:string){return this.#run(async()=>{
  const intent=await this.inspect(id);if(phases.indexOf(intent.phase)<phases.indexOf('migrated'))throw new Error('E2EE_MIGRATION_UNVERIFIED');if(intent.phase==='complete')return intent;
  const {records,bodies}=await this.#initialBodies(intent),request='resource-create-values:'+id;
  await records.product.stage(bodies.map(body=>({action:'update' as const,entityId:sharedRecordKey(body.kind,body.record),kind:body.kind,expectedRevision:1,parentId:sharedBodyParent(body),metadata:sharedBodyMetadata(body),body})),request);this.#current();
  await records.flush(request);this.#current();for(const body of bodies){
   const value=await records.get(body.kind,String(body.record.id));this.#current();if(value.deleted||value.revision!==2||!same(value.body,body))throw new Error('E2EE_PRIVATE_RESOURCE_CREATE_UNVERIFIED');
  }
  const document=this.#document(id),before=await document.load();this.#current();if(!before||!same(before.value,intent))throw new Error('E2EE_LOCAL_CONFLICT');
  if(before.value.phase!=='values')await document.save({...before.value,phase:'values'},before.serial);this.#current();return this.inspect(id);
 });}
 complete(id:string){return this.#run(async()=>{
  const document=this.#document(id),before=await document.load();this.#current();if(!before||!['values','complete'].includes(before.value.phase))throw new Error('E2EE_PRIVATE_RESOURCE_CREATE_UNVERIFIED');
  if(before.value.phase!=='complete')await document.save({...before.value,phase:'complete'},before.serial);this.#current();return this.inspect(id);
 });}
}
