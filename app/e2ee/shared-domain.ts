import catalogue from '../../contracts/e2ee/private-path-sources-v1.json' with {type:'json'};
import contract from '../../contracts/e2ee/shared-record-bodies-v1.json' with {type:'json'};
import {assertTechnical,exactKeys} from './keys.ts';
import {parseLegacyMigrationJson} from './legacy-json.ts';
import {samePrivateJson} from './product-json.ts';
import {productMetadata,type ProductKind,type ProductMetadata} from './product-contract.ts';
import type {ProductVersion} from './shared-product.ts';
import {validateMindmap} from '../mindmaps-model.ts';
import {isCivilDate,calendarContext} from '../calendar-context.ts';
import {validateSharedAutomation,validateSharedTemplateManifest,validateSharedReviewPolicy,validateSharedSavedDefinition} from './shared-domain-values.ts';

type RecordValue=string|number|null;
export type SharedContentRecord=Record<string,RecordValue|{objectId:string;size:number;filename:string;mediaType:string}>;
export type SharedRecordBody={format:'genesis-shared-record-v1';kind:ProductKind;scopeId:string;scopeKind:'project'|'space';resourceId:string;table:string;record:SharedContentRecord;
 related:Record<string,SharedContentRecord[]>;execution:'live'|'history-only'};
