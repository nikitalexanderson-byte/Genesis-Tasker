import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {calendarModule} from './helpers/calendar-modules.mjs';
const {transformationAtlas,toggleTransformationSector,validateTransformation,selectedTransformationSectors,updateTransformationIntake,TRANSFORMATION_BRIDGES}=calendarModule('app/aurora/transformation.ts');
const {validateFrozenTransformation}=calendarModule('app/aurora/result.ts');
const {recordField}=calendarModule('app/aurora/context.ts');
const {transformationTopology,harmonicScore}=calendarModule('app/aurora/transformation-math.ts');
const {expectedSourceDraw,snapshotFromSavedDraw}=calendarModule('app/aurora/draw-policy.ts');
const {newSession,validateDocument}=calendarModule('app/aurora/session.ts');
const {cardInsight}=calendarModule('app/aurora/card-insights.ts');
const {SOURCE_CARD_IDS}=calendarModule('app/aurora/spread.ts');
const {SECTOR_IDS}=calendarModule('app/aurora/registry.ts');
const {newPersonalLearning,updatePersonalLearning,personalPrediction,validatePersonalLearning,mergePersonalLearning,learnResolvedForecast,LEARNING_MAX_BYTES}=calendarModule('app/aurora/personal-learning.ts');
const {compactDreamDate}=calendarModule('app/dream-journal-date.ts');
const {getGregorianDate,getSacredDate,getLunarDate}=calendarModule('app/calendar-data.ts');
const {civilDateCarrier}=calendarModule('app/calendar-context.ts');
const now='2026-11-06T11:00:00.000Z';
const primary=seed=>snapshotFromSavedDraw({id:`transformation-${seed}`,seed,day:'2026-11-06',createdAt:now,cards:expectedSourceDraw(seed)});

test('Every letter and sector has a distinct source and desired reading in both orientations',()=>{
 const seen=new Set();
 for(const cardId of SOURCE_CARD_IDS)for(const sourcePositionId of SECTOR_IDS)for(const orientation of ['upright','reversed'])for(const model of ['source','desired']){
  const insight=cardInsight({cardId,sourcePositionId,orientation},'ru',model);
  assert.ok(insight.focus&&insight.question&&insight.bridge&&insight.lines.length);
  seen.add(JSON.stringify([insight.symbol,insight.patrons,insight.sector,insight.focus,insight.question,model]));
 }
 assert.equal(seen.size,24*9*2*2);
 assert.match(cardInsight({cardId:'pi',sourcePositionId:'northeast',orientation:'reversed'}).patrons,/Артемида/);
 assert.match(cardInsight({cardId:'pi',sourcePositionId:'northeast',orientation:'reversed'},'ru','desired').patrons,/Зевс/);
});
test('Combinations select only reversed cards and survive validation without changing the saved spread',async()=>{
 const source=primary(7),before=JSON.stringify(source),eligible=source.cards.filter(card=>card.orientation==='reversed');
 let session=newSession({id:'s',ownerId:'owner',primary:source,now,timezone:'Europe/Moscow'});
 for(const card of eligible.slice(0,3))session=toggleTransformationSector(session,card.sourcePositionId);
 assert.deepEqual(selectedTransformationSectors(session),eligible.slice(0,3).map(card=>card.sourcePositionId));
 assert.equal(JSON.stringify(source),before);
 await validateDocument({version:1,ownerId:'owner',sessions:[session],removed:[]},'owner');
 const upright=source.cards.find(card=>card.orientation==='upright');
 if(upright)assert.throws(()=>toggleTransformationSector(session,upright.sourcePositionId),/TRANSFORMATION_INVALID/);
 assert.throws(()=>validateTransformation({...session.transformation,sectors:['east','east']},source),/TRANSFORMATION_INVALID/);
});
test('Five answers are grounded in the card combination and previous answers, with no inferred event facts',()=>{
 for(let seed=0;seed<60;seed++){
  const source=primary(seed),sectors=source.cards.filter(card=>card.orientation==='reversed').map(card=>card.sourcePositionId);
  const before=JSON.stringify(source);
  for(const mechanism of ['information','resources','dependency','boundary','pressure','values','form','rhythm']){
   const atlas=transformationAtlas(source,sectors,['agency','integration'],{event:mechanism,question:'response'});
   for(const choices of [atlas.goals,atlas.questionOptions,atlas.eventOptions,...Object.values(atlas.choices)]){
    assert.equal(choices.length,5);assert.equal(new Set(choices.map(row=>row.id)).size,5);
   }
   assert.ok(atlas.focal.every(row=>row.bridge.sources.length&&row.focus.risk.ru));
   assert.ok(atlas.topology.residual<1e-10);
  }
  assert.equal(JSON.stringify(source),before);
 }
 const source=primary(1),sectors=source.cards.filter(card=>card.orientation==='reversed').map(card=>card.sourcePositionId);
 assert.notDeepEqual(transformationAtlas(source,sectors,[],{event:'information'}).choices,transformationAtlas(source,sectors,[],{event:'resources'}).choices);
});
test('Hodge analysis identifies components and cycles and solves its energy gradient',()=>{
 const tree=transformationTopology([{from:'a',to:'b',weight:1},{from:'b',to:'c',weight:1}],{a:1});
 assert.equal(tree.beta0,1);assert.equal(tree.beta1,0);assert.ok(tree.residual<1e-10);
 const cycle=transformationTopology([{from:'a',to:'b',weight:1},{from:'b',to:'c',weight:1},{from:'c',to:'a',weight:1},{from:'d',to:'e',weight:1}],{a:1});
 assert.equal(cycle.beta0,2);assert.equal(cycle.beta1,1);assert.equal(cycle.boundaryRank,3);
 assert.ok(cycle.energy>=0&&cycle.dirichlet>=0&&Object.values(cycle.values).every(value=>value>=-1e-10&&value<=1+1e-10));
 assert.equal(harmonicScore([0,0,0,0,0]),0);assert.ok(Math.abs(harmonicScore([1,1,1,1,1])-1)<1e-14);
 assert.throws(()=>harmonicScore([1,1,NaN,1,1]));
});

