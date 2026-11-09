import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarModule } from './helpers/calendar-modules.mjs';
const {estimateEmpiricalProbability,empiricalCohort,validEmpiricalEstimate,wilsonInterval}=calendarModule('app/aurora/empirical.ts');
const day=86400000,start=Date.parse('2026-01-01T00:00:00Z'),date=i=>new Date(start+i*day).toISOString();
const forecast=i=>({id:`f${i}`,situationId:`s${i}`,baseSpreadSnapshotId:`spread${i}`,contextSnapshotId:`c${i}`,status:'issued',frozenAt:date(i),
  horizon:{mode:'absolute',start:date(i),end:date(i+1),timezone:'UTC'},scenarioId:'scenario',plannedActionId:null,actionCondition:null,
  targetEvent:'The published decision arrives',observableSuccessCriterion:'A signed decision is received',observableFailureCriterion:'No decision by the deadline',
  conditions:['The application is submitted'],predictedOutcome:'occurs',payloadHash:i.toString(16).padStart(64,'0'),probability:null});
const resolution=(f,event=true)=>({id:`r-${f.id}`,forecastId:f.id,status:event?'confirmed':'contradicted',conditionStatus:'met',observedOccurred:event,
  occurredAt:event?f.horizon.end:null,outcomeEvidenceIds:['evidence'],recordedAt:new Date(Date.parse(f.frozenAt)+day+1000).toISOString(),resolvedHorizon:f.horizon});
const history=(n,label=i=>i%5!==0)=>{const forecasts=Array.from({length:n},(_,i)=>forecast(i));return [{forecasts,resolutions:forecasts.map((f,i)=>resolution(f,label(i)))}];};

test('Personal empirical rates use observed events and a chronological holdout, rather than symbolic scores',()=>{
  const target=forecast(100),estimate=estimateEmpiricalProbability(target,history(60),true);
  assert.equal(estimate.reason,null);assert.equal(estimate.observations,60);assert.equal(estimate.successes,48);
  assert.equal(estimate.probability,49/62);assert.equal(estimate.validation.observations,20);
  assert(estimate.validation.brier<0.25);assert(estimate.interval95.lower<0.8&&estimate.interval95.upper>0.8);
  assert(validEmpiricalEstimate(estimate,target));
  assert(!validEmpiricalEstimate({...estimate,probability:0.99},target));
  assert(!validEmpiricalEstimate({...estimate,successes:1000},target));
});

test('Conflicting forecast IDs, simultaneous reviews and repeated-situation outcomes are quarantined',()=>{
  const target=forecast(100),data=history(60),original=data[0].forecasts[0];
  const conflict={...original,payloadHash:'f'.repeat(64)};
  assert.equal(estimateEmpiricalProbability(target,[...data,{forecasts:[conflict],resolutions:[]}],true).observations,59);
  const sameTime={...data[0].resolutions[1],observedOccurred:false,status:'contradicted'};
  assert.equal(estimateEmpiricalProbability(target,[...data,{forecasts:[],resolutions:[sameTime]}],true).observations,59);
  const copied={...forecast(70),situationId:original.situationId};
  assert.equal(estimateEmpiricalProbability(target,[...data,{forecasts:[copied],resolutions:[resolution(copied,true)]}],true).observations,59);
  const malformed=data.map(s=>({...s,resolutions:s.resolutions.map(r=>({...r,status:'contradicted',observedOccurred:true}))}));
  assert.equal(estimateEmpiricalProbability(target,malformed,true).observations,0);
});

test('Insufficient or drifting history yields no numeric probability',()=>{
  const target=forecast(100);
  assert.equal(estimateEmpiricalProbability(target,history(29),true).probability,null);
  assert.equal(estimateEmpiricalProbability(target,history(60,i=>i<40),true).reason,'unstable_history');
  assert.equal(estimateEmpiricalProbability(target,history(60),false).reason,'history_disabled');
  assert.equal(estimateEmpiricalProbability({...target,status:'abstained'},history(60),true).reason,'forecast_abstained');
});

test('Future, incomplete, unselected and condition-unmet observations cannot train the estimate',()=>{
  const target=forecast(100),data=history(60);
  const unusable=[{status:'pending'},{status:'not_selected'},{status:'condition_unmet'},
    {conditionStatus:'unknown'},{outcomeEvidenceIds:[]},{recordedAt:date(110)},{resolvedHorizon:null},{observedOccurred:null}];
  for(const patch of unusable){
    const altered=data.map(s=>({...s,resolutions:s.resolutions.map(r=>({...r,...patch}))}));
    assert.equal(estimateEmpiricalProbability(target,altered,true).observations,0,JSON.stringify(patch));
  }
  assert.equal(estimateEmpiricalProbability(forecast(20),data,true).observations,19);
});

test('Copies and repeated forecasts do not multiply evidence; other actions, conditions and horizons form separate cohorts',()=>{
  const target=forecast(100),data=history(60);
  assert.equal(estimateEmpiricalProbability(target,[...data,...data],true).observations,60);
  const copies=data[0].forecasts.map(f=>({...f,id:'copy-'+f.id}));
  assert.equal(estimateEmpiricalProbability(target,[...data,{forecasts:copies,resolutions:copies.map((f,i)=>resolution(f,i%5!==0))}],true).observations,60);
  for(const changed of [{...target,plannedActionId:'different-action'},{...target,conditions:['A different precondition']},
    {...target,horizon:{...target.horizon,end:date(110)}}]){
    assert.notEqual(empiricalCohort(changed),empiricalCohort(target));
    assert.equal(estimateEmpiricalProbability(changed,data,true).observations,0);
  }
  const withDays=days=>({...target,horizon:{...target.horizon,end:date(100+days)}});
  for(const [short,long]of [[2,7],[31,365]])assert.notEqual(empiricalCohort(withDays(short)),empiricalCohort(withDays(long)));
  const relative=anchor=>({...target,horizon:{mode:'relative',anchorEvent:anchor,durationMinutes:1440,startOffsetMinutes:0,anchorDeadline:date(110),timezone:'UTC'}});
  assert.notEqual(empiricalCohort(relative('Agreement signed')),empiricalCohort(relative('Reply received')));
  assert.notEqual(empiricalCohort(relative('Agreement signed')),empiricalCohort({...relative('Agreement signed'),horizon:{...relative('Agreement signed').horizon,startOffsetMinutes:1440}}));
});

test('The interval remains inside zero and one even for all successes or no successes',()=>{
  for(const successes of [0,30]){const interval=wilsonInterval(successes,30);assert(interval.lower>=0&&interval.upper<=1);assert(interval.lower<interval.upper);}
  assert.throws(()=>wilsonInterval(31,30));assert.throws(()=>wilsonInterval(0,0));
});