export type SharedDomainBinding={scopeId:string;kind:'project'|'space';resourceId:string};
const decoder=new TextDecoder('utf-8',{fatal:true});
function invalid():never{throw new Error('E2EE_SHARED_DOMAIN_INVALID');}
function object(value:unknown):asserts value is Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))invalid();}
function json(value:unknown,maximum=16*1024*1024){if(typeof value!=='string')invalid();return parseLegacyMigrationJson(value,'E2EE_SHARED_DOMAIN_INVALID',maximum);}
export function sharedEntityId(kind:ProductKind,id:string|number){const value=`${kind}:${id}`;assertTechnical(value);return value;}
export function sharedRecordKey(kind:ProductKind,row:SharedContentRecord){
 if(kind==='custom-field-value')return sharedEntityId(kind,`${row.task_id}:${row.field_id}`);
 if(kind==='file')return sharedEntityId(kind,row.id===undefined?`image:${row.task_id}`:`attachment:${row.id}`);
 if(kind==='trash')return sharedEntityId(kind,`${row.kind}:${row.object_id}`);
 const raw=row.id??row.project_id??row.task_id;if(typeof raw!=='string'&&typeof raw!=='number')invalid();return sharedEntityId(kind,raw);
}
function record(table:string,input:unknown,binding:SharedDomainBinding):SharedContentRecord{
 object(input);const spec=catalogue.tables.find(row=>row.table===table);if(!spec)invalid();
 const file=['shared_task_attachments','shared_task_images'].includes(table),fields=file?[...spec.columns.filter(name=>!['ciphertext','filename_ciphertext'].includes(name)),'file']:spec.columns;
 exactKeys(input,fields);
 for(const [name,value]of Object.entries(input)){
  if(name==='file'&&file){exactKeys(value,['objectId','size','filename','mediaType']);assertTechnical(value.objectId);if(!value.objectId.startsWith('private-file:')&&!value.objectId.startsWith('shared-file:')||!Number.isSafeInteger(value.size)||Number(value.size)<1||Number(value.size)>64*1024*1024||typeof value.filename!=='string'||value.filename.length>512||typeof value.mediaType!=='string'||value.mediaType.length>128)invalid();continue;}
  if(value!==null&&typeof value!=='string'&&typeof value!=='number')invalid();
  if(typeof value==='number'&&!Number.isFinite(value)||typeof value==='string'&&value.length>16*1024*1024)invalid();
  if(value!==null&&(name==='id'||name.endsWith('_id'))&&(typeof value!=='string'&&typeof value!=='number'))invalid();
  if(value!==null&&(name==='revision'||name==='position'||name==='byte_size')&&(!Number.isSafeInteger(value)||Number(value)<0))invalid();
  if(value!==null&&(name.endsWith('_at')||['start_date','end_date','due_date','day_key','period_key'].includes(name))){if(typeof value!=='string')invalid();if(name.endsWith('_at')){if(!Number.isFinite(Date.parse(value)))invalid();}else if(!isCivilDate(value))invalid();}
  if(value!==null&&['start_time','end_time'].includes(name)&&(typeof value!=='string'||!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)))invalid();
  if(typeof value==='string'&&(name.endsWith('_json')||['payload','content'].includes(name)))json(value);
 }
 if(input.project_id!==undefined&&binding.kind==='project'&&input.project_id!==binding.resourceId)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
 if(input.space_id!==undefined&&binding.kind==='space'&&input.space_id!==binding.resourceId)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
 if(binding.kind==='space'&&input.project_id!==undefined&&input.project_id!==null)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
 if(table==='shared_projects'&&(binding.kind!=='project'||input.id!==binding.resourceId)||table==='shared_spaces'&&(binding.kind!=='space'||input.id!==binding.resourceId))throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
 if(table==='shared_mindmaps'){
  const map=validateMindmap(json(input.content,2_000_000));if(map.id!==input.id||map.projectId!==(binding.kind==='project'?binding.resourceId:null))throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
 }
 if(table==='shared_tasks'){
  if(typeof input.title!=='string'||!input.title.trim()||input.title.length>2000||typeof input.description!=='string'||input.description.length>100000||!['task','meeting','birthday','event'].includes(String(input.entry_type))||!Number.isInteger(input.priority)||Number(input.priority)<0||Number(input.priority)>5)invalid();
  const tags=json(input.tags_json),checklists=json(input.checklists_json);if(!Array.isArray(tags)||tags.length>100||tags.some(value=>typeof value!=='string'||value.length>240)||!Array.isArray(checklists)||checklists.length>100)invalid();
  const ids=new Set<string>();for(const list of checklists){object(list);if(typeof list.id!=='string'||ids.has(list.id)||typeof list.title!=='string'||list.title.length>2000||!Array.isArray(list.items)||list.items.length>1000)invalid();ids.add(list.id);const items=new Set<string>();
   for(const item of list.items){object(item);if(typeof item.id!=='string'||items.has(item.id)||typeof item.title!=='string'||item.title.length>2000||typeof item.done!=='boolean')invalid();items.add(item.id);}}
 }
 if(['shared_comments','shared_project_comments'].includes(table)&&(typeof input.body!=='string'||!input.body.trim()||input.body.length>100000))invalid();
 if(table==='shared_project_statuses'&&(![0,1].includes(Number(input.is_done))||typeof input.title!=='string'||!input.title.trim()||input.title.length>2000))invalid();
 if(table==='shared_member_categories'){
  if(typeof input.title!=='string'||!input.title.trim()||input.title.length>2000)invalid();const permissions=json(input.permissions_json);object(permissions);
  if(Object.keys(permissions).length>64||Object.values(permissions).some(value=>typeof value!=='boolean'))invalid();
  // These bytes preserve historical content. Only the independent signed
  // membership transaction can change the live server ACL/category policy.
 }
 if(table==='shared_custom_fields'){
  if(!['text','number','date','select','multi','checkbox','url'].includes(String(input.type)))invalid();const definition=json(input.definition_json);object(definition);const options=definition.options;if(!Array.isArray(options)||options.length>10000)invalid();const ids=new Set<string>();
  for(const option of options){object(option);if(typeof option.id!=='string'||ids.has(option.id)||typeof option.title!=='string'||option.title.length>2000||typeof option.archived!=='boolean')invalid();ids.add(option.id);}
 }
 if(table==='shared_automation_rules'){if(![0,1].includes(Number(input.enabled))||typeof input.title!=='string'||!input.title.trim()||input.title.length>2000)invalid();validateSharedAutomation(json(input.definition_json));}
 if(table==='shared_templates'){const manifest=validateSharedTemplateManifest(json(input.manifest_json));if(manifest.kind!==input.kind||typeof input.title!=='string'||!input.title.trim()||manifest.projects.length!==input.project_count||manifest.tasks.length!==input.task_count)invalid();}
 if(table==='shared_project_review_policies')validateSharedReviewPolicy(json(input.policy_json));
 if(table==='shared_saved_views'){if(!['personal','shared'].includes(String(input.visibility)))invalid();validateSharedSavedDefinition(json(input.payload));}
 if(table==='shared_sprints'){if(!['planning','active','completed'].includes(String(input.state))||!['points','hours',null].includes(input.estimate_unit as string|null))invalid();const data=json(input.content_json);object(data);if(data.calendarContext!==undefined)calendarContext(data.calendarContext as Parameters<typeof calendarContext>[0]);if(String(input.start_date)>String(input.end_date))invalid();}
 return input as SharedContentRecord;
}
export function sharedBodyMetadata(body:SharedRecordBody):ProductMetadata{
 if(body.kind==='task'){
  const raw=body.record,presentFields:string[]=[];
  for(const [name,field]of Object.entries({title:'title',description:'description',assigneeId:'assignee_id',dueDate:'due_date',startDate:'start_date',startTime:'start_time',endTime:'end_time',categoryId:'category_id'}))if(raw[field]!==null&&raw[field]!=='')presentFields.push(name);
  for(const value of body.related.shared_custom_field_values??[])if(json(value.value_json)!==null)presentFields.push(String(value.field_id));
  return productMetadata('task',{protocol:1,statusId:raw.status_id===null?null:sharedEntityId('status',String(raw.status_id)),completed:raw.completed_at!==null,
   approverIds:[...new Set((body.related.shared_task_approvals??[]).map(row=>String(row.user_id)))].sort(),dependsOnIds:[...new Set((body.related.shared_task_dependencies??[]).map(row=>sharedEntityId('task',String(row.predecessor_id))))].sort(),presentFields:[...new Set(presentFields)].sort()});
 }
 if(body.kind==='workflow'){
  const raw=json(body.record.definition_json);object(raw);if(!Array.isArray(raw.statuses)||!Array.isArray(raw.transitions))invalid();
  return productMetadata('workflow',{protocol:1,enabled:body.record.enabled===1,statuses:raw.statuses.map(value=>{object(value);return{...value,statusId:sharedEntityId('status',String(value.statusId))};}),
   transitions:raw.transitions.map(value=>{object(value);return{...value,fromStatusId:value.fromStatusId===null?null:sharedEntityId('status',String(value.fromStatusId)),toStatusId:sharedEntityId('status',String(value.toStatusId))};})});
 }return{protocol:1};
}
export function sharedBodyParent(body:SharedRecordBody){
 if(body.kind==='project'||body.kind==='space')return null;
 if(body.kind==='task')return body.record.parent_task_id===null?sharedEntityId('project',body.resourceId):sharedEntityId('task',String(body.record.parent_task_id));
 if(body.record.task_id!==undefined)return sharedEntityId('task',String(body.record.task_id));
 return sharedEntityId(body.scopeKind,body.resourceId);
}
/** Every record uses the fixed source schema, exact resource lineage, typed
 * domain constraints and metadata/body equality. Old receipts are history only;
 * there is no generic JSON-to-command or imported authority interpretation. */