test('Chosen resources remain available and later answers never rewrite earlier choices',()=>{
 for(let seed=0;seed<15;seed++){
  const source=primary(seed),sectors=source.cards.filter(card=>card.orientation==='reversed').map(card=>card.sourcePositionId);
  for(const event of ['information','resources','dependency','boundary','pressure','values','form','rhythm']){
   const head={question:'response',event},a=transformationAtlas(source,sectors,[],head);
   for(const constraint of a.choices.constraint){
    const b=transformationAtlas(source,sectors,[],{...head,constraint:constraint.id});
    assert.deepEqual(b.choices.constraint,a.choices.constraint);
    for(const resource of b.choices.resources){
     const c=transformationAtlas(source,sectors,[],{...head,constraint:constraint.id,resources:resource.id});
     assert.deepEqual(c.choices.resources,b.choices.resources);
     assert.ok(c.choices.resources.some(row=>row.id===resource.id));
     const d=transformationAtlas(source,sectors,[],{...head,constraint:constraint.id,resources:resource.id,unknown:c.choices.unknown[0].id});
     assert.deepEqual(d.choices,c.choices);
    }
   }
  }
 }
});

test('Editing an earlier intake answer retires stale facts and dependent tests, including all-upright observation mode',async()=>{
 const uprightSeed=Array.from({length:10000},(_,i)=>i).find(seed=>expectedSourceDraw(seed).every(card=>!card.reversed));
 for(const seed of [7,uprightSeed]){
  const source=primary(seed),reversed=source.cards.filter(card=>card.orientation==='reversed');
  let s=newSession({id:`edit-${seed}`,ownerId:'owner',primary:source,now,timezone:'Europe/Moscow'});
  if(reversed.length)s=toggleTransformationSector(s,reversed[0].sourcePositionId);
  const atlas=()=>transformationAtlas(source,s.observationOnly?SECTOR_IDS:selectedTransformationSectors(s),[],s.transformation?.answers);
  s=updateTransformationIntake(s,'question','response','q');s=updateTransformationIntake(s,'domain','work','d');
  s=updateTransformationIntake(s,'event',atlas().eventOptions[0].id,'e');
  s=updateTransformationIntake(s,'constraint',atlas().choices.constraint[0].id,'c');
  const oldResource=atlas().choices.resources[0].id;
  s=updateTransformationIntake(s,'resources',oldResource,'r');
  s=updateTransformationIntake(s,'unknown',atlas().choices.unknown[0].id,'u');
  assert.equal(s.transformation.answers.resources,oldResource);assert.ok(s.intake.unknown_description);
  s.context=recordField(s.context,{id:'later',field:'context_confirmed',value:true,exactUserText:'yes',kind:'constraint',confirmed:true,beforeInterpretation:false});
  s.answers=[{field:'later'}];s.forecastTest.answers.direct_evidence='true';
  s=updateTransformationIntake(s,'constraint','unknown','edit');
  assert.equal(s.transformation.answers.resources,undefined);assert.equal(s.intake.available_resources,undefined);
  assert.equal(s.intake.unknown_description,undefined);assert.equal(s.context.fields[oldResource],undefined);
  assert.equal(s.context.fields.context_confirmed,undefined);assert.equal(s.answers.length,0);
  assert.deepEqual(s.forecastTest.answers,{});assert.ok(s.context.answerEvidence.every(row=>row.excludedReason));
  await validateDocument({version:1,ownerId:'owner',sessions:[s],removed:[]},'owner');
 }
});

