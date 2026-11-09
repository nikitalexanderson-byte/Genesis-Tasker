/** Private editor recovery. A command and its durable attempt always precede HTTP. */
export type EditorPurpose='templates'|'template-apply'|'automations'|'project-access'|'data-import';
export type EditorOperation={kind:'template.save'|'template.apply'|'automation.save'|'automation.retry'|'project-access.save'|'data.apply';id?:string;runId?:string;body:Record<string,unknown>;expected?:Record<string,unknown>};
export type EditorDeviceDraft<T>={version:1;spaceId:string;projectId:string;purpose:EditorPurpose;editor:T;phase:'editing'|'pending'|'rejected'|'received';operation:EditorOperation|null;attempts:number;receipt:unknown;error:string|null};
const object=(value:unknown):value is Record<string,unknown>=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
const id=(value:unknown)=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,200}$/.test(value);
const revision=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;
const keys=(value:Record<string,unknown>,allowed:string[])=>Object.keys(value).every(key=>allowed.includes(key));
function valid(value:unknown):asserts value {if(!value)throw Error('SHARED_EDITOR_DRAFT_INVALID');}
function json(value:unknown,depth=0):boolean {
 if(depth>60)return false;
 if(value===null||typeof value==='string'||typeof value==='boolean')return true;
 if(typeof value==='number')return Number.isFinite(value);
 if(Array.isArray(value))return value.every(item=>json(item,depth+1));
 return object(value)&&Object.getPrototypeOf(value)===Object.prototype&&Object.entries(value).every(([key,item])=>!['__proto__','prototype','constructor'].includes(key)&&json(item,depth+1));
}
function operation(raw:unknown,purpose:EditorPurpose):asserts raw is EditorOperation {
 valid(object(raw)&&keys(raw,['kind','id','runId','body','expected'])&&object(raw.body)&&json(raw));
 valid(raw.id===undefined||id(raw.id)||raw.kind==='template.apply'&&typeof raw.id==='string'&&/^system:[a-zA-Z0-9_-]+$/.test(raw.id));valid(raw.runId===undefined||id(raw.runId));
 const body=raw.body;
 valid(typeof body.operationId==='string'&&/^[a-zA-Z0-9:_-]{1,100}$/.test(body.operationId));
 valid(purpose==='templates'?raw.kind==='template.save':purpose==='template-apply'?raw.kind==='template.apply':purpose==='project-access'?raw.kind==='project-access.save':purpose==='data-import'?raw.kind==='data.apply':['automation.save','automation.retry'].includes(String(raw.kind)));
 if(raw.kind==='template.save')valid(id(body.projectId)&&typeof body.title==='string'&&revision(body.expectedRevision??0)&&keys(body,['operationId','projectId','title','expectedRevision','manifest','deleted','cloneTemplateId','sourceProjectId','sourceTaskId','capture']));
 if(raw.kind==='template.apply')valid(typeof raw.id==='string'&&(id(raw.id)||/^system:[a-zA-Z0-9_-]+$/.test(raw.id))&&typeof body.fingerprint==='string'&&/^[a-f0-9]{64}$/.test(body.fingerprint)&&object(raw.expected));
 if(raw.kind==='automation.save')valid(revision(body.expectedRevision??0)&&keys(body,['operationId','expectedRevision','title','ownerId','enabled','deleted','definition']));
 if(raw.kind==='automation.retry')valid(id(raw.id)&&id(raw.runId)&&revision(body.expectedRevision)&&keys(body,['operationId','expectedRevision'])&&object(raw.expected)&&revision(raw.expected.retryCount));
 if(raw.kind==='project-access.save')valid(id(raw.id)&&typeof body.allProjects==='boolean'&&Array.isArray(body.grants)&&typeof body.expectedFingerprint==='string'&&/^[a-f0-9]{64}$/.test(body.expectedFingerprint)&&keys(body,['allProjects','grants','expectedFingerprint','operationId'])&&object(raw.expected)&&revision(raw.expected.revision));
 if(raw.kind==='data.apply')valid(id(body.spaceId)&&typeof body.fingerprint==='string'&&/^[a-f0-9]{64}$/.test(body.fingerprint)&&!Object.hasOwn(body,'content')&&object(raw.expected)&&revision(raw.expected.taskCount)&&revision(raw.expected.projectCount));
}
/** Compare submitted values while permitting server-added normalized defaults. */
function contains(expected:unknown,actual:unknown):boolean {
 if(expected===actual)return true;
 if(Array.isArray(expected))return Array.isArray(actual)&&expected.length===actual.length&&expected.every((value,index)=>contains(value,actual[index]));
 return object(expected)&&object(actual)&&Object.keys(expected).every(key=>Object.hasOwn(actual,key)&&contains(expected[key],actual[key]));
}
export function confirmEditorReceipt<T>(input:EditorDeviceDraft<T>,raw:unknown):unknown {
 const request=input.operation;valid(request&&object(raw)&&json(raw));const body=request.body;
 const expectedRevision=Number(body.expectedRevision??0)+1;
 if(request.kind==='template.save')valid(keys(raw,['id','revision','deleted'])&&id(raw.id)&&(!request.id||raw.id===request.id)&&raw.revision===expectedRevision&&raw.deleted===(body.deleted??false));
 if(request.kind==='automation.save'){
  valid(id(raw.id)&&(!request.id||raw.id===request.id)&&raw.projectId===input.projectId&&raw.revision===expectedRevision&&typeof raw.title==='string'&&typeof raw.enabled==='boolean'&&typeof raw.deleted==='boolean'&&object(raw.definition));
  if(body.title!==undefined)valid(raw.title===String(body.title).trim());
  if(body.ownerId!==undefined)valid(raw.ownerId===body.ownerId);
  if(body.deleted!==undefined)valid(raw.deleted===body.deleted);
  if(body.enabled!==undefined)valid(raw.enabled===(body.deleted===true?false:body.enabled));
  if(body.definition!==undefined)valid(contains(body.definition,raw.definition));
 }
 if(request.kind==='automation.retry')valid(keys(raw,['id','state','retryCount'])&&raw.id===request.runId&&raw.state==='pending'&&raw.retryCount===Number(request.expected?.retryCount)+1);
 if(request.kind==='project-access.save'){
  const grants=(value:unknown)=>Array.isArray(value)?[...value].sort((a,b)=>String(a.projectId).localeCompare(String(b.projectId))):null;
  valid(raw.operationId===body.operationId&&raw.revision===Number(request.expected?.revision)+1&&revision(raw.changed)&&raw.allProjects===body.allProjects&&contains(grants(body.grants),grants(raw.grants)));
 }
 if(request.kind==='data.apply'){
  valid(id(raw.importId)&&id(raw.rootProjectId)&&typeof raw.duplicate==='boolean'&&(raw.duplicate||raw.operationId===body.operationId)&&typeof raw.canUndo==='boolean'&&['active','undone','removed'].includes(String(raw.state))&&Array.isArray(raw.notices));
  valid(raw.taskCount===request.expected?.taskCount&&raw.projectCount===request.expected?.projectCount&&object(raw.taskIds)&&object(raw.projectIds)&&Object.values(raw.taskIds).every(id)&&Object.values(raw.projectIds).every(id)&&Object.keys(raw.taskIds).length===raw.taskCount&&new Set(Object.values(raw.taskIds)).size===raw.taskCount&&Object.values(raw.projectIds).includes(raw.rootProjectId));
 }
 if(request.kind==='template.apply'){
  const expected=request.expected!;
  valid(raw.operationId===body.operationId&&raw.templateId===request.id&&id(raw.rootProjectId)&&object(raw.taskIds)&&object(raw.projectIds)&&Array.isArray(raw.notices));
  valid(raw.taskCount===expected.taskCount&&raw.projectCount===expected.projectCount&&Object.values(raw.taskIds).every(id)&&Object.values(raw.projectIds).every(id));
  valid(Array.isArray(expected.taskKeys)&&Array.isArray(expected.projectKeys)&&expected.taskKeys.length===Object.keys(raw.taskIds).length&&expected.taskKeys.every(key=>typeof key==='string'&&Object.hasOwn(raw.taskIds as object,key))&&expected.projectKeys.length===Object.keys(raw.projectIds).length&&expected.projectKeys.every(key=>typeof key==='string'&&Object.hasOwn(raw.projectIds as object,key)));
  valid(new Set(Object.values(raw.taskIds)).size===raw.taskCount&&new Set(Object.values(raw.projectIds)).size===expected.projectKeys.length&&Object.values(raw.projectIds).includes(raw.rootProjectId));
  valid(raw.rootTaskId===null||id(raw.rootTaskId)&&Object.values(raw.taskIds).includes(raw.rootTaskId));
 }
 return structuredClone(raw);
}
export function validateEditorDeviceDraft<T>(raw:unknown,spaceId:string,projectId:string,purpose:EditorPurpose,validateEditor:(value:unknown)=>T):EditorDeviceDraft<T>{
 valid(object(raw)&&Object.keys(raw).length===10&&keys(raw,['version','spaceId','projectId','purpose','editor','phase','operation','attempts','receipt','error'])&&json(raw));
 valid(raw.version===1&&id(spaceId)&&raw.spaceId===spaceId&&id(projectId)&&raw.projectId===projectId&&raw.purpose===purpose&&revision(raw.attempts));
 valid(['editing','pending','rejected','received'].includes(String(raw.phase))&&(raw.error===null||typeof raw.error==='string'&&raw.error.length<=200));
 const editor=validateEditor(raw.editor);
 if(raw.phase==='editing')valid(raw.operation===null&&raw.attempts===0&&raw.receipt===null&&raw.error===null);
 else{
  operation(raw.operation,purpose);
  if(purpose==='project-access')valid(object(editor)&&recordAccessMatches(editor,raw.operation));
  if(purpose==='data-import')valid(object(editor)&&object(editor.command)&&contains(editor.command,Object.fromEntries(Object.entries(raw.operation.body).filter(([key])=>!['operationId','fingerprint'].includes(key)))));
  if(raw.phase==='received'){valid(Number(raw.attempts)>0&&raw.error===null);confirmEditorReceipt(raw as EditorDeviceDraft<T>,raw.receipt);}
  else valid(raw.receipt===null&&(raw.phase!=='rejected'||raw.attempts===1&&raw.error!==null));
 }
 return {...structuredClone(raw),editor} as EditorDeviceDraft<T>;
}
export function editorDeviceEdit<T>(spaceId:string,projectId:string,purpose:EditorPurpose,editor:T):EditorDeviceDraft<T>{
 return {version:1,spaceId,projectId,purpose,editor:structuredClone(editor),phase:'editing',operation:null,attempts:0,receipt:null,error:null};
}
function recordAccessMatches(editor:Record<string,unknown>,request:EditorOperation):boolean {
 if(request.id!==editor.targetUserId||!object(editor.draft)||request.body.allProjects!==editor.draft.allProjects)return false;
 return request.body.allProjects===true||contains(editor.draft.grants,request.body.grants);
}
/** An attempted command with an unknown result must retain its original identity. */
export function canDiscardEditorDraft(value:Pick<EditorDeviceDraft<unknown>,'phase'|'attempts'>):boolean {
 return value.phase!=='pending'||value.attempts===0;
}
export async function sendEditorDeviceDraft<T>(input:EditorDeviceDraft<T>,access:{persist:(value:EditorDeviceDraft<T>)=>Promise<unknown>;send:(request:EditorOperation)=>Promise<unknown>;definitiveRejection:(error:unknown)=>string|null}):Promise<EditorDeviceDraft<T>>{
 valid(input.phase==='pending'&&input.operation);const original=structuredClone(input),attempted={...original,attempts:original.attempts+1};
 await access.persist(attempted);
 let receipt:unknown;
 try{receipt=confirmEditorReceipt(attempted,await access.send(structuredClone(original.operation!)));}
 catch(error){const code=original.attempts===0?access.definitiveRejection(error):null;if(code)await access.persist({...attempted,phase:'rejected',error:code});throw error;}
 const received:EditorDeviceDraft<T>={...attempted,phase:'received',receipt};await access.persist(received);return received;
}
