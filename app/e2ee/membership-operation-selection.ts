import {assertTechnical,exactKeys} from './keys.ts';
import {samePrivateJson as same} from './product-json.ts';
import {membershipBeforeHash,type MembershipChange} from './membership-contract.ts';
import {validateMembershipOperation,validateMembershipOperationSnapshot,type MembershipOperation,type MembershipOperationSnapshot,type MembershipGraphScope,type MembershipGraphProject} from './membership-operation-plan.ts';
import {productEntity,type ProductEntity} from './product-contract.ts';
import {sharedBodyMetadata,type SharedRecordBody} from './shared-domain.ts';
import type {ProductVersion} from './shared-product.ts';
import {membershipProductIndexHash} from './membership-product-index.ts';

export type MembershipGraphDiscovery={spaceId:string;spaceScopeId:string|null;spaceUserIds:string[];projects:{id:string;parentId:string|null;isInbox:boolean;archived:boolean;inTrash:boolean;scopeId:string|null}[]};
export type MembershipOpenedScope={scope:Omit<MembershipGraphScope,'root'>;generation:number;directoryRevision:number;checkpointHash:string;entities:ProductEntity[]};
export interface MembershipSelectionPorts{
 actorId:string;current:()=>void;
 /** Independently pinned normal scope bindings, never accepted from discovery. */
 bindings:()=>Promise<{kind:'space'|'project';resourceId:string;scopeId:string}[]>;
 graph:(spaceId:string)=>Promise<unknown>;
 open:(kind:'space'|'project',resourceId:string,scopeId:string)=>Promise<MembershipOpenedScope>;
 read:(scopeId:string,entity:ProductEntity)=>Promise<ProductVersion>;
 state:(targets:Pick<MembershipChange,'table'|'key'>[])=>Promise<unknown>;
}
const changed=():never=>{throw new Error('E2EE_MEMBERSHIP_STALE');};
export function validateMembershipGraphDiscovery(input:unknown):MembershipGraphDiscovery{
 exactKeys(input,['spaceId','spaceScopeId','spaceUserIds','projects']);assertTechnical(input.spaceId);if(input.spaceScopeId!==null)assertTechnical(input.spaceScopeId);
 if(!Array.isArray(input.spaceUserIds)||input.spaceUserIds.length>200||!Array.isArray(input.projects)||input.projects.length>5000)changed();
 for(const id of input.spaceUserIds)assertTechnical(id);if(!same([...new Set(input.spaceUserIds)].sort(),input.spaceUserIds))changed();
 const seen=new Set<string>();for(const row of input.projects){exactKeys(row,['id','parentId','isInbox','archived','inTrash','scopeId']);assertTechnical(row.id);if(row.parentId!==null)assertTechnical(row.parentId);if(row.scopeId!==null)assertTechnical(row.scopeId);
  if(seen.has(row.id)||typeof row.isInbox!=='boolean'||typeof row.archived!=='boolean'||typeof row.inTrash!=='boolean')changed();seen.add(row.id);
 }
 return structuredClone(input) as MembershipGraphDiscovery;
}
/** Obtains every selected head through the real pinned product repository and
 * decrypts its immutable version. Discovery supplies routing, never authority.
 * The graph, pins, directories and roots are rechecked after the ACL read. */
