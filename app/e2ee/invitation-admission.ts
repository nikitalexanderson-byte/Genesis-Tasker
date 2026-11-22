import {exactKeys} from './keys.ts';
import {validateMembershipOperation,type MembershipInvitationAdmission} from './membership-operation-plan.ts';
import {validateSharedRecordBody} from './shared-domain.ts';
import {E2eeSharedTrust} from './shared-trust.ts';
import type {WebPrivateAccount} from './product-session.ts';

export function invitationAdmissionPage(input:unknown,after:string,limit=50){
 exactKeys(input,['responses','nextAfter','checkpointHash','directoryRevision']);
 if(!Array.isArray(input.responses)||input.responses.length>limit)throw new Error('E2EE_INVITATION_RESPONSE_INVALID');
 let previous=after;const operations:MembershipInvitationAdmission[]=[];
 for(const row of input.responses){const operation=validateMembershipOperation(row);if(operation.kind!=='invitation-admit'||operation.invitationId<=previous)throw new Error('E2EE_INVITATION_RESPONSE_INVALID');previous=operation.invitationId;operations.push(operation);}
 if(input.nextAfter!==null&&(operations.length!==limit||input.nextAfter!==previous||previous<=after))throw new Error('E2EE_INVITATION_RESPONSE_INVALID');
 return{operations,nextAfter:input.nextAfter as string|null};
}
export type InvitationAdmissionItem={scopeId:string;title:string;operation:MembershipInvitationAdmission};
/** Discovery remains untrusted routing. A click creates a durable operation;
 * only the complete existing membership/owner review can authorize access. */
export async function webInvitationAdmissions(account:WebPrivateAccount,guard:()=>void):Promise<InvitationAdmissionItem[]>{
 const current=()=>{guard();account.requireOpen();if(account.mode!=='online')throw new Error('E2EE_ONLINE_REQUIRED');};
 const trust=new E2eeSharedTrust(account.ownerId),pins=await trust.list();current();const result:InvitationAdmissionItem[]=[];
 for(const pin of pins){const opened=await trust.open(pin.scopeId);current();const directory=opened.directory;
  if(directory.ownerId!==account.ownerId||directory.state!=='active')continue;if(directory.kind==='personal')throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
  const scope=account.shared(directory.scopeId,directory.kind,directory.resourceId),{records}=await account.sharedRecords(directory.scopeId,directory.kind,directory.resourceId);current();
  const root=await records.get(directory.kind,directory.resourceId);current();const body=validateSharedRecordBody(records.binding,directory.kind,root.body,root),title=typeof body.record.title==='string'?body.record.title:directory.resourceId;
  let after='';for(;;){const page=invitationAdmissionPage(await scope.client.readPendingInvitationPage(after,50),after);current();
   for(const operation of page.operations){if(operation.invitationKind!==directory.kind||operation.resourceId!==directory.resourceId)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');result.push({scopeId:directory.scopeId,title,operation});if(result.length>10000)throw new Error('E2EE_INVITATION_LIST_TOO_LARGE');}
   if(page.nextAfter===null)break;after=page.nextAfter;
  }
 }
 return result;
}
