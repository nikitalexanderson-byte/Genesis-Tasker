import {assertTechnical,exactKeys} from './keys.ts';
import {decodeE2eeBytes,encodeE2eeBytes} from './envelope.ts';
import {canonicalE2eeValue,type WireValue} from './commands.ts';
import {sha256} from '@noble/hashes/sha2.js';
import {samePrivateJson as same} from './product-json.ts';
import {MEMBERSHIP_SPECS,membershipBeforeHash,membershipFields,membershipChangesProjection,validateMembershipChanges,type MembershipChange} from './membership-contract.ts';

export type MembershipPermissions=Record<'createProjects'|'editTasks'|'organizeTasks'|'comment'|'manageProjects'|'inviteMembers',boolean>;
export type MembershipInvitationAdmission={kind:'invitation-admit';spaceId:string;resourceId:string;invitationId:string;invitationKind:'space'|'project';userId:string;role:'admin'|'member'|'guest'|'manager'|'commenter'|'viewer';permissions:MembershipPermissions|null;createdBy:string;acceptedAt:string};
export type MembershipOperation=
 |MembershipInvitationAdmission
 |{kind:'project-role';projectId:string;userId:string;role:'manager'|'member'|'commenter'|'viewer'}
 |{kind:'project-remove';projectId:string;userId:string}
 |{kind:'space-role';spaceId:string;userId:string;role:'admin'|'member'|'guest';permissions?:MembershipPermissions|null;canOrganizeTasks?:boolean}
 |{kind:'member-permissions';spaceId:string;userId:string;categoryId:string|null;permissions:MembershipPermissions|null}
 |{kind:'project-grants';spaceId:string;userId:string;allProjects:boolean;grants:{projectId:string;role:'member'|'commenter'|'viewer'|'none';includeDescendants:boolean}[]}
 |{kind:'category-permissions';spaceId:string;categoryId:string;expectedRevision:number;permissions:MembershipPermissions;rename?:true;privateTitle?:string};
export type MembershipGraphScope={scopeId:string;ownerId:string;state:'preparing'|'uploading'|'verified'|'active'|'retirement';root:{scopeId:string;entityId:string;generation:number;directoryRevision:number;checkpointHash:string;revision:number;payloadHash:string;productIndexHash?:string}};
export type MembershipGraphProject={id:string;parentId:string|null;isInbox:boolean;archived:boolean;inTrash:boolean;scope:MembershipGraphScope|null};
export type MembershipOperationSnapshot={format:'genesis-membership-operation-snapshot-v1';actorId:string;spaceId:string;spaceScope:MembershipGraphScope|null;projects:MembershipGraphProject[];
 spaceUserIds:string[];completeUserIds:string[];rows:{table:MembershipChange['table'];key:Record<string,string>;before:Record<string,WireValue>|null;beforeHash:string}[]};
type ClearAssignment={projectId:string;userId:string};
type Revoke={kind:'space'|'project';resourceId:string;userId:string};
export type MembershipOperationPlan={format:'genesis-membership-operation-plan-v1';operation:MembershipOperation;changes:MembershipChange[];scopeIds:string[];requiredScopes:MembershipGraphScope[];
 clearAssignments:ClearAssignment[];revokeInvitations:Revoke[];roleEvents:{projectId:string;userId:string;from:string|null;to:string|null}[]};
const digest=(value:unknown)=>{const bytes=canonicalE2eeValue(value as WireValue);try{return encodeE2eeBytes(sha256(bytes));}finally{bytes.fill(0);}};
const pageHashes=(items:unknown[])=>{const pages:string[]=[];for(let offset=0;offset<items.length;offset+=200)pages.push(digest(items.slice(offset,offset+200)));return{count:items.length,pages};};
/** Bounded page hashes retain the complete graph/ACL input, including a grant
 * set larger than one command. SQL names remain values in this projection. */
