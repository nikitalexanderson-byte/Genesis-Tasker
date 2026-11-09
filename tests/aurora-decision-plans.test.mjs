import test from 'node:test';import assert from 'node:assert/strict';import {calendarModule} from './helpers/calendar-modules.mjs';
const plans=calendarModule('app/aurora/decision-plans.ts'),context=calendarModule('app/aurora/context.ts');
const {ACTIONS}=calendarModule('app/aurora/catalog/actions.ts'),{MEANING_PROFILES}=calendarModule('app/aurora/catalog/profiles.ts');
const now='2026-11-06T10:00:00.000Z';
const draws=calendarModule('app/aurora/draw-policy.ts'),{calculateModel}=calendarModule('app/aurora/model.ts');
const primary=draws.snapshotFromSavedDraw({id:'source',seed:123,day:'2026-11-06',createdAt:now,cards:draws.expectedSourceDraw(123)});
function profile(fields={}){let p=context.createSituation('situation','UTC');for(const [field,value]of Object.entries(fields))p=context.recordField(p,{id:field,field,value,exactUserText:'Synthetic answer',kind:'reported_event',confirmed:true,beforeInterpretation:true});return p;}
test('The bounded compositional catalog has 958464 distinct structural routes, with 312 actual action texts',()=>{
 assert.equal(plans.decisionDesignSpace(),958464);assert.equal(ACTIONS.length,312);
 let routes=[''];for(const axis of plans.DECISION_AXES)routes=routes.flatMap(prefix=>axis.variants.map(v=>prefix+'/'+axis.id+':'+v.id));
 assert.equal(routes.length,1024);assert.equal(new Set(routes).size,1024);
 assert.equal(new Set(plans.DECISION_AXES.flatMap(axis=>axis.variants.map(v=>v.text))).size,20);
});
test('Golden and tetractys suitability is bounded, monotone and never labelled as an outcome probability',()=>{
 assert.equal(plans.tetractysGoldenScore([0,0,0,0],0),0);
 assert(Math.abs(plans.tetractysGoldenScore([1,1,1,1],1)-1)<1e-12);
 for(let n=0;n<=100;n++){const x=n/100,score=plans.tetractysGoldenScore([x,x,x,x],x);assert(score>=0&&score<=1);if(n)assert(score>=plans.tetractysGoldenScore([(n-1)/100,(n-1)/100,(n-1)/100,(n-1)/100],(n-1)/100));}
 assert.throws(()=>plans.tetractysGoldenScore([1,1,1],1));assert.throws(()=>plans.tetractysGoldenScore([NaN,1,1,1],1));
});
test('Unknown capabilities cannot permit contact, shared execution or tool use; verified resources change the route',()=>{
 const action=ACTIONS.find(a=>a.requiredResources.every(r=>r==='private_note'));
 const goal={goalTags:action.goalTags,barrierTags:action.barrierTags,sectorId:action.sectorIds[0],confirmed:true};
 const p=profile(),result=plans.buildDecisionPlan(action,2,p,goal,calculateModel(primary,p,null));plans.validateDecisionPlan(result);
 assert(!result.variantIds.includes('clarify'));assert(!result.variantIds.includes('agreement'));assert(!result.variantIds.includes('prototype'));
 assert(result.suitability.lower<result.suitability.upper);assert.equal('probability' in result,false);
 const rich=profile({available_materials:true,available_tools:true,other_agreement:true,contact_safe:true,source_known:true,clear_scope:true,
  baseline_defined:true,resource_available:true,decision_owner_known:true,nonnegotiable_constraint:false,reversible_step:true,stop_condition_known:true,scale_limit_known:true,target_observable:true,forecast_verification:'written'});
 const changed=plans.buildDecisionPlan(action,10,rich,goal,calculateModel(primary,rich,null));plans.validateDecisionPlan(changed);
 assert(changed.feasibleVariants>result.feasibleVariants);assert(changed.variantIds.includes('document'));assert(changed.myth?.source.startsWith('https://'));
 const unsafe=profile({immediate_danger:true});assert.throws(()=>plans.buildDecisionPlan(action,2,unsafe,goal,calculateModel(primary,unsafe,null)),/EXCLUDED/);
});
test('All catalog actions have bounded deterministic routes when their resources are explicitly available',()=>{
 const p=profile({available_materials:true,available_tools:true,available_feedback:true}),m=calculateModel(primary,p,null);
 for(const action of ACTIONS)for(const minutes of [2,10,30]){
  const meaning=MEANING_PROFILES.find(row=>row.curatorId===action.curatorId&&row.state===action.profileState);
  const goal={goalTags:meaning.goalTags,barrierTags:meaning.barrierTags,sectorId:action.sectorIds[0],confirmed:true};
  const plan=plans.buildDecisionPlan(action,minutes,p,goal,m);plans.validateDecisionPlan(plan);
  assert.deepEqual(plan,plans.buildDecisionPlan(action,minutes,p,goal,m));assert(plan.steps.length>=5);
 }
});
