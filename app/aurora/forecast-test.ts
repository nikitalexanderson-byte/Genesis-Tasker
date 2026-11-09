import T from './forecast-test-copy.ru.json';
import {SCENARIOS,SCENARIO_MECHANISMS,SCENARIO_PHASES,type ScenarioMechanism,type ScenarioPhase} from './catalog/scenarios';
import {QUESTIONS,BASE_QUESTIONS,MYTH_QUESTIONS,type QuestionRecord} from './catalog/questions';
import {MYTH_TRANSITIONS} from './catalog/myths';
import {recordField,knownValue} from './context';
import {predicateState} from './graph';
import type {SituationProfile,Truth} from './types';
import {SECTORS,type SectorId} from './registry';
import {questionLimitForStage} from './question-budget';
export const FORECAST_TEST_VERSION=1;
export const FORECAST_WINDOWS=[1,3,7,14,30,90,365] as const;
export const FORECAST_OUTCOMES=[
 {id:'response',title:T.testResponseTitle,target:T.testResponseTarget,success:T.testResponseSuccess,failure:T.testResponseFailure},
 {id:'agreement',title:T.testAgreementTitle,target:T.testAgreementTarget,success:T.testAgreementSuccess,failure:T.testAgreementFailure},
 {id:'access',title:T.testAccessTitle,target:T.testAccessTarget,success:T.testAccessSuccess,failure:T.testAccessFailure},
 {id:'accepted',title:T.testAcceptedTitle,target:T.testAcceptedTarget,success:T.testAcceptedSuccess,failure:T.testAcceptedFailure},
 {id:'milestone',title:T.testMilestoneTitle,target:T.testMilestoneTarget,success:T.testMilestoneSuccess,failure:T.testMilestoneFailure},
] as const;
export type ForecastTestDraft={version:1;page:number;cursor?:number;outcome:string|null;outcomeUnknown:Truth|null;mechanism:ScenarioMechanism|null;phase:ScenarioPhase|null;
 answers:Record<string,Truth>;windowDays:number|null;basis:'agreed'|'typical'|'observation'|null;verification:'written'|'direct'|'participant'|'unavailable'|null;
 clock:'now'|'event';anchor:'request'|'agreement'|'resource'|null;anchorDeadlineDays:number|null;minutes:2|10|30;preference:'clarify'|'change'|'support'|null;confirmed:boolean};
