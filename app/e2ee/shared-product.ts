import {E2eePrivateDocument} from './product-repository.ts';
import {E2eeDeviceDocument} from './device-document.ts';
import {PRODUCT_KINDS,productDomain,productEntity,productMetadata,type ProductEntity,type ProductKind,type ProductMetadata,type ProductMutation} from './product-contract.ts';
import {samePrivateJson as same} from './product-json.ts';
import {verifyProductPage,type VerifiedProductProposal} from './product-proofs.ts';
import {assertTechnical,exactKeys} from './keys.ts';
import {encodeE2eeBytes} from './envelope.ts';
import type {WireValue} from './commands.ts';
import type {E2eeScopeClient} from './scope-client.ts';
import type {UnlockedWebDevice} from './device-vault.ts';

export type ProductVersion={protocol:1;scopeId:string;entityId:string;kind:ProductKind;revision:number;parentId:string|null;deleted:boolean;metadata:ProductMetadata;body:unknown};
type Draft={operation:Omit<ProductMutation,'payloadHash'>;version:ProductVersion;payloadHash:string|null};
type Transaction={format:'genesis-product-transaction-v1';scopeId:string;intentId:string;drafts:Draft[];acknowledged:boolean;receipt:Record<string,WireValue>|null};
type Index={protocol:1;scopeId:string;entities:ProductEntity[]};
export type ProductEdit={action:ProductMutation['action'];entityId:string;kind:ProductKind;expectedRevision:number;parentId:string|null;metadata:ProductMetadata;body:unknown;proposalId?:string};
export type PendingProductVersion={intentId:string;action:ProductMutation['action'];expectedRevision:number;version:ProductVersion};
export type SharedProductOptions={scopeId:string;kind:'project'|'space';device:UnlockedWebDevice;client:E2eeScopeClient;assertCurrent:()=>void;
 /** Required real domain parser. Unknown/future records are review errors,
  * not permissive JSON blobs or empty categories. */
 validateBody:(kind:ProductKind,value:unknown,header:Omit<ProductVersion,'body'>)=>unknown|Promise<unknown>};
const encoder=new TextEncoder();
/** Immutable encrypted versions plus an independent, signed and authorized
 * server transaction. Ordinary file uploads never activate business content.
 * A complete local transaction survives restart before the first network call. */
