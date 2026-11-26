import assert from 'node:assert/strict';
import {test} from 'node:test';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {membershipBeforeHash} from '../app/e2ee/membership-contract.ts';
import {membershipProductIndexHash} from '../app/e2ee/membership-product-index.ts';
import {membershipOperationEdits} from '../app/e2ee/membership-operation-edits.ts';
import {planMembershipOperation,membershipOperationFingerprint,membershipOperationWire,validateMembershipOperationSnapshot} from '../app/e2ee/membership-operation-plan.ts';
import {membershipAtomicOperationPlan,membershipAtomicPlanHash,membershipAtomicChangeHash,validateMembershipAtomicPlan,validateMembershipAtomicPage} from '../app/e2ee/membership-atomic-contract.ts';

const actor='member-owner',member='member-target',recipient='member-recipient',spaceId='membership-space';
const permissions={createProjects:true,editTasks:true,organizeTasks:false,comment:true,manageProjects:false,inviteMembers:false};
function scope(kind,id,ownerId=actor){const scopeId=kind+':'+id;return{scopeId,ownerId,state:'active',root:{scopeId,entityId:kind+':'+id,generation:2,directoryRevision:1,checkpointHash:'A'.repeat(43),revision:1,payloadHash:'A'.repeat(43),productIndexHash:membershipProductIndexHash(scopeId,[])}};}
function fixture(extra=0){
 const projects=[['inbox',null,true],['project-a',null,false],['project-b','project-a',false],['project-c',null,false],...Array.from({length:extra},(_,i)=>['wide-'+i,null,false])]
  .map(([id,parentId,isInbox])=>({id,parentId,isInbox,archived:false,inTrash:false,scope:scope('project',id)}));
 const rows=[],users=[actor,member,recipient].sort(),add=(table,key,value)=>{const before=value===null?null:{...key,...value};rows.push({table,key,before,beforeHash:membershipBeforeHash(table,before)});};
 for(const userId of users){
  add('shared_space_members',{space_id:spaceId,user_id:userId},userId===recipient?null:{role:userId===actor?'owner':'member',can_organize_tasks:0,all_projects:1,permissions_json:null,member_category_id:userId===member?'category-a':null,project_access_restricted:0,project_access_revision:1});
  for(const project of projects){add('shared_project_members',{project_id:project.id,user_id:userId},userId===recipient?null:{role:userId===actor?'owner':'member'});
   add('shared_member_project_grants',{space_id:spaceId,user_id:userId,project_id:project.id},null);}
 }
 add('shared_member_categories',{id:'category-a',space_id:spaceId},{permissions_json:JSON.stringify(permissions),revision:1});
 return{format:'genesis-membership-operation-snapshot-v1',actorId:actor,spaceId,spaceScope:scope('space',spaceId),projects,spaceUserIds:[actor,member].sort(),completeUserIds:users,rows};
}
function mutate(snapshot,table,predicate,update){const row=snapshot.rows.find(row=>row.table===table&&predicate(row));assert(row);update(row);row.beforeHash=membershipBeforeHash(table,row.before);return row;}
function phpInput(input){const path=fileURLToPath(new URL('../scripts/qa/membership-planner-fixture.php',import.meta.url));return JSON.parse(execFileSync(process.env.GENESIS_QA_PHP??'php',[path],{input:JSON.stringify(input),encoding:'utf8',timeout:30000,maxBuffer:16*1024*1024}));}
const php=(snapshot,operation)=>phpInput({snapshot,operation:membershipOperationWire(operation)});
function parity(snapshot,operation){
 const before=structuredClone(snapshot),local=planMembershipOperation(snapshot,operation),remote=php(snapshot,operation);assert(remote.ok,remote.error);
 assert.deepEqual(remote.plan,{...local,operation:membershipOperationWire(local.operation)});
 assert.equal(remote.fingerprint,membershipOperationFingerprint(snapshot,operation));assert.deepEqual(snapshot,before);return local;
}
const changed=(plan,table,predicate)=>plan.changes.filter(row=>row.table===table&&predicate(row));