export function validateSharedRecordBody(binding:SharedDomainBinding,kind:ProductKind,input:unknown,header?:Omit<ProductVersion,'body'>):SharedRecordBody{
 exactKeys(input,['format','kind','scopeId','scopeKind','resourceId','table','record','related','execution']);
 if(input.format!=='genesis-shared-record-v1'||input.kind!==kind||input.scopeId!==binding.scopeId||input.scopeKind!==binding.kind||input.resourceId!==binding.resourceId||!['live','history-only'].includes(String(input.execution)))throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
 const roots=contract.roots[kind],related=contract.related[kind];if(contract.protocol!==1||!roots||!related||!roots.includes(input.table as never)||contract.historyOnlyKinds.includes(kind)&&input.execution!=='history-only')invalid();
 const source=catalogue.paths.filter(path=>path.scope===binding.kind).flatMap(path=>path.server);if(!source.includes(input.table as string))invalid();
 const row=record(input.table as string,input.record,binding);object(input.related);if(Object.keys(input.related).some(name=>!related.includes(name as never)))invalid();
 const children:Record<string,SharedContentRecord[]>={};for(const [table,values]of Object.entries(input.related)){if(!Array.isArray(values)||values.length>10000)invalid();children[table]=values.map(value=>{
  const child=record(table,value,binding),key=kind==='comment'?'comment_id':kind==='project'?'project_id':'task_id';if(child[key]!==row.id)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');return child;});}
 const body={...input,record:row,related:children} as SharedRecordBody;
 if(header&&(header.scopeId!==binding.scopeId||header.kind!==kind||header.entityId!==sharedRecordKey(kind,row)||header.parentId!==sharedBodyParent(body)||!samePrivateJson(header.metadata,sharedBodyMetadata(body))))throw new Error('E2EE_SHARED_HEADER_MISMATCH');
 return body;
}
export function parseSharedDomainBytes(bytes:Uint8Array){return parseLegacyMigrationJson(decoder.decode(bytes),'E2EE_SHARED_DOMAIN_INVALID',64*1024*1024);}