export class E2eeSharedProduct{
 #serial:Promise<unknown>=Promise.resolve();#prefix:Promise<string>;#index:E2eeDeviceDocument<Index>;
 #proposals=new Map<string,VerifiedProductProposal>();
 constructor(private readonly options:SharedProductOptions){assertTechnical(options.scopeId);options.client.assertBinding(options.device,options.scopeId);
  this.#prefix=crypto.subtle.digest('SHA-256',encoder.encode(options.scopeId)).then(bytes=>`product-tx:${encodeE2eeBytes(new Uint8Array(bytes))}:`);
  this.#index=new E2eeDeviceDocument(options.device,`product-index:${options.scopeId}`,value=>{exactKeys(value,['protocol','scopeId','entities']);
   if(value.protocol!==1||value.scopeId!==options.scopeId||!Array.isArray(value.entities)||value.entities.length>10000)throw new Error('E2EE_PRODUCT_INDEX_INVALID');
   const entities=value.entities.map(productEntity);if(new Set(entities.map(row=>row.entityId)).size!==entities.length)throw new Error('E2EE_PRODUCT_INDEX_INVALID');return{protocol:1,scopeId:options.scopeId,entities};},()=>this.#current());
 }
 #current(){this.options.device.requireOpen();this.options.assertCurrent();}
 #operation<T>(run:()=>Promise<T>):Promise<T>{const task=this.#serial.catch(()=>undefined).then(async()=>{this.#current();return run();});this.#serial=task;return task;}
 async #version(input:unknown):Promise<ProductVersion>{
  exactKeys(input,['protocol','scopeId','entityId','kind','revision','parentId','deleted','metadata','body']);
  if(input.protocol!==1||input.scopeId!==this.options.scopeId||!PRODUCT_KINDS.includes(input.kind as ProductKind)||!Number.isSafeInteger(input.revision)||Number(input.revision)<1||typeof input.deleted!=='boolean')throw new Error('E2EE_PRODUCT_VERSION_INVALID');
  assertTechnical(input.entityId);if(input.parentId!==null)assertTechnical(input.parentId);const metadata=productMetadata(input.kind as ProductKind,input.metadata),{body,...header}=input;
  if(input.deleted){if(body!==null)throw new Error('E2EE_PRODUCT_VERSION_INVALID');return input as ProductVersion;}
  const value=await this.options.validateBody(input.kind as ProductKind,structuredClone(body),header as Omit<ProductVersion,'body'>);this.#current();
  return{...input,metadata,body:value} as ProductVersion;
 }
 #document(id:string,kind:ProductKind){return new E2eePrivateDocument<ProductVersion>({device:this.options.device,client:this.options.client,scopeId:this.options.scopeId,domain:productDomain(kind),objectId:id,
  assertCurrent:()=>this.#current(),assertWrite:()=>this.#current(),validate:value=>this.#version(value)});}
 #transaction(id:string){assertTechnical(id);return new E2eeDeviceDocument<Transaction>(this.options.device,id,value=>{
  exactKeys(value,['format','scopeId','intentId','drafts','acknowledged','receipt']);if(value.format!=='genesis-product-transaction-v1'||value.scopeId!==this.options.scopeId||!Array.isArray(value.drafts)||value.drafts.length<1||value.drafts.length>100||typeof value.acknowledged!=='boolean')throw new Error('E2EE_PRODUCT_TRANSACTION_INVALID');assertTechnical(value.intentId);
  const entities=new Set<string>(),objects=new Set<string>();for(const draft of value.drafts){exactKeys(draft,['operation','version','payloadHash']);
   exactKeys(draft.operation,['action','entityId','kind','expectedRevision','domain','objectId','parentId','metadata','proposalId']);const operation=draft.operation;
   assertTechnical(operation.entityId);assertTechnical(operation.objectId);if(entities.has(operation.entityId)||objects.has(operation.objectId)||!/^product-version:[a-f0-9-]{36}$/.test(operation.objectId)
    ||!Number.isSafeInteger(operation.expectedRevision)||Number(operation.expectedRevision)<0||operation.domain!==productDomain(operation.kind as ProductKind)
    ||!['create','update','delete','restore','propose-complete'].includes(String(operation.action)))throw new Error('E2EE_PRODUCT_TRANSACTION_INVALID');entities.add(operation.entityId);objects.add(operation.objectId);
   if(draft.payloadHash!==null&&typeof draft.payloadHash!=='string')throw new Error('E2EE_PRODUCT_TRANSACTION_INVALID');productMetadata(operation.kind as ProductKind,operation.metadata);
  }return value as Transaction;
 },()=>this.#current());}
 async #readIndex(offline:boolean){const local=await this.#index.load();this.#current();if(offline){if(!local)throw new Error('E2EE_OFFLINE_CONTENT_UNAVAILABLE');return local.value.entities;}
  await this.options.client.refresh();this.#current();const entities:ProductEntity[]=[];let after='',limit=50,bootstrap:{proofHash:string;expectedCount:number}|null=null;const seen=new Set<string>(),proposals=new Map<string,VerifiedProductProposal>();
  for(let page=0;page<=10032;page++){
   let response;try{response=await this.options.client.readProductIndex(after,limit);}catch(error){if(limit>1&&error instanceof Error&&error.message==='E2EE_PRODUCT_PAGE_TOO_LARGE'){limit=Math.max(1,Math.floor(limit/2));continue;}throw error;}
   this.#current();const verified=await verifyProductPage(response,packet=>this.options.client.verifyServiceProof(packet));this.#current();if(verified.entities.length>limit)throw new Error('E2EE_PRODUCT_INDEX_INVALID');
   if(bootstrap&&bootstrap.proofHash!==verified.bootstrap.proofHash)throw new Error('E2EE_PRODUCT_PROOF_INVALID');bootstrap=verified.bootstrap;
   for(const row of verified.entities){if(row.entityId<=after||seen.has(row.entityId))throw new Error('E2EE_PRODUCT_INDEX_INVALID');seen.add(row.entityId);entities.push(row);if(entities.length>10000)throw new Error('E2EE_SCOPE_OBJECT_LIMIT');}
   for(const proposal of verified.proposals){if(proposals.has(proposal.proposalId))throw new Error('E2EE_PRODUCT_PROOF_INVALID');proposals.set(proposal.proposalId,proposal);}
   if(verified.entities.length<limit)break;after=entities.at(-1)!.entityId;if(page===10032)throw new Error('E2EE_PRODUCT_INDEX_INVALID');
  }
  if(!bootstrap||entities.length<bootstrap.expectedCount)throw new Error('E2EE_PRODUCT_BOOTSTRAP_INCOMPLETE');
  for(const old of local?.value.entities??[]){const row=entities.find(item=>item.entityId===old.entityId);if(!row||row.revision<old.revision||row.revision===old.revision&&!same(row,old))throw new Error('E2EE_REMOTE_ROLLBACK');}
  if(!same(entities,local?.value.entities))await this.#index.save({protocol:1,scopeId:this.options.scopeId,entities},local?.serial??null);this.#current();this.#proposals=proposals;return entities;
 }
 index(offline=false){return this.#operation(()=>this.#readIndex(offline));}
 async #read(entity:ProductEntity,offline:boolean){const view=await this.#document(entity.objectId,entity.kind).load(offline?'offline':'online');this.#current();
  const value=await this.#version(view.value);if(view.pending||view.conflict||view.remoteRevision!==1||value.entityId!==entity.entityId||value.kind!==entity.kind||value.revision!==entity.revision
   ||value.parentId!==entity.parentId||value.deleted!==entity.deleted||!same(value.metadata,entity.metadata))throw new Error('E2EE_PRODUCT_VERSION_INVALID');
  if(!offline)await this.options.client.assertObjectReference(entity.domain,entity.objectId,1,entity.payloadHash);this.#current();return structuredClone(value);
 }
 read(entity:ProductEntity,offline=false){const held=productEntity(structuredClone(entity));return this.#operation(()=>this.#read(held,offline));}
 stage(input:ProductEdit[],intentId=crypto.randomUUID()){const edits=structuredClone(input);return this.#operation(async()=>{
  assertTechnical(intentId);if(edits.length<1||edits.length>100||new Set(edits.map(row=>row.entityId)).size!==edits.length)throw new Error('E2EE_PRODUCT_BATCH_INVALID');const drafts:Draft[]=[];
  const id=(await this.#prefix)+intentId,previous=await this.#transaction(id).load();
  if(previous){if(previous.value.drafts.length!==edits.length)throw new Error('E2EE_IDEMPOTENCY_CONFLICT');
   for(const [index,edit]of edits.entries()){const old=previous.value.drafts[index],operation=old.operation,version=await this.#version(old.version);
    if(operation.action!==edit.action||operation.entityId!==edit.entityId||operation.kind!==edit.kind||operation.expectedRevision!==edit.expectedRevision||operation.parentId!==edit.parentId
      ||edit.proposalId!==undefined&&edit.proposalId!==operation.proposalId||!same(operation.metadata,edit.metadata)||!same(version.body,edit.body))throw new Error('E2EE_IDEMPOTENCY_CONFLICT');
   }return intentId;
  }
  for(const edit of edits){const version=await this.#version({protocol:1,scopeId:this.options.scopeId,entityId:edit.entityId,kind:edit.kind,revision:edit.expectedRevision+1,parentId:edit.parentId,deleted:edit.action==='delete',metadata:edit.metadata,body:edit.body});
   const operation:Draft['operation']={action:edit.action,entityId:edit.entityId,kind:edit.kind,expectedRevision:edit.expectedRevision,domain:productDomain(edit.kind),objectId:`product-version:${crypto.randomUUID()}`,parentId:edit.parentId,metadata:version.metadata,proposalId:edit.action==='propose-complete'?edit.proposalId??crypto.randomUUID():null};
   drafts.push({operation,version,payloadHash:null});}
  await this.#transaction(id).save({format:'genesis-product-transaction-v1',scopeId:this.options.scopeId,intentId,drafts,acknowledged:false,receipt:null},null);this.#current();return intentId;
 });}
 async #flush(intentId:string){const id=(await this.#prefix)+intentId,transaction=this.#transaction(id);let saved=await transaction.load();if(!saved)throw new Error('E2EE_PRODUCT_TRANSACTION_MISSING');
  let state=structuredClone(saved.value);if(state.acknowledged)return state.receipt!;
  for(const [index,draft]of state.drafts.entries()){
   const version=await this.#version(draft.version),operation=draft.operation;if(version.entityId!==operation.entityId||version.kind!==operation.kind||version.revision!==operation.expectedRevision+1||version.parentId!==operation.parentId||version.deleted!==(operation.action==='delete')||!same(version.metadata,operation.metadata))throw new Error('E2EE_PRODUCT_TRANSACTION_INVALID');
   const document=this.#document(operation.objectId,operation.kind);let staged;
   try{staged=await document.load('offline');}catch(error){if(!(error instanceof Error)||error.message!=='E2EE_OFFLINE_CONTENT_UNAVAILABLE')throw error;await document.save(version,{serial:null,remoteRevision:0});staged=await document.load('offline');}
   if(!same(staged.value,version)||staged.conflict||staged.remoteRevision>1)throw new Error('E2EE_PRODUCT_VERSION_IMMUTABLE');if(staged.pending)await document.flush();
   const reference=await this.options.client.objectReference(operation.domain,operation.objectId);this.#current();if(reference.revision!==1||draft.payloadHash!==null&&draft.payloadHash!==reference.payloadHash)throw new Error('E2EE_OBJECT_REFERENCE_MISMATCH');
   if(draft.payloadHash===null){state.drafts[index].payloadHash=reference.payloadHash;saved=await transaction.save(state,saved.serial);state=structuredClone(saved.value);}
  }
  const operations=state.drafts.map(row=>({...row.operation,payloadHash:row.payloadHash!})),receipt=await this.options.client.executeService('product-commit',{operations:operations as unknown as WireValue},state.intentId);this.#current();
  if(receipt.intentId!==state.intentId||!Array.isArray(receipt.results)||receipt.results.length!==operations.length)throw new Error('E2EE_PRODUCT_RECEIPT_INVALID');
  for(const operation of operations){const result=receipt.results.find(row=>row&&typeof row==='object'&&!Array.isArray(row)&&row.entityId===operation.entityId) as Record<string,WireValue>|undefined;
   if(!result||result.revision!==(operation.action==='propose-complete'?operation.expectedRevision:operation.expectedRevision+1)||result.payloadHash!==operation.payloadHash)throw new Error('E2EE_PRODUCT_RECEIPT_INVALID');}
  await transaction.save({...state,acknowledged:true,receipt},saved.serial);this.#current();return receipt;
 }
 flush(intentId:string){assertTechnical(intentId);return this.#operation(()=>this.#flush(intentId));}
 pending(){return this.#operation(async()=>{const prefix=await this.#prefix,ids=await this.options.device.vault.listLocal('draft',prefix);this.#current();const pending:string[]=[];
  for(const id of ids){const value=await this.#transaction(id).load();if(!value)throw new Error('E2EE_PRODUCT_TRANSACTION_MISSING');if(!value.value.acknowledged)pending.push(value.value.intentId);}return pending;});}
 localVersions(){return this.#operation(async()=>{const prefix=await this.#prefix,ids=await this.options.device.vault.listLocal('draft',prefix),rows:PendingProductVersion[]=[];this.#current();
  for(const id of ids){const saved=await this.#transaction(id).load();if(!saved)throw new Error('E2EE_PRODUCT_TRANSACTION_MISSING');if(saved.value.acknowledged)continue;
   for(const draft of saved.value.drafts){const version=await this.#version(draft.version),operation=draft.operation;
    if(version.entityId!==operation.entityId||version.kind!==operation.kind||version.revision!==operation.expectedRevision+1||version.parentId!==operation.parentId||version.deleted!==(operation.action==='delete')||!same(version.metadata,operation.metadata))throw new Error('E2EE_PRODUCT_TRANSACTION_INVALID');
    rows.push({intentId:saved.value.intentId,action:operation.action,expectedRevision:operation.expectedRevision,version});if(rows.length>10000)throw new Error('E2EE_SCOPE_OBJECT_LIMIT');
   }
  }return rows;
 });}
 async #proposal(id:string,expectedHash:string){assertTechnical(id);await this.#readIndex(false);const proposal=this.#proposals.get(id);
  if(!proposal||proposal.operation.payloadHash!==expectedHash)throw new Error('E2EE_PRODUCT_PROPOSAL_STALE');
  const opened=await this.#document(proposal.operation.objectId,'task').load('online'),version=await this.#version(opened.value);this.#current();
  if(opened.pending||opened.conflict||opened.remoteRevision!==1||version.entityId!==proposal.entityId||version.kind!=='task'||version.revision!==proposal.baseRevision+1
   ||version.deleted||version.parentId!==proposal.operation.parentId||!same(version.metadata,proposal.operation.metadata))throw new Error('E2EE_PRODUCT_PROPOSAL_STALE');
  await this.options.client.assertObjectReference('shared-project',proposal.operation.objectId,1,expectedHash);this.#current();return{proposal,version};
 }
 proposal(id:string,expectedHash:string){return this.#operation(()=>this.#proposal(id,expectedHash));}
 approve(review:{proposalId:string;payloadHash:string;version:ProductVersion},intentId=crypto.randomUUID()){
  const held=structuredClone(review);assertTechnical(intentId);return this.#operation(async()=>{const current=await this.#proposal(held.proposalId,held.payloadHash);
   if(!same(await this.#version(held.version),current.version))throw new Error('E2EE_PRODUCT_PROPOSAL_STALE');
   const index=await this.#index.load(),entity=index?.value.entities.find(row=>row.entityId===current.proposal.entityId);
   if(entity?.revision===current.proposal.baseRevision+1&&entity.objectId===current.proposal.operation.objectId&&entity.payloadHash===held.payloadHash)
    return{intentId,proposalId:held.proposalId,entityId:current.proposal.entityId,completed:true,remaining:[]};
   const result=await this.options.client.executeService('product-approve',{proposalId:held.proposalId,entityId:current.proposal.entityId,baseRevision:current.proposal.baseRevision,payloadHash:held.payloadHash},intentId);this.#current();
   if(result.intentId!==intentId||result.proposalId!==held.proposalId||result.entityId!==current.proposal.entityId||typeof result.completed!=='boolean'||!Array.isArray(result.remaining))throw new Error('E2EE_PRODUCT_RECEIPT_INVALID');return result;
  });
 }
}
