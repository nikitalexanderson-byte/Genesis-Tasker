import test from 'node:test';
import assert from 'node:assert/strict';
import {customFieldDeviceEdit,validateCustomFieldDeviceDraft,prepareCustomFieldDeviceDraft,confirmCustomFieldReceipt,sendCustomFieldDeviceDraft,rebaseCustomFieldDeviceDraft} from '../app/custom-field-device-drafts.ts';
import {SharedWorkDraftJournal} from '../app/shared-work-draft-journal.ts';
const draft=()=>({id:'field-a',title:'  Своё название 🌿  ',type:'number',projectId:'project-a',options:[],position:0,required:false,showCard:true,showList:true,archived:false,expectedRevision:3});
const edit=()=>customFieldDeviceEdit('space-a','project-a',draft());
const preview=(input=edit())=>({field:{...Object.fromEntries(Object.entries(input.draft).filter(([key])=>key!=='expectedRevision')),title:input.draft.title.trim(),spaceId:'space-a'},fingerprint:'a'.repeat(64),replaceType:false,valueCount:0,previousRevision:input.draft.expectedRevision,preservesPreviousValues:true});
const pending=()=>prepareCustomFieldDeviceDraft(edit(),preview(),false,'operation-stable');
const receipt=(input=pending())=>({field:{...input.expected,revision:4,predecessorId:null},previousFieldId:null});
const rejected=Object.assign(new Error('CUSTOM_FIELD_CONFLICT'),{definitive:true});
const rejection=error=>error.definitive?error.message:null;

test('input is copied without trimming; corrupt scope, frozen body and unknown schema never become a new edit',()=>{
 const input=edit();assert.equal(input.draft.title,'  Своё название 🌿  ');const restored=validateCustomFieldDeviceDraft(input,'space-a','project-a');restored.draft.title='different';assert.notEqual(restored.draft.title,input.draft.title);
 for(const change of [v=>v.version=2,v=>v.projectId='other',v=>v.spaceId='other',v=>v.draft.required='false',v=>v.draft.unrecognized=true,v=>v.phase='pending']){const value=edit();change(value);assert.throws(()=>validateCustomFieldDeviceDraft(value,'space-a','project-a'),/INVALID/);}
 const frozen=pending();frozen.draft.title='different';assert.throws(()=>validateCustomFieldDeviceDraft(frozen,'space-a','project-a'),/INVALID/);
});
test('unfinished integer input survives encrypted recovery and cannot prepare a stale numeric value',async()=>{
 for(const raw of ['', '-', '100001', '-100001', '1e2', '1.5']){
  const value=customFieldDeviceEdit('space-a','project-a',draft(),raw);
  const recovered=validateCustomFieldDeviceDraft(JSON.parse(JSON.stringify(value)),'space-a','project-a');
  assert.equal(recovered.positionInput,raw);assert.equal(recovered.draft.position,0);
  assert.throws(()=>prepareCustomFieldDeviceDraft(recovered,preview(),false,'not-sent'),/INVALID/);
 }
 const value=customFieldDeviceEdit('space-a','project-a',{...draft(),position:-12},'-0012');
 const prepared=prepareCustomFieldDeviceDraft(value,preview(value),false,'position-stable');
 assert.equal(JSON.parse(prepared.commandJson).position,-12);assert.equal(prepared.positionInput,'-0012');
 const latest={...preview().field,id:'field-a',spaceId:'space-a',revision:5,predecessorId:null};
 const partial=customFieldDeviceEdit('space-a','project-a',draft(),'-');
 assert.equal(rebaseCustomFieldDeviceDraft(partial,latest).positionInput,'-');
});

test('preview needs explicit successor consent and its original revision',()=>{
 const value=preview();value.replaceType=true;assert.throws(()=>prepareCustomFieldDeviceDraft(edit(),value,false,'op'),/INVALID/);
 assert.equal(prepareCustomFieldDeviceDraft(edit(),value,true,'op').phase,'pending');value.previousRevision=4;assert.throws(()=>prepareCustomFieldDeviceDraft(edit(),value,true,'op'),/INVALID/);
});

