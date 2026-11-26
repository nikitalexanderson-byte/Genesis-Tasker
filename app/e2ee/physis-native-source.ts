import {exactKeys,assertTechnical} from './keys.ts';
import type {PhysisMigrationMemory} from './physis-source.ts';

/** Android currently has no native Physis repository/editor. That explicit
 * local inventory does not imply an empty server vault. Retained account keys
 * are stripped in native before this input reaches the isolated JS engine. */
export function normalizeNativePhysisCapture(input:unknown,assertCurrent:()=>void){
 assertCurrent();exactKeys(input,['protocol','ownerId','scopeId','capturedAt','generation','pendingGeneration','documents','memory']);
 if(input.protocol!==1||typeof input.ownerId!=='string'||typeof input.scopeId!=='string'||typeof input.capturedAt!=='string'||!Number.isFinite(Date.parse(input.capturedAt)))throw new Error('E2EE_PHYSIS_SOURCE_INVALID');
 assertTechnical(input.ownerId);assertTechnical(input.scopeId);
 if(!Number.isSafeInteger(input.generation)||(input.generation as number)<0)throw new Error('E2EE_PHYSIS_SOURCE_INVALID');
 if(input.pendingGeneration!==null)throw new Error('E2EE_PHYSIS_GENERATION_REVIEW_REQUIRED');
 if(!Array.isArray(input.documents)||input.documents.length>1)throw new Error('E2EE_PHYSIS_SOURCE_INVALID');
 for(const row of input.documents){exactKeys(row,['kind','revision','encrypted']);if(row.kind!=='aurora-account-key'||!Number.isSafeInteger(row.revision)||(row.revision as number)<0||typeof row.encrypted!=='string'||!row.encrypted)throw new Error('E2EE_PHYSIS_SOURCE_INVALID');}
 exactKeys(input.memory,['ownerId','generation','reconciliationRequired','legacyKey','stores']);
 if(input.memory.ownerId!==input.ownerId||input.memory.generation!==input.generation||input.memory.reconciliationRequired!==false||input.memory.legacyKey!==''||!Array.isArray(input.memory.stores)||input.memory.stores.length)throw new Error('E2EE_KEY_BRIDGE_FORBIDDEN');
 const memory:PhysisMigrationMemory={ownerId:input.ownerId,generation:input.generation as number,reconciliationRequired:false,legacyKey:'',stores:[]};
 assertCurrent();return{snapshot:{protocol:1,ownerId:input.ownerId,scopeId:input.scopeId,capturedAt:input.capturedAt,memory},
  metadata:{protocol:1,ownerId:input.ownerId,documents:input.documents,localRepository:'unavailable',execution:'history-only'}};
}
