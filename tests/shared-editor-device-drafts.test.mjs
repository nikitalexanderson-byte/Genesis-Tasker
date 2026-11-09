import test from 'node:test';
import assert from 'node:assert/strict';
import {editorDeviceEdit,validateEditorDeviceDraft,confirmEditorReceipt,sendEditorDeviceDraft,canDiscardEditorDraft} from '../app/shared-editor-device-drafts.ts';
import {validateProjectAccessEditor,validateDataImportEditor} from '../app/c-workflow-device-drafts.ts';
import {SharedWorkDraftJournal} from '../app/shared-work-draft-journal.ts';
const editor={title:'  Свой текст 🌿 <script>  ',numbers:{offset:'-',leadDays:''},zone:'Europe/'};
const edit=(purpose='templates')=>editorDeviceEdit('space-a','project-a',purpose,editor);
const pending=(kind='template.save')=>({...edit(kind.startsWith('automation')?'automations':kind==='template.apply'?'template-apply':'templates'),phase:'pending',operation:{kind,id:'object-a',body:{operationId:'operation-stable',projectId:'project-a',title:'Own',expectedRevision:4}}});
const validate=(v,purpose='templates')=>validateEditorDeviceDraft(v,'space-a','project-a',purpose,v=>{assert.equal(typeof v.title,'string');return structuredClone(v);});
const receipt={id:'object-a',revision:5,deleted:false};

