import test from 'node:test';
import assert from 'node:assert/strict';
import {savedViewDeviceEdit,prepareSavedViewDeviceDraft,validateSavedViewDeviceDraft,legacySavedViewDeviceDraft,confirmSavedViewReceipt,settledSavedViewEdit,sendSavedViewDeviceDraft,savedViewPayload} from '../app/saved-view-device-drafts.ts';
const definition=()=>({version:1,title:'Своя неделя 🌿',filter:{spaceId:'space-a',priority:[0,3],approvalPending:false},sort:'priority',relative:'this-week',calendarMode:'lunar',calendarContext:{version:2,timeZone:'Europe/Moscow',gregorianYearStart:'march'}});
const edit=()=>({definition:definition(),spaceId:'space-a',visibility:'personal',dirty:true,tagsInput:'своё, '});
const command=(id=null)=>({action:'save',id,bodyJson:JSON.stringify({requestId:'original-request',spaceId:'space-a',visibility:'personal',definition:definition(),...(id?{expectedRevision:3}:{})})});
const pending=(id=null)=>prepareSavedViewDeviceDraft({...edit(),...(id?{id,revision:3}:{})},command(id));
const receipt=(id='view-a',revision=1)=>({id,revision,spaceId:'space-a',visibility:'personal',updatedAt:'2026-10-21T16:30:00Z',canEdit:true,invalid:false,definition:definition()});
const rejection=error=>error.definitive?'VIEW_CONFLICT':null;

test('own invalid zone remains editable; corrupt phases, IDs and schema stay invalid',()=>{
 const own=edit();own.definition.calendarContext.timeZone='Bad zone';const value=savedViewDeviceEdit(own);assert.equal(value.edit.definition.calendarContext.timeZone,'Bad zone');assert.equal(value.edit.definition.calendarMode,'lunar');assert.equal(value.edit.definition.filter.approvalPending,false);
 for(const change of [v=>v.version=2,v=>v.edit.revision=0,v=>v.edit.id='view-a',v=>v.edit.visibility='public',v=>v.attempts=-1,v=>v.command={},v=>v.unrecognized=true]){const invalid=savedViewDeviceEdit(edit());change(invalid);assert.throws(()=>validateSavedViewDeviceDraft(invalid),/INVALID/);}
});

test('create receipt compares every definition, scope and revision before settling',()=>{
 const value=command();assert.deepEqual(confirmSavedViewReceipt(value,receipt()),receipt());
 for(const change of [v=>v.spaceId=null,v=>v.visibility='shared',v=>v.revision=2,v=>v.invalid=true,v=>v.canEdit=false,v=>v.definition.title='other',v=>v.definition.filter.priority=[3],v=>v.definition.filter.approvalPending=true,v=>v.definition.calendarMode='sacred',v=>v.definition.calendarContext.gregorianYearStart='january',v=>delete v.updatedAt]){const next=receipt();change(next);assert.throws(()=>confirmSavedViewReceipt(value,next),/RECEIPT_INVALID/);}
 const update=command('view-a');assert.doesNotThrow(()=>confirmSavedViewReceipt(update,receipt('view-a',4)));assert.throws(()=>confirmSavedViewReceipt(update,receipt('other',4)),/RECEIPT_INVALID/);
});

test('a PHP empty associative filter has the same meaning without erasing nonempty filters',()=>{
 const value=command(),body=JSON.parse(value.bodyJson);body.spaceId=null;body.definition.filter={};value.bodyJson=JSON.stringify(body);const reply=receipt();reply.spaceId=null;reply.definition.filter=[];assert.doesNotThrow(()=>confirmSavedViewReceipt(value,reply));reply.definition.filter=['wrong'];assert.throws(()=>confirmSavedViewReceipt(value,reply),/RECEIPT_INVALID/);
});

