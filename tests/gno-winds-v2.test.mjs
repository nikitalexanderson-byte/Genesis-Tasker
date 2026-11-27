import {REGION_LANGUAGES} from "../app/region-language.ts";
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {calendarModule} from './helpers/calendar-modules.mjs';
const g=calendarModule('app/aurora/gno-engine.ts'),m=calendarModule('app/aurora/gno-models.ts'),math=calendarModule('app/aurora/gno-decision-math.ts'),learner=calendarModule('app/aurora/gno-personal-ranking.ts'),intake=calendarModule('app/aurora/gno-guided.ts');
const {SECTOR_IDS}=calendarModule('app/aurora/registry.ts');
const {snapshotFromSavedDraw,expectedSourceDraw}=calendarModule('app/aurora/draw-policy.ts');
const {olympianLetterEquation}=calendarModule('app/olympian-reading-math.ts');
const at='2026-11-15T10:00:00Z';
const answer=(value='yes',basis='checked')=>({value,basis,detail:'Explicit selected confirmation',at});
function draft(){const d=g.newGnoDraft();return {...d,domain:'family',minutes:30,...intake.guidedPatch({...d,domain:'family'},{...intake.initialIntake(),topic:0,people:2,criterion:2,horizon:2},'en',new Date(at))};}
const known=()=>Object.fromEntries(g.CORE_QUESTIONS.map(key=>[key,answer(key==='repeat'?'no':'yes')]));

test('Every second-step model comparison renders its Greek name, including Zeus Herkeios',()=>{
 assert.match(olympianLetterEquation('Ζεὺς Ἑρκεῖος'),/ = 1022$/u);
 assert.equal(olympianLetterEquation('Ζεὺς\u00a0Ἑρκεῖος'),olympianLetterEquation('Ζεὺς Ἑρκεῖος'));
 for(const source of SECTOR_IDS)for(const target of SECTOR_IDS){
  for(const relation of m.crossRelation(source,target).numbers){
   assert.ok(olympianLetterEquation(relation.left.greek).endsWith(` = ${relation.x}`),`${source}/${target}: ${relation.left.greek}`);
   assert.ok(olympianLetterEquation(relation.right.greek).endsWith(` = ${relation.y}`),`${source}/${target}: ${relation.right.greek}`);
  }
 }
 assert.throws(()=>olympianLetterEquation('Ζεύς + A'),/Unsupported isopsephy character/u);
});