test('project removal removes membership, assignments and invitations and requires the project rotation',()=>{
 const plan=parity(fixture(),{kind:'project-remove',projectId:'project-a',userId:member});
 assert.deepEqual(plan.scopeIds,['project:project-a']);assert.equal(changed(plan,'shared_project_members',r=>r.key.user_id===member)[0].after,null);
 assert.deepEqual(plan.clearAssignments,[{projectId:'project-a',userId:member}]);assert.deepEqual(plan.revokeInvitations,[{kind:'project',resourceId:'project-a',userId:member}]);
 assert.deepEqual(plan.roleEvents,[{projectId:'project-a',userId:member,from:'member',to:null}]);
});
test('role changes are exact and an already matching role has no rotation or effects',()=>{
 const snapshot=fixture(),plan=parity(snapshot,{kind:'project-role',projectId:'project-a',userId:member,role:'viewer'});
 assert.equal(changed(plan,'shared_project_members',r=>r.key.user_id===member)[0].after.role,'viewer');assert.deepEqual(plan.clearAssignments,[]);
 const same=parity(snapshot,{kind:'project-role',projectId:'project-a',userId:member,role:'member'});assert.deepEqual(same.scopeIds,[]);assert.deepEqual(same.changes,[]);assert.deepEqual(same.roleEvents,[]);
});

