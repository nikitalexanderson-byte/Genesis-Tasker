import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarModule} from './helpers/calendar-modules.mjs';
const {BASE_QUESTIONS,QUESTIONS,INFORMATION_FAMILIES}=calendarModule('app/aurora/catalog/questions.ts');
const {MEANING_PROFILES,PROFILE_STATES}=calendarModule('app/aurora/catalog/profiles.ts');
const {MYTH_TRANSITIONS}=calendarModule('app/aurora/catalog/myths.ts');
const {SECTOR_IDS,CURATOR_IDS}=calendarModule('app/aurora/registry.ts');
const graph=calendarModule('app/aurora/graph.ts');
const math=calendarModule('app/aurora/potentials.ts');
function profile(fields={}){
 const answerEvidence=Object.entries(fields).map(([key])=>({id:`ev-${key}`,situationId:'synthetic',answerId:`answer-${key}`,exactUserText:'Synthetic explicitly reported condition',collectedBeforeDetailedInterpretation:true,usedIn:[],kind:'reported_event',timeframe:null,explicitUserConfirmation:true}));
 return {fields:Object.fromEntries(Object.entries(fields).map(([key,value])=>[key,{status:'known',value,evidenceIds:[`ev-${key}`]}])),answerEvidence};
}
test('432 authored base questions cover all 9×8×6 distinct checks and 54 myth checks resolve their links',()=>{
 assert.equal(BASE_QUESTIONS.length,432);assert.equal(QUESTIONS.length,486);
 assert.equal(new Set(BASE_QUESTIONS.map(q=>q.text.normalize('NFC').toLocaleLowerCase())).size,432);
 for(const sector of SECTOR_IDS)for(const family of INFORMATION_FAMILIES)assert.equal(BASE_QUESTIONS.filter(q=>q.sectorTags.includes(sector)&&q.informationFamily===family).length,6);
 const ids=new Set(QUESTIONS.map(q=>q.id));assert.equal(ids.size,QUESTIONS.length);
 for(const q of QUESTIONS){assert.ok(q.text.length>20,q.id);assert.doesNotMatch(q.text,/[a-z]+_[a-z]+/u);assert.ok(q.resolvesFields.length);assert.equal(q.answerSchema.choices.length,2);assert.notEqual(q.nextBranchRules[0].consequence,q.nextBranchRules[1].consequence,q.id);assert.ok(q.example&&q.counterexample);}
 for(const edge of MYTH_TRANSITIONS)for(const id of edge.questionIds)assert.ok(ids.has(id),id);
});
test('All 52 curator modes contain different meanings and retain the thirteen-curator rule',()=>{
 assert.equal(MEANING_PROFILES.length,52);assert.equal(new Set(MEANING_PROFILES.map(p=>p.id)).size,52);
 for(const god of CURATOR_IDS){const rows=MEANING_PROFILES.filter(p=>p.curatorId===god);assert.equal(rows.length,4);assert.equal(new Set(rows.map(r=>r.description)).size,4);for(const mode of PROFILE_STATES)assert.ok(rows.some(r=>r.state===mode));}
 assert.ok(MEANING_PROFILES.every(p=>p.curatorId!=='kronos'&&p.sourceRefs.length&&p.confirmationQuestion));
});
test('Eighteen sourced directed myth rules distinguish temporal annotations from mass flow',()=>{
 assert.equal(MYTH_TRANSITIONS.length,18);assert.equal(new Set(MYTH_TRANSITIONS.map(e=>e.id)).size,18);
 assert.equal(MYTH_TRANSITIONS.filter(e=>!e.participatesInMassFlow).length,2);
 for(const edge of MYTH_TRANSITIONS){assert.ok(edge.antiqueSource.startsWith('https://'));assert.ok(edge.sourcePassage&&edge.sourceSummary&&edge.projectInterpretation);assert.ok(edge.activationPredicates.length>=2&&edge.disconfirmingPredicates.length);assert.equal(edge.participatesInMassFlow,edge.sourceGodId!=='kronos'&&edge.targetGodId!=='kronos');}
});
test('Unknown and contradictions cannot activate a transition; explicit counterevidence disables it',()=>{
 const edge=MYTH_TRANSITIONS[0];assert.equal(graph.evaluateTransition(edge,profile()).state,'unknown');
 const fields=Object.fromEntries(edge.activationPredicates.map(p=>[p.field,true]));assert.equal(graph.evaluateTransition(edge,profile(fields)).state,'true');
 fields[edge.disconfirmingPredicates[0].field]=true;assert.equal(graph.evaluateTransition(edge,profile(fields)).state,'false');
 const unconfirmed=profile(Object.fromEntries(edge.activationPredicates.map(p=>[p.field,true])));unconfirmed.answerEvidence[0].explicitUserConfirmation=false;
 assert.equal(graph.evaluateTransition(edge,unconfirmed).state,'unknown');
});
test('Reciprocal links preserve mass and temporal absence returns the baseline exactly',()=>{
 const fields={};for(const edge of MYTH_TRANSITIONS.slice(0,2))for(const p of edge.activationPredicates)fields[p.field]=true;
 const context=profile(fields),z=math.zeros(26,9);z[10][0]=1;
 const result=graph.modelWithTemporalTriad(z,MYTH_TRANSITIONS,context,null);assert.equal(result.final,result.base.values);
 assert.ok(Math.abs(math.total(result.final)-1)<1e-12);assert.ok(result.trace.some(e=>e.active));
 const incomplete=graph.modelWithTemporalTriad(z,MYTH_TRANSITIONS,context,{id:'incomplete',cards:[]});assert.equal(incomplete.final,incomplete.base.values);
});