export function membershipOperationFingerprint(raw:unknown,rawOperation:unknown){
 const snapshot=validateMembershipOperationSnapshot(raw),operation=validateMembershipOperation(rawOperation),pages:string[]=[];
 for(let offset=0;offset<snapshot.rows.length;offset+=200)pages.push(digest(snapshot.rows.slice(offset,offset+200).map(row=>({table:row.table,key:membershipFields(row.key),beforeHash:row.beforeHash}))));
 return digest({format:'genesis-membership-operation-review-v1',operation:membershipOperationWire(operation),snapshot:{...snapshot,projects:pageHashes(snapshot.projects),rows:{count:snapshot.rows.length,pages}}});
}
export function membershipOperationPlanFingerprint(plan:MembershipOperationPlan){
 const pages:string[]=[];for(let offset=0;offset<plan.changes.length;offset+=200)pages.push(digest(membershipChangesProjection(plan.changes.slice(offset,offset+200))));
 return digest({...plan,operation:membershipOperationWire(plan.operation),changes:{count:plan.changes.length,pages},scopeIds:pageHashes(plan.scopeIds),requiredScopes:pageHashes(plan.requiredScopes),clearAssignments:pageHashes(plan.clearAssignments),revokeInvitations:pageHashes(plan.revokeInvitations),roleEvents:pageHashes(plan.roleEvents)});
}
function invalid():never{throw new Error('E2EE_MEMBERSHIP_OPERATION_INVALID');}
const permissionsKeys=['createProjects','editTasks','organizeTasks','comment','manageProjects','inviteMembers'];
function permissions(value:unknown):MembershipPermissions{exactKeys(value,permissionsKeys);if(Object.values(value).some(item=>typeof item!=='boolean'))invalid();return structuredClone(value) as MembershipPermissions;}
const fields=(table:MembershipChange['table'],row:Record<string,WireValue>)=>Object.fromEntries(MEMBERSHIP_SPECS[table].fields.map(name=>[name,row[name]]));
function coordinate(table:MembershipChange['table'],key:Record<string,string>){return table+'\0'+JSON.stringify(Object.keys(key).sort().map(name=>[name,key[name]]));}
export function validateMembershipOperation(input:unknown):MembershipOperation{
 if(!input||typeof input!=='object'||Array.isArray(input))invalid();const value=input as Record<string,unknown>;
 switch(value.kind){
  case'invitation-admit':exactKeys(value,["kind","spaceId","resourceId","invitationId","invitationKind","userId","role","permissions","createdBy","acceptedAt"]);
   for(const key of ['resourceId','invitationId','createdBy'])assertTechnical(value[key]);
   if(!['space','project'].includes(String(value.invitationKind))||!(value.invitationKind==='space'?['admin','member','guest']:['manager','member','commenter','viewer']).includes(String(value.role))||value.invitationKind==='project'&&value.permissions!==null||typeof value.acceptedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value.acceptedAt)||!Number.isFinite(Date.parse(value.acceptedAt)))invalid();
   if(value.permissions!==null)permissions(value.permissions);if(value.invitationKind==='space'&&value.resourceId!==value.spaceId)invalid();break;
  case'project-role':exactKeys(value,['kind','projectId','userId','role']);if(!['manager','member','commenter','viewer'].includes(String(value.role)))invalid();break;
  case'project-remove':exactKeys(value,['kind','projectId','userId']);break;
  case'space-role':exactKeys(value,['kind','spaceId','userId','role',...(Object.hasOwn(value,'permissions')?['permissions']:[]),...(Object.hasOwn(value,'canOrganizeTasks')?['canOrganizeTasks']:[])]);
   if(!['admin','member','guest'].includes(String(value.role)))invalid();if(Object.hasOwn(value,'permissions')&&value.permissions!==null)permissions(value.permissions);if(Object.hasOwn(value,'canOrganizeTasks')&&typeof value.canOrganizeTasks!=='boolean')invalid();break;
  case'member-permissions':exactKeys(value,['kind','spaceId','userId','categoryId','permissions']);if(value.categoryId!==null)assertTechnical(value.categoryId);if(value.permissions!==null)permissions(value.permissions);if(value.categoryId===null&&value.permissions===null)invalid();break;
  case'project-grants':exactKeys(value,['kind','spaceId','userId','allProjects','grants']);if(typeof value.allProjects!=='boolean'||!Array.isArray(value.grants)||value.grants.length>5000||value.allProjects&&value.grants.length)invalid();
   {const ids=new Set<string>();for(const grant of value.grants){exactKeys(grant,['projectId','role','includeDescendants']);assertTechnical(grant.projectId);if(ids.has(grant.projectId)||!['member','commenter','viewer','none'].includes(String(grant.role))||typeof grant.includeDescendants!=='boolean')invalid();ids.add(grant.projectId);}}break;
  case'category-permissions':exactKeys(value,['kind','spaceId','categoryId','expectedRevision','permissions',...(Object.hasOwn(value,'rename')?['rename']:[]),...(Object.hasOwn(value,'privateTitle')?['privateTitle']:[])]);if(Object.hasOwn(value,'rename')&&value.rename!==true)invalid();if(Object.hasOwn(value,'privateTitle')&&(value.rename!==true||typeof value.privateTitle!=='string'||!value.privateTitle.trim()||value.privateTitle.length>2000))invalid();assertTechnical(value.categoryId);if(!Number.isSafeInteger(value.expectedRevision)||Number(value.expectedRevision)<0)invalid();permissions(value.permissions);break;
  default:invalid();
 }
 for(const key of ['spaceId','projectId','userId'])if(Object.hasOwn(value,key))assertTechnical(value[key]);return structuredClone(value) as MembershipOperation;
}
/** Technical operation projection. The private title stays only in encrypted
 * local input and encrypted category versions; no title hash reaches the API. */
