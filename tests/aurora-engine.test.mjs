import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {calendarModule} from './helpers/calendar-modules.mjs';
const context=calendarModule('app/aurora/context.ts');
const policy=calendarModule('app/aurora/draw-policy.ts');
const model=calendarModule('app/aurora/model.ts');
const graph=calendarModule('app/aurora/graph.ts');
const forecast=calendarModule('app/aurora/forecast.ts');
const sessions=calendarModule('app/aurora/session.ts');
const {MYTH_TRANSITIONS}=calendarModule('app/aurora/catalog/myths.ts');
const {SCENARIOS}=calendarModule('app/aurora/catalog/scenarios.ts');
const NOW='2026-11-05T09:00:00.000Z',OWNER='synthetic-owner';
function primary(seed=123){return policy.snapshotFromSavedDraw({id:`source-${seed}`,seed,day:'2026-11-05',createdAt:NOW,cards:policy.expectedSourceDraw(seed)});}
function fill(fields){let p=context.createSituation('situation','Europe/Moscow');for(const [field,value]of Object.entries(fields))p=context.recordField(p,{id:`e-${field}`,field,value,exactUserText:`Synthetic user report: ${field}`,kind:'reported_event',confirmed:true,beforeInterpretation:true});return p;}
test('Aurora only verifies the exact existing shuffle/orientation without rewriting the source model',()=>{
 const source=readFileSync(new URL('../app/StoicheionView.tsx',import.meta.url),'utf8');
 const core=source.slice(source.indexOf('function seededRandom'),source.indexOf('function orientationLabel')).replaceAll(/export /g,'').replaceAll(/<T>/g,'').replaceAll('cards: readonly T[]','cards').replaceAll(/: number/g,'');
 const sandbox={};vm.createContext(sandbox);vm.runInContext(core,sandbox);
 const {SOURCE_CARD_IDS}=calendarModule('app/aurora/spread.ts');
 for(const seed of [0,1,123,0xffffffff,...Array.from({length:100},(_,i)=>i*17831471)]){
  const existing=sandbox.buildStoicheionSpreadReading([...SOURCE_CARD_IDS],seed,9).map(c=>({cardId:c.letter,reversed:c.reversed}));
  assert.equal(JSON.stringify(policy.expectedSourceDraw(seed)),JSON.stringify(existing));
 }
 const snapshot=primary();snapshot.cards[0].orientation=snapshot.cards[0].orientation==='upright'?'reversed':'upright';assert.throws(()=>policy.verifySourceDraw(snapshot),/DRAW_MISMATCH/);
});
test('Explicit false, unknown, skipped and not applicable remain different; a paraphrase does not change a typed answer',()=>{
 const p=context.createSituation('situation','Europe/Moscow');
 const a=context.applyAnswer(p,{id:'a1',questionId:'east-event-1',choiceId:'no',detail:'Это ожидание, а не наблюдавшееся событие.',confirmed:true,createdAt:NOW},true);
 assert.equal(a.profile.fields.event_observed.value,false);assert.equal(a.answer.consequence,'clarify');
 const b=context.applyAnswer(p,{id:'a2',questionId:'east-event-1',choiceId:'unknown',detail:'',confirmed:false,createdAt:NOW},true);
 assert.equal(b.profile.fields.event_observed.status,'unknown');
 for(const status of ['skipped','not_applicable'])assert.equal(context.applyAnswer(p,{id:status,questionId:'east-event-1',choiceId:status,detail:'',confirmed:false,createdAt:NOW},true).profile.fields.event_observed.status,status);
 assert.throws(()=>context.applyAnswer(p,{id:'a3',questionId:'east-event-1',choiceId:'yes',detail:'',confirmed:true,createdAt:NOW},true),/BASIS/);
 const changed=context.applyAnswer(a.profile,{id:'a4',questionId:'east-event-1',choiceId:'no',detail:'Я пока лишь жду этого.',confirmed:true,createdAt:NOW},true);
 assert.equal(changed.profile.fields.event_observed.value,false);assert.equal(changed.profile.answerEvidence.find(e=>e.id==='a1').excludedReason,'superseded_by_explicit_edit');
});
test('Adaptive next question reacts to discriminating fields, never repeats skipped fields, and affects real action routing',()=>{
 const p=fill({event_observed:true}),snap=primary();
 const q=context.selectQuestion(p,'east',snap,[],['clear_scope']);assert.equal(q.resolvesFields[0],'clear_scope');
 const answered=context.applyAnswer(p,{id:'skip',questionId:q.id,choiceId:'skipped',detail:'',confirmed:false,createdAt:NOW},true);
 assert.notEqual(context.selectQuestion(answered.profile,'east',snap,[answered.answer],['clear_scope']).resolvesFields[0],'clear_scope');
 const limited=fill({contact_safe:false,resource_available:false,small_step_possible:false});
 const consequences=context.branchingConsequences(limited,[]);assert.equal(consequences.independentOnly,true);assert.equal(consequences.unavailableResources,true);assert.equal(consequences.observationOnly,true);
});
test('A user-rejected hypothesis stays excluded; contradictory evidence cannot be accepted by symbolic support',()=>{
 const p=fill({event_observed:true});const h={id:'hyp',themeId:'pressure',supportingEvidenceIds:['e-event_observed'],contradictingEvidenceIds:[],alternatives:[],userConfirmation:'unknown',status:'candidate',criteria:[{support:1,contradiction:0,status:'known'}]};
 const rejected=context.acceptHypothesis(p,h,false);assert.equal(rejected.hypothesis.status,'rejected');assert.throws(()=>context.acceptHypothesis(rejected.profile,h,true),/NOT_SUPPORTED/);
 assert.throws(()=>context.acceptHypothesis(p,{...h,contradictingEvidenceIds:['e-event_observed']},true),/NOT_SUPPORTED/);
});
test('Confirmed myth conditions change only the secondary model; old cards and eligible anchors are unchanged',()=>{
 const primaryDraw=Array.from({length:50},(_,seed)=>primary(seed)).find(s=>s.cards[5].orientation==='upright'&&s.cards[5].temporalRole!=='kronos'),original=JSON.stringify(primaryDraw),empty=fill({}),edge=MYTH_TRANSITIONS[0];
 const fields=Object.fromEntries(edge.activationPredicates.map(p=>[p.field,true]));const p=fill(fields);
 const baseline=model.calculateModel(primaryDraw,empty,null),changed=model.calculateModel(primaryDraw,p,null);
 assert.equal(JSON.stringify(primaryDraw),original);assert.deepEqual(baseline.draw,changed.draw);assert.deepEqual(baseline.eligible,changed.eligible);
 assert.ok(changed.trace.find(t=>t.edgeId===edge.id).active);assert.ok(changed.trace.find(t=>t.edgeId===edge.id).sourceCardInstanceIds.length);
 assert.notDeepEqual(changed.semantic,baseline.semantic);
 const contradictory=structuredClone(p);contradictory.contradictions=[{field:edge.activationPredicates[0].field,evidenceIds:[],resolved:false}];assert.equal(graph.evaluateTransition(edge,contradictory).state,'unknown');
});
function forecastFixtureFields(){return {direct_evidence:false,info_access:true,repetition_known:false,phase_known:true,horizon_defined:true,horizon_basis:'Synthetic explicit agreement: response within seven days.',context_confirmed:true,outcome_not_known:true,event_description:'Внешний участник пока не ответил на вопрос.',current_constraint:'Доступен только письменный канал.'};}
async function issue(overrides={}){
 const p=fill(forecastFixtureFields()),primaryDraw=primary(),secondary=model.calculateModel(primaryDraw,p,null),snapshot=await sessions.freezeContext({context:p},'ctx',NOW);
 const input={id:'forecast-1',now:NOW,profile:p,primary:primaryDraw,model:secondary,contextSnapshotId:snapshot.id,temporalId:null,sectorId:'east',horizon:{mode:'absolute',start:NOW,end:'2026-11-12T09:00:00.000Z',timezone:'Europe/Moscow'},targetEvent:'Придёт ответ ответственного о применимом правиле.',successCriterion:'В ответе указан конкретный действующий пункт правила.',failureCriterion:'В течение окна содержательный ответ по вопросу отсутствует.',conditions:['Вопрос передан по согласованному доступному каналу.'],conditionDeadline:'2026-11-06T09:00:00.000Z',selectedScenarioId:'east-information-onset',actions:[],...overrides};
 return {record:await forecast.issueForecast(input),input,snapshot};
}
test('Scenario contradictions exclude a candidate regardless of symbolic fit; unknown ranking stays an interval',()=>{
 const p=fill({direct_evidence:true}),secondary=model.calculateModel(primary(),p,null);
 assert.ok(model);assert.ok(forecast.rankScenarios(p,secondary,'east').every(r=>r.scenario.mechanismId!=='information'));
 const unknown=forecast.rankScenarios(fill({}),secondary,'east');assert.ok(unknown.some(r=>r.score.upper>r.score.lower));assert.ok(forecast.distinguishingFields(unknown).length);
 const rejected=fill(forecastFixtureFields());rejected.rejectedThemes=['information'];assert.ok(forecast.rankScenarios(rejected,secondary,'east').every(r=>r.scenario.mechanismId!=='information'));
 for(const sector of new Set(SCENARIOS.map(s=>s.sectorId)))assert.equal(SCENARIOS.filter(s=>s.sectorId===sector).length,24);
});
test('Forecast issuance freezes payload/context before outcomes, keeps probability null and detects tampering',async()=>{
 const {record,input}=await issue();assert.equal(record.status,'issued');assert.equal(record.probability,null);await forecast.verifyForecast(record);
 assert.ok(Object.isFrozen(record.horizon));assert.throws(()=>{record.conditions.push('silently edited');});
 const modified=structuredClone(record);modified.targetEvent='Иной исход';await assert.rejects(forecast.verifyForecast(modified),/HASH_MISMATCH/);
 const historical=fill({...forecastFixtureFields(),outcome_not_known:false});await assert.rejects(issue({profile:historical}),/RETROSPECTIVE/);
 const unknown=fill({...forecastFixtureFields(),info_access:false});const abstained=await issue({profile:unknown});assert.equal(abstained.record.status,'abstained');
 const changed=await issue({...input,id:'forecast-2',parentForecastId:record.id,targetEvent:'Придёт явно сформулированный отказ по вопросу.'});assert.equal(changed.record.parentForecastId,record.id);assert.notEqual(changed.record.payloadHash,record.payloadHash);
});
const observation=(overrides={})=>({id:'observation',now:'2026-11-12T10:00:00.000Z',selected:true,conditionStatus:'met',conditionAt:'2026-11-05T10:00:00.000Z',anchorAt:null,observedOccurred:null,occurredAt:null,observationComplete:false,contradictoryObservation:false,evidenceIds:[],actualActionIds:[],evidenceSource:'user_report',experienceNote:'',...overrides});
test('Outcome semantics separate pending, unknown, unmet condition, nonselected and true/false events',async()=>{
 const {record}=await issue();
 assert.equal(forecast.evaluateForecast(record,observation()).status,'unobserved');
 assert.equal(forecast.evaluateForecast(record,observation({now:'2026-11-05T11:00:00Z',observedOccurred:false,evidenceIds:['obs'],observationComplete:true})).status,'pending');
 assert.equal(forecast.evaluateForecast(record,observation({conditionStatus:'unmet',conditionAt:null})).status,'condition_unmet');
 assert.equal(forecast.evaluateForecast(record,observation({conditionStatus:'unknown',conditionAt:null})).status,'unobserved');
 assert.equal(forecast.evaluateForecast(record,observation({selected:false,observedOccurred:false,evidenceIds:['obs']})).status,'not_selected');
 const positive=forecast.evaluateForecast(record,observation({observedOccurred:true,occurredAt:'2026-11-10T12:00:00Z',evidenceIds:['obs'],observationComplete:true}));assert.equal(positive.status,'confirmed');assert.equal(positive.observedOccurred,true);
 const absent=await issue({predictedOutcome:'does_not_occur'}),negative=forecast.evaluateForecast(absent.record,observation({observedOccurred:false,observationComplete:true,evidenceIds:['obs']}));assert.equal(negative.status,'confirmed');assert.equal(negative.observedOccurred,false);
 assert.equal(forecast.evaluateForecast(record,observation({observedOccurred:false,observationComplete:true,evidenceIds:['obs']})).status,'contradicted');
 assert.equal(forecast.evaluateForecast(record,observation({contradictoryObservation:true})).status,'indeterminate');
});
test('A plan or selected card cannot become a completed action and issued histories cannot be overwritten',async()=>{
 let s=sessions.newSession({id:'situation',ownerId:OWNER,now:NOW,primary:primary(),timezone:'Europe/Moscow'});
 s.actionOptionIds=['action-athena-integration-1'];s.selectedActionId=s.actionOptionIds[0];
 const execution={id:'execution',forecastId:null,actionId:s.selectedActionId,minutes:10,startCondition:'После обычного завтрака',plannedAt:NOW,ritualCompleted:false,actionCompleted:false,completedAt:null,actualDescription:'',withoutRitual:false,taskId:null};
 const planned=sessions.recordExecution(s,execution);assert.equal(planned.completedAt,null);assert.equal(planned.executions[0].actionCompleted,false);
 const retried=sessions.recordExecution(planned,{...execution,id:'retry-with-new-request-id'});assert.equal(retried.executions.length,1);assert.equal(retried.executions[0].id,'execution');
 assert.throws(()=>sessions.recordExecution(s,{...execution,completedAt:'2026-11-05T10:00:00Z'}),/COMPLETION_NOT_CONFIRMED/);
 assert.throws(()=>sessions.recordExecution(s,{...execution,actionCompleted:true,completedAt:'2026-11-05T10:00:00Z',actualDescription:'Сделал свой черновик.'}),/COMPLETION_NOT_CONFIRMED/);
 const {record,snapshot}=await issue();s.forecasts=[record];s.contextSnapshots=[snapshot];const edited=structuredClone(s);edited.forecasts=[];assert.throws(()=>sessions.assertImmutableSession(s,edited),/FORECAST_IMMUTABLE/);
});
test('Relative horizons require a basis and preserve the review time in the user timezone',async()=>{
 const horizon={mode:'relative',anchorEvent:'Получено согласованное уточнение',startOffsetMinutes:30,durationMinutes:120,anchorDeadline:'2026-11-12T09:00:00.000Z',timezone:'Asia/Tokyo'};
 const {record}=await issue({horizon});assert.equal(record.status,'issued');assert.equal(forecast.resolveHorizon(record,null),null);
 const resolved=forecast.resolveHorizon(record,'2026-11-06T15:00:00.000Z');assert.deepEqual(resolved,{start:'2026-11-06T15:30:00.000Z',end:'2026-11-06T17:30:00.000Z'});
 assert.deepEqual(forecast.reviewCalendarPoint(record,'2026-11-06T15:00:00.000Z'),{date:'2026-11-07',time:'02:30',timezone:'Asia/Tokyo'});
 assert.throws(()=>forecast.resolveHorizon(record,'2026-11-13T15:00:00.000Z'),/ANCHOR/);
 const p=fill(forecastFixtureFields());delete p.fields.horizon_basis;const missing=await issue({profile:p});assert.equal(missing.record.abstentionReason,'time_basis_missing');
});
test('Conditional outcomes require a recorded action; completed practice survives later selection changes',async()=>{
 const {ACTIONS}=calendarModule('app/aurora/catalog/actions.ts'),{selectOrganon}=calendarModule('app/aurora/organon.ts');
 const {record}=await issue(),action=ACTIONS.find(a=>a.id==='action-athena-integration-1'),variant=await forecast.conditionalForecast(record,action,'variant',NOW);
 assert.throws(()=>forecast.evaluateForecast(variant,observation({observedOccurred:true,occurredAt:'2026-11-10T12:00:00Z',evidenceIds:['obs']})),/ACTION_CONDITION/);
 assert.equal(forecast.evaluateForecast(variant,observation({observedOccurred:true,occurredAt:'2026-11-10T12:00:00Z',evidenceIds:['obs'],completedConditionActionIds:[action.id]})).status,'confirmed');
 let s=sessions.newSession({id:'situation',ownerId:OWNER,now:NOW,primary:primary(),timezone:'Europe/Moscow'});
 s.curatorId='athena';s.goalText='Проверить точное основание';s.organon=selectOrganon('athena',s.organonPreferences);s.sphragisLetter='Α';s.actionOptionIds=[action.id];s.selectedActionId=action.id;
 const done=sessions.recordExecution(s,{id:'done',forecastId:null,actionId:action.id,minutes:2,startCondition:'После завтрака',plannedAt:NOW,ritualCompleted:false,actionCompleted:true,completedAt:'2026-11-05T10:00:00Z',actualDescription:'Сохранил основание.',withoutRitual:true,taskId:null});
 const changed=structuredClone(done);changed.goalText='Новая цель';changed.organon=null;changed.sphragisLetter=null;changed.curatorId='zeus';
 assert.equal(changed.executions[0].practiceSnapshot.goalText,'Проверить точное основание');assert.equal(changed.executions[0].practiceSnapshot.organon.entry.canonicalForm,'ΑΚΜΗ');sessions.assertImmutableSession(done,changed);
});
test('Actions obey available resources before ranking and explicitly blocked small steps stay blocked',()=>{
 const input={curatorId:'hephaestus',state:'resource',minutes:10,profile:fill({}),goal:{goalTags:['craft'],barrierTags:null,sectorId:'south-west',confirmed:true}};
 const limited=model.chooseActions(input);assert.ok(limited.every(a=>!a.requiredResources.includes('materials')));assert.ok(limited.every(a=>!a.requiredResources.includes('tools')));
 assert.equal(model.chooseActions({...input,profile:fill({available_materials:true,available_tools:true})}).length,3);
 assert.deepEqual(model.chooseActions({...input,profile:fill({small_step_possible:false})}),[]);
 assert.deepEqual(model.chooseActions({...input,profile:fill({immediate_danger:true})}),[]);
});