test('receipt verifies all normalized settings, options, scope, IDs, revision and successor',()=>{
 const input=pending();assert.deepEqual(confirmCustomFieldReceipt(input,receipt(input)),receipt(input));
 for(const change of [v=>v.field.title='wrong',v=>v.field.showList=false,v=>v.field.position=1,v=>v.field.spaceId='other',v=>v.field.projectId=null,v=>v.field.options=[{id:'unexpected',title:'X',archived:false}],v=>v.field.revision=5,v=>v.field.id='other',v=>v.previousFieldId='field-a',v=>delete v.field.required]){const value=receipt(input);change(value);assert.throws(()=>confirmCustomFieldReceipt(input,value),/RECEIPT_INVALID/);}
 const successor=prepareCustomFieldDeviceDraft(edit(),{...preview(),replaceType:true},true,'op');const next={field:{...successor.expected,id:'new-field',revision:1,predecessorId:'field-a'},previousFieldId:'field-a'};assert.deepEqual(confirmCustomFieldReceipt(successor,next),next);next.field.predecessorId=null;assert.throws(()=>confirmCustomFieldReceipt(successor,next),/RECEIPT_INVALID/);
});

test('lost result and reload retain the same request bytes; one accepted operation is replayed',async()=>{
 let disk=pending(),applied=0;const accepted=new Map(),commands=[];
 const persist=async value=>{disk=structuredClone(value);};
 const send=async command=>{const json=JSON.stringify(command);commands.push(json);if(!accepted.has(command.operationId)){applied++;accepted.set(command.operationId,receipt(disk));throw Error('lost reply');}return accepted.get(command.operationId);};
 await assert.rejects(sendCustomFieldDeviceDraft(disk,{persist,send,definitiveRejection:rejection}),/lost reply/);assert.equal(disk.attempts,1);const body=disk.commandJson;
 disk=validateCustomFieldDeviceDraft(JSON.parse(JSON.stringify(disk)),'space-a','project-a');const result=await sendCustomFieldDeviceDraft(disk,{persist,send,definitiveRejection:rejection});assert.equal(result.phase,'received');assert.equal(applied,1);assert.equal(result.attempts,2);assert.equal(result.commandJson,body);assert.deepEqual(commands,[body,body]);
});

test('an initial documented rejection can settle; a later denial cannot settle an unknown send',async()=>{
 let disk=pending();const persist=async value=>{disk=structuredClone(value);};
 await assert.rejects(sendCustomFieldDeviceDraft(disk,{persist,send:async()=>{throw rejected;},definitiveRejection:rejection}),/CONFLICT/);assert.equal(disk.phase,'rejected');
 disk={...pending(),attempts:1};const original=disk.commandJson;await assert.rejects(sendCustomFieldDeviceDraft(disk,{persist,send:async()=>{throw rejected;},definitiveRejection:rejection}),/CONFLICT/);assert.equal(disk.phase,'pending');assert.equal(disk.attempts,2);assert.equal(disk.commandJson,original);
});

test('storage failure blocks sending; receipt or post-send storage failure preserves replay',async()=>{
 let sends=0;await assert.rejects(sendCustomFieldDeviceDraft(pending(),{persist:async()=>{throw Error('disk');},send:async()=>{sends++;},definitiveRejection:rejection}),/disk/);assert.equal(sends,0);
 let disk=pending();await assert.rejects(sendCustomFieldDeviceDraft(disk,{persist:async value=>{disk=structuredClone(value);},send:async()=>({field:{}}),definitiveRejection:rejection}),/RECEIPT_INVALID/);assert.equal(disk.phase,'pending');assert.equal(disk.attempts,1);
 disk=pending();await assert.rejects(sendCustomFieldDeviceDraft(disk,{persist:async value=>{if(value.phase==='received')throw Error('disk after reply');disk=structuredClone(value);},send:async()=>receipt(),definitiveRejection:rejection}),/disk after reply/);assert.equal(disk.phase,'pending');assert.equal(disk.attempts,1);
});

