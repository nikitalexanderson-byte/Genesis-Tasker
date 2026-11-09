import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePlanningDeviceDraft,planningCompletionChoices,planningDraftAfterRejectedCommand} from '../app/planning-device-drafts.ts';
const sprint=()=>({title:'Новый · 計画',goal:'',startDate:'2026-10-19',endDate:'2026-11-01',calendarMode:'lunar',calendarContext:{version:2,timeZone:'Europe/Berlin',gregorianYearStart:'march'}});
const completion=()=>({sprintId:'sprint-a',expectedRevision:2,fingerprint:'a'.repeat(64),tasks:[{id:'task-a',revision:0},{id:'task-b',revision:9}],choices:{'task-a':'backlog','task-b':'sprint-b'}});
const doc=()=>({version:1,projectId:'project-a',observedAt:'2026-10-19T04:00:00.000Z',form:{sprintId:null,expectedRevision:0,draft:sprint()},completion:null,pending:null});

test('definitively rejected direct commands leave no empty recovery editor',()=>{
 for(const pending of [{kind:'settings',expectedRevision:0,requestId:'once-settings',config:{enabled:true,estimateUnit:'hours'}},{kind:'transition',sprintId:'sprint-a',expectedRevision:2,requestId:'once-start',fingerprint:'a'.repeat(64),action:'start'}]){
  const source={...doc(),form:null,pending},original=structuredClone(source);assert.equal(planningDraftAfterRejectedCommand(source),null);assert.deepEqual(source,original);
 }
});
test('rejected sprint save retains unfinished input and its original calendar context',()=>{
 const source=doc();source.form.draft.title='';source.form.draft.startDate='';source.form.draft.goal='Мой ввод · 計画';source.pending={kind:'sprint',expectedRevision:0,requestId:'once-create',sprintId:null,draft:sprint()};
 const remaining=planningDraftAfterRejectedCommand(source);assert.deepEqual(remaining,{...source,pending:null});remaining.form.draft.calendarContext.timeZone='UTC';assert.equal(source.form.draft.calendarContext.timeZone,'Europe/Berlin');assert.equal(source.pending.requestId,'once-create');
});
test('rejected completion preserves every explicit task decision without a replay command',()=>{
 const source={...doc(),form:null,completion:completion(),pending:{kind:'transition',sprintId:'sprint-a',expectedRevision:2,requestId:'once-finish',fingerprint:'a'.repeat(64),action:'complete',outcomes:[]}};
 const remaining=planningDraftAfterRejectedCommand(source);assert.deepEqual(remaining.completion,source.completion);assert.equal(remaining.pending,null);remaining.completion.choices['task-a']='sprint-b';assert.equal(source.completion.choices['task-a'],'backlog');assert.equal(source.pending.requestId,'once-finish');
});

test('unfinished sprint edits preserve ISO dates, calendar context and zero revision without rebasing',()=>{
 const source=doc();source.form.draft.title='';source.form.draft.startDate='';source.form.draft.endDate='2026-02-30';
 const copy=validatePlanningDeviceDraft(source,'project-a');assert.deepEqual(copy,source);copy.form.draft.calendarContext.timeZone='UTC';assert.equal(source.form.draft.calendarContext.timeZone,'Europe/Berlin');
 for(const mode of ['profane','sacred','lunar']){source.form.draft.calendarMode=mode;assert.equal(validatePlanningDeviceDraft(source,'project-a').form.draft.calendarMode,mode);}
});
test('pending create, settings, start and completion commands preserve their original identity and guards',()=>{
 const source=doc(),commands=[{kind:'settings',expectedRevision:0,requestId:'settings-once',config:{enabled:false,estimateUnit:'hours'}},{kind:'sprint',expectedRevision:0,requestId:'create-once',sprintId:null,draft:sprint()},
 {kind:'transition',sprintId:'sprint-a',expectedRevision:2,requestId:'start-once',fingerprint:'b'.repeat(64),action:'start'},
 {kind:'transition',sprintId:'sprint-a',expectedRevision:2,requestId:'complete-once',fingerprint:'b'.repeat(64),action:'complete',outcomes:[{taskId:'task-a',expectedRevision:0,destinationSprintId:null}]}];
 for(const command of commands){source.pending=command;assert.deepEqual(validatePlanningDeviceDraft(source,'project-a').pending,command);}
 source.form=null;source.completion=completion();assert.deepEqual(validatePlanningDeviceDraft(source,'project-a').completion,source.completion);assert.ok(!JSON.stringify(source).includes('permissions'));assert.ok(!JSON.stringify(source.completion).includes('title'));
});
test('recovery rejects unknown or sensitive fields intact and refuses mismatched scopes and duplicate task refs',()=>{
 const mutations=[value=>value.projectId='project-b',value=>value.version=2,value=>value.form.draft.calendarContext.version=3,value=>value.form.draft.calendarContext.token='secret',value=>value.form.expectedRevision=-1,value=>value.permissions={manageProjects:true},value=>{value.form=null;value.completion=completion();value.completion.tasks[0].title='PRIVATE';},value=>{value.form=null;value.completion=completion();value.completion.tasks.push(value.completion.tasks[0]);},value=>{value.form=null;value.completion=completion();value.completion.choices.foreign='backlog';},value=>{value.pending={kind:'transition',sprintId:'a',requestId:'once',expectedRevision:0,fingerprint:'a'.repeat(64),action:'complete',outcomes:[{taskId:'task-a',expectedRevision:0}]};}];
 for(const mutate of mutations){const source=doc();mutate(source);const before=structuredClone(source);assert.throws(()=>validatePlanningDeviceDraft(source,'project-a'),/PLANNING_DEVICE_DRAFT_INVALID/);assert.deepEqual(source,before);}
});
test('explicit completion refresh retains only choices for unchanged references and available destinations',()=>{
 const old=completion();old.tasks.push({id:'task-c',revision:1},{id:'removed',revision:2});old.choices['task-c']='closed';old.choices.removed='backlog';
 const fresh=[{id:'task-a',revision:0},{id:'task-b',revision:10},{id:'task-c',revision:1},{id:'new',revision:0}];assert.deepEqual(planningCompletionChoices(old,fresh,[{id:'sprint-b',state:'planning'},{id:'closed',state:'completed'}],'sprint-a'),{'task-a':'backlog'});assert.deepEqual(planningCompletionChoices(null,fresh,[],'sprint-a'),{});
});
test('completion records retain every page above 100 and have an explicit upper bound',()=>{
 const source=doc();source.form=null;source.completion=completion();source.completion.tasks=Array.from({length:131},(_,index)=>({id:'task-'+index,revision:index}));source.completion.choices=Object.fromEntries(source.completion.tasks.map(row=>[row.id,'backlog']));assert.equal(validatePlanningDeviceDraft(source,'project-a').completion.tasks.length,131);
 source.completion.tasks=Array.from({length:20001},(_,index)=>({id:'task-'+index,revision:0}));assert.throws(()=>validatePlanningDeviceDraft(source,'project-a'));
});
