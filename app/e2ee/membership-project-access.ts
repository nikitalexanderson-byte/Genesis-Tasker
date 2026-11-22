import {assertTechnical,exactKeys} from './keys.ts';
import {parseLegacyMigrationJson} from './legacy-json.ts';
import {decodeE2eeBytes} from './envelope.ts';
import {membershipOperationFingerprint,validateMembershipOperation,validateMembershipOperationSnapshot,type MembershipGraphScope,type MembershipOperationSnapshot,type MembershipPermissions} from './membership-operation-plan.ts';
import {membershipProductIndexHash} from './membership-product-index.ts';
import {validateSharedRecordBody,type SharedRecordBody} from './shared-domain.ts';
import type {ProductEntity} from './product-contract.ts';
import type {ProductVersion} from './shared-product.ts';
import type {SharedProjectAccessDraft,SharedProjectAccessState,SharedProjectAccessPreview,ProjectAccessPermissions} from '../shared-project-access.ts';

const permissionKeys=['createProjects','editTasks','organizeTasks','comment','manageProjects','inviteMembers'] as const;
const stale=():never=>{throw new Error('E2EE_MEMBERSHIP_STALE');};
export function membershipProjectAccessProbe(spaceId:string,userId:string){assertTechnical(spaceId);assertTechnical(userId);return{kind:'project-grants' as const,spaceId,userId,allProjects:true,grants:[]};}
/** Hashes technical topology/ACL and ciphertext references, never the decrypted
 * project names or task values used by the human-facing catalogue. */
export function membershipProjectAccessFingerprint(snapshot:MembershipOperationSnapshot,userId:string){
 const bytes=decodeE2eeBytes(membershipOperationFingerprint(snapshot,membershipProjectAccessProbe(snapshot.spaceId,userId)),32);
 try{return Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('');}finally{bytes.fill(0);}
}
export function privateMembershipPermissions(spaceRole:string,override:MembershipPermissions|null,organize:boolean,projectRole:string|null=null,restricted=false):MembershipPermissions{
 const manager=spaceRole==='owner'||spaceRole==='admin',role=projectRole??(manager?'manager':spaceRole==='guest'?'viewer':'member');
 const defaults:MembershipPermissions={createProjects:spaceRole!=='guest',editTasks:['owner','manager','member'].includes(role),organizeTasks:manager||['owner','manager'].includes(role)||organize&&role==='member',comment:['owner','manager','member','commenter'].includes(role),manageProjects:['owner','manager'].includes(role),inviteMembers:['owner','manager'].includes(role)};
 const value:MembershipPermissions=spaceRole==='owner'?Object.fromEntries(permissionKeys.map(key=>[key,true])) as MembershipPermissions:structuredClone(override??defaults);
 if(restricted&&!manager){value.createProjects=false;value.manageProjects=false;value.inviteMembers=false;if(projectRole!==null){value.editTasks&&=projectRole==='member';value.organizeTasks&&=projectRole==='member';value.comment&&=['member','commenter'].includes(projectRole);}}return value;
}
export interface PrivateProjectAccessPorts{
 current:()=>void;
 open:(scope:MembershipGraphScope,kind:'space'|'project',resourceId:string)=>Promise<ProductEntity[]>;
 read:(scopeId:string,entity:ProductEntity)=>Promise<ProductVersion>;
 history:(scopeId:string,entityId:string,before:number)=>Promise<{versions:ProductVersion[];nextBefore:number|null}>;
}
export function privateProjectAccessMembers(raw:MembershipOperationSnapshot,root:ProductVersion,labels:{userId:string;displayName:string}[]){
 const snapshot=validateMembershipOperationSnapshot(raw),scope=snapshot.spaceScope;if(!scope||scope.ownerId!==snapshot.actorId||root.scopeId!==scope.scopeId||root.entityId!==scope.root.entityId||root.revision!==scope.root.revision||root.deleted)stale();
 if(snapshot.rows.find(row=>row.table==='shared_space_members'&&row.key.user_id===snapshot.actorId)?.before?.role!=='owner')throw new Error('E2EE_OWNER_REQUIRED');
 if(!Array.isArray(labels)||labels.length>200)stale();
 const body=validateSharedRecordBody({scopeId:scope.scopeId,kind:'space',resourceId:snapshot.spaceId},'space',root.body,root),names=new Map<string,string>();
 for(const row of labels){assertTechnical(row.userId);if(names.has(row.userId)||typeof row.displayName!=='string'||row.displayName.length>2000)stale();names.set(row.userId,row.displayName);}
 return{space:{id:snapshot.spaceId,title:body.record.title,role:'owner'},members:snapshot.spaceUserIds.map(userId=>{const row=snapshot.rows.find(row=>row.table==='shared_space_members'&&row.key.user_id===userId)?.before;if(!row||!names.has(userId))stale();return{userId,displayName:names.get(userId)!,role:row.role};})};
}
/** Only independently pinned normal repositories may supply these ports. Every
 * current index is compared with the captured complete signed index. */