test('lost create reply, reload and later refusal keep identical wire bytes and one create',async()=>{
 let disk=pending(),applied=0;const calls=[],accepted=new Map();const persist=async value=>{disk=structuredClone(value);};
 const send=async cmd=>{calls.push(cmd.bodyJson);const body=JSON.parse(cmd.bodyJson);if(!accepted.has(body.requestId)){accepted.set(body.requestId,receipt());applied++;throw Error('lost reply');}return accepted.get(body.requestId);};
 await assert.rejects(sendSavedViewDeviceDraft(disk,{persist,send,definitiveRejection:rejection}),/lost/);const original=disk.command.bodyJson;
 disk=validateSavedViewDeviceDraft(JSON.parse(JSON.stringify(disk)));await assert.rejects(sendSavedViewDeviceDraft(disk,{persist,send:async()=>{throw Object.assign(Error('denied'),{definitive:true});},definitiveRejection:rejection}),/denied/);assert.equal(disk.phase,'pending');assert.equal(disk.command.bodyJson,original);
 const received=await sendSavedViewDeviceDraft(disk,{persist,send,definitiveRejection:rejection});assert.equal(received.phase,'received');assert.equal(applied,1);assert.deepEqual(calls,[original,original]);assert.equal(settledSavedViewEdit(received).id,'view-a');assert.equal(settledSavedViewEdit(received).dirty,false);
});

test('delete replay uses its original ID/revision and requires a real success body',async()=>{
 const cmd={action:'delete',id:'view-a',bodyJson:JSON.stringify({requestId:'delete-stable',expectedRevision:3})};let disk=prepareSavedViewDeviceDraft({...edit(),id:'view-a',revision:3},cmd),removed=0;const seen=new Set();const access={persist:async value=>{disk=structuredClone(value);},send:async command=>{if(!seen.has(command.bodyJson)){seen.add(command.bodyJson);removed++;throw Error('lost delete');}return {ok:true};},definitiveRejection:rejection};
 await assert.rejects(sendSavedViewDeviceDraft(disk,access),/lost/);const received=await sendSavedViewDeviceDraft(disk,access);assert.equal(removed,1);const own=settledSavedViewEdit(received);assert.equal(own.id,undefined);assert.equal(own.dirty,true);assert.deepEqual(own.definition.filter,definition().filter);assert.throws(()=>confirmSavedViewReceipt(cmd,{}),/RECEIPT_INVALID/);
});

test('storage must accept an attempt before HTTP, and an invalid receipt keeps the command',async()=>{
 let sends=0;await assert.rejects(sendSavedViewDeviceDraft(pending(),{persist:async()=>{throw Error('quota');},send:async()=>{sends++;},definitiveRejection:rejection}),/quota/);assert.equal(sends,0);
 let disk=pending();await assert.rejects(sendSavedViewDeviceDraft(disk,{persist:async value=>{disk=structuredClone(value);},send:async()=>receipt('view-a',9),definitiveRejection:rejection}),/RECEIPT_INVALID/);assert.equal(disk.phase,'pending');assert.equal(disk.attempts,1);
 await assert.rejects(sendSavedViewDeviceDraft(disk,{persist:async value=>{if(value.phase==='received')throw Error('disk after response');disk=structuredClone(value);},send:async()=>receipt(),definitiveRejection:rejection}),/disk after response/);assert.equal(disk.phase,'pending');
});

test('first definitive rejection settles without rebasing or replacing input',async()=>{
 let disk=pending();await assert.rejects(sendSavedViewDeviceDraft(disk,{persist:async value=>{disk=structuredClone(value);},send:async()=>{throw Object.assign(Error('conflict'),{definitive:true});},definitiveRejection:rejection}),/conflict/);assert.equal(disk.phase,'rejected');assert.equal(disk.command.bodyJson,command().bodyJson);assert.equal(disk.edit.tagsInput,'своё, ');
});

test('legacy unknown save retains its request ID and input edited after that send',()=>{
 const own=edit();own.definition.title='Следующий собственный ввод';const oldRequest=JSON.stringify({body:JSON.stringify({spaceId:'space-a',visibility:'personal',definition:definition()}),id:'old-request'});
 const imported=legacySavedViewDeviceDraft(JSON.stringify(own),oldRequest);assert.equal(imported.phase,'pending');assert.equal(imported.attempts,1);assert.equal(JSON.parse(imported.command.bodyJson).requestId,'old-request');assert.equal(imported.edit.definition.title,definition().title);assert.equal(imported.after.definition.title,own.definition.title);
 const next=settledSavedViewEdit({...imported,phase:'received',receipt:receipt()});assert.equal(next.definition.title,own.definition.title);assert.equal(next.id,'view-a');assert.equal(next.revision,1);assert.equal(next.dirty,true);
});

