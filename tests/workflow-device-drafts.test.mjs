import test from 'node:test';
import assert from 'node:assert/strict';
import {validateWorkflowDeviceDraft,workflowDeviceSnapshot} from '../app/workflow-device-drafts.ts';
const config=()=>({enabled:true,revision:0,statuses:[{statusId:'todo',wipLimit:0,requiredFields:['storyPoints','custom:old-field']}],transitions:[{fromStatusId:null,toStatusId:'todo',roles:['owner']}]});
const source=()=>({config:config(),counts:{todo:0},context:{project:{id:'project-a',title:'Проект · 計画',role:'owner',permissions:{createProjects:true,editTasks:true,organizeTasks:true,comment:true,manageProjects:true,inviteMembers:true}},statuses:[{id:'todo',title:'К выполнению',isDone:0,position:0,revision:1}],customFieldDefinitions:[{id:'old-field',title:'Старое поле',archived:true,options:[{id:'hidden-option',title:'PRIVATE_VALUE'}]}],tasks:[{title:'PRIVATE_TASK'}]}});
const document=()=>({version:1,projectId:'project-a',observedAt:'2026-10-19T03:00:00.000Z',snapshot:workflowDeviceSnapshot(source()),draft:{config:config(),statusesKey:'[["todo",0]]'},pending:{enabled:true,expectedRevision:0,requestId:'request-stable',statuses:config().statuses,transitions:config().transitions},fromStatusId:''});
test('device projection excludes unrelated values and keeps zero and pending identity',()=>{
 const input=document(),parsed=validateWorkflowDeviceDraft(input,'project-a');assert.deepEqual(parsed,input);assert.equal(parsed.draft.config.statuses[0].wipLimit,0);assert.equal(parsed.pending.expectedRevision,0);assert.equal(parsed.pending.requestId,'request-stable');assert.ok(!JSON.stringify(parsed).includes('PRIVATE_'));assert.equal(parsed.snapshot.context.customFieldDefinitions[0].archived,true);
 parsed.draft.config.statuses[0].wipLimit=9;assert.equal(input.draft.config.statuses[0].wipLimit,0);
});
test('unfinished WIP number text survives recovery without replacing the last valid limit',()=>{
 for(const raw of ['','-','1000001','1.5']){const input=document();input.pending=null;input.numberInputs={todo:raw};const restored=validateWorkflowDeviceDraft(JSON.parse(JSON.stringify(input)),'project-a');assert.equal(restored.numberInputs.todo,raw);assert.equal(restored.draft.config.statuses[0].wipLimit,0);}
});
test('recovery preserves a stale or unfinished draft rather than silently rebasing it',()=>{
 const input=document();input.snapshot.config.revision=9;input.draft.config.transitions[0].roles=[];input.pending=null;input.snapshot.context.statuses=[];const parsed=validateWorkflowDeviceDraft(input,'project-a');assert.equal(parsed.draft.config.revision,0);assert.equal(parsed.snapshot.config.revision,9);assert.deepEqual(parsed.draft.config.transitions[0].roles,[]);assert.deepEqual(parsed.draft.config.statuses[0].requiredFields,['storyPoints','custom:old-field']);
 input.pending={enabled:false,expectedRevision:9,requestId:'disable-once'};assert.deepEqual(validateWorkflowDeviceDraft(input,'project-a').pending,input.pending);
});
test('wrong scope, damaged metadata and impossible pending commands are rejected intact',()=>{
 const mutations=[value=>value.version=2,value=>value.projectId='project-b',value=>delete value.snapshot.context.project.permissions.manageProjects,value=>value.draft.statusesKey='broken',value=>value.snapshot.counts.todo=Infinity,value=>value.draft.config.statuses[0].wipLimit='0',value=>value.pending.transitions[0].roles=[],value=>value.fromStatusId=null,value=>value.draft.silentNewField='unknown'];
 for(const mutate of mutations){const value=document();mutate(value);const original=structuredClone(value);assert.throws(()=>validateWorkflowDeviceDraft(value,'project-a'),/WORKFLOW_DEVICE_DRAFT_INVALID/);assert.deepEqual(value,original);}
});
test('catalog bounds are explicit and an empty PHP counts array remains readable',()=>{
 const input=document();input.snapshot.counts=[];assert.doesNotThrow(()=>validateWorkflowDeviceDraft(input,'project-a'));
 input.snapshot.context.statuses=Array.from({length:30},(_,index)=>({id:'status-'+index,title:'Status '+index,isDone:0,position:index,revision:1}));assert.doesNotThrow(()=>validateWorkflowDeviceDraft(input,'project-a'));input.snapshot.context.statuses.push({id:'too-many',title:'Extra',isDone:0,position:30,revision:1});assert.throws(()=>validateWorkflowDeviceDraft(input,'project-a'));
 input.snapshot.context.statuses.pop();input.snapshot.context.customFieldDefinitions=Array.from({length:200},(_,index)=>({id:'field-'+index,title:'Field '+index,archived:false}));assert.doesNotThrow(()=>validateWorkflowDeviceDraft(input,'project-a'));input.snapshot.context.customFieldDefinitions.push({id:'extra-field',title:'Extra',archived:false});assert.throws(()=>validateWorkflowDeviceDraft(input,'project-a'));
});