test('membership history attaches to the project root and retains the affected user in its content',()=>{
 const snapshot=fixture(),plan=planMembershipOperation(snapshot,{kind:'project-role',projectId:'project-a',userId:member,role:'viewer'});
 const [event]=membershipOperationEdits({binding:{scopeId:'project:project-a',kind:'project',resourceId:'project-a'},actorId:actor,
  intentId:'role-change',createdAt:'2026-11-25T09:00:00Z',plan,snapshot,entities:[],versions:[]});
 assert.equal(event.kind,'history');
 assert.equal(event.parentId,'project:project-a');
 assert.equal(event.body.record.task_id,null);
 assert.equal(event.body.record.object_id,member);
 assert.equal(event.body.execution,'history-only');
});
test('removing the last project of a guest explicitly removes its space membership and grants',()=>{
 const snapshot=fixture();mutate(snapshot,'shared_space_members',r=>r.key.user_id===member,r=>{r.before.role='guest';r.before.all_projects=0;r.before.member_category_id=null;});
 for(const id of ['inbox','project-b','project-c'])mutate(snapshot,'shared_project_members',r=>r.key.user_id===member&&r.key.project_id===id,r=>{r.before=null;});
 mutate(snapshot,'shared_member_project_grants',r=>r.key.user_id===member&&r.key.project_id==='project-a',r=>{r.before={...r.key,role:'viewer',include_descendants:1,excluded:0};});
 const plan=parity(snapshot,{kind:'project-remove',projectId:'project-a',userId:member});
 assert.equal(changed(plan,'shared_space_members',r=>r.key.user_id===member)[0].after,null);
 assert.equal(changed(plan,'shared_member_project_grants',r=>r.key.user_id===member)[0].after,null);assert.equal(plan.scopeIds.length,5);
});
test('restricted inherited grants preserve the child exclusion and clear removed assignments',()=>{
 const plan=parity(fixture(),{kind:'project-grants',spaceId,userId:member,allProjects:false,grants:[{projectId:'project-a',role:'commenter',includeDescendants:true},{projectId:'project-b',role:'none',includeDescendants:true}]});
 const rows=changed(plan,'shared_project_members',r=>r.key.user_id===member);
 assert.equal(rows.find(r=>r.key.project_id==='project-a').after.role,'commenter');assert.equal(rows.find(r=>r.key.project_id==='project-b').after,null);
 assert(plan.clearAssignments.some(r=>r.projectId==='project-b'&&r.userId===member));assert.equal(plan.scopeIds.length,5);
});
test('category permission changes update affected members and rotate the entire authorization closure without exposing the title',()=>{
 const op={kind:'category-permissions',spaceId,categoryId:'category-a',expectedRevision:1,permissions:{...permissions,organizeTasks:true},rename:true,privateTitle:'PRIVATE-CATEGORY-TITLE'};
 const plan=parity(fixture(),op);assert.equal(changed(plan,'shared_member_categories',()=>true)[0].after.revision,2);
 assert.equal(changed(plan,'shared_space_members',r=>r.key.user_id===member)[0].after.can_organize_tasks,1);assert.equal(plan.scopeIds.length,5);
 assert(!JSON.stringify(php(fixture(),op)).includes(op.privateTitle));assert.equal(plan.operation.privateTitle,op.privateTitle);
});
test('space guest conversion removes inbox membership and assignments and retains required rotations',()=>{
 const plan=parity(fixture(),{kind:'space-role',spaceId,userId:member,role:'guest'});
 assert.equal(changed(plan,'shared_project_members',r=>r.key.project_id==='inbox'&&r.key.user_id===member)[0].after,null);
 assert(plan.clearAssignments.some(r=>r.projectId==='inbox'&&r.userId===member));assert.equal(plan.scopeIds.length,5);
});
test('admitting a new project member includes both space and project membership in a complete rotation closure',()=>{
 const plan=parity(fixture(),{kind:'invitation-admit',spaceId,resourceId:'project-a',invitationId:'invitation-a',invitationKind:'project',userId:recipient,role:'viewer',permissions:null,createdBy:actor,acceptedAt:'2026-11-24T00:00:00Z'});
 assert.equal(changed(plan,'shared_space_members',r=>r.key.user_id===recipient)[0].after.role,'guest');
 assert.equal(changed(plan,'shared_project_members',r=>r.key.project_id==='project-a'&&r.key.user_id===recipient)[0].after.role,'viewer');assert.equal(plan.scopeIds.length,5);
});
test('missing ACL suffix, duplicate rows, hierarchy cycles and wrong before hashes never produce a partial plan',()=>{
 for(const damage of [s=>s.rows.splice(s.rows.findIndex(r=>r.table==='shared_member_project_grants'),1),s=>s.rows.push(structuredClone(s.rows[0])),s=>{s.projects[1].parentId='project-b';},s=>{s.rows[0].beforeHash='A'.repeat(43);}]){
  const snapshot=fixture();damage(snapshot);assert.throws(()=>validateMembershipOperationSnapshot(snapshot),/E2EE_/);
 }
});
test('a foreign actor or an owner transfer is refused by both planners',()=>{
 for(const [target,expected]of [[member,'E2EE_OWNER_TRANSFER_REQUIRES_RECOVERY_PLAN'],[recipient,'E2EE_OWNER_REQUIRED']]){
  const snapshot=fixture();if(target===member)mutate(snapshot,'shared_project_members',r=>r.key.user_id===member&&r.key.project_id==='project-a',r=>{r.before.role='owner';});
  else{snapshot.actorId=member;mutate(snapshot,'shared_space_members',r=>r.key.user_id===member,r=>{r.before.role='member';});}
  const op={kind:'project-remove',projectId:'project-a',userId:target===member?member:actor};
  assert.throws(()=>planMembershipOperation(snapshot,op),new RegExp(expected));assert.equal(php(snapshot,op).error,expected);
 }
});
test('wide grants and rotations retain every project beyond one page and preserve cross-language fingerprints',()=>{
 const snapshot=fixture(205),plan=parity(snapshot,{kind:'project-grants',spaceId,userId:member,allProjects:false,grants:snapshot.projects.filter(p=>!p.isInbox).map(p=>({projectId:p.id,role:'viewer',includeDescendants:true}))});
 assert.equal(plan.requiredScopes.length,210);assert.equal(plan.scopeIds.length,210);
 assert.equal(changed(plan,'shared_member_project_grants',r=>r.key.user_id===member).length,208);
});

