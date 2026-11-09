import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarModule} from './helpers/calendar-modules.mjs';
const {questionLimitForStage,answeredQuestionCount}=calendarModule('app/aurora/question-budget.ts');
const context=calendarModule('app/aurora/context.ts');
const sessions=calendarModule('app/aurora/session.ts');
const diagnostic=calendarModule('app/aurora/forecast-test.ts');
const policy=calendarModule('app/aurora/draw-policy.ts');
const {eligibleSectors}=calendarModule('app/aurora/spread.ts');
const {BASE_QUESTIONS,QUESTIONS}=calendarModule('app/aurora/catalog/questions.ts');
const {MYTH_TRANSITIONS}=calendarModule('app/aurora/catalog/myths.ts');
const {SCENARIOS}=calendarModule('app/aurora/catalog/scenarios.ts');
const NOW='2026-11-06T15:00:00.000Z',OWNER='question-budget-fixture';
const primary=policy.snapshotFromSavedDraw({id:'budget-source',seed:123,day:'2026-11-06',createdAt:NOW,cards:policy.expectedSourceDraw(123)});
const sector=eligibleSectors(primary)[0];
function answer(profile,question,index,choiceId='unknown') {
 return context.applyAnswer(profile,{id:`answer-${index}`,questionId:question.id,choiceId,detail:'',responseMode:'choice',confirmed:choiceId==='yes'||choiceId==='no',createdAt:NOW},true);
}
function legacySession(count) {
 const session=sessions.newSession({id:`legacy-${count}`,ownerId:OWNER,primary,now:NOW,timezone:'Europe/Moscow'});
 session.stage=3;session.highestStage=3;session.selectedSectorId=sector;session.goalText='Проверить результат конкретного шага';
 session.context.originalQuestion='Что можно сделать до чужого ответа?';
 session.context=context.recordField(session.context,{id:'event-description',field:'event_description',value:'Участник пока не прислал ответ.',exactUserText:'Участник пока не прислал ответ.',kind:'reported_event',confirmed:true,beforeInterpretation:true});
 const question=BASE_QUESTIONS.find(q=>q.sectorTags.includes(sector));
 for(let index=0;index<count;index++){
  const result=answer(session.context,question,index,['unknown','skipped','not_applicable'][index%3]);
  session.context=result.profile;session.answers.push(result.answer);
 }
 session.revisingQuestionId=question.id;session.draftAnswer={questionId:question.id,choiceId:'',detail:'Сохранённый незаконченный черновик'};
 return session;
}

test('Only the fourth screen has twenty questions; every other stage has ten',()=>{
 for(let stage=0;stage<=8;stage++){
  const limit=questionLimitForStage(stage);assert.equal(limit,stage===3?20:10);
  for(const count of [limit-1,limit,limit+1])assert.equal(count<limit,count===(stage===3?19:9));
 }
});

test('The adaptive engine asks at nineteen responses and stops at twenty or twenty-one, including unfinished revisions',()=>{
 for(const count of [19,20,21]){
  const saved=legacySession(count),before=JSON.stringify(saved);
  const question=context.selectQuestion(saved.context,sector,primary,saved.answers,[],[],saved.revisingQuestionId);
  assert.equal(Boolean(question),count===19,`${count} answers`);assert.equal(JSON.stringify(saved),before);
 }
});

test('Unknown, skipped and not applicable each use a question slot without becoming false facts or repeating a field',()=>{
 let profile=context.createSituation('adaptive-sequence','UTC');const answers=[],fields=new Set();
 for(let index=0;index<20;index++){
  const question=context.selectQuestion(profile,'east',primary,answers);assert.ok(question,`question ${index+1}`);
  const field=question.resolvesFields[0];assert.ok(!fields.has(field),field);fields.add(field);
  const choice=['unknown','skipped','not_applicable'][index%3],result=answer(profile,question,index,choice);
  profile=result.profile;answers.push(result.answer);
  assert.equal(profile.fields[field].status,choice);assert.ok(!('value' in profile.fields[field]));assert.equal(context.knownValue(profile,field),null);
 }
 assert.equal(context.selectQuestion(profile,'east',primary,answers),null);assert.equal(answers.length,20);
});

test('A saved fourth-screen interview with fifty-one or fifty-five responses can go straight to screen five without losing history',async()=>{
 for(const count of [51,55]){
  const saved=legacySession(count),before=JSON.stringify(saved),document={version:1,ownerId:OWNER,sessions:[saved],removed:[]};
  assert.equal(await sessions.validateDocument(document,OWNER),document);
  const question=context.selectQuestion(saved.context,sector,primary,saved.answers,[],[],saved.revisingQuestionId);
  assert.equal(question,null);
  // The wizard only requires a draft answer while the engine has a question.
  const forwardDisabled=Boolean(question&&(saved.draftAnswer.questionId!==question.id||!saved.draftAnswer.choiceId));
  assert.equal(forwardDisabled,false);
  const next=sessions.moveStage(saved,4,NOW);assert.equal(next.stage+1,5);assert.equal(next.highestStage,4);
  assert.equal(next.answers,saved.answers);assert.equal(next.context,saved.context);assert.equal(next.answers.length,count);
  assert.equal(JSON.stringify(saved),before);
  await sessions.validateDocument({...document,sessions:[next]},OWNER);
 }
});

