import {encodeE2eeBytes} from './envelope.ts';
import contract from '../../contracts/e2ee/shared-record-bodies-v1.json' with {type:'json'};
import {E2eeSharedProduct,type ProductEdit,type ProductVersion} from './shared-product.ts';
import {sharedEntityId,sharedRecordKey,sharedBodyMetadata,sharedBodyParent,validateSharedRecordBody,parseSharedDomainBytes,type SharedRecordBody,type SharedDomainBinding,type SharedContentRecord} from './shared-domain.ts';
import {requiredPrivatePaths,privatePathDocumentDomain} from './private-paths.ts';
import {privatePathSource} from './private-path-source.ts';
import {privateTableObjectId} from './relational-path-source.ts';
import {exactKeys,assertTechnical} from './keys.ts';
import {samePrivateJson} from './product-json.ts';
import type {WebPrivateAccount} from './product-session.ts';
import type {ProductKind,ProductEntity} from './product-contract.ts';

export type SharedBootstrapItem={edit:ProductEdit;authorId:string};
/** Normal record repository used by domain editors. It validates every field
 * against the declared source model and binds the private body to signed
 * business metadata; no API/legacy fallback or opaque permissive body parser. */
export class E2eeSharedRecords{
 readonly product:E2eeSharedProduct;
 constructor(private readonly account:WebPrivateAccount,readonly binding:SharedDomainBinding){
  const scope=account.shared(binding.scopeId,binding.kind,binding.resourceId);this.product=new E2eeSharedProduct({scopeId:binding.scopeId,kind:binding.kind,device:account.device,client:scope.client,
   assertCurrent:()=>account.requireOpen(),validateBody:(kind,body,header)=>validateSharedRecordBody(binding,kind,body,header)});
 }
 async index(){this.account.requireOpen();return this.product.index(this.account.mode==='offline');}
 async read(entity:ProductEntity){this.account.requireOpen();return this.product.read(entity,this.account.mode==='offline');}
 async get(kind:ProductKind,id:string){const key=sharedEntityId(kind,id),entities=await this.index(),entity=entities.find(row=>row.entityId===key&&row.kind===kind);if(!entity)throw new Error('E2EE_PRODUCT_ENTITY_MISSING');return this.read(entity);}
 async list(kind:ProductKind,includeDeleted=false){const entities=await this.index(),records:ProductVersion[]=[];for(const entity of entities)if(entity.kind===kind&&(includeDeleted||!entity.deleted))records.push(await this.read(entity));return records;}
 async stage(body:SharedRecordBody,expectedRevision:number,action:ProductEdit['action']='update'){
  this.account.requireOpen();const value=validateSharedRecordBody(this.binding,body.kind,structuredClone(body));if(value.execution!=='live')throw new Error('E2EE_HISTORY_NOT_EXECUTABLE');
  return this.product.stage([{action,entityId:sharedRecordKey(value.kind,value.record),kind:value.kind,expectedRevision,parentId:sharedBodyParent(value),metadata:sharedBodyMetadata(value),body:value}]);
 }
 flush(intentId:string){this.account.requireOpen();if(this.account.mode!=='online')throw new Error('E2EE_ONLINE_REQUIRED');return this.product.flush(intentId);}
 async sourceTable(table:string){
  this.account.requireOpen();const paths=requiredPrivatePaths(this.binding.kind).filter(row=>row.server.includes(table));if(paths.length!==1)throw new Error('E2EE_SOURCE_PATH_FORBIDDEN');
  const path=paths[0],domain=privatePathDocumentDomain(this.binding.kind,path.id),{client}=this.account.shared(this.binding.scopeId,this.binding.kind,this.binding.resourceId),opened=await client.readMigrationOriginal(domain,privateTableObjectId(path.id,table));this.account.requireOpen();
  try{const value=parseSharedDomainBytes(opened.bytes);exactKeys(value,['format','pathId','table','rows','execution']);if(value.format!=='genesis-private-table-v1'||value.pathId!==path.id||value.table!==table||value.execution!=='content-only'||!Array.isArray(value.rows)||value.rows.length>1000000)throw new Error('E2EE_PRIVATE_SEED_REQUIRED');return structuredClone(value.rows) as Record<string,unknown>[];}finally{opened.bytes.fill(0);}
 }
 /** Reads each declared migrated source/index with exact EOF/count/schema
  * bindings. Missing tables cannot become empty categories. Old jobs/receipts
  * remain in their content-only originals and never enter this live plan. */
 async collectBootstrap():Promise<SharedBootstrapItem[]>{
  this.account.requireOpen();if(this.account.mode!=='online')throw new Error('E2EE_ONLINE_REQUIRED');const {client,directory}=this.account.shared(this.binding.scopeId,this.binding.kind,this.binding.resourceId);
  if(directory.ownerId!==this.account.ownerId)throw new Error('E2EE_OWNER_REQUIRED');
  const tables=new Map<string,SharedContentRecord[]>();
  for(const path of requiredPrivatePaths(this.binding.kind).filter(path=>path.server.length)){
   const domain=privatePathDocumentDomain(this.binding.kind,path.id),indexRow=await client.read(domain,`private-path:${path.id}:index-v1`);this.account.requireOpen();if(!indexRow)throw new Error('E2EE_PRIVATE_SEED_REQUIRED');
   let index:Record<string,unknown>;try{const value=parseSharedDomainBytes(indexRow.bytes);exactKeys(value,['format','pathId','tables','localHistory','execution']);if(indexRow.revision!==1||value.format!=='genesis-private-path-index-v1'||value.pathId!==path.id||value.execution!=='content-only'||!Array.isArray(value.tables)||value.tables.length!==path.server.length)throw new Error('E2EE_SHARED_BOOTSTRAP_SOURCE_INVALID');index=value;}finally{indexRow.bytes.fill(0);}
   const spec=privatePathSource(this.binding.kind,path.id);for(const table of spec.server){
    const reference=(index.tables as {table:string;objectId:string;count:number}[]).filter(row=>row.table===table);if(reference.length!==1||reference[0].objectId!==privateTableObjectId(path.id,table))throw new Error('E2EE_SHARED_BOOTSTRAP_SOURCE_INVALID');
    const row=await client.read(domain,reference[0].objectId);this.account.requireOpen();if(!row)throw new Error('E2EE_PRIVATE_SEED_REQUIRED');
    try{const value=parseSharedDomainBytes(row.bytes);exactKeys(value,['format','pathId','table','rows','execution']);if(row.revision!==1||value.format!=='genesis-private-table-v1'||value.pathId!==path.id||value.table!==table||value.execution!=='content-only'||!Array.isArray(value.rows)||value.rows.length!==reference[0].count)throw new Error('E2EE_SHARED_BOOTSTRAP_SOURCE_INVALID');
     const previous=tables.get(table);if(previous&&!samePrivateJson(previous,value.rows))throw new Error('E2EE_SHARED_BOOTSTRAP_SOURCE_DIVERGED');tables.set(table,value.rows as SharedContentRecord[]);
    }finally{row.bytes.fill(0);}
   }
  }
  const items:SharedBootstrapItem[]=[],seen=new Set<string>(),deleted=new Set((tables.get('shared_trash')??[]).map(row=>`${row.kind}:${row.object_id}`));
  for(const [kind,roots]of Object.entries(contract.roots) as [ProductKind,string[]][]){
   if(contract.historyOnlyKinds.includes(kind)||kind==='automation-run')continue;
   for(const table of roots)for(const sourceRow of tables.get(table)??[]){const row=structuredClone(sourceRow);if(kind==='series-instance'){const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(String(row.occurrence_key)));row.occurrence_key=encodeE2eeBytes(new Uint8Array(hash));}const related:Record<string,SharedContentRecord[]>={};for(const name of contract.related[kind]){
     if(!tables.has(name))throw new Error('E2EE_PRIVATE_SEED_REQUIRED');const key=kind==='comment'?'comment_id':kind==='project'?'project_id':'task_id';related[name]=tables.get(name)!.filter(value=>value[key]===row.id);
    }
    const body=validateSharedRecordBody(this.binding,kind,{format:'genesis-shared-record-v1',kind,scopeId:this.binding.scopeId,scopeKind:this.binding.kind,resourceId:this.binding.resourceId,table,record:row,related,execution:'live'}),entityId=sharedRecordKey(kind,row);
    if(seen.has(entityId))throw new Error('E2EE_SHARED_BOOTSTRAP_DUPLICATE');seen.add(entityId);
    const authorId=String(row.created_by??row.author_id??row.owner_id??directory.ownerId);assertTechnical(authorId);
    const removed=deleted.has(entityId);items.push({edit:{action:removed?'delete':'create',entityId,kind,expectedRevision:0,parentId:sharedBodyParent(body),metadata:sharedBodyMetadata(body),body:removed?null:body},authorId});
   }
  }
  if(!items.some(item=>item.edit.kind===this.binding.kind&&item.edit.entityId===sharedEntityId(this.binding.kind,this.binding.resourceId)))throw new Error('E2EE_SHARED_BOOTSTRAP_SOURCE_INVALID');
  // Parent/dependency sorting is part of preparation, never a destructive repair.
  const remaining=new Map([...items].sort((a,b)=>a.edit.entityId<b.edit.entityId?-1:a.edit.entityId>b.edit.entityId?1:0).map(row=>[row.edit.entityId,row])),ordered:SharedBootstrapItem[]=[];const completed=new Set<string>();
  while(remaining.size){let progress=false;for(const [id,row]of remaining){const dependencies=[...(row.edit.parentId?[row.edit.parentId]:[]),...(row.edit.metadata.dependsOnIds??[])];
    if(dependencies.some(id=>!seen.has(id)))throw new Error('E2EE_SHARED_BOOTSTRAP_REFERENCE_INVALID');if(dependencies.every(id=>completed.has(id))){ordered.push(row);completed.add(id);remaining.delete(id);progress=true;}}
   if(!progress)throw new Error('E2EE_SHARED_BOOTSTRAP_CYCLE_REVIEW_REQUIRED');}
  return ordered;
 }
}
