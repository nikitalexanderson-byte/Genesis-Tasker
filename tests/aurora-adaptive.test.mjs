import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {calendarModule} from './helpers/calendar-modules.mjs';
const {expectedSourceDraw,snapshotFromSavedDraw}=calendarModule('app/aurora/draw-policy.ts');
const {createSituation,applyAnswer,selectQuestion,reviseAnswer}=calendarModule('app/aurora/context.ts');
const {answeredQuestionCount}=calendarModule('app/aurora/question-budget.ts');
const {situationVariant,situationDesignSpace,questionPresentation,practicalGuidance,caseContext}=calendarModule('app/aurora/adaptive-content.ts');
const {moveForecastScreen,forecastScreens,forecastScreenMissing,newForecastTest}=calendarModule('app/aurora/forecast-test.ts');
const {BASE_QUESTIONS}=calendarModule('app/aurora/catalog/questions.ts');
const now='2026-11-07T12:00:00.000Z';
const primary=seed=>snapshotFromSavedDraw({id:'qa-'+seed,seed,day:'2026-11-07',createdAt:now,cards:expectedSourceDraw(seed)});
const input=(q,choice,n)=>({id:'answer-'+n,questionId:q.id,choiceId:choice,detail:'',responseMode:'choice',confirmed:['yes','no'].includes(choice),createdAt:now});
test('Every one of 20 interview positions reacts to the immediately preceding answer',()=>{
 for(let seed=0;seed<12;seed++){
  const snapshot=primary(seed),sectors=snapshot.cards.filter(c=>c.orientation==='reversed').map(c=>c.sourcePositionId);
  let profile=createSituation('s','Europe/Moscow'),answers=[];
  for(let index=0;index<20;index++){
   const question=selectQuestion(profile,sectors[0]??null,snapshot,answers,[],sectors);
   assert.ok(question,`seed ${seed}, position ${index}`);
   const branches=['yes','no','unknown','skipped','not_applicable'].map(choice=>{
    const result=applyAnswer(profile,input(question,choice,index),true);
    return {result,next:selectQuestion(result.profile,sectors[0]??null,snapshot,[...answers,result.answer],[],sectors)};
   });
   if(index<19)assert.equal(new Set(branches.map(row=>row.next?.resolvesFields[0])).size,5,`seed ${seed}, position ${index}: distinct answer branches`);
   const selected=branches[(seed+index)%5].result;
   profile=selected.profile;answers.push(selected.answer);
  }
  assert.equal(answeredQuestionCount(answers),20);
  assert.equal(selectQuestion(profile,sectors[0]??null,snapshot,answers,[],sectors),null);
 }
});
test('Changing an earlier answer retires downstream facts and reopens the interview without deleting history',()=>{
 const snapshot=primary(7),sector=snapshot.cards.find(c=>c.orientation==='reversed').sourcePositionId;
 let profile=createSituation('s','Europe/Moscow'),answers=[];
 for(let i=0;i<20;i++){const q=selectQuestion(profile,sector,snapshot,answers),result=applyAnswer(profile,input(q,'yes',i),true);profile=result.profile;answers.push(result.answer);}
 const changed=reviseAnswer(profile,answers,answers[2].id,{...input(BASE_QUESTIONS.find(q=>q.id===answers[2].questionId),'no','revision')},true);
 assert.equal(changed.answers.length,21);assert.equal(answeredQuestionCount(changed.answers),3);
 assert.ok(answers.slice(3).every(row=>!changed.profile.fields[row.field]));
 assert.ok(selectQuestion(changed.profile,sector,snapshot,changed.answers));
});
test('Revising interview evidence invalidates the completed forecast draft without deleting frozen history',()=>{
 const {newSession,invalidateSessionDraft}=calendarModule('app/aurora/session.ts');
 const {compileForecastTest,forecastTestProblems}=calendarModule('app/aurora/forecast-test.ts');
 const s=newSession({id:'s',ownerId:'a',now,primary:primary(7),timezone:'Europe/Moscow'});
 s.forecastTest={...newForecastTest(),page:6,confirmed:true,answers:{resource_available:'true'}};
 s.forecasts=[{id:'frozen-result'}];s.contextSnapshots=[{id:'frozen-context'}];
 const revised=invalidateSessionDraft(s);assert.equal(revised.forecastTest,undefined);
 assert.equal(revised.forecasts,s.forecasts);assert.equal(revised.contextSnapshots,s.contextSnapshots);
 const next=newForecastTest();assert.equal(next.page,0);assert.equal(next.confirmed,false);
 assert.ok(forecastTestProblems(next,revised.context,null).length);
 assert.throws(()=>compileForecastTest(next,revised.context,null,now,()=>''),/INCOMPLETE/);
});
test('Interview answers remain editable after the forecast reconfirms the same facts',()=>{
 const {recordField,currentInterviewAnswers}=calendarModule('app/aurora/context.ts');
 const snapshot=primary(7),sector=snapshot.cards.find(c=>c.orientation==='reversed').sourcePositionId;
 let profile=createSituation('s','Europe/Moscow'),answers=[];
 for(let i=0;i<3;i++){const q=selectQuestion(profile,sector,snapshot,answers),result=applyAnswer(profile,input(q,'yes',i),true);profile=result.profile;answers.push(result.answer);}
 for(const row of answers)profile=recordField(profile,{id:'forecast-'+row.id,field:row.field,value:true,exactUserText:'Confirmed in forecast',kind:'reported_event',confirmed:true,beforeInterpretation:false});
 const previous=answers[0],q=BASE_QUESTIONS.find(q=>q.id===previous.questionId);
 const revised=reviseAnswer(profile,answers,previous.id,input(q,'no','changed'),false);
 assert.equal(currentInterviewAnswers(revised.answers).length,1);
 for(const row of answers.slice(1)){assert.equal(revised.profile.fields[row.field],undefined);assert.equal(revised.profile.answerEvidence.find(e=>e.id==='forecast-'+row.id).excludedReason,'superseded_by_branch_change');}
 assert.throws(()=>reviseAnswer(revised.profile,revised.answers,previous.id,input(q,'yes','stale'),false),/REVISION_NOT_CURRENT/);
});
test('Every base question has a concrete example for each card and preserves its truth-valued choices',()=>{
 const snapshot=primary(7),sectors=snapshot.cards.filter(c=>c.orientation==='reversed').map(c=>c.sourcePositionId);
 const fields=[...new Map(BASE_QUESTIONS.map(q=>[q.resolvesFields[0],q])).values()];
 assert.equal(fields.length,48);
 for(const q of fields){const presentation=questionPresentation(q,snapshot,sectors,'relationship',3);
  assert.ok(presentation.title&&presentation.example.length>100,q.id);
  assert.deepEqual(presentation.choices.map(c=>c.id),q.answerSchema.choices.map(c=>c.id));
  assert.ok(presentation.context.card.orientation==='reversed');
 }
});
test('The lazy situation catalog addresses 5,376,000 combinations without allocating bulk stories',()=>{
 const snapshot=primary(7),sectors=snapshot.cards.filter(c=>c.orientation==='reversed').map(c=>c.sourcePositionId),seen=new Set();
 assert.equal(situationDesignSpace(),5376000);
 const ordinals=new Set([0,situationDesignSpace()-1,...Array.from({length:4000},(_,i)=>(i*7919)%situationDesignSpace()),
  ...Array.from({length:80},(_,i)=>i*67200)]);
 for(const i of ordinals){const row=situationVariant(snapshot,sectors,i);assert.ok(row.paragraphs.every(Boolean));seen.add(row.paragraphs.join('\n'));}
 assert.equal(seen.size,ordinals.size);
 assert.throws(()=>situationVariant(snapshot,sectors,-1));
});
test('All-upright spreads retain usable examples, while unknown consent never recommends contact',()=>{
 const snapshot=primary(7);snapshot.cards=snapshot.cards.map(c=>({...c,orientation:'upright'}));
 assert.ok(caseContext(snapshot,[]).example);
 const guidance=practicalGuidance(createSituation('s','Europe/Moscow'),snapshot,[],'boundary');
 assert.match(guidance.steps[1],/не нужен ответ/);
});
test('Forecast screens advance through single questions, including the last answer and backward navigation',()=>{
 let draft={...newForecastTest(),page:5,clock:'event'};
 const screens=forecastScreens(draft,null);assert.equal(screens.length,8);
 for(let i=0;i<screens.length;i++){assert.equal(draft.cursor??0,i);draft=moveForecastScreen(draft,null,1);}
 assert.equal(draft.page,6);assert.equal(draft.cursor,0);
 draft=moveForecastScreen(draft,null,-1);assert.equal(draft.page,5);assert.equal(draft.cursor,7);
 assert.equal(forecastScreenMissing(draft,null),true);
});
test('The shared web and native method contains no accordion elements',()=>{
 for(const file of ['AuroraWizard.tsx','TransformationView.tsx','ForecastTest.tsx']){
  const source=readFileSync(new URL('../app/aurora/'+file,import.meta.url),'utf8');
  assert.doesNotMatch(source,/<details|<summary/);
 }
 const native=readFileSync(new URL('../app/aurora/native-entry.tsx',import.meta.url),'utf8');
 assert.match(native,/import \{AuroraWizard\}/);
});