export const newForecastTest=():ForecastTestDraft=>({version:1,page:0,outcome:null,outcomeUnknown:null,mechanism:null,phase:null,answers:{},windowDays:null,basis:null,verification:null,clock:'now',anchor:null,anchorDeadlineDays:null,minutes:10,preference:null,confirmed:false});
export const hasObservationEvidence=(description:string)=>Boolean(description.trim())&&description!==T.testNoEvidence;
export function validateForecastTest(value:ForecastTestDraft):void {
 if(value?.cursor!==undefined&&(!Number.isInteger(value.cursor)||value.cursor<0||value.cursor>10))throw Error('AURORA_INVALID_FORECAST_CURSOR');
 if(!value||value.version!==1||!Number.isInteger(value.page)||value.page<0||value.page>6||!value.answers||typeof value.answers!=='object'||Array.isArray(value.answers)
  ||Object.keys(value.answers).length>100||Object.entries(value.answers).some(([field,state])=>!QUESTIONS.some(q=>q.resolvesFields.includes(field))||!['true','false','unknown'].includes(state))
  ||value.outcome!==null&&!FORECAST_OUTCOMES.some(row=>row.id===value.outcome)||value.outcomeUnknown!==null&&!['true','false','unknown'].includes(value.outcomeUnknown)
  ||value.mechanism!==null&&!SCENARIO_MECHANISMS.includes(value.mechanism)||value.phase!==null&&!SCENARIO_PHASES.includes(value.phase)
  ||value.windowDays!==null&&!FORECAST_WINDOWS.includes(value.windowDays as typeof FORECAST_WINDOWS[number])
  ||value.anchorDeadlineDays!==null&&!FORECAST_WINDOWS.includes(value.anchorDeadlineDays as typeof FORECAST_WINDOWS[number])
  ||value.basis!==null&&!['agreed','typical','observation'].includes(value.basis)||value.verification!==null&&!['written','direct','participant','unavailable'].includes(value.verification)
  ||!['2','10','30'].includes(String(value.minutes))||value.preference!==null&&!['clarify','change','support'].includes(value.preference)
  ||!['now','event'].includes(value.clock)||value.anchor!==null&&!['request','agreement','resource'].includes(value.anchor)||typeof value.confirmed!=='boolean')throw Error('AURORA_INVALID_FORECAST_TEST');
}
export const testTimeBasis={agreed:T.testAgreed,typical:T.testTypical,observation:T.testObservationWindow};
export const testVerification={written:T.testWritten,direct:T.testDirect,participant:T.testParticipant,unavailable:T.testNoEvidence};
export const testAnchors={request:T.testAnchorRequest,agreement:T.testAnchorAgreement,resource:T.testAnchorResource};
export const testPhaseLabels={onset:T.testOnset,recurrence:T.testRecurrence,turning:T.testTurning};
export function forecastTestPageMissing(test:ForecastTestDraft,sector:SectorId|null):boolean {
 return test.page===0?(!test.outcome||!test.outcomeUnknown):test.page===1?(!test.mechanism||!test.phase)
  :test.page>=2&&test.page<=4?diagnosticQuestions(test,sector)[test.page-2].some(q=>test.answers[q.resolvesFields[0]]===undefined)
   :test.page===5?(!test.windowDays||!test.basis||!test.verification||!test.preference||test.clock==='event'&&(!test.anchor||!test.anchorDeadlineDays)):false;
}
export function testScenario(test:ForecastTestDraft,sector:SectorId|null) {
 return SCENARIOS.find(row=>row.sectorId===(sector??'center')&&row.mechanismId===test.mechanism&&row.phase===test.phase)??null;
}
export function testQuestions(test:ForecastTestDraft,sector:SectorId|null) {
 const scenario=testScenario(test,sector);if(!scenario)return [];
 // Mechanism predicates are the first two catalog requirements; phase is answered separately.
 return scenario.required.slice(0,2).map(predicate=>({predicate,question:QUESTIONS.find(q=>q.resolvesFields[0]===predicate.field&&q.sectorTags.includes(sector??'center'))
  ??QUESTIONS.find(q=>q.resolvesFields[0]===predicate.field)!}));
}
/** A bounded, reproducible interview: facts first, then capacity/dependencies, then relevant myth transitions. */
export function diagnosticQuestions(test:ForecastTestDraft,sector:SectorId|null):QuestionRecord[][] {
 const sectorId=sector??'center',core=testQuestions(test,sector).map(row=>row.question);
 const excluded=new Set([...core.map(q=>q.resolvesFields[0]),'repetition_known','pattern_same_context','prior_exception','outcome_not_known']);
 const groups=[['event_observed','baseline_defined','actor_role_known','source_known','explicit_agreement','event_order_known'],
  ['resource_available','small_step_possible','decision_owner_known','external_dependency','independent_alternative','contact_safe','nonnegotiable_constraint','reversible_step'],
  ['goal_is_own','values_share_constraint','stop_condition_known','scale_limit_known']];
 const used=new Set(excluded),rows=groups.map((fields,index)=>[...(index===0?core:[]),...fields.flatMap(field=>{
  if(used.has(field))return [];used.add(field);return BASE_QUESTIONS.filter(q=>q.sectorTags.includes(sectorId)&&q.resolvesFields[0]===field).slice(0,1);
 })]);
 const deities=new Set(SECTORS.find(row=>row.id===sectorId)!.deities);
 const edges=MYTH_TRANSITIONS.filter(edge=>deities.has(edge.sourceGodId as never)||deities.has(edge.targetGodId as never));
 const myth=MYTH_QUESTIONS.filter(q=>edges.some(edge=>edge.questionIds.includes(q.id))).filter(q=>{
  if(used.has(q.resolvesFields[0]))return false;used.add(q.resolvesFields[0]);return true;
 }).slice(0,8);
 rows[2].splice(1,0,...myth);
 // Reserve both scenario predicates, then share the remaining budget across
 // facts, capacity and the relevant transition instead of exhausting one page.
 const bounded:QuestionRecord[][]=[core,[],[]],queues=rows.map((row,index)=>index===0?row.slice(core.length):row);
 let remaining=questionLimitForStage(5)-core.length;
 while(remaining>0&&queues.some(row=>row.length))for(let index=0;index<queues.length&&remaining>0;index++){
  const question=queues[index].shift();if(question){bounded[index].push(question);remaining--;}
 }
 return bounded;
}
export function forecastTestProblems(test:ForecastTestDraft,profile:SituationProfile,sector:SectorId|null) {
 validateForecastTest(test);const problems:{page:number;text:string;field?:string}[]=[];
 if(!test.outcome||!test.outcomeUnknown)problems.push({page:0,text:T.testNeedOutcome});
 else if(test.outcomeUnknown!=='true')problems.push({page:0,text:test.outcomeUnknown==='false'?T.testKnownBlock:T.testUnknownBlock});
 if(!test.mechanism||!test.phase)problems.push({page:1,text:T.testNeedFocus});
 const scenario=testScenario(test,sector);
 for(const {predicate,question} of testQuestions(test,sector)) {
  const state=test.answers[predicate.field];if(!state||state==='unknown')problems.push({page:2,text:state?T.testUnknownBlock:T.testNeedFacts,field:question.text});
  else if((state==='true')!==predicate.value)problems.push({page:2,text:T.testMismatch,field:question.text});
 }
 diagnosticQuestions(test,sector).forEach((questions,index)=>{
  if(questions.some(q=>test.answers[q.resolvesFields[0]]===undefined))problems.push({page:index+2,text:T.testNeedFacts});
 });
 if(scenario&&scenario.exclusions.some(p=>p.field!=='outcome_not_known'&&predicateState(profile,p)==='true')||scenario&&profile.rejectedThemes.includes(scenario.mechanismId))problems.push({page:1,text:T.testUnavailable});
 if(!test.windowDays||!test.basis||!test.verification||!test.preference)problems.push({page:5,text:T.testNeedWindow});
 else if(test.verification==='unavailable')problems.push({page:5,text:T.testEvidenceBlock});
 if(test.clock==='event'&&(!test.anchor||!test.anchorDeadlineDays))problems.push({page:5,text:T.testMissingAnchor});
 if(!test.confirmed)problems.push({page:6,text:T.testNeedReview});
 return problems;
}
/** Every field comes from an explicit choice. No phrase matching, invented facts or automatic positive answers. */
export function recordForecastAnswers(test:ForecastTestDraft,profile:SituationProfile,sector:SectorId|null,id:()=>string):SituationProfile {
 validateForecastTest(test);
 let context=profile;
 for(const question of diagnosticQuestions(test,sector).flat()) {
  const field=question.resolvesFields[0],state=test.answers[field];
  if(state===undefined)continue;
  context=recordField(context,{id:id(),field,value:state==='true',exactUserText:question.text+' '+(state==='true'?T.testYes:state==='false'?T.testNo:T.testUnknown),
   kind:question.evidenceRequirement,confirmed:state!=='unknown',beforeInterpretation:false,status:state==='unknown'?'unknown':'known'});
 }
 return context;
}
export function compileForecastTest(test:ForecastTestDraft,profile:SituationProfile,sector:SectorId|null,now:string,id:()=>string) {
 const problems=forecastTestProblems(test,profile,sector);if(problems.length)throw Error('AURORA_FORECAST_TEST_INCOMPLETE');
 if(!Number.isFinite(Date.parse(now)))throw Error('AURORA_INVALID_FORECAST_TIME');
 const scenario=testScenario(test,sector)!,outcome=FORECAST_OUTCOMES.find(row=>row.id===test.outcome)!;
 let context=recordForecastAnswers(test,profile,sector,id);
 const set=(field:string,value:string|boolean,text:string,kind:'reported_event'|'constraint'='reported_event')=>{context=recordField(context,{id:id(),field,value,exactUserText:text,kind,confirmed:true,beforeInterpretation:false});};
 set('repetition_known',test.phase!=='onset',testPhaseLabels[test.phase!]);
 set('pattern_same_context',test.phase==='recurrence',testPhaseLabels[test.phase!]);
 set('prior_exception',test.phase==='turning',testPhaseLabels[test.phase!]);
 set('forecast_scope_mechanism',test.mechanism!,T.testFocus+': '+scenario.title,'constraint');
 set('forecast_scope_phase',test.phase!,testPhaseLabels[test.phase!],'constraint');
 set('outcome_not_known',true,T.testNotOccurred);set('target_observable',true,testVerification[test.verification!]);
 set('action_preference',test.preference!,T.testFocus,'constraint');
 set('forecast_verification',test.verification!,testVerification[test.verification!],'constraint');
 set('context_confirmed',true,T.testConfirm,'constraint');
 const end=new Date(Date.parse(now)+(test.clock==='event'?test.anchorDeadlineDays!:test.windowDays!)*86400000).toISOString();
 const form={target:outcome.target,success:outcome.success,failure:outcome.failure,
  conditions:[T.testFocus+': '+scenario.title,T.testPhase+': '+testPhaseLabels[test.phase!],...testQuestions(test,sector).map(({question,predicate})=>question.text+' '+(test.answers[predicate.field]==='true'?T.testYes:T.testNo)),
   T.testVerifySource+': '+testVerification[test.verification!]].join('\n'),end,conditionDeadline:end,scenarioId:scenario.id,horizonBasis:testTimeBasis[test.basis!],
  horizonMode:test.clock==='event'?'relative' as const:'absolute' as const,anchorEvent:test.anchor?testAnchors[test.anchor]:'',startOffsetMinutes:0,durationMinutes:test.windowDays!*1440};
 return {context,form,scenario,outcome};
}
export function priorTestAnswer(profile:SituationProfile,field:string):string|null {
 const value=knownValue<boolean>(profile,field);return value===null?null:value?T.testYes:T.testNo;
}
export function forecastScreens(test:ForecastTestDraft,sector:SectorId|null):string[]{
 if(test.page===0)return ['outcome','outcomeUnknown'];
 if(test.page===1)return ['mechanism','phase'];
 if(test.page>=2&&test.page<=4)return diagnosticQuestions(test,sector)[test.page-2].map(q=>q.resolvesFields[0]);
 if(test.page===5)return ['clock',...(test.clock==='event'?['anchor','anchorDeadlineDays']:[]),'windowDays','basis','verification','minutes','preference'];
 return ['review'];
}
export function forecastScreenMissing(test:ForecastTestDraft,sector:SectorId|null):boolean{
 const key=forecastScreens(test,sector)[test.cursor??0];
 if(!key)return true;
 if(test.page>=2&&test.page<=4)return !test.answers[key];
 if(key==='review')return false;
 return !test[key as keyof ForecastTestDraft];
}
export function moveForecastScreen(test:ForecastTestDraft,sector:SectorId|null,direction:1|-1):ForecastTestDraft{
 const count=forecastScreens(test,sector).length,cursor=test.cursor??0;
 if(direction===1)return cursor+1<count?{...test,cursor:cursor+1}:{...test,page:Math.min(6,test.page+1),cursor:0};
 if(cursor>0)return {...test,cursor:cursor-1};
 const previous={...test,page:Math.max(0,test.page-1),cursor:0};
 return {...previous,cursor:Math.max(0,forecastScreens(previous,sector).length-1)};
}