function atomic(extra=0){
 const snapshot=fixture(extra),op={kind:'project-grants',spaceId,userId:member,allProjects:false,grants:snapshot.projects.filter(p=>!p.isInbox).map(p=>({projectId:p.id,role:'viewer',includeDescendants:true}))};
 const operation=planMembershipOperation(snapshot,op),fingerprint=membershipOperationFingerprint(snapshot,op);
 // This is an unapproved wire manifest, not an executable membership receipt.
 return membershipAtomicOperationPlan(actor,'membership-intent',spaceId,fingerprint,operation,[]);
}
test('wide atomic manifests bind the complete paged grants, ACL and anchors identically in JS and PHP',()=>{
 const value=atomic(205),remote=phpInput({kind:'atomic',plan:value.plan,pages:value.pages});assert(remote.ok,remote.error);
 assert.equal(remote.planHash,membershipAtomicPlanHash(value.plan));assert.equal(remote.changeHash,membershipAtomicChangeHash(value.plan));assert.deepEqual(remote.refs,value.plan.pages);
 assert.equal(value.pages.filter(p=>p.kind==='operation-grants').length,2);assert.equal(value.pages.filter(p=>p.kind==='operation-grants').reduce((n,p)=>n+p.items.length,0),208);
 assert.equal(value.pages.filter(p=>p.kind==='anchors').reduce((n,p)=>n+p.items.length,0),210);
});
test('atomic parsers refuse skipped or duplicate page indices, unknown plan fields and unsorted scope closure',()=>{
 for(const damage of [v=>{v.plan.pages[0].index=1;},v=>v.plan.pages.push(structuredClone(v.plan.pages[0])),v=>{v.plan.implicitOwnerApproval=true;},v=>v.plan.scopeIds.reverse()]){
  const value=atomic();damage(value);assert.throws(()=>validateMembershipAtomicPlan(value.plan),/E2EE_/);assert.equal(phpInput({kind:'atomic',plan:value.plan,pages:value.pages}).ok,false);
 }
});
test('a valid changed grant page changes the immutable digest; it cannot silently reuse the original manifest',()=>{
 const value=atomic(),before=structuredClone(value.plan.pages),page=value.pages.find(p=>p.kind==='operation-grants');page.items[0].role='commenter';
 const computed=phpInput({kind:'atomic',plan:value.plan,pages:value.pages});assert(computed.ok);assert.notDeepEqual(computed.refs,before);
 assert.deepEqual(value.plan.pages,before);assert.equal(computed.refs.filter((r,i)=>r.pageHash!==before[i].pageHash).length,1);
});
test('wire operation pages refuse private titles and fields that pretend to grant owner consent',()=>{
 for(const field of [{privateTitle:'PRIVATE-NAME'},{ownerApproved:true}]){
  const value=atomic(),page=value.pages.find(p=>p.kind==='operation');Object.assign(page.items[0],field);
  assert.throws(()=>validateMembershipAtomicPage(page),/E2EE_/);assert.equal(phpInput({kind:'atomic',plan:value.plan,pages:value.pages}).ok,false);
 }
});
test('actor, intent, current product index and review fingerprint each bind a distinct atomic authorization',()=>{
 const value=atomic(),original=membershipAtomicPlanHash(value.plan),change=membershipAtomicChangeHash(value.plan);
 for(const field of ['actorId','intentId','reviewFingerprint']){const plan=structuredClone(value.plan);plan[field]=field==='reviewFingerprint'?'B'.repeat(42)+'A':'changed-'+field;assert.notEqual(membershipAtomicPlanHash(plan),original);assert.notEqual(membershipAtomicChangeHash(plan),change);}
 const snapshot=fixture(),op={kind:'project-role',projectId:'project-a',userId:member,role:'viewer'},before=membershipOperationFingerprint(snapshot,op);
 snapshot.projects.find(p=>p.id==='project-a').scope.root.productIndexHash='B'.repeat(42)+'A';assert.notEqual(membershipOperationFingerprint(snapshot,op),before);
});
