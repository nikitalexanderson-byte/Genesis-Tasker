import {assertTechnical,exactKeys} from './keys.ts';
import {decodeE2eeBytes} from './envelope.ts';
import type {WebSharedMigrationTarget} from './web-product-migration.ts';

/** Discovery only. Recovery-signed setup/independently pinned directories still
 * authorize the actual transition. IDs for unprepared resources are stable so
 * a lost setup response never starts a different scope/root on retry. */
export function sharedTransitionTargets(value:unknown):WebSharedMigrationTarget[]{
 exactKeys(value,['resources','checkpointHash','directoryRevision']);decodeE2eeBytes(value.checkpointHash,32);
 if(!Number.isSafeInteger(value.directoryRevision)||Number(value.directoryRevision)<1||!Array.isArray(value.resources)||value.resources.length>4096)throw new Error('E2EE_INVALID_RESPONSE');
 const result:WebSharedMigrationTarget[]=[],seen=new Set<string>(),scopes=new Set<string>();
 for(const row of value.resources){exactKeys(row,['kind','resourceId','scopeId','state']);assertTechnical(row.resourceId);
  if(!['space','project'].includes(String(row.kind))||seen.has(`${row.kind}:${row.resourceId}`)||(row.scopeId===null)!==(row.state===null))throw new Error('E2EE_INVALID_RESPONSE');seen.add(`${row.kind}:${row.resourceId}`);
  if(row.scopeId!==null){assertTechnical(row.scopeId);if(!['preparing','uploading','verified','active','retirement'].includes(String(row.state)))throw new Error('E2EE_INVALID_RESPONSE');}
  const scopeId=row.scopeId??`${row.kind}:${row.resourceId}`;assertTechnical(scopeId);if(scopes.has(scopeId))throw new Error('E2EE_INVALID_RESPONSE');scopes.add(scopeId);
  if(row.state!=='retirement')result.push({scopeId,kind:row.kind as WebSharedMigrationTarget['kind'],resourceId:row.resourceId});
 }return result;
}
