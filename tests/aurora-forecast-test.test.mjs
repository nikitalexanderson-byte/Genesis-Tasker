import test from 'node:test';import assert from 'node:assert/strict';
import {calendarModule} from './helpers/calendar-modules.mjs';
const diagnostic=calendarModule('app/aurora/forecast-test.ts'),context=calendarModule('app/aurora/context.ts');
const {SCENARIOS}=calendarModule('app/aurora/catalog/scenarios.ts');
const draws=calendarModule('app/aurora/draw-policy.ts'),model=calendarModule('app/aurora/model.ts'),forecast=calendarModule('app/aurora/forecast.ts');
const NOW='2026-11-06T10:00:00.000Z';
const primary=draws.snapshotFromSavedDraw({id:'test-source',seed:123,day:'2026-11-06',createdAt:NOW,cards:draws.expectedSourceDraw(123)});
function draft(scenario,patch={}){
 const value={...diagnostic.newForecastTest(),page:6,outcome:'response',outcomeUnknown:'true',mechanism:scenario.mechanismId,phase:scenario.phase,
  windowDays:7,basis:'observation',verification:'written',preference:'clarify',confirmed:true,...patch};
 for(const question of diagnostic.diagnosticQuestions(value,scenario.sectorId).flat())value.answers[question.resolvesFields[0]]='unknown';
 for(const predicate of scenario.required.slice(0,2))value.answers[predicate.field]=predicate.value?'true':'false';return value;
}
test('All 216 sector, mechanism and phase combinations produce a checkable forecast from choices alone',async()=>{
 for(const scenario of SCENARIOS){
  const value=draft(scenario),profile=context.createSituation('situation','Europe/Moscow');
  assert.deepEqual(diagnostic.forecastTestProblems(value,profile,scenario.sectorId),[],scenario.id);
  let id=0;const built=diagnostic.compileForecastTest(value,profile,scenario.sectorId,NOW,()=>`e-${id++}`);
  const p=context.recordField(built.context,{id:'time-basis',field:'horizon_basis',value:built.form.horizonBasis,exactUserText:built.form.horizonBasis,kind:'constraint',confirmed:true,beforeInterpretation:false});
  const calculated=model.calculateModel(primary,p,null);assert.equal(calculated.status,'complete');
  const issued=await forecast.issueForecast({id:scenario.id,now:NOW,profile:p,primary,model:calculated,contextSnapshotId:'snapshot',temporalId:null,
   sectorId:scenario.sectorId,horizon:{mode:'absolute',start:NOW,end:built.form.end,timezone:p.timezone},targetEvent:built.form.target,successCriterion:built.form.success,
   failureCriterion:built.form.failure,conditions:built.form.conditions.split('\n'),conditionDeadline:built.form.conditionDeadline,selectedScenarioId:scenario.id,actions:[],
   ...(scenario===SCENARIOS[0]?{wordingSource:'choice_test_v1'}:{})});
  assert.equal(issued.status,'issued',scenario.id+': '+issued.abstentionReason);await forecast.verifyForecast(issued);
  assert.equal(issued.probability,null);assert.equal(issued.scenarioId,scenario.id);
  if(scenario===SCENARIOS[0]){
   assert.equal(issued.wordingSource,'choice_test_v1');
   const changed=structuredClone(issued);delete changed.wordingSource;
   await assert.rejects(()=>forecast.verifyForecast(changed),/HASH_MISMATCH/);
   const {ACTIONS}=calendarModule('app/aurora/catalog/actions.ts');
   const conditional=await forecast.conditionalForecast(issued,ACTIONS[0],'conditional',NOW);
   assert.equal(conditional.wordingSource,'choice_test_v1');await forecast.verifyForecast(conditional);
  }else assert.equal(issued.wordingSource,undefined);
 }
});
test('Unknown, incompatible or unverifiable circumstances never become silent positive evidence',()=>{
 const scenario=SCENARIOS[0],value=draft(scenario),profile=context.createSituation('situation','UTC'),field=scenario.required[0].field;
 for(const state of ['unknown',scenario.required[0].value?'false':'true']){
  const changed={...value,answers:{...value.answers,[field]:state}};
  assert(diagnostic.forecastTestProblems(changed,profile,scenario.sectorId).some(row=>row.page===2&&row.field));
  assert.throws(()=>diagnostic.compileForecastTest(changed,profile,scenario.sectorId,NOW,()=>''),/INCOMPLETE/);
 }
 for(const patch of [{confirmed:false},{verification:'unavailable'},{outcomeUnknown:'false'},{outcomeUnknown:'unknown'}]){
  assert(diagnostic.forecastTestProblems({...value,...patch},profile,scenario.sectorId).length>0);
 }
});
test('All five outcomes and seven horizons support absolute and event-relative windows without hand-entered dates',()=>{
 for(const outcome of diagnostic.FORECAST_OUTCOMES)for(const days of diagnostic.FORECAST_WINDOWS)for(const clock of ['now','event']){
  const scenario=SCENARIOS[0],value=draft(scenario,{outcome:outcome.id,windowDays:days,clock,anchor:'agreement',anchorDeadlineDays:30});
  let id=0;const built=diagnostic.compileForecastTest(value,context.createSituation('situation','UTC'),scenario.sectorId,NOW,()=>`e-${id++}`);
  assert.equal(built.form.target,outcome.target);assert.notEqual(built.form.success,built.form.failure);
  assert.equal(built.form.durationMinutes,days*1440);
  forecast.validateHorizon(clock==='now'?{mode:'absolute',start:NOW,end:built.form.end,timezone:'UTC'}:
   {mode:'relative',anchorEvent:built.form.anchorEvent,startOffsetMinutes:0,durationMinutes:built.form.durationMinutes,anchorDeadline:built.form.end,timezone:'UTC'},NOW);
 }
});
test('Edited and imported test drafts are bounded; canonical records remain untouched until explicit compilation',()=>{
 const value=draft(SCENARIOS[0]),profile=context.createSituation('situation','UTC'),before=JSON.stringify(profile);
 diagnostic.compileForecastTest(value,profile,'northwest',NOW,()=>crypto.randomUUID());assert.equal(JSON.stringify(profile),before);
 for(const patch of [{page:7},{windowDays:1e9},{answers:{arbitrary:'true'}},{confirmed:'yes'},{mechanism:'invented'}])assert.throws(()=>diagnostic.validateForecastTest({...value,...patch}),/INVALID/);
});