test('encrypted journal preserves exact command with separate account/project/purpose scope',async()=>{
 const data=new Map(),storage={get length(){return data.size;},key:index=>[...data.keys()][index]??null,getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};
 const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
 const access={check(){},async seal(value,scope){const iv=crypto.getRandomValues(new Uint8Array(12));return {iv:Buffer.from(iv).toString('base64'),ciphertext:Buffer.from(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(scope)},key,new TextEncoder().encode(JSON.stringify(value)))).toString('base64')};},async open(value,scope){return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:Buffer.from(value.iv,'base64'),additionalData:new TextEncoder().encode(scope)},key,Buffer.from(value.ciphertext,'base64'))));}};
 const options={storage,access,userId:'user-a',projectId:'project-a',purpose:'custom-fields',validate:value=>validateCustomFieldDeviceDraft(value,'space-a','project-a')};const first=new SharedWorkDraftJournal(options);await first.write({...pending(),attempts:1});first.dispose();assert.ok(![...data.values()].join('').includes('operation-stable'));
 const next=new SharedWorkDraftJournal(options);assert.equal((await next.list())[0].value.commandJson,pending().commandJson);assert.equal((await new SharedWorkDraftJournal({...options,purpose:'workflow'}).list()).length,0);assert.equal((await new SharedWorkDraftJournal({...options,userId:'other'}).list()).length,0);
});


test('explicit rebase preserves own settings and requires a fresh preview at the new revision',()=>{
 const input=edit(),latest={...receipt(pending()).field,revision:7,title:'Changed elsewhere'};
 const rebased=rebaseCustomFieldDeviceDraft(input,latest);
 assert.equal(rebased.phase,'editing');assert.equal(rebased.draft.expectedRevision,7);assert.equal(rebased.draft.title,input.draft.title);
 assert.equal(rebased.commandJson,null);assert.equal(rebased.expected,null);assert.equal(input.draft.expectedRevision,3);
 assert.throws(()=>prepareCustomFieldDeviceDraft(rebased,preview(input),false,'new-op'),/INVALID/);
 assert.equal(prepareCustomFieldDeviceDraft(rebased,preview(rebased),false,'new-op').phase,'pending');
});
test('unknown attempted commands cannot be rebased by a later rejection or a stale replacement',()=>{
 const input=pending(),latest={...receipt(input).field,revision:7};
 assert.throws(()=>rebaseCustomFieldDeviceDraft({...input,attempts:1},latest),/INVALID/);
 assert.throws(()=>rebaseCustomFieldDeviceDraft({...input,phase:'received',attempts:1,receipt:receipt(input)},latest),/INVALID/);
 assert.throws(()=>rebaseCustomFieldDeviceDraft({...input,phase:'rejected',attempts:2,error:'CUSTOM_FIELD_CONFLICT'},latest),/INVALID/);
 for(const bad of [{...latest,id:'another'},{...latest,spaceId:'another'},{...latest,revision:2}])assert.throws(()=>rebaseCustomFieldDeviceDraft(input,bad),/INVALID/);
 const rejected={...input,phase:'rejected',attempts:1,error:'CUSTOM_FIELD_CONFLICT'};
 assert.equal(rebaseCustomFieldDeviceDraft(rejected,latest).draft.expectedRevision,7);
});
test('legacy archived choices survive own input, preview and receipt while active choices remain bounded',()=>{
 const options=Array.from({length:201},(_,index)=>({id:`option-${index}`,title:`Choice ${index}`,archived:index===0}));
 const input=customFieldDeviceEdit('space-a','project-a',{...draft(),type:'select',options});
 const prepared=prepareCustomFieldDeviceDraft(input,preview(input),false,'legacy-operation');
 const accepted=confirmCustomFieldReceipt(prepared,receipt(prepared));assert.equal(accepted.field.options.length,201);assert.equal(accepted.field.options[0].archived,true);
 const tooMany=structuredClone(input);tooMany.draft.options[0].archived=false;assert.throws(()=>validateCustomFieldDeviceDraft(tooMany,'space-a','project-a'),/INVALID/);

});
