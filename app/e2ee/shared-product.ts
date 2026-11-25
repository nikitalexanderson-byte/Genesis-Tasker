import {E2eePrivateDocument} from './product-repository.ts';
import {E2eeDeviceDocument} from './device-document.ts';
import {PRODUCT_KINDS,productDomain,productEntity,productMetadata,productMutation,type ProductEntity,type ProductKind,type ProductMetadata,type ProductMutation} from './product-contract.ts';
import {samePrivateJson as same} from './product-json.ts';
import {verifyProductPage,type VerifiedProductProposal} from './product-proofs.ts';
import {assertTechnical,exactKeys} from './keys.ts';
import {encodeE2eeBytes} from './envelope.ts';
import {canonicalE2eeValue,type SignedE2eeCommand,type WireValue} from './commands.ts';
import type {E2eeScopeClient} from './scope-client.ts';
import type {UnlockedWebDevice} from './device-vault.ts';

export type ProductVersion={protocol:1;scopeId:string;entityId:string;kind:ProductKind;revision:number;parentId:string|null;deleted:boolean;metadata:ProductMetadata;body:unknown};
export type ProductVersionSnapshot={versions:ProductVersion[];bootstrapTaskIds:string[]};
type Draft={operation:Omit<ProductMutation,'payloadHash'>;version:ProductVersion;payloadHash:string|null};
type Transaction={format:'genesis-product-transaction-v1';scopeId:string;intentId:string;membershipIntentId?:string;drafts:Draft[];acknowledged:boolean;receipt:Record<string,WireValue>|null};
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
 #headProofs=new Map<string,string>();
 #bootstrapTaskIds=new Set<string>();
 constructor(private readonly options:SharedProductOptions){assertTechnical(options.scopeId);options.client.assertBinding(options.device,options.scopeId);
  this.#prefix=crypto.subtle.digest('SHA-256',encoder.encode(options.scopeId)).then(bytes=>`product-tx:${encodeE2eeBytes(new Uint8Array(bytes))}:`);
  this.#index=new E2eeDeviceDocument(options.device,`product-index:${options.scopeId}`,value=>{exactKeys(value,['protocol','scopeId','entities']);
   if(value.protocol!==1||value.scopeId!==options.scopeId||!Array.isArray(value.entities)||value.entities.length>100000)throw new Error('E2EE_PRODUCT_INDEX_INVALID');
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
   if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('E2EE_PRODUCT_TRANSACTION_INVALID');exactKeys(value,['format','scopeId','intentId',...(Object.hasOwn(value,'membershipIntentId')?['membershipIntentId']:[]),'drafts','acknowledged','receipt']);if(value.format!=='genesis-product-transaction-v1'||value.scopeId!==this.options.scopeId||!Array.isArray(value.drafts)||value.drafts.length<1||value.drafts.length>100||typeof value.acknowledged!=='boolean')throw new Error('E2EE_PRODUCT_TRANSACTION_INVALID');assertTechnical(value.intentId);if(Object.hasOwn(value,'membershipIntentId'))assertTechnical(value.membershipIntentId);
  const entities=new Set<string>(),objects=new Set<string>();for(const draft of value.drafts){exactKeys(draft,['operation','version','payloadHash']);
   exactKeys(draft.operation,['action','entityId','kind','expectedRevision','domain','objectId','parentId','metadata','proposalId']);const operation=draft.operation;
   assertTechnical(operation.entityId);assertTechnical(operation.objectId);if(entities.has(operation.entityId)||objects.has(operation.objectId)||!/^product-version:[a-f0-9-]{36}$/.test(operation.objectId)
    ||!Number.isSafeInteger(operation.expectedRevision)||Number(operation.expectedRevision)<0||operation.domain!==productDomain(operation.kind as ProductKind)
    ||!['create','update','delete','restore','propose-complete'].includes(String(operation.action)))throw new Error('E2EE_PRODUCT_TRANSACTION_INVALID');entities.add(operation.entityId);objects.add(operation.objectId);
   if(draft.payloadHash!==null&&typeof draft.payloadHash!=='string')throw new Error('E2EE_PRODUCT_TRANSACTION_INVALID');productMetadata(operation.kind as ProductKind,operation.metadata);
  }return value as Transaction;
 },()=>this.#current());}
 async #readIndex(offline:boolean){const local=await this.#index.load();this.#current();if(offline){if(!local)throw new Error('E2EE_OFFLINE_CONTENT_UNAVAILABLE');return local.value.entities;}
  await this.options.client.refresh();this.#current();const entities:ProductEntity[]=[];let after='',limit=50,bootstrap:{proofHash:string;expectedCount:number}|null=null;const seen=new Set<string>(),proposals=new Map<string,VerifiedProductProposal>(),headProofs=new Map<string,string>(),bootstrapTaskIds=new Set<string>();
  for(let page=0;page<=100032;page++){
   let response;try{response=await this.options.client.readProductIndex(after,limit);}catch(error){if(limit>1&&error instanceof Error&&error.message==='E2EE_PRODUCT_PAGE_TOO_LARGE'){limit=Math.max(1,Math.floor(limit/2));continue;}throw error;}
   this.#current();const verified=await verifyProductPage(response,packet=>this.options.client.verifyServiceProof(packet));this.#current();if(verified.entities.length>limit)throw new Error('E2EE_PRODUCT_INDEX_INVALID');
   if(bootstrap&&bootstrap.proofHash!==verified.bootstrap.proofHash)throw new Error('E2EE_PRODUCT_PROOF_INVALID');bootstrap=verified.bootstrap;
   if(!Array.isArray(response.heads))throw new Error('E2EE_PRODUCT_PROOF_INVALID');for(const head of response.heads){exactKeys(head,['entityId','revision','proofHash']);headProofs.set(head.entityId as string,head.proofHash as string);}
   for(const row of verified.entities){if(row.entityId<=after||seen.has(row.entityId))throw new Error('E2EE_PRODUCT_INDEX_INVALID');seen.add(row.entityId);entities.push(row);if(entities.length>100000)throw new Error('E2EE_SCOPE_OBJECT_LIMIT');}
   for(const origin of verified.origins)if(origin.bootstrap&&origin.entityId.startsWith('task:'))bootstrapTaskIds.add(origin.entityId);
   for(const proposal of verified.proposals){if(proposals.has(proposal.proposalId))throw new Error('E2EE_PRODUCT_PROOF_INVALID');proposals.set(proposal.proposalId,proposal);}
   if(verified.entities.length<limit)break;after=entities.at(-1)!.entityId;if(page===100032)throw new Error('E2EE_PRODUCT_INDEX_INVALID');
  }
  if(!bootstrap||entities.length<bootstrap.expectedCount)throw new Error('E2EE_PRODUCT_BOOTSTRAP_INCOMPLETE');
  const byId=new Map(entities.map(row=>[row.entityId,row]));for(const old of local?.value.entities??[]){const row=byId.get(old.entityId);if(!row||row.revision<old.revision||row.revision===old.revision&&!same(row,old))throw new Error('E2EE_REMOTE_ROLLBACK');}
  if(!same(entities,local?.value.entities))await this.#index.save({protocol:1,scopeId:this.options.scopeId,entities},local?.serial??null);this.#current();this.#proposals=proposals;this.#headProofs=headProofs;this.#bootstrapTaskIds=bootstrapTaskIds;return entities;
 }
 index(offline=false){return this.#operation(()=>this.#readIndex(offline));}
 async #versionCache(entity:ProductEntity){
  // Earlier cache entries were populated before the envelope and reference were checked together.
  const id='product-read-v2:'+encodeE2eeBytes(new Uint8Array(await crypto.subtle.digest('SHA-256',canonicalE2eeValue({scopeId:this.options.scopeId,entity}))));this.#current();
  return new E2eeDeviceDocument(this.options.device,id,input=>{
   exactKeys(input,['protocol','scopeId','entity','version']);
   if(input.protocol!==1||input.scopeId!==this.options.scopeId||!same(productEntity(input.entity),entity))throw new Error('E2EE_PRODUCT_VERSION_INVALID');
   return input as {protocol:1;scopeId:string;entity:ProductEntity;version:unknown};
  },()=>this.#current());
 }
 async #read(entity:ProductEntity,offline:boolean,fromFreshIndex=false){
  // Only the complete snapshot below may reuse an immutable body. Its index
  // has just passed online ACL, directory and signed-head verification. A
  // failed refresh never enters this branch or falls back to cached content.
  const cache=!offline&&fromFreshIndex?await this.#versionCache(entity):null,cached=await cache?.load();this.#current();
  const expected=offline?undefined:{revision:1,payloadHash:entity.payloadHash,currentGeneration:true};
  const view=cached?null:await this.#document(entity.objectId,entity.kind).load(offline?'offline':'online',expected);this.#current();
  if(view&&(view.pending||view.conflict||view.remoteRevision!==1))throw new Error('E2EE_PRODUCT_VERSION_INVALID');
  const value=await this.#version(cached?cached.value.version:view!.value);
  if(value.entityId!==entity.entityId||value.kind!==entity.kind||value.revision!==entity.revision
   ||value.parentId!==entity.parentId||value.deleted!==entity.deleted||!same(value.metadata,entity.metadata))throw new Error('E2EE_PRODUCT_VERSION_INVALID');
  this.#current();
  if(cache&&!cached){const held={protocol:1 as const,scopeId:this.options.scopeId,entity,version:value};
   try{await cache.save(held,null);}catch(error){
    if(!(error instanceof Error)||error.message!=='E2EE_LOCAL_CONFLICT')throw error;
    const concurrent=await cache.load();this.#current();if(!concurrent||!same(concurrent.value,held))throw new Error('E2EE_PRODUCT_VERSION_INVALID');
   }
  }
  this.#current();return structuredClone(value);
 }
 read(entity:ProductEntity,offline=false){const held=productEntity(structuredClone(entity));return this.#operation(()=>this.#read(held,offline));}
 versionSnapshot(offline=false):Promise<ProductVersionSnapshot>{return this.#operation(async()=>{
  const entities=await this.#readIndex(offline),versions:ProductVersion[]=[];this.#current();
  for(const entity of entities){versions.push(await this.#read(entity,offline,true));this.#current();}
  return{versions,bootstrapTaskIds:offline?[]:[...this.#bootstrapTaskIds]};
 });}
 async versions(offline=false){return(await this.versionSnapshot(offline)).versions;}
 history(entityId:string,before=Number.MAX_SAFE_INTEGER,limit=5){assertTechnical(entityId);return this.#operation(async()=>{
  await this.options.client.refresh();this.#current();let response;
  for(;;){try{response=await this.options.client.readProductHistory(entityId,before,limit);break;}catch(error){if(limit>1&&error instanceof Error&&error.message==='E2EE_PRODUCT_PAGE_TOO_LARGE'){limit=Math.max(1,Math.floor(limit/2));continue;}throw error;}}
  exactKeys(response,['pages','checkpointHash','directoryRevision']);if(!Array.isArray(response.pages)||response.pages.length>limit)throw new Error('E2EE_PRODUCT_HISTORY_INVALID');
  const versions:ProductVersion[]=[],origins:import('./product-proofs.ts').VerifiedProductOrigin[]=[];let previous=before;
  for(const page of response.pages){const verified=await verifyProductPage(page,packet=>this.options.client.verifyServiceProof(packet));this.#current();
   if(verified.entities.length!==1)throw new Error('E2EE_PRODUCT_HISTORY_INVALID');const entity=verified.entities[0];if(entity.entityId!==entityId||entity.revision>=previous)throw new Error('E2EE_PRODUCT_HISTORY_INVALID');previous=entity.revision;versions.push(await this.#read(entity,false));origins.push(verified.origins[0]);
  }return{versions,origins,nextBefore:versions.length===limit?previous:null};
 });}
 #stage(input:ProductEdit[],intentId:string,membershipIntentId?:string){const edits=structuredClone(input);if(membershipIntentId!==undefined)assertTechnical(membershipIntentId);return this.#operation(async()=>{
  assertTechnical(intentId);if(edits.length<1||edits.length>100||new Set(edits.map(row=>row.entityId)).size!==edits.length)throw new Error('E2EE_PRODUCT_BATCH_INVALID');const drafts:Draft[]=[];
  const id=(await this.#prefix)+intentId,previous=await this.#transaction(id).load();
   if(previous){if(previous.value.drafts.length!==edits.length||previous.value.membershipIntentId!==membershipIntentId)throw new Error('E2EE_IDEMPOTENCY_CONFLICT');
   for(const [index,edit]of edits.entries()){const old=previous.value.drafts[index],operation=old.operation,version=await this.#version(old.version);
    if(operation.action!==edit.action||operation.entityId!==edit.entityId||operation.kind!==edit.kind||operation.expectedRevision!==edit.expectedRevision||operation.parentId!==edit.parentId
      ||edit.proposalId!==undefined&&edit.proposalId!==operation.proposalId||!same(operation.metadata,edit.metadata)||!same(version.body,edit.body))throw new Error('E2EE_IDEMPOTENCY_CONFLICT');
   }return intentId;
  }
  for(const edit of edits){const version=await this.#version({protocol:1,scopeId:this.options.scopeId,entityId:edit.entityId,kind:edit.kind,revision:edit.expectedRevision+1,parentId:edit.parentId,deleted:edit.action==='delete',metadata:edit.metadata,body:edit.body});
   const operation:Draft['operation']={action:edit.action,entityId:edit.entityId,kind:edit.kind,expectedRevision:edit.expectedRevision,domain:productDomain(edit.kind),objectId:`product-version:${crypto.randomUUID()}`,parentId:edit.parentId,metadata:version.metadata,proposalId:edit.action==='propose-complete'?edit.proposalId??crypto.randomUUID():null};
   drafts.push({operation,version,payloadHash:null});}
   await this.#transaction(id).save({format:'genesis-product-transaction-v1',scopeId:this.options.scopeId,intentId,...(membershipIntentId===undefined?{}:{membershipIntentId}),drafts,acknowledged:false,receipt:null},null);this.#current();return intentId;
 });}
 stage(input:ProductEdit[],intentId=crypto.randomUUID()){return this.#stage(input,intentId);}
 stageForMembership(input:ProductEdit[],membershipIntentId:string,intentId:string){return this.#stage(input,intentId,membershipIntentId);}
  async #prepare(intentId:string){const id=(await this.#prefix)+intentId,transaction=this.#transaction(id);let saved=await transaction.load();if(!saved)throw new Error('E2EE_PRODUCT_TRANSACTION_MISSING');
   let state=structuredClone(saved.value);
  for(const [index,draft]of state.drafts.entries()){
   const version=await this.#version(draft.version),operation=draft.operation;if(version.entityId!==operation.entityId||version.kind!==operation.kind||version.revision!==operation.expectedRevision+1||version.parentId!==operation.parentId||version.deleted!==(operation.action==='delete')||!same(version.metadata,operation.metadata))throw new Error('E2EE_PRODUCT_TRANSACTION_INVALID');
   const document=this.#document(operation.objectId,operation.kind);let staged;
   try{staged=await document.load('offline');}catch(error){if(!(error instanceof Error)||error.message!=='E2EE_OFFLINE_CONTENT_UNAVAILABLE')throw error;await document.save(version,{serial:null,remoteRevision:0});staged=await document.load('offline');}
   if(!same(staged.value,version)||staged.conflict||staged.remoteRevision>1)throw new Error('E2EE_PRODUCT_VERSION_IMMUTABLE');if(staged.pending)await document.flush();
   const reference=await this.options.client.objectReference(operation.domain,operation.objectId);this.#current();if(reference.revision!==1||draft.payloadHash!==null&&draft.payloadHash!==reference.payloadHash)throw new Error('E2EE_OBJECT_REFERENCE_MISMATCH');
   if(draft.payloadHash===null){state.drafts[index].payloadHash=reference.payloadHash;saved=await transaction.save(state,saved.serial);state=structuredClone(saved.value);}
  }
   return state.drafts.map(row=>({...row.operation,payloadHash:row.payloadHash!}));
  }
  /** Uploads immutable encrypted versions without activating business heads.
   * Used by a larger signed atomic transaction; stage() already retained input. */
  prepare(intentId:string){assertTechnical(intentId);return this.#operation(()=>this.#prepare(intentId));}
  async #acknowledge(intentId:string,operations:ProductMutation[],receipt:Record<string,WireValue>){
   const transaction=this.#transaction((await this.#prefix)+intentId),saved=await transaction.load();if(!saved)throw new Error('E2EE_PRODUCT_TRANSACTION_MISSING');const state=saved.value;
  if(receipt.intentId!==state.intentId||!Array.isArray(receipt.results)||receipt.results.length!==operations.length)throw new Error('E2EE_PRODUCT_RECEIPT_INVALID');
  for(const operation of operations){const result=receipt.results.find(row=>row&&typeof row==='object'&&!Array.isArray(row)&&row.entityId===operation.entityId) as Record<string,WireValue>|undefined;
   if(!result||result.revision!==(operation.action==='propose-complete'?operation.expectedRevision:operation.expectedRevision+1)||result.payloadHash!==operation.payloadHash)throw new Error('E2EE_PRODUCT_RECEIPT_INVALID');}
   if(!same(state.drafts.map(row=>({...row.operation,payloadHash:row.payloadHash})),operations))throw new Error('E2EE_PRODUCT_RECEIPT_INVALID');
   if(state.acknowledged){if(!same(state.receipt,receipt))throw new Error('E2EE_PRODUCT_RECEIPT_INVALID');return receipt;}
   await transaction.save({...state,acknowledged:true,receipt},saved.serial);this.#current();return receipt;
 }
  async #flush(intentId:string){const saved=await this.#transaction((await this.#prefix)+intentId).load();if(!saved)throw new Error('E2EE_PRODUCT_TRANSACTION_MISSING');if(saved.value.acknowledged)return saved.value.receipt!;
   if(saved.value.membershipIntentId!==undefined)throw new Error('E2EE_BOUND_TRANSACTION_REQUIRED');
   const operations=await this.#prepare(intentId),receipt=await this.options.client.executeService('product-commit',{operations:operations as unknown as WireValue},intentId);this.#current();return this.#acknowledge(intentId,operations,receipt);
  }
  /** Checks the signed normal repository readback before acknowledging a commit
   * performed inside a containing membership transaction. Never sends a POST. */
  confirmPrepared(intentId:string,receipt:Record<string,WireValue>,expectedPacket:SignedE2eeCommand){const held=structuredClone(receipt),packet=structuredClone(expectedPacket);assertTechnical(intentId);return this.#operation(async()=>{
   const saved=await this.#transaction((await this.#prefix)+intentId).load(),proof=await this.options.client.verifyServiceProof(packet);this.#current();
   if(proof.command.action!=='product-commit-bound'||proof.command.payload.intentId!==intentId||!Array.isArray(proof.command.payload.operations))throw new Error('E2EE_PRODUCT_RECEIPT_INVALID');
   const own=proof.command.deviceId===this.options.device.deviceId;
   if(own&&!saved)throw new Error('E2EE_PRODUCT_TRANSACTION_MISSING');if(saved&&(!own||!saved.value.membershipIntentId))throw new Error('E2EE_PRODUCT_RECEIPT_INVALID');
   const operations=proof.command.payload.operations.map(productMutation);if(operations.length<1||operations.length>100||new Set(operations.map(row=>row.entityId)).size!==operations.length)throw new Error('E2EE_PRODUCT_RECEIPT_INVALID');
   if(saved&&!same(saved.value.drafts.map(row=>{if(!row.payloadHash)throw new Error('E2EE_PRODUCT_TRANSACTION_MISSING');return{...row.operation,payloadHash:row.payloadHash};}),operations))throw new Error('E2EE_PRODUCT_RECEIPT_INVALID');
   if(held.intentId!==intentId||!Array.isArray(held.results)||held.results.length!==operations.length)throw new Error('E2EE_PRODUCT_RECEIPT_INVALID');
   for(const operation of operations){const result=held.results.filter(row=>row&&typeof row==='object'&&!Array.isArray(row)&&row.entityId===operation.entityId) as Record<string,WireValue>[];if(result.length!==1||result[0].revision!==operation.expectedRevision+1||result[0].payloadHash!==operation.payloadHash)throw new Error('E2EE_PRODUCT_RECEIPT_INVALID');}
   const index=await this.#readIndex(false);this.#current();
   for(const operation of operations){let entity=index.find(row=>row.entityId===operation.entityId);const revision=operation.expectedRevision+1;
    if(!entity||operation.action==='propose-complete'||entity.revision<revision)throw new Error('E2EE_PRODUCT_RECEIPT_INVALID');
    if(entity.revision===revision){if(this.#headProofs.get(entity.entityId)!==proof.proofHash)throw new Error('E2EE_PRODUCT_RECEIPT_INVALID');}
    else{
     const response=await this.options.client.readProductHistory(operation.entityId,revision+1,1);this.#current();exactKeys(response,['pages','checkpointHash','directoryRevision']);
     if(!Array.isArray(response.pages)||response.pages.length!==1)throw new Error('E2EE_PRODUCT_RECEIPT_INVALID');const raw=response.pages[0],historical=await verifyProductPage(raw,value=>this.options.client.verifyServiceProof(value));this.#current();
     if(historical.entities.length!==1)throw new Error('E2EE_PRODUCT_RECEIPT_INVALID');entity=historical.entities[0];const heads=(raw as {heads:unknown[]}).heads;
     if(!Array.isArray(heads)||heads.length!==1)throw new Error('E2EE_PRODUCT_RECEIPT_INVALID');exactKeys(heads[0],['entityId','revision','proofHash']);if(heads[0].proofHash!==proof.proofHash)throw new Error('E2EE_PRODUCT_RECEIPT_INVALID');
    }
    if(entity.entityId!==operation.entityId||entity.revision!==revision||entity.kind!==operation.kind||entity.domain!==operation.domain||entity.objectId!==operation.objectId||entity.payloadHash!==operation.payloadHash
     ||entity.parentId!==operation.parentId||entity.deleted!==(operation.action==='delete')||!same(entity.metadata,operation.metadata))throw new Error('E2EE_PRODUCT_RECEIPT_INVALID');
    const value=await this.#read(entity,false);if(saved){const draft=saved.value.drafts.find(row=>row.operation.entityId===operation.entityId)!;if(!same(value,await this.#version(draft.version)))throw new Error('E2EE_PRODUCT_RECEIPT_INVALID');}
   }return saved?this.#acknowledge(intentId,operations,held):held;
  });}
 flush(intentId:string){assertTechnical(intentId);return this.#operation(()=>this.#flush(intentId));}
 pending(){return this.#operation(async()=>{const prefix=await this.#prefix,ids=await this.options.device.vault.listLocal('draft',prefix);this.#current();const pending:string[]=[];
   for(const id of ids){const value=await this.#transaction(id).load();if(!value)throw new Error('E2EE_PRODUCT_TRANSACTION_MISSING');if(!value.value.acknowledged&&value.value.membershipIntentId===undefined)pending.push(value.value.intentId);}return pending;});}
 localVersions(){return this.#operation(async()=>{const prefix=await this.#prefix,ids=await this.options.device.vault.listLocal('draft',prefix),rows:PendingProductVersion[]=[];this.#current();
  for(const id of ids){const saved=await this.#transaction(id).load();if(!saved)throw new Error('E2EE_PRODUCT_TRANSACTION_MISSING');if(saved.value.acknowledged)continue;
   for(const draft of saved.value.drafts){const version=await this.#version(draft.version),operation=draft.operation;
    if(version.entityId!==operation.entityId||version.kind!==operation.kind||version.revision!==operation.expectedRevision+1||version.parentId!==operation.parentId||version.deleted!==(operation.action==='delete')||!same(version.metadata,operation.metadata))throw new Error('E2EE_PRODUCT_TRANSACTION_INVALID');
    rows.push({intentId:saved.value.intentId,action:operation.action,expectedRevision:operation.expectedRevision,version});if(rows.length>100000)throw new Error('E2EE_SCOPE_OBJECT_LIMIT');
   }
  }return rows;
 });}
 async #proposal(id:string,expectedHash:string){assertTechnical(id);await this.#readIndex(false);const proposal=this.#proposals.get(id);
  if(!proposal||proposal.operation.payloadHash!==expectedHash)throw new Error('E2EE_PRODUCT_PROPOSAL_STALE');
  const opened=await this.#document(proposal.operation.objectId,'task').load('online',{revision:1,payloadHash:expectedHash,currentGeneration:true}),version=await this.#version(opened.value);this.#current();
  if(opened.pending||opened.conflict||opened.remoteRevision!==1||version.entityId!==proposal.entityId||version.kind!=='task'||version.revision!==proposal.baseRevision+1
   ||version.deleted||version.parentId!==proposal.operation.parentId||!same(version.metadata,proposal.operation.metadata))throw new Error('E2EE_PRODUCT_PROPOSAL_STALE');
  return{proposal,version};
 }
 proposal(id:string,expectedHash:string){return this.#operation(()=>this.#proposal(id,expectedHash));}
 completionProposals(){this.#current();return structuredClone([...this.#proposals.values()]);}
 approvalPreview(entityId:string){assertTechnical(entityId);return this.#operation(async()=>{const entities=await this.#readIndex(false),entity=entities.find(row=>row.entityId===entityId&&row.kind==='task'&&!row.deleted);if(!entity)throw new Error('E2EE_PRODUCT_ENTITY_MISSING');
  const rows=[];for(const proposal of this.#proposals.values())if(proposal.entityId===entityId&&proposal.baseRevision===entity.revision&&proposal.operation.metadata.approverIds?.includes(this.options.device.ownerId)){
   const opened=await this.#proposal(proposal.proposalId,proposal.operation.payloadHash);rows.push({proposalId:proposal.proposalId,payloadHash:proposal.operation.payloadHash,version:opened.version});
  }return rows;
 });}
 approve(review:{proposalId:string;payloadHash:string;version:ProductVersion},intentId=crypto.randomUUID()){
  const held=structuredClone(review);assertTechnical(intentId);return this.#operation(async()=>{
   const decision=new E2eeDeviceDocument(this.options.device,(await this.#prefix).replace('product-tx:','product-approval:')+intentId,value=>{exactKeys(value,['scopeId','intentId','review']);if(value.scopeId!==this.options.scopeId||value.intentId!==intentId||!same(value.review,held))throw new Error('E2EE_IDEMPOTENCY_CONFLICT');return value;},()=>this.#current());
   const saved=await decision.load();if(!saved)await decision.save({scopeId:this.options.scopeId,intentId,review:held},null);this.#current();const current=await this.#proposal(held.proposalId,held.payloadHash);
   if(!same(await this.#version(held.version),current.version))throw new Error('E2EE_PRODUCT_PROPOSAL_STALE');
   const index=await this.#index.load(),entity=index?.value.entities.find(row=>row.entityId===current.proposal.entityId);
   if(entity?.revision===current.proposal.baseRevision+1&&entity.objectId===current.proposal.operation.objectId&&entity.payloadHash===held.payloadHash)
    return{intentId,proposalId:held.proposalId,entityId:current.proposal.entityId,completed:true,remaining:[]};
   const result=await this.options.client.executeService('product-approve',{proposalId:held.proposalId,entityId:current.proposal.entityId,baseRevision:current.proposal.baseRevision,payloadHash:held.payloadHash},intentId);this.#current();
   if(result.intentId!==intentId||result.proposalId!==held.proposalId||result.entityId!==current.proposal.entityId||typeof result.completed!=='boolean'||!Array.isArray(result.remaining))throw new Error('E2EE_PRODUCT_RECEIPT_INVALID');return result;
  });
 }
}