test('legacy equal input adopts the received view instead of creating a second view',()=>{
 const own=edit(),imported=legacySavedViewDeviceDraft(JSON.stringify(own),JSON.stringify({body:JSON.stringify({spaceId:'space-a',visibility:'personal',definition:definition()}),id:'old-request'}));
 const next=settledSavedViewEdit({...imported,phase:'received',receipt:receipt()});assert.equal(next.id,'view-a');assert.equal(next.dirty,false);assert.equal(next.tagsInput,own.tagsInput);
});

test('legacy delete reconstructs original wire order; malformed legacy bytes remain recoverable',()=>{
 const own={...edit(),id:'view-a',revision:3};const imported=legacySavedViewDeviceDraft(JSON.stringify(own),JSON.stringify({body:JSON.stringify({action:'delete',id:'view-a',revision:3}),id:'old-delete'}));assert.equal(imported.command.bodyJson,JSON.stringify({requestId:'old-delete',expectedRevision:3}));assert.equal(imported.command.id,'view-a');assert.equal(imported.attempts,1);
 for(const request of ['broken','{}',JSON.stringify({body:'broken',id:'valid'}),JSON.stringify({body:JSON.stringify({spaceId:'space-a',visibility:'personal',definition:null}),id:'id'})]){const record=legacySavedViewDeviceDraft(JSON.stringify(own),request);assert.equal(record.phase,'damaged');assert.equal(record.command,null);assert.equal(record.legacy.request,request);assert.equal(record.legacy.draft,JSON.stringify(own));}
 const broken=legacySavedViewDeviceDraft('original corrupt bytes',null);assert.equal(broken.phase,'damaged');assert.equal(broken.legacy.draft,'original corrupt bytes');
});

test('input calendar survives local recovery and receipt without rewriting relative semantics or entering the wire body',()=>{
 const own={...edit(),inputCalendar:{mode:'sacred',context:{version:2,timeZone:'America/New_York',gregorianYearStart:'january'}}};const stored=savedViewDeviceEdit(own),restored=validateSavedViewDeviceDraft(JSON.parse(JSON.stringify(stored)));
 assert.deepEqual(restored.edit.inputCalendar,own.inputCalendar);assert.equal(restored.edit.definition.calendarMode,'lunar');assert.equal(restored.edit.definition.calendarContext.timeZone,'Europe/Moscow');assert.equal(restored.edit.definition.calendarContext.gregorianYearStart,'march');assert.ok(!Object.hasOwn(savedViewPayload(restored.edit),'inputCalendar'));
 const prepared=prepareSavedViewDeviceDraft(restored.edit,command());const next=settledSavedViewEdit({...prepared,phase:'received',attempts:1,receipt:receipt()});assert.deepEqual(next.inputCalendar,own.inputCalendar);assert.equal(next.definition.calendarMode,'lunar');
 const damaged=structuredClone(own);damaged.inputCalendar.context.timeZone='Bad zone';assert.throws(()=>savedViewDeviceEdit(damaged),/INVALID/);
});

test('a known legacy request still replays when the later editor bytes are damaged',()=>{
 const raw='CORRUPT LATER INPUT BYTES';const request=JSON.stringify({body:JSON.stringify({spaceId:'space-a',visibility:'personal',definition:definition()}),id:'old-known-request'});
 const imported=legacySavedViewDeviceDraft(raw,request);assert.equal(imported.phase,'pending');assert.equal(imported.attempts,1);assert.equal(JSON.parse(imported.command.bodyJson).requestId,'old-known-request');assert.equal(imported.after.damagedDefinition,raw);
 const settled=settledSavedViewEdit({...imported,phase:'received',receipt:receipt()});assert.equal(settled.definition,null);assert.equal(settled.damagedDefinition,raw);assert.equal(settled.id,'view-a');assert.equal(settled.dirty,true);assert.throws(()=>savedViewPayload(settled),/VIEW_INVALID/);
});
