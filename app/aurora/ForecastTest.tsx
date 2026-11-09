import {useEffect,useRef} from 'react';
import T from './forecast-test-copy.ru.json';
import A from './adaptive-copy.ru.json';
import {questionPresentation,mechanismChoices,caseContext,text} from './adaptive-content';
import {QuestionGuidance} from './QuestionGuidance';
import type {InformationFamily} from './catalog/questions';
import {forecastScreens} from './forecast-test';
import RU from './texts.ru.json';
import {questionLimitForStage} from './question-budget';
import {diagnosticQuestions,forecastTestProblems,FORECAST_OUTCOMES,FORECAST_WINDOWS,newForecastTest,priorTestAnswer,
 testQuestions,testPhaseLabels,testTimeBasis,testVerification,testAnchors,type ForecastTestDraft} from './forecast-test';
import type {AuroraSession} from './session';
import type {Language} from '../i18n';
import {selectedTransformationSectors,transformationAtlas} from './transformation';
import {MethodSheet} from './MethodSheet';

const optionExample=(name:string,id:string)=>{
 const fields:Record<string,Record<string,string>>={
  'forecast-phase':{onset:'phase_first',recurrence:'phase_repeated',turning:'phase_changed'},
  'forecast-time-basis':{agreed:'example_explicit_agreement',typical:'example_repetition_known',observation:'example_horizon_defined'},
  'forecast-verification':{written:'example_direct_evidence',direct:'example_event_observed',participant:'example_other_agreement',unavailable:'example_source_known'},
  'forecast-preference':{clarify:'action_information',change:'action_form',support:'action_rhythm'},
  'forecast-clock':{now:'example_deadline_defined',event:'example_condition_before_outcome'},
 };
 return text(fields[name]?.[id]??'');
};
function Options({name,value,choices,onChange,disabled=false}:{name:string;value:string|null;choices:readonly {id:string;label:string;description?:string}[];onChange:(value:string)=>void;disabled?:boolean}) {
 return <div className="aurora-test-options">{choices.map(choice=><label className="aurora-choice" data-selected={value===choice.id} key={choice.id}>
  <input type="radio" name={name} value={choice.id} checked={value===choice.id} disabled={disabled} onChange={()=>onChange(choice.id)}/><span><strong>{choice.label}</strong>{choice.description||optionExample(name,choice.id)?<small>{choice.description||optionExample(name,choice.id)}</small>:null}</span>
 </label>)}</div>;
}
export function ForecastTest({session,language,busy,onChange}:{session:AuroraSession;language:Language;busy:boolean;
 onChange:(value:ForecastTestDraft)=>void}) {
 const test=session.forecastTest??newForecastTest(),heading=useRef<HTMLHeadingElement>(null);
 const pages=[T.testOutcome,T.testFocus,T.testFacts,T.testCapacity,T.testPatterns,T.testWindow,T.testReview];
 useEffect(()=>{heading.current?.focus({preventScroll:true});heading.current?.scrollIntoView({block:'nearest'});},[test.page,test.cursor]);
 const update=(patch:Partial<ForecastTestDraft>)=>onChange({...test,...patch,confirmed:patch.confirmed??false});
 const move=(page:number)=>onChange({...test,page,cursor:0});
 const screens=forecastScreens(test,session.selectedSectorId),cursor=Math.min(test.cursor??0,screens.length-1),screen=screens[cursor];
 const problems=forecastTestProblems(test,session.context,session.selectedSectorId);
 const questions=diagnosticQuestions(test,session.selectedSectorId);
 const outcome=FORECAST_OUTCOMES.find(row=>row.id===test.outcome);
 const guideFields:Record<string,[InformationFamily,string]>={outcome:['event','target_observable'],outcomeUnknown:['event','outcome_not_known'],
  mechanism:['grounds','inference_distinguished'],phase:['repetition','repetition_known'],clock:['sequence','condition_before_outcome'],
  anchor:['sequence','event_order_known'],anchorDeadlineDays:['sequence','deadline_defined'],windowDays:['sequence','horizon_defined'],
  basis:['grounds','lead_time_known'],verification:['grounds','direct_evidence'],minutes:['capability','available_time_known'],
  preference:['capability','small_step_possible'],review:['grounds','falsification_criterion']};
 const guide=guideFields[screen];
 const choiceOutcomes=session.transformation?transformationAtlas(session.primary,session.observationOnly?session.primary.cards.map(card=>card.sourcePositionId):selectedTransformationSectors(session),session.transformation.spheres,session.transformation.answers).questionOptions.map(row=>({id:row.id,label:row.title,description:row.description})):FORECAST_OUTCOMES.map(row=>({id:row.id,label:row.title}));
 const dayLabel=(days:number)=>new Intl.RelativeTimeFormat(language,{numeric:'always'}).format(days,'day');
 const windows=(name:string,value:number|null,onChange:(value:number)=>void)=><Options name={name} value={value===null?null:String(value)}
  choices={FORECAST_WINDOWS.map(days=>({id:String(days),label:dayLabel(days)}))} onChange={value=>onChange(Number(value))} disabled={busy}/>;
 return <section className="aurora-forecast-test" data-page={test.page} data-question={screen} aria-label={T.testTitle}>
  <div className="aurora-test-heading"><h4 ref={heading} tabIndex={-1}>{pages[test.page]}</h4><MethodSheet title={T.testTitle} icon="list" label={T.testTitle}>
  <nav aria-label={T.testTitle} className="aurora-test-progress">{pages.map((title,index)=><button type="button" key={title} disabled={busy} aria-current={test.page===index?'step':undefined}
   aria-label={`${index+1}. ${title}`} title={title} onClick={()=>move(index)}><span aria-hidden="true">{index+1}</span></button>)}</nav>
  <p>{T.testPart} {test.page+1} {T.testOf} {pages.length}</p></MethodSheet></div><p className="aurora-question-progress" role="status">{cursor+1} / {screens.length}</p>
  {guide?<QuestionGuidance language={language} family={guide[0]} example={[caseContext(session.primary,selectedTransformationSectors(session),session.intake.domain).domain,text(`example_${guide[1]}`)].join(' ')}/>:null}
  <fieldset disabled={busy} className="aurora-test-fields">
   {test.page===0?<>
    {screen==='outcome'?<Options name="forecast-outcome" value={test.outcome} choices={choiceOutcomes} onChange={outcome=>update({outcome})}/>:null}
    {screen==='outcomeUnknown'?<><h5>{T.testOutcomeUnknown}</h5><Options name="forecast-outcome-unknown" value={test.outcomeUnknown}
     choices={[{id:'true',label:T.testNotOccurred},{id:'false',label:T.testAlreadyKnown},{id:'unknown',label:T.testUncertain}]}
     onChange={outcomeUnknown=>update({outcomeUnknown:outcomeUnknown as ForecastTestDraft['outcomeUnknown']})}/></>:null}

   </>:null}
   {test.page===1?<>
    {screen==='mechanism'?<><p>{A.exampleNote}</p><Options name="forecast-mechanism" value={test.mechanism}
     choices={mechanismChoices(session.primary,selectedTransformationSectors(session),session.intake.domain)}
     onChange={mechanism=>update({mechanism:mechanism as ForecastTestDraft['mechanism'],answers:{}})}/></>:null}
    {screen==='phase'?<><h5>{T.testPhase}</h5><Options name="forecast-phase" value={test.phase} choices={Object.entries(testPhaseLabels).map(([id,label])=>({id,label}))}
     onChange={phase=>update({phase:phase as ForecastTestDraft['phase']})}/></>:null}
   </>:null}
   {test.page>=2&&test.page<=4?<>
    {questions[test.page-2].slice(cursor,cursor+1).map((question)=>{
     const index=questions.slice(0,test.page-2).flat().length+cursor,presentation=questionPresentation(question,session.primary,selectedTransformationSectors(session),session.intake.domain,index,language,session.context);
     const field=question.resolvesFields[0],previous=priorTestAnswer(session.context,field);
     return <fieldset className="aurora-test-question" key={question.id}><legend>{presentation.title}</legend><QuestionGuidance language={language} family={presentation.family} example={presentation.example}/>
      <p className="aurora-question-progress"><span>{RU.text0138}</span> {index+1} <span>{T.testOf}</span> {questionLimitForStage(5)}</p>
      {previous?<p>{T.testEarlier}: {previous}</p>:null}
      <Options name={`forecast-test-${field}`} value={test.answers[field]??null}
       choices={[...presentation.choices.map(choice=>({id:choice.id==='yes'?'true':'false',label:choice.label,description:choice.description})),{id:'unknown',label:T.testUnknown,description:A.answerUnknown}]}
       onChange={value=>update({answers:{...test.answers,[field]:value as 'true'|'false'|'unknown'}})}/>
     </fieldset>;
    })}
   </>:null}
   {test.page===5?<>
    {screen==='clock'?<><h5>{T.testClock}</h5><Options name="forecast-clock" value={test.clock} choices={[{id:'now',label:T.testClockNow},{id:'event',label:T.testClockEvent}]}
     onChange={clock=>update({clock:clock as ForecastTestDraft['clock']})}/></>:null}
    {screen==='anchor'?<><h5>{T.testAnchor}</h5><Options name="forecast-anchor" value={test.anchor} choices={Object.entries(testAnchors).map(([id,label])=>({id,label}))}
     onChange={anchor=>update({anchor:anchor as ForecastTestDraft['anchor']})}/></>:null}{screen==='anchorDeadlineDays'?<><h5>{T.testAnchorDeadline}</h5>{windows('forecast-anchor-deadline',test.anchorDeadlineDays,anchorDeadlineDays=>update({anchorDeadlineDays}))}</>:null}
    {screen==='windowDays'?<><h5>{T.testWindow}</h5>{windows('forecast-window',test.windowDays,windowDays=>update({windowDays}))}</>:null}
    {screen==='basis'?<><h5>{T.testTimeBasis}</h5><Options name="forecast-time-basis" value={test.basis} choices={Object.entries(testTimeBasis).map(([id,label])=>({id,label}))}
     onChange={basis=>update({basis:basis as ForecastTestDraft['basis']})}/></>:null}
    {screen==='verification'?<><h5>{T.testEvidence}</h5><Options name="forecast-verification" value={test.verification} choices={Object.entries(testVerification).map(([id,label])=>({id,label}))}
     onChange={verification=>update({verification:verification as ForecastTestDraft['verification']})}/></>:null}
    {screen==='minutes'?<><h5>{T.testTimeAvailable}</h5><Options name="forecast-minutes" value={String(test.minutes)} choices={[2,10,30].map(minutes=>({id:String(minutes),label:new Intl.NumberFormat(language,{style:'unit',unit:'minute',unitDisplay:'long'}).format(minutes)}))}
     onChange={minutes=>update({minutes:Number(minutes) as ForecastTestDraft['minutes']})}/></>:null}
    {screen==='preference'?<><h5>{T.testPreference}</h5><Options name="forecast-preference" value={test.preference}
     choices={[{id:'clarify',label:T.testPreferClarify},{id:'change',label:T.testPreferChange},{id:'support',label:T.testPreferObserve}]}
     onChange={preference=>update({preference:preference as ForecastTestDraft['preference']})}/></>:null}
   </>:null}
   {test.page===6?<>
    <dl className="aurora-review"><dt>{T.testOutcome}</dt><dd>{outcome?.target??'—'}</dd>
     <dt>{T.testSuccess}</dt><dd>{outcome?.success??'—'}</dd><dt>{T.testFailure}</dt><dd>{outcome?.failure??'—'}</dd>
     <dt>{T.testWindow}</dt><dd data-no-translate>{test.windowDays?dayLabel(test.windowDays):'—'}</dd>
     <dt>{T.testTimeBasis}</dt><dd>{test.basis?testTimeBasis[test.basis]:'—'}</dd><dt>{T.testVerifySource}</dt><dd>{test.verification?testVerification[test.verification]:'—'}</dd></dl>
    <h5>{T.testScenario}</h5><ul>{testQuestions(test,session.selectedSectorId).map(({question,predicate})=><li key={predicate.field}>{question.text} · {test.answers[predicate.field]==='true'?T.testYes:test.answers[predicate.field]==='false'?T.testNo:T.testUnknown}</li>)}</ul>
    <p>{T.testUnverified}</p><label className="aurora-choice"><input type="checkbox" checked={test.confirmed} onChange={event=>update({confirmed:event.target.checked})}/>{T.testConfirm}</label>
    {problems.length?<div className="aurora-test-problems" role="status"><ul>{problems.map((problem,index)=><li key={index}>{problem.text}{problem.field?<p>{problem.field}</p>:null}
     </li>)}</ul><p>{A.practiceHelp}</p></div>:<p role="status">{T.testReady}</p>}
    <p>{T.testLimits}</p>{problems.length===0?<p>{T.testPrice}</p>:null}
   </>:null}
  </fieldset>

 </section>;
}
