import {E2eeDeviceDocument} from './device-document.ts';
import {E2eePrivateDocument} from './product-repository.ts';
import {verifyProductPage} from './product-proofs.ts';
import {validateSharedRecordBody} from './shared-domain.ts';
import {productDomain,productMutation,type ProductMutation} from './product-contract.ts';
import type {ProductVersion} from './shared-product.ts';
import type {E2eeSharedRecords,SharedBootstrapItem} from './shared-records.ts';
import type {WebPrivateAccount} from './product-session.ts';
import {assertTechnical,exactKeys} from './keys.ts';
import {encodeE2eeBytes,decodeE2eeBytes} from './envelope.ts';
import type {WireValue,SignedE2eeCommand} from './commands.ts';
import {samePrivateJson} from './product-json.ts';
import {parseLegacyMigrationJson} from './legacy-json.ts';

type PartItem={version:ProductVersion;operation:Omit<ProductMutation,'payloadHash'>;authorId:string;payloadHash:string|null};
type Part={protocol:1;scopeId:string;bootstrapId:string;partIndex:number;intentId:string;items:PartItem[];proofHash:string|null};
type Plan={protocol:1;scopeId:string;bootstrapId:string;sourceManifestHash:string;expectedCount:number;startIntentId:string;completeIntentId:string;parts:{id:string;count:number}[];phase:'preparing'|'ready'|'active'};
const encoder=new TextEncoder();
/** A complete protected baseline precedes every mutating request. Each part
 * carries immutable versions; only the owner's final signed part manifest makes
 * them a live index. A stopped upload leaves all old source objects intact. */