export async function privateProjectAccessView(raw:MembershipOperationSnapshot,userId:string,desired:SharedProjectAccessDraft|null,ports:PrivateProjectAccessPorts):Promise<SharedProjectAccessState|SharedProjectAccessPreview>{
 const snapshot=validateMembershipOperationSnapshot(raw),actor=snapshot.rows.find(row=>row.table==='shared_space_members'&&row.key.user_id===snapshot.actorId)?.before;
 if(!snapshot.spaceScope||snapshot.spaceScope.ownerId!==snapshot.actorId||actor?.role!=='owner')throw new Error('E2EE_OWNER_REQUIRED');
 const member=snapshot.rows.find(row=>row.table==='shared_space_members'&&row.key.user_id===userId)?.before;if(!member||!snapshot.completeUserIds.includes(userId))stale();
 const role=String(member.role),manager=role==='owner'||role==='admin',organize=member.can_organize_tasks===1;
 let override:MembershipPermissions|null=null;
 if(member.permissions_json!==null&&member.permissions_json!==''){
  if(typeof member.permissions_json!=='string')stale();
  const operation=validateMembershipOperation({kind:'member-permissions',spaceId:snapshot.spaceId,userId,categoryId:null,permissions:parseLegacyMigrationJson(member.permissions_json,'E2EE_MEMBERSHIP_OPERATION_INVALID',16384)});if(operation.kind!=='member-permissions')stale();override=operation.permissions;
 }
 const projects:SharedProjectAccessState['projects']=[],opened:{scope:MembershipGraphScope;kind:'project';resourceId:string}[]=[];
 for(const project of snapshot.projects){ports.current();const scope=project.scope;if(!scope?.root.productIndexHash)stale();const entities=await ports.open(scope,'project',project.id);ports.current();
  if(membershipProductIndexHash(scope.scopeId,entities)!==scope.root.productIndexHash)stale();const root=entities.find(row=>row.entityId===scope.root.entityId);if(!root||root.payloadHash!==scope.root.payloadHash||root.revision!==scope.root.revision)stale();
  let version=await ports.read(scope.scopeId,root);ports.current();
  if(version.deleted){let before:number|null=version.revision,found:ProductVersion|null=null;const seen=new Set<number>();while(before!==null&&!found){if(seen.has(before))stale();seen.add(before);const history=await ports.history(scope.scopeId,root.entityId,before);ports.current();found=history.versions.find(row=>!row.deleted)??null;if(history.nextBefore!==null&&(!Number.isSafeInteger(history.nextBefore)||history.nextBefore<1||history.nextBefore>=before))stale();before=history.nextBefore;}if(!found)throw new Error('E2EE_PRIVATE_CONTENT_UNAVAILABLE');version=found;}
  if(version.scopeId!==scope.scopeId||version.entityId!==root.entityId||version.kind!=='project'||version.deleted||version.revision>root.revision)stale();
  const binding={scopeId:scope.scopeId,kind:'project' as const,resourceId:project.id},body=validateSharedRecordBody(binding,'project',version.body,version) as SharedRecordBody;
  let assignedTaskCount=0;for(const entity of entities)if(entity.kind==='task'&&!entity.deleted){const task=await ports.read(scope.scopeId,entity);ports.current();if(task.scopeId!==scope.scopeId||task.entityId!==entity.entityId||task.revision!==entity.revision||task.deleted)stale();const value=validateSharedRecordBody(binding,'task',task.body,task);if(value.record.assignee_id===userId)assignedTaskCount++;}
  const membership=snapshot.rows.find(row=>row.table==='shared_project_members'&&row.key.project_id===project.id&&row.key.user_id===userId)?.before;
  projects.push({id:project.id,title:String(body.record.title),parentId:project.parentId,isInbox:project.isInbox?1:0,archivedAt:project.archived?String(body.record.archived_at??''):null,inTrash:project.inTrash?1:0,revision:root.revision,role:membership?String(membership.role):null,assignedTaskCount});opened.push({scope,kind:'project',resourceId:project.id});
 }
 for(const item of opened){const index=await ports.open(item.scope,item.kind,item.resourceId);ports.current();if(membershipProductIndexHash(item.scope.scopeId,index)!==item.scope.root.productIndexHash)stale();}
 const restricted=!manager&&member.project_access_restricted===1,grants:SharedProjectAccessDraft['grants']=restricted?snapshot.rows.filter(row=>row.table==='shared_member_project_grants'&&row.key.user_id===userId&&row.before!==null).map(row=>({projectId:row.key.project_id,role:(row.before!.excluded===1?'none':String(row.before!.role)) as SharedProjectAccessDraft['grants'][number]['role'],includeDescendants:row.before!.include_descendants===1})):projects.filter(row=>row.role!==null).map(row=>({projectId:row.id,role:row.role==='viewer'||row.role==='commenter'?row.role:'member',includeDescendants:false}));
 const state:SharedProjectAccessState={spaceId:snapshot.spaceId,userId,memberRole:role,allProjects:manager||member.all_projects===1,restricted,revision:Number(member.project_access_revision),fingerprint:membershipProjectAccessFingerprint(snapshot,userId),projects,grants,spacePermissions:privateMembershipPermissions(role,override,organize),permissionsOverride:override,canOrganizeTasks:organize};
 if(desired===null)return state;exactKeys(desired,['allProjects','grants']);if(manager)throw new Error('PROJECT_ACCESS_MANAGER_UNRESTRICTED');
 const operation=validateMembershipOperation({...membershipProjectAccessProbe(snapshot.spaceId,userId),...desired});if(operation.kind!=='project-grants')stale();
 const rules=new Map(operation.grants.map(row=>[row.projectId,row])),byId=new Map(projects.map(row=>[row.id,row]));for(const id of rules.keys())if(!byId.has(id))throw new Error('E2EE_PRODUCT_PARENT_INVALID');
 const effectiveRoles:Record<string,string|null>={},changes:SharedProjectAccessPreview['changes']=[],blockers:SharedProjectAccessPreview['blockers']=[];
 for(const project of projects){let next:string|null=null;if(operation.allProjects)next=project.role==='owner'?'owner':role==='guest'?'viewer':'member';else{let cursor:string|null=project.id;const seen=new Set<string>();while(cursor!==null){if(seen.has(cursor))stale();seen.add(cursor);const rule=rules.get(cursor);if(rule&&(cursor===project.id||rule.includeDescendants)){next=rule.role==='none'?null:rule.role;break;}cursor=byId.get(cursor)?.parentId??null;}}effectiveRoles[project.id]=next;
  const permissions=(value:string|null,limited:boolean):ProjectAccessPermissions=>value===null?{read:false,...Object.fromEntries(permissionKeys.map(key=>[key,false]))} as ProjectAccessPermissions:{read:true,...privateMembershipPermissions(role,override,organize,value,limited)};
  const before=permissions(project.role,restricted),after=permissions(next,!operation.allProjects);if(project.role===next&&permissionKeys.every(key=>before[key]===after[key]))continue;
  if(project.role==='owner'&&next!=='owner')blockers.push({projectId:project.id,code:'LAST_OWNER'});
  changes.push({projectId:project.id,title:project.title,from:project.role,to:next,clearedAssignments:next===null?project.assignedTaskCount:0,beforePermissions:before,afterPermissions:after});
 }
 return{fingerprint:state.fingerprint,revision:state.revision,desired:{allProjects:operation.allProjects,grants:operation.grants},projects,changes,blockers,effectiveRoles};
}
