import {assertTechnical,exactKeys} from './keys.ts';
import {decodeE2eeBytes,type E2eeContext} from './envelope.ts';

export const PRODUCT_KINDS=['project','space','task','comment','project-comment','status','category','label','mindmap','file','workflow','review-policy','planning','sprint','series','automation','template','custom-field','custom-field-value','view','history','trash','import'] as const;
export type ProductKind=typeof PRODUCT_KINDS[number];
export type ProductMetadata={protocol:1|2;statusId?:string|null;completed?:boolean;approverIds?:string[];dependsOnIds?:string[];presentFields?:string[];
 spaceId?:string;parentProjectId?:string|null;projectCategoryId?:string|null;boardStatusId?:string|null;projectType?:'project'|'task-list';layout?:'list'|'board';isInbox?:boolean;archived?:boolean;
 enabled?:boolean;statuses?:{statusId:string;wipLimit:number|null;requiredFields:string[]}[];transitions?:{fromStatusId:string|null;toStatusId:string;roles:string[]}[]};
export type ProductEntity={entityId:string;kind:ProductKind;revision:number;domain:E2eeContext['domain'];objectId:string;payloadHash:string;parentId:string|null;authorId:string;deleted:boolean;metadata:ProductMetadata;updatedAt:string};
export type ProductMutation={action:'create'|'update'|'delete'|'restore'|'propose-complete';entityId:string;kind:ProductKind;expectedRevision:number;
 domain:E2eeContext['domain'];objectId:string;payloadHash:string;parentId:string|null;metadata:ProductMetadata;proposalId:string|null};
export function productDomain(kind:ProductKind):E2eeContext['domain']{return kind==='comment'||kind==='project-comment'?'shared-comment':kind==='mindmap'?'mindmap':kind==='file'?'attachment':'shared-project';}
export function productMetadata(kind:ProductKind,input:unknown):ProductMetadata{
 const project=kind==='project'&&(input as {protocol?:unknown}|null)?.protocol===2;
 const fields=project?['protocol','spaceId','parentProjectId','projectCategoryId','boardStatusId','projectType','layout','isInbox','archived']:
  kind==='task'?['protocol','statusId','completed','approverIds','dependsOnIds','presentFields']:kind==='workflow'?['protocol','enabled','statuses','transitions']:['protocol'];exactKeys(input,fields);
 if(input.protocol!==(project?2:1))throw new Error('E2EE_PRODUCT_METADATA_INVALID');
 if(project){
  assertTechnical(input.spaceId);for(const key of ['parentProjectId','projectCategoryId','boardStatusId'])if(input[key]!==null)assertTechnical(input[key]);
  if(!['project','task-list'].includes(String(input.projectType))||!['list','board'].includes(String(input.layout))||typeof input.isInbox!=='boolean'||typeof input.archived!=='boolean'
   ||input.boardStatusId!==null&&input.parentProjectId===null||input.projectType==='task-list'&&(input.parentProjectId===null||input.projectCategoryId!==null)
   ||input.isInbox&&(input.parentProjectId!==null||input.projectType!=='project'||input.projectCategoryId!==null))throw new Error('E2EE_PRODUCT_METADATA_INVALID');
 }
 const ids=(value:unknown,max=200):string[]=>{if(!Array.isArray(value)||value.length>max||new Set(value).size!==value.length)throw new Error('E2EE_PRODUCT_METADATA_INVALID');for(const id of value)assertTechnical(id);return value;};
 if(kind==='task'){if(input.statusId!==null)assertTechnical(input.statusId);if(typeof input.completed!=='boolean')throw new Error('E2EE_PRODUCT_METADATA_INVALID');ids(input.approverIds);ids(input.dependsOnIds,1000);ids(input.presentFields,512);}
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
