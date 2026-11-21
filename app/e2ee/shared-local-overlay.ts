import {samePrivateJson} from './product-json.ts';
import {validateSharedRecordBody,type SharedDomainBinding} from './shared-domain.ts';
import type {PendingProductVersion,ProductVersion} from './shared-product.ts';

/** A read never flushes an offline operation. Apply complete retained batches
 * in revision order, independent of UUID/storage ordering. Concurrent branches
 * remain explicit conflicts instead of selecting an arbitrary last writer. */
export function overlayPendingSharedVersions(binding:SharedDomainBinding,remote:ProductVersion[],pending:PendingProductVersion[]):ProductVersion[]{
 const result=new Map(remote.map(row=>[row.entityId,structuredClone(row)]));
 if(result.size!==remote.length||remote.length>10000||pending.length>10000)throw new Error('E2EE_PRODUCT_INDEX_INVALID');
 const batches=new Map<string,PendingProductVersion[]>();
 for(const input of pending){const row=structuredClone(input),version=row.version;
  if(version.scopeId!==binding.scopeId||version.revision!==row.expectedRevision+1||!Number.isSafeInteger(row.expectedRevision)||row.expectedRevision<0)throw new Error('E2EE_PRODUCT_TRANSACTION_INVALID');
  if(!version.deleted)validateSharedRecordBody(binding,version.kind,version.body,version);else if(version.body!==null)throw new Error('E2EE_PRODUCT_TRANSACTION_INVALID');
  if(row.action==='propose-complete')continue;const batch=batches.get(row.intentId)??[];
  if(batch.some(old=>old.version.entityId===version.entityId))throw new Error('E2EE_PRODUCT_TRANSACTION_INVALID');batch.push(row);batches.set(row.intentId,batch);
 }
 while(batches.size){
  const ready=[...batches].filter(([,batch])=>batch.every(row=>{
   const current=result.get(row.version.entityId),revision=current?.revision??0;
   if(revision===row.version.revision){if(!samePrivateJson(current,row.version))throw new Error('E2EE_SHARED_PENDING_REVIEW_REQUIRED');return true;}
   if(revision>row.expectedRevision)throw new Error('E2EE_SHARED_PENDING_REVIEW_REQUIRED');return revision===row.expectedRevision;
  }));
  if(!ready.length)throw new Error('E2EE_SHARED_PENDING_REVIEW_REQUIRED');
  const changed=new Set<string>();for(const [,batch]of ready)for(const row of batch){
   if(result.get(row.version.entityId)?.revision===row.version.revision)continue;
   if(changed.has(row.version.entityId))throw new Error('E2EE_SHARED_PENDING_REVIEW_REQUIRED');changed.add(row.version.entityId);
  }
  for(const [id,batch]of ready){for(const row of batch)result.set(row.version.entityId,row.version);batches.delete(id);}
  if(result.size>10000)throw new Error('E2EE_SCOPE_OBJECT_LIMIT');
 }
 return[...result.values()];
}