test('Every catalog question, including myth checks, has an example and meaningful answer descriptions',()=>{
 const {QUESTIONS}=calendarModule('app/aurora/catalog/questions.ts');
 const snapshot=primary(7),sectors=snapshot.cards.filter(c=>c.orientation==='reversed').map(c=>c.sourcePositionId);
 for(const q of QUESTIONS){const view=questionPresentation(q,snapshot,sectors,'home');
  assert.ok(view.example.length>100,q.id);assert.ok(view.choices.every(choice=>choice.description.length>30),q.id);
  assert.deepEqual(view.choices.map(c=>c.id),q.answerSchema.choices.map(c=>c.id));
 }
});

test('Question split information is measured in bits and cannot invent event probabilities',()=>{
 const {splitInformationGain}=calendarModule('app/aurora/question-information.ts');
 assert.equal(splitInformationGain(10,10),1);assert.equal(splitInformationGain(10,0),0);
 assert.equal(splitInformationGain(0,0,20),0);assert.equal(splitInformationGain(5,5,10),.5);
 for(const args of [[-1,1],[NaN,1],[1,Infinity],[1e308,1e308]])assert.throws(()=>splitInformationGain(...args),/INVALID_QUESTION_SPLIT/);
});

test('Unknown, unsafe and withdrawn contact never become a contact recommendation',()=>{
 const {recordField}=calendarModule('app/aurora/context.ts'),{canRecommendContact,hasActionSafetyStop}=calendarModule('app/aurora/recommendation-safety.ts');
 let p=createSituation('safe','Europe/Moscow'),n=0;
 const set=(field,value)=>{p=recordField(p,{id:String(++n),field,value,exactUserText:field,kind:'constraint',confirmed:true,beforeInterpretation:true});};
 assert.equal(canRecommendContact(p),false);set('contact_safe',true);assert.equal(canRecommendContact(p),false);
 set('other_agreement',true);assert.equal(canRecommendContact(p),true);
 for(const field of ['contact_is_unsafe','boundary_contact_is_unsafe','contact_is_overwhelming','mediator_not_trusted']){set(field,true);assert.equal(canRecommendContact(p),false);set(field,false);}
 set('immediate_danger',true);assert.equal(hasActionSafetyStop(p),true);assert.equal(canRecommendContact(p),false);
});

test('The practice path retains explicit diagnostic answers while missing and unknown answers stay unknown',()=>{
 const diagnostic=calendarModule('app/aurora/forecast-test.ts'),{knownValue}=calendarModule('app/aurora/context.ts');
 const draft={...diagnostic.newForecastTest(),mechanism:'information',phase:'onset'};
 const questions=diagnostic.diagnosticQuestions(draft,'center').flat(),[first,second,third]=questions.map(q=>q.resolvesFields[0]);
 draft.answers[first]='true';draft.answers[second]='unknown';let n=0;
 const result=diagnostic.recordForecastAnswers(draft,createSituation('practice','Europe/Moscow'),'center',()=>String(++n));
 assert.equal(knownValue(result,first),true);assert.equal(knownValue(result,second),null);
 assert.equal(result.fields[second].status,'unknown');assert.equal(result.fields[third],undefined);
 assert.equal(result.fields.context_confirmed,undefined);assert.equal(result.fields.outcome_not_known,undefined);
});