export async function captureMembershipOperationSnapshot(raw:unknown,ports:MembershipSelectionPorts):Promise<MembershipOperationSnapshot>{
 const operation=validateMembershipOperation(raw);ports.current();const pins=await ports.bindings();ports.current();
 const opened=new Map<string,{kind:'space'|'project';resourceId:string;value:MembershipOpenedScope;root:ProductEntity;scope:MembershipGraphScope}>();
 const open=async(kind:'space'|'project',resourceId:string,expectedId?:string|null)=>{
  const matches=pins.filter(row=>row.kind===kind&&row.resourceId===resourceId);if(matches.length!==1||expectedId!==undefined&&matches[0].scopeId!==expectedId)throw new Error('E2EE_SHARED_FINGERPRINT_REQUIRED');
  const pin=matches[0],old=opened.get(pin.scopeId);if(old)return old;const value=await ports.open(kind,resourceId,pin.scopeId);ports.current();
  if(value.scope.scopeId!==pin.scopeId||!['active','retirement'].includes(value.scope.state))throw new Error('E2EE_SHARED_TRANSITION_REQUIRED');
  const roots=value.entities.filter(row=>row.kind===kind&&row.entityId===kind+':'+resourceId);if(roots.length!==1)throw new Error('E2EE_PRODUCT_ENTITY_MISSING');const root=productEntity(roots[0]);
  const scope:MembershipGraphScope={...value.scope,root:{scopeId:pin.scopeId,entityId:root.entityId,generation:value.generation,directoryRevision:value.directoryRevision,checkpointHash:value.checkpointHash,revision:root.revision,payloadHash:root.payloadHash,productIndexHash:membershipProductIndexHash(pin.scopeId,value.entities)}};
  const result={kind,resourceId,value,root,scope};opened.set(pin.scopeId,result);return result;
 };
 const body=async(entry:Awaited<ReturnType<typeof open>>)=>{const value=await ports.read(entry.scope.scopeId,entry.root);ports.current();
  if(value.entityId!==entry.root.entityId||value.kind!==entry.kind||value.revision!==entry.root.revision||value.deleted!==entry.root.deleted||!same(value.metadata,entry.root.metadata))changed();
  if(value.body!==null){const result=value.body as SharedRecordBody;if(result.kind!==entry.kind||result.scopeId!==entry.scope.scopeId||result.scopeKind!==entry.kind||result.resourceId!==entry.resourceId||result.execution!=='live')changed();
   if(entry.kind==='project'&&!same(sharedBodyMetadata(result),entry.root.metadata))changed();return result;}
  if(!value.deleted)changed();return null;
 };
 let spaceId:string;if('spaceId'in operation)spaceId=operation.spaceId;else{const selected=await open('project',operation.projectId);await body(selected);
  if(selected.root.metadata.protocol!==2||!selected.root.metadata.spaceId)throw new Error('E2EE_PROJECT_TOPOLOGY_REQUIRED');spaceId=selected.root.metadata.spaceId;
 }
 const graph=validateMembershipGraphDiscovery(await ports.graph(spaceId));ports.current();if(graph.spaceId!==spaceId)changed();
 const space=await open('space',spaceId,graph.spaceScopeId);if(space.root.deleted)changed();const spaceBody=await body(space);if(spaceBody?.record.id!==spaceId)changed();
 const projects:MembershipGraphProject[]=[];
 for(const row of graph.projects){const project=await open('project',row.id,row.scopeId);await body(project);const metadata=project.root.metadata;
  if(metadata.protocol!==2||metadata.spaceId!==spaceId||metadata.parentProjectId!==row.parentId||metadata.isInbox!==row.isInbox||metadata.archived!==row.archived||project.root.deleted!==row.inTrash)changed();
  projects.push({id:row.id,parentId:row.parentId,isInbox:row.isInbox,archived:row.archived,inTrash:row.inTrash,scope:project.scope});
 }
 // Check the complete previously pinned namespace, including roots omitted
 // from routing. Unseen history cannot be proven complete on a fresh device.
 for(const pin of pins)if(pin.kind==='project'&&!graph.projects.some(row=>row.scopeId===pin.scopeId)){
  const candidate=await open('project',pin.resourceId,pin.scopeId);await body(candidate);if(candidate.root.metadata.protocol!==2)throw new Error('E2EE_PROJECT_TOPOLOGY_REQUIRED');if(candidate.root.metadata.spaceId===spaceId)changed();
 }
 const rows:MembershipOperationSnapshot['rows']=[];
 const read=async(targets:Pick<MembershipChange,'table'|'key'>[])=>{const response=await ports.state(targets);ports.current();exactKeys(response,['rows']);if(!Array.isArray(response.rows)||response.rows.length!==targets.length)changed();
  for(const [at,row]of response.rows.entries()){exactKeys(row,['table','key','before','beforeHash']);if(row.table!==targets[at].table||!same(row.key,targets[at].key)||row.beforeHash!==membershipBeforeHash(targets[at].table,row.before))changed();rows.push(structuredClone(row) as MembershipOperationSnapshot['rows'][number]);}
 };
 for(let offset=0;offset<graph.spaceUserIds.length;offset+=200)await read(graph.spaceUserIds.slice(offset,offset+200).map(userId=>({table:'shared_space_members',key:{space_id:spaceId,user_id:userId}})));
 if(operation.kind==='invitation-admit'&&!graph.spaceUserIds.includes(operation.userId))await read([{table:'shared_space_members',key:{space_id:spaceId,user_id:operation.userId}}]);
 const complete=new Set<string>([ports.actorId]);if('userId'in operation)complete.add(operation.userId);
 if(operation.kind==='category-permissions')for(const row of rows)if(row.before?.member_category_id===operation.categoryId&&row.before.role!=='owner')complete.add(row.key.user_id);
 if('categoryId'in operation&&operation.categoryId!==null)await read([{table:'shared_member_categories',key:{id:operation.categoryId,space_id:spaceId}}]);
 const targets:Pick<MembershipChange,'table'|'key'>[]=[];for(const userId of [...complete].sort())for(const project of projects)targets.push(
  {table:'shared_project_members',key:{project_id:project.id,user_id:userId}},
  {table:'shared_member_project_grants',key:{space_id:spaceId,user_id:userId,project_id:project.id}});
 for(let offset=0;offset<targets.length;offset+=200)await read(targets.slice(offset,offset+200));
 if(!same(validateMembershipGraphDiscovery(await ports.graph(spaceId)),graph))changed();ports.current();
 for(const entry of opened.values()){const fresh=await ports.open(entry.kind,entry.resourceId,entry.scope.scopeId);ports.current();
  const root=fresh.entities.find(row=>row.entityId===entry.root.entityId);if(!same(fresh.scope,entry.value.scope)||fresh.generation!==entry.value.generation||fresh.directoryRevision!==entry.value.directoryRevision||fresh.checkpointHash!==entry.value.checkpointHash||!same(root,entry.root)||membershipProductIndexHash(entry.scope.scopeId,fresh.entities)!==entry.scope.root.productIndexHash)changed();
 }
 const after=await ports.bindings();ports.current();if(!same(after,pins))changed();
 return validateMembershipOperationSnapshot({format:'genesis-membership-operation-snapshot-v1',actorId:ports.actorId,spaceId,spaceScope:space.scope,projects,spaceUserIds:graph.spaceUserIds,completeUserIds:[...complete].sort(),rows});
}