export function membershipOperationWire(input:MembershipOperation):MembershipOperation{const value=validateMembershipOperation(input);if(value.kind==='category-permissions')delete value.privateTitle;return value;}
export function localMembershipOperation(input:unknown):MembershipOperation{const value=validateMembershipOperation(input);if(value.kind==='category-permissions'&&value.rename&&value.privateTitle===undefined)throw new Error('E2EE_MEMBERSHIP_PRIVATE_INPUT_REQUIRED');return value;}
function validateScope(value:unknown,entityId:string):MembershipGraphScope|null{
 if(value===null)return null;exactKeys(value,['scopeId','ownerId','state','root']);assertTechnical(value.scopeId);assertTechnical(value.ownerId);
 if(!['preparing','uploading','verified','active','retirement'].includes(String(value.state)))invalid();
 exactKeys(value.root,['scopeId','entityId','generation','directoryRevision','checkpointHash','revision','payloadHash',...(value.root&&typeof value.root==='object'&&Object.hasOwn(value.root,'productIndexHash')?['productIndexHash']:[])]);
 if(value.root.scopeId!==value.scopeId||value.root.entityId!==entityId)invalid();for(const key of ['generation','directoryRevision','revision'])if(!Number.isSafeInteger(value.root[key])||Number(value.root[key])<1)invalid();
 decodeE2eeBytes(value.root.checkpointHash,32);decodeE2eeBytes(value.root.payloadHash,32);if(Object.hasOwn(value.root,'productIndexHash'))decodeE2eeBytes(value.root.productIndexHash,32);return structuredClone(value) as MembershipGraphScope;
}
export function validateMembershipOperationSnapshot(input:unknown):MembershipOperationSnapshot{
 exactKeys(input,['format','actorId','spaceId','spaceScope','projects','spaceUserIds','completeUserIds','rows']);
 if(input.format!=='genesis-membership-operation-snapshot-v1'||!Array.isArray(input.projects)||input.projects.length>5000||!Array.isArray(input.spaceUserIds)||input.spaceUserIds.length>200||!Array.isArray(input.completeUserIds)||input.completeUserIds.length>200||!Array.isArray(input.rows)||input.rows.length>1000000)invalid();
 assertTechnical(input.actorId);assertTechnical(input.spaceId);validateScope(input.spaceScope,'space:'+input.spaceId);const projects=new Map<string,MembershipGraphProject>();
 for(const raw of input.projects){exactKeys(raw,['id','parentId','isInbox','archived','inTrash','scope']);assertTechnical(raw.id);if(raw.parentId!==null)assertTechnical(raw.parentId);
  if(projects.has(raw.id)||typeof raw.isInbox!=='boolean'||typeof raw.archived!=='boolean'||typeof raw.inTrash!=='boolean')invalid();validateScope(raw.scope,'project:'+raw.id);projects.set(raw.id,raw as MembershipGraphProject);}
 if([...projects.values()].filter(row=>row.isInbox).length!==1)invalid();
 for(const row of projects.values())if(row.parentId!==null&&(!projects.has(row.parentId)||row.parentId===row.id)||row.isInbox&&row.parentId!==null)invalid();
 // Iterative colour walk accepts the existing hierarchy without recursive
 // stack growth and rejects cycles before any role/index calculation.
 const done=new Set<string>();for(const row of projects.values()){let id:string|null=row.id;const path=new Set<string>();while(id!==null&&!done.has(id)){if(path.has(id))invalid();path.add(id);id=projects.get(id)!.parentId;}for(const id of path)done.add(id);}
 for(const key of ['spaceUserIds','completeUserIds'] as const){const values=input[key];if(!Array.isArray(values))invalid();for(const id of values)assertTechnical(id);if(!same([...new Set(values)].sort(),values))invalid();}
 if(!input.spaceUserIds.includes(input.actorId)||!input.completeUserIds.includes(input.actorId) )invalid();
 const seen=new Set<string>();for(const row of input.rows){exactKeys(row,['table','key','before','beforeHash']);if(typeof row.table!=='string'||!Object.hasOwn(MEMBERSHIP_SPECS,row.table))invalid();
  const table=row.table as MembershipChange['table'],spec=MEMBERSHIP_SPECS[table];exactKeys(row.key,spec.keys);for(const id of Object.values(row.key))assertTechnical(id);
  if(Object.hasOwn(row.key,'space_id')&&row.key.space_id!==input.spaceId||Object.hasOwn(row.key,'project_id')&&!projects.has(String(row.key.project_id)))invalid();
  const id=coordinate(table,row.key as Record<string,string>);if(seen.has(id)||row.beforeHash!==membershipBeforeHash(table,row.before))invalid();seen.add(id);
  if(row.before!==null){for(const [name,id]of Object.entries(row.key))if((row.before as Record<string,unknown>)[name]!==id)invalid();validateMembershipChanges([{table,key:row.key,expectedHash:row.beforeHash,after:fields(table,row.before as Record<string,WireValue>)}]);}
  else if(row.beforeHash!=='absent')invalid();
 }
 const has=(table:MembershipChange['table'],key:Record<string,string>)=>seen.has(coordinate(table,key));
 for(const id of input.spaceUserIds)if(!has('shared_space_members',{space_id:input.spaceId as string,user_id:id}))invalid();
 for(const userId of input.completeUserIds){const row=input.rows.find(row=>row.table==='shared_space_members'&&row.key.space_id===input.spaceId&&row.key.user_id===userId);if(!row||!input.spaceUserIds.includes(userId)&&row.before!==null)invalid();}
 for(const userId of input.completeUserIds)for(const projectId of projects.keys())if(!has('shared_project_members',{project_id:projectId,user_id:userId})||!has('shared_member_project_grants',{space_id:input.spaceId as string,user_id:userId,project_id:projectId}))invalid();
 return structuredClone(input) as MembershipOperationSnapshot;
}
function defaultPermissions(role:string):MembershipPermissions{
 const manager=role==='owner'||role==='admin',projectRole=manager?'manager':role==='guest'?'viewer':'member';
 return{createProjects:role!=='guest',editTasks:['owner','manager','member'].includes(projectRole),organizeTasks:manager,comment:['owner','manager','member','commenter'].includes(projectRole),manageProjects:manager,inviteMembers:manager};
}
/** Pure business semantics shared by browser and the existing isolated native
 * runtime. The composer must independently pin/decrypt all supplied topology,
 * persist complete user input before snapshot IO, and recheck chosen heads.
 * This function neither approves devices, signs packets nor mutates storage. */
