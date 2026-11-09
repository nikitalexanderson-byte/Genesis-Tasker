import test from 'node:test';
import assert from 'node:assert/strict';
import {planningTaskEdit,planningTaskEditField,planningTaskEditDestination,planningTaskEditValues,planningTaskEstimateValue,rebasePlanningTaskEdit,validatePlanningTaskDeviceDraft} from '../app/planning-task-device-drafts.ts';
const task=(values={})=>({id:'task-a',revision:0,storyPoints:0,estimateHours:null,sprintId:null,title:'PRIVATE_TASK',description:'PRIVATE_VALUE',...values});
const doc=()=>({version:1,projectId:'project-a',edits:[planningTaskEdit(task())],pending:null});

test('new estimate edit keeps zero and missing distinct without caching names or task fields',()=>{
 const source=task(),edit=planningTaskEdit(source);assert.deepEqual(edit.draft,{storyPoints:'0',estimateHours:''});assert.deepEqual(planningTaskEditValues(edit),{});assert.ok(!JSON.stringify(edit).includes('PRIVATE_'));assert.equal(edit.expectedRevision,0);edit.draft.storyPoints='9';assert.equal(source.storyPoints,0);
});
test('only intended changes are sent and null is an explicit clear',()=>{
 let edit=planningTaskEdit(task({estimateHours:2.5}));edit=planningTaskEditField(edit,'storyPoints','');assert.deepEqual(planningTaskEditValues(edit),{storyPoints:null});edit=planningTaskEditField(edit,'storyPoints','0.00');assert.deepEqual(planningTaskEditValues(edit),{});edit=planningTaskEditField(edit,'estimateHours','0');assert.deepEqual(planningTaskEditValues(edit),{estimateHours:0});edit=planningTaskEditDestination(edit,'next');assert.deepEqual(planningTaskEditValues(edit),{estimateHours:0,sprintId:'next'});
});
test('explicit rebase keeps touched fields while adopting a changed untouched sibling',()=>{
 const edit=planningTaskEditField(planningTaskEdit(task({storyPoints:3,estimateHours:2,sprintId:'old'})),'storyPoints','5');const next=rebasePlanningTaskEdit(edit,task({revision:7,storyPoints:4,estimateHours:8,sprintId:'new'}));assert.deepEqual(next.draft,{storyPoints:'5',estimateHours:'8'});assert.equal(next.destination,'new');assert.deepEqual(planningTaskEditValues(next),{storyPoints:5});assert.equal(next.expectedRevision,7);assert.deepEqual(edit.draft,{storyPoints:'5',estimateHours:'2'});
 const moved=rebasePlanningTaskEdit(planningTaskEditDestination(edit,'chosen'),task({revision:9,sprintId:'remote'}));assert.equal(moved.destination,'chosen');assert.equal(planningTaskEditValues(moved).sprintId,'chosen');assert.throws(()=>rebasePlanningTaskEdit(edit,task({id:'foreign'})),/SCOPE/);
});
test('unfinished text is preserved but cannot become an accidental zero or malformed command',()=>{
 for(const raw of ['-','.','1e','  ','0x10','Infinity','-1','1.111','1000001']){const source=doc();source.edits[0]=planningTaskEditField(source.edits[0],'storyPoints',raw);const copy=validatePlanningTaskDeviceDraft(source,'project-a');assert.equal(copy.edits[0].draft.storyPoints,raw);assert.throws(()=>planningTaskEditValues(copy.edits[0]),/PLANNING_ESTIMATE_INVALID/);}
 assert.equal(planningTaskEstimateValue(''),null);assert.equal(planningTaskEstimateValue('0'),0);assert.equal(planningTaskEstimateValue('1.25'),1.25);assert.equal(planningTaskEstimateValue('1e2'),100);
});
test('pending identity and omitted fields survive recovery without rebasing',()=>{
 const source=doc();source.edits[0]=planningTaskEditField(source.edits[0],'estimateHours','0');source.pending={taskId:'task-a',expectedRevision:0,requestId:'request-stable',values:{estimateHours:0,sprintId:null}};const copy=validatePlanningTaskDeviceDraft(source,'project-a');assert.deepEqual(copy,source);assert.ok(!Object.hasOwn(copy.pending.values,'storyPoints'));copy.pending.values.estimateHours=null;assert.equal(source.pending.values.estimateHours,0);
});
test('multiple pages of edits remain separate and the explicit record bound preserves input',()=>{
 const source=doc();source.edits=Array.from({length:131},(_,index)=>planningTaskEdit(task({id:'task-'+index})));assert.equal(validatePlanningTaskDeviceDraft(source,'project-a').edits.length,131);source.edits=Array.from({length:1000},(_,index)=>planningTaskEdit(task({id:'task-'+index})));assert.equal(validatePlanningTaskDeviceDraft(source,'project-a').edits.length,1000);source.edits.push(planningTaskEdit(task({id:'extra'})));assert.throws(()=>validatePlanningTaskDeviceDraft(source,'project-a'));assert.equal(source.edits.length,1001);
});
test('foreign scopes, duplicate rows, unknown values and sensitive metadata are rejected intact',()=>{
 const mutations=[value=>value.projectId='other',value=>value.edits.push(value.edits[0]),value=>value.edits[0].title='PRIVATE',value=>value.permissions={editTasks:true},value=>value.edits[0].touched.storyPoints=null,value=>value.edits[0].base.estimateHours=NaN,value=>value.edits[0].draft.estimateHours='x'.repeat(81),value=>value.pending={taskId:'foreign',requestId:'once',expectedRevision:0,values:{storyPoints:0}},value=>value.pending={taskId:'task-a',requestId:'once',expectedRevision:0,values:{}},value=>value.pending={taskId:'task-a',requestId:'once',expectedRevision:0,values:{storyPoints:'0'}}];for(const mutate of mutations){const source=doc();mutate(source);const before=structuredClone(source);assert.throws(()=>validatePlanningTaskDeviceDraft(source,'project-a'),/PLANNING_TASK_DEVICE_DRAFT_INVALID/);assert.deepEqual(source,before);}
});