test('Frozen transformations allow only the matching cards, myth routes and cited source URLs',()=>{
 const source=primary(7),sectors=source.cards.filter(card=>card.orientation==='reversed').map(card=>card.sourcePositionId),atlas=transformationAtlas(source,sectors,['agency']);
 const report={version:1,key:atlas.key,sectors,spheres:['agency'],meaning:atlas.context,routes:atlas.focal.map(row=>({sector:row.card.sourcePositionId,cardId:row.card.cardId,summary:row.bridge.summary,route:row.bridge.route,sources:row.bridge.sources}))};
 validateFrozenTransformation(report);
 for(const mutate of [value=>value.sectors.push(value.sectors[0]),value=>value.routes[0].sources[0].url='javascript:alert(1)',value=>value.routes[0].route=['zeus'],value=>value.routes[0].cardId='fake',value=>value.key='mismatch',value=>value.spheres=['fake']]){
  const invalid=structuredClone(report);mutate(invalid);assert.throws(()=>validateFrozenTransformation(invalid),/TRANSFORMATION_RESULT/);
 }
 assert.match(TRANSFORMATION_BRIDGES.east.sources[1].url,/Apollodorus2/);
 assert.match(TRANSFORMATION_BRIDGES.southwest.sources[0].url,/HomericHymns1/);
});

test('Learning uses frozen inputs and only evidenced outcomes after a closed horizon',()=>{
 const source=primary(7),s=newSession({id:'learn',ownerId:'owner',primary:source,now,timezone:'Europe/Moscow'});
 s.context.historyPermission=true;s.context=recordField(s.context,{id:'outcome',field:'observed',value:true,exactUserText:'direct observation',kind:'reported_event',confirmed:true,beforeInterpretation:false});
 s.contextSnapshots=[{id:'frozen',profile:structuredClone(s.context)}];
 const forecast={id:'f',status:'issued',scenarioId:'east-information-onset',plannedActionId:null,horizon:{mode:'absolute'},contextSnapshotId:'frozen',frozenAt:'2026-11-01T10:00:00Z',payloadHash:'a'.repeat(64)};
 s.forecasts=[forecast];
 const resolution={status:'confirmed',observedOccurred:true,conditionStatus:'met',outcomeEvidenceIds:['outcome'],resolvedHorizon:{start:forecast.frozenAt,end:'2026-11-05T10:00:00Z'},recordedAt:now};
 const empty=newPersonalLearning(),learned=learnResolvedForecast(empty,s,forecast,resolution);assert.equal(learned.n,1);
 assert.equal(learnResolvedForecast(learned,s,forecast,resolution),learned);
 for(const change of [{conditionStatus:'unknown'},{status:'indeterminate'},{outcomeEvidenceIds:[]},{outcomeEvidenceIds:['missing']},{recordedAt:'2026-11-02T10:00:00Z'}])assert.equal(learnResolvedForecast(empty,s,forecast,{...resolution,...change}),empty);
 const {learningFeatures}=calendarModule('app/aurora/personal-learning.ts'),before=learningFeatures(s,forecast);
 s.context=recordField(s.context,{id:'late',field:'goal_is_own',value:true,exactUserText:'later answer',kind:'value',confirmed:true,beforeInterpretation:false});
 assert.deepEqual(learningFeatures(s,forecast),before);
});