test('Explicit history corrections after the twentieth question keep all evidence and Next enabled without opening more questions',async()=>{
 const saved=legacySession(20),previous=saved.answers.at(-1),before=JSON.stringify(saved);
 const revised=context.reviseAnswer(saved.context,saved.answers,previous.id,{id:'explicit-revision',questionId:previous.questionId,choiceId:'unknown',detail:'',confirmed:false,createdAt:NOW},true);
 assert.equal(revised.answers.length,21);assert.deepEqual(revised.answers.slice(0,20),saved.answers);assert.equal(revised.answers.at(-1).revisesAnswerId,previous.id);
 assert.equal(answeredQuestionCount(revised.answers),20);assert.equal(revised.profile.fields[previous.field].status,'unknown');assert.ok(!('value' in revised.profile.fields[previous.field]));
 assert.equal(revised.profile.answerEvidence.length,saved.context.answerEvidence.length+1);assert.equal(revised.profile.answerEvidence.find(e=>e.id===previous.evidenceId).excludedReason,'superseded_by_explicit_edit');
 const question=context.selectQuestion(revised.profile,sector,primary,revised.answers);assert.equal(question,null);
 const advanced=sessions.moveStage({...saved,context:revised.profile,answers:revised.answers},4,NOW);assert.equal(advanced.stage+1,5);assert.equal(advanced.answers.length,21);
 await sessions.validateDocument({version:1,ownerId:OWNER,sessions:[advanced],removed:[]},OWNER);assert.equal(JSON.stringify(saved),before);
 const forged=[{id:'missing',questionId:previous.questionId,field:previous.field,revisesAnswerId:'not-an-answer'},
  {id:'other-question',questionId:'unrelated',field:previous.field,revisesAnswerId:previous.id},
  {id:'other-field',questionId:previous.questionId,field:'unrelated',revisesAnswerId:previous.id}];
 assert.equal(answeredQuestionCount([...saved.answers,...forged]),23);
 assert.throws(()=>context.reviseAnswer(saved.context,saved.answers,saved.answers[0].id,{id:'stale-edit',questionId:previous.questionId,choiceId:'unknown',detail:'',confirmed:false,createdAt:NOW},true),/REVISION_NOT_CURRENT/);
});

test('The ten-question forecast plan preserves both required predicates and all three groups for every scenario',()=>{
 for(const scenario of SCENARIOS){
  const draft={...diagnostic.newForecastTest(),mechanism:scenario.mechanismId,phase:scenario.phase};
  const groups=diagnostic.diagnosticQuestions(draft,scenario.sectorId),questions=groups.flat(),fields=questions.map(q=>q.resolvesFields[0]);
  assert.equal(questions.length,10,scenario.id);assert.equal(new Set(fields).size,fields.length,scenario.id);
  assert.ok(groups.every(group=>group.length>0),scenario.id);
  for(const predicate of scenario.required.slice(0,2))assert.ok(groups[0].some(q=>q.resolvesFields[0]===predicate.field),`${scenario.id}:${predicate.field}`);
  for(let index=0;index<questions.length;index++){
   const question=questions[index],field=question.resolvesFields[0],page=groups.findIndex(group=>group.includes(question))+2;
   draft.page=page;assert.equal(diagnostic.forecastTestPageMissing(draft,scenario.sectorId),true);
   draft.answers[field]='unknown';
  }
  for(const page of [2,3,4]){draft.page=page;assert.equal(diagnostic.forecastTestPageMissing(draft,scenario.sectorId),false);}
 }
});

test('Older diagnostic drafts with more than ten explicit answers remain valid and unchanged',()=>{
 const draft=diagnostic.newForecastTest();
 for(const question of QUESTIONS)if(Object.keys(draft.answers).length<55)draft.answers[question.resolvesFields[0]]='unknown';
 assert.equal(Object.keys(draft.answers).length,55);const before=JSON.stringify(draft);
 assert.doesNotThrow(()=>diagnostic.validateForecastTest(draft));diagnostic.diagnosticQuestions(draft,'east');assert.equal(JSON.stringify(draft),before);
});

test('Myth checks follow selected sectors and explicit conditions rather than every unrelated god in the full draw',()=>{
 let profile=context.createSituation('focused-myth','UTC');
 for(const field of new Set(BASE_QUESTIONS.map(q=>q.resolvesFields[0])))profile=context.recordField(profile,{id:`base-${field}`,field,value:true,exactUserText:'Synthetic explicit basis',kind:'reported_event',confirmed:true,beforeInterpretation:true});
 const allowed=new Set(MYTH_TRANSITIONS.filter(edge=>['apollo','athena'].includes(edge.sourceGodId)||['apollo','athena'].includes(edge.targetGodId)).flatMap(edge=>edge.questionIds));
 const first=context.selectQuestion(profile,'east',primary,[],['autonomy_meets_shared_duty']);assert.ok(first);assert.ok(allowed.has(first.id),first.id);
 const combined=context.selectQuestion(profile,'east',primary,[],['autonomy_meets_shared_duty'],['northwest']);
 assert.equal(combined.resolvesFields[0],'autonomy_meets_shared_duty');
 const unknown=answer(profile,combined,0,'unknown');
 const following=context.selectQuestion(unknown.profile,'east',primary,[unknown.answer],['consent_is_possible'],['northwest']);
 assert.notEqual(following?.resolvesFields[0],'consent_is_possible');assert.equal(context.knownValue(unknown.profile,'autonomy_meets_shared_duty'),null);
});