test('The external table is independent of the introspective map and preserves all paired patrons',()=>{
 assert.deepEqual(Object.fromEntries(SECTOR_IDS.map(id=>[id,m.EXTERNAL_SECTORS[id].deities])),{northwest:['hermes'],north:['athena'],northeast:['hephaestus','prometheus'],west:['muses','dionysus'],center:['hestia','zeusHerkeios'],east:['demeter','helios'],southwest:['aphrodite'],south:['apollo'],southeast:['ploutos','tyche']});
 assert.equal(m.sourceCurator('northwest'),'apollo');assert.equal(m.sourceCurator('west'),'poseidon');
 assert.equal(m.crossRelations().length,81);assert.equal(new Set(m.crossRelations().map(r=>r.source+':'+r.target)).size,81);
 for(const row of m.crossRelations()){assert.ok(Number.isFinite(row.score)&&row.score>=0&&row.score<=1);assert.ok(Math.abs(row.numbers.reduce((n,x)=>n+x.weight,0)-1)<1e-10);}
 assert.equal(Object.values(m.EXTERNAL_FACETS).flat().length,54);
 assert.equal(new Set(Object.values(m.TOPIC_TARGETS).flat()).size,9);
 const functions=new Set([...SECTOR_IDS.map(m.sourceCurator),...Object.values(m.EXTERNAL_SECTORS).flatMap(s=>s.deities).map(id=>id==='zeusHerkeios'?'zeus':id),...Object.values(m.CONTEXT_PATRONS).flat()]);
 for(const id of ['zeus','hera','poseidon','demeter','athena','apollo','artemis','ares','aphrodite','hephaestus','hermes','hestia','dionysus'])assert.ok(functions.has(id));
 assert.ok(m.olympianContext(draft()).some(c=>c.deity==='hera'&&c.pair&&c.number.y===109));
});
test('Exact names, epithets, arithmetic and shared Olympus sources remain distinct',()=>{
 assert.deepEqual(Object.keys(m.EXTRA_DEITIES).map(id=>m.modelName(id).sum),[721,912,318,1150,1308,1022]);
 assert.notEqual(m.modelName('ploutos').sum,m.modelName('zeus').sum);
 assert.equal(m.modelNumberRelation('athena','athena').index,0);
 assert.equal(m.modelNumberRelation('athena','athena').identity,true);
 const pairs=m.crossMyths('southwest','southeast');assert.ok(pairs.extra.some(p=>p.id==='demeter-ploutos'&&p.source.startsWith('https://')));
 const family=m.crossMyths('north','center');assert.ok(family.olympian.some(p=>p.ids.includes('athena')&&p.ids.includes('zeus')));
 assert.equal(m.crossRelation('north','center').numbers.find(n=>n.right.id==='zeusHerkeios').y,1022);
 for(const r of m.crossRelations())for(const n of r.numbers)assert.equal(1+(n.balance.total-1)%9,6);
});
test('All language packs contain 52 specific situations and 54 selectable sector themes with stable placeholders',()=>{
 const packs=JSON.parse(readFileSync(new URL('../app/aurora/gno-guided-copy.json',import.meta.url),'utf8'));
 const leaves=v=>Array.isArray(v)?v.flatMap(leaves):typeof v==='object'?Object.values(v).flatMap(leaves):[v];
 for(const [lang,p] of Object.entries(packs)){
  assert.equal(p.topics.length,52,lang);assert.equal(new Set(p.topics).size,52,lang);assert.equal(p.objects.length,52,lang);assert.equal(p.concrete.length,13,lang);
  assert.equal(p.facetsList.length,9,lang);p.facetsList.forEach(row=>assert.equal(row.length,6));
  assert.deepEqual(Object.keys(p).sort(),Object.keys(packs.en).sort());
  const strings=leaves(p);assert.ok(strings.every(s=>typeof s==='string'&&s.trim()));assert.ok(strings.every(s=>!(/ZXQ\d|975001579|\[800\d{3}\]/.test(s))),lang);
  if(!['zh','ja'].includes(lang))assert.ok(strings.every(s=>!/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(s)),`${lang}: unexpected East Asian text`);
  if(!['ru','uk','sr'].includes(lang))assert.ok(strings.every(s=>!/[\p{Script=Cyrillic}]/u.test(s)),`${lang}: unexpected Cyrillic text`);
  p.criteria.forEach(s=>assert.deepEqual(s.match(/\{\w+\}/g),['{object}']));
 }
 assert.equal(Object.keys(packs).length, REGION_LANGUAGES.length);
});
test('Select-only intake covers every external facet, has no silently preselected people or result, and does not shift past dates',()=>{
 assert.equal(g.readiness(g.newGnoDraft()),false);
 const d=draft();assert.equal(g.readiness(d),true);assert.equal(d.deadline,'2026-11-18');
 for(let facet=0;facet<54;facet++){const next={...d,...intake.guidedPatch(d,{...d.guided,topic:4,facet},'en',new Date(at))};assert.equal(m.externalTarget(next),SECTOR_IDS[Math.floor(facet/6)]);assert.equal(g.readiness(next),true);assert.ok(next.object.length);g.validateGno(next);}
 for(const file of ['GnoWizard.tsx','GnoIntake.tsx','GnoModelLinks.tsx']){const source=readFileSync(new URL('../app/aurora/'+file,import.meta.url),'utf8');assert.doesNotMatch(source,/<textarea|type=['"](?:text|date|search)['"]/);}
});
test('Old answers, assumptions and rejected readings cannot activate corrected cross-model resources',()=>{
 const d={...draft(),support:'north',focus:'east',answers:{'resource:north':answer(),'bridge:north:east':answer()}};
 assert.equal(g.bridgeStrength(d),0);
 d.answers['resource:2026:north']=answer();d.answers[m.bridgeKey(d)]=answer();d.answers[m.limitKey(d)]=answer('no');assert.equal(g.bridgeStrength(d),0);
 d.answers['reading:north']=answer();assert.equal(g.bridgeStrength(d),1);
 for(const basis of ['assumed','obstacle']){d.answers[m.bridgeKey(d)]=answer('yes',basis);assert.equal(g.bridgeStrength(d),0);}
 d.answers[m.bridgeKey(d)]=answer();d.answers['reading:north']=answer('no');assert.equal(g.bridgeStrength(d),0);
 d.answers['reading:north']=answer();assert.equal(g.bridgeStrength({...d,externalFocus:'west'}),0);
});
test('Tetractys and golden diversity never bypass feasibility, including with maximal learned influence',()=>{
 assert.equal(math.tetractys({symbol:1,resources:0,context:0,robustness:0}),.1);
 assert.equal(math.tetractys({symbol:0,resources:0,context:0,robustness:1}),.4);
 assert.ok(Math.abs(math.GOLDEN_PRIMARY+math.GOLDEN_SECONDARY-1)<1e-12);
 let checks=0;
 for(const domain of g.DOMAINS)for(const blocker of g.BLOCKERS)for(const minutes of [0,2,10,30]){
  const d={...draft(),domain,blocker,minutes,answers:{...known(),consent:answer('no'),access:answer('no')}};
  for(const row of g.diverseActions(d,10,{score:()=>math.LEARNED_LIMIT})){assert.ok(!row.blocked.length&&row.minutes<=minutes);assert.ok(!row.requirements.includes('consent')&&!row.requirements.includes('access'));assert.equal(row.features.length,40);assert.ok(row.features.every(n=>n>=0&&n<=1));}
  checks++;
 }assert.equal(checks,312);
});
test('Directed path homotopy only exchanges independent observation/preparation and preserves required operations',()=>{
 const a=['observe','prepare','contact','agree','act','review'],b=['prepare','observe','contact','agree','act','review'];
 assert.equal(math.homotopyClass(a,true),math.homotopyClass(b,true));
 assert.notEqual(math.homotopyClass(a,false),math.homotopyClass(b,false));
 assert.notEqual(math.homotopyClass(['contact','agree','act','review'],true),math.homotopyClass(['act','contact','agree','review'],true));
 for(const v of math.routeVariants(a,true)){assert.deepEqual([...v.steps].sort(),[...a].sort());assert.ok(v.steps.indexOf('agree')<v.steps.indexOf('act'));assert.equal(v.steps.at(-1),'review');}
 const choices=g.diverseActions({...draft(),answers:known()},10);assert.equal(choices.length,10);assert.equal(new Set(choices.map(r=>r.mechanism)).size,10);
});
test('Personal learning uses only the latest comparable executed outcome and retains immutable feature snapshots',()=>{
 const d=draft(),features=g.actionCandidates(d)[0].features;
 d.plans=[{id:'p',ranking:{version:learner.PERSONAL_RANKING_VERSION,features}}];
 d.observations=[{planId:'p',at,execution:'done',outcome:'met',comparable:true}];assert.equal(g.ratedDecisions([d]).length,1);
 for(const execution of ['not_done','partial'])assert.equal(g.ratedDecisions([{...d,observations:[{...d.observations[0],execution}]}]).length,0);
 assert.equal(g.ratedDecisions([{...d,observations:[{...d.observations[0],comparable:false}]}]).length,0);
 d.observations.push({planId:'p',at:'2026-11-16T10:00:00Z',execution:'done',outcome:'unknown',comparable:true});assert.equal(g.ratedDecisions([d]).length,0);
 assert.equal(learner.personalRanking([]).active,false);
 const history=Array.from({length:120},(_,i)=>({planId:String(i),features:Array.from({length:40},(_,j)=>j===0?Number(i%2===0):0),helped:i%2===0,at:new Date(Date.UTC(2026,0,1,i)).toISOString()}));
 const model=learner.personalRanking(history);assert.equal(model.active,true);assert.equal(model.parameters,169);assert.ok(model.validationLoss<model.baselineLoss);
 for(const r of history)assert.ok(Math.abs(model.score(r.features))<=math.LEARNED_LIMIT);
 assert.equal(model.score([NaN]),0);assert.equal(learner.personalRanking(history.slice(0,11)).active,false);
 assert.equal(learner.personalRanking(history.map(r=>({...r,helped:true}))).active,false);
});
test('Semantic projection is normalised and preserves mass without duplicating paired patrons',()=>{
 const primary=snapshotFromSavedDraw({id:'test',seed:123,day:'2026-11-15',createdAt:at,cards:expectedSourceDraw(123)}),before=JSON.stringify(primary);
 const p=g.semanticProjection(primary,draft()),sum=xs=>xs.reduce((a,b)=>a+b,0);
 assert.ok(Math.abs(sum(p.base)-sum(p.values))<1e-10);for(let j=0;j<9;j++)assert.ok(Math.abs(sum(p.matrix.map(row=>row[j]))-1)<1e-10);
 assert.equal(JSON.stringify(primary),before);
});