test('Selecting no evidence cannot confirm an outcome or become a learning label',()=>{
 const {hasObservationEvidence}=calendarModule('app/aurora/forecast-test.ts'),copy=JSON.parse(readFileSync(new URL('../app/aurora/forecast-test-copy.ru.json',import.meta.url),'utf8'));
 assert.equal(hasObservationEvidence(copy.testNoEvidence),false);assert.equal(hasObservationEvidence('  '),false);
 for(const value of [copy.testWritten,copy.testDirect,copy.testParticipant,'Сохранённое наблюдение из прежней работы'])assert.equal(hasObservationEvidence(value),true);
});
test('Online learning is bounded, prequentially evaluated, replay-safe and conservative without evidence',()=>{
 let model=newPersonalLearning();const before=JSON.stringify(model),features=Array(128).fill(0);features[0]=1;
 assert.equal(personalPrediction(model,features).probability,null);
 for(let i=0;i<400;i++){
  const label=i%2;features[1]=label?1:-1;
  model=updatePersonalLearning(model,features,label,createHash('sha256').update(String(i)).digest('hex'));
 }
 validatePersonalLearning(model);assert.equal(model.n,400);assert.ok(model.brier<model.baselineBrier);
 assert.ok(Buffer.byteLength(JSON.stringify(model))<LEARNING_MAX_BYTES);assert.notEqual(JSON.stringify(model),before);
 assert.equal(updatePersonalLearning(model,features,1,createHash('sha256').update('399').digest('hex')),model);
 assert.throws(()=>validatePersonalLearning({...model,z:[Infinity]}),/LEARNING_INVALID/);
 const noHistory={context:{historyPermission:false}},emptyForecast={status:'issued'},emptyResolution={status:'confirmed'};
 assert.equal(learnResolvedForecast(model,noHistory,emptyForecast,emptyResolution),model);
 const fork=mergePersonalLearning(newPersonalLearning(),model,{...model,n:model.n,brier:model.brier+.01});
 assert.equal(fork.n,0);assert.equal(fork.seen,model.seen);assert.equal(personalPrediction(fork,features).probability,null);
 assert.equal(mergePersonalLearning(undefined,undefined,model),model);
});
test('Compact dream dates preserve six pentads, additive IIII, lunar decades and intercalary days',()=>{
 const iso=date=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
 for(let day=1;day<=30;day++){
  const date=getGregorianDate(2026,9,day),label=compactDreamDate(iso(date),'sacred');
  assert.equal(label,`${['I','II','III','IIII','V'][(day-1)%5]}.${Math.floor((day-1)/5)+1}.10`);
 }
 assert.equal(compactDreamDate('2026-11-06','profane'),'2026-11-06');
 for(let n=0;n<365;n+=3){const date=new Date(2026,0,n+1,12),day=iso(date),parts=getLunarDate(civilDateCarrier(day));
  assert.equal(compactDreamDate(day,'lunar'),`${(parts.day-1)%10+1}.${Math.floor((parts.day-1)/10)+1}.${parts.monthOrdinal}`);
  const sacred=getSacredDate(civilDateCarrier(day));if(sacred.monthIndex===12)assert.equal(compactDreamDate(day,'sacred'),`${sacred.day}.Ω`);
 }
});