export function planMembershipOperation(raw:unknown,rawOperation:unknown):MembershipOperationPlan{
 const snapshot=validateMembershipOperationSnapshot(raw),operation=validateMembershipOperation(rawOperation),spaceId=snapshot.spaceId,projects=new Map(snapshot.projects.map(row=>[row.id,row]));
 if('spaceId'in operation&&operation.spaceId!==spaceId||'projectId'in operation&&!projects.has(operation.projectId))throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
 const original=new Map(snapshot.rows.map(row=>[coordinate(row.table,row.key),row])),after=new Map(snapshot.rows.map(row=>[coordinate(row.table,row.key),structuredClone(row.before)]));
 const assignments=new Map<string,ClearAssignment>(),revokes=new Map<string,Revoke>(),events=new Map<string,MembershipOperationPlan['roleEvents'][number]>();
 const read=(table:MembershipChange['table'],key:Record<string,string>)=>{const id=coordinate(table,key);if(!original.has(id))throw new Error('E2EE_MEMBERSHIP_SNAPSHOT_INCOMPLETE');return after.get(id)!;};
 const put=(table:MembershipChange['table'],key:Record<string,string>,value:Record<string,WireValue>|null)=>{const id=coordinate(table,key);if(!original.has(id))throw new Error('E2EE_MEMBERSHIP_SNAPSHOT_INCOMPLETE');after.set(id,value===null?null:{...key,...value});};
 const space=(userId:string)=>read('shared_space_members',{space_id:spaceId,user_id:userId});
 const member=(projectId:string,userId:string)=>read('shared_project_members',{project_id:projectId,user_id:userId});
 const grant=(projectId:string,userId:string)=>read('shared_member_project_grants',{space_id:spaceId,user_id:userId,project_id:projectId});
 const revoke=(kind:Revoke['kind'],resourceId:string,userId:string)=>{revokes.set(kind+'\0'+resourceId+'\0'+userId,{kind,resourceId,userId});};
 const complete=(userId:string)=>{if(!snapshot.completeUserIds.includes(userId))throw new Error('E2EE_MEMBERSHIP_SNAPSHOT_INCOMPLETE');};
 const setMember=(projectId:string,userId:string,role:string|null)=>{
  complete(userId);const before=member(projectId,userId),old=before?.role??null;if(old===role)return;
  if(old==='owner'||role==='owner')throw new Error('E2EE_OWNER_TRANSFER_REQUIRES_RECOVERY_PLAN');
  put('shared_project_members',{project_id:projectId,user_id:userId},role===null?null:{role});
  if(role===null){const value={projectId,userId};assignments.set(projectId+'\0'+userId,value);}revoke('project',projectId,userId);
  const key=projectId+'\0'+userId,first=events.get(key);events.set(key,{projectId,userId,from:first?first.from:old===null?null:String(old),to:role});
 };
 const recompute=(userId:string)=>{
  const sm=space(userId);if(!sm||sm.project_access_restricted!==1||sm.role==='owner'||sm.role==='admin')return;complete(userId);
  const children=new Map<string|null,string[]>();for(const project of projects.values()){const list=children.get(project.parentId)??[];list.push(project.id);children.set(project.parentId,list);}
  const stack=(children.get(null)??[]).map(id=>({id,inherited:undefined as string|null|undefined}));
  while(stack.length){const {id,inherited}=stack.pop()!,rule=grant(id,userId),own=rule?rule.excluded===1?null:String(rule.role):undefined;
   setMember(id,userId,own===undefined?inherited??null:own);const next=rule?.include_descendants===1?own:inherited;
   for(const child of children.get(id)??[])stack.push({id:child,inherited:next});}
 };
 const actorSpace=space(snapshot.actorId);if(!actorSpace)throw new Error('E2EE_OWNER_REQUIRED');
 if(operation.kind==='invitation-admit'){
  if(actorSpace.role!=='owner')throw new Error('E2EE_OWNER_REQUIRED');const userId=operation.userId;complete(userId);const sm=space(userId);
  if(operation.invitationKind==='space'){
   if(operation.resourceId!==spaceId)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
   if(sm?.role!=='owner'){const role=sm&&['admin','member'].includes(String(sm.role))?String(sm.role):operation.role;
    put('shared_space_members',{space_id:spaceId,user_id:userId},{role,can_organize_tasks:sm?.can_organize_tasks??0,all_projects:1,permissions_json:sm?.permissions_json??(operation.permissions===null?null:JSON.stringify(operation.permissions)),member_category_id:sm?.member_category_id??null,project_access_restricted:sm?.project_access_restricted??0,project_access_revision:sm?.project_access_revision??1});}
   const projectRole=operation.role==='guest'?'viewer':operation.role==='admin'?'manager':'member';
   for(const project of projects.values())if(!project.archived&&!project.inTrash){const old=member(project.id,userId);if(!old||!['owner','manager','member','commenter'].includes(String(old.role)))setMember(project.id,userId,projectRole);}
  }else{
   const project=projects.get(operation.resourceId);if(!project||project.archived||project.inTrash||project.isInbox)throw new Error('E2EE_MEMBERSHIP_STALE');
   if(!sm)put('shared_space_members',{space_id:spaceId,user_id:userId},{role:'guest',can_organize_tasks:0,all_projects:0,permissions_json:null,member_category_id:null,project_access_restricted:0,project_access_revision:1});
   if(!member(project.id,userId))setMember(project.id,userId,operation.role);
   if(sm?.project_access_restricted===1){if(!['member','commenter','viewer'].includes(operation.role))throw new Error('PROJECT_ACCESS_MANAGER_UNRESTRICTED');const old=grant(project.id,userId);put('shared_member_project_grants',{space_id:spaceId,user_id:userId,project_id:project.id},{role:operation.role,include_descendants:old?.include_descendants??0,excluded:0});}
   if(sm&&sm.role!=='guest')for(const row of projects.values())if(row.isInbox&&member(row.id,userId)===null)setMember(row.id,userId,'member');recompute(userId);
  }
 }else if(operation.kind==='project-role'||operation.kind==='project-remove'){
  const project=projects.get(operation.projectId)!;if(project.isInbox)throw new Error('INBOX_MEMBERSHIP_MANAGED_BY_SPACE');complete(operation.userId);
  const actor=member(project.id,snapshot.actorId),target=member(project.id,operation.userId),sm=space(operation.userId);
  if(!target||!sm)throw new Error('E2EE_MEMBERSHIP_STALE');if(actor?.role!=='owner')throw new Error('E2EE_OWNER_REQUIRED');
  if(operation.kind==='project-role'){
   setMember(project.id,operation.userId,operation.role);
   if(sm.project_access_restricted===1){if(!['member','commenter','viewer'].includes(operation.role))throw new Error('PROJECT_ACCESS_MANAGER_UNRESTRICTED');const old=grant(project.id,operation.userId);
    put('shared_member_project_grants',{space_id:spaceId,user_id:operation.userId,project_id:project.id},{role:operation.role,include_descendants:old?.include_descendants??0,excluded:0});}
   recompute(operation.userId);
  }else{
   setMember(project.id,operation.userId,null);
   if([...projects.values()].filter(row=>!row.isInbox&&member(row.id,operation.userId)!==null).length===0&&sm.role==='guest'){
    for(const row of projects.values())if(row.isInbox)setMember(row.id,operation.userId,null);
    put('shared_space_members',{space_id:spaceId,user_id:operation.userId},null);revoke('space',spaceId,operation.userId);
    // The FK removes this guest's rules together with the space row. Include
    // every deletion explicitly in the signed plan rather than rely on cascade.
    for(const row of projects.values())if(grant(row.id,operation.userId))put('shared_member_project_grants',{space_id:spaceId,user_id:operation.userId,project_id:row.id},null);
   }else if(sm.project_access_restricted===1){const old=grant(project.id,operation.userId);put('shared_member_project_grants',{space_id:spaceId,user_id:operation.userId,project_id:project.id},{role:old?.role??'viewer',include_descendants:1,excluded:1});}
   else put('shared_member_project_grants',{space_id:spaceId,user_id:operation.userId,project_id:project.id},null);
   recompute(operation.userId);
  }
 }else{
  if(actorSpace.role!=='owner')throw new Error('E2EE_OWNER_REQUIRED');
  if(operation.kind==='category-permissions'){
   const key={id:operation.categoryId,space_id:spaceId},before=read('shared_member_categories',key);if((before?.revision??0)!==operation.expectedRevision)throw new Error('E2EE_MEMBERSHIP_STALE');
   put('shared_member_categories',key,{permissions_json:JSON.stringify(operation.permissions),revision:operation.expectedRevision+1});
   for(const userId of snapshot.spaceUserIds){const sm=space(userId);if(sm&&sm.role!=='owner'&&sm.member_category_id===operation.categoryId){complete(userId);
    put('shared_space_members',{space_id:spaceId,user_id:userId},{...fields('shared_space_members',sm),permissions_json:JSON.stringify(operation.permissions),can_organize_tasks:operation.permissions.organizeTasks?1:0});revoke('space',spaceId,userId);}}
  }else{
   const userId=operation.userId;complete(userId);const sm=space(userId);if(!sm)throw new Error('E2EE_MEMBERSHIP_STALE');if(sm.role==='owner')throw new Error('E2EE_OWNER_TRANSFER_REQUIRES_RECOVERY_PLAN');
   if(operation.kind==='space-role'){
    const changed=sm.role!==operation.role,manual=changed||operation.permissions!==undefined||operation.canOrganizeTasks!==undefined;
    const permissionJson=operation.permissions!==undefined?operation.permissions===null?null:JSON.stringify(operation.permissions):changed?JSON.stringify(defaultPermissions(operation.role)):sm.permissions_json;
    const organize=operation.canOrganizeTasks===undefined?sm.can_organize_tasks:operation.canOrganizeTasks?1:0;
    put('shared_space_members',{space_id:spaceId,user_id:userId},{...fields('shared_space_members',sm),role:operation.role,permissions_json:permissionJson,can_organize_tasks:organize,member_category_id:manual?null:sm.member_category_id});
    if(changed||permissionJson!==sm.permissions_json||organize!==sm.can_organize_tasks)revoke('space',spaceId,userId);
    if(operation.role==='admin')for(const project of projects.values())if(member(project.id,userId)===null)setMember(project.id,userId,'manager');
    for(const project of projects.values())if(project.isInbox){
     // A stale assignment can survive a missing legacy membership row. The
     // explicit guest operation still clears it, even when setMember is a noop.
     if(operation.role==='guest')assignments.set(project.id+'\0'+userId,{projectId:project.id,userId});
     setMember(project.id,userId,operation.role==='guest'?null:'member');
    }recompute(userId);
   }else if(operation.kind==='member-permissions'){
    const value=operation.categoryId===null?operation.permissions:read('shared_member_categories',{id:operation.categoryId,space_id:spaceId})?.permissions_json;
    const chosen=typeof value==='string'?permissions(JSON.parse(value)):permissions(value);
    put('shared_space_members',{space_id:spaceId,user_id:userId},{...fields('shared_space_members',sm),member_category_id:operation.categoryId,permissions_json:typeof value==='string'?value:JSON.stringify(chosen),can_organize_tasks:chosen.organizeTasks?1:0});revoke('space',spaceId,userId);
   }else{
    if(sm.role==='admin')throw new Error('PROJECT_ACCESS_MANAGER_UNRESTRICTED');
    put('shared_space_members',{space_id:spaceId,user_id:userId},{...fields('shared_space_members',sm),all_projects:operation.allProjects?1:0,project_access_restricted:operation.allProjects?0:1,project_access_revision:Number(sm.project_access_revision)+1});
    const desired=new Map(operation.grants.map(row=>[row.projectId,row]));for(const id of desired.keys())if(!projects.has(id))throw new Error('E2EE_PRODUCT_PARENT_INVALID');
    for(const project of projects.values()){const rule=desired.get(project.id);put('shared_member_project_grants',{space_id:spaceId,user_id:userId,project_id:project.id},!rule?null:{role:rule.role==='none'?'viewer':rule.role,include_descendants:rule.includeDescendants?1:0,excluded:rule.role==='none'?1:0});}
    if(operation.allProjects)for(const project of projects.values())setMember(project.id,userId,member(project.id,userId)?.role==='owner'?'owner':sm.role==='guest'?'viewer':'member');else recompute(userId);
    revoke('space',spaceId,userId);
   }
  }
 }
 const changes:MembershipChange[]=[];for(const [id,source]of original){const next=after.get(id)!;if(!same(source.before,next))changes.push({table:source.table,key:source.key,expectedHash:source.beforeHash,after:next===null?null:fields(source.table,next)});}
 // The normal bounded protocol can consume pages; this pure planner retains
 // the complete result, including large legacy grant sets, without truncation.
 for(let at=0;at<changes.length;at+=200)validateMembershipChanges(changes.slice(at,at+200));
 const required=new Map<string,MembershipGraphScope>();const add=(scope:MembershipGraphScope|null)=>{if(!scope||!['active','retirement'].includes(scope.state))throw new Error('E2EE_SHARED_TRANSITION_REQUIRED');const old=required.get(scope.scopeId);if(old&&!same(old,scope))throw new Error('E2EE_SCOPE_BINDING_MISMATCH');required.set(scope.scopeId,scope);};
 if(operation.kind==='invitation-admit'){add(snapshot.spaceScope);for(const project of projects.values())add(project.scope);}
 for(const change of changes)if(change.table==='shared_project_members')add(projects.get(change.key.project_id)!.scope);else{add(snapshot.spaceScope);for(const project of projects.values())add(project.scope);}
  // Intermediate removal followed by inherited re-addition can have no final
  // ACL diff while still clearing assignments/revoking old invitations. Those
  // effects retain their complete authorization and rotation closure.
  for(const effect of assignments.values())add(projects.get(effect.projectId)!.scope);
  for(const effect of events.values())add(projects.get(effect.projectId)!.scope);
  for(const effect of revokes.values())if(effect.kind==='project')add(projects.get(effect.resourceId)!.scope);else{add(snapshot.spaceScope);for(const project of projects.values())add(project.scope);}
 return{format:'genesis-membership-operation-plan-v1',operation,changes,scopeIds:[...required.keys()].sort(),requiredScopes:[...required.values()].sort((a,b)=>a.scopeId<b.scopeId?-1:a.scopeId>b.scopeId?1:0),
  clearAssignments:[...assignments.values()],revokeInvitations:[...revokes.values()],roleEvents:[...events.values()]};
}
