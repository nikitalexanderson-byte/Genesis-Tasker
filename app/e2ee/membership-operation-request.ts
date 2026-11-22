import {exactKeys} from './keys.ts';
import {validateMembershipOperation,type MembershipOperation} from './membership-operation-plan.ts';
import type {SharedDomainBinding} from './shared-domain.ts';

/** Map existing ordinary controls to the reviewed business operation. Source
 * HTTP fields stay in the encrypted normal request, never become consent. */
export function membershipOperationForSharedRequest(binding:SharedDomainBinding,method:string,path:string,body:Record<string,unknown>):MembershipOperation|null{
 const parts=path.split('?')[0].split('/').filter(Boolean),extra=Object.hasOwn(body,'requestId')?['requestId']:[];
 if(parts[0]==='members'&&parts.length===2&&binding.kind==='project'&&(method==='PATCH'||method==='DELETE')){
  exactKeys(body,[...(method==='PATCH'?['role']:[]),...extra]);return validateMembershipOperation({kind:method==='PATCH'?'project-role':'project-remove',projectId:binding.resourceId,userId:parts[1],...(method==='PATCH'?{role:body.role}:{})});
 }
 if(binding.kind==='space'&&parts[0]==='members'&&method==='PATCH'){
  if(parts.length===2){exactKeys(body,['role',...(Object.hasOwn(body,'permissions')?['permissions']:[]),...(Object.hasOwn(body,'canOrganizeTasks')?['canOrganizeTasks']:[]),...extra]);
   return validateMembershipOperation({kind:'space-role',spaceId:binding.resourceId,userId:parts[1],role:body.role,...(Object.hasOwn(body,'permissions')?{permissions:body.permissions}:{}),...(Object.hasOwn(body,'canOrganizeTasks')?{canOrganizeTasks:body.canOrganizeTasks}:{})});}
  if(parts.length===3&&parts[2]==='permissions'){exactKeys(body,['categoryId','permissions',...extra]);return validateMembershipOperation({kind:'member-permissions',spaceId:binding.resourceId,userId:parts[1],categoryId:body.categoryId,permissions:body.permissions});}
  if(parts.length===3&&parts[2]==='project-access'){exactKeys(body,['allProjects','grants','expectedFingerprint','operationId']);return validateMembershipOperation({kind:'project-grants',spaceId:binding.resourceId,userId:parts[1],allProjects:body.allProjects,grants:body.grants});}
 }
 if(binding.kind==='space'&&parts[0]==='member-categories'&&parts.length===2&&method==='PATCH'){
  // A combined rename/permission edit needs its own complete private input;
  // never silently drop a title or update only the display copy of the ACL.
  if(Object.keys(body).some(key=>!['permissions','expectedRevision','requestId'].includes(key)))throw new Error('E2EE_MEMBERSHIP_REVIEW_REQUIRED');
  exactKeys(body,['permissions','expectedRevision',...extra]);return validateMembershipOperation({kind:'category-permissions',spaceId:binding.resourceId,categoryId:parts[1],expectedRevision:body.expectedRevision,permissions:body.permissions});
 }
 return null;
}
