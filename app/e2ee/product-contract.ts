import {assertTechnical,exactKeys} from './keys.ts';
import {decodeE2eeBytes,type E2eeContext} from './envelope.ts';

export const PRODUCT_KINDS=['project','space','task','comment','project-comment','status','category','label','mindmap','file','workflow','review-policy','planning','sprint','series','automation','template','custom-field','custom-field-value','view','history','trash','import'] as const;
export type ProductKind=typeof PRODUCT_KINDS[number];
export type ProductMetadata={protocol:1;statusId?:string|null;completed?:boolean;approverIds?:string[];dependsOnIds?:string[];presentFields?:string[];
 enabled?:boolean;statuses?:{statusId:string;wipLimit:number|null;requiredFields:string[]}[];transitions?:{fromStatusId:string|null;toStatusId:string;roles:string[]}[]};
export type ProductEntity={entityId:string;kind:ProductKind;revision:number;domain:E2eeContext['domain'];objectId:string;payloadHash:string;parentId:string|null;authorId:string;deleted:boolean;metadata:ProductMetadata;updatedAt:string};
export type ProductMutation={action:'create'|'update'|'delete'|'restore'|'propose-complete';entityId:string;kind:ProductKind;expectedRevision:number;
 domain:E2eeContext['domain'];objectId:string;payloadHash:string;parentId:string|null;metadata:ProductMetadata;proposalId:string|null};
export function productDomain(kind:ProductKind):E2eeContext['domain']{return kind==='comment'||kind==='project-comment'?'shared-comment':kind==='mindmap'?'mindmap':kind==='file'?'attachment':'shared-project';}
export function productMetadata(kind:ProductKind,input:unknown):ProductMetadata{
 const fields=kind==='task'?['protocol','statusId','completed','approverIds','dependsOnIds','presentFields']:kind==='workflow'?['protocol','enabled','statuses','transitions']:['protocol'];exactKeys(input,fields);
 if(input.protocol!==1)throw new Error('E2EE_PRODUCT_METADATA_INVALID');
 const ids=(value:unknown,max=200):string[]=>{if(!Array.isArray(value)||value.length>max||new Set(value).size!==value.length)throw new Error('E2EE_PRODUCT_METADATA_INVALID');for(const id of value)assertTechnical(id);return value;};
 if(kind==='task'){if(input.statusId!==null)assertTechnical(input.statusId);if(typeof input.completed!=='boolean')throw new Error('E2EE_PRODUCT_METADATA_INVALID');ids(input.approverIds);ids(input.dependsOnIds,1000);ids(input.presentFields);}
 if(kind==='workflow'){
  if(typeof input.enabled!=='boolean'||!Array.isArray(input.statuses)||input.statuses.length>200||!Array.isArray(input.transitions)||input.transitions.length>10000)throw new Error('E2EE_PRODUCT_METADATA_INVALID');
  const statuses=new Set<string>();for(const row of input.statuses){exactKeys(row,['statusId','wipLimit','requiredFields']);assertTechnical(row.statusId);if(statuses.has(row.statusId)||row.wipLimit!==null&&(!Number.isSafeInteger(row.wipLimit)||Number(row.wipLimit)<1||Number(row.wipLimit)>100000))throw new Error('E2EE_PRODUCT_METADATA_INVALID');statuses.add(row.statusId);ids(row.requiredFields);}
  for(const row of input.transitions){exactKeys(row,['fromStatusId','toStatusId','roles']);if(row.fromStatusId!==null&&!statuses.has(String(row.fromStatusId))||!statuses.has(String(row.toStatusId)))throw new Error('E2EE_PRODUCT_METADATA_INVALID');
   const roles=ids(row.roles,5);if(!roles.length||roles.some(role=>!['owner','manager','member','commenter','viewer'].includes(role)))throw new Error('E2EE_PRODUCT_METADATA_INVALID');}
 }return input as ProductMetadata;
}
export function productEntity(input:unknown):ProductEntity{
 exactKeys(input,['entityId','kind','revision','domain','objectId','payloadHash','parentId','authorId','deleted','metadata','updatedAt']);assertTechnical(input.entityId);assertTechnical(input.authorId);assertTechnical(input.objectId);decodeE2eeBytes(input.payloadHash,32);
 if(!PRODUCT_KINDS.includes(input.kind as ProductKind)||input.domain!==productDomain(input.kind as ProductKind)||!Number.isSafeInteger(input.revision)||Number(input.revision)<1
  ||typeof input.deleted!=='boolean'||typeof input.updatedAt!=='string'||!Number.isFinite(Date.parse(input.updatedAt)))throw new Error('E2EE_PRODUCT_ENTITY_INVALID');
 if(input.parentId!==null)assertTechnical(input.parentId);productMetadata(input.kind as ProductKind,input.metadata);return input as ProductEntity;
}
export function productMutation(input:unknown):ProductMutation{
 exactKeys(input,['action','entityId','kind','expectedRevision','domain','objectId','payloadHash','parentId','metadata','proposalId']);
 assertTechnical(input.entityId);assertTechnical(input.objectId);decodeE2eeBytes(input.payloadHash,32);
 if(!PRODUCT_KINDS.includes(input.kind as ProductKind)||!['create','update','delete','restore','propose-complete'].includes(String(input.action))
  ||!Number.isSafeInteger(input.expectedRevision)||Number(input.expectedRevision)<0||Number(input.expectedRevision)>=Number.MAX_SAFE_INTEGER||input.domain!==productDomain(input.kind as ProductKind)
  ||!/^product-version:[a-f0-9-]{36}$/.test(input.objectId))throw new Error('E2EE_PRODUCT_BATCH_INVALID');
 if(input.parentId!==null)assertTechnical(input.parentId);if(input.action==='propose-complete'){assertTechnical(input.proposalId);if(input.kind!=='task')throw new Error('E2EE_PRODUCT_BATCH_INVALID');}else if(input.proposalId!==null)throw new Error('E2EE_PRODUCT_BATCH_INVALID');
 productMetadata(input.kind as ProductKind,input.metadata);return input as ProductMutation;
}