test('editing preserves incomplete numbers and original user text; scope/schema/corrupt JSON cannot become a command',()=>{
 const value=validate(JSON.parse(JSON.stringify(edit())));assert.deepEqual(value.editor,editor);
 for(const change of [v=>v.spaceId='other',v=>v.projectId='other',v=>v.purpose='automations',v=>v.version=2,v=>v.attempts=-1,v=>v.phase='pending',v=>v.extra=true,v=>v.editor.numbers.offset=NaN]){const v=edit();change(v);assert.throws(()=>validate(v));}
 const v=pending();v.operation.body.unrecognized=true;assert.throws(()=>validate(v));
});
test('receipt rejects wrong IDs, revisions, omitted fields and wrong deletion state',()=>{
 assert.deepEqual(confirmEditorReceipt(pending(),receipt),receipt);
 for(const value of [{...receipt,id:'other'},{...receipt,revision:6},{id:'object-a',revision:5},{...receipt,deleted:true},{...receipt,extra:1}])assert.throws(()=>confirmEditorReceipt(pending(),value),/INVALID/);
});
test('storage failure prevents HTTP and preserves the original pending command',async()=>{
 const value=pending();let sends=0;await assert.rejects(sendEditorDeviceDraft(value,{persist:async()=>{throw Error('quota');},send:async()=>{sends++;return receipt;},definitiveRejection:()=>null}),/quota/);
 assert.equal(sends,0);assert.equal(value.attempts,0);assert.equal(value.phase,'pending');
});
test('lost response, reload and retry use identical command and create one accepted operation',async()=>{
 let disk=pending(),count=0;const commands=[],accepted=new Map();
 const persist=async value=>{disk=structuredClone(value);};
 const send=async request=>{commands.push(JSON.stringify(request));const op=request.body.operationId;if(!accepted.has(op)){count++;accepted.set(op,receipt);throw Error('response lost');}return accepted.get(op);};
 await assert.rejects(sendEditorDeviceDraft(disk,{persist,send,definitiveRejection:()=>null}),/response lost/);
 assert.equal(disk.phase,'pending');assert.equal(disk.attempts,1);
 const restored=validate(JSON.parse(JSON.stringify(disk)));await sendEditorDeviceDraft(restored,{persist,send,definitiveRejection:()=>null});
 assert.equal(disk.phase,'received');assert.equal(disk.attempts,2);assert.equal(count,1);assert.equal(commands[0],commands[1]);assert.deepEqual(disk.editor,editor);
});
test('definitive first rejection allows an explicit edit; a later rejection never declares an unknown attempt rejected',async()=>{
 let disk;const rejection=Object.assign(Error('TEMPLATE_CONFLICT'),{definitive:true}),access={persist:async v=>{disk=structuredClone(v);},send:async()=>{throw rejection;},definitiveRejection:e=>e.definitive?e.message:null};
 await assert.rejects(sendEditorDeviceDraft(pending(),access));assert.equal(disk.phase,'rejected');assert.equal(disk.attempts,1);
 const uncertain={...pending(),attempts:1};await assert.rejects(sendEditorDeviceDraft(uncertain,access));assert.equal(disk.phase,'pending');assert.equal(disk.attempts,2);assert.deepEqual(disk.operation,uncertain.operation);
});
test('malformed successful response retains pending recovery and cannot clear the journal',async()=>{
 let disk;await assert.rejects(sendEditorDeviceDraft(pending(),{persist:async v=>{disk=structuredClone(v);},send:async()=>({...receipt,revision:0}),definitiveRejection:()=>null}),/INVALID/);
 assert.equal(disk.phase,'pending');assert.equal(disk.receipt,null);
});
test('automation receipt checks full submitted settings while allowing server defaults',()=>{
 const value=pending('automation.save');value.operation.body={operationId:'stable',expectedRevision:4,title:'  Own  ',ownerId:'owner-a',enabled:true,definition:{actions:[{type:'priority',value:2}]}};
 const result={id:'object-a',projectId:'project-a',revision:5,title:'Own',ownerId:'owner-a',enabled:true,deleted:false,definition:{schemaVersion:1,actions:[{type:'priority',value:2}],conditions:[]}};
 assert.deepEqual(confirmEditorReceipt(value,result),result);
 for(const change of [v=>v.projectId='other',v=>v.ownerId='other',v=>v.enabled=false,v=>v.title='Other',v=>v.definition.actions[0].value=3,v=>v.definition.actions=[]]){const raw=structuredClone(result);change(raw);assert.throws(()=>confirmEditorReceipt(value,raw),/INVALID/);}
});
test('retry receipt is tied to one rule/run and cannot increment the accepted retry twice',()=>{
 const value=pending('automation.retry');value.operation.runId='run-a';value.operation.body={operationId:'retry-stable',expectedRevision:4};value.operation.expected={retryCount:1};
 const raw={id:'run-a',state:'pending',retryCount:2};assert.deepEqual(confirmEditorReceipt(value,raw),raw);assert.throws(()=>confirmEditorReceipt(value,{...raw,retryCount:3}));assert.throws(()=>confirmEditorReceipt(value,{...raw,id:'run-b'}));
});
test('template apply accepts an existing destination and rejects incomplete or duplicate ID mappings',()=>{
 const value=pending('template.apply');value.operation.body={operationId:'stable',fingerprint:'a'.repeat(64)};value.operation.expected={taskCount:2,projectCount:0,taskKeys:['a','b'],projectKeys:['p']};
 const raw={operationId:'stable',templateId:'object-a',rootProjectId:'existing',rootTaskId:'task-a',projectIds:{p:'existing'},taskIds:{a:'task-a',b:'task-b'},taskCount:2,projectCount:0,notices:[]};
 assert.deepEqual(confirmEditorReceipt(value,raw),raw);for(const change of [v=>delete v.taskIds.b,v=>v.taskIds.b='task-a',v=>v.rootProjectId='other',v=>v.operationId='new']){const r=structuredClone(raw);change(r);assert.throws(()=>confirmEditorReceipt(value,r));}
});
test('two encrypted tab journals retain independent drafts and CAS cleanup never erases another edit',async()=>{
 const values=new Map(),storage={get length(){return values.size;},key:i=>[...values.keys()][i]??null,getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 const access={check:()=>{},seal:async v=>({iv:'synthetic',ciphertext:Buffer.from(JSON.stringify(v)).toString('base64')}),open:async v=>JSON.parse(Buffer.from(v.ciphertext,'base64').toString())};
 const make=writerId=>new SharedWorkDraftJournal({storage,access,userId:'user-a',projectId:'project-a',purpose:'templates',writerId,validate});
 const a=make('tab-a'),b=make('tab-b');const first=await a.write(edit());await b.write({...edit(),editor:{...editor,title:'Other tab'}});assert.equal((await a.list()).length,2);
 await a.write({...edit(),editor:{...editor,title:'Later edit'}});await assert.rejects(a.remove(first),/DRAFT_CHANGED/);assert.equal((await b.list()).length,2);
});

test('recovery never discards an attempted command while its result is unknown',()=>{
 for(const purpose of ['templates','template-apply','automations','project-access','data-import']) {
  assert.equal(canDiscardEditorDraft({...edit(purpose),phase:'pending',attempts:1}),false);
  assert.equal(canDiscardEditorDraft({...edit(purpose),phase:'pending',attempts:4}),false);
  assert.equal(canDiscardEditorDraft({...edit(purpose),phase:'pending',attempts:0}),true);
  assert.equal(canDiscardEditorDraft({...edit(purpose),phase:'rejected',attempts:1}),true);
 }
});
const accessDraft=()=>{
 const editor={targetUserId:'contractor',draft:{allProjects:false,grants:[{projectId:'project-a',role:'viewer',includeDescendants:true}]}};
 return {...editorDeviceEdit('space-a','space-a','project-access',editor),phase:'pending',operation:{kind:'project-access.save',id:'contractor',body:{...editor.draft,expectedFingerprint:'a'.repeat(64),operationId:'access-stable'},expected:{revision:7}}};
};
test('access recovery binds the target member, requested grants and acknowledged revision',()=>{
 const value=accessDraft(),validate=v=>validateEditorDeviceDraft(v,'space-a','space-a','project-access',validateProjectAccessEditor);
 assert.deepEqual(validate(value),value);
 for(const change of [v=>v.operation.id='different-member',v=>v.operation.body.grants[0].role='member',v=>v.operation.expected.revision=-1]){const next=structuredClone(value);change(next);assert.throws(()=>validate(next));}
 const result={operationId:'access-stable',revision:8,changed:1,allProjects:false,grants:value.editor.draft.grants};assert.deepEqual(confirmEditorReceipt(value,result),result);
 for(const change of [v=>v.operationId='other',v=>v.revision=9,v=>v.grants=[],v=>v.allProjects=true]){const next=structuredClone(result);change(next);assert.throws(()=>confirmEditorReceipt(value,next));}
});
test('lost access reply survives serialization and repeats precisely one permission change',async()=>{
 let disk=accessDraft(),writes=0;const commands=[],receipt={operationId:'access-stable',revision:8,changed:1,allProjects:false,grants:disk.editor.draft.grants};
 const persist=async value=>{disk=structuredClone(value);},send=async command=>{commands.push(JSON.stringify(command));if(++writes===1)throw Error('reply lost after permission commit');return receipt;};
 await assert.rejects(sendEditorDeviceDraft(disk,{persist,send,definitiveRejection:()=>null}));
 const restored=validateEditorDeviceDraft(JSON.parse(JSON.stringify(disk)),'space-a','space-a','project-access',validateProjectAccessEditor);
 await sendEditorDeviceDraft(restored,{persist,send,definitiveRejection:()=>null});assert.equal(commands[0],commands[1]);assert.equal(disk.phase,'received');assert.equal(disk.receipt.revision,8);
});
const importDraft=()=>{
 const command={spaceId:'space-a',projectId:'project-a',parentProjectId:null,format:'csv',parse:{title:'Own import',calendarMode:'profane',calendarContext:{timeZone:'Europe/Moscow'}},memberMap:{},statusMap:{},labelMap:{},fieldMap:{},optionMap:{},fieldDefaults:{quantity:0,confirmed:false}};
 const editor={file:{id:'file-a',name:'Свои данные.csv',content:'title,quantity,confirmed\nOwn,0,false'},command,numbers:{'values:quantity':'-','values:optional':''}};
 return {...editorDeviceEdit('space-a','project-a','data-import',editor),phase:'pending',operation:{kind:'data.apply',body:{...command,operationId:'import-stable',fingerprint:'b'.repeat(64)},expected:{taskCount:1,projectCount:0}}};
};
test('import snapshot keeps original file, zero, false and destination; file bytes are stored only once',()=>{
 const value=importDraft(),validate=v=>validateEditorDeviceDraft(v,'space-a','project-a','data-import',e=>validateDataImportEditor(e,'space-a','project-a'));
 const next=validate(JSON.parse(JSON.stringify(value)));assert.deepEqual(next.editor.command.fieldDefaults,{quantity:0,confirmed:false});assert.equal(next.editor.file.content,value.editor.file.content);assert.deepEqual(next.editor.numbers,{'values:quantity':'-','values:optional':''});assert.equal(Object.hasOwn(next.operation.body,'content'),false);
 for(const change of [v=>v.editor.command.spaceId='another',v=>v.operation.body.projectId='another',v=>v.operation.body.content='different bytes']){const bad=structuredClone(value);change(bad);assert.throws(()=>validate(bad));}
});
test('import receipt rejects missing task mappings and mismatched results while accepting explicit server deduplication',()=>{
 const value=importDraft(),receipt={importId:'receipt-a',operationId:'import-stable',rootProjectId:'project-a',projectIds:{source:'project-a'},taskIds:{source:'task-a'},projectCount:0,taskCount:1,notices:[],state:'active',canUndo:true,duplicate:false};
 assert.deepEqual(confirmEditorReceipt(value,receipt),receipt);
 for(const change of [v=>v.taskIds={},v=>v.taskIds.extra='task-a',v=>v.rootProjectId='unmapped',v=>v.taskCount=2,v=>v.operationId='other']){const bad=structuredClone(receipt);change(bad);assert.throws(()=>confirmEditorReceipt(value,bad));}
 assert.equal(confirmEditorReceipt(value,{...receipt,operationId:'earlier-file-import',duplicate:true}).duplicate,true);
});