export class E2eeSharedBootstrap{
 #serial:Promise<unknown>=Promise.resolve();#key:Promise<string>;
 constructor(private readonly account:WebPrivateAccount,private readonly records:E2eeSharedRecords){this.#key=crypto.subtle.digest('SHA-256',encoder.encode(records.binding.scopeId)).then(bytes=>'product-bootstrap:'+encodeE2eeBytes(new Uint8Array(bytes)));}
 #current(){this.account.requireOpen();}
 #scope(){this.#current();return this.account.shared(this.records.binding.scopeId,this.records.binding.kind,this.records.binding.resourceId);}
 #run<T>(fn:()=>Promise<T>){const task=this.#serial.catch(()=>undefined).then(async()=>{this.#current();return fn();});this.#serial=task;return task;}
 #plan(id:string){return new E2eeDeviceDocument<Plan>(this.account.device,id,value=>{exactKeys(value,['protocol','scopeId','bootstrapId','sourceManifestHash','expectedCount','startIntentId','completeIntentId','parts','phase']);
  if(value.protocol!==1||value.scopeId!==this.records.binding.scopeId||!Number.isSafeInteger(value.expectedCount)||Number(value.expectedCount)<1||Number(value.expectedCount)>100000||!Array.isArray(value.parts)||value.parts.length<1||value.parts.length>4096||!['preparing','ready','active'].includes(String(value.phase)))throw new Error('E2EE_PRODUCT_BOOTSTRAP_INVALID');
  for(const key of ['bootstrapId','startIntentId','completeIntentId'] as const)assertTechnical(value[key]);decodeE2eeBytes(value.sourceManifestHash,32);let count=0;const seen=new Set<string>();
  for(const row of value.parts){exactKeys(row,['id','count']);assertTechnical(row.id);if(seen.has(row.id)||!Number.isSafeInteger(row.count)||Number(row.count)<1||Number(row.count)>100)throw new Error('E2EE_PRODUCT_BOOTSTRAP_INVALID');seen.add(row.id);count+=Number(row.count);}
  if(count!==value.expectedCount)throw new Error('E2EE_PRODUCT_BOOTSTRAP_INVALID');return value as Plan;
 },()=>this.#current());}
 #version(value:unknown):ProductVersion{exactKeys(value,['protocol','scopeId','entityId','kind','revision','parentId','deleted','metadata','body']);if(value.protocol!==1||value.scopeId!==this.records.binding.scopeId||value.revision!==1||typeof value.deleted!=='boolean')throw new Error('E2EE_PRODUCT_BOOTSTRAP_INVALID');assertTechnical(value.entityId);
  if(value.deleted){if(value.body!==null)throw new Error('E2EE_PRODUCT_BOOTSTRAP_INVALID');}else validateSharedRecordBody(this.records.binding,value.kind as ProductVersion['kind'],value.body,value as unknown as ProductVersion);return value as ProductVersion;}
 #part(id:string,plan:Plan,index:number){return new E2eeDeviceDocument<Part>(this.account.device,id,value=>{exactKeys(value,['protocol','scopeId','bootstrapId','partIndex','intentId','items','proofHash']);
  if(value.protocol!==1||value.scopeId!==plan.scopeId||value.bootstrapId!==plan.bootstrapId||value.partIndex!==index||!Array.isArray(value.items)||value.items.length!==plan.parts[index].count)throw new Error('E2EE_PRODUCT_BOOTSTRAP_INVALID');assertTechnical(value.intentId);if(value.proofHash!==null)decodeE2eeBytes(value.proofHash,32);
  for(const item of value.items){exactKeys(item,['version','operation','authorId','payloadHash']);const version=this.#version(item.version);assertTechnical(item.authorId);if(item.payloadHash!==null)decodeE2eeBytes(item.payloadHash,32);
   if(!item.operation||typeof item.operation!=='object'||Array.isArray(item.operation))throw new Error('E2EE_PRODUCT_BOOTSTRAP_INVALID');const operation=productMutation({...item.operation,payloadHash:item.payloadHash??encodeE2eeBytes(new Uint8Array(32))});
   if(!['create','delete'].includes(operation.action)||operation.expectedRevision!==0||version.entityId!==operation.entityId||version.kind!==operation.kind||version.deleted!==(operation.action==='delete')||version.parentId!==operation.parentId||!samePrivateJson(version.metadata,operation.metadata))throw new Error('E2EE_PRODUCT_BOOTSTRAP_INVALID');}
  return value as Part;
 },()=>this.#current());}
 #document(item:PartItem){const scope=this.#scope();return new E2eePrivateDocument<ProductVersion>({device:this.account.device,client:scope.client,scopeId:this.records.binding.scopeId,domain:item.operation.domain,objectId:item.operation.objectId,validate:value=>this.#version(value),assertCurrent:()=>this.#current(),assertWrite:()=>this.#current()});}
 async #recoverParts(source:SharedBootstrapItem[],manifestHash:string){
  const client=this.#scope().client,remaining=new Map(source.map(item=>[item.edit.entityId,item])),parts:Part[]=[],groups:SharedBootstrapItem[][]=[];
  let state:{bootstrapId:string;sourceManifestHash:string;expectedCount:number;state:'staging'|'active';partCount:number}|null=null,after=-1;
  for(let page=0;page<=4096;page++){
   const response=await client.readBootstrapState(after);this.#current();exactKeys(response,['bootstrap','part','checkpointHash','directoryRevision']);
   if(response.bootstrap===null){if(page!==0||response.part!==null)throw new Error('E2EE_PRODUCT_BOOTSTRAP_INVALID');return{state:null,parts,groups,remaining:[...remaining.values()]};}
   exactKeys(response.bootstrap,['bootstrapId','sourceManifestHash','expectedCount','state','partCount']);const header=response.bootstrap;
   assertTechnical(header.bootstrapId);decodeE2eeBytes(header.sourceManifestHash,32);
   if(header.sourceManifestHash!==manifestHash||header.expectedCount!==source.length||!['staging','active'].includes(String(header.state))||!Number.isInteger(header.partCount)||Number(header.partCount)<0||Number(header.partCount)>4096)throw new Error('E2EE_PRODUCT_BOOTSTRAP_SOURCE_CHANGED');
   if(state&&!samePrivateJson(header,state))throw new Error('E2EE_PRODUCT_BOOTSTRAP_SOURCE_CHANGED');state={bootstrapId:header.bootstrapId,sourceManifestHash:manifestHash,expectedCount:source.length,state:header.state as 'staging'|'active',partCount:Number(header.partCount)};
   if(response.part===null){if(parts.length!==header.partCount)throw new Error('E2EE_PRODUCT_BOOTSTRAP_INCOMPLETE');break;}
   if(page===4096)throw new Error('E2EE_PRODUCT_BOOTSTRAP_TOO_LARGE');
   exactKeys(response.part,['partIndex','proofHash','packet']);const remote=response.part;
   if(remote.partIndex!==after+1||typeof remote.packet!=='string')throw new Error('E2EE_PRODUCT_BOOTSTRAP_REVIEW_REQUIRED');decodeE2eeBytes(remote.proofHash,32);
   const proof=await client.verifyServiceProof(parseLegacyMigrationJson(remote.packet,'E2EE_PRODUCT_PROOF_INVALID',4*1024*1024) as SignedE2eeCommand);this.#current();
   const command=proof.command,payload=command.payload;exactKeys(payload,['intentId','bootstrapId','partIndex','items']);assertTechnical(payload.intentId);
   if(command.action!=='product-bootstrap-stage'||proof.actorId!==this.account.ownerId||proof.proofHash!==remote.proofHash||payload.bootstrapId!==header.bootstrapId||payload.partIndex!==remote.partIndex||!Array.isArray(payload.items)||payload.items.length<1||payload.items.length>100)throw new Error('E2EE_PRODUCT_PROOF_INVALID');
   const recovered:PartItem[]=[],group:SharedBootstrapItem[]=[];
   for(const item of payload.items){exactKeys(item,['operation','authorId']);const operation=productMutation(item.operation),original=remaining.get(operation.entityId);
    if(!original||item.authorId!==original.authorId||operation.action!==original.edit.action||operation.kind!==original.edit.kind||operation.expectedRevision!==0||operation.proposalId!==null
      ||operation.parentId!==original.edit.parentId||!samePrivateJson(operation.metadata,original.edit.metadata))throw new Error('E2EE_PRODUCT_BOOTSTRAP_SOURCE_CHANGED');
    const {payloadHash,...base}=operation,held:PartItem={operation:base,authorId:original.authorId,payloadHash,version:{protocol:1,scopeId:this.records.binding.scopeId,entityId:operation.entityId,kind:operation.kind,revision:1,parentId:operation.parentId,deleted:operation.action==='delete',metadata:operation.metadata,body:original.edit.body}};
    const opened=await this.#document(held).load('online');this.#current();
    if(opened.pending||opened.conflict||opened.remoteRevision!==1||!samePrivateJson(opened.value,held.version))throw new Error('E2EE_PRODUCT_BOOTSTRAP_SOURCE_CHANGED');
    await client.assertObjectReference(operation.domain,operation.objectId,1,payloadHash);this.#current();
    recovered.push(held);group.push(original);remaining.delete(operation.entityId);
   }
   parts.push({protocol:1,scopeId:this.records.binding.scopeId,bootstrapId:header.bootstrapId as string,partIndex:remote.partIndex as number,intentId:payload.intentId as string,items:recovered,proofHash:remote.proofHash as string});groups.push(group);after=remote.partIndex as number;
  }
  if(state?.state==='active'&&remaining.size)throw new Error('E2EE_PRODUCT_BOOTSTRAP_INCOMPLETE');
  return{state,parts,groups,remaining:[...remaining.values()]};
 }
 prepare(){return this.#run(async()=>{
  if(this.account.mode!=='online'||this.#scope().directory.ownerId!==this.account.ownerId)throw new Error('E2EE_OWNER_REQUIRED');
  const journal=this.#plan(await this.#key);let old=await journal.load();if(old&&old.value.phase!=='preparing')return old.value;
  const items=await this.records.collectBootstrap();this.#current();if(items.length<1||items.length>100000)throw new Error('E2EE_PRODUCT_BOOTSTRAP_INVALID');
  const original=await this.#scope().client.originalMigrationManifest(),recovery=await this.#recoverParts(items,original.manifestHash);
  if(old&&recovery.state&&old.value.bootstrapId!==recovery.state.bootstrapId)throw new Error('E2EE_PRODUCT_BOOTSTRAP_CONFLICT');
  const batches:SharedBootstrapItem[][]=recovery?.groups??[];let batch:SharedBootstrapItem[]=[],bytes=0;
  for(const item of recovery?.remaining??items){const size=encoder.encode(JSON.stringify(item)).length;if(batch.length&&(batch.length===100||bytes+size>8*1024*1024)){batches.push(batch);batch=[];bytes=0;}batch.push(item);bytes+=size;}if(batch.length)batches.push(batch);
  if(batches.length>4096)throw new Error('E2EE_PRODUCT_BOOTSTRAP_TOO_LARGE');
  if(!old){const bootstrapId=recovery?.state?.bootstrapId??crypto.randomUUID();old=await journal.save({protocol:1,scopeId:this.records.binding.scopeId,bootstrapId,sourceManifestHash:original.manifestHash,expectedCount:items.length,startIntentId:crypto.randomUUID(),completeIntentId:crypto.randomUUID(),parts:batches.map((rows,index)=>({id:`bootstrap-part:${bootstrapId}:${index}`,count:rows.length})),phase:'preparing'},null);}
  const plan=old.value;if(plan.expectedCount!==items.length||plan.parts.length!==batches.length)throw new Error('E2EE_PRODUCT_BOOTSTRAP_SOURCE_CHANGED');
  for(const [index,rows]of batches.entries()){const part=this.#part(plan.parts[index].id,plan,index),prior=await part.load();
   if(prior){for(const [at,row]of rows.entries()){const held=prior.value.items[at];if(!held||held.authorId!==row.authorId||held.operation.entityId!==row.edit.entityId||held.operation.action!==row.edit.action||held.version.parentId!==row.edit.parentId||!samePrivateJson(held.version.body,row.edit.body)||!samePrivateJson(held.version.metadata,row.edit.metadata))throw new Error('E2EE_PRODUCT_BOOTSTRAP_SOURCE_CHANGED');}continue;}
   if(recovery?.parts[index]){await part.save(recovery.parts[index],null);continue;}
   const output:PartItem[]=rows.map(({edit,authorId})=>{const version:ProductVersion={protocol:1,scopeId:plan.scopeId,entityId:edit.entityId,kind:edit.kind,revision:1,parentId:edit.parentId,deleted:edit.action==='delete',metadata:edit.metadata,body:edit.body};this.#version(version);
    return{version,authorId,payloadHash:null,operation:{action:edit.action,entityId:edit.entityId,kind:edit.kind,expectedRevision:0,domain:productDomain(edit.kind),objectId:'product-version:'+crypto.randomUUID(),parentId:edit.parentId,metadata:edit.metadata,proposalId:null}};});
   await part.save({protocol:1,scopeId:plan.scopeId,bootstrapId:plan.bootstrapId,partIndex:index,intentId:crypto.randomUUID(),items:output,proofHash:null},null);
  }
  if(recovery?.state?.state==='active'){
   const page=await verifyProductPage(await this.#scope().client.readProductIndex('',1),packet=>this.#scope().client.verifyServiceProof(packet));this.#current();
   if(page.bootstrap.bootstrapId!==plan.bootstrapId||page.bootstrap.expectedCount!==items.length||!samePrivateJson(page.bootstrap.parts,recovery.parts.map(part=>({partIndex:part.partIndex,proofHash:part.proofHash}))))throw new Error('E2EE_PRODUCT_PROOF_INVALID');
  }
  return(await journal.save({...plan,phase:recovery?.state?.state==='active'?'active':'ready'},old.serial)).value;
 });}
 flush(){return this.#run(async()=>{
  if(this.account.mode!=='online')throw new Error('E2EE_ONLINE_REQUIRED');const store=this.#plan(await this.#key),saved=await store.load();if(!saved||saved.value.phase==='preparing')throw new Error('E2EE_PRODUCT_BOOTSTRAP_PREPARE_REQUIRED');const plan=saved.value,scope=this.#scope();await scope.client.refresh();this.#current();
  if(plan.phase==='active')return plan;
  // Revalidate ALL retained parts before starting a remote baseline.
  for(let index=0;index<plan.parts.length;index++)if(!await this.#part(plan.parts[index].id,plan,index).load())throw new Error('E2EE_PRODUCT_BOOTSTRAP_INCOMPLETE');
  await scope.client.executeService('product-bootstrap-start',{bootstrapId:plan.bootstrapId,sourceManifestHash:plan.sourceManifestHash,expectedCount:plan.expectedCount},plan.startIntentId);
  const proofs:{partIndex:number;proofHash:string}[]=[];
  for(let index=0;index<plan.parts.length;index++){const part=this.#part(plan.parts[index].id,plan,index);let savedPart=await part.load();if(!savedPart)throw new Error('E2EE_PRODUCT_BOOTSTRAP_INCOMPLETE');const state=structuredClone(savedPart.value);
   for(const item of state.items){const document=this.#document(item);let view;try{view=await document.load('online');}catch(error){if(!(error instanceof Error)||error.message!=='E2EE_PRIVATE_DOCUMENT_MISSING')throw error;await document.save(item.version,{serial:null,remoteRevision:0});view=await document.load('offline');}
    if(view.conflict||view.remoteRevision>1||!samePrivateJson(view.value,item.version))throw new Error('E2EE_PRODUCT_BOOTSTRAP_INVALID');if(view.pending)await document.flush();
    const ref=await scope.client.objectReference(item.operation.domain,item.operation.objectId);if(ref.revision!==1||item.payloadHash!==null&&item.payloadHash!==ref.payloadHash)throw new Error('E2EE_OBJECT_REFERENCE_MISMATCH');
    if(item.payloadHash===null){item.payloadHash=ref.payloadHash;savedPart=await part.save(state,savedPart.serial);}
   }
   const payload={bootstrapId:plan.bootstrapId,partIndex:index,items:state.items.map(item=>({operation:{...item.operation,payloadHash:item.payloadHash!},authorId:item.authorId}))};
   const result=await scope.client.executeService('product-bootstrap-stage',payload as unknown as Record<string,WireValue>,state.intentId);this.#current();
   if(result.bootstrapId!==plan.bootstrapId||result.partIndex!==index||typeof result.proofPacket!=='string')throw new Error('E2EE_PRODUCT_BOOTSTRAP_INVALID');
   const proof=await scope.client.verifyServiceProof(parseLegacyMigrationJson(result.proofPacket,'E2EE_PRODUCT_PROOF_INVALID',4*1024*1024) as SignedE2eeCommand);
   if(proof.command.action!=='product-bootstrap-stage'||proof.proofHash!==result.proofHash||proof.actorId!==this.account.ownerId||!samePrivateJson(proof.command.payload,{...payload,intentId:state.intentId})||state.proofHash!==null&&state.proofHash!==proof.proofHash)throw new Error('E2EE_PRODUCT_PROOF_INVALID');
   if(state.proofHash===null){state.proofHash=proof.proofHash;await part.save(state,savedPart.serial);}proofs.push({partIndex:index,proofHash:proof.proofHash});
  }
  const result=await scope.client.executeService('product-bootstrap-complete',{bootstrapId:plan.bootstrapId,parts:proofs,expectedCount:plan.expectedCount},plan.completeIntentId);this.#current();
  if(result.bootstrapId!==plan.bootstrapId||result.state!=='active'||result.count!==plan.expectedCount)throw new Error('E2EE_PRODUCT_BOOTSTRAP_INVALID');
  const page=await verifyProductPage(await scope.client.readProductIndex('',1),packet=>scope.client.verifyServiceProof(packet));
  if(page.bootstrap.bootstrapId!==plan.bootstrapId||page.bootstrap.expectedCount!==plan.expectedCount||!samePrivateJson(page.bootstrap.parts,proofs))throw new Error('E2EE_PRODUCT_PROOF_INVALID');
  return(await store.save({...plan,phase:'active'},saved.serial)).value;
 });}
 inspect(){return this.#run(async()=>{const value=await this.#plan(await this.#key).load();return value?.value??null;});}
}
